// Display settings on each monitor's card (24 Oct 2026, docs/handoff/display-health.md): resolution, refresh rate, HDR,
// main screen, and Night light (read only, with Windows Settings one click away). Server: helpers/display.js.
// Every change is backed up, tested and read back there, then waits 15 s for Keep; no answer puts it back.
// No pop-ups: the question, the countdown and every result are plain lines on the card.
import { h } from './dom.js';
import { row, toggle, button, pill } from './controls.js';
import { dropdown } from './dropdown.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';

let disp = null, error = null, loadedAt = 0, loading = false, tick = null, note = null;
let redraw = () => {};

const DEMO = () => ({ nightLight: false, pending: null, last: null, screens: [
  { screen: '\\\\.\\DISPLAY1', id: 'DEMO1#1', name: 'Demo monitor', primary: true, width: 2560, height: 1440, hz: 60, hdr: { supported: true, on: false },
    resolutions: [{ width: 2560, height: 1440, rates: [144, 120, 60] }, { width: 1920, height: 1080, rates: [144, 60] }], flag: { text: 'Running at 60 Hz; this screen does 144 Hz.', fix: { width: 2560, height: 1440, hz: 144 } } }] });

async function load() {
  if (loading) return; loading = true;
  try { disp = isDemo() ? (disp || DEMO()) : await env.api('/api/display'); error = null; loadedAt = Date.now(); }
  catch (e) { error = e.message; }
  finally { loading = false; follow(); redraw(); }
}

// while a change waits for Keep: its seconds left, once a second, and only then
function follow() {
  if (!disp?.pending) { clearInterval(tick); tick = null; return; }
  if (tick) return;
  tick = setInterval(async () => {
    if (location.hash !== '#/monitors') { clearInterval(tick); tick = null; return; }
    try {
      const st = await env.api('/api/display/state');
      const was = disp.pending;
      Object.assign(disp, st);
      if (!st.pending) { clearInterval(tick); tick = null; note = st.last; if (was) { await load(); return; } }
    } catch { /* the next second asks again */ }
    redraw();
  }, 1000);
}

async function send(path, body, name) {
  if (isDemo()) { note = { ok: true, text: `${name || disp.screens[0].name}: demo, nothing is changed.` }; redraw(); return; }
  note = null;
  try {
    const st = await env.api(path, body || {});
    note = st.last || null;
    await load();
  } catch (e) { note = { ok: false, text: `${name || disp?.pending?.name || 'Display'}: ${e.message}` }; await load(); }
}
const change = (s, kind, value) => send('/api/display/set', { screen: s.screen, kind, value }, s.name);
const openSettings = (page) => (isDemo() ? null : env.api('/api/display/open-settings', { page }).catch(() => {}));

const line = (text, cls = 'faint') => h('p', { class: `disp-line ${cls}` }, text);

// the glass dropdown (ui/dropdown.js), same arguments as before
function select(options, value, onPick, label, disabled) {
  return dropdown({ cls: 'disp-select', options, value, label, disabled, onChange: onPick });
}

function block(s) {
  const busy = !!disp.pending;
  const cur = s.resolutions.find((r) => r.width === s.width && r.height === s.height) || { rates: [s.hz] };
  const resOptions = s.resolutions.map((r) => ({ value: `${r.width}x${r.height}`, label: `${r.width} x ${r.height}` }));
  const pickRes = (v) => {
    const [w, hgt] = v.split('x').map(Number);
    const r = s.resolutions.find((x) => x.width === w && x.height === hgt);
    // the same rate if this resolution has it, else its highest
    change(s, 'mode', { width: w, height: hgt, hz: r.rates.includes(s.hz) ? s.hz : r.rates[0] });
  };
  const waiting = disp.pending && disp.pending.screen === s.screen ? disp.pending : null;
  return h('div', { class: 'disp-block' },
    h('h4', { class: 'disp-head' }, 'Display'),
    waiting ? h('div', { class: 'disp-keep', role: 'status' },
      h('p', {}, h('b', {}, `Keep this? ${waiting.text}.`)),
      h('p', { class: 'faint' }, `It changes back in ${waiting.secondsLeft} s.`),
      h('div', { class: 'disp-keep-btns' }, button('Keep', () => send('/api/display/keep', null, s.name), { kind: 'primary small' }), button('Undo', () => send('/api/display/undo', null, s.name), { kind: 'ghost small' }))) : null,
    s.flag ? h('div', { class: 'disp-flag' }, line(s.flag.text, 'warn'), button(`Use ${s.flag.fix.hz} Hz`, () => change(s, 'mode', s.flag.fix), { kind: 'small', disabled: busy })) : null,
    row('Resolution', null, select(resOptions, `${s.width}x${s.height}`, pickRes, `${s.name} resolution`, busy)),
    row('Refresh rate', null, select(cur.rates.map((hz) => ({ value: String(hz), label: `${hz} Hz` })), String(s.hz), (v) => change(s, 'mode', { width: s.width, height: s.height, hz: Number(v) }), `${s.name} refresh rate`, busy)),
    row('HDR', null, s.hdr?.supported ? toggle({ value: s.hdr.on, label: `${s.name} HDR`, disabled: busy, onCommit: (v) => change(s, 'hdr', v) }) : h('span', { class: 'faint' }, 'Not offered')),
    row('Main screen', null, s.primary ? pill('Main') : button('Make main', () => change(s, 'primary', true), { kind: 'ghost small', disabled: busy })),
    row('Night light', null, h('span', { class: 'disp-night' }, h('b', {}, disp.nightLight === true ? 'On' : disp.nightLight === false ? 'Off' : 'Not known'),
      button('Settings', () => openSettings('nightlight'), { kind: 'ghost small' }))),
    disp.nightLight == null ? null : line('Night light: set in Windows Settings.'),
    note && (!disp.pending) && note.text?.startsWith(s.name) ? line(note.text, note.ok ? 'good' : 'bad') : null);
}

// the block for the monitor card whose id matches a screen; called on every redraw of the Monitors page
export function displayBlock(m, rerender) {
  redraw = rerender;
  if (!disp && !error) { queueMicrotask(load); return null; }
  if (disp && !loading && !disp.pending && Date.now() - loadedAt > 30000) queueMicrotask(load);
  if (error || !disp) return null;
  const s = disp.screens.find((x) => x.id && x.id === m.id) || disp.screens.find((x) => x.screen === m.screen && !disp.screens.some((y) => y.id === m.id));
  return s ? block(s) : null;
}

// screens no monitor card covers (no DDC/CI answer, not in the monitors list): a card of their own
export function displayOnlyScreens(monitors) {
  if (!disp) return [];
  const ids = new Set((monitors || []).map((m) => m.id));
  const screens = new Set((monitors || []).map((m) => m.screen));
  return disp.screens.filter((s) => !ids.has(s.id) && !screens.has(s.screen));
}
export const displayBlockFor = (s) => block(s);
// a result about no single screen (Windows refused a request before naming one)
export const displayNote = () => (note && !note.ok && !disp?.screens?.some((s) => note.text?.startsWith(s.name)) ? line(note.text, 'bad') : null);
export const displayError = () => (error ? line(`Display settings not read: ${error}`) : null);
