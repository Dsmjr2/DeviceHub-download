// One-time move of the release signing key into Bitwarden (4 Nov 2026, Shawn: Bitwarden is the one place for every
// secret, so any PC with Claude and GitHub can publish). Reads the key the old way (release-key.dpapi, locked to this
// Windows login), checks it is the one the app trusts (helpers/release-public-key.pem), and pipes it straight into
// `bw create item` as DEVICEHUB_RELEASE_KEY in the Automation folder (item name = variable, Password = value). The key
// is never printed, logged or written to disk; only "stored" / "already there" and a yes/no read-back are.
//   node helpers/key-to-bitwarden.mjs        (Bitwarden unlocked here: secrets unlock)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NAME, keyFromValue, matchesPublic } from './signing-key.mjs';

const LOCKED = path.join(process.env.APPDATA || '', 'DeviceHub-signing', 'release-key.dpapi');
const UNPROTECT = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::ASCII.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))";

const findBw = () => {
  try { return execFileSync('where.exe', ['bw'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch {}
  const root = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) { const f = path.join(root, d, 'bw.exe'); if (fs.existsSync(f)) return f; }
  throw new Error('Bitwarden CLI (bw) not found: winget install --id Bitwarden.CLI -e');
};
const bwEnv = { ...process.env, BITWARDENCLI_APPDATA_DIR: process.env.BITWARDENCLI_APPDATA_DIR || path.join(os.homedir(), '.secrets', 'bitwarden') };
const sessionFile = path.join(os.homedir(), '.secrets', 'bw-session');
if (!fs.existsSync(sessionFile)) throw new Error('Bitwarden is not unlocked here: secrets unlock');
const session = fs.readFileSync(sessionFile, 'utf8').trim();
const BW = findBw();
const bw = (args, input) => execFileSync(BW, [...args, '--session', session], { env: bwEnv, input, encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });

// the key, in memory only, as one line (base64 of its PKCS#8 form: a Password field keeps no line breaks)
const pem = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', UNPROTECT], { input: fs.readFileSync(LOCKED, 'utf8'), encoding: 'utf8', windowsHide: true, timeout: 30000 });
const value = crypto.createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' }).toString('base64');
if (!matchesPublic(keyFromValue(value))) throw new Error('the key on this PC is not the one the app trusts (helpers/release-public-key.pem); nothing stored');

bw(['sync']);
const folder = JSON.parse(bw(['list', 'folders', '--search', 'Automation'])).find((f) => f.name === 'Automation');
if (!folder) throw new Error('no Automation folder in Bitwarden');
const existing = JSON.parse(bw(['list', 'items', '--folderid', folder.id])).filter((i) => i.name === NAME);
if (existing.length) {
  console.log(`${NAME} is already in Bitwarden (${existing.length} item${existing.length > 1 ? 's' : ''}); nothing stored`);
} else {
  const item = { type: 1, name: NAME, folderId: folder.id, notes: 'DeviceHub release signing key (Ed25519, PKCS#8, base64). Public half: helpers/release-public-key.pem. Never make a new one: installed copies refuse updates signed by another key.', login: { username: null, password: value, uris: [] }, favorite: false, reprompt: 0 };
  bw(['create', 'item'], Buffer.from(JSON.stringify(item)).toString('base64'));
  bw(['sync']);
  console.log(`${NAME} stored in Bitwarden (Automation)`);
}
// read back: the stored value is this key (yes/no only)
const back = JSON.parse(bw(['list', 'items', '--folderid', folder.id])).filter((i) => i.name === NAME);
const same = back.length === 1 && back[0].login?.password?.trim() === value;
console.log(`read back from Bitwarden: ${same ? 'the same key' : back.length > 1 ? 'more than one item with that name: keep one' : 'NOT the same key'}`);
process.exit(same ? 0 : 1);
