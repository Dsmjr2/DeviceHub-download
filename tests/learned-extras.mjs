// Learned settings beside a driver written as code (1 Nov 2026; helpers/learned-extras.mjs, docs/handoff/learned-extras.md).
// A pretend "Kite mouse" (2E01:0042, 32-byte feature reports) has a code driver (device.mjs: DPI) installed from a
// pretend library. "A setting is missing?" learns its Lights toggle from made-up recordings through the wizard's own
// route and saves learned.json beside the driver. Then my-devices loads ONE device with both settings, and:
//   - Lights waits for Turn on settings (even when the driver's own settings were turned on before), then passes the
//     self-check like DPI;
//   - a write to Lights sends only messages heard in the recordings;
//   - every call of both drivers goes through one queue: the pretend device never has two requests in flight (and the
//     same calls without the queue DO overlap, so the check can fail);
//   - a broken or refused learned.json leaves the code driver working alone, logged once;
//   - a learned key equal to a code key is refused at save, and dropped at load;
//   - backups keep learned.json; Share never ships it; the learned-driver share refuses the folder.
// No hardware, no USBPcap, no admin prompt. Run: node tests/learned-extras.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as lw from '../helpers/learn-wizard.mjs';
import { load, turnOn, needsTurnOn, connectedSettings } from '../helpers/my-devices.mjs';
import { installFromLibrary } from '../helpers/device-library.mjs';
import { fromJson } from '../helpers/declarative-driver.mjs';
import { saveLearned, sideProblem, oneQueue, LEARNED_FILE, learnedOn } from '../helpers/learned-extras.mjs';
import { setDeviceProvider } from '../public/devices/hid.js';
import { shareDevice } from '../helpers/share-device.mjs';
import { buildShare } from '../helpers/driver-share.mjs';
import { Rec, pad } from './lib/usb-recording.mjs';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
process.on('uncaughtException', (e) => { console.log(`learned-extras: FAILED: ${e.stack || e.message}`); process.exit(1); });
const hexs = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const LEN = 32;

// ---------------------------------------------------------------- the pretend device
// 10 -> 10 00 <dpi u16le>; 11 00 <dpi u16le> -> the same; 20 -> 20 00 <lights>; 21 00 <0|1> -> 21 00 <lights>.
// overlaps: a request sent while another one has not had its reply yet.
const tick = () => new Promise((r) => setTimeout(r, 2));
function kite(pid = 0x0042) {
  const s = { dpi: 800, lights: 0 };
  const sim = { s, sent: [], overlaps: 0, pending: false, last: null };
  const handle = (q) => {
    switch (q[0]) {
      case 0x10: return [0x10, 0, s.dpi & 255, s.dpi >> 8];
      case 0x11: s.dpi = q[2] | (q[3] << 8); return [0x11, 0, q[2], q[3]];
      case 0x20: return [0x20, 0, s.lights];
      case 0x21: if (q[2] > 1) return [0x21, 1]; s.lights = q[2]; return [0x21, 0, s.lights];
      default: return [0xff];
    }
  };
  sim.dev = {
    vendorId: 0x2e01, productId: pid, productName: 'Kite mouse', opened: true, collections: [],
    async open() {}, async close() {}, addEventListener() {}, removeEventListener() {},
    async sendFeatureReport(id, data) { const q = [...data]; sim.sent.push(q); if (sim.pending) sim.overlaps++; sim.pending = true; sim.last = pad(handle(q), LEN); await tick(); },
    async receiveFeatureReport(id, len) { await tick(); sim.pending = false; const a = new Uint8Array(len); a.set((sim.last || []).slice(0, len)); return new DataView(a.buffer); },
  };
  return sim;
}

// ---------------------------------------------------------------- a pretend library with the code driver
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learned-extras-'));
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const hidUrl = pathToFileURL(path.join(REAL, 'public', 'devices', 'hid.js')).href;
const CODE = `// a pretend code driver (tests/learned-extras.mjs)
import { getDevice } from '${hidUrl}';
const LEN = ${LEN};
export function make() {
  return {
    id: 'kite-mouse', title: 'Kite mouse', kind: 'Mouse',
    hid: { vid: '2E01', pid: '0042', page: 'FF00', usage: '0001', len: LEN, reportId: 0, featureOnly: true },
    settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200, step: 50 }],
    dev: null, q: Promise.resolve(),
    async connect() { if (this.dev) return true; this.dev = await getDevice([{ vendorId: 0x2e01, productId: 0x0042, usagePage: 0xff00 }], { prompt: false }); return !!this.dev; },
    ask(bytes) {
      const run = async () => { const out = new Uint8Array(LEN); out.set(bytes); await this.dev.sendFeatureReport(0, out); const dv = await this.dev.receiveFeatureReport(0, LEN); return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength); };
      const p = this.q.then(run, run); this.q = p.catch(() => {}); return p;
    },
    async info() { return { Model: 'Kite' }; },
    async read() { const r = await this.ask([0x10]); if (r[0] !== 0x10) throw new Error('no DPI reply'); return { dpi: r[2] | (r[3] << 8) }; },
    async write(key, value) {
      if (key !== 'dpi') throw new Error(key + ' is not a Kite setting');
      await this.ask([0x11, 0, value & 255, value >> 8]);
      const v = (await this.read()).dpi;
      if (v !== value) throw new Error('DPI did not read back');
      return v;
    },
  };
}
export default make();
`;
const lib = path.join(root, 'device-library', 'kite-mouse');
fs.mkdirSync(lib, { recursive: true });
fs.writeFileSync(path.join(lib, 'device.mjs'), CODE);
fs.writeFileSync(path.join(lib, 'device.json'), JSON.stringify({ id: 'kite-mouse', vendor: 'Kite', product: 'Kite mouse', kind: 'Mouse', vid: '2e01', pids: ['0042'], models: ['Kite'], works: ['DPI'], status: 'read-only', tested: [] }));
const inst = await installFromLibrary('kite-mouse', { root, readOnly: true, untested: true });
check(inst.ok, `the code driver installs into my-devices (${inst.error})`);
const copy = path.join(root, 'my-devices', 'kite-mouse');

// ---------------------------------------------------------------- "A setting is missing?" through the wizard's route
// what the maker's app sends when Lights is switched: the DPI read (background), the lights read, the set, the read
function take(on, pid = 0x0042) {
  const r = new Rec(), D = 3, v = on ? 1 : 0;
  r.descriptor(D, 0x2e01, pid);
  r.setFeature(D, 0, pad([0x10], LEN)); r.getFeature(D, 0, pad([0x10, 0, 0x20, 0x03], LEN));
  r.setFeature(D, 0, pad([0x20], LEN)); r.getFeature(D, 0, pad([0x20, 0, 1 - v], LEN));
  r.setFeature(D, 0, pad([0x21, 0, v], LEN)); r.getFeature(D, 0, pad([0x21, 0, v], LEN));
  r.setFeature(D, 0, pad([0x20], LEN)); r.getFeature(D, 0, pad([0x20, 0, v], LEN));
  return r.pcap();
}
const HEARD = new Set([[0x10], [0x20], [0x21, 0, 1], [0x21, 0, 0]].map((b) => hexs(pad(b, LEN))));
const listener = { state: null, value: null };
lw.options.root = root;
lw.options.preflight = false;
lw.options.deps = {
  ...lw.deps,
  usbpcapInstalled: () => true,
  listHid: async () => ({ collections: [{ vid: '2E01', pid: '0042', iface: 0, col: 1, page: 'FF00', usage: '0001', inLen: 0, outLen: 0, featLen: LEN + 1, inIds: [], outIds: [], featIds: [], product: 'Kite mouse' }] }),
  startCapture: async () => { listener.state = { seq: 0, status: 'ready' }; return { started: true }; },
  writeCommand: (dir, text) => { const [seq, verb] = text.split(' '); listener.state = { seq: Number(seq), status: verb === 'start' ? 'recording' : verb === 'stop' ? 'stopped' : 'ended' }; },
  readState: () => listener.state,
  readTake: () => [take(listener.value, listener.pid || 0x0042)],
  sleep: async () => {},
  loadNew: async () => null,
  send: async () => ({ sent: false }),
};
const route = async (method, step, body) => {
  let out = null;
  await lw.handle(new URL(`http://x/api/learn/${step}`), { method }, {}, (res, code, j) => { out = { code, ...j }; }, async () => body);
  return out;
};
const devs = (await route('GET', 'devices')).devices || [];
const kd = devs.find((d) => d.vid === '2E01');
check(kd && !kd.refused && kd.note === lw.ADDS_BESIDE_NOTE && kd.driver?.code === true && kd.ready?.name === 'kite-mouse', `the Kite mouse is listed with its code driver, not refused (${JSON.stringify(kd)})`);
const bg = await route('POST', 'begin', { vid: '2E01', pid: '0042', capture: true });
check(bg.ok && bg.capture && bg.addsTo?.code === true && bg.addsTo.name === 'kite-mouse', `A setting is missing? opens a session that adds beside the code driver (${JSON.stringify(bg.addsTo || bg.error)})`);
check((await route('POST', 'setting', { label: 'Lights', kind: 'toggle', values: ['on', 'off'] })).ok, 'the Lights toggle is taken');
check((await route('POST', 'listen')).ok, 'listening starts');
for (const on of [true, false]) {
  listener.value = on;
  const s = await route('POST', 'record');
  check(s.ok, `recording Lights ${on ? 'on' : 'off'} starts (${s.error})`);
  const e = await route('POST', 'stop');
  check(e.ok && e.heard === 8, `recording Lights ${on ? 'on' : 'off'} stops with 8 messages (${e.error || e.heard})`);
}
const an = await route('POST', 'analyze');
check(an.ok && an.kind === 'toggle', `Lights is learned as a toggle (${JSON.stringify(an.why || an.kind)})`);
// 2 Nov 2026: beside a code driver nothing is added until its device has connected in this run (its settings known)
const notYet = await route('POST', 'add', { title: 'Kite mouse', kind: 'Mouse' });
check(notYet.ok === false && /^Connect the device first, then learn\./.test((notYet.why || []).join(' ')), `not connected in this run: refused in a plain sentence (${JSON.stringify(notYet.why || notYet)})`);
let live = { keys: ['dpi'], battery: false, pid: '0043' };
lw.options.deps.connectedSettings = (r, name) => (name === 'kite-mouse' ? live : null);
const otherId = await route('POST', 'add', { title: 'Kite mouse', kind: 'Mouse' });
check(otherId.ok === false && /connected to USB 2E01:0043, not to this one \(2E01:0042\)/.test((otherId.why || []).join(' ')), `its driver on another USB id: refused (${JSON.stringify(otherId.why || otherId)})`);
live = { keys: ['dpi'], battery: false, pid: '0042' };
const add = await route('POST', 'add', { title: 'Kite mouse', kind: 'Mouse' });
check(add.ok && add.driver?.settings?.length === 1 && add.driver.settings[0].key !== 'dpi', `the learned file holds ONLY the learned setting (${JSON.stringify(add.why || add.driver?.settings)})`);
const lkey = add.driver?.settings?.[0]?.key;
const saved = await route('POST', 'save', { title: 'Kite mouse', kind: 'Mouse' });
check(saved.ok && saved.saved?.beside === true && /beside its driver/.test(saved.saved.note || ''), `saved beside the driver (${JSON.stringify(saved.why || saved.error || saved.saved)})`);
const learnedDef = JSON.parse(fs.readFileSync(path.join(copy, LEARNED_FILE), 'utf8'));
const mark = JSON.parse(fs.readFileSync(path.join(copy, 'library.json'), 'utf8'));
check(learnedDef.settings.map((s) => s.key).join() === lkey && mark.learnedKeys?.includes(lkey) && mark.learnedAt, `learned.json and library.json learnedKeys (${JSON.stringify(mark)})`);
check(learnedOn(learnedDef) === '2E01:0042' && learnedDef.pids.length === 1, `learned.json records the USB id it was learned on (${learnedOn(learnedDef)})`);
check(fs.readFileSync(path.join(copy, 'device.mjs'), 'utf8') === CODE, 'the code driver itself is never edited');
await route('POST', 'quit');

// ---------------------------------------------------------------- a learned key equal to a code key: refused at save
{
  const clash = JSON.parse(JSON.stringify(learnedDef));
  clash.settings[0].key = 'dpi'; clash.fields.dpi = clash.fields[lkey]; delete clash.fields[lkey];
  for (const s of clash.settings) if (s.write?.keep) s.write.keep = s.write.keep.map((k) => (k === lkey ? 'dpi' : k));
  const why = sideProblem(clash, { keys: ['dpi'], battery: false, vid: '2E01' });
  check(/already has a setting called "dpi"/.test(why || ''), `sideProblem names the clash (${why})`);
  const r = saveLearned(copy, clash, ['dpi'], { keys: ['dpi'], battery: false, vid: '2E01' }, { root });
  check(!r.ok && /Not added: its driver already has a setting called "dpi"\. Skip that setting/.test((r.why || []).join(' ')), `saveLearned refuses it in a plain sentence (${JSON.stringify(r)})`);
  check(JSON.parse(fs.readFileSync(path.join(copy, LEARNED_FILE), 'utf8')).settings[0].key === lkey, 'and learned.json is left as it was');
  const other = saveLearned(copy, { ...learnedDef, vid: '1234', pids: ['5678'] }, [lkey], { keys: ['dpi'], battery: false, vid: '2E01' }, { root });
  check(!other.ok, 'a learned file for another vendor id is refused');
  check(!saveLearned(path.join(root, 'device-library', 'kite-mouse'), learnedDef, [lkey], { keys: ['dpi'], vid: '2E01' }, { root }).ok, 'nothing is saved outside my-devices');
  // backups: a second save copies the learned.json and library.json there first
  const again = saveLearned(copy, learnedDef, [lkey], { keys: ['dpi'], battery: false, vid: '2E01' }, { root, now: () => new Date('2026-11-01T12:00:00Z') });
  check(again.ok && fs.existsSync(path.join(again.backup, LEARNED_FILE)) && fs.existsSync(path.join(again.backup, 'library.json')), `learned.json is kept with the backups (${JSON.stringify(again)})`);
}

// ---------------------------------------------------------------- loaded: one device, both settings, guarded
// the driver's own settings were turned on BEFORE Lights was learned: Lights waits for another Turn on settings
{
  const m = JSON.parse(fs.readFileSync(path.join(copy, 'library.json'), 'utf8'));
  fs.writeFileSync(path.join(copy, 'library.json'), JSON.stringify({ ...m, settingsOn: { at: '2026-10-01T00:00:00.000Z' } }, null, 2));
}
const sim = kite();
setDeviceProvider(async () => sim.dev);
const reg = [], specs = [];
const deps = { backup: async () => ({ ok: true }), log: () => {}, makerApp: async () => null, version: 'test' };
const res = await load(root, { register: (x) => reg.push(x), addSpec: (s) => specs.push(s), taken: (id) => reg.some((y) => y.id === id), selfCheck: deps });
const a = reg.find((x) => x.id === 'kite-mouse');
check(a && res.some((r) => r.name === 'kite-mouse' && r.learned?.includes(lkey)), `my-devices loads the code driver with its learned settings (${JSON.stringify(res)})`);
check(a.settings.map((s) => s.key).join() === `dpi,${lkey}`, `one device with both settings (${a.settings.map((s) => s.key)})`);
check(specs.length === 1 && specs[0].pid === '0042', `one channel: the learned driver shares the code driver's (${JSON.stringify(specs.map((s) => s.pid + ':' + s.page))})`);
check(a.mayWrite(lkey).gated === true && !a.mayWrite('dpi').gated, `Lights waits for Turn on settings; DPI was turned on already (${JSON.stringify([a.mayWrite(lkey), a.mayWrite('dpi')])})`);
check(a.settings.find((s) => s.key === lkey)?.readOnly && /Turn on settings/.test(a.settings.find((s) => s.key === lkey)?.hint || ''), 'Lights shows read-only with Turn on settings in its hint');
let refused = null;
try { await a.write(lkey, true); } catch (e) { refused = e.message; }
check(/read-only.*Turn on settings/.test(refused || '') && sim.s.lights === 0, `a write to Lights is refused before Turn on settings (${refused})`);
check(await a.connect(false), 'it connects');
const v0 = await a.read();
check(v0.dpi === 800 && v0[lkey] === false, `read() has both drivers' values (${JSON.stringify(v0)})`);
const on = await turnOn('kite-mouse');
check(on.on && on.ran && on.keys?.[lkey]?.ok === true && on.keys?.dpi?.ok === true, `Turn on settings: Lights passes the self-check (written its own value, read back) beside DPI (${JSON.stringify(on.keys || on.why)})`);
check(!a.settings.find((s) => s.key === lkey)?.readOnly, 'and is no longer read-only');
// what Learn a device asks before saving beside it: the device as it connected in this run (code keys only, its id)
{
  const cs = connectedSettings('kite-mouse');
  check(cs && cs.keys.join() === 'dpi' && cs.pid === '0042' && cs.battery === false, `my-devices keeps the connected device's own keys and USB id (${JSON.stringify(cs)})`);
  const m2 = JSON.parse(fs.readFileSync(path.join(copy, 'library.json'), 'utf8'));
  check(m2.settingsOn?.keys?.includes(lkey) && m2.settingsOn.keys.includes('dpi'), `Turn on settings keeps the keys it turned on (${JSON.stringify(m2.settingsOn)})`);
}
// Turn on settings pressed before the restart that loaded a learned setting (settingsOn later than learnedAt): the
// learned setting was not on the page then, so it still waits for a press
{
  const mk = (keys) => ({ learnedKeys: [lkey], learnedAt: '2026-11-01T10:00:00.000Z', settingsOn: { at: '2026-11-01T11:00:00.000Z', ...(keys ? { keys } : {}) } });
  check(needsTurnOn(mk(['dpi']), false, lkey) === true, 'pressed before it was loaded: the learned setting still waits');
  check(needsTurnOn(mk(['dpi', lkey]), false, lkey) === false, 'pressed while it was on the page: turned on');
  check(needsTurnOn(mk(['dpi']), false, 'dpi') === false && needsTurnOn(mk(['dpi']), true, 'dpi') === false, 'the driver\'s own settings are not affected');
  check(needsTurnOn(mk(null), false, lkey) === false && needsTurnOn({ ...mk(null), learnedAt: '2026-11-01T12:00:00.000Z' }, false, lkey) === true, 'an older settingsOn without keys: decided by the times, as before');
}

// a write to the learned key: only bytes heard in the recordings
const from = sim.sent.length;
const got = await a.write(lkey, true);
const during = sim.sent.slice(from).map(hexs);
check(got === true && sim.s.lights === 1, `the device holds Lights on (${JSON.stringify(got)}, ${sim.s.lights})`);
check(during.length > 0 && during.every((h) => HEARD.has(h)) && during.some((h) => h.startsWith('21 00 01')), `the write sent only recorded messages (${during.map((h) => h.slice(0, 11)).join(' | ')})`);
check(!during.some((h) => h.startsWith('10') || h.startsWith('11')), 'and nothing of the code driver');
// the code driver's own setting is still written by it
check((await a.write('dpi', 1600)) === 1600 && sim.s.dpi === 1600, 'DPI is written by the code driver as before');

// one queue: everything at once, never two requests in flight
const o0 = sim.overlaps, q0 = a.learnedQueue.stats.most;
const all = await Promise.all([a.read(), a.write(lkey, false), a.read(), a.write('dpi', 1200), a.info(), a.read(), a.write(lkey, true), a.rawBackup()]);
check(sim.overlaps === o0 && a.learnedQueue.stats.most === 1 && q0 <= 1, `eight calls at once: no request overlapped (${sim.overlaps - o0} overlaps, ${a.learnedQueue.stats.most} in the queue at once)`);
// (a guarded write asks about the maker's app before it joins the queue, so a read called after it may run first)
const after = await a.read();
check(all.slice(0, 7).every((x) => x !== undefined) && sim.s.lights === 1 && sim.s.dpi === 1200 && after.dpi === 1200 && after[lkey] === true, `each one finished and the device holds both writes (${JSON.stringify(after)})`);
check(all[7] && all[7].learned, 'the raw backup has the learned replies beside the driver\'s');
// the control: the same two drivers called side by side WITHOUT the queue do overlap, so the check above can fail
{
  const sim2 = kite();
  setDeviceProvider(async () => sim2.dev);
  const codeMod = await import(pathToFileURL(path.join(copy, 'device.mjs')).href);
  const c2 = codeMod.make(), s2 = fromJson(learnedDef);
  await c2.connect(); await s2.connect(false);
  await Promise.allSettled([c2.read(), s2.read(), c2.read(), s2.read()]);
  check(sim2.overlaps > 0, `without the queue the two drivers overlap on the device (${sim2.overlaps}), so the queue is what prevents it`);
  setDeviceProvider(async () => sim.dev);
}
// a call from inside a queued call runs at once (no deadlock)
{
  const q = oneQueue();
  const r = await Promise.race([q(async () => q(async () => 'inner')), new Promise((res2) => setTimeout(() => res2('stuck'), 500))]);
  check(r === 'inner', `a queued call that calls the queue again finishes (${r})`);
}

// ---------------------------------------------------------------- share: never as the library driver
{
  const sh = buildShare(copy);
  check(/code is never sent|only drivers made with Learn/.test(sh.refused || ''), `the learned-driver share refuses a code driver's folder (${JSON.stringify(sh.refused)})`);
  const lib2 = await shareDevice(copy, { root, status: 'read-only', by: 'tester', names: [] });
  check(!lib2.ok || !fs.readdirSync(lib2.dir).includes(LEARNED_FILE), `Share to the library never ships learned.json (${lib2.error || (lib2.dir && fs.readdirSync(lib2.dir).join())})`);
}

// ---------------------------------------------------------------- a broken learned.json: the code driver alone
async function loadWith(text, name) {
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), `dh-learned-${name}-`));
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(r2, 'package.json'));
  const c2 = path.join(r2, 'my-devices', 'kite-mouse');
  fs.mkdirSync(c2, { recursive: true });
  for (const f of ['device.mjs', 'device.json', 'library.json']) fs.copyFileSync(path.join(copy, f), path.join(c2, f));
  fs.writeFileSync(path.join(c2, LEARNED_FILE), text);
  const lines = [];
  const log0 = console.log;
  console.log = (t) => lines.push(String(t));
  const rg = [];
  let out;
  try { out = await load(r2, { register: (x) => rg.push(x), addSpec() {}, taken: () => false, selfCheck: deps }); } finally { console.log = log0; }
  const d = rg.find((x) => x.id === 'kite-mouse');
  fs.rmSync(r2, { recursive: true, force: true });
  return { d, out, lines: lines.filter((l) => l.includes(LEARNED_FILE) || l.includes('learned')) };
}
// the code driver module is cached by its file: each copy here has its own file path, so each load gets its own object
{
  const bad = await loadWith('{ not json', 'broken');
  check(bad.d && bad.d.settings.map((s) => s.key).join() === 'dpi' && bad.out[0]?.learnedError, `a broken learned.json: the device loads with its code driver alone (${JSON.stringify(bad.out)})`);
  check(bad.lines.length === 1 && /learned\.json not used .*runs with its own driver/.test(bad.lines[0]), `and it is logged once (${JSON.stringify(bad.lines)})`);
  const sim3 = kite();
  setDeviceProvider(async () => sim3.dev);
  check((await bad.d.connect(false)) && (await bad.d.read()).dpi === 800, 'the code driver still connects and reads');
  // a file that fails DeviceHub's check (a message with a value placeholder nothing fills) is refused the same way
  const refusedDef = JSON.parse(JSON.stringify(learnedDef));
  refusedDef.messages[Object.keys(refusedDef.messages)[0]].bytes = '20 {nothing}';
  const rv = await loadWith(JSON.stringify(refusedDef), 'refused');
  check(rv.d && rv.d.settings.map((s) => s.key).join() === 'dpi' && rv.lines.length === 1, `a learned.json DeviceHub's check refuses: the code driver alone, logged once (${JSON.stringify(rv.lines)})`);
  // a learned key equal to a code key at load (a newer code driver brought it): dropped, the code driver wins
  const sh = JSON.parse(JSON.stringify(learnedDef));
  sh.settings[0].key = 'dpi'; sh.fields.dpi = sh.fields[lkey]; delete sh.fields[lkey];
  const sd = await loadWith(JSON.stringify(sh), 'shadow');
  check(sd.d && sd.d.settings.map((s) => s.key).join() === 'dpi' && sd.lines.some((l) => /learned dpi not used/.test(l)), `a learned key equal to a code key never shadows it (${JSON.stringify(sd.lines)})`);
}
// ---------------------------------------------------------------- one family driver, two USB ids (2 Nov 2026)
// learned on 2E01:0042; the same code driver also runs 2E01:0043. On 0043 the learned settings are absent (logged once)
// and nothing of them reaches that device; on 0042 they are there.
{
  const CODE2 = CODE.replace("hid: { vid: '2E01', pid: '0042',", "hid: { vid: '2E01', pid: '0042', pids: ['0042', '0043'],")
    .replace('[{ vendorId: 0x2e01, productId: 0x0042, usagePage: 0xff00 }]', '[{ vendorId: 0x2e01, productId: 0x0042, usagePage: 0xff00 }, { vendorId: 0x2e01, productId: 0x0043, usagePage: 0xff00 }]');
  check(CODE2 !== CODE && CODE2.includes("pids: ['0042', '0043']") && CODE2.includes('productId: 0x0043'), 'the two-id code driver is made');
  const r5 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learned-two-'));
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(r5, 'package.json'));
  const c5 = path.join(r5, 'my-devices', 'kite-two');
  fs.mkdirSync(c5, { recursive: true });
  fs.writeFileSync(path.join(c5, 'device.mjs'), CODE2);
  fs.writeFileSync(path.join(c5, 'device.json'), JSON.stringify({ id: 'kite-mouse', vendor: 'Kite', product: 'Kite mouse', kind: 'Mouse', vid: '2e01', pids: ['0042', '0043'], models: ['Kite'], works: ['DPI'], status: 'read-only', tested: [] }));
  fs.copyFileSync(path.join(copy, 'library.json'), path.join(c5, 'library.json'));
  fs.writeFileSync(path.join(c5, LEARNED_FILE), JSON.stringify(learnedDef));
  const lines = [], log0 = console.log;
  console.log = (t) => lines.push(String(t));
  const rg = [];
  let a5, s43, s42;
  try {
    await load(r5, { register: (x) => rg.push(x), addSpec() {}, taken: () => false, selfCheck: deps });
    a5 = rg.find((x) => x.id === 'kite-mouse');
    s43 = kite(0x0043);
    setDeviceProvider(async () => s43.dev);
    await a5.connect(false); await a5.read(); await a5.connect(false); await a5.read();
  } finally { console.log = log0; }
  const said = lines.filter((l) => /learned on 2E01:0042 and this is 2E01:0043/.test(l));
  check(a5 && a5.settings.map((s) => s.key).join() === 'dpi', `on 2E01:0043 the learned setting is absent (${a5?.settings.map((s) => s.key)})`);
  check(said.length === 1, `and that is logged once (${JSON.stringify(lines)})`);
  const e43 = await a5.write(lkey, true).then(() => null, (x) => x);
  check(e43 && s43.s.lights === 0 && !s43.sent.some((q) => q[0] === 0x20 || q[0] === 0x21), `nothing learned is ever sent to 2E01:0043 (${e43?.message}; ${s43.sent.map((q) => q[0].toString(16)).join(',')})`);
  // the same driver on the id it was learned on: the learned setting is there, and read from that device
  s42 = kite(0x0042);
  setDeviceProvider(async () => s42.dev);
  a5.dev = null;   // the pretend code driver keeps its device: as if the 0043 one was unplugged and 0042 plugged in
  console.log = (t) => lines.push(String(t));
  try { await a5.connect(false); } finally { console.log = log0; }
  const v42 = await a5.read();
  check(a5.settings.map((s) => s.key).join() === `dpi,${lkey}` && v42[lkey] === false && s42.sent.some((q) => q[0] === 0x20), `on 2E01:0042 the learned setting is used (${JSON.stringify(v42)})`);
  fs.rmSync(r5, { recursive: true, force: true });
}

// ---------------------------------------------------------------- a learned "dpi" beside a Bragi-like code driver
// a driver listing its settings per model has none before it connects (Corsair, Wooting, SteelSeries): the save-time
// clash check uses the device's settings as it connected in this run, so a learned DPI is refused
{
  const CODE3 = CODE.replace(/0x0042/g, '0x0050').replace("pid: '0042'", "pid: '0050'").replace("id: 'kite-mouse', title: 'Kite mouse'", "id: 'kite-bragi', title: 'Kite per-model'")
    .replace("settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200, step: 50 }],", "get settings() { return this.dev ? [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200, step: 50 }] : []; },");
  check(CODE3.includes('get settings()') && CODE3.includes("id: 'kite-bragi'"), 'the per-model code driver is made');
  const lb = path.join(root, 'device-library', 'kite-bragi');
  fs.mkdirSync(lb, { recursive: true });
  fs.writeFileSync(path.join(lb, 'device.mjs'), CODE3);
  fs.writeFileSync(path.join(lb, 'device.json'), JSON.stringify({ id: 'kite-bragi', vendor: 'Kite', product: 'Kite per-model', kind: 'Mouse', vid: '2e01', pids: ['0050'], models: ['Kite'], works: [], status: 'read-only', tested: [] }));
  check((await installFromLibrary('kite-bragi', { root, readOnly: true, untested: true })).ok, 'the per-model driver installs');
  const hid0 = lw.options.deps.listHid;
  lw.options.deps.listHid = async () => ({ collections: [{ vid: '2E01', pid: '0050', iface: 0, col: 1, page: 'FF00', usage: '0001', inLen: 0, outLen: 0, featLen: LEN + 1, inIds: [], outIds: [], featIds: [], product: 'Kite per-model' }] });
  listener.pid = 0x0050;
  let liveB = { keys: ['dpi'], battery: false, pid: '0050' };
  lw.options.deps.connectedSettings = (r, name) => (name === 'kite-bragi' ? liveB : null);
  await route('GET', 'devices');
  const bb = await route('POST', 'begin', { vid: '2E01', pid: '0050', capture: true });
  check(bb.ok && bb.addsTo?.code === true && bb.addsTo.name === 'kite-bragi', `A setting is missing? on the per-model driver adds beside it (${JSON.stringify(bb.addsTo || bb.error)})`);
  await route('POST', 'setting', { label: 'DPI', kind: 'toggle', values: ['on', 'off'] });
  await route('POST', 'listen');
  for (const on2 of [true, false]) { listener.value = on2; await route('POST', 'record'); await route('POST', 'stop'); }
  const anB = await route('POST', 'analyze');
  check(anB.ok, `the recording is worked out (${JSON.stringify(anB.why)})`);
  const clash = await route('POST', 'add', { title: 'Kite per-model', kind: 'Mouse' });
  check(clash.ok === false && /Not added: its driver already has a setting called "dpi"\. Skip that setting/.test((clash.why || []).join(' ')), `a learned "dpi" beside it is refused (${JSON.stringify(clash.why || clash.driver?.settings)})`);
  // the control: with the keys known before it connects (none), the same "dpi" was taken: the check above can fail
  liveB = { keys: [], battery: false, pid: '0050' };
  const ctl = await route('POST', 'add', { title: 'Kite per-model', kind: 'Mouse' });
  check(ctl.ok && ctl.driver?.settings?.some((s) => s.key === 'dpi'), `without the connected keys the same "dpi" would have been added (${JSON.stringify(ctl.why || ctl.driver?.settings?.map((s) => s.key))})`);
  await route('POST', 'quit');
  lw.options.deps.listHid = hid0;
  listener.pid = null;
}

setDeviceProvider(null);
lw.options.deps = lw.deps;
lw.options.root = REAL;
try { fs.rmSync(root, { recursive: true, force: true }); } catch {}

if (fails.length) { console.log(`learned-extras: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('learned-extras (learned settings beside a code driver: saved from A setting is missing?, one device, one queue, guarded, only recorded bytes, a broken file leaves the driver working): all good');
process.exit(0);
