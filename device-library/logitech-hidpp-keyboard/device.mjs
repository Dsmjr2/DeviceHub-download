// Logitech G keyboards over HID++ 2.0 (22 Oct 2026): on their own cable or a Lightspeed receiver (G915 / G915 TKL /
// G815 / G813 / G515 TKL / G512 / G213 / PRO), and the G915 TKL on Bluetooth (BLE below; docs/handoff/logitech-ble.md).
// Written only from open-source code, cited beside every command:
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
// C547: OpenRGB LogitechControllerDetect.cpp names it the G915's second receiver (docs/brands/logitech.md section 1,
// "G915 | 0xC33E | 0xC541, 0xC547"). Added 22 Oct 2026 (docs/handoff/driver-safety.md). Recent Lightspeed mice may ship
// on it too (the sheet's open question); a mouse on it is refused by its 0x2201 feature, as on C541 / C545.
// SHARED (23 Oct 2026): the LIGHTSPEED receivers C539, C53F and C54D (Solaar base_usb.py @ e7304c4c lines 171-178 and
// 200-207: _lightspeed_receiver, HID++ on interface 2) are not tied to one kind of device by any source (sheet section
// "Receiver slots"), so a keyboard paired to one (PRO X TKL, G515 TKL: no source gives their receiver id) would only ever
// be met by the mouse driver, which steps aside from it. They are also in device-library/logitech-hidpp-mouse RECEIVERS.
// On these three the two drivers share one HID handle (helpers/hid-host.mjs provider() hands both the first host for the
// vid / pid / usage page, and the native channel name is the same), so on a SHARED receiver this driver:
//   - claims a slot only when its device has neither DPI feature (0x2201, 0x2202) AND DEVICE_NAME fn 0x20 says
//     keyboard or numpad (an unknown kind is never claimed here);
//   - uses its own HID++ software id 0x0C (Solaar base.py @ e7304c4c lines 897-911: the software id is echoed in each
//     reply and "cooperative userspace HID++ clients sharing the same device can pick a different value"; 0x0B is
//     Solaar's and the mouse driver's, 0x07 OpenRGB, 0x0A LGSTrayEx, 0x0D G HUB, 0x0F firmware), so neither driver can
//     take the other's reply;
//   - never closes the receiver when it steps aside (the mouse driver may be using the same handle), and
//   - never waits "asleep" on it: no keyboard answering = stepped aside quietly (notMine), looked at again on a plug, a
//     Connect click or after the rest, so a mouse-only receiver never shows a keyboard tile.
export const SHARED = { 0xc539: 'LIGHTSPEED receiver', 0xc53f: 'LIGHTSPEED receiver', 0xc54d: 'LIGHTSPEED receiver' };
export const RECEIVERS = { 0xc541: 'G915 receiver', 0xc547: 'G915 receiver', 0xc545: 'G915 TKL receiver', ...SHARED };
// G413 C33A (23 Oct 2026): libratbag data/devices/logitech-g413.device @ 8235b5bb6032dea15901ab58a8218956f4494d08
// ("DeviceMatch=usb:046d:c33a", "DeviceType=keyboard", "Driver=hidpp20"); MatMoul/g810-led src/classes/Keyboard.h
// @ efa3c35e74f01a2ed2346320da8bad411bfe8ed8 ("{ 0x46d, 0xc33a, ... g413 }") sends it HID++ long reports 0x11 to device
// 0xFF on USB interface 1 (Keyboard.cpp libusb_claim_interface(..., 1)), as for the G213 / G512 here. Its features are
// looked up like every other model's, so it shows only what it answers for.
export const WIRED = { 0xc33e: 'G915', 0xc343: 'G915 TKL', 0xc33f: 'G815', 0xc355: 'G515 LIGHTSPEED TKL', 0xc33c: 'G512', 0xc336: 'G213', 0xc339: 'PRO Gaming Keyboard', 0xc232: 'G813', 0xc33a: 'G413' };
// The G813 (22 Oct 2026, Dsmjr2/DeviceHub-support#6; docs/handoff/friend-lights-c232.md): OpenRGB
// Controllers/LogitechController/LogitechControllerDetect.cpp @ bbc77470a7cba56af60989e54ba910d5ac66a3ac line 58
// "#define LOGITECH_G813_PID 0xC232" and line 1531 'REGISTER_HID_DETECTOR_IP ("Logitech G813 RGB Mechanical Gaming
// Keyboard", DetectLogitechKeyboardG815, LOGITECH_VID, LOGITECH_G813_PID, 1, 0xFF43)': the G815's own detector, on USB
// interface 1, usage page 0xFF43. Its comment (lines 163-166): "Usage 0x0602 for 20 byte, usage 0x0604 for 64 byte, both
// are on usage page 0xFF43"; LogitechG815Controller.cpp sends 20-byte HID++ 2.0 long reports there (0x11, device 0xFF).
// So it is opened on interface 1, page FF43 usage 0602 (not FF00 / 0002), with the same HID++ 2.0 feature lookup.
// Solaar (descriptors.py), Linux hid-ids.h and libratbag do not list 0xC232 (read 22 Oct 2026).
// A G813 whose PC shows only its typing interface (page 0001 usage 0006, no interface 1) cannot be reached by any app.
export const FF43 = { 0xc232: { iface: 1, page: 'FF43', usage: '0602' } };
// Bluetooth (22 Oct 2026, docs/handoff/logitech-ble.md): the keyboard is its own HID device with the keyboard's BLE
// product id, HID++ 2.0 straight to it at device index 0xFF (no receiver, no slots).
//   0xB35F: Linux drivers/hid/hid-logitech-hidpp.c @ 3fabd8ec206bd48a45ef77aed170d25b322ad9a2, hidpp_devices:
//           "Logitech G915 TKL keyboard over Bluetooth" HID_BLUETOOTH_DEVICE(USB_VENDOR_ID_LOGITECH, 0xb35f).
//           It is inside Solaar's Bluetooth keyboard range (base.py get_unknown_logitech_device_info: BusID.BLUETOOTH and
//           0xB317 <= product_id <= 0xB3FF, @ e7304c4c). Solaar descriptors.py lists no btid for any G keyboard.
//   0xB389 (23 Oct 2026): the G515 LIGHTSPEED TKL. Solaar docs/devices/"G515 LS TKL 40B4.text" @ e7304c4c (a device dump):
//           "Kind: keyboard", "Protocol: HID++ 4.2", "Transport IDs: {'btleid': 'B389', 'wpid': '40B4', 'usbid': 'C355'}";
//           inside the same Bluetooth keyboard range.
//   No source read gives a Bluetooth id for the G915 or any other model here, so none is guessed.
export const BLE = { 0xb35f: 'G915 TKL', 0xb389: 'G515 LIGHTSPEED TKL' };
export const PIDS = [...Object.keys(RECEIVERS), ...Object.keys(WIRED), ...Object.keys(BLE)].map(Number);

// sheet section 2: long report 0x11, 19 bytes after the id; software id 0x0B (Solaar); 0xFF = wired, 1-6 = receiver slots
const REPORT_LONG = 0x11, LEN = 19, SW_ID = 0x0b, DEV_WIRED = 0xff, SLOTS = [1, 2, 3, 4, 5, 6];
// on a SHARED receiver: this driver's own software id (see SHARED above)
export const SW_ID_SHARED = 0x0c;

// feature ids (Solaar hidpp20_constants.py SupportedFeature)
export const F = {
  ROOT: 0x0000, DEVICE_NAME: 0x0005, BATTERY_STATUS: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, ADJUSTABLE_DPI: 0x2201, EXT_ADJUSTABLE_DPI: 0x2202,
  FN_INVERSION: 0x40a0, NEW_FN_INVERSION: 0x40a2, DISABLE_KEYS: 0x4521, BRIGHTNESS: 0x8040, REPORT_RATE: 0x8060,
  EXT_REPORT_RATE: 0x8061, ONBOARD_PROFILES: 0x8100,
};
// the only (feature, function) pairs call() sends; function = byte 3's high nibble, written as fn << 4
export const ALLOWED = {
  [F.ROOT]: [0x00, 0x10],                 // getFeature, ping (sheet section 2 "Feature lookup")
  [F.DEVICE_NAME]: [0x20],                // device kind only: Solaar hidpp20.py get_kind() (DEVICE_NAME fn 0x20, byte 0)
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
// Bluetooth: the same, but the device index may come back as request ^ 0xFF, i.e. 0x00 for 0xFF (Solaar base.py request()
// and ping(): "reply_devnumber == devnumber or reply_devnumber == devnumber ^ 0xFF:  # BT device returning 0x00")
export const isReplyToBle = (sent, r) => (r[0] === sent[0] || r[0] === (sent[0] ^ 0xff)) && ((r[1] === sent[1] && r[2] === sent[2]) || (r[1] === 0xff && r[2] === sent[1] && r[3] === sent[2]));
// Bluetooth collection: Solaar finds HID++ by its reports, not by a usage page (hidapi_impl.py check_hidpp_long: input
// report 0x11 of 1 + 19 bytes; udev_impl.py: report 0x11 of 19 * 8 bits). OpenRGB LogitechControllerDetect.cpp @
// a44f52507873f9810601a9ea2640cbe13a868c15 registers Bluetooth HID++ 2.0 on usage page 0xFF43 (any usage) and on 0xFF00
// usage 2, so the page differs by model: the channel takes any page and usage and picks the collection whose input and
// output reports are 19 data bytes (helpers/hid-host.mjs channelOpts il / ol; the helper adds the report id byte).
export const BLE_HID = { page: '*', usage: '*', inputLen: LEN, outputLen: LEN };

// Receiver slots (22 Oct 2026, docs/handoff/logitech-c539.md), the same rules as device-library/logitech-hidpp-mouse:
// every slot is asked read-only (ping, getFeature 0x2201, DEVICE_NAME fn 0x20) and only a keyboard's slot is run; a mouse
// there is left to the mouse driver (notMine: helpers/my-devices.mjs stepAside, no error, no problem report); nothing
// answering = asleep. HID++ 2.0 kinds: Solaar hidpp20_constants.py DEVICE_KIND @ e7304c4c.
export const KIND = { 0: 'keyboard', 1: 'remote control', 2: 'numpad', 3: 'mouse', 4: 'touchpad', 5: 'trackball', 6: 'presenter', 7: 'receiver' };
const KEYBOARD_KINDS = ['keyboard', 'numpad'];
// one owner per receiver slot, shared by every Logitech driver in the process (the mouse driver's SLOT_OWNERS)
export const SLOT_OWNERS = (globalThis[Symbol.for('devicehub.logitech.slots')] ||= new Map());
const slotKey = (pid, slot) => `${hex4(pid)}:${slot}`;
const releaseSlots = (id) => { for (const [k, v] of SLOT_OWNERS) if (v === id) SLOT_OWNERS.delete(k); };
const notMine = (message) => Object.assign(new Error(message), { notMine: true, gone: true });
const WAKE_PING_MS = 1000, WAKE_EVERY_MS = 30000;

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
  // Bluetooth: no usage page in the filter (the BLE channel chooses its collection by report length, BLE_HID)
  if (BLE[pid]) return getDevice([{ vendorId: VID, productId: pid }], { prompt: false });
  // the G813: its HID++ collection is interface 1, page 0xFF43 usage 0x0602 (FF43 above, OpenRGB)
  if (FF43[pid]) return getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff43, usage: 0x0602 }], { prompt: false });
  return getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }], { prompt: false });
}

export function createLogitechKeyboard({ open = defaultOpen, vendorApp = defaultVendorApp } = {}) {
  return {
    id: 'logitech-hidpp-keyboard',
    title: 'Logitech keyboard',
    kind: 'Keyboard',
    vendor: 'Logitech',
    // the long-report collection, usage page 0xFF00 usage 0x02 (sheet section 2, OpenRGB); raw replies (as the mouse)
    // Bluetooth ids get their own collection choice (BLE_HID); every USB id's channel is as before
    hid: { vid: '046D', pid: 'C33E', pids: PIDS.map(hex4), page: 'FF00', usage: '0002', len: LEN, reportId: REPORT_LONG, replyMs: 2000, reply: 'raw',
      byPid: Object.fromEntries([...Object.keys(BLE).map((p) => [hex4(Number(p)), { ...BLE_HID }]), ...Object.entries(FF43).map(([p, c]) => [hex4(Number(p)), { ...c }])]) },
    unsupported: ['editing onboard profiles (keys, macros, lights)', 'lighting colours and effects (no read-back)', 'G-key and M-key remaps', 'game mode beyond the key locks', 'firmware updates', 'pairing'],
    dev: null, chan: null, index: DEV_WIRED, features: {}, caps: {}, asleep: false, usbId: null, shared: false, swid: SW_ID,
    pingMs: 2600,   // how long a slot's ping waits (tests shorten it)
    // Shown only once it found a keyboard (23 Oct 2026, a friend's PC: a PRO X2 SUPERSTRIKE alone on C54D
    // showed a "Logitech keyboard" that does not exist). Before its first look, and on a SHARED receiver (most hold only
    // a mouse), helpers/agent.mjs snapshot marks it absent until it is connected or asleep: no tile, no sidebar entry, no
    // Setup row, no report. A keyboard found once is remembered (seen-devices.json) and shown from then on.
    get onlyIfFound() { return this.pid == null || !!SHARED[this.pid]; },

    get settings() {
      const c = this.caps, out = [];
      if (c.rate) out.push({ key: 'reportRate', label: 'Report rate', type: 'choice', options: [...c.rate.hz].sort((a, b) => a - b).map((hz) => ({ value: hz, label: `${hz} Hz` })), hint: 'Host mode only' });
      if (this.features[F.ONBOARD_PROFILES]) {
        out.push({ key: 'mode', label: 'Settings source', type: 'choice', hint: 'Host mode: the keyboard takes settings live and goes back to onboard on re-plug. Solaar notes host mode once upset a G915 TKL\'s function keys.',
          options: [{ value: 'onboard', label: 'Onboard (the profiles stored in the keyboard)' }, { value: 'host', label: 'Host (DeviceHub sets them live)' }] });
        // driver safety (22 Oct 2026): read-only and never self-checked until the numbering is confirmed on a real
        // keyboard. Solaar numbers the 0x8100 fn 0x40 sector 1-15; libratbag quirks the index (the mouse driver's
        // choice). With the wrong one the self-check would select the wrong profile and its put-back write the same
        // wrong number (docs/handoff/drivers-round3a.md, "Unconfirmed").
        if (c.profiles) out.push({ key: 'profile', label: 'Onboard profile', type: 'choice', readOnly: true, selfCheck: false,
          hint: 'Shown only: which onboard profile is active. Picking one is switched off until the profile numbering is confirmed on a real keyboard (Solaar and libratbag number them differently).',
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
      releaseSlots(this.id);
      this.dev = null; this.chan = null; this.features = {}; this.caps = {}; this.asleep = false; this.usbId = null; this.wokeAt = 0; this.pendingNotMine = null;
      let dev = null;
      for (const pid of PIDS) { dev = await open(pid); if (dev) break; }
      if (!dev) return false;
      if (!dev.opened && dev.open) await dev.open();
      this.dev = dev;
      this.pid = typeof dev.pid === 'string' ? parseInt(dev.pid, 16) : dev.productId;
      this.receiver = !!RECEIVERS[this.pid];
      this.shared = !!SHARED[this.pid];
      this.swid = this.shared ? SW_ID_SHARED : SW_ID;
      this.ble = !!BLE[this.pid];
      this.usbId = `046d:${hex4(this.pid).toLowerCase()}`;
      this.chan = new HidChannel(dev, { reportId: REPORT_LONG, length: LEN, match: this.ble ? isReplyToBle : isReplyTo });
      if (this.receiver) {
        const found = await this.probeSlots(this.pingMs);
        if (found.keyboard) return this.finishConnect();
        if (found.others.length) { this.stepAside(); throw notMine(this.notMineText(found.others)); }
        // a SHARED receiver with no keyboard answering: most hold a mouse, so step aside instead of waiting asleep
        if (this.shared) { this.stepAside(); throw notMine(this.noKeyboardText(found.held)); }
        this.asleep = true; this.index = null; this.wokeAt = Date.now();   // nothing answered: asleep or switched off
        return true;
      }
      this.index = DEV_WIRED;
      let ver = null;
      try { ver = await this.ping(); } catch (e) { if (e instanceof HidppError) throw e; }
      if (!ver) throw new Error('no reply from the keyboard');
      this.protocol = ver;
      return this.finishConnect();
    },

    // every receiver slot, read-only: ping, getFeature 0x2201 (a mouse has it), and the kind (DEVICE_NAME fn 0x20, when
    // the device has it). The first keyboard (or a device without 0x2201 whose kind is not known) is claimed.
    // On a SHARED receiver the kind must be keyboard / numpad and 0x2202 counts as a mouse too (the PRO X2 SUPERSTRIKE has
    // only 0x2202: device-library/logitech-hidpp-mouse). held = slots another Logitech driver runs (never asked).
    async probeSlots(pingMs) {
      const others = [], held = [];
      for (const slot of SLOTS) {
        const owner = SLOT_OWNERS.get(slotKey(this.pid, slot));
        if (owner && owner !== this.id) { held.push({ slot, owner }); continue; }
        this.index = slot;
        let ver = null;
        try { ver = await this.ping(pingMs); } catch { continue; }
        this.features = {};
        let dpi;
        try { dpi = await this.getFeature(F.ADJUSTABLE_DPI); } catch (e) { if (!(e instanceof HidppError)) continue; dpi = null; }
        if (!dpi && this.shared) { try { dpi = await this.getFeature(F.EXT_ADJUSTABLE_DPI); } catch (e) { if (!(e instanceof HidppError)) continue; dpi = null; } }
        const kind = dpi ? 'mouse' : await this.deviceKind();
        const keyboard = !dpi && (KEYBOARD_KINDS.includes(kind) || (kind === null && !this.shared));
        if (keyboard) { this.protocol = ver; SLOT_OWNERS.set(slotKey(this.pid, slot), this.id); return { keyboard: slot, others, held }; }
        others.push({ slot, kind });
      }
      this.features = {}; this.index = null;
      return { keyboard: null, others, held };
    },
    async deviceKind() {
      try {
        const f = await this.getFeature(F.DEVICE_NAME);
        if (!f) return null;
        this.features = { [F.DEVICE_NAME]: f };
        const p = await this.call(F.DEVICE_NAME, 0x20);   // Solaar hidpp20.py get_kind: byte 0
        return KIND[p[0]] || `kind ${p[0]}`;
      } catch { return null; } finally { this.features = {}; }
    },
    notMineText(others) {
      const o = others[0];
      return o.kind === 'mouse'
        ? `the Logitech device on receiver ${hex4(this.pid)} (slot ${o.slot}) has a DPI feature (0x2201): it is a mouse, not a keyboard this driver runs, so the keyboard driver leaves it to the mouse driver`
        : o.kind === null
          ? `the Logitech device on receiver ${hex4(this.pid)} (slot ${o.slot}) does not say it is a keyboard (no DEVICE_NAME kind): on a shared LIGHTSPEED receiver the keyboard driver leaves it alone`
          : `the Logitech device on receiver ${hex4(this.pid)} (slot ${o.slot}) is a ${o.kind}, not a keyboard this driver runs: the keyboard driver leaves it alone`;
    },
    noKeyboardText(held = []) {
      const h = held[0];
      return h
        ? `no keyboard answered on LIGHTSPEED receiver ${hex4(this.pid)}; slot ${h.slot} is run by ${h.owner}: the keyboard driver leaves it alone`
        : `no keyboard answered on LIGHTSPEED receiver ${hex4(this.pid)} (asleep, switched off or none paired): the keyboard driver looks again on a plug or a Connect click`;
    },
    stepAside() {
      releaseSlots(this.id);
      // a SHARED receiver's handle may be the mouse driver's too (see SHARED): let go of it without closing it
      if (!this.shared) { try { this.dev?.close?.(); } catch {} }
      this.dev = null; this.chan = null; this.features = {}; this.caps = {}; this.asleep = false;
    },
    // asleep at connect: asks the slots again at most every 30 s (public/core/devices.js asks before each look)
    async awake() {
      if (!this.asleep) return true;
      if (Date.now() - (this.wokeAt || 0) < WAKE_EVERY_MS) return false;
      this.wokeAt = Date.now();
      const found = await this.probeSlots(Math.min(this.pingMs, WAKE_PING_MS)).catch(() => ({ keyboard: null, others: [] }));
      if (found.keyboard) {
        try { await this.finishConnect(); } catch (e) { if (e.notMine) { this.pendingNotMine = e.message; return true; } releaseSlots(this.id); this.index = null; return false; }
        this.asleep = false;
        return true;
      }
      if (found.others.length) { this.pendingNotMine = this.notMineText(found.others); return true; }
      return false;
    },
    async needAwake() {
      if (this.pendingNotMine) { const t = this.pendingNotMine; this.pendingNotMine = null; this.stepAside(); throw notMine(t); }
      if (!this.chan) throw Object.assign(new Error('the keyboard is not connected'), { gone: true });
      if (this.asleep && !(await this.awake())) throw new Error(`the keyboard is asleep or switched off: no device on receiver ${hex4(this.pid)} answered`);
      if (this.pendingNotMine) return this.needAwake();
    },

    async finishConnect() {
      // Bluetooth: the report rate is the USB / Lightspeed polling rate (Solaar ReportRate: "Frequency of device movement
      // reports"); over Bluetooth the link sets it and no source documents 0x8060 / 0x8061 there, so it is not looked up
      const rateIds = this.ble ? [] : [F.EXT_REPORT_RATE, F.REPORT_RATE];
      for (const id of [F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.BATTERY_VOLTAGE, F.ADJUSTABLE_DPI, ...rateIds, F.ONBOARD_PROFILES, F.DISABLE_KEYS, F.NEW_FN_INVERSION, F.FN_INVERSION, F.BRIGHTNESS]) {
        const f = await this.getFeature(id);
        if (f) this.features[id] = f;
      }
      // a mouse has the DPI feature; this driver leaves it to the mouse driver (a wired or Bluetooth id here is a keyboard's)
      if (this.features[F.ADJUSTABLE_DPI]) { this.stepAside(); throw notMine(`this Logitech device (${hex4(this.pid)}) has a DPI feature (0x2201): it is a mouse, not a keyboard this driver runs, so the keyboard driver leaves it to the mouse driver`); }
      await this.readCaps();
      return true;
    },

    async call(featureId, fn, params = [], { retry = true, timeoutMs = 2600 } = {}) {
      if (NEVER.includes(featureId) || (NEVER_FN[featureId] || []).includes(fn) || !(ALLOWED[featureId] || []).includes(fn)) throw new Error(`refused: feature 0x${hex4(featureId)} function 0x${hex2(fn)} is not one this driver sends`);
      const index = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
      if (!index && featureId !== F.ROOT) throw new Error(`the keyboard has no feature 0x${hex4(featureId)}`);
      const out = [this.index, index, (fn & 0xf0) | this.swid, ...params];
      const what = `0x${hex4(featureId)} fn 0x${hex2(fn)}`;
      let r;
      try { r = await this.chan.request(out, { timeoutMs }); }
      catch (e) { if (!retry || /refused/.test(e.message)) throw e; r = await this.chan.request(out, { timeoutMs }); }
      if (r[1] === 0xff && r[2] === index && r[3] === out[2]) throw new HidppError(r[4], what);
      return r.slice(3, 19);
    },
    // ping: Root fn 0x10 [00 00 mark] -> major, minor, mark (sheet section 2)
    async ping(timeoutMs = this.pingMs) { const p = await this.call(F.ROOT, 0x10, [0, 0, 0x5a], { retry: false, timeoutMs }); if (p[2] !== 0x5a) throw new Error('the ping came back without its mark'); return `${p[0]}.${p[1]}`; },
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
    // BooleanValidator: byte 0, 0x01 = on; any byte but 00 / 01 reads as null, so it is never written back as one (driver safety)
    async readFnSwap() { const b = (await this.call(this.caps.fnSwap, 0x00))[0]; return b === 1 ? true : b === 0 ? false : null; },
    async readBrightness() {
      const b = this.caps.brightness;
      // Solaar BrightnessControl.rw_class.read: with on/off, fn 0x30 byte 0 bit 0 clear = off (0); then fn 0x10 2 bytes BE
      if (b.onOff && !((await this.call(F.BRIGHTNESS, 0x30))[0] & 0x01)) return 0;
      const p = await this.call(F.BRIGHTNESS, 0x10);
      return (p[0] << 8) | p[1];
    },

    async info() {
      if (this.asleep) return { Model: `Logitech keyboard on ${RECEIVERS[this.pid]} ${hex4(this.pid)} (not answering yet)`, Connection: 'Lightspeed receiver' };
      const mode = await this.readMode().catch(() => undefined);
      const out = {
        Model: this.receiver ? `Logitech keyboard on ${RECEIVERS[this.pid]} ${hex4(this.pid)} (slot ${this.index})` : `Logitech ${WIRED[this.pid] || BLE[this.pid] || `keyboard ${hex4(this.pid)}`}`,
        Connection: this.receiver ? 'Lightspeed receiver' : this.ble ? 'Bluetooth' : 'USB cable',
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
      await this.needAwake();
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
      if (this.asleep) throw Object.assign(new Error('the keyboard is asleep or switched off'), { waiting: true });
      const s = this.settings.find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting of this keyboard`);
      if (s.type === 'toggle' && typeof value !== 'boolean') throw new Error(`${s.label} is on or off (true / false)`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      if (s.type === 'slider' && !(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`${s.label} must be a whole number ${s.min}-${s.max}`);
      // read-only until the numbering is confirmed (see settings): refused before anything is sent
      if (key === 'profile') throw new Error('Onboard profile is read-only: its numbering (Solaar 1-15 or the libratbag index) is not confirmed on a real keyboard yet, so DeviceHub does not select profiles');
      const app = await vendorApp();
      if (app) throw Object.assign(new Error(`${app} (G HUB) is running: close it first (two programs writing the keyboard fight)`), { waiting: true });
      const mode = await this.readMode();
      // the sheet lists the report rate as easy to undo "in host mode"; Solaar: "May need Onboard Profiles set to Disable"
      if (key === 'reportRate' && mode === 'onboard') throw Object.assign(new Error('the keyboard is using its onboard profiles: set Settings source to Host first (the report rate is only changed live in host mode)'), { waiting: true });
      const lock = DISABLE.find((d) => d.key === key);
      if (key === 'reportRate') {
        const r = this.caps.rate;
        if (r.ext) await this.call(F.EXT_REPORT_RATE, 0x30, [EXT_RATES_HZ.indexOf(value)], { retry: false });   // Solaar ExtendedReportRate write 0x30 [index]
        else await this.call(F.REPORT_RATE, 0x20, [r.ms[r.hz.indexOf(value)]], { retry: false });                // Solaar ReportRate write 0x20 [ms]
      } else if (key === 'mode') {
        await this.call(F.ONBOARD_PROFILES, 0x10, [value === 'onboard' ? 0x01 : 0x02], { retry: false });       // Solaar OnboardProfiles write: fn 0x10 [01] / [02]
      // profile select (Solaar OnboardProfiles write: fn 0x30 [sector, 2 bytes]) is refused above until the numbering is
      // confirmed; when it is, the write goes here: this.call(F.ONBOARD_PROFILES, 0x30, [value >> 8, value & 0xff])
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
      if (this.asleep) return null;
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
      await this.needAwake();
      return { pid: hex4(this.pid), index: this.index, protocol: this.protocol, caps: this.caps,
        features: Object.fromEntries(Object.entries(this.features).map(([id, f]) => [`0x${hex4(Number(id))}`, f])),
        values: await this.read(), profileSector: await this.readProfileSector().catch(() => undefined) };
    },
  };
}

export default createLogitechKeyboard();
