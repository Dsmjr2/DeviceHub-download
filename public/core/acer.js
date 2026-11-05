// Acer fans, sensors and charge limit: what the Laptop page's Acer card shows (3 Nov 2026; helpers/acer-control.mjs,
// public/pages/laptop.js). No DOM and no requests, so tests/acer-control.mjs runs it in Node.
//   acerView(status, job, { confirmRemove, nitroOpen }) -> { show, lines, result, action, label, busy, uac, readings, controls }
//     show: false on a laptop that is not an Acer with the gaming interface
//     action: 'setup' | 'ask-remove' | 'remove' | null; controls: the fan mode and charge limit, once set up
export const ADD_LABEL = 'Set up fan and charge controls';
export const DEMO_ACER = {
  demo: true, acer: true, setUp: true, task: true, copy: true, canSetUp: true, why: null, partial: null, busy: false,
  readings: { cpuC: 52, gpuC: null, systemC: 41, cpuFanRpm: 2350, gpuFanRpm: 2200, cpuFanMode: 'auto', gpuFanMode: 'auto', healthMode: false, fresh: true },
  before: 'Adds the Acer fan speeds, temperatures, fan mode and charge limit. Windows asks once. Nothing changes until you press a control.',
  remove: 'Puts the fans back to Auto and removes it. Windows asks once.',
};
export const FAN_MODES = [{ value: 'auto', label: 'Auto' }, { value: 'max', label: 'Max' }];

export function acerView(st, job = null, { confirmRemove = false } = {}) {
  if (job && !job.done) return { show: true, lines: [job.uac === 'waiting' ? job.text : `${job.text}…`], result: null, action: null, busy: true, uac: job.uac === 'waiting' };
  const result = job?.done ? { text: job.text, ok: !!job.ok } : null;
  if (!st || (!st.acer && !st.task && !st.copy)) return { show: false };
  if (job?.done && !job.ok && job.retry) return { show: true, lines: [job.kind === 'remove' ? st.remove : st.before], result, action: job.kind === 'remove' ? 'remove' : 'setup', label: 'Try again' };
  if (st.setUp) {
    if (confirmRemove) return { show: true, lines: [st.remove], result: null, action: 'remove', label: 'Yes, remove' };
    const r = st.readings;
    return { show: true, lines: r?.fresh ? [] : [r?.error ? `Not read: ${r.error}` : 'Reading the laptop…'], result, action: 'ask-remove', label: 'Remove',
      readings: r?.fresh && !r.error ? r : null,
      controls: { fans: r?.cpuFanMode === 'max' || r?.gpuFanMode === 'max' ? 'max' : r?.cpuFanMode || r?.gpuFanMode || null, health: r?.healthMode ?? null } };
  }
  const left = !!(st.task || st.copy);
  if (confirmRemove && left) return { show: true, lines: [st.remove], result: null, action: 'remove', label: 'Yes, remove' };
  if (!st.canSetUp) return { show: true, lines: [`It cannot be added here: ${st.why}.`], result, action: left ? 'ask-remove' : null, label: left ? 'Remove' : null };
  return { show: true, lines: st.partial ? [st.before, st.partial] : [st.before], result, action: 'setup', label: ADD_LABEL };
}
