// The tools shipped inside the DeviceHub zip (22 Oct 2026, the owner: "Yes why would we not want to ship them in it?"):
// Equalizer APO's installer and OpenRGB's portable build. helpers/make-installer.ps1 runs this before it builds the zip.
//
// For each tool in helpers/bundled-tools.json it downloads the ONE pinned file from that project's official source into
// bundled-cache/ (outside git), following redirects only over HTTPS and only to that tool's own hosts, and refuses the
// file unless its size and SHA-256 are the pinned ones. For OpenRGB's zip it then takes out only the kept files (each
// with its own pinned SHA-256) and never one that matches neverKeep (a .sys driver, PawnIO's driver, WinRing0, inpout;
// only OpenRGB's user-mode PawnIOLib.dll is allowed), whatever the table says. OpenRGB's six PawnIO modules (.bin) are
// the one exception (22 Oct 2026, Shawn: "I want the app to be able to set it up"): each named in the table's
// boardModules with its own SHA-256, they go only into tools/openrgb/board-modules/, never beside OpenRGB.exe, so the
// USB-only OpenRGB never loads them (helpers/board-lights.mjs uses them). Nothing downloaded is ever run or opened here.
//
//   node helpers/fetch-bundled.mjs [--cache <dir>] [--manifest <file>]
// prints (and with --manifest writes) the list of files for the zip: [{ src, dest }], dest relative to the zip's
// DeviceHub/ folder with forward slashes (tools/<id>/..., tools/README.txt). Exit 1 on any refusal.
import fs from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json'), 'utf8'));
const NEVER = TABLE.neverKeep.map((s) => new RegExp(s, 'i'));
// a driver, PawnIO (except its user-mode PawnIOLib.dll), WinRing0, inpout: never kept, never extracted, never put in the zip
export const neverKept = (name) => NEVER.some((r) => r.test(String(name).replace(/\\/g, '/').split('/').pop()) || r.test(String(name)));

// OpenRGB's PawnIO modules for board lights: a plain file name the table lists in boardModules, only ever placed in
// <folder>/<boardModulesFolder>/ (never beside OpenRGB.exe)
const MODULE_NAME = /^[A-Za-z0-9_]+\.bin$/;
export const boardModule = (t, rel) => MODULE_NAME.test(String(rel)) && !!t.boardModules && Object.prototype.hasOwnProperty.call(t.boardModules, rel);
export const boardDest = (t, name) => `${t.folder}/${t.boardModulesFolder}/${name}`;

export const hostOk = (t, u) => {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:') return false;
  return t.hosts.some((h) => (h.startsWith('.') ? x.hostname.endsWith(h) : x.hostname === h));
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = (f) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(f).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

// the one part that touches the network; tests swap it: (url) -> Promise<{ statusCode, headers, stream }>
export const deps = {
  get(u) {
    return new Promise((resolve, reject) => {
      const r = https.get(u, { headers: { 'User-Agent': 'DeviceHub-build' }, timeout: 30000 }, (res) => resolve({ statusCode: res.statusCode, headers: res.headers, stream: res }));
      r.on('timeout', () => r.destroy(new Error(`${new URL(u).hostname} did not answer`)));
      r.on('error', reject);
    });
  },
};

// a table entry that would keep a forbidden file is a mistake in the table: refused before anything is fetched
export function checkTable(t) {
  const bad = Object.keys(t.keep || {}).filter(neverKept);
  if (bad.length) throw new Error(`${t.name}: the table keeps ${bad.join(', ')}, which is never bundled`);
  if (!/^[0-9a-f]{64}$/.test(t.sha256 || '')) throw new Error(`${t.name}: no pinned SHA-256`);
  if (!(t.size > 0)) throw new Error(`${t.name}: no pinned size`);
  if (!hostOk(t, t.url)) throw new Error(`${t.name}: its URL is not on its own hosts`);
  if (t.boardModules) {
    const bad = Object.entries(t.boardModules).filter(([k, v]) => !MODULE_NAME.test(k) || !/^[0-9a-f]{64}$/.test(v || '') || (t.keep || {})[k]).map(([k]) => k);
    if (bad.length) throw new Error(`${t.name}: board modules must be plain .bin names with a pinned SHA-256, never in keep: ${bad.join(', ')}`);
    if (!/^[a-z-]+$/.test(t.boardModulesFolder || '') || neverKept(t.boardModulesFolder)) throw new Error(`${t.name}: the board modules need their own folder (boardModulesFolder)`);
  }
}

// download t.url to dest: HTTPS, redirects only to t.hosts, exactly t.size bytes, then the pinned SHA-256
export async function download(t, dest) {
  const part = `${dest}.part`;
  let u = t.url;
  try {
    for (let hop = 0; ; hop++) {
      if (hop > 8) throw new Error('too many redirects');
      if (!hostOk(t, u)) throw new Error(`refused: the download went to ${safeHost(u)}, which is not ${t.name}'s official host (${t.hosts.join(', ')})`);
      const res = await deps.get(u);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.stream?.resume?.(); u = new URL(res.headers.location, u).href; continue; }
      if (res.statusCode !== 200) { res.stream?.resume?.(); throw new Error(`${safeHost(u)} answered ${res.statusCode}`); }
      const len = Number(res.headers['content-length']);
      if (len && len !== t.size) { res.stream?.destroy?.(); throw new Error(`refused: ${t.file} is ${len} bytes, the pinned one is ${t.size}`); }
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part);
        let got = 0;
        res.stream.on('data', (c) => { got += c.length; if (got > t.size) res.stream.destroy(new Error(`refused: ${t.file} is larger than the pinned ${t.size} bytes`)); });
        res.stream.on('error', (e) => { out.destroy(); reject(e); });
        out.on('error', reject);
        out.on('finish', () => (got !== t.size ? reject(new Error(`refused: got ${got} bytes of ${t.size}`)) : resolve()));
        res.stream.pipe(out);
      });
      break;
    }
    const h = await sha256File(part);
    if (h !== t.sha256) throw new Error(`refused: ${t.file} has SHA-256 ${h}, not the pinned ${t.sha256}`);
    fs.renameSync(part, dest);
  } catch (e) { try { fs.rmSync(part, { force: true }); } catch {} throw e; }
}
const safeHost = (u) => { try { return new URL(u).hostname || u; } catch { return String(u); } };

// a minimal ZIP reader (central directory, stored and deflated entries; no ZIP64, which a 22 MB file never needs)
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) throw new Error('ZIP64 is not expected here');
  const out = [];
  for (let i = 0, o = cdOff; i < count; i++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(o + 10), csize = buf.readUInt32LE(o + 20), usize = buf.readUInt32LE(o + 24);
    const nlen = buf.readUInt16LE(o + 28), xlen = buf.readUInt16LE(o + 30), clen = buf.readUInt16LE(o + 32), local = buf.readUInt32LE(o + 42);
    const name = buf.toString('utf8', o + 46, o + 46 + nlen).replace(/\\/g, '/');
    out.push({
      name, size: usize,
      data: () => {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad zip entry ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        const d = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
        if (!d) throw new Error(`${name}: unsupported zip method ${method}`);
        if (d.length !== usize) throw new Error(`${name}: wrong size after unpacking`);
        return d;
      },
    });
    o += 46 + nlen + xlen + clen;
  }
  return out;
}

// which of a zip's files are taken: every file under zipRoot must be named in keep, boardModules or dropped (a changed
// zip is refused, never guessed at); neverKept wins over everything except a listed board module (its own folder)
export function planZip(t, entries) {
  const take = [], board = [], left = [], unknown = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    if (!e.name.startsWith(t.zipRoot)) { unknown.push(e.name); continue; }
    const rel = e.name.slice(t.zipRoot.length);
    if (!rel || rel.split('/').some((p) => p === '..' || p === '' || /[:*?"<>|]/.test(p))) { unknown.push(e.name); continue; }
    if (boardModule(t, rel)) { board.push({ rel, entry: e, sha256: t.boardModules[rel] }); continue; }
    if (neverKept(rel)) { left.push(rel); continue; }
    if (t.keep[rel]) take.push({ rel, entry: e, sha256: t.keep[rel] });
    else if (t.dropped?.[rel]) left.push(rel);
    else unknown.push(e.name);
  }
  if (unknown.length) throw new Error(`refused: ${t.file} holds files the table does not name: ${unknown.join(', ')}`);
  const missing = Object.keys(t.keep).filter((k) => !neverKept(k) && !take.some((x) => x.rel === k));
  const lacking = Object.keys(t.boardModules || {}).filter((k) => !board.some((x) => x.rel === k));
  if (missing.length || lacking.length) throw new Error(`refused: ${t.file} lacks ${[...missing, ...lacking].join(', ')}`);
  return { take, board, left };
}

export function readme(tools) {
  const lines = [
    'Tools shipped inside DeviceHub',
    '==============================',
    '',
    'DeviceHub carries these two free tools so nobody has to download them separately (decided 22 Oct 2026).',
    'Each file is the project\'s own official download, unchanged, checked against the SHA-256 pinned in',
    'helpers/bundled-tools.json when this zip was built. Nothing here is installed or started at boot:',
    '- Equalizer APO: its own installer, run only when you click Install (Settings > Optional tools, or the',
    '  Headset page\'s Equalizer card); Windows asks for permission first. Uninstall it in Windows Settings > Apps.',
    '- OpenRGB: started by DeviceHub, hidden, only while you use PC lights, for USB lights only, and stopped when',
    '  DeviceHub quits. The PawnIO driver and every kernel driver were left out. OpenRGB\'s own PawnIO modules are in',
    '  tools/openrgb/board-modules/, where OpenRGB never loads them. Only when you click "Add board, fan and RAM lights"',
    '  does DeviceHub copy them with OpenRGB into C:\\Program Files\\DeviceHub board lights\\ (one Windows prompt), so',
    '  OpenRGB, as administrator, can reach the board\'s lights. "Remove board lights" takes that away again.',
    '',
  ];
  for (const t of tools) {
    lines.push(`${t.name} ${t.version} (tools/${t.folder.split('/').pop()}/)`,
      `  Official page: ${t.page}`, `  Downloaded from: ${t.url}`, `  File: ${t.file}, ${t.size} bytes, SHA-256 ${t.sha256}`,
      `  License: ${t.license} (${t.licenseNote}); the license text is beside it.`,
      `  Source code: ${t.sourceCode}`);
    if (t.boardModules) lines.push(`  PawnIO modules, used only for board lights: ${Object.keys(t.boardModules).join(', ')} (in tools/openrgb/${t.boardModulesFolder}/; the PawnIO driver is not bundled).`);
    if (t.dropped) lines.push(`  Left out of its zip: ${Object.keys(t.dropped).join(', ')}.`);
    lines.push('');
  }
  return lines.join('\r\n');
}

// fetch, check and lay out every tool; returns the manifest for the zip
export async function fetchAll({ cache = path.join(ROOT, 'bundled-cache'), log = () => {} } = {}) {
  fs.mkdirSync(cache, { recursive: true });
  const files = [];
  for (const t of TABLE.tools) {
    checkTable(t);
    const dl = path.join(cache, t.file);
    if (fs.existsSync(dl) && (await sha256File(dl)) !== t.sha256) { log(`${t.file}: the cached copy does not match; downloading again`); fs.rmSync(dl, { force: true }); }
    if (!fs.existsSync(dl)) { log(`downloading ${t.name} ${t.version} from ${new URL(t.url).hostname}`); await download(t, dl); }
    log(`${t.file}: SHA-256 matches the pinned one`);
    if (t.kind === 'installer') files.push({ src: dl, dest: `${t.folder}/${t.file}` });
    else if (t.kind === 'zip') {
      const out = path.join(cache, `${t.id}-${t.version}`);
      const { take, board, left } = planZip(t, readZip(fs.readFileSync(dl)));
      for (const k of board) {
        const f = path.join(out, t.boardModulesFolder, k.rel);
        if (!fs.existsSync(f) || (await sha256File(f)) !== k.sha256) {
          const d = k.entry.data();
          if (sha(d) !== k.sha256) throw new Error(`refused: ${k.rel} in ${t.file} does not match its pinned SHA-256`);
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, d);
        }
        files.push({ src: f, dest: boardDest(t, k.rel), board: true });
      }
      for (const k of take) {
        const f = path.join(out, ...k.rel.split('/'));
        if (!fs.existsSync(f) || (await sha256File(f)) !== k.sha256) {
          const d = k.entry.data();
          if (sha(d) !== k.sha256) throw new Error(`refused: ${k.rel} in ${t.file} does not match its pinned SHA-256`);
          fs.mkdirSync(path.dirname(f), { recursive: true });
          fs.writeFileSync(f, d);
        }
        files.push({ src: f, dest: `${t.folder}/${k.rel}` });
      }
      if (left.length) log(`${t.name}: left out ${left.join(', ')}`);
    } else throw new Error(`${t.name}: unknown kind ${t.kind}`);
    files.push({ src: path.join(ROOT, t.licenseFile), dest: `${t.folder}/LICENSE-${t.license}.txt` });
  }
  const rm = path.join(cache, 'README.txt');
  fs.writeFileSync(rm, readme(TABLE.tools));
  files.push({ src: rm, dest: 'tools/README.txt' });
  // never a driver; a .bin only as a listed board module in its own folder
  const okModule = (f) => f.board && TABLE.tools.some((t) => boardModule(t, f.dest.split('/').pop()) && f.dest === boardDest(t, f.dest.split('/').pop()));
  const bad = files.filter((f) => neverKept(f.dest) && !okModule(f));
  if (bad.length) throw new Error(`refused: ${bad.map((f) => f.dest).join(', ')} would go into the zip`);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  try {
    const files = await fetchAll({ cache: arg('--cache') || undefined, log: (s) => console.error(s) });
    const json = JSON.stringify(files, null, 1);
    if (arg('--manifest')) fs.writeFileSync(arg('--manifest'), json);
    else console.log(json);
  } catch (e) { console.error(e.message); process.exit(1); }
}
