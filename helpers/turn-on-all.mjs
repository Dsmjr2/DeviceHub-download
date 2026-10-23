// "Turn on settings for all" (22 Oct 2026; docs/handoff/works-reports.md): the Set up card's one button. It presses Turn
// on settings for every installed library or learned driver that is waiting for it and whose device is connected, one
// after another, through the very same path as each device's own button (POST /api/agent/turn-on: the device's lock,
// the maker's app checked first, a backup first, one setting at a time, its own value written and read back). Nothing
// runs in parallel and nothing is retried. One plain line per device.
//
//   turnOnAll({ port, fetch })  -> { ok, results: [{ id, title, done, line }], line }
//   (helpers/diagnose.mjs action { kind: 'turn-on-all' }, POST /api/diagnose/action)
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// the same words as the device page's answer (public/pages/common.js checkAnswer, kind 'turn-on')
export function lineFor(title, r) {
  const c = r?.counts;
  const passed = c ? `${c.passed} of ${plural(c.checked, 'setting')} passed${c.waiting ? `, ${c.waiting} waiting` : ''}${c.failed ? `, ${c.failed} ${c.failed === 1 ? 'stays' : 'stay'} read-only` : ''}` : '';
  if (r?.ran) return `${title}: settings turned on, ${passed}.`;
  if (r?.on) return `${title}: settings turned on.${r.why ? ` Not checked yet: ${r.why}` : ''}`;
  return `${title}: not turned on: ${r?.why || 'unknown problem'}`;
}

// waiting for Turn on settings: a library or learned driver (adapter.library) that says so (library.turnOn)
// (never one that found nothing of its own on this PC: d.absent, helpers/my-devices.mjs isAbsent)
export const waitingForTurnOn = (d) => !!d?.adapter?.plugin && !d.absent && !!d.adapter.library && d.adapter.library.turnOn === true;

export async function turnOnAll({ port = PORT, fetch: get = fetch, timeoutMs = 120000 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  let state = null;
  try { const r = await get(`${base}/api/agent/state`, { signal: AbortSignal.timeout(10000) }); state = r.ok ? await r.json() : null; } catch {}
  if (!state) return { ok: false, results: [], line: "DeviceHub's background part did not answer. Try again in a moment." };
  const waiting = (state.devices || []).filter(waitingForTurnOn);
  const results = [];
  for (const d of waiting) {
    const title = d.adapter.title || d.id;
    if (d.status !== 'connected') { results.push({ id: d.id, title, done: false, line: `${title}: not connected, so it was left for later.` }); continue; }
    let j;
    try {
      const r = await get(`${base}/api/agent/turn-on`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id }), signal: AbortSignal.timeout(timeoutMs) });
      j = await r.json().catch(() => ({}));
      if (!r.ok) j = { ran: false, on: false, why: j.error || `DeviceHub answered ${r.status}` };
    } catch (e) { j = { ran: false, on: false, why: e.name === 'TimeoutError' ? 'it took too long' : e.message }; }
    results.push({ id: d.id, title, done: !!j.on, ran: !!j.ran, counts: j.counts || null, line: lineFor(title, j) });
  }
  const on = results.filter((x) => x.done).length;
  const line = !waiting.length ? 'No device is waiting for Turn on settings.' : `Turned on ${on} of ${plural(waiting.length, 'device')}.`;
  return { ok: true, results, line };
}
