// Headset page: battery and iCUE status, Windows volume and mic, LED color.
import { h, icon } from '../ui/dom.js';
import { more, card, row, toggle, slider, button, pill, segmented } from '../ui/controls.js';
import { batteryCell, loadBatteryEstimates } from '../ui/controls.js';
import { batteryChart } from '../ui/battery-chart.js';
import { devices, write, prepare, isDemo, isRemote, connect, markMissing } from '../core/devices.js';
import { env } from '../core/env.js';
import { showPicker, isJack } from '../core/headset-pick.js';
import { headsetArt } from '../ui/art.js';
import { meter, micState } from '../ui/gauges.js';
import { topbar, connectState, deviceActions, vendorNote, kv, statusPill, isAway, awayBanner, undoButton, deviceHelp } from './common.js';
import { setGlow } from '../core/theme.js';
import { eqPanel, soundTools } from './eq-panel.js';
import { micMeter } from './mic-meter.js';
import { copyPrompt } from './pc-lights.js';
import { brandForUsb } from '../core/brands.js';

const d = () => devices.headset;
const set = (key, value, label, display) => write('headset', key, value, { label, display }).catch(() => {});
// a slider step while dragging: the headset follows at once (21 Oct 2026)
const live = (key) => (value) => write('headset', key, value, { live: true }).catch(() => {});
export const SWATCHES = ['#ff6a1a', '#ff2d55', '#ff5d8f', '#b48cff', '#5b6cff', '#3fe0ff', '#3ddc97', '#c6ff3d', '#ffd23f', '#ffffff'];

const ICUE_ROWS = [
  ['micEnabled', 'Microphone', (v) => (v ? 'on' : 'muted')],
  ['sidetoneEnabled', 'Sidetone', (v) => (v ? 'on' : 'off')],
  ['surroundEnabled', 'Surround', (v) => (v ? 'on' : 'off')],
];
// No "EQ preset" row: iCUE's SDK always reports 0 ("none") for the HS80, whose EQ lives in iCUE's own preset file
// (the EQ card below reads that file and shows the real preset).

// any other USB headset: what works, and a ready prompt to add the rest (its lights, battery, own settings)
function genericCard(a) {
  const g = a.generic || {};
  const vid = /VID_([0-9A-F]{4})/i.exec(g.usb || '')?.[1]?.toLowerCase(), pid = /PID_([0-9A-F]{4})/i.exec(g.usb || '')?.[1]?.toLowerCase();
  const u = { id: `${vid}:${pid}`, vid, name: g.device, brand: brandForUsb(vid) };
  // a library or learned driver that runs this same headset (a my-devices page of kind Headset, same maker): its
  // battery and own settings are on that page
  const maker = u.brand && !u.brand.shared ? u.brand.name.toLowerCase().split(' ')[0] : null;
  const own = maker ? Object.values(devices).find((x) => x.adapter?.plugin && /headset/i.test(x.adapter.kind || '') && ['connected', 'asleep'].includes(x.status) && String(x.adapter.title || '').toLowerCase().includes(maker)) : null;
  return card([h('h2', {}, 'Lights & battery')],
    h('p', { class: 'faint', style: { margin: '0 0 10px' } }, 'Sound, mic and EQ work for any USB headset. Its lights, battery and own settings need DeviceHub to learn this model.'),
    own ? h('p', { style: { margin: '0 0 10px' } }, `Battery and its own settings: on its ${own.adapter.title} page. `, h('a', { href: `#/${own.id}` }, 'Open it')) : null,
    h('div', { class: 'actions' }, button('Copy a prompt for Claude', () => copyPrompt(u), { kind: 'small' })));
}

// Two or more USB headsets (22 Oct 2026): which one this page controls. The choice is kept in DeviceHub's settings
// (helpers/agent.mjs "headset-pick"); a failed switch says why in a line next to it.
let pickError = null;
// Rename the headset in use (22 Oct 2026, Shawn: "add audio technica to the connection for the headset"): a wired one
// shows as Windows names the jack ("Headphones (Realtek(R) Audio)"), so it can be given its own name; saved in
// settings.json "headsetNames" and shown on the page, the picker and the Overview.
let renaming = null;   // the text being typed, or null
function renameHeadset(a, redraw) {
  const key = a.generic?.usb;
  if (!key || isDemo()) return null;
  if (renaming == null) return button('Rename', () => { renaming = a.title || ''; redraw(); setTimeout(() => document.querySelector('.hs-rename input')?.select(), 0); }, { kind: 'ghost small' });
  const save = async (name) => {
    try { await env.api('/api/settings', { headsetName: { key, name } }); renaming = null; await env.api('/api/agent/refresh', { id: 'headset' }).catch(() => {}); }
    catch (e) { pickError = e.message; }
    redraw();
  };
  const box = h('input', { class: 'text', value: renaming, maxlength: 40, placeholder: 'e.g. Audio-Technica ATH-M50x', 'aria-label': 'Headset name',
    oninput: (e) => { renaming = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') save(renaming.trim()); if (e.key === 'Escape') { renaming = null; redraw(); } } });
  return h('div', { class: 'hs-rename' }, box, button('Save', () => save(renaming.trim()), { kind: 'primary small' }),
    button('Cancel', () => { renaming = null; redraw(); }, { kind: 'ghost small' }));
}
function headsetPicker(a, redraw) {
  const choices = a.headsets || [];
  const rename = renameHeadset(a, redraw);
  if (!showPicker(choices)) return rename;
  return h('div', { class: 'chips' }, segmented({ value: a.picked, compact: true, options: choices.map((c) => ({ value: c.key, label: c.name })), onCommit: async (k) => {
    pickError = null;
    try {
      if (isDemo()) { a.choose?.(k); markMissing('headset'); await connect('headset'); }
      else if (isRemote()) await env.api('/api/agent/headset-pick', { pick: k });
      else throw new Error('Needs DeviceHub running in the background.');
    } catch (e) { pickError = e.message; }
    redraw();
  } }), rename, pickError ? h('span', { class: 'faint' }, pickError) : null);
}

export default {
  id: 'headset', title: 'Headset', icon: 'headset', device: 'headset', accent: 'var(--c-headset)', grab: () => prepare('headset'), watches: ['headset'],
  render() {
    const redraw = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/headset') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    loadBatteryEstimates(() => redraw());
    const dev = d();
    const a = dev.adapter;
    const direct = a.mode === 'direct';
    // any other USB headset (headset-adapter.js): its sound features only, under its own name
    const generic = a.mode === 'generic';
    const head = topbar(generic ? `${isJack(a.generic?.usb) ? 'Wired headset' : 'USB headset'} · sound features` : direct ? 'Corsair · Wireless headset' : 'Corsair · Wireless headset · iCUE open', a.title, null, h('div', { class: 'chips' }, headsetPicker(a, redraw), undoButton(dev), dev.status === 'connected' && !dev.values?.headsetOn ? pill('headset off', 'warn') : statusPill(dev)), deviceHelp(dev));
    if (dev.status !== 'connected' && !(isAway(dev) && a.endpoints)) {
      return h('div', {}, head, connectState(dev, 'Plug in the HS80 receiver. DeviceHub finds it automatically within a few seconds, with or without iCUE.'));
    }
    const v = dev.values;
    const props = a.props || {};
    const eps = a.endpoints || [];
    const has = (flow) => eps.some((e) => e.flow === flow);
    const bat = dev.battery?.percent;
    return h('div', {}, head, awayBanner(dev),
      // headset off: one clear line, no stale numbers (Shawn, 19 Oct 2026: "why are these displayed when the headset
      // isnt even on?")
      h('section', { class: `hero${v.headsetOn ? '' : ' off'}` },
        v.headsetOn ? h('div', {},
          h('div', { class: 'hero-stats' },
            bat != null ? batteryCell({ id: 'headset', percent: bat, charging: !!dev.battery?.charging || /cable/i.test(dev.info?.Control || ''), big: true }) : null,
            meter({ ic: 'volume', pct: v['vol:playback'], value: v['vol:playback'] != null ? `${v['vol:playback']}%` : '—', label: 'volume', big: true }),
            micState({ on: v['prop:micEnabled'], big: true }),
            meter({ ic: 'ear', pct: v.sidetoneOn === false ? 0 : v.sidetone, value: v.sidetone == null ? '—' : v.sidetoneOn === false ? 'Off' : `${v.sidetone}%`, label: 'sidetone', big: true })))
        : h('div', { class: 'hero-off' }, icon('sleep'), h('div', {}, h('b', {}, 'Headset off'))),
        // another headset: a plain headset outline in its color, not the HS80's picture
        generic ? h('div', { class: 'hero-art generic-art' }, icon('headset')) : h('div', { class: `hero-art${v['prop:micEnabled'] === false ? ' mic-muted' : ''}`, style: v.led ? { '--glowc': v.led } : null }, headsetArt())),
      h('div', { class: 'grid two' },
        // Sound: the sliders first, then the on/off switches
        card([h('h2', {}, 'Sound')],
          has('playback') ? row('Volume', null, slider({ value: v['vol:playback'], min: 0, max: 100, unit: '%', accent: 'var(--c-headset)', grab: () => prepare('headset'), live: live('vol:playback'), onCommit: (x) => set('vol:playback', x, 'Volume', `${x}%`) })) : h('p', { class: 'faint' }, generic ? 'No speaker for this headset in Windows.' : 'No HS80 speaker in Windows. Is the headset on?'),
          has('recording') ? row('Mic level', null, slider({ value: v['vol:recording'], min: 0, max: 100, unit: '%', accent: 'var(--c-headset)', grab: () => prepare('headset'), live: live('vol:recording'), onCommit: (x) => set('vol:recording', x, 'Mic level', `${x}%`) })) : h('p', { class: 'faint' }, generic ? 'No mic for this headset in Windows.' : 'No HS80 mic in Windows.'),
          v.micBoost != null ? row('Mic boost', 'Louder mic, more background noise.', slider({ value: v.micBoost, min: 0, max: 10, unit: ' dB', accent: 'var(--c-headset)', grab: () => prepare('headset'), live: live('micBoost'), onCommit: (x) => set('micBoost', x, 'Mic boost', `${x} dB`) })) : null,
          v.sidetone != null ? row('Sidetone', 'Hear your own voice.', h('div', { class: 'srow-ctl' }, toggle({ value: v.sidetoneOn !== false, label: 'Sidetone', onCommit: (on) => set('sidetoneOn', on, 'Sidetone', on ? 'on' : 'off') }),
            v.sidetoneOn !== false ? slider({ value: v.sidetone, min: 0, max: 100, unit: '%', label: 'Sidetone level', accent: 'var(--c-headset)', grab: () => prepare('headset'), live: live('sidetone'), onCommit: (x) => set('sidetone', x, 'Sidetone level', `${x}%`) }) : null)) : null,
          has('playback') ? row('Mute sound', null, toggle({ value: v['mute:playback'], label: 'Mute output', onCommit: (on) => set('mute:playback', on, 'Output', on ? 'muted' : 'on') })) : null,
          has('recording') ? row('Mute mic', 'Mutes it in Windows.', toggle({ value: v['mute:recording'], label: 'Mute mic', onCommit: (on) => set('mute:recording', on, 'Mic (Windows)', on ? 'muted' : 'on') })) : null,
          // while iCUE runs, what it reports that DeviceHub cannot change
          ...(direct ? [] : ICUE_ROWS.filter(([k]) => props[k] && !props[k].canWrite && k !== 'micEnabled').map(([k, label, show]) => row(label, 'Reported by iCUE.', pill(show(v[`prop:${k}`]), v[`prop:${k}`] ? 'good' : ''))))),
        // Lights & power, with Mic check under it (the two columns balance)
        h('div', { class: 'stack' }, generic ? genericCard(a) : card([h('h2', {}, 'Lights & power'), h('span', { class: 'sub' }, direct ? null : 'iCUE runs the lights while it is open')],
          row('Headset color', null, h('div', { class: 'swatches compact' },
            ...SWATCHES.map((c) => h('button', { class: 'swatch', style: { '--s': c }, title: c, 'aria-label': `color ${c}`, onclick: () => set('led', c, 'Headset Color', c).then(() => setGlow(c)) })),
            h('input', { type: 'color', class: 'swatch-custom', title: 'Any color', value: v.led || '#ff6a1a', 'aria-label': 'custom color', onchange: (e) => set('led', e.target.value, 'Headset Color', e.target.value) }))),
          direct && v.logoBrightness != null ? row('Logo brightness', '0 = off.', slider({ value: v.logoBrightness, min: 0, max: 100, unit: '%', accent: 'var(--c-headset)', grab: () => prepare('headset'), live: live('logoBrightness'), onCommit: (x) => set('logoBrightness', x, 'Ear Cup Logo', x ? `${x}%` : 'off') })) : null,
          direct && v.autoOff != null ? row('Sleep when silent', 'Turns off after this long with no sound.', slider({ value: v.autoOff, min: 1, max: 120, unit: ' min', accent: 'var(--c-headset)', grab: () => prepare('headset'), onCommit: (x) => set('autoOff', x, 'Sleep after', `${x} min`) })) : null,
          direct && v.micLight != null ? row('Mic light', 'Red while muted.', toggle({ value: v.micLight, label: 'Mic light', onCommit: (on) => set('micLight', on, 'Mic light', on ? 'on when muted' : 'off') })) : null),
        micMeter(redraw))),
      h('div', { style: { marginTop: '18px' } }, eqPanel(redraw)),
      h('div', { style: { marginTop: '18px' } }, more('headset', 'Sound tools, battery history, device info',
        soundTools(),
        batteryChart('headset', redraw),
        card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(dev)], kv(dev.info), h('div', { style: { marginTop: '14px' } }, vendorNote(a))))));
  },
};
