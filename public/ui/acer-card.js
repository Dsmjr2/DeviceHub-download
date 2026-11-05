// The Laptop page's Acer card (3 Nov 2026, Shawn: "a fan speed controller like the nitro app and max charge while plugged
// in"): set up on a click (one Windows prompt, helpers/acer-control.mjs), then the laptop's own temperatures and fan
// speeds every second while the page shows, the fan mode (Auto / Max) and the battery charge limit, each a click that is
// read back. public/core/acer.js decides what shows. In place, no pop-ups.
//   acerCard({ redraw }) -> a card or null (not an Acer laptop); its state is kept across page redraws
import { h } from './dom.js';
import { card, row, segmented, toggle, button } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { acerView, DEMO_ACER, FAN_MODES } from '../core/acer.js';

const s = { status: null, at: 0, loading: null, failed: 0, job: null, confirm: false, demo: structuredClone(DEMO_ACER), writing: null, note: null, timer: null };
const FOLLOW_MS = 5 * 60 * 1000;

function load(fresh = false) {
  if (isDemo()) return Promise.resolve(s.demo);
  if (!s.loading) s.loading = env.api(`/api/acer${fresh ? '?fresh=1' : ''}`).then((st) => { s.status = st; s.at = Date.now(); s.failed = 0; return st; }, () => { s.failed = Date.now(); return null; }).finally(() => { s.loading = null; });
  return s.loading;
}
// readings every second while the Laptop page shows (the read task stops by itself 20 s after the page closes)
function keepReading(redraw) {
  clearInterval(s.timer);
  s.timer = setInterval(async () => {
    if (location.hash !== '#/laptop') { clearInterval(s.timer); s.timer = null; return; }
    if (document.hidden || isDemo() || !s.status?.setUp || s.job?.done === false) return;
    // only this card is drawn again each second, not the whole page (its battery graph would flicker)
    try { const r = await env.api('/api/acer/read'); s.status = { ...s.status, readings: r.readings }; if (s.el?.isConnected) s.el.replaceWith(acerCard({ redraw })); } catch {}
  }, 1000);
}
async function follow(redraw) {
  const until = Date.now() + FOLLOW_MS;
  let errors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (Date.now() > until) return { done: true, ok: false, text: 'Timed out. Open the Laptop page again to check.' };
    let p;
    try { p = await env.api('/api/acer/progress'); errors = 0; } catch (e) { if (++errors >= 5) return { done: true, ok: false, text: `DeviceHub did not answer (${e.message}).` }; continue; }
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
  try { await env.api(`/api/acer/${kind}`, {}); r = await follow(redraw); }
  catch (e) { r = /being set up or removed/.test(e.message) ? await follow(redraw) : { done: true, ok: false, text: `${kind === 'setup' ? 'Not set up' : 'Not removed'}: ${e.message}` }; }
  s.job = r;
  await load(true);
  redraw();
}
// one write: the script reads first, writes once and reads back; the answer says before and after
async function write(mode, redraw) {
  if (s.writing) return;
  if (isDemo()) {
    const r = s.demo.readings;
    if (mode.startsWith('fans')) r.cpuFanMode = r.gpuFanMode = mode === 'fans-max' ? 'max' : 'auto'; else r.healthMode = mode === 'health-on';
    s.note = { ok: true, text: 'Demo: the laptop is not changed.' }; redraw(); return;
  }
  s.writing = mode; s.note = null; redraw();
  try {
    const r = await env.api('/api/acer/write', { mode });
    s.note = r.ok ? null : { ok: false, text: `Not changed: ${r.why}` };
    if (r.after) s.status = { ...s.status, readings: { ...r.after, fresh: true } };
  } catch (e) { s.note = { ok: false, text: `Not changed: ${e.message}` }; }
  s.writing = null;
  redraw();
}

const deg = (c) => (c == null ? null : `${c} °C`);
const rpm = (n) => (n == null ? null : n === 0 ? 'Stopped' : `${n} RPM`);
export function acerCard({ redraw = () => {} } = {}) {
  const st = isDemo() ? s.demo : s.status;
  if (!st && !s.loading && Date.now() - s.failed > 30000) load().then(() => redraw());
  keepReading(redraw);
  const v = acerView(st, s.job, { confirmRemove: s.confirm });
  if (!v.show) return null;
  const r = v.readings, c = v.controls;
  const btn = (action, label) => {
    if (action === 'setup') return button(label, () => run('setup', redraw), { kind: 'primary small' });
    if (action === 'ask-remove') return button(label, () => { s.confirm = true; s.job = null; redraw(); }, { kind: 'ghost small' });
    if (action === 'remove') return button(label, () => run('remove', redraw), { kind: 'primary small' });
    return null;
  };
  const rows = r ? [
    ['CPU', deg(r.cpuC), rpm(r.cpuFanRpm)], ['Graphics card', deg(r.gpuC), rpm(r.gpuFanRpm)], ['Inside the case', deg(r.systemC), null],
  ].filter(([, t, f]) => t != null || f != null) : [];
  return s.el = card([h('h2', {}, 'Fans and charging')],
    ...rows.map(([name, t, f]) => row(name, f ? `Fan ${f}` : null, h('b', {}, t ?? '—'))),
    c ? row('Fan mode', c.fans === 'max' ? 'Back to Auto when you press Auto, quit DeviceHub, restart, or after 4 hours.' : 'Max runs both fans at full speed. The laptop still protects itself from heat.',
      segmented({ value: c.fans, options: FAN_MODES, disabled: !!s.writing || !c.fans, onCommit: (m) => write(m === 'max' ? 'fans-max' : 'fans-auto', redraw) })) : null,
    c && c.health != null ? row('Charge limit', 'Stops charging at about 80% while plugged in, so the battery lasts longer.',
      toggle({ value: c.health, label: 'Charge limit', disabled: !!s.writing, onCommit: (on) => write(on ? 'health-on' : 'health-off', redraw) })) : null,
    s.writing ? h('small', { class: 'faint' }, 'Changing…') : null,
    s.note ? h('div', { class: `gh-note ${s.note.ok ? 'good' : 'bad'}` }, s.note.text) : null,
    ...v.lines.map((l) => (v.uac ? h('div', { class: 'uac-wait', role: 'status' }, l) : h('p', { class: 'faint', style: { margin: '6px 0 0' } }, l))),
    v.result ? h('div', { class: `gh-note ${v.result.ok ? 'good' : 'bad'}` }, v.result.text) : null,
    v.busy ? null : h('div', { class: 'actions', style: { marginTop: '10px' } }, btn(v.action, v.label),
      v.action === 'remove' ? button('Cancel', () => { s.confirm = false; redraw(); }, { kind: 'ghost small' }) : null));
}
