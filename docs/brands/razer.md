# Razer (USB vendor id 0x1532)

A bare mapping for DeviceHub. Every id and byte below comes from an open-source project, cited in the
Sources section. Anything marked **unconfirmed** was not found in a source, or the sources disagree.
Nothing here has been tested on a real device. Researched 2026-10-22.

Main references: the OpenRazer Linux driver (kernel C, sends USB control transfers) and OpenRGB
(hidapi, works on Windows). The OpenRazer `SET_REPORT`/`GET_REPORT` control transfers on wValue 0x0300
are the same thing as a HID **feature report** with report id 0, which is how OpenRGB sends them through
hidapi on Windows. So DeviceHub's C# helper should use `HidD_SetFeature` / `HidD_GetFeature`.

The Bluetooth vendor id 0x068E from the brief was **not found** in any source read. OpenRazer lists the
Orochi V2 over Bluetooth under 0x1532 (PID 0x0095). Treat 0x068E as **unconfirmed**.

## 1. Common current models

### Mice (OpenRazer `razermouse_driver.h`)

| Model | Wired PID | Wireless / dongle PID | Notes |
|---|---|---|---|
| DeathAdder V3 | 0x00B2 | - | wired only |
| DeathAdder V3 Pro | 0x00B6 (alt 0x00C2) | 0x00B7 (alt 0x00C3) | two id pairs, both listed |
| DeathAdder V3 HyperSpeed | 0x00C4 | 0x00C5 | |
| DeathAdder V4 Pro | 0x00BE | 0x00BF | |
| Viper V3 Pro | 0x00C0 | 0x00C1 | SE edition: 0x00DE / 0x00DF |
| Viper V3 HyperSpeed | - | 0x00B8 | AA battery; charge status not read |
| Viper V2 Pro | 0x00A5 | 0x00A6 | |
| Basilisk V3 | 0x0099 | - | control on interface 3 (see section 2) |
| Basilisk V3 Pro | 0x00AA | 0x00AB | |
| Basilisk V3 35K / V3 Pro 35K | 0x00CB / 0x00CC | - / 0x00CD | Phantom Green: 0x00D6 / 0x00D7 |
| Basilisk V3 X HyperSpeed | - | 0x00B9 | AA battery |
| Cobra / Cobra Pro | 0x00A3 / 0x00AF | - / 0x00B0 | Cobra HyperSpeed: 0x00DA / 0x00DB |
| Naga V2 Pro | 0x00A7 | 0x00A8 | |
| HyperPolling Wireless Dongle | - | 0x00B3 | the 4K/8K dongle itself |

The "wireless" PID is what the 2.4 GHz HyperSpeed dongle enumerates as when the mouse is connected through
it. Mouse Dock Pro is 0x00A4 (in `razeraccessory_driver.h`, not the mouse driver).

### Keyboards (OpenRazer `razerkbd_driver.h`)

| Model | Wired PID | Wireless PID |
|---|---|---|
| BlackWidow V4 | 0x0287 | - |
| BlackWidow V4 Pro | 0x028D | - |
| BlackWidow V4 75% | 0x02A5 | - |
| BlackWidow V4 X | 0x0293 | - |
| BlackWidow V4 Mini HyperSpeed | 0x02B9 | 0x02BA |
| BlackWidow V4 TKL HyperSpeed | 0x02D7 | 0x02D5 |
| BlackWidow V3 / V3 Pro | 0x024E / 0x025A | - / 0x025C |
| Huntsman V3 Pro / TKL / Mini | 0x02A6 / 0x02A7 / 0x02B0 | - |
| Huntsman V3 Pro 8KHz | 0x02CF | - |
| Huntsman V2 / V2 TKL | 0x026C / 0x026B | - |
| Huntsman Mini | 0x0257 | - |
| DeathStalker V2 / V2 Pro / V2 Pro TKL | 0x0295 / 0x0292 / 0x0298 | - / 0x0290 / 0x0296 |
| Ornata V3 / V3 X / V3 TKL | 0x02A1 / 0x0294 / 0x02A3 | - |

OpenRGB lists 0x02A7 as "Huntsman V3 Pro TKL White"; OpenRazer calls it "Huntsman V3 Pro TKL".

### Headsets

Coverage is thin. OpenRazer's `razerkraken_driver.h` covers only old Krakens (Kraken Classic 0x0501,
Kraken 7.1 Chroma 0x0504, Kraken V2 0x0510, Kraken Ultimate 0x0527, Kitty V2 0x0560), and only for
lighting. OpenRGB adds newer ones, again lighting only:

| Model | PID | OpenRGB controller | HID interface (OpenRGB detector) |
|---|---|---|---|
| Kraken V4 (wired) | 0x056B | RazerKrakenV4Controller | iface 5, usage page 0xFF14, usage 0x01 |
| Kraken V4 (wireless dongle) | 0x056C | RazerKrakenV4Controller | same |
| Kraken Kitty V3 Pro wired / wireless | 0x0587 / 0x0588 | RazerKrakenV4Controller | same family |
| Kraken V3 | 0x0549 | RazerKrakenV3Controller | iface 3, usage page 0x0C, usage 0x01 |
| Kraken V3 X | 0x0537 | RazerKrakenV3Controller | (same detector) |
| Kraken V3 HyperSense | 0x0533 | RazerKrakenV3Controller | (same detector) |
| Kraken Kitty V2 Pro | 0x0554 | RazerKrakenV3Controller | (same detector) |

**BlackShark V2 Pro, BlackShark V2 X, Barracuda, Nari and Kraken V4 Pro are in none of the sources.**
HeadsetControl (the usual open headset tool) has no Razer device at all. No open source reads a Razer
headset's battery, sidetone, mic or EQ. PIDs for these are **unknown**.

## 2. How they talk (mice and keyboards)

### The 90-byte report (`razercommon.h`)

| Offset | Field | Notes |
|---|---|---|
| 0 | status | 0x00 on a new request; the device fills it in the reply |
| 1 | transaction_id | per device family, see below |
| 2-3 | remaining_packets | big-endian, 0x0000 for normal commands |
| 4 | protocol_type | always 0x00 |
| 5 | data_size | payload length, max 80 |
| 6 | command_class | |
| 7 | command_id | bit 7 = direction: 0 = host to device (set), 1 = device to host (get). Get = set id + 0x80 |
| 8-87 | arguments[80] | |
| 88 | crc | XOR of bytes 2..87 (`razer_calculate_crc`, loop `i = 2; i < 88`) |
| 89 | reserved | 0x00 |

On Windows through hidapi the buffer is 91 bytes: report id 0x00 first, then these 90 bytes. OpenRGB's
CRC loop runs 3..89 for that reason. (OpenRGB uses report id 0x07 for Leviathan V2 soundbars only.)

### Transport

- Write: `SET_REPORT` (bmRequestType 0x21, bRequest 0x09, wValue 0x0300, wIndex = interface).
- Read: `GET_REPORT` (0xA1, 0x01, wValue 0x0300, same wIndex). Always send, wait, then read the reply.
- If the transaction id is 0x00, OpenRazer replaces it with 0xFF and warns.
- Mouse interface (wIndex): 0 by default; **3** for Basilisk V3, Basilisk V3 35K and Naga X
  (`razermouse_driver.c`). OpenRazer only attaches to the interface whose protocol is "mouse".
- Keyboard interface: **3** for BlackWidow V4 / V4 Pro / V4 75%, Huntsman V3 Pro (all), Huntsman V2,
  DeathStalker V2 Pro wired; **2** for BlackWidow V4 X, BlackWidow V3 Pro, DeathStalker V2 Pro wireless.
  The default for other keyboards is **unconfirmed** (not read).
- OpenRGB on Windows opens: DeathAdder V2 Pro on iface 0, usage page 0x01, usage 0x02. BlackWidow V4 on
  iface 3, usage page 0x01 usage 0x00 (firmware < 1.5) or usage page 0x0C usage 0x01 (firmware >= 1.5).
  Huntsman V3 Pro on iface 3, usage page 0x0C, usage 0x01. Pick the HID collection by interface plus
  usage page; it can move with firmware.
- Windows opens mouse and keyboard collections exclusively. hidapi still gets feature reports by opening
  with zero access rights. **Check on the real device** that `HidD_SetFeature` works on the chosen path.

### Transaction ids (by family)

| Value | Who uses it (OpenRazer unless noted) |
|---|---|
| 0x1F | Current mice: DeathAdder V3 / V3 Pro / V3 HyperSpeed, DeathAdder V4 Pro, Viper V3 Pro, Basilisk V3 / V3 Pro / 35K, HyperPolling dongle (first write). Keyboards: BlackWidow V4 family (all commands), Huntsman V3 Pro and V2 extended effects, DeathStalker V2 Pro wired (mode, battery). |
| 0x3F | DeathAdder V2 / V2 Pro / Mini, Basilisk (V1, Essential), Lancehead, Mamba Wireless. BlackWidow V3 Pro wired (battery, effects), DeathStalker V2 Pro wired effects. |
| 0x9F | Wireless keyboards on the dongle: BlackWidow V3 Pro wireless, DeathStalker V2 Pro (and TKL) wireless. |
| 0xFF | Older devices (Naga, Mamba Wired, DeathAdder Chroma, Viper, Viper Ultimate, Cobra, Basilisk X HyperSpeed). Also: game-mode LED on all keyboards listed, Huntsman V3 Pro device mode and macro LED, Basilisk V3 Pro low-battery threshold, HyperPolling dongle second poll write and unpair. |
| 0x60 | OpenRGB only: Kraken V4 / Kitty V3 Pro (different 64-byte protocol, see below). |

Sources disagree on the Huntsman V3 Pro: OpenRGB uses 0x3F for its matrix; OpenRazer uses 0x1F for
effects and 0xFF for mode / macro LED. **Unconfirmed: test both on the device, reads first.**
Rule of thumb: a wrong transaction id gets no reply or a "not supported" status; it does not do harm.

### Status codes (byte 0 of the reply)

| Value | Meaning |
|---|---|
| 0x00 | new command (not yet handled) |
| 0x01 | busy: wait and read again |
| 0x02 | success |
| 0x03 | failure |
| 0x04 | timeout / no response (common when the wireless mouse is asleep or off) |
| 0x05 | not supported (wrong class/id or wrong transaction id for this device) |

OpenRazer accepts a reply only if `remaining_packets`, `command_class` and `command_id` match the request.
It tries 5 times, 10 ms apart. OpenRGB retries 3 sends, each with up to 25 reads 2 ms apart, and also
matches the transaction id.

### Wait between write and read

| Constant | Value | Used for |
|---|---|---|
| RAZER_MOUSE_WAIT_US | 600 us | wired mice (default) |
| RAZER_NEW_MOUSE_RECEIVER_WAIT_US | 31 ms | DeathAdder V3 family, DeathAdder V4 Pro, Basilisk V3 Pro/35K, Cobra Pro, Naga V2 Pro, Viper V3 Pro wired |
| RAZER_VIPER_MOUSE_RECEIVER_WAIT_US | 59.9 ms | Viper V3 Pro wireless, Viper V3 HyperSpeed, HyperPolling dongle, DeathAdder V2 Pro |
| RAZER_ATHERIS_RECEIVER_WAIT_US | 400 ms | Atheris, Orochi V2 |
| RAZER_BLACKWIDOW_CHROMA_WAIT_US | 600 us | most keyboards |
| RAZER_BLACKWIDOW_V3_WIRELESS_WAIT_US / DEATHSTALKER_V2_WIRELESS_WAIT_US | 4.9 ms | wireless keyboards |
| RAZER_ACCESSORY_WAIT_US / NEW_DEVICE_WAIT_US | 600 us / 31 ms | accessories, docks |

DeviceHub plan: wait the family's time, then poll the reply while status is 0x00 or 0x01, up to ~100 ms.

## 3. Settings map (`razerchromacommon.c`)

`[n]` = arguments[n]. "Get" ids are the set id + 0x80. VARSTORE = 0x01 (saved), NOSTORE = 0x00.

### Device info

| Setting | Class / id | R/W | Arguments | Notes |
|---|---|---|---|---|
| Firmware version | 0x00 / 0x81 | R | size 0x02; reply [0].[1] | safe first probe |
| Serial | 0x00 / 0x82 | R | size 0x16; reply 22 ASCII bytes | |
| Device mode | 0x00 / 0x84 (get), 0x04 (set) | R/W | [0] = mode, [1] = 0 | OpenRazer allows only 0x00 or 0x03. 0x03 is the "driver" mode (meaning **unconfirmed** here). Do not set it in v1. |

### Mouse

| Setting | Class / id | R/W | Arguments | Notes |
|---|---|---|---|---|
| Battery level | 0x07 / 0x80 | R | size 0x02; reply [1] = 0-255 | percent = round([1] * 100 / 255) |
| Charging status | 0x07 / 0x84 | R | size 0x02; reply [1] = 0/1 | OpenRazer skips it on AA-battery mice (Viper V3 HyperSpeed, Basilisk V3 X) |
| DPI (X/Y) | 0x04 / 0x85 get, 0x05 set | R/W | size 0x07; [0] = storage, [1-2] X BE, [3-4] Y BE, [5-6] 0 | clamped 100-45000. OpenRazer reads with NOSTORE; set always writes VARSTORE |
| DPI stages | 0x04 / 0x86 get, 0x06 set | R/W | size 0x26; [0] = VARSTORE, [1] = active stage (1-based), [2] = count, then 7 bytes per stage: index, X BE (2), Y BE (2), 0, 0 | max stages = `RAZER_MOUSE_MAX_DPI_STAGES` (value **unconfirmed**; Synapse shows 5) |
| Polling rate (classic) | 0x00 / 0x85 get, 0x05 set | R/W | size 0x01; [0]: 0x01 = 1000, 0x02 = 500, 0x08 = 125 | wired / older mice, Viper V3 Pro wired |
| Polling rate (HyperPolling, "rate2") | 0x00 / 0xC0 get, 0x40 set | R/W | size 0x02; [0] = 0x00, [1]: 0x01 = 8000, 0x02 = 4000, 0x04 = 2000, 0x08 = 1000, 0x10 = 500, 0x20 = 250, 0x40 = 125 | read reply in [1]. OpenRazer sends the set twice: [0] = 0x00, then [0] = 0x01 (mouse and dongle side, inferred). Used by DeathAdder V3, DeathAdder V4 Pro, Viper V3 Pro wireless, HyperPolling dongle, Viper 8KHz, Viper Mini SE |
| Idle / sleep timer | 0x07 / 0x83 get, 0x03 set | R/W | size 0x02; [0-1] = seconds BE | clamped 60-900 s |
| Low-battery threshold | 0x07 / 0x81 get, 0x01 set | R/W | size 0x01; [0] = raw | clamped 0x0C-0x3F. Likely on the 0-255 scale (0x0C ~ 5%, 0x3F ~ 25%): **unconfirmed** |
| Scroll mode (tactile / free spin) | 0x02 / 0x94 get, 0x14 set | R/W | [0] = VARSTORE, [1] = mode | Basilisk-type wheels |
| Scroll acceleration | 0x02 / 0x96, 0x16 | R/W | [0] = VARSTORE, [1] = 0/1 | |
| Smart reel | 0x02 / 0x97, 0x17 | R/W | [0] = VARSTORE, [1] = 0/1 | |
| Dongle indicator LED mode | 0x07 / 0x90, 0x10 | R/W | [0]: 1 = connection, 2 = battery, 3 = battery warning | HyperPolling dongle |
| Dongle pair / unpair | 0x00 / 0x46 + 0x41, 0x42 | W | PID high/low bytes | **risky**: can drop the mouse. Not in v1 |

### Lighting

Two command sets. Which one a device uses comes from OpenRazer's per-device switch or OpenRGB's
`matrix_type`. Current mice and keyboards are "extended" (class 0x0F).

| Setting | Class / id | R/W | Arguments | Notes |
|---|---|---|---|---|
| Brightness (extended) | 0x0F / 0x84 get, 0x04 set | R/W | size 0x03; [0] = VARSTORE, [1] = LED id, [2] = 0-255 | Basilisk V3 Pro, BlackWidow V4, Huntsman V3 Pro |
| Effect (extended) | 0x0F / 0x02 | W | [0] = VARSTORE, [1] = LED id, [2] = effect: 0x00 off, 0x01 static, 0x02 breathing, 0x03 spectrum, 0x04 wave, 0x05 reactive, 0x07 starlight, 0x08 custom frame, 0x0A wheel | static: size 0x09, [5] = 0x01, [6-8] = RGB |
| Custom frame row (extended) | 0x0F / 0x03 | W | [2] = row, [3] = first col, [4] = last col, [5..] = RGB per key | then send effect 0x08 to show it. One report per row |
| Standard LED (older) | 0x03 / 0x00 state, 0x01 RGB, 0x02 effect, 0x03 brightness (+0x80 to read) | R/W | [0] = storage, [1] = LED id, [2..] = value | |
| Standard matrix effect (older keyboards) | 0x03 / 0x0A, frame 0x03 / 0x0B | W | [0] = effect id (0x06 static, 0x05 custom frame ...) | |
| Mouse extended effect (some mice) | 0x03 / 0x0D | W | [0] = storage, [1] = LED id, [2] = effect (0x06 static, 0x04 spectrum ...) | |

LED ids (`razercommon.h`): 0x00 zero (whole device), 0x01 scroll wheel, 0x03 battery, 0x04 logo,
0x05 backlight, 0x07 macro, 0x08 game, 0x10 right side, 0x11 left side, 0x20-0x22 charging LEDs.

Matrix sizes (OpenRGB `RazerDevices.cpp`, rows x columns): BlackWidow V4 / V4 Pro 8 x 23 (keyboard zone
6 x 23), BlackWidow V4 75% 6 x 18, BlackWidow V4 X 6 x 22, Huntsman V3 Pro 6 x 22, Huntsman V3 Pro TKL
6 x 19, Huntsman V2 6 x 22, DeathStalker V2 Pro 6 x 22. Mouse matrices: read from OpenRGB per model when
needed. DeathAdder V3 Pro and Viper V3 Pro have no lighting (OpenRazer brightness returns EINVAL for them).

### Keyboard extras

| Setting | Class / id | R/W | Notes |
|---|---|---|---|
| Game mode LED | 0x03 / 0x00 with LED 0x08 | R/W | transaction 0xFF on the listed keyboards |
| Macro LED | 0x03 / 0x00 with LED 0x07 | R/W | |
| Fn-key toggle | 0x02 / 0x06 | W | [1] = 0/1 |
| Keyswitch optimization | 0x02 / 0x02, 0x15, get 0x82 | R/W | Huntsman V2 / V2 TKL only |
| Keyboard battery | 0x07 / 0x80, 0x84 | R | wireless keyboards; transaction 0x9F on the dongle |
| Keyboard polling rate | **unconfirmed** | | Huntsman V3 Pro 8KHz exists; no keyboard poll handler was found in the part read |

### Macros and key remap

None of the sources write macros or remaps into a Razer device. OpenRazer's daemon is known to do macros
on the host, using device mode 0x03 so macro keys send their own codes (**unconfirmed**: the daemon source
was not read). On-device macro and remap commands are **unknown**. DeviceHub should do remaps on the host, if at all.

### Headsets

| Family | Protocol (OpenRGB / OpenRazer) | What is known |
|---|---|---|
| Kraken V4, Kitty V3 Pro | 64-byte (size **unconfirmed**) output report, report id 0x02, `hid_write`/`hid_read`. Same header shape as the 90-byte report plus a wireless flag (0x80 on the dongle). Transaction 0x60. CRC = XOR of the first 61 bytes | per-LED color: class 0x0F / 0x03, [4] = last LED, [5..] = RGB (9 LEDs). Brightness and wave mode: class 0x00 / 0x00 with sub-commands. Firmware and serial reads |
| Kraken V3 / V3 X / HyperSense, Kitty V2 Pro | 13-byte output report starting 0x40, byte 1 = command | mode, color, brightness. Firmware / serial via the old Kraken memory report |
| Old Krakens (OpenRazer) | 37-byte report id 0x04 out / 0x05 in, "memory access": destination 0x20 read EEPROM, 0x00 read RAM, 0x40 write RAM, 2-byte address | firmware at 0x0030, serial at 0x7F00, LED effect at 0x172D (Kraken V2) / 0x1008 (Kraken 7.1). Wait 15 ms per EEPROM write |
| BlackShark V2 Pro, Barracuda, Nari | **none** | not covered by any open project read |

**Battery, sidetone, mic, EQ: not covered for any Razer headset.** This needs USB capture of Synapse.

## 4. Read-only first, and risky writes

Read-only probes, in this order (all harmless): firmware 0x00/0x81, serial 0x00/0x82, device mode 0x00/0x84,
battery 0x07/0x80, charging 0x07/0x84, DPI 0x04/0x85, DPI stages 0x04/0x86, polling 0x00/0x85 or 0x00/0xC0,
idle 0x07/0x83, low-battery 0x07/0x81, brightness 0x0F/0x84. Use them to learn the transaction id: try
0x1F, then 0x3F, then 0xFF, and keep the one that answers 0x02.

Writes, by risk:

| Risk | Writes |
|---|---|
| Low | brightness, static color, DPI, active DPI stage, idle timer (all can be read back and undone) |
| Medium | polling rate (wrong code may drop the wireless link until replug), DPI stage table (wrong size can confuse the device), low-battery threshold |
| High, not in v1 | device mode 0x03 (keys change behavior), dongle pair / unpair, keyswitch optimization |
| Never | any class or id not in this sheet. No source documents Razer firmware update or flash commands; Razer updates go through separate updater tools. Do not scan or guess command ids |

Every write should use VARSTORE only when the user saves; preview with NOSTORE where the command allows it.

## 5. What DeviceHub would build

Adapter outline (Node side builds reports; the C# helper sends 91-byte feature reports):

1. `razer/report.js`: build and parse the 90-byte report, CRC, status names. Unit-test against byte dumps
   from OpenRazer issues.
2. `razer/devices.js`: table of PID -> kind, interface/usage page, transaction id, wait time, polling
   variant (classic vs rate2), lighting type (none / standard / extended), matrix size.
3. Transport: open the collection by interface + usage page, send, wait, poll the reply until status is not
   0x00/0x01, match class/id/transaction. Serialize all calls per device (OpenRazer holds a lock).
4. Read-only panel for mice: battery, charging, DPI, stages, polling, idle. Shows "asleep" on status 0x04.
5. Mouse writes: DPI and stages, polling rate (classic and HyperPolling), idle timer, low-battery threshold.
6. Lighting: brightness and static color (extended 0x0F first), then per-key frames for keyboards.
7. Headsets: Kraken V4 lighting only, from OpenRGB. Battery needs capture work first.

| Part | Effort | Risk |
|---|---|---|
| Report, CRC, transport | 1-2 days | low (well documented) |
| Mouse reads and writes | 2-3 days | low-medium (transaction id per model, wireless wait times) |
| Keyboard lighting incl. per-key | 2-3 days | medium (interface moves with firmware; key layout tables) |
| Headset battery | unknown | high (no open source) |
| Macros / remap on device | unknown | high (no open source; host-side only) |

### Covered in device-library/razer-mouse (22 Oct 2026)

Every §3 mouse row with both a set and a get: DPI, the DPI stage table (active stage and each stage's DPI, written
back whole with only that field changed; the count is never changed and a table over the 0x26 size is not written),
polling rate (classic and HyperPolling), idle timer, low-battery threshold, scroll acceleration and smart reel
(Basilisk family, found by reads), the HyperPolling dongle indicator light, and extended brightness (0x0F/0x84,
0x0F/0x04) for the mouse LED ids 0x01, 0x04, 0x10, 0x11 (or 0x00 when none answers), each only when its read answers.
Scroll mode is read and shown raw (no mode values in this sheet). Not covered: effect / static colour (0x0F/0x02 has no
get), standard (class 0x03) lighting, device mode, dongle pair / unpair, macros and remaps. Writes are refused while
Razer Synapse runs. Simulated only (tests/sim-razer.mjs); see docs/handoff/driver-coverage.md.

### Covered in device-library/razer-keyboard (22 Oct 2026)

"Untested" (simulated only: tests/sim-razer-keyboard.mjs), written from OpenRazer @ 477f4d6d (razerkbd_driver.c,
razerchromacommon.c, razercommon.h, razerkbd_driver.h). 30 product ids: BlackWidow V4 / V4 Pro / V4 75% / V4 X / V4 Mini
HyperSpeed / V4 TKL HyperSpeed, BlackWidow V3 / V3 Pro / V3 Mini HyperSpeed, Huntsman V3 Pro / TKL / Mini / 8KHz, Huntsman
V2 / V2 TKL / Mini, DeathStalker V2 / V2 Pro / V2 Pro TKL, Ornata V3 / V3 TKL / V3 X. This settles two gaps above: the
keyboard interface is OpenRazer's `razer_get_report_params` report_index (3, 2, or the default **1**), and keyboard
polling is polling_rate2 (00/C0 get size 1, 00/40 set [00, code], once) on the BlackWidow V4 / V4 Pro / V4 75% / V4 TKL
HyperSpeed and Huntsman V2 / V2 TKL. Each setting uses the transaction id OpenRazer uses for that keyboard and command:
backlight brightness (extended 0F/84 + 0F/04 on LED 0x05; the Huntsman V3 Pro family writes extended but reads standard
03/83), game mode (03/80 + 03/00 on the game LED 0x08: the firmware's Windows-key lock), the macro light (LED 0x07),
battery and charging on the wireless boards (tid 9F on the dongle), and the BlackWidow V3 Pro's low-battery threshold.
Not covered: static colour and effects (OpenRazer's matrix effect files are write-only), the Fn toggle (write-only),
keyswitch optimization, device mode, the Huntsman V3 Pro TKL's brightness (no read in OpenRazer). Added to
helpers/never-commands.json: dongle pair / unpair 00/46, 00/41, 00/42 and device mode 02 ("factory test mode").

## 6. Gaps and unknowns

- BlackShark V2 Pro / V2 X, Barracuda, Nari, Kraken V4 Pro: no PIDs, no protocol in any source.
- No headset battery, sidetone or mic command anywhere. HeadsetControl has no Razer support.
- Vendor id 0x068E for Bluetooth: not found in any source.
- Keyboard default interface (when not 2 or 3) and keyboard polling-rate commands: not read.
- `RAZER_MOUSE_MAX_DPI_STAGES` value not confirmed.
- Device mode 0x03 meaning, and whether Synapse running at the same time fights DeviceHub (likely: both
  write the same reports). Test with Synapse closed first.
- Huntsman V3 Pro transaction id: OpenRazer and OpenRGB disagree.
- Low-battery threshold scale (raw vs percent).
- Kraken V4 report length (64 assumed from OpenRGB naming).
- Whether Windows lets `HidD_SetFeature` through on the exclusive mouse/keyboard collections for each
  model; OpenRGB suggests yes via hidapi.
- On-device macros and key remaps: no source.
- OpenRazer's master branch moves; PIDs added after 2026-10-22 are not here.

## Sources

- OpenRazer [driver/razercommon.h](https://github.com/openrazer/openrazer/blob/master/driver/razercommon.h): report struct, status codes, LED ids, effect ids, storage flags
- OpenRazer [driver/razercommon.c](https://github.com/openrazer/openrazer/blob/master/driver/razercommon.c): CRC, control transfer values, transaction id 0x00 -> 0xFF
- OpenRazer [driver/razerchromacommon.c](https://github.com/openrazer/openrazer/blob/master/driver/razerchromacommon.c): every command class/id and argument layout in section 3
- OpenRazer [driver/razermouse_driver.h](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.h): mouse PIDs, mouse wait times
- OpenRazer [driver/razermouse_driver.c](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.c): transaction ids per mouse, report index, retries, battery/charge bytes, polling_rate2 users, idle and threshold handlers
- OpenRazer [driver/razerkbd_driver.h](https://github.com/openrazer/openrazer/blob/master/driver/razerkbd_driver.h): keyboard PIDs, keyboard wait times
- OpenRazer [driver/razerkbd_driver.c](https://github.com/openrazer/openrazer/blob/master/driver/razerkbd_driver.c): keyboard transaction ids, report index groups, game/macro LED
- OpenRazer [driver/razerkraken_driver.h](https://github.com/openrazer/openrazer/blob/master/driver/razerkraken_driver.h): old Kraken PIDs and memory-access report
- OpenRazer [driver/razeraccessory_driver.h](https://github.com/openrazer/openrazer/blob/master/driver/razeraccessory_driver.h): Mouse Dock Pro and accessory PIDs
- OpenRGB [RazerDevices.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerDevices.h): headset PIDs (Kraken V3 / V4 / Kitty)
- OpenRGB [RazerDevices.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerDevices.cpp): matrix type, transaction id, rows x cols per device
- OpenRGB [RazerControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerControllerDetect.cpp): interface and usage page per device on Windows
- OpenRGB [RazerController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerController/RazerController.cpp): hidapi feature reports, retries, firmware/serial parsing
- OpenRGB [RazerKrakenV4Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerKrakenV4Controller/RazerKrakenV4Controller.cpp): Kraken V4 protocol
- OpenRGB [RazerKrakenV3Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RazerController/RazerKrakenV3Controller/RazerKrakenV3Controller.cpp): Kraken V3 13-byte protocol
- HeadsetControl [lib/devices](https://github.com/Sapd/HeadsetControl/tree/master/lib/devices): checked, no Razer headset
