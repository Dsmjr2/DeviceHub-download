// Keyboard page: visual keymap editor for all layers, the knob, macros and lighting.
import { P75, grid } from '../devices/via-layout.js';
import { h, icon } from '../ui/dom.js';
import { card, row, slider, stepper, button, toggle } from '../ui/controls.js';
import { dropdown } from '../ui/dropdown.js';
import { devices, write, writeBatch, isDemo, prepare } from '../core/devices.js';
import { topbar, connectState, deviceActions, vendorNote, kv, statusPill, isAway, awayBanner, undoButton, deviceHelp } from './common.js';
import { modal } from '../ui/overlay.js';
import { keyName, shortName, isSpecialKey, isDangerous, pickerGroups, hex, CODE_TO_HID, EFFECTS } from '../devices/keycodes.js';
import { hsv255ToHex, rgbToHsv255 } from '../devices/keyboard-adapter.js';
import { toast } from '../ui/overlay.js';
import { loadPc, pcLoaded, otherDevices } from './pc-lights.js';

// The keyboard's layout (devices/via-layout.js): the P75's built in, any other VIA keyboard's from its VIA definition,
// sent with the keyboard's session. [row][col] -> [x, y, width, kind] in key units; null = no key.
const layoutOf = () => d()?.adapter?.session?.layout || P75;
let gridCache = { of: null, g: null };
const LAYOUT_NOW = () => { const l = layoutOf(); if (gridCache.of !== l) gridCache = { of: l, g: grid(l) }; return gridCache.g; };
const LAYER_NAMES = ['Base', 'Fn', 'Layer 2', 'Layer 3', 'Layer 4'];

const ui = { layer: 0, target: null, query: '', tester: false, undo: [], tested: new Set() };
const d = () => devices.keyboard;

function currentCode(s) {
  const t = ui.target;
  if (!t) return null;
  if (t.type === 'key') return s.keymap[ui.layer][t.r][t.c];
  if (t.type === 'enc') return s.encoders?.[ui.layer]?.[t.cw ? 1 : 0];
  return null;
}

async function assign(code) {
  const s = d().adapter.session;
  const t = ui.target;
  if (!t) return;
  if (isDangerous(code)) { toast('Reset keys are blocked', 'bad'); return; }
  const from = currentCode(s);
  if (from === code) return;
  const key = t.type === 'key' ? `key:${ui.layer}:${t.r}:${t.c}` : `enc:${ui.layer}:0:${t.cw ? 1 : 0}`;
  const where = t.type === 'key' ? `${LAYER_NAMES[ui.layer]} key "${shortName(s.keymap[0][t.r][t.c])}"` : `${LAYER_NAMES[ui.layer]} knob ${t.cw ? 'right' : 'left'}`;
  try {
    await write('keyboard', key, code, { label: where, display: keyName(code) });
    ui.undo.push({ key, layer: ui.layer, target: t, from, to: code, where });
  } catch {}
}

async function undoLast() {
  const u = ui.undo.pop();
  if (!u) return;
  try { await write('keyboard', u.key, u.from, { label: `Undo ${u.where}`, display: keyName(u.from) }); } catch { ui.undo.push(u); }
}

function keyboardView(s) {
  const layer = s.keymap[ui.layer];
  const v = d().values;
  // The drawn board glows in the keyboard's real color (and dims with its brightness).
  const glow = v.hue != null ? hsv255ToHex(v.hue, v.saturation ?? 255, Math.max(90, v.brightness ?? 255)) : null;
  const kbEl = h('div', { class: 'kb', style: glow ? { '--glowc': glow } : null });
  const lay = layoutOf();
  const inner = h('div', { class: 'kb-inner', style: { width: `calc(var(--u) * ${lay.width})`, height: `calc(var(--u) * ${lay.height})` } });
  LAYOUT_NOW().forEach((rowL, r) => rowL.forEach((pos, c) => {
    if (!pos) return;
    const [x, y, w, kind] = pos;
    const code = layer[r][c];
    const phys = s.keymap[0][r][c];
    const changed = s.original && s.original[ui.layer][r][c] !== code;
    const sel = ui.target?.type === 'key' && ui.target.r === r && ui.target.c === c;
    const cls = ['key', kind === 'knob' ? 'knob' : '', code === 1 ? 'trans' : '', isSpecialKey(code) ? 'special' : '', changed ? 'changed' : '', sel ? 'sel' : '', ui.tester && ui.tested.has(String(phys)) ? 'tested' : ''].join(' ');
    inner.append(h('button', {
      class: cls, dataset: { r, c, phys },
      style: { left: `calc(var(--u) * ${x})`, top: `calc(var(--u) * ${y})`, width: `calc(var(--u) * ${w})`, height: 'var(--u)' },
      title: `${keyName(code)}${ui.layer ? `\nBase key: ${keyName(phys)}` : ''}`,
      onclick: () => { ui.target = sel ? null : { type: 'key', r, c }; rerender(); },
    }, h('span', { class: 'cap' }, h('span', { class: `lbl${kind !== 'knob' && shortName(code).length >= 4 ? ' long' : ''}` }, kind === 'knob' ? icon('knob') : shortName(code)), ui.layer && kind !== 'knob' ? h('span', { class: 'phys' }, shortName(phys)) : null)));
  }));
  kbEl.append(inner);
  return h('div', { class: 'kb-wrap' }, kbEl);
}

function picker(s) {
  const t = ui.target;
  if (!t) {
    return h('div', { class: 'picker' }, h('div', { class: 'picker-cur' }, h('div', { class: 'bigcap' }, '?'), h('div', { class: 'meta' }, h('b', {}, 'Pick a key'), 'Click a key to change it.')),
      ui.undo.length ? button(`Undo: ${ui.undo.at(-1).where}`, undoLast, { kind: 'ghost', ic: 'undo' }) : null);
  }
  const code = currentCode(s);
  const title = t.type === 'key' ? (ui.layer ? `${LAYER_NAMES[ui.layer]} · on the ${shortName(s.keymap[0][t.r][t.c])} key` : `The ${shortName(code)} key`) : `Knob turned ${t.cw ? 'right' : 'left'} · ${LAYER_NAMES[ui.layer]}`;
  const listEl = h('div', { class: 'picker-list' });
  const fill = () => {
    const q = ui.query.trim().toLowerCase();
    const groups = pickerGroups(s.info.layers).map(([g, items]) => [g, items.filter(([k, n]) => !q || n.toLowerCase().includes(q) || g.toLowerCase().includes(q) || hex(k).includes(q))]).filter(([, items]) => items.length);
    listEl.replaceChildren(...(groups.length ? groups.map(([g, items]) => h('div', { class: 'picker-group' }, h('h4', {}, g),
      h('div', { class: 'picker-keys' }, ...items.map(([k, n]) => h('button', { class: `pk${k === code ? ' cur' : ''}`, title: hex(k), onclick: () => assign(k) }, n))))) : [h('div', { class: 'faint' }, 'No match. Try a raw keycode below.')]));
  };
  const search = h('input', { class: 'text', placeholder: 'Search keys…', value: ui.query, 'aria-label': 'search keys' });
  search.addEventListener('input', () => { ui.query = search.value; fill(); });
  const raw = h('input', { class: 'text mono', placeholder: '0x0004', style: { width: '120px' }, 'aria-label': 'raw keycode' });
  fill();
  queueMicrotask(() => search.focus({ preventScroll: true }));
  return h('div', { class: 'picker' },
    h('div', { class: 'picker-cur' }, h('div', { class: 'bigcap' }, t.type === 'key' ? shortName(code) : icon('knob')), h('div', { class: 'meta' }, h('b', {}, title), `Now: ${keyName(code)}`)),
    search, listEl,
    h('div', { class: 'actions', style: { alignItems: 'center' } }, raw, button('Set raw', () => { const k = parseInt(raw.value, 16); if (Number.isNaN(k) || k < 0 || k > 0xffff) toast('Use hex, like 0x0004', 'bad'); else assign(k); }, { kind: 'ghost small' }),
      ui.undo.length ? button('Undo last', undoLast, { kind: 'ghost small', ic: 'undo' }) : null,
      button('Done', () => { ui.target = null; rerender(); }, { kind: 'ghost small' })));
}

// ---------- layer tools: copy, reset, Fn cheat-sheet ----------
function* positions() { const g = LAYOUT_NOW(); for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c]) yield [r, c]; }

async function runLayerPlan(title, intro, items) {
  if (!items.length) { toast('Nothing to change', 'good'); return; }
  const ok = await modal(title, h('div', {}, h('p', { style: { marginTop: 0 } }, intro),
    h('p', {}, `${items.length} key${items.length === 1 ? '' : 's'} will change.`)),
  [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Change keys', value: true, kind: 'primary' }]);
  if (!ok) return;
  const t = toast(`${title}…`, 'busy', { ms: 0 });
  const r = await writeBatch('keyboard', items, title);
  t.update(r.failed ? `${title}: ${r.failed} key(s) not changed` : `${title}: done`, r.failed ? 'bad' : 'good', `${r.done} changed${r.failed ? `, ${r.failed} failed (see Activity)` : ''}`);
}

async function copyLayer(s, from) {
  const choices = LAYER_NAMES.slice(0, s.info.layers).map((n, i) => [i, n]).filter(([i]) => i !== from && i !== 0);
  const sel = dropdown({ label: 'copy to layer', value: choices[0]?.[0], options: choices.map(([i, n]) => ({ value: i, label: `${i} · ${n}` })) });
  const ok = await modal(`Copy ${LAYER_NAMES[from]} layer`, h('div', {}, h('p', { style: { marginTop: 0 } }, 'Copy this layer onto:'), sel,
    h('p', { class: 'faint', style: { fontSize: '12.5px' } }, 'Skips the base layer and reset keys.')),
  [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Next', value: true, kind: 'primary' }]);
  if (!ok) return;
  const to = Number(sel.value);
  const items = [];
  let skipped = 0;
  for (const [r, c] of positions()) {
    const code = s.keymap[from][r][c];
    if (isDangerous(code)) { skipped++; continue; }
    if (s.keymap[to][r][c] !== code) items.push({ key: `key:${to}:${r}:${c}`, value: code, label: `${LAYER_NAMES[to]} key ${shortName(s.keymap[0][r][c])}`, display: keyName(code) });
  }
  await runLayerPlan(`Copy ${LAYER_NAMES[from]} to ${LAYER_NAMES[to]}`, `${LAYER_NAMES[to]} will match ${LAYER_NAMES[from]}${skipped ? ` (${skipped} reset/bootloader key${skipped === 1 ? '' : 's'} left as they are)` : ''}.`, items);
}

async function resetLayer(s, layer) {
  const items = [];
  for (const [r, c] of positions()) if (s.keymap[layer][r][c] !== 1) items.push({ key: `key:${layer}:${r}:${c}`, value: 1, label: `${LAYER_NAMES[layer]} key ${shortName(s.keymap[0][r][c])}`, display: keyName(1) });
  await runLayerPlan(`Reset ${LAYER_NAMES[layer]}`, `Every key on ${LAYER_NAMES[layer]} becomes ▽, so it does what the layer below does.`, items);
}

function cheatSheet(s) {
  const rows = [];
  for (const [r, c] of positions()) {
    const code = s.keymap[1][r][c];
    if (code === 1 || code === 0) continue;
    rows.push([shortName(s.keymap[0][r][c]), keyName(code), isDangerous(code)]);
  }
  const body = h('div', { class: 'diff' }, ...rows.map(([base, action, danger]) => h('div', { style: { gridTemplateColumns: '120px 1fr' } },
    h('b', { style: { color: 'var(--text)' } }, `Fn + ${base}`), h('span', { style: danger ? { color: 'var(--bad)' } : null }, action + (danger ? ' (resets the keyboard)' : '')))));
  const actions = [{ label: 'Close', value: 'close', kind: 'ghost' }];
  if (!isDemo()) actions.unshift({ label: 'Print', value: 'print', kind: 'primary' });
  modal('Fn layer cheat-sheet', h('div', {}, h('p', { style: { marginTop: 0 } }, `${rows.length} Fn combinations on your ${layoutOf().name.replace(/^Epomaker /, '')}:`), body), actions).then((v) => { if (v === 'print') window.print(); });
}

// The knob (19 Oct 2026, Shawn: "I still don't understand the knob setting"): the three things it does, each with
// what it does now and a Change button that opens the action picker under the board. Pressing it is matrix key 0,14.
function knobPanel(s) {
  if (!s.encoders) return null;
  const enc = s.encoders[ui.layer];
  const press = s.keymap[ui.layer][0][14];
  const pick = (target) => { ui.target = target; rerender(); requestAnimationFrame(() => document.querySelector('.picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); };
  const row = (what, how, code, target, isSel) => h('div', { class: `knob-act${isSel ? ' sel' : ''}` },
    h('div', { class: 'knob-what' }, h('b', {}, what), h('small', {}, how)),
    h('span', { class: 'knob-now' }, keyName(code)),
    button(isSel ? 'Choosing…' : 'Change', () => pick(isSel ? null : target), { kind: 'small' }));
  const t = ui.target;
  return card([h('h2', {}, 'Knob'), h('span', { class: 'sub' }, ui.layer ? `on the ${LAYER_NAMES[ui.layer]} layer` : null)],
    row('Turn left', null, enc[0], { type: 'enc', cw: false }, t?.type === 'enc' && !t.cw),
    row('Turn right', null, enc[1], { type: 'enc', cw: true }, t?.type === 'enc' && t.cw),
    row('Press', null, press, { type: 'key', r: 0, c: 14 }, t?.type === 'key' && t.r === 0 && t.c === 14));
}

function macroPanel(s) {
  const m = s.macros;
  const used = m.raw?.length ? m.raw.reduce((n, x) => n + x.length + 1, 0) : null;
  // in plain steps (22 Oct 2026, Shawn: "make this description make more sense and easier to understand")
  const help = h('div', { class: 'macro-help' },
    h('p', {}, 'One key types your text.'),
    h('ol', {},
      h('li', {}, 'Type the text below, press Save.'),
      h('li', {}, 'In Key mapping, click a key, pick the macro.')),
    h('p', { class: 'faint' }, 'Special keys go in braces: ', h('code', {}, '{Enter}'), ', ', h('code', {}, '{Tab}'), ', ', h('code', {}, '{Ctrl+C}'), '; ',
      h('code', {}, '{wait 200}'), ' pauses 200 ms; ', h('code', {}, '{{'), ' types a brace.'));
  // the slots in use, plus the first empty one to add a macro (or all of them)
  const firstEmpty = m.list.slice(0, m.mi.count).findIndex((t) => !t);
  const show = m.list.slice(0, m.mi.count).map((text, i) => [text, i]).filter(([text, i]) => ui.allMacros || text || i === firstEmpty);
  return card([h('h2', {}, 'Macros'), h('span', { class: 'spacer' })], help,
    ...show.map(([text, i]) => {
      const locked = m.editable && !m.editable[i] && !!text;
      const input = h('input', { class: 'text mono', value: text, placeholder: text ? '' : 'e.g. gg{Enter}', 'aria-label': `macro ${i}`, disabled: locked, title: locked ? 'Made in another app; edit it there' : null });
      const save = button('Save', () => write('keyboard', `macro:${i}`, input.value, { label: `Macro ${i}`, display: input.value ? `"${input.value}"` : 'empty' }).catch(() => {}), { kind: 'ghost small' });
      save.disabled = true;
      input.addEventListener('input', () => { save.disabled = input.value === text; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !save.disabled) save.click(); });
      return h('div', { class: 'macro' }, h('span', { class: 'mname' }, `M${i}`), input, save);
    }),
    h('div', { style: { marginTop: '6px' } }, button(ui.allMacros ? 'Show used only' : `All ${m.mi.count} slots`, async () => { ui.allMacros = !ui.allMacros; rerender(); }, { kind: 'ghost small' })));
}

function effectSelect(value, onCommit) {
  const sel = dropdown({ style: { width: '230px' }, label: 'lighting effect', value,
    options: EFFECTS.map((n, i) => ({ value: i, label: n[0].toUpperCase() + n.slice(1) })) });
  const wrap = h('div', { class: 'stepper', style: { border: 0, background: 'none' } }, sel);
  sel.addEventListener('change', async () => { wrap.classList.add('pending'); try { await onCommit(Number(sel.value)); } finally { wrap.classList.remove('pending'); } });
  return wrap;
}

// Lighting (20 Oct 2026, Shawn: color in degrees was hard to use, and brightness did nothing with the lights off):
// color is a row of dots plus one for any color; with the lights off (effect None, when the P75 keeps brightness at
// 0), a color or a brightness above 0 first turns them on with the Solid effect.
const KB_COLORS = ['#ff2d55', '#ff6a1a', '#ffd23f', '#3ddc97', '#3fe0ff', '#5b6cff', '#b48cff', '#ff5d8f', '#ffffff'];
function lightingPanel(dev) {
  const v = dev.values;
  if (v.brightness == null) return card([h('h2', {}, 'Lighting')], h('p', { class: 'faint' }, 'Lighting not answering.'));
  const set = (key, value, label, display) => write('keyboard', key, value, { label, display });
  // the P75 keeps its top step as 250-253 of 255, which is full brightness: show it as 100%
  const pct = (x) => `${x >= 250 ? 100 : Math.round((x / 255) * 100)}%`;
  // lights on/off is the effect: None (0) is off; Fn + Backspace on the P75 flips the same value (measured 20 Oct 2026).
  // Turning them back on brings the last effect used (remembered here; Solid if none)
  let last = 1; try { last = Number(localStorage.getItem('kb-last-effect')) || 1; } catch {}
  if (v.effect > 0 && v.effect !== last) { last = v.effect; try { localStorage.setItem('kb-last-effect', String(last)); } catch {} }
  const lightsOn = async () => { if (v.effect === 0) await set('effect', last, 'Lights', 'on'); };
  const color = async (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const { hue, sat } = rgbToHsv255(r, g, b);
    try {
      await lightsOn();
      if (v.brightness === 0) await set('brightness', 191, 'Brightness', '75%');
      await set('hue', hue, 'Color', hex);
      await set('saturation', sat, 'Color', hex);
    } catch {}
  };
  const now = hsv255ToHex(v.hue, v.saturation);
  return card([h('h2', {}, 'Lighting')],
    row('Lights', null, toggle({ value: v.effect !== 0, label: 'Lights', onCommit: (on) => (on ? lightsOn() : set('effect', 0, 'Lights', 'off')).catch(() => {}) })),
    row('Effect', null, effectSelect(v.effect, (x) => set('effect', x, 'Effect', EFFECTS[x] || `#${x}`).catch(() => {}))),
    row('Color', null, h('div', { class: 'swatches compact' },
      ...KB_COLORS.map((c) => h('button', { class: `swatch${v.effect !== 0 && c.toLowerCase() === now.toLowerCase() ? ' on' : ''}`, style: { '--s': c }, title: c, 'aria-label': `color ${c}`, onclick: () => color(c) })),
      h('input', { type: 'color', class: 'swatch-custom', title: 'Any color', 'aria-label': 'any color', value: now, onchange: (e) => color(e.target.value) }))),
    row('Brightness', null,
      slider({ value: v.effect === 0 ? 0 : v.brightness, min: 0, max: 255, format: pct, grab: () => prepare('keyboard'), live: v.effect === 0 ? null : (x) => write('keyboard', 'brightness', x, { live: true }).catch(() => {}), onCommit: async (x) => { try { if (x > 0) await lightsOn(); await set('brightness', x, 'Brightness', pct(x)); } catch {} } })),
    v.effect === 0 ? null : row('Effect speed', null, slider({ value: v.speed, min: 0, max: 255, format: pct, grab: () => prepare('keyboard'), live: (x) => write('keyboard', 'speed', x, { live: true }).catch(() => {}), onCommit: (x) => set('speed', x, 'Effect speed', pct(x)).catch(() => {}) })));
}

// Live key tester: flash the key that was physically pressed (keys Windows can see, base layer).
// Held keys light up; every key pressed once stays marked "tested", with a count, so a dead key stands out.
function onKey(e) {
  if (!ui.tester || location.hash !== '#/keyboard' || /input|textarea|select/i.test(document.activeElement?.tagName)) return;
  const hid = CODE_TO_HID[e.code];
  if (hid == null) return;
  e.preventDefault();
  const down = e.type === 'keydown';
  if (down) ui.tested.add(String(hid));
  for (const el of $$(`.key[data-phys="${hid}"]`)) { el.classList.toggle('down', down); el.classList.add('tested'); }
  const n = document.querySelector('.tester-count');
  if (n) n.textContent = testerCount();
}
const testerCount = () => `${ui.tested.size} of ${LAYOUT_NOW().flat().filter(Boolean).length} keys tested`;
window.addEventListener('keydown', onKey);
window.addEventListener('keyup', onKey);

let rerender = () => {};

// A VIA keyboard whose layout VIA's library does not have (Keychron Pro and Max boards among them): DeviceHub then
// needs the maker's VIA file in the via-definitions folder, named <VID><PID>.json (helpers/via-defs.js definitionFor),
// and reads it when it starts. Shown here and on Lighting > This PC for a VIA keyboard brand that nothing runs yet.
export const isViaKeyboard = (u) => !!(u?.brand?.transport?.includes('via-qmk') && u.brand.categories?.includes('keyboard') && !/mouse|receiver|dongle/i.test(u.name || ''));
export function viaFileNote(vid, pid, maker) {
  const file = `${vid}${pid}`.toUpperCase() + '.json';
  const site = maker ? `${maker}'s website` : 'the maker\'s website';
  const line = h('p', { class: 'faint', style: { margin: '6px 0' } });
  const actions = h('div', { class: 'actions' }, button('Open folder', () => fetch('/api/reveal?folder=via-definitions', { method: 'POST' }).catch(() => {}), { kind: 'ghost small', ic: 'external' }));
  // "Get the layout" (helpers/via-fetch.mjs): only for a keyboard whose official VIA file DeviceHub knows; the click
  // is the person's yes for that one file, which is checked before it is saved
  if (!isDemo()) fetch(`/api/via-fetch?vid=${encodeURIComponent(vid)}&pid=${encodeURIComponent(pid)}`).then((r) => r.json()).then((p) => {
    if (p.have) { line.textContent = 'Layout found. Keys missing? Restart DeviceHub.'; return; }
    if (!p.source) return;
    const size = p.source.size ? `, about ${(p.source.size / 1024).toFixed(1)} KB` : '';
    line.textContent = `Layout file from ${p.source.host}${size}.`;
    const b = button('Get layout', async () => {
      line.textContent = 'Getting layout…';
      const r = await fetch('/api/via-fetch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, pid }) })
        .then((x) => x.json()).catch(() => ({ error: 'DeviceHub did not answer.' }));
      if (r.ok) { b.remove(); line.textContent = 'Saved. Restart DeviceHub to show its keys.'; }
      else line.textContent = `Not saved. ${r.error || ''}`.trim();
    }, { kind: 'small' });
    actions.prepend(b);
  }).catch(() => {});
  return h('div', { class: 'via-file' },
    h('p', { class: 'faint', style: { margin: '6px 0' } }, `No keys? Get its VIA .json from ${site}, save it as ${file} in via-definitions, restart DeviceHub.`),
    line, actions);
}
// on the Keyboard page while no keyboard runs: the VIA keyboards This PC found (pc-lights.js reads the PC once)
function viaHelp() {
  if (isDemo()) return null;
  if (!pcLoaded()) { loadPc(false, () => { if (location.hash === '#/keyboard') rerender(); }); return null; }
  const kbs = otherDevices().filter(isViaKeyboard);
  return kbs.length ? h('div', { style: { marginTop: '18px' } }, ...kbs.map((u) => card([h('h2', {}, u.name || `${u.brand.name} keyboard`)],
    h('p', { style: { margin: 0 } }, `USB ${u.id}, plugged in.`), viaFileNote(u.vid, u.pid, u.brand.name)))) : null;
}

export default {
  id: 'keyboard', title: 'Keyboard', icon: 'keyboard', device: 'keyboard', accent: 'var(--c-keyboard)', watches: ['keyboard'],
  render() {
    const dev = d();
    const a = dev.adapter;
    rerender = () => { const el = document.querySelector('#main .page'); if (el) el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    const head = topbar('Epomaker · 75% wireless keyboard', a.title, null, h('div', { class: 'chips' }, undoButton(dev), statusPill(dev)), deviceHelp(dev));
    if ((dev.status !== 'connected' && !isAway(dev)) || !a.session) {
      return h('div', {}, head, connectState(dev, 'Plug in its USB cable, press Connect. Close VIA and the maker\'s app first.'), viaHelp());
    }
    const s = a.session;
    const changed = s.original ? s.keymap.reduce((n, l, li) => n + l.reduce((m, r, ri) => m + r.filter((k, ci) => k !== s.original[li][ri][ci]).length, 0), 0) : 0;
    return h('div', {}, head, awayBanner(dev),
      card([h('h2', {}, 'Key mapping'), h('span', { class: 'sub' }, changed ? `${changed} key${changed === 1 ? '' : 's'} changed this session` : null),
        h('span', { class: 'spacer' }),
        ui.tester ? h('span', { class: 'tester-count faint', style: { fontSize: '12.5px' } }, testerCount()) : null,
        ui.tester && ui.tested.size ? button('Reset', () => { ui.tested.clear(); rerender(); }, { kind: 'ghost small' }) : null,
        h('label', { class: 'actions', style: { alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)' } }, 'Key tester', toggle({ value: ui.tester, label: 'Key tester', onCommit: async (on) => { ui.tester = on; document.activeElement?.blur(); rerender(); } }))],
        h('div', { class: 'actions', style: { justifyContent: 'space-between', marginBottom: '14px' } },
          h('div', { class: 'layer-tabs', role: 'tablist' }, ...LAYER_NAMES.slice(0, s.info.layers).map((n, i) => h('button', { class: `layer-tab${i === ui.layer ? ' sel' : ''}`, role: 'tab', 'aria-selected': String(i === ui.layer), onclick: () => { ui.layer = i; if (ui.target?.type === 'enc') ui.target = null; rerender(); } }, `${i} · ${n}`))),
          h('div', { class: 'actions', style: { alignItems: 'center' } },
            ui.layer ? h('span', { class: 'faint', style: { fontSize: '12.5px' } }, '▽ = same as the layer below') : null,
            button('Copy layer', () => copyLayer(s, ui.layer), { kind: 'ghost small' }),
            ui.layer ? button('Reset layer', () => resetLayer(s, ui.layer), { kind: 'ghost small' }) : null,
            button('Fn cheat-sheet', () => cheatSheet(s), { kind: 'ghost small' }))),
        h('div', { class: 'kb-layout' }, keyboardView(s), picker(s)),
        h('div', { class: 'mini-legend' },
          h('span', {}, h('i', { style: { background: '#3a3934' } }), 'normal key'),
          h('span', {}, h('i', { style: { background: 'color-mix(in srgb, var(--accent) 22%, #3a3934)' } }), 'layer / media / lighting'),
          h('span', {}, h('i', { style: { background: 'var(--signal)', borderRadius: '50%' } }), 'changed this session'),
          h('span', {}, icon('shield', 'ic'), 'Reset keys blocked'))),
      h('div', { class: 'grid two', style: { marginTop: '18px' } },
        h('div', { class: 'stack' }, knobPanel(s), lightingPanel(dev)),
        macroPanel(s)),
      h('div', { style: { marginTop: '18px' } }, card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(dev)], kv(dev.info), h('div', { style: { marginTop: '14px' } }, vendorNote(a)))));
  },
};
