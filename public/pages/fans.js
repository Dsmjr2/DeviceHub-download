// Fans (20 Oct 2026), read-only for now: the graphics card's temperature, fan, load and power (helpers/gpu.js,
// NVIDIA's own nvidia-smi), refreshed every 2 s while this page is open and never in the background. The CPU and case
// fans run on the motherboard's own curve (its BIOS); reading the CPU temperature or the board's fans needs a kernel
// driver, so they are not read here. docs/FANS.md has the BIOS settings to tune that curve.
import { h } from '../ui/dom.js';
import { card, row } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { meter } from '../ui/gauges.js';

const DEMO = { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 62, fanPct: 38, loadPct: 71, powerW: 142, powerLimitW: 200, memUsedMB: 6100, memTotalMB: 12282, clockMHz: 2610, headroomC: 22 }] };
let gpu = null, error = null, timer = null, rerender = () => {};
// the temperature over the last 2 minutes, kept only while the page is open (one reading every 2 s)
let history = [];
function graph() {
  if (history.length < 2) return null;
  const W = 300, H = 56, mn = Math.min(...history), mx = Math.max(...history), lo = mn - 3, hi = mx + 3;
  // the readings so far across the whole width (2 s apart), the newest at the right
  const x = (i) => (i / (history.length - 1)) * W, y = (t) => H - ((t - lo) / Math.max(1, hi - lo)) * H;
  const pts = history.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ');
  const span = history.length * 2, spanText = span >= 90 ? `last ${Math.round(span / 60)} min` : `last ${span} s`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'temp-graph'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `temperature over the last ${Math.round(history.length * 2 / 60 * 10) / 10} minutes: ${Math.min(...history)} to ${Math.max(...history)} °C`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<polygon points="0,${H} ${pts} ${W},${H}" fill="var(--signal)" opacity=".12"/><polyline points="${pts}" fill="none" stroke="var(--signal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return h('div', { class: 'temp-graph-wrap' }, svg, h('div', { class: 'temp-graph-scale' },
    mx === mn ? h('span', {}, `${mx} °C`) : [h('span', {}, `${mx} °C`), h('span', {}, `${mn} °C`)], h('small', { class: 'faint' }, spanText)));
}

async function load() {
  if (isDemo()) { gpu = { ...DEMO, gpus: [{ ...DEMO.gpus[0], tempC: 60 + Math.round(Math.random() * 5) }] }; }
  else try { gpu = await env.api('/api/gpu'); error = null; } catch (e) { error = e.message; }
  const t = gpu?.gpus?.[0]?.tempC; if (t != null) { history.push(t); if (history.length > 60) history.shift(); }
  rerender();
}
// refresh while the page is open; stop as soon as it is left
function keepFresh() {
  if (timer) return;
  timer = setInterval(() => { if (location.hash !== '#/fans' || document.hidden) { clearInterval(timer); timer = null; history = []; return; } load(); }, 2000);
}

function gpuCard(g) {
  const tempPct = g.tempC == null ? null : Math.min(100, Math.round((g.tempC / 90) * 100));
  return card([h('h2', {}, 'Graphics card'), h('span', { class: 'sub' }, g.name)],
    h('div', { class: 'hero-stats', style: { marginBottom: '8px' } },
      meter({ ic: 'thermo', pct: tempPct, value: g.tempC == null ? '—' : `${g.tempC} °C`, label: 'temperature', big: true }),
      meter({ ic: 'fan', pct: g.fanPct, value: g.fanPct == null ? '—' : g.fanPct === 0 ? 'Stopped' : `${g.fanPct}%`, label: 'fans', big: true }),
      meter({ ic: 'gauge', pct: g.loadPct, value: g.loadPct == null ? '—' : `${g.loadPct}%`, label: 'load', big: true })),
    graph(),
    row('Power', 'Drawing now, of its limit.', h('b', {}, g.powerW == null ? '—' : `${Math.round(g.powerW)} W of ${Math.round(g.powerLimitW || 0)} W`)),
    g.headroomC != null ? row('Headroom', 'Degrees before it slows down.', h('b', {}, `${g.headroomC} °C`)) : null,
    row('Video memory', 'Graphics memory in use.', h('b', {}, g.memUsedMB == null ? '—' : `${(g.memUsedMB / 1024).toFixed(1)} of ${(g.memTotalMB / 1024).toFixed(0)} GB`)));
}

export default {
  id: 'fans', title: 'Fans', icon: 'fan', accent: 'var(--signal)',
  watches: [],  // its own 2 s reading redraws it; a device's readings do not (21 Oct 2026)
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/fans') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!gpu && !error) queueMicrotask(load);
    keepFresh();
    const gpus = gpu?.available ? gpu.gpus : [];
    return h('div', {},
      topbar('Cooling', 'Fans', null),
      h('div', { class: 'grid two top' },
        error ? card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, `Could not read it: ${error}`))
          : !gpu ? card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, 'Reading…'))
            : gpus.length ? gpuCard(gpus[0]) : card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, gpu.reason || 'Not read on this PC.')),
        card([h('h2', {}, 'CPU and case fans')],
          h('p', { class: 'faint', style: { margin: 0 } }, "Run by the motherboard's BIOS curve. Guide: docs\\FANS.md"))));
  },
};
