// A newer library driver reaches the copy already installed (24 Oct 2026; helpers/library-refresh.mjs,
// docs/handoff/smoother-for-friends.md): a friend's Logitech mouse kept its old driver because a my-devices copy was
// never replaced. Checked in a TEMP folder: a newer entry replaces the copy (old files in backups\, verified.json moved
// so the self-check runs again, settingsOn kept, library.json says what changed); an older or equal entry, a learned
// copy, a copy with settings learned on this PC, a person's own driver and a driver whose id changed are left alone;
// a check made before the update no longer counts; the loaded driver says a newer one waits for a restart.
// Run: node tests/library-refresh.mjs (no hardware, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshInstalled } from '../helpers/library-refresh.mjs';
import { guard, loadedDriverChanged, driverShaOf, NEWER_DRIVER_LINE } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-librefresh-'));
const root = path.join(tmp, 'copy');
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), typeof text === 'string' ? text : JSON.stringify(text, null, 2)); };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const driver = (id, tag) => `export default { id: '${id}', title: 'Acme ${tag}', kind: 'Mouse', settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }], async connect() { return true; }, async info() { return {}; }, async read() { return { dpi: 800 }; }, async write(k, v) { return v; } };\n// ${tag}\n`;
const meta = (id, pid, updated, o = {}) => ({ id, vendor: 'Acme', product: `Mouse ${id}`, kind: 'Mouse', vid: '1234', pids: [pid], models: ['Acme'], works: ['DPI'], status: 'read-only', tested: [], updated, ...o });
const entry = (name, id, pid, updated, tag, o) => { put(`device-library/${name}/device.mjs`, driver(id, tag)); put(`device-library/${name}/device.json`, meta(id, pid, updated, o)); };
const copy = (name, id, pid, updated, tag, mark = {}) => {
  put(`my-devices/${name}/device.mjs`, driver(id, tag)); put(`my-devices/${name}/device.json`, meta(id, pid, updated));
  put(`my-devices/${name}/library.json`, { source: `device-library/${name}`, name, id, status: 'read-only', installedAt: '2026-10-22T00:00:00.000Z', settingsOn: { at: '2026-10-22T01:00:00.000Z' }, ...mark });
  put(`my-devices/${name}/verified.json`, { checkedAt: '2026-10-22T02:00:00.000Z', keys: { dpi: { ok: true, value: 800, readBack: 800, at: '2026-10-22T02:00:00.000Z' } } });
};

// the friend's case: a fix published with a newer "updated" date
entry('acme-mouse', 'acme-mouse', 'aaa1', '2026-10-23', 'new');
copy('acme-mouse', 'acme-mouse', 'aaa1', '2026-10-22', 'old');
// the same date: nothing to do
entry('acme-same', 'acme-same', 'aaa2', '2026-10-22', 'new');
copy('acme-same', 'acme-same', 'aaa2', '2026-10-22', 'old');
// the copy is newer than the library: left alone
entry('acme-ahead', 'acme-ahead', 'aaa3', '2026-10-20', 'new');
copy('acme-ahead', 'acme-ahead', 'aaa3', '2026-10-22', 'old');
// learned on this PC: never replaced
entry('acme-learned', 'acme-learned', 'aaa4', '2026-10-23', 'new');
copy('acme-learned', 'acme-learned', 'aaa4', '2026-10-22', 'old', { learned: true });
entry('acme-keys', 'acme-keys', 'aaa5', '2026-10-23', 'new');
copy('acme-keys', 'acme-keys', 'aaa5', '2026-10-22', 'old', { learnedKeys: ['led'] });
// the newer driver changed its id: the running DeviceHub knows the device by its id, so it is not put in
entry('acme-renamed', 'acme-other', 'aaa6', '2026-10-23', 'new');
copy('acme-renamed', 'acme-renamed', 'aaa6', '2026-10-22', 'old');
// a person's own driver (no library.json) with a library entry of the same name: never touched
entry('acme-own', 'acme-own', 'aaa7', '2026-10-23', 'new');
put('my-devices/acme-own/device.mjs', driver('acme-own', 'own')); put('my-devices/acme-own/device.json', meta('acme-own', 'aaa7', '2026-10-01'));

// changed by hand on this PC since it was installed (31 Oct 2026): its installedSha no longer matches, so it is kept
entry('acme-edited', 'acme-edited', 'aaa8', '2026-10-23', 'new');
copy('acme-edited', 'acme-edited', 'aaa8', '2026-10-22', 'old');
{
  const installedSha = driverShaOf(path.join(root, 'my-devices', 'acme-edited'));
  put('my-devices/acme-edited/device.mjs', driver('acme-edited', 'edited'));
  const m = JSON.parse(read('my-devices/acme-edited/library.json'));
  put('my-devices/acme-edited/library.json', { ...m, installedSha });
}

const oldSha = driverShaOf(path.join(root, 'my-devices', 'acme-mouse'));
const logs = [];
const r = await refreshInstalled({ root, log: (l) => logs.push(l.text), now: () => new Date('2026-10-24T08:00:00.000Z') });
check(r.replaced.map((x) => x.name).join() === 'acme-mouse', `only the newer copy is replaced (${r.replaced.map((x) => x.name)})`);
check(read('my-devices/acme-mouse/device.mjs').includes('// new') && JSON.parse(read('my-devices/acme-mouse/device.json')).updated === '2026-10-23', 'the copy now holds the newer driver and device.json');
const mark = JSON.parse(read('my-devices/acme-mouse/library.json'));
check(mark.updatedFromLibrary?.from === '2026-10-22' && mark.updatedFromLibrary?.to === '2026-10-23' && mark.settingsOn?.at, `library.json says what changed and keeps settingsOn (${JSON.stringify(mark.updatedFromLibrary)})`);
check(!fs.existsSync(path.join(root, 'my-devices/acme-mouse/verified.json')), 'verified.json is moved aside, so the self-check runs again');
const backs = fs.readdirSync(path.join(root, 'backups', 'library-drivers'));
check(backs.length === 1 && fs.readFileSync(path.join(root, 'backups', 'library-drivers', backs[0], 'device.mjs'), 'utf8').includes('// old') && fs.existsSync(path.join(root, 'backups', 'library-drivers', backs[0], 'verified.json')), 'the old files are kept in backups\\library-drivers');
check(r.skipped.some((x) => x.name === 'acme-edited' && /changed on this PC/.test(x.why)), `a driver changed by hand is kept and said (${JSON.stringify(r.skipped.find((x) => x.name === 'acme-edited'))})`);
check(mark.installedSha === driverShaOf(path.join(root, 'my-devices', 'acme-mouse')), 'an updated copy records its new driver hash');
for (const [n, tag] of [['acme-edited', 'edited'], ['acme-same', 'old'], ['acme-ahead', 'old'], ['acme-learned', 'old'], ['acme-keys', 'old'], ['acme-renamed', 'old'], ['acme-own', 'own']]) check(read(`my-devices/${n}/device.mjs`).includes(`// ${tag}`), `${n} is left as it was`);
check(r.skipped.some((s) => s.name === 'acme-learned' && /learning wizard/.test(s.why)), 'a learned copy is named as skipped');
check(r.skipped.some((s) => s.name === 'acme-keys' && /learned on this PC/.test(s.why)), 'a copy with learned settings is named as skipped');
check(r.skipped.some((s) => s.name === 'acme-renamed' && /id/.test(s.why)), 'a driver whose id changed is named as skipped');
check(logs.some((t) => /Mouse acme-mouse driver was updated \(2026-10-22 -> 2026-10-23\)/.test(t)), `the log says which driver was updated (${logs.join(' | ')})`);
// a second run changes nothing
const r2 = await refreshInstalled({ root });
check(!r2.replaced.length, 'a second run changes nothing');

// the loaded driver: the device page line until a restart
check(loadedDriverChanged(path.join(root, 'my-devices', 'acme-mouse'), oldSha), 'the driver loaded before the update is seen as changed on disk');
check(!loadedDriverChanged(path.join(root, 'my-devices', 'acme-mouse'), driverShaOf(path.join(root, 'my-devices', 'acme-mouse'))), 'a driver loaded after the update is not');
check(/^A newer driver is ready\. Restart DeviceHub/.test(NEWER_DRIVER_LINE), 'the page line says it in plain words');

// a check made before the update no longer lets a setting write
const folder = path.join(root, 'my-devices', 'acme-mouse');
put('my-devices/acme-mouse/verified.json', { checkedAt: '2026-10-23T00:00:00.000Z', keys: { dpi: { ok: true, value: 800, readBack: 800, at: '2026-10-23T00:00:00.000Z' } } });
const a = (await import(`file:///${folder.replace(/\\/g, '/')}/device.mjs?t=${Date.now()}`)).default;
guard(a, folder, JSON.parse(read('my-devices/acme-mouse/library.json')), { log: () => {}, makerApp: async () => null });
check(a.settings.find((s) => s.key === 'dpi').readOnly, 'a self-check from before the driver update does not count');
const b = (await import(`file:///${folder.replace(/\\/g, '/')}/device.mjs?u=${Date.now()}`)).default;
put('my-devices/acme-mouse/verified.json', { checkedAt: '2026-10-25T00:00:00.000Z', keys: { dpi: { ok: true, value: 800, readBack: 800, at: '2026-10-25T00:00:00.000Z' } } });
guard(b, folder, JSON.parse(read('my-devices/acme-mouse/library.json')), { log: () => {}, makerApp: async () => null });
check(!b.settings.find((s) => s.key === 'dpi').readOnly, 'a self-check after the update counts as before');

// 2 Nov 2026 (safety): a setting a library update ADDS to a driver whose settings were turned on before it is not
// turned on by that old press: it stays read-only and is never self-checked until a new press; the old ones carry on.
{
  const two = (id, tag, keys) => `export const writes = [];\nexport default { id: '${id}', title: 'Acme ${tag}', kind: 'Mouse', settings: [${keys.map((k) => `{ key: '${k}', label: '${k.toUpperCase()}', type: 'slider', min: 0, max: 3200 }`).join(', ')}], async connect() { return true; }, async info() { return {}; }, async read() { return { ${keys.map((k) => `${k}: 800`).join(', ')} }; }, async write(k, v) { writes.push(k); return v; } };\n// ${tag}\n`;
  const name = 'acme-grow';
  put(`device-library/${name}/device.mjs`, two(name, 'new', ['dpi', 'led'])); put(`device-library/${name}/device.json`, meta(name, 'aab1', '2026-10-23'));
  copy(name, name, 'aab1', '2026-10-22', 'old');   // settingsOn { at } with no keys list: an old press
  put(`my-devices/${name}/device.mjs`, two(name, 'old', ['dpi']));
  const r3 = await refreshInstalled({ root, now: () => new Date('2026-10-24T09:00:00.000Z') });
  check(r3.replaced.some((x) => x.name === name), 'the growing driver is replaced');
  const gm = JSON.parse(read(`my-devices/${name}/library.json`));
  check(JSON.stringify(gm.settingsOn?.keys) === '["dpi"]' && /self-check record/.test(gm.settingsOn.keysFrom || ''), `the old press is written down as the settings its driver checked (${JSON.stringify(gm.settingsOn)})`);
  const gf = path.join(root, 'my-devices', name);
  const mod = await import(`file:///${gf.replace(/\\/g, '/')}/device.mjs?g=${Date.now()}`);
  const g = mod.default;
  guard(g, gf, gm, { log: () => {}, makerApp: async () => null, backup: async () => {}, version: 'v1', now: () => new Date('2026-10-25T00:00:00.000Z') });
  check(g.library.turnOn, 'the page shows Turn on settings for the new setting');
  await g.connect();
  check(JSON.stringify(mod.writes) === '["dpi"]', `the connect's self-check writes only the setting turned on before (${JSON.stringify(mod.writes)})`);
  check(!g.settings.find((s) => s.key === 'dpi').readOnly && g.settings.find((s) => s.key === 'led').readOnly, 'the old setting works, the new one is read-only');
  let refused = '';
  try { await g.write('led', 900); } catch (e) { refused = e.message; }
  check(/not turned on yet/.test(refused), `writing the new setting is refused until a press (${refused})`);
  check(await g.write('dpi', 900) === 900, 'writing the old setting still works');
  mod.writes.length = 0;
  const t = await g.turnOn();
  check(t.on && mod.writes.includes('led'), `after the press the new setting is self-checked (${JSON.stringify(t.why || mod.writes)})`);
  check(!g.settings.find((s) => s.key === 'led').readOnly && await g.write('led', 900) === 900 && !g.library.turnOn, 'after the press the new setting works');
  check(JSON.parse(read(`my-devices/${name}/library.json`)).settingsOn.keys.includes('led'), 'the press keeps its keys list');

  // a copy a library update replaced BEFORE this rule (no keys list, its verified.json in the backup): the keys come
  // from the record of the driver it was pressed for, so the setting the update added is not on
  const old = 'acme-early';
  put(`my-devices/${old}/device.mjs`, two(old, 'new', ['dpi', 'led'])); put(`my-devices/${old}/device.json`, meta(old, 'aab2', '2026-10-23'));
  put(`my-devices/${old}/library.json`, { source: `device-library/${old}`, name: old, id: old, status: 'read-only', settingsOn: { at: '2026-10-22T01:00:00.000Z' }, updatedFromLibrary: { at: '2026-10-23T05:00:00.000Z', from: '2026-10-22', to: '2026-10-23' } });
  put(`backups/library-drivers/${old}-2026-10-23T05-00-00-000Z/verified.json`, { checkedAt: '2026-10-22T02:00:00.000Z', keys: { dpi: { ok: true, value: 800, readBack: 800, at: '2026-10-22T02:00:00.000Z' } } });
  const ef = path.join(root, 'my-devices', old);
  const emod = await import(`file:///${ef.replace(/\\/g, '/')}/device.mjs?e=${Date.now()}`);
  guard(emod.default, ef, JSON.parse(read(`my-devices/${old}/library.json`)), { log: () => {}, makerApp: async () => null, backup: async () => {}, version: 'v1' });
  await emod.default.connect();
  check(JSON.stringify(emod.writes) === '["dpi"]' && emod.default.library.turnOn, `a copy updated before the rule: only the setting pressed for is self-checked (${JSON.stringify(emod.writes)})`);
  check(JSON.stringify(JSON.parse(read(`my-devices/${old}/library.json`)).settingsOn.keys) === '["dpi"]', 'and its keys list is written down');
}

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log(`library refresh: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log('library refresh: all good');
