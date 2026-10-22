// The work behind helpers/protect-signing-key.ps1 (22 Oct 2026): reads the password from stdin, writes the encrypted
// backup and the DPAPI-locked key, checks both against the plain key and the app's public key, then removes the plain key.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLAIN, LOCKED, BACKUP, lockPem, loadKey } from './signing-key.mjs';

const pass = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const pubFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'release-public-key.pem');
const plainPem = fs.readFileSync(PLAIN, 'utf8');
const key = crypto.createPrivateKey(plainPem);
const der = (k) => k.export({ type: 'pkcs8', format: 'der' }).toString('hex');

fs.writeFileSync(BACKUP, key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass }), { mode: 0o600 });
lockPem(key.export({ type: 'pkcs8', format: 'pem' }));

const fromBackup = crypto.createPrivateKey({ key: fs.readFileSync(BACKUP), passphrase: pass });
const fromLocked = loadKey();   // reads release-key.dpapi now that it exists
const msg = Buffer.from('devicehub signing check');
const pub = crypto.createPublicKey(fs.readFileSync(pubFile));
const ok = der(fromBackup) === der(key) && der(fromLocked) === der(key) && crypto.verify(null, msg, pub, crypto.sign(null, msg, fromLocked));
if (!ok) { console.error('the locked key or the backup did not match'); fs.rmSync(LOCKED, { force: true }); process.exit(1); }
fs.rmSync(PLAIN);
console.log('   locked to this Windows login, backup written, plain key removed');
