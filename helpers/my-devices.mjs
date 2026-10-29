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
//   not this driver's device (22 Oct 2026, docs/handoff/logitech-c539.md): connect() (or a read) that finds the device on
//        its channel is not one it runs (a keyboard on the receiver a mouse driver opened) throws an error with
//        `notMine: true` and lets go of the channel. stepAside() below turns that into "not connected": connect() returns
//        false (status missing, no error, so no problem report), a.notMine = { why, at } for diagnose and Get help, and
//        the next automatic connect waits NOT_MINE_REST_MS (a Connect click or a Windows device change tries at once).
//   asleep at connect: connect() may return true with `asleep = true` when the channel is open but the device behind it
//        does not answer (a receiver whose mouse sleeps); read() then throws an "asleep" error (status asleep) until it
//        answers, and the library self-check waits for a connect where the device answered.
//   batteryCare: { lowBattery: { key, value }, charging: { key, value } }   optional (22 Oct 2026): the one setting
//        DeviceHub may change to save its battery, and to what (helpers/battery-care.mjs; batteryCareProblem below)
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
// Since 22 Oct 2026, safety round 2 (docs/handoff/safety-round2.md): a driver with no real-device record in its
// device.json `tested` (simulation and test-file records do not count), and every driver the learning wizard made,
// installs and READS by itself, but the self-check (its only write by itself) and every write wait until the person
// presses "Turn on settings" for it (turnOn(id): the device page and the Set up card; kept in library.json settingsOn).
// Drivers with a real-device record keep the behaviour above; settings the wizard added to one wait for the click too.
// "Could not check for the maker's app" is waiting, never "not open". No write on any USB id DeviceHub's own drivers
// run, from any id the driver declares (hid, driver.json, device.json).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

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
export const MAKER_CACHE_MS = 15000;  // a maker's-app answer is kept this long before a guarded write asks again
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
  const care = batteryCareProblem(a);
  if (care) return care;
  return null;
}

// batteryCare (22 Oct 2026, optional; helpers/battery-care.mjs, docs/handoff/battery-added-devices.md): which ONE
// setting the low-battery saving and the lights-off-while-charging rule may change, and to what:
//   batteryCare: { lowBattery: { key, value }, charging: { key, value } }   (either or both)
// Without it DeviceHub changes nothing on the device for its battery. The key must be one of its settings that is
// written (not a display), the value one that setting takes, and the driver must have battery(). A driver whose
// settings are listed only once a model connects is checked again before every change.
export const BATTERY_CARE_RULES = ['lowBattery', 'charging'];
export function batteryCareProblem(a) {
  const c = a?.batteryCare;
  if (c === undefined) return null;
  if (!plain(c)) return 'batteryCare must be { lowBattery: { key, value }, charging: { key, value } }';
  const names = Object.keys(c);
  if (!names.length) return 'batteryCare is empty: give lowBattery, charging or both';
  const other = names.find((n) => !BATTERY_CARE_RULES.includes(n));
  if (other) return `batteryCare has "${other}": only lowBattery and charging are known`;
  if (typeof a.battery !== 'function') return 'batteryCare needs battery(): DeviceHub must read the battery to act on it';
  for (const n of names) {
    const r = c[n];
    if (!plain(r) || typeof r.key !== 'string' || !r.key || !('value' in r) || r.value === undefined || Object.keys(r).some((k) => k !== 'key' && k !== 'value')) return `batteryCare.${n} must be { key, value }`;
    let list = [];
    try { list = Array.isArray(a.settings) ? a.settings : []; } catch {}
    const s = list.find((x) => x?.key === r.key);
    if (s && !writable(s)) return `batteryCare.${n}: ${r.key} is a reading, which DeviceHub never writes`;
    if (s && !fits(s, r.value)) return `batteryCare.${n}: ${JSON.stringify(r.value)} is not a value ${r.key} takes`;
  }
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

// is this driver one DeviceHub's own drivers run (a built-in slot or its USB id)? then no self-check and no write, ever.
// Since 22 Oct 2026 (safety round 2) every id the driver declares counts, not only its `hid`: its hid ids, a top-level
// vid / pids (a driver.json), and the vid / pids of the device.json beside it (declared below, from guard()), so a
// driver that talks over another path (corsair-bragi-peripherals, the HS80's own channel) is caught too. ANY overlap
// with pc-map.js RUNS (the HS80's receiver 0a6b, cable 0a69 and 0a71 behind the receiver, the Pulsar 5406 and its
// cable 3506, the P75) counts.
let runsCache = null;
const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
export function runsIds() {
  if (!runsCache) { try { runsCache = Object.keys(createRequire(import.meta.url)('./pc-map.js').RUNS || {}).map((k) => k.toLowerCase()); } catch { runsCache = []; } }
  return runsCache;
}
// the 'vid:pid' ids in this list that DeviceHub's own drivers run ([] = none)
export function ownClash(vid, pids = []) {
  if (vid == null || vid === '') return [];
  const runs = runsIds();
  return [...new Set((pids || []).filter((p) => p != null && p !== '').map((p) => `${hex4(vid)}:${hex4(p)}`))].filter((id) => runs.includes(id));
}
const declared = new WeakMap();   // adapter -> [{ vid, pids }] from its device.json (guard)
export function declaredIds(a) {
  const out = [];
  if (a?.hid?.vid) out.push({ vid: a.hid.vid, pids: [a.hid.pid, a.hid.cablePid, ...(a.hid.pids || []), ...Object.keys(a.hid.byPid || {})] });
  if (a && typeof a.vid === 'string' && Array.isArray(a.pids)) out.push({ vid: a.vid, pids: a.pids });
  for (const d of declared.get(a) || []) out.push(d);
  return out;
}
function ownDevice(a) {
  if (BUILT_IN.includes(a.id)) return true;
  return declaredIds(a).some((d) => ownClash(d.vid, d.pids).length > 0);
}
// the vendor id the driver declares (for DeviceHub's own maker's-app list), or null
const vidOf = (a) => { const d = declaredIds(a)[0]; return d ? hex4(d.vid) : null; };

// Rule 1 (22 Oct 2026, safety round 2): a library driver that never ran on a real device may install and READ by
// itself, but its self-check (the only write DeviceHub makes on its own) runs only after the person presses "Turn on
// settings" for that device. A real-device record is an entry in device.json `tested` that is not a simulation: not
// marked `simulation: true`, and its by / how do not say it was simulated, a test file's, or not tested yet.
const SIMULATED = /simulat|never run on a real|not run on a real|nobody yet|not tested yet|\btests[\\/]/i;
// Final audit (22 Oct 2026): only a record made under status "tested" counts. A record carries the status it was
// shared with (share-device.mjs); an older one without it takes the entry's status. A "read-only" share ("settings
// read, nothing written") never counts, so it cannot skip Turn on settings.
const READ_ONLY_HOW = /nothing written|settings read|read[- ]only/i;
// A "Works on my device" record (22 Oct 2026; helpers/works-report.mjs, helpers/accept-works-reports.mjs,
// docs/handoff/works-reports.md): a person pressed the button after the driver's settings passed DeviceHub's self-check on
// their device, and Shawn's accept script added it. It counts ONLY in exactly this shape: status "tested" written in the
// record itself, real: true, the date, DeviceHub's version, the SHA-256 of the driver it was checked with, the model, the
// firmware (text or null) and the settings that passed (at least one). No other field. When the driver's own SHA-256 is
// known (provenCopy), the record counts only for that exact driver text: a changed driver needs a new report.
export const WORKS_RECORD_FIELDS = ['status', 'real', 'by', 'how', 'date', 'devicehub', 'driver', 'driverSha', 'model', 'firmware', 'settings', 'checked', 'seen', 'issue'];
const SETTING_KEY = /^[A-Za-z0-9_:.-]{1,40}$/;
export function worksRecordProblem(t) {
  if (!plain(t)) return 'it is not an object';
  const extra = Object.keys(t).filter((k) => !WORKS_RECORD_FIELDS.includes(k));
  if (extra.length) return `it has fields a works record never has (${extra.join(', ')})`;
  if (t.real !== true) return 'real must be true';
  if (t.status !== 'tested') return 'its own status must be "tested"';
  if (t.by !== 'works report') return 'by must be "works report"';
  if (typeof t.how !== 'string' || !t.how.trim() || t.how.length > 200) return 'how must say how it was tested';
  if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date))) return 'date must be YYYY-MM-DD';
  if (typeof t.devicehub !== 'string' || !t.devicehub.trim() || t.devicehub.length > 60) return 'devicehub must be the DeviceHub version';
  if (typeof t.driver !== 'string' || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(t.driver)) return 'driver must be the library entry name';
  if (typeof t.driverSha !== 'string' || !/^[0-9a-f]{64}$/.test(t.driverSha)) return "driverSha must be the driver's SHA-256 (64 hex digits)";
  if (typeof t.model !== 'string' || !t.model.trim() || t.model.length > 80) return 'model must name the model';
  if (!(t.firmware === null || (typeof t.firmware === 'string' && t.firmware.trim() && t.firmware.length <= 160))) return 'firmware must be text or null';
  if (!Array.isArray(t.settings) || !t.settings.length || t.settings.length > 60 || !t.settings.every((k) => typeof k === 'string' && SETTING_KEY.test(k)) || new Set(t.settings).size !== t.settings.length) return 'settings must list the settings that passed (at least one)';
  if (!Number.isInteger(t.checked) || t.checked < t.settings.length || t.checked > 60) return 'checked must be how many settings were checked';
  // seen (29 Oct 2026, Test it with me; optional, older reports have none): settings the person saw change, all of them in settings
  if ('seen' in t && (!Array.isArray(t.seen) || !t.seen.length || !t.seen.every((k) => t.settings.includes(k)) || new Set(t.seen).size !== t.seen.length)) return 'seen must list settings that passed (at least one)';
  if (!Number.isInteger(t.issue) || t.issue < 1) return 'issue must be the GitHub issue number';
  return null;
}
const claimsWorks = (t) => 'real' in t || 'driverSha' in t || t.by === 'works report';
export const realRecord = (t, status, driverSha = null) => !!t && typeof t === 'object' && t.simulation !== true && !SIMULATED.test(`${t.by || ''} ${t.how || ''}`)
  && (t.status ?? status ?? 'tested') === 'tested' && !READ_ONLY_HOW.test(String(t.how || ''))
  // a record that claims to be a works record counts only in its full shape, and only for the driver it was made with
  && (!claimsWorks(t) || (worksRecordProblem(t) === null && (!driverSha || t.driverSha === driverSha)));
export const hasRealRecord = (meta, { driverSha = null } = {}) => Array.isArray(meta?.tested) && meta.tested.some((t) => realRecord(t, meta.status, driverSha));
// the SHA-256 a works record names: the driver's text with Windows line ends made plain, so a git checkout with CRLF and
// one with LF give the same answer
export const driverSha = (text) => createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
// the driver file in a folder (device.mjs wins over driver.json, as loadOne loads them) and its SHA-256, or null
export function driverShaOf(folder) {
  for (const f of ['device.mjs', 'driver.json']) {
    try { return driverSha(fs.readFileSync(path.join(folder, f), 'utf8')); } catch {}
  }
  return null;
}
// a my-devices copy: does it keep today's behaviour (a real-device record, not learned on this PC)? A works record
// counts only when this copy's driver is the exact text the record was made with.
export function provenCopy(folder, mark) {
  if (!mark || mark.learned) return false;
  return hasRealRecord(readJson(path.join(folder, 'device.json')), { driverSha: driverShaOf(folder) || 'none' });
}
// is this setting still waiting for the person's Turn on settings? Every setting of a driver without a real-device
// record (or a learned driver) until the click; on a proven driver, only the settings the learning wizard added
// (learnedKeys). Settings learned after the click wait for another one.
export function needsTurnOn(mark, proven, key) {
  const learned = (mark?.learnedKeys || []).includes(key);
  if (proven && !learned) return false;
  const on = mark?.settingsOn?.at;
  if (!on) return true;
  return learned && !!mark.learnedAt && mark.learnedAt > on;
}
export const TURN_ON_LINE = "DeviceHub writes each setting's current value back once to check it.";

// A setting that refuses only because of how the device is set right now (a mouse on its onboard profiles, the maker's
// app open) is WAITING, not failed (22 Oct 2026): the driver throws an error with `waiting: true` (or one that says the
// maker's app "is running: close it"), the self-check records { ran: false, waiting: true, why } and tries it again on a
// later connect. Nothing about the device is changed to make it pass.
export const isWaiting = (e) => !!e && (e.waiting === true || /\bis running\b.*\bclose it\b/i.test(String(e.message || '')));
// how long a failed or waiting setting rests before a connect tries it again by itself (the person's Check again does not wait)
export const RETRY_MS = 24 * 60 * 60 * 1000;

// The maker's app: { app } when one is open, { unknown: why } when it could not be checked, or {} when none is open.
// Since 22 Oct 2026 (safety round 2) "could not check" is never "not open": a driver's vendorApp() that throws or
// times out, or DeviceHub's own list (makerApp, by vendor id) failing, means wait. DeviceHub's list is asked even when
// the driver has its own check, because a driver's check may answer null when its tasklist timed out.
async function makerAppOf(a, makerApp) {
  if (typeof a.vendorApp === 'function') {
    try { const app = await inTime(a.vendorApp(), "checking for the maker's app"); if (app) return { app: String(app) }; } catch (e) { return { unknown: e.message }; }
  }
  const vid = vidOf(a);
  if (typeof makerApp === 'function' && vid) {
    try { const app = await inTime(makerApp(vid), "checking for the maker's app"); if (app) return { app: String(app) }; } catch (e) { return { unknown: e.message }; }
  }
  return {};
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
  const maker = await makerAppOf(a, makerApp);
  if (maker.app) return { ran: false, waiting: true, why: `${maker.app} (the maker's app) is open, so nothing was written; it runs on a later connect once that app is closed` };
  if (maker.unknown) return { ran: false, waiting: true, unknown: true, why: `DeviceHub could not check whether the maker's app is open (${maker.unknown}), so nothing was written; it tries again on a later connect` };
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
    // a setting this model does not have (29 Oct 2026: the Arctis driver knows sidetone, the Nova 3 reports none, and a
    // friend's copy filed "self-check failed"): not in the first read, so not on its page and nothing to check
    if (values?.[s.key] === undefined) { keys[s.key] = { ok: false, skip: true, why: 'this model does not report it', at }; continue; }
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
  // a skipped setting (not to be checked, or one this model does not have) is neither a pass nor a failure
  const checked = todo.filter(writable).filter((s) => !keys[s.key]?.skip);
  const ok = checked.filter((s) => keys[s.key]?.ok).map((s) => s.label);
  const waits = checked.filter((s) => keys[s.key]?.waiting);
  const no = checked.filter((s) => !keys[s.key]?.ok && !keys[s.key]?.waiting);
  const gated = mark.status !== 'tested';
  const text = `${a.title}: library self-check${only ? ' again' : ''}${firmware ? ` (${firmware})` : ''}: ${ok.length} of ${checked.length} setting${checked.length === 1 ? '' : 's'} wrote and read back${ok.length ? ` (${ok.join(', ')})` : ''}`
    + (no.length ? `; ${no.length} ${gated ? 'stay read-only' : 'now read-only'}: ${no.map((s) => `${s.label} (${keys[s.key].why})`).join('; ')}` : '')
    + (waits.length ? `; ${waits.length} waiting, tried again later: ${waits.map((s) => `${s.label} (${keys[s.key].why})`).join('; ')}` : '');
  try { log(text.slice(0, 300), stopped ? 'bad' : no.length ? 'info' : 'good'); } catch {}
  return { ran: true, ...result, counts: { passed: ok.length, checked: checked.length, waiting: waits.length, failed: no.length } };
}

// may this setting be written? { ok, why }. A setting the learning wizard added to a library copy (mark.learnedKeys)
// is gated like a read-only entry's, whatever the entry's status.
export function writeAllowed(mark, verified, key) {
  const v = verified?.keys?.[key];
  if (v && v.ok === false) return { ok: false, why: `its self-check did not pass (${v.why})` };
  if (v?.ok === true) return { ok: true };
  // final audit (22 Oct 2026): no write before THIS setting's check has passed, whatever the entry's status
  if (v?.waiting) return { ok: false, why: `its self-check is waiting: ${v.why}` };
  return { ok: false, why: `this library driver is "${mark.status || 'unknown'}" and the setting has not passed its self-check yet` };
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
    // selfChecked: a self-check that ran, for the automatic problem reports (helpers/auto-report.mjs: a failed setting)
    return { log: (text, kind, id) => core.log(text, kind, id), backup: (body) => env.api('/api/backup', body), makerApp: makerAppByVid,
      // and a learned driver whose settings passed, shared when the person said yes (helpers/driver-share.mjs)
      selfChecked: (a, r) => Promise.all([import('./auto-report.mjs').then((m) => m.selfCheckResult(a, r)).catch(() => {}),
        import('./driver-share.mjs').then((m) => m.afterCheck(a, r)).catch(() => {})]) };
  } catch { return {}; }
}
async function makerAppByVid(vid) {
  const dg = await import('./diagnose.mjs');
  const { execFile } = await import('node:child_process');
  // a tasklist that fails or times out is "could not check" (an error), never "no app open" (safety round 2)
  const out = await new Promise((res, no) => execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 8000 }, (e, so) => (e ? no(new Error(`tasklist did not answer: ${e.message}`)) : res(String(so || '')))));
  if (!out.trim()) throw new Error('tasklist listed nothing');
  const hit = dg.runningMakers(dg.parseTasklist(out)).find((m) => dg.MAKER_APPS[m.key].vids.includes(vid));
  return hit ? hit.name : null;
}

// every guarded library driver loaded in this process, by id: the page's "Check again" (recheck) and "Turn on
// settings" (turnOn) find it here
const guarded = new Map();
// "Check again" (the person's click): the self-check now, for the settings that failed or wait (every setting when none
// has a result), with no daily wait. { ran, why?, ... } as selfCheck answers. The caller holds the device's lock.
export async function recheck(id) {
  const a = guarded.get(id);
  if (!a?.recheck) return { ran: false, why: 'this device has no driver from the device library to check' };
  return a.recheck();
}
// "Turn on settings" (the person's click, rule 1 of safety round 2): kept in its library.json (settingsOn), then the
// self-check runs now for the settings that need it. { ran, on, why?, counts? }. The caller holds the device's lock.
export async function turnOn(id) {
  const a = guarded.get(id);
  if (!a?.turnOn) return { ran: false, on: false, why: 'this device has no driver from the device library' };
  return a.turnOn();
}

// The maker's app for any added driver (profiles, docs/handoff/profiles-added-devices.md): { app } open, { unknown }
// could not check (counts as open), or {} none open. A guarded driver uses its own deps; a person's own driver
// DeviceHub's list by vendor id. Reads only (tasklist).
export async function makerAppNow(a) {
  if (typeof a?.makerAppNow === 'function') return a.makerAppNow();
  return makerAppOf(a, makerAppByVid);
}

// library.json changed in place (temp file, then rename), keeping whatever else is in it (the wizard's learnedKeys)
function saveMark(folder, change) {
  const file = path.join(folder, LIBRARY_FILE), tmp = `${file}.tmp`;
  const cur = readJson(file) || {};
  fs.writeFileSync(tmp, JSON.stringify({ ...cur, ...change }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// wraps a library driver: writes refused unless allowed, the self-check inside connect() (only once the person turned
// its settings on, for a driver with no real-device record), and each setting's hint says whether it is read-only and
// why. Returns the adapter (the same object).
export function guard(a, folder, mark, deps = null) {
  const write = a.write, connect = a.connect;
  const hints = Object.fromEntries(a.settings.map((s) => [s.key, s.hint]));
  let verified = readVerified(folder);
  // a check made before a newer library driver was put in (helpers/library-refresh.mjs) was for the old driver: run it again
  if (mark.updatedFromLibrary?.at && verified.checkedAt && verified.checkedAt < mark.updatedFromLibrary.at) verified = { keys: {} };
  // the ids its device.json declares count for the HS80 / own-device guard (ownDevice), whatever path it talks over
  const meta = readJson(path.join(folder, 'device.json'));
  if (meta?.vid && Array.isArray(meta.pids)) declared.set(a, [{ vid: meta.vid, pids: meta.pids }]);
  const proven = provenCopy(folder, mark);
  const gated = (key) => needsTurnOn(mark, proven, key);
  const anyGated = () => a.settings.some((s) => writable(s) && gated(s.key));
  // a tested entry without a real-device record writes like a read-only one: only what passed its check
  const writeMark = () => (proven || mark.status !== 'tested' ? mark : { ...mark, status: 'read-only' });
  // a driver.json driver (helpers/declarative-driver.mjs) builds its settings list fresh on every read (a getter), so
  // the read-only marks are kept here and laid over each list it builds (22 Oct 2026, the learning wizard)
  const marks = {};
  const own = Object.getOwnPropertyDescriptor(a, 'settings');
  if (own?.get) {
    Object.defineProperty(a, 'settings', { configurable: true, enumerable: true,
      get() { return own.get.call(this).map((s) => (marks[s.key] ? { ...s, hint: marks[s.key].hint, readOnly: !!(s.readOnly || marks[s.key].readOnly) } : s)); } });
  }
  const allowed = (key) => {
    if (ownDevice(a)) return { ok: false, why: "DeviceHub's own driver runs this device, so this library driver never writes to it" };
    if (gated(key)) return { ok: false, why: `its settings are not turned on yet: press Turn on settings (${TURN_ON_LINE})`, gated: true };
    return writeAllowed(writeMark(), verified, key);
  };
  const relabel = () => {
    for (const s of a.settings) {
      // a display is a reading: always read-only, its hint as the driver wrote it
      if (!writable(s)) { s.readOnly = true; marks[s.key] = { hint: hints[s.key], readOnly: true }; continue; }
      const w = allowed(s.key);
      const k = verified.keys?.[s.key];
      const why = ownDevice(a) ? "DeviceHub's own driver runs this device"
        : w.gated ? 'press Turn on settings to change it'
        : k?.ok === false ? `its self-check did not pass (${k.why})`
        : k?.waiting ? `its check is waiting (${k.why}); it is tried again on a later connect`
        : 'checked when the device connects';
      s.hint = w.ok ? hints[s.key] : [hints[s.key], `Read-only: ${why}.`].filter(Boolean).join(' ');
      s.readOnly = !w.ok;
      marks[s.key] = { hint: s.hint, readOnly: s.readOnly };
    }
    a.library.turnOn = !ownDevice(a) && anyGated();
    a.library.proven = proven;
  };
  a.library = { source: mark.source || null, status: mark.status || null, folder: path.basename(folder), proven, turnOn: false, turnOnLine: TURN_ON_LINE, learned: !!mark.learned };
  relabel();
  const depsNow = async () => ({ ...(await agentDeps()), ...(deps || {}) });
  let makerSeen = null;   // { at, m }: the last "no maker's app open" answer (an open app or "could not check" is asked again)
  const makerNow = async () => {
    if (makerSeen && Date.now() - makerSeen.at < MAKER_CACHE_MS) return makerSeen.m;
    const m = await makerAppOf(a, (await depsNow()).makerApp);
    makerSeen = m.unknown || m.app ? null : { at: Date.now(), m };
    return m;
  };
  a.write = async function (key, value) {
    const st = a.settings.find((x) => x.key === key);
    if (st && !writable(st)) throw new Error(`${st.label} is a reading: DeviceHub never writes it`);
    const w = allowed(key);
    if (!w.ok) throw new Error(`${key} is read-only: ${w.why}`);
    // the maker's app before EVERY guarded write (final audit, 22 Oct 2026): the driver's own tasklist may answer "no
    // app" when it failed, so DeviceHub's own list is asked too (makerAppOf). Only "none open" is kept (MAKER_CACHE_MS); an
    // open app or "could not check" is asked again on the next write.
    const m = await makerNow();
    if (m.unknown) throw Object.assign(new Error(`${key} was not written: DeviceHub could not check whether the maker's app is open (${m.unknown}); it checks again on the next change`), { waiting: true });
    if (m.app) throw Object.assign(new Error(`${key} was not written: ${m.app} (the maker's app) is running: close it first`), { waiting: true });
    return write.call(this, key, value);
  };
  // one self-check run: only = the keys to check (null = all); the result laid over what was known. Settings still
  // waiting for Turn on settings are never in it.
  const openKeys = () => a.settings.filter((s) => writable(s) && !gated(s.key)).map((s) => s.key);
  const runCheck = async (only) => {
    const d = await depsNow();
    const version = d.version !== undefined ? d.version : versionAt(folder);
    const { log: say, selfChecked, ...rest } = d;
    const open = openKeys();
    const keys = (only || open).filter((k) => open.includes(k));
    if (!keys.length) return { ran: false, why: 'its settings are not turned on yet: press Turn on settings first' };
    const all = keys.length === a.settings.filter(writable).length;
    const r = await selfCheck(a, write, { folder, mark, ...rest, version, only: only || !all ? keys : null, previous: verified, log: (t, kind) => say?.(t, kind, a.id) });
    makerSeen = null;   // the check just asked; the next write asks again
    try { selfChecked?.(a, r); } catch {}
    // why it did not run, kept on the device for its page and Get help (23 Oct 2026, a friend's Logitech mouse: 9
    // settings "not checked yet" and the report said only "press Check again" while G HUB held it)
    if (r.ran) { verified = r; a.library.notRun = null; } else { a.library.notRun = { why: r.why, waiting: !!r.waiting, at: new Date().toISOString() }; say?.(`${a.title}: library self-check not run: ${r.why}`, 'info', a.id); }
    relabel();
    return r;
  };
  // what a self-check now would do, for the settings that are turned on (checkPlan over just those)
  const planNow = (info) => {
    const d = deps || {};
    const open = openKeys();
    if (!open.length) return null;
    return checkPlan({ settings: a.settings.filter((s) => open.includes(s.key)) }, verified, info, { now: d.now, version: d.version !== undefined ? d.version : versionAt(folder) });
  };
  let saidGated = false;
  a.connect = async function (...args) {
    const ok = await connect.apply(this, args);
    // asleep at connect: nothing to check against yet (a later connect where the device answers runs it)
    if (!ok || ownDevice(a) || a.asleep) return ok;
    try {
      relabel();   // a driver whose settings depend on the model connected (Corsair) lists them only now
      let info = {};
      try { info = (await inTime(a.info(), 'reading its info')) || {}; } catch {}
      const plan = planNow(info);
      if (plan) await runCheck(plan.only);
      if (a.library.turnOn && !saidGated) {
        saidGated = true;
        const d = await depsNow();
        d.log?.(`${a.title}: reads work; its settings stay read-only until you press Turn on settings on its page. ${TURN_ON_LINE}`, 'info', a.id);
      }
    } catch (e) { console.log(`[my-devices] ${a.id}: self-check stopped: ${e.message}`); }
    return ok;
  };
  // the person's "Check again": the failed and waiting settings now (all of them if nothing passed or nothing was
  // checked yet), no daily wait; a setting whose value moved is tried again only here. Never a setting still waiting
  // for Turn on settings.
  a.recheck = async function () {
    if (ownDevice(a)) return { ran: false, why: 'DeviceHub\'s own devices are never self-checked' };
    const turned = openKeys();
    if (!turned.length) return { ran: false, why: 'its settings are not turned on yet: press Turn on settings first' };
    const open = turned.filter((k) => !verified.keys?.[k]?.ok && !verified.keys?.[k]?.skip);
    if (verified.checkedAt && !open.length) return { ran: false, why: 'every setting already passed its check' };
    return runCheck(verified.checkedAt ? open : turned);
  };
  // the person's "Turn on settings": recorded in library.json, then the self-check now for what needs it
  a.turnOn = async function () {
    if (ownDevice(a)) return { ran: false, on: false, why: 'DeviceHub\'s own driver runs this device, so this library driver never writes to it' };
    const at = (deps?.now ? deps.now() : new Date()).toISOString();
    if (anyGated() || !mark.settingsOn?.at) {
      mark.settingsOn = { at };
      try { saveMark(folder, { settingsOn: mark.settingsOn }); } catch (e) { delete mark.settingsOn; relabel(); return { ran: false, on: false, why: `it could not be saved (${e.message}), so nothing was turned on` }; }
      relabel();
      const d = await depsNow();
      d.log?.(`${a.title}: settings turned on. ${TURN_ON_LINE}`, 'info', a.id);
    }
    let info = {};
    try { info = (await inTime(a.info(), 'reading its info')) || {}; } catch {}
    const plan = planNow(info);
    if (!plan) return { ran: false, on: true, why: 'nothing needed checking: the settings already passed their check' };
    return { on: true, ...(await runCheck(plan.only)) };
  };
  // for profiles (docs/handoff/profiles-added-devices.md): the same answer a write gets, asked before writing, and the
  // maker's-app check with the driver's own deps. Neither writes anything.
  a.mayWrite = (key) => allowed(key);
  a.makerAppNow = async () => makerAppOf(a, (await depsNow()).makerApp);
  guarded.set(a.id, a);
  return a;
}

// absent: an added driver that found nothing of its own on this PC (23 Oct 2026, a friend's PC: the Logitech keyboard
// driver on a LIGHTSPEED receiver that holds only a mouse showed a keyboard that does not exist). It stepped aside
// (notMine), or it shows only once found (adapter.onlyIfFound: a shared receiver) and never was. Not connected or asleep
// now. Such a device gets no tile, sidebar entry, Setup row, Turn on settings or report line (public/core/devices.js
// shownDevices, public/core/setup-list.js, helpers/auto-setup.mjs summary, helpers/get-help.mjs, helpers/turn-on-all.mjs).
// strayed (24 Oct 2026, a friend's PC: "the logitech keyboard keeps appearing"): a driver that stepped aside this run
// stays absent until a read of its own succeeds. Its connect() can answer yes on a shared receiver and step aside only
// at the first read, and that yes used to clear notMine for the moment between, so it showed at every start and retry.
export function isAbsent(a, status, wasSeen) {
  if (!a?.plugin) return false;
  if (a.strayed) return true;
  if (['connected', 'asleep'].includes(status)) return false;
  return !!a.notMine || (!!a.onlyIfFound && !wasSeen);
}
// "not this driver's device" (see the header): connect() and read() errors with notMine become a quiet "not connected".
// Returns the adapter (the same object). The rest stops the driver asking a device that is not its own every 20 s.
export const NOT_MINE_REST_MS = 10 * 60 * 1000;
export function stepAside(a, { now = () => Date.now(), log = (t) => console.log(t) } = {}) {
  const connect = a.connect, read = a.read;
  let said = null;
  const note = (e) => {
    a.notMine = { why: String(e.message || e).split(/\r?\n/)[0], at: now() };
    a.strayed = true;
    if (said !== a.notMine.why) { said = a.notMine.why; log(`[my-devices] ${a.id}: not this driver's device: ${a.notMine.why}`); }
  };
  a.connect = async function (prompt, ...rest) {
    if (a.notMine && !prompt && !a.notMine.retry && now() - a.notMine.at < NOT_MINE_REST_MS) return false;
    try {
      const ok = await connect.call(this, prompt, ...rest);
      if (ok) a.notMine = null;
      return ok;
    } catch (e) { if (!e?.notMine) throw e; note(e); return false; }
  };
  a.read = async function (...args) {
    try { const r = await read.apply(this, args); a.strayed = false; return r; } catch (e) { if (e?.notMine) note(e); throw e; }
  };
  // a Windows device change (something plugged in or out) is worth one look at once
  a.notMineRetry = () => { if (a.notMine) a.notMine.retry = true; };
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
// have the drivers been loaded in this process? (helpers/library-refresh.mjs: a driver put in before that loads at once)
export const loadedYet = () => !!last;

// A newer library driver put into a loaded copy (helpers/library-refresh.mjs, 24 Oct 2026) runs only after a restart:
// swapping a loaded driver would drop its open HID channel and its lock mid-use, so it is not done. a.library.newerDriver
// is then the plain line the device page and Get help show (read on each snapshot, the file hash kept for 5 seconds).
export const NEWER_DRIVER_LINE = 'A newer driver is ready. Restart DeviceHub to load it.';
export function loadedDriverChanged(folder, loadedSha) {
  const now = driverShaOf(folder);
  return !!(loadedSha && now && now !== loadedSha);
}
function watchDriverFile(a, folder) {
  if (!a.library) return;
  const loadedSha = driverShaOf(folder);
  let seen = { at: 0, v: null };
  Object.defineProperty(a.library, 'newerDriver', { enumerable: true, configurable: true, get() {
    if (Date.now() - seen.at > 5000) seen = { at: Date.now(), v: loadedDriverChanged(folder, loadedSha) ? NEWER_DRIVER_LINE : null };
    return seen.v;
  } });
}

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
    // a person's own driver (no library.json) is never guarded, so an id DeviceHub's own drivers run refuses it here
    // (final audit, 22 Oct 2026): two drivers on the HS80, the Pulsar or the P75 would fight over it
    if (!mark) {
      const meta = readJson(path.join(folder, 'device.json'));
      const ids = [...declaredIds(a), ...(meta?.vid && Array.isArray(meta.pids) ? [{ vid: meta.vid, pids: meta.pids }] : [])];
      const clash = [...new Set(ids.flatMap((d) => ownClash(d.vid, d.pids)))];
      if (clash.length) return { name, error: `not loaded: ${clash.join(', ')} is a USB id DeviceHub's own driver already runs (the mouse, headset or keyboard page), and two programs driving one device fight` };
    }
    if (mark) { guard(a, folder, mark, deps); watchDriverFile(a, folder); }
    stepAside(a);
    // a brand's model the entry does not list, matched by its protocol (device-library family): its product ids are
    // opened too, and the driver tries them (a.familyPids) after its own
    if (mark?.familyPids?.length && a.hid && Array.isArray(a.hid.pids)) withFamily(a, mark.familyPids);
    for (const s of hidSpecs(a)) addSpec(s);
    register(a);
    loadedByName.set(name, a);
    return mark ? { name, id: a.id, library: mark.status || 'unknown' } : { name, id: a.id };
  } catch (e) { return { name, error: String(e.message || e).split('\n')[0] }; }
}

// ---- family product ids (24 Oct 2026: a brand's new model works without anyone learning it) ----
const loadedByName = new Map();
const hex4u = (p) => String(p).trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
function withFamily(a, pids) {
  const add = pids.map(hex4u).filter((p) => /^[0-9A-F]{4}$/.test(p) && !a.hid.pids.map(hex4u).includes(p));
  a.familyPids = [...new Set([...(a.familyPids || []), ...add])];
  a.hid = { ...a.hid, pids: [...a.hid.pids, ...add] };
  return add;
}
// a family match on a copy already installed (helpers/auto-setup.mjs): kept in its library.json, and when the driver is
// loaded, its channels for the new ids are added and it looks again at once (no restart). Returns the ids added.
export function addFamilyPids(root, name, pids) {
  const folder = path.join(root, 'my-devices', name);
  const mark = libraryMark(folder);
  if (!mark) return [];
  const have = new Set((mark.familyPids || []).map(hex4u));
  const fresh = (pids || []).map(hex4u).filter((p) => /^[0-9A-F]{4}$/.test(p) && !have.has(p));
  if (!fresh.length) return [];
  saveMark(folder, { familyPids: [...have, ...fresh].map((p) => p.toLowerCase()) });
  const a = loadedByName.get(name);
  if (a?.hid && Array.isArray(a.hid.pids) && last?.opts?.addSpec) {
    const added = withFamily(a, fresh);
    const { pids: _p, byPid: _b, ...base } = a.hid;
    for (const pid of added) last.opts.addSpec({ id: a.id, ...base, pid });
    a.notMineRetry?.();
    import('../public/core/devices.js').then((core) => core.connect(a.id, false)).catch(() => {});
  }
  return fresh;
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
