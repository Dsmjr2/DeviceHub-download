// Offline test (15 Nov 2026 bug hunt): two profile applies at once (the tray's Apply as a game starts and auto-switch
// applies its profile) wrote their settings interleaved, leaving the devices a mix of both. public/core/profiles.js
// apply now runs one at a time, so the last one asked for is the one the devices end with. Stand-in devices and API.
import { env } from '../public/core/env.js';
import * as core from '../public/core/devices.js';
import * as P from '../public/core/profiles.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const order = [];
env.agent = true;
env.toast = () => ({ update() {}, close() {}, done() {}, fail() {} });
env.api = async (p) => {
  if (p === '/api/backup') return { file: 'x\\b.json' };
  if (p === '/api/wifi-pause/profile' || p === '/api/activity') return {};
  throw new Error(`unexpected ${p}`);
};
const reg = (id, state) => {
  const a = { id, title: id, kind: id, _s: { ...state }, async read() { return { ...this._s }; },
    async write(k, v) { order.push(`start ${id}.${k}=${v}`); await new Promise((r) => setTimeout(r, 15)); this._s[k] = v; order.push(`end ${id}.${k}=${v}`); return v; } };
  core.register(a); core.devices[id].status = 'connected'; core.devices[id].values = { ...state }; return a;
};
reg('mouse', { pollingRate: 1000, dpi0: 800 });
reg('headset', { 'vol:playback': 50 });

try {
  const desktop = { name: 'Desktop', devices: { mouse: { pollingRate: 1000, dpi0: 800 }, headset: { 'vol:playback': 60 } } };
  const game = { name: 'Valorant', devices: { mouse: { pollingRate: 8000, dpi0: 1600 }, headset: { 'vol:playback': 30 } } };
  core.devices.mouse.values = { pollingRate: 2000, dpi0: 400 };
  const a = P.apply(desktop);
  const b = P.apply(game);
  await Promise.all([a, b]);
  // no write of one profile starts while one of the other is under way
  let open = null, mixed = false;
  for (const e of order) {
    const [kind, what] = e.split(' ');
    if (kind === 'start') { if (open) mixed = true; open = what; } else open = null;
  }
  check(!mixed, `the two applies do not overlap (${order.join(', ')})`);
  const firstGame = order.findIndex((e) => /=(8000|1600|30)$/.test(e));
  const lastDesk = order.map((e, i) => (/=(1000|800|60)$/.test(e) ? i : -1)).reduce((x, y) => Math.max(x, y), -1);
  check(firstGame > lastDesk, 'the second one starts after the first is done');
  check(core.devices.mouse.values.pollingRate === 8000 && core.devices.mouse.values.dpi0 === 1600 && core.devices.headset.values['vol:playback'] === 30, 'the devices end with the last profile asked for, whole');
  // a failed apply does not block the next
  core.devices.headset.adapter.write = async () => { throw new Error('refused'); };
  await P.apply(desktop).catch(() => {});
  core.devices.headset.adapter.write = async (k, v) => v;
  const r = await Promise.race([P.apply(game), new Promise((res) => setTimeout(() => res('stuck'), 2000))]);
  check(r !== 'stuck', 'a failed apply does not leave the next one waiting');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`profile-apply-lock (two applies at once run one after the other): all ${n} passed`);
process.exit(0);
