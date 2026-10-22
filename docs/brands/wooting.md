# Wooting: bare mapping

Researched 2026-10-22 from public source code only. Vendor id `31e3` for current boards, `03eb` for the original
Wooting One and Two. This is a map for a later developer with the real keyboard in hand, not a tested spec. Every id
has a source in the last section; anything marked **unconfirmed** was not found in a source and must be measured
read-only first.

Short names used below:
- **RGB** = Wooting's own `wooting-rgb-sdk` (C, `src/wooting-usb.c`, `wooting-usb.h`, `wooting-rgb-sdk.c`).
- **ASDK** = Wooting's own `wooting-analog-sdk` (Rust, `wooting-analog-sdk/src/device.rs`, `plugin/wooting.rs`).
  The separate `wooting-analog-plugin` repo is archived (Aug 2021); its code now lives inside ASDK.
- **ORGB** = OpenRGB (`Controllers/WootingKeyboardController/`).
- **WPS** = ShayBox's WootingProfileSwitcher (Rust, `src/lib.rs`), which talks to the board through RGB's USB layer.
- **Gist** = BigBrainAFK's "Wooting USB Feature Codes" gist, a list reverse engineered from Wootility (names and numbers
  only, no payload layouts).

## 1. Models with ids

| Model | Vendor | Product id | RGB protocol | Small packets | Source |
|---|---|---|---|---|---|
| Wooting One (original) | `03eb` | `FF01` | v1 | no | RGB, ORGB, ASDK |
| Wooting Two (original) | `03eb` | `FF02` | v1 | no | RGB, ORGB, ASDK |
| Wooting One (new firmware) | `31e3` | `1100` | v2 | no | RGB, ORGB |
| Wooting Two (new firmware) | `31e3` | `1200` | v2 | no | RGB, ORGB |
| Wooting Two Lekker Edition | `31e3` | `1210` | v2 | no | RGB, ORGB |
| Wooting Two HE | `31e3` | `1220` | v2 | no | RGB, ORGB |
| Wooting Two HE (ARM) | `31e3` | `1230` | v2 | yes | RGB, ORGB |
| Wooting 60HE | `31e3` | `1300` | v2 | no | RGB, ORGB |
| Wooting 60HE (ARM) | `31e3` | `1310` | v2 | yes | RGB, ORGB |
| Wooting 60HE+ | `31e3` | `1320` | v2 | yes | RGB, ORGB |
| Wooting 60HE v2 | `31e3` | `1340` | v2 | no | RGB, ORGB |
| Wooting 80HE | `31e3` | `1400` | v2 | no | RGB, ORGB |
| Wooting UwU / UwU RGB | `31e3` | `1500` / `1510` | v2 | yes | RGB (both), ORGB (`1510` only) |

Notes:
- RGB also accepts `base | 0x1` and `base | 0x2` for every `31e3` id. ASDK masks the product id with
  `WOOTING_PID_MODE_MASK` (`0xFFF0`, name "has_modes"). So the low nibble is a mode. Which mode each value means
  (keyboard, Xbox gamepad, other) is **unconfirmed**.
- "Two HE (ARM)" and "60HE (ARM)" are later hardware revisions with the same name; the product id is the only way to
  tell them apart.
- Device type per RGB: `1` TKL, `2` full size, `3` 60%, `4` 3-key pad, `5` 80%. Matrix sizes: 60HE family 14 columns,
  80HE 17, full size up to 6 rows x 21 columns, UwU 5 x 7.
- Layout per RGB: `0` ANSI, `1` ISO, `2` JIS, `3` ANSI split, `4` ISO split, `-1` unknown.
- The product string from Windows gives the model name; ASDK uses it, plus the serial number, to build its device id.

## 2. How they talk

A Wooting board shows several HID collections. Three matter:

| Usage page | What it is | Who uses it | Source |
|---|---|---|---|
| `1337` | config / RGB channel ("v2" page), 8-byte feature commands | RGB, ORGB, WPS | RGB `CFG_USAGE_PAGE`, ORGB |
| `FF55` | config / RGB channel ("v3" page), multi-report, larger buffers | RGB, ORGB | RGB `CFG_V3_USAGE_PAGE`, ORGB |
| `FF54` | analog key depth, protocol 1 | ASDK | ASDK `ANALOG_INTERFACE_V1` |
| `FF53` | analog key depth, protocol 2 | ASDK | ASDK `ANALOG_INTERFACE_V2` |

Which current model exposes `1337` and which `FF55` is **unconfirmed**. ORGB decides at run time by the usage page it
finds, and so should DeviceHub.

### The command frame (feature report, 8 bytes)

Sent with `hid_send_feature_report` (on Windows: `HidD_SetFeature`). Layout from RGB `wooting_usb_send_feature_buff`:

| Byte | Meaning |
|---|---|
| 0 | report id: `00` on `1337`, `01` on `FF55` (multi-report) |
| 1 | magic `D0` (`D1` on multi-report) |
| 2 | magic `DA` |
| 3 | command id |
| 4 | parameter 3 |
| 5 | parameter 2 |
| 6 | parameter 1 |
| 7 | parameter 0 |

Parameters go in reverse order: a call `send(cmd, p0, p1, p2, p3)` puts `p0` in byte 7.

Replies come back as an input report, read with a 1000 ms timeout (`WOOTING_READ_RESPONSE_TIMEOUT`). Sizes: 128 bytes
(v1), 256 (v2), 2046 (v3). WPS reads them like this:
- bytes 0-1: magic, little-endian `DAD0` (or `DAD1` on multi-report)
- byte 2: the command echoed
- byte 3: unknown
- byte 4: length
- byte 5 on: data
- On multi-report every field moves up one byte (report id first), and data starts one byte later still.

### Command ids

From RGB (defines) and the Gist (names). The Gist and RGB agree on every id both list.

| Id | Gist name | Used by |
|---|---|---|
| 0 | Ping | Gist only |
| 1 | GetVersion | Gist only |
| 2 | ResetToBootloader | Gist only. **Never send.** |
| 3 | GetSerial | WPS (param 0 = `2`) |
| 7 | ReloadProfile0 | WPS (after ActivateProfile) |
| 11 | GetCurrentKeyboardProfileIndex | WPS: index at data byte 5 (v2) or 4 (v1), plus multi-report offsets |
| 19 | GetDeviceConfig | RGB: layout at reply byte 10 (v2) or 9 (v1) |
| 20 | GetAnalogValues | Gist only |
| 21 / 22 | KeysOff / KeysOn | Gist only |
| 23 | ActivateProfile | WPS: profile index in parameter 0 (byte 7) |
| 25 | doSoftReset | Gist only |
| 29 | RefreshRgbColors | WPS (profile index in parameter 0) |
| 30 | WootDevSingleColor | RGB: one key, direct |
| 31 | WootDevResetColor | RGB: one key back to profile color |
| 32 | WootDevResetAll | RGB: all keys back to profile colors |
| 33 | WootDevInit | RGB: sent once on connect, before lights |
| 38 | ReloadProfile | Gist only |
| 42 | SaveKeyboardProfile | Gist only. Writes flash. |
| 43 | ResetSettings | Gist only. **Never send.** |
| 49 | GetActuationProfile | Gist only (reply report 21 "ActuationProfile") |
| 51 | GetGlobalSettings | Gist only (reply report 23) |
| 54 | GetRapidTriggerProfile | Gist only (reply report 25 "RapidTriggerProfile") |
| 55 | GetProfileMetadata | Gist only (reply report 26) |

The Gist lists 60 commands (0-59) and 29 reply report types; the rest are getters for mappings, DKS, gamepad, RGB
profiles and flash stats. It holds no "set actuation", "set rapid trigger" or tachyon command, and no payload layouts.

### Lights (RGB SDK)

- On connect, RGB sends `WootDevInit` (33, all parameters 0), then `GetDeviceConfig` (19) for the layout.
- One key, v2 boards: `30` with parameters = packed row/column id, red, green, blue. Reset one key: `31` with the id
  in parameter 0. The bit packing of the row/column id struct is **unconfirmed** (the header was not found; ASDK's
  analog protocol 2 packs position as row = bits 5-7, column = bits 0-4, which is likely the same).
- One key, v1 boards: `30` with an LED index from a 6 x 21 lookup table. Left Shift and Enter are sent twice (ANSI and
  ISO index).
- Whole board, v2: output report of 257 bytes: `00 D0 DA 0B` then a 6 x 21 matrix of 16-bit colors (`0B` = 11 =
  `WOOTING_RAW_COLORS_REPORT`, Gist "WootDevRawReport"). Colors are 5-6-5 bits: `(r & F8) << 8 | (g & FC) << 3 |
  (b & F8) >> 3`. Byte order of each 16-bit value: **unconfirmed** (little-endian by the C struct on x86).
- Small-packet boards (ARM revisions, 60HE+, UwU): the same 256 bytes go out as 4 writes of 65 bytes (`00` + 64).
- Whole board, v3 (`FF55`): 2047 bytes, `05 D1 DA 0B` then the same matrix (report id 5).
- Whole board, v1: 129-byte reports `00 D0 DA 0B <slave> <start>` + 96 color bytes + CRC-16/CCITT (poly `1021`, init 0)
  in the last two bytes, sent in 4 or 5 parts.
- `wooting_rgb_close()` sends `32` to every board, which puts the profile colors back. Always do this on exit.
- RGB has no timing or rate limit in code.

### Key depth (Analog SDK)

Read as input reports on the analog collection. ASDK polls every 10 ms and rescans devices about every 500 ms.
- **Protocol 1** (`FF54`; original One/Two at `03eb`, and new firmware at `31e3`): 3-byte entries `[code hi] [code lo]
  [value]`. Value 0-255, scaled `/255` (original boards `*1.2/255`, capped at 1.0). Entries with value 0 are dropped.
  Buffer size constant 48.
- **Protocol 2** (`FF53`, `31e3`): 4-byte entries `[matrix pos] [key] [packed] [value]`. Row = `(pos >> 5) & 7`,
  column = `pos & 1F`. Actuated = `packed & 1`. Key namespace = `(packed >> 2) & F`. Value is 10-bit:
  `(value << 2) | ((packed >> 6) & 3)`, scaled `/1023`. Keycode = `namespace << 8 | key`. Buffer size constant 64.
- These reports are depth only. They do not read or change the actuation point or rapid trigger setting.
- ASDK on Windows is installed by Wootility. DeviceHub can read the same reports itself and skip the SDK.

## 3. Settings map

| Setting | How | Documented? | Source |
|---|---|---|---|
| Per-key lights (live, not saved) | `30` / `31` / `32`, raw report `0B` | **Yes**, Wooting's own SDK | RGB, ORGB |
| Lights back to profile | `32` | **Yes** | RGB |
| Keyboard layout | `19`, reply byte 9 / 10 | **Yes** | RGB |
| Key depth per key | analog input report | **Yes**, Wooting's own SDK | ASDK |
| Serial number | `3` | community only | WPS, Gist |
| Current profile index | `11` | community only | WPS, Gist |
| Switch profile | `23` then `7` (then `32`, `29` for lights) | community only | WPS, Gist |
| Firmware version | `1` | name only; reply layout **unconfirmed** | Gist |
| Actuation point | read: `49` "GetActuationProfile"; write: **not found** | **only in Wootility** | Gist |
| Rapid trigger | read: `54` "GetRapidTriggerProfile"; write: **not found** | **only in Wootility** | Gist |
| Tachyon mode | **not found in any open source** | **only in Wootility** | none |
| Brightness, effects, saved RGB profiles | getters `35`, `36`, `50`, `57`; no setter layout | **only in Wootility** | Gist |
| Polling rate, global options | `51` "GetGlobalSettings"; no layout | **only in Wootility** | Gist |
| Key remap, DKS, Mod Tap, gamepad | getters/savers named only | **only in Wootility** | Gist |

Wootility 5.4 adds "App Linking" (profile follows the focused app) through the Wooting Background Service. That is
the same job as WPS, done by Wooting.

## 4. Read-only first, then writes

Safe to read first (no state change claimed by any source):
- The analog input reports on `FF54` / `FF53`. Pure input, nothing is sent.
- `19` GetDeviceConfig, `3` GetSerial, `11` GetCurrentKeyboardProfileIndex (each used by RGB or WPS).
- Windows product string and serial.

Probe with care (getter by name, reply layout unknown):
- `1`, `49`, `51`, `54`, `55`. Send once, log the raw reply, compare against Wootility's display. Do not parse into
  settings until two boards agree.

Low-risk writes (do not touch flash, by the SDK's own design):
- `33`, `30`, `31`, `32`, raw report `0B`. Always send `32` on exit, and when Wootility starts.

Writes that change the board's state:
- `23` ActivateProfile + `7` reload, as WPS does. Read `11` back after.

Never:
- `2` ResetToBootloader, any firmware update, `43` ResetSettings, `25` doSoftReset.
- Any "Save..." command (`8`, `42`, `47`, `53`): writes flash, no backup path known.
- `44` SetRawScanning, `21` KeysOff: could leave the board without typing.
- Any command id not in this table. Running beside Wootility (it holds the same channel; step back like the iCUE rule).

## 5. What DeviceHub would build

### What the official SDKs make easy

- **Lights:** RGB is small open C and fully describes the frame. DeviceHub can either load
  `wooting-rgb-sdk.dll` or, simpler for our C# helper, send the same 8-byte feature reports and output reports itself.
  OpenRGB, which DeviceHub already talks to, also drives these boards (v1, v2, v3 controllers), so lights may need
  no new code at all.
- **Key depth:** ASDK's two report formats are fully described above. A live "key depth" view is input-only and
  safe.

### Does it need HID feature reports?

Yes. Every command (init, single key, reset, profile, layout) is a feature report. DeviceHub's native helper has no
`HidD_SetFeature` / `HidD_GetFeature` today (searched `helpers/native`, 2026-10-22), so that is step 1. The replies
come back as input reports, which the helper already reads.

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Add feature-report send/get to the C# helper | 0.5 day | low |
| 2 | Find the board by `31e3`/`03eb`, list its collections, pick `1337` or `FF55`; read `19` (layout) and the product string | 0.5 day | low (read only) |
| 3 | Live key-depth view from `FF53`/`FF54` | 1 day | low (input only) |
| 4 | Lights: first through OpenRGB; then direct `33` + raw `0B` with `32` on exit, if OpenRGB is too slow | 0-2 days | low |
| 5 | Profile read `11` and switch `23`+`7`, then per-app switching | 1 day | low-medium (community protocol) |
| 6 | Raw dumps of `49` / `54` / `51` next to Wootility, to learn actuation and rapid-trigger layouts | 2+ days | medium (unknown layouts); read only |
| 7 | Writing actuation point, rapid trigger, tachyon | not planned | high: no setter is documented anywhere; leave to Wootility |

## 6. Gaps

- **Actuation point, rapid trigger, tachyon mode:** no write command and no payload layout in any public source. Only
  getter names (`49`, `54`) are known. Treat as Wootility-only.
- **Row/column id packing** for single-key commands: header not found. Measure, or copy from ASDK's position packing.
- **Byte order of 16-bit colors** in the raw report: inferred, not stated.
- **Low-nibble product id modes** (`|1`, `|2`): which mode is which is not stated.
- **Which models use `1337` vs `FF55`:** decided at run time in every source; no per-model table.
- **60HE v2 (`1340`) and 80HE (`1400`) analog protocol** (`FF54` or `FF53`): not stated per model.
- **Firmware version (`1`) reply layout:** not found.
- **Wootility conflict:** whether Wootility or its Background Service holds the config channel open on Windows is
  **unconfirmed**. Assume yes and step back while it runs.
- **Two Lekker vs Two HE:** both listed; the original Two at `03eb` `FF02` is the only one with protocol v1.

## Sources

- [wooting-rgb-sdk wooting-usb.c (ids, usage pages, frame, report sizes, layout read)](https://github.com/WootingKb/wooting-rgb-sdk/blob/master/src/wooting-usb.c)
- [wooting-rgb-sdk wooting-usb.h (command ids, matrix size, device type and layout enums)](https://github.com/WootingKb/wooting-rgb-sdk/blob/master/src/wooting-usb.h)
- [wooting-rgb-sdk wooting-rgb-sdk.c (single key, reset, 565 color encoding)](https://github.com/WootingKb/wooting-rgb-sdk/blob/master/src/wooting-rgb-sdk.c)
- [wooting-rgb-sdk wooting-rgb-sdk.h (public functions, reset restores original colors)](https://github.com/WootingKb/wooting-rgb-sdk/blob/master/src/wooting-rgb-sdk.h)
- [wooting-analog-sdk repository](https://github.com/WootingKb/wooting-analog-sdk)
- [wooting-analog-sdk device.rs (analog report parsing, both protocols)](https://github.com/WootingKb/wooting-analog-sdk/blob/develop/wooting-analog-sdk/src/device.rs)
- [wooting-analog-sdk plugin/wooting.rs (vendor ids, analog usage pages, buffer sizes, polling)](https://github.com/WootingKb/wooting-analog-sdk/blob/develop/wooting-analog-sdk/src/plugin/wooting.rs)
- [wooting-analog-plugin (archived, merged into the SDK)](https://github.com/WootingKb/wooting-analog-plugin)
- [OpenRGB WootingKeyboardControllerDetect.cpp (ids, usage pages, v1/v2/v3 controllers)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/WootingKeyboardController/WootingKeyboardControllerDetect.cpp)
- [WootingProfileSwitcher src/lib.rs (serial, profile index, activate profile, reply layout)](https://github.com/ShayBox/WootingProfileSwitcher/blob/master/src/lib.rs)
- [BigBrainAFK gist: Wooting USB Feature Codes (command and report names, from Wootility)](https://gist.github.com/BigBrainAFK/0ba454a1efb43f7cb6301cda8838f432)
- [Wootility 5.4: App Linking](https://wooting.io/post/wootility-5-4-app-linking-and-advanced-keys-presets)
- [Wooting: what is Rapid Trigger](https://wooting.io/post/what-is-wootings-rapid-trigger-for-analog-keyboards)
