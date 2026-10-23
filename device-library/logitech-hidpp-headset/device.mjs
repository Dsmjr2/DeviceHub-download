// Logitech G headsets (22 Oct 2026): HID++ 2.0 headsets on their own USB dongle or cable (G633 / G635 / G733 / G933 /
// G935 / G PRO / PRO X / G535), and the PRO X 2 LIGHTSPEED, which speaks HID++ wrapped in Logitech's "Centurion" frames.
// Written only from open-source code, cited beside every command:
//   Solaar  = github.com/pwr-Solaar/Solaar @ e7304c4c451cc9bb4f206a914844525e67856a28, lib/logitech_receiver/
//             (hidpp20_constants.py feature ids; settings_templates.py read / write functions; settings.py FeatureRW
//             defaults; settings_validator.py value layouts; hidpp20.py battery layouts; descriptors.py headset ids)
//   HC      = github.com/Sapd/HeadsetControl @ 91ee690a5e302a10a6f4f75a46be05846a38a3b0, lib/devices/
//             (logitech_g633_g933_935.hpp, logitech_gpro.hpp, logitech_g535.hpp: ids and HID collections;
//             protocols/hidpp_protocol.hpp: framing; protocols/logitech_centurion_protocol.hpp and
//             logitech_gpro_x2_lightspeed.hpp: the Centurion frames, bridge and PRO X 2 features)
//   sheet   = docs/brands/logitech.md (which cites the same projects)
// Not run on a real headset: status "untested" in device.json; DeviceHub proves each write with its self-check first.
//
// Every request goes through hidpp() or centurion(), which send only the (feature, function) pairs in ALLOWED /
// C_ALLOWED. DFU (0x00C0-0x00C3, 0x00D0, Centurion 0x010A), device reset 0x1802, OOB state 0x1805, force pairing 0x1500,
// BLE pre-pairing 0x1816 and Lightspeed pairing 0x0309 are in NEVER, are never looked up and can never be sent.
// Every write is read back; every write is refused while G HUB runs.
//
// G522 LIGHTSPEED (23 Oct 2026), battery only:
//   HC2    = HeadsetControl @ a8120a62bcbb45a9766d9060dfd21ae18f8550a5, lib/devices/logitech_g522_lightspeed.hpp
//            (SUPPORTED_PRODUCT_IDS { 0x0b18 }; usage page 0xffa0, usage 0x0001, interface 3; FRAME_PREFIX { 0x50, 0x23 }:
//            "its frames start with 0x50 0x23 instead of 0x51"; getBattery = CenturionBatterySoc 0x0104 fn 0x00 through the
//            bridge, parseCenturionBatteryResponse) and protocols/logitech_centurion_protocol.hpp (buildCenturionFrame /
//            extractCenturionPayload: the prefix, then [length, flags], the prefix checked on every reply)
//   Solaar = lib/logitech_receiver/base.py lines 99-117 ("0x50 (G522): [0x50, device_addr, cpl_length, flags, feat_idx,
//            func_sw, params..., pad]"; "device_addr learned from first RX"), 346-356 ("Typical G522 (addr=0x23)"),
//            400-416 (the address taken from byte 1 of a received 0x50 frame); lib/hidapi/udev_impl.py lines 114-122 (a
//            Centurion collection = 63-byte input and output reports 0x50 / 0x51); descriptors.py line 471 ("G522 LIGHTSPEED
//            Gaming Headset (0x0B18 dongle, 0x0B19 wired) — Centurion 0x50 variant"); centurion.py lines 199-230
//            (CENTURION_BATTERY_SOC: b0 percent, b2 1 / 2 charging, 3 full) and 545-588 (a 0x50 device whose dongle has no
//            bridge 0x0003 is a direct device: its features asked without the bridge)
//   The address byte is 0x23 (HC2's fixed prefix, Solaar's "typical G522"). Solaar finds it by sending a ping to every
//   address 0x00-0xFF; DeviceHub never does (no guessed sends): it only takes another address from a 0x50 frame the
//   headset sends by itself, as Solaar's receive path does, and asks once more there. The cable id 0B19: Solaar names it
//   but gives no collection or interface, so its channel is the 0xFFA0 collection with 63-byte reports (udev_impl.py);
//   with no bridge there it is asked directly (centurion.py). Sidetone, auto sleep, lights, EQ and voice prompts on the
//   G522 are not offered yet (only the battery is, read-only).
//
// Left out (no source documents a read-back, or the layout is not documented): HID++ sidetone on the G432 family and
// G533 (HC writes only), lights (HC `04 3C`: write only), the PRO X 2's EQ (0x020D / 0x0636: HC writes a parametric
// set, no plain read of the same value), the G435 and ASTRO A50 X (in neither project), ASTRO A50 Gen 4 / 5 (their own
// non-HID++ protocol). The G431 / G432 / G433 (HC2 logitech_g432.hpp: 0x0a9b / 0x0a9c / 0x0a6d) are not run: HC2's only
// command for them is a sidetone write (`05 1e level`, sendHIDPPFeature: no reply read), it opens them on no named
// collection (the first one, getCapabilityDetail default), they have no battery, and Solaar and libratbag do not list
// them, so there is nothing to read back or show.
import { getDevice } from '../../public/devices/hid.js';

const VID = 0x046d;
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (b) => b.toString(16).padStart(2, '0');

// ---- the models ----
// HID++ 2.0 headsets. Ids: HC logitech_g633_g933_935.hpp getProductIds (G633 0a5c, G635 0a89, G933 0a5b, G935 0a87,
// G733 0ab5 / 0afe / 0b1f) and logitech_gpro.hpp (G PRO 0aa7, PRO X 0aaa / 0aba, PRO X 2 HID++ variants 0afb / 0afc),
// their collection usage page 0xFF43 usage 0x0202 (getCapabilityDetail); G535 0ac4 on interface 3, usage page 0x0C,
// usage 0x01 (logitech_g535.hpp). Solaar descriptors.py lists the G535 / G935 / G733 / PRO X as protocol 2.0, interface 3.
export const HIDPP = {
  '0A5C': 'G633', '0A89': 'G635', '0A5B': 'G933', '0A87': 'G935', '0AB5': 'G733', '0AFE': 'G733', '0B1F': 'G733',
  '0AA7': 'G PRO', '0AAA': 'PRO X', '0ABA': 'PRO X', '0AFB': 'PRO X 2', '0AFC': 'PRO X 2', '0AC4': 'G535',
};
export const G535 = '0AC4';
// Centurion: HC logitech_gpro_x2_lightspeed.hpp SUPPORTED_PRODUCT_IDS { 0x0af7 }, usage page 0xFFA0, usage 0x0001,
// interface 3 (getCapabilityDetail); report id 0x51 (REPORT_PREFIX), 64-byte frames (PACKET_SIZE)
export const CENTURION = { '0AF7': 'PRO X 2 LIGHTSPEED', '0B18': 'G522 LIGHTSPEED', '0B19': 'G522 LIGHTSPEED (USB cable)' };
// each Centurion id's frame: report id, and the 0x50 variant's address byte (HC2 FRAME_PREFIX, Solaar base.py)
export const C_FRAMES = { '0AF7': { reportId: 0x51, addr: null }, '0B18': { reportId: 0x50, addr: 0x23 }, '0B19': { reportId: 0x50, addr: 0x23 } };
// the G522: battery only (see the header); the cable may have no bridge (Solaar centurion.py: a direct device)
export const G522 = ['0B18', '0B19'];
export const C_MAY_BE_DIRECT = ['0B19'];
export const PIDS = [...Object.keys(HIDPP), ...Object.keys(CENTURION)];

// ---- HID++ 2.0 framing (HC protocols/hidpp_protocol.hpp sendHIDPPCommand; sheet section 2 "Message format") ----
// long report 0x11, 20 bytes in all (19 after the report id); device index 0xFF (HIDPP_DEVICE_RECEIVER: a headset is
// addressed directly); byte 3 = function in the high nibble, software id in the low one. HC's headset commands carry
// 0x0A there (`08 0A` battery, `07 1A` sidetone), so this driver uses 0x0A too.
export const REPORT_LONG = 0x11, REPORT_SHORT = 0x10, LEN = 19, DEV = 0xff, SW_ID = 0x0a;
// Centurion framing (HC logitech_centurion_protocol.hpp): report 0x51, then [length, flags 00, payload...] padded to 64;
// length = payload length + 1 (exact_direct_length, which logitech_gpro_x2_lightspeed.hpp turns on); payload = [feature
// index, (function & 0xF0) | 0x01 (SOFTWARE_ID), params...]. Bridge: feature 0x0003, function 0x10 (send fragment).
export const C_REPORT = 0x51, C_REPORT_ADDR = 0x50, C_LEN = 63, C_SW = 0x01, C_BRIDGE_FN = 0x10;

// feature ids (Solaar hidpp20_constants.py SupportedFeature)
export const F = {
  ROOT: 0x0000, UNIFIED_BATTERY: 0x1004, BATTERY_STATUS: 0x1000, ADC: 0x1F20, SIDETONE: 0x8300, EQUALIZER: 0x8310,
  MIC_MUTE: 0x0601, BRIDGE: 0x0003, C_BATTERY: 0x0104, C_AUTO_SLEEP: 0x0108, C_SIDETONE: 0x0604,
};
// HID++ 2.0 headsets: the only (feature, function) pairs hidpp() sends
export const ALLOWED = {
  [F.ROOT]: [0x00, 0x10],              // getFeature, ping (Solaar base.py ping; sheet section 2 "Feature lookup")
  [F.UNIFIED_BATTERY]: [0x00, 0x10],   // caps, status (sheet section 3 "Battery (unified)"; Solaar hidpp20.py)
  [F.BATTERY_STATUS]: [0x00],          // status (sheet section 3 "Battery (old)")
  [F.ADC]: [0x00, 0x10, 0x20],         // measurement (Solaar hidpp20.py get_adc_measurement: fn 0); power-off read 0x10 / write 0x20 (Solaar ADCPower)
  [F.SIDETONE]: [0x00, 0x10],          // Solaar Sidetone: FeatureRW defaults read 0x00 / write 0x10 (settings.py FeatureRW); HC `07 1A level` is fn 0x10
  [F.EQUALIZER]: [0x00, 0x10, 0x20, 0x30], // Solaar Equalizer: caps 0x00, frequencies 0x10, read 0x20 [00], write 0x30 [02, gains]
  [F.MIC_MUTE]: [0x10],                // Solaar HeadsetMicMute: read fn 0x10 (its write fn 0x20 is never sent: mute is shown, not set)
};
// PRO X 2: direct requests to the dongle and bridged requests to the headset (HC logitech_centurion_protocol.hpp)
export const C_ALLOWED = {
  direct: { [F.ROOT]: [0x00], [F.BRIDGE]: [C_BRIDGE_FN] },   // Root.getFeature for the bridge; the bridge's send-fragment
  // a G522 on its cable with no bridge (Solaar centurion.py: a direct device): Root.getFeature and the battery only
  device: { [F.ROOT]: [0x00], [F.C_BATTERY]: [0x00] },
  sub: {
    [F.ROOT]: [0x00],                  // lookupCenturionFeature: Root.getFeature through the bridge
    [F.C_BATTERY]: [0x00],             // HC getBattery: CenturionBatterySoc fn 0x00
    [F.C_SIDETONE]: [0x00, 0x10, 0x20], // Solaar HeadsetSidetone: read 0x00, write 0x10, gain steps 0x20 (v2+); HC setSidetone reads 0x00, writes 0x10
    [F.C_AUTO_SLEEP]: [0x00, 0x10],    // Solaar HeadsetAutoSleep: read 0x00, write 0x10
    [F.MIC_MUTE]: [0x10],              // Solaar HeadsetMicMute read 0x10 (HC names 0x0601 HeadsetMicMuteLed)
  },
};
// never looked up, never sent (sheet section 4 "Never touch"; Solaar hidpp20_constants.py: DFUCONTROL_* 0x00C0-0x00C3,
// DFU 0x00D0, CENTURION_GENERIC_DFU 0x010A, DEVICE_RESET 0x1802, OOBSTATE 0x1805, FORCE_PAIRING 0x1500,
// BLE_PRO_PRE_PAIRING 0x1816, LIGHTSPEED_PAIRING 0x0309)
export const NEVER = [0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00d0, 0x010a, 0x1802, 0x1805, 0x1500, 0x1816, 0x0309];

// HID++ 2.0 error codes (sheet section 2 "Errors"; Solaar hidpp20_constants.py ErrorCode)
const ERRORS = { 1: 'unknown', 2: 'invalid argument', 3: 'out of range', 4: 'hardware error', 5: 'not allowed', 6: 'invalid feature index', 7: 'invalid function', 8: 'busy', 9: 'unsupported' };
export class HidppError extends Error {
  constructor(code, what) { super(`${what}: the headset refused it (HID++ error 0x${hex2(code)} ${ERRORS[code] || 'unknown code'})`); this.code = code; }
}

// G535 auto-off: HC logitech_g535.hpp validateInactiveTime "Accepted values: 0 (never), 1, 2, 5, 10, 15, 30"
export const G535_AUTO_OFF = [0, 1, 2, 5, 10, 15, 30];
// ADC millivolts -> percent: Solaar hidpp20.py estimate_battery_level_percentage, linear between these points
export const ADC_CURVE = [[4186, 100], [4067, 90], [3989, 80], [3922, 70], [3859, 60], [3811, 50], [3778, 40], [3751, 30], [3717, 20], [3671, 10], [3646, 5], [3579, 2], [3500, 0]];
export function adcPercent(mv) {
  if (mv >= ADC_CURVE[0][0]) return 100;
  if (mv <= ADC_CURVE.at(-1)[0]) return 0;
  for (let i = 0; i < ADC_CURVE.length - 1; i++) {
    const [v1, p1] = ADC_CURVE[i], [v2, p2] = ADC_CURVE[i + 1];
    if (mv <= v1 && mv >= v2) return Math.round(p2 + ((p1 - p2) * (mv - v2)) / (v1 - v2));
  }
  return null;
}
const s8 = (b) => (b > 127 ? b - 256 : b);

// G HUB (sheet section 5 "Windows note": it holds the same HID collection; two programs writing one headset fight)
// lghub_updater.exe is left out: it is a service that runs with G HUB closed (23 Oct 2026, support #13)
export const VENDOR_APPS = /^lghub(_agent|_system_tray)?\.exe$/i;
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
  return null;
}
async function defaultOpen(pid) {
  // interface 3: G535 (HC), PRO X 2 (HC), the G522 dongle (HC2); the G522 cable's interface is in no source
  const iface = pid === G535 || (CENTURION[pid] && !C_MAY_BE_DIRECT.includes(pid)) ? 3 : undefined;
  return getDevice([{ vendorId: VID, productId: parseInt(pid, 16), ...(iface ? { iface } : {}) }], { prompt: false });
}

// Wait for one input report that decide() accepts, after send() (the raw channel hands every input report over).
// decide(reportId, bytes) -> undefined (not ours, keep listening) | { value } | { error }
function exchange(dev, send, decide, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); dev.removeEventListener('inputreport', on); fn(v); };
    const on = (e) => {
      const u8 = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      let r; try { r = decide(e.reportId, u8); } catch (err) { return finish(reject, err); }
      if (r?.error) finish(reject, r.error); else if (r) finish(resolve, r.value);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('no reply from the headset (switched off, asleep or out of range?)'), { noReply: true })), ms);
    dev.addEventListener('inputreport', on);
    Promise.resolve().then(send).catch((err) => finish(reject, err));
  });
}

export function createLogitechHeadset({ open = defaultOpen, vendorApp = defaultVendorApp, timeoutMs = 2600 } = {}) {
  const adapter = {
    id: 'logitech-hidpp-headset',
    title: 'Logitech headset',
    kind: 'Headset',
    vendor: 'Logitech',
    hid: { vid: '046D', pid: '0AB5', pids: PIDS, page: 'FF43', usage: '0202', len: LEN, reportId: REPORT_LONG, reply: 'raw', replyMs: 2000,
      byPid: { [G535]: { page: '000C', usage: '0001', iface: 3 }, '0AF7': { page: 'FFA0', usage: '0001', iface: 3, len: C_LEN, reportId: C_REPORT },
        '0B18': { page: 'FFA0', usage: '0001', iface: 3, len: C_LEN, reportId: C_REPORT_ADDR },
        // the G522 cable: the 0xFFA0 collection whose input and output reports are 63 bytes (Solaar udev_impl.py)
        '0B19': { page: 'FFA0', usage: '*', inputLen: C_LEN, outputLen: C_LEN, len: C_LEN, reportId: C_REPORT_ADDR } } },
    unsupported: ['lights', 'EQ on the PRO X 2', 'setting the mic mute (shown only)', 'G432 / G533 sidetone', 'G522 settings (battery only)', 'G435, ASTRO A50 / A50 X', 'firmware updates', 'pairing'],
    dev: null, pid: null, centurion: false, features: {}, caps: {}, bridge: null, q: Promise.resolve(), frame: null, direct: false, heardAddr: null,

    get settings() {
      const out = [];
      const c = this.caps;
      if (c.sidetone) out.push({ key: 'sidetone', label: 'Sidetone', type: 'slider', min: 0, max: c.sidetone.max, step: 1, unit: c.sidetone.max === 100 ? '%' : 'steps', live: true, hint: 'How much of your own voice you hear' });
      if (c.autoOff?.choices) out.push({ key: 'autoOff', label: 'Turn off when idle', type: 'choice', options: c.autoOff.choices.map((m) => ({ value: m, label: m ? `after ${m} min` : 'never' })) });
      else if (c.autoOff) out.push({ key: 'autoOff', label: 'Turn off when idle', type: 'slider', min: 0, max: 255, step: 1, unit: 'min', hint: '0 = never' });
      if (c.micMute) out.push({ key: 'micMuted', label: 'Mic muted', type: 'display', hint: 'Shown only; mute with the headset\'s own button' });
      for (const b of c.eq?.bands || []) out.push({ key: `eq${b.n}`, label: `EQ ${b.label}`, type: 'slider', min: c.eq.min, max: c.eq.max, step: 1, unit: 'dB', hint: 'Stored in the headset' });
      return out;   // empty until connect() has read what this headset has
    },

    async connect() {
      if (this.dev && this.onAddr) this.dev.removeEventListener('inputreport', this.onAddr);
      this.dev = null; this.features = {}; this.caps = {}; this.bridge = null; this.q = Promise.resolve(); this.frame = null; this.direct = false; this.heardAddr = null; this.onAddr = null;
      for (const pid of PIDS) {
        const dev = await open(pid);
        if (!dev) continue;
        if (!dev.opened && dev.open) await dev.open();
        this.dev = dev; this.pid = pid; this.centurion = !!CENTURION[pid];
        if (this.centurion) this.frame = { ...C_FRAMES[pid] };
        if (this.frame?.addr != null) {
          // the 0x50 variant: note the address byte of any 0x50 frame the headset sends (Solaar base.py _unwrap_centurion_frame)
          this.onAddr = (e) => { if (e.reportId === C_REPORT_ADDR && e.data.byteLength > 1) this.heardAddr = e.data.getUint8(0); };
          dev.addEventListener('inputreport', this.onAddr);
        }
        await (this.centurion ? this.discoverCenturion() : this.discoverHidpp());
        return true;
      }
      return false;
    },

    // one request at a time (both transports share one queue)
    serial(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; },

    // ---- HID++ 2.0: [0xFF, feature index, fn | swid, params] on report 0x11 ----
    hidpp(featureId, fn, params = [], { retry = true } = {}) {
      if (NEVER.includes(featureId) || !(ALLOWED[featureId] || []).includes(fn)) return Promise.reject(new Error(`refused: feature 0x${hex4(featureId)} function 0x${hex2(fn)} is not one this driver sends`));
      const index = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
      if (!index && featureId !== F.ROOT) return Promise.reject(new Error(`the headset has no feature 0x${hex4(featureId)}`));
      const out = new Uint8Array(LEN);
      out.set([DEV, index, (fn & 0xf0) | SW_ID, ...params].slice(0, LEN));
      const what = `0x${hex4(featureId)} fn 0x${hex2(fn)}`;
      // a reply echoes device index, feature index and function+swid; an error is <dev> FF <idx> <fn+swid> <code>
      // (sheet section 2 "Replies" / "Errors"). A short (0x10) reply is taken too: HC reads 7-byte replies.
      const decide = (rid, r) => {
        if (rid !== REPORT_LONG && rid !== REPORT_SHORT) return undefined;
        if (r[1] === 0xff && r[2] === index && r[3] === out[2]) return { error: new HidppError(r[4], what) };
        if (r[1] === index && r[2] === out[2]) { const p = new Uint8Array(16); p.set(r.slice(3, 19)); return { value: p }; }
        return undefined;
      };
      const once = () => exchange(this.dev, () => this.dev.sendReport(REPORT_LONG, out), decide, timeoutMs);
      return this.serial(() => once().catch((e) => { if (!retry || !e.noReply) throw e; return once(); }));
    },

    async discoverHidpp() {
      // ping (Solaar base.py ping: Root fn 0x10, params 00 00 <mark>, the mark echoed in byte 2)
      const p = await this.hidpp(F.ROOT, 0x10, [0, 0, 0x5a], { retry: false });
      this.protocol = `${p[0]}.${p[1]}`;
      for (const id of [F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.ADC, F.SIDETONE, F.EQUALIZER, F.MIC_MUTE]) {
        const r = await this.hidpp(F.ROOT, 0x00, [id >> 8, id & 0xff]);   // getFeature: b0 index (0 = absent), b1 flags, b2 version
        if (r[0]) this.features[id] = { index: r[0], flags: r[1], version: r[2] };
      }
      const c = this.caps;
      if (this.features[F.SIDETONE]) c.sidetone = { max: 100 };   // Solaar Sidetone min_value 0, max_value 100
      // Solaar ADCPower min_version = 2 ("documentation for version 1 does not mention this capability"), 0-255 minutes
      if (this.features[F.ADC]?.version >= 2) c.autoOff = this.pid === G535 ? { choices: G535_AUTO_OFF } : { max: 255 };
      if (this.features[F.MIC_MUTE]) c.micMute = true;
      if (this.features[F.UNIFIED_BATTERY]) { const q = await this.hidpp(F.UNIFIED_BATTERY, 0x00); c.batteryPercent = !!(q[1] & 0x02); }
      if (this.features[F.EQUALIZER]) {
        // Solaar Equalizer.validator_class.build: fn 0x00 -> count, dbRange, (unused), dbMin, dbMax; dbMin 0 = -dbRange,
        // dbMax 0 = +dbRange; frequencies: fn 0x10 [g*7] per 7 bands, band b at reply bytes 2b+1..2b+2 (big-endian Hz)
        const e = await this.hidpp(F.EQUALIZER, 0x00);
        const count = e[0], range = e[1];
        const min = e[3] ? s8(e[3]) : -range, max = e[4] ? s8(e[4]) : range;
        // the write is [02, gain per band] in the 16 parameter bytes, so at most 15 bands fit
        if (count >= 1 && count <= 15 && max > min) {
          const bands = [];
          for (let g = 0; g * 7 < count; g++) {
            const fr = await this.hidpp(F.EQUALIZER, 0x10, [g * 7]);
            for (let b = 0; b < 7 && g * 7 + b < count; b++) { const hz = (fr[2 * b + 1] << 8) | fr[2 * b + 2]; bands.push({ n: g * 7 + b + 1, hz, label: hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${hz} Hz` }); }
          }
          c.eq = { count, min, max, bands };
        }
      }
    },

    // ---- Centurion (PRO X 2) ----
    // a frame on report 0x51: [len, flags 00, payload...], payload = [feature index, fn | 0x01, params]
    // the 0x50 variant (G522) puts its address byte first: [addr, len, flags 00, payload...] (HC2 FRAME_PREFIX 50 23)
    centurionFrame(payload) {
      const out = new Uint8Array(C_LEN), a = this.frame?.addr;
      out.set([...(a != null ? [a] : []), payload.length + 1, 0x00, ...payload].slice(0, C_LEN));
      return out;
    },
    get cReport() { return this.frame?.reportId ?? C_REPORT; },
    // the payload of a reply frame (HC extractCenturionPayload: the prefix must match): data[2 .. 1+len) after the
    // address byte when there is one, or null when it is not a frame of this headset
    centurionPayload(rid, d) {
      if (rid !== this.cReport) return null;
      const a = this.frame?.addr, o = a != null ? 1 : 0;
      if (a != null && d[0] !== a) return null;
      const len = d[o];
      if (len <= 1 || len + 1 + o > d.length) return null;
      return d.slice(2 + o, 1 + o + len);
    },

    // direct request to the dongle (HC sendCenturionRequest): the reply is the first frame for the same feature index;
    // the bridge's connection event ([bridge, 00, 00, connected]) is skipped
    cDirect(featureId, fn, params = []) {
      const allowed = this.direct ? C_ALLOWED.device : C_ALLOWED.direct;
      if (NEVER.includes(featureId) || !(allowed[featureId] || []).includes(fn)) return Promise.reject(new Error(`refused: Centurion feature 0x${hex4(featureId)} function 0x${hex2(fn)} is not one this driver sends`));
      const index = featureId === F.ROOT ? 0 : this.direct ? this.features[featureId]?.index : this.bridge;
      if (!index && featureId !== F.ROOT) return Promise.reject(new Error(`the headset has no feature 0x${hex4(featureId)}`));
      const out = this.centurionFrame([index, (fn & 0xf0) | C_SW, ...params]);
      const decide = (rid, d) => {
        const p = this.centurionPayload(rid, d);
        if (!p || p.length < 2) return undefined;
        if (this.bridge != null && p[0] === this.bridge && p[1] === 0x00) return undefined;
        if (p[0] === 0xff && p[1] === index) return { error: new HidppError(p[3] ?? 0, `Centurion 0x${hex4(featureId)} fn 0x${hex2(fn)}`) };
        return p[0] === index ? { value: p.slice(2) } : undefined;
      };
      return this.serial(() => exchange(this.dev, () => this.dev.sendReport(this.cReport, out), decide, timeoutMs));
    },

    // a request to the headset behind the bridge (HC sendCenturionBridgeRequest, one fragment): [bridge, 0x11, size hi,
    // size lo, 00, sub index, fn | 0x01, params]. Replies: [bridge, 0x11, ...] = the bridge's ack (keep waiting);
    // [bridge, 0x10, s, s, 00, sub index, fn, params] = the answer; [bridge, 0x10, s, s, 00, FF, sub index, ...] = refused;
    // [bridge, 00, 00, 00] = the headset went away; [FF, bridge, 0x11, ...] = the bridge refused before acking
    cSub(featureId, fn, params = []) {
      if (NEVER.includes(featureId) || !(C_ALLOWED.sub[featureId] || []).includes(fn)) return Promise.reject(new Error(`refused: Centurion feature 0x${hex4(featureId)} function 0x${hex2(fn)} is not one this driver sends`));
      if (this.bridge == null) return Promise.reject(new Error('the PRO X 2 dongle has no bridge to the headset'));
      const sub = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
      if (!sub && featureId !== F.ROOT) return Promise.reject(new Error(`the headset has no feature 0x${hex4(featureId)}`));
      const msg = [0x00, sub, (fn & 0xf0) | C_SW, ...params];
      const out = this.centurionFrame([this.bridge, C_BRIDGE_FN | C_SW, (msg.length >> 8) & 0x0f, msg.length & 0xff, ...msg]);
      const what = `Centurion 0x${hex4(featureId)} fn 0x${hex2(fn)}`;
      const decide = (rid, d) => {
        const p = this.centurionPayload(rid, d);
        if (!p || p.length < 2) return undefined;
        if (p[0] === 0xff && p[1] === this.bridge && p[2] === (C_BRIDGE_FN | C_SW)) return { error: Object.assign(new Error('the PRO X 2 dongle refused the request (is the headset switched on?)'), { offline: true }) };
        if (p[0] !== this.bridge) return undefined;
        if (p[1] === 0x00) return p.length >= 4 && p[3] === 0x00 ? { error: Object.assign(new Error('the headset is switched off or out of range'), { offline: true }) } : undefined;
        if ((p[1] >> 4) !== (C_BRIDGE_FN >> 4) || (p[1] & 0x0f) !== 0x00) return undefined;   // the ack (swid 1) or not the bridge's message event
        if (p.length < 7 || p[4] !== 0x00) return undefined;
        if (p[5] === sub) return { value: p.slice(7) };
        if (p[5] === 0xff && p[6] === sub) return { error: new HidppError(p[8] ?? 0, what) };
        return undefined;
      };
      return this.serial(() => exchange(this.dev, () => this.dev.sendReport(this.cReport, out), decide, timeoutMs));
    },

    // the first request to a 0x50 headset: at 0x23, and once more at an address the headset itself sent a frame from
    async cFirst(featureId, fn, params) {
      try { return await this.cDirect(featureId, fn, params); } catch (e) {
        if (!e.noReply || this.frame?.addr == null || this.heardAddr == null || this.heardAddr === this.frame.addr) throw e;
        this.frame.addr = this.heardAddr;
        return this.cDirect(featureId, fn, params);
      }
    },

    async discoverCenturion() {
      // HC lookupCenturionFeature (lookup_features_by_id): Root.getFeature(0x0003) on the dongle, then Root.getFeature
      // through the bridge for each headset feature; reply [index (0 = absent), flags, version]
      const g522 = G522.includes(this.pid);
      const b = await this.cFirst(F.ROOT, 0x00, [F.BRIDGE >> 8, F.BRIDGE & 0xff]);
      if (!b[0] && C_MAY_BE_DIRECT.includes(this.pid)) {
        // the G522 on its cable: no bridge, so its own features are asked directly (Solaar centurion.py create_centurion_receiver)
        this.direct = true;
        const r = await this.cDirect(F.ROOT, 0x00, [F.C_BATTERY >> 8, F.C_BATTERY & 0xff]);
        if (r[0]) this.features[F.C_BATTERY] = { index: r[0], flags: r[1], version: r[2] };
        return;
      }
      if (!b[0]) throw new Error(`the ${CENTURION[this.pid]} dongle has no Centurion bridge (0x0003)`);
      this.bridge = b[0];
      // the G522: only the battery is looked up (sidetone, auto sleep and mic mute are not offered for it yet)
      for (const id of g522 ? [F.C_BATTERY] : [F.C_BATTERY, F.C_SIDETONE, F.C_AUTO_SLEEP, F.MIC_MUTE]) {
        const r = await this.cSub(F.ROOT, 0x00, [id >> 8, id & 0xff]);
        if (r[0]) this.features[id] = { index: r[0], flags: r[1], version: r[2] };
      }
      const c = this.caps;
      const st = this.features[F.C_SIDETONE];
      if (st) {
        // Solaar HeadsetSidetone.build: version > 1: get [mic_count, mic_id, reserved, level], set [01, FF, level], gain steps
        // N = fn 0x20 reply byte 2 when > 1; version <= 1: get [mic_count, mic_id, level], set [01, level], N = 101
        let steps = 101;
        if (st.version > 1) { try { const r = await this.cSub(F.C_SIDETONE, 0x20); if (r[2] > 1) steps = r[2]; } catch (e) { if (e.offline) throw e; } }
        c.sidetone = { max: steps - 1, v2: st.version > 1 };
      }
      const as = this.features[F.C_AUTO_SLEEP];
      // Solaar _AutoSleepRangeValidator: v4+ 3 bytes (slot 0), v3 2 bytes (slot 1), else 1 byte (slot 0); 0-255 minutes
      if (as) c.autoOff = { max: 255, bytes: as.version >= 4 ? 3 : as.version >= 3 ? 2 : 1, slot: as.version === 3 ? 1 : 0 };
      if (this.features[F.MIC_MUTE]) c.micMute = true;
    },

    // ---- reads ----
    async readSidetone() {
      if (!this.caps.sidetone) return undefined;
      if (!this.centurion) return (await this.hidpp(F.SIDETONE, 0x00))[0];          // Solaar Sidetone: reply byte 0
      const r = await this.cSub(F.C_SIDETONE, 0x00);
      return r[this.caps.sidetone.v2 ? 3 : 2];                                       // Solaar HeadsetSidetone read_skip_byte_count 3 / 2
    },
    async readAutoOffBytes() { return Array.from((await this.cSub(F.C_AUTO_SLEEP, 0x00)).slice(0, this.caps.autoOff.bytes)); },
    async readAutoOff() {
      if (!this.caps.autoOff) return undefined;
      if (!this.centurion) return (await this.hidpp(F.ADC, 0x10))[0];               // Solaar ADCPower: read 0x10, 1 byte
      return (await this.readAutoOffBytes())[this.caps.autoOff.slot];
    },
    async readMicMuted() {
      if (!this.caps.micMute) return undefined;
      const r = this.centurion ? await this.cSub(F.MIC_MUTE, 0x10) : await this.hidpp(F.MIC_MUTE, 0x10);
      return r[0] === 1;                                                             // BooleanValidator: byte 0, true = 0x01
    },
    async readEq() {
      // Solaar Equalizer read 0x20 [00]: one signed byte per band from byte 0 (PackedRangeValidator, read_skip 0)
      const r = await this.hidpp(F.EQUALIZER, 0x20, [0x00]);
      return Array.from(r.slice(0, this.caps.eq.count), s8);
    },

    async info() {
      const out = {
        Model: `Logitech ${this.centurion ? CENTURION[this.pid] : HIDPP[this.pid] || 'headset'}`,
        'Product id': `046D:${this.pid}`,
        Protocol: this.centurion ? `Centurion${this.frame?.addr != null ? ` 0x50, address 0x${hex2(this.frame.addr)}` : ''} (${this.direct ? 'no bridge: asked directly' : `bridge at index ${this.bridge}`})` : `HID++ ${this.protocol}`,
        Features: Object.entries(this.features).map(([id, f]) => `0x${hex4(Number(id))} v${f.version}`).join(', ') || 'none found',
      };
      if (this.caps.eq) out.EQ = `${this.caps.eq.count} bands, ${this.caps.eq.min} to ${this.caps.eq.max} dB`;
      return out;
    },

    async read() {
      if (!this.dev) throw Object.assign(new Error('the headset is not connected'), { gone: true });
      const v = {};
      const st = await this.readSidetone(); if (st !== undefined) v.sidetone = st;
      const ao = await this.readAutoOff(); if (ao !== undefined) v.autoOff = ao;
      const mm = await this.readMicMuted(); if (mm !== undefined) v.micMuted = mm;
      if (this.caps.eq) (await this.readEq()).forEach((g, i) => { v[`eq${i + 1}`] = g; });
      return v;
    },

    // one setting, checked, written, read back (CLAUDE.md); refused while G HUB runs
    async write(key, value) {
      if (!this.dev) throw new Error('the headset is not connected');
      const s = this.settings.find((x) => x.key === key);
      if (!s || s.type === 'display') throw new Error(`${key} is not a setting this headset can change`);
      if (!Number.isInteger(value)) throw new Error(`${key} must be a whole number`);
      if (s.type === 'slider' && (value < s.min || value > s.max)) throw new Error(`${s.label} must be ${s.min}-${s.max}`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      const app = await vendorApp();
      if (app) throw Object.assign(new Error(`${app} (G HUB) is running: close it first (two programs writing the headset fight)`), { waiting: true });
      const c = this.caps;
      if (key === 'sidetone') {
        if (!this.centurion) await this.hidpp(F.SIDETONE, 0x10, [value], { retry: false });   // Solaar Sidetone write fn 0x10 [level]; HC `07 1A level`
        else {
          // Solaar HeadsetSidetone prepare_write: [01, FF, level] (v2+) or [01, level]. Solaar skips an unchanged level;
          // DeviceHub always sends it (driver safety, 22 Oct 2026): the self-check writes the value it just read, and a
          // skipped write would pass without the headset ever taking the command
          await this.cSub(F.C_SIDETONE, 0x10, c.sidetone.v2 ? [0x01, 0xff, value] : [0x01, value]);
        }
      } else if (key === 'autoOff') {
        if (!this.centurion) await this.hidpp(F.ADC, 0x20, [value], { retry: false });     // Solaar ADCPower write 0x20 [minutes]; HC G535 `05 2D min`
        else {
          // Solaar _AutoSleepRangeValidator.prepare_write: the bytes just read, only the timer slot changed. Sent even when
          // unchanged (driver safety, 22 Oct 2026: the self-check's write of the same value must reach the headset)
          const cur = await this.readAutoOffBytes();
          cur[c.autoOff.slot] = value;
          await this.cSub(F.C_AUTO_SLEEP, 0x10, cur);
        }
      } else if (/^eq\d+$/.test(key)) {
        // Solaar Equalizer write 0x30: [02, gain per band] (PackedRangeValidator write_prefix_bytes b"\x02", signed bytes);
        // every other band is sent back exactly as just read
        const gains = await this.readEq();
        gains[Number(key.slice(2)) - 1] = value;
        await this.hidpp(F.EQUALIZER, 0x30, [0x02, ...gains.map((g) => g & 0xff)], { retry: false });
        const after = await this.readEq();
        const moved = after.findIndex((g, i) => i !== Number(key.slice(2)) - 1 && g !== gains[i]);
        if (moved >= 0) throw new Error(`EQ: band ${moved + 1} moved while writing ${key}`);
      }
      const back = (await this.read())[key];
      if (back !== value) throw new Error(`${key}: wrote ${value} but the headset reads back ${back}`);
      return back;
    },

    async battery() {
      if (!this.dev) return null;
      if (this.centurion) {
        if (!this.features[F.C_BATTERY]) return null;
        // HC parseCenturionBatteryResponse: b0 percent 0-100, b2 state, 1 or 2 = charging (Solaar centurion.py: 3 = full)
        const r = this.direct ? await this.cDirect(F.C_BATTERY, 0x00) : await this.cSub(F.C_BATTERY, 0x00);
        if (r[0] > 100) return null;
        return G522.includes(this.pid) ? { percent: r[0], charging: r[2] === 1 || r[2] === 2, full: r[2] === 3 } : { percent: r[0], charging: r[2] === 1 || r[2] === 2 };
      }
      if (this.features[F.UNIFIED_BATTERY]) {
        // sheet section 3 "Battery (unified)": b0 %, b1 level bits, b2 0 discharging / 1 charging / 2 slow / 3 complete
        const p = await this.hidpp(F.UNIFIED_BATTERY, 0x10);
        return { percent: this.caps.batteryPercent ? p[0] : null, charging: p[2] === 1 || p[2] === 2, full: p[2] === 3 };
      }
      if (this.features[F.BATTERY_STATUS]) {
        const p = await this.hidpp(F.BATTERY_STATUS, 0x00);   // sheet "Battery (old)": b0 %, b2 status 1 / 2 / 4 = charging, 3 = full
        return { percent: p[0], charging: [1, 2, 4].includes(p[2]), full: p[2] === 3 };
      }
      if (this.features[F.ADC]) {
        // Solaar decipher_adc_measurement: b0-1 mV big-endian, b2 flags: bit0 = valid, bit1 = recharging; HC reads the
        // same bytes (`08 0A` reply bytes 4-5 and 6). An invalid reading (headset connected but inactive) gives no percent.
        const p = await this.hidpp(F.ADC, 0x00);
        const mV = (p[0] << 8) | p[1];
        if (!(p[2] & 0x01)) return { percent: null, mV, charging: false };
        return { percent: adcPercent(mV), mV, charging: !!(p[2] & 0x02) };
      }
      return null;
    },

    async rawBackup() {
      return { pid: this.pid, centurion: this.centurion, bridge: this.bridge, direct: this.direct || undefined, frame: this.frame || undefined, features: Object.fromEntries(Object.entries(this.features).map(([id, f]) => [`0x${hex4(Number(id))}`, f])),
        caps: this.caps, values: await this.read(), autoOffBytes: this.centurion && this.caps.autoOff ? await this.readAutoOffBytes() : undefined };
    },
  };
  return adapter;
}

export default createLogitechHeadset();
