// Corsair wireless and wired mice and keyboards on the Bragi property protocol (22 Oct 2026).
// Written only from docs/brands/corsair.md (the "sheet"; every id below cites its section and row, and the sheet cites
// OpenLinkHub (OLH), ckb-next (ckb) and DeviceHub's HS80 code (DH)) and the working HS80 transport it describes
// (helpers/native/hs80io.cs through the helper's hs80 channel: reused, not edited). Never run on a real mouse or
// keyboard: status "untested" in device.json, so DeviceHub offers it on a click and loads it read-only until each
// setting passes the self-check.
//
// HID LAYER (what this driver takes from DeviceHub's helper; docs/handoff/hid-core.md, docs/handoff/drivers-round3b.md):
//   1. The channel is the headset's: `hs80:<pid>:<ep>:bragi` (helper.cs HandleHs80). OPEN finds a 1B1C collection on
//      usage page FF42, usage 01, 64-byte output reports (HidFind.Find); GET <id> sends `02 <ep> 02 <id lo> <id hi>`
//      and answers the reply's status and value bytes; SET <id> <value> sends `02 <ep> 01 <id> 00 <value LE>` for the
//      ids and ranges in Hs80Io.Set only, and answers ERR for anything else (nothing sent).
//   2. UNCONFIRMED, and the reason this entry is "untested": the sheet (section 2 "The bragi frame") says OLH's mice and
//      keyboards frame has no 02 prefix and their replies sit one byte lower. If a device's Bragi collection really has
//      no report ids, the helper's OPEN answers NODEVICE (its output reports are not 64 bytes with an id) or every GET
//      goes unanswered: this driver then says "no reply" and offers nothing. Nothing is ever written before a GET of
//      the same id has answered, so a frame mismatch can only end in silence. A helper flag for the unprefixed frame
//      (the sheet's section 5 `prefix02`) is listed in the handoff as a C# change for Shawn.
//   3. UNCONFIRMED: the endpoint behind a Slipstream receiver is 09 "by analogy" (sheet section 2 "The bragi frame"
//      and section 6). The cable is 08 ("on its cable a device ... answers on 08 directly").
//   4. Keyboards with 128- or 1024-byte packets (sheet section 1 "Keyboards" Packet column: K70 RGB Pro / Optic, K70
//      RGB TKL, K65 RGB Mini / Pro Mini, K100 RGB; mice: the 1BE3 Scimitar Elite) cannot open on the 64-byte channel,
//      so their ids are left out of MODELS (listed in device.json doesNotWork).
//
// What the helper's SET list allows (hs80io.cs Hs80Io.Set, 22 Oct 2026: 02 0-1000, 03 1-2, 0e 60000-7200000, 0d 0/1,
// 46 0/1, 47 0-1000) decides what is writable here: the sleep timer 0e and its on/off 0d on mice, brightness 02 on
// keyboards. DPI 21 / 22, DPI stage 1e and polling 01 are not on it, so they are readings (`display`) only; the
// handoff names the one-line whitelist change each needs.
//
// Safety (CLAUDE.md "Rules that are never broken"; sheet section 4 "Never"): only GET and, for WRITES below, SET are
// sent, through the helper's own GET / SET. No handle is ever opened (pairing resources 05 / 06 and the key and macro
// handles `0d 01 02` / `06 01` cannot be reached), no firmware, bootloader or radio path (14-16 are never asked), no
// sleep-now (03 = 4), no light mode change (03 is only read, for the backup). While iCUE runs it still reads (GETs
// only, as every other library driver does) but refuses every write (sheet section 4: both talk on the same channel).
//
// Write-back of the same value (driver safety, 22 Oct 2026, docs/handoff/driver-safety.md): the page shows minutes and
// percent, the device holds ms and tenths. write() reads the raw value first; when the value asked for is the one that
// raw value shows (the self-check's write of what it just read), it sends that exact raw value back, never a rounded
// one (90 s stays 90000, not 120000; 455 stays 455, not 460), and the read-back is compared raw against what was sent.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

// DeviceHub's built-in headset page owns the HS80 RGB Wireless (sheet section 1 "Headsets", first row; the same list
// as device-library/corsair-bragi-headset HS80_OWN_PIDS, copied so this folder stands alone in my-devices). Never in
// MODELS; tests/sim-corsair-bragi-peripherals.mjs checks both lists.
export const HS80_OWN_PIDS = ['0A69', '0A6B', '0A71'];

// sheet section 2 "The bragi frame": 08 = the device that is plugged in, 09 = the first device behind a receiver
export const EP = { cable: 8, receiver: 9 };

// Property ids (sheet section 3 "Settings map"; section 4 "Safe to read first" for every id that is read).
export const P = {
  polling: 0x01,     // "Polling rate": R/W, 1 = 125 Hz ... 7 = 8000 (ckb 1-4, OLH to 7). Read only here (not in the helper's SET list)
  brightness: 0x02,  // "Brightness" / "Keyboard brightness": R/W 0-1000 (OLH K70 Pro). In the helper's SET list (0-1000)
  lightMode: 0x03,   // "Light mode": R/W 1 hardware / 2 software. Read for the backup only; never written here
  sleepOn: 0x0d,     // "Sleep timer on/off": W 0 / 1; "mice OLH send 01 0d 00 01". In the helper's SET list (0 / 1)
  sleep: 0x0e,       // "Sleep timer": R/W uint32 ms, "headsets, mice (OLH)", OLH 1-60 min. In the helper's SET list
  battery: 0x0f,     // "Battery level": R 0-1000, tenths of a percent, "all bragi" (DH, OLH, HSC, ckb)
  chargeStatus: 0x10,// "Battery / charge status": R, values unconfirmed (ckb names it): backup only
  vendorId: 0x11,    // "Vendor / product id": R uint16 (ckb): backup only
  productId: 0x12,   // same row; "OLH reads 12 behind a receiver" (section 2 "Receiver vs cable"): which model is paired
  firmware: 0x13,    // "Firmware (app)": R, major, minor, patch ("mouse: patch is uint16"). 14-16 never asked
  dpiX: 0x21,        // "Mouse DPI X / Y": W, "R unconfirmed" (ckb, OLH); section 4 lists 21/22 as safe reads. Read only here
  dpiY: 0x22,
  connection: 0x36,  // "Connection status": R, sub-device bit field (ckb, OLH): backup only
};
// Documented but not offered (docs/handoff/drivers-round3b.md): DPI stage index / mask 1e / 1f (format not in the
// sheet), DPI stage colors 2f-31, angle snapping 07, lift height 06, left-hand mode 52, button response b0 (W only, not
// in the helper's SET list), sleep property 37 (OLH writes it beside 0e; which one a mouse honors is unconfirmed),
// keyboard Win-lock 4a / 45 (bit mask), key and macro handles, per-key lights (handle writes).

// Polling rate codes (sheet section 3 "Polling rate")
export const POLLING_HZ = { 1: 125, 2: 250, 3: 500, 4: 1000, 5: 2000, 6: 4000, 7: 8000 };

// Generic Slipstream receivers (sheet section 1 "Mice", last row: ckb 1BA6; OLH 1BDC, 2B00, V2 2B1B): the model behind
// one is learned from property 12 on endpoint 09 (section 2 "Receiver vs cable").
export const GENERIC_RECEIVERS = ['1BA6', '1BDC', '2B00', '2B1B'];

// One row per model, ids from sheet section 1 ("Mice" and "Keyboards", bragi rows with 64-byte or unlisted packets;
// see HID LAYER 4). devices: its own ids (cable, or the id OLH sees behind a generic receiver); receivers: its own
// dongle. dpiMax: section 3 "Mouse DPI X / Y" (documentation only; DPI is not written here).
export const MODELS = [
  // ---- mice ----
  { key: 'm75', kind: 'mouse', name: 'CORSAIR M75', devices: ['1BF0'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"; section 3 DPI "100-26000 (M75)"' },
  { key: 'm75-wireless', kind: 'mouse', name: 'CORSAIR M75 Wireless', devices: ['1BF1', '2B08'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"' },
  { key: 'm75-air', kind: 'mouse', name: 'CORSAIR M75 Air', devices: ['1BF2'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"' },
  { key: 'm65-ultra', kind: 'mouse', name: 'CORSAIR M65 RGB Ultra', devices: ['1B9E'], receivers: [], source: 'section 1 "M65 RGB Ultra / Ultra Wireless"' },
  { key: 'm65-ultra-wireless', kind: 'mouse', name: 'CORSAIR M65 RGB Ultra Wireless', devices: ['1BB5', '1BD6'], receivers: [], source: 'section 1 "M65 RGB Ultra / Ultra Wireless"' },
  { key: 'dark-core-pro', kind: 'mouse', name: 'CORSAIR Dark Core RGB Pro', devices: ['1B80'], receivers: ['1B81'], dpiMax: 18000, source: 'section 1 "Dark Core RGB Pro / Pro SE" (ckb USES_BRAGI); section 3 DPI "100-18000 (Dark Core Pro)"' },
  { key: 'dark-core-pro-se', kind: 'mouse', name: 'CORSAIR Dark Core RGB Pro SE', devices: ['1B7E'], receivers: ['1B7F'], dpiMax: 18000, source: 'section 1 "Dark Core RGB Pro / Pro SE"' },
  { key: 'harpoon-wireless', kind: 'mouse', name: 'CORSAIR Harpoon RGB Wireless', devices: ['1B5E'], receivers: ['1B65'], source: 'section 1 "Harpoon RGB Wireless" (ckb; OLH)' },
  { key: 'sabre-pro', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro', devices: ['1B79'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-pro-wireless', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro Wireless', devices: ['1B98'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-pro-cs', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro CS', devices: ['1B7A'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-v2-pro', kind: 'mouse', name: 'CORSAIR Sabre V2 Pro', devices: ['2B28'], receivers: ['2B2A'], source: 'section 1 "Sabre V2 Pro / MG" (OLH)' },
  { key: 'sabre-v2-mg', kind: 'mouse', name: 'CORSAIR Sabre V2 MG', devices: ['2B29'], receivers: ['2B34'], source: 'section 1 "Sabre V2 Pro / MG" (OLH)' },
  // section 1 "Katar Pro / Pro XT / Pro Wireless | 1B93 / 1BAC | 1B94": the two device ids and the one receiver id
  { key: 'katar-pro', kind: 'mouse', name: 'CORSAIR Katar Pro', devices: ['1B93'], receivers: [], source: 'section 1 "Katar Pro / Pro XT / Pro Wireless" (ckb; OLH)' },
  { key: 'katar-pro-xt', kind: 'mouse', name: 'CORSAIR Katar Pro XT', devices: ['1BAC'], receivers: [], source: 'section 1 "Katar Pro / Pro XT / Pro Wireless"' },
  { key: 'katar-pro-wireless', kind: 'mouse', name: 'CORSAIR Katar Pro Wireless', devices: [], receivers: ['1B94'], source: 'section 1 "Katar Pro / Pro XT / Pro Wireless" (receiver 1B94)' },
  { key: 'scimitar-elite-wireless', kind: 'mouse', name: 'CORSAIR Scimitar RGB Elite Wireless', devices: ['1BDB'], receivers: [], source: 'section 1 "Scimitar RGB Elite (new) / Elite Wireless / Elite Wireless SE" (1BE3 left out: 128-byte packets)' },
  { key: 'scimitar-elite-wireless-se', kind: 'mouse', name: 'CORSAIR Scimitar RGB Elite Wireless SE', devices: ['2B22'], receivers: [], source: 'section 1 "Scimitar RGB Elite ... Elite Wireless SE"' },
  { key: 'ironclaw-wireless', kind: 'mouse', name: 'CORSAIR Ironclaw RGB Wireless', devices: ['1B4C'], receivers: ['1B66'], source: 'section 1 "Ironclaw RGB Wireless" (ckb)' },
  // ---- keyboards (section 1 "Keyboards", bragi rows whose packet is 64 or not listed) ----
  { key: 'k70-core', kind: 'keyboard', name: 'CORSAIR K70 Core RGB', devices: ['2B0A', '1BFF', '1BFD'], receivers: [], source: 'section 1 "K70 Core RGB" (ckb, 64)' },
  { key: 'k70-core-tkl', kind: 'keyboard', name: 'CORSAIR K70 Core TKL', devices: ['2B01', '2B02'], receivers: [], source: 'section 1 "K70 Core TKL / Pro TKL Wireless" (OLH)' },
  { key: 'k70-pro-tkl-wireless', kind: 'keyboard', name: 'CORSAIR K70 Pro TKL Wireless', devices: ['2B14'], receivers: [], source: 'section 1 "K70 Core TKL / Pro TKL Wireless" (OLH)' },
  { key: 'k70-max', kind: 'keyboard', name: 'CORSAIR K70 Max', devices: ['1BC0'], receivers: [], source: 'section 1 "K70 Max" (OLH)' },
  { key: 'k65-plus-wireless', kind: 'keyboard', name: 'CORSAIR K65 Plus Wireless', devices: ['2B10', '2B11', '2B23'], receivers: ['2B07'], source: 'section 1 "K65 Plus Wireless" (OLH; dongle 2B07)' },
  { key: 'k100-air', kind: 'keyboard', name: 'CORSAIR K100 Air', devices: ['1BAB'], receivers: [], source: 'section 1 "K100 Air" (OLH)' },
  { key: 'k55-pro', kind: 'keyboard', name: 'CORSAIR K55 Pro', devices: ['1BA4'], receivers: [], source: 'section 1 "K55 Pro / Pro XT" (ckb, 64)' },
  { key: 'k55-pro-xt', kind: 'keyboard', name: 'CORSAIR K55 Pro XT', devices: ['1BA1'], receivers: [], source: 'section 1 "K55 Pro / Pro XT" (ckb, 64)' },
  { key: 'k55-core', kind: 'keyboard', name: 'CORSAIR K55 Core RGB', devices: ['1BFE', '2B05'], receivers: [], source: 'section 1 "K55 Core RGB / Core TKL" (OLH)' },
  { key: 'k55-core-tkl', kind: 'keyboard', name: 'CORSAIR K55 Core TKL', devices: ['2B20'], receivers: [], source: 'section 1 "K55 Core RGB / Core TKL" (OLH)' },
  { key: 'k95-platinum-xt', kind: 'keyboard', name: 'CORSAIR K95 Platinum XT', devices: ['1B89'], receivers: [], source: 'section 1 "K95 Platinum XT" (ckb)' },
];
export const ALL_PIDS = [...MODELS.flatMap((m) => [...m.devices, ...m.receivers]), ...GENERIC_RECEIVERS];

// What the helper SETs (hs80io.cs Hs80Io.Set): id -> [min, max] raw. canSet() keeps anything else from being sent.
export const HELPER_SETS = { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000], 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] };
// the only ids this driver ever writes: mice the sleep timer and its on/off, keyboards the brightness
const WRITES = [P.sleep, P.sleepOn, P.brightness];
const SLEEP_MAX = 60;  // minutes: sheet section 3 "Sleep timer" OLH 1-60 min (the range for mice; DH's 1-120 is the HS80's)

export function canSet(helperSets, id, raw) {
  const r = helperSets[id];
  return WRITES.includes(id) && !!r && Number.isInteger(raw) && raw >= r[0] && raw <= r[1];
}

const h2 = (n) => n.toString(16).padStart(2, '0');
const h4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();
const gone = (msg) => Object.assign(new Error(msg), { gone: true });

// the model a product id belongs to (its own id or its own receiver), or null
export function modelOf(pid) {
  const p = String(pid).toUpperCase();
  if (HS80_OWN_PIDS.includes(p)) return null;
  return MODELS.find((m) => m.devices.includes(p) || m.receivers.includes(p)) || null;
}
// a plugged-in id: { model, pid, conn, ep, generic } (model null on a generic receiver until property 12 names it)
export function identify(pid) {
  const p = String(pid).toUpperCase();
  if (HS80_OWN_PIDS.includes(p)) return null;
  if (GENERIC_RECEIVERS.includes(p)) return { model: null, pid: p, conn: 'receiver', ep: EP.receiver, generic: true };
  for (const m of MODELS) {
    if (m.devices.includes(p)) return { model: m, pid: p, conn: 'cable', ep: EP.cable, generic: false };
    if (m.receivers.includes(p)) return { model: m, pid: p, conn: 'receiver', ep: EP.receiver, generic: false };
  }
  return null;
}

// the ids a model's probe asks: section 4 "Safe to read first" (0d is a GET too, as the headset driver asks it), and a
// writable id only while the helper can SET it (never asked for nothing)
function probeIds(m, helperSets) {
  const w = (id, lo, hi) => (canSet(helperSets, id, lo) && canSet(helperSets, id, hi) ? [id] : []);
  return m.kind === 'mouse'
    ? [P.battery, P.polling, P.dpiX, P.dpiY, ...w(P.sleep, 60000, SLEEP_MAX * 60000), ...w(P.sleepOn, 0, 1)]
    : [P.battery, P.polling, ...w(P.brightness, 0, 1000)];
}

// The settings a model's page shows: what its kind has, what answered a GET, and (for a write) what the helper sends.
export function settingsFor(model, { helperSets = HELPER_SETS, readable = {} } = {}) {
  if (!model) return [];
  const can = (id, lo, hi) => canSet(helperSets, id, lo) && canSet(helperSets, id, hi);
  const out = [];
  if (model.kind === 'mouse') {
    if (readable[P.dpiX]) out.push({ key: 'dpi', label: 'DPI', type: 'display', hint: 'As the mouse reports it. Change it on the mouse\'s DPI button (DeviceHub\'s helper cannot send DPI yet).' });
    if (readable[P.sleep] && can(P.sleep, 60000, SLEEP_MAX * 60000)) out.push({ key: 'sleepTimer', label: 'Sleep when idle', type: 'slider', min: 1, max: SLEEP_MAX, unit: ' min', hint: 'How long the mouse waits before it sleeps' });
    if (readable[P.sleepOn] && can(P.sleepOn, 0, 1)) out.push({ key: 'sleepOn', label: 'Sleep timer', type: 'toggle', hint: 'Off: the mouse never sleeps by itself' });
  } else if (readable[P.brightness] && can(P.brightness, 0, 1000)) {
    out.push({ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, unit: '%', live: true, hint: 'The keyboard\'s light brightness' });
  }
  if (readable[P.polling]) out.push({ key: 'polling', label: 'Polling rate', type: 'display', unit: ' Hz', hint: 'As the device reports it (DeviceHub\'s helper cannot send it yet)' });
  return out;
}

// The transport: the native helper (helpers/native.js), loaded on first use so importing this file starts nothing.
function nativeTransport() {
  let n = null;
  const nat = () => (n ||= createRequire(import.meta.url)('../../helpers/native.js'));
  return { request: (chan, cmd, ms) => nat().request(chan, cmd, ms), onEvent: (chan, fn) => nat().onEvent(chan, fn) };
}
// Is iCUE running? One tasklist run answers for 10 s (as hs80-direct.js and the headset driver do).
function icueCheck() {
  let at = 0, seen = false, ask = null;
  return () => {
    if (Date.now() - at < 10000) return Promise.resolve(seen);
    ask ||= new Promise((resolve) => execFile('tasklist', ['/FI', 'IMAGENAME eq iCUE.exe', '/NH'], { windowsHide: true }, (e, out) => {
      seen = /iCUE\.exe/i.test(String(out)); at = Date.now(); ask = null; resolve(seen);
    }));
    return ask;
  };
}

export function createDriver({ transport = nativeTransport(), icueRunning = icueCheck(), helperSets = HELPER_SETS } = {}) {
  let cur = null;          // { model, pid, conn, ep, chan, generic }
  let readable = {};       // id -> true when it answered a GET with status 00
  let probed = false;
  let last = null;         // the last reading

  const req = (cmd, ms = 1500) => (cur ? transport.request(cur.chan, cmd, ms) : Promise.resolve('GONE'));
  // one property; null = no reply (asleep or off); { status, value, bytes } otherwise (status 05 = not supported)
  async function get(id) {
    const r = await req(`GET ${h2(id)}`);
    if (r === 'GONE') throw gone(`the ${cur ? cur.model?.name || 'Corsair receiver' : 'Corsair device'} was unplugged`);
    if (r === 'NONE' || r === 'TIMEOUT') return null;
    if (!/^[0-9a-f]{2}( [0-9a-f]{2}){5}$/.test(r)) return { status: -1, value: null, bytes: [] };
    const b = r.split(' ').map((x) => parseInt(x, 16));
    return { status: b[0], value: (b[1] | (b[2] << 8) | (b[3] << 16)) + b[4] * 2 ** 24, bytes: b.slice(1) };
  }
  const ok = (r) => (r && r.status === 0 ? r : null);

  function close() {
    if (!cur) return;
    transport.onEvent(cur.chan, null);
    transport.request(cur.chan, 'CLOSE', 3000);
    cur = null;
  }

  // which of the model's ids answer (once per connect); a device that answers nothing is asleep, asked again next time
  async function probe() {
    if (probed) return;
    const next = {};
    let any = false;
    for (const id of probeIds(cur.model, helperSets)) { const r = await get(id); if (r) any = true; if (ok(r)) next[id] = true; }
    if (!any) throw new Error(`the ${cur.model.name} is asleep or off (no reply): move it or press a key, then try again`);
    readable = next; probed = true;
  }

  async function readAll() {
    await probe();
    const v = { at: Date.now() };
    const num = async (id) => (readable[id] ? ok(await get(id))?.value ?? null : null);
    if (readable[P.battery]) { const b = await num(P.battery); v.battery = b == null ? null : Math.round(Math.min(b, 1000) / 10); }
    if (readable[P.polling]) { const p = await num(P.polling); v.polling = POLLING_HZ[p] ?? null; v.pollingRaw = p; }
    if (cur.model.kind === 'mouse') {
      const x = await num(P.dpiX), y = await num(P.dpiY);
      v.dpi = x == null ? null : y != null && (y & 0xffff) !== (x & 0xffff) ? `${x & 0xffff} x ${y & 0xffff}` : x & 0xffff;
      v.sleepMs = await num(P.sleep);
      const s = await num(P.sleepOn); v.sleepOn = s == null ? null : s === 1;
    } else {
      const b = await num(P.brightness); v.brightness = b == null ? null : Math.round(b / 10);
    }
    last = v;
    return v;
  }

  // the page's values: exactly the keys of this model's settings
  function values(v) {
    const out = {};
    for (const s of settingsFor(cur.model, { helperSets, readable })) {
      if (s.key === 'sleepTimer') out.sleepTimer = v.sleepMs == null ? null : Math.round(v.sleepMs / 60000);
      else out[s.key] = v[s.key] ?? null;
    }
    return out;
  }

  // key -> [id, raw from value, value from raw, check, why]
  const MAP = {
    sleepTimer: [P.sleep, (x) => x * 60000, (r) => Math.round(r / 60000), (x) => Number.isInteger(x) && x >= 1 && x <= SLEEP_MAX, () => `the sleep timer must be 1-${SLEEP_MAX} minutes`],
    sleepOn: [P.sleepOn, (x) => (x ? 1 : 0), (r) => r === 1, (x) => typeof x === 'boolean', () => 'the sleep timer must be on or off'],
    brightness: [P.brightness, (x) => x * 10, (r) => Math.round(r / 10), (x) => Number.isInteger(x) && x >= 0 && x <= 100, () => 'brightness must be 0-100%'],
  };

  return {
    id: 'corsair-bragi-peripherals',
    get title() { return cur?.model ? cur.model.name.replace(/^CORSAIR /, 'Corsair ') : 'Corsair mouse or keyboard'; },
    kind: 'Mouse or keyboard',
    vendor: 'Corsair',
    get settings() { return cur?.model ? settingsFor(cur.model, { helperSets, readable }) : []; },
    get unsupported() {
      const m = cur?.model, out = ['firmware updates', 'receiver pairing', 'lights and per-key colours (iCUE or OpenRGB: Lighting page)', 'button and macro assignments'];
      if (!m || m.kind === 'mouse') out.push('changing DPI, DPI stages and the polling rate (DeviceHub\'s helper cannot send them yet; they are shown as readings)', 'angle snapping, lift height, left-hand mode, button response (write-only in every source)');
      if (!m || m.kind === 'keyboard') out.push('changing the polling rate (shown as a reading)', 'Win-lock and the other key locks');
      // a setting this kind has but the device did not answer a read of
      const kindKeys = m?.kind === 'mouse' ? ['dpi', 'sleepTimer', 'sleepOn', 'polling'] : ['brightness', 'polling'];
      if (m && probed) for (const k of kindKeys) if (!settingsFor(m, { helperSets, readable }).some((x) => x.key === k)) out.push(`${k} (this ${m.kind} did not answer a read of it, or DeviceHub's helper cannot send it)`);
      return out;
    },
    get model() { return cur?.model || null; },
    get connection() { return cur?.conn || null; },

    // the maker's app check the self-check asks for (helpers/my-devices.mjs): its name while it runs, else null
    async vendorApp() { return (await icueRunning()) ? 'iCUE.exe' : null; },

    // Finds a plugged-in model: the helper's read-only list of Bragi collections (usage page FF42, usage 01; opened
    // with access 0, nothing sent), then one OPEN on its channel. A cable before a receiver (as hs80-direct.js). On a
    // generic Slipstream receiver, one GET 12 on endpoint 09 names the paired model (sheet section 2).
    // Reads (GETs only) go ahead while iCUE runs; write() refuses then.
    async connect() {
      close();
      const list = String(await transport.request('hidlist', 'FF42 01', 5000));
      const rank = (f) => (f.conn === 'cable' ? 0 : f.generic ? 2 : 1);
      const found = list.split('|').map((l) => l.trim().split(' ')).filter((w) => w.length >= 2 && w[0].toUpperCase() === '1B1C')
        .map((w) => identify(w[1])).filter(Boolean).sort((a, b) => rank(a) - rank(b));
      for (const f of found) {
        const chan = `hs80:${f.pid}:${f.ep}:bragi`;
        const r = await transport.request(chan, 'OPEN', 15000);
        if (r !== 'OK') { transport.request(chan, 'CLOSE', 3000); continue; }   // a channel left open keeps a helper thread
        cur = { ...f, chan }; probed = false; readable = {}; last = null;
        if (f.generic) {
          const p = ok(await get(P.productId).catch(() => null));
          const m = p ? modelOf(h4(p.value & 0xffff)) : null;
          if (!m) { close(); continue; }   // nothing paired, asleep, or a model this driver does not know
          cur.model = m; cur.paired = h4(p.value & 0xffff);
        }
        transport.onEvent(chan, () => {});   // notices (input report 03) are not used here
        return true;
      }
      return false;
    },

    // one quick question while asleep
    async awake() { try { return !!(await get(P.battery)); } catch { return false; } },

    async info() {
      const m = cur.model;
      let fw = null;
      try {
        const f = ok(await get(P.firmware));
        if (f) fw = `${f.bytes[0]}.${f.bytes[1]}.${m.kind === 'mouse' ? f.bytes[2] | (f.bytes[3] << 8) : f.bytes[2]}`;
      } catch (e) { if (e.gone) throw e; }
      const out = { Model: m.name, Type: m.kind, Firmware: fw || 'wake the device to read it', Connection: cur.conn === 'cable' ? 'USB cable' : 'wireless receiver', 'USB id': `1b1c:${cur.pid.toLowerCase()}` };
      if (cur.paired) out['Paired device id'] = `1b1c:${cur.paired.toLowerCase()}`;
      if (m.kind === 'mouse' && last && typeof last.dpi === 'string') out['DPI (X x Y)'] = last.dpi;
      out.Control = 'DeviceHub direct, Corsair property protocol (no iCUE); library driver, read-only until proven';
      return out;
    },

    async read() { return values(await readAll()); },

    async battery() {
      const v = last && Date.now() - last.at < 5000 ? last : await readAll();
      // no charging flag is documented for mice or keyboards (sheet section 6: "Battery status 10 ... no value meanings")
      return v.battery == null ? null : { percent: v.battery, charging: null };
    },

    // One setting: checked, sent only if the helper takes it, then read back and compared.
    async write(key, value) {
      if (!cur?.model) throw gone('the Corsair device is not connected');
      const m = cur.model;
      const s = settingsFor(m, { helperSets, readable }).find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting DeviceHub can change on the ${m.name}`);
      if (s.type === 'display') throw new Error(`${s.label} is a reading here: DeviceHub's helper cannot send it`);
      const [id, toRaw, fromRaw, check, why] = MAP[key];
      if (!check(value)) throw new Error(why());
      if (await icueRunning()) throw Object.assign(new Error('iCUE is open: change this in iCUE, or close iCUE to change it here'), { waiting: true });
      // the raw value now: the same value goes back as exactly this raw value, never re-derived from rounded units
      const now = ok(await get(id));
      if (!now) throw new Error(`the ${m.kind} did not answer a read of ${s.label} before the write (is it awake?)`);
      const same = fromRaw(now.value) === value;
      const raw = same ? now.value : toRaw(value);
      if (!canSet(helperSets, id, raw)) {
        throw new Error(same ? `the ${m.kind} holds raw ${now.value} for ${s.label}, which DeviceHub's helper cannot send back exactly, so nothing was written` : `DeviceHub's helper cannot send ${key} = ${value}`);
      }
      const r = await req(`SET ${h2(id)} ${raw}`, 3000);
      if (r === 'GONE') throw gone(`the ${m.name} was unplugged`);
      if (r !== '00') throw new Error(r === 'NONE' || r === 'TIMEOUT' ? `the ${m.kind} did not answer (is it awake?)` : `the ${m.kind} refused it (${r})`);
      const back = ok(await get(id));
      if (!back || back.value !== raw) throw new Error(`the ${m.kind} reads ${back ? back.value : 'nothing'} after setting ${raw}`);
      if (last) { if (id === P.sleep) last.sleepMs = back.value; else if (id === P.sleepOn) last.sleepOn = back.value === 1; else last.brightness = Math.round(back.value / 10); }
      return fromRaw(back.value);
    },

    // Every safe read (sheet section 4 "Safe to read first") for this kind, raw.
    async rawBackup() {
      const m = cur.model;
      const ids = [P.battery, P.chargeStatus, P.vendorId, P.productId, P.firmware, P.connection, P.lightMode, P.polling,
        ...(m.kind === 'mouse' ? [P.dpiX, P.dpiY, P.sleep, ...(readable[P.sleepOn] ? [P.sleepOn] : [])] : [P.brightness])];
      const props = {};
      for (const id of ids) { const r = await get(id); props[h2(id)] = r ? { status: r.status, value: r.value } : null; }
      return { model: m.key, pid: cur.pid, paired: cur.paired || null, connection: cur.conn, props };
    },

    close,
  };
}

export default createDriver();
