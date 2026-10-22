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
  check(writeAllowed({ status: 'tested' }, v, 'rate').ok, 'a tested entry still writes a waiting setting (the driver refuses it while it must)');
  check(!writeAllowed({ status: 'tested', learnedKeys: ['extra'] }, v, 'extra').ok, 'a setting the wizard added stays read-only until its check, even on a tested entry');
  check(isWaiting(Object.assign(new Error('x'), { waiting: true })) && isWaiting(new Error('G HUB is running: close it first')) && !isWaiting(new Error('refused')), 'isWaiting: the flag, or the maker app sentence');
}

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `my-devices: FAILED: ${fails.join('; ')}` : 'my-devices (added devices): all good');
process.exit(fails.length ? 1 : 0);
