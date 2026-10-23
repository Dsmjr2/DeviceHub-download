# Find my lights (22 Oct 2026)

Shawn said yes to a built-in version of what was done by hand on his PC: give each zone of an OpenRGB light its own
color at once, ask which color each part shows, let the person say what each part is, then name those zones and hide the
ones that light nothing. Not committed. Tested against a stand-in OpenRGB and in demo mode only; it has not run on real
lights yet.

## What the person sees

Lighting > PC lights, under the list of lights (only when OpenRGB runs, can write, and lists a light with LEDs):

1. **Find my lights**. One line: "Each part of a light gets its own color for a moment, so you can see which is which.
   Your colors come back after." With one light: **Start**. With several: one button per light ("B450 AORUS PRO WIFI-CF
   (4 zones)"). **Not now** closes it.
2. The light's zones go to one color each. "What lit up in this color?" and one row per color: a tappable color button
   (dot + name), a small text box (placeholders "Case fans", "Top logo", "RAM", ...) and a status: "Nothing lit in this
   color" (the default), "Lit, no name" (tapped), "Will be named" (typed). Zones with 0 LEDs and zones past the 16th
   color get a one-line note. **Save names** / **Cancel**.
3. Back on the card: a result line ("Saved: Case fans, Top logo. 2 zones that lit nothing are hidden. Your colors are
   back."), the zone rows carry the saved names, zones that lit nothing are left out, and **Show all zones** / **Hide
   empty zones** switches them back on the page (it does not change the file).

Everything is in place: no pop-ups, notifications or tooltips. Typing does not redraw the page, so a box keeps focus.
Checked at 1650x910 and 375 wide (rows wrap; no sideways scroll). It uses only the existing classes and color variables
(`pc-guide`, `gh-note`, `btn`, `text`, `--line`), so it follows every skin.

## How it works

- `helpers/find-lights.js` (new). Runs inside `helpers/openrgb.js` and uses that file's own steps (read, backup,
  send + read-back, put-back), so the same rules apply: the first change backs the light up (`backups/openrgb-*.json`),
  DeviceHub's own devices are refused, a bundled or pre-1.1 OpenRGB that may not write is refused.
  - `start(target)`: one light by index. Every zone with LEDs gets the next color: red, orange, yellow, green, cyan,
    blue, purple, pink, white, lime, then teal, sky blue, magenta, gold, violet, coral. Zones past 16 are set off and
    marked `notInTest`. **One send for the light**: Direct mode plus one UpdateLEDs with every LED, then read back.
    The light's state just before the test is kept in memory (the "test backup"). Pressing it again on the same light
    keeps that first state; starting on another light puts the first one back first.
  - `save({ target, names, hidden })`: names are trimmed to one line, 40 characters at most. Only zones in this test
    change in the file; a named zone is never hidden; out-of-range indexes are ignored. Then the test backup is put
    back. If the put-back fails, the names stay saved and the error says to press Cancel (the test stays open).
  - `cancel()`: puts the test backup back; nothing saved.
- `helpers/openrgb.js`: `zoneName` reads the saved names first, then `ZONE_NAMES`, then OpenRGB's name; `shapeOut`
  marks zones `named` / `hidden`. The send/read-back of `setColor` and the body of `restore` moved into
  `sendColors` and `putBack` (no change in what they do; `tests/openrgb-mock.mjs` still passes). `status()` carries
  `findTest` (live even from the 10 s cache) so a reopened page carries on with a running test.
- `server.js`: `GET /api/openrgb/find`, `POST /api/openrgb/find-start {target}`, `POST /api/openrgb/find-save
  {target, names, hidden}`, `POST /api/openrgb/find-cancel`. Nothing runs at start; no timers. In isolated mode the GET
  answers `{ running: false, isolated: true }` and the POSTs refuse like every other device route.
- `lights-names.json` (beside server.js): `{ "boards": { "<light name>": { "names": { "1": "Case fans" }, "hidden": [3],
  "savedAt": "..." } } }`. Gitignored, in `make-installer.ps1`'s private list (the zip check refuses it) and in
  `install.ps1`'s keep list.
- `public/ui/find-lights.js` (new): the steps above; `findLights(o, redraw)` and `shownZones(c)`. Demo mode runs the
  same steps on the pretend lights, on the page only.
- `public/pages/pc-lights.js`: one import, `findLights(o, redraw)` under the list, and the zone rows go through
  `shownZones(c)`.

## Tests

- `tests/find-lights.mjs` (in `npm test` and `npm run test:offline`): a stand-in OpenRGB with a board (4 zones, one with
  0 LEDs), RAM, DeviceHub's own headset and an 18-zone strip. It checks one send for the whole light and nothing else
  touched, one different color per zone, the backup, the names cleaned and saved per board, saved names coming before
  `ZONE_NAMES`, hidden zones, names read again after a restart, Save and Cancel putting the light back exactly as
  before the test (not as before DeviceHub's first change), the second light putting the first back, the 16-color
  limit, and refusals (no test, wrong light, own headset).
- `tests/openrgb-mock.mjs`, `board-lights.mjs`, `bundled-tools.mjs`, `lights-diagnose.mjs` copy `find-lights.js` beside
  their copy of `openrgb.js`.
- `npm run test:offline`: every script passes except `tests/lights-diagnose.mjs` check 9. That failure comes from the
  Get help job running at the same time: it changed `fanHelp()` to `getHelp('lights', () => '', { area: 'lights' })`,
  and the test still looks for `getHelp('lights', () => 'lights')`. This job did not cause it and left it alone.
- `node tests/pages.mjs`: all good (28 pages, live and demo).

## Left to do

- **Restart DeviceHub** for the new routes (the page files are live already; until a restart, pressing Start shows "The
  test colors did not go on: ..." in place).
- Try it once on Shawn's B450 with the case lights plugged in. His board's `ZONE_NAMES` entry (Top logo, Bottom logo)
  stays as the fallback.
- Names are kept by the light's name. Two identical lights in one PC would share names.
