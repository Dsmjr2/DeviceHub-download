// The learning wizard (22 Oct 2026; helpers/learn-wizard.mjs): made-up USBPcap recordings of three pretend devices, as
// the maker's app would talk to them while one setting is changed, prove the diff finds the right bytes, builds a
// driver.json that passes validate() and rebuilds every recorded message byte for byte, and saves it read-only. Then
// the cases it must refuse: two messages carrying the value, a counter byte, no read, no reply, nothing changed, a
// template on DeviceHub's never list. No real device, no USBPcap, no admin prompt: every Windows part is replaced.
// Run: node tests/learn-wizard.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lw from '../helpers/learn-wizard.mjs';
import { load } from '../helpers/my-devices.mjs';
import { list, installFromLibrary } from '../helpers/device-library.mjs';
import { shareDevice } from '../helpers/share-device.mjs';
import { readPcapBuffer } from '../helpers/pcap-read.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- a USBPcap recording, written by hand
// one recording: records in order, each { ts, irp, in, bus, device, endpoint, transfer, stage?, data }
class Rec {
  constructor() { this.recs = []; this.ts = 1761100000; this.irp = 1000n; }
  add(r) { this.ts += 0.004; this.recs.push({ ts: this.ts, bus: 1, ...r }); }
  // the device descriptor USBPcap injects for a connected device
  descriptor(device, vid, pid) {
    const irp = this.irp++;
    const d = [18, 1, 0, 2, 0, 0, 0, 64, vid & 255, vid >> 8, pid & 255, pid >> 8, 0, 1, 1, 2, 0, 1];
    this.add({ irp, in: false, device, endpoint: 0x80, transfer: 2, stage: 0, data: [0x80, 6, 0, 1, 0, 0, 18, 0] });
    this.add({ irp, in: true, device, endpoint: 0x80, transfer: 2, stage: 3, data: d });
  }
  out(device, bytes, ep = 1) { this.add({ irp: this.irp++, in: false, device, endpoint: ep, transfer: 1, data: bytes }); }
  inp(device, bytes, ep = 0x81) { this.add({ irp: this.irp++, in: true, device, endpoint: ep, transfer: 1, data: bytes }); }
  setFeature(device, id, bytes) {
    const irp = this.irp++, payload = id ? [id, ...bytes] : bytes;
    this.add({ irp, in: false, device, endpoint: 0, transfer: 2, stage: 0, data: [0x21, 9, id, 3, 0, 0, payload.length & 255, payload.length >> 8] });
    this.add({ irp, in: false, device, endpoint: 0, transfer: 2, stage: 1, data: payload });
    this.add({ irp, in: true, device, endpoint: 0, transfer: 2, stage: 3, data: [] });
  }
  getFeature(device, id, bytes) {
    const irp = this.irp++, payload = id ? [id, ...bytes] : bytes;
    this.add({ irp, in: false, device, endpoint: 0x80, transfer: 2, stage: 0, data: [0xa1, 1, id, 3, 0, 0, payload.length & 255, payload.length >> 8] });
    this.add({ irp, in: true, device, endpoint: 0x80, transfer: 2, stage: 1, data: payload });
  }
  pcap() {
    const parts = [];
    const g = Buffer.alloc(24);
    g.writeUInt32LE(0xa1b2c3d4, 0); g.writeUInt16LE(2, 4); g.writeUInt16LE(4, 6); g.writeUInt32LE(65535, 16); g.writeUInt32LE(249, 20);
    parts.push(g);
    for (const r of this.recs) {
      const hl = r.transfer === 2 ? 28 : 27;
      const p = Buffer.alloc(hl + r.data.length);
      p.writeUInt16LE(hl, 0); p.writeBigUInt64LE(BigInt(r.irp), 2); p.writeUInt32LE(0, 10); p.writeUInt16LE(9, 14);
      p[16] = r.in ? 1 : 0; p.writeUInt16LE(r.bus, 17); p.writeUInt16LE(r.device, 19); p[21] = r.endpoint; p[22] = r.transfer;
      p.writeUInt32LE(r.data.length, 23);
      if (hl === 28) p[27] = r.stage ?? 0;
      Buffer.from(r.data).copy(p, hl);
      const h = Buffer.alloc(16);
      h.writeUInt32LE(Math.floor(r.ts), 0); h.writeUInt32LE(Math.round((r.ts % 1) * 1e6), 4); h.writeUInt32LE(p.length, 8); h.writeUInt32LE(p.length, 12);
      parts.push(h, p);
    }
    return Buffer.concat(parts);
  }
}
const pad = (bytes, len) => { const a = new Array(len).fill(0); bytes.forEach((b, i) => { a[i] = b; }); return a; };
const xorAt = (a, from, to, at) => { let s = 0; for (let i = from; i <= to; i++) s ^= a[i]; a[at] = s; return a; };
const takesOf = (bufs, vid, pid, opts = {}) => bufs.map((b) => lw.takeMessages([b.pcap], { vid, pid, ...opts })).map((t, i) => ({ value: bufs[i].value, messages: t.messages, found: t.found }));

// ---------------------------------------------------------------- device 1: Acme mouse (1234:5678)
// output reports, no report id, 64 bytes. Read DPI: 05 81 -> 05 81 00 <dpi u16le>. Set DPI: 05 01 00 <dpi u16le> ->
// 05 01 00 (ack). Battery poll 07 00 -> 07 00 55. Another device on the same hub (address 9) talks too.
const D1 = 3, NOISE = 9;
function acme(value, { drag = null, counter = null, twin = false, noRead = false, noReply = false, same = false, pid = 0x5678, rd = 0x81 } = {}) {
  const r = new Rec();
  r.descriptor(D1, 0x1234, pid); r.descriptor(NOISE, 0x0BDA, 0x8153);
  const lo = (v) => v & 255, hi = (v) => v >> 8;
  for (let i = 0; i < 3; i++) { r.out(D1, pad([7, 0], 64)); r.inp(D1, pad([7, 0, 0x55], 64)); r.out(NOISE, pad([5, 1, 0, 0x20, 3], 64)); }
  const was = 400;
  r.out(D1, pad([5, rd], 64)); r.inp(D1, pad([5, rd, 0, lo(was), hi(was)], 64));
  const sendValue = (v) => {
    const msg = same ? [5, 1, 0, 0x90, 1] : [5, 1, counter ?? 0, lo(v), hi(v)];
    r.out(D1, pad(msg, 64));
    if (!noReply) r.inp(D1, pad([5, 1, 0], 64));
    if (twin) { r.out(D1, pad([9, 1, lo(v), hi(v)], 64)); r.inp(D1, pad([9, 1], 64)); }
  };
  if (drag) sendValue(drag);
  sendValue(value);
  if (!noRead) { r.out(D1, pad([5, rd], 64)); r.inp(D1, pad([5, rd, 0, lo(value), hi(value)], 64)); }
  r.out(D1, pad([7, 0], 64)); r.inp(D1, pad([7, 0, 0x54], 64));
  return { value, pcap: r.pcap() };
}

// recordings are read back by the shipped reader
const one = acme(800);
const recs = readPcapBuffer(one.pcap);
check(recs.length > 20 && recs.every((x) => typeof x.ts === 'number'), 'the made-up recording reads back with helpers/pcap-read.mjs');
const desc = lw.deviceDescriptors(recs);
check(desc.get(`1:${D1}`)?.vid === '1234' && desc.get(`1:${D1}`)?.pid === '5678' && desc.get(`1:${NOISE}`)?.vid === '0BDA', `devices are found by their injected descriptors (${JSON.stringify([...desc])})`);
const tm = lw.takeMessages([one.pcap], { vid: '1234', pid: '5678' });
const writes800 = tm.messages.filter((m) => m.dir === 'out' && m.data[0] === 5 && m.data[1] === 1 && m.data[3] === 0x20 && m.data[4] === 3).length;
check(tm.found && writes800 === 1, `only the chosen device is kept: the other device's 3 look-alike messages are left out (${writes800})`);
check(!lw.takeMessages([one.pcap], { vid: '1234', pid: '9999' }).found, 'a device not in the recording is said to be missing');

const t1 = takesOf([acme(800, { drag: 1000 }), acme(1600)], '1234', '5678');
check(t1.every((t) => t.found && t.messages.every((m) => m.data.length === 64)), 'each take holds only the Acme mouse\'s 64-byte reports');
let a1 = lw.analyze(t1, { label: 'DPI', kind: 'number' });
check(a1.ok, `the Acme DPI is learned (${JSON.stringify(a1.why)})`);
const L1 = a1.learned;
if (a1.ok) {
  check(L1.write.enc.offset === 3 && L1.write.enc.size === 2 && L1.write.enc.endian === 'little' && L1.write.enc.scale === 1 && L1.write.enc.add === 0, `the write's DPI is bytes 3-4, little-endian, as is (${JSON.stringify(L1.write.enc)})`);
  check(L1.read.data[0] === 5 && L1.read.data[1] === 0x81 && L1.read.field.offset === 3 && L1.read.field.size === 2, `the read is 05 81 and its reply holds DPI at bytes 3-4 (${JSON.stringify(L1.read)})`);
  check(L1.echo.length >= 2 && L1.transport.report === 'output' && L1.transport.len === 64 && !L1.checksum, `output reports of 64 bytes, replies echo 2+ bytes, no checksum (${L1.echo})`);
  check(L1.write.data[0][3] === 0x20 && L1.write.data[0][4] === 3, 'a slider dragged through 1000 counts with its final value, 800');
}

// range, driver.json, validate, every recorded byte rebuilt
let rg = lw.withRange(L1, { min: 100, max: 26000, step: 50 });
check(rg.setting && rg.setting.key === 'dpi' && rg.setting.min === 100, `a range from the maker's app is taken (${rg.why})`);
check(!lw.withRange(L1, { min: 1000, max: 2000 }).setting, 'a range that leaves out a recorded value is refused');
const draft1 = { vid: '1234', pid: '5678', product: 'Acme mouse', title: 'Acme mouse', kind: 'Mouse', usagePage: 'FF00', usage: '0001', settings: [rg.setting] };
const def1 = lw.buildDriver(draft1, { date: new Date('2026-10-22T12:00:00Z') });
const { validate, fromJson } = await import('../helpers/declarative-driver.mjs');
const v1 = validate(def1);
check(v1.ok, `the Acme driver.json passes validate() (${v1.problems.join('; ')})`);
check(def1.messages.setDpi?.bytes === '05 01 00 {value:u16le}' && def1.messages.read1?.bytes === '05 81', `its templates are the recorded bytes (${JSON.stringify(def1.messages)})`);
check(lw.verifySeen(def1, [rg.setting]).length === 0, `every recorded read and write is rebuilt byte for byte (${lw.verifySeen(def1, [rg.setting]).join('; ')})`);
const tampered = JSON.parse(JSON.stringify(def1)); tampered.messages.setDpi.bytes = '05 02 00 {value:u16le}';
check(lw.verifySeen(tampered, [rg.setting]).some((x) => /not the one recorded/.test(x)), 'a template that differs from the recording is caught');
// a pretend Acme driven by the built driver: it reads, writes with read-back, and sends only its templates
{
  const drv = fromJson(def1);
  const sent = [];
  let dpi = 800;
  const fake = { productId: 0x5678, opened: true, async open() {}, async sendReport(id, d) { sent.push([...d]); const r = new Uint8Array(64); if (d[0] === 5 && d[1] === 0x81) r.set([5, 0x81, 0, dpi & 255, dpi >> 8]); else if (d[0] === 5 && d[1] === 1) { dpi = d[3] | (d[4] << 8); r.set([5, 1, 0]); } setTimeout(() => this.listeners.forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1); },
    listeners: new Set(), addEventListener(t, f) { this.listeners.add(f); }, removeEventListener(t, f) { this.listeners.delete(f); } };
  const hid = await import('../public/devices/hid.js');
  const ch = new hid.HidChannel(fake, { reportId: 0, length: 64, match: (s, r) => r[0] === s[0] && r[1] === s[1] });
  Object.assign(drv, { dev: fake, ch, model: def1.models[0], link: 'usb', probes: {}, locked: new Set(), snap: null, snapAt: 0, appAt: 0, app: null, q: Promise.resolve() });
  try {
    const before = await drv.read();
    const got = await drv.write('dpi', 1200);
    check(before.dpi === 800 && got === 1200 && dpi === 1200, `the built driver reads 800, writes 1200 and reads it back (${JSON.stringify(before)} ${got})`);
    check(sent.every((d) => (d[0] === 5 && (d[1] === 0x81 || d[1] === 1)) && d.slice(5).every((x) => x === 0)), 'it sent only its two templates');
  } catch (e) { check(false, `the built driver works against a pretend Acme (${e.message})`); }
}

// saved read-only, loaded guarded: no write until the self-check passes
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learn-'));
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const sv = lw.saveDriver(def1, { root, folder: 'Acme mouse' });
check(sv.ok && fs.existsSync(path.join(root, 'my-devices', 'acme-mouse', 'driver.json')), `the driver is saved in my-devices (${JSON.stringify(sv)})`);
const mark = JSON.parse(fs.readFileSync(path.join(root, 'my-devices', 'acme-mouse', 'library.json'), 'utf8'));
check(mark.status === 'read-only' && mark.learned === true, 'with a read-only marker');
check(lw.saveDriver(def1, { root, folder: 'Acme mouse' }).name === 'acme-mouse-2', 'a second save never writes over the first');
fs.rmSync(path.join(root, 'my-devices', 'acme-mouse-2'), { recursive: true, force: true });
const reg = [];
const loaded = await load(root, { register: (a) => reg.push(a), addSpec() {}, taken: () => false, selfCheck: {} });
const ac = reg.find((a) => a.id === 'acme-mouse');
check(loaded.some((x) => x.name === 'acme-mouse' && x.library === 'read-only') && ac, `my-devices loads it guarded (${JSON.stringify(loaded)})`);
let refusedWrite = null;
try { await ac.write('dpi', 1200); } catch (e) { refusedWrite = e.message; }
check(/read-only/.test(refusedWrite || '') && ac.settings.every((s) => s.readOnly), `its writes are refused until the self-check passes (${refusedWrite})`);

// shared as a driver.json-only library entry, which then lists and installs
const shared = await shareDevice(path.join(root, 'my-devices', 'acme-mouse'), { root, status: 'read-only', by: 'tester', names: [] });
check(shared.ok && shared.file === 'driver.json' && fs.readdirSync(shared.dir).sort().join() === 'device.json,driver.json', `a learned driver shares as driver.json + device.json (${shared.error || JSON.stringify(shared.refused)})`);
check(list({ root }).some((e) => e.name === shared.name && !e.error), 'the driver.json-only entry is a well-formed library entry');
fs.rmSync(path.join(root, 'my-devices', 'acme-mouse'), { recursive: true, force: true });
const inst = await installFromLibrary(shared.name, { root, readOnly: true });
check(inst.ok && fs.existsSync(path.join(root, 'my-devices', shared.name, 'driver.json')) && fs.existsSync(path.join(root, 'my-devices', shared.name, 'library.json')), `a driver.json-only entry installs (${inst.error})`);

// ---------------------------------------------------------------- device 2: Glow keyboard (2345:0001)
// feature reports, report id 6, 32 bytes, XOR of bytes 0-30 in byte 31. Polling rate is a choice, one code per value:
// set 11 02 <code>, then get; read 11 82, then get -> 11 82 <code>. Three recordings (125, 500, 1000 Hz).
const CODES = { '125': 8, '500': 2, '1000': 1 };
function glow(value) {
  const r = new Rec(), D = 4;
  r.descriptor(D, 0x2345, 0x0001);
  const f = (b) => xorAt(pad(b, 32), 0, 30, 31);
  r.setFeature(D, 6, f([0x11, 0x82])); r.getFeature(D, 6, f([0x11, 0x82, 0, 8]));
  r.setFeature(D, 6, f([0x11, 2, 0, CODES[value]])); r.getFeature(D, 6, f([0x11, 2, 0, CODES[value]]));
  r.setFeature(D, 6, f([0x11, 0x82])); r.getFeature(D, 6, f([0x11, 0x82, 0, CODES[value]]));
  return { value, pcap: r.pcap() };
}
const t2 = takesOf([glow('125'), glow('500'), glow('1000')], '2345', '0001');
const a2 = lw.analyze(t2, { label: 'Polling rate', kind: 'choice', unit: 'Hz' });
check(a2.ok, `the Glow polling rate is learned from three recordings (${JSON.stringify(a2.why)})`);
if (a2.ok) {
  const L2 = a2.learned;
  check(L2.transport.report === 'feature' && L2.transport.reportId === 6 && L2.transport.len === 32, `feature reports, id 6, 32 bytes (${JSON.stringify(L2.transport)})`);
  check(L2.checksum?.type === 'xor' && L2.checksum.at === 31 && L2.checksum.from === 0 && L2.replyChecksum, `the XOR checksum in byte 31 is found, on requests and replies (${JSON.stringify(L2.checksum)})`);
  check(same(L2.write.enc.codes, [8, 2, 1]) && L2.write.enc.offset === 3 && L2.read.field.offset === 3, `one code per choice at byte 3 (${JSON.stringify(L2.write.enc)})`);
  const s2 = lw.withRange(L2, {}).setting;
  const def2 = lw.buildDriver({ vid: '2345', pid: '0001', title: 'Glow keyboard', kind: 'Keyboard', usagePage: 'FF60', settings: [s2] });
  const v2 = validate(def2);
  check(v2.ok && def2.transport.checksum?.at === 31 && def2.replies.checksum === true, `its driver.json passes validate() with the checksum (${v2.problems.join('; ')})`);
  check(lw.verifySeen(def2, [s2]).length === 0 && def2.settings[0].options.length === 3, `every recorded message rebuilds, checksum included (${lw.verifySeen(def2, [s2]).join('; ')})`);
  check(def2.messages.setPollingRate.bytes === '11 02 00 {value}', `the write template (${def2.messages.setPollingRate.bytes})`);
}
// two choices recorded only: still learned (one byte, two codes)
check(lw.analyze(t2.slice(0, 2), { label: 'Polling rate', kind: 'choice' }).ok, 'two choices are enough for a one-byte code');

// ---------------------------------------------------------------- device 3: Pro mouse (3456:00A0), through the route
// output reports WITH report id 3 (its collection declares it), 16 bytes; DPI as big-endian raw * 50 + 50.
// Read 21 -> 21 00 <raw u16be>; set 22 <raw u16be> -> 22 00.
function pro(value) {
  const r = new Rec(), D = 7, raw = (value - 50) / 50;
  r.descriptor(D, 0x3456, 0x00a0);
  r.out(D, [3, ...pad([0x21], 16)]); r.inp(D, [3, ...pad([0x21, 0, 0, 7], 16)]);
  r.out(D, [3, ...pad([0x22, raw >> 8, raw & 255], 16)]); r.inp(D, [3, ...pad([0x22, 0], 16)]);
  r.out(D, [3, ...pad([0x21], 16)]); r.inp(D, [3, ...pad([0x21, 0, raw >> 8, raw & 255], 16)]);
  return pro.files[value] = r.pcap();
}
pro.files = {};
const session = { state: null, cmds: [], started: 0 };
lw.options.root = root;
lw.options.deps = {
  ...lw.deps,
  usbpcapInstalled: () => true,
  listHid: async () => ({ collections: [
    { vid: '3456', pid: '00A0', iface: 1, col: 1, page: 'FF00', usage: '0001', inLen: 17, outLen: 17, featLen: 0, inIds: [3], outIds: [3], featIds: [], product: 'Pro mouse' },
    { vid: '3456', pid: '00A0', iface: 0, col: null, page: '0001', usage: '0002', inLen: 8, outLen: 0, featLen: 0, inIds: [], outIds: [], featIds: [], product: 'Pro mouse' },
    { vid: '3710', pid: '5406', iface: 1, col: 5, page: 'FF02', usage: '0002', inLen: 17, outLen: 17, featLen: 0, inIds: [8], outIds: [8], featIds: [], product: 'Pulsar 8K Dongle' },
    { vid: '4567', pid: '0002', page: '0001', usage: '0006', inLen: 9, outLen: 2, featLen: 0, inIds: [], outIds: [], featIds: [], product: 'Plain keyboard' }] }),
  owned: () => ({ runs: ['3710:5406'], mine: [] }),
  startCapture: async () => { session.started++; session.state = { seq: 0, status: 'ready' }; return { started: true }; },
  writeCommand: (dir, text) => { session.cmds.push(text); const [seq, verb, arg] = text.split(' '); session.state = { seq: Number(seq), status: verb === 'start' ? 'recording' : verb === 'stop' ? 'stopped' : 'ended', take: arg }; },
  readState: () => session.state,
  readTake: (dir, name) => [pro.files[session.takeValue]],
  sleep: async () => {},
  loadNew: async () => null,
};
const route = async (method, step, body) => {
  let out = null;
  await lw.handle(new URL(`http://x/api/learn/${step}`), { method }, {}, (res, code, j) => { out = { code, ...j }; }, async () => body);
  return out;
};
const devs = await route('GET', 'devices');
check(devs.devices?.length === 2 && devs.devices[0].vid === '3456' && !devs.devices.some((d) => d.vid === '3710'), `the list has the devices DeviceHub does not run, vendor ones first, never its own (${JSON.stringify(devs.devices)})`);
check((await route('POST', 'begin', { vid: '3710', pid: '5406' })).ok === false, 'a device DeviceHub runs cannot be picked');
check((await route('POST', 'begin', { vid: '3456', pid: '00a0' })).ok, 'the Pro mouse is picked');
check((await route('POST', 'setting', { label: 'Firmware update', kind: 'toggle', values: ['on', 'off'] })).ok === false, 'a firmware control is never learned');
check((await route('POST', 'setting', { label: 'DPI', kind: 'number', values: ['400', '400'] })).ok === false, 'two equal values are refused');
check((await route('POST', 'listen')).ok && session.started === 1, 'listening starts once');
check((await route('POST', 'setting', { label: 'DPI', kind: 'number', unit: 'DPI', values: ['400', '16000'] })).ok, 'the setting and its two values are taken');
for (const v of [400, 16000]) {
  pro(v); session.takeValue = v;
  const s = await route('POST', 'record');
  check(s.ok && s.recording?.value === v, `recording ${v} starts (${s.error})`);
  const e = await route('POST', 'stop');
  check(e.ok && e.heard === 6, `recording ${v} stops with the Pro mouse's 6 messages (${e.error || e.heard})`);
}
check(session.cmds.every((c) => /^\d+ (start take-\d-[a-z0-9]+|stop|quit)$/.test(c)), `only start/stop commands go to the listener (${session.cmds.join(', ')})`);
const an = await route('POST', 'analyze');
check(an.ok && an.valueAt.offset === 1 && an.valueAt.size === 2 && an.range.step === 50, `the Pro DPI: bytes 1-2 after the report id, steps of 50 (${JSON.stringify(an.why || an.valueAt)})`);
const add = await route('POST', 'add', { min: 100, max: 20000, step: 50, title: 'Pro mouse', kind: 'Mouse' });
check(add.ok && add.driver?.transport.reportId === 3 && add.driver.fields.dpi.scale === 50 && add.driver.fields.dpi.add === 50 && add.driver.fields.dpi.endian === 'big' && add.driver.transport.usagePage === 'FF00',
  `the Pro driver.json: report id 3, big-endian, raw * 50 + 50, page FF00 (${JSON.stringify(add.why || add.driver?.fields)})`);
const saved = await route('POST', 'save', { title: 'Pro mouse', kind: 'Mouse' });
check(saved.ok && saved.saved?.name === 'pro-mouse' && fs.existsSync(path.join(root, 'my-devices', 'pro-mouse', 'driver.json')), `the Pro driver is saved (${JSON.stringify(saved.why || saved.error || saved.saved)})`);
check(session.cmds.at(-1).endsWith('quit'), 'saving ends the listener');
await route('POST', 'quit');

// ---------------------------------------------------------------- a device that already has a driver (22 Oct 2026)
// shown, not hidden; refused in plain words for shared chip ids, code drivers and drivers that never write; for a
// driver.json driver the learned settings go into its my-devices copy (backed up first), never the library's own copy
check(/Sinowealth/.test(lw.vendorRefusal('258a') || '') && /Laview/.test(lw.vendorRefusal('22D4') || '') && /Logitech/.test(lw.vendorRefusal('046d') || '') && lw.vendorRefusal('3456') === null, 'shared chip makers and code-only vendors are refused, others not');
{
  // a library entry whose driver never writes, for 7777:0001
  const nw = path.join(root, 'device-library', 'never-writes');
  fs.mkdirSync(nw, { recursive: true });
  fs.writeFileSync(path.join(nw, 'device.mjs'), "export default { id: 'never-writes', title: 'Quiet', kind: 'Mouse', settings: [{ key: 'fw', label: 'Firmware', type: 'display' }], async connect() { return true; }, async info() { return {}; }, async read() { return {}; }, async write() { throw new Error('never'); } };\n");
  fs.writeFileSync(path.join(nw, 'device.json'), JSON.stringify({ id: 'never-writes', vendor: 'Quiet', product: 'Mouse', kind: 'Mouse', vid: '7777', pids: ['0001'], models: ['Q'], works: [], status: 'untested', tested: [] }));
  const col = (vid, pid, product) => ({ vid, pid, iface: 1, col: 1, page: 'FF00', usage: '0001', inLen: 65, outLen: 65, featLen: 0, inIds: [], outIds: [], featIds: [], product });
  lw.options.deps = { ...lw.options.deps, owned: lw.deps.owned, listHid: async () => ({ collections: [col('1234', '5678', 'Acme mouse'), col('258A', '0036', 'Model O'), col('7777', '0001', 'Quiet mouse')] }) };
  const ds = (await route('GET', 'devices')).devices || [];
  const by = Object.fromEntries(ds.map((d) => [d.vid, d]));
  check(by['1234']?.library && by['1234'].note === 'already has a driver; Learn adds settings it lacks' && by['1234'].driver?.where === 'my-devices' && !by['1234'].refused, `a device with a driver.json driver in my-devices is listed with the note (${JSON.stringify(by['1234'])})`);
  check(by['258A']?.refused && /Sinowealth/.test(by['258A'].note), `a Sinowealth id is listed with why it cannot be learned (${JSON.stringify(by['258A'])})`);
  check(by['7777']?.refused && /refuses every write/.test(by['7777'].note), `a device whose library driver never writes says so (${JSON.stringify(by['7777'])})`);
  check(!ds.some((d) => d.driver?.dir), 'the page never gets a folder path');
  check(/Sinowealth/.test((await route('POST', 'begin', { vid: '258A', pid: '0036' })).error || ''), 'begin refuses a Sinowealth id with a plain reason');
  check(/refuses every write/.test((await route('POST', 'begin', { vid: '7777', pid: '0001' })).error || ''), 'begin refuses a device whose driver never writes');
  const bg = await route('POST', 'begin', { vid: '1234', pid: '5678' });
  check(bg.ok && bg.addsTo?.name === shared.name && bg.addsTo.where === 'my-devices', `begin on a covered device says where the settings go (${JSON.stringify(bg.addsTo || bg.error)})`);
  await route('POST', 'quit');

  // merging: a second setting learned on the Acme mouse goes into a copy of its driver
  const s2 = lw.withRange(L1, { min: 100, max: 26000, step: 50 }, ['dpi']).setting;
  s2.label = 'Second DPI';
  const add2 = lw.buildDriver({ vid: '1234', pid: '5678', title: 'Acme mouse', kind: 'Mouse', usagePage: 'FF00', usage: '0001', settings: [s2] });
  const merged = lw.mergeDriver(def1, add2);
  check(validate(merged).ok && merged.settings.map((x) => x.key).join() === `dpi,${s2.key}` && lw.verifySeen(merged, [s2]).length === 0 && merged.id === def1.id, `the merged driver keeps its own and adds the learned one, every byte as recorded (${validate(merged).problems.join('; ')})`);
  check(Object.keys(merged.messages).filter((k) => k.startsWith('learned')).length === Object.keys(add2.messages).length, 'the learned messages are added under their own names');
  let mErr = null; try { lw.mergeDriver(def1, { ...add2, transport: { ...add2.transport, len: 32 } }); } catch (e) { mErr = e.message; }
  check(/one driver\.json uses one kind/.test(mErr || ''), `another report kind is refused in plain words (${mErr})`);
  mErr = null; try { lw.mergeDriver(def1, def1); } catch (e) { mErr = e.message; }
  check(/already has a setting/.test(mErr || ''), 'a key the driver already has is refused');
  const libBefore = fs.readFileSync(path.join(root, 'device-library', shared.name, 'driver.json'), 'utf8');
  const copy = path.join(root, 'my-devices', shared.name);
  const sv2 = lw.saveInto(copy, merged, [s2.key], { root });
  const mk = JSON.parse(fs.readFileSync(path.join(copy, 'library.json'), 'utf8'));
  check(sv2.ok && fs.existsSync(path.join(sv2.backup, 'driver.json')) && fs.existsSync(path.join(sv2.backup, 'library.json')), `the copy's files are backed up first (${JSON.stringify(sv2)})`);
  check(JSON.parse(fs.readFileSync(path.join(copy, 'driver.json'), 'utf8')).settings.length === 2 && mk.learnedKeys?.includes(s2.key), 'the copy gets the setting, and library.json lists it as learned');
  check(fs.readFileSync(path.join(root, 'device-library', shared.name, 'driver.json'), 'utf8') === libBefore, "the library's own copy is never edited");
  check(!lw.saveInto(path.join(root, 'device-library', shared.name), merged, [s2.key], { root }).ok, 'saveInto refuses any folder outside my-devices');
  const regM = [];
  await load(root, { register: (x) => regM.push(x), addSpec() {}, taken: (id) => regM.some((y) => y.id === id), selfCheck: {} });
  const am = regM.find((x) => x.plugin === shared.name);
  check(am && am.settings.find((x) => x.key === s2.key)?.readOnly, 'loaded guarded: the learned setting is read-only until its check');
}

// ---------------------------------------------------------------- readings (22 Oct 2026, docs/handoff/learn-readings.md)
// device 4: Arc headset (5555:0101). Output reports, no report id, 64 bytes. Battery: 06 01 -> 06 01 00 <percent>
// <charging>. ChatMix: the headset sends 45 <mode> 10 by itself when its wheel moves (1 game, 2 chat, 3 even); nothing
// asks for it. On its receiver (5555:0102) the same bytes; on a newer receiver (5555:0103) the battery read is 06 02.
const D4 = 5;
const hexOf = lw.hexOf;
function arc({ pid = 0x0101, pct = 55, charging = 0, mode = null, twin = false, cmd = 1 } = {}) {
  const r = new Rec();
  r.descriptor(D4, 0x5555, pid); r.descriptor(NOISE, 0x0BDA, 0x8153);
  for (let i = 0; i < 2; i++) { r.out(D4, pad([6, cmd], 64)); r.inp(D4, pad([6, cmd, 0, pct, charging], 64)); r.out(NOISE, pad([6, 1, 0, pct], 64)); }
  if (mode != null) { r.inp(D4, pad([0x45, 3, 0x10], 64)); r.inp(D4, pad([0x45, mode, twin ? mode + 5 : 0x10], 64)); }
  r.out(D4, pad([6, cmd], 64)); r.inp(D4, pad([6, cmd, 0, pct, charging], 64));
  return r.pcap();
}
const arcTake = (value, o) => ({ value, messages: lw.takeMessages([arc(o)], { vid: '5555', pid: (o?.pid ?? 0x0101).toString(16).padStart(4, '0') }).messages });
{
  // the analysis alone
  let a = lw.analyzeReading([arcTake(55, { pct: 55 })], { label: 'Battery', kind: 'reading', role: 'battery' });
  check(a.ok && a.learned.read?.field.offset === 3 && a.learned.read.data[0] === 6 && a.learned.read.data[1] === 1 && !a.learned.write && !a.learned.notice,
    `battery: one recording finds the byte that matches the percent the app showed, in the reply to 06 01 (${JSON.stringify(a.why || a.learned?.read?.field)})`);
  a = lw.analyzeReading([arcTake(1, { pct: 1, charging: 1 })], { label: 'Battery', kind: 'reading', role: 'battery' });
  check(!a.ok && a.ambiguous && a.needMore && /another percent/.test((a.why || []).join(' ')), `battery: two bytes match the percent, so it asks for another percent (${(a.why || []).join(' ')})`);
  a = lw.analyzeReading([arcTake(1, { pct: 1, charging: 1 }), arcTake(2, { pct: 2, charging: 1 })], { label: 'Battery', kind: 'reading', role: 'battery' });
  check(a.ok && a.learned.read.field.offset === 3, `battery: a second percent settles it (${JSON.stringify(a.why)})`);
  check(!lw.analyzeReading([arcTake(150, {})], { label: 'Battery', kind: 'reading', role: 'battery' }).ok, 'a battery level above 100 is refused');
  a = lw.analyzeReading([arcTake('game', { mode: 1 }), arcTake('chat', { mode: 2 })], { label: 'ChatMix', kind: 'reading', role: 'display' });
  check(a.ok && a.learned.notice && hexOf(a.learned.notice.starts) === '45' && a.learned.notice.field.offset === 1 && same(a.learned.notice.field.codes, [1, 2]) && !a.learned.read,
    `ChatMix: the report the headset sends by itself (45 ...), one code per value at byte 1 (${JSON.stringify(a.why || a.learned?.notice)})`);
  a = lw.analyzeReading([arcTake('game', { mode: 1, twin: true }), arcTake('chat', { mode: 2, twin: true })], { label: 'ChatMix', kind: 'reading' });
  check(!a.ok && a.ambiguous && a.needMore && /More than one place/.test((a.why || []).join(' ')), `two bytes moving with ChatMix: ambiguous, ask for a third value (${(a.why || []).join(' ')})`);
  a = lw.analyzeReading([arcTake('game', { mode: 1, twin: true }), arcTake('chat', { mode: 2, twin: true }), arcTake('even', { mode: 3, twin: true })], { label: 'ChatMix', kind: 'reading' });
  check(!a.ok && a.ambiguous && !a.needMore && /cannot be learned/.test((a.why || []).join(' ')), `still two places after a third value: refused (${(a.why || []).join(' ')})`);
  a = lw.analyzeReading([arcTake(7, {}), arcTake(9, {})], { label: 'Mic level', kind: 'reading' });
  check(!a.ok && /found nothing/.test((a.why || []).join(' ')), `a value nothing carries: refused in plain words (${(a.why || []).join(' ')})`);
  check(!lw.analyzeReading([arcTake('game', { mode: 1 })], { label: 'ChatMix', kind: 'reading' }).ok, 'a reading other than the battery needs two values');
}

// through the route: battery, charging and ChatMix learned, saved, then learned again on the receiver's USB id
const arcCol = (pid) => ({ vid: '5555', pid, iface: 3, col: 1, page: 'FF00', usage: '0001', inLen: 65, outLen: 65, featLen: 0, inIds: [], outIds: [], featIds: [], product: 'Arc headset' });
let arcFile = null;
lw.reset();
lw.options.deps = { ...lw.options.deps, owned: () => ({ runs: [], mine: [], copies: [] }), listHid: async () => ({ collections: [arcCol('0101'), arcCol('0102'), arcCol('0103')] }), readTake: () => [arcFile] };
check(/Save a driver first/.test((await route('GET', 'devices'), await route('POST', 'second', { vid: '5555', pid: '0102' })).error || ''), 'the other USB id is offered only after a save');
check((await route('POST', 'begin', { vid: '5555', pid: '0101' })).ok && (await route('POST', 'listen')).ok, 'the Arc headset is picked and listened to');
const learnIt = async (setting, files) => {
  const s = await route('POST', 'setting', setting);
  if (!s.ok) return s;
  for (const f of files) { arcFile = f; const r1 = await route('POST', 'record'); if (!r1.ok) return r1; const r2 = await route('POST', 'stop'); if (!r2.ok) return r2; }
  const an = await route('POST', 'analyze');
  if (!an.ok) return an;
  return { an, add: await route('POST', 'add', { title: 'Arc headset', kind: 'Headset' }) };
};
let lr = await learnIt({ kind: 'reading', role: 'battery', values: ['55'] }, [arc({ pct: 55 })]);
check(lr.an?.kind === 'reading' && lr.an.role === 'battery' && lr.add?.ok && lr.add.driver.battery?.percent === 'battery', `the battery level is learned from one recording (${JSON.stringify(lr.why || lr.error || lr.add?.why)})`);
lr = await learnIt({ kind: 'reading', role: 'charging' }, [arc({ charging: 1 }), arc({ charging: 0 })]);
check(lr.add?.ok && lr.add.driver.battery?.charging === 'charging' && same(lr.add.driver.fields.charging.map, { 0: false, 1: true }), `charging is learned on and off and goes with the battery (${JSON.stringify(lr.why || lr.error || lr.add?.why)})`);
check((await route('POST', 'setting', { kind: 'reading', role: 'battery', values: ['200'] })).ok === false, 'a percent above 100 is refused');
lr = await learnIt({ kind: 'reading', role: 'display', label: 'ChatMix', values: ['game', 'chat'] }, [arc({ mode: 1 }), arc({ mode: 2 })]);
const arcDef = lr.add?.driver;
check(lr.add?.ok && arcDef.reads.some((r) => r.notice?.starts === '45') && arcDef.settings.length === 1 && arcDef.settings[0].type === 'display' && !arcDef.settings[0].write && same(arcDef.fields.chatmix.map, { 1: 'game', 2: 'chat' }),
  `ChatMix becomes a display read from the report the headset sends by itself (${JSON.stringify(lr.why || lr.error || lr.add?.why)})`);
if (arcDef) {
  check(Object.keys(arcDef.messages).join() === 'read1' && arcDef.messages.read1.bytes === '06 01' && arcDef.hid.reply === 'raw' && validate(arcDef).ok,
    `the only message is the battery read seen in the recording, and the channel listens raw (${JSON.stringify(arcDef.messages)} ${validate(arcDef).problems.join('; ')})`);
  check(!arcDef.settings.some((s) => s.write) && !Object.keys(arcDef.messages).some((k) => k.startsWith('set')), 'nothing is ever written for a reading');
}
let svArc = await route('POST', 'save', { title: 'Arc headset', kind: 'Headset' });
check(svArc.ok && svArc.saved?.canSecond && fs.existsSync(path.join(root, 'my-devices', 'arc-headset', 'driver.json')), `the Arc driver is saved and offers its other USB id (${JSON.stringify(svArc.why || svArc.error)})`);

// the saved driver, driven: it asks only for the battery and hears ChatMix when the headset sends it
const hidMod = await import('../public/devices/hid.js');
function fakeArc(pid, cmd = 1, { raw = true } = {}) {
  const st = { pct: 40, charging: 1, queue: [], sent: [] };
  const listeners = new Set();
  const dev = { vendorId: 0x5555, productId: pid, productName: 'Arc', opened: true, async open() {},
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    emit(b) { const u = Uint8Array.from(pad(b, 64)); listeners.forEach((f) => f({ reportId: 0, data: new DataView(u.buffer) })); },
    async sendReport(id, d) { st.sent.push(hexOf(d.slice(0, 4))); if (d[0] === 6 && d[1] === cmd) setTimeout(() => this.emit([6, cmd, 0, st.pct, st.charging]), 1); } };
  if (raw) dev.receiveReports = async () => { const q = st.queue; st.queue = []; return q.map((b) => ({ reportId: 0, data: new DataView(Uint8Array.from(pad(b, 64)).buffer) })); };
  return { dev, st };
}
const drive = async (def, fake) => {
  hidMod.setDeviceProvider(async (filters) => (filters.some((f) => f.productId === fake.dev.productId) ? fake.dev : null));
  const drv = fromJson(def); drv.vendorApp = async () => null;
  return { drv, connected: await drv.connect() };
};
if (arcDef) {
  const fk = fakeArc(0x0101);
  const { drv, connected } = await drive(JSON.parse(fs.readFileSync(path.join(root, 'my-devices', 'arc-headset', 'driver.json'), 'utf8')), fk);
  const r0 = await drv.read();
  fk.st.queue.push([0x45, 2, 0x10]);
  drv.snap = null;
  const r1 = await drv.read(), bt = await drv.battery();
  check(connected && !('chatmix' in r0) && r1.chatmix === 'chat' && bt?.percent === 40 && bt.charging === true, `it reads the battery and charging, and ChatMix once the headset sends it (${JSON.stringify([r0, r1, bt])})`);
  check(fk.st.sent.length > 0 && fk.st.sent.every((x) => x === '06 01 00 00'), `it sent only the battery read it heard the app send (${fk.st.sent})`);
  let refusedW = null; try { await drv.write('chatmix', 'game'); } catch (e) { refusedW = e.message; }
  check(/read only|reading|not a setting/.test(refusedW || ''), `a reading cannot be written (${refusedW})`);
  // without a raw channel (a browser): a report that answers nothing is still heard
  const fb = fakeArc(0x0101, 1, { raw: false });
  const b2 = await drive(arcDef, fb);
  fb.dev.emit([0x45, 1, 0x10]);
  b2.drv.snap = null;
  check((await b2.drv.read()).chatmix === 'game', 'with no raw channel, ChatMix is heard from the input reports');
}
const regA = [];
await load(root, { register: (x) => regA.push(x), addSpec() {}, taken: (id) => regA.some((y) => y.id === id), selfCheck: {} });
const arcA = regA.find((x) => x.plugin === 'arc-headset');
check(arcA && typeof arcA.battery === 'function' && arcA.settings.find((x) => x.key === 'chatmix')?.readOnly, 'my-devices loads it with its battery for the tile, ChatMix read only');

// the same headset on its receiver (5555:0102): the same bytes, so the id is added to the same driver
check(/learned on/.test((await route('POST', 'second', { vid: '5555', pid: '0101' })).error || ''), 'the id it was learned on is refused for the second id');
let sc = await route('POST', 'second', { vid: '5555', pid: '0102', link: 'receiver' });
check(sc.ok && sc.second?.total === 3 && sc.second.next?.label === 'Battery' && sc.second.link === 'receiver', `the receiver's id starts a session for the same three readings (${JSON.stringify(sc.error || sc.second)})`);
check((await route('POST', 'listen')).ok, 'listening starts again for the second id');
const second = async (pid, cmd = 1, { early = null } = {}) => {
  const o = { pid, cmd };
  for (const [set, files] of [[{ values: ['40'] }, [arc({ ...o, pct: 40 })]], [{}, [arc({ ...o, charging: 1 }), arc({ ...o, charging: 0 })]], [{ values: ['ignored'] }, [arc({ ...o, mode: 1 }), arc({ ...o, mode: 2 })]]]) {
    const r = await learnIt(set, files);
    if (!r.add?.ok) return r;
    if (early && !early.done) { early.done = await route('POST', 'save', {}); }
  }
  return route('POST', 'save', {});
};
const early = {};
let s2 = await second(0x0102, 1, { early });
check(/Learn Charging on this id too/.test((early.done?.why || []).join(' ')), `the id is not added before every setting is learned on it (${JSON.stringify(early.done)})`);
const arcFile2 = path.join(root, 'my-devices', 'arc-headset', 'driver.json');
let d2 = JSON.parse(fs.readFileSync(arcFile2, 'utf8'));
check(s2.ok && s2.saved?.same === true && /same bytes/.test(s2.saved.note), `the same bytes on the receiver: the id is added (${JSON.stringify(s2.why || s2.error || s2.saved)})`);
check(same(d2.pids, ['0101', '0102']) && d2.links.receiver?.wireless === true && same(d2.models[0].pids.receiver, ['0102']) && same(d2.hid.pids, ['0101', '0102']) && !d2.byPid && validate(d2).ok,
  `one driver, two ids, no copy of the bytes (${JSON.stringify({ pids: d2.pids, links: d2.links, hid: d2.hid })})`);
check(fs.readdirSync(path.join(root, 'backups')).some((x) => x.startsWith('learn-arc-headset-')), 'the driver was backed up before the id was added');

// a newer receiver (5555:0103) that asks for the battery with 06 02: its own bytes are kept for that id (byPid)
sc = await route('POST', 'second', { vid: '5555', pid: '0103', link: 'receiver' });
await route('POST', 'listen');
s2 = await second(0x0103, 2);
d2 = JSON.parse(fs.readFileSync(arcFile2, 'utf8'));
check(s2.ok && s2.saved?.same === false && d2.byPid?.['0103']?.messages?.read1?.bytes === '06 02' && d2.messages.read1.bytes === '06 01' && same(d2.pids, ['0101', '0102', '0103']) && d2.links.receiver2,
  `other bytes on 0103: kept under byPid for that id only (${JSON.stringify(s2.why || s2.error || d2.byPid)})`);
check(validate(d2).ok && lw.verifySeen(d2, [], { pid: '0103' }).length === 0, `the file with byPid passes validate() (${validate(d2).problems.join('; ')})`);
{
  const f3 = fakeArc(0x0103, 2);
  const { drv, connected } = await drive(d2, f3);
  const bt = await drv.battery();
  check(connected && bt?.percent === 40 && f3.st.sent.every((x) => x === '06 02 00 00'), `on 0103 it sends that id's own read, 06 02, and nothing else (${f3.st.sent} ${JSON.stringify(bt)})`);
  const f1 = fakeArc(0x0101, 1);
  const one1 = await drive(d2, f1);
  await one1.drv.battery();
  check(one1.connected && f1.st.sent.every((x) => x === '06 01 00 00'), `on 0101 it still sends 06 01 (${f1.st.sent})`);
}
hidMod.setDeviceProvider(null);
await route('POST', 'quit');

// addPid on its own, with a setting that is written (the Acme mouse's DPI)
{
  const t5 = takesOf([acme(800, { pid: 0x5679 }), acme(1600, { pid: 0x5679 })], '1234', '5679');
  const s5 = { ...lw.withRange(lw.analyze(t5, { label: 'DPI', kind: 'number' }).learned, { min: 100, max: 26000, step: 50 }).setting, key: 'dpi' };
  const other = lw.buildDriver({ vid: '1234', pid: '5679', title: 'Acme mouse', kind: 'Mouse', usagePage: 'FF00', usage: '0001', settings: [s5] });
  const ap = lw.addPid(def1, other, { pid: '5679' });
  check(ap.same && validate(ap.def).ok && lw.verifySeen(ap.def, [rg.setting]).length === 0 && lw.verifySeen(ap.def, [s5], { pid: '5679' }).length === 0 && ap.def.links.cable && !ap.def.byPid,
    `the same DPI bytes on the cable's id: added as another id (${validate(ap.def).problems.join('; ')})`);
  const t6 = takesOf([acme(800, { pid: 0x567a, rd: 0x82 }), acme(1600, { pid: 0x567a, rd: 0x82 })], '1234', '567A');
  const s6 = { ...lw.withRange(lw.analyze(t6, { label: 'DPI', kind: 'number' }).learned, { min: 100, max: 26000, step: 50 }).setting, key: 'dpi' };
  const other6 = lw.buildDriver({ vid: '1234', pid: '567A', title: 'Acme mouse', kind: 'Mouse', usagePage: 'FF00', usage: '0001', settings: [s6] });
  const ap6 = lw.addPid(def1, other6, { pid: '567A' });
  check(!ap6.same && ap6.def.byPid?.['567A']?.messages?.read1?.bytes === '05 82' && validate(ap6.def).ok && lw.verifySeen(ap6.def, [s6], { pid: '567A' }).length === 0 && lw.verifySeen(ap6.def, [rg.setting]).length === 0,
    `another read on 567A: that id's own bytes under byPid, both ids proven against their own recordings (${validate(ap6.def).problems.join('; ')})`);
  check(lw.verifySeen(ap6.def, [s5], { pid: '567A' }).some((x) => /not the one recorded/.test(x)), 'a recording from the other id does not pass for 567A');
  const dd = fromJson(ap6.def);
  dd.usePid('567A'); const b1 = hexOf(dd.build('read1').data.slice(0, 2));
  dd.usePid('5678'); const b0 = hexOf(dd.build('read1').data.slice(0, 2));
  check(b1 === '05 82' && b0 === '05 81', `the driver builds each id's own read (${b0} / ${b1})`);
  let e1 = null; try { lw.addPid(def1, other, { pid: '5678' }); } catch (e) { e1 = e.message; }
  check(/already/.test(e1 || ''), 'an id the driver has is refused');
  const odd = JSON.parse(JSON.stringify(other)); odd.settings[0].max = 12000;
  e1 = null; try { lw.addPid(def1, odd, { pid: '5679' }); } catch (e) { e1 = e.message; }
  check(/came out different/.test(e1 || ''), `a setting with another range is refused (${e1})`);
}

// ---------------------------------------------------------------- Learn without typing (22 Oct 2026, docs/handoff/learn-no-typing.md)
// The maker's app is named (installed, running), the settings come as a tick-list (the app's own files, else the brand
// sheet, else the usual list), and a stand-in app-ui (no real window) changes each one while DeviceHub records, then
// puts it back. A pretend Kite mouse (1B1C:7F01, Corsair's vendor id): output reports with report id 3, 16 bytes.
// DPI: read 21 -> 21 00 <raw u16be>, set 22 <raw u16be> (raw = dpi / 50). Lift-off: read 24 -> 24 00 <code>, set 23 <code>
// (Low 1, High 2).
{
  const la = await import('../helpers/learn-apps.mjs');
  const { scan: vendorScan } = await import('../helpers/vendor-files.mjs');
  const kite = (what, v) => {
    const r = new Rec(), D = 11;
    r.descriptor(D, 0x1B1C, 0x7F01);
    if (what === 'dpi') {
      const raw = v;
      r.out(D, [3, ...pad([0x21], 16)]); r.inp(D, [3, ...pad([0x21, 0, 0, 24], 16)]);
      r.out(D, [3, ...pad([0x22, raw >> 8, raw & 255], 16)]); r.inp(D, [3, ...pad([0x22, 0], 16)]);
      r.out(D, [3, ...pad([0x21], 16)]); r.inp(D, [3, ...pad([0x21, 0, raw >> 8, raw & 255], 16)]);
    } else {
      const code = { Low: 1, High: 2 }[v];
      r.out(D, [3, ...pad([0x24], 16)]); r.inp(D, [3, ...pad([0x24, 0, 1], 16)]);
      r.out(D, [3, ...pad([0x23, code], 16)]); r.inp(D, [3, ...pad([0x23, 0], 16)]);
      r.out(D, [3, ...pad([0x24], 16)]); r.inp(D, [3, ...pad([0x24, 0, code], 16)]);
    }
    return r.pcap();
  };
  const kiteCol = { vid: '1B1C', pid: '7F01', iface: 1, col: 1, page: 'FF00', usage: '0001', inLen: 17, outLen: 17, featLen: 0, inIds: [3], outIds: [3], featIds: [], product: 'Kite mouse' };
  const mouseCol = { ...kiteCol, iface: 0, page: '0001', usage: '0002', inLen: 8, outLen: 0, inIds: [], outIds: [] };

  // stand-in maker's files: iCUE installed, its device list with the Kite's DPI range, its saved settings
  const pc = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learn-pc-'));
  const env = { ProgramFiles: path.join(pc, 'pf'), 'ProgramFiles(x86)': path.join(pc, 'pf86'), ProgramData: path.join(pc, 'pd'), LOCALAPPDATA: path.join(pc, 'la'), APPDATA: path.join(pc, 'ra') };
  const put = (rel, text) => { const f = path.join(pc, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('pf/Corsair/Corsair iCUE5 Software/iCUE.exe', '');
  put('la/Corsair/CUE5/cache/devices.json', JSON.stringify({ devices: [{ vid: 6940, pid: 32513, name: 'Kite mouse', type: 'mouse', settings: [{ name: 'DPI', min: 100, max: 26000, step: 50 }, { name: 'Firmware update', min: 0, max: 1 }] }, { vid: 6940, pid: 2600, name: 'Other mouse', settings: [{ name: 'Debounce', min: 1, max: 30 }] }] }));
  put('ra/Corsair/CUE5/config.cuecfg', '<?xml version="1.0"?><root><map name="Devices"><map name="Kite mouse"><map name="{0a1b2c3d-1111-2222-3333-444455556666}"><value name="AngleSnapping">true</value><value name="PairingMode">false</value><value name="DeviceSerial">X</value></map></map></map></root>');
  let running = '"iCUE.exe","4242","Console","1","200,000 K"';
  const maker = (vid) => la.findMaker(vid, { env, list: async () => running, names: async () => [] });

  // the maker's app
  const m1 = await maker('1B1C');
  check(m1.known && m1.name === 'Corsair iCUE' && m1.installed && m1.running && m1.window === 'iCUE', `iCUE is found installed and open (${JSON.stringify(m1)})`);
  const m2 = await la.findMaker('1038', { env, list: async () => '', names: async () => [] });
  check(m2.known && !m2.installed && !m2.running && m2.name === 'SteelSeries GG' && /^https:\/\/steelseries\.com\//.test(m2.page), `an app that is not installed: its official name and page (${JSON.stringify(m2)})`);
  const m3 = await la.findMaker('1038', { env, list: async () => '', names: async () => ['SteelSeries GG 82.0.0'] });
  check(m3.installed && !m3.running, 'an app found only in Windows\' installed programs counts as installed');
  check(!(await la.findMaker('7777', { env, list: async () => '', names: async () => [] })).known, 'an unknown maker is said to be unknown');
  check(la.makerOf('3434')?.web && la.MAKERS.every((x) => /^https:\/\//.test(x.page)), 'every maker has an https page; Keychron\'s is a web app');
  check(la.FORBIDDEN.test('Firmware update') && la.FORBIDDEN.test('Pairing') && la.FORBIDDEN.test('Delete profile') && la.FORBIDDEN.test('Factory reset') && !la.FORBIDDEN.test('DPI'), 'app-ui\'s refusal list, plus pairing, is reused');

  // the kind of device
  check(la.deviceKind({ name: 'Kite mouse' }) === 'mouse' && la.deviceKind({ name: 'HS80 RGB Wireless Gaming Headset' }) === 'headset' && la.deviceKind({ name: 'X', collections: [{ page: '0001', usage: '0006' }] }) === 'keyboard' && la.deviceKind({ name: 'X', collections: [] }) === 'device', 'the device kind comes from its name, then its collections');

  // the tick-list from the app's own files
  const p1 = await la.plan({ vid: '1B1C', pid: '7F01', name: 'Kite mouse', collections: [mouseCol] }, { root: REAL, maker, scan: (vid) => vendorScan({ vid, env }) });
  const by1 = Object.fromEntries(p1.items.map((i) => [i.label, i]));
  check(p1.from === 'files' && by1.DPI?.kind === 'number' && by1.DPI.range?.min === 100 && by1.DPI.range.max === 26000 && by1.DPI.range.step === 50 && same(by1.DPI.values, [800, 3200]) && /iCUE/.test(by1.DPI.source) && by1.DPI.ticked,
    `the app's own DPI range for this model, two values far apart, ticked (${JSON.stringify(by1.DPI)})`);
  check(by1['Angle snapping']?.kind === 'toggle' && same(by1['Angle snapping'].values, [true, false]), `a saved on/off setting becomes a toggle (${JSON.stringify(p1.items.map((i) => i.label))})`);
  check(!p1.items.some((i) => /firmware|pair|serial/i.test(i.label)) && !by1.Debounce?.range, 'never a firmware, pairing or id item; another model\'s range is not used');
  check(p1.items.filter((i) => i.label === 'DPI').length === 1, 'one item per setting (the brand sheet\'s DPI is not listed twice)');
  check(p1.items.every((i) => i.kind !== 'reading' || !i.ticked), 'readings are never ticked by themselves');
  // the brand sheet when the app left nothing: a SteelSeries headset
  const p2 = await la.plan({ vid: '1038', pid: '12AA', name: 'Arctis Nova 7', collections: [] }, { root: REAL, maker: async () => m2, scan: async () => ({ apps: [] }) });
  const l2 = p2.items.map((i) => i.label);
  check(p2.from === 'brand' && l2.includes('Sidetone') && l2.includes('Auto-off') && !l2.some((x) => /eq|light|dpi|firmware/i.test(x)), `a SteelSeries headset's settings come from its brand sheet (${l2.join(', ')})`);
  check(p2.items.every((i) => ['number', 'toggle', 'choice', 'reading'].includes(i.kind) && (i.kind === 'reading' || (i.values.length === 2 && !same(i.values[0], i.values[1])))), 'each item has a kind and two different values');
  // the usual list for a kind
  const p3 = await la.plan({ vid: '7777', pid: '0001', name: 'Plain mouse', collections: [] }, { root: REAL, maker: async () => ({ known: false }), scan: async () => ({ apps: [] }) });
  check(p3.from === 'usual' && p3.items.map((i) => i.label).join() === 'DPI,Polling rate,Lift-off,Debounce' && p3.items.every((i) => i.ticked), `an unknown mouse gets DPI, Polling rate, Lift-off, Debounce (${p3.items.map((i) => i.label)})`);
  check(la.genericItems('keyboard').map((i) => i.label).join() === 'Brightness,Report rate' && la.genericItems('headset').map((i) => i.label).join() === 'Sidetone,Auto-off', 'a keyboard gets Brightness and Report rate; a headset Sidetone and Auto-off');
  check(same(la.valuesIn({ min: 100, max: 1000, step: 100 }, null), [300, 800]) && same(la.valuesIn({ min: 100, max: 26000, step: 50 }, la.PRESETS[0]), [800, 3200]), 'values inside a range: the usual ones when they fit, else a quarter and three quarters of the way');

  // ---- through the route, with a stand-in app-ui: a pretend iCUE window (no real window is opened)
  const cap = { state: null, cmds: [] };
  const app = { controls: {}, calls: [], failRestore: false, sending: null, changes: 0 };
  const resetApp = () => {
    app.controls = {
      DPI: { type: 'Slider', name: 'DPI', id: 'trackDpi', class: 'x', enabled: true, value: 1200, min: 100, max: 26000, step: 50, readOnly: false },
      'Polling rate': { type: 'ComboBox', name: 'Polling rate', id: 'fwUpdatePolling', class: 'x', enabled: true, selected: '1000 Hz' },
    };
    app.calls = []; app.failRestore = false; app.sending = null; app.changes = 0; app.first = 1200;
  };
  resetApp();
  const arg = (a, k) => a[a.indexOf(k) + 1];
  const appUi = async (a) => {
    app.calls.push(a);
    const c = app.controls[arg(a, '-Name')];
    if (!c) return { code: 2, out: `no control named "${arg(a, '-Name')}" in "iCUE"` };
    if (a[0] === 'get') return { code: 0, out: JSON.stringify(c) };
    if (a[0] !== 'set') return { code: 2, out: 'not a stand-in command' };
    if (/firmware|update|reset|factory|flash|bootloader|delete|format/i.test(`${c.name} ${c.id}`)) return { code: 4, out: 'REFUSED' };
    const v = Number(arg(a, '-Value'));
    if (app.failRestore && app.changes >= 2) return { code: 1, out: 'the slider refused the value' };
    const old = c.value; c.value = v; app.changes++;
    app.sending = { what: 'dpi', v };   // the app sends the new value to the device while DeviceHub records
    return { code: 0, out: `Slider "DPI" set: ${old} -> ${v} (read back ${v})` };
  };
  lw.reset();
  lw.options.root = root;
  lw.options.deps = {
    ...lw.deps,
    usbpcapInstalled: () => true,
    listHid: async () => ({ collections: [kiteCol, mouseCol] }),
    owned: () => ({ runs: [], mine: [], copies: [] }),
    startCapture: async () => { cap.state = { seq: 0, status: 'ready' }; return { started: true }; },
    writeCommand: (dir, text) => { cap.cmds.push(text); const [seq, verb] = text.split(' '); cap.state = { seq: Number(seq), status: verb === 'start' ? 'recording' : verb === 'stop' ? 'stopped' : 'ended' }; if (verb === 'start') app.sending = null; },
    readState: () => cap.state,
    readTake: () => (app.sending ? [kite(app.sending.what, app.sending.v)] : []),
    sleep: async () => {},
    loadNew: async () => null,
    plan: (dev) => la.plan(dev, { root: REAL, maker, scan: (vid) => vendorScan({ vid, env }) }),
    appUi,
  };
  const r0 = await route('GET', 'devices');
  check(r0.devices?.length === 1 && r0.devices[0].pid === '7F01', `one device to learn: the Kite (${JSON.stringify(r0.devices?.map((x) => x.name))})`);
  check((await route('POST', 'begin', { vid: '1B1C', pid: '7F01' })).ok, 'the Kite is picked');
  const pl = await route('GET', 'plan');
  check(pl.ok && pl.maker?.name === 'Corsair iCUE' && pl.maker.running && pl.kind === 'mouse' && pl.items.some((i) => i.label === 'DPI'), `the plan names iCUE (open) and the Kite's settings (${JSON.stringify(pl.maker || pl.error)})`);
  check((await route('GET', 'state')).maker?.name === 'Corsair iCUE', 'the state carries the maker\'s app');
  check(/not listening/.test((await route('POST', 'setting', { label: 'DPI', kind: 'number', unit: 'DPI', values: [800, 3200] })).ok && (await route('POST', 'drive')).error), 'driving waits for the listener');
  check((await route('POST', 'listen')).ok, 'listening starts');

  // drive DPI: 800, then 3200, each recorded, then back to 1200 (the value read first)
  const dv = await route('POST', 'drive');
  const sets = app.calls.filter((a) => a[0] === 'set').map((a) => arg(a, '-Value'));
  check(dv.ok && dv.driven && dv.takes?.length === 2 && same(dv.takes.map((t) => t.value), [800, 3200]), `DPI is driven and both values recorded (${JSON.stringify(dv.why || dv.error || dv.takes)})`);
  check(same(sets, ['800', '3200', '1200']) && app.controls.DPI.value === 1200, `app-ui sets 800, 3200, then puts back 1200 (${sets.join(', ')})`);
  check(dv.restore?.ok && dv.restore.value === 1200, `the restore is read back (${JSON.stringify(dv.restore)})`);
  check(app.calls.every((a) => ['get', 'set'].includes(a[0]) && arg(a, '-Name') === 'DPI' && arg(a, '-Window') === 'iCUE'), 'app-ui only ever gets and sets the ticked setting\'s control, never presses anything');
  check(dv.range?.min === 100 && dv.range.max === 26000 && dv.range.step === 50, `the slider's own range comes back (${JSON.stringify(dv.range)})`);
  check(cap.cmds.filter((c) => / start /.test(c)).length === 2 && cap.cmds.filter((c) => / stop$/.test(c) || /\d stop$/.test(c)).length === 2, `two recordings, each started and stopped (${cap.cmds.join(', ')})`);
  const an2 = await route('POST', 'analyze');
  check(an2.ok && an2.valueAt.offset === 1 && an2.valueAt.size === 2, `the driven recordings are learned (${JSON.stringify(an2.why || an2.valueAt)})`);
  const ad2 = await route('POST', 'add', { ...dv.range, title: 'Kite mouse', kind: 'Mouse' });
  check(ad2.ok && ad2.learned?.[0]?.min === 100 && ad2.learned[0].max === 26000, `added with the app's range (${JSON.stringify(ad2.why || ad2.learned)})`);

  // a control whose id says firmware update: never touched, the person is asked instead
  app.calls = [];
  check((await route('POST', 'setting', { label: 'Polling rate', kind: 'choice', values: ['125 Hz', '1000 Hz'] })).ok, 'Polling rate is named');
  const dr = await route('POST', 'drive');
  check(dr.ok && dr.manual && /never touches/.test(dr.why) && !app.calls.some((a) => a[0] === 'set') && !dr.restore, `a control named like a firmware update is never set (${JSON.stringify(dr.why)})`);
  // a setting the app does not show: the person changes it, DeviceHub listens (the manual fallback)
  app.calls = [];
  check((await route('POST', 'setting', { label: 'Lift-off', kind: 'choice', values: ['Low', 'High'] })).ok, 'Lift-off is named');
  const dn = await route('POST', 'drive');
  check(dn.ok && dn.manual && /could not find Lift-off in Corsair iCUE/.test(dn.why) && !app.calls.some((a) => a[0] === 'set') && !dn.takes.length, `a control not found: nothing changed, the person is asked (${JSON.stringify(dn.why)})`);
  for (const v of ['High', 'Low']) {
    const s = await route('POST', 'record', { value: v });
    app.sending = { what: 'lift', v };   // the person changes it in the app
    const e = await route('POST', 'stop');
    check(s.ok && e.ok && e.heard === 6, `the person's change to ${v} is recorded (${s.error || e.error})`);
  }
  const an3 = await route('POST', 'analyze');
  check(an3.ok && an3.kind === 'choice', `Lift-off is learned from the person's changes (${JSON.stringify(an3.why)})`);
  check((await route('POST', 'add', { title: 'Kite mouse', kind: 'Mouse' })).ok, 'Lift-off is added');
  const sv = await route('POST', 'save', { title: 'Kite mouse', kind: 'Mouse' });
  const kdef = sv.ok ? JSON.parse(fs.readFileSync(path.join(root, 'my-devices', sv.saved.name, 'driver.json'), 'utf8')) : null;
  const kmark = sv.ok ? JSON.parse(fs.readFileSync(path.join(root, 'my-devices', sv.saved.name, 'library.json'), 'utf8')) : null;
  check(kdef && kdef.settings.map((s) => s.key).join() === 'dpi,liftOff' && kmark.status === 'read-only', `one driver.json with both settings, saved read-only (${JSON.stringify(sv.why || sv.error || kdef?.settings?.map((s) => s.key))})`);
  await route('POST', 'quit');

  // the app already shows the first value: the second goes first, and it ends where it began
  resetApp(); app.controls.DPI.value = 800;
  await route('POST', 'begin', { vid: '1B1C', pid: '7F01' }); await route('GET', 'plan'); await route('POST', 'listen');
  await route('POST', 'setting', { label: 'DPI', kind: 'number', values: [800, 3200] });
  const dw = await route('POST', 'drive');
  const sets2 = app.calls.filter((a) => a[0] === 'set').map((a) => arg(a, '-Value'));
  check(dw.driven && same(dw.takes.map((t) => t.value), [3200, 800]) && same(sets2, ['3200', '800', '800']) && dw.restore?.ok, `when the app shows 800 already, 3200 is recorded first (${sets2.join(', ')})`);
  // values outside the slider's range are moved inside it
  resetApp(); app.controls.DPI.max = 2000;
  await route('POST', 'setting', { label: 'DPI', kind: 'number', values: [800, 3200] });
  const dx = await route('POST', 'drive');
  check(dx.driven && dx.takes.every((t) => t.value >= 100 && t.value <= 2000) && dx.restore?.ok, `values outside the slider's range are moved inside it (${JSON.stringify(dx.takes)})`);
  // a restore that fails is said plainly, with the value it had
  resetApp(); app.failRestore = true;
  await route('POST', 'setting', { label: 'DPI', kind: 'number', values: [800, 3200] });
  const df = await route('POST', 'drive');
  check(df.driven && df.restore && !df.restore.ok && df.restore.value === 1200 && /could not put DPI back\. It was 1200 before: set it to 1200 in Corsair iCUE/.test(df.restore.why), `a failed restore says so, with the original value (${JSON.stringify(df.restore)})`);
  // the app not open: the person is asked, nothing is driven
  resetApp(); running = '';
  await route('POST', 'begin', { vid: '1B1C', pid: '7F01' });
  const pl2 = await route('GET', 'plan');
  await route('POST', 'listen');
  await route('POST', 'setting', { label: 'DPI', kind: 'number', values: [800, 3200] });
  const dc = await route('POST', 'drive');
  check(pl2.maker?.installed && !pl2.maker.running && dc.manual && /Corsair iCUE is not open/.test(dc.why) && !app.calls.length, `iCUE closed: nothing is driven, the person is asked (${JSON.stringify(dc.why)})`);
  // a reading is only listened for
  await route('POST', 'setting', { label: 'Battery', kind: 'reading', role: 'battery', values: ['80'] });
  check((await route('POST', 'drive')).manual, 'a reading is never driven');
  // a setting named like firmware is refused before anything
  check((await route('POST', 'setting', { label: 'Pairing mode', kind: 'toggle', values: ['on', 'off'] })).ok === false, 'a pairing setting is never learned');
  await route('POST', 'quit');
  lw.reset();
  fs.rmSync(pc, { recursive: true, force: true });
}

// ---------------------------------------------------------------- what it refuses
const why = (r) => (r.why || []).join(' ');
let r = lw.analyze(takesOf([acme(800, { twin: true }), acme(1600, { twin: true })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && r.ambiguous && r.needMore && /More than one message/.test(why(r)), `two messages carrying the value: ambiguous, ask for a third value (${why(r)})`);
r = lw.analyze(takesOf([acme(800, { twin: true }), acme(1600, { twin: true }), acme(2400, { twin: true })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && r.ambiguous && !r.needMore && /cannot be learned/.test(why(r)), `still ambiguous after a third value: refused (${why(r)})`);
r = lw.analyze(takesOf([acme(800, { counter: 1 }), acme(1600, { counter: 2 })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && /no bytes that hold DPI/.test(why(r)), `a counter byte moving beside the value: refused (${why(r)})`);
r = lw.analyze(takesOf([acme(800, { noRead: true }), acme(1600, { noRead: true })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && /no regular read/.test(why(r)), `no read reporting the value: refused (${why(r)})`);
r = lw.analyze(takesOf([acme(800, { noReply: true }), acme(1600, { noReply: true })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && /did not answer the write/.test(why(r)), `a write the device never answers: refused (${why(r)})`);
r = lw.analyze(takesOf([acme(800, { same: true, noRead: true }), acme(1600, { same: true, noRead: true })], '1234', '5678'), { label: 'DPI', kind: 'number' });
check(!r.ok && /exactly the same messages/.test(why(r)), `nothing changed between the values: refused (${why(r)})`);
check(!lw.analyze(t1.slice(0, 1), { label: 'DPI' }).ok, 'one recording is not enough');
// a learned template that matches DeviceHub's never list (ASUS 0B05: 50 40 is a reset) is refused by validate()
const asus = JSON.parse(JSON.stringify(def1));
Object.assign(asus, { vid: '0B05', pids: ['1A92'], hid: { ...asus.hid, vid: '0B05', pid: '1A92' }, models: [{ key: 'learned', name: 'x', pids: { usb: ['1A92'] } }] });
asus.messages.setDpi.bytes = '50 40 {value:u16le}';
const va = validate(asus);
check(!va.ok && va.problems.some((p) => /never list/.test(p)), `a template on the never list is refused (${va.problems.join('; ')})`);
check(lw.withRange({ ...L1, write: { ...L1.write, enc: { ...L1.write.enc, size: 1 } } }, { min: 100, max: 3000 }).why?.includes('one byte'), 'a range a one-byte value cannot hold is refused with a reason');

lw.reset();
fs.rmSync(root, { recursive: true, force: true });
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
console.log(fails.length ? `learn-wizard: FAILED:\n- ${fails.join('\n- ')}` : 'learn-wizard (made-up recordings: diff, driver.json, refusals, save read-only, share; maker app, tick-list, stand-in app-ui drive and restore): all good');
process.exit(fails.length ? 1 : 0);
