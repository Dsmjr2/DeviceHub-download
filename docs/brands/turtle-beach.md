# Turtle Beach and ROCCAT (USB vendor ids 0x10F5 Turtle Beach, 0x1E7D ROCCAT)

A bare mapping for DeviceHub. Every id and byte below comes from an open-source project, cited in the
Sources section. Anything marked **unconfirmed** was not found in a source, or the sources disagree.
Nothing here has been tested on a real device. Researched 2026-10-22.

Short version: the ROCCAT mice and keyboards are well mapped (OpenRGB for lights, libratbag for older
mice' DPI and polling). The Turtle Beach headsets are **poorly documented**. HeadsetControl supports no
Turtle Beach headset at all, only two old ROCCAT Elo headsets. The only open headset work is battery
reading on the newest Airoha-based models (Stealth 700 Gen 3, Stealth Pro II, Stealth 600 Gen 3). No open
source sets sidetone, EQ, mic monitoring or auto-off on any Turtle Beach headset.

All references write with hidapi: the first byte of each buffer is the report id.

## 1. Common current models

### Headsets

| Model | VID:PID | HID channel | What is known | Source |
|---|---|---|---|---|
| Stealth 700 Gen 3 transmitter | 10F5:2251 (verified) | usage page 0xFF13, usage 0x0001 (Windows `COL02`, `MI_03`) | battery read (Airoha RACE + CoAP) | halobattery-stealth700 |
| Stealth 700 Gen 3 siblings | 10F5:2250, 10F5:2253 | same | assumed same firmware, **untested** | same |
| Stealth Pro II transmitter / dock | 10F5:229B | usage page 0xFF13, usage 0x0001 | battery, charging, name (read) | HaloBattery PR #194 |
| Stealth Pro II headset on its cable | 10F5:229E | same | same records as the transmitter | same |
| Stealth 600 Gen 3 (reported as "Stealth 600P Gen 3 headset"), USB-C | 10F5:223A | usage page 0xFF13 | RACE nvkey read/write | stealth600-gen3-usb-fix |
| Stealth 700 G2 receiver | 10F5:218C | if 0: 0xFF00/0x0001 (vendor); if 5: 0x000C/0x0001 (media keys) | ids only, no protocol | HaloBattery issue #206 |
| ROCCAT Elo 7.1 Air | 1E7D:3A37 | 64-byte reports | lights on/off, auto-off (write) | HeadsetControl |
| ROCCAT Elo 7.1 USB | 1E7D:3A34 | 16-byte reports; OpenRGB opens iface 3, usage page 0x0C, usage 1 | lights | HeadsetControl, OpenRGB |

Not found in any source (**unconfirmed**, no PID, no protocol): Stealth 700 Gen 2 MAX, Stealth 600 Gen 2,
Stealth Pro (first generation), Atlas Air (HaloBattery issue #310 has no ids on the page), and any Stealth
dongle PID other than those above. Recon 500 and Atlas One/Three are, as far as I know, wired 3.5 mm
headsets with no USB control channel (**unconfirmed**: from product knowledge, not a source). If so,
there is nothing for DeviceHub to control on them.

The Stealth 700 G2 is an Xbox Wireless headset. The issue #206 reporter says the PC Audio Hub app only
does firmware updates there, and battery is read by the phone app over Bluetooth, which a PC USB capture
cannot see.

### Mice (OpenRGB `RoccatControllerDetect.cpp`, libratbag `.device` files, Linux `hid-ids.h`)

| Model | VID:PID | OpenRGB interface / usage page / usage | Mapped by |
|---|---|---|---|
| Kone XP | 1E7D:2C8B | 3 / 0xFF01 / 1 | OpenRGB (lights + full profile incl. DPI, polling) |
| Kone Pro | 1E7D:2C88 | 3 / 0xFF01 / 1 | OpenRGB (lights) |
| Kone Pro Air (dongle) | 1E7D:2C8E | 2 / 0xFF00 / 1 | OpenRGB |
| Kone Pro Air (wired) | 1E7D:2C92 | 1 / 0xFF13 / 1 | OpenRGB |
| Burst Pro | 1E7D:2DE1 | 3 / 0xFF01 / 1 | OpenRGB |
| Burst Core | 1E7D:2DE6 | 3 / 0xFF01 / 1 | OpenRGB |
| Burst Pro Air | 1E7D:2CA6 | 0 / 0x01 / 2 | OpenRGB |
| Kone Aimo / Aimo 16K | 1E7D:2E27 / 2E2C | 0 / 0x0B / 0 | OpenRGB |
| Kova | 1E7D:2CEE | 0 / 0x0B / 0 | OpenRGB |
| Kone Pure family | 1E7D:2DBE, 2DC2, 2DCB | - | libratbag (DPI, polling, buttons) |
| Kone EMP | 1E7D:2E24 | - | libratbag |
| Kone XTD | 1E7D:2E22 | - | libratbag, Linux kernel |

`usb.ids` also lists older ROCCAT mice (Pyra, Lua, Kiro, Kone, Kone[+], Kova[+], Savu, Tyon 2E4A/2E4B,
Nyth 2E7C/2E7D). The newer Turtle Beach-branded mice (Kone II, Burst II, Pure Air and similar) were not
in any source checked (**unconfirmed**).

### Keyboards (OpenRGB `RoccatVulcanKeyboardController.h`)

| Model | VID:PID | Interface / usage page |
|---|---|---|
| Turtle Beach Vulcan II | 10F5:501B | 1 / 0xFF01 |
| Turtle Beach Vulcan II TKL | 10F5:5023 | 1 / 11 |
| Turtle Beach Vulcan II TKL Pro | 10F5:5001 | 1 / 0x0001 |
| ROCCAT Vulcan II / II Mini / II Max | 1E7D:2F4E / 2F09 / 2EE2 | 1 / 0xFF01 |
| ROCCAT Vulcan Pro / TKL Pro | 1E7D:30F7 / 311A | 1 / 0xFF01 |
| ROCCAT Vulcan 100 Aimo / 120 Aimo / TKL | 1E7D:307A / 3098 / 2FEE | 1 / 11 |
| ROCCAT Pyro / Magma / Magma Mini | 1E7D:314C / 3124 / 69A0 | 1 / 0xFF01 |
| ROCCAT Horde Aimo | 1E7D:303E | 1 / 0x0B, usage 0 |

OpenRGB also has a Turtle Beach Command Series KP7 keypad controller and Sense Aimo mousemats
(1E7D:343A, 343B). Older ROCCAT keyboards (Ryos, Isku, Arvo, Sova, Suora, Skeltr) are in `usb.ids` and
roccat-tools, not mapped here.

## 2. How they talk

**Newest headsets (Stealth 700 Gen 3, Stealth Pro II, Stealth 600 Gen 3): Airoha RACE over HID.**
The transmitter is an Airoha chip. Its vendor collection is usage page 0xFF13, usage 0x0001. Select it by
usage, not interface number.

- Host to device: output report `0x06`, 62 bytes: `06 <len_lo> <len_hi> <RACE bytes...>`, zero-padded.
  The wrapper length is the length of the whole RACE packet.
- Device to host: input report `0x07`, read with GET_REPORT (`get_input_report`), same 3-byte prefix.
- RACE packet: `05 5A <len_lo> <len_hi> <id_lo> <id_hi> <payload>`. `5A` expects a reply, `5C` does not.
  `len` = payload length + 2. Replies start `05 5B`; device-pushed indications start `05 5D`.
- Stealth 700 Gen 3 battery path: enable the on-chip CoAP client (RACE `0x9942`), then tunnel a CoAP
  `GET /GSI` in RACE `0x9902`. The reply body (after the CoAP `0xFF` marker) is JSON, e.g.
  `{"OR":"GSI","KVP":{"240":"100",...}}`. Values are strings.
  - Enable: `06 06 00 05 5A 02 00 42 99` (zero-padded to 62).
  - GET /GSI: `06 0E 00 05 5A 0A 00 02 99 40 01 00 01 B3 47 53 49` (zero-padded to 62).
  - The project's `docs/protocol.md` shows the length as `05 00`; its `reader.py` sends `0A 00`, which
    matches the formula. Trust the code.
  - Reassembly: the reader just concatenates read payloads and takes the first `{` to the last `}`.
  - The direct RACE battery command `0x0CD6` returned status `02` (refused) on the USB transmitter.
- Stealth Pro II: the same 0xFF13 transport and report ids, 62-byte reports, input framed
  `07 <len> 00 <data>`. It opens a session ("SInf") and asks for the GSI record. The exact request bytes
  are only in a USBPcap capture referenced by the PR, not on the page (**unconfirmed**). Pushed updates
  `{"UP":"GSI",...}` carry only changed keys.
- Stealth 600 Gen 3: RACE nvkey commands over the same transport, fragmented at 59 bytes.
  Read `0x0A00`: `05 5A 06 00 00 0A <keyId LE16> <readLen LE16>`. Write `0x0A01`:
  `05 5A <L LE16> 01 0A <keyId LE16> <data>`, L = len(data) + 4. Key `0x1003` = model name; key `0xFFFF`
  = firmware nvkey status byte.

**Stealth 700 G2 and other older headsets: unknown.** The G2 receiver's vendor collection is 0xFF00, not
0xFF13, so the RACE code is not a known match. No capture or protocol data exists in open sources.

**ROCCAT Elo headsets:** plain writes, no checksum (HeadsetControl).

**ROCCAT mice and keyboards: feature reports.** Byte 0 is the report id. A family pattern shows up across
OpenRGB and libratbag: report `0x04` = ready/profile select, `0x05` = active profile, `0x06` = profile or
settings block with a 16-bit additive checksum in its last two bytes (low byte first), `0x09` = firmware
version, `0x0D` = direct LED colors, `0x0E` = software-control switch. After a write, poll report `0x04`
until byte 1 is `0x01` (ready).

## 3. Settings map

R = read, W = write. "Sum16" = 16-bit sum of every byte except the last two, stored low byte then high.

### Headsets

| Setting | Command | R/W | Format | Models |
|---|---|---|---|---|
| Battery % | RACE 0x9942 then 0x9902 CoAP GET /GSI, JSON key `240` | R | decimal string | Stealth 700 Gen 3 (verified 2251), Stealth Pro II (key 240, confirmed on hardware) |
| Charging | GSI key `250` | R | `0`/`1` | Stealth Pro II (confirmed both states); Stealth 700 Gen 3 **unverified** |
| Headset linked | GSI key `230` (`1` = linked) | R | string | Stealth 700 Gen 3 |
| Headset name | GSI key `220` | R | string | Stealth 700 Gen 3, Stealth Pro II |
| Signature Sound preset | GSI key `2c0` | R | meaning **unconfirmed** | Stealth 700 Gen 3 |
| Model name | RACE nvkey read 0x0A00, key `0x1003` | R | bytes | Stealth 600 Gen 3 |
| Lights on/off | 4 writes: `FF 02`; `FF 03 00 01 00 01`; `FF 04 00 00 R G B`; `FF 01`, 64 bytes each, 75 ms apart | W | R=G=B=FF on, 00 off | Elo 7.1 Air |
| Lights on/off | `FF 02`; `FF 03 00 01`; on: `FF 04 00 00 F4` / off: `FF 04`; then `FF 01`, 16 bytes, 40 ms apart | W | fixed | Elo 7.1 USB |
| Auto-off | `A1 04 06 54 <sec_hi> <sec_lo>`, 64 bytes, then a 64-byte read | W | seconds = minutes x 60, minutes 0-60 | Elo 7.1 Air |
| Sidetone, mic monitoring, EQ, auto-off, mic volume | none found | - | - | **every Turtle Beach headset: undocumented** |

### Mice

| Setting | Command | R/W | Format | Models |
|---|---|---|---|---|
| Wait for ready | get feature `04`, 4 bytes; ready when byte 1 = `01` | R | - | Kone XP (Kone Pure: 3 bytes, `01` ready, `02` other, `03` busy) |
| Firmware | get feature `09`, 9 bytes; byte 2 = version | R | `b/100`.`b%100` | Kone XP, Vulcan II family |
| Active profile | get feature `05`, 4 bytes, byte 2 | R | 0-based | Kone XP (Kone Pure: 3 bytes) |
| Set active profile | `05 03 <index>` | W | 0-4 | Kone Pure |
| Select profile to read | `04 <profile> 80 FF` | W | - | Kone XP |
| Profile block (DPI, polling, lights, idle) | feature `06`, 174 (0xAE) bytes: `06 AE <profile> ...`, 10 DPI slots LE16 at 0x07, angle snap 0x1B, polling 0x1D, LED mode 0x1E, speed 0x1F, brightness 0x20, idle time 0x21, Sum16 at 0xAC | R/W | DPI unit and polling encoding **unconfirmed** | Kone XP |
| Profile block (lights only edited) | feature `06`, 69 bytes, Sum16 at 0x43; OpenRGB reads it, edits mode 0x1E / speed 0x1F / brightness 0x20 / colors, writes back | R/W | DPI/polling bytes kept, not mapped | Kone Pro |
| Same | feature `06`, 63 bytes, Sum16 at 61-62 | R/W | same | Burst Pro / Burst Core |
| Software control | `0E 06 01 <on> 00 FF` (6 bytes) | W | 1 = host drives LEDs | Kone XP, Kone Pro, Burst |
| Direct LEDs | Kone Pro / Burst: `0D 0B R G B ...` (11 bytes). Kone XP: `0D 7A` + 20 x `R G B FF FF FF` (122 bytes) | W | per LED | as listed |
| DPI levels | select `04 <profile> 80`, then feature `06` (31 bytes): `dpi_mask`, `xres[5]`, `current_dpi`, `yres[5]` | R/W | value x 50 = DPI; X 200-8200 | Kone Pure (libratbag) |
| Polling rate | same settings report, `report_rate` | R/W | index into 125/250/500/1000 Hz | Kone Pure (libratbag) |
| Buttons | select `04 <profile> 90`, feature `07`, 59 bytes, action at `3 + n*3`, Sum16 | R/W | action codes in libratbag | Kone Pure |

### Keyboards (Vulcan II family, OpenRGB)

| Setting | Command | R/W | Format |
|---|---|---|---|
| Firmware + layout | get feature `09` (9 bytes, Vulcan II/Pro/TB models) or `0F` (8 bytes, older); byte 2 = version, byte 6 = layout | R | read twice, use the second |
| Ready | get feature `04` (3 or 4 bytes), byte 1 = `01` | R | poll 25 ms |
| Direct mode on/off | `0E 05 <on> 00 00` (newer) or `15 00 <on>` (older) | W | - |
| Effect mode | feature `11` (v2) or `0D` (v1), long packet (e.g. 377 bytes Vulcan II), mode/speed/brightness near the start, Sum16 | W | modes: static 01, default 02, wave 0A, direct 0B |
| Per-key colors | 65-byte output writes to the LED interface: `00 A1 <packet idx> <len>...`, 7 packets for Vulcan II | W | column-planar RGB |

## 4. Read-only first, then writes

Safe to do first (reads only):

- Enumerate both vendor ids, list interfaces and usage pages, match against the tables above.
- Airoha headsets: the GSI battery read. halobattery-stealth700 says it "never writes settings or
  firmware". The `0x9942` enable is a command, but Swarm II sends it on every poll.
- RACE nvkey reads (`0x0A00`), described as harmless by stealth600-gen3-usb-fix.
- ROCCAT: firmware (`09`), active profile (`05`), ready (`04`), and the profile block read (`06`).

Risky writes:

- **RACE nvkey writes (`0x0A01`) are the riskiest thing on this sheet.** They persist across power
  cycles. Zero-length writes are refused, so a key cannot be blanked; recovery means writing a known-good
  value. The tool's author warns the dongle-side firmware flash "is the part that bricks people".
  DeviceHub should never write nvkeys or flash firmware.
- ROCCAT profile writes (`06`) go to flash. A wrong checksum or a stale block can corrupt a profile. Always
  read-modify-write the whole block, recompute Sum16, then wait for ready.
- Note OpenRGB's Kone Pro and Burst code sends the 6-byte `0E` switch without zeroing the buffer; DeviceHub
  should zero it.
- Swarm II holds the Stealth Pro II channel while it is open; reads then get only idle frames. Expect the
  same conflict on other models (**unconfirmed**).

## 5. What DeviceHub would build

| Piece | Effort | Risk | Notes |
|---|---|---|---|
| Battery + charging for Stealth 700 Gen 3 / Stealth Pro II | Small | Low | Port the RACE/CoAP reader to the C# helper; usage page 0xFF13; parse JSON keys 240/250/230/220 |
| Same read on Stealth 600 Gen 3 and other 0xFF13 Turtle Beach PIDs | Small, after a capture | Low | Same transport is likely; confirm with a read-only capture first |
| ROCCAT Kone XP: DPI, polling, idle, lights | Medium | Medium (flash writes) | Layout is fully in OpenRGB; learn DPI units and polling codes by capture |
| Kone Pro / Burst Pro: lights | Small | Low-medium | Lights mapped; DPI/polling bytes exist in the block but are unmapped |
| Kone Pro / Burst Pro: DPI, polling | Medium | Medium | Must be learned by capture |
| Vulcan II lights | Medium | Low-medium | Long packets, per-model sizes; copy OpenRGB tables exactly |
| Older Kone Pure/EMP/XTD DPI, polling, buttons | Medium | Medium | libratbag drivers are complete references |
| Elo 7.1 lights / auto-off | Small | Low | HeadsetControl bytes, but old models |
| Headset sidetone, EQ, mic monitoring, auto-off | Large | Medium-high | Nothing open; must be learned |
| Stealth 700 G2 (0xFF00) anything | Large | Unknown | No protocol data at all |

**Where DeviceHub must learn the protocol itself.** For every headset setting except battery, and for
Kone Pro / Burst DPI and polling, DeviceHub's way applies: run USBPcap read-only on the device's bus while
the person changes one setting at a time in Swarm II, then diff the captures.

- On Airoha headsets, start by looking for GSI keys that change in the JSON (Swarm II may set values with
  a CoAP PUT/POST to the same server, **unconfirmed**), or for RACE nvkey writes (`0x0A01`). If a setting
  is only an nvkey write, treat it as high risk and do not ship it without the owner's decision.
- On ROCCAT mice, change one DPI step and one polling rate in Swarm II and diff the `06` profile block.
- Close Swarm II before DeviceHub reads, since it holds the channel.

## 6. Gaps and unknowns

- No open project controls any Turtle Beach headset setting (sidetone, EQ, mic monitoring, auto-off,
  lights). Battery read is the only documented feature, and only on Airoha-based models.
- PIDs not found: Stealth 700 Gen 2 MAX, Stealth 600 Gen 2, Stealth Pro (gen 1), Atlas Air, Stealth 600 Gen 3
  dongle, newer Kone II / Burst II / Pure Air mice.
- Stealth 700 G2 (10F5:218C): vendor page 0xFF00, protocol completely unknown.
- Stealth 700 Gen 3 charging key `250` is a best guess; PIDs 2250 and 2253 are untested.
- Stealth Pro II exact session-open and GSI request bytes are only in a capture, not published as hex;
  the fallback token is given as `11 01` in one place and `44 11 01` in another.
- stealth600-gen3-usb-fix says status byte `0x00` means NON_INSTALLED but quotes an enum where
  `0 = UNKNOWN`, `2 = NON_INSTALLED`. They disagree.
- Kone XP: DPI value units and the polling-rate code are not spelled out in OpenRGB.
- Recon 500 and Atlas One/Three being analog-only is from product knowledge, not a source.
- roccat-tools (Stefan Achatz, SourceForge) covers many older ROCCAT devices; its source was not read
  for this sheet, only packaging listings.

## Sources

- HeadsetControl device table: [README.md](https://github.com/Sapd/HeadsetControl/blob/master/README.md)
- HeadsetControl devices folder: [lib/devices](https://github.com/Sapd/HeadsetControl/tree/master/lib/devices)
- HeadsetControl [roccat_elo_7_1_air.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/roccat_elo_7_1_air.hpp)
- HeadsetControl [roccat_elo_7_1_usb.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/roccat_elo_7_1_usb.hpp)
- HeadsetControl Turtle Beach issue search: [issues?q=turtle+beach](https://github.com/Sapd/HeadsetControl/issues?q=turtle+beach)
- Stealth 700 Gen 3 reader: [halobattery-stealth700](https://github.com/PaulRichez/halobattery-stealth700),
  [docs/protocol.md](https://github.com/PaulRichez/halobattery-stealth700/blob/HEAD/docs/protocol.md),
  [src/stealth700_battery/reader.py](https://github.com/PaulRichez/halobattery-stealth700/blob/HEAD/src/stealth700_battery/reader.py)
- Stealth Pro II: [HaloBattery PR #194](https://github.com/HeyOkay/HaloBattery/pull/194)
- Stealth 700 G2: [HaloBattery issue #206](https://github.com/HeyOkay/HaloBattery/issues/206)
- Atlas Air: [HaloBattery issue #310](https://github.com/HeyOkay/HaloBattery/issues/310)
- Stealth 600 Gen 3 RACE nvkeys: [stealth600-gen3-usb-fix](https://github.com/lx-exe/stealth600-gen3-usb-fix)
- Turtle Beach Xbox controller (10F5:7018, vibration only): [TurtleBeachDriverLinux](https://github.com/shadowforce78/TurtleBeachDriverLinux)
- OpenRGB ROCCAT detection and PIDs: [RoccatControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatControllerDetect.cpp)
- OpenRGB Vulcan: [RoccatVulcanKeyboardController.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatVulcanKeyboardController/RoccatVulcanKeyboardController.h),
  [RoccatVulcanKeyboardController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatVulcanKeyboardController/RoccatVulcanKeyboardController.cpp)
- OpenRGB Kone XP: [RoccatKoneXPController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatKoneXPController/RoccatKoneXPController.cpp)
- OpenRGB Kone Pro: [RoccatKoneProController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatKoneProController/RoccatKoneProController.cpp),
  [RoccatKoneProController.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatKoneProController/RoccatKoneProController.h)
- OpenRGB Burst: [RoccatBurstController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatBurstController/RoccatBurstController.cpp),
  [RoccatBurstController.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/RoccatController/RoccatBurstController/RoccatBurstController.h)
- OpenRGB KP7 keypad: [TurtleBeachKP7ControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/TurtleBeachKP7Controller/TurtleBeachKP7ControllerDetect.cpp)
- libratbag: [driver-roccat-kone-pure.c](https://github.com/libratbag/libratbag/blob/master/src/driver-roccat-kone-pure.c),
  [roccat-kone-pure.device](https://github.com/libratbag/libratbag/blob/master/data/devices/roccat-kone-pure.device),
  [roccat-kone-emp.device](https://github.com/libratbag/libratbag/blob/master/data/devices/roccat-kone-emp.device),
  [roccat-kone-xtd.device](https://github.com/libratbag/libratbag/blob/master/data/devices/roccat-kone-xtd.device)
- Linux kernel ids: [drivers/hid/hid-ids.h](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-ids.h)
- USB id database: [usbids/usb.ids](https://github.com/usbids/usbids/blob/master/usb.ids)
- roccat-tools device list (packaging only): [Flathub](https://flathub.org/ko/apps/net.sourceforge.roccat.roccat-tools),
  [SlackBuilds](https://slackbuilds.org/repository/15.0/games/roccat-tools/)

## Covered in device-library/turtle-beach-battery (22 Oct 2026)

Read only, simulated only (tests/sim-turtle-beach-battery.mjs), never run on a real transmitter; status "untested".
- **Devices:** Stealth 700 Gen 3 transmitter `2251` (verified in the source), siblings `2250` and `2253` (labelled "not
  yet seen working").
- **Reads:** battery % (GSI key `240`), charging (`250`, a best guess on this model), linked (`230`), name (`220`),
  Signature Sound preset raw (`2c0`), from the two fixed frames in section 2 (CoAP enable `0x9942`, GET /GSI in
  `0x9902`). Nothing else can be sent. Steps back while Swarm II runs.
- **Unconfirmed:** the source asks for replies with GET_REPORT; DeviceHub's helper reads input reports as they arrive.
- Not covered: Stealth Pro II (request bytes only in a capture), Stealth 600 Gen 3, Stealth 700 G2, every headset
  setting, ROCCAT mice and keyboards.
