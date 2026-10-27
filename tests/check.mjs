// npm test, part 1 (20 Oct 2026): checks that need nothing running and change nothing.
// - every JavaScript file parses (server and helpers as CommonJS / ES modules as written, the page code as modules)
// - no stray control characters in any source file (a lost backslash once left one in a regex, 19 Oct 2026)
// - every JSON file git tracks parses
// - every page the sidebar lists exists and has a unique id
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// the app's own files: what git tracks, or (a copy from the installer zip has no git) the folder itself without the
// bundled runtime, packages and this PC's data
function appFiles() {
  try { return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch {}
  const skip = /^(node_modules|runtime|backups|setups|learn|captures|dist|icons-cache|window-profile|settings-sync|read-cache|helpers\/bin|\.git)(\/|$)/;
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip.test(r)) continue;
      if (e.isDirectory()) walk(r); else if (!/\.(log|jsonl|csv)$/.test(e.name) && !/^(settings|profiles|eq-presets|seen-devices|mouse-level|headset-lights|headset-firmware|updates-cache|settings-sync-state)\.json$/.test(r)) out.push(r);
    }
  };
  walk('');
  return out;
}
const tracked = appFiles();
const problems = [];
let checked = 0;

// 1. syntax: .mjs and everything under public/ as ES modules, the rest as Node decides (CommonJS, or an ES module when
// it has module syntax). All of them in ONE Node process (23 Oct 2026, Shawn: "make the updates work faster"): this check
// runs before every update, and starting Node once per file (242 of them, ~0.1 s each on Windows) made it most of the
// wait. The same parser: CommonJS through vm.Script with Node's own module wrapper, ES modules through
// vm.SourceTextModule (a parse with every early error, as --check does; nothing is linked or run). If that process
// cannot run (an older Node), each file is checked on its own as before.
// runs in the child (passed as its source text; CommonJS there, so require works)
function syntaxWorker() {
  const vm = require('vm'), fs = require('fs'), Module = require('module');
  const out = [];
  const esm = (src, f) => new vm.SourceTextModule(src, { identifier: f });
  const cjs = (src, f) => new vm.Script(Module.wrap(src.replace(/^#!.*/, '')), { filename: f });
  for (const { f, file, asModule } of JSON.parse(fs.readFileSync(0, 'utf8'))) {
    const src = fs.readFileSync(file, 'utf8');
    try {
      if (asModule) esm(src, f);
      else {
        // module syntax in a .js file: Node reads it as an ES module, so is this check
        try { cjs(src, f); } catch (e) { if (!(e instanceof SyntaxError) || !/\b(import|export)\b/.test(src)) throw e; esm(src, f); }
      }
    } catch (e) { out.push(`${f}: ${String((e && e.stack) || e).split('\n').slice(0, 4).join(' / ')}`); }
  }
  process.stdout.write(JSON.stringify(out));
}
const SYNTAX = `(${syntaxWorker})()`;
const scripts = tracked.filter((x) => /\.(m?js)$/.test(x)).map((f) => ({ f, file: path.join(ROOT, f), asModule: f.endsWith('.mjs') || f.startsWith('public/') }));
const one = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', SYNTAX], { input: JSON.stringify(scripts), encoding: 'utf8', maxBuffer: 16 << 20 });
let syntax = null;
try { if (one.status === 0) syntax = JSON.parse(one.stdout); } catch {}
if (syntax) { problems.push(...syntax); checked += scripts.length; }
else for (const { f, file, asModule } of scripts) {
  const r = asModule
    ? spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(file), encoding: 'utf8' })
    : spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  checked++;
  if (r.status !== 0) problems.push(`${f}: ${(r.stderr || '').trim().split('\n').slice(0, 4).join(' / ')}`);
}

// 2. control characters (tab, newline and carriage return are fine)
for (const f of tracked.filter((x) => /\.(m?js|cs|css|html|ps1|bat|vbs|json|md)$/.test(x))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const m = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.exec(text);
  if (m) {
    const line = text.slice(0, m.index).split('\n').length;
    problems.push(`${f}:${line}: control character 0x${m[0].charCodeAt(0).toString(16).padStart(2, '0')}`);
  }
}

// 3. JSON
for (const f of tracked.filter((x) => x.endsWith('.json') || x.endsWith('.webmanifest'))) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); }
}

// 4. the pages in the sidebar (app.js PAGES, each loaded when first opened: page(id, title, icon, () => import(file)))
// each load a file with the same id
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const entries = [...app.matchAll(/^\s*page\('([\w-]+)', '[^']*', '[\w-]+', \(\) => import\('\.\/(pages\/[\w-]+\.js)'\)/gm)];
if (!entries.length) problems.push('public/app.js: no PAGES list found');
const ids = [];
for (const [, n, file] of entries) {
  if (!fs.existsSync(path.join(ROOT, 'public', file))) { problems.push(`public/app.js: page ${n} loads ${file}, which is missing`); continue; }
  const src = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  const id = (/export default \{[\s\S]*?\bid: '([\w-]+)'/.exec(src) || /\bid: '([\w-]+)'/.exec(src) || [])[1];  // the page's own id
  if (!id) problems.push(`${file}: no page id`); else if (id !== n) problems.push(`public/app.js: page ${n} loads ${file}, whose id is ${id}`); else ids.push(id);
}
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) problems.push(`page ids used twice: ${dup.join(', ')}`);

console.log(`checked ${checked} scripts, ${tracked.length} files, ${ids.length} pages (${ids.join(', ')})`);
if (problems.length) { console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('offline checks: all good');
