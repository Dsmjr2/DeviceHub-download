// Offline test (15 Nov 2026 bug hunt round 3): Settings > Update on a copy tied to the download repository (git), when
// the new version and this PC's own changes touch the same lines (helpers/self-update.js mergeUpdate):
// - the message tells the person what they can do: such copies have no "Update anyway" button (that is zip copies),
//   so it points at Claude Code's "Update DeviceHub", which brings both together
// - Update anyway (overwrite) keeps a copy of EVERY file this PC changed, not only the conflicting ones (a clean change
//   was thrown away with the reset)
// A copy of self-update.js in a temp folder that is its own git repository; nothing else is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-upmerge-'));
const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  g('init', '-q', '-b', 'app');
  fs.writeFileSync(path.join(T, '.gitignore'), 'helpers/\nbackups/\ndata/\n');
  fs.writeFileSync(path.join(T, 'a.js'), 'one\n'); fs.writeFileSync(path.join(T, 'b.js'), 'two\n');
  g('add', '.'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(T, 'a.js'), 'one from the new version\n'); g('commit', '-qam', 'X');
  const X = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'pc', base);
  fs.writeFileSync(path.join(T, 'a.js'), 'one changed on this PC\n');
  fs.writeFileSync(path.join(T, 'b.js'), 'two changed on this PC\n');
  g('commit', '-qam', 'Changes made on this PC');
  fs.mkdirSync(path.join(T, 'helpers'));
  for (const f of ['self-update.js', 'safe-write.js', 'ps-quote.js', 'data-dir.js']) fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T, 'helpers', f));
  const su = createRequire(import.meta.url)(path.join(T, 'helpers', 'self-update.js'));
  const s = { behind: 1, target: X, changed: 0, localFiles: ['a.js', 'b.js'] };

  let err = null;
  try { await su._test.mergeUpdate(s); } catch (e) { err = e; }
  check(err && /a\.js/.test(err.message) && /nothing changed/.test(err.message), `a conflict names the file and changes nothing (${err?.message})`);
  check(err && !/Update anyway/.test(err.message), 'it does not point at an "Update anyway" button a git copy does not have');
  check(err && /Claude Code/.test(err.message) && /Update DeviceHub/.test(err.message), 'it says how to bring both together (Claude Code: "Update DeviceHub")');
  check(fs.readFileSync(path.join(T, 'b.js'), 'utf8') === 'two changed on this PC\n', "this PC's files are as they were");

  await su._test.mergeUpdate(s, { overwrite: true });
  const kept = fs.readdirSync(path.join(T, 'backups')).find((d) => d.startsWith('changed-before-update-'));
  const keptDir = kept && path.join(T, 'backups', kept);
  check(keptDir && fs.existsSync(path.join(keptDir, 'a.js')), 'overwrite: the conflicting file is kept');
  check(keptDir && fs.existsSync(path.join(keptDir, 'b.js')) && fs.readFileSync(path.join(keptDir, 'b.js'), 'utf8') === 'two changed on this PC\n', 'overwrite: a cleanly changed file is kept too');
  check(g('rev-parse', 'HEAD') === X, 'overwrite: the new version is installed');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`update-merge-conflict (says what to do, Update anyway keeps every changed file): all ${n} passed`);
process.exit(0);
