// Pause Wi-Fi scans while gaming (26 Oct 2026, Shawn wanted it back, built safely). Windows' Wi-Fi background scan
// (netsh wlan autoconfig) can cause ping spikes in games. Gemini's first version (removed in c7933b7) ran a script from
// the user-writable DeviceHub folder as administrator, could stay off forever, and a profile switch turned it off
// silently. This one follows Add board, fan and RAM lights (helpers/board-lights.mjs): nothing runs until the click.
//
// Pause Wi-Fi scans while gaming (one click, POST /api/wifi-pause/setup):
//   ONE Windows admin prompt runs a script built here (setupScript, passed encoded, never as a file): it copies
//   helpers/wifi-pause.ps1 (pinned by SCRIPT_SHA256; DeviceHub refuses before the prompt if it changed) into
//   C:\Program Files\DeviceHub Wi-Fi pause\ (only administrators can change files there), checks its SHA-256 there,
//   and registers two tasks for this user (S4U: no password stored, no window), highest rights, each with ONE fixed
//   mode in its arguments (no mode file, nothing a standard user can change):
//     "DeviceHub Wi-Fi pause"   -Mode pause, no trigger (DeviceHub starts it), 4 h 15 min at most
//     "DeviceHub Wi-Fi resume"  -Mode resume, at every sign-in (its only trigger)
//   Then it runs the resume task once, so scans start out normal. Any failure undoes all of it.
// It can never stay off: the pause task's watcher resumes after 4 h, when DeviceHub stops answering, or when the
// Wi-Fi drops for over 10 s, and sets a one-time resume at the 4-hour mark. DeviceHub resumes on any other profile, a
// game closing, its own quit (best effort), its start, a drop and the time limit. Windows resumes at every sign-in.
// The person decides: off by default; a profile pauses only with "Pause Wi-Fi scans in Gaming profile" on
// (settings.json wifiPauseGaming). Remove (POST /api/wifi-pause/remove): resumes, deletes both tasks and the folder.
// On a cable (no Wi-Fi in use, scans normal) the PC page shows nothing.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import * as inst from './installers.mjs';
import * as bl from './board-lights.mjs';
import { declinedText, unansweredText } from './uac.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PF = process.env.ProgramFiles || 'C:\\Program Files';
export const SOURCE = path.join(ROOT, 'helpers', 'wifi-pause.ps1');
export const SCRIPT_SHA256 = '72effc774daf6dd236f5785e282ff0818621a278a31484c4ee3fb05586bc19bf';
export const WIFI = {
  dir: path.join(PF, 'DeviceHub Wi-Fi pause'),
  script: path.join(PF, 'DeviceHub Wi-Fi pause', 'wifi-pause.ps1'),
  pauseTask: 'DeviceHub Wi-Fi pause',
  resumeTask: 'DeviceHub Wi-Fi resume',
};
export const MODES = Object.freeze(['pause', 'resume']);
export const MAX_MS = 4 * 60 * 60 * 1000;   // a pause ends after 4 hours at most
export const DROP_MS = 10000;               // Wi-Fi disconnected longer than this while paused: resume
export const WATCH_MS = 3000;
export const GAMING = 'Gaming';
export const DIR = inst.DIR;
export const RESULT = path.join(DIR, 'wifi-pause-result.txt');
const user = () => `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---- netsh's answers (read only; English labels, anything else reads as no Wi-Fi) ----
// netsh wlan show interfaces -> [{ name, state }]
export function parseInterfaces(text) {
  const out = [];
  let cur = null;
  for (const ln of String(text || '').split(/\r?\n/)) {
    const n = /^\s*Name\s*:\s*(.+?)\s*$/.exec(ln);
    if (n) { cur = { name: n[1], state: '' }; out.push(cur); continue; }
    const s = /^\s*State\s*:\s*(.+?)\s*$/.exec(ln);
    if (s && cur) cur.state = s[1].toLowerCase();
  }
  return out.filter((x) => safeName(x.name));
}
// netsh wlan show autoconfig -> { <interface>: true (scans on) | false (off) }
export function parseAutoconfig(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/Auto configuration logic is (enabled|disabled) on interface "([^"\r\n]+)"/gi)) out[m[2]] = m[1].toLowerCase() === 'enabled';
  return out;
}
export const safeName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 128 && !/["\x00-\x1f]/.test(n);
export function wifiState(ifText, acText) {
  const list = parseInterfaces(ifText), ac = parseAutoconfig(acText);
  const off = Object.entries(ac).filter(([, on]) => !on).map(([n]) => n);
  return { names: list.map((x) => x.name), connected: list.filter((x) => x.state === 'connected').map((x) => x.name), off };
}

// ---- the two scripts the admin prompt runs (built here, exactly; tests/wifi-pause.mjs checks them) ----
export const taskArgs = (mode, sha = SCRIPT_SHA256) => {
  if (!MODES.includes(mode)) throw new Error(`not a Wi-Fi pause mode: ${mode}`);
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('not a SHA-256');
  return `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${WIFI.script}" -Mode ${mode} -Expect ${sha}`;
};
const head = (result) => [
  "$ErrorActionPreference = 'Stop'",
  `$dest = ${q(WIFI.dir)}; $script = ${q(WIFI.script)}; $tp = ${q(WIFI.pauseTask)}; $tr = ${q(WIFI.resumeTask)}; $result = ${q(result)}`,
  'function Drop-Tasks { foreach ($t in @($tp, $tr)) { if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -Confirm:$false } } }',
];
export function setupScript({ who = user(), result = RESULT, source = SOURCE, sha = SCRIPT_SHA256 } = {}) {
  return [
    ...head(result),
    `$user = ${q(who)}; $src = ${q(source)}; $sha = ${q(sha)}`,
    'try {',
    '  Drop-Tasks',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    '  New-Item -ItemType Directory -Force -Path $dest | Out-Null',
    '  Copy-Item -LiteralPath $src -Destination $script -Force',
    "  if ((Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'wifi-pause.ps1 does not match its pinned SHA-256' }",
    "  $ps = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest',
    `  $ap = New-ScheduledTaskAction -Execute $ps -Argument ${q(taskArgs('pause', sha))} -WorkingDirectory $dest`,
    `  $ar = New-ScheduledTaskAction -Execute $ps -Argument ${q(taskArgs('resume', sha))} -WorkingDirectory $dest`,
    '  $sp = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4 -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    '  $sr = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable',
    '  $lt = New-ScheduledTaskTrigger -AtLogOn -User $user',
    "  Register-ScheduledTask -TaskName $tp -Description 'Pauses the Wi-Fi background scan while gaming; resumes by itself. Made by DeviceHub on your click; Remove in DeviceHub deletes it.' -Action $ap -Principal $pr -Settings $sp | Out-Null",
    "  Register-ScheduledTask -TaskName $tr -Description 'Turns the Wi-Fi background scan back on, at every sign-in and when DeviceHub asks. Made by DeviceHub on your click; Remove in DeviceHub deletes it.' -Action $ar -Trigger $lt -Principal $pr -Settings $sr | Out-Null",
    '  Start-ScheduledTask -TaskName $tr',
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
// Remove: scans back on first (every Wi-Fi interface, as the resume mode does), then both tasks and the folder
export function removeScript({ result = RESULT } = {}) {
  return [
    ...head(result),
    "$netsh = Join-Path $env:SystemRoot 'System32\\netsh.exe'",
    'try {',
    '  Stop-ScheduledTask -TaskName $tp -ErrorAction SilentlyContinue',
    "  $names = @((& $netsh wlan show interfaces 2>$null | Out-String) -split \"`r?`n\" | ForEach-Object { if ($_ -match '^\\s*Name\\s*:\\s*(.+?)\\s*$') { $Matches[1] } })",
    '  try { $names += @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.NdisPhysicalMedium -eq 9 } | ForEach-Object { $_.Name }) } catch {}',
    "  foreach ($n in ($names | Select-Object -Unique)) { if ($n -and $n.Length -le 128 -and $n -notmatch '[\"\\x00-\\x1f]') { & $netsh wlan set autoconfig 'enabled=yes' \"interface=$n\" | Out-Null } }",
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

// ---- the parts that touch Windows, swappable for tests (tests/wifi-pause.mjs) ----
const netshRead = (args) => new Promise((resolve) => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netsh.exe'), args, { windowsHide: true, timeout: 10000 }, (e, out) => resolve(String(out || ''))));
export const deps = {
  platform: process.platform,
  // read only: the two "show" commands
  wifi: async () => { const [i, a] = await Promise.all([netshRead(['wlan', 'show', 'interfaces']), netshRead(['wlan', 'show', 'autoconfig'])]); return wifiState(i, a); },
  task: (name) => new Promise((resolve) => execFile('schtasks.exe', ['/Query', '/TN', name], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err))),
  // starts one of the two tasks; the name is one of WIFI's two, never from a request
  runTask: (name) => new Promise((resolve) => execFile('schtasks.exe', ['/Run', '/TN', name], { windowsHide: true, timeout: 15000 }, (err, out, errOut) => resolve(err ? { ok: false, error: String(errOut || err.message).trim().split(/\r?\n/)[0] } : { ok: true }))),
  exists: (f) => fs.existsSync(f),
  sha256: (file) => inst.deps.sha256(file),
  elevate: (script, action, next, opts) => bl.elevateWatched(script, action, next, opts),
  readResult: (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } },
  clearResult: (f) => { try { fs.rmSync(f, { force: true }); } catch {} },
  gamingOn: () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8')).wifiPauseGaming === true; } catch { return false; } },
  now: () => Date.now(),
  setTimer: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearTimer: (t) => clearInterval(t),
  log: () => {},
};

// ---- status (GET /api/wifi-pause) ----
let cache = { at: 0, value: null };
let paused = null;   // { at, until, why }: a pause DeviceHub started and has not seen end
export async function status({ fresh = false } = {}) {
  if (!fresh && cache.value && deps.now() - cache.at < 10000) return view(cache.value);
  if (deps.platform !== 'win32') return { setUp: false, canSetUp: false, show: false, why: 'it works on Windows only', busy: false };
  const [w, tp, tr] = await Promise.all([deps.wifi().catch(() => ({ names: [], connected: [], off: [] })), deps.task(WIFI.pauseTask).catch(() => false), deps.task(WIFI.resumeTask).catch(() => false)]);
  const copy = deps.exists(WIFI.script), tasks = tp && tr;
  const canSetUp = deps.exists(SOURCE);
  cache = { at: deps.now(), value: {
    setUp: tasks && copy, task: tp || tr, copy, canSetUp,
    why: canSetUp ? null : 'this copy of DeviceHub lacks helpers\\wifi-pause.ps1; install DeviceHub again from its download',
    partial: (tp || tr) !== copy || tp !== tr ? 'Part of it is left from before.' : null,
    wifi: w,
  } };
  return view(cache.value);
}
function view(v) {
  const inUse = v.wifi.connected.length > 0;
  const off = v.wifi.off.length > 0;
  return {
    ...v, inUse, scans: off || paused ? 'paused' : 'normal',
    // a cable and no Wi-Fi in use: nothing to show (scans off on an idle adapter still shows, with Resume)
    show: inUse || off || !!paused,
    paused: paused ? { at: paused.at, until: paused.until, why: paused.why } : null,
    gaming: deps.gamingOn(),
    busy: running(),
    before: 'Pauses the Wi-Fi scan in the Gaming profile only. Windows asks once.',
    remove: 'Turns scans back on and removes it. Windows asks once.',
  };
}

// ---- pause and resume (no prompt: the tasks already have the rights) ----
let timer = null, downSince = null;
function watch(on) {
  if (on && !timer) timer = deps.setTimer(() => { tick().catch(() => {}); }, WATCH_MS);
  if (!on && timer) { deps.clearTimer(timer); timer = null; downSince = null; }
}
// while paused: the time limit, and the Wi-Fi dropping for more than DROP_MS
export async function tick() {
  if (!paused) return watch(false);
  const now = deps.now();
  if (now >= paused.until) return resume('time limit');
  const w = await deps.wifi().catch(() => null);
  if (w && w.connected.length) { downSince = null; return; }
  if (downSince == null) { downSince = now; return; }
  if (now - downSince > DROP_MS) return resume('Wi-Fi dropped');
}
export async function pause(why) {
  const s = await status({ fresh: true });
  if (!s.setUp) return { ok: false, text: 'Not set up.' };
  if (!s.inUse) return { ok: false, text: 'No Wi-Fi in use.' };
  const r = await deps.runTask(WIFI.pauseTask);
  if (!r.ok) return { ok: false, text: `Not paused: ${r.error}.` };
  const at = deps.now();
  paused = { at, until: at + MAX_MS, why };
  downSince = null;
  watch(true);
  cache.at = 0;
  deps.log(`Wi-Fi scans paused (${why})`);
  return { ok: true, text: 'Wi-Fi scans paused.' };
}
export async function resume(why) {
  const was = paused;
  paused = null;
  watch(false);
  cache.at = 0;
  const set = cache.value?.setUp ?? (await status({ fresh: true })).setUp;
  if (!set) return { ok: false, text: 'Not set up.' };
  const r = await deps.runTask(WIFI.resumeTask);
  if (was || why === 'button') deps.log(`Wi-Fi scans resumed (${why})`);
  return r.ok ? { ok: true, text: 'Wi-Fi scans back on.' } : { ok: false, text: `Not resumed: ${r.error}.` };
}
// a profile was applied (public/core/profiles.js), or a game closed with no profile to go back to (name null):
// Gaming with the person's switch on pauses; anything else resumes a pause
export async function profile(name) {
  const s = await status({ fresh: true });
  if (!s.setUp) return { ok: false, text: 'Not set up.', none: true };
  if (name === GAMING && s.gaming) return pause('Gaming profile');
  if (paused || s.scans === 'paused') return resume(name ? `${name} profile` : 'game closed');
  return { ok: true, none: true };
}
// DeviceHub started: a pause left from before (a crash, a restart) is ended
export async function onStart() {
  if (!deps.exists(WIFI.script)) return null;   // never set up: nothing is read
  const s = await status({ fresh: true });
  if (s.setUp && s.scans === 'paused') return resume('DeviceHub started');
  return null;
}
// DeviceHub quits: best effort, at most 1.5 s
export async function onQuit() {
  if (!paused && !(cache.value?.setUp && cache.value.wifi?.off?.length)) return null;
  return Promise.race([resume('DeviceHub quit'), new Promise((r) => setTimeout(() => r(null), 1500))]);
}

// ---- setup and removal: one job at a time; GET /api/wifi-pause/progress follows it ----
let job = null;
export const getProgress = () => job;
const step = (text, pct = null, extra = {}) => { const { uac, ...rest } = job || {}; job = { ...rest, text, pct, done: false, at: Date.now(), ...extra }; };
const finish = (ok, text, extra = {}) => { job = { ...job, text, pct: null, done: true, ok, at: Date.now(), ...extra }; cache.at = 0; return job; };
const running = () => !!job && !job.done && Date.now() - (job.startedAt || job.at) < 15 * 60 * 1000;
const begin = (kind) => { if (running()) throw new Error('Wi-Fi pause is being set up or removed; wait for it to finish'); job = { kind, startedAt: Date.now(), text: 'Starting', pct: null, done: false, at: Date.now() }; };
const AREA = 'Wi-Fi pause';

// the hash check before the prompt: the script DeviceHub would copy is exactly the pinned one
export async function verifySource(file = SOURCE) {
  if (!deps.exists(file)) return { ok: false, why: 'helpers\\wifi-pause.ps1 is missing' };
  const h = String(await deps.sha256(file)).toLowerCase();
  return h === SCRIPT_SHA256 ? { ok: true } : { ok: false, why: 'helpers\\wifi-pause.ps1 was changed (its SHA-256 does not match)' };
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
    const r = await deps.elevate(setupScript(), 'set up Wi-Fi pause', 'Setting up Wi-Fi pause', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not set up'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) {
      const why = said.startsWith('failed|') ? said.slice(7) : r.error || `the setup stopped (code ${r.code})`;
      const left = (await deps.task(WIFI.pauseTask).catch(() => false)) || (await deps.task(WIFI.resumeTask).catch(() => false)) || deps.exists(WIFI.script);
      return finish(false, `Not set up: ${why}. ${left ? 'Part of it may be left: press Remove.' : 'Nothing was left.'}`, { left });
    }
    step('Checking it is set up');
    const after = await status({ fresh: true });
    if (!after.setUp) return finish(false, `Not set up: ${after.partial || 'Windows did not keep the tasks.'} Press Remove, then try again.`, { left: true });
    return finish(true, 'Set up. Turn on the Gaming profile switch to use it.');
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
    paused = null; watch(false);
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await deps.elevate(removeScript(), 'remove Wi-Fi pause', 'Turning scans on and removing', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not removed'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) return finish(false, `Not removed: ${said.startsWith('failed|') ? said.slice(7) : r.error || `code ${r.code}`}.`);
    const after = await status({ fresh: true });
    if (after.task || after.copy) return finish(false, `Not fully removed: ${after.task ? 'a task' : 'the folder'} is still there. Press Remove again.`);
    return finish(true, 'Removed. Wi-Fi scans are on.');
  } catch (e) {
    return finish(false, `Not removed: ${e.message}.`);
  }
}

// ---- the route (server.js) ----
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); req.on('error', () => resolve({})); });
export async function handle(url, req, res, send) {
  const p = url.pathname;
  try {
    if (p === '/api/wifi-pause' && req.method === 'GET') return send(res, 200, await status({ fresh: url.searchParams.has('fresh') })), true;
    if (p === '/api/wifi-pause/progress' && req.method === 'GET') return send(res, 200, job || {}), true;
    if ((p === '/api/wifi-pause/setup' || p === '/api/wifi-pause/remove') && req.method === 'POST') {
      if (running()) return send(res, 409, { error: 'Wi-Fi pause is being set up or removed', running: true }), true;
      (p.endsWith('setup') ? setUp() : remove()).catch(() => {});
      return send(res, 200, { started: true }), true;
    }
    if (p === '/api/wifi-pause/resume' && req.method === 'POST') return send(res, 200, await resume('button')), true;
    if (p === '/api/wifi-pause/profile' && req.method === 'POST') {
      const b = await readBody(req);
      const name = typeof b.name === 'string' ? b.name.slice(0, 100) : null;
      return send(res, 200, await profile(name)), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
export const _test = { reset: () => { job = null; cache = { at: 0, value: null }; paused = null; if (timer) { deps.clearTimer(timer); timer = null; } downSince = null; }, paused: () => paused, watching: () => !!timer };
