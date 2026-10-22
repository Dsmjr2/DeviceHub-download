// Logitech G mice over HID++ 2.0 (22 Oct 2026): on a Lightspeed / Bolt receiver or on their own USB cable.
// Written only from docs/brands/logitech.md (the "sheet"; every byte below cites its section or settings-map row).
// Not yet run on a real mouse: status "read-only" in device.json, so DeviceHub offers it and proves its writes first.
//
// HID LAYER (22 Oct 2026: what this driver needed from DeviceHub's HID layer now exists; docs/handoff/hid-core.md):
//   1. Several product ids: `hid.pids` registers one channel per receiver and wired mouse (helpers/my-devices.mjs
//      hidSpecs), and the agent's provider tries every filter in order. connect() asks for each pid in turn and reads
//      the opened pid from dev.pid / dev.productId to tell receiver from cable.
//   2. HID++ reply matching: `hid.reply: 'raw'` below. The helper writes each request (SEND) and hands every input
//      report back as it came (READ); HidChannel matches with isReplyTo, so an error reply (`<dev> FF <idx> <fn> <code>`)
//      is seen as one and a battery/DPI event arriving first is skipped instead of costing a timeout. `echo` is not used
//      on a raw channel. The one retry after no reply stays (a sleeping mouse).
//   3. The short-report collection (report 0x10, usage 0x0001) is still not opened: not blocking. `hid.routes`
//      ({ 0x10: { usage: '0001', len: 6 } }) could open it, but nothing here sends a short report, and a raw channel
//      reads only its own collection, so empty-slot errors from the receiver still read as "no reply".
//   Untested on a real receiver: whether Windows accepts the long collection's writes with the read kept by the helper.
//
// Not read, because the sheet does not document their bytes (section 4 and section 6: "0x0003 firmware and 0x0005
// name function codes were not pulled from a source"): the mouse's own name and firmware version, and the receiver's
// pairing table (wpid). info() names the model from the USB product id for a wired mouse instead.
//
// Safety (CLAUDE.md "Rules that are never broken"; sheet section 4 "Never touch"): every request goes through call(),
// which only sends the feature ids and function codes in ALLOWED. DFU (0x00C0-0x00C3, 0x00D0, 0x010A), reset (0x1802),
// OOB state (0x1805), force pairing (0x1500), receiver pairing registers and onboard-profile MEMORY (0x8100 functions
// 0x50/0x60/0x70/0x80) are not in it, so no code path can send them. Writes: DPI (0x2201 fn 0x30), report rate
// (0x8060 fn 0x20 / 0x8061 fn 0x30), the onboard/host switch (0x8100 fn 0x10), the active onboard profile (0x8100 fn 0x30)
// and DPI slot (0x8100 fn 0xC0), and lift-off (0x2202 fn 0x60, DPI rewritten as read), each read back. Writes are refused
// while G HUB runs (vendorApp()). DPI, rate and lift-off are
// only written in host mode (the sheet lists them as easy to undo "in host mode"); a mouse in onboard mode says so.
import { HidChannel, getDevice, hex } from '../../public/devices/hid.js';

const VID = 0x046d;
// sheet section 1 "Lightspeed receivers" (Solaar base_usb.py): Lightspeed and Bolt receivers, HID++ interface 2
// C541 / C545 / C547 are left out: the sheet (OpenRGB) names them G915 keyboard receivers
export const RECEIVERS = [0xc539, 0xc53a, 0xc53d, 0xc53f, 0xc54d, 0xc548];
// sheet section 1 "Mice": wired / USB product ids
export const WIRED = {
  0xc09b: 'PRO X SUPERLIGHT 2', 0xc094: 'PRO X SUPERLIGHT', 0xc09a: 'PRO 2 LIGHTSPEED', 0xc098: 'G502 X LIGHTSPEED',
  0xc095: 'G502 X PLUS', 0xc099: 'G502 X', 0xc088: 'G PRO Wireless', 0xc090: 'G703 HERO', 0xc091: 'G903 HERO',
  0xc08d: 'G502 LIGHTSPEED',
};
// Bluetooth (22 Oct 2026, docs/handoff/logitech-ble.md): a mouse on Bluetooth is its own HID device with its BLE product
// id, HID++ 2.0 straight to it at device index 0xFF. Empty on purpose: no source read lists a Bluetooth id for any mouse
// in WIRED (Solaar descriptors.py @ e7304c4c has btid only for MX / M-series mice; Linux hid-logitech-hidpp.c @
// 3fabd8ec lists none for a G mouse; OpenRGB lists none). Solaar treats 0xB012-0xB0FF as its Bluetooth mouse range
// (base.py get_unknown_logitech_device_info). A documented id for one of these models goes here, one line, and the
// transport below (BLE_HID, isReplyToBle, no report rate) applies to it.
export const BLE = {};
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// sheet section 2 "Transport": HID++ long = report 0x11, 20 bytes in all (19 after the report id); the long collection
// is usage page 0xFF00 usage 0x02 (OpenRGB: the one Windows accepts writes on)
const REPORT_LONG = 0x11, LEN = 19;
// sheet section 2 "Message format": low nibble of byte 3 = software id, non-zero; Solaar uses 0x0B
const SW_ID = 0x0b;
const DEV_WIRED = 0xff;                       // section 2 "Device index": 0xFF = a wired (or Bluetooth) device directly
const SLOTS = [1, 2, 3, 4, 5, 6];             // 0x01-0x06 = paired devices (Bolt holds 6; Lightspeed usually 1)

// feature ids (sheet section 3 settings map; section 2 for 0x0000 / 0x0001)
export const F = { ROOT: 0x0000, FEATURE_SET: 0x0001, BATTERY_STATUS: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, ADJUSTABLE_DPI: 0x2201, EXT_ADJUSTABLE_DPI: 0x2202, REPORT_RATE: 0x8060, EXT_REPORT_RATE: 0x8061, ONBOARD_PROFILES: 0x8100 };
// the only (feature, function) pairs call() will send. Function = byte 3's high nibble, written as fn << 4.
export const ALLOWED = {
  [F.ROOT]: [0x00, 0x10],                     // getFeature, ping (section 2 "Feature lookup")
  [F.FEATURE_SET]: [0x00, 0x10],              // count, feature at index (section 2 "IFeatureSet 0x0001")
  [F.BATTERY_STATUS]: [0x00],                 // "Battery (old)" row: status
  [F.BATTERY_VOLTAGE]: [0x00],                // "Battery voltage" row
  [F.UNIFIED_BATTERY]: [0x00, 0x10],          // "Battery (unified)" row: caps 0x00, status 0x10
  [F.ADJUSTABLE_DPI]: [0x00, 0x10, 0x20, 0x30], // "DPI" / "DPI list" rows: sensor count, list, get, set
  [F.REPORT_RATE]: [0x00, 0x10, 0x20],        // "Report rate" row: list, get, set
  [F.EXT_REPORT_RATE]: [0x10, 0x20, 0x30],    // "Report rate (8K)" row: list, get, set
  // "DPI X/Y + lift-off" row (Solaar settings_templates.py ExtendedAdjustableDpi, read_fnid 0x50 / write_fnid 0x60):
  // caps 0x10, read 0x50, write 0x60. The list function 0x20 is not sent (DPI stays on 0x2201).
  [F.EXT_ADJUSTABLE_DPI]: [0x10, 0x50, 0x60],
  // 0x8100: "Onboard / host mode" (0x10 set / 0x20 get), "Active profile" (0x30 set / 0x40 get), "DPI slot in profile"
  // (0xC0 set / 0xB0 get), and the info read 0x00 (section 4 "Safe reads": "0x8100 info (fn 0x00)"; layout from libratbag
  // hidpp20.h struct hidpp20_onboard_profiles_info). NEVER the memory functions 0x50 / 0x60 / 0x70 / 0x80 (flash).
  [F.ONBOARD_PROFILES]: [0x00, 0x10, 0x20, 0x30, 0x40, 0xb0, 0xc0],
};
// the memory functions of 0x8100 (sheet section 4 "Risky writes": they rewrite flash); call() refuses them even if they
// were ever added to ALLOWED by mistake
export const NEVER_FN = { [F.ONBOARD_PROFILES]: [0x50, 0x60, 0x70, 0x80] };
// sheet section 4 "Never touch": refused even if someone adds them to ALLOWED by mistake
// + Solaar hidpp20_constants.py BLE_PRO_PRE_PAIRING 0x1816 and LIGHTSPEED_PAIRING 0x0309 (as the keyboard and headset
// drivers; added 22 Oct 2026 with Bluetooth, where 0x1816 is reachable on the device itself)
export const NEVER = [0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00d0, 0x010a, 0x1802, 0x1805, 0x1500, 0x1816, 0x0309];

// sheet section 2 "Errors", HID++ 2.0 codes
const ERRORS = { 1: 'unknown', 2: 'invalid argument', 3: 'out of range', 4: 'hardware error', 5: 'not allowed', 6: 'invalid feature index', 7: 'invalid function', 8: 'busy', 9: 'unsupported' };
export class HidppError extends Error {
  constructor(code, what) { super(`${what}: the mouse refused it (HID++ error 0x${code.toString(16).padStart(2, '0')} ${ERRORS[code] || 'unknown code'})`); this.code = code; }
}

// a reply answers the request when it echoes device index, feature index and function+software id (section 2
// "Replies"), or is an error reply for it: <dev> FF <feature idx> <fn+swid> <code> (section 2 "Errors")
export const isReplyTo = (sent, r) => r[0] === sent[0] && ((r[1] === sent[1] && r[2] === sent[2]) || (r[1] === 0xff && r[2] === sent[1] && r[3] === sent[2]));
// Bluetooth: the device index may come back as request ^ 0xFF, 0x00 for 0xFF (Solaar base.py request() / ping():
// "reply_devnumber == devnumber or reply_devnumber == devnumber ^ 0xFF:  # BT device returning 0x00")
export const isReplyToBle = (sent, r) => (r[0] === sent[0] || r[0] === (sent[0] ^ 0xff)) && ((r[1] === sent[1] && r[2] === sent[2]) || (r[1] === 0xff && r[2] === sent[1] && r[3] === sent[2]));
// Bluetooth collection: Solaar finds HID++ by its reports (hidapi_impl.py check_hidpp_long: input report 0x11 of 1 + 19
// bytes), not a usage page; OpenRGB LogitechControllerDetect.cpp @ a44f5250 registers Bluetooth HID++ 2.0 on 0xFF43 (any
// usage) and on 0xFF00 usage 2 ("mice, the collection Solaar drives them on"). So any page / usage, chosen by 19-byte
// input and output reports (helpers/hid-host.mjs channelOpts il / ol).
export const BLE_HID = { page: '*', usage: '*', inputLen: LEN, outputLen: LEN };

// 0x8061 index -> Hz (settings map "Report rate (8K)": 0=8 ms, 1=4 ms, 2=2 ms, 3=1 ms, 4=500 us, 5=250 us, 6=125 us)
export const EXT_RATES_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];
const hzOfMs = (ms) => Math.round(1000 / ms);

// "DPI X/Y + lift-off" row: LOD 0 low, 1 medium, 2 high (Solaar ExtendedAdjustableDpi LOD choices LOW=0, MEDIUM=1, HIGH=2)
export const LOD = ['low', 'medium', 'high'];
// "DPI slot in profile" row: 0-4 (libratbag hidpp20_onboard_profiles_set_current_dpi_index refuses index > 4)
export const DPI_SLOTS = 5;
// "Active profile" row + section 1: the G502 X family reads its active profile 1-based (libratbag HIDPP20_QUIRK_INDEX_OFFSET,
// "devices that return 1-indexed profile"); every mouse is SET 1-based (libratbag set_current_profile sends index + 1)
export const PROFILE_READ_1BASED = [0xc098, 0xc095, 0xc099];
// G HUB (sheet section 5 "Windows note": lghub_agent.exe holds the same HID++ collection; writing beside it fights)
export const VENDOR_APPS = /^lghub(_agent|_system_tray|_updater)?\.exe$/i;

const settings = [
  // range and step are replaced by the mouse's own list at connect (0x2201 fn 0x10); these only satisfy the loader
  { key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 25600, step: 50, unit: 'DPI', hint: 'Range from the mouse itself.' },
  { key: 'reportRate', label: 'Report rate', type: 'choice', options: [{ value: 1000, label: '1000 Hz' }], hint: 'Only the rates the mouse lists.' },
  // sheet section 4 "Risky writes": the host switch's own warning, as the label says. The library self-check writes
  // only the mode it just read (onboard stays onboard, host stays host), so it never switches the mouse.
  { key: 'mode', label: 'Settings source', type: 'choice', hint: 'Host mode: settings stop persisting; the mouse falls back to onboard on re-plug, so its own stored settings come back.',
    options: [{ value: 'onboard', label: 'Onboard (the profiles stored in the mouse)' }, { value: 'host', label: 'Host (DeviceHub sets them live; not kept on re-plug)' }] },
  // only reported (and so only shown) when the mouse has 0x2202 with its LOD capability bit
  { key: 'liftOff', label: 'Lift-off distance', type: 'choice', hint: 'Host mode only, like DPI.',
    options: LOD.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
  // onboard profiles: which stored profile is in use (select only; the profiles themselves are never written).
  // Options are replaced by the mouse's own profile count at connect.
  { key: 'profile', label: 'Onboard profile', type: 'choice', hint: 'Picks one of the profiles stored in the mouse; nothing in them is changed.',
    options: [{ value: 1, label: 'Profile 1' }] },
  // which of the profile's DPI slots is in use (what the mouse's DPI button steps through). The DPI of each slot lives
  // in profile memory and is not read or written here.
  { key: 'dpiStage', label: 'DPI stage', type: 'choice', hint: 'One of the 5 DPI slots of the active onboard profile.',
    options: Array.from({ length: DPI_SLOTS }, (_, i) => ({ value: i + 1, label: `Stage ${i + 1}` })) },
];

let injected = null;
// tests (tests/sim-logitech.mjs): hand the driver a device object instead of opening one
export function useDevice(dev) { injected = dev; }

const adapter = {
  id: 'logitech-hidpp-mouse',
  title: 'Logitech mouse',
  kind: 'Mouse',
  vendor: 'Logitech',
  // one channel per pid (HID LAYER 1); usage 0002 = the long-report collection
  hid: { vid: '046D', pid: 'C539', pids: [...RECEIVERS, ...Object.keys(WIRED).map(Number), ...Object.keys(BLE).map(Number)].map(hex4), page: 'FF00', usage: '0002', len: LEN, reportId: REPORT_LONG,
    replyMs: 2000,        // Solaar waits up to 4 s for a device (section 2 "Replies"); below this driver's own 2.6 s
    reply: 'raw',         // HID LAYER 2: every input report reaches isReplyTo
    // Bluetooth ids choose their collection by report length (BLE_HID); every USB id's channel is as before
    byPid: Object.fromEntries(Object.keys(BLE).map((p) => [hex4(Number(p)), { ...BLE_HID }])) },
  settings,
  unsupported: ['editing onboard profiles (buttons, the DPI of each slot, sleep timer, lights)', 'lighting', 'button remapping', 'angle snapping', 'surface tuning', 'firmware updates', 'pairing'],

  // the vendor-app check (replaceable in tests): resolves with the running G HUB process name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
    return null;
  },

  dev: null, chan: null, index: DEV_WIRED, features: {}, caps: {},

  async connect(prompt) {
    this.dev = null; this.features = {}; this.caps = {}; this.profileReadBase = undefined;
    let dev = injected;
    if (!dev) {
      for (const pid of [...RECEIVERS, ...Object.keys(WIRED).map(Number)]) {
        dev = await getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }], { prompt: false });
        if (dev) break;
      }
      // Bluetooth: no usage page in the filter (BLE_HID picks the collection)
      for (const pid of Object.keys(BLE).map(Number)) { if (dev) break; dev = await getDevice([{ vendorId: VID, productId: pid }], { prompt: false }); }
      if (!dev && prompt) dev = await getDevice(RECEIVERS.concat(Object.keys(WIRED).map(Number)).map((p) => ({ vendorId: VID, productId: p, usagePage: 0xff00, usage: 0x0002 })));
    }
    if (!dev) return false;
    if (!dev.opened) await dev.open();
    this.dev = dev;
    this.pid = typeof dev.pid === 'string' ? parseInt(dev.pid, 16) : dev.productId;
    // sheet section 5 step 2: 0xC500-0xC5FF = receiver, anything else = a direct device at index 0xFF
    this.receiver = this.pid >= 0xc500 && this.pid <= 0xc5ff;
    this.ble = !!BLE[this.pid];
    this.chan = new HidChannel(dev, { reportId: REPORT_LONG, length: LEN, match: this.ble ? isReplyToBle : isReplyTo });
    // receiver: ping slots 1-6 and take the first that answers (section 5 step 3); wired: index 0xFF
    let ver = null;
    for (const idx of this.receiver ? SLOTS : [DEV_WIRED]) {
      this.index = idx;
      try { ver = await this.ping(); break; } catch (e) { if (e instanceof HidppError) throw e; }
    }
    if (!ver) throw new Error(this.receiver ? 'no reply from a mouse on the receiver (asleep, switched off or not paired)' : 'no reply from the mouse');
    this.protocol = ver;
    // feature lookup through IRoot getFeature (section 2), cached per connect (indexes change between models/firmware)
    // Bluetooth: the report rate is the USB / Lightspeed polling rate; over Bluetooth the link sets it and no source
    // documents 0x8060 / 0x8061 there, so it is not looked up (and so not read, offered or written)
    const rateIds = this.ble ? [] : [F.EXT_REPORT_RATE, F.REPORT_RATE];
    for (const id of [F.FEATURE_SET, F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.BATTERY_VOLTAGE, F.ADJUSTABLE_DPI, F.EXT_ADJUSTABLE_DPI, ...rateIds, F.ONBOARD_PROFILES]) {
      const f = await this.getFeature(id);
      if (f) this.features[id] = f;
    }
    // a receiver also runs keyboards (0xC541/0xC547/0xC545 are G915 receivers, section 1): no DPI feature = not a mouse
    if (!this.features[F.ADJUSTABLE_DPI]) throw new Error('this Logitech device has no DPI feature (0x2201): it is not a mouse this driver runs');
    await this.readCaps();
    return true;
  },

  // one HID++ 2.0 request: [dev, feature index, fn | swid, params...] (section 2 "Message format"); returns the 16
  // parameter bytes of the reply. Only ALLOWED pairs are sent. A read is retried once after no reply (a sleeping mouse).
  async call(featureId, fn, params = [], { retry = true } = {}) {
    if (NEVER.includes(featureId) || (NEVER_FN[featureId] || []).includes(fn) || !(ALLOWED[featureId] || []).includes(fn)) throw new Error(`refused: feature 0x${hex4(featureId)} function 0x${fn.toString(16)} is not one this driver sends`);
    const index = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
    if (!index && featureId !== F.ROOT) throw new Error(`the mouse has no feature 0x${hex4(featureId)}`);
    const out = [this.index, index, (fn & 0xf0) | SW_ID, ...params];
    const what = `0x${hex4(featureId)} fn 0x${fn.toString(16).padStart(2, '0')}`;
    let r;
    try { r = await this.chan.request(out, { timeoutMs: 2600 }); }
    catch (e) { if (!retry || /refused/.test(e.message)) throw e; r = await this.chan.request(out, { timeoutMs: 2600 }); }
    if (r[1] === 0xff && r[2] === index && r[3] === out[2]) throw new HidppError(r[4], what);
    return r.slice(3, 19);
  },

  // IRoot ping, function 0x10, params 00 00 <mark>: reply b0 major, b1 minor, b2 the mark (section 2)
  async ping() {
    const mark = 0x5a;
    const p = await this.call(F.ROOT, 0x10, [0x00, 0x00, mark], { retry: false });
    if (p[2] !== mark) throw new Error('the ping came back without its mark');
    return `${p[0]}.${p[1]}`;
  },
  // IRoot getFeature, function 0x00, params = feature id big-endian: reply b0 index (0 = absent), b1 flags, b2 version
  async getFeature(id) {
    if (NEVER.includes(id)) return null;
    const p = await this.call(F.ROOT, 0x00, [id >> 8, id & 0xff]);
    return p[0] ? { index: p[0], flags: p[1], version: p[2] } : null;
  },

  // what the mouse can do: DPI list/range, rate list, battery caps; fills the settings list from it
  async readCaps() {
    // "DPI list" row: 0x2201 fn 0x10 [sensor]; 2-byte entries from b1 until 0x0000; >= 0xE000 = range, step = v & 0x1FFF,
    // next entry = max (the entry before it = min)
    const p = await this.call(F.ADJUSTABLE_DPI, 0x10, [0]);
    const raw = [];
    for (let i = 1; i + 1 < p.length; i += 2) { const v = (p[i] << 8) | p[i + 1]; if (!v) break; raw.push(v); }
    const list = [];
    let range = null;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] >= 0xe000) { range = { min: list[list.length - 1], step: raw[i] & 0x1fff, max: raw[i + 1] }; list.push(raw[i + 1]); i++; }
      else list.push(raw[i]);
    }
    if (!list.length || (range && !(range.min > 0 && range.step > 0 && range.max > range.min))) throw new Error(`the mouse's DPI list did not read cleanly (${hex(p)})`);
    this.caps.dpi = range ? { ...range } : { list };
    const s = settings.find((x) => x.key === 'dpi');
    if (range) Object.assign(s, { type: 'slider', min: range.min, max: range.max, step: range.step }), delete s.options;
    else Object.assign(s, { type: 'choice', options: list.map((v) => ({ value: v, label: `${v} DPI` })) });

    // report rate: 0x8061 when present (8K mice), else 0x8060
    if (this.features[F.EXT_REPORT_RATE]) {
      // "Report rate (8K)" row: list fn 0x10, bits 0-6 of 2 bytes (big-endian, section 2), bit i = index i
      const q = await this.call(F.EXT_REPORT_RATE, 0x10);
      const mask = (q[0] << 8) | q[1];
      this.caps.rate = { ext: true, hz: EXT_RATES_HZ.filter((_, i) => mask & (1 << i)) };
    } else if (this.features[F.REPORT_RATE]) {
      // "Report rate" row: list fn 0x00, b0 bitmask, bit i = (i+1) ms
      const q = await this.call(F.REPORT_RATE, 0x00);
      const ms = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => q[0] & (1 << i)).map((i) => i + 1);
      this.caps.rate = { ext: false, ms, hz: ms.map(hzOfMs) };
    }
    if (this.caps.rate) settings.find((x) => x.key === 'reportRate').options = [...this.caps.rate.hz].sort((a, b) => a - b).map((hz) => ({ value: hz, label: `${hz} Hz` }));

    // "Battery (unified)" row: caps fn 0x00, b1 bit1 = reports a percentage
    if (this.features[F.UNIFIED_BATTERY]) { const c = await this.call(F.UNIFIED_BATTERY, 0x00); this.caps.batteryPercent = !!(c[1] & 0x02); }

    // "DPI X/Y + lift-off" row: 0x2202 caps fn 0x10 [00] -> b2 bit0 = separate Y, bit1 = LOD
    // (Solaar ExtendedAdjustableDpi: reply[2] & 0x01 = y, reply[2] & 0x02 = lod)
    if (this.features[F.EXT_ADJUSTABLE_DPI]) {
      const c = await this.call(F.EXT_ADJUSTABLE_DPI, 0x10, [0]).catch((e) => { if (e instanceof HidppError) return null; throw e; });
      if (c) this.caps.ext = { separateY: !!(c[2] & 0x01), lod: !!(c[2] & 0x02) };
    }
    // onboard profiles info: 0x8100 fn 0x00, b3 = profile_count (libratbag hidpp20.h struct hidpp20_onboard_profiles_info:
    // memory_model_id, profile_format_id, macro_format_id, profile_count, ...)
    if (this.features[F.ONBOARD_PROFILES]) {
      // a refusal leaves profile select out (it is never guessed); the mode switch still works
      const c = (await this.call(F.ONBOARD_PROFILES, 0x00).catch((e) => { if (e instanceof HidppError) return null; throw e; })) || [];
      if (c[3] >= 1 && c[3] <= 16) {
        this.caps.profiles = c[3];
        settings.find((x) => x.key === 'profile').options = Array.from({ length: c[3] }, (_, i) => ({ value: i + 1, label: `Profile ${i + 1}` }));
      }
      if (PROFILE_READ_1BASED.includes(this.pid)) this.profileReadBase = 1;
    }
  },

  // 0x2202 fn 0x50 [00] -> b1-2 X, b5-6 Y, b9 LOD (Solaar ExtendedAdjustableDpi validate_read)
  async readExt() {
    const p = await this.call(F.EXT_ADJUSTABLE_DPI, 0x50, [0]);
    return { x: (p[1] << 8) | p[2], y: (p[5] << 8) | p[6], lod: p[9] };
  },
  async readLiftOff() {
    if (!this.caps.ext?.lod) return undefined;
    return LOD[(await this.readExt()).lod];
  },
  // "Active profile" row: 0x8100 fn 0x40 -> 2 bytes; libratbag get_current_profile takes b1. What the number means depends
  // on the model (PROFILE_READ_1BASED above). For a mouse the sources do not name (any mouse on a receiver, Superlight 2,
  // PRO 2, and the wired mice libratbag lists without the quirk, since Solaar reads the same 2 bytes it writes) it is
  // learnt from the reading itself: 0 can only be 0-based, the profile count can only be 1-based. Until then the
  // profile is not reported, so it is neither shown nor written.
  async readProfile() {
    if (!this.caps.profiles) return undefined;
    const p = await this.call(F.ONBOARD_PROFILES, 0x40);
    const r = p[1];
    if (this.profileReadBase === undefined) { if (r === 0) this.profileReadBase = 0; else if (r === this.caps.profiles) this.profileReadBase = 1; }
    if (this.profileReadBase === undefined) return undefined;
    const n = this.profileReadBase === 1 ? r : r + 1;
    return n >= 1 && n <= this.caps.profiles ? n : undefined;
  },
  // "DPI slot in profile" row: 0x8100 fn 0xB0 -> b0 slot 0-4 (libratbag get_current_dpi_index returns parameters[0])
  async readDpiStage() {
    if (!this.caps.profiles) return undefined;   // only once the onboard-profiles info read answered
    const p = await this.call(F.ONBOARD_PROFILES, 0xb0);
    return p[0] < DPI_SLOTS ? p[0] + 1 : undefined;
  },

  async readDpi() {
    // "DPI" row: 0x2201 fn 0x20 [sensor] -> b1-2 current DPI, b3-4 default DPI
    const p = await this.call(F.ADJUSTABLE_DPI, 0x20, [0]);
    return { dpi: (p[1] << 8) | p[2], defaultDpi: (p[3] << 8) | p[4] };
  },
  async readRate() {
    if (!this.caps.rate) return undefined;
    if (this.caps.rate.ext) { const p = await this.call(F.EXT_REPORT_RATE, 0x20); return EXT_RATES_HZ[p[0]]; }   // b0 = index
    const p = await this.call(F.REPORT_RATE, 0x10);                                                         // b0 = ms
    return p[0] ? hzOfMs(p[0]) : undefined;
  },
  async readMode() {
    if (!this.features[F.ONBOARD_PROFILES]) return undefined;
    // "Onboard / host mode" row: 0x8100 fn 0x20, 1 byte: 01 onboard, 02 host
    const p = await this.call(F.ONBOARD_PROFILES, 0x20);
    return p[0] === 1 ? 'onboard' : p[0] === 2 ? 'host' : `unknown (${p[0]})`;
  },

  async info() {
    const bat = this.features[F.UNIFIED_BATTERY] ? '0x1004 unified' : this.features[F.BATTERY_STATUS] ? '0x1000 status' : this.features[F.BATTERY_VOLTAGE] ? '0x1001 voltage' : 'none reported';
    const mode = await this.readMode().catch(() => undefined);
    const out = {
      Model: this.receiver ? `Logitech mouse on receiver ${hex4(this.pid)} (slot ${this.index})` : (WIRED[this.pid] || BLE[this.pid] ? `Logitech ${WIRED[this.pid] || BLE[this.pid]}` : `Logitech mouse ${hex4(this.pid)}`),
      Connection: this.receiver ? (this.pid === 0xc548 ? 'Bolt receiver' : 'Lightspeed receiver') : this.ble ? 'Bluetooth' : 'USB cable',
      'HID++': this.protocol,
      Battery: bat,
      'Report rate feature': this.features[F.EXT_REPORT_RATE] ? '0x8061 (up to 8000 Hz)' : this.features[F.REPORT_RATE] ? '0x8060' : 'none',
    };
    if (mode) out['Settings source'] = mode === 'onboard' ? 'onboard profiles (DPI and rate changes need host mode)' : mode;
    if (this.caps.profiles) out['Onboard profiles'] = String(this.caps.profiles);
    if (this.caps.ext) out['Lift-off'] = this.caps.ext.lod ? 'low / medium / high (0x2202)' : 'not adjustable';
    if (this.caps.dpi) out['DPI range'] = this.caps.dpi.list ? this.caps.dpi.list.join(', ') : `${this.caps.dpi.min}-${this.caps.dpi.max} in steps of ${this.caps.dpi.step}`;
    return out;
  },

  async read() {
    const v = {};
    v.dpi = (await this.readDpi()).dpi;
    const rate = await this.readRate();
    if (rate !== undefined) v.reportRate = rate;
    const mode = await this.readMode();
    if (mode === 'onboard' || mode === 'host') v.mode = mode;
    const lod = await this.readLiftOff();
    if (lod !== undefined) v.liftOff = lod;
    const prof = await this.readProfile();
    if (prof !== undefined) v.profile = prof;
    const stage = await this.readDpiStage();
    if (stage !== undefined) v.dpiStage = stage;
    return v;
  },

  // one setting, then read back; a read-back that differs throws (CLAUDE.md: reported as failed)
  async write(key, value) {
    if (!this.chan) throw new Error('the mouse is not connected');
    if (!settings.some((s) => s.key === key)) throw new Error(`${key} is not a setting`);
    // waiting: true = refused only because of how things are right now (helpers/my-devices.mjs isWaiting): the library
    // self-check records it as waiting and tries again later, instead of failing it
    const app = await this.vendorApp();
    if (app) throw Object.assign(new Error(`${app} (G HUB) is running: close it first (two programs writing the mouse fight)`), { waiting: true });
    let back;
    if (key === 'dpi' || key === 'reportRate' || key === 'liftOff') {
      const mode = await this.readMode();
      if (mode === 'onboard') throw Object.assign(new Error('the mouse is using its onboard profiles: set Settings source to Host first (DPI, report rate and lift-off are only changed live in host mode)'), { waiting: true });
    }
    if (key === 'dpi') {
      const c = this.caps.dpi;
      const ok = Number.isInteger(value) && (c.list ? c.list.includes(value) : value >= c.min && value <= c.max && (value - c.min) % c.step === 0);
      if (!ok) throw new Error(c.list ? `DPI must be one of ${c.list.join(', ')}` : `DPI must be ${c.min}-${c.max} in steps of ${c.step}`);
      // "DPI" row: write 0x2201 fn 0x30 [sensor, dpi_hi, dpi_lo]
      await this.call(F.ADJUSTABLE_DPI, 0x30, [0, value >> 8, value & 0xff], { retry: false });
      back = (await this.readDpi()).dpi;
    } else if (key === 'reportRate') {
      const r = this.caps.rate;
      if (!r || !r.hz.includes(value)) throw new Error(`report rate must be one of ${(r?.hz || []).join(', ')} Hz`);
      if (r.ext) await this.call(F.EXT_REPORT_RATE, 0x30, [EXT_RATES_HZ.indexOf(value)], { retry: false });   // write [index]
      else await this.call(F.REPORT_RATE, 0x20, [r.ms[r.hz.indexOf(value)]], { retry: false });                // write [ms]
      back = await this.readRate();
    } else if (key === 'mode') {
      if (!this.features[F.ONBOARD_PROFILES]) throw new Error('this mouse has no onboard profiles to switch');
      if (value !== 'onboard' && value !== 'host') throw new Error('Settings source must be onboard or host');
      // "Onboard / host mode" row: write 0x8100 fn 0x10 [01 onboard / 02 host]. Nothing else of 0x8100 is ever written.
      await this.call(F.ONBOARD_PROFILES, 0x10, [value === 'onboard' ? 1 : 2], { retry: false });
      back = await this.readMode();
    } else if (key === 'liftOff') {
      if (!this.caps.ext?.lod) throw new Error('this mouse does not report a lift-off setting (0x2202 LOD)');
      if (!LOD.includes(value)) throw new Error(`lift-off must be one of ${LOD.join(', ')}`);
      // "DPI X/Y + lift-off" row: write 0x2202 fn 0x60 [00, X(2), Y(2), LOD]; X and Y are the values just read, so only
      // LOD changes (Solaar prepare_write: Y = 00 00 when the mouse has no separate Y)
      const cur = await this.readExt();
      if (!cur.x) throw new Error('the mouse did not report its DPI on 0x2202, so lift-off was not written');
      const y = this.caps.ext.separateY ? cur.y : 0;
      await this.call(F.EXT_ADJUSTABLE_DPI, 0x60, [0, cur.x >> 8, cur.x & 0xff, y >> 8, y & 0xff, LOD.indexOf(value)], { retry: false });
      const after = await this.readExt();
      if (after.x !== cur.x) throw new Error(`lift-off: the DPI moved from ${cur.x} to ${after.x}`);
      back = LOD[after.lod];
    } else if (key === 'profile') {
      if (!this.caps.profiles) throw new Error('this mouse did not report its onboard profiles');
      if (this.profileReadBase === undefined) throw new Error('how this mouse numbers its profiles is not known yet, so the profile is read-only');
      if (!Number.isInteger(value) || value < 1 || value > this.caps.profiles) throw new Error(`profile must be 1-${this.caps.profiles}`);
      // "Active profile" row: write 0x8100 fn 0x30 [00, index]; libratbag set_current_profile sends parameters[1] = index + 1,
      // i.e. the profile's 1-based number
      await this.call(F.ONBOARD_PROFILES, 0x30, [0, value], { retry: false });
      back = await this.readProfile();
    } else if (key === 'dpiStage') {
      if (!this.caps.profiles) throw new Error('this mouse did not report its onboard profiles');
      if (!Number.isInteger(value) || value < 1 || value > DPI_SLOTS) throw new Error(`DPI stage must be 1-${DPI_SLOTS}`);
      // "DPI slot in profile" row: write 0x8100 fn 0xC0 [index 0-4] (libratbag set_current_dpi_index: parameters[0] = index)
      await this.call(F.ONBOARD_PROFILES, 0xc0, [value - 1], { retry: false });
      back = await this.readDpiStage();
    }
    if (back !== value) throw new Error(`${key}: wrote ${value} but the mouse reads back ${back}`);
    return back;
  },

  async battery() {
    if (this.features[F.UNIFIED_BATTERY]) {
      // "Battery (unified)" row: fn 0x10 -> b0 %, b1 level bits (1 critical, 2 low, 4 good, 8 full), b2 charging
      // 0 discharging / 1 charging / 2 slow / 3 complete / 4 error, b3 external power
      const p = await this.call(F.UNIFIED_BATTERY, 0x10);
      const level = p[1] & 8 ? 'full' : p[1] & 4 ? 'good' : p[1] & 2 ? 'low' : p[1] & 1 ? 'critical' : null;
      return { percent: this.caps.batteryPercent ? p[0] : null, level, charging: p[2] === 1 || p[2] === 2, full: p[2] === 3, external: !!p[3] };
    }
    if (this.features[F.BATTERY_STATUS]) {
      // "Battery (old)" row: fn 0x00 -> b0 level %, b1 next level, b2 status 0 discharging, 1 recharging,
      // 2 final stage, 3 full, 4 slow recharge, 5-7 errors
      const p = await this.call(F.BATTERY_STATUS, 0x00);
      return { percent: p[0], charging: [1, 2, 4].includes(p[2]), full: p[2] === 3 };
    }
    if (this.features[F.BATTERY_VOLTAGE]) {
      // "Battery voltage" row: fn 0x00 -> b0-1 mV, b2 flags, bit7 = charging; % needs a per-model curve the sheet lacks
      const p = await this.call(F.BATTERY_VOLTAGE, 0x00);
      return { percent: null, mV: (p[0] << 8) | p[1], charging: !!(p[2] & 0x80) };
    }
    return null;
  },

  // everything read, for DeviceHub's backup before a write
  async rawBackup() {
    const dpi = await this.readDpi();
    return {
      pid: hex4(this.pid), index: this.index, protocol: this.protocol,
      features: Object.fromEntries(Object.entries(this.features).map(([id, f]) => [`0x${hex4(Number(id))}`, f])),
      caps: this.caps, ...dpi, reportRate: await this.readRate(), mode: await this.readMode(),
      ext: this.caps.ext ? await this.readExt() : undefined, profile: await this.readProfile(), dpiStage: await this.readDpiStage(),
    };
  },
};

export default adapter;
