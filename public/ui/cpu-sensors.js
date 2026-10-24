// The Add CPU temperature and fan speeds control (24 Oct 2026), on the PC page's Temperatures and fans card
// (helpers/cpu-sensors.mjs does the work). In place, no pop-ups or notifications: the plain lines before the click, the
// one button, the step while it runs, then the plain result line. When set up: Remove, confirmed in place.
//   cpuSensors({ redraw, onDone }) -> an element; its state is kept across page redraws
//   cpuSensorsStatus(fresh) -> GET /api/cpu-sensors (cached; demo mode has a pretend one)
import { h } from './dom.js';
import { button } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { sensorsView, DEMO_SENSORS } from '../core/cpu-sensors.js';

const s = { status: null, at: 0, loading: null, failed: 0, job: null, confirm: false, demoSetUp: false };
const FOLLOW_MS = 15 * 60 * 1000;   // PawnIO's installer waits for the person's clicks

export function cpuSensorsStatus(fresh = false) {
  if (isDemo()) return Promise.resolve({ ...DEMO_SENSORS, setUp: s.demoSetUp });
  if (!fresh && s.status && Date.now() - s.at < 20000) return Promise.resolve(s.status);
  if (!s.loading) s.loading = env.api(`/api/cpu-sensors${fresh ? '?fresh=1' : ''}`).then((st) => { s.status = st; s.at = Date.now(); s.failed = 0; return st; }, () => { s.failed = Date.now(); return null; }).finally(() => { s.loading = null; });
  return s.loading;
}
const cached = () => (isDemo() ? { ...DEMO_SENSORS, setUp: s.demoSetUp } : s.status);

// the job, followed every 1.5 s only while it runs (started by the click)
async function follow(redraw) {
  const until = Date.now() + FOLLOW_MS;
  let errors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (Date.now() > until) return { done: true, ok: false, text: 'Stopped waiting after 15 minutes. Open this page again to see if it finished.' };
    let p;
    try { p = await env.api('/api/cpu-sensors/progress'); errors = 0; } catch (e) { if (++errors >= 5) return { done: true, ok: false, text: `DeviceHub did not answer (${e.message}).` }; continue; }
    if (p.done) return p;
    if (p.text !== s.job?.text || p.pct !== s.job?.pct) { s.job = p; redraw(); }
  }
}
async function run(kind, redraw, onDone) {
  s.confirm = false;
  if (isDemo()) {
    s.demoSetUp = kind === 'setup';
    s.job = { done: true, ok: true, text: `Demo mode: in the app this ${kind === 'setup' ? 'sets it up' : 'removes it'} behind one Windows prompt. Nothing was changed.` };
    redraw(); onDone?.(s.job); return;
  }
  s.job = { done: false, text: 'Starting', pct: null };
  redraw();
  let r;
  try { await env.api(`/api/cpu-sensors/${kind}`, {}); r = await follow(redraw); }
  catch (e) { r = /being set up or removed/.test(e.message) ? await follow(redraw) : { done: true, ok: false, text: `${kind === 'setup' ? 'Not set up' : 'Not removed'}: ${e.message}` }; }
  s.job = r;
  await cpuSensorsStatus(true);
  redraw();
  onDone?.(r);
}
// a setup or removal still running when this window opened: follow it
let resumed = false;
function resume(redraw, onDone) {
  if (resumed || isDemo()) return;
  resumed = true;
  env.api('/api/cpu-sensors/progress').then(async (p) => {
    if (!p || p.done || !p.text || s.job) return;
    s.job = p; redraw();
    const r = await follow(redraw);
    s.job = r; await cpuSensorsStatus(true); redraw(); onDone?.(r);
  }, () => {});
}

export const cpuSensorsSetUp = () => !!cached()?.setUp;

export function cpuSensors({ redraw = () => {}, onDone } = {}) {
  resume(redraw, onDone);
  const st = cached();
  if (!st && !s.loading && Date.now() - s.failed > 30000) cpuSensorsStatus().then(() => redraw());
  const v = !st && s.failed && !s.job ? { lines: ['This could not be read. Restart DeviceHub (tray icon > Quit) and look again.'], action: null } : sensorsView(st, s.job, { confirmRemove: s.confirm });
  const btn = (action, label) => {
    if (action === 'setup') return button(label, () => run('setup', redraw, onDone), { kind: 'primary small', ic: 'plus' });
    if (action === 'ask-remove') return button(label, () => { s.confirm = true; s.job = null; redraw(); }, { kind: 'ghost small' });
    if (action === 'remove') return button(label, () => run('remove', redraw, onDone), { kind: 'primary small' });
    return null;
  };
  return h('div', { class: 'cpu-sensors' },
    v.uac ? h('div', { class: 'uac-wait', role: 'status' }, v.lines[0]) : (v.lines || []).map((l) => h('small', { class: 'faint cpu-line' }, l)),
    v.result ? h('div', { class: `gh-note ${v.result.ok ? 'good' : 'bad'}` }, v.result.text) : null,
    v.busy ? null : h('div', { class: 'actions' }, btn(v.action, v.label), v.also ? btn(v.also, 'Remove') : null,
      v.action === 'remove' ? button('Cancel', () => { s.confirm = false; redraw(); }, { kind: 'ghost small' }) : null));
}
