// Reads moved from PowerShell into the native helper (26 Oct 2026; docs/handoff/helper-reads.md). Nothing starts: the
// helper is a stand-in that answers with recorded text, and PowerShell is never run.
//   1. the same parsed output from both paths, on samples recorded on one PC at one moment
//      (tests/lib/helper-reads-samples.json: each script's exact output and the helper's exact reply line)
//   2. the fallback: a missing, older, restarting or failing helper, or DEVICEHUB_HELPER_READS=0, reads with PowerShell
//   3. every op a caller asks for is one helpers/pc-reads.cs answers, and the build compiles it in
//   4. reads only: the changes (display mode, HDR, main screen) still go through helpers/display.ps1, and pc-reads.cs has
//      no registry write, display change, device open or WMI method call other than the reliability read
// Run: node tests/helper-reads.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = path.join(ROOT, 'helpers');
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'lib', 'helper-reads-samples.json'), 'utf8'));
const reads = require('../helpers/helper-reads.js');
const pcMap = require('../helpers/pc-map.js')._test;
const display = require('../helpers/display.js')._test;
const pcCheck = require('../helpers/pc-check.js')._test;
const sensors = require('../helpers/pc-sensors.js')._test;
const eq = require('../helpers/eqapo-devices.js')._test;
const stdBattery = require('../helpers/std-battery.js');
const installers = await import(pathToFileURL(path.join(H, 'installers.mjs')).href);
const boardLights = await import(pathToFileURL(path.join(H, 'board-lights.mjs')).href);
const diag = await import(pathToFileURL(path.join(H, 'diagnose.mjs')).href);

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
// equal values, whatever the order of an object's keys (the helper reads the PC check's parts side by side)
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const firstDiff = (a, b, p = '') => {
  if (same(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; } }
  return `${p}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
};
// a stand-in for helpers/native.js: answers each request with the given text, and records it
const fakeNative = (answer) => { const asked = []; return { asked, request: async (chan, cmd, ms) => { asked.push({ chan, cmd: JSON.parse(cmd), ms }); return typeof answer === 'function' ? answer(chan, cmd) : answer; } }; };
const helperSide = async (op, extra = {}) => {
  const nat = fakeNative(S[op].helper);
  const r = await reads.viaHelper(op, extra, 20000, nat);
  check(!r.fail && nat.asked.length === 1 && nat.asked[0].chan === `pc:${op}` && nat.asked[0].cmd.op === op, `${op}: asked on its own channel pc:${op} with { op }`);
  return r.result;
};
const lastJson = (text) => JSON.parse(String(text).trim().split(/\r?\n/).pop());

// ---- 1. the same parsed output from both paths ----
{
  const a = pcMap.shapeBluetooth(JSON.parse(S.bluetooth.ps)), b = pcMap.shapeBluetooth(await helperSide('bluetooth'));
  check(same(a, b) && a.length > 0, `bluetooth: same list from both (${firstDiff(a, b)})`);
  check(a.every((d) => !/Find My$/.test(d.name)), 'bluetooth: the Find My suffix is taken off both');
}
{
  const strip = (x) => { const { readAt, ...rest } = x; return rest; };
  const a = strip(pcMap.shape(JSON.parse(S['pc-map'].ps))), b = strip(pcMap.shape(await helperSide('pc-map')));
  check(same(a, b) && a.usb.length > 0 && a.ram.length > 0, `pc-map: same PC map from both (${firstDiff(a, b)})`);
}
{
  const view = (r) => ({ screens: r.screens.map(display.shape), nightLight: display.nightLight(r.nightLight) });
  const a = view(lastJson(S['display-read'].ps).result), b = view(await helperSide('display-read'));
  check(same(a, b) && a.screens.length > 0 && a.screens[0].resolutions.length > 0, `display-read: same screens from both (${firstDiff(a, b)})`);
}
{
  const key = (l) => l.map((x) => `${x.name}|${x.version}`).sort();
  const a = key(installers.parseInstalled(S.installed.ps)), b = key(await helperSide('installed'));
  check(same(a, b) && a.some((x) => /^Equalizer APO\|/.test(x)), `installed: same Apps list from both (${firstDiff(a, b)})`);
  check(a.some((x) => /\|null$/.test(x)), 'installed: an entry without a version is null on both');
}
{
  const ps = JSON.parse(S['pc-check'].ps), h = await helperSide('pc-check');
  const byId = (x) => ({ ...x, devices: [...(x.devices || [])].sort((p, q) => String(p.id).localeCompare(String(q.id))) });
  check(same(byId(ps), byId(h)), `pc-check: the same facts from both (${firstDiff(byId(ps), byId(h))})`);
  const now = Date.parse('2026-10-26T12:00:00Z');
  const ra = pcCheck.runChecks(ps, now), rb = pcCheck.runChecks(h, now);
  check(same(ra, rb) && ra.length >= 5, `pc-check: the same check results from both (${firstDiff(ra, rb)})`);
}
{
  const a = JSON.parse(S.sensors.ps), b = await helperSide('sensors');
  check(same(a, b), `sensors: the same reading from both (${firstDiff(a, b)})`);
  const d = (s) => sensors.decide({ kmt: s.gpus, zones: s.zones, cpu: s.cpu });
  check(same(d(a), d(b)) && d(a).readings.length > 0, 'sensors: the same temperatures card from both');
}
{
  const a = eq.parseRows(S.eqapo.ps), b = (await helperSide('eqapo', { list: S.eqapo.list })).map((r) => ({ ...r, name: r.name || '' }));
  check(same(a, b) && a.length === S.eqapo.list.length, `eqapo: the same rows from both (${firstDiff(a, b)})`);
  check(same(eq.fromRows(a), eq.fromRows(b)), 'eqapo: the same Equalizer APO status from both');
  check(same(eq.fromRows([{ flow: 'Render', guid: '{x}', state: '1', on: false, name: 'Speakers' }, { flow: 'Capture', guid: '{y}', state: '4', on: false, name: 'Old' }]), { checked: 1, off: [{ flow: 'playback', name: 'Speakers' }] }), 'eqapo: only active devices (state 1) count, as before');
}

{
  // pawnio: the script's line and the helper's answer for the same PC (PawnIO 2.2 installed, its driver registered)
  const nat = fakeNative('{"ok":true,"result":{"app":true,"version":"2.2.0.0","service":true}}');
  const h = await reads.viaHelper('pawnio', {}, 5000, nat);
  check(same(boardLights.parsePawnio('True|2.2.0.0|True'), h.result), 'pawnio: the same answer from both');
  check(same(boardLights.parsePawnio('False||False'), { app: false, version: null, service: false }), 'pawnio: not installed reads as before');
}
{
  // procs: tasklist's CSV and the helper's names for the same moment, with a maker's app among them
  const csv = [
    '"System Idle Process","0","Services","0","8 K"',
    '"System","4","Services","0","144 K"',
    '"lghub.exe","4120","Console","1","60,112 K"',
    '"lghub_agent.exe","4188","Console","1","30,500 K"',
    '"lghub_updater.exe","4200","Services","0","9,000 K"',
    '"node.exe","6956","Console","1","80,000 K"',
    '"node.exe","7000","Console","1","70,000 K"',
  ].join(String.fromCharCode(13, 10)) + String.fromCharCode(13, 10);
  const nat = fakeNative(JSON.stringify({ ok: true, result: ['System Idle Process', 'System', 'lghub.exe', 'lghub_agent.exe', 'lghub_updater.exe', 'node.exe'] }));
  const names = (await reads.viaHelper('procs', {}, 5000, nat)).result;
  const a = diag.runningMakers(diag.parseTasklist(csv)), b = diag.runningMakers(names);
  check(same(a, b) && a.length === 1 && a[0].key === 'ghub' && !a[0].closable.includes('lghub_updater.exe'), `procs: the same makers' apps from both (${firstDiff(a, b)})`);
  check(same(diag.parseTasklist(csv), names), 'procs: the same image names, each once, from both');
}
{
  // running: the iCUE check (hs80-direct.js) asks only for iCUE and reads a true / false
  const nat = fakeNative('{"ok":true,"result":{"iCUE":true}}');
  const r = await reads.viaHelper('running', { names: ['iCUE'] }, 5000, nat);
  check(r.result.iCUE === true && same(nat.asked[0].cmd, { names: ['iCUE'], op: 'running' }), 'running: asked for iCUE by name, answered true / false');
  const src = fs.readFileSync(path.join(H, 'hs80-direct.js'), 'utf8');
  check(src.includes("execFile('tasklist', ['/FI', 'IMAGENAME eq iCUE.exe', '/NH']") && src.includes('ps: icueTasklist'), 'hs80-direct.js keeps its tasklist as the fallback');
}

{
  const a = stdBattery.parseBt(JSON.parse(S['std-battery-bt'].ps)), b = stdBattery.parseBt(await helperSide('std-battery-bt'));
  check(same(a, b) && a.length > 0 && a.every((d) => /Z$/.test(d.lastConnected || 'Z')), `std-battery-bt: the same Bluetooth batteries from both (${firstDiff(a, b)})`);
  check(same(JSON.parse(S['std-battery-bt'].ps), JSON.parse(S['std-battery-bt'].helper).result), 'std-battery-bt: the same raw list, last connection to the microsecond');
  const src = fs.readFileSync(path.join(H, 'std-battery.js'), 'utf8');
  check(src.includes("kind === 'bt' ? require('./helper-reads').read('std-battery-bt'") && src.includes(': run(kind))'), 'std-battery.js: only -Mode bt goes to the helper; -Mode hid (it opens HID collections) stays on the script');
}
{
  // the tray (helpers/native/tray.cs): a single left click opens DeviceHub like a double-click, once per press
  const tray = fs.readFileSync(path.join(H, 'native', 'tray.cs'), 'utf8');
  check(tray.includes('icon.MouseClick += (a, b) => { if (b.Button == MouseButtons.Left) OpenApp(); };') && tray.includes('icon.DoubleClick += (a, b) => OpenApp();'), 'tray: a left click and a double-click both open DeviceHub');
  check(tray.includes('if ((DateTime.UtcNow - lastOpen).TotalMilliseconds < 2000) return;') && tray.includes('DeviceHub.vbs'), 'tray: a double-click (which also fires the click) opens it once, through DeviceHub.vbs');
}

// ---- 2. the fallback ----
{
  const ps = async () => 'from PowerShell';
  for (const [why, answer] of [['no helper (GONE)', 'GONE'], ['no answer in time', 'TIMEOUT'], ['an older helper without the channel', 'ERR unknown channel'],
    ['an older helper without the op', '{"ok":false,"error":"unknown pc op bluetooth"}'], ['a read that failed in the helper', '{"ok":false,"error":"Access denied"}'], ['a reply with no result', '{"ok":true}']]) {
    const logs = [];
    let calls = 0;
    const r = await reads.read('fallback-test', { ps: async () => { calls++; return ps(); }, helper: (op, extra, ms) => reads.viaHelper(op, extra, ms, fakeNative(answer)), log: (l) => logs.push(l) });
    check(r === 'from PowerShell' && calls === 1, `fallback: ${why} reads with PowerShell`);
  }
  {
    const logs = [];
    let calls = 0;
    const r = await reads.read('success-test', { ps: async () => { calls++; return 'ps'; }, helper: (op, extra, ms) => reads.viaHelper(op, extra, ms, fakeNative('{"ok":true,"result":[1,2]}')), log: (l) => logs.push(l) });
    check(same(r, [1, 2]) && calls === 0 && logs.length === 0, 'a helper answer is used and PowerShell does not start');
  }
  {
    const logs = [];
    for (let i = 0; i < 3; i++) await reads.read('log-once-test', { ps: async () => 1, helper: async () => ({ fail: 'GONE' }), log: (l) => logs.push(l) });
    check(logs.length === 1 && /log-once-test: the helper did not answer \(GONE\); read with PowerShell/.test(logs[0]), 'the fallback is logged once per read, in one line');
    check(reads.stats()['log-once-test']?.powershell === 3, 'the fallbacks are counted');
  }
  {
    const was = process.env.DEVICEHUB_HELPER_READS;
    process.env.DEVICEHUB_HELPER_READS = '0';
    const nat = fakeNative('{"ok":true,"result":1}');
    const r = await reads.viaHelper('bluetooth', {}, 1000, nat);
    if (was === undefined) delete process.env.DEVICEHUB_HELPER_READS; else process.env.DEVICEHUB_HELPER_READS = was;
    check(r.fail && nat.asked.length === 0, 'DEVICEHUB_HELPER_READS=0: the helper is not asked (PowerShell only)');
  }
  {
    // a helper that is not running is never started by a read (a test or a script reading the PC starts none)
    const nat = { ...fakeNative('{"ok":true,"result":1}'), running: () => false };
    const logs = [];
    const r = await reads.read('not-running-test', { ps: async () => 'ps', helper: (op, extra, ms) => reads.viaHelper(op, extra, ms, nat), log: (l) => logs.push(l) });
    check(r === 'ps' && nat.asked.length === 0 && logs.length === 0, 'a helper that is not running is not asked (nor started), and that is not logged');
    const native = fs.readFileSync(path.join(H, 'native.js'), 'utf8');
    check(/const running = \(\) => !!\(proc && proc\.stdin\.writable\);/.test(native) && /callCounts, running, buildHelper/.test(native), 'native.js says whether the helper is running');
  }
  {
    let thrown = 0;
    const r = await reads.read('throw-test', { ps: async () => 'ps', helper: async () => { thrown++; throw new Error('boom'); }, log: () => {} });
    check(r === 'ps' && thrown === 1, 'a helper call that throws falls back too');
  }
}

// ---- 3. every op asked for is answered by pc-reads.cs, and built in ----
{
  const cs = fs.readFileSync(path.join(H, 'pc-reads.cs'), 'utf8');
  const answered = new Set([...cs.matchAll(/case "([a-z-]+)":/g)].map((m) => m[1]));
  const callers = { 'pc-map.js': ['pc-map', 'bluetooth'], 'display.js': ['display-read'], 'pc-sensors.js': ['sensors'], 'installers.mjs': ['installed'], 'pc-check.js': ['pc-check'], 'eqapo-devices.js': ['eqapo'], 'hs80-direct.js': ['running'], 'board-lights.mjs': ['pawnio'], 'diagnose.mjs': ['procs'], 'std-battery.js': ['std-battery-bt'] };
  for (const [file, ops] of Object.entries(callers)) {
    const src = fs.readFileSync(path.join(H, file), 'utf8');
    for (const op of ops) {
      check(answered.has(op), `pc-reads.cs answers ${op}`);
      check(new RegExp(`helper-reads(\\.js)?'\\)\\.read\\('${op}'`).test(src), `${file} reads ${op} through helpers/helper-reads.js (helper first, PowerShell as the fallback)`);
    }
  }
  const helper = fs.readFileSync(path.join(H, 'native', 'helper.cs'), 'utf8');
  check(/if \(c\.Name == "pc" \|\| c\.Name\.StartsWith\("pc:"\)\) return PcOp\(rest\);/.test(helper) && /PcReads\.Op\(/.test(helper), 'helper.cs sends the pc:<op> channels to PcReads.Op');
  const ps1 = fs.readFileSync(path.join(H, 'native', 'build.ps1'), 'utf8');
  check(/'pc-native\.cs', 'pc-reads\.cs'/.test(ps1) && /\/r:System\.Management\.dll/.test(ps1), 'build.ps1 compiles pc-native.cs and pc-reads.cs with System.Management');
  const hs = require('../helpers/helper-sources.js');
  check(hs.SOURCE_FILES.includes('pc-reads.cs') && hs.SOURCE_FILES.includes('pc-native.cs') && hs.EXE_NAME === 'DeviceHubHelper.exe', 'helper-sources.js lists them, and the helper is still the one exe');
  check(!/\/out:(?!\$Out)/.test(ps1) && (ps1.match(/\/target:exe/g) || []).length === 1, 'build.ps1 still builds one exe and nothing else');
}

// ---- 4. reads only ----
{
  const cs = fs.readFileSync(path.join(H, 'pc-reads.cs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const [what, re] of [['a registry write', /\.(SetValue|CreateSubKey|DeleteValue|DeleteSubKey\w*)\(/], ['a display change', /ChangeDisplaySettings|SetMode\(|SetPrimary\(|SetHdr\(|SetColorState/],
    ['a device open', /CreateFile|HidD_|SetupDiOpen|DeviceIoControl/], ['a power plan change', /PowerSetActiveScheme|PowerWrite/], ['a WMI write', /\.Put\(|\.Delete\(/]]) check(!re.test(cs), `pc-reads.cs has no ${what}`);
  const invoked = [...cs.matchAll(/InvokeMethod\("([A-Za-z]+)"/g)].map((m) => m[1]);
  check(invoked.length === 1 && invoked[0] === 'GetStorageReliabilityCounter', `the only WMI method pc-reads.cs calls is the drive reliability read (${invoked.join(', ')})`);
  const progs = [...cs.matchAll(/Run\((nv|netsh), "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  check(progs.length >= 5 && progs.every((p) => /^nv (--query-gpu=driver_version --format=csv,noheader|-q -d MEMORY)$|^netsh wlan show (interfaces|autoconfig|drivers|networks mode=bssid)$/.test(p)), `the programs it runs are the script's read-only nvidia-smi and netsh queries (${progs.join('; ')})`);
  // display.js: only 'read' may go to the helper; every change stays on display.ps1
  check(typeof display.runAny === 'function' && /if \(op !== 'read'\) return runPs\(op, values\);/.test(fs.readFileSync(path.join(H, 'display.js'), 'utf8')), 'display.js: mode, hdr and primary still go to helpers/display.ps1');
}

console.log(fails.length ? `helper-reads: FAILED (${fails.length} of ${n}):\n- ${fails.join('\n- ')}` : `helper-reads (${n} checks: both paths parse the same on recorded samples, fallback to PowerShell, ops built in, reads only): all good`);
process.exit(fails.length ? 1 : 0);
