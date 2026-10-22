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
