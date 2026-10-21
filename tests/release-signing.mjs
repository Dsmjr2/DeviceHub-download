// Updates install only what DeviceHub's publisher signed (21 Oct 2026, security review). A local page stands in for
// the GitHub download page and offers unsigned, altered and wrongly signed releases: each must be refused. Where the
// publisher's key is on this PC, a properly signed one must be accepted. No network, no devices: part of npm test.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { payload } from '../helpers/sign-release.mjs';
const require = createRequire(import.meta.url);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

let served = {};
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(served)); });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
process.env.DEVICEHUB_RELEASE_URL = `http://127.0.0.1:${srv.address().port}/`;
const { releaseInfo } = require('../helpers/self-update.js');
const refused = async (v) => { served = v; try { await releaseInfo(); return false; } catch (e) { return /not signed/.test(e.message); } };

const base = { commit: 'abc123def456', builtAt: '2026-10-21T20:00:00.000Z', appCommit: '0123456789abcdef0123456789abcdef01234567', size: 1000, sha256: 'a'.repeat(64) };
check(await refused(base), 'an unsigned release was accepted');
const other = crypto.generateKeyPairSync('ed25519').privateKey;
check(await refused({ ...base, signature: crypto.sign(null, Buffer.from(payload(base)), other).toString('base64') }), 'a release signed with another key was accepted');
check(await refused({ ...base, signature: 'not a signature' }), 'a release with a broken signature was accepted');

const key = path.join(process.env.APPDATA || '', 'DeviceHub-signing', 'release-key.pem');
if (fs.existsSync(key)) {
  const mine = crypto.createPrivateKey(fs.readFileSync(key));
  const good = { ...base, signature: crypto.sign(null, Buffer.from(payload(base)), mine).toString('base64') };
  served = good; let ok = false; try { ok = (await releaseInfo()).sha256 === base.sha256; } catch {}
  check(ok, 'a release signed by the publisher was refused');
  check(await refused({ ...good, sha256: 'b'.repeat(64) }), 'a signed release with a changed checksum was accepted');
  check(await refused({ ...good, appCommit: 'f'.repeat(40) }), 'a signed release pointing at other code was accepted');
}
srv.close();
if (fails.length) { console.log(`release signing: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log(`release signing: all checks passed${fs.existsSync(key) ? '' : ' (publisher key not on this PC: signed case skipped)'}`);
