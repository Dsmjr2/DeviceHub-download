// Close the window when it is not in use (26 Oct 2026; public/core/idle-close.js, helpers/window-close.js, server.js
// /api/window/idle-close). Offline: a pretend document, clock and process list; nothing is closed and no process is
// listed or stopped for real.
//   - the timer: 5 minutes hidden AND without focus in a row; shown again or focused starts the count again
//   - never while something runs or waits (a device write, a dropdown, a question, a loading bar, Keep this?, a
//     learning session, unsaved text), never with the switch off
//   - the process selection: only the browser whose --user-data-dir is THIS copy's window-profile, and its children;
//     never the person's own Chrome or Edge, another folder's window-profile, or a page in another browser
//   - the server's guards: no tray icon, switched off, an update / publish / Find my lights / learning / install
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ic = await import(new URL('../public/core/idle-close.js', import.meta.url));
const wc = require('../helpers/window-close.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const MIN = 60000;

// ---------- the decision ----------
{
  const { decide, IDLE_MS } = ic;
  check(IDLE_MS === 5 * MIN, 'the wait is 5 minutes');
  check(!decide({ hiddenSince: null, now: 10 * MIN, focused: false }).close, 'a shown window is never closed');
  check(!decide({ hiddenSince: 0, now: 4.9 * MIN, focused: false }).close, 'hidden 4.9 minutes: not yet');
  check(decide({ hiddenSince: 0, now: 5 * MIN, focused: false }).close, 'hidden 5 minutes without focus: close');
  check(!decide({ hiddenSince: 0, now: 9 * MIN, focused: true }).close, 'hidden but focused: kept');
  check(!decide({ hiddenSince: 0, now: 9 * MIN, focused: false, enabled: false }).close, 'switched off: kept');
  const held = decide({ hiddenSince: 0, now: 9 * MIN, focused: false, reasons: ['a dropdown list is open'] });
  check(!held.close && /dropdown/.test(held.why), 'anything holding it open: kept, and the reason said');
}

// ---------- what holds it open ----------
{
  const { blockers } = ic;
  const doc = (sels) => ({ querySelector: (s) => (s.split(',').some((x) => sels.includes(x.trim())) ? {} : null) });
  check(blockers({}, doc([])).length === 0, 'nothing running: nothing holds it');
  const cases = [
    [{ busy: true }, [], 'a device write'], [{ dropdown: true }, [], 'a dropdown list'], [{ learn: true }, [], 'a learning session'],
    [{ displayKeep: true }, [], 'a display Keep this? countdown (state)'], [{ unsaved: true }, [], 'unsaved text'],
    [{}, ['.modal-back'], 'a confirm or question box'], [{}, ['dialog[open]'], 'an open dialog'], [{}, ['.palette-back'], 'the search box'],
    [{}, ['.loadbar'], 'a loading bar (update, publish, sync, install, Learn it for me)'], [{}, ['.disp-keep'], 'a display Keep this? line'],
    [{}, ['.toast.busy'], 'a busy toast (Updating DeviceHub)'],
  ];
  for (const [st, sels, what] of cases) check(blockers(st, doc(sels)).length > 0, `never closed while: ${what}`);
  check(blockers({}, { querySelector: () => { throw new Error('x'); } }).length === 0, 'a selector that throws does not break it');
}

// ---------- unsaved text ----------
{
  const listeners = {};
  const doc = { addEventListener: (t, f) => { listeners[t] = f; } };
  const unsaved = ic.unsavedWatcher(doc);
  const box = { tagName: 'INPUT', getAttribute: () => 'text', value: 'Old name', isConnected: true };
  const slider = { tagName: 'INPUT', getAttribute: () => 'range', value: '5', isConnected: true };
  listeners.focusin({ target: box }); listeners.focusin({ target: slider });
  check(!unsaved(), 'a text box only focused: not unsaved');
  slider.value = '9'; listeners.input({ target: slider });
  check(!unsaved(), 'a slider moved (applies at once): not unsaved');
  box.value = 'New name'; listeners.input({ target: box });
  check(unsaved(), 'text typed into a box still on the page: unsaved');
  box.value = 'Old name';
  check(!unsaved(), 'typed back to what it was: not unsaved');
  box.value = 'New name'; box.isConnected = false;
  check(!unsaved(), 'the box gone (saved, page redrawn): not unsaved');
}

// ---------- the timer ----------
function world({ app = true } = {}) {
  const w = { t: 0, vis: 'visible', focus: true, ticks: [], doc: null, win: null, asked: [], closed: 0, answer: { closing: true } };
  const ls = { doc: {}, win: {} };
  w.doc = { get visibilityState() { return w.vis; }, hasFocus: () => w.focus, querySelector: () => null,
    addEventListener: (t, f) => { ls.doc[t] = f; }, removeEventListener: () => {} };
  w.win = { matchMedia: () => ({ matches: app }), close: () => { w.closed++; }, addEventListener: (t, f) => { ls.win[t] = f; }, removeEventListener: () => {} };
  w.hide = () => { w.vis = 'hidden'; w.focus = false; ls.doc.visibilitychange?.(); };
  w.show = () => { w.vis = 'visible'; w.focus = true; ls.doc.visibilitychange?.(); };
  w.focusIn = () => { w.focus = true; ls.win.focus?.(); };
  w.state = {};
  w.ctl = ic.startIdleClose({ state: () => w.state, page: () => '#/monitors', doc: w.doc, win: w.win, now: () => w.t,
    setI: (f) => { w.ticks.push(f); return 1; }, clearI: () => {}, api: async (b) => { w.asked.push(b); return w.answer; } });
  w.at = async (ms) => { w.t = ms; return w.ctl.tick(); };
  return w;
}
{
  const w = world();
  await w.at(10 * MIN);
  check(w.asked.length === 0, 'shown for 10 minutes: never asks');
  w.hide(); const t0 = w.t;
  await w.at(t0 + 4 * MIN);
  check(w.asked.length === 0, 'hidden 4 minutes: does not ask yet');
  w.show(); w.hide();
  await w.at(t0 + 6 * MIN);
  check(w.asked.length === 0, 'shown in between: the 5 minutes start again');
  await w.at(t0 + 4 * MIN + 5 * MIN + 1);
  check(w.asked.length === 1 && w.asked[0].page === '#/monitors' && w.asked[0].appWindow === true, 'hidden 5 minutes in a row: asks once, with the page it is on');
  await w.at(t0 + 20 * MIN);
  check(w.asked.length === 1, 'the server is closing it: never asks again');
}
{
  const w = world();
  w.hide(); w.state = { busy: true };
  await w.at(6 * MIN);
  check(w.asked.length === 0, 'a device write running at 5 minutes: does not ask');
  w.state = {};
  await w.at(6.5 * MIN);
  check(w.asked.length === 1, 'the write done, still hidden: asks on the next check');
}
{
  const w = world();
  w.hide(); w.focusIn();
  await w.at(6 * MIN);
  check(w.asked.length === 0, 'focused while hidden: does not ask');
}
{
  // the low-memory window: the server says it is not DeviceHub's own window; the app window closes only itself
  const w = world({ app: true }); w.answer = { closing: false, self: true };
  w.hide(); await w.at(6 * MIN);
  check(w.closed === 1, 'the low-memory app window closes only itself (window.close)');
  const t = world({ app: false }); t.answer = { closing: false, self: true };
  t.hide(); await t.at(6 * MIN);
  check(t.closed === 0, 'a DeviceHub tab in a normal browser window is never closed');
  const off = world(); off.answer = { closing: false, retry: false, why: 'switched off' };
  off.hide(); await off.at(6 * MIN); await off.at(7 * MIN);
  check(off.asked.length === 1 && off.closed === 0, 'switched off or no tray: asks once, closes nothing, then waits until shown again');
  off.show(); off.hide(); await off.at(13 * MIN);
  check(off.asked.length === 2, 'shown and hidden again: asks again after 5 more minutes');
  const busy = world(); busy.answer = { closing: false, why: 'updating' };
  busy.hide(); await busy.at(6 * MIN); await busy.at(6.5 * MIN);
  check(busy.asked.length === 2 && busy.closed === 0, 'the server busy (an update): kept, asked again on the next check');
}

// ---------- the process selection ----------
const ROOTDIR = 'C:\\Users\\me\\DeviceHub';
const CH = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"';
const procs = [
  // DeviceHub's own window (quoted dir), its children (bare dir, or no dir at all)
  { pid: 100, ppid: 4, name: 'chrome.exe', cmd: `${CH} --user-data-dir="${ROOTDIR}\\window-profile" --no-first-run --app=http://localhost:5577/` },
  { pid: 101, ppid: 100, name: 'chrome.exe', cmd: `${CH} --type=renderer --user-data-dir=${ROOTDIR}\\window-profile` },
  { pid: 102, ppid: 100, name: 'chrome.exe', cmd: `${CH} --type=utility --utility-sub-type=network.mojom.NetworkService` },
  { pid: 103, ppid: 102, name: 'chrome.exe', cmd: `${CH} --type=gpu-process` },
  // the person's own Chrome, with an app window of DeviceHub inside it (the low-memory window)
  { pid: 200, ppid: 4, name: 'chrome.exe', cmd: `${CH} --app=http://localhost:5577/ --start-maximized` },
  { pid: 201, ppid: 200, name: 'chrome.exe', cmd: `${CH} --type=utility --utility-sub-type=network.mojom.NetworkService` },
  // their Chrome with a named profile that merely contains "window-profile" in a longer path, and another copy's window
  { pid: 300, ppid: 4, name: 'chrome.exe', cmd: `${CH} --user-data-dir="C:\\Other\\window-profile-old"` },
  { pid: 400, ppid: 4, name: 'msedge.exe', cmd: `"msedge.exe" --user-data-dir="C:\\Users\\me\\Downloads\\DeviceHub\\window-profile"` },
  // not a browser, under DeviceHub's window by parent id (a crash reporter); and a non-browser naming the folder
  { pid: 500, ppid: 4, name: 'node.exe', cmd: `node.exe --user-data-dir="${ROOTDIR}\\window-profile"` },
];
{
  const { ownWindow, userDataDir, parseWmicCsv, connectionOwner, cleanPage } = wc._test;
  check(userDataDir('x --user-data-dir="C:\\a b\\c" --y') === 'C:\\a b\\c' && userDataDir('x --user-data-dir=C:\\a\\c --y') === 'C:\\a\\c' && userDataDir('x') === null, 'reads --user-data-dir quoted and bare');
  const own = ownWindow(procs, ROOTDIR);
  check(own && own.main.pid === 100, 'the main process: the window-profile browser without --type');
  check(own && [...own.pids].sort().join() === '100,101,102,103', `its tree only: 100-103 (got ${own && [...own.pids].join()})`);
  check(own && ![200, 201, 300, 400, 500].some((p) => own.pids.has(p)), 'never the person\'s Chrome, another window-profile, another copy\'s, or a non-browser');
  check(ownWindow(procs, ROOTDIR.toLowerCase().replace(/\\/g, '/') + '/')?.main.pid === 100, 'the folder matched whatever its case and slashes');
  check(ownWindow(procs.filter((p) => p.pid !== 100), ROOTDIR) === null, 'no main window-profile browser: nothing to close');
  check(ownWindow(procs.filter((p) => p.pid >= 200), ROOTDIR) === null, 'only the person\'s own browsers running: nothing to close');
  // a parent loop never hangs the walk
  check(ownWindow([...procs, { pid: 600, ppid: 601, name: 'chrome.exe', cmd: '' }, { pid: 601, ppid: 600, name: 'chrome.exe', cmd: '' }], ROOTDIR).pids.size === 4, 'a parent loop elsewhere does not hang or join');

  const csv = '\r\nNode,CommandLine,Name,ParentProcessId,ProcessId\r\nPC,"chrome.exe" --user-data-dir="C:\\x,y\\window-profile" --a,chrome.exe,4,100\r\nPC,,chrome.exe,100,101\r\n';
  const parsed = parseWmicCsv(csv);
  check(parsed.length === 2 && parsed[0].pid === 100 && parsed[0].ppid === 4 && /x,y/.test(parsed[0].cmd) && parsed[1].ppid === 100, 'wmic CSV: a comma inside the command line is kept');

  const ns = [
    '  TCP    127.0.0.1:5577         0.0.0.0:0              LISTENING       900',
    '  TCP    127.0.0.1:5577         127.0.0.1:51001        ESTABLISHED     900',
    '  TCP    127.0.0.1:51001        127.0.0.1:5577         ESTABLISHED     102',
    '  TCP    127.0.0.1:51002        127.0.0.1:5577         ESTABLISHED     201',
    '  TCP    192.168.1.5:51003      1.2.3.4:5577           ESTABLISHED     666',
  ].join('\r\n');
  check(connectionOwner(ns, 51001, 5577) === 102, 'netstat: the client end of the asking connection (not the server end)');
  check(connectionOwner(ns, 51002, 5577) === 201 && connectionOwner(ns, 51003, 5577) === null && connectionOwner(ns, 59999, 5577) === null, 'netstat: another browser\'s connection is its own; a remote or unknown one is nobody');
  check(cleanPage('#/monitors') === '#/monitors' && cleanPage('#/my:device-1') && cleanPage('javascript:alert(1)') === null && cleanPage('#/a b') === null && cleanPage(5) === null, 'only a DeviceHub page is kept to come back to');
}

// ---------- closing: the asking page decides which window ----------
{
  const real = { ...wc.deps };
  let list = procs.map((p) => ({ ...p }));
  const kills = [];
  let net = '';
  Object.assign(wc.deps, { procs: async () => list, netstat: async () => net, kill: async (pid, force) => { kills.push({ pid, force }); if (!force && closeOk) list = list.filter((p) => ![100, 101, 102, 103].includes(p.pid)); }, wait: async () => {} });
  let closeOk = true;
  try {
    // 1. a page inside DeviceHub's own window: its browser closes normally, and the page is kept
    net = '  TCP    127.0.0.1:51001        127.0.0.1:5577         ESTABLISHED     102';
    let r = await wc.closeAsking({ clientPort: 51001, serverPort: 5577, root: ROOTDIR, page: '#/lighting', appWindow: true });
    await wc._test.lastClose();
    check(r.closing === true && r.pid === 100, 'DeviceHub\'s own window asking: it closes (pid 100)');
    check(kills.length === 1 && kills[0].pid === 100 && kills[0].force === false, `a normal close of that browser only, no /F when it goes (${JSON.stringify(kills)})`);
    check(wc.takeResume() === '#/lighting' && wc.takeResume() === null, 'the next window opens on the page it was on, once');

    // 2. it does not go: forced, still only pid 100
    list = procs.map((p) => ({ ...p })); kills.length = 0; closeOk = false;
    r = await wc.closeAsking({ clientPort: 51001, serverPort: 5577, root: ROOTDIR, page: '#/overview', appWindow: true });
    await wc._test.lastClose();
    check(kills.length === 2 && kills.every((k) => k.pid === 100) && kills[1].force === true, `still there after 8 s: forced, its tree only (${JSON.stringify(kills)})`);
    // 2b. PID reused by something else before the force: never forced
    kills.length = 0;
    let n = 0;
    wc.deps.procs = async () => (++n > 1 ? procs.filter((p) => p.pid >= 200) : procs);
    r = await wc.closeAsking({ clientPort: 51001, serverPort: 5577, root: ROOTDIR, page: '#/overview', appWindow: true });
    await wc._test.lastClose();
    check(kills.length === 1 && kills[0].force === false, 'the browser gone after the normal close: nothing forced');
    wc.deps.procs = async () => list;
    list = procs.map((p) => ({ ...p }));

    // 3. a page in the person's own Chrome (the low-memory window) while DeviceHub's own window is also open
    kills.length = 0; closeOk = true;
    net = '  TCP    127.0.0.1:51002        127.0.0.1:5577         ESTABLISHED     201';
    r = await wc.closeAsking({ clientPort: 51002, serverPort: 5577, root: ROOTDIR, page: '#/monitors', appWindow: true });
    check(!r.closing && r.self === true && kills.length === 0, 'a page in the person\'s Chrome: nothing is killed; it may close only itself');
    // 4. no DeviceHub window of its own at all
    list = procs.filter((p) => p.pid >= 200);
    r = await wc.closeAsking({ clientPort: 51002, serverPort: 5577, root: ROOTDIR, page: '#/monitors', appWindow: false });
    check(!r.closing && r.self && kills.length === 0, 'only the person\'s browsers running: nothing is killed');
    // 5. the asking connection not found: nothing is closed
    list = procs.map((p) => ({ ...p })); net = '';
    r = await wc.closeAsking({ clientPort: 51009, serverPort: 5577, root: ROOTDIR, page: '#/x' });
    check(!r.closing && !r.self && kills.length === 0, 'cannot tell which window asked: nothing is closed');
  } finally { Object.assign(wc.deps, real); }
}

// ---------- the server's guards, the app, Settings ----------
{
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const server = src('server.js');
  const block = server.slice(server.indexOf("'/api/window/idle-close'"), server.indexOf("'/api/window/idle-close'") + 2200);
  check(/closeWhenMinimized === false[^\n]*retry: false/.test(block), 'server: the switch off closes nothing');
  check(/if \(!tray \|\| quitting\)[^\n]*retry: false/.test(block), 'server: no tray icon (or quitting): nothing is closed');
  for (const w of ['publishing', 'updating', 'Find my lights', 'learning', 'installing']) check(block.includes(`'${w}'`), `server: never while ${w}`);
  check(block.indexOf('held.length') < block.indexOf('closeAsking'), 'server: the checks come before the close');
  check(/req\.method === 'POST'/.test(server.slice(server.indexOf("'/api/window/idle-close'") - 10, server.indexOf("'/api/window/idle-close'") + 60)), 'server: closing is a POST (a web page cannot trigger it with a GET)');
  check(/closeWhenMinimized: 'boolean'/.test(server), 'server: the setting is saved');
  const app = src('public/app.js');
  check(/startIdleClose\(\{ state: \(\) => \(\{ busy: isBusy\(\), dropdown: dropdownOpen\(\), learn: learnBusy\(\), displayKeep: displayWaiting\(\), unsaved: unsaved\(\) \}\) \}\)/.test(app), 'app: the timer knows device writes, dropdowns, learning, Keep this? and unsaved text');
  check(/\/api\/window\/resume/.test(app) && app.indexOf('/api/window/resume') < app.indexOf('await firstStart('), 'app: a reopened window goes back to its page before the first draw');
  const set = src('public/pages/settings.js');
  const m = /row\('Close window when minimized', '([^']+)'/.exec(set);
  check(m && m[1].split(/\s+/).length <= 6, `Settings: the switch, with a description of 6 words at most (${m && m[1]})`);
  check(/closeWhenMinimized !== false/.test(set), 'Settings: on by default');
  // the tray icon reopens the window (helpers/native/tray.cs: Open DeviceHub and a double-click run DeviceHub.vbs)
  const tray = src('helpers/native/tray.cs');
  check(/DoubleClick \+= \(a, b\) => OpenApp\(\)/.test(tray) && /"Open DeviceHub"[^\n]*OpenApp\(\)/.test(tray) && /DeviceHub\.vbs/.test(tray), 'the tray icon opens DeviceHub again (double-click, Open DeviceHub)');
}

// ---------- the PC going to sleep (29 Oct 2026, Shawn: close it so it uses nothing while the PC sleeps) ----------
{
  const { decide, startIdleClose } = ic;
  check(decide({ hiddenSince: null, now: 0, focused: true, sleep: 'sleep' }).close, 'going to sleep: closes at once, shown or not');
  check(!decide({ hiddenSince: null, now: 0, focused: false, sleep: 'sleep', enabled: false }).close, 'going to sleep, switched off: kept');
  check(!decide({ hiddenSince: null, now: 0, focused: false, sleep: 'sleep', reasons: ['a device change is being written'] }).close, 'going to sleep while a write runs: kept');
  check(decide({ hiddenSince: null, now: 0, focused: false, sleep: 'woke' }).close && !decide({ hiddenSince: null, now: 0, focused: true, sleep: 'woke' }).close, 'on waking: closes unless it is in use');
  const asked = [];
  const doc = { visibilityState: 'visible', hasFocus: () => true, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
  const t = startIdleClose({ page: () => '#/mouse', doc, win: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) }, setI: () => 0, clearI() {}, api: async (b) => { asked.push(b); return { closing: true }; } });
  const r1 = await t.tick();
  const r2 = await t.tick('sleep');
  check(!r1.close && r2.close && asked.length === 1 && asked[0].sleep === 'sleep' && asked[0].hiddenFor === 0, 'the sleep message asks the server to close it, the timer alone does not');
  const agent = fs.readFileSync(path.join(ROOT, 'helpers/agent.mjs'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  check(/send\('sleep', \{ at: Date\.now\(\) \}\)/.test(agent) && /send\('woke', \{ at: wokeAt \}\)/.test(agent), 'the agent passes Windows\' sleep and wake on to the window');
  check(/onEvent\('sleep', \(\) => \{ idle\.tick\('sleep'\); \}\)/.test(app) && /onEvent\('woke'/.test(app), 'the window acts on them');
  // DeviceHub's own Sleep button turns only the screens off (Windows says nothing): it closes the window itself
  check(decide({ hiddenSince: null, now: 0, focused: true, sleep: 'screens' }).close, 'screens put to sleep: closes, though still shown and focused');
  check(!decide({ hiddenSince: null, now: 0, focused: true, sleep: 'screens', reasons: ['a form has unsaved text'] }).close, 'screens put to sleep with unsaved text: kept');
  let later = null;
  ic.closeAfterScreensOff((fn, ms) => { later = { fn, ms }; });
  check(later?.ms === ic.SCREENS_CLOSE_MS && ic.SCREENS_CLOSE_MS > 2000, 'it waits until the screens are off (they go off 2 s after the click)');
  const t2 = startIdleClose({ page: () => '#/monitors', doc, win: { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) }, setI: () => 0, clearI() {}, api: async (b) => { asked.push(b); return { closing: true }; } });
  await later.fn(); await new Promise((r) => setTimeout(r, 0));
  check(asked.at(-1)?.sleep === 'screens' && t2, 'then asks the server to close the window');
  const mon = fs.readFileSync(path.join(ROOT, 'public/pages/monitors.js'), 'utf8'), cmd = fs.readFileSync(path.join(ROOT, 'public/core/commands.js'), 'utf8');
  check(/else closeAfterScreensOff\(\)/.test(mon) && /\/api\/monitors\/sleep', \{\}\); closeAfterScreensOff\(\)/.test(cmd), 'the Monitors Sleep button and the search\'s Sleep monitors both close it');
}

if (fails.length) { console.log(`idle-close: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('idle-close: all checks passed');
