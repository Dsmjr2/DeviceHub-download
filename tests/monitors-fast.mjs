// The Monitors page opens quickly (23 Oct 2026, Shawn: "make the monitors area load faster"; helpers/monitors.js list),
// with a stand-in for the native helper whose every DDC/CI read takes 200 ms: the first read happens in the background
// after start, an old reading comes back at once while a new read runs, and reads asked at the same time share one.
// Run: node tests/monitors-fast.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-monfast-'));
process.env.DEVICEHUB_DATA_DIR = dir;
fs.mkdirSync(path.join(dir, 'backups'));
const monitors = require('../helpers/monitors.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reads = 0, brightness = 40;
const native = { async request(chan, q) {
  q = JSON.parse(q);
  if (q.op !== 'monitors') return JSON.stringify({ ok: false, error: 'unknown' });
  reads++; await sleep(200);
  return JSON.stringify({ ok: true, monitors: [{ id: 'MON1', screen: '\\\\.\\DISPLAY1', name: 'Generic', ddc: true, caps: q.caps ? '(vcp(10 12))' : undefined, values: { 10: { cur: brightness, max: 100 }, 12: { cur: 50, max: 100 } } }] });
} };
monitors.start(native, path.join(dir, 'backups'));

// the background read after start (shortened here) leaves a reading ready
monitors._test.warm(10);
await sleep(700);
check(reads >= 1, `the first read happens by itself after start (${reads} reads)`);
let t = Date.now();
let l = await monitors.list(false);
check(Date.now() - t < 50 && l[0].brightness.value === 40, `the page's first open answers at once from that reading (${Date.now() - t} ms)`);

// an old reading: answered at once, and a new read starts behind it
monitors._test.age(60000);
brightness = 70;
const before = reads;
t = Date.now();
l = await monitors.list(false);
check(Date.now() - t < 50 && l[0].brightness.value === 40, `an old reading is shown at once (${Date.now() - t} ms)`);
// the page's own fresh ask right after joins that read instead of starting another
t = Date.now();
l = await monitors.list(true);
check(l[0].brightness.value === 70, 'the fresh ask gets the new value');
check(reads - before === 1, `the background read and the fresh ask shared one read (${reads - before} reads)`);
// two fresh asks at once: one read
const b2 = reads;
await Promise.all([monitors.list(true), monitors.list(true)]);
check(reads - b2 === 1, `two fresh asks at the same time share one read (${reads - b2})`);

fs.rmSync(dir, { recursive: true, force: true });
if (fails.length) { console.error(`monitors-fast: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('monitors-fast (a reading ready after start, old readings at once, shared reads): all good');
