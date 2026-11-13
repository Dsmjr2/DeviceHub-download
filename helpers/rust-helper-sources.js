// Opt-in and staleness verification for the Rust helper (helpers/native-rs/).
// C# stays default until Shawn opts in via DEVICEHUB_RUST_HELPER=1 or "rustHelper": true in data/settings.json.
// DEVICEHUB_CSHARP_HELPER=1 always forces C#.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, dataFile } = require('./data-dir');

const EXE_NAME = 'DeviceHubHelper.exe';
const HASH_NAME = 'rust-helper-sources.sha256';

function collectRustSources(dir = __dirname) {
  const rsDir = path.join(dir, 'native-rs');
  const files = [];
  for (const base of ['Cargo.toml', 'Cargo.lock']) {
    if (fs.existsSync(path.join(rsDir, base))) files.push(path.join('native-rs', base));
  }
  const srcDir = path.join(rsDir, 'src');
  function walk(cur, rel) {
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = path.join(rel, e.name);
      const full = path.join(cur, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile() && e.name.endsWith('.rs')) files.push(r);
    }
  }
  walk(srcDir, path.join('native-rs', 'src'));
  return files.map((f) => f.replace(/\\/g, '/')).sort();
}

function sourcesHash(dir = __dirname) {
  const files = collectRustSources(dir);
  if (files.length === 0) return null;
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') + '\n');
  }
  return h.digest('hex');
}

const rustExePath = (dir = __dirname) => path.join(dir, 'native-rs', 'target', 'release', EXE_NAME);
const rustHashPath = (dir = __dirname) => path.join(dir, 'native-rs', 'target', 'release', HASH_NAME);

// the stamp: line 1 the sources' hash, line 2 (13 Nov 2026) the exe's own SHA-256, so a replaced or stale exe is
// refused even when the sources still match (a plain "cargo build" on another branch left the old stamp)
function readStamp(dir = __dirname) {
  try {
    const [src, exe] = fs.readFileSync(rustHashPath(dir), 'utf8').trim().toLowerCase().split(/\s+/);
    return { src: /^[0-9a-f]{64}$/.test(src || '') ? src : null, exe: /^[0-9a-f]{64}$/.test(exe || '') ? exe : null };
  } catch {
    return { src: null, exe: null };
  }
}
const recordedHash = (dir = __dirname) => readStamp(dir).src;
const fileHash = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

// hash: the sources' hash taken BEFORE the build (helpers/build-rust-helper.mjs), so a pull during the build cannot
// stamp an exe made from the older sources as the newer ones
function recordHash(dir = __dirname, hash = sourcesHash(dir)) {
  if (!hash) throw new Error('no Rust helper sources found');
  const p = rustHashPath(dir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const exe = fileHash(rustExePath(dir));
  fs.writeFileSync(p, hash + '\n' + (exe ? exe + '\n' : ''));
  return hash;
}

function settingsOptIn(root = ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(dataFile('settings.json', root), 'utf8'));
    return j?.rustHelper === true;
  } catch {
    return false;
  }
}

// crashes: when the Rust helper stopped by itself (helpers/native.js); 3 in 10 minutes = C# until DeviceHub restarts
const CRASH_LIMIT = 3, CRASH_WINDOW = 10 * 60 * 1000;
function selectHelper({ dir = __dirname, root = ROOT, env = process.env, crashes = [], now = Date.now() } = {}) {
  const csharpExe = path.join(dir, 'bin', EXE_NAME);
  if (env.DEVICEHUB_CSHARP_HELPER === '1') {
    return { kind: 'csharp', exe: csharpExe, reason: 'DEVICEHUB_CSHARP_HELPER=1 override', stale: false };
  }
  const envOpt = env.DEVICEHUB_RUST_HELPER === '1';
  const cfgOpt = !envOpt && settingsOptIn(root);
  if (!envOpt && !cfgOpt) {
    return { kind: 'csharp', exe: csharpExe, reason: 'default', stale: false };
  }
  const optReason = envOpt ? 'DEVICEHUB_RUST_HELPER=1' : 'settings.json rustHelper=true';
  const rustExe = rustExePath(dir);
  if (!fs.existsSync(rustExe)) {
    return { kind: 'csharp', exe: csharpExe, reason: `${optReason}, but Rust exe missing; falling back to C#`, stale: true };
  }
  const stamp = readStamp(dir);
  const cur = sourcesHash(dir);
  if (!stamp.src || !cur || stamp.src !== cur) {
    return { kind: 'csharp', exe: csharpExe, reason: `${optReason}, but Rust exe hash is missing or stale; falling back to C#`, stale: true };
  }
  if (stamp.exe && fileHash(rustExe) !== stamp.exe) {
    return { kind: 'csharp', exe: csharpExe, reason: `${optReason}, but the Rust exe is not the one built from these sources; falling back to C#`, stale: true };
  }
  if (crashes.filter((t) => now - t < CRASH_WINDOW).length >= CRASH_LIMIT) {
    return { kind: 'csharp', exe: csharpExe, reason: `${optReason}, but the Rust helper stopped ${CRASH_LIMIT} times in 10 minutes; C# until DeviceHub restarts`, stale: false, crashed: true };
  }
  return { kind: 'rust', exe: rustExe, reason: optReason, stale: false };
}

module.exports = {
  EXE_NAME,
  HASH_NAME,
  collectRustSources,
  sourcesHash,
  rustExePath,
  rustHashPath,
  recordedHash,
  readStamp,
  recordHash,
  settingsOptIn,
  selectHelper,
};
