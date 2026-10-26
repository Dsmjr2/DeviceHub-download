// Temperatures and fans, read only (24 Oct 2026, Shawn picked it; docs/handoff/display-health.md). No fan control, and
// nothing installed. What is read, with no new driver:
// - NVIDIA: nvidia-smi (helpers/gpu.js), temperature and fan %;
// - any graphics card whose driver reports them to Windows (AMD, Intel, NVIDIA): D3DKMT adapter performance data, the
//   source Task Manager uses (helpers/pc-sensors.ps1 over helpers/pc-native.cs);
// - the ACPI thermal zones Windows exposes as performance counters (often a fixed value on desktop boards: a zone
//   reading below room temperature is shown as not a real reading).
// The CPU temperature and the board's fan speeds (the SuperIO chip) need LibreHardwareMonitor: added on the person's
// click (Add CPU temperature and fan speeds, helpers/cpu-sensors.mjs), then read by helpers/cpu-sensors-read.js in the
// same request. Not added: notReadable says what would be needed. Read only, always.
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
const LHM_SRC = 'LibreHardwareMonitor';
// the CPU card (24 Oct 2026, Shawn: "make the cpu temperature and fans show a card like the graphics card"): Windows' own
// load and clock (helpers/pc-sensors.ps1), and with LibreHardwareMonitor its temperature, hottest core and the CPU fan
// (the board's header named CPU, else the pump). Many boards' fan chips are not named by LibreHardwareMonitor and read
// "Fan #1", "Fan #2" (24 Oct 2026, Shawn: "why doesnt mine show the cpu fan speed?"): then Fan #1, the chip's first input,
// which is the CPU_FAN header on ITE (Gigabyte) and Nuvoton (ASUS, MSI, ASRock) boards; the card says it is a guess.
function cpuCard(win, lhm) {
  const c = lhm?.setUp && lhm.state === 'ok' ? (lhm.cpu || [])[0] || null : null;
  const fans = lhm?.setUp && lhm.state === 'ok' ? lhm.fans || [] : [];
  const named = fans.find((f) => /cpu/i.test(f.name) && !/opt/i.test(f.name)) || fans.find((f) => /cpu|pump|aio/i.test(f.name)) || null;
  const fan = named || (fans.some((f) => /cpu|system|chassis|pump/i.test(f.name)) ? null : fans.find((f) => /^fan #?1$/i.test(f.name.trim())) || null);
  if (!win?.name && !c) return null;
  return {
    name: win?.name || c?.name || 'Processor',
    tempC: c?.packageC ?? null, coresMaxC: c?.coresMaxC ?? null,
    loadPct: win?.loadPct ?? null, clockMHz: win?.clockMHz ?? null,
    fanRpm: fan?.rpm ?? null, fanName: fan?.name ?? null, fanGuess: !!fan && !named, fanCount: fans.length, sensors: !!c,
  };
}
function decide({ nvidia = null, kmt = [], zones = [], pawnio: hasPawnio = false, lhm = null, cpu = null } = {}) {
  const readings = [];
  const lhmOk = lhm?.setUp && lhm.state === 'ok';
  if (lhmOk) {
    for (const c of lhm.cpu || []) {
      if (c.packageC != null) readings.push({ name: 'CPU package', kind: 'cpu', tempC: c.packageC, fanPct: null, fanRpm: null, source: LHM_SRC });
      if (c.coresMaxC != null && c.coresMaxC !== c.packageC) readings.push({ name: 'CPU cores, hottest', kind: 'cpu', tempC: c.coresMaxC, fanPct: null, fanRpm: null, source: LHM_SRC });
    }
    for (const x of lhm.fans || []) readings.push({ name: x.name, kind: 'fan', tempC: null, fanPct: null, fanRpm: x.rpm, source: LHM_SRC });
    for (const x of lhm.boardTemps || []) readings.push({ name: `Board: ${x.name}`, kind: 'board', tempC: x.tempC, fanPct: null, fanRpm: null, source: LHM_SRC });
  }
  const nv = nvidia?.available ? nvidia.gpus || [] : [];
  for (const g of nv) readings.push({ name: g.name, kind: 'gpu', tempC: round(g.tempC), fanPct: g.fanPct, fanRpm: null, source: "NVIDIA's nvidia-smi" });
  for (const g of kmt || []) {
    if (nv.some((n) => sameCard(n.name, g.name))) continue;
    readings.push({ name: g.name || 'Graphics card', kind: 'gpu', tempC: round(g.tempC), fanPct: null, fanRpm: g.fanRpm ?? null, source: "Windows (the card's own driver)" });
  }
  // the ACPI zones: only a real reading, and only when LibreHardwareMonitor does not read the CPU itself
  for (const z of lhmOk ? [] : zones || []) {
    const t = zoneTemp(z);
    if (t == null || t < 20 || t > 110) continue;
    const label = `Board thermal zone ${String(z.name || '').replace(/^.*\./, '') || ''}`.trim();
    const real = t >= 20 && t <= 110;
    readings.push({ name: label, kind: 'zone', tempC: round(t), fanPct: null, fanRpm: null, source: 'Windows (ACPI)',
      note: real ? 'Board zone, not the CPU.' : t < 20 ? 'Below room temperature, so not a real reading.' : 'Out of range, so not a real reading.', real });
  }
  const notReadable = [];
  if (!readings.some((r) => r.kind === 'gpu')) notReadable.push({ what: 'Graphics card temperature', why: "Its driver does not report it to Windows.", need: "An up-to-date driver from the card's maker usually adds it." });
  const lhmNeed = hasPawnio ? `PawnIO is already installed, so only ${LHM.name} (free, open source) is needed.` : `${LHM.name} (free, open source) with the PawnIO driver is needed.`;
  if (!lhm?.setUp) {
    notReadable.push({ what: 'CPU temperature', why: 'Needs the add-on below.', need: lhmNeed, link: LHM.url });
    notReadable.push({ what: 'CPU and case fan speeds', why: "They sit on the board's fan chip (SuperIO).", need: lhmNeed, link: LHM.url });
  } else if (lhmOk) {
    if (!(lhm.cpu || []).some((c) => c.packageC != null)) notReadable.push({ what: 'CPU temperature', why: `${LHM_SRC} found no temperature on this CPU.`, need: 'Make sure PawnIO is installed, then restart the PC.' });
    if (!(lhm.fans || []).length) notReadable.push({ what: 'CPU and case fan speeds', why: lhm.boardFound ? (lhm.idleFans ? `Every fan header reads 0 RPM.` : 'The fan chip reports no fans.') : `${LHM_SRC} found no fan chip on this board.`, need: lhm.boardFound ? 'Fans on a hub with its own power are not read.' : 'Some boards hide it; a BIOS update can help.' });
  }
  if (!nv.length && readings.some((r) => r.kind === 'gpu' && r.fanRpm == null)) notReadable.push({ what: 'Graphics card fan speed', why: 'Its driver reports the temperature but not the fan.', need: "The card maker's own app shows it." });
  const sensors = lhm ? { setUp: !!lhm.setUp, state: lhm.state || null, why: lhm.why || null, idleFans: lhm.idleFans || 0 } : { setUp: false, state: null, why: null, idleFans: 0 };
  return { readings, notReadable, cpuSensors: sensors, cpu: cpuCard(cpu, lhm) };
}

// ---- the CPU from Node itself (24 Oct 2026, Shawn: "make the processor be read quicker when I open the pc area") ----
// os.cpus() answers at once: the name, and the load from the time each core spent busy since the last reading (the first
// reading takes two samples 250 ms apart). The live clock still comes from the PowerShell reader once it is running.
const os = require('os');
let lastTimes = null;
const totals = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
try { lastTimes = { ...totals(), at: Date.now() }; } catch {}
async function nodeCpu({ cpus = os.cpus, sample = totals, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const list = cpus();
  if (!list?.length) return null;
  const dt = lastTimes ? now() - lastTimes.at : -1;
  let prev = sample === totals && dt >= 0 && dt < 15000 ? lastTimes : null;
  if (!prev) { prev = { ...sample(), at: now() }; await wait(250); }
  const cur = { ...sample(), at: now() };
  lastTimes = cur;
  const d = cur.all - prev.all;
  const loadPct = d > 0 ? Math.max(0, Math.min(100, Math.round(((cur.busy - prev.busy) / d) * 100))) : null;
  return { name: String(list[0].model || '').trim() || null, loadPct, clockMHz: null };
}

// ---- the read ----
let cache = { at: 0, value: null }, pending = null, lastLhm = { at: 0, value: null };
// the PowerShell reader's last answer, and the question it is working on: /api/temps waits at most FIRST_WAIT_MS for it
// (its first answer, which loads its code, takes a few seconds), then answers with what it has; the slow answer fills the
// next reading
const FIRST_WAIT_MS = 450;
let lastSession = null, asking = null;
// the native helper first (helpers/pc-reads.cs op sensors: the same JSON line, no PowerShell and no Add-Type compile,
// 26 Oct 2026); the PowerShell session only when the helper cannot answer
const askReader = () => require('./helper-reads').read('sensors', { ps: askSession, ms: 20000 });
function sessionNow() {
  if (!asking) asking = askReader().then((v) => { if (v) lastSession = v; return v; }).finally(() => { asking = null; });
  return Promise.race([asking, new Promise((r) => setTimeout(() => r(lastSession), FIRST_WAIT_MS))]);
}
async function read({ gpu = require('./gpu'), cpuReader = require('./cpu-sensors-read') } = {}) {
  const ttl = cache.value?.cpuSensors?.state === 'starting' || cache.value?.cpu?.tempC == null ? 900 : 3500;
  if (cache.value && Date.now() - cache.at < ttl) return cache.value;
  if (pending) return pending;
  pending = (async () => {
    if (process.platform !== 'win32') return { readings: [], notReadable: [], errors: ['only on Windows'] };
    const [nvidia, s, pw, rawLhm, nc] = await Promise.all([gpu.read().catch(() => null), sessionNow(), pawnioInstalled(), cpuReader.read().catch((e) => ({ setUp: true, state: 'error', why: e.message })), nodeCpu().catch(() => null)]);
    if (rawLhm?.state === 'ok' && rawLhm.anything) lastLhm = { at: Date.now(), value: rawLhm };
    const lhm = rawLhm?.state === 'starting' && lastLhm.value && Date.now() - lastLhm.at < 60000 ? lastLhm.value : rawLhm;
    // the CPU: Node's name and load at once; the reader's name (Windows' own wording) and live clock when it has answered
    const cpu = nc || s?.cpu ? { name: s?.cpu?.name || nc?.name || null, loadPct: nc?.loadPct ?? s?.cpu?.loadPct ?? null, clockMHz: s?.cpu?.clockMHz ?? null } : null;
    const v = { ...decide({ nvidia, kmt: s?.gpus || [], zones: s?.zones || [], pawnio: pw, lhm, cpu }), pawnio: pw, errors: s ? s.errors || [] : asking ? [] : ['the sensor reader did not answer'], at: new Date().toISOString() };
    cache = { at: Date.now(), value: v };
    return v;
  })();
  try { return await pending; } finally { pending = null; }
}
function stop() { if (proc) { try { proc.kill(); } catch {} proc = null; } }

module.exports = { read, stop, _test: { decide, zoneTemp, cpuCard, nodeCpu, askSession } };
