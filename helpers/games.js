// "Any game": the program names found in Shawn's game folders (Steam, Riot, Epic, Xbox, Battle.net games), so
// auto-switch can tell a game is running without a hand-made list. Matched by name, which also works for games
// whose anti-cheat hides their path (VALORANT). Helpers that ship next to games are left out. Re-read hourly.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Programs that ship in game folders but are not games (helpers, tools, Wallpaper Engine, Java's own tools).
const SKIP = /crash|unins|redist|setup|install|update|patch|launcher|helper|report|easyanticheat|eac|battleye|beservice|vanguard|vgc|dotnet|vc_?redist|directx|dxsetup|cef|webview|overlay|benchmark|3dmark|systeminfo|sentry|bugsplat|prereq|anticheat|wallpaper|diagnostic|dump|info|util|busybox|^java|^jaccess|^jabswitch|^jfr|^jrun|^jweb|^keytool|^kinit|^klist|^ktab|^rmiregistry|storagereader|collector|repair|quickedit|resourcecompiler|vconsole|winmtr|redownload|iigw|crs-handler|linkshandler|skse|start_protected|_be\.exe|_zk\.exe|detectarchitecture|server\.exe|bootstrapper|^ui32|^sheep|^execpubg/i;
let cache = { at: 0, names: [], titles: {} };

function steamLibraries() {
  return new Promise((resolve) => execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (e, out) => {
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(String(out || ''));
    if (!m) return resolve([]);
    const steam = m[1].trim().replace(/\//g, '\\');
    const libs = [steam];
    try {
      const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const x of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(x[1].replace(/\\\\/g, '\\'));
    } catch {}
    resolve([...new Set(libs.map((l) => path.join(l, 'steamapps', 'common').toLowerCase()))]);
  }));
}

// out: the program names; titles: program name -> its game's folder name (e.g. 'War Dogs'), for plain wording
function exes(dir, depth, out, titles, title) {
  if (depth < 0) return;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (!/^(_commonredist|redist|redistributables|directx|support|tools|engine\\extras)$/i.test(d.name)) exes(p, depth - 1, out, titles, title || d.name); }
    else if (/\.exe$/i.test(d.name) && !SKIP.test(d.name)) { const n = d.name.toLowerCase(); out.add(n); if (title && !titles[n]) titles[n] = title; }
  }
}

async function names() {
  if (Date.now() - cache.at < 3600 * 1000 && cache.names.length) return cache.names;
  const roots = [...(await steamLibraries()), 'C:\\Riot Games\\VALORANT', 'C:\\Riot Games\\League of Legends', 'C:\\Program Files\\Epic Games', 'C:\\XboxGames'];
  const out = new Set(), titles = {};
  // a root that is itself one game's folder (VALORANT, League) names the game
  for (const r of roots) exes(r, 6, out, titles, /riot games/i.test(r) ? path.basename(r) : null);
  cache = { at: Date.now(), names: [...out].sort(), titles };
  return cache.names;
}
async function titles() { await names(); return cache.titles; }

module.exports = { names, titles };
