// Device manager: one entry per device, the only path pages use to read or change anything.
// Every write: back up the device's current settings to a file, write ONE setting, re-read it.
//
// It runs in one of three places:
//  - the server's background agent (owns the devices; env.agent = true)
//  - the app window as a client of that agent (useRemote(): every call goes to /api/agent/*)
//  - the app window on its own (demo mode, or WebHID when no agent is running)
import { env } from './env.js';
import { startEvents, onEvent, onOpen } from './events.js';
import { rgbToHsv255 } from '../devices/keyboard-adapter.js';

const listeners = new Set();
export const devices = {};      // id -> entry
export const activity = [];     // newest first

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(id) { for (const fn of listeners) { try { fn(id); } catch (e) { console.error(e); } } }

let demo = false;
export function setDemo(on) { demo = on; }
export const isDemo = () => demo;
let remote = false;
export const isRemote = () => remote;

// extra: flags for an open window, e.g. { auto: true } (show as a toast) or { lowBattery: true }.
export function log(text, kind = 'info', device, extra) {
  if (remote) { env.api('/api/agent/log', { text, kind, device }).catch(() => {}); return; }
  const entry = { at: new Date(), text, kind, device, ...extra };
  activity.unshift(entry);
  activity.length = Math.min(activity.length, 200);
  emit('activity');
  if (env.agent) env.onActivity?.(entry);
  if (!demo) env.api('/api/activity', { text, kind, device }).catch(() => {});
}

// Earlier sessions' history (the server keeps it in activity.jsonl).
export async function loadHistory() {
  if (demo) return;
  try {
    const old = await env.api('/api/activity');
    const seen = new Set(activity.map((a) => `${+a.at}${a.text}`));
    for (const a of old) { a.at = new Date(a.at); a.old = true; if (!seen.has(`${+a.at}${a.text}`)) activity.push(a); }
    activity.sort((a, b) => b.at - a.at);
    emit('activity');
  } catch {}
}

export function register(adapter) {
  devices[adapter.id] = { id: adapter.id, adapter, status: 'idle', info: {}, battery: null, values: {}, error: null };
}

const lowWarned = {};
const set = (id, patch) => {
  // a change still waiting for the device shows as made, whatever the device reads back meanwhile
  if (patch.values && waiting[id]) patch = { ...patch, values: { ...patch.values, ...waitingValues(id) } };
  const was = devices[id].status;
  Object.assign(devices[id], patch);
  if (patch.status === 'connected' && was !== 'connected' && waiting[id]) setTimeout(() => flushWaiting(id), 500);
  // One warning per device when its battery gets low; re-armed once it charges past 25%.
  const p = devices[id].battery?.percent;
  if (p != null && p <= 15 && !lowWarned[id] && !devices[id].battery.charging) {
    lowWarned[id] = true;
    env.toast(`${devices[id].adapter.title}: battery ${p}%`, 'bad', { detail: 'Time to charge it.', ms: 9000 });
    if (env.agent) log(`${devices[id].adapter.title}: battery ${p}%`, 'bad', id, { lowBattery: true });
  }
  if (p != null && p > 25) lowWarned[id] = false;
  emit(id);
};

// ---------- client mode: the window talks to the server's agent ----------
let remoteBusy = 0;
const rcall = async (path, body) => { remoteBusy++; try { return await env.api(path, body); } finally { remoteBusy--; } };

function proxyAdapter(meta) {
  return {
    ...meta,
    trusted: (k) => !!meta.trusted?.[k],
    hasLighting: () => !!meta.hasLighting,
    lightingKeys(r, g, b, brightness) { const { hue, sat } = rgbToHsv255(r, g, b); return [['hue', hue], ['saturation', sat], ['brightness', Math.round((brightness / 100) * 255)]]; },
    owns: () => false,
  };
}

// the last state each device sent: one that comes again unchanged redraws nothing (21 Oct 2026: a same-value write
// rebuilt the whole page for nothing)
const lastSnap = {};
function applyRemote(snap) {
  for (const s of snap.devices || []) {
    const { readAt, ...cmp } = s;
    const text = JSON.stringify(cmp);
    if (lastSnap[s.id] === text && devices[s.id]) { devices[s.id].readAt = readAt; continue; }
    lastSnap[s.id] = text;
    const cur = devices[s.id] || (devices[s.id] = { id: s.id });
    Object.assign(cur, { status: s.status, info: s.info, battery: s.battery, values: s.values, error: s.error, readAt: s.readAt, adapter: proxyAdapter(s.adapter), seen: s.seen, absent: !!s.absent, waiting: s.waiting || [], undo: s.undo || null });
    emit(s.id);
  }
  if (snap.auto) { remoteAuto = snap.auto; env.onRemoteAuto?.(snap.auto); emit('auto'); }
}
export let remoteAuto = null;

// Switch this window to client mode. Resolves true when the agent answered.
export async function useRemote() {
  try {
    await env.api('/api/agent/state'); // is an agent answering at all?
  } catch { return false; }
  remote = true;
  for (const k of Object.keys(devices)) delete devices[k];
  // Open the live stream first, then take the full snapshot each time it (re)opens, so no change is missed in
  // between and activity from a DeviceHub restart is picked up. The window's one stream (core/events.js, 27 Oct 2026):
  // the same events as before, plus what the window used to poll for (app.js).
  const resync = async () => {
    try {
      const snap = await env.api('/api/agent/state');
      applyRemote(snap);
      activity.length = 0;
      for (const a of snap.activity || []) activity.push({ ...a, at: new Date(a.at) });
      emit('activity');
    } catch {}
  };
  onEvent('device', (d) => applyRemote({ devices: [d] }));
  onEvent('auto', (a) => applyRemote({ auto: a }));
  // a device just plugged in (helpers/plug-watch.mjs): the window says what DeviceHub did or can do
  onEvent('newdevice', (x) => env.onNewDevice?.(x));
  onEvent('activity', (a) => {
    activity.unshift({ ...a, at: new Date(a.at) });
    activity.length = Math.min(activity.length, 200);
    emit('activity');
    if (a.auto) env.toast(a.text, a.kind === 'bad' ? 'bad' : 'good');
    if (a.lowBattery) env.toast(a.text, 'bad', { detail: 'Time to charge it.', ms: 9000 });
  });
  let first = null;
  const opened = new Promise((resolve) => { first = resolve; setTimeout(resolve, 3000); });
  onOpen(() => { resync().then(() => first?.()); });
  startEvents();
  await opened;
  if (!Object.keys(devices).length) await resync(); // the stream was slow to open: snapshot anyway
  return true;
}

// ---------- the device operations (local or remote) ----------
export async function connect(id, prompt = false) {
  delete rawCache[id];  // a (re)connected device may have been changed elsewhere
  if (remote) {
    const snap = await rcall('/api/agent/connect', { id });
    applyRemote({ devices: [snap] });
    return devices[id]?.status === 'connected';
  }
  const d = devices[id];
  if (d.status === 'connecting') return false;
  if (d.status === 'connected' || d.status === 'asleep') return true; // already ours: never open a second channel
  lastTry[id] = Date.now();
  set(id, { status: 'connecting', error: null });
  // Under the device lock, so a connect can never run alongside a write or a read on the same device.
  return withDevice(id, async () => {
    try {
      const ok = await d.adapter.connect(prompt);
      if (!ok) { set(id, { status: 'missing' }); return false; }
      // Stay "connecting" until the first full read is done, so no page shows a connected device with empty values.
      await refreshUnlocked(id, { first: true });
      if (devices[id].status === 'connecting') set(id, { status: devices[id].error ? 'error' : 'connected' });
      // fill the backup's raw dump now, in the background, so the first change later is as quick as the rest
      if (!demo && devices[id].status === 'connected' && devices[id].adapter.rawUnaffected && devices[id].adapter.rawBackup) {
        setTimeout(() => withDevice(id, async () => { if (!rawCache[id]) rawCache[id] = { raw: await devices[id].adapter.rawBackup(), at: Date.now() }; }).catch(() => {}), 2000);
      }
      if (prompt || env.agent) log(`${d.adapter.title} connected`, 'good', id);
      return true;
    } catch (e) {
      set(id, { status: e.name === 'NotFoundError' || e.gone ? 'missing' : 'error', error: e.gone ? null : e.message });
      if (prompt && e.name !== 'NotFoundError' && !e.gone) log(`${d.adapter.title}: ${e.message}`, 'bad', id);
      return false;
    }
  });
}
const lastTry = {};
const asleepLook = {};
const fullReadAt = {}, FULL_READ_MS = 10 * 60 * 1000;   // a background look reads only what changes on the device (refreshUnlocked)   // when an asleep device was last asked whether it is back

const isAsleep = (e) => /asleep|out of range|no reply/i.test(e.message);

export function refresh(id, opts) {
  if (remote) return rcall('/api/agent/refresh', { id }).catch(() => {});
  return withDevice(id, () => refreshUnlocked(id, opts));
}

async function refreshUnlocked(id, { quiet, first, full, dpi } = {}) {
  const d = devices[id];
  if (!['connected', 'asleep'].includes(d.status) && !(first && d.status === 'connecting')) return;
  // still asleep? one quick question instead of a whole read (21 Oct 2026: ~25 requests a look)
  if (d.status === 'asleep' && d.adapter.awake && !(await d.adapter.awake())) return;
  try {
    // A background look at a wireless device (waking, the minute check) reads only what can change on the device
    // itself (21 Oct 2026, battery: every request is radio traffic it answers): the mouse's DPI stage, its battery, and
    // the rest as last read. A full read at least every 10 minutes, at connect, and on Re-read.
    const quick = quiet && !first && !full && d.adapter.wakeRead && d.info && Object.keys(d.info).length && Date.now() - (fullReadAt[id] || 0) < FULL_READ_MS;
    const info = quick ? d.info : await d.adapter.info();
    // while the mouse's own DPI announcements are heard (env.dpiEvents, helpers/agent.mjs), the minute check reads only
    // the battery; a press (dpi), a wake and the 10-minute full read still read the mouse
    const values = !quick ? await d.adapter.read() : env.dpiEvents && !dpi && d.status === 'connected' ? d.values : await d.adapter.wakeRead();
    if (!quick) fullReadAt[id] = Date.now();
    const battery = d.adapter.battery ? await d.adapter.battery() : null;
    // Unchanged readings don't redraw the page (keeps sliders and inputs undisturbed).
    const same = d.status === 'connected' && !d.error && JSON.stringify([info, values, battery]) === JSON.stringify([d.info, d.values, d.battery]);
    if (same) { d.readAt = new Date(); return; }
    set(id, { status: 'connected', info, values, battery, error: null, readAt: new Date() });
  } catch (e) {
    if (e.gone) set(id, { status: 'missing', error: null });
    else if (isAsleep(e)) set(id, { status: 'asleep', error: e.message });
    else { set(id, { error: e.message }); if (!quiet) log(`${d.adapter.title}: read failed: ${e.message}`, 'bad', id); }
  }
}

// A change that finishes quickly shows nothing while it runs and only a short "set to" note after; the "working"
// note appears only if it takes longer than 600 ms (a mouse change is ~0.4 s). Failures always show.
function slowToast(msg) {
  let t = null, finished = false;
  const timer = setTimeout(() => { if (!finished) t = env.toast(msg, 'busy', { ms: 0, detail: 'Backing up and writing…' }); }, 600);
  return {
    done(text) { finished = true; clearTimeout(timer); if (t) t.update(text, 'good'); else env.toast(text, 'good', { ms: 1600 }); },
    fail(text, why) { finished = true; clearTimeout(timer); if (t) t.update(text, 'bad', why); else env.toast(text, 'bad', { detail: why }); },
  };
}

// One lock per device: backups and writes from anywhere (pages, profiles, restore, auto-switch) never interleave.
const locks = {};
let inFlight = 0;
function withDevice(id, fn) {
  inFlight++;
  const p = (locks[id] || Promise.resolve()).then(fn, fn).finally(() => { inFlight--; });
  locks[id] = p.catch(() => {});
  return p;
}
export const isBusy = () => inFlight > 0 || remoteBusy > 0;

export const readNow = (id) => (remote ? rcall('/api/agent/read', { id }).then((r) => r.values) : withDevice(id, () => devices[id].adapter.read()));
// A slider was pressed (21 Oct 2026): take the backup now, before it moves, so its first step is not held up by a
// read of the whole device. Nothing when one was taken in the last few seconds; never throws.
export function prepare(id) {
  if (demo) return Promise.resolve();
  if (remote) return rcall('/api/agent/prepare', { id }).catch(() => {});
  const d = devices[id];
  if (!d || d.status !== 'connected' || Date.now() - (lastBackupAt[id] || 0) < BACKUP_REUSE_MS - 2000) return Promise.resolve();
  return withDevice(id, () => backupUnlocked(id, 'before a change')).catch(() => {});
}
export const backupNow = (id, why = 'manual') => (remote ? rcall('/api/agent/backup', { id, why }).then((r) => r.file) : withDevice(id, () => backupUnlocked(id, why)));
// "Check again" for a library driver (22 Oct 2026; helpers/my-devices.mjs recheck): its self-check now, under the
// device's lock, then a full read so the page shows which settings opened
export function recheck(id) {
  if (remote) return rcall('/api/agent/recheck', { id });
  const a = devices[id]?.adapter;
  if (!a?.recheck) return Promise.resolve({ ran: false, why: 'this device has no driver from the device library to check' });
  return withDevice(id, async () => {
    const r = await a.recheck();
    await refreshUnlocked(id, { full: true });
    set(id, { readAt: new Date() });
    return r;
  });
}
// "Turn on settings" for a library driver with no real-device record (safety round 2; helpers/my-devices.mjs turnOn):
// the person's click, kept in its library.json, then its self-check now under the device's lock, then a full read
export function turnOn(id) {
  if (remote) return rcall('/api/agent/turn-on', { id });
  const a = devices[id]?.adapter;
  if (!a?.turnOn) return Promise.resolve({ ran: false, on: false, why: 'this device has no driver from the device library' });
  return withDevice(id, async () => {
    // a built-in slot whose turnOn writes itself (27 Oct 2026, an unlisted VIA keyboard): its backup first, as before any write
    if (a.backupBeforeTurnOn && devices[id].status === 'connected') {
      try { await backupUnlocked(id, 'before Turn on settings'); } catch (e) { return { ran: false, on: false, why: `the backup before the check failed (${e.message}), so nothing was written` }; }
    }
    const r = await a.turnOn();
    await refreshUnlocked(id, { full: true });
    set(id, { readAt: new Date() });
    return r;
  });
}

// The full raw dump (the keyboard's whole keymap and macros: ~2 s) is reused for the next backup while nothing
// could have changed it: written keys the adapter calls raw-unaffected (lighting) leave it valid; any other write,
// a reconnect or 10 minutes drop it, and the next backup dumps the device again.
const rawCache = {};
const RAW_FOR_MS = 60 * 60 * 1000;  // 1 h (19 Oct 2026: after 10 min idle a lighting change waited 2.2 s for the keymap dump)
// Changes made a few seconds apart share the backup taken before the first (21 Oct 2026): it holds every value as it
// was before them, which is what a restore needs, and a re-read of the whole device before each step (0.1-0.5 s) was
// most of the wait a change took. "Back up now", restores and batches still always take their own.
const BACKUP_REUSE_MS = 15000;
const lastBackupAt = {};
// A device's settings for a setup copy kept in OneDrive (22 Oct 2026; helpers/onedrive-setup.mjs): the same shape as
// a backup, from what DeviceHub last read (no new read of the device, no backup file, so the Backups page does not fill
// up); the raw part (keymap, macros) from the last few minutes' cache, else read once. Read-only toward the device.
export function copyFor(id) {
  const d = devices[id];
  if (!d || d.status !== 'connected' || !d.values) return Promise.resolve(null);
  return withDevice(id, async () => {
    let raw;
    if (d.adapter.rawBackup) {
      const c = rawCache[id];
      if (c && Date.now() - c.at < RAW_FOR_MS) raw = c.raw;
      else { raw = await d.adapter.rawBackup(); rawCache[id] = { raw, at: Date.now() }; }
    }
    return { device: id, takenAt: new Date().toISOString(), why: 'setup copy', data: { info: d.info, settings: { ...d.values }, raw } };
  });
}
async function backupUnlocked(id, why) {
  const d = devices[id];
  if (demo) return 'demo (no file written)';
  const values = d.adapter.freshRead?.() || await d.adapter.read();
  let raw;
  if (d.adapter.rawBackup) {
    const c = rawCache[id];
    if (c && Date.now() - c.at < RAW_FOR_MS) raw = c.raw;
    else { raw = await d.adapter.rawBackup(); rawCache[id] = { raw, at: Date.now() }; }
  }
  const r = await env.api('/api/backup', { device: id, takenAt: new Date().toISOString(), why, data: { info: d.info, settings: values, raw } });
  lastBackupAt[id] = Date.now();
  set(id, { values });
  return r.file.split(/[\\/]/).pop();
}

// ---------- changes that wait for a sleeping, switched-off or unplugged device (21 Oct 2026) ----------
// Shawn: "I dont want to have to rely on the devices to be on for the changes to happen". A change made while the
// device cannot take it is kept (id -> key -> { value, label, display, at }; saved to waiting-changes.json by the
// agent, so a restart keeps it), shown on the page as made, and written the normal way (backup, write, read back) the
// moment the device is back. The last change to a setting wins. Only the agent queues: it owns the devices.
const waiting = {};
const waitingValues = (id) => Object.fromEntries(Object.entries(waiting[id] || {}).map(([k, c]) => [k, c.value]));
const waitingList = (id) => Object.entries(waiting[id] || {}).map(([key, c]) => ({ key, label: c.label, display: c.display }));
// errors that mean "not reachable right now", not "refused"
const canWait = (e) => !!e && (e.gone || /asleep|out of range|no reply|did not answer|is it on|not connected/i.test(e.message || ''));
const saveWaiting = () => { try { env.saveWaiting?.(waiting); } catch {} };
export function restoreWaiting(saved) {
  for (const [id, keys] of Object.entries(saved || {})) if (devices[id] && keys && Object.keys(keys).length) { waiting[id] = keys; devices[id].waiting = waitingList(id); }
}
export const waitingFor = (id) => waiting[id] || {};
function queue(id, key, value, { label = key, display = value, noLog } = {}) {
  // changed again: moved to the end, so the changes are applied in the order they were made (31 Oct 2026: a DPI stage
  // picked before the stage count it needs was written first, and refused)
  delete (waiting[id] ||= {})[key];
  waiting[id][key] = { value, label, display: String(display), at: Date.now() };
  saveWaiting();
  const d = devices[id];
  set(id, { values: { ...d.values, [key]: value }, waiting: waitingList(id) });
  if (!noLog) log(`${label} → ${display} (applied when the ${d.adapter.kind.toLowerCase()} is back)`, 'info', id);
  return value;
}
const flushing = {};
async function flushWaiting(id) {
  const d = devices[id];
  if (!waiting[id] || flushing[id] || d.status !== 'connected') return;
  flushing[id] = true;
  try {
    await withDevice(id, async () => {
      if (!(Date.now() - (lastBackupAt[id] || 0) < BACKUP_REUSE_MS)) await backupUnlocked(id, 'before the changes made while it was away');
      for (const [key, c] of Object.entries({ ...waiting[id] })) {
        try {
          await writeUnlocked(id, key, c.value, { label: c.label, display: c.display, silent: true, backedUp: true, noLog: true, quietFail: true, fromQueue: true });
          if (waiting[id]?.[key] === c) delete waiting[id][key];   // a newer change made meanwhile stays waiting
          log(`${c.label} → ${c.display} (made while it was away)`, 'good', id);
        } catch (e) {
          if (canWait(e)) break;                                    // still not reachable: everything stays waiting
          if (waiting[id]?.[key] === c) delete waiting[id][key];
          log(`${c.label} not changed: ${e.message}`, 'bad', id);
        }
      }
    });
  } catch {} finally {
    flushing[id] = false;
    if (waiting[id] && !Object.keys(waiting[id]).length) delete waiting[id];
    saveWaiting();
    set(id, { waiting: waitingList(id) });
  }
}

// ---------- undo (21 Oct 2026): the last changes made on each device's page, newest last, up to 20 ----------
// A change is recorded with the value it replaced; Undo writes that value back the normal way (backup, write, read
// back) and steps back one. Profiles, restores, waiting changes being applied and slider drag steps are not recorded.
const undoStack = {};
const undoTop = (id) => { const s = undoStack[id]; return s?.length ? { label: s[s.length - 1].label, key: s[s.length - 1].key, count: s.length } : null; };
// the value a setting had before a slider drag started (its drag steps change it on the way)
const dragFrom = {};
function beforeOf(id, key, live) {
  const k = `${id} ${key}`, cur = devices[id].values?.[key];
  if (live) { if (!(k in dragFrom)) dragFrom[k] = cur; return undefined; }
  const b = k in dragFrom ? dragFrom[k] : cur; delete dragFrom[k]; return b;
}
function recordUndo(id, key, before, after, label) {
  if (before === undefined || JSON.stringify(before) === JSON.stringify(after)) return;
  const s = (undoStack[id] ||= []);
  // a setting changed again right away (one slider moved twice) keeps the value from before the first change
  const top = s[s.length - 1];
  if (top && top.key === key && Date.now() - top.at < 15000) { top.at = Date.now(); devices[id].undo = undoTop(id); return; }
  s.push({ key, before: JSON.parse(JSON.stringify(before)), label, at: Date.now() });
  if (s.length > 20) s.shift();
  devices[id].undo = undoTop(id);
}
export async function undo(id) {
  if (remote) return rcall('/api/agent/undo', { id });
  const c = undoStack[id]?.pop();
  devices[id].undo = undoTop(id);
  emit(id);
  if (!c) throw new Error('nothing to undo');
  try { await write(id, c.key, c.before, { label: c.label, display: 'as before', noUndo: true, silent: true }); }
  catch (e) { undoStack[id].push(c); devices[id].undo = undoTop(id); emit(id); throw e; }
  return { label: c.label };
}

// The single write path: back up, write ONE setting, read it back. label/display are for messages only.
export async function write(id, key, value, opts = {}) {
  if (!remote) {
    const d = devices[id];
    // asleep or unplugged, with its settings known: the change waits for it (a step while dragging is not kept)
    if (env.agent && !demo && ['asleep', 'missing'].includes(d.status) && Object.keys(d.values || {}).length) {
      if (opts.live) return value;
      const before = beforeOf(id, key, false);
      queue(id, key, value, opts);
      if (!opts.noUndo) { recordUndo(id, key, before, value, opts.label || key); emit(id); }
      return value;
    }
    return withDevice(id, () => writeUnlocked(id, key, value, opts.live ? { ...opts, silent: true, noLog: true } : opts));
  }
  const { label = key, display = value, silent, live } = opts;
  const t = silent || live ? null : slowToast(`${devices[id].adapter.title}: ${label} → ${display}`);
  try {
    // live: a step while a slider is dragged (no message, no log line; the release logs the final value)
    const r = await rcall('/api/agent/write', { id, key, value, label, display: String(display), live: !!live });
    t?.done(r.waiting ? `${label}: applied when the ${devices[id].adapter.kind.toLowerCase()} is back` : `${label} set to ${display}`);
    return r.value;
  } catch (e) { t?.fail(`${label} not changed`, e.message); try { e.shown = true; } catch {} throw e; }
}

// Several writes under one lock and one backup (restore, keyboard color). Each is reported.
export function writeBatch(id, items, why) {
  if (remote) return rcall('/api/agent/batch', { id, items, why });
  // asleep or unplugged: every item waits for it (one log line for the lot)
  const d = devices[id];
  if (env.agent && !demo && ['asleep', 'missing'].includes(d.status) && Object.keys(d.values || {}).length) {
    for (const it of items) queue(id, it.key, it.value, { label: it.label, display: it.display, noLog: true });
    log(`${why}: ${items.length} change${items.length === 1 ? '' : 's'} applied when the ${d.adapter.kind.toLowerCase()} is back`, 'info', id);
    return Promise.resolve({ done: items.length, failed: 0, waiting: true });
  }
  return withDevice(id, async () => {
    await backupUnlocked(id, why);
    let done = 0, failed = 0;
    for (const it of items) {
      try { await writeUnlocked(id, it.key, it.value, { label: it.label, display: it.display, silent: true, backedUp: true }); done++; } catch { failed++; }
    }
    return { done, failed };
  });
}

async function writeUnlocked(id, key, value, { label = key, display = value, silent, backedUp, noLog, quietFail, live, fromQueue, noUndo } = {}) {
  const d = devices[id];
  if (d.status !== 'connected') throw new Error(`${d.adapter.title} is not connected`);
  // what Undo puts back: recorded for a change made on the page (not a batch, a waiting change or a drag step)
  const before = backedUp || fromQueue || noUndo ? undefined : beforeOf(id, key, live);
  const t = silent ? null : slowToast(`${d.adapter.title}: ${label} → ${display}`);
  try {
    if (!backedUp && !(Date.now() - (lastBackupAt[id] || 0) < BACKUP_REUSE_MS)) await backupUnlocked(id, `before ${label}`);
    const confirmed = await d.adapter.write(key, value, live ? { live: true } : undefined);
    if (!d.adapter.rawUnaffected?.(key)) delete rawCache[id];
    d.values = { ...d.values, [key]: confirmed };
    // a change made now replaces one still waiting for this setting (31 Oct 2026: the queue, applied a moment after the
    // device woke, wrote the older value over the newer one)
    if (!fromQueue && waiting[id]?.[key]) { delete waiting[id][key]; if (!Object.keys(waiting[id]).length) delete waiting[id]; saveWaiting(); d.waiting = waitingList(id); }
    if (before !== undefined && !live) recordUndo(id, key, before, confirmed, label);
    emit(id);
    t?.done(`${label} set to ${display}`);
    if (!noLog) log(`${label} → ${display}`, 'good', id);
    return confirmed;
  } catch (e) {
    if (live) { t?.fail(`${label} not changed`, e.message); throw e; }
    // the device went to sleep or was switched off just now: the change waits for it instead of failing
    const willWait = env.agent && !demo && !live && !fromQueue && !quietFail && canWait(e);
    if (!willWait) t?.fail(`${label} not changed`, e.message); else t?.done(`${label}: applied when it is back`);
    // quietFail: a retry that will be tried again (auto-switch waiting for an asleep device) is not logged each time
    if (!quietFail && !willWait) log(`${label} not changed: ${e.message}`, 'bad', id);
    if (e.gone) set(id, { status: 'missing', error: null });
    // fell asleep during the change: marked asleep, so waking is noticed (and what waits is written) at once
    else if (isAsleep(e)) set(id, { status: 'asleep', error: e.message });
    else { try { set(id, { values: await d.adapter.read() }); } catch {} }
    if (willWait) return queue(id, key, value, { label, display, noLog });
    throw e;
  }
}

// Battery refresh every minute; a sleeping or missing device is retried every 5 s, quietly.
// a background check's wait: env.every (the agent sets it: 3x on battery with the battery saver), else as given
const every = (ms) => (env.every ? env.every(ms) : ms);
const repeat = (fn, ms) => { const go = () => { try { fn(); } catch {} setTimeout(go, every(ms)); }; setTimeout(go, every(ms)); };
export function startPolling() {
  if (remote) return; // the agent polls
  // an adapter whose read came back incomplete (Windows audio not ready) asks for a quick re-read
  for (const d of Object.values(devices)) d.adapter.onLate = () => refresh(d.id, { quiet: true });
  loadHistory();
  // (not in the agent: its minute re-read below reads the battery too, inside the device lock; 31 Oct 2026)
  if (!env.agent) repeat(() => {
    for (const d of Object.values(devices)) if (d.status === 'connected' && d.adapter.battery && !d.adapter.pollRead) {
      d.adapter.battery().then((b) => { if (b) set(d.id, { battery: b }); }).catch(() => {});
    }
  }, 60000);
  // Devices whose state lives elsewhere (the headset) are re-read every 60 s; its mic and lights stay live through
  // the light keeper, and a change made here shows at once.
  repeat(() => {
    for (const d of Object.values(devices)) if (d.status === 'connected' && d.adapter.pollRead) refresh(d.id, { quiet: true });
  }, 60000);
  // The keymap copy that lighting backups use is read again every 40 min in the background, while nothing else is
  // going on with the device, so it never runs out (1 h) and a lighting change never waits ~2 s for a fresh read
  // (20 Oct 2026: measured 2,226 ms once). The device lock keeps it from overlapping a change.
  repeat(() => {
    for (const d of Object.values(devices)) {
      if (d.status !== 'connected' || !d.adapter.rawUnaffected || !d.adapter.rawBackup || inFlight > 0) continue;
      const c = rawCache[d.id];
      if (c && Date.now() - c.at < 40 * 60 * 1000) continue;
      withDevice(d.id, async () => { rawCache[d.id] = { raw: await d.adapter.rawBackup(), at: Date.now() }; }).catch(() => {});
    }
  }, 5 * 60 * 1000);
  // Changes waiting for a device that is connected but did not answer (the headset switched off on its receiver):
  // tried again every 5 s, only while something waits. A device coming back from asleep or unplugged is tried at once.
  // (Not while the headset reports itself off: each try would back it up again; it is tried once it is on.)
  if (env.agent) repeat(() => { for (const d of Object.values(devices)) if (waiting[d.id] && d.status === 'connected' && d.values?.headsetOn !== false) flushWaiting(d.id); }, 5000);
  // The agent also re-reads every connected device each minute; that is how it notices an unplugged keyboard.
  if (env.agent) repeat(() => { for (const d of Object.values(devices)) if (d.status === 'connected' && !d.adapter.pollRead) refresh(d.id, { quiet: true }); }, 60000);
  repeat(() => {
    for (const d of Object.values(devices)) {
      // asleep: asked again every 5 s; when the agent hears the mouse wake by itself (env.wakeEvents: the helper
      // passes on its first movement, helpers/agent.mjs), only every 5 minutes, as a fallback (21 Oct 2026)
      if (d.status === 'asleep' && !(env.wakeEvents && d.id === 'mouse' && Date.now() - (asleepLook[d.id] || 0) < 300000)) { asleepLook[d.id] = Date.now(); refresh(d.id, { quiet: true }); }
      if ((d.status === 'missing' || d.status === 'idle') && (d.adapter.autoReconnect || env.agent)) {
        // Looking for a missing mouse or keyboard costs a device scan, so the agent does it every 20 s, not every 5.
        if (env.agent && !d.adapter.pollRead && Date.now() - (lastTry[d.id] || 0) < 20000) continue;
        connect(d.id, false);
      }
    }
  }, 5000);
}

// A driver's error that reached no caller (an unhandled rejection or a throw from its own timer; helpers/driver-guard.js
// catches it so DeviceHub keeps running, 22 Oct 2026): the device is marked asleep for a "no reply" (its next look asks
// again) or in error otherwise (retried every 30 s by the agent), and one Activity line says so.
export function driverFault(id, err) {
  const d = devices[id];
  if (remote || !d) return;
  const msg = String(err?.message || err || 'unknown error').split(/\r?\n/)[0].slice(0, 200);
  if (err?.gone) { markMissing(id); return; }
  if (isAsleep({ message: msg })) { if (d.status !== 'asleep') set(id, { status: 'asleep', error: msg }); return; }
  const was = d.status;
  set(id, { status: 'error', error: msg });
  if (env.agent && was !== 'error') log(`${d.adapter.title}: driver error (${msg}); retrying`, 'bad', id);
}

export function markMissing(id) { delete rawCache[id]; if (!remote && devices[id] && devices[id].status !== 'missing') { set(id, { status: 'missing', error: null }); if (env.agent) log(`${devices[id].adapter.title} unplugged`, 'info', id); } }

// The devices to show: those this PC has had (the agent's seen-devices.json) or has connected now; every device in
// demo mode or without the agent. A PC that has none of them shows none (20 Oct 2026: the Overview then shows the
// first-run screen instead of tiles for devices the person does not own).
const openedAt = Date.now();
// One headset shown once (29 Oct 2026, Shawn: a copy "saying he has two headsets when he doesnt"): the Headset page
// runs any USB headset's Windows sound side (headset-adapter.js generic), and a library or learned driver can run the
// same headset's battery and settings. The driver whose declared USB ids (or connected USB id) include the Headset
// page's headset is its twin: it has no sidebar entry or Overview tile of its own; the Headset page shows its battery
// and settings, and its own page is still there (Open on the Headset page).
const usbOf = (s) => { const m = /VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})/i.exec(s || ''); return m ? `${m[1]}:${m[2]}`.toLowerCase() : null; };
export function headsetTwin() {
  const hs = devices.headset;
  const id = hs?.adapter?.mode === 'generic' ? usbOf(hs.adapter.generic?.usb) : null;
  if (!id) return null;
  return Object.values(devices).find((d) => d.adapter?.plugin && /headset/i.test(d.adapter.kind || '')
    && ((d.adapter.usbIds || []).includes(id) || String(d.adapter.usbId || '').toLowerCase() === id)) || null;
}
export function shownDevices() {
  const twin = headsetTwin();
  const all = Object.values(devices).filter((d) => d !== twin);
  if (demo || !remote) return all;
  // absent: an added driver that found nothing of its own here (helpers/my-devices.mjs isAbsent): never shown
  return all.filter((d) => !d.absent && (d.seen || ['connected', 'asleep'].includes(d.status)));
}
// none of the supported devices found on this PC (yet)
export const noDevicesYet = () => !demo && remote && shownDevices().length === 0;
// the first seconds after the window opens, while the devices are still being connected
export const stillLooking = () => Date.now() - openedAt < 12000;
