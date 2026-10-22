// Builds the device library bundle (22 Oct 2026; docs/handoff/library-updates.md): dist\device-library.json holds every
// device-library entry (its device.json fields, its device.mjs text and that text's SHA-256), the bundle's date and a
// signed list of every entry's SHA-256. It is signed with the publisher's release key
// (%APPDATA%\DeviceHub-signing\release-key.pem, the same one helpers/sign-release.mjs uses) over a payload of its own
// (helpers/library-updates.mjs payload()), so a library bundle can never pass as an app release and an app release
// never as a library bundle. Copies fetch it beside version.json and check it with helpers/release-public-key.pem.
// It never makes a key: without the publisher's key it stops.
//   node helpers/make-library-bundle.mjs [out file, default dist/device-library.json]
// Entries whose name starts with "_" (examples) are left out; a broken entry is left out with a warning.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { KIND, FORMAT, payload, sha256, entryVersion, entryProblem } from './library-updates.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KEY_FILE = path.join(process.env.APPDATA || '', 'DeviceHub-signing', 'release-key.pem');

// { bundle, skipped: [{ name, why }] }. privateKey: a KeyObject or PEM; now: the bundle's date.
export function makeBundle({ root = ROOT, privateKey, now = () => new Date() } = {}) {
  const dir = path.join(root, 'device-library');
  const entries = [], skipped = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch {}
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const d = path.join(dir, name);
    let mjs, meta;
    try { mjs = fs.readFileSync(path.join(d, 'device.mjs'), 'utf8'); } catch { skipped.push({ name, why: 'no device.mjs' }); continue; }
    try { meta = JSON.parse(fs.readFileSync(path.join(d, 'device.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { skipped.push({ name, why: `device.json: ${e.message}` }); continue; }
    const why = entryProblem(name, meta);
    if (why) { skipped.push({ name, why }); continue; }
    const version = entryVersion(meta);
    if (!version) skipped.push({ name, why: 'included, but it has no "updated" or tested date, so it never replaces a shipped copy (add "updated" to its device.json)', included: true });
    entries.push({ name, version, sha256: sha256(mjs), metaSha256: sha256(JSON.stringify(meta)), meta, mjs });
  }
  const bundle = {
    kind: KIND, format: FORMAT,
    note: 'DeviceHub device library, signed by its publisher. Fetched by helpers/library-updates.mjs; never run when fetched.',
    builtAt: now().toISOString(),
    list: entries.map(({ name, version, sha256: s, metaSha256 }) => ({ name, version, sha256: s, metaSha256 })),
    entries: entries.map(({ name, version, sha256: s, meta, mjs }) => ({ name, version, sha256: s, meta, mjs })),
  };
  const key = typeof privateKey === 'string' || Buffer.isBuffer(privateKey) ? crypto.createPrivateKey(privateKey) : privateKey;
  if (!key) throw new Error('no signing key');
  bundle.signature = crypto.sign(null, Buffer.from(payload(bundle)), key).toString('base64');
  return { bundle, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'device-library.json'));
  if (!fs.existsSync(KEY_FILE)) { console.error(`no signing key at ${KEY_FILE}: the library bundle is signed only on the publishing PC`); process.exit(1); }
  const { bundle, skipped } = makeBundle({ privateKey: fs.readFileSync(KEY_FILE) });
  // check it with the public key the app carries before it is published
  const pub = crypto.createPublicKey(fs.readFileSync(path.join(ROOT, 'helpers', 'release-public-key.pem')));
  if (!crypto.verify(null, Buffer.from(payload(bundle)), pub, Buffer.from(bundle.signature, 'base64'))) { console.error('the library bundle\'s signature does not match the app\'s public key'); process.exit(1); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bundle));
  for (const s of skipped) console.log(`   ${s.included ? 'note' : 'left out'}: ${s.name}: ${s.why}`);
  console.log(`   library bundle signed: ${out} (${bundle.entries.length} entries, ${bundle.builtAt}); upload it beside version.json`);
}
