// HIDDevice stand-ins for the agent: each talks to its own channel of the native helper (helpers/native.js), so
// the real browser drivers (public/devices/via.js, pulsar.js) run unchanged inside the server with no prompts.
import { createRequire } from 'node:module';
import { ECHO } from '../public/devices/via.js';
import { neverHit, refusal } from './never-guard.mjs';

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

  // s.opts: the library channel options (channelOpts below); '' / undefined for every channel before them
  chanFor(pid) { const s = this.spec; return `hid:${s.vid}:${pid}:${s.page}:${s.usage}:${s.len}:${s.reportId}${s.opts || ''}`; }
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
    if (this.kids) for (const k of Object.values(this.kids)) k.opened = false;
    if (this.extras) for (const k of Object.values(this.extras)) k.opened = false;
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

  // The never list (22 Oct 2026, safety round 2; helpers/never-guard.mjs): on a channel a library or my-devices driver
  // asked for (spec.never, set by addSpec), every report is checked before any byte goes out. DeviceHub's own channels
  // (SPECS above, useKeyboardSpec) have no spec.never and are never checked, so their bytes are exactly as before.
  checkNever(id, bytes) {
    const s = this.spec;
    if (!s.never) return;
    const hit = neverHit({ vid: s.vid, pid: this.pid || s.pid, page: s.page, reportId: id, bytes });
    if (hit) throw refusal(hit, this.productName);
  }

  async sendReport(id, data) { return this.serial(() => this.sendNow(id, data)); }
  async sendNow(id, data) {
    const bytes = Array.from(data);
    this.checkNever(id, bytes);
    if (!this.opened) throw Object.assign(new Error(`${this.productName} was unplugged`), { gone: true });
    const s = this.spec;
    // library options (22 Oct 2026), each off unless the spec asks: a report id owned by another collection
    // (spec.routes), a raw channel (spec.reply 'raw'), another report id on this collection (spec.reportIds)
    if (s.routes && id !== s.reportId && s.routes[id]) return this.viaRoute(id, bytes);
    if (s.reply === 'raw') return this.sendRaw(id, bytes);
    await this.followCable();
    const other = id !== s.reportId && Array.isArray(s.reportIds) && s.reportIds.includes(id);
    const req = `${other ? `REQR ${hex2(id)} ` : 'REQ '}${s.echo(bytes)} ${s.replyMs} ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
    let reply = await this.line(req, s.replyMs + 3000);
    // the cable was pulled: carry on over the dongle
    if (reply === 'GONE' && this.onCable && (await this.backToDongle())) reply = await this.line(req, s.replyMs + 3000);
    if (reply === 'GONE') throw this.gone();
    // only a channel with spec.refusals answers this (rf=1): the device refused the write and is still there
    if (/^REFUSED/.test(reply)) throw this.refused(reply, id);
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
      this.checkNever(id, Array.from(data));
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

  // ---- library options (22 Oct 2026; docs/handoff/hid-core.md). None runs for a spec that does not ask for it. ----

  // a write the device refused while still plugged in: not gone, so a driver's fallback can run (e.refused, e.code)
  refused(reply, id) {
    const code = Number(String(reply).split(' ')[1]) || null;
    return Object.assign(new Error(`${this.productName} refused report ${id}${code ? ` (Windows error ${code})` : ''}`), { refused: true, code });
  }

  // spec.reply === 'raw': SEND writes the report (with the id the driver gives, as WebHID does), then input reports are
  // read (READ) and handed to the listeners as they came, for up to replyMs while a listener attached before the send
  // is still waiting. The driver matches its replies itself (HID++ error replies, ASUS FF AA, notices).
  async sendRaw(id, bytes) {
    const s = this.spec, waiting = [...this.listeners];
    const r = await this.line(`SEND ${hex2(id)} ${bytes.map(hex2).join(' ')}`.trim(), 5000);
    if (r === 'GONE') throw this.gone();
    if (/^REFUSED/.test(r)) throw this.refused(r, id);
    if (r !== 'OK') throw new Error(`${this.productName} did not take report ${id} (${r})`);
    const until = Date.now() + s.replyMs;
    while (waiting.some((fn) => this.listeners.has(fn)) && Date.now() < until) {
      for (const e of await this.readRaw(Math.min(250, until - Date.now()))) for (const fn of [...this.listeners]) fn(e);
    }
  }
  async readRaw(ms) {
    const r = await this.line(`READ ${Math.max(0, Math.round(ms))}`, ms + 3000);
    if (r === 'GONE') throw this.gone();
    if (!/^[0-9a-f]{2}( [0-9a-f]{2})*(\|[0-9a-f]{2}( [0-9a-f]{2})*)*$/.test(r)) return [];   // NONE, TIMEOUT, ERR
    return r.split('|').map((one) => {
      const b = one.split(' ').map((x) => parseInt(x, 16));
      return { reportId: b[0], data: new DataView(Uint8Array.from(b.slice(1)).buffer) };
    });
  }
  // Raw channel only: the input reports the device sent by itself (notices), waiting up to ms for the first.
  // Resolves [{ reportId, data: DataView }] (the same shape as an inputreport event); [] when none came.
  async receiveReports(ms = 0) {
    return this.serial(async () => {
      if (!this.opened) throw this.gone();
      if (this.spec.reply !== 'raw') throw new Error(`${this.productName}: receiveReports needs hid.reply 'raw'`);
      return this.readRaw(ms);
    });
  }

  // spec.routes: { <report id>: { col, iface, page, usage, len, ... } } = that report id lives on another collection of
  // the same device (the ROG Omni receiver's pair list on col01, its mouse on col03). Opened on first use, same pid.
  kid(id) {
    this.kids ||= {};
    let k = this.kids[id];
    if (!k || k.spec.pid !== this.pid) {
      const spec = normalize({ ...this.spec, cablePid: null, watch: null, routes: null, reportIds: null, ...this.spec.routes[id], reportId: id, pid: this.pid || this.spec.pid });
      k = new HostDevice(spec);
      k.listeners = this.listeners;                         // its replies reach the driver's listeners
      k.gone = () => { k.opened = false; return this.gone(); };
      this.kids[id] = k;
    }
    return k;
  }
  async viaRoute(id, bytes) {
    const k = this.kid(id);
    if (!k.opened && !(await k.tryOpen())) throw new Error(`${this.productName}: the collection for report ${id} did not open`);
    return k.sendNow(id, bytes);
  }

  // spec.inputReports: true (22 Oct 2026; docs/handoff/hid-input-reports.md): asks the device for input report `id`
  // (helper IGET, HidD_GetInputReport, hidapi's get_input_report) instead of waiting for one to arrive. Resolves
  // { reportId, data: DataView } (an inputreport event's shape; data = `length` bytes after the report id), or null when
  // the device did not answer it. Refused on a channel that did not ask for it, so no other channel ever sends IGET.
  async getInputReport(id, length = this.spec.inputLen ?? this.spec.len) {
    if (!this.spec.inputReports) throw new Error(`${this.productName}: getInputReport needs hid.inputReports`);
    return this.serial(async () => {
      if (!this.opened) throw this.gone();
      const r = await this.line(`IGET ${hex2(id)} ${Math.max(0, Math.round(length))}`, 5000);
      if (r === 'GONE') throw this.gone();
      if (r === 'NONE') return null;
      if (!/^[0-9a-f]{2}( [0-9a-f]{2})*$/.test(r)) throw new Error(`${this.productName} did not answer input report ${id} (${r || 'empty'})`);
      return { reportId: id, data: new DataView(Uint8Array.from(r.split(' ').map((x) => parseInt(x, 16))).buffer) };
    });
  }

  // spec.extra: [{ name, page, usage, iface, col, len, inputLen, reportId }] (22 Oct 2026; docs/handoff/hid-input-reports.md)
  // = another collection of the SAME device (same vid, the pid this one opened) that a driver only listens to, such as
  // Wooting's analog key-depth collection beside its config channel. Nothing is opened until the driver asks:
  // extraChannel(name) returns { name, spec, opened, open(), receiveReports(ms), close() }, a raw read-only channel
  // (READ only: it has no way to send). Its GONE closes only it; the device's own channel finds out on its next request.
  extraChannel(name) {
    const e = (this.spec.extra || []).find((x) => x && x.name === name);
    if (!e) throw new Error(`${this.productName}: no extra collection named ${name}`);
    const pid = this.pid || this.spec.pid;
    this.extras ||= {};
    let k = this.extras[name];
    if (!k || k.spec.pid !== pid) {
      if (k) k.close();
      const { name: _n, ...own } = e;
      k = new HostDevice(normalize({ id: `${this.spec.id}:${name}`, vid: this.spec.vid, pid, productName: `${this.productName} (${name})`, len: 64, reportId: 0, ...own, reply: 'raw', replyMs: 0 }));
      k.gone = () => { k.opened = false; return Object.assign(new Error(`${k.productName} is not open`), { gone: true }); };
      this.extras[name] = k;
    }
    const main = this;
    return {
      name, spec: k.spec,
      get opened() { return k.opened; },
      async open() { return main.opened ? k.tryOpen() : false; },
      async receiveReports(ms = 0) {
        if (!k.opened && !(main.opened && (await k.tryOpen()))) throw k.gone();
        return k.serial(async () => { if (!k.opened) throw k.gone(); return k.readRaw(ms); });
      },
      close() { k.close(); },
    };
  }

  close() {
    if (this.extras) for (const k of Object.values(this.extras)) k.close();
    if (this.kids) for (const k of Object.values(this.kids)) k.close();
    if (this.opened) native.request(this.chan, 'CLOSE', 3000); this.opened = false; this.pid = null;
  }
}

const hex2 = (b) => (b & 0xff).toString(16).padStart(2, '0');
const up4 = (x) => String(x).toUpperCase().padStart(4, '0');
const pageOf = (x) => (x === '*' ? '*' : up4(x));

// The channel options a spec asks for (helpers/native/helper.cs HandleHidEx), as name parts after the report id.
// '' when it asks for none: such a channel is named, opened and served exactly as before 22 Oct 2026.
//   iface, col             the USB interface (&mi_0N) and collection (&col0N) in the device path
//   inputLen, outputLen    report data bytes (without the report id) the collection must have; they also size reads/writes
//   featureLen             also a match (fl), but only beside one of the new choices here; alone it keeps its old meaning
//                          (receiveFeatureReport's default length), so a LampArray spec opens as it did
//   featureOnly            opened with no access: FSET / FGET only      reply: 'raw'   SEND / READ (sendRaw above)
//   refusals               a refused write answers REFUSED, not GONE (always so on a raw channel)
//   inputReports           IGET: getInputReport(id, length) asks the device for an input report (HidD_GetInputReport)
export function channelOpts(s) {
  const o = [];
  if (s.iface != null) o.push(`if=${Number(s.iface)}`);
  if (s.col != null) o.push(`col=${Number(s.col)}`);
  if (s.inputLen != null) o.push(`il=${Number(s.inputLen)}`);
  if (s.outputLen != null) o.push(`ol=${Number(s.outputLen)}`);
  const chooses = o.length || s.page === '*' || s.usage === '*' || s.featureOnly;
  if (s.featureLen != null && chooses) o.push(`fl=${Number(s.featureLen)}`);
  if (s.featureOnly) o.push('fo=1');
  if (s.reply === 'raw') o.push('rw=1');
  if (s.refusals) o.push('rf=1');
  if (s.inputReports) o.push('gi=1');
  return o.length ? `:${o.join(':')}` : '';
}

// a spec as hid-host keeps it (addSpec's defaults; page / usage '*' = any, for the options above)
function normalize(spec) {
  const s = { usage: '0001', len: 64, reportId: 0, replyMs: 900, echo: () => 1, ...spec,
    vid: up4(spec.vid), pid: up4(spec.pid), page: pageOf(spec.page || 'FF00'), productName: spec.productName || spec.id };
  Object.assign(s, { vendorId: parseInt(s.vid, 16), productId: parseInt(s.pid, 16), usagePage: s.page === '*' ? null : parseInt(s.page, 16), usage: pageOf(s.usage) });
  if (s.cablePid) s.cablePid = up4(s.cablePid);
  s.opts = channelOpts(s);
  return s;
}

const hosts = SPECS.map((s) => new HostDevice(s));
// a device added in my-devices\ (helpers/my-devices.mjs) with its HID channel: opened the same way as the built-in ones.
// echo(bytes): how many leading bytes of a request its reply repeats (1 unless the device file says otherwise)
// One channel per call; a driver with several product ids gets one call per id (helpers/my-devices.mjs hidSpecs).
// Options for library drivers: channelOpts above, and on the HostDevice reply 'raw', routes, reportIds.
export function addSpec(spec) {
  const s = normalize(spec);
  s.never = true;   // a library or my-devices driver's channel: the never list is checked before every send (checkNever)
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
// Each filter in order (22 Oct 2026; before, only the first was looked at): its first matching host, the first that
// opens wins. A filter's iface, when the host has one, must be the same.
export async function provider(filters) {
  for (const f of filters || []) {
    const h = hosts.find((x) => x.vendorId === f.vendorId && (f.productId == null || x.productId === f.productId) && (f.usagePage == null || x.spec.usagePage === f.usagePage)
      && (f.iface == null || x.spec.iface == null || Number(x.spec.iface) === Number(f.iface)));
    if (h && (await h.tryOpen())) return h;
  }
  return null;
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
