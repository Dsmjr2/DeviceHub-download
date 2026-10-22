# Library drivers: safety fixes from the audit (22 Oct 2026)

A safety audit found library drivers whose self-check could pass without proving anything, or while changing the
device. The library self-check (`selfCheck` in `helpers/my-devices.mjs`) reads a value, writes that same value, reads
it back and requires a match. That only proves something if the write really reaches the device, and if writing the
same value really leaves the device as it was. Every fix below is in a driver and its sim test. Nothing was sent to a
real device. DeviceHub was not restarted. `helpers/*`, `server.js`, `package.json`, `CLAUDE.md` and `public/*` were not
edited.

## The five audit findings

| # | Driver | Problem | Fix |
|---|---|---|---|
| 1 | `logitech-hidpp-headset` | PRO X 2 (Centurion): sidetone and auto-off skipped the write when the value was unchanged (Solaar's `prepare_write` does this). The self-check passed without anything being sent. | The write is always sent, then read back. |
| 2 | `corsair-bragi-peripherals` | The sleep timer (ms shown as minutes) and brightness (tenths shown as %) were rounded before the write. For example, 90 s was written back as 120 s and raw 455 as 460. The rounded read-back still matched. | `write()` reads the raw value first. If the value asked for is what that raw value shows, the exact raw value is sent back. A raw value the helper cannot send exactly (30 s is below its 60000 ms floor) is refused, not rounded. The read-back is compared raw against what was sent. |
| 3 | `logitech-hidpp-keyboard` | Onboard-profile numbering is unconfirmed (Solaar 1-15 or libratbag's index). With the wrong numbering, the self-check would select the wrong profile and put the same wrong one back. | `profile` is `readOnly: true, selfCheck: false`, and its hint says why. `write('profile')` is refused before anything is sent, and fn 0x30 is never sent. The active profile still shows. |
| 4 | `corsair-bragi-peripherals` | While iCUE ran, the driver did not connect or read at all. | It connects and reads (GETs only) while iCUE runs. Every write is refused (`waiting: true`) and nothing is sent. `vendorApp()` still names iCUE, so the self-check waits. |
| 5 | `logitech-hidpp-keyboard` | G915 receiver `046d:c547` was left out only because `tests/device-library.mjs` used it as its "unclaimed receiver" example. | The example is now `046d:c5ff`, and the test checks that no real library entry claims it. C547 is in `RECEIVERS` and device.json (source: OpenRGB `LogitechControllerDetect.cpp` through `docs/brands/logitech.md` section 1, "G915 / 0xC33E / 0xC541, 0xC547"). The test checks that only this driver matches it. A mouse on C547 is still refused by its 0x2201 feature. |

## The same patterns in the other drivers

All 16 library drivers (plus `_example-light`) were checked for skipped unchanged writes and for lossy conversions
before a write.

| Driver | Found | Fix |
|---|---|---|
| `corsair-bragi-headset` | The same rounding as #2: sleep timer ms to minutes, sidetone tenths to %. It also dropped the device while iCUE ran, like #4. | The same fix as #2 and #4. |
| `razer-mouse` | DPI and each DPI stage were written as an X / Y pair with Y = X. On a mouse whose Y differs, writing back the X just read set Y to X, and the check passed because Y "now matches". Scroll acceleration and smart reel read any byte other than 1 as off. | Y follows X only when the two were equal. Otherwise Y is sent back as read, and the read-back checks that Y kept its value. A toggle byte other than 0 or 1 reads as `null`, so the self-check never writes it back. |
| `razer-keyboard` | Game mode and the macro light read any byte other than 1 as off, so a write-back would send 0. | They read only 0 or 1; anything else is `null`. |
| `asus-rog-mouse` | Angle snapping read any byte other than 1 as off. Reads also stopped while Armoury Crate / G-Helper ran, although the sheet's reason ("nothing stops two writers") is about writes. | Angle snapping is reported only for 0 or 1. Reads go on while those apps run; every write is still refused. |
| `logitech-hidpp-keyboard` | The F-key swap read any byte other than 1 as off. | It reads only 0 or 1; anything else is `null`. |
| `logitech-hidpp-mouse`, `steelseries-arctis`, `hyperx-cloud`, `keychron-via` (driver.json), `_example-light` | Clean: every write is sent, and raw values map one to one (report-rate ms values 1-8 give distinct Hz, ASUS-style code tables are one to one, Keychron writes raw seconds). | None. |
| `glorious`, `wooting`, `turtle-beach-battery`, `hyperx-peripherals`, `steelseries-mouse` | No writes at all. | None. |

**Left as is, on purpose:** `glorious`, `wooting` and `turtle-beach-battery` still stop reading while their maker's
app runs. Their sheets say that app holds the channel or uses the same reports: Swarm II leaves "only idle frames",
Wootility "holds the same channel", and Glorious Core "use[s] the same feature reports". A read there is itself a
request on that channel, and none of these drivers writes anything. Change it if you want every driver to behave the
same way.

## Tests (each proves its fix)

- `tests/sim-logitech-headset.mjs`: an unchanged sidetone ([01 FF 0F]) and auto sleep ([07 14]) are sent. The
  self-check is shown to send both values it read.
- `tests/sim-corsair-bragi-peripherals.mjs`: a self-check of a 90 s timer sends raw 90000 and never 120000. Raw
  brightness 455 goes back as 455, never 460. Raw 30000 ms is refused with nothing sent. A changed value is still
  written as minutes x 60000 / % x 10. Mice and keyboards connect and read while iCUE runs; every write, including one
  of the same value, is refused with nothing sent. Every write now starts with a GET of the same id, and the
  byte-order checks expect it.
- `tests/sim-corsair.mjs` (the Bragi headset): the same, for 90000 ms and raw 455, the toggles, raw 30000, and iCUE.
- `tests/sim-logitech-keyboard.mjs`: the profile is read-only and `selfCheck:false`, its hint says why, no profile
  write is sent, fn 0x30 never goes out, and the self-check skips it. A G915 works on C547, and a mouse on C547 is
  refused. The self-check sends mode, key locks, F-key swap and brightness. Reads go on while G HUB runs and a
  same-value write is refused. An F-key byte of 2 is never written back.
- `tests/sim-razer.mjs`: with X 1600 / Y 800 and a stage with X 1600 / Y 1200, the self-check leaves every raw value as
  it was and sends X and Y as read. A new X keeps a separate Y. A smart-reel byte of 2 is never written back. Reads go
  on while Synapse runs and a same-value write is refused. (The simulated mouse gained an optional separate Y per
  stage.)
- `tests/sim-razer-keyboard.mjs`: the self-check sends brightness, both LED states and the polling rate. Reads go on
  while Synapse runs and a same-value write is refused. A game-mode byte of 2 is never written back.
- `tests/sim-asus.mjs`: reads go on while Armoury Crate runs and a same-value write is refused. The self-check sends
  every value it read and leaves every raw byte as it was. An angle-snapping byte of 2 is never written back.
- `tests/device-library.mjs`: the example receiver is `046d:c5ff`. No real entry claims it, and only
  `logitech-hidpp-keyboard` claims `046d:c547`.

## Test run (22 Oct 2026)

Every script in `npm run test:offline` passes, except two that fail on another session's in-progress edits to
`helpers/my-devices.mjs` and `helpers/auto-setup.mjs` (a "Turn on settings" gate). This job edited neither file:

- `tests/auto-setup.mjs` (edited by that session too): "a driver waiting for its click offers Turn on settings".
- `tests/sim-logitech.mjs` (the mouse driver; neither it nor the driver was touched here): "G HUB open: the
  self-check writes nothing and says so". The log line it gets is the new "Turn on settings" wording.

## Still unconfirmed

- Keyboard profile numbering: one read of 0x8100 fn 0x40 on a real G915, with a known profile active, settles
  Solaar's or libratbag's numbering. Then set `profile` writable again (the fn 0x30 line is kept as a comment in
  `write()`).
- C547 may also carry recent Lightspeed mice (`docs/brands/logitech.md` open question). The keyboard driver refuses a
  mouse there. `logitech-hidpp-mouse` still leaves C541 / C545 / C547 out.
- Reading Corsair devices while iCUE runs: the sheet says both use the same channel. GETs can get iCUE's replies or
  none (then "asleep"). Nothing is ever written while iCUE runs.
