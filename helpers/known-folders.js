// The person's own Documents and Pictures folders (1 Nov 2026, a new-setup check): Windows 11 moves them into OneDrive
// when its folder backup is on (the default on a new PC), and Explorer then shows OneDrive\Documents; os.homedir()\
// Documents is a folder nobody looks in, so DeviceHub's backups and wallpapers made there were "missing". Read from the
// registry's User Shell Folders, where [Environment]::GetFolderPath (the uninstaller) gets them too; else the home folder's.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
const NAMES = { documents: 'Personal', pictures: 'My Pictures' };
const HOME = { documents: 'Documents', pictures: 'Pictures' };

// reg query's text: "    Personal    REG_EXPAND_SZ    %USERPROFILE%\OneDrive\Documents"
function parse(text, env = process.env, exists = fs.existsSync) {
  const out = {};
  for (const [kind, name] of Object.entries(NAMES)) {
    const m = String(text || '').match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'mi'));
    if (!m) continue;
    const p = m[1].replace(/%([^%]+)%/g, (all, n) => env[n] ?? env[n.toUpperCase()] ?? all);
    // reg prints in the console's old code page, so a folder named outside it ("Imágenes") comes back garbled (a review,
    // 1 Nov 2026): only a path that exists is used, else the home folder's
    if (!p.includes('%') && !p.includes('\uFFFD') && path.isAbsolute(p) && exists(p)) out[kind] = p;
  }
  return out;
}

let cache = null;
function read() {
  if (process.platform !== 'win32') return {};
  try { return parse(execFileSync('reg', ['query', KEY], { encoding: 'utf8', windowsHide: true, timeout: 5000 })); } catch { return {}; }
}

// kind: 'documents' or 'pictures'
function folder(kind, { known = (cache ||= read()) } = {}) {
  return known[kind] || path.join(os.homedir(), HOME[kind]);
}

// a DeviceHub folder inside it; one made before this under the home folder (and not in the real one) stays where it is
function place(kind, name, { known, exists = fs.existsSync } = {}) {
  const real = path.join(folder(kind, known ? { known } : undefined), name);
  const old = path.join(os.homedir(), HOME[kind], name);
  return old !== real && exists(old) && !exists(real) ? old : real;
}

module.exports = { folder, place, _test: { parse } };
