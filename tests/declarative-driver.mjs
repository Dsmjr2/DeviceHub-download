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

console.log(fails ? `declarative-driver: ${fails} FAILED` : 'declarative-driver (driver.json: ASUS ROG mouse byte-for-byte as its device.mjs, the safety check refusing bad files): all good');
process.exitCode = fails ? 1 : 0;
