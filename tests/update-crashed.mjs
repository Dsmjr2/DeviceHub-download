// Offline test (15 Nov 2026 bug hunt): a version that crashed on start is not offered again (helpers/self-update.js
// crashedHere). keep-running.bat writes the HEAD it rolled back from: on a PC with its own changes, Update made a merge
// commit on top of the signed version, so that HEAD is never the signed version itself and the crashing version was
// offered again at every start. A real temp git repo: base, signed X, a local commit L, the merge M.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('../helpers/self-update.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-crashed-'));
const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitFn = async (args) => g(...args);
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  g('init', '-q', '-b', 'app');
  fs.writeFileSync(path.join(T, 'a.txt'), 'base\n'); g('add', '.'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(T, 'b.txt'), 'x\n'); g('add', '.'); g('commit', '-qm', 'X');
  const X = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'pc', base);
  fs.writeFileSync(path.join(T, 'c.txt'), 'mine\n'); g('add', '.'); g('commit', '-qm', 'Changes made on this PC');
  const L = g('rev-parse', 'HEAD');
  g('merge', '-q', '--no-edit', X);
  const M = g('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(T, 'b.txt'), 'y\n'); g('add', '.'); g('commit', '-qm', 'Y (a fix)');
  const Y = g('rev-parse', 'HEAD');

  check(await _test.crashedHere(X, X, gitFn), 'no changes on this PC: the crashed HEAD is the signed version itself');
  check(await _test.crashedHere(M, X, gitFn), 'changes on this PC: the crashed merge commit M holds X, so X is not offered again');
  check(!(await _test.crashedHere(M, Y, gitFn)), 'a newer version (a fix) is still offered');
  check(!(await _test.crashedHere(L, X, gitFn)), 'a HEAD without X does not block X');
  check(!(await _test.crashedHere('', X, gitFn)) && !(await _test.crashedHere('not-a-commit', X, gitFn)), 'an empty or unknown note blocks nothing');
} catch (e) {
  fails.push(`threw: ${e.message}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`update-crashed (a version that crashed here is not offered again, with this PC's own changes too): all ${n} passed`);
process.exit(0);
