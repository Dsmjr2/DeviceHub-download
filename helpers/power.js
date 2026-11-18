// Battery saver (19 Oct 2026, for the laptop): while the PC runs on battery, DeviceHub's background checks run 3x less
// often (battery readings, device re-reads, reconnect scans, the camera guard, the receiver light check, cable
// detection); on the charger, and on a PC without a battery, everything runs at full speed. The mic light keeps its
// instant response. Off with settings.json "batterySaver": false. Checked every 30 s.
const fs = require('fs');

let call = null, settingsFile = null, onBattery = false, hasBattery = false, percent = null, timer = null, told = false, toldBattery = false, answered = false;
const listeners = new Set();
const enabled = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''))?.batterySaver !== false; } catch { return true; } };
const saving = () => onBattery && enabled();

let checking = false;
async function check() {
  if (!call || checking) return;
  checking = true;
  try {
    const r = await call('power', {});
    if (!r || typeof r !== 'object') return;
    hasBattery = !!r.hasBattery; onBattery = !!r.onBattery && hasBattery; percent = Number.isFinite(r.percent) ? r.percent : null; answered = true;
    // against the last answer told, so the saver switched on or off in Settings is told too (27 Oct 2026: the window's
    // live stream pushes this instead of the window asking every 30 s)
    // a battery found is told as well (31 Oct 2026: on a laptop left on the charger the saver never switches, so the
    // window, which shows the Laptop page only where there is a battery, would never hear of it)
    if (saving() !== told || hasBattery !== toldBattery) { told = saving(); toldBattery = hasBattery; for (const f of listeners) { try { f(told); } catch {} } }
  } catch { /* the helper is restarting */ } finally { checking = false; }
}

module.exports = {
  // (31 Oct 2026) a PC whose last answer had no battery is asked every 10 minutes instead of every 30 s
  start(corsairCall, file) { clearInterval(timer); call = corsairCall; settingsFile = file; check(); let n = 0; timer = setInterval(() => { n++; if (hasBattery || !answered || n % 20 === 0) check(); }, 30000); },
  stop() { clearInterval(timer); timer = null; },
  // how much longer a background check waits now: 3 on battery with the saver on, else 1
  factor: () => (saving() ? 3 : 1),
  every: (ms) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? n * (saving() ? 3 : 1) : 0; },
  onChange: (f) => { if (typeof f === 'function') listeners.add(f); },
  state: () => ({ hasBattery, onBattery, percent, enabled: enabled(), saving: saving() }),
  _test: { check },
};
