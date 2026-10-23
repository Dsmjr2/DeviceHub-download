// Corsair wireless headsets on the Bragi property protocol, other than the HS80 RGB Wireless (22 Oct 2026).
// Written only from docs/brands/corsair.md (the "sheet"; every id below cites its section and row) and the working HS80
// code it describes (helpers/hs80-direct.js, helpers/native/hs80io.cs: reused through the helper's hs80 channel, not
// edited). Not yet run on a real headset: status "read-only" in device.json, so DeviceHub offers it and proves it first.
//
// HID LAYER (22 Oct 2026; docs/handoff/hid-core.md):
//   1. Writes the helper takes: helpers/native/hs80io.cs Hs80Io.Set now also accepts 0d (0 / 1, sleep timer on/off),
//      46 (0 / 1, sidetone on/off, 0 = on) and 47 (0-1000, sidetone level), and a SET outside its list answers
//      "ERR ..." with the handle kept (it was GONE and closed the handle). HELPER_SETS below lists all six (done
//      22 Oct 2026, docs/handoff/driver-coverage.md); tests/sim-corsair.mjs runs both today's helper and an older one.
//      Each of 0d / 46 / 47 is offered only when the headset answers a GET for it (read before write: the sheet
//      marks them "W" only, so a headset that does not read them back never gets them).
//   2. Other product ids on the hs80 channel: `hs80:<pid>:<ep>:bragi` already opens any 1B1C pid whose Bragi
//      collection is usage page FF42, usage 01, 64-byte output reports (HidFind.Find(pid)), with endpoint 08 or 09;
//      nothing in the channel is tied to 0A6B / 0A69. A model with another report size would not open (untested).
//   3. Lights. Still missing: OPENLIGHT is fixed to handle 0 on resource 01 and LIGHT to the HS80's 9 bytes. The HS80
//      MAX needs resource 22 with a `12 00` data type tag and 2 zones in RGBRGB order (sheet section 2 and 3), but the
//      sheet does not give its exact write frame. Needed: `OPENLIGHT <resource>` and a raw `LIGHTDATA <hex...>`, plus a
//      read-only capture of iCUE setting each zone, before any light write. Until then no light write is ever sent.
//   4. tested: [] is now accepted for a "read-only" entry (helpers/device-library.mjs validateMeta); device.json still
//      carries its one record saying it was the simulation only.
//   Not a code change, a measurement: voltage 53 is documented for the HS80 only (sheet section 3 "Battery voltage",
//   "others unconfirmed"), so charging on a wall charger is read from it only when the headset answers it with a
//   plausible cell voltage; on its USB cable a headset counts as charging, as the HS80 does.
//
// Safety (CLAUDE.md "Rules that are never broken"; sheet section 4 "Never"): only GET (02) and, for the ids in
// WRITES, SET (01) are sent, through the helper's own GET / SET. No handle is ever opened (so pairing resources 05 / 06
// and key or macro handles cannot be reached), no firmware, bootloader or radio path, no sleep-now (03 = 4), no
// light mode change. While iCUE runs it still reads (GETs only, as every other library driver does) and refuses every
// write (sheet section 4: both would talk on the same channel).
// Write-back of the same value (driver safety, 22 Oct 2026, docs/handoff/driver-safety.md): the page shows minutes and
// percent, the headset holds ms and tenths. write() reads the raw value first; when the value asked for is the one that
// raw value shows (the self-check's write of what it just read), that exact raw value is sent back, never a rounded one,
// and the read-back is compared raw against what was sent.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { chargerLifted } from '../../public/devices/headset-adapter.js';

// DeviceHub's built-in adapter owns the HS80 RGB Wireless (sheet section 1 "Headsets", first row: cable 0A69, behind a
// receiver 0A71, receiver 0A6B). Never in the table below; the test checks.
export const HS80_OWN_PIDS = ['0A69', '0A6B', '0A71'];
// The HS80 RGB USB (0A88, wired only) is left out: OpenLinkHub (e3cae8cb) runs it with its own hs80rgb package, not
// bragi: 16-byte output reports c8 (device mode), c9 (LED init), cb (colours), all write-only, firmware from the USB
// bcdDevice, mute from reports starting 64 on interface 3. Nothing is read back, so there is nothing here to offer.


// Endpoints (sheet section 2 "The bragi frame" and "Receiver vs cable"): 09 = the headset through its receiver,
// 08 = the device that is plugged in (the headset on its own USB cable).
export const EP = { receiver: 9, cable: 8 };

// Property ids (sheet section 3 "Settings map").
export const P = {
  battery: 0x0f,       // "Battery level": 0-1000, tenths of a percent; all bragi (DH, OpenLinkHub, HeadsetControl, ckb-next)
  chargeStatus: 0x10,  // "Battery / charge status": values unconfirmed (ckb-next bragi_proto.h names it), backup only
  firmware: 0x13,      // "Firmware (app)": bytes = major, minor, patch; all bragi (ckb-next). 14-16 (bootloader, radio) never asked
  connection: 0x36,    // "Connection status": sub-device bit field (ckb-next, OpenLinkHub), backup only
  voltage: 0x53,       // "Battery voltage": millivolts; HS80 (DH), others unconfirmed
  lightMode: 0x03,     // "Light mode": read for the backup only, never written here (lights are a gap)
  sleepOn: 0x0d,       // "Sleep timer on/off": W 0 / 1 (OpenLinkHub hs80maxW.go / virtuosorgbXTW.go, HeadsetControl corsair_void_v2w.hpp)
  sleep: 0x0e,         // "Sleep timer": R/W uint32 ms (OpenLinkHub 1-60 min, HeadsetControl, DH)
  sidetoneOff: 0x46,   // "Sidetone on/off": W, 0 = on, 1 = off (OpenLinkHub and HeadsetControl agree)
  sidetoneLevel: 0x47, // "Sidetone level": W, 0-1000 (OpenLinkHub, HeadsetControl corsair_void_v2w.hpp / corsair_virtuoso_xt.hpp)
};
// Documented but left out (docs/handoff/driver-coverage.md): brightness 02 and light mode 03 writes (lights; HID LAYER 3),
// ANC d1 (sheet section 3: meaning unconfirmed; not in the helper's SET list), EQ presets (no bragi property in any
// source; the iCUE SDK's CDPI_EqualizerPreset needs iCUE running), charge status 10 values (unconfirmed).

// One row per model (sheet section 1 "Headsets" for the ids, section 2 "What carries over" and section 3 for the rest).
//   mic: the mic-muted property (section 3 "Mic muted (boom up)" a6: HS80 MAX, Void V2; "Mic muted" 8e: Virtuoso XT);
//        null where the sheet names none for the model
//   sleepOn / sidetone: section 3 rows "Sleep timer on/off" and "Sidetone on/off" / "Sidetone level" list the model
//   sleepMax: minutes; OLH's 1-60 (section 3 "Sleep timer": OLH 1-60 min, HSC up to 90, DH 1-120 for the HS80 only),
//        the range every source agrees on
//   lights: what the sheet says, for the record; nothing here writes them (HID LAYER 3)
export const MODELS = [
  { key: 'hs80-max', name: 'CORSAIR HS80 MAX Wireless', cables: [], receivers: ['0A97', '2A0F', '2A0C'],
    mic: 0xa6, sleepOn: true, sidetone: true, sleepMax: 60,
    lights: { resource: 0x22, order: 'RGBRGB', zones: ['logo', 'mic'], tag: [0x12, 0x00] },
    source: 'section 1 "HS80 MAX Wireless" (cable id not listed); section 2 "Differs per model"' },
  { key: 'virtuoso-xt', name: 'CORSAIR Virtuoso RGB Wireless XT', cables: ['0A62'], receivers: ['0A64'],
    mic: 0x8e, sleepOn: true, sidetone: true, sleepMax: 60,
    lights: { resource: 0x01, order: null, zones: null },
    source: 'section 1 "Virtuoso RGB Wireless XT"; section 3 "Mic muted" 8e' },
  { key: 'void-v2', name: 'CORSAIR Void Wireless V2', cables: [], receivers: ['2A08'],
    mic: 0xa6, sleepOn: true, sidetone: true, sleepMax: 60, lights: null,
    source: 'section 1 "Void Wireless V2" (cable id not listed); section 3 "Mic muted (boom up)" a6' },
  // Same frame and ids for battery, firmware and sleep (section 2 "What carries over": "every bragi headset in OLH ...
  // Virtuoso XT/SE/original, Void V2, Void MAX V2"); the sheet names no mic or sidetone property for these, so they
  // get battery, firmware and the sleep timer only.
  { key: 'virtuoso-se', name: 'CORSAIR Virtuoso SE', cables: ['0A3D', '0A3F'], receivers: ['0A3E', '0A40'],
    mic: null, sleepOn: false, sidetone: false, sleepMax: 60, lights: null, source: 'section 1 "Virtuoso SE"' },
  { key: 'virtuoso', name: 'CORSAIR Virtuoso RGB Wireless', cables: ['0A41', '0A43'], receivers: ['0A42', '0A44'],
    mic: null, sleepOn: false, sidetone: false, sleepMax: 60, lights: null, source: 'section 1 "Virtuoso RGB Wireless (original)"' },
  { key: 'void-max-v2', name: 'CORSAIR Void MAX Wireless V2', cables: [], receivers: ['2A12', '2A05'],
    mic: null, sleepOn: false, sidetone: false, sleepMax: 60, lights: null, source: 'section 1 "Void MAX Wireless V2"' },
  // Section 1 "Virtuoso MAX Wireless" (OpenLinkHub devices.go, HeadsetControl corsair_void_v2w.hpp: receiver 2A02, Xbox
  // 2A03; cable id not listed). Section 3 "Battery level" and "Firmware" are "all bragi", "Sleep timer" headsets; its
  // mic and sidetone rows do not name this model, so it gets battery, firmware and the sleep timer only.
  { key: 'virtuoso-max', name: 'CORSAIR Virtuoso MAX Wireless', cables: [], receivers: ['2A02', '2A03'],
    mic: null, sleepOn: false, sidetone: false, sleepMax: 60, lights: null, source: 'section 1 "Virtuoso MAX Wireless"' },
];
export const ALL_PIDS = MODELS.flatMap((m) => [...m.cables, ...m.receivers]);

// What this driver lets the native helper SET (hs80io.cs Hs80Io.Set): id -> [min, max] raw. canSet() keeps anything
// else from being sent. 0d, 46 and 47 joined on 22 Oct 2026 (HID LAYER 1); a helper older than that refuses them,
// and the tests run both.
export const HELPER_SETS = { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000], 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] };
// the only ids this driver ever writes
const WRITES = [P.sleep, P.sleepOn, P.sidetoneOff, P.sidetoneLevel];

const h2 = (n) => n.toString(16).padStart(2, '0');
const gone = (msg) => Object.assign(new Error(msg), { gone: true });

// The transport: the native helper (helpers/native.js), loaded on first use so importing this file starts nothing.
function nativeTransport() {
  let n = null;
  const nat = () => (n ||= createRequire(import.meta.url)('../../helpers/native.js'));
  return { request: (chan, cmd, ms) => nat().request(chan, cmd, ms), onEvent: (chan, fn) => nat().onEvent(chan, fn) };
}
// Is iCUE running? One tasklist run answers for 10 s (as hs80-direct.js does).
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

// The settings a model's page shows: only what its row lists, the helper can send, and (for the optional ones) the
// headset answered a GET for.
export function settingsFor(model, { helperSets = HELPER_SETS, readable = {} } = {}) {
  if (!model) return [];
  const can = (id, lo, hi) => canSet(helperSets, id, lo) && canSet(helperSets, id, hi);
  const out = [];
  if (can(P.sleep, 60000, model.sleepMax * 60000)) out.push({ key: 'sleepTimer', label: 'Sleep when silent', type: 'slider', min: 1, max: model.sleepMax, unit: ' min', hint: 'How long the headset waits in silence before it turns itself off' });
  if (model.sleepOn && can(P.sleepOn, 0, 1) && readable.sleepOn) out.push({ key: 'sleepOn', label: 'Sleep timer', type: 'toggle', hint: 'Off: the headset stays on until you switch it off' });
  if (model.sidetone && can(P.sidetoneOff, 0, 1) && readable.sidetoneOff) out.push({ key: 'sidetoneOn', label: 'Sidetone', type: 'toggle', hint: 'Hear your own voice in the headset (check by ear the first time: the sheet marks its on/off value worth checking)' });
  if (model.sidetone && can(P.sidetoneLevel, 0, 1000) && readable.sidetoneLevel) out.push({ key: 'sidetone', label: 'Sidetone level', type: 'slider', min: 0, max: 100, unit: '%', live: true });
  return out;
}
export function canSet(helperSets, id, raw) {
  const r = helperSets[id];
  return WRITES.includes(id) && !!r && Number.isInteger(raw) && raw >= r[0] && raw <= r[1];
}

// The model a plugged-in product id belongs to: { model, pid, conn, ep } or null.
export function identify(pid) {
  const p = String(pid).toUpperCase();
  if (HS80_OWN_PIDS.includes(p)) return null;
  for (const m of MODELS) {
    if (m.cables.includes(p)) return { model: m, pid: p, conn: 'cable', ep: EP.cable };
    if (m.receivers.includes(p)) return { model: m, pid: p, conn: 'receiver', ep: EP.receiver };
  }
  return null;
}

export function createDriver({ transport = nativeTransport(), icueRunning = icueCheck(), helperSets = HELPER_SETS } = {}) {
  let cur = null;          // { model, pid, conn, ep, chan }
  let readable = {};       // optional ids that answered a GET: { sleepOn, sidetoneOff, sidetoneLevel }
  let probed = false;
  let last = null;         // the last reading: { at, battery, voltage, firmware, sleepMs, micMuted, ... }
  let micMuted = null;

  const req = (cmd, ms = 1500) => (cur ? transport.request(cur.chan, cmd, ms) : Promise.resolve('GONE'));
  // one property; null = no reply (asleep or off); { status, value, bytes } otherwise (status 05 = not supported)
  async function get(id) {
    const r = await req(`GET ${h2(id)}`);
    if (r === 'GONE') throw gone(`the ${cur ? cur.model.name : 'headset'} receiver was unplugged`);
    if (r === 'NONE' || r === 'TIMEOUT') return null;
    if (!/^[0-9a-f]{2}( [0-9a-f]{2}){5}$/.test(r)) return { status: -1, value: null, bytes: [] };
    const b = r.split(' ').map((x) => parseInt(x, 16));
    return { status: b[0], value: (b[1] | (b[2] << 8) | (b[3] << 16)) + b[4] * 2 ** 24, bytes: b.slice(1) };
  }
  const ok = (r) => (r && r.status === 0 ? r : null);

  function onEvent(id, v) { if (cur && cur.model.mic != null && id === cur.model.mic) micMuted = v === 1; }

  function close() {
    if (!cur) return;
    transport.onEvent(cur.chan, null);
    transport.request(cur.chan, 'CLOSE', 3000);
    cur = null;
  }

  // the optional settings are offered only if the headset answers them (never asked for while the helper cannot set them)
  async function probe() {
    if (probed) return;
    const m = cur.model, next = {};
    if (m.sleepOn && canSet(helperSets, P.sleepOn, 0)) next.sleepOn = !!ok(await get(P.sleepOn));
    if (m.sidetone && canSet(helperSets, P.sidetoneOff, 0)) next.sidetoneOff = !!ok(await get(P.sidetoneOff));
    if (m.sidetone && canSet(helperSets, P.sidetoneLevel, 0)) next.sidetoneLevel = !!ok(await get(P.sidetoneLevel));
    readable = next; probed = true;
  }

  async function readAll() {
    const b = ok(await get(P.battery));
    if (!b) throw new Error('the headset is asleep or off (no reply)');
    const m = cur.model;
    const v = { at: Date.now(), battery: Math.round(b.value / 10) };
    const mv = ok(await get(P.voltage));
    v.voltage = mv && mv.value >= 3000 && mv.value <= 4500 ? mv.value : null;  // a plausible lithium cell, else unknown
    const s = ok(await get(P.sleep));
    v.sleepMs = s ? s.value : null;
    if (m.mic != null) { const x = ok(await get(m.mic)); if (x) micMuted = x.value === 1; }
    v.micMuted = micMuted;
    await probe();
    if (readable.sleepOn) { const x = ok(await get(P.sleepOn)); v.sleepOn = x ? x.value === 1 : null; }
    if (readable.sidetoneOff) { const x = ok(await get(P.sidetoneOff)); v.sidetoneOn = x ? x.value === 0 : null; }
    if (readable.sidetoneLevel) { const x = ok(await get(P.sidetoneLevel)); v.sidetone = x ? Math.round(x.value / 10) : null; }
    last = v;
    return v;
  }

  // the page's values: only the keys of this model's settings, plus micMuted (read-only, shown in info)
  function values(v) {
    const out = {};
    for (const s of settingsFor(cur.model, { helperSets, readable })) {
      if (s.key === 'sleepTimer' && v.sleepMs != null) out.sleepTimer = Math.round(v.sleepMs / 60000);
      else if (s.key in v && v[s.key] != null) out[s.key] = v[s.key];
    }
    if (cur.model.mic != null) out.micMuted = v.micMuted;
    return out;
  }

  // key -> [id, raw from value, value from raw, check]
  const MAP = {
    sleepTimer: [P.sleep, (x) => x * 60000, (r) => Math.round(r / 60000), (x, m) => Number.isInteger(x) && x >= 1 && x <= m.sleepMax, (m) => `sleep timer must be 1-${m.sleepMax} minutes`],
    sleepOn: [P.sleepOn, (x) => (x ? 1 : 0), (r) => r === 1, (x) => typeof x === 'boolean', () => 'sleep timer must be on or off'],
    sidetoneOn: [P.sidetoneOff, (x) => (x ? 0 : 1), (r) => r === 0, (x) => typeof x === 'boolean', () => 'sidetone must be on or off'],
    sidetone: [P.sidetoneLevel, (x) => x * 10, (r) => Math.round(r / 10), (x) => Number.isInteger(x) && x >= 0 && x <= 100, () => 'sidetone level must be 0-100%'],
  };

  return {
    id: 'corsair-bragi-headset',
    get title() { return cur ? cur.model.name.replace(/^CORSAIR /, 'Corsair ') : 'Corsair wireless headset'; },
    kind: 'Headset',
    get settings() { return cur ? settingsFor(cur.model, { helperSets, readable }) : settingsFor(MODELS[0], { helperSets }).filter((s) => s.key === 'sleepTimer'); },
    get unsupported() {
      const m = cur?.model, out = ['firmware updates', 'receiver pairing', 'lights (they keep their own; iCUE sets them)'];
      if (m?.sidetone && !settingsFor(m, { helperSets, readable }).some((s) => s.key === 'sidetone')) out.push('sidetone (this headset did not answer a read of it, so DeviceHub cannot check a change)');
      if (m && !m.sidetone) out.push('sidetone');
      if (m && m.mic == null) out.push('mic mute state');
      out.push('EQ presets (no documented headset property; Windows sound and Equalizer APO do the EQ)', 'noise cancelling (property d1: its meaning is unconfirmed)');
      return out;
    },
    get model() { return cur?.model || null; },
    get connection() { return cur?.conn || null; },

    // Finds a plugged-in model: the helper's read-only list of Bragi collections (usage page FF42, usage 01; opened
    // with access 0, nothing sent), then one OPEN on its channel. The cable before the receiver (as hs80-direct.js).
    // Reads (GETs only) go ahead while iCUE runs; write() refuses then.
    async connect() {
      close();
      const list = String(await transport.request('hidlist', 'FF42 01', 5000));
      const found = list.split('|').map((l) => l.trim().split(' ')).filter((w) => w.length >= 2 && w[0].toUpperCase() === '1B1C')
        .map((w) => identify(w[1])).filter(Boolean).sort((a, b) => (a.conn === 'cable' ? 0 : 1) - (b.conn === 'cable' ? 0 : 1));
      for (const f of found) {
        const chan = `hs80:${f.pid}:${f.ep}:bragi`;
        const r = await transport.request(chan, 'OPEN', 15000);
        if (r === 'OK') {
          cur = { ...f, chan }; probed = false; readable = {}; last = null; micMuted = null;
          transport.onEvent(chan, onEvent);
          return true;
        }
        transport.request(chan, 'CLOSE', 3000);   // a channel left open keeps a helper thread
      }
      return false;
    },

    // one quick question while asleep
    async awake() { try { return !!ok(await get(P.battery)); } catch { return false; } },

    async info() {
      const m = cur.model;
      let fw = null;
      try { const f = ok(await get(P.firmware)); if (f) fw = f.bytes.slice(0, 3).join('.'); } catch (e) { if (e.gone) throw e; }
      const out = { Model: m.name, Firmware: fw || 'turn the headset on to read it', Connection: cur.conn === 'cable' ? 'USB cable' : 'wireless receiver', 'USB id': `1b1c:${cur.pid.toLowerCase()}` };
      if (m.mic != null) out.Mic = micMuted == null ? '—' : micMuted ? 'muted' : 'live';
      out.Control = 'DeviceHub direct, Corsair property protocol (no iCUE); library driver, read-only until proven';
      return out;
    },

    async read() { return values(await readAll()); },

    async battery() {
      const v = last && Date.now() - last.at < 5000 ? last : await readAll();
      // on its own cable it charges (as the HS80, headset-adapter.js); on a wall charger only the voltage can tell
      const charging = cur.conn === 'cable' ? true : v.voltage != null ? chargerLifted(v.battery, v.voltage) : null;
      return { percent: v.battery, charging };
    },

    // One setting: checked, sent only if the helper takes it, then read back and compared.
    async write(key, value) {
      if (!cur) throw gone('the headset is not connected');
      const m = cur.model;
      if (!settingsFor(m, { helperSets, readable }).some((s) => s.key === key)) throw new Error(`${key} is not a setting DeviceHub has for the ${m.name}`);
      const [id, toRaw, fromRaw, check, why] = MAP[key];
      if (!check(value, m)) throw new Error(why(m));
      if (await icueRunning()) throw Object.assign(new Error('iCUE is open: change this in iCUE, or close iCUE to change it here'), { waiting: true });
      // the raw value now: the same value goes back as exactly this raw value, never re-derived from rounded units
      const now = ok(await get(id));
      if (!now) throw new Error('the headset did not answer a read of it before the write (is it on?)');
      const same = fromRaw(now.value) === value;
      const raw = same ? now.value : toRaw(value);
      if (!canSet(helperSets, id, raw)) {
        throw new Error(same ? `the headset holds raw ${now.value} for ${key}, which DeviceHub's helper cannot send back exactly, so nothing was written` : `DeviceHub's helper cannot send ${key} = ${value}`);
      }
      const r = await req(`SET ${h2(id)} ${raw}`, 3000);
      if (r === 'GONE') throw gone(`the ${m.name} receiver was unplugged`);
      if (r !== '00') throw new Error(r === 'NONE' || r === 'TIMEOUT' ? 'the headset did not answer (is it on?)' : `the headset refused it (${r})`);
      const back = ok(await get(id));
      if (!back || back.value !== raw) throw new Error(`the headset reads ${back ? back.value : 'nothing'} after setting ${raw}`);
      if (last) { if (id === P.sleep) last.sleepMs = back.value; else if (id === P.sleepOn) last.sleepOn = back.value === 1; else if (id === P.sidetoneOff) last.sidetoneOn = back.value === 0; else last.sidetone = Math.round(back.value / 10); }
      return fromRaw(back.value);
    },

    // Every safe read (sheet section 4 "Safe to read first") this model has, raw.
    async rawBackup() {
      const m = cur.model;
      const ids = [P.battery, P.chargeStatus, P.firmware, P.connection, P.voltage, P.lightMode, P.sleep, ...(m.mic != null ? [m.mic] : []),
        ...(readable.sleepOn ? [P.sleepOn] : []), ...(readable.sidetoneOff ? [P.sidetoneOff] : []), ...(readable.sidetoneLevel ? [P.sidetoneLevel] : [])];
      const props = {};
      for (const id of ids) { const r = await get(id); props[h2(id)] = r ? { status: r.status, value: r.value } : null; }
      return { model: m.key, pid: cur.pid, connection: cur.conn, props };
    },

    close,
  };
}

export default createDriver();
