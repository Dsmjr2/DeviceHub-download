// Razer keyboards over the 90-byte report (22 Oct 2026). Written only from OpenRazer, cited beside every command:
//   OpenRazer = github.com/openrazer/openrazer @ 477f4d6d3ab7e9deb6310d5bd3742560c5cbe80d, driver/
//     razerkbd_driver.c: razer_get_report_params (interface and wait per keyboard), razer_send_payload (reply checks),
//       razer_attr_read/write_matrix_brightness, _game_led_state, _macro_led_state, _poll_rate, _charge_level,
//       _charge_status, _charge_low_threshold, _firmware_version (transaction id per keyboard and command), and
//       razer_kbd_probe (which keyboard has which of these)
//     razerchromacommon.c: the class / id / size / argument layout of each command
//     razercommon.h: LED ids, VARSTORE / NOSTORE, status codes;  razerkbd_driver.h: product ids and wait times
//   sheet = docs/brands/razer.md (sections 2-4), which cites the same files.
// The report helpers (CRC, build, parse) are device-library/razer-mouse's, copied so this folder works on its own.
// Not run on a real keyboard: status "untested" in device.json; DeviceHub proves each write with its self-check first.
//
// Settings, each only where OpenRazer has both its read and its write for that keyboard: backlight brightness, game mode
// (OpenRazer: "Game mode will be enabled"; the firmware locks the Windows key), the macro light, polling rate
// (HyperPolling-style codes) and the low-battery threshold; battery and charging on the wireless boards.
// Since 2 Nov 2026 also the backlight's lighting effects and colours, as write-only settings (see "Lighting effects" below).
// Left out: per-key colour (the custom frame), the Fn toggle (write-only), keyswitch optimization and device mode (sheet: high risk), the profile LEDs,
// macros and key remaps (host-side in OpenRazer), and the Huntsman V3 Pro TKL's brightness (OpenRazer writes it but has
// no read for it). Never: dongle pair / unpair (00/46, 00/41, 00/42) and device mode 02 ("factory test mode"), in
// helpers/never-commands.json. Nothing outside CMD below can be built.
//
// Added 23 Oct 2026:
//   Huntsman Mini JP 0269 (OpenRazer: in every Huntsman Mini case: interface 2, brightness extended tid 3F read and
//     write, game and macro LED VARSTORE tid FF; daemon hardware/keyboards.py RazerHuntsmanMiniJP);
//   Huntsman V2 Analog 0266 and Huntsman Mini Analog 0282 (OpenRazer: interface 3, brightness written extended tid 1F
//     and read standard 03/83 tid FF, the Huntsman V3 Pro way; macro LED VARSTORE tid FF; daemon RazerHuntsmanV2Analog,
//     RazerHuntsmanMiniAnalog). Lights and info only: game mode (which OpenRazer also has) is left off these two, and
//     nothing about the analog switches (actuation, rapid trigger) is in any source;
//   BlackWidow V4 Pro 75% 02B3 (cable) / 02B4 (dongle) and BlackWidow V4 Low Profile TKL 02D4 (cable) / 02D2 (dongle):
//     not in OpenRazer @ 477f4d6d (its latest master). OpenRGB = gitlab.com/CalcProgrammer1/OpenRGB @ 817834cf,
//     Controllers/RazerController/: RazerDevices.h (the ids), RazerControllerDetect.cpp (interface 3 on the cable,
//     2 on the dongle), RazerDevices.cpp (transaction id 1F, and 9F on the Low Profile TKL's dongle), and
//     RazerController.cpp razer_get_firmware (00/81 size 02 on that transaction id). OpenRGB only ever writes their
//     brightness (NOSTORE, no read) and reads nothing else, so these four are info only (model and firmware): no
//     setting, no battery, until a source documents a read.
//
// Added 1 Nov 2026: 33 more keyboards from OpenRazer master (still 477f4d6d), each row stating every setting (row() below
// refuses one that does not). A value OpenRazer does not give for a keyboard is null: DeviceHub asks it with READS only
// when it connects, and offers the setting only when the read answers with a value this driver maps; its write is then
// the same command, size and transaction id the driver already uses for other keyboards (found below in ready()).
// Polling is null on all 33: OpenRazer's razer_attr_read/write_poll_rate have no case for them, so it neither has nor
// rules out polling_rate2. Battery is false on the cable-only boards (no charge_level / charge_status case).
// Left out, with reasons: the 49 laptops (the 48 Blade ids and the Book 2020: is_blade_laptop brightness is 0E/04, a
// command this driver does not have, and a laptop keyboard is not a USB keyboard to replace an app for); the 7 keypads
// (Tartarus, Tartarus Chroma, Tartarus V2, Tartarus Pro, Orbweaver, Orbweaver Chroma, Nostromo: not keyboards; their
// brightness is on ZERO_LED 0x00 or they have only the profile LEDs, neither of which this driver builds).
// Kept unchanged: every row above (its values are OpenRazer's or OpenRGB's; false = none, never asked).
import { getDevice } from '../../public/devices/hid.js';

// ---- the 90-byte report (razercommon.h struct razer_report; sheet section 2) ----
export const LEN = 90;
export const STATUS = { 0x00: 'new', 0x01: 'busy', 0x02: 'success', 0x03: 'failure', 0x04: 'timeout', 0x05: 'not supported' };
export const VARSTORE = 0x01, NOSTORE = 0x00;                     // razercommon.h
export const LED = { BACKLIGHT: 0x05, MACRO: 0x07, GAME: 0x08 };   // razercommon.h BACKLIGHT_LED, MACRO_LED, GAME_LED
// crc = XOR of bytes 2..87 (razercommon.c razer_calculate_crc)
export function crc(r) { let c = 0; for (let i = 2; i < 88; i++) c ^= r[i]; return c; }
// razercommon.c get_razer_report: status 0, transaction id, remaining 0, protocol 0, data size, class, id, arguments
export function buildReport(tid, cls, id, size, args = []) {
  if (size > 80 || args.length > 80) throw new Error('a Razer report carries at most 80 argument bytes');
  const r = new Uint8Array(LEN);
  r[1] = tid; r[5] = size; r[6] = cls; r[7] = id;
  r.set(args, 8);
  r[88] = crc(r);
  return r;
}
export function parseReply(u8) {
  return { status: u8[0], tid: u8[1], remaining: (u8[2] << 8) | u8[3], size: u8[5], cls: u8[6], id: u8[7], args: u8.slice(8, 88) };
}

// ---- the only commands this driver builds (razerchromacommon.c) ----
export const CMD = {
  firmware:    { cls: 0x00, id: 0x81, size: 0x02 },   // razer_chroma_standard_get_firmware_version; reply [0].[1]
  extBrightGet:{ cls: 0x0f, id: 0x84, size: 0x03 },   // razer_chroma_extended_matrix_get_brightness [store, led]; reply [2]
  extBrightSet:{ cls: 0x0f, id: 0x04, size: 0x03 },   // razer_chroma_extended_matrix_brightness [store, led, 0-255]
  stdBrightGet:{ cls: 0x03, id: 0x83, size: 0x03 },   // razer_chroma_standard_get_led_brightness [store, led]; reply [2]
  ledStateGet: { cls: 0x03, id: 0x80, size: 0x03 },   // razer_chroma_standard_get_led_state [store, led]; reply [2]
  ledStateSet: { cls: 0x03, id: 0x00, size: 0x03 },   // razer_chroma_standard_set_led_state [store, led, 0/1]
  pollGet:     { cls: 0x00, id: 0xc0, size: 0x01 },   // razer_chroma_misc_get_polling_rate2; reply [1]
  pollSet:     { cls: 0x00, id: 0x40, size: 0x02 },   // razer_chroma_misc_set_polling_rate2 [00, code]
  battery:     { cls: 0x07, id: 0x80, size: 0x02 },   // razer_chroma_misc_get_battery_level; reply [1] 0-255
  charging:    { cls: 0x07, id: 0x84, size: 0x02 },   // razer_chroma_misc_get_charging_status; reply [1] 0/1
  lowBatGet:   { cls: 0x07, id: 0x81, size: 0x01 },   // razer_chroma_misc_get_low_battery_threshold; reply [0]
  lowBatSet:   { cls: 0x07, id: 0x01, size: 0x01 },   // razer_chroma_misc_set_low_battery_threshold [0x0C-0x3F]
  activeStore: { cls: 0x05, id: 0x84, size: 0x01 },   // razerkbd_driver.c razer_get_active_varstore (Huntsman V3 Pro 8KHz); reply [0]
};
// razerchromacommon.c razer_chroma_misc_set_polling_rate2 codes
const bit = (b) => (b === 1 ? true : b === 0 ? false : null);
export const POLL = { 8000: 0x01, 4000: 0x02, 2000: 0x04, 1000: 0x08, 500: 0x10, 250: 0x20, 125: 0x40 };
// offered on every polling keyboard; a higher rate is offered once the keyboard itself reads at it
export const POLL_BASE = [125, 250, 500, 1000];
// razerchromacommon.c razer_chroma_misc_set_low_battery_threshold: clamp(0x0C, 0x3F); "0x3F = 25%, 0x26 = 15%, 0x0C = 5%"
export const LOWBAT_MIN = 0x0c, LOWBAT_MAX = 0x3f;

// ---- the keyboards (razerkbd_driver.h ids; razerkbd_driver.c per-keyboard switches) ----
// iface: razer_get_report_params report_index (the interface the report goes to): 3, 2, or the default 1.
// wait: ms between write and read: RAZER_BLACKWIDOW_CHROMA_WAIT_US 600 us, the _WIRELESS_WAIT_US ones 4900 us.
// bright: matrix_brightness. 'x3f' / 'x1f' / 'x9f' = extended 0x0F/0x84 and 0x0F/0x04 with that transaction id, read and
//   write; 'v3' = written extended (tid 1F), read standard 0x03/0x83 (tid FF) (Huntsman V3 Pro, V3 Pro Mini); '8k' = the
//   same, written to the active profile's store (Huntsman V3 Pro 8KHz); false = no brightness here (never asked).
// game: game_led_state, 'v2' = NOSTORE with tid 1F (Huntsman V2 / V2 TKL), 'std' = VARSTORE with tid FF; false = not offered.
// macro: true = macro_led_state (VARSTORE, tid FF) is created for it in razer_kbd_probe; false = not offered.
// poll: poll_rate's transaction id (polling_rate2), or false. bat: charge_level / charge_status transaction id, or false.
// lowBat: charge_low_threshold (tid FF) is created for it.
// null on bright / game / macro / poll / bat: OpenRazer does not say; asked with reads only (ready(), PROBE_TIDS).
// fw: the firmware read's transaction id (OpenRazer: FF on every keyboard; OpenRGB: the device's own id).
const W = 0.6, WL = 4.9;
export const OPTIONAL = ['bright', 'game', 'macro', 'poll', 'bat'];
const k = (model, link, iface, wait, bright, o = {}) => ({ model, link, iface, wait, bright, game: 'std', macro: true, poll: false, bat: false, lowBat: false, fw: 0xff, ...o });
// info only (OpenRGB): no brightness, game mode, macro light, polling or battery; firmware on the device's own tid
const info = (model, link, iface, wait, fw) => k(model, link, iface, wait, false, { game: false, macro: false, fw, infoOnly: true });
// rows added 1 Nov 2026: every optional setting stated (a value, false, or null = asked with reads only)
const row = (model, link, iface, wait, o) => {
  const miss = OPTIONAL.filter((f) => !(f in o));
  if (miss.length) throw new Error(`razer-keyboard ${model}: ${miss.join(', ')} not stated`);
  return { model, link, iface, wait, lowBat: false, fw: 0xff, ...o };
};
// razerkbd_driver.c razer_attr_read/write_matrix_brightness 0x3F case, game_led_state VARSTORE tid 0xFF, macro_led_state
// in razer_kbd_probe, no charge_level case (cable only), no poll_rate case
const EXT3F = { bright: 'x3f', game: 'std', macro: true, poll: null, bat: false };
// the same with matrix_brightness tid 0x1F
const EXT1F = { bright: 'x1f', game: 'std', macro: true, poll: null, bat: false };
// matrix_brightness is razer_chroma_standard_get_led_brightness (03/83) and razer_chroma_standard_set_led_brightness
// (03/03, BACKLIGHT_LED or LOGO_LED) with tid 0xFF: this driver has no 03/03, so brightness is not offered (false);
// game_led_state VARSTORE tid 0xFF and macro_led_state as above, cable only, no poll_rate case
const STD_OLD = { bright: false, game: 'std', macro: true, poll: null, bat: false };
export const MODELS = {
  '0287': k('BlackWidow V4', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '028D': k('BlackWidow V4 Pro', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '02A5': k('BlackWidow V4 75%', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '0293': k('BlackWidow V4 X', 'wired', 2, W, 'x1f'),
  '02B9': k('BlackWidow V4 Mini HyperSpeed', 'wired', 3, W, 'x1f', { bat: 0x1f }),
  '02BA': k('BlackWidow V4 Mini HyperSpeed', 'wireless', 3, WL, 'x9f', { bat: 0x9f }),
  '02D7': k('BlackWidow V4 TKL HyperSpeed', 'wired', 3, W, 'x1f', { macro: false, poll: 0x1f, bat: 0x1f }),
  '02D5': k('BlackWidow V4 TKL HyperSpeed', 'wireless', 2, WL, 'x9f', { macro: false, poll: 0x9f, bat: 0x9f }),
  '024E': k('BlackWidow V3', 'wired', 3, W, 'x3f'),
  '025A': k('BlackWidow V3 Pro', 'wired', 2, W, 'x3f', { bat: 0x3f, lowBat: true }),
  '025C': k('BlackWidow V3 Pro', 'wireless', 2, WL, 'x9f', { bat: 0x9f, lowBat: true }),
  '0258': k('BlackWidow V3 Mini HyperSpeed', 'wired', 3, W, 'x1f', { bat: 0x1f }),
  '0271': k('BlackWidow V3 Mini HyperSpeed', 'wireless', 3, WL, 'x9f', { bat: 0x9f }),
  '02A6': k('Huntsman V3 Pro', 'wired', 3, W, 'v3'),
  '02A7': k('Huntsman V3 Pro TKL', 'wired', 3, W, false),
  '02B0': k('Huntsman V3 Pro Mini', 'wired', 3, W, 'v3'),
  '02CF': k('Huntsman V3 Pro 8KHz', 'wired', 3, W, '8k'),
  '026C': k('Huntsman V2', 'wired', 3, W, 'x1f', { game: 'v2', poll: 0x1f }),
  '026B': k('Huntsman V2 TKL', 'wired', 3, W, 'x1f', { game: 'v2', poll: 0x1f }),
  '0257': k('Huntsman Mini', 'wired', 2, W, 'x3f'),
  '0269': k('Huntsman Mini JP', 'wired', 2, W, 'x3f'),
  '0266': k('Huntsman V2 Analog', 'wired', 3, W, 'v3', { game: false }),
  '0282': k('Huntsman Mini Analog', 'wired', 3, W, 'v3', { game: false }),
  '02B3': info('BlackWidow V4 Pro 75%', 'wired', 3, W, 0x1f),
  '02B4': info('BlackWidow V4 Pro 75%', 'wireless', 2, WL, 0x1f),
  '02D4': info('BlackWidow V4 Low Profile TKL', 'wired', 3, W, 0x1f),
  '02D2': info('BlackWidow V4 Low Profile TKL', 'wireless', 2, WL, 0x9f),
  '0295': k('DeathStalker V2', 'wired', 3, W, 'x3f'),
  '0292': k('DeathStalker V2 Pro', 'wired', 3, W, 'x3f', { bat: 0x1f }),
  '0290': k('DeathStalker V2 Pro', 'wireless', 2, WL, 'x9f', { bat: 0x9f }),
  '0298': k('DeathStalker V2 Pro TKL', 'wired', 3, W, 'x3f', { bat: 0x1f }),
  '0296': k('DeathStalker V2 Pro TKL', 'wireless', 2, WL, 'x9f', { bat: 0x9f }),
  '02A1': k('Ornata V3', 'wired', 2, W, 'x1f'),
  '028F': k('Ornata V3', 'wired', 2, W, 'x1f'),
  '02A3': k('Ornata V3 TKL', 'wired', 2, W, 'x1f'),
  '0294': k('Ornata V3 X', 'wired', 1, W, 'x1f'),
  '02A2': k('Ornata V3 X', 'wired', 1, W, 'x1f'),
  // ---- added 1 Nov 2026 from OpenRazer master @ 477f4d6d. Ids: razerkbd_driver.h USB_DEVICE_ID_RAZER_*; names and
  // USB_PID: daemon/openrazer_daemon/hardware/keyboards.py (class named beside each); interface and wait:
  // razerkbd_driver.c razer_get_report_params (report_index 2 where named there, else the default 1; wait
  // RAZER_BLACKWIDOW_CHROMA_WAIT_US 600 us on all of them) ----
  // matrix_brightness extended tid 0x3F (EXT3F above)
  '0235': row('BlackWidow Lite', 'wired', 1, W, EXT3F),                  // RazerBlackWidowLite
  '021F': row('Ornata', 'wired', 1, W, EXT3F),                           // RazerOrnata
  '021E': row('Ornata Chroma', 'wired', 1, W, EXT3F),                    // RazerOrnataChroma
  '0226': row('Huntsman Elite', 'wired', 1, W, EXT3F),                   // RazerHuntsmanElite
  '0227': row('Huntsman', 'wired', 1, W, EXT3F),                         // RazerHuntsman
  '0243': row('Huntsman Tournament Edition', 'wired', 2, W, EXT3F),      // RazerHuntsmanTournamentEdition (report_index 2)
  '0241': row('BlackWidow 2019', 'wired', 1, W, EXT3F),                  // RazerBlackWidow2019
  '0237': row('BlackWidow Essential', 'wired', 1, W, EXT3F),             // RazerBlackWidowEssential
  '022A': row('Cynosa Chroma', 'wired', 1, W, EXT3F),                    // RazerCynosaChroma
  '022C': row('Cynosa Chroma Pro', 'wired', 1, W, EXT3F),                // RazerCynosaChromaPro
  '023F': row('Cynosa Lite', 'wired', 1, W, EXT3F),                      // RazerCynosaLite
  '0A24': row('BlackWidow V3 Tenkeyless', 'wired', 2, W, EXT3F),         // RazerBlackWidowV3TK (report_index 2)
  // matrix_brightness extended tid 0x1F (EXT1F above)
  '0228': row('BlackWidow Elite', 'wired', 1, W, EXT1F),                 // RazerBlackWidowElite
  '025E': row('Cynosa V2', 'wired', 1, W, EXT1F),                        // RazerCynosaV2
  '025D': row('Ornata V2', 'wired', 2, W, EXT1F),                        // RazerOrnataV2 (report_index 2)
  // RazerJoro: charge_level / charge_status tid 0x1F (razer_attr_read_charge_level), its USB id is the cable one
  '02CD': row('Joro', 'wired', 1, W, { ...EXT1F, bat: 0x1f }),
  // standard brightness (STD_OLD above): game mode and the macro light only
  '010D': row('BlackWidow Ultimate 2012', 'wired', 1, W, STD_OLD),       // RazerBlackWidowUltimate2012
  '010E': row('BlackWidow Stealth Edition', 'wired', 1, W, STD_OLD),     // RazerBlackWidowStealthEdition
  '011A': row('BlackWidow Ultimate 2013', 'wired', 1, W, STD_OLD),       // RazerBlackWidowUltimate2013
  '011B': row('BlackWidow Stealth', 'wired', 1, W, STD_OLD),             // RazerBlackWidowStealth
  '011C': row('BlackWidow Tournament Edition 2014', 'wired', 1, W, STD_OLD), // RazerBlackWidowTournamentEdition2014
  '010F': row('Anansi', 'wired', 2, W, STD_OLD),                         // RazerAnansi (report_index 2)
  '0118': row('DeathStalker Essential', 'wired', 1, W, STD_OLD),         // RazerDeathStalkerEssential
  '0202': row('DeathStalker Expert', 'wired', 1, W, STD_OLD),            // RazerDeathStalkerExpert
  '0203': row('BlackWidow Chroma', 'wired', 1, W, STD_OLD),              // RazerBlackWidowChroma
  '0204': row('DeathStalker Chroma', 'wired', 1, W, STD_OLD),            // RazerDeathStalkerChroma
  '0209': row('BlackWidow Chroma Tournament Edition', 'wired', 1, W, STD_OLD), // RazerBlackWidowChromaTournamentEdition
  '0211': row('BlackWidow Chroma Overwatch', 'wired', 1, W, STD_OLD),    // RazerBlackWidowChromaOverwatch
  '0214': row('BlackWidow Ultimate 2016', 'wired', 1, W, STD_OLD),       // RazerBlackWidowUltimate2016
  '0216': row('BlackWidow X Chroma', 'wired', 1, W, STD_OLD),            // RazerBlackWidowXChroma
  '0217': row('BlackWidow X Ultimate', 'wired', 1, W, STD_OLD),          // RazerBlackWidowXUltimate
  '021A': row('BlackWidow X Tournament Edition Chroma', 'wired', 1, W, STD_OLD), // RazerBlackWidowXTournamentEditionChroma
  '0221': row('BlackWidow Chroma V2', 'wired', 1, W, STD_OLD),           // RazerBlackWidowChromaV2
};
export const PIDS = Object.keys(MODELS);
const BRIGHT = {
  x3f: { get: ['extBrightGet', 0x3f], set: 0x3f }, x1f: { get: ['extBrightGet', 0x1f], set: 0x1f }, x9f: { get: ['extBrightGet', 0x9f], set: 0x9f },
  v3: { get: ['stdBrightGet', 0xff], set: 0x1f }, '8k': { get: ['stdBrightGet', 0xff], set: 0x1f, activeStore: true },
};

// ---- Lighting effects as write-only settings (2 Nov 2026, Shawn's rule; helpers/my-devices.mjs "Write-only settings") ----
// The effect command has no read, so each effect setting is `writeOnly`: never read back or self-checked, locked until
// Turn on settings AND the person checked it by eye once on that keyboard (Try it). From openrazer master @ 477f4d6d:
// "rcc.c:N" = driver/razerchromacommon.c, "rkd.c:N" = driver/razerkbd_driver.c, "keyboards.py:N" = the class in
// daemon/openrazer_daemon/hardware/keyboards.py. Facts only, no code copied.
//  - THE STORE BYTE: openrazer sends every effect with VARSTORE (0x01); razercommon.h names 0x01 VARSTORE and 0x00 NOSTORE,
//    OpenRGB (Controllers/RazerController/RazerController.h) names them RAZER_STORAGE_SAVE 0x01 / RAZER_STORAGE_NO_SAVE
//    0x00 and sends every effect NO_SAVE, and rkd.c:689 razer_get_active_varstore uses that byte as the onboard profile
//    number. So VARSTORE is taken to be saved on the keyboard; this driver sends only NOSTORE (FX_STORE): the keyboard
//    forgets the effect when it is unplugged.
//  - One command: extended 0x0F/0x02 on BACKLIGHT_LED (rcc.c:481 [store, led, effect]). Left out: the standard matrix
//    effect 0x03/0x0A (rcc.c:208: no store byte at all, so no form that is not kept) of the BlackWidow Chroma family,
//    DeathStalker Chroma, BlackWidow Ultimate 2016, X family and Chroma V2; the Anansi's LED-state commands; the Huntsman
//    V3 Pro 8KHz (rkd.c:2336 and every other effect: its store byte is the active profile, razer_get_active_varstore, so
//    0x00 is not known to mean "not kept" there); the custom frame 0x0F/0x03; the BlackWidow Essential's spectrum,
//    reactive and starlight (standard 0x03/0x0A in rkd.c).
//  - Which keyboard has which effect: only what BOTH keyboards.py METHODS lists (set_wave_effect, set_starlight_dual_effect
//    ...: FX_METHODS) AND the matching rkd.c function has a VARSTORE case for (FX_GROUPS), with that case's transaction id.
//  - Wave: openrazer's daemon takes 1 = left to right, 2 = right to left (dbus_methods/chroma_keyboard.py set_wave_effect)
//    and sends WAVE_DIRS[0] for a direction the keyboard does not list (chroma_keyboard.py:244-245): on a (0, 1) keyboard
//    left to right stays 1 and right to left becomes 0. Speed 0x28 as rcc.c:542. Wheel: direction 1 or 2 (rcc.c:622
//    clamp), speed 0x28. Reactive speed 1-4 (rcc.c:643; pylib REACTIVE_500MS 1 ... 2000MS 4), starlight 1-3 (rcc.c:562;
//    STARLIGHT_FAST 1, NORMAL 2, SLOW 3).
export const FX_STORE = NOSTORE;
export const FX_CMD = { cls: 0x0f, id: 0x02 };
const G9F = '025C 0271 02BA 0290 0296 02D5';
const STAR3F = '021E 0226 0243 0241 0227 022A 022C 0257 0269 024E 0A24 025A 0295 0292 0298';
const STAR1F = '0228 025E 025D 026B 026C 0258 02B9 0287 0293 028D 02CD 02A5 02A6 02A7 02B0 02D7';
const BR3F = '021E 0226 0243 0241 0227 0237 022A 022C 023F 0257 0269 024E 0A24 025A 0295 0292 0298';
const BR1F = '0228 025E 025D 02A1 028F 0294 02A2 02A3 026B 026C 0266 0282 0258 02B9 0287 0293 028D 02CD 02A5 02A6 02A7 02B0 02D7';
// openrazer's VARSTORE cases per effect: transaction id, the line of the call (at) and of its transaction id (tidAt), and
// the product ids of that case this driver has
export const FX_GROUPS = {
  none: [   // razer_attr_write_matrix_effect_none rkd.c:2275
    { tid: 0x3f, at: 2302, tidAt: 2303, pids: '0235 021F 021E 0226 0243 0241 0227 0237 022A 022C 023F 0257 0269 024E 0A24 025A 0295 0292 0298' },
    { tid: 0x1f, at: 2331, tidAt: 2332, pids: '0228 025E 025D 02A1 028F 0294 02A2 02A3 026B 026C 0266 0282 0258 02B9 0287 0293 028D 02CD 02A5 02A6 02A7 02B0 02D7' },
    { tid: 0x9f, at: 2346, tidAt: 2347, pids: G9F },
  ],
  wave: [   // razer_attr_write_matrix_effect_wave rkd.c:2444
    { tid: 0x3f, at: 2474, tidAt: 2475, pids: '021F 021E 0226 0243 0241 0227 0237 022A 022C 0257 0269 024E 0A24 025A 0295 0292 0298' },
    { tid: 0x1f, at: 2487, tidAt: 2488, pids: '02A1 028F' },
    { tid: 0x1f, at: 2512, tidAt: 2513, pids: '0228 025E 025D 02A3 026B 026C 0266 0282 0258 02B9 0287 0293 028D 02CD 02A5 02A6 02A7 02B0 02D7' },
    { tid: 0x9f, at: 2527, tidAt: 2528, pids: G9F },
  ],
  wheel: [{ tid: 0x1f, at: 2617, tidAt: 2618, pids: '0287 0293 028D 02A5' }],   // razer_attr_write_matrix_effect_wheel rkd.c:2600
  spectrum: [   // razer_attr_write_matrix_effect_spectrum rkd.c:2638
    { tid: 0x3f, at: 2663, tidAt: 2664, pids: '021F 021E 0226 0243 0241 0227 022A 022C 023F 0257 0269 024E 0A24 025A 0295 0292 0298' },
    { tid: 0x1f, at: 2691, tidAt: 2692, pids: '0228 025E 025D 02A1 028F 0294 02A2 02A3 026B 026C 0266 0282 0258 02B9 0287 0293 028D 02CD 02A5 02A6 02A7 02B0 02D7' },
    { tid: 0x9f, at: 2706, tidAt: 2707, pids: G9F },
  ],
  reactive: [   // razer_attr_write_matrix_effect_reactive rkd.c:2809
    { tid: 0x3f, at: 2842, tidAt: 2843, pids: '021F 021E 0226 0243 0241 0227 022A 022C 0257 0269 024E 0A24 025A 0293 0295 0292 0298' },
    { tid: 0x1f, at: 2869, tidAt: 2870, pids: '0228 025E 025D 02A1 028F 02A3 026B 026C 0266 0282 0258 02B9 0287 028D 02CD 02A5 02A6 02A7 02B0 02D7' },
    { tid: 0x9f, at: 2884, tidAt: 2885, pids: G9F },
  ],
  static: [   // razer_attr_write_matrix_effect_static rkd.c:2970
    { tid: 0x3f, at: 3106, tidAt: 3107, pids: '0235 021F 021E 0226 0243 0241 0227 0237 022A 022C 023F 0257 0269 024E 0A24 025A 0293 0295 0292 0298' },
    { tid: 0x1f, at: 3142, tidAt: 3143, pids: '0228 025E 025D 02A1 028F 0294 02A2 02A3 026B 026C 0266 0282 0258 02B9 0287 028D 02CD 02A5 02A6 02A7 02B0 02D7' },
    { tid: 0x9f, at: 3171, tidAt: 3172, pids: G9F },
  ],
  // razer_attr_write_matrix_effect_starlight rkd.c:3218 (the Ornata: single only, rkd.c:3228 "count != 4")
  starlight: [{ tid: 0x3f, at: 3232, tidAt: 3233, pids: '021F' }, { tid: 0x3f, at: 3261, tidAt: 3262, pids: STAR3F }, { tid: 0x1f, at: 3297, tidAt: 3304, pids: STAR1F }, { tid: 0x9f, at: 3336, tidAt: 3343, pids: G9F }],
  starlightDual: [{ tid: 0x3f, at: 3255, tidAt: 3256, pids: STAR3F }, { tid: 0x1f, at: 3295, tidAt: 3304, pids: STAR1F }, { tid: 0x9f, at: 3334, tidAt: 3343, pids: G9F }],
  starlightRandom: [{ tid: 0x3f, at: 3267, tidAt: 3268, pids: STAR3F }, { tid: 0x1f, at: 3299, tidAt: 3304, pids: STAR1F }, { tid: 0x9f, at: 3338, tidAt: 3343, pids: G9F }],
  // razer_attr_write_matrix_effect_breath rkd.c:3482 (the BlackWidow Lite and Ornata: single only, rkd.c:3492-3501)
  breathing: [{ tid: 0x3f, at: 3494, tidAt: 3495, pids: '0235 021F' }, { tid: 0x3f, at: 3563, tidAt: 3564, pids: BR3F }, { tid: 0x1f, at: 3616, tidAt: 3625, pids: BR1F }, { tid: 0x9f, at: 3655, tidAt: 3664, pids: G9F }],
  breathingDual: [{ tid: 0x3f, at: 3571, tidAt: 3572, pids: BR3F }, { tid: 0x1f, at: 3618, tidAt: 3625, pids: BR1F }, { tid: 0x9f, at: 3657, tidAt: 3664, pids: G9F }],
  breathingRandom: [{ tid: 0x3f, at: 3579, tidAt: 3580, pids: BR3F }, { tid: 0x1f, at: 3620, tidAt: 3625, pids: BR1F }, { tid: 0x9f, at: 3659, tidAt: 3664, pids: G9F }],
};
// keyboards.py METHODS per keyboard: [class, line, effect codes, WAVE_DIRS when the class sets one]. S static, P spectrum,
// N none, R reactive, Bs / Bd / Br breathing single / dual / random, W wave, Wh wheel, Ls / Ld / Lr starlight single /
// dual / random. A keyboard here whose effects are in no FX_GROUPS case gets no effect setting.
export const FX_METHODS = {
  '0287': ['BlackWidowV4', 2135, 'W Wh S P R N Br Bs Bd Lr Ls Ld', '12'],
  '028D': ['BlackWidowV4Pro', 2179, 'W Wh S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02A5': ['BlackWidowV4_75PCT', 979, 'W Wh S P R N Br Bs Bd Lr Ls Ld', '12'],
  '0293': ['BlackWidowV4X', 2158, 'W Wh S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02B9': ['BlackWidowV4MiniHyperSpeedWired', 1178, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02BA': ['BlackWidowV4MiniHyperSpeedWireless', 1199, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02D7': ['BlackWidowV4TenkeylessHyperSpeedWired', 423, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02D5': ['BlackWidowV4TenkeylessHyperSpeedWireless', 445, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '024E': ['BlackWidowV3', 1108, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '025A': ['BlackWidowV3ProWired', 379, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '025C': ['BlackWidowV3ProWireless', 402, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '0258': ['BlackWidowV3MiniHyperSpeedWired', 1150, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '0271': ['BlackWidowV3MiniHyperSpeedWireless', 1171, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02A6': ['HuntsmanV3Pro', 598, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '02A7': ['HuntsmanV3ProTKL', 630, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '02B0': ['HuntsmanV3ProMini', 662, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '02CF': ['HuntsmanV3Pro8KHz', 2411, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '026C': ['HuntsmanV2', 556, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '026B': ['HuntsmanV2Tenkeyless', 534, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0257': ['HuntsmanMini', 1970, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0269': ['HuntsmanMiniJP', 1990, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0266': ['HuntsmanV2Analog', 579, 'W S P R N Br Bs Bd'],
  '0282': ['HuntsmanMiniAnalog', 694, 'W S P R N Br Bs Bd'],
  '0295': ['DeathStalkerV2', 1424, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0292': ['DeathStalkerV2ProWired', 1444, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0290': ['DeathStalkerV2ProWireless', 1466, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0298': ['DeathStalkerV2ProTKLWired', 1473, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0296': ['DeathStalkerV2ProTKLWireless', 1495, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '02A1': ['OrnataV3', 909, 'W S P N Br Bs Bd', '12'],
  '028F': ['OrnataV3_Alternate', 928, 'W S P N Br Bs Bd', '12'],
  '02A3': ['OrnataV3Tenkeyless', 960, 'W S P R N Br Bs Bd'],
  '0294': ['OrnataV3X', 935, 'S P N Bs Bd'],
  '02A2': ['OrnataV3X_Alternate', 953, 'S P N Bs Bd'],
  '0235': ['BlackWidowLite', 1284, 'S N Bs'],
  '021F': ['Ornata', 1340, 'W S R N Bs Bs Lr Ls', '01'],
  '021E': ['OrnataChroma', 867, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0226': ['HuntsmanElite', 1024, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0227': ['Huntsman', 1087, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0243': ['HuntsmanTournamentEdition', 1045, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '0241': ['BlackWidow2019', 1300, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '0237': ['BlackWidowEssential', 1320, 'S N P W R Lr Ls Ld Bs'],
  '022A': ['CynosaChroma', 1206, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '022C': ['CynosaChromaPro', 1227, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '023F': ['CynosaLite', 1268, 'S P N Br Bs Bd'],
  '0A24': ['BlackWidowV3TK', 1129, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '0228': ['BlackWidowElite', 1066, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '025E': ['CynosaV2', 1247, 'W S P R N Br Bs Bd Lr Ls Ld', '01'],
  '025D': ['OrnataV2', 888, 'W S P R N Br Bs Bd Lr Ls Ld', '12'],
  '02CD': ['Joro', 1002, 'W S P R N Br Bs Bd Lr Ls Ld'],
  '010F': ['Anansi', 1360, 'S P N'],
  '0203': ['BlackWidowChroma', 453, 'W S P R N Br Bs Bd'],
  '0204': ['DeathStalkerChroma', 1405, 'W S P N Br Bs Bd'],
  '0209': ['BlackWidowChromaTournamentEdition', 495, 'W S P R N Br Bs Bd'],
  '0211': ['BlackWidowChromaOverwatch', 1503, 'W S P R N Br Bs Bd'],
  '0214': ['BlackWidowUltimate2016', 827, 'W S R N Br Bs Bd Lr'],
  '0216': ['BlackWidowXChroma', 514, 'W S P R N Br Bs Bd'],
  '0217': ['BlackWidowXUltimate', 847, 'W S R N Br Bs Bd Lr'],
  '021A': ['BlackWidowXTournamentEditionChroma', 713, 'W S P R N Br Bs Bd'],
  '0221': ['BlackWidowChromaV2', 474, 'W S P R N Br Bs Bd Lr Ls Ld'],
};
// [value, label, METHODS code, FX_GROUPS key, parameter]; the wave's direction byte is chosen per keyboard (waveDir)
export const FX_OPTIONS = [
  ['static', 'Static colour', 'S', 'static'],
  ['breathing', 'Breathing, one colour', 'Bs', 'breathing'],
  ['breathingDual', 'Breathing, two colours', 'Bd', 'breathingDual'],
  ['breathingRandom', 'Breathing, random colours', 'Br', 'breathingRandom'],
  ['spectrum', 'Spectrum (colour cycle)', 'P', 'spectrum'],
  ['waveRight', 'Rainbow wave, left to right', 'W', 'wave', 'right'],
  ['waveLeft', 'Rainbow wave, right to left', 'W', 'wave', 'left'],
  ['wheel', 'Wheel', 'Wh', 'wheel', 0x01],
  ['wheelReverse', 'Wheel, reversed', 'Wh', 'wheel', 0x02],
  ['reactive1', 'Keys light up when pressed, 0.5 s', 'R', 'reactive', 0x01],
  ['reactive2', 'Keys light up when pressed, 1 s', 'R', 'reactive', 0x02],
  ['reactive3', 'Keys light up when pressed, 1.5 s', 'R', 'reactive', 0x03],
  ['reactive4', 'Keys light up when pressed, 2 s', 'R', 'reactive', 0x04],
  ['starlight1', 'Starlight, one colour, fast', 'Ls', 'starlight', 0x01],
  ['starlight2', 'Starlight, one colour', 'Ls', 'starlight', 0x02],
  ['starlight3', 'Starlight, one colour, slow', 'Ls', 'starlight', 0x03],
  ['starlightDual1', 'Starlight, two colours, fast', 'Ld', 'starlightDual', 0x01],
  ['starlightDual2', 'Starlight, two colours', 'Ld', 'starlightDual', 0x02],
  ['starlightDual3', 'Starlight, two colours, slow', 'Ld', 'starlightDual', 0x03],
  ['starlightRandom1', 'Starlight, random colours, fast', 'Lr', 'starlightRandom', 0x01],
  ['starlightRandom2', 'Starlight, random colours', 'Lr', 'starlightRandom', 0x02],
  ['starlightRandom3', 'Starlight, random colours, slow', 'Lr', 'starlightRandom', 0x03],
  ['off', 'Off', 'N', 'none'],
];
const USES_C1 = (v) => ['static', 'breathing', 'breathingDual'].includes(v) || /^reactive|^starlight[123]$|^starlightDual/.test(v);
const USES_C2 = (v) => v === 'breathingDual' || /^starlightDual/.test(v);
export const FX_DEFAULT = { c1: '#00ff00', c2: '#0000ff' };   // the colours an effect uses until the person picks one
// the wave's direction byte (see the top): left to right 1; right to left 2, or 0 on a (0, 1) keyboard
// The Ornata V3 and its Alt (02A1, 028F) take it the other way round: openrazer razerkbd_driver.c 2482-2488 @ 477f4d6d
// flips the direction for them (direction ^= 3) before building the wave (a review, 2 Nov 2026)
const WAVE_FLIPPED = new Set(['02A1', '028F']);
export const waveDir = (pid, way) => {
  const d = way === 'right' ? 0x01 : FX_METHODS[pid]?.[3] === '01' ? 0x00 : 0x02;
  return WAVE_FLIPPED.has(String(pid).toUpperCase()) && (d === 0x01 || d === 0x02) ? d ^ 3 : d;
};
// the effects one keyboard has: [{ value, label, group: { tid, at, tidAt }, param }]
export function effectsFor(pid) {
  const row = FX_METHODS[pid];
  if (!row) return [];
  const has = new Set(row[2].split(' '));
  const out = [];
  for (const [value, label, code, group, param] of FX_OPTIONS) {
    const g = has.has(code) ? (FX_GROUPS[group] || []).find((x) => x.pids.split(' ').includes(pid)) : null;
    if (g) out.push({ value, label, group: g, param: group === 'wave' ? waveDir(pid, param) : param });
  }
  return out.some((o) => o.value !== 'off') ? out : [];
}
// the write-only settings for one keyboard's effects: effect, colour, second colour
export function effectSettings(pid) {
  const opts = effectsFor(pid);
  if (!opts.length) return [];
  const vals = opts.map((o) => o.value);
  const test = ['waveRight', 'spectrum', 'static'].find((v) => vals.includes(v)) || vals.find((v) => v !== 'off');
  const out = [{ key: 'effect', label: 'Lighting effect', type: 'choice', group: 'lights', options: opts.map(({ value, label }) => ({ value, label })),
    hint: 'Lasts until the keyboard is unplugged (never saved on the keyboard)',
    writeOnly: { volatile: true, confirm: 'Is the keyboard showing this now: {value}?', test, restore: 'previous' } }];
  if (vals.some(USES_C1)) out.push({ key: 'color', label: 'Lighting colour', type: 'color', group: 'lights',
    hint: 'Used by the static, breathing, key-press and starlight effects; picking one shows it as a static colour unless one of those is on',
    writeOnly: { volatile: true, confirm: "Did the keyboard's lights turn {value}?", test: '#ff0000', restore: 'previous' } });
  if (vals.some(USES_C2)) out.push({ key: 'color2', label: 'Second colour', type: 'color', group: 'lights',
    hint: 'Used by the two-colour effects; picking one turns breathing with two colours on unless a two-colour effect is on',
    writeOnly: { volatile: true, confirm: 'Is the keyboard now showing two colours, one of them {value}?', test: '#0000ff', restore: 'previous' } });
  return out;
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// one effect's arguments with NOSTORE, byte for byte as the rcc.c builder lays them out: { size, args }
export function fxArgs(value, param, c1 = FX_DEFAULT.c1, c2 = FX_DEFAULT.c2) {
  const s = FX_STORE, L = LED.BACKLIGHT, a = rgbOf(c1), b = rgbOf(c2);
  if (value === 'off') return { size: 0x06, args: [s, L, 0x00, 0, 0, 0] };                                    // rcc.c:498 none
  if (value === 'static') return { size: 0x09, args: [s, L, 0x01, 0, 0, 0x01, ...a] };                       // rcc.c:511
  if (value === 'spectrum') return { size: 0x06, args: [s, L, 0x03, 0, 0, 0] };                              // rcc.c:605
  if (/^wave/.test(value)) return { size: 0x06, args: [s, L, 0x04, param, 0x28, 0] };                        // rcc.c:531
  if (/^wheel/.test(value)) return { size: 0x06, args: [s, L, 0x0a, param, 0x28, 0] };                       // rcc.c:616
  if (/^reactive/.test(value)) return { size: 0x09, args: [s, L, 0x05, 0, param, 0x01, ...a] };              // rcc.c:639
  if (value === 'breathingRandom') return { size: 0x06, args: [s, L, 0x02, 0, 0, 0] };                       // rcc.c:662
  if (value === 'breathing') return { size: 0x09, args: [s, L, 0x02, 0x01, 0, 0x01, ...a] };                 // rcc.c:667
  if (value === 'breathingDual') return { size: 0x0c, args: [s, L, 0x02, 0x02, 0, 0x02, ...a, ...b] };       // rcc.c:680
  if (/^starlightRandom/.test(value)) return { size: 0x06, args: [s, L, 0x07, 0, param, 0] };                // rcc.c:558
  if (/^starlightDual/.test(value)) return { size: 0x0c, args: [s, L, 0x07, 0, param, 0x02, ...a, ...b] };   // rcc.c:581
  if (/^starlight/.test(value)) return { size: 0x09, args: [s, L, 0x07, 0, param, 0x01, ...a] };             // rcc.c:567
  throw new Error(`${value} is not an effect this driver builds`);
}

// the maker's app (the same process names as device-library/razer-mouse, from helpers/diagnose.mjs)
export const VENDOR_APPS = [/^razer synapse/i, /^razerappengine\.exe$/i];
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name)) && !/service|updater|crash/i.test(name)) return name; }   // a service or updater is not the app (1 Nov 2026: Synapse's service kept the device read-only, nothing to close)
  return null;
}
// the control collection: the keyboard's interface (report_index) holding the 91-byte feature report. Its usage page
// moves with firmware (sheet section 2: BlackWidow V4 0x01/0x00 or 0x0C/0x01), so it is chosen by interface and length.
async function defaultOpen(pid, model) {
  return getDevice([{ vendorId: 0x1532, productId: parseInt(pid, 16), iface: model.iface }], { prompt: false });
}
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, '0');
const POLL_EVERY = 10, POLL_FOR = 100, APP_CHECK_MS = 15000;
// the transaction ids a null setting is asked on (reads only), cable first / dongle first: the ids this driver's own
// rows use for the extended, polling and battery commands (1F, 3F on the cable; 9F on the dongle)
export const PROBE_TIDS = { wired: [0x1f, 0x3f, 0x9f], wireless: [0x9f, 0x1f, 0x3f] };
const asked = (t) => `found by reads (tid ${hex2(t)})`;
class RazerError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

// models: the table (tests hand in their own rows to exercise every null)
export function createRazerKeyboard({ sleep = sleepReal, open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now(), models = MODELS } = {}) {
  const pids = Object.keys(models);
  return {
    id: 'razer-keyboard',
    title: 'Razer keyboard',
    kind: 'Keyboard',
    vendor: 'Razer',
    hid: { vid: '1532', pid: '0287', pids, page: '*', usage: '*', len: LEN, featureLen: LEN, reportId: 0, featureOnly: true,
      byPid: Object.fromEntries(pids.map((p) => [p, { iface: models[p].iface }])) },
    unsupported: ['saving a lighting effect on the keyboard (effects set here last until it is unplugged)', 'per-key colours (custom frame)', 'lighting effects on the older standard-lighting keyboards and the Huntsman V3 Pro 8KHz (no form that is known not to be saved)', 'the Fn toggle (write-only)', 'keyswitch optimization', 'device mode', 'macros and key remaps', 'firmware updates (Razer\'s own updater only)', 'dongle pairing'],
    dev: null, pid: null, model: null, has: null, probed: {}, pollRates: POLL_BASE, raw: {}, q: Promise.resolve(), app: null, appAt: 0, fx: null,

    get settings() {
      const all = [
        { key: 'brightness', label: 'Backlight brightness', type: 'slider', min: 0, max: 255, step: 1, unit: '/255', live: true, hint: 'Saved on the keyboard; colours and effects stay as they are' },
        { key: 'gameMode', label: 'Game mode', type: 'toggle', hint: 'The keyboard\'s own game mode: the Windows key is locked and the game-mode light is on' },
        { key: 'macroLed', label: 'Macro light', type: 'toggle', hint: 'The macro indicator light only; macros themselves are not changed' },
        { key: 'pollingRate', label: 'Polling rate', type: 'choice', options: this.pollRates.map((hz) => ({ value: hz, label: `${hz} Hz` })) },
        { key: 'lowBattery', label: 'Low-battery warning', type: 'slider', min: LOWBAT_MIN, max: LOWBAT_MAX, step: 1, unit: 'raw', hint: 'Raw 12-63: 12 is about 5%, 38 about 15%, 63 about 25% (OpenRazer)' },
      ];
      // the lighting effects (write-only) depend only on the model, so they are listed as soon as one is connected
      const fx = this.pid ? effectSettings(this.pid) : [];
      return [...(this.has ? all.filter((s) => this.has.has(s.key)) : all), ...fx];
    },

    async connect() {
      if (this.dev) return true;
      for (const pid of pids) {
        const dev = await open(pid, models[pid]);
        if (dev) { this.dev = dev; this.pid = pid; this.model = models[pid]; this.has = null; this.probed = {}; this.raw = {}; this.pollRates = POLL_BASE; this.app = null; this.appAt = 0; this.fx = null; return true; }
      }
      return false;
    },

    // send, wait the keyboard's time, read until the reply answers this request (OpenRazer razer_send_payload: remaining
    // packets, class and id must match; "Some commands respond with 'busy' but succeed. Treat it as success.")
    request(tid, cmd, args = []) {
      const run = async () => {
        await this.dev.sendFeatureReport(0, buildReport(tid, cmd.cls, cmd.id, cmd.size, args));
        await sleep(this.model.wait);
        for (let waited = 0; ; waited += POLL_EVERY) {
          const dv = await this.dev.receiveFeatureReport(0, LEN);
          const r = parseReply(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
          const ours = r.remaining === 0 && r.cls === cmd.cls && r.id === cmd.id;
          if (ours && (r.status === 0x02 || r.status === 0x01)) return r;
          if (ours && r.status === 0x03) throw new RazerError(`the keyboard refused ${hex2(cmd.cls)}/${hex2(cmd.id)} (failure)`, 3);
          if (ours && r.status === 0x04) throw new RazerError('the keyboard did not answer (asleep or out of range)', 4);
          if (ours && r.status === 0x05) throw new RazerError(`${hex2(cmd.cls)}/${hex2(cmd.id)} is not supported with transaction id ${hex2(tid)}`, 5);
          if (waited >= POLL_FOR) throw new RazerError(`no reply to ${hex2(cmd.cls)}/${hex2(cmd.id)} (status ${STATUS[r.status] || hex2(r.status)})`, r.status);
          await sleep(POLL_EVERY);
        }
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },
    async get(name, tid, args = []) { const r = await this.request(tid, CMD[name], args); this.raw[name] = Array.from(r.args.slice(0, Math.max(3, CMD[name].size)), hex2).join(' '); return r.args; },

    // ---- the reads, each with the transaction id OpenRazer uses for this keyboard ----
    async readBrightness() { const b = BRIGHT[this.model.bright]; return (await this.get(b.get[0], b.get[1], [VARSTORE, LED.BACKLIGHT]))[2]; },
    gameArgs() { return this.model.game === 'v2' ? { store: NOSTORE, tid: 0x1f } : { store: VARSTORE, tid: 0xff }; },
    // raw 0 / 1 only (driver safety, 22 Oct 2026): another byte reads as null, so it is never written back as 0 or 1
    async readGame() { const g = this.gameArgs(); return bit((await this.get('ledStateGet', g.tid, [g.store, LED.GAME]))[2]); },
    async readMacro() { return bit((await this.get('ledStateGet', 0xff, [VARSTORE, LED.MACRO]))[2]); },
    async readPoll() { const code = (await this.get('pollGet', this.model.poll))[1]; const hz = Object.keys(POLL).find((x) => POLL[x] === code); return hz ? Number(hz) : null; },
    async readLowBat() { return (await this.get('lowBatGet', 0xff))[0]; },

    // which settings answer, by reads only
    async ready() {
      if (this.has) return;
      if (!this.dev) throw Object.assign(new Error('no Razer keyboard is open'), { gone: true });
      const has = new Set();
      const tries = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { if (e.status === 4 || e.gone) throw e; return { ok: false }; } };
      // a null setting (OpenRazer does not say): asked with reads only. It becomes the form this driver already writes
      // for other keyboards only when the read answers with a value the driver maps; else false (not offered).
      const m0 = models[this.pid];
      const got = {}, probed = {};
      const order = PROBE_TIDS[m0.link === 'wireless' ? 'wireless' : 'wired'];
      if (m0.bright === null) {
        // extended 0F/84 [VARSTORE, BACKLIGHT_LED]; written with 0F/04 on the same tid, as the x3f / x1f / x9f rows
        got.bright = false;
        for (const t of order) { const r = await tries(() => this.get('extBrightGet', t, [VARSTORE, LED.BACKLIGHT])); if (r.ok && r.v[1] === LED.BACKLIGHT) { got.bright = `x${hex2(t)}`; break; } }
      }
      if (m0.game === null) {
        // 03/80 [VARSTORE, GAME_LED] tid FF, the 'std' rows' read; only a raw 0 or 1 counts
        const r = await tries(() => this.get('ledStateGet', 0xff, [VARSTORE, LED.GAME]));
        got.game = r.ok && bit(r.v[2]) !== null ? 'std' : false;
      }
      if (m0.macro === null) {
        const r = await tries(() => this.get('ledStateGet', 0xff, [VARSTORE, LED.MACRO]));
        got.macro = !!(r.ok && bit(r.v[2]) !== null);
      }
      if (m0.poll === null) {
        // 00/C0 (polling_rate2): only a code razer_chroma_misc_set_polling_rate2 has
        got.poll = false;
        for (const t of order) { const r = await tries(() => this.get('pollGet', t)); if (r.ok && Object.values(POLL).includes(r.v[1])) { got.poll = t; break; } }
      }
      if (m0.bat === null) {
        // 07/80 and 07/84 on one tid, both answering, charging a raw 0 or 1
        got.bat = false;
        for (const t of order) {
          const a = await tries(() => this.get('battery', t));
          const c = a.ok ? await tries(() => this.get('charging', t)) : { ok: false };
          if (a.ok && c.ok && bit(c.v[1]) !== null) { got.bat = t; break; }
        }
      }
      for (const [f, v] of Object.entries(got)) probed[f] = v === false ? 'asked with reads: no usable answer, not offered' : typeof v === 'number' ? asked(v) : f === 'bright' ? asked(parseInt(v.slice(1), 16)) : 'found by reads (tid ff)';
      this.model = { ...m0, ...got };
      this.probed = probed;
      const m = this.model;
      if (m.bright && (await tries(() => this.readBrightness())).ok) has.add('brightness');
      if (m.game && (await tries(() => this.readGame())).ok) has.add('gameMode');
      if (m.macro && (await tries(() => this.readMacro())).ok) has.add('macroLed');
      if (typeof m.poll === 'number') {
        const r = await tries(() => this.readPoll());
        if (r.ok && r.v) { has.add('pollingRate'); if (r.v > 1000) this.pollRates = Object.keys(POLL).map(Number).filter((hz) => hz <= r.v).sort((a, b) => a - b); }
      }
      if (m.lowBat && (await tries(() => this.readLowBat())).ok) has.add('lowBattery');
      this.has = has;
    },

    async info() {
      await this.ready();
      // razer_attr_read_firmware_version: tid FF on every OpenRazer keyboard; OpenRGB razer_get_firmware: the device's tid
      const fw = await this.get('firmware', this.model.fw);
      const out = { Model: `Razer ${this.model.model}`, Connection: this.model.link === 'wireless' ? 'wireless (dongle)' : 'cable', 'Product id': `1532:${this.pid}`,
        Firmware: `${fw[0]}.${fw[1]}`, Interface: String(this.model.iface) };
      const names = { bright: 'brightness', game: 'game mode', macro: 'macro light', poll: 'polling rate', bat: 'battery' };
      const p = Object.entries(this.probed);
      if (p.length) out['Not in OpenRazer'] = p.map(([f, how]) => `${names[f]}: ${how}`).join('; ');
      if (this.model.infoOnly) out.Settings = 'none yet: no open source documents a read for this keyboard (OpenRGB only writes its lights)';
      return out;
    },

    async read() {
      await this.ready();
      const v = {};
      if (this.has.has('brightness')) v.brightness = await this.readBrightness();
      if (this.has.has('gameMode')) v.gameMode = await this.readGame();
      if (this.has.has('macroLed')) v.macroLed = await this.readMacro();
      if (this.has.has('pollingRate')) v.pollingRate = await this.readPoll();
      if (this.has.has('lowBattery')) v.lowBattery = await this.readLowBat();
      return v;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (two programs writing the keyboard fight)`), { refused: true, waiting: true });
    },

    // a lighting effect setting (write-only): the 0F/02 report with NOSTORE on openrazer's transaction id for this keyboard
    // and effect; nothing is read back (no read exists). this.fx = what was sent this connection, so a colour change
    // re-sends the effect that is on.
    async writeEffect(s, value) {
      const opts = effectsFor(this.pid);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label}: ${JSON.stringify(value)} is not an effect this keyboard has`);
      if (s.type === 'color' && !(typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value))) throw new Error(`${s.label} must be a colour like #ff0000`);
      const st = { effect: null, c1: FX_DEFAULT.c1, c2: FX_DEFAULT.c2, ...this.fx };
      const has = (v) => opts.some((o) => o.value === v);
      let effect;
      if (s.key === 'effect') effect = value;
      else if (s.key === 'color') { st.c1 = value; effect = USES_C1(st.effect) ? st.effect : ['static', 'breathing', 'reactive2', 'starlight2'].find(has); }
      else { st.c2 = value; effect = USES_C2(st.effect) ? st.effect : ['breathingDual', 'starlightDual2'].find(has); }
      const o = opts.find((x) => x.value === effect);
      if (!o) throw new Error(`${s.label}: no effect on this keyboard uses it`);
      await this.appCheck();
      const { size, args } = fxArgs(effect, o.param, st.c1, st.c2);
      await this.request(o.group.tid, { ...FX_CMD, size }, args);
      this.fx = { ...st, effect };
      return value;
    },

    // one setting, checked, written, read back
    async write(key, value) {
      await this.ready();
      const fxs = this.pid ? effectSettings(this.pid).find((x) => x.key === key) : null;
      if (fxs) return this.writeEffect(fxs, value);
      const s = this.settings.find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting of this keyboard`);
      if (s.type === 'toggle' && typeof value !== 'boolean') throw new Error(`${s.label} is on or off (true / false)`);
      if (s.type === 'slider' && !(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`${s.label} must be a whole number ${s.min}-${s.max}`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      await this.appCheck();
      const m = this.model;
      if (key === 'brightness') {
        const b = BRIGHT[m.bright];
        let store = VARSTORE;
        if (b.activeStore) {
          // OpenRazer writes the 8KHz's brightness to razer_get_active_varstore(); it reads VARSTORE. Only when the two are
          // the same store can the write be read back, so anything else is refused.
          store = (await this.get('activeStore', 0x1f))[0];   // get_razer_report(0x05, 0x84, 0x01): no arguments set
          if (store !== VARSTORE) throw new Error(`the keyboard is on profile store ${store}; its brightness can be read back only on store 1, so it was not written`);
        }
        await this.request(b.set, CMD.extBrightSet, [store, LED.BACKLIGHT, value]);   // [store, BACKLIGHT_LED, 0-255]
      } else if (key === 'gameMode') {
        const g = this.gameArgs();
        await this.request(g.tid, CMD.ledStateSet, [g.store, LED.GAME, value ? 1 : 0]);  // set_led_state [store, GAME_LED, 0/1]
      } else if (key === 'macroLed') {
        await this.request(0xff, CMD.ledStateSet, [VARSTORE, LED.MACRO, value ? 1 : 0]); // set_led_state [VARSTORE, MACRO_LED, 0/1]
      } else if (key === 'pollingRate') {
        await this.request(m.poll, CMD.pollSet, [0x00, POLL[value]]);                   // set_polling_rate2(rate, 0x00): [00, code], once
      } else if (key === 'lowBattery') {
        await this.request(0xff, CMD.lowBatSet, [value]);                                // set_low_battery_threshold [0x0C-0x3F]
      }
      const back = (await this.read())[key];
      if (back !== value) throw new Error(`${key}: wrote ${value}, read back ${back}`);
      return back;
    },

    async battery() {
      await this.ready();
      if (typeof this.model.bat !== 'number') return null;
      const level = (await this.get('battery', this.model.bat))[1];
      return { percent: Math.round((level * 100) / 255), charging: (await this.get('charging', this.model.bat))[1] === 1 };   // OpenRazer: "scaled from 0-255 -> 0-100"
    },

    async rawBackup() { const values = await this.read(); return { pid: this.pid, model: this.model.model, values, replies: { ...this.raw } }; },
  };
}

export default createRazerKeyboard();
