// "Test it with me" (29 Oct 2026, Shawn: test the untested drivers on real hardware, so the next person's device just
// works). The self-check only proves a device takes back its own value; it cannot tell a driver that writes the wrong
// byte from one that works. So, on a library driver's page once its settings are on, DeviceHub changes each setting for
// a moment, through the same guarded write as the page (backed up, one at a time, read back), asks the person whether
// they noticed (Yes / No / Can't tell), and puts the old value back. The answers stay on this PC in the driver's folder
// (tried.json), tied to the driver's exact text. "Works on my device" then needs every testable setting tried, no "No",
// and at least one "Yes"; the record names the settings the person saw change (`seen`). A "No" means the driver is
// wrong for that setting: the page offers Get help instead.
//
//   GET  /api/help/tried?id=<device>                       -> { ok, keys: { key: { answer, from, to, at } } }
//   POST /api/help/tried { id, key, answer, from, to }     -> { ok, keys }
//
// tried.json: { driverSha, keys: { key: { answer: 'yes'|'no'|'unsure', from, to, at } } }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driverShaOf, libraryMark } from './my-devices.mjs';
import { testable } from '../public/core/guided-values.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;
export const TRIED_FILE = 'tried.json';
export const ANSWERS = ['yes', 'no', 'unsure'];
// root: the DeviceHub folder (tests use their own)
export const options = { root: ROOT };
export { TESTABLE_TYPES, testable, testValue } from '../public/core/guided-values.js';
// the answers kept for this driver's exact text, or {} (a changed driver starts over)
export function readTried(folder) {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(folder, TRIED_FILE), 'utf8'));
    if (!t || typeof t !== 'object' || t.driverSha !== driverShaOf(folder) || !t.keys || typeof t.keys !== 'object') return {};
    return t.keys;
  } catch { return {}; }
}

const small = (v) => v === undefined || JSON.stringify(v).length <= 200;
export function saveAnswer(folder, settings, { key, answer, from, to }, now = () => new Date()) {
  const s = (settings || []).find((x) => x.key === key);
  if (!s) throw Object.assign(new Error('That is not one of its settings.'), { code: 400 });
  if (!ANSWERS.includes(answer)) throw Object.assign(new Error('The answer must be yes, no or unsure.'), { code: 400 });
  if (!small(from) || !small(to)) throw Object.assign(new Error('The values are too long.'), { code: 400 });
  const sha = driverShaOf(folder);
  if (!sha) throw Object.assign(new Error('Its driver file is missing.'), { code: 400 });
  const keys = { ...readTried(folder), [key]: { answer, from: from ?? null, to: to ?? null, at: now().toISOString() } };
  fs.writeFileSync(path.join(folder, TRIED_FILE), JSON.stringify({ driverSha: sha, keys }, null, 2));
  return keys;
}

// where the test stands for the settings a works record would list: { untried, no, yes, unsure } (setting keys)
export function summary(settings, values, tried) {
  const out = { untried: [], no: [], yes: [], unsure: [] };
  for (const s of settings || []) {
    const a = tried?.[s.key]?.answer;
    if (a === 'yes') out.yes.push(s.key); else if (a === 'no') out.no.push(s.key); else if (a === 'unsure') out.unsure.push(s.key);
    else if (testable(s, values?.[s.key])) out.untried.push(s.key);
  }
  return out;
}

// ---------- the route ----------
async function agentState(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/agent/state`, { signal: AbortSignal.timeout(10000) }); return r.ok ? await r.json() : null; } catch { return null; }
}
// a connected library driver's folder and settings, or throws
async function deviceOf(id, { port = PORT, root = options.root, state } = {}) {
  const st = state ? await state() : await agentState(port);
  if (!st) throw Object.assign(new Error("DeviceHub's background part did not answer. Try again in a moment."), { code: 503 });
  const snap = (st.devices || []).find((d) => d.id === String(id || ''));
  const a = snap?.adapter;
  if (!a?.plugin) throw Object.assign(new Error('This device has no driver from the device library.'), { code: 404 });
  const folder = path.join(root, 'my-devices', a.plugin);
  if (!libraryMark(folder)) throw Object.assign(new Error('This driver is not from the device library.'), { code: 400 });
  return { folder, settings: a.settings || [] };
}
export async function getTried(id, deps = {}) {
  const { folder } = await deviceOf(id, deps);
  return { ok: true, keys: readTried(folder) };
}
export async function postTried(body, deps = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const { folder, settings } = await deviceOf(b.id, deps);
  return { ok: true, keys: saveAnswer(folder, settings, b, deps.now) };
}
