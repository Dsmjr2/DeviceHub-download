// The keyboard's part of Lighting's Apply to all (15 Nov 2026 bug hunt). Off is brightness 0 (its color and effect stay
// for when it is turned back on). A color on a keyboard whose lights were switched off (effect None: the Overview tile's
// and the Keyboard page's Lights switch) first brings back the last effect used (kb-last-effect, else solid color),
// as the Keyboard page's own color does; before, it wrote the color, said it was set, and the keyboard stayed dark.
export function kbColorKeys({ adapter, values, rgb = [0, 0, 0], brightness = 100, off = false, last = 1 }) {
  if (off) return [['brightness', 0]];
  const keys = adapter.lightingKeys(rgb[0], rgb[1], rgb[2], brightness);
  return values?.effect === 0 ? [['effect', Number(last) > 0 ? Number(last) : 1], ...keys] : keys;
}
