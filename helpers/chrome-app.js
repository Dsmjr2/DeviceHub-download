// DeviceHub as an installed Chrome (or Edge) app (18 Nov 2026, Shawn: "can we not make the top bar the same theme as
// the theme in device hub when we change it? it looks like its my chrome theme right now"). A plain app window in the
// person's own browser takes the browser theme's title bar and Chrome's taskbar button; an installed app takes the
// page's theme colour (public/core/theme.js keeps it on Settings > Appearance's backdrop) and its own taskbar button
// from the first moment. Installing is the person's own click in the browser's prompt; DeviceHub.vbs then opens the app.
//   status()       { browser, installed, profile }: is DeviceHub installed as an app, and in which browser profile
//   openInstall()  opens DeviceHub in a normal tab of the browser's last profile, at ?install (public/ui/install-app.js
//                  shows the Install button there, which opens the browser's own install prompt)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const APP_ID = 'gbcckkpijkfkcllfaiefimkinkmpohlk';   // Chrome's id for the app at http://localhost:5577/ (manifest id "/")
const deps = { env: process.env, exists: (p) => fs.existsSync(p), read: (p) => fs.readFileSync(p, 'utf8'), dirs: (p) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name), spawn };

// the browser DeviceHub.vbs opens, in its order: Chrome (64-bit, 32-bit, per user), then Edge
function browser() {
  const e = deps.env, pf = e.ProgramFiles || 'C:\\Program Files', pf86 = e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', la = e.LOCALAPPDATA || '';
  for (const exe of [path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), path.join(la, 'Google\\Chrome\\Application\\chrome.exe')]) {
    if (deps.exists(exe)) return { name: 'Chrome', exe, userData: path.join(la, 'Google\\Chrome\\User Data') };
  }
  for (const exe of [path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')]) {
    if (deps.exists(exe)) return { name: 'Edge', exe, userData: path.join(la, 'Microsoft\\Edge\\User Data') };
  }
  return null;
}
const safeProfile = (p) => typeof p === 'string' && /^[\w .-]{1,64}$/.test(p) && !p.includes('..');
function lastProfile(userData) {
  try { const p = JSON.parse(deps.read(path.join(userData, 'Local State')))?.profile?.last_used; return safeProfile(p) ? p : null; } catch { return null; }
}
const hasApp = (userData, profile) => deps.exists(path.join(userData, profile, 'Web Applications', 'Manifest Resources', APP_ID));

function status() {
  const b = browser();
  if (!b) return { browser: null, installed: false, profile: null };
  const last = lastProfile(b.userData);
  if (last && hasApp(b.userData, last)) return { browser: b.name, installed: true, profile: last };
  let names = [];
  try { names = deps.dirs(b.userData); } catch {}
  const other = names.find((n) => safeProfile(n) && hasApp(b.userData, n));
  return { browser: b.name, installed: !!other, profile: other || null };
}

function openInstall(port = 5577) {
  const b = browser();
  if (!b) return { ok: false, error: 'DeviceHub needs Google Chrome or Microsoft Edge for this.' };
  const profile = lastProfile(b.userData) || 'Default';
  const child = deps.spawn(b.exe, [`--profile-directory=${profile}`, '--new-window', `http://localhost:${port}/?install#/overview`], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref?.();
  return { ok: true, browser: b.name, profile };
}

module.exports = { APP_ID, status, openInstall, browser, deps };
