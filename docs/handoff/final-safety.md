# Final safety audit, 22 Oct 2026

Eleven findings, each fixed with the smallest change and a test. `npm run test:offline` passes. Nothing was committed,
DeviceHub was not restarted, no node was killed, `helpers/bin/DeviceHubHelper.exe` was not replaced (the C# was compiled
to a TEMP exe with build.ps1's exact sources, then deleted) and nothing was sent to a device. No
`device-library/*/device.mjs`, `public/pages/keyboard.js`, `public/pages/learn.js`, `helpers/declarative-driver.mjs`,
README.md, ADD-YOUR-DEVICES.md, CLAUDE.md or other docs were edited.

## 1. The maker's app before every guarded write

`helpers/my-devices.mjs` `guard()`: `a.write` now runs `makerAppOf` (the driver's `vendorApp()`, then DeviceHub's own
`tasklist` list by vendor id) before EVERY write of a library or learned driver, not only during the self-check. An
open app refuses the write (`waiting: true`, "... is running: close it first"); "could not check" refuses it too. Only a
"none open" answer is kept, for `MAKER_CACHE_MS` (15 s); an open app or "could not check" is asked again on the next
write. Learned (driver.json) drivers are guarded drivers, so they get the same check; DeviceHub's own list covers the
drivers whose tasklist answers "no app" when it fails. Profiles and battery care write through the same guarded write.
Test: `tests/my-devices.mjs` (final audit block).

## 2. Only a "tested" share is a real-device record; no write before its check passed

- `share-device.mjs` writes the share's `status` into each new `tested` record.
- `realRecord(t, status)`: a record counts only when its own status (or, for an older record without one, the entry's)
  is "tested", and its `how` does not say "settings read, nothing written" / read-only. A read-only share therefore
  never skips Turn on settings. `hasRealRecord(meta)` passes the entry's status.
- `writeAllowed`: a setting writes only once ITS self-check passed (`ok: true`), whatever the entry's status; a
  waiting or never-checked setting of a "tested" entry is refused too.
- Tests: `tests/my-devices.mjs`, `tests/device-library.mjs` (share with --status read-only; installNote),
  `tests/auto-setup.mjs` (a tested entry with a real record writes nothing before its check, then writes). The test
  fixtures that model a proven read-only entry now carry `status: 'tested'` in their record.

## 3. A hand-made my-devices driver on one of DeviceHub's own ids

`loadOne`: a driver without `library.json` whose declared ids (`hid`, top-level vid / pids, a `device.json` beside it)
overlap `pc-map.js` RUNS is not loaded: "not loaded: 1b1c:0a6b is a USB id DeviceHub's own driver already runs (the
mouse, headset or keyboard page), and two programs driving one device fight". No channel, no page. Library drivers keep
the existing guard. Test: `tests/my-devices.mjs`.

## 4. What library code may reach

- New `tests/library-guard.mjs` (in `test` and `test:offline`): every `device-library/*/device.mjs` and
  `my-devices/*/device.mjs`, comments stripped, may import only `../../public/devices|core/*.js`, `node:child_process`
  (execFile of `'tasklist'` only; no spawn / exec / fork / sync calls) and `node:module` (createRequire only as
  `createRequire(import.meta.url)('../../helpers/native.js')`, allowed for corsair-bragi-headset and
  corsair-bragi-peripherals only). No fs, no file writes, no eval / process.binding. The checker is tested on bad
  samples too. All 17 shipped files pass.
- The Corsair drivers' own channels (`hs80:<pid>:<ep>:bragi[...]`): new `helpers/bragi-guard.js`, asked by
  `helpers/native.js request` first for any channel with the `bragi` tag, before the helper starts or a line is
  written. Only OPEN, CLOSE, FRAME and one GET / SET go on; each GET / SET is turned into the bytes hs80io.cs would send
  ([ep] [02 get / 01 set] [id] [00] [value LE]) and matched against the Corsair never entries: GET / SET of 05
  (pairing id), 06 (encryption key), 14-16 (bootloader and radio firmware paths), and SET 03 = 4 (sleep now). A refusal
  answers `ERR <why>` and logs `[never] ...`. DeviceHub's own HS80 channels carry no `bragi` tag and are never checked.
  native.js is read as text in the test (loading it could start the helper).

## 5. The never list: a route's own page, and VIA entries for VIA makers on "any page" channels

- `helpers/hid-host.mjs` `sendNow`: a routed report is checked against its route's own page (`routes[id].page`, else
  the parent's), before the route's collection is opened; `checkNever(id, bytes, page)`. Before, the parent's page was
  used, so a report routed to an FF00 collection of an FF60 channel was refused and one routed to FF60 was only caught
  after opening.
- `helpers/never-guard.mjs`: `VIA_MAKERS = ['3434', '342D']` (Keychron, Epomaker). On a `page: '*'` channel of those
  vendors the VIA (FF60) entries apply. Only library / my-devices channels are ever checked; the P75's built-in channel
  is unchanged and unchecked (hid-core section 8 proves its bytes).
- Test: `tests/hid-core.mjs` section 8 (matcher, a Keychron '*' channel, both route directions).

## 6. Self-test does not start OpenRGB

`public/pages/settings.js`: the PC lights check reads `/api/openrgb` (no `?fresh=1`, which starts the bundled
OpenRGB). Test: `tests/final-safety.mjs`.

## 7. git never prompts

`helpers/self-update.js` gets `GIT_ASKPASS: ''`, `SSH_ASKPASS: ''`, `GIT_SSH_COMMAND: 'ssh -o BatchMode=yes'`;
`helpers/settings-sync.js` gets the `GIT_SSH_COMMAND` too. Test: `tests/final-safety.mjs`.

## 8. The installer poll ends

`public/ui/installer-button.js` `follow()` (now exported, with injectable wait / now / api for the test) stops after
`FOLLOW_MS` (10 minutes) or `FOLLOW_ERRORS` (5) failed reads in a row, answering `{ ok: false, text }` so the button
shows "Not installed" with a line pointing to Windows Settings > Apps. A successful read resets the error count. Test:
`tests/final-safety.mjs`.

## 9. Get help: the whole path, and Bluetooth names

`helpers/get-help.mjs` `strip`: everything after `C:\Users\<name>` becomes `%USERPROFILE%\<path>` (folder names with
spaces while another `\` follows; a last name with spaces when it ends in `.ext`; a path part never holds `: * ? < > |`);
`/Users|home/<name>/...` likewise. Log lines lose Bluetooth device names: `dropBluetooth(lines, names)` puts
`<Bluetooth device>` for each name in std-battery's cached list (`deps.bluetooth` in tests); when that list cannot be
read, every log line mentioning Bluetooth is left out. Test: `tests/get-help.mjs`.

## 10. DeviceHub's own HS80 refuses the other headsets' SETs and the library tag

`helpers/native/hs80io.cs` `Hs80Io.Hs80OwnRefusal(name, verb, id)` (pure, so the harness tests it) and
`helper.cs` `HandleHs80` asking it before the OPEN switch: on an HS80 product id (0A69 / 0A6B / 0A71), SET 0d / 46 / 47
and any channel with a `bragi` part (except CLOSE) answer `ERR ...`; nothing is opened or sent. CRLF kept in both files.
The HS80's own requests are unchanged: `tests/native/hs80-frame.cs` section 6 checks every verb and id its channels use
(`wired1`, `receiver2`, `rx`, ...) still passes, plus the existing word-for-word frame checks (1,201,289 checks, all
good); `tests/hid-core.mjs` section 9 checks HandleHs80 asks it first and that hs80-direct.js / receiver-light.js only
ever set 02, 03 and 0e and never use the tag. The full helper compiled to a TEMP exe with build.ps1's sources (exit 0).
The running DeviceHub rebuilds its helper on its next start (helper.cs is newer than the exe).

## 11. The headset list while the HS80 runs

`public/devices/headset-adapter.js` `hs80Pick()`: with nothing picked (or the HS80 picked) the 30 s USB headset list is
skipped; it is read once (capped 3 s) so the Headset page's picker can still show a second headset. A headset plugged
in later shows in the picker after the next reconnect. Test: `tests/regressions.mjs` (no pick: one read, not one per
30 s).

## Lines for CLAUDE.md (for the docs owner)

- "Every write of a library or learned driver asks for the maker's app first (kept 15 s when none is open); an open
  app or 'could not check' refuses it."
- "Only a record shared with status tested counts as a real-device record; no library setting is written before its
  own self-check passed."
- "A my-devices driver on an id in pc-map.js RUNS is not loaded."
- "The Corsair library drivers' bragi channels pass helpers/bragi-guard.js (in native.js); the HS80's own helper path
  refuses SET 0d / 46 / 47 and the bragi tag."
