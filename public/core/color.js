// Color maths for the Lighting picker (pure; tests/lighting-page.mjs). Hue 0-360, saturation and value 0-1.
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
export function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
export const hsvToHex = (h, s, v) => rgbToHex(...hsvToRgb(h, s, v));
export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
// what a person types: "ff6a1a", "#FF6A1A", "#f60" -> "#ff6a1a"; anything else -> null
export function parseHex(text) {
  const t = String(text || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join('')}`;
  return null;
}
// the preset colors of the Color cards (Headset, Lighting, PC, each light on Lighting > This PC). Here rather than on the
// Headset page so the PC lights card does not load that page (27 Oct 2026)
export const SWATCHES = ['#ff6a1a', '#ff2d55', '#ff5d8f', '#b48cff', '#5b6cff', '#3fe0ff', '#3ddc97', '#c6ff3d', '#ffd23f', '#ffffff'];
