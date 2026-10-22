# Backups page redesign, 22 Oct 2026

Shawn: "Can we make the backups area make more sense? It feels complex. Also make a confirmation if you want to load
a backup". This is the result. Only the page changed: the routes, the backup and setup file formats and the restore
itself (`restorePlan` in `public/pages/backups.js`, `planSetup` / `loadSetup` in `public/core/setup.js`) are the same.
`npm run test:offline` and `node tests/pages.mjs` pass. Nothing was committed. server.js, package.json, CLAUDE.md and
helpers/my-devices.mjs were not touched. Shawn's real copy was only looked at; every button was tried in `?demo`.

## What the page shows now

- One line at the top: "DeviceHub saves your settings before every change, so you can always go back."
- **Your whole setup** card: one line on what a setup file is (all devices, profiles and DeviceHub settings in one
  file), **Save a copy now** (the old top "Save setup file": a file in Downloads) and **Load a setup file…** (the old
  top "Load setup file"). Below them, "Saved every week (the last 6 are kept)": one row per weekly copy
  ("Mon Oct 19, 4:14 PM", size small) with **Go back to this**.
- **One card per device**, "<device name>: before each change". The newest 3 show; **Show older (N)** opens the rest
  in a box that scrolls on its own (so a long list never makes the page endless) and **Show fewer** closes it. Each
  row: a friendly date ("Today 12:42 PM", "Yesterday 11:04 PM", "Oct 21, 10:41 PM", with the year when it is not this
  year), and under it what change it came before when the file says so ("before Polling rate change") plus its size.
  Buttons: **See what's in it** (opens under the row; settings as "Polling rate 1000 Hz" lines using the device
  pages' own names and units, a "Show the whole file" button for the raw file; files with no settings show the file)
  and **Go back to this**.
- Files of things that are not one of the devices (monitors, camera, Windows mouse pointer, EQ, DeviceHub settings)
  get their own card with See what's in it only, and the line "You can look at these; they are not put back from
  here." (Before, their restore icon only said "Connect the ... first".)
- The top-bar Refresh, Load and Save buttons are gone; the lists are read again each time the page is opened.

## The questions

Every go-back and every setup load asks first, inside its own row or card, never in a pop-up:
- A device backup: "Put your Pulsar X-Lite CrazyLight back to how it was today at 12:42 PM? Settings you changed
  since then will be replaced.", the settings that will change (first 6, "and N more"), and "DeviceHub saves how it
  is now first, so you can come back to that too." Buttons **Yes, go back** / **Cancel**.
- A weekly copy or a picked file: "Load the setup saved Mon Oct 19, 4:14 PM?", "It holds: <devices>, N profiles,
  sound settings.", the settings that will change, the devices left alone because they are not connected, then
  **Yes, load it** / **Cancel**.
- Only one question is open at a time (opening another closes the first). While one is open, that row's buttons hide.
- Nothing to ask (the device already matches, not connected, not a setup file, a file that cannot be read) and the
  result afterwards ("Done. Your Epomaker P75 is back to how it was today at 11:06 AM (2 settings).", or "Finished with
  problems: 3 put back, 2 not (see Activity).") are one plain line in the same place. No toasts or modals are left on
  the page.

## Files

- `public/pages/backups.js`: the page (restorePlan unchanged, still exported for core/setup.js).
- `public/core/backup-words.js` (new): friendly dates, the "before ..." words from a backup's `why`, which card a file
  goes on (the longest device id its name starts with, so `example-light-...` lands on Example light; otherwise the
  part before the first dash, as before), and a backup's contents as lines. No DOM, no fetches.
- `public/devices/demo-backups.js` (new): pretend backups and two pretend weekly copies for `?demo`. In demo mode the
  page reads only these, never `/api/backups` or `/api/setups`; Save a copy now says "Demo mode: nothing is saved", and
  a setup load never writes the sound settings (that POST is not demo-aware elsewhere).
- `public/style.css`: a `bk-` block after `.file` (rows, questions, the view, the scroll box for older rows).
- `tests/backup-words.mjs` (new), run from `tests/profiles-added.mjs` so test:offline covers it.

## Checked in demo mode (Chrome, 1650x910 and 375 wide)

Go back to this -> question -> Cancel; a second question closes the first; Yes, go back -> "Putting your ... back…"
-> Done line; Go back again -> "Nothing to change"; Show older (3) -> 6 rows -> Show fewer; See what's in it -> lines
-> Show the whole file -> Hide; weekly Go back to this -> question with date and contents -> Cancel / Yes, load it ->
Done; Load a setup file… with a broken file, a non-setup file and a real one (question with date and contents, Yes ->
Done); Save a copy now in demo. At phone width the page has no sideways scroll. Shawn's real page opens with all his
backup groups (11 cards) and their "before ..." lines; nothing on it was pressed.

## Notes

- The "before ..." words need each shown file read once (cached for the session); only the rows on screen are read.
- The weekly card's old "Save one now" (save a weekly copy on the server now) is gone; Save a copy now is the old top
  button (a file in Downloads), as asked. `/api/setups/save-now` is still there if it is wanted back.
