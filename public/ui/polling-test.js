// "Test the polling rate" (29 Oct 2026, Shawn's pick): measures how many reports per second really arrive from the
// mouse while the person moves it, and compares that with the rate it is set to (public/core/polling-rate.js). It
// reads mouse movement and writes nothing to the mouse. It stops by itself after 5 seconds of movement. Everything
// shows in place: no pop-ups. Each result goes in DeviceHub's activity log on this PC (Shawn, 29 Oct 2026: "you can
// save results"), so a reading can be looked at later; nothing is sent anywhere.
//
// Two counts (29 Oct 2026, Shawn: at 8K the page read only about 2400 Hz): Windows' own, every report as it arrives
// (POST /api/mouse/rate, helpers/mouse-rate.ps1, raw input on a hidden window), which is the exact one and the number
// shown; and the browser's, which hands the page fewer reports at high rates, shown beside it. In demo mode, or when
// Windows' count fails, the browser's is the only one.
//
// The test lives here, not in the card: the mouse page redraws whenever the mouse reports (its battery, a setting), and
// each redraw makes a new card, which picks the running test up. Leaving the page stops it.
import { h } from './dom.js';
import { button } from './controls.js';
import { rateOf, verdict, roundHz, pickNative, reading, TEST_MS } from '../core/polling-rate.js';
import { log, isDemo } from '../core/devices.js';

const run = { n: 0, stage: 'idle', who: null, vid: null, result: null, native: null, setHz: null, times: [], first: null, timer: null, tick: null, name: null, logged: false };
let view = null;   // the card on the page now: { box, draw, who }

// the browser's own mouse reports: pointerrawupdate hands over each one as it comes (Chrome and Edge on localhost);
// otherwise pointermove with the reports it merged into it
const rawName = () => ('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove');
function onRaw(e) {
  const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const c of list.length ? list : [e]) run.times.push(c.timeStamp);
  if (run.first === null) { run.first = performance.now(); run.timer = setTimeout(() => stop(), TEST_MS); }
}

async function askWindows(n) {
  let r;
  try { const res = await fetch('/api/mouse/rate', { method: 'POST' }); r = await res.json().catch(() => null); } catch (e) { r = { ok: false, why: e.message }; }
  if (run.n !== n) return;   // a newer test started, or the page moved on
  run.native = pickNative(r, run.vid);
  finish();
}

function finish() {
  if (run.stage !== 'done' || run.native === 'waiting' || run.logged) { view?.draw(); return; }
  run.logged = true;
  const { r, exact } = reading(run.result, run.native);
  const v = verdict(r, run.setHz, { exact });
  if (v.kind !== 'short') {
    const browser = exact && run.result?.hz ? `; the browser saw about ${roundHz(run.result.hz)} Hz` : '';
    log(`Polling rate test: about ${roundHz(r.hz)} Hz arrived${run.setHz ? ` (set to ${run.setHz} Hz)` : ''}, ${r.events} reports, ${exact ? "Windows' count" : "the browser's count"}${browser}: ${v.kind === 'match' ? 'matches' : v.kind === 'low' ? 'lower than set' : 'higher than set'}`, 'info', run.who);
  }
  view?.draw();
}

function start(setHz, who, vid) {
  stop(true);
  run.n++;
  Object.assign(run, { stage: 'running', who, vid, setHz, result: null, native: null, times: [], first: null, logged: false, name: rawName() });
  window.addEventListener(run.name, onRaw, { passive: true });
  if (!isDemo()) { run.native = 'waiting'; askWindows(run.n); }
  run.tick = setInterval(() => {
    if (!view?.box.isConnected || view.who !== run.who) { run.n++; return stop(true); }   // the page moved on: stop listening
    view.draw();
  }, 250);
  view?.draw();
}
function stop(quiet = false) {
  clearTimeout(run.timer); clearInterval(run.tick); run.timer = run.tick = null;
  if (run.name) window.removeEventListener(run.name, onRaw);
  run.name = null;
  if (quiet === true) { if (run.stage === 'running') run.stage = 'idle'; return; }
  Object.assign(run, { stage: 'done', result: rateOf(run.times), times: [] });
  finish();
}

// setHz: what the mouse is set to (null when unknown); card(title, ...body): the page's card maker; who: the device id,
// so one mouse's result never shows on another mouse's page; vid: its USB vendor id, to find it in Windows' count
export function pollingTest(setHz, card, who = 'mouse', vid = null) {
  const box = h('div', { class: 'polling-test' });
  const p = (text, extra = {}) => h('p', { class: 'faint', style: { margin: '0 0 10px' }, ...extra }, text);
  const draw = () => {
    const mine = run.who === who;
    if (run.stage === 'running' && mine) {
      const left = run.first === null ? null : Math.max(0, TEST_MS - (performance.now() - run.first));
      return box.replaceChildren(p('Move the mouse in circles now. It stops by itself.'),
        h('p', { class: 'polling-meter', 'aria-live': 'polite', style: { margin: '0 0 10px' } }, left === null ? 'Waiting for the mouse to move…' : `${Math.ceil(left / 1000)} s left`),
        h('div', { class: 'actions' }, button('Stop', () => stop(), { kind: 'ghost small' })));
    }
    if (run.stage === 'done' && mine && run.native === 'waiting') return box.replaceChildren(p("Reading Windows' count… keep moving for a moment."));
    if (run.stage === 'done' && run.result && mine) {
      const { r, exact } = reading(run.result, run.native);
      const v = verdict(r, run.setHz, { exact });
      const browser = run.result.hz ? roundHz(run.result.hz) : null;
      return box.replaceChildren(
        h('div', { class: 'stat' }, h('b', {}, v.kind === 'short' ? '—' : `${roundHz(r.hz)} Hz`), h('span', {}, exact ? 'measured by Windows' : 'measured')),
        h('p', { style: { margin: '10px 0' } }, v.line),
        exact && browser ? p(`The browser saw about ${browser} Hz. Browsers pass on fewer reports at high rates, so Windows' count is the exact one.`) : null,
        !exact && run.native?.error ? p(`Windows' exact count was not available (${run.native.error}), so this is the browser's count.`) : null,
        h('div', { class: 'actions' }, button('Test again', () => start(setHz, who, vid), { kind: 'ghost small' })));
    }
    box.replaceChildren(p(`Press Start, then move the mouse in circles for 5 seconds.${setHz ? ` It is set to ${setHz} Hz.` : ''} Nothing on the mouse changes.`),
      h('div', { class: 'actions' }, button('Start', () => start(setHz, who, vid), { kind: 'primary small' })));
  };
  view = { box, draw, who };
  draw();
  return card([h('h2', {}, 'Polling rate test')], box);
}
