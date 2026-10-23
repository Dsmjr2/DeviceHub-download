# Milk and Coral Reef themes; Ocean and Midnight removed (22 Oct 2026)

Shawn: "Can you make a milk theme and a coral reef theme now", then "remove the ocean and midnight theme".

Two new whole looks, picked as backdrops in Settings > Appearance, with the same coverage as Old School and Verde.
`core/theme.js` sets `html[data-skin="milk"]` / `html[data-skin="coral-reef"]`; the rules are the Milk and Coral Reef
blocks at the end of `public/style.css`. CSS gradients only: no images, no fonts, no brand names, no new animation.

## Milk (`milk`)

The one light look, like a glass of milk.

- **Panes** (rail, cards, tiles, hero, banner, dialogs, Ctrl+K, messages): glossy milk-white glass (`--glass`), a soft
  bright splash in the top-left corner (`--splash`) and a few faint ripple rings from the top-right (`--ripple`), a pale
  blue rim. Dialogs, Ctrl+K and messages sit on solid milk so nothing shows through their words.
- **Page**: cream milk with a blue-white glow at the top, a soft blue pool at the bottom and small milk droplets
  (`--droplets`). The dark grain layer is off.
- **Accent**: a pale milk-carton sky blue. The silver accent becomes `#8cc4ec` and Settings names it "Sky blue".
  The open page and the selected segment are sky-blue panes; the main button is a sky-blue cap with dark navy words;
  other buttons are milk-white beads with a pale blue edge.
- **Words**: grey-blue (`#2a3d52` body, 9:1 on the panes; muted `#45596e`, faint `#56687c`, both 4.5:1 or better),
  headings a deeper ink-blue, values in the carton's deep blue `#24557f`. Good / warn / bad are darker shades so their
  words and dots read on white. Focus rings are deep blue (the pale accent alone would be under 3:1).
- **Switches, sliders, gauges, loading bars**: pale blue tracks that fill sky blue; white knobs and handles.
- **Dark-only bits redrawn for light**: the Connected line on each tile, the status pills on tiles, the Overview's
  small battery (deeper blue fill so the cut-out digits read; grey-blue outline and digits, which were white), the
  battery chart lines and tooltip, the Keyboard page's key map (milk-white keys, so the dark labels read; pressed keys
  green with white words), its legend, the wallpaper tiles' buttons and question veil, scrollbars, selection.
- **Drawings**: a gentle milky wash (slightly lighter, a little less color) and a soft blue shadow instead of the dark
  one. Live battery is not tinted (its colors show the level); because its glass lines are light, on Milk it sits on a
  blue-grey dish inside each tile (and in its Appearance preview).

## Coral Reef (`coral-reef`)

- **Page**: deep teal-blue water, lighter at the surface, faint rays of light fanning down from the top (a conic
  gradient faded out by a dark wash), a sandy glow at the floor and a few bubbles.
- **Panes**: clear sea glass (teal tint, lit turquoise edge) with tiny bubbles (`--bubbles`) and sand and coral specks
  (`--specks`), kept sparse so words stay clean. Dialogs and Ctrl+K are more solid.
- **Coral**: headings coral (`#ffb3a3`, the page title `#ff9c87`); the open page has a coral glow and a coral edge;
  buttons are coral glass with a coral edge, the main one solid coral with dark words; the selected segment is coral;
  switches, sliders, gauges and loading bars grow coral (pink into orange) dotted with polyps (`--polyps`); switch and
  slider knobs are sand shells. The silver accent becomes `#ff7f6a` ("Coral").
- **Turquoise and sand**: labels and the Connected line turquoise, values sand, names white; messages carry a coral band.
- **Drawings**: slightly warmer with a coral cast and a deep shadow; not in Live battery.
- Body text 9:1, small text 5:1 or better on the panes.

## Ocean and Midnight removed

Their `THEME_BGS` entries are gone; `OLD_BGS` maps a saved `ocean` or `midnight` (and `plum`, which used to map to
Midnight) to Graphite. They stay on the server's allow-list so an old saved value is still read and then mapped. No CSS
belonged to them only.

## Other changes

- `server.js` (~line 389): `'milk'` and `'coral-reef'` added to the backdrop allow-list (tests/regressions.mjs section
  17 checks every backdrop is on it). Note: this line was swept into another session's commit (03e83d7, "Reset sound to
  normal") before this job was committed. **The DeviceHub already running on 5577 still has the old list in memory**:
  until it restarts, picking Milk or Coral Reef there shows the look but the server drops it on save, so it does not
  survive a reload. It saves normally after DeviceHub's next restart.
- `core/theme.js`: `SKIN_SILVER` and `SKIN_SILVER_NAME` (what the silver accent becomes on each whole look, and its
  name) replace the inline Old School / Verde checks; `pages/settings.js` reads them, and each backdrop tile carries
  `data-bg` so the Milk and Coral Reef previews draw their own mini card.
- Settings backdrop tiles: one row of seven (was six columns, which put Coral Reef on a second row and pushed Settings
  8 px past 910). The tile names shrink a little in a narrower row (container query) so "Espresso" never clips.

## Checked

Demo mode, each look applied in the page with `applyTheme` (never saved), Classic and Live battery drawings:
Overview, Mouse, Headset, Keyboard, Lighting, Monitors, Fans, Profiles, Backups, Settings, Setup, Learn a device,
Wallpapers, Ctrl+K, messages and a dialog, at 1650 x 910 and 390 x 844 (plus 1024 for the Settings tile row). A script
measured every visible text against its background: nothing under 4.5:1 on Milk; on Coral Reef the only hits were
dark words on coral buttons, which the script measured against the water instead of the button (about 7:1 on the
coral). No sideways scroll at phone width. Settings fits 1650 x 910 (cards end at 840). Overview screenshots
(Classic drawings): `docs/handoff/looks/milk.png`, `docs/handoff/looks/coral-reef.png`.
`node tests/check.mjs`, `node tests/regressions.mjs` and `npm run test:offline` pass.
