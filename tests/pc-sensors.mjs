import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pcs = require('../helpers/pc-sensors.js');
const { decide, zoneTemp, cpuCard, nodeCpu, askSession } = pcs._test;

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// zoneTemp: decikelvin to Celsius
check(zoneTemp({ tenthsK: 3181 }) === 45, 'zoneTemp converts decikelvin to Celsius');
check(zoneTemp({}) === null && zoneTemp({ tenthsK: 0 }) === null && zoneTemp(null) === null, 'zoneTemp returns null for missing/zero decikelvin');

// decide: NVIDIA + Windows KMT deduplication and notReadable reasons
const d1 = decide({
  nvidia: { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 52.4, fanPct: 35 }] },
  kmt: [{ name: '  nvidia   geforce rtx 4070 ', tempC: 53 }, { name: 'AMD Radeon(TM) Graphics', tempC: 41.2 }],
  zones: [{ name: 'TZ00', tenthsK: 3151 }],
  lhm: { setUp: false },
  pawnio: false,
});
check(d1.readings.filter((r) => r.kind === 'gpu').length === 2, 'decide deduplicates matching NVIDIA/KMT GPU');
check(d1.readings.some((r) => r.kind === 'zone' && r.tempC === 42), 'decide includes valid ACPI zone when LHM is not ok');
check(d1.notReadable.some((n) => n.what === 'CPU temperature') && d1.notReadable.some((n) => n.what === 'CPU and case fan speeds'), 'decide explains missing CPU/fan sensors when LHM not set up');

// decide: LHM suppresses ACPI zones and reports ok readings
const d2 = decide({
  zones: [{ name: 'TZ00', tenthsK: 3151 }],
  lhm: { setUp: true, state: 'ok', cpu: [{ packageC: 48, coresMaxC: 51 }], fans: [{ name: 'CPU Fan', rpm: 1100 }], boardTemps: [{ name: 'VRM', tempC: 44 }] },
});
check(!d2.readings.some((r) => r.kind === 'zone'), 'decide hides ACPI zones when LHM is ok');
check(d2.readings.some((r) => r.name === 'CPU package' && r.tempC === 48), 'decide includes LHM CPU package');
check(d2.readings.some((r) => r.name === 'Board: VRM' && r.tempC === 44), 'decide includes LHM board temps');

// cpuCard: priority and fallback
const c1 = cpuCard({ name: 'Ryzen 7', loadPct: 20, clockMHz: 4200 }, null, [{ tenthsK: 3201 }], { cpuC: 61, cpuFanRpm: 1500 });
check(c1.tempC === 61 && c1.tempSource === 'Laptop sensor (Acer)' && c1.fanRpm === 1500 && c1.sensors, 'cpuCard falls back to Acer sensor and fan');
const c2 = cpuCard({ name: 'Ryzen 7', loadPct: 10 }, null, [{ tenthsK: 3201 }], null);
check(c2.tempC === 47 && c2.tempSource === 'Laptop sensor (approximate)' && !c2.sensors, 'cpuCard falls back to ACPI zone when neither LHM nor Acer has CPU temp');

// nodeCpu: injected sampling
let tick = 1000;
let idx = 0;
const samples = [{ busy: 100, all: 1000 }, { busy: 150, all: 1200 }];
const nc1 = await nodeCpu({
  cpus: () => [{ model: '  Test CPU  ' }],
  sample: () => samples[idx++],
  wait: async () => { tick += 250; },
  now: () => tick,
});
check(nc1?.name === 'Test CPU' && nc1?.loadPct === 25, 'nodeCpu computes loadPct from injected samples');
const ncEmpty = await nodeCpu({ cpus: () => [] });
check(ncEmpty === null, 'nodeCpu returns null when cpus() is empty');

// askSession: synchronous stdin.write failure resolves null immediately without leaving dangling timer
const t0 = Date.now();
const sErr = await askSession(5000, { getSession: () => ({ stdin: { write() { throw new Error('EPIPE'); } } }) });
check(sErr === null && Date.now() - t0 < 1000, 'askSession resolves null promptly when stdin.write throws');
check(zoneTemp({ tenthsK: 'bad' }) === null && (await askSession(100, { getSession: () => null })) === null, 'zoneTemp rejects non-finite input and askSession handles null session');
check(cpuCard({ name: 'Ryzen 7' }, { setUp: true, state: 'ok', fans: [null, { rpm: 1000 }] })?.fanCount === 0, 'cpuCard ignores malformed fan entries');
pcs.stop();

if (fails.length) {
  console.error('FAIL:', fails.join('; '));
  process.exit(1);
}
console.log('pc-sensors: 10 checks passed');
