// The page of a device added in my-devices/ (21 Oct 2026; helpers/my-devices.mjs): drawn from the settings its device
// file lists, so adding a device needs no page code, and an update to DeviceHub never touches it. The same rules as the
// built-in pages: every change backed up, written one at a time and read back (public/core/devices.js), Undo, changes
// that wait while it is away.
import { h, icon } from '../ui/dom.js';
import { card, row, slider, toggle, segmented, pill } from '../ui/controls.js';
import { devices, write, prepare, connect } from '../core/devices.js';
import { topbar, deviceActions, kv, statusPill, isAway, awayBanner, undoButton } from './common.js';
import { artOf } from '../ui/art.js';
import { button } from '../ui/controls.js';

const ICON = { mouse: 'mouse', headset: 'headset', keyboard: 'keyboard' };

function control(d, s) {
  const v = d.values?.[s.key];
  const set = (x) => write(d.id, s.key, x, { label: s.label, display: s.type === 'choice' ? (s.options.find((o) => o.value === x)?.label ?? String(x)) : `${x}${s.unit || ''}` }).catch(() => {});
  if (s.type === 'toggle') return toggle({ value: !!v, label: s.label, onCommit: set });
  if (s.type === 'choice') return segmented({ value: v, compact: s.options.length > 3, options: s.options, onCommit: set });
  return slider({ value: v ?? null, min: s.min, max: s.max, step: s.step || 1, unit: s.unit || '', label: s.label,
    grab: () => prepare(d.id), live: s.live ? (x) => write(d.id, s.key, x, { live: true }).catch(() => {}) : null, onCommit: set });
}

export function devicePage(id) {
  const d0 = devices[id];
  return {
    id, title: d0.adapter.title, icon: ICON[String(d0.adapter.kind).toLowerCase()] || 'plug', device: id, watches: [id], accent: 'var(--signal)',
    render() {
      const d = devices[id];
      const a = d.adapter;
      const head = topbar(`${a.kind} · added on this PC`, a.title, null, h('div', { class: 'chips' }, undoButton(d), statusPill(d)));
      if (d.status !== 'connected' && !isAway(d)) {
        return h('div', {}, head, h('div', { class: 'panel empty' }, artOf(d),
          h('h2', {}, d.status === 'error' ? `Couldn't reach the ${a.kind.toLowerCase()}` : `Waiting for the ${a.kind.toLowerCase()}`),
          h('p', {}, d.error || `Plug in the ${a.title}; DeviceHub finds it within a few seconds.`),
          h('div', { class: 'actions' }, button('Look again', () => connect(id, false), { kind: 'primary', ic: 'plug' }))));
      }
      const shown = (a.settings || []).filter((s) => d.values?.[s.key] !== undefined);
      return h('div', {}, head, awayBanner(d),
        h('div', { class: 'grid two top' },
          card([h('h2', {}, 'Settings'), d.battery?.percent != null ? pill(`battery ${d.battery.percent}%${d.battery.charging ? ', charging' : ''}`) : null],
            shown.length ? shown.map((s) => row(s.label, s.hint || null, control(d, s))) : h('p', { class: 'faint', style: { margin: 0 } }, 'It has not reported any settings yet.'),
            a.unsupported?.length ? h('p', { class: 'faint', style: { marginTop: '12px' } }, icon('external'), ` Still in its maker's app: ${a.unsupported.join(', ')}.`) : null),
          card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(d)], kv(d.info || {}))));
    },
  };
}
