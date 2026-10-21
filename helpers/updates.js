// Updates: which firmware and vendor apps are installed, what the vendors' official download pages list as newest,
// and opening the vendor's own updater. DeviceHub never downloads, runs or flashes firmware itself: the update runs
// in the Pulsar app or iCUE, which know how to recover from a failed flash. Pages are read only when Shawn checks.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const { execFile, spawn } = require('child_process');

const PAGES = {
  // Pulsar lists its app versions here (the app carries the firmware updates). Beta firmware zips are ignored.
  pulsar: 'https://www.pulsar.gg/pages/download-xlite-wireless',
  // Epomaker's P75 firmware package; the version is only in the file name.
  epomaker: 'https://epomaker.com/blogs/firmware/epomaker-p75-firmware',
};
const APPS = {
  pulsar: { exe: 'C:\\Program Files\\Pulsar\\cMouse\\Sys64\\Pulsar.exe', image: 'Pulsar.exe', window: 'Pulsar', uninstallName: 'Pulsar' },
  icue: { exe: 'C:\\Program Files\\Corsair\\Corsair iCUE5 Software\\iCUE.exe', image: 'iCUE.exe', window: null, uninstallName: 'Corsair iCUE5 Software' },
};
const CACHE_MS = 12 * 3600 * 1000;
let cacheFile = null, cache = null;

const ps = (script) => new Promise((resolve) => execFile('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(String(out || '').trim())));

async function installedApps() {
  const out = await ps("Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -in 'Pulsar','Corsair iCUE5 Software' } | ForEach-Object { $_.DisplayName + '|' + $_.DisplayVersion }");
  const r = {};
  for (const line of out.split(/\r?\n/)) {
    const [name, ver] = line.split('|');
    for (const [k, a] of Object.entries(APPS)) if (name === a.uninstallName) r[k] = ver;
  }
  return r;
}

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

async function page(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DeviceHub update check' } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function online(force) {
  if (!cache && cacheFile && fs.existsSync(cacheFile)) { try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {} }
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const result = { at: Date.now(), pulsar: null, epomaker: null, errors: {} };
  try {
    const html = await page(PAGES.pulsar);
    // Only the Xlite CrazyLight's own entry: the page lists every Pulsar mouse, and others get app builds first
    // (19 Oct 2026: the Feinmann F01 listed 1.32 while the Xlite CrazyLight listed 1.31).
    const vers = [];
    for (const m of html.matchAll(/Xlite CrazyLight(?: Medium| Mini)? Software/g)) {
      const v = /Pulsar_v(\d+\.\d+)_setup\.zip/i.exec(html.slice(m.index, m.index + 2500));
      if (v) vers.push(v[1]);
    }
    if (!vers.length) throw new Error('no Xlite CrazyLight app version found on the page');
    result.pulsar = { app: vers.sort(cmp).pop(), page: PAGES.pulsar };
  } catch (e) { result.errors.pulsar = e.message; }
  try {
    const html = await page(PAGES.epomaker);
    const vers = [...html.matchAll(/EPOMAKER_P75_V(\d+(?:\.\d+)*)\.zip/gi)].map((m) => m[1]);
    if (!vers.length) throw new Error('no P75 firmware file found on the page');
    result.epomaker = { firmware: vers.sort(cmp).pop(), page: PAGES.epomaker };
  } catch (e) { result.errors.epomaker = e.message; }
  cache = result;
  if (cacheFile) try { writeAtomic(cacheFile, JSON.stringify(result, null, 2)); } catch {}
  return result;
}

async function status(force) {
  const [apps, web] = await Promise.all([installedApps(), online(force)]);
  return {
    apps,
    online: web,
    pulsarAppNewer: !!(apps.pulsar && web.pulsar && cmp(web.pulsar.app, apps.pulsar) > 0),
  };
}

// Opens the vendor app and brings its window up (the Pulsar app starts hidden in the tray).
async function open(app) {
  const a = APPS[app];
  if (!a) throw new Error('unknown app');
  if (!fs.existsSync(a.exe)) throw new Error(`${a.uninstallName} is not installed`);
  spawn(a.exe, [], { detached: true, stdio: 'ignore' }).unref();
  if (a.window) {
    await new Promise((r) => setTimeout(r, 4000));
    await ps(`Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);'; $h = [W.U]::FindWindow('Qt5QWindowIcon', '${a.window}'); if ($h -ne [IntPtr]::Zero) { [void][W.U]::ShowWindow($h, 9); [void][W.U]::SetForegroundWindow($h) }`);
  }
  return { ok: true };
}

// Closes the vendor app again once Shawn is done.
function close(app) {
  const a = APPS[app];
  if (!a) throw new Error('unknown app');
  return new Promise((resolve) => execFile('taskkill', ['/IM', a.image, '/F'], { windowsHide: true }, () => resolve({ ok: true })));
}

function init(root) { cacheFile = path.join(root, 'updates-cache.json'); }

module.exports = { init, status, open, close, PAGES };
