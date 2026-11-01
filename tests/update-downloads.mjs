// Finished update downloads leave TEMP (helpers/self-update.js cleanDownloads, 1 Nov 2026: 169 MB stayed after each zip
// or Setup.exe update). Pretend folders only. Run: node tests/update-downloads.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cleanDownloads } = require('../helpers/self-update.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-cleandl-'));
const now = Date.now();
const make = (name, minsAgo, log) => {
  const d = path.join(tmp, name); fs.mkdirSync(path.join(d, 'DeviceHub'), { recursive: true });
  fs.writeFileSync(path.join(d, 'DeviceHub', 'big.bin'), Buffer.alloc(1024));
  if (log) fs.writeFileSync(path.join(d, 'install.log'), log);
  const t = new Date(now - minsAgo * 60000); fs.utimesSync(d, t, t);
  return d;
};
const older = make('devicehub-update-aaa', 60 * 24, 'older install');
const newest = make('devicehub-update-bbb', 30, 'newest install');
const running = make('devicehub-update-ccc', 2, 'still installing');
const other = path.join(tmp, 'devicehub-updates-not-ours'); fs.mkdirSync(other);
const lines = [];
const n = cleanDownloads({ tmp, now, log: (e) => lines.push(e.text) });
check(n === 2 && !fs.existsSync(older) && !fs.existsSync(newest), `the two finished folders are removed (${n})`);
check(fs.existsSync(running), 'a folder under 10 minutes old (an install running from it) is left alone');
check(fs.existsSync(other), 'a folder of another name is never touched');
check(fs.readFileSync(path.join(tmp, 'devicehub-update-last.log'), 'utf8') === 'newest install', 'the newest finished install.log is kept');
check(lines.length === 1 && /Removed 2 finished update download folders/.test(lines[0]), `said once (${lines.join(' | ')})`);
check(cleanDownloads({ tmp, now, log: () => {} }) === 0, 'nothing left to remove: nothing done');
check(cleanDownloads({ tmp: path.join(tmp, 'missing'), now }) === 0, 'no TEMP folder: nothing done, no error');
fs.rmSync(tmp, { recursive: true, force: true });

if (fails.length) { console.log(`update-downloads: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('update-downloads (finished update downloads removed from TEMP, a running one and the last log kept): all good');
