// CPU temperature and fan speeds through LibreHardwareMonitor, the reading side (24 Oct 2026, Shawn said yes;
// docs/handoff/display-health.md). helpers/cpu-sensors.mjs sets it up and removes it on the person's click; this file
// only reads what the elevated reader (helpers/cpu-sensors-reader.cs, compiled in C:\Program Files\DeviceHub sensors\)
// writes. READ ONLY: nothing here, or in the reader, ever sets a fan or any other value.
//
// How a reading happens, only while the Temperatures and fans card is on screen (GET /api/temps, every 5 s):
//   1. the "want" file in %TEMP% is touched (the reader stops by itself 20 s after the last touch);
//   2. if readings.json is not fresh, the task "DeviceHub sensors" is started (schtasks /Run, at most once per 15 s;
//      the task has highest rights, so Windows asks nothing; it has no trigger, so it never runs by itself);
//   3. readings.json is read and parsed (parse below).
// The card off screen: no request, so no touch: the reader exits within 20 s and nothing runs at all.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const DIR = path.join(PF, 'DeviceHub sensors');
const LHM = {
  dir: DIR,
  script: path.join(DIR, 'reader.ps1'),   // run by Windows' own powershell.exe; no .exe of ours (AppControl)
  readings: path.join(DIR, 'readings.json'),
  want: path.join(os.tmpdir(), 'DeviceHub-sensors-want.txt'),
  task: 'DeviceHub sensors',
};
const FRESH_MS = 10000;      // readings.json older than this: the reader is not running
const RUN_EVERY_MS = 15000;  // the task is started at most this often
const START_GRACE_MS = 30000; // after a start, "starting" until this long has passed with no readings

// ---- the parts that touch Windows, swappable for tests (tests/cpu-sensors.mjs) ----
const deps = {
  exists: (f) => fs.existsSync(f),
  touch: (f) => { const t = new Date(); try { fs.utimesSync(f, t, t); } catch { fs.writeFileSync(f, 'DeviceHub reads the CPU temperature and fans while this file is touched.\r\n'); } },
  stat: (f) => { try { return fs.statSync(f); } catch { return null; } },
  readText: (f) => fs.readFileSync(f, 'utf8'),
  runTask: (name) => new Promise((resolve) => execFile('schtasks.exe', ['/Run', '/TN', name], { windowsHide: true, timeout: 15000 }, (err, out, errOut) => resolve(err ? { ok: false, error: String(errOut || err.message).trim().split(/\r?\n/)[0] } : { ok: true }))),
  now: () => Date.now(),
};

// ---- parse what the reader wrote (pure; tests/cpu-sensors.mjs) ----
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v) => (v == null ? null : Math.round(v));
const plausible = (t) => t != null && t > 5 && t < 125;
// the CPU's package temperature: Intel "CPU Package"; AMD "Core (Tctl/Tdie)" (Zen), else "Core (Tctl)" or "Tdie"
const PACKAGE = [/^CPU Package$/i, /^Core \(Tctl\/Tdie\)$/i, /^Tdie$/i, /^Core \(Tctl\)$/i, /^Package$/i, /^CPU Cores?$/i];
// the hottest core: Intel "Core Max"; AMD "CCDs Max (Tdie)", else the hottest CCD or core
const CORES_MAX = [/^Core Max$/i, /^CCDs Max \(Tdie\)$/i];
const ONE_CORE = [/^(CPU )?Core #\d+$/i, /^CCD ?\d+ \(Tdie\)$/i, /^CCD ?\d+$/i];

function parse(raw) {
  const hw = Array.isArray(raw?.hardware) ? raw.hardware : [];
  const sensors = (h, type) => (Array.isArray(h.sensors) ? h.sensors : []).filter((s) => s && s.type === type).map((s) => ({ name: String(s.name || ''), value: num(s.value) }));
  const cpus = hw.filter((h) => h.type === 'Cpu');
  const cpu = cpus.map((h) => {
    const t = sensors(h, 'Temperature').filter((s) => plausible(s.value));
    const pick = (list) => { for (const re of list) { const s = t.find((x) => re.test(x.name)); if (s) return s.value; } return null; };
    const pkg = pick(PACKAGE);
    let cores = pick(CORES_MAX);
    if (cores == null) { const c = t.filter((s) => ONE_CORE.some((re) => re.test(s.name))).map((s) => s.value); cores = c.length ? Math.max(...c) : null; }
    return { name: String(h.name || 'CPU'), packageC: round(pkg), coresMaxC: round(cores) };
  });
  // the board: its SuperIO fan chip and embedded controller (sub-hardware of the motherboard)
  const board = hw.filter((h) => h.type === 'SuperIO' || h.type === 'EmbeddedController');
  const fans = [], idle = [], temps = [];
  for (const h of board) {
    for (const s of sensors(h, 'Fan')) {
      if (s.value == null) continue;
      if (s.value < 1) idle.push(s.name); else fans.push({ name: s.name, rpm: Math.round(s.value) });
    }
    // only the named ones ("Temperature #3" is a chip input nobody wired, often a fixed or nonsense value)
    for (const s of sensors(h, 'Temperature')) if (plausible(s.value) && !/^Temperature #\d+$/i.test(s.name)) temps.push({ name: s.name, tempC: round(s.value) });
  }
  const anything = cpu.some((c) => c.packageC != null || c.coresMaxC != null) || fans.length || temps.length;
  return { at: raw?.at || null, error: raw?.error || null, cpu, fans, idleFans: idle.length, boardTemps: temps.slice(0, 6), boardFound: board.length > 0, anything: !!anything };
}

// ---- read (only from GET /api/temps) ----
let lastRun = 0, lastRunError = null;
async function read() {
  if (!deps.exists(LHM.script)) return { setUp: false };
  const now = deps.now();
  try { deps.touch(LHM.want); } catch (e) { return { setUp: true, state: 'error', why: `the request file could not be written (${e.message})` }; }
  const st = deps.stat(LHM.readings);
  const fresh = !!st && now - st.mtimeMs < FRESH_MS;
  if (!fresh) {
    if (now - lastRun >= RUN_EVERY_MS) {
      lastRun = now;
      const r = await deps.runTask(LHM.task);
      lastRunError = r.ok ? null : r.error || 'Windows did not start it';
    }
    if (lastRunError) return { setUp: true, state: 'error', why: `Windows did not start the reader (${lastRunError}). Press Remove, then add it again.` };
    return { setUp: true, state: now - lastRun < START_GRACE_MS ? 'starting' : 'error', why: now - lastRun < START_GRACE_MS ? null : 'The reader started but wrote no readings. Press Remove, then add it again.' };
  }
  let raw;
  try { raw = JSON.parse(deps.readText(LHM.readings).replace(/^\uFEFF/, '')); } catch { return { setUp: true, state: 'starting' }; }
  return { setUp: true, state: 'ok', ...parse(raw) };
}
const _test = { reset: () => { lastRun = 0; lastRunError = null; } };

module.exports = { LHM, read, parse, deps, FRESH_MS, RUN_EVERY_MS, _test };
