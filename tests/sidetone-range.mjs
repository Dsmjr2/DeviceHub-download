// Offline test (15 Nov 2026 bug hunt round 3): sidetone on a headset other than the HS80 (its control's own dB range
// from Windows). (1) Percent to dB and back gives the same percent everywhere, also near the bottom (2-10% on a
// -20..0 dB control wrote the bottom and then failed "Windows reads 0% after setting 5%"). (2) The helper takes any dB
// inside the control's own range, not only the HS80's -42..+4. (3) With no reading yet, a non-HS80 headset is never
// set with the HS80's formula. The HS80's own scale (measured against iCUE) is unchanged.
import fs from 'node:fs';
import { pctOf, dbOf, sidetonePct, sidetoneDb } from '../public/devices/headset-adapter.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

for (const [min, max] of [[-20, 0], [-12, 0], [-42, 4], [-10, 10], [-60, 0]]) {
  const bad = [];
  for (let v = 0; v <= 100; v++) { const back = pctOf(dbOf(v, min, max), min, max); if (Math.abs(back - v) > 1) bad.push(`${v}->${back}`); }
  check(!bad.length, `${min}..${max} dB: every percent comes back (${bad.slice(0, 6).join(' ')})`);
  check(dbOf(0, min, max) === min && Math.abs(dbOf(100, min, max) - max) < 1e-9, `${min}..${max} dB: 0% is the bottom, 100% the top`);
  let up = true; for (let v = 1; v <= 100; v++) if (!(dbOf(v, min, max) > dbOf(v - 1, min, max))) up = false;
  check(up, `${min}..${max} dB: each step up is louder`);
}
check(sidetonePct(-2) === 50 && sidetonePct(-16) === 10 && sidetonePct(4) === 100 && sidetonePct(-42) === 0, "the HS80's scale is as measured against iCUE");

const cs = fs.readFileSync(new URL('../helpers/native/helper.cs', import.meta.url), 'utf8');
const rs = fs.readFileSync(new URL('../helpers/native-rs/src/audio.rs', import.meta.url), 'utf8');
check(!/db < -42 \|\| db > 4/.test(cs) && /db < lo \|\| db > hi/.test(cs), "C# helper: the control's own range, not the HS80's");
check(!/\(-42\.0\.\.=4\.0\)\.contains\(&db\)/.test(rs) && /\(lo\.\.=hi\)\.contains\(&db\)/.test(rs), "Rust helper: the control's own range, not the HS80's");
const ad = fs.readFileSync(new URL('../public/devices/headset-adapter.js', import.meta.url), 'utf8');
check(!/generic && sidetone \? dbOf\(value, sidetone\.min, sidetone\.max\) : sidetoneDb\(value\)/.test(ad), "no reading yet: a non-HS80 headset is never set with the HS80's formula");

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`sidetone-range (non-HS80 sidetone round trip, its own range in both helpers): all ${n} passed`);
process.exit(0);
