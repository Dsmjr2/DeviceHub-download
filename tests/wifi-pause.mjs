// Pause Wi-Fi scans while gaming (helpers/wifi-pause.mjs, helpers/wifi-pause.ps1, public/core/wifi-pause.js), offline:
// every prompt, task, netsh answer and clock is a stand-in. Nothing is elevated, registered or changed on this PC; the
// real script is only started with inputs it refuses before it reads or changes anything. Run: node tests/wifi-pause.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as uac from '../helpers/uac.mjs';
uac.options.root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uac-wp-'));   // the prompt log goes to TEMP
import * as wp from '../helpers/wifi-pause.mjs';
import { wifiView, ADD_LABEL, DEMO_WIFI } from '../public/core/wifi-pause.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'helpers', 'wifi-pause.ps1');
const ps1 = fs.readFileSync(SRC, 'utf8');

// ---------- the mode allow-list ----------
check(wp.MODES.length === 2 && wp.MODES.includes('pause') && wp.MODES.includes('resume'), 'exactly two modes');
const sha = wp.SCRIPT_SHA256;
check(wp.taskArgs('pause') === `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${wp.WIFI.script}" -Mode pause -Expect ${sha}`, 'the pause task: a fixed mode and the pinned hash');
check(wp.taskArgs('resume').endsWith(`-Mode resume -Expect ${sha}`), 'the resume task: a fixed mode');
for (const bad of ['Pause', 'pause; calc', 'pause" -Command "calc', '', 'stop', 'resume\r\ncalc']) {
  let threw = false;
  try { wp.taskArgs(bad); } catch { threw = true; }
  check(threw, `taskArgs refuses mode ${JSON.stringify(bad)}`);
}
let threw = false;
try { wp.taskArgs('pause', 'x; calc'); } catch { threw = true; }
check(threw, 'taskArgs refuses a hash that is not a SHA-256');
check(ps1.includes("if (@('pause', 'resume') -cnotcontains $Mode) { exit 2 }"), 'the script accepts only pause or resume (case-sensitive)');
check(!/DeviceHub-wifi-mode|\$env:TEMP|Get-Content/i.test(ps1), 'no mode file anyone could write');

// ---------- the hash check ----------
const fileSha = crypto.createHash('sha256').update(fs.readFileSync(SRC)).digest('hex');
check(fileSha === sha, `helpers/wifi-pause.ps1 matches its pin (${fileSha})`);
check(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').includes('helpers/wifi-pause.ps1 -text'), 'git keeps its bytes exactly');
check(ps1.includes("if ($Expect -notmatch '^[0-9a-f]{64}$' -or $h -ne $Expect) { exit 3 }"), 'the script checks its own SHA-256');
check(ps1.indexOf('exit 2 }') < ps1.indexOf('exit 3 }') && ps1.indexOf('exit 3 }') < ps1.indexOf('{ exit 5 }') && ps1.indexOf('{ exit 5 }') < ps1.indexOf('$netsh = '), 'mode, then hash, then place, all before netsh');
check(ps1.includes("$netsh = Join-Path $env:SystemRoot 'System32\\netsh.exe'") && /"interface=\$name"/.test(ps1) && ps1.includes("function Test-Name([string]$n) { return ($n -and $n.Length -le 128 -and $n -notmatch '[\"\\x00-\\x1f]') }"), "Windows' own netsh, the interface name as one quoted argument, no quotes in it");
// the real script, with inputs it refuses before reading or changing anything
if (process.platform === 'win32') {
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SRC, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true }).status;
  check(run('-Mode', 'stop', '-Expect', sha) === 2, 'the real script refuses another mode (exit 2)');
  check(run('-Mode', 'Pause', '-Expect', sha) === 2, 'the real script refuses another case (exit 2)');
  check(run('-Mode', 'resume', '-Expect', 'f'.repeat(64)) === 3, 'the real script refuses a wrong hash (exit 3)');
  check(run('-Mode', 'resume') === 3, 'the real script refuses no hash (exit 3)');
  check(run('-Mode', 'resume', '-Expect', sha) === 5, 'the real script with the right hash refuses to run outside Program Files (exit 5)');
}

// ---------- the admin scripts, built exactly ----------
const S = wp.setupScript({ who: "PC\\o'brien", result: 'C:\\t\\r.txt', source: "C:\\D'H\\helpers\\wifi-pause.ps1" }).split('\r\n');
const has = (l) => S.includes(l);
check(has("$user = 'PC\\o''brien'; $src = 'C:\\D''H\\helpers\\wifi-pause.ps1'; $sha = '" + sha + "'"), 'setup: the user, the source and the pin (quotes doubled)');
check(has("  if ((Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'wifi-pause.ps1 does not match its pinned SHA-256' }"), 'setup: the copy is hashed in Program Files');
check(has(`  $ap = New-ScheduledTaskAction -Execute $ps -Argument '${wp.taskArgs('pause')}' -WorkingDirectory $dest`) && has(`  $ar = New-ScheduledTaskAction -Execute $ps -Argument '${wp.taskArgs('resume')}' -WorkingDirectory $dest`), "two tasks, Windows' powershell.exe, one fixed mode each");
check(has("  $ps = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"), "Windows' own powershell.exe by full path");
const regP = S.find((l) => l.startsWith('  Register-ScheduledTask -TaskName $tp ')), regR = S.find((l) => l.startsWith('  Register-ScheduledTask -TaskName $tr '));
check(regP && !regP.includes('-Trigger') && regR && regR.includes('-Trigger $lt') && has('  $lt = New-ScheduledTaskTrigger -AtLogOn -User $user'), 'the pause task has no trigger; the resume task has the sign-in trigger only');
check(has('  $pr = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest'), 'this user, no password stored, no window');
check(has('  Start-ScheduledTask -TaskName $tr'), 'setup ends with scans normal');
check(S.slice(S.indexOf('} catch {')).includes('  try { Drop-Tasks } catch {}'), 'any failure undoes the tasks and the folder');
check(!S.some((l) => /netsh|autoconfig/i.test(l)), 'setup itself never changes Wi-Fi');
const R = wp.removeScript({ result: 'C:\\t\\r.txt' }).split('\r\n');
const resumeAt = R.findIndex((l) => l.includes("'enabled=yes'")), dropAt = R.indexOf('  Drop-Tasks');
check(resumeAt > 0 && dropAt > resumeAt && R.includes('  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }'), 'remove: scans on first, then the tasks and the folder');
check(!R.some((l) => /enabled=no/.test(l)), 'remove never pauses');
check(ps1.includes('New-ScheduledTaskTrigger -Once -At $until.AddMinutes(1)') && ps1.includes('} catch { exit 7 }'), 'a pause sets a one-time resume at 4 hours, or does not pause');
check(/\$maxHours = 4\b/.test(ps1) && /\$dropSeconds = 10\b/.test(ps1) && ps1.includes('} finally {\n  Resume-All\n}'), "the script's watcher: 4 hours, 10 s off Wi-Fi, always resumes when it ends");

// ---------- netsh's answers ----------
const IF_WIFI = 'There is 1 interface on the system:\r\n\r\n    Name                   : Wi-Fi 2\r\n    Description            : TP-Link\r\n    State                  : connected\r\n    SSID                   : Home\r\n    Hosted network status  : Not available\r\n';
const IF_DOWN = IF_WIFI.replace('connected', 'disconnected');
const AC_ON = 'Wireless LAN settings\r\n    Auto configuration logic is enabled on interface "Wi-Fi 2"\r\n';
const AC_OFF = AC_ON.replace('enabled', 'disabled');
check(JSON.stringify(wp.parseInterfaces(IF_WIFI)) === JSON.stringify([{ name: 'Wi-Fi 2', state: 'connected' }]), 'interfaces read');
check(JSON.stringify(wp.parseAutoconfig(AC_OFF)) === JSON.stringify({ 'Wi-Fi 2': false }), 'scans off read');
check(wp.parseInterfaces('    Name : Bad"name\r\n    State : connected\r\n').length === 0, 'a name with a quote is never used');
check(wp.wifiState('', '').connected.length === 0, 'no Wi-Fi: nothing connected');

// ---------- stand-ins ----------
const pc = {};
const calls = { runTask: [], elevate: [], wifi: 0 };
const d = wp.deps;
const reset = (x = {}) => {
  Object.assign(pc, { setUp: true, ifText: IF_WIFI, acText: AC_ON, gaming: true, now: 1e12, sha, elevate: { ok: true, code: 0 }, makes: true }, x);
  calls.runTask = []; calls.elevate = []; calls.wifi = 0;
  wp._test.reset();
};
d.platform = 'win32';
d.wifi = async () => { calls.wifi++; return wp.wifiState(pc.ifText, pc.acText); };
d.task = async () => pc.setUp;
d.exists = (f) => (f === wp.WIFI.script ? pc.setUp : f === wp.SOURCE ? true : fs.existsSync(f));
d.runTask = async (name) => {
  calls.runTask.push(name);
  if (name === wp.WIFI.pauseTask) pc.acText = AC_OFF; else pc.acText = AC_ON;
  return { ok: true };
};
d.sha256 = async () => pc.sha;
d.elevate = async (script, action) => { calls.elevate.push(action); if (pc.elevate.ok && pc.makes) pc.setUp = !/remove/.test(action); if (/remove/.test(action) && pc.elevate.ok) pc.acText = AC_ON; return pc.elevate; };
d.readResult = () => (pc.elevate.ok ? 'ok' : 'failed|stand-in');
d.clearResult = () => {};
d.gamingOn = () => pc.gaming;
d.now = () => pc.now;
d.setTimer = () => ({ fake: true });
d.clearTimer = () => {};
const P = wp.WIFI.pauseTask, RS = wp.WIFI.resumeTask;

// nothing happens without setup
reset({ setUp: false });
check((await wp.profile('Gaming')).none === true && calls.runTask.length === 0, 'not set up: the Gaming profile does nothing');
check((await wp.resume('button')).ok === false && calls.runTask.length === 0, 'not set up: Resume starts nothing');
check((await wp.pause('test')).ok === false && calls.runTask.length === 0, 'not set up: no pause');
reset({ setUp: false });
check((await wp.onStart()) === null && calls.wifi === 0, 'not set up: nothing is read at start');
check((await wp.onQuit()) === null && calls.runTask.length === 0, 'not set up: nothing at quit');

// off by default: the person's switch
reset({ gaming: false });
const off = await wp.profile('Gaming');
check(off.none === true && calls.runTask.length === 0, 'switch off: the Gaming profile does not pause');

// pause on Gaming, resume on another profile
reset();
check((await wp.profile('Gaming')).ok === true && calls.runTask.join() === P && wp._test.paused() && wp._test.watching(), 'Gaming with the switch on pauses and watches');
check((await wp.profile('Desktop')).ok === true && calls.runTask.join() === [P, RS].join() && !wp._test.paused() && !wp._test.watching(), 'another profile resumes');
reset();
await wp.profile('Gaming');
await wp.profile(null);
check(calls.runTask.join() === [P, RS].join(), 'a game closing with no profile to go back to resumes');
reset({ acText: AC_OFF });
await wp.profile('Desktop');
check(calls.runTask.join() === RS, 'scans found off (not by DeviceHub): another profile resumes them');

// quit
reset();
await wp.profile('Gaming');
await wp.onQuit();
check(calls.runTask.join() === [P, RS].join(), 'DeviceHub quitting resumes');
// start
reset({ acText: AC_OFF });
await wp.onStart();
check(calls.runTask.join() === RS, 'DeviceHub starting with scans off resumes');

// disconnect: more than 10 s off Wi-Fi
reset();
await wp.profile('Gaming');
pc.ifText = IF_DOWN;
await wp.tick();
pc.now += 5000; await wp.tick();
check(calls.runTask.length === 1, 'a drop under 10 s waits');
pc.now += 6000; await wp.tick();
check(calls.runTask.join() === [P, RS].join() && !wp._test.paused(), 'off Wi-Fi for over 10 s resumes');
reset();
await wp.profile('Gaming');
pc.ifText = IF_DOWN; await wp.tick();
pc.now += 8000; pc.ifText = IF_WIFI; await wp.tick();
pc.now += 8000; await wp.tick();
check(calls.runTask.length === 1, 'a short drop that comes back does not resume');

// timeout
reset();
await wp.profile('Gaming');
pc.now += wp.MAX_MS - 1000; await wp.tick();
check(calls.runTask.length === 1, 'before 4 hours: still paused');
pc.now += 1000; await wp.tick();
check(calls.runTask.join() === [P, RS].join() && wp.MAX_MS === 4 * 3600 * 1000, 'at 4 hours: resumed');

// the cable case
reset({ ifText: '' });
const cable = await wp.status({ fresh: true });
check(cable.show === false && cable.inUse === false, 'on a cable: nothing to show');
check(wifiView(cable, null).show === false, 'on a cable: the page draws nothing');
check((await wp.profile('Gaming')).ok === false && calls.runTask.length === 0, 'on a cable: Gaming does not pause');
reset({ ifText: IF_DOWN, acText: AC_OFF });
const idleOff = await wp.status({ fresh: true });
check(idleOff.show === true && idleOff.scans === 'paused' && wifiView(idleOff).resume === true, 'scans off with no Wi-Fi in use: still shown, with Resume');

// ---------- setup and removal ----------
reset({ setUp: false, sha: 'f'.repeat(64) });
let j = await wp.setUp();
check(!j.ok && /SHA-256 does not match/.test(j.text) && calls.elevate.length === 0, `a changed script is refused before the prompt (${j.text})`);
reset({ setUp: false });
j = await wp.setUp();
check(j.ok && calls.elevate.join() === 'set up Wi-Fi pause' && calls.runTask.length === 0, `setup: one prompt, nothing paused (${j.text})`);
reset({ setUp: false, elevate: { ok: false, declined: true } });
j = await wp.setUp();
check(!j.ok && j.retry && /declined/.test(j.text), 'a declined prompt: Try again');
reset();
await wp.profile('Gaming');
j = await wp.remove();
check(j.ok && calls.elevate.join() === 'remove Wi-Fi pause' && !wp._test.paused() && /scans are on/.test(j.text), `remove: one prompt, scans on, gone (${j.text})`);

// ---------- what the page shows ----------
const base = { ...DEMO_WIFI, demo: false };
check(wifiView({ ...base, setUp: false, task: false, copy: false }).label === ADD_LABEL, 'before setup: the one button');
const paused = wifiView({ ...base, scans: 'paused', gaming: true });
check(paused.lines[0] === 'Wi-Fi scans: paused.' && paused.resume === true && paused.gaming === true, 'paused: the state and Resume');
const normal = wifiView(base);
check(normal.lines[0] === 'Wi-Fi scans: normal.' && !normal.resume && normal.gaming === false, 'normal: the state, the switch off by default');
check(wifiView(base, null, { confirmRemove: true }).label === 'Yes, remove', 'Remove is confirmed in place');
check(wifiView(null).show === false, 'not read yet: nothing');

if (fails.length) { console.log(`wifi-pause: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('wifi-pause: all checks passed');
process.exit(0);
