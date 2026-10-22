// Battery history for added devices (22 Oct 2026; helpers/battery-history.js, docs/handoff/battery-added-devices.md),
// against a temporary copy of the file's shape (never the real battery-history.jsonl): the mouse's and headset's rows
// are written exactly as before, an added device's rows sit beside them under its own id, the 7-day keep is the same,
// the estimate works for any id, the mouse's and headset's estimates do not change when an added device's rows are in
// the file, and no timer was added. tests/battery-care.mjs runs it (so test:offline covers it).
// Run: node tests/battery-history.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function run() {
  const fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  const bh = require('../helpers/battery-history.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-bathist-'));
  const file = path.join(dir, 'battery-history.jsonl');
  const H = 3600 * 1000, now = Date.now();
  try {
    // the row as battery-history.js wrote it before this change (copied from the 19-21 Oct code), for the built-in two
    const legacyRow = (d, at) => ({ at, id: d.id, pct: d.battery.percent, raw: d.battery.reported ?? undefined, mv: d.battery.mv ?? undefined, charging: !!d.battery.charging || (d.id === 'headset' && /cable/i.test(d.info?.Control || '')) });
    const state = {
      devices: [
        { id: 'mouse', status: 'connected', battery: { percent: 57, reported: 61, mv: 3912, charging: false }, info: {} },
        { id: 'headset', status: 'connected', battery: { percent: 80, charging: false }, info: { Control: 'USB cable' } },
        { id: 'keyboard', status: 'connected', battery: null, info: {} },
        { id: 'pretend-buds', status: 'connected', battery: { percent: 33, charging: true }, info: {}, adapter: { plugin: 'pretend-buds' } },
        { id: 'pretend-pad', status: 'missing', battery: { percent: 10 }, info: {} },
      ],
    };
    bh._test.setFile(file, () => state);
    const rows = bh._test.rowsNow();
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of ['mouse', 'headset']) {
      const d = state.devices.find((x) => x.id === id);
      check(JSON.stringify({ ...by[id], at: 0 }) === JSON.stringify(legacyRow(d, 0)), `${id}: the row is written exactly as before (${JSON.stringify(by[id])})`);
    }
    check(by['pretend-buds'] && by['pretend-buds'].pct === 33 && by['pretend-buds'].charging === true, `an added device's battery is recorded under its own id (${JSON.stringify(by['pretend-buds'])})`);
    check(!by.keyboard && !by['pretend-pad'], 'no row for a device without a battery or one not connected');

    // a copy of the file's shape: old rows (one older than 7 days), the mouse draining, the headset, an added device
    const old = [{ at: now - 8 * 24 * H, id: 'mouse', pct: 90, raw: 92, mv: 4100, charging: false }];
    const mouse = [0, 1, 2].map((i) => ({ at: now - (2 - i) * H, id: 'mouse', pct: 70 - i * 5, raw: 72 - i * 5, mv: 3950 - i * 20, charging: false }));
    const headset = [{ at: now - 2 * H, id: 'headset', pct: 99, charging: true }, { at: now - H, id: 'headset', pct: 100, charging: true, edge: 'plugged' }];
    const added = [0, 1, 2, 3].map((i) => ({ at: now - (3 - i) * H, id: 'pretend-buds', pct: 80 - i * 4, charging: false }));
    const base = [...old, ...mouse, ...headset];
    fs.writeFileSync(file, base.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const before = bh.estimates();
    check(Object.keys(before).join() === 'mouse,headset', `without added rows the estimate has the same two entries (${Object.keys(before)})`);
    check(before.mouse && before.mouse.ratePerHour === 5 && before.mouse.hoursLeft === 12 && before.headset === null, `the mouse's estimate (${JSON.stringify(before)})`);
    fs.writeFileSync(file, [...base, ...added].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const after = bh.estimates();
    check(JSON.stringify(after.mouse) === JSON.stringify(before.mouse) && after.headset === before.headset, 'the mouse\'s and headset\'s estimates do not change with an added device\'s rows in the file');
    check(after['pretend-buds']?.ratePerHour === 4 && after['pretend-buds']?.hoursLeft === 17, `an added device gets the same estimate (${JSON.stringify(after['pretend-buds'])})`);

    // append keeps the last 7 days and writes the rows as they come (the same file format)
    bh._test.append([{ at: now, id: 'pretend-buds', pct: 67, charging: false }]);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    check(!lines.some((l) => JSON.parse(l).at === old[0].at), 'a row older than 7 days is dropped, as before');
    check(lines.slice(0, mouse.length).every((l, i) => l === JSON.stringify(mouse[i])), 'the mouse\'s rows are kept byte for byte');
    check(lines[lines.length - 1] === '{"at":' + now + ',"id":"pretend-buds","pct":67,"charging":false}', `an added device's row has the same shape (${lines[lines.length - 1]})`);

    // the graph's readings for any id
    const hist = bh.history('pretend-buds', 1);
    check(hist.length === 5 && hist.every((r) => Object.keys(r).join() === 'at,pct,charging'), `the graph's readings for an added device (${JSON.stringify(hist[0])})`);
    check(bh.history('mouse', 7).length === 3, 'the mouse\'s readings are only the mouse\'s');
    check(bh.validId('mouse') && bh.validId('headset') && bh.validId('pretend-buds') && !bh.validId('../x') && !bh.validId('A') && !bh.validId('') && !bh.validId(null) && !bh.validId('x'), 'the ids the graph route takes: the two, or an added device id (a-z, 0-9, -)');

    // no new timers: the same timers as before in both files (CPU unchanged)
    const count = (f, re) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(re) || []).length;
    check(count('helpers/battery-history.js', /setInterval\(/g) === 1 && count('helpers/battery-history.js', /setTimeout\(/g) === 3, 'battery-history.js: the same timers (one 5-minute interval, the first sample and the 30 s watch)');
    check(count('helpers/battery-care.mjs', /setInterval\(/g) === 1 && count('helpers/battery-care.mjs', /setTimeout\(/g) === 1, 'battery-care.mjs: the same timers (every 20 s, and once at start)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return fails;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fails = await run();
  console.log(fails.length ? `battery history: FAILED: ${fails.join('; ')}` : 'battery history (copies of the file, added devices): all good');
  process.exit(fails.length ? 1 : 0);
}
