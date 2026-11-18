// Offline test: helpers/mouse-level.js — battery-mode noise suppression, 10%+ jump recovery,
// charging rate curve (full speed to 80%, half speed above, 99% cap until 100%), settling to battery + rate learning,
// and missing endedAt recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mouse-level-'));
fs.mkdirSync(path.join(T, 'helpers'));
fs.mkdirSync(path.join(T, 'data'));
for (const f of ['mouse-level.js', 'safe-write.js', 'data-dir.js']) {
  fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T, 'helpers', f));
}

const require = createRequire(import.meta.url);
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  const ml = require(path.join(T, 'helpers', 'mouse-level.js'));
  let t = 1_700_000_000_000;

  // 1. Null/missing percent passes through untouched
  check(ml.filter(null, t) === null, 'null input returns null');
  check(ml.filter({ mv: 3900 }, t).mv === 3900, 'missing percent passes through');

  // 2. On battery: suppresses +5% noise, follows downward, accepts >=10% upward jump
  check(ml.filter({ percent: 50, charging: false }, t).percent === 50, 'initial battery reading sets 50%');
  check(ml.filter({ percent: 55, charging: false }, t + 1000).percent === 50, 'upward +5% blip on battery is ignored');
  check(ml.filter({ percent: 45, charging: false }, t + 2000).percent === 45, 'downward step on battery is followed');
  check(ml.filter({ percent: 60, charging: false }, t + 3000).percent === 60, '>=10% upward jump replaces stale battery level');

  // 3. Charging: 60% -> 80% (~16.7 min at 1.2%/min), capped at 99% until raw=100
  t += 10_000;
  const c0 = ml.filter({ percent: 90, charging: true }, t);
  check(c0.levelMode === 'charging' && c0.percent === 60, 'charging starts from current level (60%)');

  t += 10 * 60_000; // +10 min -> 60 + 12 = 72%
  const c1 = ml.filter({ percent: 95, charging: true }, t);
  check(c1.percent === 72, `after 10 min charging expects 72%, got ${c1.percent}`);

  t += 40 * 60_000; // long charge capped at 99 while raw < 100
  check(ml.filter({ percent: 95, charging: true }, t).percent === 99, 'charging caps at 99% while raw < 100');
  check(ml.filter({ percent: 100, charging: true }, t + 1000).percent === 100, 'raw=100 reports 100%');

  // 4. Unplugging enters settling mode, settles after 3 min steady within 5%, learns rate when >= 10 min & raw < 95
  t += 2000;
  const u0 = ml.filter({ percent: 85, charging: false }, t);
  check(u0.levelMode === 'settling' && u0.percent === 85, 'unplugging enters settling and follows raw down');
  t += 3 * 60_000 + 1000;
  const u1 = ml.filter({ percent: 85, charging: false }, t);
  check(u1.levelMode === 'battery' && u1.percent === 85, '3 min steady reading settles back to battery mode');

  // 5. Saved settling state without endedAt still settles cleanly within 30 min max
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mouse-level-partial-'));
  fs.mkdirSync(path.join(T2, 'helpers'));
  fs.mkdirSync(path.join(T2, 'data'));
  for (const f of ['mouse-level.js', 'safe-write.js', 'data-dir.js']) {
    fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T2, 'helpers', f));
  }
  fs.writeFileSync(path.join(T2, 'data', 'mouse-level.json'), JSON.stringify({ level: 80, mode: 'settling', rates: [] }));
  const ml2 = require(path.join(T2, 'helpers', 'mouse-level.js'));
  const p0 = ml2.filter({ percent: 75, charging: false }, 1000);
  check(p0.levelMode === 'settling', 'loaded partial settling state starts safely');
  const p1 = ml2.filter({ percent: 75, charging: false }, 1000 + 3 * 60_000 + 10);
  check(p1.levelMode === 'battery' && p1.percent === 75, 'loaded partial settling state settles after 3 min steady');
  fs.rmSync(T2, { recursive: true, force: true });
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`mouse-level (battery noise, charging curve, settling, partial-state guard): all ${n} passed`);
process.exit(0);
