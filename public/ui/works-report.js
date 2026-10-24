// "Works on my device" (22 Oct 2026; helpers/works-report.mjs, docs/handoff/works-reports.md): on a library driver's
// page, once its settings passed DeviceHub's self-check here. One click builds the small record (nothing personal in it)
// and shows it in full; only "Open on GitHub" opens a filled-in issue in the default browser, through Get help's own open
// path. The person presses Submit there; DeviceHub sends nothing. Everything shows in place: no pop-ups, notifications or
// tooltips. The state is kept per device, so a page redraw does not lose it.
import { h } from './dom.js';
import { button } from './controls.js';
import { isDemo } from '../core/devices.js';

const state = {};   // device id -> { stage: 'closed'|'loading'|'shown'|'opened'|'error', r, msg }

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// may the page offer it? A library driver (not one made with Learn a device), its settings turned on, connected, and at
// least one setting that passed its check (not read-only). The server checks everything again.
export function offersWorks(d) {
  const lib = d?.adapter?.library;
  if (!lib || lib.learned || lib.turnOn || d.status !== 'connected') return false;
  return (d.adapter.settings || []).some((s) => s.type !== 'display' && !s.readOnly);
}

// invite: the person just turned its settings on and they passed: say so and ask, instead of the quiet one-line button
export function worksReport(d, { invite = false } = {}) {
  const id = d.id;
  const box = h('div', { class: 'works-report', style: { marginTop: '10px', textAlign: 'left' } });
  const s = state[id] || (state[id] = { stage: 'closed' });
  const set = (x) => { Object.assign(s, x); draw(); };
  const start = async () => {
    if (isDemo()) return set({ stage: 'error', msg: 'Not in demo mode.' });
    set({ stage: 'loading', r: null, msg: '' });
    try {
      const r = await getJson(`/api/help/works?id=${encodeURIComponent(id)}`);
      set(r.ok ? { stage: 'shown', r } : { stage: 'error', msg: r.why || 'It could not be made.' });
    } catch (e) { set({ stage: 'error', msg: `It could not be made: ${e.message}` }); }
  };
  const openIt = async () => {
    try {
      const j = await getJson('/api/help/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: s.r.token }) });
      if (!j.ok) throw new Error(j.error || 'not opened');
      set({ stage: 'opened', msg: '' });
    } catch (e) { set({ msg: `GitHub did not open: ${e.message}` }); }
  };
  const close = () => set({ stage: 'closed', r: null, msg: '' });
  const small = (t) => h('small', { class: 'faint', style: { display: 'block', marginTop: '6px' } }, t);
  const row = (...kids) => h('div', { class: 'actions', style: { margin: '6px 0 0', justifyContent: 'flex-start', alignItems: 'center' } }, ...kids);
  function draw() {
    if (s.stage === 'closed' && invite) {
      return box.replaceChildren(h('div', { class: 'works-invite' },
        h('p', {}, h('b', {}, 'It works. '), 'Share it so others need no setup.'),
        row(button('Tell others', start, { kind: 'primary small', ic: 'external' }))));
    }
    if (s.stage === 'closed') {
      return box.replaceChildren(row(button('Works on my device', start, { kind: 'ghost small', ic: 'external' }),
        null));
    }
    if (s.stage === 'loading') return box.replaceChildren(small('Making the record…'));
    if (s.stage === 'error') return box.replaceChildren(small(s.msg), row(button('Try again', start, { kind: 'ghost small' }), button('Close', close, { kind: 'ghost small' })));
    const r = s.r;
    const parts = [
      h('b', {}, 'Goes to GitHub'),
      small('Nothing personal. Needs a free GitHub account.'),
      h('pre', { class: 'json', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '220px', marginTop: '8px' } }, JSON.stringify(r.record, null, 2)),
    ];
    if (s.stage === 'opened') parts.push(small('Press Submit on GitHub.'), small(h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Not open? Use this link.')));
    if (s.msg) parts.push(small(s.msg));
    parts.push(row(s.stage !== 'opened' ? button('Open on GitHub', openIt, { kind: 'small', ic: 'external' }) : null, button('Close', close, { kind: 'ghost small' })));
    box.replaceChildren(...parts);
  }
  draw();
  return box;
}
