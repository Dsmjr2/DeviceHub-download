// Signs a release (21 Oct 2026, security review): version.json gets an Ed25519 signature over its version, size and
// SHA-256, made with the publisher's private key, which lives only on the publishing PC
// (%APPDATA%\DeviceHub-signing\release-key.pem, never in git or the zip). Copies check it against the public key in
// helpers/release-public-key.pem (helpers/self-update.js) and install only what it signs, so someone who got into the
// GitHub account could not push an update. The first run makes the key pair.
//   node helpers/sign-release.mjs dist/version.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { keyAvailable, loadKey } from './signing-key.mjs';   // locked to this Windows login since 22 Oct 2026
import { readPublished, cleanNotes } from './release-notes.mjs';

const dir = path.join(process.env.APPDATA || '', 'DeviceHub-signing');
const priv = path.join(dir, 'release-key.pem');
const pub = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'release-public-key.pem');

// what is signed: these fields, in this order (helpers/self-update.js releasePayload reads it the same way)
export const payload = (v) => JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256]);
// (27 Oct 2026, readable versions) the version number and what's new (helpers/release-notes.mjs) are signed too, by a
// second signature over everything: copies made before 27 Oct check only `signature` over the fields above, so they
// keep accepting the new version.json; newer copies also check `signature2` (helpers/self-update.js verifyRelease)
export const payload2 = (v) => JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256, v.version ?? null, v.notes ?? null]);
// (27 Oct 2026, smaller updates) the list of every file's SHA-256 (DeviceHub-files.json.gz, helpers/update-files.js): its
// size and SHA-256 in `files`, signed by a third signature over everything; copies from before ignore it
export const payload3 = (v) => JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256, v.version ?? null, v.notes ?? null, v.files?.size ?? null, v.files?.sha256 ?? null]);
export function signRelease(v, key) {
  const out = { ...v };
  delete out.signature; delete out.signature2; delete out.signature3;
  out.signature = crypto.sign(null, Buffer.from(payload(out)), key).toString('base64');
  if (out.version != null || out.notes != null) out.signature2 = crypto.sign(null, Buffer.from(payload2(out)), key).toString('base64');
  if (out.files != null) out.signature3 = crypto.sign(null, Buffer.from(payload3(out)), key).toString('base64');
  return out;
}

if (process.argv[2]) {
  if (!keyAvailable()) {
    if (fs.existsSync(pub)) {
      // plain words for the publisher (23 Oct 2026): what to do, in order; a new key pair is never made here, as every
      // installed copy would then refuse the update
      const backup = fs.existsSync(path.join(dir, 'release-key.backup.pem'));
      console.error([
        `The signing key is not on this PC (looked in ${dir}). Nothing was uploaded.`,
        'Copies only install an update signed with the same key that signed the version they have, so:',
        '  1. Publish from the PC that published last time (the key is in that PC\'s %APPDATA%\\DeviceHub-signing).',
        backup ? '  2. Or restore it here from release-key.backup.pem: node helpers/signing-key.mjs --restore (type its password, Enter).'
          : '  2. Or copy release-key.backup.pem from that PC into this folder, then: node helpers/signing-key.mjs --restore (type its password, Enter).',
        '  Do not make a new key: every installed copy would refuse the update.',
      ].join('\n'));
      process.exit(1);
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(`made the signing key ${priv} and the public key ${pub}`);
  }
  const file = process.argv[2];
  const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  // the version number and what's new, from helpers/published-version.json (27 Oct 2026; publish-release.ps1 writes it)
  const pv = readPublished();
  if (pv) { v.version = pv.version; v.notes = cleanNotes(pv.notes); }
  const signed = signRelease(v, loadKey());
  // check it with the public key the app carries before it is published
  const pk = crypto.createPublicKey(fs.readFileSync(pub));
  if (!crypto.verify(null, Buffer.from(payload(signed)), pk, Buffer.from(signed.signature, 'base64'))
    || (signed.signature2 && !crypto.verify(null, Buffer.from(payload2(signed)), pk, Buffer.from(signed.signature2, 'base64')))
    || (signed.signature3 && !crypto.verify(null, Buffer.from(payload3(signed)), pk, Buffer.from(signed.signature3, 'base64')))) { console.error('the signature does not match the app\'s public key'); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify(signed));
  console.log(`   release signed${signed.version ? ` (DeviceHub ${signed.version})` : ''}`);
}
