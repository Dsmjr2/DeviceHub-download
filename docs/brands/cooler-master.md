# Cooler Master: bare mapping

Researched 2026-10-22 from public source code only. Vendor id `2516` for everything below.
This is a map for a later developer with the real device in hand, not a tested spec. Every id has a source in the
last section; anything marked **unconfirmed** was not found in a source and must be measured read-only first.

The short version: OpenRGB covers **lighting** on most wired Cooler Master mice, keyboards, mousepads and ARGB
controllers. No open project found maps **DPI, polling rate, lift-off, sleep, battery or macros** for any Cooler
Master device. That is the big gap (section 6).

Short names used below:
- **ORGB** = OpenRGB (C++, `Controllers/CoolerMasterController/`).
- **Detect** = ORGB `CoolerMasterControllerDetect.cpp` (what OpenRGB actually opens).
- **KbDevs** = ORGB `CMKeyboardController/CMKeyboardDevices.h` (keyboard product ids).
- **MM712txt** = ORGB `CMMM712Controller/MM712protocol.txt` (a contributor's protocol notes).

## 1. Most common current models

USB product ids as the sources list them. "Detected" means OpenRGB registers it in Detect; "defined only" means the
id is in a header but no detector line was found for it.

### Mice

| Model | Id | Interface / usage page / usage | ORGB driver | Source |
|---|---|---|---|---|
| MM530 | `0065` | 1 / `FF00` / `01` | CMMMController (5xx command) | Detect; CMMMController.h |
| MM531 | `0097` | 1 / `FF00` / `01` | detector line commented out | Detect |
| MM711 | `0101` | 1 / `FF00` / `01` | CMMM711Controller | Detect |
| MM720 | `0141` | 1 / `FF00` / `01` | CMMMController (7xx command) | Detect; CMMMController.h |
| MM730 | `0165` | 1 / `FF00` / `01` | CMMMController (7xx command) | Detect |
| MM712 (wireless) | `0169` | **3** / `FF0A` / `02` | CMMM712Controller (own protocol) | Detect; MM712txt |
| MM731 (wireless) | `0167` | **unconfirmed** | none; open "New Device" request with captures, no code | ORGB issue #1937 |

Notes:
- MM712txt says "PID 0x2516, VID 0x0169". The labels are swapped; `2516` is the vendor id (Detect).
- Whether `0169` (MM712) and `0167` (MM731) are the mouse on its cable or the 2.4 GHz receiver is **unconfirmed**.
  No receiver id was found for either. A review notes the MM731 receiver has its own firmware (1.2.8).

### Keyboards

All keyboards are opened on interface 1, usage page `FF00`, usage `01` (Detect).

| Model | Id | ORGB family | Detected? | Source |
|---|---|---|---|---|
| MasterKeys Pro S | `003C` | V1 | yes | KbDevs; Detect |
| MasterKeys Pro L / Pro L White | `003B` / `0047` | V1 | yes | KbDevs; Detect |
| MK850 | `0069` | V2 | yes | KbDevs; Detect |
| MK730 | `008F` | V2 | yes | KbDevs; Detect |
| MK750 | `0067` | V2 | yes | KbDevs; Detect |
| SK622 Black / White | `0149` / `014B` | V2 | yes | KbDevs; Detect |
| SK620 Black / White | `0157` / `0159` | V2 | yes | KbDevs; Detect |
| SK630 / SK650 | `0089` / `008D` | V2 | yes | KbDevs; Detect |
| SK652 / SK653 | `015D` / `01AB` | V2 | yes | KbDevs; Detect |
| CK530 / CK530 V2 | `009F` / `0147` | V2 | yes | KbDevs; Detect |
| CK550 V2 | `0145` | V2 | yes | KbDevs; Detect |
| CK550 V1 / CK552 | `007F` | V2 | yes | KbDevs; Detect |
| CK721 | `016D` | **unknown** | defined only | KbDevs |
| CK720 / CK721 Line | `016B` / `01EE` | **unknown** | defined only | KbDevs |
| MK721 / MK770 | `016F` / `01D5` | **unknown** | defined only | KbDevs |
| CK351 / CK570 V2 | `014F` / `01E8` | **unknown** | defined only | KbDevs |
| SK631 B / W, SK651 B / W | `008B` / `0125`, `0091` / `0127` | **unknown** | defined only | KbDevs |

Notes:
- "Defined only" may mean the detector line was added under another name, or support is in progress. Treat the
  CK721 as unsupported by any open project until a detector or capture is found.
- SK622 and CK721 are sold as wireless (Bluetooth and/or 2.4 GHz). Which id the PC sees in each mode is
  **unconfirmed**; the ids above are presumably the USB cable.

### Other lighting devices (for completeness)

| Device | Id | Interface / usage page | Source |
|---|---|---|---|
| MP750 mousepad XL / L / M | `0109` / `0107` / `0105` | usage page `FF00`, usage `01` | Detect |
| ARGB controller (gen 1) | `1011` | 0 / `FF00` | Detect; CMARGBController.h |
| Small ARGB | `1000` | 0 / `FF00` | Detect |
| RGB controller | `004F` | 1 / `FF00` | Detect |
| ARGB Gen 2 A1 / A1 V2 / A1 Mini | `0173` / `01C9` / `01CB` | 1 / `FF01` | Detect; CMARGBGen2A1Controller.h |
| GM27-FQS / GM34-CWQ monitor | `01BB` / `01BF` | 0 / `FF00` | Detect |
| GD160 desk | `01A9` | 0 / `FF00` | Detect |

### Headsets (MH series)

No open project found supports any Cooler Master headset. HeadsetControl's device table lists none. OpenRGB has no
headset controller. MH650 is a USB headset with RGB; MH670 is 2.4 GHz wireless with a Micro-USB charge port (reviews).
Ids and protocol: **not found**. Treat as plain Windows audio devices.

## 2. How they talk

### Common shape

- Every ORGB Cooler Master driver uses **plain HID output reports** (`hid_write`) and **input reports**
  (`hid_read` / `hid_read_timeout`). **No feature reports** appear in any file read.
- Every packet is **65 bytes**: byte 0 is report id `00` (unnumbered report, hidapi convention), then 64 bytes of
  payload. Constants: `CM_MM_PACKET_SIZE 65`, `CM_MM711_PACKET_SIZE 65`, `CM_MM712_PACKET_SIZE 65`,
  `CM_KEYBOARD_WRITE_SIZE 65`, `CM_ARGB_PACKET_SIZE 65`, `CM_ARGB_GEN2_A1_PACKET_LENGTH 65`.
- Replies come back on the same interface. They arrive without the report id byte, so reply offsets are one lower
  than the request offsets (ORGB reads `buffer[CM_MM_RED_BYTE - 1]`).
- Reply timeouts: 250 ms for mice (`CM_MM_INTERRUPT_TIMEOUT`), 50 for keyboards (`CM_KEYBOARD_TIMEOUT`, units
  not stated).
- The command byte family seems shared: `41 80` = init / control mode, `50 55` = save, `51 ..` = set, `52 ..` = get.
  This pattern appears in the mouse (CMMM, MM711) and keyboard (V2) drivers. The MM712 uses a different set.

### Mice: MM530 / MM720 / MM730 (CMMMController)

Payload after report id `00`. Offsets count from byte 0 = report id.

| Command | Bytes | Reply |
|---|---|---|
| Init | `00 41 80` | read |
| Get color | `00 52 <cmd>` (cmd `2C` on MM53x, `2B` on 7xx) | brightness, R, G, B |
| Get mode | `00 52 28` | mode |
| Get custom (direct) colors | `00 52 A8` | buttons `[4..6]`, logo `[7..9]`, wheel `[10..12]` |
| Set mode / colors | `00 51 <cmd> 00 00` + fields below | read |
| Apply | `00 51 28 00 00 <mode>` | read |
| Set direct colors | `00 51 A8 00 00` + zone RGBs | read |
| Use zones | `00 51 30 00 00` | read |
| Save to flash | `00 50 55` | read |

Field offsets (CMMMController.h): mode `05`, speed `06`, flags `07`-`09`, brightness `0A`, R/G/B `0B`-`0D`,
second color `0E`-`10`; bytes 17 on are `FF`.
Modes: static `00`, breathing `01`, spectrum `02`, stars `03`, indicator `04`, custom `B0`, multilayer `E0`, off `FE`.
Speeds: `3C`, `37`, `31`, `2C`, `26` (slow to fast).

### Mouse: MM711 (CMMM711Controller)

Same command set as above with the 7xx code `2B`: init `00 41 80`, get color `00 52 2B`, get mode `00 52 28`,
get custom `00 52 A8`, set `00 51 2B 00 00 ...`, apply `00 51 28 00 00 <mode>`, direct `00 51 A8 00 00 ...`,
save `00 50 55`. Two zones (wheel, logo). Modes: static `0`, breathing `1`, spectrum `2`, indicator `4`, custom
`176` (`B0`), off `254` (`FE`). Speeds: slowest `5F`, normal `38`, fastest `20`.

### Mouse: MM712 (own protocol, interface 3)

From MM712txt and CMMM712Controller.cpp:

| Command | Bytes | Reply |
|---|---|---|
| Init "normal" state | `00 44 81 02` | `45 81 02 02 01` |
| Enter direct state | `00 5A 81 02` | none |
| Leave direct state | `00 5A 81 01` | none; re-init needed |
| Get stored color for a mode | `00 4C 81 03 <mode>` | R, G, B at reply `[6..8]` (ORGB) |
| Get active mode | `00 4C 81 07` | mode at reply `[3]` |
| Set mode | `00 4C 81 08 <mode>` (0 static, 1 breathing, 2 cycle, 3+ off) | echo |
| Set color / speed / brightness | `00 4C 81 04 <mode> FF <bright> <speed> <R> <G> <B> FF` | read |
| Set live color (direct) | `00 5A 81 03 <R> <G> <B>` | none |
| Change profile | `00 44 81 01 <0-4>` | `45 81 01 <p> <?>` |
| Save to flash | `00 54 81 01` (txt); ORGB sends `54 81 01` with no `00` | `55 81 01 00` |
| "Type-4" state | `00 46 81` | `47 81 50 03 00 00 f2 9b 1e 00 64 02 ...` (meaning unknown) |

The `47 81 ...` reply holds bytes nobody has decoded. It may contain battery, DPI or polling (**unconfirmed**; pure
guess, do not rely on it). ORGB's save packet drops the `00` report id; the txt keeps it. Measure which one works.

### Keyboards: V1 (MasterKeys Pro S / Pro L)

- Control mode: `41 <mode>` (`02` = manual for per-key; `01` = effect; `00` = firmware).
- Effect: `51 28 00 00 <effect>` then `51 2C 00 00 <effect> <p1> <p2> <p3> FF FF <R1 G1 B1> <R2 G2 B2>` + 48 `FF`.
- Per-key: 8 packets `C0 02 <offset> 00` + 16 RGB triplets, offsets `00, 02 ... 0E` (128 slots).
- Single key: `C0 01 01 00 <led> <R> <G> <B>`.
- Firmware: control mode `00`, then `01 02`; version string from reply offset 4, `<layout>.<minor>.<major>`
  (layout 1 ANSI, 2 ISO, 3 JIS).

### Keyboards: V2 (MK730, MK850, SK62x, SK63x/65x, CK530, CK550)

Every V2 command is written from byte 1 of a 65-byte buffer; byte 0 is a fill value (report id). All are read back,
but only the firmware and status reads use the reply (CMKeyboardAbstractController.cpp).

| Command | Bytes | Notes |
|---|---|---|
| Control mode | `41 <mode>` | `00` firmware, `01` effect, `02` manual V2, `03` custom profile, `05` custom profile V2, `80` direct |
| Set active profile | `51 00 00 00 <profile>` | |
| Get active profile | `52 00` | reply `[4]` |
| Set active effect | `51 28 00 00 <effect>` | |
| Get mode status | `52 28` | reply `[4]` |
| Save profile | `50 55` | writes flash |
| Firmware version | control mode `00`, then `12 20` | UTF-16 string at reply offset 8, `V<layout>.<minor>.<major>` |
| Per-model "magic" init | e.g. `56 81 00 00 01 00 00 00 <id> 00 00 00 BB BB BB BB` | id differs per model (`09`, `0A`, `0C`) |
| Startup sequence (SK622, SK652/653) | `12`, `12 20`, `12 01`, `12 22`, `42 00 00 00 01 00 00 01 01`, `43 00 00 00 01` | ORGB: "No idea what it does" |
| Static color | `56 83 00 00 01 00 00 00 00 01 00 C1 00 00 00 00 <R> <G> <B> <bright> ...` | brightness is a byte inside each effect |
| Per-key colors | control `05`, init, header `56 83 00 00 01 00 00 00 80 01 00 C1 ...` + 40 RGB bytes, then 9 packets `56 83 <i> 00` + 60 RGB bytes, then `51 28 00 00 FF` | 193 LEDs (`C1`) |

Per-model init (ORGB): SK620 magic `09`; SK622 startup + magic `09`; SK630/650 profile `0C`; SK652/653 startup +
magic `0C`; CK530 profile `05` + magic `0A`; CK550 V2 profile `05` + magic `09`; MK730 profile `05` + magic `0A`;
CK552 control `80` + magic `01`. MK850 uses the default.

### ARGB controllers

- Gen 1 (`1011`): 65 bytes, mode at `05`, speed `07`, brightness `08`, RGB `09`-`0B`; ports bit mask `01 02 04 08`, RGB
  port `FE`.
- Gen 2 A1: 65 bytes (64 logical), 3 channels, 60 LEDs max. Page `80`, read `01` / write `02`. Commands include
  firmware `B4`, UID `B5`, identify `0A`, save `B0`, **reset `B1`**.

### Wired vs wireless

- All ORGB drivers are written for USB connections. None mention wireless, a receiver, Bluetooth, or battery.
- MM712 (2.4 GHz + Bluetooth + cable) is driven on interface 3 of `0169`; whether lights work through the receiver is
  **unconfirmed**. Over Bluetooth there is no raw HID path in any source.
- MM731, SK622 (Bluetooth), CK721 (2.4 GHz / Bluetooth): **nothing found** about the wireless path.

## 3. Settings map

R = read, W = write. "ORGB" = implemented in OpenRGB code; "txt" = described only in MM712txt.

| Setting | Bytes | R/W | Models (source) |
|---|---|---|---|
| Firmware version (keyboard) | V2: `41 00`, `12 20`; V1: `41 00`, `01 02` | R | V1, V2 keyboards (ORGB) |
| Serial / manufacturer | USB string descriptors (index 2 = serial) | R | CMMM mice (ORGB) |
| Mouse light mode | `52 28` / `51 28 00 00 <mode>` | R/W | MM530, MM711, MM720, MM730 (ORGB) |
| Mouse light color + brightness + speed | `52 2B` / `51 2B 00 00 ...` | R/W | MM711, MM720, MM730 (ORGB) |
| Mouse zone colors (direct) | `52 A8` / `51 A8 00 00 ...` | R/W | MM53x, MM7xx (ORGB) |
| MM712 light mode | `4C 81 07` / `4C 81 08 <m>` | R/W | MM712 (ORGB, txt) |
| MM712 color per mode | `4C 81 03 <m>` / `4C 81 04 ...` | R/W | MM712 (ORGB, txt) |
| MM712 live color | `5A 81 03 R G B` | W | MM712 (ORGB, txt) |
| Mouse profile | `44 81 01 <0-4>` | W | MM712 (ORGB, txt) |
| Keyboard profile | `52 00` / `51 00 00 00 <p>` | R/W | V2 keyboards (ORGB) |
| Keyboard effect | `52 28` / `51 28 00 00 <e>` + `56 81`/`56 83` packets | R/W | V2 keyboards (ORGB) |
| Keyboard brightness | byte inside the effect packet, `00`-`FF` | W | V2 keyboards (ORGB) |
| Keyboard per-key colors | V1 `C0 02`; V2 `56 83` x10 | W | V1, V2 (ORGB) |
| Save to flash | `50 55` (mice, keyboards); `54 81 01` (MM712) | W | (ORGB) |
| Mousepad mode / color | `07` get; mode rows `00`-`05` | R/W | MP750 (ORGB) |
| ARGB firmware / UID | `B4` / `B5` (Gen 2 A1) | R | ARGB Gen 2 A1 (ORGB) |
| **Mouse DPI / stages** | **not found** | | none |
| **Polling rate** | **not found** | | none |
| **Lift-off distance** | **not found** | | none |
| **Sleep / power save** | **not found** | | none |
| **Battery level / charging** | **not found** (MM712 `47 81` reply undecoded) | | none |
| **Button remap / macros** | **not found** | | none |
| **Keyboard macros / Fn layer** | **not found** | | none |

## 4. Read-only first, then writes

Safe to read first (gets only):
- USB string descriptors (manufacturer, product, serial).
- Mice: `52 28` (mode), `52 2B` (color), `52 A8` (custom colors). MM712: `4C 81 07`, `4C 81 03 <m>`.
- Keyboards: `52 00` (profile), `52 28` (effect), firmware via `12 20` (V2) or `01 02` (V1).
- MP750: `07`.

Careful even when reading:
- The keyboard firmware read first sets control mode `41 00`. That is a write. Restore the previous mode after.
- Mouse "init" `41 80` and MM712 init `44 81 02` change device state (they enter a host-control state). Measure
  what the device does after each, and whether the lights return when DeviceHub lets go.
- The SK622 / SK652 "startup" packets are not understood by anyone. Do not send them in a read-only pass.

Writes that change only lighting, without touching flash:
- Mouse set / apply / direct; MM712 set mode and direct; keyboard effect and per-key; MP750 set.
- Read the current mode and color first, keep them, and put them back on exit.

Never (or only after a backup and restore is proven):
- **Save to flash** (`50 55`, `54 81 01`, ARGB `B0`): writes the device's stored settings. Use live (non-saved)
  lighting only.
- **ARGB Gen 2 `B1` (reset)**, `0D` remap, `07` topology: could reset the controller's LED layout.
- Profile switches (`51 00 00 00 <p>`, `44 81 01 <p>`) on a device whose profiles hold the owner's DPI and buttons.
- Any command byte not in this file. There is no "not supported" reply documented, so an unknown byte has an
  unknown effect.
- Firmware update paths: nothing maps them, and nothing should.
- Running beside Cooler Master's own app (MasterPlus+ / MasterCTRL). Both would talk on the same interface.

## 5. What DeviceHub would build

### Do lighting through OpenRGB, not raw HID

OpenRGB already drives every detected Cooler Master device above, and DeviceHub already talks to OpenRGB. A raw HID
lighting path would copy that work. So the plan is mostly "show what OpenRGB shows", plus a small read-only adapter.

### A small "Cooler Master" read adapter

1. **`coolermaster.js` (transport).** Opens the vendor collection by vid/pid plus interface and usage page from the
   table in section 1 (`FF00`/`01` on interface 1 for most, `FF0A`/`02` on interface 3 for MM712). Writes 65-byte
   output reports with report id `00`, reads 64-byte replies. **No feature reports needed.** The C# helper's
   HID find and write code (written for the HS80) should cover it with a different usage page.
2. **Per-model table:** id, interface, usage page, family (`mm`, `mm711`, `mm712`, `kbV1`, `kbV2`, `mp750`), read
   commands, reply offsets.
3. **What it shows:** device name and serial; keyboard firmware and layout; current light mode and color.
4. **Gives way** when MasterPlus+ or OpenRGB holds the device (both use the same interface).

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | List Cooler Master devices by id (section 1) and show name, serial, model | 0.5 day | none (USB descriptors only) |
| 2 | Lighting through OpenRGB for every detected model | 0.5 day (already a path) | low |
| 3 | Keyboard firmware + layout read (V1/V2), restoring the control mode after | 1 day with the device | low-medium (needs a `41` write) |
| 4 | Mouse mode / color read (`52 28`, `52 2B`); MM712 `4C 81 07` | 0.5 day per family with the device | low |
| 5 | Capture MasterPlus+ traffic (USBPcap + Wireshark) for DPI, polling, lift-off, sleep on one mouse in hand | 2-4 days | low to capture; any write found is high until proven |
| 6 | DPI / polling writes, only if step 5 maps them and read-back works | 2-3 days | medium-high (no source, no error reply) |
| 7 | MM731 / CK721 / MH headsets | large, unknown | high: no ids, no protocol |

Battery for wireless Cooler Master mice is the setting the owner would most want, and it is the one with the least
known. Expect to start from a capture.

## 6. Gaps and unknowns (large)

This brand is far less mapped than Corsair. Say so plainly to anyone picking it up.

- **No DPI, polling, lift-off, sleep, battery, button or macro command for any Cooler Master device** was found in
  OpenRGB, libratbag, HeadsetControl or any other open project. libratbag has no Cooler Master driver.
- **MM731:** id `0167` from an OpenRGB request with captures but no code. Receiver id, interface and protocol
  unknown.
- **MM712 and MM731 receivers:** no receiver id found; whether `0169` is cable or receiver is unknown.
- **CK721 and the newer keyboards** (CK720, MK721, MK770, CK570 V2, CK351, SK631, SK651): ids defined in OpenRGB, but
  no detector line found and no protocol family stated.
- **SK622 over Bluetooth, CK721 over 2.4 GHz:** no path documented.
- **MH series headsets (MH650, MH670, MH630):** no ids, no protocol, no open support.
- **MM712 `47 81 ...` reply** (to `46 81` and to set-color): undecoded. Might hold battery or settings; pure guess.
- **MM712 save packet:** ORGB sends `54 81 01` without the `00` report id; the txt has `00 54 81 01`. One of them
  is off by one.
- **Keyboard V2 startup packets** (`12 ..`, `42 ..`, `43 ..`): meaning unknown even to OpenRGB.
- **No error reply is documented** for an unsupported command, unlike Corsair's status `05`.
- **Keyboard timeout units** (`50`, `3`) not stated.
- **Cooler Master SDK:** none public was found for peripherals.

## Sources

- [OpenRGB CoolerMasterControllerDetect.cpp (ids, interfaces, usage pages)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CoolerMasterControllerDetect.cpp)
- [OpenRGB CMKeyboardDevices.h (keyboard ids)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMKeyboardController/CMKeyboardDevices.h)
- [OpenRGB CMKeyboardAbstractController.h (packet size, control modes)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMKeyboardController/CMKeyboardAbstractController.h)
- [OpenRGB CMKeyboardAbstractController.cpp (send/read, profile, save)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMKeyboardController/CMKeyboardAbstractController.cpp)
- [OpenRGB CMKeyboardV1Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMKeyboardController/CMKeyboardV1Controller.cpp)
- [OpenRGB CMKeyboardV2Controller.cpp (per-model init, effects, per-key, firmware)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMKeyboardController/CMKeyboardV2Controller.cpp)
- [OpenRGB CMMMController.h (mouse offsets, modes, speeds)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMMController/CMMMController.h)
- [OpenRGB CMMMController.cpp (mouse commands)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMMController/CMMMController.cpp)
- [OpenRGB CMMM711Controller.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMM711Controller/CMMM711Controller.h)
- [OpenRGB CMMM711Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMM711Controller/CMMM711Controller.cpp)
- [OpenRGB CMMM712Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMM712Controller/CMMM712Controller.cpp)
- [OpenRGB MM712protocol.txt](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMM712Controller/MM712protocol.txt)
- [OpenRGB CMMP750Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMMP750Controller/CMMP750Controller.cpp)
- [OpenRGB CMARGBController.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMARGBController/CMARGBController.h)
- [OpenRGB CMARGBGen2A1Controller.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/CoolerMasterController/CMARGBGen2A1Controller/CMARGBGen2A1Controller.h)
- [OpenRGB issue #1937: MM731 new-device request (PID 0167, captures)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/1937)
- [HeadsetControl README (supported devices: no Cooler Master)](https://github.com/Sapd/HeadsetControl/blob/master/README.md)
- [libratbag / Piper issues (no Cooler Master driver found)](https://github.com/libratbag/piper/issues)
- [ocinside MM731 review (receiver firmware)](https://www.ocinside.de/review/cooler_master_mm731/2)
- [TechPowerUp MM731 review](https://techpowerup.com/review/cooler-master-mm731)
- [TechPowerUp MM720 review](https://techpowerup.com/review/cooler-master-mm720)
- [TechPowerUp MH670 review](https://techpowerup.com/review/cooler-master-mh670)
- [TechPowerUp MH650 review](https://techpowerup.com/review/cooler-master-mh650)

## Covered (22 Oct 2026): no library driver, on purpose

Nothing beyond lighting is documented with a source: no DPI, polling, lift-off, sleep, battery or macro command for
any Cooler Master device (section 6). The only non-lighting read, the keyboard firmware version, first needs a control
mode write (`41 00`), and the MM712 `47 81` reply is undecoded. Lighting goes through OpenRGB. A driver waits for a
capture of MasterPlus+ (section 5, step 5).
