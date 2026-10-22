// Supported devices (22 Oct 2026; helpers/supported-devices.mjs, docs/handoff/supported-devices.md): the plain-words
// list of what DeviceHub runs. Checks the words for what a driver reads and changes, its status, the short model list,
// the grouping, the route, that a pretend library's driver is loaded but never connected, read or written, and that
// every entry of the real library gets a row. No hardware, no network; pretend files in TEMP only.
// Run: node tests/supported-devices.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, shortModels, groupOf, statusOf, supported, handle, termsIn, BUILT_IN } from '../helpers/supported-devices.mjs';
import { list } from '../helpers/device-library.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const same = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);

// 1. the words
same(termsIn('battery level and charging (read)'), ['battery', 'charging'], 'battery and charging');
same(termsIn('low-battery threshold (raw)'), ['low-battery warning'], 'low-battery is not battery');
same(termsIn('DPI stages 1-4 in steps of 50'), ['DPI stages'], 'DPI stages alone');
same(termsIn('firmware updates (never)'), [], 'firmware updates is not a reading');
same(termsIn('ChatMix: game'), ['ChatMix'], 'ChatMix');

// 2. reads and changes from device.json "works" phrases
const meta = (over = {}) => ({ vendor: 'Acme', kind: 'Headset', models: ['Acme One (USB)', 'Two', 'Three', 'Four'], status: 'read-only', tested: [], works: [], ...over });
let r = describe(meta({ works: ['Model One: battery %, charging, sidetone on/off, mic mute (read); sidetone on/off, mic mute (write with read-back)'] }));
same(r.changes, ['sidetone', 'mic mute'], 'a write phrase makes a change');
same(r.reads, ['battery', 'charging'], 'what it changes is not listed again under reads');
r = describe(meta({ works: ['reads: firmware, DPI, polling rate', 'never writes anything'] }));
same(r.changes, [], 'a driver that never writes changes nothing');
same(r.reads, ['DPI', 'polling rate', 'firmware version'], 'its readings, in the usual order');
r = describe(meta({ works: ['writes (one at a time, read back; refused while the app runs): debounce, sleep 60-14400 s'] }));
same(r.changes, ['sleep timer', 'debounce'], 'a semicolon inside brackets does not split a phrase');

// 3. reads and changes from the driver's own settings
r = describe(meta(), [
  { key: 'a', label: 'Sidetone', type: 'slider' },
  { key: 'b', label: 'ChatMix: game', type: 'display' },
  { key: 'c', label: 'Silent mode', type: 'toggle', hint: 'shown only (no change yet).' },
  { key: 'd', label: 'Wheel color', type: 'color' },
]);
same(r.changes, ['sidetone', 'wheel color'], 'settings: sliders and colors change; an unknown label is kept in plain words');
same(r.reads, ['silent mode', 'ChatMix'], 'settings: a display and a shown-only setting are readings');

// 4. status words
same(statusOf({ status: 'untested', tested: [] }).key, 'untried', 'untested: not tried on a real device yet');
same(statusOf({ status: 'read-only', tested: [] }).key, 'reads', 'read-only: reads now');
ok(/Turn on settings/.test(statusOf({ status: 'tested', tested: [{ by: 'DeviceHub (simulation only)', date: 'x', devicehub: '0' }] }).line), 'tested only in a simulation: settings after Turn on settings');
same(statusOf({ status: 'tested', tested: [{ by: 'Sam', date: '2026-10-22', devicehub: '0.1.0', how: 'each setting written once and read back' }] }).key, 'works', 'tested on a real device: works out of the box');
same(statusOf({ status: 'read-only', tested: [] }, { changes: 0 }).line, 'Reads the device by itself.', 'nothing to change: no Turn on settings');
same(statusOf({ builtIn: true }).key, 'works', 'DeviceHub\'s own drivers work out of the box');

// 5. short models and groups
same(shortModels(['HyperX Cloud II Wireless', 'HyperX Cloud III (maybe)', 'Alpha'], 2, 'HyperX'), { short: 'Cloud II Wireless, Cloud III and 1 more', all: ['Cloud II Wireless', 'Cloud III', 'Alpha'], more: 1 }, 'short models');
same(['Mouse', 'Keyboard', 'Mouse or keyboard', 'Headset', 'Light'].map(groupOf), ['mouse', 'keyboard', 'mouse-keyboard', 'headset', 'other'], 'groups by kind');

// 6. a pretend library: loaded, never connected, read or written; a broken driver still gets its row from device.json
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-supported-'));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const dev = (id, kind) => JSON.stringify({ id, vendor: 'Acme', product: 'Pretend', kind, vid: 'ffff', pids: ['ff01'], models: ['Acme Glide'], works: ['battery (read)'], status: 'untested', tested: [] });
put('device-library/acme-mouse/device.json', dev('acme-mouse', 'Mouse'));
put('device-library/acme-mouse/device.mjs', `globalThis.__touched = [];
export default { id: 'acme-mouse', title: 'Acme mouse', kind: 'Mouse',
  settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }],
  async connect() { globalThis.__touched.push('connect'); return true; }, async info() { globalThis.__touched.push('info'); return {}; },
  async read() { globalThis.__touched.push('read'); return {}; }, async write() { globalThis.__touched.push('write'); } };\n`);
put('device-library/acme-broken/device.json', dev('acme-broken', 'Keyboard'));
put('device-library/acme-broken/device.mjs', 'export default {;\n');
const before = fs.readdirSync(root, { recursive: true }).sort().join('|');
const v = await supported({ root });
same(globalThis.__touched, [], 'the driver was loaded but nothing was called on it');
const rows = v.groups.flatMap((g) => g.rows);
const mouse = rows.find((x) => x.name === 'acme-mouse'), broken = rows.find((x) => x.name === 'acme-broken');
ok(mouse && mouse.changes.includes('DPI') && mouse.reads.includes('battery'), 'the pretend mouse reads its battery and changes DPI');
ok(broken && broken.reads.includes('battery') && broken.kind === 'keyboard', 'a driver that does not load still has its row');
same(v.groups.map((g) => g.title), ['Mice', 'Keyboards', 'Headsets'], 'groups in order, empty ones left out');
same(v.count, BUILT_IN.length + 2, 'the built-in three and the two pretend entries');
same(fs.readdirSync(root, { recursive: true }).sort().join('|'), before, 'nothing written in the library folder');

// 7. the route
const call = async (pathname, method = 'GET') => { const out = {}; out.handled = await handle(new URL(`http://127.0.0.1:5577${pathname}`), { method }, {}, (res, code, body) => { out.code = code; out.body = body; }); return out; };
let c = await call('/api/supported-devices');
ok(c.handled && c.code === 200 && Array.isArray(c.body?.groups), 'GET /api/supported-devices answers the list');
c = await call('/api/supported-devices', 'POST');
ok(c.handled && c.code === 405, 'POST is refused');
c = await call('/api/library');
ok(c.handled === false, 'other routes are left alone');

// 8. the real library: every entry has a row with a status and something in plain words
const real = await supported();
const names = new Set(real.groups.flatMap((g) => g.rows).map((x) => x.name));
for (const e of list().filter((x) => !x.error)) ok(names.has(e.name), `the library entry ${e.name} has a row`);
for (const x of real.groups.flatMap((g) => g.rows)) {
  ok(['works', 'reads', 'untried'].includes(x.status.key), `${x.name}: a status`);
  ok(x.models.short && x.brand, `${x.name}: a brand and models`);
  ok(x.reads.length + x.changes.length > 0, `${x.name}: says what it reads or changes`);
}

fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log(`supported devices: ${fails.length} problem${fails.length === 1 ? '' : 's'}:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('supported devices: all good');
