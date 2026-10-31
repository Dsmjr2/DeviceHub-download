// CPU temperature and fan speeds through LibreHardwareMonitor (helpers/cpu-sensors.mjs, helpers/cpu-sensors-read.js,
// helpers/cpu-sensors-reader.cs, public/core/cpu-sensors.js), offline: every download, hash, prompt, task and reading is
// a stand-in. Nothing is downloaded, installed, elevated, registered or read. Run: node tests/cpu-sensors.mjs
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as uac from '../helpers/uac.mjs';
uac.options.root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uac-cs-'));   // the prompt log goes to TEMP
import * as cs from '../helpers/cpu-sensors.mjs';
import * as inst from '../helpers/installers.mjs';
import { sensorsView, shouldRead, ADD_LABEL, DEMO_SENSORS } from '../public/core/cpu-sensors.js';
const require = createRequire(import.meta.url);
const rd = require('../helpers/cpu-sensors-read.js');
const { _test: sensors } = require('../helpers/pc-sensors.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- the official release, pinned ----------
const L = cs.LHM;
check(L.url === 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' && L.version === '0.9.6' && L.size === 6632626, 'LibreHardwareMonitor 0.9.6 from its GitHub release');
check(L.sha256 === '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001', 'its SHA-256 is the digest GitHub publishes');
check(inst.hostOk(L, L.url) && inst.hostOk(L, 'https://release-assets.githubusercontent.com/x') && !inst.hostOk(L, 'http://github.com/x') && !inst.hostOk(L, 'https://github.com.evil.example/x'), 'HTTPS and its hosts only');
const names = Object.keys(cs.FILES);
check(names.includes('LibreHardwareMonitorLib.dll') && names.every((n) => /\.dll$/i.test(n)) && Object.values(cs.FILES).every((h) => /^[0-9a-f]{64}$/.test(h)), 'only library files, each with a pinned SHA-256');
check(!names.some((n) => /LibreHardwareMonitor\.exe|\.sys$/i.test(n)), "LibreHardwareMonitor.exe (its window, web server and fan control) and drivers are never extracted");

// ---------- the pinned hash check ----------
const d = cs.deps;
let shaOf = () => L.sha256;
d.sha256 = async (f) => shaOf(f);
check((await cs.verifyZip('x')).ok === true, 'the pinned hash passes');
shaOf = () => 'f'.repeat(64);
const bad = await cs.verifyZip('x');
check(bad.ok === false && /does not match the SHA-256 GitHub publishes/.test(bad.why), `another hash is refused (${bad.why})`);

// ---------- the two admin scripts ----------
const P = cs.LHM_PATHS;
check(P.dir === path.join(process.env.ProgramFiles || 'C:\\Program Files', 'DeviceHub sensors') && P.script === path.join(P.dir, 'reader.ps1') && P.task === 'DeviceHub sensors', 'the protected folder in Program Files and the task name');
const S = cs.setupScript({ who: "PC\\o'brien", result: 'C:\\t\\r.txt', zip: 'C:\\t\\L.zip', sourceSha: 'a'.repeat(64), source: 'C:\\DH\\helpers\\cpu-sensors-reader.cs', want: 'C:\\t\\want.txt', files: { 'LibreHardwareMonitorLib.dll': 'b'.repeat(64) } }).split('\r\n');
const has = (line) => S.includes(line);
check(has("$user = 'PC\\o''brien'; $zip = 'C:\\t\\L.zip'; $zipSha = '" + L.sha256 + "'; $src = 'C:\\DH\\helpers\\cpu-sensors-reader.cs'; $srcSha = '" + 'a'.repeat(64) + "'"), 'setup: this user, the zip and its pinned hash, the reader source and its hash');
check(has("$files = @(@('LibreHardwareMonitorLib.dll', '" + 'b'.repeat(64) + "'))"), 'the files to extract, each with its hash');
check(has("  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $zipSha) { throw 'the download does not match its pinned SHA-256' }"), 'the zip is checked again on the admin side');
check(S.some((l) => l.startsWith('  foreach ($f in $files) { if ((Get-FileHash -LiteralPath (Join-Path $dest $f[0])')), 'every extracted file is hashed in the protected folder');
check(has("  if ((Get-FileHash -LiteralPath $cs -Algorithm SHA256).Hash.ToLower() -ne $srcSha) { throw 'the reader source changed while it was copied' }"), 'the reader source is hashed after the copy');
// no .exe of ours (24 Oct 2026, Shawn's AppControl): Windows' own powershell.exe runs the protected reader.ps1
check(!S.some((l) => /csc\.exe|\/target:|DeviceHubSensors\.exe|\.exe['"]?\s*-Argument/i.test(l) && !/powershell\.exe/i.test(l)), 'no exe is compiled or written');
check(has(`  $a = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${P.script}" -Want "C:\\t\\want.txt"' -WorkingDirectory $dest`), "the task runs Windows' own powershell.exe on the protected reader.ps1, no profile, with the want file");
const ps1 = cs.readerScript({ files: { 'LibreHardwareMonitorLib.dll': 'b'.repeat(64) }, sourceSha: 'a'.repeat(64) });
const b64 = S.find((l) => l.startsWith('  [IO.File]::WriteAllBytes($ps1, [Convert]::FromBase64String('));
check(b64 && Buffer.from(/FromBase64String\('([^']+)'\)/.exec(b64)[1], 'base64').toString('utf8') === ps1, 'setup writes exactly readerScript as reader.ps1');
check(has(`  if ((Get-FileHash -LiteralPath $ps1 -Algorithm SHA256).Hash.ToLower() -ne '${crypto.createHash('sha256').update(ps1).digest('hex')}') { throw 'reader.ps1 was not written as built' }`), 'and checks it after writing');
check(has('  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest') && has('  $st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew'), 'highest rights, S4U (no password stored, no window), 4 h at most, one at a time');
// reader.ps1: every pin checked before anything loads, then only .NET calls
const PL = ps1.split('\r\n');
check(PL.includes(`$dir = '${P.dir}'`) && PL.includes(`$pins = @(@('LibreHardwareMonitorLib.dll', '${'b'.repeat(64)}'), @('reader.cs', '${'a'.repeat(64)}'))`), 'reader.ps1: the protected folder and every file with its pin, the reader source included');
const iCheck = PL.findIndex((l) => l.includes('ComputeHash') && l.includes('{ exit 5 }')), iLoad = PL.findIndex((l) => l.includes('Assembly]::LoadFrom')), iCompile = PL.findIndex((l) => l.includes('CompileAssemblyFromSource'));
check(iCheck > 0 && iLoad > iCheck && iCompile > iLoad, 'reader.ps1: the hashes are checked before any DLL is loaded or the source compiled');
check(PL[iCompile].includes("[Text.Encoding]::UTF8.GetString($bytes['reader.cs'])") && PL.some((l) => l.includes('$cp.GenerateInMemory = $true; $cp.GenerateExecutable = $false')), 'compiled in memory from the very bytes that were checked; no exe');
check(!PL.some((l) => /\b(Get-FileHash|Add-Type|Import-Module|New-Object|Get-Content|Set-Content|Invoke-Expression|iex|Start-Process)\b/i.test(l)), 'reader.ps1 uses no cmdlets (nothing from the person\'s own modules loads into the elevated host)');
check(PL.some((l) => l.includes("GetType('DeviceHubSensors').GetMethod('Start').Invoke($null, [object[]]@($dir, $Want))")), 'it calls the read-only reader with the folder and the want file');
check(S.some((l) => l.startsWith('  Register-ScheduledTask ') && l.endsWith(' -Action $a -Principal $pr -Settings $st | Out-Null')) && !S.some((l) => /Trigger/.test(l)) && !S.some((l) => /Start-ScheduledTask/.test(l)), 'no trigger: it never runs at sign-in or by itself, and is not started by setup');
const cat = S.indexOf('} catch {');
check(cat > 0 && S.slice(cat).includes('  if ($made) { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }') && S.slice(cat).includes('  Stop-Reader') && S.slice(cat).includes('  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue'), 'any failure: the task, the reader and the folder are undone');
check(!S.some((l) => /Set-ExecutionPolicy|\bsc\.exe|New-Service|reg add|Set-ItemProperty|bcdedit|Invoke-WebRequest|Start-Process|LibreHardwareMonitor\.exe/i.test(l)), 'no service, registry, boot, download or other program in the admin script');
const R = cs.removeScript({ result: 'C:\\t\\r.txt' }).split('\r\n');
check(R.includes('  Drop-Task; Stop-Reader') && R.includes('  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }') && !R.some((l) => /PawnIO/i.test(l)), 'remove: the task, the reader and the folder; PawnIO is left alone');
check(R.some((l) => l.startsWith('function Stop-Reader') && l.includes("$me = (Join-Path $dest 'reader.ps1')") && l.includes("Name='powershell.exe'") && l.includes('$_.CommandLine.IndexOf($me, [StringComparison]::OrdinalIgnoreCase) -ge 0')), 'only the PowerShell running the protected reader.ps1 is ever stopped');

// ---------- the reader: read only ----------
const src = fs.readFileSync(path.join(ROOT, 'helpers', 'cpu-sensors-reader.cs'), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
check(/c\.IsCpuEnabled = true;/.test(src) && /c\.IsMotherboardEnabled = true;/.test(src) && !/Is(Gpu|Memory|Storage|Network|Controller|Psu|Battery)Enabled\s*=\s*true/.test(src), 'the reader opens the CPU and the board only (no RAM SMBus, no USB controllers)');
check(!/SetSoftware|SetDefault|\.Control\b|WriteByte|WriteIo|WritePci|\.Set[A-Z]/.test(src), 'the reader has no write call');
check(/const int WantSeconds = 20;/.test(src) && /while \(Wanted\(want\)\)/.test(src), 'the reader stops 20 s after the card stops asking');

// ---------- parsing the readings ----------
const AMD = { at: 'now', hardware: [
  { name: 'Gigabyte B450 AORUS PRO WIFI-CF', type: 'Motherboard', parent: null, sensors: [] },
  { name: 'ITE IT8686E', type: 'SuperIO', parent: 'Gigabyte B450 AORUS PRO WIFI-CF', sensors: [
    { name: 'System #1', type: 'Temperature', value: 34 }, { name: 'VRM MOS', type: 'Temperature', value: 41.5 }, { name: 'Temperature #6', type: 'Temperature', value: 39 }, { name: 'PCH', type: 'Temperature', value: -55 },
    { name: 'CPU Fan', type: 'Fan', value: 1183.6 }, { name: 'System Fan #1', type: 'Fan', value: 860 }, { name: 'System Fan #2', type: 'Fan', value: 0 }, { name: 'Pump', type: 'Fan', value: null }] },
  { name: 'AMD Ryzen 7 5800X3D', type: 'Cpu', parent: null, sensors: [{ name: 'Core (Tctl/Tdie)', type: 'Temperature', value: 47.6 }, { name: 'CCD1 (Tdie)', type: 'Temperature', value: 51.2 }] }] };
const a = rd.parse(AMD);
check(a.cpu[0].packageC === 48 && a.cpu[0].coresMaxC === 51, `AMD: Tctl/Tdie as the package, the hottest CCD as the cores (${JSON.stringify(a.cpu)})`);
check(a.fans.length === 2 && a.fans[0].name === 'CPU Fan' && a.fans[0].rpm === 1184 && a.idleFans === 1, `fans by name with RPM; a 0 RPM header counted, a null one dropped (${JSON.stringify(a.fans)})`);
check(a.boardTemps.map((t) => t.name).join() === 'System #1,VRM MOS', `board temperatures: named and plausible only (${JSON.stringify(a.boardTemps)})`);
const INTEL = { hardware: [{ name: 'Intel Core i7-12700K', type: 'Cpu', sensors: [{ name: 'CPU Package', type: 'Temperature', value: 55 }, { name: 'CPU Core #1', type: 'Temperature', value: 60 }, { name: 'Core Max', type: 'Temperature', value: 63 }, { name: 'CPU Total', type: 'Load', value: 9 }] }] };
const i = rd.parse(INTEL);
check(i.cpu[0].packageC === 55 && i.cpu[0].coresMaxC === 63 && !i.boardFound && i.fans.length === 0, 'Intel: CPU Package and Core Max; no fan chip found');
const z = rd.parse({ hardware: [{ name: 'AMD', type: 'Cpu', sensors: [{ name: 'Core (Tctl/Tdie)', type: 'Temperature', value: 0 }] }] });
check(z.cpu[0].packageC === null && z.anything === false, 'a 0 °C reading (no driver access) is not a temperature');
check(rd.parse(null).cpu.length === 0 && rd.parse({ hardware: 'x' }).fans.length === 0, 'nonsense parses to nothing');

// ---------- reading: only when asked, and only then ----------
const calls = { touch: 0, run: 0, read: 0 };
let world = {};
const resetRead = (x = {}) => { world = { exe: true, readings: null, runOk: true, now: 1e12, ...x }; calls.touch = calls.run = calls.read = 0; rd._test.reset(); };
Object.assign(rd.deps, {
  exists: (f) => (f === rd.LHM.script ? world.exe : false),
  touch: () => { calls.touch++; },
  stat: (f) => (f === rd.LHM.readings && world.readings ? { mtimeMs: world.readings.at } : null),
  readText: () => { calls.read++; return JSON.stringify(world.readings.raw); },
  runTask: async () => { calls.run++; return world.runOk ? { ok: true } : { ok: false, error: 'Access is denied.' }; },
  now: () => world.now,
});
resetRead();
await new Promise((r) => setTimeout(r, 300));
check(calls.touch === 0 && calls.run === 0 && calls.read === 0, 'nothing is touched, started or read until a reading is asked for (the card is not on screen)');
resetRead({ exe: false });
const n0 = await rd.read();
check(n0.setUp === false && calls.touch === 0 && calls.run === 0, 'not set up: nothing touched or started');
resetRead();
const s1 = await rd.read();
check(s1.state === 'starting' && calls.touch === 1 && calls.run === 1, 'set up, no readings yet: the want file is touched and the task started once');
world.now += 5000; await rd.read();
check(calls.run === 1 && calls.touch === 2, 'asked again 5 s later: touched again, the task not started twice');
world.readings = { at: world.now - 2000, raw: AMD }; world.now += 1000;
const s2 = await rd.read();
check(s2.state === 'ok' && s2.cpu[0].packageC === 48 && calls.read === 1, 'fresh readings are read and parsed');
resetRead({ runOk: false });
const s3 = await rd.read();
check(s3.state === 'error' && /Access is denied/.test(s3.why), `a task Windows did not start is said plainly (${s3.why})`);

// ---------- what decides a read on the page ----------
check(shouldRead({ hash: '#/fans', page: 'fans', hidden: false, onScreen: true }) === true, 'on the PC page, window shown, card on screen: read');
check(!shouldRead({ hash: '#/fans', page: 'fans', hidden: false, onScreen: false }) && !shouldRead({ hash: '#/fans', page: 'fans', hidden: true, onScreen: true }) && !shouldRead({ hash: '#/mouse', page: 'fans', hidden: false, onScreen: true }), 'card off screen, window hidden or another page: no read');
const ui = fs.readFileSync(path.join(ROOT, 'public', 'ui', 'pc-health.js'), 'utf8');
check(/if \(!canRead\(page\)\) \{ tempsTimer\?\.\(\); tempsTimer = null/.test(ui) && /if \(canRead\(page\)\) \{ if \(!tempsTimer\) loadTemps\(\)/.test(ui), 'the card reads only through shouldRead (the 5 s timer stops itself)');
// 31 Oct 2026: a hidden window only pauses the 5 s reading (core/visible-timer.js), so it carries on when shown again
check(/tempsTimer = everyVisible\(/.test(ui), 'the temperatures timer rests while the window is hidden and restarts when it is shown');

// ---------- the temperatures card's data ----------
const ok = { setUp: true, state: 'ok', ...a };
const t1 = sensors.decide({ nvidia: { available: true, gpus: [{ name: 'RTX', tempC: 40, fanPct: 0 }] }, zones: [{ name: 'Z', tenthsK: 3231 }], pawnio: true, lhm: ok });
check(t1.readings.some((r) => r.name === 'CPU package' && r.tempC === 48) && t1.readings.some((r) => r.name === 'CPU cores, hottest' && r.tempC === 51) && t1.readings.some((r) => r.kind === 'fan' && r.name === 'CPU Fan' && r.fanRpm === 1184), 'CPU package, hottest cores and each fan by name');
check(!t1.readings.some((r) => r.kind === 'zone') && !t1.notReadable.some((n) => /CPU/.test(n.what)) && t1.cpuSensors.idleFans === 1, 'with LibreHardwareMonitor: no ACPI zone, nothing CPU left as not readable');
const t2 = sensors.decide({ pawnio: false, lhm: { setUp: false } });
check(t2.notReadable.some((n) => n.what === 'CPU temperature') && t2.cpuSensors.setUp === false, 'not added: CPU temperature and fans say what is needed');

// ---------- setup and remove, with stand-ins ----------
const st = { pawn: { app: true, service: true, version: '2.2.0.0' }, task: false, exe: false, elevate: { ok: true, code: 0 }, makes: true, boardBusy: false, download: 0, elevated: [], pawnInstalls: 0 };
const resetSetup = (x = {}) => { Object.assign(st, { pawn: { app: true, service: true, version: '2.2.0.0' }, task: false, exe: false, elevate: { ok: true, code: 0 }, makes: true, boardBusy: false, download: 0, elevated: [], pawnInstalls: 0, pawnOk: true }, x); cs._test.reset(); shaOf = () => L.sha256; };
const realExists = fs.existsSync;
Object.assign(d, {
  download: async (t, dest, onBytes) => { st.download++; fs.writeFileSync(dest, 'pretend zip'); onBytes(1, 1); },
  exists: (f) => (f === P.script ? st.exe : realExists(f)),
  pawnio: async () => st.pawn,
  installPawnIO: async () => { st.pawnInstalls++; return st.pawnOk ? { ok: true } : { ok: false, text: 'Not set up: PawnIO: Windows\' permission box was declined. Nothing was changed.', uac: 'declined' }; },
  elevate: async (script, action) => { st.elevated.push({ script, action }); if (st.elevate.ok && st.makes && action.startsWith('set up')) { st.task = true; st.exe = true; } if (st.elevate.ok && action.startsWith('remove')) { st.task = false; st.exe = false; } return st.elevate; },
  boardBusy: () => st.boardBusy,
  task: async () => st.task,
  readResult: () => 'ok', clearResult: () => {},
  platform: 'win32',
});
const zipFile = path.join(cs.DIR, L.file);

resetSetup();
let j = await cs.setUp();
check(j.ok && /are set up/.test(j.text) && st.download === 1 && st.elevated.length === 1 && st.pawnInstalls === 0, `set up with PawnIO present: one download, one prompt, no PawnIO install (${j.text})`);
check(st.elevated[0].script.includes(`$zip = '${zipFile}'`) && st.elevated[0].script.includes(`$srcSha = '${L.sha256}'`), 'the prompt gets the downloaded zip and the reader source hash');
check(!realExists(zipFile) && !realExists(`${zipFile}.part`), 'the download is deleted afterwards');

resetSetup();
shaOf = (f) => (f === zipFile ? 'e'.repeat(64) : L.sha256);
j = await cs.setUp();
check(!j.ok && /was not used because it does not match/.test(j.text) && st.elevated.length === 0 && !realExists(zipFile), `a wrong hash: nothing elevated, the download deleted (${j.text})`);

resetSetup({ pawn: { app: false, service: false, version: null } });
j = await cs.setUp();
check(j.ok && st.pawnInstalls === 1 && /PawnIO|set up/.test(j.text), 'PawnIO missing: the same signed PawnIO install first');
resetSetup({ pawn: { app: false, service: false, version: null }, pawnOk: false });
j = await cs.setUp();
check(!j.ok && j.retry && st.download === 0 && st.elevated.length === 0, 'PawnIO declined: nothing downloaded or elevated, Try again offered');

resetSetup({ elevate: { ok: false, declined: true } });
j = await cs.setUp();
check(!j.ok && j.retry && j.uac === 'declined' && /declined/.test(j.text), `the box declined: Try again (${j.text})`);

resetSetup({ boardBusy: true });
j = await cs.setUp();
check(!j.ok && /board lights are being set up/.test(j.text) && st.download === 0, 'never at the same time as the board lights setup');

resetSetup({ task: true, exe: true });
j = await cs.setUp();
check(j.ok && j.already && st.download === 0, 'already set up: nothing done');
j = await cs.remove();
check(j.ok && /removed/.test(j.text) && st.elevated.length === 1 && st.elevated[0].action === 'remove CPU sensors' && !st.task && !st.exe, `remove: one prompt, the task and folder gone (${j.text})`);
resetSetup();
j = await cs.remove();
check(j.ok && j.already && st.elevated.length === 0, 'nothing set up: remove asks nothing');

// ---------- the control ----------
const v0 = sensorsView(DEMO_SENSORS, null);
check(v0.action === 'setup' && v0.label === ADD_LABEL && v0.lines.length >= 1 && v0.lines.every((l) => /^[^.]+(\.[^.]+)*\.$/.test(l) || l.endsWith(').')), 'not set up: the plain lines and the Add button');
check(v0.lines.some((l) => /Read only/.test(l)), 'the lines say it is read only');
const v1 = sensorsView({ ...DEMO_SENSORS, setUp: true }, null);
check(v1.action === 'ask-remove' && v1.label === 'Remove', 'set up: Remove');
check(sensorsView({ ...DEMO_SENSORS, setUp: true }, null, { confirmRemove: true }).label === 'Yes, remove', 'Remove is confirmed in place');
check(sensorsView(DEMO_SENSORS, { done: false, uac: 'waiting', text: uac.UAC_LINE }).uac === true, "Windows' box: the line says where to find it");
check(sensorsView(DEMO_SENSORS, { done: true, ok: false, retry: true, kind: 'setup', text: 'x' }).label === 'Try again', 'declined: Try again');

if (fails.length) { console.log(`cpu-sensors: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('cpu-sensors (stand-in downloads, hashes, prompts, task and readings): all good');
