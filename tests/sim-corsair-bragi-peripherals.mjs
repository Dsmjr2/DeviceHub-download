// The Corsair Bragi mice and keyboards library driver (device-library/corsair-bragi-peripherals) against simulated
// devices, one per model, behind a stand-in for the native helper's hs80 channel that builds and answers the exact
// 64-byte reports helpers/native/hs80io.cs does (GET: 02 <ep> 02 <id lo> <id hi>; SET: 02 <ep> 01 <id> 00 <value LE>;
// reply 01 <who> <cmd> <status> <value LE>), with today's Hs80Io.Set list (02, 03, 0e, 0d, 46, 47) and its "ERR" for
// anything else. Covers every setting: write, read back, put back, refuse out of range, refuse while iCUE runs, and the
// never list (no firmware / radio reads, no light mode, no handles, no SET outside the driver's three ids).
// Touches no device. Run: node tests/sim-corsair-bragi-peripherals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, MODELS, ALL_PIDS, HS80_OWN_PIDS, HELPER_SETS, GENERIC_RECEIVERS, P, POLLING_HZ } from '../device-library/corsair-bragi-peripherals/device.mjs';
import real from '../device-library/corsair-bragi-peripherals/device.mjs';
import { HS80_OWN_PIDS as HEADSET_OWN, ALL_PIDS as HEADSET_PIDS } from '../device-library/corsair-bragi-headset/device.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem, selfCheck } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const hx = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const le4 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

// ---- a simulated device: a property table; unknown ids answer status 05 (sheet section 2: "05 = not supported") ----
function device(m, { props = {}, writable = [P.sleep, P.sleepOn, P.brightness], asleep = false, clamp = null, drop = [] } = {}) {
  const base = m.kind === 'mouse'
    ? { [P.battery]: 815, [P.polling]: 4, [P.dpiX]: 1600, [P.dpiY]: 1600, [P.sleep]: 600000, [P.sleepOn]: 1 }
    : { [P.battery]: 640, [P.polling]: 4, [P.brightness]: 700 };
  const all = { ...base, [P.chargeStatus]: 1, [P.vendorId]: 0x1b1c, [P.firmware]: 5 | (2 << 8) | (300 << 16), [P.connection]: 2, [P.lightMode]: 1, ...props };
  for (const id of drop) delete all[id];
  return { m, props: all, writable, asleep, clamp,
    answer(o, ep) {
      if (this.asleep || o[0] !== 2 || o[1] !== ep) return null;
      const r = new Uint8Array(64); r[0] = 1; r[1] = ep === 9 ? 1 : 0; r[2] = o[2];
      const id = o[3] | (o[4] << 8);
      if (o[2] === 2) { if (!(id in this.props)) { r[3] = 5; return r; } r.set(le4(this.props[id]), 4); return r; }
      if (o[2] === 1) {
        const v = o[5] | (o[6] << 8) | (o[7] << 16) | (o[8] << 24);
        if (!this.writable.includes(id) || !(id in this.props)) { r[3] = 5; return r; }
        this.props[id] = this.clamp ? this.clamp(id, v) : v; return r;
      }
      r[3] = 5; return r;
    } };
}

// ---- the helper's channels, as helper.cs HandleHs80 + hs80io.cs Hs80Io run them (22 Oct 2026) ----
const HS80IO_SET = (id, v) => (id === 0x02 && v >= 0 && v <= 1000) || (id === 0x03 && (v === 1 || v === 2)) || (id === 0x0e && v >= 60000 && v <= 7200000)
  || (id === 0x0d && (v === 0 || v === 1)) || (id === 0x46 && (v === 0 || v === 1)) || (id === 0x47 && v >= 0 && v <= 1000);
function helper(plugged /* { pid: device } */) {
  const log = [], out = [], open = new Set();
  return { log, out, open,
    onEvent() {},
    async request(chan, cmd) {
      log.push(`${chan} ${cmd}`);
      if (chan === 'hidlist') return [...Object.keys(plugged).map((p) => `1B1C ${p} ${plugged[p]?.m?.name || 'CORSAIR receiver'}`), '046D C547 USB Receiver'].join('|');
      const [kind, pid, epS] = chan.split(':'), ep = Number(epS), w = cmd.split(' ');
      if (kind !== 'hs80') return 'ERR unknown channel';
      if (w[0] === 'OPEN') { if (!plugged[pid]) return 'NODEVICE'; open.add(chan); return 'OK'; }
      if (w[0] === 'CLOSE') { open.delete(chan); return 'OK'; }
      const dev = plugged[pid];
      if (!open.has(chan) || !dev) { open.delete(chan); return 'GONE'; }
      const send = (o) => {
        out.push({ pid, bytes: o });
        const r = dev.answer(o, ep);
        return r && r[0] === 1 && r[1] === (ep === 9 ? 1 : 0) && [1, 2, 6, 0x0d].includes(r[2]) ? r : null;
      };
      if (w[0] === 'GET') {
        const id = parseInt(w[1], 16), o = new Uint8Array(64);
        o[0] = 2; o[1] = ep; o[2] = 2; o[3] = id & 0xff; o[4] = id >> 8;
        const r = send(o); return r ? hx(r.slice(3, 9)) : 'NONE';
      }
      if (w[0] === 'SET') {
        const id = parseInt(w[1], 16), v = parseInt(w[2], 10);
        if (!HS80IO_SET(id, v)) { log.push('REFUSED-BY-HELPER'); return `ERR property ${w[1]} = ${v} is not something DeviceHub sets`; }
        const o = new Uint8Array(64); o[0] = 2; o[1] = ep; o[2] = 1; o[3] = id; o[4] = 0; o.set(le4(v), 5);
        const r = send(o); return r ? r[3].toString(16).padStart(2, '0') : 'NONE';
      }
      return 'ERR unknown command';
    } };
}
const sent = (hp, from = 0) => hp.out.slice(from).map((x) => hx(x.bytes.slice(0, 9)));
const mk = (hp, o = {}) => createDriver({ transport: hp, icueRunning: async () => false, ...o });
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
// everything a run may send: hidlist, OPEN, CLOSE, GET of a safe read, SET of the driver's three ids
const SAFE_GETS = ['01', '02', '03', '0d', '0e', '0f', '10', '11', '12', '13', '21', '22', '36'];
const allowedLine = (l) => /^hidlist FF42 01$/.test(l) || new RegExp(`^hs80:[0-9A-F]{4}:[89]:bragi (OPEN|CLOSE|GET (${SAFE_GETS.join('|')})|SET (0e|0d|02) \\d+)$`).test(l);

// ---- the table and the entry ----
check(JSON.stringify(HS80_OWN_PIDS) === JSON.stringify(HEADSET_OWN), 'the HS80 ids are the headset driver\'s');
check(!ALL_PIDS.some((p) => HS80_OWN_PIDS.includes(p)), 'no HS80 RGB Wireless id in the table');
check(!ALL_PIDS.some((p) => HEADSET_PIDS.includes(p)), 'no id the headset library driver answers on');
check(new Set(ALL_PIDS).size === ALL_PIDS.length, 'every product id is in the table once');
for (const p of ['1BB3', '1BD4', '1BC4', '1BC6', '1B73', '1BB9', '1BAF', '1BCF', '1BC3', '1BD7', '1B7C', '1B7D', '1BC5', '1BE3']) check(!ALL_PIDS.includes(p), `${p} (128- or 1024-byte packets) is left out`);
check(JSON.stringify(HELPER_SETS) === JSON.stringify({ 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000], 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] }), 'HELPER_SETS is hs80io.cs Hs80Io.Set\'s list');
const hs80io = fs.readFileSync(path.join(ROOT, 'helpers', 'native', 'hs80io.cs'), 'utf8');
for (const [id, lo, hi] of [['02', 0, 1000], ['0e', 60000, 7200000], ['0d', 0, 1]]) check(hs80io.includes(`id == 0x${id}`) && hs80io.includes(String(hi)), `hs80io.cs still sets ${id} (${lo}-${hi})`);
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'corsair-bragi-peripherals', 'device.json'), 'utf8'));
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify(ALL_PIDS.map((p) => p.toLowerCase()).sort()), 'device.json pids are the table\'s');
check(meta.vid === '1b1c' && meta.status === 'untested' && Array.isArray(meta.tested) && meta.tested.length === 0 && meta.id === real.id && meta.source === 'docs/brands/corsair.md', 'device.json: vid, status untested, tested [], id, source');
check(!validateMeta(meta), `device.json passes the library's check (${validateMeta(meta)})`);
check(!problem(real), `the driver passes the my-devices check (${problem(real)})`);
check(NEVER.commands.some((c) => c.vid === '1B1C' && /sleep now/.test(c.what)) && NEVER.commands.some((c) => c.vid === '1B1C' && /pairing/.test(c.what)), 'the never list names Corsair sleep-now, handles, firmware and pairing');

// ---- every model, on its first id: reads, request bytes, every setting written, read back, put back ----
for (const m of MODELS) {
  const pid = m.devices[0] || m.receivers[0], conn = m.devices.length ? 'cable' : 'receiver', ep = conn === 'cable' ? '08' : '09';
  const dev = device(m), hp = helper({ [pid]: dev, '0A6B': device(m) });
  const d = mk(hp);
  check(await d.connect() === true && d.model === m && d.connection === conn, `${m.key}: connects on ${pid} over ${conn}`);
  check(!hp.log.some((l) => /^hs80:0A6B/.test(l)), `${m.key}: never opens the HS80's receiver beside it`);
  const v = await d.read();
  check(sent(hp)[0] === `02 ${ep} 02 0f 00 00 00 00 00`, `${m.key}: battery asked first (${sent(hp)[0]})`);
  const keys = d.settings.map((s) => s.key).sort().join();
  check(keys === (m.kind === 'mouse' ? 'dpi,polling,sleepOn,sleepTimer' : 'brightness,polling'), `${m.key}: settings ${keys}`);
  check(v.polling === 1000, `${m.key}: polling code 4 reads 1000 Hz (${v.polling})`);
  check(d.settings.filter((s) => ['dpi', 'polling'].includes(s.key)).every((s) => s.type === 'display'), `${m.key}: DPI and polling are readings`);
  if (m.kind === 'mouse') check(v.dpi === 1600 && v.sleepTimer === 10 && v.sleepOn === true, `${m.key}: dpi 1600, sleep 10 min, on (${JSON.stringify(v)})`);
  else check(v.brightness === 70, `${m.key}: brightness 700 reads 70% (${v.brightness})`);
  const b = await d.battery();
  check(b.percent === (m.kind === 'mouse' ? 82 : 64) && b.charging === null, `${m.key}: battery ${JSON.stringify(b)}`);
  const info = await d.info();
  check(info.Model === m.name && info['USB id'] === `1b1c:${pid.toLowerCase()}` && info.Firmware === (m.kind === 'mouse' ? '5.2.300' : '5.2.44'), `${m.key}: info ${JSON.stringify(info)}`);

  // every writable setting: a different value, read back, the original put back, read back
  const cases = m.kind === 'mouse'
    ? [['sleepTimer', 25, P.sleep, 1500000], ['sleepOn', false, P.sleepOn, 0]]
    : [['brightness', 35, P.brightness, 350]];
  for (const [key, to, id, raw] of cases) {
    const before = (await d.read())[key], orig = dev.props[id], mark = hp.out.length;
    check(await d.write(key, to) === to && dev.props[id] === raw, `${m.key}: ${key} ${before} -> ${to} reads back (${dev.props[id]})`);
    check(sent(hp, mark)[0] === `02 ${ep} 01 ${id.toString(16).padStart(2, '0')} 00 ${hx(le4(raw))}`, `${m.key}: ${key} SET bytes (${sent(hp, mark)[0]})`);
    check(sent(hp, mark)[1] === `02 ${ep} 02 ${id.toString(16).padStart(2, '0')} 00 00 00 00 00`, `${m.key}: ${key} is read back with a GET`);
    check((await d.read())[key] === to, `${m.key}: a fresh read shows ${key} = ${to}`);
    check(await d.write(key, before) === before && dev.props[id] === orig, `${m.key}: ${key} put back to ${before}`);
  }
  // refused: out of range, wrong type, readings, the other kind's settings, anything undocumented; nothing sent
  const n = hp.out.length;
  const bad = m.kind === 'mouse'
    ? [['sleepTimer', 0], ['sleepTimer', 61], ['sleepTimer', 2.5], ['sleepOn', 1], ['dpi', 800], ['polling', 500], ['brightness', 50]]
    : [['brightness', -1], ['brightness', 101], ['brightness', 50.5], ['polling', 500], ['sleepTimer', 10], ['dpi', 800]];
  for (const [k, val] of [...bad, ['lightMode', 2], ['angleSnap', true], ['firmware', 1]]) {
    const e = await throws(() => d.write(k, val));
    check(e && !e.gone, `${m.key}: ${k} = ${val} refused (${e?.message})`);
  }
  check(hp.out.length === n, `${m.key}: refused writes send nothing`);
  const raw = await d.rawBackup();
  check(raw.model === m.key && raw.props['0f'].value === dev.props[P.battery] && raw.props['13'] && raw.props['03'], `${m.key}: backup holds the safe reads`);
  check(!hp.log.includes('REFUSED-BY-HELPER'), `${m.key}: never sent a SET the helper refuses`);
  check(hp.log.every(allowedLine), `${m.key}: only safe GETs and SET 0e / 0d / 02 (${hp.log.filter((l) => !allowedLine(l))})`);
  check(!sent(hp).some((s) => /^02 0[89] 02 (14|15|16) /.test(s)), `${m.key}: bootloader / radio firmware never asked`);
  check(!sent(hp).some((s) => /^02 0[89] 01 03 /.test(s)) && !sent(hp).some((s) => /^02 0[89] (0d|06|07|05) /.test(s)), `${m.key}: no light mode or sleep-now SET, no handle opened or written`);
  d.close();
}

// ---- the library self-check (helpers/my-devices.mjs): same value, read back, nothing changes ----
{
  const m = MODELS.find((x) => x.key === 'dark-core-pro'), dev = device(m), hp = helper({ '1B81': dev });
  const d = mk(hp);
  await d.connect();
  const before = JSON.stringify(dev.props);
  const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  const ks = r.keys || {};
  check(ks.sleepTimer?.ok && ks.sleepOn?.ok && !('dpi' in ks) && !('polling' in ks), `self-check passes the writable settings and skips the readings (${JSON.stringify(r)})`);
  check(JSON.stringify(dev.props) === before, 'the self-check leaves the mouse as it was');
  const keyb = MODELS.find((x) => x.key === 'k70-core'), kd = device(keyb), khp = helper({ '2B0A': kd }), k = mk(khp);
  await k.connect();
  const rk = await selfCheck(k, k.write, { backup: async () => true, makerApp: async () => null });
  check(rk.keys?.brightness?.ok && kd.props[P.brightness] === 700, `self-check passes the keyboard brightness (${JSON.stringify(rk)})`);
}

// ---- a generic Slipstream receiver: property 12 on endpoint 09 names the model ----
{
  const m = MODELS.find((x) => x.key === 'm75-wireless'), dev = device(m, { props: { [P.productId]: 0x1bf1 } }), hp = helper({ '1BA6': dev });
  const d = mk(hp);
  check(await d.connect() === true && d.model === m && d.connection === 'receiver', `generic receiver 1BA6: the M75 Wireless behind it (${d.model?.key})`);
  check(sent(hp)[0] === '02 09 02 12 00 00 00 00 00', `generic receiver: one GET 12 on endpoint 09 (${sent(hp)[0]})`);
  check((await d.info())['Paired device id'] === '1b1c:1bf1', 'info names the paired id');
  const unknown = device(m, { props: { [P.productId]: 0x0a69 } }), hu = helper({ '2B00': unknown }), du = mk(hu);
  check(await du.connect() === false && hu.open.size === 0, 'a receiver with an unknown (or HS80) device behind it is closed, not driven');
  for (const g of GENERIC_RECEIVERS) check(!MODELS.some((x) => x.receivers.includes(g)), `${g} belongs to no single model`);
}

// ---- a cable before a receiver; asleep; a setting it does not answer; a read-back that does not stick ----
{
  const m = MODELS.find((x) => x.key === 'dark-core-pro'), hp = helper({ '1B81': device(m), '1B80': device(m) }), d = mk(hp);
  await d.connect();
  check(d.connection === 'cable' && /^hs80:1B80:8:bragi OPEN$/.test(hp.log[1]), `the cable is opened before the receiver (${hp.log[1]})`);

  const sleepy = device(m, { asleep: true }), hs = helper({ '1B81': sleepy }), ds = mk(hs);
  await ds.connect();
  const e = await throws(() => ds.read());
  check(e && /asleep/.test(e.message) && ds.settings.length === 0, `an asleep mouse reads as asleep and offers nothing (${e?.message})`);
  check(!(await throws(() => ds.write('sleepTimer', 5))) === false && !hs.out.some((x) => x.bytes[2] === 1), 'nothing is written to an asleep mouse');
  sleepy.asleep = false;
  check((await ds.read()).sleepTimer === 10, 'it is probed again once it answers');

  const noOn = device(m, { drop: [P.sleepOn, P.dpiY] }), hn = helper({ '1B81': noOn }), dn = mk(hn);
  await dn.connect(); const vn = await dn.read();
  check(!dn.settings.some((s) => s.key === 'sleepOn') && vn.dpi === 1600 && dn.unsupported.some((u) => /sleepOn/.test(u)), 'a mouse that does not answer 0d gets no sleep on/off, and says why');
  check((await throws(() => dn.write('sleepOn', false))) && !hn.out.some((x) => x.bytes[2] === 1), 'and a write to it is refused, nothing sent');

  const xy = device(m, { props: { [P.dpiY]: 800 } }), hx2 = helper({ '1B81': xy }), dx = mk(hx2);
  await dx.connect();
  check((await dx.read()).dpi === '1600 x 800', 'different X and Y DPI read as "X x Y"');

  const stuck = device(m, { clamp: (id, v) => (id === P.sleep ? 300000 : v) }), ht = helper({ '1B81': stuck }), dt = mk(ht);
  await dt.connect(); await dt.read();
  const et = await throws(() => dt.write('sleepTimer', 25));
  check(et && /reads 300000/.test(et.message), `a write that does not read back fails (${et?.message})`);

  const kb = MODELS.find((x) => x.key === 'k55-pro'), wired = device(kb, { drop: [P.battery] }), hw = helper({ '1BA4': wired }), dw = mk(hw);
  await dw.connect(); await dw.read();
  check(await dw.battery() === null, 'a wired keyboard with no battery answer has no battery');
}

// ---- an older helper (no 0d) and a helper with none of the driver's ids: nothing it cannot send is offered or asked ----
{
  const m = MODELS.find((x) => x.key === 'sabre-pro-wireless'), hp = helper({ '1B98': device(m) });
  const d = mk(hp, { helperSets: { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000] } });
  await d.connect(); await d.read();
  check(d.settings.map((s) => s.key).sort().join() === 'dpi,polling,sleepTimer' && !sent(hp).some((s) => / 02 0d /.test(` ${s}`)), 'with a helper without 0d: no sleep on/off, and 0d is never asked');
  const hp2 = helper({ '1B98': device(m) }), d2 = mk(hp2, { helperSets: {} });
  await d2.connect(); await d2.read();
  check(d2.settings.every((s) => s.type === 'display') && !sent(hp2).some((s) => /^02 08 02 (0d|0e) /.test(s)), 'with no SET list: readings only, 0d / 0e never asked');
}

// ---- iCUE running: no connect, no write, nothing sent ----
{
  const m = MODELS.find((x) => x.key === 'k100-air'), dev = device(m), hp = helper({ '1BAB': dev });
  let icue = true;
  const d = mk(hp, { icueRunning: async () => icue });
  const e1 = await throws(() => d.connect());
  check(e1 && /iCUE/.test(e1.message) && hp.log.length === 0, 'connect refuses while iCUE runs and sends nothing');
  check(await d.vendorApp() === 'iCUE.exe', 'vendorApp names iCUE while it runs');
  icue = false; await d.connect(); await d.read();
  icue = true;
  const n = hp.out.length;
  const e2 = await throws(() => d.write('brightness', 20));
  check(e2 && /iCUE/.test(e2.message) && hp.out.length === n && dev.props[P.brightness] === 700, `a write refuses while iCUE runs (${e2?.message})`);
  const e3 = await throws(() => d.read());
  check(e3 && e3.gone && /iCUE/.test(e3.message), 'a read steps back while iCUE runs');
  check(await d.vendorApp() === 'iCUE.exe' && (await selfCheck(d, d.write, { backup: async () => true })).ran === false, 'the self-check does not run while iCUE runs');
}

// ---- unplugged ----
{
  const m = MODELS.find((x) => x.key === 'm65-ultra-wireless'), plugged = { '1BB5': device(m) }, hp = helper(plugged), d = mk(hp);
  await d.connect(); await d.read();
  delete plugged['1BB5'];
  const e = await throws(() => d.read());
  check(e && e.gone, 'an unplugged device reads as gone');
}

console.log(fails.length ? `sim-corsair-bragi-peripherals: FAILED (${fails.length}):\n- ${fails.join('\n- ')}` : `sim-corsair-bragi-peripherals (${MODELS.length} models): all good`);
process.exit(fails.length ? 1 : 0);
