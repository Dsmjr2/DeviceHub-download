// The daily self-check (21 Oct 2026): once a day, quietly, DeviceHub checks itself and writes the result to
// daily-check.json for Settings > Health. Nothing pops up. Read-only: each device is read twice and the two readings
// compared (what Settings > Self-test does), the device helper is asked to answer, the backups folder is written to and
// cleaned, the free disk space is looked at, and any change still waiting for a device for over 3 days is listed.
// A device that is asleep or unplugged at check time is checked the next time it is connected (the mouse sleeps after
// 20 s, so it is usually checked when it next wakes). A whole run takes a few seconds; the timer that decides whether one
// is due runs every 10 minutes and does nothing else.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { writeAtomic } = require('./safe-write.js');

const DAY = 24 * 3600 * 1000;
let file = null, core = null, busy = false, memo = null;
const read = () => { if (!memo) { try { memo = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { memo = { at: null, items: {} }; } } return JSON.parse(JSON.stringify(memo)); };
const save = (r) => { memo = r; try { writeAtomic(file, JSON.stringify(r, null, 1)); } catch {} };

async function checkDevice(d) {
  const a = d.adapter;
  const one = await core.readNow(d.id), two = await core.readNow(d.id);
  // a read cut short (31 Oct 2026: the Pulsar dozed off between the two reads, its second read came back without most of its
  // settings, and the check said 30 settings "changed between two reads"): only settings both reads have are compared,
  // and a second read missing half of them is a device that went to sleep, checked again when it is next connected
  const has = (o, k) => o && o[k] !== undefined && o[k] !== null;
  const keys = Object.keys(one || {}).filter((k) => has(one, k));
  const both = keys.filter((k) => has(two, k));
  if (keys.length && both.length < keys.length / 2) return { ok: null, text: 'not checked: it went to sleep during the check; checked when it is next connected' };
  const unstable = both.filter((k) => JSON.stringify(one[k]) !== JSON.stringify(two[k]) && !/^vol:|batteryLevel/.test(k));
  const notes = [];
  if (d.id === 'mouse' && a.trusted) {
    const bad = ['pollingRate', 'dpiStage', 'liftOff', 'debounce', 'motionSync', 'angleSnap', 'ripple'].filter((k) => !a.trusted(k));
    if (bad.length) notes.push(`${bad.join(', ')} failed their check and stay locked`);
  }
  if (unstable.length) notes.push(`changed between two reads: ${unstable.join(', ')}`);
  return { ok: !notes.length, text: notes.length ? notes.join('; ') : `${both.length} settings read twice, identical` };
}

// run: everything (all: true), or only the devices not checked in the last day that are connected now
export async function run({ all = false } = {}) {
  if (busy) return read();
  busy = true;
  const r = read();
  try {
    const now = Date.now();
    let dirty = false;
    const put = (name, res) => { r.items[name] = { ...res, at: new Date().toISOString() }; dirty = true; };
    // only the devices this PC has had (23 Oct 2026, a friend's PC listed Shawn's Pulsar and HS80): one never seen here
    // and not connected now is left out, and a line saved for it before goes
    let seenHere = new Set();
    try { seenHere = new Set(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'seen-devices.json'), 'utf8'))); } catch {}
    for (const d of Object.values(core.devices)) {
      if (seenHere && !seenHere.has(d.id) && !['connected', 'asleep'].includes(d.status)) { if (r.items[d.adapter.title]) { delete r.items[d.adapter.title]; dirty = true; } continue; }
      const last = r.items[d.adapter.title];
      if (!all && last && last.at && now - new Date(last.at) < DAY && last.ok !== null) continue;
      if (d.status !== 'connected') {
        // never checked yet, or due: say so, and it is checked when it is next connected
        if (all || !last) put(d.adapter.title, { ok: null, text: `not checked: ${d.status === 'asleep' ? 'asleep' : 'not connected'}; checked when it is next connected` });
        continue;
      }
      try { put(d.adapter.title, await checkDevice(d)); } catch (e) { put(d.adapter.title, { ok: false, text: e.message }); }
    }
    if (all) {
      r.at = new Date().toISOString();
      // the device helper answers
      try { const pong = await require('./native.js').request('watchdog', 'PING', 5000); put('Device helper', { ok: pong === 'PONG', text: pong === 'PONG' ? 'answers' : `did not answer (${pong})` }); }
      catch (e) { put('Device helper', { ok: false, text: e.message }); }
      // the backups folder can be written to
      const dir = path.join(path.dirname(file), 'backups');
      try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, `.daily-check-${process.pid}`);
        fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
        put('Backups folder', { ok: true, text: 'can be written to' });
      } catch (e) { put('Backups folder', { ok: false, text: `cannot be written to: ${e.message}` }); }
      // free space where DeviceHub keeps its files
      try {
        const s = fs.statfsSync(path.dirname(file));
        const gb = (s.bavail * s.bsize) / 1024 ** 3;
        put('Disk space', { ok: gb >= 1, text: `${gb.toFixed(1)} GB free${gb < 1 ? ': backups may fail to save' : ''}` });
      } catch {}
      // a newer DeviceHub (only said; installing it is the Update button in Settings)
      try {
        const s = await require('./self-update.js').status();
        put('DeviceHub version', { ok: !s.error, text: s.error ? `could not check for updates: ${s.error}` : s.behind ? `a newer version is ready: Settings > Update (${s.latest})` : (s.git || s.zip) ? 'up to date' : 'updates not set up for this copy' });
      } catch {}
      // changes waiting for a device for more than 3 days
      const old = Object.values(core.devices).flatMap((d) => Object.values(core.waitingFor(d.id)).filter((c) => now - c.at > 3 * DAY).map((c) => `${d.adapter.title}: ${c.label}`));
      put('Waiting changes', { ok: !old.length, text: old.length ? `waiting over 3 days: ${old.join(', ')}` : 'none waiting long' });
    }
    if (dirty || all) save(r);
    const bad = Object.entries(r.items).filter(([, v]) => v.ok === false);
    if (bad.length && all) console.log(`[daily-check] ${bad.map(([k, v]) => `${k}: ${v.text}`).join('; ')}`);
    return r;
  } finally { busy = false; }
}

export function start(root, coreModule) {
  file = require('./data-dir.js').dataFile('daily-check.json', root);
  core = coreModule;
  // due: the first check 2 minutes after start when none ran in the last day, then each day
  const tick = () => {
    const r = read();
    const due = !r.at || Date.now() - new Date(r.at) > DAY;
    run({ all: due }).catch(() => {});
  };
  setTimeout(tick, 2 * 60 * 1000).unref?.();
  setInterval(tick, 10 * 60 * 1000).unref?.();
  // a device that just connected (the mouse waking) and is due: checked a few seconds later
  const was = {};
  core.onChange((id) => {
    const d = core.devices[id];
    if (!d) return;
    const before = was[id]; was[id] = d.status;
    if (d.status !== 'connected' || before === 'connected') return;   // only the moment it connects
    const last = read().items[d.adapter.title];
    if (last && last.ok !== null && Date.now() - new Date(last.at) < DAY) return;
    setTimeout(() => run().catch(() => {}), 5000);
  });
}

export const result = () => read();
