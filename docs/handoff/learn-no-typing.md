# Learn a device with no typing, 22 Oct 2026

Shawn: his friend "has to type in what he wants the app to learn? Thats far too much work. shouldnt it recognize the
software that is used for his devices and ask about it?"

Learn a device now names the maker's app and offers the settings as a tick-list. The person ticks, presses
**Learn these**, and DeviceHub either changes each setting in the maker's app itself or shows one line saying what to
change. The diff, validate, verify and save path is the one from docs/handoff/learn-wizard.md, run once per setting.
One driver.json is saved read-only, as before. `npm run test:offline` passes. Nothing was committed. DeviceHub was not
restarted.

## What the person sees

1. **Pick the device.** When only one device can be learned, it is picked by itself, once. A device sent from This PC
   (Learn it) is also picked by itself.
2. **Learn the <device>.** One line about the maker's app:
   - open: "Corsair iCUE is open. DeviceHub changes each ticked setting in it, listens, and puts it back as it was."
   - installed but closed: says so, with a **Look again** button. If it stays closed, the person is asked to change
     each setting.
   - not installed: "Its app, Corsair iCUE, is not installed: <official page>". Nothing else.
   - a web app (Keychron Launcher): its page, and change each setting there.
   - unknown maker: change each setting in the maker's app when asked.

   Below it is the **tick-list**. Each row has a tick box, the setting, two prefilled values (editable, never needed),
   and its kind and source in small text. A reading row (Battery) has a small percent box and is never ticked by
   itself. USBPcap missing: the existing Install button, and Learn these stays off until it is installed.
   **Other setting** (collapsed) holds the old form, unchanged.
3. **Learn these.** For each ticked setting in turn, one at a time:
   - `setting`, then `listen` once (one admin prompt, as today).
   - When the app is open, DeviceHub drives it: "DeviceHub is changing DPI in Corsair iCUE to 800, then 3200, and
     listening. Then it puts it back."
   - Otherwise, or when the control cannot be found or driven, one line: "Change DPI from 800 to 3200 in Corsair iCUE
     now. Then press Done." Recording starts when the line shows. Then "Now change DPI from 3200 back to 800." with
     Done. If DeviceHub tried to drive it first, the reason comes first, for example "DeviceHub could not find Lift-off
     in Corsair iCUE." Charging asks for plug in, then unplug. Battery asks to open the battery page.
   - Then `analyze` and `add` run. The setting is added at once when its range is known (the app's own slider or
     files) or not needed (choice, toggle, reading). A number with no known range stops on the Found step with the
     range prefilled from the recorded values, so the person checks it and presses Add. A setting that cannot be
     learned shows the existing Found step with **Skip it**, which moves on to the next setting. **Start this setting
     over** redoes the same setting.
   - If DeviceHub could not put a value back, a line stays at the top of the page: "DeviceHub could not put DPI back.
     It was 1200 before: set it to 1200 in Corsair iCUE."
4. **Driver.** The existing step. Name and kind are prefilled (kind from the device: mouse, keyboard or headset).
   Settings that were not learned are listed with why. **Learn another setting** goes back to the tick-list, where the
   learned ones show "learned". **Save the driver** saves as today.

There are no popups, notifications or tooltips. The look stays the same: a few lines in the page's own
`<style id="learn-css">`, and nothing in style.css.

## Where the tick-list comes from (helpers/learn-apps.mjs, read-only)

- **The maker's app** (`findMaker(vid)`): `MAKERS`, one row per maker. It holds the vendor ids, the official name and
  page (each page checked with a GET on 22 Oct 2026), the vendor-files app ids, the app-ui window and the
  installed-programs pattern.
  - Installed: one of vendor-files' install folders holds an .exe, or Windows' Uninstall list or Store packages name
    it (one read-only PowerShell call).
  - Running: tasklist, using diagnose.mjs MAKER_APPS' process patterns.
  - Masterplus+ (2516) is in the list too.
- **a. The app's own files**: `vendor-files.scan({ vid })`. A setting range whose device is this model, or has no
  device, becomes a number item with the app's range and two values. A saved true or false (iCUE config.cuecfg)
  becomes a toggle. A saved value whose name is a usual setting becomes that usual setting.
- **b. The brand sheet** (`docs/brands/<brand>.md` section 3 "Settings map"; `BRAND_SHEETS` maps vendor ids to files).
  - A row is kept if it fits the device kind and is not read-only.
  - Battery and Charging become readings.
  - The sheet's numbers are the device's raw values, not what the app shows, so values come from the usual list.
    The sheet only says which settings exist and their kind ("(tactile / free spin)" becomes a choice, 0/1 a toggle).
- **c. The usual list**, only when a and b found nothing:
  - mouse: DPI, Polling rate, Lift-off, Debounce
  - keyboard: Brightness, Report rate
  - headset: Sidetone, Auto-off
  - a device of unknown kind gets all of them.
- Never offered: anything matching app-ui's refusal list plus pairing and DFU (`FORBIDDEN`), and lights, colors, EQ,
  macros, remaps, profiles, modes, ids, versions and mute (`SKIP`). There is one item per setting, at most 10, and the
  first four non-readings are ticked.
- **The device kind** (`deviceKind`): from its name first, then its HID collections (generic desktop mouse or
  keyboard).

## Driving the app (helpers/learn-wizard.mjs `drive()`, POST /api/learn/drive)

This step runs only after `setting` and with the listener ready.
1. It refuses a setting named like firmware, update, reset, factory, flash, bootloader, delete, format, pairing or DFU.
2. It runs `app-ui.ps1 get -Window <app> -Name <setting> -Json`.
3. It falls back to the person when:
   - the app is not open
   - the control is not found, or several match (app-ui exits 2)
   - the control's own name or id is on the refusal list
   - the control is disabled or read-only
   - the control is not that kind (a slider for a number, a switch for on or off, a list for a choice).
4. It reads the original value. For a number, the slider's own min, max and step become the range. Values outside
   the range are moved inside it.
5. For each value it starts recording, waits 0.8 s, runs `app-ui.ps1 set`, waits 1.5 s, then stops. When the app
   already shows the first value, the second value goes first.
6. It always puts the original value back and reads it again. `restore = { ok, value, shown, why }`, and `why` says
   plainly that the value could not be put back, with the original value.
7. If a set fails part way, the recordings are dropped, the value is put back, and the person is asked instead.

app-ui is only ever called with `get` and `set` for that one setting's name. It never runs `click`, so it never
presses Apply, Save or any other button. app-ui.ps1 keeps its own refusal list, and the wizard reads that list from the
script (`$Forbidden`), so the two cannot drift apart.

## Files

- New: `helpers/learn-apps.mjs`, this file.
- Changed:
  - `helpers/learn-wizard.mjs`:
    - `record`/`stop` now go through `startTake`/`stopTake` (same behaviour)
    - new `plan` (POST, and GET /api/learn/plan, `?again` to look again) and `drive` steps
    - `summary()` has `maker`
    - `deps.plan` and `deps.appUi`; `DRIVE` timings.
  - `helpers/vendor-files.mjs`: a range object's own name (`{ name: 'DPI', min, max }`) was also taken as its device
    name. Its device is now the one around it. vendor-files tests still pass.
  - `public/pages/learn.js`:
    - the plan step, the queue, the driving and change views
    - Skip and Start over work inside a list
    - demo mode runs the whole flow on pretend answers (`demoApi`). Before this, demo mode showed "Not in demo mode".
  - `tests/learn-wizard.mjs`: the "Learn without typing" section.
- Not touched: `server.js`, `package.json`, `CLAUDE.md`, `helpers/my-devices.mjs`, `helpers/hid-host.mjs`,
  `helpers/native/*`, `helpers/app-ui.ps1`.

## Tests (tests/learn-wizard.mjs, no window, no device, no USBPcap)

- **Stand-in maker files** in a temp folder, passed as the environment: iCUE installed, a devices.json with the
  Kite's DPI range (and another model's Debounce range plus a Firmware update range), and a config.cuecfg with
  AngleSnapping, PairingMode and DeviceSerial.
  - iCUE found installed and open; SteelSeries GG not installed (its name and page); installed found only through the
    Uninstall list; an unknown maker.
  - The tick-list:
    - the app's own DPI range and two values
    - Angle snapping as a toggle
    - no firmware, pairing or id items, and no other model's range
    - one DPI, readings never ticked.
  - A SteelSeries headset from its brand sheet (Sidetone, Auto-off; no EQ or lights). An unknown mouse gets the usual
    four. Keyboard and headset lists. `valuesIn`.
- **A stand-in app-ui** (a pretend iCUE window as data; "setting" a control makes the pretend app send the value
  while the stand-in listener records it):
  - DPI driven 800, then 3200, then back to 1200 (read back). Only `get` and `set` on DPI in the iCUE window are
    called. The slider's range comes back, the two takes are learned, and DPI is added with the app's range.
  - A control whose id says firmware update: nothing is set, and the person is asked.
  - A setting the app does not show: nothing is set. The manual fallback (record, stop, twice) learns Lift-off. One
    driver.json with DPI and Lift-off is saved read-only.
  - The app already at the first value: the second value goes first, and the device ends where it began.
  - Values outside the slider's range are moved inside it.
  - A failed restore: "could not put DPI back. It was 1200 before: set it to 1200 in Corsair iCUE".
  - iCUE closed: nothing is driven. A reading is never driven. A pairing setting is refused.
- **The page**: opened in demo mode on the running DeviceHub (GET only):
  - `?demo#/learn` shows the auto-pick, maker line and tick-list. DPI and Polling rate are driven, and Lift-off falls
    back to the two Done lines. The Driver step comes next, with Mouse prefilled.
  - `&learnapp=missing` shows the not installed line with the page.
  - `&learnapp=closed` shows installed but not open, with Look again. Other setting opens the old form.
  - `&learnapp=nopcap` shows the USBPcap install block, with Learn these off.
  - The phone width stacks the rows.
  - The console showed one "An unknown error occurred when fetching the script". It looks like the service worker,
    not this page.

## Untested on a real app

- No real maker app was driven (on purpose: nothing on this PC was touched). Whether app-ui finds a control by the
  name DeviceHub uses depends on each app:
  - G HUB, Synapse 4, GG and iCUE 5 are Chromium or Electron apps whose controls UI Automation often cannot see
    (docs/handoff/app-ui.md). Those fall back to the one-line request.
  - An app that needs Apply after a change is never driven to Apply, so it records nothing. The analysis then refuses
    ("Nothing went to or from…", or the same messages for both values) and offers Skip or Start over.
- Choice values from the usual list ("125 Hz", "1000 Hz", "Low", "High") may not be the app's own words. app-ui then
  says "no choice", nothing is changed, and the person is asked.
- The 0.8 s and 1.5 s waits are guesses. An app that sends later than 1.5 s after the change would be recorded
  without its write.
- Windows' installed-programs read and tasklist ran once on this PC (read-only): no Corsair, Pulsar, Epomaker, Logitech,
  Razer or SteelSeries app is installed here, and findMaker said so.
- The `MAKERS` window names (lghub, Razer Synapse, iCUE, SteelSeries GG, ...) are not checked against the real windows.

## Lines for you

`server.js`: nothing (the `/api/learn/` route already passes every step and `GET /api/learn/plan` to
`learn-wizard.mjs handle()`). The running DeviceHub needs a restart to load the new steps.

`package.json`: nothing (the tests are in `tests/learn-wizard.mjs`, already in both lists).

`CLAUDE.md`, the Map, after the learn-wizard line:
`helpers/learn-apps.mjs     Learn without typing: the maker's app (installed, running), the tick-list (app files > brand sheet > usual list), read-only`

`CLAUDE.md`, "Adding your own devices", step 3, after "...saves a read-only `my-devices\<name>\driver.json`
(docs/handoff/learn-wizard.md).":
"It names the maker's app (installed or not, open or not) and offers the settings as a tick-list from the app's own
files, the brand sheet or the usual list; with the app open it changes each ticked setting there itself through
app-ui (get and set of that one control only, then puts the value back), else it says in one line what to change
(docs/handoff/learn-no-typing.md)."
