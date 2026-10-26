// Closing DeviceHub's own window when it is not in use (26 Oct 2026; public/core/idle-close.js asks, server.js
// /api/window/idle-close). DeviceHub's own window is a Chrome (or Edge) started by DeviceHub.vbs with
// --user-data-dir=<DeviceHub>\window-profile: a browser of its own, ~600 MB, that nothing else uses. Closing it ends
// that browser's processes and nothing else.
//   - only the processes whose --user-data-dir IS this copy's window-profile folder, and their children: never the
//     person's own Chrome or Edge (another profile, or none named), never a window-profile of another folder
//   - only when the page asking is inside that browser: the request's TCP connection is traced to the process that
//     owns it (netstat), and that process must be one of the window-profile processes. A DeviceHub tab in the
//     person's own Chrome (the low-memory window, or a tab they opened) is never closed from here: the page is told
//     to close only itself (window.close(), app windows only)
//   - first a normal close (taskkill without /F: Chrome closes its windows and exits as when the X is pressed), then,
//     only if that browser is still there after 8 s and is still the same window-profile browser, /F
// The page it was on is kept (in memory, 12 h) for the next window: GET /api/window/resume.
// deps (tests): procs() the running chrome.exe / msedge.exe, netstat() its text, kill(pid, force), now()
const path = require('path');
const { execFile } = require('child_process');

const run = (cmd, args, ms = 10000) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: ms, maxBuffer: 8 << 20, encoding: 'utf8' }, (e, out) => resolve(e && !out ? null : String(out || ''))));

// wmic's CSV: Node,CommandLine,Name,ParentProcessId,ProcessId (the command line may hold commas, so the last three
// columns are read from the right)
function parseWmicCsv(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || /^Node,/i.test(l)) continue;
    const parts = l.split(',');
    if (parts.length < 5) continue;
    const pid = Number(parts.pop()), ppid = Number(parts.pop()), name = parts.pop();
    const cmd = parts.slice(1).join(',');
    if (Number.isInteger(pid) && pid > 0) out.push({ pid, ppid: Number.isInteger(ppid) ? ppid : 0, name, cmd });
  }
  return out;
}

// the --user-data-dir a Chrome command line names ("..." or bare), or null
function userDataDir(cmd) {
  const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/i.exec(String(cmd || ''));
  return m ? (m[1] || m[2]) : null;
}
const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
const isBrowser = (p) => /^(chrome|msedge)\.exe$/i.test(p.name || '');

// The window-profile browser: its main process (the one without --type=) and every process under it.
// { main, pids: Set } or null when DeviceHub's own window is not open.
function ownWindow(procs, root) {
  const want = norm(path.join(root, 'window-profile'));
  const mine = procs.filter((p) => isBrowser(p) && userDataDir(p.cmd) && norm(userDataDir(p.cmd)) === want);
  const main = mine.find((p) => !/--type=/i.test(p.cmd));
  if (!main) return null;
  const pids = new Set([main.pid]);
  // children by parent id (the main's whole tree); a process is added only once, so a parent loop cannot run forever
  for (let grew = true; grew;) {
    grew = false;
    for (const p of procs) if (!pids.has(p.pid) && pids.has(p.ppid) && p.pid !== p.ppid) { pids.add(p.pid); grew = true; }
  }
  return { main, pids };
}

// netstat -ano: the process that owns the client end of a connection to the server (local port = the request's remote
// port, foreign port = the server's)
function connectionOwner(text, clientPort, serverPort) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+\S+\s+(\d+)\s*$/i.exec(line);
    if (m && Number(m[2]) === Number(clientPort) && Number(m[4]) === Number(serverPort) && /^(127\.0\.0\.1|\[::1\]|\[::ffff:127\.0\.0\.1\])$/.test(m[1])) return Number(m[5]);
  }
  return null;
}

const deps = {
  async procs() {
    const out = await run('wmic', ['process', 'where', "name='chrome.exe' or name='msedge.exe'", 'get', 'CommandLine,Name,ParentProcessId,ProcessId', '/format:csv'], 15000);
    if (out != null) return parseWmicCsv(out);
    // a Windows without wmic: the same list from PowerShell, once (only when a window is about to be closed)
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | ForEach-Object { 'x,' + ($_.CommandLine -replace '[\\r\\n]', ' ') + ',' + $_.Name + ',' + $_.ParentProcessId + ',' + $_.ProcessId }";
    return parseWmicCsv(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 15000));
  },
  netstat: () => run('netstat', ['-ano', '-p', 'TCP'], 10000),
  kill: (pid, force) => run('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], 15000),
  now: () => Date.now(),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

let resume = null, lastClose = null;
const RESUME_MS = 12 * 3600 * 1000;
const cleanPage = (p) => (typeof p === 'string' && /^#\/[a-z0-9:_-]{1,60}$/i.test(p) ? p : null);
function remember(page) { const p = cleanPage(page); if (p) resume = { page: p, at: deps.now() }; return p; }
// the page to open on, once (a window opened later by hand starts on the Overview as before)
function takeResume() { const r = resume; resume = null; return r && deps.now() - r.at < RESUME_MS ? r.page : null; }

// Close the window whose page asked. clientPort: the asking request's socket.remotePort; serverPort: DeviceHub's port.
// Returns { closing: true, pid } (DeviceHub's own window, closing now), { self: true } (not DeviceHub's own window:
// the page closes only itself if it can, and only an app window: then its page is kept too), or { closing: false, why }.
async function closeAsking({ clientPort, serverPort, root, page, appWindow = false }) {
  const procs = await deps.procs();
  const own = ownWindow(procs, root);
  if (!own) { if (appWindow) remember(page); return { closing: false, self: true, why: 'not DeviceHub\'s own window' }; }
  const owner = connectionOwner(await deps.netstat(), clientPort, serverPort);
  if (!owner) return { closing: false, why: 'could not tell which window asked' };
  if (!own.pids.has(owner)) { if (appWindow) remember(page); return { closing: false, self: true, why: 'not DeviceHub\'s own window' }; }
  remember(page);
  const pid = own.main.pid;
  // answered first; the close starts a moment later so the answer reaches the page
  lastClose = new Promise((resolve) => setTimeout(resolve, 300)).then(async () => {
    await deps.kill(pid, false);
    for (let i = 0; i < 8; i++) {
      await deps.wait(1000);
      const again = ownWindow(await deps.procs(), root);
      if (!again || again.main.pid !== pid) return;
    }
    // still there, and still the same window-profile browser: force it (its tree only)
    const last = ownWindow(await deps.procs(), root);
    if (last && last.main.pid === pid) await deps.kill(pid, true);
  }).catch(() => {});
  return { closing: true, pid };
}

module.exports = { closeAsking, takeResume, remember, deps, _test: { lastClose: () => lastClose, parseWmicCsv, userDataDir, ownWindow, connectionOwner, cleanPage, RESUME_MS } };
