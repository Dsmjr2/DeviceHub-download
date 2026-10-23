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
// nine looks (22 Oct 2026, Shawn: "truly make the themes beautiful ... add 2 more"): Neon became Noir and Duotone became
// Tonal (same keys, so a saved choice carries over); the two new ones reuse two old keys the server already accepts
// ('matte' is Titanium, 'glow' is Aurora), so they save with no server change
export const ART_STYLES = [['photo', 'Realistic'], ['frosted', 'Classic'], ['matte', 'Titanium'], ['arctic', 'Arctic'], ['neon', 'Noir'], ['duo', 'Tonal'], ['glow', 'Aurora'], ['blueprint', 'Blueprint'], ['live', 'Live battery']];
const RENAMED = { studio: 'frosted', night: 'neon', pop: 'duo' };
export function applyArtStyle(style) { style = RENAMED[style] || style; document.documentElement.dataset.art = ART_STYLES.some(([k]) => k === style) ? style : 'frosted'; }
export async function loadArtStyle() {
  try { const s = await (await fetch('/api/settings')).json(); applyArtStyle(s.artStyle); applyTheme(s); } catch { applyArtStyle('frosted'); }
  loadPicture();
}

// The person's own background picture (22 Oct 2026; server.js /api/background): shown behind everything, dimmed, with
// any backdrop. Kept on this PC only. Demo mode shows a picked one without saving it.
let picture = false;
export const hasPicture = () => picture;
function showPicture(src) {
  const root = document.documentElement;
  picture = !!src;
  if (src) { root.style.setProperty('--picture', `url("${src}")`); root.dataset.picture = '1'; }
  else { root.style.removeProperty('--picture'); delete root.dataset.picture; }
}
export async function loadPicture() {
  if (new URLSearchParams(location.search).has('demo')) return;
  try { const r = await (await fetch('/api/background?check')).json(); showPicture(r.picture ? `/api/background?v=${Date.now()}` : null); } catch {}
}
export async function savePicture(file) {
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) { showPicture(URL.createObjectURL(file)); return { demo: true }; }
  const r = await fetch('/api/background', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  showPicture(`/api/background?v=${Date.now()}`);
  return j;
}
export async function removePicture() {
  if (!new URLSearchParams(location.search).has('demo')) await fetch('/api/background/remove', { method: 'POST' });
  showPicture(null);
}

// The theme (Settings > Appearance, 21 Oct 2026, Shawn: "a simple theme area ... so people can customize it"): an accent
// color (buttons, selections, switches, and the Neon and Duotone drawings) and a backdrop. Saved in DeviceHub's settings
// (themeAccent, themeBg), so it syncs with the other settings.
export const SILVER = '#dfe2e8';
// more accents, calmer ones first (22 Oct 2026, Shawn: "more options ... more minimal")
export const THEME_ACCENTS = [[SILVER, 'Silver'], ['#d9c4a0', 'Sand'], ['#c9a27e', 'Clay'], ['#9fb3a1', 'Sage'], ['#8fb3d9', 'Mist'],
  ['#7fb4ff', 'Blue'], ['#a58bff', 'Violet'], ['#ff8f70', 'Coral'], ['#ffb454', 'Amber'], ['#5fd3a4', 'Mint']];
// backdrops: [key, name, page color, the soft pools' tint]. Plum and Forest went (22 Oct 2026, Shawn: "I dont like the
// pink or green backdrop. Make it more minimal"), and so did the light Cream and Paper the same day ("no light mode");
// a saved one shows as the nearest that is left. Slate (too close to Graphite) became Ocean, a deep teal.
export const THEME_BGS = [['graphite', 'Graphite', '#050507', '110, 120, 145'], ['black', 'Black', '#000000', '55, 55, 62'],
  // Ocean and Midnight went (22 Oct 2026, Shawn: "remove the ocean and midnight theme"); a saved one shows as Graphite
  ['espresso', 'Espresso', '#0a0806', '150, 122, 96'],
  // a whole look, not only a color (22 Oct 2026, Shawn: "make an old school runescape theme"): stone panels, orange
  // headings, square buttons, black text shadows (html[data-skin="old-school"], style.css end). Drawn in CSS only.
  ['old-school', 'Old School', '#16120d', '140, 105, 60', 'old-school'],
  // a whole look on a bottle of green verde sauce (22 Oct 2026, Shawn: everything green, built around the bottle, like
  // Old School and not only a color): olive glass panels, lime neck-band heads, white headings, round cap buttons
  // (html[data-skin="verde"], style.css end). Colors only, drawn in CSS. The purple backdrop added the same day was removed (Shawn); a saved one shows as Verde.
  ['verde', 'Verde', '#0b0e04', '125, 139, 42', 'verde'],
  // two more whole looks (22 Oct 2026, Shawn: "Can you make a milk theme and a coral reef theme now"): Milk, the one
  // light look (glossy milk-white glass, a pale sky-blue accent, grey-blue words), and Coral Reef (deep teal water,
  // sea-glass panes, coral headings, buttons and bars). html[data-skin="milk"] / ["coral-reef"], style.css end. CSS only.
  ['milk', 'Milk', '#f4f2ec', '140, 180, 220', 'milk'],
  ['coral-reef', 'Coral Reef', '#03202a', '30, 150, 160', 'coral-reef']];
const OLD_BGS = { plum: 'graphite', ocean: 'graphite', midnight: 'graphite', forest: 'graphite', cream: 'espresso', paper: 'graphite', slate: 'graphite', 'taco-night': 'verde' };
const theme = { accent: SILVER, bg: 'graphite' };
// what the silver accent becomes on each whole look, and its name in Settings
export const SKIN_SILVER = { 'old-school': '#ffb83f', verde: '#8cc63f', milk: '#8cc4ec', 'coral-reef': '#ff7f6a' };
export const SKIN_SILVER_NAME = { 'old-school': 'Gold', verde: 'Verde', milk: 'Sky blue', 'coral-reef': 'Coral' };
export const currentTheme = () => ({ ...theme });
export function applyTheme(s = {}) {
  if (/^#[0-9a-f]{6}$/i.test(s.themeAccent || '')) theme.accent = s.themeAccent.toLowerCase();
  const bgKey = OLD_BGS[s.themeBg] || s.themeBg;
  if (THEME_BGS.some(([k]) => k === bgKey)) theme.bg = bgKey;
  const bg = THEME_BGS.find(([k]) => k === theme.bg);
  if (bg[4]) document.documentElement.dataset.skin = bg[4]; else delete document.documentElement.dataset.skin;
  // on Old School the silver accent is the game's gold, on Verde the verde green, on Milk a milk-carton sky blue, on
  // Coral Reef coral
  const r = document.documentElement.style, a = (theme.accent === SILVER && SKIN_SILVER[bg[4]]) || theme.accent, silver = a === SILVER;
  // text on the accent: dark on a light color, white on a dark one
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  r.setProperty('--signal', a); r.setProperty('--signal-ink', lum > 0.55 ? '#111216' : '#ffffff');
  r.setProperty('--theme-art', silver ? '#7fb4ff' : a);
  r.setProperty('--switch-on', silver ? 'var(--good)' : a);
  r.setProperty('--bg', bg[2]); r.setProperty('--pool', bg[3]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg[2]);
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
