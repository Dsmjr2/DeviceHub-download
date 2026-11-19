// Install DeviceHub as a Chrome (or Edge) app (18 Nov 2026; helpers/chrome-app.js). Settings > Startup's Install opens
// DeviceHub in a browser tab at ?install; here the browser's own install prompt is offered on one button (the browser
// only shows it after a click). Installed, the browser moves this tab into DeviceHub's app window, which keeps
// DeviceHub's theme in its title bar; DeviceHub.vbs opens that app from then on.
import { modal } from './overlay.js';

let deferred = null;
// the browser says the page can be installed; caught from the start, before the page is drawn
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: minimal-ui)').matches;
const isEdge = () => /\bEdg\//.test(navigator.userAgent);

export async function offerInstall() {
  const q = new URLSearchParams(location.search);
  if (!q.has('install')) return;
  // ?install is for this one visit: a reload or the app window never asks again
  history.replaceState(null, '', location.pathname + location.hash);
  if (standalone()) return;
  for (let i = 0; i < 30 && !deferred; i++) await new Promise((r) => setTimeout(r, 100));
  if (!deferred) {
    const where = isEdge() ? 'Edge\'s menu (…), Apps, Install this site as an app' : 'Chrome\'s menu (⋮), Cast, save and share, Install page as app';
    await modal('Install DeviceHub', `This browser did not offer the install here. Use ${where}.`, [{ label: 'OK', value: true, kind: 'primary' }]);
    return;
  }
  const go = await modal('Install DeviceHub', 'Its window then uses DeviceHub\'s theme in the title bar and opens on its own taskbar button.', [{ label: 'Not now', value: false, kind: 'ghost' }, { label: 'Install', value: true, kind: 'primary' }]);
  if (!go) return;
  const e = deferred;
  deferred = null;
  try { await e.prompt(); await e.userChoice; } catch {}
}
