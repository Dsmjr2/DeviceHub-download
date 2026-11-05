// A laptop's NVIDIA card asleep (D3) is shown as idle and never woken by nvidia-smi (helpers/gpu.js asleep, the helper's
// gpu-power read in helpers/pc-reads.cs; 3 Nov 2026). Run: node tests/gpu-idle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { _test: { asleep } } = require('../helpers/gpu.js');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const nv = (d) => ({ name: 'NVIDIA GeForce RTX 4060 Laptop GPU', id: 'PCI\\VEN_10DE&DEV_28A0', d });
const amd = { name: 'AMD Radeon(TM) Graphics', id: 'PCI\\VEN_1002&DEV_15BF', d: 0 };
ok((await asleep(async () => ({ result: [amd, nv(3)] })))?.length === 1, 'the NVIDIA card in D3: asleep (the AMD one beside it does not count)');
ok((await asleep(async () => ({ result: [amd, nv(0)] }))) === null, 'in D0: awake, nvidia-smi reads it');
ok((await asleep(async () => ({ result: [amd] }))) === null, 'no NVIDIA card: not "asleep"');
ok((await asleep(async () => ({ fail: 'the helper is not running' }))) === null, 'no answer from the helper: nvidia-smi as before');
ok((await asleep(async () => { throw new Error('x'); })) === null, 'an error: nvidia-smi as before');
const cs = fs.readFileSync(path.join(ROOT, 'helpers/pc-reads.cs'), 'utf8');
ok(/case "gpu-power": o\["result"\] = GpuPower\(\);/.test(cs) && /a45c254e-df1c-4efd-8020-67d146a850e0", 32/.test(cs), 'the helper reads DEVPKEY_Device_PowerData from Windows, never the card');
const page = fs.readFileSync(path.join(ROOT, 'public/pages/fans.js'), 'utf8');
ok(/tempText: g\.idle \? 'idle' : null/.test(page), 'the card says idle');

if (fails.length) { console.log(`gpu-idle: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('gpu-idle (a sleeping laptop graphics card shows idle and is never woken to read it): all good');
