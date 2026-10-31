// The Anker camera mic stays muted in Windows unless a Google Meet or Google Chat call is using a microphone (19 Oct
// 2026, Shawn: "always muted UNLESS I am using google meet or google chat. I do not want it constantly listening").
// Every 2 s: Chrome is using a mic (Windows' own record) AND a Chrome window shows Meet or Chat, so the mic is on;
// once a call turned it on it stays on until Chrome stops using the mic (switching tabs mid-call never cuts it off).
// Anything else: muted (apps that open it get silence). On with settings.json "ankerGuard": true (20 Oct 2026: off
// by default, so a new PC with the same camera is not muted until its owner switches this on).
const fs = require('fs');
const power = require('./power');

const CALL = /(^|[^a-z])Meet([^a-z]|$)|Google Meet|meet\.google\.com|Google Chat|Huddle|Chat - /i;
const ANKER = /Anker|PowerConf/i;
let call, log, settingsFile, timer, busy = false, inCall = false, last = null, testUntil = 0;
// weMuted: the guard muted it (so switching the guard off unmutes it again); test: a Mic check test is recording it
let weMuted = false, test = null;  // test: { prev } the mute it had before the test

let enabledAt = -1, enabledWas = false;
const enabled = () => {
  try { const m = fs.statSync(settingsFile).mtimeMs; if (m !== enabledAt) { enabledAt = m; enabledWas = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).ankerGuard === true; } return enabledWas; } catch { return false; }
};
const findMic = async () => (await call('audio-list', { match: '(' })).endpoints.find((e) => e.flow === 'recording' && ANKER.test(e.name));

async function tick() {
  if (busy) return; busy = true;
  try {
    if (!test && !weMuted && !enabled()) { last = null; return; }
    const mic = await findMic();
    if (!mic) { last = null; return; }
    if (test && Date.now() > testUntil) await endTest(mic);  // the 35 s limit
    if (!enabled()) {
      // guard off: a mute it set is taken back; during a test the mic stays on
      if (!test && weMuted && mic.muted) { await call('audio-set', { id: mic.id, muted: false }); log({ kind: 'info', text: 'Anker mic unmuted (guard off)' }); }
      weMuted = false; last = null; return;
    }
    const look = (await call('mic-guard', {})).look;
    if (!look.chromeMic) inCall = false;
    else if (look.titles.some((t) => CALL.test(t))) inCall = true;
    const want = !inCall && !test;  // muted unless a call or a Mic check test uses it
    if (mic.muted !== want) {
      const r = await call('audio-set', { id: mic.id, muted: want });
      if (r.muted === want && !test) log({ kind: 'info', text: want ? 'Anker mic muted (no Meet or Chat call)' : 'Anker mic on for a Google Meet or Chat call' });
    }
    if (want) weMuted = true;
    last = want;
  } catch { /* the audio helper is restarting; next tick */ } finally { busy = false; }
}

// a test ends: with the guard on, the next check mutes it; with the guard off, it gets the mute it had before
async function endTest(mic) {
  const t = test; test = null; testUntil = 0;
  if (!t || enabled()) return;
  mic = mic || await findMic();
  if (mic && t.prev && !mic.muted) await call('audio-set', { id: mic.id, muted: true });
}

// Mic check's AnkerCamera test: unmute it now and keep it on for the test (at most 35 s); off again when it ends.
// Only the test that is running is ended (19 Oct 2026: a new test's "clear the old one" ended the new test).
async function testing(on) {
  if (on) {
    const mic = await findMic();
    if (!mic) throw new Error('the Anker camera mic is not in Windows');
    test = { prev: test ? test.prev : mic.muted }; testUntil = Date.now() + 35000;
    if (mic.muted) await call('audio-set', { id: mic.id, muted: false });
    return mic.id;
  }
  if (!test) return null;
  await endTest();
  await tick();
  return null;
}

// DeviceHub quitting during a test: the mic gets muted again (best effort)
async function shutdown() { stopped = true; clearTimeout(timer); const t = test; test = null; testUntil = 0; if (!t) return; try { const mic = await findMic(); if (mic && !mic.muted && (enabled() || t.prev)) await call('audio-set', { id: mic.id, muted: true }); } catch {} }

// every 2 s (6 s on battery with the battery saver)
let stopped = false;
const loop = () => { if (stopped) return; tick().finally(() => { if (!stopped) timer = setTimeout(loop, power.every(2000)); }); };
function start(corsairCall, logFn, file) { call = corsairCall; log = logFn; settingsFile = file; stopped = false; loop(); }
function stop() { stopped = true; clearTimeout(timer); }
const state = () => ({ enabled: enabled(), inCall, muted: last });
module.exports = { start, stop, state, testing, shutdown };
