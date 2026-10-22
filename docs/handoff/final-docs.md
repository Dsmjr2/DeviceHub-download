# Final docs pass, 22 Oct 2026

What the final audit found, and what changed. Nothing was committed. DeviceHub was not restarted, so the running copy
on 5577 picks up the server.js and page changes on its next start. `npm run test:offline` passes.

## Docs

- **README.md**: "11 drivers" is now 16 (twice), with the full brand list. The PC lights row says USB lights work through
  the OpenRGB 1.1 built into DeviceHub, and the motherboard and RAM need the person's own OpenRGB and PawnIO. The
  "Plus:" paragraph now names profiles for added devices, Get help and Supported devices (Learn a device was already
  there).
- **ADD-YOUR-DEVICES.md**: step 1 now says every library driver (none has a real-device record today) and every learned
  one only reads until Turn on settings is pressed and its check passes. Step 4 and "What you need" say Equalizer APO
  and OpenRGB 1.1 come inside DeviceHub (Equalizer APO installs from Settings > Optional tools > Show or the Equalizer
  card). The PC lights line matches the README. A new "Writing a driver?" line names `batteryCare`.
- **CLAUDE.md**: the optional-installs bullet says Equalizer APO and OpenRGB ship inside DeviceHub (no download), and
  the built-in OpenRGB reaches USB lights only. The rest of the list is unchanged.
- **docs/TOP-BRANDS.md**: the `logitech-hidpp-keyboard` row says the G915 TKL also works over Bluetooth (B35F, from
  its device.json).
- **public/pages/learn.js, helpers/learn-wizard.mjs** (comments): a learned driver is read-only until the person presses
  Turn on settings and its check passes.

## batteryCare in driver.json

- `helpers/declarative-driver.mjs`: `batteryCare` is a known top-level part. `validate()` refuses a rule other than
  `lowBattery` / `charging`, parts other than `key` and `value`, an empty object, a file without `battery`, a key that is
  not one of the file's settings, a key whose setting is a display or has no write (any variant), and a value that the
  setting does not take on every model (the same `check()` writes use, with `$model` ranges resolved). `fromJson()`
  hands `batteryCare` to the driver, so `my-devices.mjs` `batteryCareProblem` and `battery-care.mjs` see it as they do
  for a device.mjs driver.
- `docs/DRIVER-FORMAT.md`: the part in the example, a "Battery care" section, and safety rule 9.
- `tests/declarative-driver.mjs`: one accepted file (and `batteryCareProblem` accepting its driver) and eight refusals.
  The ASUS byte-for-byte proof still passes.
- `docs/handoff/battery-added-devices.md` still says, under "Not done", that driver.json cannot declare it; that line
  is now out of date (left as it was).

## Keyboard page

- **Open folder** (the VIA file note on the Keyboard page and Lighting > This PC) now posts
  `/api/reveal?folder=via-definitions`. In server.js only that route changed: with that one allowed value it makes
  `via-definitions` if missing and opens it; with nothing it opens DeviceHub's folder as before (Overview and Settings
  still use it that way).
- **Restart button after "Get the layout": not added.** DeviceHub has no restart route the pages use: only
  `/api/quit` (the tray), and self-update's own exit code 3. The line still says "Restart DeviceHub (tray icon > Quit,
  then open it again)".

## Overview

- The Set up card has one line under its heading: a ready-made driver reads the device at once, and Turn on settings
  lets DeviceHub test each setting, then change it.

## Note

While I was testing, the first `npm run test:offline` failed in `tests/device-library.mjs` (installNote) because another
agent was changing `helpers/my-devices.mjs` (`realRecord`) at that moment. On the re-run it passed, along with the full
chain.
