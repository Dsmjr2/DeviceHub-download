// Pieces shared by the pages.
import { h, icon } from '../ui/dom.js';
import { button, pill } from '../ui/controls.js';
import { connect, refresh, backupNow, isDemo, isRemote, undo } from '../core/devices.js';
import { toast } from '../ui/overlay.js';
import { artOf } from '../ui/art.js';

export const STATUS = {
  connected: ['Connected', 'good'], asleep: ['Asleep', 'warn'], connecting: ['Connecting', 'accent'],
  // not plugged in, not found and could-not-reach all read the same, calmly (19 Oct 2026: "Error" in red was too much)
  missing: ['Not connected', ''], idle: ['Not connected', ''], error: ['Not connected', ''],
};
export const statusPill = (d) => { const [t, k] = STATUS[d.status] || STATUS.idle; return pill(t, k); };

// A device that is away (asleep, switched off or unplugged) but whose settings are known: its page still works, and
// changes wait for it (21 Oct 2026). awayBanner says so and lists what is waiting; null when there is nothing to say.
export const isAway = (d) => ['asleep', 'missing'].includes(d.status) && Object.keys(d.values || {}).length > 0;
export function awayBanner(d, { off } = {}) {
  const kind = d.adapter.kind.toLowerCase(), w = d.waiting || [];
  const away = isAway(d) || off;
  if (!away && !w.length) return null;
  const what = d.status === 'missing' ? `The ${kind} is unplugged` : off ? `The ${kind} is off` : `The ${kind} is asleep`;
  return h('div', { class: 'banner' }, icon('sleep'), h('div', { class: 'grow' },
    h('b', {}, away ? what : `Waiting for the ${kind}`),
    h('small', {}, w.length ? `Waiting: ${w.map((c) => `${c.label} → ${c.display}`).join(', ')}. Applied the moment it is back.`
      : 'You can still change its settings here; they are applied the moment it is back.')));
}

// Undo (21 Oct 2026): puts back the last change made on this device's page; pressed again, the one before
export function undoButton(d) {
  if (!d.undo) return null;
  return button(`Undo ${d.undo.label}`, async () => {
    try { const r = await undo(d.id); toast(`${r.label} put back`, 'good'); } catch (e) { toast('Not undone', 'bad', { detail: e.message }); }
  }, { kind: 'ghost small', ic: 'undo', title: `${d.undo.count} change${d.undo.count === 1 ? '' : 's'} can be undone` });
}

// the page title alone (21 Oct 2026, Shawn: remove the small line above it and other unneeded wording); the eyebrow
// and lede the pages pass are no longer shown
export function topbar(eyebrow, title, lede, right) {
  return h('div', { class: 'topbar' }, h('div', {}, h('h1', {}, title)), right || null);
}

const VENDOR_NAMES = { pulsar: 'the Pulsar app', icue: 'iCUE', epomaker: "Epomaker's web driver", via: 'VIA' };
export async function openVendor(app) {
  if (isDemo()) { toast(`In the installed app this opens ${VENDOR_NAMES[app] || 'the vendor app'}`, 'info', { detail: 'This is a demo with pretend devices.' }); return; }
  try {
    const r = await (await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }) })).json();
    if (r.url) window.open(r.url, '_blank', 'noopener');
    toast(r.ok ? 'Opening the vendor app' : `Could not open it: ${r.error}`, r.ok ? 'info' : 'bad');
  } catch { toast('DeviceHub server is not running', 'bad'); }
}

// The few things only the maker's app does. With the app not on this PC (Shawn uninstalled iCUE, 21 Oct 2026) it says
// so, with no button that cannot open anything; an app that is a web page always keeps its button.
let vendorApps = null;
const vendorAppsLoad = fetch('/api/vendor-apps').then((r) => (r.ok ? r.json() : {})).then((v) => { vendorApps = v; }).catch(() => { vendorApps = {}; });
export function vendorNote(a) {
  const app = a.vendor.app, label = a.vendor.label;
  const fill = (el) => {
    const missing = vendorApps && vendorApps[app] === false;
    el.replaceChildren(icon('external'),
      missing ? h('div', { class: 'grow' }, h('b', {}, `Only in ${label}, which is not on this PC: `), a.unsupported.join(', '), '. You only need it for those.')
        : h('div', { class: 'grow' }, h('b', {}, `Still in ${label}: `), a.unsupported.join(', '), '.'),
      ...(missing || !vendorApps ? [] : [button(`Open ${label}`, () => openVendor(app), { kind: 'small' })]));
  };
  const el = h('div', { class: 'vendor-note' });
  fill(el);
  if (!vendorApps) vendorAppsLoad.then(() => fill(el));
  return el;
}

// Shown on a device page when the device is not connected (or asleep / failed).
export function connectState(d, hint) {
  const a = d.adapter;
  const art = artOf(d);
  if (d.status === 'connecting') return h('div', { class: 'panel empty' }, art, h('h2', {}, 'Connecting…'), h('p', {}, 'Reading every setting and checking it.'));
  // With the background agent there is nothing to pick: plugging the device in is enough.
  const needsPick = a.id !== 'headset' && !isRemote();
  const agentHint = a.id === 'headset' ? 'Plug in the HS80 receiver or its USB cable and switch the headset on; DeviceHub finds it within a few seconds.'
    : `Plug in the ${a.id === 'mouse' ? 'Pulsar 8K dongle' : 'P75 with its USB cable'}; DeviceHub finds it within a few seconds.${a.id === 'mouse' ? ' Close the Pulsar app first: both use the same channel.' : ''}`;
  return h('div', { class: 'panel empty' }, art,
    h('h2', {}, d.status === 'error' ? `Couldn't reach your ${a.kind.toLowerCase()}` : isRemote() ? `Waiting for your ${a.kind.toLowerCase()}` : `Connect your ${a.kind.toLowerCase()}`),
    h('p', {}, d.error || (isRemote() ? agentHint : hint)),
    h('div', { class: 'actions' },
      button('Connect', () => connect(d.id, needsPick), { kind: 'primary', ic: 'plug' }),
      button(`Open ${a.vendor.label}`, () => openVendor(a.vendor.app), { kind: 'ghost', ic: 'external' })));
}

export function deviceActions(d) {
  return h('div', { class: 'actions' },
    button('Re-read', () => refresh(d.id), { kind: 'ghost small', ic: 'refresh' }),
    button('Back up now', async () => { const f = await backupNow(d.id); toast('Backup saved', 'good', { detail: f }); }, { kind: 'ghost small', ic: 'backups' }));
}

export function kv(obj) {
  return h('dl', { class: 'kv' }, ...Object.entries(obj || {}).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v ?? '—'))]));
}
