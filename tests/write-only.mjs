// Offline test of write-only settings (2 Nov 2026, Shawn's rule; helpers/my-devices.mjs "Write-only settings",
// helpers/write-only.mjs): a command the device cannot read back is allowed only after Turn on settings AND a check by
// eye once per driver + model (vid:pid) + key. Checks: locked before Turn on settings and before trust; Try it sends only
// the test value's bytes; No sends the previous value back (the last one DeviceHub wrote, else restore) and stays locked;
// Yes trusts it and later writes go through with the remembered value shown by read(); the self-check never writes a
// write-only key; problem() and driver.json validate refuse bad declarations; no SteelSeries save bytes ever; trust is
// per vid:pid. A simulated SteelSeries mouse and a pretend lamp; no hardware. Run: node tests/write-only.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeviceProvider } from '../public/devices/hid.js';
import * as md from '../helpers/my-devices.mjs';
import { validate } from '../helpers/declarative-driver.mjs';
import { TRUST_FILE, LAST_FILE, question } from '../helpers/write-only.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const hx = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-write-only-'));
const readData = (f) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8')); } catch { return {}; } };

// ---- 1. the contract: problem() refuses a bad writeOnly ----
const base = { id: 'wo-lamp', title: 'Lamp', kind: 'Light', async connect() { return true; }, async info() { return {}; }, async read() { return {}; }, async write(k, v) { return v; } };
const lampSetting = (wo, more = {}) => ({ key: 'lamp', label: 'Lamp', type: 'toggle', writeOnly: wo, ...more });
const good = { volatile: true, confirm: 'Is the lamp {value}?', test: true };
check(md.problem({ ...base, settings: [lampSetting(good)] }) === null, 'a good writeOnly passes');
check(/volatile/.test(md.problem({ ...base, settings: [lampSetting({ ...good, volatile: undefined })] }) || ''), 'writeOnly without volatile: true is refused');
check(/volatile/.test(md.problem({ ...base, settings: [lampSetting({ ...good, volatile: false })] }) || ''), 'writeOnly with volatile: false is refused');
check(/confirm/.test(md.problem({ ...base, settings: [lampSetting({ volatile: true, test: true })] }) || ''), 'writeOnly without confirm is refused');
check(/confirm/.test(md.problem({ ...base, settings: [lampSetting({ ...good, confirm: 'lamp on' })] }) || ''), 'a confirm that is not a question is refused');
check(/test/.test(md.problem({ ...base, settings: [lampSetting({ ...good, test: 5 })] }) || ''), 'a test value the setting does not take is refused');
check(/restore/.test(md.problem({ ...base, settings: [lampSetting({ ...good, restore: 'x' })] }) || ''), 'a restore value the setting does not take is refused');
check(/save/.test(md.problem({ ...base, saveAfterWrite: true, settings: [lampSetting(good)] }) || ''), 'a driver that saves after every write cannot have write-only settings');
check(/save/.test(md.problem({ ...base, saveAfterWrite: ['lamp'], settings: [lampSetting(good)] }) || ''), 'a driver that saves after this key: refused');
check(/save/.test(md.problem({ ...base, settings: [lampSetting(good, { then: 'save' })] }) || ''), 'a setting with a then (a save) cannot be write-only');
check(/known/.test(md.problem({ ...base, settings: [lampSetting({ ...good, persist: true })] }) || ''), 'an unknown writeOnly part is refused');
check(/reading/.test(md.problem({ ...base, settings: [{ key: 'x', label: 'X', type: 'display', writeOnly: good }] }) || ''), 'a display cannot be write-only');
// driver.json: never write-only (every driver.json write is read back)
const dj = validate({ format: 1, id: 'wo-json', title: 'J', kind: 'Mouse', vid: '1234', pids: ['0001'], settings: [{ key: 'dpi', label: 'DPI', type: 'toggle', writeOnly: good }] });
check(!dj.ok && dj.problems.some((p) => /writeOnly/.test(p) && /read back/.test(p)), `driver.json validate refuses writeOnly (${dj.problems?.find((p) => /writeOnly/.test(p))})`);
check(question({ type: 'choice', options: [{ value: 500, label: '500 Hz' }], writeOnly: { confirm: 'About {value}?' } }, 500) === 'About 500 Hz?', 'the question names the value in plain words');

// ---- 2. a guarded SteelSeries Aerox 3 Wireless (simulated) ----
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8')).commands
  .filter((c) => c.bytes && [].concat(c.vid).includes('1038')).map((c) => ({ ...c, b: c.bytes.split(' ').map((x) => parseInt(x, 16)) }));
class Sim {
  constructor(pid, dongle = false) { Object.assign(this, { vendorId: 0x1038, productId: pid, opened: false, sent: [], bad: [], listeners: new Set(), dongle }); }
  async open() { this.opened = true; }
  addEventListener(t, f) { if (t === 'inputreport') this.listeners.add(f); }
  removeEventListener(t, f) { this.listeners.delete(f); }
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    this.sent.push(b);
    for (const n of NEVER) if (n.b.every((x, i) => b[i] === x)) this.bad.push(`never: ${n.what} (${hx(b.slice(0, 2))})`);
    const r = new Uint8Array(64); r[0] = b[0]; r[1] = 0x8d;   // a battery-like answer to anything (60%, charging)
    setTimeout(() => [...this.listeners].forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1);
  }
}
let plugged = null;
setDeviceProvider(async (filters) => {
  const f = filters[0];
  return plugged && f.vendorId === plugged.vendorId && f.productId === plugged.productId ? plugged : null;
});
const allSent = [];
const plug = (pid, dongle) => { plugged = new Sim(pid, dongle); allSent.push(plugged); return plugged; };

const { default: drv } = await import('../device-library/steelseries-mouse/device.mjs?write-only-test');
let app = null;
drv.vendorApp = async () => app;
const folder = path.join(root, 'my-devices', 'steelseries-mouse');
fs.mkdirSync(folder, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'device-library', 'steelseries-mouse', 'device.json'), path.join(folder, 'device.json'));
fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ source: 'device-library', status: 'read-only' }));
const logs = [];
md.guard(drv, folder, md.libraryMark(folder), { makerApp: async () => app, backup: async () => {}, log: (t) => logs.push(t), version: 'test' });
const st = (key) => drv.settings.find((s) => s.key === key);
// what was written, each as its bytes up to the last non-zero one (at least two)
const writes = (sim) => sim.sent.filter((b) => b[0] !== 0x92 && b[0] !== 0xd2).map((b) => { let n = 8; while (n > 2 && b[n - 1] === 0) n--; return hx(b.slice(0, n)); });

let sim = plug(0x183a);
check(await drv.connect() === true, 'the Aerox 3 Wireless (cable) connects');
check(drv.settings.length === 5 && drv.settings.every((s) => s.writeOnly && s.readOnly && s.writeOnlyState === 'gated'), `before Turn on settings every write-only setting is locked (${drv.settings.map((s) => `${s.key}:${s.writeOnlyState}`).join(', ')})`);
check(drv.library.turnOn === true, 'Turn on settings is offered');
let e = await throws(() => drv.write('pollingRate', 500));
check(/Turn on settings/.test(e?.message || '') && writes(sim).length === 0, `a write before Turn on settings is refused, nothing sent (${e?.message})`);
let t = await drv.tryWrite('pollingRate');
check(!t.ok && t.gated && writes(sim).length === 0, `Try it before Turn on settings is refused (${JSON.stringify(t)})`);
const v0 = await drv.read();
check(v0.pollingRate === null && v0.dpi === null && v0.colors === null, `read(): null = not set by DeviceHub yet (${JSON.stringify(v0)})`);

// Turn on settings: no self-check write of a write-only key
const on = await drv.turnOn();
check(on.on === true && /write-only/.test(on.why || '') && writes(sim).length === 0, `Turn on settings writes nothing (${JSON.stringify(on)})`);
check(drv.settings.every((s) => s.readOnly && s.writeOnlyState === 'untrusted' && /Try it sends/.test(s.tryLine)), `after Turn on settings: still locked until checked by eye (${drv.settings.map((s) => s.writeOnlyState).join(', ')})`);
const sc = await md.selfCheck(drv, drv.write.bind(drv), { backup: async () => true, makerApp: async () => null });
check(writes(sim).length === 0 && sc.counts?.checked === 0 && !Object.keys(sc.keys || {}).some((k) => st(k)?.writeOnly), `the self-check never writes a write-only key, nor counts it (${JSON.stringify(sc.counts)})`);
check(!md.checkPlan({ settings: drv.settings }, { checkedAt: new Date().toISOString(), keys: {} }, {}), 'the self-check plan has nothing to check for write-only settings');
e = await throws(() => drv.write('pollingRate', 500));
check(/Try it/.test(e?.message || '') && writes(sim).length === 0, `untrusted: a write is refused, nothing sent (${e?.message})`);

// the maker's app open: Try it waits, nothing sent
app = 'SteelSeriesGG.exe';
t = await drv.tryWrite('pollingRate');
check(!t.ok && t.waiting && writes(sim).length === 0, `Try it waits while SteelSeries GG runs (${JSON.stringify(t)})`);
app = null;

// Try it: only the test value's bytes, once
check(!(await drv.tryAnswer('pollingRate', true)).ok, 'an answer with no Try it pressed is refused');
t = await drv.tryWrite('pollingRate');
check(t.ok && t.sent === 500 && /500 Hz/.test(t.question) && JSON.stringify(writes(sim)) === JSON.stringify(['2b 01']), `Try it sends only 2b 01 (500 Hz) and asks (${JSON.stringify(t)}; ${writes(sim)})`);
// No: the previous value goes back (none written yet: the driver's restore, 1000 Hz = 2b 00), still locked
let n = await drv.tryAnswer('pollingRate', false);
check(n.ok && !n.trusted && n.putBack === 1000 && JSON.stringify(writes(sim)) === JSON.stringify(['2b 01', '2b 00']), `No: 1000 Hz sent back (${JSON.stringify(n)}; ${writes(sim)})`);
check(st('pollingRate').readOnly && st('pollingRate').writeOnlyState === 'untrusted' && !readData(TRUST_FILE)['steelseries-mouse|1038:183a|pollingRate'], 'No: still locked, not trusted');
check((await drv.read()).pollingRate === null, 'after No, the value sent back is not shown as known (it was not checked: a review, 1 Nov 2026)');
check(logs.some((l) => /did not see it/.test(l)), 'No is logged');
// No with nothing to send back (DPI has no restore and nothing was written): nothing sent, the line says unplug
const before = writes(sim).length;
t = await drv.tryWrite('dpi');
n = await drv.tryAnswer('dpi', false);
check(t.ok && writes(sim).length === before + 1 && writes(sim)[before] === '2d 01 00 12' && n.putBack === null && /unplug/.test(n.line), `DPI No with no earlier value: nothing sent back, unplug to undo (${n.line})`);

// Yes: trusted for this driver + model + key; later writes go through, read() shows the remembered value
t = await drv.tryWrite('pollingRate');
const y = await drv.tryAnswer('pollingRate', true);
const trust = readData(TRUST_FILE)['steelseries-mouse|1038:183a|pollingRate'];
check(y.ok && y.trusted && trust?.answer === 'yes' && trust.value === 500 && trust.at, `Yes: trusted in ${TRUST_FILE} (${JSON.stringify(trust)})`);
check(!st('pollingRate').readOnly && st('pollingRate').writeOnlyState === 'trusted' && st('dpi').readOnly, 'Yes opens only that setting');
const k0 = writes(sim).length;
check(await drv.write('pollingRate', 250) === 250 && writes(sim)[k0] === '2b 02', `a trusted write sends 2b 02 (${writes(sim).slice(k0)})`);
check((await drv.read()).pollingRate === 250 && readData(LAST_FILE)['steelseries-mouse|1038:183a|pollingRate']?.value === 250, 'read() gives the last value DeviceHub wrote (last-written.json)');
check(fs.readdirSync(path.join(root, 'backups')).some((f) => /^last-written-.*\.json$/.test(f)) && fs.readdirSync(path.join(root, 'backups')).some((f) => /^trusted-writes-.*\.json$/.test(f)) === false, 'the data file is backed up before it is changed (trusted-writes.json had no older copy)');
check(!(await drv.tryWrite('pollingRate')).ok, 'Try it on a trusted setting is refused (already checked)');
e = await throws(() => drv.write('pollingRate', 300));
check(e && writes(sim).length === k0 + 1, 'a value the setting does not take is refused, nothing sent');

// trust is per vid:pid: the same mouse on its receiver (1838), and the Aerox 5 (1854), are not trusted
for (const [pid, dongle] of [[0x1838, true], [0x1854, false]]) {
  sim = plug(pid, dongle);
  check(await drv.connect() === true, `${pid.toString(16)} connects`);
  e = await throws(() => drv.write('pollingRate', 250));
  check(/Try it/.test(e?.message || '') && st('pollingRate').writeOnlyState === 'untrusted' && writes(sim).length === 0, `${pid.toString(16)}: another model of the same driver is not trusted (${e?.message})`);
  check((await drv.read()).pollingRate === null, `${pid.toString(16)}: nothing remembered for this model`);
}
// the receiver: Try it sends the | 0x40 command
sim = plug(0x1838, true);
await drv.connect();
t = await drv.tryWrite('sleepTimer');
check(t.ok && JSON.stringify(writes(sim)) === JSON.stringify(['69 60 ea']) && /1 min/.test(t.question), `the receiver: sleep timer 1 min is 69 60 ea 00 (${writes(sim)}; ${t.question})`);
await drv.tryAnswer('sleepTimer', false);
check(writes(sim)[1] === '69 e0 93 04', `No: the restore (5 min = 300000 ms) goes back (${writes(sim)})`);
// back on the cable mouse: still trusted there
sim = plug(0x183a);
await drv.connect();
check(st('pollingRate').writeOnlyState === 'trusted' && (await drv.read()).pollingRate === null, 'back on 183a: still trusted; the value from before it was unplugged is not shown (the mouse forgot it: a review, 1 Nov 2026)');

// no SteelSeries save bytes, ever, from any of this
check(allSent.every((s) => s.bad.length === 0) && allSent.flatMap((s) => s.sent).every((b) => ![[0x11, 0x00], [0x51, 0x00], [0x09, 0x00], [0x59]].some((p) => p.every((x, i) => b[i] === x))), `no save (11 00, 51 00, 09 00, 59) was ever sent (${allSent.flatMap((s) => s.bad).join(', ')})`);

// ---- 3. "previous": No sends back the last value DeviceHub wrote ----
{
  const lampFolder = path.join(root, 'my-devices', 'wo-lamp');
  fs.mkdirSync(lampFolder, { recursive: true });
  fs.writeFileSync(path.join(lampFolder, 'library.json'), JSON.stringify({ source: 'device-library', status: 'read-only' }));
  const sentL = [];
  const lamp = { ...base, hid: { vid: 'abcd', pid: '0001' }, settings: [lampSetting({ ...good, restore: 'previous' }), { key: 'lamp2', label: 'Lamp 2', type: 'toggle', writeOnly: { ...good, restore: 'previous' } }],
    async write(k, v) { sentL.push([k, v]); return v; } };
  md.guard(lamp, lampFolder, md.libraryMark(lampFolder), { makerApp: async () => null, backup: async () => {}, log() {} });
  await lamp.connect();
  await lamp.turnOn();
  await lamp.tryWrite('lamp');
  const r1 = await lamp.tryAnswer('lamp', false);
  check(r1.putBack === null && JSON.stringify(sentL) === '[["lamp",true]]', `restore 'previous' with no earlier value: nothing sent back (${JSON.stringify(sentL)})`);
  // lamp2 had a value DeviceHub wrote before (kept in last-written.json): No sends that back
  const ws = (await import('../helpers/write-only.mjs')).writeOnlyStore(root);
  ws.remember('wo-lamp|abcd:0001|lamp2', false);
  await lamp.tryWrite('lamp2');
  const r2 = await lamp.tryAnswer('lamp2', false);
  check(r2.putBack === false && JSON.stringify(sentL.slice(1)) === '[["lamp2",true],["lamp2",false]]', `No sends back the last value DeviceHub wrote (${JSON.stringify(sentL)})`);
}

// ---- 4. a person's own driver (no library.json) may not use write-only settings ----
{
  let wrote = 0;
  const own = md.lockWriteOnly({ ...base, settings: [lampSetting(good), { key: 'x', label: 'X', type: 'toggle' }], async write(k, v) { wrote++; return v; } });
  check(/library/.test((await throws(() => own.write('lamp', true)))?.message || '') && wrote === 0 && await own.write('x', true) === true && wrote === 1, 'an own driver: write-only refused, other settings write');
}

// ---- 5. the page and the routes are wired ----
const page = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'my-device.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check(/\/api\/library\/try-write/.test(page) && /\/api\/library\/try-answer/.test(page) && /'Try it'/.test(page) && /can't report it back/.test(page), 'the page has Try it, Yes / No and the "can\'t report it back" mark');
check(/\/api\/library\/try-write/.test(server) && /\/api\/library\/try-answer/.test(server) && /req\.method === 'POST'/.test(server.slice(server.indexOf('/api/library/try-write') - 200, server.indexOf('/api/library/try-write') + 200)), 'the server takes Try it and its answer as POSTs only');

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `write-only: FAILED (${fails.length}):\n- ${fails.join('\n- ')}` : 'write-only (Try it, Yes / No, trust per model, no saves): all good');
process.exit(fails.length ? 1 : 0);
