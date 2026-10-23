// Lighting: one color for every device with RGB.
import { h, icon } from '../ui/dom.js';
import { card, slider, button, toggle, pill } from '../ui/controls.js';
import { devices, write, writeBatch, log, stillLooking, shownDevices } from '../core/devices.js';
import { artFor } from '../ui/art.js';
import { topbar } from './common.js';
import { setGlow, getGlow } from '../core/theme.js';
import { toast } from '../ui/overlay.js';
import { SWATCHES } from './headset.js';
import { pcLightsCard, applyPc, pcIncluded, pcAvailable, setPcIncluded } from './pc-lights.js';

const ui = { hex: getGlow() || '#ff6a1a', brightness: 80, include: { keyboard: true, headset: true } };

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
function hsvToRgb(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
function rgbToHs(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hh * 60 + 360) % 360, s: max ? d / max : 0 };
}

// The picker (19 Oct 2026, Shawn: "more minimal and modern"): a thin hue ring with a round knob, the chosen color
// as a solid disc in the middle, and saturation on its own slider underneath. The color's code is no longer written on
// the disc (23 Oct 2026, Shawn: "remove the middle typable color": it looked like a box to type in).
const RING = 0.13;  // ring thickness as a fraction of the radius
function wheel(onPick) {
  const size = 260, canvas = h('canvas', { width: size * 2, height: size * 2, 'aria-label': 'hue ring' });
  const knob = h('div', { class: 'ring-knob' });
  const disc = h('div', { class: 'ring-disc' });
  const wrap = h('div', { class: 'ring-wrap' }, canvas, disc, knob);
  const ctx = canvas.getContext('2d');
  const R = size, r0 = R * (1 - RING);
  for (let deg = 0; deg < 360; deg += 0.5) {
    const a0 = ((deg - 0.6) * Math.PI) / 180, a1 = ((deg + 0.6) * Math.PI) / 180;
    ctx.beginPath(); ctx.arc(R, R, R - 1, a0, a1); ctx.arc(R, R, r0, a1, a0, true); ctx.closePath();
    ctx.fillStyle = `hsl(${deg}, 88%, 58%)`; ctx.fill();
  }
  let hue = 0, sat = 1;
  const hexOf = () => rgbToHex(...hsvToRgb(hue, sat, 1));
  // saturation: 0 = white, 100 = the full hue
  const satInput = h('input', { type: 'range', min: 0, max: 100, value: 100, 'aria-label': 'saturation' });
  const satEl = h('div', { class: 'slider sat-track' }, satInput);
  const setSat = (v) => { satInput.value = v; satEl.style.setProperty('--p', `${v}%`); };
  const show = () => {
    const a = (hue * Math.PI) / 180, rad = 50 * (1 - RING / 2);
    knob.style.left = `${50 + Math.cos(a) * rad}%`; knob.style.top = `${50 + Math.sin(a) * rad}%`;
    knob.style.background = rgbToHex(...hsvToRgb(hue, 1, 1));
    const hex = hexOf();
    wrap.style.setProperty('--pick', hex); satEl.style.setProperty('--hue', rgbToHex(...hsvToRgb(hue, 1, 1)));
  };
  const place = (hex) => { const v = rgbToHs(...hexToRgb(hex)); hue = v.h; sat = v.s; setSat(Math.round(sat * 100)); show(); };
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    hue = ((Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180) / Math.PI + 360) % 360;
    show(); onPick(hexOf());
  };
  let down = false;
  canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); pick(e); });
  canvas.addEventListener('pointermove', (e) => { if (down) pick(e); });
  canvas.addEventListener('pointerup', () => { down = false; });
  satInput.addEventListener('input', () => { sat = satInput.value / 100; setSat(satInput.value); show(); onPick(hexOf()); });
  return { el: wrap, sat: satEl, place };
}

function preview(hex) {
  document.querySelectorAll('.lighting-preview').forEach((el) => el.style.setProperty('--pick', hex));
  document.documentElement.style.setProperty('--glow-a', hex);
}

export async function applyColor(hex, brightness = ui.brightness) {
  ui.hex = hex; ui.brightness = brightness;
  await applyAll();
}

async function applyAll() {
  const [r, g, b] = hexToRgb(ui.hex);
  const k = ui.brightness / 100;
  const done = [];
  const t = toast(`Applying ${ui.hex.toUpperCase()}`, 'busy', { ms: 0, detail: 'Backing up, writing, checking each device…' });
  for (const id of ['keyboard', 'headset']) {
    const d = devices[id];
    if (!ui.include[id] || d.status !== 'connected' || !d.adapter.hasLighting?.()) continue;
    try {
      if (id === 'keyboard') {
        const res = await writeBatch(id, d.adapter.lightingKeys(r, g, b, ui.brightness).map(([key, val]) => ({ key, value: val, label: `Lighting ${key}`, display: val })), 'before lighting');
        if (res.failed) throw new Error(`${res.failed} lighting value(s) did not stick`);
      } else {
        await write(id, 'led', rgbToHex(r * k, g * k, b * k), { label: 'LED color', display: ui.hex, silent: true });
      }
      done.push(d.adapter.title);
    } catch (e) { log(`lighting failed: ${e.message}`, 'bad', id); }
  }
  // added devices with one color (my-devices and library drivers), each through its own read-back write
  for (const { d, s } of addedColors()) {
    if (ui.include[d.id] === false || d.status !== 'connected' || s.readOnly) continue;
    try { await write(d.id, s.key, rgbToHex(r * k, g * k, b * k), { label: s.label, display: ui.hex, silent: true }); done.push(d.adapter.title); }
    catch (e) { log(`lighting failed: ${e.message}`, 'bad', d.id); }
  }
  // the PC's own lights (board, fans, RAM, graphics card) through OpenRGB, when it runs
  try { const pc = await applyPc(rgbToHex(r * k, g * k, b * k)); if (pc) done.push(pc); } catch (e) { log(`PC lights failed: ${e.message}`, 'bad'); }
  setGlow(ui.hex);
  t.update(done.length ? `Lighting set on ${done.join(' + ')}` : 'No connected device with lighting', done.length ? 'good' : 'bad', done.length ? undefined : 'Connect the keyboard or headset first');
}

// the devices this PC has, beyond the built-in three, that take one color (23 Oct 2026, a friend's PC listed Shawn's
// own three devices whatever it had)
function addedColors() {
  return shownDevices().filter((d) => !['mouse', 'keyboard', 'headset'].includes(d.id))
    .map((d) => ({ d, s: (d.adapter.settings || []).find((x) => x.type === 'color' && !x.zones) })).filter((x) => x.s);
}

export default {
  id: 'lighting', title: 'Lighting', icon: 'lighting', accent: 'var(--signal)', watches: ['keyboard', 'headset'],
  render() {
    const redraw = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/lighting') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    const w = wheel((hex) => { ui.hex = hex; preview(hex); });
    queueMicrotask(() => { w.place(ui.hex); preview(ui.hex); });
    const shown = new Set(shownDevices().map((d) => d.id));
    const has = (id) => shown.has(id);
    const target = (id, note) => {
      const d = devices[id];
      const ok = d.status === 'connected' && d.adapter.hasLighting?.();
      const looking = !ok && d.status !== 'connected' && stillLooking();
      return h('div', { class: `target lighting-preview${looking ? ' ghost' : ''}`, style: { '--cc': `var(--c-${id})`, '--pick': ui.hex } },
        artFor[id](),
        h('div', { class: 'grow' }, h('b', {}, d.adapter.title), h('small', {}, ok ? note : d.status === 'connected' ? 'no lighting channel' : looking ? 'looking…' : 'not connected')),
        toggle({ value: ui.include[id] && ok, disabled: !ok, label: `include ${id}`, onCommit: async (on) => { ui.include[id] = on; } }));
    };
    return h('div', {},
      topbar('All devices', 'Lighting', 'One color for every device.'),
      // one screen, three columns: the color, where it goes, and the PC's own lights (23 Oct 2026, Shawn: "remove this
      // [More], I want the lighting area non scrollable")
      h('div', { class: 'grid light-cols top' },
        card([h('h2', {}, 'Color')], w.el,
          h('div', { class: 'swatches' }, ...SWATCHES.map((c) => h('button', { class: 'swatch', style: { '--s': c }, 'aria-label': c, onclick: () => { ui.hex = c; w.place(c); preview(c); } }))),
          h('div', { class: 'picker-row' }, h('span', { class: 'muted' }, 'Saturation'), w.sat),
          h('div', { class: 'picker-row' }, h('span', { class: 'muted' }, 'Brightness'),
            slider({ value: ui.brightness, min: 5, max: 100, unit: '%', label: 'Brightness', onCommit: async (x) => { ui.brightness = x; } }))),
        h('div', { class: 'stack' },
          card([h('h2', {}, 'Apply to')],
            // only the devices this PC has, by their own names (23 Oct 2026, Shawn: a friend's PC showed his P75, HS80
            // and Pulsar whatever it had)
            h('div', { class: 'targets' },
              has('keyboard') ? target('keyboard', 'color + brightness, effect kept · saved on the keyboard') : null,
              has('headset') ? target('headset', 'LED color · held while DeviceHub runs') : null,
              ...addedColors().map(({ d, s }) => {
                const ok = d.status === 'connected' && !s.readOnly;
                return h('div', { class: 'target lighting-preview', style: { '--cc': 'var(--signal)', '--pick': ui.hex } }, h('div', { class: 'target-ic' }, icon(d.adapter.kind === 'Mouse' ? 'mouse' : d.adapter.kind === 'Headset' ? 'headset' : d.adapter.kind === 'Keyboard' ? 'keyboard' : 'lighting')),
                  h('div', { class: 'grow' }, h('b', {}, d.adapter.title), h('small', {}, ok ? s.label : d.status !== 'connected' ? 'not connected' : `${s.label}: read-only until Turn on settings on its page`)),
                  toggle({ value: ui.include[d.id] !== false && ok, disabled: !ok, label: `include ${d.adapter.title}`, onCommit: async (on) => { ui.include[d.id] = on; } }));
              }),
              has('mouse') ? h('div', { class: 'target', style: { '--cc': 'var(--c-mouse)' } }, artFor.mouse(), h('div', { class: 'grow' }, h('b', {}, devices.mouse.adapter.title), h('small', {}, 'no lights DeviceHub can set on this mouse')), pill('n/a')) : null,
              h('div', { class: 'target lighting-preview', style: { '--cc': 'var(--signal)', '--pick': ui.hex } }, h('div', { class: 'target-ic' }, icon('lighting')),
                h('div', { class: 'grow' }, h('b', {}, 'PC lights'), h('small', {}, pcIncluded() ? 'board, fans and more, through OpenRGB' : 'through OpenRGB, when it runs (PC lights, right)')),
                toggle({ value: pcIncluded(), disabled: !pcAvailable(), label: 'include PC lights', onCommit: async (on) => { setPcIncluded(on); } })))),
          h('div', { class: 'actions' }, button('Apply to all', applyAll, { kind: 'primary', ic: 'lighting' }))),
        h('div', { class: 'light-pc' }, pcLightsCard(redraw))));
  },
};
