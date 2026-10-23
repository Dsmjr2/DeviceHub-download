// The SteelSeries Apex library driver (device-library/steelseries-apex/device.mjs) against simulated keyboards only:
// nothing is opened, nothing reaches hardware. Each simulated keyboard answers as OpenRGB @ bbc77470 describes (typed
// out here by hand): output report 00 A3 -> input report A3 00 <0-10> (the Apex controller; 0xFF in the status byte when
// unsupported) or A3 <0-16> (the Apex 3 TKL's 8-zone controller); 00 23 <b> sets it with no reply; 00 90 -> the firmware
// text (Gen 2+ first byte 0x90). Anything else it is sent is flagged.
// Covers: write, read back, exact raw restore, an unchanged write still sent, out of range refused, reads while
// SteelSeries GG runs and writes refused, a keyboard that does not take the write, the never list, device.json, ids.
// Run: node tests/sim-steelseries-apex.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApex, MODELS, PIDS, firmwareText } from '../device-library/steelseries-apex/device.mjs';
import { problem, fits, selfCheck, hidSpecs } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import { neverHit } from '../helpers/never-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
let checks = 0;
const check = (ok, what) => { checks++; if (!ok) fails.push(what); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
process.on('uncaughtException', (e) => { console.log(`sim-steelseries-apex: FAILED: ${e.stack || e.message}`); process.exit(1); });

function simKeyboard(pid, o = {}) {
  const type = MODELS[pid].type;
  const sim = { pid, type, sent: [], bad: [], bright: 7, unsupported: false, ignoreWrites: false, gen1: false, fw: '1.19.7', listeners: new Set(), ...o };
  const reply = (bytes) => { const r = new Uint8Array(64); r.set(bytes); setTimeout(() => { for (const fn of [...sim.listeners]) fn({ reportId: 0, data: new DataView(r.buffer) }); }, 0); };
  sim.dev = {
    opened: true,
    addEventListener(t, fn) { if (t === 'inputreport') sim.listeners.add(fn); },
    removeEventListener(t, fn) { sim.listeners.delete(fn); },
    async sendReport(id, data) {
      const q = Uint8Array.from(data);
      sim.sent.push(q);
      if (type === 'tzone') { sim.bad.push(`sent ${hex(q.slice(0, 4))} to the Apex 3 (OpenRGB reads nothing from it)`); return; }
      if (id !== 0 || q.length !== 64) sim.bad.push(`report ${id}, ${q.length} bytes`);
      if (q.slice(3).some((b) => b !== 0) && q[0] !== 0x23) sim.bad.push(`padding not zero: ${hex(q.slice(0, 8))}`);
      const max = type === 'apex' ? 10 : 0x10;
      if (q[0] === 0xa3) {
        if (type === 'apex') reply(sim.unsupported ? [0xa3, 0xff] : [0xa3, 0x00, sim.bright]);
        else reply([0xa3, sim.bright]);
      } else if (q[0] === 0x23) {
        if (q.slice(2).some((b) => b !== 0)) sim.bad.push(`set with extra bytes ${hex(q.slice(0, 8))}`);
        if (q[1] > max) sim.bad.push(`brightness ${q[1]} over ${max}`); else if (!sim.ignoreWrites) sim.bright = q[1];
      } else if (q[0] === 0x90 && type === 'apex') {
        const text = [...sim.fw].map((c) => c.charCodeAt(0));
        reply(sim.gen1 ? text : [0x90, ...text]);
      } else sim.bad.push(`sent ${hex(q.slice(0, 4))}`);
    },
  };
  return sim;
}
function driverOn(pid, o) {
  const sim = simKeyboard(pid, o);
  sim.app = null; sim.clock = 1;
  const d = createApex({ replyMs: 20, open: async (p) => (p === pid ? sim.dev : null), vendorApp: async () => sim.app, now: () => sim.clock });
  return { d, sim };
}
const all = [];
const sets = (sim) => sim.sent.filter((q) => q[0] === 0x23);

// ---- 1. Apex Pro (Gen 1 ids, the Apex controller): 0-10 ----
{
  const { d, sim } = driverOn('1610');
  all.push(sim);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  check(await d.connect(), 'Apex Pro connects');
  const v = await d.read();
  check(v.brightness === 7 && d.settings.length === 1 && d.settings[0].max === 10 && d.settings[0].min === 0, `read ${JSON.stringify(v)}, settings ${JSON.stringify(d.settings)}`);
  check(sim.sent.some((q) => hex(q.slice(0, 2)) === 'a3 00'), 'brightness read = 00 A3 (ReadBrightness)');
  check(fits(d.settings[0], v.brightness), 'the value read fits its setting');
  let n = sets(sim).length;
  check((await d.write('brightness', 7)) === 7 && sets(sim).length === n + 1 && hex(sets(sim).at(-1).slice(0, 3)) === '23 07 00', 'an unchanged write is still sent: 00 23 07');
  check((await d.write('brightness', 3)) === 3 && sim.bright === 3, 'brightness 3 written and read back');
  for (const bad of [11, -1, 3.5, '5']) { const e = await refusal(() => d.write('brightness', bad)); check(/0-10/.test(e?.message || '') && sim.bright === 3, `brightness ${bad} refused (${e?.message})`); }
  check((await d.write('brightness', 7)) === 7 && sim.bright === 7, 'put back exactly');
  const e = await refusal(() => d.write('profile', 1));
  check(/not a setting/.test(e?.message || ''), 'profile select is not offered (write-only)');
  const info = await d.info();
  check(info.Firmware === '1.19.7' && info.Model === 'SteelSeries Apex Pro' && info.Connection === 'USB cable', `info: ${JSON.stringify(info)}`);
  check(sim.sent.some((q) => q[0] === 0x90), 'firmware asked with 00 90');
  // the self-check writes the value it read and leaves it so
  n = sets(sim).length;
  const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  check(r.keys?.brightness?.ok === true && sets(sim).length === n + 1 && sets(sim).at(-1)[1] === 7 && sim.bright === 7, `the self-check sent brightness 7 and read it back (${JSON.stringify(r.keys)})`);
  // SteelSeries GG running: reads go on, every write refused, nothing sent
  sim.app = 'SteelSeriesGG.exe'; sim.clock += 20000;
  check((await d.read()).brightness === 7, 'reads go on while SteelSeries GG runs');
  n = sets(sim).length;
  for (const val of [7, 2]) { const x = await refusal(() => d.write('brightness', val)); check(/SteelSeriesGG\.exe is running/.test(x?.message || '') && x.waiting === true, `brightness ${val} refused while GG runs (${x?.message})`); }
  const r2 = await selfCheck(d, d.write, { backup: async () => true });
  check(r2.ran === false && r2.waiting === true && sets(sim).length === n, 'nothing written while GG runs, the self-check waits');
  sim.app = null; sim.clock += 20000;
  check((await d.write('brightness', 7)) === 7, 'after GG closed: written');
  // a keyboard that does not take the write: the value read before goes back once, and the write fails
  sim.ignoreWrites = true;
  n = sets(sim).length;
  const x = await refusal(() => d.write('brightness', 2));
  sim.ignoreWrites = false;
  check(/read back 7; 7 was written back/.test(x?.message || '') && sets(sim).length === n + 2 && sets(sim).at(-1)[1] === 7, `a write that does not read back fails and the value read before is sent back (${x?.message})`);
}

// ---- 2. Apex 3 TKL (8-zone controller): A3 <b>, 0-16, no firmware read ----
{
  const { d, sim } = driverOn('1622', { bright: 0x10 });
  all.push(sim);
  await d.connect();
  check((await d.read()).brightness === 16 && d.settings[0].max === 16, 'Apex 3 TKL: brightness 16 read from A3 <b>, range 0-16');
  check((await d.write('brightness', 9)) === 9 && sim.bright === 9 && (await d.write('brightness', 16)) === 16, 'Apex 3 TKL: written, read back, put back');
  const e = await refusal(() => d.write('brightness', 17));
  check(/0-16/.test(e?.message || ''), 'Apex 3 TKL 17 refused');
  const info = await d.info();
  check(info.Firmware === undefined && !sim.sent.some((q) => q[0] === 0x90), 'no firmware request on the 8-zone board (OpenRGB: "Unsupported protocol")');
  await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  check(sim.bright === 16, 'the self-check left it at 16');
}

// ---- 2b. Apex 3 (161A, T-zone controller): named only, nothing sent ----
{
  const { d, sim } = driverOn('161A');
  all.push(sim);
  check(await d.connect() === true && d.model.name === 'Apex 3', 'Apex 3 (161A) connects');
  check(d.settings.length === 0 && JSON.stringify(await d.read()) === '{}', 'Apex 3: no settings, nothing read');
  const info = await d.info();
  check(info.Model === 'SteelSeries Apex 3' && info.Firmware === undefined && /names this keyboard only/.test(info.Driver), `Apex 3 info (${JSON.stringify(info)})`);
  const e = await refusal(() => d.write('brightness', 5));
  check(/not a setting/.test(e?.message || ''), 'Apex 3 brightness write refused');
  const sc = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  check(sc.ran !== false || sc.why, `Apex 3 self-check runs with nothing to write (${JSON.stringify(sc)})`);
  check(sim.sent.length === 0, `Apex 3: nothing sent at all (${sim.sent.map((q) => hex(q.slice(0, 3)))})`);
}

// ---- 3. a keyboard that does not answer the read: nothing offered, nothing written ----
{
  const { d, sim } = driverOn('1642', { unsupported: true, gen1: true });
  all.push(sim);
  await d.connect();
  check(JSON.stringify(await d.read()) === '{}' && d.settings.length === 0, 'status FF: brightness not offered');
  const e = await refusal(() => d.write('brightness', 5));
  check(/not a setting/.test(e?.message || '') && sets(sim).length === 0, 'and never written');
  check((await d.info()).Firmware === 'no reply', 'a firmware reply not starting with 90 shows as no reply');
  check(firmwareText(Uint8Array.from([0x90, ...'1.2.3'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c)))) === '1.2.3' && firmwareText(Uint8Array.from([0x31, 0x2e, 0x32])) === null, 'firmware text: the first byte dropped only when it is 0x90; needs two dots');
}

// ---- 4. wireless ids, a could-not-check, the never list, device.json ----
{
  const { d, sim } = driverOn('1644');
  all.push(sim);
  await d.connect();
  check((await d.info()).Connection === 'wireless (receiver)' && (await d.write('brightness', 7)) === 7, 'Gen 3 wireless id: brightness works the same');
  const t = createApex({ replyMs: 20, open: async (p) => (p === '1610' ? simKeyboard('1610').dev : null), vendorApp: async () => { throw new Error('tasklist failed'); } });
  await t.connect();
  const e = await refusal(() => t.write('brightness', 7));
  check(e?.waiting === true && /could not check/.test(e.message), '"could not check" refuses the write too');
  for (const s of all) {
    check(s.bad.length === 0, `every report well formed (${s.pid}: ${s.bad.join('; ')})`);
    check(s.sent.every((q) => [0xa3, 0x23, 0x90].includes(q[0])), `only A3, 23 and 90 are ever sent (${s.pid})`);
    check(!s.sent.some((q) => neverHit({ vid: '1038', pid: s.pid, page: MODELS[s.pid].chan.page, reportId: 0, bytes: q })), `nothing on the never list was sent (${s.pid})`);
  }
  const specs = Object.fromEntries(hidSpecs(createApex()).map((s) => [s.pid, s]));
  check(PIDS.every((p) => specs[p]) && specs['1610'].iface === 1 && specs['1610'].outputLen === 64 && specs['1644'].iface === 3 && specs['1644'].page === 'FFC0' && specs['1644'].outputLen == null && specs['1622'].page === 'FFC0' && specs['161A'].iface === 3 && specs['161A'].page === '*', 'channels: wired interface 1 by its 64-byte output report, wireless and Apex 3 TKL interface 3 / 1 on FFC0');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'steelseries-apex', 'device.json'), 'utf8'));
  check(validateMeta(meta) === null && meta.status === 'untested' && meta.tested.length === 0, `device.json well formed and untested (${validateMeta(meta)})`);
  check(meta.id === d.id && meta.pids.map((p) => p.toUpperCase()).sort().join() === [...PIDS].sort().join(), 'device.json lists exactly the driver\'s ids');
  const claims = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'device-library'))) {
    if (name === 'steelseries-apex' || name.startsWith('_')) continue;
    for (const file of ['device.json', 'driver.json']) {
      const p = path.join(ROOT, 'device-library', name, file);
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const pid of j.pids || []) claims.push(`${String(j.vid).toLowerCase()}:${String(pid).toLowerCase()} ${name}`);
    }
  }
  const mine = meta.pids.map((p) => `1038:${p}`);
  const clash = claims.filter((c) => mine.includes(c.split(' ')[0]));
  check(claims.length > 50 && clash.length === 0, `no other library entry claims these ids (${clash.join(', ')})`);
  const { RUNS } = createRequire(import.meta.url)('../helpers/pc-map.js');
  check(!mine.some((id) => RUNS[id]), 'none of these ids is one DeviceHub\'s own drivers run');
  check(!['0616', '1202', '1206'].some((p) => meta.pids.includes(p)) && meta.pids.includes('161a'), 'the boards with no read-back (M750, old Apex, 350) are not claimed; the Apex 3 is, named only');
  const none = createApex({ open: async () => null, vendorApp: async () => null });
  check((await none.connect()) === false, 'nothing plugged in: connect() is false');
}

console.log(fails.length ? `sim-steelseries-apex: FAILED: ${fails.join('; ')}` : `sim-steelseries-apex (SteelSeries Apex keyboards, simulated, ${checks} checks): all good`);
process.exit(fails.length ? 1 : 0);
