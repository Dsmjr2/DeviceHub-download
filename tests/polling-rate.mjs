// The polling rate test (public/core/polling-rate.js, public/ui/polling-test.js): the rate from report times rounded to
// 0.1 ms as a browser gives them, pauses left out, and the verdict against the rate the mouse is set to. The page only
// listens: it never writes to the mouse or sends anything. Run: node tests/polling-rate.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateOf, verdict, roundHz, PAUSE_MS } from '../public/core/polling-rate.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

// report times at a rate, with jitter, rounded to 0.1 ms; pauses: [[at ms, length ms]]
function reports(hz, ms, { jitter = 0.1, pauses = [], seed = 7 } = {}) {
  let x = seed;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const out = [];
  const gap = 1000 / hz;
  for (let t = 1000; t < 1000 + ms; t += gap * (1 + (rnd() - 0.5) * 2 * jitter)) {
    const p = pauses.find(([at, len]) => t - 1000 >= at && t - 1000 < at + len);
    if (p) { t = 1000 + p[0] + p[1]; continue; }
    out.push(Math.round(t * 10) / 10);
  }
  return out;
}

for (const hz of [125, 250, 500, 1000, 2000, 4000, 8000]) {
  const r = rateOf(reports(hz, 5000));
  ok(Math.abs(r.hz - hz) / hz < 0.03, `${hz} Hz measures ${r.hz.toFixed(0)} Hz (times rounded to 0.1 ms)`);
  ok(r.steady > 0.9, `${hz} Hz is steady (${r.steady.toFixed(2)})`);
  ok(verdict(r, hz).kind === 'match', `${hz} Hz set and measured: a match (${verdict(r, hz).line})`);
}
const paused = rateOf(reports(1000, 5000, { pauses: [[1000, 400], [3000, 800]] }));
ok(Math.abs(paused.hz - 1000) < 30 && paused.movingMs < 4000, `pauses longer than ${PAUSE_MS} ms are left out (${paused.hz.toFixed(0)} Hz over ${paused.movingMs.toFixed(0)} ms)`);
const halved = verdict(rateOf(reports(4000, 5000)), 8000);
ok(halved.kind === 'low' && /about 4000 Hz/.test(halved.line) && /set to 8000 Hz/.test(halved.line) && /not a hub/.test(halved.line) && /merge reports/.test(halved.line), `half the rate: low, with what to try (${halved.line})`);
ok(!/merge reports/.test(verdict(rateOf(reports(500, 5000)), 1000).line), 'the browser note is only for 2000 Hz and up');
const uneven = rateOf(reports(1000, 5000, { jitter: 0.95 }).filter((_, i) => i % 7 !== 0 || i % 3 === 0));
ok(/uneven/.test(verdict({ ...uneven, steady: 0.4 }, 1000).line), 'an uneven reading says so');
ok(verdict(rateOf(reports(1000, 300)), 1000).kind === 'short' && verdict(rateOf([]), 1000).kind === 'short' && rateOf([]).hz === 0, 'too little movement: asks again, no number');
ok(verdict(rateOf(reports(1000, 5000)), null).kind === 'match' && /About 1000 Hz arrived\./.test(verdict(rateOf(reports(1000, 5000)), null).line), 'a mouse with no polling setting: just the measured rate');
ok(verdict(rateOf(reports(2000, 5000)), 1000).kind === 'high', 'more than set: says another mouse may have moved');
ok(roundHz(7963) === 8000 && roundHz(996) === 1000 && roundHz(124.6) === 120, 'rounded the way the page shows rates');

// the page: listens only, cleans up, on both mouse pages
const ui = fs.readFileSync(path.join(REAL, 'public/ui/polling-test.js'), 'utf8').replace(/\/\/.*$/gm, '');
ok(!/fetch\(|write\(|toast\(|modal\(|\btitle:|alert\(|Notification|sendFeatureReport/.test(ui), 'the test only listens: no fetch, no writes, no pop-ups');
ok(/removeEventListener\(run\.name, onRaw\)/.test(ui) && /setTimeout\(\(\) => stop\(\), TEST_MS\)/.test(ui) && /!view\?\.box\.isConnected \|\|/.test(ui), 'it stops by itself, and when the page moves on');
ok(/const mine = run\.who === who;/.test(ui) && /view\.who !== run\.who\) return stop\(true\)/.test(ui), "one mouse's result never shows on another mouse's page");
ok((ui.match(/\blog\(/g) || []).length === 1 && /if \(v\.kind !== 'short'\) log\(`Polling rate test:/.test(ui), 'each real result is saved once to the activity log on this PC (not a too-short one)');
ok(/pointerrawupdate/.test(ui) && /getCoalescedEvents/.test(ui), 'it reads every report the browser hands over');
ok(/pollingTest\(v\.pollingRate, card\)/.test(fs.readFileSync(path.join(REAL, 'public/pages/mouse.js'), 'utf8')), 'the mouse page has it');
ok(/\/mouse\/i\.test\(a\.kind \|\| ''\) \? pollingTest\(pollHz\(d\), card, id\)/.test(fs.readFileSync(path.join(REAL, 'public/pages/my-device.js'), 'utf8')), 'every library mouse page has it');

if (fails.length) { console.log(`polling-rate: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('polling-rate (measured rate from 0.1 ms times, pauses left out, the verdict, a test that only listens): all good');
