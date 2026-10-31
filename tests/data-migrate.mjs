// This PC's files into data\ and the log into logs\ (27 Oct 2026, helpers/data-migrate.js), in throwaway folders:
// files beside the app move in; a file in both places keeps data\'s and puts the old one in data\from-root\; nothing
// there does nothing; a second run does nothing; --to-root (for going back to a version from before data\) moves them
// back. Also: helpers/install.ps1 $keep and helpers/make-installer.ps1 $private name data, logs and every old name,
// and helpers/keep-running.bat moves them back before it puts back a version without helpers/data-migrate.js.
// Run: node tests/data-migrate.mjs (no devices, no running DeviceHub)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { migrate, toRoot } = require('../helpers/data-migrate.js');
const { DATA_FILES, LOG_FILES, dataFile, logFile } = require('../helpers/data-dir.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-data-migrate-'));
const folder = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d); return d; };
const read = (f) => fs.readFileSync(f, 'utf8');
const lines = [];
const log = (t) => lines.push(t);

try {
  // ---- 1. an older copy: everything beside the app
  let r = folder('old');
  for (const f of DATA_FILES) fs.writeFileSync(path.join(r, f), `root ${f}`);
  fs.writeFileSync(path.join(r, 'background-picture.png'), 'png');
  fs.writeFileSync(path.join(r, 'settings.json.damaged-2026-10-20T01-00-00-000Z'), 'kept');
  for (const f of LOG_FILES) fs.writeFileSync(path.join(r, f), `root ${f}`);
  // the app's own files and folders stay where they are
  for (const f of ['server.js', 'package.json', 'release.json', 'release-files.json', 'release-history.json', 'notes.txt']) fs.writeFileSync(path.join(r, f), f);
  fs.mkdirSync(path.join(r, 'backups')); fs.writeFileSync(path.join(r, 'backups', 'settings.json'), 'a backup');
  let out = migrate({ root: r, log });
  check(DATA_FILES.every((f) => !fs.existsSync(path.join(r, f)) && read(dataFile(f, r)) === `root ${f}`), 'every data file moved into data\\ with its contents');
  check(read(dataFile('background-picture.png', r)) === 'png' && !fs.existsSync(path.join(r, 'background-picture.png')), 'the background picture moved');
  check(fs.existsSync(dataFile('settings.json.damaged-2026-10-20T01-00-00-000Z', r)), 'a damaged copy moved with its file');
  check(LOG_FILES.every((f) => !fs.existsSync(path.join(r, f)) && read(logFile(f, r)) === `root ${f}`), 'server.log and server.old.log moved into logs\\');
  check(['server.js', 'package.json', 'release.json', 'release-files.json', 'release-history.json', 'notes.txt'].every((f) => read(path.join(r, f)) === f), 'the app\'s own files (release.json, release-files.json, ...) stay beside the app');
  check(read(path.join(r, 'backups', 'settings.json')) === 'a backup', 'folders (backups) are left alone');
  check(out.moved.length === DATA_FILES.length + 2 + LOG_FILES.length && !out.aside.length && !out.failed.length, `moved list (${out.moved.length})`);
  check(lines.length === 1 && /^\[data\] moved \d+ files into data/.test(lines[0]), `one log line (${lines.join(' | ')})`);

  // ---- 2. run again: nothing to do, nothing logged
  lines.length = 0;
  out = migrate({ root: r, log });
  check(!out.moved.length && !out.aside.length && !out.failed.length && !lines.length, 'a second run moves nothing and logs nothing');
  check(DATA_FILES.every((f) => read(dataFile(f, r)) === `root ${f}`), 'and changes nothing in data\\');

  // ---- 3. in both places: data\ kept, the old one in data\from-root\ (never deleted); twice gets a second name
  r = folder('both');
  fs.mkdirSync(path.join(r, 'data'));
  fs.writeFileSync(dataFile('settings.json', r), 'new');
  fs.writeFileSync(path.join(r, 'settings.json'), 'old');
  fs.writeFileSync(path.join(r, 'profiles.json'), 'only beside');
  lines.length = 0;
  out = migrate({ root: r, log });
  check(read(dataFile('settings.json', r)) === 'new' && read(path.join(r, 'data', 'from-root', 'settings.json')) === 'old' && !fs.existsSync(path.join(r, 'settings.json')), 'both: data\\ kept, the old one in data\\from-root\\');
  check(read(dataFile('profiles.json', r)) === 'only beside', 'both: the others still move in');
  check(out.aside.join() === 'settings.json' && /in both places/.test(lines[0] || ''), `both: said in the log (${lines.join(' | ')})`);
  fs.writeFileSync(path.join(r, 'settings.json'), 'older still');
  migrate({ root: r, log });
  const aside = fs.readdirSync(path.join(r, 'data', 'from-root'));
  check(aside.length === 2 && aside.some((f) => f !== 'settings.json' && f.startsWith('settings.json.')) && read(dataFile('settings.json', r)) === 'new', `both again: a second name, nothing overwritten (${aside.join(', ')})`);

  // ---- 4. logs: the launcher already started logs\server.log; the old one becomes logs\server.old.log
  r = folder('logs');
  fs.mkdirSync(path.join(r, 'logs'));
  fs.writeFileSync(logFile('server.log', r), 'this start');
  fs.writeFileSync(path.join(r, 'server.log'), 'before');
  migrate({ root: r, log });
  check(read(logFile('server.log', r)) === 'this start' && read(logFile('server.old.log', r)) === 'before', 'an older server.log becomes logs\\server.old.log, read by Get help and diagnose');

  // ---- 5. nothing there (a new install): data\ and logs\ are made, nothing logged
  r = folder('empty');
  lines.length = 0;
  out = migrate({ root: r, log });
  check(!out.moved.length && !lines.length && fs.statSync(path.join(r, 'data')).isDirectory() && fs.statSync(path.join(r, 'logs')).isDirectory(), 'nothing there: data\\ and logs\\ made, nothing logged');
  // the crash-proof save makes data\ when it is missing (a helper that runs before the server ever started)
  const { writeAtomic } = require('../helpers/safe-write.js');
  const fresh = folder('fresh');
  writeAtomic(dataFile('settings.json', fresh), '{}');
  check(read(dataFile('settings.json', fresh)) === '{}', 'a save into a missing data\\ makes the folder');

  // ---- 6. going back to a version from before data\: --to-root puts them back beside the app, overwriting nothing
  r = folder('back');
  fs.mkdirSync(path.join(r, 'data'));
  for (const f of ['settings.json', 'profiles.json', 'update-failed.txt']) fs.writeFileSync(dataFile(f, r), `data ${f}`);
  fs.writeFileSync(dataFile('background-picture.jpg', r), 'jpg');
  fs.writeFileSync(dataFile('startup-impact.json', r), 'newer only');
  fs.writeFileSync(path.join(r, 'profiles.json'), 'already beside');
  lines.length = 0;
  out = toRoot({ root: r, log });
  check(read(path.join(r, 'settings.json')) === 'data settings.json' && read(path.join(r, 'update-failed.txt')) === 'data update-failed.txt' && read(path.join(r, 'background-picture.jpg')) === 'jpg', 'to-root: back beside the app');
  check(read(path.join(r, 'profiles.json')) === 'already beside' && read(dataFile('profiles.json', r)) === 'data profiles.json', 'to-root: a file already beside the app is not overwritten');
  check(fs.existsSync(dataFile('startup-impact.json', r)), 'to-root: a file the older version never knew stays in data\\');
  check(lines.length === 1 && /back beside the app/.test(lines[0]), `to-root: one log line (${lines.join(' | ')})`);
  // and forward again (the next update): in once more
  migrate({ root: r, log });
  check(read(dataFile('settings.json', r)) === 'data settings.json' && !fs.existsSync(path.join(r, 'settings.json')), 'forward again: back into data\\');

  // ---- 7. the command line keep-running.bat uses
  r = folder('cli');
  fs.mkdirSync(path.join(r, 'data'));
  fs.writeFileSync(dataFile('settings.json', r), '{"a":1}');
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'helpers', 'data-migrate.js'), '--to-root', r], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  check(cli.status === 0 && read(path.join(r, 'settings.json')) === '{"a":1}', `node helpers/data-migrate.js --to-root <folder> (${cli.status} ${cli.stdout}${cli.stderr})`);
  const cli2 = spawnSync(process.execPath, [path.join(ROOT, 'helpers', 'data-migrate.js'), r], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  check(cli2.status === 0 && read(dataFile('settings.json', r)) === '{"a":1}', `node helpers/data-migrate.js <folder> (${cli2.status})`);

  // ---- 8. the files that name these places
  const ins = read(path.join(ROOT, 'helpers', 'install.ps1')), mk = read(path.join(ROOT, 'helpers', 'make-installer.ps1'));
  const listOf = (text, name) => { const m = new RegExp(`\\$${name} = ([\\s\\S]*?)\\r?\\n\\s*(?:if|\\$z|#)`).exec(text); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []; };
  const keep = listOf(ins, 'keep'), priv = listOf(mk, 'private');
  const need = ['data', 'logs', ...DATA_FILES, ...LOG_FILES];
  check(need.every((n) => keep.includes(n)), `install.ps1 $keep names data, logs and every old name (missing: ${need.filter((n) => !keep.includes(n)).join(', ') || 'none'})`);
  check(need.every((n) => priv.includes(n)), `make-installer.ps1 $private names data, logs and every old name (missing: ${need.filter((n) => !priv.includes(n)).join(', ') || 'none'})`);
  check(!keep.includes('release-files.json') && !priv.includes('release-files.json'), 'release-files.json (made with each version) is shipped and replaced, not kept as data');
  const bat = read(path.join(ROOT, 'helpers', 'keep-running.bat'));
  check(/server\.js >> logs\\server\.log/.test(bat), 'keep-running.bat writes logs\\server.log');
  check(/exist data\\update-rollback\.txt/.test(bat) && /exist update-rollback\.txt/.test(bat), 'keep-running.bat finds update-rollback.txt in data\\, or beside the app');
  // an update replaces the bat while cmd runs it, and cmd reads on from the byte after the server.js line: that line
  // must end where it did before (1452 with Windows line ends, as checked out), or the cmd still running the old
  // version reads half a line and never starts the new one (27 Oct 2026, tried in a throwaway git folder)
  const crlf = bat.replace(/\r?\n/g, '\r\n'), nodeLine = /^!NODE! .* server\.js >> logs\\server\.log 2>&1\r\n/m.exec(crlf);
  check(nodeLine && Buffer.byteLength(crlf.slice(0, nodeLine.index + nodeLine[0].length), 'latin1') === 1452, `keep-running.bat: the server.js line ends at byte 1452, as before (${nodeLine ? Buffer.byteLength(crlf.slice(0, nodeLine.index + nodeLine[0].length), 'latin1') : 'no line'})`);
  check(/^:loop\r\nif not exist logs mkdir logs\r\n/m.test(crlf), 'keep-running.bat makes logs\\ inside the loop (a cmd from the version before an update jumps to :loop)');
  const back = bat.indexOf('helpers/data-migrate.js 2>nul ||'), toR = bat.indexOf('data-migrate.js --to-root'), reset = bat.indexOf('git reset --quiet --keep');
  check(back > 0 && toR > back && reset > toR, 'keep-running.bat moves the files back beside the app before it puts back a version without data-migrate.js');
  const vbs = read(path.join(ROOT, 'DeviceHub.vbs'));
  check(/\\data\\settings\.json/.test(vbs) && /dir & "\\settings\.json"/.test(vbs) && /\\logs\\server\.log/.test(vbs), 'DeviceHub.vbs reads data\\settings.json (else the old place) and logs\\server.log');
  const server = read(path.join(ROOT, 'server.js'));
  const first = server.indexOf("require('./helpers/data-migrate').migrate()");
  check(first > 0 && first < server.indexOf("require('./helpers/driver-guard')") && first < server.indexOf('require(\'./helpers/monitors\')'), 'server.js moves the files first, before any helper is loaded');
  check(/if \(process\.env\.DEVICEHUB_ISOLATED !== '1'\) require\('\.\/helpers\/data-migrate'\)\.migrate\(\)/.test(server), 'an isolated copy never moves files (tests/regressions.mjs starts one from the real folder)');
  check(/^\/data\/$/m.test(read(path.join(ROOT, '.gitignore'))) && /^settings\.json$/m.test(read(path.join(ROOT, '.gitignore'))), '.gitignore: data/, and the old names stay');
} catch (e) { fails.push(`threw: ${e.stack}`); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `data-migrate: ${fails.length} failed\n - ${fails.join('\n - ')}` : 'data-migrate (into data\\ and logs\\, both places, nothing there, twice, back for an older version): all good');
process.exit(fails.length ? 1 : 0);
