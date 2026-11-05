# DeviceHub 1.58: release notes draft (3 Nov 2026, not published)

Written for Shawn to read before he publishes. Nothing here is published, bumped or signed: publishing stays his call
(`helpers/publish-release.ps1`). Covers everything on `main` since 1.57 (`354727c`).

## The five lines the update pop-up shows

`helpers/release-notes.mjs --bump` writes these from commit subjects, which read like a developer's notes. To use these
plain ones, replace `notes` in `helpers/published-version.json` after the bump and before signing:

1. Instant replay: OBS keeps the last moments of a game; Alt+F10 saves them
2. Gaming mode: Best performance, no sleep and replay on in one click
3. Sleep after and Screen off after on the Laptop and PC pages
4. Learn a device understands more devices, including Pulsar-style mice
5. Lighter when idle, and many smaller fixes

## Everything, in plain words

**Instant replay (new)**
- OBS Studio can be installed from Settings > Optional tools (checked against the SHA-256 OBS publishes).
- When a game starts, DeviceHub opens OBS hidden; Alt+F10 or the Record last button keeps the last 15 s to 2 min in
  Videos\DeviceHub replays; OBS closes again after the game, so it uses nothing between games.
- Settings on the PC page: the hotkey (press the keys you want, or turn it off), length, quality, frame rate, clip
  size, your mic in clips, games only or always, games DeviceHub misses, and how much the clips folder keeps (the
  oldest of its own clips go to the Recycle Bin past the limit; No limit is a choice).
- If OBS crashes or is closed mid-game it is started again; a hotkey another running program also uses is pointed out.
- OBS's own pretend webcam is no longer listed on the Monitors page.

**Gaming mode (new)**: one switch on the PC page: Windows' power to Best performance, sleep never, Wi-Fi scans paused
(if that pause was set up) and instant replay on. Off puts each back as it was, and so does the next start if
DeviceHub was closed with it on. A second switch turns it on by itself while a game runs and off 20 s after (off by
default; one turned on by hand is never turned off by a game ending).

**Search**: type "gaming mode on" / "off", "save replay" (or "record last", "clip that"), "sleep after 30 min",
"sleep never" or "screen off after 10 min".

**Sleep and screen (new)**: Sleep after and Screen off after dropdowns, plugged in and on battery, on the Laptop page;
on a PC without a battery, on the PC page. Backed up, read back, with Undo.

**Learn a device**
- Learns devices that check each message with a constant minus the sum, store each setting with a check byte, or need a
  "take control" message around every request (as the Pulsar does).
- Learns a setting that shares its byte with other options, and changes only its own bits.
- One device on a receiver and a cable is learned and driven on both.

**Under the hood**
- Idle cost: DeviceHub listens for Windows' plug-in messages instead of looking for absent devices every few seconds:
  1.28% of a core idle before, 0.73% after (Shawn's laptop, in the tray).
- `npm test` runs every test file and lists every failure (128+ files).

## Check before publishing
- Try instant replay in a real game (Alt+F10, then the clips folder) and Gaming mode on and off once.
- Friends' PCs get OBS only if they install it themselves from Optional tools; nothing installs by itself.
