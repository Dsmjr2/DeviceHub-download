// Color balance and the color preset (24 Oct 2026, Shawn: "the colors dont change for my oled"; helpers/monitors.js
// customFirst / refusesColor), with a stand-in for the native helper: a monitor that takes a gain only on its Custom
// preset (as the AOC AGON OLED AG276QZD2 measured) is switched to Custom first, once, and read back; one already on
// Custom gets no preset write; one that refuses a gain even on Custom has its color balance hidden (noColor).
// Run: node tests/monitor-color.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-moncolor-'));
process.env.DEVICEHUB_DATA_DIR = dir;
fs.mkdirSync(path.join(dir, 'backups'));
const monitors = require('../helpers/monitors.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// three monitors: OLED (gain only on Custom), NOGAIN (never takes a gain), ONCUSTOM (already on Custom)
const caps = '(model(TEST) vcp(10 12 14(05 06 08 0B) 16 18 1A))';
const mons = {
  OLED: { preset: 5, gain: { 0x16: 50, 0x18: 50, 0x1A: 50 }, takes: (m) => m.preset === 11 },
  NOGAIN: { preset: 5, gain: { 0x16: 50, 0x18: 50, 0x1A: 50 }, takes: () => false },
  ONCUSTOM: { preset: 11, gain: { 0x16: 50, 0x18: 52, 0x1A: 50 }, takes: (m) => m.preset === 11 },
};
const writes = [];
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const native = { async request(chan, q) {
  q = JSON.parse(q);
  if (q.op === 'monitors') return JSON.stringify({ ok: true, monitors: Object.entries(mons).map(([id, m]) => ({ id, screen: id, name: id, ddc: true, caps: q.caps ? caps : undefined,
    values: { 10: { cur: 50, max: 100 }, 12: { cur: 50, max: 100 }, 14: { cur: m.preset, max: 11 }, ...Object.fromEntries(Object.entries(m.gain).map(([c, v]) => [hex(Number(c)), { cur: v, max: 100 }])) } })) });
  if (q.op === 'monitor-set') {
    const m = mons[q.id];
    writes.push([q.id, q.code, q.value, !!q.live]);
    if (q.code === 0x14) m.preset = q.value;
    else if (m.takes(m)) m.gain[q.code] = q.value;
    const cur = q.code === 0x14 ? m.preset : m.gain[q.code];
    return JSON.stringify(q.live ? { ok: true, cur: q.value, live: true } : { ok: true, cur, max: 100 });
  }
  return JSON.stringify({ ok: false, error: 'unknown' });
} };
monitors.start(native, path.join(dir, 'backups'));

// the decision on its own
const { customFirst, refusesColor } = monitors._test;
const opts = [5, 6, 8, 11].map((value) => ({ value }));
check(customFirst({ colorPreset: { value: 5, options: opts } }, 'red') === 11, 'a gain on Standard needs Custom first');
check(customFirst({ colorPreset: { value: 11, options: opts } }, 'red') === null, 'a gain on Custom needs no preset write');
check(customFirst({ colorPreset: { value: 5, options: opts } }, 'brightness') === null, 'brightness never switches the preset');
check(customFirst({ colorPreset: { value: 5, options: [{ value: 5 }, { value: 6 }] } }, 'red') === null, 'no Custom offered: nothing to switch to');
check(customFirst({}, 'blue') === null, 'no color preset at all: nothing to switch to');
check(refusesColor({ colorPreset: { value: 11, options: opts } }, 'red') === true, 'refused on Custom = takes no color changes');
check(refusesColor({}, 'red') === true, 'refused with no preset = takes no color changes');
check(refusesColor({ colorPreset: { value: 11, options: opts } }, 'brightness') === false, 'a refused brightness is not about color');

await monitors.list(true);

// OLED on Standard: preset to Custom (read back) first, then the gain
writes.length = 0;
let r = await monitors.set('OLED', 'red', 45);
check(writes.length === 2 && writes[0][1] === 0x14 && writes[0][2] === 11 && !writes[0][3] && writes[1][1] === 0x16 && writes[1][2] === 45, `OLED: preset write before the gain (${JSON.stringify(writes)})`);
check(r.value === 45 && r.presetSwitched === 'Custom', `OLED: red taken and the switch reported (${JSON.stringify(r)})`);
// the next gain needs no second switch
writes.length = 0;
r = await monitors.set('OLED', 'green', 48);
check(writes.length === 1 && writes[0][1] === 0x18 && r.presetSwitched === null, `OLED: no second preset write (${JSON.stringify(writes)})`);

// a live step (slider dragged) switches too, once
mons.OLED.preset = 5; await monitors.list(true);
writes.length = 0;
r = await monitors.set('OLED', 'blue', 40, { live: true });
await monitors.set('OLED', 'blue', 41, { live: true });
check(writes.filter((w) => w[1] === 0x14).length === 1 && writes[0][1] === 0x14 && r.presetSwitched === 'Custom', `live: one preset write, before the first step (${JSON.stringify(writes)})`);

// already on Custom: no preset write
writes.length = 0;
r = await monitors.set('ONCUSTOM', 'green', 51);
check(writes.length === 1 && writes[0][1] === 0x18 && r.value === 51, `on Custom: the gain only (${JSON.stringify(writes)})`);

// refuses a gain even on Custom: an error in words, and its color balance hidden from then on
let err = null;
try { await monitors.set('NOGAIN', 'red', 45); } catch (e) { err = e.message; }
check(/doesn't take color changes/.test(err || ''), `no-gain monitor: says it takes no color changes (${err})`);
const l = await monitors.list(true);
const ng = l.find((m) => m.id === 'NOGAIN');
check(ng.noColor === true && ng.red === null && ng.green === null && ng.blue === null, 'no-gain monitor: color balance hidden');
check(ng.brightness && ng.colorPreset, 'no-gain monitor: brightness and preset still offered');
check(l.find((m) => m.id === 'OLED').red, 'the OLED keeps its color balance');

fs.rmSync(dir, { recursive: true, force: true });
if (fails.length) { console.error(`monitor-color: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('monitor-color (Custom preset before a gain, once; no preset write on Custom; no-gain monitor hidden): all good');
process.exit(0);
