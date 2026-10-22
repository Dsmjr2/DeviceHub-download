// HyperX mice and keyboards (HP-era ids, vendor 03F0), info only (22 Oct 2026), from docs/brands/hyperx.md ("hx §n").
// Simulated in tests/sim-hyperx-peripherals.mjs; never run on a real device.
//
// What the sources document for these devices is lighting only (OpenRGB, hx §2 "Mice and keyboards"), and none of it
// can be read back: every lighting command is a write, and the only save command (Dart DE FF) is on DeviceHub's never
// list. No open source sends DPI, polling rate or battery to any HyperX mouse or keyboard (hx §3, §6). So this driver
// SENDS NOTHING: it names the device from its product id (model, mouse or keyboard, dongle or cable) and says where
// its settings and lights are. Its channel is opened with no access (featureOnly), on the interface and usage page
// OpenRGB names (hx §1), so it cannot write to the device at all. The one documented read, the Alloy Origins Core
// "variant query" (00 10), is not sent: OpenRGB names its interface (2) but not its usage page, and an output report
// sent to the keyboard's own collection would change its lock lights.
import { getDevice } from '../../public/devices/hid.js';

// hx §1 (OpenRGB HyperX*ControllerDetect.cpp): HP-era (03F0) ids, interface and usage page ('*' = not named)
export const MODELS = {
  '0F8F': { name: 'Pulsefire Haste', kind: 'mouse', link: 'cable', iface: 3, page: 'FF90' },
  '068E': { name: 'Pulsefire Dart', kind: 'mouse', link: 'dongle', iface: 2, page: 'FF00' },
  '088E': { name: 'Pulsefire Dart', kind: 'mouse', link: 'cable', iface: 1, page: 'FF13' },
  '0D8F': { name: 'Pulsefire Core', kind: 'mouse', link: 'cable', iface: 1, page: 'FF01' },
  '0490': { name: 'Pulsefire Surge', kind: 'mouse', link: 'cable', iface: 1, page: 'FF01' },
  '0C8E': { name: 'Alloy Origins 60', kind: 'keyboard', link: 'cable', iface: 3, page: '*' },
  '038F': { name: 'Alloy Origins 65', kind: 'keyboard', link: 'cable', iface: 3, page: '*' },
  '098F': { name: 'Alloy Origins Core', kind: 'keyboard', link: 'cable', iface: 2, page: '*' },
  '0591': { name: 'Alloy Origins', kind: 'keyboard', link: 'cable', iface: 3, page: 'FF90' },
  '0CC2': { name: 'Origins 2 65', kind: 'keyboard', link: 'cable', iface: 3, page: '*' },
};
export const PIDS = Object.keys(MODELS);
// hx §4: NGENUITY talks on the same interfaces (process name unconfirmed). Nothing is sent here, so it is only named.
export const VENDOR_APPS = [/^ngenuity/i];

export function createHyperXPeripherals({ open = defaultOpen } = {}) {
  return {
    id: 'hyperx-peripherals',
    title: 'HyperX mouse or keyboard',
    kind: 'Mouse or keyboard',
    vendor: 'HyperX',
    hid: { vid: '03F0', pid: '0F8F', pids: PIDS, page: '*', usage: '*', iface: 3, featureOnly: true, len: 64, reportId: 0,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { iface: MODELS[p].iface, page: MODELS[p].page, usage: '*' }])) },
    settings: [],
    unsupported: ['DPI, polling rate and battery (no open source documents them for any HyperX mouse)', 'lights (write-only; OpenRGB drives them)',
      'keyboard brightness and macros (write-only or undocumented)', 'Kingston-era ids (vendor 0951)', 'Pulsefire Haste 2, Alloy Rise (no ids or protocol in any source)', 'firmware updates (NGENUITY only)'],
    dev: null, pid: null, model: null,

    // the first listed product id that is plugged in; opening (no access) sends nothing
    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid, MODELS[pid]);
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid] }); return true; }
      }
      return false;
    },
    async info() {
      if (!this.dev) throw Object.assign(new Error('no HyperX mouse or keyboard is open'), { gone: true });
      return { Model: `HyperX ${this.model.name}`, Type: this.model.kind, Connection: this.model.link === 'dongle' ? 'wireless (dongle)' : 'cable', 'Product id': `03F0:${this.pid}`,
        Lights: 'through OpenRGB (Lighting page)', 'Other settings': 'NGENUITY only: no open source documents them' };
    },
    async read() { if (!this.dev) throw Object.assign(new Error('not open'), { gone: true }); return {}; },
    async write(key) { throw Object.assign(new Error(`${key}: nothing on this HyperX device can be read back, so DeviceHub changes nothing on it`), { refused: true }); },
    async battery() { return null; },
    async rawBackup() { return { pid: this.pid, model: this.model?.name, replies: {} }; },
  };
}

async function defaultOpen(pid, m) {
  const f = { vendorId: 0x03f0, productId: parseInt(pid, 16), iface: m.iface };
  if (m.page !== '*') f.usagePage = parseInt(m.page, 16);
  return getDevice([f], { prompt: false });
}

export default createHyperXPeripherals();
