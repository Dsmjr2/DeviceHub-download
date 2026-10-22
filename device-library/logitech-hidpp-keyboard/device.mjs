// Logitech G keyboards over HID++ 2.0 (22 Oct 2026): on their own cable or a Lightspeed receiver (G915 / G915 TKL /
// G815 / G515 TKL / G512 / G213 / PRO). Written only from open-source code, cited beside every command:
//   Solaar    = github.com/pwr-Solaar/Solaar @ e7304c4c451cc9bb4f206a914844525e67856a28, lib/logitech_receiver/
//               (hidpp20_constants.py feature ids; settings_templates.py ReportRate, ExtendedReportRate, OnboardProfiles,
//               DisableKeyboardKeys, FnSwap / NewFnSwap, BrightnessControl; settings.py FeatureRW defaults;
//               settings_validator.py value layouts; special_keys.py DISABLE; descriptors.py / base_usb.py ids)
//   libratbag = github.com/libratbag/libratbag @ 8235b5bb6032dea15901ab58a8218956f4494d08, src/hidpp20.h
//               struct hidpp20_onboard_profiles_info (profile_count is byte 3)
//   sheet     = docs/brands/logitech.md (sections 1-4), which cites the same projects
// The HID++ core (framing, feature lookup, reply matching, error codes) is the one in
// device-library/logitech-hidpp-mouse, copied so this folder works on its own once installed.
// Not run on a real keyboard: status "untested" in device.json; DeviceHub proves each write with its self-check first.
//
// Safety: every request goes through call(), which sends only the (feature, function) pairs in ALLOWED. DFU
// (0x00C0-0x00C3, 0x00D0, 0x010A), reset 0x1802, OOB state 0x1805, force pairing 0x1500, BLE pre-pairing 0x1816,
// Lightspeed pairing 0x0309 and onboard-profile MEMORY (0x8100 functions 0x50 / 0x60 / 0x70 / 0x80) are never sent.
// Onboard profiles are selected only, never edited. Every write is read back and refused while G HUB runs.
import { HidChannel, getDevice } from '../../public/devices/hid.js';

const VID = 0x046d;
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (b) => b.toString(16).padStart(2, '0');

// sheet section 1 "Keyboards" (OpenRGB LogitechControllerDetect.cpp, Solaar descriptors.py): wired product ids, and the
// receivers OpenRGB names G915 receivers (C541, C547) and the G915 TKL receiver (C545). Solaar descriptors.py lists the
// G213 / G512 / G815 / PRO on USB interface 1; base_usb.py puts Lightspeed receivers on interface 2.
// C547 (OpenRGB's second G915 receiver) is left out for now: tests/device-library.mjs uses 046d:c547 as its example of a
// receiver no library entry claims (docs/handoff/drivers-round3a.md, left for others).
export const RECEIVERS = { 0xc541: 'G915 receiver', 0xc545: 'G915 TKL receiver' };
export const WIRED = { 0xc33e: 'G915', 0xc343: 'G915 TKL', 0xc33f: 'G815', 0xc355: 'G515 LIGHTSPEED TKL', 0xc33c: 'G512', 0xc336: 'G213', 0xc339: 'PRO Gaming Keyboard' };
export const PIDS = [...Object.keys(RECEIVERS), ...Object.keys(WIRED)].map(Number);

// sheet section 2: long report 0x11, 19 bytes after the id; software id 0x0B (Solaar); 0xFF = wired, 1-6 = receiver slots
const REPORT_LONG = 0x11, LEN = 19, SW_ID = 0x0b, DEV_WIRED = 0xff, SLOTS = [1, 2, 3, 4, 5, 6];

// feature ids (Solaar hidpp20_constants.py SupportedFeature)
export const F = {
  ROOT: 0x0000, BATTERY_STATUS: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, ADJUSTABLE_DPI: 0x2201,
  FN_INVERSION: 0x40a0, NEW_FN_INVERSION: 0x40a2, DISABLE_KEYS: 0x4521, BRIGHTNESS: 0x8040, REPORT_RATE: 0x8060,
  EXT_REPORT_RATE: 0x8061, ONBOARD_PROFILES: 0x8100,
};
// the only (feature, function) pairs call() sends; function = byte 3's high nibble, written as fn << 4
export const ALLOWED = {
  [F.ROOT]: [0x00, 0x10],                 // getFeature, ping (sheet section 2 "Feature lookup")
  [F.BATTERY_STATUS]: [0x00],             // sheet section 3 "Battery (old)"
  [F.BATTERY_VOLTAGE]: [0x00],            // sheet section 3 "Battery voltage"
  [F.UNIFIED_BATTERY]: [0x00, 0x10],      // sheet section 3 "Battery (unified)": caps, status
  [F.FN_INVERSION]: [0x00, 0x10],         // Solaar FnSwap: FeatureRW defaults read 0x00 / write 0x10, BooleanValidator byte 0
  [F.NEW_FN_INVERSION]: [0x00, 0x10],     // Solaar NewFnSwap: the same
  [F.DISABLE_KEYS]: [0x00, 0x10, 0x20],   // Solaar DisableKeyboardKeys: caps 0x00, read 0x10, write 0x20
  [F.BRIGHTNESS]: [0x00, 0x10, 0x20, 0x30, 0x40], // Solaar BrightnessControl: info 0x00, read 0x10, write 0x20, on/off read 0x30 / write 0x40
  [F.REPORT_RATE]: [0x00, 0x10, 0x20],    // Solaar ReportRate: list 0x00, read 0x10, write 0x20
  [F.EXT_REPORT_RATE]: [0x10, 0x20, 0x30], // Solaar ExtendedReportRate: list 0x10, read 0x20, write 0x30
  // Solaar OnboardProfiles: mode read 0x20 / write 0x10, profile read 0x40 / select 0x30; info 0x00 (libratbag profile_count)
  [F.ONBOARD_PROFILES]: [0x00, 0x10, 0x20, 0x30, 0x40],
};
// 0x8100 memory functions rewrite flash (sheet section 4 "Risky writes"): refused even if added to ALLOWED by mistake
export const NEVER_FN = { [F.ONBOARD_PROFILES]: [0x50, 0x60, 0x70, 0x80] };
// sheet section 4 "Never touch" + Solaar hidpp20_constants.py BLE_PRO_PRE_PAIRING 0x1816, LIGHTSPEED_PAIRING 0x0309
export const NEVER = [0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00d0, 0x010a, 0x1802, 0x1805, 0x1500, 0x1816, 0x0309];

const ERRORS = { 1: 'unknown', 2: 'invalid argument', 3: 'out of range', 4: 'hardware error', 5: 'not allowed', 6: 'invalid feature index', 7: 'invalid function', 8: 'busy', 9: 'unsupported' };
export class HidppError extends Error {
  constructor(code, what) { super(`${what}: the keyboard refused it (HID++ error 0x${hex2(code)} ${ERRORS[code] || 'unknown code'})`); this.code = code; }
}
// a reply echoes device index, feature index and function+swid, or is <dev> FF <idx> <fn+swid> <code> (sheet section 2)
export const isReplyTo = (sent, r) => r[0] === sent[0] && ((r[1] === sent[1] && r[2] === sent[2]) || (r[1] === 0xff && r[2] === sent[1] && r[3] === sent[2]));

// Solaar ExtendedReportRate choices_universe: index 0 = 8 ms ... 6 = 125 us
export const EXT_RATES_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];
// Solaar special_keys.py DISABLE: the bits of 0x4521
export const DISABLE = [
  { bit: 0x10, key: 'lockWinKey', label: 'Windows key off', hint: 'Game mode\'s Windows-key lock: the key does nothing while on' },
  { bit: 0x01, key: 'lockCapsLock', label: 'Caps Lock key off' },
  { bit: 0x02, key: 'lockNumLock', label: 'Num Lock key off' },
  { bit: 0x04, key: 'lockScrollLock', label: 'Scroll Lock key off' },
  { bit: 0x08, key: 'lockInsert', label: 'Insert key off' },
];
// Solaar halving_marks(max, steps): max halved steps-1 times (rounded up), plus 0
export function halvingMarks(max, steps) {
  if (steps < 2 || max <= 0) return [];
  return [...new Set([0, ...Array.from({ length: steps - 1 }, (_, i) => Math.ceil(max / (1 << i)))])].sort((a, b) => a - b);
}
// G HUB (sheet section 5 "Windows note")
export const VENDOR_APPS = /^lghub(_agent|_system_tray|_updater)?\.exe$/i;
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
  return null;
}
async function defaultOpen(pid) {
  return getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }], { prompt: false });
}

export function createLogitechKeyboard({ open = defaultOpen, vendorApp = defaultVendorApp } = {}) {
  return {
    id: 'logitech-hidpp-keyboard',
    title: 'Logitech keyboard',
    kind: 'Keyboard',
    vendor: 'Logitech',
    // the long-report collection, usage page 0xFF00 usage 0x02 (sheet section 2, OpenRGB); raw replies (as the mouse)
    hid: { vid: '046D', pid: 'C33E', pids: PIDS.map(hex4), page: 'FF00', usage: '0002', len: LEN, reportId: REPORT_LONG, replyMs: 2000, reply: 'raw' },
    unsupported: ['editing onboard profiles (keys, macros, lights)', 'lighting colours and effects (no read-back)', 'G-key and M-key remaps', 'game mode beyond the key locks', 'firmware updates', 'pairing'],
    dev: null, chan: null, index: DEV_WIRED, features: {}, caps: {},

    get settings() {
      const c = this.caps, out = [];
      if (c.rate) out.push({ key: 'reportRate', label: 'Report rate', type: 'choice', options: [...c.rate.hz].sort((a, b) => a - b).map((hz) => ({ value: hz, label: `${hz} Hz` })), hint: 'Host mode only' });
      if (this.features[F.ONBOARD_PROFILES]) {
        out.push({ key: 'mode', label: 'Settings source', type: 'choice', hint: 'Host mode: the keyboard takes settings live and goes back to onboard on re-plug. Solaar notes host mode once upset a G915 TKL\'s function keys.',
          options: [{ value: 'onboard', label: 'Onboard (the profiles stored in the keyboard)' }, { value: 'host', label: 'Host (DeviceHub sets them live)' }] });
        if (c.profiles) out.push({ key: 'profile', label: 'Onboard profile', type: 'choice', hint: 'Picks one of the profiles stored in the keyboard; nothing in them is changed. Onboard mode only.',
          options: Array.from({ length: c.profiles }, (_, i) => ({ value: i + 1, label: `Profile ${i + 1}` })) });
      }
      for (const d of DISABLE) if (c.disableMask & d.bit) out.push({ key: d.key, label: d.label, type: 'toggle', ...(d.hint ? { hint: d.hint } : {}) });
      if (c.fnSwap) out.push({ key: 'fnSwap', label: 'F-keys do their special function', type: 'toggle', hint: 'On: F1-F12 do their media / special action and Fn gives the plain F-key' });
      const b = c.brightness;
      if (b?.marks) out.push({ key: 'brightness', label: 'Backlight brightness', type: 'choice', options: b.marks.map((m) => ({ value: m, label: m ? `${Math.round((m * 100) / b.max)}%` : 'off' })) });
      else if (b) out.push({ key: 'brightness', label: 'Backlight brightness', type: 'slider', min: b.onOff ? 0 : b.min, max: b.max, step: 1, live: true, hint: b.onOff ? '0 = backlight off' : undefined });
      return out;
    },

    async connect() {
      this.dev = null; this.chan = null; this.features = {}; this.caps = {};
      let dev = null;
      for (const pid of PIDS) { dev = await open(pid); if (dev) break; }
      if (!dev) return false;
      if (!dev.opened && dev.open) await dev.open();
      this.dev = dev;
      this.pid = typeof dev.pid === 'string' ? parseInt(dev.pid, 16) : dev.productId;
      this.receiver = !!RECEIVERS[this.pid];
      this.chan = new HidChannel(dev, { reportId: REPORT_LONG, length: LEN, match: isReplyTo });
      let ver = null;
      for (const idx of this.receiver ? SLOTS : [DEV_WIRED]) {    // sheet section 5 step 3: ping slots 1-6
        this.index = idx;
        try { ver = await this.ping(); break; } catch (e) { if (e instanceof HidppError) throw e; }
      }
      if (!ver) throw new Error(this.receiver ? 'no reply from a keyboard on the receiver (asleep, switched off or not paired)' : 'no reply from the keyboard');
      this.protocol = ver;
      for (const id of [F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.BATTERY_VOLTAGE, F.ADJUSTABLE_DPI, F.EXT_REPORT_RATE, F.REPORT_RATE, F.ONBOARD_PROFILES, F.DISABLE_KEYS, F.NEW_FN_INVERSION, F.FN_INVERSION, F.BRIGHTNESS]) {
        const f = await this.getFeature(id);
        if (f) this.features[id] = f;
      }
      // a mouse on the same receiver has the DPI feature; this driver leaves it to the mouse driver
      if (this.features[F.ADJUSTABLE_DPI]) throw new Error('this Logitech device has a DPI feature (0x2201): it is a mouse, not a keyboard this driver runs');
      await this.readCaps();
      return true;
    },

    async call(featureId, fn, params = [], { retry = true } = {}) {
      if (NEVER.includes(featureId) || (NEVER_FN[featureId] || []).includes(fn) || !(ALLOWED[featureId] || []).includes(fn)) throw new Error(`refused: feature 0x${hex4(featureId)} function 0x${hex2(fn)} is not one this driver sends`);
      const index = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
      if (!index && featureId !== F.ROOT) throw new Error(`the keyboard has no feature 0x${hex4(featureId)}`);
      const out = [this.index, index, (fn & 0xf0) | SW_ID, ...params];
      const what = `0x${hex4(featureId)} fn 0x${hex2(fn)}`;
      let r;
      try { r = await this.chan.request(out, { timeoutMs: 2600 }); }
      catch (e) { if (!retry || /refused/.test(e.message)) throw e; r = await this.chan.request(out, { timeoutMs: 2600 }); }
      if (r[1] === 0xff && r[2] === index && r[3] === out[2]) throw new HidppError(r[4], what);
      return r.slice(3, 19);
    },
    // ping: Root fn 0x10 [00 00 mark] -> major, minor, mark (sheet section 2)
    async ping() { const p = await this.call(F.ROOT, 0x10, [0, 0, 0x5a], { retry: false }); if (p[2] !== 0x5a) throw new Error('the ping came back without its mark'); return `${p[0]}.${p[1]}`; },
    // getFeature: Root fn 0x00 [id hi, lo] -> index (0 = absent), flags, version (sheet section 2)
    async getFeature(id) { if (NEVER.includes(id)) return null; const p = await this.call(F.ROOT, 0x00, [id >> 8, id & 0xff]); return p[0] ? { index: p[0], flags: p[1], version: p[2] } : null; },

    async readCaps() {
      const c = this.caps;
      const soft = (p) => p.catch((e) => { if (e instanceof HidppError) return null; throw e; });
      if (this.features[F.EXT_REPORT_RATE]) {
        // Solaar ExtendedReportRate.build: fn 0x10, bits 0-6 of the first 2 bytes (big-endian)
        const q = await this.call(F.EXT_REPORT_RATE, 0x10);
        c.rate = { ext: true, hz: EXT_RATES_HZ.filter((_, i) => ((q[0] << 8) | q[1]) & (1 << i)) };
      } else if (this.features[F.REPORT_RATE]) {
        // Solaar ReportRate.build: fn 0x00, byte 0, bit i = (i+1) ms
        const q = await this.call(F.REPORT_RATE, 0x00);
        const ms = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => q[0] & (1 << i)).map((i) => i + 1);
        c.rate = { ext: false, ms, hz: ms.map((m) => Math.round(1000 / m)) };
      }
      if (c.rate && !c.rate.hz.length) delete c.rate;
      if (this.features[F.ONBOARD_PROFILES]) {
        // libratbag struct hidpp20_onboard_profiles_info: byte 3 = profile_count
        const q = (await soft(this.call(F.ONBOARD_PROFILES, 0x00))) || [];
        if (q[3] >= 1 && q[3] <= 15) c.profiles = q[3];   // Solaar's choices go up to "Profile 15"
      }
      if (this.features[F.DISABLE_KEYS]) {
        // Solaar DisableKeyboardKeys.validator_class.build: fn 0x00 byte 0 = which keys can be disabled
        const q = await soft(this.call(F.DISABLE_KEYS, 0x00));
        c.disableMask = (q?.[0] || 0) & 0x1f;
      }
      if (this.features[F.NEW_FN_INVERSION]) c.fnSwap = F.NEW_FN_INVERSION;
      else if (this.features[F.FN_INVERSION]) c.fnSwap = F.FN_INVERSION;
      if (this.features[F.BRIGHTNESS]) {
        // Solaar BrightnessControl.validator_class.build: fn 0x00 -> b0-1 max, b2 low nibble = steps, b3 caps (0x04 = on/off),
        // b4-5 min; with 2+ steps the level snaps to halving_marks (BrightnessControl.write)
        const q = await soft(this.call(F.BRIGHTNESS, 0x00));
        if (q) {
          const max = (q[0] << 8) | q[1], steps = q[2] & 0x0f, onOff = !!(q[3] & 0x04), min = (q[4] << 8) | q[5];
          if (max > min || (onOff && max > 0)) {
            const marks = halvingMarks(max, steps).filter((m) => m === 0 ? onOff : m >= min);
            c.brightness = { max, min, steps, onOff, marks: marks.length >= 2 ? marks : null };
          }
        }
      }
      if (this.features[F.UNIFIED_BATTERY]) { const q = await this.call(F.UNIFIED_BATTERY, 0x00); c.batteryPercent = !!(q[1] & 0x02); }
    },

    async readRate() {
      if (!this.caps.rate) return undefined;
      if (this.caps.rate.ext) return EXT_RATES_HZ[(await this.call(F.EXT_REPORT_RATE, 0x20))[0]];   // Solaar ExtendedReportRate read 0x20, byte 0 = index
      const ms = (await this.call(F.REPORT_RATE, 0x10))[0];                                       // Solaar ReportRate read 0x10, byte 0 = ms
      return ms ? Math.round(1000 / ms) : undefined;
    },
    async readMode() {
      if (!this.features[F.ONBOARD_PROFILES]) return undefined;
      const p = await this.call(F.ONBOARD_PROFILES, 0x20);          // Solaar OnboardProfiles.rw_class.read: fn 0x20 byte 0, 0x01 = onboard
      return p[0] === 1 ? 'onboard' : p[0] === 2 ? 'host' : undefined;
    },
    // Solaar OnboardProfiles.rw_class.read: in onboard mode fn 0x40, the first 2 bytes = the profile's sector, big-endian;
    // choices_universe: 1-15 = "Profile n", 0x100 + n = "Read-Only Profile n" (a built-in profile: not offered here)
    async readProfileSector() { return this.caps.profiles ? (((p) => (p[0] << 8) | p[1])(await this.call(F.ONBOARD_PROFILES, 0x40))) : undefined; },
    async readProfile() {
      if (!this.caps.profiles || (await this.readMode()) !== 'onboard') return undefined;
      const s = await this.readProfileSector();
      return s >= 1 && s <= this.caps.profiles ? s : undefined;
    },
    async readDisabled() { return (await this.call(F.DISABLE_KEYS, 0x10))[0]; },   // Solaar DisableKeyboardKeys read 0x10, byte 0 = bits
    async readFnSwap() { return (await this.call(this.caps.fnSwap, 0x00))[0] === 1; },   // BooleanValidator: byte 0, 0x01 = on
    async readBrightness() {
      const b = this.caps.brightness;
      // Solaar BrightnessControl.rw_class.read: with on/off, fn 0x30 byte 0 bit 0 clear = off (0); then fn 0x10 2 bytes BE
      if (b.onOff && !((await this.call(F.BRIGHTNESS, 0x30))[0] & 0x01)) return 0;
      const p = await this.call(F.BRIGHTNESS, 0x10);
      return (p[0] << 8) | p[1];
    },

    async info() {
      const mode = await this.readMode().catch(() => undefined);
      const out = {
        Model: this.receiver ? `Logitech keyboard on ${RECEIVERS[this.pid]} ${hex4(this.pid)} (slot ${this.index})` : `Logitech ${WIRED[this.pid] || `keyboard ${hex4(this.pid)}`}`,
        Connection: this.receiver ? 'Lightspeed receiver' : 'USB cable',
        'HID++': this.protocol,
        Battery: this.features[F.UNIFIED_BATTERY] ? '0x1004 unified' : this.features[F.BATTERY_STATUS] ? '0x1000 status' : this.features[F.BATTERY_VOLTAGE] ? '0x1001 voltage' : 'none reported',
      };
      if (mode) out['Settings source'] = mode;
      if (this.caps.profiles) out['Onboard profiles'] = String(this.caps.profiles);
      if (this.caps.profiles && mode === 'onboard') { const s = await this.readProfileSector().catch(() => undefined); if (s > 0x100) out['Active profile'] = `built-in read-only profile ${s - 0x100}`; }
      if (this.caps.brightness) out.Backlight = `${this.caps.brightness.min}-${this.caps.brightness.max}${this.caps.brightness.marks ? ` in ${this.caps.brightness.marks.length} steps` : ''}`;
      return out;
    },

    async read() {
      if (!this.chan) throw Object.assign(new Error('the keyboard is not connected'), { gone: true });
      const v = {};
      const rate = await this.readRate(); if (rate !== undefined) v.reportRate = rate;
      const mode = await this.readMode(); if (mode) v.mode = mode;
      const prof = await this.readProfile(); if (prof !== undefined) v.profile = prof;
      if (this.caps.disableMask) { const bits = await this.readDisabled(); for (const d of DISABLE) if (this.caps.disableMask & d.bit) v[d.key] = !!(bits & d.bit); }
      if (this.caps.fnSwap) v.fnSwap = await this.readFnSwap();
      if (this.caps.brightness) v.brightness = await this.readBrightness();
      return v;
    },

    // one setting, checked, written, read back; refused while G HUB runs
    async write(key, value) {
      if (!this.chan) throw new Error('the keyboard is not connected');
      const s = this.settings.find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting of this keyboard`);
      if (s.type === 'toggle' && typeof value !== 'boolean') throw new Error(`${s.label} is on or off (true / false)`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      if (s.type === 'slider' && !(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`${s.label} must be a whole number ${s.min}-${s.max}`);
      const app = await vendorApp();
      if (app) throw Object.assign(new Error(`${app} (G HUB) is running: close it first (two programs writing the keyboard fight)`), { waiting: true });
      const mode = await this.readMode();
      // the sheet lists the report rate as easy to undo "in host mode"; Solaar: "May need Onboard Profiles set to Disable"
      if (key === 'reportRate' && mode === 'onboard') throw Object.assign(new Error('the keyboard is using its onboard profiles: set Settings source to Host first (the report rate is only changed live in host mode)'), { waiting: true });
      if (key === 'profile' && mode !== 'onboard') throw Object.assign(new Error('the keyboard is in host mode: a profile is picked in onboard mode (Settings source)'), { waiting: true });
      const lock = DISABLE.find((d) => d.key === key);
      if (key === 'reportRate') {
        const r = this.caps.rate;
        if (r.ext) await this.call(F.EXT_REPORT_RATE, 0x30, [EXT_RATES_HZ.indexOf(value)], { retry: false });   // Solaar ExtendedReportRate write 0x30 [index]
        else await this.call(F.REPORT_RATE, 0x20, [r.ms[r.hz.indexOf(value)]], { retry: false });                // Solaar ReportRate write 0x20 [ms]
      } else if (key === 'mode') {
        await this.call(F.ONBOARD_PROFILES, 0x10, [value === 'onboard' ? 0x01 : 0x02], { retry: false });       // Solaar OnboardProfiles write: fn 0x10 [01] / [02]
      } else if (key === 'profile') {
        await this.call(F.ONBOARD_PROFILES, 0x30, [value >> 8, value & 0xff], { retry: false });                // Solaar OnboardProfiles write: fn 0x30 [sector, 2 bytes]
      } else if (lock) {
        // Solaar DisableKeyboardKeys: BitFieldValidator writes the whole byte; the other bits go back as just read
        const bits = await this.readDisabled();
        await this.call(F.DISABLE_KEYS, 0x20, [value ? bits | lock.bit : bits & ~lock.bit & 0xff], { retry: false });
      } else if (key === 'fnSwap') {
        await this.call(this.caps.fnSwap, 0x10, [value ? 0x01 : 0x00], { retry: false });                         // Solaar FnSwap / NewFnSwap write 0x10 [01 / 00]
      } else if (key === 'brightness') {
        const b = this.caps.brightness;
        // Solaar BrightnessControl.rw_class.write: with on/off, fn 0x40 [00] below the minimum (off, nothing more) or [01];
        // then fn 0x20 [level hi, lo]
        if (b.onOff) { await this.call(F.BRIGHTNESS, 0x40, [value < Math.max(1, b.min) ? 0x00 : 0x01], { retry: false }); }
        if (!b.onOff || value >= Math.max(1, b.min)) await this.call(F.BRIGHTNESS, 0x20, [value >> 8, value & 0xff], { retry: false });
      }
      const back = (await this.read())[key];
      if (back !== value) throw new Error(`${key}: wrote ${value} but the keyboard reads back ${back}`);
      return back;
    },

    async battery() {
      if (this.features[F.UNIFIED_BATTERY]) {
        const p = await this.call(F.UNIFIED_BATTERY, 0x10);      // sheet "Battery (unified)": b0 %, b2 1 / 2 charging, 3 complete
        return { percent: this.caps.batteryPercent ? p[0] : null, charging: p[2] === 1 || p[2] === 2, full: p[2] === 3 };
      }
      if (this.features[F.BATTERY_STATUS]) {
        const p = await this.call(F.BATTERY_STATUS, 0x00);       // sheet "Battery (old)": b0 %, b2 1 / 2 / 4 charging, 3 full
        return { percent: p[0], charging: [1, 2, 4].includes(p[2]), full: p[2] === 3 };
      }
      if (this.features[F.BATTERY_VOLTAGE]) {
        const p = await this.call(F.BATTERY_VOLTAGE, 0x00);      // sheet "Battery voltage": b0-1 mV, b2 bit 7 = charging
        return { percent: null, mV: (p[0] << 8) | p[1], charging: !!(p[2] & 0x80) };
      }
      return null;
    },

    async rawBackup() {
      return { pid: hex4(this.pid), index: this.index, protocol: this.protocol, caps: this.caps,
        features: Object.fromEntries(Object.entries(this.features).map(([id, f]) => [`0x${hex4(Number(id))}`, f])),
        values: await this.read(), profileSector: await this.readProfileSector().catch(() => undefined) };
    },
  };
}

export default createLogitechKeyboard();
