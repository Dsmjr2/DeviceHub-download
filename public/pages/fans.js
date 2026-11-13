// The PC page (id 'fans': it began as the Fans page, 20 Oct 2026). The graphics card's temperature, fan, load and power
// (helpers/gpu.js, NVIDIA's own nvidia-smi), refreshed every 3 s while this page is open and never in the background.
// Fan speeds stay on the motherboard's own curve (its BIOS; docs/FANS.md); DeviceHub only reads them.
// Fan lights are on Lighting > PC lights (helpers/openrgb.js); this page no longer has a card for them (25 Oct 2026).
import { h } from '../ui/dom.js';
import { card, loadingCard } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo, shownDevices } from '../core/devices.js';
import { pointerCard } from '../ui/pointer-card.js';
import { replayCard } from '../ui/replay-card.js';
import { powerCard } from '../ui/power-rows.js';
import { gamingCard } from '../ui/gaming-card.js';
import { topbar } from './common.js';
import { everyVisible } from '../core/visible-timer.js';
// Temperatures and fans, and the PC check (24 Oct 2026, docs/handoff/display-health.md): this page became "PC" so the
// readings, the fans and the check of the whole PC are one place in the sidebar (Settings > Health stays about DeviceHub)
import { tempsCard, pcCheckCard, cpuCard, chipCard } from '../ui/pc-health.js';

const DEMO = { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 62, fanPct: 38, loadPct: 71, powerW: 142, powerLimitW: 200, memUsedMB: 6100, memTotalMB: 12282, clockMHz: 2610, headroomC: 22 }] };
let gpu = null, error = null, timer = null, lastGpuSig = '', rerender = () => {};
// the temperature over the last 5 minutes, kept only while the page is open (one reading a second while it shows,
// 3 Nov 2026, Shawn: "update quick and be accurate when I have the app open or viewing that page")
let history = [];
const READ_MS = 1000, KEEP = 300;

async function load() {
  if (isDemo()) { gpu = { ...DEMO, gpus: [{ ...DEMO.gpus[0], tempC: 60 + Math.round(Math.random() * 5) }] }; }
  else try { gpu = await env.api('/api/gpu'); error = null; } catch (e) { error = e.message; }
  if (gpu?.gpus?.[0]?.idle) history = [];   // asleep: the old readings are not joined to the next ones
  const t = gpu?.gpus?.[0]?.tempC; if (t != null) { history.push(Math.round(t)); if (history.length > KEEP) history.shift(); }
  const sig = JSON.stringify([gpu, error]);
  if (sig !== lastGpuSig) { lastGpuSig = sig; rerender(); }
}
// refresh while the page is open; stop as soon as it is left. 31 Oct 2026: a hidden window only pauses it
// (core/visible-timer.js runs it again when the window is shown), and the graph starts over after the pause so it never
// joins readings minutes apart
let lastReadAt = 0;
function keepFresh() {
  if (timer) return;
  lastReadAt = Date.now();
  timer = everyVisible(() => {
    if (location.hash !== '#/fans') { timer?.(); timer = null; history = []; return; }
    if (Date.now() - lastReadAt > 2 * READ_MS) history = [];
    lastReadAt = Date.now();
    return load();
  }, READ_MS);
}

// the same card as the processor's (ui/pc-health.js chipCard, 24 Oct 2026: one look for both)
function gpuCard(g) {
  return chipCard({
    title: 'Graphics card', name: g.name.replace(/^NVIDIA (GeForce )?/i, ''), tempC: g.tempC, loadPct: g.loadPct, history: g.idle ? null : history, everyS: READ_MS / 1000,   // 31 Oct 2026: the graph's "last N" from the real reading
    // asleep (a laptop's card with nothing on it): "idle", as Acer's app says, and it is not woken to read it (helpers/gpu.js)
    tempText: g.idle ? 'idle' : null,
    fan: g.idle || g.fanPct == null ? null : { pct: g.fanPct, value: g.fanPct === 0 ? 'Stopped' : `${g.fanPct}%`, label: 'fans' },
    rows: [['Power', g.powerW == null ? null : `${Math.round(g.powerW)} of ${Math.round(g.powerLimitW || 0)} W`],
      ['Headroom', g.headroomC == null ? null : `${g.headroomC} °C before it slows`],
      ['Video memory', g.memUsedMB == null ? null : `${(g.memUsedMB / 1024).toFixed(1)} of ${(g.memTotalMB / 1024).toFixed(0)} GB`]],
  });
}

const tag = (el, cls) => { el.classList.add(cls); return el; };

export default {
  id: 'fans', title: 'PC', icon: 'fan', accent: 'var(--signal)',
  watches: [],  // its own 3 s reading redraws it; a device's readings do not (21 Oct 2026)
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/fans') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!gpu && !error) queueMicrotask(load);
    keepFresh();
    const gpus = gpu?.available ? gpu.gpus : [];
    return h('div', {},
      topbar('PC'),
      // the whole page fits the window at 1650x950 (Shawn, 24 Oct 2026): the graphics card and the processor down the left,
      // the PC check across the two right columns under Temperatures (style.css .pc-grid; one column on a phone)
      h('div', { class: 'grid pc-grid' },
        tag(error ? card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, `Not read: ${error}`))
          : !gpu ? loadingCard('Graphics card', 4)
            : gpus.length ? gpuCard(gpus[0]) : card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, gpu.reason || 'Not read on this PC.')), 'pc-gpu'),
        tag(cpuCard(), 'pc-cpu'),
        tag(tempsCard(rerender, 'fans'), 'pc-temps'),
        tag(pcCheckCard(rerender), 'pc-check')),
      // under the grid: Instant replay (2 Nov 2026, ui/replay-card.js) and, with no mouse page on this PC (none DeviceHub
      // runs), Windows' pointer settings, as they are on every mouse's page (1 Nov 2026, ui/pointer-card.js)
      // Sleep and screen (3 Nov 2026): on a PC without a battery; a laptop has them on its Laptop page
      // the grid's own gap above it (9 Nov 2026: it touched the PC check card)
      h('div', { class: 'grid two top', style: { marginTop: '16px' } }, gamingCard(rerender), replayCard(rerender), powerCard(rerender),
        shownDevices().some((x) => x.id === 'mouse' || /mouse/i.test(x.adapter?.kind || '')) ? null : pointerCard(rerender)));
  },
};
