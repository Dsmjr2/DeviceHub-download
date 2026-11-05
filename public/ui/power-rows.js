// Sleep after and Screen off after (2-3 Nov 2026; helpers/sleep-timer.js, GET / POST /api/sleep): the active power plan's
// timeouts, plugged in and (with a battery) on battery, each a dropdown, backed up, read back, with Undo. On the Laptop
// page's Power card, and on a PC without a battery on the PC page (3 Nov 2026: "Sleep after on desktops too").
import { h } from './dom.js';
import { card, row, button } from './controls.js';
import { dropdown } from './dropdown.js';
import { isDemo } from '../core/devices.js';

const DEMO = { ok: true, ac: 1800, dc: 600, screenAc: 600, screenDc: 300, battery: true, choices: [60, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 7200, 10800, 18000, 0], undo: null };
const NAMES = { ac: ['Sleep after', 'plugged in'], dc: ['Sleep after', 'on battery'], screenAc: ['Screen off after', 'plugged in'], screenDc: ['Screen off after', 'on battery'] };
const st = { sleep: null, at: 0, busy: false, note: null, waiting: null };

export function sleepLabel(s) {
  if (s === 0) return 'Never';
  if (s % 3600 === 0) return s === 3600 ? '1 hour' : `${s / 3600} hours`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

export async function loadPower(redraw) {
  if (isDemo()) { st.sleep = st.sleep || structuredClone(DEMO); return; }
  if (st.busy) return;
  if (st.waiting) { if (redraw) st.waiting.add(redraw); return st.p; }
  st.waiting = new Set(redraw ? [redraw] : []);
  st.p = (async () => { try { const j = await (await fetch('/api/sleep')).json(); if (j?.ok) st.sleep = j; } catch {} st.at = Date.now(); })();
  await st.p;
  const all = st.waiting; st.waiting = null;
  for (const r of all) r();
}
export const powerState = () => st.sleep;

// one change at a time; the rows show what Windows reads afterwards
async function setPower(which, value, redraw, undo = false) {
  if (st.busy || (!undo && st.sleep?.[which] === value)) return;
  st.busy = true; st.note = 'Changing…'; redraw();
  if (isDemo()) {
    const was = st.sleep[which];
    Object.assign(st.sleep, { [which]: value, undo: undo ? null : { which, value: was } });
    st.busy = false; st.note = 'Demo: Windows is not changed.'; redraw(); return;
  }
  try {
    const r = await fetch(undo ? '/api/sleep/undo' : '/api/sleep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undo ? {} : { which, value }) });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.why || r.statusText);
    st.sleep = j; st.note = null;
  } catch (e) { st.note = `Not changed: ${e.message}`; }
  st.busy = false;
  redraw();
}

function pick(which, title, desc, redraw) {
  const s = st.sleep, cur = s[which];
  if (cur == null) return null;
  const options = s.choices.map((v) => ({ value: v, label: sleepLabel(v) }));
  if (!s.choices.includes(cur)) options.unshift({ value: cur, label: sleepLabel(cur) });
  return row(title, desc, dropdown({ options, value: cur, label: title, disabled: st.busy, style: { minWidth: '130px' }, onChange: (v) => setPower(which, Number(v), redraw) }));
}

// in step with Windows' own panel both ways (3 Nov 2026, Shawn: "device hub needs both of these"): read again when the
// window comes back to the front and every 10 s while the rows are on screen, so a change made in Windows shows here
let shown = null;
function follow(redraw) {
  shown = redraw;
  if (follow.on) return;
  follow.on = true;
  const again = () => { if (shown && document.querySelector('[data-power-rows]') && !document.hidden && !st.busy && Date.now() - st.at > 2000) loadPower(shown); };
  addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
  setInterval(() => { if (Date.now() - st.at > 10000) again(); }, 5000);
}
function select(which, label, redraw) {
  const s = st.sleep, cur = s[which];
  if (cur == null) return h('span', { class: 'faint' }, '—');
  const options = s.choices.map((v) => ({ value: v, label: sleepLabel(v) }));
  if (!s.choices.includes(cur)) options.unshift({ value: cur, label: sleepLabel(cur) });
  return dropdown({ options, value: cur, label, disabled: st.busy, onChange: (v) => setPower(which, Number(v), redraw) });
}
// a laptop: Windows' "Change settings for the plan" as a 2x2 grid, On battery and Plugged in, its own words
function grid(redraw) {
  const s = st.sleep;
  const line = (title, dc, ac) => [h('div', { class: 'pg-name' }, title), select(dc, `${title}, on battery`, redraw), select(ac, `${title}, plugged in`, redraw)];
  return h('div', { class: 'srow stack' },
    h('div', { class: 'srow-text' }, h('div', { class: 'srow-title' }, 'Screen and sleep'),
      h('div', { class: 'srow-desc' }, s.modernStandby
        ? 'The same as Windows\' plan settings. On this laptop the display turning off puts it into standby, even with sleep on Never: to keep it awake, set Turn off the display to Never too.'
        : 'The same as Windows\' plan settings.')),
    h('div', { class: 'power-grid', role: 'group', 'aria-label': 'Screen and sleep' },
      h('span'), h('div', { class: 'pg-head' }, 'On battery'), h('div', { class: 'pg-head' }, 'Plugged in'),
      ...line('Turn off the display', 'screenDc', 'screenAc'),
      ...line('Put the computer to sleep', 'dc', 'ac')));
}

// the rows: plugged in always; on battery only with one (a desktop has no "on battery")
export function powerRows(redraw) {
  if (!st.sleep) { if (Date.now() - st.at > 3000) loadPower(redraw); return []; }
  follow(redraw);
  const s = st.sleep, bat = s.battery;
  return [
    h('div', { 'data-power-rows': '', hidden: true }),
    bat ? grid(redraw) : null,
    bat ? null : pick('ac', 'Sleep after', 'How long the PC waits, unused, before it sleeps.', redraw),
    bat ? null : pick('screenAc', 'Screen off after', 'The screen goes dark sooner; the PC keeps running.', redraw),
    s.undo ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0 0' } },
      h('span', { class: 'faint' }, `${NAMES[s.undo.which]?.[0] || 'It'} was ${sleepLabel(s.undo.value)}${bat ? ` ${NAMES[s.undo.which]?.[1]}` : ''}.`),
      button('Undo', () => setPower(s.undo.which, s.undo.value, redraw, true), { kind: 'ghost small', disabled: st.busy })) : null,
    st.note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, st.note) : null,
  ].filter(Boolean);
}

// the PC page's card, on a PC without a battery (a laptop has these on its Laptop page)
export function powerCard(redraw) {
  if (!st.sleep) { if (Date.now() - st.at > 3000) loadPower(redraw); return null; }
  if (st.sleep.battery) return null;
  return card([h('h2', {}, 'Sleep and screen')], ...powerRows(redraw));
}
