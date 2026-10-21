// Setup file (19 Oct 2026): every device's settings and the profiles in ONE file, to keep, move to the laptop or a
// new PC, or put back after an experiment, a firmware update or a reset.
//
// Saving takes a fresh backup of each connected device (the same full read every change starts with) and bundles
// them with the profiles. Loading compares the file with what the devices hold now, lists every difference, and on
// "Load" writes them one at a time through the normal write path (backed up first, each one read back).
// Volume and mute are left out on purpose: they are moment-to-moment, not part of a setup.
// Sound (19 Oct 2026): DeviceHub's EQ presets, speaker / mic curves, mic tools and its own options travel too.
import { devices, backupNow, writeBatch, log } from './devices.js';
import { loadProfiles, saveProfiles, PROFILE_KEYS, keyLabel } from './profiles.js';
import { restorePlan } from '../pages/backups.js';

export const SETUP_KIND = 'devicehub-setup';

const LABELS = {
  mouse: { stageCount: 'DPI stages in the cycle', turbo: 'Turbo mode', sleep: 'Auto sleep', dpiEffect: 'DPI light',
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`color${i}`, `DPI stage ${i + 1} color`])) },
  headset: { sidetone: 'Sidetone level', sidetoneOn: 'Sidetone', micBoost: 'Mic boost', logoBrightness: 'Ear Cup Logo',
    micLight: 'Mic light', autoOff: 'Sleep after', led: 'Headset Color' },
  keyboard: {},
};
const NOT_IN_SETUP = new Set(['vol:playback', 'vol:recording', 'mute:playback', 'mute:recording']);
const allowFor = (id) => (k) => !NOT_IN_SETUP.has(k) && (!!PROFILE_KEYS[id]?.[k] || Object.hasOwn(LABELS[id] || {}, k));
const labelFor = (id) => (k) => LABELS[id]?.[k] || keyLabel(id, k);

// The mouse's active stage must sit inside the stage cycle at every step: grow the cycle first, shrink it last.
function order(id, plan) {
  if (id !== 'mouse') return plan;
  const count = plan.find((p) => p.key === 'stageCount');
  if (!count) return plan;
  const rest = plan.filter((p) => p !== count);
  return count.to >= (devices.mouse.values.stageCount ?? 0) ? [count, ...rest] : [...rest, count];
}

export async function saveSetup() {
  const out = { kind: SETUP_KIND, version: 1, savedAt: new Date().toISOString(), devices: {}, profiles: await loadProfiles() };
  try { out.sound = await (await fetch('/api/sound-setup')).json(); } catch {}
  const skipped = [];
  for (const [id, d] of Object.entries(devices)) {
    if (d.status !== 'connected') { skipped.push(d.adapter.title); continue; }
    const name = await backupNow(id, 'setup file');
    out.devices[id] = await (await fetch(`/api/backups/${encodeURIComponent(name)}`)).json();
  }
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `DeviceHub setup ${out.savedAt.slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  log(`Setup file saved (${Object.keys(out.devices).length} devices${skipped.length ? `; not connected: ${skipped.join(', ')}` : ''})`, 'good');
  return { saved: Object.keys(out.devices), skipped };
}

// What loading this file would change: [{ id, title, plan }], the profiles change (or null), and the devices the
// file holds that are not connected now.
export async function planSetup(file) {
  if (file?.kind !== SETUP_KIND || !file.devices) throw new Error('this is not a DeviceHub setup file');
  const changes = [], notConnected = [];
  for (const [id, b] of Object.entries(file.devices)) {
    const d = devices[id];
    if (!d || b?.device !== id) continue;
    if (d.status !== 'connected') { notConnected.push(d.adapter.title); continue; }
    const plan = order(id, restorePlan(id, b, allowFor(id), labelFor(id)));
    if (plan.length) changes.push({ id, title: d.adapter.title, kind: d.adapter.kind, plan });
  }
  let profiles = null;
  if (Array.isArray(file.profiles)) {
    const now = await loadProfiles();
    if (JSON.stringify(now) !== JSON.stringify(file.profiles)) profiles = { from: now.length, to: file.profiles.length, list: file.profiles };
  }
  // sound: one line when anything in it differs (the EQ store and DeviceHub's options)
  let sound = null;
  if (file.sound && (file.sound.eq || file.sound.settings)) {
    try {
      const now = await (await fetch('/api/sound-setup')).json();
      const differs = (a, b) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
      if ((file.sound.eq && differs(file.sound.eq, now.eq)) || (file.sound.settings && differs(file.sound.settings, now.settings))) sound = file.sound;
    } catch {}
  }
  return { changes, profiles, notConnected, sound };
}

export async function loadSetup(file, planned) {
  let done = 0, failed = 0;
  for (const c of planned.changes) {
    const r = await writeBatch(c.id, c.plan.map((p) => ({ key: p.key, value: p.to, label: p.label, display: p.show })), `before loading the setup file from ${file.savedAt?.slice(0, 10) || 'a file'}`);
    done += r.done; failed += r.failed;
  }
  if (planned.profiles) { await saveProfiles(planned.profiles.list); done++; }
  if (planned.sound) {
    const r = await fetch('/api/sound-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(planned.sound) });
    if (r.ok) done++; else failed++;
  }
  log(`Setup file loaded: ${done} changed${failed ? `, ${failed} failed` : ''}`, failed ? 'bad' : 'good');
  return { done, failed };
}
