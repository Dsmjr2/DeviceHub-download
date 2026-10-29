// The polling rate test's arithmetic (29 Oct 2026; public/ui/polling-test.js). DeviceHub sets a mouse's polling rate
// but never saw what actually arrives; a bad port, a hub or a dongle far away can halve it. The page records the time
// of every mouse report the browser hands over while the person moves the mouse, and this works out the rate.
//
// Only the time the mouse was moving counts: a gap longer than PAUSE_MS is a pause, not a slow report. The rate is the
// reports over the moving time (a browser rounds each time to 0.1 ms, too coarse for one 8000 Hz gap of 0.125 ms, but
// an average over thousands is exact enough). "Steady" is the share of 100 ms stretches within a quarter of that rate.
export const PAUSE_MS = 20;
export const TEST_MS = 5000;
export const MIN_EVENTS = 200;
const WINDOW_MS = 100;

export function rateOf(times) {
  const t = (times || []).filter(Number.isFinite).sort((a, b) => a - b);
  let moving = 0, gaps = 0;
  const windows = [];
  let wStart = null, wGaps = 0, wTime = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt > PAUSE_MS) continue;   // two reports with the same rounded time are still two reports
    moving += dt; gaps++;
    if (wStart === null) wStart = t[i - 1];
    wGaps++; wTime += dt;
    if (t[i] - wStart >= WINDOW_MS) { windows.push(wGaps / wTime * 1000); wStart = null; wGaps = 0; wTime = 0; }
  }
  if (!gaps || moving <= 0) return { hz: 0, events: t.length, movingMs: 0, steady: 0 };
  const hz = gaps / moving * 1000;
  const steady = windows.length ? windows.filter((w) => Math.abs(w - hz) <= hz * 0.25).length / windows.length : 0;
  return { hz, events: t.length, movingMs: moving, steady };
}

// a rate shown the way the mouse page names them: 125, 250, 500, 1000 ... 8000
export const roundHz = (hz) => (hz >= 1000 ? Math.round(hz / 100) * 100 : Math.round(hz / 10) * 10);

// the verdict: { kind: 'match'|'low'|'high'|'short', line } for a measured rate against the one the mouse is set to
export function verdict(r, setHz) {
  if (!r || r.events < MIN_EVENTS || r.movingMs < 1000) return { kind: 'short', line: 'Not enough movement to measure. Press Start and keep the mouse moving in circles for the whole 5 seconds.' };
  const got = roundHz(r.hz);
  const shaky = r.steady < 0.7 ? ' It was uneven, which usually means a weak wireless signal or a busy USB port.' : '';
  if (!Number.isFinite(setHz) || setHz <= 0) return { kind: 'match', line: `About ${got} Hz arrived.${shaky}` };
  if (r.hz >= setHz * 0.75 && r.hz <= setHz * 1.25) return { kind: 'match', line: `About ${got} Hz arrived. That matches the ${setHz} Hz it is set to.${shaky}` };
  if (r.hz > setHz * 1.25) return { kind: 'high', line: `About ${got} Hz arrived, more than the ${setHz} Hz it is set to. Another mouse may have been moving too.` };
  const high = setHz >= 2000 ? ' At 2000 Hz and up, Windows or the browser can also merge reports, so this test can read lower than the mouse sends.' : '';
  return { kind: 'low', line: `Only about ${got} Hz arrived, but it is set to ${setHz} Hz. Plug the dongle or cable straight into the PC (not a hub or the front panel) and keep the dongle close to the mouse, then test again.${high}${shaky}` };
}
