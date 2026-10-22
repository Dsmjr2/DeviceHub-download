# Glorious: bare mapping

Researched 2026-10-22 from public source code only. Glorious has no USB vendor id of its own. Its mice ship on
Sinowealth (`258a`) and Laview (`22d4`) chips, and newer products on other vendors' ids. Those chip ids are shared with
other brands, so a vendor id alone never identifies a Glorious device: the product id, the firmware string and the
HID collection must all match too. This is a map for a later developer with the real device in hand, not a tested
spec. Every id and byte has a source in the last section; anything marked **unconfirmed** was not found in a source
and must be measured read-only first.

Short names used below:
- **ORGB** = OpenRGB (C++, `Controllers/SinowealthController/`).
- **lrb** = libratbag (C, `src/driver-sinowealth.c`, `data/devices/glorious-*.device`).
- **gctl** = gloriousctl (C, by the libratbag sinowealth driver's author; Model O/D wired).
- **mxw** = korkje/mxw (Rust; Model O/O-/D/D- Wireless; successor of korkje/mow).
- **Linux** = the kernel's `hid-glorious.c` and `hid-ids.h`.
- **QMK** = qmk_firmware `keyboards/gmmk/`; **VIA** = the-via/keyboards `v3/gmmk/`.

## 1. Most common models

### Mice

| Model | Vendor id | Product id(s) | Protocol | Source |
|---|---|---|---|---|
| Model O / O- (wired) | `258a` | `0036` | Sinowealth config (wired) | Linux hid-ids.h; ORGB; lrb (firmware string `V103`, "updated firmware") |
| Model D / D- (wired) | `258a` | `0033` | Sinowealth config (wired) | Linux; ORGB; lrb (`V102`); gctl |
| Model I (wired) | `22d4` (Laview) | `1503` | **unconfirmed** (Linux only fixes its report descriptor) | Linux hid-ids.h, hid-glorious.c |
| Model O Eternal | `3794` | `a000` | Sinowealth config (lrb driver, firmware string `1009`) | lrb glorious-model-o-eternal.device |
| Model O Wireless | `258a` | cable `2011`, dongle `2022` | Sinowealth wireless | ORGB; mxw |
| Model O- Wireless | `258a` | cable `2013`, dongle `2024` | Sinowealth wireless | mxw |
| Model D Wireless | `258a` | cable `2012`, dongle `2023` | Sinowealth wireless | ORGB; mxw |
| Model D- Wireless | `258a` | cable `2014`, dongle `2025` | Sinowealth wireless | mxw |
| Model D2 Pro | **unconfirmed** | **unconfirmed** | said to be Glorious Core v1 compatible (mxw fork) | Ari-43/mxw README |
| Model O 2 Wireless | `093a` (PixArt) | cable `822A`, dongle `822D`, Bluetooth `822B` | **unknown**, no open code | ORGB issue #4649 (user report, `MI_01`, `Col02`) |
| Model O 2 / D 2 (wired), Model I 2 | **not found** | **not found** | **unknown** | none |
| Series One Pro | **not found** | **not found** | **unknown** | none |

Notes:
- lrb tells devices on one id apart by the firmware string: each `.device` file has a section
  `[Driver/sinowealth/devices/<fw>]` (`V102`, `V103`, `1009`). DeviceHub should do the same: read firmware (command
  `01`) before trusting the model.
- ORGB disables its Sinowealth keyboard detectors because "VID/PID pairs being reused from Redragon keyboards ...
  ended up in bricking the latter". Proof that a `258a` id can belong to another brand's device with a different
  protocol.
- ORGB's `258a` table also holds non-Glorious mice (Everest GT-100 `0029`, ZET Fury Pro `1007`, Genesis Xenon 200
  `1007`). Same vendor id, same product id for two of them.

### Keyboards

| Model | Vendor id | Product id | Firmware | Source |
|---|---|---|---|---|
| GMMK Pro (ANSI rev1) | `320F` | `5044` | QMK, STM32F303; VIA definition exists | QMK `gmmk/pro/rev1/ansi/keyboard.json`; VIA `v3/gmmk/pro` |
| GMMK Pro ISO | `320F` | **unconfirmed** (ISO has its own QMK folder) | QMK | QMK |
| GMMK 2 65% (ANSI) | `320F` | `5045` | QMK, WB32F3G71; VIA definition exists | QMK `gmmk/gmmk2/p65/ansi/keyboard.json`; VIA `v3/gmmk/gmmk2` |
| GMMK 2 96% (ANSI) | `320F` | `504B` | QMK, WB32F3G71 | QMK `gmmk/gmmk2/p96/ansi/keyboard.json` |
| GMMK Numpad | `320F` | `5088` | QMK | QMK `gmmk/numpad` (via search result) |
| GMMK 3 HE | `342D` | `E3F4` (also a `04D9:FC4D` entry) | **unknown**, Glorious Core only | ORGB issue #4455 (user report, captures attached, no code) |
| GMMK 3 (non-HE) | **unconfirmed** | **unconfirmed** | a Reddit user reports a VIA mode | Reddit thread (anecdotal) |
| Original GMMK (full, TKL, compact) | **unconfirmed** | **unconfirmed** | generic controller, reportedly shared with Redragon | ORGB issue #2347 comment |

### Headsets

No Glorious headset with an open protocol was found in any source checked. Treat any Glorious audio device as plain
Windows audio.

## 2. How they talk

### Sinowealth wired config protocol (Model O, O-, D, D-, Eternal)

All HID feature reports on the vendor collection (ORGB: usage page `FF00`). Two report ids (lrb):

| Report id | Name | Size | Use |
|---|---|---|---|
| `05` | CMD | 6 bytes | send a command, read a short reply |
| `04` | CONFIG | 520 bytes (buffer); config data 123-167 bytes | read or write the whole settings block |
| `06` | CONFIG_LONG | 520 | same, on "long" devices |

Command bytes (lrb):

| Byte | Command |
|---|---|
| `01` | firmware version (4 bytes) |
| `02` | profile |
| `11` / `21` / `31` | get config (profile 1 / 2 / 3) |
| `12` / `22` / `32` | get buttons (profile 1 / 2 / 3) |
| `1a` | debounce |
| `1b` | angle snapping and lift-off (long devices only; "does not work on Glorious Model O") |
| `30` | macro |
| `75` | **DFU: puts the device into firmware update mode. Never send.** |

Read sequence (lrb, ORGB `GetProfile`): set feature `05 11 00 00 00 00`, then get feature report `04` (520 bytes).
Firmware: set feature `05 01 ...`, then get feature `05`.

Write sequence (lrb, ORGB `SetMode`): read the block first, change fields, set byte `03` (`config_write`) to the
config size minus 8 (ORGB writes `7B` = 123, i.e. 131-byte config), set byte `06` to `00`, then set feature report
`04` with the whole block. There is no checksum. ORGB waits 50 ms after.

Config block layout (lrb `struct sinowealth_config_report`, in order):

| Offset | Field |
|---|---|
| 0 | report id `04` |
| 1 | command id |
| 2 | unknown |
| 3 | `config_write` (0 on read; size - 8 on write) |
| 4-8 | unknown |
| 9 | sensor type: `06` PMW3360, `08` PMW3212, `0e` PMW3327, `0f` PMW3389 |
| 10 | low nibble report rate, high nibble config flags (nibble order per C bitfield, **confirm on device**) |
| 11 | DPI count (4 bits) and active DPI (4 bits, 1-based among enabled slots) |
| 12 | disabled DPI slots bit mask (set bit = disabled) |
| 13-28 | 8 DPI values (or 8 x/y pairs in independent mode) |
| 29-52 | 8 DPI colors, 3 bytes each |
| 53 (`0x35`) | RGB effect (ORGB writes the mode here) |
| `0x36`-`0x80` | per-effect brightness/speed, colors (see section 3) |
| after effects | lift-off distance, unknown, then 36 unknown bytes on long devices |

Offsets 0-12 are counted from lrb's struct; ORGB's `0x35` mode offset agrees with that count.

### Sinowealth wireless protocol (Model O/O-/D/D- Wireless)

A different protocol from the wired one. All 65-byte feature reports with report id `00` (mxw, ORGB GMOW).
mxw opens interface `02`; ORGB matches usage page `FFFF`. Send with set feature, wait 50 ms, read with get feature.

| Request | Bytes set (index = value, rest `00`) | Reply | Source |
|---|---|---|---|
| Battery | `[3]=02 [4]=02 [6]=83` | `[8]` = percent (0 shown as 1); `[1]` status: `A1` ok, `A4` asleep, `A0` waking; `[6]` must echo `83` | mxw battery.rs |
| Firmware | `[3]=02` (cable only) `[4]=03 [6]=81` | `[7]`-`[10]` = version, dotted decimal | mxw, ORGB |
| DPI stages | `[3]=02 [4]=12 [5]=01 [6]=01 [7]=profile [8]=count`, each stage big-endian u16 written twice from `[9]` | | mxw dpi_stages.rs |
| Polling | `[3]=02 [4]=01 [5]=01 [7]=ms` | | mxw polling_rate.rs |
| Lift-off | `[3]=02 [4]=01 [5]=01 [6]=07 [7]=mm-1` | | mxw lift_off.rs |
| Debounce | `[3]=02 [4]=01 [6]=08 [7]=profile [8]=ms` | | mxw debounce.rs |
| Sleep | `[3]=02 [4]=02 [6]=07 [7..8]` = seconds big-endian; `FF FF` when 0 | | mxw sleep.rs |
| Lights | three packets, 50 ms apart: mode (`[3]=02 [5]=02 [7]=01 [8]=FF [9]=mode`), wired brightness, "less" brightness | | ORGB GMOW |

Polling and lift-off share `[4]=01 [5]=01` and differ only by `[6]` (`00` vs `07`), as written in mxw. Sleep also
uses `[6]=07`, but with `[4]=02`. So `[4]` looks like a group and `[6]` like the setting; this reading is
**unconfirmed**. Measure before writing.

mxw's README says its `set_and_check` mirrors Glorious Core's own write-then-verify. Its exact read-back bytes were
not found.

### Keyboards

- **GMMK Pro, GMMK 2:** QMK firmware. If the board runs a VIA-enabled build, settings go over QMK raw HID: usage
  page `FF60`, usage `61`, 32-byte reports both ways (QMK docs). The VIA command set is not mapped here. The stock
  Glorious firmware on these boards may not be VIA (**unconfirmed**; ORGB #2347 says the Pro was unsupported until
  flashed with custom QMK).
- **GMMK 3 / 3 HE:** Glorious Core only; captures exist in ORGB #4455 but no decoded protocol.
- **Original GMMK:** no open protocol found.

## 3. Settings map

W = wired Sinowealth (report `04` block or `05` command). WL = wireless (65-byte feature, mxw). R = read, W = write.

| Setting | Wired (Model O/D) | Wireless (O/D Wireless) | Format | Source |
|---|---|---|---|---|
| DPI stages | block offsets 13-28, 8 slots; count/active at 11; mask at 12 | `[4]=12` packet, up to 8 (**unconfirmed** max) | wired: `dpi/100`, minus 1 on PMW3327/PMW3360; 100-step; max 12000 (PMW3360), 16000 (3389), 10200 (3327), 7200 (3212). WL: big-endian u16 | lrb; mxw |
| DPI colors | block 29-52, 3 bytes each | separate file in mxw (bytes **unconfirmed**) | RGB | lrb; mxw |
| Polling rate | block offset 10, 4 bits | `[4]=01 [5]=01 [7]=ms` | wired: `1` 125, `2` 250, `3` 500, `4` 1000 Hz; `0` = error. WL: `ms` (likely 1/2/4/8, **unconfirmed**) | lrb; mxw |
| Lift-off | block field: `1` = 2 mm, `2` = 3 mm, `ff` = set elsewhere (**do not overwrite**) | `[6]=07 [7]=mm-1` | | lrb; mxw |
| Lift-off / angle snap (long devices) | command `1b`, read only in lrb: bit 1 of reply `[2]` = high LOD, bit 0 of `[3]` = snapping | not mapped | not on Model O | lrb |
| Debounce | command `1a`, value `ms/2`, 4-16 ms even (gctl: same range) | `[6]=08 [7]=profile [8]=ms` | | lrb; gctl; mxw |
| Angle snapping | not in the block; `1b` only on long devices | not found | | lrb |
| Sleep | not in the block (none found) | `[4]=02 [6]=07`, seconds BE, `FF FF` = 0 | | mxw |
| Battery | n/a (wired) | `[4]=02 [6]=83`, percent at `[8]`, status at `[1]` | | mxw |
| Firmware | command `01`, 4 bytes | `[4]=03 [6]=81`, `[7]`-`[10]` | | lrb; mxw; ORGB |
| Light effect | block `0x35` = mode | mode packet `[9]` | | ORGB |
| Brightness / speed | per effect: `((brightness & 0F) << 4) \| (speed & 0F)`; gctl: brightness 0-4, speed 0-3 | wired/less packets `[8]` | | ORGB; gctl |
| Light colors | stored **R, B, G** order (lrb LED type `RBG`) at `0x39`-`0x3B` (static), `0x3E`-`0x52` (7-color breathing), `0x75`-`0x7A` (rave), `0x7E`-`0x80` (breathing) | from `[0x0C]`, 3 bytes each; black sent as `01 00 00` | | ORGB; lrb |
| Buttons | report `04`/`12`, 4 bytes per button, 20 per profile | mxw `bind/` | type byte + 3 data | lrb; mxw |

## 4. Read-only first, then writes

Safe to read first:
- Wired: command `01` (firmware), `11` (get config, then get feature `04`), `1a` read. Keep the full 520-byte reply.
- Wireless: battery (`83`) and firmware (`81`) requests.
- Model I, Model O 2, GMMK 3: enumerate HID collections only. Do not send anything until a protocol is found.

**The Sinowealth wired write rewrites the whole block.** There is no field-level set.
- Back up the full config block (and the button block) to disk before the first write, per device and per profile.
- Read fresh right before each write; never write from a cache. ORGB notes that reading "right after a write returns
  zeros from offset 0x2C onward", so wait at least 50 ms after a write before reading, and refuse to write a block
  whose bytes from `0x2C` on are all zero.
- Never overwrite `ff` markers: lrb says "Do NOT overwrite it" for lift-off `ff` and for `ff` RGB fields.
- Copy unknown bytes back unchanged (lrb does).
- Check the reply length is 123-167 config bytes; refuse anything else.
- After writing, read back and compare the fields changed; restore the backup on mismatch.

Wireless writes are per setting, but still: read the value first where a read exists, write one setting, wait 50 ms,
verify.

Never:
- Command `75` (DFU). lrb: "Puts the device into DFU mode." Firmware of any kind: never.
- Macro modes above `04` (lrb: "Anything above freezes up the mouse").
- Macro writes: they may overwrite macros from Glorious Core and cannot be read back (lrb).
- Any write to a `258a` device whose product id and firmware string are not both in DeviceHub's table (Redragon
  bricking, ORGB).
- Running beside Glorious Core. Both use the same feature reports (**unconfirmed** that Core holds the device open,
  but likely).
- mxw's author says they bricked devices "repeatedly" while developing it. Recovery: hold left, right and wheel for
  five seconds while it flashes green (factory reset); not guaranteed.

## 5. What DeviceHub would build

Needs HID **feature reports** (set and get). DeviceHub's C# helper currently sends output reports for the HS80; it
must gain `HidD_SetFeature` / `HidD_GetFeature` (or `FileStream`-free equivalents) with a 520-byte and a 65-byte path.

### A "Glorious" adapter in two parts

1. **`sinowealth-wired.js`** (Model O, O-, D, D-, Eternal): open the `FF00` collection by vid/pid; firmware read;
   get config; parse the block (sensor, DPI, polling, effect); backup; whole-block write with the guards in section 4.
2. **`sinowealth-wireless.js`** (O/O-/D/D- Wireless): open interface `02` by vid/pid (cable or dongle id); battery,
   firmware; then DPI, polling, lift-off, debounce, sleep writes; lights via the three-packet sequence.
3. **`glorious-models.js`**: one row per model: vid, pid(s), firmware strings, sensor, DPI range, LED type (`RBG`),
   config size, which settings exist.
4. **Keyboards**: no adapter of their own. GMMK Pro / GMMK 2 on VIA builds can go through a generic QMK/VIA adapter
   later (raw HID `FF60`/`61`, 32 bytes). Lights are reachable today through OpenRGB, which DeviceHub already talks
   to (ORGB supports Model O/D wired and wireless; QMK boards via its QMK protocol).

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Feature-report support in the C# helper | 0.5 day | low |
| 2 | Wireless read-only: battery, firmware | 0.5 day with the device | low |
| 3 | Wired read-only: firmware, config parse, backup to disk | 1 day | low |
| 4 | Wireless writes: DPI, polling, sleep, debounce, lift-off | 1-2 days | medium (byte meanings partly unconfirmed; brick reports) |
| 5 | Wired writes: DPI, polling, lights, debounce | 1-2 days | medium-high (whole-block rewrite, no checksum) |
| 6 | Keyboards via VIA, if a VIA build is present | 2-3 days | medium |
| 7 | Model O 2, Model I, GMMK 3, Series One Pro | unknown | high: needs protocol captures first |

## 6. Gaps and unknowns

- **Model O 2 / D 2 / I 2, Series One Pro, GMMK 3:** no open protocol. Model O 2 Wireless and GMMK 3 HE ids come
  from user reports in ORGB issues, not from code.
- **Model I (`22d4:1503`):** Linux only fixes its descriptor. No config protocol found.
- **Model O Eternal `3794:a000`:** in lrb only; untested by DeviceHub sources.
- **Wireless byte clash:** lift-off and polling packets differ only at `[6]`; which `[4]`/`[5]` values are right is
  unconfirmed. Polling `ms` value set unconfirmed. Max wireless DPI stages unconfirmed.
- **Wireless read-back:** mxw's `set_and_check` exists, but the read bytes were not found.
- **Report rate nibble order** in block byte 10 depends on C bitfield order; confirm on the device.
- **Debounce on short-config devices:** lrb says command `1a` "Doesn't work on devices with shorter configuration
  data", and its comment (123 vs 137) does not match its own minimum. Test read first.
- **Angle snapping, sleep on wired mice:** no field found.
- **GMMK Pro ISO, GMMK 2 ISO, original GMMK:** ids not confirmed.
- **Whether stock GMMK Pro / GMMK 2 firmware answers VIA:** unconfirmed.
- **Headsets:** none found.
- **"mouse-m" tool:** not found under that name; the community Model O Wireless tools found are korkje/mow and
  korkje/mxw.

## Sources

- [libratbag driver-sinowealth.c (report ids, commands, config struct, DPI, polling, LOD, debounce, warnings)](https://github.com/libratbag/libratbag/blob/master/src/driver-sinowealth.c)
- [libratbag driver-sinowealth.h (LED types, firmware length)](https://github.com/libratbag/libratbag/blob/master/src/driver-sinowealth.h)
- [libratbag glorious-model-o.device (258a:0036, V103)](https://github.com/libratbag/libratbag/blob/master/data/devices/glorious-model-o.device)
- [libratbag glorious-model-d.device (258a:0033, V102)](https://github.com/libratbag/libratbag/blob/master/data/devices/glorious-model-d.device)
- [libratbag glorious-model-o-eternal.device (3794:a000)](https://github.com/libratbag/libratbag/blob/master/data/devices/glorious-model-o-eternal.device)
- [OpenRGB SinowealthControllerDetect.cpp (ids, usage pages, Redragon note)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SinowealthController/SinowealthControllerDetect.cpp)
- [OpenRGB SinowealthController.cpp (wired read/write, lighting offsets)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SinowealthController/SinowealthController/SinowealthController.cpp)
- [OpenRGB SinowealthGMOWController.cpp (wireless lighting, firmware)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/SinowealthController/SinowealthGMOWController/SinowealthGMOWController.cpp)
- [OpenRGB issue #4649 (Model O 2 Wireless ids)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/4649)
- [OpenRGB issue #4455 (GMMK 3 HE ids)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/4455)
- [OpenRGB issue #2347 (GMMK Pro, original GMMK)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/2347)
- [gloriousctl (Model O/D wired, debounce, lights)](https://github.com/enkore/gloriousctl)
- [korkje/mxw (Model O/O-/D/D- Wireless)](https://github.com/korkje/mxw)
- [mxw src/util/devices.rs (wireless ids, interface 2)](https://github.com/korkje/mxw/blob/master/src/util/devices.rs)
- [mxw src/report/battery.rs](https://github.com/korkje/mxw/blob/master/src/report/battery.rs)
- [mxw src/report/firmware.rs](https://github.com/korkje/mxw/blob/master/src/report/firmware.rs)
- [mxw src/config/ (dpi_stages, polling_rate, lift_off, debounce, sleep)](https://github.com/korkje/mxw/tree/master/src/config)
- [korkje/mow (original Model O Wireless project)](https://github.com/korkje/mow)
- [Ari-43/mxw fork (Model D2 Pro)](https://github.com/Ari-43/mxw)
- [Linux hid-glorious.c](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-glorious.c)
- [Linux hid-ids.h (258a, 22d4, Model O/D/I ids)](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-ids.h)
- [QMK gmmk/pro/rev1/ansi/keyboard.json (320F:5044)](https://github.com/qmk/qmk_firmware/blob/master/keyboards/gmmk/pro/rev1/ansi/keyboard.json)
- [QMK gmmk/gmmk2/p65/ansi/keyboard.json (320F:5045)](https://github.com/qmk/qmk_firmware/blob/master/keyboards/gmmk/gmmk2/p65/ansi/keyboard.json)
- [QMK gmmk/gmmk2/p96/ansi/keyboard.json (320F:504B)](https://github.com/qmk/qmk_firmware/blob/master/keyboards/gmmk/gmmk2/p96/ansi/keyboard.json)
- [QMK gmmk/numpad keyboard.json mirror (320F:5088)](https://hacktivis.me/git/qmk_firmware/file/keyboards/gmmk/numpad/keyboard.json.html)
- [QMK raw HID docs (FF60, 61, 32 bytes)](https://github.com/qmk/qmk_firmware/blob/master/docs/features/rawhid.md)
- [VIA keyboards v3/gmmk (gmmk2, numpad, pro)](https://github.com/the-via/keyboards/tree/master/v3/gmmk)
- [Reddit: GMMK 3 and QMK flashing (anecdotal)](https://reddit.birdcat.cafe/r/glorious/comments/1gu8oo9/gmmk_3_and_qmk_flashing)
