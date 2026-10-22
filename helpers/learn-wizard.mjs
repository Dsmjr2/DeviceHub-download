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
//      GUARDED, so no setting is written until the person presses Turn on settings and it passes DeviceHub's check
//      (read, write the same value, read back)
//
// A device that already has a driver (22 Oct 2026, docs/handoff/setup-gaps.md) is listed with "already has a driver;
// Learn adds settings it lacks". For a driver.json driver the learned settings are added to its copy in my-devices
// (installed from the library first when it is not there yet; the old files backed up to backups\ first); the library's
// own copy is never edited. Added settings are listed in library.json learnedKeys and stay read-only until the person
// presses Turn on settings and each passes the check, whatever the entry's status. Refused at begin, in plain words: a chip maker's shared vendor id where a
// wrong write has bricked devices (SHARED_CHIPS), a vendor DeviceHub never takes as a driver.json (never-commands.json
// refuseVendors), a device whose driver refuses every write, and a device whose driver is code (device.mjs).
//
// Readings and a second USB id (22 Oct 2026, docs/handoff/learn-readings.md): a value the device reports and the
// person cannot set (battery, charging, ChatMix, a sensor) is learned from a read and its reply, or from an input report
// the device sends by itself (a notice), and becomes a display setting or the driver's battery; nothing is written for
// it. After a save, the same device can be learned on its other USB id (cable and receiver): the same settings recorded
// there are added to the same driver (addPid), as another id when the bytes match, with that id's own bytes (byPid)
// when they do not.
//
// The analysis (analyze, analyzeReading, buildDriver, verifySeen, addPid, hidMessages) is pure and tested with made-up recordings:
// tests/learn-wizard.mjs. The route: handle(url, req, res, send, readBody) for /api/learn/*.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readPcapBuffer } from './pcap-read.mjs';
import { validate, fromJson, forPid } from './declarative-driver.mjs';
import { ROOT, devicehubVersion, match as libraryMatch, list as libraryList, installFromLibrary, loadDriver, driverFileOf } from './device-library.mjs';
import { writable, libraryMark, LIBRARY_FILE } from './my-devices.mjs';
import { plan as makePlan, runAppUi, parseInfo, valueOf, uiText, valuesIn, FORBIDDEN } from './learn-apps.mjs';

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

// ---------------------------------------------------------------- c2. a reading (22 Oct 2026; docs/handoff/learn-readings.md)
// A value the device reports and the person cannot set: battery, charging, ChatMix, a sensor. Nothing is ever written
// for it, so only a read and its reply (or an input report the device sends by itself, a "notice") are looked for.
// setting: { label, kind: 'reading', role: 'battery' | 'charging' | 'display', unit }; each take's value is what the
// maker's app showed at the end of that recording (a battery percent, on/off for charging, a number or a word).
// { ok: true, learned } or { ok: false, why, ambiguous?, needMore? }, with the same refusals for ambiguity as a setting.
export const READING_ROLES = ['battery', 'charging', 'display'];
export function analyzeReading(takes, setting) {
  const label = setting?.label || 'the reading';
  const role = READING_ROLES.includes(setting?.role) ? setting.role : 'display';
  const battery = role === 'battery';
  if (!Array.isArray(takes) || !takes.length) return refuse('Record it first.');
  const values = takes.map((t) => t.value);
  const kindOf = values.every((v) => typeof v === 'number' && Number.isFinite(v)) ? 'number' : values.every((v) => typeof v === 'boolean') ? 'toggle' : 'words';
  if (battery && !(kindOf === 'number' && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 100))) return refuse('A battery level is a percent: a whole number from 0 to 100.');
  if (role === 'charging' && kindOf !== 'toggle') return refuse('Charging is on or off.');
  if (!battery && takes.length < 2) return refuse('Record at least two values first.');
  if (new Set(values.map((v) => JSON.stringify(v))).size !== values.length) return refuse(battery ? 'Each recording needs a different percent. Record again once the maker\'s app shows another one.' : 'Each recording needs a different value.');
  if (takes.some((t) => !t.messages.some((m) => m.dir === 'in'))) return refuse(`In recording ${takes.findIndex((t) => !t.messages.some((m) => m.dir === 'in')) + 1} the device sent nothing. Keep the maker's app open while DeviceHub listens, then record that value again.`);
  const one = takes.length === 1;
  const echoLen = (a, b) => { let k = 0; while (k < Math.min(a.length, b.length, 4) && a[k] === b[k]) k++; return k; };

  // each take: the requests with their replies (the last of each request), and the input reports that answer nothing
  const split = (t) => {
    const ms = t.messages, pairs = new Map(), notices = new Map(), used = new Set();
    ms.forEach((r, idx) => {
      if (r.dir !== 'in') return;
      for (let k = idx - 1; k >= 0; k--) {
        const q = ms[k];
        if (r.ts - q.ts > PAIR_S) break;
        if (q.dir !== 'out' || used.has(k)) continue;
        const fits = q.type === 'output' ? r.type === 'input' : q.type === 'feature' && r.type === 'feature' && q.reportId === r.reportId;
        if (fits && echoLen(q.data, r.data) >= 1) { used.add(k); pairs.set(keyOf(q), { req: q, reply: r }); return; }
        if (fits) break;
      }
      if (r.type === 'input' && r.data.length > 1) notices.set(`${r.reportId}:${r.data.length}:${r.data[0]}`, r);
    });
    return { pairs, notices };
  };
  const parts = takes.map(split);

  // where in these reports the value sits: [{ offset, size, endian, scale, add } | { offset, size: 1, codes }]
  const placesIn = (datas, skip) => {
    const rl = datas[0].length, out = [];
    for (let o = skip; o < rl; o++) {
      if (kindOf !== 'number') {
        const codes = datas.map((d) => d[o]);
        if (new Set(codes).size === codes.length) out.push({ offset: o, size: 1, codes, rank: [1, 0, 0] });
        continue;
      }
      for (const size of battery || one ? [1] : [1, 2, 4]) for (const endian of size === 1 ? ['little'] : ['little', 'big']) {
        if (o + size > rl) continue;
        const raws = datas.map((d) => readNum(d, o, size, endian));
        if (!one && new Set(raws).size !== raws.length) continue;
        (battery ? [1] : SCALES).forEach((s, si) => (battery ? [0] : [0, s, -s]).forEach((add, ai) => {
          if (raws.every((r, i) => near(r * s + add, values[i]))) out.push({ offset: o, size, endian, scale: s, add, rank: [size, si, ai] });
        }));
      }
    }
    return out;
  };
  const found = [];
  // a. a request sent byte for byte the same in every take, its reply holding it
  for (const k of parts[0].pairs.keys()) {
    if (!parts.every((p) => p.pairs.has(k))) continue;
    const chosen = parts.map((p) => p.pairs.get(k));
    const r0 = chosen[0].reply;
    if (!chosen.every((c) => c.reply.data.length === r0.data.length && c.reply.reportId === r0.reportId)) continue;
    const echo = Math.min(...chosen.map((c) => echoLen(c.req.data, c.reply.data)));
    for (const f of placesIn(chosen.map((c) => c.reply.data), echo)) found.push({ src: 'reply', key: k, chosen, echo, field: f, rank: [0, ...f.rank] });
  }
  // b. a notice: an input report the device sent by itself, the same report and first byte in every take
  for (const [sig, n0] of parts[0].notices) {
    if (!parts.every((p) => p.notices.has(sig))) continue;
    const got = parts.map((p) => p.notices.get(sig));
    for (const f of placesIn(got.map((n) => n.data), 1)) found.push({ src: 'notice', key: sig, got, field: f, rank: [1, ...f.rank] });
  }
  const shown = values.map((v) => (v === true ? 'on' : v === false ? 'off' : String(v))).join(', ');
  if (!found.length) {
    return refuse([`DeviceHub found nothing the device sent that matches ${label} (${shown}).`,
      battery ? 'Check the percent the maker\'s app showed, then record again with its battery page open.' : `Make sure the maker's app showed each value before you pressed Done, then record again.`]);
  }
  const cmp = (a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i]; return 0; };
  found.sort(cmp);
  const best = found.filter((x) => cmp(x, found[0]) === 0);
  const places = [...new Map(best.map((x) => [`${x.src}:${x.key}@${x.field.offset}`, x])).values()];
  const needMore = takes.length < 3;
  if (places.length > 1) {
    const say = (x) => `byte ${x.field.offset} of ${x.src === 'reply' ? `the reply to ${hexOf(x.chosen[0].req.data.slice(0, 3))}` : `a report the device sends starting ${hexOf(x.got[0].data.slice(0, 2))}`}`;
    return refuse([`More than one place matches ${label} (${places.slice(0, 3).map(say).join('; ')}${places.length > 3 ? ' and more' : ''}).`,
      needMore ? (battery ? 'Record again once the maker\'s app shows another percent: that settles it.' : 'Record one more, different value: that settles it.')
        : 'Three values did not settle it, so this reading cannot be learned here.'], { ambiguous: true, needMore });
  }
  const x = places[0];
  const plain = (e) => ({ offset: e.offset, size: e.size, ...(e.endian && e.size > 1 ? { endian: e.endian } : {}), ...(e.codes ? { codes: e.codes } : { scale: e.scale, add: e.add }) });
  const learned = { label, kind: 'reading', role, valueKind: kindOf, unit: setting.unit || '', values, write: null, checksum: null, replyChecksum: false };
  if (x.src === 'reply') {
    const q = x.chosen[0].req;
    if (q.type === 'input') return refuse('The request went out as an input report, which a driver cannot send.');
    Object.assign(learned, {
      transport: { report: q.type, len: q.data.length, reportId: q.reportId }, echo: x.echo,
      read: { reportId: q.reportId, data: q.data, field: plain(x.field), replies: x.chosen.map((c) => c.reply.data) },
    });
    learned.evidence = [`The read: ${hexOf(q.data.slice(0, 4))}..., its reply reports ${label} in ${where(x.field)}${x.field.codes ? `, one code per value (${x.field.codes.map((c, i) => `${show(values[i])} = ${hexOf([c])}`).join(', ')})` : howScaled(x.field) ? ` as the number${howScaled(x.field)}` : ''}.`];
    learned.bytes = x.chosen.map((c) => hexOf(c.reply.data));
  } else {
    const n = x.got[0];
    // the bytes it starts with: the leading bytes every take's report shares, before the value (at least one)
    let k = 1;
    while (k < Math.min(4, x.field.offset) && x.got.every((g) => g.data[k] === n.data[k])) k++;
    Object.assign(learned, {
      transport: null, echo: null,
      notice: { reportId: n.reportId, len: n.data.length, starts: Array.from(n.data.slice(0, k)), field: plain(x.field), data: x.got.map((g) => g.data) },
    });
    learned.evidence = [`The device sends ${label} by itself: a report starting ${hexOf(n.data.slice(0, k))}${n.reportId ? ` (report ${n.reportId})` : ''}, ${label} in ${where(x.field)}${x.field.codes ? `, one code per value (${x.field.codes.map((c, i) => `${show(values[i])} = ${hexOf([c])}`).join(', ')})` : howScaled(x.field) ? ` as the number${howScaled(x.field)}` : ''}.`,
      'DeviceHub listens for it; it never asks for it.'];
    learned.bytes = x.got.map((g) => hexOf(g.data));
  }
  learned.evidence.push(one ? `Seen at ${shown}.` : `Seen for every value: ${shown}.`, 'Nothing is ever written for it.');
  learned.at = { offset: x.field.offset, size: x.field.size };
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
// A reading (kind 'reading') adds no message to write: a display setting, the battery (battery.percent) or its
// charging flag (battery.charging; a display when no battery level was learned), read from its request's reply or
// heard as a notice. A setting's keep lists only the other SETTINGS: readings move by themselves.
export function buildDriver(draft, { date = new Date() } = {}) {
  const ls = draft.settings || [];
  if (!ls.length) throw new Error('learn at least one setting first');
  const sets = ls.filter((s) => s.kind !== 'reading');
  const asked = ls.filter((s) => s.transport);
  const heard = ls.filter((s) => s.notice);
  const t0 = asked[0]?.transport || null, cs = sets[0]?.checksum || null;
  for (const s of asked) {
    if (s.transport.report !== t0.report || s.transport.len !== t0.len) throw new Error(`${s.label} goes over ${s.transport.report} reports of ${s.transport.len} bytes and ${asked[0].label} over ${t0.report} reports of ${t0.len}: one driver.json uses one kind of report`);
  }
  for (const s of sets) if (!same(s.checksum, cs)) throw new Error(`${s.label} and ${sets[0].label} use different checksums: one driver.json uses one`);
  if (ls.filter((s) => s.role === 'battery').length > 1) throw new Error('The battery level is learned twice: keep one.');
  if (ls.filter((s) => s.role === 'charging').length > 1) throw new Error('Charging is learned twice: keep one.');
  const tr = t0 || { report: 'output', len: heard[0].notice.len, reportId: heard[0].notice.reportId || 0 };
  const vid = up4(draft.vid), pid = up4(draft.pid);
  const title = String(draft.title || draft.product || `USB device ${vid}:${pid}`).trim().slice(0, 60);
  let id = slug(title);
  if (!/^[a-z]/.test(id)) id = `dev-${id}`.slice(0, 31).replace(/-+$/, '');
  if (id.length < 2 || ['mouse', 'headset', 'keyboard'].includes(id)) id = `learned-${vid.toLowerCase()}-${pid.toLowerCase()}`;
  // replies are checked against the checksum only when every reply recorded holds it (the readings' replies too)
  const replyCs = !!cs && sets.every((s) => s.replyChecksum) && asked.filter((s) => s.kind === 'reading').every((s) => s.read.replies.every((r) => csHolds(r, cs)));
  const def = {
    format: 1, id, title, kind: draft.kind || 'Device',
    about: `Learned with DeviceHub's learning wizard on ${date.toISOString().slice(0, 10)} from what the maker's app sent while one setting at a time was changed. Every byte in "messages" was seen in those recordings.`,
    vid, pids: [pid],
    hid: { vid, pid, ...(draft.usagePage ? { page: up4(draft.usagePage) } : {}), ...(draft.usage ? { usage: up4(draft.usage) } : {}), len: tr.len, reportId: tr.reportId, ...(heard.length ? { reply: 'raw' } : {}) },
    transport: { report: tr.report, len: tr.len, reportId: tr.reportId, ...(draft.usagePage ? { usagePage: up4(draft.usagePage) } : {}), timeoutMs: 1000, tries: 2, ...(cs ? { checksum: cs } : {}) },
    links: { usb: { label: 'USB', wireless: false } },
    models: [{ key: 'learned', name: title, pids: { usb: [pid] } }],
    ...(asked.length ? { replies: { echo: Array.from({ length: Math.min(...asked.map((s) => s.echo)) }, (_, i) => i), ...(replyCs ? { checksum: true } : {}) } } : {}),
    messages: {}, reads: [], fields: {}, settings: [], unsupported: [],
  };
  const keys = sets.map((s) => s.key);
  const fieldOf = (rn, f, s) => (f.codes
    ? { from: rn, offset: f.offset, map: Object.fromEntries(f.codes.map((c, i) => [String(c), s.kind === 'toggle' ? s.values[i] === true : s.values[i]])) }
    : { from: rn, offset: f.offset, ...(f.size > 1 ? { size: f.size, endian: f.endian || 'little' } : {}), ...(f.scale !== 1 ? { scale: f.scale } : {}), ...(f.add ? { add: f.add } : {}) });
  const askRead = (s) => {
    const rb = template(s.read.data, null, cs);
    let rn = Object.keys(def.messages).find((n) => n.startsWith('read') && def.messages[n].bytes === rb && (def.messages[n].reportId ?? tr.reportId) === s.read.reportId);
    if (!rn) {
      rn = `read${def.reads.length + 1}`;
      def.messages[rn] = { bytes: rb, ...(s.read.reportId !== tr.reportId ? { reportId: s.read.reportId } : {}) };
      def.reads.push({ name: rn, message: rn });
    }
    return rn;
  };
  const hearRead = (s) => {
    const n = s.notice, starts = hexOf(n.starts);
    let rd = def.reads.find((r) => r.notice && r.notice.starts === starts && (r.notice.reportId || 0) === (n.reportId || 0) && r.notice.len === n.len);
    if (!rd) { rd = { name: `notice${def.reads.filter((r) => r.notice).length + 1}`, notice: { ...(n.reportId ? { reportId: n.reportId } : {}), starts, len: n.len } }; def.reads.push(rd); }
    return rd.name;
  };
  let charging = null;
  for (const s of ls) {
    if (s.kind === 'reading') {
      const rn = s.read ? askRead(s) : hearRead(s);
      const f = (s.read || s.notice).field;
      def.fields[s.key] = fieldOf(rn, f, { kind: s.valueKind, values: s.values });
      if (s.role === 'battery') def.battery = { from: rn, percent: s.key };
      else if (s.role === 'charging') charging = s;
      else def.settings.push({ key: s.key, label: s.label, type: 'display', ...(s.unit ? { unit: s.unit.startsWith(' ') ? s.unit : ` ${s.unit}` } : {}) });
      continue;
    }
    const rn = askRead(s);
    const f = s.read.field;
    def.fields[s.key] = fieldOf(rn, f, s);
    const wn = `set${s.key[0].toUpperCase()}${s.key.slice(1)}`;
    const e = s.write.enc;
    def.messages[wn] = { bytes: template(s.write.data[0], e, cs), ...(s.write.reportId !== tr.reportId ? { reportId: s.write.reportId } : {}) };
    const write = { message: wn, keep: keys.filter((k) => k !== s.key) };
    if (!write.keep.length) delete write.keep;
    if (e.codes && !same(e.codes, f.codes)) write.encode = { map: Object.fromEntries(e.codes.map((c, i) => [String(s.values[i]), c])) };
    const st = { key: s.key, label: s.label, type: s.kind === 'number' ? 'slider' : s.kind, write };
    if (s.kind === 'number') Object.assign(st, { min: s.min, max: s.max, step: s.step || 1 });
    if (s.kind === 'choice') st.options = s.values.map((v) => ({ value: v, label: String(v) }));
    if (s.unit) st.unit = s.unit.startsWith(' ') ? s.unit : ` ${s.unit}`;
    def.settings.push(st);
  }
  if (charging) {
    if (def.battery) def.battery.charging = charging.key;
    else def.settings.push({ key: charging.key, label: charging.label, type: 'display' });
  }
  if (!Object.keys(def.messages).length) delete def.messages;
  return def;
}

// every captured message, rebuilt by the driver itself (declarative-driver's build, the only way it sends bytes), must
// come out byte for byte the same, and every recorded reply or notice must read back as the value recorded: [] or the
// sentences that say what would differ. pid: check the driver as it is on that product id (byPid).
export function verifySeen(def, settings, { pid = null } = {}) {
  const problems = [];
  let drv;
  try { drv = fromJson(def); } catch (e) { return [e.message]; }
  if (pid) drv.usePid(pid);
  const len = forPid(def, pid || def.pids[0]).transport.len;
  const pad = (d) => { const a = new Uint8Array(len); a.set(d.slice(0, len)); return a; };
  const fdef = forPid(def, pid || def.pids[0]).fields;
  const readsAs = (rn, data, key) => drv.fieldsOf({ [rn]: Uint8Array.from(data) }).values[key];
  const sameValue = (a, b) => (typeof a === 'number' && typeof b === 'number' ? near(a, b) : same(a, b));
  for (const s of settings) {
    const rn = fdef[s.key]?.from;
    if (!rn) { problems.push(`${s.label}: it is not in the driver`); continue; }
    if (s.read) {
      try {
        const b = drv.build(rn);
        if (hexOf(b.data) !== hexOf(pad(s.read.data)) || b.reportId !== s.read.reportId) problems.push(`${s.label}: the read it would send is not the one recorded`);
      } catch (e) { problems.push(`${s.label}: its read cannot be built (${e.message})`); }
    }
    if (s.kind === 'reading') {
      const datas = s.read ? s.read.replies : s.notice.data;
      s.values.forEach((v, i) => { const got = readsAs(rn, datas[i], s.key); if (!sameValue(got, v)) problems.push(`${s.label}: what was recorded at ${show(v)} would read ${got === undefined ? 'nothing' : show(got)}`); });
      continue;
    }
    const st = def.settings.find((x) => x.key === s.key);
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
  // a field may not take a name driver.json keeps for itself
  const s = { ...learned, key: settingKey(learned.label, [...taken, 'model', 'link', 'probe', 'value', 'zone', 'button']) };
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

// ---------------------------------------------------------------- a device that already has a driver
// Chip makers' vendor ids that many brands share, where a wrong write has bricked devices: never learned
// (docs/brands/glorious.md: OpenRGB turned off its Sinowealth keyboard detection after writes bricked Redragon
// keyboards on the same ids; mxw's author bricked mice "repeatedly"; Laview 22d4 is the other chip Glorious ships on)
export const SHARED_CHIPS = { '258A': 'Sinowealth', '22D4': 'Laview' };
let neverList = null;
const refusedVendors = () => {
  if (!neverList) { try { neverList = JSON.parse(fs.readFileSync(path.join(HERE, 'never-commands.json'), 'utf8')).refuseVendors || []; } catch { neverList = []; } }
  return neverList;
};
// why this vendor id is never learned, or null
export function vendorRefusal(vid) {
  const v = up4(vid);
  if (SHARED_CHIPS[v]) return `USB vendor ${v} is the ${SHARED_CHIPS[v]} chip maker's id, which many brands share. A wrong write to a device on it has bricked mice and keyboards, so DeviceHub never learns one. Use the maker's app for its settings.`;
  const r = refusedVendors().find((x) => up4(x.vid) === v);
  if (r) return `${r.brand} devices cannot be learned: their settings are reached through numbers the device hands out while it runs, so a recorded message cannot be proven safe. ${r.brand} drivers are written as code instead.`;
  return null;
}

// how many settings a driver can write, loaded the way my-devices.mjs loads it (cached per file and change time)
const writesCache = new Map();
async function writableCount(dir) {
  const file = driverFileOf(dir);
  if (!file) return 0;
  let key = dir;
  try { key = `${dir}|${fs.statSync(path.join(dir, file)).mtimeMs}`; } catch {}
  if (!writesCache.has(key)) {
    let n = 0;
    try { const { a } = await loadDriver(dir, 'learn'); n = (Array.isArray(a?.settings) ? a.settings : []).filter((s) => writable(s) && !s.readOnly && s.selfCheck !== false).length; } catch { n = 0; }
    writesCache.set(key, n);
  }
  return writesCache.get(key);
}

// the driver a listed device already has: { name, where: 'my-devices' | 'library', dir, code, writes, title } or null
async function driverFor(k, own, root) {
  const copy = (own.copies || []).find((c) => c.ids.includes(k));
  if (copy) {
    const dir = path.join(root, 'my-devices', copy.name);
    return { name: copy.name, where: 'my-devices', dir, code: driverFileOf(dir) === 'device.mjs', writes: await writableCount(dir), learned: !!libraryMark(dir)?.learned };
  }
  const [vid, pid] = k.split(':');
  let m = null;
  try { m = libraryMatch([{ vid, pid }], { root, readOnly: true, untested: true }).find((x) => !x.installed) || null; } catch {}
  if (!m) return null;
  const e = libraryList({ root }).find((x) => x.name === m.name);
  if (!e) return null;
  return { name: m.name, where: 'library', dir: e.dir, code: driverFileOf(e.dir) === 'device.mjs', writes: await writableCount(e.dir), status: m.meta.status };
}
// the note a listed device shows, and why it cannot be picked (or null)
function coverageNote(d) {
  const drv = d.driver;
  if (d.refused) return d.refused;
  if (!drv) return null;
  return 'already has a driver; Learn adds settings it lacks';
}
function coverageRefusal(drv) {
  if (!drv) return null;
  // a driver the wizard made may hold only readings: more can still be learned into it
  if (!drv.writes && !drv.learned) return `Its driver (${drv.name}) refuses every write on purpose, so DeviceHub does not learn settings for it either. Use the maker's app for its settings.`;
  if (drv.code) return `It already has a driver written as code (${drv.name}, device.mjs). Learned settings can only be added to a driver.json driver, so this one is not learned here.`;
  return null;
}

// The learned settings added to a copy of the driver a device already has: the base driver.json with the learned
// driver's messages (renamed "learned..."), reads, fields and settings. Throws a plain sentence when they cannot share
// one file (another report kind, checksum or reply matching, or a setting key already there).
export function mergeDriver(base, add) {
  const tb = base.transport || {}, ta = add.transport || {};
  // only heard notices (nothing sent): the report kind, checksum and reply matching do not come into it
  const sends = Object.keys(add.messages || {}).length > 0;
  if (sends && (tb.report !== ta.report || tb.len !== ta.len || (tb.reportId || 0) !== (ta.reportId || 0))) throw new Error(`The driver it has talks over ${tb.report} reports of ${tb.len} bytes (id ${tb.reportId || 0}) and the recording over ${ta.report} reports of ${ta.len} bytes (id ${ta.reportId || 0}): one driver.json uses one kind, so the setting was not added.`);
  if (sends && Object.keys(add.fields || {}).some((k) => (add.settings || []).some((s) => s.key === k && s.write)) && !same(tb.checksum || null, ta.checksum || null)) throw new Error('The driver it has and the recording use different checksums, so the setting was not added.');
  const echo = base.replies?.echo || [], n = (add.replies?.echo || []).length;
  if (sends && echo.some((i) => i >= n)) throw new Error('The driver it has matches replies on more bytes than the device repeated in the recording, so the setting was not added.');
  if (add.battery && base.battery) throw new Error('The driver it has reads the battery already, so the battery level was not added.');
  if ((add.reads || []).some((r) => r.notice) && base.hid && base.hid.reply !== 'raw') throw new Error('The driver it has does not listen to what the device sends by itself, so that reading was not added.');
  const out = JSON.parse(JSON.stringify(base));
  out.messages = out.messages || {}; out.reads = out.reads || []; out.fields = out.fields || {}; out.settings = out.settings || [];
  const ren = {};
  for (const [name, m] of Object.entries(add.messages || {})) {
    let nn = `learned${name[0].toUpperCase()}${name.slice(1)}`, i = 2;
    while (out.messages[nn] || out.reads.some((r) => r.name === nn)) nn = `learned${name[0].toUpperCase()}${name.slice(1)}${i++}`;
    ren[name] = nn; out.messages[nn] = m;
  }
  for (const r of add.reads || []) {
    if (r.notice) {
      const cap = `learned${r.name[0].toUpperCase()}${r.name.slice(1)}`;
      let nn = cap, i = 2;
      while (out.messages[nn] || out.reads.some((x) => x.name === nn)) nn = `${cap}${i++}`;
      ren[r.name] = nn; out.reads.push({ ...r, name: nn });
      continue;
    }
    out.reads.push({ ...r, name: ren[r.name] || r.name, message: ren[r.message] || r.message });
  }
  for (const [k, fl] of Object.entries(add.fields || {})) {
    if (out.fields[k] || out.settings.some((s) => s.key === k)) throw new Error(`The driver it has already has a setting called "${k}".`);
    out.fields[k] = { ...fl, from: ren[fl.from] || fl.from };
  }
  for (const s of add.settings || []) out.settings.push(s.write ? { ...s, write: { ...s.write, message: ren[s.write.message] || s.write.message } } : { ...s });
  if (add.battery) out.battery = { ...add.battery, from: ren[add.battery.from] || add.battery.from };
  const labels = [...(add.settings || []).map((s) => s.label), ...(add.battery ? ['battery'] : [])].join(', ');
  out.about = `${String(base.about || '').trim()} Added on this PC with DeviceHub's learning wizard: ${labels} (every byte of those seen in its recordings).`.trim();
  return out;
}

// writes a merged driver.json into a my-devices copy: its driver.json and library.json backed up to backups\ first,
// then replaced (temp file, then rename); library.json gets learnedKeys. Never anywhere but my-devices.
export function saveInto(folder, def, keys, { root = ROOT, now = () => new Date() } = {}) {
  const dir = path.resolve(folder);
  if (path.dirname(dir) !== path.resolve(root, 'my-devices')) return { ok: false, why: ['only a driver in my-devices can take learned settings'] };
  const v = validate(def);
  if (!v.ok) return { ok: false, why: v.problems };
  const mark = libraryMark(dir);
  if (!mark || !fs.existsSync(path.join(dir, 'driver.json'))) return { ok: false, why: ['that folder has no driver.json from the library or the wizard'] };
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const back = path.join(root, 'backups', `learn-${path.basename(dir)}-${stamp}`);
  fs.mkdirSync(back, { recursive: true });
  for (const x of ['driver.json', LIBRARY_FILE]) fs.copyFileSync(path.join(dir, x), path.join(back, x), fs.constants.COPYFILE_EXCL);
  const put = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(`${p}.tmp`, text); fs.renameSync(`${p}.tmp`, p); };
  put('driver.json', JSON.stringify(def, null, 2) + '\n');
  put(LIBRARY_FILE, JSON.stringify({ ...mark, learnedKeys: [...new Set([...(mark.learnedKeys || []), ...keys])], learnedAt: now().toISOString() }, null, 2) + '\n');
  return { ok: true, name: path.basename(dir), folder: dir, id: def.id, backup: back };
}

// ---------------------------------------------------------------- the same device on its other USB id (22 Oct 2026)
// Many devices are one USB id on the cable and another on the receiver. base: the driver the wizard saved; other: the
// driver built from the same settings learned again on the other id (same keys, values and ranges, same order).
// Same bytes: the id is added (pids, a link for it, hid.pids, and hid.byPid when its collection differs).
// Different bytes: the same, plus byPid[pid] in the file: that id's own transport, replies, messages, fields, notices
// and codes (docs/DRIVER-FORMAT.md). Throws a plain sentence when the two cannot be one driver.
export function addPid(base, other, { pid, link = 'cable' } = {}) {
  pid = up4(pid);
  if ((base.pids || []).map(up4).includes(pid)) throw new Error(`USB id ${pid} is in this driver already.`);
  if (up4(base.vid) !== up4(other.vid)) throw new Error('That is another maker\'s device (another USB vendor id), so it cannot share this driver.');
  const names = (o) => Object.keys(o || {}).sort().join();
  const readsOf = (d) => (d.reads || []).map((r) => `${r.name}:${r.notice ? 'notice' : r.message}`).sort().join();
  if (names(base.messages) !== names(other.messages) || readsOf(base) !== readsOf(other) || names(base.fields) !== names(other.fields)) {
    throw new Error('On this id the device is read in another way (other requests or reports), which one driver cannot hold. Learn it as its own device instead.');
  }
  const noEnc = (s) => (s.write ? { ...s, write: { ...s.write, encode: undefined } } : s);
  if (!same(base.settings.map(noEnc), other.settings.map(noEnc)) || !same(base.battery || null, other.battery || null)) {
    throw new Error('On this id the settings came out different (another kind, range or choice), so the id was not added. Learn the same settings, with the same choices, on it.');
  }
  const tOf = (t) => { const { usagePage, ...r } = t || {}; return r; };
  const noticesOf = (d) => Object.fromEntries((d.reads || []).filter((r) => r.notice).map((r) => [r.name, r.notice]));
  const encOf = (d) => Object.fromEntries(d.settings.filter((s) => s.write?.encode).map((s) => [s.key, s.write.encode]));
  const sameBytes = same(tOf(base.transport), tOf(other.transport)) && same(base.replies || null, other.replies || null) && same(base.messages || {}, other.messages || {})
    && same(base.fields, other.fields) && same(noticesOf(base), noticesOf(other)) && same(encOf(base), encOf(other));
  const out = JSON.parse(JSON.stringify(base));
  const ln0 = link === 'receiver' ? 'receiver' : 'cable';
  let ln = ln0, i = 2;
  while (out.links[ln]) ln = `${ln0}${i++}`;
  const page = other.transport.usagePage ?? null, page0 = base.transport.usagePage ?? null;
  out.links[ln] = { label: link === 'receiver' ? 'USB receiver' : 'USB cable', wireless: link === 'receiver', ...(page !== page0 ? { usagePage: page } : {}) };
  out.pids = [...out.pids, pid];
  out.models[0].pids[ln] = [pid];
  // the channel: one per id (helpers/my-devices.mjs hidSpecs), with this id's collection where it differs
  const h0 = out.hid, h1 = other.hid, diff = {};
  for (const k of ['page', 'usage', 'len', 'reportId', 'reply']) if (!same(h0[k] ?? null, h1[k] ?? null)) diff[k] = h1[k] ?? null;
  const byPidHid = { ...(h0.byPid || {}), ...(Object.keys(diff).length ? { [pid]: diff } : {}) };
  out.hid = { ...h0, pids: [...new Set([...(h0.pids || [h0.pid]).map(up4), pid])], ...(Object.keys(byPidHid).length ? { byPid: byPidHid } : {}) };
  if (!sameBytes) {
    const o = { transport: tOf(other.transport), ...(other.replies ? { replies: other.replies } : {}), ...(other.messages ? { messages: other.messages } : {}), fields: other.fields };
    const nz = noticesOf(other);
    if (Object.keys(nz).length) o.notices = nz;
    // codes: this id's own, and where the first id needed a code list and this one does not, the list its reads give
    const en = encOf(other);
    for (const k of Object.keys(encOf(base))) if (!en[k] && other.fields[k]?.map) en[k] = { map: Object.fromEntries(Object.entries(other.fields[k].map).map(([c, v]) => [String(v), Number(c)])) };
    if (Object.keys(en).length) o.encode = en;
    out.byPid = { ...(out.byPid || {}), [pid]: o };
  }
  out.about = `${String(base.about || '').trim()} Also learned on USB id ${pid} (${link === 'receiver' ? 'receiver' : 'cable'})${sameBytes ? ', where the device takes the same bytes' : ', with its own bytes under byPid'}.`.trim();
  return { def: out, same: sameBytes, link: ln };
}

// the collection a notice arrives on (its report id and length), vendor pages first
export function collectionForNotice(device, n) {
  const cols = (device?.collections || []).slice().sort((a, b) => (parseInt(b.page, 16) >= 0xff00) - (parseInt(a.page, 16) >= 0xff00));
  const fits = (c) => c.inLen - 1 === n.len;   // Windows counts the report id byte in every length
  return cols.find((c) => fits(c) && (n.reportId ? (c.inIds || []).includes(n.reportId) : !(c.inIds || []).some((x) => x))) || cols.find(fits) || null;
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
  // the ids DeviceHub already runs: its own drivers (pc-map RUNS), the person's own my-devices drivers (mine, hidden),
  // and the copies from the library or the wizard (copies: [{ name, ids }], listed: Learn can add to them)
  owned(root) {
    let runs = [];
    try { runs = Object.keys(require('./pc-map.js').RUNS || {}); } catch {}
    const mine = [], copies = [];
    const dir = path.join(root, 'my-devices');
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch {}
    for (const n of names) {
      const ids = [];
      for (const f of ['driver.json', 'device.json']) {
        const j = readJson(path.join(dir, n, f));
        if (j?.vid) for (const p of [].concat(j.pids || [])) ids.push(`${up4(j.vid)}:${up4(p)}`);
      }
      try { const t = fs.readFileSync(path.join(dir, n, 'device.mjs'), 'utf8'); const v = /vid:\s*'([0-9A-Fa-f]{4})'/.exec(t); for (const m of t.matchAll(/pid:\s*'([0-9A-Fa-f]{4})'/g)) if (v) ids.push(`${up4(v[1])}:${up4(m[1])}`); } catch {}
      if (fs.existsSync(path.join(dir, n, LIBRARY_FILE))) copies.push({ name: n, ids: [...new Set(ids)] });
      else mine.push(...ids);
    }
    return { runs: runs.map((k) => k.split(':').map(up4).join(':')), mine, copies };
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
  // the maker's app and the tick-list for a listed device (helpers/learn-apps.mjs; read-only)
  plan: (dev, root) => makePlan(dev, { root }),
  // helpers/app-ui.ps1 with these arguments: { code, out } (only get and set are ever asked for, on the ticked setting)
  appUi: (args) => runAppUi(args),
};
// driving the maker's app: how long the listener records before the change, and after it (the app sends a moment later)
export const DRIVE = { leadMs: 800, settleMs: 1500 };
export const options = { root: ROOT, deps };

// ---------------------------------------------------------------- the session (one at a time)
let session = null;
let listed = [];
// the driver saved last (made fresh by the wizard, not added to another): it can then be learned on its other USB id
let lastSaved = null;
export const current = () => session;
export function reset() { session = null; listed = []; lastSaved = null; }

async function listDevices() {
  const { root, deps: d } = options;
  const own = d.owned(root);
  let library = [];
  const json = await d.listHid();
  const raw = groupDevices(json, { ...own });
  try { library = libraryMatch(raw.map((x) => ({ vid: x.vid, pid: x.pid })), { root, readOnly: true, untested: true }).flatMap((m) => m.matched.map((u) => `${up4(u.vid)}:${up4(u.pid)}`)); } catch {}
  for (const c of own.copies || []) library.push(...c.ids);
  listed = groupDevices(json, { runs: own.runs, mine: own.mine, library });
  for (const d of listed) {
    d.refused = vendorRefusal(d.vid);
    if (d.library) {
      d.driver = await driverFor(`${d.vid}:${d.pid}`, own, root);
      d.refused = d.refused || coverageRefusal(d.driver);
    }
    d.note = coverageNote(d);
  }
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

// the setting the second-id session records next (the saved driver's own, in its order)
const nextOf = (sec) => sec.orig[session.learned.length] || null;

function summary() {
  if (!session) return { active: false };
  const st = session.listening ? options.deps.readState(session.dir) : null;
  const sec = session.second;
  return {
    active: true,
    device: { vid: session.device.vid, pid: session.device.pid, name: session.device.name },
    addsTo: session.base ? { name: session.base.name, where: session.base.where, note: 'already has a driver; Learn adds settings it lacks' } : null,
    listener: !session.listening ? 'off' : !st ? 'waiting' : st.status,
    listenerError: st?.error || null,
    setting: session.setting,
    takes: session.takes.map((t) => ({ value: t.value, heard: t.messages.length })),
    recording: session.recording || null,
    learned: session.learned.map((s) => ({ key: s.key, label: s.label, kind: s.kind, role: s.role || null, min: s.min, max: s.max, step: s.step, unit: s.unit, values: s.values })),
    second: sec ? { of: sec.name, pid: sec.def.pids[0], link: sec.link, total: sec.orig.length, done: session.learned.length,
      next: nextOf(sec) ? { label: nextOf(sec).label, kind: nextOf(sec).kind, role: nextOf(sec).role || null, values: nextOf(sec).values, fixed: fixedValues(nextOf(sec)) } : null } : null,
    saved: session.saved || null,
    maker: session.plan?.maker || null,
  };
}

const clean = (s, max = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const onOff = (v) => (v === true || v === 'on' || v === 'true' ? true : v === false || v === 'off' || v === 'false' ? false : undefined);
// a value as the person typed it; a reading's by its role (battery: a percent; charging: on/off; else a number or a word)
function parseValue(kind, v, { role = null, numbers = null } = {}) {
  if (kind === 'number') { const n = Number(String(v).trim()); return String(v).trim() !== '' && Number.isFinite(n) ? n : undefined; }
  if (kind === 'toggle') return onOff(v);
  if (kind === 'reading') {
    if (role === 'battery') { const n = Number(String(v).trim().replace(/%$/, '')); return String(v).trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined; }
    if (role === 'charging') return onOff(v);
    if (numbers) return parseValue('number', v);
  }
  const s = clean(v, 30);
  return s || undefined;
}
// a second-id session keeps the first id's choices and words (they are part of the driver); numbers may be new
const fixedValues = (s) => !(s.kind === 'number' || (s.kind === 'reading' && (s.role === 'battery' || s.valueKind === 'number')));
const noticeOf = (learned) => learned.find((s) => s.notice)?.notice || null;

export async function act(name, b = {}) {
  const { root, deps: d } = options;
  if (name === 'begin' || name === 'second') {
    const dev = listed.find((x) => x.vid === up4(b.vid) && x.pid === up4(b.pid));
    if (!dev) return { ok: false, error: 'That device is not in the list: look again.' };
    let base = null, second = null;
    if (name === 'second') {
      // the same device on its other USB id: only after a driver the wizard made is saved
      if (!lastSaved) return { ok: false, error: 'Save a driver first. Then it can be learned on its other USB id.' };
      if (dev.vid !== up4(lastSaved.def.vid)) return { ok: false, error: 'That is another maker\'s device. Pick the same device, plugged in the other way.' };
      if (lastSaved.def.pids.map(up4).includes(dev.pid)) return { ok: false, error: 'That is the USB id it was learned on. Plug it in the other way (cable or receiver), then look again.' };
      const vr = vendorRefusal(dev.vid);
      if (vr) return { ok: false, error: vr };
      second = { ...lastSaved, link: b.link === 'receiver' ? 'receiver' : 'cable' };
    } else {
      if (dev.refused) return { ok: false, error: dev.refused };
      // a device with a driver.json driver already: the learned settings go into its my-devices copy
      if (dev.driver) {
        const def = readJson(path.join(dev.driver.dir, 'driver.json'));
        if (!def) return { ok: false, error: `Its driver (${dev.driver.name}) could not be read, so nothing can be added to it.` };
        base = { ...dev.driver, def };
      }
    }
    if (session?.listening) await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {});
    const id = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${dev.vid}-${dev.pid}`.toLowerCase();
    const dir = path.join(root, 'learn', 'wizard', id);
    fs.mkdirSync(dir, { recursive: true });
    session = { id, dir, device: dev, base, second, setting: null, takes: [], learned: [], listening: false, seq: 0 };
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
    const sec = session.second, cur = sec ? nextOf(sec) : null;
    if (sec && !cur) return { ok: false, error: 'Every setting is learned on this id: add it to the driver.' };
    // on the second id the setting is the saved driver's own; only the values may be new (numbers and percents)
    const kind = cur ? cur.kind : ['number', 'toggle', 'choice', 'reading'].includes(b.kind) ? b.kind : 'number';
    const role = cur ? cur.role || null : kind === 'reading' ? (READING_ROLES.includes(b.role) ? b.role : 'display') : null;
    const label = cur ? cur.label : clean(b.label, 40) || (role === 'battery' ? 'Battery' : role === 'charging' ? 'Charging' : '');
    if (!label) return { ok: false, error: kind === 'reading' ? 'Name the reading first (for example ChatMix).' : 'Name the setting first (for example DPI).' };
    if (/firmware|bootloader|dfu|flash|factory|reset|pair/i.test(label)) return { ok: false, error: 'DeviceHub never learns firmware, reset, flash or pairing controls.' };
    let raw = Array.isArray(b.values) ? b.values.filter((v) => String(v ?? '').trim() !== '') : [];
    if (cur && (fixedValues(cur) || !raw.length)) raw = cur.values;
    if (kind === 'reading' && role === 'charging' && !raw.length) raw = [true, false];
    const numbers = kind === 'reading' && role === 'display' && (cur ? cur.valueKind === 'number' : raw.every((v) => parseValue('number', v) !== undefined));
    const values = raw.map((v) => parseValue(kind, v, { role, numbers }));
    const need = kind === 'reading' && role === 'battery' ? 1 : 2;
    if (values.length < need || values.some((v) => v === undefined)) {
      return { ok: false, error: kind === 'number' ? 'Give two numbers.' : kind === 'toggle' ? 'Give on and off.' : kind === 'choice' ? 'Give two choices as the app names them.'
        : role === 'battery' ? 'Give the percent the maker\'s app shows now (0 to 100).' : role === 'charging' ? 'Give charging and not charging.' : 'Give two values the maker\'s app shows for it (numbers or words).' };
    }
    if (new Set(values.map((v) => JSON.stringify(v))).size !== values.length) return { ok: false, error: 'The two values must be different.' };
    session.setting = { label, kind, unit: cur ? cur.unit || '' : clean(b.unit, 10), values, ...(role ? { role, numbers } : {}) };
    session.takes = [];
    return { ok: true, ...summary() };
  }
  if (name === 'record') {
    if (!session.setting) return { ok: false, error: 'Say which setting first.' };
    const set = session.setting;
    let value = set.values[session.takes.length];
    if (b.value !== undefined) value = parseValue(set.kind, b.value, { role: set.role, numbers: set.numbers });
    if (value === undefined) return { ok: false, error: set.role === 'battery' ? 'Which percent does the maker\'s app show now?' : 'Which value?' };
    const s = await startTake(value);
    return s.ok ? { ok: true, ...summary() } : s;
  }
  if (name === 'stop') {
    const s = await stopTake();
    return s.ok ? { ok: true, heard: s.heard, ...summary() } : s;
  }
  if (name === 'plan') {
    // the maker's app (installed, running) and the tick-list of settings to learn, once per session
    if (!session.plan || b.again) session.plan = await d.plan(session.device, root);
    return { ok: true, ...session.plan, ...summary() };
  }
  if (name === 'drive') return drive();
  if (name === 'analyze') {
    const reading = session.setting?.kind === 'reading';
    const r = reading ? analyzeReading(session.takes, session.setting) : analyze(session.takes, session.setting);
    session.analysis = r.ok ? r.learned : null;
    if (!r.ok) return { ok: false, why: r.why, ambiguous: !!r.ambiguous, needMore: !!r.needMore };
    const l = r.learned;
    if (reading) return { ok: true, evidence: l.evidence, writeBytes: l.bytes, valueAt: l.at, kind: 'reading', role: l.role, range: null };
    const e = l.write.enc;
    return { ok: true, evidence: l.evidence, writeBytes: l.writeBytes, valueAt: { offset: e.offset, size: e.size }, kind: l.kind,
      range: l.kind === 'number' ? { min: Math.min(...l.values), max: Math.max(...l.values), step: Number.isInteger(e.scale) ? e.scale : 1 } : null };
  }
  if (name === 'add') {
    if (!session.analysis) return { ok: false, error: 'Nothing learned yet.' };
    const sec = session.second;
    if (sec) {
      // the saved driver's own key and range; checked together once every setting is learned on this id
      const cur = nextOf(sec);
      const r = withRange(session.analysis, cur.kind === 'number' ? { min: cur.min, max: cur.max, step: cur.step } : {});
      if (!r.setting) return { ok: false, why: [r.why] };
      session.learned = [...session.learned, { ...r.setting, key: cur.key }];
      session.analysis = null; session.setting = null; session.takes = [];
      return { ok: true, ...summary() };
    }
    const role = session.analysis.role;
    if (role === 'battery' && (session.learned.some((s) => s.role === 'battery') || session.base?.def?.battery)) return { ok: false, why: ['The battery level is learned already. Remove the other one first.'] };
    if (role === 'charging' && session.learned.some((s) => s.role === 'charging')) return { ok: false, why: ['Charging is learned already. Remove the other one first.'] };
    const r = withRange(session.analysis, b, [...session.learned.map((s) => s.key), ...(session.base?.def?.settings || []).map((s) => s.key), ...Object.keys(session.base?.def?.fields || {})]);
    if (!r.setting) return { ok: false, why: [r.why] };
    const all = [...session.learned, r.setting];
    const out = draftCheck(all, b);
    if (!out.ok) return out;
    session.learned = all; session.analysis = null; session.setting = null; session.takes = [];
    return { ok: true, driver: out.driver, ...summary() };
  }
  if (name === 'remove') {
    session.learned = session.second ? session.learned.slice(0, -1) : session.learned.filter((s) => s.key !== b.key);
    return { ok: true, ...summary() };
  }
  if (name === 'preview') {
    if (!session.learned.length) return { ok: false, error: 'Learn at least one setting first.' };
    return session.second ? secondCheck() : draftCheck(session.learned, b);
  }
  if (name === 'save') {
    if (!session.learned.length) return { ok: false, error: 'Learn at least one setting first.' };
    if (session.second) {
      const sec = session.second;
      const c = secondCheck();
      if (!c.ok) return c;
      const r = saveInto(sec.folder, c.driver, [], { root });
      if (!r.ok) return { ok: false, why: r.why };
      const dev = session.device;
      lastSaved = { ...sec, def: c.driver };
      session.saved = { name: r.name, id: r.id, second: true, same: c.same, pid: dev.pid, canSecond: true,
        note: `${c.same ? `The device takes the same bytes on USB ${dev.vid}:${dev.pid}, so that id was added to the driver.` : `The device takes other bytes on USB ${dev.vid}:${dev.pid}, so the driver keeps its own copy of them for that id.`} Restart DeviceHub to use it there. Each setting stays read-only until you press Turn on settings on its page and it passes its check.` };
      if (session.listening) { await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {}); session.listening = false; }
      return { ok: true, ...summary() };
    }
    const c = draftCheck(session.learned, b);
    if (!c.ok) return c;
    if (session.base) {
      // into the my-devices copy (installed from the library first when it is not there yet); never the library's own
      const keys = session.learned.map((s) => s.key);
      let folder = session.base.where === 'my-devices' ? session.base.dir : null;
      if (!folder) {
        const inst = await installFromLibrary(session.base.name, { root, readOnly: true, untested: true });
        if (!inst.ok) return { ok: false, why: [`Its library driver could not be copied to my-devices: ${inst.error}`] };
        folder = inst.to;
      }
      const r = saveInto(folder, c.driver, keys, { root });
      if (!r.ok) return { ok: false, why: r.why };
      let loaded = null;
      if (session.base.where !== 'my-devices') { try { loaded = await d.loadNew(root); } catch {} }
      lastSaved = null;
      session.saved = { name: r.name, id: r.id, added: keys, into: session.base.name, loaded: !!loaded?.some((x) => x.name === r.name && x.id),
        note: session.base.where === 'my-devices' ? 'Added to the driver it already had. Restart DeviceHub to load the new settings; each stays read-only until you press Turn on settings and it passes its check.' : 'Added to a copy of its library driver. Each new setting stays read-only until you press Turn on settings and it passes its check.' };
      if (session.listening) { await command(session.dir, 'quit', null, 'ended', 3000).catch(() => {}); session.listening = false; }
      return { ok: true, ...summary() };
    }
    const r = saveDriver(c.driver, { root, folder: b.title });
    if (!r.ok) return { ok: false, why: r.why };
    let loaded = null;
    try { loaded = await d.loadNew(root); } catch {}
    lastSaved = { name: r.name, folder: r.folder, def: c.driver, orig: session.learned };
    session.saved = { name: r.name, id: r.id, loaded: !!loaded?.some((x) => x.name === r.name && x.id), canSecond: true };
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

// one recording of one value: start it ({ ok } or { ok: false, error }), then stop it and keep its messages
async function startTake(value) {
  if (session.takes.some((t) => same(t.value, value))) return { ok: false, error: session.setting.role === 'battery' ? 'That percent is recorded already. Wait until the maker\'s app shows another one.' : 'That value is recorded already: pick another.' };
  const take = `take-${session.takes.length + 1}-${Date.now().toString(36)}`;
  const s = await command(session.dir, 'start', take, 'recording');
  if (s.status !== 'recording') return { ok: false, error: s.error || (s.status === 'timeout' ? 'The listener did not answer. Press Start listening again.' : 'The listener stopped. Press Start listening again.') };
  session.recording = { take, value };
  return { ok: true };
}
async function stopTake() {
  const { deps: d } = options;
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
  return { ok: true, heard: messages.length };
}

// ---------------------------------------------------------------- driving the maker's app (docs/handoff/learn-no-typing.md)
// For the setting just named (act 'setting'), with the listener running: app-ui reads the control of that name in the
// maker's app (its value first), sets it to one value, then the other, while DeviceHub records each, then puts back the
// value it read. app-ui is only ever asked to get and set THIS control, never to press anything; a setting or control
// whose name looks like firmware, update, reset, factory, flash, bootloader, delete, format, pairing or DFU is refused
// (app-ui.ps1 refuses the same itself). Answers:
//   { ok, driven: true, restore, range }   both values recorded; restore = { ok, value, shown, why? } (ok false: say so)
//   { ok, manual: true, why, restore? }    DeviceHub could not change it: the person changes it (nothing kept)
//   { ok: false, error }                   refused
async function drive() {
  const { deps: d } = options;
  const set = session.setting;
  if (!set) return { ok: false, error: 'Say which setting first.' };
  if (FORBIDDEN.test(set.label)) return { ok: false, error: 'DeviceHub never changes firmware, update, reset, pairing or delete controls.' };
  const st = session.listening ? d.readState(session.dir) : null;
  if (!st || !['ready', 'stopped'].includes(st.status)) return { ok: false, error: 'DeviceHub is not listening yet. Press Start listening first.' };
  const m = session.plan?.maker;
  const manual = (why, extra = {}) => { session.takes = []; return { ok: true, manual: true, why, ...extra, ...summary() }; };
  if (set.kind === 'reading') return manual('DeviceHub only listens for a reading.');
  if (!m?.window) return manual(m?.known ? `DeviceHub cannot change settings in ${m.name}.` : 'DeviceHub does not know this maker\'s app.');
  if (!m.running) return manual(`${m.name} is not open.`);
  const app = m.name, win = m.window, label = set.label;
  const get = async () => { const r = await d.appUi(['get', '-Window', win, '-Name', label, '-Json']); return r.code === 0 ? parseInfo(r.out) : null; };
  const put = async (v) => { try { return await d.appUi(['set', '-Window', win, '-Name', label, '-Value', uiText(set.kind, v)]); } catch (e) { return { code: 1, out: e.message }; } };
  const info = await get();
  if (!info) return manual(`DeviceHub could not find ${label} in ${app}.`);
  if (FORBIDDEN.test(String(info.name || '')) || FORBIDDEN.test(String(info.id || ''))) return manual(`The control DeviceHub found for ${label} in ${app} is one it never touches.`);
  if (info.enabled === false || info.readOnly) return manual(`${label} cannot be changed in ${app} right now.`);
  const orig = valueOf(set.kind, info);
  if (orig === undefined) return manual(`${label} in ${app} is not a control DeviceHub can change.`);
  let range = null;
  if (set.kind === 'number') {
    // the slider's own range: values outside it are moved inside, and the range goes into the driver
    range = { min: Number(info.min), max: Number(info.max), step: Number(info.step) > 0 ? Number(info.step) : 1 };
    if (!set.values.every((v) => v >= range.min && v <= range.max)) set.values = valuesIn(range, null);
  }
  // when the app already shows the first value, the second goes first (so each recording holds a change)
  const order = same(orig, set.values[0]) ? [set.values[1], set.values[0]] : set.values.slice(0, 2);
  session.takes = [];
  let changed = false, failed = null;
  for (const v of order) {
    const s = await startTake(v);
    if (!s.ok) { failed = s.error; break; }
    await d.sleep(DRIVE.leadMs);
    changed = true;
    const r = await put(v);
    await d.sleep(DRIVE.settleMs);
    const e = await stopTake();
    if (r.code !== 0) { failed = r.code === 4 ? `${app} offered a control DeviceHub never touches.` : `${app} did not take ${show(v)} for ${label}.`; break; }
    if (!e.ok) { failed = e.error; break; }
  }
  if (session.recording) { try { await stopTake(); } catch {} }
  let restore = null;
  if (changed) {
    // put back the value read first, then read it again
    const r = await put(orig);
    const now = r.code === 0 ? valueOf(set.kind, await get()) : undefined;
    const ok = r.code === 0 && same(now, orig);
    restore = { ok, value: orig, shown: show(orig), ...(ok ? {} : { why: `DeviceHub could not put ${label} back. It was ${show(orig)} before: set it to ${show(orig)} in ${app}.` }) };
  }
  if (failed) return manual(failed, { restore });
  return { ok: true, driven: true, restore, range, ...summary() };
}

// the collection a driver opens: the one its asked reports go through (settings first), else the one its notices
// arrive on. Every notice must arrive on that same collection (one driver opens one). { col } or { why }
function collectionOf(dev, learned) {
  const lead = learned.find((s) => s.kind !== 'reading' && s.transport) || learned.find((s) => s.transport);
  const col = lead ? collectionFor(dev, lead.transport) : collectionForNotice(dev, noticeOf(learned));
  for (const s of learned.filter((x) => x.notice)) {
    const nc = collectionForNotice(dev, s.notice);
    if (!nc) return { why: `DeviceHub cannot find the part of the device that sends ${s.label}, so it cannot listen for it.` };
    if (col && nc !== col) return { why: `${s.label} arrives on another part of the device than ${lead ? lead.label : 'the rest'}, and one driver listens to one part. Learn it on its own.` };
  }
  return { col };
}

function draftCheck(learned, b = {}) {
  const dev = session.device;
  const cc = collectionOf(dev, learned);
  if (cc.why) return { ok: false, why: [cc.why] };
  const col = cc.col;
  let def;
  try { def = buildDriver({ vid: dev.vid, pid: dev.pid, product: dev.name, title: clean(b.title) || dev.name, kind: ['Mouse', 'Keyboard', 'Headset', 'Light', 'Controller', 'Device'].includes(b.kind) ? b.kind : 'Device', usagePage: col?.page, usage: col?.usage, settings: learned }); }
  catch (e) { return { ok: false, why: [e.message] }; }
  const v = validate(def);
  if (!v.ok) return { ok: false, why: v.problems, driver: def };
  const seen = verifySeen(def, learned);
  if (seen.length) return { ok: false, why: ['The driver would send something not seen in the recordings, so it was not made.', ...seen], driver: def };
  if (session.base) {
    let merged;
    try { merged = mergeDriver(session.base.def, def); } catch (e) { return { ok: false, why: [e.message], driver: def }; }
    const mv = validate(merged);
    if (!mv.ok) return { ok: false, why: mv.problems, driver: merged };
    const ms = verifySeen(merged, learned);
    if (ms.length) return { ok: false, why: ['Added to its driver, it would send something not seen in the recordings, so it was not added.', ...ms], driver: merged };
    return { ok: true, driver: merged };
  }
  return { ok: true, driver: def };
}

// the second id: every setting learned on it, built the same way, then added to the saved driver (addPid), and the
// whole file proven against the recordings of BOTH ids. { ok, driver, same } or { ok: false, why }
function secondCheck() {
  const sec = session.second, dev = session.device;
  const next = nextOf(sec);
  if (next) return { ok: false, why: [`Learn ${next.label} on this id too. Every setting is learned on it before the id is added, so nothing is ever sent there that was not heard there.`] };
  const cc = collectionOf(dev, session.learned);
  if (cc.why) return { ok: false, why: [cc.why] };
  let other, r;
  try { other = buildDriver({ vid: dev.vid, pid: dev.pid, product: dev.name, title: sec.def.title, kind: sec.def.kind, usagePage: cc.col?.page, usage: cc.col?.usage, settings: session.learned }); }
  catch (e) { return { ok: false, why: [e.message] }; }
  const v = validate(other);
  if (!v.ok) return { ok: false, why: v.problems };
  const seen = verifySeen(other, session.learned);
  if (seen.length) return { ok: false, why: ['On this id the driver would send something not seen in the recordings, so the id was not added.', ...seen] };
  try { r = addPid(sec.def, other, { pid: dev.pid, link: sec.link }); } catch (e) { return { ok: false, why: [e.message] }; }
  const mv = validate(r.def);
  if (!mv.ok) return { ok: false, why: mv.problems, driver: r.def };
  const both = [...verifySeen(r.def, sec.orig), ...verifySeen(r.def, session.learned, { pid: dev.pid })];
  if (both.length) return { ok: false, why: ['With the id added, the driver would send something not seen in the recordings, so it was not added.', ...both], driver: r.def };
  return { ok: true, driver: r.def, same: r.same };
}

// ---------------------------------------------------------------- the route
//   GET  /api/learn/devices   the devices DeviceHub does not run, and whether USBPcap is installed
//   GET  /api/learn/state     where the wizard is
//   GET  /api/learn/plan      the picked device's maker app (installed, running) and its tick-list of settings (?again: look again)
//   POST /api/learn/<step>    begin {vid,pid}, listen, setting {label,kind,role?,unit,values}, record {value?}, stop, analyze,
//                             add {min,max,step}, remove {key}, preview {title,kind}, save {title,kind}, quit,
//                             second {vid,pid,link: 'cable'|'receiver'} (after a save: the same device on its other USB id),
//                             drive (after setting + listen: the maker's app changes it through app-ui while DeviceHub records)
//   kind 'reading' (role battery | charging | display): a value the device reports, never written (analyzeReading)
export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/learn/')) return false;
  const step = url.pathname.slice('/api/learn/'.length);
  try {
    if (req.method === 'GET' && step === 'devices') {
      const devices = await listDevices();
      send(res, 200, { devices: devices.map(({ collections, driver, ...x }) => ({ ...x, collections: collections.length, ...(driver ? { driver: { name: driver.name, where: driver.where, code: driver.code, writes: driver.writes } } : {}) })), usbpcap: options.deps.usbpcapInstalled(), ...summary() });
      return true;
    }
    if (req.method === 'GET' && step === 'plan') { send(res, 200, await act('plan', { again: url.searchParams.has('again') })); return true; }
    if (req.method === 'GET' && step === 'state') { send(res, 200, { usbpcap: options.deps.usbpcapInstalled(), ...summary() }); return true; }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
    const b = (await readBody(req)) || {};
    const r = await act(step, b);
    send(res, 200, r);
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
  return true;
}
