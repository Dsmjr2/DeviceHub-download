# Games' own settings in the setup file (12 Nov 2026)

Shawn: "I want games that I play on here to have their settings brought over" (to the laptop). Move to another PC
(Profiles) and the OneDrive copy now carry each game's own controls, sensitivity, audio and options, and its graphics
as a separate choice. Code: `helpers/game-settings.mjs`; test: `tests/game-settings.mjs`.

## Which games

A fixed list (`CATALOG`), made from a read-only scan of Shawn's PC on 12 Nov 2026. No download (Ludusavi's manifest
was not needed for 12 games). Paths come from the list on the PC that loads, never from the file.

| Game | What | Graphics |
|---|---|---|
| THE FINALS, ARC Raiders | key/gamepad binding saves; the option save key by key | the option save's Display, Scalability and Graphics options, GameUserSettings.ini |
| WARDOGS | EnhancedInput binds, GameUserSettings.ini key by key | its graphics keys |
| RuneScape: Dragonwilds | GameUserSettings.ini key by key | its graphics keys, Engine.ini |
| PEAK, How to Fish, Gamble With Your Friends | Unity PlayerPrefs (registry) value by value | Screenmanager, quality, FPS cap |
| Super Battle Golf | Config.json key by key, InputBindings.json | graphicsSettings, registry quality |
| Aimlabs | keybindings, player settings JSON key by key | graphicsSettings |
| The Binding of Isaac | options.ini key by key | window, scale, gamma, vsync |
| HELLDIVERS 2 | (keybinds are in Steam Cloud) | user_settings.config |
| Halo Infinite | (controls are in Xbox's cloud) | SpecControl settings |

Left out because they sync themselves: ROB RUN, Call of Duty, Counter-Strike 2, Terraria (Steam Cloud), Fortnite
(Epic). Nothing local found: Gears of War: E-Day, Halo MCC.

**Embark's option save** (13 Nov 2026; helpers/gvas.mjs, kind `embark`). Copied whole, it brought the PC's resolution,
window mode, frame rate limit, scalability and DLSS to the laptop with graphics off. It is an Unreal save (GVAS) whose
one map holds every option as text, so it now carries key by key: every `GameplayOption.*` except Scalability.*,
Graphics.* and Display.* (HudScale and WorldIconScale do carry; the UI and HUD aspect ratios follow the screen's
shape). Never: Legal, FTUE, Clans, BattlepassProgression, ShowPersistenceDebug, UI.State, Version, the voice chat
input and output devices, and anything NEVER matches (consent). The laptop's own file is the base: only the map's
entries, size and count change. THE FINALS keeps an AdditionalData byte array after the map; it is identical in its
September _PreUpgrade copy whose options differ, so it is not a checksum over them, and the laptop's stays. Both
Unreal tag layouts are read (5.5 for THE FINALS, 5.4 for ARC Raiders); any other shape is refused and not written. No
option file on the laptop yet: nothing is made (start the game once). The files still copied whole (THE FINALS'
and ARC Raiders' key and gamepad bindings, WARDOGS' EnhancedInput binds) were read on the laptop and hold no
graphics; Super Battle Golf's InputBindings.json and Aimlabs' UserKeybindings.json are not on the laptop and were
judged by name. tests/game-settings-embark.mjs checks all of it.

To add a game: find its settings files read-only, add an entry (`whole` for a binary or settings-only file, `ini` or
`json` to carry key by key, `reg` for Unity's `HKCU\Software\<company>\<game>`), mark graphics-only files
`graphics: true`, and add a check to the test. Never a save game, an install folder, or a file with a login.

## Rules

- Registry values (13 Nov 2026 bug hunt) are read through `reg export` and written through `reg import` of that same
  text (type `REG_EXPORT`): Unity keeps floats as 8-byte values of the DWORD type, which `reg query` printed cut to
  4 bytes, so sensitivity, FOV and volume were written wrong and Put back could not undo it. An older setup file's
  registry values are never written; save a new one. The load screen counts graphics key by key (a file holding both
  controls and graphics shows the Game graphics switch), and graphics are always off at first.
- Only on the owner's PCs: settings.json `"ownerPc": true`, or a git origin that is Dsmjr2/DeviceHub (an origin that
  cannot be read does not count).

- Never carried (`NEVER`): logins, tokens, account and session ids, audio device ids, microphone names, accepted
  terms, versions, tutorial progress, file paths.
- Graphics (`GFX`) stays as the loading PC has it unless "Game graphics" is switched on (off at first).
- A game not started on this PC yet is not written ("Start once on this PC, then load again"); a JSON file is never
  made from nothing.
- Never while the game runs. Everything about to change is backed up to `backups/game-settings/<when>/manifest.json`
  first; each write is read back. Profiles > Move to another PC > Game settings > Put back restores the newest backup
  (a file that was not there before is moved into that backup folder).
