# Logitech G (USB vendor id 0x046D)

A bare mapping for DeviceHub. Every id and byte below comes from an open-source project, cited in the
Sources section. Anything marked **unconfirmed** was not found in a source, or the sources disagree.
Nothing here has been tested on a real device. Researched 2026-10-22.

Almost every current Logitech G mouse and keyboard speaks **HID++ 2.0**: a feature-based protocol where
you first ask the device which slot (feature index) holds a feature id, then call functions on that slot.
Newer wireless headsets (PRO X 2, G522) speak a 64-byte variant that Solaar and HeadsetControl call
**Centurion**. ASTRO headsets use their own non-HID++ protocol.

## 1. Common current models

### Mice

| Model | Wired / USB PID | Receiver PID | Wireless id (wpid) | Source |
|---|---|---|---|---|
| PRO X SUPERLIGHT 2 | 0xC09B | **unconfirmed** | **unconfirmed** | Linux `hid-logitech-hidpp.c` |
| PRO X SUPERLIGHT | 0xC094 | - | 0x4093 | libratbag, Solaar `descriptors.py`, Linux |
| PRO 2 LIGHTSPEED | 0xC09A | **unconfirmed** | **unconfirmed** | Linux |
| G502 X LIGHTSPEED | 0xC098 | - | 0x409F | libratbag `logitech-g502-x-wireless.device`, Linux |
| G502 X PLUS | 0xC095 | - | 0x4099 | libratbag, OpenRGB, Linux |
| G502 X (wired) | 0xC099 | - | - | libratbag |
| G305 | (wireless only) | - | 0x4074 | libratbag `logitech-g305.device` |
| G PRO Wireless | 0xC088 | - | 0x4079 | libratbag, OpenRGB, Linux |
| G703 HERO / G903 HERO | 0xC090 / 0xC091 | - | 0x4086 / 0x4087 | OpenRGB, Linux |
| G502 LIGHTSPEED | 0xC08D | - | 0x407F | OpenRGB, Linux |

The "wpid" is the id the receiver reports for a paired device. libratbag and OpenRGB list it as a
product id because the Linux `hid-logitech-dj` driver creates a child device with that id. On Windows
there is no such child device: DeviceHub opens the **receiver** and addresses the mouse by its pairing
slot (section 2), then reads the wpid from the receiver's pairing table. libratbag quirks worth keeping:
G502 X family uses `INDEX_OFFSET` (onboard profile index is 1-based); G502 X PLUS puts its LED in the
second slot; G305 has LEDs off. G PRO Wireless sets `DeviceIndex=1`.

### Lightspeed receivers (Solaar `base_usb.py`)

| PID | Type | HID++ interface |
|---|---|---|
| 0xC539, 0xC53A, 0xC53D, 0xC53F, 0xC541, 0xC545, 0xC547, 0xC54D | Lightspeed | 2 |
| 0xC548 | Bolt (up to 6 devices) | 2 |
| 0xC52B, 0xC532 | Unifying | 2 |

OpenRGB names 0xC53A the POWERPLAY mat, 0xC541 and 0xC547 G915 receivers, and 0xC545 the G915 TKL
receiver. Which receiver ships with the Superlight 2 is **unconfirmed** (0xC54D is the newest id in
Solaar's list; no source ties it to a model). Solaar also accepts any unknown receiver in 0xC500-0xC5FF.

### Keyboards

| Model | Wired PID | Receiver PID | Source |
|---|---|---|---|
| G915 | 0xC33E | 0xC541, 0xC547 | OpenRGB `LogitechControllerDetect.cpp` |
| G915 TKL | 0xC343 (wpid 0x408E, Bluetooth 0xB35F) | 0xC545 | OpenRGB, Solaar, Linux |
| G815 | 0xC33F | - | OpenRGB, Solaar |
| G813 | 0xC232 (HID++ on interface 1, usage page 0xFF43 usage 0x0602) | - | OpenRGB `LogitechControllerDetect.cpp` @ bbc77470 (lines 58, 1531); not in Solaar, Linux or libratbag |
| G515 LIGHTSPEED TKL | 0xC355 (wpid 0x40B4) | **unconfirmed** | OpenRGB |
| G512 | 0xC33C | - | Solaar |
| G213 | 0xC336 | - | OpenRGB, Solaar |
| PRO Gaming Keyboard | 0xC339 | - | Solaar |
| PRO X TKL, G915 X | **unconfirmed** | **unconfirmed** | not found in any source read |

### Headsets

| Model | PID | HID interface | Protocol | Source |
|---|---|---|---|---|
| PRO X 2 LIGHTSPEED | 0x0AF7 | iface 3, usage page 0xFFA0, usage 0x01 | Centurion, report 0x51 | HeadsetControl `logitech_gpro_x2_lightspeed.hpp` |
| G522 LIGHTSPEED | 0x0B18 (dongle), 0x0B19 (USB) | **unconfirmed** | Centurion, report 0x50 | OpenRGB, Solaar `base.py`, HeadsetControl |
| G733 | 0x0AB5, 0x0AFE, 0x0B1F | usage page 0xFF43, usage 0x0202 | HID++ 2.0 | HeadsetControl `logitech_g633_g933_935.hpp`, Solaar |
| G935 / G933 / G635 / G633 | 0x0A87 / 0x0A5B / 0x0A89 / 0x0A5C | usage page 0xFF43, usage 0x0202 | HID++ 2.0 | HeadsetControl, OpenRGB |
| G535 | 0x0AC4 | iface 3, usage page 0x0C, usage 0x01 | HID++ (fixed indexes) | HeadsetControl `logitech_g535.hpp` |
| ASTRO A50 Gen 5 | 0x0B1C (vendor 046D) | iface 8, usage page 0xFF32, usage 0x0074 | ASTRO, report 0x02 | HeadsetControl `logitech_astro_a50.hpp` |
| ASTRO A50 Gen 4 | 0x002C (vendor **0x9886**) | iface 6, usage page 0xFF32, usage 0x0074 | ASTRO, report 0x02 | HeadsetControl `logitech_astro_a50_gen4.hpp` |

Solaar treats the G533/G535/G935/G733 as HID++ 2.0 on interface 3. The A50 Gen 4 base must be in PC
mode; in console mode it re-enumerates as 9886:002B with no HID interface (HeadsetControl).

## 2. How they talk

### Transport

| Report id | Name | Total length | Source |
|---|---|---|---|
| 0x10 | HID++ short | 7 bytes | Solaar `base.py`, Linux, HeadsetControl |
| 0x11 | HID++ long | 20 bytes | same |
| 0x12 | HID++ very long | up to 64 bytes | Linux |
| 0x20 | DJ (receiver) | 15 bytes | Solaar |
| 0x51 / 0x50 | Centurion (PRO X 2 / G522) | 64 bytes | Solaar, HeadsetControl |

- On Windows the HID++ endpoint shows up as its own HID collection with a vendor usage page.
  OpenRGB matches usage page **0xFF00, usage 0x02** (the long-report collection) and notes it is the
  one Windows accepts writes on. Other signatures it matches: 0xFF43 (Bluetooth and headsets),
  interface 1 with 0xFF00, and 0xFFA0 usage 1 (Centurion). The short-report collection's usage is
  **unconfirmed** in the sources read. HeadsetControl always sends long reports; Solaar sends short
  ones when the params fit. Whether every G device accepts a long report for every function is
  **unconfirmed**; test on the real device.
- **Device index (byte 1):** 0xFF addresses a wired device directly, or the receiver itself.
  0x01-0x06 address a device paired to a receiver (Bolt holds 6). Solaar also accepts a reply whose
  index is `request ^ 0xFF` (Bluetooth devices answer with 0x00).
- Lightspeed receivers usually hold one device. Solaar does not set `max_devices` for them and its
  comments say a default of 1 applies when the receiver cannot report its slot count (**unconfirmed**
  for each receiver).

### Message format (HID++ 2.0)

```
byte 0  report id (0x10 short / 0x11 long)
byte 1  device index (0xFF wired, 1..6 paired)
byte 2  feature index (0x00 = IRoot)
byte 3  high nibble = function number, low nibble = software id (non-zero)
byte 4+ parameters (3 bytes short, 16 bytes long), zero padded
```

Solaar writes the function as a byte such as 0x10, 0x20 and puts its software id (0x0B) in the low
nibble. A software id of 0 is reserved for device notifications. Multi-byte values are big-endian.

**Feature lookup (IRoot 0x0000, always at index 0):**
- `getFeature` = function 0x00, params = feature id as 2 bytes big-endian. Reply byte 0 = feature
  index (0 = not present), byte 1 = flags, byte 2 = version. (Solaar `hidpp20.py`, lekensteyn `x0000_root`)
- `ping` / protocol version = function 0x10, params `00 00 <mark>`. Reply byte 0 = major, byte 1 =
  minor, byte 2 = the mark echoed. A HID++ 1.0 error reply here means a 1.0 device. (Solaar `base.py`)
- **IFeatureSet 0x0001:** function 0x00 returns the feature count (Solaar adds 1 for Root); function
  0x10 with an index returns feature id (2 bytes), flags, version. Use it once to list every feature.

Cache the index for each feature id per device; it differs between models and can change after a
firmware update.

**Replies:** a reply echoes bytes 1-3 (device index, feature index, function + software id). Solaar
matches on those. Timeouts Solaar uses: 0.9 s for the receiver, 4 s for devices.

**Errors:**

| Kind | Layout after report id | Error code |
|---|---|---|
| HID++ 2.0 | `<dev> FF <feature idx> <fn+swid> <code>` | 0x01 unknown, 0x02 invalid argument, 0x03 out of range, 0x04 hardware, 0x05 Logitech internal / not allowed, 0x06 invalid feature index, 0x07 invalid function, 0x08 busy, 0x09 unsupported |
| HID++ 1.0 (receiver, old devices) | short report, `<dev> 8F <sub id> <address> <code>` | 0x01 invalid sub id ... 0x09 resource error ... 0x0C wrong PIN |

(Solaar `hidpp20_constants.py` ErrorCode, Linux `hid-logitech-hidpp.c`.) HeadsetControl treats byte 2
== 0xFF from a headset as "device offline".

### Unsolicited messages

- **Feature events** arrive as normal HID++ reports with software id 0, so byte 3 is the event number
  in the high nibble and 0 in the low nibble. Solaar dispatches on (feature index, byte 3):
  - 0x1000 / 0x1001 / 0x1004 battery: event 0x00, same layout as the "get status" reply.
  - 0x8100 onboard profiles: event 0x00 = profile changed (sector, 2 bytes); event 0x10 = DPI index
    changed (byte 0), which is how the **DPI button** shows up in onboard mode.
  - 0x1B04 diverted buttons: event 0x00 = up to four pressed control ids (2 bytes each); 0x10 = raw XY.
  - 0x1982 backlight: event 0x00, level in byte 1. 0x8040 brightness: event 0x00, value 2 bytes.
  - 0x1D4B wireless device status: event 0x00, byte 1 == 1 means the device rebooted / reconnected
    and wants its settings re-applied.
- **Receiver events** (device index = slot): Solaar handles a connect/link notification whose sub id it
  names DJ_PAIRING and a disconnect it names CONNECT_DISCONNECT. Their numeric values (0x41 / 0x40) are
  **unconfirmed** in the excerpt read. In the connect event, flags are the high nibble of byte 0, link
  is up when flag 0x40 is clear, and the wpid is bytes 2 then 1.
- Solaar's rule for "is this a notification": sub id >= 0x40, or software id 0, and not 0x8F/0xFF.

### Centurion (PRO X 2, G522)

Frame: `51 <len> <flags=00> <feature idx> <(fn & 0xF0) | 0x01> <params...>` padded to 64 bytes;
`len` = payload length + 1. The G522 prefix is `50 23` (HeadsetControl). Root is index 0 and
`getFeature` is function 0x00 with a 2-byte id, as in HID++ 2.0. Headset features sit behind a
**bridge** feature (0x0003) that wraps sub-messages; replies, acks and connection events are told
apart as described in HeadsetControl `logitech_centurion_protocol.hpp`. Centurion feature ids (Solaar):
0x0104 battery state of charge, 0x0108 auto sleep, 0x0601 mic mute, 0x0604 sidetone, 0x0636 onboard EQ,
0x020D advanced parametric EQ, 0x0618 battery saver, 0x0611 mic gain.

## 3. Settings map

Function codes are the byte-3 value (function << 4). "Solaar" = `settings_templates.py` / `hidpp20.py`.

| Setting | Feature | Read | Write | Value format | Notes / source |
|---|---|---|---|---|---|
| Battery (old) | 0x1000 BATTERY_STATUS | 0x00 | - | b0 level %, b1 next level, b2 status: 0 discharging, 1 recharging, 2 final stage, 3 full, 4 slow recharge, 5-7 errors | caps fn 0x10. Linux, Solaar |
| Battery voltage | 0x1001 BATTERY_VOLTAGE | 0x00 | - | b0-1 mV (BE), b2 flags: bit7 = charging, low 3 bits 0 charging / 1 full / 2 not charging; bit3 fast, bit4 slow, bit5 critical | % comes from a per-model voltage curve. Linux, Solaar |
| Battery (unified) | 0x1004 UNIFIED_BATTERY | 0x10 | - | b0 % (state of charge), b1 level bits (1 critical, 2 low, 4 good, 8 full), b2 charging: 0 discharging, 1 charging, 2 slow, 3 complete, 4 error; b3 external power | caps fn 0x00: b1 bit1 = reports %. Most current G mice. Linux, Solaar |
| Battery (ADC) | 0x1F20 ADC_MEASUREMENT | 0x00 | - | b0-1 mV, b2 flags: bit0 valid, bit1 recharging | Used by headsets. Solaar, Linux |
| Battery (Centurion) | 0x0104 | 0x00 | - | b0 %, b2 state (1 or 2 = charging) | PRO X 2. HeadsetControl |
| DPI | 0x2201 ADJUSTABLE_DPI | 0x20 `[sensor]` | 0x30 `[sensor, dpi_hi, dpi_lo]` | reply b1-2 current DPI, b3-4 default DPI | sensor count fn 0x00. libratbag, Solaar |
| DPI list | 0x2201 | 0x10 `[sensor]` | - | 2-byte entries from b1, ended by 0x0000; an entry >= 0xE000 means "range": step = value & 0x1FFF, next entry = max DPI | libratbag, Solaar |
| DPI X/Y + lift-off | 0x2202 EXTENDED_ADJUSTABLE_DPI | 0x50 | 0x60 `[00, X(2), Y(2), LOD]` | LOD 0 low, 1 medium, 2 high | caps fn 0x10 (b2 bit0 = separate Y, bit1 = LOD); list fn 0x20. Solaar |
| Report rate | 0x8060 REPORT_RATE | 0x10 | 0x20 `[ms]` | 1 byte, interval in ms (1/2/4/8) | list fn 0x00: bitmask, bit i = (i+1) ms. Solaar, libratbag |
| Report rate (8K) | 0x8061 EXTENDED_ADJUSTABLE_REPORT_RATE | 0x20 | 0x30 `[index]` | index 0=8 ms, 1=4 ms, 2=2 ms, 3=1 ms, 4=500 us, 5=250 us, 6=125 us (8000 Hz) | list fn 0x10, bits 0-6 of 2 bytes. Solaar. Which Superlight 2 firmware uses it: **unconfirmed** |
| Onboard / host mode | 0x8100 ONBOARD_PROFILES | 0x20 | 0x10 `[01 onboard / 02 host]` | 1 byte | Host mode makes the device take settings live; onboard uses stored profiles. libratbag, Solaar |
| Active profile | 0x8100 | 0x40 | 0x30 `[00, index]` | 2 bytes | G502 X family is 1-based (libratbag quirk) |
| DPI slot in profile | 0x8100 | 0xB0 | 0xC0 `[index]` | 0-4 | libratbag |
| Profile memory | 0x8100 | 0x50 `[sector(2), offset(2)]` -> 16 bytes | 0x60 start, 0x70 16-byte chunks, 0x80 end | sector holds a CRC-CCITT in its last 2 bytes | **Back up every sector before any write.** Profile layout: report rate, default DPI, 5 DPI slots, power-save / power-off timeouts, buttons, name, LEDs. libratbag |
| Surface tuning | 0x2240 SURFACE_TUNING | **unconfirmed** | **unconfirmed** | **unconfirmed** | Only the id is in Solaar's list |
| LED zones (older) | 0x8070 COLOR_LED_EFFECTS | 0xE0 `[zone]` | 0x30 `[zone, effect...]` | effect id + 10 param bytes; libratbag sets b12 = 1 "RAM and flash" | info 0x00, zone info 0x10, effect info 0x20; SW control read 0x70 / write 0x80. Solaar, libratbag |
| RGB / LIGHTSYNC | 0x8071 RGB_EFFECTS | none | 0x10 `[cluster, effect..., 01]` | effect ids: 0x00 off, 0x01 static, 0x02 pulse, 0x03 cycle, 0x0A breathe, 0x16 wave (Solaar samples) | SW control fn 0x50 (write `01 03` = software, `01 00` = device); info 0x00; startup/shutdown animation 0x30. Solaar, libratbag |
| Per-key RGB (keyboards) | 0x8081 PER_KEY_LIGHTING_V2 | 0x00 (which keys exist, bitmap) | 0x10 `[key, r, g, b]` (repeatable); 0x50 range `[first, last, r, g, b]`; 0x60 `[r, g, b, keys...]`; 0x70 `[00]` commit | 24-bit RGB | No read-back of colors. Needs SW control on 0x8071 first (**unconfirmed** ordering). Solaar |
| Keyboard brightness | 0x8040 BRIGHTNESS_CONTROL | 0x10 | 0x20 `[hi, lo]` | 2 bytes; on/off read 0x30 / write 0x40; info 0x00 | Solaar |
| Keyboard backlight (non-RGB) | 0x1982 BACKLIGHT2 / 0x1983 BACKLIGHT3 | 0x1983: 0x10 | 0x1983: 0x20 + suffix `09` | 0x1982 modes 0xFF off, 0x00 on, 0x01 auto, 0x02 manual; 0x1983 level 0-1000 | Mostly MX/office boards, rare on G. Solaar |
| G-key divert | 0x8010 GKEY | not supported | 0x20 `[01 / 00]` | 1 = keys go to host software as events | count fn 0x00 (**unconfirmed**). Solaar |
| M-key LEDs / MR | 0x8020 MKEYS / 0x8030 MR | - | 0x8020 fn 0x10 bitmask; 0x8030 fn 0x00 | bit i = M(i+1) | Solaar |
| Button remap / divert | 0x1B04 REPROG_CONTROLS_V4 | 0x20 `[cid(2)]` | 0x30 `[cid(2), flags, remap(2)]` | flags 0x01 divert, 0x04 persist, 0x10 raw XY | count 0x00, info 0x10. libratbag. On G mice, buttons are normally set in the onboard profile instead |
| Sidetone (HID++ headsets) | fixed index 0x07, fn 0x1A | - | `[07 1A level]` | 0-100 | G633/G733/G933/G935. HeadsetControl hardcodes the index; DeviceHub should look up 0x8300 SIDETONE instead (Solaar: range 0-100, default fns 0x00/0x10) |
| Sidetone (G535) | fixed `04 1D` | - | `[04 1D level]` | 0-100, reply b4 echoes | HeadsetControl |
| Sidetone (Centurion) | 0x0604 HEADSET_AUDIO_SIDETONE | 0x00 | 0x10 `[01 FF level]` (v2+) or `[01 level]` | 0-100 | PRO X 2. HeadsetControl, Solaar |
| Auto-off (G535) | fixed `05 2D` | - | `[05 2D min]` | 0, 1, 2, 5, 10, 15, 30 min | HeadsetControl |
| Auto-off (Centurion) | 0x0108 CENTURION_AUTO_SLEEP | 0x00 | 0x10 `[minutes]` | 0-255 (layout changes with version 3 / 4+) | HeadsetControl, Solaar |
| Auto-off (ADC headsets) | 0x1F20 v2+ | 0x10 | 0x20 | 0-255 min, 0 = never | Solaar ADCPower |
| Mic mute | 0x0601 HEADSET_MIC_MUTE | 0x10 | 0x20 `[0/1]` | 1 = muted; events 0x00/0x10 | G522 in Solaar. Not done for PRO X 2 in HeadsetControl |
| EQ (HID++ headsets) | 0x8310 EQUALIZER | 0x20 `[00]` | 0x30 `[02, gains...]` | caps 0x00: band count, dB range, min, max; freqs 0x10 | Solaar |
| EQ (Centurion) | 0x0636 HEADSET_ONBOARD_EQ / 0x020D ADV. PARA EQ | 0x10 | 0x20 | band = freq(2), gain int8 (-12..12), Q | PRO X 2: 5 bands 80/240/750/2200/6600 Hz. HeadsetControl, Solaar |
| Headset lights (G633 family) | fixed `04 3C` | - | `[04 3C zone mode 00 B6 FF 0F A0 00 64 00 00 00]` | zone 0 logo, 1 strips; mode 0 off, 2 breathing | HeadsetControl |
| Mouse sleep timer | inside onboard profile (power-save / power-off timeout, 2 bytes each) | via 0x8100 | via 0x8100 | **unconfirmed** units | libratbag struct. No separate HID++ feature found for G mice |
| RGB idle timeout | 0x8071 | - | - | host-side timer in Solaar, no device function | Solaar |

### ASTRO A50 (not HID++)

Frames are 64 bytes, report id 0x02. Gen 5 (HeadsetControl `logitech_astro_a50.hpp`):
`02 0C <len> 00 <cmd> <handle> <payload>`; battery get `02 0c 03 00 06 0c`, reply byte 6 = %, byte 8
non-zero = docked/charging; sidetone set `02 0c 06 00 09 1c 01 ff <0-6>`; chat mix get cmd 0x0A.
Gen 4: `02 <cmd> <len> <payload>`; battery cmd 0x7C (reply byte 3: bit 7 charging, bits 0-6 %);
sidetone set `02 62 02 05 <0-100>`, get `02 68 01 05`; EQ preset 0x67; chat mix 0x72. Reply status
byte 1: 0x00 ok, 0x01 error, 0x02 ok with payload. Auto-off is **not implemented** in either file.

## 4. Read-only first, then writes

**Safe reads (no state change):** IRoot ping and `getFeature`; IFeatureSet list; 0x0003 firmware
version and 0x0005 device name (function codes **unconfirmed** here); all battery features; 0x2201
sensor count / DPI list / current DPI; 0x8060 / 0x8061 rate list and current rate; 0x8100 info (fn 0x00),
mode (0x20), current profile (0x40), DPI index (0xB0) and memory read (0x50); 0x8070/0x8071 info
functions; 0x1B04 count / info / get reporting; Centurion battery and sidetone reads.

**Writes that are volatile or easy to undo:** DPI (0x2201 fn 0x30) and report rate in **host mode**;
sidetone; mic mute; RGB in software-control mode (lost on unplug).

**Risky writes:**
- 0x8100 **memory writes (0x60/0x70/0x80)** rewrite flash. A bad sector or CRC can leave the mouse
  with no usable profile. Read and save every sector to disk first; write only a sector you read back
  byte-for-byte.
- 0x8100 **mode switch to host (0x02)**: settings stop persisting; the device falls back to onboard on
  re-plug. Not harmful, but users will see "my settings reset".
- 0x8070 set-zone-effect with the "flash" byte set writes non-volatile memory.
- 0x1B04 with the persist flag, 0x1C00 persistent remap: stored on the device.
- **Never touch:** 0x00C0 / 0x00C1 / 0x00C2 / 0x00C3 DFU control and 0x00D0 DFU (firmware update),
  Centurion 0x010A generic DFU, 0x1802 device reset, 0x1805 OOB state, 0x1500 force pairing, and any
  receiver pairing / unpairing register. Filter these feature ids out in the adapter so no code path
  can call them.

## 5. What DeviceHub would build

**Adapter outline (`logitech` adapter, C# helper does the HID I/O):**
1. **Enumerate** vendor 0x046D HID collections. Keep usage page 0xFF00 usage 0x02 (mice, keyboards,
   receivers), 0xFF43 usage 0x0202 (older headsets), 0xFFA0 usage 0x01 (Centurion), 0xFF32 usage 0x74
   (ASTRO, also vendor 0x9886).
2. **Classify:** PID in 0xC500-0xC5FF = receiver; otherwise a direct device at index 0xFF.
3. **Receiver:** read its pairing table (HID++ 1.0 register reads; exact registers **unconfirmed**, see
   Solaar `receiver.py`), then ping slots 1-6. A slot that answers ping is a device.
4. **Per device:** ping for protocol version; IFeatureSet to list features; cache {feature id -> index}.
   Refuse any DFU / reset id from the deny list.
5. **Read state:** name, firmware, battery (prefer 0x1004, else 0x1000, else 0x1001 / 0x1F20),
   DPI list + current, report rate, onboard mode + active profile.
6. **Listen:** one reader thread per handle; route replies by (device index, feature index, function,
   software id) and everything with software id 0 to an event bus (battery, DPI index, reconnect).
   On 0x1D4B "reconfigure" or a receiver connect event, re-apply host-mode settings.
7. **Write one setting and read it back:** start with report rate (0x8060 fn 0x20, then fn 0x10) in
   host mode, then DPI (0x2201 fn 0x30, then fn 0x20). Never trust the write's echo alone.
8. **Headsets:** separate small adapters: HID++ (look up 0x8300 / 0x1F20 rather than HeadsetControl's
   fixed indexes), Centurion (bridge framing), ASTRO (its own framing).

**Order:** (1) enumerate + ping + feature list on one wired mouse; (2) battery on a wireless mouse
through the receiver; (3) report rate and DPI writes in host mode; (4) event listener; (5) RGB in
software mode (0x8071, then 0x8081 for keyboards); (6) headset battery and sidetone (G733, then PRO X 2);
(7) onboard-profile **backup only** (read all sectors to a file); (8) onboard-profile edits last,
behind a confirm and an automatic backup.

**Effort and risk:**

| Piece | Effort | Risk |
|---|---|---|
| HID++ core (framing, ping, feature table, reply routing) | 2-3 days | low |
| Receiver slots + wpid | 1-2 days | low |
| Battery, DPI, report rate (host mode) | 1-2 days | low |
| Events + reconnect re-apply | 1 day | low |
| RGB (0x8070 / 0x8071 / 0x8081) | 3-4 days | medium (effect param layouts per model) |
| Headsets (three protocol families) | 3-5 days | medium |
| Onboard profile read / backup | 2 days | low |
| Onboard profile write | 3-5 days | **high** (flash, CRC, per-model layouts) |

Windows note: G HUB (LGHUB) usually holds the same HID++ collection and switches devices to host mode
itself. Running both will fight; DeviceHub should detect `lghub_agent.exe` and tell the user
(**unconfirmed** whether writes collide or just get overwritten).

## 6. Gaps and unknowns

- PIDs and wpids for **PRO X SUPERLIGHT 2 over the receiver, PRO 2 LIGHTSPEED, PRO X TKL, G915 X,
  G309, ASTRO A50 X**: not in any source read. Read them off the real device (Device Manager hardware id
  and the receiver pairing table).
- Which receiver PID ships with each current mouse (0xC547 / 0xC54D likely for recent models,
  **unconfirmed**).
- Whether the Superlight 2 exposes 0x8060 or 0x8061 for 8 kHz, and whether 8 kHz needs a specific
  receiver or firmware.
- Surface tuning (0x2240): id only, no format found. Lift-off is only known through 0x2202's LOD byte.
- Exact Windows usage of the short-report collection (usage 0x01 assumed); whether writes must go to
  the long collection only.
- 0x0003 firmware and 0x0005 name function codes were not pulled from a source for this sheet.
- G733 auto-off and mic mute: no HeadsetControl packet for them in the file read.
- Mouse sleep-timer units inside the onboard profile.
- HID++ 1.0 receiver registers for the pairing table (Solaar `receiver.py` not read for this sheet).
- Logitech's public spec PDFs cover only a few features (Root, 0x1B04, 0x2201 and others); everything
  else above is from reverse-engineered open-source code.

## Sources

- Solaar feature ids and error codes: [hidpp20_constants.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/hidpp20_constants.py)
- Solaar framing, reply matching, errors, ping, notification rules: [base.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/base.py)
- Solaar receiver PIDs and interfaces: [base_usb.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/base_usb.py)
- Solaar function codes for battery, feature set, rate, onboard profiles, LEDs: [hidpp20.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/hidpp20.py)
- Solaar read/write functions per setting: [settings_templates.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/settings_templates.py)
- Solaar event handling: [notifications.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/notifications.py)
- Solaar device table: [descriptors.py](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/descriptors.py)
- libratbag HID++ 2.0 functions (DPI, rate, onboard profiles, LEDs, 0x1B04): [hidpp20.c](https://github.com/libratbag/libratbag/blob/master/src/hidpp20.c)
- libratbag device files: [logitech-g-pro-x-wireless-superlight.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g-pro-x-wireless-superlight.device), [logitech-g502-x-wireless.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g502-x-wireless.device), [logitech-g502-x.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g502-x.device), [logitech-g502-x-plus.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g502-x-plus.device), [logitech-g305.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g305.device), [logitech-g-pro-wireless.device](https://github.com/libratbag/libratbag/blob/master/data/devices/logitech-g-pro-wireless.device)
- Linux kernel HID++ driver (report sizes, errors, battery layouts, device table): [hid-logitech-hidpp.c](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-logitech-hidpp.c)
- OpenRGB Logitech PIDs and Windows usage-page detection: [LogitechControllerDetect.cpp](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Controllers/LogitechController/LogitechControllerDetect.cpp)
- HeadsetControl HID++ framing and battery parsing: [hidpp_protocol.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/protocols/hidpp_protocol.hpp), constants in [logitech.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech.hpp)
- HeadsetControl Centurion protocol: [logitech_centurion_protocol.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/protocols/logitech_centurion_protocol.hpp)
- HeadsetControl devices: [logitech_gpro_x2_lightspeed.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech_gpro_x2_lightspeed.hpp), [logitech_g633_g933_935.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech_g633_g933_935.hpp), [logitech_g535.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech_g535.hpp), [logitech_astro_a50.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech_astro_a50.hpp), [logitech_astro_a50_gen4.hpp](https://github.com/Sapd/HeadsetControl/blob/master/lib/devices/logitech_astro_a50_gen4.hpp)
- Logitech HID++ spec drafts and feature pages (x0000 root, x1b04, x2201 and others): [lekensteyn.nl/files/logitech](https://lekensteyn.nl/files/logitech/)

## Covered in device-library/logitech-hidpp-mouse (22 Oct 2026)

The library driver now does, for G mice over a receiver or cable (simulated only, `tests/sim-logitech.mjs`; never run
on a real mouse): battery (0x1004 / 0x1000 / 0x1001), DPI (0x2201), report rate (0x8061 / 0x8060), onboard / host mode
(0x8100 fn 0x10 / 0x20), **onboard profile select** (0x8100 fn 0x00 info: profile_count is byte 3 per libratbag
`struct hidpp20_onboard_profiles_info`; fn 0x40 read, b1; fn 0x30 write `[00, number]`, libratbag sends index + 1; the
G502 X family reads 1-based, libratbag `HIDPP20_QUIRK_INDEX_OFFSET`), **DPI stage** (0x8100 fn 0xB0 / 0xC0, slot 0-4,
libratbag) and **lift-off** (0x2202: caps fn 0x10 `[00]` b2 bit1; read fn 0x50 `[00]` -> X b1-2, Y b5-6, LOD b9; write
fn 0x60 `[00, X, Y, LOD]`; Solaar `ExtendedAdjustableDpi`). Every write is refused while G HUB (`lghub*.exe`) runs.
Still left out: profile memory writes (the DPI of each stage, buttons, sleep timer), lights (0x8071 cannot be read back,
0x8070 parameter layouts missing), button remaps (0x1B04 targets not documented), angle snapping, surface tuning.

Covered (22 Oct 2026, by id alone, from libratbag `data/devices/*.device` @ 8235b5bb; features still found at connect):
USB G Pro 0xC085 / 0xC08C, G102 / G103 / G203 0xC084 / 0xC092 / 0xC09D, G302 0xC07F, G303 0xC080, G303 Shroud 0xC097,
G402 0xC07E, G403 0xC083, G403 HERO 0xC08F, G403 Wireless 0xC082, G502 HERO 0xC08B, G502 Proteus Core 0xC07D, G502
Proteus Spectrum 0xC332, G703 0xC087, G705 0xC096, G900 0xC081, G903 0xC086, MX518 0xC08E; Bluetooth G603 0xB01C, G604
0xB024, G705 0xB02E (report rate not offered); on a receiver also G603, G604, G703, G900, G903, G403 Wireless (their 40xx
wpids are recorded, not opened). G502 HERO, G502 Proteus Spectrum and G604 read their profile 1-based (`INDEX_OFFSET`).
Not covered: G602 (own C537 receiver, `HIDPP20_QUIRK_G602` DPI list).

## Covered in device-library/logitech-hidpp-headset and logitech-hidpp-keyboard (22 Oct 2026)

Both are "untested" (simulated only: `tests/sim-logitech-headset.mjs`, `tests/sim-logitech-keyboard.mjs`); every write
is read back and refused while G HUB runs. Sources: Solaar @ e7304c4c, HeadsetControl @ 91ee690a, libratbag @ 8235b5bb
(file by file in each device.mjs and in docs/handoff/drivers-round3a.md).

**Headsets** (G633 / G635 / G733 / G933 / G935 / G PRO / PRO X / PRO X 2 HID++ ids, G535; PRO X 2 LIGHTSPEED 0x0AF7):
features looked up by id, never at HeadsetControl's fixed indexes. Battery 0x1004 / 0x1000 / 0x1F20 (Solaar's voltage
curve); sidetone 0x8300 read fn 0x00 / write fn 0x10 (Solaar `Sidetone`); auto-off 0x1F20 v2+ read 0x10 / write 0x20
(Solaar `ADCPower`; the G535 limited to HeadsetControl's 0/1/2/5/10/15/30); mic mute 0x0601 fn 0x10, shown only; EQ
0x8310 (Solaar `Equalizer`: caps 0x00, band frequencies 0x10, read 0x20 [00], write 0x30 [02, gains]). The PRO X 2 goes
through Centurion frames (report 0x51) and the 0x0003 bridge exactly as HeadsetControl
`logitech_centurion_protocol.hpp` builds them: battery 0x0104, sidetone 0x0604 in the headset's own gain steps and
auto sleep 0x0108 with the other timer slots sent back as read (Solaar `HeadsetSidetone`, `HeadsetAutoSleep`).
Not covered: lights (write-only), the PRO X 2 EQ, G432 / G533 sidetone (write-only), G522, G435, ASTRO A50 / A50 X.

**Keyboards** (G915 / G915 TKL / G815 / G813 / G515 TKL / G512 / G213 / PRO; receivers C541, C545): battery, report rate
0x8061 / 0x8060 (host mode only), settings source 0x8100 fn 0x20 / 0x10, onboard profile **select only** (count from fn
0x00 byte 3, libratbag; read fn 0x40 / select fn 0x30 with the 2-byte sector, Solaar `OnboardProfiles`), key locks
including the Windows key (0x4521, Solaar `DisableKeyboardKeys`, bits from `special_keys.DISABLE`), F-key swap 0x40A2 /
0x40A0, backlight 0x8040 (Solaar `BrightnessControl`, in the keyboard's own halving steps when it has them). Not
covered: profile editing, lights, G-key / M-key remaps, the C547 receiver (see the handoff), PRO X TKL and G915 X ids.
Lightspeed pairing 0x0309 and BLE pre-pairing 0x1816 are now on helpers/never-commands.json and in both drivers' NEVER.

## Receiver slots and the pairing table (22 Oct 2026, docs/handoff/logitech-c539.md)

- **Which devices sit on which receiver:** Solaar `base_usb.py` lists 0xC539, 0xC53A, 0xC53D, 0xC53F, 0xC541, 0xC545,
  0xC547, 0xC54D as Lightspeed (interface 2) and 0xC548 as Bolt; Linux `hid-logitech-dj.c` names 0xC539 "Logitech
  lightspeed receiver" (gaming HID++) and 0xC53A the POWERPLAY receiver. No source ties a receiver id to one kind of
  device: a Lightspeed receiver can hold a keyboard as well as a mouse, a Bolt receiver up to six of either.
- **Device index:** 0xFF = the receiver itself; 0x01-0x06 = paired slots (Linux `DJ_DEVICE_INDEX_MIN 1`, `MAX 7`).
- **Pairing table, read-only:** HID++ 1.0 "get long register" (sub id 0x83) of register 0xB5 with parameter 0x20 + slot - 1,
  sent to index 0xFF as a SHORT report (0x10); the answer is a LONG report `FF 83 B5 <2N> ...` with the wpid in bytes 3-4
  (big-endian) and the device kind in the low nibble of byte 7 (1 keyboard, 2 mouse, 0x0D headset), counting the echoed 2N as byte 0
  (Solaar `receiver.py` device_pairing_information @ e7304c4c, `hidpp10_constants.py` DEVICE_KIND / InfoSubRegisters;
  libratbag `hidpp10.c` hidpp10_get_pairing_information @ 8235b5bb; Linux `hid-logitech-dj.c` unifying_pairing_query).
  Bolt uses 0x50 + slot instead (Solaar BoltReceiver). DeviceHub does not send it yet: see the handoff.
- **Device kind over HID++ 2.0, read-only:** feature 0x0005 DEVICE_NAME, function 0x20, byte 0 (Solaar `hidpp20.py`
  get_kind; `hidpp20_constants.py` DEVICE_KIND: 0 keyboard, 1 remote control, 2 numpad, 3 mouse, 4 touchpad,
  5 trackball, 6 presenter, 7 receiver).
- An empty slot and a sleeping device both get an HID++ 1.0 error from the receiver (short report `<slot> 8F ...`,
  0x08 unknown device / 0x09 resource error, Solaar `base.py` ping); on Windows that arrives on the short-report
  collection, so a driver reading only the long one sees no reply for both.

## Covered: PRO X2 SUPERSTRIKE in device-library/logitech-hidpp-mouse (22 Oct 2026, docs/handoff/superstrike.md)

- **Ids:** receiver 0xC54D (already in RECEIVERS), WPID 0x40BD (Solaar `docs/devices/PRO X 2 Superstrike 40BD.txt`,
  `docs/PRO_X2_SUPERSTRIKE_CLI.md` @ e7304c4c, HID++ 4.2), cable 0xC0A8 (xatuke/logitech-superstrike-pro-x2-controller
  `README.md`, `udev/99-superstrike.rules` @ c3ad5366; Solaar's Model ID 40BDC0A80000). On a receiver the model is
  recognised by its 0x1B0C feature, since the pairing table is not read.
- **Feature table** (kazehana99k `feature-table.txt` @ 1b599dd0; oddvalue/linux-superstrike `REVERSE_ENGINEERING.md`
  @ 42588e73; xatuke `docs/PROTOCOL.md`): **no 0x2201 and no 0x8060**. DPI is 0x2202, the rate 0x8061, the battery 0x1004,
  profiles 0x8100. The driver now runs a mouse with 0x2202 and no 0x2201 (DPI shown from 0x2202 fn 0x50).
- **HITS, 0x1B0C ANALOG_BUTTONS** (all four sources agree on the bytes): caps fn 0x00 -> `[flags, buttons, act<<2,
  rt<<2, hap<<2, ...]` (this mouse `00 03 28 14 14 01`: actuation 1-10, rapid trigger 1-5, haptics 0-5; only buttons 0
  left and 1 right answer); read fn 0x20 `[btn]` -> `[btn, act<<2, (rt<<2)|flag, hap<<2]`; write fn 0x10 `[btn, act, rt,
  hap]`, the whole record. Byte 2 bit 0 is kept as read (Solaar, oddvalue; xatuke treats it as a rapid-trigger on/off).
  A reserved low bit set or a value out of range answers 0x02 invalid argument (kazehana, Solaar #3202). Covered as six
  settings, written read-modify-write with the exact raw bytes and read back byte for byte.
- **Not written on this mouse:** DPI (0x2202 fn 0x60) and report rate (0x8061 fn 0x30): oddvalue and xatuke measured the
  getters (0x2202 fn 0x50, 0x8061 fn 0x20) returning stale values after a write; lift-off (LOD values disagree: Solaar
  0/1/2 vs xatuke's G HUB 1/2/3); the profile select (it reloads the profile, oddvalue). Shown only.
- **Never sent:** 0x1500 force pairing, 0x1802 reset, 0x1805 OOB, 0x00C2 DFU as before, and from this mouse's table 0x1817
  (Lightspeed pre-pairing), 0x9403 (oddvalue "FlashUpdate?"), 0x1801, 0x1803, 0x1890, 0x1E00. Also not offered: 0x8090
  surface mode and 0x80E0 bunny-hop (xatuke only; 0x80E0 fn 0x20 is a write that looks like a read), onboard-profile
  memory (0x8100 fn 0x50-0x80).
