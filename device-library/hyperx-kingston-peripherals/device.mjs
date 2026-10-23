// HyperX mice and keyboards on Kingston-era ids (vendor 0951), info only (23 Oct 2026), from docs/brands/hyperx.md
// ("hx §n") and OpenRGB's detectors (HyperXMouseControllerDetect.cpp, HyperXAlloyOrigins*ControllerDetect.cpp). Its own
// folder because a library entry declares one vendor id; the HP-era (03F0) ids are in device-library/hyperx-peripherals,
// which this one follows. Simulated in tests/sim-hyperx-peripherals.mjs; never run on a real device.
//
// What the sources document for these devices is lighting only (OpenRGB), and none of it can be read back. No open
// source sends DPI, polling rate or battery to them (hx §3, §6); open-pulsefire-haste documents the Haste WIRELESS
// (03F0:048E / 028E), not this wired 0951:1727. So this driver SENDS NOTHING: it names the device from its product id and
// says where its settings and lights are. Its channel is opened with no access (featureOnly), on the interface (and,
// for the Haste, the usage page) OpenRGB names for Windows, so it cannot write to the device at all. The Alloy Origins
// Core "variant query" (00 10) is not sent, for the reason hyperx-peripherals gives (no usage page named).
import { getDevice } from '../../public/devices/hid.js';

// OpenRGB, the _WIN32 detector lines: Kingston-era (0951) ids, interface and usage page ('*' = not named)
export const MODELS = {
  '1727': { name: 'Pulsefire Haste', kind: 'mouse', link: 'cable', iface: 3, page: 'FF90' },
  '16E5': { name: 'Alloy Origins', kind: 'keyboard', link: 'cable', iface: 3, page: '*' },
  '16E6': { name: 'Alloy Origins Core', kind: 'keyboard', link: 'cable', iface: 2, page: '*' },
  '1734': { name: 'Alloy Origins 60', kind: 'keyboard', link: 'cable', iface: 3, page: '*' },
};
export const PIDS = Object.keys(MODELS);
// hx §4: NGENUITY talks on the same interfaces (process name unconfirmed). Nothing is sent here, so it is only named.
export const VENDOR_APPS = [/^ngenuity/i];

export function createHyperXPeripherals({ open = defaultOpen } = {}) {
  return {
    id: 'hyperx-kingston-peripherals',
    title: 'HyperX mouse or keyboard (Kingston)',
    kind: 'Mouse or keyboard',
    vendor: 'HyperX',
    hid: { vid: '0951', pid: '1727', pids: PIDS, page: '*', usage: '*', iface: 3, featureOnly: true, len: 64, reportId: 0,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { iface: MODELS[p].iface, page: MODELS[p].page, usage: '*' }])) },
    settings: [],
    unsupported: ['DPI, polling rate and battery (no open source documents them for any HyperX mouse)', 'lights (write-only; OpenRGB drives them)',
      'keyboard brightness and macros (write-only or undocumented)', 'HP-era ids (vendor 03F0): device-library/hyperx-peripherals', 'Pulsefire Haste 2, Alloy Rise (no ids or protocol in any source)', 'firmware updates (NGENUITY only)'],
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
      return { Model: `HyperX ${this.model.name}`, Type: this.model.kind, Connection: this.model.link === 'dongle' ? 'wireless (dongle)' : 'cable', 'Product id': `0951:${this.pid}`,
        Lights: 'through OpenRGB (Lighting page)', 'Other settings': 'NGENUITY only: no open source documents them' };
    },
    async read() { if (!this.dev) throw Object.assign(new Error('not open'), { gone: true }); return {}; },
    async write(key) { throw Object.assign(new Error(`${key}: nothing on this HyperX device can be read back, so DeviceHub changes nothing on it`), { refused: true }); },
    async battery() { return null; },
    async rawBackup() { return { pid: this.pid, model: this.model?.name, replies: {} }; },
  };
}

async function defaultOpen(pid, m) {
  const f = { vendorId: 0x0951, productId: parseInt(pid, 16), iface: m.iface };
  if (m.page !== '*') f.usagePage = parseInt(m.page, 16);
  return getDevice([f], { prompt: false });
}

export default createHyperXPeripherals();
