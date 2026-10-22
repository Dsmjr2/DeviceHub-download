// Drivers as data (helpers/declarative-driver.mjs, docs/DRIVER-FORMAT.md). Part 1, the proof: the ASUS ROG mouse
// library driver's device.mjs and its driver.json, run through the same steps against the same simulated mouse (copied
// from tests/sim-asus.mjs, which does not export it), must send byte-for-byte the same requests on the same report ids
// and give the same values (read, battery, settings, write results, which steps are refused). Part 2: validate()
// refuses each kind of bad file, in plain words. Part 3: the feature-report path and a checksum, on a pretend device.
// Run: node tests/declarative-driver.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeviceProvider } from '../public/devices/hid.js';
import { fromJson, validate, parseTemplate } from '../helpers/declarative-driver.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = path.join(ROOT, 'device-library', 'asus-rog-mouse', 'driver.json');
const { default: coded } = await import('../device-library/asus-rog-mouse/device.mjs');
const data = fromJson(JSON_FILE);
for (const d of [coded, data]) d.vendorApp = async () => null;   // no tasklist in the test

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// ---- the simulated mouse (from tests/sim-asus.mjs) ----
function simMouse({ battery = true, pct = 77 } = {}) {
  return { battery, pct, charging: 0, sleep: 0x03, low: 20, dpi: [800, 1600, 3200, 0], colors: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255],
    poll: 0x03, debounce: 0x02, snap: 0, lift: 0x00, asleep: false, sticky: new Set(), saves: 0 };
}
function simDevice({ pid, m, omni = null }) {
  const listeners = new Set();
  const dev = {
    vendorId: 0x0b05, productId: pid, productName: 'simulated ROG', opened: false, sent: [],
    collections: omni ? [{ usagePage: 0xff00, usage: 1, outputReports: [{ reportId: 1 }, { reportId: 2 }, { reportId: 3 }] }] : [{ usagePage: 0xff01, usage: 1, outputReports: [] }],
    async open() { this.opened = true; },
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, bytes) {
      const p = Uint8Array.from(bytes);
      this.sent.push(`${id}: ${h(p)}`);
      const r = reply(p, id);
      if (r) setTimeout(() => listeners.forEach((f) => f({ reportId: id, data: new DataView(r.buffer) })), 1);
    },
  };
  function reply(p, id) {
    const r = new Uint8Array(64);
    const err = () => { r[0] = 0xff; r[1] = 0xaa; return r; };
    r[0] = p[0]; r[1] = p[1];
    const cmd = h(p.slice(0, 3));
    if (omni && id === 1) {
      if (cmd !== 'a0 00 00') return err();
      omni.paired.forEach((pidPaired, i) => { r[4 + 4 * i] = pidPaired & 0xff; r[5 + 4 * i] = pidPaired >> 8; });
      return r;
    }
    if (omni && cmd === '7d 20 02') { r[4] = omni.booster ? 1 : 0; return r; }
    if (m.asleep) return err();
    const raw = (d) => (d ? (d - 50) / 50 : 0);
    if (cmd.startsWith('12 07')) { if (!m.battery) return err(); r[4] = m.pct; r[5] = m.sleep; r[6] = m.low; r[9] = m.charging; return r; }
    if (cmd === '12 04 00') { m.dpi.forEach((d, i) => { r[4 + 2 * i] = raw(d) & 0xff; r[5 + 2 * i] = raw(d) >> 8; }); r[12] = m.poll | (omni?.booster ? 0x30 : 0); r[14] = m.debounce; r[16] = m.snap; return r; }
    if (cmd === '12 04 03') { m.colors.forEach((c, i) => { r[4 + i] = c; }); return r; }
    if (cmd.startsWith('12 06')) { r[7] = m.lift; return r; }
    if (p[0] === 0x51 && p[1] === 0x31 && p[3] === 0x00) {
      if (p[2] <= 3) { if (!m.sticky.has('dpi')) m.dpi[p[2]] = (p[4] | (p[5] << 8)) * 50 + 50; if (p[6] | p[7] | p[8]) m.colors.splice(3 * p[2], 3, p[6], p[7], p[8]); return r; }
      if (p[2] === 4) { if (p[4] > 6) return err(); if (!m.sticky.has('poll')) m.poll = p[4]; return r; }
      if (p[2] === 6) { if (!m.sticky.has('snap')) m.snap = p[4]; return r; }
      return err();
    }
    if (cmd === '51 37 00' && p[3] === 0) { if (!m.battery) return err(); m.sleep = p[4]; m.low = p[6]; return r; }
    if (h(p.slice(0, 5)) === '51 35 ff 00 ff') { m.lift = p[5]; return r; }
    if (p[0] === 0x50 && p[1] === 0x03) { m.saves++; return r; }
    return err();
  }
  return dev;
}

let plugged = null;
setDeviceProvider(async (filters) => (plugged && filters.some((f) => f.vendorId === plugged.vendorId && f.productId === plugged.productId) ? plugged : null));

// ---- one script, run on both drivers; every step's outcome is recorded ----
const page = (s) => s.map((x) => ({ key: x.key, label: x.label, type: x.type, min: x.min, max: x.max, step: x.step, unit: x.unit, options: x.options, hint: x.hint }));
async function script(drv, devices) {
  const out = [];
  const step = async (label, fn) => {
    try { out.push([label, 'ok', await fn()]); } catch (e) { out.push([label, 'refused']); }
  };
  const plug = (d) => step(`connect ${d.productId.toString(16)}`, () => { plugged = d; return drv.connect(false); });
  const look = async (tag) => {
    await step(`${tag} info`, async () => { const i = await drv.info(); return { Model: i.Model, Connection: i.Connection }; });
    await step(`${tag} settings`, () => page(drv.settings));
    await step(`${tag} read`, () => drv.read());
    await step(`${tag} battery`, () => drv.battery());
  };
  const roundTrip = async (key, to) => {
    await step(`read before ${key}`, () => drv.read());
    await step(`write ${key} ${to}`, () => drv.write(key, to));
    await step(`read after ${key}`, () => drv.read());
    const was = out.at(-3)[2]?.[key];
    await step(`put ${key} back`, () => drv.write(key, was));
  };
  const [cable, omni, keris, unknown, chakram, chakramRx, gladius, locked, gladiusRx] = devices;
  const ms = devices.map((d) => d.m);

  // 1. Harpe Ace on its cable: every setting, the refusals, a write that does not stick, the vendor app
  await plug(cable.d); await look('cable');
  await roundTrip('dpi2', 2400); await roundTrip('pollingRate', 500); await roundTrip('angleSnap', true);
  await roundTrip('liftOff', 'high'); await roundTrip('sleep', 10);
  for (const [k, v] of [['pollingRate', 8000], ['pollingRate', 300], ['dpi1', 37000], ['dpi1', 825], ['dpi5', 800], ['debounce', 1], ['sleep', 4], ['angleSnap', 1], ['__proto__', 1]]) await step(`refuse ${k} ${v}`, () => drv.write(k, v));
  ms[0].sticky.add('snap'); await step('write that does not stick', () => drv.write('angleSnap', true)); ms[0].sticky.clear();
  drv.vendorApp = async () => 'ArmouryCrate.UserSessionHelper.exe'; drv.appAt = 0;
  await step('write while Armoury Crate runs', () => drv.write('pollingRate', 500));
  drv.vendorApp = async () => null; drv.appAt = 0;
  await step('raw backup', async () => { await drv.rawBackup(); return 'taken'; });

  // 2. Harpe Ace behind the Omni receiver, a keyboard paired too; then asleep
  await plug(omni.d); await look('omni');
  await roundTrip('dpi1', 1200); await roundTrip('pollingRate', 250);
  await step('refuse 8000 Hz through Omni', () => drv.write('pollingRate', 8000));
  ms[1].asleep = true;
  await step('asleep info', () => drv.info());
  await step('asleep awake()', () => drv.awake());
  await step('asleep write', () => drv.write('angleSnap', true));
  ms[1].asleep = false;
  await step('awake again', () => drv.awake());
  await step('read once awake', () => drv.read());

  // 3. Keris AimPoint through Omni with the booster on: polling is not a setting
  await plug(keris.d); await look('booster');
  await step('refuse polling with booster', () => drv.write('pollingRate', 1000));

  // 4. Omni with nothing this driver knows paired
  await plug(unknown.d);

  // 5. Chakram X: DPI read only, 8000 Hz on its cable only
  await plug(chakram.d); await look('chakram');
  await step('refuse Chakram DPI', () => drv.write('dpi1', 800));
  await roundTrip('pollingRate', 8000);
  await plug(chakramRx.d); await look('chakram receiver');
  await step('refuse 8000 Hz on the receiver', () => drv.write('pollingRate', 8000));

  // 6. Gladius III: no battery, no sleep setting, DPI up to 19000
  await plug(gladius.d); await look('gladius');
  await step('refuse 20000 DPI', () => drv.write('dpi1', 20000));
  await roundTrip('dpi1', 19000);
  ms[6].asleep = true; await step('cable refuses everything', () => drv.info()); ms[6].asleep = false;

  // 7. a stage above the model's maximum: DPI becomes read only (device.mjs: dpiLocked)
  await plug(locked.d); await look('locked');
  await step('refuse a locked DPI write', () => drv.write('dpi1', 800));

  // 8. Gladius III Wireless on its receiver at 0% and not charging: asleep
  await plug(gladiusRx.d);
  await step('0% not charging info', () => drv.info());
  await step('0% not charging awake()', () => drv.awake());
  return out;
}
const world = () => {
  const mk = (pid, mo = {}, omni = null) => { const m = simMouse(mo); return { m, d: simDevice({ pid, m, omni }) }; };
  const lockedMouse = mk(0x197b, { battery: false }); lockedMouse.m.dpi[2] = 20000;
  return [mk(0x1a92), mk(0x1ace, {}, { paired: [0x1a85, 0x1a94], booster: false }), mk(0x1ace, {}, { paired: [0x1a6a], booster: true }),
    mk(0x1ace, {}, { paired: [0x1a85], booster: false }), mk(0x1a18), mk(0x1a1a), mk(0x197b, { battery: false }), lockedMouse, mk(0x197f, { pct: 0 })];
};

{
  const A = world(), B = world();
  const ra = await script(coded, A), rb = await script(data, B);
  ok(ra.length === rb.length && ra.length > 90, `both ran the same ${ra.length} steps`);
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
    if (JSON.stringify(ra[i]) !== JSON.stringify(rb[i])) { ok(false, `step ${i} "${ra[i]?.[0]}": device.mjs ${JSON.stringify(ra[i]?.slice(1))} vs driver.json ${JSON.stringify(rb[i]?.slice(1))}`); if (fails > 6) break; }
  }
  let bytes = 0;
  A.forEach((a, i) => {
    const b = B[i];
    bytes += a.d.sent.length;
    const at = a.d.sent.findIndex((x, j) => x !== b.d.sent[j]);
    ok(a.d.sent.length === b.d.sent.length && at === -1, `device ${i + 1}: same requests (${a.d.sent.length} vs ${b.d.sent.length}${at >= 0 ? `; first difference at #${at}: ${a.d.sent[at]} vs ${b.d.sent[at]}` : ''})`);
    ok(JSON.stringify({ ...a.m, sticky: 0 }) === JSON.stringify({ ...b.m, sticky: 0 }), `device ${i + 1}: the mouse ends in the same state`);
  });
  ok(bytes > 150, `the requests compared: ${bytes}`);
  if (process.env.SHOW) { for (const x of rb) console.log(`${x[0]}: ${x[1]} ${JSON.stringify(x[2] ?? '').slice(0, 90)}`); console.log('requests:', bytes); }
  // a few facts on their own, so a shared mistake in both drivers still shows
  const get = (label) => rb.find((x) => x[0] === label);
  ok(JSON.stringify(get('cable read')[2]) === JSON.stringify({ dpi1: 800, dpi2: 1600, dpi3: 3200, pollingRate: 1000, angleSnap: false, liftOff: 'low', sleep: 5 }), `cable read: ${JSON.stringify(get('cable read')[2])}`);
  ok(get('write dpi2 2400')[1] === 'ok' && B[0].d.sent.includes(`0: ${h([0x51, 0x31, 0x01, 0x00, 0x2f, 0x00, 0x00, 0xff, 0x00, ...new Array(55).fill(0)])}`), 'DPI 2400 goes out as 51 31 01 00 2f 00 + the stage color read back');
  ok(get('write that does not stick')[1] === 'refused' && get('write while Armoury Crate runs')[1] === 'refused', 'a write that does not stick and a write beside Armoury Crate are refused');
  ok(get('connect 1ace') && rb.filter((x) => x[0] === 'connect 1ace')[2][1] === 'refused', 'an Omni receiver with an unknown mouse paired is refused');
  ok(!page(rb.find((x) => x[0] === 'locked settings')[2]).some((s) => /^dpi/.test(s.key)), 'a DPI stage above the maximum makes DPI read only');
  ok(B[1].d.sent[0] === `1: ${h([0xa0, 0, 0, ...new Array(61).fill(0)])}` && B[1].d.sent[1].startsWith('3: 7d 20 02'), 'Omni: pair list on report 1, booster probe on report 3');
}

// ---- 2. validate() refuses each kind of bad file ----
const asus = () => JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
const set = (j, key) => j.settings.find((s) => s.key === key);
const mini = (over = {}) => ({
  format: 1, id: 'pretend-light', title: 'Pretend light', kind: 'Light', vid: 'FFFF', pids: ['FFE0'],
  transport: { report: 'output', len: 32, reportId: 0 }, links: { usb: { label: 'USB' } }, models: [{ name: 'Pretend', pids: { usb: ['FFE0'] } }],
  replies: { echo: [0] }, messages: { get: { bytes: '20' }, set: { bytes: '21 {value}' } }, reads: [{ name: 'state', message: 'get' }],
  fields: { brightness: { from: 'state', offset: 1 } },
  settings: [{ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, write: { message: 'set' } }], ...over,
});
ok(validate(mini()).ok, `the small pretend file is accepted (${validate(mini()).problems.join('; ')})`);
const refuses = (why, file, re) => {
  const r = validate(file);
  ok(!r.ok && r.problems.some((p) => re.test(p)), `${why}: ${r.ok ? 'ACCEPTED' : r.problems.find((p) => re.test(p)) || `other reasons: ${r.problems.join('; ')}`}`);
};
refuses('not an object', [], /not a JSON object/);
refuses('wrong format version', mini({ format: 2 }), /"format" must be 1/);
refuses('no id', (() => { const j = asus(); delete j.id; return j; })(), /"id" must be/);
refuses('a built-in id', mini({ id: 'mouse' }), /built-in/);
refuses('a byte that is not hex', (() => { const j = asus(); j.messages.status.bytes = '12 7'; return j; })(), /neither a byte/);
refuses('a write sending a message that is not a template', (() => { const j = asus(); set(j, 'angleSnap').write.message = 'mystery'; return j; })(), /nothing may be sent that is not a template/);
refuses('raw bytes hidden in a setting', (() => { const j = asus(); set(j, 'dpi1').bytes = '51 21'; return j; })(), /does not know/);
refuses('a placeholder with no source', (() => { const j = asus(); j.messages.save.bytes = '50 03 {nothing}'; return j; })(), /would come from nowhere/);
refuses('a template on its own never list', (() => { const j = asus(); j.messages.lights = { bytes: '51 28 00 00 00 {lowBattery}' }; return j; })(), /its own never list/);
refuses('a template on DeviceHub\'s never list (ASUS reset)', (() => { const j = asus(); j.messages.reset = { bytes: '50 40' }; return j; })(), /DeviceHub's never list \(ASUS ROG\)/);
refuses('a {value} that can reach a never pattern', (() => { const j = asus(); j.messages.setPolling.bytes = '51 {value}'; set(j, 'pollingRate').write.encode = { map: { 125: 0x21, 250: 1, 500: 2, 1000: 3, 2000: 4, 4000: 5, 8000: 6 } }; return j; })(), /could send 51 21/);
refuses('VIA bootloader jump on any vendor', mini({ transport: { report: 'output', len: 32, reportId: 0, usagePage: 'FF60' }, messages: { get: { bytes: '20' }, set: { bytes: '21 {value}' }, boot: { bytes: '0B' } } }), /VIA bootloader jump/);
refuses('Turtle Beach RACE nvkey write (wildcards)', mini({ vid: '10F5', transport: { report: 'output', len: 62, reportId: 6 }, messages: { get: { bytes: '20' }, set: { bytes: '21 {value}' }, nv: { bytes: '0C 00 05 5A 08 00 01 0A' } } }), /RACE nvkey write/);
refuses('Wooting reset to bootloader (nibble wildcard)', mini({ vid: '31E3', messages: { get: { bytes: '20' }, set: { bytes: '21 {value}' }, boot: { bytes: 'D1 DA 02' } } }), /ResetToBootloader/);
refuses('a Logitech file', mini({ vid: '046D' }), /cannot be a driver\.json/);
refuses('a write with no read of the same setting', mini({ settings: [{ key: 'mode', label: 'Mode', type: 'toggle', write: { message: 'set' } }] }), /every setting is read before it is written/);
refuses('a setting read only on demand', (() => { const j = asus(); set(j, 'angleSnap').field = 'dpi1Color'; return j; })(), /read only on demand/);
refuses('a numeric write without a range', (() => { const j = asus(); delete set(j, 'dpi1').max; return j; })(), /slider without a range/);
refuses('a value too big for its byte', (() => { const j = asus(); j.messages.setDpi1.bytes = '51 31 00 00 {value} {dpi1Color?}'; return j; })(), /cannot be sent .*does not fit in 1 byte/);
refuses('a firmware / reset control', mini({ settings: [{ key: 'brightness', label: 'Factory reset', type: 'slider', min: 0, max: 100, write: { message: 'set' } }] }), /firmware, reset, flash or pairing/);
refuses('an unknown checksum', mini({ transport: { report: 'output', len: 32, reportId: 0, checksum: { type: 'crc32', from: 0, to: 10, at: 11 } } }), /checksum\.type must be one of/);
refuses('a template over the checksum byte', mini({ transport: { report: 'output', len: 32, reportId: 0, checksum: { type: 'xor', from: 2, to: 4, at: 1 } } }), /reaches the checksum byte/);
refuses('an optional placeholder in the middle', (() => { const j = asus(); j.messages.setDpi1.bytes = '51 31 00 00 {dpi1Color?} {value:u16le}'; return j; })(), /may only be the last/);
refuses('a product id no model has', mini({ pids: ['FFE0', 'FFE9'] }), /no model or receiver link has it/);
try { fromJson(mini({ settings: [{ key: 'x', label: 'X', type: 'slider', write: { message: 'set' } }] })); ok(false, 'fromJson accepted a bad file'); } catch (e) { ok(/^driver\.json refused: /.test(e.message), `fromJson refuses with the reasons: ${e.message.slice(0, 90)}...`); }
ok(validate(asus()).ok, `the ASUS driver.json passes (${validate(asus()).problems.join('; ')})`);
ok(parseTemplate('51 31 {value:u16le} {c?}').length === 4, 'templates parse');

// batteryCare (22 Oct 2026): the one setting DeviceHub may change for the battery; keys must be the file's own settings
{
  const cared = (care, over = {}) => mini({ fields: { brightness: { from: 'state', offset: 1 }, level: { from: 'state', offset: 2 } },
    battery: { from: 'state', percent: 'level' }, batteryCare: care, ...over });
  const good = cared({ lowBattery: { key: 'brightness', value: 10 }, charging: { key: 'brightness', value: 0 } });
  ok(validate(good).ok, `batteryCare naming its own slider, in range, is accepted (${validate(good).problems.join('; ')})`);
  const d = fromJson(good);
  ok(d.batteryCare?.lowBattery?.key === 'brightness' && d.batteryCare.lowBattery.value === 10 && d.batteryCare.charging.value === 0, 'fromJson hands batteryCare to the driver');
  const { batteryCareProblem } = await import('../helpers/my-devices.mjs');
  ok(batteryCareProblem(d) === null, `my-devices accepts the driver's batteryCare (${batteryCareProblem(d)})`);
  ok(!('batteryCare' in fromJson(mini())), 'a file without batteryCare gives a driver without it');
  refuses('batteryCare naming a setting the file does not have', cared({ lowBattery: { key: 'lights', value: false } }), /"lights", which is not one of its settings/);
  refuses('batteryCare with a value out of range', cared({ lowBattery: { key: 'brightness', value: 101 } }), /101 is not a value brightness takes/);
  refuses('batteryCare with a value of the wrong kind', cared({ charging: { key: 'brightness', value: false } }), /false is not a value brightness takes/);
  refuses('batteryCare with a rule it does not know', cared({ sleeping: { key: 'brightness', value: 0 } }), /batteryCare has "sleeping"/);
  refuses('batteryCare with extra parts', cared({ lowBattery: { key: 'brightness', value: 0, bytes: '21 00' } }), /batteryCare\.lowBattery must be \{ key, value \}/);
  refuses('batteryCare on a reading', cared({ lowBattery: { key: 'level', value: 0 } }, { settings: [{ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, write: { message: 'set' } }, { key: 'level', label: 'Battery', type: 'display' }] }), /level is a reading/);
  refuses('batteryCare without a battery', mini({ batteryCare: { lowBattery: { key: 'brightness', value: 0 } } }), /batteryCare needs "battery"/);
  refuses('batteryCare that is empty', cared({}), /batteryCare is empty/);
}

// ---- 3. feature reports and a checksum, on a pretend device (FFFF is not a real vendor) ----
{
  const file = mini({ id: 'pretend-feature', pids: ['FFE1'], models: [{ name: 'Pretend', pids: { usb: ['FFE1'] } }],
    transport: { report: 'feature', len: 16, reportId: 7, timeoutMs: 200, tries: 2, checksum: { type: 'xor', from: 0, to: 13, at: 14 } },
    replies: { echo: [1, 2], ok: { offset: 0, equals: '02' }, checksum: true },
    messages: { get: { bytes: '00 05 01' }, set: { bytes: '00 05 02 {value}' } }, fields: { brightness: { from: 'state', offset: 3 } } });
  const drv = fromJson(file);
  const st = { level: 60, badSum: false, fail: false }, sets = [];
  const x = (a) => a.reduce((s, b) => s ^ b, 0);
  let pending = null;
  const dev = { vendorId: 0xffff, productId: 0xffe1, opened: true, collections: [],
    async sendFeatureReport(id, d) { const p = Uint8Array.from(d); sets.push(`${id}: ${h(p)}`); if (p[2] === 2 && x(Array.from(p.slice(0, 14))) === p[14]) st.level = p[3]; pending = p; },
    async receiveFeatureReport(id, len) { const r = new Uint8Array(len); r[0] = st.fail ? 3 : 2; r[1] = pending[1]; r[2] = pending[2]; r[3] = st.level; r[14] = x(Array.from(r.slice(0, 14))) ^ (st.badSum ? 1 : 0); return new DataView(Uint8Array.from([id, ...r]).buffer); } };
  plugged = dev;
  ok(await drv.connect(false), 'feature device connects');
  ok((await drv.read()).brightness === 60, 'feature read: 60');
  ok((await drv.write('brightness', 40)) === 40 && st.level === 40, 'feature write 40 lands and reads back');
  ok(sets.includes(`7: ${h([0x00, 0x05, 0x02, 0x28, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x2f, 0])}`), `the write frame carries its XOR checksum at byte 14 (${sets.at(-2)})`);
  st.badSum = true; drv.snap = null;
  try { await drv.read(); ok(false, 'a reply with a bad checksum was believed'); } catch { ok(true, ''); }
  st.badSum = false; st.fail = true; drv.snap = null;
  try { await drv.read(); ok(false, 'a reply with a failure status was believed'); } catch { ok(true, ''); }
  st.fail = false;
  await refusesWrite(drv, 'brightness', 101);
}
async function refusesWrite(drv, key, v) { try { await drv.write(key, v); ok(false, `${key} ${v} accepted`); } catch { ok(true, ''); } }

// ---- 4. the page kinds (22 Oct 2026): display, color (one, and per zone) and remap, on a pretend device ----
{
  const { selfCheck, problem } = await import('../helpers/my-devices.mjs');
  const BTN = { 1: 'left', 2: 'right', 16: 'back' };
  const kinds = (over = {}) => mini({
    id: 'pretend-kinds', pids: ['FFE2'], models: [{ name: 'Pretend', pids: { usb: ['FFE2'] } }],
    messages: { get: { bytes: '30' }, setColor: { bytes: '31 {value:rgb}' }, setZone: { bytes: '32 {zone} {value:rgb}' }, setBtn: { bytes: '33 {button} {value}' } },
    fields: { temp: { from: 'state', offset: 1 }, color: { from: 'state', offset: 2, size: 3, type: 'bytes' }, logo: { from: 'state', offset: 5, size: 3, type: 'bytes' },
      wheel: { from: 'state', offset: 8, size: 3, type: 'bytes' }, btn1: { from: 'state', offset: 11, map: BTN }, btn2: { from: 'state', offset: 12, map: BTN } },
    settings: [
      { key: 'temp', label: 'Temperature', type: 'display', unit: ' C' },
      { key: 'color', label: 'Color', type: 'color', write: { message: 'setColor' } },
      { key: 'lights', label: 'Lights', type: 'color', zones: [{ value: 'logo', label: 'Logo', field: 'logo', code: 1 }, { value: 'wheel', label: 'Wheel', field: 'wheel', code: 2 }], write: { message: 'setZone' } },
      { key: 'buttons', label: 'Buttons', type: 'remap', buttons: [{ value: 'b1', label: 'Button 1', field: 'btn1', code: 4 }, { value: 'b2', label: 'Button 2', field: 'btn2', code: 5 }],
        targets: [{ value: 'left', label: 'Left click' }, { value: 'right', label: 'Right click' }, { value: 'back', label: 'Back' }], write: { message: 'setBtn' } },
    ], ...over,
  });
  const v0 = validate(kinds());
  ok(v0.ok, `a file with display, color, zones and remap is accepted (${v0.problems.join('; ')})`);
  const k = () => kinds();
  const st = (j, key) => j.settings.find((x) => x.key === key);
  refuses('a display with a write', (() => { const j = k(); st(j, 'temp').write = { message: 'setColor' }; return j; })(), /a display: a reading/);
  refuses('a color from a one-byte field', (() => { const j = k(); st(j, 'color').field = 'temp'; return j; })(), /type "bytes" and size 3/);
  refuses('a color sent as a plain byte', (() => { const j = k(); j.messages.setColor.bytes = '31 {value}'; return j; })(), /a color is sent as \{value:rgb\}/);
  refuses('rgb on a slider', mini({ messages: { get: { bytes: '20' }, set: { bytes: '21 {value:rgb}' } } }), /only a color is sent as \{value:rgb\}/);
  refuses('rgb on a field placeholder', (() => { const j = k(); j.messages.setColor.bytes = '31 {value:rgb} {temp:rgb}'; return j; })(), /only \{value:rgb\} can be rgb/);
  refuses('a {zone} in a read', (() => { const j = k(); j.messages.get.bytes = '30 {zone}'; return j; })(), /has \{zone\}, but nothing gives it one/);
  refuses('a zone write without {zone}', (() => { const j = k(); j.messages.setZone.bytes = '32 {value:rgb}'; return j; })(), /has no \{zone\}/);
  refuses('a zone without a code', (() => { const j = k(); delete st(j, 'lights').zones[1].code; return j; })(), /needs a code \(0-255\)/);
  refuses('a zone with an unknown part', (() => { const j = k(); st(j, 'lights').zones[0].bytes = '51 21'; return j; })(), /does not know/);
  refuses('a remap without targets', (() => { const j = k(); delete st(j, 'buttons').targets; return j; })(), /needs targets/);
  refuses('a remap target the button field cannot encode', (() => { const j = k(); st(j, 'buttons').targets.push({ value: 'macro', label: 'Macro' }); return j; })(), /"macro" cannot be sent/);
  refuses('zones on a slider', mini({ settings: [{ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, zones: [{ value: 'a', label: 'A', field: 'brightness', code: 1 }], write: { message: 'set' } }] }), /only a color has zones/);
  refuses('a remap whose {button} codes reach a never pattern', (() => { const j = k(); j.never = [{ bytes: '33 05', why: 'pretend never' }]; return j; })(), /could send 33 05/);

  const drv = fromJson(kinds());
  drv.vendorApp = async () => null;
  const m = { temp: 41, color: [255, 0, 0], logo: [0, 0, 255], wheel: [0, 255, 0], b1: 1, b2: 16, sticky: false };
  const sent = [];
  const listeners = new Set();
  const dev = { vendorId: 0xffff, productId: 0xffe2, opened: true, collections: [],
    addEventListener(t, fn) { listeners.add(fn); }, removeEventListener(t, fn) { listeners.delete(fn); },
    async sendReport(id, bytes) {
      const p = Uint8Array.from(bytes);
      sent.push(h(p.slice(0, 6)));
      if (!m.sticky) {
        if (p[0] === 0x31) m.color = [p[1], p[2], p[3]];
        if (p[0] === 0x32) m[p[1] === 1 ? 'logo' : 'wheel'] = [p[2], p[3], p[4]];
        if (p[0] === 0x33) m[p[1] === 4 ? 'b1' : 'b2'] = p[2];
      }
      const r = new Uint8Array(32);
      r[0] = p[0]; r[1] = m.temp; r.set(m.color, 2); r.set(m.logo, 5); r.set(m.wheel, 8); r[11] = m.b1; r[12] = m.b2;
      setTimeout(() => listeners.forEach((fn) => fn({ reportId: id, data: new DataView(r.buffer) })), 1);
    } };
  plugged = dev;
  ok(await drv.connect(false), 'the pretend device connects');
  const page = drv.settings;
  ok(JSON.stringify(page.map((x) => x.type)) === JSON.stringify(['display', 'color', 'color', 'remap']), `the page gets the kinds (${page.map((x) => x.type)})`);
  ok(JSON.stringify(page[2].zones) === JSON.stringify([{ value: 'logo', label: 'Logo' }, { value: 'wheel', label: 'Wheel' }]) && !('code' in page[3].buttons[0]) && page[0].readOnly === true, 'zones and buttons reach the page without their codes; a display is read only');
  ok(problem(drv) === null, `the driver passes the my-devices check (${problem(drv)})`);
  const coded = (s) => problem({ id: 'x-y', title: 'X', kind: 'Mouse', connect() {}, info() {}, read() {}, write() {}, settings: [s] }) || '';
  ok(/remap needs buttons and targets/.test(coded({ key: 'r', label: 'R', type: 'remap', buttons: [{ value: 'a', label: 'A' }] })) && /zones must be/.test(coded({ key: 'c', label: 'C', type: 'color', zones: [] }))
    && coded({ key: 'd', label: 'D', type: 'display' }) === '', 'the device.mjs check: a remap needs targets, zones need entries, a display needs nothing more');
  const r0 = await drv.read();
  ok(JSON.stringify(r0) === JSON.stringify({ temp: 41, color: '#ff0000', lights: { logo: '#0000ff', wheel: '#00ff00' }, buttons: { b1: 'left', b2: 'back' } }), `read: ${JSON.stringify(r0)}`);
  sent.length = 0;
  ok((await drv.write('color', '#12ab00')) === '#12ab00' && JSON.stringify(m.color) === '[18,171,0]', 'one color written as 31 r g b and read back');
  ok(sent.includes('31 12 ab 00 00 00'), `the color frame (${sent})`);
  sent.length = 0;
  const z = await drv.write('lights', { logo: '#ffffff', wheel: '#00ff00' });
  ok(JSON.stringify(z) === JSON.stringify({ logo: '#ffffff', wheel: '#00ff00' }) && sent.filter((x) => x.startsWith('32')).join() === '32 01 ff ff ff 00', `only the zone that changed is sent (${sent})`);
  sent.length = 0;
  const b = await drv.write('buttons', { b1: 'right' });
  ok(JSON.stringify(b) === JSON.stringify({ b1: 'right', b2: 'back' }) && sent.filter((x) => x.startsWith('33')).join() === '33 04 02 00 00 00', `a remap sends the button code and the action code (${sent})`);
  sent.length = 0;
  await refusesWrite(drv, 'temp', 50);
  await refusesWrite(drv, 'color', 'red');
  await refusesWrite(drv, 'color', '#FF0000');
  await refusesWrite(drv, 'lights', { logo: '#ffffff' });
  await refusesWrite(drv, 'buttons', { b1: 'macro' });
  await refusesWrite(drv, 'buttons', { b3: 'left' });
  ok(!sent.some((x) => /^3[123]/.test(x)), `refused writes send nothing (${sent})`);
  m.sticky = true; sent.length = 0;
  try { await drv.write('lights', { logo: '#000000', wheel: '#00ff00' }); ok(false, 'a zone that did not stick was believed'); } catch (e) { ok(/written back/.test(e.message), `a zone that does not stick fails: ${e.message.slice(0, 80)}`); }
  ok(sent.filter((x) => x.startsWith('32')).length === 2, `the zone is sent, then the value read before (${sent})`);
  m.sticky = false;
  // the library self-check: each kind written with its own value and read back; the display is never written
  sent.length = 0;
  const vc = await selfCheck(drv, drv.write, { backup: async () => true });
  ok(vc.ran && vc.keys.color?.ok && vc.keys.lights?.ok && vc.keys.buttons?.ok && !('temp' in vc.keys), `self-check: color, zones and remap pass, the display is left out (${JSON.stringify(vc.keys)})`);
  ok(sent.filter((x) => x.startsWith('32')).length === 2 && sent.filter((x) => x.startsWith('33')).length === 2 && sent.filter((x) => x.startsWith('31')).length === 1, `the same-value write sends every zone and button once (${sent.filter((x) => !x.startsWith('30'))})`);
  ok(JSON.stringify(await drv.read()) === JSON.stringify({ temp: 41, color: '#12ab00', lights: { logo: '#ffffff', wheel: '#00ff00' }, buttons: { b1: 'right', b2: 'back' } }), 'the self-check left everything as it was');
}

// ---- 5. notices and byPid (22 Oct 2026, docs/handoff/learn-readings.md), on pretend devices ----
{
  // a file that only listens: no messages, no replies; a display and the battery from a report the device sends itself
  const listen = () => mini({ id: 'pretend-dial', pids: ['FFE2'], models: [{ name: 'Pretend', pids: { usb: ['FFE2'] } }], transport: { report: 'output', len: 16, reportId: 0 },
    replies: undefined, messages: undefined, reads: [{ name: 'dial', notice: { starts: '45', len: 16 } }],
    fields: { mix: { from: 'dial', offset: 1, map: { 1: 'game', 2: 'chat' } }, level: { from: 'dial', offset: 2 } },
    settings: [{ key: 'mix', label: 'ChatMix', type: 'display' }], battery: { from: 'dial', percent: 'level' } });
  const lf = JSON.parse(JSON.stringify(listen()));
  ok(validate(lf).ok, `a file that only listens (no messages, no replies) is accepted (${validate(lf).problems.join('; ')})`);
  const drv = fromJson(lf);
  drv.vendorApp = async () => null;
  ok(drv.hid.reply === 'raw', `its channel listens raw (${JSON.stringify(drv.hid)})`);
  const listeners = new Set(), sent = [];
  const dev = { vendorId: 0xffff, productId: 0xffe2, opened: true, collections: [], async open() {},
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, d) { sent.push(h(d)); }, async sendFeatureReport() { sent.push('feature'); } };
  const emit = (b) => { const u = new Uint8Array(16); u.set(b); listeners.forEach((f) => f({ reportId: 0, data: new DataView(u.buffer) })); };
  plugged = dev;
  ok(await drv.connect(false), 'it connects');
  ok(JSON.stringify(await drv.read()) === '{}' && (await drv.battery()) === null, 'before the device sends anything, nothing is known (and nothing fails)');
  emit([0x46, 9, 9]); emit([0x45, 2, 64]);
  drv.snap = null;
  ok((await drv.read()).mix === 'chat' && (await drv.battery())?.percent === 64, 'the report starting 45 is heard: ChatMix chat, battery 64%; the one starting 46 is not');
  ok(sent.length === 0, `a file that only listens never sends a byte (${sent})`);
  // the hid-host raw channel: reports waiting are read once per snapshot
  const d2 = fromJson(lf); d2.vendorApp = async () => null;
  const queue = [[0x45, 1, 33]];
  const dev2 = { ...dev, receiveReports: async () => queue.splice(0).map((b) => { const u = new Uint8Array(16); u.set(b); return { reportId: 0, data: new DataView(u.buffer) }; }) };
  plugged = dev2;
  await d2.connect(false);
  ok((await d2.read()).mix === 'game' && (await d2.battery())?.percent === 33, 'on the raw channel the waiting reports are read');

  const withNotice = (over) => mini({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '45' } }], fields: { brightness: { from: 'state', offset: 1 }, mix: { from: 'dial', offset: 1 } }, ...over });
  ok(validate(withNotice({ settings: [{ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, write: { message: 'set' } }, { key: 'mix', label: 'Mix', type: 'display' }] })).ok, 'asked reads and a notice in one file are accepted');
  refuses('a written setting read from a notice', withNotice({ settings: [{ key: 'mix', label: 'Mix', type: 'slider', min: 0, max: 100, write: { message: 'set' } }] }), /comes from a notice/);
  refuses('a notice that starts like a request', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '20' } }] }), /could be taken for the notice/);
  refuses('a notice that starts like a write with a value there', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '21 05' } }] }), /could be taken for the notice/);
  refuses('a notice with a channel that does not listen raw', withNotice({ hid: { vid: 'FFFF', pid: 'FFE0' } }), /hid\.reply "raw"/);
  refuses('a read with both a message and a notice', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', message: 'get', notice: { starts: '45' } }] }), /both "message" and "notice"/);
  refuses('a notice read on demand', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '45' }, onDemand: true }] }), /cannot have "onDemand"/);
  refuses('a notice with a placeholder', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '45 {value}' } }] }), /cannot hold placeholders/);
  refuses('a battery wake-up question from a notice', withNotice({ battery: { from: 'dial', percent: 'mix', awake: true } }), /battery\.awake/);
  refuses('a read with neither', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial' }] }), /needs a message .* or a notice/);
  refuses('a field outside its notice', withNotice({ reads: [{ name: 'state', message: 'get' }, { name: 'dial', notice: { starts: '45', len: 1 } }] }), /fit in the 1-byte reply/);

  // byPid: one id's own bytes, checked in full on that id
  const two = (over = {}) => mini({ pids: ['FFE0', 'FFE5'], links: { usb: { label: 'USB' }, rx: { label: 'Receiver', wireless: true } }, models: [{ name: 'Pretend', pids: { usb: ['FFE0'], rx: ['FFE5'] } }], ...over });
  const bp = two({ byPid: { FFE5: { messages: { get: { bytes: '30' }, set: { bytes: '31 {value}' } }, fields: { brightness: { from: 'state', offset: 2 } } } } });
  ok(validate(bp).ok, `byPid with that id's own messages and fields is accepted (${validate(bp).problems.join('; ')})`);
  const bd = fromJson(bp);
  const b0 = h(bd.build('get').data.slice(0, 1));
  bd.usePid('FFE5');
  ok(b0 === '20' && h(bd.build('get').data.slice(0, 1)) === '30' && h(bd.build('set', { value: 7 }).data.slice(0, 2)) === '31 07', 'each id builds its own bytes');
  refuses('byPid for an id the file does not have', two({ byPid: { FFE9: { messages: { get: { bytes: '30' } } } } }), /not one of "pids"/);
  refuses('byPid adding a message', two({ byPid: { FFE5: { messages: { boot: { bytes: '30' } } } } }), /byPid only changes what is there/);
  refuses('byPid with a part it does not know', two({ byPid: { FFE5: { settings: [] } } }), /does not know/);
  refuses('byPid breaking the file on that id', two({ byPid: { FFE5: { messages: { set: { bytes: '31' } } } } }), /on product id FFE5: .*has no \{value\}/);
  refuses('byPid bytes on a never list', two({ transport: { report: 'output', len: 32, reportId: 0, usagePage: 'FF60' }, byPid: { FFE5: { messages: { get: { bytes: '0B' } } } } }), /on product id FFE5: .*VIA bootloader jump/);
  // connect on the second id: its own bytes go out
  const sent2 = [];
  const listeners2 = new Set();
  const dev3 = { vendorId: 0xffff, productId: 0xffe5, opened: true, collections: [], async open() {},
    addEventListener(t, f) { listeners2.add(f); }, removeEventListener(t, f) { listeners2.delete(f); },
    async sendReport(id, d) { sent2.push(h(d.slice(0, 2))); const r = new Uint8Array(32); r[0] = d[0]; r[2] = 55; setTimeout(() => listeners2.forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1); } };
  const bc = fromJson(bp); bc.vendorApp = async () => null;
  plugged = dev3;
  ok(await bc.connect(false) && (await bc.read()).brightness === 55 && sent2.every((x) => x.startsWith('30')), `on FFE5 it reads with 30 and finds the value where that id keeps it (${sent2})`);
  plugged = null;
}

console.log(fails ? `declarative-driver: ${fails} FAILED` : 'declarative-driver (driver.json: ASUS ROG mouse byte-for-byte as its device.mjs, the safety check refusing bad files): all good');
process.exitCode = fails ? 1 : 0;
