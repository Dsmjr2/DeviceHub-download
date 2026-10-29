// The Lenovo Legion Gen 10 keyboard lights driver (device-library/lenovo-legion-spectrum, UNTESTED) against a pretend
// ITE 8258 controller that answers as Lenovo Legion Toolkit's Native.cs documents: 960-byte feature report 07, set
// [op, C0, 03, value], get [07, op, len, ?, value]. Also a stranger on the same chip id that fails the compatibility
// check. Checks: the gate first, only the allowed commands, read-back after every write, no writes while Vantage runs,
// never C9 / CB / Aurora. Run: node tests/sim-legion.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem, hidSpecs } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createLegion, OPS, NEVER, PIDS, default: shipped } = await import('../device-library/lenovo-legion-spectrum/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/lenovo-legion-spectrum/device.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message, refused: !!e.refused, waiting: !!e.waiting }; } };

ok(!validateMeta(meta) && meta.id === shipped.id && meta.status === 'untested' && meta.tested.length === 0, 'device.json: well formed, same id, untested (installed only on a click)');
ok(JSON.stringify(meta.pids.map((p) => p.toUpperCase())) === JSON.stringify(PIDS) && meta.vid === '048d', 'device.json lists exactly the driver\'s id');
ok(!problem(shipped), 'loads as a my-devices driver');
const specs = hidSpecs(shipped);
ok(specs.length === 1 && specs[0].featureOnly === true && specs[0].featureLen === 959 && specs[0].page === '*', 'one channel: feature-only, the 960-byte report, any usage page (LLT finds it by length)');

// a pretend controller
function controller({ compatible = true, brightness = 5, logo = 1, profile = 2, stickBrightness = true } = {}) {
  const st = { brightness, logo, profile, sent: [], last: null };
  return {
    st,
    async sendFeatureReport(id, data) {
      const d = Array.from(data);
      st.sent.push([id, ...d]);
      if (id !== 7 || d[1] !== 0xc0 || d[2] !== 0x03) throw new Error('bad header');
      const op = d[0], v = d[3];
      if (op === 0xce && stickBrightness) st.brightness = v;
      if (op === 0xa6) st.logo = v;
      if (op === 0xc8) st.profile = v;
      st.last = op;
    },
    async receiveFeatureReport(id, len) {
      const op = st.last;
      const val = op === 0xd1 ? (compatible ? 0 : 1) : op === 0xcd || op === 0xce ? st.brightness : op === 0xa5 || op === 0xa6 ? st.logo : st.profile;
      const echo = op === 0xce ? 0xce : op;
      const u8 = new Uint8Array([7, echo, 0x10, 0, val, ...new Array(Math.max(0, len - 4)).fill(0)].slice(0, len + 1));
      return new DataView(u8.buffer);
    },
  };
}
const make = (dev, extra = {}) => createLegion({ open: async () => dev, sleep: async () => {}, vendorApp: async () => null, ...extra });

// the gate first, then reads
let dev = controller();
let d = make(dev);
ok(await d.connect(), 'connects to 048D:C197');
const values = await d.read();
ok(dev.st.sent[0][1] === OPS.compatibility, 'the first request is the compatibility check');
ok(values.brightness === 5 && values.logo === true && values.profile === 2, `reads brightness, logo and profile (${JSON.stringify(values)})`);
ok(dev.st.sent.every((s) => s[0] === 7 && [0xd1, 0xcd, 0xa5, 0xca].includes(s[1])), 'reading sends only the compatibility check and the three reads');

// writes: each read back
ok((await d.write('brightness', 8)) === 8 && dev.st.brightness === 8, 'brightness written and read back');
ok((await d.write('logo', false)) === false && dev.st.logo === 0, 'the logo light written and read back');
ok((await d.write('profile', 4)) === 4 && dev.st.profile === 4, 'the profile written and read back');
ok(!(await attempt(() => d.write('brightness', 12))).ok && !(await attempt(() => d.write('profile', 0))).ok && !(await attempt(() => d.write('logo', 1))).ok, 'out-of-range values are refused before anything is sent');
ok(dev.st.sent.every((s) => Object.values(OPS).includes(s[1]) && !NEVER[s[1]]), 'only the allowed commands were ever sent');
for (const op of [0xc9, 0xcb, 0xd0, 0xa1, 0xc4, 0x00]) ok((await attempt(() => d.request(op))).refused, `never sends ${op.toString(16)}`);

// a write that does not stick is an error (the self-check then keeps it read-only)
dev = controller({ stickBrightness: false });
d = make(dev);
await d.connect();
ok(/read back 5, not 7/.test((await attempt(() => d.write('brightness', 7))).e || ''), 'a brightness that did not stick is reported');

// Vantage open: no writes, and it says to wait
dev = controller();
d = make(dev, { vendorApp: async () => 'LenovoVantage.exe' });
await d.connect();
const v = await attempt(() => d.write('brightness', 3));
ok(!v.ok && v.waiting && /LenovoVantage/.test(v.e) && dev.st.brightness === 5 && !dev.st.sent.some((s) => s[1] === 0xce), 'nothing written while Lenovo Vantage runs');
ok((await attempt(() => d.read())).ok, 'reading still works while it runs');

// a stranger on ITE's id: the check fails, and nothing more is ever sent
dev = controller({ compatible: false });
d = make(dev);
await d.connect();
const s1 = await attempt(() => d.read());
const s2 = await attempt(() => d.write('brightness', 1));
ok(!s1.ok && s1.refused && !s2.ok && dev.st.sent.length === 1 && dev.st.sent[0][1] === 0xd1, 'a controller that fails the check gets nothing after it');

// a self-check run of the shipped settings against the pretend controller passes every one
const { selfCheck } = await import('../helpers/my-devices.mjs');
dev = controller();
d = make(dev);
await d.connect();
const sc = await selfCheck(d, d.write, { backup: async () => {}, makerApp: async () => null });
ok(sc.ran && sc.counts.passed === 3 && sc.counts.failed === 0, `the self-check passes all three settings (${JSON.stringify(sc.counts)})`);
ok(dev.st.brightness === 5 && dev.st.logo === 1 && dev.st.profile === 2, 'and leaves every value as it was');

// DeviceHub's never list blocks the profile reset on this controller, whatever a driver asks
const { neverHit } = await import('../helpers/never-guard.mjs');
ok(!!neverHit({ vid: '048d', pid: 'c197', page: '*', reportId: 7, bytes: [0xc9, 0xc0, 3, 1] }) && !neverHit({ vid: '048d', pid: 'c197', page: '*', reportId: 7, bytes: [0xce, 0xc0, 3, 5] }), 'the never list blocks C9 (profile reset) and lets brightness through');

// the library offers it for the friend's laptop (his USB list from support report #24), on a click only (untested)
const { match } = await import('../helpers/device-library.mjs');
const hisUsb = [{ vid: '048d', pid: 'c197' }, { vid: '048d', pid: 'c193' }, { vid: '1038', pid: '12ec' }, { vid: '3710', pid: '5403' }];
const m = match(hisUsb, { root: ROOT }).find((x) => x.name === 'lenovo-legion-spectrum');
ok(m && m.matched.length === 1 && m.matched[0].pid === 'c197' && !m.installable, 'matches his C197 only, and does not install by itself');
ok(match(hisUsb, { root: ROOT, untested: true }).find((x) => x.name === 'lenovo-legion-spectrum')?.installable, 'installable on a click');

if (fails) { console.log(`sim-legion: ${fails} FAILED`); process.exit(1); }
console.log('sim-legion (Legion Gen 10 keyboard lights, simulated: the gate first, allowed commands only, read-back, Vantage, a stranger): all good');
