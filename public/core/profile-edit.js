// Editing a profile in its card (28 Oct 2026, Shawn: "how do I update profiles? ... I dont see any way to change or add
// settings on it"): change a saved value, take one out, or add one the profile does not set yet. These are the pure
// parts: what control each setting gets, the values it may hold (the same ones the device pages write), and turning
// what was typed back into a stored value. Nothing here writes to a device; a profile is only saved (pages/profiles.js),
// and Apply profile writes it later, one confirmed write at a time as before.
import { PROFILE_KEYS, MONITOR_KEYS, keyLabel, showValue } from './profiles.js';
import { POLLING, LIFT_OFF, ACTIONS, DPI_SLOTS, DPI_MAX, snapDpi } from '../devices/pulsar.js';
import { EFFECTS } from '../devices/keycodes.js';

const HEX = /^#[0-9a-f]{6}$/i;
const range = (min, max, unit = '', step = 1) => ({ kind: 'number', min, max, step, unit });
const choice = (options) => ({ kind: 'choice', options });
const TOGGLE = { kind: 'toggle' };
const COLOR = { kind: 'color' };
// keyboard brightness and speed are kept 0-255 and shown as a percent, as the Keyboard page does
const PCT255 = { ...range(0, 100, '%'), toEdit: (v) => Math.round((v / 255) * 100), fromEdit: (x) => Math.round((x / 100) * 255) };

function builtIn(dev, key) {
  if (dev === 'mouse') {
    if (key === 'pollingRate') return choice(Object.keys(POLLING).map((r) => ({ value: Number(r), label: `${Number(r).toLocaleString('en-US')} Hz` })));
    if (key === 'dpiStage') return choice(Array.from({ length: DPI_SLOTS }, (_, i) => ({ value: i + 1, label: `stage ${i + 1}` })));
    if (key === 'liftOff') return choice(Object.entries(LIFT_OFF).map(([v, label]) => ({ value: Number(v), label })));
    if (key === 'debounce') return range(0, 15, 'ms');   // the mouse stores 0-15 ms (devices/mouse-adapter.js)
    if (/^dpi\d$/.test(key)) return { ...range(50, DPI_MAX, 'DPI', 10), fromEdit: snapDpi };
    if (/^btn[1-5]$/.test(key)) return choice(Object.entries(ACTIONS).map(([value, a]) => ({ value, label: a.label })));
    if (['motionSync', 'angleSnap', 'ripple'].includes(key)) return TOGGLE;
  }
  if (dev === 'keyboard') {
    if (key === 'brightness' || key === 'speed') return PCT255;
    if (key === 'effect') return choice(EFFECTS.map((e, i) => ({ value: i, label: e[0].toUpperCase() + e.slice(1) })));
    if (key === 'hue' || key === 'saturation') return range(0, 255);
  }
  if (dev === 'headset') {
    if (key === 'vol:playback' || key === 'vol:recording') return range(0, 100, '%');
    if (key === 'mute:recording') return TOGGLE;
    if (key === 'led') return COLOR;
  }
  if (dev === 'monitor' && Object.hasOwn(MONITOR_KEYS, key)) return range(0, 100, '%');
  return null;
}

// an added device's setting (my-devices): only the plain kinds; zones and button maps stay as saved (remove only)
function addedField(s) {
  if (!s || s.readOnly) return null;
  if (s.type === 'toggle') return TOGGLE;
  if (s.type === 'slider' && Number.isFinite(s.min) && Number.isFinite(s.max)) return range(s.min, s.max, s.unit || '', s.step || 1);
  if (s.type === 'choice' && (s.options || []).length) return choice(s.options.map((o) => ({ value: o.value, label: String(o.label ?? o.value) })));
  if (s.type === 'color' && !s.zones) return COLOR;
  return null;
}

// The control a setting gets: { kind: 'number' | 'choice' | 'toggle' | 'color', ... }, or null (shown, not editable).
// A value saved earlier that is not among the choices (a key combination on a mouse button) stays as one more choice.
export function fieldOf(dev, key, { setting, current } = {}) {
  const f = setting !== undefined ? addedField(setting) : builtIn(dev, key);
  if (!f || f.kind !== 'choice' || current === undefined) return f;
  if (f.options.some((o) => same(o.value, current))) return f;
  return { ...f, options: [...f.options, { value: current, label: setting ? String(current) : showValue(dev, key, current) }] };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// what the box shows for a stored value
export const toEdit = (f, v) => (f?.toEdit && typeof v === 'number' ? f.toEdit(v) : v);

// what was typed or picked -> { ok, value } or { ok: false, error } in a few plain words
export function fromEdit(f, raw) {
  if (!f) return { ok: false, error: 'cannot be changed here' };
  if (f.kind === 'toggle') return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, error: 'pick on or off' };
  if (f.kind === 'color') {
    const c = String(raw || '').trim().toLowerCase();
    return HEX.test(c) ? { ok: true, value: c } : { ok: false, error: 'pick a color' };
  }
  if (f.kind === 'choice') {
    const o = f.options.find((x) => same(x.value, raw) || String(x.value) === String(raw));
    return o ? { ok: true, value: o.value } : { ok: false, error: 'pick one of the choices' };
  }
  const s = String(raw ?? '').trim();
  const x = Number(s);
  if (!s || !Number.isFinite(x)) return { ok: false, error: 'type a number' };
  if (x < f.min || x > f.max) return { ok: false, error: `use ${f.min} to ${f.max}${f.unit ? ` ${f.unit}` : ''}` };
  const stepped = Math.round(x / f.step) * f.step;
  return { ok: true, value: f.fromEdit ? f.fromEdit(stepped) : stepped };
}

// A value to start a newly added setting with: what the device is set to now when that is a valid value, else the
// first choice or the bottom of the range (it is only saved, never written, until Apply profile).
export function startValue(f, now) {
  if (!f) return undefined;
  if (now !== undefined && now !== null) {
    const r = fromEdit(f, toEdit(f, now));
    if (r.ok) return f.kind === 'number' && !f.fromEdit ? now : r.value;
  }
  if (f.kind === 'toggle') return false;
  if (f.kind === 'color') return '#ffffff';
  if (f.kind === 'choice') return f.options[0].value;
  return f.fromEdit ? f.fromEdit(f.min) : f.min;
}

// The settings a profile could still add: the three built-in devices' profile keys it does not set, and the monitor
// keys of each monitor it keeps or this PC has. -> [{ ref: 'd|mouse|debounce' | 'm|<monitor id>|contrast', group, label }]
export function addable(draft, { monitors = [], groupName = (id) => id } = {}) {
  const out = [];
  for (const [dev, keys] of Object.entries(PROFILE_KEYS)) {
    const has = draft.devices?.[dev] || {};
    for (const k of Object.keys(keys)) if (!Object.hasOwn(has, k) && builtIn(dev, k)) out.push({ ref: `d|${dev}|${k}`, group: groupName(dev), label: keyLabel(dev, k) });
  }
  const mons = new Map(Object.entries(draft.monitors || {}).map(([id, v]) => [id, v?.name || 'Monitor']));
  for (const m of monitors) if (![...mons.keys()].some((id) => id === m.id || String(id).split('#')[0] === String(m.id).split('#')[0])) mons.set(m.id, m.name || 'Monitor');
  for (const [id, name] of mons) {
    for (const k of Object.keys(MONITOR_KEYS)) if (draft.monitors?.[id]?.[k] == null) out.push({ ref: `m|${id}|${k}`, group: name, label: keyLabel('monitor', k) });
  }
  return out;
}

// A setting reference -> its place in a profile: 'd|<dev>|<key>', 'm|<monitor id>|<key>', 'a|<added id>|<key>'. A
// monitor id holds '#' and '&' but never '|'.
export function parseRef(ref) {
  const [t, id, ...rest] = String(ref).split('|');
  return { t, id, key: rest.join('|') };
}
export function getAt(p, ref) {
  const { t, id, key } = parseRef(ref);
  if (t === 'd') return p.devices?.[id]?.[key];
  if (t === 'm') return p.monitors?.[id]?.[key];
  if (t === 'a') return p.added?.[id]?.values?.[key];
  return undefined;
}
// a copy of the profile with that one value set (monitorName for a monitor the profile did not keep yet)
export function setAt(p, ref, value, { monitorName, addedTitle } = {}) {
  const { t, id, key } = parseRef(ref);
  const o = structuredClone(p);
  if (t === 'd') { o.devices ||= {}; o.devices[id] = { ...(o.devices[id] || {}), [key]: value }; }
  if (t === 'm') { o.monitors ||= {}; o.monitors[id] = { name: o.monitors[id]?.name || monitorName || 'Monitor', ...(o.monitors[id] || {}), [key]: value }; }
  if (t === 'a') { o.added ||= {}; const e = o.added[id] || { title: addedTitle || id, values: {} }; o.added[id] = { ...e, values: { ...(e.values || {}), [key]: value } }; }
  return o;
}
// a copy without that one value; a device left with nothing is taken out of the profile
export function removeAt(p, ref) {
  const { t, id, key } = parseRef(ref);
  const o = structuredClone(p);
  if (t === 'd' && o.devices?.[id]) { delete o.devices[id][key]; if (!Object.keys(o.devices[id]).length) delete o.devices[id]; }
  if (t === 'm' && o.monitors?.[id]) { delete o.monitors[id][key]; if (!Object.keys(o.monitors[id]).some((k) => k !== 'name')) delete o.monitors[id]; }
  if (t === 'a' && o.added?.[id]?.values) { delete o.added[id].values[key]; if (!Object.keys(o.added[id].values).length) delete o.added[id]; }
  if (o.monitors && !Object.keys(o.monitors).length) delete o.monitors;
  if (o.added && !Object.keys(o.added).length) delete o.added;
  return o;
}
// how many settings a profile holds (the same three places)
export function countSettings(p) {
  let n = 0;
  for (const v of Object.values(p.devices || {})) n += Object.keys(v || {}).length;
  for (const v of Object.values(p.monitors || {})) n += Object.keys(MONITOR_KEYS).filter((k) => v?.[k] != null).length;
  for (const v of Object.values(p.added || {})) n += Object.keys(v?.values || {}).length;
  return n;
}
