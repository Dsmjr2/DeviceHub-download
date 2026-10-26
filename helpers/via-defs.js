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
const LIBRARY = (vpid) => `https://usevia.app/definitions/v3/${vpid}.json`;

// [{ vid: '342D', pid: 'E479', name: 'EPOMAKER P75' }]
async function findKeyboards() {
  const r = await native.request('hidlist', 'FF60 61', 8000);
  if (!r || r === 'TIMEOUT' || r === 'GONE') return [];
  return r.split('|').filter(Boolean).map((l) => { const [vid, pid, ...name] = l.split(' '); return { vid, pid, name: name.join(' ').trim() }; })
    .filter((k) => /^[0-9A-F]{4}$/.test(k.vid) && /^[0-9A-F]{4}$/.test(k.pid));
}

async function definitionFor(vid, pid) {
  const file = path.join(DIR, `${vid}${pid}.json`.toUpperCase().replace('.JSON', '.json'));
  try { if (fs.existsSync(file)) return { def: JSON.parse(fs.readFileSync(file, 'utf8')), from: `via-definitions\\${path.basename(file)}` }; }
  catch (e) { throw new Error(`via-definitions\\${path.basename(file)} is not valid JSON (${e.message})`); }
  const vpid = parseInt(vid, 16) * 65536 + parseInt(pid, 16);
  const r = await fetch(LIBRARY(vpid), { signal: AbortSignal.timeout(15000) }).catch(() => null);
  const type = r?.headers?.get('content-type') || '';
  if (r?.ok && type.includes('json')) {
    const text = await r.text();
    const def = JSON.parse(text);
    fs.mkdirSync(DIR, { recursive: true });
    writeAtomic(file, text);
    return { def, from: 'VIA\'s library' };
  }
  // Not in VIA's bundled library (e.g. Keychron Pro / Max / HE / 8K, Lemokey): auto-fetch from pinned official VIA sources
  try {
    const vf = await import('./via-fetch.mjs');
    const got = await vf.get(vid, pid);
    if (got?.ok && fs.existsSync(file)) return { def: JSON.parse(fs.readFileSync(file, 'utf8')), from: `via-definitions\\${path.basename(file)}` };
  } catch {}
  throw new Error('not in VIA\'s library: put the maker\'s VIA definition file in the via-definitions folder');
}

module.exports = { findKeyboards, definitionFor, DIR };
