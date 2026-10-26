// PC check (24 Oct 2026, Shawn picked it; docs/handoff/display-health.md): how this PC is doing, read only. Not the
// same as Settings > Health, which is about DeviceHub itself. Nothing is installed or changed, ever.
// The facts come from one PowerShell read as the signed-in user (helpers/pc-check.ps1); each check below is a plain
// function over them returning one or more results { id, title, level: 'ok' | 'warn' | 'info', line, link? }.
// To add a check: write a function (facts, now) => result or [results], and add it to CHECKS.
// Read when the page opens (kept 60 s) and on Check again; never in the background.
const path = require('path');
const fs = require('fs');
const https = require('https');
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
    const r = x.free / x.size < 0.10
      ? result('disk-space', 'Free space', 'warn', `${name} is almost full: ${size(x.free)} free of ${size(x.size)}.`)
      : result('disk-space', 'Free space', 'ok', `${name} has ${size(x.free)} free of ${size(x.size)}.`);
    r.disk = {
      drive: x.drive,
      label: x.label,
      free: x.free,
      size: x.size,
      used: x.size - x.free,
      freeStr: size(x.free),
      sizeStr: size(x.size),
      usedStr: size(x.size - x.free),
      pctUsed: 100 - pct,
    };
    return r;
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
    if (!v.date && !f.driverUpdates) return result('gpu-driver', 'Graphics driver', 'info', `${v.name}: driver ${ver}; its date is not known.`, link);
    const age = v.date ? Math.floor((now - Date.parse(`${v.date}T00:00:00Z`)) / DAY) : 0;
    const latest = f.driverUpdates?.[v.name] || (isNv ? f.driverUpdates?.nvidia : null);
    const isNewer = latest && ver && String(latest).localeCompare(String(ver), undefined, { numeric: true }) > 0;
    if (isNewer || age > DRIVER_OLD_DAYS) {
      return result('gpu-driver', 'Graphics driver', 'warn', `${v.name}: new driver update ready.`, link);
    }
    return result('gpu-driver', 'Graphics driver', 'ok', `${v.name}: driver ${ver} is up to date.`, link);
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
// Windows Update's own answer (what Settings > Windows Update shows) and the servicing stack's; files an installer left
// to delete at the next start no longer count (24 Oct 2026, Shawn: "is the restart actually accurate?": it was not)
function restartPending(f) {
  const r = f.restart;
  if (!r) return result('restart', 'Restart', 'info', 'Whether a restart is waiting was not read.');
  if (r.wu) return result('restart', 'Restart', 'warn', 'Windows Update installed an update that finishes on restart.', { text: 'Windows Update', settings: 'windows-update' });
  if (r.cbs) return result('restart', 'Restart', 'warn', 'A Windows update or feature finishes on restart.', { text: 'Windows Update', settings: 'windows-update' });
  return result('restart', 'Restart', 'ok', 'No restart is waiting.');
}

// ---- what would make games and the network better (24 Oct 2026, Shawn: "even more things that could be optimized to
// have better fps, wifi, etc ONLY if they can be done. For example if resizable bar is already on or high performance is
// already on for power plan then dont show it") ----
// Each returns nothing when it is already right, when it does not apply to this PC, or when Windows did not say: only
// what can be changed is shown. Each has its fix: a Windows Settings page (open-settings, PC_SETTINGS), DeviceHub's
// own one click (the power plan, POST /api/pc-check/fix), or where to change it (the BIOS, a cable).
const PLAN = { high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', ultimate: 'e9a42b02-d5df-448d-aa00-03f14749eb61', balanced: '381b4222-f694-41f0-9685-ff5bb260df2e', saver: 'a1841308-3541-4fab-bc81-f71556f20b4a' };
const BEST_OVERLAY = 'ded574b5-45a0-4f42-8737-46345c09c238';
// the plan the power-plan fix switches to: Ultimate, else High performance, else one named for performance; only from
// the list this PC itself gave
function fastPlan(t) {
  const plans = t?.power?.plans || [];
  return plans.find((p) => p.guid === PLAN.ultimate) || plans.find((p) => p.guid === PLAN.high) || plans.find((p) => /high perf|ultimate/i.test(p.name)) || null;
}
function powerPlan(f) {
  const t = f.tune, pw = t?.power;
  if (!pw?.active || t.battery !== false) return null;   // a laptop (or not known): its battery matters more
  const cur = (pw.plans || []).find((p) => p.guid === pw.active);
  if ([PLAN.high, PLAN.ultimate].includes(pw.active) || /high perf|ultimate|performance|ryzen|bitsum/i.test(cur?.name || '')) return null;
  if (String(pw.overlay || '').toLowerCase() === BEST_OVERLAY) return null;   // Windows 11's power mode: Best performance
  const name = cur?.name || 'Balanced';
  const fast = fastPlan(t);
  if (fast) return result('power-plan', 'Power plan', 'warn', `${name}: the CPU slows down to save power. ${fast.name} keeps it fast in games.`, { text: `Switch to ${fast.name}`, fix: 'power-plan' });
  return result('power-plan', 'Power plan', 'warn', `${name}: set Power mode to Best performance for games.`, { text: 'Power mode', settings: 'power' });
}
function gameMode(f) {
  if (f.tune?.gameMode !== 0) return null;   // missing = on (Windows' default)
  return result('game-mode', 'Game Mode', 'warn', 'Off. Game Mode puts the game first and holds back Windows Update while you play.', { text: 'Game Mode', settings: 'game-mode' });
}
function backgroundRecording(f) {
  if (f.tune?.bgRecord !== 1) return null;
  return result('bg-record', 'Background recording', 'warn', 'Xbox Game Bar records the last minutes all the time, which costs frames. Turn off "Record what happened".', { text: 'Captures', settings: 'captures' });
}
function gpuScheduling(f) {
  if (f.tune?.hags !== 1) return null;   // 2 = on; missing = the card or Windows does not offer it
  return result('gpu-scheduling', 'GPU scheduling', 'info', 'Hardware-accelerated GPU scheduling is off. On, it lowers latency on most cards (needs a restart).', { text: 'Graphics settings', settings: 'graphics' });
}
function windowedGames(f) {
  const t = f.tune;
  if (!t || !(t.windowsBuild >= 22621) || !/SwapEffectUpgradeEnable=0/i.test(t.dxGlobal || '')) return null;
  return result('windowed-games', 'Windowed games', 'info', 'Optimizations for windowed games is off. On, borderless games get lower latency.', { text: 'Graphics settings', settings: 'graphics' });
}
// NVIDIA RTX 30, 40 and 50 cards use it; BAR1 of 256 MiB means it is off (nvidia-smi)
function resizableBar(f) {
  const t = f.tune;
  if (!t || t.bar1MiB == null || t.bar1MiB > 256) return null;
  const card = (f.video || []).find((v) => /RTX\s*(30|40|50)\d0/i.test(v.name || ''));
  if (!card) return null;
  const [, url, maker] = BOARD_SUPPORT.find(([re]) => re.test(`${f.board?.maker || ''}`)) || [];
  const legacy = t.firmware === 1 ? ' This PC starts in legacy (CSM) mode, which it cannot use: that needs the drive converted to GPT first (Windows\' MBR2GPT).' : '';
  return result('rebar', 'Resizable BAR', 'warn', `Off for the ${card.name.replace(/^NVIDIA (GeForce )?/i, '')}. In the BIOS turn on Above 4G Decoding and Re-Size BAR (a BIOS update may add them); a few percent more fps in many games.${legacy}`, url ? { text: `${maker} BIOS updates`, url } : null);
}
// two or more sticks all on one memory channel: half the bandwidth (the board's manual names the dual-channel slots)
const channelOf = (r) => {
  const m = /channel\s*([A-H])\b/i.exec(r.bank || '') || /channel\s*([A-H])/i.exec(r.slot || '') || /^(?:DIMM[_ ]?)?([A-H])\d$/i.exec(String(r.slot || '').trim());
  return m ? m[1].toUpperCase() : null;
};
function ramChannels(f) {
  const sticks = (f.ram || []).filter((r) => r.gb > 0);
  if (sticks.length < 2) return null;
  const ch = sticks.map(channelOf);
  if (ch.some((c) => !c) || new Set(ch).size > 1) return null;
  return result('ram-channels', 'RAM slots', 'warn', `All ${sticks.length} sticks are on channel ${ch[0]}, so the RAM runs single channel. Move half to the other channel's slots (the board's manual names them; usually A2 and B2).`);
}
function wifi(f) {
  const w = f.tune?.wifi;
  if (!w) return null;
  const out = [];
  const signal = parseInt(w.signal, 10);
  const on24 = /2\.4/.test(w.band || '') || (!w.band && parseInt(w.channel, 10) <= 14);
  if (on24 && w.fiveNearby && /802\.11(a|ac|ax|be)\b/i.test(w.radios || '')) {
    out.push(result('wifi-band', 'Wi-Fi', 'warn', 'On 2.4 GHz. Your router also has 5 GHz here and this adapter can use it: faster, with steadier ping.', { text: 'Wi-Fi settings', settings: 'wifi' }));
  }
  if (signal > 0 && signal <= 50) out.push(result('wifi-signal', 'Wi-Fi signal', 'warn', `Weak (${signal}%). A cable, or the PC nearer the router, gives a steadier ping.`));
  else if (w.rxMbps > 0 && w.rxMbps < 100 && !on24) out.push(result('wifi-speed', 'Wi-Fi speed', 'warn', `Link rate is only ${Math.round(w.rxMbps)} Mbps. Interference or a crowded channel can cause lag spikes in games.`, { text: 'Wi-Fi settings', settings: 'wifi' }));
  if (f.tune.power?.wifiSaveAc > 0 && f.tune.battery === false) out.push(result('wifi-power', 'Wi-Fi power saving', 'info', 'On while plugged in. Set Wireless Adapter Settings to Maximum Performance (Power Options, advanced settings).', { text: 'Power Options', settings: 'power-options' }));
  return out.length ? out : null;
}
function networkLatency(f) {
  const l = f.tune?.latency;
  if (!l || l.gwMs == null) return null;
  const { gwMs, gwJitter, inMs, inJitter } = l;
  if (gwJitter >= 20 || gwMs > 35) {
    return result('network-jitter', 'Network ping stability', 'warn', `Your Wi-Fi has ping spikes (takes ${Math.round(gwMs)}ms to reach your router, jumping by ±${gwJitter}ms). Usually caused by interference or Windows scanning for networks in the background.`);
  }
  if (inMs != null && (inJitter >= 30 || inMs > 90)) {
    return result('network-jitter', 'Network ping stability', 'info', `Your Wi-Fi is fast (${Math.round(gwMs)}ms to your router), but outside internet ping is higher (${Math.round(inMs)}ms). Any lag is coming from your internet provider or the game's servers, not your PC.`);
  }
  return null;
}
function ethernet(f) {
  const slow = (f.tune?.wired || []).filter((a) => a.bps > 0 && a.bps < 1e9);
  if (!slow.length) return null;
  return slow.map((a) => result('ethernet', 'Ethernet', 'warn', `${a.name} runs at ${Math.round(a.bps / 1e6)} Mbps. Gigabit ports drop to this with an old or damaged cable or router port: try another cable.`));
}
function mouseAcceleration(f) {
  if (f.tune?.mouseAccel !== '1') return null;
  return result('mouse-accel', 'Mouse', 'info', '"Enhance pointer precision" (acceleration) is on. Most players turn it off for the same aim at any speed.', { text: 'Mouse settings', settings: 'mouse' });
}
// a screen below its highest refresh rate (helpers/display.js refreshFlag; the Monitors page has the one-click fix)
function refreshRate(f) {
  const flagged = (f.screens || []).filter((s) => s.flag);
  if (!flagged.length) return null;
  return flagged.map((s) => result('refresh', 'Refresh rate', 'warn', `${s.name}: ${s.flag.text}`, { text: 'Monitors', page: 'monitors' }));
}

// the checks, in the order shown
const CHECKS = [diskSpace, driveHealth, graphicsDriver, ramSpeed, deviceErrors, crashes, restartPending,
  refreshRate, powerPlan, resizableBar, ramChannels, gameMode, backgroundRecording, gpuScheduling, windowedGames, wifi, ethernet, networkLatency, mouseAcceleration];

// the Windows Settings pages a result may open (POST /api/pc-check/open-settings { page }); nothing else is started
const PC_SETTINGS = {
  'windows-update': ['explorer.exe', ['ms-settings:windowsupdate']], power: ['explorer.exe', ['ms-settings:powersleep']],
  'game-mode': ['explorer.exe', ['ms-settings:gaming-gamemode']], captures: ['explorer.exe', ['ms-settings:gaming-gamedvr']],
  graphics: ['explorer.exe', ['ms-settings:display-advancedgraphics']], wifi: ['explorer.exe', ['ms-settings:network-wifi']],
  'power-options': ['control.exe', ['powercfg.cpl']], mouse: ['control.exe', ['main.cpl']],
};
function openSettings(page, { start = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref() } = {}) {
  const s = Object.prototype.hasOwnProperty.call(PC_SETTINGS, page) ? PC_SETTINGS[page] : null;
  if (!s) throw new Error('unknown settings page');
  start(s[0], s[1]);
  return { ok: true };
}
// POST /api/pc-check/fix { id: 'power-plan' }: the one change DeviceHub makes itself, on the person's click. The plan
// comes from this PC's own list (the last check), and it is the same switch as Power Options (powercfg /setactive, no
// administrator). The plan it was on is said in the answer, to switch back from Power Options.
function fix(id, { facts = cache.facts, run = (args) => new Promise((resolve, reject) => execFile('powercfg', args, { windowsHide: true, timeout: 15000 }, (e) => (e ? reject(new Error(String(e.message).split('\n')[0])) : resolve()))) } = {}) {
  if (id === 'power-plan') {
    const fast = fastPlan(facts?.tune);
    if (!fast || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fast.guid)) return Promise.reject(new Error('no high performance plan on this PC; press Check again'));
    const was = (facts.tune.power.plans || []).find((p) => p.guid === facts.tune.power.active)?.name || 'the plan before';
    return run(['/setactive', fast.guid]).then(() => { cache.at = 0; return { ok: true, now: fast.name, was }; });
  }
  return Promise.reject(new Error('unknown fix'));
}

let latestNvidiaCache = { at: 0, version: null };
function fetchLatestNvidiaDriver() {
  if (Date.now() - latestNvidiaCache.at < 6 * 3600 * 1000 && latestNvidiaCache.version) {
    return Promise.resolve(latestNvidiaCache.version);
  }
  return new Promise((resolve) => {
    const req = https.get('https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid=127&osID=57&languageCode=1078&isWHQL=1&dltype=1&dch=1&sort1=0&numberOfResults=1', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const v = json.IDS?.[0]?.downloadInfo?.Version;
          if (v && /^\d+(\.\d+)+$/.test(v)) {
            latestNvidiaCache = { at: Date.now(), version: v };
            return resolve(v);
          }
        } catch {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

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
// screens(): the display controller's read (helpers/pc-routes.js), for the refresh rate check; optional
// Fast (27 Oct 2026, Shawn: "how can we make the ... pc check all load faster?"): the last answer is shown at once and
// read again in the background when it is over a minute old; it is kept on disk, so it is there right after a restart;
// server.js reads it once 30 s after DeviceHub starts; the NVIDIA latest-driver lookup never holds the check up.
const DISK = path.join(__dirname, '..', 'pc-check-cache.json');
try { const d = JSON.parse(fs.readFileSync(DISK, 'utf8')); if (d?.value && Date.now() - d.at < 24 * 3600 * 1000) cache = { at: d.at, facts: null, value: d.value }; if (d?.nvidia?.version) latestNvidiaCache = d.nvidia; } catch {}
async function check(fresh = false, opts = {}) {
  if (!fresh && cache.value) {
    if (Date.now() - cache.at >= 60000 && !pending) readNow(opts).catch(() => {});
    return cache.value;
  }
  return readNow(opts);
}
async function readNow({ screens = null } = {}) {
  if (pending) return pending;
  pending = (async () => {
    const [facts, sc] = await Promise.all([gather(), screens ? screens().catch(() => null) : null]);
    if (sc?.screens) facts.screens = sc.screens;
    const hasNv = (facts.video || []).some((v) => /nvidia/i.test(`${v.maker} ${v.name}`));
    if (hasNv && !facts.driverUpdates?.nvidia) {
      // the answer cached from an earlier lookup now; a new lookup runs in the background for next time
      const nvLatest = latestNvidiaCache.version || null;
      if (Date.now() - latestNvidiaCache.at >= 6 * 3600 * 1000) fetchLatestNvidiaDriver().catch(() => {});
      if (nvLatest) facts.driverUpdates = { ...(facts.driverUpdates || {}), nvidia: nvLatest };
    }
    const results = runChecks(facts);
    const latency = facts.tune?.latency || null;
    let band = facts.tune?.wifi?.band ? String(facts.tune.wifi.band).trim() : null;
    const chVal = parseInt(facts.tune?.wifi?.channel, 10);
    const radio = facts.tune?.wifi?.radio || '';
    if (/invalid|unknown/i.test(band || '') || (!band && chVal)) {
      if (/802\.11be/i.test(radio) || chVal === 133 || (chVal > 14 && chVal < 36) || chVal > 177) {
        band = '6 GHz';
      } else if (chVal > 14) {
        band = '5 GHz';
      } else if (chVal > 0) {
        band = '2.4 GHz';
      }
    }
    const wifiInfo = facts.tune?.wifi ? { name: facts.tune.wifi.name, band, channel: facts.tune.wifi.channel, signal: facts.tune.wifi.signal, rxMbps: facts.tune.wifi.rxMbps, autoConfig: facts.tune.wifi.autoConfig } : null;
    cache = { at: Date.now(), facts, value: { at: new Date().toISOString(), results, summary: summary(results), latency, wifi: wifiInfo } };
    try { fs.writeFileSync(DISK, JSON.stringify({ at: cache.at, value: cache.value, nvidia: latestNvidiaCache })); } catch {}
    return cache.value;
  })();
  try { return await pending; } finally { pending = null; }
}

module.exports = { check, openApp, openSettings, fix, CHECKS, PC_SETTINGS, _test: { appPath, DRIVER_APPS, runChecks, summary, diskSpace, driveHealth, graphicsDriver, ramSpeed, deviceErrors, crashes, restartPending, nvidiaNumber, partSpeed, bugcheckCode,
  powerPlan, gameMode, backgroundRecording, gpuScheduling, windowedGames, resizableBar, ramChannels, channelOf, wifi, ethernet, networkLatency, mouseAcceleration, refreshRate, fastPlan, PLAN } };
