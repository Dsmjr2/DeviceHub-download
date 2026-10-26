// Pause Wi-Fi scans while gaming: what the PC page's Wi-Fi control shows (26 Oct 2026; helpers/wifi-pause.mjs,
// public/ui/wifi-pause.js). No DOM and no requests, so tests/wifi-pause.mjs runs it in Node.
//   wifiView(status, job, { confirmRemove }) -> { show, lines, result, action, label, also, busy, uac, resume, gaming }
//     show: false on a cable (no Wi-Fi in use, scans normal) and before the first read: draw nothing
//     action: 'setup' | 'ask-remove' | 'remove' | null; resume: a Resume button; gaming: the switch's value, or null
export const ADD_LABEL = 'Pause Wi-Fi scans while gaming';
export const GAMING_LABEL = 'Pause Wi-Fi scans in Gaming profile';
export const REMOVE_LABEL = 'Remove';
export const DEMO_WIFI = {
  demo: true, setUp: true, task: true, copy: true, canSetUp: true, why: null, partial: null, show: true, inUse: true,
  scans: 'normal', paused: null, gaming: false, busy: false,
  before: 'Pauses the Wi-Fi scan in the Gaming profile only. Windows asks once.',
  remove: 'Turns scans back on and removes it. Windows asks once.',
};

export function wifiView(st, job = null, { confirmRemove = false } = {}) {
  if (job && !job.done) return { show: true, lines: [job.uac === 'waiting' ? job.text : `${job.text}…`], result: null, action: null, busy: true, uac: job.uac === 'waiting' };
  const result = job?.done ? { text: job.text, ok: !!job.ok } : null;
  if (!st || (!st.show && !result)) return { show: false };
  const state = `Wi-Fi scans: ${st.scans === 'paused' ? 'paused' : 'normal'}.`;
  if (job?.done && !job.ok && job.retry) return { show: true, lines: [job.kind === 'remove' ? st.remove : st.before], result, action: job.kind === 'remove' ? 'remove' : 'setup', label: 'Try again' };
  if (st.setUp) {
    if (confirmRemove) return { show: true, lines: [st.remove], result: null, action: 'remove', label: 'Yes, remove' };
    return { show: true, lines: [state], result, action: 'ask-remove', label: REMOVE_LABEL, resume: st.scans === 'paused', gaming: !!st.gaming };
  }
  const left = !!(st.task || st.copy);
  if (confirmRemove && left) return { show: true, lines: [st.remove], result: null, action: 'remove', label: 'Yes, remove' };
  if (!st.canSetUp) return { show: true, lines: [state, `It cannot be added here: ${st.why}.`], result, action: left ? 'ask-remove' : null, label: left ? REMOVE_LABEL : null };
  const lines = st.scans === 'paused' ? [state, 'Setting up turns them back on.'] : [st.before];
  return { show: true, lines: st.partial ? [...lines, st.partial] : lines, result, action: 'setup', label: ADD_LABEL, also: left ? 'ask-remove' : null };
}
