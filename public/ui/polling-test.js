// "Test the polling rate" (29 Oct 2026, Shawn's pick): measures how many reports per second really arrive from the
// mouse while the person moves it, and compares that with the rate it is set to (public/core/polling-rate.js). It runs
// in the page only: it reads mouse movement and writes nothing to the mouse. It stops by itself after 5 seconds of
// movement. Everything shows in place: no pop-ups. Each result goes in DeviceHub's activity log on this PC (Shawn,
// 29 Oct 2026: "you can save results"), so a reading can be looked at later; nothing is sent anywhere.
//
// The test lives here, not in the card: the mouse page redraws whenever the mouse reports (its battery, a setting), and
// each redraw makes a new card, which picks the running test up. Leaving the page stops it.
import { h } from './dom.js';
import { button } from './controls.js';
import { rateOf, verdict, roundHz, TEST_MS } from '../core/polling-rate.js';
import { log } from '../core/devices.js';

const run = { stage: 'idle', who: null, result: null, setHz: null, times: [], first: null, timer: null, tick: null, name: null };
let view = null;   // the card on the page now: { box, draw }

// the browser's own mouse reports: pointerrawupdate hands over each one as it comes (Chrome and Edge on localhost);
// otherwise pointermove with the reports it merged into it
const rawName = () => ('onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove');
function onRaw(e) {
  const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  for (const c of list.length ? list : [e]) run.times.push(c.timeStamp);
  if (run.first === null) { run.first = performance.now(); run.timer = setTimeout(() => stop(), TEST_MS); }
}
function start(setHz, who) {
  stop(true);
  Object.assign(run, { stage: 'running', who, setHz, result: null, times: [], first: null, name: rawName() });
  window.addEventListener(run.name, onRaw, { passive: true });
  run.tick = setInterval(() => {
    if (!view?.box.isConnected || view.who !== run.who) return stop(true);   // the page moved on: stop listening
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
  const v = verdict(run.result, run.setHz);
  if (v.kind !== 'short') log(`Polling rate test: about ${roundHz(run.result.hz)} Hz arrived${run.setHz ? ` (set to ${run.setHz} Hz)` : ''}, ${Math.round(run.result.steady * 100)}% steady, ${run.result.events} reports: ${v.kind === 'match' ? 'matches' : v.kind === 'limit' ? 'as high as a browser can count' : v.kind === 'low' ? 'lower than set' : 'higher than set'}`, 'info', run.who);
  view?.draw();
}

// setHz: what the mouse is set to (null when unknown); card(title, ...body): the page's card maker; who: the device id,
// so one mouse's result never shows on another mouse's page
export function pollingTest(setHz, card, who = 'mouse') {
  const box = h('div', { class: 'polling-test' });
  const p = (text, extra = {}) => h('p', { class: 'faint', style: { margin: '0 0 10px' }, ...extra }, text);
  const draw = () => {
    const mine = run.who === who;
    if (run.stage === 'running' && mine) {
      const left = run.first === null ? null : Math.max(0, TEST_MS - (performance.now() - run.first));
      return box.replaceChildren(p('Move the mouse in circles now. It stops by itself.'),
        h('p', { class: 'polling-meter', 'aria-live': 'polite', style: { margin: '0 0 10px' } }, left === null ? 'Waiting for the mouse to move…' : `${Math.ceil(left / 1000)} s left · about ${roundHz(rateOf(run.times).hz)} Hz so far`),
        h('div', { class: 'actions' }, button('Stop', () => stop(), { kind: 'ghost small' })));
    }
    if (run.stage === 'done' && run.result && mine) {
      const v = verdict(run.result, run.setHz);
      return box.replaceChildren(
        h('div', { class: 'stat' }, h('b', {}, v.kind === 'short' ? '—' : `${roundHz(run.result.hz)} Hz`), h('span', {}, 'measured')),
        h('p', { style: { margin: '10px 0' } }, v.line),
        h('div', { class: 'actions' }, button('Test again', () => start(setHz, who), { kind: 'ghost small' })));
    }
    box.replaceChildren(p(`Press Start, then move the mouse in circles for 5 seconds.${setHz ? ` It is set to ${setHz} Hz.` : ''} Nothing on the mouse changes.`),
      h('div', { class: 'actions' }, button('Start', () => start(setHz, who), { kind: 'primary small' })));
  };
  view = { box, draw, who };
  draw();
  return card([h('h2', {}, 'Polling rate test')], box);
}
