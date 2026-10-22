# Corsair: bare mapping

Researched 2026-10-22 from public source code and DeviceHub's own HS80 code. Vendor id `1b1c` for everything below.
This is a map for a later developer with the real device in hand, not a tested spec. Every id has a source in the
last section; anything marked **unconfirmed** was not found in a source and must be measured read-only first.

Short names used below:
- **OLH** = OpenLinkHub (Go, `src/devices/<model>/`).
- **ckb** = ckb-next (C, `src/daemon/`).
- **HSC** = HeadsetControl (C++, `lib/devices/`).
- **Linux** = the kernel's `hid-corsair-void.c`.
- **DH** = DeviceHub (`helpers/hs80-direct.js`, `helpers/native/hs80io.cs`, `helpers/native/helper.cs`).

## 1. Most common current models

USB product ids as the sources list them. "Receiver" means the Slipstream dongle the PC sees; "device" means the
headset, mouse or keyboard itself on its USB cable (OLH also uses the device id to recognize the model behind a
receiver).

### Headsets

| Model | Device (cable) id | Receiver id | Protocol | Source |
|---|---|---|---|---|
| HS80 RGB Wireless | `0A69` (also `0A71` behind a receiver) | `0A6B` | bragi | OLH devices.go, headsetdongle.go; DH |
| HS80 RGB USB (wired-only model) | `0A88` | none | bragi (likely; OLH has its own `hs80rgb` package) | OLH devices.go |
| HS80 MAX Wireless | not listed | `0A97`, `2A0F`; Xbox receiver `2A0C` | bragi | OLH devices.go; HSC corsair_void_v2w.hpp |
| Virtuoso RGB Wireless XT | `0A62` | `0A64` | bragi | OLH; HSC corsair_virtuoso_xt.hpp |
| Virtuoso RGB Wireless (original) | `0A41`, `0A43` | `0A42`, `0A44` | bragi (OLH `virtuosoW`) | OLH devices.go, headsetdongle.go |
| Virtuoso SE | `0A3D`, `0A3F` | `0A3E`, `0A40` | bragi (OLH `virtuosoSEW`) | OLH; HSC |
| Virtuoso MAX Wireless | not listed | `2A02`; Xbox `2A03` | bragi | OLH; HSC |
| Void Wireless V2 | not listed | `2A08` | bragi | OLH; HSC |
| Void MAX Wireless V2 | not listed | `2A12`; Xbox `2A05` | bragi | OLH |
| Void Elite Wireless | (wireless: `0A51`, `0A55`, `0A75`) | same ids | **old Void protocol** | Linux; HSC corsair_void_rich.hpp |
| Void Elite USB / Surround | `0A52`, `0A56` / `0A53`, `0A57` | none | old Void protocol | Linux |
| Void Pro Wireless / USB / Surround | `0A14` `0A16` `0A1A` / `0A17` `0A1D` / `0A18` `0A1E` `0A1F` | | old Void protocol | Linux |
| HS70 Pro Wireless | **unconfirmed** | **unconfirmed** | probably old Void protocol (HSC's Void list holds `0A38`, `0A4F`, unnamed) | HSC; a driver site names `0A37`/`0A38` for the HS70 Wireless |
| HS65 Surround / HS55 Wireless | **not found** | **not found** | **unknown**; no open project supports them | none |
| Other "headset dongle" ids | | `0A73` | bragi (model unknown) | OLH devices.go |

Notes:
- HSC names the old-protocol ids only as a list: `0a14 0a16 0a17 0a1d 0a1a 1b2a 1b23 1b29 0a55 0a51 0a52 0a38 0a4f 0a2b 0a75 0a56` (plus `1b27`, `1b1c`). Linux names most of them (table above).
- The HS65 Surround is a USB-adapter headset; HS55 Wireless pairs over 2.4 GHz and Bluetooth. Neither appears in OLH, HSC, ckb or Linux. Treat as plain Windows audio until measured.

### Mice

| Model | Device id(s) | Receiver id | Protocol | Source |
|---|---|---|---|---|
| M75 / M75 Wireless / M75 Air | `1BF0` / `1BF1`, `2B08` / `1BF2` | generic Slipstream | bragi | OLH |
| M65 RGB Ultra / Ultra Wireless | `1B9E` / `1BB5`, `1BD6` | generic Slipstream | bragi | OLH |
| M65 RGB Elite | `1B5A` | none | NXP (not in ckb's bragi list) | OLH; ckb |
| M65 Pro RGB / M65 | `1B2E` / `1B12` | none | NXP | ckb |
| Dark Core RGB Pro / Pro SE | `1B80` / `1B7E` | `1B81` / `1B7F` | bragi | ckb USES_BRAGI; OLH |
| Dark Core RGB SE / Dark Core (2018) | `1B4B` / `1B35` | `1B51` / `1B64` | NXP (ckb "IS_DARK_CORE_NXP") | ckb |
| Harpoon RGB Wireless | `1B5E` | `1B65` | bragi | ckb; OLH |
| Harpoon RGB Pro / Harpoon V2 | `1B75` / `2B2E` | | Pro: NXP in ckb; V2: OLH only | ckb; OLH |
| Sabre RGB Pro / Pro Wireless / Pro CS | `1B79` / `1B98` / `1B7A` | | bragi (OLH) | OLH |
| Sabre V2 Pro / MG | `2B28` / `2B29` | `2B2A` / `2B34` | bragi (OLH) | OLH |
| Sabre RGB (old) | `1B14`, `1B19`, `1B2F`, `1B32` | | NXP | ckb |
| Katar Pro / Pro XT / Pro Wireless | `1B93` / `1BAC` | `1B94` | bragi | ckb; OLH |
| Scimitar RGB Elite (new) / Elite Wireless / Elite Wireless SE | `1BE3` / `1BDB` / `2B22` | | bragi (1BE3 uses 128-byte packets) | ckb; OLH |
| Scimitar RGB Elite (old) / Pro / RGB | `1B8B` / `1B3E` / `1B1E` | | NXP | ckb |
| Ironclaw RGB Wireless | `1B4C` | `1B66` | bragi | ckb |
| Generic Slipstream receivers | | `1BA6`, `1BDC`, `2B00`; V2 `2B1B` | bragi | ckb (`1BA6`); OLH |

### Keyboards

| Model | Ids | Protocol | Packet | Source |
|---|---|---|---|---|
| K70 RGB Pro / Pro Optic | `1BB3` / `1BD4` (OLH also `1BC4`, `1BC6`) | bragi | 1024 bytes (OLH: `1BC4` uses 128) | ckb; OLH |
| K70 Core RGB | `2B0A`, `1BFF`, `1BFD` | bragi | 64 | ckb |
| K70 Core TKL / Pro TKL Wireless | `2B01`, `2B02` / `2B14` | bragi (OLH) | | OLH |
| K70 Max | `1BC0` | bragi (OLH) | | OLH |
| K70 RGB TKL / TKL Champion | `1B73` / `1BB9` | bragi | 1024 | ckb |
| K70 RGB MK.2 (all) / LUX / RapidFire | `1B49` `1B55` `1B6B` / `1B33` / `1B38` | NXP | 64 | ckb |
| K65 RGB Mini / Pro Mini | `1BAF` (OLH also `1BCF`, `1BC3`) / `1BD7` | bragi | 1024 | ckb; OLH |
| K65 Plus Wireless | `2B10`, `2B11`, `2B23`; dongle `2B07` | bragi (OLH) | | OLH |
| K65 RGB / RapidFire | `1B17` / `1B39` | NXP | 64 | ckb |
| K100 RGB (optical, mechanical, variant) | `1B7C`, `1B7D`, `1BC5` | bragi | 1024 | ckb |
| K100 Air | `1BAB` | bragi (OLH) | | OLH |
| K55 Pro / Pro XT | `1BA4` / `1BA1` | bragi | 64 | ckb |
| K55 Core RGB / Core TKL | `1BFE`, `2B05` / `2B20` | bragi (OLH) | | OLH |
| K55 RGB (old) | `1B3D` | NXP (own color packet `07 25 00`) | 64 | ckb |
| K95 Platinum XT | `1B89` | bragi | | ckb |

ckb's protocol enum is exactly three values: `PROTO_NXP`, `PROTO_BRAGI`, `PROTO_LEGACY` (legacy = pre-RGB K65/K70/K90/K95, M95).

## 2. How they talk

### Three protocol families

| Family | Who | Shape |
|---|---|---|
| **bragi** (property get/set) | every headset from HS80 / Virtuoso on; most mice and keyboards from about 2020 (ckb `USES_BRAGI`, all OLH devices) | vendor HID, usage page `FF42` usage `01`, 64-byte reports (some keyboards 128 or 1024); a numbered property table plus open/write/close "handles" for bulk data such as lights |
| **NXP** | older RGB mice and keyboards: K70 MK.2, K65 RGB, K55 RGB, Strafe, M65 Pro/Elite, old Scimitar, old Dark Core, Glaive | 64-byte command packets (`MSG_SIZE 64`); different command set, handled by ckb; not mapped here |
| **old Void** | Void, Void Pro, Void Elite (and probably HS70 / HS70 Pro) | tiny output reports: `C9 64` status, `C9 66` firmware, `C8` lights, `CA 02` alert; sidetone by feature report `FF` (wireless) or a USB audio control transfer (wired) |

### The bragi frame

Commands (ckb `bragi_proto.h`, matching OLH):

| Byte | Meaning |
|---|---|
| `01` | set property |
| `02` | get property |
| `05` | close handle |
| `06` | write data (first chunk) |
| `07` | continue write |
| `08` | read data |
| `09` | probe handle |
| `0d` | open handle (on a resource) |
| `12` | heartbeat (OLH, HSC) |

Headset frame as DH sends it (hs80io.cs): a 64-byte output report
`[02] [endpoint] [command] [property lo] [property hi] [value LE ...]`.
- Report id `02`.
- Endpoint `09` = the headset through the receiver; `08` = the device that is plugged in (the receiver itself, or the headset on its cable). OLH and HSC use the same numbers (`08` receiver, `09` first paired device; OLH: `08 + device slot`).
- Reply: input report id `01`, byte 1 = who answered (`01` headset via receiver, `00` the device itself), byte 2 = the command echoed, byte 3 = status (`00` ok), bytes 4-7 = value little-endian. ckb: error `05` = not supported.
- Notifications: input report `03`, byte 1 = who, byte 2 = `01`, byte 3 = property id, value from byte 5 (DH: mic flip `a6`). OLH also reads battery `0f` and connection status `36` this way.

Mice and keyboards in OLH: the frame has no `02` prefix. The first data byte is the endpoint (`08`, ckb's `BRAGI_MAGIC`), then the command. Reply offsets are one lower (OLH reads mouse battery at bytes 3-4, headset battery at 4-5). The endpoint for a mouse behind a Slipstream receiver is **unconfirmed** (by analogy `09`).

### Receiver vs cable

- The Slipstream receiver is its own bragi device on endpoint `08`. Paired devices sit behind it on `09` and up. OLH lists paired devices with property `24` (open handle `0d 01 24`, read `08 01 24`), and reads each one's product id with property `12` (`02 12`). Status bit field `36` says which sub-devices are online (ckb `BRAGI_SUBDEVICE_BITFIELD`).
- On its cable a device enumerates with its own product id and answers on `08` directly.
- OLH keeps devices awake with a heartbeat every 10 s: `08 12` to the receiver, `<ep> 12` to each device.
- HSC wakes a V2 headset before a battery read with receiver firmware get, receiver heartbeat, headset heartbeat. It avoids software mode there because switching mode makes an audible pop.

### How DeviceHub's HS80 code does it

- Finds the HID collection by vid/pid, usage page `FF42`, usage `01`, 64-byte output report (`HidFind.Find`).
- Tries the cable (`0A69`, ep `08`) first, then the receiver (`0A6B`, ep `09`); keeps a cable standby that takes over when the headset is plugged in.
- Steps back whenever `iCUE.exe` runs, because both would talk on the same channel.
- Reads seven properties one at a time with a 1.5 s cap; battery first; no battery answer = asleep or off, so it skips the rest.
- Lighting: sets mode `03` = `2` (software), opens the lighting handle (`0d 00 01`: handle 0 on resource 1), then writes 9 color bytes with `06 00`, `R0 R1 R2 G0 G1 G2 B0 B1 B2` (logo L, logo R, mic). Resends every 4 s, and re-checks the mode after every silence, because the headset falls back to hardware mode on reconnect.
- Writes only brightness `02` (0-1000), mode `03` (1-2), auto-off `0e` (60,000-7,200,000 ms), each read back after.
- Charging is inferred from voltage `53`, because the HS80 sends no charger notice (DH measured 2026-10-22).
- Sidetone goes through the Windows audio volume control on the receiver (-42 to +4 dB), not bragi.

### What carries over to other headsets

- **Same frame, same ids:** every bragi headset in OLH (HS80 MAX, Virtuoso XT/SE/original, Void V2, Void MAX V2) uses the same set/get, mode `03`, battery `0f`, firmware `13`, sleep `0d`/`0e`, color write `06 00`. A per-model table can cover them.
- **Differs per model:**
  - Mic property: `a6` on HS80 and HS80 MAX, `8e` on Virtuoso XT.
  - Lighting handle resource: `01` on HS80 and Virtuoso XT; `22` (alt lighting, RGBRGB order) on HS80 MAX.
  - Color layout and LED count: HS80 has 3 positions in RRRGGGBBB order. HS80 MAX has 2 zones (logo, mic) with a `12 00` data type tag.
  - Sidetone: bragi `46`/`47` on HS80 MAX, Virtuoso XT and Void V2; Windows audio on HS80.
  - Product ids and receiver ids.
- **Does not carry over:** Void / Void Pro / Void Elite / HS70-family (old Void protocol), and HS65 / HS55 (unknown).

## 3. Settings map

Bragi property ids unless noted. R = read, W = write. "Value" is the little-endian number in bytes 4-7 of a headset reply.

| Setting | Id / command | R/W | Format | Models (source) |
|---|---|---|---|---|
| Battery level | `0f` | R (+ notice) | 0-1000, tenths of a percent | all bragi (DH, OLH, HSC, ckb) |
| Battery / charge status | `10` | R | **values unconfirmed** | named by ckb only; never read in DH |
| Battery voltage | `53` | R | millivolts | HS80 (DH); others unconfirmed |
| Charging (old Void) | `C9 64` report, byte 4 | R | 1 normal, 2 low, 3 critical, 4 full, 5 charging | Void family (Linux, HSC) |
| Firmware (app) | `13` | R | bytes = major, minor, patch (mouse: patch is uint16) | all bragi; also `14` bootloader, `15`/`16` radio (ckb) |
| Vendor / product id | `11` / `12` | R | uint16 | ckb; OLH reads `12` behind a receiver |
| Connection status | `36` | R + notice | sub-device bit field; OLH: `00` offline, `02` online | ckb, OLH |
| Sleep timer on/off | `0d` | W | 0 / 1 | HS80, HS80 MAX, Virtuoso XT, Void V2 (OLH, HSC); mice OLH send `01 0d 00 01` |
| Sleep timer | `0e` | R/W | uint32 ms (OLH 1-60 min; HSC up to 90; DH 1-120) | headsets, mice (OLH); mice also `37` (OLH sends both) |
| Sleep now | `03` = `4` | W | mode value | OLH (all) |
| Light mode | `03` | R/W | 1 hardware, 2 software | all bragi |
| Brightness | `02` | R/W | 0-1000 | HS80 (DH), keyboards (OLH K70 Pro); coarse `44` (ckb) |
| Light colors | open `0d 00 <res>`, then `06 00` + len LE + data | W | HS80: 9 bytes RRRGGGBBB; HS80 MAX: res `22`, `12 00` tag | DH, OLH |
| Mic muted (boom up) | `a6` | R + notice | 1 = muted | HS80, HS80 MAX, Void V2 (DH, OLH, HSC) |
| Mic muted | `8e` | R + notice | 1 = muted | Virtuoso XT (OLH) |
| Mic position (old Void) | `C9 64` report, byte 2 bit 7 | R | 1 = up | Void family (Linux) |
| Mic light | part of the color write | W | the mic position's RGB, in software mode only | HS80 (DH), HS80 MAX, XT (OLH) |
| Sidetone on/off | `46` | W | 0 = on, 1 = off (both OLH and HSC) | HS80 MAX, Virtuoso XT, Void V2 |
| Sidetone level | `47` | W | 0-1000 | HS80 MAX, Virtuoso XT, Void V2 |
| Sidetone (HS80) | Windows audio control | R/W | dB, -42 to +4 | HS80 (DH) |
| Sidetone (old Void) | feature `FF 0B 00 FF 04 0E FF 05 01 04 00 <200+n>` | W | n 0-55 | Void wireless (Linux) |
| ANC | `d1` | W | HSC writes 1 when sidetone is 0 | Void V2 family (HSC); meaning **unconfirmed** |
| Mouse DPI X / Y | `21` / `22` | W (R unconfirmed) | uint16, 100-26000 (M75), 100-18000 (Dark Core Pro) | ckb, OLH |
| DPI stage index / mask | `1e` / `1f` | R/W | | ckb |
| DPI stage colors | `2f`, `30`, `31` | W | | ckb |
| Polling rate | `01` | R/W | 1 = 125 Hz, 2 = 250, 3 = 500, 4 = 1000, 5 = 2000, 6 = 4000, 7 = 8000 | ckb (1-4), OLH (to 7); max rate `96` untested (ckb) |
| Angle snapping | `07` | W | 0 / 1 | ckb, OLH |
| Lift height | `06` | W | 2 low, 3 medium, 4 high, 6 calibrated | OLH (M75) |
| Left-hand mode | `52` | W | 0 / 1 | OLH (M75) |
| Button response optimization | `b0` | W | 0 / 1 | OLH (M75, Dark Core Pro) |
| Keyboard layout | `41` | R | | ckb |
| Keyboard lighting | open `0d 01 22` (+ `0d 00 2e` top bar), write `06 01`, continue `07 01` | W | per-key RGB at the key's packet index; 1024-byte jumbo packets on K70 Pro | OLH K70 Pro; ckb |
| Keyboard brightness | `02` | R/W | 0-1000 (OLH buttons: 300, 600, 1000, 0) | OLH K70 Pro |
| Keyboard Win-lock etc. | `4a`, `45` | W | bit mask | OLH K70 Pro |

## 4. Read-only first, then writes

Safe to read first (get only, no state change):
- `0f`, `10`, `11`, `12`, `13`-`16`, `36`, `53`, `a6` / `8e`, `03`, `02`, `0e`, `01` (polling), `21`/`22` (DPI).
- Listening to notifications (input report `03`).
- Old Void: the `C9 64` and `C9 66` requests only ask for status.

Before any write: read the current value, keep it, write, read back, and restore on mismatch (DH's `set()` does this).
Writes that change only a setting:
- Light mode `03` (1/2), brightness `02`, sleep `0d`/`0e`, sidetone `46`/`47`, polling `01`, DPI `21`/`22`, angle snap `07`, lift `06`.
- Leave software mode (`03` = `1`) when DeviceHub stops, as OLH does, so the device lights itself again.

Never:
- Firmware update, bootloader or radio paths. Nothing here maps them, and nothing should.
- Pairing: resources `05` (pairing id) and `06` (encryption key) per ckb. Never open handles on them.
- Writes to key assignment / macro handles (`0d 01 02`, `06 01` on mice) until a backup and restore is proven.
- Any property not in this table: probe with get only. A `05` status means not supported; stop.
- Running beside iCUE. Both talk on the same channel (DH already gives way).

## 5. What DeviceHub would build

### A "Corsair bragi" adapter

Split `hs80-direct.js` into:
1. **`corsair-bragi.js` (transport).** Opens a `FF42`/`01` collection by vid/pid. Endpoint routing (`08` device, `09`+ behind a receiver). `get(id)`, `set(id, value)` with read-back, `openHandle(res)`, `writeData(handle, bytes)`, notifications, heartbeat. The C# side already does this (`Hs80Io`). Its `Set` whitelist becomes per-model ranges passed from the table. Add a `prefix02` flag (headsets yes, mice and keyboards no) and a report size (64 / 128 / 1024).
2. **`corsair-models.js` (per-model table).** One row per model:
   - device id, receiver ids
   - mic property (`a6` or `8e`)
   - lighting resource (`01` / `22`) and color layout (RRRGGGBBB or RGBRGB, zones, data type tag)
   - LED positions
   - sidetone route (`bragi 46/47` or `windows`)
   - readable ids, writable ids with ranges
   - sleep id(s)
3. **`hs80-direct.js`** keeps its HS80-only behavior: the cable standby, the voltage-based charging check, and the 4 s light keep-alive. It reads its ids from the table.
4. **Discovery.** On a known receiver id, ask the receiver for paired devices (`24` handle read) or ask `12` on `09`, `0a` ... to learn the model behind it. This is how one receiver id (`0A6B`) can host different headsets.

### Order

| Step | What | Effort | Risk |
|---|---|---|---|
| 1 | Refactor HS80 onto transport + table, no behavior change | 1 day | low (HS80 in hand to verify) |
| 2 | HS80 MAX, Virtuoso XT, Void V2: read-only (battery, firmware, mic, sleep) | 0.5 day each with the device | low |
| 3 | Same headsets: software lights + mic light, sleep timer, bragi sidetone | 1 day each | low-medium (lighting resource and order differ) |
| 4 | Bragi mice (M75, M65 Ultra, Dark Core Pro, Katar Pro, Sabre, Harpoon Wireless): battery, DPI, polling read; then DPI and polling write | 2-3 days | medium (no `02` prefix, receiver endpoint unconfirmed) |
| 5 | Bragi keyboards (K70 Pro/Core, K65 Mini/Plus, K100, K55 Pro): brightness, polling; per-key lights need key maps (OLH `keyboards` package) | 3-5 days | medium (1024-byte packets, chunked writes) |
| 6 | Old Void headsets: battery, mic position, charging, LED on/off, sidetone | 1-2 days | low (tiny, documented by Linux) |
| 7 | NXP mice and keyboards | large | medium-high; better left to OpenRGB (lighting) |

Lighting for most Corsair mice and keyboards is also reachable through OpenRGB, which DeviceHub already talks to. So steps 4-5 can stop at battery, DPI and polling.

## 6. Gaps and unknowns

- **HS65 Surround, HS55 Wireless:** no product ids and no protocol found in any open project.
- **HS70 Pro Wireless:** product id not confirmed. HSC's old-protocol list holds unnamed `0A38` and `0A4F`, and a driver site names `0A37`/`0A38` for the HS70 Wireless. Assumed old Void protocol; measure.
- **Battery status `10`:** named in ckb, but no value meanings were found. DH never reads it. The HS80 sends no charger notice at all.
- **HS80 MAX device (cable) id:** not listed; only its receivers.
- **Mouse/keyboard endpoint behind a Slipstream receiver:** by analogy `09`, unconfirmed. Also unconfirmed: whether the `02` report-id prefix applies to some mouse interfaces on Windows (OLH is written for Linux hidapi).
- **Sidetone `46` polarity:** 0 = on in both OLH and HSC; worth a read-back check. The `d1` "ANC" write's real effect is unknown.
- **DPI read-back:** sources only set `21`/`22`; whether a get returns them is unconfirmed.
- **Property `37` vs `0e`** for mouse sleep: OLH writes both and does not say which one each model honors.
- **`0A71`:** OLH maps it to the HS80 RGB Wireless behind a receiver; the meaning (revision or region) is unknown.
- **Old Void lights:** HSC says `C8 00` = on and `C8 01` = off. Linux has no light command. Unverified.
- **iCUE SDK:** exposes only coarse properties (`CDPI_MicEnabled`, `CDPI_SidetoneEnabled`, `CDPI_BatteryLevel`, `CDPI_EqualizerPreset`, and similar), with per-device read/write flags. No firmware, DPI or sleep timer. It needs iCUE running.

## Sources

- DeviceHub: `C:\Users\shawn\DeviceHub\helpers\hs80-direct.js`, `helpers\corsair.js`, `helpers\native\hs80io.cs`, `helpers\native\helper.cs` (HandleHs80), `public\devices\headset-adapter.js`
- [OpenLinkHub devices.go (product id table)](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/devices.go)
- [OpenLinkHub headsetdongle.go (receiver, paired-device discovery, heartbeat, notices)](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/headsetdongle/headsetdongle.go)
- [OpenLinkHub hs80rgbW.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/hs80rgbW/hs80rgbW.go)
- [OpenLinkHub hs80maxW.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/hs80maxW/hs80maxW.go)
- [OpenLinkHub virtuosorgbXTW.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/virtuosorgbXTW/virtuosorgbXTW.go)
- [OpenLinkHub m75W.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/m75W/m75W.go)
- [OpenLinkHub darkcorergbproW.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/darkcorergbproW/darkcorergbproW.go)
- [OpenLinkHub k70pro.go](https://github.com/jurkovic-nikola/OpenLinkHub/blob/main/src/devices/k70pro/k70pro.go)
- [ckb-next bragi_proto.h (commands, property ids, resources)](https://github.com/ckb-next/ckb-next/blob/master/src/daemon/bragi_proto.h)
- [ckb-next usb.h (product ids, USES_BRAGI, packet sizes)](https://github.com/ckb-next/ckb-next/blob/master/src/daemon/usb.h)
- [ckb-next structures.h (MSG_SIZE, protocol enum)](https://github.com/ckb-next/ckb-next/blob/master/src/daemon/structures.h)
- [ckb-next bragi_common.c (reply layout)](https://github.com/ckb-next/ckb-next/blob/master/src/daemon/bragi_common.c)
- [ckb-next led_keyboard.c (NXP K55 color packet)](https://github.com/ckb-next/ckb-next/blob/master/src/daemon/led_keyboard.c)
- [HeadsetControl corsair_void_v2w.hpp (HS80 MAX, Virtuoso MAX, Void V2)](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/corsair_void_v2w.hpp)
- [HeadsetControl corsair_virtuoso_xt.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/corsair_virtuoso_xt.hpp)
- [HeadsetControl corsair_void_rich.hpp (old Void protocol)](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/corsair_void_rich.hpp)
- [HeadsetControl corsair_device.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/corsair_device.hpp)
- [HeadsetControl README (supported devices)](https://github.com/Sapd/HeadsetControl/blob/master/README.md)
- [Linux hid-corsair-void.c (Void ids, status report, charging values)](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-corsair-void.c)
- [Corsair iCUE SDK documentation](https://corsairofficial.github.io/cue-sdk/)
- [Driver database entry naming HS70 Wireless ids 0A37/0A38](https://treexy.com/products/driver-fusion/database/human-interface-devices/corsair/hs70-wireless-gaming-headset/)
