// The HyperX mice and keyboards library driver (device-library/hyperx-peripherals/device.mjs, info only) against
// simulated devices. It must name each model from its product id, open every channel with no access (featureOnly, on
// the interface and usage page OpenRGB names), send nothing at all (no output, no feature report), refuse every write,
// and never take the Cloud headsets' ids (device-library/hyperx-cloud has them). Run: node tests/sim-hyperx-peripherals.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem, hidSpecs } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
let tag = '';
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${tag}${m}`); } };
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
const specs0 = (d) => hidSpecs(d);
async function entry(folder, vid, headsets) {
const { createHyperXPeripherals, MODELS, PIDS, VENDOR_APPS, default: shipped } = await import(`../device-library/${folder}/device.mjs`);
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, `device-library/${folder}/device.json`), 'utf8'));
const cloud = JSON.parse(fs.readFileSync(path.join(ROOT, `device-library/${headsets}/device.json`), 'utf8'));
const VID = vid.toUpperCase();


ok(!validateMeta(meta) && meta.id === shipped.id && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0, 'device.json: well formed, same id, untested or read-only');
ok(JSON.stringify(meta.pids) === JSON.stringify(PIDS.map((p) => p.toLowerCase())) && meta.vid === vid && specs0(shipped).every((s) => s.vid.toUpperCase() === VID), 'device.json lists exactly the driver\'s ids');
ok(!PIDS.some((p) => cloud.pids.includes(p.toLowerCase())), 'no id overlaps the Cloud headset driver\'s');
ok(!problem(shipped) && shipped.settings.length === 0, 'loads as a my-devices driver with no settings');
const specs = hidSpecs(shipped);
ok(specs.length === PIDS.length && specs.every((s) => s.featureOnly === true && Number.isInteger(s.iface)), 'every channel: no access (featureOnly), on its interface');
ok(specs.every((s) => s.page === MODELS[s.pid].page), 'each channel on the usage page OpenRGB names (or any, on its interface, when none is named)');

// a simulated device that records anything sent to it
const device = (pid) => ({ vendorId: parseInt(vid, 16), productId: parseInt(pid, 16), opened: true, sent: [],
  async sendReport(id, d) { this.sent.push(`out ${id}`); }, async sendFeatureReport(id, d) { this.sent.push(`set ${id}`); },
  async receiveFeatureReport(id) { this.sent.push(`get ${id}`); return new DataView(new ArrayBuffer(1)); }, async receiveReports() { this.sent.push('read'); return []; } });

for (const pid of PIDS) {
  const dev = device(pid);
  const opened = [];
  const d = createHyperXPeripherals({ open: async (p, m) => { opened.push({ p, m }); return p === pid ? dev : null; } });
  ok(await d.connect(), `${pid}: connects`);
  const i = await d.info();
  ok(i.Model === `HyperX ${MODELS[pid].name}` && i.Type === MODELS[pid].kind && i['Product id'] === `${VID}:${pid}`, `${pid}: info (${JSON.stringify(i)})`);
  ok(JSON.stringify(await d.read()) === '{}' && (await d.battery()) === null, `${pid}: no settings, no battery`);
  for (const [k, v] of [['dpi', 800], ['pollingRate', 1000], ['lights', 1], ['brightness', 50]]) ok(!(await attempt(() => d.write(k, v))).ok, `${pid}: refuses writing ${k}`);
  await d.rawBackup();
  ok(dev.sent.length === 0, `${pid}: nothing was ever sent (${dev.sent})`);
}
{
  if (MODELS['068E']) {
    const dart = createHyperXPeripherals({ open: async (p) => (p === '068E' ? device(p) : null) });
    await dart.connect();
    ok((await dart.info()).Connection === 'wireless (dongle)', 'the Dart dongle says wireless');
  }
  ok(!(await createHyperXPeripherals({ open: async () => null }).connect()), 'nothing plugged in: no connect');
  ok(!(await attempt(() => createHyperXPeripherals({ open: async () => null }).info())).ok, 'info before connect is refused');
  ok(VENDOR_APPS.some((re) => re.test('NGENUITY.exe')), 'NGENUITY is named');
}
}

tag = 'hyperx-peripherals: '; await entry('hyperx-peripherals', '03f0', 'hyperx-cloud');
tag = 'hyperx-kingston-peripherals: '; await entry('hyperx-kingston-peripherals', '0951', 'hyperx-kingston');
{
  // (JS orders integer-like keys 1727 and 1734 first.) The Kingston entry has exactly the ids and interfaces OpenRGB's Windows detectors name, and nothing of the HP entry's
  const { MODELS: KM } = await import('../device-library/hyperx-kingston-peripherals/device.mjs');
  const { MODELS: HM } = await import('../device-library/hyperx-peripherals/device.mjs');
  tag = '';
  ok(JSON.stringify(Object.entries(KM).map(([p, m]) => `${p}:${m.iface}:${m.page}`)) === JSON.stringify(['1727:3:FF90', '1734:3:*', '16E5:3:*', '16E6:2:*']), 'Kingston ids, interfaces and pages as OpenRGB names them');
  ok(!Object.keys(KM).some((p) => p in HM), 'no product id in both peripheral entries');
}
console.log(fails ? `sim-hyperx-peripherals: ${fails} FAILED` : 'sim-hyperx-peripherals (HyperX mice and keyboards, 03F0 and 0951 ids, info only, nothing sent): all good');
process.exitCode = fails ? 1 : 0;
