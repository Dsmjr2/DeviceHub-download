// Page timers rest while the window is hidden (26 Oct 2026, idle CPU; public/core/visible-timer.js): a hidden window
// asks DeviceHub for nothing, a tick missed while hidden runs once when the window is shown again, and the app, the
// Equalizer card and the Overview's chips check the same. Offline: a pretend document and clock.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { everyVisible, isHidden } = await import(new URL('../public/core/visible-timer.js', import.meta.url));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// a pretend document whose visibility the test switches, and a timer the test fires by hand
function world() {
  const w = { t: 0, ticks: [], listeners: new Set(), doc: null };
  w.doc = { visibilityState: 'visible', addEventListener: (e, f) => e === 'visibilitychange' && w.listeners.add(f), removeEventListener: (e, f) => w.listeners.delete(f) };
  w.show = (on) => { w.doc.visibilityState = on ? 'visible' : 'hidden'; for (const f of w.listeners) f(); };
  w.setI = (f, ms) => { w.ticks.push({ f, ms, on: true }); return w.ticks.length - 1; };
  w.clearI = (i) => { w.ticks[i].on = false; };
  w.fire = (ms) => { w.t += ms; for (const x of w.ticks) if (x.on) x.f(); };
  return w;
}

{
  const w = world();
  let runs = 0;
  const stop = everyVisible(() => { runs++; }, 30000, { doc: w.doc, now: () => w.t, setI: w.setI, clearI: w.clearI });
  w.fire(30000);
  check(runs === 1, 'a shown window: the timer runs');
  w.show(false);
  w.fire(30000); w.fire(30000); w.fire(30000);
  check(runs === 1, `a hidden window: the timer asks for nothing (ran ${runs - 1} times while hidden)`);
  check(isHidden(w.doc), 'isHidden sees the hidden window');
  w.show(true);
  check(runs === 2, 'shown again after a missed tick: it runs once at once');
  w.show(false); w.show(true);
  check(runs === 2, 'hidden and shown again with nothing missed: no extra run');
  w.fire(30000);
  check(runs === 3, 'then it carries on as before');
  stop();
  w.fire(30000); w.show(false); w.fire(30000); w.show(true);
  check(runs === 3 && w.listeners.size === 0, 'stop() ends the timer and its visibility listener');
}
{
  // a hidden window shown again before the interval passed: nothing runs early
  const w = world();
  let runs = 0;
  everyVisible(() => { runs++; }, 30000, { doc: w.doc, now: () => w.t, setI: w.setI, clearI: w.clearI });
  w.show(false); w.t += 1000; w.ticks[0].f(); w.show(true);
  check(runs === 0, 'shown again sooner than the interval: it waits for its next tick');
  // a failing tick never stops the timer
  everyVisible(() => { throw new Error('x'); }, 1000, { doc: w.doc, now: () => w.t, setI: w.setI, clearI: w.clearI });
  everyVisible(() => Promise.reject(new Error('y')), 1000, { doc: w.doc, now: () => w.t, setI: w.setI, clearI: w.clearI });
  let ok = true; try { w.fire(1000); } catch { ok = false; }
  check(ok, 'a tick that throws or rejects does not break the timer');
}
check(isHidden({ hidden: true }) && !isHidden({ hidden: false }), 'isHidden falls back to document.hidden');

// the window's own timers use it, and a hidden window redraws nothing until it is shown
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const app = src('public/app.js');
// the backup shield, the battery saver and the version come on the live stream (27 Oct 2026, tests/events.mjs); the
// version is asked for only while the stream is not open, and then only while the window is shown
check(/onEvent\('backup', \(x\) => setLastBackup\(x\.at\)\)/.test(app) && !/fetch\('\/api\/backups'\)/.test(app), 'the backup shield is told on the stream, never read');
check(/everyVisible\(paintSetupNav, 5 \* 60000\)/.test(app), 'the Setup check\'s 5-minute look runs only while the window is shown');
check(/onEvent\('power', \(p\) => \{ paintSaving\(p\); seeBattery\(p\); \}\)/.test(app) && !/fetch\('\/api\/power'\)/.test(app), 'the battery saver is told on the stream, never read');
check(/everyVisible\(async \(\) => \{\s*if \(streamUp\(\)\) return reloadIfNew\(\);[^\n]*\n\s*try \{ sawVersion\(\(await \(await fetch\('\/api\/version'\)\)/.test(app), 'the version check runs only while the window is shown, and only while the stream is down');
check(/function reloadIfNew\(\) \{\s*if \(!newVersion \|\| reloading \|\| isHidden\(\) \|\| isBusy\(\)\) return;/.test(app), 'a hidden window reloads for new files only once it is shown');
check(/onChange\(\(id\) => \{ if \(isHidden\(\)\) \{ changedWhileHidden = true; return; \} pageChanged\(id\); \}\)/.test(app), 'a hidden window does not redraw on a device change');
check(/if \(!isHidden\(\) && changedWhileHidden\) \{ changedWhileHidden = false; pageChanged\('\*'\); \}/.test(app), 'it redraws once when shown again');
check(!/setInterval\(/.test(app.replace(/\/\/[^\n]*/g, '')), 'app.js has no plain setInterval left');
check(/if \(document\.hidden \|\| /.test(src('public/pages/eq-panel.js')), 'the Equalizer card reads nothing while hidden');
check(/if \(document\.hidden\) return;/.test(src('public/pages/overview.js')), 'the Overview\'s GPU chip reads nothing while hidden');
// the stream's reconnect check keeps running while hidden (device reconnects are never missed)
check(/if \(es\.readyState !== ESource\.CLOSED\) return;/.test(src('public/core/events.js')), 'the live stream is still replaced when it drops, hidden or not');

// a device going to sleep or waking re-reads only the Setup summary, not the slow reads; the GPU chip every 15 s
const setup = src('public/pages/setup.js');
check(/\} else if \(sig !== lastLive && Date\.now\(\) - bgAt > 30000\) \{[\s\S]{0,400}?loadSummary\(\);\s*\}/.test(setup), 'a device status change re-reads only the Setup summary');
check(/if \(summaryPending\) return;/.test(setup) && /\(st\.summary === undefined && !summaryPending\)/.test(setup), 'a slow first Setup summary does not start the seven reads again on every redraw');
check(/gpuTimer = setInterval\(tick, 15000\)/.test(src('public/pages/overview.js')), 'the Overview GPU chip reads every 15 s');
// the server side of idle: no window = no window branding call, a slower settings sync; auto-switch asks the helper
// that already runs for the program names (tasklist only as a fallback)
const server = src('server.js');
check(/if \(!quitting && openWindows > 0\) native\.request\('win', `BRAND/.test(server), 'the window branding call runs only while a window is open');
check(/settingsSync\.start\(eqapo, serverLog, \{ windowOpen: \(\) => openWindows > 0[,}]/.test(server) && /power\.every\(windowOpen\(\) \? 120000 : 300000\)/.test(src('helpers/settings-sync.js')), 'settings sync: every 2 minutes with a window open, every 5 with none');
check(/corsair\.handle\('procs', \{\}\)[^\n]*\.catch\(\(\) => tasklist\(\)\)/.test(server), 'auto-switch reads program names from the helper, tasklist only when it cannot answer');
check(/case "procs":/.test(src('helpers/native/helper.cs')) && /action === 'procs'/.test(src('helpers/corsair.js')), 'the helper answers procs (names only)');

if (fails.length) { console.log(`visible-timer: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('visible-timer: a hidden window asks for nothing and catches up once it is shown');
