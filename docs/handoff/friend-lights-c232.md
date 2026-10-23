# A friend's fans not found, and support request #6 (Logitech C232), 22 Oct 2026

Two jobs from a friend's PC:

- A. "the app couldnt find my friends fans to change colors": Lighting > PC lights now says what it found and why fans
  may be missing, so the person (or Shawn, from one Get help click) needs no Claude.
- B. Dsmjr2/DeviceHub-support#6: Logitech 046D:C232, only a keyboard interface (usage page 0001 usage 0006), G HUB
  installed. It is the **Logitech G813**.

## A. Fan lights

### What the page shows now

The PC lights card has a **Fan lights** part (before and after Find lights; read-only, nothing sent to any device,
never starts OpenRGB by itself):

- **What OpenRGB found** (the list already on the card), or, when it could not start, the plain reason and the fix:

  | OpenRGB said | The page says | Fix |
  |---|---|---|
  | Visual C++ runtime missing | OpenRGB needs Microsoft's Visual C++ runtime, and this PC does not have it | install "Visual C++ Redistributable" (X64) from Microsoft (learn.microsoft.com/cpp/windows/latest-supported-vc-redist) |
  | already running without its SDK server | another OpenRGB is already open | quit it (also from the tray) and press Find lights, or press Start Server in it |
  | installed on this PC | DeviceHub uses that one | open it, SDK Server tab, Start Server |
  | files missing from tools\openrgb | the OpenRGB inside DeviceHub is missing files | reinstall DeviceHub; check the antivirus quarantine |
  | did not start its SDK server | started but did not answer | press again; restart the PC; check the antivirus |
  | did not answer in time / too old | slow, or older than 1.1 | wait and retry / update OpenRGB |

  The reason of the last Find lights is kept past OpenRGB's 10 s cache (`lastFind` in `/api/openrgb`).
- **Board**: maker and model from `/api/pc`.
- **Each lighting controller plugged in**, by USB id, with its kind:
  - a known id is **"reachable over USB: should show after Find lights"**. After Find lights it says "OpenRGB found
    it", or, when OpenRGB ran but did not list it, that the maker's lighting app (Armoury Crate, MSI Center, Gigabyte
    Control Center / RGB Fusion, iCUE, L-Connect, NZXT CAM, SignalRGB) may be holding it, or it needs a newer OpenRGB.
  - no known id, a board maker whose lights OpenRGB reaches over the SMBus (ASUS, Gigabyte, ASRock, MSI, EVGA) and an
    SMBus controller in Windows: **"on the board's SMBus: needs OpenRGB with PawnIO, which DeviceHub does not install"**,
    with the existing "Add your board, fan and RAM lights" steps (the person's own choice to install).
  - neither: **"no lighting controller found: the fans may be on a non-addressable or remote-controlled hub"**, with how
    to check the wiring (3-pin 12 V RGB cannot be addressed; a hub with its own remote or button is not reachable).
- **Get help** for lights: one click builds the report (shown in full first, as every Get help).

### Get help, area "lights"

`GET /api/help/report?id=lights` (`helpers/get-help.mjs`, `LIGHTS`). Title `Help: PC lights (<board>), <kind>`, and a
"PC lights" section:

```
- OpenRGB: 1.1 (inside DeviceHub), running (USB lights only)
- Last Find lights: 2026-10-22 10:00, found 1
- Lights OpenRGB found: MSI MAG B550 (motherboard, USB 1462:7c56)
- Board: Micro-Star MAG B550 TOMAHAWK (MS-7C91) (SMBus: AMD SMBus)
- Lighting controllers on USB: MSI Mystic Light MS_7C56 (1462:7c56), found; Corsair Commander Pro (1b1c:0c10), NOT found by OpenRGB
- So: reachable over USB: should show after Find lights
```

then each problem as a finding, and the log lines about OpenRGB / PC lights. The personal-data check and stand-ins are
Get help's own (OpenRGB locations with device instance ids are never put in).

### The id table: `helpers/rgb-controllers.json`

244 USB ids from OpenRGB's own detectors (its supported devices list), read at
`https://codeberg.org/OpenRGB/OpenRGB` commit `bbc77470a7cba56af60989e54ba910d5ac66a3ac` (2026-10-21). Each entry names
its source file and line; the page and Get help link to it. Kept: board USB lighting chips (ASUS Aura Addressable /
Motherboard / Strix LC, MSI Mystic Light 1462:xxxx and 0DB0:0076, Gigabyte RGB Fusion 2 USB 048D:5702 / 5711 / 8297 /
8950 and 0414:A100, ASRock Polychrome USB) and fan hubs (Corsair Commander Core / XT / Pro, Lighting Node Core / Pro,
LS100, LT100, iCUE Link, 1000D, SPEC OMEGA; Lian Li Uni Hub family, Strimer, GA II; NZXT Hue 2, Smart Device V2, RGB &
Fan Controller, Kraken X3 / Elite; Thermaltake Riing / Quad / Trio; Cooler Master ARGB / Gen 2 A1 / Small ARGB / RGB).
Mice, keyboards and monitors are left out. `smbusBoards` names the SMBus detectors per maker (ENESMBus for ASUS,
GigabyteRGBFusion2SMBus / RGBFusion, ASRockSMBus, MSIRGB Super I/O, EVGASMBus). The table is from a commit newer than
the bundled OpenRGB 1.1 (8e16de2); an id added after 1.1 is the "needs a newer OpenRGB" case above.

### Files

| File | What |
|---|---|
| `helpers/lights-diagnose.js` (new) | `diagnose({ pc, orgb })`, `openrgbFix(reason)` |
| `helpers/rgb-controllers.json` (new) | the id table above |
| `helpers/openrgb.js` | `status()` keeps `lastFind` (when, ok, reason, count) |
| `server.js` | `GET /api/lights/diagnose` (cached PC map + `openrgb.status(false)`, never starts OpenRGB); isolated mode answers a stand-in |
| `public/pages/pc-lights.js` | `fanHelp()` on the PC lights card (both states), demo data; no pop-ups or tooltips |
| `helpers/get-help.mjs` | the "lights" area |
| `tests/lights-diagnose.mjs` (new, in `test` and `test:offline`) | the three kinds, not-found, before Find lights, the own-OpenRGB case, every OpenRGB reason, `lastFind` past the cache (a copy of openrgb.js on a spare port; nothing started), the table, Get help's report, the page and route |

## B. Support request #6: 046D:C232 is the Logitech G813

Sources (read 22 Oct 2026):

- OpenRGB `Controllers/LogitechController/LogitechControllerDetect.cpp` @ `bbc77470a7cba56af60989e54ba910d5ac66a3ac`:
  line 58 `#define LOGITECH_G813_PID 0xC232`; line 1531 `REGISTER_HID_DETECTOR_IP ("Logitech G813 RGB Mechanical Gaming
  Keyboard", DetectLogitechKeyboardG815, LOGITECH_VID, LOGITECH_G813_PID, 1, 0xFF43)`: the G815's own detector, on USB
  interface 1, usage page 0xFF43. Lines 163-166: usage 0x0602 carries 20-byte packets, 0x0604 64-byte ones.
  `LogitechG815Controller/LogitechG815Controller.cpp` sends HID++ 2.0 long reports there (0x11, device 0xFF).
- Solaar `descriptors.py` (@ e7304c4c), Linux `hid-ids.h` and libratbag (@ 8235b5bb) do not list 0xC232.

So it is a Logitech G keyboard the library keyboard driver can run per its documented HID++ 2.0 features (feature
lookup by Root getFeature, so it shows only what the G813 answers for: report rate, settings source, onboard profile
shown only, key locks, F-key swap, backlight). Added to `device-library/logitech-hidpp-keyboard`:
`WIRED[0xC232] = 'G813'`, and `FF43[0xC232]` so it is opened on **interface 1, page FF43 usage 0602** (`hid.byPid.C232`,
channel `hid:046D:C232:FF43:0602:19:17:if=1:rw=1`), not on FF00 / 0002 like the G915 family. Guard and never-list rules
unchanged; status stays untested; `device.json` `updated` = 2026-10-23T00:18:02Z so library updates deliver it.
`tests/sim-logitech-keyboard.mjs` section 2c: a simulated G813 connects at 0xFF, is named, writes and puts back the
Windows-key lock, passes the self-check, and its channel and filter are FF43 / 0602 on interface 1.
`docs/brands/logitech.md` has its row.

**But the friend's PC showed no vendor collection.** The request lists one HID entry: usage page 0001 usage 0006,
in 9 / out 2, and no interface number. A G813 normally has two HID interfaces (0: typing, 1: HID++ on page FF43); an
entry with no interface number means Windows sees a device with only the typing interface. With that alone there is
nothing to send settings to, for DeviceHub, OpenRGB or G HUB alike.

**Answer for the friend:** "Your keyboard is a Logitech G813. DeviceHub can run it now (after its next library update),
but on your PC Windows only shows its typing part, not the part settings go through. Plug it straight into a USB port on
the PC (not through a hub, a KVM switch or a monitor's USB); DeviceHub then finds it by itself. If it still does not
show, press Request support again so I can see what Windows lists."

## Not changed, worth a look

- The same OpenRGB comment (line 1779) and Solaar `descriptors.py` (interface=1) put the **G213, G512, G815 and PRO**
  keyboards on interface 1, usage page 0xFF43 too, but the driver still opens them on FF00 / 0002 (as before today). On
  a real one it may not find its channel. Not changed here (other ids, untested); the G813's `FF43` map is the place to
  add them once confirmed.
