// what an added device's tile shows first, by kind (1 Nov 2026, Shawn: "show the proper buttons"): the readings its own
// page leads with, as the built-in tiles do (DPI, polling, lift-off for a mouse), instead of the driver's first three
// settings (a Razer tile showed "DPI stage 1"). The rest follow in the driver's order.
const TILE_FIRST = {
  mouse: [/^dpi$/i, /^(pollingRate|polling|reportRate)$/i, /^liftOff/i],
  keyboard: [/^(reportRate|pollingRate|polling)$/i, /^(brightness|lights|backlight)/i, /^gameMode$/i],
  headset: [/^sidetone(Level)?$/i, /^chatmix$/i, /^autoOff$/i],
};
// The DPI a mouse uses now (a review, 1 Nov 2026: an ASUS tile showed no DPI): its own dpi, else the stage in use
// (dpiStage n -> dpiStage<n> or dpi<n>), else its first stage. null when it reports none.
export function dpiInUse(v = {}) {
  if (v.dpi != null && v.dpi !== '') return v.dpi;
  const n = Number(v.dpiStage);
  if (Number.isFinite(n)) { const x = v[`dpiStage${n}`] ?? v[`dpi${n}`]; if (x != null) return x; }
  return v.dpiStage1 ?? v.dpi1 ?? null;
}
export function tileOrder(kind, settings) {
  const k = /mouse/i.test(kind) ? 'mouse' : /keyboard/i.test(kind) ? 'keyboard' : /headset/i.test(kind) ? 'headset' : null;
  // a stage's own slider is never a tile reading; the DPI in use is (pages/overview.js pluginReadouts)
  const list = settings.filter((s) => !/^(?:dpiStage|dpi)[1-9]$/.test(s.key));
  if (!k) return list;
  const rank = (s) => { const i = TILE_FIRST[k].findIndex((re) => re.test(s.key)); return i < 0 ? TILE_FIRST[k].length : i; };
  return list.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}
