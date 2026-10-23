// Board, fan and RAM lights: what the one control shows (22 Oct 2026; helpers/board-lights.mjs, public/ui/board-lights.js).
// No DOM and no requests here, so tests/board-lights.mjs runs it in Node.
//   boardView(status, job, { confirmRemove }) -> { line, result, action, label, busy }
//     status: GET /api/board-lights; job: GET /api/board-lights/progress (null before any click)
//     line: the one plain line (before the click: what happens, the prompt, what OpenRGB may change)
//     result: { text, ok } the plain result line after a click, or null
//     action: 'setup' | 'ask-remove' | 'remove' | null, label: its button
export const ADD_LABEL = 'Add board, fan and RAM lights';
export const REMOVE_LABEL = 'Remove board lights';
export const DEMO_BOARD = {
  demo: true, pawnio: { installed: true, version: '2.2.0.0' }, setUp: false, task: false, copy: false, canSetUp: true, why: null, partial: null, busy: false,
  before: "Sets the OpenRGB inside DeviceHub to start as administrator when you sign in (PawnIO is already installed). Windows asks once. OpenRGB will then be allowed to change your board's lighting chip.",
  remove: 'Stops it and deletes its task and copy: back to USB lights only. Windows asks once. PawnIO stays installed; to remove it, open Windows Settings > Apps > Installed apps, find PawnIO and choose Uninstall.',
};

export function boardView(st, job = null, { confirmRemove = false } = {}) {
  if (job && !job.done) return { line: job.pct != null ? `${job.text} (${job.pct}%)` : `${job.text}…`, result: null, action: null, busy: true };
  const result = job?.done ? { text: job.text, ok: !!job.ok } : null;
  if (!st) return { line: 'Checking board lights…', result, action: null };
  if (st.setUp) {
    if (confirmRemove) return { line: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
    return { line: 'Board, fan and RAM lights are on: OpenRGB runs as administrator when you sign in.', result, action: 'ask-remove', label: REMOVE_LABEL };
  }
  // a part left from a try that failed (the task or the copy alone): Remove stays offered beside Add
  const left = !!(st.task || st.copy);
  if (confirmRemove && left) return { line: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
  if (!st.canSetUp) return { line: `Board lights cannot be added from here: ${st.why}.`, result, action: left ? 'ask-remove' : null, label: left ? REMOVE_LABEL : null };
  return { line: st.partial ? `${st.before} (${st.partial} Adding again replaces it.)` : st.before, result, action: 'setup', label: ADD_LABEL, also: left ? 'ask-remove' : null };
}
