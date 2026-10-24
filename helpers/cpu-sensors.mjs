// CPU temperature and fan speeds, set up by DeviceHub on the person's click (24 Oct 2026, Shawn said yes;
// docs/handoff/display-health.md). READ ONLY: DeviceHub never changes a fan speed, and nothing here writes a setting.
// It follows Add board, fan and RAM lights (helpers/board-lights.mjs): nothing runs at DeviceHub's start or by itself.
//
// Add CPU temperature and fan speeds (one click, POST /api/cpu-sensors/setup):
//   1. PawnIO 2.2.0, only when it is not installed yet: the same signed, hash-checked install the board lights use
//      (board-lights.mjs installPawnIO). LibreHardwareMonitor reads the CPU and the fan chip through it.
//   2. LibreHardwareMonitor's official release zip, downloaded over HTTPS from its GitHub release only (LHM below), and
//      checked against the SHA-256 pinned here (the digest GitHub publishes for that asset). A mismatch deletes it.
//   3. ONE Windows admin prompt runs a PowerShell script built here (setupScript, passed encoded, never as a file): it
//      checks the zip's SHA-256 again, extracts only the library files the reader needs (FILES, each checked against
//      its pinned SHA-256) into C:\Program Files\DeviceHub sensors\ (only administrators can change files there),
//      copies helpers/cpu-sensors-reader.cs there and checks its SHA-256 (read when the script was built), writes
//      reader.ps1 (readerScript below) there and checks it, and registers the task "DeviceHub sensors": this user (S4U:
//      no password stored, no window, it never shows on the desktop), highest rights, NO trigger (it runs only when
//      DeviceHub starts it while the card is on screen), 4 h at most, one at a time. Any failure undoes all of it.
//   No .exe is made or run (24 Oct 2026: Shawn's AppControl notifies on every unsigned .exe that starts): the task runs
//   Windows' own signed powershell.exe on reader.ps1, which checks every file's SHA-256 again, loads the 9 DLLs and
//   compiles the reader source in memory (CodeDom, the compiler Add-Type uses; no module cmdlets, so nothing from the
//   person's own PowerShell modules or profile is loaded into the elevated host).
//   LibreHardwareMonitor.exe (its window, its web server, its fan control) is never extracted or run.
// Remove (POST /api/cpu-sensors/remove): one admin prompt stops the reader and deletes the task and the folder.
// Nothing else was changed, so nothing else is put back. PawnIO stays (board lights may use it; Windows Settings > Apps
// removes it).
// Why a task with no trigger and not LHM's own web server: the server is part of LibreHardwareMonitor.exe, which polls
// every sensor of the PC all the time while it runs (and listens on every address unless set otherwise); the task runs
// the small reader only while the card is on screen (helpers/cpu-sensors-read.js), so with the card closed nothing runs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as inst from './installers.mjs';
import * as bl from './board-lights.mjs';
import { declinedText, unansweredText } from './uac.mjs';

const require = createRequire(import.meta.url);
const reader = require('./cpu-sensors-read.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LHM_PATHS = reader.LHM;   // { dir, script, readings, want, task }
export const SOURCE = path.join(ROOT, 'helpers', 'cpu-sensors-reader.cs');
export const DIR = inst.DIR;
export const RESULT = path.join(DIR, 'cpu-sensors-result.txt');
// read from the release on 24 Oct 2026: v0.9.6 (14 Feb 2026, the latest stable), LibreHardwareMonitor.zip, 6,632,626
// bytes; its SHA-256 equals the digest GitHub lists for the asset. The .NET Framework build (PowerShell 5.1's runtime).
export const LHM = {
  id: 'librehardwaremonitor', name: 'LibreHardwareMonitor', version: '0.9.6',
  page: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases',
  url: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip',
  file: 'LibreHardwareMonitor-0.9.6.zip', size: 6632626,
  hosts: ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'],
  sha256: '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001',
};
// the library and what it loads (read from its references on 24 Oct 2026), each with its SHA-256 from that zip
export const FILES = {
  'LibreHardwareMonitorLib.dll': '6ebc194316536ba61af5be24508ad9fcbb2ecc685e716c12e787c79530f66bf0',
  'HidSharp.dll': 'd86690efde30ea9179f669320f39148853793b743a98b531afeaf30598e22f54',
  'RAMSPDToolkit-NDD.dll': 'b6882354c7c8ec186617e421507743dbfae09c5c1fc24cef76a1d0c0c26651de',
  'DiskInfoToolkit.dll': '1acbf51b3c10c51c986cf43021680d34a2e38d9a5ba652bcfa9a1b5f7fc09800',
  'BlackSharp.Core.dll': 'cafb93afcc8d8a367e21f619673d05c06887d8964867fed1371f02ded1cd3e23',
  'System.Memory.dll': 'd5e8e4866f9cfa66f7765660f84b210198893e55335487afe5ebda342c0e913d',
  'System.Runtime.CompilerServices.Unsafe.dll': '08cbd7278b66f1e68425a82d4b97181a4130d93e3dd91831407aba7212ccdacf',
  'System.Buffers.dll': '2d78d770c9cb997199154ae8c018b9f1d1efbc86729f7264dde6dbad2a12cac3',
  'System.Numerics.Vectors.dll': '20c2fa81b8c70d651099d762954f285fd4f942e63b2d7217c145dab8d4b2f4c9',
};
const user = () => `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;

// ---- the two scripts the admin prompt runs (built here, exactly; tests/cpu-sensors.mjs checks them) ----
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const head = (result) => [
  "$ErrorActionPreference = 'Stop'",
  `$dest = ${q(LHM_PATHS.dir)}; $task = ${q(LHM_PATHS.task)}; $result = ${q(result)}`,
  // only the PowerShell running the protected reader.ps1 is stopped, never any other PowerShell
  "function Stop-Reader { $me = (Join-Path $dest 'reader.ps1'); $p = @(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($me, [StringComparison]::OrdinalIgnoreCase) -ge 0 }); foreach ($x in $p) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue; Wait-Process -Id $x.ProcessId -Timeout 10 -ErrorAction SilentlyContinue } }",
  'function Drop-Task { if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false } }',
];
const sha = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
// what the task runs: Windows' own powershell.exe, no profile, no window, on the protected reader.ps1
export const taskArgs = (want = LHM_PATHS.want) => `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${LHM_PATHS.script}" -Want "${want}"`;
// reader.ps1, run by that powershell.exe with highest rights. Only .NET calls, no cmdlets (so no module is loaded from
// the person's own module folders into the elevated host): every pinned file's SHA-256 is checked again, the DLLs are
// loaded, the reader source is compiled in memory from the very bytes that were checked, and DeviceHubSensors.Start
// reads until the want file is 20 s old. Exit 5 = a file does not match its pin (nothing loaded); 6 = no compile.
export function readerScript({ files = FILES, sourceSha } = {}) {
  const pins = [...Object.entries(files), ['reader.cs', sourceSha]];
  return [
    "param([string]$Want)",
    "$ErrorActionPreference = 'Stop'",
    `$dir = ${q(LHM_PATHS.dir)}`,
    `$pins = @(${pins.map(([n, h]) => `@(${q(n)}, ${q(h)})`).join(', ')})`,
    '$hash = [Security.Cryptography.SHA256]::Create(); $bytes = @{}',
    "foreach ($p in $pins) { $b = [IO.File]::ReadAllBytes([IO.Path]::Combine($dir, $p[0])); if ([BitConverter]::ToString($hash.ComputeHash($b)).Replace('-', '').ToLowerInvariant() -ne $p[1]) { exit 5 }; $bytes[$p[0]] = $b }",
    "foreach ($p in $pins) { if ($p[0].EndsWith('.dll')) { $null = [Reflection.Assembly]::LoadFrom([IO.Path]::Combine($dir, $p[0])) } }",
    '$cp = [CodeDom.Compiler.CompilerParameters]::new(); $cp.GenerateInMemory = $true; $cp.GenerateExecutable = $false; $cp.CompilerOptions = \'/optimize+\'',
    "$null = $cp.ReferencedAssemblies.Add('System.dll'); $null = $cp.ReferencedAssemblies.Add([IO.Path]::Combine($dir, 'LibreHardwareMonitorLib.dll'))",
    "$r = [Microsoft.CSharp.CSharpCodeProvider]::new().CompileAssemblyFromSource($cp, [Text.Encoding]::UTF8.GetString($bytes['reader.cs']))",
    'if ($r.Errors.HasErrors) { exit 6 }',
    "exit ([int]$r.CompiledAssembly.GetType('DeviceHubSensors').GetMethod('Start').Invoke($null, [object[]]@($dir, $Want)))",
    '',
  ].join('\r\n');
}
export function setupScript({ who = user(), result = RESULT, zip, sourceSha, source = SOURCE, want = LHM_PATHS.want, files = FILES } = {}) {
  const ps1 = readerScript({ files, sourceSha });
  return [
    ...head(result),
    `$user = ${q(who)}; $zip = ${q(zip)}; $zipSha = ${q(LHM.sha256)}; $src = ${q(source)}; $srcSha = ${q(sourceSha)}`,
    `$files = @(${Object.entries(files).map(([n, sha]) => `@(${q(n)}, ${q(sha)})`).join(', ')})`,
    '$made = $false',
    'try {',
    '  Drop-Task; Stop-Reader',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    '  New-Item -ItemType Directory -Force -Path $dest | Out-Null',
    "  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $zipSha) { throw 'the download does not match its pinned SHA-256' }",
    '  Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '  $z = [IO.Compression.ZipFile]::OpenRead($zip)',
    '  try { foreach ($f in $files) { $e = $z.GetEntry($f[0]); if (-not $e) { throw "$($f[0]) is not in the download" }; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $dest $f[0]), $true) } } finally { $z.Dispose() }',
    '  foreach ($f in $files) { if ((Get-FileHash -LiteralPath (Join-Path $dest $f[0]) -Algorithm SHA256).Hash.ToLower() -ne $f[1]) { throw "$($f[0]) does not match its pinned SHA-256" } }',
    "  $cs = Join-Path $dest 'reader.cs'",
    '  Copy-Item -LiteralPath $src -Destination $cs -Force',
    "  if ((Get-FileHash -LiteralPath $cs -Algorithm SHA256).Hash.ToLower() -ne $srcSha) { throw 'the reader source changed while it was copied' }",
    // reader.ps1, passed as base64 so no quote in it can break this script, then checked
    "  $ps1 = Join-Path $dest 'reader.ps1'",
    `  [IO.File]::WriteAllBytes($ps1, [Convert]::FromBase64String(${q(Buffer.from(ps1, 'utf8').toString('base64'))}))`,
    `  if ((Get-FileHash -LiteralPath $ps1 -Algorithm SHA256).Hash.ToLower() -ne ${q(sha(ps1))}) { throw 'reader.ps1 was not written as built' }`,
    `  $a = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Argument ${q(taskArgs(want))} -WorkingDirectory $dest`,
    '  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest',
    '  $st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    "  Register-ScheduledTask -TaskName $task -Description 'Reads the CPU temperature and fan speeds (LibreHardwareMonitor, read only) while DeviceHub shows them. No trigger: DeviceHub starts it. Made by DeviceHub on your click; Remove in DeviceHub deletes it.' -Action $a -Principal $pr -Settings $st | Out-Null",
    '  $made = $true',
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  $why = $_.Exception.Message',
    '  if ($made) { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }',
    '  Stop-Reader',
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
    '  Drop-Task; Stop-Reader',
    '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
    "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
    '  exit 0',
    '} catch {',
    '  Set-Content -LiteralPath $result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue',
    '  exit 3',
    '}',
  ].join('\r\n');
}

// ---- the parts that touch Windows or the network, swappable for tests ----
export const deps = {
  download: (t, dest, onBytes) => inst.deps.download(t, dest, onBytes),
  sha256: (file) => inst.deps.sha256(file),
  exists: (f) => fs.existsSync(f),
  pawnio: () => bl.deps.pawnio(),
  installPawnIO: (opts) => bl.installPawnIO(opts),
  elevate: (script, action, next, opts) => bl.elevateWatched(script, action, next, opts),
  boardBusy: () => { const j = bl.getProgress(); return !!j && !j.done; },
  task: () => new Promise((resolve) => execFile('schtasks.exe', ['/Query', '/TN', LHM_PATHS.task], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err))),
  readResult: (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim(); } catch { return ''; } },
  clearResult: (f) => { try { fs.rmSync(f, { force: true }); } catch {} },
  removeFile: (f) => { try { fs.rmSync(f, { force: true }); } catch {} },
  platform: process.platform,
};

// ---- status (GET /api/cpu-sensors) ----
export const REMOVE_LINES = ['Removes the reader. Windows asks once.'];
let cache = { at: 0, value: null };
export async function status({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < 20000) return { ...cache.value, busy: running() };
  if (deps.platform !== 'win32') return { setUp: false, canSetUp: false, why: 'it works on Windows only', busy: false };
  const [pawn, task] = await Promise.all([deps.pawnio().catch(() => ({ app: false, service: false, version: null })), deps.task().catch(() => false)]);
  const copy = deps.exists(LHM_PATHS.script);
  const pawnio = { installed: !!(pawn.app || pawn.service), version: pawn.version || null };
  const value = {
    pawnio, task, copy, setUp: task && copy, canSetUp: deps.exists(SOURCE),
    why: deps.exists(SOURCE) ? null : 'this copy of DeviceHub lacks helpers\\cpu-sensors-reader.cs; install DeviceHub again from its download',
    partial: task !== copy ? (task ? 'The task is there but its reader is not.' : 'The reader is there but its task is not.') : null,
    // the plain lines before the click, one sentence each
    // one line (24 Oct 2026, Shawn: the app is too wordy)
    before: [`Downloads ${LHM.name} (6.6 MB)${pawnio.installed ? '' : ' and the PawnIO driver'}. Windows asks ${pawnio.installed ? 'once' : 'twice'}. Read only.`],
    remove: REMOVE_LINES,
  };
  cache = { at: Date.now(), value };
  return { ...value, busy: running() };
}

// ---- the zip: download and check ----
export async function verifyZip(file) {
  const h = String(await deps.sha256(file)).toLowerCase();
  return h === LHM.sha256 ? { ok: true } : { ok: false, why: `it does not match the SHA-256 GitHub publishes for ${LHM.name} ${LHM.version}` };
}

// ---- one job at a time; GET /api/cpu-sensors/progress follows it ----
let job = null;
export const getProgress = () => job;
const step = (text, pct = null, extra = {}) => { const { uac, ...rest } = job || {}; job = { ...rest, text, pct, done: false, at: Date.now(), ...extra }; };
const finish = (ok, text, extra = {}) => { job = { ...job, text, pct: null, done: true, ok, at: Date.now(), ...extra }; cache.at = 0; return job; };
const running = () => !!job && !job.done && Date.now() - (job.startedAt || job.at) < 15 * 60 * 1000;
const begin = (kind) => { if (running()) throw new Error('CPU sensors are being set up or removed; wait for it to finish'); job = { kind, startedAt: Date.now(), text: 'Starting', pct: null, done: false, at: Date.now() }; };
const AREA = 'CPU sensors';

export async function setUp() {
  begin('setup');
  let pawnNew = false;
  const kept = () => (pawnNew ? ' PawnIO was installed and stays (Windows Settings > Apps removes it).' : '');
  const zip = path.join(DIR, LHM.file), part = `${zip}.part`;
  try {
    if (deps.boardBusy()) return finish(false, 'Not set up: board lights are being set up. Try again when that finishes.');
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.canSetUp) return finish(false, `Not set up: ${s.why}.`);
    if (s.setUp) return finish(true, 'CPU temperature and fan speeds are already set up.', { already: true });
    // 1. PawnIO, only when it is missing
    if (!s.pawnio.installed) {
      const p = await deps.installPawnIO({ say: step, area: AREA, what: 'Not set up' });
      if (!p.ok) return finish(false, p.text, p.uac ? { uac: p.uac, retry: true } : {});
      pawnNew = true;
    }
    // 2. the official zip, checked against its pinned SHA-256 before anything else
    fs.mkdirSync(DIR, { recursive: true });
    deps.removeFile(part);
    step(`Downloading ${LHM.name} ${LHM.version}`, 0);
    let last = null;
    await deps.download(LHM, part, (got, size) => { const pct = size ? Math.min(100, Math.floor((got / size) * 100)) : null; if (pct !== last) { last = pct; step(`Downloading ${LHM.name} ${LHM.version}`, pct); } });
    fs.renameSync(part, zip);
    step('Checking the download');
    const v = await verifyZip(zip);
    if (!v.ok) return finish(false, `Not set up: ${LHM.name} was not used because ${v.why}. The download was deleted; nothing was changed.${kept()}`);
    // 3. the one admin prompt; the reader source is hashed now and checked again on the admin side
    const sourceSha = String(await deps.sha256(SOURCE)).toLowerCase();
    deps.clearResult(RESULT);
    const r = await deps.elevate(setupScript({ zip, sourceSha }), 'set up CPU sensors', 'Setting up the CPU reader as administrator', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, `${(r.unanswered ? unansweredText : declinedText)('Not set up')}${kept()}`, { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) {
      const why = said.startsWith('failed|') ? said.slice(7) : r.error || `the setup stopped (code ${r.code})`;
      const left = (await deps.task().catch(() => false)) || deps.exists(LHM_PATHS.script);
      return finish(false, `Not set up: ${why}. ${left ? 'Part of it may be left: press Remove.' : 'Nothing of it was left.'}${kept()}`, { left });
    }
    step('Checking it is set up');
    const after = await status({ fresh: true });
    if (!after.setUp) return finish(false, `Not set up: ${after.partial || 'Windows did not keep the task.'} Press Remove, then try again.${kept()}`, { left: true });
    return finish(true, 'CPU temperature and fan speeds are set up. The first reading takes a few seconds.', { pawnio: pawnNew });
  } catch (e) {
    return finish(false, `Not set up: ${e.message}.${kept()}`);
  } finally {
    deps.removeFile(part); deps.removeFile(zip);
  }
}

export async function remove() {
  begin('remove');
  try {
    step('Checking what is set up');
    const s = await status({ fresh: true });
    if (!s.task && !s.copy) { deps.removeFile(LHM_PATHS.want); return finish(true, 'CPU sensors are not set up; nothing to remove.', { already: true }); }
    fs.mkdirSync(DIR, { recursive: true });
    deps.clearResult(RESULT);
    const r = await deps.elevate(removeScript(), 'remove CPU sensors', 'Removing the CPU reader', { area: AREA, say: step });
    const said = deps.readResult(RESULT);
    deps.clearResult(RESULT);
    if (r.unanswered || r.declined) return finish(false, (r.unanswered ? unansweredText : declinedText)('Not removed'), { uac: r.unanswered ? 'unanswered' : 'declined', retry: true });
    if (!r.ok) return finish(false, `Not removed: ${said.startsWith('failed|') ? said.slice(7) : r.error || `code ${r.code}`}.`);
    deps.removeFile(LHM_PATHS.want);
    const after = await status({ fresh: true });
    if (after.task || after.copy) return finish(false, `Not fully removed: ${after.task ? 'the task' : 'the reader'} is still there. Press Remove again.`);
    return finish(true, 'CPU temperature and fan speeds removed: the task and its folder are gone. PawnIO stays installed.');
  } catch (e) {
    return finish(false, `Not removed: ${e.message}.`);
  }
}

// ---- the route (server.js) ----
export async function handle(url, req, res, send) {
  const p = url.pathname;
  try {
    if (p === '/api/cpu-sensors' && req.method === 'GET') return send(res, 200, await status({ fresh: url.searchParams.has('fresh') })), true;
    if (p === '/api/cpu-sensors/progress' && req.method === 'GET') return send(res, 200, job || {}), true;
    if ((p === '/api/cpu-sensors/setup' || p === '/api/cpu-sensors/remove') && req.method === 'POST') {
      if (running()) return send(res, 409, { error: 'CPU sensors are being set up or removed', running: true }), true;
      (p.endsWith('setup') ? setUp() : remove()).catch(() => {});
      return send(res, 200, { started: true }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
export const _test = { reset: () => { job = null; cache = { at: 0, value: null }; } };
