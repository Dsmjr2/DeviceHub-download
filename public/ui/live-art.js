// The Live look (21 Oct 2026, Shawn: "2 sounds cool"): every drawing of the mouse, headset and keyboard shows that
// device's real state. Battery: the liquid's level and color (green, sliding to yellow, then red); headset: its logos in their real color and brightness; keyboard: its keys lit in the
// real backlight color, dark when the lights are off. Only CSS variables and two text nodes change, set from the
// readings DeviceHub already has (no extra requests to the devices). style.css draws it (html[data-art="live"]).
import { devices } from '../core/devices.js';

// the battery's color slides with its level (Shawn, 21 Oct 2026: green, then yellow, then red): green from 60% up, yellow
// at 30%, red at 10% and below, blended in between
const levelColor = (b) => {
  const p = b.percent, hue = p >= 60 ? 140 : p >= 30 ? 50 + ((p - 30) / 30) * 90 : p > 10 ? ((p - 10) / 20) * 50 : 0;
  return `hsl(${Math.round(hue)} 72% 54%)`;
};
// the keyboard's hue and saturation are 0-255 (VIA): to a CSS color
const kbColor = (v) => `hsl(${Math.round((v.hue / 255) * 360)} ${Math.round((v.saturation / 255) * 100)}% ${Math.round(100 - (v.saturation / 255) * 45)}%)`;

// the last level seen, kept for the moment after a restart before the first reading arrives (so the drawing is not
// shown empty); a per-window convenience, so browser storage, and it works without it
const KEEP = 'devicehub.liveLevels';
let kept = {}; try { kept = JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch {}
function battery(id) {
  const d = devices[id];
  // asleep (the mouse after its idle time): its last level, shown still and dim (Shawn, 21 Oct 2026: "show the battery even
  // when asleep")
  if (d?.status === 'asleep') { const p = d.battery?.percent ?? kept[id]; return p == null ? null : { percent: p, charging: false, asleep: true }; }
  if (!d || (d.status !== 'connected' && d.status !== 'connecting') || (id === 'headset' && d.values?.headsetOn === false)) return null;
  const p = d.battery?.percent;
  if (p == null) return kept[id] != null && d.status === 'connected' ? { percent: kept[id], charging: false } : null;
  if (kept[id] !== p) { kept[id] = p; try { localStorage.setItem(KEEP, JSON.stringify(kept)); } catch {} }
  return { percent: p, charging: !!d.battery.charging };
}

// Devices added in my-devices that report a battery (22 Oct 2026, docs/handoff/battery-added-devices.md): their drawing
// (ui/art.js artOf) is marked data-dev="<id>" and gets the same liquid, from that device's own reading. The built-in
// mouse and headset paint only drawings without data-dev, so an added mouse or headset never shows their level.
const addedIds = () => Object.keys(devices).filter((id) => devices[id]?.adapter?.plugin && devices[id].adapter.battery && /^[a-z][a-z0-9-]{1,30}$/.test(id));
export function paintLive(root = document) {
  for (const id of ['mouse', 'headset', ...addedIds()]) {
    const b = battery(id);
    const sel = id === 'mouse' || id === 'headset' ? `.art.art-${id}:not([data-dev])` : `.art[data-dev="${id}"]`;
    for (const art of root.querySelectorAll(sel)) {
      art.style.setProperty('--lvl', b ? String(Math.max(0.04, b.percent / 100)) : '0');
      art.style.setProperty('--lq', b ? levelColor(b) : '#8d919c');
      // the number, its % smaller beside it; "off" alone when there is no reading; bubbles while charging
      const n = art.querySelector('.lq-n'), u = art.querySelector('.lq-u');
      const text = b ? String(b.percent) : 'off';
      if (n && n.textContent !== text) n.textContent = text;
      if (u) u.style.display = b ? '' : 'none';
      art.classList.toggle('charging', !!b?.charging);
      art.classList.toggle('low', !!b && !b.charging && b.percent <= 20);
      art.classList.toggle('sleeping', !!b?.asleep);
      art.classList.toggle('no-level', !b);
    }
  }
  const hv = devices.headset?.values || {};
  for (const art of root.querySelectorAll('.art.art-headset:not([data-dev])')) {
    if (hv.led) art.style.setProperty('--glowc', hv.led);
    art.style.setProperty('--logo', hv.logoBrightness == null ? '1' : String(Math.max(0.12, hv.logoBrightness / 100)));
    // the mic tip red while muted, unlit otherwise (Shawn: "the end of the mic shouldnt be lit")
    const on = devices.headset?.status === 'connected' && hv.headsetOn !== false;
    art.classList.toggle('mic-off', on && (hv['prop:micEnabled'] === false || !!hv['mute:recording']));
  }
  const kv = devices.keyboard?.values || {};
  const on = devices.keyboard?.status === 'connected' && kv.effect !== 0 && kv.brightness > 0;
  for (const art of root.querySelectorAll('.art.art-keyboard:not([data-dev])')) {
    art.style.setProperty('--kbon', on ? String(0.35 + 0.65 * (kv.brightness / 255)) : '0');
    if (kv.hue != null) art.style.setProperty('--kb', kbColor(kv));
  }
}
