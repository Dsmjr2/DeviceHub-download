// Battery history and estimates (19 Oct 2026). Every 5 minutes the wireless devices' battery levels are added to
// battery-history.jsonl (kept to the last 7 days), and a row is added the moment one is plugged in or unplugged
// (checked every 30 s from the state DeviceHub already holds; no extra device reads).
//
// Time left: the latest stretch of steady discharge (at least 30 minutes and a 2% drop, no charging in it);
// time left = level / drain rate.

const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');

let file, timer, watchTimer, getState;
const KEEP_MS = 7 * 24 * 3600 * 1000;

function read() {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function append(rows) {
  if (!rows.length) return;
  const now = Date.now();
  const keep = read().filter((r) => now - r.at < KEEP_MS);
  writeAtomic(file, [...keep, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function rowsNow() {
  const s = getState?.();
  if (!s) return [];
  const now = Date.now();
  const rows = [];
  for (const d of s.devices || []) {
    const b = d.battery;
    if (d.status === 'connected' && b && b.percent != null) {
      rows.push({ at: now, id: d.id, pct: b.percent, raw: b.reported ?? undefined, mv: b.mv ?? undefined, charging: !!b.charging || (d.id === 'headset' && /cable/i.test(d.info?.Control || '')) });
    }
  }
  return rows;
}

// never throws (20 Oct 2026): a file held by antivirus or a backup tool for a moment ended the whole server from this timer
function sample() { try { append(rowsNow()); } catch (e) { console.log(`[battery] not recorded: ${e.message}`); } }

// plugged in or unplugged since the last look: record it now, so a charge's start and end are known to the minute
const lastCharging = {};
function watch() {
  const now = rowsNow();
  const edges = now.filter((r) => lastCharging[r.id] !== undefined && lastCharging[r.id] !== r.charging);
  for (const r of now) lastCharging[r.id] = r.charging;
  append(edges.map((r) => ({ ...r, edge: r.charging ? 'plugged' : 'unplugged' })));
}

// { mouse: { hoursLeft, ratePerHour } | null, headset: ... }
function estimates() {
  const all = read();
  const out = {};
  for (const id of ['mouse', 'headset']) {
    const rows = all.filter((r) => r.id === id).sort((a, b) => a.at - b.at);
    if (rows.length < 2) { out[id] = null; continue; }
    const last = rows[rows.length - 1];
    const res = {};
    // walk back from the newest sample while the level only goes down (or holds) and nothing charged
    let i = rows.length - 1;
    while (i > 0 && !rows[i - 1].charging && !rows[i].charging && rows[i - 1].pct >= rows[i].pct && rows[i].at - rows[i - 1].at < 3 * 3600 * 1000) i--;
    const first = rows[i];
    const hours = (last.at - first.at) / 3600000, drop = first.pct - last.pct;
    if (!last.charging && hours >= 0.5 && drop >= 2) Object.assign(res, { ratePerHour: +(drop / hours).toFixed(2), hoursLeft: +(last.pct / (drop / hours)).toFixed(1) });
    out[id] = Object.keys(res).length ? res : null;
  }
  return out;
}

function start(root, stateFn) {
  file = path.join(root, 'battery-history.jsonl');
  getState = stateFn;
  // start from the last recorded plug state, so a plug or unplug while DeviceHub was closed is caught at once
  for (const r of read()) lastCharging[r.id] = r.charging;
  setTimeout(sample, 60000);
  timer = setInterval(sample, 5 * 60 * 1000);
  // the charging watch every 30 s (90 s on battery with the battery saver)
  const loop = () => { Promise.resolve().then(watch).catch(() => {}).finally(() => { watchTimer = setTimeout(loop, require('./power').every(30000)); }); };
  watchTimer = setTimeout(loop, 20000);
}
function stop() { clearInterval(timer); clearTimeout(watchTimer); }

// The recorded readings of one device for the battery graph: [{ at, pct, charging }], oldest first, the last `days` days
function history(id, days = 7) {
  const since = Date.now() - days * 24 * 3600 * 1000;
  return read().filter((r) => r.id === id && r.at >= since).sort((a, b) => a.at - b.at).map((r) => ({ at: r.at, pct: r.pct, charging: !!r.charging }));
}

module.exports = { start, stop, estimates, history };
