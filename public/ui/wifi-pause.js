// The Pause Wi-Fi scans while gaming control, on the PC page's PC check card beside the Wi-Fi line (26 Oct 2026;
// helpers/wifi-pause.mjs does the work, public/core/wifi-pause.js decides what shows). In place, no pop-ups or
// notifications: the state line, the one button, the step while it runs, then the plain result line. Nothing on a cable.
//   wifiPause({ redraw }) -> an element or null; its state is kept across page redraws
import { h } from './dom.js';
import { button, toggle } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { wifiView, DEMO_WIFI, GAMING_LABEL } from '../core/wifi-pause.js';

const s = { status: null, at: 0, loading: null, failed: 0, job: null, confirm: false, demo: { ...DEMO_WIFI }, resuming: false };
const FOLLOW_MS = 5 * 60 * 1000;

export function wifiPauseStatus(fresh = false) {
  if (isDemo()) return Promise.resolve(s.demo);
  if (!fresh && s.status && Date.now() - s.at < 20000) return Promise.resolve(s.status);
  if (!s.loading) s.loading = env.api(`/api/wifi-pause${fresh ? '?fresh=1' : ''}`).then((st) => { s.status = st; s.at = Date.now(); s.failed = 0; return st; }, () => { s.failed = Date.now(); return null; }).finally(() => { s.loading = null; });
  return s.loading;
}
const cached = () => (isDemo() ? s.demo : s.status);

async function follow(redraw) {
  const until = Date.now() + FOLLOW_MS;
  let errors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (Date.now() > until) return { done: true, ok: false, text: 'Timed out. Open the PC page again to check.' };
    let p;
    try { p = await env.api('/api/wifi-pause/progress'); errors = 0; } catch (e) { if (++errors >= 5) return { done: true, ok: false, text: `DeviceHub did not answer (${e.message}).` }; continue; }
    if (p.done) return p;
    if (p.text !== s.job?.text) { s.job = p; redraw(); }
  }
}
async function run(kind, redraw) {
  s.confirm = false;
  if (isDemo()) { s.demo.setUp = kind === 'setup'; s.job = { done: true, ok: true, text: 'Demo: nothing changed.' }; redraw(); return; }
  s.job = { done: false, text: 'Starting' };
  redraw();
  let r;
  try { await env.api(`/api/wifi-pause/${kind}`, {}); r = await follow(redraw); }
  catch (e) { r = /being set up or removed/.test(e.message) ? await follow(redraw) : { done: true, ok: false, text: `${kind === 'setup' ? 'Not set up' : 'Not removed'}: ${e.message}` }; }
  s.job = r;
  await wifiPauseStatus(true);
  redraw();
}
// Resume: the task turns scans on; read again after a moment (the task runs on its own)
async function resumeNow(redraw) {
  if (s.resuming) return;
  if (isDemo()) { s.demo.scans = 'normal'; s.job = { done: true, ok: true, text: 'Demo: nothing changed.' }; redraw(); return; }
  s.resuming = true; redraw();
  try { const r = await env.api('/api/wifi-pause/resume', {}); s.job = { done: true, ok: !!r.ok, text: r.text }; }
  catch (e) { s.job = { done: true, ok: false, text: `Not resumed: ${e.message}.` }; }
  await new Promise((r) => setTimeout(r, 2500));
  s.resuming = false;
  await wifiPauseStatus(true);
  redraw();
}
async function setGaming(on) {
  if (isDemo()) { s.demo.gaming = on; return; }
  await env.api('/api/settings', { wifiPauseGaming: on });
  if (s.status) s.status.gaming = on;
}

export function wifiPause({ redraw = () => {} } = {}) {
  const st = cached();
  if (!st && !s.loading && Date.now() - s.failed > 30000) wifiPauseStatus().then(() => redraw());
  const v = wifiView(st, s.job, { confirmRemove: s.confirm });
  if (!v.show) return null;
  const btn = (action, label) => {
    if (action === 'setup') return button(label, () => run('setup', redraw), { kind: 'primary small' });
    if (action === 'ask-remove') return button(label, () => { s.confirm = true; s.job = null; redraw(); }, { kind: 'ghost small' });
    if (action === 'remove') return button(label, () => run('remove', redraw), { kind: 'primary small' });
    return null;
  };
  return h('div', { class: 'wifi-pause' },
    ...v.lines.map((l) => (v.uac ? h('div', { class: 'uac-wait', role: 'status' }, l) : h('small', { class: 'faint' }, l))),
    v.gaming != null ? h('label', { class: 'wifi-pause-gaming' }, toggle({ value: v.gaming, label: GAMING_LABEL, onCommit: setGaming }), h('small', {}, GAMING_LABEL)) : null,
    v.result ? h('div', { class: `gh-note ${v.result.ok ? 'good' : 'bad'}` }, v.result.text) : null,
    v.busy ? null : h('div', { class: 'actions' },
      v.resume ? button(s.resuming ? 'Resuming' : 'Resume', () => resumeNow(redraw), { kind: 'primary small', disabled: s.resuming }) : null,
      btn(v.action, v.label), v.also ? btn(v.also, 'Remove the Wi-Fi pause') : null,
      v.action === 'remove' ? button('Cancel', () => { s.confirm = false; redraw(); }, { kind: 'ghost small' }) : null));
}
