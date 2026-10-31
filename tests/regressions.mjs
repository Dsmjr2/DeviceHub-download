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
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: { ...process.env, DEVICEHUB_PORT: String(port), DEVICEHUB_AGENT: '0', DEVICEHUB_TRAY: '0', DEVICEHUB_TEST: '1', DEVICEHUB_ISOLATED: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
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
// (23 Oct 2026: the switch keeps its own state, so the side it moves to is `next`)
check(/show\(next\);\s*try \{ await run\(el/.test(ctl), 'a switch moves at once on a click');
// (31 Oct 2026: compared with the value last committed, so a slider moved back to where it was drawn is sent too)
check(/if \(v === cur && !moved\) return;\s*const was = cur;\s*moved = false; cur = v;/.test(ctl) &&/if \(busy \|\| next == null \|\| next === sent\) return;/.test(ctl), 'a live slider sends one step at a time and its release after a drag back');
check(/if \(holding\) heldRender = true; else render\(false\)/.test(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8')), 'a slider being dragged is not redrawn under the pointer');
check(/Date\.now\(\) - \(lastBackupAt\[id\] \|\| 0\) < BACKUP_REUSE_MS/.test(fs.readFileSync(path.join(ROOT, 'public/core/devices.js'), 'utf8')), 'changes seconds apart share one device backup');
// 11. Updates for zip installs (21 Oct 2026): checked against size and SHA-256, the new version's checks run first,
//     and its installer started through Start-Process (as Node's own child it was ended with this DeviceHub, halfway)
const su = fs.readFileSync(path.join(ROOT, 'helpers/self-update.js'), 'utf8');
check(/rel\.sha256/.test(su) && /buf\.length !== rel\.size/.test(su) && /tests', 'check\.mjs'/.test(su), 'a zip update checks size, checksum and the new version\'s own checks');
check(/Start-Process -FilePath powershell\.exe/.test(su) && /-EncodedCommand/.test(su), 'the update installer is not a child of Node (it would end with it)');
check(/'release\.json'/.test(fs.readFileSync(path.join(ROOT, 'helpers/make-installer.ps1'), 'utf8')) && /version\.json/.test(fs.readFileSync(path.join(ROOT, 'helpers/make-installer.ps1'), 'utf8')), 'the zip carries release.json and the release version.json');
// 12. Changes made on a PC survive updates (21 Oct 2026): folders are merged with robocopy (Copy-Item onto an existing
//     folder nested the new one inside it, so reinstalls kept the old code), nothing is copied over a changed file,
//     added devices live in my-devices/ (ignored by git, never in the zip's file list), copies installed with git
//     merge new versions with their own changes, and the journal is never published
const ins0 = fs.readFileSync(path.join(ROOT, 'helpers/install.ps1'), 'utf8');
check(/robocopy \$_\.FullName \$dest \/E \/IS \/IT/.test(ins0) && !/Copy-Item \$_\.FullName \(Join-Path \$Target \$_\.Name\) -Recurse/.test(ins0), 'the installer merges folders with robocopy, not Copy-Item -Recurse');
check(/release-files\.json/.test(ins0) && /exit 3/.test(ins0) && /\[switch\]\$Overwrite/.test(ins0), 'the installer refuses to copy over files changed on the PC');
check(/'DeviceHub-download'/.test(ins0) && /reset -q \$rel\.appCommit/.test(ins0), 'an install is tied to its published version for merging updates');
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
check(/^my-devices\/\*$/m.test(gi) && /^!my-devices\/_example\/$/m.test(gi), 'devices added on a PC are not part of DeviceHub (only the example is)');
check(/merge', '--no-edit'/.test(su) && /'merge', '--abort'/.test(su) && /changedFiles\(\)/.test(su), 'a shared copy merges updates, backs out of a clash, and a zip copy refuses over changed files');
check(/\$_ -ne 'JOURNAL\.md'/.test(fs.readFileSync(path.join(ROOT, 'helpers/publish-code.ps1'), 'utf8')), 'the journal is never published');
const ins = fs.readFileSync(path.join(ROOT, 'helpers/install.ps1'), 'utf8');
check(/quitting it first/.test(ins) && /Building the device helper/.test(ins) && /Unblock-File/.test(ins), 'install.ps1 quits a running copy, builds the helper and clears the downloaded-file mark');

// 13. Search finds single settings by reading the pages' own code (21 Oct 2026): every file it reads exists, and the
//     pattern it reads still matches the way the pages write their settings
const fsrc = fs.readFileSync(path.join(ROOT, 'public/ui/find-settings.js'), 'utf8');
const files = [...fsrc.match(/const FILES = \{([\s\S]*?)\};/)[1].matchAll(/'?([a-z-]+)'?: '[a-z-]+'/g)].map((m) => m[1]);
check(files.length >= 10 && files.every((f) => fs.existsSync(path.join(ROOT, 'public/pages', `${f}.js`))), `Search reads every page file it names (${files.join(', ')})`);
const mouseSrc = fs.readFileSync(path.join(ROOT, 'public/pages/mouse.js'), 'utf8');
check(/row\('Lift-off distance', '[^']+'/.test(mouseSrc) && /h\('h2', \{\}, 'Tracking'\)/.test(mouseSrc), 'Search finds Mouse > Lift-off distance and the Tracking section');

// 14. Two USB headsets (22 Oct 2026, public/core/headset-pick.js): the picker's choices, the HS80 first and as
//     before when nothing is picked, the picked one run instead, and Equalizer APO following the pick
{
  const hp = await import('../public/core/headset-pick.js');
  const ep = (n) => [{ id: `{0.0.0.00000000}.{p${n}}` }];
  const HS = { usb: 'VID_1B1C&PID_0A6B', device: 'CORSAIR HS80 RGB Wireless Gaming Headset', playback: ep(1), recording: [{ id: '{0.0.1.00000000}.{m1}' }] };
  const HS_CABLE = { ...HS, usb: 'VID_1B1C&PID_0A69' };
  const NOVA = { usb: 'VID_1038&PID_12E0', device: 'Arctis Nova 7 Wireless Gaming Headset', playback: ep(2), recording: [{ id: '{0.0.1.00000000}.{m2}' }] };
  const CLOUD = { usb: 'VID_03F0&PID_0B92', device: 'HyperX Cloud III', playback: ep(3), recording: [{ id: '{0.0.1.00000000}.{m3}' }] };
  const keys = (l, o) => hp.headsetChoices(l, o).map((c) => c.key).join(',');
  check(keys([HS]) === 'hs80' && !hp.showPicker(hp.headsetChoices([HS])), 'one HS80: one choice, no picker');
  check(keys([NOVA, HS, HS_CABLE]) === 'hs80,VID_1038&PID_12E0', 'HS80 first, its two USB ids as one headset');
  check(keys([NOVA], { hs80: true }) === 'hs80,VID_1038&PID_12E0' && hp.showPicker(hp.headsetChoices([NOVA], { hs80: true })), 'a connected HS80 Windows does not list is still a choice');
  check(keys([HS, NOVA], { asGeneric: true }) === 'VID_1B1C&PID_0A6B,VID_1038&PID_12E0', 'DEVICEHUB_HEADSET_GENERIC: the HS80 listed as any headset');
  check(hp.headsetChoices([NOVA])[0].name === 'Arctis Nova 7', 'short picker names');
  check(hp.cleanPick('vid_1038&pid_12e0') === 'VID_1038&PID_12E0' && hp.cleanPick('hs80') === 'hs80' && hp.cleanPick('x') === null && hp.cleanPick(5) === null, 'only hs80 or a USB id is a pick');
  check(hp.genericFor([HS, NOVA, CLOUD], null) === NOVA && hp.genericFor([HS, NOVA, CLOUD], 'VID_03F0&PID_0B92') === CLOUD && hp.genericFor([HS, NOVA], 'VID_03F0&PID_0B92') === NOVA, 'without the HS80: the picked one if plugged in, else the first');
  check(hp.chosenOther([HS, NOVA], 'hs80') === null && hp.chosenOther([HS, NOVA], null) === null && hp.chosenOther([HS, NOVA], 'VID_1B1C&PID_0A6B') === null, 'no pick or the HS80 picked: the HS80 tried first, as before');

  // the adapter itself, over a pretend Corsair helper (no hardware): what it connects to
  const ad = await import('../public/devices/headset-adapter.js');
  let list = [HS, NOVA], hs80Here = true;
  const calls = [];
  ad.setCorsairCall(async (action, body) => {
    calls.push(action);
    if (action === 'usb-headsets') return { headsets: list };
    if (action === 'icue-running') return { running: false };
    if (action === 'direct-open') return { found: hs80Here };
    if (action === 'direct-read') return { values: { battery: { value: 640 } }, connection: 'receiver' };
    if (action === 'audio-list') return { endpoints: [] };
    if (action === 'light-settings') return { logoBrightness: 50, micLight: true, logoColor: '#ff6a1a' };
    if (action === 'sidetone' || action === 'mic-boost') return {};
    throw new Error(`unexpected ${action}`);
  });
  const h = ad.default;
  ad.setHeadsetPick(null);
  calls.length = 0;
  check(await h.connect() && h.mode === 'direct' && !calls.includes('usb-headsets'), 'no pick: the HS80 connects exactly as before (no extra look first)');
  await h.read();
  check(h.picked === 'hs80' && hp.showPicker(h.headsets), 'HS80 running with a second headset: the picker shows, on the HS80');
  // final audit (22 Oct 2026): nothing picked, so no other headset to switch to: the list is not read again every 30 s
  {
    const realNow = Date.now, n0 = calls.filter((c) => c === 'usb-headsets').length;
    Date.now = () => realNow() + 31000;
    try { await h.read(); Date.now = () => realNow() + 62000; await h.read(); } finally { Date.now = realNow; }
    check(calls.filter((c) => c === 'usb-headsets').length === n0 && n0 === 1, `no pick: Windows' USB headset list is read once, not every 30 s (${calls.filter((c) => c === 'usb-headsets').length} reads)`);
  }
  ad.setHeadsetPick('VID_1038&PID_12E0');
  let threw = null; try { await h.read(); } catch (e) { threw = e; }
  check(threw?.gone, 'another headset picked: the HS80 read lets go so it can switch');
  check(await h.connect() && h.mode === 'generic' && h.picked === 'VID_1038&PID_12E0' && h.title === NOVA.device, 'picked headset connects in sound-only mode');
  const v = await h.read();
  check(v.headsetOn === true && !('prop:batteryLevel' in v) && !('led' in v), 'second headset: sound only (no battery, no lights)');
  let refused = false; try { await h.write('micLight', true); } catch { refused = true; }
  check(refused, 'second headset: the HS80 mic light write is refused');
  list = [HS];
  threw = null; try { await h.read(); } catch (e) { threw = e; }
  check(threw?.gone, 'picked headset unplugged: it lets go');
  check(await h.connect() && h.mode === 'direct', 'picked headset unplugged: back on the HS80');
  list = [HS, NOVA]; ad.setHeadsetPick('hs80');
  check(await h.connect() && h.mode === 'direct', 'HS80 picked: the HS80');
  hs80Here = false; list = [NOVA, CLOUD]; ad.setHeadsetPick('VID_03F0&PID_0B92');
  check(await h.connect() && h.picked === 'VID_03F0&PID_0B92', 'no HS80, two others: the picked one');
  ad.setHeadsetPick(null);
  threw = null; try { await h.read(); } catch (e) { threw = e; }
  check(threw?.gone && (await h.connect()) && h.picked === 'VID_1038&PID_12E0', 'no HS80, pick cleared: the first one, as before');

  // Equalizer APO: the picked headset takes the headset's place; no pick or the HS80: unchanged
  const { withPick } = require(path.join(ROOT, 'helpers/headset-pick-eq.js'));
  const base = { headset: ['{p1}'], mic: ['{m1}'], speakers: [{ guid: '{p2}', name: 'Arctis' }, { guid: '{s9}', name: 'Monitor' }], mics: [{ guid: '{m2}', name: 'Arctis mic' }], headsetModel: 'HS80' };
  let saved = null;
  const dv = withPick(async () => base, { readPick: () => saved, listHeadsets: async () => [HS, NOVA] });
  check((await dv()) === base, 'EQ: no pick, the same devices as before');
  saved = 'hs80'; check((await dv()) === base, 'EQ: HS80 picked, the same devices as before');
  saved = 'VID_1038&PID_12E0';
  const got = await dv();
  check(got.headset.join() === '{p2}' && got.mic.join() === '{m2}' && got.headsetModel === NOVA.device && got.speakers.map((s) => s.guid).join() === '{s9}' && !got.mics.length, 'EQ: the picked headset gets the headset EQ and mic tools, and is no longer a speaker');
  saved = 'VID_03F0&PID_0B92'; check((await dv()) === base, 'EQ: picked headset not plugged in, as before');
  // the setting is kept by the settings route (it keeps keys it does not know) and the agent backs it up first
  const ag = fs.readFileSync(path.join(ROOT, 'helpers/agent.mjs'), 'utf8');
  check(/case 'headset-pick'/.test(ag) && /copyFileSync\(SETTINGS_FILE/.test(ag) && /headsetPick: k/.test(ag), 'agent: headset-pick backs up settings.json and saves the choice');
  check(/const cur = readJsonFile\(SETTINGS, \{\}\);/.test(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')), 'server: a settings change starts from the whole file (headsetPick is kept)');
}

// 15. The Mic check follows the picked headset (22 Oct 2026, public/core/mic-test-pick.js): the HS80 picked or the
//     only one = server.js's /api/mictest/start exactly as before; another headset = its own mic by its USB id
{
  const mt = await import('../public/core/mic-test-pick.js');
  const NOVA = { usb: 'VID_1038&PID_12E0', device: 'Arctis Nova 7 Wireless Gaming Headset' };
  const HSG = { usb: 'VID_1B1C&PID_0A6B', device: 'CORSAIR HS80 RGB Wireless Gaming Headset' };
  check(mt.micTestUsb(null) === null && mt.micTestUsb(HSG) === null && mt.micTestUsb({ usb: 'junk' }) === null && mt.micTestUsb(NOVA) === 'VID_1038&PID_12E0', 'mic check: only a non-HS80 pick leaves the HS80 path');
  check(mt.micTestId([{ flow: 'recording', id: 'a', state: 1 }, { flow: 'recording', id: 'b', state: 1, wired: true }, { flow: 'playback', id: 'c', state: 1 }]) === 'b', 'mic check: the cable mic first');
  check(mt.micTestId([{ flow: 'recording', id: 'a', state: 4 }, { flow: 'playback', id: 'c', state: 1 }]) === null && mt.micTestId(null) === null, 'mic check: no working mic, nothing to record');
  const hsMatch = mt.micMatcher(null, []);
  check(hsMatch('Microphone (CORSAIR HS80 RGB Wireless)') && !hsMatch('Microphone (Arctis Nova 7)'), 'mic meter: no pick, the HS80 mic as before');
  const nMatch = mt.micMatcher(NOVA, [{ flow: 'recording', name: 'Microphone (Arctis Nova 7)' }, { flow: 'playback', name: 'Headphones (Arctis Nova 7)' }]);
  check(nMatch('Microphone (Arctis Nova 7)') && nMatch('Headset Mic (1038:12e0)') && !nMatch('Microphone (CORSAIR HS80 RGB Wireless)') && !nMatch(''), 'mic meter: the picked headset mic, by Windows name or USB id, not the HS80');
  const calls = [];
  const fake = (eps) => async (p, b) => {
    calls.push([p, b]);
    if (p === '/api/mictest/start') return { recording: true, headsetMic: true };
    if (p === '/api/corsair/hs80-endpoints') return { endpoints: eps };
    if (p === '/api/corsair/mic-rec-start') return { ok: true, rec: { recording: true, id: b.id } };
    throw new Error(`unexpected ${p}`);
  };
  const desc = () => calls.map(([p, b]) => `${p} ${JSON.stringify(b)}`).join(' | ');
  await mt.startMicTest(fake([]), { mic: 'headset', generic: null });
  check(desc() === '/api/mictest/start {"mic":"headset"}', `mic check: no pick, the same request as before (${desc()})`);
  calls.length = 0; await mt.startMicTest(fake([]), { mic: 'headset', generic: HSG });
  check(desc() === '/api/mictest/start {"mic":"headset"}', 'mic check: HS80 running as any headset, still the HS80 request');
  calls.length = 0; await mt.startMicTest(fake([]), { mic: 'anker', generic: NOVA });
  check(desc() === '/api/mictest/start {"mic":"anker"}', 'mic check: the AnkerCamera as before');
  calls.length = 0;
  const r = await mt.startMicTest(fake([{ flow: 'recording', id: 'nova-mic', state: 1 }, { flow: 'playback', id: 'nova-out', state: 1 }]), { mic: 'headset', generic: NOVA });
  check(desc() === '/api/corsair/hs80-endpoints {"usb":"VID_1038&PID_12E0"} | /api/corsair/mic-rec-start {"id":"nova-mic"}' && r.headsetMic && r.recording, `mic check: another headset picked, its own mic recorded (${desc()})`);
  calls.length = 0; let err = null;
  try { await mt.startMicTest(fake([{ flow: 'recording', id: 'nova-mic', state: 4 }]), { mic: 'headset', generic: NOVA }); } catch (e) { err = e; }
  check(/not found/.test(err?.message || '') && !calls.some(([p]) => p.endsWith('mic-rec-start')), 'mic check: picked headset off, no recording of another mic');
  const mm = fs.readFileSync(path.join(ROOT, 'public/pages/mic-meter.js'), 'utf8');
  check(/startMicTest\(env\.api/.test(mm) && /micMatcher\(/.test(mm) && !/set-default/.test(mm), 'mic check page uses the pick and never changes Windows defaults');
}

// 16. The HS80 shows Charging near full too (22 Oct 2026, Shawn's HS80 measured at 99%: 4,183 mV on a wall charger,
//     4,055 mV a minute after unplugging; at 32%: 4,168 mV charging, 3,723 / 3,735 mV at rest)
{
  const { chargerLifted } = await import('../public/devices/headset-adapter.js');
  for (const [pct, mv, want] of [[99, 4183, true], [99, 4055, false], [32, 4168, true], [32, 3723, false], [32, 3735, false], [100, 4100, false], [80, 4140, false]])
    check(chargerLifted(pct, mv) === want, `charging by voltage: ${pct}% at ${mv} mV reads ${want ? 'charging' : 'not charging'}`);
}

// 17. Every backdrop in the Appearance list is kept when saved (22 Oct 2026, Shawn: "why isnt it saving my prefrences
//     when I reload the app": the server dropped Verde, which was missing from its list)
{
  const themeSrc = fs.readFileSync(path.join(ROOT, 'public/core/theme.js'), 'utf8');
  const keys = [...themeSrc.slice(themeSrc.indexOf('export const THEME_BGS'), themeSrc.indexOf('const OLD_BGS')).matchAll(/\[\s*'([a-z-]+)',\s*'[^']+',\s*'#/g)].map((m) => m[1]);
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const allowed = serverSrc.match(/cur\.themeBg && !\[([^\]]+)\]/)?.[1] || '';
  check(keys.length >= 5, `backdrops found in theme.js (${keys.length})`);
  for (const k of keys) check(allowed.includes(`'${k}'`), `the server keeps the ${k} backdrop when saved`);
}

// 18. Every drawing look in the Appearance list is kept when saved or imported, and Crimson ('duo') is gone and saved
//     as Aero (26 Oct 2026, Shawn: "remove the crimson theme and replace it with a cool frutiger aero theme instead")
{
  const themeSrc = fs.readFileSync(path.join(ROOT, 'public/core/theme.js'), 'utf8');
  const list = themeSrc.match(/export const ART_STYLES = \[(.+)\];/)?.[1] || '';
  const keys = [...list.matchAll(/\['([a-z]+)',\s*'[^']+'\]/g)].map((m) => m[1]);
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const lists = [...serverSrc.matchAll(/cur\.artStyle && !\[([^\]]+)\]/g)].map((m) => m[1]);
  check(keys.length >= 8, `looks found in theme.js (${keys.length})`);
  check(lists.length === 2, `the server checks the look in both places it is written (settings, import): ${lists.length}`);
  check(keys.includes('aero') && !keys.includes('duo') && !/Crimson/.test(list), 'Aero is in the list and Crimson is not');
  for (const allowed of lists) for (const k of keys) check(allowed.includes(`'${k}'`), `the server keeps the ${k} look when saved`);
  check(/duo: 'aero'/.test(themeSrc) && /pop: 'aero'/.test(themeSrc), 'a saved Crimson (duo) or Pop shows as Aero');
  check((serverSrc.match(/cur\.artStyle === 'duo' \|\| cur\.artStyle === 'pop'\) cur\.artStyle = 'aero'/g) || []).length === 2, 'the server saves a Crimson as Aero');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  check(!/data-art(-preview)?="duo"|data-look="duo"/.test(css), 'no Crimson rules left in style.css');
  check(/data-art-preview="aero"/.test(css) && /data-look="aero"/.test(css), 'Aero has its drawing and tile rules');
}

console.log(fails.length ? `regressions: FAILED: ${fails.join('; ')}` : 'regressions (20 Oct fixes): all good');
process.exit(fails.length ? 1 : 0);
