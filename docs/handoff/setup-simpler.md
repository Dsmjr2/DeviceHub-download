# Setup, simpler (22 Oct 2026)

Shawn: the Setup page "is currently overwhelming for a new user". On his PC it showed 11 rows in 5 sections with
nothing needing him. Now it shows "All set" with his three devices as tiles and the rest folded.

Look: `docs/handoff/looks/setup-simpler.png` (demo, 1650x910, 2 things need you).

## What the page shows now (`public/pages/setup.js`)

1. One status line: "N things need you" and **Set it all up** (the old Do all: installs, Turn on settings for all,
   Get the layout; it never closes a maker's app or starts learning). With nothing to do: "All set" with a check and
   no button. With needs but no safe step: the line and "Each one has its own button below."
2. **To do**: only rows with status `needs`, in the order to do them (install, turn on, get layout, close app, EQ on,
   open, learn), one short line and one button each.
3. **Your devices**: small tiles (icon, name, a check or "Needs you"). A done tile opens its page; a tile that needs you
   opens its one row and button under the strip.
4. **Optional extras** and **Everything that is done (N)**: `<details>`, closed; their open state is kept across
   redraws. Rows with status `none` are not shown at all.

Moved out: Reset sound to normal (Headset page EQ card only, it was already there); the problem reports switch and
Get help (Settings > Get help only; that card now also shows in demo mode, where Get help says it works in the
installed app and the switch posts nothing).

## Files

- `public/core/setup-list.js`: new `planSetup(rows)` -> `{ needs, devices, extras, done }`; rows carry `device` and
  `kind` (tile icon); `helpRows` and the `eq-reset` row removed; `summaryLine(0)` is "All set"; all lines shortened,
  no driver words (the `driver` field is kept only as `builtin|library|learned|own` for the demo's answers). Fixed on
  the way: a running OpenRGB with lights found also added a second "PC lights" row with the same key.
- `public/core/setup-demo.js`: demo is now a PC with 2 needs (Razer: Turn on settings; Aerox: Close SteelSeries GG),
  plus optional and done rows. Every other kind of row moved into `tests/setup-page.mjs`'s own fixture.
- `public/pages/overview.js`: Set up card hidden when nothing needs you; otherwise one line + Open Setup + Hide.
- `public/pages/settings.js`: Get help card and reports switch in demo mode too; Device firmware rows only for seen
  devices (below); the Get help picker lists `shownDevices()` only.
- `public/core/firmware-parts.js` (new): which of mouse/headset/keyboard firmware rows to show, from `shownDevices()`.
- `public/style.css`: one block added at the end ("Setup, simpler"); nothing else touched (another job was editing the
  theme parts). Uses the theme tokens (`--r-sm`, `--sunk`, `--line`, `--good`, `--warn`), plus Old School and Verde
  summary colors.
- `tests/setup-page.mjs`: plan order, hidden `none` rows, demo = 2 needs with one safe step, Shawn's PC = All set, no
  jargon, lines <= 80 characters. `tests/seen-only.mjs` (new, added to `test` and `test:offline` in package.json):
  nothing seen = no Device firmware row; one seen = only its row; Shawn's three = all three.

## Device-specific rows (Shawn: "I also dont want my devices like icue etc if there is no device that uses that")

Searched `public/` for iCUE, Pulsar, Epomaker, HS80, P75. Shown to someone without the device were only Settings >
Device firmware (Mouse and dongle / Pulsar app, Headset / iCUE, Keyboard / Epomaker P75) and the Get help device picker.
Both now use `shownDevices()` (the seen-devices record the sidebar and Overview use; every device in demo mode). The
rest are on that device's own page (mouse, headset, keyboard, EQ card), in the Self-test (connected devices only), in
demo-only text, or in the brand guide data, so they were left. Shawn's PC (all three seen) looks as before.

## Checked

- Demo `?demo#/setup` at 1650x910 (fits, no scroll), 390x844 (no sideways scroll), Verde and Old School; pressed Set it
  all up, a Needs-you tile, Close SteelSeries GG > Yes, both folds: no script errors; ends at "All set".
- Settings demo at 1650x910: the three columns end at 841 px, Get help and the switch on one line.
- Live Setup on Shawn's PC opened read-only (GETs only): "All set", 3 device tiles, extras and 4 done folded.
- `npm run test:offline` and `node tests/pages.mjs` pass.

## Notes

- The Overview card still counts device rows only (it has only `/api/setup`), so it can show fewer than the Setup page
  when the EQ or lights need something. Asking more on the Overview would add requests; left as is.
- A tile that needs you repeats the row that is already in To do; that is what was asked (the strip is a glance).
- Not committed.
