# Wording and docs pass (22 Oct 2026)

From a cold-read audit by a new person with a Logitech Superlight 2, Arctis Nova 7, Keychron Q1 Pro, Razer
BlackShark V2 Pro and Glorious Model O. Each claim was checked against the code before it was written.

## UI text and flow

- `public/pages/learn.js`
  - Pick step: a device with a shared driver now says "a shared driver exists for it: install it from Set up on the
    Overview" (the Set up card's Install button; another job adds that button).
  - Get ready step: a faint line "Colors, button remaps, macros and EQ cannot be learned yet: pick a number, an on or
    off, or a choice."
  - Driver and Saved steps: "self-check" and "read-only" replaced with "DeviceHub tests each setting once by writing
    back its current value". The Saved pill reads "reads only, for now".
  - Saved step: "Sharing needs a free GitHub account: it opens a GitHub page that offers the driver to the shared
    library."
  - `rail: false` removed: Learn a device is in the sidebar under App (after Settings).
  - New `learnThis(vid, pid)`: the caller's device goes first on the Pick step with a primary button and "the one you
    picked on This PC"; if it is not in the list, one line says why it may not be. Cleared once a device is begun.
- `public/app.js`: only the comment over the App group (no rail:false page left).
- `public/pages/pc-lights.js`: "Learn it" calls `learnThis(u.vid, u.pid)`. The `title=` hover text on Learn it and
  Copy a prompt is gone. A VIA keyboard brand (brand guide transport `via-qmk`, category keyboard) also shows the
  maker's-file note (below).
- `public/pages/keyboard.js`: new `viaFileNote(vid, pid, maker)` and `isViaKeyboard(u)`. While no keyboard runs, the
  Keyboard page lists the VIA-brand keyboards This PC found, each with the exact file name (`<VID><PID>.json`
  uppercase, as `helpers/via-defs.js` definitionFor looks for it, e.g. `34340610.json`), "from Keychron's website"
  (the brand's name), the via-definitions folder, restart, and an Open folder button (`POST /api/reveal`, the same
  call Settings and the first-run screen use; it opens DeviceHub's folder, which holds `via-definitions`).
- `public/pages/my-device.js`: under Share this driver, a faint line "Needs a free GitHub account: it opens a GitHub
  page that offers this driver to the shared library...". Its `title=` hover text is gone.
- `public/pages/overview.js` first-run screen only (not the Set up card): no longer names Shawn's three devices or
  "open this folder in Claude Code"; says the shared library sets known devices up by itself and that most VIA
  keyboards, sound, monitors and webcams need no setup; a primary **Learn a device** button; each "Found on this PC"
  device gets **Learn it** (with `learnThis`). Open folder stays, as a ghost button.
- `public/devices/headset-adapter.js`: both "ADD-YOUR-DEVICES.md" strings now say "teach them in Learn a device".
- `public/pages/headset.js`: for any other USB headset, if a my-devices driver of kind Headset from the same maker is
  connected or asleep (its title contains the brand guide's maker name, e.g. "SteelSeries"), one line: "Battery and
  its own settings: on its <title> page. Open it". Data already on the page (`devices`); a match by maker, not by
  USB id (the agent does not send a plugin's ids).

## Docs

- `device-library/README.md`: read-only entries ARE installed by auto setup (guarded until each setting passes);
  `installFromLibrary` without `readOnly: true` is tested-only; auto setup loads at once or says to restart.
- `docs/handoff/more-drivers.md`: Wooting key depth now read as an info line through `hid.extra` / `extraChannel()`;
  Turtle Beach now asks with `getInputReport()` (helper `IGET`) when no report arrives.
- `docs/brands/turtle-beach.md` (Covered section): the same GET_REPORT update.
- `docs/brands/wooting.md`: FSET / FGET exist (step 1 marked done), key depth is an info line, a live view is left.
- `docs/TOP-BRANDS.md`: Logitech line names the library driver (Superlight 2, PRO 2 listed); Wooting line; the Learn
  a device wizard added to "What needs no learning"; headsets = USB only (Bluetooth: battery only); VIA keyboards:
  Keychron Pro/Max/HE/8K need Keychron's file; monitors: color preset and color balance when the monitor lists them
  (helpers/monitors.js reads VCP 0x14 and the color gains; README's table said only brightness/contrast/volume, now
  fixed too).
- `ADD-YOUR-DEVICES.md`: new "Without Claude" section first (auto setup and the library, what needs no setup, Learn a
  device, Settings > Optional tools, Share); the old intro is now "With Claude Code"; the VIA bullet has the Keychron
  Pro/Max exception with the file name example.
- `README.md`: the "Different devices?" line and the paragraph under the table (library of 11 drivers, auto setup,
  the wizard); Monitors row; VIA row's Keychron exception.

`npm run test:offline` passes. Checked in demo mode (read-only): Learn a device is in the sidebar; Lighting > This
PC > Learn it opens #/learn; `viaFileNote('3434','0610','Keychron')` renders "...rename it 34340610.json...".

## Not done, for other owners

- **The keyboard page cannot see the real failure.** `helpers/agent.mjs` only logs "no layout (not in VIA's library:
  ...)". The note is shown from the brand guide instead (a Keychron that nothing runs), worded "If its keys do not
  show...". Better: the agent sends `{ vid, pid, name, file }` for a VIA keyboard whose definition failed (for
  example in `/api/setup` or the keyboard snapshot), and the page shows the note only then.
- **Set up card strings (helpers/auto-setup.mjs, not mine):** "library driver (read-only)", "untested", "self-check"
  and "POST /api/library/install ..." appear in the summary lines. Suggested: "<title>: from the shared library; for
  now it only reads. DeviceHub tests each setting once by writing back its current value when it connects." and,
  for a not-yet-run entry, "<title>: a shared driver exists but has not been run on this device yet: Install it to
  try it." Also its `works` line "a VIA keyboard, its keys and lights work with no setup" is wrong for Keychron
  Pro/Max boards.
- ADD-YOUR-DEVICES.md and learn.js name the Set up card's **Install** button, which another job is adding.
- Existing toasts (Copy a prompt, Share errors) were left as they are.

## CLAUDE.md lines (for whoever owns it)

- In the hid-host notes (about line 227-230), after the feature-reports bullet:
  `- **Input reports on request and a second collection** (22 Oct 2026, docs/handoff/hid-input-reports.md):
  getInputReport(id, length) on a channel with hid.inputReports (the helper's IGET, HidD_GetInputReport; Turtle
  Beach), and hid.extra: [{ name, page, usage, ... }] with extraChannel(name), a listen-only second collection
  (Wooting key depth). Nothing can be sent on an extra channel.`
- Step 3 (about line 231): `3. **The person can do this without Claude**: Learn a device, in the sidebar under App
  (also Overview > Set up > Learn a device, and Lighting > This PC > Learn it, which picks that device) listens
  while ...`
