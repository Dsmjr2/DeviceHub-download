# Reading the maker's app files before listening to USB (22 Oct 2026)

`helpers/vendor-files.mjs` reads what a maker's app that is already installed (or has left its data behind) says about
a device: its device list, USB product ids, model names, setting names and ranges, and command bytes when they are
stored as plain text. It is the step before a learning session: often it gives the product ids and every setting name
for free, and it tells you which settings exist before you listen for their bytes.

```
node helpers/vendor-files.mjs                # JSON report on stdout, short summary on stderr
node helpers/vendor-files.mjs --vid 046D     # only apps serving that vendor, only that vendor's ids
node helpers/vendor-files.mjs --summary      # summary only (or --json for the JSON only)
node tests/vendor-files.mjs                  # offline test on sample files in %TEMP%: "... all good"
```

## What it does, and never does

- **Read-only, in place.** It never runs a maker's app, never loads its DLLs, never decompiles or disassembles a
  binary, never writes, moves or copies a file out of a maker's folder, and does not follow links out of them. Only a
  summary is printed. Executables, DLLs, drivers, images, logs and archives other than `.asar` are counted, not opened.
- **SQLite** (G HUB, SteelSeries) is opened with `immutable=1` and read-only through Node's built-in `node:sqlite`
  (Node 22.5+; DeviceHub's Node is 24): no lock, no `-wal`/`-shm` written beside it (the test checks this). Cost:
  it does not see changes still sitting in a running app's write-ahead log. Every table is listed with its row count
  (up to 40 tables, 500 rows each are looked at); text and blob values holding JSON are walked like JSON files.
- **Electron `.asar`** (Synapse 4, the Epomaker driver, Wootility, probably Pulsar's app) is read through its own JSON
  index and individual entries are read by offset. Nothing is unpacked. Only `.json/.js/.xml/.ini` entries outside
  `node_modules` are read; JavaScript is only searched for USB id literals (`vid: 0x342d, pid: 0xe479`), never run.
- **Limits:** files over 50 MB are skipped and listed; each app stops after 2,000 files (`stoppedAtLimit: true`).
  Chromium caches, crash dumps, LevelDB stores (`Local Storage`, `IndexedDB`), iCUE's `GameSDKEffects` (2.3 GB of
  game lighting on this PC) and iCUE's temp copies (`config.cuecfg.AbCdEf`) are skipped.
- **Nothing personal in the output.** Paths are shown as `%LOCALAPPDATA%\...`. From iCUE's `config.cuecfg` only the
  `Devices` map is read; its user id, machine id and device instance GUIDs are never printed (shown as
  `(id, not shown)`).
- **What it extracts** from JSON, XML (attributes and `<value name="X">`), INI sections, SQLite JSON values and asar
  entries:
  - `devices`: `{ vid, pid, name, type, source }` from any object with a product id key (`pid`, `usb-pid`, `productId`,
    `idProduct`, `pids`), the vendor id and name taken from the object or its parent; plus `VID_xxxx&PID_xxxx` text
    (Windows device paths in logs and configs). Decimal ids (iCUE writes 6940 for 1B1C) are told from hex text.
  - `settings`: `{ name, min, max, step, default, device }` from any object with a numeric min and max.
  - `commands`: `{ name, key, bytes, device }` from keys such as `command`, `cmd`, `report`, `packet`, `payload`,
    `bytes`, `opcode` whose value is a hex byte string or a byte array (2-128 bytes).
  - `savedSettings` (iCUE): each model's saved setting names, with plain values (`BrightnessLevel: 66`).
  - `deviceFiles`: which files gave what; `sqlite`: tables and row counts; `asar`: entries read.
- `--vid` narrows to the apps that serve that vendor id and to that vendor's ids. Works with none installed.

**A found id is a lead, not a fact.** Per CLAUDE.md, anything taken from these files is checked on the device with a
read (step 1's `hid-caps.ps1`, then the sheet's safe reads) before it is used. Command bytes found in a file are
"documented by the maker's own file", not "seen in a capture": confirm them in a capture before sending any of them.

## Per app: where it keeps device data and what can be read

"Measured" = seen on this PC on 22 Oct 2026. "Source" = a public page. "Unverified" = the usual folder, not seen and
not documented anywhere I could find; the tool looks there and reports what is really there.

| App | Where (the tool looks in all of these) | Plain-text device data | Compiled (not readable) |
|---|---|---|---|
| **Logitech G HUB** (046D) | `%LOCALAPPDATA%\LGHUB\settings.db`, `%ProgramFiles%\LGHUB`, `%ProgramData%\LGHUB\depots\<n>\` | `settings.db`: SQLite, table `DATA`, column `FILE` = the whole settings JSON (source: gabfv/logitech-g-hub-settings-extractor reads `SELECT _id, FILE from DATA`); older versions `settings.json` (source: Logitech support). Gives per-device saved settings. | HID++ is in `lghub_agent.exe`; newer depot packages are encrypted (source: an open project reading G HUB packages, see below). No command bytes expected. |
| **Razer Synapse 3** (1532) | `%ProgramFiles(x86)%\Razer\Synapse3`, `%ProgramData%\Razer\Synapse3`, `%ProgramData%\Razer\Razer Central\Accounts\<id>\Devices`, `%LOCALAPPDATA%\Razer\Synapse3` (logs), `%APPDATA%\Synapse3` | Folders per account and device (source: Razer's clean-reinstall article lists the folders; filepathgeek says the device folders are not human-readable). Logs name `VID_1532&PID_xxxx`. | The 90-byte report protocol is in .NET/native DLLs. `docs/brands/razer.md` already maps it from OpenRazer. Synapse 3 lost updates on 3 Feb 2026 (source: Razer). |
| **Razer Synapse 4** (1532) | `%ProgramFiles%\Razer\RazerAppEngine\app-4.x\` (source: Razer Insider), `%LOCALAPPDATA%\Razer\RazerAppEngine`, `%ProgramData%\Razer\RazerAppEngine` | Electron: `resources\*.asar` may list product ids and names. Unverified. | Device control is in native services. |
| **Corsair iCUE 5** (1B1C) | `%LOCALAPPDATA%\Corsair\CUE5`, `%APPDATA%\Corsair\CUE5`, `%ProgramData%\Corsair\CUE5`, `%ProgramFiles%\Corsair\Corsair iCUE5 Software` | Measured: `%LOCALAPPDATA%\Corsair\CUE5\cache\devices.json` lists **335 models** with `usb-vid`/`usb-pid` (decimal), `display-name`, `device-type`, `package` (e.g. HS80 = 6940/2665 = 1B1C:0A69, `dev-hs80`). `%APPDATA%\Corsair\CUE5\config.cuecfg` (XML) keeps each model's settings by name. `eq_presets\*.cuelibrary`, `widgets\widgetsMetaData`, `preload_hw_lightings\defaultHwLightings`, profiles: XML ("cereal"). | Bragi property ids and commands are in the device packages' DLLs. `helpers/hs80-direct.js` and `docs/brands/corsair.md` have them. |
| **Corsair iCUE 4** (1B1C) | `%APPDATA%\Corsair\CUE4`, `%LOCALAPPDATA%\Corsair\CUE4`, `%ProgramData%\Corsair\CUE4`, `%ProgramFiles%\Corsair\CORSAIR iCUE 4 Software` | Same `config.cuecfg` XML (unverified for 4; same format family as 5). | Plugin DLLs. |
| **SteelSeries GG** (1038) | `%ProgramFiles%\SteelSeries\GG`, `%ProgramData%\SteelSeries\GG` | `%ProgramData%\SteelSeries\GG\apps\engine\db\database.db` (SQLite) keeps device settings such as DPI (source: a user restored their mouse settings by copying that file); `coreProps.json` is GameSense's local address. | Engine binary. `docs/brands/steelseries.md` maps it from rivalcfg. |
| **SteelSeries Engine 3** (1038) | `%ProgramFiles%\SteelSeries\SteelSeries Engine 3`, `%ProgramData%\SteelSeries\SteelSeries Engine 3` | `db\database.db` (SQLite), `coreProps.json` (unverified). | Engine binary. |
| **HyperX NGENUITY** (0951, 03F0) | `%LOCALAPPDATA%\Packages\*HyperXNGenuity*\LocalState` (source: file.net), `%ProgramFiles%\HyperX\NGENUITY`, `%ProgramFiles(x86)%\HyperX\NGenuity` | LocalState: saved settings at best. | A Store app: its program files are in `C:\Program Files\WindowsApps`, which is not readable without taking ownership (never done). Onboard profiles live on the device. |
| **ASUS Armoury Crate** (0B05) | `%ProgramFiles(x86)%\ASUS\ArmouryDevice\dll\<family>\` (source: file.net and ROG forum: `ArmourySocketServer`, `ShareFromArmouryIII\Mouse`, `MBLedSDK`), `%ProgramFiles%\ASUS\ARMOURY CRATE Service`, `%ProgramData%\ASUS\...`, `%LOCALAPPDATA%\Packages\*ArmouryCrate*` | Side files (xml/ini/json) beside the plugin DLLs may name models and product ids. | The protocols are in the plugin DLLs. Motherboard/GPU lights stay with OpenRGB (never SMBus). |
| **Turtle Beach Swarm II** (10F5, 1E7D) | `%ProgramFiles%\Turtle Beach\Swarm II`, `%LOCALAPPDATA%`/`%APPDATA%`/`%ProgramData%\Turtle Beach` | Unverified; nothing public describes it. | Compiled. `docs/brands/turtle-beach.md` has what open projects know. |
| **Glorious CORE** (258A, 22D4, 320F) | `%ProgramFiles%\Glorious Core`, `%LOCALAPPDATA%\Glorious Core`, `%APPDATA%\Glorious Core\datastore` | `datastore` keeps device settings across reinstalls (source: Glorious' uninstall guidance via technobezz/windowsforum); per-device side files (ini/json) in the install folder are typical of these OEM drivers (unverified). | Compiled; settings also on the device. |
| **Pulsar Fusion / cMouse** (3710) | Any folder named `Pulsar*`, `cMouse*` in Program Files, `%LOCALAPPDATA%`, and `Pulsar*`/`Fusion*` in `%LOCALAPPDATA%\Programs`, `%APPDATA%` | Unverified; nothing public. | No open project documents the protocol; DeviceHub learned the X-Lite read-only. |
| **Epomaker Driver** (342D) | Any `*Epomaker*` folder in Program Files, `%LOCALAPPDATA%`, `%LOCALAPPDATA%\Programs`, `%APPDATA%` | The current driver is an Electron app plus a Rust service `iot_driver.exe`; its command layer is in the app's JavaScript bundle (source: open-epomaker-panel-control). The tool searches the asar's JS and JSON for id literals and plain command bytes. Same ROYUAN-based driver serves Epomaker, Akko and Attack Shark (source: dnim.dev). | Model identification and checksum are in `iot_driver.exe` (the open project needed Ghidra for that: not done here). The P75 speaks VIA, which DeviceHub already runs. |
| **Wooting Wootility** (31E3, 03EB) | `%LOCALAPPDATA%\Programs\wootility*`, `%APPDATA%\wootility*` | Electron asar (unverified); settings in LevelDB `Local Storage` (skipped: not a plain format). Profiles live on the keyboard. | Wooting publishes open RGB and analog SDKs: read those instead. |
| **Keychron Launcher** (3434) | none | A web app (launcher.keychron.com, WebHID): nothing is installed, nothing to read. Keychron boards speak VIA/QMK, which DeviceHub already runs. | n/a |

**Honest limits.** Every app above keeps its protocol (the bytes it sends) in compiled code: G HUB (`lghub_agent.exe`),
Synapse 3/4 (.NET and native services), iCUE (device-package DLLs), SteelSeries (Engine binary), NGENUITY (a sealed
Store package), Armoury Crate (plugin DLLs), Swarm II, Glorious CORE and Pulsar (compiled), the Epomaker driver
(model detection in `iot_driver.exe`; only its JavaScript command layer is plain text). What this tool reliably gives:
**product ids, model names, device types, setting names, saved values, and sometimes ranges**. Command bytes appear
only where an app ships them in JSON/XML/INI or in Electron JavaScript, which is rare. The protocol itself still comes
from the brand sheets in `docs/brands/` or a learning session. Several folder layouts above are unverified (no public
description); the tool looks, and its report says what is really there.

## The real result on this PC (22 Oct 2026)

`node helpers/vendor-files.mjs` took under a second and wrote nothing (checked: iCUE's `data.sqlite` unchanged, no
side files).

- **Corsair iCUE 5: leftovers only** (iCUE was removed; its data folders stayed). 142 files looked at. **371 device ids
  (364 Corsair 1B1C, plus SCUF 2E95 and others iCUE also runs)** from `cache\devices.json` (350), `widgets\widgetsMetaData`,
  a profile and `preload_hw_lightings\defaultHwLightings`. It lists HS80 as 1B1C:0A69 and the HS80 receiver as
  1B1C:0A6B, as `helpers/hs80-direct.js` and `docs/brands/corsair.md` have them. Saved settings for **HS80, HS80 DONGLE and VOID ELITE Wireless** from
  `config.cuecfg`: e.g. HS80 `BrightnessLevel`, `DisableLedWhenMicActive`, `LightingMode`, `MicBoostValue`,
  `SleepModeEnabled`, `SleepModeWaitDelaySec` (900), `SoundNotificationsEnabled`, `TaskbarBatteryIconEnabled`. No
  ranges or command bytes (as expected: iCUE keeps them compiled). `GameSDKEffects` (1,003 game lighting files,
  2.3 GB) skipped.
- **SteelSeries GG: leftovers only** (`%ProgramFiles%\SteelSeries\GG` is empty; `%ProgramData%\SteelSeries\GG` has
  `appids.json` and `shared\guid.json`, no `database.db`). No device ids.
- **SteelSeries Engine 3: leftovers only** (empty folder).
- **Keychron Launcher:** web only.
- Not found: G HUB (the `Logi`/`Logitech` folders here hold only the wheel and force-feedback SDKs), Synapse 3/4,
  iCUE 4, NGENUITY, Armoury Crate, Swarm II, Glorious CORE, **Pulsar Fusion and the Epomaker driver** (no folder, no
  Apps entry). `--vid 342D` says "no app serving vendor 342D was found (looked for Epomaker Driver)".

## Lines to add to CLAUDE.md ("Adding your own devices", step 2)

Add as the first bullet of step 2, before "First the brand's mapping sheet":

```
   - **First read what the maker's app already left on the PC (read-only):** `node helpers/vendor-files.mjs --vid <vid>
     --summary` (add nothing, run nothing: it reads the app's own JSON/XML/INI/SQLite/asar files in place). It lists the
     product ids and model names the app knows, each model's saved setting names and values, and any setting ranges or
     command bytes it stores as plain text (rare: most apps keep the protocol compiled). Use it to name the model and
     the settings to look for; check every id with a read on the device, and treat any command bytes it shows as
     unconfirmed until they are seen in a capture. Where each app keeps what: `docs/handoff/vendor-files.md`.
```

And in "Checks", add `node tests/vendor-files.mjs` to `test` and `test:offline` in `package.json` (after
`node tests/my-devices.mjs`). I did not edit `package.json` or `CLAUDE.md` (not mine to change in this job).

## Sources

- G HUB `settings.db` (`DATA.FILE`): https://github.com/gabfv/logitech-g-hub-settings-extractor (ghub-settings.py)
- G HUB folders and `settings.json`: https://support.logi.com/hc/vi/articles/1500005396981 ; depots:
  https://github.com/AJLeuer/GHelper/blob/master/Developer%20Notes.md ; SQLite in newer versions:
  https://gist.github.com/TheoKondak/5e98dc6bed63ed0490d968f929244609
- Razer folders: https://mysupport.razer.com/app/answers/detail/a_id/1708 ;
  https://filepathgeek.com/posts/razer-synapse-profiles-location/ ; Synapse 4 path:
  https://insider.razer.com/razer-support-45/synapse-4-only-launches-via-razerappengine-exe-in-c-program-files-razer-razerappengine-app-4-0-698-90328 ;
  Synapse 3 end of updates: https://mysupport.razer.com/app/answers/detail/a_id/4130
- SteelSeries GG `database.db`: https://x.com/magni1200s/status/1619370898175455232 ; GG install path:
  https://support.steelseries.com/hc/en-us/articles/45986031508749
- HyperX NGENUITY package folder: https://www.file.net/process/ngenuity.exe.html
- ASUS ArmouryDevice folders: https://www.file.net/process/armourysocketserver.exe.html ;
  https://rog-forum.asus.com/t5/armoury-crate/armoury-crate-location/td-p/890786
- Glorious CORE datastore: https://www.technobezz.com/how-to-fix-glorious-core-not-working ;
  https://windowsforum.com/news/glorious-core-not-detecting-devices-fix-usb-firmware-and-pairing.439695/
- Epomaker driver (Electron + `iot_driver.exe`): https://github.com/blzkz/open-epomaker-panel-control ; shared ROYUAN
  driver: https://dnim.dev/blog/royuan-keyboard-protocol
- Wootility profiles and background service: https://wooting.io/post/wootility-5-4-app-linking-and-advanced-keys-presets
- iCUE 5 files: measured on this PC (no public description found).
