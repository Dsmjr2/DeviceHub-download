# Handoff: problem reports that send themselves (22 Oct 2026)

Goal (owner): when DeviceHub hits a real problem on a friend's PC, a report reaches Shawn by itself, with no click and
nothing for the friend to review. It goes through the relay (relay/worker.js, live at
https://devicehub-relay.dsmjr2.workers.dev/report), which files it as a private issue in Dsmjr2/DeviceHub-support,
labeled `problem`.

## What

```
helpers/auto-report.mjs     the triggers, the report, the checks, the send (GET /api/auto-report for the pages)
helpers/report-config.json  { "relayUrl": "https://devicehub-relay.dsmjr2.workers.dev/report" }: no file = no send
helpers/native.js           onProblem(fn): build failed, could not start, stopped by itself 3 times in an hour
helpers/agent.mjs           Activity lines -> noteActivity; the existing 30 s error retry -> checkDevices first
helpers/my-devices.mjs      agentDeps().selfChecked(a, r) after each self-check run
server.js                   start() once after listen (not in isolated mode); checkCrash() 2 min in; agentFailed();
                            /api/auto-report; settings.json "autoReport" in POST /api/settings
public/pages/settings.js    "Send problem reports to Shawn" switch on the Get help button's line; the safety line
public/pages/overview.js    the first-run line on the Set up card (only when reports are active)
tests/auto-report.mjs       stand-in relay, no network (in npm test and test:offline, with tests/relay.mjs)
```

## Triggers (real faults only)

| code | when | where it hooks |
|---|---|---|
| `server-exit` | this run started after the launcher's "server exited with code N" (N not -1) or "the new version stopped" line, between the previous and this run's `DeviceHub on http` line; the same line never twice | server.js, 2 minutes after start (one timeout) |
| `agent-start` | the background part threw at start | server.js catch |
| `helper-build` / `helper-start` | the helper could not be built (also the "running the shipped helper" fallback) or could not start | native.js, buffered until server.js listens |
| `helper-restarts` | the helper stopped by itself (or by its watchdog) the 3rd time within an hour | native.js exit handler |
| `device-error` | a device in status `error` (unplugged is `missing`) for over 10 minutes with an error that is not an ordinary state, and diagnose() finds no maker's app, other program, asleep, off, unplugged or Bluetooth-off | agent's existing 30 s retry; one report per episode |
| `write-check` | a `bad` Activity line on a device with "after writing" or "did not read back as written" (every read-back mismatch message), not a wait (asleep, not connected, maker's app) | agent env.onActivity |
| `self-check` | a library or learned driver's self-check ran and a setting failed (waiting settings do not count) | my-devices.mjs runCheck |

Never: asleep, off, out of range, unplugged, the maker's app (or iCUE / another program) holding it, battery, waiting
(`NOT_A_FAULT`, `ORDINARY`). An error text matching one of those restarts the 10-minute clock.

## The report

`get-help.mjs` `gather(id)` + `makeIssue()` (device report for a device, the general one otherwise), so it is already
stripped. Title `<device title or area>: <problem>`; the first line becomes `**What went wrong:** <detail, stripped>`,
the footer says DeviceHub sent it by itself. Then `finalCheck()`: get-help's `findPersonal` on the title (flagged = no
send) and the body (flagged lines dropped; still flagged = no send). `makeIssue` refusing = no send. Payload
`{ v: 1, install, fingerprint, version, title, body }`: install = 32 random hex in settings.json `reportInstall` (made
on the first send; never the PC name), fingerprint `<code>:<device id or area>`, version `devicehubVersion()`.

## When it sends

- helpers/report-config.json present, with an https URL on `devicehub-relay.dsmjr2.workers.dev`, path `/report`, no
  port, user or query. Anything else = no send. `redirect: 'error'`, 10 s timeout.
- settings.json `autoReport` not false (on by default).
- Not the owner's PC: `.git/config` origin matching `github.com[:/]Dsmjr2/DeviceHub(.git)` (DeviceHub-download does not
  match), or settings.json `"ownerPc": true`. A `.git` that cannot be read counts as the owner's (a doubt never sends);
  no `.git` (the installer zip) is a friend's. Checked on this repository: detected as the owner's (the test asserts it
  when the origin is the owner's, and that nothing is sent or written here).
- auto-report-state.json (gitignored): one send per fingerprint per day, 10 a day in all; a refused report also counts,
  so it is not rebuilt all day. A failed send (network, 5xx) is tried again after 1 and 5 minutes, then dropped; 4xx
  (shape, the relay's limits) is not tried again. server.log gets one `[report]` line per report (no words that the
  next report's log filter would count as a problem).

## Settings and pages

- "Send problem reports to Shawn" switch sits on the same line as the Get help button (no extra height); it shows only
  where reports can go (relay set up, not the owner's PC), so Shawn's own Settings do not show it. An open report
  moves it under the report (`.gh-line:has(.gh-card)`).
- Safety list: "Stays offline, except to check for updates and send problem reports (if on)". It wraps to two lines,
  so "Backs up before every change" and "Reads back every change to confirm it" became one line, "Backs up and reads
  back every change". Measured at 1650 x 910 in an isolated copy (demo): the first column ends at 845 px (851 before).
- Set up card: "When something goes wrong, DeviceHub sends Shawn a short report (nothing personal) so he can fix it.
  You can turn this off in Settings." when `/api/auto-report` says active. No popups, notifications or tooltips.

## Not checked

- No real report was sent (the owner's PC never sends; the tests use a stand-in relay). The first real one will come
  from a friend's PC; read it with `gh issue list -R Dsmjr2/DeviceHub-support --label problem`.
- The running copy was not restarted: the wiring takes effect at Shawn's next DeviceHub restart (where it sends
  nothing).
