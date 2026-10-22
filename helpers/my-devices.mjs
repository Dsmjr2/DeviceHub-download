// Devices added on a PC (21 Oct 2026): each one in its own folder, my-devices\<name>\device.mjs, loaded at start by the
// agent. They are the PC owner's (or their Claude's) files: an update never touches them, so a device added for
// someone keeps working when DeviceHub updates. Folders starting with "_" or "." are skipped; my-devices\_example is
// the worked example (DEVICEHUB_EXAMPLE_DEVICE=1 loads it, for tests). ADD-YOUR-DEVICES.md and CLAUDE.md say how to
// write one.
//
// device.mjs exports one adapter, the same shape as the built-in ones (public/devices/*-adapter.js) plus two things:
//   id, title, kind                  'logi-mouse', 'Logitech G Pro X', 'Mouse' (id: a-z, 0-9, -; not mouse/headset/keyboard)
//   connect(), info(), read(), write(key, value)   read-back confirmed; battery(), rawBackup(), unsupported optional
//   settings: [{ key, label, type: 'slider' | 'toggle' | 'choice' | 'display' | 'color' | 'remap', min, max, step,
//               unit, options: [{ value, label }], zones, buttons, targets, live, hint, selfCheck }]
//               what its page shows (DeviceHub draws the page; no page code is needed);
//               selfCheck: false = never write this one in the library self-check. The kinds (22 Oct 2026, page kinds):
//     slider, toggle, choice   a number in min..max (step), on/off, one of options
//     display  a reading, never written (ChatMix, a sensor name): any number, text, true/false or null, shown with its
//              unit. write() is never called for it; the self-check skips it.
//     color    '#rrggbb' (lowercase); with zones: [{ value, label }], an object { <zone>: '#rrggbb' } with every zone.
//              Written like any setting: one write, then read back.
//     remap    buttons: [{ value, label }] -> targets: [{ value, label }]; the value is an object
//              { <button>: <target> } (the buttons the device reports). The driver lists only documented targets.
//   hid: { vid, pid, page, usage, len, reportId, replyMs, cablePid }   optional: the HID channel DeviceHub opens for
//        it, so connect() can use getDevice() from public/devices/hid.js like the built-in drivers
//        pids: [...] + byPid: { pid: overrides } = one channel per product id (hidSpecs below); the options for
//        choosing and driving a collection (iface, col, lengths, featureOnly, reply 'raw', reportIds, routes,
//        refusals) are in helpers/hid-host.mjs and docs/handoff/hid-core.md
//
// Drivers from the device library (22 Oct 2026; helpers/device-library.mjs, docs/handoff/auto-setup.md): a folder with
// library.json was copied from device-library/ and is loaded GUARDED. A "read-only" (or "untested") entry's writes are
// refused, except settings that passed the self-check; a "tested" entry writes, except settings whose self-check
// failed. The self-check runs inside connect() the first time the device connects, again when its firmware changes
// (info()'s firmware fields) and for a setting that was never checked: for each setting, one at a time, read the
// current value, write that SAME value, read back, and require the same value. Before its first write it takes a backup
// (backups/, the same way every change does). The result is kept in my-devices/<name>/verified.json (date, firmware,
// value written and read back per setting) and one Activity line says what it did. It never runs on the built-in
// slots (mouse, headset, keyboard) or on a USB id DeviceHub's own drivers run (helpers/pc-map.js RUNS).
// Since 22 Oct 2026 (docs/handoff/setup-gaps.md): it does not run while the maker's app is open (driver's vendorApp(),
// else DeviceHub's list by vendor id), and tries again on a later connect; a setting refused only because of the
// device's current mode is "waiting" (isWaiting), not failed; failed and waiting settings are tried again on a connect
// at most once a day each, and at once after a DeviceHub update (checkPlan); a setting whose value moved is tried again
// only on the person's Check again (recheck(id), from the device's "Why isn't it working" panel).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const BUILT_IN = ['mouse', 'headset', 'keyboard'];
const TYPES = ['slider', 'toggle', 'choice', 'display', 'color', 'remap'];
export const KINDS = TYPES;
const HEX = /^#[0-9a-f]{6}$/;
// [{ value, label }] with every value a distinct string: zones, buttons, targets
const named = (l) => Array.isArray(l) && l.length > 0 && l.every((o) => o && typeof o.value === 'string' && o.value && typeof o.label === 'string') && new Set(l.map((o) => o.value)).size === l.length;
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// a display's reading: a number, text, true/false, or null (not known right now)
const reading = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
// is this setting ever written? (a display never is)
export const writable = (s) => s?.type !== 'display';
export const LIBRARY_FILE = 'library.json';
export const VERIFIED_FILE = 'verified.json';
const STEP_MS = 10000;  // one read or write of the self-check; longer = stop, nothing more is written

// what is wrong with one, or null
export function problem(a) {
  if (!a || typeof a !== 'object') return 'device.mjs exports no device';
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(a.id || '')) return 'its id must be 2-31 characters: a-z, 0-9 and -';
  if (BUILT_IN.includes(a.id)) return `the id "${a.id}" is a built-in device's`;
  for (const k of ['title', 'kind']) if (typeof a[k] !== 'string' || !a[k].trim()) return `it needs a ${k}`;
  for (const f of ['connect', 'info', 'read', 'write']) if (typeof a[f] !== 'function') return `it needs ${f}()`;
  if (!Array.isArray(a.settings)) return 'it needs settings: [] (what its page shows)';
  for (const s of a.settings) {
    if (!s || typeof s.key !== 'string' || typeof s.label !== 'string' || !TYPES.includes(s.type)) return `setting ${JSON.stringify(s?.key)}: needs key, label and type (${TYPES.join(', ')})`;
    if (s.type === 'slider' && !(Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min)) return `setting ${s.key}: a slider needs min and max`;
    if (s.type === 'choice' && !(Array.isArray(s.options) && s.options.length)) return `setting ${s.key}: a choice needs options`;
    if (s.type === 'color' && s.zones !== undefined && !named(s.zones)) return `setting ${s.key}: zones must be a list of { value, label } with distinct values`;
    if (s.type === 'remap' && !(named(s.buttons) && named(s.targets))) return `setting ${s.key}: a remap needs buttons and targets, each a list of { value, label } with distinct values`;
  }
  if (a.hid && !(/^[0-9A-F]{4}$/i.test(a.hid.vid || '') && /^[0-9A-F]{4}$/i.test(a.hid.pid || ''))) return 'hid needs vid and pid (4 hex digits each)';
  return null;
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// the library marker (library.json), or null for the person's own driver
export const libraryMark = (folder) => { const m = readJson(path.join(folder, LIBRARY_FILE)); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; };
export const readVerified = (folder) => readJson(path.join(folder, VERIFIED_FILE)) || { keys: {} };
function saveVerified(folder, data) {
  const file = path.join(folder, VERIFIED_FILE), tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// the firmware a driver reports, as one string ("Mouse firmware 3.03, Dongle firmware 2.25"), or null
export function firmwareOf(info) {
  if (!info || typeof info !== 'object') return null;
  const parts = Object.entries(info).filter(([k, v]) => /firmware|^fw\b/i.test(k) && v != null && String(v).trim()).map(([k, v]) => `${k} ${String(v).trim()}`);
  return parts.length ? parts.join(', ') : null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
function inTime(p, what) {
  let t;
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((_, no) => { t = setTimeout(() => no(new Error(`${what} took longer than ${STEP_MS / 1000} s`)), STEP_MS); })]);
}
// is this value one the setting can take? (the self-check never writes a value outside the setting's own range)
export function fits(s, v) {
  if (s.type === 'toggle') return typeof v === 'boolean';
  if (s.type === 'slider') return typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max;
  if (s.type === 'display') return reading(v);
  if (s.type === 'color') {
    if (!s.zones) return typeof v === 'string' && HEX.test(v);
    return plain(v) && Object.keys(v).length === s.zones.length && s.zones.every((z) => typeof v[z.value] === 'string' && HEX.test(v[z.value]));
  }
  if (s.type === 'remap') {
    return plain(v) && Object.keys(v).length > 0 && Object.entries(v).every(([b, t]) => (s.buttons || []).some((x) => x.value === b) && (s.targets || []).some((x) => same(x.value, t)));
  }
  return (s.options || []).some((o) => same(o.value, v));
}

// is this driver one DeviceHub's own drivers run (a built-in slot or its USB id)? then no self-check, ever
let runsCache = null;
function ownDevice(a) {
  if (BUILT_IN.includes(a.id)) return true;
  if (!a.hid) return false;
  if (!runsCache) { try { runsCache = Object.keys(createRequire(import.meta.url)('./pc-map.js').RUNS || {}); } catch { runsCache = []; } }
  const ids = [a.hid.pid, a.hid.cablePid, ...(a.hid.pids || [])].filter(Boolean).map((p) => `${String(a.hid.vid).toLowerCase()}:${String(p).toLowerCase()}`);
  return ids.some((id) => runsCache.includes(id));
}

// A setting that refuses only because of how the device is set right now (a mouse on its onboard profiles, the maker's
// app open) is WAITING, not failed (22 Oct 2026): the driver throws an error with `waiting: true` (or one that says the
// maker's app "is running: close it"), the self-check records { ran: false, waiting: true, why } and tries it again on a
// later connect. Nothing about the device is changed to make it pass.
export const isWaiting = (e) => !!e && (e.waiting === true || /\bis running\b.*\bclose it\b/i.test(String(e.message || '')));
// how long a failed or waiting setting rests before a connect tries it again by itself (the person's Check again does not wait)
export const RETRY_MS = 24 * 60 * 60 * 1000;

// the maker's app the driver (or, for a driver without its own check, DeviceHub's list) says is open, or null
async function makerAppOf(a, makerApp) {
  if (typeof a.vendorApp === 'function') {
    try { const app = await inTime(a.vendorApp(), "checking for the maker's app"); return app ? String(app) : null; } catch { return null; }
  }
  if (typeof makerApp === 'function' && a.hid?.vid) { try { return (await makerApp(String(a.hid.vid).toLowerCase())) || null; } catch {} }
  return null;
}

// The self-check of one library driver (see the top of this file). `write` is the driver's own write (not the guarded
// one). deps: { backup(body) -> any (must succeed before anything is written), log(text, kind), makerApp(vid) -> name|null,
// version (DeviceHub's), only: [keys] (check just these; the rest keep what `previous` says), previous (verified.json) }.
// Returns the verified.json it saved: { checkedAt, firmware, status, source, devicehub, keys: { key: { ok, value?, readBack?,
// why?, at, waiting?, ran? } } }, or { ran: false, why, waiting? } when nothing was written.
export async function selfCheck(a, write, { folder, mark = {}, backup, log = () => {}, now = () => new Date(), makerApp, version = null, only = null, previous = null } = {}) {
  const at = now().toISOString();
  if (ownDevice(a)) return { ran: false, why: 'DeviceHub\'s own devices are never self-checked' };
  if (typeof backup !== 'function') return { ran: false, why: 'no backup could be taken, so nothing was written' };
  // the maker's app open: its writes would fight ours, so nothing is written now; a later connect tries again
  const app = await makerAppOf(a, makerApp);
  if (app) return { ran: false, waiting: true, why: `${app} (the maker's app) is open, so nothing was written; it runs on a later connect once that app is closed` };
  let info = {};
  try { info = (await inTime(a.info(), 'reading its info')) || {}; } catch {}
  const firmware = firmwareOf(info);
  let values;
  try { values = await inTime(a.read(), 'reading it'); } catch (e) { return { ran: false, why: `it could not be read (${e.message})` }; }
  // the backup first (CLAUDE.md: read before any write, back up before the first write of a session)
  try {
    let raw;
    try { raw = a.rawBackup ? await inTime(a.rawBackup(), 'its raw backup') : undefined; } catch {}
    await backup({ device: a.id, takenAt: at, why: 'before the library self-check', data: { settings: values, raw } });
  } catch (e) { return { ran: false, why: `no backup could be taken (${e.message}), so nothing was written` }; }
  const keys = only && previous?.keys ? { ...previous.keys } : {};
  const todo = only ? a.settings.filter((s) => only.includes(s.key)) : a.settings;
  let stopped = null;
  for (const s of todo) {
    if (stopped) { keys[s.key] = { ok: false, why: `not checked: ${stopped}`, at }; continue; }
    if (!writable(s)) continue;   // a display is a reading: never written, so nothing to check
    if (s.selfCheck === false) { keys[s.key] = { ok: false, skip: true, why: 'its driver says it is not to be self-checked', at }; continue; }
    let before;
    try { before = (await inTime(a.read(), 'reading it'))?.[s.key]; } catch (e) { keys[s.key] = { ok: false, why: `reading it failed: ${e.message}`, at }; stopped = 'a read failed'; continue; }
    if (before === undefined) { keys[s.key] = { ok: false, why: 'the device did not report its value', at }; continue; }
    if (!fits(s, before)) { keys[s.key] = { ok: false, value: before, why: `it read ${show(before)}, which is not a value this setting takes, so it was not written`, at }; continue; }
    let returned, writeError = null, wait = false;
    try { returned = await inTime(write.call(a, s.key, before), 'the write'); } catch (e) { writeError = e.message; wait = isWaiting(e); }
    let after;
    try { after = (await inTime(a.read(), 'reading it back'))?.[s.key]; } catch (e) { keys[s.key] = { ok: false, value: before, why: `reading it back failed: ${e.message}`, at }; stopped = 'a read-back failed'; continue; }
    if (!writeError && same(returned, before) && same(after, before)) { keys[s.key] = { ok: true, value: before, readBack: after, at }; continue; }
    // refused only because of how the device is set now, and nothing moved: waiting, tried again later
    if (wait && same(after, before)) { keys[s.key] = { ran: false, waiting: true, value: before, why: writeError, at }; continue; }
    const r = { ok: false, value: before, readBack: after, at, why: writeError ? `writing its own value failed: ${writeError}` : !same(after, before) ? `wrote ${show(before)}, read back ${show(after)}` : `wrote ${show(before)}, the driver confirmed ${show(returned)}` };
    if (!same(after, before)) {
      // it moved: the value read just before goes back once, and nothing else is written
      try { await inTime(write.call(a, s.key, before), 'putting it back'); r.putBack = same((await inTime(a.read(), 'reading it back'))?.[s.key], before); } catch { r.putBack = false; }
      stopped = `${s.label} did not read back${r.putBack ? '' : ' and could not be put back'}`;
    }
    keys[s.key] = r;
  }
  const result = { checkedAt: at, firmware, driver: a.id, status: mark.status || null, source: mark.source || null, devicehub: version || previous?.devicehub || null, keys };
  try { if (folder) saveVerified(folder, result); } catch (e) { result.saveError = e.message; }
  const checked = todo.filter(writable);
  const ok = checked.filter((s) => keys[s.key]?.ok).map((s) => s.label);
  const waits = checked.filter((s) => keys[s.key]?.waiting);
  const no = checked.filter((s) => !keys[s.key]?.ok && !keys[s.key]?.waiting);
  const gated = mark.status !== 'tested';
  const text = `${a.title}: library self-check${only ? ' again' : ''}${firmware ? ` (${firmware})` : ''}: ${ok.length} of ${checked.length} setting${checked.length === 1 ? '' : 's'} wrote and read back${ok.length ? ` (${ok.join(', ')})` : ''}`
    + (no.length ? `; ${no.length} ${gated ? 'stay read-only' : 'now read-only'}: ${no.map((s) => `${s.label} (${keys[s.key].why})`).join('; ')}` : '')
    + (waits.length ? `; ${waits.length} waiting, tried again later: ${waits.map((s) => `${s.label} (${keys[s.key].why})`).join('; ')}` : '');
  try { log(text.slice(0, 300), stopped ? 'bad' : no.length ? 'info' : 'good'); } catch {}
  return { ran: true, ...result };
}

// may this setting be written? { ok, why }. A setting the learning wizard added to a library copy (mark.learnedKeys)
// is gated like a read-only entry's, whatever the entry's status.
export function writeAllowed(mark, verified, key) {
  const v = verified?.keys?.[key];
  if (v && v.ok === false) return { ok: false, why: `its self-check did not pass (${v.why})` };
  if (v?.ok === true) return { ok: true };
  if (v?.waiting) {
    if (mark.status === 'tested' && !(mark.learnedKeys || []).includes(key)) return { ok: true };
    return { ok: false, why: `its self-check is waiting: ${v.why}` };
  }
  if (mark.status === 'tested' && !(mark.learnedKeys || []).includes(key)) return { ok: true };
  return { ok: false, why: `this library driver is "${mark.status || 'unknown'}" and the setting has not passed its self-check yet (it runs when the device connects)` };
}

// a failed or waiting setting that a connect may try again by itself: not one the driver says never to check, and not
// one whose value moved when it was written (that one only on the person's Check again)
const moved = (k) => k.readBack !== undefined && !same(k.readBack, k.value);
const retryable = (k) => !!k && !k.ok && !k.skip && (k.waiting || !moved(k));
// What a self-check now would do: null, or { why, only } (only = just these keys; null = every setting).
// Full: never checked, a setting never checked, other firmware than last time. Just the failed and waiting ones: once
// a day per setting, or at once after a DeviceHub update.
export function checkPlan(a, verified, info, { now = () => new Date(), version = null } = {}) {
  if (!verified?.checkedAt) return { why: 'never checked', only: null };
  if (a.settings.some((s) => writable(s) && !verified.keys?.[s.key])) return { why: 'a setting was never checked', only: null };
  const fw = firmwareOf(info);
  if (fw && verified.firmware && fw !== verified.firmware) return { why: `its firmware changed (${verified.firmware} -> ${fw})`, only: null };
  if (fw && !verified.firmware) return { why: 'its firmware is known now', only: null };
  const again = a.settings.filter((s) => writable(s) && retryable(verified.keys?.[s.key]));
  if (!again.length) return null;
  const updated = !!version && verified.devicehub !== version;
  const t = now().getTime();
  const due = again.filter((s) => updated || !(t - Date.parse(verified.keys[s.key].at || verified.checkedAt) < RETRY_MS));
  if (!due.length) return null;
  return { why: updated ? `DeviceHub was updated (${verified.devicehub || 'unknown'} -> ${version})` : `${due.length === 1 ? 'a setting' : 'settings'} that failed or waited, tried again after a day`, only: due.map((s) => s.key) };
}
// does it need a self-check now? the reason, or null
export const needsCheck = (a, verified, info, opts) => checkPlan(a, verified, info, opts)?.why ?? null;

// DeviceHub's own version, read where its files are (a my-devices folder's root): release.json's commit, else package.json's
function versionAt(folder) {
  const root = path.resolve(folder, '..', '..');
  const r = readJson(path.join(root, 'release.json'));
  if (r?.commit) return String(r.commit);
  const p = readJson(path.join(root, 'package.json'));
  return p?.version ? String(p.version) : null;
}

// what the agent gives the self-check: the core's Activity log, its backup route (the same as every change), and the
// makers' apps DeviceHub knows (helpers/diagnose.mjs), for a driver without its own check
async function agentDeps() {
  try {
    const [{ env }, core] = await Promise.all([import('../public/core/env.js'), import('../public/core/devices.js')]);
    if (!env.agent || !env.api) return {};
    return { log: (text, kind, id) => core.log(text, kind, id), backup: (body) => env.api('/api/backup', body), makerApp: makerAppByVid };
  } catch { return {}; }
}
async function makerAppByVid(vid) {
  const dg = await import('./diagnose.mjs');
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 }, (e, so) => res(e ? '' : String(so || ''))));
  const hit = dg.runningMakers(dg.parseTasklist(out)).find((m) => dg.MAKER_APPS[m.key].vids.includes(vid));
  return hit ? hit.name : null;
}

// every guarded library driver loaded in this process, by id: the page's "Check again" (recheck) finds it here
const guarded = new Map();
// "Check again" (the person's click): the self-check now, for the settings that failed or wait (every setting when none
// has a result), with no daily wait. { ran, why?, ... } as selfCheck answers. The caller holds the device's lock.
export async function recheck(id) {
  const a = guarded.get(id);
  if (!a?.recheck) return { ran: false, why: 'this device has no driver from the device library to check' };
  return a.recheck();
}

// wraps a library driver: writes refused unless allowed, the self-check inside connect(), and each setting's hint says
// whether it is read-only and why. Returns the adapter (the same object).
export function guard(a, folder, mark, deps = null) {
  const write = a.write, connect = a.connect;
  const hints = Object.fromEntries(a.settings.map((s) => [s.key, s.hint]));
  let verified = readVerified(folder);
  // a driver.json driver (helpers/declarative-driver.mjs) builds its settings list fresh on every read (a getter), so
  // the read-only marks are kept here and laid over each list it builds (22 Oct 2026, the learning wizard)
  const marks = {};
  const own = Object.getOwnPropertyDescriptor(a, 'settings');
  if (own?.get) {
    Object.defineProperty(a, 'settings', { configurable: true, enumerable: true,
      get() { return own.get.call(this).map((s) => (marks[s.key] ? { ...s, hint: marks[s.key].hint, readOnly: !!(s.readOnly || marks[s.key].readOnly) } : s)); } });
  }
  const relabel = () => {
    for (const s of a.settings) {
      // a display is a reading: always read-only, its hint as the driver wrote it
      if (!writable(s)) { s.readOnly = true; marks[s.key] = { hint: hints[s.key], readOnly: true }; continue; }
      const w = writeAllowed(mark, verified, s.key);
      const k = verified.keys?.[s.key];
      s.hint = w.ok ? hints[s.key] : [hints[s.key], `Read-only: ${k?.ok === false ? `its self-check did not pass (${k.why})` : k?.waiting ? `its check is waiting (${k.why}); it is tried again on a later connect` : 'checked when the device connects'}.`].filter(Boolean).join(' ');
      s.readOnly = !w.ok;
      marks[s.key] = { hint: s.hint, readOnly: s.readOnly };
    }
  };
  relabel();
  a.library = { source: mark.source || null, status: mark.status || null, folder: path.basename(folder) };
  a.write = async function (key, value) {
    const st = a.settings.find((x) => x.key === key);
    if (st && !writable(st)) throw new Error(`${st.label} is a reading: DeviceHub never writes it`);
    const w = writeAllowed(mark, verified, key);
    if (!w.ok) throw new Error(`${key} is read-only: ${w.why}`);
    return write.call(this, key, value);
  };
  // one self-check run: only = the keys to check (null = all); the result laid over what was known
  const runCheck = async (only) => {
    const d = { ...(await agentDeps()), ...(deps || {}) };
    const version = d.version !== undefined ? d.version : versionAt(folder);
    const { log: say, ...rest } = d;
    const r = await selfCheck(a, write, { folder, mark, ...rest, version, only, previous: verified, log: (t, kind) => say?.(t, kind, a.id) });
    if (r.ran) verified = r; else say?.(`${a.title}: library self-check not run: ${r.why}`, 'info', a.id);
    relabel();
    return r;
  };
  a.connect = async function (...args) {
    const ok = await connect.apply(this, args);
    if (!ok || ownDevice(a)) return ok;
    try {
      let info = {};
      try { info = (await inTime(a.info(), 'reading its info')) || {}; } catch {}
      const d = deps || {};
      const plan = checkPlan(a, verified, info, { now: d.now, version: d.version !== undefined ? d.version : versionAt(folder) });
      if (plan) await runCheck(plan.only);
    } catch (e) { console.log(`[my-devices] ${a.id}: self-check stopped: ${e.message}`); }
    return ok;
  };
  // the person's "Check again": the failed and waiting settings now (all of them if nothing passed or nothing was
  // checked yet), no daily wait; a setting whose value moved is tried again only here
  a.recheck = async function () {
    if (ownDevice(a)) return { ran: false, why: 'DeviceHub\'s own devices are never self-checked' };
    const open = a.settings.filter((s) => writable(s) && !verified.keys?.[s.key]?.ok && !verified.keys?.[s.key]?.skip).map((s) => s.key);
    if (verified.checkedAt && !open.length) return { ran: false, why: 'every setting already passed its check' };
    return runCheck(verified.checkedAt ? open : null);
  };
  guarded.set(a.id, a);
  return a;
}

// The HID channels a driver's `hid` asks for (22 Oct 2026): without `pids`, the one channel it always was
// ({ id, ...hid }); with `pids: [...]`, one per product id (hid.pid first, each id once), each with that id's overrides
// from `byPid: { '<PID>': { iface, col, page, usage, len, reportId, ... } }` (helpers/hid-host.mjs channelOpts).
export function hidSpecs(a) {
  const h = a?.hid;
  if (!h) return [];
  if (!Array.isArray(h.pids) || !h.pids.length) return [{ id: a.id, ...h }];
  const up = (p) => String(p).trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
  const { pids, byPid, ...base } = h;
  const over = Object.fromEntries(Object.entries(byPid || {}).map(([k, v]) => [up(k), v || {}]));
  return [...new Set([h.pid, ...pids].filter((p) => p != null && p !== '').map(up))].map((pid) => ({ id: a.id, ...base, ...(over[pid] || {}), pid }));
}

// the last load()'s callbacks, so a driver installed while DeviceHub runs can be loaded without a restart (loadNew)
let last = null;

async function loadOne(dir, name, { register, addSpec, taken, selfCheck: deps }) {
  const folder = path.join(dir, name);
  const file = path.join(folder, 'device.mjs');
  const data = path.join(folder, 'driver.json');
  const coded = fs.existsSync(file);
  if (!coded && !fs.existsSync(data)) return { name, error: 'no device.mjs or driver.json in it' };
  try {
    // device.mjs wins when both are there; a driver.json alone is checked (validate) and refused with its reasons
    const a = coded ? (await import(pathToFileURL(file).href)).default : (await import('./declarative-driver.mjs')).fromJson(data);
    const why = problem(a) || (taken(a.id) ? `the id "${a.id}" is already used` : null);
    if (why) return { name, error: why };
    a.plugin = name;
    const mark = libraryMark(folder);
    if (mark) guard(a, folder, mark, deps);
    for (const s of hidSpecs(a)) addSpec(s);
    register(a);
    return mark ? { name, id: a.id, library: mark.status || 'unknown' } : { name, id: a.id };
  } catch (e) { return { name, error: String(e.message || e).split('\n')[0] }; }
}

const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };
const skipped = (name) => /^[_.]/.test(name) && !(/^_example(-[a-z0-9-]+)?$/.test(name) && process.env.DEVICEHUB_EXAMPLE_DEVICE === '1');  // _example-*: the device library's example, installed

// loads every device folder; returns [{ name, id?, library?, error? }] for the log.
// opts.selfCheck: { backup, log } for library drivers (the agent's own are used when left out)
export async function load(root, opts) {
  const dir = path.join(root, 'my-devices');
  last = { root, opts, seen: new Set() };
  const out = [];
  for (const name of folders(dir)) {
    if (skipped(name)) continue;
    last.seen.add(name);
    out.push(await loadOne(dir, name, opts));
  }
  return out;
}

// folders added since load() (a library install while DeviceHub runs): loaded the same way, then connected through
// opts.connect(id) (the agent's core.connect when left out). null = load() has not run in this process: restart.
export async function loadNew(root = last?.root, { connect } = {}) {
  if (!last || path.resolve(root) !== path.resolve(last.root)) return null;
  const dir = path.join(root, 'my-devices');
  const out = [];
  for (const name of folders(dir)) {
    if (skipped(name) || last.seen.has(name)) continue;
    last.seen.add(name);
    const r = await loadOne(dir, name, last.opts);
    out.push(r);
    if (r.id) {
      try {
        const go = connect || (await import('../public/core/devices.js')).connect;
        Promise.resolve(go(r.id, false)).catch(() => {});
      } catch {}
    }
  }
  return out;
}
