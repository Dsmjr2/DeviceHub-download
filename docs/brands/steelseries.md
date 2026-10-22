# SteelSeries (USB vendor id 0x1038)

A bare mapping for DeviceHub. Every id and byte below comes from an open-source project, cited in the
Sources section. Anything marked **unconfirmed** was not found in a source, or the sources disagree.
Nothing here has been tested on a real device. Researched 2026-10-22.

All three main references write with hidapi: the first byte of each buffer is the report id, and for
SteelSeries it is almost always `0x00` (no numbered reports). The only exception: older headsets
(Arctis 7, Nova Pro) put `0x06` in the first byte.

## 1. Common current models

### Headsets (HeadsetControl)

| Model | PID(s) | HID interface | Source file |
|---|---|---|---|
| Arctis Nova 7 | 0x2202, 0x22A1 | iface 3, usage page 0xFFC0, usage 0x01 | steelseries_arctis_nova_7.hpp |
| Arctis Nova 7 Wireless Gen 2 | 0x227E | same | same |
| Arctis Nova 7X / 7x | 0x2206, 0x22A4, 0x22A5 | same | same |
| Arctis Nova 7x v2 | 0x2258, 0x229E, 0x22AD | same | same |
| Arctis Nova 7 Diablo IV | 0x223A, 0x22A9 | same | same |
| Arctis Nova 7 WoW Edition | 0x227A | same | same |
| Arctis Nova Pro Wireless (base station) | 0x12E0 | iface 4 (no usage page given) | steelseries_arctis_nova_pro_wireless.hpp |
| Arctis Nova Pro Wireless X (base station) | 0x12E5 | iface 4 | same |
| Arctis 7+ / PS5 / Xbox / Destiny | 0x220E, 0x2212, 0x2216, 0x2236 | iface 3, 0xFFC0, 0x01 | steelseries_arctis_7_plus.hpp |
| Arctis Nova 5 / 5X (base station) | 0x2232, 0x2253 | iface 3, 0xFFC0, 0x01 | steelseries_arctis_nova_5.hpp |
| Arctis 9 | 0x12C2 | iface 0 | steelseries_arctis_9.hpp |
| Arctis 7 / 7 2019 / Pro 2019 / Pro GameDAC (older) | 0x1260, 0x12AD, 0x1252, 0x1280 | iface 5 | steelseries_arctis_7.hpp |

HeadsetControl also has Arctis 1, Nova 3, Nova 3P Wireless, Nova 7P, Pro Wireless and GameBuds files
(not mapped here). The Nova 7 file mentions 0x22A7 and 0x220A in comments and lists, but neither is in its
supported list (**unconfirmed**).

### Mice (rivalcfg, cross-checked with OpenRGB `SteelSeriesDevices.h`)

| Model | PID wired / USB | PID 2.4 GHz dongle | Interface |
|---|---|---|---|
| Aerox 3 (wired-only) | 0x1836 | - | 3 |
| Aerox 3 Wireless | 0x183A | 0x1838 | 3 |
| Aerox 3 Wireless CS2 Dragon Lore | 0x187A | 0x1878 | 3 |
| Aerox 3 Gen 2 Wireless | - | 0x1890 (OpenRGB only) | **unconfirmed** |
| Aerox 5 (wired-only) | 0x1850 | - | 3 |
| Aerox 5 Wireless (+ Destiny 2, Diablo IV) | 0x1854, 0x185E, 0x1862 | 0x1852, 0x185C, 0x1860 | 3 |
| Aerox 9 Wireless (+ WoW) | 0x185A, 0x1876 | 0x1858, 0x1874 | 3 |
| Rival 3 | 0x1824, 0x184C (firmware v0.37.0.0) | - | 3 |
| Rival 3 Wireless | - | 0x1830 (OpenRGB) | see rivalcfg rival3_wireless.py |
| Prime (+ R6 Black Ice, CS:GO Neo Noir) | 0x182E, 0x182A, 0x1856 | - | 0 |
| Prime Wireless / Prime Mini Wireless | 0x1842 / 0x184A | 0x1840 / 0x1848 | 3 |
| Rival 5 (+ Destiny) | 0x183C, 0x183E | - | 0 |
| Rival 600 (+ Dota 2) | 0x1724, 0x172E | - | 0 |

OpenRGB opens Aerox 3/5/9 on interface 3, usage page 0xFFC0, usage 1, and Rival 5 on interface 0,
usage page 0xFFC0, usage 1. Note OpenRGB gives 0x185A to both "Aerox 9" and "Aerox 9 Wireless wired".

### Keyboards (OpenRGB `SteelSeriesDevices.h` and `SteelSeriesControllerDetect.cpp`)

| Model | PID | Interface (usage page / usage) | OpenRGB controller |
|---|---|---|---|
| Apex Pro | 0x1610 | 1 | SteelSeriesApex (per-key) |
| Apex Pro TKL | 0x1614 | 1 | same |
| Apex Pro TKL 2023 | 0x1628 wired; 0x1630, 0x1632 wireless | 1; wireless 3 (0xFFC0 / 1) | same |
| Apex Pro TKL Gen 3 | 0x1642 wired; 0x1644, 0x1646 wireless | 1; wireless 3 (0xFFC0 / 1) | same |
| Apex Pro (Gen 3 full size, "PRO3") | 0x1640 | **unconfirmed** | **unconfirmed** |
| Apex 7 / Apex 7 TKL | 0x1612 / 0x1618 | 1 | SteelSeriesApex |
| Apex 5 | 0x161C | 1 | SteelSeriesApex |
| Apex 9 TKL / Apex 9 Mini | 0x1634 / 0x1620 | 1 | SteelSeriesApex (shorter packet) |
| Apex 3 | 0x161A | 3 | Apex3 (zone, "Full") |
| Apex 3 TKL | 0x1622 | 1 (0xFFC0 / 1) | Apex3 ("TKL") |

No source lists the Apex Pro Mini under that name (**unconfirmed**).

## 2. How they talk

### Headsets: three families

| Family (HeadsetControl class) | Models | First bytes | Packet | Save |
|---|---|---|---|---|
| Nova (`SteelSeriesNovaDevice`) | Nova 7, Arctis 7+, Nova 5 | `00 <cmd> ...` | 64 bytes (`MSG_SIZE`) | `00 09` (Nova 5 adds `00 35 01`) |
| Legacy with 0x06 (`SteelSeriesLegacyDevice`) | Nova Pro Wireless, Arctis 7 (2017-19) | `06 <cmd> ...` | 31 bytes (`PACKET_SIZE_31`) | `06 09` |
| Legacy, Arctis 9 | Arctis 9 | `00 20` read; `06 00`, `04 00` writes | 31 bytes | `90 00` |

- **Status read (Nova):** write `00 B0`, then read up to 128 bytes. One reply carries battery, charge
  state and ChatMix. The Nova 7 sidetone code notes `0xB0` status reports "can arrive asynchronously
  on this interface", so a reader must skip unexpected `B0` replies.
- **Nova Pro battery:** write `06 B0` (31 bytes), read 128 bytes.
- **Writes get no reply** in HeadsetControl, except the Nova 7 Gen 2 sidetone read (`00 20`).
- **Wireless:** for every headset above, the PID is the dongle or base station. The dongle answers even when
  the headset is off. The status reply then flags "offline" (see the battery rows below).
- Whether `writeHID` is an output report (hid_write) or a feature report is set in HeadsetControl's
  `HIDDevice`, not read for this sheet (**unconfirmed**; very likely hid_write).

### Mice: rivalcfg layout

- Every command is sent as `00 <command bytes> <value bytes> <suffix bytes>` (`mouse.py` `_hid_write`).
- Output report (`hid_write`) for all current models. Rival 600 sends lighting and buttons as **feature**
  reports.
- rivalcfg waits 0.05 s after each write (`_command_approve_delay`).
- **Wireless (2.4 GHz):** same profile as wired, but the first command byte is OR'd with `0x40`, and every
  command reads back 64 bytes. Example: battery `0x92` becomes `0xD2`, save `0x11` becomes `0x51`.
- rivalcfg never reads settings back from the mouse; it keeps them in a local file. Only battery,
  firmware and the wireless readback are reads.
- Modern mice (Aerox, Rival 3/5, Prime Wireless) use command `0x2D` DPI, `0x2B` polling, `0x21` colors,
  `0x11 00` save. The wired Prime uses a separate set (`0x61`, `0x5D`, `0x62`, `0x59`). Rival 3 and
  Rival 600 use the older set (`0x03`/`0x0B`, `0x04`, `0x05`, `0x09 00`).
- libratbag's driver names four protocol versions (v1 32-byte, v2/v3/v4 64-byte) with their own command
  bytes. It covers older Rival/Sensei models; use it as a cross-check only.

### Keyboards: OpenRGB layout

- **Per-key color (Apex 7/Pro/5/9):** feature report, length 643 bytes (Apex 9: 513).
  `00 <id> <N> [keycode R G B] x N`. id = `0x3A` on Gen 1; `0x40` on 2023/Gen 3; `0x61` on the 2023/Gen 3
  wireless PIDs. At most 112 keys; keys are HID usage codes.
- **Gen 3 init:** if Pro TKL / 9 TKL / 9 Mini firmware is 1.19.7 or newer, send feature report `00 4B`
  (65 bytes) first.
- **Back to onboard lighting:** output report `00 3B` (Gen 1) or `00 41` (Gen 3), 65 bytes. OpenRGB sends it on close.
- **Brightness:** write `00 A3`, read reply `A3 00 <0-10>`; set with `00 23 <0-10>`. Output reports, 65 bytes.
- **Profile select:** feature `00 89 <profile>`. **Firmware:** id `0x90`; **serial:** `0xFF` (Gen 1), `0xF5`
  region read (Pro TKL Gen 3). The exact read bytes are in `SteelSeriesApexBaseController.cpp` (**not read**).
- **Apex 3 and other zone boards (8-zone controller):** output report `00 <0x21 + mode> FF [R G B] x zones`;
  brightness `00 23 <b>`; read brightness `00 A3` (reply `A3 <b>`). No save. Which zone controller each
  Apex 3 variant uses was not fully traced (**unconfirmed**).

## 3. Settings map

R = read, W = write. "Save" means HeadsetControl or rivalcfg follows the write with the family's save command.

### Headsets

| Setting | Bytes / command | R/W | Format | Models |
|---|---|---|---|---|
| Battery + charging | write `00 B0`, read 128 | R | byte 2 = level, byte 3 = status (`00` offline, `01`/`02` charging, else on battery) | Nova 7 |
| | same | R | level: 0-4 steps on 0x2202, 0x2206, 0x223A, 0x227A, 0x22A4; percent on the rest | Nova 7 |
| | same (status read) | R | byte 1 `01` = offline; byte 2 = 0-4; byte 3 `01` = charging | Arctis 7+ |
| | status read (request bytes **unconfirmed**) | R | min 16 bytes; byte 1 `02` = offline; byte 3 = percent; byte 4 `01` = charging | Nova 5 |
| | write `06 B0`, read 128 | R | byte 6 = 0-8 (map to %); byte 15: `01` offline, `02` charging | Nova Pro Wireless |
| | write `00 20`, read 12 | R | byte 3 = 0x64-0x9A (map to %); byte 4 `01` = charging | Arctis 9 |
| | write `06 18`, read 8 | R | byte 2 = percent; no charge flag | Arctis 7 (2017-19) |
| Sidetone | `00 39 <0-3>` | W | 4 levels | Nova 7, Arctis 7+ |
| | `00 20` then read; reply `20 ?? <0-3>` | R | byte 2 = level | Nova 7 Gen 2 (0x227E) only |
| | `00 39 <0x00-0x0A>` + save | W | 11 levels | Nova 5 |
| | `06 39 <0-3>` + save | W | 4 levels | Nova Pro |
| | `06 00 <0xC0-0xFD>` + save | W | `C0` = off, log curve | Arctis 9 |
| | `06 35 01 00 <0x00-0x12>`; off = `06 35` | W | 19 levels | Arctis 7 (2017-19) |
| Auto-off / inactive time | `00 A3 <minutes>` | W | 0-255 (7+ clamps to 90) | Nova 7, Arctis 7+, Nova 5 |
| | `06 C1 <step>` + save | W | 0 off, 1=1, 2=5, 3=10, 4=15, 5=30, 6=60 min | Nova Pro |
| | `04 00 <sec hi> <sec lo>` + save | W | seconds, big-endian | Arctis 9 |
| | `06 51 <minutes>` + save | W | 0-90 | Arctis 7 (2017-19) |
| ChatMix | status read (`00 B0`) | R | byte 4 = game 0-100, byte 5 = chat 0-100 | Nova 7, Arctis 7+ |
| | status read | R | byte 5 = game, byte 6 = chat (0-100) | Nova 5 |
| | `00 20`, read 12 | R | byte 9 = game 0-19, byte 10 = chat 0-19 | Arctis 9 |
| | `06 24`, read 8 | R | byte 2 = game, byte 3 = chat (191-255, 0 = full) | Arctis 7 (2017-19) |
| | not implemented | - | - | Nova Pro (**gap**) |
| EQ custom | `00 33 <10 bands> 00` | W | band = 0x14 + gain (source); -10..+10 dB, 0.5 steps (see note) | Nova 7 |
| | `00 33 <10 bands> 00` | W | band = 0x18 + 2 x gain; -12..+12 dB | Arctis 7+ |
| | `00 33` + 10 x 6 bytes | W | per band: freq u16 LE, flag, gain (20 + 2 x dB), Q x 1000 u16 LE | Nova 5 (also parametric: filter types 01-05) |
| | `06 2E 04` then `06 33 <10 bands>` | W | band = 0x14 + 2 x dB (0x00-0x28) | Nova Pro |
| EQ preset | sent as full band list (presets 0-3) | W | Flat, Bass, Focus, Smiley | Nova 7, Arctis 7+, Nova 5 |
| | `06 2E <0-3>` + save (4 = custom) | W | on-device preset | Nova Pro |
| Mic mute LED brightness | `00 AE <0-3>` | W | 4 levels | Nova 7 |
| | `00 AE <00/01/04/0A>` | W | 4 levels | Nova 5 |
| Mic volume | `00 37 <0-7>` | W | | Nova 7 |
| | `00 37 <0-15>` | W | | Nova 5 |
| Volume limiter | `00 3A <0/1>` | W | | Nova 7 |
| | `00 27 <0/1>` | W | | Nova 5 |
| Bluetooth on power-up | `00 B2 <0/1>` then `06 09` | W | | Nova 7 |
| Bluetooth call volume | `00 B3 <0-2>` | W | | Nova 7 |
| Lights | `06 BF <0x0A on / 0x01 off>` + save | W | | Nova Pro |
| | `06 55 01 <02 on / 00 off>` + save | W | | Arctis 7 (2017-19) |

Note: the Nova 7 file writes `0x14 + gain` per band, while the Nova Pro file writes `0x14 + 2 x gain` for
the same range. One of them is likely off by a factor of two (**unconfirmed**; test on the device).

### Mice

| Setting | Command | R/W | Format | Models |
|---|---|---|---|---|
| Battery + charging | `92` (wireless `D2`), read 2 (64 on dongle) | R | byte 1: bit 7 = charging; level = ((b1 & 0x7F) - 1) x 5 % | Aerox 3/5/9 Wireless, Prime Wireless |
| DPI presets | `2D <count> <selected> <code>...` | W | 1 byte per DPI, code from table `truemove_air` (100-18000 in 100s, e.g. 400=0x04, 800=0x09, 1600=0x12, 3200=0x26); up to 5; first preset 0 | Aerox 3W/5/9, Rival 5, Prime Wireless |
| | `2D ...` | W | 200-8500, table `truemove_core`; first preset 1 | Aerox 3 (wired) |
| | `0B 00 ...` | W | same layout, `truemove_core`, first preset 1 | Rival 3 |
| | `61 ...` | W | 2 bytes per DPI, 50-18000 step 50 -> 1-0x168; first preset 0 | Prime (wired) |
| | `03 00 <slot 1/2> <0x00-0x77> 00 42` | W | 100-12000 step 100 | Rival 600 |
| Polling rate | `2B <code>` | W | 125=03, 250=02, 500=01, 1000=00 | Aerox Wireless, Prime Wireless |
| | `2B <code>` | W | 125=04, 250=03, 500=02, 1000=01 | Aerox 3/5 wired, Rival 5 |
| | `04 00 <code>` | W | 125=04 ... 1000=01 | Rival 3, Rival 600 |
| | `5D <code>` | W | 125=04 ... 1000=01 | Prime (wired) |
| Sleep timer | `29 <3 bytes>` | W | minutes x 60000 (ms), 0-20 min, 0 = off; byte order: rivalcfg range handler (**check**) | Aerox Wireless, Prime Wireless |
| Dim timer | `23 0F 01 00 00 <3 bytes>` | W | seconds x 1000 (ms), 0-1200 s | Aerox Wireless, Prime Wireless |
| Zone color | `21 01 <zone 00/01/02> R G B` | W | | Aerox Wireless, Prime Wireless (zone 00) |
| | `21 <zone mask> ... R G B` (mask 01/02/04, padded) | W | | Aerox 3/5 wired |
| | `21 <mask lo> <mask hi> ...` | W | 10 zones | Rival 5 |
| | `05 00 <zone 1-4> R G B 64` | W | | Rival 3 |
| | `62 01 R G B ... FF` | W | | Prime (wired) |
| | feature `05 00` + 28-byte gradient header | W | 8 zones, gradients | Rival 600 |
| Light effect | `06 00 <00-06>` | W | rainbow-shift, breath fast/normal/slow, steady, rainbow-breath, disco | Rival 3 |
| | `22 FF` (wireless), `22 <mask>` (Aerox 3 wired) | W | rainbow | Aerox family |
| Brightness | `23 <0x00-0x64>` | W | 0-100 | Aerox 3 wired; Rival 5 (5 steps) |
| | `5F <2 bytes>` | W | 0-256 | Prime (wired) |
| Reactive color | `26 R G B` | W | | Aerox, Rival 5 |
| Default lighting | `27 <...>` | W | off / reactive / rainbow | Aerox, Rival 5, Prime Wireless |
| Button mapping | `2A` + 5-byte fields | W | disable 00, keyboard 51, media 61, DPI 30 | Aerox, Rival 5, Prime Wireless |
| Firmware version | `10 00`, read 2 | R | 2 raw bytes | Rival 3 |
| Save to flash | `11 00` (dongle `51 00`) | W | | Aerox, Rival 5, Prime Wireless |
| | `09 00` / `59` | W | | Rival 3, Rival 600 / Prime (wired) |

### Keyboards

| Setting | Command | R/W | Format | Models |
|---|---|---|---|---|
| Per-key color (live) | feature `00 3A`/`40`/`61` `<N>` [key R G B] | W | see section 2 | Apex Pro, 7, 5, 9 |
| Return to onboard | `00 3B` / `00 41` | W | | same |
| Brightness | `00 A3` read; `00 23 <0-10>` write | R/W | | same; zone boards also use `00 23` / `00 A3` |
| Profile select | feature `00 89 <n>` | W | | Apex family |
| Firmware version | id `0x90` | R | string, "major.minor.patch" after 4 chars | Pro TKL, 9 TKL, 9 Mini |
| Zone color | `00 <21+mode> FF [R G B]` | W | | Apex 3 family (**unconfirmed** per model) |
| OmniPoint actuation (Apex Pro) | not found in any open source | - | - | **gap** |

## 4. Read-only first, then writes

**Safe reads to build first:**
1. Headset status (`00 B0` / `06 B0` / `00 20` / `06 18`): battery, charging, offline, ChatMix.
2. Mouse battery (`92` / `D2`) on wireless mice. Replies are 2 bytes wired, 64 on the dongle.
3. Keyboard brightness (`00 A3`) and firmware version (id `0x90`).
4. Nova 7 Gen 2 sidetone read (`00 20`).

**Writes, in rising risk:**
- Low (volatile, reversible): sidetone, mic LED, mic volume, live per-key color, brightness.
- Medium (persists): any write followed by a save. HeadsetControl saves after nearly every Nova 5,
  Arctis 7+, Nova Pro and Arctis 9 write. Mouse `11 00` writes all settings to the mouse's flash. Do not
  save on every slider move; save once when the user commits a change.
- Medium: Nova Pro custom EQ selects preset 4 *before* it checks the band values, so a bad value can leave
  the base on an empty custom preset. Validate first.
- Medium: keyboard per-key mode takes over lighting until `00 3B` / `00 41` is sent; send it on exit or crash.
- High, never: firmware update. No source documents it; SteelSeries GG does it. Unknown command ids on the
  mouse (`0x2D`-`0x92` range) or keyboard (`0x4B`, `0xF5`) could reach bootloader or calibration functions.
  Send only the ids listed here.
- Rivalcfg cannot read mouse settings back, so DeviceHub must keep its own copy of the last values it wrote
  and cannot show what GG set.

## 5. What DeviceHub would build

Suggested adapter order, each a separate module behind one `steelseries` adapter keyed on PID:

| Step | Adapter piece | Kind | Effort | Risk |
|---|---|---|---|---|
| 1 | PID table + interface pick (iface and usage page 0xFFC0 per row above) | all | small | low |
| 2 | Nova headset status reader (`00 B0`, skip async `B0`, parse per model) | read | small | low |
| 3 | Nova writes: sidetone, inactive time, mic LED, volume limiter, EQ presets/custom, then save | write | medium | low-medium |
| 4 | Nova Pro (`06` family): battery, sidetone, inactive, lights, EQ | read/write | small | medium (EQ order) |
| 5 | Wireless mouse battery (`92` / `0x40` flag on dongle) | read | small | low |
| 6 | Mouse DPI / polling / sleep / dim / colors (modern `0x2D` set), save on commit | write | medium | medium |
| 7 | Older mice (Rival 3, Rival 600, Prime wired) as per-model command tables | write | small each | medium |
| 8 | Apex brightness read/write, then per-key live color with onboard restore | read/write | medium | medium |
| 9 | Apex 3 zone color | write | small | medium (unconfirmed) |
| 10 | Arctis 9 / Arctis 7 (2017-19) | read/write | small | low (old, fewer users) |

The C# helper needs: open by VID/PID + interface number (and usage page where two collections share an
interface), 64-byte output writes with report id 0, feature report writes up to 643 bytes, timed reads
(200 ms is what rivalcfg uses), and a 50 ms gap between mouse writes.

Overall: medium effort, low risk for headsets and battery; medium for mice and keyboards because settings
cannot be read back and saves are persistent.

## 6. Gaps and unknowns

- **Apex Pro OmniPoint actuation:** no open project documents it. Needs a USB capture of SteelSeries GG.
- **Nova Pro Wireless:** ChatMix, ANC/transparency, OLED and the second-device (USB 2) controls are not in
  HeadsetControl. Battery of the spare battery in the base: not mapped.
- **Nova 5 status request bytes:** the parse is in the source, the request is not shown (likely `00 B0`).
- **Arctis 7+ base class:** assumed to share the Nova `00 B0` status read; not confirmed.
- **Nova 7 vs Nova Pro EQ scale** differs by 2x for the same range (see section 3 note).
- **Report type of HeadsetControl writes** (output vs feature): not read.
- **DPI sleep/dim byte order** (3-byte values): from rivalcfg's range handler, not read.
- **Newer models with no source:** Aerox 3 Gen 2 (OpenRGB has a PID only), Rival 3 Gen 2 (rivalcfg has a
  file, not mapped), Arctis Nova 7 Gen 2 beyond sidetone, Apex Pro Mini, Apex Pro Gen 3 full size (0x1640).
- **Rival 3 Wireless, Rival 650, Sensei:** files exist in rivalcfg; not mapped here.
- **Mouse settings read-back:** no source reads DPI or lighting from a mouse.
- **Firmware update** protocol: unknown; stay away.

## Sources

- HeadsetControl, shared protocol: [lib/devices/protocols/steelseries_protocol.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/protocols/steelseries_protocol.hpp)
- HeadsetControl, Arctis Nova 7: [lib/devices/steelseries_arctis_nova_7.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_nova_7.hpp)
- HeadsetControl, Nova Pro Wireless: [lib/devices/steelseries_arctis_nova_pro_wireless.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_nova_pro_wireless.hpp)
- HeadsetControl, Arctis 7+: [lib/devices/steelseries_arctis_7_plus.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_7_plus.hpp)
- HeadsetControl, Arctis Nova 5: [lib/devices/steelseries_arctis_nova_5.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_nova_5.hpp)
- HeadsetControl, Arctis 9: [lib/devices/steelseries_arctis_9.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_9.hpp)
- HeadsetControl, Arctis 7 (older): [lib/devices/steelseries_arctis_7.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/steelseries_arctis_7.hpp)
- rivalcfg, write/read path: [rivalcfg/mouse.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/mouse.py)
- rivalcfg, DPI layout: [rivalcfg/handlers/multidpi_range_choice.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/handlers/multidpi_range_choice.py)
- rivalcfg, DPI codes: [rivalcfg/devices/dpi/truemove_air.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/dpi/truemove_air.py)
- rivalcfg mice: [aerox3.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox3.py),
  [aerox3_wireless_wired.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox3_wireless_wired.py),
  [aerox3_wireless_wireless.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox3_wireless_wireless.py),
  [aerox5.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox5.py),
  [aerox5_wireless_wired.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox5_wireless_wired.py),
  [aerox5_wireless_wireless.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox5_wireless_wireless.py),
  [aerox9_wireless_wired.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox9_wireless_wired.py),
  [aerox9_wireless_wireless.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/aerox9_wireless_wireless.py),
  [rival3.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/rival3.py),
  [rival5.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/rival5.py),
  [rival600.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/rival600.py),
  [prime.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/prime.py),
  [prime_wireless_wired.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/prime_wireless_wired.py),
  [prime_wireless_wireless.py](https://github.com/flozz/rivalcfg/blob/master/rivalcfg/devices/prime_wireless_wireless.py)
- OpenRGB, PIDs: [SteelSeriesDevices.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SteelSeriesController/SteelSeriesDevices.h)
- OpenRGB, interfaces: [SteelSeriesControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SteelSeriesController/SteelSeriesControllerDetect.cpp)
- OpenRGB, Apex constants: [SteelSeriesApexBaseController.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SteelSeriesController/SteelSeriesApexBaseController.h)
- OpenRGB, Apex per-key: [SteelSeriesApexController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SteelSeriesController/SteelSeriesApexController/SteelSeriesApexController.cpp)
- OpenRGB, zone keyboards: [SteelSeriesApex8ZoneController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SteelSeriesController/SteelSeriesApex8ZoneController/SteelSeriesApex8ZoneController.cpp)
- libratbag, protocol versions: [src/driver-steelseries.c](https://github.com/libratbag/libratbag/blob/master/src/driver-steelseries.c)
- Actuation search (nothing found): [AstroSnail/apexctl](https://github.com/AstroSnail/apexctl), [daiyam/steelkeys](https://github.com/daiyam/steelkeys)
