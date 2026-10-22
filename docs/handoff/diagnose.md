# Why a device does not work (helpers/diagnose.mjs), 22 Oct 2026

The goal is to need Claude less. When a device does not work, DeviceHub works out why, says it in plain words and
offers the usual fix itself.

## What it is

- `helpers/diagnose.mjs` exports `diagnose(deviceId)`. It returns `{ id, title, status, at, ms, findings, checked }`.
  `findings` is `[{ problem, why, fix, action?, rank, code }]` with the likeliest cause first. `checked` lists what was looked at.
- Route module: `handle(url, req, res, send)` answers `GET /api/diagnose?id=<device>` and `POST /api/diagnose/action`.
- Command line, read-only: `node helpers/diagnose.mjs <mouse|headset|keyboard|my-device id>` prints the same answer.
  It needs DeviceHub to be running, because it reads the device state from `/api/agent/state`.
- The page side lives in `public/pages/common.js` `connectState` (the view shown when a device is not connected):
  - The first finding shows in a calm info banner with its fix button.
  - The other findings sit under a native `<details>` "More (n)".
  - The diagnosis is fetched again when the device's status or error changes, or on a redraw more than 30 s later.
  - Demo mode shows nothing.
  - If the route is missing (the server.js line is not added yet), the banner removes itself.

## Checks (all read-only)

| Check | Source | Finding |
|---|---|---|
| DeviceHub server and agent answer; how fast | loopback `GET /api/agent/state` (>2 s = slow) | `server-down`, `agent-down`, `slow` |
| Helper could not be built or could not start (this run) | server.log `[helper] could not be built/start` | `helper-build`, `helper-start` (open folder) |
| Helper restarted by the watchdog in the last hour | server.log `[watchdog] ... helper restarted` | `helper-restart` |
| Crash restarts in the last 24 h (code -1 is a restart from outside, not counted) | server.log `[launcher] ... exited with code N` | `crashes` |
| Update rolled back (last 7 days) | server.log `the new version stopped with code` | `rollback` |
| Maker's app running, matched to the device by USB vendor id | `tasklist /fo csv /nh` | `maker-app`, with a close action that asks first |
| Receiver, dongle or cable not on USB | pc-map `usb` (fresh while not connected) | `unplugged` |
| Present, but the device is asleep, off or out of range | state + USB | `asleep`, `off` |
| Present, channel free, not opened yet | state + USB + probe | `not-opened` |
| Another program holds the HID channel | error text (`open failed 32/5`, sharing violation, access denied) or the open probe | `held` |
| Bluetooth paired but not connected (two-word name match) | pc-map `bluetooth()` | `bt` (Bluetooth settings) |
| Windows Dynamic Lighting on for a LampArray device (my-devices only) | `findLampArrays()` + `HKCU\Software\Microsoft\Lighting AmbientLightingEnabled` | `dynamic-lighting` (Dynamic Lighting settings) |
| Library driver settings kept read-only, and why | my-devices/<name>/library.json + verified.json | `read-only` |
| Mouse settings that failed their read-back (btn0, the left click, is never written and is ignored) | snapshot `adapter.trusted` | `locked` |
| Battery when last read: 15% or less and not charging; charging | snapshot `battery` | `battery-low`, `charging` |
| A device error nothing above explains | snapshot `error` | `error` |
| Nothing found | | `none`: says what was checked |

Makers known: G HUB, Synapse, iCUE, SteelSeries GG, NGENUITY, Armoury Crate, Swarm II, Glorious CORE, the Pulsar app,
the Epomaker driver and Wootility (`MAKER_APPS`).

**The open probe.** This is the one check that touches a device channel. It runs only when all of these hold:
- the device is `missing`, `error` or `idle`;
- it is plugged in;
- it has a known HID channel (built-in SPECS or a my-devices `hid`);
- no maker's app explains the problem.

The probe opens the matching HID collection the same way the helper does (read+write access, shared) and closes it at
once. It sends no report. Win32 error 32 means a sharing violation, 5 means access denied, 0 means the channel is free.

The probe is needed because the helper turns an open failure into `GONE` (helper.cs `Work` catch), so the error code
never reaches the device state.

## Actions (only after a click)

| Action | What it does |
|---|---|
| `retry` | The page calls `connect(id)`, which is the agent's connect. |
| `settings` | Opens a page from a fixed list only: `bluetooth`, `lighting`, `sound`, `usb` (ms-settings URIs, through explorer.exe). |
| `open-folder` | Opens DeviceHub's folder in Explorer. |
| `close-app` | The UI asks again in place ("Close X now?" Yes / Cancel, no pop-up). The server refuses without `confirm: true`. Only an app in `MAKER_APPS` can be closed. It runs `taskkill /IM <image> /F` on the matched images, but never on services, updaters or crash handlers. Then it reads tasklist again and says whether anything is still running. |

## Result on this PC (22 Oct 2026, 02:15 EDT, read-only, `node helpers/diagnose.mjs <id>`)

| Device | Status | Result | Time |
|---|---|---|---|
| mouse | asleep | 1 finding, `asleep`: "The mouse is asleep or switched off. The Pulsar 8K dongle is plugged in, but the mouse itself is not answering through it. Fix: Move it or switch it on." | 2.9 s |
| headset | connected | `none`: "The headset looks fine" | 2.8 s |
| keyboard | connected | `none`: "The keyboard looks fine" | 2.8 s |

- **Mouse:** an earlier version also reported `btn0` as locked. btn0 is the left click, which is never written, so it is now ignored.
- **Headset:** checked DeviceHub, the log, speed, the maker's app, the receiver and cable on USB, and the battery (80%).
- **Keyboard:** checked the same, with the cable on USB in place of the receiver.
- **Not seen:** no maker's app was running, and the log had no crash in the last 24 h (only `-1` restarts) and no watchdog restarts.

**The banner on screen.** A scratch mock server served `public/` with a fake `/api/diagnose` (port 5598, now stopped).
In that test:
- the first finding drew with its button;
- the inline confirm appeared;
- "Yes, close it" posted `confirm: true` and showed "Closed. DeviceHub connects within a few seconds.";
- More (2) opened;
- there were no console errors.

## To switch it on

**server.js**, one line inside `api()`, next to the other routes (for example just before `if (url.pathname === '/api/reveal' ...`).
Placing it inside `api()` means the origin check applies:

```js
  if (url.pathname.startsWith('/api/diagnose')) return (await import('./helpers/diagnose.mjs')).handle(url, req, res, send);
```

Then restart DeviceHub. In the server, `diagnose` uses the live SPECS from hid-host.mjs, which cover another VIA keyboard
and my-devices channels. A separate process uses the built-in id table only, so it never loads the device helper.

**package.json:** add `node tests/diagnose.mjs` to both `test` and `test:offline`, for example after `node tests/auto-setup.mjs`.

**CLAUDE.md**, one line, for example under Checks or at the start of "Set this up" step 2:

> When a device does not work, call `GET http://127.0.0.1:5577/api/diagnose?id=<device>` first (or
> `node helpers/diagnose.mjs <device>`): it names the likeliest cause, the fix, and what it already checked
> (helpers/diagnose.mjs, docs/handoff/diagnose.md).

## Untested

These are written from documentation or source and not yet seen on a real PC:
- **Maker app process names:** iCUE and Pulsar are known. Synapse 3/4, GG, NGENUITY, Armoury Crate, Swarm II, Glorious
  CORE, the Epomaker driver and Wootility were never seen running here, so their patterns are from documentation.
  The vendor-id lists for Glorious and Swarm are partial.
- **`close-app`:** has not been run against a real app. Tray apps that run as administrator stay running, and the
  action then says so.
- **The open probe:** has not been run on this PC, because no device was missing while plugged in. A sharing violation
  (32) and access denied (5) were tested only as fake inputs.
- **Bluetooth:** only fake inputs. No device here is driven over Bluetooth.
- **Dynamic Lighting:** only fake inputs. The check uses the global `AmbientLightingEnabled` value. The per-device
  switches under `HKCU\Software\Microsoft\Lighting\Devices` are not read.
- **Library read-only:** tested through `analyze()` with fake facts. No library driver is installed here.
- **Slow server, helper build failure, crashes and rollback:** only fake log lines.
- **Generic USB headset mode:** has no USB ids, so only the log, app, battery and error checks apply.
- **Mouse asleep with known settings:** the mouse page shows the away banner, not `connectState`, so the diagnosis
  banner does not appear there. The API still answers.

## Tests

`node tests/diagnose.mjs` uses fake tasklist text, USB lists, log lines, device states, Bluetooth and LampArray lists.
It prints `diagnose (fake inputs): all good`. Nothing is opened, closed or written.
