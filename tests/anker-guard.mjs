// Offline test (15 Nov 2026, work map job 7): helpers/anker-guard.js, the Anker camera mic kept muted unless a Google
// Meet or Chat call uses it. Every outside call is a stand-in (the audio list, the mic-guard look at Chrome, the
// mute); a temp settings.json switches the guard. Nothing touches Windows' sound.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guard = require('../helpers/anker-guard.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-anker-'));
const SETTINGS = path.join(TMP, 'settings.json');
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the stand-in PC
const mic = { id: 'm1', name: 'Microphone (Anker PowerConf C200)', flow: 'recording', muted: false };
const other = { id: 'h1', name: 'Headset Microphone (CORSAIR HS80)', flow: 'recording', muted: false };
let look = { chromeMic: false, titles: [] };
let micThere = true, failing = false;
const sets = [], logs = [];
const call = async (action, body) => {
  if (failing) throw new Error('helper restarting');
  if (action === 'audio-list') return { endpoints: micThere ? [other, mic] : [other] };
  if (action === 'mic-guard') return { look };
  if (action === 'audio-set') { sets.push(body); const ep = [mic, other].find((e) => e.id === body.id); ep.muted = body.muted; return { muted: ep.muted }; }
  throw new Error(`unexpected ${action}`);
};
const log = (e) => logs.push(e.text);
// settings.json with a new modification time each write (the guard reads it again only when that changes)
let mt = Math.floor(Date.now() / 1000);
const setGuard = (on) => { fs.writeFileSync(SETTINGS, JSON.stringify(on == null ? {} : { ankerGuard: on })); mt += 10; fs.utimesSync(SETTINGS, mt, mt); };
// one check: start runs the first tick at once
const tick = async () => { guard.stop(); guard.start(call, log, SETTINGS); await wait(40); guard.stop(); };

try {
  setGuard(null);
  await tick();
  check(!sets.length && !mic.muted, 'off by default: nothing muted');
  check(guard.state().enabled === false, 'state says off');

  setGuard(true);
  await tick();
  check(mic.muted && sets.length === 1 && sets[0].id === 'm1', 'on: the Anker mic is muted (only it)');
  check(!other.muted, 'the headset mic is never touched');
  check(logs.some((l) => /muted \(no Meet or Chat call\)/.test(l)), 'one Activity line for the mute');

  look = { chromeMic: true, titles: ['Meeting notes - Google Docs', 'YouTube'] };
  await tick();
  check(mic.muted, 'Chrome using the mic with no Meet or Chat window: still muted ("Meeting" is not Meet)');

  look = { chromeMic: true, titles: ['Meet - abc-defg-hij - Google Chrome'] };
  await tick();
  check(!mic.muted && guard.state().inCall, 'a Meet call using the mic: unmuted');

  look = { chromeMic: true, titles: ['YouTube - Google Chrome'] };
  await tick();
  check(!mic.muted, 'switching tabs mid-call never cuts the mic off');

  look = { chromeMic: false, titles: ['YouTube - Google Chrome'] };
  await tick();
  check(mic.muted && !guard.state().inCall, 'the call ends (Chrome stops using the mic): muted again');

  look = { chromeMic: true, titles: ['Chat - Google Chat'] };
  await tick();
  check(!mic.muted, 'a Google Chat call counts too');
  look = { chromeMic: false, titles: [] };
  await tick();
  check(mic.muted, 'and mutes again after it');

  // guard switched off: a mute it set is taken back
  setGuard(false);
  await tick();
  check(!mic.muted && logs.some((l) => /unmuted \(guard off\)/.test(l)), 'guard off: its own mute is taken back');
  // a mute the person set themselves is left alone
  mic.muted = true;
  const before = sets.length;
  await tick();
  check(mic.muted && sets.length === before, 'guard off: a mute it did not set is left alone');
  mic.muted = false;

  // Mic check's test: on for the test, back off after
  setGuard(true);
  await tick();
  check(mic.muted, 'guard on again: muted');
  const id = await guard.testing(true);
  check(id === 'm1' && !mic.muted, 'a Mic check test unmutes it');
  await tick();
  check(!mic.muted, 'and the guard leaves it on during the test');
  guard.stop();
  await guard.testing(false);
  check(mic.muted, 'the test ends: muted again (guard on)');

  // a test is cut off after 35 s
  await guard.testing(true);
  const realNow = Date.now;
  Date.now = () => realNow() + 36000;
  try { await tick(); } finally { Date.now = realNow; }
  check(mic.muted, 'a test over 35 s is ended and muted');

  // guard off: the test puts back the mute it had before
  setGuard(false);
  await tick();
  mic.muted = true;
  await guard.testing(true);
  check(!mic.muted, 'guard off, muted by the person: the test unmutes it');
  await guard.testing(false);
  check(mic.muted, 'guard off: the test ends with the mute it had before');
  mic.muted = false;
  await guard.testing(true);
  await guard.testing(false);
  check(!mic.muted, 'guard off, unmuted before: stays unmuted after the test');

  // quitting during a test (guard on): muted again
  setGuard(true);
  await tick();
  await guard.testing(true);
  await guard.shutdown();
  check(mic.muted, 'DeviceHub quitting during a test mutes it again');

  // no Anker mic, or the helper failing: nothing breaks
  micThere = false;
  let threw = null;
  try { await guard.testing(true); } catch (e) { threw = e; }
  check(threw && /not in Windows/.test(threw.message), 'a test with no Anker mic says so');
  const s0 = sets.length;
  await tick();
  check(sets.length === s0, 'no Anker mic: nothing set');
  micThere = true; failing = true;
  await tick();
  check(true, 'a failing helper does not throw out of the check');
} finally {
  guard.stop();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`anker-guard (muted unless a Meet or Chat call, Mic check test, guard off, quit): all ${n} passed`);
process.exit(0);
