// The Corsair Bragi mice and keyboards library driver (device-library/corsair-bragi-peripherals) against simulated
// devices, one per model, behind a stand-in for the native helper's hs80 channel that builds and answers the exact
// reports helpers/native/hs80io.cs does, in both frames (docs/handoff/corsair-peripheral-frame.md):
//   peripheral (`...:bragi:frame=peripheral`): 65 bytes, GET 00 <ep> 02 <id lo> <id hi>, SET 00 <ep> 01 <id> 00 <value LE>,
//              reply 00 <who> <cmd> <status> <value LE>, with Hs80Io.PeripheralAllows (01, 02, 0d, 0e, 21, 22) and its ERR;
//   headset (`...:bragi`): 64 bytes, 02 prefix, reply report 01, with Hs80Io.Hs80Allows (02, 03, 0e, 0d, 46, 47).
// Also an older helper (no frame part, no FRAME command). Covers every setting: write, read back, put back, refuse out
// of range, refuse while iCUE runs, and the never list (no firmware / radio reads, no light mode, no handles, no SET
// outside the driver's ids). Touches no device. Run: node tests/sim-corsair-bragi-peripherals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, MODELS, ALL_PIDS, HS80_OWN_PIDS, PERIPHERAL_SETS, HEADSET_SETS, GENERIC_RECEIVERS, P, POLLING_HZ } from '../device-library/corsair-bragi-peripherals/device.mjs';
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
// frame: 'peripheral' (no report ids: Windows' report id 00, 65 bytes) or 'headset' (report id 02, 64 bytes)
function device(m, { props = {}, writable = [P.sleep, P.sleepOn, P.brightness, P.polling, P.dpiX, P.dpiY], asleep = false, clamp = null, drop = [], frame = 'peripheral' } = {}) {
  const base = m.kind === 'mouse'
    ? { [P.battery]: 815, [P.polling]: 4, [P.dpiX]: 1600, [P.dpiY]: 1600, [P.sleep]: 600000, [P.sleepOn]: 1 }
    : { [P.battery]: 640, [P.polling]: 4, [P.brightness]: 700 };
  const all = { ...base, [P.chargeStatus]: 1, [P.vendorId]: 0x1b1c, [P.firmware]: 5 | (2 << 8) | (300 << 16), [P.connection]: 2, [P.lightMode]: 1, ...props };
  for (const id of drop) delete all[id];
  const rid = frame === 'peripheral' ? 0 : 2, len = frame === 'peripheral' ? 65 : 64;
  return { m, props: all, writable, asleep, clamp, frame, len,
    answer(o, ep) {
      if (this.asleep || o.length !== len || o[0] !== rid || o[1] !== ep) return null;
      const r = new Uint8Array(len); r[0] = frame === 'peripheral' ? 0 : 1; r[1] = ep === 9 ? 1 : 0; r[2] = o[2];
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
const HS80_ALLOWS = (id, v) => (id === 0x02 && v >= 0 && v <= 1000) || (id === 0x03 && (v === 1 || v === 2)) || (id === 0x0e && v >= 60000 && v <= 7200000)
  || (id === 0x0d && (v === 0 || v === 1)) || (id === 0x46 && (v === 0 || v === 1)) || (id === 0x47 && v >= 0 && v <= 1000);
const PERIPHERAL_ALLOWS = (id, v) => (id === 0x02 && v >= 0 && v <= 1000) || (id === 0x0d && (v === 0 || v === 1)) || (id === 0x0e && v >= 60000 && v <= 3600000)
  || (id === 0x01 && v >= 1 && v <= 4) || ((id === 0x21 || id === 0x22) && v >= 100 && v <= 26000);
// old: an older helper (before frame=peripheral): the frame part is only a tag, FRAME is an unknown command
function helper(plugged /* { pid: device } */, { old = false } = {}) {
  const log = [], out = [], open = new Set();
  return { log, out, open,
    onEvent() {},
    async request(chan, cmd) {
      log.push(`${chan} ${cmd}`);
      if (chan === 'hidlist') return [...Object.keys(plugged).map((p) => `1B1C ${p} ${plugged[p]?.m?.name || 'CORSAIR receiver'}`), '046D C547 USB Receiver'].join('|');
      const parts = chan.split(':'), [kind, pid, epS] = parts, ep = Number(epS), w = cmd.split(' ');
      if (kind !== 'hs80') return 'ERR unknown channel';
      const frames = parts.slice(3).filter((x) => x.startsWith('frame='));
      const per = !old && frames.length === 1 && frames[0] === 'frame=peripheral';
      if (w[0] === 'OPEN') {
        if (!old && (frames.length > 1 || (frames.length === 1 && !per))) return 'ERR unknown frame';
        if (per && ['0A69', '0A6B', '0A71'].includes(pid)) return 'ERR the HS80 is never opened on the peripheral frame';
        const dev = plugged[pid];
        // HidFind: the peripheral frame wants 65-byte reports, the headset frame 64
        if (!dev || dev.len !== (per ? 65 : 64)) return 'NODEVICE';
        open.add(chan); return 'OK';
      }
      if (w[0] === 'CLOSE') { open.delete(chan); return 'OK'; }
      const dev = plugged[pid];
      if (!open.has(chan) || !dev) { open.delete(chan); return 'GONE'; }
      if (w[0] === 'FRAME') return old ? 'ERR unknown command' : per ? 'peripheral' : 'hs80';
      const len = per ? 65 : 64, rid = per ? 0 : 2;
      const send = (o) => {
        out.push({ pid, bytes: o });
        const r = dev.answer(o, ep);
        const isReply = (b) => (per ? b[0] === 0 && [1, 2].includes(b[2]) : b[0] === 1 && [1, 2, 6, 0x0d].includes(b[2])) && b[1] === (ep === 9 ? 1 : 0);
        return r && isReply(r) ? r : null;
      };
      if (w[0] === 'GET') {
        const id = parseInt(w[1], 16), o = new Uint8Array(len);
        o[0] = rid; o[1] = ep; o[2] = 2; o[3] = id & 0xff; o[4] = id >> 8;
        const r = send(o); return r ? hx(r.slice(3, 9)) : 'NONE';
      }
      if (w[0] === 'SET') {
        const id = parseInt(w[1], 16), v = parseInt(w[2], 10);
        if (!(per ? PERIPHERAL_ALLOWS : HS80_ALLOWS)(id, v)) { log.push('REFUSED-BY-HELPER'); return `ERR property ${w[1]} = ${v} is not something DeviceHub sets`; }
        const o = new Uint8Array(len); o[0] = rid; o[1] = ep; o[2] = 1; o[3] = id; o[4] = 0; o.set(le4(v), 5);
        const r = send(o); return r ? r[3].toString(16).padStart(2, '0') : 'NONE';
      }
      if (per && (w[0] === 'LIGHT' || w[0] === 'OPENLIGHT')) return 'ERR no light messages on a peripheral channel';
      return 'ERR unknown command';
    } };
}
const sent = (hp, from = 0) => hp.out.slice(from).map((x) => hx(x.bytes.slice(0, 9)));
const mk = (hp, o = {}) => createDriver({ transport: hp, icueRunning: async () => false, ...o });
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
// everything a run may send: hidlist, OPEN, FRAME, CLOSE, GET of a safe read, SET of the driver's ids
const SAFE_GETS = ['01', '02', '03', '0d', '0e', '0f', '10', '11', '12', '13', '21', '22', '36'];
const allowedLine = (l) => /^hidlist FF42 01$/.test(l) || new RegExp(`^hs80:[0-9A-F]{4}:[89]:bragi(:frame=peripheral)? (OPEN|FRAME|CLOSE|GET (${SAFE_GETS.join('|')})|SET (0e|0d|02|01|21|22) \\d+)$`).test(l);

// ---- the table and the entry ----
check(JSON.stringify(HS80_OWN_PIDS) === JSON.stringify(HEADSET_OWN), 'the HS80 ids are the headset driver\'s');
check(!ALL_PIDS.some((p) => HS80_OWN_PIDS.includes(p)), 'no HS80 RGB Wireless id in the table');
check(!ALL_PIDS.some((p) => HEADSET_PIDS.includes(p)), 'no id the headset library driver answers on');
check(new Set(ALL_PIDS).size === ALL_PIDS.length, 'every product id is in the table once');
for (const p of ['1BB3', '1BD4', '1BC4', '1BC6', '1B73', '1BB9', '1BAF', '1BCF', '1BC3', '1BD7', '1B7C', '1B7D', '1BC5', '1BE3']) check(!ALL_PIDS.includes(p), `${p} (128- or 1024-byte packets) is left out`);
check(JSON.stringify(HEADSET_SETS) === JSON.stringify({ 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000], 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] }), 'HEADSET_SETS is hs80io.cs Hs80Allows\'s list');
check(JSON.stringify(PERIPHERAL_SETS) === JSON.stringify({ 0x01: [1, 4], 0x02: [0, 1000], 0x0d: [0, 1], 0x0e: [60000, 3600000], 0x21: [100, 26000], 0x22: [100, 26000] }), 'PERIPHERAL_SETS is hs80io.cs PeripheralAllows\'s list');
const hs80io = fs.readFileSync(path.join(ROOT, 'helpers', 'native', 'hs80io.cs'), 'utf8');
const body = (name) => { const a = hs80io.indexOf(`public static bool ${name}(`); return hs80io.slice(a, hs80io.indexOf('\n  }', a)); };
const csPairs = (src) => {   // every `id == 0x.. && value >= lo && value <= hi` / `(value == a || value == b)` in a C# list
  const out = {};
  for (const m of src.matchAll(/id == 0x([0-9a-f]{2})(?: \|\| id == 0x([0-9a-f]{2}))?\)? && (?:value >= (\d+) && value <= (\d+)|\(value == (\d+) \|\| value == (\d+)\))/g)) {
    const r = m[3] != null ? [Number(m[3]), Number(m[4])] : [Number(m[5]), Number(m[6])];
    for (const id of [m[1], m[2]].filter(Boolean)) out[parseInt(id, 16)] = r;
  }
  return out;
};
const sortKeys = (o) => JSON.stringify(Object.keys(o).map(Number).sort((a, b) => a - b).map((k) => [k, o[k]]));
check(sortKeys(csPairs(body('PeripheralAllows'))) === sortKeys(PERIPHERAL_SETS), `hs80io.cs PeripheralAllows is PERIPHERAL_SETS (${sortKeys(csPairs(body('PeripheralAllows')))})`);
check(sortKeys(csPairs(body('Hs80Allows'))) === sortKeys(HEADSET_SETS), `hs80io.cs Hs80Allows is HEADSET_SETS (${sortKeys(csPairs(body('Hs80Allows')))})`);
for (let id = 0; id < 0x100; id++) for (const v of [-1, 0, 1, 2, 4, 5, 99, 100, 1000, 1001, 26000, 26001, 60000, 3600000, 3600001, 7200000]) {
  const r = PERIPHERAL_SETS[id];
  check(PERIPHERAL_ALLOWS(id, v) === (!!r && v >= r[0] && v <= r[1]), `the stand-in's peripheral list matches for ${id} = ${v}`);
}
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'corsair-bragi-peripherals', 'device.json'), 'utf8'));
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify(ALL_PIDS.map((p) => p.toLowerCase()).sort()), 'device.json pids are the table\'s');
check(meta.vid === '1b1c' && meta.status === 'untested' && Array.isArray(meta.tested) && meta.tested.length === 0 && meta.id === real.id && meta.source === 'docs/brands/corsair.md', 'device.json: vid, status untested, tested [], id, source');
check(!validateMeta(meta), `device.json passes the library's check (${validateMeta(meta)})`);
check(!problem(real), `the driver passes the my-devices check (${problem(real)})`);
check(NEVER.commands.some((c) => c.vid === '1B1C' && /sleep now/.test(c.what)) && NEVER.commands.some((c) => c.vid === '1B1C' && /pairing/.test(c.what)), 'the never list names Corsair sleep-now, handles, firmware and pairing');

// ---- every model, on its first id, peripheral frame: reads, request bytes, every setting written, read back, put back ----
for (const m of MODELS) {
  const pid = m.devices[0] || m.receivers[0], conn = m.devices.length ? 'cable' : 'receiver', ep = conn === 'cable' ? '08' : '09';
  const dev = device(m), hp = helper({ [pid]: dev, '0A6B': device(m, { frame: 'headset' }) });
  const d = mk(hp);
  check(await d.connect() === true && d.model === m && d.connection === conn, `${m.key}: connects on ${pid} over ${conn}`);
  check(hp.log[1] === `hs80:${pid}:${Number(ep)}:bragi:frame=peripheral OPEN` && hp.log[2] === `hs80:${pid}:${Number(ep)}:bragi:frame=peripheral FRAME`, `${m.key}: opens the peripheral frame and asks which frame it got (${hp.log.slice(1, 3)})`);
  check(!hp.log.some((l) => /^hs80:0A6B/.test(l)), `${m.key}: never opens the HS80's receiver beside it`);
  const v = await d.read();
  check(sent(hp)[0] === `00 ${ep} 02 0f 00 00 00 00 00` && hp.out[0].bytes.length === 65, `${m.key}: battery asked first, peripheral frame, 65 bytes (${sent(hp)[0]})`);
  const keys = d.settings.map((s) => s.key).sort().join();
  check(keys === (m.kind === 'mouse' ? 'dpi,polling,sleepOn,sleepTimer' : 'brightness,polling'), `${m.key}: settings ${keys}`);
  check(v.polling === 1000, `${m.key}: polling code 4 reads 1000 Hz (${v.polling})`);
  const pol = d.settings.find((s) => s.key === 'polling'), dpi = d.settings.find((s) => s.key === 'dpi');
  check(pol.type === 'choice' && pol.options.map((o) => o.value).join() === '125,250,500,1000', `${m.key}: polling is a choice of 125-1000 Hz (${pol.type})`);
  if (m.kind === 'mouse') {
    check(Number.isInteger(m.dpiMax) ? dpi.type === 'slider' && dpi.min === 100 && dpi.max === m.dpiMax : dpi.type === 'display', `${m.key}: DPI is ${Number.isInteger(m.dpiMax) ? `a 100-${m.dpiMax} slider` : 'a reading (no documented top)'} (${dpi.type} ${dpi.max})`);
    check(v.dpi === 1600 && v.sleepTimer === 10 && v.sleepOn === true, `${m.key}: dpi 1600, sleep 10 min, on (${JSON.stringify(v)})`);
  } else check(v.brightness === 70, `${m.key}: brightness 700 reads 70% (${v.brightness})`);
  const b = await d.battery();
  check(b.percent === (m.kind === 'mouse' ? 82 : 64) && b.charging === null, `${m.key}: battery ${JSON.stringify(b)}`);
  const info = await d.info();
  check(info.Model === m.name && info['USB id'] === `1b1c:${pid.toLowerCase()}` && info.Firmware === (m.kind === 'mouse' ? '5.2.300' : '5.2.44') && /^peripheral/.test(info.Frame), `${m.key}: info ${JSON.stringify(info)}`);

  // every writable setting: a different value, read back, the original put back, read back
  const cases = m.kind === 'mouse'
    ? [['sleepTimer', 25, P.sleep, 1500000], ['sleepOn', false, P.sleepOn, 0], ['polling', 500, P.polling, 3]]
    : [['brightness', 35, P.brightness, 350], ['polling', 125, P.polling, 1]];
  for (const [key, to, id, raw] of cases) {
    const before = (await d.read())[key], orig = dev.props[id], mark = hp.out.length;
    check(await d.write(key, to) === to && dev.props[id] === raw, `${m.key}: ${key} ${before} -> ${to} reads back (${dev.props[id]})`);
    const idh = id.toString(16).padStart(2, '0');
    check(sent(hp, mark)[0] === `00 ${ep} 02 ${idh} 00 00 00 00 00`, `${m.key}: ${key} raw value read before the write (${sent(hp, mark)[0]})`);
    check(sent(hp, mark)[1] === `00 ${ep} 01 ${idh} 00 ${hx(le4(raw))}`, `${m.key}: ${key} SET bytes (${sent(hp, mark)[1]})`);
    check(sent(hp, mark)[2] === `00 ${ep} 02 ${idh} 00 00 00 00 00`, `${m.key}: ${key} is read back with a GET`);
    check((await d.read())[key] === to, `${m.key}: a fresh read shows ${key} = ${to}`);
    check(await d.write(key, before) === before && dev.props[id] === orig, `${m.key}: ${key} put back to ${before}`);
  }
  if (m.kind === 'mouse' && Number.isInteger(m.dpiMax)) {
    const mark = hp.out.length;
    check(await d.write('dpi', 800) === 800 && dev.props[P.dpiX] === 800 && dev.props[P.dpiY] === 800, `${m.key}: DPI 1600 -> 800, X and Y read back`);
    check(JSON.stringify(sent(hp, mark)) === JSON.stringify([`00 ${ep} 02 21 00 00 00 00 00`, `00 ${ep} 02 22 00 00 00 00 00`, `00 ${ep} 01 21 00 20 03 00 00`, `00 ${ep} 02 21 00 00 00 00 00`, `00 ${ep} 01 22 00 20 03 00 00`, `00 ${ep} 02 22 00 00 00 00 00`]), `${m.key}: DPI reads X and Y, then sets X, reads it, sets Y, reads it (${sent(hp, mark)})`);
    check((await d.read()).dpi === 800 && await d.write('dpi', m.dpiMax) === m.dpiMax && await d.write('dpi', 1600) === 1600 && dev.props[P.dpiX] === 1600, `${m.key}: DPI ${m.dpiMax} (its top) and back to 1600`);
  }
  // refused: out of range, wrong type, readings, the other kind's settings, anything undocumented; nothing sent
  const n = hp.out.length;
  const bad = m.kind === 'mouse'
    ? [['sleepTimer', 0], ['sleepTimer', 61], ['sleepTimer', 2.5], ['sleepOn', 1], ['polling', 2000], ['polling', 600], ['polling', '1000'], ['brightness', 50],
      ...(Number.isInteger(m.dpiMax) ? [['dpi', 99], ['dpi', m.dpiMax + 1], ['dpi', 800.5], ['dpi', '800']] : [['dpi', 800]])]
    : [['brightness', -1], ['brightness', 101], ['brightness', 50.5], ['polling', 8000], ['polling', 0], ['sleepTimer', 10], ['dpi', 800]];
  for (const [k, val] of [...bad, ['lightMode', 2], ['angleSnap', true], ['firmware', 1], ['dpiStage', 1]]) {
    const e = await throws(() => d.write(k, val));
    check(e && !e.gone, `${m.key}: ${k} = ${val} refused (${e?.message})`);
  }
  check(hp.out.length === n, `${m.key}: refused writes send nothing`);
  const raw = await d.rawBackup();
  check(raw.model === m.key && raw.props['0f'].value === dev.props[P.battery] && raw.props['13'] && raw.props['03'], `${m.key}: backup holds the safe reads`);
  check(!hp.log.includes('REFUSED-BY-HELPER'), `${m.key}: never sent a SET the helper refuses`);
  check(hp.log.every(allowedLine), `${m.key}: only safe GETs and SET 0e / 0d / 02 / 01 / 21 / 22 (${hp.log.filter((l) => !allowedLine(l))})`);
  check(!sent(hp).some((s) => /^0[02] 0[89] 02 (14|15|16) /.test(s)), `${m.key}: bootloader / radio firmware never asked`);
  check(!sent(hp).some((s) => /^0[02] 0[89] 01 (03|1e|1f|37) /.test(s)) && !sent(hp).some((s) => /^0[02] 0[89] (0d|06|07|05) /.test(s)), `${m.key}: no light mode, sleep-now, DPI stage or 37 SET, no handle opened or written`);
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
  check(ks.sleepTimer?.ok && ks.sleepOn?.ok && ks.dpi?.ok && ks.polling?.ok, `self-check passes every writable mouse setting, DPI and polling too (${JSON.stringify(r)})`);
  check(JSON.stringify(dev.props) === before, 'the self-check leaves the mouse as it was');
  const keyb = MODELS.find((x) => x.key === 'k70-core'), kd = device(keyb), khp = helper({ '2B0A': kd }), k = mk(khp);
  await k.connect();
  const rk = await selfCheck(k, k.write, { backup: async () => true, makerApp: async () => null });
  check(rk.keys?.brightness?.ok && rk.keys?.polling?.ok && kd.props[P.brightness] === 700 && kd.props[P.polling] === 4, `self-check passes the keyboard brightness and polling (${JSON.stringify(rk)})`);
  // a mouse with no documented top: DPI is a reading, never self-checked or written
  const sab = MODELS.find((x) => x.key === 'sabre-pro-wireless'), sd = device(sab), shp = helper({ '1B98': sd }), s = mk(shp);
  await s.connect();
  const rs = await selfCheck(s, s.write, { backup: async () => true, makerApp: async () => null });
  check(!('dpi' in (rs.keys || {})) && rs.keys?.polling?.ok && !shp.out.some((x) => x.bytes[2] === 1 && [0x21, 0x22].includes(x.bytes[3])), `a mouse without dpiMax: no DPI SET, ever (${JSON.stringify(rs.keys)})`);
  // X and Y different: the reading is "X x Y", which the self-check does not write, and write() refuses
  const xy = device(m, { props: { [P.dpiY]: 800 } }), hxy = helper({ '1B81': xy }), dxy = mk(hxy);
  await dxy.connect();
  const rxy = await selfCheck(dxy, dxy.write, { backup: async () => true, makerApp: async () => null });
  check(rxy.keys?.dpi?.ok === false && xy.props[P.dpiX] === 1600 && xy.props[P.dpiY] === 800 && !hxy.out.some((x) => x.bytes[2] === 1 && [0x21, 0x22].includes(x.bytes[3])), `X 1600 / Y 800: the self-check writes no DPI (${JSON.stringify(rxy.keys?.dpi)})`);
  const exy = await throws(() => dxy.write('dpi', 1200));
  check(exy && /one DPI for both/.test(exy.message) && xy.props[P.dpiX] === 1600 && !hxy.out.some((x) => x.bytes[2] === 1 && [0x21, 0x22].includes(x.bytes[3])), `a DPI write on a mouse whose X and Y differ is refused, nothing sent (${exy?.message})`);
}

// ---- driver safety (22 Oct 2026): raw values the page's units cannot show exactly go back exactly as read ----
{
  const m = MODELS.find((x) => x.key === 'dark-core-pro'), dev = device(m, { props: { [P.sleep]: 90000 } }), hp = helper({ '1B81': dev });
  const d = mk(hp);
  await d.connect();
  check((await d.read()).sleepTimer === 2, 'a 90 s sleep timer shows as 2 min');
  let mark = hp.out.length;
  const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  const sets = sent(hp, mark).filter((x) => /^00 09 01 /.test(x));
  check(r.keys?.sleepTimer?.ok && dev.props[P.sleep] === 90000, `self-check of a 90 s timer leaves it at 90000 ms (${dev.props[P.sleep]})`);
  check(sets.includes(`00 09 01 0e 00 ${hx(le4(90000))}`) && !sets.includes(`00 09 01 0e 00 ${hx(le4(120000))}`), `the self-check sent raw 90000, never 120000 (${sets})`);
  check(sets.includes('00 09 01 0d 00 01 00 00 00'), 'the self-check really sent sleep on/off (raw 1, as read)');
  check(sets.includes('00 09 01 01 00 04 00 00 00') && sets.includes(`00 09 01 21 00 ${hx(le4(1600))}`) && sets.includes(`00 09 01 22 00 ${hx(le4(1600))}`), `the self-check sent polling 4 and DPI 1600 back as read (${sets})`);
  check(await d.write('sleepTimer', 5) === 5 && dev.props[P.sleep] === 300000, 'a different value is still written in whole minutes');
  // a raw value the helper cannot send back exactly (30 s, under its 60000 floor) is refused, not rounded up
  dev.props[P.sleep] = 30000;
  const shown = (await d.read()).sleepTimer;
  mark = hp.out.length;
  const e = await throws(() => d.write('sleepTimer', shown));
  check(e && /cannot send back exactly/.test(e.message) && dev.props[P.sleep] === 30000 && !sent(hp, mark).some((x) => /^00 09 01 /.test(x)), `a raw 30000 ms written back as ${shown} min is refused, nothing sent (${e?.message})`);
  // a polling code above 4 (2000 Hz on some mice) reads as 2000, which is not a choice: never written back
  dev.props[P.polling] = 5;
  check((await d.read()).polling === 2000, 'polling code 5 reads 2000 Hz');
  mark = hp.out.length;
  const r5 = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null, only: ['polling'] });
  check(r5.keys?.polling?.ok === false && dev.props[P.polling] === 5 && !sent(hp, mark).some((x) => /^00 09 01 01 /.test(x)), `a 2000 Hz mouse: the self-check does not write polling (${JSON.stringify(r5.keys?.polling)})`);
  check(await d.write('polling', 1000) === 1000 && dev.props[P.polling] === 4, 'and 1000 Hz can still be chosen');

  const kb = MODELS.find((x) => x.key === 'k70-core'), kd = device(kb, { props: { [P.brightness]: 455 } }), khp = helper({ '2B0A': kd }), k = mk(khp);
  await k.connect();
  check((await k.read()).brightness === 46, 'raw brightness 455 shows as 46%');
  mark = khp.out.length;
  const rk = await selfCheck(k, k.write, { backup: async () => true, makerApp: async () => null });
  const ksets = sent(khp, mark).filter((x) => /^00 08 01 02 /.test(x));
  check(rk.keys?.brightness?.ok && kd.props[P.brightness] === 455 && ksets.length >= 1 && ksets.every((x) => x === `00 08 01 02 00 ${hx(le4(455))}`), `self-check sends raw 455 back, never 460 (${ksets})`);
  check(await k.write('brightness', 30) === 30 && kd.props[P.brightness] === 300 && await k.write('brightness', 46) === 46 && kd.props[P.brightness] === 460, 'a changed brightness is written as percent x 10');
}

// ---- a generic Slipstream receiver: property 12 on endpoint 09 names the model ----
{
  const m = MODELS.find((x) => x.key === 'm75-wireless'), dev = device(m, { props: { [P.productId]: 0x1bf1 } }), hp = helper({ '1BA6': dev });
  const d = mk(hp);
  check(await d.connect() === true && d.model === m && d.connection === 'receiver', `generic receiver 1BA6: the M75 Wireless behind it (${d.model?.key})`);
  check(sent(hp)[0] === '00 09 02 12 00 00 00 00 00', `generic receiver: one GET 12 on endpoint 09 (${sent(hp)[0]})`);
  check((await d.info())['Paired device id'] === '1b1c:1bf1', 'info names the paired id');
  const unknown = device(m, { props: { [P.productId]: 0x0a69 } }), hu = helper({ '2B00': unknown }), du = mk(hu);
  check(await du.connect() === false && hu.open.size === 0, 'a receiver with an unknown (or HS80) device behind it is closed, not driven');
  for (const g of GENERIC_RECEIVERS) check(!MODELS.some((x) => x.receivers.includes(g)), `${g} belongs to no single model`);
}

// ---- the headset frame: a device whose FF42 collection has report id 02 (64 bytes), and an older helper ----
{
  const m = MODELS.find((x) => x.key === 'dark-core-pro');
  const dev = device(m, { frame: 'headset' }), hp = helper({ '1B81': dev }), d = mk(hp);
  check(await d.connect() === true && hp.log.includes('hs80:1B81:9:bragi:frame=peripheral OPEN') && hp.log.includes('hs80:1B81:9:bragi:frame=peripheral CLOSE') && hp.log.includes('hs80:1B81:9:bragi OPEN'), `a 64-byte (report id 02) device: the peripheral frame does not open, the headset frame does (${hp.log.slice(1, 4)})`);
  const v = await d.read();
  check(sent(hp)[0] === '02 09 02 0f 00 00 00 00 00' && hp.out[0].bytes.length === 64 && v.dpi === 1600, `the headset frame's bytes (${sent(hp)[0]})`);
  check(d.settings.find((s) => s.key === 'dpi').type === 'display' && d.settings.find((s) => s.key === 'polling').type === 'display' && /^headset/.test((await d.info()).Frame), 'on the headset frame DPI and polling are readings (its SET list has neither)');
  check((await throws(() => d.write('dpi', 800))) && (await throws(() => d.write('polling', 500))) && !hp.out.some((x) => x.bytes[2] === 1), 'and are never written');
  check(await d.write('sleepTimer', 25) === 25 && dev.props[P.sleep] === 1500000 && sent(hp).includes(`02 09 01 0e 00 ${hx(le4(1500000))}`), 'the sleep timer still writes on the headset frame');
  check(d.unsupported.some((u) => /headset frame/.test(u)), 'and says why DPI and polling are readings');

  // an older helper: it ignores "frame=peripheral" (opens the 64-byte collection under that name) and has no FRAME
  const odev = device(m, { frame: 'headset' }), ohp = helper({ '1B81': odev }, { old: true }), od = mk(ohp);
  check(await od.connect() === true && ohp.log[1] === 'hs80:1B81:9:bragi:frame=peripheral OPEN' && ohp.log[2] === 'hs80:1B81:9:bragi:frame=peripheral FRAME' && /^headset/.test((await od.info()).Frame), 'an older helper: FRAME answers ERR, so the channel counts as the headset frame');
  await od.read();
  check(od.settings.find((s) => s.key === 'dpi').type === 'display' && od.settings.find((s) => s.key === 'polling').type === 'display' && !ohp.log.includes('REFUSED-BY-HELPER'), 'with an older helper: DPI and polling stay readings, nothing it would refuse is sent');
  // an older helper with a peripheral-only device: neither frame opens, nothing is driven
  const pdev = device(m), php = helper({ '1B81': pdev }, { old: true }), pd = mk(php);
  check(await pd.connect() === false && php.out.length === 0 && php.open.size === 0, 'an older helper and a device without report ids: nothing opens, nothing is sent');
  // the helper refuses the peripheral frame on the HS80's ids (and an unknown frame part)
  const hh = helper({}), r1 = await hh.request('hs80:0A6B:9:bragi:frame=peripheral', 'OPEN'), r2 = await hh.request('hs80:1B81:9:bragi:frame=other', 'OPEN');
  check(/^ERR/.test(r1) && /^ERR/.test(r2), 'the stand-in refuses the HS80 on the peripheral frame and an unknown frame, as helper.cs does');
  const hsrc = fs.readFileSync(path.join(ROOT, 'helpers', 'native', 'helper.cs'), 'utf8');
  check(/if \(per && Hs80Io\.IsHs80Pid\(p\[1\]\)\) return "ERR/.test(hsrc) && /if \(frame == null\) return "ERR unknown frame"/.test(hsrc) && /case "FRAME": return c\.Hs\.Peripheral \? "peripheral" : "hs80";/.test(hsrc), 'helper.cs: HS80 ids and unknown frames refused, FRAME answers the frame');
}

// ---- a cable before a receiver; asleep; a setting it does not answer; a read-back that does not stick ----
{
  const m = MODELS.find((x) => x.key === 'dark-core-pro'), hp = helper({ '1B81': device(m), '1B80': device(m) }), d = mk(hp);
  await d.connect();
  check(d.connection === 'cable' && /^hs80:1B80:8:bragi:frame=peripheral OPEN$/.test(hp.log[1]), `the cable is opened before the receiver (${hp.log[1]})`);

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
  check(dn.settings.find((s) => s.key === 'dpi').type === 'display', 'a mouse that does not answer a read of DPI Y: DPI is a reading only');
  check((await throws(() => dn.write('sleepOn', false))) && (await throws(() => dn.write('dpi', 800))) && !hn.out.some((x) => x.bytes[2] === 1), 'and writes to them are refused, nothing sent');

  const xy = device(m, { props: { [P.dpiY]: 800 } }), hx2 = helper({ '1B81': xy }), dx = mk(hx2);
  await dx.connect();
  check((await dx.read()).dpi === '1600 x 800', 'different X and Y DPI read as "X x Y"');

  const stuck = device(m, { clamp: (id, v) => (id === P.sleep ? 300000 : id === P.dpiY ? 1600 : v) }), ht = helper({ '1B81': stuck }), dt = mk(ht);
  await dt.connect(); await dt.read();
  const et = await throws(() => dt.write('sleepTimer', 25));
  check(et && /reads 300000/.test(et.message), `a write that does not read back fails (${et?.message})`);
  const ed = await throws(() => dt.write('dpi', 800));
  check(ed && /DPI Y 1600 after setting 800/.test(ed.message), `a DPI Y that does not stick fails (${ed?.message})`);

  const kb = MODELS.find((x) => x.key === 'k55-pro'), wired = device(kb, { drop: [P.battery] }), hw = helper({ '1BA4': wired }), dw = mk(hw);
  await dw.connect(); await dw.read();
  check(await dw.battery() === null, 'a wired keyboard with no battery answer has no battery');
}

// ---- a fixed SET list (an old helper's): nothing it cannot send is offered or asked ----
{
  const m = MODELS.find((x) => x.key === 'sabre-pro-wireless'), hp = helper({ '1B98': device(m) });
  const d = mk(hp, { helperSets: { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000] } });
  await d.connect(); await d.read();
  check(d.settings.map((s) => s.key).sort().join() === 'dpi,polling,sleepTimer' && d.settings.find((s) => s.key === 'polling').type === 'display' && !sent(hp).some((s) => / 02 0d /.test(` ${s}`)), 'with a list without 0d / 01: no sleep on/off, polling a reading, and 0d is never asked');
  const hp2 = helper({ '1B98': device(m) }), d2 = mk(hp2, { helperSets: {} });
  await d2.connect(); await d2.read();
  check(d2.settings.every((s) => s.type === 'display') && !sent(hp2).some((s) => /^0[02] 08 02 (0d|0e) /.test(s)), 'with no SET list: readings only, 0d / 0e never asked');
}

// ---- iCUE running: connects and reads (GETs only), every write refused with nothing sent ----
{
  const m = MODELS.find((x) => x.key === 'k100-air'), dev = device(m), hp = helper({ '1BAB': dev });
  let icue = true;
  const d = mk(hp, { icueRunning: async () => icue });
  check(await d.connect() === true && (await d.read()).brightness === 70, 'connects and reads while iCUE runs');
  check(hp.out.every((x) => x.bytes[2] === 2), 'only GETs were sent while iCUE runs');
  check(await d.vendorApp() === 'iCUE.exe', 'vendorApp names iCUE while it runs');
  const n = hp.out.length;
  const e2 = await throws(() => d.write('brightness', 20));
  check(e2 && /iCUE/.test(e2.message) && e2.waiting === true && hp.out.length === n && dev.props[P.brightness] === 700, `a write refuses while iCUE runs, nothing sent (${e2?.message})`);
  const e2b = await throws(() => d.write('brightness', 70));
  check(e2b && /iCUE/.test(e2b.message) && hp.out.length === n, 'a write of the same value is refused too while iCUE runs');
  const e2c = await throws(() => d.write('polling', 500));
  check(e2c && /iCUE/.test(e2c.message) && e2c.waiting === true && hp.out.length === n, 'a polling write refuses while iCUE runs');
  const mouse = MODELS.find((x) => x.key === 'dark-core-pro'), md = device(mouse), mh = helper({ '1B81': md }), dm = mk(mh, { icueRunning: async () => true });
  check(await dm.connect() === true && (await dm.read()).sleepTimer === 10, 'a mouse reads while iCUE runs');
  const n2 = mh.out.length;
  const e3 = await throws(() => dm.write('sleepTimer', 25));
  const e4 = await throws(() => dm.write('dpi', 800));
  check(e3 && /iCUE/.test(e3.message) && e4 && /iCUE/.test(e4.message) && e4.waiting === true && mh.out.length === n2 && md.props[P.sleep] === 600000 && md.props[P.dpiX] === 1600, 'mouse sleep and DPI writes refuse while iCUE runs, nothing sent');
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

console.log(fails.length ? `sim-corsair-bragi-peripherals: FAILED (${fails.length}):\n- ${fails.join('\n- ')}` : `sim-corsair-bragi-peripherals (${MODELS.length} models, both frames): all good`);
process.exit(fails.length ? 1 : 0);
