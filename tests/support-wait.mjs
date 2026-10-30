// "Your device is supported now" (helpers/support-wait.mjs): a device the person asked support for is remembered, offered
// on the Overview once a library entry covers it, never once it is installed, and forgotten on Not now. Nothing installs
// by itself. Run: node tests/support-wait.mjs (no hardware, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remember, arrived, forget, read, handle, options, MAX } from '../helpers/support-wait.mjs';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-wait-'));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
try {
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
  Object.assign(options, { root, now: () => new Date('2026-10-29T12:00:00Z') });
  ok(arrived().length === 0 && JSON.stringify(read().items) === '{}', 'nothing asked: nothing to say');
  ok(remember('1038', '2269', 'Arctis Nova 3P Wireless') && remember('0x7777', '0101', 'Acme Glide') && !remember('zz', '1', 'bad'), 'ids kept as 4 hex digits; a bad id is refused');
  ok(arrived().length === 0, 'no library entry for them yet: nothing');

  const META = { id: 'acme-glide', vendor: 'Acme', product: 'Glide', kind: 'Mouse', vid: '7777', pids: ['0101'], models: ['Acme Glide'], works: ['DPI'], status: 'untested', tested: [] };
  put('device-library/acme-glide/device.json', JSON.stringify(META));
  put('device-library/acme-glide/device.mjs', 'export default { id: "acme-glide" };');
  let a = arrived();
  ok(a.length === 1 && a[0].id === '7777:0101' && a[0].name === 'Acme Glide' && a[0].entry === 'acme-glide' && a[0].status === 'untested', `a driver arrives for the asked device (${JSON.stringify(a)})`);
  // a library update (library-cache) counts the same
  put('library-cache/steelseries-nova/device.json', JSON.stringify({ ...META, id: 'steelseries-nova', vendor: 'SteelSeries', product: 'Arctis Nova 3P', vid: '1038', pids: ['2269'], models: ['Arctis Nova 3P Wireless'] }));
  put('library-cache/steelseries-nova/device.mjs', 'export default { id: "steelseries-nova" };');
  a = arrived();
  ok(a.length === 2 && a.some((x) => x.id === '1038:2269' && x.entry === 'steelseries-nova'), `one from a library update too (${a.map((x) => x.id)})`);
  put('my-devices/acme-glide/library.json', '{}');
  ok(arrived().length === 1 && arrived()[0].id === '1038:2269', 'an installed driver is never offered again');
  ok(forget('1038:2269') && arrived().length === 0 && !forget('1038:2269'), 'Not now forgets it, once');

  for (let i = 0; i < MAX + 5; i++) { options.now = () => new Date(Date.UTC(2026, 9, 29, 0, i)); remember('abcd', i.toString(16).padStart(4, '0'), `x${i}`); }
  const items = Object.keys(read().items);
  ok(items.length === MAX && items.includes('abcd:002c') && !items.includes('abcd:0000'), `at most ${MAX} kept, the newest (${items.length})`);

  // the routes
  const sent = [];
  const res = {}, sendFn = (r, code, body) => sent.push({ code, body });
  const url = (p) => new URL(`http://127.0.0.1${p}`);
  ok(await handle(url('/api/help/supported-now'), { method: 'GET' }, res, sendFn, async () => ({})) && sent[0].code === 200 && Array.isArray(sent[0].body.arrived), 'GET answers the list');
  remember('1038', '2269', 'Nova');
  ok(await handle(url('/api/help/supported-now/forget'), { method: 'POST' }, res, sendFn, async () => ({ id: '1038:2269' })) && sent[1].body.ok === true && !('1038:2269' in read().items), 'POST forget drops it');
  ok(!(await handle(url('/api/help/other'), { method: 'GET' }, res, sendFn, async () => ({}))), 'other routes are not answered here');

  // wiring: the request routes remember, the Overview offers Install on a click only
  const gh = fs.readFileSync(path.join(REAL, 'helpers/get-help.mjs'), 'utf8');
  ok(/if \(r\?\.ok\) await wanted\(q\)/.test(gh) && /if \(r\.sent \|\| r\.queued\) await wanted\(b\)/.test(gh) && /support-wait\.mjs'\)\)\.handle\(/.test(gh), 'Request support remembers the device; the routes are wired');
  const ov = fs.readFileSync(path.join(REAL, 'public/pages/overview.js'), 'utf8');
  ok(/supportedNow\(redraw, fresh\)/.test(ov) && /button\('Install', install/.test(ov) && /\/api\/library\/install/.test(ov) && /button\('Not now', notNow/.test(ov), 'the Overview line: Install on a click, Not now');
  const src = fs.readFileSync(path.join(REAL, 'helpers/support-wait.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/installFromLibrary|fetch\(|child_process/.test(src), 'the helper itself never installs or sends anything');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

if (fails.length) { console.log(`support-wait: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('support-wait (asked devices remembered, offered once a driver arrives, never installed by itself): all good');
