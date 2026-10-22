// Corsair wireless and wired mice and keyboards on the Bragi property protocol (22 Oct 2026).
// Written only from docs/brands/corsair.md (the "sheet"; every id below cites its section and row, and the sheet cites
// OpenLinkHub (OLH), ckb-next (ckb) and DeviceHub's HS80 code (DH)) and the working HS80 transport it describes
// (helpers/native/hs80io.cs through the helper's hs80 channel: reused, not edited). Never run on a real mouse or
// keyboard: status "untested" in device.json, so DeviceHub offers it on a click and loads it read-only until each
// setting passes the self-check.
//
// HID LAYER (what this driver takes from DeviceHub's helper; docs/handoff/hid-core.md, docs/handoff/drivers-round3b.md):
//   1. The channel is the helper's hs80 channel with the PERIPHERAL frame: `hs80:<pid>:<ep>:bragi:frame=peripheral`
//      (helper.cs HandleHs80, hs80io.cs; docs/handoff/corsair-peripheral-frame.md). OPEN finds a 1B1C collection on
//      usage page FF42, usage 01, 65-byte output reports (no report ids: Windows' report id 00 + 64 data bytes);
//      GET <id> sends `00 <ep> 02 <id lo> <id hi>`, SET <id> <value> sends `00 <ep> 01 <id> 00 <value LE>` for the
//      ids and ranges in Hs80Io.PeripheralAllows only (PERIPHERAL_SETS below) and answers ERR for anything else
//      (nothing sent); FRAME answers which frame the channel speaks. This is the frame OpenLinkHub's mice and keyboards
//      use (m75W.go / k70core.go transfer(): bufferW[0] = 0, bufferW[1] = endpoint, command from bufferW[2]; value
//      read at [3:5] once hidapi drops the 00) and ckb-next's (bragi_common.c { 08, cmd, prop, 0 }, status response[2]).
//   2. If the peripheral frame does not open (NODEVICE: the device's FF42 collection has 64-byte reports with an id),
//      the headset frame is tried on the same id (`hs80:<pid>:<ep>:bragi`, 02 prefix, 64 bytes; sheet section 6:
//      "unconfirmed: whether the 02 prefix applies to some mouse interfaces on Windows"), with the headset's SET list
//      (HEADSET_SETS). An older helper that ignores the frame part answers ERR to FRAME: the channel is then the
//      headset frame too. Nothing is written before a GET of the same id has answered, so a frame mismatch can only
//      end in silence.
//   3. The endpoint behind a Slipstream receiver is 09: ckb-next usb_bragi.c routes a child's packets through its
//      parent with `pkt[0] |= kb->bragi_child_id` (08 | 1), OpenLinkHub slipstream.go `endpoint = base + 1` (0x08 + 1)
//      when one device is paired. With several paired it uses `base + deviceType` (UNCONFIRMED here: one paired device
//      assumed). The cable is 08 (ckb BRAGI_MAGIC; OLH k70core.go bufferW[1] = 0x08).
//   4. Keyboards with 128- or 1024-byte packets (sheet section 1 "Keyboards" Packet column: K70 RGB Pro / Optic, K70
//      RGB TKL, K65 RGB Mini / Pro Mini, K100 RGB; mice: the 1BE3 Scimitar Elite) cannot open on the 64-byte channel,
//      so their ids are left out of MODELS (listed in device.json doesNotWork).
//
// What the channel's SET list allows decides what is writable here. Peripheral frame (Hs80Io.PeripheralAllows): the
// sleep timer 0e 1-60 min and its on/off 0d on mice, brightness 02 on keyboards, polling 01 1-4 (125-1000 Hz) on both,
// DPI 21 / 22 100-26000 on mice whose top is documented (dpiMax). Headset frame (an older helper, or a device that
// only takes the 02 prefix): 0e, 0d, 02 as before, and DPI and polling stay readings (`display`). DPI stage 1e and
// sleep property 37 are on neither list.
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
  polling: 0x01,     // "Polling rate": R/W, 1 = 125 Hz ... 7 = 8000 (ckb 1-4, OLH to 7). Written 1-4 on the peripheral frame
  brightness: 0x02,  // "Brightness" / "Keyboard brightness": R/W 0-1000 (OLH K70 Pro). In the helper's SET list (0-1000)
  lightMode: 0x03,   // "Light mode": R/W 1 hardware / 2 software. Read for the backup only; never written here
  sleepOn: 0x0d,     // "Sleep timer on/off": W 0 / 1; "mice OLH send 01 0d 00 01". In the helper's SET list (0 / 1)
  sleep: 0x0e,       // "Sleep timer": R/W uint32 ms, "headsets, mice (OLH)", OLH 1-60 min. In the helper's SET list
  battery: 0x0f,     // "Battery level": R 0-1000, tenths of a percent, "all bragi" (DH, OLH, HSC, ckb)
  chargeStatus: 0x10,// "Battery / charge status": R, values unconfirmed (ckb names it): backup only
  vendorId: 0x11,    // "Vendor / product id": R uint16 (ckb): backup only
  productId: 0x12,   // same row; "OLH reads 12 behind a receiver" (section 2 "Receiver vs cable"): which model is paired
  firmware: 0x13,    // "Firmware (app)": R, major, minor, patch ("mouse: patch is uint16"). 14-16 never asked
  dpiX: 0x21,        // "Mouse DPI X / Y": W, "R unconfirmed" (ckb, OLH); section 4 lists 21/22 as safe reads. Written (both)
                     // on the peripheral frame only once a GET of each has answered, and read back
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
// dongle. dpiMax: the documented top DPI (section 3 "Mouse DPI X / Y": OLH m75W.go maxDpiValue 26000, darkcorergbproW.go
// 18000; ckb-next usb.c mouse_dpi_list, "Values taken from the official website"). A mouse without one never gets a DPI
// write (DPI stays a reading); the bottom is OLH minDpiValue 100.
export const MODELS = [
  // ---- mice ----
  { key: 'm75', kind: 'mouse', name: 'CORSAIR M75', devices: ['1BF0'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"; section 3 DPI "100-26000 (M75)"' },
  { key: 'm75-wireless', kind: 'mouse', name: 'CORSAIR M75 Wireless', devices: ['1BF1', '2B08'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"' },
  { key: 'm75-air', kind: 'mouse', name: 'CORSAIR M75 Air', devices: ['1BF2'], receivers: [], dpiMax: 26000, source: 'section 1 "M75 / M75 Wireless / M75 Air"' },
  { key: 'm65-ultra', kind: 'mouse', name: 'CORSAIR M65 RGB Ultra', devices: ['1B9E'], receivers: [], source: 'section 1 "M65 RGB Ultra / Ultra Wireless"' },
  { key: 'm65-ultra-wireless', kind: 'mouse', name: 'CORSAIR M65 RGB Ultra Wireless', devices: ['1BB5', '1BD6'], receivers: [], source: 'section 1 "M65 RGB Ultra / Ultra Wireless"' },
  { key: 'dark-core-pro', kind: 'mouse', name: 'CORSAIR Dark Core RGB Pro', devices: ['1B80'], receivers: ['1B81'], dpiMax: 18000, source: 'section 1 "Dark Core RGB Pro / Pro SE" (ckb USES_BRAGI); section 3 DPI "100-18000 (Dark Core Pro)"' },
  { key: 'dark-core-pro-se', kind: 'mouse', name: 'CORSAIR Dark Core RGB Pro SE', devices: ['1B7E'], receivers: ['1B7F'], dpiMax: 18000, source: 'section 1 "Dark Core RGB Pro / Pro SE"; ckb-next usb.c mouse_dpi_list P_DARK_CORE_RGB_PRO_SE 18000' },
  { key: 'harpoon-wireless', kind: 'mouse', name: 'CORSAIR Harpoon RGB Wireless', devices: ['1B5E'], receivers: ['1B65'], dpiMax: 10000, source: 'section 1 "Harpoon RGB Wireless" (ckb; OLH); ckb-next usb.c mouse_dpi_list P_HARPOON_WL_U (1b5e) 10000' },
  { key: 'sabre-pro', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro', devices: ['1B79'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-pro-wireless', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro Wireless', devices: ['1B98'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-pro-cs', kind: 'mouse', name: 'CORSAIR Sabre RGB Pro CS', devices: ['1B7A'], receivers: [], source: 'section 1 "Sabre RGB Pro / Pro Wireless / Pro CS" (OLH)' },
  { key: 'sabre-v2-pro', kind: 'mouse', name: 'CORSAIR Sabre V2 Pro', devices: ['2B28'], receivers: ['2B2A'], source: 'section 1 "Sabre V2 Pro / MG" (OLH)' },
  { key: 'sabre-v2-mg', kind: 'mouse', name: 'CORSAIR Sabre V2 MG', devices: ['2B29'], receivers: ['2B34'], source: 'section 1 "Sabre V2 Pro / MG" (OLH)' },
  // section 1 "Katar Pro / Pro XT / Pro Wireless | 1B93 / 1BAC | 1B94": the two device ids and the one receiver id
  { key: 'katar-pro', kind: 'mouse', name: 'CORSAIR Katar Pro', devices: ['1B93'], receivers: [], dpiMax: 12400, source: 'section 1 "Katar Pro / Pro XT / Pro Wireless" (ckb; OLH); ckb-next usb.c mouse_dpi_list P_KATAR_PRO (1b93) 12400' },
  { key: 'katar-pro-xt', kind: 'mouse', name: 'CORSAIR Katar Pro XT', devices: ['1BAC'], receivers: [], dpiMax: 18000, source: 'section 1 "Katar Pro / Pro XT / Pro Wireless"; ckb-next usb.c mouse_dpi_list P_KATAR_PRO_XT (1bac) 18000' },
  { key: 'katar-pro-wireless', kind: 'mouse', name: 'CORSAIR Katar Pro Wireless', devices: [], receivers: ['1B94'], source: 'section 1 "Katar Pro / Pro XT / Pro Wireless" (receiver 1B94)' },
  { key: 'scimitar-elite-wireless', kind: 'mouse', name: 'CORSAIR Scimitar RGB Elite Wireless', devices: ['1BDB'], receivers: [], source: 'section 1 "Scimitar RGB Elite (new) / Elite Wireless / Elite Wireless SE" (1BE3 left out: 128-byte packets)' },
  { key: 'scimitar-elite-wireless-se', kind: 'mouse', name: 'CORSAIR Scimitar RGB Elite Wireless SE', devices: ['2B22'], receivers: [], source: 'section 1 "Scimitar RGB Elite ... Elite Wireless SE"' },
  { key: 'ironclaw-wireless', kind: 'mouse', name: 'CORSAIR Ironclaw RGB Wireless', devices: ['1B4C'], receivers: ['1B66'], dpiMax: 18000, source: 'section 1 "Ironclaw RGB Wireless" (ckb); ckb-next usb.c mouse_dpi_list P_IRONCLAW_W_U (1b4c) 18000' },
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

// What the helper SETs, per frame: id -> [min, max] raw. canSet() keeps anything else from being sent.
// The peripheral frame (hs80io.cs Hs80Io.PeripheralAllows; each range's source is beside it there):
export const PERIPHERAL_SETS = { 0x01: [1, 4], 0x02: [0, 1000], 0x0d: [0, 1], 0x0e: [60000, 3600000], 0x21: [100, 26000], 0x22: [100, 26000] };
// the headset frame (hs80io.cs Hs80Io.Hs80Allows: the HS80's list), used when only the 02-prefixed frame opens
export const HEADSET_SETS = { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000], 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] };
// the only ids this driver ever writes: mice the sleep timer, its on/off and DPI X / Y, keyboards the brightness, both
// the polling rate
const WRITES = [P.sleep, P.sleepOn, P.brightness, P.polling, P.dpiX, P.dpiY];
const DPI_MIN = 100;   // OLH m75W.go / darkcorergbproW.go minDpiValue
const POLL_CODES = [1, 2, 3, 4];   // 125-1000 Hz: ckb BRAGI_POLLRATE_8MS .. _1MS (5-7 only on some mice, never sent)
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

// DPI is written only on a mouse whose top is documented, and only when the channel can send X and Y over that range
function dpiWritable(model, helperSets) {
  return Number.isInteger(model.dpiMax) && [P.dpiX, P.dpiY].every((id) => canSet(helperSets, id, DPI_MIN) && canSet(helperSets, id, model.dpiMax));
}

// The settings a model's page shows: what its kind has, what answered a GET, and (for a write) what the helper sends.
export function settingsFor(model, { helperSets = PERIPHERAL_SETS, readable = {} } = {}) {
  if (!model) return [];
  const can = (id, lo, hi) => canSet(helperSets, id, lo) && canSet(helperSets, id, hi);
  const out = [];
  if (model.kind === 'mouse') {
    if (readable[P.dpiX] && readable[P.dpiY] && dpiWritable(model, helperSets)) out.push({ key: 'dpi', label: 'DPI', type: 'slider', min: DPI_MIN, max: model.dpiMax, hint: 'The mouse\'s DPI (X and Y together). The DPI button\'s stages are not changed' });
    else if (readable[P.dpiX]) out.push({ key: 'dpi', label: 'DPI', type: 'display', hint: 'As the mouse reports it. Change it on the mouse\'s DPI button (DeviceHub sends DPI only on the mice whose top DPI is documented, over the helper\'s peripheral frame).' });
    if (readable[P.sleep] && can(P.sleep, 60000, SLEEP_MAX * 60000)) out.push({ key: 'sleepTimer', label: 'Sleep when idle', type: 'slider', min: 1, max: SLEEP_MAX, unit: ' min', hint: 'How long the mouse waits before it sleeps' });
    if (readable[P.sleepOn] && can(P.sleepOn, 0, 1)) out.push({ key: 'sleepOn', label: 'Sleep timer', type: 'toggle', hint: 'Off: the mouse never sleeps by itself' });
  } else if (readable[P.brightness] && can(P.brightness, 0, 1000)) {
    out.push({ key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, unit: '%', live: true, hint: 'The keyboard\'s light brightness' });
  }
  if (readable[P.polling] && can(P.polling, POLL_CODES[0], POLL_CODES.at(-1))) out.push({ key: 'polling', label: 'Polling rate', type: 'choice', options: POLL_CODES.map((c) => ({ value: POLLING_HZ[c], label: `${POLLING_HZ[c]} Hz` })), hint: `How often the ${model.kind} reports to the PC` });
  else if (readable[P.polling]) out.push({ key: 'polling', label: 'Polling rate', type: 'display', unit: ' Hz', hint: 'As the device reports it (DeviceHub sends it only over the helper\'s peripheral frame)' });
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

// helperSets: a fixed SET list for every channel (tests: an older helper); left out, each channel's own frame decides
export function createDriver({ transport = nativeTransport(), icueRunning = icueCheck(), helperSets = null } = {}) {
  let cur = null;          // { model, pid, conn, ep, chan, generic }
  let readable = {};       // id -> true when it answered a GET with status 00
  let probed = false;
  let last = null;         // the last reading
  // the SET list of the channel in use: the peripheral frame's, or the headset frame's (an older helper, or a device
  // that opens only with the 02 prefix)
  const sets = () => helperSets || (cur?.frame === 'peripheral' ? PERIPHERAL_SETS : HEADSET_SETS);

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
    for (const id of probeIds(cur.model, sets())) { const r = await get(id); if (r) any = true; if (ok(r)) next[id] = true; }
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
    for (const s of settingsFor(cur.model, { helperSets: sets(), readable })) {
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
    polling: [P.polling, (x) => POLL_CODES.find((c) => POLLING_HZ[c] === x), (r) => POLLING_HZ[r] ?? null, (x) => POLL_CODES.some((c) => POLLING_HZ[c] === x), () => `the polling rate must be ${POLL_CODES.map((c) => POLLING_HZ[c]).join(', ')} Hz`],
  };

  // DPI: X (21) and Y (22) together, as ckb-next updatedpi_bragi and OLH m75W.go send them (16 bits LE, the helper pads
  // with zeros). Both are read first (a mouse whose X and Y differ is not written: the page has one number), then X,
  // then Y, each read back.
  async function writeDpi(s, value) {
    const m = cur.model;
    if (!(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`DPI must be a whole number ${s.min}-${s.max}`);
    if (await icueRunning()) throw Object.assign(new Error('iCUE is open: change this in iCUE, or close iCUE to change it here'), { waiting: true });
    const x = ok(await get(P.dpiX)), y = ok(await get(P.dpiY));
    if (!x || !y) throw new Error('the mouse did not answer a read of its DPI before the write (is it awake?)');
    if ((x.value & 0xffff) !== (y.value & 0xffff)) throw new Error(`the mouse's DPI is ${x.value & 0xffff} x ${y.value & 0xffff}; DeviceHub writes one DPI for both, so nothing was written`);
    const raw = (x.value & 0xffff) === value ? x.value : value;
    for (const id of [P.dpiX, P.dpiY]) if (!canSet(sets(), id, raw)) throw new Error(`DeviceHub's helper cannot send DPI ${raw}`);
    for (const id of [P.dpiX, P.dpiY]) {
      const r = await req(`SET ${h2(id)} ${raw}`, 3000);
      if (r === 'GONE') throw gone(`the ${m.name} was unplugged`);
      if (r !== '00') throw new Error(r === 'NONE' || r === 'TIMEOUT' ? 'the mouse did not answer (is it awake?)' : `the mouse refused DPI ${id === P.dpiX ? 'X' : 'Y'} (${r})`);
      const back = ok(await get(id));
      if (!back || back.value !== raw) throw new Error(`the mouse reads DPI ${id === P.dpiX ? 'X' : 'Y'} ${back ? back.value : 'nothing'} after setting ${raw}`);
    }
    if (last) last.dpi = raw & 0xffff;
    return raw & 0xffff;
  }

  return {
    id: 'corsair-bragi-peripherals',
    get title() { return cur?.model ? cur.model.name.replace(/^CORSAIR /, 'Corsair ') : 'Corsair mouse or keyboard'; },
    kind: 'Mouse or keyboard',
    vendor: 'Corsair',
    get settings() { return cur?.model ? settingsFor(cur.model, { helperSets: sets(), readable }) : []; },
    get unsupported() {
      const m = cur?.model, out = ['firmware updates', 'receiver pairing', 'lights and per-key colours (iCUE or OpenRGB: Lighting page)', 'button and macro assignments'];
      if (!m || m.kind === 'mouse') out.push('DPI stages and the DPI button (1e / 1f: no documented range)', 'angle snapping, lift height, left-hand mode, button response (write-only in every source)', 'polling rates above 1000 Hz (OpenLinkHub 5-7, on some mice only)');
      if (m?.kind === 'mouse' && !Number.isInteger(m.dpiMax)) out.push(`changing DPI on the ${m.name} (its top DPI is not documented, so DPI is a reading)`);
      if (cur && cur.frame !== 'peripheral' && !helperSets) out.push('changing DPI and the polling rate on this channel (it speaks the headset frame, whose SET list has neither)');
      if (!m || m.kind === 'keyboard') out.push('Win-lock and the other key locks');
      // a setting this kind has but the device did not answer a read of
      const kindKeys = m?.kind === 'mouse' ? ['dpi', 'sleepTimer', 'sleepOn', 'polling'] : ['brightness', 'polling'];
      if (m && probed) for (const k of kindKeys) if (!settingsFor(m, { helperSets: sets(), readable }).some((x) => x.key === k)) out.push(`${k} (this ${m.kind} did not answer a read of it, or DeviceHub's helper cannot send it)`);
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
        let chan = null, frame = null;
        for (const want of ['peripheral', 'headset']) {
          const c = want === 'peripheral' ? `hs80:${f.pid}:${f.ep}:bragi:frame=peripheral` : `hs80:${f.pid}:${f.ep}:bragi`;
          const r = await transport.request(c, 'OPEN', 15000);
          if (r !== 'OK') { transport.request(c, 'CLOSE', 3000); continue; }   // a channel left open keeps a helper thread
          // which frame the helper really opened: an older helper ignores "frame=peripheral" and answers ERR here
          frame = want === 'peripheral' && String(await transport.request(c, 'FRAME', 3000)).trim() === 'peripheral' ? 'peripheral' : 'headset';
          chan = c; break;
        }
        if (!chan) continue;
        cur = { ...f, chan, frame }; probed = false; readable = {}; last = null;
        if (f.generic) {
          const p = ok(await get(P.productId).catch(() => null));
          const m = p ? modelOf(h4(p.value & 0xffff)) : null;
          if (!m) { close(); continue; }   // nothing paired, asleep, or a model this driver does not know
          cur.model = m; cur.paired = h4(p.value & 0xffff);
        }
        transport.onEvent(chan, () => {});   // notices are not used here (the peripheral frame reads none)
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
      out.Frame = cur.frame === 'peripheral' ? 'peripheral (no report id)' : 'headset (report id 02)';
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
      const s = settingsFor(m, { helperSets: sets(), readable }).find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting DeviceHub can change on the ${m.name}`);
      if (s.type === 'display') throw new Error(`${s.label} is a reading here: DeviceHub's helper cannot send it`);
      if (key === 'dpi') return writeDpi(s, value);
      const [id, toRaw, fromRaw, check, why] = MAP[key];
      if (!check(value)) throw new Error(why());
      if (await icueRunning()) throw Object.assign(new Error('iCUE is open: change this in iCUE, or close iCUE to change it here'), { waiting: true });
      // the raw value now: the same value goes back as exactly this raw value, never re-derived from rounded units
      const now = ok(await get(id));
      if (!now) throw new Error(`the ${m.kind} did not answer a read of ${s.label} before the write (is it awake?)`);
      const same = fromRaw(now.value) === value;
      const raw = same ? now.value : toRaw(value);
      if (!canSet(sets(), id, raw)) {
        throw new Error(same ? `the ${m.kind} holds raw ${now.value} for ${s.label}, which DeviceHub's helper cannot send back exactly, so nothing was written` : `DeviceHub's helper cannot send ${key} = ${value}`);
      }
      const r = await req(`SET ${h2(id)} ${raw}`, 3000);
      if (r === 'GONE') throw gone(`the ${m.name} was unplugged`);
      if (r !== '00') throw new Error(r === 'NONE' || r === 'TIMEOUT' ? `the ${m.kind} did not answer (is it awake?)` : `the ${m.kind} refused it (${r})`);
      const back = ok(await get(id));
      if (!back || back.value !== raw) throw new Error(`the ${m.kind} reads ${back ? back.value : 'nothing'} after setting ${raw}`);
      if (last) { if (id === P.sleep) last.sleepMs = back.value; else if (id === P.sleepOn) last.sleepOn = back.value === 1; else if (id === P.polling) { last.polling = fromRaw(back.value); last.pollingRaw = back.value; } else last.brightness = Math.round(back.value / 10); }
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
