// Start-up impact keeps no secrets (18 Nov 2026): a password manager's command line with its unlock session was saved
// in data\startup-impact.json. Command lines are kept only with secret-looking values hidden, older runs are cleaned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const s = require('../helpers/startup-impact.js');
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

const SESSION = 'NkY9t5G2BCBmnMKvy9xeih8SyeVKIHD+eUkG2fprj3BXUh2evyNhKsjEiumQpfV/FT0xxkEDCeUI2Ceqa4CzaQ==';
const bw = `"C:\\Tools\\bw.exe" list items --folderid 2b84ff42-7bde-46c9-abbd-b4f80167bec8 --session ${SESSION}`;
let r = s.redactCmd(bw);
check(!r.includes(SESSION) && r.includes('--session <hidden>') && r.includes('bw.exe') && r.includes('--folderid 2b84ff42'), `a --session value is hidden, the rest kept (${r})`);
r = s.redactCmd('app.exe --password=hunter2 -token abc /apikey:xyz --api-key "two words"');
check(!/hunter2|abc|xyz|two words/.test(r), `password, token, apikey and api-key values are hidden (${r})`);
r = s.redactCmd('tool.exe sync AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh');
check(r === 'tool.exe sync <hidden>', `a long bare token is hidden (${r})`);
for (const keep of [
  '"C:\\Windows\\system32\\backgroundTaskHost.exe" -ServerName:App.AppXpybpk6fj2fe0gb0jan49e6dncngk3pa1.mca',
  'C:\\Windows\\System32\\wscript.exe "C:\\Users\\someone\\DeviceHub\\DeviceHub.vbs" /background',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\someone\\AppData\\Local\\x\\helper.ps1"',
  '"C:\\Program Files\\Some App\\app.exe" --profile-directory=Default',
]) check(s.redactCmd(keep) === keep, `an ordinary command line stays as it was (${keep})`);
check(s.redactCmd(undefined) === '' && s.redactCmd(null) === '', 'nothing stays nothing');

// a file saved before: read clean, and written again clean
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-impact-'));
try {
  const file = path.join(tmp, 'startup-impact.json');
  s._test.deps.file = () => file;
  fs.writeFileSync(file, JSON.stringify({ runs: [{ signIn: '2026-11-13T19:54:44.000Z', at: 'x', procs: [{ name: 'bw.exe', cmd: bw, startS: 149 }, { name: 'node.exe', cmd: 'node server.js', startS: 25 }] }] }));
  check(!JSON.stringify(s.latest()).includes(SESSION), 'latest() never hands out the old secret');
  check(s.cleanFile() === true, 'cleanFile reads the file');
  const after = fs.readFileSync(file, 'utf8');
  check(!after.includes(SESSION) && after.includes('<hidden>') && after.includes('node server.js'), 'the file is written again without the secret, everything else kept');
  const at = fs.statSync(file).mtimeMs;
  s.cleanFile();
  check(fs.statSync(file).mtimeMs === at, 'a clean file is not written again');
  // a new measurement is saved redacted
  s._test.deps.read = async () => ({ signIn: '2026-11-18T08:00:00.000Z', at: 'y', procs: [{ name: 'bw.exe', cmd: bw, pid: 1, ppid: 2, startS: 3 }] });
  s._test.reset();
  await s.measureAtSignIn();
  check(!fs.readFileSync(file, 'utf8').includes(SESSION), 'a new sign-in measurement is saved without the secret');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

if (problems.length) { console.log(`startup-impact-secrets: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('startup-impact-secrets (secrets hidden in saved command lines, older runs cleaned): all good');
