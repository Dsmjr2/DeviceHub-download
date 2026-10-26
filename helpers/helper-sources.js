// Which native helper to run (22 Oct 2026; docs/handoff/prebuilt-helper.md). The installer zip carries a pre-built
// helpers/bin/DeviceHubHelper.exe and helpers/bin/helper-sources.sha256, the SHA-256 of the C# sources it was built
// from (helpers/make-installer.ps1), so a new PC never needs Windows' C# compiler. On start (helpers/native.js):
//   - a recorded hash that equals the current sources' hash: the exe is used as it is, never rebuilt (file times are
//     not trusted: unzipping sets them anyhow);
//   - a recorded hash that differs (a self-update or an edit changed the sources): rebuilt, and the new hash recorded;
//     if that build fails, the exe built from the earlier sources keeps running (said in one log line);
//   - no recorded hash (a development copy, e.g. Shawn's own repo, where build.ps1 makes the exe): exactly as before,
//     rebuilt when the exe is missing or older than any source.
// Nothing here starts or builds anything; it only reads files and decides. CLI (used by make-installer.ps1 and
// install.ps1): node helpers/helper-sources.js --hash [helpersDir]   prints the sources' hash
//          node helpers/helper-sources.js --record [helpersDir] writes it to bin/helper-sources.sha256
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// the files helpers/native/build.ps1 compiles, relative to helpers/ (tests/prebuilt-helper.mjs checks the two lists agree)
const SOURCE_FILES = ['native/helper.cs', 'native/hs80io.cs', 'native/tray.cs', 'native/winbrand.cs', 'hidio.cs', 'audio.cs', 'audio-topology.cs', 'audio-default.cs', 'audio-apps.cs', 'mic-rec.cs', 'mic-guard.cs', 'monitors.cs', 'camera.cs', 'pointer.cs', 'pc-native.cs', 'pc-reads.cs'];
const EXE_NAME = 'DeviceHubHelper.exe';
const HASH_NAME = 'helper-sources.sha256';

// SHA-256 over the sources' contents only: each file's own SHA-256 (hex, then a newline), the files taken in sorted
// order of their names. Exact bytes, so a changed line ending counts as a change.
function sourcesHash(dir = __dirname) {
  const h = crypto.createHash('sha256');
  for (const f of [...SOURCE_FILES].sort()) h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') + '\n');
  return h.digest('hex');
}

const recordedHash = (dir = __dirname) => {
  try { const t = fs.readFileSync(path.join(dir, 'bin', HASH_NAME), 'utf8').trim().toLowerCase(); return /^[0-9a-f]{64}$/.test(t) ? t : null; } catch { return null; }
};
const recordHash = (dir = __dirname, hash = sourcesHash(dir)) => { fs.writeFileSync(path.join(dir, 'bin', HASH_NAME), hash + '\n'); return hash; };

// { build: bool, mode: 'shipped' | 'changed' | 'mtime', hash, recorded }
//   shipped: the recorded hash matches; use the exe, never build
//   changed: a recorded hash that no longer matches (or an exe missing beside it); build, and record the hash after
//   mtime:   no recorded hash; build when the exe is missing or older than a source (as before 22 Oct 2026)
function decide(dir = __dirname) {
  const exe = path.join(dir, 'bin', EXE_NAME);
  const has = fs.existsSync(exe);
  const recorded = recordedHash(dir);
  if (recorded) {
    let hash = null;
    try { hash = sourcesHash(dir); } catch {}
    if (has && hash === recorded) return { build: false, mode: 'shipped', hash, recorded };
    return { build: true, mode: 'changed', hash, recorded };
  }
  const t = has ? fs.statSync(exe).mtimeMs : 0;
  const build = !(t && SOURCE_FILES.every((s) => fs.statSync(path.join(dir, s)).mtimeMs <= t));
  return { build, mode: 'mtime', hash: null, recorded: null };
}

module.exports = { SOURCE_FILES, EXE_NAME, HASH_NAME, sourcesHash, recordedHash, recordHash, decide };

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  const d = path.resolve(dir || __dirname);
  if (cmd === '--hash') process.stdout.write(sourcesHash(d) + '\n');
  else if (cmd === '--record') { fs.mkdirSync(path.join(d, 'bin'), { recursive: true }); process.stdout.write(recordHash(d) + '\n'); }
  else { console.error('usage: node helpers/helper-sources.js --hash|--record [helpersDir]'); process.exit(2); }
}
