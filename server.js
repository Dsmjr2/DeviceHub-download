// DeviceHub local server: serves the dashboard on http://localhost:5577 (localhost counts as a
// secure context, so WebHID works in Chrome/Edge), writes settings backups to ./backups, and
// launches vendor apps. Binds to 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const { writeAtomic } = require('./helpers/safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
// first, before any module reads one: this PC's files from beside the app into data\ and the log into logs\, once
// (27 Oct 2026, helpers/data-migrate.js; a start with nothing to move does nothing). Never in an isolated copy: one
// started from the real folder (tests/regressions.mjs) moved the running app's files from under it on 27 Oct.
if (process.env.DEVICEHUB_ISOLATED !== '1') require('./helpers/data-migrate').migrate();
const { dataFile, logFile } = require('./helpers/data-dir');
const { spawn, execFile } = require('child_process');
// a library or learned driver's stray error (an unhandled rejection, a throw from its timer) is logged and its device
// marked failed instead of ending the server; DeviceHub's own errors still exit with code 1 (helpers/driver-guard.js)
require('./helpers/driver-guard').install();

const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;  // a test copy can use another port
// ISOLATED TEST MODE (DEVICEHUB_ISOLATED=1, 22 Oct 2026; docs/handoff/isolated-mode.md): a second copy beside the real
// one that touches no device and no Windows setting. No iCUE, native helper, agent, tray, OpenRGB, DDC/CI, cameras,
// Equalizer APO, startup shortcut, settings sync or updates; the window runs in demo mode and every /api route that
// would reach any of those answers from isolatedApi() below. Needs its own DEVICEHUB_PORT (never 5577).
const ISOLATED = process.env.DEVICEHUB_ISOLATED === '1';
if (ISOLATED && (!process.env.DEVICEHUB_PORT || PORT === 5577)) { console.log('[isolated] DEVICEHUB_ISOLATED=1 needs DEVICEHUB_PORT set to a free port other than 5577'); process.exit(5); }
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const BACKUPS = path.join(ROOT, 'backups');
const PROFILES = dataFile('profiles.json', ROOT);
const ACTIVITY = dataFile('activity.jsonl', ROOT);
const SETTINGS = dataFile('settings.json', ROOT);
// A data file that does not parse (a power cut mid-save, a disk hiccup) is moved aside, kept, and DeviceHub carries on
// with an empty one, instead of failing on every request until someone repairs it by hand (20 Oct 2026)
function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(text.replace(/^﻿/, '')); }
  catch {
    const kept = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(file, kept); } catch {}
    try { serverLog({ kind: 'bad', text: `${path.basename(file)} was damaged and could not be read; a copy is kept as ${path.basename(kept)}, and DeviceHub started a new one` }); } catch {}
    console.log(`[files] ${path.basename(file)} did not parse; moved to ${path.basename(kept)}`);
    return fallback;
  }
}
fs.mkdirSync(BACKUPS, { recursive: true });

// Vendor apps the dashboard may open. Fixed list: the browser can only name a key, never a path.
const VENDOR_APPS = {
  icue: 'C:\\Program Files\\Corsair\\Corsair iCUE5 Software\\iCUE.exe',
  pulsar: 'C:\\Program Files\\Pulsar\\cMouse\\Sys64\\Pulsar.exe',
};
const VENDOR_URLS = {
  via: 'https://usevia.app/',
  epomaker: 'https://hub.epomaker.com/',
  pulsarDownload: 'https://www.pulsar.gg/pages/download-xlite-wireless',
  epomakerFirmware: 'https://epomaker.com/blogs/firmware/epomaker-p75-firmware',
};

let corsair = null;
const icueEq = require('./helpers/icue-eq');
// Windows' sound devices for Equalizer APO's Device lines: the headset's outputs and mic (both connections) and every
// other speaker; looked up once a minute
let eqDev = null, eqDevAt = 0;
const guidOf = (id) => id.slice(id.indexOf('}.') + 2);
async function eqDevices() {
  if (eqDev && Date.now() - eqDevAt < 60000) return eqDev;
  try {
    // the HS80's sound devices; with no HS80, any other USB headset Windows has (20 Oct 2026: its EQ, mic boost and mic
    // filters work without DeviceHub knowing its maker). DEVICEHUB_HEADSET_GENERIC=1 treats the HS80 as unknown, to
    // test that route on a real headset.
    const generic = process.env.DEVICEHUB_HEADSET_GENERIC === '1';
    let hs = generic ? [] : (await corsair.handle('hs80-endpoints', {})).endpoints, headsetModel = hs.length ? 'HS80' : null;
    if (!hs.length) {
      // (a wired headset on the jack only when picked: helpers/headset-pick-eq.js applies the pick)
      const g = ((await corsair.handle('usb-headsets', {})).headsets || []).find((x) => !/^JACK_/.test(x.usb) && (generic || !/^VID_1B1C&PID_0A6/.test(x.usb)));
      if (g) { hs = [...g.playback.map((e) => ({ flow: 'playback', id: e.id })), ...g.recording.map((e) => ({ flow: 'recording', id: e.id }))]; headsetModel = g.device || g.usb; }
    }
    const headset = hs.filter((e) => e.flow === 'playback').map((e) => guidOf(e.id)), mic = hs.filter((e) => e.flow === 'recording').map((e) => guidOf(e.id));
    const outs = (await corsair.handle('outputs', {})).outputs;
    const speakers = outs.map((o) => ({ guid: guidOf(o.id), name: o.name.replace(/\s*\(.*\)\s*$/, '') || o.name })).filter((o) => !headset.includes(o.guid));
    // other mics: named by their maker, e.g. "CameraMic (Anker PowerConf C200)" -> "AnkerCamera" (Shawn's name for it)
    const mics = (await corsair.handle('audio-list', { match: '(' })).endpoints.filter((m) => m.flow === 'recording' && !mic.includes(guidOf(m.id)))
      .map((m) => { const inner = /\(([^)]*)\)/.exec(m.name)?.[1]; const maker = (inner || m.name).split(/[\s-]+/)[0]; return { guid: guidOf(m.id), name: /camera/i.test(m.name) ? `${maker}Camera` : `${maker} mic`, kind: 'mic' }; });
    eqDev = { headset, mic, speakers, mics, headsetModel }; eqDevAt = Date.now();
  } catch { eqDev = eqDev || { headset: [], mic: [], speakers: [], mics: [] }; }
  return eqDev;
}
const ankerGuard = require('./helpers/anker-guard');
const settingsSync = require('./helpers/settings-sync');
const monitors = require('./helpers/monitors');
// (27 Oct 2026, memory and start-up) the wallpapers and the setup extras are made on the first request that uses them
// (/api/wallpapers, /api/setup-extras), not at start; the same objects after that
let wallpapersMade = null, setupExtrasMade = null;
const wallpapers = () => (wallpapersMade ||= require('./helpers/wallpapers').create({ root: ROOT }));
const setupExtras = () => (setupExtrasMade ||= require('./helpers/setup-extras').create({ root: ROOT, wallpapers: wallpapers() }));
if (!ISOLATED) monitors.start(require('./helpers/native'), BACKUPS, (text, bad) => serverLog({ kind: bad ? 'bad' : 'good', text }));  // the last: changes made while a monitor was off, applied
const camera = require('./helpers/camera');
if (!ISOLATED) camera.start(require('./helpers/native'), BACKUPS);
let openWindows = 0;
let pointerBackupAt = 0;   // when the Windows pointer settings were last backed up (/api/pointer)
// the slow reads' last answers (Bluetooth, the optional tools, OpenRGB, board lights) kept on disk across restarts
// (helpers/last-answer.js; read-cache\ is gitignored); not in a test or the isolated copy
if (!ISOLATED && process.env.DEVICEHUB_TEST !== '1') require('./helpers/last-answer').useDisk(path.join(ROOT, 'read-cache'));
const pcMap = require('./helpers/pc-map');
const openrgb = require('./helpers/openrgb');
// DeviceHub's own devices are never written through OpenRGB as well (its location names their vendor:product)
if (!ISOLATED) openrgb.start(BACKUPS, { ownDevice: new RegExp(Object.keys(pcMap.RUNS).map((id) => { const [v, p] = id.split(':'); return `vid_${v}&pid_${p}`; }).join('|'), 'i'), namesFile: dataFile('lights-names.json', ROOT) });
const eqapo = require('./helpers/eqapo')(icueEq, eqDevices, path.join(__dirname, 'backups'));
let eqBusy = false;
const updates = require('./helpers/updates');
const audioFollow = require('./helpers/audio-follow');
const receiverLight = require('./helpers/receiver-light');
const batteryHistory = require('./helpers/battery-history');
updates.init(ROOT);
// Activity entries from the server itself: through the agent when it runs (open windows see them at once).
// Backups: one is written before every change. Old ones are no longer deleted here (until 20 Oct 2026 a device's file
// older than 14 days and outside its newest 400 was deleted, which would in time have removed the first backup too):
// helpers/backup-tidy.js moves them into backups\older-backups.zip and keeps the first of each kind.
function pruneBackups() {}

// Activity history: the app shows the newest 200; the file keeps the newest 2000 (trimmed once at start).
try {
  const lines = fs.existsSync(ACTIVITY) ? fs.readFileSync(ACTIVITY, 'utf8').split('\n').filter(Boolean) : [];
  if (lines.length > 2000) writeAtomic(ACTIVITY, lines.slice(-2000).join('\n') + '\n');
} catch (e) { console.error('[activity] trim', e.message); }

function serverLog(e) {
  if (agent) return agent.op('log', e).catch(() => {});
  fs.appendFileSync(ACTIVITY, JSON.stringify({ at: new Date(), ...e }) + '\n');
}
if (!ISOLATED) try { corsair = require('./helpers/corsair'); } catch (e) { console.log('[corsair] helper not loaded:', e.message); }
// Mic boost without iCUE (20 Oct 2026): with Equalizer APO installed and the headset mic found, the boost is a gain on
// the mic in DeviceHub's own Equalizer APO settings (helpers/eqapo.js); otherwise iCUE's setting as before
if (corsair) corsair.setBoostVia({
  ready: async () => { try { const r = await eqapo.read(); return !!(r.available && r.engine === 'eqapo' && r.micFound); } catch { return false; } },
  read: async () => ({ available: true, db: (await eqapo.read()).extras.micBoost || 0, via: 'eqapo' }),
  set: async (db) => {
    if (!Number.isInteger(db) || db < 0 || db > 10) throw new Error('mic boost must be 0-10 dB');
    const r = await eqapo.setExtras({ micBoost: db });
    if (r.extras.micBoost !== db) throw new Error(`Equalizer APO's settings read ${r.extras.micBoost} dB after setting ${db}`);
    return { db: r.extras.micBoost };
  },
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

// tasklist is fast (~0.1 s); with windows=true, PowerShell also returns window titles (for the picker).
function runningPrograms(withWindows) {
  return new Promise((resolve) => {
    if (withWindows) {
      execFile('powershell', ['-NoProfile', '-Command', 'Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName).exe`t$($_.MainWindowTitle)" }'], { windowsHide: true, timeout: 8000 }, (err, out) => {
        resolve((out || '').split(/\r?\n/).filter(Boolean).map((l) => { const [exe, title] = l.split('\t'); return { exe, title }; }));
      });
    } else {
      // from the helper that already runs (26 Oct 2026, idle CPU: auto-switch looks every 10 s, and each tasklist cost
      // ~170 ms of CPU); tasklist only when the helper cannot answer (it is restarting, or an older helper)
      if (corsair) {
        corsair.handle('procs', {}).then((r) => { if (Array.isArray(r.names)) resolve(r.names); else throw new Error('no names'); }).catch(() => tasklist());
        return;
      }
      tasklist();
    }
    function tasklist() {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 }, (err, out) => {
        resolve([...new Set((out || '').split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '')).filter(Boolean))]);
      });
    }
  });
}

// A fingerprint of the app's files: open windows reload themselves when it changes.
function appVersion() {
  let h = 0;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else { const s = fs.statSync(p); h = (h * 31 + s.mtimeMs + s.size) % 2147483647; }
    }
  };
  walk(PUBLIC);
  return h.toString(36);
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function makeShortcut(lnk) {
  // every path in single quotes with its apostrophes doubled (20 Oct 2026: a user folder like O'Brien broke it)
  const q = (s) => s.replace(/'/g, "''");
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${q(lnk)}');$s.TargetPath="$env:WINDIR\\System32\\wscript.exe";$s.Arguments='"${q(path.join(ROOT, 'DeviceHub.vbs'))}" /background';$s.WorkingDirectory='${q(ROOT)}';$s.IconLocation='${q(path.join(ROOT, 'DeviceHub.ico'))},0';$s.Save()`;
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 10000 }, (e) => (e ? reject(e) : resolve())));
}

const safeName = (s) => String(s || 'device').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);

const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

// Isolated test mode only (DEVICEHUB_ISOLATED=1): answers every route that would reach a device, the native helper,
// iCUE, OpenRGB, Equalizer APO, Windows (sound, pointer, startup, processes, PnP/WMI reads), GitHub or another program,
// and returns true. The routes left to api() read or write only files in this copy's own folder.
const ISOLATED_PASS = new Set(['/api/version', '/api/windows', '/api/backup', '/api/backups', '/api/activity', '/api/settings', '/api/profiles', '/api/vendor-apps', '/api/quit', '/api/supported-devices']);
// DEVICEHUB_ISOLATED_READS=1 as well (26 Oct 2026, docs/handoff/helper-reads.md): also these read-only GETs, to time
// them and count the programs they start beside the real copy; they reach the native helper only on its pc:<op>
// channels, which open no device (/api/helper-calls then shows the real request counts)
const ISOLATED_READS = ISOLATED && process.env.DEVICEHUB_ISOLATED_READS === '1' ? new Set(['/api/pc-check', '/api/temps', '/api/display', '/api/bluetooth', '/api/installers', '/api/pc', '/api/gpu']) : null;
if (ISOLATED_READS) require('./helpers/native').start();   // the helper the reads ask (the real copy starts it for its devices)
function isolatedApi(req, res, url) {
  const p = url.pathname;
  if (ISOLATED_READS && req.method === 'GET' && ISOLATED_READS.has(p)) return false;
  if (ISOLATED_READS && req.method === 'GET' && p === '/api/helper-calls') { send(res, 200, { uptimeS: Math.round(process.uptime()), calls: require('./helpers/native').callCounts(), reads: require('./helpers/helper-reads').stats() }); return true; }
  if (ISOLATED_PASS.has(p) || (p.startsWith('/api/backups/') && req.method === 'GET')
    || ((p === '/api/wallpapers/starters' || p === '/api/wallpapers/starter') && req.method === 'GET')) return false;  // the shipped starter wallpapers, read-only (demo shows them)
  res.setHeader('X-DeviceHub-Isolated', '1');   // every answer from here (tests/isolated.mjs checks it)
  const m = process.memoryUsage();
  const demo = {
    '/api/agent-config': { agent: false, ready: false, isolated: true },
    '/api/health': { uptimeS: Math.round(process.uptime()), serverMB: +(m.rss / 1048576).toFixed(0), heapMB: +(m.heapUsed / 1048576).toFixed(0), helperMB: null, crashes24h: 0, lastCrashAt: null, lastProblem: null, backups: { count: 0, mb: 0 }, isolated: true },
    '/api/setups': [], '/api/monitors': [], '/api/cameras': [], '/api/power': { saver: false, isolated: true },
    '/api/startup': { enabled: false, isolated: true }, '/api/processes': [], '/api/games': [], '/api/game-mode': { games: [], status: null }, '/api/game-mode/installed': [],
    '/api/battery-estimate': {}, '/api/helper-calls': { uptimeS: Math.round(process.uptime()), calls: {} },
    '/api/settings-sync': { isolated: true, on: false }, '/api/auto-report': { isolated: true, on: true, configured: false, owner: false, active: false }, '/api/self-update': { isolated: true, count: 0 }, '/api/publish-release': { owner: false }, '/api/driver-share': { choice: null, owner: true }, '/api/self-update/progress': {},
    '/api/updates': { isolated: true, apps: [] }, '/api/openrgb': { running: false, isolated: true, controllers: [] }, '/api/openrgb/find': { running: false, isolated: true },
    '/api/board-lights': { isolated: true, pawnio: { installed: false, version: null }, setUp: false, task: false, copy: false, canSetUp: false, why: 'DeviceHub is in isolated test mode', partial: null, before: '', remove: '', busy: false },
    '/api/cpu-sensors': { isolated: true, pawnio: { installed: false, version: null }, setUp: false, task: false, copy: false, canSetUp: false, why: 'DeviceHub is in isolated test mode', partial: null, before: [], remove: [], busy: false },
    '/api/wifi-pause': { isolated: true, setUp: false, task: false, copy: false, canSetUp: false, why: 'DeviceHub is in isolated test mode', partial: null, show: false, inUse: false, scans: 'normal', paused: null, gaming: false, busy: false, before: '', remove: '' },
    '/api/lights/diagnose': { isolated: true, board: null, openrgb: { state: 'unknown' }, found: [], seen: [], verdict: null, problems: [], lines: [] },
  };
  if (req.method === 'GET' && p in demo) { send(res, 200, demo[p]); return true; }
  send(res, 503, { error: 'DeviceHub is in isolated test mode: it does not touch devices or Windows settings', isolated: true });
  return true;
}

// the memory DeviceHub's own window uses (26 Oct 2026, Shawn: Health said 131 MB while the window alone used ~600 MB):
// every Chrome/Edge process started with its window-profile folder, private memory, read at most once a minute
let winMem = { at: 0, mb: null };
function windowMemory() {
  if (Date.now() - winMem.at < 60000) return Promise.resolve(winMem.mb);
  winMem.at = Date.now();
  const ps = "$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*DeviceHub*window-profile*' }; if ($p) { [math]::Round((($p | Measure-Object PrivatePageCount -Sum).Sum) / 1MB) }";
  return new Promise((resolve) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (e, out) => {
    const n = Number(String(out || '').trim());
    winMem.mb = !e && n > 0 ? n : null;
    resolve(winMem.mb);
  }));
}
// the Publish button's run (helpers/publish-release.ps1, hidden): running / done / failed, with its step
let publishRun = null;
// a signed new version found by the one check after start (helpers/update-notice.mjs); the window asks Update or Later
let updateNotice = null;
// The window's one live stream, GET /api/events (helpers/window-events.js; 27 Oct 2026, Shawn: the open window asked
// ~126 times in 10 minutes doing nothing): a new version, the battery saver, a new backup and the update notice are
// pushed when they change, beside the agent's device events, so the window polls none of them
const windowEvents = require('./helpers/window-events');
const hub = windowEvents.createHub();
// the Overview's GPU chip on the stream, read only while a window shows it (helpers/gpu-watch.js); each stream has an id
const gpuWatch = require('./helpers/gpu-watch').createGpuWatch({ read: () => require('./helpers/gpu').read() });
const streams = new Map();   // id -> res
let streamSeq = 0;
let pushedVersion = null, pushedBackup = null;
const helloNow = () => {
  pushedVersion = appVersion(); pushedBackup = windowEvents.lastBackupAt(BACKUPS);
  return { version: pushedVersion, saving: !!require('./helpers/power').state().saving, backupAt: pushedBackup, notice: updateNotice };
};
// what the server does once Update has the new version: a copy from the zip is already being installed (its installer
// quits and restarts DeviceHub); a git copy restarts with code 3
function afterSelfUpdate(r) {
  if (r.installing) serverLog({ kind: 'good', text: `Installing the ${r.latest}; DeviceHub restarts by itself` });
  else if (r.updated) { serverLog({ kind: 'good', text: `DeviceHub updated (${r.count} change${r.count === 1 ? '' : 's'}): restarting` }); setTimeout(() => process.exit(3), 600); }
}
async function api(req, res, url) {
  // Only the dashboard itself may call the API: other web pages are refused by Origin, and anything that changes
  // state must be a POST (a page can make a browser send a GET, e.g. with an <img>, without an Origin header).
  const origin = req.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) return send(res, 403, { error: 'origin' });
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (ISOLATED && isolatedApi(req, res, url)) return;

  if (url.pathname === '/api/backup' && req.method === 'POST') {
    const body = await readBody(req);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUPS, `${safeName(body.device)}-${stamp}.json`);
    writeAtomic(file, JSON.stringify(body, null, 2));
    pruneBackups(safeName(body.device));
    return send(res, 200, { ok: true, file });
  }
  // how many DeviceHub windows are open (each keeps one live-update stream): the launcher brings an open one to the
  // front instead of opening another (20 Oct 2026)
  if (url.pathname === '/api/windows') return send(res, 200, { open: openWindows });
  // Close the window when it is not in use (26 Oct 2026, Shawn approved; public/core/idle-close.js asks after 5 minutes
  // hidden, helpers/window-close.js closes only DeviceHub's own window-profile browser). Never without the tray icon to
  // come back from, never while DeviceHub is doing something the person started; the next window opens on that page.
  if (url.pathname === '/api/window/resume' && req.method === 'GET') return send(res, 200, { page: require('./helpers/window-close').takeResume() });
  if (url.pathname === '/api/window/idle-close' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (readJsonFile(SETTINGS, {}).closeWhenMinimized === false) return send(res, 200, { closing: false, retry: false, why: 'switched off' });
    if (!tray || quitting) return send(res, 200, { closing: false, retry: false, why: 'no tray icon to open it again' });
    const held = [];
    if (publishRun?.state === 'running') held.push('publishing');
    const up = require('./helpers/self-update').getProgress();
    if (up && Date.now() - up.at < 10 * 60000) held.push('updating');
    try { if (openrgb.findState().running) held.push('Find my lights'); } catch {}
    try { const ph = (await import('./helpers/learn-auto.mjs')).state().phase; if (!['idle', 'done', 'stopped', 'failed'].includes(ph)) held.push('learning'); } catch {}
    try { const ip = (await import('./helpers/installers.mjs')).getProgress(); if (ip && !ip.done && Date.now() - ip.at < 10 * 60000) held.push('installing'); } catch {}
    if (held.length) return send(res, 200, { closing: false, why: held.join(', ') });
    try {
      const r = await require('./helpers/window-close').closeAsking({ clientPort: req.socket.remotePort, serverPort: PORT, root: ROOT, page: b?.page, appWindow: b?.appWindow === true });
      if (r.closing) serverLog({ kind: 'info', text: 'Window closed after 5 minutes minimized (DeviceHub is still in the tray)' });
      return send(res, 200, r);
    } catch (e) { return send(res, 200, { closing: false, why: e.message }); }
  }
  if (url.pathname === '/api/version') return send(res, 200, { version: appVersion() });
  // a new version is ready (helpers/update-notice.mjs): the window asks once, Update or Later
  if (url.pathname === '/api/update-notice') return send(res, 200, { notice: updateNotice });
  // the weekly setup files (helpers/weekly-setup.mjs): list, read one, or save one now
  if (url.pathname === '/api/setups' && req.method === 'GET') return send(res, 200, agent ? agent.setups.list() : []);
  if (url.pathname === '/api/setups/save-now' && req.method === 'POST') return send(res, 200, { name: agent ? await agent.setups.saveNow() : null });
  if (url.pathname.startsWith('/api/setups/') && req.method === 'GET') {
    try { return send(res, 200, agent.setups.read(decodeURIComponent(url.pathname.slice('/api/setups/'.length)))); } catch (e) { return send(res, 404, { error: e.message }); }
  }
  // Settings > Health: uptime, memory of the server and the helper, crash restarts by the launcher in the last 24 h,
  // the last problem in Activity, and the backups' count and size. Read-only.
  if (url.pathname === '/api/health') {
    const m = process.memoryUsage();
    const windowMB = await windowMemory();
    const helperLine = await require('./helpers/native').request('diag', 'MEM', 15000);
    const helperMB = Number((/private=([\d.]+)MB/.exec(helperLine) || [])[1]) || null;
    let crashes = 0, lastCrashAt = null;
    try {
      const since = Date.now() - 24 * 3600 * 1000;
      for (const f of ['server.log', 'server.old.log']) {
        const p = logFile(f, ROOT);
        if (!fs.existsSync(p)) continue;
        let crashLine = false;
        for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
          if (/^\[crash\]|^\s+at .+:\d+:\d+\)?\s*$|^\w*Error\b/.test(l)) crashLine = true;   // auto-report.mjs CRASH_LINE
          const mm = /^\[launcher\] (.+?) server exited/.exec(l);
          // code 1 without a "[crash]" line or stack from that run is a stop from outside (End task, taskkill /F): not a crash
          // (27 Oct 2026: 10 "crashes" in a day were all restarts; helpers/auto-report.mjs crashLineIn)
          if (mm) { const one = /exited with code 1;/.test(l) && !crashLine; crashLine = false; if (one) continue; }
          // code -1 is a process stopped from outside (a restart), not a crash; nor is Windows closing DeviceHub at
          // sign-out, shutdown or a closed console (1073807364 = 0x40010004, -1073741510 = 0xC000013A; auto-report.mjs)
          if (mm && !/exited with code (-1|1073807364|-1073741510|3221225786);/.test(l)) {
            const at = new Date(mm[1]).getTime();
            if (at > since) crashes++;
            if (Number.isFinite(at) && (!lastCrashAt || at > lastCrashAt)) lastCrashAt = at;   // for "stable for" (Settings > Health)
          }
        }
      }
    } catch {}
    let lastProblem = null;
    try {
      const lines = fs.readFileSync(ACTIVITY, 'utf8').trim().split('\n').reverse();
      for (const l of lines) { try { const a = JSON.parse(l); if (a.kind === 'bad') { lastProblem = { at: a.at, text: a.text, device: a.device }; break; } } catch {} }
    } catch {}
    let backups = { count: 0, mb: 0 };
    try { const fl = fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.json')); backups = { count: fl.length, mb: +(fl.reduce((s, f) => s + fs.statSync(path.join(BACKUPS, f)).size, 0) / 1048576).toFixed(1) }; } catch {}
    return send(res, 200, { uptimeS: Math.round(process.uptime()), serverMB: +(m.rss / 1048576).toFixed(0), heapMB: +(m.heapUsed / 1048576).toFixed(0), helperMB: helperMB && Math.round(helperMB), windowMB, crashes24h: crashes, lastCrashAt: lastCrashAt ? new Date(lastCrashAt).toISOString() : null, lastProblem, backups });
  }
  // Settings > Save a report: one text file someone can send to whoever helps them. Health, versions, the devices'
  // state, the end of the server log and Activity, the settings and seen devices. No backups, no profiles. Read-only.
  // the short report (20 Oct 2026): what someone helping (a friend, or their Claude Code) needs first, to paste into a
  // message; no settings, profiles or activity history. Settings > Health > Copy for help
  if (url.pathname === '/api/report/short') {
    const os = require('os');
    const lines = [`DeviceHub ${appVersion()} · Windows build ${os.release()} · Node ${process.version} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`];
    try { const h = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json(); lines.push(`running ${Math.round((h.uptimeS || 0) / 60)} min · ${h.serverMB + (h.helperMB || 0)} MB · crashes today: ${h.crashes24h || 0}`); } catch {}
    if (agent) for (const d of agent.state().devices.filter((x) => x.seen || ['connected', 'asleep', 'connecting'].includes(x.status) || x.adapter?.plugin)) lines.push(`${d.id}: ${d.status}${d.info?.Model ? ` (${d.info.Model})` : ''}${d.error ? ` · ${d.error}` : ''}`);
    else lines.push('devices: no background agent');
    try { const pc = await pcMap.get(); lines.push(`PC: ${pc.cpu} · ${pc.gpus.map((g) => g.name).join(', ')} · ${pc.board?.maker || ''} ${pc.board?.model || ''}`.trim());
      const other = pc.usb.filter((u) => !u.runs).map((u) => `${u.id}${u.name ? ` ${u.name}` : ''}`);
      if (other.length) lines.push(`other USB: ${other.join('; ')}`); } catch (e) { lines.push(`PC: not read (${e.message})`); }
    try { if (eqapo.installed()) { const d = await eqapo.devices(); const off = (await require('./helpers/eqapo-devices').status({ render: d.headset, capture: d.mic })).off; lines.push(`Equalizer APO: installed${off.length ? ` · not on for ${off.map((x) => x.name).join(', ')}` : ''}`); } else lines.push('Equalizer APO: not installed'); } catch {}
    try { const m = await monitors.list(); lines.push(`monitors: ${m.map((x) => `${x.name}${x.ddc ? '' : ' (no DDC/CI)'}`).join(', ') || 'none'}`); } catch {}
    // (27 Oct 2026) the log in logs\, this PC's files in data\
    const at = (f) => (/\.log$/.test(f) ? logFile(f, ROOT) : dataFile(f, ROOT));
    const tail = (f, n) => { try { return fs.readFileSync(at(f), 'utf8').trim().split('\n').slice(-n); } catch { return []; } };
    const bad = tail('activity.jsonl', 400).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((a) => a && a.kind === 'bad').slice(-8);
    if (bad.length) lines.push('', 'recent problems:', ...bad.map((a) => `  ${a.at.slice(5, 16).replace('T', ' ')} ${a.device ? a.device + ': ' : ''}${a.text}`));
    const errs = tail('server.log', 400).filter((l) => /error|fail|cannot|\[start\]/i.test(l)).slice(-8);
    if (errs.length) lines.push('', 'log:', ...errs.map((l) => `  ${l.slice(0, 200)}`));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(lines.join('\n'));
  }
  if (url.pathname === '/api/report') {
    const at = (f) => (/\.log$/.test(f) ? logFile(f, ROOT) : dataFile(f, ROOT));
    const tail =(f, n) => { try { return fs.readFileSync(at(f), 'utf8').trim().split('\n').slice(-n).join('\n'); } catch { return '(none)'; } };
    const json = (f) => { try { return fs.readFileSync(at(f), 'utf8').trim(); } catch { return '(none)'; } };
    let health = {};
    try { health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json(); } catch (e) { health = { error: e.message }; }
    const devs = agent ? agent.state().devices.map((d) => ({ id: d.id, status: d.status, error: d.error, info: d.info, battery: d.battery })) : '(no background agent)';
    const out = [
      `DeviceHub report, ${new Date().toString()}`,
      `DeviceHub build ${appVersion()} · Node ${process.version} · Windows ${require('os').release()} · ${require('os').arch()}`,
      '', '== Health', JSON.stringify(health, null, 1),
      '', '== Devices', JSON.stringify(devs, null, 1),
      '', '== Settings', json('settings.json'),
      '', '== Seen devices', json('seen-devices.json'),
      '', '== Activity (last 200)', tail('activity.jsonl', 200),
      '', '== Server log (last 300 lines)', tail('server.log', 300),
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="DeviceHub report ${new Date().toISOString().slice(0, 10)}.txt"`, 'Cache-Control': 'no-store' });
    return res.end(out);
  }
  // memory diagnostics for the server and the native helper (?gc=1 collects first); local only, like every route
  if (url.pathname === '/api/diag') {
    // a watchdog test: freezes the helper's heartbeat channel on purpose, then runs a heartbeat (the watchdog restarts
    // the helper about 10 s later; helpers/native.js)
    if (url.searchParams.has('watchdog-test')) {
      const n = require('./helpers/native');
      n.request('watchdog', 'HANG-TEST', 2000); setTimeout(() => n.heartbeat(), 500);
      return send(res, 200, { started: true });
    }
    if (url.searchParams.get('gc') && global.gc) global.gc();
    const m = process.memoryUsage();
    const helper = await require('./helpers/native').request('diag', url.searchParams.get('gc') ? 'MEM GC' : 'MEM', 15000);
    return send(res, 200, { server: { rssMB: +(m.rss / 1048576).toFixed(1), heapMB: +(m.heapUsed / 1048576).toFixed(1), externalMB: +(m.external / 1048576).toFixed(1) }, helper });
  }
  if (url.pathname === '/api/backups' && req.method === 'GET') {
    // one stat per file (the sidebar's backup shield asks every 30 s)
    const files = fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.json')).map((f) => { const st = fs.statSync(path.join(BACKUPS, f)); return { name: f, size: st.size, at: st.mtime, ms: st.mtimeMs }; });
    files.sort((a, b) => b.ms - a.ms);
    return send(res, 200, files.map(({ ms, ...f }) => f));
  }
  if (url.pathname.startsWith('/api/backups/') && req.method === 'GET') {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/api/backups/'.length)));
    const file = path.join(BACKUPS, name);
    if (!name.endsWith('.json') || !fs.existsSync(file)) return send(res, 404, { error: 'no such backup' });
    return send(res, 200, fs.readFileSync(file, 'utf8'));
  }
  // the change history, kept across restarts
  if (url.pathname === '/api/activity') {
    if (req.method === 'POST') {
      const e = await readBody(req);
      fs.appendFileSync(ACTIVITY, JSON.stringify({ at: new Date(), text: String(e.text || '').slice(0, 500), kind: e.kind, device: e.device }) + '\n');
      return send(res, 200, { ok: true });
    }
    const lines = fs.existsSync(ACTIVITY) ? fs.readFileSync(ACTIVITY, 'utf8').trim().split('\n').filter(Boolean).slice(-200) : [];
    return send(res, 200, lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse());
  }
  // Running programs (read-only), for switching profiles when a game starts.
  // "Any game": program names found in the game folders (helpers/games.js), for auto-switch's '*games*' entry.
  if (url.pathname === '/api/games') return send(res, 200, url.searchParams.has('titles') ? await require('./helpers/games').titles() : await require('./helpers/games').names());
  if (url.pathname === '/api/processes') return send(res, 200, await runningPrograms(url.searchParams.has('windows')));
  // Game mode (27 Oct 2026, helpers/game-mode.mjs): the games set up (game-mode.json), the installed games to pick from
  // (helpers/games.js installed, read-only), the switches now ("Use now's settings"), and what is on now
  if (url.pathname.startsWith('/api/game-mode')) {
    const file = dataFile('game-mode.json', ROOT);
    const status = async () => (agent ? (await agent.op('game-mode-reload', {})).status : null);
    try {
      if (url.pathname === '/api/game-mode' && req.method === 'GET') return send(res, 200, { games: readJsonFile(file, {}).games || [], status: agent ? agent.state().auto.game : null });
      if (url.pathname === '/api/game-mode/installed' && req.method === 'GET') return send(res, 200, await require('./helpers/games').installed());
      if (url.pathname === '/api/game-mode/now' && req.method === 'GET') return send(res, 200, agent ? await agent.op('game-mode-now', {}) : {});
      if (url.pathname === '/api/game-mode' && req.method === 'POST') {
        const { cleanGames } = await import('./helpers/game-mode.mjs');
        const games = cleanGames((await readBody(req)).games);
        writeAtomic(file, JSON.stringify({ games }, null, 1));
        return send(res, 200, { games, status: await status() });
      }
    } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 404, { error: 'not found' });
  }
  // Start with Windows: a shortcut to DeviceHub.vbs in the user's Startup folder (only when the user turns it on).
  if (url.pathname === '/api/startup') {
    const lnk = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DeviceHub.lnk');
    if (req.method === 'POST') {
      const { enabled } = await readBody(req);
      if (enabled) await makeShortcut(lnk);
      else if (fs.existsSync(lnk)) fs.unlinkSync(lnk);
    }
    return send(res, 200, { enabled: fs.existsSync(lnk) });
  }
  if (url.pathname === '/api/reveal' && req.method === 'POST') {
    // ?folder=via-definitions (the Keyboard page's VIA file note) opens that folder, made first if missing; else DeviceHub's
    let dir = ROOT;
    if (url.searchParams.get('folder') === 'via-definitions') { dir = path.join(ROOT, 'via-definitions'); fs.mkdirSync(dir, { recursive: true }); }
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }
  // automatic problem reports (helpers/auto-report.mjs): { on, configured, owner, active } for Settings and the Set up card
  // share learned drivers that work (helpers/driver-share.mjs): the person's yes, asked once when a Learn finishes
  if (url.pathname === '/api/driver-share') { try { if (await (await import('./helpers/driver-share.mjs')).handle(url, req, res, { send, readBody, root: ROOT })) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname === '/api/auto-report') { try { if (await (await import('./helpers/auto-report.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET')return send(res, 200, readJsonFile(SETTINGS, {}));
    if (req.method === 'POST') {
      // A POST changes only the keys it names, and only known keys with the right type (window and tray both write here).
      // setupSeen: the window opened once on this PC, so it no longer opens Setup by itself (public/core/first-run.js).
      const cur = readJsonFile(SETTINGS, {});
      const b = await readBody(req);
      for (const [k, type] of Object.entries({ autoSwitch: 'boolean', defaultProfile: 'string', artStyle: 'string', themeAccent: 'string', themeBg: 'string', ankerGuard: 'boolean', batterySaver: 'boolean', settingsSync: 'boolean', lightWindow: 'boolean', batteryCare: 'boolean', oneDriveCopy: 'boolean', autoReport: 'boolean', shareDrivers: 'boolean', setupSeen: 'boolean', wifiPauseGaming: 'boolean', closeWhenMinimized: 'boolean', headsetSoundSwitch: 'boolean' }))if (typeof b[k] === type) cur[k] = type === 'string' ? b[k].slice(0, 100) : b[k];
      // the theme (Settings > Appearance): an accent color as #rrggbb and one of the backdrops
      if (cur.themeAccent && !/^#[0-9a-f]{6}$/i.test(cur.themeAccent)) delete cur.themeAccent;
      if (cur.themeBg && !['graphite', 'black', 'ocean', 'midnight', 'espresso', 'old-school', 'verde', 'milk', 'coral-reef', 'cyberpunk', 'sakura', 'terminal', 'taco-night', 'slate', 'plum', 'forest', 'cream', 'paper'].includes(cur.themeBg)) delete cur.themeBg;
      // Settings > Appearance; Crimson ('duo', and the older 'pop') became Aero (26 Oct 2026), so a saved one is kept as 'aero'
      if (cur.artStyle === 'duo' || cur.artStyle === 'pop') cur.artStyle = 'aero';
      if (cur.artStyle && !['photo', 'frosted', 'blueprint', 'neon', 'aero', 'arctic', 'live', 'studio', 'glow', 'matte', 'night'].includes(cur.artStyle)) delete cur.artStyle;
      // a name for a headset (the Headset page's Rename; 22 Oct 2026, Shawn: the wired Audio-Technica): { key, name },
      // key a USB id or a wired headset's JACK_ key; an empty name puts Windows' name back
      if (b.headsetName && typeof b.headsetName === 'object') {
        const key = String(b.headsetName.key || '').toUpperCase(), name = String(b.headsetName.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
        if (/^(VID_[0-9A-F]{4}&PID_[0-9A-F]{4}|JACK_[0-9A-F]{8})$/.test(key)) {
          const names = { ...(cur.headsetNames && typeof cur.headsetNames === 'object' ? cur.headsetNames : {}) };
          if (name) names[key] = name; else delete names[key];
          cur.headsetNames = names;
        }
      }
      writeAtomic(SETTINGS, JSON.stringify(cur, null, 2));
      agent?.reloadSettings();
      if (b.oneDriveCopy === true) agent?.saveOneDrive().catch(() => {});   // switched on: the first copy now
      return send(res, 200, cur);
    }
  }
  if (url.pathname === '/api/profiles') {
    if (req.method === 'GET') return send(res, 200, readJsonFile(PROFILES, []));
    if (req.method === 'POST') { writeAtomic(PROFILES, JSON.stringify(await readBody(req), null, 2)); return send(res, 200, { ok: true }); }
  }
  // which makers' apps are on this PC (the device pages say so instead of offering a button that cannot open one)
  if (url.pathname === '/api/vendor-apps') return send(res, 200, Object.fromEntries(Object.entries(VENDOR_APPS).map(([k, p]) => [k, fs.existsSync(p)])));
  if (url.pathname === '/api/open' && req.method === 'POST') {
    const { app } = await readBody(req);
    // only an app that is there (20 Oct 2026: on a PC without iCUE the button crashed the server); otherwise its page
    if (VENDOR_APPS[app] && fs.existsSync(VENDOR_APPS[app])) {
      const p = spawn(VENDOR_APPS[app], [], { detached: true, stdio: 'ignore' });
      p.on('error', (e) => console.log(`[open] ${app}: ${e.message}`));
      p.unref(); return send(res, 200, { ok: true });
    }
    if (VENDOR_URLS[app]) return send(res, 200, { ok: true, url: VENDOR_URLS[app] });
    if (VENDOR_APPS[app]) return send(res, 404, { error: 'it is not installed on this PC' });
    return send(res, 404, { error: 'unknown app' });
  }
  // The window's live stream (helpers/window-events.js): hello on every open, then only what changes; with an agent, its
  // device, activity, auto and newdevice events too. While the agent is still starting (a reconnect right after a restart)
  // it is refused, so the window opens it again in 5 s and gets the device events as well.
  if (url.pathname === '/api/events' && req.method === 'GET') {
    if (AGENT_ON && !agent && !agentTried) return send(res, 503, { error: 'agent starting' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const sid = ++streamSeq;
    streams.set(sid, res);
    res.write(windowEvents.frame('hello', { ...helloNow(), stream: sid }));
    openWindows++;
    const offHub = hub.add(res);
    const offAgent = agent ? agent.subscribe((type, data) => res.write(windowEvents.frame(type, data))) : () => {};
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { offHub(); offAgent(); clearInterval(ping); openWindows--; streams.delete(sid); gpuWatch.drop(sid); });
    return;
  }
  // what one window's stream wants beside the usual events: { stream, gpu } (the Overview's GPU chip, helpers/gpu-watch.js)
  if (url.pathname === '/api/events/want' && req.method === 'POST') {
    const b = await readBody(req);
    const res2 = streams.get(Number(b?.stream));
    if (!res2) return send(res, 404, { error: 'no such stream' });
    gpuWatch.want(Number(b.stream), b.gpu === true, (d) => { try { res2.write(windowEvents.frame('gpu', d)); } catch {} });
    return send(res, 200, { ok: true });
  }
  // Whether this server runs an agent (the window must then never open the devices itself), and whether it is up.
  if (url.pathname === '/api/agent-config') return send(res, 200, { agent: AGENT_ON, ready: !!agent });
  // The background agent (helpers/agent.mjs): state, live events, and operations for the window and the tray.
  if (url.pathname.startsWith('/api/agent/')) {
    if (!agent) return send(res, 503, { error: 'agent not running' });
    const name = url.pathname.slice('/api/agent/'.length);
    if (name === 'state' && req.method === 'GET') return send(res, 200, agent.state());
    if (name === 'events' && req.method === 'GET') {   // the agent's events alone (the window uses /api/events)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      openWindows++;
      const off = agent.subscribe((type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { off(); clearInterval(ping); openWindows--; });
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
    return send(res, 200, await agent.op(name, await readBody(req)));
  }
  // The rest of a setup file (helpers/setup-extras.js): headset names and pick, the background picture, added drivers and,
  // when asked, the wallpapers. GET gathers them (?wallpapers=1 adds those; ?size=1 only says how big they would be), POST
  // /plan compares a summary with this PC, POST /apply (the raw JSON, which can be large) puts them here.
  if (url.pathname === '/api/setup-extras' || url.pathname.startsWith('/api/setup-extras/')) {
    try {
      const sub = url.pathname.slice('/api/setup-extras'.length);
      if (sub === '' && req.method === 'GET') {
        if (url.searchParams.has('size')) { const l = wallpapers().list(); return send(res, 200, { wallpaperBytes: l.totalBytes, wallpaperCount: l.items.length }); }
        return send(res, 200, setupExtras().gather({ withWallpapers: url.searchParams.get('wallpapers') === '1' }));
      }
      if (sub === '/plan' && req.method === 'POST') return send(res, 200, setupExtras().plan(await readBody(req)));
      if (sub === '/apply' && req.method === 'POST') {
        const chunks = []; let size = 0, big = false;
        await new Promise((resolve, reject) => { req.on('data', (c) => { size += c.length; if (size > 1024 * 1024 * 1024) big = true; else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
        if (big) return send(res, 413, { error: 'That setup file is over 1 GB.' });
        const x = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const r = setupExtras().apply(x);
        if (typeof x.headsetPick === 'string') { try { await agent?.op('headset-pick', { pick: x.headsetPick }); } catch {} }
        agent?.reloadSettings();
        return send(res, 200, r);
      }
      return send(res, 405, { error: 'not here' });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // This PC's setup in OneDrive, and the other PCs' (helpers/onedrive-setup.mjs; settings.json oneDriveCopy)
  if (url.pathname === '/api/onedrive' || url.pathname.startsWith('/api/onedrive/')) {
    try {
      const od = await import('./helpers/onedrive-setup.mjs');
      const saveNow = (o) => (agent ? agent.saveOneDrive(o) : Promise.resolve({ ok: false, error: 'DeviceHub is still starting' }));
      if (await od.handle(url, req, res, send, readBody, { saveNow }) === false) send(res, 404, { error: 'not found' });
      return;
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // Sound settings in the setup file: DeviceHub's EQ store (presets, speaker / mic curves, mic tools) and its own
  // options (settings.json). Putting them back backs up both first.
  if (url.pathname === '/api/sound-setup') {
    try {
      if (req.method === 'GET') return send(res, 200, { eq: eqapo.installed() ? await eqapo.exportState() : null, settings: readJsonFile(SETTINGS, {}) });
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (b.settings && typeof b.settings === 'object') {
          if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(BACKUPS, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
          const cur = readJsonFile(SETTINGS, {});
          for (const [k, type] of Object.entries({ autoSwitch: 'boolean', defaultProfile: 'string', artStyle: 'string', themeAccent: 'string', themeBg: 'string', ankerGuard: 'boolean' })) if (typeof b.settings[k] === type) cur[k] = type === 'string' ? b.settings[k].slice(0, 100) : b.settings[k];
          // an imported look goes through the same list as a saved one (Crimson became Aero, 26 Oct 2026)
          if (cur.artStyle === 'duo' || cur.artStyle === 'pop') cur.artStyle = 'aero';
          if (cur.artStyle && !['photo', 'frosted', 'blueprint', 'neon', 'aero', 'arctic', 'live', 'studio', 'glow', 'matte', 'night'].includes(cur.artStyle)) delete cur.artStyle;
          writeAtomic(SETTINGS, JSON.stringify(cur, null, 2)); agent?.reloadSettings();
        }
        if (b.eq && eqapo.installed()) await eqapo.importState(b.eq);
        return send(res, 200, { ok: true });
      }
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // HS80 equalizer. With Equalizer APO installed, DeviceHub runs it (helpers/eqapo.js): instant, no iCUE. Otherwise
  // iCUE's EQ presets (helpers/icue-eq.js): saving backs up, restarts iCUE and reads back.
  // Equalizer APO switched on for the headset? Opening its Device Selector to tick it (helpers/eqapo-devices.js)
  if (url.pathname === '/api/eq/turn-on' && req.method === 'POST') {
    try { return send(res, 200, await require('./helpers/eqapo-devices').turnOn()); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // Corsair's old sound effects under Equalizer APO, turned off on the person's click (27 Oct 2026, helpers/corsair-apo.js:
  // with iCUE removed they made Discord's join sound about 1 s late)
  if (url.pathname === '/api/eq/corsair-fix' && req.method === 'POST' && eqapo.installed()) {
    try { const d = await eqapo.devices(); return send(res, 200, await require('./helpers/corsair-apo').fix({ render: d.headset, capture: d.mic })); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/eq' && req.method === 'GET' && eqapo.installed()) {
    try {
      const r = await eqapo.read();
      const d = await eqapo.devices();  // the headset the Headset page controls (helpers/headset-pick-eq.js)
      // the mic only when a mic setting is on (27 Oct 2026, Shawn: Equalizer APO on the headset mic made Discord's join
      // sound late, on every output; a friend is not asked to switch it on for the mic unless they use a mic setting)
      const x = r.extras || {};
      const micUsed = !!(x.micRumble || x.micClarity || x.micDeEss || x.micLevel || x.micBoost);
      r.notOn = (await require('./helpers/eqapo-devices').status({ render: d.headset, capture: micUsed ? d.mic : [] })).off;
      // Corsair's old effects still on the headset with iCUE gone (27 Oct 2026, helpers/corsair-apo.js); a failed read shows nothing
      r.corsairApo = await require('./helpers/corsair-apo').check({ render: d.headset, capture: d.mic }).catch(() => ({ flagged: [], icue: null }));
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/eq') && eqapo.installed()) {
    const act = url.pathname.slice('/api/eq'.length);
    const ops = { '': 'read', '/save': 'save', '/activate': 'activate', '/preview': 'preview', '/headroom': 'setHeadroom', '/extras': 'setExtras', '/reset': 'resetToNormal' };
    if (!(act in ops) || (act === '' ? req.method !== 'GET' : req.method !== 'POST')) return send(res, 404, { error: 'not found' });
    try { return send(res, 200, await eqapo[ops[act]](act === '' ? {} : await readBody(req))); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // no Equalizer APO: iCUE's EQ if iCUE has one, else the page offers Equalizer APO (the EQ DeviceHub runs itself)
  if (url.pathname === '/api/eq' && req.method === 'GET') { const r = await icueEq.read(); return send(res, 200, r.available ? r : { ...r, needsApo: true }); }
  if (url.pathname === '/api/eq/save' && req.method === 'POST') {
    if (eqBusy) return send(res, 409, { error: 'an equalizer save is already running' });
    eqBusy = true;
    try { return send(res, 200, await icueEq.save(await readBody(req), BACKUPS)); } finally { eqBusy = false; }
  }
  // Mic test (helpers/mic-rec.cs): records the headset mic through Windows' normal path (its filters included) into
  // the helper's memory; playback is built here in memory and sent with no-store, never written to a file.
  if (url.pathname.startsWith('/api/mictest/')) {
    if (!corsair) return send(res, 503, { error: 'audio helper not available' });
    const act = url.pathname.slice('/api/mictest/'.length);
    try {
      if (act === 'start' && req.method === 'POST') {
        // the AnkerCamera: the guard unmutes it for the test only
        if ((await readBody(req)).mic === 'anker') {
          const ankerId = await ankerGuard.testing(true);
          return send(res, 200, { ...(await corsair.handle('mic-rec-start', { id: ankerId })).rec, mic: 'anker' });
        }
        let id = null;
        try {
          const eps = (await corsair.handle('hs80-endpoints', {})).endpoints.filter((e) => e.flow === 'recording' && e.state === 1);
          id = (eps.find((e) => e.wired) || eps[0])?.id || null;
        } catch {}
        // the headset off: no silent switch to another mic (the test would record the wrong one)
        if (!id) return send(res, 409, { error: 'The headset mic is not connected. Turn the headset on.' });
        return send(res, 200, { ...(await corsair.handle('mic-rec-start', { id })).rec, headsetMic: true });
      }
      if (act === 'status') return send(res, 200, (await corsair.handle('mic-rec-status', {})).rec);
      if (act === 'stop' && req.method === 'POST') { const r = (await corsair.handle('mic-rec-stop', {})).rec; ankerGuard.testing(false).catch(() => {}); return send(res, 200, r); }
      if (act === 'clear' && req.method === 'POST') { const r = (await corsair.handle('mic-rec-clear', {})).rec; ankerGuard.testing(false).catch(() => {}); return send(res, 200, r); }
      if (act === 'audio') {
        const st = (await corsair.handle('mic-rec-status', {})).rec;
        if (st.recording || !st.bytes) return send(res, 409, { error: st.recording ? 'still recording' : 'nothing recorded' });
        const parts = [];
        for (let off = 0; off < st.bytes;) { const d = Buffer.from((await corsair.handle('mic-rec-read', { offset: off, length: 1 << 20 })).data, 'base64'); if (!d.length) break; parts.push(d); off += d.length; }
        const pcm = Buffer.concat(parts), hdr = Buffer.alloc(44);
        hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
        hdr.writeUInt32LE(st.rate, 24); hdr.writeUInt32LE(st.rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': 44 + pcm.length, 'Cache-Control': 'no-store' });
        return res.end(Buffer.concat([hdr, pcm]));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // DeviceHub's own updates from its private GitHub repository (helpers/self-update.js): how many new changes; Update
  // pulls them, then DeviceHub restarts (exit code 3: the launcher starts it again, and the helper is rebuilt if needed)
  // settings sync and the battery saver, for Settings: their state, and "sync now"
  if (url.pathname === '/api/settings-sync/role' && req.method === 'POST') { const { role } = await readBody(req); return send(res, 200, await settingsSync.setRole(role)); }
  if (url.pathname === '/api/settings-sync') return send(res, 200, req.method === 'POST' ? await settingsSync.sync() : settingsSync.status());
  if (url.pathname === '/api/power') return send(res, 200, require('./helpers/power').state());
  // display modes, HDR and main screen; temperatures; the PC check (helpers/pc-routes.js, docs/handoff/display-health.md)
  if (require('./helpers/pc-routes').handles(url.pathname)) return require('./helpers/pc-routes').handle(req, res, url, { send, readBody, backups: BACKUPS, log: (text) => serverLog({ kind: 'info', text }) });
  // monitors over DDC/CI (helpers/monitors.js): read, and one setting at a time (backed up, read back)
  if (url.pathname === '/api/monitors') {
    try { return send(res, 200, await monitors.list(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/monitors/sleep' && req.method === 'POST') {
    try {
      // Windows' own monitor-off message through its signed PowerShell (26 Oct 2026: no third-party nircmd.exe)
      const ps = path.join(__dirname, 'helpers', 'sleep-monitors.ps1');
      require('child_process').spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ps], { stdio: 'ignore', windowsHide: true }).unref();   // not detached: started detached it quit at once, before its first line (27 Oct 2026, Shawn: Sleep did nothing)
      monitors.quiet();   // no DDC/CI reads that could wake them (helpers/monitors.js)
      serverLog({ kind: 'info', text: 'Monitors: sleep command sent' });
      return send(res, 200, { ok: true });
    } catch (e) {
      serverLog({ kind: 'bad', text: `Monitors sleep: ${e.message}` });
      return send(res, 500, { ok: false, error: e.message });
    }
  }
  if (url.pathname === '/api/cameras') {
    try { return send(res, 200, await camera.list(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/cameras/set' && req.method === 'POST') {
    const { id, key, value, auto, silent } = await readBody(req);
    try { const r = await camera.set(String(id), String(key), Number(value), auto === true); if (!silent) serverLog({ kind: 'good', text: `${r.name}: ${key} → ${r.auto ? 'auto' : r.value}` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `Camera ${key}: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  // This PC (read-only map) and PC lights through OpenRGB (helpers/pc-map.js, helpers/openrgb.js)
  if (url.pathname === '/api/pc') {
    try { return send(res, 200, await pcMap.get(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // the graphics card's temperature, fan, load and power, read-only (helpers/gpu.js; the PC page)
  if (url.pathname === '/api/gpu') return send(res, 200, await require('./helpers/gpu').read());
  // A background picture of the person's own (22 Oct 2026, Shawn: the OSRS map behind the Old School theme): one image
  // they pick, kept in this folder only (data\background-picture.*, in .gitignore, so never in git, the installer or sync).
  // PNG, JPEG or WebP, checked by its first bytes, at most 8 MB. GET serves it (?check: whether there is one), POST
  // (the raw image) replaces it, POST /api/background/remove removes it (changes are POSTs, as for every route here).
  if (url.pathname === '/api/background' || url.pathname === '/api/background/remove') {
    const KINDS = [['png', 'image/png', (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
      ['jpg', 'image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
      ['webp', 'image/webp', (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP']];
    const saved = () => KINDS.map(([ext, type]) => ({ file: dataFile(`background-picture.${ext}`, ROOT), type })).find((x) => fs.existsSync(x.file));
    if (url.pathname === '/api/background/remove') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
      const cur = saved(); if (cur) fs.unlinkSync(cur.file); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      const cur = saved();
      if (url.searchParams.has('check')) return send(res, 200, { picture: !!cur });
      if (!cur) return send(res, 404, { error: 'no background picture' });
      res.writeHead(200, { 'Content-Type': cur.type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(cur.file).pipe(res);
    }
    if (req.method === 'POST') {
      const chunks = []; let size = 0, big = false;
      await new Promise((resolve, reject) => { req.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) big = true; else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
      if (big) return send(res, 413, { error: 'That picture is over 8 MB. Pick a smaller one.' });
      const buf = Buffer.concat(chunks);
      const kind = KINDS.find(([, , is]) => is(buf));
      if (!kind) return send(res, 400, { error: 'Pick a PNG, JPEG or WebP picture.' });
      const old = saved(); if (old) fs.unlinkSync(old.file);
      writeAtomic(dataFile(`background-picture.${kind[0]}`, ROOT), buf);
      return send(res, 200, { ok: true, type: kind[1], bytes: buf.length });
    }
    return send(res, 405, { error: 'GET or POST' });
  }
  // Wallpapers (22 Oct 2026, Shawn: "store them in this wallpaper area so people can easily get them and preview them and
  // back them up"): Pictures\DeviceHub Wallpapers, outside this folder (helpers/wallpapers.js; public/pages/wallpapers.js)
  if (url.pathname === '/api/wallpapers' || url.pathname.startsWith('/api/wallpapers/')) {
    if (await wallpapers().handle(url, req, res, send, readBody) === false) send(res, 404, { error: 'not found' });
    return;
  }
  if (url.pathname === '/api/bluetooth') {
    try { return send(res, 200, await pcMap.bluetooth(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb') return send(res, 200, await openrgb.status(url.searchParams.has('fresh')));
  // why fan lights may be missing, read-only (helpers/lights-diagnose.js): the cached PC map and OpenRGB state; never starts OpenRGB
  if (url.pathname === '/api/lights/diagnose') {
    try { const [pc, orgb] = await Promise.all([pcMap.get(false).catch(() => null), openrgb.status(false)]); return send(res, 200, require('./helpers/lights-diagnose').diagnose({ pc, orgb })); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // Less learning for other people's devices (22 Oct 2026): the shared device library, standard batteries and
  // standard lights. Read-only, except the library install, which copies a tested driver into my-devices\ only.
  // library entries that arrive between app releases, signed (helpers/library-updates.mjs), and sharing a working driver
  // in one click (helpers/share-route.mjs: checks for anything personal, then opens a pre-filled GitHub page)
  if (url.pathname.startsWith('/api/library/update')) { try { if (await (await import('./helpers/library-updates.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // Learn a device: USB recordings -> a read-only driver.json, without Claude (helpers/learn-wizard.mjs, public/pages/learn.js)
  // Learn it for me (helpers/learn-auto.mjs): the whole learning session on one click
  if (url.pathname.startsWith('/api/learn/auto')) { try { if (await (await import('./helpers/learn-auto.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname.startsWith('/api/learn/')) { try { if (await (await import('./helpers/learn-wizard.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // Get help: a short report with anything personal taken out, then a pre-filled GitHub issue on the person's click
  if (url.pathname.startsWith('/api/help/')) { try { if (await (await import('./helpers/get-help.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname.startsWith('/api/share/')) { try { if (await (await import('./helpers/share-route.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // why a device isn't working, and the fix (helpers/diagnose.mjs; read-only apart from closing a maker's app on a confirmed press)
  // optional tools (Equalizer APO, ReaPlugs, USBPcap): download, check the signature or hash, run the maker's installer on a click
  // Get the layout: a VIA keyboard's official definition file on the person's click (helpers/via-fetch.mjs, pinned sources)
  if (url.pathname.startsWith('/api/via-fetch')) {
    try {
      const vf = await import('./helpers/via-fetch.mjs');
      if (await vf.handle(url, req, res, (rs, code, body) => {
        if (req.method === 'POST' && body?.ok && agent) { body.restart = false; setTimeout(() => { try { agent.connect('keyboard'); } catch {} }, 150); }
        return send(rs, code, body);
      }, readBody)) return;
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/installers')) { try { if (await (await import('./helpers/installers.mjs')).handle(url, req, res, send, readBody)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // board, fan and RAM lights: PawnIO and the OpenRGB inside DeviceHub as administrator, set up or removed only on a click (helpers/board-lights.mjs)
  // CPU temperature and fan speeds: LibreHardwareMonitor's library behind an on-demand elevated reader, set up or removed only on a click (helpers/cpu-sensors.mjs)
  if (url.pathname.startsWith('/api/cpu-sensors')) { try { if (await (await import('./helpers/cpu-sensors.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // Pause Wi-Fi scans while gaming: two tasks set up on a click, a pause only in the Gaming profile with the person's switch on (helpers/wifi-pause.mjs)
  if (url.pathname.startsWith('/api/wifi-pause')) { try { if (await (await import('./helpers/wifi-pause.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname.startsWith('/api/board-lights')) { try { if (await (await import('./helpers/board-lights.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  // the plain-words list of what DeviceHub supports (reads the library, opens no device)
  if (url.pathname === '/api/supported-devices') { try { if (await (await import('./helpers/supported-devices.mjs')).handle(url, req, res, send)) return; } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname.startsWith('/api/diagnose')) { try { return await (await import('./helpers/diagnose.mjs')).handle(url, req, res, send); } catch (e) { return send(res, 500, { error: e.message }); } }
  if (url.pathname === '/api/library' && req.method === 'GET') {
    try { const lib = await import('./helpers/device-library.mjs'); return send(res, 200, { matches: lib.match((await pcMap.get(url.searchParams.has('fresh'))).usb, { readOnly: true }) }); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // a "read-only" entry installs too: it loads guarded, each setting writable only once it passes its self-check
  // (helpers/my-devices.mjs); one with no real-device record only reads until the person presses Turn on settings
  // (safety round 2); it is loaded at once when the agent runs, else on the next start
  if (url.pathname === '/api/library/install' && req.method === 'POST') {
    try {
      const lib = await import('./helpers/device-library.mjs');
      // the person's click (the Set up card's Install button): an "untested" entry too, guarded like a read-only one,
      // never one with ANY product id DeviceHub's own drivers run (helpers/pc-map.js RUNS; installFromLibrary refuses
      // it too)
      const name = (await readBody(req)).name;
      const e = lib.list().find((x) => x.name === name && x.meta);
      const clash = e ? (await import('./helpers/my-devices.mjs')).ownClash(e.meta.vid, e.meta.pids) : [];
      if (clash.length) return send(res, 400, { ok: false, name, error: `DeviceHub's own driver already runs ${clash.join(', ')}, so the library driver is not installed` });
      const r = await lib.installFromLibrary(name, { readOnly: true, untested: true });
      if (r?.ok) {
        let loaded = null;
        if (agent) try { loaded = await (await import('./helpers/my-devices.mjs')).loadNew(ROOT); } catch {}
        r.loaded = !!loaded?.some((x) => x.name === r.name && x.id);
        try { (await import('./helpers/auto-setup.mjs')).cache.value = null; } catch {}   // the Set up card asks again
        if (!r.loaded) r.note = `${r.note || ''} (restart DeviceHub to load it)`.trim();
        serverLog({ kind: 'good', text: `Device library: ${r.name || 'a driver'} installed${!r.proven ? ': it reads the device; its settings change only after Turn on settings' : r.status === 'tested' ? '' : ' read-only until its self-check'}${r.loaded ? '' : ' (restart DeviceHub to load it)'}` });
      }
      return send(res, r?.ok ? 200 : 400, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // the setup summary (helpers/auto-setup.mjs): found, installed, works now, optional, still to learn. Read-only;
  // kept a minute (?fresh=1 looks again). POST /api/setup/dismiss { signature } hides the Overview's Set up card until
  // the summary says something new.
  if (url.pathname === '/api/setup' && req.method === 'GET') {
    try {
      const fresh = url.searchParams.has('fresh');
      const setup = await import('./helpers/auto-setup.mjs');
      if (!fresh && setup.cache.value && Date.now() - setup.cache.at < 60000) return send(res, 200, setup.cache.value);
      const within = (p, ms = 20000) => Promise.race([Promise.resolve().then(() => p()).catch(() => undefined), new Promise((r) => setTimeout(() => r(undefined), ms))]);
      const [pc, via, mons, cams, bt, lamps, rgb] = await Promise.all([
        within(() => pcMap.get(fresh), 70000), within(() => require('./helpers/via-defs').findKeyboards()), within(() => monitors.list(false)), within(() => camera.list(false)),
        within(() => require('./helpers/std-battery').read({})), within(async () => (await (await import('./helpers/lamparray.mjs')).findLampArrays()).map(({ fields, ...d }) => d)), within(() => openrgb.status(false))]);
      const value = setup.summary({ sources: {
        agent: agent ? agent.state() : null, usb: pc?.usb, via, monitors: mons, cameras: cams,
        bluetooth: (bt || []).map((b) => ({ name: b.name, percent: b.percent })), lamparrays: lamps, eqapo: eqapo.installed(), openrgb: rgb,
        pcLights: pc ? !!(pc.board?.model || pc.gpus?.length || pc.ram?.length) : undefined } });
      Object.assign(setup.cache, { at: Date.now(), value });
      return send(res, 200, value);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/setup/dismiss' && req.method === 'POST') {
    try { const setup = await import('./helpers/auto-setup.mjs'); const r = setup.dismiss(ROOT, (await readBody(req)).signature); setup.cache.value = null; return send(res, 200, r); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/std-battery') {
    try { const sb = require('./helpers/std-battery'); return send(res, 200, { bluetooth: await sb.read({ fresh: url.searchParams.has('fresh') }), hid: await sb.hidBatteryCaps() }); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/lamparrays') {
    try { const { findLampArrays } = await import('./helpers/lamparray.mjs'); return send(res, 200, { lamparrays: (await findLampArrays()).map(({ fields, ...d }) => d) }); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb/color' && req.method === 'POST') {
    const { target, hex, zone } = await readBody(req);
    try { const r = await openrgb.setColor(target ?? 'all', String(hex), zone ?? null); serverLog({ kind: 'good', text: `PC lights (${r.changed.join(', ')}) → ${hex}` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `PC lights: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb/restore' && req.method === 'POST') {
    try { const r = await openrgb.restore(); serverLog({ kind: 'good', text: 'PC lights put back as they were' }); return send(res, 200, r); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  // Find my lights (helpers/find-lights.js): one color per zone, the person's names saved, the lights put back
  if (url.pathname === '/api/openrgb/find' && req.method === 'GET') return send(res, 200, openrgb.findState());
  if (url.pathname === '/api/openrgb/find-start' && req.method === 'POST') {
    const { target } = await readBody(req);
    try { const r = await openrgb.findStart(target); serverLog({ kind: 'good', text: `PC lights: Find my lights on ${r.name} (${r.zones.filter((z) => z.color).length} colors)` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `PC lights: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb/find-save' && req.method === 'POST') {
    const { target, names, hidden } = await readBody(req);
    try { const r = await openrgb.findSave({ target, names, hidden }); serverLog({ kind: 'good', text: `PC lights: names saved for ${r.name}, lights put back` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `PC lights: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb/find-cancel' && req.method === 'POST') {
    try { const r = await openrgb.findCancel(); serverLog({ kind: 'good', text: 'PC lights: light test canceled, put back' }); return send(res, 200, r); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/monitors/set' && req.method === 'POST') {
    // live: a step while a slider is dragged (written without its read-back, no log line; the release is read back)
    const { id, feature, value, silent, live } = await readBody(req);
    try { const r = await monitors.set(String(id), String(feature), Number(value), { live: live === true && feature !== 'colorPreset' }); if (!silent && !live) serverLog({ kind: r.waiting ? 'info' : 'good', text: `${r.name}: ${feature === 'volume' ? 'speaker volume' : feature} → ${r.value}${r.waiting ? ' (applied when the monitor is on)' : ''}` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `Monitor ${feature}: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  // how far an update has got, for Settings' loading bar (helpers/self-update.js)
  // what the server has asked the device helper for, by kind, since it started (diagnosis of a part that keeps asking more)
  if (url.pathname === '/api/helper-calls') return send(res, 200, { uptimeS: Math.round(process.uptime()), calls: require('./helpers/native').callCounts() });
  // Publish to friends (23 Oct 2026, Shawn: "I tried to update on his but it didnt work" - nothing newer was published):
  // on the owner's PC only, how far this copy is ahead of the version on the download page, and a button that opens
  // helpers/publish-release.ps1 in its own window (build, sign, upload; its output and any question stay visible)
  if (url.pathname === '/api/publish-release') {
    const owner = await (await import('./helpers/auto-report.mjs')).isOwnerPc(ROOT).catch(() => false);
    if (!owner) return send(res, 200, { owner: false });
    if (req.method === 'POST') {
      // no window (23 Oct 2026, Shawn: "how do I know if this is done? Can it be ... auto closed?"): it runs hidden, its
      // output goes to logs/publish.log, and the Settings row shows the step it is on, then Published or what failed
      if (publishRun?.state === 'running') return send(res, 200, { owner: true, started: false, run: publishRun });
      const script = path.join(ROOT, 'helpers', 'publish-release.ps1');
      const logFile = path.join(ROOT, 'logs', 'publish.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const out = fs.openSync(logFile, 'w');
      publishRun = { state: 'running', step: 'Building', startedAt: Date.now(), log: logFile };
      const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: ROOT, windowsHide: true, stdio: ['ignore', out, out] });
      child.on('exit', (code) => {
        fs.closeSync(out);
        const text = (() => { try { return fs.readFileSync(logFile, 'utf8'); } catch { return ''; } })();
        const err = text.split(/\r?\n/).find((l) => /failed|missing from dist|not on this PC|Exception/i.test(l));
        publishRun = { ...publishRun, state: code === 0 && /Published\./.test(text) ? 'done' : 'failed', endedAt: Date.now(), error: code === 0 ? null : (err || `stopped (code ${code})`).trim().slice(0, 300) };
      });
      return send(res, 200, { owner: true, started: true, run: publishRun });
    }
    let published = null, ahead = null;
    try { const v = await require('./helpers/self-update').releaseInfo(); published = { commit: v.commit, builtAt: v.builtAt }; } catch {}
    // what this PC itself last published (dist\published.json, written by helpers/publish-release.ps1 only once the
    // upload succeeded): GitHub's download servers can hand out the old version.json for some minutes after a publish
    // (24 Oct 2026, Shawn: "i publish and this is still here"), so the newer of the two counts
    try {
      const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'published.json'), 'utf8').replace(/^\uFEFF/, ''));
      if (local?.commit && (!published || Date.parse(local.builtAt) > Date.parse(published.builtAt))) published = { commit: local.commit, builtAt: local.builtAt };
    } catch {}
    if (published?.commit) {
      const c = String(published.commit).replace(/-modified$/, '');
      try { ahead = Number(require('child_process').execFileSync('git', ['rev-list', '--count', `${c}..HEAD`], { cwd: ROOT, windowsHide: true, timeout: 10000, encoding: 'utf8' }).trim()); } catch {}
    }
    let keyHere = null;
    try { keyHere = (await import('./helpers/signing-key.mjs')).keyAvailable(); } catch {}
    if (publishRun?.state === 'running') {
      try { const t = fs.readFileSync(publishRun.log, 'utf8'); publishRun.step = /Published\./.test(t) ? 'published; finishing Setup.exe' : /Uploading/.test(t) ? 'Uploading' : /built .*Setup\.exe/.test(t) ? 'Uploading' : /built .*setup\.zip/.test(t) ? 'Building the installer' : /library bundle signed/.test(t) ? 'Packing the zip' : 'Building'; } catch {}
    }
    return send(res, 200, { owner: true, published, ahead, keyHere, run: publishRun });
  }
  if (url.pathname === '/api/self-update/progress') return send(res, 200, require('./helpers/self-update').getProgress() || {});
  if (url.pathname === '/api/self-update') {
    const su = require('./helpers/self-update');
    if (req.method === 'GET') {
      const st = await su.status();
      if (!st.behind) updateNotice = null;
      return send(res, 200, st);
    }
    try {
      // Update anyway (23 Oct 2026): over files changed on this PC, a copy of each kept first (self-update.js)
      const body = await readBody(req).catch(() => ({}));
      const r = await su.update({ overwrite: body?.overwrite === true });
      send(res, 200, r);
      // a copy installed from the zip: the new version's installer is already running; it quits and restarts DeviceHub
      afterSelfUpdate(r);
      return;
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  // Updates (helpers/updates.js): versions, the vendors' newest, and their own updaters. DeviceHub never flashes.
  if (url.pathname === '/api/updates' && req.method === 'GET') return send(res, 200, await updates.status(url.searchParams.has('force')));
  if (url.pathname === '/api/updates/open' && req.method === 'POST') { const { app } = await readBody(req); return send(res, 200, await updates.open(app)); }
  if (url.pathname === '/api/updates/done' && req.method === 'POST') {
    const { app } = await readBody(req);
    await updates.close(app);
    // re-read the device so its new firmware version shows (the agent switches the headset back to direct mode itself)
    const id = { pulsar: 'mouse', icue: 'headset' }[app];
    if (agent && id) { await new Promise((r) => setTimeout(r, 3000)); try { await agent.op('connect', { id }); } catch {} }
    serverLog({ kind: 'info', device: id, text: `Closed ${app === 'pulsar' ? 'the Pulsar app' : 'iCUE'} after checking for updates` });
    return send(res, 200, { ok: true, info: agent && id ? agent.snapshot(id).info : null });
  }
  // Battery time left, from the recorded levels (helpers/battery-history.js).
  if (url.pathname === '/api/battery-estimate') return send(res, 200, batteryHistory.estimates());
  // the battery graph on the device pages: ?id=mouse|headset|<added device id>&days=1..7
  if (url.pathname === '/api/battery-history') {
    const id = url.searchParams.get('id'), days = Math.min(7, Math.max(1, Number(url.searchParams.get('days')) || 7));
    if (!batteryHistory.validId(id)) return send(res, 400, { error: 'id must be mouse, headset or an added device\'s id' });
    return send(res, 200, batteryHistory.history(id, days));
  }
  // Windows pointer settings (helpers/pointer.cs, the native helper's "pointer" channel): read; or back up, change ONE,
  // read back. Changes seconds apart (a slider dragged) share the backup taken before the first; live steps log nothing.
  if (url.pathname === '/api/pointer') {
    const run = async (args) => { const r = await require('./helpers/native').request('pointer', args.length ? `SET ${args[1]} ${args[3]}` : 'GET', 5000); try { return JSON.parse(r); } catch { return { ok: false, error: r === 'GONE' ? 'the device helper is not running' : 'no answer in time' }; } };
    if (req.method !== 'POST') return send(res, 200, await run([]));
    const { key, value, live } = await readBody(req);
    const KEYS = { speed: (v) => Number.isInteger(v) && v >= 1 && v <= 20, precision: (v) => typeof v === 'boolean', scrollLines: (v) => v === -1 || (Number.isInteger(v) && v >= 1 && v <= 100), doubleClick: (v) => Number.isInteger(v) && v >= 200 && v <= 900 };
    if (!KEYS[key] || !KEYS[key](value)) return send(res, 400, { error: 'not a valid pointer setting' });
    const before = await run([]);
    if (!before.ok) return send(res, 500, { error: before.error });
    if (!(Date.now() - pointerBackupAt < 15000)) {
      writeAtomic(path.join(BACKUPS, `windows-pointer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ device: 'windows-pointer', takenAt: new Date(), why: `before ${key}`, data: before }, null, 2));
      pointerBackupAt = Date.now();
    }
    const after = await run(['-Set', key, '-Value', String(key === 'precision' ? (value ? 1 : 0) : value)]);
    if (!after.ok) return send(res, 500, { error: after.error });
    if (after[key] !== value) return send(res, 500, { error: `Windows reads ${after[key]} after setting ${value}` });
    if (!live) serverLog({ kind: 'good', device: 'mouse', text: `Windows ${({ speed: 'pointer speed', precision: 'pointer precision', scrollLines: 'scroll lines', doubleClick: 'double-click speed' })[key]}: ${before[key]} → ${value}` });
    return send(res, 200, after);
  }
  // Settings > Uninstall (20 Oct 2026): the page has asked already; helpers/uninstall.ps1 runs on its own (it quits
  // DeviceHub, closes this window and deletes the folder) and says something only if it could not finish
  if (url.pathname === '/api/uninstall' && req.method === 'POST') {
    if (fs.existsSync(path.join(ROOT, '.git')) && !/DeviceHub-download/.test(readText(path.join(ROOT, '.git', 'config')))) return send(res, 409, { error: 'This is a development copy of DeviceHub (it has code history), so it is not removed.' });
    // the Apps entry this copy was installed under (DeviceHub, or another name for a test install)
    let key = 'DeviceHub';
    try {
      const out = require('child_process').execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/v', 'InstallLocation'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
      let cur = null;
      for (const l of out.split(/\r?\n/)) {
        if (/^HKEY_/.test(l)) cur = l.split('\\').pop().trim();
        else if (/InstallLocation\s+REG_SZ\s+/.test(l) && path.resolve(l.split(/REG_SZ\s+/)[1].trim()).toLowerCase() === path.resolve(ROOT).toLowerCase()) key = cur;
      }
    } catch {}
    // not detached: from DeviceHub's hidden window a detached PowerShell never started (measured 20 Oct 2026). It
    // outlives the server it quits all the same (Windows does not end a child with its parent).
    // (27 Oct 2026) the page's one unticked box: also empty Equalizer APO's config.txt when DeviceHub wrote it
    const clearEq = (await readBody(req).catch(() => ({})))?.clearEq === true;
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'helpers', 'uninstall.ps1'), '-Key', key, '-Port', String(PORT), '-FromApp', ...(clearEq ? ['-ClearEq'] : [])], { stdio: 'ignore', windowsHide: true, cwd: require('os').tmpdir() });   // not in the folder it deletes
    p.on('error', (e) => console.log(`[uninstall] could not start: ${e.message}`));
    p.unref();
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/quit' && req.method === 'POST') {
    send(res, 200, { ok: true });
    setTimeout(shutdown, 200);
    return;
  }
  if (url.pathname.startsWith('/api/corsair/')) {
    if (!corsair) return send(res, 503, { error: 'Corsair helper not available' });
    const action = url.pathname.slice('/api/corsair/'.length);
    if (req.method !== 'POST' && action !== 'devices') return send(res, 405, { error: 'use POST' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    return send(res, 200, await corsair.handle(action, body));
  }
  return send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // DNS rebinding guard: a page on another name that resolves to 127.0.0.1 still sends its own Host.
  if (!HOSTS.has(String(req.headers.host).toLowerCase())) return send(res, 421, 'wrong host', 'text/plain');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    // isolated test mode: the window runs on the demo devices (public/devices/demo.js), so it never opens WebHID itself
    if (ISOLATED && file === path.join(PUBLIC, 'index.html')) return send(res, 200, fs.readFileSync(file, 'utf8').replace('<script type="module" src="app.js"></script>', '<script>window.DEVICEHUB_DEMO = true; window.DEVICEHUB_ISOLATED = true;</script>\n  <script type="module" src="app.js"></script>'), 'text/html');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).on('error', (e) => {
  // The launcher starts a server every time; if one is already running, this copy just leaves. But the port may be
  // another program's (20 Oct 2026): then say so (server.log, which the launcher shows) and stop with code 4, which
  // the keep-running loop does not retry
  if (e.code === 'EADDRINUSE') {
    const taken = () => { console.log(`[start] Port ${PORT} is used by another program, so DeviceHub cannot start. Close that program, or start DeviceHub with DEVICEHUB_PORT set to a free port.`); process.exit(4); };
    const q = require('http').get({ host: '127.0.0.1', port: PORT, path: '/api/version', timeout: 2000 }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => {
        if (/"version"/.test(b)) { console.log('DeviceHub is already running'); process.exit(0); }
        taken();
      });
    });
    // a program that takes the connection but never answers: the timeout only reports, so end it here
    q.on('timeout', () => q.destroy(new Error('no answer')));
    q.on('error', taken);
    return;
  }
  throw e;
}).listen(PORT, '127.0.0.1', async () => {
  console.log(`DeviceHub on http://localhost:${PORT}`);
  // a save cut off by a crash leaves a temporary file beside the whole old one: tidy those away
  for (const d of [ROOT, path.join(ROOT, 'data'), BACKUPS, path.join(ROOT, 'setups')]) require('./helpers/safe-write').cleanLeftovers(d);
  // isolated test mode: none of the background parts below (self-update, agent, auto setup, library updates, audio,
  // battery saver, Anker guard, settings sync, receiver light, backup tidy, battery history, tray)
  if (ISOLATED) { console.log('[isolated] test mode: no devices, helper, iCUE, OpenRGB, tray, sync or updates'); return; }
  // what the window's live stream pushes (27 Oct 2026, see helloNow): new files in public/ (an update, an edit), a new
  // backup (the Backups shield), the battery saver turning on or off; read only while a window is open
  windowEvents.watchFolder(PUBLIC, () => { if (!hub.count()) return; const v = appVersion(); if (v !== pushedVersion) { pushedVersion = v; hub.push('version', { version: v }); } }, { recursive: true, waitMs: 1500 });
  windowEvents.watchFolder(BACKUPS, () => { if (!hub.count()) return; const at = windowEvents.lastBackupAt(BACKUPS); if (at !== pushedBackup) { pushedBackup = at; hub.push('backup', { at }); } });
  require('./helpers/power').onChange(() => hub.push('power', require('./helpers/power').state()));
  // automatic problem reports to Shawn (helpers/auto-report.mjs): the helper's problems as they happen, and 2 minutes
  // in, whether this run started after DeviceHub stopped with an error. Never from the owner's own PC.
  let autoReport = null;
  try {
    autoReport = await import('./helpers/auto-report.mjs');
    autoReport.start({ root: ROOT, port: PORT });
    require('./helpers/native').onProblem((code, text) => autoReport.helperProblem(code, text));
    setTimeout(() => { try { autoReport.checkCrash(); } catch {} }, 120000).unref();
  } catch (e) { console.error('[report] not started:', e.message); }
  // just updated: a minute running well keeps the new version (else the keep-running loop goes back, self-update.js)
  const justUpdated = require('./helpers/self-update').confirm(serverLog);
  // A NEW VERSION IS READY (helpers/update-notice.mjs, 24 Oct 2026, Shawn: no updates by themselves and no checks every
  // 6 hours, but a pop-up that says there is an update): one check 2 minutes after start, never on the owner's PC; the
  // window then asks once, Update or Later. Updating stays the person's click. Not on the start right after an update
  // (24 Oct 2026, Shawn: no second update offered straight after one); the next start checks as usual.
  if (justUpdated) console.log('[update] just updated: no update check this start');
  else if (process.env.DEVICEHUB_TEST !== '1') {
    const t = setTimeout(async () => {
      try {
        const owner = await import('./helpers/auto-report.mjs').then((m) => m.isOwnerPc(ROOT)).catch(() => true);
        updateNotice = (await import('./helpers/update-notice.mjs')).notice({ owner, status: await require('./helpers/self-update').status() });
        if (updateNotice) hub.push('notice', { notice: updateNotice });   // an open window asks at once (app.js)
      } catch (e) { console.error('[update] check:', e.message); }
    }, 120000);
    t.unref?.();
  }
  // The agent owns the devices (set DEVICEHUB_AGENT=0 to fall back to the browser's own WebHID connection).
  if (AGENT_ON) {
    // LIBRARY AT START (helpers/library-updates.mjs startup, 24 Oct 2026): the signed library fetched now (a 304 when
    // nothing changed), waited for up to 4 s, and any newer driver put into its my-devices copy BEFORE the drivers load,
    // so a fix published since the last start (or shipped in an app update) runs at once
    if (process.env.DEVICEHUB_TEST !== '1') {
      try {
        const r = await (await import('./helpers/library-updates.mjs')).startup({ root: ROOT, log: serverLog, waitMs: 4000 });
        console.log(`[library] at start (${r.reason || 'start'}): ${r.skipped || (r.pending ? 'still fetching' : r.ok ? (r.unchanged ? 'unchanged' : `${(r.changed || []).length} changed`) : r.error)}; ${(r.refreshed?.replaced || []).length} driver(s) updated`);
      } catch (e) { console.error('[library] at start:', e.message); }
    }
    try {
      agent = await import('./helpers/agent.mjs');
      await agent.start({ port: PORT, corsairHelper: corsair });
      console.log('[agent] running');
      if (process.env.DEVICEHUB_TEST !== '1') import('./helpers/auto-setup.mjs').then((m) => m.startup({ root: ROOT, pcMap, log: serverLog })).catch((e) => console.error('[setup] auto setup:', e.message));  // AUTO SETUP (helpers/auto-setup.mjs): library drivers for this PC's USB devices
      if (process.env.DEVICEHUB_TEST !== '1') import('./helpers/library-updates.mjs').then((m) => m.schedule({ root: ROOT, log: serverLog })).catch((e) => console.error('[library] updates:', e.message));  // LIBRARY UPDATES: the signed library bundle every 3 hours (and at start, above)
    } catch (e) { agent = null; console.error('[agent] could not start:', e); autoReport?.agentFailed(String(e?.message || e)); }
  }
  agentTried = true;   // /api/events opens now, with or without the agent
  // DeviceHub's handling of Windows' speakers (helpers/audio-follow.js: one HS80 connection at a time, apps following
  // a new default) is OFF unless settings.json has "audioSwitching": true. Off since 19 Oct 2026: Shawn's Windows
  // sound menu stopped switching smoothly while it ran; Windows alone decides the speaker.
  let audioOn = false; try { audioOn = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).audioSwitching === true; } catch {}
  if (corsair && audioOn) audioFollow.start(corsair.handle, serverLog);
  // the Anker camera mic: muted unless a Google Meet or Chat call uses it (helpers/anker-guard.js)
  // battery saver first: the other background checks read it (helpers/power.js)
  // DEVICEHUB_TEST=1 (a test install beside the real one, 20 Oct 2026): none of the background parts that touch the
  // devices or Windows sound, so two copies never fight over them
  const TEST = process.env.DEVICEHUB_TEST === '1';
  if (corsair && !TEST) require('./helpers/power').start(corsair.handle, SETTINGS);
  if (corsair && !TEST) ankerGuard.start(corsair.handle, serverLog, SETTINGS);
  // settings sync between PCs through the private settings repository (helpers/settings-sync.js)
  if (!TEST) settingsSync.start(eqapo, serverLog, { windowOpen: () => openWindows > 0 });
  if (!TEST) receiverLight.start(require('./helpers/hs80-direct').icueRunning, serverLog);
  // old backups into backups\older-backups.zip, recent ones and the first of each kind kept (helpers/backup-tidy.js)
  if (!TEST) require('./helpers/backup-tidy').start(BACKUPS, serverLog);
  // the PC check read once in the background, so the PC page opens with it (helpers/pc-check.js)
  if (!TEST) setTimeout(() => { require('./helpers/pc-check').check(true).catch(() => {}); }, 30000).unref();
  // start-up impact: watched for the first minutes after sign-in when DeviceHub started with Windows (helpers/startup-impact.js)
  if (!TEST && !ISOLATED) setTimeout(() => { const s = require('./helpers/startup-impact'); s._test.deps.log = (text) => serverLog({ kind: 'info', text }); s.measureAtSignIn(); }, 5000).unref();
  // Wi-Fi pause: a pause left from before this start (a crash, a restart) is ended; only when it was set up (helpers/wifi-pause.mjs)
  if (!TEST) setTimeout(() => import('./helpers/wifi-pause.mjs').then((w) => { w.deps.log = (text) => serverLog({ kind: 'info', text }); return w.onStart(); }).catch(() => {}), 20000).unref?.();
  require('./helpers/hs80-direct').setLog(serverLog);
  if (agent) batteryHistory.start(ROOT, () => agent.state());
  // Tray icon, inside the native helper (helpers/native/tray.cs); it quits DeviceHub through /api/quit.
  if (agent && process.env.DEVICEHUB_TRAY !== '0') {
    const native = require('./helpers/native');
    const startTray = () => native.request('tray', `START ${PORT} ${ROOT}`, 15000).then((r) => { tray = r === 'OK'; });
    startTray();
    // the helper restarted (it stopped or was updated): bring the icon back, unless DeviceHub is quitting
    native.onExit(() => { tray = false; if (!quitting) setTimeout(startTray, 1500); });
    // DeviceHub's window gets its own taskbar identity and its full-resolution icon (helpers/native/winbrand.cs);
    // a quick look at the open windows every 5 s, acting only on a DeviceHub window not labelled yet
    // The taskbar gets a copy of the icon named after its contents: Windows caches icons by file name, so a new icon
    // under the old name kept showing the old picture (19 Oct 2026, the D after the change to Port).
    let ico = path.join(ROOT, 'DeviceHub.ico');
    try {
      const data = fs.readFileSync(ico);
      const tag = require('crypto').createHash('sha1').update(data).digest('hex').slice(0, 8);
      const dir = path.join(ROOT, 'icons-cache');
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f !== `DeviceHub-${tag}.ico`) fs.unlinkSync(path.join(dir, f));
      const copy = path.join(dir, `DeviceHub-${tag}.ico`);
      if (!fs.existsSync(copy)) writeAtomic(copy, data);
      ico = copy;
    } catch (e) { console.error('[icon] copy', e.message); }
    const relaunch = `wscript.exe "${path.join(ROOT, 'DeviceHub.vbs')}"`;
    // only while a DeviceHub window is open (26 Oct 2026, idle CPU: with none open it was a helper call every 5 s for nothing)
    const brand = () => { if (!quitting && openWindows > 0) native.request('win', `BRAND ${ico}|${relaunch}`, 5000).catch(() => {}); setTimeout(brand, require('./helpers/power').every(5000)); };
    setTimeout(brand, 5000);
  }
});

const AGENT_ON = process.env.DEVICEHUB_AGENT !== '0';
let agent = null, agentTried = false;
let tray = false;
let quitting = false;
async function shutdown() {
  if (ISOLATED) process.exit(0);   // isolated test mode started nothing to stop (helpers/openrgb.js stop() would remove the real copy's pid file)
  // an AnkerCamera test running: muted again first (at most 1.5 s), while the audio helper is still there
  try { await Promise.race([ankerGuard.shutdown(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  try { agent?.stop(); } catch {}
  try { audioFollow.stop(); } catch {}
  try { batteryHistory.stop(); } catch {}
  try { receiverLight.stop(); } catch {}
  try { openrgb.stop(); } catch {}  // the bundled OpenRGB, if DeviceHub started it
  // Wi-Fi scans back on if DeviceHub paused them (best effort, 1.5 s at most; the task's own watcher and sign-in resume too)
  try { await (await import('./helpers/wifi-pause.mjs')).onQuit(); } catch {}
  try { require('./helpers/native').stop(); } catch {}
  quitting = true;
  process.exit(0);
}
process.on('SIGINT', shutdown);
