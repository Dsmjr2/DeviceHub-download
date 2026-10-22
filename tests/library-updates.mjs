// Library updates (22 Oct 2026; helpers/library-updates.mjs, helpers/make-library-bundle.mjs): a signed bundle served
// from a LOCAL http server (never GitHub), signed with a throwaway key pair, is accepted and written to library-cache\;
// unsigned, altered, wrong-key, app-release-signed and older bundles are refused and the cache stays; an entry whose
// text does not match its SHA-256 is refused alone; offline and a hung server keep the cache; nothing fetched is run;
// once a day; the routes answer. Everything happens in a TEMP folder.
// Run: node tests/library-updates.mjs (no hardware, no network beyond 127.0.0.1)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import * as lu from '../helpers/library-updates.mjs';
import { makeBundle } from '../helpers/make-library-bundle.mjs';
import { payload as releasePayload } from '../helpers/sign-release.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
delete process.env.DEVICEHUB_LIBRARY_UPDATES;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-libupd-'));
const src = path.join(tmp, 'publisher'), root = path.join(tmp, 'copy');
fs.mkdirSync(path.join(root, 'helpers'), { recursive: true });
const ranFile = path.join(tmp, 'RAN.txt').replace(/\\/g, '/');
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); fs.writeFileSync(path.join(src, rel), text); };
// a driver that would leave a file behind if anything ran it
const driver = (id) => `import fs from 'node:fs'; fs.writeFileSync('${ranFile}', 'ran');\nexport default { id: '${id}', title: 'Acme', kind: 'Mouse', settings: [], async connect() { return true; }, async info() { return {}; }, async read() { return {}; }, async write(k, v) { return v; } };\n`;
const meta = (o) => JSON.stringify({ id: 'acme-mouse', vendor: 'Acme', product: 'Pro mouse', kind: 'Mouse', vid: '1234', pids: ['abcd'], models: ['Acme Pro'], works: ['DPI'], status: 'tested', tested: [{ by: 'test', date: '2026-10-20', devicehub: '0.1.0' }], ...o });
write('device-library/acme-pro-mouse/device.mjs', driver('acme-mouse'));
write('device-library/acme-pro-mouse/device.json', meta());
write('device-library/acme-reader/device.mjs', driver('acme-reader'));
write('device-library/acme-reader/device.json', meta({ id: 'acme-reader', pids: ['abcf'], status: 'read-only', tested: [], updated: '2026-10-21' }));
write('device-library/_example-x/device.mjs', driver('example-x'));
write('device-library/_example-x/device.json', meta({ id: 'example-x' }));
write('device-library/broken/device.mjs', driver('broken'));
write('device-library/broken/device.json', '{ "vid": ');

const keys = crypto.generateKeyPairSync('ed25519'), other = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(root, 'helpers', 'release-public-key.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
const at = (d) => () => new Date(d);
const build = (d = '2026-10-22T10:00:00.000Z', key = keys.privateKey) => makeBundle({ root: src, privateKey: key, now: at(d) });

// the builder
const { bundle: good, skipped } = build();
check(good.entries.map((e) => e.name).join() === 'acme-pro-mouse,acme-reader', `the bundle holds the entries, no example, no broken one (${good.entries.map((e) => e.name)})`);
check(skipped.some((s) => s.name === 'broken' && !s.included), 'the broken entry is reported as left out');
check(good.entries.every((e) => e.sha256 === lu.sha256(e.mjs)), 'each entry carries its device.mjs SHA-256');
check(lu.verifyBundle(good, keys.publicKey.export({ type: 'spki', format: 'pem' })).ok, 'the builder\'s bundle verifies');
check(!crypto.verify(null, Buffer.from(releasePayload(good)), keys.publicKey, Buffer.from(good.signature, 'base64')), 'a library bundle\'s signature does not pass as an app release');

// a local server
let served = null, hits = 0, hang = false;
const srv = http.createServer((req, res) => {
  hits++;
  if (hang) return;  // never answers
  if (req.url !== '/device-library.json' || served == null) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(typeof served === 'string' ? served : JSON.stringify(served));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/device-library.json`;
const run = (o = {}) => lu.check({ root, url, timeoutMs: 1500, now: at('2026-10-22T12:00:00.000Z'), ...o });
const cacheText = () => { try { return fs.readdirSync(lu.cacheRoot(root)).filter((n) => !n.endsWith('.json')).sort().map((n) => n + ':' + fs.readFileSync(path.join(lu.cacheRoot(root), n, 'device.mjs'), 'utf8').length).join(); } catch { return ''; } };

check(lu.cacheRoot(root) === path.join(root, 'library-cache'), 'the cache is library-cache\\ (not my-devices or device-library)');

// nothing published yet
served = null;
let r = await run();
check(!r.ok && /404/.test(r.error), `a missing bundle is an error, not a crash (${r.error})`);

// good bundle accepted
served = good;
r = await run();
check(r.ok, `a good bundle is accepted (${r.error})`);
check(r.entries.map((e) => e.name).join() === 'acme-pro-mouse,acme-reader', `both entries are cached (${r.entries.map((e) => e.name)})`);
check(fs.readFileSync(path.join(root, 'library-cache', 'acme-pro-mouse', 'device.mjs'), 'utf8') === good.entries[0].mjs, 'the cached driver is the signed text');
check(JSON.parse(fs.readFileSync(path.join(root, 'library-cache', 'acme-reader', 'device.json'), 'utf8')).updated === '2026-10-21', 'the cached device.json is the signed one');
check(!fs.existsSync(path.join(root, 'my-devices')) && !fs.existsSync(path.join(root, 'device-library')), 'nothing was written to my-devices or device-library');
check(!fs.existsSync(ranFile), 'nothing fetched was run');
check(!fs.readdirSync(lu.cacheRoot(root)).some((n) => n.startsWith('.')), 'no staging folder is left behind');
const goodCache = cacheText();

const refusedKeepsCache = async (bundle, what, re) => {
  served = bundle;
  const x = await run();
  check(!x.ok && (!re || re.test(x.error || '')), `${what} is refused (${x.ok ? 'accepted' : x.error})`);
  check(cacheText() === goodCache, `${what}: the cache stays as it was`);
  check(!fs.existsSync(ranFile), `${what}: nothing was run`);
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const later = build('2026-10-23T10:00:00.000Z').bundle;

// unsigned
const unsigned = clone(later); delete unsigned.signature;
await refusedKeepsCache(unsigned, 'an unsigned bundle', /not signed/);
// altered after signing: a signed list hash changed, then the driver text to match it
const altered = clone(later); altered.entries[0].mjs += '\n// evil'; altered.entries[0].sha256 = lu.sha256(altered.entries[0].mjs); altered.list[0].sha256 = altered.entries[0].sha256;
await refusedKeepsCache(altered, 'an altered bundle', /not signed by/);
const redated = clone(later); redated.builtAt = '2026-10-30T00:00:00.000Z';
await refusedKeepsCache(redated, 'a bundle with a changed date', /not signed by/);
// wrong key
await refusedKeepsCache(build('2026-10-23T10:00:00.000Z', other.privateKey).bundle, 'a bundle signed with another key', /not signed by/);
// a bundle signed as an app release (the release payload over version.json-shaped fields)
const asRelease = clone(later); Object.assign(asRelease, { commit: 'abc', appCommit: null, size: 1, sha256: 'a'.repeat(64) });
asRelease.signature = crypto.sign(null, Buffer.from(releasePayload(asRelease)), keys.privateKey).toString('base64');
await refusedKeepsCache(asRelease, 'a bundle signed as an app release', /not signed by/);
// an app release's version.json itself
const version = { commit: 'abc', builtAt: '2026-10-23T10:00:00.000Z', appCommit: null, size: 1, sha256: 'a'.repeat(64) };
version.signature = crypto.sign(null, Buffer.from(releasePayload(version)), keys.privateKey).toString('base64');
await refusedKeepsCache(version, 'an app release (version.json)', /not a DeviceHub library bundle/);
// not JSON, too old
await refusedKeepsCache('<!DOCTYPE html>', 'an HTML page', /not JSON/);
await refusedKeepsCache(build('2026-10-01T00:00:00.000Z').bundle, 'an older bundle', /older/);

// an entry whose text does not match its signed SHA-256: refused alone, its last good copy kept, the other updated
fs.writeFileSync(path.join(src, 'device-library', 'acme-pro-mouse', 'device.mjs'), driver('acme-mouse') + '// v2\n');
fs.writeFileSync(path.join(src, 'device-library', 'acme-reader', 'device.mjs'), driver('acme-reader') + '// v2\n');
const two = clone(build('2026-10-24T10:00:00.000Z').bundle);
two.entries[0].mjs += '// tampered\n';
served = two;
r = await run();
check(r.ok && r.refused.some((x) => x.name === 'acme-pro-mouse' && /SHA-256/.test(x.why)), `a tampered entry is refused alone (${JSON.stringify(r.refused)})`);
check(fs.readFileSync(path.join(root, 'library-cache', 'acme-pro-mouse', 'device.mjs'), 'utf8') === good.entries[0].mjs, 'the tampered entry\'s last good copy stays');
check(fs.readFileSync(path.join(root, 'library-cache', 'acme-reader', 'device.mjs'), 'utf8').endsWith('// v2\n'), 'the other entry is updated');
// a path-trick or Windows device name in a signed bundle is refused
const tricky = build('2026-10-24T11:00:00.000Z').bundle;
for (const bad of ['..', 'nul', 'a/b', '_hidden']) check(lu.entryProblem(bad, tricky.entries[0].meta), `the name "${bad}" is refused`);

// withdrawn: a newer signed bundle without an entry removes it from the cache
fs.rmSync(path.join(src, 'device-library', 'acme-reader'), { recursive: true });
served = build('2026-10-25T10:00:00.000Z').bundle;
r = await run();
check(r.ok && r.removed.includes('acme-reader') && !fs.existsSync(path.join(root, 'library-cache', 'acme-reader')), 'an entry the publisher withdrew leaves the cache');
const nowCache = cacheText();

// offline: nothing listening
srv.close(); await new Promise((res) => setTimeout(res, 50));
r = await run();
check(!r.ok && /could not fetch/.test(r.error) && r.entries.length === 1 && cacheText() === nowCache, `offline keeps the cache (${r.error})`);
check(lu.status(root).lastSuccessAt && lu.status(root).errors.length === 1, 'the state keeps the last good check and names the error');

// a server that never answers: the check gives up on time
const hung = http.createServer(() => {}); await new Promise((res) => hung.listen(0, '127.0.0.1', res));
const t0 = Date.now();
r = await lu.check({ root, url: `http://127.0.0.1:${hung.address().port}/device-library.json`, timeoutMs: 400 });
check(!r.ok && /timed out/.test(r.error) && Date.now() - t0 < 3000 && cacheText() === nowCache, `a hung server times out and keeps the cache (${r.error}, ${Date.now() - t0} ms)`);
hung.closeAllConnections?.(); hung.close();

// once a day
const srv2 = http.createServer((req, res) => { hits++; res.writeHead(404); res.end(); });
await new Promise((res) => srv2.listen(0, '127.0.0.1', res));
const url2 = `http://127.0.0.1:${srv2.address().port}/device-library.json`;
hits = 0;
const last = Date.parse(lu.readState(root).lastCheckAt);
r = await lu.checkIfDue({ root, url: url2, now: () => new Date(last + 60 * 60 * 1000) });
check(r.skipped && hits === 0, 'a second check within a day is skipped');
r = await lu.checkIfDue({ root, url: url2, now: () => new Date(last + 25 * 60 * 60 * 1000) });
check(!r.skipped && hits === 1, 'a check after a day goes out');
process.env.DEVICEHUB_LIBRARY_UPDATES = '0';
hits = 0;
r = await lu.checkIfDue({ root, url: url2, now: () => new Date(last + 50 * 60 * 60 * 1000) });
check(r.skipped && hits === 0, 'off means no check');
delete process.env.DEVICEHUB_LIBRARY_UPDATES;

// the routes
const call = async (method, p) => { let out = null; const handled = await lu.handle(new URL(`http://x${p}`), { method }, {}, (res, code, body) => { out = { code, body }; }, { root, url: url2, timeoutMs: 1000 }); return { handled, ...out }; };
let a = await call('GET', '/api/library/updates');
check(a.handled && a.code === 200 && Array.isArray(a.body.entries) && 'lastCheckAt' in a.body && Array.isArray(a.body.errors), 'GET /api/library/updates answers with the state');
a = await call('POST', '/api/library/update');
check(a.handled && a.code === 502 && /404/.test(a.body.error) && a.body.entries.length === 1, 'POST /api/library/update checks now and reports the error');
a = await call('GET', '/api/library');
check(a.handled === false, 'other paths are left to server.js');
srv2.close();

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log(`library updates: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log('library updates: all good');
