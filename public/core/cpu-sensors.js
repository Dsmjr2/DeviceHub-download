// CPU temperature and fan speeds: what the one control on the Temperatures and fans card shows (24 Oct 2026;
// helpers/cpu-sensors.mjs, public/ui/cpu-sensors.js). No DOM and no requests, so tests/cpu-sensors.mjs runs it in Node.
//   sensorsView(status, job, { confirmRemove }) -> { lines, result, action, label, busy, uac, also }
//     status: GET /api/cpu-sensors; job: GET /api/cpu-sensors/progress (null before any click)
//     lines: the plain lines, one sentence each; result: { text, ok } after a click
//     action: 'setup' | 'ask-remove' | 'remove' | null
// Also shouldRead(): the one rule for reading the card's temperatures (only while it is on screen).
export const ADD_LABEL = 'Add CPU temperature and fan speeds';
export const REMOVE_LABEL = 'Remove';
export const DEMO_SENSORS = {
  demo: true, pawnio: { installed: true, version: '2.2.0.0' }, setUp: false, task: false, copy: false, canSetUp: true, why: null, partial: null, busy: false,
  before: ['Downloads LibreHardwareMonitor (6.6 MB). Windows asks once. Read only.'],
  remove: ['Removes the reader. Windows asks once.'],
};

export function sensorsView(st, job = null, { confirmRemove = false } = {}) {
  if (job && !job.done) return { lines: [job.uac === 'waiting' ? job.text : job.pct != null ? `${job.text} (${job.pct}%)` : `${job.text}…`], result: null, action: null, busy: true, uac: job.uac === 'waiting' };
  const result = job?.done ? { text: job.text, ok: !!job.ok } : null;
  if (!st) return { lines: [], result, action: null };
  if (job?.done && !job.ok && job.retry) return { lines: job.kind === 'remove' ? st.remove : st.before, result, action: job.kind === 'remove' ? 'remove' : 'setup', label: 'Try again' };
  if (st.setUp) {
    if (confirmRemove) return { lines: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
    return { lines: [], result, action: 'ask-remove', label: REMOVE_LABEL };
  }
  const left = !!(st.task || st.copy);
  if (confirmRemove && left) return { lines: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
  if (!st.canSetUp) return { lines: [`It cannot be added here: ${st.why}.`], result, action: left ? 'ask-remove' : null, label: left ? REMOVE_LABEL : null };
  return { lines: st.partial ? [...st.before, `${st.partial} Adding again replaces it.`] : st.before, result, action: 'setup', label: ADD_LABEL, also: left ? 'ask-remove' : null };
}

// read the temperatures only on the PC page, with the window shown and the card on screen
export const shouldRead = ({ hash, page, hidden, onScreen }) => hash === `#/${page}` && !hidden && !!onScreen;
