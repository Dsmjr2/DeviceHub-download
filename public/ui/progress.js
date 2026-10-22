// A smooth progress bar (22 Oct 2026, Shawn: "make the bar slowly move and smoothly when looking for an app update and
// when updating also", then "make them far smoother"). One bar for the whole job that only ever moves forward.
//   - Each step has a range (from, to). Within a step the goal drifts from `from` toward `to` on a slow curve, so the
//     bar keeps moving while a step runs and never claims it is done before it is.
//   - The bar follows that goal with a soft lag and a top speed, so a new step, a download percentage or the end never
//     makes it jump or surge: it eases in and out at a calm pace.
//   - The fill slides (transform) instead of changing width: the browser moves it without laying the page out again,
//     so it stays smooth even while the rest of the page is busy.
//   - done() runs it to the end at the same calm pace and resolves once it is there.
// The element is kept and changed in place, so a page redraw never restarts it.
import { h } from './dom.js';

const CREEP_MS = 6000;   // within a step, the goal covers ~63% of what is left of the step every 6 s (a step can set its own)
const LAG_MS = 260;      // how softly the bar follows its goal
const TOP_SPEED = 35;    // at most this many percent a second (the end: about 2 s from a third of the way)

export function smoothBar() {
  const fill = h('span', { class: 'loadbar-fill' });
  const bar = h('div', { class: 'loadbar smooth', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const label = h('span', { class: 'loadbar-text' });
  const el = h('div', { class: 'loadbar-wrap' }, bar, label);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = 0, from = 0, to = 0, stepAt = 0, creep = CREEP_MS, text = '', raf = 0, last = 0, said = '';
  let arrived = null;   // done()'s promise, resolved at 100
  const goal = (now) => (to <= from ? from : from + (to - from) * (1 - Math.exp(-(now - stepAt) / creep)));
  const paint = () => {
    fill.style.transform = `translateX(${shown - 100}%)`;
    const pct = Math.floor(shown);
    const words = `${text} · ${pct}%`;
    if (words !== said) {   // the label and the reader's value change only when the whole number does
      said = words; label.textContent = words;
      bar.setAttribute('aria-valuenow', String(pct)); bar.setAttribute('aria-label', text);
    }
  };
  const tick = (now) => {
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const g = Math.max(shown, goal(now));
    if (still) shown = g;
    else {
      const step = (g - shown) * (1 - Math.exp(-dt / LAG_MS));
      shown += Math.min(step, (TOP_SPEED * dt) / 1000);
    }
    if (to >= 100 && shown > 99.6) shown = 100;
    paint();
    if (shown >= 100 && arrived) { arrived.resolve(); arrived = null; }
    raf = el.isConnected || !last ? requestAnimationFrame(tick) : 0;
  };
  const run = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };
  return {
    get el() { run(); return el; },   // shown again after the page was left: it carries on moving
    get value() { return shown; },
    // a step: its words and its share of the bar; never backwards. The same step again (a new download percentage)
    // moves the range without restarting the drift.
    step(words, a, b, creepMs = CREEP_MS) {
      const now = performance.now();
      if (words !== text || a > from) stepAt = now;
      creep = creepMs;
      text = words;
      from = Math.max(from, shown, Math.min(a, 100));
      to = Math.max(from, Math.min(b, 100));
      paint(); run();
    },
    // the job is done: run to the end at the same calm pace; resolves once the bar is full
    done(words = text) {
      this.step(words, 100, 100);
      if (shown >= 100) return Promise.resolve();
      let resolve; const p = new Promise((r) => { resolve = r; });
      arrived = { resolve };
      return p;
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}
