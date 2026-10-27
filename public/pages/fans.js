// The PC page (id 'fans': it began as the Fans page, 20 Oct 2026). The graphics card's temperature, fan, load and power
// (helpers/gpu.js, NVIDIA's own nvidia-smi), refreshed every 2 s while this page is open and never in the background.
// Fan speeds stay on the motherboard's own curve (its BIOS; docs/FANS.md); DeviceHub only reads them.
// Fan lights (23 Oct 2026, Shawn: fan colours "why isnt it shown in here, it should"): the lights OpenRGB sees on fans,
// fan hubs, coolers and the board's fan headers, each with a colour and Undo (the same backed-up, read-back path as
// Lighting > PC lights, helpers/openrgb.js). When OpenRGB sees none, it says why for this PC and what fixes it.
import { h } from '../ui/dom.js';
import { card, row, loadingCard, button, pill, offSwatch, isOff, OFF } from '../ui/controls.js';
import { toast } from '../ui/overlay.js';
import { SWATCHES } from '../core/color.js';
import { helpHere } from '../ui/get-help.js';
import { boardLights } from '../ui/board-lights.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';
// Temperatures and fans, and the PC check (24 Oct 2026, docs/handoff/display-health.md): this page became "PC" so the
// readings, the fans and the check of the whole PC are one place in the sidebar (Settings > Health stays about DeviceHub)
import { tempsCard, pcCheckCard, cpuCard, chipCard } from '../ui/pc-health.js';

const DEMO = { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 62, fanPct: 38, loadPct: 71, powerW: 142, powerLimitW: 200, memUsedMB: 6100, memTotalMB: 12282, clockMHz: 2610, headroomC: 22 }] };
let gpu = null, error = null, timer = null, lastGpuSig = '', rerender = () => {};
// the temperature over the last 2 minutes, kept only while the page is open (one reading every 3 s)
let history = [];

async function load() {
  if (isDemo()) { gpu = { ...DEMO, gpus: [{ ...DEMO.gpus[0], tempC: 60 + Math.round(Math.random() * 5) }] }; }
  else try { gpu = await env.api('/api/gpu'); error = null; } catch (e) { error = e.message; }
  const t = gpu?.gpus?.[0]?.tempC; if (t != null) { history.push(Math.round(t)); if (history.length > 40) history.shift(); }
  const sig = JSON.stringify([gpu, error]);
  if (sig !== lastGpuSig) { lastGpuSig = sig; rerender(); }
}
// refresh while the page is open; stop as soon as it is left
function keepFresh() {
  if (timer) return;
  timer = setInterval(() => { if (location.hash !== '#/fans' || document.hidden) { clearInterval(timer); timer = null; history = []; return; } load(); }, 3000);
}

// the same card as the processor's (ui/pc-health.js chipCard, 24 Oct 2026: one look for both)
function gpuCard(g) {
  return chipCard({
    title: 'Graphics card', name: g.name.replace(/^NVIDIA (GeForce )?/i, ''), tempC: g.tempC, loadPct: g.loadPct, history, everyS: 2,
    fan: { pct: g.fanPct, value: g.fanPct == null ? '—' : g.fanPct === 0 ? 'Stopped' : `${g.fanPct}%`, label: 'fans' },
    rows: [['Power', g.powerW == null ? null : `${Math.round(g.powerW)} of ${Math.round(g.powerLimitW || 0)} W`],
      ['Headroom', g.headroomC == null ? null : `${g.headroomC} °C before it slows`],
      ['Video memory', g.memUsedMB == null ? null : `${(g.memUsedMB / 1024).toFixed(1)} of ${(g.memTotalMB / 1024).toFixed(0)} GB`]],
  });
}

// ---------- fan lights (OpenRGB) ----------
const DEMO_LIGHTS = () => ({ running: true, protocol: 3, controllers: [
  { index: 0, name: 'B450 AORUS PRO WIFI-CF', vendor: 'Gigabyte', type: 'motherboard', zones: [{ name: 'Motherboard', leds: 5 }, { name: 'D_LED1 header', leds: 30 }], leds: 35, color: '#ff6a1a', same: true },
  { index: 2, name: 'ARGB fan hub', vendor: 'Generic', type: 'cooler', zones: [{ name: 'Fan 1', leds: 12 }, { name: 'Fan 2', leds: 12 }, { name: 'Fan 3', leds: 12 }], leds: 36, color: '#3fe0ff', same: true }] });
let lights = null, board = null, diag = null, lightsBusy = false, lightsAsked = false;
// a light on fans: a cooler, fan hub, case or LED strip, a zone named for fans or a fan header, or the board itself
// (its RGB / ARGB headers are where most case fans plug in)
const FANISH = /fan|argb|d_led|d-led|digital|header|hub|commander|lighting node|cooler|aio|pump|ring/i;
const fanLights = (o) => (o?.controllers || []).filter((c) => ['cooler', 'led strip', 'case', 'motherboard'].includes(c.type) || FANISH.test(c.name) || c.zones?.some((z) => FANISH.test(z.name)));
async function loadLights(fresh = false) {
  lightsAsked = true;
  if (isDemo()) { lights = lights || DEMO_LIGHTS(); board = 'Gigabyte B450 AORUS PRO WIFI'; rerender(); return; }
  try {
    const [o, pc] = await Promise.all([env.api(`/api/openrgb${fresh ? '?fresh=1' : ''}`), board ? null : env.api('/api/pc').catch(() => null)]);
    lights = o;
    // why none show, from the board and USB devices against OpenRGB's own list (helpers/lights-diagnose.js; read-only)
    diag = fanLights(o).length ? null : await env.api('/api/lights/diagnose').catch(() => null);
    if (pc?.board) board = [pc.board.maker?.replace(/Technology|Co\.|Ltd\.?|Inc\.?|Corporation|International|Computer|,/gi, '').replace(/\s+/g, ' ').trim(), pc.board.model?.replace(/-CF$/, '')].filter(Boolean).join(' ');
  } catch (e) { lights = { running: false, reason: e.message, controllers: [] }; }
  rerender();
}
async function setFan(c, hex) {
  if (lightsBusy) return;
  if (isDemo()) { c.color = hex; c.same = true; rerender(); return; }
  lightsBusy = true; rerender();
  try { await env.api('/api/openrgb/color', { target: c.index, hex }); toast(`${c.name}: ${isOff(hex) ? 'off' : hex}`, 'good'); }
  catch (e) { toast('Fan lights not changed', 'bad', { detail: e.message }); }
  lightsBusy = false; loadLights(true);
}
async function undoFans() {
  if (isDemo()) { lights = DEMO_LIGHTS(); rerender(); return; }
  try { await env.api('/api/openrgb/restore', {}); toast('Fan lights undone', 'good'); } catch (e) { toast('Nothing to undo', 'bad', { detail: e.message }); }
  loadLights(true);
}
// why no fan light shows, for this PC (helpers/lights-diagnose.js, the same answer as Lighting > PC lights): where the
// fan lights sit (a USB controller the OpenRGB inside DeviceHub reaches, the board's SMBus that needs the person's own
// OpenRGB with PawnIO, or nothing a PC can reach) and each problem with its fix; then Get help for lights
function whyNone(o) {
  const d = diag && !diag.isolated ? diag : null;
  const b = d?.board || board || 'your motherboard';
  // not looked yet (OpenRGB not started): only the button, no fixes for problems not known yet
  if (!o?.running && (!d || d.openrgb?.reason === 'not running')) return [h('p', { class: 'faint fan-why' }, 'Press Find lights.')];
  const kind = d?.verdict?.kind || (o?.bundled ? 'smbus' : null);
  const head = kind === 'usb' ? `${b}: should show after Find lights.`
      : kind === 'smbus' ? `${b}: press Add board lights for its fan headers.`
        : kind === 'none' ? 'No controller found. Fans may be on a hub, or not RGB.'
          : `OpenRGB sees no fan lights on ${b}.`;
  // the fix as one button (22 Oct 2026, Shawn: "I want the app to be able to set it up"): PawnIO if missing, and the
  // OpenRGB inside DeviceHub as administrator, behind Windows' own prompt (helpers/board-lights.mjs, ui/board-lights.js)
  const fix = kind === 'smbus' || !kind ? h('div', { class: 'fan-fix' },
    boardLights({ redraw: rerender, onDone: (r) => { if (r?.ok) { lights = null; diag = null; loadLights(true); } } })) : null;
  return [h('p', { class: 'faint fan-why' }, head),
    ...(d?.problems || []).map((x) => h('p', { class: 'faint fan-why' }, h('b', {}, `${x.problem}. `), `${x.why} Fix: ${x.fix}`)),
    fix,
    h('p', { class: 'faint fan-why' }, "Hub with a remote? Plug its 3-pin M/B cable into the board's D_LED header (never the 4-pin one), then press M/B.")];
}
function fanLightsCard() {
  if (!lightsAsked) queueMicrotask(() => loadLights());
  const o = lights, list = fanLights(o);
  const head = [h('h2', {}, 'Fan lights'), h('span', { class: 'spacer' }),
    list.length ? button('Undo', undoFans, { kind: 'ghost small', ic: 'undo' }) : null,
    button('Find lights', () => { lights = null; diag = null; rerender(); loadLights(true); }, { kind: 'ghost small', ic: 'refresh' })];
  if (!o) return loadingCard('Fan lights', 2);
  return card(head,
    o.readOnly && list.length ? h('p', { class: 'faint fan-why' }, `${o.readOnly}.`) : null,
    ...(list.length ? list.map((c) => h('div', { class: 'fan-light' },
      h('div', { class: 'fan-light-name' }, h('b', {}, c.name),
        c.type !== 'motherboard' && c.zones?.length ? h('small', { class: 'faint' }, `${c.zones.length} ${c.zones.length === 1 ? 'zone' : 'zones'}`) : null),
      h('div', { class: 'swatches compact' },
        ...SWATCHES.map((x) => h('button', { class: `swatch${c.same && c.color === x ? ' on' : ''}`, style: { '--s': x }, 'aria-label': `${c.name}: ${x}`, disabled: lightsBusy || !!o.readOnly, onclick: () => setFan(c, x) })),
        h('input', { type: 'color', class: 'swatch-custom', 'aria-label': `${c.name}: pick a colour`, value: c.color && !isOff(c.color) ? c.color : '#ffffff', disabled: lightsBusy || !!o.readOnly, onchange: (e) => setFan(c, e.target.value) }),
        offSwatch({ on: c.same && isOff(c.color), label: c.name, disabled: lightsBusy || !!o.readOnly, onclick: () => setFan(c, OFF) }))))
      : whyNone(o)),
    row('Fan speed', 'Set by the BIOS fan curve.', pill('BIOS')));
}

const tag = (el, cls) => { el.classList.add(cls); return el; };

export default {
  id: 'fans', title: 'PC', icon: 'fan', accent: 'var(--signal)',
  watches: [],  // its own 2 s reading redraws it; a device's readings do not (21 Oct 2026)
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/fans') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!gpu && !error) queueMicrotask(load);
    keepFresh();
    const gpus = gpu?.available ? gpu.gpus : [];
    return h('div', {},
      // Get help (area fans: the graphics card, the lights check, the page's red lines), top right
      topbar('Temperatures, fans and checks', 'PC', null, null, helpHere('fans')),
      // the whole page fits the window at 1650x950 (Shawn, 24 Oct 2026): the graphics card and the processor down the left,
      // the PC check across the two right columns under Fan lights and Temperatures (style.css .pc-grid; one column on a phone)
      h('div', { class: 'grid pc-grid' },
        tag(error ? card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, `Not read: ${error}`))
          : !gpu ? loadingCard('Graphics card', 4)
            : gpus.length ? gpuCard(gpus[0]) : card([h('h2', {}, 'Graphics card')], h('p', { class: 'faint' }, gpu.reason || 'Not read on this PC.')), 'pc-gpu'),
        tag(cpuCard(), 'pc-cpu'),
        tag(tempsCard(rerender, 'fans'), 'pc-temps'),
        tag(pcCheckCard(rerender), 'pc-check')));
  },
};
