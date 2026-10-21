// The Monitors page's Camera card (20 Oct 2026): the webcam's picture settings (helpers/camera.js). Each change is
// backed up, set one at a time and read back on the server; Auto (where the camera has it) leaves that one to the camera.
import { h, icon } from '../ui/dom.js';
import { card, row, slider, toggle, button } from '../ui/controls.js';
import { env } from '../core/env.js';
import { toast } from '../ui/overlay.js';

// shown in this order; how each value reads
const CONTROLS = [
  ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Color'], ['sharpness', 'Sharpness'], ['gamma', 'Gamma'],
  ['whiteBalance', 'White balance', (v) => `${v} K`], ['exposure', 'Exposure', (v) => (v < 0 ? `1/${2 ** -v} s` : `${2 ** v} s`)],
  ['backlight', 'Backlight fix'], ['gain', 'Gain'], ['focus', 'Focus'], ['zoom', 'Zoom', (v, c) => (c.min > 0 ? `${(v / c.min).toFixed(1)}×` : String(v))],
];
let cams = null, error = null, loading = false;

async function load(redraw, fresh) {
  if (loading) return; loading = true;
  try { cams = await env.api(`/api/cameras${fresh ? '?fresh=1' : ''}`); error = null; }
  catch (e) { error = e.message; }
  finally { loading = false; redraw(); }
}
async function set(cam, key, label, body, redraw) {
  try {
    const r = await env.api('/api/cameras/set', { id: cam.id, key, ...body });
    const c = cam.controls[key]; if (c) { c.value = r.value; c.auto = r.auto; }
    toast(`${cam.name}: ${label} ${r.auto ? 'auto' : 'set'}`, 'good');
  } catch (e) { toast(`${cam.name}: not changed`, 'bad', { detail: e.message }); load(redraw, true); return; }
  redraw();
}

function cameraCard(cam, redraw) {
  const rows = CONTROLS.filter(([k]) => cam.controls[k]).map(([key, label, fmt]) => {
    const c = cam.controls[key];
    // on Auto the camera picks the value itself (its reading then means nothing): say Auto
    const s = slider({ value: c.value, min: c.min, max: c.max, step: c.step || 1, format: (v) => (c.auto ? 'Auto' : fmt ? fmt(v, c) : String(v)), label, disabled: c.auto, live: (v) => env.api('/api/cameras/set', { id: cam.id, key, value: v }).catch(() => {}), onCommit: (v) => set(cam, key, label, { value: v }, redraw) });
    const auto = c.canAuto ? h('label', { class: 'cam-auto' }, h('span', { class: 'muted' }, 'Auto'),
      toggle({ value: c.auto, label: `${label} auto`, onCommit: (on) => set(cam, key, label, on ? { auto: true, value: c.value } : { value: c.value >= c.min && c.value <= c.max ? c.value : c.default }, redraw) })) : null;
    return row(label, null, auto ? h('div', { class: 'cam-ctl' }, auto, s) : s);
  });
  return card([icon('camera'), h('h2', {}, 'Camera'), h('span', { class: 'sub' }, cam.name)],
    rows.length ? rows : h('p', { class: 'faint' }, 'This camera lists no picture settings.'));
}

// the camera cards, to sit in the Monitors page's grid beside the monitors
export function cameraCards(redraw) {
  if (!cams && !error && !loading) queueMicrotask(() => load(redraw, false));
  if (error) return [card([h('h2', {}, 'Camera')], h('p', { class: 'faint' }, `Couldn't read the camera: ${error}`), h('div', { class: 'actions' }, button('Try again', () => load(redraw, true), { kind: 'small', ic: 'refresh' })))];
  return (cams || []).map((c) => cameraCard(c, redraw));
}
