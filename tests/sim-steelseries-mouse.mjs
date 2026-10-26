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
const { default: drv, MODELS, WRITE_ONLY, VENDOR_APPS, parseBattery, WIRELESS_FLAG } = await import('../device-library/steelseries-mouse/device.mjs');
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
    this.m = m; this.listeners = new Set(); this.sent = []; this.bad = [];
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
check(JSON.stringify(drv.hid.pids) === JSON.stringify(MODELS.map((m) => h4(m.pid))) && MODELS.every((m) => drv.hid.byPid[h4(m.pid)].iface === (IF0.includes(h4(m.pid)) ? 0 : 3) && drv.hid.byPid[h4(m.pid)].reportId === 0), 'one channel per pid, interface 3 (Prime, Rival 5: 0), report id 0');
check(drv.hid.byPid['1838'].page === 'FFC0' && drv.hid.byPid['1840'].page === '*' && drv.hid.byPid['1824'].page === '*', 'Aerox on FFC0, Prime Wireless and Rival 3 on any page (not in the sheet)');
check(['1830', '1836', '1850', '183C'].every((p) => drv.hid.byPid[p].page === 'FFC0') && ['1872', '1870', '182E', '184D', '184A', '1848'].every((p) => drv.hid.byPid[p].page === '*'), 'OpenRGB\'s FFC0 where it gives one (1830, 1836, 1850, 183C), any page elsewhere');
const NEW = [0x184a, 0x1848, 0x1830, 0x1872, 0x1836, 0x1850, 0x1870, 0x182e, 0x184d, 0x183c];
check(NEW.every((p) => MODELS.some((m) => m.pid === p)), 'the rivalcfg models added 23 Oct 2026 are in the table');
check(MODELS.filter((m) => m.named).map((m) => m.pid).sort().join() === [0x1836, 0x1850, 0x1870, 0x182e, 0x184d, 0x183c].sort().join() && MODELS.filter((m) => m.named).every((m) => !m.battery && !m.firmware), 'the wired mice with no read are named only');
check(drv.settings.length === 0, 'no settings: every documented mouse setting is write-only');
check(!MODELS.some((m) => [0x1890, 0x1724, 0x172e].includes(m.pid)), 'mice without a documented id or read are left out');
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
