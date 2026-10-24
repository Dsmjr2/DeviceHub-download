// Windows' admin box (UAC), made easy to find (24 Oct 2026, docs/handoff/smoother-for-friends.md). Every action that
// raises Windows' permission prompt (board lights setup and removal, PawnIO's and every optional tool's installer, the
// learning listener, Equalizer APO's Device Selector) shows UAC_LINE in place while it waits, notices a prompt that was
// declined or not answered within UAC_WAIT_MS, says so with a Try again button, and records it here so Get help
// reports it (helpers/pc-picture.mjs). No pop-ups, toasts or tooltips: the page shows the line where the button was.
//
//   UAC_LINE, UAC_WAIT_MS                 the line shown while Windows asks, and how long DeviceHub waits for an answer
//   declinedText(what), unansweredText(what)   the plain result lines ("what" = what was not done)
//   record({ area, action, outcome })     outcome: 'asked' | 'yes' | 'declined' | 'unanswered'; kept in
//                                         logs\uac-prompts.log (the last 200) and one "[uac]" line in the log
//   recent({ root, n, sinceMs })          the last answers that were not yes (declined / unanswered), newest last
//   watchPrompt({ waitMs, onTimeout })    a timer for one prompt: .answered() when Windows started the program,
//                                         onTimeout() once if it was not answered in time
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UAC_LINE = 'Windows is asking for permission: click Yes (if hidden, click the blinking shield on the taskbar).';
export const UAC_WAIT_MS = 2 * 60 * 1000;
export const declinedText = (what) => `${what}: Windows' permission box was declined. Nothing was changed.`;
export const unansweredText = (what) => `${what}: Windows' permission box was not answered within 2 minutes. Close it if it is still open, then press Try again.`;
const KEEP = 200;
export const options = { root: ROOT, now: () => new Date() };
const file = (root) => path.join(root, 'logs', 'uac-prompts.log');   // one JSON line each; *.log stays out of git and the zip

// only the running DeviceHub (server.js) writes to its own logs\; a test points options.root at TEMP or writes nothing
const live = () => options.root !== ROOT || /server\.js$/i.test(process.argv[1] || '');
export function record({ area, action, outcome, detail = null }, { root = options.root } = {}) {
  const e = { at: options.now().toISOString(), area: String(area || ''), action: String(action || ''), outcome: String(outcome || ''), ...(detail ? { detail: String(detail).slice(0, 200) } : {}) };
  if (!live() && root === ROOT) return e;
  try {
    fs.mkdirSync(path.dirname(file(root)), { recursive: true });
    let lines = [];
    try { lines = fs.readFileSync(file(root), 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
    lines.push(JSON.stringify(e));
    fs.writeFileSync(file(root), lines.slice(-KEEP).join('\n') + '\n');
  } catch {}
  if (outcome !== 'asked' && live()) try { console.log(`[uac] ${e.area}: ${e.action}: Windows' permission box ${outcome === 'yes' ? 'answered Yes' : outcome === 'declined' ? 'declined' : outcome === 'unanswered' ? 'not answered within 2 minutes' : outcome}`); } catch {}
  return e;
}

export function recent({ root = options.root, n = 5, sinceMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(file(root), 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; }
  const since = options.now().getTime() - sinceMs;
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && (e.outcome === 'declined' || e.outcome === 'unanswered') && Date.parse(e.at) >= since).slice(-n);
}

export function watchPrompt({ waitMs = UAC_WAIT_MS, onTimeout = () => {} } = {}) {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; try { onTimeout(); } catch {} } }, waitMs);
  t.unref?.();
  return {
    answered() { if (!done) { done = true; clearTimeout(t); } },
    clear() { done = true; clearTimeout(t); },
  };
}
