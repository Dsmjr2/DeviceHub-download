# Learn it for me (23 Oct 2026)

Shawn: "limit the clicking ... have them connect and wait for the app to learn the device with minimal clicking".

**Clicks:** Learn it for me (or Setup's Learn it for me), Yes on Windows' prompt, and at the end Close <app> and turn
on settings. Everything between runs by itself when the maker's app lets DeviceHub change its settings (app-ui). When
it does not, the page says the one change to make ("Set Polling rate to 1000 Hz in iCUE now.") and DeviceHub notices
the change in what it hears, with no Done to press ("I changed it" is there in case it does not notice).

`helpers/learn-auto.mjs` runs the session on the server through the wizard's own steps (`act`), so every rule of
Learn a device holds (read-only toward the device while learning, only bytes heard are ever sent, refused vendors,
never firmware/reset/pairing). Its order:
1. the device (refused vendors stop here with Request support);
2. the plan: the maker's app and the ticked settings (up to 6; readings are left to the wizard's own steps);
3. the maker's app opened when installed and closed (`openMaker` in helpers/learn-apps.mjs: Windows' own Start menu
   list, `Get-StartApps`, the entry named like the app and never an uninstaller/updater, started through
   `shell:AppsFolder`). Not installed: it stops and names the app and its page;
4. listening (one Windows prompt);
5. each setting: driven through app-ui when possible (the app's own slider range goes into the driver), else asked.
   The change is noticed by `novel()`: the first 1.2 s of a recording are the baseline (each command's bytes and the
   positions that move by themselves, e.g. lighting frames, battery polls); a new command, or a known one with a byte
   that never moved, is the change; 1.5 s without more ends the recording. Nothing within 30 s of the first ask: the app
   probably showed that value already, so the order is swapped once. 2 minutes: the setting is skipped;
6. the driver saved (title and kind from the device); numbers get the app's range, else the usual one (RANGES), else
   what was recorded;
7. Close <app> and turn on settings (the person's click): diagnose's close-app, wait for the device to connect to its
   new driver, then the agent's turn-on (each setting written with its current value and read back).

Untried on a real PC: whether USBPcapCMD's file can be read while it records (the notice needs it; "I changed it"
works either way), and Get-StartApps names for each maker's app.
Tests: tests/learn-auto.mjs (a pretend mouse, app, listener and person), demo mode on the page (`?demo#/learn`).
