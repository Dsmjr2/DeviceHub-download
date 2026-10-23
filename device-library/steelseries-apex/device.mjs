// SteelSeries Apex keyboards (USB vendor 0x1038), written 22 Oct 2026. Status "untested": nothing here has run on a
// real keyboard; tests/sim-steelseries-apex.mjs drives simulated ones only. No code was copied; every byte is cited to:
//   OpenRGB = gitlab.com/CalcProgrammer1/OpenRGB @ bbc77470a7cba56af60989e54ba910d5ac66a3ac, Controllers/SteelSeriesController/
//     SteelSeriesApexBaseController.h (packet ids, APEX_BRIGHTNESS_MIN 0 / MAX 10, 64-byte packets) and .cpp (GetVersion),
//     SteelSeriesApexController/SteelSeriesApexController.cpp (ReadBrightness, SetBrightness, protocol_map),
//     SteelSeriesApex8ZoneController/SteelSeriesApex8ZoneController.cpp + .h (GetBrightness, SetBrightness, 0x10 max),
//     SteelSeriesDevices.h (product ids), SteelSeriesControllerDetect.cpp (interfaces, which controller per id)
//   sheet = docs/brands/steelseries.md (sections 1-4), which cites the same files.
//
// The one setting: illumination brightness, the setting the keyboard's own brightness keys step through. OpenRGB
// offers it "only when the keyboard answers the read back request": read = output report 00 A3, reply A3 00 <0-10>
// (an unsupported request answers 0xFF in the status byte); write = output report 00 23 <0-10>. The Apex 3 TKL (8-zone
// controller): read 00 A3, reply A3 <0-16>; write 00 23 <0-16>. Read only: the firmware version (00 90, reply text).
// Every write is sent, even with the value it already has, then read back; a different read-back writes the value read
// before back once and fails.
//
// Not done, on purpose (write-only in OpenRGB, so DeviceHub cannot read them back): per-key colour and direct mode
// (feature 3A / 40 / 61), back-to-onboard (3B / 41), the Gen 3 init (4B), profile select (feature 89), the Apex 3's
// T-zone brightness (0A 00 <b>) and zone colours, the Apex M750 and the old Apex / 350 lights. Not read: the Gen 1
// serial number (FF: personal) and the Gen 3 region byte (F5). OmniPoint actuation: no open source has it (sheet s6).
// Never: firmware update (no source documents it; sheet s4 "Send only the ids listed here"). Nothing outside CMD
// can be built by this file.
//
// HID LAYER (docs/handoff/hid-core.md): one channel per product id (hid.pids / hid.byPid). OpenRGB opens the wired
// boards on USB interface 1 (no usage page given) and the 2023 / Gen 3 wireless ids on interface 3, usage page FFC0,
// usage 1 (REGISTER_HID_DETECTOR_I / _IPU). Report id 0, 64 data bytes out (STEELSERIES_PACKET_OUT_SIZE 65 with the id),
// replies read as input reports (hid_read_timeout, STEELSERIES_PACKET_IN_SIZE 64).
// UNCONFIRMED (check with helpers/hid-caps.ps1 -Vid 1038 and one read before any write):
//  - the wired boards' collection on interface 1: chosen by its 64-byte output report (page and usage left open);
//  - Gen 3 keyboards: OpenRGB asks the brightness only after its init packet (feature 4B), which DeviceHub does not
//    send (it switches the lighting mode); a Gen 3 board that does not answer without it simply offers no setting;
//  - Gen 1 firmware: OpenRGB drops the first byte only when it is 0x90; DeviceHub's helper matches a reply by its first
//    byte, so a Gen 1 reply that does not start with 0x90 shows as "no reply".
//
// Added 23 Oct 2026 (OpenRGB @ 817834c, the same files): the Apex 3 (161A), named only. SteelSeriesDevices.h
// STEELSERIES_APEX_3_PID 0x161A; SteelSeriesControllerDetect.cpp REGISTER_HID_DETECTOR_I "SteelSeries Apex 3",
// interface 3 (no usage page), DetectSteelSeriesApex3Full -> SteelSeriesApexTZoneController, which only writes
// (SetColor 00 0A 00 <b> / 00 0B [RGB] x 10, Save 00 06 00 08 / 00 09: 33-byte packets) and reads nothing from the
// keyboard. So type 'tzone' sends nothing at all: not even the A3 brightness read, which the T-zone controller lacks.
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x1038;
// the only requests this file sends (SteelSeriesApexBaseController.h)
export const CMD = {
  getBrightness: 0xa3,   // APEX_PACKET_ID_GET_BRIGHTNESS "Brightness read back"
  setBrightness: 0x23,   // APEX_PACKET_ID_SET_BRIGHTNESS "Illumination brightness"
  firmware: 0x90,        // APEX_PACKET_ID_FIRMWARE "Firmware version"
};
export const LEN = 64;   // STEELSERIES_PACKET_IN_SIZE; out = 64 + the report id

// type 'apex': SteelSeriesApexController (status byte 00 at 1, value at 2, 0-10, firmware read).
// type '8zone': SteelSeriesApex8ZoneController (value at 1, 0-0x10, no firmware read: GetVersion is "Unsupported protocol").
// type 'tzone': SteelSeriesApexTZoneController (the Apex 3): no read at all, so the keyboard is named and nothing is sent.
const WIRED = { iface: 1, page: '*', usage: '*', outputLen: LEN };
const WIRELESS = { iface: 3, page: 'FFC0', usage: '0001' };
const k = (name, type, chan) => ({ name, type, chan });
export const MODELS = {
  '1610': k('Apex Pro', 'apex', WIRED),
  '1614': k('Apex Pro TKL', 'apex', WIRED),
  '1628': k('Apex Pro TKL (2023)', 'apex', WIRED),
  '1630': k('Apex Pro TKL Wireless (2023)', 'apex', WIRELESS),
  '1632': k('Apex Pro TKL Wireless (2023)', 'apex', WIRELESS),
  '1642': k('Apex Pro TKL Gen 3', 'apex', WIRED),
  '1644': k('Apex Pro TKL Gen 3 Wireless', 'apex', WIRELESS),
  '1646': k('Apex Pro TKL Gen 3 Wireless', 'apex', WIRELESS),
  '1640': k('Apex Pro Gen 3', 'apex', WIRED),
  '1612': k('Apex 7', 'apex', WIRED),
  '1618': k('Apex 7 TKL', 'apex', WIRED),
  '161C': k('Apex 5', 'apex', WIRED),
  '1634': k('Apex 9 TKL', 'apex', WIRED),
  '1620': k('Apex 9 Mini', 'apex', WIRED),
  '1622': k('Apex 3 TKL', '8zone', { iface: 1, page: 'FFC0', usage: '0001' }),   // REGISTER_HID_DETECTOR_IPU 1, 0xFFC0, 1
  '161A': k('Apex 3', 'tzone', { iface: 3, page: '*', usage: '*' }),               // REGISTER_HID_DETECTOR_I 3 (no page)
};
export const PIDS = Object.keys(MODELS);
export const RANGE = { apex: { min: 0, max: 10 }, '8zone': { min: 0, max: 0x10 } };   // APEX_BRIGHTNESS_MAX; STEELSERIES_8Z_BRIGHTNESS_MAX

// Documented writes with no documented read: never sent, listed so the page and the handoff can name them
export const WRITE_ONLY = [
  { what: 'per-key colours / direct mode', bytes: 'feature 00 3A / 40 / 61 <n> [key R G B]', cite: 'SteelSeriesApexController.cpp SetLEDsDirect' },
  { what: 'back to onboard lighting', bytes: '00 3B / 00 41', cite: 'SteelSeriesApexController.cpp SendDeinitialization' },
  { what: 'profile select', bytes: 'feature 00 89 <profile>', cite: 'SteelSeriesApexController.cpp SelectProfile' },
  { what: 'Apex 3 brightness and zone colours', bytes: '00 0A 00 <b>; 00 0B ...', cite: 'SteelSeriesApexTZoneController.cpp' },
  { what: 'Apex 3 TKL zone colours', bytes: '00 <21 + mode> FF [R G B] x 8', cite: 'SteelSeriesApex8ZoneController.cpp' },
];

// SteelSeries' own apps (the same names as device-library/steelseries-mouse VENDOR_APPS)
export const VENDOR_APPS = /^SteelSeries(GG|GGClient|Engine|Engine3)?\.exe$/i;
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res, rej) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => (e ? rej(new Error(`tasklist failed: ${e.message}`)) : res(so))));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
  return null;
}
async function defaultOpen(pid, model) {
  const dev = await getDevice([{ vendorId: VID, productId: parseInt(pid, 16), iface: model.chan.iface }], { prompt: false });
  if (dev && dev.opened === false && typeof dev.open === 'function') await dev.open();
  return dev;
}
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const APP_CHECK_MS = 15000;
// SteelSeriesApexBaseController.cpp ExtractVersion: the text's first "major.minor.build"
export function firmwareText(r) {
  let bytes = Array.from(r).filter((b) => b !== 0);
  if (r[0] === CMD.firmware) bytes = bytes.slice(1);   // "Apex Pro Gen 2+ needs the first char dropped"
  const s = String.fromCharCode(...bytes);
  const a = s.indexOf('.'), b = a < 0 ? -1 : s.indexOf('.', a + 1);
  return b < 0 ? null : s.trim();
}

export function createApex({ open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now(), replyMs = 400 } = {}) {
  return {
    id: 'steelseries-apex',
    title: 'SteelSeries Apex keyboard',
    kind: 'Keyboard',
    vendor: 'SteelSeries',
    hid: { vid: '1038', pid: '1610', pids: PIDS, len: LEN, reportId: 0, replyMs, ...WIRED,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { outputLen: null, ...MODELS[p].chan, productName: `SteelSeries ${MODELS[p].name}` }])) },
    MODELS, WRITE_ONLY, VENDOR_APPS,
    unsupported: ['per-key colours and lighting effects (write-only)', 'profile select (write-only)', 'OmniPoint actuation (no open source documents it)',
      'the Apex 3 (T-zone): named only, no source reads anything from it', 'the Apex M750 and the old Apex / 350: no read-back', 'firmware updates (SteelSeries GG only)'],
    dev: null, pid: null, model: null, has: null, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    get settings() {
      if (!this.model || this.model.type === 'tzone' || (this.has && !this.has.brightness)) return [];
      const r = RANGE[this.model.type];
      return [{ key: 'brightness', label: 'Lighting brightness', type: 'slider', min: r.min, max: r.max, step: 1, unit: `/${r.max}`, live: true,
        hint: 'The same setting the keyboard\'s brightness keys step through' }];
    },

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        let dev = null;
        try { dev = await open(pid, MODELS[pid]); } catch { dev = null; }
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], has: null, raw: {}, app: null, appAt: 0 }); return true; }
      }
      return false;
    },
    need() { if (!this.dev) throw Object.assign(new Error('no SteelSeries Apex keyboard is connected'), { gone: true }); },

    // one request at a time: report id 0, the command, zero padding to 64; a reply is the first input report starting with
    // the command byte (expect = false: nothing to wait for, SetBrightness reads no reply)
    request(bytes, expect = true) {
      const run = () => new Promise((resolve, reject) => {
        const out = new Uint8Array(LEN); out.set(bytes);
        const key = hex(out.slice(0, 3));
        if (!expect) { this.raw[key] = 'sent'; this.dev.sendReport(0, out).then(() => resolve(null), reject); return; }
        let timer = null;
        const done = () => { clearTimeout(timer); this.dev.removeEventListener('inputreport', on); };
        const on = (e) => {
          const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
          if (r[0] !== out[0]) return;
          done(); this.raw[key] = hex(r.slice(0, 8)); resolve(Uint8Array.from(r));
        };
        timer = setTimeout(() => { done(); reject(new Error(`no reply to ${hex(out.slice(0, 2))}`)); }, replyMs + 600);
        this.dev.addEventListener('inputreport', on);
        this.dev.sendReport(0, out).catch((err) => { done(); reject(err); });
      });
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    // ReadBrightness: reply A3 00 <0-10>; "An unsupported request is answered with 0xFF in the status byte"; a value over
    // the maximum is refused. 8-zone GetBrightness: reply A3 <b>.
    async readBrightness() {
      const r = await this.request([CMD.getBrightness]);
      const max = RANGE[this.model.type].max;
      if (this.model.type === 'apex') {
        if (r[1] !== 0x00) throw Object.assign(new Error(`the keyboard answered status ${r[1].toString(16)} to the brightness read (unsupported)`), { unsupported: true });
        return r[2] <= max ? r[2] : null;
      }
      return r[1] <= max ? r[1] : null;
    },
    async ready() {
      if (this.has) return;
      this.need();
      if (this.model.type === 'tzone') { this.has = { brightness: false }; return; }   // no read exists: nothing is sent
      let ok = false;
      try { ok = (await this.readBrightness()) !== undefined; } catch (e) { if (e.gone) throw e; ok = false; }
      this.has = { brightness: ok };
    },

    async info() {
      this.need();
      await this.ready();
      const out = { Model: `SteelSeries ${this.model.name}`, 'Product id': `1038:${this.pid}`, Connection: this.model.chan === WIRELESS ? 'wireless (receiver)' : 'USB cable' };
      if (this.model.type === 'apex') {
        const r = await this.request([CMD.firmware]).catch(() => null);
        out.Firmware = (r && firmwareText(r)) || 'no reply';
      }
      if (this.model.type === 'tzone') {
        out.Lighting = 'SteelSeries GG only: no source reads the Apex 3\'s lighting back';
        out.Driver = 'untested library driver: names this keyboard only; nothing is sent';
        return out;
      }
      out.Brightness = this.has.brightness ? 'read back, can be changed' : 'not answered by this keyboard, so not offered';
      out.Driver = 'untested library driver: brightness only, after DeviceHub\'s own check';
      return out;
    },

    async read() {
      this.need();
      await this.ready();
      return this.has.brightness ? { brightness: await this.readBrightness() } : {};
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) {
        try { this.app = await vendorApp(); } catch (e) { this.appAt = 0; throw Object.assign(new Error(`could not check whether SteelSeries GG is open (${e.message}), so nothing was written`), { refused: true, waiting: true }); }
        this.appAt = now();
      }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (two programs writing the keyboard fight)`), { refused: true, waiting: true });
    },
    async vendorApp() { return vendorApp(); },

    async write(key, value) {
      this.need();
      await this.ready();
      const s = this.settings.find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting of the ${this.model.name} (only a brightness it reads back can be changed)`);
      if (!(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`${s.label} must be a whole number ${s.min}-${s.max}`);
      await this.appCheck();
      const before = await this.readBrightness();
      if (before == null) throw new Error('the brightness read back outside its range, so nothing was written');
      await this.request([CMD.setBrightness, value], false);   // SetBrightness: 00 23 <b>, always sent
      const back = await this.readBrightness();
      if (back !== value) {
        await this.request([CMD.setBrightness, before], false);   // the value read before, once
        throw new Error(`brightness: wrote ${value}, read back ${back}; ${before} was written back`);
      }
      return back;
    },

    async rawBackup() { const values = await this.read(); return { pid: this.pid, model: this.model.name, values, replies: { ...this.raw } }; },
  };
}

export default createApex();
