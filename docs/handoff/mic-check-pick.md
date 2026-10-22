# Mic check follows the picked headset (22 Oct 2026)

Before: the Mic check's test recording always recorded the HS80 mic, even with another headset picked on the
Headset page. The live meter already tried the other headset, but matched its mic by the headset's USB name
("Arctis Nova 7 Wireless Gaming Headset"), which Windows' mic name ("Microphone (Arctis Nova 7)") does not contain.

## What it does now

- **HS80 picked, or the HS80 the only headset:** exactly as before. The meter opens the browser mic with "HS80" in
  its name; the test recording sends the same `POST /api/mictest/start { mic: 'headset' }`, and server.js records the
  HS80 mic (the cable's first). Also when `DEVICEHUB_HEADSET_GENERIC=1` runs the HS80 as any headset.
- **Another USB headset picked:** the meter opens that headset's mic, found by its Windows mic name, its name, or the
  "(1038:12e0)" Chrome adds to USB mics. The test recording asks the helper for that headset's sound devices by USB
  id (`/api/corsair/hs80-endpoints { usb }`, which already took a USB id) and records its working mic
  (`/api/corsair/mic-rec-start { id }`). Status, Stop, playback and Delete are the same calls as before.
- Picked headset off: "The headset mic is not connected. Turn the headset on." Nothing else is recorded instead.
- AnkerCamera choice: unchanged.
- While recording another headset the line says "Recording the Arctis Nova 7…"; the HS80 still says "Recording…".
- Never changes Windows' default devices. No popups, no new polling.

## Files

- `public/core/mic-test-pick.js` (new): `micTestUsb`, `micTestId`, `micMatcher`, `startMicTest`.
- `public/pages/mic-meter.js`: uses them.
- `tests/regressions.mjs` section 15: the HS80 path sends the very same request as before; another headset records
  its own mic; a headset that is off records nothing; the meter matches the right mic. It fails if the logic is
  broken (checked by breaking `micTestUsb`).

No server.js change was needed. These are page files, so they work after a page reload; no DeviceHub restart.

## Other headset audio tools checked

- EQ, mic boost and mic filters: already follow the pick (`helpers/headset-pick-eq.js`).
- `helpers/audio-follow.js` (moving Windows between the HS80's cable and receiver) is HS80-only by design; left alone.
- The "Not on for ... yet" banner line from docs/handoff/headset-picker.md is already in server.js (`eqapo.devices()`).

## Checked

- `npm run test:offline` passes.
- Demo, `?demo&headsets=2#/headset`: Arctis Nova 7 picked, Record shows "Recording the Arctis Nova 7…"; HS80 picked,
  "Recording…". No requests to `/api/mictest`, `/api/corsair` or the agent.
- Not tried on the live page or real hardware: nothing on Shawn's real audio was pressed. Not tried with a real
  second headset.
