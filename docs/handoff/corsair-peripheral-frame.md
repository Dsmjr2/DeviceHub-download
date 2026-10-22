# Corsair peripheral frame on the helper's hs80 channel (22 Oct 2026)

Corsair's Bragi mice and keyboards speak the same property protocol as the HS80, in a slightly different frame. The
helper now has that frame as an **opt-in channel option**: `hs80:<pid>:<ep>:bragi:frame=peripheral`. A channel name
without a `frame=` part (every HS80 and headset channel) takes the old path, with the same bytes.

Nothing was sent to a real device. DeviceHub was not restarted and `helpers/bin/DeviceHubHelper.exe` was not rebuilt
(DeviceHub rebuilds it on its next start, because the sources are newer). Nothing was committed.

## What the sources say

All of these were read from the current source (OpenLinkHub `main`, ckb-next `master`, 22 Oct 2026).

| What | Source | Code |
|---|---|---|
| Mouse write frame: no `02` prefix | OpenLinkHub `src/devices/m75W/m75W.go` `transfer()` | `bufferW := make([]byte, bufferSizeWrite)` (64 + 1), `bufferW[1] = d.Endpoint`, then the command at `headerSize` = 2 |
| Keyboard: the same frame | OpenLinkHub `k70core/k70core.go` (64) and `k70pro/k70pro.go` (1024) `transfer()` | `bufferW[1] = 0x08`, `headerSize = 2` |
| Headset frame, for comparison | OpenLinkHub `hs80rgbW/hs80rgbW.go` `transfer()` | `bufferW[1] = 0x02`, `bufferW[2] = d.Endpoint`, `headerSize = 3` |
| Reply offsets | OpenLinkHub `getBatterLevel()` | mouse `batteryLevel[3:5]`, HS80 `batteryLevel[4:6]` |
| The same frame in ckb-next | `bragi_common.c` `bragi_get_property()` / `bragi_set_property()` | `{BRAGI_MAGIC, BRAGI_GET, prop, 0}`, `{BRAGI_MAGIC, BRAGI_SET, prop, 0, val&255, val>>8}`; status `response[2]`, value from `response[3]` (`BRAGI_MAGIC` = `0x08`, `bragi_proto.h`) |
| Endpoint behind a receiver | ckb-next `usb_bragi.c` `bragi_usb_write()` | `pkt[0] \|= kb->bragi_child_id;` (child 1: `08 \| 1` = `09`) |
| | OpenLinkHub `slipstream/slipstream.go` `getDevices()` | `var base byte = 0x08` ... `endpoint := base + deviceType`, and `endpoint = base + 1` when one device is paired |
| Polling 1-4 | ckb-next `bragi_proto.h` | `BRAGI_POLLRATE_8MS 0x01` ... `BRAGI_POLLRATE_1MS 0x04`; `device_bragi.c` `cmd_pollrate_bragi`: `bragi_set_property(kb, BRAGI_POLLRATE, rate + 1)` |
| | OpenLinkHub `m75W.go` | `cmdSetPollingRate = {0x01, 0x01, 0x00}`, `PollingRates` 1 = 125 Hz ... 7 = 8000 Hz (5-7 on some mice) |
| DPI X / Y 100-26000 | OpenLinkHub `m75W.go` | `cmdSetDpi = {0: {0x01, 0x21, 0x00}, 1: {0x01, 0x22, 0x00}}`, `minDpiValue = 100`, `maxDpiValue = 26000`, value `PutUint16` LE; `darkcorergbproW.go` `maxDpiValue = 18000` |
| | ckb-next `dpi_bragi.c` `updatedpi_bragi()` | `BRAGI_DPI_X` then `BRAGI_DPI_Y`, 16 bits LE at `pkt[4]`, `pkt[5]`; `usb.c` `mouse_dpi_list` gives each mouse's top |
| Sleep | OpenLinkHub `m75W.go` | `cmdSleep = {0: {0x01, 0x37, 0x00}, 1: {0x01, 0x0e, 0x00}}`, `SleepModes` 1-60 minutes x 60000; `cmdOpenSleepWriteEndpoint = {0x01, 0x0d, 0x00, 0x01}` |
| Brightness | OpenLinkHub `k70pro.go` | `cmdBrightness = {0x01, 0x02, 0x00}` (0-1000) |

### What that means on Windows

OpenLinkHub runs on hidapi, where byte 0 of a write is the report id. Its mouse frame puts `00` there: the device has no
report ids. On Windows such a device's reports are 64 data bytes behind a `00` report id byte, so `HIDP_CAPS` says 65,
and a read comes back as `00` + 64 bytes (hidapi removes the `00` before OpenLinkHub sees it, hence the "one byte
lower" offsets). So in the buffers the helper reads and writes:

| | Headset (HS80, unchanged) | Peripheral (new) |
|---|---|---|
| Report length | 64 (`HidFind.Find`: FF42 / 01 / 64) | 65 (FF42 / 01 / 65) |
| GET | `02 <ep> 02 <id lo> <id hi>` | `00 <ep> 02 <id lo> <id hi>` |
| SET | `02 <ep> 01 <id> 00 <value LE x4>` | `00 <ep> 01 <id> 00 <value LE x4>` |
| Reply | `01 <who> <cmd> <status> <value LE>` | `00 <who> <cmd> <status> <value LE>` |
| Notices | report `03` | none read |
| LIGHT / OPENLIGHT | as before | refused (`ERR`), nothing sent |

After the report id byte, every byte sits at the same offset in both frames. The helper's `GET` answer (status + value
bytes) has the same form for both.

**Unconfirmed:** the "who" byte of a peripheral reply. The helper keeps the HS80's rule (0 on endpoint 08, 1 on 09). Neither
source checks that byte: OpenLinkHub reads the next report, and ckb-next copies its interrupt buffer. If a real mouse
puts something else there, every GET answers `NONE` and the driver offers nothing.

## The helper change (C#)

- `hs80io.cs` `Hs80Io`: the frames are now pure static functions (`GetFrame`, `SetFrame`, `LightFrame`,
  `OpenLightFrame`, `IsReply`, `IsEvent`, `ReportLen`), used by the instance methods. A second constructor
  `Hs80Io(path, peripheral)`; `Hs80Io(path)` is `this(path, false)`. `FrameOf(name)` reads the channel name, and
  `IsHs80Pid` lists `0A69`, `0A6B` and `0A71`.
- Two SET lists. `Hs80Allows` is the old list, word for word: `02` 0-1000, `03` 1-2, `0e` 60000-7200000, `0d` 0/1, `46` 0/1,
  `47` 0-1000. `PeripheralAllows` is separate and smaller, with each line's source beside it in the code:

  | Id | Range | Source |
  |---|---|---|
  | `02` brightness | 0-1000 | OLH k70pro.go `cmdBrightness` |
  | `0d` sleep on/off | 0 / 1 | OLH m75W.go `cmdOpenSleepWriteEndpoint` (only sends 1; 0 = off is the headsets' meaning, HSC) |
  | `0e` sleep timer | 60000-3600000 ms | OLH m75W.go `cmdSleep`, `SleepModes` 1-60 min |
  | `01` polling | 1-4 (125-1000 Hz) | ckb `BRAGI_POLLRATE_*`, OLH `PollingRates` |
  | `21` / `22` DPI X / Y | 100-26000 | OLH m75W.go `minDpiValue` / `maxDpiValue`; ckb dpi_bragi.c |

  Not on it: `03` (light mode, and `03` = 4 sleep now), `1e` / `1f` DPI stage, `37` sleep, `46` / `47`, handles, lights,
  firmware `14`-`16`. Nothing in `helpers/never-commands.json` can be sent.
- `helper.cs` `HandleHs80`: OPEN reads the frame part. With none, it runs `HidFind.Find(pid)` and `new Hs80Io(path)` as
  before. `frame=peripheral` runs `HidFind.Find("1b1c", pid, 0xFF42, 1, 65)` and `new Hs80Io(path, true)`, and answers
  `ERR` on the HS80's own ids. Any other `frame=` part answers `ERR unknown frame`. There is a new `FRAME` command that
  answers `peripheral` or `hs80`; an older helper answers `ERR unknown command`. LIGHT and OPENLIGHT now catch the
  peripheral refusal as `ERR` (before, any exception became GONE; the HS80 never raises one there). CRLF line endings are
  kept in both files.

### Proof the HS80 is unchanged

- `tests/native/hs80-frame.cs`, a C# harness, is compiled with `hs80io.cs` only and opens and sends nothing. It compares
  the new frame functions with the old HS80 code, which is copied into the harness word for word:
  - every GET id 0-ffff on endpoints 08 and 09;
  - SET bytes and the SET list for 12 ids x 23 edge values, plus 2000 random ones;
  - 2000 random light messages, and OPENLIGHT;
  - reply and notice routing over every first byte, every "who" 0-3 and every command byte, with a random rest;
  - every HS80 channel name (`hs80:0A69:8:wired1`, `hs80:0A6B:9:receiver2`, `hs80:0A6B:8:rx`, ...) resolving to the HS80
    frame.

  It also checks the peripheral frame's bytes and that its SET list allows exactly the six ranges above. Result:
  `hs80-frame (1194036 checks): all good`.
- `tests/hid-core.mjs` section 9 compiles and runs that harness to a temp exe whenever Windows' `csc.exe` is present
  (about 1 s), and says so when it is not. It also checks:
  - `hs80-direct.js`, `receiver-light.js` and the headset library driver name their channels with no frame part;
  - HandleHs80's headset path still calls `HidFind.Find(p[1])` and `new Hs80Io(path)`, and `Find(pid)` is still
    FF42 / 01 / 64;
  - both C# files are CRLF.
- The C# compiled to a temp exe with build.ps1's exact source list and references (`exit 0`). That temp helper, driven
  on stdin with no matching device plugged in, gave these answers:
  - a peripheral OPEN on `1B81`: `NODEVICE`;
  - a peripheral OPEN on `0A6B`: `ERR the HS80 is never opened on the peripheral frame`;
  - `frame=nope`: `ERR unknown frame`;
  - GET / FRAME before an OPEN: `GONE`.

  No HS80 channel was opened.

## The driver (device-library/corsair-bragi-peripherals)

- **connect():** tries `hs80:<pid>:<ep>:bragi:frame=peripheral` first, then asks `FRAME`.
  - If OPEN answers NODEVICE (the device has 64-byte reports with an id), it tries the headset frame
    `hs80:<pid>:<ep>:bragi` on the same id, which is the old behaviour.
  - An older helper ignores the frame part and answers ERR to FRAME, so the channel counts as the headset frame.
  - The page's info shows `Frame`.
- **SET list per channel:** `PERIPHERAL_SETS` (= `PeripheralAllows`) on the peripheral frame, `HEADSET_SETS`
  (= `Hs80Allows`) on the headset frame. The test parses both C# lists and compares them.
- **DPI:** a slider from 100 to the model's documented top, X and Y together. It is offered only on the peripheral frame,
  only when GETs of both `21` and `22` answered, and only on mice with a `dpiMax`:
  - from OLH: M75 family 26000, Dark Core RGB Pro / Pro SE 18000;
  - from ckb `mouse_dpi_list`: Katar Pro 12400, Katar Pro XT 18000, Ironclaw Wireless 18000, Harpoon Wireless 10000.

  A write reads X and Y, refuses if they differ, then sets and reads back X, then Y. Other mice show DPI as a reading.
- **Polling:** a choice of 125 / 250 / 500 / 1000 Hz (codes 1-4) on the peripheral frame. A device at 2000-8000 Hz
  (codes 5-7) reads correctly; the self-check does not write that back, and 1000 Hz can still be chosen.
- **Everything else is as before:** the sleep timer and on/off on mice, brightness on keyboards, the raw write-back of
  the same value, refusal while iCUE runs, `status: "untested"` (read-only until each setting passes the self-check
  after Turn on settings), no handle, light, firmware or `03` write.
- **device.json:** the works / doesNotWork lists are updated.

`tests/sim-corsair-bragi-peripherals.mjs` (30 models, both frames) covers:
- the 65-byte peripheral frame's bytes;
- DPI and polling writes, read-backs and put-backs, and their range refusals;
- DPI X ≠ Y, and a Y that does not stick;
- the self-check (DPI and polling pass and leave the device unchanged; no DPI SET on a mouse without `dpiMax`);
- a 64-byte device falling back to the headset frame, where DPI and polling are readings;
- an older helper;
- iCUE refusals;
- the never list.

`npm run test:offline` passes.

## Still unconfirmed (measure read-only first, `helpers\hid-caps.ps1 -Vid 1b1c`)

- That a real Corsair mouse's FF42 collection on Windows reports output length 65 with no report id (from hidapi usage
  in OLH; never measured here).
- The reply's "who" byte (see above).
- The endpoint when a receiver has more than one paired device: OLH uses `08 + deviceType`; the driver assumes one, on `09`.
- Whether a GET of `21` / `22` answers (the sheet: "R unconfirmed"). If it does not, DPI is never offered.
- Which of `0e` / `37` each mouse honours for sleep (`37` stays off the list).

## Files

- `helpers/native/hs80io.cs`, `helpers/native/helper.cs` (CRLF)
- `tests/native/hs80-frame.cs` (new), `tests/hid-core.mjs` (section 9)
- `device-library/corsair-bragi-peripherals/device.mjs`, `device.json`
- `tests/sim-corsair-bragi-peripherals.mjs`
- `docs/brands/corsair.md` (one line in "Covered in device-library/corsair-bragi-peripherals")
