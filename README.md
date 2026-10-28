# DeviceHub

One Windows app for a mouse, a headset and a keyboard, instead of three vendor apps.

**Different devices?** Plug them in: DeviceHub's shared library (21 drivers) sets up known ones by itself, and
**Learn a device** (in the sidebar) teaches it the rest while you change settings in the maker's app.
[ADD-YOUR-DEVICES.md](ADD-YOUR-DEVICES.md) has the steps.

## Supported devices

| Device | What DeviceHub controls |
|---|---|
| **Pulsar X-Lite CrazyLight** (on the Pulsar 8K dongle, or on its USB cable) | DPI stages, active stage, polling rate, lift-off, debounce, motion sync, angle snapping, ripple control, turbo, button remapping (left click locked), DPI light, stage colors, auto sleep, battery (with DeviceHub's own level while charging) |
| **Corsair HS80 RGB Wireless** (receiver or USB cable) | battery, logo and mic lights, sleep timer, Windows volume and mic level, mic mute, sidetone, mic boost, EQ presets |
| **Epomaker P75**, or any **VIA keyboard** (wired) | every key on every layer, the knob, macros, lights on/off, effect, color, brightness and speed (layouts from VIA's library of about 1,500 keyboards; Keychron Pro, Max, HE and 8K boards need Keychron's VIA file, see ADD-YOUR-DEVICES.md) |
| **Monitors** (DDC/CI) | brightness, contrast, speaker volume, color preset and color balance (when the monitor lists them) |
| **Webcams** | brightness, contrast, color, sharpness, white balance, exposure, focus, zoom |
| **PC lights** (USB lights; motherboard, its RGB headers, lit RAM, many graphics cards) | one color, through OpenRGB. USB lights work through the OpenRGB 1.1 built into DeviceHub; the motherboard, its fan headers and RAM need one click on Add board, fan and RAM lights (it installs the signed PawnIO driver if missing and runs that OpenRGB as administrator, behind one Windows prompt; Remove board lights undoes it). DeviceHub never writes to that hardware itself: OpenRGB does |
| **Windows sound** (Equalizer APO) | headset and monitor EQ, Natural sound, mic filters |

Plug in any of them and DeviceHub shows just the ones you have. Other devices come from the shared device library
(`device-library/`, 21 drivers: Logitech, Razer, ASUS ROG, Glorious, SteelSeries, Corsair, HyperX and ROCCAT mice; Logitech,
SteelSeries Arctis, Corsair, HyperX, Audeze Maxwell, Astro A50 and Turtle Beach headsets; Logitech, Razer, Corsair, Keychron, Wooting, ROCCAT, HyperX and SteelSeries Apex keyboards), installed automatically by auto setup when it
matches your USB devices, or from **Learn a device**, a step-by-step wizard that makes a driver from what the maker's
app sends. Setup lists what was found on the PC and any device from a known brand, with a Learn it button.

Plus: profiles for all three and for devices you added (with automatic switching when a game starts), **Get help**
(a short report about a device, shown to you in full first; GitHub opens only when you click), **Supported devices**
(from Settings or Search: what DeviceHub runs and what each device gets), one-color lighting sync, typed commands
in Search ("zoom 2x", "brightness 40", "eq competitive"), a setup file that saves or restores everything at once,
backups before every change, Bluetooth devices with their battery, and a demo mode.

## Install (Windows 11)

1. Download **DeviceHub-Setup.exe** from github.com/Dsmjr2/DeviceHub-download and double-click it. Windows may say
   "Windows protected your PC" (the app is not code-signed): More info > Run anyway.
2. DeviceHub installs to your user folder (`%USERPROFILE%\DeviceHub`), makes Desktop and Start menu shortcuts and
   opens. Nothing else needs installing: Node.js comes inside. Remove it in Windows Settings > Apps > DeviceHub.
3. Plug in your devices. They are found by themselves.

The zip (DeviceHub-setup.zip) holds the same app: unzip it and run **Install DeviceHub**.

## Use it

Double-click **DeviceHub** on the Desktop. A small background part owns the devices, so changes apply at once and
profiles keep switching with the window closed. Its **tray icon** by the clock opens DeviceHub, applies a profile,
turns auto-switch on or off, or quits. Settings > Start with Windows starts it at sign-in. If it ever crashes it
starts again by itself.

Demo with pretend devices: Settings > Demo mode.

## Safety

- Before every change the device's full settings are saved to `backups\` (Backups page: view, restore).
- One setting is written at a time and read back; a value that does not read back is reported, not kept.
- Mouse settings are writable only when their stored check byte proves they were read correctly.
- Never sent: firmware updates (those stay in the vendors' apps), the keyboard's reset, EEPROM-clear or bootloader
  commands, or reset / bootloader keycodes.
- Never written directly: the motherboard's SMBus or a graphics card's I2C bus (motherboard and RAM lights). Those go
  through OpenRGB, which you install yourself if you want them.

## Updates and your own devices

Settings shows when a new version is ready; Update installs it and keeps everything set up on your PC. Devices added on your PC live in the `my-devices` folder, each with its own page, and no update ever changes them. If DeviceHub's
own files were changed on your PC too, Update brings those changes and the new version together, or keeps a copy of your changed files in `backups\` before installing the new version.

## Uninstall

In DeviceHub: Settings > Uninstall (or Windows Settings > Apps > Installed apps > DeviceHub > Uninstall). It asks once, quits DeviceHub, removes "start with Windows"
and the shortcuts, keeps your backups in Documents\DeviceHub backups and deletes the DeviceHub folder. Your devices
keep their settings.

## For developers

- **Mouse**: Pulsar's config protocol on HID usage page 0xFF02, report 8, 16-byte packets, written from the protocol
  facts documented by OpenMouse (github.com/OpenMouse-Project) and the Linux Pulsar driver patch; no code copied.
- **Keyboard**: VIA raw HID (usage page 0xFF60), matrix 6 x 15, checked against the base layer before any edit.
- **Headset**: Corsair's Bragi protocol straight to the receiver or cable, Corsair's official iCUE SDK (npm `cue-sdk`)
  while iCUE runs, and Windows Core Audio for volume, mic and sidetone.
- `server.js` local server (127.0.0.1:5577 only) · `helpers/agent.mjs` background agent · `helpers/native/` the
  Windows helper (built on first start with Windows' own C# compiler) · `public/` the app.
- Your data stays on your PC and out of git and the installer: `backups\`, and in `data\` your settings, profiles,
  activity, battery history and light settings (`data\settings.json`, `data\profiles.json`, ...); the server's log is
  `logs\server.log`. A copy from before 27 Oct 2026 kept those files beside the app; its first start moves them
  into `data\` by itself (`helpers/data-migrate.js`).
- **Monitors**: DDC/CI through Windows' monitor API (`helpers/monitors.cs`): brightness, contrast, speaker volume.
- Checks: `npm test` (every script parses, no stray control characters, JSON valid, then every page opened live and
  in demo without a script error; the page part is skipped when DeviceHub is not running), `npm run test:offline`
  (the first part only), `node helpers/soak-test.mjs` (every setting written with its own value, read back),
  Settings > Self-test, and `helpers\health-watch.ps1` (12 hours of health readings into health-watch.csv).
- Build the installer: `powershell -File helpers\make-installer.ps1` (refuses to finish if any personal data got in).
