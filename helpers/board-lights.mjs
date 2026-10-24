// Board, fan and RAM lights, set up by DeviceHub on the person's click (22 Oct 2026, Shawn: "I want the app to be able
// to set it up and it currently cant"; docs/handoff/board-lights.md). Those lights sit on the motherboard's SMBus,
// which only OpenRGB with the PawnIO driver reaches, as administrator. DeviceHub itself never writes the SMBus or a
// graphics card's I2C bus: OpenRGB does, as the person chose. Nothing here runs at DeviceHub's start or by itself.
//
// Add board, fan and RAM lights (one click, POST /api/board-lights/setup):
//   1. PawnIO 2.2.0, only when it is not installed yet: its maker's official installer, downloaded over HTTPS from
//      github.com/namazso/PawnIO.Setup (the link pawnio.eu gives) and its GitHub asset host only, run only when Windows
//      reads its Authenticode signature as Valid and signed by namazso AND it matches the SHA-256 GitHub publishes for
//      it. Its own installer opens behind Windows' admin prompt; then PawnIO must show as installed.
//   2. DeviceHub's own OpenRGB stops (two OpenRGBs must not share the USB lights).
//   3. ONE Windows admin prompt runs a PowerShell script built here (setupScript, passed encoded on its command line,
//      never as a file anyone could change): it copies the OpenRGB inside DeviceHub (tools\openrgb) and its six PawnIO
//      modules (tools\openrgb\board-modules) into C:\Program Files\DeviceHub board lights\OpenRGB\, where only
//      administrators can change files, checks every copied file there against its SHA-256 in bundled-tools.json,
//      and registers the logon task "DeviceHub board lights": this user, at sign-in, highest rights, OpenRGB.exe
//      --server --server-host 127.0.0.1 --server-port 6742 --noautoconnect --config <that folder>\config, no window,
//      no time limit. Then it starts the task. Any failure undoes all of it (task, process, folder) before it ends.
//   4. DeviceHub waits (once, 45 s at most) for the SDK server, then reads the lights through helpers/openrgb.js as
//      for a person's own OpenRGB: backed up, read back, DeviceHub's own devices left alone.
// Remove board lights (POST /api/board-lights/remove): one admin prompt stops it and deletes the task and the folder;
// DeviceHub goes back to USB lights only. PawnIO stays installed (Windows Settings > Apps removes it).
// Windows' prompt (24 Oct 2026, helpers/uac.mjs): while Windows asks, the step is UAC_LINE (where to find the box). The
// elevated script first writes a "started" file (so DeviceHub knows the box was answered Yes) and exits at once if a
// "cancel" file is there: not answered within 2 minutes, DeviceHub writes that file and stops waiting, so a Yes
// pressed later changes nothing. Declined or not answered: recorded for Get help, and the result offers Try again.
// Why a scheduled task: OpenRGB has no Windows service (its only service file is Linux's systemd unit, qt/openrgb.service
// in release_1.1, and its --autostart-enable starts it without administrator), and a task with highest rights is
// Windows' own way to start one program elevated at sign-in without a prompt each time.
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import * as inst from './installers.mjs';
import { UAC_LINE, UAC_WAIT_MS, record as recordUac, declinedText, unansweredText } from './uac.mjs';

const require = createRequire(import.meta.url);
const orgb = require('./openrgb.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json'), 'utf8')).tools.find((t) => t.id === 'openrgb');
export const BOARD = orgb.BOARD;   // { dir, app, exe, config, task, port }: helpers/openrgb.js holds the one definition
export const SRC = path.join(ROOT, ...TABLE.folder.split('/'));
export const MODULES = path.join(SRC, TABLE.boardModulesFolder);
export const DIR = inst.DIR;
export const RESULT = path.join(DIR, 'board-lights-result.txt');
export const ARGS = `--server --server-host 127.0.0.1 --server-port ${BOARD.port} --noautoconnect --config "${BOARD.config}"`;
// read from the release on 22 Oct 2026: 3,410,960 bytes, its SHA-256 equals the digest GitHub lists for the asset, and
// Windows reads it as Valid, signed "E=admin@namazso.eu, CN=namazso.eu, O=namazso, L=Debrecen, C=HU" (GLOBALTRUST 2015
// CODESIGNING 1). pawnio.eu's Download link is .../releases/latest/download/PawnIO_setup.exe; DeviceHub pins 2.2.0.
export const PAWNIO = {
  id: 'pawnio', name: 'PawnIO', version: '2.2.0', page: 'https://pawnio.eu',
  url: 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe',
  file: 'PawnIO_setup.exe', size: 3410960,
  hosts: ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'],
  sha256: '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032',
  signer: [/(^|,\s*)CN=namazso\.eu(,|$)/, /(^|,\s*)O=namazso(,|$)/],
};
export const PAWNIO_REMOVE = 'PawnIO stays installed (remove it in Settings > Apps > Installed apps).';
const user = () => `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;

// every file of the protected copy, flat beside OpenRGB.exe, with its pinned hash
export const wanted = () => [
  ...Object.entries(TABLE.keep).map(([rel, sha]) => ({ rel, from: path.join(SRC, ...rel.split('/')), sha })),
  ...Object.entries(TABLE.boardModules).map(([rel, sha]) => ({ rel, from: path.join(MODULES, rel), sha })),
];

// ---- the two scripts the admin prompt runs (built here, exactly; tests/board-lights.mjs checks them) ----
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const head = (result) => [
  "$ErrorActionPreference = 'Stop'",
  `$dest = ${q(BOARD.dir)}; $app = ${q(BOARD.app)}; $cfg = ${q(BOARD.config)}; $task = ${q(BOARD.task)}; $result = ${q(result)}`,
  // only an OpenRGB.exe running from the protected copy is stopped, never the person's own or DeviceHub's USB-only one
  "function Stop-Board { $p = @(Get-Process -Name OpenRGB -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($app + '\\', [StringComparison]::OrdinalIgnoreCase) }); if ($p.Count) { $p | Stop-Process -Force -ErrorAction SilentlyContinue; $p | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue } }",
  'function Drop-Task { if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false } }',
];
export function setupScript({ who = user(), result = RESULT, files = wanted() } = {}) {
  return [
    ...head(result),
    `$user = ${q(who)}`,
    `$files = @(${files.map((f) => `@(${q(f.from)}, ${q(f.rel.replace(/\//g, '\\'))}, ${q(f.sha)})`).join(', ')})`,
    '$made = $false',
    'try {',
    '  Drop-Task; Stop-Board',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    '  New-Item -ItemType Directory -Force -Path $app, $cfg | Out-Null',
    '  foreach ($f in $files) {',
    '    $to = Join-Path $app $f[1]',
    '    New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null',
    '    Copy-Item -LiteralPath $f[0] -Destination $to -Force',
    '    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLower() -ne $f[2]) { throw "$($f[1]) does not match its pinned SHA-256" }',
    '  }',
    `  $a = New-ScheduledTaskAction -Execute (Join-Path $app 'OpenRGB.exe') -Argument ${q(ARGS)} -WorkingDirectory $app`,
    '  $tr = New-ScheduledTaskTrigger -AtLogOn -User $user',
    '  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest',
    '  $st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    "  Register-ScheduledTask -TaskName $task -Description 'Runs the OpenRGB inside DeviceHub as administrator for board, fan and RAM lights. Made by DeviceHub on your click; Remove board lights in DeviceHub deletes it.' -Action $a -Trigger $tr -Principal $pr -Settings $st | Out-Null",
    '  $made = $true',
    '  Start-ScheduledTask -TaskName $task',
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  $why = $_.Exception.Message',
    '  if ($made) { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }',
    '  Stop-Board',
    '  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue',
    '  Set-Content -LiteralPath $result -Value "failed|$why" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}
export function removeScript({ result = RESULT } = {}) {
  return [
    ...head(result),
    'try {',
    '  Drop-Task; Stop-Board',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  Set-Content -LiteralPath $result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}
// the outer, ordinary PowerShell: Start-Process -Verb RunAs shows Windows' own prompt (nothing gets round it); the script
// goes as -EncodedCommand through an environment variable, so it is never a file on disk
// the two lines put in front of the script on the admin side (uacMarks): a "cancel" file means DeviceHub stopped
// waiting (exit 4, nothing done); else the "started" file says the box was answered Yes
export const uacMarks = ({ started, cancel }) => [`if (Test-Path -LiteralPath ${q(cancel)}) { exit 4 }`, `Set-Content -LiteralPath ${q(started)} -Value 'started' -Encoding UTF8 -ErrorAction SilentlyContinue`].join('\r\n');
export const elevateCommand = "try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$env:DH_SCRIPT -PassThru -Wait -ErrorAction Stop; \"exit|$($p.ExitCode)\" } catch { \"error|$($_.Exception.Message)\" }";

// ---- the parts that touch Windows or the network, swappable for tests (tests/board-lights.mjs) ----
const ps = (cmd, ms = 20000) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: ms }, (err, out) => resolve(String(out || '').trim())));
export const deps = {
  download: (t, dest, onBytes) => inst.deps.download(t, dest, onBytes),
  signature: (file) => inst.deps.signature(file),
  sha256: (file) => inst.deps.sha256(file),
  run: (file) => inst.deps.run(file),
  exists: (f) => fs.existsSync(f),
  // PawnIO: its Windows Apps entry and its driver service
  async pawnio() {
    const out = await ps("$a = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'PawnIO' } | Select-Object -First 1; $s = Get-Service -Name PawnIO -ErrorAction SilentlyContinue; \"$([bool]$a)|$($a.DisplayVersion)|$([bool]$s)\"");
    const [app, version, svc] = out.split('|');
    return { app: app === 'True', version: version || null, service: svc === 'True' };
  },
  // the logon task is there (read with the person's own rights)
  task: () => new Promise((resolve) => execFile('schtasks.exe', ['/Query', '/TN', BOARD.task], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err))),
  // one admin prompt: { ok, declined, code, error }. marks: { started, cancel } (uacMarks); signal: stops waiting
  elevate(script, { marks = null, signal } = {}) {
    const full = marks ? `${uacMarks(marks)}\r\n${script}` : script;
    return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', elevateCommand], { windowsHide: true, timeout: 600000, ...(signal ? { signal } : {}), env: { ...process.env, DH_SCRIPT: Buffer.from(full, 'utf16le').toString('base64') } }, (err, out) => {
      const [kind, ...rest] = String(out || '').trim().split('|'), msg = rest.join('|');
      if (kind === 'exit') resolve({ ok: Number(msg) === 0, code: Number(msg) });
      else resolve({ ok: false, declined: /cancel/i.test(msg), error: msg || err?.message || 'Windows did not start it' });
    }));
  },
  writeFile: (f, text) => { try { fs.writeFileSync(f, text); } catch {} },
  uacWaitMs: UAC_WAIT_MS,
  readResult: (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } },
  clearResult: (f) => { try { fs.rmSync(f, { force: true }); } catch {} },
  stopBundled: () => orgb.stop(),
  forget: () => orgb.forget(),
  // OpenRGB's SDK server answering on 127.0.0.1:port: knocked once a second, only within ms, only after a click
  async waitServer(port, ms) {
    const until = Date.now() + ms;
    const knock = () => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }); const t = setTimeout(() => { s.destroy(); resolve(false); }, 800); s.on('connect', () => { clearTimeout(t); s.destroy(); resolve(true); }); s.on('error', () => { clearTimeout(t); resolve(false); }); });
    while (Date.now() < until) { if (await knock()) return true; await new Promise((r) => setTimeout(r, 1000)); }
    return false;
  },
};

// ---- status ----
let cache = { at: 0, value: null };
export async function status({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < 20000) return { ...cache.value, busy: !!(job && !job.done) };
  const [pawn, task] = await Promise.all([deps.pawnio().catch(() => ({ app: false, service: false, version: null })), deps.task().catch(() => false)]);
  const files = wanted(), lack = files.filter((f) => !deps.exists(f.from)).map((f) => f.rel);
  const copy = deps.exists(BOARD.exe), setUp = task && copy;
  const pawnio = { installed: pawn.app || pawn.service, version: pawn.version };
  const canSetUp = !lack.length;
  const value = {
    pawnio, setUp, task, copy, canSetUp,
    why: canSetUp ? null : `this copy of DeviceHub lacks ${lack.every((r) => r.endsWith('.bin')) ? "OpenRGB's board modules (tools\\openrgb\\board-modules)" : lack.length > 3 ? `${lack.length} of OpenRGB's files (tools\\openrgb)` : `${lack.join(', ')} (tools\\openrgb)`}; install DeviceHub again from its download`,
    partial: task !== copy ? (task ? 'The task is there but its OpenRGB copy is not.' : 'The OpenRGB copy is there but its task is not.') : null,
    // the one plain line before the click
    before: pawnio.installed
      ? 'PawnIO is already installed. Runs OpenRGB as administrator at sign-in; Windows asks once.'
      : `Installs PawnIO ${PAWNIO.version} (signed, checked first) and runs OpenRGB as administrator at sign-in. Windows asks twice.`,
    remove: `Back to USB lights only. Windows asks once. ${PAWNIO_REMOVE}`,
  };
  cache = { at: Date.now(), value };
  return { ...value, busy: !!(job && !job.done) };
}

// ---- PawnIO's installer: download, both checks, run ----
export async function verifyPawnIO(file) {
  const s = await deps.signature(file);
  if (s.status !== 'Valid') return { ok: false, why: s.status === 'NotSigned' ? 'it is not digitally signed' : `its signature is not valid (${s.status})` };
  if (!PAWNIO.signer.every((r) => r.test(s.signer || ''))) return { ok: false, why: `it is signed by ${/CN=([^,]+)/.exec(s.signer || '')?.[1] || 'someone else'}, not by namazso (PawnIO's maker)` };
  const h = await deps.sha256(file);
  if (String(h).toLowerCase() !== PAWNIO.sha256) return { ok: false, why: 'it does not match the SHA-256 GitHub publishes for PawnIO 2.2.0' };
  return { ok: true, how: 'signed by namazso.eu and matches its published SHA-256' };
}
// shared with helpers/cpu-sensors.mjs (CPU temperature and fans): say(text, pct, extra) shows the step, area names the
// feature in the prompt log, what starts each failure line
export async function installPawnIO({ say = step, area = 'board lights', what = 'Not set up' } = {}) {
  let last = null;
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, PAWNIO.file), part = `${file}.part`;
  try {
    try { fs.rmSync(part, { force: true }); } catch {}
    say(`Downloading ${PAWNIO.file}`, 0);
    await deps.download(PAWNIO, part, (got, size) => { const pct = size ? Math.min(100, Math.floor((got / size) * 100)) : null; if (pct !== last) { last = pct; say(`Downloading ${PAWNIO.file}`, pct); } });
    fs.renameSync(part, file);
    say(`Checking ${PAWNIO.file}`);
    const v = await verifyPawnIO(file);
    if (!v.ok) return { ok: false, text: `${what}: PawnIO was not run because ${v.why}. The download was deleted; nothing was changed.` };
    say(UAC_LINE, null, { uac: 'waiting' });
    const r = await deps.run(file, { onStarted: () => { recordUac({ area, action: 'install PawnIO', outcome: 'yes' }); say("PawnIO's installer is open: click Install in it"); } });
    if (!r.started && (r.declined || r.unanswered)) {
      const outcome = r.unanswered ? 'unanswered' : 'declined';
      recordUac({ area, action: 'install PawnIO', outcome });
      return { ok: false, uac: outcome, text: (outcome === 'declined' ? declinedText : unansweredText)(`${what}: PawnIO`) };
    }
    if (!r.started) return { ok: false, text: `${what}: PawnIO's installer did not start (${r.error}). Nothing was changed.` };
    say('Checking PawnIO is installed');
    const p = await deps.pawnio().catch(() => ({}));
    if (!(p.app || p.service)) return { ok: false, text: `${what}: PawnIO's installer closed (code ${r.exitCode}) but PawnIO is not installed. Nothing else was changed.` };
    return { ok: true, how: v.how, version: p.version };
  } catch (e) {
    return { ok: false, text: `${what}: ${e.message}. Nothing was changed.` };
  } finally {
    for (const f of [part, file]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

// ---- one job at a time; GET /api/board-lights/progress follows it ----
let job = null;
export const getProgress = () => job;
const step = (text, pct = null, extra = {}) => { const { uac, ...rest } = job || {}; job = { ...rest, text, pct, done: false, at: Date.now(), ...extra }; };
const finish = (ok, text, extra = {}) => { job = { ...job, text, pct: null, done: true, ok, at: Date.now(), ...extra }; cache.at = 0; deps.forget(); return job; };
// a job started more than 15 minutes ago and never finished (a prompt nobody answered) no longer holds the next one back
const running = () => !!job && !job.done && Date.now() - (job.startedAt || job.at) < 15 * 60 * 1000;
const begin = (kind) => { if (running()) throw new Error('board lights are being set up or removed; wait for it to finish'); job = { kind, startedAt: Date.now(), text: 'Starting', pct: null, done: false, at: Date.now() }; };

// one admin prompt, watched: UAC_LINE until the elevated script says it started (the box was answered Yes), then
// `next`; not answered within deps.uacWaitMs: the cancel file is written (a later Yes does nothing) and the wait stops.
// { ok, declined, unanswered, code, error }
// shared with helpers/cpu-sensors.mjs: { area, say } as for installPawnIO
export async function elevateWatched(script, action, next, { area = 'board lights', say = step } = {}) {
  const id = crypto.randomBytes(6).toString('hex');
  const marks = { started: path.join(DIR, `uac-started-${id}.txt`), cancel: path.join(DIR, `uac-cancel-${id}.txt`) };
  tidyMarks();
  say(UAC_LINE, null, { uac: 'waiting' });
  const ac = new AbortController();
  let answered = false, unanswered = false;
  const yes = () => { if (answered) return; answered = true; recordUac({ area, action, outcome: 'yes' }); say(next); };
  // looked at once a second only while this click's prompt is open (no timer of its own outlives it)
  let settled = false;
  const p = deps.elevate(script, { marks, signal: ac.signal }).then((x) => { settled = true; return x; }, (e) => { settled = true; return { ok: false, error: e.message }; });
  const until = Date.now() + deps.uacWaitMs;
  while (!settled) {
    await Promise.race([p, new Promise((res) => setTimeout(res, Math.min(1000, deps.uacWaitMs)))]);
    if (settled) break;
    if (deps.exists(marks.started)) yes();
    else if (!answered && Date.now() >= until) { unanswered = true; deps.writeFile(marks.cancel, 'cancel'); ac.abort(); break; }
  }
  const r = await p;
  try { fs.rmSync(marks.started, { force: true }); } catch {}
  if (unanswered) { recordUac({ area, action, outcome: 'unanswered' }); return { ok: false, unanswered: true }; }
  if (r.declined) recordUac({ area, action, outcome: 'declined' });
  else if (!answered && (r.ok || r.code != null)) recordUac({ area, action, outcome: 'yes' });
  return r;
}
// cancel files older than a day are no longer needed (a prompt left open that long is gone)
function tidyMarks() {
  try { for (const f of fs.readdirSync(DIR)) if (/^uac-(cancel|started)-[0-9a-f]+\.txt$/.test(f) && Date.now() - fs.statSync(path.join(DIR, f)).mtimeMs > 864e5) fs.rmSync(path.join(DIR, f), { force: true }); } catch {}
}

export async function setUp() {
  begin('setup');
  let pawnNew = false;
  const kept = () => (pawnNew ? ' PawnIO was installed and stays (Windows Settings > Apps > Installed apps removes it).' : '');
  try {
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.canSetUp) return finish(false, `Not set up: ${s.why}.`);
    if (s.setUp) return finish(true, 'Board lights are already set up. Press Find lights.', { already: true });
    // 1. PawnIO, only when it is missing
    if (!s.pawnio.installed) {
      const p = await installPawnIO();
      if (!p.ok) return finish(false, p.text, p.uac ? { uac: p.uac, retry: true } : {});
      pawnNew = true;
    }
    // 2. two OpenRGBs must not share the USB lights: DeviceHub's own one stops (Find lights starts it again if this fails)
    deps.stopBundled();
    // 3. the one admin prompt: protected copy, checked, and the logon task; the script undoes itself on any failure
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await elevateWatched(setupScript(), 'set up board lights', 'Setting up OpenRGB as administrator');
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, `${(r.unanswered ? unansweredText : declinedText)('Not set up')}${kept()}`, { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) {
      const why = r.declined ? "Windows' prompt was declined" : said.startsWith('failed|') ? said.slice(7) : r.error || `the setup stopped (code ${r.code})`;
      // the script removes what it made; if Windows still lists any of it, say so plainly
      const left = (await deps.task().catch(() => false)) || deps.exists(BOARD.exe);
      return finish(false, `Not set up: ${why}. ${left ? 'Part of it may be left: press Remove board lights.' : 'Nothing of it was left.'}${kept()}`, { left });
    }
    // 4. Windows' own answer, read back: the task and the protected copy are there
    step('Checking it is set up');
    const after = await status({ fresh: true });
    if (!after.setUp) return finish(false, `Not set up: ${after.partial || 'Windows did not keep the task'} Press Remove board lights, then try again.${kept()}`, { left: true });
    step('Waiting for OpenRGB to find the board (up to 45 s)');
    const up = await deps.waitServer(BOARD.port, 45000);
    return finish(true, up ? 'Board, fan and RAM lights are set up. Press Find lights.'
      : 'Board lights are set up, but OpenRGB has not answered yet. Press Find lights in a minute.', { pawnio: pawnNew });
  } catch (e) {
    return finish(false, `Not set up: ${e.message}.${kept()}`);
  }
}

export async function remove() {
  begin('remove');
  try {
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.task && !s.copy) return finish(true, `Board lights are not set up; nothing to remove. ${PAWNIO_REMOVE}`, { already: true });
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await elevateWatched(removeScript(), 'remove board lights', 'Removing the board-lights task');
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not removed'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) return finish(false, `Not removed: ${said.startsWith('failed|') ? said.slice(7) : r.error || `code ${r.code}`}.`);
    const after = await status({ fresh: true });
    if (after.task || after.copy) return finish(false, `Not fully removed: ${after.task ? 'the task' : 'the OpenRGB copy'} is still there. Press Remove board lights again.`);
    return finish(true, `Board lights removed: back to USB lights only. ${PAWNIO_REMOVE}`);
  } catch (e) {
    return finish(false, `Not removed: ${e.message}.`);
  }
}

// ---- the route (server.js) ----
export async function handle(url, req, res, send) {
  const p = url.pathname;
  try {
    if (p === '/api/board-lights' && req.method === 'GET') return send(res, 200, await status({ fresh: url.searchParams.has('fresh') })), true;
    if (p === '/api/board-lights/progress' && req.method === 'GET') return send(res, 200, job || {}), true;
    if ((p === '/api/board-lights/setup' || p === '/api/board-lights/remove') && req.method === 'POST') {
      if (running()) return send(res, 409, { error: 'board lights are being set up or removed', running: true }), true;
      // started on the click and answered at once; the page follows /api/board-lights/progress
      (p.endsWith('setup') ? setUp() : remove()).catch(() => {});
      return send(res, 200, { started: true }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
export const _test = { reset: () => { job = null; cache = { at: 0, value: null }; } };
