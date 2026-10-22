# Profiles page redesign, 22 Oct 2026

Shawn did not understand the Profiles page and approved a redesign. This is it. `npm run test:offline` passes, and so
does `node tests/pages.mjs`. Nothing was committed. DeviceHub was not restarted, and none of Shawn's real profiles
was applied, saved or changed.

## What the page shows now

**Top card.** One line, "DeviceHub switches profiles for you when games start", with the same on/off switch as
before. When the switch is off, a second line says "Off: profiles change only when you pick one." "Watching N games"
is gone, and so is the "When no game is running" list (it moved onto the cards).

**One card per profile:**
- The name, and "Active" when the devices already match the profile. This uses the same rule the old card used for
  its "active" pill (nothing differs).
- One plain line saying when it is used:
  - "Turns on when a game starts"
  - "Turns on when Valorant or Apex Legends start"
  - "Used when no game is running"
  - "Only when you pick it"

  While switching is off, the game lines add "(switching is off above)".
- **What it sets.** One line per setting, for example "Mouse · Polling rate: 4,000 Hz". It uses the device pages'
  labels and units (Hz, DPI, ms, %, Low/Medium/High, effect names), and added devices and monitors get their own
  labels. When a device is set differently right now, the line ends with "now 1,000 Hz" (or "not connected now",
  "asleep now", "not on this PC", "skipped: <why>"). This replaces "N differ". A list longer than 8 lines shows its
  first 6 and a "Show all 29 settings" button, which also says how many of the hidden ones are different right now.
- **Use now.** This is the old Apply: the same function (`applyWithPreview`, also used by the command palette), the
  same preview window and the same result message.
- **Save my current settings here.** This is the old Update. First it asks inside the card: "Replace what this
  profile sets with your current settings?" Yes / Cancel. The capture works as before: an added device that is not
  plugged in keeps what the profile had. The difference is that the profile now keeps its place in the list (Update
  used to move it to the end) and keeps any other fields it has. A short "Saved." line appears under the buttons.
- **When to use it.** One list with four choices:
  - Only when I pick it
  - When no game is running
  - When any game starts
  - When these games start: shows the game list as removable pills and "+ Add a game". That opens the programs open
    right now, plus a box to type a name, inside the card. The old picker was a pop-up window.
- At the bottom: "Saved Oct 19" in small text, and a small Delete. Delete asks inside the card: "Delete this profile?
  Your devices stay as they are."
- The play icon and the exact save time are gone.

**New profile from my current settings** (the old "Save current setup"):
1. It asks for a name inside the tile. Enter moves on and Escape cancels. An empty name, a name already used, or
   nothing connected gets a one-line note.
2. It shows the current settings grouped by device, every box ticked. Each device has one box that ticks or unticks
   all its settings.
3. Save writes the same entry as before: `{ name, color, games: [], devices, monitors?, added?, savedAt }`.

**No pop-ups.** There are no title hover texts, no browser dialogs and no toasts on this page. The only exception is
Use now: its preview window and result message are the same as Apply's before. While you type in a box, the device
redraws wait until you leave the box (`keepAlive`), so the box is never redrawn under your fingers.

## How "When to use it" maps onto the files (no format change)

| Choice | profiles.json `games` | settings.json `defaultProfile` |
|---|---|---|
| Only when I pick it | `[]` | not this profile |
| When no game is running | `[]` | this profile's name (only one profile can hold it, so picking it moves it) |
| When any game starts | `["*games*"]` | cleared if this profile held it |
| When these games start | `["Valorant.exe", ...]` | cleared if this profile held it |

- Choosing a game choice for the profile that holds "When no game is running" clears `defaultProfile` (the old
  "Leave as is").
- Deleting that profile also clears it. Before, the name was left dangling, which did the same thing.
- An older file where a profile has games AND is the default shows its game choice, and the line adds ", and when no
  game is running". Nothing changes until someone picks a choice.
- Going from "these games" to "any game" and back brings the same list back for the session.
- Choosing "When these games start" with no game added yet keeps that choice on screen while you add one.

Shawn's files map as: Desktop = "When no game is running", Gaming = "When any game starts". Auto-switch reads the same
fields the same way (`core/autoswitch.js` is unchanged), so switching behaves exactly as before.

## Files

- `public/pages/profiles.js`: the page, rewritten. `applyWithPreview` is unchanged and still exported.
- `public/core/profile-use.js` (new, no DOM): `USES`, `useOf`, `planUse`, `whenLine`, `namedGames`, `ANY`.
- `public/style.css`:
  - the profiles grid is `minmax(min(320px, 100%), 1fr)` (one column on a phone);
  - new `.prof-*` classes, all next to the existing profile styles;
  - everything else uses existing classes (`profile`, `btn`, `pill`, `text`, `files`/`file`, `srow`).
- `tests/profile-use.mjs` (new). `tests/profiles-added.mjs` runs it at the end, so test:offline covers it without a
  package.json change.
- `public/core/profiles.js`, `core/autoswitch.js`, `helpers/profile-added.mjs`, `server.js`: no change.

## Tests

- `tests/profiles-added.mjs` (unchanged checks): Shawn's file shape gives the same diff rows, apply result, write order
  and Activity lines.
- `tests/profile-use.mjs`:
  - Shawn's shape maps to idle / any, and reading the choice never changes a profile.
  - Every choice from four starting profiles and three default settings: it reads back the same choice, and only one
    profile holds the fallback.
  - Picking the fallback moves it, and leaving it clears it.
  - Named games: kept, remembered, never mixed with `*games*`.
  - Old or odd data: no `games` field, junk entries, games plus the default.
  - Every plain line.
  - Shawn's real profiles.json and settings.json, read only: they map as described and their hashes do not change.
- `npm run test:offline`: exit 0. `node tests/pages.mjs`: all 24 pages (live and demo) open with no script error.

## Checked in the browser

These were checked in demo mode (`?demo#/profiles`) at 1650x910 and at 375x812:
- **Use now:** the preview showed "Polling rate 4000 Hz -> 1000 Hz". After Apply the mouse was at 1000, the card said
  Active, and the other card said "now 1,000 Hz".
- **Save here:** Cancel closes the question. Yes saves (29 settings in demo mode), keeps the profile's place and shows
  "Saved."
- **When to use it:**
  - Gaming -> "When no game is running": the default moved, and Desktop changed to "Only when you pick it".
  - "When any game starts" cleared the default.
  - "When these games start" opened the picker. Adding a program from the list, and by typing plus Enter, gave
    "Turns on when Steamwebhelper or VALORANT start".
  - Going to "any" and back brought the list back.
- **New profile:**
  - An empty name and a duplicate name each got their note.
  - Typing a name plus Enter went to step 2.
  - Unticking Keyboard and Headset and all mouse settings but one saved `{ devices: { mouse: { pollingRate } } }`.
- **Delete:** Cancel works, and Delete removes the profile.
- **"Show all":** it opens and closes, and it counts the hidden lines that differ.
- **No writes in demo mode:** the network log showed only GETs, with no POST to /api/profiles or /api/settings.

I also opened the live page read only. It shows Shawn's Desktop (Active, "Used when no game is running", "Mouse ·
Polling rate: 1,000 Hz") and Gaming ("Turns on when a game starts", "4,000 Hz now 1,000 Hz"). Nothing was pressed.

## Notes

- `settings.json` has a new modified time (12:51 today), but its content is the same as before. The running DeviceHub
  wrote it: demo mode never sends settings.
- In demo mode, "+ Add a game" lists the real open windows, through the same read-only `/api/processes?windows` the
  old picker used.
- The console still shows "error fetching the script" messages. The earlier handoff saw them too. They are not from
  this page.
