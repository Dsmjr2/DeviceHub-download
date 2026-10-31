// Battery care (21 Oct 2026, Shawn: "help extend battery life when it can"; on unless switched off in Settings).
// When a wireless device is at 20% or less and not charging, what costs its battery most and does not change how it
// works is turned down: the mouse's DPI light off and its polling rate at most 1000 Hz (8K polling uses several times
// the power), the headset's logo lights off (the mic light stays: it says the mic is muted). Once it charges, or is back
// above 30%, exactly what was there is put back, unless it was changed by hand meanwhile (then it is left as it is).
// What was turned down is kept in battery-care.json, so a restart in between still puts it back. Every change takes the
// normal path (backed up, written, read back) and says why in Activity. Reads only DeviceHub's own state, every 20 s.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { writeAtomic } = require('./safe-write.js');
import { fits, writable, batteryCareProblem, makerAppNow as makerAppDefault } from './my-devices.mjs';
import { showAdded } from '../public/core/profiles.js';

const LOW = 20, BACK = 30;
// per device: what is turned down, and how
const PLAN = {
  mouse: [
    { key: 'dpiEffect', label: 'DPI light', down: (v) => (v && v !== 'off' ? 'off' : undefined), show: (v) => v },
    { key: 'pollingRate', label: 'Polling rate', down: (v) => (Number(v) > 1000 ? 1000 : undefined), show: (v) => `${v} Hz` },
  ],
  headset: [
    { key: 'logoBrightness', label: 'Logo lights', down: (v) => (Number(v) > 0 ? 0 : undefined), show: (v) => (v ? `${v}%` : 'off') },
  ],
};

// While charging (Shawn, 22 Oct 2026: "all headset lights off when its charging"): the headset's logo lights and its mic
// light off, put back the same way when the cable comes out. Kept apart from the low-battery saving (its own entry in
// battery-care.json, "headset:charging"), and on whatever the Save device battery switch says.
const CHARGING = {
  headset: [
    { key: 'logoBrightness', label: 'Logo lights', down: (v) => (Number(v) > 0 ? 0 : undefined), show: (v) => (v ? `${v}%` : 'off') },
    { key: 'micLight', label: 'Mic light', down: (v) => (v ? false : undefined), show: (v) => (v ? 'on' : 'off') },
  ],
};

let core = null, file = null, settingsFile = null, saved = {}, busy = false;
// game mode's switches held now (helpers/game-mode.mjs status().saved) -> the battery care settings they cover
let heldBy = () => [];
const HELD = { polling: ['mouse:pollingRate'], lights: ['mouse:dpiEffect', 'headset:logoBrightness', 'headset:micLight'] };
const held = () => { try { return new Set((heldBy() || []).flatMap((k) => HELD[k] || [])); } catch { return new Set(); } };
export const holdBy = (fn) => { heldBy = typeof fn === 'function' ? fn : () => []; };
const on = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).batteryCare !== false; } catch { return true; } };
const save = () => { try { writeAtomic(file, JSON.stringify(saved, null, 1)); } catch {} };

async function tick() {
  if (busy) return; busy = true;
  try {
    for (const [id, plan] of Object.entries(PLAN)) {
      const d = core.devices[id];
      if (!d || d.status !== 'connected' || !d.battery || d.battery.percent == null) continue;
      // while the charging rule holds the headset's lights, the low-battery one leaves them
      if (saved[`${id}:charging`]) continue;
      const pct = d.battery.percent, charging = !!d.battery.charging, kind = d.adapter.kind.toLowerCase();
      const mine = saved[id];
      if (!mine && on() && pct <= LOW && !charging) {
        const changes = plan.map((p) => ({ ...p, was: d.values[p.key], to: p.down(d.values[p.key]) })).filter((c) => c.to !== undefined && c.was !== undefined);
        if (!changes.length) continue;
        saved[id] = { at: new Date().toISOString(), items: changes.map((c) => ({ key: c.key, was: c.was, to: c.to })) };
        save();
        core.log(`${d.adapter.title}: battery ${pct}%, so ${changes.map((c) => `${c.label} ${c.show(c.was)} → ${c.show(c.to)}`).join(', ')} to save it (put back once it charges)`, 'info', id);
        for (const c of changes) await core.write(id, c.key, c.to, { label: `${c.label} (battery care)`, display: c.show(c.to), noUndo: true }).catch(() => {});
      } else if (mine && (charging || pct >= BACK || !on())) {
        const h = held(), wait = mine.items.filter((it) => h.has(`${id}:${it.key}`));
        const back = mine.items.filter((it) => !h.has(`${id}:${it.key}`) && JSON.stringify(d.values[it.key]) === JSON.stringify(it.to));  // not changed by hand meanwhile
        if (!back.length) { if (wait.length) saved[id] = { ...mine, items: wait }; else delete saved[id]; save(); continue; }
        core.log(`${d.adapter.title}: ${charging ? 'charging' : `battery ${pct}%`}, so ${back.map((it) => `${plan.find((p) => p.key === it.key).label} back to ${plan.find((p) => p.key === it.key).show(it.was)}`).join(', ')}`, 'good', id);
        const left = [];
        for (const it of back) await core.write(id, it.key, it.was, { label: `${plan.find((p) => p.key === it.key).label} (battery care)`, display: plan.find((p) => p.key === it.key).show(it.was), noUndo: true }).catch(() => left.push(it));
        if (left.length || wait.length) saved[id] = { ...mine, items: [...left, ...wait] }; else delete saved[id];
        save();
      }
    }
    for (const [id, plan] of Object.entries(CHARGING)) {
      const d = core.devices[id], slot = `${id}:charging`;
      if (!d || d.status !== 'connected' || !d.battery) continue;
      const charging = !!d.battery.charging, mine = saved[slot];
      if (!mine && charging) {
        const changes = plan.map((p) => ({ ...p, was: d.values[p.key], to: p.down(d.values[p.key]) })).filter((c) => c.to !== undefined && c.was !== undefined);
        if (!changes.length) continue;
        saved[slot] = { at: new Date().toISOString(), items: changes.map((c) => ({ key: c.key, was: c.was, to: c.to })) };
        save();
        core.log(`${d.adapter.title}: charging, so ${changes.map((c) => `${c.label} ${c.show(c.was)} → ${c.show(c.to)}`).join(', ')} (put back when it is unplugged)`, 'info', id);
        for (const c of changes) await core.write(id, c.key, c.to, { label: `${c.label} (charging)`, display: c.show(c.to), noUndo: true }).catch(() => {});
      } else if (mine && !charging) {
        const back = mine.items.filter((it) => JSON.stringify(d.values[it.key]) === JSON.stringify(it.to));  // not changed by hand meanwhile
        if (!back.length) { delete saved[slot]; save(); continue; }
        core.log(`${d.adapter.title}: unplugged, so ${back.map((it) => `${plan.find((p) => p.key === it.key).label} back to ${plan.find((p) => p.key === it.key).show(it.was)}`).join(', ')}`, 'info', id);
        const left = [];
        for (const it of back) await core.write(id, it.key, it.was, { label: `${plan.find((p) => p.key === it.key).label} (charging)`, display: plan.find((p) => p.key === it.key).show(it.was), noUndo: true }).catch(() => left.push(it));
        if (left.length) saved[slot] = { ...mine, items: left }; else delete saved[slot];
        save();
      }
    }
    await addedTick();
  } finally { busy = false; }
}

// ---------- Devices added in my-devices (22 Oct 2026; docs/handoff/battery-added-devices.md) ----------
// Only a driver that declares batteryCare (helpers/my-devices.mjs batteryCareProblem) gets these, and only the one
// setting it names per rule. The same thresholds and the same saved entries as above (battery-care.json: "<id>" for
// low battery, "<id>:charging" while charging; { at, items: [{ key, was, to }] }). Every change, down and back, goes the
// way a profile's does (helpers/profile-added.mjs): the driver must allow the write now (a library driver's guard:
// Turn on settings pressed and its check passed; the person's own driver: not marked read-only), the maker's app must be
// closed (and known to be), a backup must succeed first, then one write through core.write, and the value it confirms
// must be the one asked for. Nothing is asked of the device or Windows unless a change is due; a change that was left
// out waits RETRY_MS before it is tried again, so a low device does not take a backup every 20 s.
const RETRY_MS = 30 * 60 * 1000;
const tried = {};          // slot -> when a change was last left out (in memory)
let makerApp = makerAppDefault;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addedOf = () => Object.values(core.devices || {}).filter((d) => d?.adapter?.plugin && d.adapter.batteryCare && !batteryCareProblem(d.adapter));
const settingOf = (a, key) => { try { return (Array.isArray(a.settings) ? a.settings : []).find((s) => s?.key === key) || null; } catch { return null; } };
const labelOf = (a, key) => settingOf(a, key)?.label || key;
// may this setting be written with this value now? { ok, s } or { ok: false, why }
function mayChange(a, key, value) {
  const s = settingOf(a, key);
  if (!s) return { ok: false, why: `${key} is not on this device now` };
  if (!writable(s)) return { ok: false, why: `${s.label} is a reading` };
  if (!fits(s, value)) return { ok: false, why: `${showAdded(s, value)} is not a value ${s.label} takes` };
  const w = typeof a.mayWrite === 'function' ? a.mayWrite(key) : { ok: !s.readOnly, why: s.hint || 'it is read-only' };
  return w?.ok ? { ok: true, s } : { ok: false, why: w?.why || 'its driver does not allow it now' };
}
// one change: { ok, s } written and read back as asked; { left: why } nothing written; { failed: why } the write failed
async function change(d, key, value, why) {
  const a = d.adapter, id = d.id;
  const w = mayChange(a, key, value);
  if (!w.ok) return { left: w.why };
  let m = {};
  try { m = (await makerApp(a)) || {}; } catch (e) { m = { unknown: e.message }; }
  if (m.app) return { left: `${m.app} is open: close it first` };
  if (m.unknown) return { left: "could not check whether the maker's app is open" };
  try { await core.backupNow(id, `before ${w.s.label} (${why})`); } catch { return { left: 'no backup could be taken' }; }
  try {
    const got = await core.write(id, key, value, { label: `${w.s.label} (${why})`, display: showAdded(w.s, value), noUndo: true });
    return same(got, value) ? { ok: true, s: w.s } : { failed: `it read back ${showAdded(w.s, got)}` };
  } catch (e) { return { failed: e.message }; }
}
// one rule for one device: slot is "<id>" (low battery) or "<id>:charging"; down = the rule's condition holds now
async function rule(d, slot, r, down, back, why, says) {
  const a = d.adapter, id = d.id, now = Date.now();
  if (tried[slot] && now - tried[slot] < RETRY_MS) return;
  const leftOut = (text) => { tried[slot] = now; core.log(text.slice(0, 300), 'info', id); };
  const mine = saved[slot];
  if (!mine && down) {
    const was = d.values?.[r.key];
    if (was === undefined || same(was, r.value)) return;   // not read yet, or already easy on its battery
    const c = await change(d, r.key, r.value, why);
    if (!c.ok) { leftOut(`${a.title}: ${says.down}, but ${labelOf(a, r.key)} was not changed: ${c.left || c.failed}`); return; }
    saved[slot] = { at: new Date().toISOString(), items: [{ key: r.key, was, to: r.value }] }; save();
    core.log(`${a.title}: ${says.down}, so ${c.s.label} ${showAdded(c.s, was)} → ${showAdded(c.s, r.value)} ${says.until}`, 'info', id);
  } else if (mine && back) {
    const items = mine.items.filter((it) => same(d.values?.[it.key], it.to));  // not changed by hand meanwhile
    if (!items.length) { delete saved[slot]; save(); return; }
    for (const it of items) {
      const c = await change(d, it.key, it.was, why);
      // left out (the maker's app open, not allowed now, no backup): kept, tried again later
      if (c.left) { leftOut(`${a.title}: ${labelOf(a, it.key)} not put back yet: ${c.left}`); return; }
      delete saved[slot]; save();
      if (c.ok) core.log(`${a.title}: ${says.back}, so ${c.s.label} back to ${showAdded(c.s, it.was)}`, says.backKind, id);
      else core.log(`${a.title}: ${labelOf(a, it.key)} could not be put back (${c.failed}); set it on its page`, 'bad', id);
    }
  }
}
async function addedTick() {
  for (const d of addedOf()) {
    if (d.status !== 'connected' || !d.battery) continue;
    const care = d.adapter.batteryCare, id = d.id;
    const pct = d.battery.percent, charging = !!d.battery.charging;
    // low battery: down at 20% or less and not charging (with the Save device battery switch on); back once it charges,
    // is at 30% again or the switch is off; left alone while the charging rule holds its setting
    if (care.lowBattery && pct != null && !saved[`${id}:charging`]) {
      await rule(d, id, care.lowBattery, on() && pct <= LOW && !charging, charging || pct >= BACK || !on(), 'battery care',
        { down: `battery ${pct}%`, until: 'to save it (put back once it charges)', back: charging ? 'charging' : `battery ${pct}%`, backKind: 'good' });
    }
    // while charging: down whatever the switch says (as the HS80's lights); back when it is unplugged
    if (care.charging) {
      await rule(d, `${id}:charging`, care.charging, charging, !charging, 'charging',
        { down: 'charging', until: '(put back when it is unplugged)', back: 'unplugged', backKind: 'info' });
    }
  }
}

export function start(root, coreModule) {
  core = coreModule;
  file = require('./data-dir.js').dataFile('battery-care.json', root);
  settingsFile = require('./data-dir.js').dataFile('settings.json', root);
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { saved = {}; }
  setInterval(() => tick().catch(() => {}), 20000).unref?.();  // every 20 s: a plugged-in headset goes dark soon after (it reads only DeviceHub's own state)
  setTimeout(() => tick().catch(() => {}), 30000).unref?.();
}
export const state = () => ({ on: on(), saved });
export const _test = { tick, PLAN, CHARGING, RETRY_MS, saved: () => saved, forget: () => { for (const k of Object.keys(tried)) delete tried[k]; },
  set: (c, f, s, opts = {}) => { core = c; file = f; settingsFile = s; saved = {}; for (const k of Object.keys(tried)) delete tried[k]; makerApp = opts.makerApp || makerAppDefault; } };
