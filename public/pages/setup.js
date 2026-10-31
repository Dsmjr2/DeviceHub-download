// Setup (22 Oct 2026, Shawn: "I want the setup to all be on one page"; docs/handoff/setup-page.md). Made simpler the
// same day (Shawn: "is currently overwhelming for a new user"; docs/handoff/setup-simpler.md):
//   1. one status line: "2 things need you" and Set it all up (installs, Turn on settings for all, Get the layout;
//      a maker's app holding a device is asked about once first, all apps in one question; never learning), or, with
//      nothing to do, "You're all set" with each device and what it can do now (docs/handoff/first-run.md)
//   2. To do: only the rows that need you, in the order to do them, one short line and one button each
//   3. Your devices: small tiles (icon, name, a check or "Needs you"); a tile that needs you opens its one button here
//   4. Optional extras and Everything that is done (N), both folded; rows that are not needed are left out
// Reset sound to normal is on the Headset page's EQ card; the problem reports switch and Get help are in Settings.
// Sources (no new routes): GET /api/setup, the window's own device list, GET /api/diagnose for a device that is not
// connected, GET /api/via-fetch for a VIA keyboard, the installers' status, /api/eq, /api/openrgb, /api/bluetooth.
// Read once when the page opens; a device that connects, drops or has its settings turned on redraws it (keepAlive),
// any other reading does not. Everything answers in place: no pop-ups, notifications or tooltips. Demo mode (?demo)
// shows a PC where 2 things need you, with pretend answers; nothing is sent.
import { h, icon } from '../ui/dom.js';
import { button, skeleton } from '../ui/controls.js';
import { env } from '../core/env.js';
import { devices, isDemo, connect } from '../core/devices.js';
import { topbar, checkAnswer } from './common.js';
import { brandForUsb, isViaKeyboard } from '../core/brands.js';
import { getHelp, helpHere } from '../ui/get-help.js';
import { worksReport, offersWorks } from '../ui/works-report.js';
import { installerInline, installerStatus } from '../ui/installer-button.js';
import { boardLights, boardLightsStatus } from '../ui/board-lights.js';
import { deviceChecks } from '../ui/device-checks.js';
import { DEMO_SUMMARY, DEMO_LIVE, DEMO_DIAG, DEMO_TOOLS, DEMO_EQ, DEMO_ORGB, DEMO_BT } from '../core/setup-demo.js';
import { deviceRows, doAllSteps, soundRows, lightRows, batteryRows, learnRows, summaryLine, planSetup, makerApps, askLine, leftLine, canDo } from '../core/setup-list.js';

// ---------- what the page knows (kept across redraws) ----------
const st = {
  summary: undefined, tools: null, eq: null, orgb: null, bt: null,
  diag: {}, diagKey: {}, layouts: {}, layoutAsked: {},
  note: {}, over: {}, busy: {}, confirm: {}, all: null, loadedAt: 0,
  tile: null, fold: { extras: false, done: false },
  ask: false,  // Set it all up's one question about the makers' apps is showing
};
let redrawPage = () => {};
// who else wants to know when the answer may have changed (the sidebar and Settings, setupNeeds below)
const watchers = new Set();
let notifyQueued = false;
const redraw = () => {
  redrawPage();
  if (!notifyQueued) { notifyQueued = true; setTimeout(() => { notifyQueued = false; for (const w of watchers) { try { w(); } catch {} } }, 50); }
};
const post = async (url, body = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
};
// told to the window's idle close (app.js): Set it all up or one of the actions is running
env.setupBusy = () => !!st.all?.busy || Object.keys(st.busy).length > 0;
const get = (url) => env.api(url);

// one summary read at a time (26 Oct 2026, idle CPU: while the first read was slow, every redraw notice started load()
// again, all seven reads each time, measured 55 loads in 75 s on the Overview)
let summaryPending = false;
function loadSummary() {
  if (isDemo()) { st.summary = DEMO_SUMMARY; return; }
  if (summaryPending) return;
  summaryPending = true;
  get('/api/setup').then((j) => { st.summary = j; }, () => { st.summary = null; }).finally(() => { summaryPending = false; redraw(); });
}
// the server keeps the last answers of the slow reads (helpers/last-answer.js): opening the page and the 5-minute
// background look take them at once; an install that ended (onDone) asks fresh
function loadTools(fresh = false) {
  if (isDemo()) { st.tools = DEMO_TOOLS; st.eq = DEMO_EQ; return; }
  installerStatus(fresh).then((t) => {
    st.tools = t || [];
    // the headset Equalizer APO is on for: only asked when it is installed (without it /api/eq reads iCUE's presets)
    if (st.tools.find((x) => x.id === 'eqapo')?.installed) get('/api/eq').then((e) => { st.eq = e; redraw(); }, () => {});
    redraw();
  });
}
function load() {
  st.loadedAt = Date.now();
  loadSummary();
  loadTools();
  if (isDemo()) { st.orgb = st.orgb || DEMO_ORGB; st.bt = DEMO_BT; boardLightsStatus().then((b) => { st.board = b; }); return; }
  get('/api/openrgb').then((o) => { st.orgb = o; redraw(); }, () => {});
  get('/api/lights/diagnose').then((d) => { st.lightsDiag = d; redraw(); }, () => {});  // why no lights were found
  boardLightsStatus().then((b) => { st.board = b; redraw(); });  // board, fan and RAM lights set up or not (helpers/board-lights.mjs)
  get('/api/bluetooth').then((b) => { st.bt = Array.isArray(b) ? b : []; redraw(); }, () => { st.bt = []; redraw(); });
}

// the window's own device list, in the shape setup-list.js reads
function liveDevices() {
  if (isDemo()) {
    const out = {};
    for (const d of Object.values(devices)) if (['mouse', 'headset', 'keyboard'].includes(d.id)) out[d.id] = { title: d.adapter.title, kind: d.adapter.kind, status: d.status, seen: true };
    for (const [id, d] of Object.entries(DEMO_LIVE)) out[id] = { ...d, ...(st.over[id]?.live || {}) };
    return out;
  }
  const out = {};
  for (const d of Object.values(devices)) {
    const a = d.adapter;
    if (!a) continue;
    out[d.id] = { title: a.title, kind: a.kind, status: d.status, seen: !!d.seen, absent: !!d.absent, plugin: !!a.plugin, library: !!a.library, learned: !!a.library?.learned, turnOn: a.library?.turnOn === true, works: offersWorks(d) };
  }
  return out;
}
// a status signature: a change redraws the page, any other reading does not
const liveSig = () => JSON.stringify(Object.entries(liveDevices()).map(([id, d]) => [id, d.status, d.turnOn, d.works, d.absent]));

// the maker's app holding a device that is not connected (diagnose's own finding and close action), asked once per
// device and state
function askDiagnose(live) {
  if (isDemo()) { for (const [id, f] of Object.entries(DEMO_DIAG)) if (!st.over[id]) st.diag[id] = f; else delete st.diag[id]; return; }
  for (const [id, d] of Object.entries(live)) {
    const away = !['connected', 'connecting'].includes(d.status) && (d.seen || d.plugin) && !d.absent;
    if (!away) { delete st.diag[id]; delete st.diagKey[id]; continue; }
    if (st.diagKey[id] === d.status) continue;
    st.diagKey[id] = d.status;
    get(`/api/diagnose?id=${encodeURIComponent(id)}`).then((r) => {
      const f = (r.findings || []).find((x) => x.action?.kind === 'close-app');
      if (f) st.diag[id] = f; else delete st.diag[id];
      if (f) redraw();
    }, () => {});
  }
}
// a VIA keyboard nothing runs yet: does DeviceHub know its official layout file? (helpers/via-fetch.mjs plan)
const isVia = (usb, title) => { const [vid] = String(usb || '').split(':'); return isViaKeyboard({ brand: brandForUsb(vid), name: title }); };
function askLayouts(summary) {
  for (const i of summary?.learn || []) {
    const usb = String(i.usb || '').toLowerCase();
    if (i.what !== 'learn' || !usb || st.layoutAsked[usb] || !isVia(usb, i.title)) continue;
    st.layoutAsked[usb] = true;
    if (isDemo()) { st.layouts[usb] = { source: true, have: false }; continue; }
    const [vid, pid] = usb.split(':');
    get(`/api/via-fetch?vid=${vid}&pid=${pid}`).then((p) => { st.layouts[usb] = { source: !!p.source, have: !!p.have, file: p.file }; redraw(); }, () => {});
  }
}

// ---------- the buttons ----------
const noteOf = (key, text) => { st.note[key] = text; redraw(); };
// demo: the row shows done with the answer, nothing is sent
const demoDone = (key, text, extra = {}) => { st.over[key] = { status: 'done', action: null, ...extra, live: { ...st.over[key]?.live, ...extra.live } }; noteOf(key, `Demo: ${text}`); };
async function runOne(r) {
  const a = r.action, k = r.key;
  if (st.busy[k]) return;
  st.busy[k] = true;
  try {
    if (a.kind === 'install') {
      noteOf(k, 'Installing…');
      if (isDemo()) return demoDone(k, 'installed.');
      try { const j = await post('/api/library/install', { name: a.name }); noteOf(k, j.loaded ? (j.note || 'Installed.') : 'Installed. Restart DeviceHub.'); }
      catch (e) { noteOf(k, `Not installed: ${e.message}`); }
      loadSummary();
    } else if (a.kind === 'turn-on' || a.kind === 'check-again') {
      noteOf(k, a.kind === 'turn-on' ? 'Turning on…' : 'Checking…');
      if (isDemo()) return demoDone(k, a.kind === 'turn-on' ? 'settings on, 6 of 6 passed.' : 'checked, 6 of 6 passed.', { live: { turnOn: false } });
      try { noteOf(k, checkAnswer(await post('/api/diagnose/action', { kind: a.kind, id: a.id }), a.kind)); }
      catch (e) { noteOf(k, `Not done: ${e.message}`); }
    } else if (a.kind === 'get-layout') {
      noteOf(k, 'Getting layout…');
      if (isDemo()) return demoDone(k, 'layout saved.');
      const j = await post('/api/via-fetch', { vid: a.vid, pid: a.pid }).catch((e) => ({ error: e.message }));
      noteOf(k, j.ok ? `Saved. Restart DeviceHub to show its keys.` : `Not saved. ${j.error || ''}`.trim());
      if (j.ok) { delete st.layoutAsked[k]; askLayouts(st.summary); }
    } else if (a.kind === 'close-app') {
      noteOf(k, 'Closing…');
      if (isDemo()) { st.confirm[k] = false; st.over[k] = { live: { status: 'connected' } }; return noteOf(k, 'Demo: closed and connected.'); }
      try {
        const j = await post('/api/diagnose/action', { kind: 'close-app', app: a.app, confirm: true });
        noteOf(k, j.note || (j.closed?.length ? 'Closed. Connecting…' : 'Nothing to close.'));
        delete st.diag[a.id]; delete st.diagKey[a.id];
        setTimeout(() => connect(a.id, false).catch(() => {}), 3000);
      } catch (e) { noteOf(k, `Not closed: ${e.message}`); }
      st.confirm[k] = false;
    } else if (a.kind === 'settings') {
      if (isDemo()) return noteOf(k, 'Demo: opens Windows Settings.');
      await post('/api/diagnose/action', { kind: 'settings', page: a.page }).then(() => noteOf(k, 'Windows Settings is open.'), (e) => noteOf(k, `Not opened: ${e.message}`));
    } else if (a.kind === 'eq-on') {
      if (isDemo()) return demoDone(k, 'tick the headset, click OK, restart.');
      noteOf(k, 'Click Yes in Windows\' prompt (taskbar shield).');   // in place while Windows asks (helpers/uac.mjs)
      await post('/api/eq/turn-on').then(() => noteOf(k, 'Tick the headset, click OK, then restart the PC.'), (e) => noteOf(k, `Not opened: ${e.message}`));
    } else if (a.kind === 'find-lights') {
      noteOf(k, 'Looking for lights…');
      if (isDemo()) { st.orgb = { running: true, bundled: true, controllers: [{ name: 'Razer Basilisk V3' }, { name: 'Corsair HS80 receiver' }] }; return noteOf(k, 'Demo: 2 pretend lights found.'); }
      try { st.orgb = await get('/api/openrgb?fresh=1'); noteOf(k, st.orgb.running ? null : `No lights found: ${st.orgb.reason || 'OpenRGB did not start'}.`); }
      catch (e) { noteOf(k, `Not found: ${e.message}`); }
    }
  } finally { delete st.busy[k]; redraw(); }
}

// Set it all up (it was Do all): the safe steps in order, one line per device (core/setup-list.js doAllSteps)
// close: the makers' apps the person said Yes to (makerApps); left: the ones they said Not now to
async function doAll(steps, rows, { close = [], left = [] } = {}) {
  st.all = { busy: true, lines: ['Working…'] }; redraw();
  const lines = left.flatMap(leftLine);
  if (close.length) {
    steps = [...steps];
    for (const a of close) {
      if (isDemo()) {
        lines.push(`${a.name}: closed (demo).`);
        for (const k of a.keys) { st.confirm[k] = false; st.over[k] = { live: { status: 'connected' } }; st.note[k] = 'Demo: closed and connected.'; }
        continue;
      }
      try {
        // diagnose's own action: only a known maker's app, never a Windows service or an updater, with the confirm flag
        const j = await post('/api/diagnose/action', { kind: 'close-app', app: a.app, confirm: true });
        lines.push(j.note ? `${a.name}: ${j.note}.` : `${a.name}: closed.`);
      } catch (e) { lines.push(`${a.name}: not closed: ${e.message}`); }
      for (const id of a.ids) { delete st.diag[id]; delete st.diagKey[id]; st.confirm[id] = false; }
      st.all = { busy: true, lines: [...lines, 'Working…'] }; redraw();
    }
    if (!isDemo()) {
      const ids = close.flatMap((a) => a.ids);
      setTimeout(() => ids.forEach((id) => connect(id, false).catch(() => {})), 3000);
      await connected(ids, 15000);
      // a closed app's device that waits for Turn on settings gets it too
      if (ids.some((id) => devices[id]?.adapter?.library?.turnOn === true) && !steps.some((s) => s.kind === 'turn-on-all')) steps.push({ kind: 'turn-on-all' });
    }
  }
  for (const s of steps) {
    if (s.kind === 'install') {
      if (isDemo()) { lines.push(`${s.title}: installed (demo).`); st.note[s.key] = 'Demo: installed.'; st.over[s.key] = { status: 'done', action: null }; continue; }
      try { const j = await post('/api/library/install', { name: s.name }); lines.push(`${s.title}: installed.${j.loaded ? '' : ' Restart DeviceHub to load it.'}`); st.note[s.key] = 'Installed.'; }
      catch (e) { lines.push(`${s.title}: not installed: ${e.message}`); }
    } else if (s.kind === 'turn-on-all') {
      // Turn on settings for all (helpers/turn-on-all.mjs): each waiting, connected device in turn, as its own button does
      if (isDemo()) {
        // the same answers turn-on-all gives: each waiting device in turn, a device that is not connected left for later
        for (const r of rows.filter((x) => x.status === 'needs' && x.id && x.driver === 'library' && x.action?.kind !== 'close-app')) {
          const on = r.action?.kind === 'turn-on';
          const line = on ? `${r.title}: settings on, 6 of 6 passed (demo).` : `${r.title}: not connected, skipped.`;
          lines.push(line); st.note[r.key] = line;
          if (on) st.over[r.key] = { status: 'done', action: null, live: { ...st.over[r.key]?.live, turnOn: false } };
        }
        continue;
      }
      try {
        const j = await post('/api/diagnose/action', { kind: 'turn-on-all' });
        const res = j.results || [];
        for (const x of res) { lines.push(x.line); st.note[x.id] = x.line; }
        if (!res.length) lines.push(j.line || 'Turn on settings: no device was waiting.');
      } catch (e) { lines.push(`Turn on settings: not done: ${e.message}`); }
    } else if (s.kind === 'get-layout') {
      if (isDemo()) { lines.push(`${s.title}: layout saved (demo).`); st.note[s.key] = 'Demo: layout saved.'; st.over[s.key] = { status: 'done', action: null }; continue; }
      const j = await post('/api/via-fetch', { vid: s.vid, pid: s.pid }).catch((e) => ({ error: e.message }));
      lines.push(j.ok ? `${s.title}: saved ${j.file}. Restart DeviceHub to show its keys.` : `${s.title}: layout not saved. ${j.error || ''}`.trim());
      st.note[s.key] = lines[lines.length - 1];
      if (j.ok) delete st.layoutAsked[s.key];
    }
    st.all = { busy: true, lines: [...lines, 'Working…'] }; redraw();
  }
  st.all = { busy: false, lines: lines.length ? lines : ['Nothing to do.'] };
  if (!isDemo()) loadSummary();
  askLayouts(st.summary);
  redraw();
}

// the devices an app held, connected again (or the time is up): checked twice a second, only after the Yes click
async function connected(ids, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && ids.some((id) => devices[id] && devices[id].status !== 'connected')) await new Promise((r) => setTimeout(r, 500));
}

// what each device can do now, from its driver's settings and readings (core/setup-list.js canDo)
function devInfo(id, live) {
  const d = devices[id];
  if (!d?.adapter) return live?.[id] || null;
  const a = d.adapter;
  let lights = false;
  try { lights = !!a.hasLighting?.(); } catch {}
  const keys = [];
  if (a.session?.keymap) keys.push('key:');
  if (a.session?.macros?.list?.length) keys.push('macro:');
  return { values: d.values, settings: Array.isArray(a.settings) ? a.settings : null, battery: d.battery?.percent != null || !!(a.plugin && a.battery), lights, keys };
}
// the "You're all set" view: each device as a tile with what it can do now; a tile opens its page
function canTile(r, live) {
  const page = r.action?.kind === 'open' ? r.action.page : r.id;
  return h('button', { class: 'su-can-tile', dataset: { key: r.key }, onclick: () => { if (page) location.hash = `#/${page}`; } },
    icon(TILE_ICON[r.kind] || 'plug'),
    h('span', { class: 'su-can-text' }, h('b', {}, r.title), h('small', {}, canDo(r, devInfo(r.id, live)))));
}

// the one control a row has
function control(r) {
  const a = r.action, k = r.key;
  if (!a) return null;
  const busy = !!st.busy[k];
  switch (a.kind) {
    case 'open': return button('Open', () => { location.hash = `#/${a.page}`; }, { kind: 'ghost small' });
    case 'install': return button('Install', () => runOne(r), { kind: 'primary small', ic: 'plus', disabled: busy });
    case 'turn-on': return button('Turn on settings', () => runOne(r), { kind: 'primary small', ic: 'plug', disabled: busy });
    case 'check-again': return button('Check again', () => runOne(r), { kind: 'ghost small', ic: 'search', disabled: busy });
    case 'get-layout': return button('Get layout', () => runOne(r), { kind: 'primary small', disabled: busy });
    case 'learn': return button(a.vid ? 'Learn it for me' : 'Learn a device', async () => { if (a.vid) (await import('./learn.js')).learnThis(a.vid, a.pid, { start: true }); location.hash = '#/learn'; }, { kind: 'ghost small', ic: 'plug' });
    case 'request': return getHelp(`request:${a.vid}:${a.pid}`, null, { label: 'Request support', request: { vid: a.vid, pid: a.pid, name: a.name || '' }, kind: 'ghost small' });
    case 'works': return worksReport(devices[a.id] || { id: a.id, adapter: {} });
    case 'settings': return button(a.label || 'Open', () => runOne(r), { kind: 'ghost small', ic: 'external' });
    case 'eq-on': return button('Turn it on', () => runOne(r), { kind: 'primary small' });
    case 'find-lights': return button('Find lights', () => runOne(r), { kind: 'small', ic: 'refresh', disabled: busy });
    case 'tool': return installerInline(a.id, { redraw, onDone: () => loadTools(true) });
    case 'board-lights': return boardLights({ redraw, onDone: () => { boardLightsStatus(true).then((b) => { st.board = b; redraw(); }); if (!isDemo()) get('/api/openrgb').then((o) => { st.orgb = o; redraw(); }, () => {}); } });
    case 'close-app': {
      // asked once more, in place (the same action as the device page's)
      if (!st.confirm[k]) return button(a.label, () => { st.confirm[k] = true; redraw(); }, { kind: 'primary small' });
      return h('div', { class: 'su-confirm' }, h('small', {}, a.confirm || `${a.label}?`),
        button('Yes, close it', () => runOne(r), { kind: 'primary small', disabled: busy }),
        button('Cancel', () => { st.confirm[k] = false; redraw(); }, { kind: 'ghost small' }));
    }
    default: return null;
  }
}

// one short line and one button
function rowEl(r) {
  return h('li', { class: `su-item su-${r.status}`, dataset: { key: r.key } },
    h('div', { class: 'su-text' }, h('b', {}, r.title), h('small', {}, st.note[r.key] || r.line)),
    h('div', { class: 'su-ctl' }, control(r), rowHelp(r)));
}
// Get help on a row that needs you (area setup, 22 Oct 2026): the row, what it says now, and its device when it has one;
// not on a Request support row (that is its own one-click request)
function rowHelp(r) {
  if (r.status !== 'needs' || r.action?.kind === 'request') return null;
  return helpHere('setup', { key: `help:setup:${r.key}`, device: r.id || '', context: () => ({ item: r.title, status: st.note[r.key] || r.line || '' }) });
}
// the demo's answers stay on their rows
const applyOver = (rows) => rows.map((r) => { const o = st.over[r.key]; if (!o) return r; const x = { ...r, ...o }; if (o.action === null) delete x.action; delete x.live; return x; });

// a device's tile: its icon, its name, and a check or "Needs you"; one that needs you opens its button under the strip
const TILE_ICON = { mouse: 'mouse', headset: 'headset', keyboard: 'keyboard', monitor: 'monitor', camera: 'camera' };
function tile(r) {
  const needs = r.status === 'needs', open = st.tile === r.key;
  const go = () => { if (needs) st.tile = open ? null : r.key; else if (r.action?.kind === 'open') { location.hash = `#/${r.action.page}`; return; } redraw(); };
  return h('button', { class: `su-tile${needs ? ' needs' : ''}${open ? ' open' : ''}`, dataset: { key: r.key }, 'aria-expanded': needs ? String(open) : null, onclick: go },
    icon(TILE_ICON[r.kind] || 'plug'), h('span', { class: 'su-tile-name' }, r.title),
    needs ? h('span', { class: 'su-tile-st' }, 'Needs you') : icon('check', 'ic su-tick'));
}
// What Setup would show, worked out the same way as the page (none of it drawn): null until its sources have answered
function planNow() {
  const live = liveDevices();
  askDiagnose(live);
  if (st.summary) askLayouts(st.summary);
  if (st.summary === undefined) return null;
  const devRows = applyOver(deviceRows(st.summary, { live, diag: st.diag, layouts: st.layouts, isVia }));
  const all = [
    ...devRows,
    ...applyOver(soundRows(st.tools?.find((t) => t.id === 'eqapo'), st.eq)),
    ...applyOver(lightRows(st.orgb, st.summary, st.lightsDiag, st.board)),
    ...batteryRows(st.bt),
    ...applyOver(learnRows(st.tools?.find((t) => t.id === 'usbpcap'), devRows)),
  ];
  return { live, devRows, plan: planSetup(all) };
}

// Is this PC fully set up? (23 Oct 2026, Shawn: "put the set up area in settings when its fully set up like mine
// currently is, I need the app to recognize when it is and isnt fully set up"). The number of things that need the
// person, from the same rows the page shows: null while its sources are still answering. Read in the background when
// DeviceHub's window opens and again every 5 minutes, and at once when a device connects or drops. watch(fn) is told
// when the answer may have changed; it returns a function that stops it.
let bgAt = 0, lastLive = null;
export function setupNeeds({ refresh = false } = {}) {
  // nothing read in the first 45 s (27 Oct 2026, Shawn: Monitors and Wallpapers opened slowly: this check's ~7 slow
  // reads ran at once when the window opened, and every page waited behind them); the Setup page loads at once itself
  if (Date.now() - pageOpenedAt < 45000) { if (!graceTimer) graceTimer = setTimeout(() => { for (const w of watchers) try { w(); } catch {} }, 46000); return null; }
  const sig = liveSig();
  if ((st.summary === undefined && !summaryPending) || (refresh && Date.now() - st.loadedAt > 30000) || Date.now() - st.loadedAt > 5 * 60000) {
    bgAt = Date.now(); lastLive = sig;
    load();
  } else if (sig !== lastLive && Date.now() - bgAt > 30000) {
    // a device connected, dropped or fell asleep: only the device summary is read again (26 Oct 2026, idle CPU: a mouse
    // going to sleep and waking re-read all seven, Bluetooth, OpenRGB and lights included, every 15 s on the Overview)
    bgAt = Date.now(); lastLive = sig;
    loadSummary();
  }
  // no number while the devices are still connecting after DeviceHub starts (24 Oct 2026, Shawn: "why is set up randomly
  // appearing when everything is already set up on my pc?": for a few seconds a device not yet answering counted)
  const p = planNow();
  return p ? p.plan.needs.length : null;
}
// the window's open, not this file's load: the window loads it 46 s in, or when Setup is opened (27 Oct 2026, app.js)
const pageOpenedAt = performance.timeOrigin;
let graceTimer = null;
export function watchSetup(fn) { watchers.add(fn); return () => watchers.delete(fn); }

function fold(key, title, rows) {
  if (!rows.length) return null;
  return h('details', { class: 'panel su-fold', open: st.fold[key] || null, ontoggle: (e) => { st.fold[key] = e.target.open; } },
    h('summary', {}, title), h('ul', { class: 'su-list' }, ...rows.map(rowEl)));
}

export default {
  id: 'setup', title: 'Setup', icon: 'check',
  // a reading never redraws the page; a device connecting, dropping or having its settings turned on does
  keepAlive(id) {
    if (id === 'activity') return true;
    return liveSig() === lastSig;
  },
  render({ fresh, redraw: r }) {
    redrawPage = r;
    if ((st.summary === undefined && !summaryPending) || (fresh && Date.now() - st.loadedAt > 5000)) load();
    lastSig = liveSig();
    const now = planNow();
    const live = now?.live || liveDevices();
    const devRows = now ? now.devRows : null;
    const demo = isDemo() ? h('p', { class: 'su-fine' }, 'Demo mode: nothing is changed.') : null;
    if (devRows === null) return h('div', { class: 'setup-page' }, topbar('', 'Setup', null), demo, h('section', { class: 'panel su-status' }, skeleton([40, 62])));

    const plan = now.plan;
    const n = plan.needs.length;
    if (st.tile && !plan.devices.some((x) => x.key === st.tile && x.status === 'needs')) st.tile = null;
    const openTile = st.tile && plan.devices.find((x) => x.key === st.tile);

    // the status line, and Set it all up only when there is a safe step to take
    const steps = doAllSteps(devRows);
    // the makers' apps holding a device: Set it all up asks about them once, in place, before anything else
    const apps = makerApps(plan.needs);
    if (!apps.length) st.ask = false;
    const can = steps.length || apps.length;
    const lines = st.all ? h('div', { class: 'su-lines' }, ...st.all.lines.map((l) => h('small', {}, l))) : null;
    const ask = st.ask && !st.all?.busy ? h('div', { class: 'su-confirm su-ask' },
      h('div', { style: { marginBottom: '8px' } },
        h('b', {}, askLine(apps)),
        h('small', { class: 'faint', style: { display: 'block', marginTop: '3px' } }, 'Closing vendor software lets DeviceHub access your hardware directly. You can also choose "Not now" to leave them running.')),
      h('div', { class: 'actions' },
        button('Yes, close them', () => { st.ask = false; doAll(steps, devRows, { close: apps }); }, { kind: 'primary small' }),
        button('Not now', () => { st.ask = false; doAll(steps, devRows, { left: apps }); }, { kind: 'ghost small' }))) : null;
    const status = n ? h('section', { class: 'panel su-status' },
      h('div', { class: 'su-status-top' },
        icon('plug'),
        h('div', { class: 'su-text' },
          h('h2', {}, summaryLine(n)),
          h('small', {}, st.all?.busy ? 'Working…' : !can ? ''
            : apps.length ? 'Asks before closing any app.'
              : 'Runs the safe steps only.')),
        can && !st.all?.busy && !st.ask ? button('Set it all up', () => { if (apps.length) { st.ask = true; redraw(); } else doAll(steps, devRows); }, { kind: 'primary', ic: 'check' }) : null),
      ask, lines)
      // nothing needs you: You're all set, each device with what it can do now (no button needed)
      : h('section', { class: 'panel su-status all-set su-allset' },
        h('div', { class: 'su-status-top' }, icon('check'),
          h('div', { class: 'su-text' }, h('h2', {}, "You're all set"),
            h('small', {}, plan.devices.length ? 'Open a device to change it.' : 'No devices yet.'))),
        plan.devices.length ? h('div', { class: 'su-can' }, ...plan.devices.map((r) => canTile(r, live))) : null,
        lines);

    return h('div', { class: 'setup-page' },
      topbar('', 'Setup', null, button('Back to Settings', () => { location.hash = '#/settings'; }, { kind: 'ghost small' })),
      demo,
      status,
      n ? h('section', { class: 'panel su-section su-todo' }, h('ul', { class: 'su-list' }, ...plan.needs.map(rowEl))) : null,
      n && plan.devices.length ? h('section', { class: 'panel su-section su-devices' },
        h('header', { class: 'panel-head' }, h('h2', {}, 'Your devices')),
        h('div', { class: 'su-tiles' }, ...plan.devices.map(tile)),
        openTile ? h('ul', { class: 'su-list su-tile-open' }, rowEl(openTile)) : null) : null,
      // the two checks for each device (public/ui/device-checks.js), at the end of setup
      deviceChecks({ redraw }),
      fold('extras', 'Optional extras', plan.extras),
      fold('done', `Done (${plan.done.length})`, plan.done));
  },
};
let lastSig = null;
