// Temperatures and fans, read only (24 Oct 2026, Shawn picked it; docs/handoff/display-health.md). No fan control, and
// nothing installed. What is read, with no new driver:
// - NVIDIA: nvidia-smi (helpers/gpu.js), temperature and fan %;
// - any graphics card whose driver reports them to Windows (AMD, Intel, NVIDIA): D3DKMT adapter performance data, the
//   source Task Manager uses (helpers/pc-sensors.ps1 over helpers/pc-native.cs);
// - the ACPI thermal zones Windows exposes as performance counters (often a fixed value on desktop boards: a zone
//   reading below room temperature is shown as not a real reading).
// Not readable without something new: the CPU temperature and the board's fan speeds (the SuperIO chip). The OpenRGB
// inside DeviceHub reads lights only; with PawnIO installed it still reads no fan speed. notReadable says what would.
// Read only while the card is on screen (at most every 5 s); the PowerShell session stops 30 s after the last question.
const path = require('path');
const { spawn, execFile } = require('child_process');

const PS1 = path.join(__dirname, 'pc-sensors.ps1');
const IDLE_MS = 30000;
const LHM = { name: 'LibreHardwareMonitor', url: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases' };

// ---- the PowerShell session ----
let proc = null, buf = '', waiters = [], idle = null;
function session() {
  if (proc) return proc;
  const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  proc = p; buf = '';
  p.stdin.on('error', () => {});
  p.on('error', () => { if (proc === p) proc = null; for (const w of waiters.splice(0)) w(null); });
  p.on('exit', () => { if (proc === p) proc = null; for (const w of waiters.splice(0)) w(null); });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let j = null; try { j = JSON.parse(line); } catch {}
      const w = waiters.shift(); if (w) w(j);
    }
  });
  return p;
}
function askSession(ms = 20000) {
  const p = session();
  clearTimeout(idle);
  idle = setTimeout(() => { if (proc) { try { proc.stdin.write('quit\n'); proc.stdin.end(); } catch {} proc = null; } }, IDLE_MS);
  idle.unref?.();
  return new Promise((resolve) => {
    const t = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); resolve(null); }, ms);
    function done(v) { clearTimeout(t); resolve(v); }
    waiters.push(done);
    try { p.stdin.write('read\n'); } catch { done(null); }
  });
}

// is PawnIO installed (its service is registered)? Read once.
let pawnio = null;
const pawnioInstalled = () => (pawnio !== null ? Promise.resolve(pawnio) : new Promise((resolve) => execFile('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\PawnIO'], { windowsHide: true, timeout: 5000 }, (e) => resolve((pawnio = !e)))));

// ---- the decision (pure; tests/display-health.mjs) ----
const round = (n) => (n == null ? null : Math.round(n));
const sameCard = (a, b) => String(a || '').toLowerCase().replace(/\s+/g, ' ').trim() === String(b || '').toLowerCase().replace(/\s+/g, ' ').trim();
function zoneTemp(z) {
  const c = z.tenthsK ? z.tenthsK / 10 - 273.15 : z.kelvin ? z.kelvin - 273.15 : null;
  return c == null ? null : Math.round(c * 10) / 10;
}
function decide({ nvidia = null, kmt = [], zones = [], pawnio: hasPawnio = false } = {}) {
  const readings = [];
  const nv = nvidia?.available ? nvidia.gpus || [] : [];
  for (const g of nv) readings.push({ name: g.name, kind: 'gpu', tempC: round(g.tempC), fanPct: g.fanPct, fanRpm: null, source: "NVIDIA's nvidia-smi" });
  for (const g of kmt || []) {
    if (nv.some((n) => sameCard(n.name, g.name))) continue;
    readings.push({ name: g.name || 'Graphics card', kind: 'gpu', tempC: round(g.tempC), fanPct: null, fanRpm: g.fanRpm ?? null, source: "Windows (the card's own driver)" });
  }
  for (const z of zones || []) {
    const t = zoneTemp(z);
    if (t == null) continue;
    const label = `Board thermal zone ${String(z.name || '').replace(/^.*\./, '') || ''}`.trim();
    const real = t >= 20 && t <= 110;
    readings.push({ name: label, kind: 'zone', tempC: round(t), fanPct: null, fanRpm: null, source: 'Windows (ACPI)',
      note: real ? 'The board reports this zone; it is not the CPU core temperature.' : t < 20 ? 'Below room temperature, so not a real reading.' : 'Out of range, so not a real reading.', real });
  }
  const notReadable = [];
  if (!readings.some((r) => r.kind === 'gpu')) notReadable.push({ what: 'Graphics card temperature', why: "Its driver does not report it to Windows.", need: "An up-to-date driver from the card's maker usually adds it." });
  const lhm = hasPawnio ? `PawnIO is already installed, so only ${LHM.name} (free, open source) would be needed.` : `${LHM.name} (free, open source) with the PawnIO driver would be needed.`;
  notReadable.push({ what: 'CPU temperature', why: 'Windows does not share it without a driver that reads the CPU.', need: lhm, link: LHM.url });
  notReadable.push({ what: 'CPU and case fan speeds', why: "They sit on the board's fan chip (SuperIO). The OpenRGB inside DeviceHub reads lights only, never fans.", need: lhm, link: LHM.url });
  if (!nv.length && readings.some((r) => r.kind === 'gpu' && r.fanRpm == null)) notReadable.push({ what: 'Graphics card fan speed', why: 'Its driver reports the temperature but not the fan.', need: "The card maker's own app shows it." });
  return { readings, notReadable };
}

// ---- the read ----
let cache = { at: 0, value: null }, pending = null;
async function read({ gpu = require('./gpu') } = {}) {
  if (cache.value && Date.now() - cache.at < 4500) return cache.value;
  if (pending) return pending;
  pending = (async () => {
    if (process.platform !== 'win32') return { readings: [], notReadable: [], errors: ['only on Windows'] };
    const [nvidia, s, pw] = await Promise.all([gpu.read().catch(() => null), askSession(), pawnioInstalled()]);
    const v = { ...decide({ nvidia, kmt: s?.gpus || [], zones: s?.zones || [], pawnio: pw }), pawnio: pw, errors: s ? s.errors || [] : ['the sensor reader did not answer'], at: new Date().toISOString() };
    cache = { at: Date.now(), value: v };
    return v;
  })();
  try { return await pending; } finally { pending = null; }
}
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; } }

module.exports = { read, stop, _test: { decide, zoneTemp } };
