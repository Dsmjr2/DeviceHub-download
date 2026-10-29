// Lenovo Legion Gen 10 keyboard lights (29 Oct 2026; Dsmjr2/DeviceHub-support#24: a friend's Legion has its light
// controller at 048D:C197 and DeviceHub had no driver for it). UNTESTED: written from two open sources, never run on a
// real laptop by DeviceHub:
//  - Lenovo Legion Toolkit (BartoszCichecki/LenovoLegionToolkit, LenovoLegionToolkit.Lib/Native.cs LENOVO_SPECTRUM_*
//    and Controllers/SpectrumKeyboardBacklightController.cs): the "Spectrum" protocol of the ITE 8258 controller, for the
//    older Legions (048D:C9xx);
//  - legion-spectrum-control (LisaDaVinchie, MIT): the same protocol on the Gen 10 controller 048D:C197, tested there on
//    a Legion Pro 7 16IAX10H.
//
// THE PROTOCOL (LLT Native.cs): one 960-byte HID feature report, report id 07, found by that length (LLT FindHidDevice:
// FeatureReportByteLength 0x3C0), whatever its usage page. A request is set feature [07, op, C0, 03, value?] (LLT
// LENOVO_SPECTRUM_HEADER: Head 7, Type, Size 0xC0, Tail 3), and its answer is get feature 07: [07, op, length, ?, value].
//
// WHY SO STRICT: 048D is ITE's vendor id, and ITE makes the light chips of many brands' laptops with other protocols.
//  - only 048D:C197 is opened;
//  - the FIRST request is LLT's compatibility check (D1, answer byte 4 = 0: LLT GET_COMPATIBILITY_RESPONSE IsCompatible);
//    nothing else is sent until it passes, and nothing more ever after it fails;
//  - every request is one of OPS below; an answer that does not echo its command is refused, and nothing is written;
//  - never sent: C9 (ProfileDefault: puts a profile back to Lenovo's default, losing the person's effects), CB (effect
//    change), D0 / A1 (Aurora: per-key colors streamed), C4 / C5 (key map pages). Only brightness, the lid logo and the
//    profile, each read back after it is written (LLT: 0-9, on/off, profiles 1-6; LLT waits 100 ms after a profile change);
//  - Lenovo Vantage or Legion Zone open: nothing is written (LLT ThrowIfVantageEnabled: they drive the same controller).
// The library marks it untested: installed only on a click, and each setting stays read-only until it passes the
// self-check (its own value written back once and read the same) after Turn on settings.
import { getDevice } from '../../public/devices/hid.js';

export const VID = '048D';
export const PIDS = ['C197'];
export const REPORT_ID = 0x07;
export const FEATURE_LEN = 959;   // data bytes after the report id (LLT: 960-byte structs, the first byte the report id)
// the only commands this driver can send (LLT LENOVO_SPECTRUM_OPERATION_TYPE), frozen
export const OPS = Object.freeze({
  compatibility: 0xd1,
  getBrightness: 0xcd, setBrightness: 0xce,
  getLogo: 0xa5, setLogo: 0xa6,
  getProfile: 0xca, setProfile: 0xc8,
});
const SENDABLE = new Set(Object.values(OPS));
export const NEVER = Object.freeze({ 0xc9: 'ProfileDefault (resets a profile to Lenovo\'s default)', 0xcb: 'an effect change', 0xd0: 'Aurora start / stop', 0xa1: 'Aurora per-key colors', 0xc4: 'the key count', 0xc5: 'the key pages' });
export const VENDOR_APPS = [/^lenovovantage/i, /^lenovo\.modern\.imcontroller/i, /^legionzone/i, /^lenovo legion zone/i];
const WAIT_MS = 50, PROFILE_WAIT_MS = 100, APP_CHECK_MS = 15000;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => (b & 0xff).toString(16).padStart(2, '0');

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}

class Refused extends Error { constructor(m) { super(m); this.refused = true; } }

export function createLegion({ open = defaultOpen, vendorApp = defaultVendorApp, sleep = sleepReal, now = () => Date.now() } = {}) {
  return {
    id: 'lenovo-legion-spectrum',
    title: 'Legion keyboard lights',
    kind: 'Keyboard',
    vendor: 'Lenovo',
    hid: { vid: VID, pid: PIDS[0], pids: PIDS, page: '*', usage: '*', featureOnly: true, featureLen: FEATURE_LEN, len: FEATURE_LEN, reportId: REPORT_ID, replyMs: 900 },
    settings: [
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 9, unit: '', hint: 'The keyboard lights, 0 (off) to 9 (LLT: 0-9).' },
      { key: 'logo', label: 'Lid logo light', type: 'toggle', hint: 'The Legion logo on the lid.' },
      { key: 'profile', label: 'Lighting profile', type: 'choice', options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `Profile ${n}` })), hint: 'The six profiles Fn + Space cycles through; their effects are set in Lenovo Vantage or Legion Zone.' },
    ],
    unsupported: ['effects, colors and per-key lighting (Lenovo Vantage or Legion Zone)', 'putting a profile back to its default (never)'],
    dev: null, pid: null, checked: null, why: null, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid);
        if (dev) { Object.assign(this, { dev, pid, checked: null, why: null, raw: {}, app: null, appAt: 0 }); return true; }
      }
      return false;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Refused(`${this.app} is running: it drives the same lights, so close it first`), { waiting: true });
    },

    // one request: set feature [op, C0, 03, value?], wait, get feature 07; the answer must echo op. Nothing else leaves.
    request(op, value) {
      const run = async () => {
        if (NEVER[op]) throw new Refused(`never: ${hex2(op)} is ${NEVER[op]}`);
        if (!SENDABLE.has(op)) throw new Refused(`${hex2(op)} is not a request this driver may make`);
        if (!this.dev) throw Object.assign(new Error('the Legion light controller is not open'), { gone: true });
        if (op !== OPS.compatibility && !this.checked) throw new Refused('the compatibility check has not passed');
        const data = [op, 0xc0, 0x03];
        if (value !== undefined) data.push(value & 0xff);
        await this.dev.sendFeatureReport(REPORT_ID, Uint8Array.from(data));
        await sleep(op === OPS.setProfile ? PROFILE_WAIT_MS : WAIT_MS);
        const dv = await this.dev.receiveFeatureReport(REPORT_ID, 8);
        const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this.raw[hex2(op)] = Array.from(u8, hex2).join(' ');
        return u8;
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },
    // a read: the answer's value byte (LLT *_RESPONSE: ReportId, Type, Length, Unknown1, value), checked to echo op
    async get(op) {
      const r = await this.request(op);
      if (r[0] !== REPORT_ID || r[1] !== op) throw new Error(`the answer to ${hex2(op)} did not echo it (${hex2(r[0])} ${hex2(r[1])})`);
      return r[4];
    },

    // the gate: LLT's compatibility check, before anything else
    async check() {
      if (this.checked) return this.checked;
      if (this.why) throw new Refused(this.why);
      const r = await this.request(OPS.compatibility);
      if (r[0] !== REPORT_ID || r[1] !== OPS.compatibility || r[4] !== 0) {
        this.why = `048D:${this.pid} did not answer Lenovo's compatibility check (${Array.from(r.slice(0, 5), hex2).join(' ')}): it may be another light controller on ITE's chip id, so nothing more is sent to it`;
        throw new Refused(this.why);
      }
      this.checked = { at: now() };
      return this.checked;
    },

    async info() {
      await this.check();
      return { Model: 'Lenovo Legion (Gen 10) keyboard lights', 'Product id': `048D:${this.pid}`, Controller: 'ITE 8258 (Spectrum)',
        'Effects and colors': 'Lenovo Vantage or Legion Zone' };
    },

    async read() {
      await this.check();
      const out = {};
      const b = await this.get(OPS.getBrightness);
      if (b <= 9) out.brightness = b;
      const l = await this.get(OPS.getLogo);
      if (l === 0 || l === 1) out.logo = l === 1;
      const p = await this.get(OPS.getProfile);
      if (p >= 1 && p <= 6) out.profile = p;
      return out;
    },

    async write(key, value) {
      await this.check();
      await this.appCheck();
      if (key === 'brightness') {
        if (!Number.isInteger(value) || value < 0 || value > 9) throw new Refused('brightness is 0 to 9');
        await this.request(OPS.setBrightness, value);
        const back = await this.get(OPS.getBrightness);
        if (back !== value) throw new Error(`brightness read back ${back}, not ${value}`);
        return back;
      }
      if (key === 'logo') {
        if (typeof value !== 'boolean') throw new Refused('the logo light is on or off');
        await this.request(OPS.setLogo, value ? 1 : 0);
        const back = await this.get(OPS.getLogo);
        if (back !== (value ? 1 : 0)) throw new Error(`the logo light read back ${back}, not ${value ? 1 : 0}`);
        return back === 1;
      }
      if (key === 'profile') {
        if (!Number.isInteger(value) || value < 1 || value > 6) throw new Refused('profiles are 1 to 6');
        await this.request(OPS.setProfile, value);
        const back = await this.get(OPS.getProfile);
        if (back !== value) throw new Error(`the profile read back ${back}, not ${value}`);
        return back;
      }
      throw new Refused(`${key} is not a setting of this driver`);
    },

    async rawBackup() { await this.read(); return { pid: this.pid, replies: { ...this.raw } }; },
  };
}

async function defaultOpen(pid) {
  return getDevice([{ vendorId: 0x048d, productId: parseInt(pid, 16) }], { prompt: false });
}

export default createLegion();
