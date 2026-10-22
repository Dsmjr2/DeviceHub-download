// The device library (22 Oct 2026; helpers/device-library.mjs, helpers/share-device.mjs): USB devices find their
// entries, a tested entry installs into my-devices and loads, an install never writes over an existing folder, and
// sharing refuses a folder with anything personal in it. Everything happens in a TEMP copy; the real library is read.
// Run: node tests/device-library.mjs (no hardware)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, match, installFromLibrary, validateMeta } from '../helpers/device-library.mjs';
import { shareDevice, scanFolder } from '../helpers/share-device.mjs';
import { load } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-library-'));
const lib = path.join(root, 'device-library');
fs.cpSync(path.join(REAL, 'device-library'), lib, { recursive: true });
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const driver = (id, extra = '', title = 'Acme Pro mouse') => `export default { id: '${id}', title: '${title}', kind: 'Mouse', settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }],
  hid: { vid: '1234', pid: 'ABCD', page: 'FF00', len: 20 }, unsupported: ['firmware updates'],
  async connect() { return true; }, async info() { return {}; }, async read() { return { dpi: 800 }; }, async write(k, v) { return v; } };${extra}\n`;
const meta = (o) => JSON.stringify({ id: 'acme-mouse', vendor: 'Acme', product: 'Pro mouse', kind: 'Mouse', vid: '1234', pids: ['abcd', 'ABCE'], models: ['Acme Pro'], works: ['DPI'], status: 'tested', tested: [{ by: 'test', date: '2026-10-22', devicehub: '0.1.0' }], ...o });

// the real library: every entry is well formed; the example only shows in demo/test
delete process.env.DEVICEHUB_EXAMPLE_DEVICE;
const real = list({ root: REAL, examples: true });
check(real.length >= 1 && real.every((e) => !e.error), `every shipped library entry is well formed (${JSON.stringify(real.filter((e) => e.error).map((e) => [e.name, e.error]))})`);
check(!list({ root: REAL }).some((e) => e.name.startsWith('_')), 'the example entry is hidden outside demo/test');
check(/demo\/test/.test((await installFromLibrary('_example-light', { root })).error || ''), 'the example does not install outside demo/test');

// matching
write('device-library/acme-pro-mouse/device.mjs', driver('acme-mouse'));
write('device-library/acme-pro-mouse/device.json', meta());
write('device-library/acme-reader/device.mjs', driver('acme-reader'));
write('device-library/acme-reader/device.json', meta({ id: 'acme-reader', pids: ['abcf'], status: 'read-only' }));
write('device-library/broken-one/device.mjs', driver('broken-one'));
write('device-library/broken-one/device.json', '{ "vid": ');
const usb = [{ vid: '1234', pid: 'abce', name: 'Acme Pro (cable)' }, { vid: '046d', pid: 'c547', name: 'Logitech receiver' }, { vid: '1234', pid: 'ABCF', name: '' }];
let m = match(usb, { root });
const mb = Object.fromEntries(m.map((x) => [x.name, x]));
check(mb['acme-pro-mouse']?.installable === true && mb['acme-pro-mouse'].matched[0].pid === 'abce', `a USB device finds its tested entry by vid and any of its pids (${JSON.stringify(mb['acme-pro-mouse'])})`);
check(mb['acme-reader'] && mb['acme-reader'].installable === false && /read-only/.test(mb['acme-reader'].why), 'a read-only entry is found but not installable');
check(!mb['broken-one'] && list({ root }).find((e) => e.name === 'broken-one')?.error, 'a broken device.json is listed with its problem, never matched');
check(m.length === 2 && match([{ vid: '9999', pid: '0001' }], { root }).length === 0, 'devices with no entry match nothing');
check(/status/.test(validateMeta(JSON.parse(meta({ status: 'works' }))) || ''), 'an unknown status is refused');

// install, then it loads as a my-devices driver
let r = await installFromLibrary('acme-pro-mouse', { root });
check(r.ok && fs.existsSync(path.join(root, 'my-devices', 'acme-pro-mouse', 'device.mjs')), `a tested entry installs into my-devices (${JSON.stringify(r)})`);
const registered = [];
const loaded = await load(root, { register: (a) => registered.push(a), addSpec() {}, taken: (id) => registered.some((a) => a.id === id) });
check(loaded.some((x) => x.name === 'acme-pro-mouse' && x.id === 'acme-mouse'), `the installed driver loads on the next start (${JSON.stringify(loaded)})`);
check(match(usb, { root }).find((x) => x.name === 'acme-pro-mouse')?.why === 'already in my-devices', 'an installed entry says so');

// never over an existing folder
write('my-devices/acme-pro-mouse/device.mjs', '// the person changed this\n');
r = await installFromLibrary('acme-pro-mouse', { root });
check(!r.ok && /already exists/.test(r.error) && fs.readFileSync(path.join(root, 'my-devices', 'acme-pro-mouse', 'device.mjs'), 'utf8').includes('person changed'), `an install refuses to overwrite (${r.error})`);
write('my-devices/acme-reader/notes.txt', 'mine');
r = await installFromLibrary('acme-reader', { root });
check(!r.ok && /read-only/.test(r.error), 'a read-only entry does not install');
check(!(await installFromLibrary('../my-devices', { root })).ok && !(await installFromLibrary('nope', { root })).ok, 'odd names and missing entries are refused');

// the example installs and works in demo/test
process.env.DEVICEHUB_EXAMPLE_DEVICE = '1';
check(match([{ vid: 'FFFF', pid: 'FFE0' }], { root }).some((x) => x.name === '_example-light' && x.installable), 'the example matches in demo/test');
r = await installFromLibrary('_example-light', { root });
check(r.ok, `the example installs in demo/test (${r.error})`);
const ex = (await import(`file:///${path.join(root, 'my-devices', '_example-light', 'device.mjs').replace(/\\/g, '/')}`)).default;
check(ex.id === 'example-library-light' && (await ex.write('brightness', 33)) === 33, 'the installed example writes and reads back');
delete process.env.DEVICEHUB_EXAMPLE_DEVICE;

// share back: a clean driver makes an entry
write('my-devices/clean-mouse/device.mjs', driver('clean-mouse', '', 'Acme Clean mouse'));
write('my-devices/clean-mouse/notes.txt', 'remember to charge it');
r = await shareDevice(path.join(root, 'my-devices', 'clean-mouse'), { root, status: 'tested', by: 'tester', names: ['alicetest'] });
const made = r.ok && JSON.parse(fs.readFileSync(path.join(lib, r.name, 'device.json'), 'utf8'));
check(r.ok && r.name === 'acme-clean-mouse', `sharing names the entry vendor-product (${r.name || r.error})`);
check(made && made.vid === '1234' && made.pids[0] === 'abcd' && made.status === 'tested' && made.tested.at(-1).by === 'tester' && !validateMeta(made), `a clean driver becomes an entry with its device.json (${JSON.stringify(r.error || made)})`);
check(r.ok && fs.readdirSync(path.join(lib, r.name)).sort().join() === 'device.json,device.mjs' && r.leftOut.includes('notes.txt'), 'only device.mjs and device.json are written; other files are left out and listed');
const again = await shareDevice(path.join(root, 'my-devices', 'clean-mouse'), { root, status: 'tested', names: ['alicetest'] });
check(!again.ok && /already exists/.test(again.error), 'sharing never writes over a library entry');

// share back: anything personal is refused, and every reason is listed
const p = 'my-devices/personal-mouse';
write(`${p}/device.mjs`, driver('personal-mouse', `\n// read from C:\\Users\\alicetest\\Desktop\\dump.txt\nconst serialNumber = 'SN8XK2Q99';\n// paired with 3C:22:FB:10:AB:7E\n// USB\\VID_1234&PID_ABCD\\6&1A2B3C4D&0&1\n// ask alice@realmail.net\n// made by alicetest`));
write(`${p}/backups/before.json`, '{}');
write(`${p}/capture-dpi.pcapng`, 'x');
write(`${p}/server.log`, 'x');
write(`${p}/settings-dump.json`, '{}');
write(`${p}/eeprom.bin`, Buffer.from([0, 1, 2]));
const before = fs.readdirSync(lib).length;
r = await shareDevice(path.join(root, p), { root, status: 'tested', names: ['alicetest'] });
const why = (r.refused || []).map((x) => `${x.file}${x.line ? ':' + x.line : ''} ${x.why}`).join(' | ');
check(!r.ok && fs.readdirSync(lib).length === before, 'a refused share writes no entry');
for (const [what, re] of [['the backups folder', /backups\//], ['the capture', /pcapng.*capture/], ['the log', /server\.log/], ['the settings dump', /settings-dump/], ['the memory dump', /eeprom\.bin/],
  ['the user path', /device\.mjs:\d+ a path with a user/], ['the serial number', /serial number/], ['the MAC address', /MAC/], ['the instance id', /instance id/], ['the e-mail', /e-mail/], ['the user name', /user or computer name \("alicetest"\)/]]) {
  check(re.test(why), `sharing refuses ${what} (${why})`);
}
check(scanFolder(path.join(root, 'my-devices', 'clean-mouse'), { names: ['alicetest'] }).refused.length === 0, 'a clean folder has nothing refused');
check(scanFolder(path.join(REAL, 'device-library', '_example-light'), { names: [] }).refused.length === 0, 'the shipped example passes the personal scan');

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `device-library: FAILED: ${fails.join('; ')}` : 'device-library (find, install, share): all good');
process.exit(fails.length ? 1 : 0);
