# Profiles for added devices, 22 Oct 2026

Profiles now cover devices added in `my-devices` (library drivers and your own). A profile can save an added
device's current settings and put them back later, by hand or when auto-switch sees a game. `npm run test:offline`
passes. Nothing was committed, DeviceHub was not restarted, and nothing was sent to a real device.

## What a profile does with an added device

- **Save / Update** keeps every setting of each connected added device, except readings (`display`). Colors and
  remaps are saved as their values. Read-only settings are saved too: whether one may be written is decided when the
  profile is applied, so it works once Turn on settings is pressed.
- **Update** keeps what the profile had for an added device that is not plugged in right now.
- **Apply** (and auto-switch) writes a setting only when:
  - the device is connected,
  - its driver allows the write now: for a library driver the guard's own answer (passed its check, Turn on settings
    pressed, not one of DeviceHub's own ids); for your own driver, its `readOnly` mark,
  - the value is one the setting takes (`fits()` from `helpers/my-devices.mjs`),
  - the maker's app is closed ("could not check" counts as open).
- It takes a backup first. If the backup fails, nothing is written.
- Then it writes one setting at a time through the same write path as the page, which reads each one back. A value
  that reads back different counts as failed and gets its own line.
- Anything it leaves out goes in ONE plain Activity line per device, for example:
  `Profile "Night": Arctis Nova: skipped Lights (press Turn on settings on its page first), ChatMix (a reading, never written)`
- A device that is not plugged in (or not installed) is left out quietly: no line, and it is not counted.
- The Apply preview lists an added device's changes with plain values ("Wheel #ff0000, Base #ffffff", "Side: Back").
  A setting it will skip says "skipped: <why>" and is not counted in "N changes" or the card's "N differ".

## Your three devices

- They are unchanged. `profile.devices` holds only mouse, headset and keyboard, as before. Added devices go in a new
  field, `profile.added = { <id>: { title, values } }`. A profiles.json without it loads and runs exactly as before.
- I checked this two ways:
  - `tests/profiles-added.mjs` part 1 uses a file shaped like yours (two profiles, `mouse.pollingRate`, one game, no
    monitors). It checks the same rows, writes, counts and Activity lines.
  - I ran a scratch copy of `public/` once with the old `profiles.js` and once with the new one. Diff, apply and the
    quiet retry gave byte-identical results for a mouse that is connected, a headset that is asleep and a keyboard
    that is missing.

## Low CPU

- No new timers and no new polling.
- Auto-switch's existing 10 s loop calls `apply()` as before. Added devices are applied only when a profile is
  applied, never on auto-switch's quiet retry (that retry is for a built-in device that was asleep).
- The maker's-app check (one `tasklist`) runs only when an added device has something to write.

## Files

- `public/core/profiles.js`: `captureAdded`, `planAdded`, `showAdded`, `fitsLite`, `skippedLine`. `diff()` adds
  rows for added devices. `apply()` handles them after the built-in ones and skips them when `retry` is set. The
  built-in code paths did not change.
- `helpers/profile-added.mjs` (new): `applyAdded(body, { core, makerApp, fits })`, the agent's half. It does the
  checks, the backup, the writes one at a time, the read-back compare and the single Activity line.
- `helpers/agent.mjs`:
  - `env.applyAdded`, used when the agent applies a profile itself (auto-switch, the tray),
  - the agent op `profile-added` (`POST /api/agent/profile-added`), used by a window's Apply.
- `helpers/my-devices.mjs`:
  - `guard()` adds `a.mayWrite(key)`. It returns the same `allowed()` answer a write gets and writes nothing.
  - `guard()` adds `a.makerAppNow()`.
  - new export `makerAppNow(a)`: the maker's-app check for any added driver.
- `public/pages/profiles.js`: Save/Update capture added devices; added-device pills on the card; the preview rows;
  "N differ" leaves out skipped rows.
- `tests/profiles-added.mjs` (new). `tests/my-devices.mjs` runs it at the end, so `test:offline` covers it without a
  package.json change.

**server.js: no change.** `/api/agent/<name>` already passes any op to the agent, and `POST /api/profiles` already
saves whatever list it is given.

## Tests (`tests/profiles-added.mjs`)

1. Your file's shape: the same diff rows, apply result, write order (backup, then the write) and Activity lines. A
   built-in device that is not connected is still counted. An `added` entry for a missing device changes nothing.
2. Capture: no readings; colors and remaps saved as copies; read-only settings kept; built-in devices never counted
   as added.
3. Apply:
   - writes in order, backup first;
   - one skipped line for: a reading, read-only, Turn on settings, a bad value, a setting that is no longer there;
   - the maker's app open, or could not be checked: no backup and no write;
   - a failed backup: no write;
   - a read-back mismatch counts as failed;
   - asleep or unplugged: quiet;
   - the retry: added devices left alone;
   - an unknown id: quiet;
   - your own driver: `readOnly` is skipped.
4. The real `guard()` on a library folder:
   - not turned on: nothing written;
   - turned on with one setting passed and one failed: only the one that passed is written.

## Checked in the browser (demo mode, read-only)

- `http://127.0.0.1:5577/?demo#/profiles`. I added a pretend device in the page from the console. It had a slider,
  a color, two color zones, a remap, a reading and a read-only slider.
- **Save current setup** kept it without the reading. The card showed "Pretend light · 5".
- I changed its values. The card said "4 differ".
- The preview listed 4 changes in plain words, plus "Locked 7 -> skipped: press Turn on settings on its page first".
- **Apply** wrote the 4 settings in order. Activity said `Profile "Night test": 4 changed`, with one line:
  `Pretend light: skipped Locked (press Turn on settings on its page first)`.
- The tab sent no POST: no /api/profiles, no agent write, no backup. Demo profiles stay in memory.
- The console showed 404 and "error fetching the script" messages. Every module this change loads came back 200, so
  I took those messages to be from something else and did not chase them.

## Not tested

- A real added device and the live agent path: the running DeviceHub was not restarted, so it still runs the old
  agent code. A window Apply for an added device needs the new agent op, so restart DeviceHub before using it.
  Until then, a window Apply on a profile with `added` counts that device as failed, and the built-in devices still
  apply. Your profiles have no `added`, so they are unaffected.
- An added device that is asleep is left out (not retried when it wakes). Built-in devices keep their wake retry.
- The Profiles page redraws on mouse, headset, keyboard and auto changes only. An added device's change shows on the
  card's "N differ" at the next redraw.

## Lines for CLAUDE.md

- Under "What the rest of DeviceHub picks up by itself" (Adding your own devices, step 4): "Profiles (and auto-switch)
  save and apply an added device's settings (`profile.added`; `helpers/profile-added.mjs`). Readings are never saved.
  A setting is applied only when its driver allows the write now and the maker's app is closed. The backup comes
  first, then one setting at a time, read back. Anything skipped goes in one Activity line, and a device that is not
  plugged in is left out quietly."
- Map: "helpers/profile-added.mjs   a profile's part for an added device (the agent applies it; agent op profile-added)".

## package.json (optional)

Nothing is needed, because `tests/my-devices.mjs` runs the new test. If you want it on its own line, add
`node tests/profiles-added.mjs` to `test` and `test:offline`.

## Note

`helpers/share-device.mjs` has an uncommitted change I did not make (`personalText` is now exported). It is from
another session, and I left it as it is.
