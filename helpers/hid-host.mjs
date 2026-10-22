// HIDDevice stand-ins for the agent: each talks to its own channel of the native helper (helpers/native.js), so
// the real browser drivers (public/devices/via.js, pulsar.js) run unchanged inside the server with no prompts.
import { createRequire } from 'node:module';
import { ECHO } from '../public/devices/via.js';

const native = createRequire(import.meta.url)('./native.js');
const power = createRequire(import.meta.url)('./power.js');

// replyMs stays below the driver's own timeout (pulsar.js 1200 ms, via.js 1000 ms), so "no reply" always reaches
// the driver before it gives up and a late reply can never be mistaken for the next one.
export const SPECS = [
  { id: 'mouse', vendorId: 0x3710, productId: 0x5406, usagePage: 0xff02, vid: '3710', pid: '5406', page: 'FF02', usage: '0002', len: 16, reportId: 8, replyMs: 900, productName: 'Pulsar 8K Dongle', echo: () => 1,
    // it announces a DPI button press by itself (command 0A, measured 21 Oct 2026): listened for, see watch
    watch: '0a',
    // on its USB cable (charging) the mouse is its own device, 3710:3506, with the same config collection; the dongle
    // then reports it offline. The cable is used whenever it is plugged in (measured 19 Oct 2026).
    cablePid: '3506' },
  { id: 'keyboard', vendorId: 0x342d, productId: 0xe479, usagePage: 0xff60, vid: '342D', pid: 'E479', page: 'FF60', usage: '0061', len: 32, reportId: 0, replyMs: 750, productName: 'EPOMAKER P75', echo: (b) => ECHO[b[0]] ?? 1 },
];

// Windows' device messages reach DeviceHub (the helper's window, helpers/native/tray.cs): a cable plugged in or out is
// then looked at the moment Windows says so (devicesChanged), and the timed look is only a fallback (21 Oct 2026)
let windowsEvents = false;
export function useWindowsEvents(on) { windowsEvents = !!on; }

// a device's own announcement (the mouse's DPI button): onAnnounce(id); whether its listener runs: onWatching(id, on)
let onAnnounce = () => {}, onWatching = () => {};
export function setAnnounceHandlers(press, watching) { onAnnounce = press; onWatching = watching; }

let onGone = () => {};
export function setGoneHandler(fn) { onGone = fn; }
// a device moved between its cable and its dongle: the agent re-reads it at once (battery, charging)
let onMoved = () => {};
export function setMovedHandler(fn) { onMoved = fn; }

class HostDevice {
  constructor(spec) {
    Object.assign(this, { vendorId: spec.vendorId, productId: spec.productId, productName: spec.productName });
    this.spec = spec;
    this.collections = [{ usagePage: spec.usagePage, usage: parseInt(spec.usage, 16), inputReports: [], outputReports: [], featureReports: [] }];
    this.opened = false;
    this.listeners = new Set();
    this.ps = null; this.buf = ''; this.waiters = new Map(); this.seq = 0;
  }

  chanFor(pid) { const s = this.spec; return `hid:${s.vid}:${pid}:${s.page}:${s.usage}:${s.len}:${s.reportId}`; }
  get chan() { return this.chanFor(this.pid || this.spec.pid); }
  get onCable() { return !!this.spec.cablePid && this.pid === this.spec.cablePid; }

  // One command on this device's channel; resolves with the reply text, 'GONE' or 'TIMEOUT'.
  line(cmd, ms) { return native.request(this.chan, cmd, ms); }

  // Opens the device if it is plugged in. Resolves true / false.
  async tryOpen() {
    if (this.opened) return true;
    for (const pid of [this.spec.cablePid, this.spec.pid].filter(Boolean)) {
      if ((await native.request(this.chanFor(pid), 'OPEN', 15000)) === 'OK') { this.pid = pid; this.opened = true; this.cableCheckAt = Date.now(); this.watchCable(); this.listen(); return true; }
    }
    return false;
  }

  // what the device announces by itself (spec.watch: its command byte), on the channel just opened (helpers/hidio.cs HidWatch)
  listen() {
    const s = this.spec;
    if (!s.watch) return;
    const chan = this.chan;
    native.onEvent(chan, () => onAnnounce(s.id));
    native.request(chan, `WATCH ${s.watch}`, 5000).then((r) => onWatching(s.id, r === 'OK')).catch(() => onWatching(s.id, false));
  }

  // A device with a cable mode: move to the cable when it is plugged in (looked for every 10 s), and back to the
  // dongle when it is unplugged. Returns true when the channel changed.
  async followCable() {
    const s = this.spec;
    if (!s.cablePid || this.onCable || Date.now() - (this.cableCheckAt || 0) < (windowsEvents ? 60000 : 10000)) return false;
    this.cableCheckAt = Date.now();
    if ((await native.request(this.chanFor(s.cablePid), 'OPEN', 5000)) !== 'OK') return false;
    native.request(this.chanFor(s.pid), 'CLOSE', 3000);
    this.pid = s.cablePid;
    return true;
  }
  async backToDongle() {
    const s = this.spec;
    if (!this.onCable) return false;
    native.request(this.chanFor(s.cablePid), 'CLOSE', 3000);
    this.pid = s.pid;
    this.cableCheckAt = Date.now();
    return (await native.request(this.chanFor(s.pid), 'OPEN', 5000)) === 'OK';
  }

  async open() { if (!(await this.tryOpen())) throw Object.assign(new Error(`${this.productName} is not plugged in`), { gone: true }); }
  addEventListener(t, fn) { if (t === 'inputreport') this.listeners.add(fn); }
  removeEventListener(t, fn) { this.listeners.delete(fn); }

  gone() {
    const was = this.opened;
    this.opened = false;
    if (was) onGone(this.spec.id);
    return Object.assign(new Error(`${this.productName} was unplugged`), { gone: true });
  }

  // Requests and the cable check take turns on one queue, so a check never lands between a request and its reply.
  serial(fn) { const p = (this.q || Promise.resolve()).then(fn, fn); this.q = p.catch(() => {}); return p; }

  // Every 3 s while on the cable: is it still plugged in (a one-report check; GONE = pulled)? Every 10 s on the
  // dongle: has the cable appeared? Either change switches the channel and has the device re-read straight away,
  // so "Charging" clears within seconds of unplugging (19 Oct 2026: it stayed for a minute, until the next read).
  watchCable() {
    if (!this.spec.cablePid || this.watch) return;
    // every 3 s (9 s on battery with the battery saver); every 30 s when Windows' device messages arrive
    const loop = () => { this.watch = setTimeout(() => this.serial(async () => {
      if (!this.opened) return;
      const s = this.spec;
      if (this.onCable) {
        const probe = s.echo([0x04]);
        const r = await native.request(this.chan, `REQ ${probe} 200 04 00 00 00 00 00 00 00 00 00 00 00 00 00 00 49`, 3000);
        if (r === 'GONE') { if (await this.backToDongle()) onMoved(s.id); else this.gone(); }
      } else if (await this.followCable()) onMoved(s.id);
    }).catch(() => {}).finally(() => { if (this.watch) loop(); }), power.every(windowsEvents ? 30000 : 3000)); };
    loop();
  }

  // Windows reported a device change: check the cable now instead of on the next timed look
  // Resolves true when the channel moved (cable in or out).
  checkCableNow() {
    if (!this.spec.cablePid || !this.opened) return Promise.resolve(false);
    this.cableCheckAt = 0;
    return this.serial(async () => {
      if (!this.opened) return false;
      if (this.onCable) {
        const r = await native.request(this.chan, `REQ ${this.spec.echo([0x04])} 200 04 00 00 00 00 00 00 00 00 00 00 00 00 00 00 49`, 3000);
        if (r === 'GONE') { if (await this.backToDongle()) onMoved(this.spec.id); else this.gone(); return true; }
        return false;
      }
      if (await this.followCable()) { onMoved(this.spec.id); return true; }
      return false;
    }).catch(() => false);
  }

  async sendReport(id, data) { return this.serial(() => this.sendNow(id, data)); }
  async sendNow(id, data) {
    if (!this.opened) throw Object.assign(new Error(`${this.productName} was unplugged`), { gone: true });
    const bytes = Array.from(data);
    const s = this.spec;
    await this.followCable();
    const req = `REQ ${s.echo(bytes)} ${s.replyMs} ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    let reply = await this.line(req, s.replyMs + 3000);
    // the cable was pulled: carry on over the dongle
    if (reply === 'GONE' && this.onCable && (await this.backToDongle())) reply = await this.line(req, s.replyMs + 3000);
    if (reply === 'GONE') throw this.gone();
    if (reply === 'NONE' || reply === 'TIMEOUT' || !/^[0-9a-f ]+$/.test(reply)) return; // no answer: the driver's own timeout reports it
    const u8 = Uint8Array.from(reply.split(' ').map((x) => parseInt(x, 16)));
    const e = { reportId: id, data: new DataView(u8.buffer) };
    setTimeout(() => { for (const fn of [...this.listeners]) fn(e); }, 0);
  }

  // Feature reports (22 Oct 2026; HID LampArray in helpers/lamparray.mjs, and Razer, SteelSeries, ROCCAT), in WebHID's
  // shape, over the helper's FSET / FGET (helpers/hidio.cs FeatureSet / FeatureGet, HidD_SetFeature / HidD_GetFeature).
  // sendFeatureReport(id, data): data without the report id; resolves when the device took it, else throws
  // (gone: true when unplugged). receiveFeatureReport(id, length): a DataView that, as in WebHID, starts with the report
  // id when id is not 0; length = data bytes wanted (spec.featureLen, else spec.len, when left out).
  async sendFeatureReport(id, data) {
    return this.serial(async () => {
      if (!this.opened) throw this.gone();
      const hex = [id, ...Array.from(data)].map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
      const r = await this.line(`FSET ${hex}`, 5000);
      if (r === 'GONE') throw this.gone();
      if (r !== 'OK') throw new Error(`${this.productName} did not take feature report ${id} (${r})`);
    });
  }
  async receiveFeatureReport(id, length = this.spec.featureLen || this.spec.len) {
    return this.serial(async () => {
      if (!this.opened) throw this.gone();
      const r = await this.line(`FGET ${(id & 0xff).toString(16).padStart(2, '0')} ${length}`, 5000);
      if (r === 'GONE') throw this.gone();
      if (!/^([0-9a-f]{2}( |$))*$/.test(r) || r === '') throw new Error(`${this.productName} did not answer feature report ${id} (${r || 'empty'})`);
      const bytes = r.split(' ').map((x) => parseInt(x, 16));
      const u8 = Uint8Array.from(id ? [id, ...bytes] : bytes);
      return new DataView(u8.buffer);
    });
  }

  close() { if (this.opened) native.request(this.chan, 'CLOSE', 3000); this.opened = false; this.pid = null; }
}

const hosts = SPECS.map((s) => new HostDevice(s));
// a device added in my-devices\ (helpers/my-devices.mjs) with its HID channel: opened the same way as the built-in ones.
// echo(bytes): how many leading bytes of a request its reply repeats (1 unless the device file says otherwise)
export function addSpec(spec) {
  const up = (x) => String(x).toUpperCase().padStart(4, '0');
  const s = { usage: '0001', len: 64, reportId: 0, replyMs: 900, echo: () => 1, ...spec,
    vid: up(spec.vid), pid: up(spec.pid), page: up(spec.page || 'FF00'), productName: spec.productName || spec.id };
  Object.assign(s, { vendorId: parseInt(s.vid, 16), productId: parseInt(s.pid, 16), usagePage: parseInt(s.page, 16), usage: up(s.usage) });
  if (s.cablePid) s.cablePid = up(s.cablePid);
  SPECS.push(s); hosts.push(new HostDevice(s));
}
// another VIA keyboard instead of the P75 (helpers/via-defs.js): same channel settings, its own ids
export function useKeyboardSpec(vid, pid, name) {
  const i = SPECS.findIndex((s) => s.id === 'keyboard');
  const s = { ...SPECS[i], vid, pid, vendorId: parseInt(vid, 16), productId: parseInt(pid, 16), productName: name || 'VIA keyboard' };
  SPECS[i] = s; hosts[i] = new HostDevice(s);
}
// the helper stopped: every open device is gone until it reopens
native.onExit(() => { for (const h of hosts) if (h.opened) h.gone(); });

// The getDevice() provider for the agent: the matching device if it is plugged in, else null.
export async function provider(filters) {
  const f = filters[0];
  const h = hosts.find((x) => x.vendorId === f.vendorId && (f.productId == null || x.productId === f.productId) && (f.usagePage == null || x.spec.usagePage === f.usagePage));
  if (!h) return null;
  return (await h.tryOpen()) ? h : null;
}

// a device was added or removed (the helper's DeviceWatch): every host with a cable mode looks again now
// Windows announces a new device a moment before it can be opened (19 Oct 2026: the cable was found only on the next
// 10 s check), so each host looks now and again at about 1.5 and 3 s, stopping once it has moved.
export async function devicesChanged() {
  const moved = [];
  for (const h of hosts.filter((x) => x.spec.cablePid && x.opened)) {
    for (const wait of [0, 1100, 1500]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (await h.checkCableNow()) { moved.push(`${h.spec.id} ${h.onCable ? 'to its cable' : 'to its dongle'}`); break; }
    }
  }
  return moved;
}

export function closeAll() { for (const h of hosts) h.close(); }
