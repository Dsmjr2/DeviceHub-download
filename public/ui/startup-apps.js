// Start-up apps, in the PC check card on the PC page (27 Oct 2026, Shawn: what starts with Windows, how much each slows
// sign-in, and a one-click Off and On again; helpers/startup-apps.js). One line, "Start-up apps: 6 of 10 on", that
// opens to the list, so the page still fits the window. Read when the page opens (the last answer at once; read again
// when over a minute old), never in the background. An HKLM app asks Windows once; the result shows on its row. No pop-ups.
import { h, dateTime } from './dom.js';
import { toggle } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';

const DEMO = () => ({ at: new Date().toISOString(), on: 3, total: 4, impact: { readable: true, measuredAt: new Date(Date.now() - 3 * 3600e3).toISOString(), note: null }, apps: [
  { id: 'HKCU|StartupFolder|DeviceHub.lnk', name: 'DeviceHub', publisher: '', on: true, impact: 'Medium', self: true },
  { id: 'HKCU|Run|OneDrive', name: 'Microsoft OneDrive', publisher: 'Microsoft Corporation', on: true, impact: 'High' },
  { id: 'HKLM|Run|SecurityHealth', name: 'Windows Security notification icon', publisher: 'Microsoft Corporation', on: true, impact: 'Low', admin: true },
  { id: 'HKCU|Run|Edge', name: 'Microsoft Edge', publisher: 'Microsoft Corporation', on: false, impact: 'Not measured' }] });
let data = null, err = null, loading = false, at = 0, lastDrawn = 0, open = false, busy = null, note = null, redraw = () => {};

async function load(fresh) {
  if (loading) return;
  loading = true;
  try { data = isDemo() ? (data || DEMO()) : await env.api(`/api/startup-apps${fresh ? '?fresh=1' : ''}`); err = null; at = Date.now(); }
  catch (e) { err = e.message; }
  loading = false; redraw();
}
async function flip(a, on) {
  if (isDemo()) { a.on = on; note = { id: a.id, text: `Demo: ${a.name} ${on ? 'on' : 'off'}.` }; redraw(); return; }
  busy = a.id; note = a.admin ? { id: a.id, text: "Click Yes in Windows' prompt (if hidden, the blinking taskbar shield)." } : null; redraw();
  try {
    const r = await env.api('/api/startup-apps/set', { id: a.id, on });
    if (r.apps) data = r.apps;
    note = { id: a.id, text: r.ok ? null : r.text };
    if (!r.ok) throw new Error(r.text);
  } catch (e) { note = { id: a.id, text: note?.text || `Not changed: ${e.message}` }; throw e; }
  finally { busy = null; redraw(); }
}

const row = (a) => h('div', { class: 'su-app' },
  h('div', { class: 'su-app-name' },
    h('span', { class: 'su-app-title' }, a.name),
    note?.id === a.id && note.text ? h('small', { class: 'su-app-note' }, note.text)
      : a.self ? h('small', { class: 'faint' }, a.on ? "Off = DeviceHub won't start with Windows." : "DeviceHub won't start with Windows.")
        : a.publisher ? h('small', { class: 'faint' }, a.publisher) : null),
  h('small', { class: `su-app-impact${/High/.test(a.impact) ? ' warn' : ''}`, title: 'Start-up impact' }, a.impact || '—'),
  toggle({ value: a.on, label: `${a.name} at start-up`, disabled: !!busy && busy !== a.id, onCommit: (on) => flip(a, on) }));

export function startupApps({ redraw: r } = {}) {
  redraw = r || redraw;
  const opened = Date.now() - lastDrawn > 10000; lastDrawn = Date.now();
  if ((!data && !err) || (opened && Date.now() - at > 60000)) queueMicrotask(() => load(false));
  const sum = data ? `Start-up apps: ${data.on} of ${data.total} on` : err ? 'Start-up apps: not read' : 'Start-up apps…';
  return h('details', { class: 'pcc-ok su-apps', open, ontoggle: (e) => { open = e.target.open; } },
    h('summary', {}, h('span', { class: 'pcc-dot info' }), h('span', {}, sum)),
    err ? h('p', { class: 'faint' }, `Not read: ${err}`) : null,
    data ? h('div', { class: 'su-list' }, ...data.apps.map(row)) : null,
    data?.impact?.note ? h('p', { class: 'faint su-foot' }, data.impact.note)
      : data?.impact?.measuredAt ? h('p', { class: 'faint su-foot' }, `Impact measured at sign-in, ${dateTime(data.impact.measuredAt)}.`) : null);
}
