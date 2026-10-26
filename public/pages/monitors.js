// Monitors (20 Oct 2026): brightness, contrast, speaker volume, color preset and color balance of each monitor, over DDC/CI
// (helpers/monitors.js). Each change is backed up, written one at a time and read back on the server.
import { h, icon } from '../ui/dom.js';
import { card, row, slider, segmented, loadingCard, button } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { toast } from '../ui/overlay.js';
import { cameraCards } from './camera-card.js';
import { helpHere } from '../ui/get-help.js';
// resolution, refresh rate, HDR, main screen and Night light per screen (24 Oct 2026, ui/display-settings.js)
import { displayBlock, displayOnlyScreens, displayBlockFor, displayError } from '../ui/display-settings.js';

let list = null, error = null, loading = false;
let rerender = () => {};

// No redraw while a slider is held (24 Oct 2026, Shawn: "when trying to change colors it stops it mid movement on the
// bar"): this page redraws itself (a fresh monitor read after a color change, the display and camera blocks), which
// replaced the slider under the pointer mid-drag. A redraw asked for then waits for the release; an open dropdown
// list holds it the same way.
let dragging = false, listOpen = false, heldRedraw = false;
const redraw = () => { if (dragging || listOpen) { heldRedraw = true; return; } rerender(); };
const letGo = () => { if (dragging || listOpen || !heldRedraw) return; heldRedraw = false; setTimeout(redraw, 0); };
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('#main input[type=range]')) dragging = true; }, true);
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { if (dragging) { dragging = false; letGo(); } }, true);
addEventListener('dropdown-open', () => { listOpen = true; });
addEventListener('dropdown-closed', () => { listOpen = false; letGo(); });

// shown at once from DeviceHub's last reading, then read again in the background when that came back quicker than any
// DDC/CI read can (helpers/monitors.js list): the page never waits on the monitors when a reading exists
let refreshed = 0;
async function load(fresh) {
  if (loading) return; loading = true;
  const t = Date.now();
  try {
    list = await env.api(`/api/monitors${fresh ? '?fresh=1' : ''}`); error = null;
    if (!fresh && Date.now() - t < 300 && Date.now() - refreshed > 10000) { refreshed = Date.now(); setTimeout(() => load(true), 0); }
  }
  catch (e) { error = e.message; }
  finally { loading = false; if (fresh) refreshed = Date.now(); redraw(); }
}

// a slider step while dragging: the screen follows (21 Oct 2026); no message, the release confirms the final value
// a color balance step can first switch the monitor to its Custom preset (helpers/monitors.js customFirst): the release's
// message says so once
const switched = new Set();
const live = (m, feature) => (value) => env.api('/api/monitors/set', { id: m.id, feature, value, live: true })
  .then((r) => { if (r?.presetSwitched) switched.add(m.id); }).catch(() => {});

async function set(m, feature, value, label) {
  try {
    const r = await env.api('/api/monitors/set', { id: m.id, feature, value });
    const sw = r.presetSwitched || (switched.delete(m.id) ? 'Custom' : null);
    toast(r.waiting ? `${m.name}: ${label}, applied when it is on` : `${m.name}: ${label}${sw ? ` (preset set to ${sw})` : ''}`, r.waiting ? 'info' : 'good');
    if (m[feature]) m[feature].value = r.value;
    if (r.waiting) { load(false); return; }
    // a color balance change can move the monitor to its User preset by itself (the Acer VG272UV does, measured 20 Oct
    // 2026): read it again so the preset shown is the one it is on
    if (BALANCE.some(([k]) => k === feature)) load(true);
  } catch (e) { toast(`${m.name}: not changed`, 'bad', { detail: e.message }); load(true); }
}

function monitorCard(m) {
  // a laptop's own screen: brightness through Windows (helpers/monitor-wmi.js; 22 Oct 2026, Shawn: "on my laptop it says
  // turn on ddc/ci in this monitors menu")
  if (m.builtin) return card([icon('monitor'), h('h2', {}, m.name)],
    row('Brightness', null, slider({ value: m.brightness.value, min: 0, max: 100, unit: '%', onCommit: (v) => set(m, 'brightness', v, `brightness ${v}`) })),
    displayBlock(m, redraw));
  if (!m.ddc) return card([h('h2', {}, m.name)], h('p', { class: 'faint' }, 'No DDC/CI. Turn it on in the monitor\'s menu.'),
    displayBlock(m, redraw));
  return card([icon('monitor'), h('h2', {}, m.name), h('span', { class: 'sub' }, m.model && m.model !== m.name ? m.model : null)],
    // off or not answering (21 Oct 2026): its last settings stay here and changes wait for it
    m.away || m.waiting?.length ? h('p', { class: 'faint', style: { margin: '0 0 8px' } }, m.away ? 'Off: changes apply when it is on.' : 'Waiting…', m.waiting?.length ? ` Waiting: ${m.waiting.join(', ')}.` : '') : null,
    m.brightness ? row('Brightness', null, slider({ value: m.brightness.value, min: 0, max: m.brightness.max, unit: m.brightness.max === 100 ? '%' : '', live: live(m, 'brightness'), onCommit: (v) => set(m, 'brightness', v, `brightness ${v}`) })) : null,
    m.contrast ? row('Contrast', null, slider({ value: m.contrast.value, min: 0, max: m.contrast.max, unit: m.contrast.max === 100 ? '%' : '', live: live(m, 'contrast'), onCommit: (v) => set(m, 'contrast', v, `contrast ${v}`) })) : null,
    m.volume ? row('Speaker volume', null, slider({ value: m.volume.value, min: 0, max: m.volume.max, unit: m.volume.max === 100 ? '%' : '', live: live(m, 'volume'), onCommit: (v) => set(m, 'volume', v, `speaker volume ${v}`) })) : null,
    // the standard picture settings it lists (20 Oct 2026): color preset in view, the color balance folded under More
    m.colorPreset?.options?.length ? row('Color preset', null, segmented({ value: m.colorPreset.value, compact: true, options: m.colorPreset.options,
      onCommit: (v) => set(m, 'colorPreset', v, `color preset ${m.colorPreset.options.find((o) => o.value === v)?.label || v}`) })) : null,
    colorBalance(m),
    displayBlock(m, redraw),
    supportsList(m));
}

// What this monitor says it supports (22 Oct 2026, Shawn: "why cant I change gamma or other settings on my agon
// monitor?"): read-only, from its own capabilities, so it is plain what DeviceHub controls, what the monitor opens to the
// PC that DeviceHub does not control yet, and what is the maker's own (only its menu or app changes those)
function supportsList(m) {
  const all = m.supports || [];
  if (!all.length) return null;
  const group = (title, items, note) => (items.length ? h('div', { class: 'mon-sup-group' }, h('h4', {}, title, h('span', { class: 'faint' }, ` ${items.length}`)),
    note ? h('p', { class: 'faint' }, note) : null,
    h('div', { class: 'mon-sup-chips' }, ...items.map((x) => h('span', { class: 'mon-sup' }, x.name || 'Unnamed', h('code', {}, x.code), x.values.length ? h('small', {}, `${x.values.length} options`) : null)))) : null);
  const named = (x) => x.state === 'not yet' && x.name;
  return h('details', { class: 'mon-supports' },
    h('summary', {}, `What this monitor supports (${all.length})`),
    group('Controlled here', all.filter((x) => x.state === 'controlled')),
    group('Could be added', all.filter(named)),
    group('Information only', all.filter((x) => x.state === 'info')),
    group('Left out on purpose', all.filter((x) => x.state === 'left out'), 'Never sent.'),
    group("The maker's own", all.filter((x) => x.state === 'maker' || (x.state === 'not yet' && !x.name)), "Set in the monitor's menu."));
}

// red / green / blue gain, and black levels where the monitor has them: one "Color balance" fold per monitor, closed
// by default and remembered for the session (24 Oct 2026, Shawn: "just make the red green blue ones a dropdown also")
const BALANCE = [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['blackRed', 'Red black'], ['blackGreen', 'Green black'], ['blackBlue', 'Blue black']];
const CUSTOM = [11, 12, 13];
const foldKey = (m) => `dh-mon-balance-${m.id}`;
const foldOpen = (m) => { try { return sessionStorage.getItem(foldKey(m)) === '1'; } catch { return false; } };
function colorBalance(m) {
  // measured refusing a gain even on Custom (helpers/monitors.js noColor)
  if (m.noColor) return h('p', { class: 'faint mon-nocolor' }, "This monitor doesn't take color changes from the PC.");
  const rows = BALANCE.filter(([k]) => m[k]).map(([k, label]) => row(label, null, slider({ value: m[k].value, min: 0, max: m[k].max, label: `${m.name} ${label}`, live: live(m, k), onCommit: (v) => set(m, k, v, `${label.toLowerCase()} ${v}`) })));
  if (!rows.length) return null;
  const toCustom = m.colorPreset && !CUSTOM.includes(m.colorPreset.value) && m.colorPreset.options?.some((o) => CUSTOM.includes(o.value));
  const fold = h('details', { class: 'mon-balance', open: foldOpen(m) || undefined },
    h('summary', {}, 'Color balance'),
    toCustom ? h('p', { class: 'faint mon-balance-note' }, 'Changing these sets the preset to Custom.') : null,
    h('div', { class: 'mon-balance-rows' }, ...rows));
  fold.addEventListener('toggle', () => { try { sessionStorage.setItem(foldKey(m), fold.open ? '1' : '0'); } catch {} });
  return fold;
}

async function sleepMonitors() {
  if (isDemo()) { toast('Demo: putting monitors to sleep', 'info'); return; }
  toast('Putting monitors to sleep in 1s...', 'info');
  try {
    const r = await env.api('/api/monitors/sleep', {});
    if (!r?.ok && r?.error) toast(`Sleep failed: ${r.error}`, 'bad');
  } catch (e) {
    toast(`Sleep failed: ${e.message}`, 'bad');
  }
}

export default {
  id: 'monitors', title: 'Monitors', icon: 'monitor', accent: 'var(--signal)',
  watches: [],  // monitors and the camera are read by the page itself; device readings do not redraw it (21 Oct 2026)
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/monitors') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    const sleepBtn = button('Sleep', sleepMonitors, { kind: 'ghost small', ic: 'sleep', title: 'Put monitors to sleep' });
    if (isDemo()) return h('div', {}, topbar('Displays and camera', 'Monitors', null, sleepBtn, helpHere('monitors')), card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, 'Not shown in demo mode.')));
    if (!list && !error) load(false);
    else if (list && !loading && Date.now() - refreshed > 10000) { refreshed = Date.now(); queueMicrotask(() => load(true)); }
    return h('div', {},
      // Get help (area monitors: each monitor's DDC/CI answer and the camera's settings), top right
      topbar('Displays and camera', 'Monitors', null, sleepBtn, helpHere('monitors')),
      // the monitors and the camera side by side on one screen (23 Oct 2026, Shawn: "I want the lighting area non
      // scrollable if possible, same with monitors"); no card scrolls (24 Oct: Color balance folds, rows compact)
      h('div', { class: 'grid mon-cols top', style: { '--n': (list?.length || 2) + 1 } },
        ...(error ? [card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, `Monitors not read: ${error}`))]
          // while they are read: two monitor cards with shimmering rows (21 Oct 2026)
          : !list ? [loadingCard('Monitor', 4, 'monitor'), loadingCard('Monitor', 4, 'monitor')]
            : list.length ? [...list.map(monitorCard), ...displayOnlyScreens(list).map((s) => card([icon('monitor'), h('h2', {}, s.name)], displayBlockFor(s)))]
              : [card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, 'No monitors found.'))]),
        displayError() ? card([h('h2', {}, 'Display settings')], displayError()) : null,
        ...cameraCards(redraw)));
  },
};
