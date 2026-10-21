// Battery care (21 Oct 2026, Shawn: "help extend battery life when it can"; on unless switched off in Settings).
// When a wireless device is at 20% or less and not charging, what costs its battery most and does not change how it
// works is turned down: the mouse's DPI light off and its polling rate at most 1000 Hz (8K polling uses several times
// the power), the headset's logo lights off (the mic light stays: it says the mic is muted). Once it charges, or is back
// above 30%, exactly what was there is put back, unless it was changed by hand meanwhile (then it is left as it is).
// What was turned down is kept in battery-care.json, so a restart in between still puts it back. Every change takes the
// normal path (backed up, written, read back) and says why in Activity. Reads only DeviceHub's own state once a minute.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { writeAtomic } = require('./safe-write.js');

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

let core = null, file = null, settingsFile = null, saved = {}, busy = false;
const on = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).batteryCare !== false; } catch { return true; } };
const save = () => { try { writeAtomic(file, JSON.stringify(saved, null, 1)); } catch {} };

async function tick() {
  if (busy) return; busy = true;
  try {
    for (const [id, plan] of Object.entries(PLAN)) {
      const d = core.devices[id];
      if (!d || d.status !== 'connected' || !d.battery || d.battery.percent == null) continue;
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
        const back = mine.items.filter((it) => JSON.stringify(d.values[it.key]) === JSON.stringify(it.to));  // not changed by hand meanwhile
        delete saved[id]; save();
        if (!back.length) continue;
        core.log(`${d.adapter.title}: ${charging ? 'charging' : `battery ${pct}%`}, so ${back.map((it) => `${plan.find((p) => p.key === it.key).label} back to ${plan.find((p) => p.key === it.key).show(it.was)}`).join(', ')}`, 'good', id);
        for (const it of back) await core.write(id, it.key, it.was, { label: `${plan.find((p) => p.key === it.key).label} (battery care)`, display: plan.find((p) => p.key === it.key).show(it.was), noUndo: true }).catch(() => {});
      }
    }
  } finally { busy = false; }
}

export function start(root, coreModule) {
  core = coreModule;
  file = path.join(root, 'battery-care.json');
  settingsFile = path.join(root, 'settings.json');
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { saved = {}; }
  setInterval(() => tick().catch(() => {}), 60000).unref?.();
  setTimeout(() => tick().catch(() => {}), 30000).unref?.();
}
export const state = () => ({ on: on(), saved });
export const _test = { tick, PLAN, set: (c, f, s) => { core = c; file = f; settingsFile = s; saved = {}; } };
