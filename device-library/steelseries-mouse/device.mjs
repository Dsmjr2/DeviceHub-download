// SteelSeries mice (USB vendor 0x1038), written 22 Oct 2026 from docs/brands/steelseries.md (the "sheet": rivalcfg's
// device files and mouse.py, cross-checked with OpenRGB's SteelSeriesDevices.h, all cited there). Status: untested.
// Nothing here has run on a real mouse; every byte below is a row of the sheet, cited as "sheet s<section> <row>".
// No code was copied from rivalcfg or OpenRGB.
//
// What it does: names the mouse from its product id, reads the battery and charging state of the wireless mice the
// sheet's battery row lists (`92`, wireless `D2`), and the firmware version of the Rival 3 (`10 00`). That is every
// mouse READ in the sheet (s2 "Mice: rivalcfg layout": "rivalcfg never reads settings back from the mouse ... Only
// battery, firmware and the wireless readback are reads"). DeviceHub writes a setting only when it can read the same
// value back (CLAUDE.md "Write one setting at a time, then read it back"), so until 2 Nov 2026 DPI, polling rate, sleep and dim
// timers and lights were never sent. Since then (Shawn's rule for write-only settings, helpers/my-devices.mjs) the live
// ones are offered on the Aerox Wireless, Prime (Mini) Wireless and Rival 3 as write-only settings: see "Write-only
// settings" below. Buttons and the rest stay documentation only (WRITE_ONLY).
//
// HID LAYER (docs/handoff/hid-core.md):
//  1. One channel per product id (`hid.pids` + `hid.byPid`, helpers/my-devices.mjs hidSpecs), each opened by USB
//     interface (sheet s1 "Interface" column: 3 for every model here); the Aerox rows on usage page FFC0, usage 01 (sheet
//     s1 note: "OpenRGB opens Aerox 3/5/9 on interface 3, usage page 0xFFC0, usage 1"); the Prime Wireless and Rival 3
//     have no page in the sheet, so their channels use page / usage '*' (any) on interface 3.
//  2. Report id 0 (sheet top: "for SteelSeries it is almost always 0x00 (no numbered reports)"; s2 "Every command is
//     sent as 00 <command bytes>"), output reports (s2 "Output report (hid_write) for all current models").
//
// UNCONFIRMED (check with helpers/hid-caps.ps1 and one read before trusting a value):
//  - The output report length. len 64 = data bytes after the report id, from the sheet's s5 helper note ("64-byte
//    output writes with report id 0"); it must equal hid-caps' OutputReportByteLength - 1.
//  - Whether the battery reply echoes the command in its byte 0. The sheet gives only "read 2 (64 on dongle)" and the
//    value in byte 1, so the first input report after the request is taken as the reply.
//  - The Prime Wireless and Rival 3 usage pages (see HID LAYER 1).
//
// What it does NOT do, on purpose (sheet s4 "Read-only first, then writes"):
//  - No save (`11 00`, dongle `51 00`; `09 00`, `59`): writes the mouse's flash. On helpers/never-commands.json.
//  - No firmware update, no command id the sheet does not list ("Unknown command ids on the mouse (0x2D-0x92 range) ...
//    could reach bootloader or calibration functions. Send only the ids listed here"). SENDABLE is every read; WRITE_CMDS every write (rivalcfg's).
//  - No write but the write-only settings below (settingsFor / encode), each only after Turn on settings and a check by
//    eye on that model; write() refuses every other key.
//
// Added 23 Oct 2026 straight from rivalcfg's device files (github.com/flozz/rivalcfg @ 779ea52, rivalcfg/devices/*.py,
// cited "rivalcfg <file>"), cross-checked with OpenRGB (@ 817834c, SteelSeriesDevices.h and SteelSeriesControllerDetect.cpp):
//  - Prime Mini Wireless 184A (cable) / 1848 (receiver): the Prime Wireless profile (rivalcfg prime_wireless_wired.py
//    and prime_wireless_wireless.py list both mice, endpoint 3), so the same battery read 92 / D2.
//  - Rival 3 Wireless 1830 and Rival 3 Wireless Gen 2 1872 (both "2.4 GHz mode", endpoint 3): their own battery read,
//    AA 01, sent as it is (the profile gives AA itself, no 0x40 patch), read 3: byte 0 = percent (rivalcfg keeps 0-100
//    only), byte 2 non-zero = charging (rivalcfg rival3_wireless.py / rival3_wireless_gen2.py "battery_level"). OpenRGB
//    opens 1830 on interface 3, usage page FFC0, usage 1. Not sent: the Rival 3 Wireless firmware read 90 00 (0x90 is in
//    the 0x2D-0x92 range the sheet's section 4 says to send only when the sheet lists it, and the sheet does not).
//  - Wired-only mice with no read in any source, named from their product id and nothing sent at all (`named`):
//    Aerox 3 1836 and Aerox 5 1850 (endpoint 3; OpenRGB interface 3, FFC0 / 1), Rival 3 Gen 2 1870 (endpoint 3),
//    Prime 182E (endpoint 0), Prime Mini 184D (endpoint 3), Rival 5 183C (endpoint 0; OpenRGB interface 0, FFC0 / 1).
//
// Added 1 Nov 2026, the rest of rivalcfg's mice (same commit 779ea52, rivalcfg/devices/<file>.py, every one "endpoint": 0,
// no usage page in rivalcfg, so any page on interface 0; cited per row below):
//  - firmware 10 00, output report, response_length 2, byte for byte the Rival 3's read (`firmware`): Rival 100 / 105
//    (rival100.py), Rival / Rival 300 and editions (rival300.py), Rival 500 (rival500.py), Rival 700 / 710 (rival700.py).
//  - battery AA 01, output report, response_length 3, level = data[0], is_charging = bool(data[2]), the same profile for
//    the cable and the receiver (no 0x40 patch): the Rival 650 Wireless (rival650.py), so battery 'aa' on both ids.
//  - named only, nothing sent: profiles with no read (prime.py editions, prime_plus.py, rival5.py Destiny, rival600.py,
//    rival110.py, rival300s.py, rival95.py, sensei_raw.py, kanav2.py, kinzuv2.py) and profiles whose only read is the
//    firmware 90 00 (rival310.py, sensei310.py, sensei_ten.py): 0x90 is in the range the sheet's section 4 says to send
//    only when the sheet lists it, so it is not sent (as for the Rival 3 Wireless).
//  UNCONFIRMED for these older mice as for the rest: the 64-byte output length and which collection interface 0 opens.
import { getDevice } from '../../public/devices/hid.js';

const VID = 0x1038;

// sheet s2 "Wireless (2.4 GHz): ... the first command byte is OR'd with 0x40 ... battery 0x92 becomes 0xD2"
export const WIRELESS_FLAG = 0x40;
// the documented reads (sheet s3 "Mice")
export const CMD = {
  battery: 0x92,     // "Battery + charging | 92 (wireless D2), read 2 (64 on dongle) | byte 1: bit 7 = charging; level = ((b1 & 0x7F) - 1) x 5 %"
  firmware: 0x10,    // "Firmware version | 10 00, read 2 | 2 raw bytes | Rival 3"
};
// the Rival 3 Wireless / Wireless Gen 2 battery read (rivalcfg rival3_wireless.py, rival3_wireless_gen2.py "battery_level":
// command AA 01, response_length 3, level = data[0], is_charging = bool(data[2])); sent as it is, never | 0x40
export const CMD_AA = [0xaa, 0x01];
// the only READ command bytes that leave this file (writes: WRITE_CMDS below), by what the model has (wired byte; a dongle sends it | 0x40,
// except the AA read, which rivalcfg sends unchanged on the receiver)
const SENDABLE = { battery: [CMD.battery], firmware: [CMD.firmware], batteryAA: CMD_AA };

// The models (sheet s1 "Mice"). link: 'cable' (the mouse on its USB cable) or 'dongle' (its 2.4 GHz receiver).
//  battery: the battery row lists the model (s3: "Aerox 3/5/9 Wireless, Prime Wireless"); firmware: the Rival 3 row.
//  page: the usage page where the sheet gives one (HID LAYER 1). iface: the USB interface when it is not 3.
//  battery: 'aa' = the Rival 3 Wireless AA 01 read. named: no read this driver may send (none in the profile, or only 90 00); the mouse is only named, nothing is sent.
export const MODELS = [
  { pid: 0x183a, name: 'Aerox 3 Wireless', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1838, name: 'Aerox 3 Wireless', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x187a, name: 'Aerox 3 Wireless CS2 Dragon Lore', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1878, name: 'Aerox 3 Wireless CS2 Dragon Lore', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1854, name: 'Aerox 5 Wireless', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1852, name: 'Aerox 5 Wireless', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x185e, name: 'Aerox 5 Wireless Destiny 2', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x185c, name: 'Aerox 5 Wireless Destiny 2', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1862, name: 'Aerox 5 Wireless Diablo IV', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1860, name: 'Aerox 5 Wireless Diablo IV', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x185a, name: 'Aerox 9 Wireless', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1858, name: 'Aerox 9 Wireless', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1876, name: 'Aerox 9 Wireless WoW Edition', link: 'cable', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1874, name: 'Aerox 9 Wireless WoW Edition', link: 'dongle', battery: true, page: 0xffc0, wo: 'aerox' },
  { pid: 0x1842, name: 'Prime Wireless', link: 'cable', battery: true, page: null, wo: 'prime' },
  { pid: 0x1840, name: 'Prime Wireless', link: 'dongle', battery: true, page: null, wo: 'prime' },
  // s1 "Rival 3 | 0x1824, 0x184C (firmware v0.37.0.0) | 3"; s3 "Firmware version | 10 00, read 2 | Rival 3"
  { pid: 0x1824, name: 'Rival 3', link: 'cable', firmware: true, page: null, wo: 'rival3' },
  { pid: 0x184c, name: 'Rival 3', link: 'cable', firmware: true, page: null, wo: 'rival3' },
  // added 23 Oct 2026 (see the top): rivalcfg prime_wireless_wired.py / prime_wireless_wireless.py, endpoint 3
  { pid: 0x184a, name: 'Prime Mini Wireless', link: 'cable', battery: true, page: null, wo: 'prime' },
  { pid: 0x1848, name: 'Prime Mini Wireless', link: 'dongle', battery: true, page: null, wo: 'prime' },
  // rivalcfg rival3_wireless.py (0x1830, endpoint 3; OpenRGB 3, 0xFFC0, 1) and rival3_wireless_gen2.py (0x1872, endpoint 3)
  { pid: 0x1830, name: 'Rival 3 Wireless', link: 'dongle', battery: 'aa', page: 0xffc0 },
  { pid: 0x1872, name: 'Rival 3 Wireless Gen 2', link: 'dongle', battery: 'aa', page: null },
  // wired, no read anywhere: named only. rivalcfg aerox3.py 0x1836, aerox5.py 0x1850 (endpoint 3; OpenRGB 3, 0xFFC0, 1),
  // rival3_gen2.py 0x1870 (3), prime.py 0x182E (0), prime_mini.py 0x184D (3), rival5.py 0x183C (0; OpenRGB 0, 0xFFC0, 1)
  { pid: 0x1836, name: 'Aerox 3', link: 'cable', named: true, page: 0xffc0 },
  { pid: 0x1850, name: 'Aerox 5', link: 'cable', named: true, page: 0xffc0 },
  { pid: 0x1870, name: 'Rival 3 Gen 2', link: 'cable', named: true, page: null },
  { pid: 0x182e, name: 'Prime', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x184d, name: 'Prime Mini', link: 'cable', named: true, page: null },
  { pid: 0x183c, name: 'Rival 5', link: 'cable', named: true, page: 0xffc0, iface: 0 },
  // added 1 Nov 2026 (see the top), all rivalcfg "endpoint": 0. Firmware 10 00: rivalcfg rival100.py
  { pid: 0x1702, name: 'Rival 100', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x170a, name: 'Rival 100 (Dell China)', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x170b, name: 'Rival 100 Dota 2 Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x170c, name: 'Rival 100 Dota 2 Edition (Lenovo)', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1814, name: 'Rival 105', link: 'cable', firmware: true, page: null, iface: 0 },
  // rivalcfg rival300.py
  { pid: 0x1384, name: 'Rival', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1392, name: 'Rival Dota 2 Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1710, name: 'Rival 300', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1712, name: 'Rival 300 Fallout 4 Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x171c, name: 'Rival 300 Evil Geniuses Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1394, name: 'Rival 300 CS:GO Fade Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x171a, name: 'Rival 300 CS:GO Hyper Beast Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1716, name: 'Rival 300 CS:GO Fade Edition (stm32)', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1714, name: 'Rival 300 Acer Predator Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1718, name: 'Rival 300 HP OMEN Edition', link: 'cable', firmware: true, page: null, iface: 0 },
  // rivalcfg rival500.py, rival700.py
  { pid: 0x170e, name: 'Rival 500', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1700, name: 'Rival 700', link: 'cable', firmware: true, page: null, iface: 0 },
  { pid: 0x1730, name: 'Rival 710', link: 'cable', firmware: true, page: null, iface: 0 },
  // battery AA 01 on the cable and the receiver: rivalcfg rival650.py (one profile, both ids)
  { pid: 0x172b, name: 'Rival 650 Wireless', link: 'cable', battery: 'aa', page: null, iface: 0 },
  { pid: 0x1726, name: 'Rival 650 Wireless', link: 'dongle', battery: 'aa', page: null, iface: 0 },
  // named only, no read in the profile: rivalcfg prime.py, prime_plus.py, rival5.py, rival600.py, rival110.py,
  // rival300s.py, rival95.py, sensei_raw.py, kanav2.py, kinzuv2.py
  { pid: 0x182a, name: 'Prime Rainbow 6 Siege Black Ice Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1856, name: 'Prime CS:GO Neo Noir Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x182c, name: 'Prime+', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x183e, name: 'Rival 5 Destiny Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1724, name: 'Rival 600', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x172e, name: 'Rival 600 Dota 2 Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1729, name: 'Rival 110', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1816, name: 'Rival 106', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1810, name: 'Rival 300S', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1706, name: 'Rival 95', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1707, name: 'Rival 95 MSI Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1704, name: 'Rival 95 PC Bang', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1708, name: 'Rival 100 PC Bang', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1369, name: 'Sensei [RAW]', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1362, name: 'Sensei [RAW] Diablo III Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x136d, name: 'Sensei [RAW] Guild Wars 2 Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x136f, name: 'Sensei [RAW] CoD Black Ops II Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1380, name: 'Sensei [RAW] World of Tanks Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1390, name: 'Sensei [RAW] Heroes of the Storm Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x137a, name: 'Kana v2', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1366, name: 'Kinzu v2', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1378, name: 'Kinzu v2', link: 'cable', named: true, page: null, iface: 0 },
  // named only, their one read (firmware 90 00) not sent (see the top): rivalcfg rival310.py, sensei310.py, sensei_ten.py
  { pid: 0x1720, name: 'Rival 310', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x171e, name: 'Rival 310 CS:GO Howl Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1736, name: 'Rival 310 PUBG Edition', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1722, name: 'Sensei 310', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1832, name: 'Sensei TEN', link: 'cable', named: true, page: null, iface: 0 },
  { pid: 0x1834, name: 'Sensei TEN CS:GO Neon Rider Edition', link: 'cable', named: true, page: null, iface: 0 },
];
const IFACE = 3;  // sheet s1 "Interface" column (rivalcfg "endpoint") for every row above without its own iface
const LEN = 64;   // UNCONFIRMED (see the top)

// ---- Write-only settings (2 Nov 2026, Shawn's rule; helpers/my-devices.mjs "Write-only settings") ----
// rivalcfg never reads a setting back, so each one below is `writeOnly`: sent without read-back, never self-checked, and
// locked until Turn on settings AND the person confirmed it by eye once on that model (Try it). Only LIVE commands: each
// takes effect at once and is forgotten on unplug until a save, and this file never sends a save (11 00 / 51 00 / 09 00:
// SAVES below, refused in send()). From rivalcfg @ 779ea52 (github.com/flozz/rivalcfg, rivalcfg/<file>, line):
//  - framing: mouse.py 351-360 (command bytes, then the value, then command_suffix), 365-368 (readback_length: read
//    the reply, 200 ms), 85 and 312-314 (0.05 s between commands); the 2.4 GHz receiver: devices/aerox3_wireless_wireless.py
//    3-16 (first byte | 0x40, read 64 bytes back), the same in aerox5_ / aerox9_ / prime_wireless_wireless.py.
//  - 'aerox' (Aerox 3 / 5 / 9 Wireless and editions; devices/aerox3_wireless_wired.py, aerox5_wireless_wired.py,
//    aerox9_wireless_wired.py): sensitivity 24-37 (aerox5 30) 2D, multidpi_range_choice (handlers/multidpi_range_choice.py
//    161: count, selected, codes), first_preset 0, codes devices/dpi/truemove_air.py 7-35; polling_rate 38-52 (aerox5 44)
//    2B 125=03 250=02 500=01 1000=00; z1-z3_color 53-79 (aerox5 59-85) 21 01 <00/01/02> R G B; sleep_timer 89-100
//    (aerox5 95) 29 + 3 bytes little-endian, minutes x 60000 (handlers/range.py 158-163, helpers.py 109); dim_timer
//    101-112 (aerox5 107) 23 0F 01 00 00 + 3 bytes, seconds x 1000.
//  - 'prime' (Prime Wireless 1842 / 1840, Prime Mini Wireless 184A / 1848; devices/prime_wireless_wired.py): sensitivity 24,
//    polling_rate 38, color 53-61 (21 01 00 R G B, one zone), sleep_timer 90-101, dim_timer 102-113; the same bytes.
//  - 'rival3' (Rival 3 1824 / 184C; devices/rival3.py): sensitivity 21-34 0B 00, first_preset 1, codes devices/dpi/
//    truemove_core.py 7-35; polling_rate 35-48 04 00 125=04 250=03 500=02 1000=01; z1-z3 + logo_color 49-95
//    05 00 <01-04> R G B, suffix 64 (brightness 100%); light_effect 97-114 06 00 <00-06>.
// Left out on purpose: default_lighting (27 ..., "at mouse startup": it means something only once saved), reactive
// colour (26), rainbow effect (22 FF), button mapping (2A / 07 00: the mouse's buttons could stop working), every other
// model (their profiles are not mapped here), and DPI presets beyond one: DeviceHub sets ONE DPI (count 1).
const DPI_AIR = { 400: 0x04, 800: 0x09, 1200: 0x0d, 1600: 0x12, 2400: 0x1b, 3200: 0x26 };    // truemove_air.py 7, 11, 15, 19, 27, 35
const DPI_CORE = { 400: 0x08, 800: 0x12, 1200: 0x1b, 1600: 0x24, 2400: 0x37, 3200: 0x49 };   // truemove_core.py 7, 11, 15, 19, 27, 35
const POLL = { aerox: { 125: 0x03, 250: 0x02, 500: 0x01, 1000: 0x00 }, prime: { 125: 0x03, 250: 0x02, 500: 0x01, 1000: 0x00 }, rival3: { 125: 0x04, 250: 0x03, 500: 0x02, 1000: 0x01 } };
const EFFECTS = [['rainbow-shift', 0x00, 'Rainbow shift'], ['breath-fast', 0x01, 'Breathe fast'], ['breath', 0x02, 'Breathe'], ['breath-slow', 0x03, 'Breathe slow'], ['steady', 0x04, 'Steady'], ['rainbow-breath', 0x05, 'Rainbow breathe'], ['disco', 0x06, 'Disco']];   // rival3.py 105-111
const ZONES = {
  aerox: [{ value: 'top', label: 'Top', code: 0x00 }, { value: 'middle', label: 'Middle', code: 0x01 }, { value: 'bottom', label: 'Bottom', code: 0x02 }],
  rival3: [{ value: 'top', label: 'Strip top', code: 0x01 }, { value: 'middle', label: 'Strip middle', code: 0x02 }, { value: 'bottom', label: 'Strip bottom', code: 0x03 }, { value: 'logo', label: 'Logo', code: 0x04 }],
};
// the mouse saves (helpers/never-commands.json): never the first bytes of anything this file sends
export const SAVES = [[0x11, 0x00], [0x51, 0x00], [0x09, 0x00], [0x09], [0x59], [0x59, 0x00]];
// every first command byte a write may start with, by family (cable byte; the receiver sends it | 0x40)
export const WRITE_CMDS = { aerox: [0x2d, 0x2b, 0x29, 0x23, 0x21], prime: [0x2d, 0x2b, 0x29, 0x23, 0x21], rival3: [0x0b, 0x04, 0x05, 0x06] };
const opts = (o, unit) => Object.keys(o).map(Number).map((v) => ({ value: v, label: `${v} ${unit}` }));
const zoneList = (z) => z.map(({ value, label }) => ({ value, label }));

// the settings of one model's family ([] for a model with none, or nothing connected)
export function settingsFor(m) {
  const f = m?.wo;
  if (!f || m.named) return [];
  const out = [
    { key: 'dpi', label: 'DPI', type: 'choice', options: opts(f === 'rival3' ? DPI_CORE : DPI_AIR, 'DPI'), group: 'tracking',
      hint: "One DPI for the mouse (its DPI button then has just this one until it is unplugged).",
      writeOnly: { volatile: true, confirm: 'Does the pointer move at a different speed now?', test: 1600 } },
    { key: 'pollingRate', label: 'Polling rate', type: 'choice', options: opts(POLL[f], 'Hz'), group: 'tracking',
      writeOnly: { volatile: true, confirm: 'Run the polling rate test on this page: does it show about {value}?', test: 500, restore: 1000 } },
  ];
  if (f === 'aerox' || f === 'prime') {
    out.push(
      { key: 'sleepTimer', label: 'Sleep after', type: 'slider', min: 0, max: 20, step: 1, unit: 'min', group: 'power', hint: '0 = never.',
        writeOnly: { volatile: true, confirm: 'Leave the mouse still for {value}: does it go to sleep (lights off)?', test: 1, restore: 5 } },
      { key: 'dimTimer', label: 'Dim lights after', type: 'slider', min: 0, max: 1200, step: 5, unit: 's', group: 'power', hint: '0 = never.',
        writeOnly: { volatile: true, confirm: 'Leave the mouse still for {value}: do its lights dim?', test: 10, restore: 30 } });
  }
  if (f === 'prime') out.push({ key: 'color', label: 'Light colour', type: 'color', group: 'lights', writeOnly: { volatile: true, confirm: "Did the mouse's light turn {value}?", test: '#ff0000' } });
  else {
    const zones = zoneList(ZONES[f]);
    out.push({ key: 'colors', label: 'Light colours', type: 'color', zones, group: 'lights',
      writeOnly: { volatile: true, confirm: "Did all the mouse's lights turn {value}?", test: Object.fromEntries(zones.map((z) => [z.value, '#ff0000'])) } });
  }
  if (f === 'rival3') out.push({ key: 'lightEffect', label: 'Light effect', type: 'choice', options: EFFECTS.map(([value, , label]) => ({ value, label })), group: 'lights',
    writeOnly: { volatile: true, confirm: "Are the mouse's lights slowly pulsing (breathing) now?", test: 'breath', restore: 'steady' } });
  return out;
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const le3 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];   // rivalcfg range_length_byte 3, little-endian
// the packets one write sends (cable bytes; Link.send adds the receiver's flag), or throws for a value not offered
export function encode(m, key, v) {
  const f = m?.wo;
  const s = settingsFor(m).find((x) => x.key === key);
  if (!s) throw new Error(`${key} is not a setting of the ${m?.name || 'mouse'}`);
  const bad = () => { throw new Error(`${s.label}: ${JSON.stringify(v)} is not a value it takes`); };
  const HEX = /^#[0-9a-f]{6}$/;
  if (key === 'dpi') { const c = (f === 'rival3' ? DPI_CORE : DPI_AIR)[v]; if (c === undefined) bad(); return [f === 'rival3' ? [0x0b, 0x00, 0x01, 0x01, c] : [0x2d, 0x01, 0x00, c]]; }
  if (key === 'pollingRate') { const c = POLL[f][v]; if (c === undefined) bad(); return [f === 'rival3' ? [0x04, 0x00, c] : [0x2b, c]]; }
  if (key === 'sleepTimer') { if (!Number.isInteger(v) || v < 0 || v > 20) bad(); return [[0x29, ...le3(v * 60000)]]; }
  if (key === 'dimTimer') { if (!Number.isInteger(v) || v < 0 || v > 1200 || v % 5) bad(); return [[0x23, 0x0f, 0x01, 0x00, 0x00, ...le3(v * 1000)]]; }
  if (key === 'color') { if (typeof v !== 'string' || !HEX.test(v)) bad(); return [[0x21, 0x01, 0x00, ...rgb(v)]]; }
  if (key === 'colors') {
    const z = ZONES[f];
    if (!v || typeof v !== 'object' || Object.keys(v).length !== z.length || !z.every((x) => typeof v[x.value] === 'string' && HEX.test(v[x.value]))) bad();
    return z.map((x) => (f === 'rival3' ? [0x05, 0x00, x.code, ...rgb(v[x.value]), 0x64] : [0x21, 0x01, x.code, ...rgb(v[x.value])]));
  }
  if (key === 'lightEffect') { const e = EFFECTS.find(([n]) => n === v); if (!e) bad(); return [[0x06, 0x00, e[1]]]; }
  return bad();
}

// Documented writes NOT offered (sheet s3 "Mice"; s2 "rivalcfg never reads settings back"): documentation only. The
// ones offered as write-only settings above are marked `offered`.
export const WRITE_ONLY = [
  { what: 'DPI presets', bytes: '2D <count> <selected> <code>...', models: 'Aerox 3W/5/9, Rival 5, Prime Wireless; Aerox 3 wired', cite: 'sheet s3 DPI presets (rivalcfg multidpi_range_choice.py, truemove_air.py)', offered: 'one DPI (count 1) on the Aerox Wireless and Prime (Mini) Wireless' },
  { what: 'DPI presets', bytes: '0B 00 ...', models: 'Rival 3', cite: 'sheet s3 DPI presets', offered: 'one DPI (count 1)' },
  { what: 'DPI presets', bytes: '61 ...', models: 'Prime (wired)', cite: 'sheet s3 DPI presets' },
  { what: 'DPI presets', bytes: '03 00 <slot> <00-77> 00 42', models: 'Rival 600', cite: 'sheet s3 DPI presets' },
  { what: 'polling rate', bytes: '2B <code>', models: 'Aerox, Prime Wireless, Rival 5', cite: 'sheet s3 Polling rate', offered: 'Aerox Wireless, Prime (Mini) Wireless' },
  { what: 'polling rate', bytes: '04 00 <code> / 5D <code>', models: 'Rival 3, Rival 600 / Prime (wired)', cite: 'sheet s3 Polling rate', offered: 'Rival 3' },
  { what: 'sleep timer', bytes: '29 <3 bytes>', models: 'Aerox Wireless, Prime Wireless', cite: 'sheet s3 Sleep timer (byte order: little-endian, rivalcfg handlers/range.py 158-163)', offered: 'Aerox Wireless, Prime (Mini) Wireless' },
  { what: 'dim timer', bytes: '23 0F 01 00 00 <3 bytes>', models: 'Aerox Wireless, Prime Wireless', cite: 'sheet s3 Dim timer', offered: 'Aerox Wireless, Prime (Mini) Wireless' },
  { what: 'zone colours, light effect, brightness, reactive colour, default lighting', bytes: '21 ..., 22 ..., 23 / 5F ..., 26 ..., 27 ..., 05 00 ..., 06 00 ..., 62 ...', models: 'all', cite: 'sheet s3 Zone color, Light effect, Brightness, Reactive color, Default lighting', offered: 'zone colours on the Aerox Wireless, Prime (Mini) Wireless and Rival 3; the Rival 3 light effect' },
  { what: 'button mapping', bytes: '2A + 5-byte fields', models: 'Aerox, Rival 5, Prime Wireless', cite: 'sheet s3 Button mapping' },
];

// SteelSeries' own apps (SteelSeries GG, the older SteelSeries Engine); the same names as
// device-library/steelseries-arctis VENDOR_APPS, copied so this folder stands alone in my-devices
export const VENDOR_APPS = /^SteelSeries(GG|GGClient|Engine|Engine3)?\.exe$/i;

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const h4 = (n) => n.toString(16).padStart(4, '0');

// the sheet's battery byte (s3 Battery + charging): bit 7 = charging, level = ((b & 0x7F) - 1) x 5 %
export function parseBattery(b) {
  const level = ((b & 0x7f) - 1) * 5;
  return { percent: Math.max(0, Math.min(100, level)), charging: (b & 0x80) !== 0 };
}

// a model's HID channel (HID LAYER 1)
function channelOf(m) {
  return { page: m.page == null ? '*' : h4(m.page).toUpperCase(), usage: m.page == null ? '*' : '0001', iface: m.iface ?? IFACE, len: LEN, reportId: 0,
    productName: `SteelSeries ${m.name}` };
}

// one request at a time; the reply is the first input report after the request (UNCONFIRMED: see the top)
class Link {
  constructor(dev, model) { this.dev = dev; this.model = model; this.q = Promise.resolve(); this.last = null; }
  serial(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }
  ask(what, timeoutMs = 1000) {
    const req = SENDABLE[what];
    const has = what === 'batteryAA' ? this.model.battery === 'aa' : what === 'battery' ? this.model.battery === true : !!this.model[what];
    if (req == null || !has || this.model.named) throw new Error(`${what} is not a read the sheet documents for the ${this.model.name}`);
    const out = new Uint8Array(LEN);
    if (what === 'batteryAA') out.set(req);   // AA 01 as rivalcfg sends it, on the receiver too
    else out[0] = this.model.link === 'dongle' ? req[0] | WIRELESS_FLAG : req[0];   // s2 "Wireless (2.4 GHz)"
    // 10 00: the firmware request's second byte is the 00 in the sheet's row; the battery request is the command alone
    return this.serial(() => new Promise((resolve, reject) => {
      const on = (e) => {
        const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        done(); this.last = { out: hex(out.slice(0, 2)), in: hex(r.slice(0, 8)) }; resolve(new Uint8Array(r));
      };
      const timer = setTimeout(() => { done(); reject(new Error(`no reply to ${hex(out.slice(0, 2))}`)); }, timeoutMs);
      const done = () => { clearTimeout(timer); this.dev.removeEventListener('inputreport', on); };
      this.dev.addEventListener('inputreport', on);
      this.dev.sendReport(0, out).catch((err) => { done(); reject(err); });
    }));
  }
  // one write (a write-only setting): never a save, only a first byte this family's settings start with; through the
  // receiver the first byte | 0x40 and its 64-byte reply read and dropped (rivalcfg readback_length, 200 ms); then the
  // 0.05 s rivalcfg leaves between commands
  send(bytes) {
    const fam = this.model.wo;
    if (!fam || this.model.named) throw new Error(`the ${this.model.name} has no write this driver may send`);
    if (!WRITE_CMDS[fam].includes(bytes[0])) throw new Error(`${hex(bytes.slice(0, 2))} is not a write this driver sends to the ${this.model.name}`);
    const out = new Uint8Array(LEN);
    out.set(bytes);
    const dongle = this.model.link === 'dongle';
    if (dongle) out[0] |= WIRELESS_FLAG;
    if (SAVES.some((p) => p.every((b, i) => out[i] === b))) throw new Error(`${hex(out.slice(0, 2))} is a save to the mouse's memory: never sent`);
    return this.serial(() => new Promise((resolve, reject) => {
      let timer = null, on = null;
      const done = () => { clearTimeout(timer); if (on) this.dev.removeEventListener('inputreport', on); };
      const after = () => { done(); this.last = { out: hex(out.slice(0, 8)), in: null }; setTimeout(resolve, 50); };
      if (dongle) { on = () => after(); this.dev.addEventListener('inputreport', on); }
      this.dev.sendReport(0, out).then(() => { if (dongle) timer = setTimeout(after, 200); else after(); }, (err) => { done(); reject(err); });
    }));
  }
}

export default {
  id: 'steelseries-mouse',
  title: 'SteelSeries mouse',
  kind: 'Mouse',
  vendor: 'SteelSeries',
  hid: { vid: '1038', pid: '183A', page: 'FFC0', usage: '0001', iface: IFACE, len: LEN, reportId: 0, replyMs: 800, productName: 'SteelSeries Aerox 3 Wireless',
    pids: MODELS.map((m) => h4(m.pid).toUpperCase()), byPid: Object.fromEntries(MODELS.map((m) => [h4(m.pid).toUpperCase(), channelOf(m)])) },
  // the connected model's write-only settings (settingsFor; none before a mouse connects); the battery shows on the tile
  get settings() { return settingsFor(this.model); },
  unsupported: ['firmware updates', 'saving settings to the mouse (changes made here last until it is unplugged)',
    'button mapping, reactive colour, default lighting and more than one DPI preset (SteelSeries GG does them)',
    'DPI, polling rate, sleep and dim timers and lights on the other models: no profile mapped here',
    'battery on the Aerox 3 Gen 2 (no source has its read)',
    'the wired Aerox 3, Aerox 5, Rival 3 Gen 2, Prime, Prime Mini and Rival 5: no source has a read for them, so DeviceHub only names them',
    'the Prime+, Rival 600, Rival 95 / 106 / 110 / 300S, Sensei [RAW], Kana v2 and Kinzu v2 (no read in rivalcfg), and the Rival 310, Sensei 310 and Sensei TEN (their firmware read 90 00 is not sent): named only'],
  MODELS, WRITE_ONLY, VENDOR_APPS, settingsFor, encode,

  // the vendor-app check (replaceable in tests); resolves with the running app's name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name) && !/service|updater|crash/i.test(name)) return name; }   // a service or updater is not the app (1 Nov 2026: Synapse's service kept the device read-only, nothing to close)
    return null;
  },

  async connect() {
    this.model = null; this.link = null; this.status = null;
    for (const m of MODELS) {
      const filter = { vendorId: VID, productId: m.pid };
      if (m.page != null) filter.usagePage = m.page;
      let dev = null;
      try { dev = await getDevice([filter], { prompt: false }); } catch { dev = null; }
      if (!dev) continue;
      if (!dev.opened) await dev.open();
      this.model = m; this.link = new Link(dev, m);
      return true;
    }
    return false;
  },

  need() { if (!this.link) throw Object.assign(new Error('no SteelSeries mouse is connected'), { gone: true }); },

  async readBattery() {
    this.need();
    if (!this.model.battery) return null;
    if (this.model.battery === 'aa') {
      // rivalcfg rival3_wireless.py: read 3, byte 0 = percent (0-100, anything else = no reading), byte 2 = charging
      const r = await this.link.ask('batteryAA');
      if (r[0] > 100) throw new Error(`battery reply ${hex(r.slice(0, 3))} is outside 0-100 (mouse off?)`);
      this.status = { percent: r[0], charging: r[2] !== 0, raw: hex(r.slice(0, 4)) };
      return this.status;
    }
    const r = await this.link.ask('battery');
    this.status = { ...parseBattery(r[1]), raw: hex(r.slice(0, 4)) };   // s3: the value is in byte 1
    return this.status;
  },

  async info() {
    this.need();
    const m = this.model;
    const out = { Model: `SteelSeries ${m.name}`, 'USB id': `1038:${h4(m.pid)}`, Connection: m.link === 'dongle' ? 'wireless (2.4 GHz receiver)' : 'USB cable',
      Driver: m.named ? 'untested library driver: names this mouse only (no read it may send for it); nothing is sent' : m.wo ? 'untested library driver: reads the battery / firmware; its settings are write-only (checked by eye once, never saved to the mouse)' : 'untested library driver: reads only (battery, firmware); nothing is ever written' };
    if (m.firmware) {
      const r = await this.link.ask('firmware').catch(() => null);
      out.Firmware = r ? `${r[0]}.${r[1]} (raw bytes)` : 'no reply';   // s3 "2 raw bytes"; their meaning is not documented
    }
    if (m.battery) {
      const st = await this.readBattery().catch(() => null);
      out.Battery = st ? `${st.percent}%${st.charging ? ', charging' : ''}` : 'no reply (asleep?)';
    }
    out['Other settings'] = m.wo ? 'SteelSeries GG only (buttons, saving to the mouse)' : 'SteelSeries GG only: no source reads them back';
    return out;
  },

  // nothing can be read back (the battery goes through battery()); DeviceHub's guard gives a write-only setting the
  // last value it wrote (helpers/my-devices.mjs)
  async read() { this.need(); return {}; },

  // a write-only setting: its packets (encode), sent one by one, never read back, never saved. Refused while
  // SteelSeries GG runs (the guard asks too) and for anything the connected model does not have.
  async write(key, value) {
    this.need();
    const m = this.model;
    if (!settingsFor(m).some((s) => s.key === key)) {
      const w = WRITE_ONLY.find((x) => x.what.toLowerCase().includes(String(key).toLowerCase()));
      throw new Error(w
        ? `${w.what} is write-only on SteelSeries mice (${w.cite}) and not offered for the ${m.name}, so DeviceHub does not change it`
        : `${key} is not a setting of the ${m.name} in this driver`);
    }
    const packets = encode(m, key, value);
    const app = await this.vendorApp();
    if (app) throw Object.assign(new Error(`${app} (the maker's app) is running: close it first`), { waiting: true });
    for (const p of packets) await this.link.send(p);
    return value;
  },

  async battery() {
    if (!this.link || !this.model.battery) return null;
    const st = await this.readBattery();
    return { percent: st.percent, charging: st.charging };
  },

  async rawBackup() {
    this.need();
    const st = this.model.battery ? await this.readBattery().catch(() => null) : null;
    return { model: this.model.name, pid: h4(this.model.pid), link: this.model.link, battery: st?.raw ?? null };
  },
};
