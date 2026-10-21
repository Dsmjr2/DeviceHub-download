// Battery graph for the Mouse and Headset pages (19 Oct 2026): the recorded levels (server: /api/battery-history, a
// reading every 5 minutes plus every plug and unplug) as one 2 px line in the device's color over the last 24 hours or
// 7 days, charging time as a faint green band, a crosshair with the time and level on hover, and the readings as a
// table. The line breaks where no reading came for over 30 minutes (DeviceHub off, the device off or asleep).
import { h } from './dom.js';
import { card, segmented } from './controls.js';

const LINE = { mouse: '#5a86c7', headset: '#d4635a' };  // validated against the dark panel (dataviz validator)
const GAP_MS = 30 * 60 * 1000;
const H = 190, PAD = { l: 34, r: 14, t: 12, b: 26 };
const ui = { days: { mouse: 1, headset: 1 } };
const cache = {};

const svg = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const timeText = (t, days) => new Date(t).toLocaleString([], days > 1 ? { weekday: 'short', hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' });

async function load(id, days) {
  const key = `${id}:${days}`;
  if (cache[key] && Date.now() - cache[key].at < 60000) return cache[key].rows;
  const rows = await (await fetch(`/api/battery-history?id=${id}&days=${days}`)).json();
  cache[key] = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
  return cache[key].rows;
}

function draw(box, id, rows, days) {
  const W = Math.max(280, box.clientWidth || 600);
  const now = Date.now(), t0 = now - days * 24 * 3600 * 1000;
  const x = (t) => PAD.l + ((t - t0) / (now - t0)) * (W - PAD.l - PAD.r);
  const y = (p) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'bchart', role: 'img', 'aria-label': `${id} battery over the last ${days > 1 ? `${days} days` : '24 hours'}` });

  // recessive grid: hairlines at 0, 50 and 100%, labels in muted ink
  for (const p of [0, 50, 100]) {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(p), y2: y(p), class: 'bc-grid' }));
    const tx = svg('text', { x: PAD.l - 6, y: y(p) + 3.5, class: 'bc-axis', 'text-anchor': 'end' }); tx.textContent = `${p}%`; root.append(tx);
  }
  // time ticks: every 6 hours over a day, every day over a week
  const step = days > 1 ? 24 * 3600 * 1000 : 6 * 3600 * 1000;
  const first = new Date(t0); if (days > 1) first.setHours(24, 0, 0, 0); else first.setMinutes(0, 0, 0), first.setHours(Math.ceil(first.getHours() / 6) * 6);
  for (let t = first.getTime(); t < now; t += step) {
    if (x(t) < PAD.l + 16 || x(t) > W - PAD.r - 16) continue;  // no label clipped at either edge
    const tx = svg('text', { x: x(t), y: H - 7, class: 'bc-axis', 'text-anchor': 'middle' });
    tx.textContent = new Date(t).toLocaleString([], days > 1 ? { weekday: 'short' } : { hour: 'numeric' }); root.append(tx);
  }

  // charging bands (status green, a wash, named in the key below)
  let band = null;
  rows.forEach((r, i) => {
    if (r.charging && band == null) band = r.at;
    const end = !r.charging || i === rows.length - 1 || rows[i + 1].at - r.at > GAP_MS;
    if (band != null && end) { root.append(svg('rect', { x: x(band), y: PAD.t, width: Math.max(2, x(r.at) - x(band)), height: H - PAD.t - PAD.b, class: 'bc-charge' })); band = null; }
  });

  // the line and its wash, broken at gaps
  const segs = []; let cur = [];
  for (const r of rows) { if (cur.length && r.at - cur[cur.length - 1].at > GAP_MS) { segs.push(cur); cur = []; } cur.push(r); }
  if (cur.length) segs.push(cur);
  for (const s of segs) {
    const d = s.map((r, i) => `${i ? 'L' : 'M'}${x(r.at).toFixed(1)} ${y(r.pct).toFixed(1)}`).join('');
    if (s.length > 1) root.append(svg('path', { d: `${d}L${x(s[s.length - 1].at).toFixed(1)} ${y(0)}L${x(s[0].at).toFixed(1)} ${y(0)}Z`, fill: LINE[id], 'fill-opacity': 0.1 }));
    root.append(svg('path', { d, fill: 'none', stroke: LINE[id], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  // the latest reading: an end dot with a surface ring, and its value
  const last = rows[rows.length - 1];
  if (last) {
    root.append(svg('circle', { cx: x(last.at), cy: y(last.pct), r: 4, fill: LINE[id], class: 'bc-dot' }));
    const tx = svg('text', { x: Math.min(x(last.at), W - PAD.r) - 8, y: y(last.pct) - 9, class: 'bc-value', 'text-anchor': 'end' }); tx.textContent = `${last.pct}%`; root.append(tx);
  }

  // hover: a crosshair at the nearest reading, with a tooltip
  const cross = svg('line', { y1: PAD.t, y2: H - PAD.b, class: 'bc-cross', visibility: 'hidden' });
  const dot = svg('circle', { r: 4, fill: LINE[id], class: 'bc-dot', visibility: 'hidden' });
  root.append(cross, dot);
  const tip = h('div', { class: 'bc-tip', hidden: true });
  const hit = svg('rect', { x: PAD.l, y: 0, width: W - PAD.l - PAD.r, height: H, fill: 'transparent' });
  root.append(hit);
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  hit.addEventListener('pointermove', (e) => {
    if (!rows.length) return;
    const b = root.getBoundingClientRect(), t = t0 + ((e.clientX - b.left - PAD.l) / (W - PAD.l - PAD.r)) * (now - t0);
    let best = rows[0]; for (const r of rows) if (Math.abs(r.at - t) < Math.abs(best.at - t)) best = r;
    if (Math.abs(best.at - t) > GAP_MS) { hide(); return; }
    const cx = x(best.at);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', y(best.pct)); dot.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('b', {}, `${best.pct}%`), h('span', {}, `${timeText(best.at, 2)}${best.charging ? ' · charging' : ''}`));
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(cx, 60), W - 60)}px`;
  });
  hit.addEventListener('pointerleave', hide);
  box.replaceChildren(root, tip);
}

// The card: range control above, the graph, a key for the charging band, and the readings as a table.
export function batteryChart(id, redraw) {
  const days = ui.days[id];
  const box = h('div', { class: 'bc-box' }, h('div', { class: 'faint', style: { padding: '40px 0', textAlign: 'center' } }, 'Loading…'));
  const table = h('details', { class: 'bc-table' }, h('summary', {}, 'Readings'));
  const el = card([h('h2', {}, 'Battery'), h('span', { class: 'sub' }, days > 1 ? 'last 7 days' : 'last 24 hours'), h('span', { class: 'spacer' }),
    segmented({ value: days, compact: true, options: [{ value: 1, label: '24 h' }, { value: 7, label: '7 days' }], onCommit: async (v) => { ui.days[id] = v; redraw(); } })],
    box,
    h('div', { class: 'bc-key' }, h('i'), 'Charging'),
    table);
  load(id, days).then((rows) => {
    if (rows.length < 2) { box.replaceChildren(h('div', { class: 'faint', style: { padding: '40px 0', textAlign: 'center' } }, 'Not enough readings yet. DeviceHub records the level every 5 minutes.')); return; }
    // redrawn when its width changes; the watcher stops once the page has replaced this card (pages redraw often)
    const ro = new ResizeObserver(() => { if (!box.isConnected) { ro.disconnect(); return; } draw(box, id, rows, days); });
    ro.observe(box);
    requestAnimationFrame(() => draw(box, id, rows, days));
  }).catch(() => box.replaceChildren(h('div', { class: 'faint' }, 'Battery history is not available.')));
  // the table always covers the whole 7 days, whatever the graph shows
  load(id, 7).then((rows) => table.append(readings(rows))).catch(() => {});
  return el;
}

// The readings as changes (21 Oct 2026, Shawn: "a few days worth of readings but also want accuracy and time"): one
// row for each stretch at one level, with its exact start and end time and how long it held, grouped by day, newest
// first; a stretch with no readings for over 30 minutes is its own row. Nothing is averaged: every reading falls in
// exactly one row.
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = (t) => new Date(t).toDateString();
const dayName = (t) => {
  const d = new Date(t), today = new Date(); const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};
const lasted = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms ? 'under 1 min' : 'one reading';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};
function readings(rows) {
  const runs = [];
  for (const r of rows) {
    const cur = runs[runs.length - 1];
    if (cur && r.at - cur.to > GAP_MS) runs.push({ gap: true, from: cur.to, to: r.at });
    const last = runs[runs.length - 1];
    if (last && !last.gap && last.pct === r.pct && !!last.charging === !!r.charging) { last.to = r.at; last.n++; }
    else runs.push({ pct: r.pct, charging: !!r.charging, from: r.at, to: r.at, n: 1 });
  }
  const body = [];
  let day = null;
  for (const run of runs.reverse()) {
    if (dayKey(run.to) !== day) { day = dayKey(run.to); body.push(h('tr', { class: 'bc-day' }, h('th', { colspan: 4 }, dayName(run.to)))); }
    const span = clock(run.from) === clock(run.to) ? clock(run.from) : `${dayKey(run.from) !== day ? `${new Date(run.from).toLocaleDateString([], { weekday: 'short' })} ` : ''}${clock(run.from)} – ${clock(run.to)}`;
    body.push(run.gap
      ? h('tr', { class: 'bc-gap' }, h('td', {}, span), h('td', {}, '—'), h('td', {}, lasted(run.to - run.from)), h('td', {}, 'no readings (off or asleep)'))
      : h('tr', {}, h('td', {}, span), h('td', {}, h('b', {}, `${run.pct}%`)), h('td', {}, lasted(run.to - run.from)), h('td', {}, `${run.charging ? 'charging · ' : ''}${run.n} reading${run.n === 1 ? '' : 's'}`)));
  }
  return h('div', { class: 'bc-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Level'), h('th', {}, 'Held'), h('th', {}, ''))), h('tbody', {}, ...body)));
}
