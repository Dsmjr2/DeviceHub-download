# DeviceHub: notes for Claude Code

DeviceHub is a local Windows app that replaces the vendor apps for one mouse, one headset and one keyboard, plus
Windows sound (Equalizer APO) and monitors (DDC/CI). It was built for a Pulsar X-Lite CrazyLight, a Corsair HS80 and an
Epomaker P75. Someone with other devices adds their own by following "Adding your own devices" below.

## "Set this up" (or any request like it, on a new PC)

The person may only say "set this up", "install this" or "make it work with my stuff". Do all of this without being
asked for each part; stop only where a step below says to ask. Say in a line or two what you are doing as you go.

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
2. **Find their devices (read-only).** All of these are GET requests to `http://127.0.0.1:5577`:
   - `/api/agent/state`: the mouse, headset and keyboard DeviceHub already runs, with each one's model (`info.Model`)
     and status. A wireless device that is `asleep` shows its last reading; it wakes when moved.
   - `/api/pc?fresh=1`: CPU, graphics card, board, RAM, and every USB device (`runs` names the page of one DeviceHub
     already runs; `name` can be empty, then take the model from `/api/agent/state` or BRANDS.md).
   - `/api/monitors`, `/api/cameras`, `/api/eq` (`engine: "eqapo"` = Equalizer APO is installed; `notOn` lists headset
     sound devices it is not switched on for), `/api/openrgb` (PC lights).
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
   - PC lights: the board, graphics card and RAM `/api/pc` found, and that their lights go through OpenRGB 1.1 or newer
     with its SDK server on (motherboard and RAM also need PawnIO), only if the person wants them;
   - for each other device: whether its protocol is known (its brand sheet in `docs/brands/` maps it, or an open
     project in BRANDS.md knows it) or needs a learning session, and what that needs from them.
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
- **Learning a protocol is read-only.** Listen to what the maker's app sends (USB captures) and read the device's
  memory; never send guessed commands to see what happens. Only send a command after it has been seen in a capture,
  decoded, and its exact bytes are known.
- **Test writes use a value read just before, and put that same value back** (never an assumed "normal" value).
- **Never write to the motherboard's SMBus or a graphics card's I2C bus** (motherboard, RAM and many GPU lights live
  there, and a wrong write can damage a RAM stick's memory chip). Those lights go through OpenRGB's SDK server only
  (`helpers/openrgb.js`); DeviceHub never installs OpenRGB or its SMBus driver.
- Nothing personal goes into git or the installer: `backups/`, `settings.json`, `profiles.json`, `eq-presets.json`,
  logs, history and recordings are in `.gitignore`. Check before adding a new data file.
- Every change ends with `npm test` passing (see Checks).

## Map

```
server.js                  local server on 127.0.0.1:5577 (never on the network): API, static files, starts the agent
helpers/agent.mjs          the background agent: owns the devices, registers the three adapters, auto-switch, wake
helpers/hid-host.mjs       SPECS: each HID device's vendor id, product id, usage page, report length (one line each)
helpers/native/            the Windows helper (C#, built on start with Windows' own compiler): HID, audio, tray,
                           monitors (helpers/monitors.cs), mic recording; helpers/native.js talks to it
public/devices/            the drivers: one adapter per device slot (mouse-adapter.js, headset-adapter.js,
                           keyboard-adapter.js) over a protocol file (pulsar.js, via.js, the HS80 code in helpers/)
public/pages/              one page per sidebar entry (mouse.js, headset.js, keyboard.js, ...)
public/ui/art.js, img/     the device drawings and product photos (the Realistic look)
public/devices/demo.js     pretend devices for demo mode
public/core/brands.js      the brand guide (made from docs/brands.json by helpers/make-brands.mjs; docs/BRANDS.md)
helpers/pc-map.js          This PC, read-only: CPU, graphics card, board, RAM, USB devices (Lighting page)
helpers/openrgb.js         PC lights through OpenRGB's SDK server (127.0.0.1:6742), backed up and read back
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
2. **Look for a known protocol before learning anything.** First the brand's **mapping sheet** if it has one
   (`docs/brands/logitech.md`, `razer.md`, `corsair.md`, `steelseries.md`, `turtle-beach.md`; overview in
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
   - **Feature reports:** Razer, many SteelSeries keyboards and ROCCAT devices talk through HID *feature* reports.
     DeviceHub's HID layer sends output reports only (`sendReport` in `helpers/hid-host.mjs`, the native helper's
     `REQ`). This is the one core change a new device may need, and it is allowed: add `sendFeatureReport(id, data)`
     and `receiveFeatureReport(id)` to `HostDevice` in `helpers/hid-host.mjs`, backed by two native helper commands
     over `HidD_SetFeature` / `HidD_GetFeature` (hid.dll) beside `REQ`, then use them from the device's `my-devices`
     driver. Everything else of the device stays in `my-devices\`.
3. **Learn it by listening (read-only, needs the person's yes for USBPcap).** With USBPcap installed:
   `helpers/usb-find.ps1` finds the device's capture number, `helpers/hs80-learn.ps1 -Match '<USB name>'` records while
   the person changes ONE setting in the maker's app, `node helpers/pcap-read.mjs <capture>` prints the messages.
   Change one setting at a time, from one known value to another, and write down which bytes moved. For devices with a
   readable settings memory, a read-and-compare tool like `helpers/mouse-learn.mjs` (read-only) shows which bytes a
   setting lives in. Record every finding (bytes, values, what the app showed) in the protocol file's comments.
4. **Write the driver in its own folder: `my-devices\<name>\device.mjs`** (21 Oct 2026). Copy `my-devices\_example\`
   (a working pretend device, with the shape explained at its top) to a folder without the `_`. Everything the device
   needs lives in that folder: the protocol, the adapter (`id`, `title`, `kind`, `connect()`, `info()`, `read()`,
   `write(key, value)` with read-back, `battery()`, `rawBackup()`, `unsupported`), its HID channel (`hid: { vid, pid,
   page, usage, len, reportId }`) and `settings`, the list its page is drawn from (slider, toggle or choice). DeviceHub
   loads it at start (`helpers/my-devices.mjs`; `server.log` says `[my-devices] <name>: ... added`, or why not) and
   gives it a page, a tile and Undo by itself. **Do not edit DeviceHub's own files for a device**: files under
   `my-devices\` belong to that PC and no update ever changes them, while edits to DeviceHub's files have to be brought
   together with every new version. Only add settings whose bytes were seen in step 3 or are documented.
   **What the rest of DeviceHub picks up by itself:** `battery()` returning `{ percent, charging }` gives the battery
   (and Charging) on the device's tile and page. A device that can only tell charging from its voltage does it the way
   `chargerLifted` in `public/devices/headset-adapter.js` does for the HS80 on a wall charger. The battery history graph,
   low-battery saving (`helpers/battery-care.mjs`), the lights-off-while-charging rule and the Live battery look's
   liquid are written for the `mouse` and `headset` slots only (lists of those two ids in `helpers/battery-history.js`,
   `helpers/battery-care.mjs` and `public/ui/live-art.js`); a device added in `my-devices` does not get them yet. An
   added device gets a plain drawing on its tile; the photos and detailed drawings are only for the three originals.
5. **Show it.** Its page is drawn from `settings`: give each a clear label, a `unit`, a `hint` where it helps, and
   `live: true` on a slider that is quick and harmless to send often (a brightness). Restart DeviceHub to load it.
6. **Prove it.** Read everything and compare with the maker's app (ask the person once to open it and confirm the
   values you list, then close it again). Then one write per setting: read the current value,
   write a different valid value, read back, put the original back, read back. `node helpers/soak-test.mjs 1` writes
   every setting with its own value. Then `npm test`.

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
kernel driver) with OpenRGB run as administrator or as its background service: the person's own decision, never
installed for them. Windows Dynamic Lighting devices are counted on This PC; control stays in Windows Settings
(a background controller must be a packaged app). `node tests/openrgb-mock.mjs` tests the OpenRGB client against a
stand-in server written from OpenRGB's protocol document.

## Checks

- `npm test`: every script parses, no stray control characters, JSON valid, then every page opened live and in demo
  without a script error (the page part needs DeviceHub running). `npm run test:offline` is the first part only.
- `node helpers/soak-test.mjs [rounds]`: every writable setting written with the value it already has, read back.
- Settings > Self-test inside the app, and Settings > Health.

## Running it

`DeviceHub.vbs` starts it (the keep-running loop `helpers/keep-running.bat` restarts it after a crash) and opens the
window; `DeviceHub.vbs /background` starts it in the tray only. `node server.js` runs it in a console for development.
Only one DeviceHub talks to the devices at a time; quit it before running a learning tool that opens a device.
