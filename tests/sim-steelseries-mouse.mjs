// Offline test of the SteelSeries mouse library driver (device-library/steelseries-mouse/device.mjs) against simulated
// mice that answer exactly the reads docs/brands/steelseries.md documents (battery 92 on the cable, D2 through the
// 2.4 GHz receiver, value in byte 1; Rival 3 firmware 10 00) and flag anything else they are sent. Checks the request
// bytes, report id and length, the battery parse, that every documented write-only setting is refused with nothing sent
// (with and without SteelSeries GG running), and that nothing on DeviceHub's never list (the saves) ever goes out.
// No hardware: every device here is pretend. Run: node tests/sim-steelseries-mouse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeviceProvider } from '../public/devices/hid.js';
import { problem, selfCheck } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: drv, MODELS, WRITE_ONLY, VENDOR_APPS, parseBattery, WIRELESS_FLAG, SAVES, WRITE_CMDS, settingsFor, encode } = await import('../device-library/steelseries-mouse/device.mjs');
const { VENDOR_APPS: ARCTIS_APPS } = await import('../device-library/steelseries-arctis/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/steelseries-mouse/device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));
let app = null;
drv.vendorApp = async () => app;   // no tasklist in the test

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const hx = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const h4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();

// the never list's SteelSeries byte patterns (the saves), as [{ bytes: [..], pids }]
const NEVERS = NEVER.commands.filter((c) => c.bytes && [].concat(c.vid).includes('1038')).map((c) => ({ ...c, b: c.bytes.split(' ').map((x) => parseInt(x, 16)) }));
check(NEVERS.some((n) => n.bytes === '11 00') && NEVERS.some((n) => n.bytes === '51 00') && NEVERS.some((n) => n.bytes === '09 00') && NEVERS.some((n) => n.bytes === '59'), 'the mouse saves (11 00, 51 00, 09 00, 59) are on DeviceHub\'s never list');

// A simulated mouse: answers the two documented reads, flags anything else.
class SimMouse {
  constructor(m, o = {}) {
    Object.assign(this, { vendorId: 0x1038, productId: m.pid, productName: `sim ${m.name}`, opened: false });
    this.m = m; this.listeners = new Set(); this.sent = []; this.bad = []; this.writes = [];
    this.o = { level: 13, charging: false, silent: false, fw: [0x25, 0x00], ...o };   // level code 13 -> (13 - 1) x 5 = 60%
  }
  async open() { this.opened = true; }
  addEventListener(t, f) { if (t === 'inputreport') this.listeners.add(f); }
  removeEventListener(t, f) { this.listeners.delete(f); }
  reply(arr) { const r = Uint8Array.from(arr); setTimeout(() => [...this.listeners].forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1); }
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    this.sent.push(b);
    if (id !== 0) this.bad.push(`report id ${id}`);
    if (b.length !== 64) this.bad.push(`length ${b.length}`);
    for (const n of NEVERS) if ((!n.pids || n.pids.includes(h4(this.m.pid))) && n.b.every((x, i) => b[i] === x)) this.bad.push(`never: ${n.what}`);
    const dongle = this.m.link === 'dongle', cmd = b[0];
    for (const p of SAVES) if (p.every((x, i) => b[i] === x)) this.bad.push(`a save: ${hx(b.slice(0, 2))}`);
    // a write-only setting's command (2 Nov 2026): the family's first bytes, | 0x40 through the receiver, which answers 64 bytes
    if (this.m.wo && (dongle ? (cmd & WIRELESS_FLAG) && WRITE_CMDS[this.m.wo].includes(cmd & ~WIRELESS_FLAG) : WRITE_CMDS[this.m.wo].includes(cmd))) {
      this.writes.push(b);
      if (dongle && !this.o.silent) this.reply([cmd, ...new Array(63).fill(0)]);
      return;
    }
    if (this.o.silent) return;
    if (this.m.named) { this.bad.push(`sent ${hx(b.slice(0, 3))} to a mouse no source documents a read for`); return; }
    if (this.m.battery === 'aa') {
      // rivalcfg rival3_wireless.py: AA 01 unchanged on the receiver, read 3: percent, ?, charging
      if (cmd === 0xaa && b[1] === 0x01) this.reply([this.o.aaLevel ?? 60, 0x00, this.o.charging ? 0x01 : 0x00]);
      else this.bad.push(`not the AA 01 read: ${hx(b.slice(0, 3))}`);
      return;
    }
    if (cmd === (dongle ? 0x92 | WIRELESS_FLAG : 0x92) && this.m.battery === true) {
      const v = (this.o.charging ? 0x80 : 0) | this.o.level;
      this.reply(dongle ? [cmd, v, ...new Array(62).fill(0)] : [cmd, v]);   // read 2 on the cable, 64 on the dongle
    } else if (cmd === 0x10 && b[1] === 0x00 && this.m.firmware && !dongle) this.reply(this.o.fw);
    else this.bad.push(`undocumented, write-only or wrong-link command ${hx(b.slice(0, 3))}`);
  }
}

let plugged = null;
setDeviceProvider(async (filters) => {
  const f = filters[0];
  if (!plugged || f.vendorId !== plugged.vendorId || f.productId !== plugged.productId) return null;
  if (f.usagePage != null && f.usagePage !== 0xffc0) return null;
  return plugged;
});

// ---- the entry ----
check(!problem(drv), `the driver passes the my-devices check (${problem(drv)})`);
check(!validateMeta(meta) && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0 && meta.id === drv.id && meta.vid === '1038' && meta.source === 'docs/brands/steelseries.md', `device.json: untested or read-only, tested [], id, vid, source (${validateMeta(meta)})`);
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify(MODELS.map((m) => h4(m.pid).toLowerCase()).sort()), 'device.json pids are the table\'s');
const IF0 = ['182E', '183C'];   // rivalcfg prime.py / rival5.py "endpoint": 0
// added 1 Nov 2026: the rest of rivalcfg's mice, every one "endpoint": 0 (rivalcfg/devices/*.py @ 779ea52)
const FW10 = [0x1702, 0x170a, 0x170b, 0x170c, 0x1814, 0x1384, 0x1392, 0x1710, 0x1712, 0x171c, 0x1394, 0x171a, 0x1716, 0x1714, 0x1718, 0x170e, 0x1700, 0x1730];
const AA650 = [0x172b, 0x1726];
const NAMED_NOV = [0x182a, 0x1856, 0x182c, 0x183e, 0x1724, 0x172e, 0x1729, 0x1816, 0x1810, 0x1706, 0x1707, 0x1704, 0x1708, 0x1369, 0x1362, 0x136d, 0x136f, 0x1380, 0x1390, 0x137a, 0x1366, 0x1378, 0x1720, 0x171e, 0x1736, 0x1722, 0x1832, 0x1834];
IF0.push(...[...FW10, ...AA650, ...NAMED_NOV].map(h4));
check(FW10.every((p) => MODELS.find((m) => m.pid === p)?.firmware === true) && AA650.every((p) => MODELS.find((m) => m.pid === p)?.battery === 'aa') && NAMED_NOV.every((p) => MODELS.find((m) => m.pid === p)?.named === true), 'the rivalcfg mice added 1 Nov 2026: firmware 10 00, Rival 650 AA 01, the rest named only');
check(JSON.stringify(drv.hid.pids.slice(0, 28)) === JSON.stringify(['183A', '1838', '187A', '1878', '1854', '1852', '185E', '185C', '1862', '1860', '185A', '1858', '1876', '1874', '1842', '1840', '1824', '184C', '184A', '1848', '1830', '1872', '1836', '1850', '1870', '182E', '184D', '183C']), 'the earlier models keep their order');
check(JSON.stringify(drv.hid.pids) === JSON.stringify(MODELS.map((m) => h4(m.pid))) && MODELS.every((m) => drv.hid.byPid[h4(m.pid)].iface === (IF0.includes(h4(m.pid)) ? 0 : 3) && drv.hid.byPid[h4(m.pid)].reportId === 0), 'one channel per pid, interface 3 (Prime, Rival 5: 0), report id 0');
check(drv.hid.byPid['1838'].page === 'FFC0' && drv.hid.byPid['1840'].page === '*' && drv.hid.byPid['1824'].page === '*', 'Aerox on FFC0, Prime Wireless and Rival 3 on any page (not in the sheet)');
check(['1830', '1836', '1850', '183C'].every((p) => drv.hid.byPid[p].page === 'FFC0') && ['1872', '1870', '182E', '184D', '184A', '1848'].every((p) => drv.hid.byPid[p].page === '*'), 'OpenRGB\'s FFC0 where it gives one (1830, 1836, 1850, 183C), any page elsewhere');
const NEW = [0x184a, 0x1848, 0x1830, 0x1872, 0x1836, 0x1850, 0x1870, 0x182e, 0x184d, 0x183c];
check(NEW.every((p) => MODELS.some((m) => m.pid === p)), 'the rivalcfg models added 23 Oct 2026 are in the table');
check(MODELS.filter((m) => m.named).map((m) => m.pid).sort().join() === [0x1836, 0x1850, 0x1870, 0x182e, 0x184d, 0x183c, ...NAMED_NOV].sort().join() && MODELS.filter((m) => m.named).every((m) => !m.battery && !m.firmware), 'the wired mice with no read are named only');
check(drv.settings.length === 0, 'no settings before a mouse connects (they are per model)');
const WO = { aerox: [0x183a, 0x1838, 0x187a, 0x1878, 0x1854, 0x1852, 0x185e, 0x185c, 0x1862, 0x1860, 0x185a, 0x1858, 0x1876, 0x1874], prime: [0x1842, 0x1840, 0x184a, 0x1848], rival3: [0x1824, 0x184c] };
check(MODELS.every((m) => (m.wo || null) === (Object.keys(WO).find((f) => WO[f].includes(m.pid)) || null)), 'write-only settings only on the Aerox Wireless, Prime (Mini) Wireless and Rival 3 (the rivalcfg profiles mapped)');
check(MODELS.every((m) => settingsFor(m).every((st) => st.writeOnly?.volatile === true && !problem({ ...drv, settings: settingsFor(m) }))), 'every setting is write-only and volatile, and passes the my-devices check');
check(!MODELS.some((m) => [0x1890].includes(m.pid)), 'the Aerox 3 Gen 2 (OpenRGB only, no rivalcfg profile) is left out');
check(String(VENDOR_APPS) === String(ARCTIS_APPS) && VENDOR_APPS.test('SteelSeriesGG.exe') && VENDOR_APPS.test('SteelSeriesEngine3.exe') && !VENDOR_APPS.test('steam.exe'), 'the GG names are the Arctis driver\'s');
for (const [b, p, c] of [[0x00, 0, false], [0x01, 0, false], [0x15, 100, false], [0x7f, 100, false], [0x8d, 60, true]]) {
  const r = parseBattery(b);
  check(r.percent === p && r.charging === c, `battery byte ${b.toString(16)} -> ${p}%${c ? ' charging' : ''} (${JSON.stringify(r)})`);
}

// ---- every model ----
for (const m of MODELS) {
  plugged = new SimMouse(m, { charging: m.link === 'cable' });
  check(await drv.connect() === true && drv.model === m, `${m.name} ${h4(m.pid)}: connects`);
  const v = await drv.read();
  check(JSON.stringify(v) === '{}', `${m.name}: read() has no values (no settings)`);
  const info = await drv.info();
  check(info.Model === `SteelSeries ${m.name}` && info['USB id'] === `1038:${h4(m.pid).toLowerCase()}`, `${m.name}: info ${JSON.stringify(info)}`);
  if (m.battery === 'aa') {
    const b = await drv.battery();
    check(b.percent === 60 && b.charging === (m.link === 'cable'), `${m.name}: AA battery ${JSON.stringify(b)}`);
    check(plugged.sent.length > 0 && plugged.sent.every((s) => s[0] === 0xaa && s[1] === 0x01), `${m.name}: battery asked as AA 01, never | 0x40 (${plugged.sent.map((s) => hx(s.slice(0, 2)))})`);
    check(/^60%/.test(info.Battery) && !info.Firmware, `${m.name}: info battery ${info.Battery}, no firmware read`);
    plugged.o.charging = true; plugged.o.aaLevel = 100;
    const c = await drv.battery();
    check(c.percent === 100 && c.charging === true, `${m.name}: AA 100%, charging (byte 2) ${JSON.stringify(c)}`);
    plugged.o.aaLevel = 0xff;
    check((await throws(() => drv.battery()))?.message?.includes('outside 0-100'), `${m.name}: a level over 100 is no reading`);
    plugged.o.aaLevel = 60; plugged.o.charging = m.link === 'cable';
  } else if (m.named) {
    check(await drv.battery() === null && !info.Battery && !info.Firmware && /names this mouse only/.test(info.Driver), `${m.name}: named only (${JSON.stringify(info)})`);
    check(plugged.sent.length === 0, `${m.name}: nothing sent at all`);
  } else if (m.battery) {
    const b = await drv.battery();
    check(b.percent === 60 && b.charging === (m.link === 'cable'), `${m.name} (${m.link}): battery ${JSON.stringify(b)}`);
    const want = m.link === 'dongle' ? 0xd2 : 0x92;
    check(plugged.sent.every((s) => s[0] === want) && plugged.sent.length > 0, `${m.name}: battery asked as ${want.toString(16)} (${plugged.sent.map((s) => hx(s.slice(0, 2)))})`);
    check(/^60%/.test(info.Battery), `${m.name}: info battery ${info.Battery}`);
  } else {
    check(await drv.battery() === null, `${m.name}: no battery read (not in the sheet's battery row)`);
    check(info.Firmware === '37.0 (raw bytes)' && plugged.sent.every((s) => s[0] === 0x10 && s[1] === 0x00), `${m.name}: firmware 10 00 (${info.Firmware})`);
  }
  const n = plugged.sent.length;
  for (const k of ['dpi', 'polling', 'sleep', 'dim', 'brightness', 'button', 'color', 'save', 'firmware']) {
    const e = await throws(() => drv.write(k, 1));
    check(e && !e.gone, `${m.name}: write ${k} refused (${e?.message})`);
  }
  app = 'SteelSeriesGG.exe';
  check(await throws(() => drv.write('dpi', 800)), `${m.name}: refused while GG runs`);
  const sc = await selfCheck(drv, drv.write.bind(drv), { backup: async () => true });
  check(sc.ran === false && /SteelSeriesGG/.test(sc.why), `${m.name}: the self-check waits while GG runs (${JSON.stringify(sc)})`);
  app = null;
  check(plugged.sent.length === n, `${m.name}: refused writes send nothing`);
  const raw = await drv.rawBackup();
  check(raw.pid === h4(m.pid).toLowerCase() && (m.battery ? raw.battery : raw.battery === null) !== undefined, `${m.name}: backup ${JSON.stringify(raw)}`);
  check(plugged.bad.length === 0, `${m.name}: nothing undocumented or on the never list was sent (${plugged.bad.join(', ')})`);
}
check(/write-only/.test((await throws(() => drv.write('dpi', 800)))?.message || '') && WRITE_ONLY.every((w) => w.cite && w.bytes), 'a write-only setting is named with its source');

// ---- the write-only settings (2 Nov 2026): rivalcfg's bytes exactly, | 0x40 through the receiver, never a save ----
const RED3 = { top: '#ff0000', middle: '#00ff00', bottom: '#0000ff' };
const WANT = {
  aerox: [['dpi', 1600, ['2d 01 00 12']], ['dpi', 400, ['2d 01 00 04']], ['pollingRate', 500, ['2b 01']], ['pollingRate', 125, ['2b 03']], ['sleepTimer', 1, ['29 60 ea 00']], ['sleepTimer', 20, ['29 80 4f 12']],
    ['dimTimer', 10, ['23 0f 01 00 00 10 27 00']], ['dimTimer', 1200, ['23 0f 01 00 00 80 4f 12']], ['colors', RED3, ['21 01 00 ff 00 00', '21 01 01 00 ff 00', '21 01 02 00 00 ff']]],
  prime: [['dpi', 3200, ['2d 01 00 26']], ['pollingRate', 1000, ['2b 00']], ['sleepTimer', 0, ['29 00 00 00']], ['color', '#ff0000', ['21 01 00 ff 00 00']]],
  rival3: [['dpi', 1600, ['0b 00 01 01 24']], ['dpi', 800, ['0b 00 01 01 12']], ['pollingRate', 500, ['04 00 02']], ['pollingRate', 1000, ['04 00 01']], ['lightEffect', 'breath', ['06 00 02']], ['lightEffect', 'steady', ['06 00 04']],
    ['colors', { top: '#ff0000', middle: '#ff0000', bottom: '#ff0000', logo: '#123456' }, ['05 00 01 ff 00 00 64', '05 00 02 ff 00 00 64', '05 00 03 ff 00 00 64', '05 00 04 12 34 56 64']]],
};
for (const m of MODELS.filter((x) => x.wo)) {
  plugged = new SimMouse(m);
  await drv.connect();
  const keys = drv.settings.map((x) => x.key).join();
  check(keys === (m.wo === 'rival3' ? 'dpi,pollingRate,colors,lightEffect' : m.wo === 'prime' ? 'dpi,pollingRate,sleepTimer,dimTimer,color' : 'dpi,pollingRate,sleepTimer,dimTimer,colors'), `${m.name}: its settings (${keys})`);
  for (const [k, v, bytes] of WANT[m.wo]) {
    plugged.writes = [];
    const r = await drv.write(k, v);
    const got = plugged.writes.map((w) => hx(w.slice(0, bytes[0].split(' ').length)));
    const want = bytes.map((b) => (m.link === 'dongle' ? hx([parseInt(b.slice(0, 2), 16) | 0x40]) + b.slice(2) : b));
    check(JSON.stringify(r) === JSON.stringify(v) && JSON.stringify(got) === JSON.stringify(want) && plugged.writes.every((w) => w.length === 64 && w.slice(bytes[0].split(' ').length).every((x) => x === 0)), `${m.name} ${h4(m.pid)}: ${k} ${JSON.stringify(v)} sends ${want.join(' | ')} (${got.join(' | ')})`);
  }
  // each setting's test value is one it takes, and encodes
  for (const st of drv.settings) check(encode(m, st.key, st.writeOnly.test).length > 0, `${m.name}: ${st.key} test value encodes`);
  for (const [k, v] of [['dpi', 1234], ['pollingRate', 2000], ['sleepTimer', 21], ['dimTimer', 7], ['color', 'red'], ['colors', { top: '#ff0000' }], ['lightEffect', 'strobe'], ['save', 1]]) {
    plugged.writes = [];
    check(await throws(() => drv.write(k, v)) && plugged.writes.length === 0, `${m.name}: ${k} ${JSON.stringify(v)} refused, nothing sent`);
  }
  check(plugged.bad.length === 0, `${m.name}: no save, nothing undocumented (${plugged.bad.join(', ')})`);
}
// no SteelSeries save bytes can leave the driver, whatever is asked: send() refuses them on every model
{
  const m = MODELS.find((x) => x.wo === 'aerox' && x.link === 'cable');
  plugged = new SimMouse(m); await drv.connect();
  for (const p of SAVES) {
    const e = await throws(() => drv.link.send(p));
    check(e && plugged.sent.every((s) => !SAVES.some((q) => q.every((b, i) => s[i] === b))), `send() refuses ${hx(p)} (${e?.message})`);
  }
  const d = MODELS.find((x) => x.wo === 'aerox' && x.link === 'dongle');
  plugged = new SimMouse(d); await drv.connect();
  check(await throws(() => drv.link.send([0x11, 0x00])) && plugged.sent.length === 0, 'the receiver: 11 00 (sent as 51 00) refused, nothing sent');
  check(SAVES.every((p) => !Object.values(WRITE_CMDS).flat().some((c) => c === p[0] || (c | 0x40) === p[0])), 'no write command starts like a save, on the cable or the receiver');
}

// ---- silence, nothing plugged, the self-check with no settings ----
plugged = new SimMouse(MODELS[1], { silent: true });
await drv.connect();
check((await throws(() => drv.battery()))?.message?.startsWith('no reply'), 'an asleep mouse: no reply, nothing parsed');
check(/no reply/.test((await drv.info()).Battery), 'info says no reply');
plugged = new SimMouse(MODELS[0]);
await drv.connect();
const sc = await selfCheck(drv, drv.write.bind(drv), { backup: async () => true, makerApp: async () => null });
check(sc.ran !== false && plugged.bad.length === 0 && plugged.sent.every((s) => s[0] === 0x92), `the self-check reads only and writes nothing (${JSON.stringify(sc)})`);
plugged = null;
check(await drv.connect() === false, 'nothing plugged: no connect');
check((await throws(() => drv.read()))?.gone === true, 'not connected: read is gone');

console.log(fails.length ? `sim-steelseries-mouse: FAILED (${fails.length}):\n- ${fails.join('\n- ')}` : `sim-steelseries-mouse (${MODELS.length} product ids): all good`);
process.exit(fails.length ? 1 : 0);
