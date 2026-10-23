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
// wheels), the HyperPolling dongle's indicator light, and extended lighting brightness per documented LED id. Left out,
// with why: lighting effect / static colour (0x0F/0x02 has no get, so nothing could be read back), scroll mode (the
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
//   the two reads answers (reads only; rate2 first, since only its users have 0xC0).
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
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
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
    unsupported: ['firmware updates (Razer\'s own updater only)', 'lighting colour and effects (no read-back exists)', 'scroll mode (read only: no documented values)',
      'the number of DPI stages', 'buttons, macros and remaps', 'onboard profiles', 'lift-off distance, angle snapping, debounce', 'dongle pairing', 'device mode'],
    dev: null, pid: null, model: null, tid: null, tidHow: null, pollKind: null, has: null, raw: {}, q: Promise.resolve(),
    stageCount: 0, leds: [], scrollModeShown: false, app: null, appAt: 0,

    // the page's list: before the first read every setting; then only those this mouse answered
    get settings() {
      if (!this.has) return allSettings();
      return allSettings(Math.min(this.model.dpiMax, DPI_MAX), this.stageCount, this.pollKind, this.leds).filter((s) => this.has.has(s.key));
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
      this.tid = null; this.tidHow = null; this.pollKind = null; this.has = null; this.raw = {}; this.stageCount = 0; this.leds = []; this.scrollModeShown = false; this.appAt = 0; this.app = null;
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
      const kinds = this.model.poll ? [this.model.poll] : ['rate2', 'classic'];
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

    // one setting, checked, written, read back; a read-back that differs is a failed write
    async write(key, value) {
      await this.ready();
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
