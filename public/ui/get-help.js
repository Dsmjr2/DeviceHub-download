// "Get help" (22 Oct 2026; helpers/get-help.mjs, docs/handoff/get-help.md): one click builds a short report about the
// device, shows it here in full with what was taken out, and only on "Open on GitHub" does GitHub open in the default
// browser with it filled in. The person presses Submit there; DeviceHub sends nothing. Everything shows in place: no
// pop-ups, notifications or tooltips. The state is kept per key, so a page redraw does not lose an open report.
import { h, icon } from './dom.js';
import { button } from './controls.js';
import { isDemo } from '../core/devices.js';

const state = {};   // key -> { stage: 'closed'|'loading'|'shown'|'opened'|'sent'|'error', r, msg }

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.body) throw new Error(j.error || r.statusText);
  return j;
}

// key: where it is shown ('health', or a device id); deviceId(): the device to report on ('' = DeviceHub in general)
// request: Request support for a device with no driver (helpers/get-help.mjs requestSupport): { vid, pid, name }; the
// same panel, its own words
export function getHelp(key, deviceId = () => key, { label = 'Get help', request = null, kind = 'ghost small' } = {}) {
  const box = h('div', { class: 'get-help', style: { marginTop: '10px', textAlign: 'left' } });
  const s = state[key] || (state[key] = { stage: 'closed' });
  const set = (x) => { Object.assign(s, x); draw(); };
  const start = async () => {
    if (isDemo()) return set({ stage: 'error', msg: `${request ? 'Request support' : 'Get help'} works in the installed app, not in demo mode.` });
    set({ stage: 'loading', r: null, msg: '' });
    // Request support: sent to Shawn in one click through the relay where this copy sends reports
    // (helpers/support-request.mjs); anywhere else (reports off, no relay, the owner's PC) the GitHub request below
    if (request) {
      try {
        const j = await getJson('/api/help/request/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid: request.vid, pid: request.pid, name: request.name || '' }) });
        if (j.line && (j.sent || j.queued)) return set({ stage: 'sent', msg: j.line, good: !!j.sent });
      } catch {}
    }
    const url = request ? `/api/help/request?${new URLSearchParams({ vid: request.vid, pid: request.pid, name: request.name || '' })}` : `/api/help/report?id=${encodeURIComponent(deviceId() || '')}`;
    try { set({ stage: 'shown', r: await getJson(url) }); }
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
  const small = (t, extra = {}) => h('small', { style: { display: 'block' }, ...extra }, t);
  const acts = (...b) => h('div', { class: 'actions gh-acts' }, ...b.filter(Boolean));
  const step = (n, text) => h('li', {}, h('span', { class: 'gh-num' }, String(n)), h('span', {}, text));
  // the report itself, folded away: most people only need to know it is safe; it opens for anyone who wants to read it
  const reportBox = (r) => h('details', { class: 'gh-report' },
    h('summary', {}, 'See exactly what it says'),
    h('pre', { class: 'json' }, `${r.title}\n\n${r.body}`));
  function draw() {
    // sent through the relay: one plain line where the button was
    if (s.stage === 'sent') return box.replaceChildren(h('div', { class: `gh-note ${s.good ? 'good' : ''}` }, s.good ? icon('check') : null, s.msg));
    if (s.stage === 'closed') return box.replaceChildren(button(label, start, { kind, ic: 'external' }));
    if (s.stage === 'loading') return box.replaceChildren(h('div', { class: 'gh-card' }, h('div', { class: 'gh-busy' }, h('span', { class: 'gh-spin' }), 'Building your report… this can take up to a minute.')));
    if (s.stage === 'error') return box.replaceChildren(h('div', { class: 'gh-card' }, h('div', { class: 'gh-note bad' }, s.msg), acts(button('Try again', start, { kind: 'small' }), button('Close', close, { kind: 'ghost small' }))));
    const r = s.r;
    const removed = r.removed?.length ? `Taken out so nothing personal goes on GitHub: ${r.removed.map((x) => `${x.why} (${x.count})`).join(', ')}.` : 'Nothing personal was found in it.';
    const fit = r.logLeftOut ? ` ${r.logLeftOut} older log line${r.logLeftOut === 1 ? ' was' : 's were'} left out to fit GitHub's limit.` : '';
    let parts;
    if (!r.ok) {
      parts = [h('div', { class: 'gh-title bad' }, icon('alert'), 'This report cannot go on GitHub'),
        small('Something in it still looks personal, so DeviceHub will not open it. Nothing was sent.'),
        small(`Still personal: ${r.refused.map((x) => (x.line ? `line ${x.line + 2}` : 'the title') + `, ${x.why}`).join('; ')}.`, { class: 'gh-note bad' }),
        reportBox(r),
        acts(button('Build it again', start, { kind: 'small', ic: 'refresh' }), button('Close', close, { kind: 'ghost small' }))];
    } else if (s.stage === 'opened') {
      parts = [h('div', { class: 'gh-title good' }, icon('check'), 'GitHub is open in your browser'),
        h('ol', { class: 'gh-steps' }, step(1, request ? 'At the top, say which device it is and the settings you would like.' : 'At the top, say what you were doing when it went wrong.'), step(2, 'Press Submit new issue.')),
        small(h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'GitHub did not open? Use this link.')),
        acts(button('Done', close, { kind: 'small' }))];
    } else {
      parts = [h('div', { class: 'gh-title good' }, icon('check'), request ? 'Your request is ready' : 'Your report is ready'),
        h('ol', { class: 'gh-steps' }, step(1, `Press Open on GitHub. The ${request ? 'request' : 'report'} is already filled in.`), step(2, request ? 'Say which settings you would like, then press Submit.' : 'Say what you were doing, then press Submit.')),
        acts(button('Open on GitHub', openIt, { kind: 'primary', ic: 'external' }), button('Cancel', close, { kind: 'ghost small' })),
        s.msg ? small(s.msg, { class: 'gh-note bad' }) : null,
        small(`${removed}${fit} Nothing is sent until you press Submit. You need a free GitHub account.`, { class: 'gh-fine' }),
        reportBox(r)];
    }
    box.replaceChildren(h('div', { class: 'gh-card' }, ...parts.filter(Boolean)));
  }
  draw();
  return box;
}
