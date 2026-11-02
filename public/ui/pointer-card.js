// Windows pointer settings, one card for every mouse (1 Nov 2026, Shawn: "show the proper buttons"): these live in
// Windows, not on the mouse (server: /api/pointer). It was on the Pulsar's page only, so a PC with any other mouse never
// saw it; now also on an added mouse's page (pages/my-device.js) and, with no mouse page at all, on the PC page.
import { h } from './dom.js';
import { card, row, toggle, slider } from './controls.js';
import { isDemo } from '../core/devices.js';
import { toast } from './overlay.js';

let pointer = null, pointerLoading = false;
async function loadPointer(redraw) {
  if (pointerLoading) return;
  pointerLoading = true;
  try { pointer = await (await fetch('/api/pointer')).json(); } catch { pointer = { ok: false, error: 'DeviceHub did not answer' }; }
  pointerLoading = false;
  redraw();
}
async function setPointer(key, value, label, display, redraw) {
  // demo mode changes only its pretend values, never this PC's real Windows pointer settings (20 Oct 2026)
  if (isDemo()) { pointer = { ...pointer, [key]: value }; toast(`${label}: ${display}`, 'good', { detail: 'Demo: Windows is not changed.' }); redraw(); return; }
  try {
    const r = await fetch('/api/pointer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    pointer = j;
    toast(`${label}: ${display}`, 'good');
  } catch (e) { toast(`${label} not changed`, 'bad', { detail: e.message }); }
  redraw();
}
// a pointer slider step while dragging: Windows follows at once (21 Oct 2026); the release confirms
const livePointer = (key) => (isDemo() ? null : (value) => fetch('/api/pointer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value, live: true }) }));
export function pointerCard(redraw) {
  if (isDemo()) pointer = pointer || { ok: true, speed: 10, precision: false, scrollLines: 3, doubleClick: 500 };
  else if (!pointer) loadPointer(redraw);
  const p = pointer;
  const head = [h('h2', {}, 'Windows pointer'), h('span', { class: 'sub' }, 'all mice')];
  if (!p) return card(head, h('p', { class: 'faint' }, 'Reading…'));
  if (!p.ok) return card(head, h('p', { class: 'faint' }, `Not read: ${p.error}`));
  const page = p.scrollLines === -1;
  // the sliders together, then the switches (22 Oct 2026, Shawn: "group scrollables and buttons together")
  return card(head,
    row('Pointer speed', null, slider({ value: p.speed, min: 1, max: 20, live: livePointer('speed'), onCommit: (v) => setPointer('speed', v, 'Pointer speed', `${v}`, redraw) })),
    page ? null : row('Scroll lines', null, slider({ value: p.scrollLines, min: 1, max: 20, live: livePointer('scrollLines'), onCommit: (v) => setPointer('scrollLines', v, 'Scroll lines', `${v}`, redraw) })),
    row('Double-click speed', null, slider({ value: p.doubleClick, min: 200, max: 900, step: 10, unit: ' ms', live: livePointer('doubleClick'), onCommit: (v) => setPointer('doubleClick', v, 'Double-click speed', `${v} ms`, redraw) })),
    row('Enhance pointer precision', 'Acceleration. Best off for games.', toggle({ value: p.precision, label: 'Enhance pointer precision', onCommit: (on) => setPointer('precision', on, 'Pointer precision', on ? 'on' : 'off', redraw) })),
    row('Scroll one page at a time', null, toggle({ value: page, label: 'Scroll one page', onCommit: (on) => setPointer('scrollLines', on ? -1 : 3, 'Scrolling', on ? 'one page' : '3 lines', redraw) })));
}
