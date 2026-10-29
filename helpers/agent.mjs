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
import headset, { setCorsairCall, setHeadsetPick } from '../public/devices/headset-adapter.js';
import { cleanPick } from '../public/core/headset-pick.js';
import { auto, startAutoSwitch, loadSettings, onAuto } from '../public/core/autoswitch.js';
import * as weekly from './weekly-setup.mjs';
// (27 Oct 2026, memory) onedrive-setup.mjs only when a OneDrive copy is written (saveOneDrive below)
import * as daily from './daily-check.mjs';
import * as batteryCare from './battery-care.mjs';
import { headsetSound } from './headset-sound.mjs';
import { loadProfiles, apply } from '../public/core/profiles.js';
import { startGameMode, nowValues } from './game-mode-live.mjs';
import { provider, closeAll, setGoneHandler, setMovedHandler, devicesChanged, useKeyboardSpec, addSpec, useWindowsEvents, setAnnounceHandlers } from './hid-host.mjs';
import * as myDevices from './my-devices.mjs';
import * as autoReport from './auto-report.mjs';
import { applyAdded } from './profile-added.mjs';
import { useKeyboardIds } from '../public/devices/via.js';
import { useLayout, useViaGate } from '../public/devices/keyboard-adapter.js';
import { fromDefinition } from '../public/devices/via-layout.js';

const require = createRequire(import.meta.url);
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const send = (type, data) => { for (const fn of listeners) { try { fn(type, data); } catch {} } };

let corsair = null;

// Devices this PC has ever had (data\seen-devices.json, 19 Oct 2026): on someone else's PC the app shows
// only the devices they own; until one is seen, all three are shown with what is supported.
const fsSeen = createRequire(import.meta.url)('fs'), pathSeen = createRequire(import.meta.url)('path');
const { writeAtomic } = createRequire(import.meta.url)('./safe-write.js');
// (27 Oct 2026) this PC's files are in data\ (helpers/data-dir.js); APP_ROOT is DeviceHub's own folder
const APP_ROOT = pathSeen.join(pathSeen.dirname(fileURLToPath(import.meta.url)), '..');
const { dataFile } = createRequire(import.meta.url)('./data-dir.js');
const SEEN_FILE = dataFile('seen-devices.json', APP_ROOT);
let seen = new Set();
try { seen = new Set(JSON.parse(fsSeen.readFileSync(SEEN_FILE, 'utf8'))); } catch {}
// The headset slot is the Corsair HS80's; with no HS80 it runs another USB headset in sound-only mode (generic). That
// other headset never counts as the HS80 being seen (22 Oct 2026, support issue 3: "Corsair HS80 (headset): missing" on
// a PC that never had one). A copy that recorded "headset" for such a headset before this change is put right once:
// its last saved headset (last-device-values.json) names another model, so the HS80 was never there.
export const sawOwnHeadset = (info) => !info?.Model || /HS80/i.test(String(info.Model));
{
  let last = null;
  try { last = JSON.parse(fsSeen.readFileSync(dataFile('last-device-values.json', APP_ROOT), 'utf8')); } catch {}
  if (seen.has('headset') && last?.headset?.info && !sawOwnHeadset(last.headset.info)) {
    seen.delete('headset');
    try { writeAtomic(SEEN_FILE, JSON.stringify([...seen])); } catch {}
  }
}
function markSeen(id) {
  if (id === 'headset' && core.devices.headset?.adapter?.generic) return;   // another USB headset is not the HS80
  if (seen.has(id)) return;
  seen.add(id);
  try { writeAtomic(SEEN_FILE, JSON.stringify([...seen])); } catch {}
}

// Changes waiting for a device that is asleep, off or unplugged (public/core/devices.js), and each device's last known
// settings, so its page can show them and take changes while it is away, also after a restart (21 Oct 2026).
const WAIT_FILE = dataFile('waiting-changes.json', APP_ROOT);
const LAST_FILE = dataFile('last-device-values.json', APP_ROOT);
const readJson = (f) => { try { return JSON.parse(fsSeen.readFileSync(f, 'utf8')); } catch { return {}; } };
// The headset the Headset page controls when two or more are plugged in (22 Oct 2026): settings.json "headsetPick"
const SETTINGS_FILE = dataFile('settings.json', APP_ROOT);
async function pickHeadset(key) {
  const k = cleanPick(key);
  const a = core.devices.headset.adapter;
  if (!k || !(a.headsets || []).some((c) => c.key === k)) throw new Error('That headset is not plugged in.');
  const cur = readJson(SETTINGS_FILE);
  if (cur.headsetPick !== k) {
    // settings.json backed up first, then only this one key changed
    if (fsSeen.existsSync(SETTINGS_FILE)) fsSeen.copyFileSync(SETTINGS_FILE, pathSeen.join(APP_ROOT, 'backups', `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    writeAtomic(SETTINGS_FILE, JSON.stringify({ ...cur, headsetPick: k }, null, 2));
  }
  setHeadsetPick(k);
  if (a.picked !== k) {
    // the headset's next read sees the new choice and lets go; it is then connected again on the chosen one
    await core.refresh('headset', { quiet: true, full: true });
    if (core.devices.headset.status === 'missing') await core.connect('headset', false);
    // Equalizer APO: its settings written again, so the EQ plays on the chosen headset (the same preset, nothing else)
    try { const eq = await env.api('/api/eq'); if (eq.engine === 'eqapo' && eq.activeId) await env.api('/api/eq/activate', { id: eq.activeId }); } catch {}
  }
  return snapshot('headset');
}
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
  // a profile's part for one added device (helpers/profile-added.mjs): public/core/profiles.js apply() calls it here
  env.applyAdded = (body) => applyAdded(body, { core });
  env.onActivity = (entry) => {
    send('activity', entry);
    // a write whose read-back did not match: an automatic problem report (helpers/auto-report.mjs)
    if (entry?.kind === 'bad' && entry.device) autoReport.noteActivity(entry, core.devices[entry.device]?.adapter?.title);
  };

  setDeviceProvider(provider);
  setGoneHandler((id) => core.markMissing(id)); // unplugged: marked missing at once, then looked for every 20 s
  // cable in or out: read it again now, and at ~2, 5 and 10 s, because the mouse takes a few seconds to start (or stop)
  // reporting that it charges (19 Oct 2026: the switch was instant but "Charging" waited for the 60 s battery read)
  setMovedHandler((id) => {
    core.refresh(id, { quiet: true, full: true }).catch(() => {});
    for (const ms of [2000, 5000, 10000]) setTimeout(() => core.refresh(id, { quiet: true, full: true }).catch(() => {}), ms);
  });
  // The mouse's DPI button (21 Oct 2026): it announces each press, so the DPI stage is read the moment it changes, and
  // the minute check reads only the battery while the announcements are heard (public/core/devices.js refreshUnlocked)
  setAnnounceHandlers((id) => core.refresh(id, { quiet: true, dpi: true }).catch(() => {}), (id, on) => { if (id === 'mouse') env.dpiEvents = on; });
  if (corsair) setCorsairCall(async (action, body) => corsair.handle(action, body || {}));
  mouse.levelFilter = require('./mouse-level').filter;  // the mouse's real battery level (helpers/mouse-level.js)
  // Any VIA keyboard, any brand (27 Oct 2026, helpers/via-generic.mjs): found by its VIA collection (FF60:0061), never
  // while the P75 is plugged in. A listed one (an id DeviceHub's drivers name) runs as before; an unlisted one is asked
  // only VIA's protocol version first and then only read until Turn on settings (keyboard-adapter.js). One that does
  // not answer steps aside and the next VIA keyboard is tried. No layout: it still connects, its keys not drawn.
  try {
    const via = require('./via-defs');
    const vg = await import('./via-generic.mjs');
    const found = await via.findKeyboards();
    if (found.length) console.log(`[keyboard] VIA keyboards: ${found.map((k) => `${k.name || 'unnamed'} (${k.vid}:${k.pid})`).join(', ')}`);
    const listed = vg.listedIds();
    const store = vg.settingsStore();
    const aside = new Set();
    const pick = () => vg.candidates(found, { listed, aside, viaTest: process.env.DEVICEHUB_VIA_TEST === '1' })[0] || null;
    const use = async (other) => {
      let layout = null, none = null;
      try {
        const { def, from } = await via.definitionFor(other.vid, other.pid);
        layout = fromDefinition(def);
        if (!layout.name || layout.name === 'VIA keyboard') layout.name = other.name || layout.name;
        console.log(`[keyboard] ${layout.name}: layout from ${from}, ${layout.rows}x${layout.cols}, ${layout.keys.length} keys`);
      } catch (e) {
        none = { name: other.name || `VIA keyboard ${other.vid}:${other.pid}`, why: `its key layout is not published (${e.message})` };
        console.log(`[keyboard] ${other.name || other.vid + ':' + other.pid}: no layout (${e.message}); it connects without its keys drawn`);
      }
      useLayout(layout, none);
      useViaGate({ id: other.id, vid: other.vid, pid: other.pid, unlisted: other.unlisted, store, onStepAside });
      useKeyboardIds(parseInt(other.vid, 16), parseInt(other.pid, 16));
      // an unlisted keyboard's channel checks the never list before every send (VIA 0x06 / 0x0A / 0x0B / 0x10)
      useKeyboardSpec(other.vid, other.pid, other.name, { never: other.unlisted });
      if (other.unlisted) console.log(`[keyboard] ${other.name || other.id}: not on DeviceHub's list: it is identified first, then read only until Turn on settings`);
    };
    function onStepAside(id, why) {
      aside.add(id);
      console.log(`[keyboard] ${id}: stepped aside: ${why}; nothing more is sent to it`);
      const next = pick();
      if (next) use(next).then(() => setTimeout(() => core.connect('keyboard', false).catch(() => {}), 300)).catch(() => {});
    }
    const first = pick();
    if (first) await use(first);
  } catch (e) { console.log(`[keyboard] looking for VIA keyboards failed: ${e.message}`); }
  for (const a of [mouse, headset, keyboard]) core.register(a);
  // devices added on this PC (my-devices/<name>/device.mjs; helpers/my-devices.mjs): an update never touches them
  for (const r of await myDevices.load(APP_ROOT, { register: core.register, addSpec, taken: (id) => !!core.devices[id] })) {
    console.log(r.error ? `[my-devices] ${r.name}: not loaded: ${r.error}` : `[my-devices] ${r.name}: ${core.devices[r.id].adapter.title} added`);
  }
  // a library or learned driver's error that reached no caller (helpers/driver-guard.js, installed by server.js): its
  // device is marked asleep or in error, and DeviceHub keeps running (support issues 3-5, 22 Oct 2026)
  require('./driver-guard.js').setDriverFaultHandler((folder, err) => {
    for (const d of Object.values(core.devices)) if (d.adapter.plugin && d.adapter.plugin.toLowerCase() === String(folder).toLowerCase()) core.driverFault(d.id, err);
  });
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
  // (27 Oct 2026, Shawn) Windows' sound and mic move to the headset when it turns on (helpers/headset-sound.mjs); not in
  // a test install (DEVICEHUB_TEST), which never touches Windows sound
  if (corsair && process.env.DEVICEHUB_TEST !== '1') {
    const hs = headsetSound({ call: (action, body) => corsair.handle(action, body || {}), log: (text, kind) => core.log(text, kind, 'headset'), readSettings: () => readJson(SETTINGS_FILE) });
    core.onChange((id) => { if (id === 'headset' && core.devices.headset) hs.seen(core.devices.headset)?.catch?.(() => {}); });
  }

  await core.loadHistory();
  setHeadsetPick(readJson(SETTINGS_FILE).headsetPick);  // the headset picked on the Headset page, if any
  for (const id of Object.keys(core.devices)) core.connect(id, false);
  core.startPolling();
  daily.start(APP_ROOT, core);  // the quiet daily self-check (helpers/daily-check.mjs)
  batteryCare.start(APP_ROOT, core);  // lights down on a low battery, back once it charges
  startAutoSwitch();
  // Game mode (27 Oct 2026, helpers/game-mode-live.mjs): a set-up game's switches while it runs, then everything put
  // back; the program list from the native helper only (no tasklist); not in a test install (DEVICEHUB_TEST)
  if (corsair && process.env.DEVICEHUB_TEST !== '1') {
    gameMode = startGameMode({
      core, api: env.api, root: APP_ROOT, every: env.every, log: (text, kind) => core.log(text, kind),
      procs: async () => { const r = await corsair.handle('procs', {}); if (!Array.isArray(r.names)) throw new Error('no names'); return r.names; },
      profileBusy: () => auto.busy, onChange: () => send('auto', autoState()),
    });
    env.gameModeExes = () => gameMode.exes();   // auto-switch leaves these games to game mode (public/core/autoswitch.js)
  }
  // the weekly setup file (helpers/weekly-setup.mjs): checked 90 s after start (the devices have connected) and daily
  setTimeout(() => weekly.saveIfDue(core, core.log).catch((e) => console.error('[setup] weekly', e.message)), 90000);
  setInterval(() => weekly.saveIfDue(core, core.log).catch((e) => console.error('[setup] weekly', e.message)), 24 * 3600 * 1000);
  // the OneDrive copy (helpers/onedrive-setup.mjs), when switched on: 2 minutes after start, then every 30 minutes,
  // written only when something in it changed
  const oneDriveTick = () => { if (readJson(SETTINGS_FILE).oneDriveCopy === true) saveOneDrive().catch((e) => console.error('[onedrive]', e.message)); };
  setTimeout(oneDriveTick, 120000);
  setInterval(oneDriveTick, 30 * 60 * 1000);
  // Windows says a device was added or removed (helpers/native/tray.cs DeviceWatch): look at once, not on the next timed
  // check. Several messages come per plug, so they are gathered for 400 ms first.
  let devTimer = null, plugTimer = null;
  // a device plugged in while DeviceHub runs (helpers/plug-watch.mjs): its library driver installed at once, or the
  // window offers Learn it for me. Not in tests (DEVICEHUB_TEST), as auto setup at start.
  const plug = process.env.DEVICEHUB_TEST === '1' ? null : (await import('./plug-watch.mjs')).watcher({
    root: APP_ROOT, pcMap: require('./pc-map.js'), send,
    log: (e) => core.log(e.text, e.kind || 'info'),
  });
  if (plug) setTimeout(() => plug.start().catch(() => {}), 5000);
  require('./native').onEvent('dev', () => {
    if (plug) { clearTimeout(plugTimer); plugTimer = setTimeout(() => plug.check().catch((e) => console.error('[plug]', e.message)), 2500); }
    clearTimeout(devTimer);
    devTimer = setTimeout(() => {
      const at = new Date().toLocaleTimeString();
      devicesChanged().then((moved) => console.log(`[devices] Windows reported a device change at ${at}; ${moved.length ? `moved ${moved.join(', ')} at ${new Date().toLocaleTimeString()}` : 'no cable change'}`)).catch(() => {});
      for (const d of Object.values(core.devices)) if (['missing', 'idle', 'error'].includes(d.status)) { d.adapter.notMineRetry?.(); core.connect(d.id, false); }
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
      if (r === 'OK') { env.wakeEvents = true; useWindowsEvents(true); require('./hs80-direct').useWindowsEvents(true); } else wakeOn = false;
    };
    core.onChange((id) => { if (id === 'mouse' && core.devices.mouse) wakeWatch(core.devices.mouse.status === 'asleep'); });
    // whether the helper's window (Windows' device messages, the mouse's wake) is there: asked a few seconds after start
    // and after the helper restarts, then the slower fallback checks apply (hid-host.mjs, hs80-direct.js, devices.js)
    const events = (on) => { env.wakeEvents = on; useWindowsEvents(on); require('./hs80-direct').useWindowsEvents(on); };
    const probe = async () => { if (wakeOn) return; const r = await nat.request('tray', 'WAKE OFF', 5000).catch(() => 'NO'); if (r === 'OK') events(true); else setTimeout(probe, 30000); };
    setTimeout(probe, 5000);
    nat.onExit(() => { wakeOn = false; events(false); env.dpiEvents = false; setTimeout(probe, 5000); });
    nat.onEvent('input', () => {
      wakeOn = false;
      if (core.devices.mouse?.status !== 'asleep') return;
      for (const ms of [0, 400, 1200, 2500, 5000]) setTimeout(() => { if (core.devices.mouse.status === 'asleep') core.refresh('mouse', { quiet: true }).catch(() => {}); }, ms);
    });
  }
  // A device that failed (not just unplugged) is retried every 30 s. First, on the same tick, the automatic problem
  // reports look at how long each has been in an error (helpers/auto-report.mjs checkDevices: over 10 minutes, a fault)
  setInterval(() => {
    try { autoReport.checkDevices(Object.values(core.devices)); } catch {}
    for (const d of Object.values(core.devices)) if (d.status === 'error') core.connect(d.id, false);
  }, 30000);
}

export function stop() { closeAll(); }

let gameMode = null;
// game: the game mode on now ({ active: { name }, restoring }), for the Overview's "Valorant mode on" line
const autoState = () => ({ settings: auto.settings, active: auto.active, game: gameMode ? gameMode.status() : null });

function adapterMeta(d) {
  const a = d.adapter;
  const meta = { id: a.id, title: a.title, kind: a.kind, vendor: a.vendor, unsupported: a.unsupported, autoReconnect: true, pollRead: !!a.pollRead, hasLighting: !!a.hasLighting?.() };
  // a device added in my-devices/: its page is drawn from its settings list (public/pages/my-device.js)
  // a library driver that found a device on its channel that is not its own (helpers/my-devices.mjs stepAside), and the
  // USB id it is connected through (the Logitech drivers: one of many receiver and cable ids)
  if (a.plugin) Object.assign(meta, { notMine: a.notMine?.why || null, usbId: a.usbId || null });
  // the USB ids its driver declares (29 Oct 2026): the window uses them to tell that an added headset driver and the
  // Headset page's Windows sound side are one headset, and shows it once (core/devices.js headsetTwin)
  if (a.plugin) { const hx = (x) => String(x).toLowerCase().replace(/^0x/, '').padStart(4, '0'); meta.usbIds = [...new Set(myDevices.declaredIds(a).flatMap((d) => (d.pids || []).filter((p) => p != null && p !== '').map((p) => `${hx(d.vid)}:${hx(p)}`)))]; }
  if (a.plugin) Object.assign(meta, { plugin: a.plugin, settings: a.settings, battery: typeof a.battery === 'function', ...(a.library ? { library: a.library } : {}), ...(a.batteryCare ? { batteryCare: a.batteryCare } : {}) });
  // while the mouse is away its flash is not read: which settings read back cleanly is taken from its last visit
  if (a.id === 'mouse') meta.trusted = Object.fromEntries(Object.keys(d.values || {}).map((k) => [k, d.status !== 'connected' && d.savedTrusted ? !!d.savedTrusted[k] : !!a.trusted?.(k)]));
  if (a.id === 'headset') { meta.props = a.props; meta.endpoints = a.endpoints; meta.mode = a.mode; meta.generic = a.generic ? { usb: a.generic.usb, device: a.generic.device } : null; meta.headsets = a.headsets; meta.picked = a.picked; }
  // an unlisted VIA keyboard's id, Turn on settings state and missing layout (27 Oct 2026, helpers/via-generic.mjs)
  if (a.id === 'keyboard') meta.via = a.via || null;
  if (a.id === 'keyboard' && a.session) {
    const s = a.session;
    meta.session = { info: s.info, keymap: s.keymap, encoders: s.encoders, original: s.original, layout: s.layout, macros: { mi: s.macros.mi, list: s.macros.list, editable: s.macros.editable, raw: s.macros.raw } };
  }
  return meta;
}

// absent: an added driver that found nothing of its own on this PC (helpers/my-devices.mjs isAbsent)
// A driver that stepped aside (notMine) is forgotten as seen (24 Oct 2026, support#17): a keyboard driver recorded as
// seen before it learned to step aside showed "Logitech keyboard, connecting" on every start and every retry.
export function snapshot(id) {
  const d = core.devices[id];
  if (d.adapter?.plugin && d.adapter.notMine && seen.has(id)) { seen.delete(id); try { writeAtomic(SEEN_FILE, JSON.stringify([...seen])); } catch {} }
  return { id, status: d.status, info: d.info, battery: d.battery, values: d.values, error: d.error, readAt: d.readAt, adapter: adapterMeta(d), seen: seen.has(id), absent: myDevices.isAbsent(d.adapter, d.status, seen.has(id)), waiting: d.waiting || [], undo: d.undo || null };
}

export function state() {
  return { devices: Object.keys(core.devices).map(snapshot), activity: core.activity.slice(0, 60), auto: autoState() };
}

export const reloadSettings = () => loadSettings();

// Operations the app window and the tray icon ask for.
export async function op(name, b) {
  const has = (id) => { if (!core.devices[id]) throw new Error(`unknown device ${id}`); return id; };
  switch (name) {
    // the person's Connect: a driver resting after "not this driver's device" looks again at once
    case 'connect': core.devices[has(b.id)].adapter.notMineRetry?.(); await core.connect(b.id, false); return snapshot(b.id);
    case 'refresh': await core.refresh(has(b.id)); return snapshot(b.id);
    case 'read': return { values: await core.readNow(has(b.id)) };
    case 'backup': return { file: await core.backupNow(has(b.id), String(b.why || 'manual')) };
    // a library driver's self-check again, on the person's click (diagnose.mjs action "check-again")
    case 'recheck': { const r = await core.recheck(has(b.id)); return { ran: !!r?.ran, why: r?.why || null, waiting: !!r?.waiting, counts: r?.counts || null, device: snapshot(b.id) }; }
    // "Turn on settings" for a library driver with no real-device record (safety round 2): kept, then its self-check now
    case 'turn-on': { const r = await core.turnOn(has(b.id)); return { ran: !!r?.ran, on: !!r?.on, why: r?.why || null, waiting: !!r?.waiting, counts: r?.counts || null, device: snapshot(b.id) }; }
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
    // the picker on the Headset page (two or more USB headsets): remembered in settings.json, then that one runs
    case 'headset-pick': return pickHeadset(b.pick);
    case 'log': core.log(String(b.text || '').slice(0, 300), b.kind === 'bad' ? 'bad' : b.kind === 'good' ? 'good' : 'info', b.device); return { ok: true };
    // one added device's part of a profile, from a window's apply (public/core/profiles.js)
    case 'profile-added': return applyAdded({ id: String(b.id || ''), values: b.values, name: b.name, quiet: b.quiet === true }, { core });
    // Game mode (27 Oct 2026): the saved games read again after a save; what each switch is now ("Use now's settings")
    case 'game-mode-reload': if (gameMode) { gameMode.reload(); gameMode.tick().catch(() => {}); } return { ok: true, status: gameMode ? gameMode.status() : null };
    case 'game-mode-now': return nowValues({ core, api: env.api });
    case 'apply-profile': {
      const p = (await loadProfiles()).find((x) => x.name === b.name);
      if (!p) throw new Error(`no profile called "${b.name}"`);
      const r = await apply(p);
      return r;
    }
    default: throw new Error(`unknown agent operation ${name}`);
  }
}

// this PC's setup in OneDrive (helpers/onedrive-setup.mjs; the extras without wallpapers, helpers/setup-extras.js)
const extras = require('./setup-extras.js').create();
export const saveOneDrive = async (opts) => (await import('./onedrive-setup.mjs')).save(core, extras, opts);
// the weekly setup files, for the server's /api/setups routes
export const setups = { list: weekly.list, read: weekly.read, saveNow: () => weekly.saveIfDue(core, core.log, { force: true }) };
