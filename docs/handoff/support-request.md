# Handoff: Request support in one click, and generic 2.4G receivers (22 Oct 2026)

Goal (owner): someone with a device DeviceHub has no driver for asks Shawn for one with a single click and no GitHub
account; a cheap 2.4G receiver on a chip maker's id is named plainly instead of being offered for learning.

## What

```
helpers/support-request.mjs   builds the request (read-only), strips it, sends it through auto-report's send path
helpers/auto-report.mjs       sendNow(): a clicked report with the same checks; sentToday(fp)
helpers/get-help.mjs          route POST /api/help/request/send (inside handle(), so server.js is unchanged)
public/ui/get-help.js         Request support tries the one-click send first; fallback = the GitHub request as before
public/core/generic-dongle.js the chip list (with sources), genericDongle(u), the plain line
helpers/auto-setup.mjs        summary(): a generic receiver is a "generic-dongle" item under Ready to use
public/pages/overview.js      Set up card: Request support on generic-dongle items; first-run list: the line
public/pages/pc-lights.js     Lighting > This PC > Other devices plugged in: the line, no Learn it for a receiver
public/style.css              .gh-note.good; the sent line takes the full row in a Set up item
tests/support-request.mjs     stand-in relay, pretend folder, no network (not yet in package.json, see below)
```

## Request support

- Click: `POST /api/help/request/send { vid, pid, name }`. Answers `{ sent: true, line }` (also for a second click the
  same day, `already: true`), `{ queued: true, line }` (relay not reachable: tried again after 1 and 5 minutes by
  itself; giving up frees the device for another click), or `{ fallback: true, why }`.
- The page shows one plain line in place of the button: "Sent to Shawn. When a driver is added, DeviceHub picks it up
  by itself." (queued: "Shawn could not be reached just now. DeviceHub tries again in a few minutes by itself.").
- Fallback (today's behaviour, the GitHub request shown in full first): auto-report not started (isolated mode),
  helpers/report-config.json missing or wrong, settings.json `autoReport: false`, the owner's PC (git origin
  Dsmjr2/DeviceHub or `ownerPc: true`), 10 reports already today, a 4xx from the relay, or the request still looks
  personal after stripping.
- Payload `{ v: 1, install, fingerprint: "support:<vid>:<pid>", version, title, body }`, the same six fields as the
  problem reports; the test runs it through relay/worker.js `checkReport`. **relay/worker.js is not changed**, so no
  redeploy is needed. Note: the relay labels every issue `problem`; support requests are told apart by the title
  ("Support request: ...") and the fingerprint `support:...` in the relay's footer line. If you want a `support` label,
  that is a worker change (`labels: [r.fingerprint.startsWith('support:') ? 'support' : 'problem']`) and a redeploy.
- Title: `Support request: <device name> (<VID>:<PID>)`. Body: Windows' name (or the HID product string), USB id, maker
  from the brand guide or the generic receiver line, each HID collection of that vid:pid (interface, collection, usage
  page and usage, input/output/feature report lengths, report ids) from helpers/learn-hid-list.ps1 through
  learn-wizard's `deps.listHid` (access 0 only, nothing sent to any device; at most 12 lines), the maker's app when its
  install folder exists (vendor-files.mjs APPS, a folder check only), DeviceHub and Windows versions.
- Personal data: each part through get-help `strip()`, then auto-report `finalCheck()` with get-help `findPersonal()`.
- Once per device per install per day: auto-report-state.json, shared with the problem reports (and their 10 a day).
  A second click the same day does not read the HID list again.
- The switch in Settings ("Send problem reports to Shawn") also covers these requests.

## Generic 2.4G receivers

`genericDongle({ vid, pid, name })` is true for:
- `258A` Sinowealth: a device Windows gives no name or a receiver-like name ("receiver", "dongle", "2.4G", "wireless
  mouse/keyboard/device"), except the product ids docs/brands/glorious.md names for real Glorious models (0033, 0036,
  2011-2014, 2022-2025). Sources: docs/brands/glorious.md, docs/BRANDS.md shared chip ids.
- `22D4` Laview, `04D9` Holtek, `0C45` Sonix: only with a receiver-like name (these also make branded keyboards and
  webcams). Sources: docs/brands/glorious.md (Laview), docs/BRANDS.md shared chip ids.
- Not included: Compx and other dongle chips the brand guide does not list (for example `25A7`). Adding one needs a
  sourced line in docs/brands.json first, then one entry in `GENERIC_DONGLE_CHIPS`.

The line: "A generic 2.4G receiver (Sinowealth chip). These usually have no settings to learn; it works as a normal
mouse or keyboard." Shown on the Set up card (Ready to use, with Request support), Lighting > This PC > Other devices
plugged in, and the first-run "Found on this PC" list (both with Request support and without Learn it). Learn a device
is unchanged and still refuses 258A and 22D4.

## Lines for you (files I did not edit)

package.json: add ` && node tests/support-request.mjs` after `node tests/request-support.mjs` in both `test` and
`test:offline`.

CLAUDE.md, at the end of the "Works on my device" paragraph in step 2:
"**Request support** (docs/handoff/support-request.md): on a friend's PC it sends Shawn a short request through the
problem-report relay in one click (once per device per day, never from the owner's PC); elsewhere it opens the GitHub
request as before. A receiver on a shared chip id (Sinowealth 258A; Laview, Holtek, Sonix when named a receiver) is
shown as a generic 2.4G receiver with no settings to learn."

public/pages/learn.js (the other agent's file), if the line should show in Learn a device's list too:
- add `import { genericDongle } from '../core/generic-dongle.js';` and `import { getHelp } from '../ui/get-help.js';`
- in the device row (today line 104), replace `d.refused || d.note || null` with
  `genericDongle({ ...d, name: /^USB device /.test(d.name) ? null : d.name })?.line || d.refused || d.note || null`
- and in place of `d.refused ? null : button('Learn this one', ...)` use
  `d.refused ? (genericDongle({ ...d, name: /^USB device /.test(d.name) ? null : d.name }) ? getHelp(\`request:${d.vid.toLowerCase()}:${d.pid.toLowerCase()}\`, null, { label: 'Request support', request: { vid: d.vid, pid: d.pid, name: '' }, kind: 'ghost small' }) : null) : button('Learn this one', ...)`
  (`groupDevices` names a nameless device "USB device VID:PID", which is why the name is cleared first.)

## Checked

- `node tests/support-request.mjs`: all good (one click = one send; checkReport passes; nothing personal; second click
  the same day sends nothing; the next day sends again; no network = queued then two tries; 4xx = fallback; owner PC by
  settings and this repository by git origin send nothing and write nothing; reports off and no relay fall back; the
  route; the dongle rules; the Set up card item).
- `npm run test:offline`: all good. `node tests/pages.mjs`: all good.

## Not checked

- No real request was sent (the owner's PC never sends). The first will come from a friend's PC:
  `gh issue list -R Dsmjr2/DeviceHub-support --search "Support request"`.
- Not looked at in the running app; it takes effect at Shawn's next DeviceHub restart, where it falls back to the
  GitHub request (his PC never sends).
