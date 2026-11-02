// VIA keyboards of any maker (20 Oct 2026): finds them on this PC and gets each one's VIA definition (its matrix size
// and key positions; public/devices/via-layout.js reads it).
// - Found through the helper: every HID collection on VIA's usage page 0xFF60, usage 0x61 (read-only, nothing sent).
// - The definition: a file in DeviceHub's via-definitions folder first (named <VID><PID>.json, e.g. 342DE479.json; the
//   file a maker hands out for VIA's "load draft definition"), else VIA's own library (usevia.app, about 1,500
//   keyboards), saved into that folder for next time. Data only: it is parsed, never run.
const fs = require('fs');
const path = require('path');
const native = require('./native');
const { writeAtomic } = require('./safe-write');

const DIR = path.join(__dirname, '..', 'via-definitions');
// swappable for tests (tests/via-generic.mjs): where definitions are kept, and the one GET to VIA's library
const deps = { dir: DIR, fetch: (u, o) => fetch(u, o) };
const LIBRARY_HOST = 'usevia.app';
const LIBRARY = (vpid) => `https://usevia.app/definitions/v3/${vpid}.json`;

// [{ vid: '342D', pid: 'E479', name: 'EPOMAKER P75' }]
async function findKeyboards() {
  const r = await native.request('hidlist', 'FF60 61', 8000);
  if (!r || r === 'TIMEOUT' || r === 'GONE') return [];
  return r.split('|').filter(Boolean).map((l) => { const [vid, pid, ...name] = l.split(' '); return { vid, pid, name: name.join(' ').trim() }; })
    .filter((k) => /^[0-9A-F]{4}$/.test(k.vid) && /^[0-9A-F]{4}$/.test(k.pid));
}

// opts.vial (1 Nov 2026): () => the keyboard's own Vial definition ({ def, protocol, uid, size } from
// public/devices/vial.js readVialDefinition), or throws when it is not a Vial keyboard. Asked only when no file is
// saved yet, before VIA's library, and never for the P75 (its layout is built in). A definition it gives is saved like
// a fetched one, so the keyboard is not read again on the next start.
const P75_FILE = '342DE479';
async function definitionFor(vid, pid, opts = {}) {
  const file = path.join(deps.dir, `${vid}${pid}.json`.toUpperCase().replace('.JSON', '.json'));
  try { if (fs.existsSync(file)) return { def: JSON.parse(fs.readFileSync(file, 'utf8')), from: `via-definitions\\${path.basename(file)}` }; }
  catch (e) { throw new Error(`via-definitions\\${path.basename(file)} is not valid JSON (${e.message})`); }
  if (typeof opts.vial === 'function' && `${vid}${pid}`.toUpperCase() !== P75_FILE) {
    let got = null;
    try { got = await opts.vial(); } catch (e) { if (opts.log) opts.log(`not read from the keyboard (Vial): ${e.message}`); }
    if (got?.def) {
      const own = fromVial(got, vid, pid, opts.name);
      fs.mkdirSync(deps.dir, { recursive: true });
      writeAtomic(file, JSON.stringify(own, null, 2) + '\n');
      return { def: own, from: `the keyboard itself (Vial ${got.protocol}), saved as via-definitions\\${path.basename(file)}`, vial: true };
    }
  }
  const vpid = parseInt(vid, 16) * 65536 + parseInt(pid, 16);
  // VIA's library (27 Oct 2026: the same rules as helpers/via-fetch.mjs): HTTPS to usevia.app only (a redirect elsewhere
  // is refused), JSON only, at most its MAX_BYTES, and the file must be a definition for THIS keyboard (vendor and
  // product id) that DeviceHub can draw (via-fetch.mjs check) before it is saved. Data only: never run.
  const vf = await import('./via-fetch.mjs').catch(() => null);
  const r = await deps.fetch(LIBRARY(vpid), { signal: AbortSignal.timeout(15000) }).catch(() => null);
  const type = r?.headers?.get('content-type') || '';
  let finalHost = null;
  try { const u = new URL(r?.url || LIBRARY(vpid)); finalHost = u.protocol === 'https:' ? u.hostname : null; } catch {}
  if (r?.ok && type.includes('json') && finalHost === LIBRARY_HOST && vf) {
    const said = Number(r.headers.get('content-length'));
    const text = said > vf.MAX_BYTES ? null : await r.text();
    if (text != null && Buffer.byteLength(text) <= vf.MAX_BYTES) {
      vf.check(text, String(vid).toUpperCase(), String(pid).toUpperCase());   // throws one sentence when it is not
      const def = JSON.parse(text.replace(/^\uFEFF/, ''));
      fs.mkdirSync(deps.dir, { recursive: true });
      writeAtomic(file, text);
      return { def, from: 'VIA\'s library' };
    }
  }
  // Not in VIA's bundled library (e.g. Keychron Pro / Max / HE / 8K, Lemokey): auto-fetch from pinned official VIA sources
  try {
    const got = await vf.get(vid, pid);
    if (got?.ok && fs.existsSync(file)) return { def: JSON.parse(fs.readFileSync(file, 'utf8')), from: `via-definitions\\${path.basename(file)}` };
  } catch {}
  throw new Error('not in VIA\'s library: put the maker\'s VIA definition file in the via-definitions folder');
}

// a Vial keyboard's vial.json, as saved: the keyboard's own text with its USB ids (a vial.json often has none, and the
// one the USB says is the one DeviceHub looks it up by), a name, and where it came from. Data only.
function fromVial(got, vid, pid, name) {
  const def = { ...got.def };
  def.name = typeof def.name === 'string' && def.name.trim() ? def.name : String(name || `Vial keyboard ${vid}:${pid}`);
  def.vendorId = `0x${String(vid).toUpperCase()}`;
  def.productId = `0x${String(pid).toUpperCase()}`;
  def.devicehub = { from: 'vial', vialProtocol: got.protocol, uid: got.uid || null, compressedBytes: got.size || null, at: new Date().toISOString() };
  return def;
}

module.exports = { findKeyboards, definitionFor, fromVial, DIR, deps };
