// The one native helper process (helpers/bin/DeviceHubHelper.exe, source in helpers/native/): every device and
// audio request goes through it on its own channel. Built here with Windows' C# compiler when missing or older
// than its sources (helpers/native/build.ps1), or, in an installed copy that carries a pre-built one, only when the
// sources no longer match the hash it was built from (build() below). If it stops, every waiting request answers GONE and the next one
// starts it again; the devices then reconnect the way they do after an unplug.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const bragiGuard = require('./bragi-guard');

const helperSources = require('./helper-sources');
const EXE = path.join(__dirname, 'bin', helperSources.EXE_NAME);
let CUE_DLL = null;
try { CUE_DLL = path.join(path.dirname(require.resolve('cue-sdk')), 'prebuilds', 'win32-x64', 'iCUESDK.x64_2019.dll'); } catch {}

// Pre-built helper (22 Oct 2026, docs/handoff/prebuilt-helper.md): an installed copy carries the exe and the hash of
// the sources it was built from (helpers/bin/helper-sources.sha256); while they match it is never rebuilt. A copy
// without that file (a development copy) rebuilds when a source is newer than the exe, as before (helpers/helper-sources.js).
// (dir and run are for tests/prebuilt-helper.mjs: another helpers folder, a stand-in for the compiler; returns the mode)
const runBuildPs1 = (dir) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'native', 'build.ps1')], { windowsHide: true, stdio: 'ignore', timeout: 120000 });
function build(dir = __dirname, run = runBuildPs1) {
  const d = helperSources.decide(dir);
  if (!d.build) return d.mode;
  try {
    run(dir);
  } catch (e) {
    // the sources changed but the build failed: the helper built from the earlier sources keeps running (start() logs
    // this one line, and tries the build again at most every 10 minutes)
    if (d.mode === 'changed' && fs.existsSync(path.join(dir, 'bin', helperSources.EXE_NAME))) {
      const f = new Error(`the sources changed but the helper could not be rebuilt (${String(e.message).split('\n')[0]}); running the shipped helper built from the earlier sources`);
      f.fallback = true;
      throw f;
    }
    throw e;
  }
  if (d.mode === 'changed') { try { helperSources.recordHash(dir); } catch {} }
  return d.mode;
}

let proc = null, buf = '', seq = 0;
// Hang watchdog (20 Oct 2026): a helper that crashes is started again on the next request, but a frozen one is not
// noticed by itself. Every minute a heartbeat on its own channel: no answer in 10 s = the whole helper is frozen.
// Three timeouts in a row on one channel (with the oldest over a minute) = that part is stuck. Either way the helper
// is stopped; the next request starts a fresh one (the tray icon restarts with it), and server.log says why.
const timeouts = new Map();          // chan -> { n, since }
let dogTimer = null, restarts = [];
const waiters = new Map();          // `${chan} ${seq}` -> resolve
const eventHandlers = new Map();    // chan -> fn(id, value)
const exitHandlers = new Set();
// problems for the automatic problem reports (helpers/auto-report.mjs, 22 Oct 2026): the build failed, the helper could
// not start, or it stopped by itself 3 times in an hour. Kept until server.js listens (the first build runs before it).
const problemHandlers = new Set(), problemsSoFar = [];
let exits = [];
function problem(code, text) {
  if (problemsSoFar.length < 10) problemsSoFar.push([code, text]);
  for (const fn of problemHandlers) { try { fn(code, text); } catch {} }
}
const onProblem = (fn) => { problemHandlers.add(fn); for (const [c, t] of problemsSoFar) { try { fn(c, t); } catch {} } };

// a build that failed (no C# compiler, a compile error, antivirus) is tried again at most every 10 minutes; until
// then an older helper, if there is one, runs, and without one every request answers GONE (20 Oct 2026: the throw
// went up through the first request and took the server down, five times, and then the launcher gave up)
let buildFailedAt = 0;
function start() {
  if (proc) return;
  if (Date.now() - buildFailedAt > 600000) {
    try { build(); buildFailedAt = 0; } catch (e) { buildFailedAt = Date.now(); console.log(e.fallback ? `[helper] ${e.message}` : `[helper] could not be built: ${String(e.message).split('\n')[0]}`); problem('helper-build', e.fallback ? e.message : `could not be built: ${String(e.message).split('\n')[0]}`); }
  }
  if (!fs.existsSync(EXE)) return;
  const p = spawn(EXE, CUE_DLL ? [CUE_DLL] : [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  proc = p; buf = '';
  // a write to a helper that has just stopped fails with EPIPE; unhandled, that took the whole server down (19 Oct
  // 2026, 20:26). The helper's exit is handled below (waiters answered "GONE", the next request starts a new one).
  p.stdin.on('error', () => {});
  // the helper could not start (not built: no C# compiler on this PC): DeviceHub keeps running without it
  p.on('error', (e) => { console.log(`[helper] could not start: ${e.message}`); problem('helper-start', `could not start: ${e.message}`); if (proc === p) { proc = null; for (const w of waiters.values()) w('GONE'); waiters.clear(); } });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    if (proc !== p) return;
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      const a = l.indexOf(' '), b = l.indexOf(' ', a + 1);
      if (a < 0 || b < 0) continue;
      const chan = l.slice(0, a), tag = l.slice(a + 1, b), rest = l.slice(b + 1);
      if (tag === 'EVT') { const [id, v] = rest.split(' '); eventHandlers.get(chan)?.(parseInt(id, 16), Number(v)); continue; }
      const w = waiters.get(`${chan} ${tag}`);
      if (w) { waiters.delete(`${chan} ${tag}`); w(rest); }
    }
  });
  p.on('exit', (code) => {
    if (proc !== p) return;
    proc = null;
    // stopped by itself (or by the watchdog), not by stop(): the third time in an hour is a problem report
    exits = exits.filter((t) => Date.now() - t < 3600000); exits.push(Date.now());
    if (exits.length === 3) problem('helper-restarts', `the helper stopped ${exits.length} times in the last hour (last exit code ${code})`);
    for (const w of waiters.values()) w('GONE');
    waiters.clear();
    for (const fn of exitHandlers) { try { fn(); } catch {} }
  });
  if (!dogTimer) { dogTimer = setInterval(heartbeat, 60000); dogTimer.unref?.(); }
}

function restartFrozen(why) {
  const p = proc;
  if (!p) return;
  restarts = restarts.filter((t) => Date.now() - t < 3600000);
  // a helper that keeps freezing is not restarted over and over: after 6 in an hour, only a note
  if (restarts.length >= 6) { console.log(`[watchdog] ${new Date().toISOString()} helper looks frozen (${why}); not restarted, 6 restarts in the last hour already`); timeouts.clear(); return; }
  restarts.push(Date.now());
  console.log(`[watchdog] ${new Date().toISOString()} helper restarted: ${why} (${restarts.length} in the last hour)`);
  timeouts.clear();
  try { p.kill(); } catch {}
}
async function heartbeat() {
  if (!proc) return;
  const r = await request('watchdog', 'PING', 10000);
  if (r === 'TIMEOUT') restartFrozen('no answer to the heartbeat for 10 s');
}

// requests by kind (the channel's first part: hid, hs80, audio, monitor ...), counted since start: Settings > Health and
// the daily check can see a part that keeps asking more and more (21 Oct 2026: CPU crept up over a night)
const calls = {};
let traceAt = 0;
const callCounts = () => ({ ...calls });

// One request on one channel; resolves with the reply text, or 'TIMEOUT'.
function request(chan, cmd, ms = 8000) {
  // a library driver's Corsair Bragi channel ("bragi" tag): the never list first, before the helper even starts
  // (helpers/bragi-guard.js, final audit 22 Oct 2026). DeviceHub's own HS80 channels have no tag and are not checked.
  if (bragiGuard.isBragi(chan)) { const no = bragiGuard.refusal(chan, cmd); if (no) { console.log(`[never] ${chan} ${String(cmd).split(' ')[0]}: ${no}`); return Promise.resolve(`ERR ${no}`); } }
  // a device channel by its device too (hid:3710 the mouse, hid:342D the keyboard), the rest by kind
  // (a HID request by its command byte too: REQ <echo> <ms> <command> ...)
  const c = chan.split(':'), w = String(cmd).split(' ');
  const kind = `${c[0] === 'hid' || c[0] === 'hs80' ? `${c[0]}:${c[1]}` : c[0]} ${w[0]}${c[0] === 'hid' && w[0] === 'REQ' ? ` ${w[3]}` : ''}`;
  calls[kind] = (calls[kind] || 0) + 1;
  // DEVICEHUB_TRACE=<kind>: where the first request of each burst of that kind comes from, in server.log (diagnosis)
  if (process.env.DEVICEHUB_TRACE === kind && Date.now() - (traceAt || 0) > 1000) console.log(`[trace] ${kind} ${new Error().stack.split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/\(?file:\/\/\/[^)]*\/DeviceHub\//, '')).join(' < ')}`);
  if (process.env.DEVICEHUB_TRACE === kind) traceAt = Date.now();
  start();
  const key = `${chan} ${++seq}`;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      waiters.delete(key); resolve('TIMEOUT');
      if (chan === 'watchdog') return;
      const x = timeouts.get(chan) || { n: 0, since: Date.now() - ms };
      x.n++; timeouts.set(chan, x);
      if (x.n >= 3 && Date.now() - x.since > 60000) restartFrozen(`the ${chan.split(':')[0]} channel stopped answering (${x.n} timeouts in a row)`);
    }, ms);
    waiters.set(key, (v) => { clearTimeout(t); timeouts.delete(chan); resolve(v); });
    // no helper (it could not be built or started): answer at once instead of throwing
    if (!proc || !proc.stdin.writable) { waiters.delete(key); clearTimeout(t); resolve('GONE'); return; }
    try { proc.stdin.write(`${key} ${cmd}\n`); } catch { waiters.delete(key); clearTimeout(t); resolve('GONE'); }
  });
}

const onEvent = (chan, fn) => { if (fn) eventHandlers.set(chan, fn); else eventHandlers.delete(chan); };
const onExit = (fn) => exitHandlers.add(fn);
function stop() { const p = proc; proc = null; if (p) p.stdin.end(); }

// is the helper running now (helpers/helper-reads.js asks it only then: a read never starts or builds it, so a test or
// script that reads the PC does not start a helper of its own)
const running = () => !!(proc && proc.stdin.writable);
module.exports = { request, onEvent, onExit, onProblem, stop, start, heartbeat, callCounts, running, buildHelper: build };
