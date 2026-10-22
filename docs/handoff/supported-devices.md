# Supported devices (22 Oct 2026)

A person can see, without Claude, which devices DeviceHub runs and what each one gets.

## Where it is

- **Settings > DeviceHub > Supported devices > Show** opens the page (`#/supported`). It is a page, not a dialog,
  and it is not in the sidebar (`rail: false` in `public/app.js`).
- **Search (Ctrl+K)**: "supported" offers *Go to > Supported devices* (every page in `PAGES` is a Go to command) and
  the Settings row. `public/ui/find-settings.js` also indexes the page's own headings.

## What it shows

- **Works with any device** (across the top): any VIA keyboard, any USB headset's sound and EQ, monitors over DDC/CI,
  webcams, USB lights through the built-in OpenRGB, Bluetooth batteries, and **Not listed? > Learn a device**.
- **Mice, Keyboards, Mice and keyboards, Headsets** (Other devices if a library entry is ever another kind): one row
  per driver: brand and up to two models ("and N more"), "Changes ..." and "Also reads ..." in plain words, and a
  status pill: **Works** (out of the box), **Reads now** (reads by itself; settings after Turn on settings), **Not tried
  yet** (not tried on a real device yet; installed from the Set up card). One line under the title says what the three
  mean, so the rows stay short. DeviceHub's own Pulsar, P75 and HS80 are listed as Works.
- Three columns at 1650 x 910 (cards balanced by row count), one column at phone width.

## How the data is made

`helpers/supported-devices.mjs`, `GET /api/supported-devices`:
- the entries come from `device-library.mjs` `list()` (shipped library plus `library-cache/`), each driver loaded the
  way the library loads it (`loadDriver`): **nothing is called on it** (no connect, read or write), so no device is
  opened. A driver that does not load still gets its row from `device.json`.
- what it reads and changes: the driver's declared `settings` (labels, type; `display`, `readOnly` or a "shown only"
  hint = a reading) plus the phrases in `device.json` `works` (split on `;` outside brackets; "written / read back" =
  a change, "(read)", "read only", "shown only", "reads:" = a reading). `TERMS` turns both into plain names. Many
  drivers list their settings only once a device is connected (Logitech, Corsair, Keychron), so `works` is what
  carries them. A driver whose `works` says "never writes" / "writes nothing" changes nothing.
- status: `hasRealRecord` (my-devices.mjs) and `status`. Today no library entry has a real-device record, so every
  library row is Reads now or Not tried yet.
- cached until a file in a library folder changes; about 65 ms the first time.

## Lines for you to add (files I was not to edit)

**server.js**, beside the other handler lines (after the `/api/diagnose` line, about line 545):

```js
  if (url.pathname === '/api/supported-devices') { try { if (await (await import('./helpers/supported-devices.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
```

Optional, so the page also lists drivers in isolated test mode (the route reads only this copy's files): add
`'/api/supported-devices'` to `ISOLATED_PASS` in server.js. (tests/isolated.mjs does not copy `device-library/`, so
there it shows the built-in three only.)

**package.json**: add `&& node tests/supported-devices.mjs` to both `test` and `test:offline` (after
`node tests/device-library.mjs` is a good place).

**CLAUDE.md** (Map, after the `device-library/` line):

```
helpers/supported-devices.mjs   Supported devices: GET /api/supported-devices, the plain-words list (public/pages/supported.js; Settings > DeviceHub > Show, Search); reads the library, opens no device
```

and in "Set this up" step 3, after the first bullet: "Settings > DeviceHub > Supported devices shows the person the same list."

In Checks, the Get help line now reads: "Someone without Claude presses **Get help** (device page's troubleshooting
panel, or Settings > Get help): ..." (it was "Settings > Health"; docs/handoff/get-help.md is updated).

Until server.js has the line and DeviceHub restarts, the page shows the top card and "The list did not load. Restart
DeviceHub, then open this page again."

## Checked

- `node tests/supported-devices.mjs`: the words, the status words, short models, groups, the route (GET answers,
  POST 405, other paths left alone), a pretend library whose driver records any call (none made) and a broken
  driver (still a row), nothing written, and every real library entry has a row with a status and words.
- `npm run test:offline` passes (exit 0).
- In a browser, against a throwaway copy on its own port (isolated mode, the line above added): demo mode at
  1650 x 910 and 375 x 812 (no sideways scroll), Settings > Show opens the page, Ctrl+K "supported" finds it.

## Settings at 1650 x 910 (fits again, outside demo too)

Before this change Settings already scrolled outside demo mode: the third column (Health with Get help, then the
DeviceHub card) was taller than the room under the title (736 px: 910 minus the title, 94 px, and the page's 80 px
bottom padding). On the coordinator's go-ahead:
- **Get help** is its own small card under Startup (picker in its heading, the Get help button under it; the report
  still opens in place below the button). In Ctrl+K it is now the section "Get help".
- **Optional tools** moved from the DeviceHub card into the Startup card, beside DeviceHub updates and Device firmware
  (the third column still did not fit with Get help gone: 757 px).
- The DeviceHub card's rows use Optional tools' tighter padding (6 px).

Measured on a non-demo isolated copy at 1650 x 910 with the Daily check line, a Last problem line and the Optional
tools row all showing (natural heights, before the columns are stretched to the same height):

| column | cards | height |
|---|---|---|
| 1 | Appearance 432 + Safety 207 | 655 px |
| 2 | Startup 592 (with Optional tools) + Get help 109 | 717 px |
| 3 | Health 328 + DeviceHub 357 | 701 px |

All three are stretched to 717 px (even heights, as before); the page's scroll height is 910 = the window, so nothing
scrolls. Demo mode: 910 as well. Pressing Check now under Device firmware, or building a Get help report, makes the
middle column longer, as Check now already did.

## Not done

- Not committed.
- The words come from each driver's own descriptions; a new driver with unusual wording may show a label as it is
  (lowercased) rather than a plain name. Add a line to `TERMS` for it.
