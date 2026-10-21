// DeviceHub's background agent. Runs inside server.js and owns the three devices, so they connect without any
// browser permission, auto-switch keeps working with no window open, and the tray icon can show batteries.
// It runs the same core code as the app window (public/core, public/devices); windows become its clients.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { env } from '../public/core/env.js';
import * as core from '../public/core/devices.js';
import { setDeviceProvider } from '../public/devices/hid.js';
import mouse from '../public/devices/mouse-adapter.js';
import keyboard from '../public/devices/keyboard-adapter.js';
import headset, { setCorsairCall } from '../public/devices/headset-adapter.js';
import { auto, startAutoSwitch, loadSettings, onAuto } from '../public/core/autoswitch.js';
import * as weekly from './weekly-setup.mjs';
import * as daily from './daily-check.mjs';
import { loadProfiles, apply } from '../public/core/profiles.js';
import { provider, closeAll, setGoneHandler, setMovedHandler, devicesChanged, useKeyboardSpec, addSpec } from './hid-host.mjs';
import * as myDevices from './my-devices.mjs';
import { useKeyboardIds } from '../public/devices/via.js';
import { useLayout } from '../public/devices/keyboard-adapter.js';
import { fromDefinition } from '../public/devices/via-layout.js';

const require = createRequire(import.meta.url);
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const send = (type, data) => { for (const fn of listeners) { try { fn(type, data); } catch {} } };

let corsair = null;

// Devices this PC has ever had (seen-devices.json beside DeviceHub, 19 Oct 2026): on someone else's PC the app shows
// only the devices they own; until one is seen, all three are shown with what is supported.
const fsSeen = createRequire(import.meta.url)('fs'), pathSeen = createRequire(import.meta.url)('path');
const { writeAtomic } = createRequire(import.meta.url)('./safe-write.js');
const SEEN_FILE = pathSeen.join(pathSeen.dirname(fileURLToPath(import.meta.url)), '..', 'seen-devices.json');
let seen = new Set();
try { seen = new Set(JSON.parse(fsSeen.readFileSync(SEEN_FILE, 'utf8'))); } catch {}
function markSeen(id) {
  if (seen.has(id)) return;
  seen.add(id);
  try { writeAtomic(SEEN_FILE, JSON.stringify([...seen])); } catch {}
}

// Changes waiting for a device that is asleep, off or unplugged (public/core/devices.js), and each device's last known
// settings, so its page can show them and take changes while it is away, also after a restart (21 Oct 2026).
const WAIT_FILE = pathSeen.join(pathSeen.dirname(SEEN_FILE), 'waiting-changes.json');
const LAST_FILE = pathSeen.join(pathSeen.dirname(SEEN_FILE), 'last-device-values.json');
const readJson = (f) => { try { return JSON.parse(fsSeen.readFileSync(f, 'utf8')); } catch { return {}; } };
let lastSaved = '', lastTimer = null;
// at most once per 10 s (not "10 s after the last change": the headset reports something every few seconds)
function saveLast() {
  if (lastTimer) return;
  lastTimer = setTimeout(() => {
    lastTimer = null;
    const out = readJson(LAST_FILE);
    for (const d of Object.values(core.devices)) {
      if (!['connected', 'asleep', 'missing'].includes(d.status) || !Object.keys(d.values || {}).length) continue;
      out[d.id] = { values: d.values, info: d.info, at: new Date().toISOString(),
        ...(d.id === 'mouse' && d.status === 'connected' ? { trusted: Object.fromEntries(Object.keys(d.values).map((k) => [k, !!d.adapter.trusted?.(k)])) } : d.savedTrusted ? { trusted: d.savedTrusted } : {}) };
    }
    const text = JSON.stringify(out);
    if (text !== lastSaved) { lastSaved = text; try { writeAtomic(LAST_FILE, text); } catch {} }
  }, 10000);
}

export async function start({ port, corsairHelper }) {
  corsair = corsairHelper;
  env.agent = true;
  env.every = createRequire(import.meta.url)('./power.js').every;  // battery saver (helpers/power.js)
  // The core code's API calls go to this same server over loopback.
  env.api = async (p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.error) throw new Error(j?.error || r.statusText);
    return j;
  };
  env.toast = () => ({ update() {}, close() {} });
  env.onActivity = (entry) => send('activity', entry);

  setDeviceProvider(provider);
  setGoneHandler((id) => core.markMissing(id)); // unplugged: marked missing at once, then looked for every 20 s
  // cable in or out: read it again now, and at ~2, 5 and 10 s, because the mouse takes a few seconds to start (or stop)
  // reporting that it charges (19 Oct 2026: the switch was instant but "Charging" waited for the 60 s battery read)
  setMovedHandler((id) => {
    core.refresh(id, { quiet: true, full: true }).catch(() => {});
    for (const ms of [2000, 5000, 10000]) setTimeout(() => core.refresh(id, { quiet: true, full: true }).catch(() => {}), ms);
  });
  if (corsair) setCorsairCall(async (action, body) => corsair.handle(action, body || {}));
  mouse.levelFilter = require('./mouse-level').filter;  // the mouse's real battery level (helpers/mouse-level.js)
  // Any VIA keyboard (20 Oct 2026; helpers/via-defs.js): no P75 here but another VIA keyboard: its VIA definition gives
  // the layout, and the keyboard slot uses it. DEVICEHUB_VIA_TEST=1 runs the P75 itself this way (via-definitions\
  // 342DE479.json), to test the path on a known board.
  try {
    const via = require('./via-defs');
    const found = await via.findKeyboards();
    const p75 = found.some((k) => k.vid === '342D' && k.pid === 'E479');
    const other = process.env.DEVICEHUB_VIA_TEST === '1' ? found.find((k) => k.vid === '342D' && k.pid === 'E479') : (p75 ? null : found[0]);
    if (found.length) console.log(`[keyboard] VIA keyboards: ${found.map((k) => `${k.name || 'unnamed'} (${k.vid}:${k.pid})`).join(', ')}`);
    if (other) {
      try {
        const { def, from } = await via.definitionFor(other.vid, other.pid);
        const layout = fromDefinition(def);
        if (!layout.name || layout.name === 'VIA keyboard') layout.name = other.name || layout.name;
        useLayout(layout); useKeyboardIds(parseInt(other.vid, 16), parseInt(other.pid, 16)); useKeyboardSpec(other.vid, other.pid, other.name);
        console.log(`[keyboard] ${layout.name}: layout from ${from}, ${layout.rows}x${layout.cols}, ${layout.keys.length} keys`);
      } catch (e) { console.log(`[keyboard] ${other.name || other.vid + ':' + other.pid}: no layout (${e.message})`); }
    }
  } catch (e) { console.log(`[keyboard] looking for VIA keyboards failed: ${e.message}`); }
  for (const a of [mouse, headset, keyboard]) core.register(a);
  // devices added on this PC (my-devices/<name>/device.mjs; helpers/my-devices.mjs): an update never touches them
  for (const r of await myDevices.load(pathSeen.dirname(SEEN_FILE), { register: core.register, addSpec, taken: (id) => !!core.devices[id] })) {
    console.log(r.error ? `[my-devices] ${r.name}: not loaded: ${r.error}` : `[my-devices] ${r.name}: ${core.devices[r.id].adapter.title} added`);
  }
  // last known settings (until the device is read) and the changes still waiting for it
  for (const [id, s] of Object.entries(readJson(LAST_FILE))) {
    const d = core.devices[id];
    if (d && s?.values) { d.values = s.values; d.info = s.info || {}; if (s.trusted) d.savedTrusted = s.trusted; }
  }
  env.saveWaiting = (w) => writeAtomic(WAIT_FILE, JSON.stringify(w));
  core.restoreWaiting(readJson(WAIT_FILE));

  // Device changes go out as one snapshot per device, at most every 60 ms.
  const pending = new Map();
  core.onChange((id) => {
    if (core.devices[id] && ['connected', 'asleep'].includes(core.devices[id].status)) markSeen(id);
    if (core.devices[id]) saveLast();
    if (!core.devices[id] || pending.has(id)) return;
    pending.set(id, setTimeout(() => { pending.delete(id); send('device', snapshot(id)); }, 60));
  });
  onAuto(() => send('auto', autoState()));

  await core.loadHistory();
  for (const id of Object.keys(core.devices)) core.connect(id, false);
  core.startPolling();
  daily.start(pathSeen.dirname(SEEN_FILE), core);  // the quiet daily self-check (helpers/daily-check.mjs)
  startAutoSwitch();
  // the weekly setup file (helpers/weekly-setup.mjs): checked 90 s after start (the devices have connected) and daily
  setTimeout(() => weekly.saveIfDue(core, core.log).catch((e) => console.error('[setup] weekly', e.message)), 90000);
  setInterval(() => weekly.saveIfDue(core, core.log).catch((e) => console.error('[setup] weekly', e.message)), 24 * 3600 * 1000);
  // Windows says a device was added or removed (helpers/native/tray.cs DeviceWatch): look at once, not on the next timed
  // check. Several messages come per plug, so they are gathered for 400 ms first.
  let devTimer = null;
  require('./native').onEvent('dev', () => {
    clearTimeout(devTimer);
    devTimer = setTimeout(() => {
      const at = new Date().toLocaleTimeString();
      devicesChanged().then((moved) => console.log(`[devices] Windows reported a device change at ${at}; ${moved.length ? `moved ${moved.join(', ')} at ${new Date().toLocaleTimeString()}` : 'no cable change'}`)).catch(() => {});
      for (const d of Object.values(core.devices)) if (['missing', 'idle', 'error'].includes(d.status)) core.connect(d.id, false);
      require('./hs80-direct').lookForCable();  // the headset's cable may be what was plugged in
    }, 400);
  });
  // Waking from sleep (20 Oct 2026; helpers/native/tray.cs passes on Windows' power messages): USB devices come back a
  // moment after Windows does, so at about 3 s and again at 10 s every missing device is connected and every connected
  // one read again, instead of waiting for the next timed checks. server.log notes the sleep, the wake and how each
  // device came back. Waking can be reported twice (automatic, then by the user); one round per wake.
  let wokeAt = 0;
  require('./native').onEvent('power', (id) => {
    if (id === 0) { console.log(`[power] ${new Date().toLocaleString()} going to sleep`); return; }
    if (Date.now() - wokeAt < 30000) return;
    wokeAt = Date.now();
    console.log(`[power] ${new Date().toLocaleString()} woke up; reconnecting`);
    const round = async (label) => {
      await devicesChanged().catch(() => {});
      for (const d of Object.values(core.devices)) {
        if (['missing', 'idle', 'error'].includes(d.status)) await core.connect(d.id, false).catch(() => {});
        else if (['connected', 'asleep'].includes(d.status)) await core.refresh(d.id, { quiet: true, full: true }).catch(() => {});
      }
      const s = Object.values(core.devices).map((d) => `${d.id} ${d.status}`).join(', ');
      console.log(`[power] ${label} after waking (${Math.round((Date.now() - wokeAt) / 1000)} s): ${s}`);
    };
    setTimeout(() => round('first look').catch(() => {}), 3000);
    setTimeout(() => round('second look').catch(() => {}), 10000);
  });
  // Mouse wake (21 Oct 2026): while the mouse sleeps, the helper listens for its first movement (helpers/native/tray.cs,
  // DeviceWatch) and passes it on; the mouse is then looked for at once, and again as the dongle catches up, so it is back
  // in DeviceHub the moment it is moved. Its timed look while asleep becomes a 30 s fallback (public/core/devices.js).
  {
    const nat = require('./native');
    let wakeOn = false;
    const wakeWatch = async (on) => {
      if (on === wakeOn) return;
      wakeOn = on;
      const r = await nat.request('tray', on ? 'WAKE ON' : 'WAKE OFF', 5000).catch(() => 'NO');
      if (r === 'OK') env.wakeEvents = true; else wakeOn = false;
    };
    core.onChange((id) => { if (id === 'mouse' && core.devices.mouse) wakeWatch(core.devices.mouse.status === 'asleep'); });
    nat.onExit(() => { wakeOn = false; env.wakeEvents = false; });
    nat.onEvent('input', () => {
      wakeOn = false;
      if (core.devices.mouse?.status !== 'asleep') return;
      for (const ms of [0, 400, 1200, 2500, 5000]) setTimeout(() => { if (core.devices.mouse.status === 'asleep') core.refresh('mouse', { quiet: true }).catch(() => {}); }, ms);
    });
  }
  // A device that failed (not just unplugged) is retried every 30 s.
  setInterval(() => { for (const d of Object.values(core.devices)) if (d.status === 'error') core.connect(d.id, false); }, 30000);
}

export function stop() { closeAll(); }

const autoState = () => ({ settings: auto.settings, active: auto.active });

function adapterMeta(d) {
  const a = d.adapter;
  const meta = { id: a.id, title: a.title, kind: a.kind, vendor: a.vendor, unsupported: a.unsupported, autoReconnect: true, pollRead: !!a.pollRead, hasLighting: !!a.hasLighting?.() };
  // a device added in my-devices/: its page is drawn from its settings list (public/pages/my-device.js)
  if (a.plugin) Object.assign(meta, { plugin: a.plugin, settings: a.settings, battery: typeof a.battery === 'function' });
  // while the mouse is away its flash is not read: which settings read back cleanly is taken from its last visit
  if (a.id === 'mouse') meta.trusted = Object.fromEntries(Object.keys(d.values || {}).map((k) => [k, d.status !== 'connected' && d.savedTrusted ? !!d.savedTrusted[k] : !!a.trusted?.(k)]));
  if (a.id === 'headset') { meta.props = a.props; meta.endpoints = a.endpoints; meta.mode = a.mode; }
  if (a.id === 'keyboard' && a.session) {
    const s = a.session;
    meta.session = { info: s.info, keymap: s.keymap, encoders: s.encoders, original: s.original, layout: s.layout, macros: { mi: s.macros.mi, list: s.macros.list, editable: s.macros.editable, raw: s.macros.raw } };
  }
  return meta;
}

export function snapshot(id) {
  const d = core.devices[id];
  return { id, status: d.status, info: d.info, battery: d.battery, values: d.values, error: d.error, readAt: d.readAt, adapter: adapterMeta(d), seen: seen.has(id), waiting: d.waiting || [], undo: d.undo || null };
}

export function state() {
  return { devices: Object.keys(core.devices).map(snapshot), activity: core.activity.slice(0, 60), auto: autoState() };
}

export const reloadSettings = () => loadSettings();

// Operations the app window and the tray icon ask for.
export async function op(name, b) {
  const has = (id) => { if (!core.devices[id]) throw new Error(`unknown device ${id}`); return id; };
  switch (name) {
    case 'connect': await core.connect(has(b.id), false); return snapshot(b.id);
    case 'refresh': await core.refresh(has(b.id)); return snapshot(b.id);
    case 'read': return { values: await core.readNow(has(b.id)) };
    case 'backup': return { file: await core.backupNow(has(b.id), String(b.why || 'manual')) };
    // the daily self-check (Settings > Health): its last result, or run it now
    case 'check-result': return daily.result();
    case 'check-run': return daily.run({ all: true });
    // the page's Undo: the last change on this device put back
    case 'undo': return core.undo(has(b.id));
    // a slider was pressed: the backup is taken before it moves (core.prepare skips it when one is recent)
    case 'prepare': await core.prepare(has(b.id)); return { ok: true };
    // test: true = a self-test write (helpers/soak-test.mjs): checked and backed up like any other, but not in Activity
    case 'write': {
      const value = await core.write(has(b.id), String(b.key), b.value, { label: String(b.label || b.key), display: String(b.display ?? b.value), silent: true, live: b.live === true, noLog: b.test === true || b.live === true });
      // waiting: the device is asleep, off or unplugged and the change is kept until it is back
      return { value, waiting: b.live !== true && core.waitingFor(b.id)[String(b.key)]?.value === b.value };
    }
    case 'batch': {
      if (!Array.isArray(b.items)) throw new Error('items must be a list');
      return core.writeBatch(has(b.id), b.items.map((i) => ({ key: String(i.key), value: i.value, label: String(i.label || i.key), display: String(i.display ?? i.value) })), String(b.why || 'batch'));
    }
    case 'log': core.log(String(b.text || '').slice(0, 300), b.kind === 'bad' ? 'bad' : b.kind === 'good' ? 'good' : 'info', b.device); return { ok: true };
    case 'apply-profile': {
      const p = (await loadProfiles()).find((x) => x.name === b.name);
      if (!p) throw new Error(`no profile called "${b.name}"`);
      const r = await apply(p);
      return r;
    }
    default: throw new Error(`unknown agent operation ${name}`);
  }
}

// the weekly setup files, for the server's /api/setups routes
export const setups = { list: weekly.list, read: weekly.read, saveNow: () => weekly.saveIfDue(core, core.log, { force: true }) };
