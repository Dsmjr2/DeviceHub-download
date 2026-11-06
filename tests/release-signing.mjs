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
const src0 = (f) => fs.readFileSync(new URL(`../helpers/${f}`, import.meta.url), 'utf8');

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

// (5 Nov 2026, security audit) a copy without the public key refuses every update, even one with no signature at all
{
  served = base; let msg = '';
  try { await releaseInfo(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'no-such-key.pem')); } catch (e) { msg = e.message; }
  check(/public key .* is missing/.test(msg), 'a copy without the public key believed an unsigned update');
  // (6 Nov 2026) an empty key file is refused the same way, and the refusal is named so Settings can say it plainly
  const empty = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'dh-key-')), 'release-public-key.pem');
  fs.writeFileSync(empty, '');
  let e2 = null; try { await releaseInfo(empty); } catch (e) { e2 = e; }
  check(e2?.keyMissing === true && /missing or unreadable/.test(e2.message), 'a copy with an empty public key file did not refuse the update as key missing');
  const su = fs.readFileSync(new URL('../helpers/self-update.js', import.meta.url), 'utf8');
  check((su.match(/e\.keyMissing \? \{ keyMissing: true \}/g) || []).length === 2, 'the update check does not pass the missing key on to the app (zip and git copies)');
  check(/s\.keyMissing \? 'Updates are refused: the publisher\\'s key is missing on this PC/.test(fs.readFileSync(new URL('../public/pages/settings.js', import.meta.url), 'utf8')), 'Settings does not say plainly that updates are refused without the key');
  // (6 Nov 2026) the zip copy's own version id is the whole commit too; a copy on 1.59 or older compares it as a plain
  // string (rel.commit !== own.commit plus builtAt), so a 40-character id is simply a newer version to it
  check(/\$commit = \(git rev-parse HEAD\)\.Trim\(\)/.test(src0('make-installer.ps1')), 'make-installer.ps1 still writes a short version commit id');
  check(/git\(\['rev-parse', 'HEAD'\]\)/.test(src0('release-notes.mjs')), 'release-notes.mjs still records a short commit for the published version');
  check(/rel\.commit !== own\.commit && rel\.builtAt > own\.builtAt/.test(su), 'the zip update check no longer compares versions the way older copies do');
  const { fullCommit } = require('../helpers/self-update.js')._test;
  check(fullCommit('0123456789abcdef0123456789abcdef01234567'), 'a whole 40-character commit id was refused');
  check(!fullCommit('0123456789ab') && !fullCommit('abc1234') && !fullCommit(null) && !fullCommit('g'.repeat(40)), 'a short or malformed signed commit id was accepted for merging');
  const src = (f) => fs.readFileSync(new URL(`../helpers/${f}`, import.meta.url), 'utf8');
  check(/\(G rev-parse HEAD\)\.Trim\(\)\s*$/.test(src('publish-code.ps1')) && !/\(G rev-parse --short/.test(src('publish-code.ps1')), 'publish-code.ps1 does not hand the whole commit id to the release');
  check(/\$appCommit -notmatch '\^\[0-9a-f\]\{40\}\$'/.test(src('make-installer.ps1')), 'make-installer.ps1 still signs a short app commit id');
  check(/\$rel\.appCommit -match '\^\[0-9a-f\]\{40\}\$'/.test(src('install.ps1')), 'install.ps1 still ties a copy to a short app commit id');
}
// the publisher's key, when this run has it (secrets run: DEVICEHUB_RELEASE_KEY from Bitwarden, since 4 Nov 2026)
const sk = await import('../helpers/signing-key.mjs');
if (sk.keyAvailable()) {
  const mine = sk.loadKey();
  const good = { ...base, signature: crypto.sign(null, Buffer.from(payload(base)), mine).toString('base64') };
  served = good; let ok = false; try { ok = (await releaseInfo()).sha256 === base.sha256; } catch {}
  check(ok, 'a release signed by the publisher was refused');
  check(await refused({ ...good, sha256: 'b'.repeat(64) }), 'a signed release with a changed checksum was accepted');
  check(await refused({ ...good, appCommit: 'f'.repeat(40) }), 'a signed release pointing at other code was accepted');
  // (27 Oct 2026) a properly signed release with a version number slipped in unsigned is refused by releaseInfo itself
  check(await refused({ ...good, version: '9.9', notes: ['Free money'], signature2: good.signature }), 'a signed release with an added, unsigned version number was accepted');
}
// the key from the environment (4 Nov 2026): missing, not a key, or not the app's key: refused, nothing signed
{
  const saved = process.env[sk.NAME];
  const refusedWith = (v) => { if (v == null) delete process.env[sk.NAME]; else process.env[sk.NAME] = v; try { sk.loadKey(); return null; } catch (e) { return e.message; } };
  check(/not set/.test(refusedWith(null) || ''), 'a missing DEVICEHUB_RELEASE_KEY was not refused in plain words');
  check(/not a signing key/.test(refusedWith('hello') || ''), 'a DEVICEHUB_RELEASE_KEY that is not a key was not refused');
  const stranger = crypto.generateKeyPairSync('ed25519').privateKey;
  check(/not the key the app trusts/.test(refusedWith(stranger.export({ type: 'pkcs8', format: 'der' }).toString('base64')) || ''), 'a key the app does not trust (base64) was accepted');
  check(/not the key the app trusts/.test(refusedWith(stranger.export({ type: 'pkcs8', format: 'pem' })) || ''), 'a key the app does not trust (PEM) was accepted');
  if (saved == null) delete process.env[sk.NAME]; else process.env[sk.NAME] = saved;
}
// readable versions (27 Oct 2026): version and notes are signed by signature2; signature stays over the old fields, so a
// copy from before 27 Oct (which checks only that) still accepts the new version.json. With a throwaway key pair.
{
  const { signRelease, payload2 } = await import('../helpers/sign-release.mjs');
  const { verifyRelease } = require('../helpers/self-update.js')._test;
  const t = crypto.generateKeyPairSync('ed25519');
  const pem = t.publicKey.export({ type: 'spki', format: 'pem' });
  // exactly what copies before 27 Oct do (helpers/self-update.js releaseInfo as of 21 Oct 2026)
  const oldClient = (v) => { try { return !!v.signature && crypto.verify(null, Buffer.from(JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256])), crypto.createPublicKey(pem), Buffer.from(v.signature, 'base64')); } catch { return false; } };
  const fresh = signRelease({ ...base, version: '1.5', notes: ['Any VIA keyboard connects by itself', 'Mic EQ no longer asked for'] }, t.privateKey);
  check(typeof fresh.commit === 'string' && fresh.commit === base.commit, 'the new version.json lost its commit field');
  check(!!fresh.signature && !!fresh.signature2, 'a release with a version number lacks one of its two signatures');
  check(oldClient(fresh), 'a copy from before 27 Oct refuses the new version.json');
  check(verifyRelease(fresh, pem), 'the new version.json is refused by a new copy');
  check(!verifyRelease({ ...fresh, version: '9.9' }, pem), 'a changed version number was accepted');
  check(!verifyRelease({ ...fresh, notes: ['Free money'] }, pem), 'changed notes were accepted');
  const noSig2 = { ...fresh }; delete noSig2.signature2;
  check(!verifyRelease(noSig2, pem), 'a version number without its signature was accepted');
  check(!verifyRelease({ ...fresh, signature: 'x' }, pem), 'a release with a broken first signature was accepted');
  const plain = signRelease({ ...base }, t.privateKey);
  check(!plain.signature2 && verifyRelease(plain, pem) && oldClient(plain), 'a release with no version number (as before 27 Oct) was refused, or got a second signature');
  check(payload2(fresh) === JSON.stringify([base.commit, base.builtAt, base.appCommit, base.size, base.sha256, '1.5', fresh.notes]), 'signature2 does not cover every field, the version and the notes');
}
srv.close();
if (fails.length) { console.log(`release signing: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log(`release signing: all checks passed${sk.keyAvailable() ? ' (publisher key checked)' : ' (DEVICEHUB_RELEASE_KEY not set: signed case skipped)'}`);
