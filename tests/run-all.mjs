// npm test (3 Nov 2026): every test file runs to the end and every failure is reported, instead of a chain of
// "node a && node b" that stopped at the first failure (two old failures hid everything after them, and the two lists
// in package.json had drifted: five offline tests never ran in npm test). The list is package.json "testFiles":
// offline (no DeviceHub needed) then live (DeviceHub running on 5577).
//   node tests/run-all.mjs              every file
//   node tests/run-all.mjs --offline    the offline ones (npm run test:offline)
//   node tests/run-all.mjs name ...     only these (by file name, with or without .mjs)
//   --jobs N                            N offline files at a time (3 Nov 2026; the live ones always one at a time,
//                                       after them); the files listed in package.json "testSerial" never run beside another
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { testFiles } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\.mjs$/, ''));
let list = args.includes('--offline') ? [...testFiles.offline] : [...testFiles.offline, ...testFiles.live];
if (only.length) list = [...testFiles.offline, ...testFiles.live].filter((f) => only.includes(path.basename(f, '.mjs')));
const TIMEOUT = 5 * 60 * 1000;
const jobsAt = args.indexOf('--jobs');
const JOBS = jobsAt >= 0 ? Math.max(1, Math.min(8, Number(args[jobsAt + 1]) || 1)) : 1;
const serial = new Set([...(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).testSerial || []), ...testFiles.live]);

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // no input (a test waiting to read would wait for ever); done when the test itself exits, not when every pipe a
    // child of it may still hold has closed; past the time limit its whole process tree is ended
    const p = spawn(process.execPath, [file], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ file, ms: Date.now() - t0, ...r, out: (r.out ?? out).trim() }); };
    const timer = setTimeout(() => { out += `\n(stopped after ${TIMEOUT / 60000} minutes)`; execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {}); finish({ ok: false }); }, TIMEOUT);
    p.on('exit', (code) => setTimeout(() => finish({ ok: code === 0 }), 200));   // a moment for its last output
    p.on('error', (e) => finish({ ok: false, out: e.message }));
  });
}

const t0 = Date.now();
const results = [];
const say = (r) => {
  results.push(r);
  const last = r.out.split(/\r?\n/).filter(Boolean).pop() || '';
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${path.basename(r.file).padEnd(28)} ${(r.ms / 1000).toFixed(1).padStart(5)} s  ${last.slice(0, 110)}`);
};
// the files that may share the PC: up to JOBS at a time; then the serial ones (live ones last), one at a time
const together = JOBS > 1 ? list.filter((f) => !serial.has(f)) : [];
const alone = list.filter((f) => !together.includes(f));
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, together.length) }, async () => { while (next < together.length) say(await run(together[next++])); }));
for (const file of alone) say(await run(file));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} test files passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const r of failed) {
  console.log(`\n---- ${r.file} failed:`);
  console.log(r.out.split(/\r?\n/).slice(-15).join('\n'));
}
process.exit(failed.length ? 1 : 0);
