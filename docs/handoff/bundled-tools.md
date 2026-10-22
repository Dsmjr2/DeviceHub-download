# Tools shipped inside DeviceHub: Equalizer APO and OpenRGB (22 Oct 2026)

The owner, 22 Oct 2026: ship Equalizer APO and OpenRGB inside DeviceHub so nobody downloads them separately ("Yes why
would we not want to ship them in it?"). Only those two, from their official sources. The PawnIO driver, its .bin
modules, WinRing0, inpout and every kernel driver are never downloaded, bundled or installed. Decided the same day (the
Manager, under that OK): keep OpenRGB's 4 KB user-mode `PawnIOLib.dll` so OpenRGB starts, ship OpenRGB 1.1 instead of
1.0, and allow colours and Put back through it; any OpenRGB older than 1.1 stays read only.

## What changed

| File | What |
|---|---|
| `helpers/bundled-tools.json` (new) | per tool: version, official URL and hosts, file, size, pinned SHA-256, license, folder; for OpenRGB every kept file with its own SHA-256, the dropped files and why, the DLLs it needs to start, and `sdkWrites` |
| `helpers/fetch-bundled.mjs` (new) | used by make-installer: downloads each pinned file into `bundled-cache\` (ignored by git), HTTPS only, redirects only to that tool's own hosts, exact size, SHA-256 must match, then takes only the kept files out of OpenRGB's zip (each hash-checked); `neverKeep` (any `.sys`, any `.bin` PawnIO module, WinRing0, inpout, anything PawnIO except the file named exactly `PawnIOLib.dll`) wins over the table. Never runs anything. Prints the manifest for the zip |
| `helpers/licenses/GPL-2.0.txt` (new) | the GPL v2 text (both tools are GPL-2.0; neither ships a license file of its own). Copied from the verbatim copy already on this PC (Git for Windows, xz's COPYING.GPLv2) |
| `helpers/make-installer.ps1` | runs fetch-bundled and adds `tools\equalizerapo\`, `tools\openrgb\`, their `LICENSE-GPL-2.0.txt` and `tools\README.txt` (source, version, size, hash, license, source-code link); after building, refuses a zip with a driver or PawnIO module under `tools\` or without the tools; `-NoTools` for a test build; `openrgb-config` and `bundled-cache` added to the private list |
| `helpers/installers.mjs` | Equalizer APO installs from `tools\equalizerapo\EqualizerAPO-x64-1.4.2.exe` (no download): hash checked again just before it runs, then started the ordinary way (Windows' own admin prompt), file kept. Without the bundle (a development copy) it stays "Get" = official page; a running DeviceHub never downloads it. The after-text names the box to tick |
| `public/ui/installer-button.js` | the plan dialog says "Inside DeviceHub (the official file from sourceforge.net); nothing is downloaded" |
| `helpers/openrgb.js` | the bundled OpenRGB: started hidden as an SDK server only when lights are used, stopped on quit; colours and Put back refused through any OpenRGB built before 1.1 (details below) |
| `public/pages/pc-lights.js` | not running + bundle startable: says DeviceHub carries OpenRGB for USB lights, button "Find lights"; shows why it cannot start; running through the bundle: "USB lights only" (and "read only for now" if it is ever an older build) |
| `tests/bundled-tools.mjs` (new) | see Tests |
| `.gitignore` | `bundled-cache/`, `openrgb-config/` |

Settings > Optional tools needed no change: Equalizer APO's row shows "Install Equalizer APO" by itself once the bundle
is there (`offer: 'install'`). The Settings layout is untouched.

## Sources, sizes, hashes (pinned 22 Oct 2026)

| Tool | Official URL | File | Size | SHA-256 | License |
|---|---|---|---|---|---|
| Equalizer APO 1.4.2 x64 | `https://sourceforge.net/projects/equalizerapo/files/1.4.2/EqualizerAPO-x64-1.4.2.exe/download` (redirects to `downloads.sourceforge.net`, then a `*.dl.sourceforge.net` mirror) | `EqualizerAPO-x64-1.4.2.exe` | 11,980,366 B | `7403be7427bbe1936a40dded082829b6e217fc4f5990fee5cba501f0ae055afa` | GPL-2.0 |
| OpenRGB 1.1 Windows 64-bit portable | `https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.1/OpenRGB_1.1_Windows_64_8e16de2.zip` (the link openrgb.org/releases.html gives; no redirect) | `OpenRGB_1.1_Windows_64_8e16de2.zip` | 22,019,605 B | `63291726c6fc84eb479ef2ee752e97e1187f6ce9c49fd27eee40ded588a8172a` | GPL-2.0 (Qt 6 LGPL-3.0, libusb LGPL-2.1, hidapi BSD-style, PawnIOLib.dll PawnIO's, as in its zip) |

Cross-checks: Equalizer APO's MD5 (`410aab9749ae4673b950bc29a4eb226f`) equals the MD5 SourceForge publishes for it; it
is not signed (NotSigned). OpenRGB 1.1's size equals the size in Codeberg's release API; the project publishes no hash.
Each file was downloaded twice with the same SHA-256 (Equalizer APO: curl, then fetch-bundled into an empty folder;
OpenRGB 1.1: two separate downloads). The 1.0 zip pinned first (`182a52a3...`, 22,012,179 B) is no longer used; it stays
in `bundled-cache\` only (ignored by git).

OpenRGB files kept (16): `OpenRGB.exe` (1.1: `e26ae71162795a8abcfb90c05c1572a00ba06ca63b886aca57392a0138963b1e`),
`PawnIOLib.dll` (`c6e7c2f54643ef9cb51b9a3ec7b0efc9e204803c206f33014e39f281546ea9b4`, user mode, imports only ntdll and kernel32),
`Qt6Core.dll`, `Qt6Core5Compat.dll`, `Qt6Gui.dll`, `Qt6OpenGL.dll`, `Qt6Widgets.dll`, `dxcompiler.dll`, `dxil.dll`,
`hidapi-hotplug.dll`, `libusb-1.0.dll`, `imageformats\qgif|qico|qjpeg.dll`, `platforms\qwindows.dll`,
`styles\qmodernwindowsstyle.dll` (all but OpenRGB.exe identical to 1.0's). Dropped (6): the PawnIO modules
`LedsValve.bin`, `LpcIO.bin`, `SmbusI801.bin`, `SmbusIntelSkylakeIMC.bin`, `SmbusNCT6793.bin`, `SmbusPIIX4.bin`. The
zip has no `.sys` file, and the PawnIO driver is not shipped, so PawnIOLib.dll has nothing to talk to.

**Zip size: 34.8 MB before, 66.4 MB after (69,658,798 bytes)**, measured by adding the manifest's 20 files to a copy of
the current `dist\DeviceHub-setup.zip` (the real `dist\` was not rebuilt); make-installer's driver check passes on them.
`DeviceHub-Setup.exe` (IExpress) grows the same.

## OpenRGB older than 1.1 is read only

OpenRGB 1.1 (16 Oct 2026) fixed "the OpenRGB SDK server device indices on protocol versions < 6"; DeviceHub speaks
protocol 3, so through an older OpenRGB a colour sent by number could land on the wrong light. OpenRGB.exe has no Windows
version number (0.0.0.0), but it carries its commit id and commit time (its About page's "Git Commit Date"): 1.0 is
`81bbe18`, 2026-09-11 18:06:58 -0500; 1.1 is `8e16de2`, 2026-10-16 16:37:19 -0500. `helpers/openrgb.js` reads that stamp
from the exe (cached by path, size and time) and refuses `setColor` and Put back, before any packet is sent, when the
OpenRGB behind them was built before 1.1 (`FIXED_BUILD`):
- through the bundled one: its `tools\openrgb\OpenRGB.exe` (and `sdkWrites: false` in the table also refuses);
- through the person's own on 6742: the running OpenRGB.exe files (Win32_Process; one PowerShell call per colour or Put
  back), or, when Windows does not name them (one running as administrator), the installed one. An OpenRGB whose stamp
  cannot be read, or that cannot be found, is written to as before.
The message names the build and commit and says to update OpenRGB to 1.1 or newer. Reads are never refused.

## Equalizer APO: choosing the headset

Its Configurator (`DeviceSelector.exe`) has no command line (only Qt's own `--windowtitle` etc.) and records the choice by
rewriting each device's `FxProperties` under `HKLM\...\MMDevices\Audio\Render|Capture\{guid}` (Windows' protected
audio-effect keys; it keeps the old effects under `HKLM\SOFTWARE\EqualizerAPO\Child APOs` and writes `backup_*.reg`
files). DeviceHub does not edit those keys. So: the installer opens the Configurator itself at the end, and DeviceHub's
text says "on Playback devices tick your headset (and on Capture devices its mic), click OK, and restart". Anything left
unticked shows on the Equalizer card as "Not on for ..." with Turn on (`helpers/eqapo-devices.js`, unchanged).

## The bundled OpenRGB (helpers/openrgb.js)

- Which server: the bundled one when DeviceHub started it; else one already on 127.0.0.1:6742 (the person's own); else,
  only when lights are being used, the bundled one is started. "Used" = `status(true)` (PC lights' Find lights / Look
  again, Settings' check), `setColor`, `restore`. `status(false)` (page load, command palette, `/api/setup`) never starts it.
- Through the bundled 1.1, colours and Put back work (backup first, read back, as for the person's own OpenRGB).
- Never started when an `OpenRGB.exe` process is running (tasklist) or OpenRGB is installed (`Program Files\OpenRGB`,
  `Program Files (x86)\OpenRGB`, `%LOCALAPPDATA%\Programs\OpenRGB`), when a needed DLL is missing, or when Windows lacks
  the Visual C++ runtime (`MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll` in System32; not in OpenRGB's zip).
- Started as `OpenRGB.exe --server --server-host 127.0.0.1 --server-port <free port> --noautoconnect --config
  <DeviceHub>\openrgb-config` from `tools\openrgb\`, `windowsHide`, no `--gui`, no autostart flags. Its pid and port go to
  `%TEMP%\DeviceHub-openrgb.json` so one left by a crashed DeviceHub is taken over, not started twice.
- Stopped on `process.on('exit')` (server.js's shutdown ends with `process.exit`), and by `openrgb.stop()`.
- CPU: no new loop. Only while starting it knocks on its port every 300 ms, at most 50 times.
- Through the bundle only `HID`/`USB` controllers are listed or written (OpenRGB may still find a graphics card itself
  through NVIDIA's/AMD's API; DeviceHub never shows or writes it). DeviceHub's own devices stay excluded (`ownDevice`).

## Lines for the Manager (files I may not edit)

package.json: add `&& node tests/bundled-tools.mjs` to both `test` and `test:offline`, after `node tests/installers.mjs`.

server.js: nothing required. Optional, for a prompt stop instead of the exit hook: in `shutdown()`, beside the other
stops, `try { openrgb.stop(); } catch {}`.

CLAUDE.md:
- Replace the rule "Never set up or install OpenRGB, PawnIO or LibreHardwareMonitor without Shawn's OK" with:
  "OpenRGB 1.1 (USB lights only, no PawnIO driver; only its user-mode PawnIOLib.dll is kept so it starts) and Equalizer
  APO 1.4.2 now ship inside DeviceHub by Shawn's decision of 22 Oct 2026 (`helpers/bundled-tools.json`; DeviceHub starts
  OpenRGB only while lights are used and runs Equalizer APO's installer only on the person's click). The PawnIO driver
  and LibreHardwareMonitor still need his OK; never bundle a driver or a PawnIO module."
- In the never-broken rule about SMBus, replace "DeviceHub never installs OpenRGB or its SMBus driver" with "the
  OpenRGB DeviceHub carries has no driver (the PawnIO driver and its SMBus modules are left out), so it reaches USB
  lights only".
- PC lights: "Use OpenRGB 1.1 or newer" stays true; add "DeviceHub refuses colours and Put back through an OpenRGB built
  before 1.1 (it reads the build stamp in OpenRGB.exe)".
- "Set this up", the up-front list: Equalizer APO is no longer a download (Install on the Equalizer card or Settings >
  Optional tools runs the copy inside DeviceHub); OpenRGB is inside DeviceHub for USB lights; board/RAM lights still need
  the person's own OpenRGB 1.1 + PawnIO, their decision.
- Map: `helpers/fetch-bundled.mjs   the bundled tools for the zip (helpers/bundled-tools.json), pinned by SHA-256`.
- Checks: `node tests/bundled-tools.mjs` in the offline list.

## Tests

`node tests/bundled-tools.mjs` (one "all good" line; about 5 s): the real table (OpenRGB 1.1, colours on, PawnIOLib.dll
kept, six modules dropped) is pinned and refuses a keep list holding a PawnIO module or a .sys; `neverKept` names
(PawnIOLib.dll allowed, PawnIO.dll / pawnio.sys / a PawnIO folder / .bin / WinRing0 / inpout not); downloads through a
stand-in network (official redirects and mirror followed; hash mismatch refused with nothing left; off-host, look-alike
host and http redirects refused and never requested; wrong size refused); zips built in the test (only kept files taken,
modules and .sys left out even if the table keeps them, unknown file, missing file and `..` path refused, deflate
unpacked); README content; Equalizer APO from a stand-in bundle (offered to install, plan with no HEAD, installed with no
download, file kept, a changed file never run, no bundle = page only); the build stamp read from stand-in exes (1.0
before the fix, 1.1 not); OpenRGB with a stand-in `OpenRGB.exe` (a Node script answering the SDK protocol on the given
port): not started by an ordinary read, started once by a fresh read with the right arguments, hidden; through 1.1 a
colour and Put back go ahead; a 1.0 build in its place is read only with no write packet; `sdkWrites: false` refuses;
taken over after a "crash", stopped (port closes, note removed), not started when another OpenRGB runs or is installed,
when PawnIOLib.dll is missing, or without the VC++ runtime; the person's own OpenRGB: an older build running (or, unnamed,
installed) is read only, a 1.1 one is written through and the bundled one is not started.
`node tests/installers.mjs` and `node tests/openrgb-mock.mjs` pass unchanged.

## Not tested (by instruction or not possible here)

- The real Equalizer APO installer was never run from the bundle (Start-Process, the admin prompt, the Configurator).
- The real OpenRGB.exe 1.1 was never started: whether `--server` without `--gui` stays fully windowless, how long its
  server takes to answer, and what it finds with PawnIOLib.dll present but no PawnIO driver (it should skip SMBus devices).
- The build-stamp check on a real person's OpenRGB (Win32_Process naming the file; one run as administrator falls back
  to the installed copy); MSI builds are expected to carry the same stamp as the portable ones (not checked).
- `make-installer.ps1` was not run end to end (it publishes and signs a release): the bundled block and the zip check were
  parsed and their parts run separately (the manifest added to a copy of the zip; the driver check on sample names).
  `make-setup-exe.ps1` with a 66 MB zip is untested.
- The installer and Settings > Update copying `tools\` to an installed copy: `install.ps1` copies every top-level item,
  so it should; a git-merge update does not carry `tools\` (not in git) and keeps the one already installed.
- The pages were not opened in a browser (tests/pages.mjs needs DeviceHub running, which was not restarted).
