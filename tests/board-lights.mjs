// Add board, fan and RAM lights (helpers/board-lights.mjs, public/core/board-lights.js, the Setup and Lighting rows,
// and board-lights mode in helpers/openrgb.js), offline: every download, signature, installer, admin prompt, task and
// OpenRGB is a stand-in. Nothing is downloaded, installed, elevated or registered. Run: node tests/board-lights.mjs
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as bl from '../helpers/board-lights.mjs';
import * as inst from '../helpers/installers.mjs';
import * as uac from '../helpers/uac.mjs';
uac.options.root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uac-bl-'));   // the prompt log goes to TEMP
import { boardView, ADD_LABEL, REMOVE_LABEL, DEMO_BOARD } from '../public/core/board-lights.js';
import { lightRows, boardRow, planSetup } from '../public/core/setup-list.js';
const require = createRequire(import.meta.url);

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- the official PawnIO release, pinned ----------
const P = bl.PAWNIO;
check(P.url === 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe' && P.version === '2.2.0' && P.size === 3410960, 'PawnIO 2.2.0 from its maker\'s GitHub release');
check(P.sha256 === '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032', 'its SHA-256 is the digest GitHub publishes');
check(inst.hostOk(P, 'https://release-assets.githubusercontent.com/x') && inst.hostOk(P, P.url) && !inst.hostOk(P, 'http://github.com/x') && !inst.hostOk(P, 'https://github.com.evil.example/x') && !inst.hostOk(P, 'https://pawnio.evil/x'), 'HTTPS and its hosts only');

// ---------- the two admin scripts, built exactly ----------
const B = bl.BOARD;
check(B.dir === path.join(process.env.ProgramFiles || 'C:\\Program Files', 'DeviceHub board lights') && B.exe === path.join(B.dir, 'OpenRGB', 'OpenRGB.exe') && B.task === 'DeviceHub board lights' && B.port === 6742, 'the protected copy in Program Files and the task name');
check(bl.ARGS === `--server --server-host 127.0.0.1 --server-port 6742 --noautoconnect --config "${B.config}"`, `OpenRGB's arguments: SDK server on 127.0.0.1 only (${bl.ARGS})`);
const files = bl.wanted();
const tbl = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json'), 'utf8')).tools.find((t) => t.id === 'openrgb');
check(files.length === Object.keys(tbl.keep).length + 6 && files.filter((f) => f.rel.endsWith('.bin')).every((f) => f.from === path.join(bl.MODULES, f.rel) && f.sha === tbl.boardModules[f.rel]) && files.find((f) => f.rel === 'OpenRGB.exe').sha === tbl.keep['OpenRGB.exe'], 'the copy: the kept OpenRGB files and the six modules, each with its pinned hash');
check(!files.some((f) => /\.sys$/i.test(f.rel)), 'no driver is ever copied');
const S = bl.setupScript({ who: "PC\\o'brien", result: 'C:\\t\\r.txt', files: [{ from: "C:\\D'H\\tools\\openrgb\\OpenRGB.exe", rel: 'OpenRGB.exe', sha: 'a'.repeat(64) }, { from: 'C:\\DH\\tools\\openrgb\\board-modules\\SmbusPIIX4.bin', rel: 'SmbusPIIX4.bin', sha: 'b'.repeat(64) }, { from: 'C:\\DH\\tools\\openrgb\\platforms\\qwindows.dll', rel: 'platforms/qwindows.dll', sha: 'c'.repeat(64) }] }).split('\r\n');
const has = (line) => S.includes(line);
check(S[0] === "$ErrorActionPreference = 'Stop'" && has(`$dest = '${B.dir}'; $app = '${B.app}'; $cfg = '${B.config}'; $task = 'DeviceHub board lights'; $result = 'C:\\t\\r.txt'`), 'setup: its folders, task and result file');
check(has("$user = 'PC\\o''brien'"), 'the task is for the signed-in user (quotes doubled)');
check(has(`$files = @(@('C:\\D''H\\tools\\openrgb\\OpenRGB.exe', 'OpenRGB.exe', '${'a'.repeat(64)}'), @('C:\\DH\\tools\\openrgb\\board-modules\\SmbusPIIX4.bin', 'SmbusPIIX4.bin', '${'b'.repeat(64)}'), @('C:\\DH\\tools\\openrgb\\platforms\\qwindows.dll', 'platforms\\qwindows.dll', '${'c'.repeat(64)}'))`), 'every file, from tools\\openrgb, to its place beside the exe, with its hash');
check(has('    Copy-Item -LiteralPath $f[0] -Destination $to -Force') && has('    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLower() -ne $f[2]) { throw "$($f[1]) does not match its pinned SHA-256" }'), 'each file is hashed AFTER the copy, in the protected folder');
check(has(`  $a = New-ScheduledTaskAction -Execute (Join-Path $app 'OpenRGB.exe') -Argument '${bl.ARGS}' -WorkingDirectory $app`), 'the task runs the protected OpenRGB.exe with the SDK server arguments');
check(has('  $tr = New-ScheduledTaskTrigger -AtLogOn -User $user') && has('  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest') && has('  $st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew'), 'at this user\'s sign-in, highest rights, interactive (no password stored), no time limit, one at a time');
check(S.some((l) => l.startsWith('  Register-ScheduledTask -TaskName $task -Description ') && l.endsWith(' -Action $a -Trigger $tr -Principal $pr -Settings $st | Out-Null')) && has('  Start-ScheduledTask -TaskName $task'), 'registered once, then started');
const cat = S.indexOf('} catch {');
check(cat > 0 && S.slice(cat).join('\n').includes('if ($made) { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }') && S.slice(cat).includes('  Stop-Board') && S.slice(cat).includes('  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue') && S.slice(cat).includes('  exit 3'), 'any failure: the task, the process and the folder are undone');
check(S.some((l) => l.startsWith('function Stop-Board') && l.includes("$_.Path.StartsWith($app + '\\', [StringComparison]::OrdinalIgnoreCase)")), 'only an OpenRGB running from the protected copy is ever stopped');
check(!S.some((l) => /Set-ExecutionPolicy|sc\.exe|New-Service|reg add|bcdedit|-RunLevel Limited|Invoke-WebRequest|Start-Process/i.test(l)), 'no service, registry, boot, download or other program in the admin script');
const R = bl.removeScript({ result: 'C:\\t\\r.txt' });
check(R === [
  "$ErrorActionPreference = 'Stop'",
  `$dest = '${B.dir}'; $app = '${B.app}'; $cfg = '${B.config}'; $task = 'DeviceHub board lights'; $result = 'C:\\t\\r.txt'`,
  "function Stop-Board { $p = @(Get-Process -Name OpenRGB -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($app + '\\', [StringComparison]::OrdinalIgnoreCase) }); if ($p.Count) { $p | Stop-Process -Force -ErrorAction SilentlyContinue; $p | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue } }",
  'function Drop-Task { if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false } }',
  'try {',
  '  Drop-Task; Stop-Board',
  '  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }',
  "  Set-Content -LiteralPath $result -Value 'ok' -Encoding UTF8",
  '  exit 0',
  '} catch {',
  '  Set-Content -LiteralPath $result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue',
  '  exit 3',
  '}',
].join('\r\n'), 'remove: stop, delete the task and the folder, exactly');
check(!/PawnIO/i.test(R), 'remove never touches PawnIO');
check(bl.elevateCommand === "try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$env:DH_SCRIPT -PassThru -Wait -ErrorAction Stop; \"exit|$($p.ExitCode)\" } catch { \"error|$($_.Exception.Message)\" }", 'Windows\' own admin prompt (RunAs); the script passed encoded, never as a file');

// ---------- stand-ins ----------
const pc = {};
const calls = { download: [], run: [], elevate: [], stopBundled: 0, wait: 0 };
const d = bl.deps;
const reset = (x = {}) => {
  Object.assign(pc, { pawn: { app: false, service: false, version: null }, pawnInstalls: true, task: false, copy: false, files: true,
    sig: { status: 'Valid', signer: 'E=admin@namazso.eu, CN=namazso.eu, O=namazso, L=Debrecen, C=HU' }, sha: P.sha256, run: { started: true, exitCode: 0 },
    elevate: { ok: true, code: 0 }, makes: true, result: 'ok', server: true, downloadError: null }, x);
  for (const k of Object.keys(calls)) calls[k] = Array.isArray(calls[k]) ? [] : 0;
  bl._test.reset();
};
d.download = async (t, dest, onBytes) => { calls.download.push(t.url); if (pc.downloadError) throw new Error(pc.downloadError); fs.writeFileSync(dest, 'pretend PawnIO installer'); onBytes(10, 10); };
d.signature = async () => pc.sig;
d.sha256 = async () => pc.sha;
d.run = async (file) => { calls.run.push(path.basename(file)); check(fs.existsSync(file), 'the installer runs from the checked download'); if (pc.run.started && pc.pawnInstalls) pc.pawn = { app: true, service: true, version: '2.2.0.0' }; return pc.run; };
d.pawnio = async () => pc.pawn;
d.task = async () => pc.task;
d.exists = (f) => (f === B.exe ? pc.copy : files.some((x) => x.from === f) ? pc.files : fs.existsSync(f));
d.elevate = async (script) => { calls.elevate.push(script); if (pc.elevate.ok && pc.makes) { if (/Register-ScheduledTask/.test(script)) { pc.task = true; pc.copy = true; } else { pc.task = false; pc.copy = false; } } return pc.elevate; };
let resultText = '';
d.readResult = () => resultText;
d.clearResult = () => {};
d.stopBundled = () => { calls.stopBundled++; };
d.forget = () => {};
d.waitServer = async (port, ms) => { calls.wait++; check(port === 6742 && ms <= 45000, 'waits once, 45 s at most, on 6742'); return pc.server; };
const setupOnce = async () => { resultText = pc.result; return bl.setUp(); };

// 1. PawnIO missing: downloaded, both checks, its installer, then one admin prompt
reset();
let st = await bl.status({ fresh: true });
check(!st.setUp && st.canSetUp && !st.pawnio.installed && /Installs PawnIO 2\.2\.0/.test(st.before) && /Windows asks twice/.test(st.before) && /as administrator/.test(st.before), `before the click: what, the prompts, the chip (${st.before})`);
let r = await setupOnce();
check(r.ok && /Board, fan and RAM lights are set up/.test(r.text) && /Find lights/.test(r.text), `happy path (${r.text})`);
check(calls.download.length === 1 && calls.download[0] === P.url && calls.run.join() === 'PawnIO_setup.exe', 'PawnIO downloaded from its release and its own installer run');
check(calls.elevate.length === 1 && calls.elevate[0] === bl.setupScript(), 'exactly one admin prompt, with the setup script');
check(calls.stopBundled === 1 && calls.wait === 1, 'DeviceHub\'s USB-only OpenRGB stopped first; the server waited for once');
check(!fs.existsSync(path.join(bl.DIR, P.file)) && !fs.existsSync(path.join(bl.DIR, `${P.file}.part`)), 'the download is removed after use');

// 2. PawnIO already installed (as on Shawn's PC, 2.2.0.0): skipped
reset({ pawn: { app: true, service: true, version: '2.2.0.0' } });
st = await bl.status({ fresh: true });
check(st.pawnio.installed && st.pawnio.version === '2.2.0.0' && /PawnIO is already installed/.test(st.before) && /Windows asks once/.test(st.before), 'PawnIO there: one prompt, said so');
r = await setupOnce();
check(r.ok && calls.download.length === 0 && calls.run.length === 0 && calls.elevate.length === 1, `already-installed PawnIO is skipped (${r.text})`);

// 3. already set up: no prompt at all (idempotent)
reset({ pawn: { app: true, service: true }, task: true, copy: true });
r = await setupOnce();
check(r.ok && r.already && calls.elevate.length === 0 && calls.download.length === 0 && calls.stopBundled === 0, 'already set up: nothing is asked or changed');

// 4. download refused: wrong signer, not signed, a look-alike signer, the right signer but another file
for (const [what, x] of [['another signer', { sig: { status: 'Valid', signer: 'CN=Someone Else, O=Else' } }], ['not signed', { sig: { status: 'NotSigned', signer: null } }],
  ['a look-alike signer', { sig: { status: 'Valid', signer: 'CN=namazso.eu.evil, O=namazsoo' } }], ['a broken signature', { sig: { status: 'HashMismatch', signer: 'CN=namazso.eu, O=namazso' } }], ['another file', { sha: 'f'.repeat(64) }]]) {
  reset(x);
  r = await setupOnce();
  check(!r.ok && /was not run/.test(r.text) && /nothing was changed/.test(r.text) && calls.run.length === 0 && calls.elevate.length === 0 && calls.stopBundled === 0 && !fs.existsSync(path.join(bl.DIR, P.file)), `PawnIO with ${what}: never run, deleted (${r.text})`);
}
reset({ downloadError: 'the download went to evil.example, which is not PawnIO\'s own site; stopped' });
r = await setupOnce();
check(!r.ok && /evil\.example/.test(r.text) && calls.run.length === 0 && calls.elevate.length === 0, `a refused download: nothing run (${r.text})`);
// verifyPawnIO itself
reset();
check((await bl.verifyPawnIO('x')).ok, 'signed by namazso and the published hash: accepted');

// 5. PawnIO's prompt declined, or its installer closed without installing: stops there
reset({ run: { started: false, declined: true } });
r = await setupOnce();
check(!r.ok && /declined/.test(r.text) && /Nothing was changed/.test(r.text) && calls.elevate.length === 0, `PawnIO's prompt declined (${r.text})`);
reset({ pawnInstalls: false });
r = await setupOnce();
check(!r.ok && /not installed/.test(r.text) && calls.elevate.length === 0, `PawnIO's installer closed without installing (${r.text})`);

// 6. the admin prompt: declined, failed inside (backed out), or Windows kept nothing
reset({ pawn: { app: true, service: true }, elevate: { ok: false, declined: true } });
r = await setupOnce();
check(!r.ok && /declined/.test(r.text) && /Nothing was changed/.test(r.text) && !/PawnIO was installed/.test(r.text) && r.retry && r.uac === 'declined', `admin prompt declined: said, with Try again (${r.text})`);
reset({ elevate: { ok: false, code: 3 }, makes: false, result: 'failed|SmbusPIIX4.bin does not match its pinned SHA-256' });
r = await setupOnce();
check(!r.ok && /SmbusPIIX4\.bin does not match/.test(r.text) && /Nothing of it was left/.test(r.text) && /PawnIO was installed and stays/.test(r.text) && /Installed apps/.test(r.text), `a failed copy is backed out and said plainly; a PawnIO installed this time is named (${r.text})`);
reset({ pawn: { app: true, service: true }, elevate: { ok: false, code: 3 }, makes: false, task: true });
r = await setupOnce();
check(!r.ok && /Remove board lights/.test(r.text) && r.left, `a part Windows still lists: Remove is offered (${r.text})`);
reset({ pawn: { app: true, service: true }, makes: false });
r = await setupOnce();
check(!r.ok && /Remove board lights/.test(r.text) && calls.wait === 0, `a prompt that answered but left no task: not set up (${r.text})`);
reset({ pawn: { app: true, service: true }, server: false });
r = await setupOnce();
check(r.ok && /has not answered yet/.test(r.text), `a slow OpenRGB: set up, said so (${r.text})`);

// 7. this copy lacks the modules: refused before anything
reset({ files: false });
st = await bl.status({ fresh: true });
r = await setupOnce();
check(!st.canSetUp && /board-modules|tools\\openrgb/.test(st.why) && !r.ok && calls.download.length === 0 && calls.elevate.length === 0, `no modules in this copy: refused first (${r.text})`);

// 8. Remove board lights
reset({ pawn: { app: true, service: true }, task: true, copy: true });
r = await bl.remove();
check(r.ok && calls.elevate.length === 1 && calls.elevate[0] === bl.removeScript() && /back to USB lights only/.test(r.text) && /PawnIO stays installed/.test(r.text) && /Settings > Apps > Installed apps/.test(r.text), `removed with one prompt; PawnIO left, how to uninstall it (${r.text})`);
reset({ task: true, copy: true, elevate: { ok: false, declined: true } });
r = await bl.remove();
check(!r.ok && /declined/.test(r.text) && /Nothing was changed/.test(r.text), `remove declined (${r.text})`);
reset();
r = await bl.remove();
check(r.ok && r.already && calls.elevate.length === 0, 'nothing set up: nothing to remove, no prompt');
reset({ task: true, copy: true, makes: false });
r = await bl.remove();
check(!r.ok && /still there/.test(r.text), `a remove Windows did not finish is said (${r.text})`);

// 9. one at a time, and the route
reset({ pawn: { app: true, service: true } });
let release;
d.elevate = async () => { await new Promise((ok) => { release = ok; }); pc.task = true; pc.copy = true; return { ok: true, code: 0 }; };
const send = (res, code, body) => { res.code = code; res.body = body; };
const call = async (method, p) => { const res = {}; const handled = await bl.handle(new URL(`http://x${p}`), { method }, res, send); return { handled, ...res }; };
check((await call('GET', '/api/other')).handled === false, 'other paths are left to server.js');
let g = await call('GET', '/api/board-lights');
check(g.code === 200 && g.body.canSetUp && g.body.busy === false, 'GET /api/board-lights');
check((await call('GET', '/api/board-lights/setup')).handled === false, 'setting up is a POST only');
g = await call('POST', '/api/board-lights/setup');
check(g.code === 200 && g.body.started, 'POST setup answers at once');
check((await call('POST', '/api/board-lights/remove')).code === 409 && (await call('POST', '/api/board-lights/setup')).code === 409, 'a second job while one runs: 409');
for (let i = 0; i < 100 && !release; i++) await wait(10);
check((await call('GET', '/api/board-lights/progress')).body.done === false, 'progress: running');
release?.();
for (let i = 0; i < 100 && !bl.getProgress()?.done; i++) await wait(10);
g = await call('GET', '/api/board-lights/progress');
check(g.body.done && g.body.ok && g.body.kind === 'setup', `progress: finished (${JSON.stringify(g.body)})`);

// ---------- never at start, never by itself ----------
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const lines = server.split(/\r?\n/).filter((l) => l.includes('board-lights.mjs') && !l.trim().startsWith('//'));
check(lines.length === 1 && lines[0].includes("url.pathname.startsWith('/api/board-lights')"), 'server.js loads it only when its route is asked');
const src = fs.readFileSync(path.join(ROOT, 'helpers', 'board-lights.mjs'), 'utf8');
check(!/setInterval|\.unref\(|process\.on\(/.test(src), 'no timers or hooks of its own');

// ---------- what the control and the Setup page show ----------
const ST = { ...DEMO_BOARD, demo: false };
let v = boardView(ST, null);
check(v.action === 'setup' && v.label === ADD_LABEL && v.line === ST.before && !v.result, 'before: the plain line and Add board, fan and RAM lights');
v = boardView(ST, { done: false, text: 'Downloading PawnIO_setup.exe', pct: 40 });
check(v.busy && !v.action && v.line === 'Downloading PawnIO_setup.exe (40%)', 'while it runs: the step, no button');
v = boardView({ ...ST, setUp: true }, { done: true, ok: true, text: 'Board, fan and RAM lights are set up.' });
check(v.action === 'ask-remove' && v.label === REMOVE_LABEL && v.result.ok && /set up/.test(v.result.text), 'after: the result line, and Remove board lights');
v = boardView({ ...ST, setUp: true }, null, { confirmRemove: true });
check(v.action === 'remove' && /PawnIO stays installed/.test(v.line) && /Installed apps/.test(v.line), 'Remove asks in place, with how to uninstall PawnIO');
v = boardView({ ...ST, canSetUp: false, why: 'this copy of DeviceHub lacks its board modules' }, null);
check(!v.action && /cannot be added/.test(v.line), 'a copy without the modules: why, no button');
v = boardView({ ...ST, task: true, partial: 'The task is there but its OpenRGB copy is not.' }, { done: true, ok: false, text: 'Not set up: x.' });
check(v.action === 'setup' && v.also === 'ask-remove' && !v.result.ok && /Adding again replaces it/.test(v.line), 'a part left from a failed try: Add again or Remove');
check(DEMO_BOARD.demo && /as administrator/.test(DEMO_BOARD.before), 'demo mode has a pretend status');

const smbus = { verdict: { kind: 'smbus' } };
let row = boardRow({ ...ST }, smbus);
check(row?.status === 'needs' && row.action.kind === 'board-lights' && row.key === 'board-lights', 'Setup: an SMBus board needs you, with the one button');
check(boardRow({ ...ST, setUp: true }, smbus)?.status === 'done' && boardRow({ ...ST, setUp: true }, { verdict: { kind: 'usb' } })?.status === 'done', 'Setup: set up is done (and stays listed, to remove it)');
check(boardRow({ ...ST }, { verdict: { kind: 'usb' } }) === null && boardRow(null, smbus) === null, 'Setup: no row when the lights are on USB, or before it is read');
let rows = lightRows({ running: true, bundled: true, controllers: [] }, null, smbus, { ...ST });
check(rows.length === 2 && rows.find((x) => x.key === 'openrgb').status === 'none' && planSetup(rows).needs.map((x) => x.key).join() === 'board-lights', 'Setup: one thing needs you, not two');
rows = lightRows({ running: true, bundled: true, controllers: [] }, null, smbus);
check(rows[0].status === 'needs', 'without the board status the old row still says why');

// ---------- board-lights mode in helpers/openrgb.js (a copy on a spare port; a stand-in OpenRGB) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-board-'));
fs.writeFileSync(path.join(tmp, 'openrgb.js'), fs.readFileSync(path.join(ROOT, 'helpers', 'openrgb.js'), 'utf8').replace('PORT = 6742', 'PORT = 46744'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'safe-write.js'), path.join(tmp, 'safe-write.js'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'find-lights.js'), path.join(tmp, 'find-lights.js'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'last-answer.js'), path.join(tmp, 'last-answer.js'));
fs.writeFileSync(path.join(tmp, 'bundled-tools.json'), fs.readFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json')));
const orgb = require(path.join(tmp, 'openrgb.js'));
const od = orgb._test.deps;
const tasks = [], spawned = [];
let server2 = null;
const answer = (s) => { let buf = Buffer.alloc(0); s.on('error', () => {}); s.on('data', (x) => { buf = Buffer.concat([buf, x]); while (buf.length >= 16) { const id = buf.readUInt32LE(8), size = buf.readUInt32LE(12); if (buf.length < 16 + size) break; buf = buf.subarray(16 + size); const pk = (i, v) => { const h = Buffer.alloc(20); h.write('ORGB', 0, 'latin1'); h.writeUInt32LE(i, 8); h.writeUInt32LE(4, 12); h.writeUInt32LE(v, 16); return h; }; if (id === 40) s.write(pk(40, 3)); if (id === 0) s.write(pk(0, 0)); } }); };
od.boardSetUp = () => true;
od.runTask = async (name) => { tasks.push(name); server2 = net.createServer(answer).listen(46744, '127.0.0.1'); return true; };
od.spawn = (...a) => { spawned.push(a); throw new Error('the USB-only OpenRGB must not start in board-lights mode'); };
od.running = async () => [];
let o = await orgb.status(false);
check(!o.running && tasks.length === 0 && o.board.setUp, 'an ordinary read never runs the task');
o = await orgb.status(true);
check(o.running && o.bundled === false && tasks.join() === 'DeviceHub board lights' && spawned.length === 0, `Find lights in board-lights mode runs its task, never the USB-only copy (${JSON.stringify(o)})`);
o = await orgb.status(true);
check(o.running && tasks.length === 1, 'once running, the task is not run again');
check(orgb.BOARD.task === bl.BOARD.task && orgb.BOARD.exe === bl.BOARD.exe, 'one definition of the task and the copy');
server2?.close();
od.runTask = async (name) => { tasks.push(name); return false; };
await wait(50);
o = await orgb.status(true);
check(!o.running && /could not be started/.test(o.reason) && spawned.length === 0, `a task that does not start is said (${o.reason})`);
orgb.stop();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(fails.length ? `board-lights: FAILED: ${fails.join('; ')}` : 'board-lights (stand-in downloads, signatures, prompts, task and OpenRGB): all good');
process.exit(fails.length ? 1 : 0);
