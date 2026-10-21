// Device manager: one entry per device, the only path pages use to read or change anything.
// Every write: back up the device's current settings to a file, write ONE setting, re-read it.
//
// It runs in one of three places:
//  - the server's background agent (owns the devices; env.agent = true)
//  - the app window as a client of that agent (useRemote(): every call goes to /api/agent/*)
//  - the app window on its own (demo mode, or WebHID when no agent is running)
import { env } from './env.js';
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
    const text = JSON.stringify(s);
    if (lastSnap[s.id] === text && devices[s.id]) continue;
    lastSnap[s.id] = text;
    const cur = devices[s.id] || (devices[s.id] = { id: s.id });
    Object.assign(cur, { status: s.status, info: s.info, battery: s.battery, values: s.values, error: s.error, readAt: s.readAt, adapter: proxyAdapter(s.adapter), seen: s.seen, waiting: s.waiting || [], undo: s.undo || null });
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
  // between and activity from a DeviceHub restart is picked up.
  let es = new EventSource('/api/agent/events');
  const resync = async () => {
    try {
      const snap = await env.api('/api/agent/state');
      applyRemote(snap);
      activity.length = 0;
      for (const a of snap.activity || []) activity.push({ ...a, at: new Date(a.at) });
      emit('activity');
    } catch {}
  };
  const listen = (src) => {
    src.addEventListener('device', (e) => applyRemote({ devices: [JSON.parse(e.data)] }));
    src.addEventListener('auto', (e) => applyRemote({ auto: JSON.parse(e.data) }));
    src.addEventListener('activity', (e) => {
      const a = JSON.parse(e.data);
      activity.unshift({ ...a, at: new Date(a.at) });
      activity.length = Math.min(activity.length, 200);
      emit('activity');
      if (a.auto) env.toast(a.text, a.kind === 'bad' ? 'bad' : 'good');
      if (a.lowBattery) env.toast(a.text, 'bad', { detail: 'Time to charge it.', ms: 9000 });
    });
  };
  const opened = new Promise((resolve) => { es.onopen = () => { resync().then(resolve); }; setTimeout(resolve, 3000); });
  listen(es);
  // The browser retries a dropped stream by itself, but gives up for good if a retry meets an error answer (a
  // DeviceHub restart caught mid-start); the window then showed a frozen picture (19 Oct 2026: a cable plug showed
  // nothing). Every 5 s: a stream the browser gave up on is replaced, and the full state read again.
  setInterval(() => {
    if (es.readyState !== EventSource.CLOSED) return;
    es = new EventSource('/api/agent/events');
    es.onopen = () => { resync(); };
    listen(es);
  }, 5000);
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

const isAsleep = (e) => /asleep|out of range|no reply/i.test(e.message);

export function refresh(id, opts) {
  if (remote) return rcall('/api/agent/refresh', { id }).catch(() => {});
  return withDevice(id, () => refreshUnlocked(id, opts));
}

async function refreshUnlocked(id, { quiet, first } = {}) {
  const d = devices[id];
  if (!['connected', 'asleep'].includes(d.status) && !(first && d.status === 'connecting')) return;
  try {
    const info = await d.adapter.info();
    const values = await d.adapter.read();
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
  (waiting[id] ||= {})[key] = { value, label, display: String(display), at: Date.now() };
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
  try { await write(id, c.key, c.before, { label: c.label, display: 'as before', noUndo: true }); }
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
  } catch (e) { t?.fail(`${label} not changed`, e.message); throw e; }
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
    const confirmed = await d.adapter.write(key, value);
    if (!d.adapter.rawUnaffected?.(key)) delete rawCache[id];
    d.values = { ...d.values, [key]: confirmed };
    if (before !== undefined && !live) recordUndo(id, key, before, confirmed, label);
    emit(id);
    t?.done(`${label} set to ${display}`);
    if (!noLog) log(`${label} → ${display}`, 'good', id);
    return confirmed;
  } catch (e) {
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
  repeat(() => {
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
      if (d.status === 'asleep') refresh(d.id, { quiet: true });
      if ((d.status === 'missing' || d.status === 'idle') && (d.adapter.autoReconnect || env.agent)) {
        // Looking for a missing mouse or keyboard costs a device scan, so the agent does it every 20 s, not every 5.
        if (env.agent && !d.adapter.pollRead && Date.now() - (lastTry[d.id] || 0) < 20000) continue;
        connect(d.id, false);
      }
    }
  }, 5000);
}

export function markMissing(id) { delete rawCache[id]; if (!remote && devices[id] && devices[id].status !== 'missing') { set(id, { status: 'missing', error: null }); if (env.agent) log(`${devices[id].adapter.title} unplugged`, 'info', id); } }

// The devices to show: those this PC has had (the agent's seen-devices.json) or has connected now; every device in
// demo mode or without the agent. A PC that has none of them shows none (20 Oct 2026: the Overview then shows the
// first-run screen instead of tiles for devices the person does not own).
const openedAt = Date.now();
export function shownDevices() {
  const all = Object.values(devices);
  if (demo || !remote) return all;
  return all.filter((d) => d.seen || ['connected', 'asleep'].includes(d.status));
}
// none of the supported devices found on this PC (yet)
export const noDevicesYet = () => !demo && remote && shownDevices().length === 0;
// the first seconds after the window opens, while the devices are still being connected
export const stillLooking = () => Date.now() - openedAt < 12000;
