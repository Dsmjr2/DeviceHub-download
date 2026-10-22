// "Share this driver" (22 Oct 2026; helpers/share-route.mjs): a clean driver gets a package and a GitHub link no longer
// than GitHub takes (the driver in the link, or the attach fallback when it is too long); a folder with anything
// personal is refused with file, line and reason; my-devices and the library are never written. Pretend driver folders
// in TEMP only; nothing is opened and nothing is sent anywhere.
// Run: node tests/share-route.mjs (no hardware, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { options, handle, check, prepare, makeLink, MAX_URL, ISSUES } from '../helpers/share-route.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-share-'));
fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
const opened = [];
Object.assign(options, { root, staging: path.join(root, 'share-staging'), names: ['zorblax'], openFolder: (dir) => opened.push(dir) });
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const driver = (id, title, extra = '') => `${extra}export default { id: '${id}', title: '${title}', kind: 'Mouse',
  settings: [{ key: 'dpi', label: 'DPI', type: 'slider', min: 100, max: 3200 }, { key: 'rate', label: 'Polling rate', type: 'choice', options: [{ value: 1000, label: '1000 Hz' }] }],
  hid: { vid: '1234', pid: 'ABCD', page: 'FF00', len: 20 }, unsupported: ['firmware updates'],
  async connect() { return true; }, async info() { return {}; }, async read() { return { dpi: 800, rate: 1000 }; }, async write(k, v) { return v; } };\n`;
const verified = (keys) => JSON.stringify({ checkedAt: '2026-10-22T10:00:00.000Z', driver: 'acme-mouse', keys });
const snapshot = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort().join('|') : '';

// a fake request and response for handle()
async function call(pathname, body, method = 'POST') {
  const out = { code: null, body: null };
  const handled = await handle(new URL(`http://127.0.0.1:5577${pathname}`), { method }, {}, (res, code, b) => { out.code = code; out.body = b; }, async () => body);
  return { handled, ...out };
}

// 1. clean, every setting passed the self-check: tested, the driver goes in the link
put('my-devices/acme/device.mjs', driver('acme-mouse', 'Acme Pro mouse', '// Acme Pro: DPI and polling rate, bytes seen in a capture. A ``` in a comment.\n'));
put('my-devices/acme/verified.json', verified({ dpi: { ok: true, value: 800, readBack: 800 }, rate: { ok: true, value: 1000, readBack: 1000 } }));
const before = snapshot(path.join(root, 'my-devices'));
let r = await call('/api/share/check', { name: 'acme' });
ok(r.handled && r.code === 200 && r.body.ok && r.body.status === 'tested' && r.body.usb === '1234:abcd', `a clean driver passes the check as tested (${JSON.stringify(r.body)})`);
ok(r.body.stays?.includes('verified.json') && r.body.shared?.length === 2, 'the check says what is shared and what stays on this PC');
ok(!fs.existsSync(options.staging) || !fs.readdirSync(options.staging).length, 'the check keeps nothing');
r = await call('/api/share/prepare', { name: 'acme', by: '  Pat  ' });
const p = r.body;
ok(r.code === 200 && p.ok && p.method === 'issue', `a short driver goes in the GitHub link (${p.method} ${p.error || ''})`);
ok(p.url?.startsWith(`${ISSUES}?`) && p.url.length <= MAX_URL, `the link opens GitHub's new-issue form and fits (${p.url?.length} <= ${MAX_URL})`);
const q = new URL(p.url).searchParams;
ok(q.get('body')?.includes("id: 'acme-mouse'") && q.get('body').includes('````js') && /Library: Acme Pro mouse/.test(q.get('title')), 'the body carries the driver in a code block whose fence is longer than any ``` in it');
ok(JSON.parse(p.files['device.json']).status === 'tested' && JSON.parse(p.files['device.json']).tested.at(-1).by === 'Pat', 'device.json says tested and the public name');
ok(within(options.staging, p.folder) && fs.existsSync(path.join(p.folder, 'device.mjs')) && fs.existsSync(path.join(p.folder, 'device.json')), 'the entry is made in the staging folder');
ok(snapshot(path.join(root, 'my-devices')) === before && !fs.existsSync(path.join(root, 'device-library')), 'my-devices and the library are not written');
ok(!fs.readdirSync(options.staging).some((f) => f.startsWith('.work-')), 'no work folder is left behind');
r = await call('/api/share/prepare', { name: 'acme' });
ok(r.body.ok && r.body.folder === p.folder, `preparing again replaces the earlier package (${r.body.error || ''})`);

// 2. one setting not proven: read-only
put('my-devices/acme2/device.mjs', driver('acme-mouse', 'Acme Lite mouse'));
put('my-devices/acme2/verified.json', verified({ dpi: { ok: true, value: 800, readBack: 800 }, rate: { ok: false, why: 'wrote 1000, read back 500' } }));
r = await call('/api/share/check', { name: 'acme2' });
ok(r.body.ok && r.body.status === 'read-only' && /1 of 2/.test(r.body.statusWhy), `a setting that did not pass makes it read-only (${r.body.status}: ${r.body.statusWhy})`);
put('my-devices/acme3/device.mjs', driver('acme-three', 'Acme Three mouse'));
r = await check('acme3');
ok(r.ok && r.status === 'read-only' && /no self-check record/.test(r.statusWhy), 'a driver with no self-check record is read-only');

// 3. too long for a link: device.json only, the driver saved to attach, its folder opened on request
put('my-devices/big/device.mjs', driver('big-mouse', 'Bigco Huge mouse', `// ${'protocol notes '.repeat(900)}\n`));
r = await call('/api/share/prepare', { name: 'big' });
const b = r.body;
ok(b.ok && b.method === 'attach' && b.url.length <= MAX_URL, `a long driver falls back to attaching it (${b.method}, ${b.url?.length})`);
ok(b.attach && fs.existsSync(b.attach.file) && fs.readFileSync(b.attach.file, 'utf8').includes("id: 'big-mouse'") && /\.txt$/.test(b.attach.name), 'the driver is saved as a .txt to attach');
ok(new URL(b.url).searchParams.get('body').includes(b.attach.name) && !new URL(b.url).searchParams.get('body').includes('protocol notes'), 'the fallback body names the file to attach and carries no driver text');
r = await call('/api/share/open-folder', { entry: b.entry });
ok(r.code === 200 && opened.length === 1 && opened[0] === b.folder, 'open-folder shows the prepared folder (and nothing else)');
r = await call('/api/share/open-folder', { entry: '../my-devices' });
ok(r.code === 400 && opened.length === 1, 'open-folder refuses anything but a prepared entry');
const huge = makeLink({ entry: 'x-y', title: 'X', meta: { kind: 'Mouse', vid: '1234', pids: ['abcd'], status: 'read-only', works: ['a'.repeat(9000)], tested: [{}] }, deviceJson: '{}', driver: 'x', attachName: 'x-y.device.mjs.txt' });
ok(huge.method === 'attach' && huge.url.length <= MAX_URL, `even a huge device.json gives a link that fits (${huge.url.length})`);

// 4. personal things are refused, with file, line and how to fix it
put('my-devices/leaky/device.mjs', driver('leaky-mouse', 'Leaky mouse', "// found in C:\\Users\\jdoe\\AppData\\Local\\Maker\nconst who = 'me@mailhost.net';\n// built on zorblax's PC\n"));
put('my-devices/leaky/backups/mouse-2026.json', '{}');
put('my-devices/leaky/capture1.pcapng', 'x');
const stagedBefore = snapshot(options.staging);
r = await call('/api/share/check', { name: 'leaky' });
const ref = r.body.refused || [];
const has = (file, line, re) => ref.some((x) => x.file === file && (line == null || x.line === line) && re.test(x.why) && x.fix);
ok(r.code === 200 && r.body.ok === false, 'a personal folder is refused');
ok(has('device.mjs', 1, /user's name/) && has('device.mjs', 2, /e-mail/) && has('device.mjs', 3, /computer name/), `each personal line is named with its reason (${JSON.stringify(ref)})`);
ok(has('backups/', null, /backups/) && has('capture1.pcapng', null, /capture/), 'personal files and folders are named');
ok(ref.every((x) => typeof x.text === 'string' && /^[A-Z]/.test(x.fix)), 'every refusal has plain words and a fix');
r = await call('/api/share/prepare', { name: 'leaky' });
ok(r.body.ok === false && r.body.refused?.length && snapshot(options.staging) === stagedBefore, 'prepare refuses it too and keeps nothing');

// 5. bad requests
r = await call('/api/share/check', { name: '..\\..\\Windows' });
ok(r.code === 400 && !r.body.ok, 'a path instead of a folder name is refused');
r = await call('/api/share/check', { name: 'nothere' });
ok(r.code === 400 && /no driver/.test(r.body.error), 'a folder with no driver is refused');
r = await prepare('acme', 'pat@mailhost.net');
ok(!r.ok && /public name/.test(r.error), 'an e-mail address as the public name is refused');
r = await call('/api/share/check', {}, 'GET');
ok(r.code === 405, 'only POST');
ok((await call('/api/library', {})).handled === false, 'other routes are left to server.js');

fs.rmSync(root, { recursive: true, force: true });
function within(parent, child) { return path.resolve(child).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep); }
console.log(fails.length ? `share route: FAILED: ${fails.join('; ')}` : 'share route (one-click driver sharing): all good');
process.exit(fails.length ? 1 : 0);
