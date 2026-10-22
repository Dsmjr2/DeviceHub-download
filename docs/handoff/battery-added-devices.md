# Battery features for added devices, 22 Oct 2026

Devices added in `my-devices` (library drivers and your own) that report a battery now get the same battery
features as the mouse and headset. `npm run test:offline` passes. Nothing was committed, DeviceHub was not
restarted, and nothing was written to a real device. The new page code was checked in demo mode only.

## What an added device with a battery gets

- **Battery history and the graph.** DeviceHub already wrote a row for every connected device with a battery into
  `battery-history.jsonl` every 5 minutes (and on each plug and unplug), keyed by the device's id. Only the graph and
  the estimate left added devices out. Now `/api/battery-history?id=<added id>` answers for them, and the device's
  page shows the same Battery card (24 h / 7 days, charging bands, Readings table). Same file, same row shape, same
  7-day keep, same timers.
- **Time left.** `/api/battery-estimate` now has an entry for every id in the file. The mouse and headset entries are
  worked out the same way and always present, as before. An added device shows its time left in its page's battery
  pill ("battery 42%, ~28 h left"), once DeviceHub has watched it drain for 30 minutes and 2%.
- **The Live look's liquid** on its Overview tile (and its page's picture while it is not connected). It uses a plain
  drawing of its kind (mouse, headset or keyboard; a plain tile for any other kind) with the same liquid and color
  rules: green at 60% and up, yellow at 30%, red at 10% and below, bubbles while charging, last level shown still and dim while asleep. The drawing is marked
  `data-dev="<id>"`, so it shows that device's own level. The built-in mouse, headset and keyboard paint only
  drawings without that mark, so an added mouse never shows the Pulsar's level.
- Added devices **without** a battery look and work exactly as before (plain tile, no graph).

## Low-battery saving and lights off while charging (writes)

Only for a driver that says which setting to change, with a new optional part of the driver contract:

```js
batteryCare: { lowBattery: { key: 'lights', value: false }, charging: { key: 'lights', value: false } }  // either or both
```

- Checked when the driver loads (`batteryCareProblem` in `helpers/my-devices.mjs`). Refused, with the reason in
  server.log, if: it is not that shape, it has another rule name, the driver has no `battery()`, the setting is a
  reading (`display`), or the value is not one the setting takes. A setting listed only once a model connects is
  checked again before every change.
- **No shipped library driver declares it**, so nothing changes for any of them (a test checks the library for it).
  `driver.json` drivers declare it too since later on 22 Oct (docs/DRIVER-FORMAT.md, docs/handoff/final-docs.md).
- Same thresholds as the mouse: at 20% or less and not charging, the setting goes to the driver's value; back at 30%,
  on charging, or when Save device battery is switched off. While charging: its value, back when unplugged. Like the
  HS80's lights, the charging rule follows the driver whatever the switch says. The low-battery rule leaves the
  setting alone while the charging rule holds it.
- Every change, down and back, goes the way a profile's does: the driver must allow the write now (a library driver's
  own gate: Turn on settings pressed and its check passed; your own driver: not marked read-only), the maker's app
  must be closed ("could not check" counts as open), a backup must succeed first, then one write through the normal
  write path, read back. A value changed by hand meanwhile is left as it is.
- If a change is left out (not allowed, maker's app open, no backup), one Activity line says why, and it is not
  tried again for 30 minutes, so a low device does not take a backup every 20 s. A put-back that was left out stays
  saved and is tried again later. A write that reads back something else is not kept and says so.
- Saved in `battery-care.json` the same way as the mouse and headset: `"<id>"` for low battery, `"<id>:charging"`
  while charging, `{ at, items: [{ key, was, to }] }`. Added ids can never be `mouse` or `headset`.
- The device's page shows one plain line when the driver declares it, e.g. "Battery saving. At 20% or less: Lights
  off, back once it charges (Settings, Save device battery). While charging: Lights off, back when unplugged."

## Your mouse and headset are unchanged

- Their history rows are written by the same code; a test compares each new row with the old formula, and checks the
  file keeps their rows byte for byte.
- Their estimates are the same with an added device's rows in the file (tested).
- The battery-care rules for them run first, unchanged; the added-device part runs after and touches only devices
  with `plugin` and a valid `batteryCare` (the original battery-care tests pass as before).
- No new timers: battery-history.js still has one 5-minute interval and its two start-up/30 s watch timeouts;
  battery-care.mjs still has its 20 s interval and one start-up timeout (a test counts them). Battery care asks
  Windows for the maker's app (tasklist) only when a change is actually due.
- The battery cell's hover note stays on the mouse and headset only; added devices get no tooltip.

## Files

- `helpers/battery-history.js`: estimates for every id in the file; `validId`; `_test`.
- `server.js`: the graph route takes an added device's id.
- `helpers/battery-care.mjs`: the added-device rules (after the built-in ones).
- `helpers/my-devices.mjs`: `batteryCareProblem`, called from `problem()`.
- `helpers/agent.mjs`: an added device's `batteryCare` goes to the window with its other details.
- `public/ui/art.js`: the generic drawings take an optional device id (liquid + `data-dev`); `artOf` uses them for an
  added device with a battery. Called without an id they are exactly as before.
- `public/ui/live-art.js`: paints added devices by `data-dev`; the built-ins only drawings without it.
- `public/ui/battery-chart.js`: any id; line color by kind; demo readings hook.
- `public/ui/controls.js`: `batteryLeft`; demo estimate hook; no hover note for added devices.
- `public/pages/my-device.js`: battery pill with time left, the Battery card, the battery-saving line.
- `public/devices/demo.js`, `public/app.js`: a pretend added device in demo mode.
- Tests: `tests/battery-history.mjs` (new, run from `tests/battery-care.mjs` so test:offline covers it),
  `tests/battery-care.mjs`, `tests/my-devices.mjs`.

## Try it in demo mode

`http://127.0.0.1:5577/?demo&added` adds "Pretend wireless mouse" at 42% (no server writes; its graph readings and
time left are made up in the page). Options: `&pct=8`, `&charging=1`, `&kind=Headset` / `Keyboard` / anything else.
Switch Settings > Appearance to Live to see the liquid. Checked: 42% yellow-green, 8% red with bubbles while
charging, 30% yellow, 75% green; asleep keeps the level dim; plain `?demo` shows only the three devices as before.

## Not done

- (done later on 22 Oct, final-docs.md) `driver.json` could not declare `batteryCare` (needs `KNOWN.top` and `fromJson` in
  `helpers/declarative-driver.mjs`, and the format doc).
- `ADD-YOUR-DEVICES.md`, `my-devices/_example` and the Settings line "Mouse and headset at 20% or less..." do not
  mention added devices yet.
- Not tried with the real agent running (DeviceHub was not restarted); the next restart loads it.
