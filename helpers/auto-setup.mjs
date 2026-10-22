// Auto setup (22 Oct 2026; docs/handoff/auto-setup.md): on a PC that is not Shawn's, DeviceHub sets itself up with
// almost no prompting.
//
//   startup({ root, pcMap, log })   once, when the agent has started (one marked line in server.js): reads the PC's USB
//                                   devices and runs run() with them
//   run({ root, usb, busy, log })   matches the USB devices with the device library and installs every matching "tested"
//                                   or "read-only" entry not installed yet (never over an existing my-devices folder,
//                                   never one the person removed, never when ANY of its ids is one DeviceHub's own
//                                   drivers run), then
//                                   loads it at once (my-devices.mjs loadNew) or says to restart. Records what it did
//                                   in setup.json (library names, statuses, USB ids, dates: nothing personal).
//   summary({ root, sources })      what was found and installed, what works now, what is optional and what still needs
//                                   a learning session, one plain line each (GET /api/setup, helpers/setup-report.mjs).
//                                   An item may carry action: { kind: 'library-install', name, label } (the Set up card's
//                                   Install button: POST /api/library/install) or { kind: 'check-again', id, label }
//                                   (a library driver's self-check again: POST /api/diagnose/action) or
//                                   { kind: 'turn-on', id, label } (Turn on settings: POST /api/diagnose/action)
//
// It installs drivers only (copies into my-devices\); it never writes to a device. What an installed driver does next
// (helpers/my-devices.mjs, safety round 2): one with a real-device record self-checks each setting when the device
// connects (writes its current value back once and reads it the same) and opens the ones that pass; one with no
// real-device record (a simulation, or not run yet) only READS until the person presses Turn on settings. Off: settings.json "autoSetup": false, or
// DEVICEHUB_AUTO_SETUP=0.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { match, installFromLibrary, ROOT, hex4, devicehubVersion } from './device-library.mjs';
import { genericDongle } from '../public/core/generic-dongle.js';
import { libraryMark, readVerified, loadNew, ownClash, hasRealRecord, provenCopy, needsTurnOn, writable, TURN_ON_LINE } from './my-devices.mjs';

export const SETUP_FILE = 'setup.json';
export const cache = { at: 0, value: null };  // server.js keeps /api/setup's last answer here for a minute
const require = createRequire(import.meta.url);
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const readSetup = (root = ROOT) => readJson(path.join(root, SETUP_FILE), {}) || {};
function saveSetup(root, data) {
  const file = path.join(root, SETUP_FILE), tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
const idOf = (u) => `${hex4(u.vid)}:${hex4(u.pid)}`;
const product = (meta) => `${meta.vendor} ${meta.product}`;

export function enabled(root = ROOT) {
  if (process.env.DEVICEHUB_AUTO_SETUP === '0') return false;
  return readJson(path.join(root, 'settings.json'), {})?.autoSetup !== false;
}

// usb: [{ vid, pid, name, runs }] (/api/pc); busy: extra 'vid:pid' DeviceHub already runs (VIA keyboards, built-in slots)
export async function run({ root = ROOT, usb = [], busy = [], log = () => {}, examples, load = loadNew, now = () => new Date() } = {}) {
  const at = now().toISOString();
  const before = readSetup(root);
  const rec = { version: 1, firstRunAt: before.firstRunAt || at, lastRunAt: at, devicehub: devicehubVersion(root), installed: before.installed || [], lastRun: { installed: [], offered: [], skipped: [] }, dismissed: before.dismissed || null };
  if (!enabled(root)) { rec.lastRun = { ...(before.lastRun || {}), off: true }; saveSetup(root, rec); return rec; }
  const own = new Set([...(usb || []).filter((u) => u.runs).map(idOf), ...busy.map((x) => String(x).toLowerCase())]);
  const ever = new Set(rec.installed.map((x) => x.name));
  for (const m of match(usb, { root, readOnly: true, ...(examples != null ? { examples } : {}) })) {
    const ids = m.matched.map(idOf);
    const line = { name: m.name, product: product(m.meta), status: m.meta.status, usb: ids };
    if (m.installed) continue;  // already there: summary() reports it
    // ANY id DeviceHub's own drivers run (plugged in, or declared by the entry): never installed (safety round 2)
    if (ids.some((id) => own.has(id)) || ownClash(m.meta.vid, m.meta.pids).length) { rec.lastRun.skipped.push({ ...line, why: 'DeviceHub\'s own driver already runs it' }); continue; }
    if (ever.has(m.name)) { rec.lastRun.skipped.push({ ...line, why: 'installed before and removed since: not installed again' }); continue; }
    if (!m.installable) { rec.lastRun.offered.push({ ...line, why: m.why }); continue; }
    const r = await installFromLibrary(m.name, { root, readOnly: true, ...(examples != null ? { examples } : {}), now });
    if (!r.ok) { rec.lastRun.skipped.push({ ...line, why: r.error }); continue; }
    const got = { ...line, id: r.id, at, proven: !!r.proven };
    rec.installed.push(got); rec.lastRun.installed.push(got); ever.add(m.name);
  }
  if (rec.lastRun.installed.length) {
    let loaded = null;
    try { loaded = await load(root); } catch {}
    rec.lastRun.loaded = loaded ? loaded.filter((x) => x.id).map((x) => x.name) : null;
    for (const x of rec.lastRun.installed) {
      const live = loaded?.some((l) => l.name === x.name && l.id);
      const how = !x.proven ? `: it reads the device; its settings change only after you press Turn on settings on its page (${TURN_ON_LINE})`
        : x.status === 'tested' ? '' : ': each setting opens once DeviceHub has written its current value back and read it the same, when the device connects';
      try { log({ kind: 'good', text: `Set up: ${x.product} driver installed from the device library${how}${live ? "" : " (restart DeviceHub to load it)"}` }); } catch {}
    }
  }
  saveSetup(root, rec);
  return rec;
}

// once, when the agent has started (server.js)
export async function startup({ root = ROOT, pcMap, log = () => {} } = {}) {
  if (!enabled(root)) return null;
  const usb = (await pcMap.get(true)).usb || [];
  let busy = [];
  try { busy = (await require('./via-defs.js').findKeyboards()).map((k) => `${k.vid}:${k.pid}`.toLowerCase()); } catch {}
  const r = await run({ root, usb, busy, log });
  console.log(`[setup] auto setup: ${r.lastRun.installed.length} installed, ${r.lastRun.offered.length} offered, ${r.lastRun.skipped.length} skipped`);
  return r;
}

// ---------- the summary ----------

// vendor id -> brand, for the device kinds a driver is written for (docs/brands.json)
export function brandsByVid(root) {
  const j = readJson(path.join(root, 'docs', 'brands.json'), {}) || {};
  const shared = new Set(((j.meta?.sharedVidWarning || '').match(/\b[0-9a-f]{4}\b/g)) || []);
  const out = {};
  for (const cat of ['mouse', 'headset', 'keyboard', 'case']) {
    for (const b of j.categories?.[cat] || []) for (const v of b.usbVendorIds || []) {
      const k = String(v).toLowerCase();
      if (!out[k]) out[k] = { name: b.name, kinds: [], shared: shared.has(k) };
      if (!out[k].kinds.includes(cat)) out[k].kinds.push(cat);
    }
  }
  return out;
}
const SHEETS = { 'logitech': 'logitech', 'razer': 'razer', 'corsair': 'corsair', 'steelseries': 'steelseries', 'turtle beach': 'turtle-beach', 'roccat': 'turtle-beach', 'hyperx': 'hyperx', 'asus': 'asus-rog', 'glorious': 'glorious', 'keychron': 'keychron', 'wooting': 'wooting', 'cooler master': 'cooler-master' };
const sheetFor = (root, brand) => {
  const k = Object.keys(SHEETS).find((n) => brand.toLowerCase().includes(n));
  return k && fs.existsSync(path.join(root, 'docs', 'brands', `${SHEETS[k]}.md`)) ? `docs/brands/${SHEETS[k]}.md` : null;
};
const runsIds = () => { try { return Object.keys(require('./pc-map.js').RUNS || {}).map((k) => k.toLowerCase()); } catch { return []; } };
// product ids a brand sheet lists with packets bigger than the helper's 64-byte channels: { pid: bytes }. Read from the
// sheet's tables: a row whose "Packet" column (or text) says 128 or 1024 bytes; each 4-hex id in backticks on it.
const packetCache = {};
function bigPacketIds(root, sheet) {
  if (packetCache[sheet]) return packetCache[sheet];
  const out = {};
  let text = '';
  try { text = fs.readFileSync(path.join(root, sheet), 'utf8'); } catch {}
  for (const row of text.split(/\r?\n/).filter((l) => l.startsWith('|'))) {
    const m = /\b(128|1024)(?:[- ]byte|\s*bytes|\s*\|)/.exec(row);
    if (!m) continue;
    // only the ids the row says use that size, when it names one ("1BE3 uses 128-byte packets"), else every id on it
    const one = /`([0-9A-F]{4})` uses (128|1024)/i.exec(row) || /\(([0-9A-F]{4}) uses (128|1024)/i.exec(row);
    if (one && !/\|\s*(128|1024)\b/.test(row)) { out[one[1].toLowerCase()] = one[2]; continue; }
    for (const id of row.match(/`([0-9A-F]{4})`/gi) || []) out[id.slice(1, 5).toLowerCase()] = m[1];
    if (one) out[one[1].toLowerCase()] = one[2];
  }
  return (packetCache[sheet] = out);
}
// not a device a driver is written for
const NOT_A_DEVICE = /bluetooth|\bhub\b|storage|card reader|mass|camera|webcam|wireless adapter|network|ethernet|wi-?fi|serial|printer|audio interface/i;

// my-devices folders installed from the library: [{ name, id, status, source, title?, verified: [labels], readOnly: [{ key, why }], checkedAt }]
export function libraryDrivers(root = ROOT, adapters = {}) {
  const dir = path.join(root, 'my-devices');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch {}
  const out = [];
  for (const name of names) {
    const folder = path.join(dir, name);
    const mark = libraryMark(folder);
    if (!mark) continue;
    const v = readVerified(folder);
    const meta = readJson(path.join(folder, 'device.json'), {}) || {};
    const a = adapters[mark.id];
    // a display is a reading, never checked (it was counted as "unchecked" before 22 Oct 2026)
    const keys = a?.settings?.filter(writable).map((s) => [s.key, s.label]) || Object.keys(v.keys || {}).map((k) => [k, k]);
    const proven = provenCopy(folder, mark);
    const turnOn = a?.library?.turnOn ?? (keys.length ? keys.some(([k]) => needsTurnOn(mark, proven, k)) : !proven && !mark.settingsOn?.at);
    const ok = keys.filter(([k]) => v.keys?.[k]?.ok === true).map(([, l]) => l);
    const failed = keys.filter(([k]) => v.keys?.[k]?.ok === false).map(([k, l]) => ({ key: k, label: l, why: v.keys[k].why }));
    const waiting = keys.filter(([k]) => v.keys?.[k]?.waiting).map(([k, l]) => ({ key: k, label: l, why: v.keys[k].why }));
    const unchecked = keys.filter(([k]) => !v.keys?.[k]).map(([, l]) => l);
    out.push({ name, id: mark.id, status: mark.status, source: mark.source, title: a?.title || (meta.vendor ? `${meta.vendor} ${meta.product}` : name), checkedAt: v.checkedAt || null, firmware: v.firmware || null, verified: ok, failed, waiting, unchecked, deviceStatus: a?.status || null, proven, turnOn });
  }
  return out;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// sources (each optional; a missing one is simply not reported):
//   agent: /api/agent/state ({ devices }), usb: /api/pc's usb, via: [{ vid, pid, name }], monitors, cameras,
//   bluetooth: std-battery read(), lamparrays, eqapo: boolean (installed), openrgb: status(), pcLights: boolean
// a library entry's name in plain words for the Your devices card: "Logitech G keyboards", not "Logitech Logitech G
// keyboards (HID++ 2.0, cable, ...)"
const plainProduct = (meta) => {
  const p = String(meta?.product || meta?.title || '').replace(/\s*\([^)]*\)/g, '').trim();
  const v = String(meta?.vendor || '').trim();
  return !p ? v || 'Device' : !v || p.toLowerCase().startsWith(v.toLowerCase()) ? p : `${v} ${p}`;
};

export function summary({ root = ROOT, sources = {} } = {}) {
  const setup = readSetup(root);
  const devs = sources.agent?.devices || [];
  const adapters = Object.fromEntries(devs.map((d) => [d.id, { ...(d.adapter || {}), status: d.status }]));
  const works = [], optional = [], learn = [], installed = [], attention = [];
  // built-in slots: only the ones this PC has
  for (const d of devs.filter((x) => ['mouse', 'headset', 'keyboard'].includes(x.id))) {
    if (!d.seen && !['connected', 'asleep'].includes(d.status)) continue;
    const model = d.info?.Model && d.info.Model !== d.adapter?.title ? ` (${d.info.Model})` : '';
    works.push({ what: d.id, line: `${d.adapter?.title || d.id}${model}: runs on its ${d.adapter?.kind || d.id} page${d.status === 'connected' ? '' : ` (${d.status} now)`}`,
      state: 'ready', name: d.adapter?.title || d.id, short: `Ready on the ${d.adapter?.kind || d.id} page${d.status === 'connected' ? '' : ` (${d.status} now)`}.`, page: d.id });
  }
  const ran = new Set((sources.usb || []).filter((u) => u.runs).map(idOf));
  const via = new Set((sources.via || []).map(idOf));   // a VIA keyboard runs on the Keyboard page: never "still to do"
  for (const k of (sources.via || []).filter((x) => !ran.has(idOf(x)))) works.push({ what: 'via', state: 'ready', name: k.name || `Keyboard ${k.vid}:${k.pid}`, short: 'Keys, knob, macros and lights on the Keyboard page.', page: 'keyboard', line: `${k.name || `${k.vid}:${k.pid}`}: a VIA keyboard, its keys and lights work on the Keyboard page (a board that needs its maker's layout file has a Get the layout button there)` });
  const mons = (sources.monitors || []).filter((m) => m.ddc);
  if (mons.length) works.push({ what: 'monitors', state: 'ready', name: plural(mons.length, 'monitor'), short: `${mons.map((m) => m.name || m.model).join(', ')}: brightness, contrast and more.`, page: 'monitors', line: `${plural(mons.length, 'monitor')} over DDC/CI: ${mons.map((m) => m.name || m.model).join(', ')} (Monitors page)` });
  const cams = sources.cameras || [];
  if (cams.length) works.push({ what: 'cameras', state: 'ready', name: plural(cams.length, 'webcam'), short: `${cams.map((c) => c.name).join(', ')}: picture settings on the Monitors page.`, page: 'monitors', line: `${plural(cams.length, 'webcam')}: ${cams.map((c) => c.name).join(', ')}, picture settings on the Monitors page` });
  const bt = (sources.bluetooth || []).filter((b) => b.percent != null);
  if (bt.length) works.push({ what: 'bluetooth', state: 'ready', name: 'Bluetooth batteries', short: bt.map((b) => `${b.name} ${b.percent}%`).join(', '), line: `Battery levels from Windows: ${bt.map((b) => `${b.name} ${b.percent}%`).join(', ')}` });
  const lamps = sources.lamparrays || [];
  // Windows Dynamic Lighting: any light that speaks the standard works in Windows Settings with no driver at all
  if (lamps.length) works.push({ what: 'lamparrays', state: 'ready', name: lamps.length === 1 ? (lamps[0].name || lamps[0].product || 'Dynamic Lighting device') : plural(lamps.length, 'Dynamic Lighting device'), short: `${lamps.length === 1 ? 'Its lights work' : `${lamps.map((l) => l.name || l.product || 'light').join(', ')}: their lights work`} in Windows Settings, no driver needed.`, line: `${plural(lamps.length, 'Windows Dynamic Lighting device')}: ${lamps.map((l) => l.name || l.product || 'light').join(', ')} (one color, then handed back to Windows)`, action: { kind: 'settings', page: 'lighting', label: 'Open Dynamic Lighting' } });
  // library drivers
  for (const l of libraryDrivers(root, adapters)) {
    const ro = [...l.failed.map((f) => `${f.label} (${f.why})`), ...(l.status === 'tested' ? [] : l.unchecked)];
    const wait = l.waiting.map((w) => `${w.label} (${w.why})`);
    const connected = l.deviceStatus === 'connected';
    const state = l.turnOn
      ? `it reads the device; its settings are read-only until you press Turn on settings${connected ? '' : ' (connect it first)'}. ${TURN_ON_LINE}`
      : !l.checkedAt ? (l.status === 'tested' && l.proven ? 'its settings change normally; its self-check runs when it connects' : 'read-only until it connects and its self-check runs')
      : `verified: ${l.verified.length ? l.verified.join(', ') : 'none'}${ro.length ? `; read-only: ${ro.join('; ')}` : ''}${wait.length ? `; waiting, tried again later: ${wait.join('; ')}` : ''}`;
    const short = l.turnOn ? (connected ? 'Ready-made driver installed. Turn on its settings: DeviceHub tests each one first.' : 'Ready-made driver installed. Connect it, then turn on its settings.')
      : !l.checkedAt ? 'Ready-made driver installed. Its check runs when it connects.'
      : l.failed.length || l.waiting.length ? `Works. Read-only for now: ${[...l.failed, ...l.waiting].map((x) => x.label).join(', ')}.`
      : 'Ready on its own page.';
    const item = { what: 'library', name: l.name, title: l.title, page: l.id, state: l.turnOn ? 'one-click' : 'ready', short, line: `${l.title}: library driver (${l.status}), ${state}` };
    // Turn on settings first; then Check again whenever it is connected and a setting has not passed (failed, waiting,
    // or never checked: safety round 2, it no longer needs an earlier check)
    if (l.turnOn && connected) item.action = { kind: 'turn-on', id: l.id, label: `Turn on settings for ${l.title}` };
    else if (!l.turnOn && connected && (l.failed.length || l.waiting.length || l.unchecked.length)) item.action = { kind: 'check-again', id: l.id, label: `Check ${l.title} again` };
    works.push(item);
    if (l.turnOn || !l.checkedAt || l.failed.length || l.waiting.length || (l.status !== 'tested' && l.unchecked.length)) attention.push(item.line);
  }
  // what auto setup installed (until dismissed)
  for (const x of setup.installed || []) installed.push({ what: 'installed', name: x.name, title: x.product, line: `${x.product}: installed from the device library on ${String(x.at).slice(0, 10)} (${x.status})` });
  if (installed.length) attention.push(...installed.map((x) => x.line));
  // library entries for this PC's devices that did not install by themselves ("untested", or one removed by the
  // person): each with an Install button (the person's click installs it; what happens next: installNote)
  let matches = [];
  try { matches = match(sources.usb || [], { root, readOnly: true, untested: true }); } catch {}
  const runs = new Set((sources.usb || []).filter((u) => u.runs).map(idOf));
  for (const m of matches) {
    // installed already, or ANY of its ids one DeviceHub's own drivers run: nothing to offer (safety round 2)
    if (m.installed || m.matched.some((u) => runs.has(idOf(u))) || ownClash(m.meta.vid, m.meta.pids).length) continue;
    const after = hasRealRecord(m.meta, { driverSha: m.driverSha || null })
      ? (m.meta.status === 'tested' ? 'its settings change normally' : "each setting opens once DeviceHub has written its current value back and read it the same, when the device connects")
      : `it reads the device; its settings change only after you press Turn on settings on its page (${TURN_ON_LINE})`;
    // a VIA keyboard already runs (keys and lights): a library driver for it only adds the maker's extra settings,
    // so it is offered under Optional, never as still to do
    if (m.matched.every((u) => runs.has(idOf(u)) || via.has(idOf(u)))) {
      optional.push({ what: 'library-extra', name: m.name, title: plainProduct(m.meta), state: 'optional', short: "Works already as a VIA keyboard. Its maker's driver adds the extra settings.", line: `${product(m.meta)}: it already works as a VIA keyboard; a library driver adds the maker's own settings (${m.meta.status}; after Install ${after})`, ...(m.installable ? { action: { kind: 'library-install', name: m.name, label: `Install the ${m.meta.vendor} driver` } } : {}) });
      continue;
    }
    const line = m.meta.status === 'untested'
      ? `${product(m.meta)}: a library driver is there for it, written from the maker's protocol but not yet run on a real device. After Install ${after}`
      : `${product(m.meta)}: a library driver (${m.meta.status}) is there for it but not installed (removed earlier, or auto setup is off). After Install ${after}`;
    const action = m.installable ? { kind: 'library-install', name: m.name, label: `Install the ${m.meta.vendor} driver` } : null;
    const short2 = m.meta.status === 'untested' ? 'A ready-made driver is there, not yet tried on this model. Install it, then turn on its settings.' : 'A ready-made driver is there. Install it.';
    learn.push({ what: m.meta.status === 'untested' ? 'library-untested' : 'library-install', name: m.name, title: plainProduct(m.meta), state: 'one-click', short: short2, line, ...(action ? { action } : {}) }); attention.push(line);
  }
  // devices from a known brand that nothing runs yet
  const brands = brandsByVid(root);
  const covered = new Set([...(sources.via || []).map((k) => `${k.vid}:${k.pid}`.toLowerCase()), ...(setup.installed || []).flatMap((x) => x.usb || [])]);
  for (const m of matches) for (const u of m.matched) covered.add(idOf(u));
  const learned = new Set(), unknown = [];
  for (const u of sources.usb || []) {
    const id = idOf(u), b = brands[hex4(u.vid)];
    if (u.runs || runsIds().includes(id) || via.has(id) || covered.has(id) || learned.has(id) || NOT_A_DEVICE.test(u.name || '')) continue;
    learned.add(id);
    // a generic 2.4G receiver on a chip maker's shared id (public/core/generic-dongle.js): it works as a plain mouse or
    // keyboard; one plain line, and Request support on its line (Learn a device refuses these chips' ids)
    const gd = genericDongle(u);
    if (gd) {
      const line = `${u.name || 'USB receiver'} (USB ${id}): ${gd.line} Learn a device does not learn this chip's id; Request support asks Shawn to look at it`;
      works.push({ what: 'generic-dongle', usb: id, chip: gd.chip, title: u.name || 'USB receiver', state: 'ready', short: gd.line, line }); attention.push(line);
      continue;
    }
    // a vendor DeviceHub knows no brand for: one line for all of them, under Optional (safety round 2, rule 7)
    if (!b) { unknown.push(u); continue; }
    const sheet = sheetFor(root, b.name);
    // left out of a library driver because of its packet size (the brand sheet's "Packet" column, e.g. Corsair 1bc4)
    const big = sheet ? bigPacketIds(root, sheet)[hex4(u.pid)] : null;
    const line = big
      ? `${u.name || `${b.name} device`} (USB ${id}): no library driver: it talks in ${big}-byte packets and DeviceHub's helper opens 64-byte ones only (${sheet})`
      : `${u.name || `${b.name} device`} (USB ${id}${b.shared ? ', the vendor id is a chip maker\'s: unconfirmed' : ''}): no driver yet; Learn a device (in DeviceHub) can make one${sheet ? ` (${sheet} has what is known)` : ''}; it needs the maker's app to learn from`;
    learn.push({ what: big ? 'packet-size' : 'learn', usb: id, title: u.name || `${b.name} device`, state: 'not-yet',
      short: big ? 'Not supported yet: it talks in messages too big for DeviceHub.' : "No driver yet. Learn a device makes one while you use the maker's app.", line }); attention.push(line);
  }
  if (unknown.length) {
    const named = unknown.slice(0, 6).map((u) => `${u.name ? `${u.name} ` : ''}${idOf(u)}`);
    optional.push({ what: 'unknown-vendor', usb: unknown.map(idOf), title: plural(unknown.length, 'other USB device'), state: 'optional', short: `${named.join(', ')}${unknown.length > 6 ? ', …' : ''}: Learn a device can try.`, line: `${plural(unknown.length, 'other USB device')} from makers DeviceHub has no notes on (${named.join(', ')}${unknown.length > 6 ? `, and ${unknown.length - 6} more` : ''}): Learn a device can make a driver for one; it needs the maker's app to learn from` });
  }
  // optional extras
  if (sources.eqapo === false) optional.push({ what: 'eqapo', title: 'Headset EQ', state: 'optional', short: 'EQ, mic boost and mic filters for any headset. Equalizer APO comes inside DeviceHub: Install, then Windows asks once.', page: 'settings', line: 'Equalizer APO: needed for the headset EQ, mic boost and mic filters (the Headset page has the button; ask before installing)' });
  if (sources.openrgb && !sources.openrgb.running && sources.pcLights !== false) optional.push({ what: 'openrgb', title: 'Board, fan and RAM lights', state: 'optional', short: 'Need the free OpenRGB app. Lighting > PC lights shows how.', page: 'lighting', line: 'PC lights (board, graphics card, RAM): through OpenRGB 1.1 or newer with its SDK server on, only if wanted (board and RAM also need PawnIO)' });
  const signature = attention.length ? hash(attention.join('\n')) : null;
  const found = { usb: (sources.usb || []).length, library: installed.length + works.filter((w) => w.what === 'library').length };
  return {
    show: !!signature && signature !== setup.dismissed,
    signature, found, installed, works, optional, learn,
    setup: { firstRunAt: setup.firstRunAt || null, lastRunAt: setup.lastRunAt || null, off: !enabled(root) },
  };
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// the Set up card's dismiss: kept until the summary says something new
export function dismiss(root = ROOT, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{1,8}$/.test(signature)) throw new Error('signature must be the summary\'s signature');
  const s = readSetup(root);
  s.dismissed = signature;
  saveSetup(root, s);
  return { ok: true, dismissed: signature };
}

// the summary as plain text (setup-report.mjs, and anything else that wants it in words)
export function asText(s) {
  const out = [];
  const sec = (title, items) => { if (items.length) { out.push(title); for (const i of items) out.push(`  - ${i.line}`); } };
  sec('Installed by DeviceHub\'s auto setup:', s.installed);
  sec('Works now:', s.works);
  sec('Still to do (learning, or a library driver to install):', s.learn);
  sec('Optional:', s.optional);
  if (!out.length) out.push('Nothing found to report.');
  const turnOn = s.works.some((w) => w.action?.kind === 'turn-on');
  out.push(s.learn.length || turnOn
    ? `Next: for each item under "Still to do", press its Install button, or use Learn a device (in DeviceHub) for one with no driver; then press Turn on settings on the device's page.${turnOn ? ' A driver under "Works now" is waiting for its Turn on settings.' : ''}`
    : 'Next: nothing to set up.');
  return out.join('\n');
}
