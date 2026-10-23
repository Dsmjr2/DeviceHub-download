// Learn it for me (23 Oct 2026, Shawn: "connect and wait for the app to learn the device with minimal clicking").
// One click runs the whole learning session here, on the server, while the Learn a device page only shows how far it
// is: the device picked, its maker's app and settings found, the app opened when it is installed and closed, Windows'
// one prompt to listen, then each setting in turn: changed in the maker's app by DeviceHub (app-ui) when the app lets
// it, else the person is told the one change to make and DeviceHub notices it in what it hears (no Done to press);
// then the driver saved. It ends with one button, "Turn on settings" (closing the maker's app first when it is open):
// the person's go-ahead for the first write, as every learned driver needs (CLAUDE.md, safety round 2).
//
// It uses the learning wizard's own steps (helpers/learn-wizard.mjs act), so every rule there holds: read-only toward
// the device while learning, nothing sent that was not heard, firmware/reset/pairing never touched, refused vendors
// refused. Readings (battery, charging) are left for the wizard's own steps: they need the person to say what the app
// shows.
//   POST /api/learn/auto { vid, pid }      start (one at a time)
//   GET  /api/learn/auto                   where it is: { phase, device, steps, items, ask, result, error }
//   POST /api/learn/auto/done              the person says the change is made (when it was not noticed)
//   POST /api/learn/auto/skip              skip the setting being learned
//   POST /api/learn/auto/stop              stop (the setting being changed is put back by the person, as asked)
//   POST /api/learn/auto/finish            close the maker's app (when open) and turn on the saved driver's settings
import { execFile } from 'node:child_process';
import * as lw from './learn-wizard.mjs';
import { openMaker as openMakerApp, findMaker, PRESETS } from './learn-apps.mjs';

export const options = {
  deps: {
    openMaker: (vid) => openMakerApp(vid),
    findMaker: (vid) => findMaker(vid),
    // a web configurator (Keychron Launcher): its official page (learn-apps MAKERS), opened in the default browser
    openPage: (url) => { if (/^https:\/\/[a-z0-9.-]+\//i.test(url)) execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {}); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    // the server's own routes, for the end: close the app (diagnose's close-app) and turn on settings
    post: async (path, body) => {
      const port = Number(process.env.DEVICEHUB_PORT) || 5577;
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || r.statusText);
      return j;
    },
    get: async (path) => {
      const port = Number(process.env.DEVICEHUB_PORT) || 5577;
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });
      return r.json();
    },
  },
};
// how long things may take: the app to open, the listener to start, the person to make one change
export const LIMITS = { appMs: 60000, appSettleMs: 4000, listenMs: 90000, changeMs: 120000, firstMs: 30000, quietMs: 1500, baselineMs: 1200, pollMs: 400, items: 6 };
// the range a number gets when the maker's app did not say (its slider): wide enough for the usual devices; a value the
// device cannot take fails its read-back and is put back, as every write
export const RANGES = { DPI: { min: 100, max: 16000 }, Debounce: { min: 0, max: 20 }, Brightness: { min: 0, max: 100 }, Sidetone: { min: 0, max: 100 }, 'Auto-off': { min: 0, max: 60 } };

let run = null;   // the one session: { phase, device, steps, items, ask, result, error, stop, done, skip }
export const state = () => (run ? view(run) : { phase: 'idle' });
export function reset() { run = null; }

function view(r) {
  return { phase: r.phase, device: r.device, app: r.app, steps: r.steps, items: r.items.map(({ it, ...x }) => x), ask: r.ask, result: r.result, error: r.error };
}
const say = (r, text, ok = true) => { r.steps.push({ text, ok }); };

// ---------------------------------------------------------------- noticing a change the person made
// The person changes the setting in the maker's app; DeviceHub notices it in what the app sends the device. Apps keep
// sending things the whole time (battery polls, lighting frames), so the first moments are the baseline: for each
// command (report and first two bytes) the bytes seen and which positions move by themselves. A message is new when its
// command was not in the baseline, or it differs from every baseline message of its command at a position that did not
// move by itself. -> the new messages
const cmdOf = (m) => `${m.type}:${m.reportId}:${m.data[0]}:${m.data[1]}`;
export function baselineOf(msgs) {
  const by = new Map();
  for (const m of msgs) {
    if (m.dir !== 'out') continue;
    const k = cmdOf(m);
    if (!by.has(k)) by.set(k, { seen: [], noisy: new Set() });
    const b = by.get(k);
    for (const s of b.seen) m.data.forEach((x, i) => { if (s[i] !== x) b.noisy.add(i); });
    b.seen.push(m.data);
  }
  return by;
}
export function novel(base, msgs) {
  return msgs.filter((m) => {
    if (m.dir !== 'out') return false;
    const b = base.get(cmdOf(m));
    if (!b) return true;
    return b.seen.every((s) => m.data.some((x, i) => s[i] !== x && !b.noisy.has(i)));
  });
}

// ---------------------------------------------------------------- the session
export async function start({ vid, pid, kind = null } = {}) {
  if (run && !['done', 'stopped', 'failed'].includes(run.phase)) return { ok: false, error: 'DeviceHub is already learning a device. Stop it first, or wait until it is done.' };
  if (lw.current()?.listening) return { ok: false, error: 'A learning session is open on Learn a device. Stop it first (Stop learning), then try again.' };
  run = { phase: 'start', kind: ['mouse', 'keyboard'].includes(kind) ? kind : null, device: { vid: String(vid || '').toUpperCase(), pid: String(pid || '').toUpperCase(), name: null }, app: null, steps: [], items: [], ask: null, result: null, error: null, stop: false, done: false, skip: false };
  const r = run;
  session(r).catch((e) => { if (run === r) { r.phase = 'failed'; r.error = { text: `Something went wrong: ${e.message}`, next: 'Press Learn it for me again; Get help (top right) tells Shawn if it happens again.' }; } });
  return { ok: true, ...view(r) };
}

const fail = (r, text, next) => { r.phase = 'failed'; r.ask = null; r.error = { text, next }; return false; };
const stopped = (r) => { if (r.stop) { r.phase = 'stopped'; r.ask = null; return true; } return false; };

async function session(r) {
  const d = options.deps;
  // 1. the device
  r.phase = 'device';
  let devices;
  try { devices = await lw.refreshDevices(); } catch (e) { return fail(r, e.message, 'Press Learn it for me again.'); }
  const dev = devices.find((x) => x.vid === r.device.vid && x.pid === r.device.pid);
  if (!dev) return fail(r, `USB ${r.device.vid}:${r.device.pid} is not plugged in, or DeviceHub runs it already.`, 'Plug it in (a port on the PC itself, not a hub), then press Learn it for me again.');
  r.device.name = dev.title || dev.name;
  if (dev.refused) return fail(r, dev.refused, 'Request support (on the device\'s row) sends Shawn its details instead.');
  // kind: the answer to "Is this a mouse or a keyboard?" for a device whose USB interfaces say both (asked on its row)
  const b = await lw.act('begin', { vid: dev.vid, pid: dev.pid, ...(r.kind ? { kind: r.kind } : {}) });
  if (b.ok === false) return fail(r, b.error || [].concat(b.why || []).join(' '), 'Press Learn it for me again.');
  say(r, `Found the ${dev.title || dev.name}.`);
  if (stopped(r)) return quit(r);

  // 2. its maker's app and settings
  r.phase = 'plan';
  const plan = await lw.act('plan', {});
  if (plan.ok === false) return fail(r, plan.error || 'Its settings could not be listed.', 'Press Learn it for me again.');
  if (plan.ask) return fail(r, plan.ask.line, 'Go Back, answer it on the device row, then press Learn it for me again.');
  let m = plan.maker || {};
  r.app = m.known ? { name: m.name, page: m.page || null, web: !!m.web } : null;
  const items = (plan.items || []).filter((i) => i.kind !== 'reading' && i.ticked).slice(0, LIMITS.items);
  if (!items.length) return fail(r, 'DeviceHub found no settings to learn for it.', 'Use Choose the settings myself (below) to name one.');
  r.items = items.map((it) => ({ label: it.label, status: 'waiting', why: null, it }));
  say(r, `It will learn ${items.map((i) => i.label).join(', ')}${plan.from === 'files' ? ` (the settings ${m.name} keeps for it)` : ''}.`);

  // 3. the maker's app: open it when it is installed and closed
  r.phase = 'app';
  if (m.known && !m.web && !m.running && m.installed) {
    const o = await d.openMaker(dev.vid).catch((e) => ({ opened: false, why: e.message }));
    if (o.opened) {
      say(r, `Opening ${m.name}…`);
      const until = d.now() + LIMITS.appMs;
      while (d.now() < until && !r.stop) {
        await d.sleep(1000);
        const now = await d.findMaker(dev.vid).catch(() => null);
        if (now?.running) { m = { ...m, ...now }; break; }
      }
      if (m.running) { await d.sleep(LIMITS.appSettleMs); lw.current().plan.maker = m; say(r, `${m.name} is open.`); }
      else say(r, `${m.name} did not open by itself; DeviceHub asks you to change each setting there instead.`, false);
    }
  }
  if (stopped(r)) return quit(r);
  // a web configurator: USBPcap hears the browser as it hears an app, so it is opened and the person changes each setting
  if (m.web && m.page) {
    d.openPage(m.page);
    say(r, `Opening ${m.name} in your browser. Connect the device there when it asks (it needs Chrome or Edge).`);
  } else if (m.known && !m.installed && !m.running) {
    return fail(r, `${m.name} is not installed. DeviceHub learns a device by listening to its maker's app.`, `Install ${m.name}${m.page ? ` from ${m.page}` : ' from its maker\'s site'}, then press Learn it for me again.`);
  }
  // no app DeviceHub knows (23 Oct 2026, Dsmjr2/DeviceHub-support#11: a recording that heard nothing): learning listens to
  // the app, so without one there is nothing to record. Never started into nothing; the person can still say they
  // have an app open and choose the settings themselves.
  if (!m.known) return fail(r, `DeviceHub does not know which app sets the ${dev.title || dev.name}. It learns a device by listening to that app, so without one there is nothing to record.`, 'If you have an app for it, open it, then use Choose the settings myself (below) and press I have its app open.');

  // 4. listening: Windows' one prompt
  r.phase = 'listen';
  r.ask = { kind: 'prompt', line: 'Press Yes on Windows\' prompt: DeviceHub listens to USB while it learns. It only listens.' };
  const l = await lw.act('listen', {});
  if (l.ok === false) return fail(r, l.error || 'DeviceHub could not start listening.', /declined/i.test(l.error || '') ? 'Press Learn it for me again and press Yes on the prompt.' : 'Press Test my learning setup (below) to see what is missing.');
  const until = d.now() + LIMITS.listenMs;
  let ls = null;
  while (d.now() < until && !r.stop) {
    ls = lw.status();
    if (['ready', 'stopped', 'error', 'ended'].includes(ls?.listener)) break;
    await d.sleep(500);
  }
  r.ask = null;
  if (stopped(r)) return quit(r);
  if (ls?.listener !== 'ready' && ls?.listener !== 'stopped') return fail(r, ls?.listenerError ? `The listener says: ${ls.listenerError}.` : 'DeviceHub did not start listening (the Windows prompt may not have been answered).', 'Press Test my learning setup (below): it says what is missing.');
  say(r, 'Listening.');

  // 5. each setting
  r.phase = 'learn';
  for (const x of r.items) {
    if (stopped(r)) return quit(r);
    await learnOne(r, x, m);
  }
  if (stopped(r)) return quit(r);

  // 6. the driver
  r.phase = 'save';
  const learned = r.items.filter((x) => x.status === 'learned');
  if (!learned.length) {
    await lw.act('quit', {});
    return fail(r, 'No setting could be learned.', 'Each one says why above. Get help (top right) sends Shawn what was found; Choose the settings myself (below) tries one at a time.');
  }
  const kind = plan.kind && plan.kind !== 'device' ? plan.kind[0].toUpperCase() + plan.kind.slice(1) : 'Device';
  const sv = await lw.act('save', { title: dev.name, kind });
  if (sv.ok === false) return fail(r, [].concat(sv.why || sv.error || 'The driver could not be saved.').join(' '), 'Get help (top right) sends Shawn what was found.');
  say(r, `Saved: ${learned.map((x) => x.label).join(', ')}.`);
  const now = await d.findMaker(dev.vid).catch(() => null);
  r.result = { saved: sv.saved || null, learned: learned.map((x) => x.label), leftAt: learned.filter((x) => x.leftAt).map((x) => ({ label: x.label, value: x.leftAt })), skipped: r.items.filter((x) => x.status !== 'learned').map((x) => ({ label: x.label, why: x.why })),
    appOpen: !!now?.running, app: m.known ? m.name : null, appKey: m.key || null };
  r.phase = 'done';
  return true;
}
async function quit(r) { r.ask = null; await lw.act('quit', {}).catch(() => {}); r.phase = 'stopped'; return false; }

const appName = (m) => (m?.known ? (m.web ? `${m.name} (in your browser)` : m.name) : 'the maker\'s app');
const showV = (v) => (v === true ? 'on' : v === false ? 'off' : String(v));

async function learnOne(r, x, m) {
  const it = x.it;
  const values = it.kind === 'toggle' ? ['on', 'off'] : it.values.map(String);
  const s = await lw.act('setting', { label: it.label, kind: it.kind, unit: it.unit || '', values });
  if (s.ok === false) { x.status = 'skipped'; x.why = s.error || [].concat(s.why || []).join(' '); return; }
  // DeviceHub changes it in the maker's app itself when it can
  let range = it.range || null;
  if (m.running && m.window) {
    x.status = 'driving';
    const dv = await lw.act('drive', {});
    if (dv.ok !== false && dv.driven) {
      if (dv.range) range = dv.range;
      if (dv.restore && !dv.restore.ok) say(r, dv.restore.why, false);
      return analyzeAdd(r, x, range);
    }
    if (dv.ok === false) { x.status = 'skipped'; x.why = dv.error; return; }
  }
  // else the person changes it, and DeviceHub notices. DeviceHub does not know what the app shows now: when nothing
  // changes for a while after the first ask, the app probably shows that value already, so the two are swapped once
  let vals = lw.current()?.setting?.values || [];
  for (let tries = 0; tries < 2; tries++) {
    let swap = false;
    for (let phase = 0; phase < 2; phase++) {
      if (r.stop) return;
      const to = vals[phase === 0 ? 1 : 0];
      x.status = 'asking';
      const rec = await lw.act('record', { value: to === true ? 'on' : to === false ? 'off' : String(to) });
      if (rec.ok === false) { x.status = 'skipped'; x.why = rec.error; r.ask = null; return; }
      r.ask = { kind: 'change', label: it.label, line: phase === 0 ? `Set ${it.label} to ${showV(to)} in ${appName(m)} now.` : `Now set ${it.label} back to ${showV(to)}.`, step: phase + 1, of: 2,
        ...(tries ? { note: `DeviceHub did not notice a change, so ${appName(m)} probably showed ${showV(vals[0])} already.` } : {}) };
      const got = await waitForChange(r, phase === 0 && !tries ? LIMITS.firstMs : LIMITS.changeMs);
      r.ask = null;
      if (got === 'quiet') {
        // nothing at all happened: start over the other way round (the recording so far is dropped with the setting)
        await lw.act('stop', {});
        const again = await lw.act('setting', { label: it.label, kind: it.kind, unit: it.unit || '', values: [...vals].reverse().map((v) => (v === true ? 'on' : v === false ? 'off' : String(v))) });
        if (again.ok === false) { x.status = 'skipped'; x.why = again.error; return; }
        vals = lw.current()?.setting?.values || [];
        swap = true;
        break;
      }
      const st = await lw.act('stop', {});
      if (got === 'skip') { x.status = 'skipped'; x.why = 'skipped'; return; }
      if (got === 'stop') return;
      if (got === 'timeout') { x.status = 'skipped'; x.why = `It was not changed within ${Math.round(LIMITS.changeMs / 60000)} minutes.`; return; }
      if (st.ok === false) { x.status = 'skipped'; x.why = st.error; return; }
    }
    if (!swap) break;
    if (tries) { x.status = 'skipped'; x.why = 'DeviceHub did not notice a change in either direction.'; return; }
  }
  x.leftAt = showV(vals[0]);
  return analyzeAdd(r, x, range);
}
// 'noticed' | 'done' | 'skip' | 'stop' | 'timeout' | 'quiet' (nothing new by the end of a first ask's shorter wait)
async function waitForChange(r, limit = LIMITS.changeMs) {
  const d = options.deps;
  r.done = false; r.skip = false;
  const t0 = d.now();
  let base = null, lastNew = null, newCount = 0;
  while (d.now() - t0 < limit) {
    await d.sleep(LIMITS.pollMs);
    if (r.stop) return 'stop';
    if (r.skip) return 'skip';
    if (r.done) return 'done';
    const p = lw.peek();
    if (!p) continue;
    const msgs = p.messages || [];
    if (!base) {
      if (d.now() - t0 < LIMITS.baselineMs) continue;
      base = baselineOf(msgs);
      newCount = 0;
      continue;
    }
    const n = novel(base, msgs).length;
    if (n > newCount) { newCount = n; lastNew = d.now(); }
    if (lastNew && d.now() - lastNew >= LIMITS.quietMs) return 'noticed';
  }
  return limit < LIMITS.changeMs && !newCount ? 'quiet' : 'timeout';
}
async function analyzeAdd(r, x, range) {
  const a = await lw.act('analyze', {});
  if (a.ok === false) { x.status = 'skipped'; x.why = [].concat(a.why || a.error || []).join(' '); return; }
  let add = { ok: false };
  if (a.kind === 'number') {
    // the app's own range, else the usual one for that setting, else what was recorded
    const usual = RANGES[PRESETS.find((p) => p.re.test(x.label))?.label];
    for (const rg of [range, usual, {}].filter(Boolean)) {
      add = await lw.act('add', rg.min != null ? { min: rg.min, max: rg.max, ...(rg.step ? { step: rg.step } : {}) } : {});
      if (add.ok !== false) break;
    }
  } else add = await lw.act('add', {});
  if (add.ok === false) { x.status = 'skipped'; x.why = [].concat(add.why || add.error || []).join(' '); return; }
  x.status = 'learned';
}

// the end: close the maker's app when it is open (the button says so), then turn on the saved driver's settings
export async function finish() {
  const d = options.deps;
  if (!run || run.phase !== 'done' || !run.result?.saved) return { ok: false, error: 'Nothing was saved to turn on.' };
  const res = run.result;
  if (res.appOpen && res.appKey) {
    try { await d.post('/api/diagnose/action', { kind: 'close-app', app: res.appKey, confirm: true }); } catch (e) { return { ok: false, error: `${res.app} could not be closed: ${e.message}. Close it yourself, then press Turn on settings again.` }; }
    res.appOpen = false;
  }
  // the saved driver's device: wait until it is connected (it loads by itself after the save)
  const id = res.saved.id;
  if (!id) return { ok: false, error: 'Restart DeviceHub once to load the new driver, then press Turn on settings on its page.' };
  let st = null;
  for (let i = 0; i < 30; i++) {
    try { st = (await d.get('/api/agent/state'))?.devices?.find((x) => x.id === id); } catch {}
    if (st?.status === 'connected') break;
    await d.sleep(1000);
  }
  if (st?.status !== 'connected') return { ok: false, error: 'The device has not connected to its new driver yet. Unplug it and plug it back in, then press Turn on settings again.' };
  try {
    const t = await d.post('/api/agent/turn-on', { id });
    res.turnedOn = { ran: !!t.ran, on: !!t.on, counts: t.counts || null, why: t.why || null };
    return { ok: true, id, ...res.turnedOn };
  } catch (e) { return { ok: false, error: `Settings were not turned on: ${e.message}. Press Turn on settings on its page.` }; }
}

export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/learn/auto')) return false;
  const step = url.pathname.slice('/api/learn/auto'.length).replace(/^\//, '');
  try {
    if (req.method === 'GET' && !step) { send(res, 200, state()); return true; }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
    const b = (await readBody(req)) || {};
    if (!step) { send(res, 200, await start(b)); return true; }
    if (step === 'finish') { send(res, 200, await finish()); return true; }
    if (!run) { send(res, 200, { ok: false, error: 'Nothing is being learned.' }); return true; }
    if (step === 'done') run.done = true;
    else if (step === 'skip') run.skip = true;
    else if (step === 'stop') run.stop = true;
    else { send(res, 404, { error: 'no such step' }); return true; }
    send(res, 200, { ok: true, ...view(run) });
  } catch (e) { send(res, 500, { ok: false, error: e.message }); }
  return true;
}
