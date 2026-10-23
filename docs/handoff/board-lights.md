# Board, fan and RAM lights set up from DeviceHub (22 Oct 2026)

Shawn, 22 Oct 2026: "I want the app to be able to set it up and it currently cant." By his decision DeviceHub may now,
ONLY on the person's click, (a) install the official signed PawnIO driver and (b) run its bundled OpenRGB with the PawnIO
modules as administrator, so OpenRGB reaches the board's SMBus lighting. DeviceHub itself still never writes the SMBus or
a graphics card's I2C bus: OpenRGB does, as the person chose. Not committed; nothing of it has run on real hardware.

This replaces the earlier "Set up board lights" button (`helpers/installers.mjs` tool `boardlights`, which downloaded a
second, whole OpenRGB to `%LOCALAPPDATA%\Programs\OpenRGB` and made a task "DeviceHub OpenRGB"). That code is gone
(installers.mjs, tests/installers.mjs and ui/installer-button.js are back to before it): a task with highest rights that
runs an exe from a folder the user can write is a way for any program to get administrator silently. The new copy lives
where only administrators can write.

## What the person sees

- **Lighting > PC lights**: a "Board, fan and RAM lights" part (always, when OpenRGB is not running or runs as
  DeviceHub's USB-only copy, or board lights are set up), with one plain line, then **Add board, fan and RAM lights**.
  The line, PawnIO missing: "Installs PawnIO 2.2.0 (a signed driver, from its maker, checked first), then sets the
  OpenRGB inside DeviceHub to start as administrator when you sign in. Windows asks twice: once for PawnIO, once for
  OpenRGB. OpenRGB will then be allowed to change your board's lighting chip." PawnIO there: "... (PawnIO is already
  installed). Windows asks once. ..."
- While it runs: the step ("Downloading PawnIO_setup.exe (40%)", "PawnIO's installer is open ...", "Windows asks once
  ...", "Waiting for OpenRGB to find the board (up to 45 s)"). After: one plain result line (good or bad).
- Set up: "Board, fan and RAM lights are on: OpenRGB runs as administrator when you sign in." and **Remove board
  lights**, confirmed in place with "Stops it and deletes its task and copy: back to USB lights only. Windows asks once.
  PawnIO stays installed; to remove it, open Windows Settings > Apps > Installed apps, find PawnIO and choose Uninstall."
- **Fans page** (Fan lights card, when the lights sit on the SMBus or the reason is not known): the same control.
- **Setup**: a row "Board, fan and RAM lights", needs you when `/api/lights/diagnose` says `smbus` and it is not set up
  (the PC lights row for that case is then hidden, so it counts once); done when set up; its control is the same one.
- No pop-ups, notifications or tooltips. Demo mode shows a PC with board lights set up; its buttons change nothing.

## Sources (read 22 Oct 2026)

| What | Where | File | Size | SHA-256 / signer |
|---|---|---|---|---|
| PawnIO 2.2.0 (released 15 Mar 2026) | `https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe` (pawnio.eu's Download link is `.../releases/latest/download/PawnIO_setup.exe`; GitHub redirects to `release-assets.githubusercontent.com`) | `PawnIO_setup.exe` | 3,410,960 B | `1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032` (equals the digest GitHub's release API lists); Authenticode Valid, `E=admin@namazso.eu, CN=namazso.eu, O=namazso, L=Debrecen, C=HU`, issuer GLOBALTRUST 2015 CODESIGNING 1 |
| OpenRGB 1.1 PawnIO modules | inside the already pinned `OpenRGB_1.1_Windows_64_8e16de2.zip` (zip SHA-256 `63291726...a8172a`) | `LedsValve.bin` 43,796 B, `LpcIO.bin` 18,076 B, `SmbusI801.bin` 55,540 B, `SmbusIntelSkylakeIMC.bin` 19,828 B, `SmbusNCT6793.bin` 21,244 B, `SmbusPIIX4.bin` 42,404 B | | each pinned in `helpers/bundled-tools.json` `boardModules`; `SmbusI801.bin` also equals `dependencies/PawnIO/modules/SmbusI801.bin` in OpenRGB's source at `release_1.1` |

Shawn's PC: Windows lists "PawnIO" 2.2.0.0 (publisher namazso, `C:\Program Files\PawnIO\uninstall.exe -uninstall`) and
its service "PawnIO" (manual start), so the PawnIO step is skipped there.

Why the modules can ship safely next to the USB-only copy: OpenRGB loads a PawnIO module only from its own exe's folder
(`i2c_smbus/Windows/i2c_smbus_pawnio.cpp`, release_1.1: `GetModuleFileNameA` then `exeDir / filename`), so
`tools\openrgb\board-modules\` is never read by `tools\openrgb\OpenRGB.exe`.

Why a scheduled task: OpenRGB has no Windows service (its only service file is the Linux systemd unit
`qt/openrgb.service`; `--autostart-enable` starts it at login without administrator). A logon task with highest rights,
made once behind one admin prompt, is Windows' own way to start one program elevated at sign-in with no prompt each time.

## How it works (`helpers/board-lights.mjs`)

Add (POST `/api/board-lights/setup`, answered at once; the page follows GET `/api/board-lights/progress` every 1.5 s
only while that job runs):
1. Status first: PawnIO (Uninstall entry named exactly "PawnIO" or its "PawnIO" service), the task
   (`schtasks.exe /Query /TN "DeviceHub board lights"`), the protected copy, and every source file present. Already set
   up: says so and stops (no prompt). This copy without the modules: refused before anything.
2. PawnIO, only when missing: downloaded over HTTPS, redirects only to github.com / release-assets.githubusercontent.com
   / objects.githubusercontent.com (the same downloader as the optional tools), to `%TEMP%\DeviceHub-downloads\`; run
   only when Windows reads it Valid AND signed CN=namazso.eu, O=namazso AND it has the pinned SHA-256; then its own
   installer through `Start-Process` (its manifest asks Windows' admin prompt; no silent switches); then PawnIO must show
   as installed. The download is deleted either way.
3. DeviceHub's own USB-only OpenRGB is stopped (two OpenRGBs must not share the USB lights).
4. ONE admin prompt: `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile',
   '-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$env:DH_SCRIPT -PassThru -Wait` (the script is passed
   encoded through an environment variable, never as a file anyone could swap). The script (`setupScript()`):
   - removes any old task and stops only an OpenRGB.exe running from the protected folder, then replaces the folder;
   - copies `tools\openrgb\*` (the 16 kept files) and `tools\openrgb\board-modules\*.bin` (6) into
     `C:\Program Files\DeviceHub board lights\OpenRGB\` (flat beside OpenRGB.exe, as OpenRGB expects) and checks every
     copied file there against its SHA-256 from bundled-tools.json (after the copy, where only administrators can change
     it); its settings folder is `C:\Program Files\DeviceHub board lights\config` (also admin-only, so nobody can drop an
     OpenRGB plugin into the elevated copy);
   - registers the task:
     ```
     $a  = New-ScheduledTaskAction -Execute 'C:\Program Files\DeviceHub board lights\OpenRGB\OpenRGB.exe' -Argument '--server --server-host 127.0.0.1 --server-port 6742 --noautoconnect --config "C:\Program Files\DeviceHub board lights\config"' -WorkingDirectory 'C:\Program Files\DeviceHub board lights\OpenRGB'
     $tr = New-ScheduledTaskTrigger -AtLogOn -User '<DOMAIN>\<user>'
     $pr = New-ScheduledTaskPrincipal -UserId '<DOMAIN>\<user>' -LogonType Interactive -RunLevel Highest
     $st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
     Register-ScheduledTask -TaskName 'DeviceHub board lights' -Description '...' -Action $a -Trigger $tr -Principal $pr -Settings $st
     Start-ScheduledTask -TaskName 'DeviceHub board lights'
     ```
     The user is the one DeviceHub runs as (`USERDOMAIN\USERNAME`), so a standard user typing an admin's password still
     gets the task for themselves. Interactive logon: no password is stored.
   - on any error it unregisters the task it made, stops that OpenRGB and deletes the folder, writes `failed|<why>` to
     `%TEMP%\DeviceHub-downloads\board-lights-result.txt` and exits 3.
5. Read back: the task and the copy must be there; then the SDK server on 127.0.0.1:6742 is waited for once (45 s at
   most). The result line says what happened. A failure after PawnIO was installed in the same click says PawnIO stays
   (it is the maker's own install, inert without administrator, and undoing it would need another prompt) and how to
   remove it.

Remove (POST `/api/board-lights/remove`): nothing set up, nothing asked. Otherwise one admin prompt runs
`removeScript()`: stop the task, stop only the protected copy's OpenRGB.exe, `Unregister-ScheduledTask`, delete
`C:\Program Files\DeviceHub board lights\`. Read back: both gone. PawnIO is never touched.

In `helpers/openrgb.js` (board-lights mode, when the protected OpenRGB.exe exists): DeviceHub never starts the USB-only
copy; when lights are used (Find lights, a colour, Undo) and 6742 does not answer, it runs `schtasks.exe /Run /TN
"DeviceHub board lights"` (the person's own task: no prompt) and knocks 50 x 300 ms, once. An ordinary read never runs
it. Through it every light is listed and written like a person's own OpenRGB: backed up first, read back, DeviceHub's
own devices left out of "all", and an OpenRGB built before 1.1 refused (the protected exe is the fallback the build check
reads when Windows does not name an elevated process's file). `status()` adds `board: { setUp }`;
`helpers/lights-diagnose.js` names it and stops giving the SMBus advice once it is set up.

Never at DeviceHub's start: server.js imports board-lights.mjs only inside its `/api/board-lights` route; it has no timers
or hooks; the only waits are the 45 s server wait after a click and openrgb.js's 15 s start check on use.

## Files

| File | What |
|---|---|
| `helpers/board-lights.mjs` (new) | status, the PawnIO step, the two admin scripts, setup/remove jobs, the route |
| `public/core/board-lights.js` (new) | what the control shows (pure; tested in Node) |
| `public/ui/board-lights.js` (new) | the control: line, button, step, result, Remove confirmed in place |
| `helpers/openrgb.js` | board-lights mode: `BOARD`, `forget()`, `deps.boardSetUp/runTask`, never the USB-only copy beside it |
| `helpers/bundled-tools.json`, `helpers/fetch-bundled.mjs`, `helpers/make-installer.ps1` | the six modules kept in `tools/openrgb/board-modules/` only (pinned; a .bin anywhere else under tools/ fails the zip check; `.sys` still never) |
| `helpers/lights-diagnose.js` | SMBus advice now points at the button; names the board-lights OpenRGB |
| `public/pages/pc-lights.js`, `fans.js`, `setup.js`, `public/core/setup-list.js` (`boardRow`) | the control in the three places |
| `server.js` | the route, and an isolated-mode answer |
| `helpers/installers.mjs`, `tests/installers.mjs`, `public/ui/installer-button.js` | the earlier `boardlights` tool removed |
| `tests/board-lights.mjs` (new), `tests/bundled-tools.mjs`, `tests/lights-diagnose.mjs` | offline tests; in `npm test` and `test:offline` |
| CLAUDE.md, README.md, docs/handoff/bundled-tools.md, JOURNAL.md | the rule and the decision |

In this working copy (the one running on 5577), the six modules were copied, hash-checked, from `bundled-cache` into
`tools\openrgb\board-modules\` (ignored by git), so after a DeviceHub restart the button works here too; a built zip
carries them by itself.

## Tests

`node tests/board-lights.mjs` (one "all good" line): the pinned PawnIO source and hosts; both admin scripts checked line
by line (remove exactly), quoting of a path and a user name with an apostrophe, hash after copy, back-out in the catch,
only the protected copy's process stopped, no service / registry / download in them; the RunAs command; stand-ins for
the download, signature, hash, installer, admin prompt, task and SDK server: happy path (one download, PawnIO's own
installer, one prompt, USB-only copy stopped, download deleted), PawnIO already installed (skipped), already set up (no
prompt), a refused download (other signer, unsigned, look-alike signer, broken signature, other file, off-host redirect:
never run), PawnIO's prompt declined or nothing installed (stops, no admin prompt), the admin prompt declined, failed
inside (its reason, nothing left, PawnIO named) or leaving a part (Remove offered), a server slow to answer, a copy
without modules (refused first), Remove (one prompt, PawnIO line; declined; nothing to remove; not finished), one job at a
time (409) and the routes; server.js loads it only in its route and it has no timers; the control's views and the Setup
rows (needs once, done when set up, none for USB lights); openrgb.js in board-lights mode (an ordinary read never runs the
task, Find lights runs it once and never starts the USB-only copy, a task that does not start is said).
`npm run test:offline` passes.

## Not tested on hardware (first real click on Shawn's PC)

- The admin prompt really appearing once, the script running elevated, `Register-ScheduledTask` accepting
  `SHAWNS-PC\shawn` (checked only by building the task in memory with `New-ScheduledTask` / `Export-ScheduledTask`, never
  registered), and the result file being written.
- OpenRGB 1.1 started by the task with `--server` and no `--gui`: whether any window or tray icon shows (none expected),
  whether it loads the modules from beside the exe as administrator, and how long it takes before 6742 answers.
- `schtasks /Run` of the task from DeviceHub's ordinary (non-elevated) process, with no prompt (Windows' usual behaviour
  for a task the user owns).
- What OpenRGB then finds on the Gigabyte B450 AORUS PRO WIFI-CF (RGB Fusion over SMBus), and colours / Undo through it.
  Gigabyte RGB Fusion must be closed.
- PawnIO's installer on a PC without PawnIO (Shawn's PC already has 2.2.0.0), including what exit code it returns.
- Remove: the task and folder gone, the board keeping its last colour.
- DeviceHub must be restarted to load the new route (the running copy on 5577 was not restarted).
