// Pieces shared by the pages.
import { h, icon } from '../ui/dom.js';
import { button, pill } from '../ui/controls.js';
import { connect, refresh, backupNow, isDemo, isRemote, undo } from '../core/devices.js';
import { toast } from '../ui/overlay.js';
import { artOf } from '../ui/art.js';
import { helpHere } from '../ui/get-help.js';

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
    h('small', {}, w.length ? `Waiting: ${w.map((c) => `${c.label} → ${c.display}`).join(', ')}. Applied when it is back.`
      : 'Changes apply when it is back.')));
}

// Undo (21 Oct 2026): puts back the last change made on this device's page; pressed again, the one before
export function undoButton(d) {
  if (!d.undo) return null;
  return button(`Undo ${d.undo.label}`, async () => {
    try { const r = await undo(d.id); toast(`${r.label} undone`, 'good'); } catch (e) { toast('Not undone', 'bad', { detail: e.message }); }
  }, { kind: 'ghost small', ic: 'undo', title: `${d.undo.count} change${d.undo.count === 1 ? '' : 's'} can be undone` });
}

// the page title alone (21 Oct 2026, Shawn: remove the small line above it and other unneeded wording); the eyebrow
// and lede the pages pass are no longer shown
// help: the screen's Get help (deviceHelp below, or ui/get-help.js helpHere), one small button at the top right; it
// opens below the title across the page (style.css .topbar > .get-help), so a closed one adds no height
export function topbar(eyebrow, title, lede, right, _help) {
  return h('div', { class: 'topbar' }, h('div', {}, h('h1', {}, title)), right || null);
}
// a device page's Get help (22 Oct 2026, docs/handoff/get-help-everywhere.md): the device's own report plus what the
// page shows; the same one whether the device is connected or not
export const deviceHelp = (d) => helpHere('device', { device: d.id, context: () => ({ status: d.status === 'connected' ? 'connected' : d.status }) });

const VENDOR_NAMES = { pulsar: 'the Pulsar app', icue: 'iCUE', epomaker: "Epomaker's web driver", via: 'VIA' };
export async function openVendor(app) {
  if (isDemo()) { toast(`Demo: opens ${VENDOR_NAMES[app] || 'the vendor app'}`, 'info'); return; }
  try {
    const r = await (await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app }) })).json();
    if (r.url) window.open(r.url, '_blank', 'noopener');
    toast(r.ok ? 'Opening app' : `Not opened: ${r.error}`, r.ok ? 'info' : 'bad');
  } catch { toast('DeviceHub not running', 'bad'); }
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
      missing ? h('div', { class: 'grow' }, h('b', {}, `Only in ${label} (not installed): `), a.unsupported.join(', '), '.')
        : h('div', { class: 'grow' }, h('b', {}, `Only in ${label}: `), a.unsupported.join(', '), '.'),
      ...(missing || !vendorApps ? [] : [button(`Open ${label}`, () => openVendor(app), { kind: 'small' })]));
  };
  const el = h('div', { class: 'vendor-note' });
  fill(el);
  if (!vendorApps) vendorAppsLoad.then(() => fill(el));
  return el;
}

// Why it is not connected (22 Oct 2026; helpers/diagnose.mjs, GET /api/diagnose?id=): the likeliest cause with its
// fix and button, the rest under More. Read-only; asked again when the device's state or error changes (or after 30 s,
// on the next redraw). An action runs only on a click; closing a maker's app asks once more, in place (no pop-up).
const diagCache = {};   // id -> { key, at, data, pending }
const diagPost = async (body) => {
  const r = await fetch('/api/diagnose/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
// the answer to Check again or Turn on settings, in one line: how many settings passed (safety round 2)
export function checkAnswer(r, kind = 'check-again') {
  const c = r?.counts;
  const passed = c ? `${c.passed} of ${c.checked} setting${c.checked === 1 ? '' : 's'} passed${c.waiting ? `, ${c.waiting} waiting` : ''}${c.failed ? `, ${c.failed} ${c.failed === 1 ? 'stays' : 'stay'} read-only` : ''}` : '';
  if (kind === 'turn-on') return r?.ran ? `Settings turned on: ${passed}.` : r?.on ? `Settings turned on. ${r.why ? `Not checked yet: ${r.why}` : ''}`.trim() : `Not turned on: ${r?.why || 'unknown problem'}`;
  return r?.ran ? `Checked again: ${passed}.` : `Not checked: ${r?.why || 'unknown problem'}`;
}
function diagAction(d, a, done) {
  if (!a) return null;
  if (a.kind === 'retry') return button(a.label || 'Connect again', () => { delete diagCache[d.id]; return connect(d.id, false); }, { kind: 'ghost small', ic: 'plug' });
  if (a.kind === 'settings' || a.kind === 'open-folder') return button(a.label, async () => { try { await diagPost({ kind: a.kind, page: a.page }); } catch (e) { done(`Not opened: ${e.message}`); } }, { kind: 'ghost small', ic: 'external' });
  if (a.kind === 'check-again' || a.kind === 'turn-on') return button(a.label || (a.kind === 'turn-on' ? 'Turn on settings' : 'Check again'), async () => {
    try { const r = await diagPost({ kind: a.kind, id: d.id }); delete diagCache[d.id]; done(checkAnswer(r, a.kind)); }
    catch (e) { done(`Not checked: ${e.message}`); }
  }, { kind: 'ghost small', ic: a.kind === 'turn-on' ? 'plug' : 'search' });
  if (a.kind === 'close-app') {
    const box = h('span', { class: 'actions', style: { alignItems: 'center', margin: 0 } });
    const ask = () => box.replaceChildren(button(a.label, () => box.replaceChildren(h('small', {}, a.confirm || `${a.label}?`),
      button('Yes, close it', async () => {
        try {
          const r = await diagPost({ kind: 'close-app', app: a.app, confirm: true });
          delete diagCache[d.id];
          done(r.note || (r.closed?.length ? 'Closed. Connecting…' : 'Nothing to close.'));
          setTimeout(() => connect(d.id, false).catch(() => {}), 3000);
        } catch (e) { done(`Not closed: ${e.message}`); }
      }, { kind: 'small' }),
      button('Cancel', ask, { kind: 'ghost small' })), { kind: 'ghost small' }));
    ask();
    return box;
  }
  return null;
}
function diagnosis(d) {
  if (isDemo()) return null;
  const el = h('div', { class: 'banner info', style: { textAlign: 'left', maxWidth: '560px', margin: '6px auto 14px', alignItems: 'flex-start' } });
  const line = (f, main) => h('div', { style: { marginTop: main ? 0 : '10px' } },
    main ? h('b', {}, f.problem) : h('span', {}, f.problem), h('small', {}, f.why), h('small', {}, `Fix: ${f.fix}`));
  const fill = (data) => {
    const [top, ...rest] = data.findings || [];
    if (!top) { el.remove(); return; }
    const note = h('small', {});
    const done = (t) => { note.textContent = t; };
    el.replaceChildren(icon('search'), h('div', { class: 'grow' },
      line(top, true),
      h('div', { class: 'actions', style: { margin: '8px 0 0', justifyContent: 'flex-start' } }, diagAction(d, top.action, done)),
      note,
      // every other finding shown too, no "More" fold (23 Oct 2026)
      ...rest.map((f) => h('div', { style: { marginTop: '8px' } }, line(f, false), f.action ? h('div', { class: 'actions', style: { margin: '6px 0 0', justifyContent: 'flex-start' } }, diagAction(d, f.action, done)) : null))));
      // Get help is at the top right of the device page (deviceHelp), one per screen
  };
  const key = `${d.status}|${d.error || ''}`;
  let c = diagCache[d.id];
  if (!c || c.key !== key || Date.now() - c.at > 30000) {
    c = diagCache[d.id] = { key, at: Date.now(), data: null };
    c.pending = fetch(`/api/diagnose?id=${encodeURIComponent(d.id)}`).then((r) => (r.ok ? r.json() : null)).then((x) => { c.data = x; return x; }).catch(() => null);
  }
  if (c.data) fill(c.data);
  else { el.append(icon('search'), h('small', { class: 'grow' }, 'Checking…')); c.pending.then((x) => (x ? fill(x) : el.remove())); }
  return el;
}

// Shown on a device page when the device is not connected (or asleep / failed).
export function connectState(d, hint) {
  const a = d.adapter;
  const art = artOf(d);
  if (d.status === 'connecting') return h('div', { class: 'panel empty' }, art, h('h2', {}, 'Connecting…'));
  // With the background agent there is nothing to pick: plugging the device in is enough.
  const needsPick = a.id !== 'headset' && !isRemote();
  const agentHint = a.id === 'headset' ? 'Plug in your headset or its receiver and switch it on.'
    : a.id === 'mouse' ? 'Plug in your mouse or its USB receiver.' : 'Plug in your keyboard with its USB cable.';
  return h('div', { class: 'panel empty' }, art,
    h('h2', {}, d.status === 'error' ? `Couldn't reach your ${a.kind.toLowerCase()}` : isRemote() ? `Waiting for your ${a.kind.toLowerCase()}` : `Connect your ${a.kind.toLowerCase()}`),
    h('p', {}, d.error || (isRemote() ? agentHint : hint)),
    diagnosis(d),
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
