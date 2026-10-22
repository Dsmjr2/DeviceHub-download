// Glorious Model O / D mice, READ ONLY (22 Oct 2026), written only from docs/brands/glorious.md ("gl §n" below), which
// cites libratbag (driver-sinowealth.c, glorious-model-o.device, glorious-model-d.device), OpenRGB
// (SinowealthControllerDetect.cpp, SinowealthController.cpp, SinowealthGMOWController.cpp), the Linux kernel
// (hid-ids.h) and korkje/mxw (battery.rs, firmware.rs, devices.rs). Simulated in tests/sim-glorious.mjs; never run on a
// real mouse.
//
// WHY READ ONLY, AND WHY SO STRICT: these mice use Sinowealth (258A) and other chip vendors' ids. The same vendor id,
// and sometimes the same product id, belong to other brands' devices with other protocols; OpenRGB turned its
// Sinowealth keyboard detection off because writes "ended up in bricking" Redragon keyboards (gl §1). So:
//  - only the exact product ids below are opened;
//  - the FIRST and only request before a check is the firmware read; anything else waits until the firmware matches:
//    wired, the exact firmware string libratbag lists for that id (V103, V102); wireless, the documented reply shape
//    (the request echoed at [6], a status A0 / A1 / A4 at [1], four version bytes). No firmware strings are documented
//    for the wireless mice, so their check is the shape only (said in docs/handoff/more-drivers.md);
//  - there are NO writes at all: no setting, and write() always refuses. DPI, polling, lift-off, debounce, sleep and
//    lights are listed as gaps (gl §3 marks their bytes partly unconfirmed; the wired write rewrites the whole block).
//
// HID LAYER (docs/handoff/hid-core.md): feature reports only, opened with no access (featureOnly), so this driver
// physically cannot send an output report. Wired: usage page FF00 (OpenRGB), any usage; report 05 (6 bytes) for
// commands, report 04 (520-byte buffer) for the config block. Wireless: interface 2 (mxw), usage page FFFF (OpenRGB),
// 65-byte feature reports on report id 00 (featureLen 64 data bytes, also a match). UNCONFIRMED until a mouse is
// measured: the wired collection's usage, whether report 04's 520 bytes include the report id (519 data bytes asked).
import { getDevice } from '../../public/devices/hid.js';

// ---- gl §1 Mice: the exact ids, nothing else ----
export const MODELS = {
  '0036': { name: 'Model O / O- (wired)', family: 'wired', firmware: 'V103' },   // Linux hid-ids.h; lrb glorious-model-o.device [.../V103]
  '0033': { name: 'Model D / D- (wired)', family: 'wired', firmware: 'V102' },   // Linux hid-ids.h; lrb glorious-model-d.device [.../V102]
  '2011': { name: 'Model O Wireless', family: 'wireless', link: 'cable' },       // ORGB; mxw devices.rs
  '2022': { name: 'Model O Wireless', family: 'wireless', link: 'dongle' },
  '2013': { name: 'Model O- Wireless', family: 'wireless', link: 'cable' },      // mxw devices.rs
  '2024': { name: 'Model O- Wireless', family: 'wireless', link: 'dongle' },
  '2012': { name: 'Model D Wireless', family: 'wireless', link: 'cable' },       // ORGB; mxw devices.rs
  '2023': { name: 'Model D Wireless', family: 'wireless', link: 'dongle' },
  '2014': { name: 'Model D- Wireless', family: 'wireless', link: 'cable' },      // mxw devices.rs
  '2025': { name: 'Model D- Wireless', family: 'wireless', link: 'dongle' },
};
export const PIDS = ['0036', '0033', '2011', '2022', '2013', '2024', '2012', '2023', '2014', '2025'];

// ---- the only requests this driver can make (frozen); every byte with its source ----
// Wired (gl §2 "Sinowealth wired config protocol"): report 05 = CMD, 6 bytes (report id + command + 4)
//   firmware: set feature 05 01 ..., then get feature 05 (lrb, ORGB); the 4 firmware bytes follow the command byte
//   config:   set feature 05 11 00 00 00 00, then get feature 04, 520 bytes (lrb, ORGB GetProfile)
// Wireless (gl §2 "Sinowealth wireless protocol", mxw): 65-byte feature report 00; the sheet's [n] counts the report
// id as [0], so data byte n-1 here
//   firmware: [3]=02 (cable only) [4]=03 [6]=81 (mxw firmware.rs, ORGB GMOW)
//   battery:  [3]=02 [4]=02 [6]=83 (mxw battery.rs)
const W = (set) => { const d = new Array(64).fill(0); for (const [i, v] of set) d[i - 1] = v; return Object.freeze(d); };
export const REQUESTS = Object.freeze({
  wiredFirmware: Object.freeze({ reportId: 0x05, data: Object.freeze([0x01, 0x00, 0x00, 0x00, 0x00]), replyId: 0x05, replyLen: 5 }),
  wiredConfig: Object.freeze({ reportId: 0x05, data: Object.freeze([0x11, 0x00, 0x00, 0x00, 0x00]), replyId: 0x04, replyLen: 519 }),
  firmwareCable: Object.freeze({ reportId: 0x00, data: W([[3, 0x02], [4, 0x03], [6, 0x81]]), replyId: 0x00, replyLen: 64 }),
  firmwareDongle: Object.freeze({ reportId: 0x00, data: W([[4, 0x03], [6, 0x81]]), replyId: 0x00, replyLen: 64 }),
  battery: Object.freeze({ reportId: 0x00, data: W([[3, 0x02], [4, 0x02], [6, 0x83]]), replyId: 0x00, replyLen: 64 }),
});
// gl §2 command table and §4 'Never': 75 on report 05 puts the mouse into DFU. Checked again before every send.
const DFU = { reportId: 0x05, first: 0x75 };
export const WAIT_MS = 50;   // gl §2: mxw "wait 50 ms" between set and get; ORGB waits 50 ms after a set
// gl §2 wireless battery reply: [1] status A1 ok, A4 asleep, A0 waking; [6] must echo 83; [8] percent (0 shown as 1)
export const STATUS = { 0xa1: 'ok', 0xa4: 'asleep', 0xa0: 'waking' };
// gl §2 config block: [9] sensor type
export const SENSORS = { 0x06: 'PMW3360', 0x08: 'PMW3212', 0x0e: 'PMW3327', 0x0f: 'PMW3389' };
// gl §3 polling, wired: block [10] low nibble 1 = 125, 2 = 250, 3 = 500, 4 = 1000 Hz (nibble order "confirm on device")
export const POLL = { 1: 125, 2: 250, 3: 500, 4: 1000 };
// gl §4 'Never': running beside Glorious Core (likely holds the device). Process names unconfirmed.
export const VENDOR_APPS = [/^glorious/i];
const APP_CHECK_MS = 15000;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, '0');
const hexs = (u8) => Array.from(u8, hex2).join(' ');

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}

class Refused extends Error { constructor(m) { super(m); this.refused = true; } }

export function createGlorious({ open = defaultOpen, vendorApp = defaultVendorApp, sleep = sleepReal, now = () => Date.now() } = {}) {
  const wired = { page: 'FF00', usage: '*', featureOnly: true };
  const wireless = { iface: 2, page: 'FFFF', usage: '*', featureOnly: true, featureLen: 64, len: 64 };
  return {
    id: 'glorious-mouse',
    title: 'Glorious mouse',
    kind: 'Mouse',
    vendor: 'Glorious',
    hid: { vid: '258A', pid: '0036', pids: PIDS, page: 'FF00', usage: '*', featureOnly: true, len: 64, reportId: 0,
      byPid: Object.fromEntries(PIDS.map((p) => [p, MODELS[p].family === 'wired' ? wired : wireless])) },
    settings: [],
    unsupported: ['every setting: DPI, polling rate, lift-off, debounce, sleep, lights (read only: a wrong write has bricked other brands\' mice on these chip ids)',
      'firmware updates and DFU (never)', 'buttons and macros', 'Model O 2 / D 2 / I 2, Model I, Model O Eternal, Series One Pro (other ids or no open protocol)'],
    dev: null, pid: null, model: null, checked: null, why: null, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid, MODELS[pid]);
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], checked: null, why: null, raw: {}, app: null, appAt: 0 }); return true; }
      }
      return false;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw new Refused(`${this.app} is running: close it first (it talks to the mouse on the same reports)`);
    },

    // one request from REQUESTS: set feature, wait, get feature. Nothing else can leave this driver.
    request(name) {
      const run = async () => {
        const r = REQUESTS[name];
        if (!r) throw new Refused(`${name} is not a request this driver may make`);
        if (r.reportId === DFU.reportId && r.data[0] === DFU.first) throw new Refused('never: 75 on report 05 is DFU');
        if (!this.dev) throw Object.assign(new Error('no Glorious mouse is open'), { gone: true });
        await this.dev.sendFeatureReport(r.reportId, Uint8Array.from(r.data));
        await sleep(WAIT_MS);
        const dv = await this.dev.receiveFeatureReport(r.replyId, r.replyLen);
        const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this.raw[name] = hexs(u8.slice(0, 64));
        return u8;
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    // the gate: the firmware read, and nothing else until it matches (gl §1 notes, §4 'Never')
    async check() {
      if (this.checked) return this.checked;
      if (this.why) throw new Refused(this.why);
      await this.appCheck();
      const m = this.model;
      if (m.family === 'wired') {
        const r = await this.request('wiredFirmware');   // WebHID shape: [05] [01] [4 firmware bytes]
        const fw = String.fromCharCode(...r.slice(2, 6)).replace(/\0+$/, '');
        if (r[0] !== 0x05 || r[1] !== 0x01 || fw !== m.firmware) {
          this.why = `firmware "${fw}" is not ${m.firmware}, the one libratbag lists for 258A:${this.pid}: this may be another brand's device on the same chip id, so nothing more is sent to it`;
          throw new Refused(this.why);
        }
        this.checked = { firmware: fw };
      } else {
        const r = await this.request(m.link === 'cable' ? 'firmwareCable' : 'firmwareDongle');   // no report id: [n] = r[n - 1]
        const v = Array.from(r.slice(6, 10));
        const shape = r[5] === 0x81 && Object.hasOwn(STATUS, r[0]) && v.some((x) => x !== 0) && !v.every((x) => x === 0xff);
        if (!shape) {
          this.why = `258A:${this.pid} did not answer the firmware read the way mxw documents (echo ${hex2(r[5])}, status ${hex2(r[0])}): this may be another brand's device on the same chip id, so nothing more is sent to it`;
          throw new Refused(this.why);
        }
        this.checked = { firmware: v.join('.') };   // gl §2: [7]-[10], dotted decimal
      }
      return this.checked;
    },

    async info() {
      const c = await this.check();
      const out = { Model: `Glorious ${this.model.name}`, 'Product id': `258A:${this.pid}`, Connection: this.model.family === 'wired' ? 'cable' : this.model.link === 'cable' ? 'cable' : 'wireless (dongle)',
        Firmware: c.firmware, 'Changing settings': 'Glorious Core (DeviceHub only reads this mouse)' };
      if (this.model.family === 'wired') {
        const b = await this.request('wiredConfig');   // WebHID shape: [04] then the block; gl §2 offsets count the report id as 0
        if (b[0] === 0x04) {
          out.Sensor = SENSORS[b[9]] || `unknown (code ${hex2(b[9])})`;
          const hz = POLL[b[10] & 0x0f];
          out['Polling rate'] = hz ? `${hz} Hz (if the low nibble is the rate: unconfirmed)` : `code ${hex2(b[10])} (not decoded)`;
          if (b.length > 0x2c && b.slice(0x2c).every((x) => x === 0)) out.Note = 'the settings block read back empty from 0x2C on (OpenRGB: read too soon after a write)';
        }
      }
      return out;
    },
    async read() { await this.check(); return {}; },
    async write(key) { throw new Refused(`${key}: this Glorious driver never writes (a wrong write has bricked other brands' devices on these chip ids)`); },

    // wireless only: gl §2 battery, [8] percent (0 shown as 1), [1] status; charging is not documented
    async battery() {
      if (this.model?.family !== 'wireless') return null;
      await this.check();
      const r = await this.request('battery');
      if (r[5] !== 0x83) throw new Error('the battery reply did not echo 83');
      if (r[0] === 0xa4 || r[0] === 0xa0) throw Object.assign(new Error(`the mouse is ${STATUS[r[0]]}: move it and try again`), { asleep: true });
      if (r[0] !== 0xa1) throw new Error(`battery status ${hex2(r[0])} is not one mxw documents`);
      return { percent: Math.min(100, Math.max(1, r[7])), charging: false };
    },
    async rawBackup() { await this.info(); return { pid: this.pid, model: this.model.name, replies: { ...this.raw } }; },
  };
}

async function defaultOpen(pid, model) {
  const f = model.family === 'wired' ? { usagePage: 0xff00 } : { usagePage: 0xffff, iface: 2 };
  return getDevice([{ vendorId: 0x258a, productId: parseInt(pid, 16), ...f }], { prompt: false });
}

export default createGlorious();
