// Vial keyboards give their own layout (1 Nov 2026; public/devices/vial.js, helpers/via-defs.js definitionFor,
// helpers/hid-host.mjs vialChannel, helpers/agent.mjs). Simulated keyboards on VIA's raw HID collection (FF60:0061,
// 32-byte reports):
//   - a Vial board that answers as vial-qmk quantum/vial.c does (replies written from byte 0, no echo; the definition
//     is tests/fixtures/xz/vial-sample.xz, what Python's lzma.compress makes of its vial.json): its layout is read,
//     decompressed into keys, saved where a fetched VIA file is saved, and not read again on the next start;
//   - the same board through the agent's raw channel (vialChannel) against a stand-in for the native helper;
//   - a plain VIA board (QMK via.c answers FE with FF + the request) and a silent one: told apart at the first
//     question, nothing more sent, and the layout lookup carries on exactly as before (VIA's library);
//   - boards that answer garbage (an echo, random bytes, size 0, a size over the limit, a first block that is not xz,
//     a damaged definition): each falls back, nothing saved from it;
//   - the Epomaker P75: never sent 0xFE on any path;
//   - only FE 00, FE 01 and FE 02 are ever sent; no unlock, encoder write, QMK settings or dynamic entry command.
// Run: node tests/sim-vial.mjs (no hardware, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readVialDefinition, allowed, NotVial, MAX_COMPRESSED } from '../public/devices/vial.js';
import { fromDefinition } from '../public/devices/via-layout.js';
import { candidates, P75_ID } from '../helpers/via-generic.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const native = require('../helpers/native.js');
const viaDefs = require('../helpers/via-defs.js');
const vf = await import('../helpers/via-fetch.mjs');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-sim-vial-'));
viaDefs.deps.dir = tmp; vf.deps.dir = tmp;
const XZ = new Uint8Array(fs.readFileSync(path.join(HERE, 'fixtures', 'xz', 'vial-sample.xz')));
const VIAL_JSON = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'xz', 'vial-sample.json'), 'utf8'));
const READS = new Set(['fe00', 'fe01', 'fe02']);

// the keyboard's answer to one 32-byte request, as its firmware would give it; null = no answer
// mode: 'vial' (vial-qmk), 'via' (QMK via.c: FF then the request), 'silent', 'echo', 'random', 'size0', 'huge',
// 'notxz' (a definition that is not xz), 'damaged' (an xz definition with a changed byte)
function reply(mode, p, def = XZ) {
  const r = Uint8Array.from(p);
  if (mode === 'silent') return null;
  if (mode === 'echo') return r;
  if (mode === 'random') { for (let i = 0; i < 32; i++) r[i] = (i * 73 + p[1] * 31 + 7) & 0xff; r[0] = 0x05; return r; }
  if (p[0] !== 0xfe || mode === 'via') {
    if (p[0] === 0x01) { r[1] = 0x00; r[2] = 0x0c; return r; }   // VIA protocol 12, for completeness
    r[0] = 0xff; return r;                                       // via.c: *command_id = id_unhandled, the rest as sent
  }
  if (mode === 'damaged') { def = def.slice(); def[60] ^= 0x10; }
  if (mode === 'notxz') def = new TextEncoder().encode(JSON.stringify(VIAL_JSON));
  switch (p[1]) {
    case 0x00: r.fill(0); r.set([6, 0, 0, 0], 0); r.set([0x3c, 0x2b, 0x4c, 0xf6, 0x11, 0x22, 0x33, 0x44], 4); return r;
    case 0x01: { const sz = mode === 'size0' ? 0 : mode === 'huge' ? MAX_COMPRESSED + 1 : def.length; r.set([sz & 0xff, (sz >> 8) & 0xff, (sz >> 16) & 0xff, sz >>> 24], 0); return r; }
    case 0x02: {
      // vial.c: page = msg[2] + (msg[3] << 8); copies at most 32 bytes from there; past the end it leaves msg as sent
      const start = (p[2] + (p[3] << 8)) * 32;
      if (start >= def.length) return r;
      r.set(def.slice(start, Math.min(start + 32, def.length)), 0);
      return r;
    }
    default: r[0] = 0xff; return r;
  }
}

// a WebHID-like device (what readVialDefinition is handed in a window, and what the agent's channels look like)
function board(mode, { vendorId = 0xfeed, productId = 0x1001 } = {}) {
  const listeners = new Set();
  return {
    vendorId, productId, productName: `Simulated ${mode} board`, opened: false, sent: [],
    collections: [{ usagePage: 0xff60, usage: 0x61 }],
    async open() { this.opened = true; },
    close() { this.opened = false; },
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(p);
      const r = reply(mode, p);
      if (r) setTimeout(() => listeners.forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1);
    },
  };
}
const heads = (d) => d.sent.map((p) => (p[0] === 0xfe ? `fe${p[1].toString(16).padStart(2, '0')}` : p[0].toString(16)));
const onlyReads = (d, what) => ok(d.sent.every((p) => p[0] === 0xfe && READS.has(heads({ sent: [p] })[0]) && allowed(Array.from(p))), `${what}: only FE 00 / FE 01 / FE 02 were sent (${[...new Set(heads(d))].join(' ')})`);
const libraryAnswer = (vpid) => ({ ok: true, status: 200, url: `https://usevia.app/definitions/v3/${vpid}.json`,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify({ name: 'From VIA library', vendorProductId: vpid, matrix: { rows: 2, cols: 8 },
    layouts: { keys: Array.from({ length: 16 }, (_, i) => ({ row: i >> 3, col: i & 7, x: i & 7, y: i >> 3 })) } }) });

// ---- what may be sent ----
{
  ok(allowed([0xfe, 0x00]) && allowed([0xfe, 0x01]) && allowed([0xfe, 0x02, 3, 0, 0, 0]), 'the three reads are allowed');
  for (const b of [[0xfe, 0x03], [0xfe, 0x04], [0xfe, 0x05], [0xfe, 0x06], [0xfe, 0x07], [0xfe, 0x08], [0xfe, 0x0b], [0xfe, 0x0c], [0xfe, 0x0d], [0x01], [0x0b], [0xfe, 0x00, 1], [0xfe, 0x02, 0, 0, 0, 0, 9]])
    ok(!allowed(b), `${b.map((x) => x.toString(16)).join(' ')} is refused`);
}

// ---- a Vial board: its layout comes from the keyboard itself ----
{
  const d = board('vial');
  const t = Date.now();
  const got = await readVialDefinition(d);
  const ms = Date.now() - t;
  ok(got.protocol === 6 && got.uid === '44332211f64c2b3c' && got.size === XZ.length && got.blocks === Math.ceil(XZ.length / 32), `it reads Vial 6, its uid and ${got.blocks} blocks (${JSON.stringify({ ...got, def: undefined })})`);
  ok(JSON.stringify(got.def) === JSON.stringify(VIAL_JSON), 'the definition decompresses to the keyboard\'s vial.json exactly');
  ok(ms < 1500, `in ${ms} ms`);
  const want = ['fe00', 'fe01', ...Array(got.blocks).fill('fe02')];
  ok(heads(d).join() === want.join(), `the questions in order: FE 00, FE 01, then each block (${heads(d).slice(0, 4).join(' ')} ...)`);
  ok(d.sent.filter((p) => p[1] === 2).every((p, i) => p[2] === (i & 0xff) && p[3] === (i >> 8) && !p[4] && !p[5]), 'each block number goes as a little-endian uint32 in bytes 2-5');
  onlyReads(d, 'the Vial board');
  const layout = fromDefinition(got.def);
  ok(layout.rows === 2 && layout.cols === 8 && layout.keys.length === 16 && layout.keys.every((k) => Number.isInteger(k.row)), `it becomes 16 drawn keys on a 2 x 8 matrix (${layout.keys.length})`);
  ok(!layout.keys.some((k) => k.y > 1.5), 'its two knob turns (Vial draws them as "e" keys) are not taken for matrix keys');
}

// ---- the layout lookup (via-defs.js definitionFor): Vial first, then saved; a plain VIA board unchanged ----
{
  const asked = [];
  viaDefs.deps.fetch = async (u) => { asked.push(u); return libraryAnswer(0xfeed * 65536 + 0x1001); };
  const d = board('vial');
  let reads = 0;
  const got = await viaDefs.definitionFor('FEED', '1001', { name: 'Simulated vial board', vial: () => { reads++; return readVialDefinition(d); } });
  ok(got.vial && /keyboard itself \(Vial 6\)/.test(got.from) && asked.length === 0, `a Vial board's layout comes from the board, VIA's library not asked (${got.from})`);
  const file = path.join(tmp, 'FEED1001.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  ok(saved && saved.vendorId === '0xFEED' && saved.productId === '0x1001' && saved.devicehub?.from === 'vial' && saved.layouts.keymap.length === 3, 'it is saved as via-definitions\\FEED1001.json with its USB ids');
  ok(vf.check(fs.readFileSync(file, 'utf8'), 'FEED', '1001').keys.length === 16, 'the saved file passes the same check a fetched VIA file does');
  const again = await viaDefs.definitionFor('FEED', '1001', { vial: () => { reads++; return readVialDefinition(d); } });
  ok(reads === 1 && again.from.startsWith('via-definitions') && fromDefinition(again.def).keys.length === 16, 'the next start uses the saved file: the keyboard is not read again');
  fs.rmSync(file);
}

// ---- boards that are not Vial, or answer garbage: one question (or a few reads), then the old path ----
for (const mode of ['via', 'silent', 'echo', 'random', 'size0', 'huge', 'notxz', 'damaged']) {
  const asked = [];
  viaDefs.deps.fetch = async (u) => { asked.push(u); return libraryAnswer(0xfeed * 65536 + 0x2002); };
  const d = board(mode, { productId: 0x2002 });
  const logged = [];
  const t = Date.now();
  const got = await viaDefs.definitionFor('FEED', '2002', { vial: () => readVialDefinition(d), log: (x) => logged.push(x) });
  const ms = Date.now() - t;
  ok(got.from === 'VIA\'s library' && asked.length === 1 && !got.vial, `${mode}: falls back to VIA's library as before (${got.from}; ${logged[0]})`);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'FEED2002.json'), 'utf8'));
  ok(saved.name === 'From VIA library' && !saved.devicehub, `${mode}: the file saved is VIA's, nothing from the keyboard`);
  const n = { via: 1, silent: 1, echo: 1, random: 1, size0: 2, huge: 2, notxz: 3 }[mode];
  if (n) ok(d.sent.length === n, `${mode}: stopped after ${n} question(s) (${heads(d).join(' ')})`);
  onlyReads(d, mode);
  ok(ms < 1500, `${mode}: decided in ${ms} ms`);
  fs.rmSync(path.join(tmp, 'FEED2002.json'));
  // a "not Vial" answer is remembered: the next start asks the keyboard nothing (a review, 1 Nov 2026); a read that
  // failed half way is not remembered, so it is tried again
  const before = d.sent.length;
  await viaDefs.definitionFor('FEED', '2002', { vial: () => readVialDefinition(d), log: () => {} });
  const remembered = mode !== 'damaged';
  ok(remembered ? d.sent.length === before : true, `${mode}: ${remembered ? 'not asked again on the next start' : 'tried again'} (${d.sent.length - before} more)`);
  try { fs.rmSync(path.join(tmp, 'FEED2002.json')); } catch {}
  try { fs.rmSync(path.join(tmp, 'not-vial.json')); } catch {}
}
// the whole read has one deadline, whatever size the keyboard declares (a review: 64 KB at just under 500 ms a block)
{
  const { READ_DEADLINE_MS, MAX_COMPRESSED } = await import('../public/devices/vial.js');
  ok(READ_DEADLINE_MS <= 10000 && MAX_COMPRESSED <= 16 * 1024, `one deadline (${READ_DEADLINE_MS} ms) and a 16 KB cap (${MAX_COMPRESSED})`);
}
{
  // a NotVial answer is a plain "not Vial", told apart from a Vial board with a broken definition
  let e1 = null, e2 = null;
  try { await readVialDefinition(board('via')); } catch (e) { e1 = e; }
  try { await readVialDefinition(board('damaged')); } catch (e) { e2 = e; }
  ok(e1 instanceof NotVial && /not Vial/.test(e1.message), `a plain VIA board: "${e1?.message}"`);
  ok(e2 && !(e2 instanceof NotVial) && /xz/.test(e2.message), `a damaged definition names the damage: "${e2?.message}"`);
}

// ---- the Epomaker P75 is never asked 0xFE ----
{
  const p75 = board('vial', { vendorId: 0x342d, productId: 0xe479 });
  let e = null; try { await readVialDefinition(p75); } catch (x) { e = x; }
  ok(e instanceof NotVial && p75.sent.length === 0, `readVialDefinition refuses the P75 before sending anything (${e?.message})`);
  let called = 0;
  viaDefs.deps.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  try { await viaDefs.definitionFor('342D', 'E479', { vial: () => { called++; return readVialDefinition(p75); } }); } catch {}
  ok(called === 0 && p75.sent.length === 0, 'the layout lookup never asks the P75 for a Vial definition');
  ok(candidates([{ vid: '342D', pid: 'E479' }, { vid: 'FEED', pid: '1001' }]).length === 0, 'with the P75 plugged in no other keyboard is taken, so nothing is read from any keyboard');
  const agent = fs.readFileSync(path.join(HERE, '..', 'helpers', 'agent.mjs'), 'utf8');
  ok((agent.match(/readVialFrom\(/g) || []).length === 2 && /vial: \(\) => readVialFrom\(other\)/.test(agent), 'the agent reads Vial only inside the layout lookup of a keyboard it took (never the P75\'s own path)');
}

// ---- the agent's raw channel (hid-host.mjs vialChannel) against a stand-in for the native helper ----
{
  const lines = [];
  let mode = 'vial';
  const queue = [];
  native.request = async (chan, cmd) => {
    lines.push(`${chan} ${cmd}`);
    if (cmd === 'OPEN' || cmd === 'CLOSE') return 'OK';
    if (cmd.startsWith('SEND ')) {
      const b = cmd.split(' ').slice(2).map((x) => parseInt(x, 16));
      const p = new Uint8Array(32); p.set(b.slice(0, 32));
      const r = reply(mode, p);
      if (r) queue.push(`00 ${Array.from(r, (x) => x.toString(16).padStart(2, '0')).join(' ')}`);
      return 'OK';
    }
    if (cmd.startsWith('READ ')) {
      if (queue.length) return queue.splice(0).join('|');
      await new Promise((r) => setTimeout(r, Math.min(50, Number(cmd.split(' ')[1]) || 0)));
      return 'NONE';
    }
    return 'ERR';
  };
  native.onEvent = () => {};
  native.onExit = native.onExit || (() => {});
  const host = await import('../helpers/hid-host.mjs');
  const dev = host.vialChannel('FEED', '1001', 'Simulated vial board');
  ok(dev.spec.reply === 'raw' && dev.spec.never === true && /^hid:FEED:1001:FF60:0061:32:0:rw=1$/.test(dev.chan), `a raw channel on the FF60 collection, never list on (${dev.chan})`);
  ok(!host.SPECS.some((s) => s.id === 'vial-read'), 'it is not one of the channels getDevice hands out');
  ok(await dev.tryOpen(), 'it opens');
  const got = await readVialDefinition(dev);
  dev.close();
  ok(JSON.stringify(got.def) === JSON.stringify(VIAL_JSON), 'the definition read over the raw channel is the vial.json');
  const sends = lines.filter((l) => / SEND /.test(l)).map((l) => l.split(' SEND ')[1]);
  ok(sends.length === got.blocks + 2 && sends.every((s) => /^00 fe 0[012]( |$)/.test(s)), `every report sent is FE 00 / 01 / 02 (${sends.length})`);
  ok(lines.at(-1).endsWith(' CLOSE'), 'the channel is closed after the read');
  // the never list still guards it (a VIA bootloader jump is refused before it leaves)
  const d2 = host.vialChannel('FEED', '1001'); await d2.tryOpen();
  let e = null; try { await d2.sendReport(0, Uint8Array.from([0x0b, 0, 0])); } catch (x) { e = x; }
  ok(e && !lines.some((l) => / SEND 00 0b/.test(l)), `the never list refuses 0x0B on it (${e?.message})`);
  d2.close();
  mode = 'via'; lines.length = 0;
  const d3 = host.vialChannel('FEED', '2002'); await d3.tryOpen();
  let e3 = null; try { await readVialDefinition(d3); } catch (x) { e3 = x; }
  d3.close();
  ok(e3 instanceof NotVial && lines.filter((l) => / SEND /.test(l)).length === 1, 'a plain VIA board on the raw channel: one question, then not Vial');
  const p = host.vialChannel('342D', 'E479'); lines.length = 0;
  let e4 = null; try { await readVialDefinition(p); } catch (x) { e4 = x; }
  ok(e4 instanceof NotVial && !lines.some((l) => / SEND /.test(l)), 'the P75 on a raw channel is sent nothing');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `sim-vial: ${fails} failed` : 'sim-vial: all passed');
process.exit(fails ? 1 : 0);
