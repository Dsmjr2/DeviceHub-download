// Devices added in my-devices/ (21 Oct 2026; helpers/my-devices.mjs): a good one loads with its HID channel, the worked
// example only when asked for, and a broken or clashing one is refused with a reason instead of stopping DeviceHub.
// Run: node tests/my-devices.mjs (no hardware)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, problem, checkPlan, writeAllowed, isWaiting, RETRY_MS } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-mydev-'));
const put = (name, text) => { fs.mkdirSync(path.join(root, 'my-devices', name), { recursive: true }); if (text != null) fs.writeFileSync(path.join(root, 'my-devices', name, 'device.mjs'), text); };
const dev = (over) => `export default { id: 'test-mouse', title: 'Test mouse', kind: 'Mouse', settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }],
  async connect() { return true; }, async info() { return {}; }, async read() { return { dpi: 800 }; }, async write(k, v) { return v; }, ${over || ''} };`;

put('good', dev("hid: { vid: '046d', pid: 'C547', page: 'FF00', len: 20, reportId: 17 },"));
put('broken', 'export default {');
put('clash', dev().replace("'test-mouse'", "'mouse'"));
put('twice', dev());
put('no-file', null);
put('_draft', dev().replace("'test-mouse'", "'draft'"));
fs.cpSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'my-devices', '_example'), path.join(root, 'my-devices', '_example'), { recursive: true });

const registered = [], specs = [];
const run = () => load(root, { register: (a) => registered.push(a), addSpec: (s) => specs.push(s), taken: (id) => registered.some((a) => a.id === id) });
let r = await run();
const by = Object.fromEntries(r.map((x) => [x.name, x]));
check(by.good?.id === 'test-mouse', `a good one loads (${JSON.stringify(by.good)})`);
check(specs.length === 1 && specs[0].vid === '046d' && specs[0].id === 'test-mouse', `its HID channel is added (${JSON.stringify(specs)})`);
check(/default|Unexpected|end of input/i.test(by.broken?.error || ''), `a broken file is refused with its error (${by.broken?.error})`);
check(/built-in/.test(by.clash?.error || ''), `a built-in id is refused (${by.clash?.error})`);
check(/already used/.test(by.twice?.error || ''), `a second device with the same id is refused (${by.twice?.error})`);
check(/no device\.mjs/.test(by['no-file']?.error || ''), 'a folder without device.mjs is reported');
check(!by._draft && !by._example, 'folders starting with _ are skipped');
check(registered.length === 1 && registered[0].plugin === 'good', 'only the good one is registered');

process.env.DEVICEHUB_EXAMPLE_DEVICE = '1';
registered.length = 0; specs.length = 0;
r = await run();
check(r.some((x) => x.name === '_example' && x.id === 'example-light'), `the example loads when asked for (${JSON.stringify(r.find((x) => x.name === '_example'))})`);
const ex = registered.find((a) => a.id === 'example-light');
check(ex && (await ex.write('brightness', 42)) === 42, 'the example writes and reads back');
let refused = null; try { await ex.write('brightness', 400); } catch (e) { refused = e.message; }
check(/0-100/.test(refused || ''), 'the example refuses an out-of-range value');

check(/slider needs min and max/.test(problem({ id: 'x-y', title: 'X', kind: 'Mouse', connect() {}, info() {}, read() {}, write() {}, settings: [{ key: 'a', label: 'A', type: 'slider' }] }) || ''), 'a slider without its range is refused');

// when a library driver is checked again (22 Oct 2026): checkPlan
{
  const a = { settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 1, max: 9 }, { key: 'rate', label: 'Rate', type: 'slider', min: 1, max: 9 }, { key: 'led', label: 'Lights', type: 'toggle' }, { key: 'name', label: 'Name', type: 'display' }] };
  const at = '2026-10-22T10:00:00.000Z', t0 = Date.parse(at);
  const v = { checkedAt: at, firmware: null, devicehub: 'v1', keys: { dpi: { ok: true, value: 5, readBack: 5, at }, rate: { ran: false, waiting: true, value: 3, why: 'onboard', at }, led: { ok: false, value: true, readBack: false, why: 'moved', at } } };
  const now = (ms) => () => new Date(t0 + ms);
  check(checkPlan(a, { keys: {} }, {})?.only === null, 'never checked: a full check');
  check(checkPlan(a, v, {}, { now: now(60e3), version: 'v1' }) === null, 'a minute later: nothing (once a day)');
  const p = checkPlan(a, v, {}, { now: now(RETRY_MS + 1), version: 'v1' });
  check(p && p.only.join() === 'rate', 'a day later: only the waiting one; a moved value never by itself ' + JSON.stringify(p));
  const u = checkPlan(a, { ...v, keys: { ...v.keys, rate: { ok: false, value: 3, readBack: 3, why: 'refused', at } } }, {}, { now: now(60e3), version: 'v2' });
  check(u && u.only.join() === 'rate' && /updated/.test(u.why), 'after a DeviceHub update: at once ' + JSON.stringify(u));
  check(checkPlan(a, { ...v, firmware: 'fw 1' }, { firmware: '2' })?.only === null, 'other firmware: a full check');
  check(checkPlan(a, { ...v, keys: { ...v.keys, rate: { ok: false, skip: true, why: 'not to be checked', at } } }, {}, { now: now(RETRY_MS * 9) }) === null, 'a setting the driver says never to check is never retried');
  check(!writeAllowed({ status: 'read-only' }, v, 'rate').ok && /waiting/.test(writeAllowed({ status: 'read-only' }, v, 'rate').why), 'waiting = read-only for a read-only entry, and says so');
  check(!writeAllowed({ status: 'tested' }, v, 'rate').ok && !writeAllowed({ status: 'tested' }, { keys: {} }, 'dpi').ok && writeAllowed({ status: 'tested' }, v, 'dpi').ok, 'final audit: even a tested entry writes only a setting whose check passed (not a waiting or unchecked one)');
  check(!writeAllowed({ status: 'tested', learnedKeys: ['extra'] }, v, 'extra').ok, 'a setting the wizard added stays read-only until its check, even on a tested entry');
  check(isWaiting(Object.assign(new Error('x'), { waiting: true })) && isWaiting(new Error('G HUB is running: close it first')) && !isWaiting(new Error('refused')), 'isWaiting: the flag, or the maker app sentence');
}

// safety round 2 (docs/handoff/safety-round2.md): what counts as a real-device record, the Turn on settings gate, and the
// ids DeviceHub's own drivers run (any overlap, from any id a driver declares)
{
  const md = await import('../helpers/my-devices.mjs');
  const { list } = await import('../helpers/device-library.mjs');
  const shipped = list({ examples: true }).filter((e) => e.meta);
  const proven = shipped.filter((e) => md.hasRealRecord(e.meta)).map((e) => e.name);
  check(proven.length === 0, `no shipped library entry has a real-device record yet, so every one waits for Turn on settings (${proven.join(', ')})`);
  check(shipped.some((e) => e.name === 'logitech-hidpp-mouse') && !md.hasRealRecord(shipped.find((e) => e.name === 'logitech-hidpp-mouse').meta), 'a "simulation only" record is not a real one');
  check(md.realRecord({ by: 'Sam', date: '2026-10-23', devicehub: '0.2.0', how: 'each setting written once and read back' }) && !md.realRecord({ by: 'Sam', how: 'settings read, nothing written' })
    && !md.realRecord({ by: 'Sam', status: 'read-only', how: 'x' }) && !md.realRecord({ by: 'Sam', how: 'x' }, 'read-only') && md.realRecord({ by: 'Sam', status: 'tested', how: 'x' }, 'read-only')
    && !md.hasRealRecord({ status: 'read-only', tested: [{ by: 'Sam', date: 'd', devicehub: 'v' }] }), 'final audit: only a record from status "tested" counts (a read-only share never does)');
  const at = '2026-10-22T10:00:00.000Z', later = '2026-10-22T11:00:00.000Z';
  check(md.needsTurnOn({}, false, 'dpi') && !md.needsTurnOn({ settingsOn: { at } }, false, 'dpi'), 'no real record: every setting waits until Turn on settings');
  check(!md.needsTurnOn({}, true, 'dpi') && md.needsTurnOn({ learnedKeys: ['x'] }, true, 'x'), 'a real record: only learned settings wait');
  check(!md.needsTurnOn({ learnedKeys: ['x'], learnedAt: at, settingsOn: { at: later } }, true, 'x') && md.needsTurnOn({ learnedKeys: ['x'], learnedAt: later, settingsOn: { at } }, true, 'x'), 'a setting learned after the click waits for another one');
  check(md.ownClash('1b1c', ['1bf0', '0A69']).join() === '1b1c:0a69' && md.ownClash('1b1c', ['0a71']).length && md.ownClash('1b1c', ['0a6b']).length && md.ownClash('3710', ['3506', '5406']).length === 2 && md.ownClash('342d', ['e479']).length && !md.ownClash('1b1c', ['0a88']).length, 'ownClash: any HS80 (0a6b, 0a69, 0a71), Pulsar (5406, 3506) or P75 id');
  const noHid = { id: 'x-y', settings: [] };
  check(md.declaredIds(noHid).length === 0 && md.declaredIds({ id: 'j', vid: '1b1c', pids: ['0a69'], settings: [] })[0].pids[0] === '0a69', 'a driver.json\'s top-level vid / pids are declared ids');
  const pcmap = (await import('node:module')).createRequire(import.meta.url)('../helpers/pc-map.js');
  check(pcmap.RUNS['1b1c:0a6b'] === 'Headset page' && /^Headset page/.test(pcmap.RUNS['1b1c:0a69']) && /^Mouse page/.test(pcmap.RUNS['3710:3506']), 'RUNS: the HS80 receiver still names the Headset page; its cable and the Pulsar cable are listed too');
}

// batteryCare (22 Oct 2026, docs/handoff/battery-added-devices.md): optional, checked, and declared by no shipped driver
{
  const md = await import('../helpers/my-devices.mjs');
  const base = (care, extra = {}) => ({ id: 'x-y', title: 'X', kind: 'Mouse', connect() {}, info() {}, read() {}, write() {}, battery() {},
    settings: [{ key: 'lights', label: 'Lights', type: 'toggle' }, { key: 'rate', label: 'Rate', type: 'choice', options: [{ value: 1000, label: '1000 Hz' }] }, { key: 'sig', label: 'Signal', type: 'display' }], batteryCare: care, ...extra });
  check(md.problem(base(undefined)) === null, 'no batteryCare: fine (it is optional)');
  check(md.problem(base({ lowBattery: { key: 'rate', value: 1000 }, charging: { key: 'lights', value: false } })) === null, 'a good batteryCare is taken');
  check(md.problem(base({ lowBattery: { key: 'later', value: 3 } })) === null, 'a setting listed only once the model connects is checked later, before each change');
  const bad = [
    [base('lights'), /must be/], [base({}), /empty/], [base({ sleep: { key: 'lights', value: false } }), /only lowBattery and charging/],
    [base({ lowBattery: { key: 'lights' } }), /must be \{ key, value \}/], [base({ lowBattery: { key: 'lights', value: false, extra: 1 } }), /must be \{ key, value \}/],
    [base({ lowBattery: { key: 'sig', value: 'x' } }), /a reading/], [base({ charging: { key: 'rate', value: 8000 } }), /not a value rate takes/],
    [base({ charging: { key: 'lights', value: false } }, { battery: undefined }), /needs battery\(\)/],
  ];
  for (const [a, re] of bad) check(re.test(md.problem(a) || ''), `a bad batteryCare is refused: ${JSON.stringify(a.batteryCare)} -> ${md.problem(a)}`);
  // loaded from a folder like any driver: a good one loads, a bad one is refused with its reason
  put('care-good', dev("battery: async () => ({ percent: 50 }), batteryCare: { lowBattery: { key: 'dpi', value: 800 } },").replace("'test-mouse'", "'care-good'"));
  put('care-bad', dev("batteryCare: { lowBattery: { key: 'dpi', value: 800 } },").replace("'test-mouse'", "'care-bad'"));
  registered.length = 0; specs.length = 0;
  const rr = Object.fromEntries((await run()).map((x) => [x.name, x]));
  check(rr['care-good']?.id === 'care-good' && registered.find((a) => a.id === 'care-good')?.batteryCare?.lowBattery?.value === 800, `a driver with batteryCare loads (${JSON.stringify(rr['care-good'])})`);
  check(/needs battery\(\)/.test(rr['care-bad']?.error || ''), `a batteryCare without battery() is refused (${rr['care-bad']?.error})`);
  // no shipped library driver declares it, so nothing changes for them
  const libDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'device-library');
  const declaring = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|js|json)$/.test(e.name) && /batteryCare/.test(fs.readFileSync(p, 'utf8'))) declaring.push(path.relative(libDir, p)); } };
  walk(libDir);
  check(declaring.length === 0, `no shipped library driver declares batteryCare yet (${declaring.join(', ')})`);
}

// final audit (22 Oct 2026; docs/handoff/final-safety.md)
{
  const md = await import('../helpers/my-devices.mjs');
  // 3. a person's own driver (no library.json) on an id DeviceHub's own drivers run is not loaded, whichever way it says so
  put('own-hs80', dev("hid: { vid: '1b1c', pid: '1bf0', cablePid: '0A6B', page: 'FF42', len: 64 },").replace("'test-mouse'", "'own-hs80'"));
  put('own-pulsar', dev().replace("'test-mouse'", "'own-pulsar'"));
  fs.writeFileSync(path.join(root, 'my-devices', 'own-pulsar', 'device.json'), JSON.stringify({ vid: '3710', pids: ['3506'] }));
  put('own-fine', dev("hid: { vid: '1b1c', pid: '1bf0', page: 'FF42', len: 64 },").replace("'test-mouse'", "'own-fine'"));
  registered.length = 0; specs.length = 0;
  const rr = Object.fromEntries((await run()).map((x) => [x.name, x]));
  check(/1b1c:0a6b/.test(rr['own-hs80']?.error || '') && /own driver/.test(rr['own-hs80']?.error || ''), `a hand-made driver on an HS80 id is refused with a plain reason (${JSON.stringify(rr['own-hs80'])})`);
  check(/3710:3506/.test(rr['own-pulsar']?.error || ''), `its device.json's ids count too (${JSON.stringify(rr['own-pulsar'])})`);
  check(rr['own-fine']?.id === 'own-fine' && !registered.some((a) => /^own-(hs80|pulsar)$/.test(a.id)) && !specs.some((s) => s.id === 'own-hs80'), 'another Corsair id loads; the refused ones get no channel and no page');
  for (const n of ['own-hs80', 'own-pulsar', 'own-fine']) fs.rmSync(path.join(root, 'my-devices', n), { recursive: true, force: true });

  // 1. the maker's app is asked before EVERY guarded write (kept MAKER_CACHE_MS), even when the driver's own check says none
  const folder = path.join(root, 'guarded-maker');
  fs.mkdirSync(folder, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify({ checkedAt: at, keys: { dpi: { ok: true, value: 800, readBack: 800, at } } }));
  let app = 'lghub.exe', fail = false, asked = 0, wrote = 0;
  const a = { id: 'maker-mouse', title: 'Maker mouse', kind: 'Mouse', hid: { vid: '046d', pid: 'c0de' }, settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }],
    async connect() { return true; }, async info() { return {}; }, async read() { return { dpi: 800 }; }, async write(k, v) { wrote++; return v; },
    async vendorApp() { return null; } };   // a driver whose tasklist failed answers "no app"
  md.guard(a, folder, { status: 'read-only', settingsOn: { at } }, { makerApp: async () => { asked++; if (fail) throw new Error('tasklist did not answer'); return app; }, backup: async () => {}, log() {} });
  const tryWrite = async () => { try { await a.write('dpi', 800); return null; } catch (e) { return e; } };
  let e = await tryWrite();
  check(e?.waiting && /lghub/.test(e.message) && wrote === 0, `a passed setting is not written while the maker's app is open, though the driver said none (${e?.message})`);
  app = null; fail = true;
  e = await tryWrite();
  check(e?.waiting && /could not check/.test(e.message) && wrote === 0, `"could not check" refuses the write (${e?.message})`);
  fail = false;
  e = await tryWrite();
  const n = asked;
  check(!e && wrote === 1, `with the app closed it writes (${e?.message})`);
  e = await tryWrite();
  check(!e && wrote === 2 && asked === n && md.MAKER_CACHE_MS >= 10000 && md.MAKER_CACHE_MS <= 20000, `a second write within ${md.MAKER_CACHE_MS / 1000} s uses the kept answer (asked ${asked - n} more)`);
}

// profiles for added devices (tests/profiles-added.mjs; it runs here so test:offline covers it)
for (const f of await (await import('./profiles-added.mjs')).run()) fails.push(`profiles: ${f}`);

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `my-devices: FAILED: ${fails.join('; ')}` : 'my-devices (added devices): all good');
process.exit(fails.length ? 1 : 0);
