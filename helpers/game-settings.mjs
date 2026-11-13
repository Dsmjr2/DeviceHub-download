// Games' own settings in the setup file (12 Nov 2026, Shawn: "I want games that I play on here to have their settings
// brought over"): each game's controls, sensitivity, audio and options, and its graphics as a separate choice, from the
// files and registry values the game itself keeps (docs/handoff/game-settings.md).
//
// Only the games and paths in CATALOG below, found by a read-only scan of Shawn's PC. Every path is worked out from the
// catalog on the PC that loads, never taken from the file, so a setup file cannot name a place to write. Never a save
// game, never anything in a game's install folder, never a login, token, account id, audio device id or accepted
// terms. Games that sync their own settings (Steam Cloud, Epic, Xbox, Activision) are left out.
//
// Kinds: 'whole' copies the file; 'ini', 'json' and 'embark' carry key by key, so graphics keys stay as this PC has them unless
// graphics is picked; registry values (Unity's PlayerPrefs) the same. Loading: never while the game runs; this PC's
// files and values are backed up first (backups/game-settings/<when>/); each write is read back; Put back restores
// the newest backup.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseOptions, writeOptions } from './gvas.mjs';

// Shawn's own PCs only (13 Nov 2026, Shawn: "this is just my personal settings"): the list below is his games, so on
// anyone else's copy nothing is read, planned or written (the same owner check as problem reports: a copy whose git
// origin is Dsmjr2/DeviceHub, or settings.json "ownerPc": true)
// (13 Nov 2026 bug hunt) an origin that cannot be read counts as not the owner here: problem reports treat it as the
// owner's PC (the safe side for them), which would switch game settings on
export async function allowed(root, isOwner = strictOwner) {
  try { return !!(await isOwner(root)); } catch { return false; }
}
async function strictOwner(root) {
  const { dataFile } = (await import('node:module')).createRequire(import.meta.url)('./data-dir.js');
  try { if (JSON.parse(fs.readFileSync(dataFile('settings.json', root), 'utf8').replace(/^\uFEFF/, '')).ownerPc === true) return true; } catch {}
  const origin = await new Promise((resolve) => execFile('git', ['remote', 'get-url', 'origin'], { cwd: root, windowsHide: true, timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (e, out) => resolve(e ? '' : String(out).trim())));
  return /github\.com[/:]Dsmjr2\/DeviceHub(\.git)?$/i.test(origin);
}

// graphics: depends on the screen and graphics card, so it stays as each PC has it unless graphics is picked
export const GFX = /resolution|fullscreen|screen ?(width|height|mode|percentage)|screenmanager|window ?(pos|width|height|mode)|windowmode|maximized|selectmonitor|selecteddisplay|displaymode|monitorsettings|vsync|v_sync|hdr|frame ?rate|framerate|fps|benchmark|^sg\.|quality|upscal|dlss|fsr|xess|reflex|antialias|anti_lag|msaa|motion ?blur|bloom|lens ?flare|depth ?of ?field|dynamicresolution|shadow|texture|foliage|sharpness|gamma|brightness|exposure|render|graphics|gpu|rhi|adapter|refresh|aspect|ray ?trac|illumination|reflection|postprocess|post_effects|view ?distance|lod|anisotrop|occlusion|nanite|lumen|crt|maxqueuedframes|stretching|frame ?gen|maxscale|renderscale/i;
// never carried: who the person is, this PC's own devices, what they agreed to, a game's progress markers
export const NEVER = /accepted|consent|terms|disclaimer|conduct|token|auth|login|password|session|userid|user_id|accountid|steamid|installation|guid|deviceid|crash|telemetry|analytics|tutorial|haswatched|firsttime|version$|path$|^unity\.|^unity_connect|^bt-|puncloud|microphone|audioinputtype|audio_device|audio ?(input|output) ?device|(input|output) ?device|proxy|selectedsave|ip_country|remotenotification|^https?:|newlabelevents|lobbytype|default_change/i;

const ue = (dir, sub = 'WindowsClient') => [
  { root: 'local', path: `${dir}/Saved/Config/${sub}/GameUserSettings.ini`, kind: 'ini' },
];
export const CATALOG = [
  { name: 'THE FINALS', exes: ['discovery.exe', 'discovery-d.exe', 'discovery-e.exe'], files: [
    { root: 'local', path: 'Discovery/Saved/SaveGames/EmbarkOptionSaveGame.sav', kind: 'embark' },
    { root: 'local', path: 'Discovery/Saved/SaveGames/EmbarkSaveGameClientKeyBindings.sav', kind: 'whole' },
    { root: 'local', path: 'Discovery/Saved/SaveGames/EmbarkSaveGameClientGamepadBindings.sav', kind: 'whole' },
    { root: 'local', path: 'Discovery/Saved/Config/WindowsClient/GameUserSettings.ini', kind: 'whole', graphics: true }] },
  { name: 'ARC Raiders', exes: ['pioneergame.exe'], files: [
    { root: 'local', path: 'PioneerGame/Saved/SaveGames/EmbarkOptionSaveGame.sav', kind: 'embark' },
    { root: 'local', path: 'PioneerGame/Saved/SaveGames/EmbarkSaveGameClientKeyBindings.sav', kind: 'whole' },
    { root: 'local', path: 'PioneerGame/Saved/Config/WindowsClient/GameUserSettings.ini', kind: 'whole', graphics: true }] },
  { name: 'WARDOGS', exes: ['wardogsclient-win64-shipping.exe'], files: [
    { root: 'local', path: 'Wardogs/Saved/SaveGames/EnhancedInputUserSettings.sav', kind: 'whole' }, ...ue('Wardogs')] },
  { name: 'RuneScape: Dragonwilds', exes: ['rsdragonwilds.exe', 'rsdragonwilds-win64-shipping.exe'], files: [
    ...ue('RSDragonwilds', 'Windows'),
    { root: 'local', path: 'RSDragonwilds/Saved/Config/Windows/Engine.ini', kind: 'whole', graphics: true }] },
  // its keybinds sync through Steam Cloud; this file is mostly graphics (its volumes ride along with it)
  { name: 'HELLDIVERS 2', exes: ['helldivers2.exe'], files: [
    { root: 'roaming', path: 'Arrowhead/Helldivers2/user_settings.config', kind: 'whole', graphics: true }] },
  { name: 'PEAK', exes: ['peak.exe'], reg: 'Software\\LandCrab\\PEAK' },
  { name: 'How to Fish', exes: ['how to fish.exe'], reg: 'Software\\Dazed Games\\How to Fish' },
  { name: 'Super Battle Golf', exes: ['super battle golf.exe'], reg: 'Software\\Brimstone\\Super Battle Golf', files: [
    { root: 'locallow', path: 'Brimstone/Super Battle Golf/Config.json', kind: 'json' },
    { root: 'locallow', path: 'Brimstone/Super Battle Golf/InputBindings.json', kind: 'whole' }] },
  { name: 'Aimlabs', exes: ['aimlab_tb.exe'], files: [
    { root: 'locallow', path: 'Statespace/aimlab_tb/UserDefault/UserKeybindings.json', kind: 'whole' },
    { root: 'locallow', path: 'Statespace/aimlab_tb/UserDefault/WindowsPlayer_PlayerSettingsData.json', kind: 'json' },
    { root: 'locallow', path: 'Statespace/aimlab_tb/WindowsPlayer_PlayerSettingsData.json', kind: 'json' }] },
  { name: 'Gamble With Your Friends', exes: ['gamble with your friends.exe'], reg: 'Software\\TENSTACK\\Gamble With Your Friends' },
  { name: 'The Binding of Isaac', exes: ['isaac-ng.exe'], files: [
    { root: 'home', path: 'Documents/My Games/Binding of Isaac Repentance+/options.ini', kind: 'ini' }] },
  { name: 'Halo Infinite', exes: ['haloinfinite.exe'], files: [
    { root: 'local', path: 'HaloInfinite/Settings/SpecControlSettings.json', kind: 'whole', graphics: true },
    { root: 'local', path: 'HaloInfinite/Settings/SpecControlMPSettings.json', kind: 'whole', graphics: true }] },
];
const MAX_FILE = 2 * 1024 * 1024;
const bare = (name) => String(name).replace(/_h\d+$/, '');   // Unity adds a hash to each name
const isGfx = (k) => GFX.test(bare(k));
const never = (k) => NEVER.test(bare(k)) || String(k).split('.').some((p) => NEVER.test(p));

// ---------- the PC: folders and the registry (both replaceable, for tests) ----------
// Registry values (13 Nov 2026 bug hunt): Unity keeps a float as an 8-byte value of the DWORD type, which "reg query"
// prints cut to 4 bytes (PEAK's sensitivity 1.8 read as 0x0), so a load wrote 0 and Put back could not undo it. Values
// are read through "reg export" (every byte: dword:…, hex(N):…, hex:…, "…") and written through "reg import" of that
// same text; type 'REG_EXPORT'. A value's text is checked to be one of those forms on one line before it is written.
export const REG_VALUE = /^(dword:[0-9a-f]{8}|hex(\([0-9a-f]{1,2}\))?:[0-9a-f]{2}(,[0-9a-f]{2})*|hex(\([0-9a-f]{1,2}\))?:|"(?:[^"\\\r\n]|\\.)*")$/;
export function parseRegExport(text) {
  const vals = new Map();
  const joined = String(text).replace(/^\uFEFF/, '').replace(/\\\r?\n\s*/g, '');
  for (const line of joined.split(/\r?\n/)) {
    const m = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/\\(.)/g, '$1');
    const raw = m[2].trim();
    const data = raw.startsWith('"') ? raw : raw.toLowerCase().replace(/\s+/g, '');
    if (REG_VALUE.test(data)) vals.set(name, { type: 'REG_EXPORT', data });
  }
  return vals;
}
const regEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const run = (args) => new Promise((resolve) => execFile('reg', args, { windowsHide: true, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? null : String(out))));
const tmpReg = () => path.join(process.env.TEMP || process.env.TMP || '.', `devicehub-game-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.reg`);
export const realReg = {
  async read(key) {
    const f = tmpReg();
    try { if ((await run(['export', `HKCU\\${key}`, f, '/y'])) == null) return null; return parseRegExport(fs.readFileSync(f, 'utf16le')); }
    catch { return null; } finally { try { fs.rmSync(f, { force: true }); } catch {} }
  },
  async write(key, name, type, data) {
    if (type !== 'REG_EXPORT' || !REG_VALUE.test(String(data)) || /[\r\n]/.test(name)) throw new Error(`${name} not written (not a value DeviceHub read)`);
    const f = tmpReg();
    try {
      fs.writeFileSync(f, '\uFEFF' + `Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\${key}]\r\n"${regEscape(name)}"=${data}\r\n`, 'utf16le');
      if ((await run(['import', f])) == null) throw new Error(`${name} not written`);
    } finally { try { fs.rmSync(f, { force: true }); } catch {} }
  },
  async del(key, name) { await run(['delete', `HKCU\\${key}`, '/v', name, '/f']); },
};
export function realRoots() {
  const home = process.env.USERPROFILE || '';
  return { local: process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), locallow: path.join(home, 'AppData', 'LocalLow'),
    roaming: process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), home };
}
const fileOf = (roots, f) => path.join(roots[f.root], ...f.path.split('/'));
// the game's own folder (for Documents, the folder the file is in: Documents itself is on every PC)
const topOf = (roots, f) => (f.root === 'home' ? path.dirname(fileOf(roots, f)) : path.join(roots[f.root], f.path.split('/')[0]));

// ---------- ini and json, key by key ----------
function iniParse(text) {
  const out = [];   // [{ section, key|null, raw }]
  let section = '';
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const s = /^\s*\[(.+)\]\s*$/.exec(raw);
    if (s) { section = s[1]; out.push({ section, key: null, raw, head: true }); continue; }
    const kv = /^([^=;#\s][^=]*?)\s*=/.exec(raw);
    out.push({ section, key: kv ? kv[1].trim() : null, raw });
  }
  return out;
}
const pick = (graphics) => (k) => !never(k) && (graphics || !isGfx(k));
// this PC's text with the file's allowed keys put in (same section; a key the file repeats replaces all of this PC's)
export function iniMerge(mine, theirs, graphics) {
  const eol = /\r\n/.test(mine ?? theirs) ? '\r\n' : '\n';
  const ok = pick(graphics);
  const src = iniParse(theirs).filter((l) => l.key && ok(l.key));
  if (mine == null) {   // nothing here yet: the file's lines without the ones left out (the game fills in the rest)
    return iniParse(theirs).filter((l) => !l.key || ok(l.key)).map((l) => l.raw).join(eol);
  }
  const bom = mine.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = iniParse(mine);
  const low = (s) => String(s).toLowerCase();
  const same = (l, section, key) => low(l.section) === low(section) && l.key != null && low(l.key) === low(key);
  const groups = new Map();
  for (const l of src) { const g = `${low(l.section)}\u0000${low(l.key)}`; if (!groups.has(g)) groups.set(g, { section: l.section, key: l.key, raws: [] }); groups.get(g).raws.push(l.raw); }
  for (const { section, key, raws } of groups.values()) {
    const at = lines.findIndex((l) => same(l, section, key));
    if (at >= 0) {
      const rest = lines.filter((l, i) => i <= at || !same(l, section, key));
      lines.length = 0; lines.push(...rest);
      lines.splice(at, 1, ...raws.map((raw) => ({ section, key, raw })));
    } else {
      let end = -1;
      lines.forEach((l, i) => { if (low(l.section) === low(section)) end = i; });
      if (end < 0 && section === '') { lines.splice(0, 0, ...raws.map((raw) => ({ section, key, raw }))); continue; }
      while (end > 0 && lines[end].raw.trim() === '' && lines[end - 1].section === section && !lines[end].head) end--;
      const add = raws.map((raw) => ({ section, key, raw }));
      if (end >= 0) lines.splice(end + 1, 0, ...add);
      else lines.push(...(lines.length && lines[lines.length - 1].raw.trim() !== '' ? [{ section, key: null, raw: '' }] : []), { section, key: null, raw: `[${section}]`, head: true }, ...add);
    }
  }
  return bom + lines.map((l) => l.raw).join(eol);
}
const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !JSON.isRawJSON?.(v);
function leaves(o, pre = [], out = []) {
  for (const [k, v] of Object.entries(o || {})) {
    if (UNSAFE_KEY.has(k)) continue;
    const p = [...pre, k];
    if (isPlain(v)) leaves(v, p, out); else out.push([p, v]);
  }
  return out;
}
// a whole number too big for a double (an id) is kept exactly as written
const parseExact = (text) => JSON.parse(text, (k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && /^-?\d+$/.test(ctx?.source || '') && JSON.rawJSON ? JSON.rawJSON(ctx.source) : v));
export function jsonMerge(mine, theirs, graphics) {
  if (mine == null) return null;   // never made here yet: start the game once first (a missing field would read as 0)
  const a = parseExact(mine), b = parseExact(theirs), ok = pick(graphics);
  for (const [parts, v] of leaves(b)) {
    if (!ok(parts.join('.'))) continue;
    let o = a;
    for (const k of parts.slice(0, -1)) { if (!Object.hasOwn(o, k) || !isPlain(o[k])) o[k] = {}; o = o[k]; }
    o[parts[parts.length - 1]] = v;
  }
  const indent = /^\{\s*\n(\s+)/.exec(mine)?.[1] || '';
  return JSON.stringify(a, null, indent || undefined);
}

// Embark's option file (THE FINALS, ARC Raiders; helpers/gvas.mjs), key by key (13 Nov 2026: copied whole it brought the
// PC's resolution, scalability, DLSS and frame rate limit to the laptop with graphics off). Graphics: every
// Scalability.* and Graphics.* option, and Display.* but the HUD's and world icons' sizes (the UI and HUD aspect ratios
// follow the screen's shape). Never: accepted terms, first-run markers, the voice chat devices (this PC's own), clan
// and battle pass data, debug and screen state.
export const EMBARK_GFX = /^GameplayOption\.(Scalability|Graphics)\.|^GameplayOption\.Display\.(?!(HudScale|WorldIconScale)$)/;
export const EMBARK_NEVER = /^GameplayOption\.(Legal|FTUE|Clans|BattlepassProgression|ShowPersistenceDebug|UI\.State)(\.|$)|^GameplayOption\.Version$|^GameplayOption\.Audio\.VoiceChat\.(Input|Output)$/;
const embarkCarries = (k, graphics) => k.startsWith('GameplayOption.') && !EMBARK_NEVER.test(k) && !never(k) && (graphics || !EMBARK_GFX.test(k));
// this PC's file with the other PC's carried options put in; this PC's other options and bytes kept. null: either
// file is not the shape gvas.mjs knows, or the game has not made one here yet (start it once first)
export function embarkMerge(mine, theirs, graphics) {
  if (!mine) return null;
  const m = parseOptions(mine), t = parseOptions(theirs);
  if (!m || !t) return null;
  const entries = m.entries.slice(), at = new Map(entries.map((e, i) => [e.key, i]));
  for (const e of t.entries) {
    if (!embarkCarries(e.key, graphics)) continue;
    const i = at.get(e.key);
    if (i == null) { at.set(e.key, entries.length); entries.push(e); } else if (entries[i].value !== e.value) entries[i] = { ...entries[i], value: e.value, rawValue: e.rawValue };
  }
  const out = writeOptions(m, entries);
  return parseOptions(out) ? out : null;   // read back as a whole before it is ever written
}

// ---------- what this PC has ----------
export async function capture({ roots = realRoots(), reg = realReg } = {}) {
  const out = [];
  for (const g of CATALOG) {
    const files = [];
    for (const [i, f] of (g.files || []).entries()) {
      const p = fileOf(roots, f);
      try { const st = fs.statSync(p); if (st.isFile() && st.size <= MAX_FILE) files.push({ i, data: fs.readFileSync(p).toString('base64') }); } catch {}
    }
    let values = null;
    if (g.reg) {
      const vals = await reg.read(g.reg);
      if (vals) values = [...vals].filter(([n, v]) => !never(n) && v.type === 'REG_EXPORT').map(([name, v]) => ({ name, type: v.type, data: v.data }));
      if (values && !values.length) values = null;
    }
    if (files.length || values) out.push({ name: g.name, files, ...(values ? { reg: values } : {}) });
  }
  return out;
}

// ---------- what loading would change here ----------
// the writes for one game: [{ what: 'file'|'reg', graphics, path|name, text/bytes|type+data }]
async function writesFor(g, saved, graphics, { roots, reg }) {
  const out = [];
  for (const s of saved.files || []) {
    const f = g.files?.[s.i];
    if (!f || (f.graphics && !graphics)) continue;
    const p = fileOf(roots, f);
    const theirs = Buffer.from(String(s.data || ''), 'base64');
    let mine = null;
    try { mine = fs.readFileSync(p); } catch {}
    let next;
    if (f.kind === 'whole') next = theirs;
    else if (f.kind === 'embark') { next = embarkMerge(mine, theirs, graphics); if (!next) continue; }
    else {
      let text;
      try { text = f.kind === 'ini' ? iniMerge(mine?.toString('utf8') ?? null, theirs.toString('utf8'), graphics) : jsonMerge(mine?.toString('utf8') ?? null, theirs.toString('utf8'), graphics); } catch { continue; }
      if (text == null) continue;
      if (f.kind === 'json' && mine && JSON.stringify(parseExact(mine.toString('utf8'))) === JSON.stringify(parseExact(text))) continue;
      next = Buffer.from(text, 'utf8');
    }
    if (next.length > MAX_FILE || (mine && mine.equals(next))) continue;
    out.push({ what: 'file', path: p, bytes: next, graphics: !!f.graphics });
  }
  if (g.reg && Array.isArray(saved.reg)) {
    const now = (await reg.read(g.reg)) || new Map();
    for (const v of saved.reg) {
      if (!v || typeof v.name !== 'string' || never(v.name) || v.type !== 'REG_EXPORT' || !REG_VALUE.test(String(v.data))) continue;   // an older file's values (cut by reg query) are never written
      if (isGfx(v.name) && !graphics) continue;
      const cur = now.get(v.name);
      if (cur && cur.type === v.type && cur.data === v.data) continue;
      out.push({ what: 'reg', key: g.reg, name: v.name, type: v.type, data: String(v.data), graphics: isGfx(v.name) });
    }
  }
  return out;
}
const here = (g, roots, regHas) => (g.files || []).some((f) => fs.existsSync(topOf(roots, f))) || regHas;

// [{ name, settings, graphics, here, running }]: settings / graphics = how many files or values would change
export async function plan(saved, { roots = realRoots(), reg = realReg, running = new Set() } = {}) {
  const out = [];
  for (const s of Array.isArray(saved) ? saved : []) {
    const g = CATALOG.find((c) => c.name === s?.name);
    if (!g) continue;
    const regHas = g.reg ? !!(await reg.read(g.reg)) : false;
    if (!here(g, roots, regHas)) { out.push({ name: g.name, settings: 0, graphics: 0, here: false, running: false }); continue; }
    const all = await writesFor(g, s, true, { roots, reg });
    const plain = await writesFor(g, s, false, { roots, reg });
    // (13 Nov 2026 bug hunt) a file with both controls and graphics in it is in both lists: its graphics count when the
    // two versions differ (it was counted by files, so the graphics switch was never shown and graphics went through)
    const key = (w) => (w.what === 'file' ? `f:${w.path}` : `r:${w.name}`);
    const body = (w) => (w.what === 'file' ? w.bytes.toString('base64') : w.data);
    const plainBy = new Map(plain.map((w) => [key(w), body(w)]));
    const gfx = all.filter((w) => plainBy.get(key(w)) !== body(w)).length;
    out.push({ name: g.name, settings: plain.length, graphics: gfx, here: true, running: g.exes.some((x) => running.has(x)) });
  }
  return out.filter((x) => !x.here || x.settings || x.graphics);
}

// ---------- load, with a backup first; Put back ----------
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export async function apply(saved, picks, { roots = realRoots(), reg = realReg, running = new Set(), backups } = {}) {
  const dir = path.join(backups, 'game-settings', stamp());
  const manifest = { at: new Date().toISOString(), games: [] };
  const lines = [];
  let done = 0, failed = 0;
  for (const p of Array.isArray(picks) ? picks : []) {
    const g = CATALOG.find((c) => c.name === p?.name);
    const s = (Array.isArray(saved) ? saved : []).find((x) => x?.name === p?.name);
    if (!g || !s) continue;
    if (g.exes.some((x) => running.has(x))) { lines.push({ name: g.name, text: 'running: close it, then load again' }); failed++; continue; }
    const writes = await writesFor(g, s, !!p.graphics, { roots, reg });
    if (!writes.length) continue;
    // back up everything about to change, before the first write
    const entry = { name: g.name, files: [], reg: [] };
    const now = g.reg ? (await reg.read(g.reg)) || new Map() : new Map();
    for (const w of writes) {
      if (w.what === 'file') { let b = null; try { b = fs.readFileSync(w.path).toString('base64'); } catch {} entry.files.push({ path: w.path, existed: b != null, data: b }); }
      else { const c = now.get(w.name); entry.reg.push({ key: w.key, name: w.name, existed: !!c, type: c?.type, data: c?.data }); }
    }
    manifest.games.push(entry);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    let ok = 0, bad = 0;
    for (const w of writes) {
      try {
        if (w.what === 'file') {
          fs.mkdirSync(path.dirname(w.path), { recursive: true });
          fs.writeFileSync(w.path, w.bytes);
          if (!fs.readFileSync(w.path).equals(w.bytes)) throw new Error('read back differs');
        } else {
          await reg.write(w.key, w.name, w.type, w.data);
          const back = (await reg.read(w.key))?.get(w.name);
          if (!back || back.data !== w.data) throw new Error('read back differs');
        }
        ok++;
      } catch { bad++; }
    }
    done += ok; failed += bad;
    lines.push({ name: g.name, text: bad ? `${ok} changed, ${bad} failed` : `${ok} changed` });
  }
  return { done, failed, lines, backup: manifest.games.length ? path.basename(dir) : null };
}

export function latestBackup(backups) {
  const root = path.join(backups, 'game-settings');
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'manifest.json')) && !fs.existsSync(path.join(root, n, 'put-back.json'))).sort(); } catch {}
  if (!names.length) return null;
  const name = names[names.length - 1];
  try { const m = JSON.parse(fs.readFileSync(path.join(root, name, 'manifest.json'), 'utf8')); return { name, at: m.at, games: m.games.map((g) => g.name) }; } catch { return null; }
}

// the newest backup, put back as it was: files written again (one that did not exist is moved into the backup folder),
// registry values set again (one that did not exist is removed)
export async function putBack(backups, { reg = realReg, running = new Set() } = {}) {
  const b = latestBackup(backups);
  if (!b) throw new Error('nothing to put back');
  const dir = path.join(backups, 'game-settings', b.name);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const busy = m.games.filter((g) => CATALOG.find((c) => c.name === g.name)?.exes.some((x) => running.has(x)));
  if (busy.length) throw new Error(`${busy.map((g) => g.name).join(', ')} is running: close it first`);
  let done = 0, failed = 0;
  for (const g of m.games) {
    const allowed = CATALOG.find((c) => c.name === g.name);
    if (!allowed) continue;
    for (const f of g.files) {
      try {
        if (f.existed) fs.writeFileSync(f.path, Buffer.from(f.data, 'base64'));
        else if (fs.existsSync(f.path)) { const to = path.join(dir, 'added', `${done}-${path.basename(f.path)}`); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f.path, to); }
        done++;
      } catch { failed++; }
    }
    for (const v of g.reg) {
      if (v.key !== allowed.reg) { failed++; continue; }
      try { if (v.existed) await reg.write(v.key, v.name, v.type, v.data); else await reg.del(v.key, v.name); done++; } catch { failed++; }
    }
  }
  fs.writeFileSync(path.join(dir, 'put-back.json'), JSON.stringify({ at: new Date().toISOString(), done, failed }));
  return { done, failed, games: m.games.map((g) => g.name) };
}
