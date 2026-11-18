// The sidebar's order, as the person arranged it (17 Nov 2026, Shawn: "make the tabs on the left side easily draggable
// so I can change the layout"). The rail is one list of tokens: page ids, and a group's heading as "#devices", "#desk"
// or "#app" (the top group, Overview and Setup, has none). An entry dragged under another heading moves to that group.
// The order is kept in settings.json "navOrder" (server.js checks it), so it survives a restart, a window mode change
// and a new Chrome profile. A page the saved order does not name yet (a newly added device) goes at the end of its
// usual group; a name that is no longer there is left out.
import { env } from './env.js';

export const GROUPS = ['#devices', '#desk', '#app'];
export const isGroup = (t) => GROUPS.includes(t);

// groups: { top: [ids], devices: [ids], desk: [ids], app: [ids] } in their usual order
export function defaultTokens({ top = [], devices = [], desk = [], app = [] }) {
  return [...top, '#devices', ...devices, '#desk', ...desk, '#app', ...app];
}

// the saved order laid over the usual one
// (the headings always keep their usual order; each page goes to the group whose heading it was saved under)
export function orderTokens(saved, def) {
  const known = new Set(def);
  const seg = { top: [] };
  for (const g of GROUPS) seg[g] = [];
  const seen = new Set();
  let cur = 'top';
  for (const t of Array.isArray(saved) ? saved : []) {
    if (typeof t !== 'string' || !known.has(t)) continue;
    if (isGroup(t)) { cur = t; continue; }
    if (seen.has(t)) continue;
    seg[cur].push(t); seen.add(t);
  }
  // a page not named: at the end of its usual group
  cur = 'top';
  for (const t of def) {
    if (isGroup(t)) { cur = t; continue; }
    if (!seen.has(t)) { seg[cur].push(t); seen.add(t); }
  }
  return [...seg.top, ...GROUPS.flatMap((g) => [g, ...seg[g]])];
}

// the order with one page moved to place `to` (an index in the list without that page)
export function moveToken(tokens, id, to) {
  if (isGroup(id) || !tokens.includes(id)) return tokens.slice();
  const rest = tokens.filter((t) => t !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest;
}

// ---- the saved order (settings.json navOrder) ----
let saved = null;
export async function loadOrder(demo = false) {
  if (saved) return saved;
  if (demo) { saved = []; return saved; }
  try { saved = (await env.api('/api/settings')).navOrder || []; } catch { saved = []; }
  return saved;
}
export const savedOrder = () => saved || [];
export const customOrder = () => (saved || []).length > 0;
const listeners = new Set();
export const onOrderChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// tokens: the new order, or [] for the usual one
export async function saveOrder(tokens, demo = false) {
  saved = Array.isArray(tokens) ? tokens.slice(0, 60) : [];
  for (const fn of listeners) { try { fn(saved); } catch {} }
  if (demo) return;
  await env.api('/api/settings', { navOrder: saved });
}
