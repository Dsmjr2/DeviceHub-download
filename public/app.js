// DeviceHub shell: navigation, routing, shortcuts and the command palette.
import { h, icon, $ } from './ui/dom.js';
import { setCommands, openPalette, toast } from './ui/overlay.js';
import { paintLive } from './ui/live-art.js';
import { devices, register, connect, onChange, startPolling, markMissing, setDemo, isBusy, useRemote, shownDevices } from './core/devices.js';
import { env } from './core/env.js';
import { setGlow, loadArtStyle } from './core/theme.js';
import { artDefs, setKeyboardLayout } from './ui/art.js';
import mouse from './devices/mouse-adapter.js';
import headset from './devices/headset-adapter.js';
import keyboard from './devices/keyboard-adapter.js';
import { demoAdapters } from './devices/demo.js';
import { useDemoHistory } from './ui/battery-chart.js';
import { useDemoEstimate } from './ui/controls.js';
import overview from './pages/overview.js';
import setupPage from './pages/setup.js';
import { setupNeeds, watchSetup } from './pages/setup.js';
import mousePage from './pages/mouse.js';
import keyboardPage from './pages/keyboard.js';
import headsetPage from './pages/headset.js';
import lightingPage from './pages/lighting.js';
import profilesPage from './pages/profiles.js';
import backupsPage from './pages/backups.js';
import monitorsPage from './pages/monitors.js';
import fansPage from './pages/fans.js';
import settingsPage from './pages/settings.js';
import learnPage from './pages/learn.js';
import { learnThis } from './pages/learn.js';
import supportedPage from './pages/supported.js';
import wallpapersPage from './pages/wallpapers.js';
import { devicePage } from './pages/my-device.js';
import { commands } from './core/commands.js';
import { startAutoSwitch, loadSettings, auto } from './core/autoswitch.js';
import { firstStart } from './core/first-run.js';

// Demo mode: ?demo on the local server, or always in the shareable build (index sets window.DEVICEHUB_DEMO).
const DEMO = new URLSearchParams(location.search).has('demo') || window.DEVICEHUB_DEMO === true;
env.toast = toast;
setDemo(DEMO);
// Normally the server's background agent owns the devices and this window is its client (no permission prompts,
// works with the window closed). Without an agent, the window connects through the browser's WebHID itself.
let AGENT = false;
if (!DEMO) { try { AGENT = (await (await fetch('/api/agent-config')).json()).agent; } catch {} }
let REMOTE = false;
if (AGENT) {
  // The agent owns the devices; while it starts up, wait for it (up to 30 s) rather than opening them here too.
  for (let i = 0; i < 30 && !(REMOTE = await useRemote()); i++) await new Promise((r) => setTimeout(r, 1000));
}
// Without an agent (DEVICEHUB_AGENT=0 or an older server) the window connects through WebHID itself.
const LOCAL = !DEMO && !AGENT;
const adapters = DEMO ? demoAdapters() : [mouse, headset, keyboard];
if (!REMOTE) adapters.forEach(register);
// demo mode's pretend added device (?demo&added, public/devices/demo.js): its graph readings and time left are its own
if (DEMO) for (const a of adapters) if (a.demoHistory) { useDemoHistory(a.id, a.demoHistory); if (a.demoEstimate) useDemoEstimate(a.id, a.demoEstimate); }

const PAGES = [overview, setupPage, mousePage, headsetPage, keyboardPage, lightingPage, monitorsPage, fansPage, wallpapersPage, profilesPage, backupsPage, settingsPage, learnPage, supportedPage];
// devices added on this PC (my-devices/, 21 Oct 2026): a page each, after the built-in devices
// A device whose driver arrives after the window opened (installed from the library, loaded a moment late, plugged in)
// gets its page and sidebar entry then (23 Oct 2026, a friend's HyperX headset: its tile did nothing, as no page had
// been made for it, and a click fell back to the Overview)
function ensureDevicePages() {
  if (!(REMOTE || DEMO)) return false;
  let added = false;
  for (const d of Object.values(devices)) {
    if (!d.adapter?.plugin || PAGES.some((p) => p.id === d.id)) continue;
    PAGES.splice(PAGES.indexOf(lightingPage), 0, devicePage(d.id));
    added = true;
  }
  return added;
}
ensureDevicePages();
let current = null;

// ---------- hover tilt ----------
// while the pointer is over a device tile or a device page's picture, the drawing leans gently toward it (style.css);
// nothing moves otherwise (19 Oct 2026)
let tilted = null;
document.addEventListener('pointermove', (e) => {
  const host = e.target.closest?.('.bay, .hero-art');
  const art = host?.querySelector('.art.mark');
  if (tilted && tilted !== art) { tilted.style.removeProperty('--tx'); tilted.style.removeProperty('--ty'); }
  tilted = art || null;
  if (!art) return;
  const r = host.getBoundingClientRect();
  art.style.setProperty('--tx', ((e.clientX - r.left) / r.width - .5).toFixed(3));
  art.style.setProperty('--ty', ((e.clientY - r.top) / r.height - .5).toFixed(3));
}, { passive: true });

// ---------- rail ----------
const SETUP = ['lighting', 'monitors', 'fans', 'wallpapers'];
function buildRail() {
  const rail = $('#rail');
  const navBtn = (p) => h('button', { class: 'nav', dataset: { page: p.id }, onclick: () => go(p.id) },
    icon(p.icon), h('span', {}, p.title), p.device ? h('span', { class: 'dot', dataset: { dev: p.device } }) : null,
    p.id === 'setup' ? h('span', { class: 'nav-count', hidden: true }) : null,
    p.id === 'backups' ? h('span', { class: 'nav-shield', title: 'Checking backups…' }, icon('shield')) : null);
  if (!document.querySelector('.art-defs')) document.body.prepend(artDefs());
  rail.replaceChildren(
    h('div', { class: 'brand' }, h('img', { class: 'brand-mark', src: '/icon-64.png', alt: '' }), h('div', {}, 'DeviceHub', DEMO ? h('small', {}, 'DEMO MODE') : null)),
    navBtn(PAGES[0]),
    // Setup, right under the Overview (22 Oct 2026, Shawn: "I want the setup to all be on one page"; pages/setup.js)
    navBtn(setupPage),
    h('div', { class: 'nav-label' }, 'Devices'),
    ...PAGES.filter((p) => p.device).map(navBtn),
    // the rest in two groups (20 Oct 2026, seven entries were one long list): the person's setup, and the app itself.
    // "Desk" became "Setup" when Wallpapers joined it (22 Oct 2026, Shawn: "put it under the desk area and rename that to
    // make more sense"): the lights, screens, fans and wallpapers of their setup
    h('div', { class: 'nav-label' }, 'Desk'),
    ...PAGES.filter((p) => SETUP.includes(p.id)).map(navBtn),
    h('div', { class: 'nav-label' }, 'App'),
    // rail: false = reached from another page only (Supported devices: Settings and Search; Learn a device is listed here too, 22 Oct 2026)
    ...PAGES.filter((p) => !p.device && p.id !== 'overview' && p.id !== 'setup' && p.rail !== false && !SETUP.includes(p.id)).map(navBtn),
    h('div', { class: 'rail-foot' },
      h('button', { class: 'cmd-hint', onclick: openPalette }, icon('search'), h('span', {}, 'Search'))),
  );
  paintRail();
}

// The shield on Backups: green when DeviceHub made a backup in the last 10 minutes (every change makes one), grey
// otherwise; hovering it says when the last one was. Read from the backups folder every 30 s (a local file list).
const FRESH_MS = 10 * 60 * 1000;
let lastBackupAt = null;
async function readLastBackup() {
  if (DEMO) return;
  try { const list = await (await fetch('/api/backups')).json(); lastBackupAt = list.reduce((m, f) => Math.max(m, new Date(f.at).getTime()), 0) || null; } catch {}
  paintShield();
}
function paintShield() {
  const el = document.querySelector('.nav-shield');
  if (!el) return;
  const fresh = lastBackupAt && Date.now() - lastBackupAt < FRESH_MS;
  el.classList.toggle('fresh', !!fresh);
  el.ariaLabel = lastBackupAt ? `Last backup ${new Date(lastBackupAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'No backups yet';
}
setInterval(readLastBackup, 30000);
setTimeout(readLastBackup, 500);

// Setup in the sidebar only while something needs the person, with how many (23 Oct 2026, Shawn: "put the set up area
// in settings when its fully set up ... I need the app to recognize when it is and isnt fully set up"); fully set up, it
// is a row in Settings (and in Search), and comes back here by itself when a new device or a problem needs the person.
// Shown while it is still working that out, and while it is the page open.
// While it is still working that out (the first second or so after the window opens) the last answer stands, kept in
// this window's storage, so Setup does not show and then disappear (Shawn, 23 Oct 2026: "setup shows and then
// dissappears for me, it should be more fluid"); it slides in or out when the answer changes.
let setupLast = (() => { try { const v = localStorage.getItem('setup.needs'); return v == null ? null : Number(v); } catch { return null; } })();
function paintSetupNav() {
  const nav = document.querySelector('.nav[data-page="setup"]');
  if (!nav) return;
  const now = setupNeeds();
  if (now != null && now !== setupLast) { setupLast = now; try { localStorage.setItem('setup.needs', String(now)); } catch {} }
  const n = now ?? setupLast;
  const hide = n === 0 && current?.id !== 'setup';
  if (nav.hidden !== hide) {
    if (!nav.dataset.painted) nav.hidden = hide;   // the first paint: no animation
    else if (hide) { nav.classList.add('nav-out'); setTimeout(() => { if (nav.classList.contains('nav-out')) { nav.hidden = true; nav.classList.remove('nav-out'); } }, 220); }
    else { nav.classList.remove('nav-out'); nav.hidden = false; nav.classList.add('nav-in'); setTimeout(() => nav.classList.remove('nav-in'), 260); }
  }
  nav.dataset.painted = '1';
  const c = nav.querySelector('.nav-count');
  if (c) { c.hidden = !n; c.textContent = n ? String(n) : ''; }
}
watchSetup(paintSetupNav);
// A device plugged in while DeviceHub runs (helpers/plug-watch.mjs, 23 Oct 2026, Shawn: "connect and wait"): its
// library driver was installed (Open its page), or DeviceHub can learn it (Learn it for me, one click from here)
env.onNewDevice = (x) => {
  if (x.installed) {
    toast(`${x.name} is ready`, 'good', { detail: 'Installed from the shared library. Press Turn on settings on its page when ready.', ms: 15000,
      action: x.installed.id ? { label: 'Open its page', run: () => { location.hash = `#/${x.installed.id}`; } } : null });
  } else if (x.learn) {
    toast(`New: ${x.name}`, 'info', { detail: 'DeviceHub can learn it by changing each setting in the maker\'s app.', ms: 20000,
      action: { label: 'Learn it for me', run: () => { learnThis(x.vid, x.pid, { start: true }); location.hash = '#/learn'; } } });
  }
};
setInterval(paintSetupNav, 5 * 60000);
function paintRail() {
  paintSetupNav();
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === current?.id));
  // a device this PC does not have gets no sidebar entry (core/devices.js shownDevices)
  const shown = new Set(shownDevices().map((d) => d.id));
  document.querySelectorAll('.nav .dot[data-dev]').forEach((dot) => { dot.closest('.nav').hidden = !shown.has(dot.dataset.dev); });
  // no devices at all: no "Devices" heading either
  const label = [...document.querySelectorAll('.nav-label')].find((l) => l.textContent === 'Devices');
  if (label) label.hidden = shown.size === 0;
  // green connected, yellow asleep, red when it cannot be used: not connected, or the headset switched off with only its
  // receiver plugged in (Shawn, 21 Oct 2026)
  document.querySelectorAll('.nav .dot').forEach((dot) => {
    const d = devices[dot.dataset.dev], st = d?.status || 'idle';
    dot.className = `dot ${st === 'connected' && d.id === 'headset' && d.values && d.values.headsetOn === false ? 'off' : st}`;
  });
}

// ---------- routing ----------
function go(id) {
  if (location.hash !== `#/${id}`) location.hash = `#/${id}`;
  else render(true);
}

let pending = false;
let transitioning = false;
let seq = 0; // render counter: a late swap from an older render never replaces a newer page
function render(fresh) {
  const id = location.hash.replace(/^#\//, '') || 'overview';
  if (ensureDevicePages()) buildRail();
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  const changed = page !== current;
  current = page;
  const main = $('#main');
  const scroll = main.scrollTop;
  // the device's color tints only its drawing (--page-tone); controls keep the one calm accent (19 Oct 2026)
  document.documentElement.style.setProperty('--page-tone', page.accent || 'var(--signal)');
  document.documentElement.toggleAttribute('data-device-page', !!page.device);
  document.documentElement.dataset.page = page.id;  // which page is open (style.css: the Mouse page's arrow cursor)
  const el = page.render({ go, fresh: !!fresh, redraw: () => { if (current === page) render(false); } });
  el.classList.add('page');
  if (!changed && !fresh) el.classList.add('no-anim');
  const mySeq = ++seq;
  let swapped = false;
  // keyboard focus survives a redraw of the same page (20 Oct 2026: device pages redraw as readings arrive, which sent a
  // Tab user back to the top every few seconds): the same control gets focus again, found by its name, else its place
  const FOCUSABLE = 'button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"])';
  const was = !changed && main.contains(document.activeElement) ? document.activeElement : null;
  const wasKey = was && { tag: was.tagName, name: was.getAttribute('aria-label') || was.textContent.trim().slice(0, 60), index: [...main.querySelectorAll(FOCUSABLE)].indexOf(was) };
  const swap = () => {
    if (seq !== mySeq || swapped) return; swapped = true;
    main.replaceChildren(el); main.scrollTop = changed ? 0 : scroll;
    if (wasKey) {
      const all = [...main.querySelectorAll(FOCUSABLE)];
      const same = all.filter((x) => x.tagName === wasKey.tag && (x.getAttribute('aria-label') || x.textContent.trim().slice(0, 60)) === wasKey.name);
      const target = same.length === 1 ? same[0] : same.length ? same.reduce((a, b) => (Math.abs(all.indexOf(b) - wasKey.index) < Math.abs(all.indexOf(a) - wasKey.index) ? b : a)) : all[wasKey.index];
      target?.focus({ preventScroll: true });
    }
  };
  // Pages switch instantly (19 Oct 2026): a cross-fade or fade-in drops the frosted glass while it runs, which showed
  // as a flash on every page change.
  swap();
  paintRail();
  document.title = page.id === 'overview' ? 'DeviceHub' : `${page.title} · DeviceHub`;
}

// A slider being dragged is never redrawn under the pointer (21 Oct 2026: a reading arriving mid-drag rebuilt the
// page and the slider jumped back): the redraw waits for the release.
let holding = false, heldRender = false;
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('#main input[type=range]')) holding = true; }, true);
const letGo = () => { if (!holding) return; holding = false; if (heldRender) { heldRender = false; setTimeout(() => render(false), 0); } };
document.addEventListener('pointerup', letGo, true);
document.addEventListener('pointercancel', letGo, true);

// Re-render the visible page when a device it shows changes (coalesced to one per frame).
onChange((id) => {
  if (ensureDevicePages()) buildRail();
  paintLive();
  // another VIA keyboard: its drawing from its own layout (ui/art.js)
  if (id === 'keyboard') setKeyboardLayout(devices.keyboard?.adapter?.session?.layout);
  paintRail();
  if (!current || (current.watches && !current.watches.includes(id) && id !== '*')) return;
  if (current.keepAlive?.(id)) return;
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; if (holding) heldRender = true; else render(false); }, 16); // not rAF: it never fires while the window is hidden
});

window.addEventListener('hashchange', () => render(true));
// the Live battery's readings go on every drawing the moment it appears anywhere in the page (21 Oct 2026: the Overview
// swaps a card's drawing in place, and the new one showed no level)
new MutationObserver((list) => { if (list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('.art') || n.querySelector?.('.art'))))) paintLive(); }).observe($('#main'), { childList: true, subtree: true });
window.addEventListener('keydown', (e) => {
  if (e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); go(PAGES[Number(e.key) - 1].id); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }  // Search, from anywhere
});

loadArtStyle();  // the chosen drawing style (Settings > Appearance)
setCommands((q) => commands(q, { go, pages: PAGES }));
buildRail();
setGlow();
// the first time the window opens on this PC: Setup instead of the Overview (core/first-run.js; never on a PC with
// devices seen before or saved profiles). ?demo&first shows it in demo mode.
if ((await firstStart({ demo: DEMO, ready: REMOTE || LOCAL, search: location.search, hash: location.hash, devices: Object.values(devices) })).setup) history.replaceState(null, '', '#/setup');
render(true);

if (REMOTE) {
  loadSettings(); // for the Profiles page; the agent runs auto-switch itself
  env.onRemoteAuto = (a) => { if (a?.settings) Object.assign(auto.settings, a.settings); }; // e.g. toggled from the tray
} else if (AGENT) {
  toast('DeviceHub\'s background part is not answering', 'bad', { detail: 'Quit DeviceHub from the tray icon and open it again.', ms: 0 });
} else {
  // Reconnect devices this browser already allowed (never shows a prompt), then keep battery fresh.
  if (LOCAL && !('hid' in navigator)) toast('This browser has no WebHID', 'bad', { detail: 'Open DeviceHub in Chrome or Edge to reach the mouse and keyboard.', ms: 0 });
  for (const a of adapters) connect(a.id, false);
  startPolling();
  startAutoSwitch();
}
async function reloadWhenUp() {
  let ok = 0;
  for (let i = 0; i < 60 && ok < 2; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try { ok = (await fetch('/api/version', { cache: 'no-store' })).ok ? ok + 1 : 0; } catch { ok = 0; }
  }
  location.reload();
}
// Lighter glass on battery: while the battery saver is saving, html[data-saving] drops the panes' blur (style.css)
async function checkSaving() {
  if (DEMO) return;
  try { const p = await (await fetch('/api/power')).json(); document.documentElement.toggleAttribute('data-saving', !!p.saving); } catch {}
}
checkSaving(); setInterval(checkSaving, 30000);

// Reload by itself when DeviceHub's files are updated (only while nothing is being changed on a device).
let version = null;
setInterval(async () => {
  try {
    const v = (await (await fetch('/api/version')).json()).version;
    // new files: reload, but only once DeviceHub answers steadily (19 Oct 2026: a reload during its restart left the
    // window blank)
    if (version && v !== version && !isBusy()) { toast('DeviceHub was updated', 'info', { detail: 'Reloading…' }); reloadWhenUp(); }
    version = version || v;
  } catch {}
}, 20000);
// A new version is ready (24 Oct 2026, Shawn: "I do want you to provide a pop up that says there is an update"): DeviceHub
// checks once, 2 minutes after it starts (server.js, helpers/update-notice.mjs); the window asks once per version per
// start, Update or Later. Update runs the same path as Settings' Update button.
if (!DEMO) {
  let asked = null;
  const ask = async () => {
    let n = null;
    try { n = (await (await fetch('/api/update-notice')).json()).notice; } catch {}
    if (!n || asked === n.version || isBusy()) return;
    asked = n.version;
    const { modal } = await import('./ui/overlay.js');
    const go = await modal('Update ready', n.text, [{ label: 'Later', value: false, kind: 'ghost' }, { label: 'Update', value: true, kind: 'primary' }]);
    if (go) { location.hash = '#/settings'; (await import('./pages/settings.js')).runSelfUpdate(); }
  };
  setTimeout(ask, 130000); setTimeout(ask, 300000);
}
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (LOCAL) {
  navigator.hid?.addEventListener('connect', () => { for (const d of Object.values(devices)) if (d.status !== 'connected') connect(d.id, false); });
  navigator.hid?.addEventListener('disconnect', (e) => {
    for (const d of Object.values(devices)) if (d.adapter.owns?.(e.device)) { markMissing(d.id); toast(`${d.adapter.title} disconnected`, 'bad'); }
  });
}
