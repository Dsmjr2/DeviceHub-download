// The Overview's GPU chip on the live stream (27 Oct 2026, helpers/gpu-watch.js): read only while a window wants it,
// sent only when the temperature changes, stopped when the last window stops wanting it or its stream closes.
//   node tests/gpu-watch.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGpuWatch } = require('../helpers/gpu-watch.js');

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('- ' + m); } };
const flush = () => new Promise((r) => setTimeout(r, 0));
let temp = 50, reads = 0, timers = 0, fire = null;
const w = createGpuWatch({
  read: async () => { reads++; return { gpus: [{ tempC: temp }] }; },
  setI: (fn) => { timers++; fire = fn; return { unref() {} }; }, clearI: () => { timers--; fire = null; },
});
const got = { 1: [], 2: [] };
await flush();
ok(reads === 0 && timers === 0, 'nothing is read while no window shows the chip');
w.want(1, true, (d) => got[1].push(d.tempC)); await flush();
ok(reads === 1 && got[1].join() === '50', `the first window gets the temperature at once (${got[1]})`);
fire(); await flush();
ok(reads === 2 && got[1].length === 1, 'an unchanged temperature is not sent');
temp = 53; fire(); await flush();
ok(got[1].join() === '50,53', `a changed one is (${got[1]})`);
w.want(2, true, (d) => got[2].push(d.tempC)); await flush();
ok(got[2].join() === '53' && timers === 1, 'a second window gets the last reading, no second timer');
w.want(1, false); w.drop(2); await flush();
ok(timers === 0 && w.watching() === 0, 'no window left: reading stops');
const before = reads; await flush();
ok(reads === before, 'and nothing more is read');

// 31 Oct 2026: a read still running when the last window stops wanting: its answer is dropped, so the next window gets
// its first reading even when it is the same temperature
{
  let release = null, t = 60;
  const sent = [];
  const w2 = createGpuWatch({ read: () => new Promise((r) => { release = () => r({ gpus: [{ tempC: t }] }); }), setI: () => ({ unref() {} }), clearI: () => {} });
  w2.want(1, true, () => {}); w2.want(1, false);     // the read starts, then the only window stops wanting
  release(); await flush();                          // that read answers after the stop
  w2.want(2, true, (d) => sent.push(d.tempC)); release(); await flush();
  ok(sent.join() === '60', `a new window gets the reading even when it equals the one read during the stop (${sent})`);
}

console.log(failed ? `${failed} failed` : 'gpu-watch: all passed');
process.exit(failed ? 1 : 0);
