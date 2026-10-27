// Smaller updates (27 Oct 2026, helpers/update-files.js): only changed files are downloaded, every file is checked
// against the signed list, and anything the list cannot supply falls back to the whole zip.
//   node tests/update-files.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { signRelease } from '../helpers/sign-release.mjs';
const require = createRequire(import.meta.url);
const uf = require('../helpers/update-files.js');
const su = require('../helpers/self-update.js');

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('- ' + m); } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const entry = (buf, extra = {}) => ({ h: sha(buf), s: buf.length, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dh-update-files-'));
const put = (root, p, data) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), data); };
const COMMIT = 'a'.repeat(40);

// this copy: one file the same, one changed, a script with Windows line endings, the helper built from the same sources
const root = tmp();
const same = Buffer.from('same\n'), oldB = Buffer.from('old b\n'), newB = Buffer.from('new b\n');
const bat = Buffer.from('@echo off\r\necho hi\r\n'), srcHash = Buffer.from('abc\n'), helperExe = Buffer.from('MZ old helper');
put(root, 'a.js', same); put(root, 'b.js', oldB); put(root, 'run.bat', Buffer.from('@echo off\r\necho old\r\n'));
put(root, 'helpers/bin/helper-sources.sha256', srcHash); put(root, 'helpers/bin/DeviceHubHelper.exe', helperExe);
put(root, 'runtime/node.exe', Buffer.from('node'));
const made = Buffer.from('{"commit":"new"}');
const manifest = { commit: COMMIT, files: {
  'a.js': entry(same, { r: 1 }), 'b.js': entry(newB, { r: 1 }), 'run.bat': entry(bat, { r: 1 }),
  'release.json': entry(made, { d: made.toString('base64') }),
  'helpers/bin/helper-sources.sha256': entry(srcHash, { d: srcHash.toString('base64') }),
  'helpers/bin/DeviceHubHelper.exe': entry(Buffer.from('MZ new build, same sources'), { d: Buffer.from('MZ new build, same sources').toString('base64') }),
  'runtime/node.exe': entry(Buffer.from('node')),
} };
const asked = [];
const repo = { 'b.js': newB, 'run.bat': Buffer.from('@echo off\necho hi\n') };   // the repository keeps .bat with Unix endings
const fetchRaw = async (c, p) => { asked.push(p); ok(c === COMMIT, 'downloads from the signed commit'); return repo[p]; };
const dest = path.join(tmp(), 'DeviceHub');
const r = await uf.stage({ manifest, root, dest, fetchRaw });
ok(r.downloaded === 2 && asked.sort().join() === 'b.js,run.bat', `only the changed files are downloaded (${asked})`);
for (const [p, f] of Object.entries(manifest.files)) {
  if (p === 'helpers/bin/DeviceHubHelper.exe') continue;
  ok(fs.existsSync(path.join(dest, p)) && sha(fs.readFileSync(path.join(dest, p))) === f.h, `${p} is the new version's`);
}
ok(fs.readFileSync(path.join(dest, 'helpers/bin/DeviceHubHelper.exe')).equals(helperExe), 'the helper built from the same sources stays (no new program)');

// a changed helper source: the new helper comes from the list
put(root, 'helpers/bin/helper-sources.sha256', Buffer.from('other\n'));
const dest2 = path.join(tmp(), 'DeviceHub');
await uf.stage({ manifest, root, dest: dest2, fetchRaw });
ok(fs.readFileSync(path.join(dest2, 'helpers/bin/DeviceHubHelper.exe')).toString() === 'MZ new build, same sources', 'new helper sources: the release\'s helper');

// a download that does not match the list is refused
let threw = null;
try { await uf.stage({ manifest, root, dest: path.join(tmp(), 'D'), fetchRaw: async () => Buffer.from('tampered') }); } catch (e) { threw = e.message; }
ok(/does not match/.test(threw || ''), `a tampered download is refused (${threw})`);

// Node or a bundled tool that differs here: the whole zip
put(root, 'runtime/node.exe', Buffer.from('other node'));
threw = null;
try { await uf.stage({ manifest, root, dest: path.join(tmp(), 'D'), fetchRaw }); } catch (e) { threw = e.message; }
ok(/only the whole download/.test(threw || ''), `a changed Node means the whole zip (${threw})`);
put(root, 'runtime/node.exe', Buffer.from('node'));

// too many changes: the whole zip
threw = null;
try { await uf.stage({ manifest, root, dest: path.join(tmp(), 'D'), fetchRaw, maxFiles: 1 }); } catch (e) { threw = e.message; }
ok(/files changed/.test(threw || ''), `too many changes means the whole zip (${threw})`);

// the list itself: a path out of the folder is refused
const gz = (m) => zlib.gzipSync(Buffer.from(JSON.stringify(m)));
ok(uf.parseManifest(gz(manifest)).commit === COMMIT, 'a good list is read');
for (const bad of ['../evil.js', 'C:/Windows/x.dll', '/etc/x', 'a/../../b']) {
  threw = null;
  try { uf.parseManifest(gz({ commit: COMMIT, files: { [bad]: entry(same) } })); } catch (e) { threw = e.message; }
  ok(!!threw, `a list naming ${bad} is refused`);
}

// the list's size and SHA-256 are signed (signature3); an altered one is refused, and old releases still verify
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const base = { commit: 'c1', builtAt: '2026-10-27T00:00:00Z', appCommit: 'abc1234', size: 10, sha256: 'f'.repeat(64), version: '1.4', notes: ['x'] };
const signed = signRelease({ ...base, files: { size: 5, sha256: 'e'.repeat(64) } }, privateKey);
ok(su._test.verifyRelease(signed, pem), 'a signed file list verifies');
ok(!su._test.verifyRelease({ ...signed, files: { size: 5, sha256: 'd'.repeat(64) } }, pem), 'an altered file list is refused');
const noThird = { ...signed }; delete noThird.signature3;
ok(!su._test.verifyRelease(noThird, pem), 'a file list without its signature is refused');
ok(su._test.verifyRelease(signRelease(base, privateKey), pem), 'a release without a file list still verifies');

console.log(failed ? `${failed} failed` : 'update-files: all passed');
process.exit(failed ? 1 : 0);
