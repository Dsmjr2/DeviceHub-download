// The Lighting page's color picker (26 Oct 2026, Shawn: the old hue ring "doesnt show the selected color when I use
// the light bar on the left ... its clunky to use"). A saturation/brightness area, a hue strip under it, a large swatch
// of the color beside the preset swatches and Off; no typed code box (26 Oct 2026, Shawn: "the typed color box doesnt
// need to be there"). It follows the pointer with pointer capture and paints at once; the page hears onInput
// while it moves (the page throttles any device writes) and onDone on release. Arrow keys: on the area left/right =
// saturation, up/down = brightness; on the strip = hue (Shift: bigger steps). No redraws: every part is updated in place.
//   colorPicker({ hex, off, swatches, onInput(hex), onDone(hex), onOff() }) -> { el, set(hex), setOff(on), hex() }
import { h } from './dom.js';
import { offSwatch } from './controls.js';
import { hexToHsv, hsvToHex } from '../core/color.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function colorPicker({ hex = '#ff6a1a', off = false, swatches = [], onInput = () => {}, onDone = () => {}, onOff = () => {} } = {}) {
  let { h: hue, s: sat, v: val } = hexToHsv(hex);
  if (val === 0) val = 1;
  let isOff = off;
  const now = () => hsvToHex(hue, sat, val);

  const svThumb = h('i', { class: 'cp-thumb' });
  const sv = h('div', { class: 'cp-sv', tabindex: 0, role: 'slider', 'aria-label': 'Saturation and brightness', 'aria-valuemin': 0, 'aria-valuemax': 100 }, svThumb);
  const hueThumb = h('i', { class: 'cp-thumb' });
  const strip = h('div', { class: 'cp-hue', tabindex: 0, role: 'slider', 'aria-label': 'Hue', 'aria-valuemin': 0, 'aria-valuemax': 360 }, hueThumb);
  const big = h('div', { class: 'cp-big', 'aria-hidden': 'true' });
  const offBtn = offSwatch({ on: isOff, label: 'All lights', onclick: () => { onOff(); } });
  const presets = swatches.map((c) => h('button', { class: 'swatch', style: { '--s': c }, 'aria-label': c, dataset: { hex: c.toLowerCase() },
    onclick: () => { place(c); onInput(now()); onDone(now()); } }));
  const el = h('div', { class: 'cp' },
    sv, strip,
    h('div', { class: 'cp-now' }, big, h('div', { class: 'swatches cp-swatches' }, ...presets, offBtn)));

  // paint the whole picker from hue / sat / val (cheap: a few style properties)
  const paint = () => {
    const cur = now();
    el.style.setProperty('--cp-hue', hsvToHex(hue, 1, 1));
    el.style.setProperty('--pick', isOff ? '#000000' : cur);
    svThumb.style.left = `${sat * 100}%`; svThumb.style.top = `${(1 - val) * 100}%`;
    hueThumb.style.left = `${(hue / 360) * 100}%`;
    sv.setAttribute('aria-valuenow', String(Math.round(val * 100)));
    sv.setAttribute('aria-valuetext', `saturation ${Math.round(sat * 100)}%, brightness ${Math.round(val * 100)}%`);
    strip.setAttribute('aria-valuenow', String(Math.round(hue)));
    el.classList.toggle('is-off', isOff);
    for (const b of presets) { const on = !isOff && b.dataset.hex === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    offBtn.classList.toggle('on', isOff); offBtn.classList.toggle('sel', isOff); offBtn.setAttribute('aria-pressed', String(isOff));
  };
  const place = (x) => { const v = hexToHsv(x); if (v.s > 0.001 && v.v > 0.001) hue = v.h; sat = v.s; val = v.v; isOff = false; paint(); };

  // the picker paints at once (a few style properties); the page hears onInput at most once per 16 ms, whatever the
  // pointer's rate (a timer, not requestAnimationFrame: that never fires while the window is hidden)
  let frame = 0;
  const tick = () => { frame = 0; onInput(now()); };
  const changed = () => { isOff = false; paint(); if (!frame) frame = setTimeout(tick, 16); };
  const drag = (target, move) => {
    let id = null;
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault(); target.focus({ preventScroll: true });
      id = e.pointerId; target.setPointerCapture(id); target.classList.add('dragging');
      move(e); changed();
    });
    target.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; move(e); changed(); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; target.classList.remove('dragging');
      if (frame) { clearTimeout(frame); tick(); }
      onDone(now());
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  drag(sv, (e) => { const r = sv.getBoundingClientRect(); sat = clamp01((e.clientX - r.left) / r.width); val = clamp01(1 - (e.clientY - r.top) / r.height); });
  drag(strip, (e) => { const r = strip.getBoundingClientRect(); hue = clamp01((e.clientX - r.left) / r.width) * 359.9; });

  const keys = (target, onKey) => {
    target.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 2;
      if (!onKey(e.key, step)) return;
      e.preventDefault(); changed();
    });
    target.addEventListener('keyup', (e) => { if (/^Arrow|^Home$|^End$/.test(e.key)) onDone(now()); });
  };
  keys(sv, (k, step) => {
    if (k === 'ArrowLeft') sat = clamp01(sat - step / 100); else if (k === 'ArrowRight') sat = clamp01(sat + step / 100);
    else if (k === 'ArrowUp') val = clamp01(val + step / 100); else if (k === 'ArrowDown') val = clamp01(val - step / 100);
    else return false;
    return true;
  });
  keys(strip, (k, step) => {
    if (k === 'ArrowLeft' || k === 'ArrowDown') hue = (hue - step * 2 + 360) % 360; else if (k === 'ArrowRight' || k === 'ArrowUp') hue = (hue + step * 2) % 360;
    else if (k === 'Home') hue = 0; else if (k === 'End') hue = 359.9;
    else return false;
    return true;
  });

  paint();
  return { el, set: place, setOff: (on) => { isOff = !!on; paint(); }, hex: now };
}
