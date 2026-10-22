// The ASUS ROG mouse library driver (device-library/asus-rog-mouse) against a simulated mouse that answers exactly as
// docs/brands/asus-rog.md documents: 64-byte output reports, replies echoing verb + subcommand, FF AA when asleep or for
// a command it does not take; on its cable (report 00) and behind the ROG Omni receiver 1ACE (pair list on report 01,
// the mouse on report 03). Checks every request's bytes, read / write / read back / save, and that nothing outside the
// sheet's commands is ever sent. Run: node tests/sim-asus.mjs (no hardware)
import { setDeviceProvider } from '../public/devices/hid.js';

const { default: mouse, MODELS } = await import('../device-library/asus-rog-mouse/device.mjs');
mouse.vendorApp = async () => null;   // no tasklist in the test

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const pad = (bytes) => { const o = new Uint8Array(64); o.set(bytes); return h(o); };

// ---- the simulated mouse ----
function simMouse({ battery = true } = {}) {
  return { battery, pct: 77, charging: 0, sleep: 0x03, low: 20, dpi: [800, 1600, 3200, 0], colors: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255],
    poll: 0x03, debounce: 0x02, snap: 0, lift: 0x00, profile: 0, stages: 3, noProfileRead: false, asleep: false, sticky: new Set(), saves: 0 };
}
const ALLOWED = /^(12 07|12 04 00|12 04 03|12 06|12 00|51 31 0a 00|50 02|51 31 0[0-3] 00|51 31 04 00|51 31 06 00|51 37 00 00|51 35 ff 00 ff|50 03|a0 00 00|7d 20 02)/;

function simDevice({ pid, m, omni = null }) {
  const listeners = new Set();
  const dev = {
    vendorId: 0x0b05, productId: pid, productName: 'simulated ROG', opened: false, sent: [], bad: [],
    collections: omni ? [{ usagePage: 0xff00, usage: 1, outputReports: [{ reportId: 1 }, { reportId: 2 }, { reportId: 3 }] }] : [{ usagePage: 0xff01, usage: 1, outputReports: [] }],
    async open() { this.opened = true; },
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push({ id, hex: h(p) });
      if (p.length !== 64) this.bad.push(`length ${p.length}`);
      if (!ALLOWED.test(h(p))) this.bad.push(`not a sheet command: ${h(p.slice(0, 8))}`);
      const expectId = omni ? (p[0] === 0xa0 ? 1 : 3) : 0;
      if (id !== expectId) this.bad.push(`report ${id} for ${h(p.slice(0, 3))} (wanted ${expectId})`);
      const r = reply(p, id);
      if (r) setTimeout(() => listeners.forEach((f) => f({ reportId: id, data: new DataView(r.buffer) })), 1);
    },
  };
  // replies without the report id: sheet byte n = r[n - 1]
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
    if (cmd.startsWith('12 00')) { if (m.noProfileRead) return err(); r[10] = m.profile; r[18] = m.stages; return r; }   // sheet: Profile byte 11, stage count byte 19
    if (p[0] === 0x50 && p[1] === 0x02) { if (p[2] > 4) return err(); m.profile = p[2]; return r; }                       // sheet: 50 02 <p>, 0-based
    if (p[0] === 0x51 && p[1] === 0x31 && p[3] === 0x00) {
      if (p[2] <= 3) { if (!m.sticky.has('dpi')) m.dpi[p[2]] = (p[4] | (p[5] << 8)) * 50 + 50; if (p[6] | p[7] | p[8]) m.colors.splice(3 * p[2], 3, p[6], p[7], p[8]); return r; }
      if (p[2] === 4) { if (p[4] > 6) return err(); if (!m.sticky.has('poll')) m.poll = p[4]; return r; }
      if (p[2] === 6) { if (!m.sticky.has('snap')) m.snap = p[4]; return r; }
      if (p[2] === 0x0a) { if (p[4] < 2 || p[4] > 4) return err(); m.stages = p[4]; return r; }
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
const plug = async (d) => { plugged = d; return mouse.connect(false); };
const sets = (d) => d.sent.filter((s) => s.hex.startsWith('51'));
const refused = async (key, value, why, d) => {
  const n = d.sent.filter((s) => !s.hex.startsWith('12')).length;
  try { await mouse.write(key, value); ok(false, `${why}: was accepted`); } catch { ok(d.sent.filter((s) => !s.hex.startsWith('12')).length === n, `${why}: refused but something was sent`); }
};
// a test write: change, read back, put the value read before back
const roundTrip = async (key, to, d, m) => {
  const was = (await mouse.read())[key], saves = m.saves;
  ok((await mouse.write(key, to)) === to && (await mouse.read())[key] === to, `${key} -> ${to} reads back`);
  ok(d.sent.at(-1).hex === pad([0x50, 0x03]) && m.saves === saves + 1, `${key}: saved with 50 03 after the read-back`);
  ok((await mouse.write(key, was)) === was, `${key} put back to ${was}`);
};

// ---- 1. Harpe Ace Aim Lab on its cable ----
{
  const m = simMouse(), d = simDevice({ pid: 0x1a92, m });
  ok(await plug(d), 'Harpe Ace cable connects');
  const info = await mouse.info();
  ok(info.Model === 'ROG Harpe Ace Aim Lab Edition' && info.Connection === 'USB cable', `model and link: ${info.Model}, ${info.Connection}`);
  ok(/code 2: G-Helper reads 12 ms, libratbag 12 ms/.test(info['Button response']), `button response shown read only: ${info['Button response']}`);
  const v = await mouse.read();
  ok(v.dpi1 === 800 && v.dpi2 === 1600 && v.dpi3 === 3200 && v.dpi4 === undefined, `DPI stages read: ${v.dpi1}/${v.dpi2}/${v.dpi3}`);
  ok(v.pollingRate === 1000 && v.angleSnap === false && v.liftOff === 'low' && v.sleep === 5, `polling ${v.pollingRate}, snap ${v.angleSnap}, lift ${v.liftOff}, sleep ${v.sleep}`);
  ok(!('debounce' in v) && !mouse.settings.some((s) => s.key === 'debounce'), 'button response is not a setting');
  const b = await mouse.battery();
  ok(b.percent === 77 && b.charging === false, `battery ${b.percent}%, charging ${b.charging}`);
  ok(d.sent.slice(0, 3).map((s) => s.hex).join('|') === [pad([0x12, 0x07]), pad([0x12, 0x04, 0x00]), pad([0x12, 0x06])].join('|'), 'reads are 12 07, 12 04 00, 12 06 padded to 64');

  d.sent.length = 0;
  ok((await mouse.write('dpi2', 2400)) === 2400 && m.dpi[1] === 2400, 'DPI stage 2 -> 2400 lands');
  ok(sets(d)[0].hex === pad([0x51, 0x31, 0x01, 0x00, 0x2f, 0x00, 0x00, 0xff, 0x00]), `DPI write bytes: 51 31 01 00 2f 00 + the stage's color read back (${sets(d)[0].hex.slice(0, 26)})`);
  ok(d.sent.at(-1).hex === pad([0x50, 0x03]), 'saved after the read-back');
  await mouse.write('dpi2', 1600);
  d.sent.length = 0;
  await roundTrip('pollingRate', 500, d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x31, 0x04, 0x00, 0x02]), 'polling 500 Hz goes out as 51 31 04 00 02');
  d.sent.length = 0;
  await roundTrip('angleSnap', true, d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x31, 0x06, 0x00, 0x01]), 'angle snapping on goes out as 51 31 06 00 01');
  d.sent.length = 0;
  await roundTrip('liftOff', 'high', d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x35, 0xff, 0x00, 0xff, 0x01]), 'lift-off high goes out as 51 35 ff 00 ff 01');
  d.sent.length = 0;
  await roundTrip('sleep', 10, d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x37, 0x00, 0x00, 0x04, 0x00, 20]) && m.low === 20, 'sleep 10 min goes out as 51 37 00 00 04 00 <low-battery 20, kept>');
  d.sent.length = 0;
  ok(v.onboardProfile === 1 && v.stageCount === 3, `profile and stage count read from 12 00: ${v.onboardProfile}, ${v.stageCount}`);
  await roundTrip('stageCount', 4, d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x31, 0x0a, 0x00, 0x04]) && m.stages === 3, 'stage count 4 goes out as 51 31 0a 00 04, and 3 was put back');
  // profile select: 50 02 <p> 0-based, read back, no save after it, put back
  d.sent.length = 0;
  {
    const saves = m.saves;
    ok((await mouse.write('onboardProfile', 3)) === 3 && m.profile === 2 && (await mouse.read()).onboardProfile === 3, 'profile 3 selected and reads back');
    ok(d.sent.some((s) => s.hex === pad([0x50, 0x02, 0x02])) && m.saves === saves && !d.sent.some((s) => s.hex.startsWith('50 03')), 'profile 3 goes out as 50 02 02, with no save after it');
    ok((await mouse.write('onboardProfile', 1)) === 1 && m.profile === 0, 'profile 1 put back');
  }
  ok(m.sleep === 0x03 && m.dpi[1] === 1600 && m.poll === 3 && m.snap === 0 && m.lift === 0 && m.stages === 3 && m.profile === 0, 'every test write was put back');
  await refused('stageCount', 5, 'five DPI stages', d);
  await refused('stageCount', 1, 'one DPI stage', d);
  await refused('onboardProfile', 6, 'profile 6', d);
  await refused('onboardProfile', 0, 'profile 0', d);

  await refused('pollingRate', 8000, '8000 Hz on a model without it', d);
  await refused('pollingRate', 300, '300 Hz', d);
  await refused('dpi1', 37000, 'DPI above the model\'s maximum', d);
  await refused('dpi1', 825, 'DPI off the 50 step', d);
  await refused('dpi5', 800, 'a fifth stage', d);
  await refused('debounce', 1, 'button response', d);
  await refused('sleep', 4, 'sleep 4 min', d);
  await refused('angleSnap', 1, 'angle snapping as a number', d);
  await refused('__proto__', 1, 'key __proto__', d);

  // a write the mouse does not keep: old value written back, no save
  m.sticky.add('snap'); d.sent.length = 0;
  const saves = m.saves;
  try { await mouse.write('angleSnap', true); ok(false, 'a write that did not stick was accepted'); } catch (e) { ok(/written back, nothing saved/.test(e.message), `a write that did not stick: ${e.message}`); }
  ok(m.saves === saves && sets(d).length === 2 && sets(d)[1].hex === pad([0x51, 0x31, 0x06, 0x00, 0x00]), 'its old value was sent back and nothing was saved');
  m.sticky.clear();

  // Armoury Crate running: reads go on (driver safety, 22 Oct 2026), no write at all, not even of the same value
  mouse.vendorApp = async () => 'ArmouryCrate.UserSessionHelper.exe'; mouse.appAt = 0;
  mouse.snap = null;
  ok((await mouse.read()).pollingRate === 1000 && (await mouse.info()).Model === 'ROG Harpe Ace Aim Lab Edition', 'reads go on while Armoury Crate runs');
  await refused('pollingRate', 1000, 'a same-value write while Armoury Crate runs', d);
  await refused('pollingRate', 500, 'a write while Armoury Crate runs', d);
  await refused('stageCount', 4, 'a stage count while Armoury Crate runs', d);
  await refused('onboardProfile', 2, 'a profile select while Armoury Crate runs', d);
  mouse.vendorApp = async () => null; mouse.appAt = 0;

  // driver safety (22 Oct 2026): the library self-check really sends each value it read (nothing skipped as unchanged)
  // and every raw byte ends as it was
  {
    const { selfCheck } = await import('../helpers/my-devices.mjs');
    const before = JSON.stringify(m); d.sent.length = 0;
    const r = await selfCheck(mouse, mouse.write, { backup: async () => true, makerApp: async () => null });
    const want = ['dpi1', 'dpi2', 'dpi3', 'pollingRate', 'angleSnap', 'liftOff', 'sleep', 'stageCount', 'onboardProfile'];
    ok(want.every((k) => r.keys?.[k]?.ok), `self-check passes ${want.join(', ')} (${JSON.stringify(r.keys)})`);
    ok(JSON.stringify({ ...m, saves: 0 }) === JSON.stringify({ ...JSON.parse(before), saves: 0 }), 'the self-check left every raw value as it was');
    for (const hexStart of ['51 31 00 00', '51 31 04 00 03', '51 31 06 00 00', '51 35 ff 00 ff 00', '51 37 00 00 03', '51 31 0a 00 03', '50 02 00']) ok(d.sent.some((x) => x.hex.startsWith(hexStart)), `the self-check really sent ${hexStart}`);
    // an angle-snapping byte that is neither 0 nor 1 is not reported, so it is never written back as one
    m.snap = 2; mouse.snap = null; d.sent.length = 0;
    ok(!('angleSnap' in (await mouse.read())), 'raw angle snapping 2 is not reported as on or off');
    const r2 = await selfCheck(mouse, mouse.write, { only: ['angleSnap'], previous: r, backup: async () => true, makerApp: async () => null });
    ok(!r2.keys?.angleSnap?.ok && m.snap === 2 && !d.sent.some((x) => x.hex.startsWith('51 31 06')), `raw 2 is never written back (${JSON.stringify(r2.keys?.angleSnap)})`);
    m.snap = 0; mouse.snap = null;
  }
  ok(!d.bad.length, `cable: only sheet commands, 64 bytes, report 00 (${d.bad.join('; ')})`);
}

// ---- 2. Harpe Ace behind the Omni receiver, a keyboard paired too ----
{
  const m = simMouse(), omni = { paired: [0x1a85, 0x1a94], booster: false }, d = simDevice({ pid: 0x1ace, m, omni });
  ok(await plug(d), 'Omni receiver connects');
  ok(d.sent[0].id === 1 && d.sent[0].hex === pad([0xa0, 0x00, 0x00]) && d.sent[1].id === 3 && d.sent[1].hex === pad([0x7d, 0x20, 0x02]), 'pair list A0 00 00 on report 01, booster probe 7D 20 02 on report 03');
  const info = await mouse.info();
  ok(info.Model === 'ROG Harpe Ace Aim Lab Edition' && /Omni/.test(info.Connection) && /1A94/.test(info['Product id']) && /off/.test(info['8K booster']), `found behind Omni: ${info.Model}, ${info['Product id']}, booster ${info['8K booster']}`);
  d.sent.length = 0;
  await roundTrip('dpi1', 1200, d, m);
  ok(d.sent.every((s) => s.id === 3), 'every mouse request went out on report 03');
  await roundTrip('pollingRate', 250, d, m);
  await refused('pollingRate', 8000, '8000 Hz through Omni (booster not documented)', d);

  // asleep: FF AA to everything
  m.asleep = true; d.sent.length = 0;
  try { await mouse.info(); ok(false, 'an asleep mouse read'); } catch (e) { ok(/asleep/.test(e.message), `asleep read: ${e.message}`); }
  ok((await mouse.awake()) === false, 'awake() says no while it answers FF AA');
  try { await mouse.write('angleSnap', true); ok(false, 'an asleep mouse took a write'); } catch (e) { ok(/asleep/.test(e.message), `asleep write: ${e.message}`); }
  ok(!sets(d).length && m.snap === 0, 'nothing was written while it was asleep');
  m.asleep = false;
  ok((await mouse.awake()) === true && (await mouse.read()).dpi1 === 800, 'it reads again once awake');
  ok(!d.bad.length, `Omni: only sheet commands on the right reports (${d.bad.join('; ')})`);
}

// ---- 3. Keris Wireless AimPoint through Omni with the booster on ----
{
  const m = simMouse(), d = simDevice({ pid: 0x1ace, m, omni: { paired: [0x1a6a], booster: true } });
  ok(await plug(d), 'Keris AimPoint through Omni connects');
  const info = await mouse.info();
  ok(info.Model === 'ROG Keris Wireless AimPoint' && /^on/.test(info['8K booster']) && /read only/.test(info['Polling code']), `booster on: ${info['8K booster']}; ${info['Polling code']}`);
  ok(!mouse.settings.some((s) => s.key === 'pollingRate') && !('pollingRate' in (await mouse.read())), 'polling is not a setting while the booster is on');
  await refused('pollingRate', 1000, 'polling while the booster is on', d);
  ok(!d.bad.length, `booster: only sheet commands (${d.bad.join('; ')})`);
}

// ---- 4. Omni receiver with nothing this driver knows paired ----
{
  const d = simDevice({ pid: 0x1ace, m: simMouse(), omni: { paired: [0x1a85], booster: false } });
  try { await plug(d); ok(false, 'an unknown pair list connected'); } catch (e) { ok(/paired ids: 1a85/.test(e.message), `unknown pairing: ${e.message}`); }
  ok(d.sent.length === 1, 'only the pair list was asked');
}

// ---- 5. Chakram X: 8000 Hz on its cable only; DPI read only ----
{
  const m = simMouse(), d = simDevice({ pid: 0x1a18, m });
  ok(await plug(d), 'Chakram X cable connects');
  const info = await mouse.info();
  ok(/1600 \/ 3200 \/ 6400 \(read only/.test(info['DPI stages']), `Chakram X DPI shown doubled, read only: ${info['DPI stages']}`);
  ok(!mouse.settings.some((s) => /^dpi/.test(s.key)), 'Chakram X has no DPI setting');
  await refused('dpi1', 800, 'Chakram X DPI write', d);
  d.sent.length = 0;
  await roundTrip('pollingRate', 8000, d, m);
  ok(sets(d)[0].hex === pad([0x51, 0x31, 0x04, 0x00, 0x06]), '8000 Hz goes out as 51 31 04 00 06');
  const d2 = simDevice({ pid: 0x1a1a, m: simMouse() });
  ok(await plug(d2), 'Chakram X on its own receiver connects');
  await mouse.info();
  await refused('pollingRate', 8000, '8000 Hz on the Chakram X receiver', d2);
  ok(!d.bad.length && !d2.bad.length, 'Chakram X: only sheet commands');
}

// ---- 6. Gladius III (cable only, no battery) ----
{
  const m = simMouse({ battery: false }), d = simDevice({ pid: 0x197b, m });
  ok(await plug(d), 'Gladius III connects');
  const info = await mouse.info(), v = await mouse.read();
  ok(info.Model === 'ROG Gladius III' && (await mouse.battery()) === null && !('sleep' in v) && !mouse.settings.some((s) => s.key === 'sleep'), 'no battery, no sleep setting');
  ok(!d.sent.some((s) => s.hex.startsWith('12 07')), 'the battery read is not even asked');
  // a mouse that answers FF AA to 12 00: no profile or stage count, and writing them sends nothing
  m.noProfileRead = true; mouse.snap = null;
  const v2 = await mouse.read();
  ok(!('onboardProfile' in v2) && !('stageCount' in v2) && v2.dpi1 === 800, 'FF AA to 12 00: profile and stage count are not reported, the rest still reads');
  await refused('onboardProfile', 2, 'a profile select on a mouse that does not report it', d);
  await refused('stageCount', 4, 'a stage count on a mouse that does not report it', d);
  m.noProfileRead = false;
  await refused('dpi1', 20000, 'DPI above the Gladius III\'s 19000', d);
  await roundTrip('dpi1', 19000, d, m);
  ok(!d.bad.length, 'Gladius III: only sheet commands');
}

// ---- 7. the model table matches the sheet's section 1 ids ----
{
  const ids = Object.fromEntries(MODELS.map((x) => [x.key, [x.cable, x.dongle, ...(x.omni || [])].filter(Boolean).map((n) => n.toString(16)).join(',')]));
  ok(ids['harpe-ace-aim-lab'] === '1a92,1a94,1a94' && ids['keris-wireless-aimpoint'] === '1a66,1a68,1a68,1a6a' && ids['gladius-iii'] === '197b'
    && ids['gladius-iii-wireless'] === '197d,197f' && ids['gladius-iii-wireless-aimpoint'] === '1a70,1a72,1a72' && ids['chakram-x'] === '1a18,1a1a', `model ids: ${JSON.stringify(ids)}`);
}

console.log(fails ? `sim-asus: ${fails} FAILED` : 'sim-asus (ROG mice, simulated on cable and Omni): all good');
process.exitCode = fails ? 1 : 0;
