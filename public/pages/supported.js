// Supported devices (22 Oct 2026; docs/handoff/supported-devices.md): which devices DeviceHub runs and what each one
// gets, in plain words, without Claude. Not in the sidebar: reached from Settings > DeviceHub > Supported devices
// (Show) and from Search (Ctrl+K). The list comes from GET /api/supported-devices (helpers/supported-devices.mjs: the
// device library and each driver's declared settings; no device is opened). What works for any device is written here.
import { h, icon } from '../ui/dom.js';
import { card, row, button, pill } from '../ui/controls.js';
import { topbar } from './common.js';

let data = null, failed = false, loading = false;
let redrawPage = () => {};
async function load() {
  if (loading) return;
  loading = true; failed = false;
  try {
    const r = await fetch('/api/supported-devices');
    const j = r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : null;
    if (j && Array.isArray(j.groups)) data = j; else failed = true;
  } catch { failed = true; }
  loading = false;
  redrawPage();
}

// what works with no driver at all: [what, what it gets]
const ANY = [
  ['Any VIA keyboard', 'Keys, layers, macros and lights. Layouts for about 1,500 keyboards.'],
  ['Any USB headset', 'Volume, mutes and mic level. EQ and mic filters with Equalizer APO.'],
  ['Monitors', 'Brightness, contrast, color preset and speaker volume over DDC/CI.'],
  ['Webcams', "Picture settings, through Windows' own camera controls."],
  ['USB lights', 'Colors, through the OpenRGB that comes with DeviceHub.'],
  ['Bluetooth batteries', "Any Bluetooth device's battery, as Windows reads it."],
];

const PILL = { works: 'good', reads: 'warn', untried: '' };
const list = (xs) => xs.join(', ');
// a tighter row than Settings' (this page lists about twenty), as Settings' Optional tools row does
const tight = (r) => { r.style.padding = '8px 0'; const d = r.querySelector('.srow-desc'); if (d) d.style.maxWidth = 'none'; return r; };
function driverRow(r) {
  const lines = [];
  if (r.changes.length) lines.push(`Changes ${list(r.changes)}.`);
  if (r.reads.length) lines.push(`${r.changes.length ? 'Also reads' : 'Reads'} ${list(r.reads)}.`);
  if (!r.changes.length && !r.reads.length) lines.push('Names the device only.');
  const desc = h('span', {}, ...lines.flatMap((t, i) => (i ? [h('br'), t] : [t])));
  return tight(row(h('span', {}, h('b', {}, r.brand), ` ${r.models.short}`), desc, pill(r.status.label, PILL[r.status.key] ?? '')));
}

// across the top, its rows in three columns (one on a phone)
function anyCard() {
  const rows = [...ANY.map(([what, gets]) => tight(row(what, gets, null))),
    tight(row('Not listed?', "Learn a device makes a driver while you change settings in its maker's app.",
      button('Learn a device', () => { location.hash = '#/learn'; }, { kind: 'primary small', ic: 'plug' })))];
  const per = Math.ceil(rows.length / 3);
  return card([icon('check'), h('h2', {}, 'Works with any device')],
    h('div', { class: 'grid three top', style: { columnGap: '28px', rowGap: '0' } }, ...[0, 1, 2].map((c) => h('div', {}, ...rows.slice(c * per, c * per + per)))));
}

function groupCard(g) {
  return card([h('h2', {}, g.title), h('span', { class: 'spacer' }), h('span', { class: 'faint' }, `${g.rows.length}`)], ...g.rows.map(driverRow));
}

export default {
  id: 'supported', title: 'Supported devices', icon: 'plug', rail: false, watches: [],
  render({ redraw } = {}) {
    redrawPage = redraw || (() => {});
    if (!data && !failed && !loading) load();
    // the driver cards in three columns that keep their own heights (one on a phone): the biggest card first, each into
    // the shortest column (a row counted as 3, a heading as 1), then each column in the usual order (mice first)
    const cols = [[], [], []], size = [0, 0, 0];
    if (data) {
      const order = data.groups.map((g, n) => ({ g, n, w: 1 + g.rows.length * 3 })).sort((x, y) => y.w - x.w || x.n - y.n);
      for (const x of order) { const i = size.indexOf(Math.min(...size)); cols[i].push(x); size[i] += x.w; }
      cols.forEach((col, i) => { cols[i] = col.sort((x, y) => x.n - y.n).map((x) => groupCard(x.g)); });
    } else {
      cols[0].push(card([h('h2', {}, 'Device drivers')],
        h('p', { class: 'faint', style: { margin: 0 } }, failed ? 'The list did not load. Restart DeviceHub, then open this page again.' : 'Loading…'),
        failed ? h('div', { class: 'actions', style: { marginTop: '10px' } }, button('Try again', () => { failed = false; load(); redrawPage(); }, { kind: 'ghost small', ic: 'refresh' })) : null));
    }
    // the three statuses, said once here instead of on every row
    const legend = h('p', { class: 'faint', style: { margin: '0 0 14px' } },
      h('b', {}, 'Works'), ': out of the box. ', h('b', {}, 'Reads now'), ': settings after Turn on settings on its page. ',
      h('b', {}, 'Not tried yet'), ': no real-device test; install it from the Set up card on Overview.');
    return h('div', {},
      topbar('App', 'Supported devices', null, button('Back to Settings', () => { location.hash = '#/settings'; }, { kind: 'ghost small' })),
      legend,
      h('div', { style: { marginBottom: '16px' } }, anyCard()),
      h('div', { class: 'grid three top' }, ...cols.filter((c) => c.length).map((c) => h('div', { class: 'stack' }, ...c))));
  },
};
