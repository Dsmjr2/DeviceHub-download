// Start-up apps on the PC page (27 Oct 2026, helpers/startup-apps.js): the StartupApproved bytes read as on/off, what
// Task Manager writes to turn one off or on, an HKCU app changed with the person's own rights, an HKLM app through one
// Windows prompt, the key backed up before any write and read back after, and nothing ever deleted. Stand-ins for the
// registry read, reg.exe and the elevation: nothing on this PC is read or written. Run: node tests/startup-apps.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const sa = require('../helpers/startup-apps.js');
const { deps, stateOf, bytesFor, fromRead, adminScript, reset } = sa._test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-startup-apps-'));
deps.root = root;
const NOW = new Date('2026-10-27T12:00:00Z');
deps.now = () => NOW;
const records = [];
deps.record = (e) => { records.push(e); };
let measured = null;
deps.measured = () => measured;

// ---- the bytes ----
check(stateOf('020000000000000000000000').on === true, '02 = on');
check(stateOf('060000000000000000000000').on === true, '06 = on (Windows Security)');
check(stateOf(null).on === true && stateOf('').on === true, 'no value = on');
const off = stateOf('03000000a72fa8a57a5fdd01');
check(off.on === false && /^20\d\d-/.test(off.offSince || ''), '03 = off, with the time it was turned off');
check(stateOf('030000000000000000000000').on === false && stateOf('030000000000000000000000').offSince === null, '03 with no time = off, no date');
check(bytesFor(true) === '02' + '00'.repeat(11), 'on writes 02 and zeros');
const offHex = bytesFor(false, NOW);
check(offHex.length === 24 && offHex.startsWith('03000000') && stateOf(offHex).offSince === NOW.toISOString(), 'off writes 03 and the time now as a FILETIME');

// ---- the list ----
const item = (o) => ({ scope: 'HKCU', key: 'Run', name: 'OneDrive', command: '"C:\\x\\OneDrive.exe" /background', target: 'C:\\x\\OneDrive.exe', args: '', found: true, publisher: 'Microsoft Corporation', description: 'Microsoft OneDrive', approved: '020000000000000000000000', ...o });
let reg = {
  items: [
    item({}),
    item({ name: 'Edge', target: 'C:\\x\\msedge.exe', description: 'Microsoft Edge', approved: '03000000a72fa8a57a5fdd01' }),
    item({ scope: 'HKLM', name: 'SecurityHealth', target: 'C:\\WINDOWS\\system32\\SecurityHealthSystray.exe', description: 'Windows Security notification icon', approved: '060000000000000000000000' }),
    item({ key: 'StartupFolder', name: 'DeviceHub.lnk', target: 'C:\\Windows\\System32\\wscript.exe', args: `"${root}\\DeviceHub.vbs" /background`, publisher: 'Microsoft Corporation', description: 'Microsoft Windows Based Script Host', approved: null }),
    item({ key: 'StartupFolder', name: 'iCUE Launcher - Shortcut.lnk', target: 'C:\\gone\\iCUE Launcher.exe', found: false, publisher: '', description: '', approved: '03000000a884fd686188dc01' }),
    item({ scope: 'HKXX', name: 'bad' }),
  ],
  approvedKeys: { 'HKCU|Run': true, 'HKCU|Run32': false, 'HKCU|StartupFolder': true, 'HKLM|Run': true, 'HKLM|Run32': true, 'HKLM|StartupFolder': true },
  impact: { readable: false, why: 'Attempted to perform an unauthorized operation.', apps: [] },
};
let l = fromRead(reg, NOW);
check(l.total === 5 && l.on === 3, `five apps, three on (${l.on} of ${l.total})`);
const by = (n) => l.apps.find((a) => a.name === n);
check(by('Microsoft OneDrive')?.publisher === 'Microsoft Corporation', 'name and maker from the program');
const self = by('DeviceHub');
check(self && self.self === true && self.publisher === '', "DeviceHub's own entry is named and marked, not 'Microsoft'");
check(by('iCUE Launcher - Shortcut')?.publisher === 'Program not found', 'a shortcut to a removed program says so');
check(by('Windows Security notification icon')?.admin === true, 'an HKLM app is marked as needing admin');
check(l.apps.every((a) => a.impact === '—') && /next sign-in/.test(l.impact.note), 'nothing measured yet: every impact is "—", one line says when it will be');
const readable = fromRead({ ...reg, impact: { readable: true, apps: [{ file: 'OneDrive.exe', degradeMs: 4200 }, { file: 'msedge.exe', degradeMs: 1200 }, { file: 'SecurityHealthSystray.exe', degradeMs: 300 }] } }, NOW);
const ri = (n) => readable.apps.find((a) => a.name === n).impact;
check(ri('Microsoft OneDrive') === 'High' && ri('Microsoft Edge') === 'Medium' && ri('Windows Security notification icon') === 'Low' && ri('DeviceHub') === 'Not measured' && readable.impact.note === null, 'readable timing: High / Medium / Low only for an app Windows named, else Not measured');

// ---- DeviceHub's own sign-in measurement (helpers/startup-impact.js) wins over Windows' timing ----
measured = { signIn: '2026-10-27T11:00:00.000Z', at: '2026-10-27T11:02:30.000Z', procs: [
  { name: 'OneDrive.exe', path: 'C:\\x\\OneDrive.exe', cmd: '', pid: 40, startS: 12, cpuMs: 200, ioKB: 100 },
  { name: 'OneDrive.Sync.Service.exe', path: 'C:\\x\\OneDrive.Sync.Service.exe', cmd: '', pid: 41, ppid: 40, startS: 14, cpuMs: 700, ioKB: 3900 },
  { name: 'older.exe', path: 'C:\\x\\older.exe', cmd: '', pid: 42, ppid: 40, startS: 2, cpuMs: 9000, ioKB: 9000 },
  { name: 'SecurityHealthSystray.exe', path: '', cmd: '', cpuMs: 20, ioKB: 10 },
  { name: 'wscript.exe', path: 'C:\\Windows\\System32\\wscript.exe', cmd: `wscript.exe "${root}\\DeviceHub.vbs" /background`, cpuMs: 100, ioKB: 50 },
  { name: 'node.exe', path: 'C:\\Program Files\\nodejs\\node.exe', cmd: `node "${root}\\server.js"`, cpuMs: 400, ioKB: 200 },
  { name: 'wscript.exe', path: 'C:\\Windows\\System32\\wscript.exe', cmd: 'wscript.exe "C:\\other\\thing.vbs"', cpuMs: 5000, ioKB: 9000 },
] };
const m = fromRead(reg, NOW);
const mi = (n) => m.apps.find((a) => a.name === n).impact;
check(mi('Microsoft OneDrive') === 'High', 'measured: with the program it started, 4 MB of disk = High (Task Manager: over 3 MB); an older process with a reused id not counted');
check(require('../helpers/startup-impact.js').impactFor({ target: 'C:\\x\\OneDrive.exe' }, measured, root).cpuMs === 900, 'measured: the child counted once (200 + 700 ms)');
check(mi('Windows Security notification icon') === 'Low', 'measured: an admin program with no path is matched by its name');
check(mi('DeviceHub') === 'Medium', "measured: DeviceHub's own programs summed (500 ms = Medium), another script's wscript not counted");
check(mi('Microsoft Edge') === 'Not measured', 'measured: an app none of whose programs ran = Not measured');
check(m.impact.readable === true && m.impact.measuredAt === measured.signIn && m.impact.note === null, 'measured: the sign-in it was measured at is given');
const si = require('../helpers/startup-impact.js');
const { level } = si._test;
check(level(1001, 0) === 'High' && level(0, 3073) === 'High' && level(300, 0) === 'Medium' && level(0, 300) === 'Medium' && level(299, 299) === 'Low', "Microsoft's levels: 1 s / 3 MB High, 300 ms / 300 KB Medium");
// the measurement file: late starts write nothing; each sign-in is kept once; the last 5 only
si._test.deps.root = root;
si._test.deps.read = async () => ({ late: true, signIn: '2026-10-27T08:00:00Z' });
check(await si.measureAtSignIn() === null && si.latest() === null, 'started long after sign-in: nothing measured or written');
for (let d = 1; d <= 7; d++) {
  si._test.deps.read = async () => ({ signIn: `2026-10-0${d}T08:00:00.000Z`, at: `2026-10-0${d}T08:02:30.000Z`, procs: [{ name: 'a.exe', path: 'C:\\a.exe', cmd: '', cpuMs: d, ioKB: 1 }] });
  await si.measureAtSignIn();
}
await si.measureAtSignIn();
const kept = JSON.parse(fs.readFileSync(path.join(root, 'data', 'startup-impact.json'), 'utf8')).runs;
check(kept.length === 5 && si.latest().signIn === '2026-10-07T08:00:00.000Z' && kept.filter((r) => r.signIn.startsWith('2026-10-07')).length === 1, 'the newest 5 sign-ins kept, each once');

// ---- the cache: one read for two page opens ----
let reads = 0;
const calls = [], scripts = [];
deps.read = async () => { reads++; return JSON.parse(JSON.stringify(reg)); };
deps.run = async (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === 'export') fs.writeFileSync(args[2], 'Windows Registry Editor Version 5.00\r\n');
  if (args[0] === 'add') { const it = reg.items.find((x) => x.scope === 'HKCU' && args[1].endsWith(`\\${x.key}`) && x.name === args[3]); if (it) it.approved = args[7]; }
  return { code: 0, out: '' };
};
reset();
await sa.list(); await sa.list();
check(reads === 1, 'the list is read once, then kept');

// ---- HKCU: OneDrive off, with the person's own rights ----
let r = await sa.set('HKCU|Run|OneDrive', false);
check(r.ok === true && /off at start-up/.test(r.text), `OneDrive turned off (${r.text})`);
const exp = calls.findIndex((c) => c[1] === 'export'), add = calls.findIndex((c) => c[1] === 'add');
check(exp >= 0 && add > exp, 'the key is backed up before the write');
check(calls[exp][2] === 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', 'the backup is the StartupApproved key');
check(r.backup && fs.existsSync(path.join(root, 'backups', r.backup)), 'the backup file is in backups\\');
check(calls[add].join(' ').includes('/t REG_BINARY /d ' + offHex) && calls[add][4] === 'OneDrive', 'writes 03 + now to that one value');
check(scripts.length === 0, 'HKCU asks Windows for nothing');
check(r.apps.apps.find((a) => a.id === 'HKCU|Run|OneDrive').on === false, 'read back: off');
// on again
calls.length = 0;
r = await sa.set('HKCU|Run|OneDrive', true);
check(r.ok && calls.find((c) => c[1] === 'add')?.includes('02' + '00'.repeat(11)), 'on again writes 02 + zeros');
// already that way: nothing written
calls.length = 0;
r = await sa.set('HKCU|Run|OneDrive', true);
check(r.ok && calls.length === 0, 'already on: nothing written, no backup');
// a write that does not read back is not called done
deps.run = async (cmd, args) => { calls.push([cmd, ...args]); if (args[0] === 'export') fs.writeFileSync(args[2], 'x'); return { code: 0, out: '' }; };
r = await sa.set('HKCU|Run|OneDrive', false);
check(r.ok === false && /did not read back/.test(r.text), 'a value that did not read back says so');
// a backup that was not written stops the change
let wrote = false;
deps.run = async (cmd, args) => { if (args[0] === 'add') wrote = true; return { code: 1, out: 'denied' }; };
let threw = null;
try { await sa.set('HKCU|Run|OneDrive', false); } catch (e) { threw = e.message; }
check(/backup was not written/.test(threw || '') && !wrote, 'no backup, no write');
// an id that is not in the list is refused
threw = null;
try { await sa.set('HKCU|Run|Something else', false); } catch (e) { threw = e.message; }
check(/not in the start-up list/.test(threw || ''), 'only an app in the list can be changed');
deps.run = async (cmd, args) => { calls.push([cmd, ...args]); if (args[0] === 'export') fs.writeFileSync(args[2], 'x'); return { code: 0, out: '' }; };

// ---- HKLM: one Windows prompt; Yes ----
calls.length = 0;
deps.elevate = async (script) => {
  scripts.push(script);
  const m = /Set-Content -LiteralPath '([^']+)'/.exec(script);
  fs.writeFileSync(m[1], 'started');
  reg.items.find((x) => x.name === 'SecurityHealth').approved = offHex;
  return { code: 0 };
};
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === true && scripts.length === 1, 'HKLM asks Windows once and is read back');
check(calls.some((c) => c[1] === 'export' && c[2].startsWith('HKLM\\')) && !calls.some((c) => c[1] === 'add'), 'HKLM: backed up first, written only by the admin script');
check(records.at(-1)?.outcome === 'yes' && /turn Windows Security notification icon off/.test(records.at(-1)?.action), 'the prompt is recorded (uac-prompts.log)');
const s = scripts[0];
check(/New-ItemProperty -LiteralPath \$k -Name \$n -PropertyType Binary/.test(s) && s.includes("'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'"), 'the admin script writes only that StartupApproved value');
check(!s.includes('SecurityHealth'), 'the name travels as base64, never as code');
// declined: nothing changed, recorded
reg.items.find((x) => x.name === 'SecurityHealth').approved = '060000000000000000000000';
deps.elevate = async () => ({ error: 'The operation was canceled by the user.', declined: true });
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === false && r.uac === 'declined' && records.at(-1)?.outcome === 'declined', 'declined: nothing changed, recorded');
// unanswered within the wait: the late Yes does nothing
deps.uacWaitMs = 30;
deps.elevate = (script, signal) => new Promise((resolve) => { signal.addEventListener('abort', () => resolve({ error: 'aborted' })); });
r = await sa.set('HKLM|Run|SecurityHealth', false);
check(r.ok === false && r.uac === 'unanswered' && records.at(-1)?.outcome === 'unanswered', 'not answered in time: stopped, recorded');
const sc = adminScript('Run', 'x', offHex, { started: 'C:\\s.txt', cancel: 'C:\\c.txt' });
check(sc.indexOf("Test-Path -LiteralPath 'C:\\c.txt'") < sc.indexOf('New-ItemProperty'), 'a cancelled prompt exits before any write');

// ---- on and off never delete, never tasks or services ----
const src = fs.readFileSync(path.join(here, '..', 'helpers', 'startup-apps.js'), 'utf8');
const ps1 = fs.readFileSync(path.join(here, '..', 'helpers', 'startup-apps-read.ps1'), 'utf8');
check(calls.every((c) => c[0] === 'reg.exe' && ['export', 'add'].includes(c[1])), 'on and off: reg.exe only exports and adds');
check(scripts.concat(sc).every((x) => !/Remove-Item|Remove-ItemProperty|reg(\.exe)? delete|schtasks|Set-Service|Stop-Service/i.test(x)), 'on and off: the admin script never deletes, never touches tasks or services');
check(!/schtasks|Register-ScheduledTask|Set-Service|unlinkSync|rmSync\(it|Remove-Item -/i.test(src), 'the module never touches tasks or services and never deletes a file');

// ---- removing a leftover (28 Oct 2026): only one whose program is gone, or the old Teams uninstaller ----
deps.uacWaitMs = 60000;
reg.items.push(
  item({ name: 'Pulsar', target: 'C:\\Program Files\\Pulsar\\Pulsar.exe', found: false, publisher: '', description: '', approved: '03000000a72fa8a57a5fdd01' }),
  item({ scope: 'HKLM', key: 'Run32', name: 'TeamsMachineUninstallerLocalAppData', command: 'C:\\x\\Teams\\Update.exe --uninstall', target: 'C:\\x\\Teams\\Update.exe', found: true, description: 'Microsoft Teams', approved: '030000000000000000000000' }));
// the Startup folder is outside DeviceHub (a path inside it would be DeviceHub's own entry)
const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-startup-folder-'));
fs.writeFileSync(path.join(startupDir, 'iCUE Launcher - Shortcut.lnk'), 'shortcut');
reg.items.find((x) => x.name === 'iCUE Launcher - Shortcut.lnk').command = path.join(startupDir, 'iCUE Launcher - Shortcut.lnk');
l = fromRead(reg, NOW);
const rm = (n) => l.apps.find((a) => a.name === n)?.removable;
check(rm('Pulsar') === true && rm('iCUE Launcher - Shortcut') === true && rm('Microsoft Teams') === true, 'a program that is gone, or the Teams uninstaller: removable');
check(rm('Microsoft OneDrive') === false && rm('DeviceHub') === false && rm('Windows Security notification icon') === false, 'an app that is there, and DeviceHub itself: not removable');
calls.length = 0;
deps.run = async (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === 'export') fs.writeFileSync(args[2], 'Windows Registry Editor Version 5.00\r\n');
  if (args[0] === 'delete' && args[1].endsWith('\\CurrentVersion\\Run')) reg.items = reg.items.filter((x) => !(x.scope === 'HKCU' && x.key === 'Run' && x.name === args[3]));
  return { code: 0, out: '' };
};
r = await sa.remove('HKCU|Run|Pulsar');
const firstDel = calls.findIndex((c) => c[1] === 'delete'), lastExp = calls.map((c) => c[1]).lastIndexOf('export');
check(r.ok === true && /removed/.test(r.text) && !r.apps.apps.some((a) => a.name === 'Pulsar'), `Pulsar removed and read back gone (${r.text})`);
check(lastExp >= 0 && firstDel > lastExp && calls.filter((c) => c[1] === 'export').length === 2, 'both keys (Run and StartupApproved) backed up before any delete');
check(calls.filter((c) => c[1] === 'delete').every((c) => c[4] === 'Pulsar' && c[5] === '/f') && calls.some((c) => c[1] === 'delete' && /StartupApproved\\Run$/.test(c[2])), 'only the Pulsar values are deleted');
// a Startup folder shortcut is moved into backups, not deleted
deps.read = async () => { const j = JSON.parse(JSON.stringify(reg)); j.items = j.items.filter((x) => x.key !== 'StartupFolder' || fs.existsSync(x.command)); return j; };
r = await sa.remove('HKCU|StartupFolder|iCUE Launcher - Shortcut.lnk');
check(r.ok === true && !fs.existsSync(path.join(startupDir, 'iCUE Launcher - Shortcut.lnk')) && fs.readdirSync(path.join(root, 'backups')).some((d) => d.startsWith('startup-removed-') && fs.existsSync(path.join(root, 'backups', d, 'iCUE Launcher - Shortcut.lnk'))), 'a leftover shortcut is moved into backups\\, not deleted');
// an app that is there is refused
threw = null;
try { await sa.remove('HKCU|Run|OneDrive'); } catch (e) { threw = e.message; }
check(/not a leftover/.test(threw || '') && reg.items.some((x) => x.name === 'OneDrive'), 'an app that is there cannot be removed');
// HKLM: one prompt; the script removes only that value, the name as base64
scripts.length = 0;
deps.elevate = async (script) => { scripts.push(script); fs.writeFileSync(/Set-Content -LiteralPath '([^']+)'/.exec(script)[1], 'started'); reg.items = reg.items.filter((x) => x.name !== 'TeamsMachineUninstallerLocalAppData'); return { code: 0 }; };
r = await sa.remove('HKLM|Run32|TeamsMachineUninstallerLocalAppData');
check(r.ok === true && scripts.length === 1 && /remove Microsoft Teams from start-up/.test(records.at(-1)?.action), 'Teams uninstaller removed through one Windows prompt, recorded');
check(scripts[0].includes("'Registry::HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'") && !scripts[0].includes('TeamsMachine') && scripts[0].indexOf('Test-Path') < scripts[0].indexOf('Remove-ItemProperty'), 'the admin script: only that Run32 value, name as base64, cancel checked first');
check(!/Set-Item|New-Item|Remove-Item|reg\.exe|Set-Content|Out-File/i.test(ps1), 'the read script only reads');
try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(here, '..', 'helpers', 'startup-apps-read.ps1')}', [ref]$null, [ref]$e); $e.Count`], { windowsHide: true, timeout: 30000 }).toString().trim();
  check(out === '0', `the read script parses (${out} errors)`);
} catch (e) { check(false, `PowerShell parse check did not run: ${e.message}`); }

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(startupDir, { recursive: true, force: true });
console.log(fails.length ? `startup-apps: FAILED: ${fails.join('; ')}` : 'startup-apps (Start-up apps on the PC page): all good');
process.exit(fails.length ? 1 : 0);
