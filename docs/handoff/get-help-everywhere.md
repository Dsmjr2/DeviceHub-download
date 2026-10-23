# Handoff: Get help on every screen (22 Oct 2026)

Goal (Shawn): "put the get help area on every screen that needs it so I can fix it and they can send the request right
from where they are working on fixing something". On a friend's PC the report goes straight to Shawn through the
relay (no GitHub). On Shawn's own PC it opens the GitHub page as before.

## What

```
helpers/get-help.mjs          AREAS (monitors, fans, eq, profiles, backups, setup, learn, wallpapers; device and lights
                              as before), pageContext(), POST /api/help/report {id, area, context}, POST /api/help/send
                              {token}, canSend(), reportFor(token); relevantLog area mode; compose: area section + "On the page"
helpers/support-request.mjs   sendHelp(token), helpFingerprint(area, device), HELP_SENT_LINE "Sent to Shawn."
helpers/auto-report.mjs       isStarted() (one line)
public/ui/get-help.js         area/context options, Send to Shawn, shownErrors(), helpHere(area, { device, context, key })
public/ui/overlay.js          lastBad: the last red message and the page it was on (read only on a Get help click)
public/pages/common.js        topbar(..., right, help); deviceHelp(d); Get help moved out of the troubleshooting panel
public/pages/*.js             mouse, headset, keyboard, my-device (added and library devices), monitors (with the camera),
                              fans, learn, profiles, backups, wallpapers: Get help at the top right of the title;
                              eq-panel: at the bottom of the Equalizer card; setup: on each row that needs you (not on
                              Request support rows); pc-lights: the PC lights card keeps its one (now with the page's context)
public/style.css              .topbar.has-help, .topbar > .get-help, .su-ctl .gh-here
tests/get-help.mjs            every area builds a report from stand-in routes with personal bits planted; context; POST route
tests/support-request.mjs     Send to Shawn per area: one send, checkReport passes, support label, nothing personal,
                              once per hour, next hour again, device pages their own, owner/off fall back, queued, route
tests/lights-diagnose.mjs     one match updated for the PC lights card's new call
```

One per screen: device pages show it at the top right whether the device is connected or not (the troubleshooting
panel and the added device's "Waiting for" panel no longer carry a second one). Lighting keeps the PC lights card's
one; Fans has its own (area fans) and the Fan lights card's extra one was removed. Settings is unchanged. Overview is
not included (nothing is fixed there).

## How it looks

Closed: one small "Get help" button beside the page title (no added height). Click: "Building your report…", then in
place, across the page under the title: "Your report is ready", one line, **Send to Shawn** and Cancel, what was taken
out, and "See exactly what it says" (folded). After the send: one plain line "Sent to Shawn." On the owner's PC, or
where reports are off, the same card shows **Open on GitHub** with today's two steps. No pop-ups, toasts or tooltips;
same classes as before, so every skin draws it. The report is built only on the click.

## What each report carries

Always: DeviceHub and Windows versions, the area's facts, its findings, "On the page" (page name, the last red message
shown on that page within 30 minutes and the red lines on the page now, plus what the page adds), the area's recent
red Activity lines (last 5), and its problem log lines.

- device: as before (status, USB ids, driver, diagnose findings, its log lines) + the page's status
- lights: as before + the page
- monitors: each monitor's name/model, DDC/CI or built-in, controls, off/waiting, error, how many settings it lists;
  each camera's name and picture settings. No monitor or camera ids (they carry instance ids).
- fans: graphics card name, temperature, fan, load; the lights check's lines and problems
- eq: the headset's line, engine, headset and mic, presets (count, own vs built in; the person's preset names left out),
  prevent distortion, sound tools, speakers, which sound devices Equalizer APO is not on for, with findings
- profiles: count, what each holds by number (no profile or game names), auto-switch on/off
- backups: copies in all, per device the count and newest time (no file names); the failed go-back's red line
  comes through "On the page"
- setup: found counts, items not ready; per row the row's title and what it says, and its device
- learn: USBPcap, the session's device id and name, the maker's app, listener state and error, the setting being
  learned, each recording's value and message count, learned settings, other USB id, saved; from the page: the step,
  "setting N of M: label", what the last recording heard and what the analysis found, each setting's result, the
  problem shown
- wallpapers: picture count and size, whether Windows' wallpaper can be set, previous kept (no folder or file names)

Context is only these keys (CONTEXT_KEYS): page, error, step, progress, heard, results, item, status, detail; plain
strings, 300 characters (error and results 600). Everything goes through strip() and the personal-data check like the
rest; a refused report shows why and has no Send or Open.

## Sending

`POST /api/help/send { token }` -> `sendHelp`: only a report this DeviceHub built and kept under that token (30 min),
only where auto-report is started, the relay set up, reports on and not the owner's PC (else `{ fallback }`, the
page shows Open on GitHub with one line why). The first line becomes "The person pressed Get help on this page and
sent it.", the last "Sent by DeviceHub when the person pressed Send on this page. ..." (no "Shawn" in the body: on
this PC it is the Windows user name, which the personal-data check takes out). Then auto-report's finalCheck and
sendNow: the same relay, payload shape, day cap of 10 and retries as the problem reports.

Fingerprint `support:help-<area>[:<device>]:<UTC hour>`, for example `support:help-monitors:14`,
`support:help-device:mouse:14`. Starting with `support:` gives the relay's `support` label (relay/worker.js, no
change, no redeploy). The hour makes it once per area (per device on device pages) per hour: a second click in that
hour answers "Sent to Shawn." and sends nothing; the relay's once-a-day key includes the fingerprint, so a later hour
is a new issue.

To read them: `gh issue list -R Dsmjr2/DeviceHub-support --label support --search "Help:"`.

## Lines for you (files I did not edit)

CLAUDE.md, Checks, replace the Get help line with:
"- Someone without Claude presses **Get help** (top right of each device page, Monitors, Fans, Learn a device,
Profiles, Backups, Wallpapers; the Equalizer card; each Setup row that needs them; Lighting's PC lights card; Settings
> Get help): helpers/get-help.mjs builds a short report about that screen with anything personal taken out; on a
friend's PC Send to Shawn files it through the relay (label `support`, once per screen per hour), on this PC it opens
a filled-in GitHub issue (docs/handoff/get-help-everywhere.md)."

## Checked

- `node tests/get-help.mjs`, `node tests/support-request.mjs`: all good. `npm run test:offline` and
  `node tests/pages.mjs`: see the summary in the reply.

## Not checked

- The new routes reach Shawn's running copy only after his next DeviceHub restart (server modules are loaded once).
  Until then a click shows "Could not build the report: Not Found" in place. Nothing was clicked on his copy.
- No real send: this PC never sends. The first will come from a friend's PC.
- Not looked at by eye at 1650x910 or phone width; the button sits in the title row, which already wraps.
