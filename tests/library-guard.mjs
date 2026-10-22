// What library and my-devices code may reach (final audit, 22 Oct 2026; docs/handoff/final-safety.md).
// 1. Every device-library/*/device.mjs and my-devices/*/device.mjs is read as text: it may import only DeviceHub's
//    device helpers (public/devices, public/core), node:child_process for execFile('tasklist', ...) and nothing else
//    from it, and node:module's createRequire only to load helpers/native.js, which only the two Corsair Bragi drivers
//    may do (ALLOW_NATIVE). No fs, no writes to files, no other process, network or eval.
// 2. The never list on those Corsair drivers' own channels (helpers/bragi-guard.js, asked first by helpers/native.js
//    request): refused commands, allowed ones, and DeviceHub's own HS80 channels never checked.
// Run: node tests/library-guard.mjs (no hardware; nothing is started: native.js is read as text, never loaded)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

const ALLOW_NATIVE = ['device-library/corsair-bragi-headset/device.mjs', 'device-library/corsair-bragi-peripherals/device.mjs'];
const IMPORT_OK = /^(\.\.\/\.\.\/public\/(devices|core)\/[a-z0-9-]+\.js|node:child_process|node:module)$/;

// the code without its comments and with every string's text kept (imports and calls are read from it)
function code(text) {
  let out = '', i = 0;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

const files = [];
for (const top of ['device-library', 'my-devices']) {
  let names = [];
  try { names = fs.readdirSync(path.join(ROOT, top), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch {}
  for (const n of names) { const rel = `${top}/${n}/device.mjs`; if (fs.existsSync(path.join(ROOT, rel))) files.push(rel); }
}
check(files.length >= 16, `the driver files were found (${files.length})`);

export function problems(rel, text) {
  const src = code(text);
  const out = [];
  const specs = [...src.matchAll(/\bimport\s*(?:[\w*{}\s,]+\s*from\s*)?(['"`])([^'"`]+)\1/g), ...src.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)].map((m) => m[2]);
  for (const s of specs) if (!IMPORT_OK.test(s)) out.push(`imports ${s}`);
  if (/\bimport\s*\(\s*[^'"`\s]/.test(src)) out.push('imports a computed name');
  if (/\brequire\s*\(/.test(src.replace(/createRequire\(import\.meta\.url\)\(\s*'\.\.\/\.\.\/helpers\/native\.js'\s*\)/g, ''))) out.push('calls require() for something other than helpers/native.js');
  // createRequire only as createRequire(import.meta.url)('../../helpers/native.js'), never kept to call again
  const reqs = [...src.matchAll(/\bcreateRequire\b/g)].length - [...src.matchAll(/\bimport\s*\{\s*createRequire\s*\}/g)].length;
  const toNative = [...src.matchAll(/\bcreateRequire\(import\.meta\.url\)\(\s*'\.\.\/\.\.\/helpers\/native\.js'\s*\)/g)].length;
  if (reqs !== toNative) out.push('uses createRequire for something other than helpers/native.js');
  const native = /helpers\/native(\.js)?['"`]/.test(src);
  if (native && !ALLOW_NATIVE.includes(rel)) out.push('loads helpers/native.js (only the two Corsair Bragi drivers may)');
  if (specs.includes('node:module') && !native) out.push('imports node:module without a reason');
  // child_process: execFile of tasklist only
  if (/\b(spawn|spawnSync|execSync|execFileSync|fork)\s*\(|(?<![.\w])exec\s*\(|\b(spawn|spawnSync|exec|execSync|execFileSync|fork)\s*[,}]/.test(src)) out.push('uses a child_process call other than execFile');
  for (const m of src.matchAll(/\bexecFile\s*\(\s*([^,)]*)/g)) if (m[1].trim() !== "'tasklist'") out.push(`runs ${m[1].trim()} (only tasklist is allowed)`);
  // files, network, eval
  if (/\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|renameSync|unlinkSync|unlink|rmSync|rmdirSync|mkdirSync|copyFileSync|cpSync|truncateSync|symlinkSync|chmodSync)\b/.test(src)) out.push('writes files');
  if (/\bprocess\.(binding|dlopen)\b|\beval\s*\(|\bnew\s+Function\b|\bglobalThis\.process\.mainModule\b/.test(src)) out.push('reaches around the module system (eval, process.binding)');
  return out;
}

for (const rel of files) {
  const p = problems(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  check(p.length === 0, `${rel}: ${p.join('; ')}`);
}
// the check itself catches what it is for
const bad = (t, rel = 'device-library/x/device.mjs') => problems(rel, t).length > 0;
check(bad("import { createRequire } from 'node:module';\nconst n = createRequire(import.meta.url)('../../helpers/native.js');"), 'a non-Corsair driver loading native.js is caught');
check(!bad("import { createRequire } from 'node:module';\nconst n = createRequire(import.meta.url)('../../helpers/native.js');", ALLOW_NATIVE[0]), 'the Corsair driver may load native.js');
check(bad("import fs from 'node:fs';") && bad("const fs = await import('node:fs');") && bad("const { writeFileSync } = x; writeFileSync('a', 'b');"), 'fs and file writes are caught');
check(bad("const { execFile } = await import('node:child_process'); execFile('powershell', ['-c', 'x']);") && bad("const { spawn } = await import('node:child_process');"), 'another program is caught');
check(!bad("const { execFile } = await import('node:child_process'); execFile('tasklist', ['/FO', 'CSV']);"), 'tasklist is allowed');
check(bad("const r = createRequire(import.meta.url)('../../helpers/hid-host.mjs');") && bad("import x from '../../helpers/native.js';"), 'other helpers are caught');
check(!bad("// require('fs') in a comment\nconst s = 'writeFile';".replace("'writeFile'", "'a note'")), 'comments do not count');

// ---- 2. the never list on the library Corsair channels ----
const require = createRequire(import.meta.url);
const bg = require('../helpers/bragi-guard.js');
const H = 'hs80:1B81:9:bragi', PER = 'hs80:1B81:9:bragi:frame=peripheral';
for (const [chan, cmd] of [[H, 'GET 05'], [H, 'GET 6'], [H, 'GET 14'], [H, 'GET 15'], [H, 'GET 16'], [PER, 'SET 03 4'], [H, 'SET 05 1'], [PER, 'SET 06 0'], [H, 'MODE 4'], [H, 'LIGHT 00 00 00 00 00 00 00 00 00'], [H, 'OPENLIGHT'], [H, 'SET 02'], [H, 'GET zz'], [H, 'OPEN now'], [H, 'RAW 01 02']]) {
  check(!!bg.refusal(chan, cmd), `a library driver's "${cmd}" on ${chan} is refused`);
}
for (const [chan, cmd] of [[H, 'OPEN'], [H, 'CLOSE'], [PER, 'FRAME'], [H, 'GET 0f'], [H, 'GET 13'], [H, 'GET 53'], [H, 'SET 0e 600000'], [H, 'SET 47 500'], [PER, 'SET 03 2'], [PER, 'SET 21 1600'], [PER, 'GET 12']]) {
  check(bg.refusal(chan, cmd) === null, `"${cmd}" on ${chan} goes on to the helper (its own SET list decides)`);
}
check(bg.frameOf(9, 'SET 21 1600').map((x) => x.toString(16).padStart(2, '0')).join(' ') === '09 01 21 00 40 06 00 00' && bg.frameOf(8, 'GET 0f').join() === '8,2,15,0', 'the bytes checked are the ones hs80io.cs builds (after the report id)');
// DeviceHub's own HS80 channels (hs80-direct.js, receiver-light.js) are never checked, whatever they send
for (const chan of ['hs80:0A6B:9:receiver1', 'hs80:0A69:8:wired2', 'hs80:0A6B:8:rx']) check(!bg.isBragi(chan) && bg.refusal(chan, 'MODE 2') === null && bg.refusal(chan, 'LIGHT 00 00 00 00 00 00 00 00 00') === null, `${chan}: the HS80's own channel is not checked`);
// native.js asks it first, before the helper starts (read as text: loading native.js could start the helper)
const nat = fs.readFileSync(path.join(ROOT, 'helpers', 'native.js'), 'utf8');
const body = nat.slice(nat.indexOf('function request(chan, cmd, ms = 8000) {'));
check(/require\('\.\/bragi-guard'\)/.test(nat) && body.indexOf('bragiGuard.refusal(chan, cmd)') > 0 && body.indexOf('bragiGuard.refusal(chan, cmd)') < body.indexOf('start();'), 'native.js request checks a bragi channel before it starts the helper or writes a line');
// the library drivers' channels carry the tag the guard keys on
for (const rel of ALLOW_NATIVE) check(/`hs80:\$\{f\.pid\}:\$\{f\.ep\}:bragi/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} names its channels with the bragi tag`);

console.log(fails.length ? `library-guard: FAILED: ${fails.join('; ')}` : `library-guard (${files.length} driver files: imports, native.js, child_process, file writes; the Corsair never list): all good`);
process.exit(fails.length ? 1 : 0);
