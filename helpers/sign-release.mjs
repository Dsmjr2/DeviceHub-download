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

const dir = path.join(process.env.APPDATA || '', 'DeviceHub-signing');
const priv = path.join(dir, 'release-key.pem');
const pub = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'release-public-key.pem');

// what is signed: these fields, in this order (helpers/self-update.js releasePayload reads it the same way)
export const payload = (v) => JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256]);

if (process.argv[2]) {
  if (!keyAvailable()) {
    if (fs.existsSync(pub)) { console.error(`no signing key at ${priv}, but a public key is in the app: put the key back (or make a new pair and ship the new public key first)`); process.exit(1); }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
    console.log(`made the signing key ${priv} and the public key ${pub}`);
  }
  const file = process.argv[2];
  const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  delete v.signature;
  v.signature = crypto.sign(null, Buffer.from(payload(v)), loadKey()).toString('base64');
  // check it with the public key the app carries before it is published
  if (!crypto.verify(null, Buffer.from(payload(v)), crypto.createPublicKey(fs.readFileSync(pub)), Buffer.from(v.signature, 'base64'))) { console.error('the signature does not match the app\'s public key'); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify(v));
  console.log('   release signed');
}
