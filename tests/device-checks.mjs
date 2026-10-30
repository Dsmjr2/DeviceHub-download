// "Check your devices" on the Setup page (public/ui/device-checks.js): the polling rate test for every mouse (asleep too:
// moving it wakes it), Test it with me for every library driver whose settings are on; nothing for anything else, and
// nothing starts without its own button. Run: node tests/device-checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksFor } from '../public/ui/device-checks.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const dev = (id, kind, status, extra = {}) => ({ id, status, values: {}, adapter: { id, title: `T ${id}`, kind, settings: [{ key: 'x', type: 'slider' }], ...extra } });
const list = [
  dev('mouse', 'Mouse', 'asleep'),
  dev('legion', 'Keyboard', 'connected', { library: { turnOn: false, learned: false } }),
  dev('legion-off', 'Keyboard', 'connected', { library: { turnOn: true } }),
  dev('glide', 'Mouse', 'connected', { library: { turnOn: false, learned: false } }),
  dev('gone', 'Mouse', 'missing'),
  dev('headset', 'Headset', 'connected'),
];
const c = checksFor(list).map((x) => `${x.id}:${x.kind}`).join(' ');
ok(c === 'mouse:polling legion:guided glide:guided glide:polling', `the checks (${c})`);
const setup = fs.readFileSync(path.join(REAL, 'public/pages/setup.js'), 'utf8');
ok(/deviceChecks\(\{ redraw \}\),/.test(setup), 'the Setup page shows it');
const ui = fs.readFileSync(path.join(REAL, 'public/ui/device-checks.js'), 'utf8').replace(/\/\/.*$/gm, '');
ok(/pollingTest\(pollHzOf\(d\), card, c\.id,/.test(ui) && /guidedTest\(d, \{ after: \(\) => worksReport\(d, \{ invite: true \}\), redraw \}\)/.test(ui) && !/start\(|tryIt\(|fetch\(/.test(ui), 'the same cards as the device pages; nothing starts by itself');
if (fails.length) { console.log(`device-checks: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('device-checks (Setup: polling for every mouse, Test it with me for turned-on library drivers): all good');
