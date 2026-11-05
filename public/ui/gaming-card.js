// Gaming mode, one switch on the PC page (3 Nov 2026; helpers/gaming-mode.mjs, /api/gaming-mode): Best performance,
// sleep never, Wi-Fi scans paused (if set up), instant replay on; Off puts each back. What it did is listed under it.
import { h } from './dom.js';
import { card, row, toggle } from './controls.js';
import { isDemo } from '../core/devices.js';

const DEMO = { ok: true, on: false, auto: false, steps: [], last: null };
let st = null, stAt = 0, waiting = null, note = null, busy = false;

async function load(redraw) {
  if (waiting) { waiting.add(redraw); return; }
  waiting = new Set([redraw]);
  try { st = await (await fetch('/api/gaming-mode')).json(); } catch { st = { ok: false, why: 'DeviceHub did not answer' }; }
  stAt = Date.now();
  const all = waiting; waiting = null;
  for (const r of all) r();
}
// "Turn on by itself while a game runs" (3 Nov 2026): the same game check as instant replay
async function setAuto(auto, redraw) {
  if (isDemo()) { st.auto = auto; note = 'Demo: Windows is not changed.'; redraw(); return; }
  try {
    const r = await fetch('/api/gaming-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto }) });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.why || r.statusText);
    st = j; note = null;
  } catch (e) { note = e.message; }
  redraw();
}
async function setOn(on, redraw) {
  if (busy) return;
  busy = true; note = on ? 'Turning on…' : 'Putting everything back…'; redraw();
  if (isDemo()) {
    st = on ? { ok: true, on: true, steps: [{ ok: true, text: 'Power mode: balanced → Best performance' }, { ok: true, text: 'Sleep after (plugged in) → Never' }, { ok: true, text: 'Wi-Fi scans paused' }, { ok: true, text: 'Instant replay on' }] }
      : { ok: true, on: false, steps: [], last: [{ ok: true, text: 'Everything back as it was' }] };
    busy = false; note = 'Demo: Windows is not changed.'; redraw(); return;
  }
  try {
    const r = await fetch('/api/gaming-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.why || r.statusText);
    st = j; note = null;
  } catch (e) { note = e.message; }
  busy = false; stAt = Date.now();
  redraw();
}

const line = (x) => h('div', { class: 'faint', style: { display: 'flex', gap: '8px', margin: '4px 0 0' } }, h('span', { style: { color: x.ok ? 'var(--good, #6c6)' : 'var(--warn, #e0a040)' } }, x.ok ? '✓' : '!'), h('span', {}, x.text));

export function gamingCard(redraw) {
  if (isDemo()) st = st || structuredClone(DEMO);
  else if (!st || (Date.now() - stAt > 10000 && !busy)) load(redraw);
  const head = [h('h2', {}, 'Gaming mode')];
  if (!st) return card(head, h('p', { class: 'faint' }, 'Reading…'));
  if (!st.ok) return card(head, h('p', { class: 'faint' }, `Not read: ${st.why}`));
  return card(head,
    row('Gaming mode', 'Best performance, no sleep, Wi-Fi scans paused and instant replay on, in one click. Off puts each back as it was.',
      toggle({ value: st.on, label: 'Gaming mode', disabled: busy, onCommit: (v) => setOn(v, redraw) })),
    row('While a game runs', 'Turns itself on when a game starts, and off 20 s after it ends. One you turn on yourself stays on.',
      toggle({ value: !!st.auto, label: 'Gaming mode while a game runs', onCommit: (v) => setAuto(v, redraw) })),
    st.on && st.byGame ? h('p', { class: 'faint', style: { margin: '2px 0 4px' } }, `On because ${st.byGame} is running.`) : null,
    ...(st.on ? st.steps || [] : st.last || []).map(line),
    note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, note) : null);
}
