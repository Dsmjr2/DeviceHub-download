# ASUS ROG: bare mapping

Researched 2026-10-22 from public source code only. Vendor id `0b05` for everything below.
This is a map for a later developer with the real device in hand, not a tested spec. Every id has a source in the
last section; anything marked **unconfirmed** was not found in a source and must be measured read-only first.

Short names used below:
- **GH** = G-Helper (C#, Windows, HidSharp; `app/Peripherals/`). The richest source: mice, keyboards and headsets, on Windows.
- **LR** = libratbag (C, `src/asus.c`, `src/driver-asus.c`, `data/devices/asus-*.device`).
- **ORGB** = OpenRGB (C++, `Controllers/AsusAuraUSBController/`). Lighting only.
- **DB** = third-party Windows driver databases (Treexy, DriverMax). Ids only; weakest source.

asusctl / rog-control-center target ROG laptops (fans, keyboard backlight, AniMe matrix) and are out of scope.
HeadsetControl supports no ASUS or ROG headset.

## 1. Most common current models

"Omni" means the ROG Omni receiver, product id `1ACE`. Every mouse and keyboard paired to it shows that one id
(LR issue #1793, GH). "Own dongle" means the older model-specific 2.4 GHz receiver.

### Mice

| Model | Cable id | Own dongle id | Omni (pair-list id) | Bluetooth id | Source |
|---|---|---|---|---|---|
| Harpe Ace Aim Lab Edition (the "Harpe Ace") | `1A92` | `1A94` | `1ACE` (`1A94`) | | GH HarpeAceAimLab.cs; LR harpe-wireless (`1A92` only, named "Harpe Wireless") |
| Harpe Ace Extreme | `1B67` | | `1ACE` (`1B68`, `1B69`) | | GH |
| Harpe Ace Mini | **unconfirmed** | | `1ACE` (`1B65`) | | GH PeripheralsProvider.cs |
| Harpe II Ace (8K) | `1C69` | `1AD0` (also Harpe II Extreme Edition 2.0; told apart by product name) | | | GH HarpeIIAce.cs |
| Keris Wireless AimPoint | `1A66` | `1A68` | `1ACE` (`1A68`, `1A6A`) | `1A6A` | GH; LR; ORGB |
| Keris Wireless (original) | `195E` | `1960` | | `1962` | LR; ORGB |
| Keris (wired) | `195C` | | | | ORGB |
| Gladius III | `197B` | | | | GH; ORGB |
| Gladius III Wireless | `197D` | `197F` | | `1981` | GH; ORGB |
| Gladius III Wireless AimPoint | `1A70` | `1A72` | `1ACE` (`1A72`) | `1A74` | GH; ORGB |
| Gladius III Core | `1C8D` | | | | ORGB |
| Chakram X | `1A18` | `1A1A` | | | GH; LR; ORGB |
| Chakram (original) | `18E3` | `18E5` | | | LR; ORGB |
| Chakram Core | `1958` | | | | ORGB; LR has a file |
| Strix Impact III / III Wireless | `1A88` | | `1ACE` (`1AD7`) | | ORGB; GH; LR issue #1793 |

Notes:
- ORGB lists no Bluetooth entry for the AimPoint models in its device table (ids are defined, not used).
- GH reads the "Omni (pair-list id)" from the receiver to pick the model (section 2). Those ids equal the own-dongle
  ids where both exist.

### Keyboards

| Model | Cable id | Own dongle id | Omni | Source |
|---|---|---|---|---|
| Azoth | `1A83` | `1A85` | `1ACE` (keyboard channel) | ORGB; GH Azoth.cs |
| Azoth Extreme / Extreme SE | `1B3F` / `1CEF` | | `1ACE` | GH |
| Azoth X | `1C24` | `1C25` | | GH |
| Falchion | `193C` | `193E` | | ORGB; GH Falchion.cs |
| Falchion RX / RX Low Profile | `1B04` | | RX LP: `1ACE` | GH |
| Falchion Ace / Ace HFX | `1A64` / `1B7E` | | | GH |
| Strix Scope II / II RX | `1AB3` / `1AB5` | | | ORGB; GH StrixScopeII.cs |
| Strix Scope II 96 Wireless / 96 RX Wireless | `1AAE` / `1B78` | **unconfirmed** | `1ACE` | ORGB; GH |
| Strix Flare II / II Animate | `19FE` / `19FC` | | | ORGB |

### Headsets

| Model | Id | Source | Protocol known? |
|---|---|---|---|
| Strix Go 2.4 | `18D6` | GH StrixGo24.cs | yes (GH) |
| Cetra RGB | `1965` | GH CetraRgb.cs | lights only (GH) |
| Cetra Speed Nova (earbuds) | `1AD3` | GH CetraSpeedNova.cs | yes (GH) |
| Delta II | `1AFA` (KJP edition `1D41`) | GH DeltaII.cs | yes (GH base class) |
| Delta S (USB-C) | `1943` | DB only | **no open source** |
| Delta S Wireless | `1A31` | DB only | **no open source** |
| Delta S EVA Edition | `1A49` | DB only | **no open source** |
| Throne / Throne Qi stands | `18D9` / `18C5` | ORGB | lights only |

## 2. How they talk

### One command family for everything

All ROG peripherals in GH, LR and ORGB use the same request shape: 64-byte reports, written as **HID output reports
and read back as input reports**. GH's provider maps `Write` to `HidStream.Write` and `Read` to `HidStream.Read`;
the peripheral classes never call `SetFeature`. ORGB uses `hid_write` / `hid_read` only. **No feature reports.**

A request is `[report id] [verb] [subcommand] [params ...]`, padded to 64 bytes (GH sends 65 with the report id).
LR stores verb + subcommand as one little-endian `uint16` (`0x3151` goes out as `51 31`).

| Verb | Meaning | Source |
|---|---|---|
| `12` | get | GH, LR, ORGB |
| `51` | set | GH, LR, ORGB |
| `50` | action: `50 02` switch profile, `50 03` save (mouse), `50 55` save (keyboard), `50 40` reset (headset) | GH, LR, ORGB |
| `41` / `61` | headset audio sets (EQ, ANC, sidetone) | GH AsusHeadset.cs |
| `C0 81` | keyboard per-key colors | GH, ORGB |

Reply: byte 1-2 echo the verb and subcommand (GH checks this). An error reply has `FF AA` at bytes 1-2
(GH; LR's `ASUS_STATUS_ERROR` = `0xaaff`, commented "invalid state, disconnected or sleeping").
Byte offsets below count the report id as byte 0, as GH does.

### Report ids and interfaces (Windows paths from GH)

| Link | Report id | Interface | Size |
|---|---|---|---|
| Mouse on cable or own dongle | `00` | `mi_00` (ORGB: interface 0, usage page `FF01`) | 64 (+1) |
| Keyboard on cable or own dongle | `00` | `mi_01` (ORGB: interface 1, usage page `FF00`) | 64 (+1) |
| Omni receiver, pairing channel | `01` | `mi_02&col01` | 64 |
| Omni receiver, keyboard channel | `02` | `mi_02&col02` | 64 |
| Omni receiver, mouse channel | `03` | `mi_02&col03` | 64 |
| Headsets | `CC` default; Strix Go 2.4 uses `FF` | **unconfirmed** (Cetra RGB: usage page `FF53`, 32-byte packets) | 64 |

### Finding the mouse behind an Omni receiver

Two sources, two methods:
- **GH (current):** on `mi_02&col01` write `01 A0 00 00`, read 64 bytes. Paired product ids are little-endian at
  byte 5, 9, 13 ... (step 4), ending at a zero id. Map the id to a model (table in section 1). Then on `mi_02&col03`
  write `03 7D 20 02`; byte 5 = `01` means "booster" (high polling) is on.
- **LR:** send `03 12 12 02` on the mouse channel; bytes 4-15 of the reply (after the report id) are a 12-character
  serial whose prefix names the model ("B23" Harpe Ace Aim Lab, "R1" Keris Wireless AimPoint, per issue #1793).

### Sleep and disconnect

A sleeping or out-of-range wireless mouse answers `FF AA` or nothing. GH: "If the device goes to standby it will not
report battery state anymore", and it marks the mouse not ready when battery is 0 and not charging. No wake command
was found in any source.

## 3. Settings map

Mouse commands from GH `AsusMouse.cs` unless noted; LR agrees where it covers the same field. R = read, W = write.

| Setting | Read | Write | Format | Source |
|---|---|---|---|---|
| Battery level | `00 12 07` -> byte 5 | | percent | GH mouse |
| Charging | same reply, byte 10 > 0 | | flag | GH mouse |
| Sleep (auto power off) | same reply, byte 6 | `00 51 37 00 00 <off> 00 <lowbatt>` | `00` 1 min, `01` 2, `02` 3, `03` 5, `04` 10, `FF` never | GH mouse |
| Low-battery warning | same reply, byte 7 | (same packet) | percent, step 10, max 50 by default | GH mouse |
| DPI stages | `00 12 04 00` (`04 02` for separate X/Y) -> stage i at byte 5+2i (XY: 5+4i) | `00 51 31 <stage-1> 00 <lo> <hi>` [+ R G B] | raw = (DPI - 50) / 50; LR doubles DPI on `DOUBLE_DPI` models (Chakram X, Keris Wireless, Chakram) | GH, LR |
| DPI stage count | profile reply byte 19 | `00 51 31 0A 00 <2-4>` | | GH |
| Active DPI stage | profile reply byte 12 | `00 51 31 09 00 <1-4>` | | GH |
| DPI stage colors | `00 12 04 03` -> RGB at 5+3i | appended to the DPI write | | GH |
| Polling rate | `00 12 04 00` -> byte 13 `& 07` | `00 51 31 04 00 <v>` | `00` 125, `01` 250, `02` 500, `03` 1000, `04` 2000, `05` 4000, `06` 8000 | GH; LR knows only 125-1000 |
| Polling, booster (8K over Omni / dongle) | byte 13 high nibble when booster is on | **unconfirmed** | | GH |
| Button response (debounce) | `00 12 04 00` -> byte 15 | `00 51 31 05 00 <v>` | GH: `00` off, `01` 8 ms ... `07` 32 ms; LR: index into 4, 8, ... 32 ms | GH, LR (**the two tables disagree**) |
| Angle snapping | same reply, byte 17 | `00 51 31 06 00 <0/1>` | | GH, LR |
| Angle tuning | same reply, bytes 19-20 | `00 51 31 0B 00 <lo> <hi>` | signed int16, about -20..+20 (-30..+30 Harpe Ace) | GH |
| Lift-off distance | `00 12 06` -> byte 8 | `00 51 35 FF 00 FF <v>` | `00` low, `01` high; the write resets calibration | GH (LR has none) |
| Profile (1-5) | `00 12 00` -> byte 11 | `00 50 02 <p>` | 0-based | GH, LR |
| Save | | `00 50 03` | sent after each change | GH, LR, ORGB |
| Mouse lights | `00 12 03 <zone>` -> mode 5, brightness 6, RGB 7-9, direction 11, random 12, speed 13 | `00 51 28 <zone> 00 <mode> <bri> R G B <dir> <rnd> <speed>` | zones: `00` logo, `01` wheel, `02` underglow, `03` all, `04` dock; modes: `00` static, `01` breathing, `02` color cycle, `03` rainbow, `04` reactive, `05` comet, `06` battery, `F0` off; brightness 0-100 (older models 0-4) | GH, LR, ORGB |
| Mouse per-LED lights | | `00 51 29 <count> 00 <first led> R G B ...` (5 LEDs a packet) | "direct" models only (Chakram X, AimPoints) | ORGB |
| Firmware | `00 12 00` -> offsets vary by model protocol (ORGB lists five layouts) | | | ORGB, LR |
| Keyboard battery / charging | `00 12 01` -> battery byte 6 (Falchion: byte 11), charging byte 9 = 1, sleep byte 7 | | | GH AsusKeyboard.cs |
| Keyboard sleep | | `00 51 38 00 00 <v>` | values 0-4 or `FF`; minutes **unconfirmed** | GH |
| Keyboard low-battery alert | | `00 51 37 00 00 <v>` | | GH |
| Keyboard effect + brightness | `00 12 00` -> effect byte 10 (`F1` = host driven) | `00 51 2C <mode> 00 <speed> <bri> <colormode> 00 02` + colors at 10.. | brightness 0-100 at byte 6 | GH, ORGB |
| Keyboard per-key | | `00 C0 81 <n> 00` + 4 bytes a key `<led> R G B` | max 14 (GH) or 15 (ORGB) keys a packet; LED ids from a layout map | GH, ORGB |
| Keyboard layout | `00 12 12` -> byte 6 (GH) | | | GH, ORGB |
| Keyboard save | | `00 50 55` | | GH, ORGB |
| Keyboard polling, debounce | **not found** | | | none |
| Headset battery, sleep | `CC 12 07` -> sleep 5, battery 6, low-batt 7 | `CC 51 37 00 00 <sleep> <lowbatt> <0/1>` | Strix Go timers 2, 3, 5, 10, 15, 30 min | GH AsusHeadset.cs |
| Headset charging | `CC 12 08` -> byte 5 = 1 | | | GH |
| Headset sidetone | on `CC 12 24`, level `CC 12 19` (0-20) | on `CC 41 11 00 00 <0/1>`, level `CC 61 11 00 00 <n>` | | GH |
| Headset EQ | `CC 12 21` -> on 5, ten gains 6-15 | `CC 41 03` on/off, `CC 41 06 <band> <gain>`, `CC 41 04` table | | GH |
| Headset ANC / noise reduction | `CC 41 20` | `CC 41 08 <mode>`, `CC 41 02 <0/1>` | | GH |
| Headset lights | `CC 12 03`, `CC 12 13` | `CC 51 28 00 00 <mode> <bri> R G B`, on/off `CC 51 10 00 00 <0/1>` | | GH |

(`CC` stands for the headset's report id; Strix Go 2.4 uses `FF`.)

## 4. Read-only first, then writes

Safe to read first (get verb `12` only):
- Mouse: `12 00` (profile, firmware), `12 03` (lights), `12 04 00/02/03` (DPI, polling, debounce, snapping), `12 06`
  (lift-off), `12 07` (battery, sleep).
- Omni pair list `01 A0 00 00` (GH sends it on every detect) and the booster probe `03 7D 20 02`.
- Keyboard: `12 00`, `12 01`, `12 12`. Headset: `12 07`, `12 08`, `12 03`, `12 19`, `12 21`, `12 24`.

Before any write: read the current value, keep it, write, read back, restore on mismatch. Writes that change only a
setting: DPI, polling, debounce, snapping, angle, lights, sleep, low-battery warning, then `50 03` save.
- Lift-off `51 35` also resets calibration. Do it last, and say so in the UI.
- Polling above 1000 Hz: only on models GH lists for it (Chakram X wired, Harpe II Ace). Check the booster flag.
- Leave per-key / host-driven keyboard lighting by restoring the saved effect, so the board lights itself again.

Never:
- Firmware updates. Armoury Crate ships them, and no open project maps the path. Nothing here should touch it.
- Pairing or unpairing on the Omni receiver. Only the pair-list read is known.
- Button remaps (`51 21`, `51 23`, rapid fire `51 22`) until a backup and restore is proven.
- Any subcommand not in this table: probe with get only. `FF AA` means stop.
- Running beside Armoury Crate or G-Helper. All three talk on the same interface (GH opens it non-exclusive, so
  nothing stops two writers). Step back when `ArmouryCrate*.exe` or `GHelper.exe` runs.

## 5. What DeviceHub would build

### An "ASUS ROG" adapter

1. **`asus-rog.js` (transport).** Opens the collection by vid/pid plus interface path (`mi_00`, `mi_01`,
   `mi_02&col01/02/03`). Report id per link. `query(verb, sub, params)` that writes 64 bytes as an **output report**,
   reads input reports until bytes 1-2 echo the request (skip up to 3 unrelated ones, as GH does), and treats `FF AA`
   as "asleep or refused". A 300 ms timeout and 3 tries (GH's mouse defaults). The C# helper's existing HID write/read
   path fits; **no feature-report support is needed.**
2. **`asus-rog-models.js` (per-model table).** One row per model: ids (cable, dongle, Omni pair-list id), report id,
   interface, DPI max and step, `DOUBLE_DPI`, XY DPI, polling list, lift-off, debounce, light zones and modes,
   brightness scale (0-4 or 0-100), battery and sleep flags. GH's model classes are the template.
3. **Omni discovery.** On `1ACE`: pair-list read, map ids to rows, then talk on col03 (mouse) or col02 (keyboard).
4. **Headsets.** A second small codec on the same transport (report id `CC`/`FF`, verbs `41`/`61`).

Lighting for most of these is also reachable through OpenRGB, which DeviceHub already talks to. So the mouse and
keyboard work can stop at battery, sleep, DPI, polling and the mouse-only settings.

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Transport + model table; read battery, charging, sleep, firmware on one wired mouse | 1 day with the device | low |
| 2 | Mouse reads: DPI, polling, debounce, snapping, lift-off, profile | 0.5 day | low |
| 3 | Mouse writes with read-back and save | 1 day | low-medium (debounce table conflict, DOUBLE_DPI) |
| 4 | Own dongle and Omni receiver; pair-list discovery; booster flag | 1-2 days | medium (three collections on one receiver) |
| 5 | Keyboards: battery, sleep, effect + brightness | 1 day | low-medium |
| 6 | Headsets that GH covers (Strix Go 2.4, Delta II, Cetra) | 1 day each | medium (report id per model) |
| 7 | Per-key keyboard lights | 2-3 days | medium; prefer OpenRGB |

**Covered in device-library/asus-rog-mouse (22 Oct 2026):** battery, charging, sleep, DPI stages 1-4, polling,
angle snapping, lift-off, button response (read only), and since 22 Oct the DPI stage count (`51 31 0A`, read `12 00`
byte 19) and onboard profile select (`50 02`, read `12 00` byte 11; select only). Not covered, and why:
docs/handoff/driver-coverage.md.

## 6. Gaps and unknowns

- **Delta S family (`1943`, `1A31`, `1A49`):** ids come from a driver database only. No open project speaks to it.
  Treat as plain Windows audio until measured. The Delta II protocol may or may not carry over.
- **Plain "Harpe Ace":** GH and LR call the model with `1A92` / `1A94` the "Harpe Ace Aim Lab Edition" and "Harpe
  Wireless". Whether a non-Aim-Lab Harpe Ace exists with other ids is **unconfirmed**.
- **Harpe Ace Mini cable id:** GH has a wired class, but its id was not read here.
- **Debounce values:** GH says `00` = off and `01` = 8 ms; LR says index 0 = 4 ms. Measure on the device.
- **8K "booster":** how to turn it on, and how the high nibble maps to Hz, is not shown in GH's base class.
- **Omni identify:** GH (pair list `01 A0`) and LR (serial `03 12 12 02`) use different methods. Both are reads.
- **Keyboard sleep values** (0-4, `FF`) have no minute mapping in the source.
- **Headset interface** (path, usage page) is not in GH's base class; the Cetra RGB note says usage page `FF53`.
- **Firmware reply layout** differs by model; ORGB keeps five versions keyed by a per-model "protocol" number.
- **Bluetooth:** ids exist for Keris and Gladius III, but no source shows settings over Bluetooth.
- **Licenses:** G-Helper and OpenRGB are GPL projects (check before copying code); LR is MIT. Port the facts, not
  the code.

## Sources

- [G-Helper AsusMouse.cs (mouse commands, battery, sleep, polling, lift-off, debounce, DPI, lights)](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/AsusMouse.cs)
- [G-Helper PeripheralsProvider.cs (Omni pair list, booster probe, Harpe II detect)](https://github.com/seerge/g-helper/blob/main/app/Peripherals/PeripheralsProvider.cs)
- [G-Helper HarpeAceAimLab.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/HarpeAceAimLab.cs)
- [G-Helper HarpeIIAce.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/HarpeIIAce.cs)
- [G-Helper KerisWirelssAimpoint.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/KerisWirelssAimpoint.cs)
- [G-Helper GladiusIIIAimpoint.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/GladiusIIIAimpoint.cs)
- [G-Helper GladiusIIIWireless.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/GladiusIIIWireless.cs)
- [G-Helper ChakramX.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Mouse/Models/ChakramX.cs)
- [G-Helper AsusKeyboard.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Keyboard/AsusKeyboard.cs)
- [G-Helper Azoth.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Keyboard/Models/Azoth.cs)
- [G-Helper Falchion.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Keyboard/Models/Falchion.cs)
- [G-Helper StrixScopeII.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Keyboard/Models/StrixScopeII.cs)
- [G-Helper AsusHeadset.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Headset/AsusHeadset.cs)
- [G-Helper StrixGo24.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Headset/Models/StrixGo24.cs)
- [G-Helper CetraRgb.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Headset/Models/CetraRgb.cs)
- [G-Helper CetraSpeedNova.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Headset/Models/CetraSpeedNova.cs)
- [G-Helper DeltaII.cs](https://github.com/seerge/g-helper/blob/main/app/Peripherals/Headset/Models/DeltaII.cs)
- [G-Helper WindowsUsbProvider.cs (Write/Read = output/input reports; Set/Get = feature)](https://github.com/seerge/g-helper/blob/main/app/AnimeMatrix/Communication/Platform/WindowsUsbProvider.cs)
- [libratbag asus.c (command codes, polling and debounce tables, Omni signature)](https://github.com/libratbag/libratbag/blob/master/src/asus.c)
- [libratbag asus.h (quirks, packet size, error code, button codes)](https://github.com/libratbag/libratbag/blob/master/src/asus.h)
- [libratbag driver-asus.c (quirk behavior, brightness scales)](https://github.com/libratbag/libratbag/blob/master/src/driver-asus.c)
- [libratbag asus-rog-keris-wireless-aimpoint.device](https://github.com/libratbag/libratbag/blob/master/data/devices/asus-rog-keris-wireless-aimpoint.device)
- [libratbag asus-rog-harpe-wireless.device](https://github.com/libratbag/libratbag/blob/master/data/devices/asus-rog-harpe-wireless.device)
- [libratbag asus-rog-chakram-x.device](https://github.com/libratbag/libratbag/blob/master/data/devices/asus-rog-chakram-x.device)
- [libratbag asus-rog-omni-receiver.device](https://github.com/libratbag/libratbag/blob/master/data/devices/asus-rog-omni-receiver.device)
- [libratbag issue #1793 (Omni receiver, report 03, signature prefixes)](https://github.com/libratbag/libratbag/issues/1793)
- [OpenRGB AsusAuraUSBControllerDetect.cpp (keyboard ids, interfaces, usage pages)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/AsusAuraUSBController/AsusAuraUSBControllerDetect.cpp)
- [OpenRGB AsusAuraMouseDevices.h (mouse ids, zones, modes)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/AsusAuraUSBController/AsusAuraMouseController/AsusAuraMouseDevices.h)
- [OpenRGB AsusAuraMouseController.cpp (mouse light, direct, save, version packets)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/AsusAuraUSBController/AsusAuraMouseController/AsusAuraMouseController.cpp)
- [OpenRGB AsusAuraTUFKeyboardController.cpp (keyboard packets)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/AsusAuraUSBController/AsusAuraTUFKeyboardController/AsusAuraTUFKeyboardController.cpp)
- [HeadsetControl README (no ASUS headsets)](https://github.com/Sapd/HeadsetControl/blob/master/README.md)
- [Treexy: ROG Delta S (PID 1943)](https://treexy.com/products/driver-fusion/database/human-interface-devices/asus/rog-delta-s/)
- [Treexy: ROG Delta S Wireless (PID 1A31)](https://treexy.com/products/driver-fusion/database/human-interface-devices/asus/rog-delta-s-wireless/)
- [Treexy: ROG Delta S EVA Edition (PID 1A49)](https://treexy.com/products/driver-fusion/database/human-interface-devices/asus/rog-delta-s-eva-edition/)
- [DriverMax: Harpe Ace Aim Lab Edition (PID 1A94)](https://www.drivermax.com/ROG-HARPE-ACE-AIM-LAB-EDITION-ASUSTeK-Computer-Inc_HID-VID-0B05-PID-1A94-MI-01-1_00_52_0-2023-08-24-4861803-driver.htm)
