// DeviceHub local server: serves the dashboard on http://localhost:5577 (localhost counts as a
// secure context, so WebHID works in Chrome/Edge), writes settings backups to ./backups, and
// launches vendor apps. Binds to 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const { writeAtomic } = require('./helpers/safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;  // a test copy can use another port
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const BACKUPS = path.join(ROOT, 'backups');
const PROFILES = path.join(ROOT, 'profiles.json');
const ACTIVITY = path.join(ROOT, 'activity.jsonl');
const SETTINGS = path.join(ROOT, 'settings.json');
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
let clientStatus = null;
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
      const g = ((await corsair.handle('usb-headsets', {})).headsets || []).find((x) => generic || !/^VID_1B1C&PID_0A6/.test(x.usb));
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
monitors.start(require('./helpers/native'), BACKUPS, (text, bad) => serverLog({ kind: bad ? 'bad' : 'good', text }));  // the last: changes made while a monitor was off, applied
const camera = require('./helpers/camera');
camera.start(require('./helpers/native'), BACKUPS);
let openWindows = 0;
let pointerBackupAt = 0;   // when the Windows pointer settings were last backed up (/api/pointer)
const pcMap = require('./helpers/pc-map');
const openrgb = require('./helpers/openrgb');
// DeviceHub's own devices are never written through OpenRGB as well (its location names their vendor:product)
openrgb.start(BACKUPS, { ownDevice: new RegExp(Object.keys(pcMap.RUNS).map((id) => { const [v, p] = id.split(':'); return `vid_${v}&pid_${p}`; }).join('|'), 'i') });
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
try { corsair = require('./helpers/corsair'); } catch (e) { console.log('[corsair] helper not loaded:', e.message); }
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

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

async function api(req, res, url) {
  // Only the dashboard itself may call the API: other web pages are refused by Origin, and anything that changes
  // state must be a POST (a page can make a browser send a GET, e.g. with an <img>, without an Origin header).
  const origin = req.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) return send(res, 403, { error: 'origin' });
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'method' });

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
  if (url.pathname === '/api/version') return send(res, 200, { version: appVersion() });
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
    const helperLine = await require('./helpers/native').request('diag', 'MEM', 15000);
    const helperMB = Number((/private=([\d.]+)MB/.exec(helperLine) || [])[1]) || null;
    let crashes = 0, lastCrashAt = null;
    try {
      const since = Date.now() - 24 * 3600 * 1000;
      for (const f of ['server.log', 'server.old.log']) {
        const p = path.join(ROOT, f);
        if (!fs.existsSync(p)) continue;
        for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
          const mm = /^\[launcher\] (.+?) server exited/.exec(l);
          // code -1 is a process stopped from outside (a restart), not a crash
          if (mm && !/exited with code -1;/.test(l)) {
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
    return send(res, 200, { uptimeS: Math.round(process.uptime()), serverMB: +(m.rss / 1048576).toFixed(0), heapMB: +(m.heapUsed / 1048576).toFixed(0), helperMB: helperMB && Math.round(helperMB), crashes24h: crashes, lastCrashAt: lastCrashAt ? new Date(lastCrashAt).toISOString() : null, lastProblem, backups });
  }
  // Settings > Save a report: one text file someone can send to whoever helps them. Health, versions, the devices'
  // state, the end of the server log and Activity, the settings and seen devices. No backups, no profiles. Read-only.
  // the short report (20 Oct 2026): what someone helping (a friend, or their Claude Code) needs first, to paste into a
  // message; no settings, profiles or activity history. Settings > Health > Copy for help
  if (url.pathname === '/api/report/short') {
    const os = require('os');
    const lines = [`DeviceHub ${appVersion()} · Windows build ${os.release()} · Node ${process.version} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`];
    try { const h = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json(); lines.push(`running ${Math.round((h.uptimeS || 0) / 60)} min · ${h.serverMB + (h.helperMB || 0)} MB · crashes today: ${h.crashes24h || 0}`); } catch {}
    if (agent) for (const d of agent.state().devices) lines.push(`${d.id}: ${d.status}${d.info?.Model ? ` (${d.info.Model})` : ''}${d.error ? ` · ${d.error}` : ''}`);
    else lines.push('devices: no background agent');
    try { const pc = await pcMap.get(); lines.push(`PC: ${pc.cpu} · ${pc.gpus.map((g) => g.name).join(', ')} · ${pc.board?.maker || ''} ${pc.board?.model || ''}`.trim());
      const other = pc.usb.filter((u) => !u.runs).map((u) => `${u.id}${u.name ? ` ${u.name}` : ''}`);
      if (other.length) lines.push(`other USB: ${other.join('; ')}`); } catch (e) { lines.push(`PC: not read (${e.message})`); }
    try { if (eqapo.installed()) { const d = await eqDevices(); const off = (await require('./helpers/eqapo-devices').status({ render: d.headset, capture: d.mic })).off; lines.push(`Equalizer APO: installed${off.length ? ` · not on for ${off.map((x) => x.name).join(', ')}` : ''}`); } else lines.push('Equalizer APO: not installed'); } catch {}
    try { const m = await monitors.list(); lines.push(`monitors: ${m.map((x) => `${x.name}${x.ddc ? '' : ' (no DDC/CI)'}`).join(', ') || 'none'}`); } catch {}
    const tail = (f, n) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').trim().split('\n').slice(-n); } catch { return []; } };
    const bad = tail('activity.jsonl', 400).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((a) => a && a.kind === 'bad').slice(-8);
    if (bad.length) lines.push('', 'recent problems:', ...bad.map((a) => `  ${a.at.slice(5, 16).replace('T', ' ')} ${a.device ? a.device + ': ' : ''}${a.text}`));
    const errs = tail('server.log', 400).filter((l) => /error|fail|cannot|\[start\]/i.test(l)).slice(-8);
    if (errs.length) lines.push('', 'log:', ...errs.map((l) => `  ${l.slice(0, 200)}`));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(lines.join('\n'));
  }
  if (url.pathname === '/api/report') {
    const tail =(f, n) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').trim().split('\n').slice(-n).join('\n'); } catch { return '(none)'; } };
    const json = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').trim(); } catch { return '(none)'; } };
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
  // The app reports what it sees (for troubleshooting) and keeps a change history across restarts.
  if (url.pathname === '/api/client-status') {
    if (req.method === 'POST') { clientStatus = { at: new Date(), ...(await readBody(req)) }; return send(res, 200, { ok: true }); }
    return send(res, 200, clientStatus || {});
  }
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
    spawn('explorer.exe', [ROOT], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') return send(res, 200, readJsonFile(SETTINGS, {}));
    if (req.method === 'POST') {
      // A POST changes only the keys it names, and only known keys with the right type (window and tray both write here).
      const cur = readJsonFile(SETTINGS, {});
      const b = await readBody(req);
      for (const [k, type] of Object.entries({ autoSwitch: 'boolean', defaultProfile: 'string', artStyle: 'string', ankerGuard: 'boolean', batterySaver: 'boolean', settingsSync: 'boolean', lightWindow: 'boolean', batteryCare: 'boolean' })) if (typeof b[k] === type) cur[k] = type === 'string' ? b[k].slice(0, 100) : b[k];
      if (cur.artStyle && !['photo', 'frosted', 'blueprint', 'neon', 'pop', 'arctic', 'studio', 'glow', 'matte', 'night'].includes(cur.artStyle)) delete cur.artStyle;  // Settings > Appearance
      writeAtomic(SETTINGS, JSON.stringify(cur, null, 2));
      agent?.reloadSettings();
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
  // Whether this server runs an agent (the window must then never open the devices itself), and whether it is up.
  if (url.pathname === '/api/agent-config') return send(res, 200, { agent: AGENT_ON, ready: !!agent });
  // The background agent (helpers/agent.mjs): state, live events, and operations for the window and the tray.
  if (url.pathname.startsWith('/api/agent/')) {
    if (!agent) return send(res, 503, { error: 'agent not running' });
    const name = url.pathname.slice('/api/agent/'.length);
    if (name === 'state' && req.method === 'GET') return send(res, 200, agent.state());
    if (name === 'events' && req.method === 'GET') {
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
          for (const [k, type] of Object.entries({ autoSwitch: 'boolean', defaultProfile: 'string', artStyle: 'string', ankerGuard: 'boolean' })) if (typeof b.settings[k] === type) cur[k] = type === 'string' ? b.settings[k].slice(0, 100) : b.settings[k];
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
  if (url.pathname === '/api/eq' && req.method === 'GET' && eqapo.installed()) {
    try {
      const r = await eqapo.read();
      const d = await eqDevices();
      r.notOn = (await require('./helpers/eqapo-devices').status({ render: d.headset, capture: d.mic })).off;
      return send(res, 200, r);
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname.startsWith('/api/eq') && eqapo.installed()) {
    const act = url.pathname.slice('/api/eq'.length);
    const ops = { '': 'read', '/save': 'save', '/activate': 'activate', '/preview': 'preview', '/headroom': 'setHeadroom', '/extras': 'setExtras' };
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
  // monitors over DDC/CI (helpers/monitors.js): read, and one setting at a time (backed up, read back)
  if (url.pathname === '/api/monitors') {
    try { return send(res, 200, await monitors.list(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
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
  // the graphics card's temperature, fan, load and power, read-only (helpers/gpu.js; the Fans page)
  if (url.pathname === '/api/gpu') return send(res, 200, await require('./helpers/gpu').read());
  if (url.pathname === '/api/bluetooth') {
    try { return send(res, 200, await pcMap.bluetooth(url.searchParams.has('fresh'))); } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb') return send(res, 200, await openrgb.status(url.searchParams.has('fresh')));
  if (url.pathname === '/api/openrgb/color' && req.method === 'POST') {
    const { target, hex } = await readBody(req);
    try { const r = await openrgb.setColor(target ?? 'all', String(hex)); serverLog({ kind: 'good', text: `PC lights (${r.changed.join(', ')}) → ${hex}` }); return send(res, 200, r); }
    catch (e) { serverLog({ kind: 'bad', text: `PC lights: ${e.message}` }); return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/openrgb/restore' && req.method === 'POST') {
    try { const r = await openrgb.restore(); serverLog({ kind: 'good', text: 'PC lights put back as they were' }); return send(res, 200, r); }
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
  if (url.pathname === '/api/self-update/progress') return send(res, 200, require('./helpers/self-update').getProgress() || {});
  if (url.pathname === '/api/self-update') {
    const su = require('./helpers/self-update');
    if (req.method === 'GET') return send(res, 200, await su.status());
    try {
      const r = await su.update();
      send(res, 200, r);
      // a copy installed from the zip: the new version's installer is already running; it quits and restarts DeviceHub
      if (r.installing) serverLog({ kind: 'good', text: `Installing the ${r.latest}; DeviceHub restarts by itself` });
      else if (r.updated) { serverLog({ kind: 'good', text: `DeviceHub updated (${r.count} change${r.count === 1 ? '' : 's'}): restarting` }); setTimeout(() => process.exit(3), 600); }
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
  // the battery graph on the device pages: ?id=mouse|headset&days=1..7
  if (url.pathname === '/api/battery-history') {
    const id = url.searchParams.get('id'), days = Math.min(7, Math.max(1, Number(url.searchParams.get('days')) || 7));
    if (!['mouse', 'headset'].includes(id)) return send(res, 400, { error: 'id must be mouse or headset' });
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
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'helpers', 'uninstall.ps1'), '-Key', key, '-Port', String(PORT), '-FromApp'], { stdio: 'ignore', windowsHide: true, cwd: require('os').tmpdir() });   // not in the folder it deletes
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
  for (const d of [ROOT, BACKUPS, path.join(ROOT, 'setups')]) require('./helpers/safe-write').cleanLeftovers(d);
  // just updated: a minute running well keeps the new version (else the keep-running loop goes back, self-update.js)
  require('./helpers/self-update').confirm(serverLog);
  // The agent owns the devices (set DEVICEHUB_AGENT=0 to fall back to the browser's own WebHID connection).
  if (AGENT_ON) {
    try {
      agent = await import('./helpers/agent.mjs');
      await agent.start({ port: PORT, corsairHelper: corsair });
      console.log('[agent] running');
    } catch (e) { agent = null; console.error('[agent] could not start:', e); }
  }
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
  if (!TEST) settingsSync.start(eqapo, serverLog);
  if (!TEST) receiverLight.start(require('./helpers/hs80-direct').icueRunning, serverLog);
  // old backups into backups\older-backups.zip, recent ones and the first of each kind kept (helpers/backup-tidy.js)
  if (!TEST) require('./helpers/backup-tidy').start(BACKUPS, serverLog);
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
    const brand = () => { if (!quitting) native.request('win', `BRAND ${ico}|${relaunch}`, 5000).catch(() => {}); setTimeout(brand, require('./helpers/power').every(5000)); };
    setTimeout(brand, 5000);
  }
});

const AGENT_ON = process.env.DEVICEHUB_AGENT !== '0';
let agent = null;
let tray = false;
let quitting = false;
async function shutdown() {
  // an AnkerCamera test running: muted again first (at most 1.5 s), while the audio helper is still there
  try { await Promise.race([ankerGuard.shutdown(), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  try { agent?.stop(); } catch {}
  try { audioFollow.stop(); } catch {}
  try { batteryHistory.stop(); } catch {}
  try { receiverLight.stop(); } catch {}
  try { require('./helpers/native').stop(); } catch {}
  quitting = true;
  process.exit(0);
}
process.on('SIGINT', shutdown);
