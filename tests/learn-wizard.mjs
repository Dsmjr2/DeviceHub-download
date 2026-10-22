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
function acme(value, { drag = null, counter = null, twin = false, noRead = false, noReply = false, same = false } = {}) {
  const r = new Rec();
  r.descriptor(D1, 0x1234, 0x5678); r.descriptor(NOISE, 0x0BDA, 0x8153);
  const lo = (v) => v & 255, hi = (v) => v >> 8;
  for (let i = 0; i < 3; i++) { r.out(D1, pad([7, 0], 64)); r.inp(D1, pad([7, 0, 0x55], 64)); r.out(NOISE, pad([5, 1, 0, 0x20, 3], 64)); }
  const was = 400;
  r.out(D1, pad([5, 0x81], 64)); r.inp(D1, pad([5, 0x81, 0, lo(was), hi(was)], 64));
  const sendValue = (v) => {
    const msg = same ? [5, 1, 0, 0x90, 1] : [5, 1, counter ?? 0, lo(v), hi(v)];
    r.out(D1, pad(msg, 64));
    if (!noReply) r.inp(D1, pad([5, 1, 0], 64));
    if (twin) { r.out(D1, pad([9, 1, lo(v), hi(v)], 64)); r.inp(D1, pad([9, 1], 64)); }
  };
  if (drag) sendValue(drag);
  sendValue(value);
  if (!noRead) { r.out(D1, pad([5, 0x81], 64)); r.inp(D1, pad([5, 0x81, 0, lo(value), hi(value)], 64)); }
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
  check(L1.echo >= 2 && L1.transport.report === 'output' && L1.transport.len === 64 && !L1.checksum, `output reports of 64 bytes, replies echo 2+ bytes, no checksum (${L1.echo})`);
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
console.log(fails.length ? `learn-wizard: FAILED:\n- ${fails.join('\n- ')}` : 'learn-wizard (made-up recordings: diff, driver.json, refusals, save read-only, share): all good');
process.exit(fails.length ? 1 : 0);
