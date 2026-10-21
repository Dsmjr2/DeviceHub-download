// Profiles: a saved set of values for all three devices, applied one confirmed write at a time. Since 20 Oct 2026 a
// profile also keeps each monitor's brightness, contrast and speaker volume (profile.monitors, keyed by the monitor's
// hardware id, so a profile saved on one PC changes nothing on another PC's monitors).
import { devices, write, log, isDemo } from './devices.js';
import { env } from './env.js';
import { LIFT_OFF, BUTTONS, ACTIONS } from '../devices/pulsar.js';

const onOff = (v) => (v ? 'on' : 'off');
export const PROFILE_KEYS = {
  mouse: {
    pollingRate: ['Polling rate', (v) => `${v} Hz`], dpiStage: ['DPI stage', (v) => `#${v}`], liftOff: ['Lift-off', (v) => LIFT_OFF[v]],
    debounce: ['Debounce', (v) => `${v} ms`], motionSync: ['Motion sync', onOff], angleSnap: ['Angle snapping', onOff], ripple: ['Ripple control', onOff],
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`dpi${i}`, [`DPI stage ${i + 1}`, (v) => `${v}`]])),
    ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`btn${i}`, [BUTTONS[i], (v) => ACTIONS[v]?.label || v]])),
  },
  keyboard: { brightness: ['Brightness', (v) => `${Math.round((v / 255) * 100)}%`], effect: ['Effect', (v) => `#${v}`], speed: ['Effect speed', (v) => `${Math.round((v / 255) * 100)}%`], hue: ['Hue', (v) => v], saturation: ['Saturation', (v) => v] },
  headset: { 'vol:playback': ['Volume', (v) => `${v}%`], 'vol:recording': ['Mic level', (v) => `${v}%`], 'mute:recording': ['Mic muted', onOff], led: ['LED color', (v) => v] },
};
export const MONITOR_KEYS = { brightness: ['Brightness', (v) => `${v}%`], contrast: ['Contrast', (v) => `${v}%`], volume: ['Speaker volume', (v) => `${v}%`] };
const keysOf = (dev) => (dev === 'monitor' ? MONITOR_KEYS : PROFILE_KEYS[dev]);
export const keyLabel = (dev, key) => keysOf(dev)?.[key]?.[0] || key;
export const showValue = (dev, key, v) => (v == null ? '—' : (keysOf(dev)?.[key]?.[1] || String)(v));

// the monitors (helpers/monitors.js), read when profiles need them; null until read, [] in demo mode or on a PC
// whose monitors take no settings
let monitors = null;
export const monitorList = () => monitors;
export async function loadMonitors(fresh) {
  if (isDemo()) return (monitors = []);
  try { monitors = (await env.api(`/api/monitors${fresh ? '?fresh=1' : ''}`)).filter((m) => m.ddc); } catch { monitors ||= []; }
  return monitors;
}
// what the monitors are set to now (from the last read)
export function captureMonitors() {
  const out = {};
  for (const m of monitors || []) {
    const vals = {};
    for (const k of Object.keys(MONITOR_KEYS)) if (m[k]) vals[k] = m[k].value;
    if (Object.keys(vals).length) out[m.id] = { name: m.name, ...vals };
  }
  return out;
}

export const PROFILE_COLORS = ['#c47b55', '#8299a8', '#9d8ca6', '#86a77f', '#b39a6e', '#b57f86'];

// Demo mode keeps profiles in memory so it never touches the real profiles.json.
let demoList = null;
export async function loadProfiles() {
  if (isDemo()) return (demoList ||= [{ name: 'Demo: aim training', color: PROFILE_COLORS[1], devices: { mouse: { dpiStage: 1, pollingRate: 8000 } } }]);
  try { return await env.api('/api/profiles'); } catch { return []; }
}
export async function saveProfiles(list) {
  if (isDemo()) { demoList = list; return; }
  await env.api('/api/profiles', list);
}

// What the connected devices are set to now (only values we can write back).
export function capture() {
  const out = {};
  for (const [id, keys] of Object.entries(PROFILE_KEYS)) {
    const d = devices[id];
    if (d?.status !== 'connected') continue;
    const vals = {};
    for (const k of Object.keys(keys)) {
      const v = d.values[k];
      if (v == null) continue;
      if (id === 'mouse' && d.adapter.trusted && !d.adapter.trusted(k)) continue;
      vals[k] = v;
    }
    if (Object.keys(vals).length) out[id] = vals;
  }
  return out;
}

export function diff(profile) {
  const rows = [];
  for (const [id, vals] of Object.entries(profile.devices || {})) {
    const d = devices[id];
    if (!d || !PROFILE_KEYS[id]) continue;
    for (const [k, v] of Object.entries(vals || {})) {
      if (!Object.hasOwn(PROFILE_KEYS[id], k)) continue; // a profile only ever applies the settings profiles are meant to hold
      const now = d?.values?.[k];
      if (now === v) continue;
      rows.push({ id, key: k, from: now, to: v, ready: d?.status === 'connected' });
    }
  }
  // monitors: only the ones on this PC (another PC's monitors in the profile are left out, not counted)
  for (const [mid, vals] of Object.entries(profile.monitors || {})) {
    const m = (monitors || []).find((x) => x.id === mid);
    if (!m) continue;
    for (const k of Object.keys(MONITOR_KEYS)) {
      if (vals[k] == null || !m[k] || m[k].value === vals[k]) continue;
      rows.push({ id: 'monitor', monitorId: mid, monitorName: m.name, key: k, from: m[k].value, to: vals[k], ready: true });
    }
  }
  return rows;
}

// retry: a quiet try again of what is left (auto-switch waiting for an asleep device): failures are not logged, and
// the summary only when something changed. 'asleep' counts the changes waiting on an asleep device: failed because it
// was asleep, or skipped because it is marked asleep.
export async function apply(profile, { retry } = {}) {
  if (profile.monitors && Object.keys(profile.monitors).length) await loadMonitors(true);
  const rows = diff(profile);
  let done = 0, failed = 0, skipped = 0, asleep = 0;
  for (const r of rows) {
    if (!r.ready) { skipped++; if (devices[r.id]?.status === 'asleep') asleep++; continue; }
    try {
      if (r.id === 'monitor') {
        // the server backs the monitor up, writes and reads back (helpers/monitors.js)
        await env.api('/api/monitors/set', { id: r.monitorId, feature: r.key, value: r.to, silent: true });
        const m = (monitors || []).find((x) => x.id === r.monitorId); if (m?.[r.key]) m[r.key].value = r.to;
      } else await write(r.id, r.key, r.to, { label: keyLabel(r.id, r.key), display: showValue(r.id, r.key, r.to), silent: true, quietFail: retry });
      done++;
    } catch (e) { failed++; if (/asleep|out of range/i.test(e?.message || '')) asleep++; }
  }
  if (!retry || done) log(`Profile "${profile.name}": ${done} changed${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped (device not connected)` : ''}`, failed > asleep ? 'bad' : 'good');
  return { done, failed, skipped, asleep };
}
