// The Live look (21 Oct 2026, Shawn: "2 sounds cool"): every drawing of the mouse, headset and keyboard shows that
// device's real state. Battery: the liquid's level and color (green, amber at 20% or less, red at 10% or less, mint
// while charging) and the number; headset: its logos in their real color and brightness; keyboard: its keys lit in the
// real backlight color, dark when the lights are off. Only CSS variables and two text nodes change, set from the
// readings DeviceHub already has (no extra requests to the devices). style.css draws it (html[data-art="live"]).
import { devices } from '../core/devices.js';

const levelColor = (b) => (b.charging ? '#5fd3a4' : b.percent <= 10 ? '#ff5a5a' : b.percent <= 20 ? '#ffbe46' : '#3ddc97');
// the keyboard's hue and saturation are 0-255 (VIA): to a CSS color
const kbColor = (v) => `hsl(${Math.round((v.hue / 255) * 360)} ${Math.round((v.saturation / 255) * 100)}% ${Math.round(100 - (v.saturation / 255) * 45)}%)`;

function battery(id) {
  const d = devices[id];
  if (!d || d.status !== 'connected' || (id === 'headset' && d.values?.headsetOn === false)) return null;
  const p = d.battery?.percent;
  return p == null ? null : { percent: p, charging: !!d.battery.charging };
}

export function paintLive(root = document) {
  for (const id of ['mouse', 'headset']) {
    const b = battery(id);
    for (const art of root.querySelectorAll(`.art.art-${id}`)) {
      art.style.setProperty('--lvl', b ? String(Math.max(0.04, b.percent / 100)) : '0');
      art.style.setProperty('--lq', b ? levelColor(b) : '#8d919c');
      // the number, its % smaller beside it; "off" alone when there is no reading; bubbles while charging
      const n = art.querySelector('.lq-n'), u = art.querySelector('.lq-u');
      const text = b ? String(b.percent) : 'off';
      if (n && n.textContent !== text) n.textContent = text;
      if (u) u.style.display = b ? '' : 'none';
      art.classList.toggle('charging', !!b?.charging);
    }
  }
  const hv = devices.headset?.values || {};
  for (const art of root.querySelectorAll('.art.art-headset')) {
    if (hv.led) art.style.setProperty('--glowc', hv.led);
    art.style.setProperty('--logo', hv.logoBrightness == null ? '1' : String(Math.max(0.12, hv.logoBrightness / 100)));
  }
  const kv = devices.keyboard?.values || {};
  const on = devices.keyboard?.status === 'connected' && kv.effect !== 0 && kv.brightness > 0;
  for (const art of root.querySelectorAll('.art.art-keyboard')) {
    art.style.setProperty('--kbon', on ? String(0.35 + 0.65 * (kv.brightness / 255)) : '0');
    if (kv.hue != null) art.style.setProperty('--kb', kbColor(kv));
  }
}
