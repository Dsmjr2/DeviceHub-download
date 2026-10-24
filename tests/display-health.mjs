// Display settings, temperatures and the PC check (24 Oct 2026; docs/handoff/display-health.md), with fakes only:
// nothing here runs PowerShell, changes a screen or reads the PC.
// - the refresh-rate flag, a screen's modes, the Night light blob;
// - a display change: backed up, read back, kept or put back after 15 s (a fake clock and timer), one at a time;
// - the PC check: disk space, drive health, driver age, RAM speed, devices with errors, crashes, a waiting restart;
// - the temperatures decision (which sources, what is not readable).
// Run: node tests/display-health.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const display = require('../helpers/display.js');
const { _test: dt } = display;
const { _test: pc } = require('../helpers/pc-check.js');
const { _test: sensors } = require('../helpers/pc-sensors.js');
const routes = require('../helpers/pc-routes.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// ---------- refresh-rate flag ----------
const modes = [[2560, 1440, 144], [2560, 1440, 120], [2560, 1440, 60], [1920, 1080, 240], [1920, 1080, 60]];
const f1 = dt.refreshFlag({ width: 2560, height: 1440, hz: 60, modes });
check(f1 && f1.text === 'Running at 60 Hz; this screen does 144 Hz.' && f1.fix.hz === 144 && f1.fix.width === 2560, `60 Hz on a 144 Hz screen is flagged with a fix (${JSON.stringify(f1)})`);
check(dt.refreshFlag({ width: 2560, height: 1440, hz: 144, modes }) === null, 'at its highest rate: no flag');
check(dt.refreshFlag({ width: 2560, height: 1440, hz: 143, modes }) === null, '143 vs 144 Hz is the same rate: no flag');
check(dt.refreshFlag({ width: 1920, height: 1080, hz: 60, modes })?.fix.hz === 240, 'the highest rate at the CURRENT resolution (240 at 1080p, not 144)');
check(dt.refreshFlag({ width: 800, height: 600, hz: 60, modes }) === null, 'a resolution with no listed modes: no flag');
const sh = dt.shape({ screen: '\\\\.\\DISPLAY1', id: 'AOC#1', name: 'AOC', primary: true, width: 2560, height: 1440, hz: 60, modes, hdr: { supported: true, on: false } });
check(sh.resolutions[0].width === 2560 && JSON.stringify(sh.resolutions[0].rates) === '[144,120,60]' && sh.flag?.fix.hz === 144, 'shape: largest resolution first, rates high to low, flag carried');

// ---------- Night light (read only) ----------
const OFF = '43 42 01 00 0A 02 01 00 2A 06 94 B4 BA E5 09 2A 2B 0E 13 43 42 01 00 D0 0A 02 C6 14 CA 85 EE 89 E1 91 A3 EE 01 00 00 00 00';
check(dt.nightLight(OFF) === false, 'Night light off (Shawn\'s own blob, 24 Oct 2026)');
check(dt.nightLight(OFF.replace(' 2B 0E 13 ', ' 2B 0E 15 ')) === true, 'Night light on');
check(dt.nightLight('') === null && dt.nightLight('00 11 22') === null && dt.nightLight(OFF.replace(' 2B 0E 13 ', ' 2B 0E 77 ')) === null, 'anything else is not known');

// ---------- a display change, with fakes ----------
function fakePc({ refuseReadBack = false } = {}) {
  const screens = [
    { screen: 'S1', id: 'A#1', name: 'Left', primary: true, width: 2560, height: 1440, hz: 60, x: 0, y: 0, modes, hdr: { supported: true, on: false } },
    { screen: 'S2', id: 'B#2', name: 'Right', primary: false, width: 1920, height: 1080, hz: 60, x: 2560, y: 0, modes, hdr: { supported: false, on: false } },
  ];
  const calls = [];
  const run = async (op, v = {}) => {
    calls.push([op, { ...v }]);
    if (op === 'read') return { screens: JSON.parse(JSON.stringify(screens)), nightLight: OFF };
    const s = screens.find((x) => x.screen === v.screen);
    if (op === 'mode' && !refuseReadBack) Object.assign(s, { width: v.width, height: v.height, hz: v.hz });
    if (op === 'hdr') s.hdr.on = v.on === 1;
    if (op === 'primary') for (const x of screens) x.primary = x.screen === v.screen;
    return true;
  };
  let t = 1000000, timers = [];
  const clock = { now: () => t, setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { timers = timers.filter((y) => y !== x); }, advance: async (ms) => { t += ms; for (const x of timers.filter((y) => y.at <= t)) { timers = timers.filter((y) => y !== x); await x.fn(); } await new Promise((r) => setImmediate(r)); } };
  const backups = [];
  const ctl = display.create({ run, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, backupDir: 'B', writeFile: (f, txt) => backups.push([f, JSON.parse(txt)]) });
  return { ctl, calls, clock, backups, screens };
}

{ // a mode change not kept within 15 s goes back by itself
  const { ctl, calls, clock, backups, screens } = fakePc();
  const st = await ctl.change('S1', 'mode', { width: 2560, height: 1440, hz: 144 });
  check(st.pending && st.pending.secondsLeft === 15 && st.pending.text === '2560 x 1440 at 144 Hz', `pending with 15 s left (${JSON.stringify(st)})`);
  check(backups.length === 1 && backups[0][1].screens.length === 2 && backups[0][1].screens[0].hz === 60, 'every screen backed up before the change');
  const modeCall = calls.find(([op]) => op === 'mode');
  check(modeCall && modeCall[1].persist === 0, 'applied for this session only first');
  check(calls.findIndex(([op]) => op === 'mode') < calls.length - 1 && calls[calls.length - 1][0] === 'read', 'read back after the change');
  check(screens[0].hz === 144, 'the fake screen runs the new mode');
  await clock.advance(14000);
  check(ctl.state().pending?.secondsLeft === 1, 'one second left at 14 s');
  await clock.advance(1000);
  check(screens[0].hz === 60 && !ctl.state().pending, 'not kept: back to 60 Hz at 15 s');
  const back = calls.filter(([op]) => op === 'mode').pop();
  check(back[1].hz === 60 && back[1].persist === 1, 'put back from the backup');
  check(/not kept, so it is back as it was/.test(ctl.state().last?.text || '') && ctl.state().last.ok, `the result says so (${ctl.state().last?.text})`);
}
{ // Keep saves it
  const { ctl, calls, clock, screens } = fakePc();
  await ctl.change('S1', 'mode', { width: 2560, height: 1440, hz: 144 });
  const st = await ctl.keep();
  check(!st.pending && st.last.ok && /kept/.test(st.last.text), 'Keep: kept');
  check(calls.filter(([op]) => op === 'mode').pop()[1].persist === 1, 'Keep saves the mode');
  await clock.advance(20000);
  check(screens[0].hz === 144, 'a kept change is not put back later');
}
{ // HDR is done at once, with no Keep wait (24 Oct 2026, Shawn: "hdr button is slow"); Undo of a mode puts it back at once
  const { ctl, screens } = fakePc();
  const on = await ctl.change('S1', 'hdr', true);
  check(screens[0].hdr.on === true && !on.pending && on.last.ok && /HDR on/.test(on.last.text), 'HDR on at once, nothing waits for Keep');
  await ctl.change('S1', 'mode', { width: 2560, height: 1440, hz: 144 });
  const st = await ctl.revert();
  check(screens[0].hz !== 144 && !st.pending && /back as it was/.test(st.last.text), 'Undo: the mode is back');
}
{ // one at a time, and refusals
  const { ctl } = fakePc();
  await ctl.change('S1', 'mode', { width: 2560, height: 1440, hz: 120 });
  let e = null; try { await ctl.change('S2', 'primary', true); } catch (x) { e = x; }
  check(e && /Keep or undo the last change first/.test(e.message), 'a second change waits for the first');
  await ctl.revert();
  e = null; try { await ctl.change('S2', 'hdr', true); } catch (x) { e = x; }
  check(e && /does not offer HDR/.test(e.message), 'HDR refused on a screen without it');
  e = null; try { await ctl.change('S1', 'mode', { width: 1234, height: 567, hz: 60 }); } catch (x) { e = x; }
  check(e && /does not offer that mode/.test(e.message), 'a mode the screen does not list is refused before anything is sent');
  e = null; try { await ctl.change('S1', 'primary', true); } catch (x) { e = x; }
  check(e && /already the main screen/.test(e.message), 'already main');
}
{ // main screen, then put back
  const { ctl, screens, clock } = fakePc();
  await ctl.change('S2', 'primary', true);
  check(screens[1].primary && !screens[0].primary, 'Right is main');
  await clock.advance(15000);
  check(screens[0].primary && !screens[1].primary, 'not kept: Left is main again');
}
{ // a change Windows does not show is put back at once
  const { ctl, calls } = fakePc({ refuseReadBack: true });
  const st = await ctl.change('S1', 'mode', { width: 2560, height: 1440, hz: 144 });
  check(!st.pending && st.last && !st.last.ok && /did not take/.test(st.last.text), `read-back differs: put back, said plainly (${JSON.stringify(st.last)})`);
  check(calls.filter(([op]) => op === 'mode').length === 2, 'and the backed-up mode was written back');
}

// ---------- PC check ----------
const GB = 1024 ** 3;
const ds = pc.diskSpace({ volumes: [{ drive: 'C:', label: '', size: 1000 * GB, free: 50 * GB }, { drive: 'D:', label: 'Games', size: 1000 * GB, free: 300 * GB }] });
check(ds[0].level === 'warn' && /C: is almost full: 50 GB free of 1000 GB \(5%\)/.test(ds[0].line), `under 10% warns (${ds[0].line})`);
check(ds[1].level === 'ok' && ds[1].line === 'D: (Games) has 300 GB free of 1000 GB (30%).', `30% is fine (${ds[1].line})`);
check(pc.diskSpace({ volumes: [{ drive: 'E:', size: 100 * GB, free: 10 * GB }] })[0].level === 'ok', 'exactly 10% is not under 10%');

const dh = pc.driveHealth({ disks: [{ id: '0', name: 'SSD A', media: 'SSD', health: 'Healthy' }, { id: '1', name: 'HDD B', media: 'HDD', health: 'Warning', status: 'Predictive Failure' }], reliability: [{ id: '0', wear: 3, tempC: 41 }] });
check(dh[0].level === 'ok' && dh[0].line === 'SSD A (SSD): healthy, 3% worn, 41 °C.' && dh[1].level === 'warn', `drive health (${dh.map((x) => x.line).join(' | ')})`);
const dh2 = pc.driveHealth({ disks: [{ id: '0', name: 'SSD A', media: 'SSD', health: 'Healthy' }], denied: ['reliability'] });
check(dh2.length === 1 && dh2[0].line === 'SSD A (SSD): healthy.', 'wear without admin: not mentioned, only the plain healthy line (Shawn, 24 Oct 2026)');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const nv = (date) => ({ video: [{ name: 'NVIDIA GeForce RTX 4070', maker: 'NVIDIA', version: '32.0.16.2101', date }] });
const fresh = pc.graphicsDriver(nv('2026-10-18'), NOW)[0];
check(fresh.level === 'ok' && fresh.line === 'NVIDIA GeForce RTX 4070: driver 621.01, from Oct 18, 2026.' && fresh.link.url.includes('nvidia.com'), `a new driver is fine (${fresh.line})`);
// the NVIDIA App when it is installed (found by helpers/pc-check.ps1), else the download page
const win = (s) => s.split('/').join(String.fromCharCode(92));   // forward slashes to Windows' backslashes
const PF = process.env.ProgramFiles || win('C:/Program Files');
const NVAPP = `${PF}${win('/NVIDIA Corporation/NVIDIA app/CEF/NVIDIA App.exe')}`;
const withApp = pc.graphicsDriver({ ...nv('2026-10-18'), driverApps: { nvidia: NVAPP, amd: null } }, NOW)[0];
check(withApp.link.app === 'nvidia' && withApp.link.text === 'Open NVIDIA App' && !withApp.link.url, `NVIDIA App installed: its button (${JSON.stringify(withApp.link)})`);
const amdApp = pc.graphicsDriver({ video: [{ name: 'AMD Radeon RX 7800 XT', maker: 'Advanced Micro Devices, Inc.', version: '32.0.11021.1011', date: '2026-10-01' }], driverApps: { amd: `${PF}${win('/AMD/CNext/CNext/RadeonSoftware.exe')}` } }, NOW)[0];
check(amdApp.link.app === 'amd' && amdApp.link.text === 'Open AMD Software', 'AMD Software installed: its button');
const ok = (p) => pc.appPath('nvidia', { driverApps: { nvidia: p } }, { exists: () => true });
check(ok(NVAPP) !== null, 'open-app: the NVIDIA App under Program Files');
check(ok(win('C:/Users/me/NVIDIA App.exe')) === null && ok(`${PF}${win('/NVIDIA Corporation/evil.exe')}`) === null && ok(`${PF}${win('/../x/NVIDIA App.exe')}`) === null && pc.appPath('nvidia', null) === null && pc.appPath('notepad', { driverApps: { notepad: 'x' } }) === null, 'open-app refuses any other path, name or app');
check(pc.appPath('nvidia', { driverApps: { nvidia: NVAPP } }, { exists: () => false }) === null, 'open-app refuses an exe that is gone');
const old = pc.graphicsDriver(nv('2026-03-01'), NOW)[0];
check(old.level === 'warn' && /over 6 months old/.test(old.line), `a driver over 6 months old warns (${old.line})`);
check(pc.graphicsDriver(nv('2026-05-01'), NOW)[0].level === 'ok', 'under 6 months is fine');
check(pc.nvidiaNumber('32.0.15.6094') === '560.94' && pc.nvidiaNumber('32.0.16.2101') === '621.01' && pc.nvidiaNumber('x') === null, 'NVIDIA driver number from the Windows version');
const amd = pc.graphicsDriver({ video: [{ name: 'AMD Radeon RX 7800 XT', maker: 'Advanced Micro Devices, Inc.', version: '32.0.12011.1036', date: '2026-09-01' }] }, NOW)[0];
check(amd.level === 'ok' && amd.line.includes('32.0.12011.1036') && amd.link.url.includes('amd.com'), 'AMD: its version and its official page');
check(pc.graphicsDriver({ video: [{ name: 'Microsoft Basic Display Adapter', maker: '(Standard display types)', version: '10.0', date: '2006-06-21' }] }, NOW)[0].level === 'warn', 'no real driver: warn');
check([].concat(pc.graphicsDriver({ video: [{ name: 'Parsec Virtual Display Adapter', version: '1', date: '2020-01-01' }] }, NOW))[0].level === 'info', 'virtual adapters are not judged');

const ram = (configured, part, speed = configured) => ({ ram: [{ part, speed, configured }, { part, speed, configured }], board: { maker: 'Gigabyte Technology Co., Ltd.', model: 'B450 AORUS PRO WIFI-CF' } });
const slow = pc.ramSpeed(ram(2133, 'F4-3200C16-8GVKB'));
check(slow.level === 'warn' && slow.line === '2133 of 3200 MT/s. Turn on XMP/EXPO in the BIOS.' && slow.link.url === 'https://www.gigabyte.com/Support' && slow.link.text === 'Gigabyte support', `RAM at base speed warns, with the board maker's page (${slow.line} ${JSON.stringify(slow.link)})`);
check(pc.ramSpeed(ram(3200, 'F4-3200C16-8GVKB')).level === 'ok', 'RAM at its rating is fine');
check(pc.ramSpeed({ ram: [{ part: 'F4-3200C16-8GVKB', speed: 3200, configured: 3200 }, { part: 'F4-3000C16-8GISB', speed: 3200, configured: 3200 }] }).level === 'ok', "Shawn's mixed sticks (3000 and 3200) at 3200 are fine");
check(pc.ramSpeed(ram(4800, 'KF556C40-16', 4800)).level === 'warn', 'DDR5 rated 5600 at 4800 warns (rating from the part number)');
check(pc.ramSpeed(ram(2400, 'M378A1K43CB2-CTD', 2666)).level === 'warn', 'no rating in the part number: the stick\'s own speed');
check(pc.partSpeed('CMK16GX4M2B3200C16') === 3200 && pc.partSpeed('KF432C16BB/8') === 3200 && pc.partSpeed('BL8G32C16U4B.M8FE1') === 3200 && pc.partSpeed('CP16G56C46U5.C8D') === 5600 && pc.partSpeed('TF3D416G3200HC16F') === 3200 && pc.partSpeed('HX432C16FB3/8') === 3200 && pc.partSpeed('M378A1K43CB2-CTD') === null, 'ratings read from part numbers');

const dev = pc.deviceErrors({ devices: [{ name: 'Realtek(R) Audio', problem: 22, status: 'Error' }, { name: 'USB Hub', problem: 43, status: 'Error' }, { name: 'Gone mouse', problem: 45, status: 'Unknown' }, { name: 'Odd thing', problem: 0, status: 'Error' }] });
check(dev.length === 2 && !dev.some((d) => /Realtek|turned off/.test(d.line)), `turned off by the person in Device Manager: not shown (Shawn, 24 Oct 2026) (${dev.map((x) => x.line).join(' | ')})`);
check(dev[0].level === 'warn' && dev[0].line === 'USB Hub was stopped by Windows because it reported problems.', `code 43 in words (${dev[0]?.line})`);
check(dev[1].line === 'Odd thing reports an error.' && !dev.some((d) => /Gone mouse/.test(d.line)), 'a ghost (45) is skipped; an error with no code still shows');
check(pc.deviceErrors({ devices: [{ name: 'Wi-Fi', problem: 22, status: 'Error' }] }).level === 'ok', 'only turned-off devices: fine');
check(pc.deviceErrors({ devices: [] }).level === 'ok', 'none: fine');

const cr = pc.crashes({ events: { bugchecks: [{ at: '2026-10-14T23:50:33-04:00', param: '0x000000be (0xffffe578f0c07000, 0x8a00000000200101)' }],
  shutdowns: [{ at: '2026-10-14T23:50:19-04:00', bugcheck: 190 }, { at: '2026-10-05T10:52:26-04:00', bugcheck: 0 }], whea: [] } });
check(cr.length === 1 && cr[0].level === 'warn' && /1 crash \(blue screen\) in the last 30 days: Oct 1[45]\. Last: 0xBE: a driver wrote to read-only memory/.test(cr[0].line), `a crash with its stop code in words (${cr[0]?.line})`);
check(!cr.some((x) => /unexpected shutdown|power/i.test(x.line)), 'a power loss or held power button is not listed (Shawn, 24 Oct 2026); the blue screen is');
check(pc.crashes({ events: { bugchecks: [], shutdowns: [{ at: '2026-10-05T10:52:26-04:00', bugcheck: 0 }], whea: [] } })[0].line === 'No crashes in the last 30 days.', 'only a power loss: no crashes');
check(pc.crashes({ events: { bugchecks: [], shutdowns: [], whea: [{ at: '2026-10-20T10:00:00Z', id: 17 }, { at: '2026-10-21T10:00:00Z', id: 17 }] } })[0].line.startsWith('2 hardware errors logged'), 'WHEA errors counted');
check(pc.crashes({ events: { bugchecks: [], shutdowns: [], whea: [] } })[0].level === 'ok', 'none: fine');
check(/needs administrator/.test([].concat(pc.crashes({ events: null, denied: ['events'] }))[0].line), 'a log that needs admin is said so');
check(pc.bugcheckCode('0x00000124 (0x0, ...)') === 0x124 && pc.bugcheckCode(0) === null && pc.bugcheckCode(278) === 278, 'stop codes read');

check(pc.restartPending({ restart: { cbs: true, wu: false, files: 0 } }).line === 'Restart to finish an update.' && pc.restartPending({ restart: { cbs: false, wu: true, files: 0 } }).level === 'warn', 'a pending update restart warns');
check(pc.restartPending({ restart: { cbs: false, wu: false, files: 2 } }).level === 'info', 'files waiting for a restart: a note');
check(pc.restartPending({ restart: { cbs: false, wu: false, files: 0 } }).level === 'ok', 'nothing waiting: fine');

const all = pc.runChecks({ volumes: [] }, NOW, [pc.diskSpace, function broken() { throw new Error('boom'); }]);
check(all.length === 2 && all[1].level === 'info' && /could not run: boom/.test(all[1].line), 'a check that fails is one plain line, not a crash');
check(JSON.stringify(pc.summary([{ level: 'warn' }, { level: 'ok' }, { level: 'ok' }])) === '{"warn":1,"info":0,"ok":2}', 'summary counts');
check(require('../helpers/pc-check.js').CHECKS.length === 7, 'seven checks in the list');

// ---------- temperatures ----------
const t1 = sensors.decide({ nvidia: { available: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 34.4, fanPct: 0 }] }, kmt: [{ name: 'NVIDIA GeForce RTX 4070', tempC: 33.9 }], zones: [{ name: '\\_TZ.UAD0', tenthsK: 2900 }], pawnio: true });
check(t1.readings.length === 1 && t1.readings[0].source === "NVIDIA's nvidia-smi" && t1.readings[0].tempC === 34, 'NVIDIA from nvidia-smi, not twice');
check(!t1.readings.some((r) => r.kind === 'zone'), 'a zone below room temperature is not shown (not a real reading)');
check(t1.notReadable.some((n) => n.what === 'CPU temperature' && /PawnIO is already installed/.test(n.need)) && t1.notReadable.some((n) => /fan speeds/.test(n.what)), 'CPU temperature and board fans: not readable, with what is needed');
const t2 = sensors.decide({ nvidia: { available: false }, kmt: [{ name: 'AMD Radeon RX 7800 XT', tempC: 48.2, fanRpm: 900 }], zones: [{ name: '\\_TZ.CPUZ', tenthsK: 3231 }], pawnio: false });
check(t2.readings[0].name === 'AMD Radeon RX 7800 XT' && t2.readings[0].fanRpm === 900 && t2.readings[1].real === true, 'AMD through Windows; a plausible zone is a reading');
check(t2.notReadable.some((n) => /with the PawnIO driver/.test(n.need)), 'without PawnIO: says both are needed');
const t3 = sensors.decide({});
check(t3.readings.length === 0 && t3.notReadable[0].what === 'Graphics card temperature', 'no card reading: said plainly');

// ---------- routes ----------
check(routes.handles('/api/display') && routes.handles('/api/display/keep') && routes.handles('/api/temps') && routes.handles('/api/pc-check') && routes.handles('/api/pc-check/open-app') && !routes.handles('/api/displays') && !routes.handles('/api/pc'), 'routes claimed exactly');

if (fails.length) { console.log(`display-health: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('display-health (display modes, temperatures, PC check): all good');
