# Logitech over Bluetooth, 22 Oct 2026

Logitech mice and keyboards on Bluetooth (not on a receiver) now go through the same library drivers. Nothing was sent
to a device, DeviceHub was not restarted, nothing was committed. `npm run test:offline` passes.

## What the sources say

| Fact | Source |
|---|---|
| Bluetooth HID++ devices are direct devices; a reply's device index may be `request ^ 0xFF` ("BT device returning 0x00") | Solaar `lib/logitech_receiver/base.py` `request()` and `ping()` @ e7304c4c451cc9bb4f206a914844525e67856a28 |
| Solaar's Bluetooth ranges: mice 0xB012-0xB0FF, keyboards 0xB317-0xB3FF | same file, `get_unknown_logitech_device_info()`; `base_usb.py` docstring |
| HID++ is found by its reports, not a usage page: input report 0x11 of 1 + 19 bytes | Solaar `lib/hidapi/hidapi_impl.py` `check_hidpp_long`, `udev_impl.py` (19 * 8 bits) |
| Bluetooth HID++ 2.0 sits on usage page 0xFF43 (any usage) on some models and 0xFF00 usage 2 on others ("mice, the collection Solaar drives them on") | OpenRGB `Controllers/LogitechController/LogitechControllerDetect.cpp` @ a44f52507873f9810601a9ea2640cbe13a868c15 |
| G915 TKL over Bluetooth = 0xB35F | Linux `drivers/hid/hid-logitech-hidpp.c` `hidpp_devices` @ 3fabd8ec206bd48a45ef77aed170d25b322ad9a2 |

Solaar's `descriptors.py` (the same commit, which is also its master today) gives `btid` only for MX / M-series
devices (MX Master 0xB012, 2S 0xB019, MX Vertical 0xB020, MX Master 3 0xB023, M-RCL 124 0xB007, Craft 0xB350, MX Keys
0xB35B, K380 0xB342). **None is a model these drivers cover.** The task's premise that Solaar names usage page 0xFF43
for BLE is not borne out: Solaar never checks a page. OpenRGB names 0xFF43 and 0xFF00 usage 2.

## What changed

**Keyboard** (`device-library/logitech-hidpp-keyboard`): `BLE = { 0xB35F: 'G915 TKL' }`, added to `PIDS` and `device.json`.
- Channel: `byPid.B35F = BLE_HID = { page: '*', usage: '*', inputLen: 19, outputLen: 19 }`, so the helper opens
  whichever collection has 20-byte input and output reports (Solaar's own test, either page OpenRGB names). Name:
  `hid:046D:B35F:*:*:19:17:il=19:ol=19:rw=1`. Every USB id keeps `hid:046D:<pid>:FF00:0002:19:17:rw=1`.
- Open: the B35F filter has no usage page (hid-host's provider would otherwise compare it with the `*` spec's null).
- Device index 0xFF, no receiver slots pinged. Replies matched with `isReplyToBle` (0x00 or 0xFF); the USB / receiver
  matcher `isReplyTo` is unchanged.
- **Left out on Bluetooth: report rate.** 0x8060 / 0x8061 are not even looked up. It is the USB / Lightspeed polling
  rate, and no source documents it over Bluetooth. Every other setting (settings source, profile shown only, key
  locks, F-key swap, backlight, battery) is the cable's, through the same feature lookup and the same bytes.
- No other covered keyboard (G915, G515 TKL, ...) has a Bluetooth id in any source read, so none was guessed.

**Mouse** (`device-library/logitech-hidpp-mouse`): no covered mouse has a documented Bluetooth id, so `BLE = {}` ships
empty and every channel is exactly as before. The same transport is in place (`BLE_HID`, `isReplyToBle`, no report
rate, `Connection: Bluetooth`), so a documented id is one line. `NEVER` gained 0x1816 (BLE pro pre-pairing) and 0x0309
(Lightspeed pairing), as the keyboard and headset already had.

**Headset**: unchanged. No source documents a Bluetooth HID++ headset among the covered models (the PRO X 2's Bluetooth
is audio), so `tests/sim-logitech-headset.mjs` was not extended.

Unchanged machinery: Turn on settings and the self-check (`status` stays read-only / untested, `tested` has no real
record), the never list in the send path (`spec.never` is set on the B35F channel too), the G HUB refusal.

## Safety checks

- Pairing: 0x1500 force pairing, 0x1816 BLE pre-pairing and 0x0309 Lightspeed pairing are in `NEVER` in all three
  drivers; `getFeature` skips them and `call()` refuses them. The tests check both, on Bluetooth too. DFU, reset and
  OOB state are unchanged. No HID++ 1.0 receiver register (pairing) is sent by any of them.
- `helpers/pc-map.js` RUNS: B35F is not in it; both sims check `ownClash` over every id.

## Tests

- `tests/sim-logitech.mjs` section 7: nothing shipped for Bluetooth, channels unchanged, RUNS, pairing ids refused,
  reply matching; then a TEST-ONLY id added to `BLE` and removed: ping at 0xFF, replies at 0x00, no rate lookup, the
  same request bytes and values as a cable mouse, report rate refused unsent.
- `tests/sim-logitech-keyboard.mjs` section 5: the driver's own open filters; the B35F channel name through
  `helpers/hid-host.mjs` with a stand-in helper, and C343's unchanged; a G915 TKL on B35F answering with index 0x00:
  same settings minus report rate, same values, the same frames as its cable for the same reads and writes, error
  reply, G HUB refusal, the library self-check passing with nothing moved.

## Untested on hardware

- Whether Windows exposes a G915 TKL's Bluetooth HID++ collection with 20-byte input and output reports (if not, the
  channel does not open: nothing is sent). `helpers\hid-caps.ps1 -Vid 046D` on the real keyboard settles it.
- Whether it answers with index 0x00 or 0xFF (both are taken), and which features it reports over Bluetooth.

## For other files (not mine to edit)

- `helpers/never-commands.json` line for 0x0309 / 0x1816 says the headset and keyboard drivers never look them up: the
  mouse driver now does the same.
- `docs/brands/logitech.md` section 1 could say: Bluetooth ids for covered models, only G915 TKL B35F (Linux); Solaar
  finds Bluetooth HID++ by the 0x11 report length, not by a page.

## Mouse Bluetooth ids: second search, 22 Oct 2026

Looked again for a Bluetooth product id of any mouse this driver covers (PRO X SUPERLIGHT 2, PRO X SUPERLIGHT, PRO 2
LIGHTSPEED, G502 X LIGHTSPEED / PLUS / X, G305, G PRO Wireless, G703 HERO, G903 HERO, G502 LIGHTSPEED). **None found,
so nothing was changed**: `BLE = {}` stays empty, `device.json` and the tests are as before.

| Source | What it has |
|---|---|
| Linux `drivers/hid/hid-logitech-hidpp.c` @ 7be4bc52fd9e0e55dc9a2e0232b89427d2c4b614 | Bluetooth mice: MX / M-series only (b008, b012, b015, b019, b01d, b01e, b020, b023, b025, b034, b037, b038, b042, M650). The only G device is the G915 TKL keyboard b35f |
| Linux `drivers/hid/hid-ids.h` @ same commit | no Logitech Bluetooth G mouse define (only T651 b00c, diNovo Edge b309) |
| libratbag `data/devices/*.device` @ 8235b5bb6032dea15901ab58a8218956f4494d08 (126 files) | `bluetooth:046d:` matches for G mice: **G603 b01c, G604 b024, G705 b02e**, none of them a model this driver lists; the rest are MX / M-series and the G915 TKL b35f. No covered model's file has a Bluetooth match |
| OpenRGB `Controllers/LogitechController/*` @ bbc77470a7cba56af60989e54ba910d5ac66a3ac (53 .h/.cpp) | no 0xBxxx id at all; Bluetooth HID++ 2.0 is detected with `HID_PID_ANY` on page 0xFF43 or 0xFF00 usage 2 |

G309 is in no source as a Bluetooth id. If G603 / G604 / G705 support is ever added to this driver, libratbag's ids
above are the documented ones (check them against `helpers/pc-map.js` RUNS first).

## More G mice by id, 22 Oct 2026

The mouse driver finds every feature at connect, so these models were added by their documented ids only, from
libratbag `data/devices/*.device` @ 8235b5bb6032dea15901ab58a8218956f4494d08 (each file cited next to its line in
`device.mjs`). No new command, no new function, every channel as before. Nothing sent to a device, nothing committed.

- **USB (`WIRED`)**: G Pro c085 / c08c (`logitech-g-pro`), G102 / G103 / G203 c084 / c092 / c09d (`logitech-g102-g203`),
  G302 c07f, G303 c080, G303 Shroud c097, G402 c07e, G403 c083, G403 HERO c08f, G403 Wireless c082, G502 HERO c08b,
  G502 Proteus Core c07d, G502 Proteus Spectrum c332, G703 c087, G705 c096, G900 c081, G903 c086, MX518 c08e.
- **Bluetooth (`BLE`)**: G603 b01c, G604 b024, G705 b02e. They use the existing Bluetooth handling (any page, 19-byte
  reports, index 0xFF, replies 0x00 or 0xFF, no report rate).
- **Receiver wpids (`WPIDS`, new data-only export)**: 4079, 4093, 4074, 405d, 407f, 4099, 409f, 406c, 4085, 4070, 4086,
  409d, 4053, 4067, 4087. These are libratbag's `usb:046d:40xx` ids, which are Linux's child devices. Windows has no
  such device, so they are never opened. The mouse is reached through `RECEIVERS` as before.
- **1-based profile read** (`PROFILE_READ_1BASED`): added c08b, c332 and b024 (libratbag `Quirk=INDEX_OFFSET`).
- `device.json`: 39 pids (was 16), models, works / doesNotWork updated.

Skipped: G602 402c (its receiver C537 is not opened; `HIDPP20_QUIRK_G602` changes the DPI list layout); G635 / G733 /
G935 0a89 / 0ab5 / 0afe / 0a87 (headsets, claimed by `logitech-hidpp-headset`); G PRO Keyboard c339, G513 c33c, G815
c33f, G915 c33e, G915 TKL c343 / b35f (claimed by `logitech-hidpp-keyboard`); G413 c33a, G910 c335 (keyboards);
G Powerplay 405f (a mat); MX / M-series (not G mice); hidpp10 mice. There was no overlap with `helpers/pc-map.js` RUNS,
because it holds no 046d id.

Tests: `tests/sim-logitech.mjs` section 7 now expects the three Bluetooth ids. The new section 8 checks the ids
against device.json, RUNS and the other library entries, and runs a G203 on its cable, a G603 behind a C539 receiver,
and a G604 on Bluetooth (index 0x00 replies, 1-based profile read, report rate refused unsent). sim-logitech,
device-library and library-guard pass.

For other files (not mine to edit):
- `tests/hid-core.mjs` line 205 expects `specs.length === 16`. It needs 39, and with that change it passes.
- `tests/diagnose.mjs` "crashes and helper restarts listed after the main cause" fails with or without this change.
  Its log lines carry fixed 22 Oct times, and it reads the real clock.
- libratbag also marks the G502 LIGHTSPEED (c08d, already covered) `INDEX_OFFSET`. It is not in `PROFILE_READ_1BASED`,
  so the driver works out the numbering from what the mouse reports. Adding c08d would follow libratbag.
