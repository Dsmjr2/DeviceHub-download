# Verde theme (22 Oct 2026)

A whole look, like Old School, built on a bottle of green verde sauce. Picked as the **Verde** backdrop in
Settings > Appearance; `core/theme.js` sets `html[data-skin="verde"]`, and the rules are the Verde block at the end of
`public/style.css`. Colors, gradients and three small inline SVGs only: no images, fonts, names, logos or label words
from any brand (the app goes to friends).

## What it looks like

- **Panes** (rail, cards, banner, dialogs, Ctrl+K list, messages): thick sauce behind glass: an olive to lime-olive
  gradient, tiny seed, herb and chili flecks (`--specks`), a glossy highlight down the left and a softer one on the right
  (`--sheen`), a dark olive rim with a lime line inside.
- **Page**: a darker sauce with the flecks and a faint diamond check (`--check-faint`).
- **Card heads and the open page**: the lime neck band (`--band` + `--check`), white bold words. The open page has a small
  purple marker on its left, the only purple in the theme.
- **Headings** white with a dark green outline; **values** lime; **names** white.
- **Buttons**: ribbed lime caps with dark green words (`--cap`, `--cap-main` for the main one); ghost buttons stay plain.
- **Switches**: a dark well with a ridged cap knob, filled with sauce when on. **Sliders, gauges, loading bars**: fill with
  sauce and its flecks (`--pour`).
- **Bottle tiles**: the Overview's device tiles and the profile cards are drawn as the bottle: `::after` draws a ribbed
  lime cap (42% of the width), a straight neck (38%) mostly in the lime band and one S-curve of shoulder (three SVGs,
  `--b-cap`, `--b-neck`, `--b-sh`, sized by `--b-cap-h` / `--b-neck-h` / `--b-sh-h`, smaller under 700 px); `::before` is
  the body (glass highlights, the label with its lighter diamond pattern, dark foot strip and a plain circle, the sauce,
  a rounded base and a soft shadow). The tile's content starts below the shoulders, so nothing is clipped, and the tile's
  own box keeps its focus outline. The neck is shorter than the real bottle's so the Overview still fits 1650 x 910.
- Device drawings are tinted green except in the Live battery look. The silver accent shows as verde green (`#8cc63f`)
  and Settings names it "Verde".

## Readability

The label is a deeper lime than the real bottle so white words read: body text is 6:1 or better on every pane and on
the bottle bodies (measured from screenshots: the body reads about rgb(52, 101, 26)). Words on lime (buttons, the main
cap) are dark green. No animation and no blur behind panes, so it costs no more to draw than Old School.

## Removed

The purple backdrop added the same day is gone (theme.js entry, accent rule, CSS). A saved `taco-night` backdrop shows as Verde
(`OLD_BGS`).

## Checked

Demo mode, Verde applied in the page (not saved), at 1650 x 910 and 390 x 844: Overview (three devices and the batteries
strip), Mouse, Lighting, Profiles, Backups, Settings, Learn a device, Wallpapers, Ctrl+K. No sideways scroll anywhere;
Overview fits one screen at 1650 x 910. At phone width the three Overview tiles are as cramped as in every theme (names
cut, "Connected" runs past the tile edge); that is the base layout, not Verde. Screenshot: `docs/handoff/looks/verde.png`.
`node tests/check.mjs` and `npm run test:offline` pass.
