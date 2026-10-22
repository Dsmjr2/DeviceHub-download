# HyperX: bare mapping

Researched 2026-10-22 from public source code. Two vendor ids: `0951` (Kingston, before 2021) and `03f0` (HP, after
HP bought HyperX). Many models exist under both, with different product ids. This is a map for a later developer with
the real device in hand, not a tested spec. Every id has a source in the last section; anything marked
**unconfirmed** was not found in a source and must be measured read-only first.

Short names used below:
- **HSC** = HeadsetControl (C++, `lib/devices/hyperx_*.hpp`).
- **HH** = HyperHeadset by LennardKittner (Rust, `src/devices/*.rs`; repo was first named HyperXCloudIIWireless).
- **ORGB** = OpenRGB (C++, `Controllers/HyperX*Controller/`).
- **ratbag** = libratbag. It has **no** HyperX device files; nothing below comes from it.

## 1. Most common current models

### Headsets

| Model | Vendor:product | Protocol family (section 2) | Source |
|---|---|---|---|
| Cloud III Wireless | `03f0:05b7`, `03f0:0c9d` (HH calls both "possible") | **66** | HH cloud_iii_wireless.rs |
| Cloud III S Wireless | `03f0:06be`, `03f0:02cc` | **0C** (newer, report-id framed) | HH cloud_iii_s_wireless.rs |
| Cloud III (wired) | `03f0:089d`, `03f0:03cc` ("Cloud 3 Wired 2026") | feature report `20` (sidetone only) | HSC hyperx_cloud_3.hpp |
| Cloud Alpha Wireless | `03f0:098d` (HSC, HH); HH also `03f0:1743`, `03f0:1765` | **21 BB** | HSC, HH cloud_alpha_wireless.rs |
| Cloud II Wireless (HP) | `03f0:0696`, `03f0:018b` (newer dongle); HH also `03f0:0d93` | **06 FF BB** | HSC hyperx_cloud_2_wireless.hpp, HH cloud_ii_wireless_dts.rs |
| Cloud II Wireless (Kingston) | `0951:1718`; HH also `0951:0b92`, `0951:16ea`, `0951:16eb` (some may be Cloud Flight S) | **06 ... BB** (long Kingston header) | HSC hyperx_cloud_2_wireless_kingston.hpp, HH cloud_ii_wireless.rs |
| Cloud II Core Wireless (and similar) | `03f0:069f`, `03f0:0995` | **66** (with extras) | HH cloud_ii_core_wireless.rs |
| Cloud Flight Wireless | `0951:16c4` (old), `0951:1723` (new); HH also `0951:1749`, `03f0:0e90` | **21 FF** (battery only) | HSC hyperx_cloud_flight.hpp, HH cloud_flight_wireless.rs |
| Cloud Stinger 2 Wireless | **unconfirmed**. HH's README lists it as supported but no file names its id | probably one of HH's families | HH README |
| Cloud Stinger (wired, 3.5 mm/USB) | **not found** in any open project | unknown | none |

Notes:
- HH's udev rules list 19 ids in all: `03f0` `018b 0696 0d93 05b7 06be 0c9d 098d 1765 1743 069f 0995 02cc 0e90`, and `0951` `1718 16ea 16eb 1749 16c4 1723`. The Stinger 2 Wireless id is probably in that list; which one is **unconfirmed**.
- HSC's README lists five HyperX entries: Cloud Alpha Wireless, Cloud Flight Wireless, Cloud II Wireless, Cloud II Wireless (Kingston), Cloud 3. No Cloud III Wireless and no Stinger.
- A low-quality web summary names `06B7` as a Cloud III Wireless headset id and `05B7` as its dongle. Only `05b7` is backed by source (HH).

### Mice

| Model | Vendor:product | Interface / usage page | Source |
|---|---|---|---|
| Pulsefire Haste (original, wired) | `0951:1727`, `03f0:0f8f` | interface 3, page `FF90` (Windows) | ORGB HyperXMouseControllerDetect.cpp |
| Pulsefire Haste 2 / Haste 2 Wireless | **not found** in ORGB, ratbag or HH | unknown | none |
| Pulsefire Dart (wireless dongle) | `0951:16e1`, `03f0:068e` | interface 2, page `FF00` | ORGB |
| Pulsefire Dart (on its cable) | `0951:16e2`, `03f0:088e` | interface 1, page `FF13` | ORGB |
| Pulsefire FPS Pro | `0951:16d7` | interface 1, page `FF01` | ORGB |
| Pulsefire Core (same driver as FPS Pro) | `0951:16de`, `03f0:0d8f` | interface 1, page `FF01` | ORGB |
| Pulsefire Surge | `0951:16d3`, `03f0:0490` | interface 1, page `FF01` | ORGB |
| Pulsefire Raid | `0951:16e4` | interface 1, page `FF01`, usage `01` | ORGB |

### Keyboards

| Model | Vendor:product | Interface | Source |
|---|---|---|---|
| Alloy Origins 60 | `0951:1734`, `03f0:0c8e` | 3 on Windows (0 elsewhere) | ORGB HyperXAlloyOrigins60and65ControllerDetect.cpp |
| Alloy Origins 65 | `03f0:038f` | 3 on Windows | same |
| Alloy Origins Core | `0951:16e6`, `03f0:098f` | 2 | ORGB HyperXAlloyOriginsCoreControllerDetect.cpp |
| Alloy Origins (full size) | `0951:16e5`, `03f0:0591` | 3 (HP id also page `FF90`) on Windows | ORGB HyperXAlloyOriginsControllerDetect.cpp |
| Origins 2 65 | `03f0:0cc2` | 3 | ORGB HyperXOrigins2_65ControllerDetect.cpp |
| Alloy Rise / Rise 75 | **not found** in any open project | unknown | none |

ORGB also has Alloy Elite, Elite 2, FPS and an Eve 1800 controller (older or niche models, not mapped here).

## 2. How they talk

HyperX has no single protocol. Each headset generation has its own frame. All are vendor HID reports on the
dongle (or the cable), not USB audio controls. Interfaces and usage pages are named only where a source names them.

### Headset frame families

| Family | Models | Frame (bytes 0..) | Length | Reply |
|---|---|---|---|---|
| **21 BB** | Cloud Alpha Wireless | `21 BB <cmd> <value>` | 31 (HSC) or 64 (HH) | byte 0-1 echo `21 BB`; byte 2 = cmd or a reply code; byte 3 = value |
| **06 FF BB** | Cloud II Wireless (HP) | `06 FF BB <cmd> <value>` | 52 write / 20 read (HSC); 20 (HH) | byte 0-3 echo `06 FF BB <cmd>`; byte 4 = value; battery % at byte 7 |
| **06 Kingston** | Cloud II Wireless (Kingston) | `06 00 02 00 9A 00 00 68 4A 8E 0A 00 00 00 BB <cmd> <value>` | 62 write / 64 read | byte 0 = `0B`, byte 2 = `BB`, byte 3 = cmd, byte 4 = value; battery at byte 7 |
| **66** | Cloud III Wireless, Cloud II Core Wireless | `66 <cmd> <value>` | 62 (III) / 64 (II Core) | byte 0 = `66`, byte 1 = cmd or notice code, byte 2 = value |
| **0C** | Cloud III S Wireless | `0C 02 03 <01 get / 00 set> 00 <cmd> ...` | 64 | report `0C` reply, value at byte 6 (`FF` = invalid); report `0D` notice (type byte 4, value byte 5); report `05` mic state |
| **21 FF** | Cloud Flight | `21 FF 05` (battery) | 20 (HSC) / 64 (HH) | reply `21 FF 05 HI LO` = battery voltage; `64 01`/`64 03` = connected; `65 04` = muted |
| **feature 20** | Cloud III (wired) | feature report `20 86 <0/1>` | 62 | none read |

Details per family:
- **Cloud II Wireless (HP):** HSC opens usage page `FF90`, usage `0303`, interface `0`. Write timeout 100 ms, read timeout 1000 ms. This is the only headset with a source-named usage page.
- **Cloud II Wireless (Kingston):** before each command HSC and HH read input report `06` once ("prepare"), then write, then sleep 100 ms. Sidetone is fire-and-forget (no reply read).
- **Cloud III Wireless (66):** HH reads the same codes both as replies to a get (`0x8x`) and as unsolicited notices (`0x0x`): mute `86`/`0A`, connected `82`/`0B`, charging `8A`/`0C`, battery `89`/`0D`. So the dongle pushes state changes.
- **Cloud III S Wireless (0C):** the only family with real report ids on both sides. Auto-off is sent as seconds, big-endian, in bytes 6-7.
- **Report id vs first byte:** HSC and HH write the first byte as part of the buffer, so `21`, `06`, `66`, `0C` act as the HID report id. Whether the Windows descriptor declares them as report ids is **unconfirmed**.

### Output vs feature reports (Windows)

- Headsets: plain output writes (`hid_write`) in HSC and HH, except the wired Cloud III, which uses a **feature report**.
- HH on Windows falls back to a feature report when an output write fails with "Incorrect function" (error 1). So some
  headset collections on Windows only accept feature reports. Which ones is **unconfirmed**.
- HH waits 50 ms after each write before reading, and reads with a 1 s timeout.

### Mice and keyboards (lighting only, from ORGB)

| Device | Transport | Length | Frame |
|---|---|---|---|
| Pulsefire Haste | **feature report**, report id `00` | 65 | setup `00 04 F2 00 00 00 00 00 02`; color `00 81 R G B 00 00 00 02` (one color) |
| Pulsefire Dart | output write, report id `00` | 65 | direct `00 D2 <led> <mode> 08 R G B R G B <bright> <speed>`; save to memory `00 DE FF` |
| Pulsefire FPS Pro / Core | **feature report**, report id `07` | 264 | `07 0A R G B 00 00 00 A0` |
| Alloy Origins 60 / 65 | **feature report**, report id `00` | 65 | init `00 04 F2 .. (byte 9 = 05)`; then 5 color packets, 16 keys each as `81 R G B` |
| Alloy Origins Core | output write, report id `00` | 65 | variant query `00 10`, read 65 back (layout at byte 56); brightness `00 A7 00 00 01 <b>`; colors in chunks `00 A2 <seq> 00 <len> <60 bytes>`, 380 bytes total, planar G/R/B layout |
| Origins 2 65 | output write | 65 | init `44 01 04 00`; then 4 color packets `44 02 <seq> 00` + 20 keys as `R G B` |

Dart LED ids: logo `00`, scroll `10`, all `20`. Dart modes: static `00`, cycle `12`, breathing `20`, reactive `30`.
Dart brightness `00`-`64`; speed `64` (slow) to `00` (fast).

### Wired vs dongle

- Wireless headsets: the PC sees only the dongle id. The dongle answers for the headset. Sources show no endpoint or
  slot byte like Corsair's; one dongle = one headset.
- "Connection status" commands exist per family (below). A headset that is off still has a dongle that answers.
- Dart: dongle (`16e1`/`068e`) and cable (`16e2`/`088e`) are different ids with different interfaces and usage pages.
- HH notes the Cloud II Wireless (HP) wireless-status get `01` is disabled because it unmutes the headset. Avoid it.

## 3. Settings map

R = read, W = write. Command bytes are the byte after the family header. "Value" is where the source reads the answer.

| Setting | Command | R/W | Format | Models (source) |
|---|---|---|---|---|
| Battery % | `0B` | R | byte 3 = percent (reply code `25` also seen) | Alpha Wireless (HSC, HH) |
| Battery % | `02` | R | byte 7 = percent; bytes 5-6 = millivolts BE (HSC) | Cloud II Wireless HP (HSC, HH) and Kingston (byte 7, no voltage) |
| Battery % | `89` | R + notice `0D` | byte 4 = percent, valid only if byte 2 or 3 nonzero | Cloud III Wireless, II Core (HH) |
| Battery % | `06` | R + notice `01` | byte 6 | Cloud III S (HH) |
| Battery voltage | `21 FF 05` | R | bytes 3-4 = millivolts BE; > `100B` (4107 mV) = charging; HSC and HH each convert to % with their own curve | Cloud Flight (HSC, HH) |
| Charging | `0C` | R | byte 3 = `01` charging (reply code `26`) | Alpha Wireless |
| Charging | `03` | R | byte 4 = `01` charging | Cloud II Wireless HP and Kingston |
| Charging | `8A` | R + notice `0C` | byte 2; value meanings **unconfirmed** | Cloud III Wireless, II Core |
| Charging | `48` | R + notice `0A` | byte 6; meanings **unconfirmed** | Cloud III S |
| Connected | `03` | R | Alpha: HSC says byte 3 `01` = offline; HH says `02` = connected (reply `24`). **Conflict; measure** | Alpha Wireless |
| Connected | `82` | R + notice `0B` | byte 2 = `1` | Cloud III Wireless, II Core |
| Connected | Kingston cmd `01` | R | byte 4 = `1` or `4` connected, `2` pairing | Cloud II Kingston (HH) |
| Sidetone on/off | `10` set, `05` get | R/W | 0/1 | Alpha Wireless (HSC, HH) |
| Sidetone level | `11` set, `06` get | R/W | HSC range 0-128; HH marks the byte "correct?" | Alpha Wireless |
| Sidetone on/off | `21` set, `06` get | R/W | 0/1 | Cloud II Wireless HP (HH only; HSC has none) |
| Sidetone level | `23` set, `0B` get | R/W | raw byte | Cloud II Wireless HP (HH) |
| Sidetone on/off | `19` | W | 0/1 only (no level) | Cloud II Kingston (HSC, HH) |
| Sidetone on/off | `01` set, `84` get | R/W | 0/1 | Cloud III Wireless, II Core |
| Sidetone level | `05` set, `88` get | R/W | III: raw byte; II Core: -5..5 signed (`FF` = -1) | Cloud III Wireless, II Core |
| Sidetone | `0D` set, `16` get | R/W | format **unconfirmed** | Cloud III S |
| Sidetone (wired) | feature `20 86 <0/1>` | W | on/off only | Cloud III wired (HSC) |
| Auto-off | `12` set, `07` get | R/W | minutes, 0-255 (0 = never, **unconfirmed**) | Alpha Wireless |
| Auto-off | `22` set, `07` get | R/W | minutes, 0-255; reply byte 4 | Cloud II Wireless HP |
| Auto-off | `18` set, `1A` get | R/W | minutes, HSC caps at 30 | Cloud II Kingston |
| Auto-off | `02` set, `85` get | R/W | minutes | Cloud III Wireless, II Core |
| Auto-off | `4A` set (bytes 6-7 seconds BE), `4B` get | R/W | seconds; HH comment says 10/20/30 min presets; code and comment disagree | Cloud III S |
| Mic mute | `15` set, `0A` get | R/W + notice `23` | 0/1 | Alpha Wireless (HH) |
| Mic mute | `20` set, `05` get | R/W | 0/1 | Cloud II Wireless HP (HH) |
| Mic mute | `03` set, `86` get | R/W + notice `0A` | 0/1 | Cloud III Wireless, II Core |
| Mic mute | `01` set, `04` get, notice `03`; report `05` bit `02` | R/W | 0/1 | Cloud III S |
| Mic mute (notice) | input `65 04` | R | `04` = muted | Cloud Flight (HH) |
| Mic plugged in | `08` | R | 1 = boom mic attached | Alpha, Cloud II HP; II Core `8C` |
| Mic monitor | none found | | | no source; HyperX uses "sidetone" for this |
| Voice prompts | `13` set, `09` get | R/W | 0/1 | Alpha Wireless (HSC, HH) |
| Voice prompts | `0B` set, `14` get | R/W | 0/1 | Cloud III S (HH) |
| Silent mode (playback mute) | `04` set, `87` get | R/W | 0/1 | Cloud III Wireless, II Core |
| Noise gate | `0F` set, `8D` get | R/W | 0/1 | II Core (HH) |
| Product color | `0E` / `8F` / `4D` | R | color code; mapping **unconfirmed** | Alpha / III / III S |
| Equalizer | `5F` in the 0C frame | W | byte 6 band 0-9, bytes 7-8 dB x100 signed BE, +-1200 | Cloud III S (HH) |
| Firmware | Kingston cmd `11` | R | bytes 4-7 = four numbers | Cloud II Kingston (HH) |
| Mouse lights | see section 2 | W | one color (Haste, FPS Pro); per LED with mode (Dart) | ORGB |
| Mouse DPI / polling | **none found** | | | no open source |
| Mouse battery | **none found** | | | no open source (Dart, Haste 2 Wireless) |
| Keyboard lights | see section 2 | W | per key | Origins 60/65, Core, Origins 2 65 (ORGB) |
| Keyboard brightness | `A7`, byte 5 | W | range **unconfirmed** | Alloy Origins Core (ORGB) |

## 4. Read-only first, then writes

Safe to read first (get only, no state change):
- Alpha: `0B`, `0C`, `05`, `06`, `07`, `08`, `09`, `0A`. Leave `03` until the offline/online conflict is settled by a
  read with the headset on and off.
- Cloud II HP: `02`, `03`, `05`, `06`, `07`, `08`, `0B`. **Never `01`** (HH: it unmutes the headset).
- Cloud II Kingston: `02`, `03`, `1A`.
- Cloud III Wireless / II Core: every `0x8x` get. Then just listen; the dongle sends notices.
- Cloud III S: gets with byte 3 = `01`.
- Cloud Flight: `21 FF 05`, and listen for `64`/`65` notices.
- Alloy Origins Core variant query `10` is a read (write then read back).

Before any write: read the current value, keep it, write, read back, restore on mismatch.
Writes that change only a setting:
- Sidetone on/off and level, auto-off minutes, mic mute, voice prompts, silent mode.
- Lighting in "direct" mode on mice and keyboards (ORGB style). It does not persist unless a save command is sent.

Never (or not until proven with a backup):
- **Dart save `DE FF`**: writes to on-board memory.
- **Cloud III Wireless SIRK reset `1E`** and SIRK read `83`: SIRK is the pairing key. A reset can break pairing.
- Any command not in this table. HyperX frames have no "not supported" status; an unknown byte may do anything.
- Firmware paths: none mapped, none to be built.
- Running beside NGENUITY. It talks on the same interfaces. Step back while `NGENUITY` runs (process name **unconfirmed**).

## 5. What DeviceHub would build

### A "HyperX headset" adapter

1. **`hyperx-hid.js` (transport).** Opens a collection by vid/pid (and usage page `FF90`/`0303` where known).
   Writes a zero-padded buffer of the family's length. Tries an output report first; on "Incorrect function" falls back
   to a **feature report** (HH does this on Windows). Waits 50 ms, then reads with a 1 s timeout. Keeps a listener for
   unsolicited notices (66, 0C, 21 FF families). The C# helper needs both `WriteFile` and `HidD_SetFeature` paths.
2. **`hyperx-families.js` (codecs).** One small codec per family: `21BB`, `06FFBB`, `06Kingston`, `66`, `0C`, `21FF`,
   `feature20`. Each maps setting names to get/set bytes and parses replies and notices.
3. **`hyperx-models.js` (table).** One row per vid:pid: model name, family, report length, interface/usage page, which
   settings are readable/writable, and ranges.
4. **Lighting stays with OpenRGB.** DeviceHub already talks to OpenRGB. ORGB covers the mice and keyboards above. A
   direct path adds nothing until DPI or battery is known, and no source has them.

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Transport with output/feature fallback, notice listener | 1 day | low |
| 2 | Cloud III Wireless (66): battery, charging, connected, mute, read-only | 0.5 day with the device | low |
| 3 | Same: sidetone on/level, auto-off, silent mode writes | 0.5 day | low-medium (level range unknown) |
| 4 | Alpha Wireless (21 BB): read all; then sidetone, auto-off, voice prompts | 1 day | low (two sources agree on most bytes) |
| 5 | Cloud II Wireless HP and Kingston: battery, charging, auto-off; sidetone | 1 day | low; avoid cmd `01` on HP |
| 6 | Cloud III S (0C), II Core (66 + extras), Flight (battery from voltage) | 0.5-1 day each | medium (single source, HH) |
| 7 | Stinger 2 Wireless: find its id, guess family from HH's list, read-only probe | 0.5 day | medium |
| 8 | Mice/keyboards beyond OpenRGB lights (DPI, polling, battery) | unknown | high: needs USB capture of NGENUITY; no source |

Feature reports: needed for the wired Cloud III, the Haste, the FPS Pro/Core and the Origins 60/65, and as a fallback
for wireless headsets on Windows. Plan for both paths from the start.

## 6. Gaps and unknowns

- **Cloud Stinger 2 Wireless:** HH claims support but no file names its id. One of `03f0:0d93`, `069f`, `0995` is likely; measure.
- **Cloud Stinger (wired) and Stinger Core:** not found anywhere. Treat as plain Windows audio.
- **Pulsefire Haste 2 / Haste 2 Wireless / Haste 2 Mini:** no ids or protocol in ORGB, ratbag or HH. SignalRGB supports
  it (closed source). Needs a USB capture.
- **Alloy Rise / Rise 75:** not found in any open project.
- **Mouse DPI, polling rate and battery:** no open source sends them for any HyperX mouse.
- **Charging value meanings** in the 66 and 0C families (`ChargingStatus::from` mapping not read).
- **Alpha Wireless connected byte:** HSC says `01` = offline; HH says `02` = connected. Both may be right (0/1/2 states).
- **Sidetone level ranges:** Alpha 0-128 per HSC; others raw or -5..5. HH marks the Alpha level byte as uncertain.
- **Cloud II Wireless HP packet size:** HSC writes 52 bytes, HH 20. Both work for their authors; length may not matter.
- **Report ids on Windows:** which collections take output reports and which only feature reports is unconfirmed.
- **Cloud III Wireless ids:** HH calls `05b7` and `0c9d` "possible". A web summary names `06B7` for the headset itself.
- **Auto-off "never":** whether 0 minutes means never is unconfirmed for every family.
- **Cloud Flight battery curve:** HSC and HH convert voltage to percent differently; pick one and label it an estimate.
- **NGENUITY coexistence:** whether both can share the dongle safely is unknown.

## Sources

- [HeadsetControl lib/devices (file list)](https://github.com/Sapd/HeadsetControl/tree/master/lib/devices)
- [HeadsetControl hyperx_cloud_alpha_wireless.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/hyperx_cloud_alpha_wireless.hpp)
- [HeadsetControl hyperx_cloud_2_wireless.hpp (HP)](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/hyperx_cloud_2_wireless.hpp)
- [HeadsetControl hyperx_cloud_2_wireless_kingston.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/hyperx_cloud_2_wireless_kingston.hpp)
- [HeadsetControl hyperx_cloud_3.hpp (wired Cloud III)](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/hyperx_cloud_3.hpp)
- [HeadsetControl hyperx_cloud_flight.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/hyperx_cloud_flight.hpp)
- [HeadsetControl README (supported devices)](https://github.com/Sapd/HeadsetControl/blob/master/README.md)
- [HyperHeadset README and udev rules](https://github.com/LennardKittner/HyperHeadset)
- [HyperHeadset cloud_iii_wireless.rs](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_iii_wireless.rs)
- [HyperHeadset cloud_iii_s_wireless.rs](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_iii_s_wireless.rs)
- [HyperHeadset cloud_alpha_wireless.rs](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_alpha_wireless.rs)
- [HyperHeadset cloud_ii_wireless_dts.rs (Cloud II Wireless HP)](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_ii_wireless_dts.rs)
- [HyperHeadset cloud_ii_wireless.rs (Kingston)](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_ii_wireless.rs)
- [HyperHeadset cloud_ii_core_wireless.rs](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_ii_core_wireless.rs)
- [HyperHeadset cloud_flight_wireless.rs](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/cloud_flight_wireless.rs)
- [HyperHeadset mod.rs (timeouts, Windows feature-report fallback)](https://github.com/LennardKittner/HyperHeadset/blob/main/src/devices/mod.rs)
- [OpenRGB HyperXMouseControllerDetect.cpp (mouse ids)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXMouseControllerDetect.cpp)
- [OpenRGB HyperXPulsefireHasteController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireHasteController/HyperXPulsefireHasteController.cpp) and [.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireHasteController/HyperXPulsefireHasteController.h)
- [OpenRGB HyperXPulsefireDartController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireDartController/HyperXPulsefireDartController.cpp) and [.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireDartController/HyperXPulsefireDartController.h)
- [OpenRGB HyperXPulsefireFPSProController.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireFPSProController/HyperXPulsefireFPSProController.cpp) and [.h](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXMouseController/HyperXPulsefireFPSProController/HyperXPulsefireFPSProController.h)
- [OpenRGB HyperXAlloyOrigins60and65ControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXAlloyOrigins60and65Controller/HyperXAlloyOrigins60and65ControllerDetect.cpp) and [Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXAlloyOrigins60and65Controller/HyperXAlloyOrigins60and65Controller.cpp)
- [OpenRGB HyperXAlloyOriginsCoreControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXAlloyOriginsCoreController/HyperXAlloyOriginsCoreControllerDetect.cpp) and [Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXAlloyOriginsCoreController/HyperXAlloyOriginsCoreController.cpp)
- [OpenRGB HyperXAlloyOriginsControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXAlloyOriginsController/HyperXAlloyOriginsControllerDetect.cpp)
- [OpenRGB HyperXOrigins2_65ControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXOrigins2_65Controller/HyperXOrigins2_65ControllerDetect.cpp) and [Controller.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/HyperXKeyboardController/HyperXOrigins2_65Controller/HyperXOrigins2_65Controller.cpp)
- [libratbag data/devices (no HyperX files)](https://github.com/libratbag/libratbag/tree/master/data/devices)
- [SignalRGB forum: Haste 2 Wireless support (closed source, no ids)](https://forum.signalrgb.com/t/hyperx-haste-2-wireless-not-found-driver/1936)
