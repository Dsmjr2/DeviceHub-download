// The Glorious library driver (device-library/glorious/device.mjs, READ ONLY) against simulated mice that answer as
// docs/brands/glorious.md documents: wired Model O / D (feature report 05 commands, report 04 config block, firmware
// V103 / V102) and the wireless Model O / O- / D / D- (65-byte feature reports, mxw's battery and firmware replies).
// Also a "stranger" on the same chip id (another brand's firmware) that must get nothing after the firmware read.
// Checks: only the documented requests, never an output report, never DFU (75); the firmware gate; no writes at all;
// stepping back while Glorious Core runs. Run: node tests/sim-glorious.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem, hidSpecs } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createGlorious, REQUESTS, PIDS, MODELS, VENDOR_APPS, default: shipped } = await import('../device-library/glorious/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/glorious/device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };

ok(!validateMeta(meta) && meta.id === shipped.id && meta.status === 'untested' && meta.tested.length === 0, 'device.json: well formed, same id, untested');
ok(JSON.stringify(meta.pids) === JSON.stringify(PIDS) && meta.vid === '258a', 'device.json lists exactly the driver\'s ids');
ok(!problem(shipped) && shipped.settings.length === 0, 'loads as a my-devices driver, with no settings at all');
const specs = hidSpecs(shipped);
ok(specs.length === PIDS.length && specs.every((s) => s.featureOnly === true), 'every channel opens feature-only (no output report can be sent)');
ok(specs.filter((s) => MODELS[s.pid].family === 'wireless').every((s) => s.iface === 2 && s.page === 'FFFF' && s.featureLen === 64), 'wireless channels: interface 2, page FFFF, 65-byte feature reports (mxw, OpenRGB)');

const NEVERS = NEVER.commands.filter((c) => c.bytes && [].concat(c.vid).includes('258A'));
ok(NEVERS.some((n) => n.reportId === 5 && n.bytes === '75'), 'DFU (75 on report 05) is on DeviceHub\'s never list');
const allowed = new Set(Object.values(REQUESTS).map((r) => `${r.reportId}: ${h(r.data)}`));

// ---- simulated mice ----
function wiredMouse(pid, { fw = MODELS[pid]?.firmware || 'V103', sensor = 0x06, rate = 0x24 } = {}) {
  let last = null;
  return {
    vendorId: 0x258a, productId: parseInt(pid, 16), opened: true, sets: [], bad: [], gets: 0,
    async sendFeatureReport(id, data) {
      const p = Uint8Array.from(data); const k = `${id}: ${h(p)}`;
      this.sets.push(k);
      if (!allowed.has(k)) this.bad.push(`not a documented request: ${k.slice(0, 20)}`);
      for (const n of NEVERS) if (n.reportId === id && p[0] === parseInt(n.bytes, 16)) this.bad.push(`never: ${n.what}`);
      last = { id, p };
    },
    async receiveFeatureReport(id, len) {
      this.gets++;
      if (id === 5 && last?.p[0] === 0x01) return new DataView(Uint8Array.from([0x05, 0x01, ...Buffer.from(fw.padEnd(4, '\0'))]).buffer);
      if (id === 4 && last?.p[0] === 0x11) { const b = new Uint8Array(len + 1); b[0] = 4; b[1] = 0x11; b[9] = sensor; b[10] = rate; b[0x30] = 7; return new DataView(b.buffer); }
      return new DataView(new Uint8Array(len + (id ? 1 : 0)).buffer);
    },
    async sendReport() { this.bad.push('an output report'); },
  };
}
function wirelessMouse(pid, { pct = 72, status = 0xa1, version = [1, 2, 3, 4], stranger = false } = {}) {
  let last = null;
  return {
    vendorId: 0x258a, productId: parseInt(pid, 16), opened: true, sets: [], bad: [], gets: 0, s: { pct, status },
    async sendFeatureReport(id, data) {
      const p = Uint8Array.from(data); const k = `${id}: ${h(p)}`;
      this.sets.push(k);
      if (!allowed.has(k)) this.bad.push(`not a documented request: ${h(p.slice(0, 8))}`);
      if (p.length !== 64) this.bad.push(`length ${p.length}`);
      last = p;
    },
    async receiveFeatureReport(id, len) {
      this.gets++;
      const r = new Uint8Array(len);
      if (stranger) { r[0] = 0x55; return new DataView(r.buffer); }   // another brand's firmware: answers something else
      r[0] = this.s.status; r[5] = last[5];                             // [1] status, [6] echo (no report id: [n] = r[n - 1])
      if (last[5] === 0x81) r.set(version, 6);                          // [7]-[10] version
      if (last[5] === 0x83) r[7] = this.s.pct;                           // [8] percent
      return new DataView(r.buffer);
    },
    async sendReport() { this.bad.push('an output report'); },
  };
}
const make = (devices, app = { name: null }) => {
  let t = 0;
  return { d: createGlorious({ open: async (pid) => devices.find((x) => x.productId === parseInt(pid, 16)) || null, vendorApp: async () => app.name, sleep: async () => {}, now: () => t }), app, tick: (ms) => { t += ms; } };
};

// 1. wired Model O (V103): firmware, sensor, polling; no writes
{
  const m = wiredMouse('0036');
  const { d, app, tick } = make([m]);
  ok(await d.connect(), 'Model O (wired) connects');
  const i = await d.info();
  ok(i.Firmware === 'V103' && i.Sensor === 'PMW3360' && /^1000 Hz/.test(i['Polling rate']) && !i.Note, `info (${JSON.stringify(i)})`);
  ok(m.sets[0] === `5: ${h([0x01, 0, 0, 0, 0])}` && m.sets[1] === `5: ${h([0x11, 0, 0, 0, 0])}`, `firmware read first, then the config read (${m.sets})`);
  ok(JSON.stringify(await d.read()) === '{}' && (await d.battery()) === null, 'no settings, no battery on the wired mouse');
  const n = m.sets.length;
  for (const [k, v] of [['dpi', 800], ['pollingRate', 1000], ['liftOff', 2], ['debounce', 4], ['lights', 1]]) ok(!(await attempt(() => d.write(k, v))).ok, `refuses writing ${k}`);
  ok(m.sets.length === n, 'nothing sent for a write');
  app.name = 'GloriousCore.exe'; tick(20000);
  const d2 = make([wiredMouse('0033')], app).d; await d2.connect();
  ok(!(await attempt(() => d2.info())).ok, 'refuses to read while Glorious Core runs');
  ok(VENDOR_APPS.some((re) => re.test('Glorious Core.exe')), 'the step-back pattern catches Glorious Core');
  ok(m.bad.length === 0, `only documented requests (${m.bad.join('; ')})`);
}

// 2. a stranger on the Model O's id (another brand's firmware): ONE firmware read, then nothing, ever
{
  const m = wiredMouse('0036', { fw: 'RD21' });
  const { d } = make([m]);
  await d.connect();
  const r = await attempt(() => d.info());
  ok(!r.ok && /not V103/.test(r.e), `a wrong firmware is refused (${r.e})`);
  for (const fn of [() => d.read(), () => d.info(), () => d.rawBackup(), () => d.write('dpi', 800)]) await attempt(fn);
  ok(m.sets.length === 1 && m.sets[0].startsWith('5: 01'), `only the firmware read reached it (${m.sets.length} sent)`);
  ok(m.bad.length === 0, `nothing undocumented (${m.bad.join('; ')})`);
  // a Model D firmware on the Model O id is refused too (the id and the firmware must BOTH match)
  const m2 = wiredMouse('0036', { fw: 'V102' }); const d2 = make([m2]).d; await d2.connect();
  ok(!(await attempt(() => d2.info())).ok && m2.sets.length === 1, 'a Model D firmware on the Model O id is refused');
}

// 3. wireless dongle: firmware check, battery; asleep; cable sends [3]=02
{
  const m = wirelessMouse('2022');
  const { d, tick } = make([m]);
  ok(await d.connect(), 'Model O Wireless (dongle) connects');
  const i = await d.info();
  ok(i.Firmware === '1.2.3.4' && i.Connection === 'wireless (dongle)', `info (${JSON.stringify(i)})`);
  ok(JSON.stringify(await d.battery()) === JSON.stringify({ percent: 72, charging: false }), 'battery 72%');
  m.s.pct = 0;
  ok((await d.battery()).percent === 1, 'a 0% reply is shown as 1% (mxw)');
  m.s.status = 0xa4;
  const a = await attempt(() => d.battery());
  ok(!a.ok && /asleep/.test(a.e), `asleep (A4) is said plainly (${a.e})`);
  ok(m.sets[0] === `0: ${h(REQUESTS.firmwareDongle.data)}` && m.sets.slice(1).every((x) => x === `0: ${h(REQUESTS.battery.data)}`), 'dongle: the firmware read without [3]=02, then only battery reads');
  ok(!(await attempt(() => d.write('sleep', 60))).ok, 'refuses a write');
  ok(m.bad.length === 0, `only documented requests (${m.bad.join('; ')})`);
  const c = wirelessMouse('2013'); const dc = make([c]).d; await dc.connect(); await dc.info();
  ok(c.sets[0] === `0: ${h(REQUESTS.firmwareCable.data)}` && REQUESTS.firmwareCable.data[2] === 0x02, 'cable: the firmware read carries [3]=02 (mxw: cable only)');
  void tick;
}

// 4. a wireless stranger (no 81 echo): refused after one read; every model's id is matched exactly
{
  const m = wirelessMouse('2023', { stranger: true });
  const { d } = make([m]);
  await d.connect();
  ok(!(await attempt(() => d.battery())).ok && !(await attempt(() => d.info())).ok, 'a wireless id that does not answer as mxw documents is refused');
  ok(m.sets.length === 1, `only the firmware read reached it (${m.sets.length})`);
  const v0 = wirelessMouse('2024', { version: [0, 0, 0, 0] }); const dv = make([v0]).d; await dv.connect();
  ok(!(await attempt(() => dv.info())).ok, 'an all-zero version is not believed');
  ok(!(await make([wiredMouse('0029')]).d.connect()) && !(await make([wirelessMouse('1007')]).d.connect()), 'other 258A ids (Everest GT-100 0029, ZET / Genesis 1007) are never opened');
}

console.log(fails ? `sim-glorious: ${fails} FAILED` : 'sim-glorious (Glorious Model O / D, read only, exact id + firmware gate): all good');
process.exitCode = fails ? 1 : 0;
