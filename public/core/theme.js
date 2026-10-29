// The app's ambient glow follows the last lighting color applied to the devices.
import { koiPond } from './koi-pond.js';
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
export const ART_STYLES = [['photo', 'Realistic'], ['blueprint', 'Blueprint'], ['glow', 'Vector'], ['live', 'Live battery'], ['neon', 'Noir'], ['frosted', 'Phantom'], ['matte', 'Outrun'], ['arctic', 'Solaris'], ['aero', 'Aero']];
// Crimson ('duo') went (26 Oct 2026, Shawn: "remove the crimson theme and replace it with a cool frutiger aero theme
// instead"): a saved Crimson (or the older Pop) shows as Aero, glossy sky-blue glass with green accents
const RENAMED = { studio: 'frosted', night: 'neon', pop: 'aero', duo: 'aero' };
const ART_KEY = 'devicehub.artStyle';
const BG_KEY = 'devicehub.themeBg';
const ACCENT_KEY = 'devicehub.themeAccent';
const getLocal = (k) => { try { return localStorage.getItem(k) || null; } catch { return null; } };
const setLocal = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };

// The makers' product photos are only on the publisher's PC (27 Oct 2026, Shawn: "just keep this on mine"): a copy without
// them shows Realistic as Blueprint, and Settings does not offer it; the saved choice stays as it is. null = not known yet.
let photos = null, shown = null;
export const photosHere = () => photos !== false;
const photosCheck = typeof fetch === 'function' && typeof document !== 'undefined'
  ? fetch('/img/hs80.png', { method: 'HEAD' }).then((r) => r.ok, () => true).then((ok) => { photos = ok; if (!ok && shown === 'photo') applyArtStyle('photo'); })
  : null;
export function applyArtStyle(style) {
  style = RENAMED[style] || style;
  const resolved = ART_STYLES.some(([k]) => k === style) ? style : 'blueprint';
  shown = resolved;
  document.documentElement.dataset.art = resolved === 'photo' && photos === false ? 'blueprint' : resolved;
  return resolved;
}
export async function loadArtStyle() {
  const localArt = getLocal(ART_KEY), localBg = getLocal(BG_KEY), localAccent = getLocal(ACCENT_KEY);
  if (localArt) applyArtStyle(localArt);
  if (localBg || localAccent) applyTheme({ themeBg: localBg, themeAccent: localAccent });
  try {
    const s = await (await fetch('/api/settings')).json();
    // an old look's key is saved back as its new one (a saved 'duo' becomes 'aero'), here and on the server below
    const art = applyArtStyle(localArt || s.artStyle || 'blueprint');
    const themeBg = localBg || s.themeBg || 'graphite';
    const themeAccent = localAccent || s.themeAccent || SILVER;
    applyTheme({ themeBg, themeAccent });
    if ((localArt || s.artStyle) && localArt !== art) setLocal(ART_KEY, art);
    if (!localBg && s.themeBg) setLocal(BG_KEY, s.themeBg);
    if (!localAccent && s.themeAccent) setLocal(ACCENT_KEY, s.themeAccent);
    // If localStorage had a newer choice the server didn't have yet, sync it back quietly
    if ((localBg && s.themeBg !== localBg) || (localAccent && s.themeAccent !== localAccent) || ((localArt || s.artStyle) && s.artStyle !== art)) {
      fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artStyle: art, themeBg, themeAccent }) }).catch(() => {});
    }
  } catch {
    applyArtStyle(localArt || 'blueprint');
  }
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
export const THEME_BGS = [['graphite', 'Graphite', '#050507', '110, 120, 145'], ['black', 'Black', '#000000', '45, 45, 50', 'black'],
  // Ocean and Midnight went (22 Oct 2026, Shawn: "remove the ocean and midnight theme"); a saved one shows as Graphite
  ['espresso', 'Espresso', '#0b0806', '175, 132, 92', 'espresso'],
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
  ['coral-reef', 'Coral Reef', '#03202a', '30, 150, 160', 'coral-reef'],
  // three more whole looks (25 Oct 2026, Shawn: "make the themes cleaner and smoother and overall lean into what each
  // one is. I want to add some more too"): Cyberpunk (night-city neon cyan & magenta HUD), Sakura (twilight cherry
  // blossom & rose-quartz glass), and Terminal (retro CRT phosphor green screen).
  ['cyberpunk', 'Cyberpunk', '#07040e', '0, 240, 255', 'cyberpunk'],
  ['sakura', 'Sakura', '#110a14', '255, 175, 195', 'sakura'],
  ['terminal', 'Terminal', '#030804', '74, 246, 38', 'terminal'],
  // a live look (28 Oct 2026, Shawn: "can you make the fish theme for me on devicehub", from a fan concept of live
  // text-drawn wallpapers): koi and lily pads painted in characters on a teal-green pond, the koi swimming slowly
  // (core/koi-pond.js draws them; html[data-skin="koi-pond"], style.css end, colors the rest)
  ['koi-pond', 'Koi Pond', '#0d3533', '60, 170, 140', 'koi-pond']];
const OLD_BGS = { plum: 'graphite', ocean: 'graphite', midnight: 'graphite', forest: 'graphite', cream: 'espresso', paper: 'graphite', slate: 'graphite', 'taco-night': 'verde' };
const theme = { accent: SILVER, bg: 'graphite' };
// what the silver accent becomes on each whole look, and its name in Settings
export const SKIN_SILVER = { black: '#ffffff', espresso: '#dca878', 'old-school': '#ffb83f', verde: '#8cc63f', milk: '#8cc4ec', 'coral-reef': '#ff7f6a', cyberpunk: '#00f0ff', sakura: '#ffb7c5', terminal: '#4af626', 'koi-pond': '#f08a4b' };
export const SKIN_SILVER_NAME = { black: 'Pure white', espresso: 'Crema', 'old-school': 'Gold', verde: 'Verde', milk: 'Sky blue', 'coral-reef': 'Coral', cyberpunk: 'Neon cyan', sakura: 'Blossom', terminal: 'Phosphor', 'koi-pond': 'Koi orange' };
export const currentTheme = () => ({ ...theme });
export function applyTheme(s = {}) {
  if (/^#[0-9a-f]{6}$/i.test(s.themeAccent || '')) theme.accent = s.themeAccent.toLowerCase();
  const bgKey = OLD_BGS[s.themeBg] || s.themeBg;
  if (THEME_BGS.some(([k]) => k === bgKey)) theme.bg = bgKey;
  const bg = THEME_BGS.find(([k]) => k === theme.bg);
  if (bg[4]) document.documentElement.dataset.skin = bg[4]; else delete document.documentElement.dataset.skin;
  koiPond(bg[4] === 'koi-pond');
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
  if (change.themeBg && !change.themeAccent && THEME_BGS.find(([k]) => k === change.themeBg)?.[4]) {
    change = { ...change, themeAccent: SILVER };
  }
  applyTheme(change);
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) return;
  if (change.themeBg) setLocal(BG_KEY, theme.bg);
  if (change.themeAccent) setLocal(ACCENT_KEY, theme.accent);
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
}
export async function saveArtStyle(style) {
  const resolved = applyArtStyle(style);
  // demo mode (pretend devices) shows the look but never saves it to this PC's real settings (20 Oct 2026)
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) return;
  setLocal(ART_KEY, resolved);
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artStyle: resolved }) });
}
// Apply cached theme & appearance immediately on script evaluation so refreshes never flicker or reset
if (typeof document !== 'undefined') {
  const initArt = getLocal(ART_KEY), initBg = getLocal(BG_KEY), initAccent = getLocal(ACCENT_KEY);
  if (initArt) applyArtStyle(initArt);
  if (initBg || initAccent) applyTheme({ themeBg: initBg, themeAccent: initAccent });
}
