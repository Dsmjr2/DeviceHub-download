// Drivers as data (22 Oct 2026): a device described in a driver.json (docs/DRIVER-FORMAT.md) instead of written as a
// device.mjs. fromJson(obj | path) checks the file (validate) and returns a driver with exactly the device.mjs contract
// (id, title, kind, hid, settings, unsupported, connect, info, read, write with read-back, battery, rawBackup), the same
// shape helpers/my-devices.mjs loads. It sends ONLY messages built from the file's own templates: there is no other way
// for bytes to leave it. validate(obj) returns { ok, problems } and explains every refusal in plain words: a file that
// could send something outside its templates, a template matching the file's own never list or DeviceHub's
// (helpers/never-commands.json), a write with no read of the same setting, a numeric write without a range, or a
// malformed file. Proof against the ASUS ROG mouse's device.mjs: tests/declarative-driver.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HidChannel, getDevice, hex } from '../public/devices/hid.js';

export const FORMAT = 1;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILT_IN = ['mouse', 'headset', 'keyboard'];
const RESERVED = ['model', 'link', 'probe', 'value', 'zone', 'button'];
const TYPES = ['slider', 'toggle', 'choice', 'display', 'color', 'remap'];
const HEX = /^#[0-9a-f]{6}$/;
const CHECKSUMS = ['none', 'xor', 'sum8', 'sum16le'];
const PLACE = { u8: 1, u16le: 2, u16be: 2, u32le: 4, u32be: 4, rgb: 3 };
const STEP_BACK_MS = 15000, SNAP_MS = 1000;

class Refused extends Error {}

// ---------------------------------------------------------------- the built-in never list
let neverCache = null;
export function builtInNever() {
  if (!neverCache) neverCache = JSON.parse(fs.readFileSync(path.join(HERE, 'never-commands.json'), 'utf8'));
  return neverCache;
}

// ---------------------------------------------------------------- small parts
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const hex4 = (s) => typeof s === 'string' && /^[0-9A-F]{4}$/i.test(s);
const up4 = (s) => String(s).toUpperCase().padStart(4, '0');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const num = (x) => (typeof x === 'string' ? Number(x) : x);

// a dotted path in a context ("model.battery", "link.name", "probe.booster", "pollingHigh")
function get(ctx, p) { let o = ctx; for (const k of String(p).split('.')) { if (o == null) return undefined; o = o[k]; } return o; }
// "$model.dpiMax" -> that value; anything else as it is
const resolve = (v, ctx) => (typeof v === 'string' && v.startsWith('$') ? get(ctx, v.slice(1)) : v);
// a condition: every key must match; a value matches equal, an array any of, { not: x } anything but x
function test(cond, ctx) {
  if (!cond) return true;
  for (const [k, want] of Object.entries(cond)) {
    const have = get(ctx, k);
    if (Array.isArray(want)) { if (!want.some((w) => same(w, have ?? null))) return false; }
    else if (isObj(want) && 'not' in want) { if (same(have ?? null, want.not)) return false; }
    else if (!same(have ?? null, want)) return false;
  }
  return true;
}

// the same, looking only at model.* keys (validate checks every variant a model could show, on any link)
const modelTest = (cond, ctx) => test(cond && Object.fromEntries(Object.entries(cond).filter(([k]) => k.startsWith('model.'))), ctx);

// a template: "51 31 00 00 {value:u16le} {dpi1Color?}" -> [{ byte } | { name, type, optional }]
export function parseTemplate(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('it has no bytes');
  return text.trim().split(/\s+/).map((t) => {
    if (/^[0-9A-F]{2}$/i.test(t)) return { byte: parseInt(t, 16) };
    const m = /^\{([A-Za-z][A-Za-z0-9_]*)(?::(u8|u16le|u16be|u32le|u32be|bytes|rgb))?(\?)?\}$/.exec(t);
    if (!m) throw new Error(`"${t}" is neither a byte (two hex digits) nor a placeholder like {value} or {value:u16le}`);
    return { name: m[1], type: m[2] || null, optional: !!m[3] };
  });
}
// a never pattern: "D? DA 02" -> [{ hi, lo } nibbles, null = any]
function parsePattern(text) {
  return String(text).trim().split(/\s+/).map((t) => {
    if (!/^[0-9A-F?]{2}$/i.test(t)) throw new Error(`"${t}" is not a byte pattern (two hex digits, ? for any)`);
    const n = (c) => (c === '?' ? null : parseInt(c, 16));
    return { hi: n(t[0]), lo: n(t[1]) };
  });
}
const nibbleOk = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));

function putNumber(out, v, type, what) {
  const size = PLACE[type || 'u8'];
  if (!Number.isInteger(v) || v < 0 || v >= 2 ** (8 * size)) throw new Refused(`${what} = ${v} does not fit in ${size} byte${size > 1 ? 's' : ''}`);
  const bytes = [];
  for (let i = 0; i < size; i++) bytes.push(Math.floor(v / 2 ** (8 * i)) & 0xff);
  out.push(...(/be$/.test(type || '') ? bytes.reverse() : bytes));
}
function readNumber(r, offset, size, endian) {
  let v = 0;
  for (let i = 0; i < size; i++) v += r[offset + i] * 2 ** (8 * (endian === 'big' ? size - 1 - i : i));
  return v;
}
function checksum(buf, c) {
  if (!c || c.type === 'none') return;
  let s = 0;
  for (let i = c.from; i <= c.to; i++) s = c.type === 'xor' ? s ^ buf[i] : s + buf[i];
  if (c.type === 'sum16le') { buf[c.at] = s & 0xff; buf[c.at + 1] = (s >> 8) & 0xff; } else buf[c.at] = s & 0xff;
}
function checksumOk(r, c) {
  if (!c || c.type === 'none') return true;
  const copy = Uint8Array.from(r); checksum(copy, c);
  return c.type === 'sum16le' ? copy[c.at] === r[c.at] && copy[c.at + 1] === r[c.at + 1] : copy[c.at] === r[c.at];
}

// one field out of a reply: raw number (or bytes), then mask, shift, absentIf, map / bool / scale + add.
// Returns { raw, value } or null when absent.
function decodeField(f, r, ctx) {
  const size = f.size ?? (f.type === 'bytes' ? 1 : 1);
  if (r.length < f.offset + size) return null;
  if (f.type === 'bytes') { const b = Array.from(r.slice(f.offset, f.offset + size)); return { raw: b, value: b }; }
  let raw = readNumber(r, f.offset, size, f.endian);
  if (f.mask != null) raw &= num(f.mask);
  if (f.shift) raw >>= f.shift;
  if (f.absentIf != null && raw === num(f.absentIf)) return null;
  let value;
  if (f.map) { value = Object.entries(f.map).find(([k]) => num(k) === raw)?.[1]; if (value === undefined) value = f.default; if (value === undefined) return null; }
  else if (f.type === 'bool') value = raw !== 0;
  else value = raw * (resolve(f.scale, ctx) ?? 1) + (resolve(f.add, ctx) ?? 0);
  return { raw, value };
}

// a color or remap setting's parts (22 Oct 2026, page kinds): [{ key, field, code, label }]; key null = one color
function partsOf(s) {
  if (s.type === 'color') return s.zones ? s.zones.map((z) => ({ key: z.value, field: z.field, code: z.code, label: z.label })) : [{ key: null, field: s.field || s.key, label: s.label }];
  if (s.type === 'remap') return s.buttons.map((b) => ({ key: b.value, field: b.field, code: b.code, label: b.label }));
  return null;
}
const toHex = (b) => `#${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const fromHex = (t) => [1, 3, 5].map((i) => parseInt(t.slice(i, i + 2), 16));
// a setting's value from decoded fields: a color as '#rrggbb' (or { zone: '#rrggbb' } with every zone), a remap as
// { button: target } for the buttons the device reported, anything else its field's value
function valueOf(s, values) {
  const parts = partsOf(s);
  if (!parts) return values[s.field || s.key];
  const conv = (v) => (s.type === 'color' ? (Array.isArray(v) && v.length === 3 ? toHex(v) : undefined) : v);
  if (parts[0].key == null) { const v = values[parts[0].field]; return v === undefined ? undefined : conv(v); }
  const out = {};
  for (const p of parts) { const v = values[p.field] === undefined ? undefined : conv(values[p.field]); if (v !== undefined) out[p.key] = v; }
  if (s.type === 'color' && Object.keys(out).length !== parts.length) return undefined;
  return Object.keys(out).length ? out : undefined;
}

// a setting's value -> the number its {value} placeholder sends (explicit encode.map, else the inverse of its field)
function encodeValue(s, field, v, ctx) {
  const map = s.write?.encode?.map;
  if (map) { const code = map[String(v)]; if (code === undefined) throw new Refused(`${s.label}: ${JSON.stringify(v)} has no code`); return num(code); }
  if (field.map) { const hit = Object.entries(field.map).find(([, x]) => same(x, v)); if (!hit) throw new Refused(`${s.label}: ${JSON.stringify(v)} has no code`); return num(hit[0]); }
  if (field.type === 'bool') return v ? 1 : 0;
  const scale = resolve(field.scale, ctx) ?? 1, add = resolve(field.add, ctx) ?? 0;
  const raw = (v - add) / scale;
  if (!Number.isInteger(raw)) throw new Refused(`${s.label}: ${v} does not land on a whole code`);
  return raw;
}

// is this value one the setting takes? (the same check device.mjs drivers make)
function check(s, v) {
  if (s.type === 'display') throw new Refused(`${s.label} is a reading: it is never written`);
  if (s.type === 'color') {
    const ok = s.zones ? !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === s.zones.length && s.zones.every((z) => HEX.test(v[z.value] ?? ''))
      : typeof v === 'string' && HEX.test(v);
    if (!ok) throw new Refused(`${s.label} must be ${s.zones ? `a color (#rrggbb) for each of: ${s.zones.map((z) => z.label).join(', ')}` : 'a color written #rrggbb'}`);
  }
  if (s.type === 'remap') {
    const ok = !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
      && Object.entries(v).every(([b, t]) => s.buttons.some((x) => x.value === b) && s.targets.some((x) => same(x.value, t)));
    if (!ok) throw new Refused(`${s.label}: every button must be one of its buttons, and every action one of its listed actions`);
  }
  if (s.type === 'toggle' && typeof v !== 'boolean') throw new Refused(`${s.label} must be on or off`);
  if (s.type === 'choice' && !s.options.some((o) => same(o.value, v))) throw new Refused(`"${v}" is not a choice for ${s.label}`);
  if (s.type === 'slider') {
    const step = s.step || 1;
    if (!(Number.isInteger(v) && v >= s.min && v <= s.max && (v - s.min) % step === 0)) throw new Refused(`${s.label} must be ${s.min}-${s.max} in steps of ${step}`);
  }
}

// ---------------------------------------------------------------- validate
const KNOWN = {
  top: ['format', 'id', 'title', 'kind', 'vendor', 'about', 'source', 'note', 'vid', 'pids', 'hid', 'transport', 'links', 'models', 'replies', 'messages', 'reads', 'fields', 'settings', 'battery', 'info', 'stepBack', 'unsupported', 'never', 'byPid'],
  notice: ['reportId', 'starts', 'len', 'note'],
  byPid: ['transport', 'replies', 'messages', 'fields', 'notices', 'encode', 'note'],
  transport: ['report', 'len', 'reportId', 'usagePage', 'timeoutMs', 'tries', 'waitMs', 'checksum', 'note'],
  link: ['label', 'reportId', 'wireless', 'usagePage', 'pids', 'identify', 'probes', 'note'],
  model: ['key', 'name', 'pids', 'paired', 'vars', 'note'],
  replies: ['echo', 'error', 'ok', 'checksum', 'note'],
  message: ['bytes', 'reportId', 'note'],
  read: ['name', 'message', 'notice', 'when', 'onError', 'onDemand', 'asleepIf', 'note'],
  field: ['from', 'offset', 'size', 'endian', 'type', 'mask', 'shift', 'absentIf', 'map', 'default', 'scale', 'add', 'when', 'note'],
  setting: ['key', 'label', 'type', 'min', 'max', 'step', 'unit', 'options', 'zones', 'buttons', 'targets', 'hint', 'live', 'selfCheck', 'when', 'field', 'lockGroup', 'write', 'note'],
  part: ['value', 'label', 'field', 'code', 'note'],
  target: ['value', 'label', 'note'],
  write: ['message', 'needs', 'then', 'keep', 'encode', 'note'],
  battery: ['from', 'percent', 'charging', 'when', 'awake', 'note'],
};

export function validate(obj) {
  const problems = [];
  const no = (text) => problems.push(text);
  const unknown = (o, kind, where) => { for (const k of Object.keys(o)) if (!KNOWN[kind].includes(k)) no(`${where} has "${k}", which this format does not know; DeviceHub refuses parts it would not read (they could hide bytes)`); };
  if (!isObj(obj)) return { ok: false, problems: ['the file is not a JSON object'] };
  unknown(obj, 'top', 'the file');
  if (obj.format !== FORMAT) no(`"format" must be ${FORMAT} (the version of docs/DRIVER-FORMAT.md this file follows)`);
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(obj.id || '')) no('"id" must be 2-31 characters: a-z, 0-9 and -');
  else if (BUILT_IN.includes(obj.id)) no(`the id "${obj.id}" is a built-in device's`);
  for (const k of ['title', 'kind']) if (typeof obj[k] !== 'string' || !obj[k].trim()) no(`it needs a "${k}"`);
  if (!hex4(obj.vid)) no('"vid" must be the USB vendor id as 4 hex digits');
  if (!Array.isArray(obj.pids) || !obj.pids.length || !obj.pids.every(hex4)) no('"pids" must list every USB product id it answers on, 4 hex digits each');
  const pids = (obj.pids || []).filter(hex4).map(up4);

  // whole vendors the format cannot make safe
  const never = builtInNever();
  for (const v of never.refuseVendors || []) if (hex4(obj.vid) && up4(obj.vid) === up4(v.vid)) no(`${v.brand} devices (vendor ${up4(v.vid)}) cannot be a driver.json: ${v.why}`);

  // transport
  const t = obj.transport;
  let len = 64;
  if (!isObj(t)) no('it needs "transport": how messages go out (report, len, reportId)');
  else {
    unknown(t, 'transport', '"transport"');
    if (!['output', 'feature'].includes(t.report)) no('transport.report must be "output" or "feature"');
    if (!(Number.isInteger(t.len) && t.len >= 1 && t.len <= 1024)) no('transport.len must be the report length in data bytes (1-1024)'); else len = t.len;
    if (!(Number.isInteger(t.reportId) && t.reportId >= 0 && t.reportId <= 255)) no('transport.reportId must be 0-255');
    if (t.usagePage != null && !hex4(t.usagePage)) no('transport.usagePage must be 4 hex digits');
    if (t.timeoutMs != null && !(Number.isInteger(t.timeoutMs) && t.timeoutMs >= 50 && t.timeoutMs <= 10000)) no('transport.timeoutMs must be 50-10000');
    if (t.tries != null && !(Number.isInteger(t.tries) && t.tries >= 1 && t.tries <= 5)) no('transport.tries must be 1-5');
    if (t.waitMs != null && !(Number.isInteger(t.waitMs) && t.waitMs >= 0 && t.waitMs <= 2000)) no('transport.waitMs must be 0-2000');
    const c = t.checksum;
    if (c != null) {
      if (!isObj(c) || !CHECKSUMS.includes(c.type)) no(`transport.checksum.type must be one of ${CHECKSUMS.join(', ')} (no other checksum is supported: then a device.mjs is the way)`);
      else if (c.type !== 'none' && !(Number.isInteger(c.from) && Number.isInteger(c.to) && Number.isInteger(c.at) && c.from >= 0 && c.from <= c.to && c.to < len && c.at >= 0 && c.at + (c.type === 'sum16le' ? 1 : 0) < len && (c.at < c.from || c.at > c.to)))
        no('transport.checksum needs from <= to and an "at" outside that range, all inside the report');
    }
  }

  // links and models
  const links = isObj(obj.links) ? obj.links : null;
  if (!links || !Object.keys(links).length) no('it needs "links": at least one way the device is reached (cable, receiver ...)');
  const linkNames = links ? Object.keys(links) : [];
  const receiverPids = new Set();
  for (const [name, l] of Object.entries(links || {})) {
    if (!isObj(l)) { no(`link "${name}" must be an object`); continue; }
    unknown(l, 'link', `link "${name}"`);
    if (typeof l.label !== 'string' || !l.label.trim()) no(`link "${name}" needs a label`);
    if (l.reportId != null && !(Number.isInteger(l.reportId) && l.reportId >= 0 && l.reportId <= 255)) no(`link "${name}": reportId must be 0-255`);
    if (l.usagePage != null && !hex4(l.usagePage)) no(`link "${name}": usagePage must be 4 hex digits or null`);
    if (l.pids != null) {
      if (!Array.isArray(l.pids) || !l.pids.every(hex4)) no(`link "${name}": pids must be 4 hex digits each`);
      else for (const p of l.pids) { receiverPids.add(up4(p)); if (!pids.includes(up4(p))) no(`link "${name}": product id ${up4(p)} is not in "pids"`); }
      if (!isObj(l.identify)) no(`link "${name}" is a receiver (it has pids) and needs "identify": how the device behind it is found`);
    }
  }
  if (!Array.isArray(obj.models) || !obj.models.length) no('it needs "models": at least one');
  const modelPids = new Set();
  for (const [i, m] of (Array.isArray(obj.models) ? obj.models : []).entries()) {
    const w = `model ${i + 1}${m?.name ? ` (${m.name})` : ''}`;
    if (!isObj(m)) { no(`${w} must be an object`); continue; }
    unknown(m, 'model', w);
    if (typeof m.name !== 'string' || !m.name.trim()) no(`${w} needs a name`);
    if (m.vars != null && !isObj(m.vars)) no(`${w}: vars must be an object`);
    for (const part of ['pids', 'paired']) {
      if (m[part] == null) continue;
      if (!isObj(m[part])) { no(`${w}: ${part} must map a link to product ids`); continue; }
      for (const [ln, list] of Object.entries(m[part])) {
        if (!linkNames.includes(ln)) no(`${w}: ${part} names the link "${ln}", which "links" does not have`);
        if (!Array.isArray(list) || !list.every(hex4)) { no(`${w}: ${part}.${ln} must be 4 hex digits each`); continue; }
        if (part === 'pids') for (const p of list) { modelPids.add(up4(p)); if (!pids.includes(up4(p))) no(`${w}: product id ${up4(p)} is not in "pids"`); }
        if (part === 'paired' && !links?.[ln]?.pids) no(`${w}: paired.${ln}: that link is not a receiver (it has no pids)`);
      }
    }
    if (!m.pids && !m.paired) no(`${w} needs pids (or paired ids behind a receiver)`);
  }
  for (const p of pids) if (!modelPids.has(p) && !receiverPids.has(p)) no(`product id ${p} is in "pids" but no model or receiver link has it`);

  // replies (a file whose every read is a notice sends nothing, so it needs no messages and no replies)
  const rp = obj.replies;
  const messages = isObj(obj.messages) ? obj.messages : {};
  const anyMessages = Object.keys(messages).length > 0;
  if (rp == null && !anyMessages) { /* nothing is ever asked */ }
  else if (!isObj(rp)) no('it needs "replies": how a reply is matched to its request');
  else {
    unknown(rp, 'replies', '"replies"');
    if (!Array.isArray(rp.echo) || !rp.echo.length || !rp.echo.every((x) => Number.isInteger(x) && x >= 0 && x < len)) no('replies.echo must list the byte positions a reply repeats from its request (at least one)');
    if (rp.error != null) { try { parseTemplate(rp.error.bytes).forEach((x) => { if (x.name) throw new Error('placeholders are not allowed there'); }); } catch (e) { no(`replies.error.bytes: ${e.message}`); } }
    if (rp.ok != null && !(isObj(rp.ok) && Number.isInteger(rp.ok.offset) && rp.ok.offset < len && /^[0-9A-F]{2}$/i.test(rp.ok.equals || ''))) no('replies.ok must be { offset, equals: "02" }');
  }

  // fields (what replies carry)
  const fields = isObj(obj.fields) ? obj.fields : {};
  if (obj.fields != null && !isObj(obj.fields)) no('"fields" must be an object');
  const reads = Array.isArray(obj.reads) ? obj.reads : [];
  if (!Array.isArray(obj.reads) || !reads.length) no('it needs "reads": at least one read');
  const readByName = {};
  for (const r of reads) {
    if (!isObj(r)) { no('every read must be an object'); continue; }
    unknown(r, 'read', `read "${r.name}"`);
    if (typeof r.name !== 'string' || !r.name) { no('every read needs a name'); continue; }
    if (readByName[r.name]) no(`two reads are called "${r.name}"`);
    readByName[r.name] = r;
    const oe = r.onError;
    const okAct = (x) => ['fail', 'skip'].includes(x);
    if (oe != null && !(okAct(oe) || (isObj(oe) && okAct(oe.wireless) && okAct(oe.wired)))) no(`read "${r.name}": onError must be "fail", "skip" or { wireless, wired }`);
    // a notice (22 Oct 2026, the learning wizard's readings): an input report the device sends by itself, heard, never asked
    if (r.notice != null) {
      const n = r.notice;
      if (r.message != null) no(`read "${r.name}" has both "message" and "notice": a read is either asked (message) or heard (notice)`);
      if (!isObj(n)) { no(`read "${r.name}": notice must be { starts, reportId?, len? }`); continue; }
      unknown(n, 'notice', `read "${r.name}" notice`);
      try {
        const st = parseTemplate(n.starts);
        if (st.some((x) => x.name)) no(`read "${r.name}": notice.starts is the bytes the report starts with, so it cannot hold placeholders`);
        else if (st.length > 8) no(`read "${r.name}": notice.starts is at most 8 bytes`);
      } catch (e) { no(`read "${r.name}": notice.starts: ${e.message}`); }
      if (n.reportId != null && !(Number.isInteger(n.reportId) && n.reportId >= 0 && n.reportId <= 255)) no(`read "${r.name}": notice.reportId must be 0-255`);
      if (n.len != null && !(Number.isInteger(n.len) && n.len >= 1 && n.len <= 1024)) no(`read "${r.name}": notice.len must be the report length in data bytes (1-1024)`);
      for (const k of ['onDemand', 'asleepIf', 'onError']) if (r[k] != null) no(`read "${r.name}" is a notice, which is heard when the device sends it, so it cannot have "${k}"`);
    } else if (r.message == null) no(`read "${r.name}" needs a message (what is sent to ask) or a notice (what the device sends by itself)`);
  }
  const lenOf = (rd) => (rd?.notice && Number.isInteger(rd.notice.len) ? rd.notice.len : len);
  for (const [name, f] of Object.entries(fields)) {
    if (!isObj(f)) { no(`field "${name}" must be an object`); continue; }
    unknown(f, 'field', `field "${name}"`);
    if (RESERVED.includes(name)) no(`a field cannot be called "${name}" (reserved)`);
    if (!readByName[f.from]) no(`field "${name}" comes from the read "${f.from}", which "reads" does not have`);
    const size = f.size ?? 1, rl = lenOf(readByName[f.from]);
    if (!(Number.isInteger(f.offset) && f.offset >= 0)) no(`field "${name}" needs an offset (0 = the first data byte after the report id)`);
    else if (f.type === 'bytes' ? !(Number.isInteger(size) && size >= 1 && f.offset + size <= rl) : !([1, 2, 4].includes(size) && f.offset + size <= rl)) no(`field "${name}": size must be 1, 2 or 4 (any length for type "bytes") and fit in the ${rl}-byte reply`);
    if (f.endian != null && !['little', 'big'].includes(f.endian)) no(`field "${name}": endian must be "little" or "big"`);
    if (f.type != null && !['number', 'bool', 'bytes'].includes(f.type)) no(`field "${name}": type must be number, bool or bytes`);
    if (f.map != null && (!isObj(f.map) || !Object.keys(f.map).every((k) => Number.isInteger(num(k))))) no(`field "${name}": map keys must be the codes (numbers) the device sends`);
    if (f.scale != null && !(typeof f.scale === 'string' ? f.scale.startsWith('$') : Number.isFinite(f.scale) && f.scale !== 0)) no(`field "${name}": scale must be a number other than 0`);
  }
  for (const r of reads) if (r?.name && r.asleepIf) for (const k of Object.keys(r.asleepIf)) if (!/^(model|link|probe)\./.test(k) && !fields[k]) no(`read "${r.name}": asleepIf names "${k}", which is not a field`);

  // messages: every byte that can ever be sent
  const asks = reads.some((r) => isObj(r) && r.notice == null);
  if (obj.messages != null && !isObj(obj.messages)) no('"messages" must be an object: the templates of every request it sends');
  else if (asks && !anyMessages) no('it needs "messages": the templates of every request it sends');
  const parsed = {};
  for (const [name, m] of Object.entries(messages)) {
    if (!isObj(m)) { no(`message "${name}" must be an object with "bytes"`); continue; }
    unknown(m, 'message', `message "${name}"`);
    if (m.reportId != null && !(Number.isInteger(m.reportId) && m.reportId >= 0 && m.reportId <= 255)) no(`message "${name}": reportId must be 0-255`);
    let parts;
    try { parts = parseTemplate(m.bytes); } catch (e) { no(`message "${name}": ${e.message}`); continue; }
    parsed[name] = parts;
    let width = 0;
    for (const [i, p] of parts.entries()) {
      if (p.byte != null) { width++; continue; }
      if (p.optional && i !== parts.length - 1) no(`message "${name}": an optional placeholder ({${p.name}?}) may only be the last thing in it`);
      if (p.name === 'value') { if (p.type === 'bytes') no(`message "${name}": {value} cannot be bytes`); width += PLACE[p.type || 'u8']; continue; }
      if (p.name === 'zone' || p.name === 'button') { if (p.type && p.type !== 'u8') no(`message "${name}": {${p.name}} is one byte`); width += 1; continue; }
      if (p.type === 'rgb') no(`message "${name}": only {value:rgb} can be rgb`);
      const f = fields[p.name];
      if (!f) { no(`message "${name}": {${p.name}} is not "value" and not a field, so its bytes would come from nowhere`); continue; }
      if (f.type === 'bytes' ? p.type && p.type !== 'bytes' : p.type === 'bytes') no(`message "${name}": {${p.name}} must match its field's type`);
      width += f.type === 'bytes' ? (f.size ?? 1) : PLACE[p.type || 'u8'];
    }
    if (width > len) no(`message "${name}" is ${width} bytes, longer than the ${len}-byte report`);
    const c = t?.checksum;
    if (c && c.type !== 'none' && Number.isInteger(c.at) && width > c.at) no(`message "${name}" reaches the checksum byte (${c.at})`);
  }
  const msgUse = (name, where, { value = false, give = null } = {}) => {
    if (!messages[name]) { no(`${where} sends the message "${name}", which "messages" does not have; nothing may be sent that is not a template`); return; }
    const hasValue = (parsed[name] || []).some((p) => p.name === 'value');
    if (value && !hasValue) no(`${where}: the message "${name}" has no {value}, so the value would not be sent`);
    if (!value && hasValue) no(`${where}: the message "${name}" has {value}, but nothing gives it one there`);
    for (const k of ['zone', 'button']) {
      const has = (parsed[name] || []).some((p) => p.name === k);
      if (has && give !== k) no(`${where}: the message "${name}" has {${k}}, but nothing gives it one there`);
      if (!has && give === k) no(`${where}: the message "${name}" has no {${k}}, so the ${k} would not be sent`);
    }
  };
  for (const r of reads) if (r?.name && r.notice == null) msgUse(r.message, `read "${r.name}"`);
  // a notice must not start like a request: a reply repeats its request's start, so it could be taken for the notice
  for (const r of reads) {
    if (!isObj(r?.notice)) continue;
    let st; try { st = parseTemplate(r.notice.starts).map((x) => x.byte); } catch { continue; }
    for (const [name, parts] of Object.entries(parsed)) {
      // past its end a message is zero padding; a placeholder could be anything
      if (st.every((b, i) => (!parts[i] ? b === 0 : parts[i].byte == null || parts[i].byte === b))) no(`read "${r.name}": its notice starts ${r.notice.starts}, as the message "${name}" does, so a reply to that message could be taken for the notice`);
    }
  }
  for (const [name, l] of Object.entries(links || {})) {
    if (isObj(l?.identify)) {
      msgUse(l.identify.message, `link "${name}" identify`);
      const li = l.identify.list;
      if (!isObj(li) || !Number.isInteger(li.offset) || !Number.isInteger(li.stride) || li.stride < 1 || ![1, 2, 4].includes(li.size ?? 2)) no(`link "${name}": identify.list needs offset, stride and size (1, 2 or 4)`);
    }
    for (const p of Array.isArray(l?.probes) ? l.probes : []) {
      if (!p?.name || RESERVED.includes(p.name)) no(`link "${name}": every probe needs a name`);
      msgUse(p.message, `link "${name}" probe "${p.name}"`);
      if (!isObj(p.field) || !Number.isInteger(p.field.offset)) no(`link "${name}" probe "${p.name}": field needs an offset`);
    }
  }

  // settings
  const models = Array.isArray(obj.models) ? obj.models.filter(isObj) : [];
  const ctxs = models.map((m) => ({ model: { key: m.key, name: m.name, ...(m.vars || {}) } }));
  const settings = Array.isArray(obj.settings) ? obj.settings : [];
  if (!Array.isArray(obj.settings)) no('it needs "settings": [] (what its page shows; may be empty)');
  const kw = new RegExp(never.keywords || 'firmware|bootloader|dfu|flash|factory|reset', 'i');
  const valueSets = {};   // message -> list of the numbers its {value} can carry
  const codeSets = {};    // message -> { zone: [...], button: [...] }: the codes its {zone} / {button} can carry
  for (const s of settings) {
    if (!isObj(s)) { no('every setting must be an object'); continue; }
    const w = `setting "${s.key}"`;
    unknown(s, 'setting', w);
    if (typeof s.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(s.key) || s.key === '__proto__') { no('every setting needs a key (letters and digits)'); continue; }
    if (typeof s.label !== 'string' || !s.label.trim()) no(`${w} needs a label`);
    if (!TYPES.includes(s.type)) no(`${w}: type must be ${TYPES.join(', ')}`);
    if (kw.test(`${s.key} ${s.label}`)) no(`${w} looks like a firmware, reset, flash or pairing control ("${s.label}"); DeviceHub never offers those`);
    const fname = s.field || s.key;
    // the new kinds (22 Oct 2026): their lists, then the fields they read
    const listOk = (l, kind, what, more) => {
      if (!Array.isArray(l) || !l.length) { no(`${w} needs ${what}: a list of { value, label${more ? ', field, code' : ''} }`); return false; }
      const vals = new Set();
      for (const o of l) {
        if (!isObj(o)) { no(`${w}: every one of its ${what} must be an object`); return false; }
        unknown(o, kind, `${w} ${what}`);
        if (typeof o.value !== 'string' || !o.value || typeof o.label !== 'string' || !o.label.trim()) no(`${w}: every one of its ${what} needs a value (text) and a label`);
        if (vals.has(o.value)) no(`${w}: two of its ${what} have the value "${o.value}"`);
        vals.add(o.value);
        if (more && !(Number.isInteger(o.code) && o.code >= 0 && o.code <= 255)) no(`${w}: ${what} "${o.value}" needs a code (0-255), the byte its {${more}} sends`);
      }
      return true;
    };
    if (s.type === 'color' && s.zones != null) listOk(s.zones, 'part', 'zones', 'zone');
    if (s.type === 'remap') { listOk(s.buttons, 'part', 'buttons', 'button'); listOk(s.targets, 'target', 'targets'); }
    for (const k of ['zones', 'buttons', 'targets']) if (s[k] != null && !(k === 'zones' ? s.type === 'color' : s.type === 'remap')) no(`${w}: only a ${k === 'zones' ? 'color' : 'remap'} has ${k}`);
    const parts = TYPES.includes(s.type) && (s.type !== 'color' || s.zones == null || Array.isArray(s.zones)) && (s.type !== 'remap' || Array.isArray(s.buttons)) ? partsOf(s) : null;
    const fieldNames = parts ? parts.map((p) => p.field) : [fname];
    let f = null;
    for (const fn of fieldNames) {
      const ff = fields[fn];
      if (!ff) { no(`${w} has no field "${fn}" to read it from; every setting is read before it is written`); continue; }
      if (readByName[ff.from]?.onDemand) no(`${w} is read only on demand ("${ff.from}"); a setting must come from a regular read, so it can be read before and after each write`);
      if (readByName[ff.from]?.notice && s.write != null) no(`${w} comes from a notice ("${ff.from}"), which arrives only when the device sends it; a setting that is written must come from a read DeviceHub asks for, so it can be read before and after each write`);
      if (s.type === 'color' && !(ff.type === 'bytes' && (ff.size ?? 1) === 3)) no(`${w}: a color is read from a field of type "bytes" and size 3 (red, green, blue); "${fn}" is not`);
      f ||= ff;
    }
    if (s.type === 'display' && s.write != null) no(`${w} is a display: a reading, which is never written, so it cannot have "write"`);
    if (s.type === 'slider') {
      for (const c of ctxs.length ? ctxs : [{}]) {
        const min = resolve(s.min, c), max = resolve(s.max, c), step = resolve(s.step, c) ?? 1;
        if (!modelTest(s.when, c)) continue;
        if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) { no(`${w} is a slider without a range (min and max${c.model?.name ? ` for ${c.model.name}` : ''}); a numeric setting needs one`); break; }
        if (!(Number.isInteger(step) && step > 0)) { no(`${w}: step must be a whole number above 0`); break; }
      }
    }
    if (s.type === 'choice' && !(Array.isArray(s.options) && s.options.length && s.options.every((o) => isObj(o) && 'value' in o))) no(`${w} is a choice without options`);
    if (s.write == null) continue;
    if (!isObj(s.write)) { no(`${w}: write must be an object`); continue; }
    unknown(s.write, 'write', `${w} write`);
    if (!((s.type === 'color' && s.zones) || s.type === 'remap')) msgUse(s.write.message, `${w} write`, { value: true });
    if (s.write.then != null) msgUse(s.write.then, `${w} write "then"`);
    for (const n of s.write.needs || []) if (!readByName[n]) no(`${w}: needs the read "${n}", which "reads" does not have`); else if (readByName[n].notice) no(`${w}: needs "${n}", a notice, which cannot be asked for`);
    for (const k of s.write.keep || []) if (!fields[k]) no(`${w}: keep names "${k}", which is not a field`);
    // every value the page can send must encode to a code that fits its placeholder
    if (!f || !messages[s.write.message]) continue;
    const slot = (parsed[s.write.message] || []).find((p) => p.name === 'value');
    const vals = (valueSets[s.write.message] ||= []);
    if (s.type === 'color') {
      if (slot && slot.type !== 'rgb') no(`${w}: a color is sent as {value:rgb}`);
      if (s.zones) msgUse(s.write.message, `${w} write`, { value: true, give: 'zone' });
      vals.push(null);   // any color
      if (s.zones) (codeSets[s.write.message] ||= { zone: [], button: [] }).zone.push(...s.zones.map((z) => z.code));
      continue;
    }
    if (slot?.type === 'rgb') no(`${w}: only a color is sent as {value:rgb}`);
    if (s.type === 'remap') {
      msgUse(s.write.message, `${w} write`, { value: true, give: 'button' });
      (codeSets[s.write.message] ||= { zone: [], button: [] }).button.push(...(s.buttons || []).map((b) => b.code));
      for (const b of s.buttons || []) {
        const bf = fields[b.field];
        if (!bf) continue;
        for (const t of s.targets || []) {
          try { const code = encodeValue(s, bf, t.value, {}); putNumber([], code, slot?.type, s.label); vals.push(code); } catch (e) { no(`${w}: ${b.label} -> ${JSON.stringify(t.value)} cannot be sent (${e.message})`); break; }
        }
      }
      continue;
    }
    for (const c of ctxs.length ? ctxs : [{}]) {
      if (!modelTest(s.when, c)) continue;
      let candidates = [];
      if (s.type === 'toggle') candidates = [false, true];
      else if (s.type === 'choice') candidates = (s.options || []).map((o) => o.value);
      else {
        const min = resolve(s.min, c), max = resolve(s.max, c), step = resolve(s.step, c) ?? 1;
        if (!(Number.isFinite(min) && Number.isFinite(max) && step > 0)) continue;
        if ((max - min) / step > 70000) { vals.push(null); candidates = [min, max]; } else for (let v = min; v <= max; v += step) candidates.push(v);
      }
      for (const v of candidates) {
        try { const code = encodeValue(s, f, v, c); putNumber([], code, slot?.type, s.label); vals.push(code); } catch (e) { no(`${w}: ${JSON.stringify(v)} cannot be sent (${e.message})`); break; }
      }
    }
  }

  // battery and info
  if (obj.battery != null) {
    const b = obj.battery;
    if (!isObj(b)) no('"battery" must be an object');
    else {
      unknown(b, 'battery', '"battery"');
      if (!readByName[b.from]) no(`battery comes from the read "${b.from}", which "reads" does not have`);
      for (const k of ['percent', 'charging']) if (b[k] != null && !fields[b[k]]) no(`battery.${k} names "${b[k]}", which is not a field`);
      if (!b.percent) no('battery needs "percent": the field with the level');
      if (b.awake && readByName[b.from]?.notice) no('battery.awake asks the device once, so its "from" must be a read DeviceHub asks for, not a notice');
    }
  }
  const notices = reads.some((r) => isObj(r) && r.notice != null);
  if (notices && isObj(obj.hid) && obj.hid.reply !== 'raw') no('a file with a notice needs hid.reply "raw", so the reports the device sends by itself reach it');
  if (obj.info != null && !(Array.isArray(obj.info) && obj.info.every((x) => isObj(x) && typeof x.label === 'string' && typeof x.field === 'string'))) no('"info" must be a list of { label, field }');
  if (obj.stepBack != null) {
    if (!isObj(obj.stepBack) || !Array.isArray(obj.stepBack.processes)) no('stepBack must be { processes: [patterns] }');
    else for (const p of obj.stepBack.processes) { try { new RegExp(p, 'i'); } catch { no(`stepBack: "${p}" is not a valid pattern`); } }
  }
  if (obj.hid != null && !(isObj(obj.hid) && hex4(obj.hid.vid) && hex4(obj.hid.pid))) no('hid (the channel the agent opens) needs vid and pid, 4 hex digits each');

  // the never lists: its own, then DeviceHub's
  const own = [];
  if (obj.never != null && !Array.isArray(obj.never)) no('"never" must be a list of { bytes, why }');
  for (const n of Array.isArray(obj.never) ? obj.never : []) {
    try { own.push({ ...n, pat: parsePattern(n.bytes), from: 'its own never list' }); } catch (e) { no(`never "${n?.bytes}": ${e.message}`); }
  }
  const vid = hex4(obj.vid) ? up4(obj.vid) : null;
  const pages = new Set([t?.usagePage, ...Object.values(links || {}).map((l) => l?.usagePage)].filter(hex4).map(up4));
  const builtIn = (never.commands || []).filter((c) => c.bytes && (c.vid === '*' || [].concat(c.vid).map(up4).includes(vid))
    && (!c.pids || c.pids.map(up4).some((p) => pids.includes(p))) && (!c.page || pages.has(up4(c.page))))
    .map((c) => ({ ...c, why: `${c.what}; ${c.source}`, pat: parsePattern(c.bytes), from: `DeviceHub's never list (${c.brand})` }));
  const linkIds = new Set([t?.reportId ?? 0, ...Object.values(links || {}).map((l) => l?.reportId).filter((x) => x != null)]);
  for (const [name, parts] of Object.entries(parsed)) {
    const ids = messages[name].reportId != null ? new Set([messages[name].reportId]) : linkIds;
    const slots = expand(parts, fields, valueSets[name], codeSets[name]);
    const cs = t?.checksum && t.checksum.type !== 'none' ? t.checksum : null;
    if (cs) for (let i = cs.at; i <= cs.at + (cs.type === 'sum16le' ? 1 : 0); i++) { while (slots.length < i) slots.push([0]); slots[i] = null; }
    for (const n of [...own, ...builtIn]) {
      if (n.reportId != null && !ids.has(n.reportId)) continue;
      for (let start = 0; start <= (n.within || 0); start++) {
        if (n.pat.every((p, i) => { const s = slots[start + i]; return s === undefined ? nibbleOk(p, 0) : s === null || s.some((b) => nibbleOk(p, b)); })) {
          no(`message "${name}" (${messages[name].bytes}) could send ${n.bytes}${n.reportId != null ? ` on report ${n.reportId}` : ''}, which is on ${n.from}: ${n.why || 'never send'}`);
          break;
        }
      }
    }
  }

  // byPid (22 Oct 2026): another product id of the same device (cable and receiver) whose bytes differ. Each entry only
  // changes what the file already has; the file as it is on that id is then checked in full, never lists included.
  if (obj.byPid != null) {
    if (!isObj(obj.byPid)) no('"byPid" must map a product id to what differs on it');
    else {
      for (const [p, o] of Object.entries(obj.byPid)) {
        const w = `byPid.${p}`;
        if (!hex4(p) || !pids.includes(up4(p))) no(`${w}: ${p} is not one of "pids"`);
        if (!isObj(o)) { no(`${w} must be an object`); continue; }
        unknown(o, 'byPid', w);
        for (const [k, have] of [['messages', messages], ['fields', fields]]) {
          if (o[k] == null) continue;
          if (!isObj(o[k])) { no(`${w}.${k} must be an object`); continue; }
          for (const n of Object.keys(o[k])) if (!have[n]) no(`${w}.${k} has "${n}", which the file's own ${k} does not; byPid only changes what is there`);
        }
        if (o.notices != null) {
          if (!isObj(o.notices)) no(`${w}.notices must map a notice read to its notice`);
          else for (const n of Object.keys(o.notices)) if (!readByName[n]?.notice) no(`${w}.notices has "${n}", which is not a notice read`);
        }
        if (o.encode != null) {
          if (!isObj(o.encode)) no(`${w}.encode must map a setting to { map }`);
          else for (const [k, e] of Object.entries(o.encode)) if (!settings.some((s) => isObj(s) && s.key === k && isObj(s.write)) || !isObj(e) || !isObj(e.map)) no(`${w}.encode.${k} must be { map } for a setting that is written`);
        }
        for (const k of ['transport', 'replies']) if (o[k] != null && !isObj(o[k])) no(`${w}.${k} must be an object`);
      }
      if (!problems.length) for (const p of Object.keys(obj.byPid)) for (const x of validate(forPid(obj, p)).problems) no(`on product id ${up4(p)}: ${x}`);
    }
  }
  return { ok: !problems.length, problems };
}

// the file as it is on one product id: its byPid entry laid over it (transport merged, replies replaced, the named
// messages, fields, notices and encode maps replaced), without byPid. An id with no entry gets the file as it is.
export function forPid(def, pid) {
  const { byPid, ...rest } = def;
  const key = byPid && Object.keys(byPid).find((k) => up4(k) === up4(pid));
  const o = key ? byPid[key] : null;
  if (!o) return rest;
  return {
    ...rest,
    transport: { ...rest.transport, ...(o.transport || {}) },
    replies: o.replies || rest.replies,
    messages: { ...(rest.messages || {}), ...(o.messages || {}) },
    fields: { ...(rest.fields || {}), ...(o.fields || {}) },
    reads: (rest.reads || []).map((r) => (o.notices?.[r.name] ? { ...r, notice: o.notices[r.name] } : r)),
    settings: (rest.settings || []).map((s) => (o.encode?.[s.key] && s.write ? { ...s, write: { ...s.write, encode: o.encode[s.key] } } : s)),
  };
}

// a template's bytes as sets of what each position can be: [number[] | null = any]
function expand(parts, fields, values, codes) {
  const out = [];
  for (const p of parts) {
    if (p.byte != null) { out.push([p.byte]); continue; }
    if (p.name === 'zone' || p.name === 'button') { const c = codes?.[p.name]; out.push(c?.length ? [...new Set(c)] : null); continue; }
    if (p.name === 'value') {
      const size = PLACE[p.type || 'u8'];
      if (!values || !values.length || values.includes(null)) { for (let i = 0; i < size; i++) out.push(null); continue; }
      const per = [];
      for (const v of values) { const b = []; putNumber(b, v, p.type, 'value'); b.forEach((x, i) => (per[i] ||= new Set()).add(x)); }
      per.forEach((s) => out.push([...s]));
      continue;
    }
    const f = fields[p.name];
    const size = f?.type === 'bytes' ? (f.size ?? 1) : PLACE[p.type || 'u8'];
    for (let i = 0; i < size; i++) out.push(null);   // a value read from the device: could be anything
  }
  return out;
}

// ---------------------------------------------------------------- fromJson
export function fromJson(input) {
  let def = input;
  if (typeof input === 'string') {
    try { def = JSON.parse(fs.readFileSync(input, 'utf8')); } catch (e) { throw new Error(`${path.basename(input)} could not be read as JSON: ${e.message}`); }
  }
  const v = validate(def);
  if (!v.ok) throw new Error(`driver.json refused: ${v.problems.join('; ')}`);
  return makeDriver(JSON.parse(JSON.stringify(def)));
}

function makeDriver(base) {
  // the file as it is on the product id in use (byPid, 22 Oct 2026): use(pid) lays that id's entry over it
  let def, t, tmpl, errBytes, echo, okRule, reads, heardBy;
  const use = (pid) => {
    def = forPid(base, pid || base.pids[0]);
    t = def.transport;
    tmpl = Object.fromEntries(Object.entries(def.messages || {}).map(([k, m]) => [k, parseTemplate(m.bytes)]));
    errBytes = def.replies?.error ? parseTemplate(def.replies.error.bytes).map((p) => p.byte) : null;
    echo = def.replies?.echo || [0];
    okRule = def.replies?.ok ? { offset: def.replies.ok.offset, equals: parseInt(def.replies.ok.equals, 16) } : null;
    reads = def.reads.filter((r) => !r.onDemand);
    heardBy = def.reads.filter((r) => r.notice).map((r) => ({ name: r.name, reportId: r.notice.reportId, starts: parseTemplate(r.notice.starts).map((p) => p.byte) }));
  };
  use(null);
  const VID = parseInt(base.vid, 16);
  const isError = (r) => !!errBytes && errBytes.every((b, i) => r[i] === b);
  const matches = (s, r) => isError(r) || echo.every((i) => r[i] === s[i]);
  const linkOfPid = (pid) => Object.entries(def.links).find(([, l]) => (l.pids || []).map(up4).includes(pid))?.[0] || null;
  const stepBack = (def.stepBack?.processes || []).map((p) => new RegExp(p, 'i'));
  const hasNotices = base.reads.some((r) => r.notice) || Object.values(base.byPid || {}).some((o) => o?.notices);
  const u8 = (e) => new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
  const bt = base.transport;   // the derived channel is the file's own (a notice needs the raw channel to be heard)
  const derivedHid = { vid: up4(base.vid), pid: up4(base.pids[0]), ...(bt.usagePage ? { page: up4(bt.usagePage) } : {}), len: bt.len, reportId: bt.reportId, ...(hasNotices ? { reply: 'raw' } : {}) };

  const drv = {
    id: def.id,
    title: def.title,
    kind: def.kind,
    ...(def.vendor ? { vendor: def.vendor } : {}),
    unsupported: [...(def.unsupported || [])],
    declarative: true,
    ...(base.hid ? { hid: { ...base.hid } } : { hid: derivedHid }),

    // the product id in use: its byPid entry (if any) is laid over the file
    usePid(pid) { use(pid ? up4(pid) : null); },

    // a notice (an input report the device sent by itself) is kept, the last one per read, until the next arrives
    heard(reportId, r) {
      for (const n of heardBy) {
        if (n.reportId != null && reportId != null && n.reportId !== reportId) continue;
        if (n.starts.every((b, i) => r[i] === b)) (this.notices ||= {})[n.name] = Uint8Array.from(r);
      }
    },
    // the reports waiting on the raw channel (helpers/hid-host.mjs receiveReports): read once per snapshot
    async drain() {
      if (!heardBy.length || typeof this.dev?.receiveReports !== 'function') return;
      try { for (const e of await this.dev.receiveReports(0)) this.heard(e.reportId, u8(e)); } catch {}
    },

    // the context conditions and $references are read against
    ctx(fields = {}) {
      const m = this.model || def.models[0];
      const ln = this.link || Object.keys(def.links)[0];
      return { ...fields, model: { key: m.key, name: m.name, ...(m.vars || {}) }, link: { name: ln, ...def.links[ln] }, probe: { ...(this.probes || {}) } };
    },

    // the page: for each key, the first variant whose `when` holds, with $references filled in; locked groups left out
    get settings() {
      const c = this.ctx(), seen = new Set(), out = [];
      for (const s of def.settings) {
        if (seen.has(s.key) || !test(s.when, c)) continue;
        seen.add(s.key);
        if (s.lockGroup && this.locked?.has(s.lockGroup)) continue;
        const p = { key: s.key, label: s.label, type: s.type };
        for (const k of ['min', 'max', 'step', 'unit', 'options', 'hint', 'live', 'selfCheck']) if (s[k] !== undefined) p[k] = resolve(s[k], c);
        // zones, buttons and targets as the page sees them (the codes and fields stay in the file)
        for (const k of ['zones', 'buttons', 'targets']) if (s[k]) p[k] = s[k].map((o) => ({ value: o.value, label: o.label }));
        if (!s.write) p.readOnly = true;
        out.push(p);
      }
      return out;
    },
    defOf(key) { const c = this.ctx(); return def.settings.find((s) => s.key === key && test(s.when, c)); },

    // the maker's app running beside it: refuse (two programs writing the device fight)
    async vendorApp() {
      if (!stepBack.length || typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
      const { execFile } = await import('node:child_process');
      const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
      for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (stepBack.some((r) => r.test(name))) return name; }
      return null;
    },
    async stepBackCheck() {
      if (!stepBack.length) return;
      const say = () => new Refused(`${this.app} is running: close it first (two programs writing the device fight)`);
      if (this.appAt && Date.now() - this.appAt < STEP_BACK_MS) { if (this.app) throw say(); return; }
      this.app = await this.vendorApp(); this.appAt = Date.now();
      if (this.app) throw say();
    },

    async connect(prompt = false) {
      Object.assign(this, { dev: null, ch: null, model: null, link: null, probes: {}, pairedId: null, locked: new Set(), snap: null, snapAt: 0, appAt: 0, app: null, q: Promise.resolve(), notices: {} });
      const filters = def.pids.map(up4).map((p) => {
        const ln = linkOfPid(p) || Object.keys(def.links).find((k) => def.models.some((m) => (m.pids?.[k] || []).map(up4).includes(p)));
        const l = def.links[ln] || {};
        const page = l.usagePage === undefined ? forPid(base, p).transport.usagePage : l.usagePage;
        return page ? { vendorId: VID, productId: parseInt(p, 16), usagePage: parseInt(page, 16) } : { vendorId: VID, productId: parseInt(p, 16) };
      });
      const dev = await getDevice(filters, { prompt });
      if (!dev) return false;
      await this.stepBackCheck();
      if (!dev.opened) await dev.open();
      this.dev = dev;
      const pid = up4(dev.productId.toString(16));
      use(pid);
      // a report that answers nothing may be a notice; in a browser (no raw channel) every input report is looked at
      const match = heardBy.length ? (s, r) => { if (matches(s, r)) return true; this.heard(null, r); return false; } : matches;
      if (t.report === 'output') this.ch = new HidChannel(dev, { reportId: t.reportId, length: t.len, match });
      if (heardBy.length && typeof dev.receiveReports !== 'function') dev.addEventListener('inputreport', (e) => this.heard(e.reportId, u8(e)));
      const receiver = linkOfPid(pid);
      if (receiver) {
        const l = def.links[receiver];
        this.link = receiver;
        const r = await this.ask(l.identify.message);
        if (r.error) throw new Error(l.identify.refused || `the ${l.label} refused its identify read`);
        const li = l.identify.list, size = li.size ?? 2, ids = [];
        for (let at = li.offset; at + size <= r.bytes.length; at += li.stride) { const id = readNumber(r.bytes, at, size, li.endian); if (id === (li.stopAt ?? 0)) break; ids.push(id); }
        const hex4s = ids.map((i) => up4(i.toString(16)));
        this.model = def.models.find((m) => (m.paired?.[receiver] || []).some((p) => hex4s.includes(up4(p))));
        if (!this.model) { this.link = null; throw new Error(`no device this driver knows is paired to the ${l.label} (paired ids: ${hex4s.map((x) => x.toLowerCase()).join(', ') || 'none'})`); }
        this.pairedId = hex4s.find((x) => this.model.paired[receiver].map(up4).includes(x));
      } else {
        for (const m of def.models) for (const [ln, list] of Object.entries(m.pids || {})) if (!this.model && list.map(up4).includes(pid)) { this.model = m; this.link = ln; }
        if (!this.model) return false;
      }
      for (const p of def.links[this.link].probes || []) {
        const r = await this.ask(p.message);
        this.probes[p.name] = r.error ? null : decodeField(p.field, r.bytes, this.ctx())?.value ?? null;
      }
      return true;
    },

    // one message, built from its template (the ONLY way bytes leave this driver): { reportId, data }
    build(name, vars = {}) {
      const out = [];
      for (const p of tmpl[name]) {
        if (p.byte != null) { out.push(p.byte); continue; }
        if (p.name === 'value' && p.type === 'rgb') {
          if (!(Array.isArray(vars.value) && vars.value.length === 3 && vars.value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255))) throw new Refused('a color must be three bytes');
          out.push(...vars.value); continue;
        }
        if (p.name === 'value') { putNumber(out, vars.value, p.type, 'the value'); continue; }
        if (p.name === 'zone' || p.name === 'button') { putNumber(out, vars[p.name], 'u8', `the ${p.name}`); continue; }
        const raw = vars.raw?.[p.name];
        if (raw === undefined || raw === null) { if (p.optional) continue; throw new Refused(`${p.name} was not read, so "${name}" cannot be built`); }
        if (Array.isArray(raw)) out.push(...raw); else putNumber(out, raw, p.type, p.name);
      }
      const data = new Uint8Array(t.len);
      data.set(out.slice(0, t.len));
      checksum(data, t.checksum);
      const m = def.messages[name];
      return { reportId: m.reportId ?? def.links[this.link]?.reportId ?? t.reportId, data };
    },

    // one request with its reply: { bytes, error }; `tries` tries on silence
    async ask(name, vars) {
      if (!this.dev) throw Object.assign(new Error(`the ${def.title} is not connected`), { gone: true });
      const msg = this.build(name, vars);
      let last;
      for (let i = 0; i < (t.tries || 1); i++) {
        try { return this.judge(await this.exchange(msg)); } catch (e) { last = e; if (e.gone) throw e; }
      }
      throw last;
    },
    judge(r) {
      const error = isError(r) || (okRule && r[okRule.offset] !== okRule.equals) || (def.replies?.checksum && !checksumOk(r, t.checksum));
      return { bytes: r, error: !!error };
    },
    exchange({ reportId, data }) {
      if (this.ch) return this.ch.request(data, { reportId, timeoutMs: t.timeoutMs || 1000 });
      // feature reports: set, wait, get (one at a time)
      const run = async () => {
        await this.dev.sendFeatureReport(reportId, data);
        if (t.waitMs) await new Promise((r) => setTimeout(r, t.waitMs));
        const dv = await this.dev.receiveFeatureReport(reportId, t.len);
        let r = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        if (reportId) r = r.slice(1);
        if (!matches(data, r)) throw new Error(`no matching reply to ${hex(data.slice(0, 4))}`);
        return new Uint8Array(r);
      };
      const p = this.q.then(run, run); this.q = p.catch(() => {}); return p;
    },
    wireless() { return !!def.links[this.link]?.wireless; },
    failed(what) { return new Error(this.wireless() ? `the ${def.kind.toLowerCase()} is asleep or out of range (no answer to ${what}): wake it and try again` : `the ${def.kind.toLowerCase()} refused ${what}`); },

    // every regular read, in order (reused for 1 s unless fresh)
    async snapshot(fresh) {
      if (!fresh && this.snap && Date.now() - this.snapAt < SNAP_MS) return this.snap;
      await this.stepBackCheck();
      const replies = {};
      let drained = false;
      for (const rd of reads) {
        if (!test(rd.when, this.ctx())) continue;
        // a notice: the last one the device sent (none yet = not known yet; nothing is ever sent for it)
        if (rd.notice) { if (!drained) { await this.drain(); drained = true; } replies[rd.name] = this.notices?.[rd.name] || null; continue; }
        const r = await this.ask(rd.message);
        if (r.error) {
          const act = isObj(rd.onError) ? rd.onError[this.wireless() ? 'wireless' : 'wired'] : rd.onError || 'fail';
          if (act === 'skip') { replies[rd.name] = null; continue; }
          throw this.failed(`the ${rd.name} read`);
        }
        replies[rd.name] = r.bytes;
        if (rd.asleepIf && test(rd.asleepIf, this.ctx(this.fieldsOf({ [rd.name]: r.bytes }).values))) throw new Error(`the ${def.kind.toLowerCase()} is asleep or out of range: wake it and try again`);
      }
      this.snap = replies; this.snapAt = Date.now();
      return replies;
    },
    // replies -> { values, raw } for every field whose reply is there (in file order, so a field's `when` can use earlier ones)
    fieldsOf(replies) {
      const values = {}, raw = {};
      for (const [name, f] of Object.entries(def.fields)) {
        const r = replies[f.from];
        if (!r) continue;
        const c = this.ctx(values);
        if (!test(f.when, c)) continue;
        const d = decodeField(f, r, c);
        if (d) { values[name] = d.value; raw[name] = d.raw; }
      }
      // a slider read outside its own range locks its group (the range is then wrong for this device)
      const c = this.ctx(values);
      for (const s of def.settings) {
        if (!s.lockGroup || s.type !== 'slider' || !test(s.when, c)) continue;
        const v = values[s.field || s.key];
        if (typeof v === 'number' && (v < resolve(s.min, c) || v > resolve(s.max, c))) this.locked.add(s.lockGroup);
      }
      return { values, raw };
    },
    async extra(names = []) {
      const replies = {};
      for (const n of names) { const rd = def.reads.find((r) => r.name === n); const r = await this.ask(rd.message); replies[n] = r.error ? null : r.bytes; }
      return replies;
    },

    async info() {
      const { values } = this.fieldsOf(await this.snapshot(true));
      const c = this.ctx(values);
      const out = { Model: this.model.name, Connection: def.links[this.link].label, 'Product id': `${up4(def.vid)}:${up4(this.dev.productId.toString(16))}${this.pairedId ? ` (paired ${this.pairedId})` : ''}` };
      for (const i of def.info || []) {
        if (!test(i.when, c)) continue;
        const v = get(c, i.field);
        const shown = i.map ? i.map[String(v ?? null)] : v;
        if (shown === undefined) continue;
        out[i.label] = i.text ? i.text.replace('{value}', String(shown)) : shown;
      }
      return out;
    },

    async read() {
      const { values } = this.fieldsOf(await this.snapshot());
      const out = {};
      for (const s of this.settings) { const v = valueOf(this.defOf(s.key), values); if (v !== undefined) out[s.key] = v; }
      return out;
    },

    async battery() {
      const b = def.battery;
      if (!b || !this.dev || !test(b.when, this.ctx())) return null;
      const snap = await this.snapshot();
      if (!snap[b.from]) return null;
      const { values } = this.fieldsOf(snap);
      return values[b.percent] === undefined ? null : { percent: values[b.percent], charging: !!values[b.charging] };
    },

    // one quick question for an asleep wireless device (only when the file says battery.awake)
    async awake() {
      const b = def.battery;
      if (!b?.awake || !test(b.when, this.ctx()) || !this.wireless()) return true;
      const rd = def.reads.find((r) => r.name === b.from);
      try {
        const r = await this.ask(rd.message);
        return !r.error && !(rd.asleepIf && test(rd.asleepIf, this.ctx(this.fieldsOf({ [rd.name]: r.bytes }).values)));
      } catch { return false; }
    },

    async rawBackup() {
      const snap = await this.snapshot(true);
      const more = await this.extra(def.reads.filter((r) => r.onDemand).map((r) => r.name));
      const replies = Object.fromEntries(Object.entries({ ...snap, ...more }).map(([k, v]) => [k, v && hex(v)]));
      return { driver: def.id, model: this.model?.key || this.model?.name, link: this.link, productId: this.dev?.productId, pairedId: this.pairedId, probes: { ...this.probes }, replies };
    },

    // a color or a remap (22 Oct 2026, page kinds): ONE setting, checked before anything is sent; a message for each
    // zone or button whose value changes (each of them, with its own value, when none changes: the self-check's
    // same-value write), read back as a whole; on a mismatch the values read before are written again
    async writeParts(s, value) {
      await this.stepBackCheck();
      const parts = partsOf(s);
      const before = this.fieldsOf(await this.snapshot(true));
      const was = valueOf(s, before.values);
      if (was === undefined) throw new Refused(`this device does not report ${s.label}`);
      const single = parts[0].key == null;
      // the value in the device's own order (a remap: only the buttons it reported)
      const want = single ? value : Object.fromEntries(parts.filter((p) => p.key in was).map((p) => [p.key, p.key in value ? value[p.key] : was[p.key]]));
      if (!single && Object.keys(value).some((k) => !(k in was))) throw new Refused(`this device does not report ${s.label} for ${Object.keys(value).filter((k) => !(k in was)).join(', ')}`);
      const of = (v, p) => (single ? v : v[p.key]);
      let todo = parts.filter((p) => (single || p.key in was) && !same(of(want, p), of(was, p)));
      if (!todo.length) todo = parts.filter((p) => single || p.key in was);
      const send = async (v, p) => {
        const more = this.fieldsOf(await this.extra(s.write.needs));
        const code = s.type === 'color' ? fromHex(v) : encodeValue(s, def.fields[p.field], v, this.ctx(before.values));
        const r = await this.ask(s.write.message, { value: code, zone: p.code, button: p.code, raw: { ...before.raw, ...more.raw } });
        if (r.error) throw this.failed(`${s.label}${p.key == null ? '' : ` (${p.label})`}`);
      };
      const sent = [];
      let failed = null;
      for (const p of todo) { try { await send(of(want, p), p); sent.push(p); } catch (e) { failed = e; break; } }
      const back = this.fieldsOf(await this.snapshot(true));
      const got = valueOf(s, back.values);
      const kept = (s.write.keep || []).every((k) => same(back.values[k], before.values[k]));
      if (failed || !same(got, want) || !kept) {
        for (const p of sent.reverse()) { try { await send(of(was, p), p); } catch {} }
        this.snap = null;
        if (failed) throw failed;
        throw new Error(`the device reads ${s.label} = ${JSON.stringify(got)} after writing ${JSON.stringify(want)}${kept ? '' : ' (and something else moved)'}; the values read before were written back, nothing saved`);
      }
      if (s.write.then) {
        const r = await this.ask(s.write.then);
        if (r.error) throw new Error(`${s.label} is set but the device refused "${s.write.then}": it may not last`);
      }
      return got;
    },

    // ONE setting: checked before anything is sent, read, written, read back; on a mismatch the value read before is
    // written again and nothing more is sent; on a match the write's `then` message (a save) follows.
    async write(key, value) {
      const pub = this.settings.find((x) => x.key === key);
      if (!pub) throw new Refused(`${key} is not a setting this device can change`);
      const s = this.defOf(key);
      if (!s.write) throw new Refused(`${s.label} is read only`);
      check(pub, value);
      if (partsOf(s)) return this.writeParts(s, value);
      await this.stepBackCheck();
      const field = def.fields[s.field || key];
      const before = this.fieldsOf(await this.snapshot(true));
      if (before.values[s.field || key] === undefined) throw new Refused(`this device does not report ${s.label}`);
      if (s.lockGroup && this.locked.has(s.lockGroup)) throw new Refused(`${s.label} read outside its range, so it is read only`);
      const send = async (v) => {
        const more = this.fieldsOf(await this.extra(s.write.needs));
        const r = await this.ask(s.write.message, { value: encodeValue(s, field, v, this.ctx(before.values)), raw: { ...before.raw, ...more.raw } });
        if (r.error) throw this.failed(s.label);
      };
      await send(value);
      const back = this.fieldsOf(await this.snapshot(true));
      const got = back.values[s.field || key], was = before.values[s.field || key];
      const kept = (s.write.keep || []).every((k) => same(back.values[k], before.values[k]));
      if (!same(got, value) || !kept) {
        try { await send(was); this.snap = null; } catch {}
        throw new Error(`the device reads ${s.label} = ${got} after writing ${value}${kept ? '' : ' (and something else moved)'}; ${was} was written back, nothing saved`);
      }
      if (s.write.then) {
        const r = await this.ask(s.write.then);
        if (r.error) throw new Error(`${s.label} is set but the device refused "${s.write.then}": it may not last`);
      }
      return got;
    },
  };
  return drv;
}
