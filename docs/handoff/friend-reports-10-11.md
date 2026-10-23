# A friend's PC: ghost Logitech keyboard, 25A7:FA70 and Learn a device (support #10, #11), 23 Oct 2026

Reports read: Dsmjr2/DeviceHub-support #8, #9, #10, #11 (install 642d31cde9d3 / 74d87d6d9d8d) and the earlier #3, #4,
#5, #7 (install dc833c73b551, the same Windows 11 25H2 build 26200, with an Epomaker P75 connected, a Logitech mouse
and the SUPERSTRIKE's cable C0A8). Nothing was sent to any device, DeviceHub was not restarted, nothing was committed.

## What his PC has (from the reports)

| USB id | Windows name | What answered | Shown as |
|---|---|---|---|
| 046D:C54D | LIGHTSPEED Receiver | logitech-hidpp-mouse: PRO X2 SUPERSTRIKE by its HITS feature 0x1B0C, slot 1 (#8) | Logitech mouse |
| 046D:C0A8 | (cable) | the SUPERSTRIKE's cable (#7) | Logitech mouse |
| 03F0:0696 | HyperX Cloud II Wireless | hyperx-cloud: model, battery 3701 mV, boom mic attached (#4) | HyperX Cloud headset |
| 342D:E479 | (none) | DeviceHub's own VIA keyboard: "Epomaker P75 (keyboard): connected" (#3, #5) | Epomaker P75 |
| 25A7:FA70 | 2.4G Wireless Receiver | nothing; maker's app "not known" (#10, #11) | Unknown 2.4G receiver (25A7:FA70) |
| (board) | Gigabyte B450 AORUS PRO WIFI-CF | SMBus lights (#9) | Fans page |

## What 25A7:FA70 is, as far as the evidence goes

- USB vendor 25A7 = **Areson Technology Corp** (linux usb.ids, version 2026.06.26: `25a7  Areson Technology Corp`,
  products 2410 Laser mouse, fa23 2.4G Receiver, fa61 Elecom card reader; **FA70 is not listed**).
- OpenRGB `Controllers/AresonController/AresonControllerDetect.cpp` @ bbc77470a7cba56af60989e54ba910d5ac66a3ac:
  `ARESON_VID 0x25A7`, ZET GAMING Edge Air and Redragon M914 mice (FA3F, FA40, FA48, FA49, FA7B, FA7C). No FA70.
- Linux `drivers/hid/hid-ids.h` (master, 23 Oct 2026): no 25A7 at all.
- One open project, cauanboss/redragon-k629-controller README.md @ 384aed647e6e553d92b8a16464c2e706fad756f3, lists
  `25a7:fa70` as the **wireless dongle of a Redragon K629 keyboard** (wired 258a:0049). headless-start/keylume
  docs/FIRMWARE.md @ 0242d5b289972c4d8c104bd39e95594e6d1390de lists 25A7:2420 for some Epomaker and RS6 keyboards.
  So Areson's ids are reused by several brands, and FA70 is a keyboard dongle in the one public source.
- **Not the HyperX headset's dongle.** HeadsetControl @ 8a859eed2862a92cf89612befd481bfb8ae62eaa and HyperHeadset @
  71c30677fa928c9bcb1a01711fd14f152258f3da know HyperX wireless headsets only on 03F0 (HP) and 0951 (Kingston); no
  25A7. On his PC the HyperX already answered on 03F0:0696 as a Cloud II Wireless (#4, if install dc833c73b551 is his PC,
  which the P75, the Logitech mouse and the C0A8 request suggest but do not prove).
- **Not confirmed as the P75's dongle either**: the P75 is tri-mode with a dongle stored in the keyboard, but no source
  read gives that dongle's ids. Epomaker's EK68 VIA manual even gives a separate "2.4G" VIA file, so "no VIA over the
  dongle" is not claimed anywhere.
- Which device it serves is therefore **not known**. DeviceHub names it "Unknown 2.4G receiver (25A7:FA70)" and adds
  what its own HID usages say (keyboard, mouse or both). 25A7 is **not** added to the generic-dongle list: no source
  calls it a shared generic chip id, and OpenRGB drives lights on 25A7 mice, so "no settings" would be wrong.
- To settle it on his PC (read-only): `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\hid-caps.ps1 -Vid 25A7`
  lists its collections (a 000B telephony collection = a headset, 0001/0006 keyboard, 0001/0002 mouse), and Get help on
  Learn a device now sends its usages ("Its USB interfaces say: ...").

## What changed

1. **Ghost "Logitech keyboard"** (commit 974098e made the keyboard driver look at C539 / C53F / C54D).
   - `device-library/logitech-hidpp-keyboard/device.mjs`: `onlyIfFound` (before its first look, and on a shared
     LIGHTSPEED receiver); `device.json` `onlyIfFound: [c539, c53f, c54d]`. The driver's own kind read (DEVICE_NAME
     0x0005 fn 0x20, Solaar) and DPI features already left the mouse alone.
   - `helpers/my-devices.mjs` `isAbsent(adapter, status, seen)`: an added driver that stepped aside (notMine), or an
     onlyIfFound one never found, while not connected or asleep. `helpers/agent.mjs` snapshot carries `absent`.
   - Absent devices are left out of: `shownDevices` (tiles, sidebar, Lighting, Settings), the Setup page rows and its
     "needs you" count (`public/core/setup-list.js`, `public/pages/setup.js`), the setup summary and its "installed" note
     (`helpers/auto-setup.mjs`), Get help reports (`shownInReport`), Turn on settings for all, Search and Self-test, and
     the plug-in note (`helpers/plug-watch.mjs`: a driver whose device.json lists the id as onlyIfFound is never
     announced for it). The mouse driver on the same handle is unchanged.
2. **Names from the device's own ids** (`public/core/device-name.js`): a vendor id no brand in docs/brands.json owns,
   and not a generic chip, is "Unknown 2.4G receiver (VID:PID)", "Unknown USB device (VID:PID)" or its own product
   string with "(VID:PID, maker not known)", plus what its HID usages say. `helpers/pc-map.js` now reads those usages
   from Windows' hardware ids (HID_DEVICE_UP:0001_U:0006 / _U:0002; nothing opened). Used by Setup (summary), Learn
   (device rows, headers, Learn it for me) and Get help.
3. **Learn a device by HID usages** (`helpers/learn-apps.mjs` `usageKinds`, `deviceKind`, `KIND_QUESTION`): keyboard
   usage only = keyboard settings (never DPI); telephony (000B) = headset settings; both mouse and keyboard = one
   question "Is this a mouse or a keyboard?" on the device row (or the plan step), passed to begin / Learn it for me.
4. **Nothing to record into**: no app DeviceHub knows = said up front, Learn these and Other setting stay off until "I
   have its app open"; Learn it for me stops with the same words. A known app that is not installed is named with its
   maker's own link (learn-apps MAKERS) and recording stays off until it is. A recording that still hears nothing adds:
   the device may have no settings software, or its app talks to it another way (for a keyboard: try its USB cable).
5. **The HyperX without NGENUITY**: the library driver `hyperx-cloud` already reads battery, voltage, charging, mic
   mute, sidetone on/off and auto-off on the Cloud II Wireless (03F0:0696) from HeadsetControl and HyperHeadset, and
   writes mic mute, sidetone and auto-off after Turn on settings, each read back. No NGENUITY needed, nothing guessed.

## Tests

- `tests/friend-devices.mjs` (new, in npm test and test:offline): his exact device set; every name, no Logitech
  keyboard anywhere, the unknown receiver named plainly in both usage shapes, Learn's lists by usage, the hint.
- `tests/sim-logitech-keyboard.mjs` section 9 and `tests/sim-logitech.mjs` section 11: a C54D holding only the
  SUPERSTRIKE, with both drivers on one handle, in either order; `tests/auto-setup.mjs`: an absent driver gets no line.
