// Laptop page (29 Oct 2026, Shawn: what someone setting up is missing; a friend's Lenovo Legion Gen 10). Shown in the
// sidebar only on a PC with a battery (app.js). Reads helpers/laptop.ps1 through GET /api/laptop when the page opens and
// every 60 s while it shows:
//   Battery: charge, on the charger, time left, health (how much of its new charge it still holds) and charge cycles
//   Power mode: Windows' own switch (Settings > System > Power), changed on the person's click (POST /api/laptop/mode)
//     and read back
//   Sleep after (2 Nov 2026, Shawn: "make a dropdown field on the power plan where it decides when my pc sleeps so I can
//     change it quickly"): the active plan's sleep timeout, plugged in and on battery (GET / POST /api/sleep,
//     helpers/sleep-timer.js), backed up, read back, with Undo
//   Lenovo Legion: its own power mode (Fn+Q), read only (no Legion here to test a change on), and its keyboard lights
//     (the device library's lenovo-legion-spectrum driver)
// Everything shows in place: no pop-ups.
import { h, icon } from '../ui/dom.js';
import { card, row, segmented, button } from '../ui/controls.js';
import { powerRows, loadPower, sleepLabel } from '../ui/power-rows.js';
import { acerCard } from '../ui/acer-card.js';
import { batteryChart } from '../ui/battery-chart.js';
export { sleepLabel };
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

// sleep and screen-off timeouts: ui/power-rows.js (shared with the PC page on a PC without a battery, 3 Nov 2026)
async function load() {
  if (isDemo()) { st.info = st.info || structuredClone(DEMO); await loadPower(); st.at = Date.now(); rerender(); return; }
  await loadPower();
  try {
    const r = await fetch('/api/laptop');
    const j = await r.json();
    if (j?.ok) { st.info = j; st.error = null; } else if (r.status !== 409) st.error = j?.why || 'no answer';
  } catch (e) { st.error = e.message; }
  st.at = Date.now();
  if (!st.info && !st.error) setTimeout(() => { if (location.hash === '#/laptop' && !st.info) load(); else st.loading = false; }, 3000);
  else st.loading = false;
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

// what the battery is doing, in a word, and the time to full or empty from its own watts (3 Nov 2026: the card showed
// "Health —" and nothing else on an Acer; a row with nothing to say is left out)
export function batteryNow(b) {
  if (!b) return null;
  const full = b.percent >= 99 || (b.fullMWh && b.nowMWh && b.nowMWh >= b.fullMWh * 0.99);
  const state = b.charger ? (b.chargeW ? 'charging' : full ? 'full' : 'plugged in, not charging') : 'on battery';
  const toFull = b.charger && b.chargeW && b.fullMWh && b.nowMWh < b.fullMWh ? Math.round(((b.fullMWh - b.nowMWh) / 1000 / b.chargeW) * 60) : null;
  const left = !b.charger ? b.minutesLeft || (b.dischargeW && b.nowMWh ? Math.round((b.nowMWh / 1000 / b.dischargeW) * 60) : null) : null;
  const watts = b.charger ? (b.chargeW ? `${b.chargeW} W in` : null) : b.dischargeW ? `${b.dischargeW} W` : null;
  return { state, toFull, left, watts };
}
function batteryCard(b) {
  if (!b) return card([h('h2', {}, 'Battery')], h('p', { class: 'faint', style: { margin: 0 } }, 'No battery reported.'));
  const n = batteryNow(b);
  // what it is doing goes in the Charge row, not beside the title (3 Nov 2026, Shawn: no labels around titles)
  const now = n.state[0].toUpperCase() + n.state.slice(1) + '.';
  return card([h('h2', {}, 'Battery')],
    row('Charge', b.fullMWh ? `${now} Holds ${(b.fullMWh / 1000).toFixed(1)} Wh when full.` : now, h('b', {}, b.percent != null ? `${b.percent}%` : '—')),
    n.toFull != null ? row('Full in', 'At the speed it charges now.', h('b', {}, hours(n.toFull))) : null,
    n.left != null ? row('Time left', 'At what the laptop uses now.', h('b', {}, hours(n.left))) : null,
    n.watts ? row(b.charger ? 'Charging at' : 'Using', null, h('b', {}, n.watts)) : null,
    b.health != null ? row('Health', healthLine(b), h('b', {}, `${b.health}%`)) : null);
}

function powerCard(info) {
  return card([h('h2', {}, 'Power')],
    // the three-way switch under its words, full width (3 Nov 2026: beside them it squeezed the words into a column)
    Object.assign(row('Windows power mode', 'Settings > System > Power. Best performance is faster and warmer.',
      segmented({ value: info.powerMode, options: MODES, disabled: st.busy || !['efficiency', 'balanced', 'performance'].includes(info.powerMode), onCommit: setMode })), { className: 'srow stack' }),
    info.powerMode === 'other' ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, 'Your laptop maker has set its own power mode, so this switch is not available.') : null,
    st.note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, st.note) : null,
    ...powerRows(rerender));
}

function legionCard(info) {
  if (!info.legion && !/lenovo/i.test(info.maker || '')) return null;
  const lights = Object.values(devices).find((d) => d.adapter?.id === 'lenovo-legion-spectrum');
  return card([h('h2', {}, 'Lenovo')],
    info.legion ? row('Lenovo power mode', 'Press Fn+Q to change it. DeviceHub reads it only.', h('b', {}, info.legion.name || '—')) : null,
    row('Keyboard lights', lights ? 'Brightness, the logo light and the lighting profile.' : 'DeviceHub has a driver for Legion Gen 10 keyboard lights. Install it from Setup.',
      lights ? button('Open', () => { location.hash = `#/${lights.id}`; }, { kind: 'ghost small' }) : button('Setup', () => { location.hash = '#/setup'; }, { kind: 'ghost small' })));
}

// the title: the model, its maker in front when the model does not already say it ("Acer Nitro ANV15-41"); a version
// number is never a model (3 Nov 2026: the title read "V1.52" with an "Acer" chip beside it)
export function laptopTitle(info) {
  const model = info?.model && !/^(Default string|To be filled.*|[Vv]?\d+(\.\d+)+)$/i.test(info.model) ? info.model.trim() : null;
  let maker = info?.maker && !/^(Default string|To be filled|System manufacturer)/i.test(info.maker) ? info.maker.trim() : null;
  if (maker && /^[A-Z]{4,}$/.test(maker)) maker = maker[0] + maker.slice(1).toLowerCase();   // LENOVO -> Lenovo (HP, ASUS stay)
  if (!model) return maker ? `${maker} laptop` : 'Laptop';
  return maker && !model.toLowerCase().startsWith(maker.toLowerCase().split(/\s/)[0]) ? `${maker} ${model}` : model;
}

export default {
  id: 'laptop', title: 'Laptop', icon: 'bolt', accent: 'var(--signal)',
  watches: [],
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/laptop') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!st.info && !st.error && !st.loading) { st.loading = true; queueMicrotask(load); }
    keepFresh();
    const info = st.info;
    const head = topbar(laptopTitle(info));
    if (!info) return h('div', {}, head, h('div', { class: 'panel empty' }, icon('bolt'), h('p', {}, st.error ? `Could not read the laptop: ${st.error}` : 'Reading the laptop…')));
    // the battery over the last day or week (3 Nov 2026): Windows' level every 5 minutes and each plug or unplug
    // (helpers/battery-history.js, id "laptop"); green where it was on the charger
    // the cards under each other with the grid's own gap (9 Nov 2026: they touched, with no space between them)
    return h('div', {}, head, h('div', { class: 'stack laptop-cards' }, h('div', { class: 'grid two top' }, batteryCard(info.battery), powerCard(info)), acerCard({ redraw: rerender }),
      info.battery && !isDemo() ? batteryChart('laptop', rerender, { heading: 'Battery over time', band: 'On the charger' }) : null, legionCard(info)));
  },
};
