// Mouse page: DPI stages on a track, performance settings, device info.
import { h, icon, fmt } from '../ui/dom.js';
import { card, row, toggle, segmented, slider, stepper, button, pill } from '../ui/controls.js';
import { batteryCell, loadBatteryEstimates } from '../ui/controls.js';
import { dropdown } from '../ui/dropdown.js';
import { devices, write, isDemo, prepare } from '../core/devices.js';
import { toast, modal } from '../ui/overlay.js';
import { mouseArt } from '../ui/art.js';
import { dots, signal } from '../ui/gauges.js';
import { topbar, connectState, deviceActions, kv, statusPill, isAway, awayBanner, undoButton, deviceHelp } from './common.js';
import { POLLING, LIFT_OFF, DPI_SLOTS, DPI_MAX, snapDpi, BUTTONS, ACTIONS } from '../devices/mouse-adapter.js';
import { parseKeys, MAX_COMBO_KEYS } from '../devices/pulsar.js';
import { batteryChart } from '../ui/battery-chart.js';
import { pollingTest } from '../ui/polling-test.js';

const d = () => devices.mouse;

// Windows pointer settings: these live in Windows, not on the mouse (server: /api/pointer).
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
function pointerCard(redraw) {
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
const set = (key, value, label, display) => write('mouse', key, value, { label, display }).catch(() => {});
const locked = (key) => d().adapter.trusted && !d().adapter.trusted(key);

// Log scale so 400 and 26000 both read well.
// Auto sleep stops (21 Oct 2026, Shawn: "its currently hard to select the auto sleep"): 10 s to 30 min in 10 s steps was 179
// positions in one short bar; the slider now stops only on these times, finer where small changes matter. The mouse's
// own value is one of the stops even when it is not in this list, so the slider always shows what the mouse has.
const SLEEP_STOPS = [10, 20, 30, 40, 50, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 720, 900, 1200, 1500, 1800];
const sleepStops = (cur) => (cur == null || SLEEP_STOPS.includes(cur) ? SLEEP_STOPS : [...SLEEP_STOPS, cur].sort((a, b) => a - b));
const sleepText = (sec) => (sec == null ? '—' : sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);
const pos = (dpi) => (Math.log(dpi / 50) / Math.log(DPI_MAX / 50)) * 100;

function dpiTrack(v, count) {
  const ticks = [100, 400, 800, 1600, 3200, 6400, 12800, 26000];
  const active = (v.dpiStage || 1) - 1;
  // Pins closer than ~3.5% of the track stack upward so their labels never overlap.
  const placed = [];
  const pins = Array.from({ length: DPI_SLOTS }, (_, i) => v[`dpi${i}`]).map((dpi, i) => {
    if (dpi == null) return null;
    const x = pos(dpi);
    const level = placed.filter((p) => Math.abs(p - x) < 3.5).length;
    placed.push(x);
    return h('div', { class: `dpi-pin${i === active ? ' on' : ''}${count && i >= count ? ' off' : ''}`, style: { left: `${x}%`, zIndex: i === active ? 5 : 1, '--lift': `${level * 22}px` }, title: `Stage ${i + 1}: ${dpi} DPI` }, h('b', {}, i + 1), h('i'));
  });
  return h('div', { class: 'dpi-track' },
    h('div', { class: 'dpi-axis' }),
    ...ticks.map((t) => h('div', { class: 'dpi-tick', style: { left: `${pos(t)}%` } }, t >= 1000 ? `${t / 1000}k` : t)),
    ...pins);
}

function stageCard(v, i, count) {
  const dpi = v[`dpi${i}`];
  const active = (v.dpiStage || 1) - 1 === i;
  const unused = count && i >= count;
  return h('div', { class: `stage${active ? ' on' : ''}${unused ? ' unused' : ''}` },
    h('div', { class: 'stage-top' }, h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      v[`color${i}`] ? h('input', { type: 'color', value: v[`color${i}`], title: `Stage ${i + 1} light color`, 'aria-label': `Stage ${i + 1} light color`, disabled: locked(`color${i}`) ? true : null, style: { width: '18px', height: '18px', padding: 0, border: 0, background: 'none', cursor: 'pointer' }, onchange: (e) => set(`color${i}`, e.target.value, `Stage ${i + 1} color`, e.target.value) }) : null,
      `Stage ${i + 1}`), active ? pill('active', 'accent') : unused ? h('span', { title: 'Likely outside the cycle' }, 'spare') : null),
    stepper({ value: dpi, min: 50, max: DPI_MAX, step: 50, disabled: dpi == null, label: `DPI stage ${i + 1}`, onCommit: (n) => set(`dpi${i}`, snapDpi(n), `DPI stage ${i + 1}`, `${fmt(snapDpi(n))} DPI`) }),
    active ? h('div', { class: 'faint', style: { fontSize: '12px', textAlign: 'center' } }, 'in use now')
      : unused ? h('div', { class: 'faint', style: { fontSize: '12px', textAlign: 'center' }, title: 'Set by "stages in cycle" above.' }, 'outside the cycle')
        : button('Use', () => set('dpiStage', i + 1, 'Active DPI stage', `stage ${i + 1} (${fmt(dpi)} DPI)`), { kind: 'ghost small', disabled: locked('dpiStage') }));
}

// Keyboard keys a mouse button can send (USB keyboard codes, as the Pulsar app stores them; learned 19 Oct 2026).
const KEY_GROUPS = [
  ['Modifiers', [[0xe0, 'Ctrl'], [0xe1, 'Shift'], [0xe2, 'Alt'], [0xe3, 'Win']]],
  ['Letters', Array.from({ length: 26 }, (_, i) => [0x04 + i, String.fromCharCode(65 + i)])],
  ['Numbers', [...Array.from({ length: 9 }, (_, i) => [0x1e + i, String(i + 1)]), [0x27, '0']]],
  ['Keys', [[0x28, 'Enter'], [0x29, 'Esc'], [0x2a, 'Backspace'], [0x2b, 'Tab'], [0x2c, 'Space'], [0x46, 'Print Screen'], [0x49, 'Insert'], [0x4c, 'Delete'],
    [0x4a, 'Home'], [0x4d, 'End'], [0x4b, 'Page Up'], [0x4e, 'Page Down'], [0x52, 'Up'], [0x51, 'Down'], [0x50, 'Left'], [0x4f, 'Right']]],
  ['Function', Array.from({ length: 12 }, (_, i) => [0x3a + i, `F${i + 1}`])],
  ['Symbols', [[0x2d, '-'], [0x2e, '='], [0x2f, '['], [0x30, ']'], [0x31, '\\'], [0x33, ';'], [0x34, "'"], [0x35, '`'], [0x36, ','], [0x37, '.'], [0x38, '/']]],
];
const KEY_NAME = Object.fromEntries(KEY_GROUPS.flatMap(([, keys]) => keys));
const keysText = (v) => (parseKeys(v) || []).map((c) => KEY_NAME[c] || `key ${c}`).join(' + ');

// Pick a keyboard key or a key combination (up to 5 keys, pressed in the order picked) for one button.
async function pickKeys(btnName, current) {
  const chosen = [...(parseKeys(current) || [])];
  const shown = h('div', { class: 'combo-now' });
  const paint = () => shown.replaceChildren(chosen.length ? h('b', {}, chosen.map((c) => KEY_NAME[c]).join(' + ')) : h('span', { class: 'faint' }, 'Up to 5 keys, in order.'),
    chosen.length ? button('Clear', () => { chosen.length = 0; paint(); }, { kind: 'ghost small' }) : null);
  const body = h('div', { class: 'combo-pick' }, shown,
    ...KEY_GROUPS.map(([group, keys]) => h('div', { class: 'combo-group' }, h('span', { class: 'faint' }, group),
      h('div', { class: 'combo-keys' }, ...keys.map(([code, name]) => h('button', { class: 'pk', onclick: () => {
        const at = chosen.indexOf(code);
        if (at >= 0) chosen.splice(at, 1); else if (chosen.length < MAX_COMBO_KEYS) chosen.push(code);
        paint();
      } }, name))))));
  paint();
  const ok = await modal(`${btnName}: keyboard keys`, body, [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'primary' }]);
  if (!ok || !chosen.length) return null;
  return `keys:${chosen.map((c) => c.toString(16).padStart(2, '0')).join(',')}`;
}

// Buttons laid out around the mouse: left column = left-hand buttons, right column = right-hand ones.
function buttonsPanel(v) {
  const sel = (i) => {
    const cur = v[`btn${i}`];
    if (i === 0) return h('div', { class: 'btnmap' }, h('b', {}, BUTTONS[0]), h('span', { class: 'locked' }, icon('shield'), 'always left click'));
    if (cur == null) return h('div', { class: 'btnmap' }, h('b', {}, BUTTONS[i]), h('span', { class: 'locked' }, 'not readable'));
    const isKeys = !!parseKeys(cur);
    const s = dropdown({ label: BUTTONS[i], value: cur, options: [
      ...Object.entries(ACTIONS).filter(([k]) => k !== 'left').map(([k, a]) => ({ value: k, label: a.label })),
      isKeys ? { value: cur, label: `Keys: ${keysText(cur)}` } : null,
      { value: 'pick-keys', label: isKeys ? 'Change keyboard keys…' : 'Keyboard keys…' }] });
    const wrap = h('div', { class: 'btnmap' }, h('b', {}, BUTTONS[i]), s);
    s.addEventListener('change', async () => {
      let val = s.value;
      if (val === 'pick-keys') { val = await pickKeys(BUTTONS[i], isKeys ? cur : null); if (!val) { s.value = cur; return; } }
      if (val === cur) return;
      wrap.classList.add('pending');
      await set(`btn${i}`, val, BUTTONS[i], parseKeys(val) ? keysText(val) : ACTIONS[val].label);
      wrap.classList.remove('pending');
    });
    return wrap;
  };
  return card([h('h2', {}, 'Buttons')],
    h('div', { class: 'btn-layout' },
      h('div', { class: 'btn-col' }, sel(0), sel(3), sel(4)),
      h('div', { class: 'btn-art' }, mouseArt()),
      h('div', { class: 'btn-col' }, sel(1), sel(2), sel(5))));
}

export default {
  id: 'mouse', title: 'Mouse', icon: 'mouse', device: 'mouse', accent: 'var(--c-mouse)', watches: ['mouse'],
  render() {
    const redraw = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/mouse') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    loadBatteryEstimates(() => redraw());
    const dev = d();
    const a = dev.adapter;
    const head = topbar('Pulsar · 8K wireless mouse', a.title, null, h('div', { class: 'chips' }, undoButton(dev), statusPill(dev)), deviceHelp(dev));
    if (dev.status !== 'connected' && !isAway(dev)) {
      return h('div', {}, head, connectState(dev, 'Plug in the dongle, press Connect, pick "Pulsar 8K Dongle". Close the Pulsar app first.'));
    }
    const v = dev.values;
    const count = v.stageCount;
    const activeDpi = v[`dpi${(v.dpiStage || 1) - 1}`];
    const bat = dev.battery;
    return h('div', {}, head,
      awayBanner(dev),
      h('section', { class: 'hero' },
        h('div', {},
          h('div', { class: 'hero-stats' },
            bat ? batteryCell({ id: 'mouse', percent: bat.percent, charging: bat.charging, big: true, reported: bat.reported }) : null,
            dots({ n: v.dpiStage, of: v.stageCount || 4, value: fmt(activeDpi), label: `DPI · stage ${v.dpiStage ?? '—'}`, big: true }),
            signal({ hz: v.pollingRate, big: true }),
            h('div', { class: 'stat' }, h('b', {}, LIFT_OFF[v.liftOff] || '—'), h('span', {}, 'lift-off')),
            h('div', { class: 'stat' }, h('b', {}, v.debounce != null ? `${v.debounce}` : '—'), h('span', {}, 'ms debounce')),
            null)),
        // no drawing here: the Buttons card below has the big one (Shawn, 19 Oct 2026)
        null),
      h('div', { class: 'stack' },
        buttonsPanel(v),
        h('div', { class: 'grid two' },
          // Tracking: the choices and the slider first, then the on/off switches
          card([h('h2', {}, 'Tracking')],
            row('Polling rate', 'Higher uses more battery.',
              segmented({ value: v.pollingRate, compact: true, disabled: locked('pollingRate'), options: Object.keys(POLLING).map(Number).map((hz) => ({ value: hz, label: hz >= 1000 ? `${hz / 1000}K` : String(hz) })), onCommit: (hz) => set('pollingRate', hz, 'Polling rate', `${hz} Hz`) })),
            row('Lift-off distance', 'How high it tracks when lifted.',
              segmented({ value: v.liftOff, disabled: locked('liftOff'), options: [3, 1, 2].map((c) => ({ value: c, label: LIFT_OFF[c] })), onCommit: (c) => set('liftOff', c, 'Lift-off distance', LIFT_OFF[c]) })),
            row('Debounce', 'Lower = faster clicks.',
              slider({ value: v.debounce, min: 0, max: 15, unit: ' ms', disabled: locked('debounce'), grab: () => prepare('mouse'), onCommit: (ms) => set('debounce', ms, 'Debounce', `${ms} ms`) })),
            row('Motion sync', 'Smoother, slight delay.', toggle({ value: v.motionSync, label: 'Motion sync', disabled: locked('motionSync'), onCommit: (on) => set('motionSync', on, 'Motion sync', on ? 'on' : 'off') })),
            row('Angle snapping', 'Straightens lines. Usually off.', toggle({ value: v.angleSnap, label: 'Angle snapping', disabled: locked('angleSnap'), onCommit: (on) => set('angleSnap', on, 'Angle snapping', on ? 'on' : 'off') })),
            row('Ripple control', 'Smooths jitter at high DPI.', toggle({ value: v.ripple, label: 'Ripple control', disabled: locked('ripple'), onCommit: (on) => set('ripple', on, 'Ripple control', on ? 'on' : 'off') }))),
          // Power & light
          card([h('h2', {}, 'Power & light')],
            row('Auto sleep', null, (() => { const stops = sleepStops(v.sleep); return slider({ value: v.sleep == null ? null : stops.indexOf(v.sleep), min: 0, max: stops.length - 1, step: 1, format: (i) => sleepText(stops[i]), disabled: locked('sleep'), grab: () => prepare('mouse'), onCommit: (i) => set('sleep', stops[i], 'Auto sleep', sleepText(stops[i])) }); })()),
            row('DPI light', null, segmented({ value: v.dpiEffect, disabled: locked('dpiEffect'), options: [{ value: 'off', label: 'Off' }, { value: 'steady', label: 'Steady' }, { value: 'breathing', label: 'Breathing' }], onCommit: (e) => set('dpiEffect', e, 'DPI light', e) })),
            // brightness applies to steady and speed to breathing, as in the Pulsar app
            v.dpiEffect === 'steady' ? row('Light brightness', null, slider({ value: v.effectBrightness, min: 1, max: 10, disabled: locked('effectBrightness'), grab: () => prepare('mouse'), onCommit: (n) => set('effectBrightness', n, 'DPI light brightness', `${n} of 10`) })) : null,
            v.dpiEffect === 'breathing' ? row('Breathing speed', null, slider({ value: v.effectSpeed, min: 1, max: 5, disabled: locked('effectSpeed'), grab: () => prepare('mouse'), onCommit: (n) => set('effectSpeed', n, 'DPI light speed', `${n} of 5`) })) : null,
            row('Turbo mode', 'Hold to repeat a click.', toggle({ value: v.turbo, label: 'Turbo mode', disabled: locked('turbo'), onCommit: (on) => set('turbo', on, 'Turbo mode', on ? 'on' : 'off') })))),
        card([h('h2', {}, 'DPI stages'), h('span', { class: 'spacer' }),
          count ? h('span', { class: 'actions', style: { alignItems: 'center', gap: '8px' } }, h('span', { class: 'faint' }, 'stages in cycle'),
            stepper({ value: count, min: 1, max: DPI_SLOTS, step: 1, disabled: locked('stageCount'), label: 'DPI stages in the cycle', onCommit: (n) => set('stageCount', n, 'DPI stages in the cycle', `${n}`) })) : null],
          dpiTrack(v, count),
          h('div', { class: 'stages' }, ...Array.from({ length: DPI_SLOTS }, (_, i) => stageCard(v, i, count)))),
        // shown open, no "More" row to click first (22 Oct 2026, Shawn)
        h('div', { class: 'more-body' },
          batteryChart('mouse', redraw),
          pollingTest(v.pollingRate, card, 'mouse', '3710'),
          pointerCard(redraw),
          card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(dev)], kv(dev.info)))));
  },
};
