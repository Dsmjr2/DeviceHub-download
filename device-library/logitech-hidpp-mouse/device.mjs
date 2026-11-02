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
// and DPI slot (0x8100 fn 0xC0), lift-off (0x2202 fn 0x60, DPI rewritten as read), and since 1 Nov 2026 zone lights
// (0x8070 fn 0x30 in the RAM form, fn 0x80 software control) and button remaps (0x1B04 fn 0x30, remap only: never a
// divert or persist bit), each read back (LIGHTS and REMAP blocks below; writeShapeProblem). Writes are refused
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
// C541 / C545 are left out: the sheet (OpenRGB) names them G915 keyboard receivers. C547 is in (1 Nov 2026, a new-setup
// audit): it is the original PRO X SUPERLIGHT's receiver (Linux hid-logitech-dj, USB_DEVICE_ID_LOGITECH_NANO_RECEIVER_
// LIGHTSPEED_1_1; the C54D patch of Nov 2025 says the SUPERLIGHT 2's receiver "behaves like" C547) as well as a G915's
// second one (OpenRGB), so it is shared with the keyboard driver like C539 / C53F / C54D
export const RECEIVERS = [0xc539, 0xc53a, 0xc53d, 0xc53f, 0xc54d, 0xc547, 0xc548];
// SHARED_WITH_KEYBOARD (23 Oct 2026): device-library/logitech-hidpp-keyboard also runs these three LIGHTSPEED receivers
// (its SHARED: a keyboard paired to one, a PRO X TKL or G515, is found there by its DEVICE_NAME kind). Both drivers then
// get the same HID handle (helpers/hid-host.mjs provider() gives the first host for the vid / pid / usage page), so on
// these the mouse driver never closes the receiver when it steps aside; the keyboard driver uses its own HID++ software
// id there (0x0C), so neither takes the other's replies.
export const SHARED_WITH_KEYBOARD = [0xc539, 0xc53f, 0xc54d, 0xc547];
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
// + 1 Nov 2026: 0x8070 COLOR_LED_EFFECTS and 0x1B04 REPROG_CONTROLS_V4 (Solaar hidpp20_constants.py @ e7304c4c; libratbag
// hidpp20.h HIDPP_PAGE_COLOR_LED_EFFECTS @ 8235b5bb). See LIGHTS and REMAP below for every byte.
export const F = { ROOT: 0x0000, FEATURE_SET: 0x0001, DEVICE_NAME: 0x0005, BATTERY_STATUS: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, ANALOG_BUTTONS: 0x1b0c, REPROG_V4: 0x1b04, ADJUSTABLE_DPI: 0x2201, EXT_ADJUSTABLE_DPI: 0x2202, COLOR_LED: 0x8070, REPORT_RATE: 0x8060, EXT_REPORT_RATE: 0x8061, ONBOARD_PROFILES: 0x8100 };
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
  // zone lights (LIGHTS below): info 0x00, zone info 0x10, effect info 0x20, set zone effect 0x30 (RAM form only: call()
  // refuses one with a persistence byte), software control get 0x70 / set 0x80 (Solaar LEDControl), get zone effect 0xE0
  // (libratbag CMD_COLOR_LED_EFFECTS_GET_ZONE_EFFECT; Solaar LEDZoneSetting.build read_fnid 0xE0)
  [F.COLOR_LED]: [0x00, 0x10, 0x20, 0x30, 0x70, 0x80, 0xe0],
  // button remap (REMAP below): getCount 0x00, getCidInfo 0x10, getCidReporting 0x20, setCidReporting 0x30 (remap only:
  // call() refuses any divert / persist / raw XY bit)
  [F.REPROG_V4]: [0x00, 0x10, 0x20, 0x30],
};
// the memory functions of 0x8100 (sheet section 4 "Risky writes": they rewrite flash); call() refuses them even if they
// were ever added to ALLOWED by mistake
// + 0x8070's other functions (OpenRGB LogitechProtocolCommon.h enum LOGITECH_FP8070 @ f81fd322: 0x40 SET_CFG, 0x50 GET_CFG,
// 0x60 GET_BIN_INFO, 0x90 GET_STATUS, 0xA0 CLEAR_EFFECT, 0xB0 SET_DIR, 0xC0 GET_COLOUR, 0xD0 SYNC_CFG, 0xF0 SET_BIN_INFO):
// the NV config and bin functions are never sent
export const NEVER_FN = { [F.ONBOARD_PROFILES]: [0x50, 0x60, 0x70, 0x80], [F.COLOR_LED]: [0x40, 0x50, 0x60, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xf0] };
// the only shapes of the two new writes call() sends (1 Nov 2026), whatever builds them:
//   0x8070 fn 0x30: exactly 12 parameter bytes [zone, effect index, 10 effect bytes]; byte 12, the persistence byte
//     (libratbag hidpp20_color_led_effects_set_zone_effect: "parameters[12] = 1, /* write to RAM and flash */"; OpenRGB
//     setMode: data[12] = 0x00 on 0x8070), is never given, so it goes out as 0x00 (the frame is zero-padded)
//   0x1B04 fn 0x30: exactly [cid hi, cid lo, 0x00, remap hi, remap lo]: the flags byte is 0 (no divert, no persist, no raw
//     XY, and none of their "valid" bits, so the mouse keeps its own divert state: x1b04 spec setCidReporting), remap non-zero
export function writeShapeProblem(featureId, fn, params) {
  if (featureId === F.COLOR_LED && fn === 0x30 && params.length !== 12) return '0x8070 set zone effect must be 12 bytes (no persistence byte)';
  if (featureId === F.COLOR_LED && fn === 0x80 && !(params.length === 1 && (params[0] === 0 || params[0] === 1))) return '0x8070 software control must be [00] or [01]';
  if (featureId === F.REPROG_V4 && fn === 0x30 && !(params.length === 5 && params[2] === 0x00 && ((params[3] << 8) | params[4]) !== 0)) return '0x1B04 setCidReporting must be a remap only (flags 00, target not 0)';
  return null;
}
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

// ---- LIGHTS: zone lighting effects, feature 0x8070 COLOR_LED_EFFECTS (1 Nov 2026) ----
// Sources, read-only, by commit:
//   SO = pwr-Solaar/Solaar @ e7304c4c451cc9bb4f206a914844525e67856a28: lib/logitech_receiver/hidpp20.py LEDEffectsInfo,
//        LEDZoneInfo, LEDEffectInfo, LEDEffectSetting.from_bytes / to_bytes, LEDEffects; settings_templates.py
//        LEDControl, LEDZoneSetting.setup / build (read 0xE0, write 0x30, suffix b""); tests/logitech_receiver/
//        test_setting_templates.py (the LEDZoneSetting fixture: read 0xE0 [00] -> "000000000000010050", write 0x30
//        "000000000000000101500000") and test_hidpp20_complex.py test_LEDZoneInfo_to_command
//   LR = libratbag/libratbag @ 8235b5bb6032dea15901ab58a8218956f4494d08: src/hidpp20.c hidpp20_color_led_effects_get_info,
//        _get_zone_info, _get_zone_effect_info, _set_zone_effect, _get_zone_effect; src/hidpp20.h struct
//        hidpp20_color_led_info / _zone_info / _zone_effect_info, struct hidpp20_internal_led (the effect byte layouts)
//   OR = CalcProgrammer1/OpenRGB @ f81fd32259fdd1cdcf506c9797c4be3730dfa0b3: Controllers/LogitechController/
//        LogitechProtocolCommon.cpp logitech_device::setMode (0x8070 data[12] = 0x00) and the 0x8070 enumeration
// Reads:
//   fn 0x00 -> [zone count, nv caps (2), ext caps (2)] (LR struct hidpp20_color_led_info; SO "!BHH"); ext caps bit 0 = the
//     mouse can read a zone's effect back (LR HIDPP20_COLOR_LED_INFO_EXT_CAP_HAS_ZONE_EFFECT = 0x01, the gate of
//     get_zone_effect; SO readable = capabilities & 0x1). Without it nothing is offered: a write could not be read back.
//   fn 0x10 [zone] -> [zone, location (2, big-endian), effect count, persistency caps] (LR get_zone_info; SO "!HB" at 1..3)
//   fn 0x20 [zone, effect index] -> [zone, effect index, effect id (2), caps (2), period (2)] (LR, SO LEDEffectInfo "!BBHHH")
//   fn 0xE0 [zone] -> the zone's current effect: [effect index, 10 effect bytes] (SO from_bytes(reply, options): bytes[0]
//     is the effect INDEX in the zone's list, the effect's fields at 1 + offset; its own fixture reads ID 3 period 0x100
//     intensity 0x50 from "00 00 00 00 00 00 01 00 50")
// Write: fn 0x30 [zone, effect index, 10 effect bytes] (SO LEDZoneInfo.to_command: int2bytes(zone) + int2bytes(i) +
//   to_bytes()[1:], suffix b""; OR setMode data[0] = zone, data[1] = the index into the zone's effect list). Byte 12, the
//   persistence byte, is never sent (writeShapeProblem): OR sends 0x00 there on 0x8070, LR's 1 is "write to RAM and flash".
// WHERE THE SOURCES DISAGREE: LR puts the effect ID (not the index) in byte 1, and reads 0xE0 as [zone, effect id, ...].
//   Two of the three (SO with a matched read and write and its own fixtures, OR's write) use the index and the layout
//   above, so DeviceHub does. Three guards keep LR's reading from doing harm: (1) a zone's reading is used only when it is
//   clean in SO's layout (a known effect at that index, and every byte that effect does not use is 0); (2) it is also
//   parsed in LR's layout ([zone, effect id, 10 bytes]); when that parse is clean too and means something else, the two
//   sources disagree about this very reading, so the zone is shown in info as unread and offered nothing (an all-off
//   zone reads the same both ways and is used); (3) every write is read back byte for byte and, on a mismatch, the bytes
//   read before are written back and the write fails.
// Effect ids and field offsets (into the 10 effect bytes), where SO LEDEffects and LR struct hidpp20_internal_led agree:
//   0x00 off (SO "Disabled", LR HIDPP20_LED_OFF): no fields
//   0x01 static (SO "Static", LR HIDPP20_LED_ON / FIXED): colour 0-2; byte 3 kept as read (SO ramp, LR fixed.effect)
//   0x03 cycle (SO "Cycle", LR HIDPP20_LED_CYCLE): period 5-6 (ms, big-endian), intensity 7 (SO 0-100; LR "1 - 100
//     percent, 0 means 100")
//   0x0A breathe (SO "Breathe", LR HIDPP20_LED_BREATHING): colour 0-2, period 3-4, byte 5 kept as read (SO form, LR
//     waveform), intensity 6
//   Other effect ids a mouse lists (wave 0x04, ripple 0x0B, boot 0x08 ...) are not offered: they are never written, and a
//   zone currently on one shows its effect as "other (0x..)" in info only.
// Ranges: period 1000-20000 ms (SO LEDZoneSetting.period_field), intensity 0-100 (SO intensity_field); a field missing
//   when switching effect takes SO's defaults (LEDEffects: period 5000, intensity 100; ramp / form 0 = "Default").
// Software control (SO LEDControl): read fn 0x70 -> b0, write fn 0x80 [01 / 00], 1 = the host (DeviceHub) drives the
//   lights, 0 = the mouse; SO's description: zone effects need it on. Offered as its own toggle, read back.
export const LED_EFFECTS = {
  0x00: { name: 'off', label: 'Off', fields: {} },
  0x01: { name: 'static', label: 'Static', fields: { color: 0 }, keep: [3] },
  0x03: { name: 'cycle', label: 'Cycle', fields: { period: 5, intensity: 7 } },
  0x0a: { name: 'breathe', label: 'Breathe', fields: { color: 0, period: 3, intensity: 6 }, keep: [5] },
};
const FIELD_LEN = { color: 3, period: 2, intensity: 1 };
export const LED_PERIOD = { min: 1000, max: 20000, step: 100, def: 5000 };
export const LED_INTENSITY = { min: 0, max: 100, def: 100 };
// SO hidpp20.py LEDZoneLocations (= LR enum hidpp20_color_led_location)
export const LED_LOCATIONS = { 0: 'Lights', 1: 'Primary', 2: 'Logo', 3: 'Left side', 4: 'Right side', 5: 'Combined', 6: 'Primary 1', 7: 'Primary 2', 8: 'Primary 3', 9: 'Primary 4', 10: 'Primary 5', 11: 'Primary 6' };
const colorHex = (b, o) => '#' + [b[o], b[o + 1], b[o + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
const used = (id) => { const e = LED_EFFECTS[id]; const s = new Set(e.keep || []); for (const [f, o] of Object.entries(e.fields)) for (let i = 0; i < FIELD_LEN[f]; i++) s.add(o + i); return s; };
// one parse: effect id + its 10 bytes -> { id, effect, color?, period?, intensity?, bytes } or null when not clean
function ledParse(id, p) {
  if (!LED_EFFECTS[id]) return null;
  const u = used(id);
  if (p.some((x, i) => x !== 0 && !u.has(i))) return null;
  const f = LED_EFFECTS[id].fields, out = { id, effect: LED_EFFECTS[id].name, bytes: p };
  if ('color' in f) out.color = colorHex(p, f.color);
  if ('period' in f) out.period = (p[f.period] << 8) | p[f.period + 1];
  if ('intensity' in f) out.intensity = p[f.intensity];
  return out;
}
const sameMeaning = (a, b) => a.id === b.id && a.color === b.color && a.period === b.period && a.intensity === b.intensity;
// a 0xE0 reply for zone `zi` with its effect list -> { index, id, effect, color?, period?, intensity?, bytes } in SO's
// layout, or null: not clean there, or clean in LR's layout too with another meaning (WHERE THE SOURCES DISAGREE).
// `why` on the zone says which.
// two setting values the same? Objects (a colour per zone, a remap) key by key, whatever order the keys come in
export function sameValue(x, y) {
  if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
    const kx = Object.keys(x), ky = Object.keys(y);
    return kx.length === ky.length && kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && sameValue(x[k], y[k]));
  }
  return JSON.stringify(x) === JSON.stringify(y);
}
export function ledReading(r, zone, zi) {
  if (!r || !zone) return null;
  const index = r[0], eff = zone.effects[index];
  const so = eff ? ledParse(eff.id, Array.from(r.slice(1, 11))) : null;
  if (!so) { zone.why = 'its reading is not in the layout Solaar documents'; return null; }
  const lr = r[0] === zi && zone.effects.some((e) => e.id === r[1]) ? ledParse(r[1], Array.from(r.slice(2, 12))) : null;
  if (lr && !sameMeaning(so, lr)) { zone.why = `Solaar and libratbag read this zone differently (${so.effect} / ${lr.effect})`; return null; }
  zone.why = null;
  return { index, ...so };
}
// the 10 effect bytes for an effect with these fields; `keepFrom` = the bytes read just before when the effect is unchanged
// (so a same-value write sends back exactly what was read), else the kept bytes are 0 (SO default)
export function ledBytes(id, { color, period, intensity }, keepFrom) {
  const e = LED_EFFECTS[id], f = e.fields;
  const p = keepFrom ? [...keepFrom] : Array(10).fill(0);
  if ('color' in f) { const n = parseInt(color.slice(1), 16); p[f.color] = (n >> 16) & 0xff; p[f.color + 1] = (n >> 8) & 0xff; p[f.color + 2] = n & 0xff; }
  if ('period' in f) { p[f.period] = (period >> 8) & 0xff; p[f.period + 1] = period & 0xff; }
  if ('intensity' in f) p[f.intensity] = intensity;
  return p;
}

// ---- REMAP: button remap, feature 0x1B04 REPROG_CONTROLS_V4 (1 Nov 2026) ----
// Sources, read-only, by commit:
//   SPEC = Logitech's x1b04 SpecialKeysMseButtons v2 (lekensteyn.nl/files/logitech/x1b04_specialkeysmsebuttons.html,
//          which Solaar cites): getCount [0], getCidInfo [1], getCidReporting [2], setCidReporting [3] and their packets
//   SO   = Solaar @ e7304c4c: hidpp20.py KeysArrayV4._query_key (fn 0x10 "!HHBBBBB": cid, task, flags, pos, group, gmask,
//          flags2), ReprogrammableKeyV4.remappable_to / _getCidReporting / _setCidReporting / remap, KeyFlag, MappingFlag;
//          settings_templates.py ReprogrammableKeys (only keys with more than one target); special_keys.py CONTROL (names)
// Reads: fn 0x00 -> b0 count; fn 0x10 [index] -> [cid (2), task (2), flags, pos, group, gmask, flags2]; fn 0x20 [cid (2)]
//   -> [cid (2), flags (divert 0x01, persist 0x04, raw XY 0x10), remap (2)], remap 0 = mapped to itself (SPEC; SO
//   "mapped_to if mapped_to != 0 else cid").
// Write: fn 0x30 [cid (2), 00, remap (2)] (SO remap(): flags {} so bfield 0, struct "!HBH"; SPEC: a remap is temporary,
//   reset to the control's own id on a HID++ configuration reset; remap 0 = keep, so 0 is never sent; "To disable the
//   remapping, remap the control to its own control ID"). The flags byte is always 0, so no divert or persist bit nor any
//   "valid" bit is ever sent (writeShapeProblem): DeviceHub never diverts a button to itself (it does not handle
//   diverted-button events) and never writes a persistent mapping.
// Buttons offered: a physical control (not virtual 0x80) with the reprog flag 0x10 (SPEC: "required for the control to
//   appear as configurable") and more than one target (SO ReprogrammableKeys.build), never Left Button 0x0050. Targets: the
//   button's own id, then every control whose group is in its gmask (SO remappable_to; SPEC "can be remapped to any control
//   ID contained in the specified groups"). Names: SO special_keys.CONTROL.
export const LEFT_CLICK = 0x0050;
export const KEY_FLAGS = { mouse: 0x01, reprog: 0x10, divert: 0x20, persist: 0x40, virtual: 0x80 };
export const REMAP_FLAGS = { divert: 0x01, persist: 0x04, rawXY: 0x10 };
// Solaar special_keys.py CONTROL @ e7304c4c (NamedInts names: "__" -> "/", "_" -> " "), plus its G1-G32, M1-M8 and MR
export const CONTROL = {
  0x0001: 'Volume Up old', 0x0002: 'Volume Down old', 0x0003: 'Mute', 0x0004: 'Play/Pause old', 0x0005: 'Next',
  0x0006: 'Previous', 0x0007: 'Stop', 0x0008: 'Application Switcher', 0x0009: 'Burn', 0x000a: 'Calculator',
  0x000b: 'Calendar', 0x000c: 'Close', 0x000d: 'Eject', 0x000e: 'Mail', 0x000f: 'Help As HID', 0x0010: 'Help As F1',
  0x0011: 'Launch Word Proc', 0x0012: 'Launch Spreadsheet', 0x0013: 'Launch Presentation', 0x0014: 'Undo As Ctrl Z',
  0x0015: 'Undo As HID', 0x0016: 'Redo As Ctrl Y', 0x0017: 'Redo As HID', 0x0018: 'Print As Ctrl P',
  0x0019: 'Print As HID', 0x001a: 'Save As Ctrl S', 0x001b: 'Save As HID', 0x001c: 'Preset A', 0x001d: 'Preset B',
  0x001e: 'Preset C', 0x001f: 'Preset D', 0x0020: 'Favorites', 0x0021: 'Gadgets', 0x0022: 'My Home',
  0x0023: 'Gadgets As Win G', 0x0024: 'Maximize As HID', 0x0025: 'Maximize As Win Shift M', 0x0026: 'Minimize As HID',
  0x0027: 'Minimize As Win M', 0x0028: 'Media Player', 0x0029: 'Media Center Logi', 0x002a: 'Media Center Msft',
  0x002b: 'Custom Menu', 0x002c: 'Messenger', 0x002d: 'My Documents', 0x002e: 'My Music', 0x002f: 'Webcam',
  0x0030: 'My Pictures', 0x0031: 'My Videos', 0x0032: 'My Computer As HID', 0x0033: 'My Computer As Win E',
  0x0034: 'FN Key', 0x0035: 'Launch Picture Viewer', 0x0036: 'One Touch Search', 0x0037: 'Preset 1',
  0x0038: 'Preset 2', 0x0039: 'Preset 3', 0x003a: 'Preset 4', 0x003b: 'Record', 0x003c: 'Internet Refresh',
  0x003e: 'Search', 0x003f: 'Shuffle', 0x0040: 'Sleep', 0x0041: 'Internet Stop', 0x0042: 'Synchronize',
  0x0043: 'Zoom', 0x0044: 'Zoom In As HID', 0x0045: 'Zoom In As Ctrl Wheel', 0x0046: 'Zoom In As Cltr Plus',
  0x0047: 'Zoom Out As HID', 0x0048: 'Zoom Out As Ctrl Wheel', 0x0049: 'Zoom Out As Ctrl Minus', 0x004a: 'Zoom Reset',
  0x004b: 'Zoom Full Screen', 0x004c: 'Print Screen', 0x004d: 'Pause Break', 0x004e: 'Scroll Lock',
  0x004f: 'Contextual Menu', 0x0050: 'Left Button', 0x0051: 'Right Button', 0x0052: 'Middle Button',
  0x0053: 'Back Button', 0x0054: 'Back', 0x0055: 'Back As Alt Win Arrow', 0x0056: 'Forward Button',
  0x0057: 'Forward As HID', 0x0058: 'Forward As Alt Win Arrow', 0x0059: 'Button 6', 0x005a: 'Left Scroll As Button 7',
  0x005b: 'Left Tilt', 0x005c: 'Right Scroll As Button 8', 0x005d: 'Right Tilt', 0x005e: 'Button 9',
  0x005f: 'Button 10', 0x0060: 'Button 11', 0x0061: 'Button 12', 0x0062: 'Button 13', 0x0063: 'Button 14',
  0x0064: 'Button 15', 0x0065: 'Button 16', 0x0066: 'Button 17', 0x0067: 'Button 18', 0x0068: 'Button 19',
  0x0069: 'Button 20', 0x006a: 'Button 21', 0x006b: 'Button 22', 0x006c: 'Button 23', 0x006d: 'Button 24',
  0x006e: 'Show Desktop', 0x006f: 'Screen Lock', 0x0070: 'Fn F1', 0x0071: 'Fn F2', 0x0072: 'Fn F3', 0x0073: 'Fn F4',
  0x0074: 'Fn F5', 0x0075: 'Fn F6', 0x0076: 'Fn F7', 0x0077: 'Fn F8', 0x0078: 'Fn F9', 0x0079: 'Fn F10',
  0x007a: 'Fn F11', 0x007b: 'Fn F12', 0x007c: 'Fn F13', 0x007d: 'Fn F14', 0x007e: 'Fn F15', 0x007f: 'Fn F16',
  0x0080: 'Fn F17', 0x0081: 'Fn F18', 0x0082: 'Fn F19', 0x0083: 'IOS Home', 0x0084: 'Android Home',
  0x0085: 'Android Menu', 0x0086: 'Android Search', 0x0087: 'Android Back', 0x0088: 'Home Combo',
  0x0089: 'Lock Combo', 0x008a: 'IOS Virtual Keyboard', 0x008b: 'IOS Language Switch', 0x008c: 'Mac Expose',
  0x008d: 'Mac Dashboard', 0x008e: 'Win7 Snap Left', 0x008f: 'Win7 Snap Right', 0x0090: 'Minimize Window',
  0x0091: 'Maximize Window', 0x0092: 'Win7 Stretch Up', 0x0093: 'Win7 Monitor Switch As Win Shift LeftArrow',
  0x0094: 'Win7 Monitor Switch As Win Shift RightArrow', 0x0095: 'Switch Screen', 0x0096: 'Win7 Show Mobility Center',
  0x0097: 'Analog HScroll', 0x009f: 'Metro Appswitch', 0x00a0: 'Metro Appbar', 0x00a1: 'Metro Charms',
  0x00a2: 'Calc Vkeyboard', 0x00a3: 'Metro Search', 0x00a4: 'Combo Sleep', 0x00a5: 'Metro Share',
  0x00a6: 'OS Settings', 0x00a7: 'Metro Devices', 0x00a9: 'Metro Start Screen', 0x00aa: 'Zoomin', 0x00ab: 'Zoomout',
  0x00ac: 'Back Hscroll', 0x00ae: 'Show Desktop HPP', 0x00b7: 'Fn Left Click', 0x00b8: 'Second Left Click',
  0x00b9: 'Fn Second Left Click', 0x00ba: 'Multiplatform App Switch', 0x00bb: 'Multiplatform Home',
  0x00bc: 'Multiplatform Menu', 0x00bd: 'Multiplatform Back', 0x00be: 'Multiplatform Insert',
  0x00bf: 'Screen Capture/Print Screen', 0x00c0: 'Fn Down', 0x00c1: 'Fn Up', 0x00c2: 'Multiplatform Lock',
  0x00c3: 'Mouse Gesture Button', 0x00c4: 'Smart Shift', 0x00c5: 'Microphone', 0x00c6: 'Wifi',
  0x00c7: 'Brightness Down', 0x00c8: 'Brightness Up', 0x00c9: 'Display Out/Project Screen ', 0x00ca: 'View Open Apps',
  0x00cb: 'View All Apps', 0x00cc: 'Switch App', 0x00cd: 'Fn Inversion Change', 0x00ce: 'MultiPlatform Back',
  0x00cf: 'MultiPlatform Forward', 0x00d0: 'MultiPlatform Gesture Button', 0x00d1: 'Host Switch Channel 1',
  0x00d2: 'Host Switch Channel 2', 0x00d3: 'Host Switch Channel 3', 0x00d4: 'MultiPlatform Search',
  0x00d5: 'MultiPlatform Home/Mission Control', 0x00d6: 'MultiPlatform Menu/Show/Hide Virtual Keyboard/Launchpad',
  0x00d7: 'Virtual Gesture Button', 0x00d8: 'Cursor Button Long Press', 0x00d9: 'Next Button Shortpress',
  0x00da: 'Next Button Long Press', 0x00db: 'Back Button Short Press', 0x00dc: 'Back Button Long Press',
  0x00dd: 'Multi Platform Language Switch', 0x00de: 'F Lock', 0x00df: 'Switch Highlight',
  0x00e0: 'Mission Control/Task View', 0x00e1: 'Dashboard Launchpad/Action Center', 0x00e2: 'Backlight Down',
  0x00e3: 'Backlight Up', 0x00e4: 'Previous Track', 0x00e5: 'Play/Pause', 0x00e6: 'Next Track', 0x00e7: 'Mute Sound',
  0x00e8: 'Volume Down', 0x00e9: 'Volume Up', 0x00ea: 'App Contextual Menu/Right Click', 0x00eb: 'Right Arrow',
  0x00ec: 'Left Arrow', 0x00ed: 'DPI Change', 0x00ee: 'Open New Tab', 0x00ef: 'F2', 0x00f0: 'F3', 0x00f1: 'F4',
  0x00f2: 'F5', 0x00f3: 'F6', 0x00f4: 'F7', 0x00f5: 'F8', 0x00f6: 'F1', 0x00f7: 'Next Color Effect',
  0x00f8: 'Increase Color Effect Speed', 0x00f9: 'Decrease Color Effect Speed',
  0x00fa: 'Load Lighting Custom Profile', 0x00fb: 'Laser Button Short Press', 0x00fc: 'Laser Button Long Press',
  0x00fd: 'DPI Switch', 0x00fe: 'Multiplatform Home/Show Desktop', 0x00ff: 'Multiplatform App Switch/Show Dashboard',
  0x0100: 'Multiplatform App Switch 2', 0x0101: 'Fn Inversion/Hot Key', 0x0102: 'LeftAndRightClick',
  0x0103: 'Dictation', 0x0104: 'Emoji Smiley Heart Eyes', 0x0105: 'Emoji Crying Face', 0x0106: 'Emoji Smiley',
  0x0107: 'Emoji Smilie With Tears', 0x0108: 'Emoji', 0x0109: 'Multiplatform App Switch/Launchpad',
  0x010a: 'Screen Capture', 0x010b: 'Grave Accent', 0x010c: 'Tab Key', 0x010d: 'Caps Lock', 0x010e: 'Left Shift',
  0x010f: 'Left Control', 0x0110: 'Left Option/Start', 0x0111: 'Left Command/Alt', 0x0112: 'Right Command/Alt',
  0x0113: 'Right Option/Start', 0x0114: 'Right Control', 0x0115: 'Right Shift', 0x0116: 'Insert', 0x0117: 'Delete',
  0x0118: 'Home', 0x0119: 'End', 0x011a: 'Page Up', 0x011b: 'Page Down', 0x011c: 'Mute Microphone',
  0x011d: 'Do Not Disturb', 0x011e: 'Backslash', 0x011f: 'Refresh', 0x0120: 'Close Tab', 0x0121: 'Lang Switch',
  0x0122: 'Standard Key A', 0x0123: 'Standard Key B', 0x0124: 'Standard Key C', 0x013c: 'Right Option/Start/2',
  0x0141: 'Play/Pause mini', 0x01a0: 'Haptic', 0x01a3: 'Circle', 0x01a4: 'Triangle', 0x01a5: 'Diamond',
  0x01a6: 'Star', 0x01a9: 'Cut', 0x01aa: 'Copy', 0x01ab: 'Paste', 0x01ac: 'Video On Off', 0x01b4: 'AI', 0x1001: 'G1',
  0x1002: 'G2', 0x1003: 'G3', 0x1004: 'G4', 0x1005: 'G5', 0x1006: 'G6', 0x1007: 'G7', 0x1008: 'G8', 0x1009: 'G9',
  0x100a: 'G10', 0x100b: 'G11', 0x100c: 'G12', 0x100d: 'G13', 0x100e: 'G14', 0x100f: 'G15', 0x1010: 'G16',
  0x1011: 'G17', 0x1012: 'G18', 0x1013: 'G19', 0x1014: 'G20', 0x1015: 'G21', 0x1016: 'G22', 0x1017: 'G23',
  0x1018: 'G24', 0x1019: 'G25', 0x101a: 'G26', 0x101b: 'G27', 0x101c: 'G28', 0x101d: 'G29', 0x101e: 'G30',
  0x101f: 'G31', 0x1020: 'G32', 0x1101: 'M1', 0x1102: 'M2', 0x1103: 'M3', 0x1104: 'M4', 0x1105: 'M5', 0x1106: 'M6',
  0x1107: 'M7', 0x1108: 'M8', 0x1200: 'MR',
};
export const controlName = (cid) => CONTROL[cid] || `unknown:${cid.toString(16).toUpperCase().padStart(4, '0')}`;
const cidKey = (cid) => cid.toString(16).padStart(4, '0');

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
  unsupported: ['editing onboard profiles (buttons, the DPI of each slot, sleep timer, lights)', 'lighting through 0x8071 RGB_EFFECTS (no read-back) and 0x8070 effects other than off, static, cycle and breathe', 'diverting buttons to DeviceHub, persistent remaps (0x1C00) and key remaps to keys or macros', 'angle snapping', 'surface tuning', 'firmware updates', 'pairing',
    'PRO X2 SUPERSTRIKE: writing DPI, report rate, lift-off and the profile (shown only: see docs/handoff/superstrike.md), the rapid-trigger on/off flag, gaming surface mode (0x8090) and the bunny-hop filter (0x80E0)'],

  // the vendor-app check (replaceable in tests): resolves with the running G HUB process name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name) && !/service|updater|crash/i.test(name)) return name; }   // a service or updater is not the app (1 Nov 2026: Synapse's service kept the device read-only, nothing to close)
    return null;
  },

  dev: null, chan: null, index: DEV_WIRED, features: {}, caps: {}, asleep: false, usbId: null,
  pingMs: 2600,   // how long a slot's ping waits (tests shorten it)

  // product ids added by the library's family match (numbers), none when there are none
  familyIds() { return (this.familyPids || []).map((p) => parseInt(p, 16)).filter((n) => Number.isInteger(n) && !RECEIVERS.includes(n) && !WIRED[n] && !BLE[n]); },
  async connect(prompt) {
    releaseSlots(this.id);
    this.dev = null; this.chan = null; this.features = {}; this.caps = {}; this.profileReadBase = undefined; this.asleep = false; this.usbId = null; this.wokeAt = 0; this.pendingNotMine = null; this.superstrike = false; this.shownOnly = new Set();
    // every id in turn (31 Oct 2026): a receiver that holds only a keyboard (or a keyboard driver's slots) no longer hides a
    // wired mouse or a mouse on another receiver further down the list; "not mine" only once every id was tried. Wired and
    // receivers first, then Bluetooth (no usage page in the filter: BLE_HID picks the collection), then a model not listed
    // here, matched by its HID++ collection (device.json family, helpers/my-devices.mjs familyPids): it must answer HID++
    // 2.0 and have a DPI feature, else the driver steps aside.
    if (injected) return this.connectTo(injected);
    const tries = [
      ...[...RECEIVERS, ...Object.keys(WIRED).map(Number)].map((pid) => [{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }]),
      ...Object.keys(BLE).map(Number).map((pid) => [{ vendorId: VID, productId: pid }]),
      ...this.familyIds().map((pid) => [{ vendorId: VID, productId: pid, usagePage: 0xff00, usage: 0x0002 }]),
    ];
    // (31 Oct 2026) a receiver with no mouse answering is kept, but the ids further down are still tried: a mouse charging
    // on its cable while its receiver is plugged in is run on the cable instead of waiting "asleep" on the receiver. An
    // id that fails for another reason no longer ends the search either; its error is given only if nothing else worked.
    let lastNotMine = null, firstError = null, sleeping = null, any = false;
    for (const filters of tries) {
      const pid = filters[0].productId;
      if (sleeping && pid >= 0xc500 && pid <= 0xc5ff) continue;   // a receiver is held asleep already: only cabled and Bluetooth ids after it (probing another receiver's slots took up to ~18 s)
      const dev = await getDevice(filters, { prompt: false });
      if (!dev || dev === sleeping?.dev) continue;
      any = true;
      this.features = {}; this.caps = {}; this.asleep = false; this.pendingNotMine = null; this.superstrike = false; this.shownOnly = new Set(); this.profileReadBase = undefined;
      try {
        const r = await this.connectTo(dev);
        if (!this.asleep) { if (sleeping) this.letGo(sleeping); return r; }
        if (!sleeping) sleeping = this.held(); else this.letGo(this.held());
      } catch (err) {
        if (err?.notMine) lastNotMine = err;
        else { firstError ||= err; releaseSlots(this.id); if (this.dev === dev) { this.letGo(this.held()); this.dev = null; this.chan = null; } }
      }
    }
    if (sleeping) { Object.assign(this, sleeping); return true; }
    if (firstError) throw firstError;
    if (lastNotMine) throw lastNotMine;
    if (!any && prompt) {
      const dev = await getDevice(RECEIVERS.concat(Object.keys(WIRED).map(Number)).map((p) => ({ vendorId: VID, productId: p, usagePage: 0xff00, usage: 0x0002 })));
      if (dev) return this.connectTo(dev);
    }
    return false;
  },

  // one opened id: a receiver's slots, or the wired / Bluetooth mouse itself
  async connectTo(dev) {
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
  // connect(): what one opened id left, kept while the ids after it are tried; letGo closes one that is not used (a
  // receiver shared with the keyboard driver is left open, as stepAside does)
  held() { return { dev: this.dev, chan: this.chan, pid: this.pid, receiver: this.receiver, ble: this.ble, usbId: this.usbId, index: this.index, asleep: this.asleep, wokeAt: this.wokeAt, protocol: this.protocol, features: this.features, caps: this.caps, profileReadBase: this.profileReadBase, superstrike: this.superstrike, shownOnly: this.shownOnly, pendingNotMine: this.pendingNotMine }; },
  letGo(h) { if (!(h.receiver && SHARED_WITH_KEYBOARD.includes(h.pid))) { try { h.dev?.close?.(); } catch {} } },
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
    for (const id of [F.FEATURE_SET, F.UNIFIED_BATTERY, F.BATTERY_STATUS, F.BATTERY_VOLTAGE, F.ADJUSTABLE_DPI, F.EXT_ADJUSTABLE_DPI, ...rateIds, F.ONBOARD_PROFILES, F.ANALOG_BUTTONS, F.COLOR_LED, F.REPROG_V4]) {
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
    const shape = writeShapeProblem(featureId, fn, params);
    if (shape) throw new Error(`refused: ${shape}`);
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
    // (lift-off is left out of its settings: has.liftOff below)

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
    // the page's list: every setting this mouse has, the same rule as its reads (31 Oct 2026: a Bluetooth mouse was
    // offered "1000 Hz" and its write failed with "report rate must be one of  Hz"; a SUPERSTRIKE showed a lift-off it
    // never reports)
    const has = {
      reportRate: !!this.caps.rate,
      profile: !!this.caps.profiles,
      dpiStage: !!this.caps.profiles,
      mode: !!this.features[F.ONBOARD_PROFILES],
      liftOff: !!this.caps.ext?.lod && !this.superstrike,
    };
    await this.readLightCaps();
    await this.readRemapCaps();
    settings.splice(0, settings.length, ...ALL.filter((s) => (has[s.key] ?? true) && (!HITS[s.key] || (this.caps.hits && HITS[s.key][0] < this.caps.hits.buttons))), ...this.lightSettings(), ...this.remapSettings());
  },

  // ---- LIGHTS (header block above LED_EFFECTS) ----
  // fn 0x00 info, fn 0x10 per zone, fn 0x20 per effect; only zones whose effect list holds one DeviceHub knows, and only
  // when ext caps bit 0 says the zone effect reads back. A refusal (HidppError) leaves the lights out, never guessed.
  async readLightCaps() {
    this.caps.lights = null;
    if (!this.features[F.COLOR_LED]) return;
    const soft = (p) => p.catch((e) => { if (e instanceof HidppError) return null; throw e; });
    const info = await soft(this.call(F.COLOR_LED, 0x00));
    if (!info) return;
    const count = info[0], ext = (info[3] << 8) | info[4];
    const lights = { count, readable: !!(ext & 0x01), zones: [], swControl: false };
    if (count < 1 || count > 8) { this.caps.lights = { ...lights, why: `it reports ${count} zones` }; return; }
    for (let z = 0; z < count; z++) {
      const zi = await soft(this.call(F.COLOR_LED, 0x10, [z]));
      if (!zi || zi[0] !== z) continue;
      const zone = { index: z, location: (zi[1] << 8) | zi[2], effects: [] };
      for (let i = 0; i < zi[3] && i < 16; i++) {
        const ei = await soft(this.call(F.COLOR_LED, 0x20, [z, i]));
        if (!ei || ei[0] !== z || ei[1] !== i) { zone.effects = null; break; }
        zone.effects.push({ index: i, id: (ei[2] << 8) | ei[3], caps: (ei[4] << 8) | ei[5], period: (ei[6] << 8) | ei[7] });
      }
      if (!zone.effects || !zone.effects.some((e) => LED_EFFECTS[e.id])) continue;
      zone.label = LED_LOCATIONS[zone.location] || `Zone ${z + 1}`;
      if (lights.zones.some((o) => o.label === zone.label)) zone.label = `${zone.label} ${z + 1}`;
      lights.zones.push(zone);
    }
    // software control (SO LEDControl: read fn 0x70 -> b0); offered only when it reads 0 or 1
    const sw = await soft(this.call(F.COLOR_LED, 0x70));
    lights.swControl = !!sw && (sw[0] === 0 || sw[0] === 1);
    this.caps.lights = lights;
  },
  ledZone(z) { return this.caps.lights?.zones.find((x) => x.index === z); },
  // the page's light settings: one effect choice per zone (only the effects that zone lists), one colour with every zone
  // that has a coloured effect, a speed (period) and brightness per zone that has cycle or breathe, and the software
  // control toggle. None when the zone effect cannot be read back.
  lightSettings() {
    const L = this.caps.lights;
    if (!L?.readable || !L.zones.length) return [];
    const out = [];
    if (L.swControl) out.push({ key: 'lightControl', label: 'Lights controlled by DeviceHub', type: 'toggle', hint: 'Off = the mouse runs its own lighting. Solaar: the zone effects need this on.' });
    for (const z of L.zones) {
      const known = z.effects.filter((e) => LED_EFFECTS[e.id]);
      out.push({ key: `light${z.index}Effect`, label: `${z.label} effect`, type: 'choice', options: known.map((e) => ({ value: LED_EFFECTS[e.id].name, label: LED_EFFECTS[e.id].label })), hint: 'Only the effects this zone reports. Live; the mouse may load its stored lighting when it restarts.' });
    }
    const colored = L.zones.filter((z) => z.effects.some((e) => e.id === 0x01 || e.id === 0x0a));
    if (colored.length) out.push({ key: 'lightColor', label: 'Light color', type: 'color', zones: colored.map((z) => ({ value: String(z.index), label: z.label })), hint: 'For zones on Static or Breathe.' });
    for (const z of L.zones) {
      if (!z.effects.some((e) => e.id === 0x03 || e.id === 0x0a)) continue;
      out.push({ key: `light${z.index}Period`, label: `${z.label} speed`, type: 'slider', min: LED_PERIOD.min, max: LED_PERIOD.max, step: LED_PERIOD.step, unit: 'ms', hint: 'One cycle or breath, in milliseconds (lower = faster). Cycle and Breathe only.' });
      out.push({ key: `light${z.index}Brightness`, label: `${z.label} brightness`, type: 'slider', min: LED_INTENSITY.min, max: LED_INTENSITY.max, step: 1, unit: '%', hint: 'Cycle and Breathe only (libratbag: 0 reads as full on some mice).' });
    }
    return out;
  },
  // fn 0xE0 [zone] -> the raw reply (12 bytes kept: index + 10 effect bytes, and the byte after for LR's layout)
  async readLedRaw(z) { return Array.from((await this.call(F.COLOR_LED, 0xe0, [z])).slice(0, 12)); },
  async readLights() {
    const out = {};
    const L = this.caps.lights;
    if (!L?.readable || !L.zones.length) return out;
    if (L.swControl) { const p = await this.call(F.COLOR_LED, 0x70); if (p[0] === 0 || p[0] === 1) out.lightControl = p[0] === 1; }
    const colors = {};

    for (const z of L.zones) {
      const r = ledReading(await this.readLedRaw(z.index), z, z.index);
      z.current = r;
      if (!r) continue;
      out[`light${z.index}Effect`] = r.effect;
      if (r.color !== undefined) colors[String(z.index)] = r.color;
      if (r.period !== undefined) { out[`light${z.index}Period`] = r.period; out[`light${z.index}Brightness`] = r.intensity; }
    }
    // the colour is reported only while every coloured zone shows one (a zone on Cycle or Off has no colour to read)
    const cz = settings.find((s) => s.key === 'lightColor')?.zones || [];
    if (cz.length && cz.every((z) => colors[z.value] !== undefined)) out.lightColor = Object.fromEntries(cz.map((z) => [z.value, colors[z.value]]));
    return out;
  },
  // one zone written in the RAM form and read back byte for byte; on a mismatch the bytes read before go back
  async writeLedZone(z, index, bytes, before) {
    await this.call(F.COLOR_LED, 0x30, [z, index, ...bytes], { retry: false });
    const after = await this.readLedRaw(z);
    const want = [index, ...bytes];
    if (want.some((b, i) => after[i] !== b)) {
      let back = '';
      if (before) { try { await this.call(F.COLOR_LED, 0x30, [z, before[0], ...before.slice(1, 11)], { retry: false }); back = ' (the zone was put back as read before)'; } catch { back = ' (and putting it back failed)'; } }
      throw new Error(`lights zone ${z + 1}: sent ${hex(want)} but the mouse reads back ${hex(after.slice(0, 11))}${back}`);
    }
    return after;
  },
  async writeLight(key, value) {
    const L = this.caps.lights;
    if (!L?.readable) throw new Error('this mouse cannot read its lights back, so DeviceHub does not change them');
    if (key === 'lightControl') {
      if (typeof value !== 'boolean') throw new Error('Lights controlled by DeviceHub must be on or off');
      // SO LEDControl: write fn 0x80 [01 / 00], read fn 0x70 -> b0
      await this.call(F.COLOR_LED, 0x80, [value ? 1 : 0], { retry: false });
      const p = await this.call(F.COLOR_LED, 0x70);
      return p[0] === 1 ? true : p[0] === 0 ? false : `unknown (${p[0]})`;
    }
    if (key === 'lightColor') {
      const s = settings.find((x) => x.key === 'lightColor');
      if (!value || typeof value !== 'object' || s.zones.some((z) => !/^#[0-9a-f]{6}$/.test(value[z.value] ?? '')) || Object.keys(value).length !== s.zones.length) throw new Error(`Light color must give #rrggbb for ${s.zones.map((z) => z.label).join(', ')}`);
      const cur = {};
      for (const z of s.zones) {
        const raw = await this.readLedRaw(Number(z.value));
        const zone = this.ledZone(Number(z.value));
        const r = ledReading(raw, zone, zone.index);
        if (!r) throw new Error(`${z.label}: its current lighting could not be read (${zone.why}), so nothing was written`);
        if (r.color === undefined) throw new Error(`${z.label} is on ${LED_EFFECTS[r.id].label}, which has no color: pick Static or Breathe for it first`);
        cur[z.value] = { r, raw };
      }
      // only the zones that change; none changing (the self-check's same-value write) = every zone with its own value
      let send = s.zones.filter((z) => value[z.value] !== cur[z.value].r.color);
      if (!send.length) send = s.zones;
      // a zone that fails puts itself back (writeLedZone); every zone already sent goes back to its bytes as read too, so
      // a failure never leaves the mouse half changed, and the error says what was put back
      const done = [];
      for (const z of send) {
        const { r, raw } = cur[z.value];
        try { await this.writeLedZone(Number(z.value), r.index, ledBytes(r.id, { ...r, color: value[z.value] }, r.bytes), raw); }
        catch (e) {
          const back = [];
          // the failing zone too when its own error did not put it back (a send that timed out may have landed)
          const own = /put back|putting it back/.test(e.message) ? [] : [z];
          for (const d of [...own, ...done.reverse()]) {
            const was = cur[d.value].raw;
            let ok = false;
            try { await this.call(F.COLOR_LED, 0x30, [Number(d.value), was[0], ...was.slice(1, 11)], { retry: false }); const now = await this.readLedRaw(Number(d.value)); ok = was.slice(0, 11).every((b, i) => now[i] === b); } catch {}
            back.push(`${d.label} ${ok ? 'was put back as read before' : 'could not be put back'}`);
          }
          throw new Error(`${e.message}${back.length ? `; ${back.join('; ')}` : ''}`);
        }
        done.push(z);
      }
      return (await this.readLights()).lightColor;
    }
    const m = /^light(\d+)(Effect|Period|Brightness)$/.exec(key);
    const zone = m && this.ledZone(Number(m[1]));
    if (!zone) throw new Error(`${key} is not a setting`);
    const raw = await this.readLedRaw(zone.index);
    const r = ledReading(raw, zone, zone.index);
    if (!r) throw new Error(`${zone.label}: its current lighting could not be read (${zone.why}), so nothing was written`);
    if (m[2] === 'Effect') {
      const eff = zone.effects.find((e) => LED_EFFECTS[e.id]?.name === value);
      if (!eff) throw new Error(`${zone.label} effect must be one of ${zone.effects.filter((e) => LED_EFFECTS[e.id]).map((e) => LED_EFFECTS[e.id].name).join(', ')}`);
      // the same effect: its bytes as read (a same-value write sends back exactly what was read); another one: the fields
      // it shares with the current effect carried over, the rest SO's defaults (period 5000, intensity 100), the colour
      // another zone's or white
      const other = this.caps.lights.zones.map((z) => z.current?.color).find(Boolean);
      const fields = eff.id === r.id ? r : { color: r.color || other || '#ffffff', period: r.period ?? LED_PERIOD.def, intensity: r.intensity ?? LED_INTENSITY.def };
      await this.writeLedZone(zone.index, eff.index, ledBytes(eff.id, fields, eff.id === r.id ? r.bytes : null), raw);
      return (await this.readLights())[key];
    }
    const f = m[2] === 'Period' ? 'period' : 'intensity';
    const lim = f === 'period' ? LED_PERIOD : LED_INTENSITY;
    if (!Number.isInteger(value) || value < lim.min || value > lim.max) throw new Error(`${zone.label} ${f === 'period' ? 'speed' : 'brightness'} must be a whole number ${lim.min}-${lim.max}`);
    if (r[f] === undefined) throw new Error(`${zone.label} is on ${LED_EFFECTS[r.id].label}, which has no ${f === 'period' ? 'speed' : 'brightness'}: pick Cycle or Breathe first`);
    await this.writeLedZone(zone.index, r.index, ledBytes(r.id, { ...r, [f]: value }, r.bytes), raw);
    return (await this.readLights())[key];
  },

  // ---- REMAP (header block above CONTROL) ----
  async readRemapCaps() {
    this.caps.remap = null;
    if (!this.features[F.REPROG_V4]) return;
    const soft = (p) => p.catch((e) => { if (e instanceof HidppError) return null; throw e; });
    const c = await soft(this.call(F.REPROG_V4, 0x00));
    if (!c || c[0] < 1 || c[0] > 64) return;
    const keys = [];
    for (let i = 0; i < c[0]; i++) {
      const k = await soft(this.call(F.REPROG_V4, 0x10, [i]));
      if (!k) continue;
      keys.push({ index: i, cid: (k[0] << 8) | k[1], task: (k[2] << 8) | k[3], flags: k[4] | (k[8] << 8), pos: k[5], group: k[6], gmask: k[7] });
    }
    const groupCids = (g) => keys.filter((k) => k.group === g).map((k) => k.cid);
    const buttons = [];
    for (const k of keys) {
      if (k.cid === LEFT_CLICK || !(k.flags & KEY_FLAGS.reprog) || (k.flags & KEY_FLAGS.virtual) || !k.gmask) continue;
      const targets = [k.cid];
      for (let g = 1; g <= 8; g++) if (k.gmask & (1 << (g - 1))) for (const t of groupCids(g)) if (!targets.includes(t)) targets.push(t);
      if (targets.length > 1) buttons.push({ cid: k.cid, targets });
    }
    this.caps.remap = { count: c[0], keys, buttons };
  },
  remapSettings() {
    return (this.caps.remap?.buttons || []).map((b) => ({
      key: `remap${cidKey(b.cid)}`, label: `${controlName(b.cid)} button`, type: 'remap',
      buttons: [{ value: cidKey(b.cid), label: controlName(b.cid) }],
      targets: b.targets.map((t) => ({ value: cidKey(t), label: t === b.cid ? `${controlName(t)} (its own)` : controlName(t) })),
      hint: 'Only the actions this mouse lists for this button. Live: the mouse goes back to its own mapping when it restarts.',
    }));
  },
  // fn 0x20 [cid] -> { cid, flags, to } (remap 0 = itself), or null when the reply is for another control
  async readRemapRaw(cid) {
    const p = await this.call(F.REPROG_V4, 0x20, [cid >> 8, cid & 0xff]);
    const echo = (p[0] << 8) | p[1];
    if (echo !== cid) return null;
    const to = (p[3] << 8) | p[4];
    return { cid, flags: p[2], to: to || cid };
  },
  async readRemaps() {
    const out = {};
    for (const b of this.caps.remap?.buttons || []) {
      const r = await this.readRemapRaw(b.cid);
      if (r) out[`remap${cidKey(b.cid)}`] = { [cidKey(b.cid)]: cidKey(r.to) };
    }
    return out;
  },
  async writeRemap(key, value) {
    const b = (this.caps.remap?.buttons || []).find((x) => `remap${cidKey(x.cid)}` === key);
    if (!b) throw new Error(`${key} is not a setting`);
    const want = value && typeof value === 'object' ? value[cidKey(b.cid)] : undefined;
    const to = typeof want === 'string' && /^[0-9a-f]{4}$/.test(want) ? parseInt(want, 16) : NaN;
    if (Object.keys(value || {}).length !== 1 || !b.targets.includes(to)) throw new Error(`${controlName(b.cid)} can be mapped only to ${b.targets.map(controlName).join(', ')}`);
    const before = await this.readRemapRaw(b.cid);
    if (!before) throw new Error(`${controlName(b.cid)}: the mouse answered for another control, so nothing was written`);
    // setCidReporting [cid, 00, remap]: remap only, flags 0 (REMAP header; writeShapeProblem)
    await this.call(F.REPROG_V4, 0x30, [b.cid >> 8, b.cid & 0xff, 0x00, to >> 8, to & 0xff], { retry: false });
    const after = await this.readRemapRaw(b.cid);
    if (!after || after.to !== to || after.flags !== before.flags) {
      try { await this.call(F.REPROG_V4, 0x30, [b.cid >> 8, b.cid & 0xff, 0x00, before.to >> 8, before.to & 0xff], { retry: false }); } catch {}
      throw new Error(`${controlName(b.cid)}: mapped to ${controlName(to)} but the mouse reads back ${after ? `${controlName(after.to)}, flags ${after.flags}` : 'another control'} (put back to ${controlName(before.to)})`);
    }
    return { [cidKey(b.cid)]: cidKey(after.to) };
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
    const L = this.caps.lights;
    if (L) out.Lights = !L.readable ? `0x8070, ${L.count} zone(s), but it cannot read a zone's effect back, so not offered` : L.why ? `0x8070: not offered (${L.why})`
      : `0x8070: ${L.zones.map((z) => `${z.label} (${z.effects.map((e) => LED_EFFECTS[e.id]?.label || `other 0x${e.id.toString(16).padStart(2, '0')}`).join(', ')}${z.why ? `; not read: ${z.why}` : ''})`).join('; ') || 'no zone with an effect DeviceHub knows'}`;
    if (this.caps.remap) out['Button remap'] = this.caps.remap.buttons.length ? `0x1B04: ${this.caps.remap.buttons.map((b) => controlName(b.cid)).join(', ')} (live; never diverted)` : `0x1B04: ${this.caps.remap.count} controls, none this mouse lists as remappable`;
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
    Object.assign(v, await this.readLights());
    Object.assign(v, await this.readRemaps());
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
    if (!settings.some((s) => s.key === key)) throw new Error(HITS[key] ? `${key}: this mouse has no HITS buttons (0x1B0C) DeviceHub can read` : ALL.some((s) => s.key === key) ? `${ALL.find((s) => s.key === key).label}: this mouse does not have it (on this connection)` : `${key} is not a setting`);
    // shown-only settings on this mouse (the SUPERSTRIKE's stale getters, header): refused before anything is sent
    if (this.shownOnly?.has(key)) throw new Error(`${byKey(key).label} is shown only on this mouse: ${key === 'liftOff' ? 'the sources disagree on its lift-off values' : 'its read-back cannot prove a write'} (docs/handoff/superstrike.md)`);
    // waiting: true = refused only because of how things are right now (helpers/my-devices.mjs isWaiting): the library
    // self-check records it as waiting and tries again later, instead of failing it
    const app = await this.vendorApp();
    if (app) throw Object.assign(new Error(`${app} (G HUB) is running: close it first (two programs writing the mouse fight)`), { waiting: true });
    // lights (0x8070) and button remaps (0x1B04): each is read back inside (byte for byte, put back on a mismatch), then
    // the value read back must equal the one asked for
    if (key === 'lightControl' || key === 'lightColor' || /^light\d+(Effect|Period|Brightness)$/.test(key) || /^remap[0-9a-f]{4}$/.test(key)) {
      const got = key.startsWith('remap') ? await this.writeRemap(key, value) : await this.writeLight(key, value);
      // compared field by field (a colour zone by zone): the order its keys come in is not a difference
      if (!sameValue(got, value)) throw new Error(`${key}: wrote ${JSON.stringify(value)} but the mouse reads back ${JSON.stringify(got)}`);
      return got;
    }
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
      lights: this.caps.lights?.readable ? await (async () => { const r = {}; for (const z of this.caps.lights.zones) r[z.index] = hex(await this.readLedRaw(z.index)); return r; })() : undefined,
      remaps: this.caps.remap ? await (async () => { const r = {}; for (const b of this.caps.remap.buttons) r[cidKey(b.cid)] = await this.readRemapRaw(b.cid); return r; })() : undefined,
      hits: this.caps.hits ? await (async () => { const r = []; for (let b = 0; b < this.caps.hits.buttons; b++) r.push(hex(await this.readHitsRaw(b))); return r; })() : undefined,
    };
  },
};

export default adapter;
