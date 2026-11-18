// Offline test (15 Nov 2026, work map job 4): helpers/native.js stop() answers what is still waiting with GONE at once
// (it used to wait for each request's own TIMEOUT, 8-15 s), tells the exit listeners, does not count as a crash, and
// the next request starts a fresh helper. Stand-in helper only (tests/lib/standin-helper.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeStandIn } from './lib/standin-helper.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-stop-'));
process.env.DEVICEHUB_HELPER_JS = writeStandIn(TMP);
const nat = require(path.join(ROOT, 'helpers', 'native.js'));
const origLog = console.log;
console.log = () => {};
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let exits = 0;
nat.onExit(() => { exits++; });
const problems = [];
nat.onProblem((c) => problems.push(c));

try {
  const p1 = Number(await nat.request('t:pid', 'PID', 2000));
  check(p1 > 0, 'stand-in running');
  const a = nat.request('hid:a:1', 'HANG', 15000);
  const b = nat.request('hs80:b:1', 'HANG', 8000);
  await wait(30);
  const t0 = Date.now();
  nat.stop();
  const [ra, rb] = await Promise.all([a, b]);
  const took = Date.now() - t0;
  check(ra === 'GONE' && rb === 'GONE', `waiting requests answer GONE (${ra}, ${rb})`);
  check(took < 500, `at once (${took} ms), not after their 8-15 s timeout`);
  check(exits === 1, `exit listeners heard it once (${exits})`);
  check(!nat.running(), 'no helper running after stop()');
  nat.stop();
  check(exits === 1, 'a second stop() with nothing running does nothing');
  for (let i = 0; i < 3; i++) { await nat.request('t:pid', 'PID', 2000); nat.stop(); }
  check(!problems.includes('helper-restarts'), 'stop() is not counted as the helper stopping by itself');
  const p2 = Number(await nat.request('t:pid', 'PID', 2000));
  check(p2 > 0 && p2 !== p1, `the next request starts a fresh helper (${p1} -> ${p2})`);
} finally {
  nat.stop();
  console.log = origLog;
  await wait(100);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`native-stop (GONE at once, exit listeners, not a crash): all ${n} passed`);
process.exit(0);
