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
import { modal, toast } from '../ui/overlay.js';
import { isDemo } from '../core/devices.js';

// ---------- "Share this driver" (22 Oct 2026; helpers/share-route.mjs, docs/handoff/share-route.md) ----------
// One click: DeviceHub checks the folder for anything personal, says in plain words what would be shared, asks for an
// optional public name, prepares the entry and opens GitHub with the submission filled in. The person presses Submit;
// DeviceHub sends nothing itself.
async function sharePost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch {}
  return j || { ok: false, error: r.statusText || 'DeviceHub did not answer' };
}
const para = (text, extra = {}) => h('p', { style: { margin: '0 0 10px' }, ...extra }, text);
const list = (items) => h('ul', { style: { margin: '0 0 10px', paddingLeft: '20px' } }, ...items.map((x) => h('li', {}, x)));

async function shareRefused(a, r) {
  const found = r.refused || [];
  const body = h('div', {},
    para(found.length ? `DeviceHub found something in my-devices\\${a.plugin} that is about you or this PC, so nothing was shared:` : `It could not be shared: ${r.error || 'unknown problem'}.`),
    found.length ? list(found.map((x) => h('span', {}, h('b', {}, x.text), h('br'), h('span', { class: 'faint' }, x.fix)))) : null,
    para(found.length ? 'Fix those, then press Share this driver again. Nothing has left this PC.' : 'Nothing has left this PC.', { class: 'faint' }));
  await modal('Not shared', body, [{ label: 'Close', value: true, kind: 'primary' }]);
}

async function shareDriver(d) {
  const a = d.adapter;
  if (isDemo()) { toast('Demo mode: nothing is shared', 'info'); return; }
  const c = await sharePost('/api/share/check', { name: a.plugin });
  if (!c.ok) return shareRefused(a, c);
  const by = h('input', { class: 'text', placeholder: 'A public name or nickname (optional)', 'aria-label': 'Public name', maxlength: 40 });
  const body = h('div', {},
    para(`Others with a ${c.title} (USB ${c.usb}) would get this driver without any setup.`),
    h('b', {}, 'What is shared'), list(c.shared),
    c.stays?.length ? para(`Stays on this PC: ${c.stays.join(', ')}.`, { class: 'faint' }) : null,
    h('b', {}, 'Nothing personal'), para(c.checked),
    h('b', {}, `Shared as "${c.status}"`), para(c.statusWhy),
    h('b', {}, 'What happens next'), para(c.next),
    by, para('This name is shown to everyone with the driver. Leave it empty to stay unnamed.', { class: 'faint', style: { margin: '6px 0 0' } }));
  if (!(await modal('Share this driver?', body, [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Open GitHub', value: true, kind: 'primary' }]))) return;
  const p = await sharePost('/api/share/prepare', { name: a.plugin, by: by.value });
  if (!p.ok) return shareRefused(a, p);
  const opened = window.open(p.url, '_blank', 'noopener');
  if (p.method === 'attach') sharePost('/api/share/open-folder', { entry: p.entry }).catch(() => {});
  // the link is shown too, in case the browser blocked the new window
  await modal(p.method === 'attach' ? 'Attach the driver on GitHub' : 'Finish on GitHub', h('div', {},
    list(p.steps),
    para(h('a', { href: p.url, target: '_blank', rel: 'noopener' }, opened ? 'Open the GitHub page again' : 'Open the GitHub page')),
    para(`Saved on this PC in ${p.folder}.`, { class: 'faint' })), [{ label: 'Done', value: true, kind: 'primary' }]);
}

// shown when the device works: connected and its settings read (a read-only driver with reads working counts)
function shareButton(d, shown) {
  if (!d.adapter?.plugin || d.status !== 'connected' || !shown.length) return null;
  return h('div', { class: 'actions', style: { marginTop: '12px' } },
    button('Share this driver', () => shareDriver(d).catch((e) => toast('Not shared', 'bad', { detail: e.message })), { kind: 'ghost small', ic: 'external', title: 'Send this driver to the device library so others with this device need no setup' }));
}

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
          card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(d)], kv(d.info || {}), shareButton(d, shown))));
    },
  };
}
