// HS80 mic boost (19 Oct 2026). iCUE keeps it in its settings file (config.cuecfg, MicBoostValue = dB, 0-10;
// three entries: the receiver connection first, measured by moving iCUE's slider to 0 and 10 dB) and hands it to
// Corsair's audio service when iCUE starts; nothing goes to the headset itself. So a change here: back up the file,
// set every MicBoostValue (the same boost on the receiver and the cable), start iCUE quietly so it applies it, read
// the file back, then close iCUE again if it was not open before.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const { execFile, spawn } = require('child_process');

const CFG = path.join(process.env.APPDATA || '', 'Corsair', 'CUE5', 'config.cuecfg');
const LAUNCHER = 'C:\\Program Files\\Corsair\\Corsair iCUE5 Software\\iCUE Launcher.exe';
const ICUE = 'C:\\Program Files\\Corsair\\Corsair iCUE5 Software\\iCUE.exe';
const RE = /(<value name="MicBoostValue">)(\d+)(<\/value>)/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = () => new Promise((resolve) => execFile('tasklist', ['/FI', 'IMAGENAME eq iCUE.exe', '/NH'], { windowsHide: true }, (e, out) => resolve(/iCUE\.exe/i.test(String(out)))));
const kill = () => new Promise((r) => execFile('taskkill', ['/IM', 'iCUE.exe', '/F'], { windowsHide: true }, () => r()));

function read() {
  if (!fs.existsSync(CFG)) return { available: false };
  const vals = [...fs.readFileSync(CFG, 'utf8').matchAll(RE)].map((m) => Number(m[2]));
  return vals.length ? { available: true, db: vals[0], all: vals } : { available: false };
}

let busy = false, ours = false, queued = null;
// Saves the boost, then lets iCUE apply it in the background: the call returns as soon as the file holds the new
// value (well under a second). iCUE is started in the tray, and closed again (if it was not open before) once its
// SDK session is up (it has loaded its settings and the headset) plus 2 s, at most 15 s. A change made while one is
// being applied is not refused: the newest value is kept and applied straight after (19 Oct 2026: a quick 4 -> 5 was
// lost to "already being applied").
async function set(db, backupDir, sdkConnected = () => false) {
  if (!Number.isInteger(db) || db < 0 || db > 10) throw new Error('mic boost must be 0-10 dB');
  if (!fs.existsSync(CFG)) throw new Error('iCUE settings file not found');
  if (busy) { queued = { db, backupDir, sdkConnected }; return { db, queued: true }; }
  busy = true;
  let started = false;
  try {
    const wasRunning = ours ? false : await running();
    // iCUE writes this file itself while it runs: close it before editing
    if (await running()) { await kill(); for (let i = 0; i < 30 && (await running()); i++) await sleep(200); }
    const text = fs.readFileSync(CFG, 'utf8');
    if (!RE.test(text)) throw new Error('no mic boost setting in the iCUE settings file');
    fs.copyFileSync(CFG, path.join(backupDir, `headset-icue-config-${new Date().toISOString().replace(/[:.]/g, '-')}.cuecfg`));
    writeAtomic(CFG, text.replace(RE, (_, a, __, c) => `${a}${db}${c}`));
    const back = read();
    if (back.db !== db) throw new Error(`the settings file reads ${back.db} dB after writing ${db} dB`);
    if (!wasRunning) ours = true;
    spawn(fs.existsSync(LAUNCHER) ? LAUNCHER : ICUE, fs.existsSync(LAUNCHER) ? ['--autorun'] : [], { detached: true, stdio: 'ignore' }).unref();
    started = true;
    (async () => {
      try {
        const t0 = Date.now();
        while (Date.now() - t0 < 15000 && !sdkConnected()) await sleep(300);
        await sleep(2000);
        if (!wasRunning) { await kill(); for (let i = 0; i < 30 && (await running()); i++) await sleep(200); }
      } finally {
        ours = false; busy = false;
        const next = queued; queued = null;
        if (next && next.db !== read().db) set(next.db, next.backupDir, next.sdkConnected).catch(() => {});
      }
    })();
    return { db };
  } finally { if (!started) { busy = false; ours = false; } }
}
// true while DeviceHub has iCUE open to apply a boost (or one is waiting to be applied)
const applying = () => busy || ours;

module.exports = { read, set, applying };
