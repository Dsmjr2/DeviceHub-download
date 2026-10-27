// Smaller updates (27 Oct 2026, Shawn: every update downloaded the whole 80 MB, even for a one-line fix). A release
// carries DeviceHub-files.json.gz (helpers/make-installer.ps1), signed through version.json (its size and SHA-256,
// signature3): the SHA-256 of every file the zip holds. An update builds the new version's folder from the files this
// copy already has that match it, takes the files made at each build (release.json, the helper, ...) from the list
// itself, and downloads only the app files that changed, from the public download repository at that release's
// commit; each one is checked against the list. Anything the list cannot supply (Node, the bundled tools, a big file
// changed here) means the whole zip, as before. The folder then goes through the same checks and installer as the zip.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const RAW = process.env.DEVICEHUB_RAW_URL || 'https://raw.githubusercontent.com/Dsmjr2/DeviceHub-download/';
const MAX_FILES = 300;              // more than this changed: the whole zip is about as quick
const MAX_BYTES = 30 * 1024 * 1024;
const PARALLEL = 6;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// a path from the list stays inside the new folder: no drive, no "..", only plain names
const safePath = (p) => typeof p === 'string' && p.length < 260 && !/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)|[\0<>:"|?*]/.test(p);

function parseManifest(gz) {
  const m = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  if (!m || typeof m.files !== 'object' || !/^[0-9a-f]{40}$/.test(m.commit || '')) throw new Error('the file list is not readable');
  for (const [p, f] of Object.entries(m.files)) if (!safePath(p) || !/^[0-9a-f]{64}$/.test(f?.h || '')) throw new Error(`the file list names ${String(p).slice(0, 80)} wrongly`);
  return m;
}

// this copy's file at p when it is exactly the one the new version has
function localMatch(root, p, f) {
  const full = path.join(root, p);
  try {
    if (fs.statSync(full).size !== f.s) return null;
    const buf = fs.readFileSync(full);
    return sha(buf) === f.h ? buf : null;
  } catch { return null; }
}

// The download repository keeps Windows script files with Unix line endings (.gitattributes): put back as the zip has them
const asShipped = (buf, f) => {
  if (sha(buf) === f.h) return buf;
  const crlf = Buffer.from(buf.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
  return sha(crlf) === f.h ? crlf : null;
};

async function fetchRawDefault(commit, p) {
  const r = await fetch(RAW + commit + '/' + p.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${p}: the download page answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Builds dest (the new version's DeviceHub folder) from root and the list. Returns { downloaded, bytes, kept }; throws
// with the reason when the whole zip is needed instead. fetchRaw and the limits are for tests.
async function stage({ manifest, root, dest, fetchRaw = fetchRawDefault, onProgress = () => {}, maxFiles = MAX_FILES, maxBytes = MAX_BYTES }) {
  const plan = [];   // [path, entry, source]
  let need = 0, bytes = 0, kept = 0;
  // the device helper is built here from its sources: one built from the same sources is the same program, so the one
  // this copy has stays (no new program for Windows to check: App Control, 27 Oct 2026)
  const helperSame = (() => {
    const src = manifest.files['helpers/bin/helper-sources.sha256'];
    try { return !!src && sha(fs.readFileSync(path.join(root, 'helpers', 'bin', 'helper-sources.sha256'))) === src.h && fs.existsSync(path.join(root, 'helpers', 'bin', 'DeviceHubHelper.exe')); } catch { return false; }
  })();
  for (const [p, f] of Object.entries(manifest.files)) {
    if (p === 'helpers/bin/DeviceHubHelper.exe' && helperSame) { plan.push([p, f, 'helper']); kept++; continue; }
    const here = localMatch(root, p, f);
    if (here) { plan.push([p, f, here]); kept++; continue; }
    if (f.d != null) { plan.push([p, f, 'data']); continue; }
    if (!f.r) throw new Error(`${p} changed and only the whole download has it`);
    plan.push([p, f, 'raw']); need++; bytes += f.s;
  }
  if (need > maxFiles) throw new Error(`${need} files changed`);
  if (bytes > maxBytes) throw new Error(`${Math.round(bytes / 1048576)} MB changed`);
  const write = (p, buf) => { const to = path.join(dest, p); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, buf); };
  const raws = [];
  for (const [p, f, src] of plan) {
    if (Buffer.isBuffer(src)) write(p, src);
    else if (src === 'helper') write(p, fs.readFileSync(path.join(root, p)));
    else if (src === 'data') {
      const buf = Buffer.from(f.d, 'base64');
      if (sha(buf) !== f.h) throw new Error(`${p} in the file list fails its checksum`);
      write(p, buf);
    } else raws.push([p, f]);
  }
  let done = 0, got = 0;
  onProgress(0, need);
  const next = async () => {
    while (raws.length) {
      const [p, f] = raws.shift();
      const buf = asShipped(await fetchRaw(manifest.commit, p), f);
      if (!buf) throw new Error(`${p} downloaded does not match the signed list`);
      write(p, buf); got += buf.length; onProgress(++done, need);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, raws.length) }, next));
  return { downloaded: done, bytes: got, kept };
}

module.exports = { stage, parseManifest, safePath, MAX_FILES, MAX_BYTES };
