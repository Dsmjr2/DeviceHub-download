// Offline test (15 Nov 2026 bug hunt round 3): an installer update (zip or Setup.exe) on a copy tied to the download
// repository (git) puts git at the new version; when that version crashed on start, keep-running.bat copied the old
// files back but left git at the new version: Settings said "Up to date" while the old version ran, and the next
// update committed the old files as "Changes made on this PC", undoing the crashed version's changes for good.
// Now install.ps1 notes the version git was at (backups\pre-update-git-head.txt) and the launcher's rollback puts git
// back there, and notes the failed version by the id a git copy compares (appCommit).
// The scripts' source, plus the git step itself run in a temp repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const install = fs.readFileSync(path.join(ROOT, 'helpers', 'install.ps1'), 'utf8').replace(/\r\n/g, '\n');
const bat = fs.readFileSync(path.join(ROOT, 'helpers', 'keep-running.bat'), 'latin1').replace(/\r\n/g, '\n');

// install.ps1: the git version before, noted beside the files kept (outside the folder copied back)
const keepAt = install.indexOf("$pre = Join-Path $Target 'backups\\pre-update'"), gitStep = install.indexOf("Step 'Connecting to updates'");
const noteAt = install.indexOf('pre-update-git-head.txt');
check(noteAt > keepAt && noteAt < gitStep, 'install.ps1 notes the git version before it moves git to the new one');
check(/rev-parse HEAD/.test(install.slice(keepAt, gitStep)), 'it is the HEAD the copy was at');
// keep-running.bat: the files rollback puts git back too, and notes the failed version as a git copy compares it
const files = bat.indexOf('if "!old:~0,6!"=="files:" (');
const block = bat.slice(files, bat.indexOf('goto loop', files));
check(/pre-update-git-head\.txt/.test(block) && /git reset --quiet !gh!/.test(block), 'the launcher puts git back at the version before');
check(/appCommit/.test(block), 'the failed version is noted by appCommit on a git copy (statusNow compares that)');

// the git step: files of the old version over a repository at the new one, then a mixed reset: git is back, clean
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-rbgit-'));
const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(T, 'server.js'), 'old\n'); g('add', '.'); g('commit', '-qm', 'A');
  const A = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(T, 'server.js'), 'new\n'); g('commit', '-qam', 'X');
  fs.writeFileSync(path.join(T, 'server.js'), 'old\n');   // robocopy put the old files back
  check(g('status', '--porcelain') !== '', 'before: git at X sees the old files as changes');
  g('reset', '--quiet', A);
  check(g('rev-parse', 'HEAD') === A && g('status', '--porcelain') === '', 'after the reset: git at the version before, nothing changed');
} catch (e) { fails.push(`threw: ${e.message}`); } finally { try { fs.rmSync(T, { recursive: true, force: true }); } catch {} }

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`rollback-git (an installer update rolled back puts git back too): all ${n} passed`);
process.exit(0);
