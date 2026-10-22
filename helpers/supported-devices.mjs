// Supported devices (22 Oct 2026; docs/handoff/supported-devices.md): which devices DeviceHub runs and what each one
// gets, in plain words, so a person can see it without Claude (Settings > DeviceHub > Supported devices, and Search).
// Built from the device library's list() (device.json: brand, kind, models, status, what was checked to work) plus
// each driver's own declared settings (device.mjs or driver.json, loaded the way the library loads it). It never opens
// a device, never calls connect(), read() or write(), and writes nothing.
//
//   GET /api/supported-devices   { groups: [{ kind, title, rows: [row] }], count }
//     row: { name, brand, models: { short, all, more }, reads: [...], changes: [...], status: { key, label, line } }
//     status key: 'works' (out of the box), 'reads' (reads now; settings after Turn on settings), 'untried' (not
//     tried on a real device yet)
//
//   describe(meta, settings)   one row from a device.json and the driver's settings list (exported for the test)
//   supported({ root })        the whole answer (cached until a library folder changes)
//   handle(url, req, res, send)   the route; true when it answered
import fs from 'node:fs';
import path from 'node:path';
import { list, loadDriver, ROOT } from './device-library.mjs';
import { hasRealRecord } from './my-devices.mjs';

// plain names for what a driver reads or changes, in the order they are shown. reading: a value the person cannot set
// (it is always "reads"). The first that matches a setting label or a phrase wins for that phrase.
export const TERMS = [
  ['low-battery warning', /low-battery/i],
  ['battery', /(?<!low-)battery/i, true],
  ['charging', /charging/i, true],
  ['DPI', /\bdpi\b(?!\s*(stage|button))/i],
  ['DPI stages', /\bdpi stages?\b|stage table|stages in (use|the cycle)/i],
  ['polling rate', /polling|report rate/i],
  ['sleep timer', /sleep|auto-off|turn off (after|when)|\bidle\b/i],
  ['lift-off distance', /lift-off|lift height/i],
  ['angle snapping', /angle snapping/i],
  ['debounce', /debounce/i],
  ['motion sync', /motion sync/i],
  ['scroll acceleration', /scroll acceleration/i],
  ['smart reel', /smart reel/i],
  ['scroll mode', /scroll mode/i, true],
  ['onboard profile', /onboard profile|profile select/i],
  ['onboard or live mode', /settings source|onboard \/ host/i],
  ['game mode', /game mode|windows-key lock|key locks/i],
  ['F-key swap', /f-key swap|fn ?swap/i],
  ['backlight timer', /backlight-off/i],
  ['light brightness', /brightness/i],
  ['dongle light', /dongle light/i],
  ['macro light', /macro light/i],
  ['sidetone', /sidetone/i],
  ['mic mute', /mic mute/i],
  ['voice prompts', /voice prompts/i],
  ['silent mode', /silent mode/i],
  ['noise gate', /noise gate/i],
  ['EQ', /\beq\b|equali[sz]er/i],
  ['ChatMix', /chatmix/i, true],
  ['boom mic', /boom mic/i, true],
  ['key depth', /key depth/i, true],
  ['keyboard layout', /\blayout\b(?! \()/i, true],
  ['sound preset', /signature sound/i, true],
  ['connection', /headset linked|\bconnected\b/i, true],
  ['model', /names the (device|model)|the model and size|headset name/i, true],
  ['firmware version', /\bfirmware\b(?!\s+(updates?|check))/i, true],
];
const READING = new Set(TERMS.filter((t) => t[2]).map((t) => t[0]));
const ORDER = new Map(TERMS.map((t, i) => [t[0], i]));
// the plain names a piece of text mentions
export const termsIn = (text) => TERMS.filter(([, re]) => re.test(text)).map(([name]) => name);

// "a (b; c); d" -> ["a (b; c)", "d"]: a semicolon inside brackets does not split
function segments(line) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(line)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
const READ_MARK = /\(read\)|\bread[- ]only\b|shown only|only shown|\breads?\b\s*[:,]|\(read;/i;
const CHANGE_MARK = /\bwrit(e|es|ten)\b|read back|read-back/i;
const NEVER_WRITES = /never writes|writes nothing/i;
// a setting whose own hint says it is only shown (HyperX: "shown only (no change yet)")
const SHOWN_ONLY = /shown only|no change yet|read only/i;

// short model list: brackets and a leading brand name dropped, at most three names, "and N more"
export function shortModels(models, n = 3, brand = '') {
  const lead = (m) => (brand && m.toLowerCase().startsWith(`${brand.toLowerCase()} `) ? m.slice(brand.length + 1) : m);
  const names = [...new Set((models || []).map((m) => lead(String(m).replace(/\s*\([^)]*\)/g, '').trim()).trim()).filter(Boolean))];
  const more = Math.max(0, names.length - n);
  return { short: names.slice(0, n).join(', ') + (more ? ` and ${more} more` : ''), all: names, more };
}

const GROUPS = [['mouse', 'Mice'], ['keyboard', 'Keyboards'], ['mouse-keyboard', 'Mice and keyboards'], ['headset', 'Headsets'], ['other', 'Other devices']];
export function groupOf(kind) {
  const k = String(kind || '').toLowerCase();
  const mouse = /mouse|mice/.test(k), keyboard = /keyboard/.test(k);
  return mouse && keyboard ? 'mouse-keyboard' : mouse ? 'mouse' : keyboard ? 'keyboard' : /headset/.test(k) ? 'headset' : 'other';
}

// the status in plain words
export function statusOf(meta, { changes = 1 } = {}) {
  const real = hasRealRecord(meta);
  if (meta.builtIn || (real && meta.status === 'tested')) return { key: 'works', label: 'Works', line: 'Works out of the box.' };
  if (meta.status === 'untested') return { key: 'untried', label: 'Not tried yet', line: 'Not tried on a real device yet. Install it from the Set up card on Overview.' };
  if (!changes) return { key: 'reads', label: 'Reads now', line: 'Reads the device by itself.' };
  return real
    ? { key: 'reads', label: 'Reads now', line: 'Reads now; each setting can be changed once DeviceHub has checked it.' }
    : { key: 'reads', label: 'Reads now', line: 'Reads now; settings after Turn on settings on its page.' };
}

// one row: what it reads and changes, from the driver's declared settings and its device.json "works" lines
export function describe(meta, settings = []) {
  const reads = new Set(), changes = new Set();
  // 1. what device.json says was checked to work, phrase by phrase
  for (const line of meta.works || []) for (const seg of segments(line)) {
    const names = termsIn(seg);
    if (!names.length) continue;
    const change = CHANGE_MARK.test(seg), read = READ_MARK.test(seg) && !change;
    for (const n of names) {
      if (READING.has(n) || read) reads.add(n); else changes.add(n);
    }
  }
  // 2. the settings its page shows without a device (a driver that lists them only once connected shows none here)
  for (const s of Array.isArray(settings) ? settings : []) {
    if (!s || typeof s.label !== 'string') continue;
    const names = termsIn(s.label);
    const plain = names.length ? names : [s.label.replace(/:.*$/, '').trim().toLowerCase()];
    for (const n of plain) {
      if (s.type === 'display' || s.readOnly || READING.has(n) || SHOWN_ONLY.test(s.hint || '')) reads.add(n); else changes.add(n);
    }
  }
  // a driver that never writes changes nothing, whatever its labels say
  if ((meta.works || []).some((l) => NEVER_WRITES.test(l))) { for (const n of changes) reads.add(n); changes.clear(); }
  for (const n of changes) reads.delete(n);   // what it changes it also reads; said once
  const sort = (set) => [...set].sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99));
  const ch = sort(changes);
  return { brand: meta.vendor, kind: groupOf(meta.kind), models: shortModels(meta.models, 2, meta.vendor), reads: sort(reads), changes: ch, status: statusOf(meta, { changes: ch.length }) };
}

// DeviceHub's own three drivers (public/devices/*-adapter.js), not in the library
export const BUILT_IN = [
  { name: 'pulsar', builtIn: true, vendor: 'Pulsar', kind: 'Mouse', models: ['X-Lite CrazyLight'],
    works: ['battery and charging (read)', 'DPI stages, polling rate, lift-off distance, debounce, motion sync, angle snapping, sleep timer, DPI light brightness: written and read back'] },
  { name: 'epomaker-p75', builtIn: true, vendor: 'Epomaker', kind: 'Keyboard', models: ['P75'], extra: ['keys and layers', 'macros', 'lights', 'knob'] },
  { name: 'corsair-hs80', builtIn: true, vendor: 'Corsair', kind: 'Headset', models: ['HS80 RGB Wireless'],
    works: ['battery, charging and firmware version (read)', 'volume, mic level, mic mute, sidetone, sleep timer, light brightness, EQ: written and read back'] },
];

let cache = null;
// a key that changes when any library folder or file changes (so a new or updated entry shows without a restart)
function stamp(entries) {
  return entries.map((e) => {
    let t = '';
    try { for (const f of fs.readdirSync(e.dir)) t += `${f}:${fs.statSync(path.join(e.dir, f)).mtimeMs};`; } catch {}
    return `${e.name}|${e.origin}|${t}`;
  }).join('\n');
}

export async function supported({ root = ROOT } = {}) {
  const entries = list({ root }).filter((e) => !e.error);
  const key = `${root}\n${stamp(entries)}`;
  if (cache?.key === key) return cache.value;
  const rows = [];
  for (const m of BUILT_IN) {
    const r = describe(m);
    for (const x of m.extra || []) r.changes.push(x);
    rows.push({ name: m.name, builtIn: true, ...r });
  }
  for (const e of entries) {
    let settings = [];
    try {
      const { a } = await loadDriver(e.dir, 'supported');
      settings = Array.isArray(a?.settings) ? a.settings : [];
    } catch { settings = []; }   // a driver that does not load still gets its row, from device.json alone
    rows.push({ name: e.name, ...describe(e.meta, settings) });
  }
  const groups = GROUPS.map(([kind, title]) => ({ kind, title, rows: rows.filter((r) => r.kind === kind) })).filter((g) => g.rows.length);
  const value = { groups, count: rows.length };
  cache = { key, value };
  return value;
}

export async function handle(url, req, res, send) {
  if (url.pathname !== '/api/supported-devices') return false;
  if (req.method !== 'GET') { send(res, 405, { error: 'method' }); return true; }
  try { send(res, 200, await supported()); } catch (e) { send(res, 500, { error: e.message }); }
  return true;
}
