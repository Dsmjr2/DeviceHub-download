// The PC's whole device picture, in every Get help report (24 Oct 2026, docs/handoff/smoother-for-friends.md). A
// friend's reports came one area at a time (the mouse, then Learn, then the lights), and each answer needed the next
// report. Every Get help report (helpers/get-help.mjs, every area) now carries, read-only:
//   - every USB device by vid:pid and Windows' name, with its HID usages where pc-map has them (mouse / keyboard)
//   - the Bluetooth devices (only the kind of product each name says, never the name: names are often the person's)
//   - which driver claimed each device (built in, a library or learned driver, and its state), or none and why
//   - the makers' apps running and installed
//   - the library drivers in use: the version this PC runs, the one shipped with DeviceHub and the one in
//     library-cache, so an old driver shows at once; and the last library check
//   - Windows' permission boxes declined or not answered lately (helpers/uac.mjs)
//   - the last 20 lines of DeviceHub's log about devices
// gather(deps) -> the facts; lines(pic, level) -> the report's lines at a trim level (LEVELS: higher drops more, the
// least useful first). Nothing here opens a device or changes anything.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const within = (p, ms) => { let t; return Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t)); };
const h4 = (x) => String(x ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
export const LOG_LINES = 20;
// a log line about devices (the drivers, connects, the library, Windows' prompts, the helper)
export const DEVICE_LOG = /\[(my-devices|agent|library|setup|keyboard|mouse|headset|hid|helper|uac|report|launcher)\]|Device library|self-check|connected|unplugged|driver|stepped aside|not this driver|asleep|turn on settings/i;

const PRODUCT = /\b(xbox|dualsense|dualshock|wireless controller|pro controller|joy-?con|airpods|galaxy buds|buds|logitech|mx (?:master|anywhere|keys)|razer|corsair|hyperx|steelseries|sony|wh-|wf-|jbl|bose|beats|keyboard|mouse|headset|headphones|speaker|soundbar|controller|gamepad|pen|trackpad|earbuds)\b/i;
// only the kind of product it names is kept ("a Bluetooth controller"), never the name itself: a product name can carry
// the person's own words ("Zorb Buds Pro")
export function btName(n) {
  const m = PRODUCT.exec(String(n || ''));
  if (!m) return 'a Bluetooth device';
  const k = m[1].toLowerCase();
  const NAMED = { xbox: 'Xbox', dualsense: 'DualSense', dualshock: 'DualShock', airpods: 'AirPods', 'galaxy buds': 'Galaxy Buds', logitech: 'Logitech', razer: 'Razer', corsair: 'Corsair', hyperx: 'HyperX', steelseries: 'SteelSeries', sony: 'Sony', jbl: 'JBL', bose: 'Bose', beats: 'Beats' };
  return NAMED[k] ? `a Bluetooth device (${NAMED[k]})` : `a Bluetooth ${k.replace(/-$/, '')}`;
}

// which ids a my-devices folder's driver declares: device.json vid/pids, else driver.json hid
function idsOfFolder(dir) {
  const ids = new Set();
  const meta = readJson(path.join(dir, 'device.json'));
  if (meta?.vid && Array.isArray(meta.pids)) for (const p of meta.pids) ids.add(`${h4(meta.vid)}:${h4(p)}`);
  const def = readJson(path.join(dir, 'driver.json'));
  if (def?.vid) for (const p of [].concat(def.pids || def.pid || [])) ids.add(`${h4(def.vid)}:${h4(p)}`);
  return ids;
}

// the library drivers in use: [{ name, inUse, shipped, cache, newest, old, waitsRestart, learned }]
export async function libraryVersions(root = ROOT, state = null) {
  const out = [];
  let entryVersion = () => '';
  try { entryVersion = (await import('./library-updates.mjs')).entryVersion; } catch {}
  let names = [];
  try { names = fs.readdirSync(path.join(root, 'my-devices'), { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[_.]/.test(e.name)).map((e) => e.name).sort(); } catch {}
  for (const name of names) {
    const dir = path.join(root, 'my-devices', name);
    const mark = readJson(path.join(dir, 'library.json'));
    if (!mark) continue;
    const v = (f) => { const m = readJson(f); return m ? entryVersion(m) || 'undated' : null; };
    const inUse = v(path.join(dir, 'device.json'));
    const shipped = v(path.join(root, 'device-library', mark.name || name, 'device.json'));
    const cache = v(path.join(root, 'library-cache', mark.name || name, 'device.json'));
    const newest = [shipped, cache].filter((x) => x && x !== 'undated').sort().at(-1) || null;
    const snap = (state?.devices || []).find((d) => d.adapter?.plugin === name);
    out.push({ name, inUse, shipped, cache, newest, old: !!(newest && inUse && newest > inUse && !mark.learned && !(mark.learnedKeys || []).length), waitsRestart: !!snap?.adapter?.library?.newerDriver, learned: !!mark.learned, updated: mark.updatedFromLibrary || null });
  }
  return out;
}

// the makers' apps: { running: [names], installed: [names] } (learn-apps MAKERS, diagnose MAKER_APPS; read-only)
async function makerApps() {
  const [{ MAKERS }, dg] = await Promise.all([import('./learn-apps.mjs'), import('./diagnose.mjs')]);
  const { execFile } = await import('node:child_process');
  const run = (file, args, ms) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: ms, maxBuffer: 4 * 1024 * 1024 }, (e, o) => resolve(String(o || ''))));
  const [tl, un] = await Promise.all([
    run('tasklist', ['/fo', 'csv', '/nh'], 10000),
    run('powershell.exe', ['-NoProfile', '-Command', "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | ForEach-Object { $_.DisplayName } | Where-Object { $_ }"], 20000),
  ]);
  const running = dg.runningMakers(dg.parseTasklist(tl)).map((m) => m.name);
  const names = un.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const installed = MAKERS.filter((m) => m.uninstall && names.some((n) => m.uninstall.test(n))).map((m) => m.name);
  return { running, installed };
}

export async function gather(deps = {}) {
  const root = deps.root || ROOT;
  const pcMap = () => require('./pc-map.js');
  const [usb, bt, makers, state, lastCheck] = await Promise.all([
    within(deps.usb ? deps.usb() : pcMap().get(false).then((pc) => pc.usb), 45000),
    within(deps.bluetooth ? deps.bluetooth() : pcMap().bluetooth(false), 30000),
    within(deps.makers ? deps.makers() : makerApps(), 25000),
    deps.statePic ? deps.statePic : within(deps.state ? deps.state() : deps.get ? deps.get('/api/agent/state') : null, 10000),
    Promise.resolve().then(() => readJson(path.join(root, 'library-cache', 'state.json'))),
  ]);
  const devs = (state?.devices || []).filter((d) => d.adapter);
  // what each driver claims: built-in slots by pc-map RUNS, added ones by their folder's ids (and their usbId)
  let runs = {};
  try { runs = pcMap().RUNS || {}; } catch {}
  const slotOf = (page) => (/^Mouse/.test(page) ? 'mouse' : /^Headset/.test(page) ? 'headset' : /^Keyboard/.test(page) ? 'keyboard' : null);
  const claims = new Map();   // id -> [{ driver, status, why }]
  const add = (id, c) => { if (!claims.has(id)) claims.set(id, []); claims.get(id).push(c); };
  for (const [id, page] of Object.entries(runs)) {
    const slot = slotOf(page);
    const d = slot ? devs.find((x) => x.id === slot) : null;
    add(id, { driver: `DeviceHub's own (${page})`, status: d?.status || null });
  }
  for (const d of devs) {
    const a = d.adapter;
    // a driver that stepped aside (found nothing of its own: a keyboard driver on a receiver with only a mouse) is not a
    // claim on the device; the driver that runs it is (31 Oct 2026, support #26)
    if (!a.plugin || d.absent) continue;
    const ids = idsOfFolder(path.join(root, 'my-devices', a.plugin));
    if (a.usbId) ids.add(String(a.usbId).toLowerCase());
    const mark = readJson(path.join(root, 'my-devices', a.plugin, 'library.json'));
    const kind = !mark ? 'added by hand' : mark.learned ? 'learned on this PC' : `library ${mark.status || ''}`.trim();
    for (const id of ids) add(id, { driver: `${a.plugin} (${kind})`, status: d.status, why: a.notMine || (d.absent ? 'found nothing of its own' : null) || d.error || null, turnOn: !!a.library?.turnOn, notRun: a.library?.notRun?.why || null });
  }
  let library = [];
  try { library = (await import('./device-library.mjs')).match((usb || []).map((u) => ({ vid: u.vid || String(u.id).split(':')[0], pid: u.pid || String(u.id).split(':')[1], name: u.name })), { root, readOnly: true, untested: true }); } catch {}
  const libFor = (id) => library.find((m) => m.matched.some((u) => `${u.vid}:${u.pid}` === id));
  const usbOut = (usb || []).map((u) => {
    const id = String(u.id || `${u.vid}:${u.pid}`).toLowerCase();
    const c = claims.get(id) || [];
    const lib = libFor(id);
    const none = c.length ? null : lib ? `a library driver (${lib.name}, ${lib.meta.status}) is there but not installed: ${lib.why || 'not installed yet'}` : 'no driver for it in DeviceHub\'s library';
    return { id, name: u.name || null, usages: [u.usages?.mouse ? 'mouse' : null, u.usages?.keyboard ? 'keyboard' : null].filter(Boolean), claims: c, none };
  });
  let uacRecent = [];
  try { uacRecent = (await import('./uac.mjs')).recent({ root: deps.uacRoot || undefined, n: 5 }); } catch {}
  const log = (deps.logLines || []).map((l) => String(l).trimEnd()).filter((l) => l && DEVICE_LOG.test(l)).slice(-LOG_LINES);
  return {
    usb: usb ? usbOut : null,
    bluetooth: Array.isArray(bt) ? bt.map((b) => ({ name: btName(b.name), connected: !!b.connected, battery: b.battery ?? b.percent ?? null, le: !!b.le })) : null,
    makers: makers || null,
    library: await libraryVersions(root, state),
    libraryCheck: lastCheck ? { at: lastCheck.lastCheckAt || null, reason: lastCheck.lastReason || null, ok: !(lastCheck.errors || []).length, error: (lastCheck.errors || [])[0] || null, bundle: lastCheck.bundleBuiltAt || null } : null,
    uac: uacRecent,
    log,
  };
}

// trim levels, least useful first: 0 all; 1 device log to 10 lines; 2 USB devices with no driver and no mouse/keyboard
// usage as one count; 3 Bluetooth as one count; 4 installed-only makers' apps as one count; 5 no device log; 6 only
// the USB devices a driver claims
export const LEVELS = 6;
const short = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
export function lines(pic, level = 0) {
  if (!pic) return [];
  const L = [];
  if (pic.usb) {
    const shown = [], folded = [];
    for (const u of pic.usb) {
      const plain = !u.claims.length && !u.usages.length;
      if ((level >= 2 && plain) || (level >= 6 && !u.claims.length)) { folded.push(u); continue; }
      const who = u.claims.length ? u.claims.map((c) => `${c.driver}${c.status ? `, ${c.status}` : ''}${c.turnOn ? ', settings not turned on' : ''}${c.notRun ? `, check not run: ${short(c.notRun, 80)}` : ''}${c.why ? `: ${short(c.why, 100)}` : ''}`).join('; ') : `none (${u.none})`;
      shown.push(`- ${u.id} ${u.name || 'no name'}${u.usages.length ? ` [${u.usages.join(', ')}]` : ''}: ${who}`);
    }
    L.push(`- USB devices: ${pic.usb.length}`, ...shown.map((x) => `  ${x}`));
    if (folded.length) L.push(`  - and ${folded.length} more with no driver${level >= 6 ? '' : ' and no mouse or keyboard interface'} (hubs, storage, audio, cameras…)`);
  } else L.push('- USB devices: the list could not be read');
  if (pic.bluetooth) {
    if (level >= 3 || !pic.bluetooth.length) L.push(`- Bluetooth: ${pic.bluetooth.length} paired, ${pic.bluetooth.filter((b) => b.connected).length} connected`);
    else L.push(`- Bluetooth: ${pic.bluetooth.length} paired`, ...pic.bluetooth.map((b) => `  - ${b.name}${b.le ? ' (LE)' : ''}: ${b.connected ? 'connected' : 'not connected'}${b.battery != null ? `, battery ${b.battery}%` : ''}`));
  } else L.push('- Bluetooth: the list could not be read');
  if (pic.makers) {
    const onlyInstalled = pic.makers.installed.filter((n) => !pic.makers.running.includes(n));
    L.push(`- Makers' apps running: ${pic.makers.running.length ? pic.makers.running.join(', ') : 'none'}`);
    L.push(`- Makers' apps installed: ${level >= 4 ? `${pic.makers.installed.length}` : pic.makers.installed.length ? pic.makers.installed.join(', ') : 'none'}${level >= 4 && onlyInstalled.length ? ` (${onlyInstalled.length} not running)` : ''}`);
  } else L.push("- Makers' apps: could not be read");
  if (pic.library?.length) {
    L.push('- Library drivers in use (this PC / shipped / library-cache):');
    for (const x of pic.library) L.push(`  - ${x.name}: ${x.inUse || '?'} / ${x.shipped || 'not shipped'} / ${x.cache || 'not cached'}${x.old ? ` -> OLD: ${x.newest} is out` : ''}${x.waitsRestart ? ' -> a newer one waits for a restart' : ''}${x.learned ? ' (learned on this PC)' : ''}${x.updated ? ` (updated ${String(x.updated.at || '').slice(0, 10)})` : ''}`);
  } else L.push('- Library drivers in use: none');
  if (pic.libraryCheck) L.push(`- Library check: ${pic.libraryCheck.at ? String(pic.libraryCheck.at).slice(0, 16).replace('T', ' ') : 'never'} UTC${pic.libraryCheck.reason ? ` (${pic.libraryCheck.reason})` : ''}, ${pic.libraryCheck.ok ? 'ok' : `failed: ${short(pic.libraryCheck.error || '', 120)}`}`);
  for (const e of pic.uac || []) L.push(`- Windows' permission box ${e.outcome === 'declined' ? 'declined' : 'not answered'}: ${e.action} (${e.area}), ${String(e.at).slice(0, 16).replace('T', ' ')} UTC`);
  const log = level >= 5 ? [] : level >= 1 ? (pic.log || []).slice(-10) : pic.log || [];
  if (log.length) L.push(`- DeviceHub's log about devices (the last ${log.length} lines):`, ...log.map((l) => `  - ${short(l, 180)}`));
  return L;
}
