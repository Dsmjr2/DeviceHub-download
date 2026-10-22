# Keychron: bare mapping

Researched 2026-10-22 from public source code only. Vendor id `3434` for Keychron, `362D` for its Lemokey brand.
This is a map for a later developer with the real keyboard in hand, not a tested spec. Every id has a source in the
last section; anything marked **unconfirmed** was not found in a source and must be measured read-only first.

Short names used below:
- **KQ** = Keychron's QMK fork, branch `2025q3` (its default), `keyboards/keychron/common/`.
- **KQ-bt** = the same fork, branch `bluetooth_playground` (older Pro boards: Q1 Pro, K2 Pro).
- **VIA** = the-via/keyboards, the library usevia.app reads (`v3/keychron/`).
- **DH** = DeviceHub (`public/devices/via.js`, `helpers/via-defs.js`).

The good news: every current Keychron keyboard is a QMK + VIA board. DeviceHub already drives it with no new code.
Keychron adds its own commands on the same raw HID channel. Those are the only new work.

## 1. Most common current models

USB product ids from the `keyboard.json` / `info.json` of each board in KQ (KQ-bt for Q1 Pro and K2 Pro).
"In VIA" means the board's definition is in VIA's library, so DH finds its layout by itself. "Maker's JSON" means
DH needs Keychron's file in `via-definitions\<VID><PID>.json`.

### Keyboards

| Model | Product ids | Radio | In VIA? | Source |
|---|---|---|---|---|
| Q1 (v1) | `0100` ANSI, `0101` ANSI knob, `0102` ISO, `0103` ISO knob | wired | yes (`q1/v1`) | KQ q1v1; VIA |
| Q1 (v2) | `0106` ANSI, `0107` ANSI knob, `0108` ISO, `0109` ISO knob, `010A` JIS, `010B` JIS knob | wired | yes (`q1/v2`) | KQ q1v2; VIA |
| Q1 Pro | `0610` ANSI knob, `0611` ISO knob, `0612` JIS | Bluetooth | no: maker's JSON | KQ-bt q1_pro |
| Q1 Max | `0810` ANSI, `0811` ISO, `0812` JIS (all knob) | 2.4 GHz + Bluetooth | no: maker's JSON | KQ q1_max |
| Q1 HE | `0B10` ANSI, `0B11` ISO, `0B12` JIS | **unconfirmed** | no | KQ q1_he |
| K2 Pro | `0220`/`0223` ANSI RGB/white, `0221`/`0224` ISO, `0222`/`0225` JIS | Bluetooth | no: maker's JSON | KQ-bt k2_pro |
| K2 Max | `0A20`/`0A23` ANSI RGB/white, `0A21`/`0A24` ISO, `0A22`/`0A25` JIS | 2.4 GHz + Bluetooth | no: maker's JSON | KQ k2_max |
| K2 HE | `0E20` ANSI, `0E21` ISO, `0E22` JIS | **unconfirmed** | no | KQ k2_he |
| K8 Pro | `0280`/`0283` ANSI RGB/white, `0281`/`0284` ISO, `0282`/`0285` JIS | Bluetooth | no: maker's JSON | KQ k8_pro |
| V1 | `0310` ANSI, `0311` ANSI knob, `0312` ISO, `0313` ISO knob, `0314` JIS, `0315` JIS knob, `0317` ABNT2 knob | wired | yes (`v1`) | KQ v1; VIA |
| V1 Max | `0913` ANSI, `0914` ISO, `0915` JIS (all knob) | 2.4 GHz + Bluetooth | no: maker's JSON | KQ v1_max |
| V1 8K | `0F10` ANSI knob | wired, 8000 Hz | no | KQ v1_8k |
| Q6 | `0160` ANSI, `0161` ANSI knob, `0162` ISO, `0163` ISO knob | wired | yes (`q6`) | KQ q6; VIA |
| Q6 Max | `0860` ANSI, `0861` ISO (knob) | 2.4 GHz + Bluetooth | no: maker's JSON | KQ q6_max |
| Lemokey L1 HE | `362D:0510` | | no | KQ lemokey/l1_he |
| Lemokey P1 HE | `362D:0610` ANSI, `0611` ISO, `0612` JIS | | no | KQ lemokey/p1_he |
| Lemokey P2 HE / P3 HE | `362D:0620` / `362D:0630` | | no | KQ lemokey |

Notes:
- VIA's library holds 102 Keychron files, all for wired Q, V, C Pro, Q0 and S1 boards. No Pro, Max, HE or 8K board is in it.
  Keychron publishes those JSON files on its own site (one page per series) and loads them in Keychron Launcher.
- Product ids repeat across vendors: Q1 Pro `3434:0610` and Lemokey P1 HE `362D:0610`. Always match vid and pid together.
- The Lemokey L3 and other non-HE Lemokey boards are not in KQ `2025q3`. Their ids are **unconfirmed**.
- Shipped firmware can be older than KQ. A board's product id is stable, but which Keychron commands it answers is
  not. Probe them (section 4).

### Mice

| Model | Ids | Protocol | Source |
|---|---|---|---|
| M6 (8K variant) | `D049` cable, `D028` 2.4 GHz dongle | **undocumented**; set up by Keychron Launcher over WebHID | NixOS wiki (udev example) |
| M3 Mini, M3, other M-series | **unconfirmed** | **undocumented** | none |

Keychron mice are not QMK boards. No open project documents their settings protocol. The NixOS wiki says the
Launcher cannot reach them over Bluetooth, and its ids are given as an example "for an 8k variant".

## 2. How they talk

### Plain VIA (what DH already speaks)

- Raw HID interface: usage page `FF60`, usage `61`, 32-byte reports (QMK default; KQ's wireless code also assumes
  `RAW_EPSIZE 32`). DH's `ViaKeyboard` already opens it.
- KQ builds with `VIA_INSECURE`. QMK's VIA "unlock" step is skipped, so dangerous VIA commands (bootloader jump
  `0B`, EEPROM reset `0A`, keymap reset `06`) work with no key press. DH already refuses all of them (`FORBIDDEN`).

### Keychron's commands on top

KQ hooks `via_command_kb()`. Before VIA's own handler sees a packet, Keychron's `kc_raw_hid_rx()` takes these first
bytes (`keychron_raw_hid.h`). Same 32-byte frame, same interface, reply echoes the header.

| Byte 0 | Name | What it does |
|---|---|---|
| `A0` | KC_GET_PROTOCOL_VERSION | reply `A0 02 00 02` (Keychron protocol 2, QMK command set 2) |
| `A1` | KC_GET_FIRMWARE_VERSION | reply `A1` then ASCII, e.g. `v1.1.1 ` plus the build date |
| `A2` | KC_GET_SUPPORT_FEATURE | reply `A2 00 <flags lo> <flags hi>` (bits below) |
| `A3` | KC_GET_DEFAULT_LAYER | reply `A3 <default layer> <current layer>`; also sent unasked on every layer change |
| `A7` | KC_MISC_CMD_GROUP | settings; byte 1 is a sub-command (table below) |
| `A8` | KC_KEYCHRON_RGB | Keychron lighting (per-key and mixed effects), on boards built with `KEYCHRON_RGB_ENABLE` |
| `A9` | KC_ANALOG_MATRIX | Hall-effect (HE) boards only: actuation and rapid trigger. Not mapped here |
| `AA` | KC_WIRELESS_DFU | firmware update of the wireless module. **Never** |
| `AB` | KC_FACTORY_TEST | factory test. **Never** |

Feature flags in the `A2` reply (`FEATURE_*`): lo byte bit 0 default layer, 1 Bluetooth, 2 2.4 GHz ("P24G"),
3 analog matrix, 4 state notify, 5 dynamic debounce, 6 snap click, 7 Keychron RGB; hi byte bit 0 quick start,
bit 1 NKRO. KQ always sets the two hi bits.

`A7` sub-commands (`MISC_*`), with the reply status in byte 2 (`00` ok, `01` fail):

| Byte 1 | Name | Request after the header | Reply |
|---|---|---|---|
| `01` | MISC_GET_PROTOCOL_VER | none | bytes 3-4 = `0002` little-endian, byte 5 = which groups exist (bits below) |
| `02` | DFU_INFO_GET | none | chip name (e.g. `STM32F401`) and bootloader type (1 STM32, 2 WB32). Read only |
| `03` / `04` | LANGUAGE_GET / SET | not mapped | |
| `05` | DEBOUNCE_GET | none | byte 3 = `00`, byte 4 = type, byte 5 = time in ms |
| `06` | DEBOUNCE_SET | byte 2 type, byte 3 time | saves to EEPROM at once |
| `07` | SNAP_CLICK_GET_INFO | none | byte 3 = number of key pairs |
| `08` | SNAP_CLICK_GET | byte 2 start, byte 3 count (max 9) | from byte 3: count x (type, key 1, key 2) |
| `09` | SNAP_CLICK_SET | byte 2 start, byte 3 count, then count x 3 bytes | live only |
| `0A` | SNAP_CLICK_SAVE | none | writes all pairs to EEPROM |
| `0B` | WIRELESS_LPM_GET | none | bytes 3-4 backlight-off time, bytes 5-6 sleep time; seconds, uint16 LE |
| `0C` | WIRELESS_LPM_SET | bytes 2-5 the same two values | refused if light < 5 s or sleep < 60 s |
| `0D` | REPORT_RATE_GET | none | byte 3 = rate divider, byte 4 = `7F` (allowed mask) |
| `0E` | REPORT_RATE_SET | byte 2 divider 0-6 | saved to EEPROM at once |
| `0F` / `10` | DIP_SWITCH_GET / SET | named in the header, not handled in KQ `2025q3` | |
| `11` | FACTORY_RESET | only sent BY the keyboard as a notice | **never send** |
| `12` | NKRO_GET | none | byte 3: bit 0 on, bit 1 switchable, bit 2 adaptive NKRO |
| `13` | NKRO_SET | byte 2 = 0 / 1 | KQ `2025q3` sets `APDAPTIVE_NKRO_ENABLE` for every board, so this returns fail there |

`A7 01` byte 5 bits (`MISC_*`): 0 DFU info, 1 language, 2 debounce, 3 snap click, 4 wireless sleep ("LPM"),
5 report rate, 6 quick start, 7 NKRO. Use these, not the model name, to decide what to show.

An unknown `A7` sub-command comes back as `FF 00`. An unknown first byte falls through to VIA, which answers `FF`.

### Notices the keyboard sends unasked (`state_notify.c`)

- `A3 <default> <current>` on every layer change.
- `A7 0D 00 <divider> 7F` when the report rate is changed with the Fn key combo.
- `A7 11` after a factory reset done on the keyboard.

DH's reply matcher compares the header. A notice that arrives while DH waits on the same header (`A3`, or `A7 0D`)
would be taken as the answer. Harmless for reads (same layout), but worth a guard.

### Wired, 2.4 GHz and Bluetooth

- **Max boards** (`LK_WIRELESS_ENABLE`, LKBT51 radio module): raw HID is relayed over the radio. The module has its
  own commands `91` init, `92` RX, `93` TX for it (`lkbt51.h`). `kc_raw_hid_send()` answers over the radio when it is
  connected. So in source, VIA and Keychron commands work through the 2.4 GHz receiver.
- When a VIA protocol request (`01`) arrives over the radio, the keyboard adds its own vid, pid and device version
  in bytes 3-8. That is how a host behind the receiver learns which board it is talking to. The receiver's own
  product id is **unconfirmed**.
- **Pro boards** (`KC_BLUETOOTH_ENABLE`, CKBT51 module): replies go out on USB only. Configure them on the cable.
- Keychron's own product pages say to use Keychron Launcher with the keyboard **wired**. Whether Windows exposes the
  `FF60` collection on the 2.4 GHz receiver or over Bluetooth is **unconfirmed**. Treat wired as the only supported path.

## 3. Settings map

"VIA" = DH already does it. "KC" = Keychron command above. R = read, W = write.

| Setting | How | R/W | Format | Boards | Source |
|---|---|---|---|---|---|
| Key remap, layers, knob | VIA `04`/`05`, `11`, `14`/`15` | R/W | VIA | all | VIA; DH |
| Macros | VIA `0C`-`0F` | R/W | VIA | all | DH |
| Lighting effect, brightness, speed, color | VIA custom `07`/`08`/`09`, channel 3 (rgb_matrix) or 5 (led_matrix) | R/W | 0-255 | all lit boards | DH |
| Firmware version (number) | VIA `02 04` | R | uint32 | all | DH |
| Firmware version (text, date) | KC `A1` | R | ASCII | KQ boards | keychron_raw_hid.c |
| Feature list | KC `A2`, `A7 01` | R | bit fields | KQ boards | keychron_raw_hid.c |
| Current layer | KC `A3` | R + notice | layer numbers | KQ boards | state_notify.c |
| Debounce | KC `A7 05` / `A7 06` | R/W | type 0-6, time 0-255 ms (0 = none; type 5 capped at 127) | where flag set | keychron_debounce.c |
| Snap click (SOCD) | KC `A7 07`-`0A` | R/W | per pair: type 0 off, 1 regular, 2 last input, 3 first key, 4 second key, 5 neutral; two 1-byte keycodes | where flag set; not on HE boards | snap_click.c |
| Backlight off / sleep timer (wireless) | KC `A7 0B` / `A7 0C` | R/W | seconds, light >= 5, sleep >= 60; default sleep 7200 | wireless boards | wireless.c, wireless_config.h |
| Report rate | KC `A7 0D` / `A7 0E` | R/W | divider 0-6, USB interval = 2^n - 1 | `USB_REPORT_INTERVAL_ENABLE` boards (V1 8K) | usb_report_rate.c |
| NKRO | KC `A7 12` / `A7 13` | R (W fails on `2025q3`) | bits | KQ boards | nkro.c, keychron_common.mk |
| Per-key colors | KC `A8 09` / `A8 0A` | R/W | start, count, then H S V per key | `KEYCHRON_RGB_ENABLE` (Q6, V1 8K) | keychron_rgb.c |
| Mixed effect regions | KC `A8 0B`-`0F` | R/W | region, effect, hue, sat, speed, 4-byte time | same | keychron_rgb.c |
| OS indicator light (Caps etc.) | KC `A8 03` / `A8 04` | R/W | disable mask, H, S, V | same | keychron_rgb.c |
| LED count / LED index | KC `A8 05` / `A8 06` | R | | same | keychron_rgb.c |
| Save Keychron lighting | KC `A8 02` | W | | same | keychron_rgb.c |
| Battery level | **no raw HID command found** | | percent is computed on the board (battery.c) | wireless boards | battery.c |
| Bluetooth host slots, pairing | **not exposed** over raw HID in KQ | | | | |

Report rate dividers: the Fn combo code names `0` = 8000 Hz, `1` = 4000 Hz, `3` = 1000 Hz (default `3`). `2` = 2000,
`4` = 500, `5` = 250, `6` = 125 Hz follow from the formula and are **unconfirmed**.

Debounce types (`keychron_debounce.h`): 0 sym defer global, 1 sym defer per row, 2 sym defer per key, 3 sym eager per
row, 4 sym eager per key (default), 5 asym eager defer per key, 6 none.

Setting the wireless timers while connected wiggles the mouse cursor, or taps left Shift on boards without mouse
keys, to reset the radio's timer (`wireless_lpm_set`). Say so in the UI.

## 4. Read-only first, then writes

Safe to read (no state change):
- VIA `01`, `02 01`/`02 04`, `08` lighting gets, `11`, `12` keymap read (DH already does these).
- KC `A0`, `A1`, `A2`, `A3`, `A7 01`, `A7 02`, `A7 05`, `A7 07`, `A7 08`, `A7 0B`, `A7 0D`, `A7 12`, `A8 01`, `A8 03`, `A8 05`.

Probe order on a new board: `A0`. If it answers `FF`, the firmware has no Keychron commands; stop and use plain VIA.
Then `A2` and `A7 01`, and offer only what their bits say.

Writes that change one setting (read first, write, read back, restore on mismatch, as DH's `setLighting` does):
- Debounce `A7 06`, report rate `A7 0E`, wireless timers `A7 0C`. Each saves to EEPROM itself, so keep the old value.
- Snap click `A7 09` is live only; send `A7 0A` only after a read-back matches.
- Keychron lighting `A8 04`, `A8 0A`, `A8 0D`, `A8 0F`, then `A8 02` to save.
- EEPROM has limited write cycles. Do not write on every slider move; write once the user lets go.

Never:
- Firmware: VIA `0B` bootloader jump, KC `AA` wireless DFU, any Fn+key or keycode that enters the bootloader
  (DH already refuses `7C00`-`7C03`, `7E0A`). Firmware updates stay in Keychron's own tools.
- EEPROM / factory reset: VIA `0A`, `06`, `10`, and KC `A7 11`.
- Factory test: KC `AB`.
- Analog matrix `A9` on HE boards until it is mapped from source; wrong actuation values make keys fire or never fire.
- Language and DIP switch commands (`A7 03`/`04`, `0F`/`10`): not needed and not mapped.
- Running beside Keychron Launcher or usevia.app in a browser tab. Both talk on the same channel.

## 5. What DeviceHub would build

DH's VIA support already covers keys, layers, knobs, macros and basic lighting for every Keychron board. Add a small
`keychron.js` beside `via.js` that reuses `ViaKeyboard.cmd()`:

1. **Recognize the board.** Vendor `3434` or `362D` on `FF60`. Load its JSON from VIA's library, or ask the person for
   Keychron's file (most Pro/Max/HE boards). DH's existing "does not match the layout" check catches a wrong file.
2. **Extend the reply matcher.** Add `A0`-`A3` (1-byte header) and `A7`, `A8` (2-byte header) to `ECHO`. Add `AA`,
   `AB` to `FORBIDDEN`, and refuse `A7 11` and `A9` in `keychron.js`. Ignore unasked `A3` and `A7 11` packets.
3. **Probe.** `A0`, `A1`, `A2`, `A7 01`; keep the bits and show only those settings.
4. **Settings page.** Debounce (type + ms), NKRO (read only on `2025q3` firmware), report rate (8K boards),
   wireless backlight/sleep timers, snap click pairs.
5. **Keychron lighting.** Per-key colors on `KEYCHRON_RGB` boards.

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Check any Keychron board appears with its layout (no code) | 0.5 h with the board | none |
| 2 | Matcher, forbidden list, probe and show `A1`/`A2`/`A7 01`/`A3` | 0.5 day | low (reads) |
| 3 | Debounce, NKRO read, wireless timers read | 0.5 day | low |
| 4 | Debounce write, wireless timers write (with read-back) | 0.5 day | low-medium (EEPROM, cursor wiggle) |
| 5 | Report rate on V1 8K and other 8K boards | 0.5 day | medium (wrong divider = USB rate the host may not like; confirm the table first) |
| 6 | Snap click editor (pairs, type, save) | 1 day | medium (keycodes are 1 byte, basic keys only) |
| 7 | Keychron per-key lighting `A8` | 2 days | medium (HSV per LED, LED index map from `A8 06`) |
| 8 | Wireless path (2.4 GHz receiver) | unknown | needs measuring on the receiver first |
| 9 | Keychron mice (M3 Mini, M6) | large | needs a learning session with Keychron Launcher; nothing is documented |

## 6. Gaps and unknowns

- **Battery:** no raw HID battery read exists in KQ. The Launcher may show it another way; Bluetooth hosts may get it
  from the standard BLE battery service. Both **unconfirmed**.
- **2.4 GHz receiver id and its `FF60` collection on Windows:** not found. The M6 dongle is `D028` (NixOS wiki) but a
  keyboard receiver may differ.
- **Q1 Pro, K2 Pro, K8 Pro shipped firmware:** built from older branches. Whether they answer `A0` at all is
  **unconfirmed**; probe.
- **Report rate dividers 2, 4, 5, 6:** inferred from `2^n - 1`, not named in source.
- **Default backlight-off time** (`CONNECTED_BACKLIGHT_DISABLE_TIMEOUT`): value not read.
- **NKRO write:** fails on `2025q3` builds by design (adaptive NKRO). Older firmware may accept it; **unconfirmed**.
- **HE boards (`A9` analog matrix):** actuation, rapid trigger and calibration commands not mapped.
- **Mixed effect ids and the per-key effect number:** which `rgb_matrix` effect shows the `A8` per-key colors is not mapped.
- **OpenRGB:** no native Keychron controller found; an open OpenRGB issue asks for the V4. SignalRGB needs its own
  firmware, which DeviceHub never flashes.
- **Keychron mice:** protocol undocumented; ids beyond the M6 8K example **unconfirmed**.
- **Lemokey non-HE boards** (L3 and others): ids **unconfirmed**.

## Sources

- DeviceHub: `public\devices\via.js`, `CLAUDE.md` ("Adding your own devices")
- [Keychron QMK fork, keychron_raw_hid.h (command ids, feature bits)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/keychron_raw_hid.h)
- [keychron_raw_hid.c (reply layouts, wireless relay, A0-AB handling)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/keychron_raw_hid.c)
- [keychron_common.mk (VIA_INSECURE, APDAPTIVE_NKRO_ENABLE, state notify)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/keychron_common.mk)
- [state_notify.c (unasked notices)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/state_notify.c)
- [nkro.c](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/nkro.c)
- [usb_report_rate.c](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/usb_report_rate.c)
- [dfu_info.c](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/dfu_info.c)
- [debounce/keychron_debounce.c and .h](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/debounce/keychron_debounce.c)
- [snap_click/snap_click.c](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/snap_click/snap_click.c)
- [wireless/wireless.c (sleep timers, LPM get/set)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/wireless/wireless.c)
- [wireless/wireless_config.h (CONNECTED_IDLE_TIME 7200)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/wireless/wireless_config.h)
- [wireless/lkbt51.c and lkbt51.h (raw HID over the radio, 91/92/93)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/wireless/lkbt51.c)
- [wireless/battery.c](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/wireless/battery.c)
- [wireless/wireless.mk (LK_WIRELESS_ENABLE)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/wireless/wireless.mk)
- [rgb/keychron_rgb.c (A8 sub-commands)](https://github.com/Keychron/qmk_firmware/blob/2025q3/keyboards/keychron/common/rgb/keychron_rgb.c)
- Product ids: [q1v1](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q1v1), [q1v2](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q1v2), [q1_max](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q1_max), [q1_he](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q1_he), [k2_max](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/k2_max), [k2_he](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/k2_he), [k8_pro](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/k8_pro), [v1](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/v1), [v1_max](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/v1_max), [v1_8k](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/v1_8k), [q6](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q6), [q6_max](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/keychron/q6_max), [lemokey](https://github.com/Keychron/qmk_firmware/tree/2025q3/keyboards/lemokey)
- [Keychron QMK fork, bluetooth_playground: q1_pro](https://github.com/Keychron/qmk_firmware/tree/bluetooth_playground/keyboards/keychron/q1_pro), [k2_pro](https://github.com/Keychron/qmk_firmware/tree/bluetooth_playground/keyboards/keychron/k2_pro)
- [VIA keyboards library, v3/keychron](https://github.com/the-via/keyboards/tree/master/v3/keychron)
- [QMK raw HID docs (usage page FF60, usage 61)](https://docs.qmk.fm/features/rawhid)
- [NixOS wiki: Keychron M6 (ids D049 / D028, Launcher, no Bluetooth)](https://wiki.nixos.org/wiki/Keychron_M6)
- [Keychron: firmware and JSON files for the C Pro 8K series (example of a maker's JSON page)](https://www.keychron.com/blogs/news/firmware-and-json-files-of-the-keychron-qmk-c-pro-8k-series-keyboards)
- [Keychron K2 HE + M3 bundle page (Launcher: keyboard wired, mouse wired or 2.4 GHz)](https://www.keychron.com/collections/combo/products/keychron-k2-he-keyboard-and-m3-mouse-wireless-elite-bundle)
- [OpenRGB issue 3660 (Keychron V4 request)](https://gitlab.com/CalcProgrammer1/OpenRGB/-/issues/3660)

## Covered in device-library/keychron-via (22 Oct 2026)

A `driver.json` (no code), simulated only (tests/sim-keychron-via.mjs), never run on a real board; status "untested".
- **Boards:** every `3434` keyboard id in section 1 (Q1 v1/v2, Q1 Pro, Q1 Max, Q1 HE, K2 Pro, K2 Max, K2 HE, K8 Pro, V1,
  V1 Max, V1 8K, Q6, Q6 Max), on the cable. Keys, layers, macros and VIA lighting stay with DeviceHub's VIA keyboard.
- **Probe:** `A7 01`; each setting is shown only when its group bit is set (bit 2 debounce, 4 LPM, 5 report rate, 7 NKRO).
  A board that answers `FF` gets no settings.
- **Read and write (read back, old value put back on a mismatch):** debounce method `A7 05` / `A7 06` (types 0-6) and
  time (0-100 ms on the page; the firmware takes 0-255), wireless backlight-off (5-3600 s) and sleep (60-14400 s)
  `A7 0B` / `A7 0C`, report rate `A7 0D` / `A7 0E` (8000, 4000, 1000 Hz only: the other dividers are unconfirmed).
- **Read only:** protocol version, NKRO state `A7 12` (switching fails on 2025q3 firmware).
- **Never sent:** `A7 11`, `A9`, `AA`, `AB`, language, DIP switch, NKRO set, snap click (the file's own never list).
- Not covered: snap click, Keychron per-key lighting `A8`, HE actuation `A9`, battery, the 2.4 GHz receiver, Lemokey
  (`362D`) boards, Keychron mice.
