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

CPU temperature and fan speeds need LibreHardwareMonitor: added on the person's click (next section).
Without it, the card lists them as "not read" with the Add button.
Drive temperature and wear (Get-StorageReliabilityCounter) need administrator; not mentioned on the card.
ACPI zones that are not real readings (below 20 °C or above 110 °C) are no longer shown.

## CPU temperature and fan speeds (helpers/cpu-sensors.mjs, cpu-sensors-read.js, cpu-sensors-reader.cs)

Shawn said yes on 24 Oct 2026.
Read only: nothing in it can change a fan speed or any setting.
The button "Add CPU temperature and fan speeds" is on the Temperatures and fans card (public/ui/cpu-sensors.js).

Setup, on the click only (POST /api/cpu-sensors/setup, progress at GET /api/cpu-sensors/progress):
1. PawnIO 2.2.0 if missing: the board lights' own signed, hash-checked install (board-lights.mjs installPawnIO, now exported).
2. LibreHardwareMonitor v0.9.6 `LibreHardwareMonitor.zip` from its GitHub release, 6,632,626 bytes,
   SHA-256 `086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001` (the digest GitHub lists; pinned).
   A mismatch deletes it and nothing is elevated.
3. One admin prompt (board-lights.mjs elevateWatched, now exported: the same UAC line, Try again and prompt log):
   checks the zip hash again, extracts only 9 library DLLs (each SHA-256 pinned in FILES) into
   `C:\Program Files\DeviceHub sensors\`, copies the reader source (`reader.cs`) there and checks its hash, writes
   `reader.ps1` (cpu-sensors.mjs readerScript) there and checks it, and registers the task "DeviceHub sensors":
   this user, S4U (no password stored, runs without a window), highest rights, no trigger, 4 h at most, one at a time.
   Any failure undoes all of it. LibreHardwareMonitor.exe is never extracted or run.

No .exe of ours (24 Oct 2026: Shawn's AppControl notifies on every unsigned .exe that starts, on friends' PCs too):
- The task runs Windows' own signed `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File reader.ps1`.
- reader.ps1 uses .NET calls only, no cmdlets, so nothing from the person's own PowerShell modules or profile loads into
  the elevated host. It checks the SHA-256 of all 9 DLLs and `reader.cs` again (exit 5 on any mismatch, nothing
  loaded), loads the DLLs, compiles `reader.cs` in memory from the very bytes it checked (CodeDom, the compiler
  Add-Type uses; it calls Microsoft's signed csc.exe), and calls `DeviceHubSensors.Start(folder, want)`.
- The 9 LibreHardwareMonitor DLLs are not Authenticode-signed; they are loaded, not started, so AppControl's .exe
  notice should not fire. Not checked against AppControl itself.
- The encoded setup script is about 20 KB on the command line (board lights' is 16 KB through the same path; the limit
  is 32 KB).

Reading (the lowest-CPU choice):
- The task has no trigger, so nothing runs at sign-in or in the background.
- While the card is on screen, each GET /api/temps touches `%TEMP%\DeviceHub-sensors-want.txt` and, if
  `readings.json` is not fresh, starts the task (`schtasks /Run`, at most once per 15 s; no prompt, since the task has
  highest rights).
- The reader opens LHM for the CPU and the motherboard only (no RAM SMBus, GPU, storage or USB controllers), writes
  temperatures and fans to `readings.json` in its own folder every 2 s, and exits 20 s after the want file was last
  touched, deleting readings.json. It only reads the want file's time, never its contents.
- Measured here without admin, 30 s with the want file kept fresh, the old exe against the PowerShell host:
  | | exe (dropped) | powershell.exe host |
  |---|---|---|
  | first reading | 0.5 s | 1.0 s |
  | CPU to the first reading (start, checks, compile) | 47 ms | 203 ms |
  | CPU from 10 s to 30 s | 0 ms (under the timer's 16 ms step) | 0 ms |
  | memory, peak / at 30 s | 28 / 26 MB | 74 / 71 MB |
  | exit after the want file went stale | 0.5 s | 1.3 s |
  So the host costs about 150 ms more CPU once per visit and about 45 MB more while the card is open; nothing after.
  As administrator the reads will cost a little more (it reads the chips for real then).
- A changed `reader.cs` in the folder: exit 5, nothing written (tested).
- Why not LHM's own web server: it is part of LibreHardwareMonitor.exe, which polls every sensor all the time while it
  runs and has fan control in its window; the reader runs only while someone looks.

Card: CPU package, CPU cores hottest, each board fan by name in RPM (0 RPM headers counted in one line), named board
temperatures (System, VRM MOS, ...; "Temperature #n" chip inputs are left out). AMD: Tctl/Tdie as package, the hottest
CCD as cores. Intel: CPU Package and Core Max.

Remove (POST /api/cpu-sensors/remove): one prompt stops the reader and deletes the task and the folder; DeviceHub
deletes the want file. Nothing else was changed. PawnIO stays.

Tested here, from the scratch folder, without admin: the zip's hash; the 9 DLLs and their hashes; reader.ps1 (the same
text, its folder line pointed at scratch) under powershell.exe: hashes checked, compiled in memory, it found
"AMD Ryzen 7 5800X3D" and "Gigabyte B450 AORUS PRO WIFI-CF" but read 0 °C and no fan chip, as expected without
administrator; the setup, remove and reader scripts parse. Not tested: the admin prompt, the task (S4U, no window),
`schtasks /Run` as a standard user, AppControl's reaction, and real readings as administrator. Not installed on
Shawn's PC.

## PC check (helpers/pc-check.js, helpers/pc-check.ps1)

Layout (24 Oct 2026, Shawn): the whole PC page fits 1650x950 with no scroll (measured in demo mode, also with CPU sensors
set up and the fine list open: 864 px). The graphics card runs down the left; the PC check spans the two right columns
under Fan lights and Temperatures. In the check, warnings, notes and the graphics driver are short cells in two columns;
everything fine is one line ("Free space, drive health, devices, crashes, restart: all fine.") that opens to a
three-column list. One column at phone width.

Graphics driver link: helpers/pc-check.ps1 finds the NVIDIA App ("NVIDIA App.exe") or AMD Software
("RadeonSoftware.exe") from its Start menu shortcut (all users, then this user), else its usual Program Files folder;
only an exe with that name under Program Files counts. The row then says "Open NVIDIA App" and POST
/api/pc-check/open-app {app} starts only the exe the last check found (checked again: name, Program Files, no "..",
still there). Not found: the maker's driver page as before. On Shawn's PC: found through the shortcut.

Removed (Shawn: "none of those are necessary"): unexpected shutdowns (Kernel-Power 41 is no longer read), the drive
"needs administrator" note, and devices turned off in Device Manager (problem 22).


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
  (ghost) skipped; 22 (turned off in Device Manager) is not shown.
- Recent crashes, 30 days: WER 1001 (stop code in words), and WHEA-Logger errors. The System log reads without admin here.
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
- Tests: `node tests/display-health.mjs` and `node tests/cpu-sensors.mjs` (in npm test and test:offline).
- CPU sensors: the first real test is Add on Shawn's PC (one prompt, then readings within about 10 s), then Remove.
- The running DeviceHub needs a restart for the new routes (/api/cpu-sensors, /api/pc-check/open-app).
