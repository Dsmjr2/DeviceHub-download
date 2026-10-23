# Friend's problem reports 3, 4 and 5 (22 Oct 2026)

Reports from one friend's PC (install `dc833c73b551`, DeviceHub 779b46ab1fff, Windows 11 25H2), issues
Dsmjr2/DeviceHub-support#3, #4 and #5. Nothing here was run on a real device; everything is checked in simulation.
Not committed. The issues are still open: reply and close them once this is published.

## 1. The crash: "Error: no reply to 06 ff bb 08" (issue 5, exit code 1)

**Cause.** The HyperX Cloud library driver (`device-library/hyperx-cloud/device.mjs`, `Link.sendNow`) started its
reply timer before it sent the request. When the send itself took longer than the 1.5 s wait (the helper waits for
its own echo), the timer rejected the reply promise while nobody was waiting on it yet. Node treats that as an
unhandled rejection and ends the process with code 1. `06 ff bb 08` is the boom-mic read. The old driver gives exactly
this error in `tests/sim-hyperx.mjs`.

**Fix in the driver.** The listener is still set up before the send, so a fast reply is not missed. The wait starts
only after the send finishes, and the reply promise always has a handler.

**Fix for every driver.** New `helpers/driver-guard.js`, installed at the top of `server.js`:
- an unhandled rejection or uncaught error whose stack points into `my-devices\<folder>\`, `device-library\<folder>\`
  or `helpers/declarative-driver.mjs` (learned driver.json drivers) is logged as one line
  (`[driver] <folder>: ... (DeviceHub kept running)`), and DeviceHub keeps running. Only the first 5 are logged, then
  one line in every 50.
- the agent marks that driver's device (`core.driverFault` in `public/core/devices.js`): asleep for a "no reply"
  (its next look asks again), otherwise in error (retried every 30 s). One Activity line is written.
- an error from DeviceHub's own code is unchanged: logged as `[crash] ...`, the server exits with code 1, the launcher
  restarts it and the crash report still counts it. That way DeviceHub's own bugs are never hidden.

Test: `tests/driver-guard.mjs` (now in `npm test` and `test:offline`). Each case runs in its own Node process:
- a driver request that times out after the caller stopped waiting: the process keeps running;
- a driver that throws from its own timer: the process keeps running;
- DeviceHub's own unhandled rejection: the process still exits with 1.

`sim-hyperx` also checks that a slow send still gets its reply, and that no unhandled rejection happens when the
caller gives up.

## 2. HyperX Cloud II Wireless (03F0:0696): 5 of 8 settings failed the self-check (issue 4)

The driver offered all 8 settings it knows for any model. The Cloud II Wireless has reads only for mic mute, sidetone
on/off and auto-off. The sources agree:
- HeadsetControl `lib/devices/hyperx_cloud_2_wireless.hpp` reads only battery (02), charging (03) and inactive time
  (22 set / 07 get).
- HyperHeadset `src/devices/cloud_ii_wireless_dts.rs` has mute 20/05, sidetone 21/06 and auto-off 22/07. Its voice
  prompt packets are commented out with "Doesn't work", silent mode returns None, and noise gate and the -5..5
  sidetone step are not there at all (those belong to the Cloud II Core and Cloud III).

So the driver's `settings` is now a getter: only the settings the connected model reads (the same way the Corsair
and Logitech drivers do it). Before any headset is found it is the full list; after that, the last model found.

| Model | Settings offered |
| --- | --- |
| Cloud II Wireless | mic mute, sidetone, turn off after |
| Alpha Wireless | those three, plus sidetone level 0-128 and voice prompts |
| Cloud III Wireless | sidetone, mic mute, turn off after, silent mode (read only) |
| Cloud II Core Wireless | those four, plus sidetone step and noise gate (read only) |

In simulation the self-check now checks 3 settings and passes 3. The old `verified.json` entries for the 5 dropped
settings are no longer looked at.

**"Sidetone level (raw): 231"** is the reply to get `0B`. HyperHeadset calls it "side tone volume" and passes the byte
on as it is. HeadsetControl does not read it at all. No source gives a range or scale (231 = 0xE7), so the number
means nothing to the person and is no longer shown (nor the Cloud III's raw `88`). It stays in the raw backup.
`device.json` says the same.

## 3. "Pulsar X-Lite CrazyLight: missing" and "Corsair HS80: missing" on a PC that never had them (issue 3)

The sidebar and Overview already show only devices this PC has seen (`seen-devices.json`, `shownDevices`). The report
was the leak: `helpers/get-help.mjs gather()`, used by the problem reports and Get help, listed all three built-in
slots, and so did Settings > Copy for help (`/api/report/short`). Both now list:
- devices seen on this PC before;
- devices that are connected, asleep or connecting now;
- every added driver (`shownInReport`).

On Shawn's PC all three are seen, so nothing changes there.

The headset slot falls back to any USB headset in its sound-only mode, and that used to mark "headset" as seen. Since
the slot's name goes back to "Corsair HS80" when that headset is gone, the agent no longer records "headset" as seen
for a sound-only headset. Once at start, it also drops an old "headset" entry when `last-device-values.json` shows the
last headset was another model. Shawn's saved headset is "CORSAIR HS80 RGB Wireless", so his entry stays.

**The keyboard.** The friend most likely really has a P75. The name comes from the P75's layout and its built-in USB
entry, but the slot only connects to 342D:E479 when no other VIA keyboard's layout was found. It also refuses a board
whose keymap does not match the P75's measured keys (Esc, 1, Q, A in place). "Connected" means a board with the P75's
USB id passed that check.

The name now comes from the connected keyboard itself: `keyboard-adapter.js` `title` uses the keyboard's own USB name
whenever it differs from the layout's name. For the P75 (EPOMAKER P75) it stays "Epomaker P75" as before.

## 4. Exit code 1073807364 (issue 3)

1073807364 = 0x40010004, `DBG_TERMINATE_PROCESS`. Windows ends a console program with this code when its console gets
the close, sign-out or shutdown event. Its sibling -1073741510 (0xC000013A, `STATUS_CONTROL_C_EXIT`) is for Ctrl+C or
Ctrl+Break. Neither is a fault in DeviceHub:
- `helpers/auto-report.mjs crashBefore` no longer reports either code (`CLOSED_BY_WINDOWS`);
- Settings > Health's "crashes today" no longer counts them.

A real crash (code 1) is still reported. The launcher lived on and restarted the server, so it was not a full
sign-out or shutdown. The cause on that PC (the console closed, or Windows closing apps) cannot be told from the report.

## Not done / for Shawn

- The tray menu still lists the three built-in slots as "not connected" on any PC (`helpers/native/tray.cs`; a C#
  change that rebuilds the helper). It uses plain names (Mouse, Headset, Keyboard), not the device names.
- The friend gets these fixes with the next published version, or the HyperX one alone through the signed library
  bundle (`node helpers/make-library-bundle.mjs`).
- `npm run test:offline`: every test after `check.mjs` passes. `check.mjs` itself stops on
  `public/pages/pc-lights.js` line 157 ('on the board's SMBus': an apostrophe inside single quotes). That file is the
  lighting job's work in progress, not this change.
