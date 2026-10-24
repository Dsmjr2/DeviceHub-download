// G HUB's virtual keyboard and mouse (046D:C232 / C231, only a HID entry, no USB\ entry) are not devices on This PC;
// a real G813 (C232 on USB) stays (24 Oct 2026, Dsmjr2/DeviceHub-support#17). And a library driver that stepped aside is
// absent whether or not it was seen once (helpers/my-devices.mjs isAbsent).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { isAbsent, stepAside } from '../helpers/my-devices.mjs';
const require = createRequire(import.meta.url);
const { _test: { shape } } = require('../helpers/pc-map.js');
const base = { cpu: null, gpus: [], board: null, ram: [], smbus: [] };
const hid = (vid, pid, o = {}) => ({ vid, pid, name: 'HID Keyboard Device', kb: false, mouse: false, onUsb: false, ...o });
let pc = shape({ ...base, usb: [hid('046d', 'c232', { kb: true }), hid('046d', 'c231', { mouse: true }), hid('046d', 'c54d', { onUsb: true, name: 'LIGHTSPEED Receiver' }), hid('046d', 'c54d', { mouse: true })] });
assert.deepEqual(pc.usb.map((u) => u.id), ['046d:c54d'], 'G HUB virtual devices left out');
pc = shape({ ...base, usb: [hid('046d', 'c232', { onUsb: true, name: 'USB Composite Device' }), hid('046d', 'c232', { kb: true })] });
assert.deepEqual(pc.usb.map((u) => u.id), ['046d:c232'], 'a real G813 on USB stays');
assert.equal(isAbsent({ plugin: true, notMine: { why: 'x' } }, 'connecting', true), true, 'stepped aside: absent while it retries');
// a driver whose connect says yes on a shared receiver and steps aside at its first read (the Logitech keyboard driver):
// absent the whole time, also between that yes and the read, until a read of its own succeeds
{ let mine = false;
  const nm = () => Object.assign(new Error('no keyboard answered'), { notMine: true, gone: true });
  const a = stepAside({ plugin: true, connect: async () => true, read: async () => { if (!mine) throw nm(); return {}; } }, { log: () => {} });
  assert.equal(await a.connect(), true);
  await a.read().catch(() => {});
  assert.equal(isAbsent(a, 'missing', true), true, 'stepped aside: absent');
  await a.connect();
  assert.equal(isAbsent(a, 'connecting', true), true, 'its next connect says yes: still absent (it used to show here)');
  mine = true; await a.read();
  assert.equal(isAbsent(a, 'connected', true), false, 'a read of its own: shown'); }
console.log('ghub-virtual (G HUB virtual keyboard not listed, a stepped-aside driver stays hidden): all good');
