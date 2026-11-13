// Learned settings beside a driver written as code (1 Nov 2026; docs/handoff/learned-extras.md). "A setting is
// missing?" in Learn a device used to stop at a device.mjs driver (Razer, SteelSeries, Corsair, HyperX, Wooting ...):
// learned settings could only be merged into a driver.json. Now they are saved NEXT TO the code driver's my-devices
// copy, as my-devices\<name>\learned.json: a driver.json-format file (docs/DRIVER-FORMAT.md) holding ONLY the learned
// messages, reads, fields and settings. The code driver is never edited.
//
// The rules:
//   - learned.json is checked like any learned driver (declarative-driver validate: the never lists, only template
//     bytes are ever sent, every learned byte seen in the recordings is checked by the wizard before it is saved);
//   - a learned key never shadows one of the code driver's: refused at save in a plain sentence, and dropped at load
//     (logged once) should a newer code driver bring the same key;
//   - one device, one queue: every call of both drivers (connect, read, write, info, battery, rawBackup, the quick
//     reads) goes through ONE queue, so the two never have requests in flight on the device at the same time. A call
//     made from inside a queued call runs at once (no deadlock when a driver calls itself);
//   - the learned driver opens the same device the same way (public/devices/hid.js getDevice -> hid-host's provider,
//     which hands out the one handle per vid/pid/usage page); it never closes it (the code driver owns it);
//   - learned settings are guarded like every library setting (helpers/my-devices.mjs guard: library.json
//     learnedKeys, read-only until Turn on settings, then the self-check), because the wrap happens before the guard;
//   - one USB id (2 Nov 2026): learned.json holds the vid and the one pid it was learned on (learnedOn); a code driver
//     running several ids of one family uses the learned settings only while it is connected to that id (connectedPid);
//     on any other id they are absent, logged once;
//   - learned.json missing, unreadable, refused by validate or for another device: the device runs with its code
//     driver alone and the problem is logged once. A learned read or connect that fails later leaves the code driver's
//     values as they are (logged once per problem).
// Backups: the wizard copies learned.json and library.json to backups\learn-<name>-<time>\ before every save. Share:
// learned.json is never shared as the library driver (share-device ships only device.mjs; driver-share refuses a
// device.mjs folder).
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fromJson, validate } from './declarative-driver.mjs';

export const LEARNED_FILE = 'learned.json';
const MARK_FILE = 'library.json';   // helpers/my-devices.mjs LIBRARY_FILE (not imported: my-devices imports this file)
const up4 = (s) => String(s ?? '').trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
import { readJson } from './safe-write.js';   // a JSON file or a fallback (helpers/safe-write.js)
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const firstLine = (e) => String(e?.message || e).split(/\r?\n/)[0];

// One queue: run(fn) waits for every earlier call to end, then runs fn. A call from inside a queued call (the same
// async chain) runs at once. stats: { inFlight, most } for tests.
export function oneQueue() {
  const inside = new AsyncLocalStorage();
  let tail = Promise.resolve();
  const stats = { inFlight: 0, most: 0, calls: 0 };
  const run = (fn) => {
    if (inside.getStore()) return fn();
    const go = () => inside.run(true, async () => {
      stats.inFlight++; stats.calls++; stats.most = Math.max(stats.most, stats.inFlight);
      try { return await fn(); } finally { stats.inFlight--; }
    });
    const p = tail.then(go, go);
    tail = p.catch(() => {});
    return p;
  };
  run.stats = stats;
  return run;
}

// the code driver's setting keys now (its list may depend on the model connected)
const keysOf = (a) => { try { return (Array.isArray(a.settings) ? a.settings : []).map((s) => s.key); } catch { return []; } };
// the USB vendor id a code driver declares: its hid, else the device.json beside it
function vidOfCode(a, folder) {
  if (a?.vid) return up4(a.vid);
  if (a?.hid?.vid) return up4(a.hid.vid);
  const meta = folder ? readJson(path.join(folder, 'device.json')) : null;
  return meta?.vid ? up4(meta.vid) : null;
}

// Why this learned.json cannot sit beside that code driver, or null. def: the learned file; a: the code driver (or
// { keys, battery, vid } when it is not loaded). Used at save (the wizard) and at load.
export function sideProblem(def, a, { folder = null } = {}) {
  const v = validate(def);
  if (!v.ok) return `${LEARNED_FILE} does not pass DeviceHub's check (${v.problems.slice(0, 2).join('; ')})`;
  const codeKeys = a?.keys || keysOf(a);
  const vid = vidOfCode(a, folder);
  if (vid && up4(def.vid) !== vid) return `${LEARNED_FILE} is for USB vendor ${up4(def.vid)} and its driver for ${vid}, so it is not used`;
  const clash = (def.settings || []).map((s) => s.key).filter((k) => codeKeys.includes(k));
  if (clash.length) return `its driver already has a setting called "${clash[0]}"`;
  const hasBattery = a?.battery === true || typeof a?.battery === 'function';
  if (def.battery && hasBattery) return 'its driver reads the battery already';
  return null;
}

// Wraps a loaded code driver IN PLACE with the learned.json beside it (when there is one). Returns { a, side, keys,
// error }. Called by helpers/my-devices.mjs loadOne before the guard, so the guard and self-check see both drivers.
export function withLearned(a, folder, { log = (t) => console.log(t), make = fromJson } = {}) {
  const file = path.join(folder, LEARNED_FILE);
  if (!fs.existsSync(file)) return { a, side: null, keys: [] };
  const name = path.basename(folder);
  const said = new Set();
  const once = (why) => { if (said.has(why)) return; said.add(why); try { log(`[my-devices] ${name}: ${why}`); } catch {} };
  const def = readJson(file);
  let side = null, why = null, use = null;
  const ownBattery = typeof a.battery === 'function';
  if (!plain(def)) why = `${LEARNED_FILE} could not be read as JSON`;
  else {
    // a learned key equal to a code key at load: that setting is dropped (the code driver wins), the rest kept
    const codeKeys = keysOf(a);
    const shadow = (def.settings || []).map((s) => s.key).filter((k) => codeKeys.includes(k));
    use = shadow.length ? { ...def, settings: def.settings.filter((s) => !shadow.includes(s.key)) } : def;
    if (shadow.length) once(`learned ${shadow.join(', ')} not used: its driver has a setting with that name`);
    why = use.settings?.length || use.battery ? sideProblem(use, a, { folder }) : 'nothing in it is left to use';
    if (!why) { try { side = make(use); } catch (e) { why = firstLine(e); } }
  }
  if (!side) {
    once(`${LEARNED_FILE} not used (${why}); the device runs with its own driver`);
    a.learnedExtras = { file: LEARNED_FILE, keys: [], error: why, ownBattery };
    return { a, side: null, keys: [], error: why };
  }
  combine(a, side, once, { battery: !!def.battery, on: learnedOn(use) });
  a.learnedExtras = { file: LEARNED_FILE, keys: (side.settings || []).map((s) => s.key), error: null, ownBattery, on: learnedOn(use) };
  return { a, side, keys: a.learnedExtras.keys };
}

// The USB id a learned.json was learned on (2 Nov 2026): its vid and its one pid ("1B1C:1C77"; the wizard writes only
// the id it recorded). A code driver can run several ids of one family; the learned bytes were heard on this one only.
export function learnedOn(def) {
  const pid = Array.isArray(def?.pids) && def.pids.length ? def.pids[0] : def?.hid?.pid;
  return def?.vid && pid ? `${up4(def.vid)}:${up4(pid)}` : null;
}
const asHex = (v) => (typeof v === 'number' && Number.isInteger(v) ? v.toString(16) : v);
// the product id the code driver is connected to now, or null when it cannot be told: what it keeps (a few common
// names), else its info()'s "USB id", else its one declared id
export async function connectedPid(a, info = null) {
  for (const v of [a?.connectedPid, a?.dev?.productId, a?.device?.productId, a?.pid, a?.model?.pid]) {
    const s = asHex(v);
    if (s != null && /^(0x)?[0-9a-f]{1,4}$/i.test(String(s).trim())) return up4(s);
  }
  try {
    const i = info ? await info() : null;
    const m = /^\s*[0-9a-f]{4}\s*:\s*([0-9a-f]{4})\s*$/i.exec(String(i?.['USB id'] || ''));
    if (m) return up4(m[1]);
  } catch {}
  const h = a?.hid;
  if (h?.pid && !(h.pids || []).some((p) => up4(p) !== up4(h.pid)) && !Object.keys(h.byPid || {}).length && !(a.familyPids || []).length) return up4(h.pid);
  return null;
}

// the two drivers as one adapter (a, changed in place). on: the "VID:PID" the learned side was learned on; the learned
// settings are used only while the code driver is connected to that id (absent on any other, logged once)
function combine(a, side, once, { battery = false, on = null } = {}) {
  const q = oneQueue();
  a.learnedQueue = q;
  const code = {};
  for (const f of ['connect', 'read', 'write', 'info', 'battery', 'rawBackup', 'wakeRead', 'awake', 'pollRead', 'freshRead', 'close']) if (typeof a[f] === 'function') code[f] = a[f];
  // the settings: the code driver's, then the learned ones whose key it does not have
  const own = Object.getOwnPropertyDescriptor(a, 'settings');
  const codeSettings = own?.get ? () => own.get.call(a) : (() => { const list = a.settings; return () => list; })();
  const codeHas = (key) => { try { return (codeSettings() || []).some((s) => s.key === key); } catch { return false; } };
  // the id check: null until the code driver connects, then true only when it is on the id the settings were learned on
  let pidOk = null;
  const sideList = () => { let l = []; try { l = side.settings || []; } catch {} return l.filter((s) => !codeHas(s.key)); };
  const learned = () => (pidOk === false ? [] : sideList());
  Object.defineProperty(a, 'settings', { configurable: true, enumerable: true, get() { return [...(codeSettings() || []), ...learned()]; } });
  const isLearned = (key) => sideList().some((s) => s.key === key);
  const labelOf = (key) => sideList().find((s) => s.key === key)?.label || key;

  let sideOn = false;
  const checkPid = async () => {
    const [vid] = String(on || '').split(':');
    const now = await connectedPid(a, code.info ? () => code.info.apply(a) : null);
    pidOk = !!on && !!now && `${vid}:${now}` === on;
    if (!pidOk) {
      sideOn = false;
      once(!on ? `${LEARNED_FILE} does not say which USB id it was learned on, so its learned settings are not used`
        : !now ? `its learned settings (learned on ${on}) are not used: DeviceHub cannot tell which USB id its driver is connected to`
        : `its learned settings were learned on ${on} and this is ${vid}:${now}, so they are not used for this device`);
    }
    return pidOk;
  };
  const connectSide = async () => {
    if (pidOk !== true) return false;
    if (sideOn && side.dev) return true;
    try { sideOn = !!(await side.connect(false)); } catch (e) { sideOn = false; once(`its learned settings could not connect (${firstLine(e)}); its own settings work as before`); }
    if (!sideOn) once('its learned settings found no device to talk to; its own settings work as before');
    return sideOn;
  };
  a.connect = (...args) => q(async () => {
    const ok = await code.connect.apply(a, args);
    if (ok && (await checkPid()) && !a.asleep) await connectSide();
    return ok;
  });
  a.read = (...args) => q(async () => {
    const values = await code.read.apply(a, args);
    if (!a.asleep && (sideOn || (await connectSide()))) {
      try {
        const more = await side.read();
        for (const s of learned()) if (more && more[s.key] !== undefined) values[s.key] = more[s.key];
      } catch (e) { once(`its learned settings could not be read (${firstLine(e)})`); }
    }
    return values;
  });
  a.write = (key, value) => q(async () => {
    if (!isLearned(key)) return code.write.call(a, key, value);
    if (pidOk !== true) throw new Error(`${labelOf(key)} was not written: its learned settings are used only on the USB id they were learned on (${on || 'unknown'}), once it is connected`);
    if (!(await connectSide())) throw new Error(`${labelOf(key)} was not written: its learned settings are not connected`);
    return side.write(key, value);
  });
  for (const f of ['info', 'wakeRead', 'awake', 'pollRead', 'freshRead', 'close']) if (code[f]) a[f] = (...args) => q(() => code[f].apply(a, args));
  if (code.battery) a.battery = (...args) => q(() => code.battery.apply(a, args));
  else if (battery) a.battery = () => q(async () => ((sideOn || (await connectSide())) ? side.battery() : null));
  // the raw backup taken before a self-check: the code driver's, with the learned replies beside it
  a.rawBackup = () => q(async () => {
    const raw = code.rawBackup ? await code.rawBackup.apply(a) : undefined;
    let more = null;
    try { if (sideOn) more = await side.rawBackup(); } catch {}
    if (!more) return raw;
    return plain(raw) ? { ...raw, learned: more } : { driver: raw ?? null, learned: more };
  });
}

// Saves learned.json next to a code driver's my-devices copy: learned.json and library.json backed up to backups\
// first, then written (temp file, then rename); library.json gets learnedKeys (so the guard keeps them read-only until
// Turn on settings). Never anywhere but my-devices. codeInfo: { keys, battery, vid } of the code driver.
export function saveLearned(folder, def, keys, codeInfo, { root, now = () => new Date(), on = null } = {}) {
  const dir = path.resolve(folder);
  if (path.dirname(dir) !== path.resolve(root, 'my-devices')) return { ok: false, why: ['Only a driver in my-devices can take learned settings. Pick the device again.'] };
  if (!fs.existsSync(path.join(dir, 'device.mjs'))) return { ok: false, why: ['That folder has no device.mjs driver. Pick the device again.'] };
  const mark = readJson(path.join(dir, MARK_FILE));
  if (!plain(mark)) return { ok: false, why: ['That folder has no driver from the device library. Pick the device again.'] };
  const bad = sideProblem(def, codeInfo);
  if (bad) return { ok: false, why: [`Not added: ${bad}. Skip that setting: the driver has it.`] };
  // the USB id it was learned on is kept in it (its vid and one pid): used only while the driver runs that id
  if (!learnedOn(def) || (def.pids || []).length !== 1 || (on && learnedOn(def) !== on)) return { ok: false, why: [`Not added: these settings were learned on USB ${on || 'another id'}, and ${LEARNED_FILE} holds the settings of one USB id only. Learn them again on this device.`] };
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const back = path.join(root, 'backups', `learn-${path.basename(dir)}-${stamp}`);
  fs.mkdirSync(back, { recursive: true });
  for (const x of [LEARNED_FILE, MARK_FILE]) if (fs.existsSync(path.join(dir, x))) fs.copyFileSync(path.join(dir, x), path.join(back, x), fs.constants.COPYFILE_EXCL);
  const put = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(`${p}.tmp`, text); fs.renameSync(`${p}.tmp`, p); };
  put(LEARNED_FILE, JSON.stringify(def, null, 2) + '\n');
  put(MARK_FILE, JSON.stringify({ ...mark, learnedKeys: [...new Set([...(mark.learnedKeys || []), ...keys])], learnedAt: now().toISOString() }, null, 2) + '\n');
  return { ok: true, name: path.basename(dir), folder: dir, id: mark.id || null, backup: back, file: LEARNED_FILE };
}

// the learned.json already beside a copy, or null
export const readLearned = (folder) => { const d = readJson(path.join(folder, LEARNED_FILE)); return plain(d) ? d : null; };
