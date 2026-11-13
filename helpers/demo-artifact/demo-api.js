// DeviceHub Demo's stand-in for the local server (helpers/build-demo-artifact.mjs puts it in front of app.js).
// Every fetch to /api/ is answered here from pretend data; nothing leaves the page. Changes (settings, profiles,
// a monitor's brightness ...) are kept in this viewer's browser (localStorage), so they stay after a reload.
// An action that would reach Windows or the internet (install, update, sleep the screens, open a folder) answers
// that it is a demo. Unknown routes are recorded in window.__demoMisses (the build's checks read it).
(function () {
  'use strict';
  window.DEVICEHUB_DEMO = true;
  var DATA = window.DEVICEHUB_DEMO_DATA || {};
  var KEY = 'devicehub-demo-state-v1';
  var S = {};
  try { S = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { S = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private window: kept for this visit only */ } }
  // kept for the visit (sessionStorage), so a check that reloads the page still sees every one
  var misses = window.__demoMisses = [];
  try { misses.push.apply(misses, JSON.parse(sessionStorage.getItem('demo-misses') || '[]')); } catch (e) { /* none */ }
  function miss(m) { misses.push(m); try { sessionStorage.setItem('demo-misses', JSON.stringify(misses.slice(-300))); } catch (e) { /* none */ } }
  var now = function () { return new Date().toISOString(); };
  var ago = function (min) { return new Date(Date.now() - min * 60000).toISOString(); };
  var DEMO_LINE = 'This is a demo: nothing on a real PC is changed.';
  var started = Date.now();

  // ---------- pretend state (defaults; the viewer's changes on top) ----------
  function st(name, def) { if (S[name] === undefined) S[name] = typeof def === 'function' ? def() : def; return S[name]; }
  function settings() { return st('settings', { autoSwitch: true, defaultProfile: 'Desktop', setupSeen: true, oneDriveCopy: false, artStyle: 'blueprint' }); }
  function profiles() {
    return st('profiles', [
      { name: 'Desktop', color: '#8299a8', games: [], devices: { mouse: { pollingRate: 1000 } }, savedAt: ago(60 * 24 * 20) },
      { name: 'Gaming', color: '#c47b55', games: ['*games*'], devices: { mouse: { pollingRate: 4000 } }, savedAt: ago(60 * 24 * 20) },
      { name: 'Music', color: '#9d8ca6', games: [], devices: { keyboard: { brightness: 120 } }, savedAt: ago(60 * 24 * 9) },
    ]);
  }
  function activity() {
    return st('activity', [
      { at: ago(12), text: 'Gaming profile applied (Valorant started)', kind: 'good' },
      { at: ago(48), text: 'Desk monitor: brightness → 60', kind: 'good' },
      { at: ago(160), text: 'Weekly setup file saved', kind: 'info' },
      { at: ago(60 * 26), text: 'Keyboard: Backlight → 78%', kind: 'good' },
    ]);
  }
  function logLine(text, kind) { var a = activity(); a.unshift({ at: now(), text: text, kind: kind || 'good' }); if (a.length > 80) a.length = 80; save(); }

  // two pretend monitors in the shape helpers/monitors.js reads them (DDC/CI values with their maximum)
  function v(x, max) { return { value: x, max: max || 100 }; }
  function MONITORS() {
    return st('monitors', [
      { id: 'demo-mon-1', screen: '\\\\.\\DISPLAY1', model: 'DM27Q', name: 'Desk monitor', ddc: true, brightness: v(60), contrast: v(50), volume: null,
        red: v(50), green: v(50), blue: v(50), blackRed: null, blackGreen: null, blackBlue: null,
        colorPreset: { value: 5, max: 11, options: [{ value: 5, label: 'Standard' }, { value: 6, label: 'Cool' }, { value: 4, label: 'Warm' }, { value: 11, label: 'Custom' }] }, error: null, supports: [] },
      { id: 'demo-mon-2', screen: '\\\\.\\DISPLAY2', model: 'SM24F', name: 'Side monitor', ddc: true, brightness: v(45), contrast: v(55), volume: v(30),
        red: v(50), green: v(50), blue: v(50), blackRed: null, blackGreen: null, blackBlue: null,
        colorPreset: { value: 5, max: 11, options: [{ value: 5, label: 'Standard' }, { value: 4, label: 'Warm' }, { value: 11, label: 'Custom' }] }, error: null, supports: [] },
    ]);
  }

  // ---------- reads ----------
  var GET = {
    '/api/version': function () { return { version: 'demo', builtAt: DATA.builtAt || null, demo: true }; },
    '/api/agent-config': { agent: false, ready: false, demo: true },
    '/api/health': function () { return { uptimeS: Math.round((Date.now() - started) / 1000), serverMB: 48, heapMB: 22, helperMB: 14, crashes24h: 0, lastCrashAt: null, lastProblem: null, backups: { count: 6, mb: 0.1 }, demo: true }; },
    '/api/settings': function () { return settings(); },
    '/api/profiles': function () { return profiles(); },
    '/api/activity': function () { return activity(); },
    '/api/windows': { open: 1 },
    '/api/vendor-apps': { icue: false, pulsar: false },
    '/api/supported-devices': function () { return DATA.supported || { groups: [] }; },
    '/api/wallpapers/starters': function () { return { items: (DATA.walls || []).map(function (n) { return { name: n, type: 'image/jpeg', width: 2560, height: 1440, bytes: (DATA.wallBytes || {})[n] || 0, addedAt: DATA.builtAt }; }) }; },
    '/api/backups': function () { return st('backups', [
      { name: 'mouse-demo.json', size: 2210, at: ago(60 * 5) }, { name: 'keyboard-demo.json', size: 9021, at: ago(60 * 5) },
      { name: 'headset-demo.json', size: 579, at: ago(60 * 5) }, { name: 'monitor-demo.json', size: 724, at: ago(60 * 30) }]); },
    '/api/setups': [], '/api/cameras': [], '/api/processes': [], '/api/games': [],
    '/api/monitors': function () { return MONITORS(); },
    '/api/power': { saver: false, saving: false, hasBattery: false },
    '/api/startup': function () { return { enabled: st('startup', true) }; },
    '/api/game-mode': { games: [], status: null }, '/api/game-mode/installed': [],
    '/api/battery-estimate': {}, '/api/helper-calls': { uptimeS: 0, calls: {} },
    '/api/settings-sync': { on: false, demo: true }, '/api/auto-report': { on: false, configured: false, owner: false, active: false },
    '/api/self-update': { count: 0, demo: true }, '/api/publish-release': { owner: false }, '/api/driver-share': { choice: null, owner: true }, '/api/self-update/progress': {},
    '/api/updates': { apps: [] }, '/api/openrgb': { running: false, controllers: [] },
    '/api/board-lights': { pawnio: { installed: false, version: null }, setUp: false, task: false, copy: false, canSetUp: false, why: DEMO_LINE, partial: null, before: '', remove: '', busy: false },
    '/api/cpu-sensors': { pawnio: { installed: false, version: null }, setUp: false, task: false, copy: false, canSetUp: false, why: DEMO_LINE, partial: null, before: [], remove: [], busy: false },
    '/api/acer': { acer: false, setUp: false, task: false, copy: false, canSetUp: false, why: DEMO_LINE, partial: null, busy: false, readings: null, before: '', remove: '' },
    '/api/acer/read': { ok: true, readings: null },
    '/api/wifi-pause': { setUp: false, task: false, copy: false, canSetUp: false, why: DEMO_LINE, partial: null, show: false, inUse: false, scans: 'normal', paused: null, gaming: false, busy: false, before: '', remove: '' },
    '/api/background': { picture: false },
    // a battery that runs down over the day and charges overnight, every 10 minutes
    '/api/battery-history': function (q) {
      var days = Math.max(1, Math.min(30, Number(q.days) || 1)), out = [], seed = (q.id || 'x').length;
      for (var t = Date.now() - days * 864e5; t <= Date.now(); t += 6e5) {
        var h = (t / 36e5 + seed * 3) % 24, charging = h < 2, pct = charging ? Math.round(30 + h * 35) : Math.round(100 - (h - 2) * 3.2);
        out.push({ at: t, pct: Math.max(5, Math.min(100, pct)), charging: charging });
      }
      return out;
    },
    '/api/lights/diagnose': { board: null, openrgb: { state: 'unknown' }, found: [], seen: [], verdict: null, problems: [], lines: [] },
  };

  // ---------- changes and actions ----------
  // a POST the stand-in does not know: it says the demo did it, and nothing else happens
  var POST = {
    '/api/settings': function (b) { Object.assign(settings(), b || {}); save(); return settings(); },
    '/api/profiles': function (b) { if (Array.isArray(b)) { S.profiles = b; save(); } return profiles(); },
    '/api/monitors/set': function (b) {
      var m = MONITORS().find(function (x) { return x.id === b.id; });
      if (!m || !m[b.feature]) throw new Error('That monitor does not have it');
      var f = m[b.feature], val = Math.max(0, Math.min(f.max || 100, Math.round(Number(b.value))));
      f.value = val; save();
      if (!b.live) logLine(m.name + ': ' + (b.feature === 'volume' ? 'speaker volume' : b.feature) + ' → ' + val);
      return { ok: true, name: m.name, value: val };
    },
    '/api/startup': function (b) { S.startup = !!(b && (b.enabled ?? b.on)); save(); return { enabled: S.startup }; },
  };

  function answer(method, p, q, body) {
    if (method === 'GET') {
      if (Object.prototype.hasOwnProperty.call(GET, p)) { var g = GET[p]; return [200, typeof g === 'function' ? g(q) : g]; }
      miss('GET ' + p);
      return [503, { error: 'Not in the demo', demo: true }];
    }
    if (Object.prototype.hasOwnProperty.call(POST, p)) { try { return [200, POST[p](body || {}, q)]; } catch (e) { return [400, { error: e.message }]; } }
    miss(method + ' ' + p);
    return [200, { ok: true, demo: true, text: DEMO_LINE }];
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return realFetch(input, init); }
    var at = u.pathname.indexOf('/api/');
    var isApi = raw.indexOf('/api/') === 0 || (u.origin === location.origin && at >= 0);
    if (!isApi) {
      // the makers' product photos are not in the demo: say so without asking the network (Realistic shows as Blueprint)
      if (u.pathname.indexOf('/img/') >= 0 && /\.(png|jpe?g|webp)$/i.test(u.pathname)) return Promise.resolve(new Response(null, { status: 404 }));
      // a file of the page asked for from the root ('/pages/x.js'): it sits beside the page here
      if (typeof input === 'string' && input.charAt(0) === '/' && input.charAt(1) !== '/') return realFetch(input.slice(1), init);
      return realFetch(input, init);
    }
    var p = u.pathname.slice(at);
    var q = Object.fromEntries(u.searchParams.entries());
    var method = (init && init.method) || (input && input.method) || 'GET';
    var body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = init.body; }
    var r = answer(method.toUpperCase(), p, q, body);
    return new Promise(function (res) {
      setTimeout(function () { res(new Response(JSON.stringify(r[1]), { status: r[0], headers: { 'Content-Type': 'application/json' } })); }, 10 + Math.random() * 20);
    });
  };
  // nothing else may reach a server or a device from the demo
  window.EventSource = function () { throw new Error('No live stream in the demo'); };
  try { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.reject(new Error('demo')); }; } catch (e) { /* read-only in some browsers */ }
})();
