# Headset picker (22 Oct 2026)

With two or more USB headsets plugged in, the Headset page used to control only the first (the HS80 if there,
else the first one Windows lists). Now a small picker sits at the top right of the Headset page, beside the status
chip, and says which headset the page controls. It shows only when there is more than one USB headset.

## What it does

- **One headset (or nothing picked):** exactly as before. The HS80 is tried first, then the first other USB headset.
  No extra Windows question is asked before the HS80 connects.
- **HS80 picked:** the HS80 runs as today: battery, mic light, sleep, logo, iCUE or direct, all through
  `helpers/hs80-direct.js` and iCUE as before. Its Equalizer APO settings are unchanged.
- **Another headset picked:** it runs in the sound-only mode any USB headset already had: volume, mic level, mutes,
  sidetone when Windows names one, and through Equalizer APO the EQ, mic boost and mic filters. No battery or lights.
  The HS80 is left alone: its light keeper in `hs80-direct.js` keeps running, nothing is written to it.
- **The EQ follows the picked headset.** Equalizer APO's headset section and mic section are written for the picked
  headset; the other one plays without DeviceHub's EQ until it is picked again. "Natural sound" stays HS80 only.
- **Remembered** in `settings.json` as `"headsetPick"`: `"hs80"` or a USB id like `"VID_1038&PID_12E0"`. The file is
  copied to `backups/settings-<time>.json` before the key is written; only that key changes. The settings route
  already keeps keys it does not know, so later Settings changes keep it.
- **Picked headset unplugged:** the page goes back to the default (HS80 first). When the picked one is plugged in
  again it is switched to on the next headset read (about a minute, the existing read; no new polling).
- **Never changes Windows' default sound device.** Switching only changes which headset the page and the EQ use.
- A switch that fails shows one short line next to the picker. No popups, toasts or tooltips.

## Files

- `public/core/headset-pick.js` (new): the pure logic (choices, short names, which headset to run).
- `public/devices/headset-adapter.js`: `setHeadsetPick()`, `headsets` and `picked` for the page; connects to the
  picked headset; in HS80 mode it looks at Windows' headset list once per normal read (cached 30 s, capped at 3 s)
  so the picker knows about a second headset.
- `helpers/agent.mjs`: reads `headsetPick` at start; new agent operation `headset-pick` (POST
  `/api/agent/headset-pick` `{ pick }`, already routed by server.js's generic `/api/agent/*` route): backs up
  settings, saves, switches, and re-applies the active EQ preset so Equalizer APO's file names the new headset
  (only when Equalizer APO is the engine; never touches iCUE). The headset snapshot now also carries `generic`
  (USB id and name), `headsets` and `picked`.
- `helpers/headset-pick-eq.js` (new) and `helpers/eqapo.js`: Equalizer APO's device list with the pick applied.
  `eqapo.devices()` is exported. Also: a headset whose sound device once had a speaker EQ no longer gets both.
- `public/pages/headset.js`: the picker. "No HS80 speaker" lines say "this headset" for another headset.
- `public/devices/demo.js`: a pretend second headset (Arctis Nova 7) with `?demo&headsets=2`. Plain `?demo` is
  unchanged (one headset, no picker).
- `tests/regressions.mjs` section 14: the logic, the adapter over a pretend Corsair helper (HS80 path unchanged,
  switching both ways, unplug, two non-HS80 headsets), and the EQ device list.

## Needs a DeviceHub restart

The adapter, agent and Equalizer APO changes run inside the server, so they start working after DeviceHub restarts.
Not restarted here. Until then the live page shows no picker (the running agent does not send the list) and works
as before.

## Optional server.js lines (not made; server.js was off limits)

1. Equalizer APO's "Not on for ... yet" banner checks the HS80's sound devices even when another headset is picked.
   Line 416, in the `/api/eq` GET route:
   `const d = await eqDevices();` -> `const d = await eqapo.devices();`
2. The Mic check's test recording (around line 448) still records the HS80 mic only (it was the same before for any
   other headset). Making it use the picked headset needs a few lines there, not one; left as is.

## Checked

- `npm run test:offline` passes (section 14 included; it fails as expected if its logic is broken).
- Demo, `http://127.0.0.1:5577/?demo&headsets=2#/headset`: picker shows HS80 | Arctis Nova 7; picking the second
  shows the sound-only page (volume 55%, mic 70%, Lights & battery card, no battery); picking HS80 brings back
  battery 64% and Lights & power. `?demo` alone: no picker. No requests to the agent from demo.
- Live page opened read-only: unchanged, no picker, no script errors. Nothing was pressed.
- Not run on real hardware with a second headset.

## Limits

- Two headsets of the same model (same USB id) show as one choice; Windows' list groups them by USB id.
- A change waiting for the HS80 while it is off, or the page's Undo, could land on the other headset if the pick is
  switched in between (both use the same volume and mute keys). Rare; not guarded.
