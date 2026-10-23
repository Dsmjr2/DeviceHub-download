// Offline test of the HyperX Cloud library driver (device-library/hyperx-cloud) against simulated headsets, one per
// frame family, that answer exactly as docs/brands/hyperx.md documents: request bytes, read / write / read-back, a
// read-back mismatch put back, the read-only models refusing writes, and the NEVER commands never reaching a device by
// any path the driver has, and no write while NGENUITY runs. Run: node tests/sim-hyperx.mjs (no hardware)
import fs from 'node:fs';
import { setDeviceProvider } from '../public/devices/hid.js';
import { problem, selfCheck } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import driver, { Link, MODELS, NEVER, FAMILIES, checkFrame, modelFor, flightBattery } from '../device-library/hyperx-cloud/device.mjs';
import kdriver, * as K from '../device-library/hyperx-kingston/device.mjs';
import { hidSpecs } from '../helpers/my-devices.mjs';

driver.vendorApp = async () => null;   // no tasklist in the test
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// ---- the simulated headsets (docs/brands/hyperx.md sections 2 and 3) ----
// Each keeps every report it was sent as the whole frame ([report id, ...data]) and answers a get with the reply frame
// the sheet describes. Sets change its state and are not answered (the sheet documents no set reply).
class Sim {
  constructor({ pid, family, len, page, state, getMap, setMap, reply, dangerous, vid = 0x03f0, fams = FAMILIES }) {
    Object.assign(this, { vendorId: vid, productId: parseInt(pid, 16), productName: `sim ${pid}`, family, fams, len, state, getMap, setMap, reply, dangerous });
    this.collections = [{ usagePage: page, usage: 1, inputReports: [], outputReports: [], featureReports: [] }];
    this.opened = false; this.listeners = new Set(); this.sent = []; this.feature = []; this.harm = [];
    this.ignoreSets = new Set(); this.refuseOutput = false;
  }
  async open() { this.opened = true; }
  addEventListener(t, f) { this.listeners.add(f); }
  removeEventListener(t, f) { this.listeners.delete(f); }
  emit(id, frame) {   // frame without the report id, padded to the report length
    const d = new Uint8Array(this.len - 1); d.set(frame);
    setTimeout(() => { for (const f of [...this.listeners]) f({ reportId: id, data: new DataView(d.buffer) }); }, 1);
  }
  handle(id, d) {
    const frame = [id, ...d];
    if (frame.length !== this.len) throw new Error(`sim: a ${frame.length}-byte frame, wanted ${this.len}`);
    const fam = this.fams[this.family];
    const cmd = frame[fam.cmdAt];
    if (this.dangerous[cmd]) this.harm.push(this.dangerous[cmd](this.state));
    if (cmd in this.getMap) { this.reply(this, cmd, this.getMap[cmd]); return; }
    if (cmd in this.setMap) { if (!this.ignoreSets.has(cmd)) this.state[this.setMap[cmd]] = frame[fam.cmdAt + 1]; return; }
    this.harm.push(`unknown command ${cmd.toString(16)}`);
  }
  async sendReport(id, data) {
    if (this.refuseOutput) throw Object.assign(new Error('Incorrect function'), { code: 1 });
    this.sent.push([id, ...data]); this.handle(id, Array.from(data));
  }
  async sendFeatureReport(id, data) { this.feature.push([id, ...data]); this.sent.push([id, ...data]); this.handle(id, Array.from(data)); }
}

// Cloud II Wireless (HP), 06 FF BB: reply echoes 06 FF BB <cmd>, value at byte 4, battery % at byte 7, mV at 5-6 BE
const hp = () => new Sim({ pid: '0696', family: '06ffbb', len: 20, page: 0xff90,
  state: { battery: 73, mV: 3912, charging: 0, micMute: 0, sidetone: 1, autoOff: 20, micAttached: 1, sidetoneLevel: 9 },
  getMap: { 0x02: 'battery', 0x03: 'charging', 0x05: 'micMute', 0x06: 'sidetone', 0x07: 'autoOff', 0x08: 'micAttached', 0x0b: 'sidetoneLevel' },
  setMap: { 0x20: 'micMute', 0x21: 'sidetone', 0x22: 'autoOff' },
  // HH: the wireless-status get 01 unmutes the headset
  dangerous: { 0x01: (s) => { s.micMute = 0; return 'wireless-status get 01: headset unmuted'; } },
  reply(sim, cmd, key) {
    const r = [0xff, 0xbb, cmd, sim.state[key]];
    if (key === 'battery') { r[3] = 0; r[4] = sim.state.mV >> 8; r[5] = sim.state.mV & 0xff; r[6] = sim.state.battery; }
    sim.emit(0x06, r);
  } });

// Cloud Alpha Wireless, 21 BB: reply 21 BB <cmd or reply code> <value>; battery answers with code 25, charging with 26
const alpha = (pid = '098d') => new Sim({ pid, family: '21bb', len: 64, page: 0xff00,
  state: { battery: 55, charging: 1, sidetone: 0, sidetoneLevel: 64, autoOff: 0, micAttached: 1, voicePrompts: 1, micMute: 0 },
  getMap: { 0x0b: 'battery', 0x0c: 'charging', 0x05: 'sidetone', 0x06: 'sidetoneLevel', 0x07: 'autoOff', 0x08: 'micAttached', 0x09: 'voicePrompts', 0x0a: 'micMute' },
  setMap: { 0x10: 'sidetone', 0x11: 'sidetoneLevel', 0x12: 'autoOff', 0x13: 'voicePrompts', 0x15: 'micMute' },
  dangerous: { 0x03: () => 'connected get 03 sent while the sources disagree' },
  reply(sim, cmd, key) {
    const code = cmd === 0x0b ? 0x25 : cmd === 0x0c ? 0x26 : cmd;
    sim.emit(0x21, [0xbb, 0x23, 1]);   // an unsolicited mute notice first: must not be taken as the reply
    sim.emit(0x21, [0xbb, code, sim.state[key]]);
  } });

// Cloud III Wireless, 66: reply 66 <cmd> <value>; battery 89 at byte 4, valid only if byte 2 or 3 is nonzero
const iii = () => new Sim({ pid: '05b7', family: '66', len: 62, page: 0xff00,
  state: { connected: 1, sidetone: 1, autoOff: 10, micMute: 1, silentMode: 0, sidetoneLevel: 3, battery: 88, charging: 2, batteryValid: 1, productColor: 2 },
  getMap: { 0x82: 'connected', 0x84: 'sidetone', 0x85: 'autoOff', 0x86: 'micMute', 0x87: 'silentMode', 0x88: 'sidetoneLevel', 0x89: 'battery', 0x8a: 'charging', 0x8f: 'productColor' },
  setMap: { 0x01: 'sidetone', 0x05: 'sidetoneLevel', 0x02: 'autoOff', 0x03: 'micMute', 0x04: 'silentMode' },
  dangerous: { 0x1e: () => 'SIRK reset 1E: pairing lost', 0x83: () => 'SIRK read 83' },
  reply(sim, cmd, key) {
    sim.emit(0x66, [0x0d, 50]);   // a battery notice first (0x0D): not a reply
    if (key === 'battery') sim.emit(0x66, [0x89, sim.state.batteryValid, 0, sim.state.battery]);
    else sim.emit(0x66, [cmd, sim.state[key]]);
  } });

// Cloud II Core Wireless, 66 with extras (HH): sidetone level -5..5 signed at 88, mic attached 8C, noise gate 8D
const core = () => new Sim({ pid: '069f', family: '66', len: 64, page: 0xff00,
  state: { connected: 1, sidetone: 1, autoOff: 20, micMute: 0, silentMode: 1, sidetoneStep: 0xff, battery: 61, charging: 0, batteryValid: 1, micAttached: 1, noiseGate: 1 },
  getMap: { 0x82: 'connected', 0x84: 'sidetone', 0x85: 'autoOff', 0x86: 'micMute', 0x87: 'silentMode', 0x88: 'sidetoneStep', 0x89: 'battery', 0x8a: 'charging', 0x8c: 'micAttached', 0x8d: 'noiseGate' },
  setMap: { 0x01: 'sidetone', 0x05: 'sidetoneStep', 0x02: 'autoOff', 0x03: 'micMute', 0x04: 'silentMode', 0x0f: 'noiseGate' },
  dangerous: { 0x1e: () => 'SIRK reset 1E: pairing lost', 0x83: () => 'SIRK read 83' },
  reply(sim, cmd, key) {
    sim.emit(0x66, [0x0a, 1]);   // a mute notice first (0x0A): not a reply
    if (key === 'battery') sim.emit(0x66, [0x89, sim.state.batteryValid, 0, sim.state.battery]);
    else sim.emit(0x66, [cmd, sim.state[key]]);
  } });

// Cloud III S Wireless (HH cloud_iii_s_wireless.rs), 0C: gets are feature reports 0C 02 03 01 00 <cmd>; the reply is input
// report 0C with the command at byte 5 and the value at byte 6 (FF = none). It answers only through receiveReports (as a
// raw channel under hid-host does), never as an event, and refuses output reports (HH writes it only as feature reports).
const iiis = (pid = '06be') => {
  const sim = new Sim({ pid, family: '0c', len: 64, page: 0xff00,
    state: { connected: 2, micMute: 1, battery: 77, voicePrompts: 0, sidetone: 1, charging: 1, autoOffHi: 0x02, autoOffLo: 0x58, productColor: 3 },
    getMap: { 0x02: 'connected', 0x04: 'micMute', 0x06: 'battery', 0x14: 'voicePrompts', 0x16: 'sidetone', 0x48: 'charging', 0x4b: 'autoOffHi', 0x4d: 'productColor' },
    setMap: {},
    dangerous: { 0x5f: () => 'EQ band set 5F', 0x4a: () => 'auto-off set 4A', 0x01: () => 'mic mute set 01', 0x0d: () => 'sidetone set 0D', 0x0b: () => 'voice prompt set 0B' },
    reply(sim, cmd, key) {
      const d = new Uint8Array(63); d.set([0x02, 0x03, 0x00, 0x00, cmd, sim.state[key]]);
      if (key === 'autoOffHi') d[6] = sim.state.autoOffLo;
      const n = new Uint8Array(63); n.set([0x00, 0x00, 0x00, 0x01, 40]);   // a 0D battery notice first: not a reply
      sim.queue.push({ reportId: 0x0d, data: new DataView(n.buffer) }, { reportId: 0x0c, data: new DataView(d.buffer) });
    } });
  sim.queue = [];
  sim.refuseOutput = true;
  sim.receiveReports = async () => sim.queue.splice(0);
  return sim;
};
// Cloud Flight Wireless, 21 FF: get 21 FF 05, reply 21 FF 05 <HI> <LO> millivolts (HSC, HH); a 64 power notice first
const flight = (pid = '0e90', vid = 0x03f0, fams = FAMILIES) => new Sim({ pid, vid, fams, family: '21ff', len: 20, page: 0xff00,
  state: { mV: 3850 }, getMap: { 0x05: 'mV' }, setMap: {}, dangerous: {},
  reply(sim) { sim.emit(0x64, [0x01]); sim.emit(0x21, [0xff, 0x05, sim.state.mV >> 8, sim.state.mV & 0xff]); } });
// Cloud II Wireless (Kingston): 06 00 02 00 9A 00 00 68 4A 8E 0A 00 00 00 BB <cmd>, 62 bytes; reply input report 0B:
// 0B 00 BB <cmd> <byte 4> .. <byte 7>; a 0A DSP report may come first. getInputReport(06) is the prepare read.
const kingston = () => {
  const sim = new Sim({ pid: '1718', vid: 0x0951, fams: K.FAMILIES, family: 'kingston', len: 62, page: 0xff00,
    state: { battery: 64, charging: 1, autoOff: 20 },
    getMap: { 0x02: 'battery', 0x03: 'charging', 0x1a: 'autoOff' }, setMap: {},
    dangerous: { 0x01: () => '01 get: headset unmuted', 0x18: () => 'auto-off set 18', 0x19: () => 'sidetone set 19' },
    reply(sim, cmd, key) {
      sim.emit(0x0a, [0x00, 0x02]);
      if (key === 'battery') sim.emit(0x0b, [0x00, 0xbb, cmd, 0, 0, 0, sim.state.battery]);
      else sim.emit(0x0b, [0x00, 0xbb, cmd, sim.state[key]]);
    } });
  sim.prepared = [];
  sim.getInputReport = async (id, len) => { sim.prepared.push([id, len]); return null; };
  return sim;
};

let current = null;
setDeviceProvider(async (filters) => {
  const f = filters[0];
  if (!current || current.vendorId !== f.vendorId || current.productId !== f.productId) return null;
  if (f.usagePage != null && !current.collections.some((c) => c.usagePage === f.usagePage)) return null;
  return current;
});
const use = async (sim) => { current = sim; const ok = await driver.connect(false); return ok; };
const refused = async (key, value, why, sim) => {
  const before = sim.sent.length;
  try { await driver.write(key, value); check(false, `${why}: was accepted`); }
  catch (e) { check(sim.sent.length === before, `${why}: refused but ${sim.sent.length - before} reports were sent (${e.message})`); }
};
const cmdsSent = (sim) => sim.sent.map((f) => f[sim.fams[sim.family].cmdAt]);

// ---- the driver and its library entry are well formed ----
check(problem(driver) === null, `the driver passes my-devices' check (${problem(driver)})`);
const meta = JSON.parse(fs.readFileSync(new URL('../device-library/hyperx-cloud/device.json', import.meta.url), 'utf8'));
check(validateMeta(meta) === null, `device.json is a valid library entry (${validateMeta(meta)})`);
check(meta.id === driver.id && meta.source === 'docs/brands/hyperx.md', 'device.json names the driver and the sheet');
const allPids = MODELS.flatMap((m) => m.pids).sort();
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify(allPids), `device.json lists every product id the driver answers on (${allPids})`);
check(['read-only', 'untested'].includes(meta.status), 'the entry never installs by itself');
check(modelFor('05B7')?.readOnlyWhy && modelFor('1743')?.readOnlyWhy && !modelFor('0696').readOnlyWhy && !modelFor('0d93'), 'the unconfirmed ids are read-only; 0D93 is left out');

// ---- Cloud II Wireless (HP) ----
{
  const s = hp();
  check(await use(s), 'Cloud II Wireless: connects');
  check(s.opened && (await driver.info()).Model === 'HyperX Cloud II Wireless', 'Cloud II Wireless: info names the model');
  s.sent.length = 0;
  const v = await driver.read();
  check(v.sidetone === true && v.micMute === false && v.autoOff === 20 && !('voicePrompts' in v), `Cloud II Wireless: reads ${JSON.stringify(v)}`);
  check(s.sent.every((f) => f.length === 20 && f[0] === 0x06 && f[1] === 0xff && f[2] === 0xbb && f.slice(4).every((x) => x === 0)), 'Cloud II Wireless: every get is 06 FF BB <cmd> padded to 20 bytes');
  check(hex(cmdsSent(s)) === '06 05 07', `Cloud II Wireless: read() sends sidetone 06, mute 05, auto-off 07 (${hex(cmdsSent(s))})`);
  const b = await driver.battery();
  check(b.percent === 73 && b.charging === false, `Cloud II Wireless: battery 73% from byte 7, not charging (${JSON.stringify(b)})`);
  check((await driver.info())['Battery voltage'] === '3912 mV', 'Cloud II Wireless: voltage from bytes 5-6');
  s.sent.length = 0;
  check(await driver.write('sidetone', false) === false && s.state.sidetone === 0, 'Cloud II Wireless: sidetone on -> off lands');
  check(hex(s.sent[0].slice(0, 5)) === '06 ff bb 06 00' && hex(s.sent[1].slice(0, 6)) === '06 ff bb 21 00 00' && hex(s.sent[2].slice(0, 4)) === '06 ff bb 06',
    `Cloud II Wireless: read 06, set 21 00, read back 06 (${s.sent.map((f) => hex(f.slice(0, 5))).join(' | ')})`);
  check(await driver.write('sidetone', true) === true && s.state.sidetone === 1, 'Cloud II Wireless: sidetone put back on');
  check(await driver.write('autoOff', 30) === 30 && s.state.autoOff === 30 && hex(s.sent.at(-2).slice(0, 5)) === '06 ff bb 22 1e', 'Cloud II Wireless: auto-off 20 -> 30 as 22 1E');
  check(await driver.write('autoOff', 20) === 20, 'Cloud II Wireless: auto-off put back to 20');
  check(await driver.write('micMute', true) === true && s.state.micMute === 1 && hex(s.sent.at(-2).slice(0, 5)) === '06 ff bb 20 01', 'Cloud II Wireless: mic mute as 20 01');
  check(await driver.write('micMute', false) === false, 'Cloud II Wireless: mic mute put back');
  await refused('voicePrompts', true, 'Cloud II Wireless: voice prompts (not documented for it)', s);
  await refused('autoOff', 0, 'Cloud II Wireless: auto-off 0 (unconfirmed, and 20 was read)', s);
  await refused('autoOff', 256, 'Cloud II Wireless: auto-off 256', s);
  await refused('autoOff', 2.5, 'Cloud II Wireless: auto-off 2.5', s);
  await refused('sidetone', 'true', 'Cloud II Wireless: sidetone "true" (text)', s);
  await refused('sidetoneLevel', 5, 'Cloud II Wireless: sidetone level (range not documented)', s);
  await refused('wirelessStatus', 1, 'Cloud II Wireless: key "wirelessStatus"', s);
  await refused('__proto__', 1, 'Cloud II Wireless: key "__proto__"', s);
  await refused('constructor', 1, 'Cloud II Wireless: key "constructor"', s);
  // a read-back that differs: reported as failed, and the old value put back
  s.ignoreSets.add(0x22);
  try { await driver.write('autoOff', 15); check(false, 'Cloud II Wireless: a write that did not land was accepted'); }
  catch (e) { check(/read back 20/.test(e.message) && s.state.autoOff === 20, `Cloud II Wireless: a write that did not land is reported (${e.message})`); }
  s.ignoreSets.clear();
  // feature-report fallback when the output write is refused (HH on Windows)
  s.refuseOutput = true; s.feature.length = 0;
  const v2 = await driver.read();
  check(v2.autoOff === 20 && s.feature.length >= 1 && hex(s.feature[0].slice(0, 4)) === '06 ff bb 06', 'Cloud II Wireless: falls back to a feature report when the output write is refused');
  s.refuseOutput = false;
  check(!cmdsSent(s).includes(0x01) && s.harm.length === 0, `Cloud II Wireless: the wireless-status get 01 was never sent (${s.harm})`);

  // support issue 4 (22 Oct 2026): a real Cloud II Wireless failed 5 of 8 settings with "the device did not report its
  // value". It reports only mic mute, sidetone on/off and auto-off, so only those are offered, and all three pass.
  check(JSON.stringify(driver.settings.map((x) => x.key)) === JSON.stringify(['sidetone', 'micMute', 'autoOff']), `Cloud II Wireless: offers only sidetone, mic mute and auto-off (${driver.settings.map((x) => x.key)})`);
  const inf = await driver.info();
  check(!('Sidetone level (raw)' in inf) && inf['Boom mic'] === 'attached', `Cloud II Wireless: the raw sidetone byte 0B (no documented scale) is not in info (${JSON.stringify(inf)})`);
  check(/^no reply/.test((await driver.rawBackup()).replies.sidetoneLevelRaw) === false, 'Cloud II Wireless: the raw sidetone byte stays in the raw backup');
  const r = await selfCheck(driver, driver.write, { backup: async () => true });
  check(r.ran && r.counts.checked === 3 && r.counts.passed === 3 && r.counts.failed === 0, `Cloud II Wireless: the self-check checks 3 settings and all pass (${JSON.stringify(r.counts)}: ${JSON.stringify(r.keys)})`);
  check(s.state.sidetone === 1 && s.state.micMute === 0 && s.state.autoOff === 20, 'Cloud II Wireless: the self-check left every value as it was');

  // support issues 3 and 5: a write slower than the reply wait must not reject a promise nobody waits on (it stopped
  // DeviceHub with "no reply to 06 ff bb 08"). The wait starts after the write; a reply that never comes is an
  // ordinary, handled error.
  const stray = [];
  const onStray = (e) => stray.push(String(e?.message || e));
  process.on('unhandledRejection', onStray);
  const slow = hp();
  const realSend = slow.sendReport.bind(slow);
  slow.sendReport = async (id, data) => { await new Promise((ok) => setTimeout(ok, 60)); return realSend(id, data); };
  const slowLink = new Link(slow, MODELS[0], { timeoutMs: 30 });
  let got = null;
  try { got = await slowLink.get('micAttached'); } catch (e) { got = e.message; }
  check(got === true, `Cloud II Wireless: a write slower than the reply wait still gets its reply (${got})`);
  slow.getMap = {};   // the headset stops answering (asleep)
  let err = null;
  try { await slowLink.get('micAttached'); } catch (e) { err = e.message; }
  // the caller gives up early, as the agent's own time limits do; the driver's timer fires after that
  const gaveUp = await Promise.race([slowLink.get('autoOff').then(() => 'answered', () => 'failed'), new Promise((ok) => setTimeout(() => ok('gave up'), 5))]);
  await new Promise((ok) => setTimeout(ok, 400));
  process.off('unhandledRejection', onStray);
  check(/^no reply to 06 ff bb 08/.test(err || ''), `Cloud II Wireless: no reply is an ordinary error to its caller (${err})`);
  check(gaveUp === 'gave up' && stray.length === 0, `Cloud II Wireless: no unhandled rejection when the caller stopped waiting (${stray.join('; ')})`);
}

// ---- Cloud Alpha Wireless ----
{
  const s = alpha();
  check(await use(s), 'Alpha Wireless: connects');
  check((await driver.info()).Model === 'HyperX Cloud Alpha Wireless', 'Alpha Wireless: info names the model');
  s.sent.length = 0;
  const v = await driver.read();
  check(v.sidetone === false && v.voicePrompts === true && v.micMute === false && v.autoOff === 0, `Alpha Wireless: reads past the notices ${JSON.stringify(v)}`);
  check(s.sent.every((f) => f.length === 64 && f[0] === 0x21 && f[1] === 0xbb && f.slice(3).every((x) => x === 0)), 'Alpha Wireless: every get is 21 BB <cmd> padded to 64 bytes');
  const b = await driver.battery();
  check(b.percent === 55 && b.charging === true, `Alpha Wireless: battery from reply code 25, charging from 26 (${JSON.stringify(b)})`);
  check(await driver.write('voicePrompts', false) === false && s.state.voicePrompts === 0 && hex(s.sent.at(-2).slice(0, 4)) === '21 bb 13 00', 'Alpha Wireless: voice prompts off as 13 00');
  check(await driver.write('voicePrompts', true) === true, 'Alpha Wireless: voice prompts put back');
  check(await driver.write('sidetone', true) === true && hex(s.sent.at(-2).slice(0, 4)) === '21 bb 10 01', 'Alpha Wireless: sidetone on as 10 01');
  check(await driver.write('sidetone', false) === false, 'Alpha Wireless: sidetone put back');
  check(await driver.write('autoOff', 15) === 15 && hex(s.sent.at(-2).slice(0, 4)) === '21 bb 12 0f', 'Alpha Wireless: auto-off 0 -> 15 as 12 0F');
  check(await driver.write('autoOff', 0) === 0 && s.state.autoOff === 0, 'Alpha Wireless: auto-off 0 written back only because 0 was read');
  check(await driver.write('micMute', true) === true && hex(s.sent.at(-2).slice(0, 4)) === '21 bb 15 01', 'Alpha Wireless: mic mute as 15 01');
  check(await driver.write('micMute', false) === false, 'Alpha Wireless: mic mute put back');
  await refused('silentMode', true, 'Alpha Wireless: silent mode (not documented for it)', s);
  // sidetone level 0-128 (HSC): read 06, set 11, read back 06, put back
  check(v.sidetoneLevel === 64, `Alpha Wireless: sidetone level 64 read from 06 (${v.sidetoneLevel})`);
  s.sent.length = 0;
  check(await driver.write('sidetoneLevel', 100) === 100 && s.state.sidetoneLevel === 100, 'Alpha Wireless: sidetone level 64 -> 100 lands');
  check(hex(s.sent[0].slice(0, 4)) === '21 bb 06 00' && hex(s.sent[1].slice(0, 5)) === '21 bb 11 64 00' && hex(s.sent[2].slice(0, 3)) === '21 bb 06',
    `Alpha Wireless: read 06, set 11 64, read back 06 (${s.sent.map((f) => hex(f.slice(0, 5))).join(' | ')})`);
  check(await driver.write('sidetoneLevel', 64) === 64 && s.state.sidetoneLevel === 64, 'Alpha Wireless: sidetone level put back to 64');
  check(await driver.write('sidetoneLevel', 128) === 128 && await driver.write('sidetoneLevel', 64) === 64, 'Alpha Wireless: sidetone level 128 (the top of HSC\'s range) and back');
  await refused('sidetoneLevel', 129, 'Alpha Wireless: sidetone level 129', s);
  await refused('sidetoneLevel', -1, 'Alpha Wireless: sidetone level -1', s);
  await refused('sidetoneLevel', 2.5, 'Alpha Wireless: sidetone level 2.5', s);
  await refused('sidetoneLevel', '70', 'Alpha Wireless: sidetone level "70" (text)', s);
  s.ignoreSets.add(0x11);
  try { await driver.write('sidetoneLevel', 90); check(false, 'Alpha Wireless: a level that did not land was accepted'); }
  catch (e) { check(/read back 64/.test(e.message) && s.state.sidetoneLevel === 64, `Alpha Wireless: a level that did not land is reported (${e.message})`); }
  s.ignoreSets.clear();
  // NGENUITY running: no write at all, every setting
  driver.vendorApp = async () => 'NGENUITY.exe'; driver.appAt = 0;
  for (const [k, val] of [['sidetoneLevel', 80], ['sidetone', true], ['autoOff', 10], ['voicePrompts', false], ['micMute', true]]) await refused(k, val, `Alpha Wireless: ${k} while NGENUITY runs`, s);
  check(s.state.sidetoneLevel === 64 && s.state.voicePrompts === 1, 'Alpha Wireless: nothing changed while NGENUITY ran');
  driver.vendorApp = async () => null; driver.appAt = 0;
  check(await driver.write('sidetoneLevel', 70) === 70 && await driver.write('sidetoneLevel', 64) === 64, 'Alpha Wireless: writes again once NGENUITY is closed');
  check(!cmdsSent(s).includes(0x03) && s.harm.length === 0, `Alpha Wireless: the held command 03 was never sent (${s.harm})`);

  const h = alpha('1743');
  check(await use(h), 'Alpha Wireless 1743 (HH only): connects');
  check((await driver.read()).voicePrompts === true, 'Alpha Wireless 1743: reads');
  await refused('voicePrompts', false, 'Alpha Wireless 1743: writes (id from one source)', h);
  await refused('sidetoneLevel', 70, 'Alpha Wireless 1743: sidetone level (id from one source)', h);
}

// ---- Cloud III Wireless: read-only ----
{
  const s = iii();
  check(await use(s), 'Cloud III Wireless: connects');
  s.sent.length = 0;
  const v = await driver.read();
  check(v.sidetone === true && v.micMute === true && v.silentMode === false && v.autoOff === 10, `Cloud III Wireless: reads past the notices ${JSON.stringify(v)}`);
  check(s.sent.every((f) => f.length === 62 && f[0] === 0x66 && f.slice(2).every((x) => x === 0)), 'Cloud III Wireless: every get is 66 <cmd> padded to 62 bytes');
  let b = await driver.battery();
  check(b.percent === 88 && b.charging === undefined, `Cloud III Wireless: battery 88%, charging left unknown (meaning unconfirmed) (${JSON.stringify(b)})`);
  s.state.batteryValid = 0;
  b = await driver.battery();
  check(b.percent === null, 'Cloud III Wireless: battery ignored when bytes 2 and 3 are zero');
  const inf = await driver.info();
  check(inf.Connected === 'yes' && /unconfirmed/.test(Object.keys(inf).join()) && /read-only|none/.test(inf.Changes), `Cloud III Wireless: info ${JSON.stringify(inf)}`);
  check(!('Sidetone level (raw)' in inf) && inf['Product color code (mapping unconfirmed)'] === '2', 'Cloud III Wireless: product color 8F in info; the raw sidetone byte (no documented scale) is not shown');
  check(JSON.stringify(driver.settings.map((x) => x.key)) === JSON.stringify(['sidetone', 'micMute', 'autoOff', 'silentMode']), `Cloud III Wireless: offers only its own settings (${driver.settings.map((x) => x.key)})`);
  check(!('sidetoneLevel' in v) && !('sidetoneStep' in v), 'Cloud III Wireless: its raw sidetone byte is not shown on a ranged slider');
  for (const [k, val] of [['sidetone', false], ['micMute', false], ['autoOff', 20], ['silentMode', true]]) await refused(k, val, `Cloud III Wireless: ${k} (ids "possible")`, s);
  check(!cmdsSent(s).some((c) => c < 0x80) && s.harm.length === 0, `Cloud III Wireless: only 0x8x gets were sent, never 1E or 83 (${s.harm})`);
}

// ---- Cloud II Core Wireless: read-only (HH alone) ----
{
  const s = core();
  check(await use(s), 'Cloud II Core Wireless: connects');
  check((await driver.info()).Model === 'HyperX Cloud II Core Wireless', 'Cloud II Core Wireless: info names the model');
  s.sent.length = 0;
  const v = await driver.read();
  check(v.sidetone === true && v.micMute === false && v.silentMode === true && v.autoOff === 20 && v.sidetoneStep === -1 && v.noiseGate === true,
    `Cloud II Core Wireless: reads past the notices, FF = -1 (${JSON.stringify(v)})`);
  check(s.sent.every((f) => f.length === 64 && f[0] === 0x66 && f.slice(2).every((x) => x === 0)), 'Cloud II Core Wireless: every get is 66 <cmd> padded to 64 bytes');
  s.state.sidetoneStep = 9;
  check((await driver.read()).sidetoneStep === null, 'Cloud II Core Wireless: a level outside -5..5 is not shown');
  check((await driver.battery()).percent === 61, 'Cloud II Core Wireless: battery from 89');
  check((await driver.info())['Boom mic'] === 'attached', 'Cloud II Core Wireless: boom mic from 8C');
  for (const [k, val] of [['sidetone', false], ['noiseGate', false], ['sidetoneStep', 0], ['autoOff', 10], ['silentMode', false], ['micMute', true]]) await refused(k, val, `Cloud II Core Wireless: ${k} (one source)`, s);
  check(!cmdsSent(s).some((c) => c < 0x80) && s.harm.length === 0, `Cloud II Core Wireless: only 0x8x gets were sent, never 1E or 83 (${s.harm})`);
}

// ---- Cloud III S Wireless: read-only, feature-report gets, replies read from the raw channel (HH only) ----
{
  const s = iiis();
  check(await use(s), 'Cloud III S Wireless: connects');
  check((await driver.info()).Model === 'HyperX Cloud III S Wireless', 'Cloud III S Wireless: info names the model');
  s.sent.length = 0; s.feature.length = 0;
  const v = await driver.read();
  check(v.sidetone === true && v.micMute === true && v.voicePrompts === false && !('autoOff' in v), `Cloud III S Wireless: reads past the 0D notice ${JSON.stringify(v)}`);
  check(s.feature.length === s.sent.length && s.sent.length === 3 && s.sent.every((f) => f.length === 64 && hex(f.slice(0, 5)) === '0c 02 03 01 00' && f.slice(6).every((x) => x === 0)),
    `Cloud III S Wireless: every get is the feature report 0C 02 03 01 00 <cmd>, 64 bytes (${s.sent.map((f) => hex(f.slice(0, 6))).join(' | ')})`);
  check(hex(cmdsSent(s)) === '16 04 14', `Cloud III S Wireless: read() sends sidetone 16, mute 04, voice prompts 14 (${hex(cmdsSent(s))})`);
  const b = await driver.battery();
  check(b.percent === 77 && b.charging === undefined, `Cloud III S Wireless: battery 77% from byte 6, charging left unknown (${JSON.stringify(b)})`);
  s.state.battery = 0xff;
  check((await driver.battery()).percent === null, 'Cloud III S Wireless: FF at byte 6 is no value');
  const inf = await driver.info();
  check(inf.Connected === 'yes' && inf['Product color code (mapping unconfirmed)'] === '3' && inf['Charging (raw, meaning unconfirmed)'] === '1' && /none/.test(inf.Changes), `Cloud III S Wireless: info ${JSON.stringify(inf)}`);
  check((await driver.rawBackup()).replies.autoOffRaw && JSON.stringify(driver.settings.map((x) => x.key)) === JSON.stringify(['sidetone', 'micMute', 'voicePrompts']), `Cloud III S Wireless: auto-off only in the raw backup; offers ${driver.settings.map((x) => x.key)}`);
  for (const [k, val] of [['sidetone', false], ['micMute', false], ['voicePrompts', true], ['autoOff', 10]]) await refused(k, val, `Cloud III S Wireless: ${k} (one source)`, s);
  check(s.harm.length === 0 && cmdsSent(s).every((c) => Object.values(MODELS[5].reads).some((r) => r.cmd === c)), `Cloud III S Wireless: only its documented gets were sent (${s.harm})`);
  const s2 = iiis('02cc');
  check(await use(s2) && (await driver.battery()).percent === 77, 'Cloud III S Wireless 02CC: connects and reads');
  const spec = hidSpecs(driver).find((x) => x.pid === '06BE');
  check(spec.reply === 'raw' && spec.featureLen === 63 && spec.outputLen === undefined && spec.reportId === 0x0c && spec.page === '*', `Cloud III S Wireless: its channel is raw, feature length 63 (${JSON.stringify(spec)})`);
}

// ---- Cloud Flight Wireless (03F0:0E90): battery from voltage, nothing else ----
{
  const s = flight();
  check(await use(s), 'Cloud Flight (HP 0E90): connects');
  check(JSON.stringify(await driver.read()) === '{}' && driver.settings.length === 0, 'Cloud Flight: no settings');
  s.sent.length = 0;
  let b = await driver.battery();
  check(b.percent === 70 && b.charging === false, `Cloud Flight: 3850 mV = 70% (HH table), not charging (${JSON.stringify(b)})`);
  check(s.sent.length === 1 && s.sent[0].length === 20 && hex(s.sent[0].slice(0, 4)) === '21 ff 05 00', `Cloud Flight: the get is 21 FF 05, 20 bytes (${hex(s.sent[0] || [])})`);
  const inf = await driver.info();
  check(inf['Battery voltage'] === '3850 mV' && /estimated/.test(inf.Battery), `Cloud Flight: info shows the voltage and the estimate (${JSON.stringify(inf)})`);
  s.state.mV = 4200; b = await driver.battery();
  check(b.percent === null && b.charging === true, `Cloud Flight: 4200 mV = charging, no level (${JSON.stringify(b)})`);
  s.state.mV = 0x1010; b = await driver.battery();
  check(b.charging === undefined && b.percent === 100, `Cloud Flight: 4112 mV, the sources disagree on charging: left unknown (${JSON.stringify(b)})`);
  check(flightBattery(3000).percent === 5 && flightBattery(3970).percent === 100 && flightBattery(3969).percent === 95 && flightBattery(0).percent === null, 'Cloud Flight: the table edges');
  for (const [k, val] of [['sidetone', true], ['autoOff', 10], ['micMute', true]]) await refused(k, val, `Cloud Flight: ${k}`, s);
  check(s.harm.length === 0, `Cloud Flight: nothing undocumented sent (${s.harm})`);
}

// ---- Kingston-era (0951) headsets: device-library/hyperx-kingston, read only ----
{
  const kmeta = JSON.parse(fs.readFileSync(new URL('../device-library/hyperx-kingston/device.json', import.meta.url), 'utf8'));
  check(problem(kdriver) === null, `Kingston: the driver passes my-devices' check (${problem(kdriver)})`);
  check(validateMeta(kmeta) === null && kmeta.id === kdriver.id && kmeta.vid === '0951' && kmeta.status === 'untested' && kmeta.tested.length === 0, `Kingston: device.json valid, untested, vendor 0951 (${validateMeta(kmeta)})`);
  check(JSON.stringify([...kmeta.pids].sort()) === JSON.stringify(K.MODELS.flatMap((m) => m.pids).sort()), 'Kingston: device.json lists every product id the driver answers on');
  const ks = hidSpecs(kdriver);
  const k1718 = ks.find((x) => x.pid === '1718'), kf = ks.find((x) => x.pid === '16C4');
  check(ks.length === 4 && ks.every((x) => x.vid === '0951'), 'Kingston: one channel per id, all vendor 0951');
  check(k1718.reply === 'raw' && k1718.inputReports === true && k1718.outputLen === 61 && k1718.reportId === 6, `Kingston Cloud II: raw channel with input reports on request, 61-byte output (${JSON.stringify(k1718)})`);
  check(kf.reply === undefined && kf.outputLen === 19 && kf.reportId === 0x21 && kf.echo() === 2, 'Kingston Cloud Flight: 21 FF channel, 19-byte output, echo 2');

  const s = kingston();
  current = s;
  check(await kdriver.connect(), 'Kingston Cloud II: connects');
  check((await kdriver.info()).Model === 'HyperX Cloud II Wireless (Kingston)' && (await kdriver.info())['USB id'] === '0951:1718', 'Kingston Cloud II: info names the model and its id');
  s.sent.length = 0; s.prepared.length = 0;
  const v = await kdriver.read();
  check(v.autoOff === 20 && JSON.stringify(kdriver.settings.map((x) => x.key)) === '["autoOff"]', `Kingston Cloud II: auto-off 20 read past the 0A report (${JSON.stringify(v)})`);
  check(s.sent.length === 1 && s.sent[0].length === 62 && hex(s.sent[0].slice(0, 17)) === '06 00 02 00 9a 00 00 68 4a 8e 0a 00 00 00 bb 1a 00', `Kingston Cloud II: the get is the 62-byte Kingston frame with 1A (${hex(s.sent[0] || [])})`);
  check(s.prepared.length === 1 && s.prepared[0][0] === 6, 'Kingston Cloud II: input report 06 asked for (the prepare read) before the write');
  const b = await kdriver.battery();
  check(b.percent === 64 && b.charging === true, `Kingston Cloud II: battery 64% from byte 7, charging from byte 4 (${JSON.stringify(b)})`);
  s.state.charging = 2;
  check((await kdriver.battery()).charging === false, 'Kingston Cloud II: 2 (full) is not charging');
  check(/^0b 00 bb 02/.test((await kdriver.rawBackup()).replies.battery), 'Kingston Cloud II: the raw backup keeps the 0B reply');
  for (const [k, val] of [['autoOff', 10], ['autoOff', 20], ['sidetone', true], ['__proto__', 1]]) await refused(k, val, `Kingston Cloud II: ${k}`, s);
  check(!cmdsSent(s).includes(0x01) && s.harm.length === 0, `Kingston Cloud II: 01, 18 and 19 never sent (${s.harm})`);

  for (const pid of ['16c4', '1723', '1749']) {
    const f = flight(pid, 0x0951, K.FAMILIES);
    current = f;
    check(await kdriver.connect(), `Kingston Cloud Flight ${pid}: connects`);
    const fb = await kdriver.battery();
    check(fb.percent === 70 && fb.charging === false && (await kdriver.info()).Model === 'HyperX Cloud Flight Wireless', `Kingston Cloud Flight ${pid}: 3850 mV = 70% (${JSON.stringify(fb)})`);
    check(JSON.stringify(await kdriver.read()) === '{}' && kdriver.settings.length === 0, `Kingston Cloud Flight ${pid}: no settings`);
    await refused('autoOff', 10, `Kingston Cloud Flight ${pid}: auto-off`, f);
    check(f.harm.length === 0 && f.sent.every((x) => hex(x.slice(0, 3)) === '21 ff 05'), `Kingston Cloud Flight ${pid}: only 21 FF 05 sent`);
  }
  // an HP-era id is not this driver's, and a Kingston id is not hyperx-cloud's
  current = flight('0e90');
  check(!(await kdriver.connect()), 'Kingston: the HP Cloud Flight id (03F0:0E90) is left to hyperx-cloud');
  current = flight('16c4', 0x0951, K.FAMILIES);
  check(!(await driver.connect(false)), 'hyperx-cloud: a Kingston id is left to hyperx-kingston');

  // the NEVER list and every command byte, as a get and as a set
  for (const [mk, model] of [[kingston, K.MODELS[0]], [() => flight('16c4', 0x0951, K.FAMILIES), K.MODELS[1]], [() => flight('1749', 0x0951, K.FAMILIES), K.MODELS[2]]]) {
    const sim = mk();
    const link = new K.Link(sim, model, { timeoutMs: 20 });
    const fam = K.FAMILIES[model.family];
    for (let c = 0; c < 256; c++) for (const frame of [[...fam.header, c], [...fam.header, c, 1]]) { try { await link.send(frame); } catch {} }
    const got = new Set(cmdsSent(sim));
    const allowed = new Set(Object.values(model.reads).map((x) => x.cmd));
    check([...got].every((c) => allowed.has(c)) && sim.harm.length === 0 && sim.sent.every((f) => f.length === model.len),
      `${model.name} ${model.pids}: all 512 frames tried, only its gets left (${hex([...got])}; ${sim.harm})`);
  }
  for (const frame of [[...K.FAMILIES.kingston.header, 0x01], [...K.FAMILIES.kingston.header, 0x19, 0x01], [...K.FAMILIES.kingston.header, 0x18, 0x0a], [0x00, 0xde, 0xff], [0x06, 0xde, 0xff]]) {
    const sim = kingston();
    let threw = false;
    try { await new K.Link(sim, K.MODELS[0], { timeoutMs: 20 }).send(frame); } catch (e) { threw = /refused/.test(e.message); }
    check(threw && sim.sent.length === 0, `Kingston: ${hex(frame.slice(-3))} refused before sending`);
  }
  check(K.NEVER.every((n) => n.why && n.what), 'Kingston: every NEVER entry carries its reason');
}

// ---- the NEVER list, tried every way the driver has ----
{
  const tries = [
    [hp, MODELS[0], [0x06, 0xff, 0xbb, 0x01]], [hp, MODELS[0], [0x06, 0xff, 0xbb, 0x01, 0x00]],
    [iii, MODELS[3], [0x66, 0x1e]], [iii, MODELS[3], [0x66, 0x1e, 0x00]], [iii, MODELS[3], [0x66, 0x83]],
    [hp, MODELS[0], [0x00, 0xde, 0xff]], [alpha, MODELS[1], [0x21, 0xde, 0xff]], [iii, MODELS[3], [0x66, 0xde, 0xff]],
    [alpha, MODELS[1], [0x21, 0xbb, 0x03]], [alpha, MODELS[1], [0x21, 0xbb, 0x11, 0x81]], [alpha, MODELS[2], [0x21, 0xbb, 0x11, 0x40]], [hp, MODELS[0], [0x06, 0xff, 0xbb, 0x23, 0x05]],
    [core, MODELS[4], [0x66, 0x1e]], [core, MODELS[4], [0x66, 0x83]], [core, MODELS[4], [0x66, 0x0f, 0x01]], [core, MODELS[4], [0x66, 0x05, 0x00]],
  ];
  for (const [mk, model, frame] of tries) {
    const sim = mk();
    const link = new Link(sim, model, { timeoutMs: 100 });
    let threw = false;
    try { await link.send(frame); } catch (e) { threw = /refused/.test(e.message); }
    try { await link.send(frame, { reply: false }); } catch (e) { threw = threw && /refused/.test(e.message); }
    let checked = false; try { checkFrame(model, frame); } catch { checked = true; }
    check(threw && checked && sim.sent.length === 0, `${hex(frame)} on ${model.name}: refused before sending (${sim.sent.length} sent)`);
  }
  check(NEVER.every((n) => n.why && n.what), 'every NEVER entry carries the sheet\'s reason');
  // every possible command byte, as a get and as a set, through the link: only the model's documented bytes get out
  for (const [mk, model] of [[hp, MODELS[0]], [alpha, MODELS[1]], [alpha, MODELS[2]], [iii, MODELS[3]], [core, MODELS[4]], [iiis, MODELS[5]], [flight, MODELS[6]]]) {
    const sim = mk();
    const link = new Link(sim, model, { timeoutMs: 20 });
    const fam = FAMILIES[model.family];
    for (let c = 0; c < 256; c++) {
      for (const frame of [[...fam.header, c], [...fam.header, c, 1]]) { try { await link.send(frame, { reply: frame.length === fam.cmdAt + 1 }); } catch {} }
    }
    const got = new Set(cmdsSent(sim));
    const allowed = new Set([...Object.values(model.reads), ...(model.readOnlyWhy ? [] : Object.values(model.writes))].map((x) => x.cmd));
    const extra = [...got].filter((c) => !allowed.has(c));
    const never = NEVER.filter((n) => n.family === model.family).map((n) => n.cmd);
    check(extra.length === 0 && !never.some((c) => got.has(c)) && model.held.every((h) => !got.has(h.cmd)) && sim.harm.length === 0,
      `${model.name} ${model.pids}: all 512 frames tried, only documented commands left (${hex([...got])}; extra ${hex(extra)}; ${sim.harm})`);
  }
}

current = null;
check((await driver.connect(false)) === false, 'nothing plugged in: connect() says so');

console.log(fails.length ? `sim-hyperx: FAILED:\n  ${fails.join('\n  ')}` : 'sim-hyperx (Cloud II Wireless, Alpha Wireless, Cloud III Wireless, Cloud II Core Wireless, Cloud III S Wireless, Cloud Flight (03F0 and 0951), Kingston Cloud II Wireless simulated; NEVER list holds; nothing written while NGENUITY runs): all good');
process.exitCode = fails.length ? 1 : 0;
