# More library drivers: Keychron, Wooting, HyperX peripherals, Turtle Beach, Glorious (22 Oct 2026)

Five new folders in `device-library/`, each written only from its brand sheet in `docs/brands/` (every command has
its source beside it). None has met real hardware: every `device.json` is `"status": "untested"`, `"tested": []`, so
none installs by itself. Each has a simulator test in `tests/` that touches no device. Cooler Master got no driver
(below).

## package.json

Add these to the end of both `test` and `test:offline` (after `node tests/bundled-tools.mjs`):

```
 && node tests/sim-keychron-via.mjs && node tests/sim-wooting.mjs && node tests/sim-hyperx-peripherals.mjs && node tests/sim-turtle-beach-battery.mjs && node tests/sim-glorious.mjs
```

All five pass, as do `node tests/device-library.mjs`, `node tests/declarative-driver.mjs`, `node tests/check.mjs`,
`auto-setup`, `library-updates` and `my-devices`. `share-device`'s personal scan finds nothing in the new folders.

## helpers/never-commands.json

Unchanged, on purpose. Every firmware, DFU, reset, factory, pairing and flash-save command these five sheets document
is already on it (Keychron `AA`, `AB`, `A7 11` and VIA `0B` / `0A` / `06` / `10`; Wooting 2, 25, 43 and the saves;
HyperX `DE FF`, SIRK `1E` / `83`; the Turtle Beach RACE nvkey write; Glorious `75` on report 05). Each sim checks every
frame its driver sends against that list.

## keychron-via (`driver.json`, Keyboard, 3434)

**Covered.** Keychron's own `A7` commands on the VIA channel (FF60 / 61, 32 bytes), for every `3434` keyboard id in
the sheet. A probe (`A7 01`) reads the board's feature bits, and each setting is shown only when its bit is set.

| Setting | Read / write | Range on the page |
|---|---|---|
| Debounce method | `A7 05` / `A7 06` | types 0-6 (named) |
| Debounce time | `A7 05` / `A7 06` | 0-100 ms (firmware takes 0-255; capped so a slip cannot make typing lag) |
| Backlight off after | `A7 0B` / `A7 0C` | 5-3600 s (firmware minimum 5) |
| Sleep after | `A7 0B` / `A7 0C` | 60-14400 s (firmware minimum 60, default 7200) |
| Report rate | `A7 0D` / `A7 0E` | 1000 / 4000 / 8000 Hz |

- Each write sends back the partner value it shares a frame with, exactly as just read. It is refused if that value
  moves.
- A timer read outside the page's range makes both timers read only.
- Info: protocol version, NKRO on/off and adaptive, the raw report-rate divider.

**Gaps:**
- Snap click (needs a pair editor).
- NKRO switching (2025q3 firmware refuses it).
- Keychron per-key lighting `A8` (needs a per-key editor).
- HE actuation and rapid trigger (`A9`, not mapped).
- Battery (no command exists).
- The 2.4 GHz receiver and Bluetooth (only the cable is documented).
- Report rates 2000 / 500 / 250 / 125 Hz (their dividers are unconfirmed).
- Lemokey `362D` boards. The same file with `vid` `362D` and the Lemokey ids would cover them.
- Keychron mice.

**Unconfirmed:**
- Keychron Launcher and usevia.app are usually a browser tab, which the step-back check cannot see. The process names
  it does look for are not from a source.
- When the board is also the VIA keyboard DeviceHub runs, both share one HID host (the provider finds the built-in one
  first). They are serialised, and replies are matched by `A7` + sub-command. A VIA `FF` reply that lands during a
  Keychron request would be read as "refused". That is safe, but not measured.

## wooting (`device.mjs`, Keyboard, 31E3, read only)

**Covered.** Only Wooting's own SDK (wooting-rgb-sdk):
- Model and size, from the product id.
- Layout, from GetDeviceConfig `19` (reply byte 10). This is the only command it sends: a feature report on the
  `1337` page, with the reply read as an input report.
- It steps back while Wootility runs.

**Gaps:**
- **Per-key lighting:** documented, but no command reads a colour back, so a write could never be checked. OpenRGB
  drives it.
- **Actuation, rapid trigger, tachyon:** no setter in any source.
- **Key depth:** documented (analog SDK, `FF54` / `FF53` input reports), but it lives on a second collection. A
  driver gets one collection per product id, and the settings page has no live view. Doing it needs either a second
  channel per pid in `helpers/my-devices.mjs` / `hid-host.mjs`, or a separate entry on the analog page.
- **Profiles:** community protocol only.
- The original `03EB` boards.
- Boards that expose only `FF55` (v3 frame).

**Unconfirmed:**
- Which boards have `1337`.
- The 256-byte input length.
- That `19` answers without the `33` init (a lighting start, deliberately not sent).

## hyperx-peripherals (`device.mjs`, Mouse or keyboard, 03F0, info only)

**Covered.** It names the HP-era Pulsefire Haste / Dart / Core / Surge and the Alloy Origins 60 / 65 / Core /
Origins / Origins 2 65:
- model, type and dongle or cable, from the product id;
- where the lights are (OpenRGB) and where the other settings are (NGENUITY).

It sends nothing. Its channels open with no access.

**Gaps:**
- **Settings:** nothing writable is documented with a read-back. DPI, polling and battery are not documented for any
  HyperX mouse, and the lighting commands are write-only.
- **Alloy Origins Core variant query:** a read, but the source names its interface and not its usage page. A wrong
  collection would get the keyboard's lock-light output report.
- Kingston `0951` ids (a second entry with that vid).
- Haste 2, Alloy Rise.

## turtle-beach-battery (`device.mjs`, Headset, 10F5, read only)

**Covered.** Stealth 700 Gen 3 transmitter: `2251` (verified in the source); `2250` and `2253` are labelled "not yet
seen working".
- It sends the sheet's two fixed frames and nothing else: the RACE `0x9942` CoAP enable and `GET /GSI` in `0x9902`.
- From the JSON reply it reads:
  - battery (`240`) and charging (`250`, a best guess on this model);
  - linked (`230`): no battery is shown while the headset is unlinked;
  - name (`220`) and the Signature Sound preset (`2c0`, raw).
- It steps back while Swarm II runs.

**Gaps:**
- Every headset setting: no open source documents one.
- Stealth Pro II: its request bytes are only in a capture.
- Stealth 600 Gen 3, Stealth 700 G2 and older headsets.

**Unconfirmed:** the source reads replies with GET_REPORT (`HidD_GetInputReport`), which the helper does not have.
This driver reads input reports as they arrive. If the transmitter only answers GET_REPORT, the read says "no GSI
record" and nothing else is sent. Adding an input-report GET to the helper is the fix if that happens.

## glorious (`device.mjs`, Mouse, 258A, READ ONLY, id `glorious-mouse`)

**Covered.**
- **Ids:** exact product ids only: wired Model O / O- `0036` and Model D / D- `0033`; wireless Model O, O-, D and D-
  (cable and dongle).
- **Firmware check:** the firmware read is the first request, and the only one until it passes:
  - Wired: the string must be libratbag's `V103` / `V102` for that id.
  - Wireless: no firmware strings are documented anywhere, so the check is mxw's reply shape: echo `81`, status
    `A0` / `A1` / `A4`, and four version bytes that are not all zero or all FF.
  - A device that fails gets nothing more.
- **Reads:**
  - firmware;
  - wired: sensor type and polling code (nibble order unconfirmed);
  - wireless: battery % (charging is not documented, so it always reads "not charging").
- **Channel:** feature reports only, on handles opened with no access. It steps back while Glorious Core runs.

**Gaps:**
- **Writes, all of them:** DPI, polling, lift-off, debounce, sleep, lights, buttons. Asked for as read only. The sheet
  also marks the wireless write bytes partly unconfirmed, and the wired write rewrites the whole block.
- Model O Eternal (`3794`), Model I, the Model O 2 family, GMMK keyboards.

**Unconfirmed:** the wired collection's usage, and whether report 04's 520 bytes include the report id (519 data bytes
are asked for).

## cooler-master: skipped

The sheet documents nothing beyond lighting with a source. There is no DPI, polling, sleep, battery or macro command.
The keyboard firmware read needs a control-mode write first, and the MM712 `47 81` reply is undecoded. A note says so
at the end of `docs/brands/cooler-master.md`.

## Before any of these becomes "tested"

On the real device, follow CLAUDE.md step 6:
- Run `helpers/hid-caps.ps1` to confirm the collection, page and lengths each driver's HID LAYER block marks
  unconfirmed.
- Do one read and compare it with the maker's app.
- Keychron only (the one driver with writes): for each setting, write a different value, read it back, then put the
  original back.
