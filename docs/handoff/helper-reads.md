# PC reads in the native helper (26 Oct 2026)

Each of these reads used to start a PowerShell (about 0.3-1.7 s of CPU, a CPU spike each time, and an `Add-Type` C#
compile for the display and sensor reads) or a `tasklist`. They now run inside `DeviceHubHelper.exe`, which already
runs, and answer with the same JSON the PowerShell printed. PowerShell stays as the fallback.

## How it works

- **`helpers/pc-reads.cs`** (new, compiled into the helper with `helpers/pc-native.cs`; `build.ps1` adds
  `/r:System.Management.dll`): `PcReads.Op({ op, ... })` answers `{ ok: true, result }` or `{ ok: false, error }`.
  Windows' configuration manager (cfgmgr32: the device list and its properties, the list `Get-PnpDevice` shows), WMI,
  the registry, the power plan API, `pc-native.cs`'s display and graphics reads, and for the PC check NVIDIA's
  `nvidia-smi` and Windows' `netsh` as programs, exactly as `pc-check.ps1` ran them. Nothing is written and no device
  is opened (`tests/helper-reads.mjs` checks the source for registry writes, display changes, device opens and WMI
  methods other than the drive reliability read).
- **`helpers/native/helper.cs`**: the channels `pc:<op>` go to `PcReads.Op`, one channel per read so a slow WMI read
  never holds up another. A WMI query gives up after 15 s.
- **`helpers/helper-reads.js`** (new): `read(op, { ps, extra, ms })` asks the helper when it is already running, and
  otherwise, or when the answer is `GONE`, `TIMEOUT`, `ERR unknown channel` (an older helper), `{ ok: false }` or has
  no result, runs the PowerShell read exactly as before. A read never starts or builds the helper, so a test or a
  script reading the PC starts none. The fallback is logged once per read (not for a helper that is simply not
  running). `DEVICEHUB_HELPER_READS=0` turns the helper path off. `stats()` counts both paths.

| op | was | caller |
|---|---|---|
| `running` | `tasklist /FI "IMAGENAME eq iCUE.exe"` | `helpers/hs80-direct.js` `icueRunning()` (every 10-30 s) |
| `bluetooth` | pc-map.js `BT` (Get-PnpDevice + Get-PnpDeviceProperty) | `GET /api/bluetooth` (Overview, once a minute) |
| `std-battery-bt` | `std-battery.ps1 -Mode bt` | `helpers/std-battery.js` (`/api/setup`, once a minute) |
| `pc-map` | pc-map.js `PS` (CIM + Get-PnpDevice) | `GET /api/pc`, setup, diagnose, lights |
| `pawnio` | Uninstall key + Get-Service | `helpers/board-lights.mjs` `deps.pawnio()` (`/api/board-lights`) |
| `installed` | the Uninstall keys | `helpers/installers.mjs` `deps.installedApps()` |
| `eqapo` | MMDevices registry reads | `helpers/eqapo-devices.js` `status()` |
| `procs` | `tasklist /fo csv /nh` | `helpers/diagnose.mjs` (the maker's app running) |
| `display-read` | `display.ps1` read (Add-Type) | `helpers/display.js` (`GET /api/display`, the PC check) |
| `sensors` | the `pc-sensors.ps1` session (Add-Type) | `helpers/pc-sensors.js` (`GET /api/temps`, every 5 s on the PC page) |
| `pc-check` | `pc-check.ps1` | `helpers/pc-check.js` `gather()` (`GET /api/pc-check`) |

Equal output was checked live on Shawn's PC (both paths, every op, 26 Oct 2026; only live numbers such as free space,
ping and load differ), and `tests/helper-reads.mjs` checks it on samples recorded there
(`tests/lib/helper-reads-samples.json`, names and the network replaced), plus the fallback cases.

Details that make the output equal: device instance ids in capitals (as Win32_PnPEntity), status Unknown / Error /
Degraded / OK as Win32_PnPEntity names it, the Storage module's names for media, bus, health and operational status,
the drive reliability counters asked the way `Get-StorageReliabilityCounter` asks (PS_StorageCmdlets, so a user
without administrator gets "denied" as before), a Bluetooth last connection to the microsecond, and tasklist's names
for Windows' own processes (`System Idle Process`, `System`, `Registry`, `Memory Compression`).

## What stays on PowerShell, and why

- Every change: display mode, HDR, main screen (`display.ps1`), board lights, CPU sensors and Wi-Fi pause setup
  (elevated), installs and their signature checks, monitor sleep, shortcuts, uninstall, self-update.
- Reads that open a device: `diagnose.mjs` `openProbe` (opens the HID channel), `std-battery.ps1 -Mode hid` (opens
  HID collections for their descriptors), the LampArray finder.
- Safety checks before a write: `my-devices.mjs` and `declarative-driver.mjs` look for the maker's app with tasklist.
- Rare or on a click: wallpapers, monitor brightness over WMI, Get help, the learning wizard, games, updates,
  `windowMemory()` (Settings > Health), `runningPrograms(true)` (the window-title picker), backup tidy.
- `nvidia-smi` (the PC page's graphics card, `helpers/gpu.js`) and `netsh` are programs, not PowerShell, and stay.

## The pre-built helper

`helper-sources.js` and `build.ps1` list `pc-native.cs` and `pc-reads.cs`. A development copy rebuilds on its next
start (the file-time rule); `make-installer.ps1` builds and hashes it as before. The helper is still the one exe.

## Also in this build

`helpers/native/tray.cs`: a single left click on the tray icon opens DeviceHub, as the double-click and "Open
DeviceHub" do (DeviceHub.vbs); a second open within 2 s is the same press, so a double-click opens it once.

The CPU load and clock and the ACPI zones are read from Windows' performance counters kept open in the helper (the
same counters `Win32_PerfFormattedData_*` formats; a WMI query of those took ~0.27 s every 5 s on the PC page), with
the WMI query as the fallback. The first reading primes the rate counters (250 ms, once per helper start).

## Measured (26 Oct 2026, Shawn's PC)

Before: Shawn's running copy (old code), a headless Chrome on the page for 10 minutes with every non-GET request
blocked. After: an isolated copy on port 5590 (`DEVICEHUB_ISOLATED=1 DEVICEHUB_ISOLATED_READS=1`, the helper built
by `build.ps1 -Out` with its hash recorded, so "shipped"), replaying the same GETs at the same rate. Processes counted
by polling every 100 ms (programs that live under ~0.1 s, such as tasklist, are partly missed; PowerShell is not).

| | PowerShell starts / 10 min | other programs seen | server CPU | helper CPU |
|---|---|---|---|---|
| Overview, before | 7 (Bluetooth 2, std-battery 2, Apps list, PawnIO, Equalizer APO) | 15 tasklist, 4 nvidia-smi | 469 ms | 578 ms |
| Overview, after | 0 | nvidia-smi (graphics card, unchanged) | 94 ms | 688 ms |
| PC page, before | 13 (pc-check, sensors session, display, Bluetooth 2, std-battery 2, Apps list 2, PawnIO 2, Equalizer APO, the LampArray finder) | 12 tasklist, 26 nvidia-smi | 781 ms | 469 ms |
| PC page, after | 0 | nvidia-smi only | 125 ms | 672 ms |

The isolated copy runs no background parts (no iCUE check, auto-switch, sync), so its other-program column is lower
for that reason too; the PowerShell column compares the same reads, except the LampArray finder (it stays on PowerShell, and `/api/setup` is not one of the isolated reads), so the PC page after is 1 PowerShell start, not 0, on the real copy. `/api/helper-calls` on the isolated copy showed
only `pc:<op>` and the watchdog: no device channel was opened.

| GET | before | after |
|---|---|---|
| `/api/pc-check?fresh=1` | 4.1-4.3 s | 0.28-0.36 s |
| `/api/temps` | 0.29-0.47 s | 0.05 s (0.26 s the first time) |
| `/api/display` (first, then kept 15 s) | 0.46 s | 0.05 s |
| `/api/bluetooth?fresh=1` | 1.7-1.9 s | 0.24-0.25 s |
| `/api/installers?fresh=1` | 0.55-0.56 s | 0.01-0.02 s |
