// Device library updates between app releases (22 Oct 2026; docs/handoff/library-updates.md). New and changed
// device-library entries reach every copy by themselves: the publisher builds dist\device-library.json
// (helpers/make-library-bundle.mjs, signed with the same Ed25519 key as an app release but over a payload of its own),
// uploads it beside version.json, and each copy fetches it at most once a day (and on demand), checks the signature
// with helpers/release-public-key.pem and every entry's SHA-256, and writes the entries to library-cache\<name>\.
//
// Safety: nothing fetched is ever run here (no import, no eval, no child process): the cache holds text only, and a
// driver from it runs only the way a shipped library entry does (installFromLibrary, then my-devices.mjs, guarded). An
// unsigned, altered, wrong-key, app-release-signed or older bundle is refused whole and the last good cache stays; an
// entry whose text does not match its signed SHA-256 is refused alone (its last good copy stays). The cache is
// library-cache\ only: never my-devices\ or device-library\. Offline, a timeout or an error leaves the cache as it was.
// Off: DEVICEHUB_LIBRARY_UPDATES=0 or settings.json "libraryUpdates": false.
//
//   cacheRoot(root)                       the cache folder (device-library.mjs reads entries from it too)
//   entryVersion(meta)                    the version an entry is compared by (newer wins over device-library\)
//   payload(bundle)                       what the signature covers (helpers/make-library-bundle.mjs signs the same)
//   verifyBundle(bundle, publicKeyPem)    { ok, entries, refused } or { ok: false, error }
//   check({ root, url, force, ... })      fetch, verify and write the cache now (force: also when checked today)
//   checkIfDue(opts)                      check() only when the last check is 24 h old or more
//   schedule({ root, log })               checkIfDue a few minutes after start, then every hour (timers unref'd)
//   status(root)                          the last check, the cached entries and any errors
//   handle(url, req, res, send)           GET /api/library/updates, POST /api/library/update; true when it answered
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_FILE = 'device-library.json';
export const KIND = 'devicehub-library-bundle';
export const FORMAT = 1;
const DAY = 24 * 60 * 60 * 1000;
const MAX_BUNDLE = 8 * 1024 * 1024, MAX_DRIVER = 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{1,60}$/;  // no "_" examples, no dots, no slashes: one plain folder name
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;  // Windows device names, never a folder
const DEFAULT_URL = () => (process.env.DEVICEHUB_RELEASE_URL || 'https://github.com/Dsmjr2/DeviceHub-download/releases/latest/download/') + BUNDLE_FILE;
const PUBLIC_KEY = (root) => path.join(root, 'helpers', 'release-public-key.pem');

export const cacheRoot = (root = ROOT) => path.join(root, 'library-cache');
const STATE = (root) => path.join(cacheRoot(root), 'state.json');
const MARKER = 'bundle.json';
export const sha256 = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// the version an entry is compared by: device.json "updated" (an ISO date the sharer sets when they change an entry),
// else its newest tested date, else '' (never newer than anything). A cached entry replaces a shipped one only when
// its version is strictly newer.
export function entryVersion(meta) {
  const dates = [meta?.updated, ...(Array.isArray(meta?.tested) ? meta.tested.map((t) => t?.date) : [])].filter((d) => typeof d === 'string' && d.trim());
  return dates.sort().at(-1) || '';
}

// the signed text. It starts with its own label, not "[", so it can never be an app release's payload
// (helpers/sign-release.mjs signs JSON.stringify([commit, builtAt, appCommit, size, sha256])) and vice versa.
// which file a bundled driver is: its signed text is a JSON object for a driver.json, code for a device.mjs
export function driverFile(text) { try { const o = JSON.parse(text); return o && typeof o === 'object' && !Array.isArray(o) ? 'driver.json' : 'device.mjs'; } catch { return 'device.mjs'; } }
export const payload = (b) => `${KIND}/${FORMAT}\n${JSON.stringify([b.builtAt, (b.list || []).map((x) => [x.name, x.version, x.sha256, x.metaSha256])])}`;

// an entry's name and device.json look sane enough to be written to the cache (the full check is device-library.mjs's
// validateMeta, run when the entry is listed)
export function entryProblem(name, meta) {
  if (typeof name !== 'string' || !NAME.test(name) || RESERVED.test(name)) return 'its name must be a-z, 0-9 and - (vendor-product)';
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'device.json is not an object';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(meta.id || '')) return 'device.json has no valid id';
  if (!/^(0x)?[0-9a-f]{4}$/i.test(String(meta.vid ?? ''))) return 'device.json has no valid vid';
  if (!Array.isArray(meta.pids) || !meta.pids.length) return 'device.json has no pids';
  return null;
}

// { ok: true, bundle, entries: [good entries], refused: [{ name, why }] } or { ok: false, error }
export function verifyBundle(b, publicKeyPem) {
  const no = (error) => ({ ok: false, error });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return no('it is not a library bundle');
  if (b.kind !== KIND || b.format !== FORMAT) return no('it is not a DeviceHub library bundle (an app release or another file)');
  if (typeof b.builtAt !== 'string' || Number.isNaN(Date.parse(b.builtAt))) return no('it has no build date');
  if (!Array.isArray(b.list) || !Array.isArray(b.entries)) return no('it has no entry list');
  if (typeof b.signature !== 'string' || !b.signature) return no('it is not signed');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(payload(b)), crypto.createPublicKey(publicKeyPem), Buffer.from(b.signature, 'base64')); } catch {}
  if (!ok) return no('it is not signed by DeviceHub\'s publisher (or it was altered after signing)');
  const listed = new Map();
  for (const x of b.list) {
    if (!x || typeof x.name !== 'string' || listed.has(x.name)) return no('its signed list names an entry twice or has a broken line');
    listed.set(x.name, x);
  }
  const entries = [], refused = [], seen = new Set();
  for (const e of b.entries) {
    const name = e?.name;
    if (typeof name !== 'string' || seen.has(name)) { refused.push({ name: String(name), why: 'named twice or unnamed' }); continue; }
    seen.add(name);
    const sig = listed.get(name);
    if (!sig) { refused.push({ name, why: 'not in the signed list' }); continue; }
    const why = entryProblem(name, e.meta);
    if (why) { refused.push({ name, why }); continue; }
    if (typeof e.mjs !== 'string' || Buffer.byteLength(e.mjs) > MAX_DRIVER) { refused.push({ name, why: 'its device.mjs is missing or too large' }); continue; }
    if (sha256(e.mjs) !== sig.sha256 || e.sha256 !== sig.sha256) { refused.push({ name, why: 'its device.mjs does not match its signed SHA-256' }); continue; }
    if (sha256(JSON.stringify(e.meta)) !== sig.metaSha256) { refused.push({ name, why: 'its device.json does not match its signed SHA-256' }); continue; }
    if (entryVersion(e.meta) !== sig.version) { refused.push({ name, why: 'its version does not match the signed list' }); continue; }
    entries.push({ name, version: sig.version, sha256: sig.sha256, metaSha256: sig.metaSha256, meta: e.meta, mjs: e.mjs });
  }
  for (const name of listed.keys()) if (!seen.has(name)) refused.push({ name, why: 'listed but missing from the bundle' });
  return { ok: true, bundle: b, entries, refused, listed: [...listed.keys()] };
}

// ---- state ----
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export function readState(root = ROOT) { return readJson(STATE(root), {}) || {}; }
async function writeState(root, s) {
  await fsp.mkdir(cacheRoot(root), { recursive: true });
  const tmp = `${STATE(root)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(s, null, 2) + '\n');
  await fsp.rename(tmp, STATE(root));
}
export function enabled(root = ROOT) {
  if (process.env.DEVICEHUB_LIBRARY_UPDATES === '0') return false;
  return readJson(path.join(root, 'settings.json'), {})?.libraryUpdates !== false;
}

// the entries now in the cache (folders with our marker)
export function cachedEntries(root = ROOT) {
  let names = [];
  try { names = fs.readdirSync(cacheRoot(root), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const mark = readJson(path.join(cacheRoot(root), name, MARKER));
    if (!mark) continue;
    const meta = readJson(path.join(cacheRoot(root), name, 'device.json'), {}) || {};
    out.push({ name, version: mark.version, sha256: mark.sha256, bundleBuiltAt: mark.bundleBuiltAt, vendor: meta.vendor, product: meta.product, kind: meta.kind, status: meta.status });
  }
  return out;
}

// ---- fetching (no code is run: the bundle is text, read and hashed) ----
async function download(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { accept: 'application/json, application/octet-stream' } });
  if (r.status === 404) throw new Error('no library bundle is published yet (404)');
  if (!r.ok) throw new Error(`the download page answered ${r.status}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BUNDLE) throw new Error('the library bundle is too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BUNDLE) throw new Error('the library bundle is too large');
  try { return JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); } catch { throw new Error('the library bundle is not JSON'); }
}

// writes the good entries to library-cache\<name>\ (staged, then swapped in one folder at a time); removes cached
// entries a newer signed bundle no longer lists; keeps the last good copy of an entry refused in this bundle
async function writeCache(root, v) {
  const cache = cacheRoot(root);
  await fsp.mkdir(cache, { recursive: true });
  const stamp = `${Date.now()}-${process.pid}`;
  const stage = path.join(cache, `.incoming-${stamp}`);
  await fsp.mkdir(stage);
  const changed = [];
  try {
    const before = new Map(cachedEntries(root).map((e) => [e.name, e]));
    for (const e of v.entries) {
      const old = before.get(e.name);
      const markOld = readJson(path.join(cache, e.name, MARKER));
      if (old && markOld?.sha256 === e.sha256 && markOld?.metaSha256 === e.metaSha256) continue;  // unchanged
      const d = path.join(stage, e.name);
      await fsp.mkdir(d);
      const file = driverFile(e.mjs);
      await fsp.writeFile(path.join(d, file), e.mjs, { flag: 'wx' });
      await fsp.writeFile(path.join(d, 'device.json'), JSON.stringify(e.meta, null, 2) + '\n', { flag: 'wx' });
      await fsp.writeFile(path.join(d, MARKER), JSON.stringify({ source: 'library update', name: e.name, version: e.version, sha256: e.sha256, metaSha256: e.metaSha256, bundleBuiltAt: v.bundle.builtAt }, null, 2) + '\n', { flag: 'wx' });
      // read back what was written before it replaces anything
      if (sha256(await fsp.readFile(path.join(d, file), 'utf8')) !== e.sha256) throw new Error(`${e.name}: the written driver does not read back the same`);
      const target = path.join(cache, e.name), aside = path.join(cache, `.old-${e.name}-${stamp}`);
      if (fs.existsSync(target)) await fsp.rename(target, aside);
      await fsp.rename(d, target);
      await fsp.rm(aside, { recursive: true, force: true });
      changed.push({ name: e.name, version: e.version, was: old?.version ?? null });
    }
    const keep = new Set([...v.listed]);
    const removed = [];
    for (const name of before.keys()) {
      if (keep.has(name)) continue;
      if (!NAME.test(name)) continue;
      await fsp.rm(path.join(cache, name), { recursive: true, force: true });  // only folders carrying our marker are in before
      removed.push(name);
    }
    return { changed, removed };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

let inflight = null;
// fetch, verify, write. Never throws: the outcome is in the returned state (and library-cache\state.json).
export function check(opts = {}) {
  if (inflight) return inflight;
  inflight = doCheck(opts).finally(() => { inflight = null; });
  return inflight;
}
async function doCheck({ root = ROOT, url = DEFAULT_URL(), publicKeyFile = PUBLIC_KEY(root), timeoutMs = 20000, now = () => new Date(), log = () => {} } = {}) {
  const s = readState(root);
  const at = now().toISOString();
  const next = { ...s, lastCheckAt: at, errors: [], refused: [] };
  const fail = async (msg) => {
    next.errors = [msg];
    next.lastError = { at, error: msg };
    try { await writeState(root, next); } catch {}
    return { ...status(root), ok: false, error: msg };
  };
  let pem;
  try { pem = await fsp.readFile(publicKeyFile, 'utf8'); } catch { return fail('the publisher\'s public key (helpers/release-public-key.pem) is missing, so no library update is believed'); }
  let b;
  try { b = await download(url, timeoutMs); } catch (e) { return fail(`could not fetch the library bundle (${e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timed out' : e.cause?.code || e.message}); the cached entries stay`); }
  const v = verifyBundle(b, pem);
  if (!v.ok) return fail(`the library bundle was refused: ${v.error}; the cached entries stay`);
  // never go back to an older bundle (a replayed old one could bring back a withdrawn driver)
  const newest = [s.bundleBuiltAt, ...cachedEntries(root).map((e) => e.bundleBuiltAt)].filter(Boolean).sort((x, y) => Date.parse(x) - Date.parse(y)).at(-1);
  if (newest && Date.parse(b.builtAt) < Date.parse(newest)) return fail(`the library bundle was refused: it is older (${b.builtAt}) than the one already cached (${newest})`);
  let done;
  try { done = await writeCache(root, v); } catch (e) { return fail(`the library cache could not be written (${e.message}); the cached entries stay`); }
  next.lastSuccessAt = at;
  next.bundleBuiltAt = b.builtAt;
  next.refused = v.refused;
  next.lastChange = done.changed.length || done.removed.length ? { at, changed: done.changed, removed: done.removed } : s.lastChange || null;
  delete next.lastError;
  try { await writeState(root, next); } catch {}
  for (const c of done.changed) try { log({ kind: 'good', text: `Device library: ${c.name} ${c.was == null ? 'added' : 'updated'} from the published library` }); } catch {}
  for (const r of v.refused) try { log({ kind: 'warn', text: `Device library update: ${r.name} refused (${r.why})` }); } catch {}
  return { ...status(root), ok: true, changed: done.changed, removed: done.removed };
}

export async function checkIfDue(opts = {}) {
  const root = opts.root || ROOT;
  if (!enabled(root)) return { ...status(root), skipped: 'library updates are off' };
  const last = Date.parse(readState(root).lastCheckAt || '');
  const now = (opts.now || (() => new Date()))().getTime();
  if (!Number.isNaN(last) && now - last < DAY && now >= last) return { ...status(root), skipped: 'checked within the last day' };
  return check(opts);
}

let timers = null;
export function schedule({ root = ROOT, log = () => {}, firstAfterMs = 3 * 60 * 1000, everyMs = 60 * 60 * 1000, ...rest } = {}) {
  if (timers) return false;
  const run = () => { checkIfDue({ root, log, ...rest }).catch(() => {}); };
  timers = [setTimeout(run, firstAfterMs), setInterval(run, everyMs)];
  for (const t of timers) t.unref?.();
  return true;
}
export function unschedule() { if (timers) { clearTimeout(timers[0]); clearInterval(timers[1]); timers = null; } }

export function status(root = ROOT) {
  const s = readState(root);
  const last = Date.parse(s.lastCheckAt || '');
  return {
    enabled: enabled(root),
    checking: !!inflight,
    cache: path.relative(root, cacheRoot(root)),
    lastCheckAt: s.lastCheckAt || null,
    lastSuccessAt: s.lastSuccessAt || null,
    nextCheckAt: Number.isNaN(last) ? null : new Date(last + DAY).toISOString(),
    bundleBuiltAt: s.bundleBuiltAt || null,
    entries: cachedEntries(root),
    lastChange: s.lastChange || null,
    errors: s.errors || [],
    refused: s.refused || [],
  };
}

// GET /api/library/updates: the state; POST /api/library/update: check now. Returns true when it answered.
export async function handle(url, req, res, send, { root = ROOT, ...opts } = {}) {
  if (url.pathname === '/api/library/updates' && req.method === 'GET') { send(res, 200, status(root)); return true; }
  if (url.pathname === '/api/library/update' && req.method === 'POST') {
    if (!enabled(root)) { send(res, 409, { ...status(root), error: 'library updates are off (settings.json "libraryUpdates": false or DEVICEHUB_LIBRARY_UPDATES=0)' }); return true; }
    const r = await check({ root, ...opts });
    send(res, r.ok ? 200 : 502, r);
    return true;
  }
  return false;
}
