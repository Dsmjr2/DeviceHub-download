// The Logitech library drivers try every id in turn (31 Oct 2026, an audit): a receiver that holds only the other kind
// of device (a mouse for the keyboard driver, a keyboard for the mouse driver) no longer hides a wired one further down
// the list, and "not mine" comes only once every id was tried. Pretend HID++ devices, nothing real.
// Run: node tests/logitech-order.mjs
import { setDeviceProvider } from '../public/devices/hid.js';
import mouse, { F as MF } from '../device-library/logitech-hidpp-mouse/device.mjs';
import { createLogitechKeyboard, F as KF } from '../device-library/logitech-hidpp-keyboard/device.mjs';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
// a minimal HID++ 2.0 device: features { id: index }, answering on `slot`; kind: DEVICE_NAME fn 0x20 (0 keyboard, 3 mouse)
function fake(F, pid, slot, features, kind) {
  const ls = new Set(); const byIndex = Object.fromEntries(Object.entries(features).map(([id, i]) => [i, Number(id)]));
  return { opened: false, productId: pid, async open() { this.opened = true; }, close() {},
    addEventListener(t, fn) { ls.add(fn); }, removeEventListener(t, fn) { ls.delete(fn); },
    async sendReport(rid, data) {
      const b = Array.from(data); const [d, idx, fs] = b, p = b.slice(3); if (d !== slot) return;
      const emit = (x) => setTimeout(() => { for (const fn of [...ls]) fn({ reportId: 0x11, data: new DataView(Uint8Array.from(x).buffer) }); }, 1);
      const reply = (o) => emit([d, idx, fs, ...o, ...Array(16).fill(0)].slice(0, 19));
      const err = (c) => emit([d, 0xff, idx, fs, c, ...Array(14).fill(0)]);
      const fn = fs & 0xf0, id = idx === 0 ? 0 : byIndex[idx];
      if (id === 0 && fn === 0) { const w = (p[0] << 8) | p[1]; return reply(features[w] ? [features[w], 0, 1] : [0, 0, 0]); }
      if (id === 0 && fn === 0x10) return reply([4, 2, p[2]]);
      if (id === F.DEVICE_NAME && fn === 0x20) return reply([kind]);
      if (F.ADJUSTABLE_DPI && id === F.ADJUSTABLE_DPI && fn === 0x10) return reply([0, 0x03, 0x20, 0, 0]);
      return err(7);
    } };
}

// the keyboard driver: a mouse alone on C54D, a wired G815 (C33F)
{
  const mouseRx = fake(KF, 0xc54d, 1, { [KF.ADJUSTABLE_DPI]: 3, [KF.DEVICE_NAME]: 2 }, 3);
  const g815 = fake(KF, 0xc33f, 0xff, { [KF.ONBOARD_PROFILES]: 4 }, 0);
  const kb = Object.assign(createLogitechKeyboard({ open: async (p) => (p === 0xc54d ? mouseRx : p === 0xc33f ? g815 : null), vendorApp: async () => null }), { pingMs: 100 });
  let r, e;
  try { r = await kb.connect(); } catch (x) { e = x; }
  ok(r === true && kb.pid === 0xc33f && g815.opened, `keyboard driver: the wired G815 behind a mouse-only receiver is found (${e ? e.message : kb.pid?.toString(16)})`);
  // only the mouse receiver: not mine, as before
  const kb2 = Object.assign(createLogitechKeyboard({ open: async (p) => (p === 0xc54d ? mouseRx : null), vendorApp: async () => null }), { pingMs: 100 });
  let e2 = null;
  try { await kb2.connect(); } catch (x) { e2 = x; }
  ok(e2?.notMine, `keyboard driver: a mouse-only receiver and nothing else is still "not mine" (${e2?.message})`);
}

// the mouse driver: a keyboard alone on C539, a wired G502 HERO (C08B)
{
  const kbRx = fake(MF, 0xc539, 1, { [MF.DEVICE_NAME]: 2 }, 0);
  const wired = fake(MF, 0xc08b, 0xff, { [MF.ADJUSTABLE_DPI]: 3 }, 3);
  setDeviceProvider(async (filters) => { const f = filters[0]; return f.productId === 0xc539 ? kbRx : f.productId === 0xc08b ? wired : null; });
  mouse.pingMs = 100;
  let r, e;
  try { r = await mouse.connect(false); } catch (x) { e = x; }
  ok(r === true && wired.opened && mouse.pid === 0xc08b, `mouse driver: the wired G502 behind a keyboard-only receiver is found (${e ? e.message : mouse.pid?.toString(16)})`);
}

if (fails.length) { console.log(`logitech-order: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('logitech-order (every id tried in turn: a receiver holding the other kind of device hides nothing): all good');
process.exit(0);
