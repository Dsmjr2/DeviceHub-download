// Board, fan and RAM lights: what the one control shows (22 Oct 2026; helpers/board-lights.mjs, public/ui/board-lights.js).
// No DOM and no requests here, so tests/board-lights.mjs runs it in Node.
//   boardView(status, job, { confirmRemove }) -> { line, result, action, label, busy }
//     status: GET /api/board-lights; job: GET /api/board-lights/progress (null before any click)
//     line: the one plain line (before the click: what happens, the prompt, what OpenRGB may change)
//     result: { text, ok } the plain result line after a click, or null
//     action: 'setup' | 'ask-remove' | 'remove' | null, label: its button (Try again after Windows' box was declined or
//     not answered: job.retry)
export const ADD_LABEL = 'Add board, fan and RAM lights';
export const REMOVE_LABEL = 'Remove board lights';
export const DEMO_BOARD = {
  demo: true, pawnio: { installed: true, version: '2.2.0.0' }, setUp: false, task: false, copy: false, canSetUp: true, why: null, partial: null, busy: false,
  before: 'Runs OpenRGB as administrator. Windows asks once.',
  remove: 'Back to USB lights only. Windows asks once. PawnIO stays installed (remove it in Settings > Apps > Installed apps).',
};

export function boardView(st, job = null, { confirmRemove = false } = {}) {
  // while Windows' permission box is open (job.uac 'waiting', helpers/uac.mjs): the line says where to find it, as is
  if (job && !job.done) return { line: job.uac === 'waiting' ? job.text : job.pct != null ? `${job.text} (${job.pct}%)` : `${job.text}…`, result: null, action: null, busy: true, uac: job.uac === 'waiting' };
  const result = job?.done ? { text: job.text, ok: !!job.ok } : null;
  if (!st) return { line: 'Checking board lights…', result, action: null };
  // the box was declined or not answered (job.retry): the same action again, as Try again
  if (job?.done && !job.ok && job.retry) return { line: job.kind === 'remove' ? st.remove : st.before, result, action: job.kind === 'remove' ? 'remove' : 'setup', label: 'Try again' };
  if (st.setUp) {
    if (confirmRemove) return { line: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
    return { line: 'Board, fan and RAM lights are on.', result, action: 'ask-remove', label: REMOVE_LABEL };
  }
  // a part left from a try that failed (the task or the copy alone): Remove stays offered beside Add
  const left = !!(st.task || st.copy);
  if (confirmRemove && left) return { line: st.remove, result: null, action: 'remove', label: 'Yes, remove' };
  if (!st.canSetUp) return { line: `Board lights cannot be added: ${st.why}.`, result, action: left ? 'ask-remove' : null, label: left ? REMOVE_LABEL : null };
  return { line: st.partial ? `${st.before} (${st.partial} Adding again replaces it.)` : st.before, result, action: 'setup', label: ADD_LABEL, also: left ? 'ask-remove' : null };
}
