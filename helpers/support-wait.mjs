// "Your device is supported now" (29 Oct 2026, Shawn: tell people when the device they asked about gets a driver).
// When someone presses Request support for a device (GET /api/help/request, or the one-click send), its USB id is kept
// on this PC in data\support-wanted.json. After that, each time the device library is read (the Overview asks), any
// wanted id that a library entry (shipped or from a library update) now covers, and that is not installed yet, is
// offered on the Overview: "Your <name> is supported now" with Install (the person's click, POST
// /api/library/install, the Set up card's own path) and Not now (forgotten). Nothing is installed by itself.
//
//   remember(vid, pid, name)   keep an id the person asked about
//   arrived()                  [{ id, vid, pid, name, entry, product, status }]: wanted ids a library entry now covers
//   forget(id)                 drop one (Not now, or installed)
//   handle(url, req, res, send, readBody)   GET /api/help/supported-now, POST /api/help/supported-now/forget
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { match, hex4 } from './device-library.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = 'support-wanted.json';
export const MAX = 40;
// root: the DeviceHub folder (tests use their own); now: the clock
export const options = { root: ROOT, now: () => new Date() };

const fileOf = (root) => require('./data-dir.js').dataFile(FILE, root);
const ID = /^[0-9a-f]{4}:[0-9a-f]{4}$/;
export function read(root = options.root) {
  try { const j = JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); return j && typeof j.items === 'object' && j.items ? j : { items: {} }; } catch { return { items: {} }; }
}
function write(root, data) {
  const f = fileOf(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

export function remember(vid, pid, name = '', root = options.root) {
  const id = `${hex4(vid)}:${hex4(pid)}`;
  if (!ID.test(id)) return false;
  const data = read(root);
  data.items[id] = { name: String(name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), at: data.items[id]?.at || options.now().toISOString() };
  // the newest MAX only
  const keep = Object.entries(data.items).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, MAX);
  write(root, { items: Object.fromEntries(keep) });
  return true;
}

export function forget(id, root = options.root) {
  const data = read(root);
  if (!(String(id) in data.items)) return false;
  delete data.items[String(id)];
  write(root, data);
  return true;
}

export function arrived(root = options.root) {
  const wanted = Object.entries(read(root).items).filter(([id]) => ID.test(id));
  if (!wanted.length) return [];
  const usb = wanted.map(([id, w]) => { const [vid, pid] = id.split(':'); return { vid, pid, name: w.name }; });
  const out = [];
  for (const m of match(usb, { root, untested: true })) {
    if (m.installed) continue;
    for (const u of m.matched) {
      const id = `${u.vid}:${u.pid}`;
      if (out.some((x) => x.id === id)) continue;
      const w = read(root).items[id] || {};
      out.push({ id, vid: u.vid, pid: u.pid, name: w.name || `${m.meta.vendor} ${m.meta.product}`, entry: m.name, product: `${m.meta.vendor} ${m.meta.product}`, status: m.meta.status });
    }
  }
  return out;
}

export async function handle(url, req, res, send, readBody) {
  if (url.pathname === '/api/help/supported-now' && req.method === 'GET') { send(res, 200, { ok: true, arrived: arrived() }); return true; }
  if (url.pathname === '/api/help/supported-now/forget' && req.method === 'POST') { const b = (await readBody(req)) || {}; send(res, 200, { ok: forget(typeof b.id === 'string' ? b.id : '') }); return true; }
  return false;
}
