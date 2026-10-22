// "Get help" (22 Oct 2026; helpers/get-help.mjs, docs/handoff/get-help.md): one click builds a short report about the
// device, shows it here in full with what was taken out, and only on "Open on GitHub" does GitHub open in the default
// browser with it filled in. The person presses Submit there; DeviceHub sends nothing. Everything shows in place: no
// pop-ups, notifications or tooltips. The state is kept per key, so a page redraw does not lose an open report.
import { h } from './dom.js';
import { button } from './controls.js';
import { isDemo } from '../core/devices.js';

const state = {};   // key -> { stage: 'closed'|'loading'|'shown'|'opened'|'error', r, msg }

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.body) throw new Error(j.error || r.statusText);
  return j;
}

// key: where it is shown ('health', or a device id); deviceId(): the device to report on ('' = DeviceHub in general)
export function getHelp(key, deviceId = () => key, { label = 'Get help' } = {}) {
  const box = h('div', { class: 'get-help', style: { marginTop: '10px', textAlign: 'left' } });
  const s = state[key] || (state[key] = { stage: 'closed' });
  const set = (x) => { Object.assign(s, x); draw(); };
  const start = async () => {
    if (isDemo()) return set({ stage: 'error', msg: 'Get help works in the installed app, not in demo mode.' });
    set({ stage: 'loading', r: null, msg: '' });
    try { set({ stage: 'shown', r: await getJson(`/api/help/report?id=${encodeURIComponent(deviceId() || '')}`) }); }
    catch (e) { set({ stage: 'error', msg: `Could not build the report: ${e.message}` }); }
  };
  const openIt = async () => {
    try {
      const j = await getJson('/api/help/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: s.r.token }) });
      if (!j.ok) throw new Error(j.error || 'not opened');
      set({ stage: 'opened', msg: '' });
    } catch (e) { set({ msg: `GitHub did not open: ${e.message}` }); }
  };
  const close = () => set({ stage: 'closed', r: null, msg: '' });
  const small = (t, extra = {}) => h('small', { style: { display: 'block', marginTop: '6px' }, ...extra }, t);
  function draw() {
    if (s.stage === 'closed') return box.replaceChildren(button(label, start, { kind: 'ghost small', ic: 'external' }));
    if (s.stage === 'loading') return box.replaceChildren(small('Building the report. This can take up to a minute…'));
    if (s.stage === 'error') return box.replaceChildren(small(s.msg), h('div', { class: 'actions', style: { margin: '6px 0 0', justifyContent: 'flex-start' } }, button('Try again', start, { kind: 'ghost small' }), button('Close', close, { kind: 'ghost small' })));
    const r = s.r;
    const removed = r.removed?.length ? `Taken out first so nothing personal goes on GitHub: ${r.removed.map((x) => `${x.why} (${x.count})`).join(', ')}.` : 'Nothing personal was found in it.';
    const fit = r.logLeftOut ? ` ${r.logLeftOut} older log line${r.logLeftOut === 1 ? ' was' : 's were'} left out to fit GitHub's link limit.` : '';
    const parts = [
      h('b', {}, r.ok ? 'This is the report that goes on GitHub' : 'This report cannot go on GitHub'),
      small(r.ok ? 'Read it first. Nothing is sent until you press Submit on GitHub. You need a free GitHub account.' : 'Something in it still looks personal, so DeviceHub will not open it. Nothing was sent.'),
      h('pre', { class: 'json', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', marginTop: '8px' } }, `${r.title}\n\n${r.body}`),
      small(removed + fit),
      r.ok ? null : small(`Still personal: ${r.refused.map((x) => (x.line ? `line ${x.line + 2}` : 'the title') + `, ${x.why}`).join('; ')}.`),
    ];
    if (s.stage === 'opened') {
      parts.push(small('GitHub opened in your browser. Add what you were doing at the top, then press Submit.'),
        small(h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'If it did not open, use this link')));
    }
    if (s.msg) parts.push(small(s.msg));
    parts.push(h('div', { class: 'actions', style: { margin: '8px 0 0', justifyContent: 'flex-start' } },
      r.ok && s.stage !== 'opened' ? button('Open on GitHub', openIt, { kind: 'small', ic: 'external' }) : null,
      button('Build it again', start, { kind: 'ghost small', ic: 'refresh' }),
      button('Close', close, { kind: 'ghost small' })));
    box.replaceChildren(...parts);
  }
  draw();
  return box;
}
