// Monitor controls (20 Oct 2026): brightness, contrast, speaker volume, color preset and color balance of each monitor over DDC/CI, through
// the helper's "monitor" channel (helpers/monitors.cs, Windows' own monitor API; nothing installed). The same rules as
// the devices: every change is backed up first (backups/monitor-<model>-<time>.json, all of that monitor's values),
// written one setting at a time and read back. Power, input, factory reset and anything else are never sent (the
// input is left out because these monitors report it at random, so a change could not be read back).
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const wmi = require('./monitor-wmi');   // a laptop's built-in screen: brightness through Windows (no DDC/CI there)

const FEATURES = { brightness: 0x10, contrast: 0x12, volume: 0x62,
  // the standard picture settings (20 Oct 2026, each tested on Shawn's two monitors: written, read back, put back)
  colorPreset: 0x14, red: 0x16, green: 0x18, blue: 0x1A, blackRed: 0x6C, blackGreen: 0x6E, blackBlue: 0x70 };
// MCCS color preset values (0x14), named; a monitor offers the ones its capabilities list
// in words (Shawn, 20 Oct 2026): the lower the K, the warmer (yellower) the white; the higher, the cooler (bluer)
const PRESETS = { 1: 'sRGB', 2: 'Native', 3: 'Warmest', 4: 'Warm', 5: 'Standard', 6: 'Cool', 7: 'Cooler', 8: 'Coolest', 9: 'Very cool', 10: 'Bluest', 11: 'Custom', 12: 'Custom 2', 13: 'Custom 3' };
// the capabilities' vcp(...) list as { code: [listed values] }, e.g. "vcp(10 12 14(05 06 08 0B) 16)" -> { 16: [], 18: [], 20: [5, 6, 8, 11], 22: [] }
function vcpList(caps) {
  const out = {};
  const at = (caps || '').toLowerCase().indexOf('vcp(');
  if (at < 0) return out;
  let i = at + 4, depth = 0, code = null, word = '';
  const flush = () => { if (!word) return; const n = parseInt(word, 16); if (depth === 0) { code = n; out[n] = out[n] || []; } else if (code != null && depth === 1) out[code].push(n); word = ''; };
  for (; i < caps.length; i++) {
    const ch = caps[i];
    if (ch === '(') { flush(); depth++; } else if (ch === ')') { flush(); if (depth === 0) break; depth--; } else if (ch === ' ') flush(); else word += ch;
  }
  // codes longer than two digits are the maker's own (E2A006 ...): never offered
  for (const k of Object.keys(out)) if (Number(k) > 0xff) delete out[k];
  return out;
}
// What a monitor says it supports (22 Oct 2026, Shawn: "why cant I change gamma or other settings on my agon monitor?"):
// every code in its capabilities' vcp(...) list, with the standard name from VESA's MCCS where there is one, and
// whether DeviceHub controls it. Read-only: shown on the Monitors page so it is plain which settings the monitor opens
// to the PC; nothing here is ever sent. Codes E0-FF are the maker's own.
const VCP_NAMES = { 0x02: 'New control value', 0x04: 'Restore factory defaults', 0x05: 'Restore brightness and contrast',
  0x06: 'Restore geometry', 0x08: 'Restore color', 0x0B: 'Color temperature step', 0x0C: 'Color temperature', 0x10: 'Brightness',
  0x11: 'Flesh tone', 0x12: 'Contrast', 0x14: 'Color preset', 0x16: 'Red', 0x18: 'Green', 0x1A: 'Blue', 0x1E: 'Auto setup',
  0x52: 'Active control', 0x59: 'Red saturation', 0x5A: 'Yellow saturation', 0x5B: 'Green saturation', 0x5C: 'Cyan saturation',
  0x5D: 'Blue saturation', 0x5E: 'Magenta saturation', 0x60: 'Input source', 0x62: 'Speaker volume', 0x6C: 'Red black level',
  0x6E: 'Green black level', 0x70: 'Blue black level', 0x72: 'Gamma', 0x86: 'Display scaling', 0x87: 'Sharpness', 0x8A: 'Color saturation',
  0x8D: 'Audio mute', 0x90: 'Hue', 0xAA: 'Screen orientation', 0xAC: 'Horizontal frequency', 0xAE: 'Vertical frequency',
  0xB2: 'Sub-pixel layout', 0xB6: 'Display technology', 0xC0: 'Display usage time', 0xC6: 'Application enable key',
  0xC8: 'Display controller', 0xC9: 'Firmware version', 0xCA: 'On-screen menu', 0xCC: 'Menu language', 0xD6: 'Power mode',
  0xDC: 'Picture mode', 0xDF: 'MCCS version' };
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
// never offered: resets, power and input switching (input switching was left out on purpose, helpers/monitors.cs),
// and the protocol's own housekeeping codes
const NEVER = new Set([0x02, 0x04, 0x05, 0x06, 0x08, 0x1E, 0x52, 0x60, 0xC6, 0xD6]);
// readings, not settings
const INFO = new Set([0xAC, 0xAE, 0xB2, 0xB6, 0xC0, 0xC8, 0xC9, 0xDF]);
function supportsList(caps) {
  const ours = new Set(Object.values(FEATURES));
  return Object.entries(vcpList(caps)).map(([c, vals]) => {
    const code = Number(c);
    return { code: hex2(code), name: VCP_NAMES[code] || (code >= 0xE0 ? "Maker's own" : null), values: vals.map(hex2),
      state: ours.has(code) ? 'controlled' : code >= 0xE0 ? 'maker' : NEVER.has(code) ? 'left out' : INFO.has(code) ? 'info' : 'not yet' };
  }).sort((a, b) => parseInt(a.code, 16) - parseInt(b.code, 16));
}
// Shawn's two (named as on the Equalizer's tabs); any other monitor shows its own model name
const KNOWN = [[/AG276QZD2/i, 'AOC AGON OLED'], [/VG272UV/i, 'Acer IPS']];
const known = (model) => (KNOWN.find(([re]) => re.test(model || '')) || [])[1];
// what a monitor lists but ignores, measured: the Acer VG272UV keeps its speaker volume at 100 whatever it is sent
const IGNORES = [[/VG272UV/i, ['volume']]];
const ignores = (model, f) => IGNORES.some(([re, fs]) => re.test(model || '') && fs.includes(f));

// Color balance and the color preset (24 Oct 2026, Shawn: "the colors dont change for my oled"). Measured on the AOC
// AGON OLED AG276QZD2: in its Standard preset a red gain write is refused (it reads 50 after 45 was sent); after one
// switch to Custom (0x14 = 11, read back) red 45 is taken and read back. So a gain or black level is written only on a
// Custom preset: when the monitor offers one and is not on it, it is switched there first. A monitor that refuses a
// gain even on Custom (or that has no preset to switch to) does not take color changes from the PC: its color balance
// is hidden for the rest of this run (noColor).
const BALANCE_KEYS = ['red', 'green', 'blue', 'blackRed', 'blackGreen', 'blackBlue'];
const CUSTOM_PRESETS = [11, 12, 13];
// the preset to switch to before writing `feature`, or null when none is needed
function customFirst(m, feature) {
  if (!BALANCE_KEYS.includes(feature) || !m.colorPreset) return null;
  if (CUSTOM_PRESETS.includes(m.colorPreset.value)) return null;
  const opt = (m.colorPreset.options || []).find((o) => CUSTOM_PRESETS.includes(o.value));
  return opt ? opt.value : null;
}
// a refused gain read-back: true when it means the monitor never takes color changes (it was on Custom, or has none)
function refusesColor(m, feature) {
  if (!BALANCE_KEYS.includes(feature)) return false;
  return !m.colorPreset || CUSTOM_PRESETS.includes(m.colorPreset.value) || customFirst(m, feature) == null;
}
const noColor = new Set();   // monitor ids measured refusing color balance this run

let native = null, backupDir = null, cache = { at: 0, list: null }, busy = Promise.resolve();
const switching = new Map();   // monitor id -> its switch to Custom while one runs (live steps share it)
// a monitor's capabilities never change and take seconds to read: read once per monitor, then only its values (0.7 s)
const capsById = new Map();
const lastBackupAt = new Map();   // monitor id -> when its last backup was written
const call = async (q, ms = 15000) => {
  const raw = await native.request('monitor', JSON.stringify(q), ms);
  // the helper is not running (GONE) or did not answer in time (TIMEOUT): say so in words (20 Oct 2026)
  if (raw === 'GONE' || raw === 'TIMEOUT') throw new Error(raw === 'GONE' ? 'the device helper is not running' : 'no answer in time');
  const r = JSON.parse(raw);
  if (!r.ok) throw new Error(r.error || 'monitor error');
  return r;
};
// one monitor operation at a time (DDC/CI answers slowly and dislikes overlapping messages)
const serial = (f) => { const p = busy.then(f, f); busy = p.catch(() => {}); return p; };

function shape(m) {
  const caps = m.caps || capsById.get(m.id) || '';
  if (m.caps) capsById.set(m.id, m.caps);
  const model = (/model\(([^)]+)\)/.exec(caps) || [])[1] || null;
  const vcp = vcpList(caps);
  const v = (code) => (m.values || {})[code.toString(16).toUpperCase().padStart(2, '0')] || null;
  const num = (code) => { const x = v(code); return x ? { value: x.cur, max: x.max || 100 } : null; };
  return {
    id: m.id, screen: m.screen, model, name: known(model) || model || m.name, ddc: !!m.ddc,
    brightness: num(0x10), contrast: num(0x12), volume: /\b62\b/.test(caps) && !ignores(model, 'volume') ? num(0x62) : null,
    // the picture settings this monitor lists (and answers)
    ...Object.fromEntries(BALANCE_KEYS.map((k) => [k, vcp[FEATURES[k]] && !noColor.has(m.id) ? num(FEATURES[k]) : null])),
    noColor: noColor.has(m.id) || undefined,
    colorPreset: vcp[0x14] && num(0x14) ? { ...num(0x14), options: vcp[0x14].filter((x) => PRESETS[x]).map((x) => ({ value: x, label: PRESETS[x] })) } : null,
    error: m.error || null,
    supports: caps ? supportsList(caps) : null,
  };
}

// ---- changes waiting for a monitor that is off or not answering (21 Oct 2026, Shawn: "I dont want to have to rely
// on the devices to be on") ----
// A change made then is kept (waiting-monitors.json: monitor id -> { setting: value }), shown as made, and written the
// normal way (backup, write, read back) once the monitor answers again: looked for once a minute while something waits,
// and whenever the Monitors page reads them.
const WAIT_FILE = path.join(process.env.DEVICEHUB_DATA_DIR || require('./data-dir').DATA, 'waiting-monitors.json');  // a test points it elsewhere
let waiting = {};
try { waiting = JSON.parse(fs.readFileSync(WAIT_FILE, 'utf8')) || {}; } catch {}
// monitor id -> its last reading while it answered; kept in last-monitor-values.json, so a monitor that is off when
// DeviceHub starts still shows its settings and takes changes (21 Oct 2026)
const LAST_FILE = path.join(path.dirname(WAIT_FILE), 'last-monitor-values.json');
const lastSeen = new Map();
try { for (const [id, m] of Object.entries(JSON.parse(fs.readFileSync(LAST_FILE, 'utf8')) || {})) lastSeen.set(id, m); } catch {}
let lastText = '';
const saveLastSeen = () => { const t = JSON.stringify(Object.fromEntries(lastSeen)); if (t !== lastText) { lastText = t; try { writeAtomic(LAST_FILE, t); } catch {} } };
const saveWaiting = () => { try { writeAtomic(WAIT_FILE, JSON.stringify(waiting)); } catch {} };
const notAnswering = (e) => /refused it|did not answer|not found|no answer in time|not running/i.test(e?.message || '');
let retry = null;
function keepTrying() {
  if (retry || !Object.keys(waiting).length) return;
  retry = setInterval(() => { if (!Object.keys(waiting).length) { clearInterval(retry); retry = null; return; } list(true).catch(() => {}); }, 60000);
  retry.unref?.();
}
let flushing = false;
async function flush() {
  if (flushing) return; flushing = true;
  try {
    for (const [id, keys] of Object.entries(waiting)) {
      const m = (cache.list || []).find((x) => x.id === id);
      if (!m || !m.ddc || m.away) continue;
      for (const [feature, value] of Object.entries({ ...keys })) {
        try { await set(id, feature, value, { fromQueue: true }); if (waiting[id]?.[feature] === value) delete waiting[id][feature]; onApplied(`${m.name}: ${feature === 'volume' ? 'speaker volume' : feature} → ${value} (made while it was off)`); }
        catch (e) { if (notAnswering(e)) break; if (waiting[id]?.[feature] === value) delete waiting[id][feature]; onApplied(`${m.name}: ${feature} not changed: ${e.message}`, true); }
      }
      if (waiting[id] && !Object.keys(waiting[id]).length) delete waiting[id];
    }
  } finally { flushing = false; saveWaiting(); }
}
let onApplied = () => {};
// a monitor that is away keeps its last reading on the page, with the waiting values shown as made
function withWaiting(list) {
  const out = list.map((m) => {
    if (m.ddc) { lastSeen.set(m.id, { ...m, error: null }); return m; }
    return lastSeen.has(m.id) ? { ...lastSeen.get(m.id), away: true } : m;
  });
  // one that dropped out of Windows' list while changes wait for it
  for (const id of Object.keys(waiting)) if (!out.some((m) => m.id === id) && lastSeen.has(id)) out.push({ ...lastSeen.get(id), away: true });
  saveLastSeen();
  return out.map((m) => {
    const w = waiting[m.id];
    if (!w) return m;
    const o = { ...m, waiting: Object.keys(w) };
    for (const [f, v] of Object.entries(w)) if (o[f]) o[f] = { ...o[f], value: v };
    return o;
  });
}

// a screen that does not answer over DDC/CI but whose brightness Windows sets (a laptop's own panel, helpers/monitor-wmi.js)
// gets that brightness, marked builtin; nothing else is offered for it
async function builtIn(list) {
  if (!list.some((m) => !m.ddc)) return list;
  const screens = await wmi.read().catch(() => []);
  if (!screens.length) return list;
  return list.map((m) => {
    if (m.ddc || m.away) return m;
    const s = wmi._test.match(m.id, screens);
    return s ? { ...m, name: m.model ? m.name : 'Built-in screen', builtin: true, wmiInstance: s.instance, brightness: { value: s.value, max: 100 } } : m;
  });
}

// The Monitors page opens on the last reading (23 Oct 2026, Shawn: "make the monitors area load faster"): a DDC/CI read of
// every monitor takes seconds (one question per setting, and a silent monitor is asked twice). A reading under 10 s old
// is used as it is; an older one is shown at once while a new read runs (the page asks again for it, fresh); none at all
// (only before the first read, which start() does in the background soon after DeviceHub starts) waits for the read.
let refreshing = null;
// after Monitors > Sleep no DDC/CI read for 10 minutes (27 Oct 2026, Shawn: Sleep did not work; a read over the
// monitor's cable can wake it): the last reading is shown; a change the person makes ends the quiet at once
let quietUntil = 0;
const quiet = (ms = 10 * 60000) => { quietUntil = Date.now() + ms; };
async function list(fresh) {
  if (Date.now() < quietUntil && cache.list) return cache.list;
  if (!fresh && cache.list && Date.now() - cache.at < 10000) return cache.list;
  if (!fresh && cache.list) {
    if (!refreshing) list(true).catch(() => {});
    return cache.list;
  }
  // a read already running answers this one too (the page asks fresh right after the quick answer)
  if (refreshing) return refreshing;
  refreshing = readAll();
  try { return await refreshing; } finally { refreshing = null; }
}
async function readAll() {
  const result = await serial(async () => {
    let r0 = await call({ op: 'monitors', caps: false }, 30000);
    // a monitor that answered before and is silent now has usually just missed one DDC/CI reply: ask once more
    if (r0.monitors.some((m) => !m.ddc && capsById.has(m.id))) r0 = await call({ op: 'monitors', caps: false }, 30000);
    // capabilities only for a monitor not read before
    const r = r0.monitors.some((m) => m.ddc && !capsById.has(m.id)) ? await call({ op: 'monitors', caps: true }, 30000) : r0;
    cache = { at: Date.now(), list: await builtIn(withWaiting(r.monitors.map(shape))) };
    return cache.list;
  });
  if (result.some((m) => m.waiting && m.ddc && !m.away)) setTimeout(() => flush().catch(() => {}), 0);
  return result;
}

// the first read, in the background once DeviceHub has settled (the helper is up, the devices have connected), so the
// first visit to Monitors finds a reading ready
function warm(ms = 15000) { setTimeout(() => { if (!cache.list) list(true).catch(() => {}); }, ms).unref?.(); }

async function set(id, feature, value, { live = false, fromQueue = false } = {}) {
  if (!fromQueue) quietUntil = 0;   // the person changed something: they are at the screens
  const code = FEATURES[feature];
  if (code == null) throw new Error('unknown setting');
  // a reading from the last 30 s checks the value and fills the backup (20 Oct 2026: a fresh read of every monitor
  // before each change made one slider step take ~690 ms; with this it is the write and its read-back only)
  const all = cache.list && Date.now() - cache.at < 30000 ? cache.list : await list(true);
  const m = all.find((x) => x.id === id) || (lastSeen.has(id) ? { ...lastSeen.get(id), away: true } : null);
  if (!m) throw new Error('monitor not found');
  const cur = m[feature];
  if (!cur) throw new Error(`this monitor does not offer ${feature}`);
  if (feature === 'colorPreset') { if (!cur.options.some((o) => o.value === value)) throw new Error('this monitor does not offer that color preset'); }
  else if (!Number.isInteger(value) || value < 0 || value > cur.max) throw new Error(`${feature} must be 0-${cur.max}`);
  // a built-in screen: Windows sets its brightness (backed up, written once on release, read back)
  if (m.builtin) return setBuiltIn(m, feature, value, live);
  // off or not answering: the change waits for it (a step while dragging is not kept)
  if (m.away || !m.ddc) { if (live) return { name: m.name, feature, value, live: true }; return wait(m, feature, value); }
  // a direct change replaces one that was waiting
  if (!fromQueue && waiting[id]?.[feature] !== undefined) { delete waiting[id][feature]; if (!Object.keys(waiting[id]).length) delete waiting[id]; saveWaiting(); }
  // back up all of this monitor's values first; changes a few seconds apart (a slider dragged) share the backup taken
  // before the first, which holds every value as it was (21 Oct 2026)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (!(Date.now() - (lastBackupAt.get(id) || 0) < 15000)) {
    writeAtomic(path.join(backupDir, `monitor-${(m.model || 'monitor').replace(/[^\w-]/g, '')}-${stamp}.json`),
      JSON.stringify({ at: new Date().toISOString(), monitor: m.name, model: m.model, id: m.id, ...Object.fromEntries(Object.keys(FEATURES).map((k) => [k, (lastSeen.get(id) || m)[k] ?? null])) }, null, 1));
    lastBackupAt.set(id, Date.now());
  }
  // a gain or black level on a monitor that is not on its Custom preset: switch it there first (one write, read back)
  let presetSwitched = null;
  const to = customFirst(m, feature);
  if (to != null) {
    if (!switching.has(id)) switching.set(id, serial(() => call({ op: 'monitor-set', id, code: FEATURES.colorPreset, value: to, live: false })).finally(() => switching.delete(id)));
    const pr = await switching.get(id);
    if (!pr.ok || pr.cur !== to) { cache.at = 0; throw new Error('the monitor did not switch to its Custom preset'); }
    if (customFirst(m, feature) != null) {
      m.colorPreset = { ...m.colorPreset, value: to };
      const s = lastSeen.get(id); if (s?.colorPreset) lastSeen.set(id, { ...s, colorPreset: { ...s.colorPreset, value: to } });
      presetSwitched = PRESETS[to] || 'Custom';
    }
  }
  let r;
  try { r = await serial(() => call({ op: 'monitor-set', id, code, value, live })); }
  catch (e) { if (!live && !fromQueue && notAnswering(e)) return wait(m, feature, value); throw e; }
  // a live step is not read back (the release is): its value is kept as sent
  if (live) { if (m[feature]) m[feature] = { ...m[feature], value }; return { name: m.name, feature, value, live: true, presetSwitched }; }
  const back = r.cur;
  if (!r.ok && !fromQueue) { cache.at = 0; return wait(m, feature, value); }
  // a gain refused on Custom (or with no preset to switch to): this monitor does not take color changes from the PC
  if (r.ok && back !== value && refusesColor(m, feature)) {
    noColor.add(id); cache.at = 0;
    for (const k of BALANCE_KEYS) m[k] = null;
    m.noColor = true;
    throw new Error("This monitor doesn't take color changes from the PC.");
  }
  if (!r.ok || back !== value) { cache.at = 0; throw new Error(r.ok ? `the monitor reads ${back} instead of ${value}` : 'the monitor did not answer the read-back'); }
  // the confirmed value goes into the saved reading, so the next step does not wait for a fresh read of every monitor
  if (m[feature]) m[feature] = { ...m[feature], value: back };
  const seen = lastSeen.get(id); if (seen?.[feature]) lastSeen.set(id, { ...seen, [feature]: { ...seen[feature], value: back } });
  return { name: m.name, feature, value: back, presetSwitched };
}

async function setBuiltIn(m, feature, value, live) {
  if (feature !== 'brightness') throw new Error('a built-in screen offers brightness only');
  // each Windows call takes a moment, so the steps while dragging are not sent; the release is
  if (live) return { name: m.name, feature, value, live: true };
  if (!(Date.now() - (lastBackupAt.get(m.id) || 0) < 15000)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeAtomic(path.join(backupDir, `monitor-builtin-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), monitor: m.name, id: m.id, via: 'Windows (WMI)', brightness: m.brightness }, null, 1));
    lastBackupAt.set(m.id, Date.now());
  }
  const back = await serial(() => wmi.set(m.wmiInstance, value));
  cache.at = 0;
  if (back !== value) throw new Error(back == null ? 'Windows did not read the brightness back' : `the screen reads ${back} instead of ${value}`);
  return { name: m.name, feature, value: back };
}

function wait(m, feature, value) {
  (waiting[m.id] ||= {})[feature] = value;
  saveWaiting(); keepTrying();
  // shown as made at once (the saved reading is patched; lastSeen keeps what the monitor really has)
  if (cache.list) cache.list = cache.list.map((x) => (x.id !== m.id ? x : { ...x, waiting: Object.keys(waiting[m.id]), ...(x[feature] ? { [feature]: { ...x[feature], value } } : {}) }));
  return { name: m.name, feature, value, waiting: true };
}

module.exports = { quiet, start(nat, dir, applied) { native = nat; backupDir = dir; if (applied) onApplied = applied; keepTrying(); warm(); }, list, set, FEATURES, _test: { vcpList, supportsList, warm, age: (ms) => { cache.at -= ms; }, customFirst, refusesColor } };
