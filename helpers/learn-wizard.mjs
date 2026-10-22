// The learning wizard (22 Oct 2026; docs/handoff/learn-wizard.md): someone with a device DeviceHub does not run gets a
// working driver.json (docs/DRIVER-FORMAT.md) without Claude. The owner: "build it out more so someone doesnt need
// claude to remake the apps necessary to control all features of a device they own".
//
// The steps, ALL READ-ONLY toward the device (nothing here opens it or sends it a byte):
//   a. pick the device: every present HID device DeviceHub does not run (helpers/learn-hid-list.ps1, access 0 only)
//   b. capture: USBPcap records while the person changes ONE setting in the maker's app, once per value
//      (helpers/learn-capture.ps1, started once per session through Windows' admin prompt)
//   c. diff: the output / feature report whose bytes moved with the value, the bytes that encode it (8/16/32-bit,
//      little or big endian, raw * scale + add with common scales, or a code per value), and the regular read whose
//      reply carries it (a setting with no read cannot be written: validate() refuses it)
//   d. driver.json: built from those messages, checked by declarative-driver validate(), and proven to rebuild every
//      captured message byte for byte (a template that would send anything not seen in the recording is refused)
//   e. save: my-devices\<name>\driver.json with a library.json marker "read-only": helpers/my-devices.mjs loads it
//      GUARDED, so no setting is written until it passes DeviceHub's self-check (read, write the same value, read back)
//
// The analysis (analyze, buildDriver, verifySeen, hidMessages) is pure and tested with made-up recordings:
// tests/learn-wizard.mjs. The route: handle(url, req, res, send, readBody) for /api/learn/*.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readPcapBuffer } from './pcap-read.mjs';
import { validate, fromJson } from './declarative-driver.mjs';
import { ROOT, devicehubVersion, match as libraryMatch } from './device-library.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- small parts
export const hexOf = (a) => Array.from(a || []).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const keyOf = (m) => `${m.type}:${m.reportId}:${hexOf(m.data)}`;
const up4 = (s) => String(s ?? '').trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-6;
const sameShape = (a, b) => a.type === b.type && a.reportId === b.reportId && a.data.length === b.data.length;
const diffCount = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) n++; return n; };
const lastOf = (list) => list[list.length - 1] || null;
function readNum(d, o, size, endian) { let v = 0; for (let i = 0; i < size; i++) v += (d[o + i] ?? 0) * 2 ** (8 * (endian === 'big' ? size - 1 - i : i)); return v; }
const show = (v) => (typeof v === 'string' ? `"${v}"` : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

export const MAX_DIFF = 8;        // a write differs from the same write with another value in at most this many bytes
export const PAIR_S = 1.0;        // a reply comes within this many seconds of its request
export const SCALES = [1, 2, 4, 5, 8, 10, 16, 20, 25, 50, 100, 125, 250, 0.5, 0.1];

// ---------------------------------------------------------------- a. recordings -> HID messages
// The device's USB address in a recording, from the device descriptors USBPcap injects (or that Windows read when it was
// plugged in): Map 'bus:device' -> { vid, pid }
export function deviceDescriptors(recs) {
  const out = new Map();
  for (const r of recs) {
    if (r.transfer !== 2) continue;
    let d = null;
    if (r.in && r.data.length >= 18 && r.data[0] === 18 && r.data[1] === 1) d = r.data;
    else if (r.data.length >= 26 && r.data[0] === 0x80 && r.data[1] === 6 && r.data[8] === 18 && r.data[9] === 1) d = r.data.slice(8);
    if (d) out.set(`${r.bus}:${r.device}`, { vid: up4((d[8] | (d[9] << 8)).toString(16)), pid: up4((d[10] | (d[11] << 8)).toString(16)) });
  }
  return out;
}

// HID reports out of USBPcap records: [{ ts, dir: 'out' | 'in', type: 'output' | 'feature' | 'input', reportId, data }]
// (data without the report id). Interrupt OUT = output reports, interrupt IN = input reports, control SET_REPORT /
// GET_REPORT = output, feature (and input) reports. at: Set of 'bus:device' to keep (null = all). idsOut / idsIn: the
// interrupt reports carry a report id in their first byte (the device's collections declare report ids).
export function hidMessages(recs, { at = null, idsOut = false, idsIn = false } = {}) {
  const out = [], pending = new Map();
  const strip = (id, d) => (id && d[0] === id ? d.slice(1) : d);
  for (const r of recs) {
    if (at && !at.has(`${r.bus}:${r.device}`)) continue;
    const irp = String(r.irp);
    if (r.transfer === 1) {
      if (!r.data.length) continue;
      const inEp = (r.endpoint & 0x80) !== 0;
      if (!inEp && !r.in) out.push({ ts: r.ts, dir: 'out', type: 'output', reportId: idsOut ? r.data[0] : 0, data: idsOut ? r.data.slice(1) : [...r.data] });
      else if (inEp && r.in) out.push({ ts: r.ts, dir: 'in', type: 'input', reportId: idsIn ? r.data[0] : 0, data: idsIn ? r.data.slice(1) : [...r.data] });
      continue;
    }
    if (r.transfer !== 2) continue;
    const setup = r.stage === 0 || (r.stage == null && !r.in && r.data.length >= 8 && !pending.has(irp));
    if (setup && !r.in && r.data.length >= 8) {
      const [bm, req, wl, wh] = r.data;
      if (bm === 0x21 && req === 0x09 && (wh === 2 || wh === 3)) {
        const p = { ts: r.ts, dir: 'out', type: wh === 3 ? 'feature' : 'output', reportId: wl };
        if (r.data.length > 8) out.push({ ...p, data: strip(wl, r.data.slice(8)) }); else pending.set(irp, p);
      } else if (bm === 0xa1 && req === 0x01 && (wh === 1 || wh === 3)) pending.set(irp, { dir: 'in', type: wh === 3 ? 'feature' : 'input', reportId: wl });
      continue;
    }
    const p = pending.get(irp);
    if (!p || !r.data.length) continue;
    if ((p.dir === 'out' && !r.in) || (p.dir === 'in' && r.in)) {
      pending.delete(irp);
      out.push({ ...p, ts: p.dir === 'in' ? r.ts : p.ts, data: strip(p.reportId, r.data) });
    }
  }
  return out;
}

// every recording file of one take -> the messages of the device with this vid:pid, in time order
export function takeMessages(buffers, { vid, pid, idsOut = false, idsIn = false }) {
  const all = [];
  let found = false;
  for (const b of buffers) {
    let recs;
    try { recs = readPcapBuffer(b); } catch { continue; }
    const at = new Set([...deviceDescriptors(recs)].filter(([, d]) => d.vid === up4(vid) && d.pid === up4(pid)).map(([k]) => k));
    if (!at.size) continue;
    found = true;
    all.push(...hidMessages(recs, { at, idsOut, idsIn }));
  }
  all.sort((a, b) => a.ts - b.ts);
  return { found, messages: all };
}

// ---------------------------------------------------------------- c. the diff
function sumOf(d, type, from, to) { let s = 0; for (let i = from; i <= to; i++) s = type === 'xor' ? s ^ (d[i] ?? 0) : s + (d[i] ?? 0); return s; }
function csHolds(d, c) { const s = sumOf(d, c.type, c.from, c.to); return c.type === 'sum16le' ? d[c.at] === (s & 255) && d[c.at + 1] === ((s >> 8) & 255) : d[c.at] === (s & 255); }
const csPositions = (c) => (!c ? [] : c.type === 'sum16le' ? [c.at, c.at + 1] : [c.at]);

// a checksum over the bytes before a moving byte, holding on EVERY outgoing message of that report (a transport
// checksum covers every message the driver sends, so it must hold on the reads too)
function findChecksum(D, sameReport) {
  const len = sameReport[0].data.length;
  for (const at of D) for (const type of ['xor', 'sum8', 'sum16le']) for (let from = 0; from <= Math.min(3, at - 1); from++) {
    const c = { type, from, to: at - 1, at };
    if (type === 'sum16le' && at + 1 >= len) continue;
    if (sameReport.every((m) => csHolds(m.data, c))) return c;
  }
  return null;
}

// how the value sits in these bytes (each message holds values[i]); best first
function explainNumber(msgs, values, R, cs, len) {
  if (!R.length) return [];
  const lo = Math.min(...R), hi = Math.max(...R), out = [];
  for (const size of [1, 2, 4]) {
    if (hi - lo + 1 > size) continue;
    for (let o = hi - size + 1; o <= lo; o++) {
      if (o < 0 || o + size > len) continue;
      if (cs && csPositions(cs).some((p) => p >= o && p < o + size)) continue;
      for (const endian of size === 1 ? ['little'] : ['little', 'big']) {
        const raws = msgs.map((m) => readNum(m.data, o, size, endian));
        if (new Set(raws).size !== raws.length) continue;
        SCALES.forEach((s, si) => [0, s, -s].forEach((add, ai) => {
          if (raws.every((r, i) => near(r * s + add, values[i]))) out.push({ offset: o, size, endian, scale: s, add, rank: [size, si, ai] });
        }));
      }
    }
  }
  return out.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
}
// a choice or on/off: one byte, one code per value
function explainMap(msgs, values, R) {
  if (R.length !== 1) return [];
  const p = R[0], codes = msgs.map((m) => m.data[p]);
  if (new Set(codes).size !== codes.length) return [];
  return [{ offset: p, size: 1, codes, rank: [1, 0, 0] }];
}
const tie = (a, b) => same(a.rank, b.rank);
const where = (e) => (e.size === 1 ? `byte ${e.offset}` : `bytes ${e.offset}-${e.offset + e.size - 1} (${e.endian === 'big' ? 'big' : 'little'}-endian)`);
const howScaled = (e) => (e.scale == null ? '' : `${e.scale !== 1 ? ` x ${e.scale}` : ''}${e.add ? ` ${e.add > 0 ? '+' : '-'} ${Math.abs(e.add)}` : ''}`);
const refuse = (why, extra = {}) => ({ ok: false, why: [].concat(why), ...extra });

// takes: [{ value, messages }]; setting: { label, kind: 'number' | 'toggle' | 'choice' }.
// { ok: true, learned } or { ok: false, why: [sentences], ambiguous?, needMore? }
export function analyze(takes, setting) {
  const label = setting?.label || 'the setting';
  const kind = setting?.kind || 'number';
  if (!Array.isArray(takes) || takes.length < 2) return refuse('Record at least two values first.');
  const values = takes.map((t) => t.value);
  if (new Set(values.map((v) => JSON.stringify(v))).size !== values.length) return refuse('Each recording needs a different value.');
  if (kind === 'number' && !values.every((v) => typeof v === 'number' && Number.isFinite(v))) return refuse('Every value must be a number.');
  const outs = takes.map((t) => t.messages.filter((m) => m.dir === 'out'));
  if (outs.some((o) => !o.length)) return refuse(`In recording ${outs.findIndex((o) => !o.length) + 1} the maker's app sent the device nothing. Change the setting in the app while DeviceHub listens, then record that value again.`);
  const everywhere = new Set(outs.map((o) => new Set(o.map(keyOf))).reduce((a, b) => [...a].filter((k) => b.has(k))));
  const changed = outs.map((o) => o.filter((m) => !everywhere.has(keyOf(m))));
  if (changed.some((c) => !c.length)) return refuse(`The maker's app sent exactly the same messages for ${values.map(show).join(' and ')}, so nothing in them carries ${label}. Check the app really changed it, then record again.`);

  // the candidate writes: one message per recording, the same report, differing in a few bytes (the last of each in a
  // recording, so a slider dragged through other values on the way counts with its final value)
  const fams = [], seen = new Set();
  for (const m0 of changed[0]) {
    const group = [];
    for (const c of changed) {
      // the same command: the same report, the same first byte, and only a few bytes apart
      const pick = lastOf(c.filter((x) => sameShape(x, m0) && x.data[0] === m0.data[0] && diffCount(x, m0) <= MAX_DIFF));
      if (!pick) { group.length = 0; break; }
      group.push(pick);
    }
    if (!group.length) continue;
    const sig = group.map(keyOf).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const len = m0.data.length, D = [];
    for (let i = 0; i < len; i++) if (group.some((m) => m.data[i] !== group[0].data[i])) D.push(i);
    if (D.length && D.length <= MAX_DIFF) fams.push({ group, D, len });
  }
  if (!fams.length) return refuse(`No message changed in step with ${label}: the app's messages for each value are too different to compare. Record again, changing only ${label}.`);

  const explained = [], unexplained = [];
  for (const f of fams) {
    const sameReport = takes.flatMap((t) => t.messages.filter((m) => m.dir === 'out' && sameShape(m, f.group[0])));
    const cs = findChecksum(f.D, sameReport);
    const R = f.D.filter((p) => !csPositions(cs).includes(p));
    const enc = kind === 'number' ? explainNumber(f.group, values, R, cs, f.len) : explainMap(f.group, values, R);
    const what = `the ${f.group[0].type} report${f.group[0].reportId ? ` ${f.group[0].reportId}` : ''} starting ${hexOf(f.group[0].data.slice(0, 3))}`;
    if (!enc.length) { unexplained.push(`${what}: byte${R.length === 1 ? '' : 's'} ${R.join(', ')} changed, but not in a way that gives ${values.map(show).join(', ')}`); continue; }
    explained.push({ ...f, cs, enc, what });
  }
  if (!explained.length) {
    return refuse([`DeviceHub found no bytes that hold ${label}.`, ...unexplained.slice(0, 4).map((x) => `In ${x}.`),
      'A byte other than the value may have changed (a counter or a whole block of settings): DeviceHub only learns messages where just the value moves.']);
  }
  const needMore = takes.length < 3;
  if (explained.length > 1) {
    return refuse([`More than one message changed with ${label} (${explained.map((e) => e.what).join('; ')}), so DeviceHub cannot tell which one sets it.`,
      needMore ? 'Record one more, different value: that often settles it.' : 'A third value did not settle it, so this setting cannot be learned here.'], { ambiguous: true, needMore });
  }
  const w = explained[0];
  const top = w.enc.filter((e) => tie(e, w.enc[0]));
  if (top.length > 1) {
    return refuse([`The value could sit in more than one place (${top.map(where).join(' or ')}).`,
      needMore ? 'Record one more value, far from the other two (for a number, one above 255): that settles it.' : 'Three values did not settle it, so this setting cannot be learned here.'], { ambiguous: true, needMore });
  }
  const enc = top[0];

  // the regular read whose reply carries the value
  const transport = w.group[0].type;
  if (transport === 'input') return refuse('The value went out as an input report, which a driver cannot send.');
  const replyType = transport === 'output' ? 'input' : 'feature';
  const pairsOf = (t, after) => {
    const ms = t.messages, out = [];
    ms.forEach((r, idx) => {
      if (r.dir !== 'in' || r.type !== replyType || r.ts < after) return;
      for (let k = idx - 1; k >= 0; k--) {
        const q = ms[k];
        if (q.dir !== 'out') continue;
        if (r.ts - q.ts > PAIR_S) break;
        if (q.type === transport && (transport === 'output' || q.reportId === r.reportId)) { out.push({ req: q, reply: r }); break; }
      }
    });
    return out;
  };
  const pairs = takes.map((t, i) => pairsOf(t, w.group[i].ts));
  const reqKeys = [...new Set(pairs[0].map((p) => keyOf(p.req)))].filter((k) => pairs.every((ps) => ps.some((p) => keyOf(p.req) === k)) && !w.group.some((g) => keyOf(g) === k));
  const reads = [];
  for (const k of reqKeys) {
    const chosen = pairs.map((ps) => lastOf(ps.filter((p) => keyOf(p.req) === k)));
    const rl = chosen[0].reply.data.length;
    if (!chosen.every((c) => c.reply.data.length === rl && c.reply.reportId === chosen[0].reply.reportId)) continue;
    const replies = chosen.map((c) => c.reply);
    if (kind === 'number') {
      const fields = [];
      for (let o = 0; o < rl; o++) for (const size of [1, 2, 4]) for (const endian of size === 1 ? ['little'] : ['little', 'big']) {
        if (o + size > rl) continue;
        const raws = replies.map((r) => readNum(r.data, o, size, endian));
        if (new Set(raws).size !== raws.length) continue;
        SCALES.forEach((s, si) => [0, s, -s].forEach((add, ai) => {
          if (raws.every((r, i) => near(r * s + add, values[i]))) {
            const sameEnc = size === enc.size && endian === enc.endian && s === enc.scale && add === enc.add;
            fields.push({ offset: o, size, endian, scale: s, add, rank: [sameEnc ? 0 : 1, size, si, ai] });
          }
        }));
      }
      for (const f of fields) reads.push({ key: k, chosen, field: f });
    } else {
      for (let o = 0; o < rl; o++) {
        const codes = replies.map((r) => r.data[o]);
        if (new Set(codes).size !== codes.length) continue;
        reads.push({ key: k, chosen, field: { offset: o, size: 1, codes, rank: [same(codes, enc.codes) ? 0 : 1, 1, 0, 0] } });
      }
    }
  }
  if (!reads.length) {
    return refuse([`The write of ${label} was found (${w.what}, ${where(enc)}), but no regular read was seen that reports it back.`,
      `A setting DeviceHub cannot read cannot be written: it reads before and after every write. If the maker's app shows ${label} again when it opens, record while opening the app, then try again.`]);
  }
  const cmp = (a, b) => { for (let i = 0; i < 4; i++) if (a.field.rank[i] !== b.field.rank[i]) return a.field.rank[i] - b.field.rank[i]; return 0; };
  reads.sort(cmp);
  // the smallest field at each place wins over a wider one around it
  const best = reads.filter((r) => cmp(r, reads[0]) === 0);
  const places = [...new Map(best.map((r) => [`${r.key}@${r.field.offset}`, r])).values()];
  if (places.length > 1) {
    return refuse([`More than one reply reports ${label} (${places.slice(0, 3).map((r) => `byte ${r.field.offset} of the reply to ${hexOf(r.chosen[0].req.data.slice(0, 3))}`).join('; ')}).`,
      needMore ? 'Record one more, different value: that settles it.' : 'Three values did not settle it, so this setting cannot be learned here.'], { ambiguous: true, needMore });
  }
  const rd = places[0];

  // replies repeat the start of their request (how the driver matches them): the reads' and the write's
  const echoLen = (a, b) => { let k = 0; while (k < Math.min(a.length, b.length, 4) && a[k] === b[k]) k++; return k; };
  let echo = Math.min(...rd.chosen.map((c) => echoLen(c.req.data, c.reply.data)));
  const writeReplies = [];
  for (let i = 0; i < takes.length; i++) {
    const wm = w.group[i];
    // its reply comes before the next request (a later reply answers that one, not the write)
    const ms = takes[i].messages, from = ms.indexOf(wm);
    let r = null;
    for (let k = from + 1; k < ms.length; k++) {
      const m = ms[k];
      if (m.ts - wm.ts > PAIR_S || (m.dir === 'out' && m.type === transport)) break;
      if (m.dir === 'in' && m.type === replyType && (transport === 'output' || m.reportId === wm.reportId) && echoLen(wm.data, m.data) >= 1) { r = m; break; }
    }
    if (!r) return refuse([`The device did not answer the write of ${label} in recording ${i + 1}.`, 'DeviceHub only writes what the device answers and can read back, so this setting cannot be learned here.']);
    writeReplies.push(r);
    echo = Math.min(echo, echoLen(wm.data, r.data));
  }
  if (echo < 1) return refuse('The device\'s replies do not repeat the start of the request, so DeviceHub cannot tell which reply answers which request.');
  if (rd.chosen[0].req.data.length !== w.len) return refuse('The read and the write use reports of different lengths; one driver.json uses one report length.');
  const allReplies = [...rd.chosen.map((c) => c.reply), ...writeReplies];
  const replyChecksum = !!w.cs && allReplies.every((r) => csHolds(r.data, w.cs));
  const plain = (e) => ({ offset: e.offset, size: e.size, ...(e.endian && e.size > 1 ? { endian: e.endian } : {}), ...(e.codes ? { codes: e.codes } : { scale: e.scale, add: e.add }) });
  const learned = {
    label, kind, unit: setting.unit || '', options: setting.options || null, values,
    transport: { report: transport, len: w.len, reportId: w.group[0].reportId },
    checksum: w.cs, replyChecksum, echo,
    write: { reportId: w.group[0].reportId, data: w.group.map((m) => m.data), enc: plain(enc) },
    read: { reportId: rd.chosen[0].req.reportId, data: rd.chosen[0].req.data, field: plain(rd.field) },
  };
  learned.evidence = [
    `The write: ${w.what}, ${label} in ${where(enc)}${kind === 'number' ? ` as the number${howScaled(enc)}` : `, one code per value (${enc.codes.map((c, i) => `${show(values[i])} = ${hexOf([c])}`).join(', ')})`}.`,
    w.cs ? `Byte ${w.cs.at} is a checksum (${w.cs.type === 'xor' ? 'XOR' : w.cs.type === 'sum8' ? 'sum' : '16-bit sum'} of bytes ${w.cs.from}-${w.cs.to}); DeviceHub works it out.` : null,
    `The read: ${hexOf(learned.read.data.slice(0, 4))}..., its reply reports ${label} in ${where(rd.field)}.`,
    `Seen for every value: ${values.map(show).join(', ')}.`,
  ].filter(Boolean);
  learned.writeBytes = w.group.map((m) => hexOf(m.data));
  return { ok: true, learned };
}

// ---------------------------------------------------------------- d. driver.json
export const slug = (s, max = 31) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
export function settingKey(label, taken = []) {
  const words = String(label || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let k = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'setting';
  if (!/^[A-Za-z]/.test(k)) k = `s${k}`;
  k = k.slice(0, 30);
  let out = k, n = 2;
  while (taken.includes(out)) out = `${k}${n++}`;
  return out;
}
const placeholder = (size, endian) => (size === 1 ? '{value}' : `{value:u${size * 8}${endian === 'big' ? 'be' : 'le'}}`);

// the template for one captured message: its bytes up to the last non-zero one (the rest is padding), the value's bytes
// as one placeholder, the checksum left out (DeviceHub writes it). Throws when the message cannot be a template.
function template(data, place, cs) {
  const skip = new Set(csPositions(cs));
  let end = 0;
  for (let i = 0; i < data.length; i++) if (!skip.has(i) && (data[i] !== 0 || (place && i >= place.offset && i < place.offset + place.size))) end = i + 1;
  if (cs && end > cs.at) throw new Error(`it has bytes after its checksum (byte ${cs.at}), which driver.json cannot express`);
  const out = [];
  for (let i = 0; i < end;) {
    if (place && i === place.offset) { out.push(placeholder(place.size, place.endian)); i += place.size; continue; }
    out.push(hexOf([data[i]])); i++;
  }
  return out.join(' ') || '00';
}

// the raw code a value is sent as (the inverse of the write's encoding)
export function codeFor(s, v) {
  const e = s.write.enc;
  if (e.codes) { const i = s.values.findIndex((x) => same(x, v)); return i < 0 ? undefined : e.codes[i]; }
  return Math.round((v - e.add) / e.scale);
}

// draft: { vid, pid, product, usagePage, usage, title, kind, settings: [learned + key, min, max, step] } -> driver.json
export function buildDriver(draft, { date = new Date() } = {}) {
  const ls = draft.settings || [];
  if (!ls.length) throw new Error('learn at least one setting first');
  const t0 = ls[0].transport, cs = ls[0].checksum;
  for (const s of ls) {
    if (s.transport.report !== t0.report || s.transport.len !== t0.len) throw new Error(`${s.label} goes over ${s.transport.report} reports of ${s.transport.len} bytes and ${ls[0].label} over ${t0.report} reports of ${t0.len}: one driver.json uses one kind of report`);
    if (!same(s.checksum, cs)) throw new Error(`${s.label} and ${ls[0].label} use different checksums: one driver.json uses one`);
  }
  const vid = up4(draft.vid), pid = up4(draft.pid);
  const title = String(draft.title || draft.product || `USB device ${vid}:${pid}`).trim().slice(0, 60);
  let id = slug(title);
  if (!/^[a-z]/.test(id)) id = `dev-${id}`.slice(0, 31).replace(/-+$/, '');
  if (id.length < 2 || ['mouse', 'headset', 'keyboard'].includes(id)) id = `learned-${vid.toLowerCase()}-${pid.toLowerCase()}`;
  const def = {
    format: 1, id, title, kind: draft.kind || 'Device',
    about: `Learned with DeviceHub's learning wizard on ${date.toISOString().slice(0, 10)} from what the maker's app sent while one setting at a time was changed. Every byte in "messages" was seen in those recordings.`,
    vid, pids: [pid],
    hid: { vid, pid, ...(draft.usagePage ? { page: up4(draft.usagePage) } : {}), ...(draft.usage ? { usage: up4(draft.usage) } : {}), len: t0.len, reportId: t0.reportId },
    transport: { report: t0.report, len: t0.len, reportId: t0.reportId, ...(draft.usagePage ? { usagePage: up4(draft.usagePage) } : {}), timeoutMs: 1000, tries: 2, ...(cs ? { checksum: cs } : {}) },
    links: { usb: { label: 'USB', wireless: false } },
    models: [{ key: 'learned', name: title, pids: { usb: [pid] } }],
    replies: { echo: Array.from({ length: Math.min(...ls.map((s) => s.echo)) }, (_, i) => i), ...(cs && ls.every((s) => s.replyChecksum) ? { checksum: true } : {}) },
    messages: {}, reads: [], fields: {}, settings: [], unsupported: [],
  };
  const keys = ls.map((s) => s.key);
  for (const s of ls) {
    const rb = template(s.read.data, null, cs);
    let rn = Object.keys(def.messages).find((n) => n.startsWith('read') && def.messages[n].bytes === rb && (def.messages[n].reportId ?? t0.reportId) === s.read.reportId);
    if (!rn) {
      rn = `read${def.reads.length + 1}`;
      def.messages[rn] = { bytes: rb, ...(s.read.reportId !== t0.reportId ? { reportId: s.read.reportId } : {}) };
      def.reads.push({ name: rn, message: rn });
    }
    const f = s.read.field;
    def.fields[s.key] = f.codes
      ? { from: rn, offset: f.offset, map: Object.fromEntries(f.codes.map((c, i) => [String(c), s.kind === 'toggle' ? s.values[i] === true : s.values[i]])) }
      : { from: rn, offset: f.offset, ...(f.size > 1 ? { size: f.size, endian: f.endian || 'little' } : {}), ...(f.scale !== 1 ? { scale: f.scale } : {}), ...(f.add ? { add: f.add } : {}) };
    const wn = `set${s.key[0].toUpperCase()}${s.key.slice(1)}`;
    const e = s.write.enc;
    def.messages[wn] = { bytes: template(s.write.data[0], e, cs), ...(s.write.reportId !== t0.reportId ? { reportId: s.write.reportId } : {}) };
    const write = { message: wn, keep: keys.filter((k) => k !== s.key) };
    if (!write.keep.length) delete write.keep;
    if (e.codes && !same(e.codes, f.codes)) write.encode = { map: Object.fromEntries(e.codes.map((c, i) => [String(s.values[i]), c])) };
    const st = { key: s.key, label: s.label, type: s.kind === 'number' ? 'slider' : s.kind, write };
    if (s.kind === 'number') Object.assign(st, { min: s.min, max: s.max, step: s.step || 1 });
    if (s.kind === 'choice') st.options = s.values.map((v) => ({ value: v, label: String(v) }));
    if (s.unit) st.unit = s.unit.startsWith(' ') ? s.unit : ` ${s.unit}`;
    def.settings.push(st);
  }
  return def;
}

// every captured message, rebuilt by the driver itself (declarative-driver's build, the only way it sends bytes), must
// come out byte for byte the same: [] or the sentences that say what would differ
export function verifySeen(def, settings) {
  const problems = [];
  let drv;
  try { drv = fromJson(def); } catch (e) { return [e.message]; }
  const pad = (d) => { const a = new Uint8Array(def.transport.len); a.set(d.slice(0, def.transport.len)); return a; };
  for (const s of settings) {
    const st = def.settings.find((x) => x.key === s.key);
    const rn = def.fields[s.key].from;
    try {
      const b = drv.build(rn);
      if (hexOf(b.data) !== hexOf(pad(s.read.data)) || b.reportId !== s.read.reportId) problems.push(`${s.label}: the read it would send is not the one recorded`);
    } catch (e) { problems.push(`${s.label}: its read cannot be built (${e.message})`); }
    s.values.forEach((v, i) => {
      try {
        const b = drv.build(st.write.message, { value: codeFor(s, v) });
        if (hexOf(b.data) !== hexOf(pad(s.write.data[i])) || b.reportId !== s.write.reportId) problems.push(`${s.label} = ${show(v)}: the write it would send is not the one recorded`);
      } catch (e) { problems.push(`${s.label} = ${show(v)}: its write cannot be built (${e.message})`); }
    });
  }
  return problems;
}

// a learned setting with its page range -> { setting } or { why }. Numbers: min, max, step from the maker's app.
export function withRange(learned, { min, max, step } = {}, taken = []) {
  const s = { ...learned, key: settingKey(learned.label, taken) };
  if (learned.kind !== 'number') return { setting: s };
  const vs = learned.values;
  const e = learned.write.enc;
  min = min === '' || min == null ? Math.min(...vs) : Number(min);
  max = max === '' || max == null ? Math.max(...vs) : Number(max);
  step = step === '' || step == null ? (Number.isInteger(e.scale) ? e.scale : 1) : Number(step);
  if (![min, max, step].every(Number.isFinite) || !(max > min) || !(step > 0)) return { why: 'The lowest value must be below the highest, and the step above 0.' };
  if (!vs.every((v) => v >= min && v <= max)) return { why: `The range must include the values you recorded (${vs.join(', ')}).` };
  const top = 2 ** (8 * e.size) - 1;
  const rawMax = (max - e.add) / e.scale, rawMin = (min - e.add) / e.scale;
  if (rawMax > top || rawMin < 0) return { why: `${learned.label} sits in ${e.size === 1 ? 'one byte' : `${e.size} bytes`} in what was recorded, which holds only ${e.add}-${e.add + e.scale * top}. Learn it again with values further apart (one above ${e.add + e.scale * 255}) if the app goes higher.` };
  return { setting: { ...s, min, max, step } };
}

// ---------------------------------------------------------------- the devices (a)
// learn-hid-list.ps1's JSON -> [{ vid, pid, name, collections, vendor, why? }], one per vid:pid
export function groupDevices(json, { runs = [], mine = [], library = [] } = {}) {
  const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const by = new Map();
  for (const c of arr(json?.collections)) {
    if (!c?.vid || !c?.pid) continue;
    const k = `${up4(c.vid)}:${up4(c.pid)}`;
    if (!by.has(k)) by.set(k, { vid: up4(c.vid), pid: up4(c.pid), name: null, collections: [] });
    const d = by.get(k);
    d.name = d.name || c.product || null;
    d.collections.push({ iface: c.iface ?? null, col: c.col ?? null, page: up4(c.page), usage: up4(c.usage), inLen: c.inLen || 0, outLen: c.outLen || 0, featLen: c.featLen || 0, inIds: arr(c.inIds), outIds: arr(c.outIds), featIds: arr(c.featIds) });
  }
  const own = new Set([...runs, ...mine].map((x) => String(x).toUpperCase()));
  const lib = new Set(library.map((x) => String(x).toUpperCase()));
  const out = [];
  for (const [k, d] of by) {
    if (own.has(k)) continue;
    d.vendor = d.collections.some((c) => parseInt(c.page, 16) >= 0xff00);
    d.writable = d.collections.some((c) => c.outLen > 1 || c.featLen > 1);
    if (!d.writable) continue;
    if (lib.has(k)) d.library = true;
    d.name = d.name || `USB device ${k}`;
    out.push(d);
  }
  return out.sort((a, b) => Number(b.vendor) - Number(a.vendor) || a.name.localeCompare(b.name));
}
// the collection a learned report goes through (its report id and length), vendor pages first
export function collectionFor(device, transport) {
  const cols = (device?.collections || []).slice().sort((a, b) => (parseInt(b.page, 16) >= 0xff00) - (parseInt(a.page, 16) >= 0xff00));
  const lenOf = (c) => (transport.report === 'feature' ? c.featLen : c.outLen) - 1;
  const idsOf = (c) => (transport.report === 'feature' ? c.featIds : c.outIds);
  return cols.find((c) => lenOf(c) === transport.len && (transport.reportId ? idsOf(c).includes(transport.reportId) : !idsOf(c).some((x) => x))) || cols.find((c) => lenOf(c) === transport.len) || null;
}
const usesIds = (device, which) => (device?.collections || []).some((c) => (c[which] || []).some((x) => x));

// ---------------------------------------------------------------- e. save
// my-devices\<folder>\driver.json + library.json "read-only" (loaded guarded: no write until the self-check passes)
export function saveDriver(def, { root = ROOT, folder, now = () => new Date() } = {}) {
  const v = validate(def);
  if (!v.ok) return { ok: false, why: v.problems };
  const base = slug(folder || def.title || def.id, 50) || def.id;
  const dir = path.join(root, 'my-devices');
  fs.mkdirSync(dir, { recursive: true });
  let name = base, n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${base}-${n++}`;
  const to = path.join(dir, name);
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, 'driver.json'), JSON.stringify(def, null, 2) + '\n', { flag: 'wx' });
  const mark = { source: 'learned on this PC (learning wizard)', name, id: def.id, status: 'read-only', installedAt: now().toISOString(), devicehub: devicehubVersion(root), learned: true };
  fs.writeFileSync(path.join(to, 'library.json'), JSON.stringify(mark, null, 2) + '\n', { flag: 'wx' });
  return { ok: true, name, folder: to, id: def.id };
}

// ---------------------------------------------------------------- the parts that touch Windows (replaced in tests)
const PS = (args, ms = 60000) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true, timeout: ms, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve({ error: e, out: String(out || '') })));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
export const USBPCAP_EXE = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'USBPcap', 'USBPcapCMD.exe');

export const deps = {
  usbpcapInstalled: () => fs.existsSync(USBPCAP_EXE),
  async listHid() {
    const r = await PS(['-File', path.join(HERE, 'learn-hid-list.ps1')]);
    const at = r.out.indexOf('{');
    if (at < 0) throw new Error('the device list could not be read');
    return JSON.parse(r.out.slice(at));
  },
  // the ids DeviceHub already runs: its own drivers (pc-map RUNS) and every my-devices driver
  owned(root) {
    let runs = [];
    try { runs = Object.keys(require('./pc-map.js').RUNS || {}); } catch {}
    const mine = [];
    const dir = path.join(root, 'my-devices');
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch {}
    for (const n of names) {
      for (const f of ['driver.json', 'device.json']) {
        const j = readJson(path.join(dir, n, f));
        if (j?.vid) for (const p of [].concat(j.pids || [])) mine.push(`${up4(j.vid)}:${up4(p)}`);
      }
      try { const t = fs.readFileSync(path.join(dir, n, 'device.mjs'), 'utf8'); const v = /vid:\s*'([0-9A-Fa-f]{4})'/.exec(t); for (const m of t.matchAll(/pid:\s*'([0-9A-Fa-f]{4})'/g)) if (v) mine.push(`${up4(v[1])}:${up4(m[1])}`); } catch {}
    }
    return { runs: runs.map((k) => k.split(':').map(up4).join(':')), mine };
  },
  // the listener, through Windows' admin prompt (UAC): { started } or { started: false, declined, error }
  startCapture(dir) {
    const ps = "try { Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('\"' + $env:DH_SCRIPT + '\"'),'-Dir',('\"' + $env:DH_DIR + '\"')) -ErrorAction Stop; 'ok' } catch { 'error|' + $_.Exception.Message }";
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, env: { ...process.env, DH_SCRIPT: path.join(HERE, 'learn-capture.ps1'), DH_DIR: dir } });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('error', (e) => resolve({ started: false, error: e.message }));
      p.on('exit', () => { const t = out.trim(); resolve(t === 'ok' ? { started: true } : { started: false, declined: /cancel/i.test(t), error: t.replace(/^error\|/, '') || 'it did not start' }); });
    });
  },
  writeCommand(dir, text) { const f = path.join(dir, 'command.txt'); fs.writeFileSync(`${f}.tmp`, text); fs.renameSync(`${f}.tmp`, f); },
  readState: (dir) => readJson(path.join(dir, 'state.json')),
  readTake(dir, name) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.pcap')); } catch {}
    return files.map((f) => fs.readFileSync(path.join(dir, f)));
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async loadNew(root) { try { return await (await import('./my-devices.mjs')).loadNew(root); } catch { return null; } },
};
export const options = { root: ROOT, deps };

// ---------------------------------------------------------------- the session (one at a time)
let session = null;
let listed = [];
export const current = () => session;
export function reset() { session = null; listed = []; }

async function listDevices() {
  const { root, deps: d } = options;
  const own = d.owned(root);
  let library = [];
  const json = await d.listHid();
  const raw = groupDevices(json, { ...own });
  try { library = libraryMatch(raw.map((x) => ({ vid: x.vid, pid: x.pid })), { root, readOnly: true }).flatMap((m) => m.matched.map((u) => `${up4(u.vid)}:${up4(u.pid)}`)); } catch {}
  listed = groupDevices(json, { ...own, library });
  return listed;
}

async function command(dir, verb, arg, want, ms = 15000) {
  const { deps: d } = options;
  const seq = (session.seq = (session.seq || 0) + 1);
  d.writeCommand(dir, `${seq} ${verb}${arg ? ` ${arg}` : ''}`);
  for (let t = 0; t < ms; t += 200) {
    const s = d.readState(dir);
    if (s && s.seq >= seq && (s.status === want || s.status === 'error' || s.status === 'ended')) return s;
    await d.sleep(200);
  }
  return { status: 'timeout' };
}

function summary() {
  if (!session) return { active: false };
  const st = session.listening ? options.deps.readState(session.dir) : null;
  return {
    active: true,
    device: { vid: session.device.vid, pid: session.device.pid, name: session.device.name },
    listener: !session.listening ? 'off' : !st ? 'waiting' : st.status,
    listenerError: st?.error || null,
    setting: session.setting,
    takes: session.takes.map((t) => ({ value: t.value, heard: t.messages.length })),
    recording: session.recording || null,
    learned: session.learned.map((s) => ({ key: s.key, label: s.label, kind: s.kind, min: s.min, max: s.max, step: s.step, unit: s.unit, values: s.values })),
    saved: session.saved || null,
  };
}

const clean = (s, max = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
function parseValue(kind, v) {
  if (kind === 'number') { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : undefined; }
  if (kind === 'toggle') return v === true || v === 'on' || v === 'true' ? true : v === false || v === 'off' || v === 'false' ? false : undefined;
  const s = clean(v, 30);
  return s || undefined;
}

export async function act(name, b = {}) {
  const { root, deps: d } = options;
  if (name === 'begin') {
    const dev = listed.find((x) => x.vid === up4(b.vid) && x.pid === up4(b.pid));
    if (!dev) return { ok: false, error: 'That device is not in the list: look again.' };
    if (session?.listening) await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {});
    const id = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${dev.vid}-${dev.pid}`.toLowerCase();
    const dir = path.join(root, 'learn', 'wizard', id);
    fs.mkdirSync(dir, { recursive: true });
    session = { id, dir, device: dev, setting: null, takes: [], learned: [], listening: false, seq: 0 };
    return { ok: true, ...summary() };
  }
  if (!session) return { ok: false, error: 'Pick a device first.' };
  if (name === 'listen') {
    if (!d.usbpcapInstalled()) return { ok: false, error: 'USBPcap is not installed.' };
    const st = session.listening ? d.readState(session.dir) : null;
    if (st && ['ready', 'recording', 'stopped'].includes(st.status)) return { ok: true, ...summary() };
    for (const f of ['state.json', 'command.txt']) { try { fs.rmSync(path.join(session.dir, f), { force: true }); } catch {} }
    session.seq = 0;
    const r = await d.startCapture(session.dir);
    if (!r.started) return { ok: false, error: r.declined ? 'The Windows prompt was declined, so DeviceHub is not listening.' : `DeviceHub could not start listening: ${r.error}` };
    session.listening = true;
    return { ok: true, ...summary() };
  }
  if (name === 'setting') {
    const kind = ['number', 'toggle', 'choice'].includes(b.kind) ? b.kind : 'number';
    const label = clean(b.label, 40);
    if (!label) return { ok: false, error: 'Name the setting first (for example DPI).' };
    if (/firmware|bootloader|dfu|flash|factory|reset|pair/i.test(label)) return { ok: false, error: 'DeviceHub never learns firmware, reset, flash or pairing controls.' };
    const values = (Array.isArray(b.values) ? b.values : []).map((v) => parseValue(kind, v));
    if (values.length < 2 || values.some((v) => v === undefined)) return { ok: false, error: kind === 'number' ? 'Give two numbers.' : kind === 'toggle' ? 'Give on and off.' : 'Give two choices as the app names them.' };
    if (new Set(values.map((v) => JSON.stringify(v))).size !== values.length) return { ok: false, error: 'The two values must be different.' };
    session.setting = { label, kind, unit: clean(b.unit, 10), values };
    session.takes = [];
    return { ok: true, ...summary() };
  }
  if (name === 'record') {
    if (!session.setting) return { ok: false, error: 'Say which setting first.' };
    let value = session.setting.values[session.takes.length];
    if (b.value !== undefined) value = parseValue(session.setting.kind, b.value);
    if (value === undefined) return { ok: false, error: 'Which value?' };
    if (session.takes.some((t) => same(t.value, value))) return { ok: false, error: 'That value is recorded already: pick another.' };
    const take = `take-${session.takes.length + 1}-${Date.now().toString(36)}`;
    const s = await command(session.dir, 'start', take, 'recording');
    if (s.status !== 'recording') return { ok: false, error: s.error || (s.status === 'timeout' ? 'The listener did not answer. Press Start listening again.' : 'The listener stopped. Press Start listening again.') };
    session.recording = { take, value };
    return { ok: true, ...summary() };
  }
  if (name === 'stop') {
    const rec = session.recording;
    if (!rec) return { ok: false, error: 'Nothing is being recorded.' };
    const s = await command(session.dir, 'stop', null, 'stopped');
    session.recording = null;
    if (s.status !== 'stopped') return { ok: false, error: s.error || 'The listener did not stop cleanly. Record that value again.' };
    const dev = session.device;
    const { found, messages } = takeMessages(d.readTake(session.dir, rec.take), { vid: dev.vid, pid: dev.pid, idsOut: usesIds(dev, 'outIds'), idsIn: usesIds(dev, 'inIds') });
    if (!found) return { ok: false, error: `DeviceHub did not find the ${dev.name} in the recording. Unplug it, plug it back in, and record that value again.` };
    if (!messages.length) return { ok: false, error: `Nothing went to or from the ${dev.name} while recording. Was ${session.setting.label} changed in the maker's app? Record that value again.` };
    session.takes.push({ value: rec.value, messages });
    return { ok: true, heard: messages.length, ...summary() };
  }
  if (name === 'analyze') {
    const r = analyze(session.takes, session.setting);
    session.analysis = r.ok ? r.learned : null;
    if (!r.ok) return { ok: false, why: r.why, ambiguous: !!r.ambiguous, needMore: !!r.needMore };
    const l = r.learned, e = l.write.enc;
    return { ok: true, evidence: l.evidence, writeBytes: l.writeBytes, valueAt: { offset: e.offset, size: e.size }, kind: l.kind,
      range: l.kind === 'number' ? { min: Math.min(...l.values), max: Math.max(...l.values), step: Number.isInteger(e.scale) ? e.scale : 1 } : null };
  }
  if (name === 'add') {
    if (!session.analysis) return { ok: false, error: 'Nothing learned yet.' };
    const r = withRange(session.analysis, b, session.learned.map((s) => s.key));
    if (!r.setting) return { ok: false, why: [r.why] };
    const all = [...session.learned, r.setting];
    const out = draftCheck(all, b);
    if (!out.ok) return out;
    session.learned = all; session.analysis = null; session.setting = null; session.takes = [];
    return { ok: true, driver: out.driver, ...summary() };
  }
  if (name === 'remove') {
    session.learned = session.learned.filter((s) => s.key !== b.key);
    return { ok: true, ...summary() };
  }
  if (name === 'preview') {
    if (!session.learned.length) return { ok: false, error: 'Learn at least one setting first.' };
    return draftCheck(session.learned, b);
  }
  if (name === 'save') {
    if (!session.learned.length) return { ok: false, error: 'Learn at least one setting first.' };
    const c = draftCheck(session.learned, b);
    if (!c.ok) return c;
    const r = saveDriver(c.driver, { root, folder: b.title });
    if (!r.ok) return { ok: false, why: r.why };
    let loaded = null;
    try { loaded = await d.loadNew(root); } catch {}
    session.saved = { name: r.name, id: r.id, loaded: !!loaded?.some((x) => x.name === r.name && x.id) };
    if (session.listening) { await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {}); session.listening = false; }
    return { ok: true, ...summary() };
  }
  if (name === 'quit') {
    if (session.listening) await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {});
    session = null;
    return { ok: true, active: false };
  }
  return { ok: false, error: 'no such step' };
}

function draftCheck(learned, b = {}) {
  const dev = session.device;
  const col = collectionFor(dev, learned[0].transport);
  let def;
  try { def = buildDriver({ vid: dev.vid, pid: dev.pid, product: dev.name, title: clean(b.title) || dev.name, kind: ['Mouse', 'Keyboard', 'Headset', 'Light', 'Controller', 'Device'].includes(b.kind) ? b.kind : 'Device', usagePage: col?.page, usage: col?.usage, settings: learned }); }
  catch (e) { return { ok: false, why: [e.message] }; }
  const v = validate(def);
  if (!v.ok) return { ok: false, why: v.problems, driver: def };
  const seen = verifySeen(def, learned);
  if (seen.length) return { ok: false, why: ['The driver would send something not seen in the recordings, so it was not made.', ...seen], driver: def };
  return { ok: true, driver: def };
}

// ---------------------------------------------------------------- the route
//   GET  /api/learn/devices   the devices DeviceHub does not run, and whether USBPcap is installed
//   GET  /api/learn/state     where the wizard is
//   POST /api/learn/<step>    begin {vid,pid}, listen, setting {label,kind,unit,values}, record {value?}, stop, analyze,
//                             add {min,max,step}, remove {key}, preview {title,kind}, save {title,kind}, quit
export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/learn/')) return false;
  const step = url.pathname.slice('/api/learn/'.length);
  try {
    if (req.method === 'GET' && step === 'devices') {
      const devices = await listDevices();
      send(res, 200, { devices: devices.map(({ collections, ...x }) => ({ ...x, collections: collections.length })), usbpcap: options.deps.usbpcapInstalled(), ...summary() });
      return true;
    }
    if (req.method === 'GET' && step === 'state') { send(res, 200, { usbpcap: options.deps.usbpcapInstalled(), ...summary() }); return true; }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
    const b = (await readBody(req)) || {};
    const r = await act(step, b);
    send(res, 200, r);
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
  return true;
}
