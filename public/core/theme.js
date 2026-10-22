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
export const ART_STYLES = [['photo', 'Realistic'], ['frosted', 'Classic'], ['blueprint', 'Blueprint'], ['neon', 'Neon'], ['pop', 'Pop'], ['arctic', 'Arctic']];
const RENAMED = { studio: 'frosted', glow: 'neon', matte: 'pop', night: 'neon' };
export function applyArtStyle(style) { style = RENAMED[style] || style; document.documentElement.dataset.art = ART_STYLES.some(([k]) => k === style) ? style : 'frosted'; }
export async function loadArtStyle() {
  try { applyArtStyle((await (await fetch('/api/settings')).json()).artStyle); } catch { applyArtStyle('frosted'); }
}
export async function saveArtStyle(style) {
  applyArtStyle(style);
  // demo mode (pretend devices) shows the look but never saves it to this PC's real settings (20 Oct 2026)
  if (new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true) return;
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artStyle: style }) });
}
