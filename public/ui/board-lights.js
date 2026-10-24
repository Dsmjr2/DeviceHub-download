// The Add board, fan and RAM lights control (22 Oct 2026, Shawn: "I want the app to be able to set it up"), on
// Lighting > PC lights, the Fans page's Fan lights card and the Setup page (helpers/board-lights.mjs does the work).
// In place, no pop-ups or notifications: the one plain line before the click, the one button, the step while it runs,
// then the plain result line. When set up: Remove board lights, confirmed in place.
//   boardLights({ redraw, onDone }) -> an element; its state is kept across page redraws
//   boardLightsStatus(fresh) -> GET /api/board-lights (cached; demo mode has a pretend one)
import { h } from './dom.js';
import { button } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { boardView, DEMO_BOARD } from '../core/board-lights.js';

const s = { status: null, at: 0, loading: null, failed: 0, job: null, confirm: false, demoSetUp: true };   // demo: a PC whose board lights are set up (pc-lights.js DEMO_ORGB shows its board and RAM)
const FOLLOW_MS = 15 * 60 * 1000;   // PawnIO's installer waits for the person's clicks

export function boardLightsStatus(fresh = false) {
  if (isDemo()) return Promise.resolve({ ...DEMO_BOARD, setUp: s.demoSetUp });
  if (!fresh && s.status && Date.now() - s.at < 20000) return Promise.resolve(s.status);
  if (!s.loading) s.loading = env.api(`/api/board-lights${fresh ? '?fresh=1' : ''}`).then((st) => { s.status = st; s.at = Date.now(); s.failed = 0; return st; }, () => { s.failed = Date.now(); return null; }).finally(() => { s.loading = null; });
  return s.loading;
}
export const cachedBoard = () => (isDemo() ? { ...DEMO_BOARD, setUp: s.demoSetUp } : s.status);

// the job, followed every 1.5 s only while it runs (started by the click)
async function follow(redraw) {
  const until = Date.now() + FOLLOW_MS;
  let errors = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (Date.now() > until) return { done: true, ok: false, text: 'Stopped waiting after 15 minutes. Press Find lights to see if it finished.' };
    let p;
    try { p = await env.api('/api/board-lights/progress'); errors = 0; } catch (e) { if (++errors >= 5) return { done: true, ok: false, text: `DeviceHub did not answer (${e.message}).` }; continue; }
    if (p.done) return p;
    if (p.text !== s.job?.text || p.pct !== s.job?.pct) { s.job = p; redraw(); }
  }
}
async function run(kind, redraw, onDone) {
  s.confirm = false;
  if (isDemo()) {
    s.demoSetUp = kind === 'setup';
    s.job = { done: true, ok: true, text: `Demo mode: ${kind === 'setup' ? 'in the app this sets up board lights behind one Windows prompt' : 'in the app this removes board lights behind one Windows prompt'}. Nothing was changed.` };
    redraw(); return;
  }
  s.job = { done: false, text: 'Starting', pct: null };
  redraw();
  let r;
  try { await env.api(`/api/board-lights/${kind}`, {}); r = await follow(redraw); }
  catch (e) {
    // already running (started before this window was opened or reloaded): follow it instead of calling it a failure
    r = /being set up or removed/.test(e.message) ? await follow(redraw) : { done: true, ok: false, text: `${kind === 'setup' ? 'Not set up' : 'Not removed'}: ${e.message}` };
  }
  s.job = r;
  await boardLightsStatus(true);
  redraw();
  onDone?.(r);
}

// a setup or removal still running on the server when this window opened (23 Oct 2026, a friend's PC: the window was
// reopened mid-setup, the button came back, and pressing it said "Not set up: board lights are being set up or removed")
let resumed = false;
function resume(redraw, onDone) {
  if (resumed || isDemo()) return;
  resumed = true;
  env.api('/api/board-lights/progress').then(async (p) => {
    if (!p || p.done || !p.text || s.job) return;
    s.job = p; redraw();
    const r = await follow(redraw);
    s.job = r; await boardLightsStatus(true); redraw(); onDone?.(r);
  }, () => {});
}

export function boardLights({ redraw = () => {}, onDone } = {}) {
  resume(redraw, onDone);
  const st = cachedBoard();
  // read once; an answer that failed (an older DeviceHub still running) is tried again only after 30 s
  if (!st && !s.loading && Date.now() - s.failed > 30000) boardLightsStatus().then(() => redraw());
  const v = !st && s.failed && !s.job ? { line: 'Board lights could not be read. Restart DeviceHub (tray icon > Quit) and look again.', action: null }
    : boardView(st, s.job, { confirmRemove: s.confirm });
  const btn = (action, label) => {
    if (action === 'setup') return button(label, () => run('setup', redraw, onDone), { kind: 'primary small', ic: 'plus' });
    if (action === 'ask-remove') return button(label, () => { s.confirm = true; s.job = null; redraw(); }, { kind: 'ghost small' });
    if (action === 'remove') return button(label, () => run('remove', redraw, onDone), { kind: 'primary small' });
    return null;
  };
  return h('div', { class: 'board-lights' },
    // Windows' permission box open: the line says where to find it, in plain sight (helpers/uac.mjs UAC_LINE)
    v.uac ? h('div', { class: 'uac-wait', role: 'status' }, v.line) : h('small', { class: 'faint' }, v.line),
    v.result ? h('div', { class: `gh-note ${v.result.ok ? 'good' : 'bad'}` }, v.result.text) : null,
    v.busy ? null : h('div', { class: 'actions' }, btn(v.action, v.label), v.also ? btn(v.also, 'Remove board lights') : null,
      v.action === 'remove' ? button('Cancel', () => { s.confirm = false; redraw(); }, { kind: 'ghost small' }) : null));
}
