# Safety round 2, 22 Oct 2026

The nine audit findings are fixed. `npm run test:offline` passes. Nothing was committed, DeviceHub was not restarted,
no node was killed, and nothing was sent to a device. No `device-library/*/device.mjs`, `public/pages/learn.js` or
`helpers/learn-wizard.mjs` was edited (the wizard's save path needed no change: it already marks its drivers
`learned: true`, which the new gate reads).

## 1. Turn on settings: no write by itself from a driver that never ran on a real device

- A **real-device record** is an entry in `device.json` `tested` that is not a simulation: no `"simulation": true`,
  and its `by` / `how` do not say simulated, "never run on a real", "nobody yet", "not tested yet" or a `tests/` file
  (`realRecord`, `hasRealRecord` in `helpers/my-devices.mjs`). **No shipped entry has one today**, so every library
  driver now waits for the click. A person's record from `share-device.mjs` counts (written, or read only).
- Such a driver (and every learned driver, `library.json` `learned: true`) installs and READS by itself. Its
  self-check and every write wait until the person presses **Turn on settings**. That is kept in its
  `library.json` as `settingsOn: { at }`, then the self-check runs at once (same rules: backup first, one setting at a
  time, the value just read written back, read back).
- Where the button is: the device's page (`public/pages/my-device.js`, under Settings, with the line "DeviceHub writes
  each setting's current value back once to make sure it works."), the Set up card (`summary()` action
  `{ kind: 'turn-on', id, label }`), and the "Why isn't it working" panel (diagnose finding with a `turn-on` action).
- Plumbing: `guard()` adds `a.turnOn()`; `turnOn(id)` export; `public/core/devices.js turnOn(id)` (device lock, then
  a full read); agent op `turn-on` (`POST /api/agent/turn-on`); diagnose action `{ kind: 'turn-on', id }`.
- Drivers with a real-device record keep today's behaviour. Settings the wizard added to one (`learnedKeys`) wait
  for the click too; settings learned after a click wait for another one (`learnedAt` later than `settingsOn.at`).
- A "tested" entry without a real-device record writes like a read-only one (only what passed its check).
- Check again never writes a setting that is still waiting for Turn on settings.
- Wording: auto setup's Activity line, the Set up card lines, `installNote()` / the install `note`
  (`helpers/device-library.mjs`), the server log line, the diagnose finding.

## 2. The never list in the send path

- `helpers/never-guard.mjs` reads `helpers/never-commands.json` (`commands` with bytes). `helpers/hid-host.mjs`
  checks it in `sendNow` (output reports, raw `SEND`, routes) and `sendFeatureReport` (`FSET`) before any byte goes
  out, and throws a plain error (`e.never === true`): "DeviceHub did not send this to the <device>: it is on
  DeviceHub's never list (<what>). Nothing was sent."
- Only channels added through `addSpec` carry `spec.never` (every library and my-devices driver). The Pulsar and P75
  specs (`SPECS`, `useKeyboardSpec`) never do. The HS80 never goes through hid-host (`hs80-direct.js`, its own
  `hs80:` channel). `tests/hid-core.mjs` section 8 proves the mouse's and keyboard's bytes are unchanged and never
  checked, and that no hid-host channel is the HS80.
- A pattern longer than the bytes is matched against zeros (the helper pads reports). Entries limited to one usage
  page (the VIA FF60 ones) are not applied on a `page: '*'` channel, because those first bytes mean other things on
  other pages (HyperX Alloy keyboards use `'*'`).
- Not covered by bytes: the Corsair drivers talk property ids over the helper's `hs80:...:bragi` channel, and the
  Corsair never entries have no byte pattern (the helper's SET list is their guard).

## 3. The maker's-app check fails closed

- `makerAppOf` returns `{ unknown }` when the driver's `vendorApp()` throws or times out, or DeviceHub's own list
  fails. The self-check then returns `{ ran: false, waiting: true, unknown: true }` and writes nothing; a later
  connect tries again.
- DeviceHub's list (`makerAppByVid`) is asked even when the driver has its own check, because a driver's tasklist
  can answer null on a timeout (I could not edit the drivers). Its `tasklist` failing, timing out or listing nothing
  is now an error.
- While the last check was "could not check", writes are refused (`waiting: true`) until a check succeeds (each write
  checks again first).

## 4. The HS80 and DeviceHub's own ids

- `ownDevice()` now uses every id a driver declares: `hid` (pid, cablePid, pids, byPid keys), a top-level vid / pids
  (driver.json), and the `device.json` beside it. ANY overlap with `pc-map.js RUNS` counts (`ownClash`).
- Refused on any overlap: install (`installFromLibrary`, so the click and auto setup both), auto setup's run, the Set
  up card's offer, the self-check, Turn on settings and every write (the guard asks `ownDevice` before
  `writeAllowed`).
- HS80 ids: receiver `0A6B`, cable `0A69` (`hs80-direct.js` CONNS), `0A71` behind the receiver
  (docs/brands/corsair.md, OpenLinkHub). `RUNS` is the right place: it is DeviceHub's own list of what its drivers
  run, and only labels and guards read it (This PC's runs column, OpenRGB's own-device filter, the learning wizard,
  the library guards); the Headset page is chosen by its own driver, so it is unchanged. Added to `RUNS`:
  `1b1c:0a69`, `1b1c:0a71` and the Pulsar's cable `3710:3506` (same gap). `0A88` (HS80 RGB USB) is another model
  DeviceHub's code does not open, so it is not listed.

## 5-8.

- 5: `my-device.js` disables every read-only control (toggle, choice, slider, color, remap) and keeps the reason as the
  visible line under the setting's name; no tooltips.
- 6: Check again shows whenever the device is connected and a setting is failed, waiting or never checked (no earlier
  check needed). "Checked again: 3 of 4 settings passed, 1 stays read-only." (`checkAnswer` in `common.js`; counts
  come from `selfCheck`'s new `counts`). Displays are no longer counted as unchecked.
- 7: `asText`'s next step points to Install, Learn a device and Turn on settings. Devices from makers DeviceHub has no
  notes on get one line under Optional pointing to Learn a device ("it needs the maker's app to learn from"). A
  device a brand sheet lists with 128- or 1024-byte packets (Corsair `1BC4`, K70 RGB Pro, K100 ...) gets a line
  saying so (read from the sheet's tables).
- 8: `/api/report/short`'s Equalizer APO line uses `eqapo.devices()` (the picked headset).

## 9. Docs

`ADD-YOUR-DEVICES.md` (16 drivers, what happens after install), `docs/TOP-BRANDS.md` (a table of all 16),
`device-library/README.md` (status meanings plus the real-device rule). `docs/handoff/auto-setup.md` is history and
was left as it was.

## Tests

- `tests/auto-setup.mjs`: the existing proven drivers got a `device.json` with a real record; new: simulation /
  tested-with-simulation / no record wait for the click (no write, no backup, refused write, Check again refused),
  Turn on settings kept and checked with counts, learned settings on a proven copy, maker's-app check failing
  (driver's and DeviceHub's), an HS80 id from `device.json` without `hid`, the summary's turn-on and check-again
  actions, unknown makers, packet size, an HS80 library entry never offered or installed.
- `tests/my-devices.mjs`: no shipped entry is proven, `needsTurnOn`, `ownClash`, `declaredIds`, `RUNS`.
- `tests/device-library.mjs`: one HS80 id refuses the install; `installNote`.
- `tests/hid-core.mjs` section 8: the never list in the send path; the built-in mouse and keyboard unchanged.
- `tests/diagnose.mjs`: the turn-on finding; Check again for an unchecked setting.
- `tests/sim-logitech.mjs` section 6: presses Turn on settings before the G HUB steps.

## For the other agent (files I did not touch)

- `helpers/learn-wizard.mjs` notes (~1169, ~1190) and `public/pages/learn.js` line 3 say "stays read-only until it
  passes its check": add "after you press Turn on settings on its page".
- If a driver ever runs on a real device, `share-device.mjs` adds a real record and it keeps the old behaviour.

## Lines for CLAUDE.md

- Under the library self-check notes: "A library driver with no real-device record in `device.json` `tested`
  (simulations and test files do not count; every entry shipped today) and every driver the learning wizard made
  installs and reads by itself, but writes nothing, its self-check included, until the person presses Turn on
  settings on its page or the Set up card. DeviceHub then writes each setting's current value back once to make sure
  it works. Drivers with a real-device record self-check on connect as before."
- "The never list (`helpers/never-commands.json`) is checked in the HID send path for every library and my-devices
  driver (`helpers/never-guard.mjs`, hid-host `checkNever`); DeviceHub's own Pulsar, P75 and HS80 paths are never
  checked."
- "'Could not check whether the maker's app is open' is waiting: no self-check and no writes until a check succeeds."
- "No library driver installs, self-checks or writes when ANY id it declares (hid, driver.json, device.json) is in
  `helpers/pc-map.js` RUNS (HS80 0a6b / 0a69 / 0a71, Pulsar 5406 / 3506, P75 e479)."
- In "Set this up" step 3's report: "Its next step points to Install, Learn a device and Turn on settings, not to this
  file."
