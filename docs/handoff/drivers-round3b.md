# Library drivers, round 3b: Corsair Bragi mice and keyboards, SteelSeries mice (22 Oct 2026)

Two new `device-library` entries, both `status: "untested"`, `tested: []`. Nothing was sent to a real device, DeviceHub
was not restarted, and no C#, `server.js`, `package.json`, `public/*` or existing driver or test was changed.

| Entry | Models | Reads | Writes (each read back) |
|---|---|---|---|
| `corsair-bragi-peripherals` | 19 mice, 11 keyboards, 4 generic Slipstream receivers (49 product ids) | battery `0f`, firmware `13`, DPI `21`/`22` (display), polling `01` (display) | mice: sleep timer `0e` 1-60 min, sleep on/off `0d`; keyboards: brightness `02` 0-100% |
| `steelseries-mouse` | Aerox 3 / 5 / 9 Wireless (+ editions), Prime Wireless, Rival 3 (18 product ids) | battery + charging `92` / `D2`, Rival 3 firmware `10 00` | none |

New tests: `tests/sim-corsair-bragi-peripherals.mjs`, `tests/sim-steelseries-mouse.mjs`. Both pass, as do
`tests/device-library.mjs`, `tests/check.mjs`, `tests/declarative-driver.mjs`, `tests/sim-corsair.mjs`,
`tests/sim-steelseries.mjs`, `tests/sim-glorious.mjs` and `tests/learn-wizard.mjs` (the never list changed).

## package.json (for Shawn: this job did not edit it)

Append ` && node tests/sim-corsair-bragi-peripherals.mjs && node tests/sim-steelseries-mouse.mjs` to both lines:

```
"test": "node tests/check.mjs && node tests/regressions.mjs && node tests/openrgb-mock.mjs && node tests/mouse-sim.mjs && node tests/waiting.mjs && node tests/waiting-monitors.mjs && node tests/my-devices.mjs && node tests/battery-care.mjs && node tests/device-library.mjs && node tests/lamparray.mjs && node tests/std-battery.mjs && node tests/vendor-files.mjs && node tests/auto-setup.mjs && node tests/library-updates.mjs && node tests/share-route.mjs && node tests/sim-logitech.mjs && node tests/sim-razer.mjs && node tests/sim-corsair.mjs && node tests/sim-steelseries.mjs && node tests/sim-hyperx.mjs && node tests/sim-asus.mjs && node tests/declarative-driver.mjs && node tests/learn-wizard.mjs && node tests/release-signing.mjs && node tests/pages.mjs && node tests/diagnose.mjs && node tests/hid-core.mjs && node tests/installers.mjs && node tests/bundled-tools.mjs && node tests/sim-keychron-via.mjs && node tests/sim-wooting.mjs && node tests/sim-hyperx-peripherals.mjs && node tests/sim-turtle-beach-battery.mjs && node tests/sim-glorious.mjs && node tests/sim-corsair-bragi-peripherals.mjs && node tests/sim-steelseries-mouse.mjs",
"test:offline": "node tests/check.mjs && node tests/regressions.mjs && node tests/openrgb-mock.mjs && node tests/mouse-sim.mjs && node tests/waiting.mjs && node tests/waiting-monitors.mjs && node tests/my-devices.mjs && node tests/battery-care.mjs && node tests/device-library.mjs && node tests/lamparray.mjs && node tests/std-battery.mjs && node tests/vendor-files.mjs && node tests/auto-setup.mjs && node tests/library-updates.mjs && node tests/share-route.mjs && node tests/sim-logitech.mjs && node tests/sim-razer.mjs && node tests/sim-corsair.mjs && node tests/sim-steelseries.mjs && node tests/sim-hyperx.mjs && node tests/sim-asus.mjs && node tests/declarative-driver.mjs && node tests/learn-wizard.mjs && node tests/diagnose.mjs && node tests/hid-core.mjs && node tests/installers.mjs && node tests/bundled-tools.mjs && node tests/sim-keychron-via.mjs && node tests/sim-wooting.mjs && node tests/sim-hyperx-peripherals.mjs && node tests/sim-turtle-beach-battery.mjs && node tests/sim-glorious.mjs && node tests/sim-corsair-bragi-peripherals.mjs && node tests/sim-steelseries-mouse.mjs"
```

If another job has added scripts to these lines since, keep theirs and add the two at the end.

## corsair-bragi-peripherals

Source: `docs/brands/corsair.md` only (OpenLinkHub, ckb-next and DeviceHub's HS80 code, as the sheet cites them).

- **Transport:** the helper's `hs80:<pid>:<ep>:bragi` channel, exactly as the headset driver uses it: `hidlist FF42 01`
  (read-only), `OPEN`, `GET <id>`, `SET <id> <value>`, `CLOSE`. Cable on endpoint `08`, receiver on `09`, cable first.
- **Generic receivers** (`1BA6`, `1BDC`, `2B00`, `2B1B`): one `GET 12` on `09` names the paired model; an unknown
  id (or an HS80 id) closes the channel.
- **Probe first:** every property is offered only after a GET of it answers status `00`; a writable id is not even
  asked while the helper cannot SET it. A device that answers nothing is "asleep", probed again next read.
- **Writes:** only `0e`, `0d`, `02`, inside `HELPER_SETS` (a copy of `Hs80Io.Set`'s list; the test checks it against
  `hs80io.cs`). Refused while iCUE runs (connect, read and write; `vendorApp()` returns `iCUE.exe` for the self-check).
- **Excluded ids:** the HS80's `0A69`, `0A6B`, `0A71` (and every id of `corsair-bragi-headset`); the 128- / 1024-byte
  keyboards (`1BB3` `1BD4` `1BC4` `1BC6` `1B73` `1BB9` `1BAF` `1BCF` `1BC3` `1BD7` `1B7C` `1B7D` `1BC5`) and the `1BE3`
  Scimitar, which the 64-byte channel cannot open; NXP-protocol models.
- **Never sent:** `03` writes (light mode, sleep-now `03 = 4`), firmware `14`-`16`, handles (`0d`/`06`/`07`/`05`
  commands), any SET outside the three ids. Added to `helpers/never-commands.json` as a documented (byte-less) entry.

### Whitelist changes for Shawn (hs80io.cs `Hs80Io.Set`, one line each; then the driver's `HELPER_SETS` and `WRITES`)

Each turns a reading into a writable setting; DPI also needs a read-back measured first (the sheet: "R unconfirmed").

- `|| (id == 0x01 && value >= 1 && value <= 4)` polling rate 125-1000 Hz (ckb 1-4; OLH goes to 7 = 8000 Hz on models
  that have it, so 5-7 only per model)
- `|| (id == 0x21 && value >= 100 && value <= 26000)` DPI X (M75 100-26000; Dark Core Pro 100-18000: the driver
  narrows per model with `dpiMax`)
- `|| (id == 0x22 && value >= 100 && value <= 26000)` DPI Y (same)
- `0x1e` DPI stage index: the sheet gives no range or base (0 or 1), so no line can be written yet
- `0x37` mouse sleep (OLH writes it beside `0e`): same ms range as `0e` (60000-3600000), but which one each mouse
  honours is unconfirmed; measure before adding

### Helper change also needed (C#, not a whitelist line)

The sheet says OLH's mice and keyboards use the frame **without** the `02` report-id prefix, with replies one byte lower.
`Hs80Io` always sends report id `02`, expects reply report `01`, and `HidFind.Find` needs 64-byte output reports. If a
device really has no report ids, `OPEN` answers `NODEVICE` or every GET goes unanswered: the driver then offers
nothing and writes nothing (safe, but useless). The sheet's section 5 `prefix02` flag (and a report size) on the hs80
channel would fix it. Check the first real device with `helpers\hid-caps.ps1 -Vid 1b1c` before anything else: its
FF42 collection's output report length and whether it uses a report id.

## steelseries-mouse

Source: `docs/brands/steelseries.md` (rivalcfg, OpenRGB). A `device.mjs` on `getDevice()` like `steelseries-arctis`.

- **Reads:** battery `92` on the cable, `D2` (`92 | 0x40`) through the receiver; byte 1: bit 7 charging, level
  `((b & 0x7F) - 1) x 5` clamped to 0-100. Rival 3 firmware `10 00` (2 raw bytes, shown in info).
- **Channel:** interface 3 for every model; Aerox on usage page FFC0 / 01, Prime Wireless and Rival 3 on page `*`.
  Report id 0, length 64.
- **No settings:** every other documented mouse setting is write-only (rivalcfg keeps a local copy and never reads the
  mouse), so `settings` is empty and `write()` refuses every key, naming the source for the write-only ones. The self-check
  waits while SteelSeries GG / Engine runs and otherwise writes nothing.
- **Never list:** saves `11 00`, `51 00` (Aerox, Rival 5, Prime Wireless), `09 00` (Rival 3, Rival 600), `59` (Prime
  wired) added with their product ids; the test checks none is ever sent.

### Gaps (write-only in rivalcfg: no read-back, so not offered)

| Setting | Bytes | Models | Source |
|---|---|---|---|
| DPI presets | `2D <count> <selected> <codes>`; `0B 00 ...`; `61 ...`; `03 00 ...` | Aerox, Rival 5, Prime Wireless; Rival 3; Prime; Rival 600 | rivalcfg multidpi_range_choice.py, truemove_air.py; sheet s3 |
| Polling rate | `2B <code>`; `04 00 <code>`; `5D <code>` | Aerox, Prime Wireless, Rival 5; Rival 3 / 600; Prime | rivalcfg device files; sheet s3 |
| Sleep timer | `29 <3 bytes>` (byte order unconfirmed) | Aerox Wireless, Prime Wireless | rivalcfg; sheet s3, s6 |
| Dim timer | `23 0F 01 00 00 <3 bytes>` | Aerox Wireless, Prime Wireless | rivalcfg; sheet s3 |
| Lights | `21`, `22`, `23`, `26`, `27`, `05 00`, `06 00`, `5F`, `62`, feature `05 00` | all | rivalcfg; sheet s3 |
| Buttons | `2A` + 5-byte fields | Aerox, Rival 5, Prime Wireless | rivalcfg; sheet s3 |

Also not covered: battery on the Prime Mini Wireless, Rival 3 Wireless and Aerox 3 Gen 2 (not in the battery row);
wired-only mice with no documented read (Aerox 3 / 5 wired, Prime, Rival 5, Rival 600).

**Unconfirmed:** the output report length (64 assumed, from the sheet's section 5 note), whether the battery reply
echoes the command in byte 0 (the driver takes the first input report after the request), and the Prime Wireless and
Rival 3 usage pages.
