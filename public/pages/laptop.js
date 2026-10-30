// Laptop page (29 Oct 2026, Shawn: what someone setting up is missing; a friend's Lenovo Legion Gen 10). Shown in the
// sidebar only on a PC with a battery (app.js). Reads helpers/laptop.ps1 through GET /api/laptop when the page opens and
// every 60 s while it shows:
//   Battery: charge, on the charger, time left, health (how much of its new charge it still holds) and charge cycles
//   Power mode: Windows' own switch (Settings > System > Power), changed on the person's click (POST /api/laptop/mode)
//     and read back
//   Lenovo Legion: its own power mode (Fn+Q), read only (no Legion here to test a change on), and its keyboard lights
//     (the device library's lenovo-legion-spectrum driver)
// Everything shows in place: no pop-ups.
import { h, icon } from '../ui/dom.js';
import { card, row, segmented, button, pill } from '../ui/controls.js';
import { devices, isDemo } from '../core/devices.js';
import { topbar } from './common.js';

export const MODES = [
  { value: 'efficiency', label: 'Battery saving' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'performance', label: 'Best performance' },
];
const DEMO = { ok: true, maker: 'LENOVO', model: 'Legion Pro 7 16IAX10H', portable: true, powerMode: 'balanced',
  battery: { percent: 76, charger: false, minutesLeft: 142, designMWh: 99990, fullMWh: 91200, cycles: 87, health: 91 },
  legion: { mode: 2, name: 'Balanced' } };

const st = { info: null, error: null, at: 0, busy: false, note: null };
let rerender = () => {};
let timer = null;

async function load() {
  if (isDemo()) { st.info = st.info || structuredClone(DEMO); st.at = Date.now(); rerender(); return; }
  try {
    const r = await fetch('/api/laptop');
    const j = await r.json();
    if (j?.ok) { st.info = j; st.error = null; } else if (r.status !== 409) st.error = j?.why || 'no answer';
  } catch (e) { st.error = e.message; }
  st.at = Date.now();
  rerender();
}
function keepFresh() {
  clearInterval(timer);
  timer = setInterval(() => { if (location.hash !== '#/laptop') { clearInterval(timer); return; } if (!document.hidden && !st.busy) load(); }, 60000);
}

async function setMode(mode) {
  if (st.busy || st.info?.powerMode === mode) return;
  st.busy = true; st.note = 'Changing…'; rerender();
  if (isDemo()) { st.info.powerMode = mode; st.busy = false; st.note = 'Demo: Windows is not changed.'; rerender(); return; }
  try {
    const r = await fetch('/api/laptop/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.why || r.statusText);
    st.info = j;
    st.note = j.powerMode === mode ? null : `Windows did not change it (it reads ${j.powerMode || 'unknown'}). It works only on the Balanced power plan.`;
  } catch (e) { st.note = `Not changed: ${e.message}`; }
  st.busy = false;
  rerender();
}

const hours = (m) => (m == null ? null : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
export function healthLine(b) {
  if (!b || b.health == null) return 'Windows does not report its health.';
  const age = b.health >= 90 ? 'Like new.' : b.health >= 80 ? 'Normal wear.' : b.health >= 60 ? 'Worn: it runs out sooner than it did.' : 'Very worn: think about a new battery.';
  return `It holds ${b.health}% of the charge it held when new.${b.cycles ? ` ${b.cycles} charge cycles.` : ''} ${age}`;
}

function batteryCard(b) {
  if (!b) return card([h('h2', {}, 'Battery')], h('p', { class: 'faint', style: { margin: 0 } }, 'No battery reported.'));
  return card([h('h2', {}, 'Battery'), pill(b.charger ? 'on the charger' : 'on battery')],
    row('Charge', null, h('b', {}, b.percent != null ? `${b.percent}%` : '—')),
    !b.charger && b.minutesLeft ? row('Time left', 'Windows\' estimate.', h('b', {}, hours(b.minutesLeft))) : null,
    row('Health', healthLine(b), h('b', {}, b.health != null ? `${b.health}%` : '—')));
}

function powerCard(info) {
  return card([h('h2', {}, 'Power mode')],
    row('Windows power mode', 'The same switch as Settings > System > Power. Best performance runs faster and warmer.',
      segmented({ value: info.powerMode, options: MODES, disabled: st.busy || !['efficiency', 'balanced', 'performance'].includes(info.powerMode), onCommit: setMode })),
    info.powerMode === 'other' ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, 'Your laptop maker has set its own power mode, so this switch is not available.') : null,
    st.note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, st.note) : null);
}

function legionCard(info) {
  if (!info.legion && !/lenovo/i.test(info.maker || '')) return null;
  const lights = Object.values(devices).find((d) => d.adapter?.id === 'lenovo-legion-spectrum');
  return card([h('h2', {}, 'Lenovo')],
    info.legion ? row('Lenovo power mode', 'Press Fn+Q to change it. DeviceHub reads it only.', h('b', {}, info.legion.name || '—')) : null,
    row('Keyboard lights', lights ? 'Brightness, the logo light and the lighting profile.' : 'DeviceHub has a driver for Legion Gen 10 keyboard lights. Install it from Setup.',
      lights ? button('Open', () => { location.hash = `#/${lights.id}`; }, { kind: 'ghost small' }) : button('Setup', () => { location.hash = '#/setup'; }, { kind: 'ghost small' })));
}

export default {
  id: 'laptop', title: 'Laptop', icon: 'bolt', accent: 'var(--signal)',
  watches: [],
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/laptop') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!st.info && !st.error && !st.loading) { st.loading = true; queueMicrotask(load); }
    keepFresh();
    const info = st.info;
    const head = topbar('', info?.model && info.model !== 'Default string' ? info.model : 'Laptop', null, info?.maker ? h('div', { class: 'chips' }, pill(info.maker)) : null);
    if (!info) return h('div', {}, head, h('div', { class: 'panel empty' }, icon('bolt'), h('p', {}, st.error ? `Could not read the laptop: ${st.error}` : 'Reading the laptop…')));
    return h('div', {}, head, h('div', { class: 'grid two top' }, batteryCard(info.battery), powerCard(info)), legionCard(info));
  },
};
