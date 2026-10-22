// What the maker's app already installed on this PC says about a device (22 Oct 2026), read before any USB listening.
// READ-ONLY: it never runs a maker's app, never loads its DLLs, never decompiles anything, and never writes, moves or
// copies a file out of a maker's folder. Files are read in place and only a summary is printed. SQLite files are
// opened with `immutable=1` (no lock, no journal, nothing written beside them); Electron `.asar` archives are read
// through their plain JSON index, one entry at a time, without unpacking.
//
// Run: node helpers/vendor-files.mjs [--vid 046D] [--json | --summary]
//   stdout: the report as JSON; stderr: a short human summary (--json / --summary print only one of them).
// Limits: files over 50 MB are skipped, and each app stops after 2,000 files. Most PCs have 0-2 of these apps.
// Where each app keeps its device data, what can be read and what cannot: docs/handoff/vendor-files.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 2000;
const PARSE_BYTES = 20 * 1024 * 1024; // structure-parse files up to this size; larger ones (to 50 MB) get the id scan only
const CAP = { devices: 1000, settings: 300, commands: 300, files: 60 };

// One line per app: its usual folders (`install` = program files, `data` = what it keeps), the USB vendor ids it
// serves, and `where` / `limits`: what is known about its device data (sources in docs/handoff/vendor-files.md).
// A root is { base, path } or { base, dir, match } (every folder in base\dir whose name matches).
const PF = 'ProgramFiles', PF86 = 'ProgramFiles(x86)', PD = 'ProgramData', LA = 'LOCALAPPDATA', RA = 'APPDATA';
export const APPS = [
  { id: 'lghub', name: 'Logitech G HUB', vids: ['046D'],
    install: [{ base: PF, path: 'LGHUB' }],
    data: [{ base: LA, path: 'LGHUB' }, { base: PD, path: 'LGHUB' }],
    where: 'settings.db (SQLite, table DATA, column FILE = the whole settings JSON) in %LOCALAPPDATA%\\LGHUB; older versions settings.json. Device packs in %ProgramData%\\LGHUB\\depots\\<n>\\.',
    limits: 'HID++ commands are compiled into lghub_agent.exe; newer depot packages are encrypted. Expect device ids and per-device saved settings, no command bytes.' },
  { id: 'synapse3', name: 'Razer Synapse 3', vids: ['1532'],
    install: [{ base: PF86, path: 'Razer\\Synapse3' }, { base: PF, path: 'Razer\\Synapse3' }],
    data: [{ base: PD, path: 'Razer\\Synapse3' }, { base: PD, path: 'Razer\\Razer Central' }, { base: LA, path: 'Razer\\Synapse3' }, { base: RA, path: 'Synapse3' }],
    where: 'Per-account device folders in %ProgramData%\\Razer\\Razer Central\\Accounts\\<id>\\Devices (and Synapse3); logs in %LOCALAPPDATA%\\Razer\\Synapse3\\Log name the devices it found.',
    limits: 'The 90-byte report protocol is in .NET/native DLLs (not read). Saved profiles are mostly not human-readable.' },
  { id: 'synapse4', name: 'Razer Synapse 4', vids: ['1532'],
    install: [{ base: PF, path: 'Razer\\RazerAppEngine' }, { base: PF86, path: 'Razer\\RazerAppEngine' }],
    data: [{ base: LA, path: 'Razer\\RazerAppEngine' }, { base: PD, path: 'Razer\\RazerAppEngine' }, { base: RA, dir: '', match: /^razer/i }],
    where: 'Electron app (RazerAppEngine.exe, app-4.x folders): resources\\*.asar holds its JavaScript and JSON; user data in %LOCALAPPDATA%\\Razer\\RazerAppEngine.',
    limits: 'Device control runs through native services; the asar may list product ids and names. Unverified layout: read what this tool finds, do not assume.' },
  { id: 'icue4', name: 'Corsair iCUE 4', vids: ['1B1C'],
    install: [{ base: PF, path: 'Corsair\\CORSAIR iCUE 4 Software' }, { base: PF86, path: 'Corsair\\CORSAIR iCUE Software' }],
    data: [{ base: RA, path: 'Corsair\\CUE4' }, { base: LA, path: 'Corsair\\CUE4' }, { base: PD, path: 'Corsair\\CUE4' }],
    where: 'config.cuecfg (XML) in %APPDATA%\\Corsair\\CUE4 holds each device model\'s saved settings by name; device plugins are DLLs under the install folder.',
    limits: 'Bragi and the older protocols are compiled into the plugin DLLs (not read).' },
  { id: 'icue5', name: 'Corsair iCUE 5', vids: ['1B1C'],
    install: [{ base: PF, path: 'Corsair\\Corsair iCUE5 Software' }, { base: PF, path: 'Corsair\\CORSAIR iCUE 5 Software' }],
    data: [{ base: LA, path: 'Corsair\\CUE5' }, { base: RA, path: 'Corsair\\CUE5' }, { base: PD, path: 'Corsair\\CUE5' }],
    where: '%LOCALAPPDATA%\\Corsair\\CUE5\\cache\\devices.json: every model iCUE knows (USB vid/pid, name, type, package); %APPDATA%\\Corsair\\CUE5\\config.cuecfg (XML): each model\'s saved setting names and values; eq_presets\\*.cuelibrary (XML).',
    limits: 'Bragi property ids and commands are compiled into the device packages (not read); helpers/hs80-direct.js and docs/brands/corsair.md have them.' },
  { id: 'steelseries-gg', name: 'SteelSeries GG', vids: ['1038'],
    install: [{ base: PF, path: 'SteelSeries\\GG' }],
    data: [{ base: PD, path: 'SteelSeries\\GG' }],
    where: '%ProgramData%\\SteelSeries\\GG\\apps\\engine\\db\\database.db (SQLite): saved device configs (DPI and the like); coreProps.json names the local GameSense address.',
    limits: 'Device protocols are compiled into the Engine (Go) binary; expect saved settings, not command bytes.' },
  { id: 'steelseries-engine3', name: 'SteelSeries Engine 3', vids: ['1038'],
    install: [{ base: PF, path: 'SteelSeries\\SteelSeries Engine 3' }],
    data: [{ base: PD, path: 'SteelSeries\\SteelSeries Engine 3' }],
    where: '%ProgramData%\\SteelSeries\\SteelSeries Engine 3: db\\database.db (SQLite) and coreProps.json.',
    limits: 'As GG: protocols compiled in.' },
  { id: 'ngenuity', name: 'HyperX NGENUITY', vids: ['0951', '03F0'],
    install: [{ base: PF, path: 'HyperX\\NGENUITY' }, { base: PF86, path: 'HyperX\\NGenuity' }],
    data: [{ base: LA, dir: 'Packages', match: /hyperx.*ngenuity/i }],
    where: 'A Microsoft Store app: its files are in C:\\Program Files\\WindowsApps (not readable without taking ownership: never done); its data in %LOCALAPPDATA%\\Packages\\*HyperXNGenuity*\\LocalState.',
    limits: 'Program files unreadable by design; LocalState holds saved settings at best.' },
  { id: 'armoury-crate', name: 'ASUS Armoury Crate', vids: ['0B05'],
    install: [{ base: PF86, path: 'ASUS\\ArmouryDevice' }, { base: PF, path: 'ASUS\\ARMOURY CRATE Service' }, { base: PF, path: 'ASUS\\ARMOURY CRATE Lite Service' }],
    data: [{ base: PD, path: 'ASUS\\ARMOURY CRATE Service' }, { base: PD, path: 'ASUS\\ArmouryDevice' }, { base: LA, dir: 'Packages', match: /armourycrate/i }],
    where: 'Device plugins as DLL folders under %ProgramFiles(x86)%\\ASUS\\ArmouryDevice\\dll\\ (one per device family, some with xml/ini/json beside them); the UI is a Store app.',
    limits: 'Protocols are in the plugin DLLs (not read); side files may name models and product ids.' },
  { id: 'swarm2', name: 'Turtle Beach Swarm II', vids: ['10F5', '1E7D'],
    install: [{ base: PF, path: 'Turtle Beach\\Swarm II' }, { base: PF86, path: 'Turtle Beach\\Swarm II' }],
    data: [{ base: LA, path: 'Turtle Beach' }, { base: RA, path: 'Turtle Beach' }, { base: PD, path: 'Turtle Beach' }],
    where: 'Install folder and %LOCALAPPDATA%/%APPDATA%\\Turtle Beach (layout not documented anywhere public: read what this tool finds).',
    limits: 'Protocols compiled in; unverified layout.' },
  { id: 'glorious-core', name: 'Glorious CORE', vids: ['258A', '22D4', '320F'],
    install: [{ base: PF, path: 'Glorious Core' }, { base: PF86, path: 'Glorious Core' }, { base: PF, path: 'Glorious CORE' }],
    data: [{ base: LA, path: 'Glorious Core' }, { base: RA, path: 'Glorious Core' }],
    where: '%APPDATA%\\Glorious Core\\datastore keeps device settings across reinstalls (Glorious support); per-device side files in the install folder.',
    limits: 'Protocols compiled in; settings also live on the device itself.' },
  { id: 'pulsar', name: 'Pulsar Fusion / cMouse', vids: ['3710'],
    install: [{ base: PF, dir: '', match: /pulsar|cmouse/i }, { base: PF86, dir: '', match: /pulsar|cmouse/i }, { base: LA, dir: 'Programs', match: /pulsar|fusion|cmouse/i }],
    data: [{ base: LA, dir: '', match: /pulsar|cmouse/i }, { base: RA, dir: '', match: /pulsar|fusion|cmouse/i }],
    where: 'No public description. Folder names matched: Pulsar*, cMouse*, Fusion* (under %LOCALAPPDATA%\\Programs and %APPDATA%).',
    limits: 'No open project documents the protocol; DeviceHub learned the X-Lite read-only (BRANDS.md).' },
  { id: 'epomaker', name: 'Epomaker Driver', vids: ['342D'],
    install: [{ base: PF, dir: '', match: /epomaker/i }, { base: PF86, dir: '', match: /epomaker/i }, { base: LA, dir: 'Programs', match: /epomaker/i }],
    data: [{ base: LA, dir: '', match: /epomaker/i }, { base: RA, dir: '', match: /epomaker/i }],
    where: 'Current driver: an Electron app plus a Rust service (iot_driver.exe); its commands are in the app\'s JavaScript (resources\\app.asar). Older drivers: per-model folders with ini/json.',
    limits: 'Model identification is in iot_driver.exe (not read). The P75 speaks VIA, which DeviceHub already runs.' },
  { id: 'wootility', name: 'Wooting Wootility', vids: ['31E3', '03EB'],
    install: [{ base: LA, dir: 'Programs', match: /wootility/i }, { base: PF, dir: '', match: /wootility|wooting/i }],
    data: [{ base: RA, dir: '', match: /wootility/i }],
    where: 'Electron app in %LOCALAPPDATA%\\Programs\\wootility*; settings in %APPDATA%\\wootility* (Local Storage is LevelDB: not read). Profiles live on the keyboard.',
    limits: 'Wooting publishes open SDKs (RGB and analog) that document much of it.' },
  { id: 'keychron', name: 'Keychron Launcher', vids: ['3434'], web: true, install: [], data: [],
    where: 'A web app (launcher.keychron.com, WebHID): nothing is installed, so there is nothing to read. Keychron boards speak VIA/QMK, which DeviceHub already runs.',
    limits: 'Nothing on disk.' },
];

// ---------------------------------------------------------------- values

// A USB id as 4 upper-case hex digits, or null. JSON numbers are decimal (iCUE writes 6940 for 1B1C); a 4-character
// string is hex ("046d", "C547"); "0x..." is hex; a longer all-digit string is decimal.
export function hex4(v) {
  let n = null;
  if (typeof v === 'number' && Number.isInteger(v)) n = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (/^0x[0-9a-f]{1,4}$/i.test(s)) n = parseInt(s, 16);
    else if (/^[0-9a-f]{4}$/i.test(s)) n = parseInt(s, 16);
    else if (/^\d{5}$/.test(s)) n = Number(s);
  }
  return n != null && n > 0 && n <= 0xffff ? n.toString(16).toUpperCase().padStart(4, '0') : null;
}

// XML and INI carry numbers as text, so "6940" may be decimal (iCUE's XML: 6940 = 1B1C) or hex. When a 4-digit
// vendor id is a known maker's id only as decimal, both ids are read as decimal.
const KNOWN_VIDS = new Set(['046D', '1532', '1B1C', '1038', '0951', '03F0', '0B05', '10F5', '1E7D', '258A', '22D4', '320F', '3710', '342D', '31E3', '03EB', '3434', '2E95', '170D', '0FD9']);
export function idPair(rv, rp) {
  let vid = rv == null ? null : hex4(rv), pid = rp == null ? null : hex4(rp);
  if (typeof rv === 'string' && /^\d{4}$/.test(rv.trim())) {
    const dec = hex4(Number(rv));
    if (dec && KNOWN_VIDS.has(dec) && !KNOWN_VIDS.has(vid)) { vid = dec; if (typeof rp === 'string' && /^\d{1,5}$/.test(rp.trim())) pid = hex4(Number(rp)); }
  }
  return [vid, pid];
}

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const VID_KEYS = new Set(['vid', 'usbvid', 'vendorid', 'idvendor', 'hidvid']);
const PID_KEYS = new Set(['pid', 'usbpid', 'productid', 'idproduct', 'hidpid']);
const PIDS_KEYS = new Set(['pids', 'productids', 'usbpids']);
const NAME_KEYS = ['displayname', 'modelname', 'productname', 'devicename', 'model', 'name', 'title'];
const TYPE_KEYS = ['devicetype', 'type', 'category', 'kind'];
const MIN_KEYS = ['min', 'minimum', 'minvalue', 'rangemin', 'from'];
const MAX_KEYS = ['max', 'maximum', 'maxvalue', 'rangemax', 'to'];
const CMD_KEYS = new Set(['cmd', 'command', 'commands', 'report', 'reportdata', 'packet', 'payload', 'bytes', 'opcode', 'request', 'hidreport', 'rawcommand']);
const SETTING_NAME_KEYS = ['name', 'key', 'id', 'label', 'setting', 'property'];
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null);

// "AA BB" bytes from a hex string or an array of 0-255 integers, or null (needs 2-128 bytes).
export function bytesOf(v) {
  let b = null;
  if (Array.isArray(v) && v.length >= 2 && v.length <= 128 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) b = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (/^(0x)?[0-9a-f]{2}([ ,:-]+(0x)?[0-9a-f]{2})+$/i.test(s)) b = s.split(/[ ,:-]+/).map((x) => parseInt(x.replace(/^0x/i, ''), 16));
    else if (/^(0x)?([0-9a-f]{2}){2,128}$/i.test(s) && /[0-9]/.test(s)) b = s.replace(/^0x/i, '').match(/../g).map((x) => parseInt(x, 16));
  }
  return b && b.length >= 2 && b.length <= 128 ? b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') : null;
}

// ---------------------------------------------------------------- extractors (each fills `out`)

export const newOut = () => ({ devices: [], settings: [], commands: [] });

// Walks any parsed JSON (or a JSON-like object built from XML/INI) for device ids, setting ranges and command bytes.
export function fromJsonValue(root, source, out, { key = null, name = null } = {}) {
  let budget = 300000;
  const walk = (v, key, ctx, depth) => {
    if (budget-- <= 0 || depth > 40 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, key, ctx, depth + 1); return; }
    const keys = Object.keys(v), by = {};
    for (const k of keys) { const n = norm(k); if (!(n in by)) by[n] = v[k]; }
    const pick = (list) => { for (const n of list) if (typeof by[n] === 'string' && by[n].trim()) return by[n].trim(); return null; };
    let rv, rp;
    for (const n of Object.keys(by)) { if (VID_KEYS.has(n) && rv == null) rv = by[n]; if (PID_KEYS.has(n) && rp == null) rp = by[n]; }
    const [vid, pid] = idPair(rv, rp);
    const name = pick(NAME_KEYS), type = pick(TYPE_KEYS);
    const here = { vid: vid || ctx.vid, name: name || ctx.name, type: type || ctx.type };
    if (pid) out.devices.push({ vid: here.vid, pid, name: here.name, type: here.type, source });
    for (const n of Object.keys(by)) if (PIDS_KEYS.has(n) && Array.isArray(by[n])) for (const p of by[n]) { const h = hex4(p); if (h) out.devices.push({ vid: here.vid, pid: h, name: here.name, type: here.type, source }); }
    let mn = null, mx = null;
    for (const n of MIN_KEYS) if (mn == null && n in by) mn = num(by[n]);
    for (const n of MAX_KEYS) if (mx == null && n in by) mx = num(by[n]);
    if (mn != null && mx != null && mx > mn) {
      const step = num(by.step ?? by.increment ?? by.resolution), def = num(by.default ?? by.defaultvalue ?? by.def);
      out.settings.push({ name: pick(SETTING_NAME_KEYS) || key || null, min: mn, max: mx, ...(step != null ? { step } : {}), ...(def != null ? { default: def } : {}), device: here.name || null, source });
    }
    for (const k of keys) {
      if (CMD_KEYS.has(norm(k))) {
        const list = Array.isArray(v[k]) && v[k].some((x) => typeof x === 'string' || Array.isArray(x)) ? v[k] : [v[k]];
        for (const c of list) { const b = bytesOf(c); if (b) out.commands.push({ name: pick(SETTING_NAME_KEYS) || key || k, key: k, bytes: b, device: here.name || null, source }); }
      }
      const c = v[k];
      if (c && typeof c === 'object') walk(c, k, here, depth + 1);
    }
  };
  walk(root, key, { vid: null, name, type: null }, 0);
  return out;
}

// USB ids written in plain text: VID_046D&PID_C547 (Windows device paths, logs, ini), and in JavaScript object
// literals: vid: 0x046d, pid: 0xc547 (also vendorId/productId, decimal or hex).
export function fromText(text, source, out) {
  const seen = new Set();
  const add = (v, p, how) => { const vid = hex4(v), pid = hex4(p); if (vid && pid && !seen.has(vid + pid)) { seen.add(vid + pid); out.devices.push({ vid, pid, name: null, type: null, source, how }); } };
  for (const m of text.matchAll(/VID[_&]?([0-9A-F]{4})[&_\s]{0,3}PID[_&]?([0-9A-F]{4})/gi)) add(m[1], m[2], 'text');
  for (const m of text.matchAll(/\b(?:vid|vendorId|idVendor)\s*[:=]\s*(0x[0-9a-f]{1,4}|\d{3,5})\s*[,;]?\s*["']?(?:pid|productId|idProduct)["']?\s*[:=]\s*(0x[0-9a-f]{1,4}|\d{3,5})/gi)) {
    const v = /^0x/i.test(m[1]) ? m[1] : Number(m[1]), p = /^0x/i.test(m[2]) ? m[2] : Number(m[2]);
    add(v, p, 'code');
  }
  return out;
}

// A small XML reader (no DTDs, no entities beyond the five basic ones) into a tree {tag, attrs, text, kids}.
export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, text: '', kids: [] }, stack = [root];
  const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(?!\[CDATA)[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of text.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      for (const a of (m[4] || '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = ent(a[2] ?? a[3] ?? a[4] ?? '');
      const node = { tag: m[3], attrs, text: '', kids: [] };
      top.kids.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] != null) top.text += ent(m[6]);
  }
  return root;
}

// An XML tree as a JSON-like object: attributes, then children (<x>text</x> becomes x: "text"; a child carrying a
// name attribute and only text, such as iCUE's <value name="BrightnessLevel">66</value>, becomes BrightnessLevel: "66").
export function xmlToObject(node, depth = 0) {
  const o = { ...node.attrs };
  if (depth > 60) return o;
  for (const k of node.kids) {
    const leaf = k.kids.length === 0;
    const key = leaf && k.attrs.name && Object.keys(k.attrs).length === 1 ? k.attrs.name : k.tag;
    const val = leaf && (Object.keys(k.attrs).length === 0 || key === k.attrs.name) ? k.text.trim() : xmlToObject(k, depth + 1);
    if (key in o) { if (!Array.isArray(o[key]) || !o['#multi:' + key]) { o[key] = [o[key]]; Object.defineProperty(o, '#multi:' + key, { value: true }); } o[key].push(val); } else o[key] = val;
  }
  if (node.text.trim() && node.kids.length) o['#text'] = node.text.trim();
  return o;
}

export function fromXml(text, source, out) {
  fromJsonValue(xmlToObject(parseXml(text)), source, out);
  fromText(text, source, out);
  return out;
}

// iCUE's config.cuecfg: <map name="Devices"><map name="HS80"><map name="{instance}"><value name="...">: each model's
// saved setting names (with the value when it is a plain value; <binary> ones are named only). Instance GUIDs, user
// and machine ids elsewhere in the file are never output.
export function fromCueCfg(text) {
  const models = {};
  const tree = parseXml(text);
  const find = (n) => { if (n.tag === 'map' && n.attrs.name === 'Devices') return n; for (const k of n.kids) { const f = find(k); if (f) return f; } return null; };
  const dev = find(tree);
  if (!dev) return models;
  for (const model of dev.kids.filter((k) => k.tag === 'map')) {
    const names = {};
    const hide = (key, v) => (/unique|serial|identity|user|machine|guid|uuid|address/i.test(key) || /^\{?[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? '(id, not shown)' : v);
    const collect = (n) => { for (const k of n.kids) { if (k.tag === 'map') collect(k); else if (k.attrs.name && (k.tag === 'value' || k.tag === 'binary')) names[k.attrs.name] = k.tag === 'binary' ? '(binary)' : hide(k.attrs.name, k.text.trim().slice(0, 40)); } };
    collect(model);
    models[model.attrs.name || '?'] = names;
  }
  return models;
}

export function parseIni(text) {
  const o = {}; let sec = o, secName = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    const s = line.match(/^\[(.+)\]$/);
    if (s) { secName = s[1].trim(); sec = o[secName] = {}; continue; }
    const kv = line.match(/^([^=:]+?)\s*[=:]\s*(.*)$/);
    if (kv) sec[kv[1].trim()] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return o;
}

export function fromIni(text, source, out) {
  const ini = parseIni(text);
  // Sections are walked one by one, named after their [section]; the model named in a section that carries the USB
  // ids (or [Device]) names the device the other sections' ranges and commands belong to.
  const secs = Object.entries(ini).filter(([, v]) => v && typeof v === 'object');
  const nameOf = (v) => Object.entries(v).find(([k]) => /^(name|model|modelname|productname|devicename)$/i.test(k))?.[1] || null;
  const devSec = secs.find(([, v]) => Object.keys(v).some((k) => PID_KEYS.has(norm(k)))) || secs.find(([k]) => /^device$/i.test(k));
  const model = devSec ? nameOf(devSec[1]) : null;
  for (const [k, v] of secs) fromJsonValue(v, source, out, { key: k, name: model });
  fromJsonValue(Object.fromEntries(Object.entries(ini).filter(([, v]) => typeof v !== 'object')), source, out);
  fromText(text, source, out);
  return out;
}

let sqliteMod;
async function sqlite() {
  if (sqliteMod !== undefined) return sqliteMod;
  const emit = process.emitWarning; // node:sqlite prints an "experimental" warning on first load; keep the output clean
  process.emitWarning = (w, ...a) => { if (!/sqlite/i.test(String(w?.message || w))) emit.call(process, w, ...a); };
  try { sqliteMod = await import('node:sqlite'); } catch { sqliteMod = null; } finally { process.emitWarning = emit; }
  return sqliteMod;
}

// A SQLite file opened immutable and read-only (nothing is locked or written, not even a -shm/-wal beside it). Every
// table is listed with its row count; text or blob values holding JSON (G HUB keeps its whole settings JSON in one
// blob) are walked like any JSON; other text is scanned for USB ids. Note: immutable mode does not see changes still
// in a running app's write-ahead log.
export async function fromSqlite(file, source, out, { rowsPerTable = 500, maxTables = 40 } = {}) {
  const mod = await sqlite();
  if (!mod?.DatabaseSync) return { error: 'this Node has no built-in SQLite (needs Node 22.5 or newer)' };
  const url = pathToFileURL(file); url.searchParams.set('immutable', '1');
  let db;
  try { db = new mod.DatabaseSync(url, { readOnly: true }); } catch (e) { return { error: e.message }; }
  const tables = {};
  try {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name).slice(0, maxTables);
    const dec = new TextDecoder();
    for (const t of names) {
      const q = '"' + t.replace(/"/g, '""') + '"';
      try {
        tables[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${q}`).get().n;
        for (const row of db.prepare(`SELECT * FROM ${q} LIMIT ${rowsPerTable}`).all()) {
          for (const [col, val] of Object.entries(row)) {
            let s = typeof val === 'string' ? val : val instanceof Uint8Array && val.length <= PARSE_BYTES ? dec.decode(val) : null;
            if (!s) continue;
            const st = s.trimStart()[0];
            if (st === '{' || st === '[') { try { fromJsonValue(JSON.parse(s), `${source} [${t}.${col}]`, out); continue; } catch { /* not JSON */ } }
            if (s.length < 1e6) fromText(s, `${source} [${t}.${col}]`, out);
          }
        }
      } catch (e) { tables[t] = 'unreadable: ' + e.message; }
    }
  } finally { db.close(); }
  return { tables };
}

// An Electron .asar archive's index: a 16-byte header, then a JSON tree of entries with { size, offset } relative to
// the end of the header. Returns the files (path, size, offset, unpacked) without reading any of them.
export function readAsarIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) < 16) return null;
    const headerSize = head.readUInt32LE(4), jsonLen = head.readUInt32LE(12);
    if (head.readUInt32LE(0) !== 4 || jsonLen > 64 * 1024 * 1024 || jsonLen > headerSize) return null;
    const buf = Buffer.alloc(jsonLen);
    fs.readSync(fd, buf, 0, jsonLen, 16);
    const index = JSON.parse(buf.toString('utf8'));
    const base = 8 + headerSize, files = [];
    const walk = (node, pre) => { for (const [n, e] of Object.entries(node.files || {})) { const p = pre ? pre + '/' + n : n; if (e.files) walk(e, p); else if (e.size != null) files.push({ path: p, size: e.size, offset: base + Number(e.offset || 0), unpacked: !!e.unpacked }); } };
    walk(index, '');
    return { files };
  } finally { fs.closeSync(fd); }
}

function readSlice(file, offset, size) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(size); fs.readSync(fd, b, 0, size, offset); return b.toString('utf8'); } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------- the scan

const SKIP_DIRS = /^(cache_data|code cache|gpucache|dawncache|dawnwebgpucache|grshadercache|shadercache|crashpad|crashdata|crashdumps|crash reports|blob_storage|service worker|indexeddb|local storage|session storage|webstorage|locales|swiftshader|gamesdkeffects|cue backup|backup|backups|images|img|sounds|fonts|videos|qmlcache|node_modules|\.git)$/i;
const SKIP_FILE = /\.(json|cuecfg|cueprofiledata|cueprofileorder|db|xml)\.[A-Za-z]{6}$|-(wal|shm|journal)$/i; // iCUE's temp copies, SQLite side files
const BINARY = /\.(exe|dll|sys|cat|inf|bin|fw|hex|png|jpe?g|gif|webp|svg|ico|bmp|mp4|webm|wav|mp3|ogg|ttf|otf|woff2?|pak|dat|lock|log|ldb|zip|7z|cab|msi|node|pdb|mui|qm|qmlc|cueprofile)$/i;

export function bases(env = process.env) {
  return { ProgramFiles: env.ProgramFiles || env.PROGRAMFILES, 'ProgramFiles(x86)': env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'],
    ProgramData: env.ProgramData || env.PROGRAMDATA, LOCALAPPDATA: env.LOCALAPPDATA, APPDATA: env.APPDATA };
}

function resolveRoots(specs, b) {
  const found = [];
  for (const r of specs) {
    const base = b[r.base];
    if (!base) continue;
    if (r.match) {
      const dir = path.join(base, r.dir || '');
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && r.match.test(d.name)).map((d) => d.name); } catch { /* none */ }
      for (const n of names) found.push({ base: r.base, abs: path.join(dir, n) });
    } else {
      const abs = path.join(base, r.path);
      try { if (fs.statSync(abs).isDirectory()) found.push({ base: r.base, abs }); } catch { /* none */ }
    }
  }
  return found;
}

async function examine(file, rel, size, out, extra) {
  const ext = path.extname(file).toLowerCase();
  const read = () => fs.readFileSync(file, 'utf8');
  if (size > PARSE_BYTES) { if (!BINARY.test(file)) fromText(read(), rel, out); return 'text-scan'; }
  if (ext === '.json') { const t = read().replace(/^\uFEFF/, ''); try { fromJsonValue(JSON.parse(t), rel, out); } catch { fromText(t, rel, out); return 'json (unreadable, id scan)'; } return 'json'; }
  if (ext === '.xml' || ext === '.cuecfg' || ext === '.cuelibrary' || ext === '.config') {
    const t = read();
    fromXml(t, rel, out);
    if (ext === '.cuecfg') { const m = fromCueCfg(t); if (Object.keys(m).length) Object.assign(extra.savedSettings, m); }
    return 'xml';
  }
  if (ext === '.ini' || ext === '.cfg' || ext === '.conf' || ext === '.properties') { fromIni(read(), rel, out); return 'ini'; }
  if (ext === '.txt' || ext === '.csv' || ext === '.yaml' || ext === '.yml' || ext === '.js' || ext === '.mjs' || ext === '.cjs') { fromText(read(), rel, out); return 'text'; }
  if (ext === '.asar') return await examineAsar(file, rel, out, extra);
  // Extension-less or other: sniff the first bytes (SQLite, JSON, XML); anything else is left alone.
  const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); let n = 0;
  try { n = fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  const h = head.subarray(0, n).toString('latin1');
  if (h.startsWith('SQLite format 3')) { const r = await fromSqlite(file, rel, out); extra.sqlite.push({ file: rel, ...r }); return 'sqlite'; }
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') return 'other';
  const c = h.replace(/^\uFEFF|^\xEF\xBB\xBF/, '').trimStart()[0];
  if (c === '{' || c === '[') { const t = read(); try { fromJsonValue(JSON.parse(t), rel, out); return 'json'; } catch { fromText(t, rel, out); return 'text'; } }
  if (c === '<') { fromXml(read(), rel, out); return 'xml'; }
  return 'other';
}

async function examineAsar(file, rel, out, extra) {
  let idx;
  try { idx = readAsarIndex(file); } catch (e) { extra.asar.push({ file: rel, error: e.message }); return 'asar (unreadable)'; }
  if (!idx) return 'other';
  let read = 0;
  for (const e of idx.files) {
    if (extra.budget() <= 0) break;
    if (e.unpacked || /(^|\/)node_modules\//.test(e.path) || !/\.(json|js|mjs|cjs|xml|ini)$/i.test(e.path)) continue;
    if (e.size > (/\.json$/i.test(e.path) ? 5 : 20) * 1024 * 1024) continue;
    extra.spend(); read++;
    const t = readSlice(file, e.offset, e.size), where = `${rel} > ${e.path}`;
    if (/\.json$/i.test(e.path)) { try { fromJsonValue(JSON.parse(t), where, out); } catch { fromText(t, where, out); } }
    else if (/\.xml$/i.test(e.path)) fromXml(t, where, out);
    else if (/\.ini$/i.test(e.path)) fromIni(t, where, out);
    else fromText(t, where, out);
  }
  extra.asar.push({ file: rel, entries: idx.files.length, read });
  return 'asar';
}

function dedupe(list, keyOf, cap) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); const had = m.get(k); if (had) had.seen++; else m.set(k, { ...x, seen: 1 }); }
  const all = [...m.values()];
  return { total: all.length, items: all.slice(0, cap) };
}

export async function scanApp(app, { env = process.env, maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}) {
  const b = bases(env);
  const res = { id: app.id, name: app.name, vids: app.vids, status: 'not found', folders: [], where: app.where, limits: app.limits };
  if (app.web) { res.status = 'web app (nothing installed)'; return res; }
  const installRoots = resolveRoots(app.install, b), dataRoots = resolveRoots(app.data, b);
  const roots = [...installRoots, ...dataRoots].filter((r, i, a) => a.findIndex((x) => x.abs.toLowerCase() === r.abs.toLowerCase()) === i)
    .filter((r, i, a) => !a.some((x, j) => j !== i && r.abs.toLowerCase().startsWith(x.abs.toLowerCase() + path.sep)));
  if (!roots.length) return res;
  const out = newOut(), extra = { savedSettings: {}, sqlite: [], asar: [] };
  let seen = 0, exes = 0, stopped = false;
  const byType = {}, big = [], files = [], errors = [];
  extra.budget = () => maxFiles - seen; extra.spend = () => { seen++; };
  for (const root of roots) {
    const label = (abs) => `%${root.base}%\\` + path.relative(b[root.base], abs);
    res.folders.push(label(root.abs));
    const isInstall = installRoots.includes(root);
    const stack = [root.abs];
    while (stack.length) {
      const dir = stack.pop();
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { errors.push(`${label(dir)}: ${e.code || e.message}`); continue; }
      for (const d of ents) {
        const abs = path.join(dir, d.name);
        if (d.isSymbolicLink()) continue; // never follow a link out of the maker's folder
        if (d.isDirectory()) { if (!SKIP_DIRS.test(d.name)) stack.push(abs); continue; }
        if (!d.isFile()) continue;
        if (/\.exe$/i.test(d.name) && isInstall) exes++;
        if (seen >= maxFiles) { stopped = true; break; }
        seen++;
        if (BINARY.test(d.name) || SKIP_FILE.test(d.name)) { byType.binary = (byType.binary || 0) + 1; continue; }
        let size;
        try { size = fs.statSync(abs).size; } catch { continue; }
        if (size > maxBytes) { big.push(`${label(abs)} (${Math.round(size / 1048576)} MB)`); continue; }
        const before = [out.devices.length, out.settings.length, out.commands.length], savedBefore = Object.keys(extra.savedSettings).length;
        let kind;
        try { kind = await examine(abs, label(abs), size, out, extra); } catch (e) { kind = 'unreadable'; errors.push(`${label(abs)}: ${e.code || e.message}`); }
        byType[kind] = (byType[kind] || 0) + 1;
        const got = [out.devices.length - before[0], out.settings.length - before[1], out.commands.length - before[2]];
        const saved = Object.keys(extra.savedSettings).length - savedBefore;
        if (got.some((x) => x) || saved) files.push({ file: label(abs), kind, devices: got[0], settings: got[1], commands: got[2], ...(saved ? { savedModels: saved } : {}) });
      }
      if (stopped) break;
    }
    if (stopped) break;
  }
  const status = installRoots.length && exes ? 'installed' : dataRoots.some((r) => /[\\/]Packages[\\/]/i.test(r.abs)) ? 'installed (Store app)' : 'leftovers only (app not installed)';
  const devices = dedupe(out.devices, (d) => `${d.vid}:${d.pid}:${(d.name || '').toLowerCase()}`, CAP.devices);
  Object.assign(res, {
    status, filesLooked: seen, stoppedAtLimit: stopped, byType, skippedOver50MB: big.slice(0, 20), errors: errors.slice(0, 20),
    deviceFiles: files.slice(0, CAP.files), deviceFilesTotal: files.length,
    devicesTotal: devices.total, devices: devices.items,
    settings: dedupe(out.settings, (s) => `${s.device}:${s.name}:${s.min}:${s.max}`, CAP.settings).items,
    commands: dedupe(out.commands, (c) => `${c.device}:${c.name}:${c.bytes}`, CAP.commands).items,
    savedSettings: extra.savedSettings, sqlite: extra.sqlite, asar: extra.asar,
  });
  return res;
}

export async function scan({ vid = null, env = process.env, maxFiles = MAX_FILES, maxBytes = MAX_BYTES, apps = APPS } = {}) {
  const want = vid ? hex4(String(vid).replace(/^0x/i, '').padStart(4, '0')) : null;
  const report = { at: new Date().toISOString(), readOnly: true, vid: want, apps: [] };
  for (const app of apps) {
    if (want && !app.vids.includes(want)) { report.apps.push({ id: app.id, name: app.name, vids: app.vids, status: `skipped (serves ${app.vids.join(', ')})` }); continue; }
    const r = await scanApp(app, { env, maxFiles, maxBytes });
    if (want && r.devices) { r.devices = r.devices.filter((d) => d.vid === want); r.devicesTotal = r.devices.length; }
    report.apps.push(r);
  }
  return report;
}

export function summary(report) {
  const lines = [`Maker apps on this PC (read-only${report.vid ? `, vendor ${report.vid}` : ''}):`];
  const found = report.apps.filter((a) => a.folders?.length);
  for (const a of found) {
    const bits = [`${a.devicesTotal} device id${a.devicesTotal === 1 ? '' : 's'}`];
    if (a.settings?.length) bits.push(`${a.settings.length} setting range${a.settings.length === 1 ? '' : 's'}`);
    if (a.commands?.length) bits.push(`${a.commands.length} command${a.commands.length === 1 ? '' : 's'} in plain text`);
    const saved = Object.keys(a.savedSettings || {});
    if (saved.length) bits.push(`saved settings for ${saved.slice(0, 6).join(', ')}${saved.length > 6 ? ` +${saved.length - 6}` : ''}`);
    lines.push(`- ${a.name}: ${a.status}; ${a.filesLooked} files looked at${a.stoppedAtLimit ? ' (stopped at the limit)' : ''}; ${bits.join(', ')}.`);
    for (const f of (a.deviceFiles || []).slice(0, 4)) lines.push(`    ${f.file}: ${f.devices} ids, ${f.settings} ranges, ${f.commands} commands${f.savedModels ? `, ${f.savedModels} models' saved settings` : ''}`);
  }
  if (!found.length) {
    const serving = report.vid ? report.apps.filter((a) => a.vids.includes(report.vid)).map((a) => a.name) : [];
    lines.push(report.vid ? `- no app serving vendor ${report.vid} was found${serving.length ? ` (looked for ${serving.join(', ')})` : ' (no app in the list serves it)'}.` : '- none of the known maker apps (or their leftovers) were found.');
  }
  const web = report.apps.filter((a) => /web app/.test(a.status || '')).map((a) => a.name);
  if (web.length) lines.push(`- ${web.join(', ')}: web only, nothing on disk.`);
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--vid');
  const report = await scan({ vid: i >= 0 ? args[i + 1] : null });
  if (!args.includes('--summary')) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!args.includes('--json')) process.stderr.write(summary(report) + '\n');
}
