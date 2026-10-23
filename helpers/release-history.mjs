// Every version of every app file DeviceHub ever had (23 Oct 2026, a friend's PC: "1 of DeviceHub's files were changed
// on this PC (public/style.css)" though nobody had changed it, and the only way on was "Ask Claude Code"). The zip carries
// release-history.json: for each file, the first 16 hex digits of the SHA-256 of each committed version of it, as stored
// (LF) and with Windows line endings (CRLF), as a checkout on Windows has it. A file on a PC that matches one of them is
// a version DeviceHub shipped (left by an update that stopped halfway, or an older install), not a change made on that
// PC, so an update goes over it (helpers/self-update.js changedFiles).
//   node helpers/release-history.mjs <file list (one path per line)> <out.json>
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const short = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
// the CRLF form of a text file (a file with a NUL byte is binary and has one form)
export function forms(buf) {
  if (buf.includes(0)) return [buf];
  const lf = Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');
  const crlf = Buffer.from(lf.toString('binary').replace(/\n/g, '\r\n'), 'binary');
  return [lf, crlf];
}

// { file: [hash16, ...] } for these files, from every commit that touched them
export async function history(files, { cwd = ROOT } = {}) {
  const want = new Set(files);
  // every blob each file has had: git log with the raw diff names each new blob id per path
  const log = execFileSync('git', ['log', '--format=', '--raw', '--no-abbrev', '--no-renames', '--', ...files], { cwd, maxBuffer: 1 << 30, encoding: 'utf8' });
  const blobs = new Map();
  for (const line of log.split('\n')) {
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) [AMT]\t(.+)$/.exec(line);
    if (!m || !want.has(m[2])) continue;
    if (!blobs.has(m[2])) blobs.set(m[2], new Set());
    blobs.get(m[2]).add(m[1]);
  }
  const ids = [...new Set([...blobs.values()].flatMap((s) => [...s]))];
  // one git cat-file for all of them
  const content = await new Promise((resolve, reject) => {
    const p = spawn('git', ['cat-file', '--batch'], { cwd });
    const out = [];
    p.stdout.on('data', (c) => out.push(c));
    p.on('error', reject);
    p.on('close', () => resolve(Buffer.concat(out)));
    p.stdin.end(ids.map((id) => `${id}\n`).join(''));
  });
  const byId = new Map();
  let o = 0;
  while (o < content.length) {
    const nl = content.indexOf(10, o);
    const [id, , size] = content.subarray(o, nl).toString().split(' ');
    const n = Number(size);
    byId.set(id, content.subarray(nl + 1, nl + 1 + n));
    o = nl + 1 + n + 1;
  }
  const out = {};
  for (const [f, set] of blobs) {
    const hs = new Set();
    for (const id of set) { const b = byId.get(id); if (b) for (const x of forms(b)) hs.add(short(x)); }
    out[f] = [...hs].sort();
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [list, outFile] = process.argv.slice(2);
  if (!list || !outFile) { console.error('usage: node helpers/release-history.mjs <file list> <out.json>'); process.exit(2); }
  const files = fs.readFileSync(list, 'utf8').split(/\r?\n/).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  const h = await history(files);
  fs.writeFileSync(outFile, JSON.stringify(h));
  console.log(`release history: ${Object.keys(h).length} files, ${Object.values(h).reduce((a, b) => a + b.length, 0)} versions`);
}
