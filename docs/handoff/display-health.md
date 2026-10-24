# Display settings, temperatures and the PC check (24 Oct 2026)

Shawn picked three things: display settings per screen, temperatures and fans (read only), and a PC check (read only).
Plus four more checks the same day (RAM speed, devices with errors, recent crashes, a waiting restart).
Not committed.
Nothing here has changed a real screen: every display change was tested with fakes only.
The reads were run on Shawn's PC (see "Measured").

## Where it shows

- **Monitors page**: each monitor card has a "Display" part: Resolution, Refresh rate, HDR, Main screen, Night light.
  A screen with no monitor card (not in the DDC/CI list) gets a card of its own.
- **PC page** (the sidebar entry that was "Fans"; id still `fans`, so links and Get help are unchanged): Graphics card,
  Fan lights, **Temperatures and fans**, **PC check**.
  One sidebar entry now covers the PC's readings, its fans and its check, so nothing was added to the sidebar.
  Settings > Health is still about DeviceHub itself; the PC check is about the PC.
- No pop-ups, toasts or tooltips in the new parts: every question and result is a line on the card.

## Display settings (helpers/display.js, helpers/display.ps1, helpers/pc-native.cs)

- Windows' own APIs through PowerShell with Add-Type (not the device helper, so the helper is never rebuilt for this):
  EnumDisplayDevices / EnumDisplaySettingsEx / ChangeDisplaySettingsEx for modes and the main screen,
  QueryDisplayConfig / DisplayConfigGetDeviceInfo (type 9) / DisplayConfigSetDeviceInfo (type 10) for HDR.
- Screens are matched to monitor cards by the same id helpers/monitors.cs makes (model#instance).
- The rules for a change:
  - one change at a time ("Keep or undo the last change first.");
  - every screen's settings backed up first: `backups/display-<time>.json`;
  - a mode is tested with CDS_TEST, then applied for this session only (no registry write);
  - read back at once; a change Windows does not show is put back at once;
  - then 15 s of "Keep this? ... It changes back in N s." with Keep and Undo; no answer puts the backup back;
  - Keep saves the mode (CDS_UPDATEREGISTRY) and reads it back again.
  - The 15 s timer lives in the server, so closing the window still reverts.
- Main screen: every screen moves by the same offset so the new main one sits at 0,0, saved together, applied at once.
  A refusal half way puts the old main screen back.
- Refresh flag: a screen below the highest rate it offers at its current resolution (more than 2 Hz below, so 143 vs
  144 is not flagged): "Running at 60 Hz; this screen does 144 Hz." with a one-click "Use 144 Hz" (the same 15 s Keep).
- Night light: **read only**. Its state is an undocumented settings blob (HKCU CloudStore
  `bluelightreductionstate`; byte 18 is 0x15 on, 0x13 off, from community write-ups, not Microsoft). No source shows a
  write is safe, so DeviceHub never writes it; the row has a Settings button (`ms-settings:nightlight`).

Routes (helpers/pc-routes.js, one line in server.js):
`GET /api/display`, `GET /api/display/state`, `POST /api/display/set {screen, kind: mode|hdr|primary, value}`,
`POST /api/display/keep`, `POST /api/display/undo`, `POST /api/display/open-settings {page}`.

## Temperatures and fans (helpers/pc-sensors.js, helpers/pc-sensors.ps1)

Read only; no fan control at all. Read every 5 s only while the card is on screen (IntersectionObserver, window shown,
page open). The PowerShell session compiles once and stops 30 s after the last question.

| Source | Works with no new driver? | On Shawn's PC |
|---|---|---|
| nvidia-smi (helpers/gpu.js) | yes, NVIDIA only | RTX 4070, 34 °C, fan 0% |
| D3DKMT adapter perf data (Task Manager's source; any maker whose driver reports it) | yes | RTX 4070, 33.9 °C, no fan RPM |
| ACPI thermal zones (performance counter, no admin) | yes | `\_TZ.UAD0` 17 °C: below room temperature, shown as "not a real reading" |
| MSAcpi_ThermalZoneTemperature (root/wmi) | no: access denied without admin | - |
| Bundled OpenRGB 1.1 | lights only, no fans or temperatures | - |
| PawnIO (installed on Shawn's PC) + bundled tools | no: OpenRGB uses its LpcIO module for lights, nothing reads fan RPM | - |

Not readable (shown on the card with what would be needed): CPU temperature, CPU and case fan speeds.
Both need LibreHardwareMonitor (not added; Shawn decides):
v0.9.6, 14 Feb 2026, `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases`,
LibreHardwareMonitor.zip 6,632,626 bytes; uses PawnIO (already installed on Shawn's PC), and runs as administrator.
Drive temperature and wear (Get-StorageReliabilityCounter) need administrator too.

## PC check (helpers/pc-check.js, helpers/pc-check.ps1)

One PowerShell read as the signed-in user, then a list of check functions over its facts.
Each returns `{ id, title, level: ok | warn | info, line, link? }` (or a list of them).
To add a check: write `(facts, now) => result(s)` and add it to `CHECKS`; a check that throws becomes one info line.
Read when the page opens (cached 60 s) and on Check again; never in the background.

- Free space per drive: warn under 10%.
- Drive health: Get-PhysicalDisk HealthStatus; wear and temperature when the reliability counter answers (it needs
  admin on Shawn's PC, said in one line).
- Graphics driver: version (NVIDIA's own number, e.g. 621.01) and date; warn when over 183 days old; a link to the
  maker's official driver page. NVIDIA, AMD and Intel publish no plain official lookup endpoint for the latest version
  (NVIDIA's is an undocumented site service), so none is asked.
- RAM speed: ConfiguredClockSpeed against the rating (from the part number where the maker writes it there:
  G.Skill, Corsair, Kingston, Crucial, TeamGroup; else the stick's own Speed). Warn with the XMP/EXPO/DOCP line and
  the board maker's support page.
- Devices with errors: Get-PnpDevice -PresentOnly with a problem code or Error status; CM_PROB codes in words; 45
  (ghost) skipped; 22 (turned off in Device Manager) is a note, not a warning.
- Recent crashes, 30 days: WER 1001 (stop code in words), Kernel-Power 41 without a stop code (unexpected shutdown;
  with one it is the same crash), WHEA-Logger errors. The System log reads without admin here.
- Restart waiting: CBS RebootPending or WU RebootRequired = "Restart to finish an update."; only
  PendingFileRenameOperations = a note (many programs set it).

## Measured on Shawn's PC (24 Oct 2026, read only)

- Displays: AG276QZD2 2560x1440 at 240 Hz (main), XV272U V 2560x1440 at 170 Hz; both at their top rate (no flag);
  both offer HDR, both off; Night light off.
- PC check: C: 280 GB free of 1.8 TB (15%); CT2000P3SSD8 healthy; driver 621.01 from 18 Oct 2026; RAM 3200 MT/s;
  four devices turned off in Device Manager (Realtek audio, Intel I211, Wi-Fi, Bluetooth); 1 crash on 14 Oct (0xBE,
  ATTEMPTED_WRITE_TO_READONLY_MEMORY) and 1 unexpected shutdown on 5 Oct; files waiting for a restart.

## Not done / to check

- No display change was made on a real screen (no writes to devices). The first real test should be a refresh-rate
  change on the second screen, pressing Undo, then letting one time out.
- The running DeviceHub needs a restart to serve the new routes (server.js and helpers/ load at start).
- Tests: `node tests/display-health.mjs` (in npm test and test:offline).
