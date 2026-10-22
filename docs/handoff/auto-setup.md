# Handoff: auto setup, the library self-check and the setup summary (22 Oct 2026)

Goal: on a stranger's PC DeviceHub sets itself up with almost no prompting. Library drivers for the PC's devices are
installed by themselves, start read-only, and open each setting once it has proved itself on that device.

## What was built

```
helpers/my-devices.mjs     + guard(), selfCheck(), writeAllowed(), needsCheck(), firmwareOf(), loadNew()
helpers/device-library.mjs + readOnly option on match() / installFromLibrary(); every install writes library.json
helpers/auto-setup.mjs     new: run() (install), startup() (server start), summary(), dismiss(), asText()
helpers/setup-report.mjs   new: node helpers/setup-report.mjs [--json], the summary for Claude Code
server.js                  GET /api/setup, POST /api/setup/dismiss, /api/library* take read-only entries,
                           one marked line after "[agent] running" (AUTO SETUP)
public/pages/overview.js   the "Set up" card (setupCard), above the device tiles
tests/auto-setup.mjs       offline test, TEMP folders and pretend drivers only
```

## Library drivers: loaded guarded

An install (`installFromLibrary`, `POST /api/library/install`, or auto setup) copies `device.mjs` + `device.json` into
`my-devices/<name>/` and writes `library.json`: `{ source, name, id, status, installedAt, devicehub, libraryTested,
libraryDevicehub }` (nothing about the PC or the person). `my-devices.mjs` `load()` wraps any folder that has it:

- **status "read-only"** (or "untested", which does not install by itself): every write is refused
  (`<key> is read-only: ...`) except settings that passed the self-check.
- **status "tested"**: writes as before, except a setting whose self-check FAILED, which turns read-only.
- Each setting gets `readOnly: true/false` and its `hint` says "Read-only: ..." with the reason (the my-device page
  shows the hint; it does not yet grey the control: a refused write shows as "not changed: ... is read-only").
- Folders without `library.json` (the person's own drivers) load exactly as before.

## The self-check rules

Runs inside the driver's `connect()` (so under the core's device lock: nothing else touches the device meanwhile),
after a successful connect, when `needsCheck()` says: never checked, a setting never checked, the firmware changed
(`info()` fields whose name has "firmware" / "fw"), or firmware became known. Same firmware: never again.

1. Never on the built-in slots (`mouse`, `headset`, `keyboard`) or on a `hid` vid:pid (or `cablePid`) DeviceHub's own
   drivers run (`helpers/pc-map.js` RUNS).
2. Reads `info()` and `read()`, then takes a backup through the agent's `/api/backup` (the same as every change; the
   backup has `rawBackup()` when the driver has one). No backup = nothing written, one Activity line says so.
3. For each setting, one at a time: read the current value just before; skip (not written, stays read-only) when the
   driver marks it `selfCheck: false`, the device did not report it, or the value is not one the setting takes (outside
   a slider's range, not a choice's option, not a boolean); else write THAT SAME value, read back.
   Pass = the driver confirmed the same value AND the read-back is the same.
4. A value that moved: the value read just before is written back once, the result recorded (`putBack`), and the
   self-check STOPS: every later setting is "not checked" (stays read-only). A read that fails also stops it.
5. Each step has a 10 s limit; a step that runs over counts as failed.
6. `my-devices/<name>/verified.json`: `{ checkedAt, firmware, driver, status, source, keys: { <key>: { ok, value,
   readBack, why?, putBack? } } }`. One Activity line: `<title>: library self-check (<firmware>): N of M settings wrote
   and read back (...); K stay read-only: <label> (<why>); ...` (kind good / info / bad).

**For library authors:** mark a setting `selfCheck: false` when writing its own value is not harmless (it reloads a
profile, switches a mode, restarts the device). `logitech-hidpp-mouse`'s `mode` ("Settings source") is a candidate.

## Auto setup

`startup({ root, pcMap, log })` runs once per DeviceHub start (the one line in server.js; skipped with
`DEVICEHUB_TEST=1`, `DEVICEHUB_AUTO_SETUP=0` or settings.json `"autoSetup": false`). It reads `/api/pc`'s USB list
(fresh) and the VIA keyboards, then `run()`:
- every library entry matching a USB device (vid + any pid), status "tested" or "read-only", is installed, except:
  already in my-devices (never overwritten), every matched device is one DeviceHub already runs (`runs`, or a VIA
  keyboard), or setup.json says it installed it before (the person removed it: never again);
- "untested" entries are only offered (listed in the summary);
- installed drivers are loaded at once with `loadNew()` (my-devices.mjs keeps the start's callbacks) and connected,
  so their self-check runs right away; if that is not possible the Activity line says "restart DeviceHub to load it".
- `setup.json` (DeviceHub's folder): `{ version, firstRunAt, lastRunAt, devicehub, installed: [{ name, product,
  status, usb: ['vid:pid'], id, at }], lastRun: { installed, offered, skipped }, dismissed }`. Library names, statuses
  and USB ids only; no USB names, user names or serials.

On Shawn's PC (checked 22 Oct 2026 against the live read-only APIs): no library entry matches, nothing installs, and
the summary has nothing to say (`show: false`), so no card.

## The API

- `GET /api/setup[?fresh=1]` -> `{ show, signature, found, installed[], works[], optional[], learn[], setup }`, each
  item `{ what, line, name?/usb? }`. Kept a minute. `works`: built-in devices this PC has, VIA keyboards (not the ones
  a built-in runs), DDC/CI monitors, webcams, Bluetooth batteries (name and percent only), LampArray lights, library
  drivers with their verified / read-only settings. `optional`: Equalizer APO (not installed), OpenRGB (not running).
  `learn`: library entries that did not install by themselves, and USB devices from a mouse/headset/keyboard/case
  brand in docs/brands.json that nothing runs (Bluetooth adapters, hubs, storage, cameras left out), with its brand
  sheet when there is one. `show` = something needs attention (an install, a driver not fully verified, something to
  learn) and it is not the dismissed signature.
- `POST /api/setup/dismiss { signature }`: hides the card until the summary changes (kept in setup.json).
- `GET /api/library` now passes `readOnly: true` (read-only entries are `installable`, with a `note`);
  `POST /api/library/install` installs read-only entries too and loads the driver at once (`loaded`), else the note
  says to restart.
- `node helpers/setup-report.mjs [--json]`: the same summary in words, with "Next:" saying what to do; with DeviceHub
  not answering (or older than /api/setup) it says so and reports from its files only.

## What to wire (not done: those files are not mine)

1. **package.json**: add `node tests/auto-setup.mjs` after `node tests/device-library.mjs` in `test` and
   `test:offline`.
2. **.gitignore**: add `setup.json` (this PC's own record; it is not in git now and would show as untracked).
3. **CLAUDE.md**, "Set this up", a new first line of step 2:
   `- **First, the setup summary:** \`node helpers/setup-report.mjs\` (or GET /api/setup?fresh=1). DeviceHub has
   already installed every matching library driver (read-only until each setting passes its self-check on connect;
   my-devices/<name>/verified.json) and lists what works, what is optional and what is still to do. Do only what it
   lists under "Still to do", in that order, then offer what is under "Optional".`
   And in "Adding your own devices" step 2's library bullet: `A "read-only" entry installs by itself (auto setup) and
   self-checks each setting on first connect (read, write the same value, read back); a setting that can not take its
   own value harmlessly gets selfCheck: false in its settings entry.`
   Map: `helpers/auto-setup.mjs  installs library drivers at start, the setup summary (/api/setup, setup-report.mjs)`.
4. **public/pages/my-device.js** (optional): grey a control whose setting has `readOnly: true`, instead of letting
   the write fail.
5. Restart DeviceHub to load the new server code (not done here, per the job's rules).

## Tested / untested

- `node tests/auto-setup.mjs` -> `auto-setup (library self-check, auto install, setup summary): all good` (refused
  writes before the check, backup first, only the value read just before is written, a moved value put back and the
  check stopped, selfCheck: false honoured, verified.json, Activity line, no re-run on the same firmware, a re-run on a
  new one, tested-entry failure turns read-only, never on a built-in USB id or slot, nothing without a backup; auto
  install of tested + read-only, untested offered, a device DeviceHub runs skipped, existing folder kept, removed
  driver not reinstalled, off switch, live load + connect; summary sections, card shown / dismissed / shown again, a
  PC like Shawn's gets no card).
- `tests/my-devices.mjs`: all good. `tests/device-library.mjs`: all good on a copy with only the shipped example;
  on the live folder it currently fails "every shipped library entry is well formed" because the entries other jobs
  are still writing (asus-rog-mouse, razer-mouse, steelseries-arctis) have an empty `tested` list. `tests/check.mjs`:
  all good (it sees the new files once they are committed).
- NOT run: the new routes and the startup line inside a running DeviceHub (it was not restarted), the Set up card in
  a window, `loadNew()` inside the real agent (registering a device after start: the window may need a reload to show
  its sidebar entry), and any self-check on a real device (none installed here; the first one will be on a real PC).
