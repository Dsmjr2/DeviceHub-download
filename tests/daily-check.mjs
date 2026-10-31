// The daily self-check's device reads (helpers/daily-check.mjs): two reads compared; a second read cut short (the device
// dozed off between them, 31 Oct 2026: 30 Pulsar settings "changed between two reads") is not a failure, only settings
// both reads have are compared, and a real change still fails. Run: node tests/daily-check.mjs (a pretend core, temp folder)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, run } from '../helpers/daily-check.mjs';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-daily-'));
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
const reads = [];
const core = {
  devices: { mouse: { id: 'mouse', status: 'connected', adapter: { title: 'Pretend mouse' } } },
  readNow: async () => reads.shift(),
  waitingFor: () => ({}),
  onChange: () => {},
};
const realSetTimeout = globalThis.setTimeout, realSetInterval = globalThis.setInterval;
globalThis.setTimeout = () => 0; globalThis.setInterval = () => 0;   // start() schedules runs; this test runs them itself
start(root, core);
globalThis.setTimeout = realSetTimeout; globalThis.setInterval = realSetInterval;
const full = { dpi: 800, debounce: 2, motionSync: true, angleSnap: false, sleep: 60, color1: '#ff0000' };

reads.push(full, { dpi: 800 });
let r = await run();
ok(r.items['Pretend mouse'].ok === null && /went to sleep during the check/.test(r.items['Pretend mouse'].text), `a cut-short second read is checked again later (${JSON.stringify(r.items['Pretend mouse'])})`);
reads.push(full, { ...full });
r = await run();
ok(r.items['Pretend mouse'].ok === true && /6 settings read twice, identical/.test(r.items['Pretend mouse'].text), `two equal reads pass (${JSON.stringify(r.items['Pretend mouse'])})`);
delete r.items['Pretend mouse'];
reads.push(full, { ...full, dpi: 1600, sleep: undefined });
fs.writeFileSync(path.join(root, 'data', 'daily-check.json'), JSON.stringify({ at: null, items: {} }));
r = await run({ all: false });
const item = r.items['Pretend mouse'];
ok(item && item.ok === false && /changed between two reads: dpi$/.test(item.text), `a real change fails, a missing one is not counted (${JSON.stringify(item)})`);

try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
if (fails.length) { console.log(`daily-check: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('daily-check (two reads compared; a read cut short by sleep checked again later, a real change still fails): all good');
