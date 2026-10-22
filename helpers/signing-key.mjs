// The publisher's signing key, loaded for helpers/sign-release.mjs and helpers/make-library-bundle.mjs (22 Oct 2026,
// Shawn: yes to "put a password on that signing key"). Since helpers/protect-signing-key.ps1 ran, the key is
// release-key.dpapi: Windows DPAPI, readable only by Shawn's Windows login on this PC, so a copy of the file (a backup, a
// stolen disk) is useless. The password-protected release-key.backup.pem restores it after a Windows reinstall
// (node helpers/signing-key.mjs --restore). Before that ran, the plain release-key.pem is read as it was.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DIR = path.join(process.env.APPDATA || '', 'DeviceHub-signing');
export const PLAIN = path.join(DIR, 'release-key.pem');
export const LOCKED = path.join(DIR, 'release-key.dpapi');
export const BACKUP = path.join(DIR, 'release-key.backup.pem');

const ps = (script, input) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const UNPROTECT = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::ASCII.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))";
const PROTECT = "Add-Type -AssemblyName System.Security; $b = [Text.Encoding]::ASCII.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))";

export const keyAvailable = () => fs.existsSync(LOCKED) || fs.existsSync(PLAIN);

// the private key (a KeyObject); throws in plain words when it cannot be had
export function loadKey() {
  if (fs.existsSync(LOCKED)) {
    let pem;
    try { pem = ps(UNPROTECT, fs.readFileSync(LOCKED, 'utf8')); } catch { throw new Error('the signing key is locked to another Windows login (or this Windows was reinstalled): restore it from the backup with node helpers/signing-key.mjs --restore'); }
    return crypto.createPrivateKey(pem);
  }
  if (fs.existsSync(PLAIN)) return crypto.createPrivateKey(fs.readFileSync(PLAIN));
  throw new Error(`no signing key in ${DIR}`);
}

// locks a PEM to this Windows login (used by protect-signing-key.ps1 and --restore)
export function lockPem(pem) { fs.writeFileSync(LOCKED, ps(PROTECT, pem).trim() + '\n', { mode: 0o600 }); }

// node helpers/signing-key.mjs --restore: the backup and its password give back the locked key on this PC
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')) && process.argv[2] === '--restore') {
  const pass = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  const key = crypto.createPrivateKey({ key: fs.readFileSync(BACKUP), passphrase: pass });
  lockPem(key.export({ type: 'pkcs8', format: 'pem' }));
  console.log('the signing key is back, locked to this Windows login');
}
