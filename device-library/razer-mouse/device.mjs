// Razer mice over the 90-byte report (22 Oct 2026), written only from docs/brands/razer.md (OpenRazer and OpenRGB facts,
// no code copied). "razer.md §n" below names the sheet's section and row each byte comes from. Read-only first: the
// library entry is "read-only" until every write below has been tried once on a real mouse (CLAUDE.md, step 6).
// Simulated in tests/sim-razer.mjs; never run on a real device yet.
// 23 Oct 2026: twelve more product ids (DeathAdder Essential / V2 families, Viper V2 Pro, Viper V3 HyperSpeed, Naga V2
// HyperSpeed) taken from OpenRazer's own driver (cited per model in MODELS), with its per-command transaction ids.
//
// Coverage (22 Oct 2026, docs/handoff/driver-coverage.md): every razer.md §3 mouse row that has both a set and a get
// is here: DPI, the DPI stage table (active stage and each stage's DPI; the stage COUNT is never changed), polling
// (classic and HyperPolling), sleep timer, low-battery threshold, scroll acceleration and smart reel (Basilisk-type
// wheels), the HyperPolling dongle's indicator light, and extended lighting brightness per documented LED id. Since 2 Nov
// 2026 also the lighting effects and colours per LED zone, as write-only settings (see "Lighting effects" below). Left out,
// with why: scroll mode (the
// sheet names no mode values: read and shown only), device mode, dongle pairing, macros / remaps (no source), lift-off,
// angle snapping, debounce and onboard profiles (no source documents them for Razer).
//
// HID LAYER (22 Oct 2026: what this driver needed from DeviceHub's HID layer now exists; docs/handoff/hid-core.md):
//  1. Feature-only channel: `featureOnly: true` opens the collection with no access (as hidapi does for a mouse
//     collection Windows holds) and serves FSET / FGET on that handle only; REQ is refused on it.
//  2. Choosing the collection: `byPid[pid].iface` (matched as "&mi_0N" in the device path) and `featureLen` (90 data
//     bytes = Windows' FeatureReportByteLength 91) are matched together with usage page 0x01 / usage 0x02.
//  3. Several product ids: `hid.pids` + `hid.byPid` register one channel per pid (helpers/my-devices.mjs hidSpecs);
//     getDevice({ vendorId, productId, iface }) below finds whichever is plugged in.
//  4. tested: [] is accepted for a "read-only" entry (helpers/device-library.mjs validateMeta).
// Untested on a real mouse: that the control collection is page 0x01 / usage 0x02 on each model, and its iface.
import { getDevice } from '../../public/devices/hid.js';

// ---- the 90-byte report (razer.md §2 "The 90-byte report") ----
export const LEN = 90;
export const STATUS = { 0x00: 'new', 0x01: 'busy', 0x02: 'success', 0x03: 'failure', 0x04: 'timeout', 0x05: 'not supported' };  // §2 Status codes
export const VARSTORE = 0x01, NOSTORE = 0x00;  // §3 header line

// crc = XOR of bytes 2..87 (razer_calculate_crc, loop i = 2; i < 88)
export function crc(r) { let c = 0; for (let i = 2; i < 88; i++) c ^= r[i]; return c; }

// status 0, transaction id, remaining packets 0x0000, protocol 0, data size, class, id, arguments[80], crc, reserved 0
export function buildReport(tid, cls, id, size, args = []) {
  if (size > 80 || args.length > 80) throw new Error('a Razer report carries at most 80 argument bytes');
  const r = new Uint8Array(LEN);
  r[1] = tid; r[5] = size; r[6] = cls; r[7] = id;
  r.set(args, 8);
  r[88] = crc(r);
  return r;
}

export function parseReply(u8) {
  return { status: u8[0], tid: u8[1], remaining: (u8[2] << 8) | u8[3], size: u8[5], cls: u8[6], id: u8[7], args: u8.slice(8, 88), crc: u8[88], crcOk: crc(u8) === u8[88] };
}

// ---- the commands this driver may send: every one is a row of razer.md §3; nothing else is ever built ----
// get = set + 0x80 (§2 byte 7). Only rows with BOTH a set and a get are written; scrollMode is a get only here.
export const CMD = {
  firmware:    { cls: 0x00, get: 0x81, size: 0x02 },                // §3 Device info: Firmware version, reply [0].[1]
  battery:     { cls: 0x07, get: 0x80, size: 0x02 },                // §3 Mouse: Battery level, reply [1] = 0-255
  charging:    { cls: 0x07, get: 0x84, size: 0x02 },                // §3 Mouse: Charging status, reply [1] = 0/1
  dpi:         { cls: 0x04, get: 0x85, set: 0x05, size: 0x07 },     // §3 Mouse: DPI (X/Y)
  dpiStages:   { cls: 0x04, get: 0x86, set: 0x06, size: 0x26 },     // §3 Mouse: DPI stages, [0] VARSTORE, [1] active (1-based), [2] count, 7 bytes per stage
  poll:        { cls: 0x00, get: 0x85, set: 0x05, size: 0x01 },     // §3 Mouse: Polling rate (classic)
  poll2:       { cls: 0x00, get: 0xc0, set: 0x40, size: 0x02 },     // §3 Mouse: Polling rate (HyperPolling, "rate2")
  idle:        { cls: 0x07, get: 0x83, set: 0x03, size: 0x02 },     // §3 Mouse: Idle / sleep timer, seconds BE
  lowBattery:  { cls: 0x07, get: 0x81, set: 0x01, size: 0x01 },     // §3 Mouse: Low-battery threshold, raw
  // §3 Mouse: Scroll mode (tactile / free spin), 0x02/0x94 get, [0] VARSTORE, [1] = mode. The sheet (OpenRazer
  // razerchromacommon.c) gives no mode values, so this is read and shown raw, never written. Size 0x02 = its two arguments.
  scrollMode:  { cls: 0x02, get: 0x94, size: 0x02 },
  // §3 Mouse: Scroll acceleration 0x02/0x96 get, 0x16 set, [0] VARSTORE, [1] = 0/1 (OpenRazer razerchromacommon.c).
  // Size 0x02 = its two listed arguments (the sheet gives no size for the scroll rows).
  scrollAccel: { cls: 0x02, get: 0x96, set: 0x16, size: 0x02 },
  // §3 Mouse: Smart reel 0x02/0x97 get, 0x17 set, [0] VARSTORE, [1] = 0/1 (OpenRazer razerchromacommon.c); size as above
  smartReel:   { cls: 0x02, get: 0x97, set: 0x17, size: 0x02 },
  // §3 Mouse: Dongle indicator LED mode 0x07/0x90 get, 0x10 set, [0]: 1 = connection, 2 = battery, 3 = battery warning
  // (OpenRazer razerchromacommon.c, HyperPolling dongle). Size 0x01 = its one argument.
  dongleLed:   { cls: 0x07, get: 0x90, set: 0x10, size: 0x01 },
  // §3 Lighting: Brightness (extended) 0x0F/0x84 get, 0x04 set, size 0x03; [0] VARSTORE, [1] LED id, [2] 0-255
  // (OpenRazer razerchromacommon.c; OpenRGB RazerController.cpp)
  brightness:  { cls: 0x0f, get: 0x84, set: 0x04, size: 0x03 },
};
// §3 Polling rate (classic): [0] 0x01 = 1000, 0x02 = 500, 0x08 = 125
export const POLL_CLASSIC = { 1000: 0x01, 500: 0x02, 125: 0x08 };
// §3 Polling rate (rate2): [1] 0x01 = 8000, 0x02 = 4000, 0x04 = 2000, 0x08 = 1000, 0x10 = 500, 0x20 = 250, 0x40 = 125
export const POLL_RATE2 = { 8000: 0x01, 4000: 0x02, 2000: 0x04, 1000: 0x08, 500: 0x10, 250: 0x20, 125: 0x40 };
const codeToHz = (map, code) => { const hz = Object.keys(map).find((k) => map[k] === code); return hz == null ? null : Number(hz); };
export const DPI_MIN = 100, DPI_MAX = 45000;       // §3 DPI: clamped 100-45000
export const IDLE_MIN = 60, IDLE_MAX = 900;        // §3 Idle: clamped 60-900 s
export const LOWBAT_MIN = 0x0c, LOWBAT_MAX = 0x3f; // §3 Low-battery threshold: clamped 0x0C-0x3F (scale unconfirmed)
// §3 DPI stages: size 0x26 = 38 argument bytes = 3 header bytes + 7 per stage, so the table holds at most 5 stages
// (RAZER_MOUSE_MAX_DPI_STAGES is unconfirmed in the sheet; "Synapse shows 5" agrees). A table read with more is not written.
export const STAGE_BYTES = 7, STAGES_MAX = (0x26 - 3) / STAGE_BYTES;
// §3 Dongle indicator LED mode values
export const DONGLE_LED = { 1: 'connection', 2: 'battery', 3: 'battery warning' };
// §3 Lighting, LED ids (razercommon.h): only the mouse zones are asked for. 0x00 "zero (whole device)" is asked only when
// none of the named zones answers. Battery 0x03, backlight 0x05, macro 0x07, game 0x08 and charging 0x20-0x22 are
// keyboard / dock LEDs and are not asked.
export const LEDS = [
  { id: 0x01, key: 'brightnessWheel', name: 'scroll wheel' },
  { id: 0x04, key: 'brightnessLogo', name: 'logo' },
  { id: 0x10, key: 'brightnessRight', name: 'right side' },
  { id: 0x11, key: 'brightnessLeft', name: 'left side' },
];
export const LED_ALL = { id: 0x00, key: 'brightnessAll', name: 'whole mouse' };

// ---- Lighting effects as write-only settings (2 Nov 2026, Shawn's rule; helpers/my-devices.mjs "Write-only settings") ----
// The effect commands have no read, so each effect setting is `writeOnly`: never read back or self-checked, locked until
// Turn on settings AND the person checked it by eye once on that model (Try it). From openrazer master @ 477f4d6d:
// "rcc.c:N" = driver/razerchromacommon.c, "rmd.c:N" = driver/razermouse_driver.c, "mouse.py:N" = the class in
// daemon/openrazer_daemon/hardware/mouse.py, "razercommon.h" for the ids. Facts only, no code copied.
//  - THE STORE BYTE: openrazer sends every effect with VARSTORE (0x01); razercommon.h names 0x01 VARSTORE and 0x00
//    NOSTORE ("LED STORAGE Options"), OpenRGB (Controllers/RazerController/RazerController.h) names them
//    RAZER_STORAGE_SAVE = 0x01 and RAZER_STORAGE_NO_SAVE = 0x00 and sends every effect NO_SAVE, and razerkbd_driver.c
//    razer_get_active_varstore uses that byte as the onboard profile number. So VARSTORE is taken to be saved on the
//    device, and this driver sends only NOSTORE (FX_STORE): the mouse forgets the effect when it is unplugged.
//  - Two commands, both with that store byte: extended 0x0F/0x02 (rcc.c:481 razer_chroma_extended_matrix_effect_base:
//    [store, led, effect]) and the "mouse extended" 0x03/0x0D (rcc.c:784) of the Naga Hex V2 / Naga Chroma. Left out:
//    the standard matrix effect 0x03/0x0A (rcc.c:208: no store byte at all, so it cannot be sent in a form that is
//    not kept) used by the Mamba Chroma / TE, Diamondback Chroma and Orochi Chroma; the classic LED-state sequences
//    (0x03/0x00 + 0x03/0x01 + 0x03/0x02) of the DeathAdder Chroma / 2000 / 3500, Abyssus V2 / 2000, Mamba 2012, Naga
//    Epic Chroma, Naga 2014, Ouroboros and Taipan (several commands per effect, and rmd.c:4899-4919 has no break and falls through into
//    the extended command for some of them); the Naga Trinity / Naga Pro / Naga V2 Pro whole-mouse effects and the
//    Basilisk Mobile static (rmd.c:1133-1170: an undocumented "mode switcher" report first); the custom frame 0x0F/0x03.
//  - Which model has which effect on which LED: only what BOTH mouse.py METHODS lists (set_logo_static,
//    set_scroll_wave, set_static_effect ...: FX_METHODS) AND the matching rmd.c function has a case for (FX_ZONE for
//    the per-LED *_common functions, FX_ALL for the whole-mouse ZERO_LED ones), with that case's transaction id.
//  - Wave: openrazer's daemon passes direction 1 or 2 (device_base.py WAVE_DIRS (1, 2) on every mouse here;
//    dbus_methods/lanceheadte.py set_logo_wave: "(0|1) - down to up, (1|2) up to down"); speed 0x28 as rcc.c:542.
//    Reactive speed 1-4 (rcc.c:643 clamp; pylib constants REACTIVE_500MS 1 ... REACTIVE_2000MS 4).
export const FX_STORE = NOSTORE;
export const FX_CMD = { ext: { cls: 0x0f, id: 0x02 }, mext: { cls: 0x03, id: 0x0d } };
// zones: razercommon.h LED ids; 'all' = ZERO_LED, the whole-mouse set_*_effect methods (rmd.c:971-1310)
export const FX_ZONES = {
  logo: { led: 0x04, name: 'logo' }, scroll: { led: 0x01, name: 'scroll wheel' }, left: { led: 0x11, name: 'left side' },
  right: { led: 0x10, name: 'right side' }, backlight: { led: 0x05, name: 'backlight' }, all: { led: 0x00, name: 'mouse' },
};
// openrazer's case lists, per effect: the builder ('ext' / 'mext'), the transaction id, the line of the call (at) and of
// the transaction id (tidAt), and the product ids of that case that this driver has (the others are not Razer mice here)
export const FX_ZONE = {
  wave: [   // razer_attr_write_matrix_effect_wave_common rmd.c:4581
    { cmd: 'ext', tid: 0x3f, at: 4599, tidAt: 4600, pids: '0059 005A 0060 006F 0070' },
    { cmd: 'ext', tid: 0x1f, at: 4629, tidAt: 4630, pids: '0096 008D 008F 0090 006C 0099 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 0088 0086 00A7 00A8 00B9 00C8 00C7 00D0 00D1' },
  ],
  spectrum: [   // razer_attr_write_matrix_effect_spectrum_common rmd.c:4666
    { cmd: 'mext', tid: 0x3f, at: 4693, tidAt: 4694, pids: '0050 0053' },
    { cmd: 'ext', tid: 0x3f, at: 4717, tidAt: 4718, pids: '005C 0059 005A 0060 006F 0070 0072 0073 006A 006B 0078 008A 007A 007B 0064 0065 0084 007C 007D 008C' },
    { cmd: 'ext', tid: 0x1f, at: 4751, tidAt: 4752, pids: '0091 0096 008D 008F 0090 006C 0088 0086 0085 0099 00A3 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00A1 00A7 00A8 00B9 00C8 00C7 00D0 00D1' },
  ],
  reactive: [   // razer_attr_write_matrix_effect_reactive_common rmd.c:4789
    { cmd: 'mext', tid: 0x3f, at: 4807, tidAt: 4808, pids: '0050 0053' },
    { cmd: 'ext', tid: 0x3f, at: 4831, tidAt: 4832, pids: '005C 0059 005A 0060 006F 0070 0072 0073 006A 006B 0078 008A 007A 007B 0064 0065 0084 007C 007D 008C' },
    { cmd: 'ext', tid: 0x1f, at: 4853, tidAt: 4854, pids: '0091 0096 008D 008F 0090 006C 0088 0086 0085 00A1 00A7 00A8 00A3 00B9 00C8 00C7 00D0 00D1' },
  ],
  static: [   // razer_attr_write_matrix_effect_static_common rmd.c:5122
    { cmd: 'mext', tid: 0x3f, at: 5162, tidAt: 5163, pids: '0053 0050' },
    { cmd: 'ext', tid: 0x3f, at: 5189, tidAt: 5190, pids: '005C 0059 005A 0060 006F 0070 006E 0098 0071 0072 0073 006A 006B 0078 008A 007A 007B 0064 0065 0084 007C 007D 008C' },
    { cmd: 'ext', tid: 0x1f, at: 5223, tidAt: 5224, pids: '0091 0096 008D 008F 0090 006C 0088 0086 0085 0099 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00A1 00A7 00A8 00A3 00B9 00C8 00C7 00D0 00D1' },
  ],
  none: [   // razer_attr_write_matrix_effect_none_common rmd.c:5325
    { cmd: 'mext', tid: 0x3f, at: 5381, tidAt: 5382, pids: '0053 0050' },
    { cmd: 'ext', tid: 0x3f, at: 5408, tidAt: 5409, pids: '005C 0059 005A 0060 006F 0070 006E 0098 0071 0072 0073 006A 006B 0078 008A 007A 007B 0064 0065 0084 007C 007D 008C' },
    { cmd: 'ext', tid: 0x1f, at: 5441, tidAt: 5442, pids: '0091 0096 008D 008F 0090 006C 0088 0086 0085 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00A1 00A7 00A8 00A3 00B9 00C8 00C7 00D0 00D1' },
  ],
  // razer_attr_write_matrix_effect_breath_common rmd.c:4891: the builder by the first switch (mext 4941 single / 4945
  // dual / 4949 random; ext 4997 / 5001 / 5005), the transaction id by the second (0x1f rmd.c:5053, 0x3f rmd.c:5094)
  breath: [
    { cmd: 'mext', tid: 0x3f, at: 4941, tidAt: 5094, pids: '0053 0050' },
    { cmd: 'ext', tid: 0x1f, at: 4997, tidAt: 5053, pids: '0091 0096 008D 008F 0090 006C 0085 0088 0086 00A1 00A7 00A8 00B9 00C8 00C7 00D0 00D1' },
    { cmd: 'ext', tid: 0x3f, at: 4997, tidAt: 5094, pids: '005C 0059 005A 0060 006F 0070 006E 0098 0071 0072 0073 006A 006B 0078 008A 007A 007B 0064 0065 0084 007C 007D 008C 00A3' },
  ],
};
// the whole-mouse effects on ZERO_LED (rmd.c razer_attr_write_matrix_effect_static 1121, _wave 1210, _spectrum 1260,
// _none 971): only their extended 0x0F/0x02 case
export const FX_ALL = {
  static: [{ cmd: 'ext', tid: 0x1f, at: 1188, tidAt: 1189, pids: '0099 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00C8 00C7 00D0 00D1' }],
  wave: [{ cmd: 'ext', tid: 0x1f, at: 1239, tidAt: 1240, pids: '0099 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00C8 00C7 00D0 00D1' }],
  spectrum: [{ cmd: 'ext', tid: 0x1f, at: 1296, tidAt: 1297, pids: '0099 00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00C8 00C7 00D0 00D1' }],
  none: [{ cmd: 'ext', tid: 0x1f, at: 996, tidAt: 997, pids: '00DB 00DA 00B0 00AF 00AA 00AB 00CB 00CC 00CD 00D6 00D7 00C8 00C7 00D0 00D1 00D4 00D3' }],
};
// mouse.py METHODS per model: [class, line, 'zone:codes|...'] with S static, P spectrum, N none, R reactive, Bs / Bd / Br
// breathing single / dual / random, W wave, and Bl blinking, On, Bm breath mono (not built here) (set_<zone>_<effect>; zone
// 'all' = set_<effect>_effect). Models listed
// here whose effects are in no FX case above (standard or classic lighting) get no effect setting.
export const FX_METHODS = {
  '0099': ['BasiliskV3', 1192, 'scroll:W S P|all:S W P|logo:W S P'],
  '00AA': ['BasiliskV3ProWired', 1694, 'scroll:W S P N|all:S W P N|logo:W S P N'],
  '00AB': ['BasiliskV3ProWireless', 1730, 'scroll:W S P N|all:S W P N|logo:W S P N'],
  '00CB': ['BasiliskV3_35K', 1821, 'scroll:W S P N|all:S W P N|logo:W S P N'],
  '00CC': ['BasiliskV3Pro35KWired', 1738, 'scroll:W S P N|all:S W P N|logo:W S P N'],
  '00CD': ['BasiliskV3Pro35KWireless', 1774, 'scroll:W S P N|all:S W P N|logo:W S P N'],
  '00D6': ['BasiliskV3Pro35KPhantomGreenEditionWired', 1782, 'scroll:W S P N|all:S W P N'],
  '00D7': ['BasiliskV3Pro35KPhantomGreenEditionWireless', 1813, 'scroll:W S P N|all:S W P N'],
  '00B9': ['BasiliskV3XHyperSpeed', 1983, 'scroll:W S P N R Br Bs Bd'],
  '00A3': ['Cobra', 1925, 'logo:Br Bd Bs R P S N'],
  '00AF': ['CobraProWired', 1566, 'all:S W P N|logo:W S P N|scroll:W S P N'],
  '00B0': ['CobraProWireless', 1595, 'all:S W P N|logo:W S P N|scroll:W S P N'],
  '00DA': ['CobraHyperSpeed', 1602, 'all:S W P N|logo:W S P N'],
  '00DB': ['CobraHyperSpeedWireless', 1629, 'all:S W P N|logo:W S P N'],
  '00A7': ['NagaV2ProWired', 1011, 'logo:W S P N R Br Bs Bd|all:S P R N Br Bs Bd'],
  '00A8': ['NagaV2ProWireless', 1038, 'logo:W S P N R Br Bs Bd|all:S P R N Br Bs Bd'],
  '008A': ['ViperMini', 10, 'logo:S P N R Br Bs Bd'],
  '0085': ['BasiliskV2', 1168, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '007A': ['ViperUltimateWired', 817, 'logo:S P N R Br Bs Bd'],
  '007B': ['ViperUltimateWireless', 841, 'logo:S P N R Br Bs Bd'],
  '00A1': ['DeathAdderV2Lite', 1901, 'logo:S P N R Br Bs Bd'],
  '0091': ['Viper8KHz', 1399, 'logo:S P N R Br Bs Bd'],
  '006E': ['DeathAdderEssential', 873, 'logo:S N Bs|scroll:S N Bs'],
  '0071': ['DeathAdderEssentialWhiteEdition', 110, 'logo:S N Bs|scroll:S N Bs'],
  '0098': ['DeathAdderEssential2021', 892, 'logo:S N Bs'],
  '0084': ['DeathAdderV2', 1226, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '008C': ['DeathAdderV2Mini', 1375, 'logo:S P N R Br Bs Bd'],
  '007C': ['DeathAdderV2ProWired', 1249, 'logo:S P N R Br Bs Bd'],
  '007D': ['DeathAdderV2ProWireless', 1273, 'logo:S P N R Br Bs Bd'],
  '0059': ['LanceheadWired', 71, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '005A': ['LanceheadWireless', 102, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '0070': ['LanceheadWirelessWired', 32, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '006F': ['LanceheadWirelessReceiver', 63, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '0060': ['LanceheadTE', 172, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '005C': ['DeathAdderElite', 583, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '0043': ['DeathAdderChroma', 331, 'logo:N S Bs Bl P|scroll:N S Bs Bl P'],
  '004F': ['DeathAdder2000', 347, 'logo:N On Bm|scroll:N On Bm'],
  '0054': ['DeathAdder3500', 801, 'logo:N S Bs Bl|scroll:N S Bs Bl'],
  '0078': ['Viper', 851, 'logo:S P N R Br Bs Bd'],
  '0064': ['Basilisk', 1060, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '0065': ['BasiliskEssential', 1084, 'logo:P R Br Bs Bd S N'],
  '0086': ['BasiliskUltimateWired', 1106, 'logo:P R Br Bs Bd S N|scroll:P R Br Bs Bd S N|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '0088': ['BasiliskUltimateReceiver', 1161, 'logo:P R Br Bs Bd S N|scroll:P R Br Bs Bd S N|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '00D3': ['BasiliskMobileWired', 2005, 'all:S N'],
  '00D4': ['BasiliskMobileReceiver', 2026, 'all:S N'],
  '0096': ['NagaX', 1345, 'scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd'],
  '008D': ['NagaLeftHanded2020', 939, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '008F': ['NagaProWired', 971, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|all:S P R N Br Bs Bd'],
  '0090': ['NagaProWireless', 1003, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|all:S P R N Br Bs Bd'],
  '0067': ['NagaTrinity', 500, 'all:S'],
  '0050': ['NagaHexV2', 378, 'backlight:S P R N Br Bs Bd|logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '0053': ['NagaChroma', 455, 'backlight:S P R N Br Bs Bd|logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '003E': ['NagaEpicChromaWired', 1451, 'scroll:N S Bs P|backlight:N S Bs P'],
  '003F': ['NagaEpicChromaWireless', 1469, 'scroll:N S Bs P|backlight:N S Bs P'],
  '0040': ['Naga2014', 724, 'logo:N On|scroll:N On|backlight:N On'],
  '006C': ['MambaElite', 908, 'logo:W S P N R Br Bs Bd|scroll:W S P N R Br Bs Bd|left:W S P N R Br Bs Bd|right:W S P N R Br Bs Bd'],
  '0073': ['MambaWirelessWired', 691, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '0072': ['MambaWirelessReceiver', 715, 'logo:S P N R Br Bs Bd|scroll:S P N R Br Bs Bd'],
  '0044': ['MambaChromaWired', 221, 'backlight:W S P R N Br Bs Bd'],
  '0045': ['MambaChromaWireless', 201, 'backlight:W S P R N Br Bs Bd'],
  '0046': ['MambaTE', 240, 'backlight:W S P R N Br Bs Bd'],
  '0024': ['Mamba2012Wired', 674, 'scroll:N S P'],
  '0025': ['Mamba2012Wireless', 658, 'scroll:N S P'],
  '006A': ['AbyssusEliteDVaEdition', 132, 'logo:S P N R Br Bs Bd'],
  '006B': ['AbyssusEssential', 152, 'logo:S P N R Br Bs Bd'],
  '005B': ['AbyssusV2', 757, 'logo:N S Bs Bl P|scroll:N S Bs Bl P'],
  '005E': ['Abyssus2000', 787, 'logo:N On'],
  '00D0': ['ProClickV2Wired', 2173, 'all:S W P N'],
  '00D1': ['ProClickV2Wireless', 2194, 'all:S W P N'],
  '00C7': ['ProClickV2VerticalEditionWired', 2145, 'all:S W P N'],
  '00C8': ['ProClickV2VerticalEditionWireless', 2166, 'all:S W P N'],
  '0032': ['Ouroboros', 283, 'scroll:N On'],
  '0048': ['OrochiWired', 312, 'scroll:N On|backlight:S P R N Br Bs Bd'],
  '0034': ['Taipan', 566, 'logo:N On|scroll:N On'],
  '004C': ['DiamondbackChroma', 607, 'backlight:W S P R N Br Bs Bd'],
};
// the choices of one zone's effect: [value, label, METHODS code, FX group, parameter]
export const FX_OPTIONS = [
  ['static', 'Static colour', 'S', 'static'],
  ['breathing', 'Breathing, one colour', 'Bs', 'breath'],
  ['breathingDual', 'Breathing, two colours', 'Bd', 'breath'],
  ['breathingRandom', 'Breathing, random colours', 'Br', 'breath'],
  ['spectrum', 'Spectrum (colour cycle)', 'P', 'spectrum'],
  ['waveUp', 'Wave, upward', 'W', 'wave', 0x01],
  ['waveDown', 'Wave, downward', 'W', 'wave', 0x02],
  ['reactive1', 'Lights up when clicked, 0.5 s', 'R', 'reactive', 0x01],
  ['reactive2', 'Lights up when clicked, 1 s', 'R', 'reactive', 0x02],
  ['reactive3', 'Lights up when clicked, 1.5 s', 'R', 'reactive', 0x03],
  ['reactive4', 'Lights up when clicked, 2 s', 'R', 'reactive', 0x04],
  ['off', 'Off', 'N', 'none'],
];
const USES_C1 = new Set(['static', 'breathing', 'breathingDual', 'reactive1', 'reactive2', 'reactive3', 'reactive4']);
const USES_C2 = new Set(['breathingDual']);
export const FX_DEFAULT = { c1: '#00ff00', c2: '#0000ff' };   // the colours an effect uses until the person picks one
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const inGroup = (list, pid) => (list || []).find((g) => g.pids.split(' ').includes(pid)) || null;
// the effects one model has: [{ zone, led, name, options: [{ value, label, group: { cmd, tid, at, tidAt }, param }] }]
export function effectsFor(pid) {
  const row = FX_METHODS[pid];
  if (!row) return [];
  const out = [];
  for (const part of row[2].split('|')) {
    const [zone, codes] = part.split(':');
    const has = new Set(codes.split(' '));
    const table = zone === 'all' ? FX_ALL : FX_ZONE;
    const options = [];
    for (const [value, label, code, group, param] of FX_OPTIONS) {
      const g = has.has(code) ? inGroup(table[group], pid) : null;
      if (g) options.push({ value, label, group: g, param });
    }
    // a zone with nothing but Off is not offered
    if (options.some((o) => o.value !== 'off')) out.push({ zone, ...FX_ZONES[zone], options });
  }
  return out;
}
// the write-only settings for one model's effects (effect, colour, second colour per zone)
export function effectSettings(pid) {
  const out = [];
  for (const z of effectsFor(pid)) {
    const Z = cap(z.zone), vals = z.options.map((o) => o.value);
    const test = vals.includes('spectrum') ? 'spectrum' : vals.includes('static') ? 'static' : vals.find((v) => v !== 'off');
    out.push({ key: `effect${Z}`, label: z.zone === 'all' ? 'Light effect (whole mouse)' : `Light effect: ${z.name}`, type: 'choice', group: 'lights',
      options: z.options.map(({ value, label }) => ({ value, label })), hint: 'Lasts until the mouse is unplugged (never saved on the mouse)',
      writeOnly: { volatile: true, confirm: `Is the ${z.name} showing this now: {value}?`, test, restore: 'previous' } });
    if (vals.some((v) => USES_C1.has(v))) out.push({ key: `color${Z}`, label: z.zone === 'all' ? 'Light colour (whole mouse)' : `Light colour: ${z.name}`, type: 'color', group: 'lights',
      hint: 'Used by the static, breathing and click effects; picking one shows it as a static colour unless one of those is on',
      writeOnly: { volatile: true, confirm: `Did the ${z.name} light turn {value}?`, test: '#ff0000', restore: 'previous' } });
    if (vals.some((v) => USES_C2.has(v))) out.push({ key: `color2${Z}`, label: z.zone === 'all' ? 'Second colour (whole mouse)' : `Second colour: ${z.name}`, type: 'color', group: 'lights',
      hint: 'Used by breathing with two colours; picking one turns that effect on',
      writeOnly: { volatile: true, confirm: `Is the ${z.name} now breathing between two colours, one of them {value}?`, test: '#0000ff', restore: 'previous' } });
  }
  return out;
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// one effect's report arguments with NOSTORE, byte for byte as the rcc.c builder lays them out: { size, args }
export function fxArgs(cmd, value, led, param, c1 = FX_DEFAULT.c1, c2 = FX_DEFAULT.c2) {
  const s = FX_STORE, a = rgbOf(c1), b = rgbOf(c2);
  if (cmd === 'ext') {
    if (value === 'off') return { size: 0x06, args: [s, led, 0x00, 0, 0, 0] };                                    // rcc.c:498 none
    if (value === 'static') return { size: 0x09, args: [s, led, 0x01, 0, 0, 0x01, ...a] };                       // rcc.c:511 [5] 01, [6-8] RGB
    if (value === 'spectrum') return { size: 0x06, args: [s, led, 0x03, 0, 0, 0] };                              // rcc.c:605
    if (/^wave/.test(value)) return { size: 0x06, args: [s, led, 0x04, param, 0x28, 0] };                        // rcc.c:531 [3] dir, [4] 0x28
    if (/^reactive/.test(value)) return { size: 0x09, args: [s, led, 0x05, 0, param, 0x01, ...a] };              // rcc.c:639 [4] speed, [5] 01
    if (value === 'breathingRandom') return { size: 0x06, args: [s, led, 0x02, 0, 0, 0] };                       // rcc.c:662
    if (value === 'breathing') return { size: 0x09, args: [s, led, 0x02, 0x01, 0, 0x01, ...a] };                 // rcc.c:667 [3] 01, [5] 01
    if (value === 'breathingDual') return { size: 0x0c, args: [s, led, 0x02, 0x02, 0, 0x02, ...a, ...b] };       // rcc.c:680 [3] 02, [5] 02
  } else if (cmd === 'mext') {
    if (value === 'off') return { size: 0x03, args: [s, led, 0x00] };                                            // rcc.c:801
    if (value === 'static') return { size: 0x06, args: [s, led, 0x06, ...a] };                                   // rcc.c:812
    if (value === 'spectrum') return { size: 0x03, args: [s, led, 0x04] };                                       // rcc.c:828
    if (/^reactive/.test(value)) return { size: 0x07, args: [s, led, 0x02, param, ...a] };                       // rcc.c:841
    if (value === 'breathingRandom') return { size: 0x0a, args: [s, led, 0x03, 0x03, 0, 0, 0, 0, 0, 0] };        // rcc.c:863
    if (value === 'breathing') return { size: 0x0a, args: [s, led, 0x03, 0x01, ...a, 0, 0, 0] };                 // rcc.c:871
    if (value === 'breathingDual') return { size: 0x0a, args: [s, led, 0x03, 0x02, ...a, ...b] };                // rcc.c:883
  }
  throw new Error(`${value} is not an effect this driver builds with ${cmd}`);
}

// §2 Transaction ids: try 0x1F, then 0x3F, then 0xFF (§4: "keep the one that answers 0x02")
export const PROBE_TIDS = [0x1f, 0x3f, 0xff];

// the maker's app: two programs writing one mouse fight (CLAUDE.md "close its maker's app"). The process names are the
// ones helpers/diagnose.mjs already looks for (Razer Synapse 3 / 4, Razer App Engine).
export const VENDOR_APPS = [/^razer synapse/i, /^razerappengine\.exe$/i];

// ---- the models (razer.md §1 Mice; transaction ids §2; waits §2 "Wait between write and read") ----
// tid: the sheet's transaction id, or null = found by the probe order with reads only.
// wait: ms between the write and the first read. 0.6 = RAZER_MOUSE_WAIT_US (wired default), 31 =
//   RAZER_NEW_MOUSE_RECEIVER_WAIT_US, 59.9 = RAZER_VIPER_MOUSE_RECEIVER_WAIT_US; a model the sheet does not list gets the
//   default and the busy poll below covers the rest.
// poll: 'rate2' where §3 lists the model as a polling_rate2 user, 'classic' where it says classic, null = whichever of
//   the two reads answers (reads only; rate2 first, since only its users have 0xC0), false = none: not even probed (a
//   review, 1 Nov 2026: openrazer sends the Mamba TE and Diamondback Chroma no polling command at all).
// iface: §2 Transport (3 for Basilisk V3 and V3 35K, else 0). power: 'rechargeable' | 'aa' (§3 Charging: skipped on AA
//   mice) | null (wired only: no battery). lowBatTid: §2 0xFF row ("Basilisk V3 Pro low-battery threshold").
// dpiMax: the maker's published sensor maximum, NOT in the sheet (unconfirmed); never above the sheet's 45000 clamp.
// secondPollTid: §2 0xFF row, "HyperPolling dongle second poll write".
// wheel: §3 Scroll mode "Basilisk-type wheels": the scroll rows are asked (reads) only on the Basilisk family.
// light: false where §3 Lighting says the model has none ("DeathAdder V3 Pro and Viper V3 Pro have no lighting") and on
//   the dongle; every other model is asked for brightness with reads, and only zones that answer become settings.
// dongleLed: §3 "Dongle indicator LED mode ... HyperPolling dongle".
// Added 23 Oct 2026 from OpenRazer itself (driver/razermouse_driver.c and .h, daemon/openrazer_daemon/hardware/mouse.py at
// commit 477f4d6; facts only, no code copied). "rmd.c:N" below is a line of razermouse_driver.c, "mouse.py:N" a line of
// mouse.py. For these models the source gives every value, so nothing is guessed:
// tids: { command: tid } where OpenRazer sends that command (get and set) with another transaction id than the model's
//   firmware read; setTids: the same for the set only (Naga V2 HyperSpeed reads the low-battery threshold with 1F and
//   writes it with FF). A command not named uses the model's tid.
// stages: false where mouse.py lists no get_dpi_stages for the model (the stage table is then not asked at all).
// leds: the LED ids mouse.py names for the model (logo 0x04 for get_logo_brightness, scroll wheel 0x01 for
//   get_scroll_brightness; razercommon.h); null = the probe below asks every mouse zone (reads only).
// dpiMax for these models is mouse.py's DPI_MAX (confirmed), not the maker's sheet.
const W = 0.6, NEW = 31, VIPER = 59.9;
const m = (model, link, o) => ({ model, link, tid: null, wait: W, poll: null, iface: 0, power: link === 'wired' ? null : 'rechargeable', dpiMax: DPI_MAX, wheel: false, light: true, dongleLed: false, tids: {}, setTids: {}, stages: true, leds: null, ...o });
export const MODELS = {
  '00B2': m('DeathAdder V3', 'wired', { tid: 0x1f, wait: NEW, poll: 'rate2', dpiMax: 30000 }),
  '00B6': m('DeathAdder V3 Pro', 'wired', { tid: 0x1f, wait: NEW, power: 'rechargeable', dpiMax: 30000, light: false }),
  '00B7': m('DeathAdder V3 Pro', 'dongle', { tid: 0x1f, wait: NEW, dpiMax: 30000, light: false }),
  '00C2': m('DeathAdder V3 Pro', 'wired', { tid: 0x1f, wait: NEW, power: 'rechargeable', dpiMax: 30000, light: false }),
  '00C3': m('DeathAdder V3 Pro', 'dongle', { tid: 0x1f, wait: NEW, dpiMax: 30000, light: false }),
  '00C4': m('DeathAdder V3 HyperSpeed', 'wired', { tid: 0x1f, wait: NEW, power: 'rechargeable', dpiMax: 26000 }),
  '00C5': m('DeathAdder V3 HyperSpeed', 'dongle', { tid: 0x1f, wait: NEW, dpiMax: 26000 }),
  '00BE': m('DeathAdder V4 Pro', 'wired', { tid: 0x1f, wait: NEW, poll: 'rate2', power: 'rechargeable', dpiMax: 45000 }),
  '00BF': m('DeathAdder V4 Pro', 'dongle', { tid: 0x1f, wait: NEW, poll: 'rate2', dpiMax: 45000 }),
  '00C0': m('Viper V3 Pro', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 35000, light: false }),
  '00C1': m('Viper V3 Pro', 'dongle', { tid: 0x1f, wait: VIPER, poll: 'rate2', dpiMax: 35000, light: false }),
  '00DE': m('Viper V3 Pro SE', 'wired', { power: 'rechargeable', dpiMax: 35000 }),
  '00DF': m('Viper V3 Pro SE', 'dongle', { dpiMax: 35000 }),
  '0099': m('Basilisk V3', 'wired', { tid: 0x1f, iface: 3, dpiMax: 26000, wheel: true }),
  '00AA': m('Basilisk V3 Pro', 'wired', { tid: 0x1f, wait: NEW, power: 'rechargeable', lowBatTid: 0xff, dpiMax: 30000, wheel: true }),
  '00AB': m('Basilisk V3 Pro', 'dongle', { tid: 0x1f, wait: NEW, lowBatTid: 0xff, dpiMax: 30000, wheel: true }),
  '00CB': m('Basilisk V3 35K', 'wired', { tid: 0x1f, wait: NEW, iface: 3, dpiMax: 35000, wheel: true }),
  '00CC': m('Basilisk V3 Pro 35K', 'wired', { tid: 0x1f, wait: NEW, power: 'rechargeable', dpiMax: 35000, wheel: true }),
  '00CD': m('Basilisk V3 Pro 35K', 'dongle', { tid: 0x1f, wait: NEW, dpiMax: 35000, wheel: true }),
  '00D6': m('Basilisk V3 35K Phantom Green', 'wired', { wait: NEW, power: 'rechargeable', dpiMax: 35000, wheel: true }),
  '00D7': m('Basilisk V3 35K Phantom Green', 'dongle', { wait: NEW, dpiMax: 35000, wheel: true }),
  '00B9': m('Basilisk V3 X HyperSpeed', 'dongle', { power: 'aa', dpiMax: 18000, wheel: true }),
  '00A3': m('Cobra', 'wired', { tid: 0xff, dpiMax: 8500 }),
  '00AF': m('Cobra Pro', 'wired', { wait: NEW, power: 'rechargeable', dpiMax: 30000 }),
  '00B0': m('Cobra Pro', 'dongle', { wait: NEW, dpiMax: 30000 }),
  '00DA': m('Cobra HyperSpeed', 'wired', { power: 'rechargeable', dpiMax: 26000 }),
  '00DB': m('Cobra HyperSpeed', 'dongle', { dpiMax: 26000 }),
  '00A7': m('Naga V2 Pro', 'wired', { wait: NEW, power: 'rechargeable', dpiMax: 30000 }),
  '00A8': m('Naga V2 Pro', 'dongle', { wait: NEW, dpiMax: 30000 }),
  '00B3': m('HyperPolling Wireless Dongle', 'dongle', { tid: 0x1f, wait: VIPER, poll: 'rate2', secondPollTid: 0xff, light: false, dongleLed: true }),
  // ---- added 23 Oct 2026 from OpenRazer (see "Added 23 Oct 2026" above). All poll 'classic': rmd.c read_poll_rate
  // (1944-2082) and write_poll_rate (2159-2268) use the classic 00/85 / 00/05 for each of them, never rate2. Waits from
  // razer_get_report (rmd.c:49-99); a model not named there gets RAZER_MOUSE_WAIT_US. ----
  // DeathAdder Essential family: tid FF for firmware, DPI, polling (rmd.c:914-922, 2676-2684, 2860-2868, 2073-2268);
  // brightness 0x3F (read_led_brightness rmd.c:4335-4337, write 4447-4449). No battery, no stages (mouse.py:873-903).
  // 1 Nov 2026 (a new-setup check), openrazer master mouse.py: RazerViperMini, RazerBasiliskV2, RazerViperUltimateWired /
  // Wireless (razermouse_driver.c: RAZER_VIPER_MOUSE_RECEIVER_WAIT_US for both), RazerDeathAdderV2Lite, RazerViper8KHz
  '008A': m('Viper Mini', 'wired', { dpiMax: 8500, leds: [0x04] }),
  '0085': m('Basilisk V2', 'wired', { dpiMax: 20000, stages: false, leds: [0x04, 0x01] }),
  '007A': m('Viper Ultimate', 'wired', { wait: VIPER, power: 'rechargeable', dpiMax: 20000, leds: [0x04] }),
  '007B': m('Viper Ultimate', 'dongle', { wait: VIPER, dpiMax: 20000, leds: [0x04] }),
  '00A1': m('DeathAdder V2 Lite', 'wired', { dpiMax: 8500, leds: [0x04] }),
  '0091': m('Viper 8K', 'wired', { dpiMax: 20000, leds: [0x04] }),
  // Orochi V2 receiver (support #27): openrazer RazerOrochiV2Receiver, RAZER_ATHERIS_RECEIVER_WAIT_US 400000 us
  '0094': m('Orochi V2', 'dongle', { wait: 400, power: 'aa', dpiMax: 18000, light: false }),
  '006E': m('DeathAdder Essential', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 6400, stages: false, tids: { brightness: 0x3f }, leds: [0x04, 0x01] }),
  '0071': m('DeathAdder Essential White Edition', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 6400, stages: false, tids: { brightness: 0x3f }, leds: [0x04, 0x01] }),
  '0098': m('DeathAdder Essential (2021)', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 6400, stages: false, tids: { brightness: 0x3f }, leds: [0x04] }),
  // DeathAdder V2 / V2 Mini: tid 3F (rmd.c:875-878, 2586-2589, 2831-2834, 1944-2162); brightness 3F (4348-4351);
  // V2 Mini's stage table FF (read 3349, write 3230); V2 has no stages in mouse.py (1226-1246).
  '0084': m('DeathAdder V2', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 20000, stages: false, leds: [0x04, 0x01] }),
  '008C': m('DeathAdder V2 Mini', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 8500, tids: { dpiStages: 0xff }, leds: [0x04] }),
  // DeathAdder V2 Pro: tid 3F (firmware 876-877, DPI, polling, battery 1608-1609, charging 1728-1729, brightness
  // 4349-4350); FF for the idle timer (3485-3486, 3593-3594), low battery (3680-3681, 3786-3787) and stages (3345-3346,
  // 3226-3227); wait RAZER_VIPER_MOUSE_RECEIVER_WAIT_US (rmd.c:96-97).
  '007C': m('DeathAdder V2 Pro', 'wired', { tid: 0x3f, wait: VIPER, poll: 'classic', power: 'rechargeable', dpiMax: 20000, tids: { idle: 0xff, lowBattery: 0xff, dpiStages: 0xff }, leds: [0x04] }),
  '007D': m('DeathAdder V2 Pro', 'dongle', { tid: 0x3f, wait: VIPER, poll: 'classic', dpiMax: 20000, tids: { idle: 0xff, lowBattery: 0xff, dpiStages: 0xff }, leds: [0x04] }),
  // DeathAdder V2 X HyperSpeed: tid 1F (818, 1624, 3423/3531, 3290/3171); low battery FF (3688, 3794); charge status
  // answered "0" without asking (1715: AA battery); no brightness in rmd.c or mouse.py (1507-1520); wait NEW (rmd.c:49).
  '009C': m('DeathAdder V2 X HyperSpeed', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'aa', dpiMax: 14000, tids: { lowBattery: 0xff }, light: false }),
  // Viper V2 Pro: tid 1F (819-820, 1625-1626, 1741-1742, 3424-3425/3532-3533, 3291-3292/3172-3173); low battery FF
  // (3689-3690, 3795-3796); no lighting methods (mouse.py:1541-1563); wait NEW (rmd.c:50-51).
  '00A5': m('Viper V2 Pro', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 30000, tids: { lowBattery: 0xff }, light: false }),
  '00A6': m('Viper V2 Pro', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 30000, tids: { lowBattery: 0xff }, light: false }),
  // Viper V3 HyperSpeed: tid 1F for every command used here (847, 1651, 3449/3557, 3637/3743, 3318/3199); charge status
  // "0" without asking (1717: AA battery); no lighting (mouse.py:1966-1980); wait VIPER (rmd.c:99).
  '00B8': m('Viper V3 HyperSpeed', 'dongle', { tid: 0x1f, wait: VIPER, poll: 'classic', power: 'aa', dpiMax: 30000, light: false }),
  // Naga V2 HyperSpeed receiver: tid 1F (846, 1650, 3448/3556, 3317/3198); low battery read 1F (3636) but written with FF
  // (3803); charge status "0" without asking (1716: AA battery); no lighting (mouse.py:1948-1963); wait NEW (rmd.c:71).
  '00B4': m('Naga V2 HyperSpeed', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'aa', dpiMax: 30000, setTids: { lowBattery: 0xff }, light: false }),
  // ---- 1 Nov 2026: the rest of openrazer master's mice (commit 477f4d6) that speak this 90-byte report. Every value is
  // from openrazer: model, USB_PID and DPI_MAX from the class in daemon/openrazer_daemon/hardware/mouse.py (a receiver
  // class takes its parent's DPI_MAX); transaction ids per command from driver/razermouse_driver.c (functions
  // razer_attr_read_firmware_version, _read/_write_dpi, _read/_write_poll_rate, _read/_write_dpi_stages,
  // _read_charge_level, _read_charge_status, _read/_write_device_idle_time, _read/_write_charge_low_threshold,
  // _read/_write_led_brightness, _read/_write_matrix_brightness); waits and report index from razer_get_report. Names are
  // driver/razermouse_driver.h USB_DEVICE_ID_RAZER_*. poll 'classic' = the model reads razer_chroma_misc_get_polling_rate.
  // stages: false where mouse.py lists no get_dpi_stages; leds: the zones mouse.py names (get_logo / get_scroll /
  // get_left / get_right_brightness); leds null where mouse.py names only get_brightness (the extended ZERO_LED read):
  // the probe asks with reads only. light: false where mouse.py names no brightness, or where the driver reads it with the
  // standard 0x03 class (razer_chroma_standard_get_led_brightness, "dock" brightness), which this table does not send.
  // power 'aa' where razer_attr_read_charge_status answers "0" without asking (its "Use AA batteries" case list).
  // Lancehead (Wired 0059 / Wireless 005A; Wireless 2019: wired 0070, receiver 006F; TE 0060): firmware, DPI, polling and
  // brightness 3F; stages, idle and low battery FF; battery and charging 3F (0059/005A) or 1F (0070/006F); 006F / 0070
  // take RAZER_NEW_MOUSE_RECEIVER_WAIT_US. mouse.py RazerLanceheadWired / Wireless / WirelessWired / WirelessReceiver / TE.
  '0059': m('Lancehead', 'wired', { tid: 0x3f, poll: 'classic', power: 'rechargeable', dpiMax: 16000, tids: { dpiStages: 0xff, idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '005A': m('Lancehead', 'dongle', { tid: 0x3f, poll: 'classic', dpiMax: 16000, tids: { dpiStages: 0xff, idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '0070': m('Lancehead Wireless', 'wired', { tid: 0x3f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 16000, tids: { battery: 0x1f, charging: 0x1f, dpiStages: 0xff, idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '006F': m('Lancehead Wireless', 'dongle', { tid: 0x3f, wait: NEW, poll: 'classic', dpiMax: 16000, tids: { battery: 0x1f, charging: 0x1f, dpiStages: 0xff, idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '0060': m('Lancehead Tournament Edition', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 16000, tids: { dpiStages: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  // DeathAdder Elite 005C: 3F throughout (RazerDeathAdderElite). DeathAdder Chroma 0043, 2000 004F, 3500 0054: FF; their
  // lighting is the standard class (RazerDeathAdderChroma / 2000 / 3500).
  '005C': m('DeathAdder Elite', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 16000, stages: false, leds: [0x04, 0x01] }),
  '0043': m('DeathAdder Chroma', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 10000, stages: false, light: false }),
  '004F': m('DeathAdder 2000', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 2000, stages: false, light: false }),
  '0054': m('DeathAdder 3500', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 3500, stages: false, light: false }),
  // Viper 0078 (RazerViper): FF, brightness 3F
  '0078': m('Viper', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 16000, tids: { brightness: 0x3f }, leds: [0x04] }),
  // Viper Mini SE (RazerViperMiniSEWired 009E / Wireless 009F): 1F throughout, polling_rate2 (read 0xC0, written with
  // 0x00 then 0x01, both 1F: razer_attr_write_poll_rate), RAZER_VIPER_MOUSE_RECEIVER_WAIT_US; 009F has the dongle light
  // (razer_attr_read_hyperpolling_wireless_dongle_indicator_led_mode, 1F); no brightness in mouse.py.
  '009E': m('Viper Mini SE', 'wired', { tid: 0x1f, wait: VIPER, poll: 'rate2', power: 'rechargeable', dpiMax: 30000, light: false }),
  '009F': m('Viper Mini SE', 'dongle', { tid: 0x1f, wait: VIPER, poll: 'rate2', dpiMax: 30000, light: false, dongleLed: true }),
  // Basilisk 0064 (3F), Basilisk Essential 0065 (3F, stages FF); Basilisk Ultimate (wired 0086 / receiver 0088): 1F,
  // polling read FF but written 1F, idle and low battery FF, RAZER_NEW_MOUSE_RECEIVER_WAIT_US; Basilisk X HyperSpeed 0083:
  // FF throughout, AA, new-receiver wait; Basilisk Mobile (wired 00D3 / receiver 00D4): 1F, AA, new-receiver wait,
  // brightness read 1F but written 3F (razer_attr_write_matrix_brightness).
  '0064': m('Basilisk', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 16000, stages: false, leds: [0x04, 0x01] }),
  '0065': m('Basilisk Essential', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 6400, tids: { dpiStages: 0xff }, leds: [0x04] }),
  '0086': m('Basilisk Ultimate', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 20000, stages: false, tids: { poll: 0xff, idle: 0xff, lowBattery: 0xff }, setTids: { poll: 0x1f }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '0088': m('Basilisk Ultimate', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 20000, stages: false, tids: { poll: 0xff, idle: 0xff, lowBattery: 0xff }, setTids: { poll: 0x1f }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '0083': m('Basilisk X HyperSpeed', 'dongle', { tid: 0xff, wait: NEW, poll: 'classic', power: 'aa', dpiMax: 16000, light: false }),
  '00D3': m('Basilisk Mobile', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'aa', dpiMax: 18000, setTids: { brightness: 0x3f } }),
  '00D4': m('Basilisk Mobile', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'aa', dpiMax: 18000, setTids: { brightness: 0x3f } }),
  // Naga X 0096: 1F, stages FF, report index 0x03 (razer_get_report, as Basilisk V3). Naga Left-Handed 2020 008D: 1F.
  // Naga Pro (wired 008F / wireless 0090): 1F; only 0090 takes the new-receiver wait. Naga Trinity 0067: FF, brightness 3F.
  // Naga Hex V2 0050 (3F), Naga Chroma 0053 (FF), Naga Epic Chroma (wired 003E / dock 003F, FF), Naga 2014 0040 (FF):
  // standard-class or no lighting.
  '0096': m('Naga X', 'wired', { tid: 0x1f, poll: 'classic', iface: 3, dpiMax: 18000, tids: { dpiStages: 0xff }, leds: [0x01, 0x11] }),
  '008D': m('Naga Left-Handed Edition', 'wired', { tid: 0x1f, poll: 'classic', dpiMax: 20000, stages: false, leds: [0x04, 0x01, 0x10] }),
  '008F': m('Naga Pro', 'wired', { tid: 0x1f, poll: 'classic', power: 'rechargeable', dpiMax: 20000, leds: [0x04, 0x01] }),
  '0090': m('Naga Pro', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 20000, leds: [0x04, 0x01] }),
  '0067': m('Naga Trinity', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 16000, stages: false, tids: { brightness: 0x3f } }),
  '0050': m('Naga Hex V2', 'wired', { tid: 0x3f, poll: 'classic', dpiMax: 16000, stages: false, light: false }),
  '0053': m('Naga Chroma', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 16000, stages: false, light: false }),
  '003E': m('Naga Epic Chroma', 'wired', { tid: 0xff, poll: 'classic', power: 'rechargeable', dpiMax: 8200, stages: false, light: false }),
  '003F': m('Naga Epic Chroma', 'dongle', { tid: 0xff, poll: 'classic', dpiMax: 8200, stages: false, light: false }),
  '0040': m('Naga 2014', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 8200, stages: false, light: false }),
  // Mamba Elite 006C: 1F, polling FF. Mamba Wireless 2018 (wired 0073 / receiver 0072): 3F, idle and low battery FF,
  // new-receiver wait. Mamba Chroma (wired 0044 / wireless 0045): FF, polling written 3F; Mamba Tournament Edition 0046
  // (FF, no polling in the driver: poll null = reads only); Mamba 2012 (wired 0024 / wireless 0025): FF; standard lighting.
  '006C': m('Mamba Elite', 'wired', { tid: 0x1f, poll: 'classic', dpiMax: 16000, stages: false, tids: { poll: 0xff }, leds: [0x04, 0x01, 0x11, 0x10] }),
  '0073': m('Mamba Wireless', 'wired', { tid: 0x3f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 16000, stages: false, tids: { idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01] }),
  '0072': m('Mamba Wireless', 'dongle', { tid: 0x3f, wait: NEW, poll: 'classic', dpiMax: 16000, stages: false, tids: { idle: 0xff, lowBattery: 0xff }, leds: [0x04, 0x01] }),
  '0044': m('Mamba Chroma', 'wired', { tid: 0xff, poll: 'classic', power: 'rechargeable', dpiMax: 16000, stages: false, setTids: { poll: 0x3f }, light: false }),
  '0045': m('Mamba Chroma', 'dongle', { tid: 0xff, poll: 'classic', dpiMax: 16000, stages: false, setTids: { poll: 0x3f }, light: false }),
  '0046': m('Mamba Tournament Edition', 'wired', { tid: 0xff, poll: false, dpiMax: 16000, stages: false, light: false }),
  '0024': m('Mamba (2012)', 'wired', { tid: 0xff, poll: 'classic', power: 'rechargeable', dpiMax: 6400, stages: false, light: false }),
  '0025': m('Mamba (2012)', 'dongle', { tid: 0xff, poll: 'classic', dpiMax: 6400, stages: false, light: false }),
  // Abyssus Elite D.Va Edition 006A / Essential 006B: FF, brightness 3F. Abyssus V2 005B, Abyssus 2000 005E: FF.
  '006A': m('Abyssus Elite D.Va Edition', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 7200, stages: false, tids: { brightness: 0x3f }, leds: [0x04] }),
  '006B': m('Abyssus Essential', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 7200, stages: false, tids: { brightness: 0x3f }, leds: [0x04] }),
  '005B': m('Abyssus V2', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 5000, stages: false, light: false }),
  '005E': m('Abyssus 2000', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 2000, stages: false, light: false }),
  // Pro Click (receiver 0077 / wired 0080): 1F, idle and low battery FF; Pro Click Mini receiver 009A, Pro Click V2
  // (wired 00D0 / wireless 00D1) and V2 Vertical Edition (wired 00C7 / wireless 00C8): 1F throughout. All new-receiver wait.
  '0080': m('Pro Click', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 16000, tids: { idle: 0xff, lowBattery: 0xff }, light: false }),
  '0077': m('Pro Click', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 16000, tids: { idle: 0xff, lowBattery: 0xff }, light: false }),
  '009A': m('Pro Click Mini', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 12000, light: false }),
  '00D0': m('Pro Click V2', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 30000 }),
  '00D1': m('Pro Click V2', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 30000 }),
  '00C7': m('Pro Click V2 Vertical Edition', 'wired', { tid: 0x1f, wait: NEW, poll: 'classic', power: 'rechargeable', dpiMax: 30000 }),
  '00C8': m('Pro Click V2 Vertical Edition', 'dongle', { tid: 0x1f, wait: NEW, poll: 'classic', dpiMax: 30000 }),
  // Atheris receiver 0062: 1F, stages, idle and low battery FF, AA, RAZER_ATHERIS_RECEIVER_WAIT_US. Ouroboros 0032 (one id,
  // battery: FF), Orochi Chroma 0048 (FF; mouse.py names no battery, so idle / low battery are not asked), Taipan 0034,
  // Diamondback Chroma 004C (FF, no polling in the driver): standard-class or no lighting.
  '0062': m('Atheris', 'dongle', { tid: 0x1f, wait: 400, poll: 'classic', power: 'aa', dpiMax: 7200, tids: { dpiStages: 0xff, idle: 0xff, lowBattery: 0xff }, light: false }),
  '0032': m('Ouroboros', 'wired', { tid: 0xff, poll: 'classic', power: 'rechargeable', dpiMax: 8200, stages: false, light: false }),
  '0048': m('Orochi Chroma', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 8200, stages: false, light: false }),
  '0034': m('Taipan', 'wired', { tid: 0xff, poll: 'classic', dpiMax: 8200, stages: false, light: false }),
  '004C': m('Diamondback Chroma', 'wired', { tid: 0xff, poll: false, dpiMax: 16000, stages: false, light: false }),
  // Not added (openrazer master): DeathAdder 3.5G 0016 / 3.5G Black 0029 (old control message, not this report); Orochi
  // 2011 0013 (its own poll+DPI command, no firmware read); Naga 0015, Naga 2012 002E, Naga Hex 0041, Naga Hex Red 0036,
  // Naga Epic 001F, Abyssus 1800 0020, DeathAdder 2013 0037, DeathAdder 1800 0038 (one-byte DPI, get_dpi_xy_byte);
  // Imperator 002F and Orochi 2013 0039 (DPI read with VARSTORE); Abyssus 0042 (no DPI in the driver, no DPI_MAX);
  // Orochi V2 Bluetooth 0095 (Bluetooth only).
};
export const PIDS = Object.keys(MODELS);

// after the wait, the reply is read again while it says new/busy, 10 ms apart (OpenRazer: 5 tries 10 ms apart),
// for up to ~100 ms (§2 "DeviceHub plan")
const POLL_EVERY = 10, POLL_FOR = 100;
const APP_CHECK_MS = 15000;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, '0');
const hexs = (u8) => Array.from(u8, hex2).join(' ');
const stageKey = (i) => `dpiStage${i}`;
const STAGE_KEY = /^dpiStage([1-5])$/;

class RazerError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

// every setting the page could show, before the first read; ready() narrows it to what this mouse answered
function allSettings(dpiMax = DPI_MAX, stageCount = STAGES_MAX, pollKind = null, leds = [...LEDS, LED_ALL]) {
  const pollMap = pollKind === 'classic' ? POLL_CLASSIC : POLL_RATE2;
  const out = [
    { key: 'dpi', label: 'DPI', type: 'slider', min: DPI_MIN, max: dpiMax, step: 50, unit: 'DPI', hint: 'The same value for X and Y; saved on the mouse' },
    { key: 'pollingRate', label: 'Polling rate', type: 'choice', options: Object.keys(pollMap).map(Number).sort((a, b) => a - b).map((hz) => ({ value: hz, label: `${hz} Hz` })),
      hint: pollKind === 'rate2' ? 'HyperPolling rates; 4000 and 8000 Hz need HyperPolling hardware' : undefined },
    { key: 'idle', label: 'Sleep after', type: 'slider', min: IDLE_MIN, max: IDLE_MAX, step: 30, unit: 's', hint: 'Idle time before the wireless mouse sleeps' },
    { key: 'lowBattery', label: 'Low-battery warning', type: 'slider', min: LOWBAT_MIN, max: LOWBAT_MAX, step: 1, unit: 'raw', hint: 'Raw value 12-63; Razer\'s scale is unconfirmed (about 5% to 25%)' },
  ];
  if (stageCount >= 2) out.push({ key: 'dpiStage', label: 'Active DPI stage', type: 'slider', min: 1, max: stageCount, step: 1, hint: 'Which stage of the mouse\'s DPI table it uses now' });
  for (let i = 1; i <= stageCount; i++) out.push({ key: stageKey(i), label: `DPI stage ${i}`, type: 'slider', min: DPI_MIN, max: dpiMax, step: 50, unit: 'DPI', hint: 'X and Y together; the number of stages stays as the mouse has it' });
  out.push({ key: 'scrollAccel', label: 'Scroll acceleration', type: 'toggle' });
  out.push({ key: 'smartReel', label: 'Smart reel', type: 'toggle', hint: 'The wheel switches to free spin by itself on a fast scroll' });
  out.push({ key: 'dongleLed', label: 'Dongle light shows', type: 'choice', options: Object.entries(DONGLE_LED).map(([v, label]) => ({ value: Number(v), label })) });
  for (const l of leds) out.push({ key: l.key, label: `Brightness: ${l.name}`, type: 'slider', min: 0, max: 255, step: 1, unit: '/255', hint: 'Saved on the mouse; colour and effect stay as they are' });
  return out;
}

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name)) && !/service|updater|crash/i.test(name)) return name; }   // a service or updater is not the app (1 Nov 2026: Synapse's service kept the device read-only, nothing to close)
  return null;
}

export function createRazerMouse({ sleep = sleepReal, open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now() } = {}) {
  return {
    id: 'razer-mouse',
    title: 'Razer mouse',
    kind: 'Mouse',
    vendor: 'Razer',
    hid: { vid: '1532', pid: '00B7', pids: PIDS, page: '0001', usage: '0002', len: LEN, featureLen: LEN, reportId: 0, featureOnly: true,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { iface: MODELS[p].iface }])) },
    unsupported: ['firmware updates (Razer\'s own updater only)', 'saving a lighting effect on the mouse (effects set here last until it is unplugged)',
      'per-key / custom-frame lighting', 'lighting effects on the older standard-lighting mice (their commands have no form that is not saved)', 'scroll mode (read only: no documented values)',
      'the number of DPI stages', 'buttons, macros and remaps', 'onboard profiles', 'lift-off distance, angle snapping, debounce', 'dongle pairing', 'device mode'],
    dev: null, pid: null, model: null, tid: null, tidHow: null, pollKind: null, has: null, raw: {}, q: Promise.resolve(),
    stageCount: 0, leds: [], scrollModeShown: false, app: null, appAt: 0, fx: {},

    // the page's list: before the first read every setting; then only those this mouse answered
    get settings() {
      // the lighting effects (write-only) depend only on the model, so they are listed as soon as one is connected
      const fx = this.pid ? effectSettings(this.pid) : [];
      if (!this.has) return [...allSettings(), ...fx];
      return [...allSettings(Math.min(this.model.dpiMax, DPI_MAX), this.stageCount, this.pollKind, this.leds).filter((s) => this.has.has(s.key)), ...fx];
    },

    // the first Razer product id that is plugged in, in the table's order. Opening sends nothing.
    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid, MODELS[pid]);
        if (dev) { this.attach(dev, pid); return true; }
      }
      return false;
    },

    attach(dev, pid) {
      this.dev = dev; this.pid = pid; this.model = MODELS[pid];
      this.tid = null; this.tidHow = null; this.pollKind = null; this.has = null; this.raw = {}; this.stageCount = 0; this.leds = []; this.scrollModeShown = false; this.appAt = 0; this.app = null; this.fx = {};
    },

    // one request at a time: send, wait the model's time, read until the reply is not new/busy and answers this request
    request(tid, cmd, idByte, args = []) {
      const run = async () => {
        const out = buildReport(tid, cmd.cls, idByte, cmd.size, args);
        await this.dev.sendFeatureReport(0, out);
        await sleep(this.model.wait);
        let waited = 0;
        for (;;) {
          const dv = await this.dev.receiveFeatureReport(0, LEN);
          const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          const r = parseReply(u8);
          // OpenRazer: remaining_packets, class and id must match; OpenRGB also matches the transaction id
          const ours = r.remaining === 0 && r.cls === cmd.cls && r.id === idByte && r.tid === tid;
          if (ours && r.status === 0x02) return r;
          if (ours && r.status === 0x03) throw new RazerError(`the mouse refused ${hex2(cmd.cls)}/${hex2(idByte)} (failure)`, 3);
          if (ours && r.status === 0x04) throw new RazerError('the mouse is asleep or out of range (no reply through the dongle)', 4);
          if (ours && r.status === 0x05) throw new RazerError(`${hex2(cmd.cls)}/${hex2(idByte)} is not supported with transaction id ${hex2(tid)}`, 5);
          // new (0x00), busy (0x01) or not this request's reply yet: read again
          if (waited >= POLL_FOR) throw new RazerError(`no reply to ${hex2(cmd.cls)}/${hex2(idByte)} (status ${STATUS[r.status] || hex2(r.status)})`, r.status);
          await sleep(POLL_EVERY); waited += POLL_EVERY;
        }
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },
    // the transaction id for one command: the model's own per-command id (OpenRazer), the §2 0xFF low-battery row, else the model's
    tidFor(name, dir) {
      const mo = this.model;
      if (dir === 'set' && mo.setTids?.[name] != null) return mo.setTids[name];
      if (mo.tids?.[name] != null) return mo.tids[name];
      if (name === 'lowBattery' && mo.lowBatTid != null) return mo.lowBatTid;
      return this.tid;
    },
    get(name, args = [], tid = this.tidFor(name, 'get'), rawKey = name) { const c = CMD[name]; return this.request(tid, c, c.get, args).then((r) => { this.raw[rawKey] = hexs(r.args.slice(0, c.size)); return r.args; }); },
    set(name, args, tid = this.tidFor(name, 'set')) { const c = CMD[name]; if (c.set == null) throw new Error(`${name} is read-only`); return this.request(tid, c, c.set, args); },

    // §3 DPI stages: the table's 38 argument bytes as the mouse sent them, and what they say
    async stageTable() {
      const a = Array.from((await this.get('dpiStages', [VARSTORE])).slice(0, CMD.dpiStages.size));
      const count = a[2], stages = [];
      for (let i = 0; i < count && 3 + STAGE_BYTES * i + 4 < a.length; i++) { const o = 3 + STAGE_BYTES * i; stages.push({ x: (a[o + 1] << 8) | a[o + 2], y: (a[o + 3] << 8) | a[o + 4] }); }
      return { bytes: a, active: a[1], count, stages };
    },

    // reads only: the transaction id (sheet's, or the probe order), then which settings answer
    async ready() {
      if (this.has) return;
      if (!this.dev) throw Object.assign(new Error('no Razer mouse is open'), { gone: true });
      const order = this.model.tid != null ? [this.model.tid, ...PROBE_TIDS.filter((t) => t !== this.model.tid)] : PROBE_TIDS;
      let found = null;
      for (const t of order) {
        // not supported, failure or no reply: the next id. Asleep or unplugged: stop (nothing is learned from silence)
        try { await this.get('firmware', [], t); found = t; break; } catch (e) { if (e.status === 4 || e.gone) throw e; }
      }
      if (found == null) throw new Error(`${this.model.model}: no transaction id answered (tried ${order.map(hex2).join(', ')})`);
      this.tid = found;
      this.tidHow = this.model.tid === found ? 'from the brand sheet' : `found by reads (tried ${order.slice(0, order.indexOf(found) + 1).map(hex2).join(', ')})`;
      const has = new Set();
      const tries = async (fn) => { try { await fn(); return true; } catch (e) { if (e.status === 4 || e.gone) throw e; return false; } };
      if (await tries(() => this.get('dpi', [NOSTORE]))) has.add('dpi');
      // polling: the sheet's kind, else whichever read answers with a code the sheet maps
      const kinds = this.model.poll === false ? [] : this.model.poll ? [this.model.poll] : ['rate2', 'classic'];
      for (const k of kinds) {
        let code = null;
        if (k === 'rate2' && (await tries(async () => { code = (await this.get('poll2', [0x00, 0x00]))[1]; }))) { if (codeToHz(POLL_RATE2, code)) { this.pollKind = 'rate2'; break; } }
        if (k === 'classic' && (await tries(async () => { code = (await this.get('poll', [0x00]))[0]; }))) { if (codeToHz(POLL_CLASSIC, code)) { this.pollKind = 'classic'; break; } }
      }
      if (this.pollKind) has.add('pollingRate');
      if (this.model.power) {
        if (await tries(() => this.get('idle', [0x00, 0x00]))) has.add('idle');
        if (await tries(() => this.get('lowBattery', [0x00]))) has.add('lowBattery');
      }
      // DPI stage table: written only when it fits the documented size (1-5 stages); the count is never changed
      let table = null;
      if (this.model.stages && await tries(async () => { table = await this.stageTable(); }) && table.count >= 1 && table.count <= STAGES_MAX && table.active >= 1 && table.active <= table.count) {
        this.stageCount = table.count;
        if (table.count >= 2) has.add('dpiStage');
        for (let i = 1; i <= table.count; i++) has.add(stageKey(i));
      }
      if (this.model.wheel) {
        const bool = async (name) => { let v = null; return (await tries(async () => { v = (await this.get(name, [VARSTORE]))[1]; })) && (v === 0 || v === 1); };
        if (await bool('scrollAccel')) has.add('scrollAccel');
        if (await bool('smartReel')) has.add('smartReel');
        if (await tries(() => this.get('scrollMode', [VARSTORE]))) this.scrollModeShown = true;
      }
      if (this.model.dongleLed) {
        let v = null;
        if ((await tries(async () => { v = (await this.get('dongleLed', [0x00]))[0]; })) && Object.hasOwn(DONGLE_LED, v)) has.add('dongleLed');
      }
      if (this.model.light) {
        const leds = [];
        const ask = this.model.leds ? LEDS.filter((l) => this.model.leds.includes(l.id)) : LEDS;
        for (const l of ask) if (await tries(() => this.get('brightness', [VARSTORE, l.id], undefined, `brightness_${hex2(l.id)}`))) leds.push(l);
        if (!leds.length && !this.model.leds && (await tries(() => this.get('brightness', [VARSTORE, LED_ALL.id], undefined, `brightness_${hex2(LED_ALL.id)}`)))) leds.push(LED_ALL);
        this.leds = leds;
        for (const l of leds) has.add(l.key);
      }
      this.has = has;
    },

    async info() {
      await this.ready();
      const fw = await this.get('firmware');
      const out = { Model: `Razer ${this.model.model}`, Connection: this.model.link === 'dongle' ? 'wireless (dongle)' : 'cable', 'Product id': `1532:${this.pid}`,
        Firmware: `${fw[0]}.${fw[1]}`, 'Transaction id': `0x${hex2(this.tid)} (${this.tidHow})` };
      if (this.pollKind) out['Polling command'] = this.pollKind === 'rate2' ? 'HyperPolling (00/C0)' : 'classic (00/85)';
      try {
        const t = await this.stageTable();
        if (t.count) out['DPI stages'] = `${t.stages.map((s) => s.x).join(', ')} (stage ${t.active} of ${t.count} active)`;
      } catch (e) { if (e.status === 4) throw e; }
      if (this.scrollModeShown) {
        try { out['Scroll mode (raw, values not documented)'] = (await this.get('scrollMode', [VARSTORE]))[1]; } catch (e) { if (e.status === 4) throw e; }
      }
      return out;
    },

    async read() {
      await this.ready();
      const v = {};
      if (this.has.has('dpi')) { const a = await this.get('dpi', [NOSTORE]); v.dpi = (a[1] << 8) | a[2]; const y = (a[3] << 8) | a[4]; if (y !== v.dpi) v.dpiY = y; }
      if (this.has.has('pollingRate')) {
        v.pollingRate = this.pollKind === 'rate2' ? codeToHz(POLL_RATE2, (await this.get('poll2', [0x00, 0x00]))[1]) : codeToHz(POLL_CLASSIC, (await this.get('poll', [0x00]))[0]);
      }
      if (this.has.has('idle')) { const a = await this.get('idle', [0x00, 0x00]); v.idle = (a[0] << 8) | a[1]; }
      if (this.has.has('lowBattery')) v.lowBattery = (await this.get('lowBattery', [0x00]))[0];
      if (this.stageCount) {
        const t = await this.stageTable();
        if (t.count !== this.stageCount) throw new Error(`the mouse now has ${t.count} DPI stages, not ${this.stageCount}: look again`);
        if (this.has.has('dpiStage')) v.dpiStage = t.active;
        t.stages.forEach((s, i) => { v[stageKey(i + 1)] = s.x; if (s.y !== s.x) v[`${stageKey(i + 1)}Y`] = s.y; });
      }
      // raw 0 / 1 only: another byte is not shown as on or off, so it is never written back as 0 or 1 (driver safety)
      const bit = (b) => (b === 1 ? true : b === 0 ? false : null);
      if (this.has.has('scrollAccel')) v.scrollAccel = bit((await this.get('scrollAccel', [VARSTORE]))[1]);
      if (this.has.has('smartReel')) v.smartReel = bit((await this.get('smartReel', [VARSTORE]))[1]);
      if (this.has.has('dongleLed')) v.dongleLed = (await this.get('dongleLed', [0x00]))[0];
      for (const l of this.leds) v[l.key] = (await this.get('brightness', [VARSTORE, l.id], undefined, `brightness_${hex2(l.id)}`))[2];
      return v;
    },

    // the maker's app running: no write (checked again every 15 s)
    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (two programs writing the mouse fight)`), { refused: true });
    },

    // a lighting effect setting (write-only): the report for the zone's effect with NOSTORE, on openrazer's transaction id
    // for that model and effect; nothing is read back (the command has no read). this.fx = what was sent this connection,
    // so a colour change re-sends the effect that is on.
    async writeEffect(s, value) {
      const m = /^(effect|color2|color)(.+)$/.exec(s.key);
      const zone = m[2][0].toLowerCase() + m[2].slice(1);
      const z = effectsFor(this.pid).find((x) => x.zone === zone);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label}: ${JSON.stringify(value)} is not an effect this mouse has`);
      if (s.type === 'color' && !(typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value))) throw new Error(`${s.label} must be a colour like #ff0000`);
      const st = { effect: null, c1: FX_DEFAULT.c1, c2: FX_DEFAULT.c2, ...this.fx[zone] };
      const has = (v) => z.options.some((o) => o.value === v);
      let effect;
      if (m[1] === 'effect') effect = value;
      else if (m[1] === 'color') { st.c1 = value; effect = USES_C1.has(st.effect) ? st.effect : ['static', 'breathing', 'reactive2'].find(has); }
      else { st.c2 = value; effect = USES_C2.has(st.effect) ? st.effect : 'breathingDual'; }
      const o = z.options.find((x) => x.value === effect);
      if (!o) throw new Error(`${s.label}: no effect on the ${z.name} uses it`);
      await this.appCheck();
      const { size, args } = fxArgs(o.group.cmd, effect, z.led, o.param, st.c1, st.c2);
      const c = FX_CMD[o.group.cmd];
      await this.request(o.group.tid, { cls: c.cls, size }, c.id, args);
      this.fx[zone] = { ...st, effect };
      return value;
    },

    // one setting, checked, written, read back; a read-back that differs is a failed write
    async write(key, value) {
      await this.ready();
      const fxs = typeof key === 'string' && this.pid ? effectSettings(this.pid).find((s) => s.key === key) : null;
      if (fxs) return this.writeEffect(fxs, value);
      if (typeof key !== 'string' || !this.has.has(key)) throw new Error(`${key} is not a setting of this mouse`);
      const setting = this.settings.find((s) => s.key === key);
      let n;
      if (setting.type === 'toggle') {
        if (typeof value !== 'boolean') throw new Error(`${key} is on or off (true / false)`);
        n = value;
      } else {
        n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
        if (!Number.isInteger(n)) throw new Error(`${key} must be a whole number`);
      }
      const led = this.leds.find((l) => l.key === key);
      const stage = STAGE_KEY.exec(key);
      // every value is checked before the maker's-app check and before anything is sent
      if (key === 'dpi' || stage) {
        const max = Math.min(this.model.dpiMax, DPI_MAX);
        if (n < DPI_MIN || n > max) throw new Error(`DPI must be ${DPI_MIN}-${max}`);
      } else if (key === 'pollingRate') {
        const map = this.pollKind === 'rate2' ? POLL_RATE2 : POLL_CLASSIC;
        if (!Object.hasOwn(map, n)) throw new Error(`${n} Hz is not a rate this mouse takes (${Object.keys(map).join(', ')})`);
      } else if (key === 'idle') {
        if (n < IDLE_MIN || n > IDLE_MAX) throw new Error(`sleep timer must be ${IDLE_MIN}-${IDLE_MAX} s`);
      } else if (key === 'lowBattery') {
        if (n < LOWBAT_MIN || n > LOWBAT_MAX) throw new Error(`low-battery threshold must be ${LOWBAT_MIN}-${LOWBAT_MAX} (raw)`);
      } else if (key === 'dpiStage') {
        if (n < 1 || n > this.stageCount) throw new Error(`the active stage must be 1-${this.stageCount}`);
      } else if (key === 'dongleLed') {
        if (!Object.hasOwn(DONGLE_LED, n)) throw new Error('the dongle light takes 1 (connection), 2 (battery) or 3 (battery warning)');
      } else if (led) {
        if (n < 0 || n > 255) throw new Error('brightness must be 0-255');
      }
      await this.appCheck();

      // driver safety (22 Oct 2026, docs/handoff/driver-safety.md): DPI is written as an X / Y pair. When the mouse holds
      // X = Y, both take the new value (as before); when they differ, Y goes back exactly as just read and only X changes,
      // so writing back the X just read (the self-check) leaves both raw values as they were.
      let keepY = null;
      if (key === 'dpi') {
        // §3 DPI set: [0] = VARSTORE, [1-2] X BE, [3-4] Y BE, [5-6] 0
        const a = await this.get('dpi', [NOSTORE]);
        const x0 = (a[1] << 8) | a[2], y0 = (a[3] << 8) | a[4];
        const y = y0 === x0 ? n : y0;
        if (y !== n) keepY = y;
        await this.set('dpi', [VARSTORE, n >> 8, n & 0xff, y >> 8, y & 0xff, 0, 0]);
      } else if (key === 'pollingRate') {
        const map = this.pollKind === 'rate2' ? POLL_RATE2 : POLL_CLASSIC;
        if (this.pollKind === 'rate2') {
          // §3 rate2: sent twice, [0] = 0x00 then [0] = 0x01; on the dongle the second with 0xFF (§2 0xFF row)
          await this.set('poll2', [0x00, map[n]]);
          await this.set('poll2', [0x01, map[n]], this.model.secondPollTid ?? this.tid);
        } else await this.set('poll', [map[n]]);
      } else if (key === 'idle') {
        await this.set('idle', [n >> 8, n & 0xff]);
      } else if (key === 'lowBattery') {
        await this.set('lowBattery', [n]);
      } else if (key === 'dpiStage' || stage) {
        // §3 DPI stages set 0x04/0x06, size 0x26: the table just read, sent back with [0] = VARSTORE and only the one
        // field changed (the active stage byte, or one stage's X and Y). The count and every other byte stay as read.
        const t = await this.stageTable();
        if (t.count !== this.stageCount) throw new Error(`the mouse now has ${t.count} DPI stages, not ${this.stageCount}: look again`);
        const b = t.bytes.slice();
        b[0] = VARSTORE;
        if (key === 'dpiStage') b[1] = n;
        else {
          // the stage's Y follows X only when the two were equal; otherwise it is sent back as read (see keepY above)
          const o = 3 + STAGE_BYTES * (Number(stage[1]) - 1), x0 = (b[o + 1] << 8) | b[o + 2], y0 = (b[o + 3] << 8) | b[o + 4];
          const y = y0 === x0 ? n : y0;
          if (y !== n) keepY = y;
          b[o + 1] = n >> 8; b[o + 2] = n & 0xff; b[o + 3] = y >> 8; b[o + 4] = y & 0xff;
        }
        await this.set('dpiStages', b);
      } else if (key === 'scrollAccel' || key === 'smartReel') {
        await this.set(key, [VARSTORE, n ? 1 : 0]);   // §3 [0] = VARSTORE, [1] = 0/1
      } else if (key === 'dongleLed') {
        await this.set('dongleLed', [n]);              // §3 [0] = 1 / 2 / 3
      } else if (led) {
        await this.set('brightness', [VARSTORE, led.id, n]);   // §3 [0] = VARSTORE, [1] = LED id, [2] = 0-255
      }
      const after = await this.read(), back = after[key];
      const yKey = key === 'dpi' ? 'dpiY' : stage ? `${key}Y` : null;
      if (back !== n || (yKey && after[yKey] !== (keepY ?? undefined))) throw new Error(`${key}: wrote ${n}, read back ${back}${yKey && after[yKey] !== (keepY ?? undefined) ? ` (Y ${after[yKey] ?? n}, expected ${keepY ?? n})` : ''}`);
      return back;
    },

    async battery() {
      await this.ready();
      if (!this.model.power) return null;
      const level = (await this.get('battery'))[1];
      const percent = Math.round((level * 100) / 255);  // §3 Battery: percent = round([1] * 100 / 255)
      const charging = this.model.power === 'rechargeable' ? (await this.get('charging'))[1] === 1 : false;
      return { percent, charging };
    },

    async rawBackup() {
      await this.read();
      return { pid: this.pid, model: this.model.model, tid: this.tid, pollKind: this.pollKind, replies: { ...this.raw } };
    },
  };
}

// The real channel (HID LAYER 1-3): DeviceHub's HostDevice for this product id, opened with nothing sent
async function defaultOpen(pid, model) {
  return getDevice([{ vendorId: 0x1532, productId: parseInt(pid, 16), usagePage: 0x0001, usage: 0x0002, iface: model.iface }], { prompt: false });
}

export default createRazerMouse();
