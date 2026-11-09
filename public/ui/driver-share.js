// Share learned drivers that work (24 Oct 2026; helpers/driver-share.mjs): the person's one yes, asked once when a Learn
// finishes, and the switch in Settings > Get help. Never shown on the owner's PC or in demo mode.
import { h } from './dom.js';
import { button, toggle } from './controls.js';
import { isDemo } from '../core/devices.js';

let st = null, asked = false, busy = false, said = null;
const load = (redraw) => {
  if (asked) return;
  asked = true;
  if (isDemo()) { st = { choice: null, owner: false, demo: true }; return; }
  fetch('/api/driver-share').then((r) => (r.ok ? r.json() : null)).then((j) => { st = j; redraw(); }).catch(() => {});
};
async function answer(on, redraw) {
  if (busy) return;
  busy = true; redraw();
  if (st?.demo) { st = { ...st, choice: on }; said = on ? 'Thanks: drivers that work will be shared.' : null; busy = false; redraw(); return { choice: on, said }; }
  let a;
  try {
    const x = await fetch('/api/driver-share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
    a = shareAnswer(on, x.ok, await x.json().catch(() => ({})));
  } catch (e) { a = shareAnswer(on, false, { error: e.message }); }
  if (a.choice !== undefined) st = { ...st, choice: a.choice };
  said = a.said;
  busy = false; redraw();
  return a;
}
// what the page says after the answer was sent (9 Nov 2026: a refused or failed save said "Thanks: ..." and hid the
// question, as if saved; a network error said nothing). choice: undefined when it was not saved, so the question stays.
export function shareAnswer(on, ok, r) {
  if (!ok || !r || typeof r.choice !== 'boolean') return { choice: undefined, said: `Not saved: ${r?.error || 'DeviceHub did not answer'}. Try again.` };
  const n = (r.shared || []).filter((x) => x.sent).length;
  return { choice: r.choice, said: on ? (n ? `Thanks: ${n === 1 ? 'one driver was' : `${n} drivers were`} shared.` : 'Thanks: it is shared once its settings pass their check.') : null };
}
// the one-time question (Learn's done screen): nothing once answered
export function shareAsk(redraw) {
  load(redraw);
  if (said && st?.choice !== null) return h('p', { class: 'faint' }, said);
  if (!st || st.owner || st.choice !== null) return null;
  return h('div', { class: 'learn-check', role: 'group', 'aria-label': 'Share drivers that work' },
    h('p', {}, h('b', {}, 'Share it once it works? '), 'Then the next person with this device gets it with nothing to learn. Only the driver goes, never anything personal.'),
    h('div', { class: 'actions' },
      button(busy ? 'Saving…' : 'Share drivers that work', () => answer(true, redraw), { kind: 'primary small', disabled: busy }),
      button('No thanks', () => answer(false, redraw), { kind: 'ghost small', disabled: busy })),
    said ? h('p', { class: 'faint', role: 'status' }, said) : null);
}
// the switch (Settings > Get help)
export function shareSwitch(redraw) {
  load(redraw);
  if (!st || st.owner) return null;
  return h('label', { class: 'ar-toggle' }, h('span', {}, 'Share drivers I learn'),
    toggle({ value: st.choice === true, label: 'Share drivers I learn', onCommit: async (on) => { const a = await answer(on, redraw); if (a && a.choice === undefined) throw new Error(a.said); } }));
}
