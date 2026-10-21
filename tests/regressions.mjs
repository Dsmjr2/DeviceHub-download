// Bugs found and fixed on 20 Oct 2026, each checked so a later change cannot bring it back quietly.
// No devices, no hardware: run with `node tests/regressions.mjs` (part of npm test).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// 1. Windows script files keep Windows line endings: with Unix ones cmd loses its place after `call :now` and the
//    keep-running loop stopped after its first line (.gitattributes keeps them; this catches a file added without)
for (const f of ['DeviceHub.vbs', 'Install DeviceHub.bat', 'Start DeviceHub.bat', 'helpers/keep-running.bat']) {
  const b = fs.readFileSync(path.join(ROOT, f));
  let lf = 0; for (let i = 0; i < b.length; i++) if (b[i] === 10 && b[i - 1] !== 13) lf++;
  check(lf === 0, `${f} has ${lf} Unix line endings (cmd/wscript need Windows ones)`);
}
check(/\*\.bat text eol=crlf/.test(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')), '.gitattributes keeps .bat files in Windows line endings');

// 2. The keep-running loop checks it is DeviceHub that answers (not any program on the port), with the pipe-safe
//    %PORT% form, and does not retry when the port belongs to another program (code 4)
const kr = fs.readFileSync(path.join(ROOT, 'helpers/keep-running.bat'), 'utf8');
check(/127\.0\.0\.1:%PORT%\/api\/version.*\| findstr \/c:"version"/.test(kr), 'keep-running.bat checks the answer is DeviceHub\'s (%PORT%, findstr version)');
check(!/!PORT!\/api\/version[^\r\n]*\|/.test(kr), 'keep-running.bat uses !PORT! inside a pipe (it is not filled in there)');
check(/"!code!"=="4" exit \/b 4/.test(kr), 'keep-running.bat stops on code 4 (port taken) instead of retrying');

// 3. A write to a helper that has just stopped must not crash the server (EPIPE, 19 Oct 20:26), nor a helper that
//    cannot start at all
const nat = fs.readFileSync(path.join(ROOT, 'helpers/native.js'), 'utf8');
check(/p\.stdin\.on\('error'/.test(nat), 'native.js handles errors on the helper\'s input (EPIPE)');
check(/p\.on\('error'/.test(nat), 'native.js handles a helper that cannot start');
check(/resolve\('GONE'\); return; \}/.test(nat), 'native.js answers GONE when there is no helper instead of throwing');

// 4. The backup tidy-up keeps the first of each kind, the newest 20 and one per day for 90 days, and only touches
//    files named <kind>-<timestamp>Z.<ext>
{
  const tidy = require(path.join(ROOT, 'helpers/backup-tidy.js'));
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dh-tidy-'));
  const now = Date.parse('2026-10-20T12:00:00Z');
  const names = [];
  // 30 a day for 5 days, plus one 200 days old (the first), plus files that must never be touched
  for (let d = 0; d < 5; d++) for (let i = 0; i < 30; i++) names.push(`mouse-${new Date(now - d * 86400e3 - i * 60e3).toISOString().replace(/[:.]/g, '-')}.json`);
  names.push(`mouse-${new Date(now - 200 * 86400e3).toISOString().replace(/[:.]/g, '-')}.json`);
  names.push('settings.json', 'notes.txt', 'older-backups.zip');
  for (const n of names) fs.writeFileSync(path.join(dir, n), '{}');
  const move = new Set(tidy.plan(dir, now).map((x) => x.file));
  const mice = names.filter((n) => n.startsWith('mouse-')).sort().reverse();   // newest first
  check(!move.has(mice[mice.length - 1]), 'backup tidy keeps the first backup ever');
  check(mice.slice(0, 20).every((n) => !move.has(n)), 'backup tidy keeps the newest 20');
  check(['settings.json', 'notes.txt', 'older-backups.zip'].every((n) => !move.has(n)), 'backup tidy leaves files without a timestamp alone');
  const keptDays = new Set(mice.filter((n) => !move.has(n)).map((n) => n.slice(6, 16)));
  check(keptDays.size >= 5, `backup tidy keeps one per day (kept ${keptDays.size} of 5 days)`);
  check(move.size === mice.length - 20 - 1 - 4, `backup tidy moves the rest (moved ${move.size})`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 5. Another program on DeviceHub's port: the server says so and stops with code 4 (it used to think DeviceHub was
//    already running and leave quietly, and the window opened onto the other program). Devices and background parts
//    stay off (DEVICEHUB_AGENT=0, DEVICEHUB_TEST=1).
await new Promise((resolve) => {
  const blocker = net.createServer(() => {});                     // takes connections, never answers HTTP
  blocker.listen(0, '127.0.0.1', () => {
    const port = blocker.address().port;
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: { ...process.env, DEVICEHUB_PORT: String(port), DEVICEHUB_AGENT: '0', DEVICEHUB_TRAY: '0', DEVICEHUB_TEST: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; p.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill(); check(false, 'server with its port taken did not stop within 20 s'); blocker.close(); resolve(); }, 20000);
    p.on('exit', (code) => { clearTimeout(t); check(code === 4 && /\[start\] Port \d+ is used by another program/.test(out), `server with its port taken: exit ${code}, says "${out.trim().split('\n').pop()}"`); blocker.close(); resolve(); });
  });
});

// 9. From the review for other PCs (20 Oct 2026, evening): each of these crashed, leaked or failed on a PC unlike Shawn's
const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check(/fs\.existsSync\(VENDOR_APPS\[app\]\)/.test(srv) && /p\.on\('error', \(e\) => console\.log\(`\[open\]/.test(srv), 'Open iCUE / Open the Pulsar app checks the app is there and handles a failed start (it crashed the server)');
check(/const q = \(s\) => s\.replace\(\/'\/g, "''"\)/.test(srv) && /WorkingDirectory='\$\{q\(ROOT\)\}'/.test(srv), 'start-with-Windows shortcut quotes paths with an apostrophe (O\'Brien)');
check(/try \{ build\(\); buildFailedAt = 0; \} catch/.test(nat), 'native.js: a helper that cannot be built does not throw up into the request');
check(/req\[1\] == "CLOSE"\) lock \(channels\)/.test(fs.readFileSync(path.join(ROOT, 'helpers/native/helper.cs'), 'utf8')), 'helper.cs ends a channel\'s thread after CLOSE (one leaked per headset retry)');
check(!/h\.stop\(\);\s*\}\s*startStandby\(\);/.test(fs.readFileSync(path.join(ROOT, 'helpers/hs80-direct.js'), 'utf8')), 'hs80-direct.js starts no cable standby when no headset was found (it searched every second forever)');
check(/function sample\(\) \{ try \{/.test(fs.readFileSync(path.join(ROOT, 'helpers/battery-history.js'), 'utf8')), 'battery-history.js: the 5-minute sample never throws out of its timer');
for (const f of ['helpers/monitors.js', 'helpers/camera.js']) check(/raw === 'GONE' \|\| raw === 'TIMEOUT'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} says GONE / TIMEOUT in words instead of a JSON error`);
const un = fs.readFileSync(path.join(ROOT, 'helpers/uninstall.ps1'), 'utf8');
check(/-File `"\$copy`" -Dir `"/.test(un), 'uninstall.ps1 quotes its relaunch (a user folder with a space split the path)');
// Settings > Uninstall: a detached PowerShell never started from the hidden window, and one started inside the
// folder kept it "in use"; the Apps entry is found by its value name (InstallLocation), not its data
{ const m = /'\/api\/uninstall'[\s\S]{0,2500}?return send\(res, 200/.exec(srv)?.[0] || '';
  check(m && !/detached: true/.test(m) && /cwd: require\('os'\)\.tmpdir\(\)/.test(m) && /'\/v', 'InstallLocation'/.test(m), 'the Uninstall route starts the uninstaller not detached, outside the folder, with the right Apps entry'); }
check(/Set-Location -LiteralPath \$env:TEMP/.test(un) && /-WorkingDirectory \$env:TEMP/.test(un) && /DeviceHub-uninstall\.log/.test(un), 'uninstall.ps1 works from TEMP and writes its log');
// 10. Smoother changes (21 Oct 2026): a switch moves on the click, quick sliders send while dragged (one in flight,
//     the release still sent after a drag back to the start), a held slider is not redrawn, and changes a few seconds
//     apart share one backup
const ctl = fs.readFileSync(path.join(ROOT, 'public/ui/controls.js'), 'utf8');
check(/show\(!value\);\s*try \{ await run\(el/.test(ctl), 'a switch moves at once on a click');
check(/if \(v === value && !moved\) return;/.test(ctl) &&/if \(busy \|\| next == null \|\| next === sent\) return;/.test(ctl), 'a live slider sends one step at a time and its release after a drag back');
check(/if \(holding\) heldRender = true; else render\(false\)/.test(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8')), 'a slider being dragged is not redrawn under the pointer');
check(/Date\.now\(\) - \(lastBackupAt\[id\] \|\| 0\) < BACKUP_REUSE_MS/.test(fs.readFileSync(path.join(ROOT, 'public/core/devices.js'), 'utf8')), 'changes seconds apart share one device backup');
// 11. Updates for zip installs (21 Oct 2026): checked against size and SHA-256, the new version's checks run first,
//     and its installer started through Start-Process (as Node's own child it was ended with this DeviceHub, halfway)
const su = fs.readFileSync(path.join(ROOT, 'helpers/self-update.js'), 'utf8');
check(/rel\.sha256/.test(su) && /buf\.length !== rel\.size/.test(su) && /tests', 'check\.mjs'/.test(su), 'a zip update checks size, checksum and the new version\'s own checks');
check(/Start-Process -FilePath powershell\.exe/.test(su) && /-EncodedCommand/.test(su), 'the update installer is not a child of Node (it would end with it)');
check(/'release\.json'/.test(fs.readFileSync(path.join(ROOT, 'helpers/make-installer.ps1'), 'utf8')) && /version\.json/.test(fs.readFileSync(path.join(ROOT, 'helpers/make-installer.ps1'), 'utf8')), 'the zip carries release.json and the release version.json');
const ins = fs.readFileSync(path.join(ROOT, 'helpers/install.ps1'), 'utf8');
check(/quitting it first/.test(ins) && /Building the device helper/.test(ins) && /Unblock-File/.test(ins), 'install.ps1 quits a running copy, builds the helper and clears the downloaded-file mark');

console.log(fails.length ? `regressions: FAILED: ${fails.join('; ')}` : 'regressions (20 Oct fixes): all good');
process.exit(fails.length ? 1 : 0);
