// DeviceHub shell: navigation, routing, shortcuts and the command palette.
import { h, icon, $, dateTime } from './ui/dom.js';
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
import { dropdownOpen } from './ui/dropdown.js';
import { commands } from './core/commands.js';
import { startAutoSwitch, loadSettings, auto } from './core/autoswitch.js';
import { firstStart } from './core/first-run.js';
import { everyVisible, isHidden } from './core/visible-timer.js';
import { startEvents, onEvent, streamUp } from './core/events.js';
import { startIdleClose, unsavedWatcher } from './core/idle-close.js';
import { displayWaiting } from './ui/display-settings.js';

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
// the window's one live stream (core/events.js; already open when the agent answered): DeviceHub says what changed, so
// the window polls nothing it can be told (27 Oct 2026). Demo mode has none and keeps its version check.
if (!DEMO) startEvents();
const adapters = DEMO ? demoAdapters() : [mouse, headset, keyboard];
if (!REMOTE) adapters.forEach(register);
// demo mode's pretend added device (?demo&added, public/devices/demo.js): its graph readings and time left are its own
if (DEMO) for (const a of adapters) if (a.demoHistory) { useDemoHistory(a.id, a.demoHistory); if (a.demoEstimate) useDemoEstimate(a.id, a.demoEstimate); }

// Each page's code loads the first time the page is opened (27 Oct 2026: the window opens faster and holds less; it
// loaded all fourteen pages, and everything they use, before drawing the first). The sidebar and Search need only the
// id, title and icon, listed here (tests/lazy-pages.mjs checks they match each page's own); device and rail as on the page.
const page = (id, title, icon, load, more = {}) => ({ id, title, icon, load, ...more });
const PAGES = [
  page('overview', 'Overview', 'overview', () => import('./pages/overview.js')),
  page('setup', 'Setup', 'check', () => import('./pages/setup.js')),
  page('mouse', 'Mouse', 'mouse', () => import('./pages/mouse.js'), { device: 'mouse' }),
  page('headset', 'Headset', 'headset', () => import('./pages/headset.js'), { device: 'headset' }),
  page('keyboard', 'Keyboard', 'keyboard', () => import('./pages/keyboard.js'), { device: 'keyboard' }),
  page('fans', 'PC', 'fan', () => import('./pages/fans.js')),
  page('lighting', 'Lighting', 'lighting', () => import('./pages/lighting.js')),
  page('monitors', 'Monitors', 'monitor', () => import('./pages/monitors.js')),
  page('wallpapers', 'Wallpapers', 'wallpapers', () => import('./pages/wallpapers.js')),
  page('profiles', 'Profiles', 'profiles', () => import('./pages/profiles.js')),
  page('backups', 'Backups', 'backups', () => import('./pages/backups.js'), { rail: false }),
  page('settings', 'Settings', 'settings', () => import('./pages/settings.js')),
  page('learn', 'Learn a device', 'plug', () => import('./pages/learn.js')),
  page('supported', 'Supported devices', 'plug', () => import('./pages/supported.js'), { rail: false }),
];
// a page's code (p.code, its default export), loaded once; a load that failed (DeviceHub restarting) is tried again
// the next time the page is opened
function loadPage(p) {
  p.loading ??= p.load().then((m) => { p.code = m.default; if (m.setupNeeds) useSetup(m); }, (e) => { p.loading = null; throw e; });
  return p.loading;
}
// devices added on this PC (my-devices/, 21 Oct 2026): a page each, after the built-in devices
// A device whose driver arrives after the window opened (installed from the library, loaded a moment late, plugged in)
// gets its page and sidebar entry then (23 Oct 2026, a friend's HyperX headset: its tile did nothing, as no page had
// been made for it, and a click fell back to the Overview)
// its title and icon by the same rule as pages/my-device.js devicePage, which is loaded when the page is first opened
const KIND_ICON = { mouse: 'mouse', headset: 'headset', keyboard: 'keyboard' };
function ensureDevicePages() {
  if (!(REMOTE || DEMO)) return false;
  let added = false;
  for (const d of Object.values(devices)) {
    if (!d.adapter?.plugin || PAGES.some((p) => p.id === d.id)) continue;
    const id = d.id;
    PAGES.splice(PAGES.findIndex((p) => p.id === 'fans'), 0, page(id, d.adapter.title, KIND_ICON[String(d.adapter.kind || '').toLowerCase()] || 'plug',
      () => import('./pages/my-device.js').then((m) => ({ default: m.devicePage(id) })), { device: id }));
    added = true;
  }
  return added;
}
ensureDevicePages();
let current = null;

// ---------- hover tilt ----------
// while the pointer is over a device tile or a device page's picture, the drawing leans gently toward it (style.css);
// coalesced to once per display frame so 1000Hz–8000Hz gaming mice never cause layout thrashing.
let tilted = null, tiltRaf = 0, lastMoveEvent = null;
document.addEventListener('pointermove', (e) => {
  lastMoveEvent = e;
  if (tiltRaf) return;
  tiltRaf = requestAnimationFrame(() => {
    tiltRaf = 0;
    const ev = lastMoveEvent;
    if (!ev) return;
    const host = ev.target?.closest?.('.bay, .hero-art');
    const art = host?.querySelector('.art.mark');
    if (tilted && tilted !== art) { tilted.style.removeProperty('--tx'); tilted.style.removeProperty('--ty'); }
    tilted = art || null;
    if (!art) return;
    const r = host.getBoundingClientRect();
    art.style.setProperty('--tx', ((ev.clientX - r.left) / r.width - .5).toFixed(3));
    art.style.setProperty('--ty', ((ev.clientY - r.top) / r.height - .5).toFixed(3));
  });
}, { passive: true });

// ---------- rail ----------
const SETUP = ['fans', 'lighting', 'monitors', 'wallpapers'];
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
    navBtn(PAGES.find((p) => p.id === 'setup')),
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
// otherwise; hovering it says when the last one was. The newest backup's time comes on the live stream (core/events.js:
// hello, then backup whenever a file lands in the backups folder; 27 Oct 2026, it was read every 30 s), and it turns
// grey by itself when that time is 10 minutes old.
const FRESH_MS = 10 * 60 * 1000;
let lastBackupAt = null, staleTimer = null;
const setLastBackup = (at) => { lastBackupAt = at ? new Date(at).getTime() || null : null; paintShield(); };
function paintShield() {
  clearTimeout(staleTimer);
  const fresh = lastBackupAt && Date.now() - lastBackupAt < FRESH_MS;
  if (fresh) staleTimer = setTimeout(paintShield, lastBackupAt + FRESH_MS - Date.now() + 50);
  const el = document.querySelector('.nav-shield');
  if (!el) return;
  el.classList.toggle('fresh', !!fresh);
  el.ariaLabel = lastBackupAt ? `Last backup ${dateTime(lastBackupAt)}` : 'No backups yet';
}
onEvent('hello', (x) => setLastBackup(x.backupAt));
onEvent('backup', (x) => setLastBackup(x.at));

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
  const now = setupCode ? setupCode.setupNeeds() : null;
  if (now != null && now !== setupLast) { setupLast = now; try { localStorage.setItem('setup.needs', String(now)); } catch {} }
  const n = now ?? setupLast;
  // not known yet (the first 45 s, with no last answer in this window's storage) hides it, unless it is the page open
  // (27 Oct 2026, Shawn: "why is the setup area showing on my system": a new window showed it for 45 s); a first start
  // opens Setup itself
  const hide = n == null ? !location.hash.startsWith('#/setup') : n === 0;
  if (nav.hidden !== hide) {
    if (!nav.dataset.painted) nav.hidden = hide;   // the first paint: no animation
    else if (hide) { nav.classList.add('nav-out'); setTimeout(() => { if (nav.classList.contains('nav-out')) { nav.hidden = true; nav.classList.remove('nav-out'); } }, 220); }
    else { nav.classList.remove('nav-out'); nav.hidden = false; nav.classList.add('nav-in'); setTimeout(() => nav.classList.remove('nav-in'), 260); }
  }
  nav.dataset.painted = '1';
  const c = nav.querySelector('.nav-count');
  if (c) { c.hidden = !n; c.textContent = n ? String(n) : ''; }
}
// The Setup check lives with the Setup page (pages/setup.js) and reads nothing in the window's first 45 s, so its code
// loads then (27 Oct 2026, pages load when first opened), or sooner when Setup is opened; until then the last answer stands
let setupCode = null;
function useSetup(m) {
  if (setupCode) return;
  setupCode = m;
  m.watchSetup(paintSetupNav);
  paintSetupNav();
}
setTimeout(() => loadPage(PAGES.find((p) => p.id === 'setup')).catch(() => {}), Math.max(0, 46000 - performance.now()));
// what is learning right now (pages/learn.js, loaded when it is first used, says so on env): nothing before then
const learnBusy = () => !!env.learnBusy?.();
const learnThis = async (...a) => (await import('./pages/learn.js')).learnThis(...a);
// A device plugged in while DeviceHub runs (helpers/plug-watch.mjs, 23 Oct 2026, Shawn: "connect and wait"): its
// library driver was installed (Open its page), or DeviceHub can learn it (Learn it for me, one click from here)
env.onNewDevice = (x) => {
  if (x.installed) {
    const detail = x.installed.proven ? 'Connected and ready to customize.' : 'Open to verify and customize.';
    toast(`${x.name} is ready`, 'good', { detail, ms: 15000,
      action: x.installed.id ? { label: 'Open', run: () => { location.hash = `#/${x.installed.id}`; } } : null });
  } else if (x.learn) {
    toast(`New: ${x.name}`, 'info', { ms: 20000,
      action: { label: 'Learn it for me', run: async () => { await learnThis(x.vid, x.pid, { start: true }); location.hash = '#/learn'; } } });
  }
};
// the Setup check's background look (setupNeeds: ~7 reads) every 5 minutes, only while the window is shown
everyVisible(paintSetupNav, 5 * 60000);
function paintRail() {
  paintSetupNav();
  paintShield();
  const setupHidden = document.querySelector('.nav[data-page="setup"]')?.hidden;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === current?.id || (current?.id === 'setup' && setupHidden && b.dataset.page === 'settings')));
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
let seq = 0; // render counter: a late swap from an older render never replaces a newer page
let loadFresh = false; // a fresh draw asked for while the page's code was loading
function render(fresh) {
  const id = location.hash.replace(/^#\//, '') || 'overview';
  if (ensureDevicePages()) buildRail();
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  // first time this page is opened: its code loads, then it draws (the page on screen stays until then); a newer render
  // meanwhile wins
  if (!page.code) {
    loadFresh = loadFresh || !!fresh;
    const mySeq = ++seq;
    loadPage(page).then(() => { if (seq !== mySeq) return; const f = loadFresh; loadFresh = false; render(f); },
      (e) => { if (seq === mySeq) toast(`${page.title} did not open`, 'bad', { detail: e?.message || 'Try again.' }); });
    return;
  }
  const code = page.code;
  const changed = page !== current;
  current = page;
  const main = $('#main');
  const scroll = main.scrollTop;
  // the device's color tints only its drawing (--page-tone); controls keep the one calm accent (19 Oct 2026)
  document.documentElement.style.setProperty('--page-tone', code.accent || 'var(--signal)');
  document.documentElement.toggleAttribute('data-device-page', !!code.device);
  document.documentElement.dataset.page = page.id;  // which page is open (style.css: the Mouse page's arrow cursor)
  const el = code.render({ go, fresh: !!fresh, redraw: () => { if (current === page) render(false); } });
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
const letGo = () => { if (!holding || dropdownOpen()) return; holding = false; if (heldRender) { heldRender = false; setTimeout(() => render(false), 0); } };
// an open dropdown list (ui/dropdown.js) holds redraws the same way, so a reading never pulls the control out from under it
addEventListener('dropdown-open', () => { holding = true; });
addEventListener('dropdown-closed', letGo);
document.addEventListener('pointerup', letGo, true);
document.addEventListener('pointercancel', letGo, true);

// Re-render the visible page when a device it shows changes (coalesced to one per frame). While the window is hidden
// (minimized, behind a game) nothing is redrawn: a redraw can read (the Overview's Bluetooth batteries, the Setup
// check), so the window waits and redraws once when it is shown again (26 Oct 2026, idle CPU).
let changedWhileHidden = false;
document.addEventListener('visibilitychange', () => { if (!isHidden() && changedWhileHidden) { changedWhileHidden = false; pageChanged('*'); } });
onChange((id) => { if (isHidden()) { changedWhileHidden = true; return; } pageChanged(id); });
function pageChanged(id) {
  if (ensureDevicePages()) buildRail();
  paintLive();
  // another VIA keyboard: its drawing from its own layout (ui/art.js)
  if (id === 'keyboard') setKeyboardLayout(devices.keyboard?.adapter?.session?.layout);
  paintRail();
  const code = current?.code;
  if (!code || (code.watches && !code.watches.includes(id) && id !== '*')) return;
  if (code.keepAlive?.(id)) return;
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; if (holding) heldRender = true; else render(false); }, 16); // not rAF: it never fires while the window is hidden
}

window.addEventListener('hashchange', () => render(true));
// the Live battery's readings go on every drawing the moment it appears anywhere in the page (21 Oct 2026: the Overview
// swaps a card's drawing in place, and the new one showed no level)
new MutationObserver((list) => { if (list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('.art') || n.querySelector?.('.art'))))) paintLive(); }).observe($('#main'), { childList: true, subtree: true });
window.addEventListener('keydown', (e) => {
  if (e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); go(PAGES[Number(e.key) - 1].id); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }  // Search, from anywhere
});

await loadArtStyle();  // the chosen drawing style and theme (Settings > Appearance)
setCommands((q) => commands(q, { go, pages: PAGES }));
buildRail();
setGlow();
// the first time the window opens on this PC: Setup instead of the Overview (core/first-run.js; never on a PC with
// devices seen before or saved profiles). ?demo&first shows it in demo mode.
// a window opened again after it was closed for not being in use (core/idle-close.js): back on the page it was on
if (!DEMO && !location.hash) { try { const r = await (await fetch('/api/window/resume', { cache: 'no-store' })).json(); if (r?.page) history.replaceState(null, '', r.page); } catch {} }
if ((await firstStart({ demo: DEMO, ready: REMOTE || LOCAL, search: location.search, hash: location.hash, devices: Object.values(devices) })).setup) history.replaceState(null, '', '#/setup');
render(true);

// Close the window after 5 minutes minimized or hidden, when nothing is running (core/idle-close.js; Settings > Startup)
if (!DEMO) {
  const unsaved = unsavedWatcher();
  const idle = startIdleClose({ state: () => ({ busy: isBusy(), dropdown: dropdownOpen(), learn: learnBusy(), displayKeep: displayWaiting(), unsaved: unsaved() }) });
  // the PC going to sleep closes the window at once (29 Oct 2026, Shawn: "so it doesnt use more resources when my pc is
  // asleep"); on waking, a window nobody is using closes too, in case sleep came before the close finished
  onEvent('sleep', () => { idle.tick('sleep'); });
  onEvent('woke', () => { setTimeout(() => idle.tick('woke'), 5000); });
}

if (REMOTE) {
  loadSettings(); // for the Profiles page; the agent runs auto-switch itself
  env.onRemoteAuto = (a) => { if (a?.settings) Object.assign(auto.settings, a.settings); }; // e.g. toggled from the tray
} else if (AGENT) {
  toast('DeviceHub not responding', 'bad', { detail: 'Quit from the tray icon, then reopen.', ms: 0 });
} else {
  // Reconnect devices this browser already allowed (never shows a prompt), then keep battery fresh.
  if (LOCAL && !('hid' in navigator)) toast('WebHID not available', 'bad', { detail: 'Open DeviceHub in Chrome or Edge.', ms: 0 });
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
// Lighter glass on battery: while the battery saver is saving, html[data-saving] drops the panes' blur (style.css).
// Told on the live stream (hello, then power when the saver turns on or off; 27 Oct 2026, it was asked every 30 s).
const paintSaving = (p) => document.documentElement.toggleAttribute('data-saving', !!p?.saving);
onEvent('hello', paintSaving);
onEvent('power', paintSaving);

// Pause infinite CSS animations while minimized or behind a game
const syncVisibility = () => {
  const hid = document.hidden;
  document.documentElement.toggleAttribute('data-hidden', hid);
  if (!hid) paintShield();
};
document.addEventListener('visibilitychange', syncVisibility);
syncVisibility();

// Reload by itself when DeviceHub's files are updated (only while nothing is being changed on a device, and, as
// before, once the window is shown). The version comes on the live stream: hello on every (re)open, so a restart with
// new files is seen when it reconnects, and version when a file in public/ changes (27 Oct 2026: it was asked every
// 20 s). Asked every 20 s only while the stream is not open (demo mode, DeviceHub restarting).
let version = null, newVersion = null, reloading = false;
function sawVersion(v) {
  if (!v) return;
  if (!version) version = v;
  else if (v !== version) newVersion = v;
  reloadIfNew();
}
function reloadIfNew() {
  if (!newVersion || reloading || isHidden() || isBusy()) return;
  // new files: reload, but only once DeviceHub answers steadily (19 Oct 2026: a reload during its restart left the
  // window blank)
  reloading = true; toast('DeviceHub updated', 'info', { detail: 'Reloading…' }); reloadWhenUp();
}
onEvent('hello', (x) => sawVersion(x.version));
onEvent('version', (x) => sawVersion(x.version));
document.addEventListener('visibilitychange', reloadIfNew);
everyVisible(async () => {
  if (streamUp()) return reloadIfNew();   // no request: a reload that waited for a device change goes now
  try { sawVersion((await (await fetch('/api/version')).json()).version); } catch {}
}, 20000);
// A new version is ready (24 Oct 2026, Shawn: "I do want you to provide a pop up that says there is an update"): DeviceHub
// checks once, 2 minutes after it starts (server.js, helpers/update-notice.mjs); the window asks once per version per
// start, Update or Later. Update runs the same path as Settings' Update button.
// The notice comes on the live stream (hello, or notice the moment the check finds one; 27 Oct 2026, it was asked at
// 130 s and 300 s): never in the window's first 130 s, as before, and asked again a minute later while a change runs.
if (!DEMO) {
  let asked = null, later = null;
  const ask = async (n) => {
    if (!n || asked === n.version) return;
    const wait = Math.max(130000 - performance.now(), isBusy() ? 60000 : 0);
    if (wait > 0) { clearTimeout(later); later = setTimeout(() => ask(n), wait); return; }
    asked = n.version;
    const { modal } = await import('./ui/overlay.js');
    // "DeviceHub 1.5 is ready" and what's new, up to 5 short lines (27 Oct 2026; an older release has only the text)
    const body = n.notes?.length ? h('div', {}, h('p', {}, n.text), h('p', { class: 'muted' }, "What's new:"), h('ul', { class: 'whats-new' }, ...n.notes.map((x) => h('li', {}, x)))) : n.text;
    const go = await modal('Update ready', body, [{ label: 'Later', value: false, kind: 'ghost' }, { label: 'Update', value: true, kind: 'primary' }]);
    if (go) { location.hash = '#/settings'; (await import('./pages/settings.js')).runSelfUpdate(); }
  };
  onEvent('hello', (x) => ask(x.notice));
  onEvent('notice', (x) => ask(x.notice));
}
// One click, always (24 Oct 2026, Shawn: "why is it making click the buttons twice to update or publish"): a page that
// redraws (Settings does whenever one of its checks answers) replaces the button between the press and the release, and
// the browser then drops the click. When the pressed button is gone by the release, the release clicks the button that
// took its place: the same label, under the pointer.
{
  let pressed = null;
  const labelOf = (b) => (b?.textContent || '').replace(/\s+/g, ' ').trim();
  document.addEventListener('pointerdown', (e) => {
    const b = e.target?.closest?.('button');
    pressed = b && !b.disabled && e.button === 0 ? { b, label: labelOf(b) } : null;
  }, true);
  document.addEventListener('pointerup', (e) => {
    const p = pressed; pressed = null;
    if (!p || p.b.isConnected || e.button !== 0) return;
    const now = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('button');
    if (now && !now.disabled && labelOf(now) === p.label) now.click();
  }, true);
}
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (LOCAL) {
  navigator.hid?.addEventListener('connect', () => { for (const d of Object.values(devices)) if (d.status !== 'connected') connect(d.id, false); });
  navigator.hid?.addEventListener('disconnect', (e) => {
    for (const d of Object.values(devices)) if (d.adapter.owns?.(e.device)) { markMissing(d.id); toast(`${d.adapter.title} disconnected`, 'bad'); }
  });
}
