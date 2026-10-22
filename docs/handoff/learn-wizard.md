# The learning wizard, 22 Oct 2026

Goal (the owner): "build it out more so someone doesnt need claude to remake the apps necessary to control all features
of a device they own". Someone with a device DeviceHub does not run opens **Learn a device**, changes one setting at a
time in the maker's app while DeviceHub listens, and ends with a working `my-devices\<name>\driver.json`
(docs/DRIVER-FORMAT.md). No Claude needed.

## What it does (all read-only toward the device)

1. **Pick the device**: every present HID device with a writable collection that DeviceHub does not run (not in
   `pc-map.js` RUNS, not already in `my-devices`). Read by `helpers/learn-hid-list.ps1` (access-0 opens, the same as
   `hid-caps.ps1`; the instance id is never printed). Vendor-page devices first; a device with a library driver says so.
2. **Get ready**: USBPcap missing = the existing Install button (`public/ui/installer-button.js`) and "restart the PC
   once". The person names the setting (DPI, Brightness...), its kind (number, on/off, choice) and two values.
3. **Listen**: "Start listening" starts `helpers/learn-capture.ps1` once per session through Windows' admin prompt
   (UAC; USBPcap needs admin). It records every root hub with `USBPcapCMD -A --inject-descriptors -s 1100` per take, on
   commands from the wizard (`learn\wizard\<session>\command.txt` / `state.json`: start, stop, quit only). It quits by
   itself after 30 minutes, on Save, on Stop learning, or when its folder is gone. Recordings stay in `learn\`
   (gitignored), never in `my-devices\` (so Share never sees them).
4. **Diff** (`analyze()`): the device is found in each recording by its injected device descriptor (vid/pid), its
   interrupt and SET/GET_REPORT traffic becomes reports (report id stripped when its collections declare ids). Messages
   sent identically in every take are background. The write = the same report and first byte in every take, a few
   bytes apart (the last one in each take, so a dragged slider counts with its final value). The value: 1/2/4 bytes,
   little or big endian, `raw * scale + add` (scales 1, 2, 4, 5, 8, 10, 16, 20, 25, 50, 100, 125, 250, 0.5, 0.1; add 0
   or +-scale), or one code per choice / on-off. A checksum byte (xor, sum8, sum16le over the bytes before it) is found
   only if it holds on every outgoing message of that report. The read = a request sent the same in every take whose
   reply (after the write) holds the value; the write must have its own reply before the next request; echo = the
   leading bytes both replies repeat.
   **Refused, in plain sentences**: nothing sent; the same messages for both values; a byte other than the value moving
   (a counter, a whole settings block); two messages or two places carrying the value (asks for a third value, then
   refuses); no read reporting the value back; a write the device never answers; replies that repeat nothing.
5. **Driver**: `buildDriver()` makes the driver.json (templates = the recorded bytes, the value as one placeholder,
   trailing zeros dropped, checksum computed), `validate()` runs (its sentences are shown), and `verifySeen()` rebuilds
   every recorded read and write with declarative-driver's own `build()`: any byte different from the recording and it
   is not made. The person gives the slider's range from the maker's app; each learned setting `keep`s the others (a
   write that moves another learned setting is put back). Several settings go into one driver, one at a time.
6. **Save**: `my-devices\<name>\driver.json` + `library.json` `{ status: "read-only", learned: true }` (never over an
   existing folder). `my-devices.mjs` loads it GUARDED: no write until each setting passes the existing self-check
   (read, write the same value, read back) the first time the device connects. Loaded at once through `loadNew()` when
   the agent runs, else on the next start.

## Files

New: `helpers/learn-wizard.mjs`, `helpers/learn-capture.ps1`, `helpers/learn-hid-list.ps1`, `public/pages/learn.js`,
`tests/learn-wizard.mjs`, this file.
Changed:
- `helpers/device-library.mjs`: `DRIVER_FILES`, `driverFileOf(dir)`, `loadDriver(dir)`; a library entry may hold
  `driver.json` instead of `device.mjs` (`list`, `installFromLibrary` load it with `fromJson` and copy it).
- `helpers/share-device.mjs`: shares `driver.json` when the folder has no `device.mjs`; result has `file`.
- `helpers/share-route.mjs`: the Share button accepts a driver.json folder (link and attachment name it).
- `helpers/my-devices.mjs` `guard()`: a driver.json driver builds its settings list fresh on every read, so the
  read-only marks (hint, readOnly) were lost; they are now laid over each list. Writes were refused before too.
- `helpers/pcap-read.mjs`: `readPcapBuffer(buf)` exported; each record also has `ts` (absolute time).
- `public/app.js`: `learnPage` in PAGES (last, so Alt+1..8 are unchanged), `rail: false` keeps it out of the sidebar.
- `public/pages/overview.js`: Set up card's Still to do gets a "Learn a device" button.
- `public/pages/pc-lights.js`: This PC's "Other devices plugged in" gets "Learn it".
Style: a small `<style id="learn-css">` block inside learn.js; nothing in style.css, art.js or theme.js.

## Lines for you

`server.js`, beside the `/api/share/` line in `api()`:
```js
  if (url.pathname.startsWith('/api/learn/')) { try { if (await (await import('./helpers/learn-wizard.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
```
`package.json`: add `node tests/learn-wizard.mjs` to both `test` and `test:offline`, after `node tests/declarative-driver.mjs`.

`CLAUDE.md`, "Adding your own devices", step 3, first line: "**The person can do this without Claude**: Overview > Set
up > Learn a device (or Lighting > This PC > Learn it) listens while they change one setting at a time in the maker's
app, and saves a read-only `my-devices\<name>\driver.json` (docs/handoff/learn-wizard.md). Claude follows the steps
below for what the wizard refuses." And in the Map:
`helpers/learn-wizard.mjs   Learn a device: USB recordings -> driver.json, read-only toward the device (public/pages/learn.js)`.

## Untested on hardware (nothing here was run against a device or USBPcap)

- `learn-capture.ps1` has not run: the UAC start, `--inject-descriptors` on USBPcap 1.5.4.0, the per-hub files, the
  forced stop leaving a readable pcap (the existing learn scripts do the same), and the command loop.
- The control-transfer layout is written from USBPcap's format (setup stage, data stage, completion); a real
  SET_REPORT / GET_REPORT recording has not been read. Interrupt traffic matches what `pcap-read.mjs` already reads.
- `learn-hid-list.ps1` ran once on this PC (read-only) and listed the Pulsar and HS80 collections correctly.
- No learned driver has driven a real device; feature-report drivers also depend on hid-host's untried FSET/FGET.
- The page was not opened in a browser (needs the server.js line and a restart). `tests/pages.mjs` will open it.
- Known limits: two values that both fit one byte make it a one-byte number (the range check then refuses a range
  above it: "learn it again with values further apart"); the write is found by "same first byte", so a protocol with
  the value in byte 0 is not learned; wireless (receiver) links, several product ids and `stepBack` (the maker's app
  name) are not set: the wizard says to close the maker's app before saving.
- `helpers/library-updates.mjs` and `make-library-bundle.mjs` (signed library bundles) still carry device.mjs only; a
  shared driver.json-only entry ships with the next release, not between releases, until they learn it too.

Since then (22 Oct 2026, docs/handoff/learn-readings.md): readings (battery, charging, ChatMix, a sensor) are learned
too, and after a save the same device can be learned on its other USB id (cable and receiver) into the same driver.
