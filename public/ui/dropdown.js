// The glass dropdown (24 Oct 2026, Shawn: "make the dropdown menus in every area that has them more appealing and more
// liquid glass like the app"): every native <select> in DeviceHub became this. Closed, it is the app's glass pill with
// the chosen label and a chevron; open, a floating glass list in a top-level layer (never cut off by a card), under the
// control or above it near the bottom of the window. Keyboard and screen readers as a native select: Enter, Space,
// arrows, Home, End, Page Up/Down, Escape, type to jump; role combobox / listbox / option. One open at a time; a click
// outside closes it. Nothing runs and no listener is left while it is closed. Pure parts: core/dropdown-logic.js.
//
// dropdown({ options: [{ value, label, disabled }], value, onChange(value), label, disabled, cls, style, placeholder })
// returns the control (a <button>). Like a <select>: .value reads and sets the chosen value (as a string), .disabled
// works, and a pick fires a bubbling 'change' event, so `e.target.value` and addEventListener('change') keep working.
import { h, svgEl } from './dom.js';
import { moveIndex, typeAhead, placeList } from '../core/dropdown-logic.js';

const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

let seq = 0;
let openOne = null;   // the open dropdown's close(), so opening another closes it
export const dropdownOpen = () => !!openOne;
export const closeDropdowns = () => openOne?.(false);
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function dropdown({ options = [], value, onChange, label, disabled, cls = '', style, placeholder = '—' } = {}) {
  const opts = options.filter(Boolean).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value), disabled: !!o.disabled }));
  let cur = value == null ? null : String(value);
  const id = `dd${++seq}`;
  const text = h('span', { class: 'dd-label' });
  const el = h('button', { type: 'button', class: `text dd ${cls}`.trim(), role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    'aria-controls': `${id}-list`, 'aria-label': label, disabled, style }, text, svgEl(CHEVRON));
  el.querySelector('svg').classList.add('dd-chev');
  const paint = () => {
    const o = opts.find((x) => x.value === cur);
    text.textContent = o ? o.label : placeholder;
    el.classList.toggle('dd-empty', !o);
  };
  paint();
  // as a <select>: the chosen value, read and set (setting draws it, fires nothing)
  Object.defineProperty(el, 'value', { configurable: true, get: () => cur ?? '', set: (v) => { cur = v == null ? null : String(v); paint(); } });
  el.dropdownOptions = opts;

  let list = null, items = [], active = -1, typed = '', typedAt = 0, raf = 0, swallowOn = null;

  const setActive = (i, scroll) => {
    if (!list) return;
    items[active]?.classList.remove('active');
    active = i;
    const o = items[i];
    if (!o) { el.removeAttribute('aria-activedescendant'); return; }
    o.classList.add('active');
    el.setAttribute('aria-activedescendant', o.id);
    if (scroll) {
      if (o.offsetTop < list.scrollTop) list.scrollTop = o.offsetTop - 6;
      else if (o.offsetTop + o.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = o.offsetTop + o.offsetHeight - list.clientHeight + 6;
    }
  };

  const place = () => {
    raf = 0;
    if (!list) return;
    const r = el.getBoundingClientRect();
    // the control went away (the page was redrawn) or scrolled out of sight: close
    if (!el.isConnected || (!r.width && !r.height) || r.bottom < 0 || r.top > innerHeight) { close(false); return; }
    list.style.maxHeight = ''; list.style.width = ''; list.style.minWidth = `${Math.round(r.width)}px`;
    const p = placeList(r, list.scrollHeight, list.offsetWidth, { w: innerWidth, h: innerHeight });
    Object.assign(list.style, { top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` });
    list.classList.toggle('above', p.above);
  };
  const later = (e) => { if (e && list && (e.target === list || list.contains(e.target))) return; if (!raf) raf = requestAnimationFrame(place); };

  // a press outside closes the list; one on a dialog's backdrop only closes the list, as a native select does
  const outside = (e) => {
    if (el.contains(e.target) || list?.contains(e.target)) return;
    if (e.target.matches?.('.modal-back, .palette-back')) swallowOn = e.target;
    close(false);
  };
  const swallow = (e) => {
    if (!swallowOn) return;
    if (e.target === swallowOn) { e.stopPropagation(); e.preventDefault(); }
    swallowOn = null;
    if (!list) document.removeEventListener('click', swallow, true);
  };
  const lost = () => close(false);

  function open() {
    if (list || el.disabled) return;
    openOne?.(false);
    items = opts.map((o, i) => h('div', { class: `dd-opt${o.value === cur ? ' chosen' : ''}${o.disabled ? ' off' : ''}`, role: 'option', id: `${id}-o${i}`,
      'aria-selected': String(o.value === cur), 'aria-disabled': o.disabled ? 'true' : null, dataset: { i: String(i) } },
    h('span', { class: 'dd-check' }, o.value === cur ? svgEl(CHECK) : null), h('span', { class: 'dd-text' }, o.label)));
    list = h('div', { class: 'dd-list', role: 'listbox', id: `${id}-list`, 'aria-label': label }, ...items);
    // keep focus on the control while the list is used with the mouse
    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('pointermove', (e) => { const o = e.target.closest?.('.dd-opt'); if (o && !o.classList.contains('off')) { const i = Number(o.dataset.i); if (i !== active) setActive(i, false); } });
    list.addEventListener('click', (e) => { const o = e.target.closest?.('.dd-opt'); if (o && !o.classList.contains('off')) pick(Number(o.dataset.i)); });
    document.body.append(list);
    place();
    el.setAttribute('aria-expanded', 'true');
    el.classList.add('open');
    const chosen = opts.findIndex((o) => o.value === cur);
    setActive(chosen >= 0 && !opts[chosen].disabled ? chosen : moveIndex(opts, -1, 'Home'), true);
    openOne = close;
    swallowOn = null;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('click', swallow, true);
    document.addEventListener('scroll', later, { capture: true, passive: true });
    addEventListener('resize', later);
    addEventListener('blur', lost);
    addEventListener('hashchange', lost);
    requestAnimationFrame(() => list?.classList.add('in'));
    dispatchEvent(new Event('dropdown-open'));
  }

  function close(refocus) {
    if (!list) return;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', later, { capture: true });
    removeEventListener('resize', later);
    removeEventListener('blur', lost);
    removeEventListener('hashchange', lost);
    if (!swallowOn) document.removeEventListener('click', swallow, true);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const gone = list;
    list = null; items = []; active = -1; typed = '';
    gone.classList.remove('in');
    gone.removeAttribute('id');
    if (reduced()) gone.remove(); else setTimeout(() => gone.remove(), 140);
    el.setAttribute('aria-expanded', 'false');
    el.removeAttribute('aria-activedescendant');
    el.classList.remove('open');
    if (openOne === close) openOne = null;
    if (refocus && el.isConnected) el.focus({ preventScroll: true });
    dispatchEvent(new Event('dropdown-closed'));
  }

  function pick(i) {
    const o = opts[i];
    if (!o || o.disabled) return;
    close(true);
    if (o.value === cur) return;
    cur = o.value;
    paint();
    el.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.(o.value);
  }

  el.addEventListener('click', () => { if (list) close(true); else open(); });
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (!list) {
      if (MOVE_KEYS.has(k) || k === 'Enter' || k === ' ') { e.preventDefault(); open(); if (MOVE_KEYS.has(k) && !e.altKey && k !== 'ArrowDown' && k !== 'ArrowUp') setActive(moveIndex(opts, active, k), true); }
      else if (k.length === 1 && !e.altKey) { open(); typeTo(e, k); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (k === 'Tab') { close(false); return; }
    if (k === 'Enter' || (k === 'ArrowUp' && e.altKey)) { e.preventDefault(); pick(active); return; }
    if (k === ' ') { e.preventDefault(); if (typed && Date.now() - typedAt < 600) typeTo(e, k); else pick(active); return; }
    if (MOVE_KEYS.has(k)) { e.preventDefault(); setActive(moveIndex(opts, active, k), true); return; }
    if (k.length === 1 && !e.altKey) typeTo(e, k);
  });
  // a button clicks itself on Space's release: the keydown already did the work
  el.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });

  function typeTo(e, k) {
    e.preventDefault();
    const now = Date.now();
    typed = now - typedAt < 600 ? typed + k : k;
    typedAt = now;
    const i = typeAhead(opts, typed, active);
    if (i >= 0) setActive(i, true);
  }

  return el;
}
