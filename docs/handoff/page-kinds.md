# Page kinds: display, color, remap (22 Oct 2026)

An added or library device's page (`public/pages/my-device.js`) only knew `slider`, `toggle` and `choice`, so drivers
faked a reading as a slider that refuses. Three kinds are new, in the contract, the page and the driver.json format.

## What changed

**The contract** (`helpers/my-devices.mjs`, top comment):
- `display`: a reading (ChatMix, a sensor name). Any number, text, true/false or null, shown with its `unit`.
  - It is never written: the library guard refuses a write to it, and the self-check skips it.
  - It is not listed in `verified.json`, does not count in the self-check's "N of M" line, and never makes
    `needsCheck()` ask for a new check.
- `color`: `'#rrggbb'` (lowercase).
  - With `zones: [{ value, label }]`, the value is `{ <zone>: '#rrggbb' }`, with every zone.
  - One write, then a read-back, like any setting. The self-check writes the same value and reads it back.
- `remap`: `buttons: [{ value, label }]` and `targets: [{ value, label }]`. The value is `{ <button>: <target> }` for
  the buttons the device reports. The driver lists only documented targets.
- `problem()` refuses a remap without buttons or targets, and zones that are empty or repeat a value.
- `fits()` is exported. The self-check uses it to refuse a value outside the setting, for every kind.

**The page** (`public/ui/controls.js`, `public/style.css`):
- `readout`: the value with its unit, styled like the slider's number.
- `colorRow`: nine swatches in the Settings > Accent swatch look (`theme-swatch`, `sel`), a dot showing the current
  color, and a hex box.
  - A swatch writes at once. The hex box writes on Enter or when it loses focus.
  - A typo puts the device's value back. Esc cancels.
  - There is no browser color dialog.
- `lineList` + `remapSelect`: color zones and remaps show as compact lines under the setting's title.
  - Each zone gets its own swatch row. Each button gets a select that holds only the driver's targets.
  - A button reading a code the driver does not list shows "unknown (...)" until it is changed.
- Changing one zone or button sends the whole setting once, with only that part changed. Activity and Undo name the
  part, for example "Lights (Wheel)".
- No `title=` hover text, no popups, no timers (low CPU). The page's existing write toasts and Undo are unchanged.

**driver.json** (`helpers/declarative-driver.mjs`, `docs/DRIVER-FORMAT.md`):
- `display`: a `field`, never a `write` (refused).
- `color`:
  - It reads a `bytes` field of size 3 and is sent with `{value:rgb}`. `rgb` is allowed only there.
  - Zones are `[{ value, label, field, code }]`. The message carries `{zone}`, which sends the zone's code.
- `remap`:
  - Buttons are `[{ value, label, field, code }]` and targets are `[{ value, label }]`.
  - The message carries `{button}` (the button's code) and `{value}` (the target's code, from the button field's
    `map` or `write.encode.map`).
  - Every target must encode for every button, or the file is refused.
- `{zone}` / `{button}` anywhere a write does not give them (a read, a `then`, a plain write) is refused. A zone write
  without `{zone}` is refused too.
- The never-list check counts the real zone and button codes, and the target codes. An rgb value counts as any byte.
- A color or remap write sends one message per zone or button that changes. When nothing changes (the self-check's
  same-value write), it sends each part with its own value.
  - After sending, it reads back the whole setting and compares.
  - On a mismatch, the parts it sent are written back with the values read before, and the write fails.
  - `then` (a save) only follows a match.

**Library drivers:**
- **SteelSeries Arctis ChatMix** (game and chat) changed from refusing sliders to `display`, with a plain hint.
- `tests/sim-steelseries.mjs` now expects the `display` kind, and a self-check that leaves ChatMix out.
- The other workarounds in `driver-coverage.md` stay as they are, because they are not readings with a meaning:
  - Razer scroll mode, HyperX raw sidetone bytes and HyperX charging (raw) are undocumented raw numbers, so they stay
    in the device info.
  - Razer stage sliders, Logitech choices and the HyperX II Core sidetone step are real writable settings.
  - Colour and remap are still unused by any library driver: no source documents a read-back for Razer or Logitech
    static colour, ASUS stage colours or any button remap (driver-coverage.md "Gaps"). The kinds are ready when one is.

**Tests** (`tests/declarative-driver.mjs`, new part 4 only; the ASUS byte-for-byte proof is untouched and passes):
- A pretend device with display, one color, two zones and a two-button remap is accepted.
- 13 bad files are refused, each for its own reason.
- Reads come out as `'#rrggbb'` and objects. The exact frames go out (`31 r g b`, `32 <zone> r g b`,
  `33 <button> <code>`), and only the changed zone or button is sent.
- Refused writes send nothing. A zone that does not stick is written back.
- The my-devices self-check passes color, zones and remap, leaves the display out, and leaves the device as it was.
- `problem()` refusals are covered too.

`npm run test:offline` passes.

## Checked in the browser

DeviceHub's demo mode (`?demo`), with a pretend adapter registered from the console and its page drawn by
`devicePage()`. Nothing on the server or any real device was written: only GETs, and the pretend adapter kept its
values in the page.
- It looks like the other rows.
- A swatch, the hex box and a select each made one write with the right value. Undo and the toasts named the part.
- At 700 px wide the lines wrap and stay readable.

## For Shawn (files I may not edit)

- **CLAUDE.md**, "Adding your own devices" step 4: "the list its page is drawn from (slider, toggle or choice)" could
  read "the list its page is drawn from (slider, toggle, choice, display for a reading, color, remap; see
  helpers/my-devices.mjs)".
- **package.json**: nothing. No new test file; the new cases are in `tests/declarative-driver.mjs`, which is already
  in `test` and `test:offline`.

## Untested

- No real device has used `color` or `remap`. No library driver has either: they are tested on pretend devices only.
- SteelSeries ChatMix as `display` has been tested in its simulator only, like the rest of that driver.
- `npm test`'s live page checks (`tests/pages.mjs`) were not run here, since they need the live app. The demo pages
  have no added device, so they would not draw the new kinds anyway.
- A read-only (`readOnly`) color or remap is not greyed out. The existing kinds are not either: a refused write shows
  the usual "not changed" toast, then the page shows the device's value again.
