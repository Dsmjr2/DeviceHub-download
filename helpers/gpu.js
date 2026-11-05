// The graphics card's temperature, fan speed, load and power (20 Oct 2026, the PC page), read-only through NVIDIA's
// own nvidia-smi (installed with every NVIDIA driver; nothing added). Read only while the PC page is open, at most
// every 1.5 s. Other makers' cards are not read (AMD and Intel have no such tool that needs no install).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SMI = [path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'nvidia-smi.exe'), 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'].find((p) => fs.existsSync(p));
const FIELDS = ['name', 'temperature.gpu', 'fan.speed', 'utilization.gpu', 'power.draw', 'power.limit', 'memory.used', 'memory.total', 'clocks.gr', 'temperature.gpu.tlimit'];
let cache = { at: 0, value: null }, pending = null;
// A laptop's NVIDIA card asleep (D3, switchable graphics) is shown as idle and not asked (3 Nov 2026, Shawn: Acer's
// Nitro app shows it "idle"; nvidia-smi woke it every read while the PC page was open). Its power state comes from
// Windows' own record through the helper (helpers/pc-reads.cs gpu-power); with no answer, nvidia-smi as before.
async function asleep(viaHelper = require('./helper-reads').viaHelper) {
  try {
    const h = await viaHelper('gpu-power', {}, 3000);
    const nv = (h?.result || []).filter((g) => /VEN_10DE/i.test(g.id || ''));
    return nv.length && nv.every((g) => g.d >= 3) ? nv : null;
  } catch { return null; }
}
const num = (s) => { const n = Number(String(s).trim()); return Number.isFinite(n) ? n : null; };

function read() {
  // 31 Oct 2026: said plainly, so a PC with an AMD or Intel card is not told it has no graphics card
  if (!SMI) return Promise.resolve({ available: false, reason: 'Only NVIDIA graphics cards are read here.' });
  // at most every 0.9 s (the PC page asks every second while it is on screen)
  if (cache.value && Date.now() - cache.at < 900) return Promise.resolve(cache.value);
  if (pending) return pending;
  pending = asleep().then((idle) => {
    if (!idle) return null;
    cache = { at: Date.now(), value: { available: true, gpus: idle.map((g) => ({ name: g.name, idle: true, tempC: null, fanPct: null, loadPct: 0, powerW: null, powerLimitW: null, memUsedMB: null, memTotalMB: null, clockMHz: null, headroomC: null })) } };
    return cache.value;
  }).then((v) => v || new Promise((resolve) => {
    execFile(SMI, [`--query-gpu=${FIELDS.join(',')}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      // an older driver may not know the last field: ask again without it
      if (err && /tlimit|Field/i.test(String(err.message) + out)) {
        return execFile(SMI, [`--query-gpu=${FIELDS.slice(0, -1).join(',')}`, '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (e2, o2) => done(e2, o2));
      }
      done(err, out);
    });
    function done(err, out) {
      if (err) return resolve({ available: false, reason: `nvidia-smi did not answer (${String(err.message).split('\n')[0]})` });
      const gpus = String(out).trim().split(/\r?\n/).filter(Boolean).map((l) => {
        const c = l.split(',').map((x) => x.trim());
        return { name: c[0], tempC: num(c[1]), fanPct: num(c[2]), loadPct: num(c[3]), powerW: num(c[4]), powerLimitW: num(c[5]), memUsedMB: num(c[6]), memTotalMB: num(c[7]), clockMHz: num(c[8]), headroomC: num(c[9]) };
      });
      cache = { at: Date.now(), value: { available: true, gpus } };
      resolve(cache.value);
    }
  })).finally(() => { pending = null; });
  return pending;
}

module.exports = { read, _test: { asleep } };
