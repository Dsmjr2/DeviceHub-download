# DeviceHub: notes for Claude Code

DeviceHub is a local Windows app that replaces the vendor apps for one mouse, one headset and one keyboard, plus
Windows sound (Equalizer APO) and monitors (DDC/CI). It was built for a Pulsar X-Lite CrazyLight, a Corsair HS80 and an
Epomaker P75. Someone with other devices adds their own by following "Adding your own devices" below.

## "Set this up" (or any request like it, on a new PC)

The person may only say "set this up", "install this" or "make it work with my stuff". Do all of this without being
asked for each part; stop only where a step below says to ask. Say in a line or two what you are doing as you go.

**Ask everything once, up front, then work without stopping** (22 Oct 2026, the owner: they should not have to prompt
"hundreds of times"). After step 3's report, put every question in ONE message, as a short numbered list with a
suggested answer for each, so one reply ("yes to all", or "1 yes, 2 no") covers the whole setup:
- each optional install the report names (Equalizer APO for the EQ, USBPcap for a learning session, OpenRGB and
  PawnIO for the motherboard's and RAM's lights): name, official link and size, and what it adds. Equalizer APO and
  OpenRGB ship inside DeviceHub, so nothing is downloaded for them: Equalizer APO's installer is in the zip and still
  needs the person's click to install, and the built-in OpenRGB 1.1 reaches USB lights only until the person clicks
  Add board, fan and RAM lights (Lighting > PC lights, or Setup), which installs PawnIO if missing and runs it as
  administrator; Claude never does that step for them. For Equalizer APO, ReaPlugs and USBPcap, point the person to Settings >
  Optional tools > Show (or the Equalizer card's button): DeviceHub shows the file, source, size and check, and runs
  the maker's installer itself after their click, so Claude downloads nothing;
- for each device that still needs a learning session: OK to run it, with Claude changing the settings in the maker's
  app itself (step 3 of "Adding your own devices"), and roughly how long it needs them nearby;
- sharing each driver that ends up working (step 7);
- closing each maker's app while DeviceHub drives its device.
Then do everything that was answered yes, in one go, saying a line per step. Ask again only for something that was
not covered (a new device, a download nobody named), or when a step fails and there are real options.

1. **Install.** If `http://127.0.0.1:5577/api/version` answers with a `"version"`, DeviceHub is installed and
   running: use `%USERPROFILE%\DeviceHub`. Otherwise run `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\install.ps1`
   from this folder. It is safe in every case: when this folder already is `%USERPROFILE%\DeviceHub` (the person
   unzipped it there) it only sets it up and starts it; over an older install it keeps their settings, profiles and
   backups; and it refuses a development copy (a `.git` whose origin is not `DeviceHub-download`). Do not ask whether
   this download is newer: compare `builtAt` in this folder's `release.json` with the installed one, and reinstall
   only when this one is newer.
   Never run `Install DeviceHub.bat` ( it ends with `pause` and waits for a key, and never `DeviceHub-Setup.exe`: a
   downloaded exe opens Windows' "Windows protected your PC" screen). It copies DeviceHub there, clears Windows'
   downloaded-file mark on the installed copy (so nothing warns when DeviceHub starts), makes shortcuts and starts it. From then on, work on the installed copy: run its scripts and edit its files by full path
   under `%USERPROFILE%\DeviceHub` (this session stays in the downloaded folder; that is fine); every `helpers\...`
   below means `%USERPROFILE%\DeviceHub\helpers\...`. Git is needed only for updates that merge with the PC's own
   changes; if `git --version` fails, mention it in the report as optional and carry on.
2. **Find their devices (read-only).** Start with `node helpers/setup-report.mjs` (the same as `GET /api/setup`):
   DeviceHub has already matched the PC's devices against the device library and installed every matching driver by
   itself (helpers/auto-setup.mjs), each read-only until its settings pass DeviceHub's own self-check (read, write the
   same value, read back) the first time the device connects. A setting the driver refuses only because of the
   device's current mode (an error with `waiting: true`) is recorded as waiting, not failed; failed and waiting
   settings are tried again on a connect once a day and at once after a DeviceHub update (a value that moved only on
   Check again), and the self-check never runs while the maker's app is open. An untested library entry installs on
   the person's click (Set up card > Install) and loads read-only the same way. The learning wizard never learns
   258A (Sinowealth), 22D4 (Laview) or Logitech (046D) ids; for a device with a driver.json driver it adds the learned
   settings to the my-devices copy (backed up first), never to the library.
   **Turn on settings** (22 Oct 2026, docs/handoff/safety-round2.md): a library driver with no real-device record in
   `device.json` `tested` (simulations and test files do not count; every entry shipped today) and every driver the
   wizard made installs and reads by itself, but writes nothing, its self-check included, until the person presses Turn
   on settings on its page or the Set up card; DeviceHub then writes each setting's current value back once. "Could
   not check whether the maker's app is open" counts as waiting. The never list is checked in the HID send path for
   every library and my-devices driver (`helpers/never-guard.mjs`); DeviceHub's own Pulsar, P75 and HS80 paths are not.
   **Works on my device** (docs/handoff/works-reports.md): once a library driver's settings passed their check, its page
   has a button that shows a small record (driver SHA-256, version, model, firmware, settings that passed; nothing
   personal) and opens a GitHub issue labeled `works` on the person's click. `node helpers/accept-works-reports.mjs
   [--apply]` (Shawn's copy) checks each report against the library's current driver and, with --apply, adds a
   `{ status: "tested", real: true, ... }` record to its device.json (never commits, pushes or closes anything). Only
   that exact record, for that exact driver text, counts as real. The Set up card's **Turn on settings for all** does
   Turn on settings for every waiting, connected device, one after another.
   **Request support** (docs/handoff/support-request.md): on a friend's PC it sends Shawn a short request through the
   problem-report relay in one click (labeled `support`; once per device per day, never from the owner's PC); elsewhere
   it opens the GitHub request as before. A receiver on a shared chip id (Sinowealth 258A; Laview, Holtek, Sonix when
   named a receiver) is shown as a generic 2.4G receiver with no settings to learn.
   No library driver installs, self-checks or writes when ANY id it declares is in `helpers/pc-map.js` RUNS, and a
   my-devices driver on such an id is not loaded. Every write of a library or learned driver asks for the maker's app
   first (kept 15 s when none is open); an open app or "could not check" refuses it. Only a record shared with status
   tested counts as a real-device record, and no setting is written before its own self-check passed. The Corsair
   library drivers' bragi channels pass `helpers/bragi-guard.js`; the HS80's own helper path refuses SET 0d / 46 / 47
   and the bragi tag (docs/handoff/final-safety.md).
   The report lists what works now, what is optional and
   what still needs a learning session: do only what it lists. For more detail, these are GET requests to
   `http://127.0.0.1:5577`:
   - `/api/agent/state`: the mouse, headset and keyboard DeviceHub already runs, with each one's model (`info.Model`)
     and status. A wireless device that is `asleep` shows its last reading; it wakes when moved.
   - `/api/pc?fresh=1`: CPU, graphics card, board, RAM, and every USB device (`runs` names the page of one DeviceHub
     already runs; `name` can be empty, then take the model from `/api/agent/state` or BRANDS.md).
   - `/api/monitors`, `/api/cameras`, `/api/eq` (`engine: "eqapo"` = Equalizer APO is installed; `notOn` lists headset
     sound devices it is not switched on for), `/api/openrgb` (PC lights).
   - **What needs no learning at all** (22 Oct 2026): `/api/library` (the shared device library: a driver someone
     else already made for the same USB id; tested and read-only ones are installed by auto setup, any other with
     `POST /api/library/install {name}` or its Install button, then a restart), `/api/std-battery` (any Bluetooth device's battery from Windows, and USB devices that declare the
     standard HID battery fields), `/api/lamparrays` (lights that speak Windows Dynamic Lighting, HID LampArray).
   - What the maker's app left on the PC, read-only: `node helpers/vendor-files.mjs --vid <vid> --summary` (model
     names, product ids, setting names; see "Adding your own devices" step 2).
   For each USB device DeviceHub does **not** already run, look its vendor id up in `docs/BRANDS.md` (and, for Logitech,
   Razer, Corsair, SteelSeries and Turtle Beach/ROCCAT, its sheet in `docs/brands/`: find the model there by product
   id; a model a sheet does not list, or lists as unconfirmed, is identified from its USB name and the `hid-caps`
   output and treated as unconfirmed) and run
   `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\hid-caps.ps1 -Vid <vid>` (read-only). Leave out
   devices that are not a mouse, headset, keyboard or light (Bluetooth adapters, hubs, storage, webcams: the webcam is
   handled through `/api/cameras`); a vendor id not in BRANDS.md is reported as unknown, with its USB name.
3. **Report, in one short list:**
   - what already works with nothing to do: the devices DeviceHub runs, any VIA keyboard, monitors that answer over
     DDC/CI, webcams, and Windows sound (or that Equalizer APO is needed for the EQ, with the Headset page's button);
   - PC lights: USB lights work through the OpenRGB inside DeviceHub; the board, fan and RAM lights `/api/pc` found
     need PawnIO and that OpenRGB as administrator: the person's own click on Add board, fan and RAM lights, only if
     they want them;
   - for each other device, the cheapest way in, in this order: a library driver; a standard (Bluetooth battery,
     LampArray lights, VIA); its brand sheet in `docs/brands/`; an open project in BRANDS.md; and only then a learning
     session, which Claude runs itself in the maker's app (step 3 of "Adding your own devices").
4. **Then build, one device at a time, without waiting to be asked for each** (do not stop between steps), following "Adding your own devices"
   from step 2 (the most popular brand first; a device with a brand sheet before one that has to be learned). A keyboard with VIA needs no
   code: check it shows up with its layout. Ask before any download or install (Equalizer APO, USBPcap, a maker's
   app), and before a learning session (it needs the person at the PC changing settings in the maker's app).
5. **Prove each device** (step 6) and run the checks before saying it works: `npm test`, or on a copy without npm,
   `runtime\node.exe` on each script in package.json's `test` line, in order.

What cannot happen without the person: anything that needs a download or install, and learning a protocol that no
open project documents (they change one setting at a time in the maker's app while you listen).

## "Update DeviceHub" (or Settings > Update said to ask Claude)

A copy installed from the zip is tied to the public download repository (`git remote get-url origin` names
`DeviceHub-download`; its branch `app` has each published version). Settings > Update merges a new version with the
changes made on that PC by itself; it only stops when both changed the same lines, and then names the files. To bring
them together, in `%USERPROFILE%\DeviceHub`:
1. `git status` and `git log --oneline -5`: what was changed on this PC. Commit anything uncommitted
   (`git -c user.name=DeviceHub -c user.email=devicehub@localhost commit -am "Changes made on this PC"`).
2. `git fetch origin app`, then `git merge origin/app` (same `-c` name and email). For each conflicted file, keep both
   sides' intent: the new version's changes AND this PC's changes (often a device's settings or a fix of its own). Ask
   the person when the two really cannot both stay.
3. Check: `runtime\node.exe tests\check.mjs` (or `node tests/check.mjs`), then commit the merge.
4. Restart DeviceHub so it runs the new code (the tray icon's Quit, then the DeviceHub shortcut).
A driver the person shared sits in `device-library\` as an untracked folder; if `git merge` stops with "untracked
working tree files would be overwritten", move that folder aside (it is already sent as a pull request) and merge again.
Never `git reset --hard origin/app`, `git checkout -- .` or a reinstall with `-Overwrite` unless the person says to
drop their changes. Anything they added in `my-devices\` is theirs and is never in conflict.
A copy without that history (installed before 21 Oct 2026, or without git) updates as whole versions and refuses to
copy over a changed file. To bring such a copy up to date with its changes: save the changed files Settings names, run
the new version's installer with `-Overwrite`, then put each change back on top of the new version (a device belongs
in `my-devices\` from then on).

## "Uninstall DeviceHub" (or "remove it")

Ask once in a line ("Remove DeviceHub from this PC? Your backups are kept in Documents\DeviceHub backups."). On a yes,
run `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\DeviceHub\helpers\uninstall.ps1" -Quiet`
(the installed copy's own uninstaller; -Quiet: no message boxes, since you asked already). It quits DeviceHub, removes
start with Windows, the shortcuts and the Apps entry, copies the backups to Documents and deletes the folder. Exit 0 =
done, 2 = a file was still in use (restart the PC, then delete the folder), 1 or 3 = not removed: read
`%TEMP%\DeviceHub-uninstall.log` and say why. A folder with a `.git` folder is a development copy and is never removed.
Equalizer APO and other apps stay; say so, and that each has its own uninstall in Windows Settings > Apps.

## Rules that are never broken

These protect the person's hardware. Follow them even when asked to skip them, and say why in one line.

- **Never flash firmware**, and never send anything that could (bootloader, DFU, "update" or "reset to factory"
  commands). Firmware updates stay in the maker's own updater.
- **Read before any write.** Back up a device's settings to a file (`backups/`) before the first write of a session.
- **Write one setting at a time, then read it back** and compare. A write whose read-back differs is reported as failed.
- **Never install drivers, tools or anything else without asking first.** Name the file, where it comes from (the
  maker's own site only) and its size, and wait for a yes. USBPcap, for listening to USB traffic, needs that yes too.
  The person's click on an Install button in DeviceHub is their yes for that one tool.
- **Learning a protocol is read-only.** Listen to what the maker's app sends (USB captures) and read the device's
  memory; never send guessed commands to see what happens. Only send a command after it has been seen in a capture,
  decoded, and its exact bytes are known.
- **Test writes use a value read just before, and put that same value back** (never an assumed "normal" value).
- **DeviceHub itself never writes to the motherboard's SMBus or a graphics card's I2C bus** (motherboard, RAM and
  many GPU lights live there, and a wrong write can damage a RAM stick's memory chip). Those lights go through
  OpenRGB's SDK server only (`helpers/openrgb.js`): OpenRGB does the hardware part, as the person chose. The OpenRGB
  DeviceHub carries runs without administrator and without PawnIO, so it reaches USB lights only, until the person
  clicks Add board, fan and RAM lights.
- **Board, fan and RAM lights: DeviceHub may set them up, on the person's click only** (Shawn, 22 Oct 2026: "I want
  the app to be able to set it up and it currently cant"; `helpers/board-lights.mjs`, docs/handoff/board-lights.md).
  That click may (a) install the official signed PawnIO driver (2.2.0 from github.com/namazso/PawnIO.Setup, run
  only when signed by namazso AND matching its published SHA-256, through its own installer and Windows' prompt;
  skipped when already installed) and (b) behind ONE Windows admin prompt copy the bundled OpenRGB with its PawnIO
  modules into C:\Program Files\DeviceHub board lights\ (hash-checked there) and register the logon task
  "DeviceHub board lights" that runs it as administrator with its SDK server on 127.0.0.1:6742. Never at DeviceHub's
  start, never automatic, never by Claude for the person; every step is undone on failure; Remove board lights deletes
  the task and the copy (PawnIO stays; Windows Settings > Apps removes it).
- **OpenRGB 1.1 and Equalizer APO 1.4.2 ship inside DeviceHub** by Shawn's decision of 22 Oct 2026
  (`helpers/bundled-tools.json`, pinned by SHA-256; OpenRGB's user-mode PawnIOLib.dll is kept so it starts, and its six
  PawnIO modules are kept only in tools/openrgb/board-modules/, used only in board-lights mode, never beside the
  USB-only OpenRGB.exe). DeviceHub starts OpenRGB only while lights are used and runs Equalizer APO's installer only on
  the person's click. Never bundle a driver (.sys), the PawnIO driver, WinRing0 or inpout; LibreHardwareMonitor still
  needs the person's OK.
- Nothing personal goes into git or the installer: `backups/`, `settings.json`, `profiles.json`, `eq-presets.json`,
  logs, history and recordings are in `.gitignore`. Check before adding a new data file.
- Every change ends with `npm test` passing (see Checks).

## Map

```
server.js                  local server on 127.0.0.1:5577 (never on the network): API, static files, starts the agent
helpers/agent.mjs          the background agent: owns the devices, registers the three adapters, auto-switch, wake
helpers/hid-host.mjs       SPECS: each HID device's vendor id, product id, usage page, report length (one line each)
helpers/native/            the Windows helper (C#, built on start with Windows' own compiler): HID, audio, tray,
                           monitors (helpers/monitors.cs), mic recording; helpers/native.js talks to it. The
                           installer ships it ready-built with helpers/bin/helper-sources.sha256; an installed copy
                           compiles only when its sources no longer match that hash, a development copy (no hash
                           file) rebuilds when a source is newer (helpers/helper-sources.js)
public/devices/            the drivers: one adapter per device slot (mouse-adapter.js, headset-adapter.js,
                           keyboard-adapter.js) over a protocol file (pulsar.js, via.js, the HS80 code in helpers/)
public/pages/              one page per sidebar entry (mouse.js, headset.js, keyboard.js, ...)
public/ui/art.js, img/     the device drawings and product photos (the Realistic look)
public/devices/demo.js     pretend devices for demo mode
public/core/brands.js      the brand guide (made from docs/brands.json by helpers/make-brands.mjs; docs/BRANDS.md)
helpers/fetch-bundled.mjs   the bundled tools for the zip (helpers/bundled-tools.json), pinned by SHA-256
helpers/setup-extras.js    the setup file's extras (headset names, background picture, my-devices drivers, wallpapers)
helpers/onedrive-setup.mjs the opt-in OneDrive copy of this PC's setup, and the other PCs' copies (Overview offer)
helpers/get-help.mjs      Get help: a short report, personal data taken out, a pre-filled GitHub issue opened on click
helpers/auto-report.mjs   problem reports that send themselves from other PCs to the relay (never from the owner's PC)
helpers/learn-apps.mjs     Learn without typing: the maker's app (installed, running), the tick-list (app files > brand sheet > usual list)
helpers/learn-wizard.mjs   Learn a device: USB recordings -> driver.json (settings, readings, a second USB id), read-only toward the device (public/pages/learn.js)
helpers/declarative-driver.mjs   driver.json drivers (docs/DRIVER-FORMAT.md): checked, then run with the device.mjs contract
helpers/supported-devices.mjs   Supported devices: the plain-words list (public/pages/supported.js; Settings > DeviceHub > Show, Search)
device-library/            shared drivers by USB id (README.md); helpers/device-library.mjs finds and installs them,
                           helpers/share-device.mjs makes one from a working my-devices driver (refuses personal files)
helpers/vendor-files.mjs   what makers' apps left on the PC (model names, ids, setting names), read-only
helpers/std-battery.js     batteries Windows already knows (Bluetooth) and the standard HID battery fields, read-only
helpers/lamparray.mjs      Windows Dynamic Lighting / HID LampArray: finder (read-only), attributes, one color, hand back
helpers/app-ui.ps1         Windows UI Automation on a maker's app: list, get, set, click (refuses firmware/reset/update)
docs/brands/, TOP-BRANDS.md  per-brand mapping sheets (ids, protocol, settings map, safe reads, build plan)
helpers/pc-map.js          This PC, read-only: CPU, graphics card, board, RAM, USB devices (Lighting page)
helpers/openrgb.js         PC lights through OpenRGB's SDK server (127.0.0.1:6742), backed up and read back
helpers/board-lights.mjs   Add board, fan and RAM lights / Remove board lights: PawnIO + the elevated OpenRGB task, on a click
helpers/camera.cs, .js     webcam picture settings (DirectShow's standard controls), backed up, one at a time, read back
helpers/gpu.js             the graphics card's temperature, fans, load, power (NVIDIA's nvidia-smi), read-only: the Fans page
docs/FANS.md               BIOS fan curve settings; DeviceHub never writes to the board's fan chip (it would need a kernel driver)
tests/                     npm test: offline checks, then every page opened live and in demo
```

## Adding your own devices

DeviceHub has three built-in device slots: `mouse`, `headset` and `keyboard`. Someone else's device goes in
`my-devices\` beside them (those three ids are reserved) and gets its page, tile and sidebar entry by itself; a
built-in device that is not plugged in simply shows nothing. Work through these steps with the
person, one device at a time. Say in a line what each step found and go straight on; stop only where a step needs
the person (a download or install, a learning session, or a check in the maker's app).

1. **Find out what is plugged in (read-only).** List the HID devices and their collections:
   `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\hid-caps.ps1 -Vid <vendor id>` (the vendor id is in `/api/pc?fresh=1`'s USB list). Write down vendor id, product id, the vendor usage page (0xFF..) and report
   lengths. Note the exact model and whether it has a dongle and a cable (often two product ids).
2. **Look for a known protocol before learning anything.**
   - **The library first:** `/api/library` (`helpers/device-library.mjs`). A matching "tested" entry is installed
     and needs no learning; a "read-only" or "untested" one is the starting point, proven per step 6 before its writes
     are used.
   - **Then what the maker's app already left on the PC (read-only):** `node helpers/vendor-files.mjs --vid <vid>
     --summary` reads the app's own JSON/XML/INI/SQLite/asar files in place (runs nothing, writes nothing): the product
     ids and model names it knows, each model's saved setting names and values, and any ranges or command bytes it
     keeps as plain text (rare: most apps keep the protocol compiled). Use it to name the model and the settings to
     look for; check every id with a read, and treat command bytes from it as unconfirmed until seen in a capture.
     Where each app keeps what: `docs/handoff/vendor-files.md`.
   - **Standards need no learning:** a battery Windows already knows (Bluetooth, or the standard HID battery fields:
     `helpers/std-battery.js`, `/api/std-battery`; a my-devices driver's `battery()` can take its level from
     `read()`, matched by vid/pid) and **Windows Dynamic Lighting (HID LampArray, usage page 0x59)**:
     `helpers/lamparray.mjs` finds them read-only (`findLampArrays()`, `/api/lamparrays`), reads their attributes and
     lamps from the device's own descriptor, sets one color and hands control back (AutonomousMode). Turn off Windows'
     Dynamic Lighting for that device first. Lamp colors cannot be read back (the standard has no way); read the
     attributes before and after instead.
   Then the brand's **mapping sheet** if it has one
   (`docs/brands/`: logitech, razer, corsair, steelseries, turtle-beach, hyperx, asus-rog, glorious, keychron,
   wooting, cooler-master; overview in
   `docs/TOP-BRANDS.md`): its models with USB ids, how they talk, a settings map with every id cited to its source, the
   safe reads, the risky writes to never send, and a build plan to follow in its order. Anything a sheet marks
   unconfirmed is checked on the device with a read before it is used, never assumed. Then `docs/BRANDS.md`: the 10 most popular brands
   per device type with their USB vendor ids, how they talk, which open projects know them and how risky writes are
   (the Lighting page's "This PC" card names any plugged-in device from it).
   - Keyboards with **VIA** work with no code: DeviceHub finds any VIA keyboard (usage page 0xFF60) and takes its
     layout from VIA's library (usevia.app, about 1,500 keyboards) or from the maker's VIA file placed in
     `via-definitions\<VID><PID>.json` (helpers/via-defs.js, public/devices/via-layout.js). `server.log` says which
     keyboard it found and where its layout came from (`[keyboard] ...`). If editing is blocked ("does not match the
     layout"), the definition is for another revision of the board: get the maker's file. QMK boards without VIA
     need VIA enabled in their firmware, which is the owner's call (never flash it for them).
     A board VIA's library lacks (Keychron Pro, Max, HE, 8K; Lemokey) has a **Get the layout** button on the Keyboard
     page: it gets Keychron's official file (helpers/via-sources.json, pinned commits), checks it is for that vid/pid and
     drawable, saves it, then DeviceHub needs a restart (docs/handoff/via-fetch.md).
   - **Corsair**: `docs/brands/corsair.md`. Most current headsets, mice and keyboards speak the HS80's property
     protocol (Bragi, `helpers/hs80-direct.js`); the sheet says what differs per model. The iCUE SDK (npm `cue-sdk`)
     covers many settings while iCUE runs.
   - **Logitech** (HID++ 2.0), **Razer** (the 90-byte report), **SteelSeries**, **Turtle Beach/ROCCAT**: their sheets
     in `docs/brands/`, drawn from Solaar, libratbag, OpenRazer, rivalcfg, HeadsetControl and OpenRGB. Use the
     documented facts; do not copy their code.
   - Mice like the Pulsar: OpenMouse and Linux driver patches document some. If nothing is documented, go to step 3.
   - **Before driving a device, close its maker's app** (G HUB, Synapse, GG, iCUE, Swarm II) and say so in a line:
     two programs writing the same device fight. It stays installed for firmware updates and learning sessions.
   - **Settings kept on the device** (Logitech onboard profiles and the like): DeviceHub changes the live settings;
     say once in a line that the maker's app may show them as changed. Never write onboard profile memory itself (the
     sheets mark it high risk).
   - **Feature reports** (Razer, many SteelSeries keyboards, ROCCAT, Glorious, Wooting, LampArray): `sendFeatureReport(id,
     data)` / `receiveFeatureReport(id, length)` on `HostDevice` (`helpers/hid-host.mjs`, the helper's `FSET` / `FGET`
     over `HidD_SetFeature` / `HidD_GetFeature`, 22 Oct 2026), used from the device's `my-devices` driver. Untried on
     a real device yet: check the first one with a read before any write.
   - **Input reports on request and a second collection** (22 Oct 2026, docs/handoff/hid-input-reports.md):
     `getInputReport(id, length)` on a channel with `hid.inputReports` (the helper's IGET, HidD_GetInputReport; Turtle
     Beach), and `hid.extra: [{ name, page, usage, ... }]` with `extraChannel(name)`, a listen-only second collection
     (Wooting key depth). Nothing can be sent on an extra channel.
3. **The person can do this without Claude**: Learn a device, in the sidebar under App (also Overview > Set up >
   Learn a device, and Lighting > This PC > Learn it, which picks that device) listens while they change one setting at a time in the maker's app, and saves a read-only
   `my-devices\<name>\driver.json` (docs/handoff/learn-wizard.md). It also learns readings (battery, charging,
   ChatMix, a sensor), from a read and its reply or from a report the device sends by itself, and, after a save, the same
   device on its other USB id (cable and receiver), added to the same driver (docs/handoff/learn-readings.md). A
   driver.json may hear reports the device sends by itself (`notice` reads: display and battery only, never a written
   setting) and hold one product id's own bytes (`byPid`): docs/DRIVER-FORMAT.md. It names the maker's app (installed or
   not, open or not) and offers the settings as a tick-list from the app's own files, the brand sheet or the usual list;
   with the app open it changes each ticked setting there itself through app-ui (that one control only, then puts the
   value back), else it says in one line what to change (docs/handoff/learn-no-typing.md). Claude follows the steps below for what the
   wizard refuses.
   Windows' own USB tracing (ETW, logman, pktmon, netsh trace) records no payload bytes on Windows 11 xHCI PCs, so
   USBPcap stays the only way to listen (docs/handoff/learn-builtin-capture.md, checked 22 Oct 2026).
   **Learn it by listening (read-only, needs the person's yes for USBPcap).** With USBPcap installed:
   `helpers/usb-find.ps1` finds the device's capture number, `helpers/hs80-learn.ps1 -Match '<USB name>'` records while
   the person changes ONE setting in the maker's app, `node helpers/pcap-read.mjs <capture>` prints the messages.
   Change one setting at a time, from one known value to another, and write down which bytes moved.
   **Claude changes the setting itself** (22 Oct 2026): at the start of the session ask once, "I'll change the
   settings in <maker's app> myself, one at a time, while it records: OK?" With that yes, open the app (or ask the
   person to), then `powershell -NoProfile -ExecutionPolicy Bypass -File helpers\app-ui.ps1 list -Window '<app>'`
   to find each setting. For each one: start `hs80-learn.ps1 -Name <setting>-<from>-<to>`, wait 3 s, run
   `app-ui.ps1 set -Window '<app>' -Name '<setting>' -Value <to>` (or `click` for an Apply/Save button the app needs),
   wait for the recording to end, then put the old value back the same way, so the device ends as it started. Write
   down app-ui's `old -> new (read back ...)` line beside the capture. app-ui refuses anything named firmware, update,
   reset, factory, flash, bootloader, delete or format, and never presses them. If `list` exits 3 (the app shows UI
   Automation nothing; common with Electron apps), a `set` exits 1 (an ARIA slider ignored the value; `-UseKeys` may
   move it), or a setting is not in the list, fall back to asking the person to change that one setting. Never turn on
   a screen reader, change a Windows setting or restart the maker's app with extra flags to make it visible without
   asking. Details: docs/handoff/app-ui.md. For devices with a
   readable settings memory, a read-and-compare tool like `helpers/mouse-learn.mjs` (read-only) shows which bytes a
   setting lives in. Record every finding (bytes, values, what the app showed) in the protocol file's comments.
4. **Prefer a `driver.json` for a new device** (docs/DRIVER-FORMAT.md, 22 Oct 2026): a description DeviceHub checks
   for safety before using it, no code. Write a `device.mjs` only when the format says it cannot express the device.
   **Write the driver in its own folder: `my-devices\<name>\device.mjs`** (21 Oct 2026). Copy `my-devices\_example\`
   (a working pretend device, with the shape explained at its top) to a folder without the `_`. Everything the device
   needs lives in that folder: the protocol, the adapter (`id`, `title`, `kind`, `connect()`, `info()`, `read()`,
   `write(key, value)` with read-back, `battery()`, `rawBackup()`, `unsupported`), its HID channel (`hid: { vid, pid,
   page, usage, len, reportId }`) and `settings`, the list its page is drawn from (slider, toggle, choice, display for a reading, color, remap; see helpers/my-devices.mjs). DeviceHub
   loads it at start (`helpers/my-devices.mjs`; `server.log` says `[my-devices] <name>: ... added`, or why not) and
   gives it a page, a tile and Undo by itself. **Do not edit DeviceHub's own files for a device**: files under
   `my-devices\` belong to that PC and no update ever changes them, while edits to DeviceHub's files have to be brought
   together with every new version. Only add settings whose bytes were seen in step 3 or are documented.
   **What the rest of DeviceHub picks up by itself:** `battery()` returning `{ percent, charging }` gives the battery
   (and Charging) on the device's tile and page. A device that can only tell charging from its voltage does it the way
   `chargerLifted` in `public/devices/headset-adapter.js` does for the HS80 on a wall charger. It also gives the device its battery history graph and time left
   (`helpers/battery-history.js`, rows keyed by its id) and the Live look's liquid on its tile (`public/ui/live-art.js`).
   Low-battery saving and lights off while charging (`helpers/battery-care.mjs`) change an added device only when its
   driver declares `batteryCare: { lowBattery: { key, value }, charging: { key, value } }`, the write is allowed now,
   the maker's app is closed and a backup succeeds first (docs/handoff/battery-added-devices.md). An
   added device gets a plain drawing on its tile; the photos and detailed drawings are only for the three originals.
   Profiles (and auto-switch) save and apply an added device's settings (`profile.added`; `helpers/profile-added.mjs`):
   readings are never saved; a setting is applied only when its driver allows the write now and the maker's app is
   closed, backup first, one at a time, read back; anything skipped goes in one Activity line.
5. **Show it.** Its page is drawn from `settings`: give each a clear label, a `unit`, a `hint` where it helps, and
   `live: true` on a slider that is quick and harmless to send often (a brightness). Restart DeviceHub to load it.
6. **Prove it.** Read everything and compare with the maker's app (ask the person once to open it and confirm the
   values you list, then close it again). Then one write per setting: read the current value,
   write a different valid value, read back, put the original back, read back. `node helpers/soak-test.mjs 1` writes
   every setting with its own value. Then `npm test`.
7. **Share it, so the next person needs no learning.** When it works, offer once: "Share this driver so others with
   the same <model> get it without any setup?" On a yes, `node helpers/share-device.mjs <my-devices folder> --status
   tested --by <a name they choose>`. It refuses anything personal (backups, captures, logs, serial numbers, user
   names) and lists what it refused; the person opens the pull request it describes themselves.

**Headset sound** works for **any USB headset** with nothing to add (20 Oct 2026): with no HS80, the headset slot runs
the first USB headset Windows has (a USB device with a headphones or headset output and a mic: `usb-headsets` in
`helpers/audio-default.cs`) in a sound-only mode: volume, mutes, mic level, sidetone when Windows names a "Sidetone"
control, and through Equalizer APO its EQ, mic boost and mic filters (`helpers/eqapo.js`, `eqDevices` in server.js).
Only its lights, battery and own settings need its protocol. "Natural sound" is AutoEQ's correction measured for the
HS80 (`HS80_CORRECTION`) and is offered and applied for an HS80 only; for another model add its numbers from AutoEq
(github.com/jaakkopasanen/AutoEq). `DEVICEHUB_HEADSET_GENERIC=1` makes DeviceHub treat the HS80 as an unknown headset,
to test the sound-only mode on real hardware. **Monitors** work through DDC/CI for most monitors as they
are, and any webcam's picture settings (Monitors page) through Windows' standard camera controls; `KNOWN` in `helpers/monitors.js` only gives the two original monitors friendly names.

## PC lights

Motherboard, RAM, graphics card and case lights are reached through OpenRGB (openrgb.org) when the person runs it with
its SDK server on; DeviceHub reads its controllers, backs them up, sets one color with a read-back and can put them
back (Lighting > PC lights). Use OpenRGB 1.1 or newer (1.0 mixed up device numbers for clients on protocol
versions below 6, which DeviceHub uses). On Windows, motherboard and RAM lights also need PawnIO (pawnio.eu, a signed
kernel driver) with OpenRGB run as administrator (OpenRGB has no Windows service): the person's own decision, never
done for them without their click. **Add board, fan and RAM lights** (Lighting > PC lights, the Fans page's Fan lights,
and a Setup row when lights-diagnose says "smbus"; `helpers/board-lights.mjs`, 22 Oct 2026) is that click: PawnIO
2.2.0's official installer when it is missing (signed by namazso AND its published SHA-256), then one Windows admin
prompt copies the bundled OpenRGB 1.1 with its six PawnIO modules into C:\Program Files\DeviceHub board lights\OpenRGB\
(every file hash-checked there) and makes the logon task "DeviceHub board lights" (highest rights, SDK server on
127.0.0.1:6742). DeviceHub then uses it like a person's own OpenRGB and runs that task (no prompt) when lights are used
and it is not answering; **Remove board lights** deletes the task and the copy. DeviceHub refuses colours and Put back through an OpenRGB built before 1.1 (it reads the build
stamp in OpenRGB.exe). Windows Dynamic Lighting devices are counted on This PC; control stays in Windows Settings
(a background controller must be a packaged app), or, with Windows' Dynamic Lighting turned off for it, DeviceHub
through `helpers/lamparray.mjs`. `node tests/openrgb-mock.mjs` tests the OpenRGB client against a
stand-in server written from OpenRGB's protocol document.

## Checks

- `npm test`: every script parses, no stray control characters, JSON valid, then every page opened live and in demo
  without a script error (the page part needs DeviceHub running). `npm run test:offline` is the first part only.
- The new building blocks' tests run in `npm test` (device-library, lamparray, std-battery, vendor-files).
  `powershell -NoProfile -ExecutionPolicy Bypass -File tests\app-ui.ps1` is optional (about 25 s; it opens a small
  test window on the second screen).
- `node helpers/soak-test.mjs [rounds]`: every writable setting written with the value it already has, read back.
- Settings > Self-test inside the app, and Settings > Health.
- Someone without Claude presses **Get help** (top right of each device page, Monitors, Fans, Learn a device,
  Profiles, Backups, Wallpapers; the Equalizer card; each Setup row that needs them; Lighting's PC lights card;
  Settings > Get help): helpers/get-help.mjs builds a short report about that screen with anything personal taken out;
  on a friend's PC Send to Shawn files it through the relay (label `support`, once per screen per hour), on this PC it
  opens a filled-in GitHub issue (docs/handoff/get-help-everywhere.md). **Find my lights** (Lighting > PC lights)
  names a board's zones by giving each its own color (docs/handoff/find-lights.md).
- **When a device does not work, call `GET http://127.0.0.1:5577/api/diagnose?id=<device>` first** (or
  `node helpers/diagnose.mjs <device>`): it names the likeliest cause, the fix, and what it already checked
  (docs/handoff/diagnose.md). The same answer shows on the device's page, with a fix button.

## Problem reports from other PCs

When DeviceHub hits a real fault on someone else's PC (a crash and restart, the helper not building or starting or
restarting over and over, a plugged-in device in an error for over 10 minutes, a write that failed its read-back, a
library or learned driver whose self-check failed), helpers/auto-report.mjs sends Get help's stripped report by itself
through the relay (relay/, see relay/README.md). It never sends from this PC (origin Dsmjr2/DeviceHub, or settings.json
"ownerPc": true), and the person can switch it off in Settings (docs/handoff/auto-report.md).

- They arrive as issues in Dsmjr2/DeviceHub-support, labeled `problem`: `gh issue list -R Dsmjr2/DeviceHub-support --label problem`,
  then `gh issue view <n> -R Dsmjr2/DeviceHub-support`. The fingerprint at the bottom is `<code>:<device>`; the install id
  tells one PC's reports apart (never its name).
- Fix it here, then reply on the issue and close it (`gh issue comment <n> ...`, `gh issue close <n> ...`).

## Running it

`DeviceHub.vbs` starts it (the keep-running loop `helpers/keep-running.bat` restarts it after a crash) and opens the
window; `DeviceHub.vbs /background` starts it in the tray only. `node server.js` runs it in a console for development.
Only one DeviceHub talks to the devices at a time; quit it before running a learning tool that opens a device.
