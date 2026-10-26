# Isolated test mode (22 Oct 2026)

A second DeviceHub (an unzipped download, a test copy) can run beside the real one without touching any device or
Windows setting:

```
set DEVICEHUB_ISOLATED=1
set DEVICEHUB_PORT=5590
node server.js
```

`DEVICEHUB_ISOLATED=1` needs `DEVICEHUB_PORT` set to a port other than 5577; without it the server says so and stops
with exit code 5, before loading anything else. Run it from its own folder: everything it writes (settings.json,
profiles.json, activity.jsonl, backups\) stays in that folder.

## What it does not do

| Part | Normal start | Isolated |
|---|---|---|
| iCUE SDK (`helpers/corsair.js` connects on load) | required | never required (`corsair` stays null) |
| Monitors over DDC/CI (`monitors.start` applies waiting changes) | started | not started |
| Cameras, OpenRGB (`camera.start`, `openrgb.start`) | started | not started |
| Self-update confirm, agent (HID, native helper), auto setup, library updates | at listen | skipped (early return after the leftover tidy) |
| Audio follow, battery saver, Anker guard, settings sync, receiver light, backup tidy, battery history, tray, taskbar brand | at listen | skipped (same return) |
| Shutdown (Anker guard, agent, OpenRGB stop, which removes `%TEMP%\DeviceHub-openrgb.json`, helper stop) | runs | `process.exit(0)` only |
| `/api/*` | every route | `isolatedApi()` answers first (below) |
| The window | agent client or WebHID | demo mode: the served index.html sets `window.DEVICEHUB_DEMO = true` before app.js (public/ is unchanged) |

`isolatedApi()` (server.js, just above `api()`) lets through only the routes that read or write this copy's own
files: `/api/version`, `/windows`, `/backup`, `/backups`, `/backups/<name>` (GET), `/client-status`, `/activity`,
`/settings`, `/profiles`, `/vendor-apps` (an `existsSync` on two paths) and `/quit`. A few GETs the pages read get demo
answers (`agent-config` with `agent: false`, `health` without the helper, empty `monitors`, `cameras`, `setups`,
`processes`, `games`, `startup` off, sync, updates and OpenRGB off). Everything else, every POST included, answers
503 `{ isolated: true }`. Each of its answers carries the header `X-DeviceHub-Isolated: 1`.

## Default behaviour unchanged

Every change in server.js is behind `ISOLATED` (false unless the variable is exactly `1`):
- `if (!ISOLATED)` added in front of five existing calls (`monitors.start`, `camera.start`, `openrgb.start`, the
  `corsair` require, unchanged otherwise);
- `if (ISOLATED && isolatedApi(...)) return;` in `api()`, `if (ISOLATED && file === index.html)` in the file server,
  `if (ISOLATED) { ...; return; }` in the listen callback, `if (ISOLATED) process.exit(0);` in `shutdown()`;
- new declarations only: `ISOLATED`, the port check (also gated on `ISOLATED`), `ISOLATED_PASS`, `isolatedApi`.
No existing line was otherwise changed (`git diff server.js`).

## The test

`node tests/isolated.mjs` (not in package.json; to add it, append ` && node tests/isolated.mjs` to `"test"`):
copies server.js, package.json, DeviceHub.ico, public\ and helpers\ (without helpers\bin, so even a stray helper
start would have to build and would show) to `%TEMP%\devicehub-isolated-*`, starts it there on a free port, then:
GETs `/api/version`, `/`, app.js, style.css, the manifest and every `public/pages/*.js`; checks 23 device / Windows
GET routes and 10 POST routes are answered by isolated mode; opens all 11 sidebar pages in a headless Chrome or Edge
(skipped if neither) and fails on a script error, an empty page or a page not in demo mode; waits until 12 s after
start; then compares process lists: no descendant of the server's PID (Windows' own `conhost.exe` for the node
process excepted), no new DeviceHubHelper / iCUE / OpenRGB / DeviceSelector process anywhere, the Startup shortcut and
the OpenRGB pid file untouched, and the real DeviceHub on 5577 still answering (GET only). It stops exactly its own
child (by its PID) and removes the copy.

Run on 22 Oct 2026 beside the running real copy: all good (11 pages, 0 child processes, 0 new watched processes,
real DeviceHub answering). `npm run test:offline` passes.

## Notes

- Not restarted: the real DeviceHub keeps running the old server.js until its next restart; nothing changes for it.
- `tests/regressions.mjs` part 5 starts `server.js` from the repo with `DEVICEHUB_TEST=1`, which still runs
  `monitors.start` (and requires the iCUE SDK) at load before the port check stops it. It could add
  `DEVICEHUB_ISOLATED: '1'` to that env (the port it uses is never 5577); left as is.
- `DEVICEHUB_TEST=1` is unchanged and still means what it did.

## Timing the PC reads beside the real copy (26 Oct 2026)

`DEVICEHUB_ISOLATED_READS=1` (only together with `DEVICEHUB_ISOLATED=1`) also lets through the read-only GETs
`/api/pc-check`, `/api/temps`, `/api/display`, `/api/bluetooth`, `/api/installers`, `/api/pc` and `/api/gpu`, starts
the native helper for them, and answers `/api/helper-calls` with the real request counts and
`helpers/helper-reads.js` `stats()` (which reads the helper answered, which fell back to PowerShell). These reads
reach the helper only on its `pc:<op>` channels (helpers/pc-reads.cs), which open no device; `/api/helper-calls`
shows that no `hid`, `hs80`, `monitor`, `camera`, `cue` or `tray` request was made. Every POST still answers 503.
Used for the before / after measurement in docs/handoff/helper-reads.md. Off by default; `tests/isolated.mjs` runs
without it.
