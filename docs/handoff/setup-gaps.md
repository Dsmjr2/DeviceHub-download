# Setup gaps closed, 22 Oct 2026

A cold read found six places where a new person got stuck without Claude. All six are fixed. `npm run test:offline`
passes. Nothing was committed; DeviceHub was not restarted. Shawn's Pulsar, HS80 and P75 paths are unchanged: they
are never self-checked (the `ownDevice` guard in `helpers/my-devices.mjs` is as it was).

## 1. Logitech: Settings source and onboard mode

- `device-library/logitech-hidpp-mouse/device.mjs`: `mode` ("Settings source") no longer has `selfCheck: false`. It
  gets the normal check: read the mode, write that same mode, read back. Onboard stays onboard and host stays host,
  so the check never switches the mouse.
- In onboard mode, DPI, report rate and lift-off throw an error with `waiting: true`. The same goes for the G HUB
  refusal.
- `helpers/my-devices.mjs` `isWaiting(e)`: the flag, or an error that says "... is running: close it". The self-check
  saves such a setting as `{ ran: false, waiting: true, why, at }`. It is not failed. It stays read-only on a
  read-only or untested entry, its hint says it is waiting, and it is tried again later.

## 2. Trying failed and waiting settings again

- Each setting in `verified.json` now has `at`, and the file has `devicehub` (DeviceHub's version).
- `checkPlan(a, verified, info, { now, version })` decides on each connect:
  - full check: never checked, a setting never checked, firmware changed;
  - only the failed and waiting settings: once a day per setting (`RETRY_MS`), or at once after a DeviceHub update.
  - Two kinds are never tried again by themselves: a setting whose value moved when written back, and one the driver
    marks `selfCheck: false` (saved with `skip: true`).
  `needsCheck()` still returns the reason string.
- `selfCheck(..., { only, previous, version, makerApp })`: checks just `only`, and keeps the earlier results for the
  rest.
- Check again, on the person's click only, with no daily wait:
  - `guard()` adds `a.recheck()`, which re-checks every setting that has not passed (a moved one too).
  - `public/core/devices.js` `recheck(id)` runs it under the device lock, then reads the device in full.
  - agent op `recheck`, which is `POST /api/agent/recheck {id}`.
  - `helpers/diagnose.mjs` action `{ kind: 'check-again', id }`, sent through `POST /api/diagnose/action`.
  - The diagnose finding "N settings are read-only" offers Check again while the device is connected (Connect again
    while it is not). It also names waiting settings.
- Buttons for it:
  - `public/pages/common.js` `diagAction` draws `check-again`.
  - `public/pages/my-device.js` has a Check again line under Settings for a library driver with read-only settings.
    The answer shows on that line; nothing pops up.
  - `helpers/agent.mjs` `adapterMeta` now carries `library`, so the page knows.

## 3. The maker's app open

`selfCheck` asks the driver's own `vendorApp()` first. A driver without one is checked against DeviceHub's list
(`diagnose.mjs` `MAKER_APPS`) by vendor id, with one `tasklist` per check, only when a check is due. If the app is
open, it returns `{ ran: false, waiting: true }`, writes nothing and saves nothing. The next connect tries again. No
new timers.

## 4. Untested entries install on a click

- `helpers/device-library.mjs` `match()` and `installFromLibrary()` take `untested: true`. The entry installs marked
  `untested`, guarded the same way as read-only (writes refused until each setting passes).
- `server.js` `POST /api/library/install`:
  - passes `untested: true`;
  - refuses an entry whose every product id DeviceHub's own drivers run (pc-map `RUNS`);
  - clears the `/api/setup` cache after an install.
- Auto setup (`run()`) still installs only tested and read-only entries.
- `helpers/auto-setup.mjs` `summary()`: an item may carry `action: { kind: 'library-install', name, label }` or
  `{ kind: 'check-again', id, label }`. No line tells anyone to send a POST any more.
- `public/pages/overview.js` (Set up card only): each such item gets its button, and the answer shows on the item's
  line.

## 5. VIA keyboards

They count as running. They never show under "Still to do": not in the library loop, and not in the "no driver yet"
loop. A library driver for a VIA keyboard (Keychron) shows under Optional with an Install button, because it only
adds the maker's extra settings.

## 6. Learning wizard

- `begin()` refuses, in plain words:
  - `SHARED_CHIPS` vendor ids: `258A` Sinowealth and `22D4` Laview (docs/brands/glorious.md: Redragon bricking, mxw);
  - `never-commands.json` `refuseVendors` (Logitech `046D`);
  - a device whose driver refuses every write (Glorious);
  - a device whose driver is code (`device.mjs`). Learned settings cannot be added to code, and a second driver on
    the same device would fight it.
- A device covered by a driver is now listed, not hidden. Each listed device has:
  - `library: true`;
  - `note`: "already has a driver; Learn adds settings it lacks", or the reason it is refused;
  - `refused`;
  - `driver: { name, where, code, writes }` (never a folder path).
  The person's own my-devices drivers (no `library.json`) stay hidden as before.
- For a driver.json driver, the learned settings go into its copy in my-devices:
  - installed from the library first if it is not there yet;
  - `mergeDriver(base, learned)` adds the messages under `learned...` names. It refuses another report kind,
    checksum or reply matching, and any key the driver already has;
  - the merged file is validated and `verifySeen` is run on it;
  - `saveInto(folder, def, keys)` backs up `driver.json` and `library.json` to `backups/learn-<name>-<stamp>/`, then
    replaces them. It works only inside my-devices. `library.json` gets `learnedKeys`.
  - `writeAllowed` keeps `learnedKeys` read-only until each passes, even on a "tested" entry.
  - The library's own copy is never edited.
- An in-place change to a loaded driver needs a DeviceHub restart. `saved.note` says so.
- `summary()` has `addsTo`, and `saved` has `added`, `into` and `note`.

## Tests

- `tests/sim-logitech.mjs` section 6: G HUB open, then onboard mode waits, then the mode is unchanged, then a day
  later in host mode all pass.
- `tests/auto-setup.mjs`: the maker's app, waiting vs failed, once a day, after an update, a moved value only on
  Check again, the Install action, VIA under Optional, untested only on a click.
- `tests/my-devices.mjs`: `checkPlan`, `writeAllowed` with waiting and `learnedKeys`, `isWaiting`.
- `tests/device-library.mjs`: `untested: true`.
- `tests/learn-wizard.mjs`: refusals, notes, no folder paths to the page, merge, backup, the library copy untouched,
  loaded guarded.
- `tests/diagnose.mjs` and `tests/hid-core.mjs` were updated to the new behavior (Check again; mode self-checked).

## For the other agent (files I did not touch)

- `public/pages/learn.js`: show `d.note` on each device row, and disable "Learn this one" when `d.refused` is set
  (`begin` refuses anyway). On the ready step, show `addsTo.note`. After Save, show `saved.note`.
- `device-library/README.md`, the `status` list: "untested: written from a protocol description, not yet run on the
  device. Offered; installs on the person's click (Set up card), read-only until each setting passes its check." Also
  remove "Offered, not installed" for read-only (auto setup installs those).
- `dist/device-library.json` was built before the Logitech change. Rebuild it on the next release
  (`node helpers/make-library-bundle.mjs`).
- Lines for CLAUDE.md:
  - Under "Look for a known protocol", library first: "An untested library entry installs on the person's click (Set
    up card > Install, or POST /api/library/install); it loads read-only until each setting passes the self-check."
  - Under the self-check notes: "A setting a driver refuses only because of the device's current mode (throw an
    error with `waiting: true`) is recorded as waiting, not failed. Failed and waiting settings are tried again on a
    connect once a day, and at once after a DeviceHub update. A value that moved is tried again only on Check again.
    The self-check never runs while the maker's app is open."
  - Under "Learning a protocol": "The learning wizard never learns 258A (Sinowealth), 22D4 (Laview) or Logitech
    (046D) ids. For a device with a driver.json driver it adds the learned settings to the my-devices copy (backed up
    first), never to the library."
