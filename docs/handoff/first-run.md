# First start, one question, "You're all set" (22 Oct 2026)

Shawn wants first setup as simple as possible. Three changes, all on the Setup page's existing parts.

## 1. Setup opens by itself on the first start

`public/core/first-run.js` (new). When the window opens with no page asked for (no hash, `#/` or `#/overview`), it reads
`GET /api/settings` and `GET /api/profiles` (2 s at most each) and goes to `#/setup` (history.replaceState, no extra
render) when all of these hold:

- settings.json has no `setupSeen: true`
- no saved profile
- no device seen on this PC before (the agent's `seen` flag on any device)
- both files were read (a failed read never guesses) and the background part has answered (`ready`)

It then saves `setupSeen: true` through the existing `POST /api/settings` (that one key), first start or not, so Setup
opens by itself at most once. A window opened on a page (a link, a reload, `tests/pages.mjs`) decides nothing and saves
nothing. `server.js` accepts `setupSeen` as a boolean; `helpers/onedrive-setup.mjs` leaves it out of the OneDrive copy
(it belongs to each PC); settings sync never had it (its own key list).

Shawn's PC (read with GETs on 22 Oct): no `setupSeen`, 3 profiles, mouse, headset and keyboard seen, so it is not a
first start. Either the profiles or the seen devices alone would be enough. The new key is only written by the server
after its next restart; until then the POST is a no-op.

Demo: `?demo&first` opens Setup by itself; nothing is saved.

## 2. One question for the makers' apps inside Set it all up

`public/core/setup-list.js`: `makerApps(rows)` (one entry per app holding a device that needs you, with its devices),
`askLine(apps)` ("Close G HUB and Synapse so DeviceHub can set your devices up?"; short names from the MAKER_APPS keys),
`leftLine(app)`.

`public/pages/setup.js`: when any device's next step is close-app, Set it all up shows that question in place, under the
status line, with **Yes, close them** / **Not now**. One question for all the apps.

- Yes: for each app, `POST /api/diagnose/action { kind: 'close-app', app, confirm: true }`, the same action as the row's
  own button (helpers/diagnose.mjs: only a MAKER_APPS key, never an image that looks like a service, updater or
  crashpad, the confirm flag required). Then it reconnects those devices after 3 s, waits up to 15 s for them (checked
  twice a second, only after the click), adds Turn on settings for all if one of them waits for it, and does the usual
  safe steps. One line per app and device.
- Not now: "SteelSeries Aerox 3: left as it is (SteelSeries GG is open)." for each, then the safe steps.
- The row's own Close button and its confirm stay as they were.
- The status line says "Set it all up asks once before it closes an app. It never starts learning." when an app is
  involved; the button now also shows when the only thing to do is closing an app.

## 3. "You're all set"

When nothing needs the person, the status panel becomes "You're all set", "Open a device to change its settings." and
one tile per device (the "Your devices" strip is not shown then, it would repeat them). Each tile: icon, name, and what
it can do now from `canDo(row, dev)`:

- built-in mouse, headset, keyboard: from the readings the device reports (DPI, polling, buttons, lift-off, lights;
  volume, mic, EQ, sidetone, lights; keys, backlight, effects, macros), or what its page always has when not read yet
- an added or library driver: its own settings list, by label
- monitors: brightness, contrast; webcam: picture settings; a VIA keyboard: keys, lights
- battery last when it has one; at most four words, then "and more"

A tile opens its device's page. No button. The folds below are unchanged. With no devices at all it says "No devices to
set up yet."

## Files

- new: `public/core/first-run.js`, this file
- `public/app.js` (the first-start decision before the first render), `public/pages/setup.js`, `public/core/setup-list.js`,
  `public/core/setup-demo.js` (each pretend added device has a settings list and battery), `public/style.css` (one block
  at the end, theme tokens, Old School and Verde touches), `server.js` (setupSeen), `helpers/onedrive-setup.mjs`
- `tests/setup-page.mjs`: the first-start decision (new PC, setupSeen, a page asked for, unread files, profiles, seen
  devices, Shawn's PC as read today, what is saved and when, demo), the one-question flow (one entry per app, the
  question text for 1, 2 and 3 apps, Not now lines, only known apps, an updater or service never closable, close-app
  refuses without the confirm flag, the page closes with it), the done view (each kind's line, Shawn's 5 tiles, the
  demo ending with nothing to do)

## Checked

- `npm run test:offline` and `node tests/pages.mjs` pass.
- Demo `?demo&first` at 1650x910: opens on Setup; Set it all up > the question > Yes, close them > "You're all set" with 8
  tiles, no scroll, no cut-off text; Not now leaves the Aerox and turns on the Razer. 390x844: no sideways scroll, the
  tiles stack. Old School, Verde and Milk look right.
- Live `#/setup` on Shawn's PC (opened on a page, so GETs only): "You're all set" with Pulsar X-Lite CrazyLight (DPI,
  polling, buttons, battery and more), Corsair HS80 (volume, mic, lights, battery), Epomaker P75, 2 monitors, 1 webcam.

## Notes

- A real close with the agent: the devices connect through the agent; `connect()` is the same call the row's own
  button used. Not tried on a real maker app (rule: never close one on Shawn's PC).
- Not committed.
