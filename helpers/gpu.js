// The graphics card's temperature, fan speed, load and power (20 Oct 2026, the PC page), read-only through NVIDIA's
// own nvidia-smi (installed with every NVIDIA driver; nothing added). Read only while the PC page is open, at most
// every 1.5 s. Other makers' cards are not read (AMD and Intel have no such tool that needs no install).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SMI = [path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'].find((p) => fs.existsSync(p));
const FIELDS = ['name', 'temperature.gpu', 'fan.speed', 'utilization.gpu', 'power.draw', 'power.limit', 'memory.used', 'memory.total', 'clocks.gr', 'temperature.gpu.tlimit'];
let cache = { at: 0, value: null }, pending = null;
const num = (s) => { const n = Number(String(s).trim()); return Number.isFinite(n) ? n : null; };

function read() {
  if (!SMI) return Promise.resolve({ available: false, reason: 'no NVIDIA graphics card (or its driver) on this PC' });
  if (cache.value && Date.now() - cache.at < 2500) return Promise.resolve(cache.value);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    execFile(SMI, [`--query-gpu=${FIELDS.join(',')}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      // an older driver may not know the last field: ask again without it
      if (err && /tlimit|Field/i.test(String(err.message) + out)) {
        return execFile(SMI, [`--query-gpu=${FIELDS.slice(0, -1).join(',')}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (e2, o2) => done(e2, o2));
      }
      done(err, out);
    });
    function done(err, out) {
      if (err) { pending = null; return resolve({ available: false, reason: `nvidia-smi did not answer (${String(err.message).split('\n')[0]})` }); }
      const gpus = String(out).trim().split(/\r?\n/).filter(Boolean).map((l) => {
        const c = l.split(',').map((x) => x.trim());
        return { name: c[0], tempC: num(c[1]), fanPct: num(c[2]), loadPct: num(c[3]), powerW: num(c[4]), powerLimitW: num(c[5]), memUsedMB: num(c[6]), memTotalMB: num(c[7]), clockMHz: num(c[8]), headroomC: num(c[9]) };
      });
      cache = { at: Date.now(), value: { available: true, gpus } };
      pending = null;
      resolve(cache.value);
    }
  });
  return pending;
}

module.exports = { read };
