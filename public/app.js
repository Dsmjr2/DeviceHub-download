// DeviceHub shell: navigation, routing, shortcuts and the command palette.
import { h, icon, $ } from './ui/dom.js';
import { setCommands, openPalette, toast } from './ui/overlay.js';
import { devices, register, connect, onChange, startPolling, markMissing, setDemo, isBusy, useRemote, shownDevices } from './core/devices.js';
import { env } from './core/env.js';
import { setGlow, loadArtStyle } from './core/theme.js';
import { artDefs, setKeyboardLayout } from './ui/art.js';
import mouse from './devices/mouse-adapter.js';
import headset from './devices/headset-adapter.js';
import keyboard from './devices/keyboard-adapter.js';
import { demoAdapters } from './devices/demo.js';
import overview from './pages/overview.js';
import mousePage from './pages/mouse.js';
import keyboardPage from './pages/keyboard.js';
import headsetPage from './pages/headset.js';
import lightingPage from './pages/lighting.js';
import profilesPage from './pages/profiles.js';
import backupsPage from './pages/backups.js';
import monitorsPage from './pages/monitors.js';
import fansPage from './pages/fans.js';
import settingsPage from './pages/settings.js';
import { devicePage } from './pages/my-device.js';
import { commands } from './core/commands.js';
import { startAutoSwitch, loadSettings, auto } from './core/autoswitch.js';

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

const PAGES = [overview, mousePage, headsetPage, keyboardPage, lightingPage, monitorsPage, fansPage, profilesPage, backupsPage, settingsPage];
// devices added on this PC (my-devices/, 21 Oct 2026): a page each, after the built-in devices
if (REMOTE) for (const d of Object.values(devices)) if (d.adapter?.plugin) PAGES.splice(PAGES.indexOf(lightingPage), 0, devicePage(d.id));
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
function buildRail() {
  const rail = $('#rail');
  const navBtn = (p) => h('button', { class: 'nav', dataset: { page: p.id }, onclick: () => go(p.id) },
    icon(p.icon), h('span', {}, p.title), p.device ? h('span', { class: 'dot', dataset: { dev: p.device } }) : null,
    p.id === 'backups' ? h('span', { class: 'nav-shield', title: 'Checking backups…' }, icon('shield')) : null);
  if (!document.querySelector('.art-defs')) document.body.prepend(artDefs());
  rail.replaceChildren(
    h('div', { class: 'brand' }, h('img', { class: 'brand-mark', src: '/icon-64.png', alt: '' }), h('div', {}, 'DeviceHub', DEMO ? h('small', {}, 'DEMO MODE') : null)),
    navBtn(PAGES[0]),
    h('div', { class: 'nav-label' }, 'Devices'),
    ...PAGES.filter((p) => p.device).map(navBtn),
    // the rest in two groups (20 Oct 2026, seven entries were one long list): what sits on the desk, and the app itself
    h('div', { class: 'nav-label' }, 'Desk'),
    ...PAGES.filter((p) => ['lighting', 'monitors', 'fans'].includes(p.id)).map(navBtn),
    h('div', { class: 'nav-label' }, 'App'),
    ...PAGES.filter((p) => !p.device && p.id !== 'overview' && !['lighting', 'monitors', 'fans'].includes(p.id)).map(navBtn),
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
  el.title = lastBackupAt ? `Last backup ${new Date(lastBackupAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'No backups yet';
}
setInterval(readLastBackup, 30000);
setTimeout(readLastBackup, 500);

function paintRail() {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === current?.id));
  // a device this PC does not have gets no sidebar entry (core/devices.js shownDevices)
  const shown = new Set(shownDevices().map((d) => d.id));
  document.querySelectorAll('.nav .dot[data-dev]').forEach((dot) => { dot.closest('.nav').hidden = !shown.has(dot.dataset.dev); });
  // no devices at all: no "Devices" heading either
  const label = [...document.querySelectorAll('.nav-label')].find((l) => l.textContent === 'Devices');
  if (label) label.hidden = shown.size === 0;
  document.querySelectorAll('.nav .dot').forEach((dot) => { dot.className = `dot ${devices[dot.dataset.dev]?.status || ''}`; });
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
window.addEventListener('keydown', (e) => {
  if (e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); go(PAGES[Number(e.key) - 1].id); }
});

loadArtStyle();  // the chosen drawing style (Settings > Appearance)
setCommands((q) => commands(q, { go, pages: PAGES }));
buildRail();
setGlow();
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
if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (LOCAL) {
  navigator.hid?.addEventListener('connect', () => { for (const d of Object.values(devices)) if (d.status !== 'connected') connect(d.id, false); });
  navigator.hid?.addEventListener('disconnect', (e) => {
    for (const d of Object.values(devices)) if (d.adapter.owns?.(e.device)) { markMissing(d.id); toast(`${d.adapter.title} disconnected`, 'bad'); }
  });
}
