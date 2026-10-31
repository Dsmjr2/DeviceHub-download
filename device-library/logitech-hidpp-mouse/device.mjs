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
// RECEIVER SLOTS (22 Oct 2026, docs/handoff/logitech-c539.md; problem report Dsmjr2/DeviceHub-support#2): connect()
// used to take the first slot that answered a ping and threw an error when that device had no 0x2201, so a keyboard
// paired to the same receiver left the mouse driver "in an error" for good. Now every slot 1-6 is asked, read-only (ping,
// getFeature 0x2201, DEVICE_NAME fn 0x20 for the kind), and only a slot whose device has 0x2201 is run. A receiver whose
// answering devices are all something else: the driver closes it and steps aside (`notMine`, helpers/my-devices.mjs
// stepAside: shown as not connected, no error, no problem report). No slot answering: the asleep state (the receiver stays
// open; awake() asks the slots again at most every 30 s). The receiver's own pairing table (HID++ 1.0 register 0xB5) is
// still not read: Linux, libratbag and Solaar send it as a SHORT report (0x10), which goes out on the receiver's
// short-report collection this driver does not open, and the never list names "receiver pairing registers".
//
// Safety (CLAUDE.md "Rules that are never broken"; sheet section 4 "Never touch"): every request goes through call(),
// which only sends the feature ids and function codes in ALLOWED. DFU (0x00C0-0x00C3, 0x00D0, 0x010A), reset (0x1802),
// OOB state (0x1805), force pairing (0x1500), receiver pairing registers and onboard-profile MEMORY (0x8100 functions
// 0x50/0x60/0x70/0x80) are not in it, so no code path can send them. Writes: DPI (0x2201 fn 0x30), report rate
// (0x8060 fn 0x20 / 0x8061 fn 0x30), the onboard/host switch (0x8100 fn 0x10), the active onboard profile (0x8100 fn 0x30)
// and DPI slot (0x8100 fn 0xC0), and lift-off (0x2202 fn 0x60, DPI rewritten as read), each read back. Writes are refused
// while G HUB runs (vendorApp()). DPI, rate and lift-off are
// only written in host mode (the sheet lists them as easy to undo "in host mode"); a mouse in onboard mode says so.
//
// PRO X2 SUPERSTRIKE (22 Oct 2026, docs/handoff/superstrike.md): receiver 046d:c54d (WPID 40BD) or its cable 046d:c0a8.
// Sources, read-only, by commit:
//   K = kazehana99k/Logitech-PRO-X2-SUPERSTRIKE-Linux-haptics-actuation-control- PROTOCOL.md, feature-table.txt @ 1b599dd0
//   O = oddvalue/linux-superstrike REVERSE_ENGINEERING.md, internal/hidpp/analog.go @ 42588e73
//   X = xatuke/logitech-superstrike-pro-x2-controller docs/PROTOCOL.md, src/ss2k.c, udev/99-superstrike.rules @ c3ad5366
//   S = pwr-Solaar/Solaar settings_templates.py AnalogButtonTuning, docs/devices/PRO X 2 Superstrike 40BD.txt,
//       docs/PRO_X2_SUPERSTRIKE_CLI.md @ e7304c4c
//   - It has NO 0x2201 and NO 0x8060 (O, X, S feature tables): DPI is 0x2202 (read fn 0x50) and the rate 0x8061. A mouse
//     with 0x2202 and no 0x2201 is now run (it used to be stepped aside), its DPI shown from 0x2202 fn 0x50.
//   - HITS buttons, feature 0x1B0C ANALOG_BUTTONS (K, O, X, S agree byte for byte): caps fn 0x00 -> [flags, buttons,
//     act<<2, rt<<2, hap<<2]; read fn 0x20 [btn] -> [btn, act<<2, (rt<<2)|flag, hap<<2]; write fn 0x10 [btn, act, rt, hap]
//     with the whole record; byte 2 bit 0 is a flag kept as read (S, O: "must be preserved"; X: a rapid-trigger on/off the
//     sources disagree about, so it is never changed here); other low bits reserved (S). Left = 0, right = 1 (all four).
//     Each value is one setting: the write sends the record read just before with only that byte changed, so writing the
//     value read sends back exactly the raw bytes read; read back byte for byte (K and X: read-back verified on the mouse).
//   - Its DPI (0x2202 fn 0x50) and report-rate (0x8061 fn 0x20) getters lag behind a write (O: "several of this device's
//     'get' registers return stale/cached values"; X: "fn2 -> current idx ... STALE after writes", "Stale getters are
//     systemic (DPI, rate ...)"), so a read-back cannot prove those writes: on this mouse DPI, report rate and lift-off
//     are shown, not written. A profile select reloads the profile (O), which resets the live DPI stage and HITS values,
//     so the self-check's same-value write would change the mouse: the profile is shown, not written. DPI stage (0x8100
//     fn 0xB0 / 0xC0, X: fn11 / fn12) and the onboard / host switch are written as on other mice.
import { HidChannel, getDevice, hex } from '../../public/devices/hid.js';

const VID = 0x046d;
// sheet section 1 "Lightspeed receivers" (Solaar base_usb.py): Lightspeed and Bolt receivers, HID++ interface 2
// C541 / C545 / C547 are left out: the sheet (OpenRGB) names them G915 keyboard receivers
export const RECEIVERS = [0xc539, 0xc53a, 0xc53d, 0xc53f, 0xc54d, 0xc548];
// SHARED_WITH_KEYBOARD (23 Oct 2026): device-library/logitech-hidpp-keyboard also runs these three LIGHTSPEED receivers
// (its SHARED: a keyboard paired to one, a PRO X TKL or G515, is found there by its DEVICE_NAME kind). Both drivers then
// get the same HID handle (helpers/hid-host.mjs provider() gives the first host for the vid / pid / usage page), so on
// these the mouse driver never closes the receiver when it steps aside; the keyboard driver uses its own HID++ software
// id there (0x0C), so neither takes the other's replies.
export const SHARED_WITH_KEYBOARD = [0xc539, 0xc53f, 0xc54d];
// sheet section 1 "Mice": wired / USB product ids
export const WIRED = {
  0xc09b: 'PRO X SUPERLIGHT 2', 0xc094: 'PRO X SUPERLIGHT', 0xc09a: 'PRO 2 LIGHTSPEED', 0xc098: 'G502 X LIGHTSPEED',
  0xc095: 'G502 X PLUS', 0xc099: 'G502 X', 0xc088: 'G PRO Wireless', 0xc090: 'G703 HERO', 0xc091: 'G903 HERO',
  0xc08d: 'G502 LIGHTSPEED',
  // 22 Oct 2026: more HID++ 2.0 G mice, their USB ids exactly as libratbag data/devices @ 8235b5bb lists them (file
  // named per line). The driver finds every feature at connect, so a model needs only its id; a setting appears only
  // when the mouse answers its feature (no 0x2201 = refused as "not a mouse").
  0xc085: 'G Pro', 0xc08c: 'G Pro',                                       // logitech-g-pro.device
  0xc084: 'G102 / G103 / G203', 0xc092: 'G102 / G103 / G203', 0xc09d: 'G102 / G103 / G203', // logitech-g102-g203.device
  0xc07f: 'G302',                                                         // logitech-g302.device
  0xc080: 'G303',                                                         // logitech-g303.device
  0xc097: 'G303 Shroud Edition',                                          // logitech-g303-shroud.device
  0xc07e: 'G402',                                                         // logitech-g402.device
  0xc083: 'G403',                                                         // logitech-g403.device
  0xc08f: 'G403 HERO',                                                    // logitech-g403-hero.device
  0xc082: 'G403 Wireless',                                                // logitech-g403-wireless.device
  0xc08b: 'G502 HERO',                                                    // logitech-g502-hero.device (INDEX_OFFSET)
  0xc07d: 'G502 Proteus Core',                                            // logitech-g502-proteus-core.device
  0xc332: 'G502 Proteus Spectrum',                                        // logitech-g502-proteus-spectrum.device (INDEX_OFFSET)
  0xc087: 'G703',                                                         // logitech-g703.device
  0xc096: 'G705',                                                         // logitech-g705.device
  0xc081: 'G900',                                                         // logitech-g900.device
  0xc086: 'G903',                                                         // logitech-g903.device
  0xc08e: 'MX518',                                                        // logitech-MX518.device
  // 22 Oct 2026: its cable, X README.md / udev/99-superstrike.rules @ c3ad5366 ("Mouse, with the USB cable 046d:c0a8"),
  // matching S docs/devices/PRO X 2 Superstrike 40BD.txt @ e7304c4c (Model ID 40BDC0A80000, usbid C0A8)
  0xc0a8: 'PRO X2 SUPERSTRIKE',
};
// The id libratbag gives a mouse behind a receiver (`usb:046d:40xx` in the same files: the child device Linux's
// hid-logitech-dj makes). Windows has no such device: the mouse is reached through RECEIVERS at its pairing slot, so
// these are never opened as channels; listed so the covered models and their documented ids are in one place.
export const WPIDS = {
  0x4079: 'G PRO Wireless', 0x4093: 'PRO X SUPERLIGHT', 0x4074: 'G305', 0x405d: 'G403 Wireless', 0x407f: 'G502 LIGHTSPEED',
  0x4099: 'G502 X PLUS', 0x409f: 'G502 X LIGHTSPEED', 0x406c: 'G603', 0x4085: 'G604', 0x4070: 'G703', 0x4086: 'G703 HERO',
  0x409d: 'G705', 0x4053: 'G900', 0x4067: 'G903', 0x4087: 'G903 HERO',
  // S docs/devices/PRO X 2 Superstrike 40BD.txt and docs/PRO_X2_SUPERSTRIKE_CLI.md @ e7304c4c (WPID 40BD, HID++ 4.2);
  // reached through receiver C54D (K PROTOCOL.md, X docs/PROTOCOL.md section 1)
  0x40bd: 'PRO X2 SUPERSTRIKE',
};
// the SUPERSTRIKE's receiver and cable (K, X); C54D is also in RECEIVERS
export const SUPERSTRIKE = { receiver: 0xc54d, cable: 0xc0a8, wpid: 0x40bd };
// Bluetooth (22 Oct 2026, docs/handoff/logitech-ble.md): a mouse on Bluetooth is its own HID device with its BLE product
// id, HID++ 2.0 straight to it at device index 0xFF. The only G mice with a documented Bluetooth id are these three, from
// libratbag data/devices @ 8235b5bb (`bluetooth:046d:...`); no other source read lists one (Solaar descriptors.py @
// e7304c4c: MX / M-series only; Linux hid-logitech-hidpp.c: none for a G mouse; OpenRGB: none). The transport below
// (BLE_HID, isReplyToBle, no report rate) applies to them.
export const BLE = {
  0xb01c: 'G603',                                                         // logitech-g603.device
  0xb024: 'G604',                                                         // logitech-g604.device (INDEX_OFFSET)
  0xb02e: 'G705',                                                         // logitech-g705.device
};
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// sheet section 2 "Transport": HID++ long = report 0x11, 20 bytes in all (19 after the report id); the long collection
// is usage page 0xFF00 usage 0x02 (OpenRGB: the one Windows accepts writes on)
const REPORT_LONG = 0x11, LEN = 19;
// sheet section 2 "Message format": low nibble of byte 3 = software id, non-zero; Solaar uses 0x0B
const SW_ID = 0x0b;
const DEV_WIRED = 0xff;                       // section 2 "Device index": 0xFF = a wired (or Bluetooth) device directly
const SLOTS = [1, 2, 3, 4, 5, 6];             // 0x01-0x06 = paired devices (Bolt holds 6; Lightspeed usually 1)

// feature ids (sheet section 3 settings map; section 2 for 0x0000 / 0x0001; 0x0005 DEVICE_NAME from Solaar
// hidpp20_constants.py SupportedFeature @ e7304c4c451cc9bb4f206a914844525e67856a28)
// + 0x1B0C ANALOG_BUTTONS (S hidpp20_constants.py @ e7304c4c: "Analog button tuning (actuation point, rapid trigger, haptics)")
export const F = { ROOT: 0x0000, FEATURE_SET: 0x0001, DEVICE_NAME: 0x0005, BATTERY_STATUS: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, ANALOG_BUTTONS: 0x1b0c, ADJUSTABLE_DPI: 0x2201, EXT_ADJUSTABLE_DPI: 0x2202, REPORT_RATE: 0x8060, EXT_REPORT_RATE: 0x8061, ONBOARD_PROFILES: 0x8100 };
// the only (feature, function) pairs call() will send. Function = byte 3's high nibble, written as fn << 4.
export const ALLOWED = {
  [F.ROOT]: [0x00, 0x10],                     // getFeature, ping (section 2 "Feature lookup")
  [F.FEATURE_SET]: [0x00, 0x10],              // count, feature at index (section 2 "IFeatureSet 0x0001")
  // device type only (22 Oct 2026, docs/handoff/logitech-c539.md): Solaar hidpp20.py get_kind() sends DEVICE_NAME fn 0x20
  // and reads byte 0 as hidpp20_constants.py DEVICE_KIND (@ e7304c4c). A read: it tells which kind of device answered on a
  // receiver slot, so a keyboard there is left alone. The name functions are still not sent.
  [F.DEVICE_NAME]: [0x20],
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
  // HITS (header, sources K O X S): caps 0x00, write 0x10, read 0x20. Never fn 0x30 / 0x40 (K: "other (not investigated)").
  [F.ANALOG_BUTTONS]: [0x00, 0x10, 0x20],
};
// the memory functions of 0x8100 (sheet section 4 "Risky writes": they rewrite flash); call() refuses them even if they
// were ever added to ALLOWED by mistake
export const NEVER_FN = { [F.ONBOARD_PROFILES]: [0x50, 0x60, 0x70, 0x80] };
// sheet section 4 "Never touch": refused even if someone adds them to ALLOWED by mistake
// + Solaar hidpp20_constants.py BLE_PRO_PRE_PAIRING 0x1816 and LIGHTSPEED_PAIRING 0x0309 (as the keyboard and headset
// drivers; added 22 Oct 2026 with Bluetooth, where 0x1816 is reachable on the device itself)
// + 22 Oct 2026, the SUPERSTRIKE's own table (O internal/hidpp/features.go @ 42588e73 names; S 40BD.txt lists them
// "internal, hidden"): 0x1817 LightspeedPrepairing (pairing), 0x9403 "FlashUpdate?" (O; S calls it a hidden bunny-hop
// feature: unknown, so never), 0x1801 ManufacturingMode, 0x1803 GPIOAccess, 0x1890 RFTest, 0x1E00 EnableHiddenFeatures
export const NEVER = [0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00d0, 0x010a, 0x1802, 0x1805, 0x1500, 0x1816, 0x0309, 0x1817, 0x9403, 0x1801, 0x1803, 0x1890, 0x1e00];

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

// HID++ 2.0 device kinds: Solaar hidpp20_constants.py DEVICE_KIND @ e7304c4c (the reply byte of DEVICE_NAME fn 0x20)
export const KIND = { 0: 'keyboard', 1: 'remote control', 2: 'numpad', 3: 'mouse', 4: 'touchpad', 5: 'trackball', 6: 'presenter', 7: 'receiver' };

// One owner per receiver slot (22 Oct 2026, docs/handoff/logitech-c539.md). The Logitech library drivers each open their
// own handle on a receiver (Windows hands every handle every input report), so two of them on one receiver do not take
// each other's replies; they only fight when both drive the SAME slot. This table, shared by every Logitech driver in
// the process (each folder is self-contained, so it lives on globalThis), records which driver runs which slot:
// key '<pid>:<slot>' -> driver id. A driver skips a slot another one holds and frees its own on every connect.
export const SLOT_OWNERS = (globalThis[Symbol.for('devicehub.logitech.slots')] ||= new Map());
const slotKey = (pid, slot) => `${hex4(pid)}:${slot}`;
const releaseSlots = (id) => { for (const [k, v] of SLOT_OWNERS) if (v === id) SLOT_OWNERS.delete(k); };
// "this is not a device this driver runs": helpers/my-devices.mjs stepAside() turns it into "not this driver's" (the
// device shows as not connected, no error, nothing reported) instead of an error
const notMine = (message) => Object.assign(new Error(message), { notMine: true, gone: true });
const asleepError = (pid) => new Error(`the mouse is asleep or switched off: no device on receiver ${hex4(pid)} answered (move it or switch it on)`);
const WAKE_PING_MS = 1000, WAKE_EVERY_MS = 30000;

// 0x8061 index -> Hz (settings map "Report rate (8K)": 0=8 ms, 1=4 ms, 2=2 ms, 3=1 ms, 4=500 us, 5=250 us, 6=125 us)
export const EXT_RATES_HZ = [125, 250, 500, 1000, 2000, 4000, 8000];
const hzOfMs = (ms) => Math.round(1000 / ms);

// "DPI X/Y + lift-off" row: LOD 0 low, 1 medium, 2 high (Solaar ExtendedAdjustableDpi LOD choices LOW=0, MEDIUM=1, HIGH=2)
export const LOD = ['low', 'medium', 'high'];
// "DPI slot in profile" row: 0-4 (libratbag hidpp20_onboard_profiles_set_current_dpi_index refuses index > 4)
export const DPI_SLOTS = 5;
// "Active profile" row + section 1: the G502 X family reads its active profile 1-based (libratbag HIDPP20_QUIRK_INDEX_OFFSET,
// "devices that return 1-indexed profile"); every mouse is SET 1-based (libratbag set_current_profile sends index + 1)
// + 22 Oct 2026, the other ids whose libratbag file carries Quirk=INDEX_OFFSET: G502 HERO, G502 Proteus Spectrum, G604 (Bluetooth)
export const PROFILE_READ_1BASED = [0xc098, 0xc095, 0xc099, 0xc08b, 0xc332, 0xb024];
// G HUB (sheet section 5 "Windows note": lghub_agent.exe holds the same HID++ collection; writing beside it fights)
// lghub_updater.exe is left out: it is a service that runs with G HUB closed (23 Oct 2026, support #13)
export const VENDOR_APPS = /^lghub(_agent|_system_tray)?\.exe$/i;

// HITS (0x1B0C) settings: key -> [button, field]. field: act = actuation point (record byte 1), rt = rapid trigger
// (byte 2, bit 0 kept), hap = click haptics (byte 3). The documented ranges (S AnalogButtonTuning RangeValidator
// min_value 1 / 1 / 0; X ss2k_hits_set clampi 1-10, 1-5, 0-5; the maxima are the mouse's own caps >> 2, documented as
// 0x28 / 0x14 / 0x14 = 10 / 5 / 5 by K feature-table.txt, X section 4 and S 40BD.txt). Only shown when the mouse has
// 0x1B0C and its caps read as documented.
export const HITS = {
  actuationLeft: [0, 'act'], rapidTriggerLeft: [0, 'rt'], hapticsLeft: [0, 'hap'],
  actuationRight: [1, 'act'], rapidTriggerRight: [1, 'rt'], hapticsRight: [1, 'hap'],
};
export const HITS_DOC = { act: { min: 1, max: 10, byte: 1 }, rt: { min: 1, max: 5, byte: 2 }, hap: { min: 0, max: 5, byte: 3 } };
const HITS_HINT = 'HITS button setting (0x1B0C), applied live; the mouse may load its stored profile value again when it restarts or a profile is selected.';
const hitsSetting = (key) => {
  const [b, f] = HITS[key];
  const side = b === 0 ? 'Left' : 'Right';
  const what = { act: 'actuation point', rt: 'rapid trigger', hap: 'click haptics' }[f];
  const more = { act: '1 = shallowest, 10 = deepest.', rt: '1 = most sensitive.', hap: '0 = off.' }[f];
  return { key, label: `${side} button ${what}`, type: 'slider', min: HITS_DOC[f].min, max: HITS_DOC[f].max, step: 1, hint: `${more} ${HITS_HINT}` };
};

// every setting this driver knows; `settings` (what the page shows) is this list minus the HITS ones a mouse lacks,
// rebuilt at each connect (readCaps)
const ALL = [
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
  ...Object.keys(HITS).map(hitsSetting),
];
const settings = [...ALL];
const byKey = (k) => ALL.find((s) => s.key === k);
// the fields readCaps changes per mouse, as the module starts, so each connect starts from them
const SHAPE_FIELDS = ['type', 'min', 'max', 'step', 'unit', 'options', 'hint'];
const START = Object.fromEntries(ALL.map((s) => [s.key, JSON.parse(JSON.stringify(Object.fromEntries(SHAPE_FIELDS.filter((f) => f in s).map((f) => [f, s[f]]))))]));
function resetShapes() {
  for (const s of ALL) { for (const f of SHAPE_FIELDS) delete s[f]; Object.assign(s, JSON.parse(JSON.stringify(START[s.key]))); }
}
// shown only (a reading): DeviceHub never writes a 'display' setting and the self-check skips it (helpers/my-devices.mjs)
function showOnly(key, hint, unit) { const s = byKey(key); for (const f of ['min', 'max', 'step', 'options']) delete s[f]; Object.assign(s, { type: 'display', hint }, unit ? { unit } : {}); }

// a HITS record (0x1B0C fn 0x20 reply, 4 bytes) -> { act, rt, hap } levels; a byte that is not on the documented grid
// (reserved low bits set, or outside the mouse's range) reads as undefined, so it is never written back
export function hitsLevels(rec, btn, caps) {
  const out = { act: undefined, rt: undefined, hap: undefined };
  if (!rec || rec[0] !== btn || !caps) return out;
  const lv = (raw, mask, f) => ((raw & mask) === 0 && (raw >> 2) >= HITS_DOC[f].min && (raw >> 2) <= caps[f] ? raw >> 2 : undefined);
  out.act = lv(rec[1], 0x03, 'act');
  out.rt = lv(rec[2], 0x02, 'rt');          // bit 0 is the flag kept as read; bit 1 reserved (S)
  out.hap = lv(rec[3], 0x03, 'hap');
  return out;
}

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
  unsupported: ['editing onboard profiles (buttons, the DPI of each slot, sleep timer, lights)', 'lighting', 'button remapping', 'angle snapping', 'surface tuning', 'firmware updates', 'pairing',
    'PRO X2 SUPERSTRIKE: writing DPI, report rate, lift-off and the profile (shown only: see docs/handoff/superstrike.md), the rapid-trigger on/off flag, gaming surface mode (0x8090) and the bunny-hop filter (0x80E0)'],

  // the vendor-app check (replaceable in tests): resolves with the running G HUB process name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
    return null;
  },

  dev: null, chan: null, index: DEV_WIRED, features: {}, caps: {}, asleep: false, usbId: null,
  pingMs: 2600,   // how long a slot's ping waits (tests shorten it)

  // product ids added by the library's family match (numbers), none when there are none
  familyIds() { return (this.familyPids || []).map((p) => parseInt(p, 16)).filter((n) => Number.isInteger(n) && !RECEIVERS.includes(n) && !WIRED[n] && !BLE[n]); },
  async connect(prompt) {
    releaseSlots(this.id);
    this.dev = null; this.chan = null; this.features = {}; this.caps = {}; this.profileReadBase = undefined; this.asleep = false; this.usbId = null; this.wokeAt = 0; this.pendingNotMine = null; this.superstrike = false; this.shownOnly = new Set();
    let dev = injected;
    if (!dev) {
      for (const pid of [...RECEIVERS, ...Object.keys(WIRED).map(Number)]) {
        dev = await getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }], { prompt: false });
        if (dev) break;
      }
      // Bluetooth: no usage page in the filter (BLE_HID picks the collection)
      for (const pid of Object.keys(BLE).map(Number)) { if (dev) break; dev = await getDevice([{ vendorId: VID, productId: pid }], { prompt: false }); }
      // a model not listed here, matched by its HID++ collection (device.json family, helpers/my-devices.mjs familyPids):
      // tried last, and it must answer HID++ 2.0 and have a DPI feature, else the driver steps aside
      for (const pid of this.familyIds()) { if (dev) break; dev = await getDevice([{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }], { prompt: false }); }
      if (!dev && prompt) dev = await getDevice(RECEIVERS.concat(Object.keys(WIRED).map(Number)).map((p) => ({ vendorId: VID, productId: p, usagePage: 0xff00, usage: 0x0002 })));
    }
    if (!dev) return false;
    if (!dev.opened) await dev.open();
    this.dev = dev;
    this.pid = typeof dev.pid === 'string' ? parseInt(dev.pid, 16) : dev.productId;
    // sheet section 5 step 2: 0xC500-0xC5FF = receiver, anything else = a direct device at index 0xFF
    this.receiver = this.pid >= 0xc500 && this.pid <= 0xc5ff;
    this.ble = !!BLE[this.pid];
    this.usbId = `046d:${hex4(this.pid).toLowerCase()}`;
    this.chan = new HidChannel(dev, { reportId: REPORT_LONG, length: LEN, match: this.ble ? isReplyToBle : isReplyTo });
    if (!this.receiver) {
      // wired / Bluetooth: index 0xFF
      this.index = DEV_WIRED;
      let ver = null;
      try { ver = await this.ping(); } catch (e) { if (e instanceof HidppError && !this.familyIds().includes(this.pid)) throw e; }
      if (!ver && this.familyIds().includes(this.pid)) { this.stepAside(); throw notMine(`this Logitech device (${hex4(this.pid)}) does not answer HID++ 2.0, so the mouse driver leaves it alone`); }
      if (!ver) throw new Error('no reply from the mouse');
      this.protocol = ver;
      return this.finishConnect();
    }
    // receiver (22 Oct 2026, docs/handoff/logitech-c539.md): every slot is asked, read-only, and only a slot whose device
    // has 0x2201 is run. A keyboard (or anything else) there is left alone; nothing answering = asleep, not an error.
    const found = await this.probeSlots(this.pingMs);
    if (found.mouse) return this.finishConnect();
    if (found.others.length) { this.stepAside(); throw notMine(this.notMineText(found.others)); }
    // only slots another Logitech driver runs (the keyboard on a shared receiver): step aside, never a sleeping mouse tile
    if (found.held?.length) { this.stepAside(); throw notMine(this.heldText(found.held)); }
    // no slot answered: a sleeping or switched-off mouse (or nothing paired). The receiver stays open, and the mouse is
    // looked for again when DeviceHub asks whether it woke (awake()) and on every read.
    this.asleep = true; this.index = null; this.wokeAt = Date.now();
    return true;
  },

  // ask each receiver slot, read-only: ping (IRoot fn 0x10), then getFeature 0x2201, and for a device without it its kind
  // (DEVICE_NAME fn 0x20). Stops at the first slot with 0x2201 and claims it. Slots another Logitech driver holds are
  // skipped. Returns { mouse: slot | null, others: [{ slot, kind }] }.
  async probeSlots(pingMs) {
    const others = [], held = [];
    for (const slot of SLOTS) {
      const owner = SLOT_OWNERS.get(slotKey(this.pid, slot));
      if (owner && owner !== this.id) { held.push({ slot, owner }); continue; }
      this.index = slot;
      let ver = null;
      try { ver = await this.ping(pingMs); } catch { continue; }   // empty, asleep or off: the receiver's answer is a short report this channel does not read
      if (!ver) continue;
      this.features = {};
      let dpi;
      try { dpi = await this.getFeature(F.ADJUSTABLE_DPI); } catch (e) { if (!(e instanceof HidppError)) continue; dpi = null; }   // gone quiet again: treated as asleep
      // a mouse with 0x2202 and no 0x2201 (the PRO X2 SUPERSTRIKE: O, X, S feature tables) is a mouse too
      if (!dpi) { try { dpi = await this.getFeature(F.EXT_ADJUSTABLE_DPI); } catch (e) { if (!(e instanceof HidppError)) continue; dpi = null; } }
      if (dpi) { this.protocol = ver; SLOT_OWNERS.set(slotKey(this.pid, slot), this.id); return { mouse: slot, others, held }; }
      others.push({ slot, kind: await this.deviceKind() });
    }
    this.features = {}; this.index = null;
    return { mouse: null, others, held };
  },
  // Solaar hidpp20.py get_kind(): DEVICE_NAME fn 0x20, byte 0 = DEVICE_KIND; null when the device has no 0x0005
  async deviceKind() {
    try {
      const f = await this.getFeature(F.DEVICE_NAME);
      if (!f) return null;
      this.features = { [F.DEVICE_NAME]: f };
      const p = await this.call(F.DEVICE_NAME, 0x20);
      return KIND[p[0]] || `kind ${p[0]}`;
    } catch { return null; } finally { this.features = {}; }
  },
  notMineText(others) {
    const o = others[0];
    const what = o.kind && o.kind !== 'mouse' ? `a ${o.kind}` : o.kind === 'mouse' ? 'a mouse without a DPI feature (0x2201 or 0x2202) this driver reads' : 'a device without a DPI feature (0x2201 or 0x2202)';
    return `the Logitech device on receiver ${hex4(this.pid)} (slot ${o.slot}) is ${what}, not a mouse this driver runs: the mouse driver leaves it alone`;
  },
  heldText(held) {
    const h = held[0];
    return `the Logitech device on receiver ${hex4(this.pid)} (slot ${h.slot}) is run by ${h.owner} and no mouse answered: the mouse driver leaves it alone`;
  },
  // let go of the receiver, so another driver can open it (on a receiver shared with the keyboard driver the handle may
  // be that driver's too: let go of it without closing it)
  stepAside() {
    releaseSlots(this.id);
    if (!(this.receiver && SHARED_WITH_KEYBOARD.includes(this.pid))) { try { this.dev?.close?.(); } catch {} }
    this.dev = null; this.chan = null; this.features = {}; this.asleep = false;
  },
  // asleep at connect: is the mouse back? (public/core/devices.js asks before each look at an asleep device). Asks the slots
  // at most every 30 s, 1 s each; true = read now (the mouse answered, or something else did and read() says so).
  async awake() {
    if (!this.asleep) return true;
    if (Date.now() - (this.wokeAt || 0) < WAKE_EVERY_MS) return false;
    this.wokeAt = Date.now();
    const found = await this.probeSlots(Math.min(this.pingMs, WAKE_PING_MS)).catch(() => ({ mouse: null, others: [] }));
    if (found.mouse) {
      try { await this.finishConnect(); } catch (e) { if (e.notMine) { this.pendingNotMine = e.message; return true; } releaseSlots(this.id); this.index = null; return false; }
      this.asleep = false;
      return true;
    }
    if (found.others.length) { this.pendingNotMine = this.notMineText(found.others); return true; }
    if (found.held?.length) { this.pendingNotMine = this.heldText(found.held); return true; }
    return false;
  },
  async needAwake() {
    if (this.pendingNotMine) { const t = this.pendingNotMine; this.pendingNotMine = null; this.stepAside(); throw notMine(t); }
    if (!this.chan) throw Object.assign(new Error('the mouse is not connected'), { gone: true });
    if (this.asleep && !(await this.awake())) throw asleepError(this.pid);
    if (this.pendingNotMine) return this.needAwake();
  },

  async finishConnect() {
    // feature lookup through IRoot getFeature (section 2), cached per connect (indexes change between models/firmware)
    // Bluetooth: the report rate is the USB / Lightspeed polling rate; over Bluetooth the link sets it and no source
    // documents 0x8060 / 0x8061 there, so it is not looked up (and so not read, offered or written)
    const rateIds = this.ble ? [] : [F.EXT_REPORT_RATE, F.REPORT_RATE];
    for (const id of [F.FEATURE_SET, F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.BATTERY_VOLTAGE, F.ADJUSTABLE_DPI, F.EXT_ADJUSTABLE_DPI, ...rateIds, F.ONBOARD_PROFILES, F.ANALOG_BUTTONS]) {
      const f = await this.getFeature(id);
      if (f) this.features[id] = f;
    }
    // only reached for a slot whose device answered 0x2201 / 0x2202, or a wired / Bluetooth mouse; one without either is
    // stepped aside from
    if (!this.features[F.ADJUSTABLE_DPI] && !this.features[F.EXT_ADJUSTABLE_DPI]) { this.stepAside(); throw notMine(`this Logitech device (${hex4(this.pid)}) has no DPI feature (0x2201 or 0x2202): it is not a mouse this driver runs, so the mouse driver leaves it alone`); }
    // the PRO X2 SUPERSTRIKE: its cable id, or (on a receiver, where the wpid is not read) its HITS feature 0x1B0C, which
    // S 40BD.txt lists on this model and K PROTOCOL.md calls "a brand-new vendor feature ID"; no source names another
    // mouse with it. Its stale getters (header) make DPI, rate, lift-off and profile shown-only.
    this.superstrike = this.pid === SUPERSTRIKE.cable || !!this.features[F.ANALOG_BUTTONS];
    await this.readCaps();
    return true;
  },

  // one HID++ 2.0 request: [dev, feature index, fn | swid, params...] (section 2 "Message format"); returns the 16
  // parameter bytes of the reply. Only ALLOWED pairs are sent. A read is retried once after no reply (a sleeping mouse).
  async call(featureId, fn, params = [], { retry = true, timeoutMs = 2600 } = {}) {
    if (NEVER.includes(featureId) || (NEVER_FN[featureId] || []).includes(fn) || !(ALLOWED[featureId] || []).includes(fn)) throw new Error(`refused: feature 0x${hex4(featureId)} function 0x${fn.toString(16)} is not one this driver sends`);
    const index = featureId === F.ROOT ? 0 : this.features[featureId]?.index;
    if (!index && featureId !== F.ROOT) throw new Error(`the mouse has no feature 0x${hex4(featureId)}`);
    const out = [this.index, index, (fn & 0xf0) | SW_ID, ...params];
    const what = `0x${hex4(featureId)} fn 0x${fn.toString(16).padStart(2, '0')}`;
    let r;
    try { r = await this.chan.request(out, { timeoutMs }); }
    catch (e) { if (!retry || /refused/.test(e.message)) throw e; r = await this.chan.request(out, { timeoutMs }); }
    if (r[1] === 0xff && r[2] === index && r[3] === out[2]) throw new HidppError(r[4], what);
    return r.slice(3, 19);
  },

  // IRoot ping, function 0x10, params 00 00 <mark>: reply b0 major, b1 minor, b2 the mark (section 2)
  async ping(timeoutMs = this.pingMs) {
    const mark = 0x5a;
    const p = await this.call(F.ROOT, 0x10, [0x00, 0x00, mark], { retry: false, timeoutMs });
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
    resetShapes();
    this.shownOnly = new Set();
    if (this.features[F.ADJUSTABLE_DPI]) await this.readDpiCaps();
    else {
      // 0x2202 only (the SUPERSTRIKE): the current DPI from fn 0x50 (S ExtendedAdjustableDpi read_fnid 0x50; X fn5
      // [sensor] -> [echo][curX]...). Writing needs its paged DPI list (fn 0x20) and, on the SUPERSTRIKE, a getter that
      // does not lag: shown only.
      this.caps.dpi = { ext: true };
      showOnly('dpi', this.superstrike
        ? 'Shown only: this mouse reads back a stale DPI after a change (linux-superstrike, superstrike controller), so DeviceHub cannot prove a DPI write. Change DPI with DPI stage.'
        : 'Shown only: this mouse has only the 0x2202 DPI feature, whose DPI list DeviceHub does not read yet.', 'DPI');
      this.shownOnly.add('dpi');
    }
    await this.readOtherCaps();
  },
  async readDpiCaps() {
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
    const s = byKey('dpi');
    if (range) Object.assign(s, { type: 'slider', min: range.min, max: range.max, step: range.step }), delete s.options;
    else Object.assign(s, { type: 'choice', options: list.map((v) => ({ value: v, label: `${v} DPI` })) });
  },
  async readOtherCaps() {
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
    if (this.caps.rate) byKey('reportRate').options = [...this.caps.rate.hz].sort((a, b) => a - b).map((hz) => ({ value: hz, label: `${hz} Hz` }));
    // SUPERSTRIKE: 0x8061 fn 0x20 "STALE after writes" (X section 5; O "Stale in some states"), so a rate write cannot be
    // read back: shown only. Its list (fn 0x10) is still read: the cable lists up to 1000 Hz, the receiver 8000 (X).
    if (this.caps.rate && this.superstrike) {
      showOnly('reportRate', `Shown only: this mouse reads back the old rate after a change (superstrike controller, linux-superstrike), so DeviceHub cannot prove a rate write. It lists ${this.caps.rate.hz.join(', ')} Hz on this connection.`, 'Hz');
      this.shownOnly.add('reportRate');
    }

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
        byKey('profile').options = Array.from({ length: c[3] }, (_, i) => ({ value: i + 1, label: `Profile ${i + 1}` }));
      }
      if (PROFILE_READ_1BASED.includes(this.pid)) this.profileReadBase = 1;
      // SUPERSTRIKE: fn 0x40 returns the active profile's SECTOR (X section 6 "fn4 get -> sector u16 (live: 0x0001)";
      // O "fn4 (0x40) getCurrent"), and both units map slot n to sector n (O control sector; X RAM directory), so the
      // reading is 1-based. Shown only: a select reloads the profile (O), see the header.
      if (this.superstrike) {
        this.profileReadBase = 1;
        showOnly('profile', 'Shown only: selecting a profile on this mouse reloads it (linux-superstrike), which resets the live DPI stage and HITS button settings, so DeviceHub does not write it.');
        this.shownOnly.add('profile');
      }
    }
    // SUPERSTRIKE lift-off: the LOD byte's meaning differs between sources (S: 0 low / 1 medium / 2 high and the CLI doc
    // offers LOW / HIGH; X: G HUB sends LOD 1 / 2 / 3), and it is written with the 0x2202 DPI write: not offered.
    if (this.superstrike) this.shownOnly.add('liftOff');

    // HITS (0x1B0C) caps fn 0x00 -> [flags, buttons, act<<2, rt<<2, hap<<2, ...] (S AnalogButtonTuning.build, O
    // AnalogCaps, X ss2k_hits_caps). Offered only when every maximum is on the << 2 grid and within the documented range.
    this.caps.hits = null;
    if (this.features[F.ANALOG_BUTTONS]) {
      const c = await this.call(F.ANALOG_BUTTONS, 0x00).catch((e) => { if (e instanceof HidppError) return null; throw e; });
      const grid = (b) => (b & 0x03) === 0;
      if (c && grid(c[2]) && grid(c[3]) && grid(c[4])) {
        const m = { act: c[2] >> 2, rt: c[3] >> 2, hap: c[4] >> 2 };
        const ok = Object.entries(m).every(([f, v]) => v >= Math.max(1, HITS_DOC[f].min) && v <= HITS_DOC[f].max);
        // the firmware reports 3 buttons; only 0 (left) and 1 (right) answer (S min(caps[1], 2); O; X)
        const buttons = Math.min(c[1], 2);
        if (ok && buttons >= 1) {
          this.caps.hits = { ...m, buttons, raw: Array.from(c.slice(0, 6)) };
          for (const [k, [b, f]] of Object.entries(HITS)) if (b < buttons) byKey(k).max = m[f];
        }
      }
    }
    // the page's list: every setting except HITS ones this mouse does not have
    settings.splice(0, settings.length, ...ALL.filter((s) => !HITS[s.key] || (this.caps.hits && HITS[s.key][0] < this.caps.hits.buttons)));
  },

  // 0x1B0C fn 0x20 [btn] -> the 4-byte record [btn, act<<2, (rt<<2)|flag, hap<<2] (header)
  async readHitsRaw(btn) {
    const p = await this.call(F.ANALOG_BUTTONS, 0x20, [btn]);
    return Array.from(p.slice(0, 4));
  },
  async readHits() {
    const out = {};
    if (!this.caps.hits) return out;
    for (let b = 0; b < this.caps.hits.buttons; b++) {
      const lv = hitsLevels(await this.readHitsRaw(b), b, this.caps.hits);
      for (const [k, [kb, f]] of Object.entries(HITS)) if (kb === b && lv[f] !== undefined) out[k] = lv[f];
    }
    return out;
  },

  // 0x2202 fn 0x50 [00] -> b1-2 X, b5-6 Y, b9 LOD (Solaar ExtendedAdjustableDpi validate_read)
  async readExt() {
    const p = await this.call(F.EXT_ADJUSTABLE_DPI, 0x50, [0]);
    return { x: (p[1] << 8) | p[2], y: (p[5] << 8) | p[6], lod: p[9] };
  },
  async readLiftOff() {
    if (!this.caps.ext?.lod || this.superstrike) return undefined;
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
    // 0x2202 only: fn 0x50 [00] -> b1-2 current X, b3-4 default X (X fn5 [echo][curX][defX][curY][defY][lod])
    if (!this.features[F.ADJUSTABLE_DPI]) { const p = await this.call(F.EXT_ADJUSTABLE_DPI, 0x50, [0]); return { dpi: (p[1] << 8) | p[2], defaultDpi: (p[3] << 8) | p[4] }; }
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
    // asleep at connect: only what is known without the mouse
    if (this.asleep) return { Model: `Logitech mouse on receiver ${hex4(this.pid)} (not answering yet)`, Connection: this.pid === 0xc548 ? 'Bolt receiver' : 'Lightspeed receiver' };
    const bat = this.features[F.UNIFIED_BATTERY] ? '0x1004 unified' : this.features[F.BATTERY_STATUS] ? '0x1000 status' : this.features[F.BATTERY_VOLTAGE] ? '0x1001 voltage' : 'none reported';
    const mode = await this.readMode().catch(() => undefined);
    const out = {
      Model: this.receiver ? `Logitech ${this.superstrike ? 'PRO X2 SUPERSTRIKE (by its HITS feature 0x1B0C)' : 'mouse'} on receiver ${hex4(this.pid)} (slot ${this.index})` : (WIRED[this.pid] || BLE[this.pid] ? `Logitech ${WIRED[this.pid] || BLE[this.pid]}` : `Logitech mouse ${hex4(this.pid)}`),
      Connection: this.receiver ? (this.pid === 0xc548 ? 'Bolt receiver' : 'Lightspeed receiver') : this.ble ? 'Bluetooth' : 'USB cable',
      'HID++': this.protocol,
      Battery: bat,
      'Report rate feature': this.features[F.EXT_REPORT_RATE] ? '0x8061 (up to 8000 Hz)' : this.features[F.REPORT_RATE] ? '0x8060' : 'none',
    };
    if (mode) out['Settings source'] = mode === 'onboard' ? 'onboard profiles (DPI and rate changes need host mode)' : mode;
    if (this.caps.profiles) out['Onboard profiles'] = String(this.caps.profiles);
    if (this.caps.ext) out['Lift-off'] = this.caps.ext.lod ? 'low / medium / high (0x2202)' : 'not adjustable';
    if (this.caps.dpi) out['DPI range'] = this.caps.dpi.ext ? 'read through 0x2202 (not listed)' : this.caps.dpi.list ? this.caps.dpi.list.join(', ') : `${this.caps.dpi.min}-${this.caps.dpi.max} in steps of ${this.caps.dpi.step}`;
    if (this.caps.hits) out['HITS buttons'] = `${this.caps.hits.buttons} (actuation 1-${this.caps.hits.act}, rapid trigger 1-${this.caps.hits.rt}, haptics 0-${this.caps.hits.hap}; 0x1B0C)`;
    else if (this.features[F.ANALOG_BUTTONS]) out['HITS buttons'] = 'present (0x1B0C), but its capabilities did not read as documented, so not offered';
    if (this.shownOnly?.size) out['Shown only'] = [...this.shownOnly].map((k) => byKey(k).label).join(', ');
    return out;
  },

  async read() {
    await this.needAwake();
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
    Object.assign(v, await this.readHits());
    return v;
  },

  // DeviceHub's minute look at a wireless mouse (public/core/devices.js, quick): only what its buttons change, DPI and
  // the DPI stage (DeviceHub keeps the rest as last read); a full read still comes every 10 minutes (31 Oct 2026: every
  // minute was a whole read, about 9 radio requests, where the built-in mouse needs 2)
  async wakeRead() {
    await this.needAwake();
    const v = { dpi: (await this.readDpi()).dpi };
    const stage = await this.readDpiStage();
    if (stage !== undefined) v.dpiStage = stage;
    return v;
  },

  // one setting, then read back; a read-back that differs throws (CLAUDE.md: reported as failed)
  async write(key, value) {
    if (!this.chan) throw new Error('the mouse is not connected');
    if (this.asleep) throw Object.assign(asleepError(this.pid), { waiting: true });
    if (!settings.some((s) => s.key === key)) throw new Error(HITS[key] ? `${key}: this mouse has no HITS buttons (0x1B0C) DeviceHub can read` : `${key} is not a setting`);
    // shown-only settings on this mouse (the SUPERSTRIKE's stale getters, header): refused before anything is sent
    if (this.shownOnly?.has(key)) throw new Error(`${byKey(key).label} is shown only on this mouse: ${key === 'liftOff' ? 'the sources disagree on its lift-off values' : 'its read-back cannot prove a write'} (docs/handoff/superstrike.md)`);
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
    } else if (HITS[key]) {
      const [btn, f] = HITS[key];
      const c = this.caps.hits;
      if (!Number.isInteger(value) || value < HITS_DOC[f].min || value > c[f]) throw new Error(`${byKey(key).label} must be a whole number ${HITS_DOC[f].min}-${c[f]}`);
      // the record read just before, with only this setting's byte changed (header): value << 2, and for the rapid
      // trigger byte 2's bit 0 kept as read (S _AnalogButtonRapidTriggerRW.write, O writeAnalog, X ss2k_hits_set).
      // Writing the value read sends back exactly the raw bytes read. Always sent, then read back byte for byte.
      const cur = await this.readHitsRaw(btn);
      if (cur[0] !== btn) throw new Error(`${byKey(key).label}: the mouse answered for button ${cur[0]}, not ${btn}, so nothing was written`);
      const i = HITS_DOC[f].byte;
      const out = [...cur];
      out[i] = f === 'rt' ? (value << 2) | (cur[2] & 0x01) : value << 2;
      await this.call(F.ANALOG_BUTTONS, 0x10, out, { retry: false });
      const after = await this.readHitsRaw(btn);
      if (after.some((b, j) => b !== out[j])) throw new Error(`${key}: sent ${hex(out)} but the mouse reads back ${hex(after)}`);
      back = hitsLevels(after, btn, c)[f];
    }
    if (back !== value) throw new Error(`${key}: wrote ${value} but the mouse reads back ${back}`);
    return back;
  },

  async battery() {
    if (this.asleep) return null;
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
    await this.needAwake();
    const dpi = await this.readDpi();
    return {
      pid: hex4(this.pid), index: this.index, protocol: this.protocol,
      features: Object.fromEntries(Object.entries(this.features).map(([id, f]) => [`0x${hex4(Number(id))}`, f])),
      caps: this.caps, ...dpi, reportRate: await this.readRate(), mode: await this.readMode(),
      ext: this.caps.ext ? await this.readExt() : undefined, profile: await this.readProfile(), dpiStage: await this.readDpiStage(),
      // the HITS records as raw bytes, exactly as read
      hits: this.caps.hits ? await (async () => { const r = []; for (let b = 0; b < this.caps.hits.buttons; b++) r.push(hex(await this.readHitsRaw(b))); return r; })() : undefined,
    };
  },
};

export default adapter;
