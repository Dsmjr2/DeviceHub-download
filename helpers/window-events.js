// The window's one live stream (27 Oct 2026, Shawn: the open window asked DeviceHub ~126 times in 10 minutes doing
// nothing). GET /api/events stays open; DeviceHub writes a small named event when something the window shows changes,
// and the window reads nothing in between. server.js adds the agent's device / activity events to the same stream.
//   const hub = createHub()        hub.add(res) -> off()   hub.push(type, data)   hub.count()
//   watchFolder(dir, onChange, { recursive, waitMs })   onChange once things settle (a git pull touches many files)
// Events from here: hello (on every open: version, saving, backupAt, notice), version, power, backup, notice.
const fs = require('fs');

const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

function createHub() {
  const open = new Set();
  return {
    add(res) { open.add(res); return () => open.delete(res); },
    push(type, data) {
      const s = frame(type, data);
      for (const res of open) { try { res.write(s); } catch { open.delete(res); } }
    },
    count: () => open.size,
  };
}

// fs.watch with a settle wait; never throws (a folder that cannot be watched is simply not watched)
function watchFolder(dir, onChange, { recursive = false, waitMs = 1000 } = {}) {
  let t = null, w = null;
  try {
    w = fs.watch(dir, { recursive }, () => { clearTimeout(t); t = setTimeout(() => { try { onChange(); } catch {} }, waitMs); });
    w.on('error', () => {});
    w.unref?.();
  } catch { return () => {}; }
  return () => { clearTimeout(t); try { w.close(); } catch {} };
}

// the newest backup's time (the same files GET /api/backups lists), or null
function lastBackupAt(dir) {
  let at = 0;
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { at = Math.max(at, fs.statSync(`${dir}/${f}`).mtimeMs); } catch {} } } catch {}
  return at ? new Date(at).toISOString() : null;
}

module.exports = { createHub, watchFolder, lastBackupAt, frame };
