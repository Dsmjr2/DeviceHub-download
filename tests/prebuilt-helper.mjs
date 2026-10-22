// The pre-built native helper (22 Oct 2026; docs/handoff/prebuilt-helper.md). No compiler runs and nothing starts:
// helpers/helper-sources.js decides, and helpers/native.js buildHelper() is driven with a stand-in for build.ps1 in
// temporary helpers folders.
//   1. helper-sources.js lists exactly the files build.ps1 compiles
//   2. the sources hash: content only, sorted, and any changed byte changes it
//   3. an installed copy (recorded hash matches): the shipped exe is used, never rebuilt, even with sources newer than it
//   4. the sources changed: rebuilt once and the new hash recorded; a failed rebuild keeps the shipped exe (one line)
//   5. a development copy (no recorded hash; Shawn's repo): rebuilt exactly when a source is newer than the exe, as before
//   6. this repo itself has no recorded hash, so it keeps the file-time rule
//   7. make-installer, install.ps1 and self-update carry it through
// Run: node tests/prebuilt-helper.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HELPERS = path.join(ROOT, 'helpers');
const hs = require('../helpers/helper-sources.js');
const native = require('../helpers/native.js');

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

// 1. the same list as build.ps1
const ps1 = fs.readFileSync(path.join(HELPERS, 'native', 'build.ps1'), 'utf8');
const line = ps1.split(/\r?\n/).find((l) => /^\$src\s*=/.test(l)) || '';
const fromPs1 = [...line.split('|')[0].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/\\/g, '/'));
check(fromPs1.length > 5 && JSON.stringify(fromPs1) === JSON.stringify(hs.SOURCE_FILES), `helper-sources.js lists the files build.ps1 compiles (build.ps1: ${fromPs1.join(', ')})`);
check(/param\(\[string\]\$Out = ''\)/.test(ps1) && /"\/out:\$Out"/.test(ps1) && /if \(-not \$Out\) \{ \$Out = Join-Path \$root 'bin\\DeviceHubHelper\.exe' \}/.test(ps1), 'build.ps1 still builds to helpers\\bin\\DeviceHubHelper.exe unless -Out is given');

// a temporary helpers folder with stand-in sources and an exe
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-prebuilt-'));
let k = 0;
function folder({ exe = true } = {}) {
  const d = path.join(tmp, String(++k));
  for (const f of hs.SOURCE_FILES) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), `// ${f}\r\nclass X {}\r\n`); }
  fs.mkdirSync(path.join(d, 'bin'), { recursive: true });
  if (exe) fs.writeFileSync(path.join(d, 'bin', hs.EXE_NAME), 'shipped exe');
  return d;
}
const setTime = (p, t) => fs.utimesSync(p, t / 1000, t / 1000);
const exeOf = (d) => path.join(d, 'bin', hs.EXE_NAME);
const hashFileOf = (d) => path.join(d, 'bin', hs.HASH_NAME);
// a stand-in for build.ps1: counts calls, then "compiles" (writes the exe) or fails like csc does (exe left as it was)
function compiler(ok = true) {
  const c = (d) => { c.calls++; if (!ok) throw new Error('Command failed: powershell build.ps1\nerror CS1002: ; expected'); fs.writeFileSync(exeOf(d), 'rebuilt exe'); };
  c.calls = 0;
  return c;
}

try {
  // 2. the hash
  {
    const a = folder(), b = folder();
    check(hs.sourcesHash(a) === hs.sourcesHash(b) && /^[0-9a-f]{64}$/.test(hs.sourcesHash(a)), 'the same sources give the same hash');
    const expect = crypto.createHash('sha256').update([...hs.SOURCE_FILES].sort().map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(a, f))).digest('hex') + '\n').join('')).digest('hex');
    check(hs.sourcesHash(a) === expect, 'the hash is over each file\'s content hash, in sorted name order');
    setTime(path.join(b, 'hidio.cs'), Date.now() + 60000);
    check(hs.sourcesHash(a) === hs.sourcesHash(b), 'a file time alone does not change the hash');
    fs.appendFileSync(path.join(b, 'native/tray.cs'), ' ');
    check(hs.sourcesHash(a) !== hs.sourcesHash(b), 'one changed byte changes the hash');
  }

  // 3. an installed copy: the recorded hash matches, so the shipped exe runs and nothing is compiled
  {
    const d = folder();
    hs.recordHash(d);
    // unzipping leaves file times anyhow: every source newer than the exe must not matter
    setTime(exeOf(d), Date.now() - 86400000);
    for (const f of hs.SOURCE_FILES) setTime(path.join(d, f), Date.now());
    check(hs.decide(d).mode === 'shipped' && hs.decide(d).build === false, 'recorded hash matches: shipped, no build (sources newer than the exe)');
    const c = compiler();
    check(native.buildHelper(d, c) === 'shipped' && c.calls === 0 && fs.readFileSync(exeOf(d), 'utf8') === 'shipped exe', 'buildHelper never compiles a matching shipped helper');
    // and the other way round: an exe newer than every source with a hash that no longer matches is still rebuilt
    const e = folder();
    fs.writeFileSync(hashFileOf(e), 'a'.repeat(64) + '\n');
    setTime(exeOf(e), Date.now() + 86400000);
    check(hs.decide(e).mode === 'changed' && hs.decide(e).build === true, 'a hash that does not match is rebuilt even when the exe is newer');
  }

  // 4. the sources changed (a self-update, an edit on that PC)
  {
    const d = folder();
    const old = hs.recordHash(d);
    fs.appendFileSync(path.join(d, 'native/helper.cs'), '// changed\r\n');
    check(hs.decide(d).mode === 'changed', 'changed sources: rebuild');
    const c = compiler(true);
    check(native.buildHelper(d, c) === 'changed' && c.calls === 1 && fs.readFileSync(exeOf(d), 'utf8') === 'rebuilt exe', 'changed sources: compiled once');
    check(hs.recordedHash(d) === hs.sourcesHash(d) && hs.recordedHash(d) !== old, 'after the rebuild the new sources\' hash is recorded');
    const c2 = compiler(true);
    check(native.buildHelper(d, c2) === 'shipped' && c2.calls === 0, 'the next start does not compile again');

    // the rebuild fails: the shipped exe (built from the earlier sources) keeps running, said in one line
    const f = folder();
    const was = hs.recordHash(f);
    fs.appendFileSync(path.join(f, 'audio.cs'), '// changed\r\n');
    const bad = compiler(false);
    let err = null;
    try { native.buildHelper(f, bad); } catch (e) { err = e; }
    check(bad.calls === 1 && err && err.fallback === true, 'a failed rebuild with a shipped exe is a fallback, not "no helper"');
    check(err && /running the shipped helper built from the earlier sources/.test(err.message) && !err.message.includes('\n') && /CS1002|Command failed/.test(err.message), 'its message is one line saying the shipped helper runs, with the reason');
    check(fs.readFileSync(exeOf(f), 'utf8') === 'shipped exe' && hs.recordedHash(f) === was, 'the shipped exe and its recorded hash are left as they were (tried again later)');
    // no exe at all: a plain failure (no helper), as before
    const g = folder({ exe: false });
    fs.writeFileSync(hashFileOf(g), 'b'.repeat(64) + '\n');
    let err2 = null;
    try { native.buildHelper(g, compiler(false)); } catch (e) { err2 = e; }
    check(err2 && !err2.fallback, 'a failed build with no exe at all is the ordinary "could not be built"');
    // a damaged hash file counts as none (development rule), never as a match
    const h = folder();
    fs.writeFileSync(hashFileOf(h), 'not a hash');
    check(hs.decide(h).mode === 'mtime', 'a hash file that is not a SHA-256 is ignored');
  }

  // 5. a development copy (Shawn's repo): no hash file, the file-time rule exactly as before
  {
    const d = folder({ exe: false });
    const c = compiler(true);
    check(native.buildHelper(d, c) === 'mtime' && c.calls === 1, 'dev copy without an exe: built');
    const now = Date.now();
    for (const f of hs.SOURCE_FILES) setTime(path.join(d, f), now - 60000);
    setTime(exeOf(d), now);
    const c2 = compiler(true);
    check(native.buildHelper(d, c2) === 'mtime' && c2.calls === 0, 'dev copy with an exe newer than every source: not built');
    setTime(path.join(d, 'native/hs80io.cs'), now + 60000);
    const c3 = compiler(true);
    check(native.buildHelper(d, c3) === 'mtime' && c3.calls === 1, 'dev copy after editing one source: rebuilt');
    check(!fs.existsSync(hashFileOf(d)), 'a dev copy\'s build writes no hash file (it stays on the file-time rule)');
    // a touch without a content change still rebuilds in a dev copy (as before)
    setTime(exeOf(d), now + 120000);
    setTime(path.join(d, 'pointer.cs'), now + 180000);
    check(hs.decide(d).build === true, 'dev copy: a newer file time alone rebuilds, as before');
  }

  // 6. this repo
  {
    check(!fs.existsSync(path.join(HELPERS, 'bin', hs.HASH_NAME)), 'this repo has no recorded hash (helpers/bin/helper-sources.sha256 is made only for the installer)');
    let mode = null; try { mode = hs.decide(HELPERS).mode; } catch {}
    check(mode === 'mtime', 'this repo keeps the file-time rule (it rebuilds when its sources are edited)');
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    check(/^helpers\/bin\/$/m.test(gi), 'helpers/bin stays out of git (the exe is built at installer time)');
  }

  // 7. the installer, the installed copy's installer and self-update
  {
    const mk = fs.readFileSync(path.join(HELPERS, 'make-installer.ps1'), 'utf8');
    check(/native\\build\.ps1'\) -Out \$helperExe/.test(mk) && /\$env:TEMP "DeviceHub-helper-\$PID"/.test(mk), 'make-installer builds the helper into a folder of its own (never this PC\'s helpers\\bin)');
    check(/helper-sources\.js'\) --hash \$PSScriptRoot/.test(mk) && /'helpers\/bin\/DeviceHubHelper\.exe' = \$helperExe; 'helpers\/bin\/helper-sources\.sha256' = \$helperHashFile/.test(mk), 'make-installer records the sources hash beside the exe');
    check(/CreateEntryFromFile\(\$z, \$helperFiles\[\$k\], \(Ent \$k\)/.test(mk) && /\$prints\[\$k\] = \(Get-FileHash \$helperFiles\[\$k\]/.test(mk), 'both go into the zip and into release-files.json');
    check(/helpers\/bin in the zip is not the pre-built helper and its hash/.test(mk), 'make-installer refuses a zip without them');
    check(mk.indexOf('$helperFiles') < mk.indexOf("'release-files.json'") && mk.indexOf("'release-files.json'") < mk.indexOf('sign-release.mjs'), 'the file list (with the helper) is made before the release is signed');
    const ins = fs.readFileSync(path.join(HELPERS, 'install.ps1'), 'utf8');
    check(/if \(\$shipped\) \{ Write-Host '   included, ready-built for this version' \}\s*elseif \(Test-Path \$csc\)/.test(ins), 'install.ps1 does not compile a matching ready-built helper');
    check(/Where-Object \{ -not \$_\.Name\.StartsWith\('helpers\/bin\/'\) \}/.test(ins), 'install.ps1 never counts helpers/bin as changed on the PC');
    const su = fs.readFileSync(path.join(HELPERS, 'self-update.js'), 'utf8');
    check(/filter\(\(\[f\]\) => !f\.startsWith\('helpers\/bin\/'\)\)/.test(su), 'self-update never counts helpers/bin as changed on the PC');
    const nat = fs.readFileSync(path.join(HELPERS, 'native.js'), 'utf8');
    check(/console\.log\(e\.fallback \? `\[helper\] \$\{e\.message\}`/.test(nat), 'native.js start() logs the fallback in one line');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `prebuilt-helper: FAILED (${fails.length} of ${n}):\n- ${fails.join('\n- ')}` : `prebuilt-helper (${n} checks: source list, hash, shipped / changed / failed rebuild / dev copy, installer, self-update): all good`);
process.exit(fails.length ? 1 : 0);
