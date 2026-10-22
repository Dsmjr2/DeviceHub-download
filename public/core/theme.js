// The app's ambient glow follows the last lighting color applied to the devices.
const KEY = 'devicehub.glow';

export function getGlow() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setGlow(hex) {
  if (hex) { try { localStorage.setItem(KEY, hex); } catch {} }
  const c = hex || getGlow();
  const root = document.documentElement.style;
  if (c) root.setProperty('--glow-a', c);
}

// Drawing style (Settings > Appearance, 19 Oct 2026): frosted (default), color, outline, silver or glass. Saved in
// DeviceHub's settings, applied as html[data-art] so every drawing on every page follows it.
// the looks are variations of the real-color drawings ('frosted' is the stored name of Classic, the drawn look; 'photo' is Realistic)
// six clearly different looks (21 Oct 2026, Shawn: the old ones were "not different enough"); a look saved before then
// is shown as the nearest new one
export const ART_STYLES = [['photo', 'Realistic'], ['frosted', 'Classic'], ['blueprint', 'Blueprint'], ['neon', 'Neon'], ['duo', 'Duotone'], ['arctic', 'Arctic'], ['live', 'Live']];
const RENAMED = { studio: 'frosted', glow: 'neon', matte: 'duo', night: 'neon', pop: 'duo' };
export function applyArtStyle(style) { style = RENAMED[style] || style; document.documentElement.dataset.art = ART_STYLES.some(([k]) => k === style) ? style : 'frosted'; }
export async function loadArtStyle() {
  try { const s = await (await fetch('/api/settings')).json(); applyArtStyle(s.artStyle); applyTheme(s); } catch { applyArtStyle('frosted'); }
}

// The theme (Settings > Appearance, 21 Oct 2026, Shawn: "a simple theme area ... so people can customize it"): an accent
// color (buttons, selections, switches, and the Neon and Duotone drawings) and a backdrop. Saved in DeviceHub's settings
// (themeAccent, themeBg), so it syncs with the other settings.
export const SILVER = '#dfe2e8';
export const THEME_ACCENTS = [[SILVER, 'Silver'], ['#7fb4ff', 'Blue'], ['#a58bff', 'Violet'], ['#ff7aa2', 'Rose'], ['#ffb454', 'Amber'], ['#5fd3a4', 'Mint']];
export const THEME_BGS = [['graphite', 'Graphite', '#050507', '110, 120, 145'], ['black', 'Black', '#000000', '55, 55, 62'], ['midnight', 'Midnight', '#03060e', '60, 95, 170'],
  ['plum', 'Plum', '#08040c', '125, 85, 160'], ['forest', 'Forest', '#030806', '60, 130, 100']];
const theme = { accent: SILVER, bg: 'graphite' };
export const currentTheme = () => ({ ...theme });
export function applyTheme(s = {}) {
  if (/^#[0-9a-f]{6}$/i.test(s.themeAccent || '')) theme.accent = s.themeAccent.toLowerCase();
  if (THEME_BGS.some(([k]) => k === s.themeBg)) theme.bg = s.themeBg;
  const r = document.documentElement.style, a = theme.accent, silver = a === SILVER;
  // text on the accent: dark on a light color, white on a dark one
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  r.setProperty('--signal', a); r.setProperty('--signal-ink', lum > 0.55 ? '#111216' : '#ffffff');
  r.setProperty('--theme-art', silver ? '#7fb4ff' : a);
  r.setProperty('--switch-on', silver ? 'var(--good)' : a);
  const bg = THEME_BGS.find(([k]) => k === theme.bg);
  r.setProperty('--bg', bg[2]); r.setProperty('--pool', bg[3]);
}
export async function saveTheme(change) {
  applyTheme(change);
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) return;
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
}
export async function saveArtStyle(style) {
  applyArtStyle(style);
  // demo mode (pretend devices) shows the look but never saves it to this PC's real settings (20 Oct 2026)
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) return;
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artStyle: style }) });
}
