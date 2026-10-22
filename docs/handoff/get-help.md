# Handoff: "Get help" in one click (22 Oct 2026)

Goal (owner): someone stuck without Claude can ask for help in one click. DeviceHub builds a short plain report, shows
it in full, takes out anything personal, and only on the person's click opens a filled-in new issue on
github.com/Dsmjr2/DeviceHub-download/issues/new in their default browser. DeviceHub sends nothing; the person presses
Submit on GitHub.

## What

```
helpers/get-help.mjs        GET /api/help/report?id=<device>, POST /api/help/open {token}; node helpers/get-help.mjs [device]
public/ui/get-help.js       the Get help button and the report shown in place (no pop-ups, toasts or tooltips)
public/pages/common.js      Get help at the bottom of the troubleshooting panel (built-in device pages, not connected)
public/pages/my-device.js   Get help on an added device's "Waiting for" panel
public/pages/settings.js    Settings > Get help (its own card under Startup since 22 Oct 2026): a picker (DeviceHub in general, or one device)
helpers/share-device.mjs    personalText is now exported (one word); nothing else changed
tests/get-help.mjs          offline: report built, personal data taken out or refused, link within the limit
```

## The report

Title: `Help: <device> (<vid:pid>), not connected|asleep|connected`, or `Help: DeviceHub <version>` in general.
Body, in this order:
- a first line for the person to fill in ("What I was doing, and what went wrong");
- DeviceHub's version (`release.json` commit or package version, plus the running build hash from `/api/version`) and
  Windows (11 or 10 from the build number, `DisplayVersion` from the registry, the build);
- the device: name and kind, status, its error, each USB vid:pid with Windows' name for it and whether it is plugged in
  (`deviceProfile` from diagnose.mjs + pc-map's USB list), the driver (built in / built in VIA / sound-only headset /
  "from the device library: <entry> (status ..., tested <date>, settings not turned on yet)" / "learned on this PC with
  the learning wizard" / "added on this PC by hand"), and up to 8 info fields (keys naming a serial, address, MAC,
  instance, path, user, owner or name are left out);
- in general instead: every device with its status and error;
- what `diagnose()` found (all findings, its "looks fine" one included, with each fix);
- the log: the last 12 relevant lines of server.old.log + server.log, each cut to 200 characters, a repeated line kept
  once with "(N times)". For a device: lines naming its id, its my-devices folder, its title or its USB vendor id, plus
  helper/watchdog lines and real crashes. In general: problem lines (error, failed, cannot, crash, ...). Routine noise
  (`no cable change`, `[agent] running`, `-1` restarts, backups) is skipped.

## Personal data

Every part is stripped before it is put together, then the whole title and body go through Share's own check
(`personalText` in share-device.mjs) plus IP addresses:
- `C:\Users\<name>` (not Public/Default, either slash) -> `%USERPROFILE%`; `/Users/<name>`, `/home/<name>` -> `/<user folder>`
- a device instance id tail -> `VID_xxxx&PID_xxxx (instance id removed)`; `serial: X` -> `serial: <removed>`
- MAC addresses -> `<address>`; e-mail addresses (not example.com/localhost) -> `<e-mail>`
- IPv4 (not 127.0.0.1 or 0.0.0.0) and IPv6 (full or with `::`) -> `<IP address>`
- this PC's user and computer names (`personalNames()`, as Share) -> `<name>`

The page lists what was taken out and how many of each. If the check still finds anything, the report shows with the
line numbers and reasons, and there is no Open button (`ok: false`, no url, no token).

## The link and opening it

- `issueUrl(title, body)` encodes like Share (URLSearchParams, `+` as `%20`); no label (GitHub ignores labels from
  people without triage rights). Limit: Share's `MAX_URL` (8000). To fit: log lines dropped oldest first, then
  findings cut to 3 with shorter reasons, then the body cut with "(Cut to fit GitHub's link limit.)". The page shows
  exactly the text in the link and says how many log lines were left out.
- `report()` keeps the link under a random token (30 min, 20 at most). `POST /api/help/open {token}` opens only that
  link, only if it starts with the new-issue address, is within the limit, has plain URL characters only, and passes
  the personal check again. It opens through PowerShell `Start-Process '<url>'` (Windows' ShellExecute, the default
  browser; hidden window). The app window's own `window.open` would open in DeviceHub's private Chrome profile, not
  the default browser, so it is used only as the "If it did not open, use this link" fallback.
- `/api/open` (the vendor-app route) was not used: it opens only a fixed list of keys, and extending it needs a
  server.js edit. Its pattern is the same (a fixed thing the browser names, never a path or a URL it supplies).

## Lines to add (not done; owner's files)

- server.js, beside the `/api/share/` line (before the static-file handler):
  ```js
  if (url.pathname.startsWith('/api/help/')) { try { if (await (await import('./helpers/get-help.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  ```
  Until then the button answers "Could not build the report: Not Found" in place.
- package.json: add `&& node tests/get-help.mjs` to both `test` and `test:offline`, after `node tests/share-route.mjs`.
- CLAUDE.md, Checks (after the diagnose line):
  `- Someone without Claude presses **Get help** (device page's troubleshooting panel, or Settings > Get help): helpers/get-help.mjs shows a short report with anything personal taken out, then opens a filled-in GitHub issue on their click (docs/handoff/get-help.md).`
  and in the Map: `helpers/get-help.mjs      Get help: a short report, personal data taken out, a pre-filled GitHub issue opened on the person's click`

## Not checked

- The pages were not opened in a browser (the running copy is Shawn's and has no `/api/help/` route yet). All four
  page files parse as modules; `npm run test:offline` passes.
- Opening a real 8000-character link through Start-Process was not tried (it would open a browser on Shawn's PC).
  The test replaces the opener. ShellExecute passes the URL to the browser's command line (32,767 characters).
- The troubleshooting panel shows only while a built-in device is not connected; for a connected device use Settings >
  Health and pick it.
