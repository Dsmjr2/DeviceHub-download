// Page timers that rest while the window is hidden (26 Oct 2026, idle CPU): minimized, behind a game or on another
// desktop, the window asks DeviceHub for nothing. A tick missed while hidden runs once as soon as the window is shown
// again (when it is due), then the timer carries on as before. Live device events still arrive on the event stream.
//   const stop = everyVisible(fn, ms)     fn every ms while document.visibilityState is 'visible'
//   isHidden()                            the window is not shown now
// doc / now / setI / clearI are for tests (tests/visible-timer.mjs).
export const isHidden = (doc = globalThis.document) => !!doc && (doc.visibilityState ? doc.visibilityState !== 'visible' : !!doc.hidden);

export function everyVisible(fn, ms, { doc = globalThis.document, now = () => Date.now(), setI = setInterval, clearI = clearInterval } = {}) {
  let last = now(), missed = false;
  const run = () => { last = now(); missed = false; try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch {} };
  const timer = setI(() => { if (isHidden(doc)) { missed = true; return; } run(); }, ms);
  const onShow = () => { if (!isHidden(doc) && missed && now() - last >= ms) run(); };
  doc?.addEventListener?.('visibilitychange', onShow);
  return () => { clearI(timer); doc?.removeEventListener?.('visibilitychange', onShow); };
}
