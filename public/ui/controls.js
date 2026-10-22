// Controls. Each one takes the confirmed value and an async onCommit(value).
// While a commit runs the control shows "pending"; it settles on the value the device read back.
import { h, icon, clamp, svgEl } from './dom.js';

// "pending" (the blink) only if the change takes longer than 500 ms (a mouse change is ~0.4 s), so quick changes just happen
async function run(el, fn) {
  const t = setTimeout(() => el.classList.add('pending'), 500);
  try { return await fn(); } finally { clearTimeout(t); el.classList.remove('pending'); }
}

// Moves at once on a click (21 Oct 2026: it waited for the device, 0.1-0.5 s, and felt late); the page then redraws
// from the device's confirmed value, and a change that failed flips it back.
export function toggle({ value, onCommit, disabled, label }) {
  const el = h('button', { class: `switch${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(!!value), 'aria-label': label, disabled },
    h('span', { class: 'knob' }));
  const show = (on) => { el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); };
  el.addEventListener('click', async () => {
    if (el.classList.contains('pending')) return;
    show(!value);
    try { await run(el, () => onCommit(!value)); } catch { show(!!value); }
  });
  return el;
}

export function segmented({ value, options, onCommit, disabled, compact }) {
  const el = h('div', { class: `seg${compact ? ' compact' : ''}`, role: 'radiogroup' });
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  el.style.setProperty('--n', options.length);
  el.style.setProperty('--i', idx);
  if (!options.some((o) => o.value === value)) el.classList.add('none');
  el.append(h('span', { class: 'seg-thumb' }));
  options.forEach((o, i) => {
    const b = h('button', { role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'sel' : '', disabled: disabled || o.disabled, title: o.title }, o.label);
    b.addEventListener('click', () => {
      if (o.value === value) return;
      el.style.setProperty('--i', i);
      el.classList.remove('none');
      run(el, () => onCommit(o.value));
    });
    el.append(b);
  });
  return el;
}

// Range with a live readout; commits once on release (with its message and log line).
// live(v): for settings that are quick and harmless to send often (volumes, light and screen brightness), the device
// follows while dragging (21 Oct 2026, "it feels as if there is a delay"): one change in flight at a time, the
// newest position sent next; the release then commits the final value as usual.
// label: its name for screen readers when it is not inside a row (a row names it itself)
// grab(): called when the slider is pressed, before it moves (the device's backup is taken then)
export function slider({ value, min, max, step = 1, onCommit, live, grab, disabled, unit = '', format, accent, label }) {
  const show = (v) => (format ? format(v) : `${v}${unit}`);
  const input = h('input', { type: 'range', min, max, step, value: value ?? min, disabled: disabled || value == null, 'aria-label': label });
  const out = h('output', {}, value == null ? '—' : show(value));
  const el = h('div', { class: 'slider' }, input, out);
  if (accent) el.style.setProperty('--accent', accent);
  const paint = () => el.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
  paint();
  let busy = null, next = null, sent = value, moved = false;
  const pump = () => {
    if (busy || next == null || next === sent) return;
    const v = next; next = null; sent = v; moved = true;
    busy = Promise.resolve().then(() => live(v)).catch(() => {}).finally(() => { busy = null; pump(); });
  };
  if (grab) input.addEventListener('pointerdown', () => grab());
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = show(v); paint(); if (live) { next = v; pump(); } });
  input.addEventListener('change', async () => {
    const v = Number(input.value);
    next = null;
    if (busy) await busy;
    // after live steps the release is always sent: it is the one that is confirmed (and a drag back to the start may
    // have left the device on a step in between)
    if (v === value && !moved) return;
    moved = false;
    run(el, () => onCommit(v));
  });
  return el;
}

// Number with - / + steppers; commits on Enter, blur or a stepper press.
export function stepper({ value, min, max, step = 1, onCommit, disabled, unit, big, label }) {
  const input = h('input', { type: 'number', min, max, step, value: value ?? '', disabled, inputmode: 'numeric', 'aria-label': label });
  const el = h('div', { class: `stepper${big ? ' big' : ''}` });
  const commit = (v) => {
    v = clamp(Math.round(v / step) * step, min, max);
    input.value = v;
    if (v === value) return;
    run(el, () => onCommit(v));
  };
  const minus = h('button', { class: 'step', disabled, 'aria-label': 'decrease', onclick: () => commit(Number(input.value) - step) }, '−');
  const plus = h('button', { class: 'step', disabled, 'aria-label': 'increase', onclick: () => commit(Number(input.value) + step) }, '+');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', () => { if (input.value !== '' && Number(input.value) !== value) commit(Number(input.value)); });
  el.append(...[minus, input, unit ? h('span', { class: 'unit' }, unit) : null, plus].filter(Boolean));
  return el;
}

// Battery / level ring.
export function ring({ value, size = 64, stroke = 6, color, label, sub, charging }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = value == null ? 0 : clamp(value, 0, 100);
  const col = color || (pct <= 15 ? 'var(--bad)' : pct <= 35 ? 'var(--warn)' : 'var(--good)');
  const el = h('div', { class: 'ring', style: { width: `${size}px`, height: `${size}px` } });
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ring-fg" stroke="${col}"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" style="--to:${c * (1 - pct / 100)}"/></svg>`;
  el.append(h('div', { class: 'ring-label' }, value == null ? '—' : label ?? `${pct}`, sub ? h('small', {}, sub) : null, charging ? icon('bolt', 'ic charge') : null));
  return el;
}

// Setting row: title, description and a control on the right.
// The row's title names the sliders, number boxes and lists inside it for screen readers ("Volume, slider, 42%"),
// unless they already have a name (20 Oct 2026, accessibility).
export function row(title, desc, control, extra) {
  const name = typeof title === 'string' ? title : title?.textContent;
  if (name && control instanceof Element) {
    const inputs = control.matches?.('input, select') ? [control] : [...control.querySelectorAll('input, select')];
    for (const el of inputs) if (!el.getAttribute('aria-label') && !el.id) el.setAttribute('aria-label', name);
  }
  return h('div', { class: 'srow' }, h('div', { class: 'srow-text' }, h('div', { class: 'srow-title' }, title, extra), desc ? h('div', { class: 'srow-desc' }, desc) : null), h('div', { class: 'srow-ctl' }, control));
}

// The cards used once in a while, folded under one row (a native <details>: keyboard and screen readers work as they
// do everywhere). The row names what is inside; open or closed is remembered per page (20 Oct 2026).
export function more(id, what, ...body) {
  let open = false;
  try { open = localStorage.getItem(`more:${id}`) === '1'; } catch {}
  const d = h('details', { class: 'more', open: open || null },
    h('summary', { 'aria-label': `More: ${what}` }, h('span', { class: 'more-title' }, 'More'), h('span', { class: 'more-what' }, what)),
    h('div', { class: 'more-body' }, ...body.filter(Boolean)));
  const remember = (on) => { try { localStorage.setItem(`more:${id}`, on ? '1' : '0'); } catch {} };
  // remembered on the click itself (a page redraw can land before the toggle event and would otherwise close it again)
  d.querySelector('summary').addEventListener('click', () => remember(!d.open));
  d.addEventListener('toggle', () => remember(d.open));
  return d;
}

export function card(title, ...body) {
  return h('section', { class: 'panel' }, title ? h('header', { class: 'panel-head' }, ...[].concat(title)) : null, ...body);
}

// sentence case: the first letter capital (pills are no longer set in capitals by the stylesheet)
// A placeholder while something loads: shimmering lines (widths in %) where its text will be
export function skeleton(widths = [70, 45, 60]) { return h('div', { class: 'skel', 'aria-hidden': 'true' }, ...widths.map((w) => h('i', { style: { width: `${w}%` } }))); }
// a card that is still loading: its title, and shimmering rows where its settings will be
export function loadingCard(title, rows = 3, ic) {
  return card([ic ? icon(ic) : null, h('h2', {}, title), h('span', { class: 'spacer' }), h('span', { class: 'skel-note' }, 'Loading')].filter(Boolean),
    ...Array.from({ length: rows }, (_, i) => h('div', { class: 'srow skel-row' }, skeleton([[55, 70, 40, 62][i % 4]]), h('i', { class: 'skel-ctl' }))));
}
export function pill(text, kind = '') { const t = typeof text === 'string' && text ? text[0].toUpperCase() + text.slice(1) : text; return h('span', { class: `pill ${kind}` }, t); }

export function button(label, onclick, { kind = '', ic, title, disabled } = {}) {
  const b = h('button', { class: `btn ${kind}`, title, disabled }, ic ? icon(ic) : null, label ? h('span', {}, label) : null);
  b.addEventListener('click', async (e) => {
    if (b.dataset.busy) return;
    b.dataset.busy = '1';
    const t = setTimeout(() => b.classList.add('pending'), 500);
    try { await onclick(e); } finally { clearTimeout(t); delete b.dataset.busy; b.classList.remove('pending'); }
  });
  return b;
}

// Battery cell (19 Oct 2026): a slim segmented battery in the device color, its level, and the time left measured
// from Shawn's own use (server: /api/battery-estimate). Ten segments; the last ones warn and alert.
let estimates = {}, estimatesAt = 0;
export function loadBatteryEstimates(onChange) {
  if (Date.now() - estimatesAt < 60 * 1000) return;
  estimatesAt = Date.now();
  fetch('/api/battery-estimate').then((r) => r.json()).then((e) => { estimates = { ...(e || {}), ...demoEstimates }; onChange?.(); }).catch(() => {});
}
// in demo mode a pretend added device brings its own estimate (public/devices/demo.js)
const demoEstimates = {};
export function useDemoEstimate(id, e) { demoEstimates[id] = e; estimates[id] = e; }
// the time left as words ("~6 h left"), or null until DeviceHub has watched the battery drain for a while; for an added
// device's page (22 Oct 2026), which shows it as plain text
export const batteryLeft = (id, charging) => (charging ? null : estimates[id]?.hoursLeft ? timeLeft(estimates[id].hoursLeft) : null);
const timeLeft = (h) => (h >= 48 ? `~${Math.round(h / 24)} days left` : h >= 1 ? `~${Math.round(h)} h left` : `~${Math.max(1, Math.round(h * 60))} min left`);
// The mouse's percent is DeviceHub's own level (helpers/mouse-level.js); its raw voltage reading is in `reported`.
export function batteryCell({ id, percent, charging, big, reported, compact }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  // Shawn, 19 Oct 2026: green while charging; otherwise white, yellow at 20% and below, red at 10% and below
  const tone = charging ? 'var(--good)' : p <= 10 ? 'var(--bad)' : p <= 20 ? 'var(--warn)' : 'var(--signal)';
  const est = estimates[id];
  // time left once DeviceHub has watched the battery drain for a while (30 min and 2%); nothing until then
  const note = charging ? (p >= 100 ? 'Charged' : 'Charging') : est?.hoursLeft ? timeLeft(est.hoursLeft) : null;
  // the hover note is the mouse's and the headset's only (an added device shows no tooltip)
  const tip = id !== 'mouse' && id !== 'headset' ? null : reported != null && reported !== p ? `The mouse itself reads ${reported}%: its reading comes from the battery voltage, which the charger lifts. ${p}% is DeviceHub's level.`
    : est?.ratePerHour && !charging ? `Draining about ${est.ratePerHour}% an hour lately` : null;
  if (compact) return h('div', { class: `bcell compact${charging ? ' charging' : ''}`, style: { '--bt': tone }, title: tip }, compactBattery(p));
  return h('div', { class: `bcell${big ? ' big' : ''}${charging ? ' charging' : ''}`, style: { '--bt': tone }, title: tip },
    // one solid fill, like the iOS battery
    h('div', { class: 'bcell-shape' }, h('div', { class: 'bcell-body' }, h('div', { class: 'bcell-fill', style: { width: `${Math.max(p, 4)}%` } })), h('div', { class: 'bcell-nub' })),
    h('div', { class: 'bcell-text' }, h('b', {}, `${p}%`), note ? h('span', {}, note) : null));
}

// The compact battery (Overview tiles), as on the iPhone: the number is cut out of the fill, so the tile shows through
// the digits; over the empty part of the battery the digits are drawn in a soft white.
let batteryIds = 0;
function compactBattery(p) {
  const id = `b${++batteryIds}`, W = 46, H = 22, inner = W - 6, fw = Math.max(2, (inner * Math.max(p, 4)) / 100);
  const text = `<text x="${3 + inner / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="central" font-size="12.5" font-weight="700" font-family="Segoe UI Variable Text, Segoe UI, system-ui, sans-serif">${p}</text>`;
  return svgEl(`<svg class="bcell-svg" viewBox="0 0 ${W + 4} ${H}" width="${W + 4}" height="${H}" aria-label="${p}%">
    <defs>
      <mask id="${id}m"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${text.replace('<text ', '<text fill="#000" ')}</mask>
      <clipPath id="${id}e"><rect x="${3 + fw}" y="0" width="${W}" height="${H}"/></clipPath>
    </defs>
    <rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="7" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="1.5"/>
    <rect x="${W + 1}" y="${H / 2 - 3.5}" width="2.5" height="7" rx="1.2" fill="rgba(255,255,255,.34)"/>
    <rect x="3" y="3" width="${fw}" height="${H - 6}" rx="4" fill="var(--bt)" mask="url(#${id}m)"/>
    <g clip-path="url(#${id}e)">${text.replace('<text ', '<text fill="rgba(255,255,255,.85)" ')}</g>
  </svg>`);
}

// ---------- the kinds an added device's page also uses (22 Oct 2026, page kinds; helpers/my-devices.mjs) ----------

// A reading the device reports and DeviceHub never writes (ChatMix, a sensor name): just the value, with its unit.
export function readout({ value, unit = '' }) {
  const text = value == null ? '—' : typeof value === 'boolean' ? (value ? 'on' : 'off') : `${value}${typeof value === 'number' ? unit : ''}`;
  return h('output', { class: 'readout' }, text);
}

// One RGB color: a row of swatches (the theme accent look) and a hex box. No color dialog. A swatch commits at once;
// the hex box on Enter or when it loses focus (a typo puts the device's value back).
export const COLOR_SWATCHES = [['#ffffff', 'White'], ['#ff0000', 'Red'], ['#ff8000', 'Orange'], ['#ffff00', 'Yellow'], ['#00ff00', 'Green'],
  ['#00ffff', 'Cyan'], ['#0000ff', 'Blue'], ['#ff00ff', 'Magenta'], ['#000000', 'Off']];
export function colorRow({ value, onCommit, label = 'color', disabled }) {
  const cur = typeof value === 'string' ? value.toLowerCase() : null;
  const el = h('div', { class: 'theme-row kind-color' });
  const pick = (hex) => {
    for (const b of el.querySelectorAll('.theme-swatch')) { const on = b.dataset.hex === hex; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); }
    box.value = hex;
    dot.style.setProperty('--s', hex);
    run(el, () => onCommit(hex)).catch(() => {});
  };
  for (const [hex, name] of COLOR_SWATCHES) {
    el.append(h('button', { class: `theme-swatch${cur === hex ? ' sel' : ''}`, style: { '--s': hex }, dataset: { hex }, disabled,
      'aria-label': `${label}: ${name}`, 'aria-pressed': String(cur === hex), onclick: () => { if (hex !== cur) pick(hex); } }));
  }
  const box = h('input', { class: 'text hexbox', value: cur || '', placeholder: '#rrggbb', maxlength: 7, spellcheck: 'false', disabled, 'aria-label': `${label}, hex` });
  const done = () => {
    const t = box.value.trim().toLowerCase().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/.test(t) && t !== cur) pick(t); else box.value = cur || '';
  };
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); if (e.key === 'Escape') { box.value = cur || ''; box.blur(); } });
  box.addEventListener('blur', done);
  const dot = h('i', { class: 'hexdot', style: { '--s': cur || 'transparent' }, 'aria-hidden': 'true' });
  el.append(dot, box);
  return el;
}

// Several lines under one setting (color zones, button remaps): a name on the left, its control on the right.
export function lineList(lines) {
  return h('div', { class: 'kind-list' }, ...lines.flatMap(([name, ctl]) => [h('span', { class: 'kind-name' }, name), h('div', { class: 'kind-ctl' }, ctl)]));
}

// A button -> action choice: one select per button, holding only the targets the driver lists.
export function remapSelect({ value, targets, onCommit, label, disabled }) {
  const sel = h('select', { class: 'text kind-select', disabled, 'aria-label': label },
    ...(targets.some((t) => t.value === value) ? [] : [h('option', { value: '', disabled: true, selected: true }, value == null ? '—' : `unknown (${value})`)]),
    ...targets.map((t) => h('option', { value: t.value, selected: t.value === value || null }, t.label)));
  sel.addEventListener('change', () => { if (sel.value !== value) run(sel, () => onCommit(sel.value)).catch(() => {}); });
  return sel;
}
