// PC check (24 Oct 2026, Shawn picked it; docs/handoff/display-health.md): how this PC is doing, read only. Not the
// same as Settings > Health, which is about DeviceHub itself. Nothing is installed or changed, ever.
// The facts come from one PowerShell read as the signed-in user (helpers/pc-check.ps1); each check below is a plain
// function over them returning one or more results { id, title, level: 'ok' | 'warn' | 'info', line, link? }.
// To add a check: write a function (facts, now) => result or [results], and add it to CHECKS.
// Read when the page opens (kept 60 s) and on Check again; never in the background.
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const PS1 = path.join(__dirname, 'pc-check.ps1');
const DAY = 86400000;

const GiB = 1024 ** 3;
const size = (b) => (b >= 1024 * GiB ? `${(b / (1024 * GiB)).toFixed(1)} TB` : `${Math.round(b / GiB)} GB`);
const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const result = (id, title, level, line, link) => ({ id, title, level, line, ...(link ? { link } : {}) });

// ---- drives ----
function diskSpace(f) {
  const v = (f.volumes || []).filter((x) => x.size > 0);
  if (!v.length) return result('disk-space', 'Free space', 'info', 'No drives were read.');
  return v.map((x) => {
    const pct = Math.round((x.free / x.size) * 100);
    const name = `${x.drive}${x.label ? ` (${x.label})` : ''}`;
    return x.free / x.size < 0.10
      ? result('disk-space', 'Free space', 'warn', `${name} is almost full: ${size(x.free)} free of ${size(x.size)} (${pct}%).`)
      : result('disk-space', 'Free space', 'ok', `${name} has ${size(x.free)} free of ${size(x.size)} (${pct}%).`);
  });
}

function driveHealth(f) {
  const disks = f.disks || [];
  if (!disks.length) return result('drive-health', 'Drive health', 'info', (f.denied || []).includes('disks') ? 'Windows did not let DeviceHub read the drives.' : 'No drives were read.');
  const rel = new Map((f.reliability || []).map((r) => [String(r.id), r]));
  const out = disks.map((d) => {
    const kind = d.media === 'SSD' ? 'SSD' : d.media === 'HDD' ? 'hard drive' : 'drive';
    const r = rel.get(String(d.id));
    const extra = r ? [r.wear != null ? `${r.wear}% worn` : null, r.tempC ? `${r.tempC} °C` : null].filter(Boolean).join(', ') : '';
    if (d.health === 'Unhealthy') return result('drive-health', 'Drive health', 'warn', `${d.name} (${kind}): Windows reports it failing. Back up its files now.`);
    if (d.health === 'Warning') return result('drive-health', 'Drive health', 'warn', `${d.name} (${kind}): Windows reports a warning (${d.status}). Back up its files.`);
    if (r && r.wear >= 90) return result('drive-health', 'Drive health', 'warn', `${d.name} (${kind}): ${r.wear}% worn. Plan to replace it.`);
    if (d.health === 'Healthy') return result('drive-health', 'Drive health', 'ok', `${d.name} (${kind}): healthy${extra ? `, ${extra}` : ''}.`);
    return result('drive-health', 'Drive health', 'info', `${d.name} (${kind}): Windows does not say how it is.`);
  });
  // wear and temperature need administrator here; not said (Shawn, 24 Oct 2026: not necessary), shown when they answer
  return out;
}

// ---- graphics driver ----
// the maker's official driver page (no maker publishes a plain lookup endpoint for the latest version, so none is asked)
const DRIVER_PAGES = [
  [/nvidia/i, 'NVIDIA', 'https://www.nvidia.com/en-us/drivers/'],
  [/amd|advanced micro|radeon|ati\b/i, 'AMD', 'https://www.amd.com/en/support/download/drivers.html'],
  [/intel/i, 'Intel', 'https://www.intel.com/content/www/us/en/support/detect.html'],
];
// NVIDIA's own number from Windows' driver version: 32.0.16.2101 -> 621.01 (the last five digits of the last two parts)
function nvidiaNumber(v) {
  const p = String(v || '').split('.');
  if (p.length !== 4) return null;
  const d = (p[2] + p[3].padStart(4, '0')).slice(-5);
  return /^\d{5}$/.test(d) ? `${d.slice(0, 3)}.${d.slice(3)}` : null;
}
const DRIVER_OLD_DAYS = 183;
// the graphics makers' own apps (helpers/pc-check.ps1 finds them: Start menu shortcut, else the usual folder)
const DRIVER_APPS = { NVIDIA: { id: 'nvidia', name: 'NVIDIA App', exe: 'NVIDIA App.exe' }, AMD: { id: 'amd', name: 'AMD Software', exe: 'RadeonSoftware.exe' } };
function graphicsDriver(f, now = Date.now()) {
  const cards = (f.video || []).filter((v) => v.name && !/virtual|remote|parsec|mirage|dameware|meta|spacedesk|citrix/i.test(v.name));
  if (!cards.length) return result('gpu-driver', 'Graphics driver', 'info', 'No graphics card was read.');
  return cards.map((v) => {
    if (/basic display|basic render/i.test(v.name)) return result('gpu-driver', 'Graphics driver', 'warn', "No graphics driver is installed: Windows uses its basic display driver.", null);
    const maker = DRIVER_PAGES.find(([re]) => re.test(`${v.maker} ${v.name}`));
    const isNv = maker?.[1] === 'NVIDIA';
    const ver = isNv ? (f.nvidiaVersion || nvidiaNumber(v.version) || v.version) : v.version;
    // the maker's own app when it is installed (POST /api/pc-check/open-app starts only that exe), else its driver page
    const app = maker && DRIVER_APPS[maker[1]];
    const link = app && f.driverApps?.[app.id] ? { text: `Open ${app.name}`, app: app.id } : maker ? { text: `${maker[1]} drivers`, url: maker[2] } : null;
    if (!v.date) return result('gpu-driver', 'Graphics driver', 'info', `${v.name}: driver ${ver}; its date is not known.`, link);
    const age = Math.floor((now - Date.parse(`${v.date}T00:00:00Z`)) / DAY);
    if (age > DRIVER_OLD_DAYS) return result('gpu-driver', 'Graphics driver', 'warn', `${v.name}: driver ${ver} is from ${day(v.date)}, over 6 months old.`, link);
    return result('gpu-driver', 'Graphics driver', 'ok', `${v.name}: driver ${ver}, from ${day(v.date)}.`, link);
  });
}

// ---- RAM below its rated speed ----
// the rated speed in a part number, where the maker writes it there (MT/s)
const PART_SPEEDS = [
  [/^F[345]-(\d{4})C/i, (m) => +m[1]],                    // G.Skill F4-3200C16-8GVKB
  [/^CM[A-Z0-9]*?X[345]M\d[A-Z](\d{4})C/i, (m) => +m[1]],  // Corsair CMK16GX4M2B3200C16
  [/^KF[345](\d{2})C/i, (m) => +m[1] * 100],               // Kingston Fury KF432C16BB, KF556C40
  [/^HX[345](\d{2})C/i, (m) => +m[1] * 100],               // Kingston HyperX HX432C16FB3
  [/^(?:BL|CP)\d+G(\d{2})C/i, (m) => +m[1] * 100],         // Crucial Ballistix BL8G32C16U4B, Crucial Pro CP16G56C46U5
  [/(\d{4})HC\d/i, (m) => +m[1]],                          // TeamGroup TF3D416G3200HC16F
];
function partSpeed(part) {
  const p = String(part || '').trim();
  for (const [re, f] of PART_SPEEDS) { const m = re.exec(p); if (m) { const n = f(m); if (n >= 1600 && n <= 12000) return n; } }
  return null;
}
const BOARD_SUPPORT = [
  [/gigabyte|aorus/i, 'https://www.gigabyte.com/Support', 'Gigabyte'],
  [/asus|rog/i, 'https://www.asus.com/support/', 'ASUS'],
  [/micro-star|msi/i, 'https://www.msi.com/support', 'MSI'],
  [/asrock/i, 'https://www.asrock.com/support/index.asp', 'ASRock'],
  [/biostar/i, 'https://www.biostar.com.tw/app/en/support/', 'Biostar'],
];
function ramSpeed(f) {
  const sticks = (f.ram || []).filter((r) => r.configured > 0 || r.speed > 0);
  if (!sticks.length) return result('ram-speed', 'RAM speed', 'info', 'The RAM speed was not read.');
  const running = Math.min(...sticks.map((r) => r.configured || r.speed));
  // each stick's rating: its part number where the maker writes it there, else what the stick reports
  const rated = Math.min(...sticks.map((r) => partSpeed(r.part) || r.speed || 0).filter((n) => n > 0));
  const [, boardUrl, boardMaker] = BOARD_SUPPORT.find(([re]) => re.test(`${f.board?.maker || ''}`)) || [];
  const link = boardUrl ? { text: `${boardMaker} support`, url: boardUrl } : null;
  if (rated && running && running < rated - 50) {
    return result('ram-speed', 'RAM speed', 'warn', `${running} of ${rated} MT/s. Turn on XMP/EXPO in the BIOS.`, link);
  }
  return result('ram-speed', 'RAM speed', 'ok', rated ? `RAM runs at ${running} MT/s, its rated speed.` : `RAM runs at ${running} MT/s.`);
}

// ---- devices with errors ----
// Device Manager's problem codes (CM_PROB_*), in words
const PROBLEMS = {
  1: 'is not set up correctly', 3: 'has a driver that may be damaged', 10: 'cannot start', 12: 'cannot find enough free resources',
  14: 'needs a restart to work', 18: 'needs its driver reinstalled', 19: 'has damaged settings in the registry', 21: 'is being removed',
  22: 'is turned off in Device Manager', 24: 'is not present or not working', 28: 'has no driver installed', 29: 'is turned off in the BIOS',
  31: 'is not working: Windows cannot load its driver', 32: 'has its driver service turned off', 33: 'cannot get the resources it needs',
  34: 'needs its resources set by hand', 35: 'is missing from the BIOS tables', 37: 'has a driver that failed to start', 38: 'has a driver still in memory from before; restart',
  39: 'has a driver that is damaged or missing', 40: 'has damaged driver settings', 41: 'has a driver loaded but the device was not found',
  42: 'is listed twice', 43: 'was stopped by Windows because it reported problems', 44: 'was stopped by a program', 47: 'was safely removed: unplug and plug it back in',
  48: 'is blocked: its driver has known problems', 49: 'cannot start: the registry is too large', 52: 'has a driver that is not signed', 54: 'is restarting',
};
function deviceErrors(f) {
  // 45 = a ghost; 22 = turned off by the person in Device Manager (Shawn, 24 Oct 2026: not a problem, not shown)
  const list = (f.devices || []).filter((d) => d.problem !== 45 && d.problem !== 22 && (d.problem > 0 || d.status === 'Error'));
  if (!list.length) return result('device-errors', 'Devices', 'ok', (f.denied || []).includes('devices') ? 'Windows did not let DeviceHub read the devices.' : 'No device reports a problem.');
  return list.map((d) => {
    const words = PROBLEMS[d.problem] || (d.problem ? `has a problem (code ${d.problem})` : 'reports an error');
    return result('device-errors', 'Devices', 'warn', `${d.name || 'A device'} ${words}.`);
  });
}

// ---- recent crashes ----
// common stop codes, in words
const BUGCHECKS = {
  0x0A: 'a driver used memory it should not (IRQL_NOT_LESS_OR_EQUAL)', 0x1A: 'a memory problem (MEMORY_MANAGEMENT)', 0x1E: 'a driver error (KMODE_EXCEPTION_NOT_HANDLED)',
  0x3B: 'a driver or system error (SYSTEM_SERVICE_EXCEPTION)', 0x50: 'bad memory access, often RAM or a driver (PAGE_FAULT_IN_NONPAGED_AREA)',
  0x7E: 'a driver error (SYSTEM_THREAD_EXCEPTION_NOT_HANDLED)', 0x7F: 'a hardware or driver fault (UNEXPECTED_KERNEL_MODE_TRAP)', 0x9F: 'a driver did not handle sleep or wake (DRIVER_POWER_STATE_FAILURE)',
  0xA0: 'a power management error (INTERNAL_POWER_ERROR)', 0xBE: 'a driver wrote to read-only memory (ATTEMPTED_WRITE_TO_READONLY_MEMORY)', 0xC2: 'a driver misused memory (BAD_POOL_CALLER)',
  0xC5: 'a driver damaged memory (DRIVER_CORRUPTED_EXPOOL)', 0xD1: 'a driver used memory it should not (DRIVER_IRQL_NOT_LESS_OR_EQUAL)', 0xEF: 'a Windows process stopped (CRITICAL_PROCESS_DIED)',
  0x101: 'a CPU stopped answering, often an overclock (CLOCK_WATCHDOG_TIMEOUT)', 0x109: 'Windows memory was changed (CRITICAL_STRUCTURE_CORRUPTION)',
  0x116: 'the graphics driver stopped answering (VIDEO_TDR_FAILURE)', 0x117: 'the graphics driver stopped answering (VIDEO_TDR_TIMEOUT_DETECTED)',
  0x124: 'a hardware error, often CPU, RAM or an overclock (WHEA_UNCORRECTABLE_ERROR)', 0x133: 'a driver took too long (DPC_WATCHDOG_VIOLATION)',
  0x139: 'Windows found damaged data (KERNEL_SECURITY_CHECK_FAILURE)', 0x13A: 'a driver damaged memory (KERNEL_MODE_HEAP_CORRUPTION)',
  0x7A: 'Windows could not read memory from disk (KERNEL_DATA_INPAGE_ERROR)', 0xF4: 'a critical process stopped, often the drive (CRITICAL_OBJECT_TERMINATION)',
};
// the stop code in a 1001 event's first value ("0x000000be (0x..., ...)") or a Kernel-Power 41 number
function bugcheckCode(x) {
  if (typeof x === 'number') return x > 0 ? x : null;
  const m = /0x([0-9a-f]+)/i.exec(String(x || ''));
  return m ? parseInt(m[1], 16) : null;
}
const codeWords = (c) => `0x${c.toString(16).toUpperCase()}${BUGCHECKS[c] ? `: ${BUGCHECKS[c]}` : ''}`;
const dates = (list) => { const d = list.map((e) => shortDay(e.at)); return d.length > 4 ? `${d.slice(0, 4).join(', ')} and ${d.length - 4} more` : d.join(', '); };
function crashes(f) {
  if (!f.events) return result('crashes', 'Crashes', 'info', (f.denied || []).includes('events') ? "Reading Windows' system log needs administrator here, so crashes are not counted." : 'Windows did not answer for its system log.');
  const newest = (a) => [...a].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const bc = newest(f.events.bugchecks || []);
  // a power loss or a held power button (Kernel-Power 41 alone) is not counted (Shawn, 24 Oct 2026: not necessary)
  const whea = newest(f.events.whea || []);
  const out = [];
  if (bc.length) {
    const code = bugcheckCode(bc[0].param);
    out.push(result('crashes', 'Crashes', 'warn', `${plural(bc.length, 'crash', 'crashes')} (blue screen) in the last 30 days: ${dates(bc)}.${code ? ` Last: ${codeWords(code)}.` : ''}`));
  }
  if (whea.length) out.push(result('crashes', 'Crashes', 'warn', `${plural(whea.length, 'hardware error')} logged by Windows (WHEA) in the last 30 days: ${dates(whea)}.`));
  if (!out.length) out.push(result('crashes', 'Crashes', 'ok', 'No crashes in the last 30 days.'));
  return out;
}

// ---- restart waiting ----
function restartPending(f) {
  const r = f.restart;
  if (!r) return result('restart', 'Restart', 'info', 'Whether a restart is waiting was not read.');
  if (r.cbs || r.wu) return result('restart', 'Restart', 'warn', 'Restart to finish an update.');
  if (r.files > 0) return result('restart', 'Restart', 'info', 'Restart to finish an update.');
  return result('restart', 'Restart', 'ok', 'No restart is waiting.');
}

// the checks, in the order shown
const CHECKS = [diskSpace, driveHealth, graphicsDriver, ramSpeed, deviceErrors, crashes, restartPending];

function runChecks(facts, now = Date.now(), checks = CHECKS) {
  const out = [];
  for (const c of checks) {
    try { const r = c(facts, now); out.push(...(Array.isArray(r) ? r : [r]).filter(Boolean)); }
    catch (e) { out.push(result(c.name, c.name, 'info', `This check could not run: ${e.message}`)); }
  }
  return out;
}
const summary = (results) => ({ warn: results.filter((r) => r.level === 'warn').length, info: results.filter((r) => r.level === 'info').length, ok: results.filter((r) => r.level === 'ok').length });

function gather() {
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1],
    { windowsHide: true, timeout: 60000, maxBuffer: 8 << 20 }, (e, out) => {
      try { return resolve(JSON.parse(String(out || '').trim())); } catch {}
      reject(new Error(e ? String(e.message).split('\n')[0] : 'Windows did not answer'));
    }));
}

let cache = { at: 0, value: null, facts: null }, pending = null;
// POST /api/pc-check/open-app { app: 'nvidia' | 'amd' }: starts only the exe the last check found, checked again here
// (its expected name, under Program Files, still there); never a path from the page
function appPath(id, facts = cache.facts, { exists = fs.existsSync } = {}) {
  const a = Object.values(DRIVER_APPS).find((x) => x.id === id);
  const p = a && facts?.driverApps?.[id];
  if (!p || typeof p !== 'string') return null;
  const pf = `${(process.env.ProgramFiles || 'C:\\Program Files').toLowerCase()}\\`;
  if (path.win32.basename(p).toLowerCase() !== a.exe.toLowerCase() || !p.toLowerCase().startsWith(pf) || p.includes('..') || !exists(p)) return null;
  return p;
}
function openApp(id, { start = (p) => spawn(p, [], { cwd: path.dirname(p), detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => {}).unref() } = {}) {
  const p = appPath(id);
  if (!p) throw new Error('that app was not found; press Check again');
  start(p);
  return { ok: true };
}
async function check(fresh = false) {
  if (!fresh && cache.value && Date.now() - cache.at < 60000) return cache.value;
  if (pending) return pending;
  pending = (async () => {
    const facts = await gather();
    const results = runChecks(facts);
    cache = { at: Date.now(), facts, value: { at: new Date().toISOString(), results, summary: summary(results) } };
    return cache.value;
  })();
  try { return await pending; } finally { pending = null; }
}

module.exports = { check, openApp, CHECKS, _test: { appPath, DRIVER_APPS, runChecks, summary, diskSpace, driveHealth, graphicsDriver, ramSpeed, deviceErrors, crashes, restartPending, nvidiaNumber, partSpeed, bugcheckCode } };
