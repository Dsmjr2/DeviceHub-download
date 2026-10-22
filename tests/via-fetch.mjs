// helpers/via-fetch.mjs ("Get the layout") offline: a local stand-in server plays raw.githubusercontent.com (the
// request stand-in sends each https://raw.githubusercontent.com/... address to it, so the real host and HTTPS checks
// run unchanged), and files are saved to a temporary folder. Nothing touches the network or via-definitions.
// Covers: a good file saved (and drawn), same-host redirect followed, wrong vid/pid refused, too big refused (said and
// unsaid), off-host and plain-HTTP redirects refused, HTML refused (by type and by body), bad JSON, an existing file
// kept, no known source, the route, the KLE drawing against a known layout, and the shipped index's shape.
// Run: node tests/via-fetch.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import * as vf from '../helpers/via-fetch.mjs';
import { keymapToKeys } from '../public/devices/via-kle.js';
import { fromDefinition } from '../public/devices/via-layout.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// ---- a small made-up board in a maker's format (KLE drawing): 2 x 8 matrix, 14 keys, a knob, one layout option ----
const board = (vid = '0x3434', pid = '0x0810', extra = {}) => JSON.stringify({
  name: 'Test Board ANSI', vendorId: vid, productId: pid, matrix: { rows: 2, cols: 8 },
  layouts: { keymap: [
    [{ c: '#777777' }, '0,0', { x: 0.25, c: '#cccccc' }, '0,1', '0,2', '0,3', '0,4', '0,5', '0,6', { x: 0.25 }, '0,7\n\n\n\n\n\n\n\n\ne0'],
    [{ y: 0.25, w: 1.5 }, '1,0', '1,1', '1,2', '1,3', '1,4', { w: 2.25 }, '1,5\n\n\n0,0', { x: 1 }, '1,6\n\n\n0,1', '1,7\n\n\n0,1'],
  ] }, ...extra,
});

// ---- the stand-in site ----
const routes = new Map();   // path -> (req, res)
const seen = [];
const server = http.createServer((req, res) => { seen.push(req.url); const f = routes.get(req.url.split('?')[0]); if (f) f(req, res); else { res.writeHead(404); res.end('no'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
vf.deps.request = (u) => new Promise((resolve, reject) => {
  const x = new URL(u);
  check(x.protocol === 'https:' && x.hostname === 'raw.githubusercontent.com', `only https://raw.githubusercontent.com is ever asked (asked ${u})`);
  http.get({ host: '127.0.0.1', port, path: x.pathname + x.search }, (res) => resolve({ status: res.statusCode, headers: res.headers, body: res })).on('error', reject);
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-via-fetch-'));
vf.deps.dir = tmp;
const C = 'a'.repeat(40);
const entry = (p) => ({ name: 'Test Board ANSI', commit: C, path: `keyboards/keychron/test/via_json/${p}.json`, size: 900 });
vf.deps.sources = { sources: { keychron: { repo: 'Keychron/qmk_firmware' } }, files: {
  '34340810': entry('good'), '34340811': entry('wrong'), '34340812': entry('big'), '34340813': entry('bigchunked'),
  '34340814': entry('offhost'), '34340815': entry('plainhttp'), '34340816': entry('html'), '34340817': entry('htmlbody'),
  '34340818': entry('badjson'), '34340819': entry('moved'), '3434081A': entry('nokeys'), '3434081B': entry('good'),
} };
const at = (p) => `/Keychron/qmk_firmware/${C}/keyboards/keychron/test/via_json/${p}.json`;
const serve = (p, body, type = 'text/plain; charset=utf-8', headers = {}) => routes.set(at(p), (req, res) => { res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers }); res.end(body); });
const saved = (f) => fs.existsSync(path.join(tmp, f));

// a good file: saved under the exact name, as served, and it draws
serve('good', board());
let p = vf.plan('3434', '0810');
check(p.file === '34340810.json' && !p.have && p.source?.host === 'raw.githubusercontent.com' && p.source.url.startsWith('https://raw.githubusercontent.com/Keychron/qmk_firmware/' + C + '/') && p.source.size === 900, `plan names the file, host and size (${JSON.stringify(p)})`);
let r = await vf.get('3434', '0810');
check(r.ok && r.file === '34340810.json' && r.host === 'raw.githubusercontent.com' && r.size === Buffer.byteLength(board()) && r.restart === true, `good file saved (${JSON.stringify(r)})`);
check(saved('34340810.json') && fs.readFileSync(path.join(tmp, '34340810.json'), 'utf8') === board(), 'saved exactly as served');
check(r.keys === 14 && r.rows === 2 && r.cols === 8, `the saved file draws 14 keys (${r.keys})`);
check(vf.plan('3434', '0810').have, 'plan then says the file is there');
r = await vf.get('3434', '0810');
check(!r.ok && /already there/.test(r.error), 'an existing file is never replaced');

// lower-case ids are the same keyboard
r = await vf.get('3434', '081b');
check(!r.ok && /is for USB 3434:0810, not this keyboard \(3434:081B\)/.test(r.error) && !saved('3434081B.json'), `the file's own ids must match (${r.error})`);

// wrong vid/pid
serve('wrong', board('0x3434', '0x0999'));
r = await vf.get('3434', '0811');
check(!r.ok && /3434:0999, not this keyboard/.test(r.error) && !saved('34340811.json'), `wrong product id refused (${r.error})`);

// too big: said in Content-Length, and sent without it
const huge = board('0x3434', '0x0812', { pad: 'x'.repeat(vf.MAX_BYTES) });
serve('big', huge);
r = await vf.get('3434', '0812');
check(!r.ok && /larger than 512\.0 KB/.test(r.error) && !saved('34340812.json'), `too big refused (${r.error})`);
routes.set(at('bigchunked'), (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); const s = board('0x3434', '0x0813', { pad: 'x'.repeat(vf.MAX_BYTES) }); res.write(s.slice(0, 300000)); res.end(s.slice(300000)); });
r = await vf.get('3434', '0813');
check(!r.ok && /larger than/.test(r.error) && !saved('34340813.json'), `too big without a length refused (${r.error})`);

// redirects: off the host, and to plain HTTP on the same name, are refused before anything is asked there
routes.set(at('offhost'), (req, res) => { res.writeHead(302, { Location: 'https://evil.example.net/keyboards.json' }); res.end(); });
r = await vf.get('3434', '0814');
check(!r.ok && /went to evil\.example\.net, which is not raw\.githubusercontent\.com/.test(r.error) && !saved('34340814.json'), `off-host redirect refused (${r.error})`);
routes.set(at('plainhttp'), (req, res) => { res.writeHead(301, { Location: 'http://raw.githubusercontent.com/x.json' }); res.end(); });
r = await vf.get('3434', '0815');
check(!r.ok && /not HTTPS/.test(r.error) && !saved('34340815.json'), `HTTP redirect refused (${r.error})`);
check(!seen.some((u) => u === '/x.json' || u.includes('keyboards.json')), 'nothing was asked at a refused address');
// a redirect on the same host is followed
serve('moved-to', board('0x3434', '0x0819'));
routes.set(at('moved'), (req, res) => { res.writeHead(302, { Location: at('moved-to') }); res.end(); });
r = await vf.get('3434', '0819');
check(r.ok && saved('34340819.json'), `same-host redirect followed (${JSON.stringify(r)})`);

// HTML: by its type, and a page sent as text
serve('html', '<!DOCTYPE html><html><body>Not found</body></html>', 'text/html; charset=utf-8');
r = await vf.get('3434', '0816');
check(!r.ok && /web page/.test(r.error) && !saved('34340816.json'), `HTML refused (${r.error})`);
serve('htmlbody', '<!DOCTYPE html><html></html>');
r = await vf.get('3434', '0817');
check(!r.ok && /web page/.test(r.error) && !saved('34340817.json'), `HTML sent as text refused (${r.error})`);

// not JSON; JSON without a usable layout
serve('badjson', '{ "name": "Test", ');
r = await vf.get('3434', '0818');
check(!r.ok && /not valid JSON/.test(r.error) && !saved('34340818.json'), `bad JSON refused (${r.error})`);
serve('nokeys', JSON.stringify({ name: 'Test', vendorId: '0x3434', productId: '0x081A', matrix: { rows: 2, cols: 8 }, layouts: { keymap: [['0,0', '0,1']] } }));
r = await vf.get('3434', '081A');
check(!r.ok && /not a layout DeviceHub can draw \(the definition has too few keys\)/.test(r.error) && !saved('3434081A.json'), `too few keys refused (${r.error})`);

// a keyboard with no known source; a bad id
r = await vf.get('1234', '5678');
check(!r.ok && /does not know an official VIA file/.test(r.error), 'no known source: one sentence, nothing asked');
let threw = null; try { vf.plan('34g4', '0810'); } catch (e) { threw = e.message; }
check(threw === 'That is not a USB id.', 'a bad id is refused');

// the route
const sendTo = () => { const out = {}; return [out, (res, code, body) => { out.code = code; out.body = body; }]; };
let [o, send] = sendTo();
check(await vf.handle(new URL('http://x/api/via-fetch?vid=3434&pid=0810'), { method: 'GET' }, null, send) && o.code === 200 && o.body.have === true, 'GET /api/via-fetch');
[o, send] = sendTo();
check(await vf.handle(new URL('http://x/api/via-fetch'), { method: 'POST' }, null, send, async () => ({ vid: '3434', pid: '0811' })) && o.code === 200 && o.body.ok === false, 'POST /api/via-fetch answers a refusal as data');
[o, send] = sendTo();
check(await vf.handle(new URL('http://x/api/via-fetch?vid=zz&pid=1'), { method: 'GET' }, null, send) && o.code === 400, 'a bad id answers 400');
check(!(await vf.handle(new URL('http://x/api/via-fetchx'), { method: 'GET' }, null, () => {})), 'other paths are not taken');

// the KLE drawing: positions, the knob, the option group's first choice
const k = keymapToKeys(JSON.parse(board()).layouts.keymap);
const kk = (row, col) => k.keys.find((x) => x.row === row && x.col === col);
check(kk(0, 1).x === 1.25 && kk(0, 7).x === 7.5 && kk(0, 7).ei === 0 && kk(1, 0).y === 1.25 && kk(1, 0).w === 1.5 && kk(1, 1).x === 1.5, `KLE positions (${JSON.stringify(k.keys.slice(0, 3))})`);
check(k.optionKeys['0']['0'].length === 1 && k.optionKeys['0']['1'].length === 2 && k.optionKeys['0']['1'][0].x === k.optionKeys['0']['0'][0].x, 'layout option choices are moved onto choice 0');
const lay = fromDefinition(JSON.parse(board()));
check(lay.keys.length === 14 && lay.keys.filter((x) => x.knob).length === 1 && lay.keys.some((x) => x.row === 1 && x.col === 5 && x.w === 2.25) && !lay.keys.some((x) => x.row === 1 && x.col === 6), 'fromDefinition uses choice 0 only');

// the shipped index: every entry pinned to a commit, a via_json path, a sane size
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'via-sources.json'), 'utf8'));
const ents = Object.entries(idx.files || {});
check(ents.length > 100 && ents.every(([id, e]) => /^[0-9A-F]{8}$/.test(id) && /^[0-9a-f]{40}$/.test(e.commit) && /^keyboards\/(keychron|lemokey)\/[^?#]+\/via_json\/[^/]+\.json$/.test(e.path) && e.size > 0 && e.size < vf.MAX_BYTES), 'via-sources.json: every entry pinned and in a via_json folder');
check(idx.files['34340610'] && idx.files['34340810'], 'the index has the Q1 Pro and Q1 Max');

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log(`via-fetch: ${fails.length} failed`); for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
console.log('via-fetch: all checks passed');
