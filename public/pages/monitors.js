// Monitors (20 Oct 2026): brightness, contrast, speaker volume, color preset and color balance of each monitor, over DDC/CI
// (helpers/monitors.js). Each change is backed up, written one at a time and read back on the server.
import { h, icon } from '../ui/dom.js';
import { card, row, slider, segmented, more, loadingCard } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { toast } from '../ui/overlay.js';
import { cameraCards } from './camera-card.js';

let list = null, error = null, loading = false;
let rerender = () => {};

async function load(fresh) {
  if (loading) return; loading = true;
  try { list = await env.api(`/api/monitors${fresh ? '?fresh=1' : ''}`); error = null; }
  catch (e) { error = e.message; }
  finally { loading = false; rerender(); }
}

// a slider step while dragging: the screen follows (21 Oct 2026); no message, the release confirms the final value
const live = (m, feature) => (value) => env.api('/api/monitors/set', { id: m.id, feature, value, live: true }).catch(() => {});

async function set(m, feature, value, label) {
  try {
    const r = await env.api('/api/monitors/set', { id: m.id, feature, value });
    toast(r.waiting ? `${m.name}: ${label}, applied when it is on` : `${m.name}: ${label}`, r.waiting ? 'info' : 'good');
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
    row('Brightness', 'Through Windows: a built-in screen has no DDC/CI.', slider({ value: m.brightness.value, min: 0, max: 100, unit: '%', onCommit: (v) => set(m, 'brightness', v, `brightness ${v}`) })));
  if (!m.ddc) return card([h('h2', {}, m.name)], h('p', { class: 'faint' }, 'This screen does not take settings from the PC. If it is a separate monitor, turn on DDC/CI in its own menu (often under Setup or Other), then come back.'));
  return card([icon('monitor'), h('h2', {}, m.name), h('span', { class: 'sub' }, m.model && m.model !== m.name ? m.model : null)],
    // off or not answering (21 Oct 2026): its last settings stay here and changes wait for it
    m.away || m.waiting?.length ? h('p', { class: 'faint', style: { margin: '0 0 8px' } }, m.away ? 'Off or not answering: changes are applied when it is on.' : 'Waiting for it to answer.', m.waiting?.length ? ` Waiting: ${m.waiting.join(', ')}.` : '') : null,
    m.brightness ? row('Brightness', null, slider({ value: m.brightness.value, min: 0, max: m.brightness.max, unit: m.brightness.max === 100 ? '%' : '', live: live(m, 'brightness'), onCommit: (v) => set(m, 'brightness', v, `brightness ${v}`) })) : null,
    m.contrast ? row('Contrast', null, slider({ value: m.contrast.value, min: 0, max: m.contrast.max, unit: m.contrast.max === 100 ? '%' : '', live: live(m, 'contrast'), onCommit: (v) => set(m, 'contrast', v, `contrast ${v}`) })) : null,
    m.volume ? row('Speaker volume', 'The monitor\'s own speakers.', slider({ value: m.volume.value, min: 0, max: m.volume.max, unit: m.volume.max === 100 ? '%' : '', live: live(m, 'volume'), onCommit: (v) => set(m, 'volume', v, `speaker volume ${v}`) })) : null,
    // the standard picture settings it lists (20 Oct 2026): color preset in view, the color balance folded under More
    m.colorPreset?.options?.length ? row('Color preset', 'Warm, neutral or cool whites.', segmented({ value: m.colorPreset.value, compact: true, options: m.colorPreset.options,
      onCommit: (v) => set(m, 'colorPreset', v, `color preset ${m.colorPreset.options.find((o) => o.value === v)?.label || v}`) })) : null,
    colorBalance(m),
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
    group('Could be added', all.filter(named), 'The monitor opens these settings to the PC. Tell Claude Code which ones you want.'),
    group('Information only', all.filter((x) => x.state === 'info')),
    group('Left out on purpose', all.filter((x) => x.state === 'left out'), 'Resets, power and input switching: DeviceHub never sends these.'),
    group("The maker's own", all.filter((x) => x.state === 'maker' || (x.state === 'not yet' && !x.name)), "Only the monitor's menu or its maker's app knows what these do."));
}

// red / green / blue gain, and black levels where the monitor has them
const BALANCE = [['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['blackRed', 'Red black level'], ['blackGreen', 'Green black level'], ['blackBlue', 'Blue black level']];
function colorBalance(m) {
  const rows = BALANCE.filter(([k]) => m[k]).map(([k, label]) => row(label, null, slider({ value: m[k].value, min: 0, max: m[k].max, label: `${m.name} ${label}`, live: live(m, k), onCommit: (v) => set(m, k, v, `${label.toLowerCase()} ${v}`) })));
  return rows.length ? h('div', { style: { marginTop: '12px' } }, more(`monitor-${m.model || m.name}`, 'Color balance (switches to Custom)', ...rows)) : null;
}

export default {
  id: 'monitors', title: 'Monitors', icon: 'monitor', accent: 'var(--signal)',
  watches: [],  // monitors and the camera are read by the page itself; device readings do not redraw it (21 Oct 2026)
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/monitors') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (isDemo()) return h('div', {}, topbar('Displays and camera', 'Monitors', null), card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, 'In the installed app, your monitors\' brightness, contrast and speakers are here.')));
    if (!list && !error) load(false);
    return h('div', {},
      topbar('Displays and camera', 'Monitors', null),
      error ? card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, `Couldn't read the monitors: ${error}`))
        // while they are read: two monitor cards with shimmering rows (21 Oct 2026)
        : !list ? h('div', { class: 'grid two top' }, loadingCard('Monitor', 4, 'monitor'), loadingCard('Monitor', 4, 'monitor'))
          : list.length ? h('div', { class: 'grid two top' }, ...list.map(monitorCard))
            : card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, 'No monitors found.')),
      // the camera: half width below the monitors
      h('div', { class: 'grid halves top', style: { marginTop: '16px' } }, ...cameraCards(rerender)));
  },
};
