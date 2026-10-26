// Profiles: a saved set of values for all three devices, applied one confirmed write at a time. Since 20 Oct 2026 a
// profile also keeps each monitor's brightness, contrast and speaker volume (profile.monitors, keyed by the monitor's
// hardware id, so a profile saved on one PC changes nothing on another PC's monitors).
// Since 22 Oct 2026 a profile also keeps devices added in my-devices (library and the person's own drivers) as
// profile.added = { <id>: { title, values: { <key>: value } } } (docs/handoff/profiles-added-devices.md). The three
// built-in devices stay in profile.devices exactly as before. An added device is applied by the agent
// (helpers/profile-added.mjs): only settings its driver allows now, backed up first, one at a time, read back; the rest
// is skipped with one Activity line. A device that is not plugged in is left out quietly.
import { devices, write, log, isDemo, isRemote } from './devices.js';
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
// the monitor a profile saved, on this PC: the same hardware id, or else the one monitor of the same model (Windows
// can give a monitor a new instance id after a driver update or a cable change; the model code is the part before #).
// Two monitors of that model and no exact match: neither is guessed.
export function findMonitor(savedId) {
  const list = monitors || [];
  const exact = list.find((x) => x.id === savedId);
  if (exact) return exact;
  const model = String(savedId).split('#')[0];
  const same = model ? list.filter((x) => String(x.id).split('#')[0] === model) : [];
  return same.length === 1 ? same[0] : null;
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

// ---------- added devices (my-devices) ----------
const sameV = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isAdded = (d) => !!d?.adapter?.plugin;
const settingsOf = (a) => (Array.isArray(a?.settings) ? a.settings : []);
// a quick shape check for the window and demo mode; the agent checks with helpers/my-devices.mjs fits()
const HEXC = /^#[0-9a-f]{6}$/;
export function fitsLite(s, v) {
  if (s.type === 'toggle') return typeof v === 'boolean';
  if (s.type === 'slider') return typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max;
  if (s.type === 'choice') return (s.options || []).some((o) => sameV(o.value, v));
  if (s.type === 'color') return s.zones ? !!v && typeof v === 'object' && s.zones.every((z) => HEXC.test(v[z.value] || '')) : HEXC.test(v || '');
  if (s.type === 'remap') return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
  return false;
}
// a value as one short line: "on", "Fast", "800 DPI", "#ff8800", "Wheel #ff0000, Logo #00ff00", "Side: Back"
export function showAdded(s, v) {
  if (v == null) return '—';
  if (!s) return typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.type === 'toggle') return onOff(v);
  if (s.type === 'choice') return String((s.options || []).find((o) => sameV(o.value, v))?.label ?? v);
  if (s.type === 'slider' || s.type === 'display') return `${v}${s.unit ? ` ${s.unit}` : ''}`;
  if (typeof v !== 'object') return String(v);
  const name = (list, k) => (list || []).find((o) => o.value === k)?.label || k;
  if (s.type === 'color') return Object.entries(v).map(([z, c]) => `${name(s.zones, z)} ${c}`).join(', ');
  if (s.type === 'remap') return Object.entries(v).map(([b, x]) => `${name(s.buttons, b)}: ${name(s.targets, x)}`).join(', ');
  return JSON.stringify(v);
}
// why a setting is not written, in a few plain words
function blockedWhy(w, s) {
  const why = String(w?.why || s?.hint || '');
  if (w?.gated || /Turn on settings/i.test(why)) return 'press Turn on settings on its page first';
  if (/own driver/i.test(why)) return "DeviceHub's own driver runs it";
  return 'read-only until its check passes';
}
// What applying these values to this added device would do: todo = [{ key, value, label, from }] (differs and may be
// written), skipped = [{ key, label, why }]. Settings that already match are in neither. mayWrite(key) -> { ok, why,
// gated } is the guarded driver's own answer (the agent); without it a setting's readOnly mark decides (the window).
export function planAdded(a, values, current = {}, { fits = fitsLite, mayWrite = a?.mayWrite } = {}) {
  const todo = [], skipped = [];
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { todo, skipped };
  const list = settingsOf(a);
  for (const [key, value] of Object.entries(values)) {
    const s = list.find((x) => x.key === key);
    if (!s) { skipped.push({ key, label: key, why: 'not on this device now' }); continue; }
    if (s.type === 'display') { skipped.push({ key, label: s.label, why: 'a reading, never written' }); continue; }
    if (!fits(s, value)) { skipped.push({ key, label: s.label, why: 'not a value it takes' }); continue; }
    if (sameV(current?.[key], value)) continue;
    const w = typeof mayWrite === 'function' ? mayWrite.call(a, key) : { ok: !s.readOnly, why: s.hint };
    if (!w?.ok) { skipped.push({ key, label: s.label, why: blockedWhy(w, s) }); continue; }
    todo.push({ key, value, label: s.label, from: current?.[key] });
  }
  return { todo, skipped };
}
// the one Activity line for what a profile left out on one device
export const skippedLine = (profileName, title, skipped) => `Profile "${profileName}": ${title}: skipped ${skipped.map((x) => `${x.label} (${x.why})`).join(', ')}`.slice(0, 300);

// What the connected added devices are set to now: every setting except readings (display), colors and remaps as
// their values. Read-only settings are kept too: whether one may be written is decided when the profile is applied.
export function captureAdded() {
  const out = {};
  for (const d of Object.values(devices)) {
    if (!isAdded(d) || d.status !== 'connected') continue;
    const vals = {};
    for (const s of settingsOf(d.adapter)) {
      if (!s || s.type === 'display') continue;
      const v = d.values?.[s.key];
      if (v == null) continue;
      vals[s.key] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    }
    if (Object.keys(vals).length) out[d.adapter.id] = { title: d.adapter.title, values: vals };
  }
  return out;
}

// one added device's part of a profile, where it runs: the agent itself, the agent from a window, or demo mode
// (pretend devices: the same plan, written through the page path). null = not applied here.
async function applyAddedDevice(body) {
  if (env.agent && typeof env.applyAdded === 'function') return env.applyAdded(body);
  if (isRemote()) return env.api('/api/agent/profile-added', body);
  if (!isDemo()) return null;
  const d = devices[body.id];
  if (!isAdded(d) || d.status !== 'connected') return { done: 0, failed: 0, absent: true };
  const { todo, skipped } = planAdded(d.adapter, body.values, d.values);
  let done = 0, failed = 0;
  for (const x of todo) {
    try { await write(body.id, x.key, x.value, { label: x.label, display: showAdded(settingsOf(d.adapter).find((s) => s.key === x.key), x.value), silent: true }); done++; } catch { failed++; }
  }
  if (skipped.length) log(skippedLine(body.name, d.adapter.title, skipped), 'info', body.id);
  return { done, failed, skipped: skipped.length };
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
    const m = findMonitor(mid);
    if (!m) continue;
    for (const k of Object.keys(MONITOR_KEYS)) {
      if (vals[k] == null || !m[k] || m[k].value === vals[k]) continue;
      rows.push({ id: 'monitor', monitorId: m.id, savedId: mid, monitorName: m.name, key: k, from: m[k].value, to: vals[k], ready: true });
    }
  }
  // added devices: only the ones connected now (one not plugged in is left out, not counted). A setting that would be
  // skipped is a row with blocked: why (shown in the preview, not counted as a difference).
  for (const [id, entry] of Object.entries(profile.added || {})) {
    const d = devices[id];
    if (!isAdded(d) || d.status !== 'connected') continue;
    const { todo, skipped } = planAdded(d.adapter, entry?.values, d.values);
    const st = (k) => settingsOf(d.adapter).find((s) => s.key === k);
    for (const x of todo) rows.push({ id, key: x.key, from: x.from, to: x.value, ready: true, added: true, title: d.adapter.title, label: x.label, fromText: showAdded(st(x.key), x.from), toText: showAdded(st(x.key), x.value) });
    for (const x of skipped) rows.push({ id, key: x.key, ready: false, added: true, blocked: x.why, title: d.adapter.title, label: x.label, to: entry.values[x.key], fromText: showAdded(st(x.key), d.values?.[x.key]), toText: showAdded(st(x.key), entry.values[x.key]) });
  }
  return rows;
}

// retry: a quiet try again of what is left (auto-switch waiting for an asleep device): failures are not logged, and
// the summary only when something changed. 'asleep' counts the changes waiting on an asleep device: failed because it
// was asleep, or skipped because it is marked asleep.
// tells DeviceHub which profile is on now (null: a game closed with no profile to go back to); helpers/wifi-pause.mjs
// decides, and does nothing unless Wi-Fi pause was set up
export function wifiProfile(name) {
  if (isDemo()) return;
  env.api('/api/wifi-pause/profile', { name }).catch(() => {});
}
export async function apply(profile, { retry } = {}) {
  if (profile.monitors && Object.keys(profile.monitors).length) await loadMonitors(true);
  const rows = diff(profile);
  let done = 0, failed = 0, skipped = 0, asleep = 0;
  for (const r of rows) {
    if (r.added) continue;   // added devices: below, one device at a time through the agent
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
  // added devices, after the three built-in ones; not on a quiet retry (that waits for an asleep built-in device only)
  if (!retry) {
    for (const [id, entry] of Object.entries(profile.added || {})) {
      if (!isAdded(devices[id]) || devices[id].status !== 'connected') continue;   // not plugged in: left out quietly
      try {
        const r = await applyAddedDevice({ id, values: entry?.values || {}, name: profile.name });
        if (r) { done += r.done || 0; failed += r.failed || 0; }
      } catch { failed++; }
    }
  }
  // Wi-Fi scans: Gaming pauses them only when the person set it up and turned it on; any other profile resumes them
  if (!retry) wifiProfile(profile.name);
  if (!retry || done) log(`Profile "${profile.name}": ${done} changed${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped (device not connected)` : ''}`, failed > asleep ? 'bad' : 'good');
  return { done, failed, skipped, asleep };
}
