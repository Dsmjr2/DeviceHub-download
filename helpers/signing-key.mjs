// The publisher's signing key, loaded for helpers/sign-release.mjs and helpers/make-library-bundle.mjs. Since 4 Nov 2026
// (Shawn: Bitwarden is the one place for every secret, so any PC with Claude and GitHub can publish) it is
// DEVICEHUB_RELEASE_KEY, an item in Bitwarden's Automation folder that `secrets run` (Dsmjr2/setup) hands to the
// process as an environment variable; publishing runs that way (helpers/publish-release.ps1). It is never on disk: the
// DPAPI-locked release-key.dpapi it replaced (22 Oct) is gone. A key that is not the one the app trusts
// (helpers/release-public-key.pem) is refused, so a wrong item can never sign a release.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const NAME = 'DEVICEHUB_RELEASE_KEY';
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'release-public-key.pem');

export const keyAvailable = () => !!(process.env[NAME] || '').trim();

// a PEM, or the base64 of the PKCS#8 form (one line, as a Bitwarden Password field holds it)
export function keyFromValue(value) {
  const v = String(value || '').trim();
  return v.includes('-----BEGIN') ? crypto.createPrivateKey(v) : crypto.createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' });
}

// the private key's public half is the one in helpers/release-public-key.pem
export function matchesPublic(key) {
  const mine = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  return mine.equals(crypto.createPublicKey(fs.readFileSync(PUBLIC)).export({ type: 'spki', format: 'der' }));
}

// the private key (a KeyObject); throws in plain words when it cannot be had
export function loadKey() {
  if (!keyAvailable()) throw new Error(`${NAME} is not set: publish through \`secrets run\` (Bitwarden, Automation folder), e.g. secrets run powershell -File helpers\\publish-release.ps1`);
  let key;
  try { key = keyFromValue(process.env[NAME]); } catch { throw new Error(`${NAME} is not a signing key (check the Bitwarden item's Password field)`); }
  if (!matchesPublic(key)) throw new Error(`${NAME} is not the key the app trusts (helpers/release-public-key.pem): nothing was signed. Never make a new key; installed copies would refuse every update`);
  return key;
}
