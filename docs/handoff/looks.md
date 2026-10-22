# The drawing looks (22 Oct 2026)

Shawn: "take some real time to truly make the themes beautiful ... Add 2 more themes." There are now nine looks in
Settings > Appearance, in three rows of three. Screenshots of each look on the Overview (demo mode, 1650 x 910) are in
`docs/handoff/looks/`, plus `appearance-tiles.png` (Settings still fits on one screen).

| Look | Key | What it is |
|---|---|---|
| Realistic | `photo` | The makers' product photos. Unchanged; its rules are now kept apart from Classic's, so changing Classic cannot touch it. |
| Classic | `frosted` | The real colors (black mouse and headset, the silver P75 with white keys and navy accents) lit like a studio product shot: deeper satin gradients, a rim light around every edge, a soft sheen on the bodies, a softer shadow under each device. The real `pulsar` wordmark stays. |
| Titanium (new) | `matte` | Brushed titanium bodies with bright, diamond-cut edges, graphite fabric and keys, the accent keys anodized in the theme accent, a warm light behind each device. |
| Arctic | `arctic` | Remade as glossy white porcelain: cool blue-grey shading, an ice-blue rim, white keys on a pale plate, ice accent keys. |
| Noir (was Neon) | `neon` | Black satin devices in a dark studio, lit only by a white key light from the top left and the theme accent from behind (the accent shows in the edges, the accent keys and a faint glow underneath). Replaces the glowing outlines. |
| Tonal (was Duotone) | `duo` | Every device in light and shade of the theme accent, like a fine illustration: lighter tops, deeper sides, a tinted shadow. |
| Aurora (new) | `glow` | Frosted glass shells with a soft aurora inside, running from a cool to a warm neighbour of the theme accent, a frosted light on top and a gentle glow underneath. |
| Blueprint | `blueprint` | As approved (lines on a grid, crosshair marks and measurement ticks, no words). Finer sheet: a stronger line every fifth square and the grid fading out toward the tile's edges. |
| Live battery | `live` | As approved (smooth dark glass, only the battery has color, no percent). Finer glass: the rim lit from the top left, a faint light inside the shell, the liquid shaded smoothly from its surface to the bottom (it had a hard band), and no wordmark. |

Every look was checked on all five backdrops' kind of dark and with several accents (Silver, Rose, Mint, Amber, Violet).

## How it is built

- `public/ui/art.js`: `artDefs()` now gives each look and device a rim-light gradient (`dhr-`), a soft radial light
  (`dhg-`) and an accent-key gradient (`dha-`) besides the body and soft-part ones, plus a brushed grain pattern.
  Two new layers copy the main body shapes, hidden unless a look shows them: `.glaze` (the soft light) and `.grain`
  (Titanium). The Live liquid's gradient now spans the whole liquid.
- `public/style.css`, the block "The drawn looks, made beautiful": Classic, Titanium, Arctic, Noir, Tonal and Aurora
  share one set of rules, and each look only sets colors (custom properties), per device where they differ. Realistic,
  Blueprint and Live keep their own rules. Each rule reaches the page's drawings and that look's own tile, never another
  tile. The Lighting page's color previews ignore the new layers.
- `public/core/theme.js`: `ART_STYLES` has nine looks. The two new ones reuse two old keys the server already accepts
  (`matte` = Titanium, `glow` = Aurora), so they save with no change to `server.js`; `matte` and `glow` were removed from
  `RENAMED`. A saved Neon or Duotone shows as Noir or Tonal.

## Performance

Everything new is static: gradients and one pattern, no new animation, no new SVG filter (each drawing keeps its one
drop shadow and its small blurred floor shadow). The look backgrounds behind the Overview's devices are plain CSS
gradients. The only animation is still Live battery's (transform and opacity, off with reduced motion). Drawings in
the six engine looks no longer use `contain: paint`, which had cut off the soft floor shadow in a hard line.
