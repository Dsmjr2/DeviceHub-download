// The device library (22 Oct 2026; device-library/README.md): drivers one person's Claude wrote for a device, shipped
// with DeviceHub, so the next person with the same device gets it instead of learning it again. Each entry is
// device-library/<vendor-product>/ with device.mjs (a my-devices driver, helpers/my-devices.mjs) and device.json (what
// it is, what works, who tested it). This module only READS the library; installFromLibrary() copies a "tested" entry
// into my-devices/<name>/ (never over an existing folder) and my-devices.mjs loads it on the next start.
// Entries whose name starts with "_" are examples: only offered and installed when DEVICEHUB_EXAMPLE_DEVICE=1 (demo/test).
//
//   list({ root })                    every entry, with its device.json and any problem
//   match(usb, { root })              the entries for these USB devices ([{ vid, pid, name }], as /api/pc lists them)
//   installFromLibrary(name, { root }) { ok, name, to } or { ok: false, error }
//   validateMeta(meta)                what is wrong with a device.json, or null
//   devicehubVersion(root)            this copy's version (release.json's commit, else package.json's version)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { problem } from './my-devices.mjs';

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
  if (!Array.isArray(m.tested) || !m.tested.length || m.tested.some((t) => !t || typeof t.date !== 'string' || typeof t.devicehub !== 'string')) return 'tested must list who tested it, when (date) and on which DeviceHub version (devicehub)';
  return null;
}

export function devicehubVersion(root = ROOT) {
  try { const r = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8')); if (r.commit) return String(r.commit); } catch {}
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || 'unknown'); } catch { return 'unknown'; }
}

// every entry: [{ name, dir, meta?, error? }]; examples only in demo/test (or when asked with examples: true)
export function list({ root = ROOT, examples = showsExamples() } = {}) {
  const dir = path.join(root, 'device-library');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || (isExample(name) && !examples)) continue;
    const d = path.join(dir, name);
    if (!NAME.test(name)) { out.push({ name, dir: d, error: 'its folder name must be a-z, 0-9 and - (vendor-product)' }); continue; }
    if (!fs.existsSync(path.join(d, 'device.mjs'))) { out.push({ name, dir: d, error: 'no device.mjs in it' }); continue; }
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(d, 'device.json'), 'utf8')); } catch (e) { out.push({ name, dir: d, error: `device.json: ${e.code === 'ENOENT' ? 'missing' : e.message}` }); continue; }
    const why = validateMeta(meta);
    out.push(why ? { name, dir: d, meta, error: why } : { name, dir: d, meta });
  }
  return out;
}

// the library entries for this PC's USB devices. usb: [{ vid, pid, name }] (/api/pc's usb list, or pc-map's).
// Returns [{ name, meta, matched: [{ vid, pid, name }], installed, installable, why }], one per entry that matches.
export function match(usb, { root = ROOT, examples = showsExamples() } = {}) {
  const have = (Array.isArray(usb) ? usb : []).map((u) => ({ vid: hex4(u.vid), pid: hex4(u.pid), name: u.name || '' }));
  const out = [];
  for (const e of list({ root, examples })) {
    if (e.error) continue;
    const vid = hex4(e.meta.vid), pids = e.meta.pids.map(hex4);
    const matched = have.filter((u) => u.vid === vid && pids.includes(u.pid));
    if (!matched.length) continue;
    const installed = fs.existsSync(path.join(root, 'my-devices', e.name));
    const why = installed ? 'already in my-devices' : e.meta.status !== 'tested' ? `its status is "${e.meta.status}": only tested entries install by themselves` : null;
    out.push({ name: e.name, meta: e.meta, matched, installed, installable: !why, why });
  }
  return out;
}

// copies a "tested" entry into my-devices/<name>/. Never over an existing folder, never anywhere but my-devices.
export async function installFromLibrary(name, { root = ROOT, examples = showsExamples() } = {}) {
  const fail = (error) => ({ ok: false, name, error });
  if (typeof name !== 'string' || !NAME.test(name)) return fail('not a library entry name');
  if (isExample(name) && !examples) return fail('examples install only in demo/test (DEVICEHUB_EXAMPLE_DEVICE=1)');
  const entry = list({ root, examples }).find((e) => e.name === name);
  if (!entry) return fail('no such library entry');
  if (entry.error) return fail(entry.error);
  if (entry.meta.status !== 'tested') return fail(`its status is "${entry.meta.status}": only tested entries install`);
  const to = path.join(root, 'my-devices', name);
  if (fs.existsSync(to)) return fail(`my-devices/${name} already exists: it is left as it is`);
  // the driver must load the way my-devices.mjs will load it
  try {
    const a = (await import(`${pathToFileURL(path.join(entry.dir, 'device.mjs')).href}?check=${Date.now()}`)).default;
    const why = problem(a);
    if (why) return fail(`its device.mjs: ${why}`);
    if (a.id !== entry.meta.id) return fail(`its device.mjs id "${a.id}" is not device.json's "${entry.meta.id}"`);
  } catch (e) { return fail(`its device.mjs does not load: ${String(e.message || e).split('\n')[0]}`); }
  fs.mkdirSync(path.join(root, 'my-devices'), { recursive: true });
  try { fs.mkdirSync(to); } catch (e) { return fail(e.code === 'EEXIST' ? `my-devices/${name} already exists: it is left as it is` : e.message); }
  for (const f of ['device.mjs', 'device.json']) fs.copyFileSync(path.join(entry.dir, f), path.join(to, f), fs.constants.COPYFILE_EXCL);
  return { ok: true, name, to, id: entry.meta.id, note: 'DeviceHub loads it on its next start' };
}
