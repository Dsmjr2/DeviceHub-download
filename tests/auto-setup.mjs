// Auto setup and the library self-check (22 Oct 2026; helpers/auto-setup.mjs, helpers/my-devices.mjs guard/selfCheck):
// a library driver loads with writes refused until a setting passes its self-check (read, write that same value, read
// back), the self-check backs up first, writes only the value read just before, puts a value that moved back and stops,
// keeps its result in verified.json and runs again only after a firmware change; auto setup installs matching tested and
// read-only entries (never over a folder, never twice, never for a device DeviceHub already runs) and the summary
// speaks only when there is something to say. Pretend drivers in a TEMP folder only; no device is touched.
// Run: node tests/auto-setup.mjs (no hardware)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load, loadNew, selfCheck, writeAllowed } from '../helpers/my-devices.mjs';
import { run, summary, dismiss, asText, readSetup } from '../helpers/auto-setup.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-autosetup-'));
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
globalThis.__dh = {};
// a pretend driver whose state the test can see and bend: drift = what a write really leaves, failWrite = writes that throw
const driver = (id, { vid = '1234', pid = 'abcd', extra = '' } = {}) => `const st = globalThis.__dh['${id}'] = { values: { dpi: 800, lights: true, mode: 'steady', profile: 2 }, writes: [], reads: 0, fw: '1.0', drift: {}, failWrite: {} };
export default { id: '${id}', title: 'Pretend ${id}', kind: 'Mouse', hid: { vid: '${vid}', pid: '${pid}', page: 'FF00', len: 20 },
  settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }, { key: 'lights', label: 'Lights', type: 'toggle' },
    { key: 'mode', label: 'Effect', type: 'choice', options: [{ value: 'steady', label: 'Steady' }, { value: 'off', label: 'Off' }] },
    { key: 'profile', label: 'Profile', type: 'slider', min: 1, max: 5, selfCheck: false }],
  async connect() { return true; }, async info() { return { Model: 'Pretend', Firmware: st.fw }; },
  async read() { st.reads++; return { ...st.values }; },
  async write(k, v) { st.writes.push({ k, v, before: st.values[k] }); if (st.failWrite[k]) throw new Error('the device refused it'); st.values[k] = k in st.drift ? st.drift[k] : v; return st.values[k]; } ${extra} };\n`;
const REAL = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.copyFileSync(path.join(REAL, 'docs', 'brands.json'), path.join(root, 'docs', 'brands.json'));
const mark = (status) => JSON.stringify({ source: 'device-library/x', name: 'x', id: 'x', status, installedAt: '2026-10-22T00:00:00.000Z' });

// ---------- the guard and the self-check ----------
put('my-devices/ro-mouse/device.mjs', driver('ro-mouse'));
put('my-devices/ro-mouse/library.json', mark('read-only'));
put('my-devices/tested-mouse/device.mjs', driver('tested-mouse'));
put('my-devices/tested-mouse/library.json', mark('tested'));
put('my-devices/own-mouse/device.mjs', driver('own-mouse'));
put('my-devices/builtin-usb/device.mjs', driver('builtin-usb', { vid: '3710', pid: '5406' }));
put('my-devices/builtin-usb/library.json', mark('read-only'));
put('my-devices/no-backup/device.mjs', driver('no-backup'));
put('my-devices/no-backup/library.json', mark('read-only'));
const logs = [], backups = [];
let backupFails = false;
const deps = { backup: async (b) => { if (backupFails) throw new Error('disk full'); backups.push(b); return { file: 'x.json' }; }, log: (t, kind, id) => logs.push({ t, kind, id }) };
const reg = {};
const loaded = await load(root, { register: (a) => { reg[a.id] = a; }, addSpec() {}, taken: (id) => !!reg[id], selfCheck: deps });
const lib = Object.fromEntries(loaded.map((x) => [x.name, x]));
check(lib['ro-mouse']?.library === 'read-only' && lib['own-mouse']?.id && !lib['own-mouse'].library, `library drivers load marked, the person's own as before (${JSON.stringify(loaded)})`);
const st = (id) => globalThis.__dh[id];
const ro = reg['ro-mouse'];
let err = null; try { await ro.write('dpi', 800); } catch (e) { err = e.message; }
check(/read-only/.test(err || '') && st('ro-mouse').writes.length === 0, `a read-only library driver refuses writes before its self-check (${err})`);
check(ro.settings.every((s) => s.readOnly && /Read-only/.test(s.hint || '')), 'each setting says it is read-only on its page');
check((await reg['own-mouse'].write('dpi', 1600)) === 1600, "the person's own driver writes as before");

// first connect: the self-check runs
st('ro-mouse').drift.mode = 'off';  // a write of "mode" leaves something else: must fail, be put back... (drift stays, so put-back fails too)
st('ro-mouse').values.dpi = 1200;
check(await ro.connect() === true, 'connect still says connected');
const v = json('my-devices/ro-mouse/verified.json');
check(backups.length === 1 && backups[0].device === 'ro-mouse' && backups[0].data.settings.dpi === 1200, 'a backup is taken before the first write');
check(v.keys.dpi?.ok === true && v.keys.dpi.value === 1200 && v.keys.dpi.readBack === 1200 && v.keys.lights?.ok === true, `settings that wrote their own value and read it back pass (${JSON.stringify(v.keys)})`);
check(v.keys.mode?.ok === false && /read back "off"/.test(v.keys.mode.why), `a setting whose value moved fails with why (${v.keys.mode?.why})`);
check(v.keys.profile?.ok === false && /not to be self-checked|not checked/.test(v.keys.profile.why), 'a setting after a failure, or marked selfCheck: false, is not written');
check(v.firmware === 'Firmware 1.0' && v.checkedAt && v.status === 'read-only', `verified.json keeps date, firmware and status (${v.firmware})`);
const w = st('ro-mouse').writes;
check(w.filter((x) => x.k === 'dpi').every((x) => x.v === x.before) && w.filter((x) => x.k === 'lights').every((x) => x.v === x.before), 'every self-check write is the value read just before');
check(w.filter((x) => x.k === 'mode').length === 2 && w.filter((x) => x.k === 'mode')[1].v === 'steady', 'the moved value is put back once (the original)');
check(!w.some((x) => x.k === 'profile'), 'nothing is written after a failure, nor to a selfCheck: false setting');
check(logs.some((l) => l.id === 'ro-mouse' && /self-check.*2 of 4.*DPI, Lights.*read-only/.test(l.t)), `one Activity line says what it did (${logs.map((l) => l.t).join(' | ')})`);
check(writeAllowed({ status: 'read-only' }, v, 'dpi').ok && !writeAllowed({ status: 'read-only' }, v, 'mode').ok, 'writeAllowed follows verified.json');
check((await ro.write('dpi', 1600)) === 1600, 'a verified setting writes from then on');
err = null; try { await ro.write('mode', 'steady'); } catch (e) { err = e.message; }
check(/self-check did not pass/.test(err || ''), `a failed setting stays read-only and says why (${err})`);
check(!ro.settings.find((s) => s.key === 'dpi').readOnly && ro.settings.find((s) => s.key === 'mode').readOnly, 'the page hints follow the result');

// next connect, same firmware: no second self-check; firmware changed: again
let n = st('ro-mouse').writes.length;
await ro.connect();
check(st('ro-mouse').writes.length === n && backups.length === 1, 'the same firmware does not run it again');
delete st('ro-mouse').drift.mode; st('ro-mouse').values.mode = 'steady'; st('ro-mouse').fw = '1.1';
await ro.connect();
const v2 = json('my-devices/ro-mouse/verified.json');
check(backups.length === 2 && v2.firmware === 'Firmware 1.1' && v2.keys.mode?.ok === true, `a firmware change runs it again (${JSON.stringify(v2.keys.mode)})`);

// a tested entry writes before its check; a failure makes that one setting read-only
check((await reg['tested-mouse'].write('dpi', 900)) === 900, 'a tested library driver writes before its self-check');
st('tested-mouse').failWrite.lights = true;
await reg['tested-mouse'].connect();
err = null; try { await reg['tested-mouse'].write('lights', false); } catch (e) { err = e.message; }
check(/self-check did not pass.*refused/.test(err || ''), `a tested driver's failed setting turns read-only (${err})`);

// never on DeviceHub's own devices, and nothing without a backup
await reg['builtin-usb'].connect();
check(st('builtin-usb').writes.length === 0 && !fs.existsSync(path.join(root, 'my-devices/builtin-usb/verified.json')), "a driver for a USB id DeviceHub's own drivers run is never self-checked");
check(!(await selfCheck({ id: 'mouse', title: 'M', settings: [] }, () => {}, deps)).ran, 'a built-in slot is never self-checked');
backupFails = true;
await reg['no-backup'].connect();
check(st('no-backup').writes.length === 0 && logs.some((l) => l.id === 'no-backup' && /not run: no backup/.test(l.t)), 'no backup = nothing written, and it says so');
backupFails = false;

// ---------- auto setup ----------
const entry = (name, status, pids, id = name) => {
  put(`device-library/${name}/device.mjs`, driver(id, { pid: pids[0] }));
  put(`device-library/${name}/device.json`, JSON.stringify({ id, vendor: 'Acme', product: name, kind: 'Mouse', vid: '1234', pids, models: [name], works: ['DPI'], status, tested: [{ by: 'test', date: '2026-10-22', devicehub: '0.1.0' }] }));
};
entry('acme-tested', 'tested', ['aa01']);
entry('acme-reader', 'read-only', ['aa02']);
entry('acme-untested', 'untested', ['aa03']);
entry('acme-runs', 'read-only', ['aa04']);
entry('acme-mine', 'tested', ['aa05']);
put('my-devices/acme-mine/device.mjs', '// the person changed this\n');
const usb = [{ vid: '1234', pid: 'aa01', name: 'Acme one' }, { vid: '1234', pid: 'AA02', name: '' }, { vid: '1234', pid: 'aa03', name: 'Acme three' }, { vid: '1234', pid: 'aa04', name: 'Acme four', runs: 'Mouse page' }, { vid: '1234', pid: 'aa05' },
  { vid: '046d', pid: 'c999', name: 'Logitech G thing' }, { vid: '0489', pid: 'e116', name: 'TP-Link Bluetooth Adapter' }];
const connected = [];
const setupLogs = [];
let r = await run({ root, usb, log: (e) => setupLogs.push(e.text), load: (rt) => loadNew(rt, { connect: (id) => connected.push(id) }) });
const names = (l) => l.map((x) => x.name).sort().join();
check(names(r.lastRun.installed) === 'acme-reader,acme-tested', `matching tested and read-only entries install (${names(r.lastRun.installed)})`);
check(names(r.lastRun.offered) === 'acme-untested' && r.lastRun.skipped.some((x) => x.name === 'acme-runs' && /already runs/.test(x.why)), `untested is offered, a device DeviceHub runs is skipped (${JSON.stringify(r.lastRun)})`);
check(fs.readFileSync(path.join(root, 'my-devices/acme-mine/device.mjs'), 'utf8').includes('person changed'), 'an existing my-devices folder is left as it is');
const m = json('my-devices/acme-reader/library.json');
check(m.status === 'read-only' && m.source === 'device-library/acme-reader' && m.installedAt && Object.keys(m).every((k) => ['source', 'name', 'id', 'status', 'installedAt', 'devicehub', 'libraryTested', 'libraryDevicehub'].includes(k)), `the marker names source and status only (${JSON.stringify(m)})`);
check(r.lastRun.loaded?.includes('acme-reader') && connected.includes('acme-reader') && reg['acme-reader']?.library?.status === 'read-only', `installed drivers load at once, guarded, and connect (${JSON.stringify(r.lastRun.loaded)})`);
check(setupLogs.length === 2 && setupLogs.every((t) => /^Set up: .* installed from the device library/.test(t) && !/restart/.test(t)), `Activity says what was installed (${setupLogs.join(' | ')})`);
const sj = readSetup(root);
check(sj.firstRunAt && sj.installed.length === 2 && !JSON.stringify(sj).includes(os.userInfo().username) && !/Acme one/.test(JSON.stringify(sj)), 'setup.json records what it did, with nothing personal (no user or USB names)');
// removed by the person: never installed again; a second run installs nothing
fs.rmSync(path.join(root, 'my-devices/acme-tested'), { recursive: true, force: true });
r = await run({ root, usb, load: async () => [] });
check(r.lastRun.installed.length === 0 && r.lastRun.skipped.some((x) => x.name === 'acme-tested' && /removed since/.test(x.why)), 'a driver the person removed is not installed again');
put('settings.json', JSON.stringify({ autoSetup: false }));
r = await run({ root, usb: [{ vid: '1234', pid: 'aa09' }] });
check(r.lastRun.off === true, 'settings.json "autoSetup": false turns it off');
fs.rmSync(path.join(root, 'settings.json'));

// ---------- the summary ----------
const agent = { devices: [{ id: 'mouse', status: 'asleep', seen: true, info: { Model: 'Pulsar X-Lite CrazyLight' }, adapter: { title: 'Pulsar X-Lite CrazyLight', kind: 'Mouse' } }, { id: 'keyboard', status: 'missing', seen: false, adapter: { title: 'Epomaker P75', kind: 'Keyboard' } },
  { id: 'acme-reader', status: 'connected', adapter: { title: 'Pretend acme-reader', settings: reg['acme-reader'].settings } }] };
let s = summary({ root, sources: { agent, usb, via: [{ vid: '342D', pid: 'E479', name: 'P75' }], monitors: [{ name: 'AOC AGON', ddc: true }], cameras: [{ name: 'Cam' }], bluetooth: [{ name: 'Pad', percent: 90 }], lamparrays: [], eqapo: false, openrgb: { running: false }, pcLights: true } });
check(s.show && s.signature && s.installed.length === 2, `a PC where something was installed shows the card (${JSON.stringify(s.installed)})`);
check(s.works.some((x) => x.what === 'mouse') && !s.works.some((x) => x.what === 'keyboard') && s.works.some((x) => x.what === 'via') && s.works.some((x) => x.what === 'monitors') && s.works.some((x) => x.what === 'cameras') && s.works.some((x) => /Pad 90%/.test(x.line)), 'works now: built-ins this PC has, VIA, monitors, webcams, Bluetooth batteries');
check(s.works.some((x) => x.what === 'library' && x.name === 'acme-reader' && /read-only until it connects/.test(x.line)), `library drivers say how far they are verified (${s.works.filter((x) => x.what === 'library').map((x) => x.line).join(' | ')})`);
check(s.works.some((x) => x.what === 'library' && x.name === 'ro-mouse' && /verified: dpi, lights, mode/i.test(x.line)), 'a checked driver lists its verified settings');
check(s.learn.some((x) => x.usb === '046d:c999' && /logitech\.md|learning session/.test(x.line)) && !s.learn.some((x) => x.usb === '0489:e116') && s.learn.some((x) => x.what === 'library-untested'), `still to do: a known brand with no driver, an untested library entry; never a Bluetooth adapter (${s.learn.map((x) => x.line).join(' | ')})`);
check(s.optional.some((x) => x.what === 'eqapo') && s.optional.some((x) => x.what === 'openrgb'), 'optional: Equalizer APO and OpenRGB');
check(/Works now:/.test(asText(s)) && /Still to do/.test(asText(s)) && /Next: follow CLAUDE\.md/.test(asText(s)), 'the text report has the sections and the next step');
dismiss(root, s.signature);
check(!summary({ root, sources: { agent, usb, eqapo: false } }).show || summary({ root, sources: { agent, usb, eqapo: false } }).signature !== s.signature, 'sanity: signature follows the content');
check(!summary({ root, sources: { agent, usb, via: [{ vid: '342D', pid: 'E479', name: 'P75' }], eqapo: false } }).show, 'dismissed: the card stays hidden while nothing new is said');
s = summary({ root, sources: { agent, usb: [...usb, { vid: '1532', pid: '0099', name: 'Razer thing' }], via: [{ vid: '342D', pid: 'E479', name: 'P75' }] } });
check(s.show, 'something new shows it again');

// a PC like Shawn's: everything built in, nothing installed, only Bluetooth adapters unknown: nothing to say
const shawn = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-autosetup-shawn-'));
fs.cpSync(path.join(REAL, 'docs', 'brands.json'), path.join(shawn, 'docs', 'brands.json'), { recursive: true });
const shawnUsb = [{ vid: '1b1c', pid: '0a6b', name: 'CORSAIR HS80 RGB Wireless Gaming Headset', runs: 'Headset page' }, { vid: '3710', pid: '5406', name: null, runs: 'Mouse page' }, { vid: '342d', pid: 'e479', name: null, runs: 'Keyboard page' },
  { vid: '291a', pid: '3369', name: 'Anker PowerConf C200', runs: 'camera mic (Sound)' }, { vid: '0489', pid: 'e116', name: 'TP-Link Bluetooth Adapter', runs: null }, { vid: '8087', pid: '0025', name: 'Intel(R) Wireless Bluetooth(R)', runs: null }];
r = await run({ root: shawn, usb: shawnUsb, load: async () => [] });
s = summary({ root: shawn, sources: { agent, usb: shawnUsb, eqapo: true, openrgb: { running: false }, pcLights: true } });
check(r.lastRun.installed.length === 0 && !s.show && s.learn.length === 0, `a PC with only built-in devices gets no card (${JSON.stringify(s.learn)})`);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(shawn, { recursive: true, force: true });
console.log(fails.length ? `auto-setup: FAILED: ${fails.join('; ')}` : 'auto-setup (library self-check, auto install, setup summary): all good');
process.exit(fails.length ? 1 : 0);
