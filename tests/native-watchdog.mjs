// Offline test (15 Nov 2026, work map job 3): helpers/native.js's own safety paths, run against a stand-in helper
// (tests/lib/standin-helper.mjs), no device and no real helper:
// - timeout counting: three timeouts in a row on one channel, the oldest over a minute ago, restart the helper; fewer,
//   a newer first one, an answer in between, or the watchdog's own channel do not
// - GONE on exit: requests still waiting answer GONE at once when the helper stops
// - heartbeat: a frozen helper is restarted, a healthy one is not
// - restartFrozen: at most 6 restarts an hour, then only a note
// - the Rust helper: each stop is counted and handed to the helper choice, which then falls back (problem reported)
// Time: Date.now is moved forward by hand (the "over a minute" rule), and the heartbeat's 10 s wait is shortened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeStandIn } from './lib/standin-helper.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-watchdog-'));
const STANDIN = writeStandIn(TMP);
const CRASHER = path.join(TMP, 'crash-helper.mjs');
fs.writeFileSync(CRASHER, 'process.exit(1);\n');

// the clock: moved forward by hand; the heartbeat's 10 s wait shortened to 80 ms
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 10000 ? 80 : ms, ...a);
const wait = (ms) => new Promise((r) => realSetTimeout(r, ms));

process.env.DEVICEHUB_HELPER_JS = STANDIN;
const nat = require(path.join(ROOT, 'helpers', 'native.js'));
const origLog = console.log;
const logs = [];
console.log = (...a) => { logs.push(a.join(' ')); };
let exitsSeen = 0;
nat.onExit(() => { exitsSeen++; });
const problems = [];
nat.onProblem((code, text) => problems.push(code));

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const pid = async () => Number(await nat.request('t:pid', 'PID', 2000));
const exitAfter = async (before, ms = 2000) => { const end = realNow() + ms; while (exitsSeen === before && realNow() < end) await wait(10); return exitsSeen > before; };
const hang = (chan) => nat.request(chan, 'HANG', 40);

try {
  const p1 = await pid();
  check(p1 > 0, `stand-in answers its pid (${p1})`);

  // fewer than three in a row, with an answer in between: nothing
  await hang('hid:a:1'); await hang('hid:a:1');
  check((await nat.request('hid:a:1', 'X', 1000)) === 'OK', 'an answer after two timeouts');
  skew += 61000;
  await hang('hid:a:1'); await hang('hid:a:1');
  check((await pid()) === p1, 'an answer clears the count: two more timeouts later restart nothing');

  // three in a row, all within a minute: nothing yet
  await hang('hid:b:1'); await hang('hid:b:1'); await hang('hid:b:1');
  check((await pid()) === p1, 'three timeouts within a minute restart nothing');

  // the watchdog's own channel is never counted
  await hang('watchdog'); skew += 61000; await hang('watchdog'); await hang('watchdog');
  check((await pid()) === p1, 'timeouts on the watchdog channel are not counted');

  // three in a row, the first over a minute before the third: the helper is restarted
  let before = exitsSeen;
  await hang('hid:c:1'); skew += 61000; await hang('hid:c:1'); await hang('hid:c:1');
  check(await exitAfter(before), 'three timeouts over a minute stop the helper');
  check(logs.some((l) => /\[watchdog\].*the hid channel stopped answering \(3 timeouts in a row\)/.test(l)), 'server.log says why');
  const p2 = await pid();
  check(p2 > 0 && p2 !== p1, `the next request starts a fresh helper (${p1} -> ${p2})`);

  // GONE on exit: what is still waiting answers at once
  const t0 = realNow();
  const waiting = nat.request('hid:d:1', 'HANG', 5000);
  await wait(30);
  const stopper = nat.request('t:exit', 'EXIT 3', 5000);
  const [w, s] = await Promise.all([waiting, stopper]);
  check(w === 'GONE' && s === 'GONE', `waiting requests answer GONE when the helper stops (${w}, ${s})`);
  check(realNow() - t0 < 2000, `at once, not at their timeout (${realNow() - t0} ms)`);

  // heartbeat: healthy, nothing; frozen, restarted
  const p3 = await pid();
  before = exitsSeen;
  await nat.heartbeat();
  check(exitsSeen === before && (await pid()) === p3, 'a healthy heartbeat restarts nothing');
  await nat.request('t:freeze', 'FREEZE', 1000);
  await nat.heartbeat();
  check(await exitAfter(before), 'a frozen helper is stopped by the heartbeat');
  check(logs.some((l) => /no answer to the heartbeat for 10 s/.test(l)), 'server.log says the heartbeat had no answer');
  const p4 = await pid();
  check(p4 > 0 && p4 !== p3, 'a fresh helper after the heartbeat restart');

  // at most 6 restarts an hour: two so far, four more, then the seventh is only a note
  for (let i = 0; i < 4; i++) {
    await pid();
    before = exitsSeen;
    await nat.request('t:freeze', 'FREEZE', 1000);
    await nat.heartbeat();
    if (!(await exitAfter(before))) { check(false, `restart ${i + 3} of 6 happened`); break; }
  }
  await pid();
  before = exitsSeen;
  await nat.request('t:freeze', 'FREEZE', 1000);
  await nat.heartbeat();
  await wait(200);
  check(exitsSeen === before && nat.running(), 'the seventh freeze in an hour is not restarted');
  check(logs.some((l) => /not restarted, 6 restarts in the last hour already/.test(l)), 'server.log notes the seventh');
  nat.stop();
  await wait(100);

  // the Rust helper: each stop counted (only the last 10 minutes kept), handed to the choice (selectHelper's rule:
  // three in 10 minutes); after three the choice falls back, and stays so (work map job 5)
  delete process.env.DEVICEHUB_HELPER_JS;
  const seen = [];
  nat._test.setSelect(({ crashes }) => {
    seen.push(crashes.length);
    return crashes.filter((t) => Date.now() - t < 600000).length >= 3
      ? { kind: 'standin', exe: STANDIN, reason: 'the Rust helper stopped 3 times in 10 minutes (test)', crashed: true }
      : { kind: 'rust', exe: CRASHER, reason: 'rust (test)' };
  });
  const answers = [];
  for (let i = 0; i < 4; i++) { answers.push(await nat.request('t:rust', 'X', 3000)); await wait(50); if (i === 0) skew += 11 * 60000; }
  check(answers.every((a) => a === 'GONE'), `a Rust helper that stops answers GONE (${answers.join(', ')})`);
  check(seen.join(',') === '0,1,1,2', `each stop is counted, one over 10 minutes old dropped (${seen.join(',')})`);
  const after = await nat.request('t:rust', 'PID', 3000);
  check(/^\d+$/.test(after), `after three stops the fallback helper answers (${after})`);
  check(problems.includes('rust-helper-fallback'), 'the fallback is reported as a problem');
  check(nat.helperKind() === 'standin', `the running helper is the fallback (${nat.helperKind()})`);
  // 11 minutes on, the stops no longer recent: still the fallback until DeviceHub restarts
  nat.stop();
  skew += 11 * 60000;
  const later = await nat.request('t:rust', 'PID', 3000);
  check(/^\d+$/.test(later) && nat.helperKind() === 'standin', `still the fallback 11 minutes later (${later}, ${nat.helperKind()})`);
} finally {
  nat._test.setSelect(null);
  nat.stop();
  console.log = origLog;
  Date.now = realNow;
  globalThis.setTimeout = realSetTimeout;
  await wait(100);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`native-watchdog (timeouts, restarts, heartbeat, GONE on exit, Rust fallback): all ${n} passed`);
process.exit(0);
