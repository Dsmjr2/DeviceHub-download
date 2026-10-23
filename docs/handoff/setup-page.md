# Setup page (22 Oct 2026)

Made simpler later the same day (one status line, only what needs you, device tiles, the rest folded): see
`docs/handoff/setup-simpler.md`. The Help section and Reset sound to normal described below are no longer on Setup.

Shawn: "I want the setup to all be on one page". `#/setup`, in the sidebar right under Overview. The first-run screen
(Open Setup) and the Overview's Set up card (now one line: "3 things need you", Open Setup, Hide) link to it.

## Files

- `public/pages/setup.js`: the page. Loads once when opened; a device connecting, dropping or having its settings
  turned on redraws it (`keepAlive` compares a status signature), other readings do not.
- `public/core/setup-list.js`: the rows, with no DOM and no requests (`deviceRows`, `doAllSteps`, `soundRows`,
  `lightRows`, `batteryRows`, `learnRows`, `helpRows`, `countNeeds`, `summaryLine`). The Overview card counts with
  the same functions.
- `public/core/setup-demo.js`: demo data, one of every kind of row (kept out of setup.js because tests/check.mjs and
  tests/pages.mjs take the first `id: '...'` in a page file as its id).
- `public/ui/installer-button.js`: new `installerInline(id, { redraw, onDone })`, the same install as the dialog
  but confirmed in place (plan, Install/Cancel, loading bar, one answer line). The dialog version is unchanged for
  Settings and the Headset page.
- `public/pages/overview.js`: Set up card shortened; first-run gets Open Setup.
- `public/app.js`: the page added to PAGES (index 1, so Alt+2 is now Setup and Alt+3 to Alt+8 moved down one) and
  to the rail under Overview.
- `public/style.css`: the "Setup" block at the end, with Old School and Verde rules.
- `tests/setup-page.mjs` (new); `tests/works-report.mjs` now looks for Turn on settings for all on the Setup page.

## Rows and where each comes from (no new server routes)

1. Your devices: `GET /api/setup` plus the window's own device list (live state wins over the summary, which the
   server keeps for a minute). Maker's app: `GET /api/diagnose?id=` for each seen device that is not connected
   (once per device and state); its `close-app` action, confirmed in place, `POST /api/diagnose/action`. Get the
   layout: `GET/POST /api/via-fetch` for a VIA-brand keyboard nothing runs yet. Install: `POST /api/library/install`.
   Turn on settings and Check again: `POST /api/diagnose/action`. Works on my device: `ui/works-report.js`.
   Request support: `ui/get-help.js`. **Do all**: library installs that need you, then `turn-on-all`, then Get the
   layout, one line per device. It never closes an app or starts learning.
2. Sound: `GET /api/installers` (Equalizer APO), `GET /api/eq` (only when it is installed) for `headsetModel` and
   `notOn`; Turn it on = `POST /api/eq/turn-on`.
3. Lights: `GET /api/openrgb`; Find lights = `GET /api/openrgb?fresh=1` (starts the OpenRGB inside DeviceHub, as
   the Lighting page does). Dynamic Lighting from the summary.
4. Batteries: `GET /api/bluetooth`, connected ones with a level.
5. Learning tools: USBPcap, only when a device row has Learn it.
6. Help: `GET /api/auto-report` and the `autoReport` setting (no switch on Shawn's own PC or with no relay); Get help.

## Checked

- Demo (`?demo#/setup`) at 1650x910, 390 wide (no sideways scroll), Verde and Old School; every button pressed in
  demo (close-app confirm, inline install, Find lights, Turn it on, Do all).
- Live page opened read-only on Shawn's PC (only GETs): his three devices, monitors, webcam, Equalizer APO on for the
  HS80, Find lights offered, reports switch not shown (owner PC).
- `npm run test:offline` and `node tests/pages.mjs` pass.

## Notes

- package.json: add `node tests/setup-page.mjs` to both `test` and `test:offline` (for example after
  `node tests/works-report.mjs`).
- The sidebar now has a "Setup" page and a "Setup" group heading (Lighting, Monitors, Fans, Wallpapers). Renaming one
  of them is Shawn's call.
- Already there before this change: `public/pages/learn.js` has an `id: 'dpi'` before its page id, so check.mjs and
  pages.mjs read its id as `dpi` and pages.mjs never really opens Learn a device.
- `tests/auto-report.mjs` failed once at exactly 00:00 UTC ("then dropped for today") and passed on the next run, so it
  depends on the time of day.
