// The device library (22 Oct 2026; device-library/README.md): drivers one person's Claude wrote for a device, shipped
// with DeviceHub, so the next person with the same device gets it instead of learning it again. Each entry is
// device-library/<vendor-product>/ with device.mjs (a my-devices driver, helpers/my-devices.mjs) or driver.json (a
// driver as data, docs/DRIVER-FORMAT.md; a driver.json-only entry since 22 Oct 2026, so a driver made with the learning
// wizard can be shared) and device.json (what it is, what works, who tested it). This module only READS the library; installFromLibrary() copies a "tested" entry
// (and, with readOnly: true, a "read-only" one) into my-devices/<name>/ (never over an existing folder) with a
// library.json marker, and my-devices.mjs loads it GUARDED on the next start (or at once through its loadNew()):
// a read-only entry's writes stay refused until each setting passes the self-check (docs/handoff/auto-setup.md).
// Entries whose name starts with "_" are examples: only offered and installed when DEVICEHUB_EXAMPLE_DEVICE=1 (demo/test).
//
//   list({ root })                    every entry, with its device.json and any problem
//   match(usb, { root, readOnly })    the entries for these USB devices ([{ vid, pid, name }], as /api/pc lists them)
//   installFromLibrary(name, { root, readOnly }) { ok, name, to } or { ok: false, error }
//                                     readOnly: true also installs "read-only" entries (guarded); default tested only
//   validateMeta(meta)                what is wrong with a device.json, or null
//   loadDriver(dir)                   { file, a }: the folder's device.mjs (wins when both are there) or driver.json
//   devicehubVersion(root)            this copy's version (release.json's commit, else package.json's version)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { problem } from './my-devices.mjs';
import { cacheRoot, entryVersion } from './library-updates.mjs';   // no cycle: library-updates imports nothing from here

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATUSES = ['tested', 'read-only', 'untested'];
const NAME = /^_?[a-z0-9][a-z0-9-]{1,60}$/;

export const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
export const showsExamples = () => process.env.DEVICEHUB_EXAMPLE_DEVICE === '1';
const isExample = (name) => name.startsWith('_');

// what is wrong with a device.json, or null
export function validateMeta(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'device.json is not an object';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(m.id || '')) return 'id must be the driver\'s id (a-z, 0-9, -)';
  for (const k of ['vendor', 'product', 'kind']) if (typeof m[k] !== 'string' || !m[k].trim()) return `it needs ${k}`;
  if (!/^(0x)?[0-9a-f]{4}$/i.test(String(m.vid ?? ''))) return 'vid must be 4 hex digits';
  if (!Array.isArray(m.pids) || !m.pids.length || m.pids.some((p) => !/^(0x)?[0-9a-f]{4}$/i.test(String(p)))) return 'pids must list 4-hex-digit product ids';
  if (!Array.isArray(m.models) || !m.models.length || m.models.some((x) => typeof x !== 'string' || !x.trim())) return 'models must list the model names';
  if (!STATUSES.includes(m.status)) return `status must be ${STATUSES.join(', ')}`;
  if (!Array.isArray(m.works)) return 'works must be a list (what was checked to work)';
  // a "read-only" or "untested" entry may have no test record yet (22 Oct 2026); a "tested" one must have one
  if (!Array.isArray(m.tested) || (m.status === 'tested' && !m.tested.length) || m.tested.some((t) => !t || typeof t.date !== 'string' || typeof t.devicehub !== 'string')) return 'tested must list who tested it, when (date) and on which DeviceHub version (devicehub)';
  return null;
}

// the driver files a folder can have; device.mjs wins when both are there (as helpers/my-devices.mjs loads them)
export const DRIVER_FILES = ['device.mjs', 'driver.json'];
export const driverFileOf = (dir) => DRIVER_FILES.find((f) => fs.existsSync(path.join(dir, f))) || null;
// loads a folder's driver the way my-devices.mjs will: device.mjs imported, or driver.json checked (validate) and built
export async function loadDriver(dir, tag = 'check') {
  const file = driverFileOf(dir);
  if (!file) throw new Error('no device.mjs or driver.json in it');
  if (file === 'device.mjs') return { file, a: (await import(`${pathToFileURL(path.join(dir, file)).href}?${tag}=${Date.now()}`)).default };
  const { fromJson } = await import('./declarative-driver.mjs');
  return { file, a: fromJson(path.join(dir, file)) };
}

export function devicehubVersion(root = ROOT) {
  try { const r = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8')); if (r.commit) return String(r.commit); } catch {}
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || 'unknown'); } catch { return 'unknown'; }
}

// every entry: [{ name, dir, meta?, error? }]; examples only in demo/test (or when asked with examples: true)
// every entry: the shipped device-library/ plus library-cache/ (signed entries fetched between releases,
// helpers/library-updates.mjs); a cached entry wins only when it is strictly newer, or the shipped one is broken
export function list({ root = ROOT, examples = showsExamples() } = {}) {
  const byName = new Map(scan(path.join(root, 'device-library'), examples, 'device-library').map((e) => [e.name, e]));
  for (const c of scan(cacheRoot(root), false, 'library-cache')) {
    const s = byName.get(c.name);
    if (!s || (s.error && !c.error) || (!c.error && (entryVersion(c.meta) || '') > (entryVersion(s.meta) || ''))) byName.set(c.name, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function scan(dir, examples, origin) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || (isExample(name) && !examples)) continue;
    const d = path.join(dir, name);
    if (!NAME.test(name)) { out.push({ name, dir: d, origin, error: 'its folder name must be a-z, 0-9 and - (vendor-product)' }); continue; }
    if (!driverFileOf(d)) { out.push({ name, dir: d, origin, error: 'no device.mjs or driver.json in it' }); continue; }
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(d, 'device.json'), 'utf8')); } catch (e) { out.push({ name, dir: d, origin, error: `device.json: ${e.code === 'ENOENT' ? 'missing' : e.message}` }); continue; }
    const why = validateMeta(meta);
    out.push(why ? { name, dir: d, origin, meta, error: why } : { name, dir: d, origin, meta });
  }
  return out;
}

// the library entries for this PC's USB devices. usb: [{ vid, pid, name }] (/api/pc's usb list, or pc-map's).
// Returns [{ name, meta, matched: [{ vid, pid, name }], installed, installable, why }], one per entry that matches.
export function match(usb, { root = ROOT, examples = showsExamples(), readOnly = false } = {}) {
  const have = (Array.isArray(usb) ? usb : []).map((u) => ({ vid: hex4(u.vid), pid: hex4(u.pid), name: u.name || '' }));
  const out = [];
  for (const e of list({ root, examples })) {
    if (e.error) continue;
    const vid = hex4(e.meta.vid), pids = e.meta.pids.map(hex4);
    const matched = have.filter((u) => u.vid === vid && pids.includes(u.pid));
    if (!matched.length) continue;
    const installed = fs.existsSync(path.join(root, 'my-devices', e.name));
    const ok = e.meta.status === 'tested' || (readOnly && e.meta.status === 'read-only');
    const why = installed ? 'already in my-devices' : !ok ? `its status is "${e.meta.status}": only tested${readOnly ? ' and read-only' : ''} entries install by themselves` : null;
    const note = !why && e.meta.status === 'read-only' ? 'installs read-only: each setting can be changed once it passes its self-check' : undefined;
    out.push({ name: e.name, meta: e.meta, matched, installed, installable: !why, why, ...(note ? { note } : {}) });
  }
  return out;
}

// copies a "tested" entry into my-devices/<name>/. Never over an existing folder, never anywhere but my-devices.
export async function installFromLibrary(name, { root = ROOT, examples = showsExamples(), readOnly = false, now = () => new Date() } = {}) {
  const fail = (error) => ({ ok: false, name, error });
  if (typeof name !== 'string' || !NAME.test(name)) return fail('not a library entry name');
  if (isExample(name) && !examples) return fail('examples install only in demo/test (DEVICEHUB_EXAMPLE_DEVICE=1)');
  const entry = list({ root, examples }).find((e) => e.name === name);
  if (!entry) return fail('no such library entry');
  if (entry.error) return fail(entry.error);
  if (!(entry.meta.status === 'tested' || (readOnly && entry.meta.status === 'read-only'))) return fail(`its status is "${entry.meta.status}": only tested${readOnly ? ' and read-only' : ''} entries install`);
  const to = path.join(root, 'my-devices', name);
  if (fs.existsSync(to)) return fail(`my-devices/${name} already exists: it is left as it is`);
  // the driver must load the way my-devices.mjs will load it
  const file = driverFileOf(entry.dir);
  try {
    const { a } = await loadDriver(entry.dir);
    const why = problem(a);
    if (why) return fail(`its ${file}: ${why}`);
    if (a.id !== entry.meta.id) return fail(`its ${file} id "${a.id}" is not device.json's "${entry.meta.id}"`);
  } catch (e) { return fail(`its ${file} does not load: ${String(e.message || e).split('\n')[0]}`); }
  fs.mkdirSync(path.join(root, 'my-devices'), { recursive: true });
  try { fs.mkdirSync(to); } catch (e) { return fail(e.code === 'EEXIST' ? `my-devices/${name} already exists: it is left as it is` : e.message); }
  for (const f of [...DRIVER_FILES.filter((x) => fs.existsSync(path.join(entry.dir, x))), 'device.json']) fs.copyFileSync(path.join(entry.dir, f), path.join(to, f), fs.constants.COPYFILE_EXCL);
  // the marker my-devices.mjs loads it guarded by (its source and status; nothing about the PC or the person)
  const last = entry.meta.tested.at(-1) || {};
  const mark = { source: `${entry.origin || 'device-library'}/${name}`, name, id: entry.meta.id, status: entry.meta.status, installedAt: now().toISOString(), devicehub: devicehubVersion(root), libraryTested: last.date || null, libraryDevicehub: last.devicehub || null };
  fs.writeFileSync(path.join(to, 'library.json'), JSON.stringify(mark, null, 2) + '\n', { flag: 'wx' });
  return { ok: true, name, to, id: entry.meta.id, status: entry.meta.status, note: entry.meta.status === 'tested' ? 'DeviceHub loads it on its next start' : 'DeviceHub loads it read-only on its next start; each setting opens once it passes its self-check' };
}
