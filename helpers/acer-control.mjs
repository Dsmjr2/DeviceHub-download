// Acer laptop: exact sensors, fan mode and the battery charge limit (3 Nov 2026, Shawn: "a fan speed controller like the
// nitro app and max charge while plugged in"; and the PC page's temperatures "as quick and accurate" as NitroSense).
// Acer's WMI (AcerGamingFunction, BatteryControl) answers a standard user "Access denied", so this follows Add board,
// fan and RAM lights and Pause Wi-Fi scans (helpers/board-lights.mjs, helpers/wifi-pause.mjs): nothing runs until the
// person's click, ONE Windows admin prompt, a hash-pinned script, every step undone on failure, Remove takes it all away.
//
// Set up (POST /api/acer/setup): the prompt runs a script built here (setupScript, never a file) that copies
// helpers/acer-control.ps1 (pinned by SCRIPT_SHA256; refused before the prompt if it changed) into
// C:\Program Files\DeviceHub Acer\ (only administrators change files there), checks its SHA-256 there, and registers
// five tasks for this user (S4U: no password stored, no window), highest rights, each with ONE fixed mode in its
// arguments (nothing a standard user can change), none started by itself except the sign-in one:
//   "DeviceHub Acer read"              -Mode read: sensors, fan modes, charge limit to readings.json each second while
//                                      DeviceHub touches the want file (the PC or Laptop page open); 20 s after: ends
//   "DeviceHub Acer fans auto"         -Mode fans-auto; also at every sign-in (the fans are never left on Max)
//   "DeviceHub Acer fans max"          -Mode fans-max; watches, and goes back to Auto when DeviceHub stops answering
//   "DeviceHub Acer charge limit on"   -Mode health-on
//   "DeviceHub Acer charge limit off"  -Mode health-off
// Reads need no click after setup; each write is the person's click (Laptop page), refused while NitroSense is open,
// read first, one write, read back (the script's result.json). DeviceHub quitting or starting with the fans on Max
// sets them back to Auto. The calls and their sources are listed at the top of helpers/acer-control.ps1.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { declinedText, unansweredText } from './uac.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PF = process.env.ProgramFiles || 'C:\\Program Files';
export const SOURCE = path.join(ROOT, 'helpers', 'acer-control.ps1');
export const SCRIPT_SHA256 = 'bec2812ddfd2d787cbe1c14807e2164dd6fe6d19effd7407bb76b53867a2d031';
export const ACER = {
  dir: path.join(PF, 'DeviceHub Acer'),
  script: path.join(PF, 'DeviceHub Acer', 'acer-control.ps1'),
  readings: path.join(PF, 'DeviceHub Acer', 'readings.json'),
  result: path.join(PF, 'DeviceHub Acer', 'result.json'),
  want: path.join(os.tmpdir(), 'DeviceHub-acer-want.txt'),
  tasks: { read: 'DeviceHub Acer read', 'fans-auto': 'DeviceHub Acer fans auto', 'fans-max': 'DeviceHub Acer fans max', 'health-on': 'DeviceHub Acer charge limit on', 'health-off': 'DeviceHub Acer charge limit off' },
};
export const MODES = Object.freeze(Object.keys(ACER.tasks));
export const DIR = path.join(os.tmpdir(), 'DeviceHub-downloads');
export const RESULT = path.join(DIR, 'acer-setup-result.txt');
const FRESH_MS = 5000;
const user = () => `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const taskArgs = (mode, { sha = SCRIPT_SHA256, want = ACER.want } = {}) => {
  if (!MODES.includes(mode)) throw new Error(`not an Acer mode: ${mode}`);
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('not a SHA-256');
  return `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ACER.script}" -Mode ${mode}${mode === 'read' ? ` -Want "${want}"` : ''}`;
};
const head = (result) => [
  "$ErrorActionPreference = 'Stop'",
  `$dest = ${q(ACER.dir)}; $script = ${q(ACER.script)}; $result = ${q(result)}`,
  `$names = @(${MODES.map((m) => q(ACER.tasks[m])).join(', ')})`,
  'function Drop-Tasks { foreach ($t in $names) { if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -Confirm:$false } } }',
];
export function setupScript({ who = user(), result = RESULT, source = SOURCE, sha = SCRIPT_SHA256, want = ACER.want } = {}) {
  const limits = { read: 'New-TimeSpan -Hours 12', 'fans-max': 'New-TimeSpan -Hours 4 -Minutes 15' };
  return [
    ...head(result),
    `$user = ${q(who)}; $src = ${q(source)}; $sha = ${q(sha)}`,
    'try {',
    '  Drop-Tasks',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    '  New-Item -ItemType Directory -Force -Path $dest | Out-Null',
    '  Copy-Item -LiteralPath $src -Destination $script -Force',
    "  if ((Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'acer-control.ps1 does not match its pinned SHA-256' }",
    "  $ps = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest',
    ...MODES.map((m) => [
      `  $a = New-ScheduledTaskAction -Execute $ps -Argument ${q(taskArgs(m, { sha, want }))} -WorkingDirectory $dest`,
      `  $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (${limits[m] || 'New-TimeSpan -Minutes 5'}) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew${m === 'fans-auto' ? ' -StartWhenAvailable' : ''}`,
      m === 'fans-auto'
        ? `  Register-ScheduledTask -TaskName ${q(ACER.tasks[m])} -Description 'Sets the Acer fans back to Auto, at every sign-in and when DeviceHub asks. Made by DeviceHub on your click; Remove in DeviceHub deletes it.' -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Principal $pr -Settings $s | Out-Null`
        : `  Register-ScheduledTask -TaskName ${q(ACER.tasks[m])} -Description 'Acer sensors, fan mode or charge limit, run only when DeviceHub asks. Made by DeviceHub on your click; Remove in DeviceHub deletes it.' -Action $a -Principal $pr -Settings $s | Out-Null`,
    ].join('\r\n')),
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  $why = $_.Exception.Message',
    '  try { Drop-Tasks } catch {}',
    '  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue',
    '  Set-Content -LiteralPath $result -Value "failed|$why" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}
// Remove: the fans back to Auto first (the auto task, while it is still there), then every task and the folder
export function removeScript({ result = RESULT } = {}) {
  return [
    ...head(result),
    'try {',
    `  if (Get-ScheduledTask -TaskName ${q(ACER.tasks['fans-max'])} -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName ${q(ACER.tasks['fans-max'])} -ErrorAction SilentlyContinue }`,
    `  if (Get-ScheduledTask -TaskName ${q(ACER.tasks['fans-auto'])} -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName ${q(ACER.tasks['fans-auto'])}; Start-Sleep -Seconds 4 }`,
    '  Drop-Tasks',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  Set-Content -LiteralPath $result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}

// ---- the parts that touch Windows, swappable for tests (tests/acer-control.mjs) ----
export const deps = {
  platform: process.platform,
  // an Acer laptop with the gaming interface: the class is there (listing classes needs no rights)
  acer: () => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', "[bool](Get-CimClass -Namespace root/WMI -ClassName AcerGamingFunction -ErrorAction SilentlyContinue)"], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(/True/.test(String(out))))),
  task: (name) => new Promise((resolve) => execFile('schtasks.exe', ['/Query', '/TN', name], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err))),
  // starts one of the five tasks; the name is one of ACER's, never from a request
  runTask: (name) => new Promise((resolve) => execFile('schtasks.exe', ['/Run', '/TN', name], { windowsHide: true, timeout: 15000 }, (err, out, errOut) => resolve(err ? { ok: false, error: String(errOut || err.message).trim().split(/\r?\n/)[0] } : { ok: true }))),
  exists: (f) => fs.existsSync(f),
  stat: (f) => { try { return fs.statSync(f); } catch { return null; } },
  readJson: (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } },
  touch: (f) => { const t = new Date(); try { fs.utimesSync(f, t, t); } catch { fs.writeFileSync(f, 'DeviceHub reads the Acer sensors while this file is touched.\r\n'); } },
  nitroOpen: () => new Promise((resolve) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (e, out) => resolve(/^"(NitroSense|PredatorSense)\.exe"/im.test(String(out || ''))))),
  sha256: async (file) => (await import('./installers.mjs')).deps.sha256(file),
  elevate: async (script, action, next, opts) => (await import('./board-lights.mjs')).elevateWatched(script, action, next, opts),
  readResult: (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } },
  clearResult: (f) => { try { fs.rmSync(f, { force: true }); } catch {} },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: () => {},
};

// ---- status (GET /api/acer) ----
let cache = { at: 0, value: null }, lastRun = 0, fansMaxByUs = false;
export async function status({ fresh = false } = {}) {
  if (!fresh && cache.value && deps.now() - cache.at < 10000) return view(cache.value);
  if (deps.platform !== 'win32') return { acer: false, setUp: false, canSetUp: false, why: 'it works on Windows only' };
  const acer = await deps.acer().catch(() => false);
  const tasks = await Promise.all(MODES.map((m) => deps.task(ACER.tasks[m]).catch(() => false)));
  const copy = deps.exists(ACER.script), all = tasks.every(Boolean), any = tasks.some(Boolean);
  const canSetUp = acer && deps.exists(SOURCE);
  cache = { at: deps.now(), value: { acer, setUp: all && copy, task: any, copy, canSetUp,
    why: !acer ? 'this PC has no Acer gaming interface' : canSetUp ? null : 'this copy of DeviceHub lacks helpers\\acer-control.ps1',
    partial: any !== all || any !== copy ? 'Part of it is left from before.' : null } };
  return view(cache.value);
}
function view(v) {
  return { ...v, busy: running(), readings: v.setUp ? readings() : null, nitroOpen: null,
    before: 'Adds the Acer fan speeds, temperatures, fan mode and charge limit. Windows asks once. Nothing changes until you press a control.',
    remove: 'Puts the fans back to Auto and removes it. Windows asks once.' };
}

// ---- reading (no prompt: the read task has the rights): the want file touched, the task started when not running ----
export function readings() {
  const r = deps.readJson(ACER.readings), st = deps.stat(ACER.readings);
  if (!r || !st) return null;
  return { ...r, fresh: deps.now() - st.mtimeMs < FRESH_MS };
}
// the PC and Laptop pages ask every second: what is set up is checked at most once a minute (five schtasks queries)
export async function read() {
  if (deps.platform !== 'win32') return null;
  if (!cache.value || deps.now() - cache.at > 60000) await status({ fresh: true });
  if (!cache.value?.setUp) return null;
  deps.touch(ACER.want);
  const r = readings();
  if (!r?.fresh && deps.now() - lastRun > 15000) { lastRun = deps.now(); await deps.runTask(ACER.tasks.read); }
  return r;
}

// ---- writes: the person's click, one at a time ----
let writing = false;
export async function write(mode) {
  if (!['fans-auto', 'fans-max', 'health-on', 'health-off'].includes(mode)) throw Object.assign(new Error('not an Acer setting'), { code: 400 });
  if (writing) throw Object.assign(new Error('Another change is still being made.'), { code: 409 });
  const s = await status({ fresh: true });
  if (!s.setUp) throw Object.assign(new Error('Set up Acer controls first.'), { code: 409 });
  if (mode !== 'fans-auto' && await deps.nitroOpen()) throw Object.assign(new Error('NitroSense is open: close it first (two programs changing the fans or battery fight).'), { code: 409 });
  writing = true;
  try {
    const before = deps.stat(ACER.result)?.mtimeMs || 0;
    const r = await deps.runTask(ACER.tasks[mode]);
    if (!r.ok) throw new Error(`not started: ${r.error}`);
    // the script writes result.json within a few seconds (read, one write, read back)
    let res = null;
    for (let i = 0; i < 40 && !res; i++) { await deps.sleep(250); const st = deps.stat(ACER.result); if (st && st.mtimeMs > before) res = deps.readJson(ACER.result); }
    if (!res) throw new Error('the laptop did not answer in 10 s');
    if (res.mode === mode && res.ok) {
      if (mode === 'fans-max') fansMaxByUs = true;
      if (mode === 'fans-auto') fansMaxByUs = false;
      deps.log(SAID[mode](res), 'good');
    } else deps.log(`Acer ${LABEL[mode]} not done: ${res.why || res.error || 'the read-back differs'}`, 'bad');
    return { ok: !!res.ok, mode, before: res.before || null, after: res.after || null, why: res.ok ? null : res.why || res.error || 'the read-back differs' };
  } finally { writing = false; }
}
const LABEL = { 'fans-auto': 'fans to Auto', 'fans-max': 'fans to Max', 'health-on': 'charge limit on', 'health-off': 'charge limit off' };
const rpm = (r) => (r?.after?.cpuFanRpm != null ? ` (CPU fan ${r.after.cpuFanRpm} RPM, GPU fan ${r.after.gpuFanRpm ?? '?'} RPM)` : '');
const SAID = {
  'fans-auto': (r) => `Acer fans: Auto${rpm(r)}`, 'fans-max': (r) => `Acer fans: Max${rpm(r)}`,
  'health-on': () => 'Acer battery charge limit on', 'health-off': () => 'Acer battery charge limit off',
};
// DeviceHub quits or starts with the fans on Max (set here, or found so): Auto
export async function onQuit() {
  if (!fansMaxByUs) return null;
  return Promise.race([deps.runTask(ACER.tasks['fans-auto']), new Promise((r) => setTimeout(() => r(null), 2000))]);
}
export async function onStart() {
  if (!deps.exists(ACER.script)) return null;
  const r = deps.readJson(ACER.result);
  if (r?.mode === 'fans-max' && r.ok) return deps.runTask(ACER.tasks['fans-auto']);
  return null;
}

// ---- setup and removal: one job at a time; GET /api/acer/progress follows it ----
let job = null;
export const getProgress = () => job;
const step = (text, pct = null, extra = {}) => { const { uac, ...rest } = job || {}; job = { ...rest, text, pct, done: false, at: Date.now(), ...extra }; };
const finish = (ok, text, extra = {}) => { job = { ...job, text, pct: null, done: true, ok, at: Date.now(), ...extra }; cache.at = 0; return job; };
const running = () => !!job && !job.done && Date.now() - (job.startedAt || job.at) < 15 * 60 * 1000;
const begin = (kind) => { if (running()) throw new Error('Acer controls are being set up or removed; wait for it to finish'); job = { kind, startedAt: Date.now(), text: 'Starting', pct: null, done: false, at: Date.now() }; };
const AREA = 'Acer controls';
export async function verifySource(file = SOURCE) {
  if (!deps.exists(file)) return { ok: false, why: 'helpers\\acer-control.ps1 is missing' };
  const h = String(await deps.sha256(file)).toLowerCase();
  return h === SCRIPT_SHA256 ? { ok: true } : { ok: false, why: 'helpers\\acer-control.ps1 was changed (its SHA-256 does not match)' };
}
export async function setUp() {
  begin('setup');
  try {
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.canSetUp) return finish(false, `Not set up: ${s.why}.`);
    if (s.setUp) return finish(true, 'Already set up.', { already: true });
    const v = await verifySource();
    if (!v.ok) return finish(false, `Not set up: ${v.why}. Nothing was changed.`);
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await deps.elevate(setupScript(), 'set up Acer controls', 'Setting up Acer controls', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not set up'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) {
      const why = said.startsWith('failed|') ? said.slice(7) : r.error || `the setup stopped (code ${r.code})`;
      const left = deps.exists(ACER.script) || (await deps.task(ACER.tasks.read).catch(() => false));
      return finish(false, `Not set up: ${why}. ${left ? 'Part of it may be left: press Remove.' : 'Nothing was left.'}`, { left });
    }
    step('Checking it is set up');
    const after = await status({ fresh: true });
    if (!after.setUp) return finish(false, `Not set up: ${after.partial || 'Windows did not keep the tasks.'} Press Remove, then try again.`, { left: true });
    return finish(true, 'Set up. The readings appear in a few seconds; the fan and charge controls are on the Laptop page.');
  } catch (e) {
    return finish(false, `Not set up: ${e.message}.`);
  }
}
export async function remove() {
  begin('remove');
  try {
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.task && !s.copy) return finish(true, 'Not set up; nothing to remove.', { already: true });
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await deps.elevate(removeScript(), 'remove Acer controls', 'Putting the fans on Auto and removing', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not removed'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) return finish(false, `Not removed: ${said.startsWith('failed|') ? said.slice(7) : r.error || `code ${r.code}`}.`);
    fansMaxByUs = false;
    const after = await status({ fresh: true });
    if (after.task || after.copy) return finish(false, `Not fully removed: ${after.task ? 'a task' : 'the folder'} is still there. Press Remove again.`);
    return finish(true, 'Removed. The fans are on Auto.');
  } catch (e) {
    return finish(false, `Not removed: ${e.message}.`);
  }
}

// ---- the route (server.js) ----
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
export async function handle(url, req, res, send) {
  const p = url.pathname;
  try {
    if (p === '/api/acer' && req.method === 'GET') return send(res, 200, await status({ fresh: url.searchParams.has('fresh') })), true;
    if (p === '/api/acer/read' && req.method === 'GET') return send(res, 200, { ok: true, readings: await read() }), true;
    if (p === '/api/acer/progress' && req.method === 'GET') return send(res, 200, job || {}), true;
    if ((p === '/api/acer/setup' || p === '/api/acer/remove') && req.method === 'POST') {
      if (running()) return send(res, 409, { error: 'Acer controls are being set up or removed', running: true }), true;
      (p.endsWith('setup') ? setUp() : remove()).catch(() => {});
      return send(res, 200, { started: true }), true;
    }
    if (p === '/api/acer/write' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, await write(String(b.mode || ''))), true;
    }
  } catch (e) { return send(res, e.code || 400, { ok: false, error: e.message }), true; }
  return false;
}
export const _test = { reset: () => { job = null; cache = { at: 0, value: null }; lastRun = 0; fansMaxByUs = false; writing = false; } };
