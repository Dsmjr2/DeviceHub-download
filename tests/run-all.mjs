// npm test (3 Nov 2026): every test file runs to the end and every failure is reported, instead of a chain of
// "node a && node b" that stopped at the first failure (two old failures hid everything after them, and the two lists
// in package.json had drifted: five offline tests never ran in npm test). The list is package.json "testFiles":
// offline (no DeviceHub needed) then live (DeviceHub running on 5577).
//   node tests/run-all.mjs              every file
//   node tests/run-all.mjs --offline    the offline ones (npm run test:offline)
//   node tests/run-all.mjs name ...     only these (by file name, with or without .mjs)
//   --jobs N                            N offline files at a time (3 Nov 2026; the live ones always one at a time,
//                                       after them); the files listed in package.json "testSerial" never run beside another.
//                                       Default: half the CPU cores, at most 8 (13 Nov 2026, Shawn: "speed up and optimize test run": 488 s -> about
//                                       50 s on the 16-core PC; most files wait on timers, not the CPU); --jobs 1 runs them one by one
// The slowest files start first (their times from the last run, kept in the temp folder), so none is left at the end.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { testFiles } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
// (9 Nov 2026) the number after --jobs is not a file name: "--jobs 4" used to filter the list down to a file called
// 4, run nothing and exit 0
const jobsAt = args.indexOf('--jobs');
const only = args.filter((a, i) => !a.startsWith('--') && !(jobsAt >= 0 && i === jobsAt + 1)).map((a) => a.replace(/\.mjs$/, ''));
let list = args.includes('--offline') ? [...testFiles.offline] : [...testFiles.offline, ...testFiles.live];
if (only.length) list = [...testFiles.offline, ...testFiles.live].filter((f) => only.includes(path.basename(f, '.mjs')));
// a name that matches no test file, or nothing to run at all, is a failure, never a pass
const unknown = only.filter((n) => !list.some((f) => path.basename(f, '.mjs') === n));
if (unknown.length || !list.length) { console.log(`No such test file in package.json testFiles: ${unknown.join(', ') || '(none listed)'}`); process.exit(1); }
const TIMEOUT = 5 * 60 * 1000;
const JOBS = jobsAt >= 0 ? Math.max(1, Math.min(8, Number(args[jobsAt + 1]) || 1)) : Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
const TIMES = path.join(os.tmpdir(), 'devicehub-test-times.json');
let times = {};
try { times = JSON.parse(fs.readFileSync(TIMES, 'utf8')); } catch {}
const serial = new Set([...(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).testSerial || []), ...testFiles.live]);

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // no input (a test waiting to read would wait for ever); done when the test itself exits, not when every pipe a
    // child of it may still hold has closed; past the time limit its whole process tree is ended
    // simulated devices never answer late, so the pause after an unanswered request can be short (public/devices/hid.js)
    const env = testFiles.live.includes(file) ? process.env : { DEVICEHUB_HID_QUIET_MS: '20', ...process.env };
    const p = spawn(process.execPath, [file], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
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
const together = JOBS > 1 ? list.filter((f) => !serial.has(f)).sort((a, b) => (times[b] ?? 30000) - (times[a] ?? 30000)) : [];
const alone = list.filter((f) => !together.includes(f));
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, together.length) }, async () => { while (next < together.length) say(await run(together[next++])); }));
for (const file of alone) say(await run(file));
const failed = results.filter((r) => !r.ok);
try { fs.writeFileSync(TIMES, JSON.stringify({ ...times, ...Object.fromEntries(results.map((r) => [r.file, r.ms])) })); } catch {}
console.log(`\n${results.length - failed.length} of ${results.length} test files passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const r of failed) {
  console.log(`\n---- ${r.file} failed:`);
  console.log(r.out.split(/\r?\n/).slice(-15).join('\n'));
}
process.exit(failed.length ? 1 : 0);
