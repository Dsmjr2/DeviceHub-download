// Small gauges that show a value as a picture plus its number, in the battery's style (Shawn, 19 Oct 2026: a cooler
// way than words): a fill bar (volume, sidetone, brightness), the mic's state (red with a slash when muted), dots
// (the mouse's DPI stage, the keyboard's layers), signal bars (polling rate) and a color dot (the light's color).
// big: the device pages' top panel (value with a small label under it); otherwise compact, for the Overview tiles.
import { h, icon } from './dom.js';

const wrap = (cls, big, picture, value, label) => h('div', { class: `gauge ${cls}${big ? ' big' : ''}`, title: label ? `${label}: ${value}` : String(value) },
  picture, h('div', { class: 'gauge-text' }, h('b', {}, value), big && label ? h('span', {}, label) : null));

export function meter({ ic, pct, value, label, big }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return wrap('meter', big, h('div', { class: 'gauge-pic' }, ic ? icon(ic) : null, h('div', { class: 'gauge-bar' }, h('i', { style: { width: `${p}%` } }))), value, label);
}

export function micState({ on, big }) {
  const muted = on === false;
  return wrap(`mic${muted ? ' muted' : ''}`, big, h('div', { class: 'gauge-pic' }, icon(muted ? 'micOff' : 'mic')), on == null ? '—' : muted ? 'Muted' : 'On', 'mic');
}

export function dots({ n, of, value, label, big, ic }) {
  const count = Math.max(1, Math.min(8, Number(of) || 1));
  return wrap('dots', big, h('div', { class: 'gauge-pic' }, ic ? icon(ic) : null,
    h('div', { class: 'gauge-dots' }, ...Array.from({ length: count }, (_, i) => h('i', { class: n == null || i < n ? 'on' : '' })))), value, label);
}

// polling rate as signal bars: 1K one bar ... 8K four
export function signal({ hz, big }) {
  const level = !hz ? 0 : hz >= 8000 ? 4 : hz >= 4000 ? 3 : hz >= 2000 ? 2 : 1;
  const text = !hz ? '—' : hz >= 1000 ? `${hz / 1000}K` : `${hz}`;
  return wrap('signal', big, h('div', { class: 'gauge-pic' }, h('div', { class: 'gauge-signal' }, ...[1, 2, 3, 4].map((b) => h('i', { class: b <= level ? 'on' : '', style: { height: `${b * 25}%` } })))), text, 'polling');
}

export function colorDot({ color, value, label, big }) {
  return wrap('color', big, h('div', { class: 'gauge-pic' }, h('i', { class: 'gauge-swatch', style: { background: color || 'var(--faint)' } })), value, label);
}
