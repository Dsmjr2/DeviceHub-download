# Handoff: smoother for friends (24 Oct 2026)

Four fixes from a friend's real help requests (Dsmjr2/DeviceHub-support #3-#16). His PC: Logitech PRO X2 SUPERSTRIKE on
LIGHTSPEED receiver C54D (logitech-hidpp-mouse), HyperX Cloud II Wireless 03F0:0696 (hyperx-cloud), Epomaker P75,
Gigabyte B450 AORUS PRO WIFI-CF, Corsair 7000D with an unknown fan hub. Nothing is committed.

## 1. Driver fixes the same day

**Root cause found:** the once-a-day fetch was only half of it. A library driver installed in `my-devices\<name>\`
was **never replaced** by a newer library version (`installFromLibrary` never writes over a folder). So the friend's
mouse kept the pre-`lghub_updater` driver even after DeviceHub itself updated.

- `helpers/library-updates.mjs`
  - `startup()`: at every start, **before the drivers load** (server.js, up to 4 s), then refreshes the copies. It notices
    a new DeviceHub version by itself (`appVersion` in `library-cache\state.json`) and logs the reason "app updated".
  - `afterAppUpdate({ root, log })`: exported for the update code; a check now plus the refresh. Not wired into the
    update code: `startup()` already covers the first start of a new version, so no edit to the auto-update agent's
    files was needed.
  - `checkSoon()`: `POST /api/library/update?soon=1`, used by a device page that shows a driver problem; not again
    within 10 minutes.
  - Every 3 hours (`checkIfDue`, was 24 h).
  - Cheap: the bundle's `ETag` / `Last-Modified` are kept and sent back. GitHub's release host answers 304 with no body
    (checked 24 Oct 2026 with curl, both headers). The headers are sent only when the cache still holds that bundle.
  - Signature checks are unchanged.
- `helpers/library-refresh.mjs` (new) `refreshInstalled()`: replaces a copy when the library entry is strictly newer.
  The old files go to `backups\library-drivers\<name>-<time>\`, `verified.json` moves out so the self-check runs again,
  and `settingsOn` stays. It never touches learned copies, copies with `learnedKeys`, a person's own drivers, an id
  change, a driver that does not load, or an own-driver clash.
- **Reload without restart: not done.** It is not safe: the loaded adapter holds its HID channel (`addSpec` at load), its
  lock and timers. Instead `my-devices.mjs` keeps the driver hash it loaded; `a.library.newerDriver` then reads
  "A newer driver is ready: it loads when DeviceHub restarts (tray icon > Quit, then open DeviceHub again)." It shows on
  the device page and in Get help. A check made before the update no longer counts (`guard`, `updatedFromLibrary.at`).
- Tests: `tests/library-updates.mjs` (304, 10-minute soon, 3 h, startup, app updated, hung start),
  `tests/library-refresh.mjs`.

## 2. Windows' admin box

`helpers/uac.mjs`: `UAC_LINE` ("Windows is asking for permission. If you don't see the box, click the shield icon
blinking on the taskbar, then Yes."), a 2-minute wait, `record()` into `logs\uac-prompts.log` (ignored by git; only the
running server writes the real one), and `recent()` for Get help.

- Board lights (`helpers/board-lights.mjs`): while waiting, the step is the line. The elevated script first writes a
  "started" file (so DeviceHub knows Yes was pressed) and exits at once when a "cancel" file exists. With no answer in
  2 minutes, DeviceHub writes the cancel file and stops waiting, so a late Yes changes nothing. The result carries
  `uac` and `retry`, and `boardView` offers **Try again**. PawnIO's installer gets the same treatment.
- Installers (`helpers/installers.mjs`): `deps.run` prints "started" once Start-Process returns (that only happens after
  the box is answered). With no answer in 2 minutes, the PowerShell tree is killed. In the UI
  (`public/ui/installer-button.js`) the loading bar becomes the line, and declined or not answered shows in place with
  Try again (no toast).
- Learn's listener (`startCapture`), Test my learning setup, and Equalizer APO's Device Selector (`eqapo-devices.js`,
  `eq-panel.js`, `setup.js`) show the same line and the same outcomes.
- **Limit:** for a maker's installer, a Yes pressed after the 2 minutes may still open that installer, because Windows
  keeps the box. Board lights is safe through the cancel file. Not tried against a real UAC box: no prompt was raised
  on this PC.

## 3. Everything in one Get help

`helpers/pc-picture.mjs` gathers the PC picture for every report, in every area (`get-help.mjs gather`):

- each USB device with its vid:pid, Windows name and mouse/keyboard usages;
- which driver claims it (own page, a library or learned copy, with its state, "settings not turned on" and "check
  not run: why"), or none and why (a library entry not installed, or none in the library);
- Bluetooth devices: only the kind each name implies ("a Bluetooth xbox"), never the name;
- the makers' apps running and installed;
- library drivers in use against shipped and cached, with `OLD` and "a newer one waits for a restart";
- the last library check;
- admin boxes not answered or declined;
- the last 20 device log lines.

Two versions are made: the GitHub link (`MAX_URL`) and Send to Shawn's (`RELAY_BODY` 11,500, under `relay/worker.js`'s
12,000 body and 16 KB total). Each is trimmed with the least useful parts going first: the device log down to 10
lines, plain USB devices folded, Bluetooth as a count, installed-only apps as a count, no device log, only claimed USB
devices. After that come the area's log lines, shorter findings, and finally a cut that says so. The existing
redaction runs over the whole picture. Tests: `tests/smoother.mjs` (fits both limits with 72 USB devices, OLD shown,
levels).

## 4. Learn a device

**Why it failed for his mouse and headset:**

- #10 / #11: the session ran on **25A7:FA70**, an unknown 2.4G receiver (most likely the P75's dongle), not on his
  mouse (C54D) or headset (0696). The maker's app was "not known", and DPI was changed in G HUB, which talks to C54D.
  So nothing went to FA70, and nothing checked the device or app before recording. #10 also had a double-pressed Done
  that hit a dead end (fixed before, b03ea48).
- #13 / #14: both of his devices already had ready drivers. Learn listed them only as refusals, while the real problem
  was the mouse's 9 read-only settings: first `lghub_updater.exe` counted as G HUB, then the **old driver copy that was
  never replaced** (part 1). Learn was the wrong place to send him, and nothing pointed him to Turn on settings.
- Under both: no pre-flight, no sign that anything was heard, and the result depended on the person judging recordings.

**Fixes** (`helpers/learn-wizard.mjs`, `helpers/learn-auto.mjs`, `public/pages/learn.js`):

- a. A device with a ready driver (`ready`: its my-devices copy, or a library entry that writes) is never learned.
  `begin` refuses with the driver's name and page. Its row in "Already works" has **Open its page** (Turn on settings
  is there) and **A setting is missing?**. That opens a recordings-only session (`capture: true`) listing only the
  settings the driver lacks.
- b. `preflight()` / `GET /api/learn/preflight` returns plain lines, each with one fix and a button:
  - capture driver: USBPcap installed and the last Test my learning setup passed (kept 30 days in
    `learn\last-check.json`);
  - maker's app installed (official link if not);
  - maker's app open (Open it);
  - right device: a settings channel, a mouse interface for mouse settings, a keyboard one for keyboard settings, a
    headset for headset settings.

  `act('listen')` and Learn it for me refuse to record until every line passes, and the page disables Start until then.
  Learn it for me now opens on a pre-flight card.
- c. The state carries `recording.heard`, polled every second while recording ("Heard N messages from the device. It is
  working."). `nothingCheck()` stops a recording that heard nothing in 10 s (`NOTHING_MS`) and says what to try: change
  it while recording, pick the receiver or cable the app talks to, or reopen the app.
- d. `helpers/learn-send.mjs`: at the end of a session (Learn it for me, done or failed; the manual queue; A setting is
  missing?) the recordings go through the relay as `support:learn:<vid>-<pid>:<n>`, with the ids, interfaces, maker
  app and messages per setting change. The page ends with "Sent. A driver is usually ready in a day: DeviceHub gets
  it by itself." When the full capture is too big, it sends only the messages that differ between a setting's
  recordings, then cuts to 24 bytes and 12 messages per recording, then sends counts only, and says what was left
  out (the recordings stay in `learn\wizard\`).
- Tests: `tests/smoother.mjs`, which covers the pre-flight lines, listen refused until the pre-flight passes, the
  nothing-heard stop, and the size of the send. Existing learn tests set `lw.options.preflight = false` for the steps
  after it.

## Not done, or check by hand

- Reloading a newer driver in place, which is not safe (see 1).
- A real UAC box was never raised here. The late-Yes case for a maker's installer remains (see 2).
- A full capture over the relay is limited to 12,000 characters, so most real sessions go compact.
- Shawn's side has no tool yet that turns a `support:learn:` issue into a driver.
- Restart DeviceHub to get the new server parts. The window's files are already new: until a restart, Learn's
  pre-flight route answers 405 on an old server.

## Wording (Shawn, 24 Oct 2026)

The Learn page and the pre-flight lines now use one short sentence each. The intro is "Learns a device's settings by
watching its maker's app. Sends nothing while learning." When there is nothing to learn, the page says "Nothing to
learn: every device here already works." with Look again and no step count. Two test assertions were updated for the
new wording (`tests/learn-auto.mjs`, `tests/smoother.mjs`).
