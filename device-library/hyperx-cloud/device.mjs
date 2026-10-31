// HyperX Cloud wireless headsets (HP-era dongles, vendor 03F0): Cloud II Wireless, Cloud Alpha Wireless, Cloud III
// Wireless, Cloud II Core Wireless, Cloud III S Wireless and Cloud Flight Wireless (03F0:0E90; the Kingston 0951 ids are
// in device-library/hyperx-kingston, because a library entry declares one vendor id). Written 22 Oct 2026 from docs/brands/hyperx.md only (its sources: HeadsetControl = HSC, HyperHeadset = HH);
// no code copied, never run on a real headset. Read-only first: every value is read before it is written, one setting
// is written at a time and read back, and a mismatch is put back and reported as failed.
//
// Every command byte below cites its row in docs/brands/hyperx.md section 3 ("Settings map"); frames come from section 2
// ("Headset frame families"). The only bytes that reach a device are the ones in a model's own `reads` / `writes`
// table: checkFrame() refuses everything else, and the NEVER list, before anything is sent (section 4: "Any command not
// in this table. HyperX frames have no 'not supported' status; an unknown byte may do anything.").
//
// Report id: HSC and HH write the family's first byte as byte 0 of the buffer, so it acts as the HID report id
// (section 2, "Report id vs first byte"; whether the Windows descriptor declares it is unconfirmed). This driver sends
// sendReport(<first byte>, <rest of the frame>) and reads replies the same way (data without the report id).
//
// =====================================================================================================================
// HID LAYER (22 Oct 2026: what DeviceHub's HID layer now gives this driver; docs/handoff/hid-core.md)
//
// 1. Several channels: `hid.pids` (every model's ids) + `hid.byPid` (that model's page, usage, len, report id, echo)
//    register one channel per pid (helpers/my-devices.mjs hidSpecs). Do NOT use `cablePid` for a second dongle id:
//    HostDevice.watchCable() sends the Pulsar probe `04 00 .. 00 49` every 3 s on the "cable", an unknown command to a
//    HyperX dongle (section 4, Never: any command not in the table).
// 2. Any vendor page: the Alpha Wireless and Cloud III Wireless rows have no source-named page, so their channels use
//    page / usage '*' and are chosen by output report length (`outputLen` = the row's len - 1).
// 3. Separate output and input lengths: `outputLen` / `inputLen` now size the helper's writes and reads. Both are left
//    at the row's len here: which length Windows wants is unconfirmed (section 2 table, section 6); set them per row
//    from helpers/hid-caps.ps1 before any write.
// 4. A refused output write is no longer an unplug: `refusals: true` makes the helper answer REFUSED <code>, and
//    HostDevice throws { refused: true, code } (not gone), so Link.write below falls back to sendFeatureReport.
// 5. Reading input reports without sending: `reply: 'raw'` + HostDevice.receiveReports(ms) give the dongles' notices
//    and the Kingston "prepare" read. Not used yet: the Kingston models are still left out (their rows are not written).
// =====================================================================================================================
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x03f0;
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Section 2, "Headset frame families". cmdAt / valueAt are byte positions in the whole frame (byte 0 = report id).
// replyCodes: reply bytes a get may answer with instead of its own command (Alpha: battery 25, charging 26; section 3).
// echo: how many leading data bytes (after the report id) the native helper compares (hid-host echo()).
export const FAMILIES = {
  '06ffbb': { name: '06 FF BB', header: [0x06, 0xff, 0xbb], cmdAt: 3, valueAt: 4, echo: 3, replyCodes: {} },
  '21bb': { name: '21 BB', header: [0x21, 0xbb], cmdAt: 2, valueAt: 3, echo: 1, replyCodes: { 0x0b: [0x25], 0x0c: [0x26] } },
  '66': { name: '66', header: [0x66], cmdAt: 1, valueAt: 2, echo: 1, replyCodes: {} },
  // Cloud Flight (23 Oct 2026): get 21 FF 05, reply 21 FF 05 <HI> <LO> (HSC hyperx_cloud_flight.hpp, HH cloud_flight_wireless.rs)
  '21ff': { name: '21 FF', header: [0x21, 0xff], cmdAt: 2, valueAt: 3, echo: 2, replyCodes: {} },
  // Cloud III S Wireless (23 Oct 2026, HH cloud_iii_s_wireless.rs): a get is 0C 02 03 01 00 <cmd> (byte 3 = 01 get, 00 set,
  // so a set can never pass this header), sent as a FEATURE report; the reply is input report 0C with the command at
  // byte 5 and the value at byte 6 (HH parse_response reads response[5] and response[6]). Report 0D (notices) and 05
  // (mic state) are not replies. reply: the reply's own leading bytes and command position, when they differ.
  '0c': { name: '0C', header: [0x0c, 0x02, 0x03, 0x01, 0x00], cmdAt: 5, valueAt: 6, echo: 1, replyCodes: {}, reply: { header: [0x0c], cmdAt: 5 } },
};

// Commands that look like reads or are listed beside them, and change state. Never sent, on any model, by any path.
export const NEVER = [
  { family: '06ffbb', cmd: 0x01, what: 'Cloud II Wireless (HP) wireless-status get',
    why: 'HH: it unmutes the headset (docs/brands/hyperx.md section 2 "Wired vs dongle", section 4 "Never 01")' },
  { family: '66', cmd: 0x1e, what: 'Cloud III Wireless SIRK reset',
    why: 'SIRK is the pairing key; a reset can break pairing (section 4, "Never")' },
  { family: '66', cmd: 0x83, what: 'Cloud III Wireless SIRK read',
    why: 'listed with the SIRK reset in section 4 "Never", although it sits among the 0x8x gets' },
  { bytes: [0x00, 0xde, 0xff], what: 'Pulsefire Dart save DE FF',
    why: 'writes to on-board memory (section 4, "Never"); a mouse command, refused here should any frame carry it' },
];

// Documented for a model but deliberately not sent (yet), with the sheet's reason.
const HELD = {
  alphaConnected: { cmd: 0x03, why: 'Alpha connected byte: HSC says 01 = offline, HH says 02 = connected; conflict, measure first (sections 3, 4, 6)' },
  hpLevelSet: { cmd: 0x23, why: 'Cloud II Wireless HP sidetone level set: a raw byte with no documented range (section 3, HH only)' },
};

const bool = (v) => (v === 1 ? true : v === 0 ? false : null);
const pct = (v) => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);

// ---- per-model tables (section 1 for ids, section 3 for every command) ----
// f(n) = byte n of the reply frame (as section 2 numbers it, report id = byte 0).
const HP_READS = {
  battery: { cmd: 0x02, parse: (f) => ({ percent: pct(f(7)), mV: (f(5) << 8) | f(6) }) },   // "Battery % 02: byte 7; bytes 5-6 mV BE (HSC)"
  charging: { cmd: 0x03, parse: (f) => f(4) === 1 },                                          // "Charging 03: byte 4 = 01"
  micMute: { cmd: 0x05, parse: (f) => bool(f(4)) },                                           // "Mic mute 20 set, 05 get" (HH)
  sidetone: { cmd: 0x06, parse: (f) => bool(f(4)) },                                          // "Sidetone on/off 21 set, 06 get" (HH)
  autoOff: { cmd: 0x07, parse: (f) => f(4) },                                                 // "Auto-off 22 set, 07 get; reply byte 4"
  micAttached: { cmd: 0x08, parse: (f) => bool(f(4)) },                                       // "Mic plugged in 08: 1 = boom mic attached"
  sidetoneLevelRaw: { cmd: 0x0b, parse: (f) => f(4) },                                        // "Sidetone level 23 set, 0B get: raw byte" (HH); no range, so info only
};
const HP_WRITES = {
  micMute: { cmd: 0x20, kind: 'bool' },
  sidetone: { cmd: 0x21, kind: 'bool' },
  autoOff: { cmd: 0x22, kind: 'minutes' },
};
const ALPHA_READS = {
  battery: { cmd: 0x0b, parse: (f) => ({ percent: pct(f(3)) }) },                            // "Battery % 0B: byte 3 (reply code 25 also seen)"
  charging: { cmd: 0x0c, parse: (f) => f(3) === 1 },                                         // "Charging 0C: byte 3 = 01 (reply code 26)"
  sidetone: { cmd: 0x05, parse: (f) => bool(f(3)) },                                         // "Sidetone on/off 10 set, 05 get" (HSC, HH)
  sidetoneLevel: { cmd: 0x06, parse: (f) => f(3) },                                          // "Sidetone level 11 set, 06 get: HSC range 0-128"
  autoOff: { cmd: 0x07, parse: (f) => f(3) },                                                // "Auto-off 12 set, 07 get: minutes"
  micAttached: { cmd: 0x08, parse: (f) => bool(f(3)) },                                      // "Mic plugged in 08"
  voicePrompts: { cmd: 0x09, parse: (f) => bool(f(3)) },                                     // "Voice prompts 13 set, 09 get" (HSC, HH)
  micMute: { cmd: 0x0a, parse: (f) => bool(f(3)) },                                          // "Mic mute 15 set, 0A get" (HH)
};
const ALPHA_WRITES = {
  sidetone: { cmd: 0x10, kind: 'bool' },
  autoOff: { cmd: 0x12, kind: 'minutes' },
  voicePrompts: { cmd: 0x13, kind: 'bool' },
  micMute: { cmd: 0x15, kind: 'bool' },
  // "Sidetone level 11 set, 06 get, HSC range 0-128" (section 3; HSC hyperx_cloud_alpha_wireless.hpp). HH marks the byte
  // "correct?" (section 6), so it is only ever written after a read of 06 and judged by reading 06 back.
  sidetoneLevel: { cmd: 0x11, kind: 'level', min: 0, max: 128 },
};
// Cloud Flight battery (HH cloud_flight_wireless.rs THRESHOLDS / PERCENTAGES): the percent of the highest listed
// millivolt step at or below the reading (below the first step: 5). Charging when HI = 0x10 and LO >= 0x14, or HI >= 0x11
// (HH), i.e. 4116 mV and up; HSC says charging above 0x100B (4107 mV), so between the two the charging state is unknown.
// The percent is HH's estimate from the voltage (HSC uses another curve; sheet section 6 "pick one and label it").
const FLIGHT_STEPS = [[3328, 5], [3584, 10], [3674, 15], [3704, 20], [3732, 25], [3744, 30], [3754, 35], [3764, 40], [3774, 45], [3784, 50],
  [3794, 55], [3804, 60], [3824, 65], [3840, 70], [3860, 75], [3890, 80], [3910, 85], [3940, 90], [3960, 95], [3970, 100]];
export function flightBattery(mV) {
  if (!Number.isInteger(mV) || mV <= 0) return { percent: null, mV: mV || null, charging: null };   // no reading
  const charging = mV >= 0x1014 ? true : mV > 0x100b ? null : false;
  if (charging === true) return { percent: null, mV, charging };   // neither source gives a level while charging
  let percent = FLIGHT_STEPS[0][1];
  for (const [at, p] of FLIGHT_STEPS) if (mV >= at) percent = p;
  return { percent, mV, charging, estimate: true };
}
const FLIGHT_READS = {
  battery: { cmd: 0x05, parse: (f) => flightBattery((f(3) << 8) | f(4)) },                   // "Battery voltage 21 FF 05: bytes 3-4 mV BE"
};
// Cloud III S Wireless (HH cloud_iii_s_wireless.rs): value at byte 6, FF = no value (HH parse_response returns nothing)
const v6 = (f) => (f(6) === 0xff ? null : f(6));
const IIIS_READS = {
  connected: { cmd: 0x02, parse: (f) => (v6(f) === null ? null : f(6) === 2) },              // "DONGLE_CONNECTED 02: byte 6 = 2"
  micMute: { cmd: 0x04, parse: (f) => bool(v6(f)) },                                          // "GET_MIC_MUTE 04: byte 6 = 1 muted"
  battery: { cmd: 0x06, parse: (f) => ({ percent: pct(v6(f)) }) },                           // "BATTERY 06: byte 6"
  voicePrompts: { cmd: 0x14, parse: (f) => bool(v6(f)) },                                     // "GET_VOICE_PROMPT 14: byte 6 = 1"
  sidetone: { cmd: 0x16, parse: (f) => bool(v6(f)) },                                         // "GET_SIDE_TONE 16: byte 6 = 1" (sheet: format unconfirmed)
  charging: { cmd: 0x48, parse: () => null, raw: (f) => f(6) },                              // "CHARGE_STATE 48: byte 6"; meanings unconfirmed (sheet)
  autoOffRaw: { cmd: 0x4b, parse: (f) => (v6(f) === null ? null : (f(6) << 8) | f(7)) },     // "GET_AUTO_POWER_OFF 4B: bytes 6-7"; seconds in the code, presets in its comment: backup only
  productColor: { cmd: 0x4d, parse: (f) => f(6) },                                            // "COLOR 4D: byte 6"; mapping unconfirmed (info only)
};
const III_READS = {
  connected: { cmd: 0x82, parse: (f) => f(2) === 1 },                                        // "Connected 82: byte 2 = 1"
  sidetone: { cmd: 0x84, parse: (f) => bool(f(2)) },                                         // "Sidetone on/off 01 set, 84 get"
  autoOff: { cmd: 0x85, parse: (f) => f(2) },                                                // "Auto-off 02 set, 85 get: minutes"
  micMute: { cmd: 0x86, parse: (f) => bool(f(2)) },                                          // "Mic mute 03 set, 86 get"
  silentMode: { cmd: 0x87, parse: (f) => bool(f(2)) },                                       // "Silent mode 04 set, 87 get"
  sidetoneLevelRaw: { cmd: 0x88, parse: (f) => f(2) },                                       // "Sidetone level 05 set, 88 get: III raw byte" (no range: info only)
  battery: { cmd: 0x89, parse: (f) => ({ percent: f(2) || f(3) ? pct(f(4)) : null }) },      // "Battery 89: byte 4, valid only if byte 2 or 3 nonzero"
  charging: { cmd: 0x8a, parse: (f) => null, raw: (f) => f(2) },                             // "Charging 8A: byte 2; meanings unconfirmed"
  productColor: { cmd: 0x8f, parse: (f) => f(2) },                                           // "Product color 8F: R, color code; mapping unconfirmed" (info only)
};
// Cloud II Core Wireless: the same 66 gets as the Cloud III Wireless (section 3 rows "Cloud III Wireless, II Core"), its
// sidetone level read as -5..5 signed, plus its extras (HH cloud_ii_core_wireless.rs). Product color 8F is not listed for it.
const signed = (v) => (Number.isInteger(v) ? (v > 127 ? v - 256 : v) : null);
const CORE_READS = {
  ...Object.fromEntries(Object.entries(III_READS).filter(([k]) => !['sidetoneLevelRaw', 'productColor'].includes(k))),
  sidetoneStep: { cmd: 0x88, parse: (f) => { const v = signed(f(2)); return v !== null && v >= -5 && v <= 5 ? v : null; } },   // "II Core: -5..5 signed (FF = -1)"
  micAttached: { cmd: 0x8c, parse: (f) => bool(f(2)) },                                      // "Mic plugged in 08 ... II Core 8C"
  noiseGate: { cmd: 0x8d, parse: (f) => bool(f(2)) },                                        // "Noise gate 0F set, 8D get: 0/1, II Core (HH)"
};

export const MODELS = [
  { key: 'cloud-ii-wireless', name: 'HyperX Cloud II Wireless', pids: ['0696', '018b'], family: '06ffbb',
    len: 20, page: 0xff90, usage: 0x0303, reads: HP_READS, writes: HP_WRITES, held: [HELD.hpLevelSet],
    lenNote: 'HSC writes 52 and reads 20, HH uses 20: 20 here (unconfirmed which Windows wants)',
    source: 'HSC hyperx_cloud_2_wireless.hpp, HH cloud_ii_wireless_dts.rs', readOnlyWhy: null },
  { key: 'cloud-alpha-wireless', name: 'HyperX Cloud Alpha Wireless', pids: ['098d'], family: '21bb',
    len: 64, page: null, usage: null, reads: ALPHA_READS, writes: ALPHA_WRITES, held: [HELD.alphaConnected],
    lenNote: 'HSC 31, HH 64: 64 here (unconfirmed)', source: 'HSC hyperx_cloud_alpha_wireless.hpp, HH cloud_alpha_wireless.rs', readOnlyWhy: null },
  { key: 'cloud-alpha-wireless-hh', name: 'HyperX Cloud Alpha Wireless', pids: ['1743', '1765'], family: '21bb',
    len: 64, page: null, usage: null, reads: ALPHA_READS, writes: ALPHA_WRITES, held: [HELD.alphaConnected],
    lenNote: 'HSC 31, HH 64: 64 here (unconfirmed)', source: 'HH cloud_alpha_wireless.rs only',
    readOnlyWhy: 'these two ids come from HH alone (HSC knows only 098D); read-only until a read on the headset confirms it' },
  { key: 'cloud-iii-wireless', name: 'HyperX Cloud III Wireless', pids: ['05b7', '0c9d'], family: '66',
    len: 62, page: null, usage: null, reads: III_READS, writes: {}, held: [
      { cmd: 0x01, why: 'sidetone set' }, { cmd: 0x05, why: 'sidetone level set' }, { cmd: 0x02, why: 'auto-off set' },
      { cmd: 0x03, why: 'mic mute set' }, { cmd: 0x04, why: 'silent mode set' }],
    lenNote: '62 (HH)', source: 'HH cloud_iii_wireless.rs',
    readOnlyWhy: 'HH calls both ids "possible" (section 1, section 6): read-only until the model is confirmed with a read' },
  { key: 'cloud-ii-core-wireless', name: 'HyperX Cloud II Core Wireless', pids: ['069f', '0995'], family: '66',
    len: 64, page: null, usage: null, reads: CORE_READS, writes: {}, held: [
      { cmd: 0x01, why: 'sidetone set' }, { cmd: 0x05, why: 'sidetone level set' }, { cmd: 0x02, why: 'auto-off set' },
      { cmd: 0x03, why: 'mic mute set' }, { cmd: 0x04, why: 'silent mode set' }, { cmd: 0x0f, why: 'noise gate set' }],
    lenNote: '64 (HH)', source: 'HH cloud_ii_core_wireless.rs',
    readOnlyWhy: 'its ids and commands come from HH alone (section 5 step 6: "medium (single source, HH)"); read-only until a read on the headset confirms it' },
  // 23 Oct 2026: Cloud III S Wireless. Every write is a feature report (HH write_hid_report: send_feature_report), so
  // feature: true from the start, and its replies are input reports read on a raw channel (pollReplies).
  { key: 'cloud-iii-s-wireless', name: 'HyperX Cloud III S Wireless', pids: ['06be', '02cc'], family: '0c',
    len: 64, page: null, usage: null, feature: true, pollReplies: true, reads: IIIS_READS, writes: {}, held: [
      { cmd: 0x01, why: 'mic mute set' }, { cmd: 0x0d, why: 'sidetone set' }, { cmd: 0x0b, why: 'voice prompts set' },
      { cmd: 0x4a, why: 'auto-off set (seconds in the code, presets in its comment: they disagree)' }, { cmd: 0x5f, why: 'equalizer band set (write-only)' }],
    lenNote: '64 (HH), feature report', source: 'HH cloud_iii_s_wireless.rs',
    readOnlyWhy: 'its commands come from HH alone (section 5 step 6: single source); read-only until a read on the headset confirms it' },
  // 23 Oct 2026: Cloud Flight Wireless on its HP id. Battery voltage only: no source reads or changes anything else.
  { key: 'cloud-flight-wireless', name: 'HyperX Cloud Flight Wireless', pids: ['0e90'], family: '21ff',
    len: 20, page: null, usage: null, reads: FLIGHT_READS, writes: {}, held: [],
    lenNote: 'HSC 20, HH 64: 20 here (HSC, the source that names the frame for every Flight id; unconfirmed which Windows wants)',
    source: 'HH cloud_flight_wireless.rs (the 03F0:0E90 id and the % table), HSC hyperx_cloud_flight.hpp (the frame)',
    readOnlyWhy: 'HH alone lists 03F0:0E90 as a Cloud Flight; it has nothing to change anyway (battery only)' },
];
// 23 Oct 2026: the Cloud III S (HH parse_response reads the command at byte 5) and the Cloud Flight (HH's % table) are now
// in; the Kingston 0951 Cloud II Wireless and Cloud Flight ids are in device-library/hyperx-kingston.
// Left out, with the sheet's reason: 03F0:0D93 (HH lists it for the Cloud II Wireless, section 6 names it as a likely
// Cloud Stinger 2 Wireless id); the Kingston 0951 Cloud II Wireless (other vendor id, needs the "prepare" read: HID LAYER 5;
// its sidetone is write-only with no read-back); the wired Cloud III (feature report 20 86, write-only, no read-back);
// Cloud III S (its get reply framing is not documented: which bytes echo the get; section 2 only says "value at byte 6"),
// Cloud Flight (battery voltage only; the % curve is not in the sheet, and its HSC ids are 0951).

export const modelFor = (pid) => MODELS.find((m) => m.pids.includes(String(pid).toLowerCase())) || null;

// What may be sent. frame = the whole command without padding, byte 0 = report id. Throws, sending nothing, unless the
// frame is exactly a documented get (header + cmd) or a documented set (header + cmd + value) of THIS model.
export function checkFrame(model, frame) {
  const b = Array.from(frame || [], (x) => x);
  if (!model || !FAMILIES[model.family]) throw new Error('refused: no model');
  if (!b.length || b.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('refused: not a byte frame');
  for (const n of NEVER) {
    if (n.bytes && n.bytes.every((x, i) => b[i] === x)) throw new Error(`refused: ${n.what} is never sent (${n.why})`);
    if (n.bytes && b.length >= 3 && b[1] === n.bytes[1] && b[2] === n.bytes[2]) throw new Error(`refused: ${n.what} is never sent (${n.why})`);
  }
  const fam = FAMILIES[model.family];
  if (!fam.header.every((x, i) => b[i] === x)) throw new Error(`refused: not a ${fam.name} frame`);
  const cmd = b[fam.cmdAt];
  const never = NEVER.find((n) => n.family === model.family && n.cmd === cmd);
  if (never) throw new Error(`refused: ${never.what} is never sent (${never.why})`);
  const held = model.held.find((h) => h.cmd === cmd);
  if (b.length === fam.cmdAt + 1) {
    if (Object.values(model.reads).some((r) => r.cmd === cmd)) return 'get';
  } else if (b.length === fam.cmdAt + 2) {
    if (model.readOnlyWhy) throw new Error(`refused: ${model.name} is read-only here (${model.readOnlyWhy})`);
    const w = Object.values(model.writes).find((x) => x.cmd === cmd);
    if (w) {
      const v = b[fam.cmdAt + 1];
      if (w.kind === 'bool' && v !== 0 && v !== 1) throw new Error('refused: an on/off value must be 0 or 1');
      if (w.kind === 'level' && !(v >= w.min && v <= w.max)) throw new Error(`refused: a level must be ${w.min}-${w.max}`);
      return 'set';
    }
  }
  if (held) throw new Error(`refused: command ${cmd.toString(16).padStart(2, '0')} is held back (${held.why})`);
  throw new Error(`refused: ${hex(b)} is not a documented ${model.name} command`);
}

// One request at a time over a HIDDevice (WebHID, or helpers/hid-host.mjs HostDevice under the agent).
export class Link {
  constructor(device, model, { timeoutMs = 1500 } = {}) {
    Object.assign(this, { device, model, fam: FAMILIES[model.family], timeoutMs, q: Promise.resolve(), feature: model.feature === true, log: [] });
  }

  // checked synchronously, before it is queued: a refused frame never reaches the device
  send(frame, { reply = true } = {}) {
    const kind = checkFrame(this.model, frame);
    if (reply && kind !== 'get') throw new Error('refused: only a get waits for a reply');
    const run = () => this.sendNow(Array.from(frame), reply);
    const p = this.q.then(run, run);
    this.q = p.catch(() => {});
    return p;
  }

  async sendNow(frame, reply) {
    const reportId = frame[0];
    const data = new Uint8Array(this.model.len - 1);
    data.set(frame.slice(1));
    const fam = this.fam, cmd = frame[fam.cmdAt];
    const codes = [cmd, ...(fam.replyCodes[cmd] || [])];
    const rh = fam.reply?.header || fam.header, rc = fam.reply?.cmdAt ?? fam.cmdAt;   // the reply's own framing
    // The listener is in place before the write (a fast reply is not missed), but the wait for the reply starts only
    // once the write is done, and the reply promise always has a handler. 22 Oct 2026 (support issues 3-5): the timer
    // started before the write; a write slower than timeoutMs rejected the promise before anyone awaited it, and that
    // unhandled "no reply to 06 ff bb 08" stopped DeviceHub on a friend's PC.
    let listener, timer, fail = null, done = false;
    const answer = reply ? new Promise((resolve, reject) => {
      fail = reject;
      listener = (e) => {
        if (e.reportId !== rh[0]) return;
        const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        const f = (n) => (n === 0 ? rh[0] : d[n - 1]);
        if (!rh.every((x, i) => f(i) === x) || !codes.includes(f(rc))) return;   // a notice, or another reply
        done = true;
        resolve(Uint8Array.from(d));
      };
      this.device.addEventListener('inputreport', listener);
    }) : null;
    answer?.catch(() => {});   // handled here as well: a reply that comes too late is never an unhandled rejection
    try {
      await this.write(reportId, data);
      this.log.push({ t: Date.now(), out: hex([reportId, ...data]) });
      if (this.log.length > 100) this.log.splice(0, this.log.length - 100);
      if (!reply) { await sleep(50); return null; }   // HH waits 50 ms after each write before reading
      timer = setTimeout(() => fail(new Error(`no reply to ${hex(frame)}`)), this.timeoutMs);
      // a reply to a feature report is an input report nobody reads by itself (hid-host only reads after an output
      // report): on a raw channel the link reads them (receiveReports) and hands each to its listener until one matches
      if (this.feature && this.model.pollReplies && typeof this.device.receiveReports === 'function') {
        const until = Date.now() + this.timeoutMs;
        while (!done && Date.now() < until) {
          const got = await this.device.receiveReports(Math.max(0, Math.min(250, until - Date.now()))).catch(() => []);
          for (const e of got || []) listener(e);
        }
      }
      return await answer;
    } finally {
      clearTimeout(timer);
      if (listener) this.device.removeEventListener('inputreport', listener);
    }
  }

  // An output report; on a refused write (not an unplug), a feature report, as HH does on Windows (section 2).
  async write(reportId, data) {
    if (this.feature) return this.device.sendFeatureReport(reportId, data);
    try { await this.device.sendReport(reportId, data); }
    catch (e) {
      if (e?.gone || typeof this.device.sendFeatureReport !== 'function') throw e;
      this.feature = true;
      await this.device.sendFeatureReport(reportId, data);
    }
  }

  async getRaw(key) {
    const r = Object.hasOwn(this.model.reads, key) ? this.model.reads[key] : null;
    if (!r) throw new Error(`${this.model.name} has no documented read for ${key}`);
    const frame = [...this.fam.header, r.cmd];
    let d;
    try { d = await this.send(frame); } catch (e) { if (e?.gone || /^refused/.test(e.message)) throw e; d = await this.send(frame); }   // one retry: a notice may have taken the reply
    const f = (n) => (n === 0 ? frame[0] : d[n - 1]);
    return { value: r.parse(f), raw: r.raw ? r.raw(f) : undefined, bytes: hex([frame[0], ...d]) };
  }
  async get(key) { return (await this.getRaw(key)).value; }

  async set(key, value) {
    const w = Object.hasOwn(this.model.writes, key) ? this.model.writes[key] : null;
    if (!w) throw new Error(`${this.model.name} has no documented write for ${key}`);
    const byte = w.kind === 'bool' ? (value ? 1 : 0) : value;
    await this.send([...this.fam.header, w.cmd, byte], { reply: false });
  }
}

const SETTINGS = [
  { key: 'sidetone', label: 'Sidetone', type: 'toggle', hint: 'Hear your own voice. Changes on the Cloud II Wireless and Alpha Wireless; shown only on the Cloud III, III S and II Core Wireless.' },
  { key: 'micMute', label: 'Mic muted', type: 'toggle', hint: 'Changes on the Cloud II Wireless and Alpha Wireless; shown only on the Cloud III, III S and II Core Wireless.' },
  { key: 'autoOff', label: 'Turn off after', type: 'slider', min: 0, max: 255, step: 1, unit: 'min', hint: 'Minutes without sound. Whether 0 means never is unconfirmed, so 0 is only written to put back a 0 read from the headset.' },
  { key: 'sidetoneLevel', label: 'Sidetone level', type: 'slider', min: 0, max: 128, step: 1, hint: 'Cloud Alpha Wireless (03F0:098D) only, 0-128 as HeadsetControl sends it.' },
  { key: 'voicePrompts', label: 'Voice prompts', type: 'toggle', hint: 'Changes on the Cloud Alpha Wireless; shown only on the Cloud III S Wireless.' },
  { key: 'silentMode', label: 'Silent mode', type: 'toggle', hint: 'Cloud III and II Core Wireless, shown only (no change yet).' },
  { key: 'sidetoneStep', label: 'Sidetone level (step)', type: 'slider', min: -5, max: 5, step: 1, hint: 'Cloud II Core Wireless, -5 to 5, shown only (no change yet).' },
  { key: 'noiseGate', label: 'Noise gate', type: 'toggle', hint: 'Cloud II Core Wireless, shown only (no change yet).' },
];
// NGENUITY talks on the same interfaces (section 4: "Step back while NGENUITY runs (process name unconfirmed)"): no
// write while a process whose image name contains "ngenuity" runs.
const VENDOR_APP = /ngenuity/i;
const KEYS = SETTINGS.map((s) => s.key);
const labelOf = (k) => SETTINGS.find((s) => s.key === k)?.label || k;

export default {
  id: 'hyperx-cloud',
  title: 'HyperX Cloud headset',
  kind: 'Headset',
  // Only the settings the connected model really has (22 Oct 2026, support issue 4): a Cloud II Wireless reports mic
  // mute, sidetone on/off and auto-off, and nothing else (HSC hyperx_cloud_2_wireless.hpp reads only battery and the
  // inactive time; HH cloud_ii_wireless_dts.rs has no silent mode and marks voice prompts "Doesn't work"). Offering the
  // others made them fail the self-check with "the device did not report its value". Before any headset was found,
  // every setting the driver knows.
  get settings() { const m = this.link?.model || this.lastModel; return m ? SETTINGS.filter((s) => Object.hasOwn(m.reads, s.key)) : SETTINGS; },
  // one channel per pid (HID LAYER 1, 2); refused writes are not unplugs, so Link.write's feature fallback runs (4)
  hid: { vid: '03F0', pid: '0696', page: 'FF90', usage: '0303', len: 19, reportId: 0x06, replyMs: 1000, echo: () => FAMILIES['06ffbb'].echo, productName: 'HyperX Cloud II Wireless',
    refusals: true, pids: MODELS.flatMap((m) => m.pids).map((p) => p.toUpperCase()),
    byPid: Object.fromEntries(MODELS.flatMap((m) => m.pids.map((p) => [p.toUpperCase(), {
      page: m.page == null ? '*' : m.page.toString(16).toUpperCase(), usage: m.usage == null ? '*' : m.usage.toString(16).toUpperCase().padStart(4, '0'),
      ...(m.feature ? { featureLen: m.len - 1, reply: 'raw' } : m.page == null ? { outputLen: m.len - 1 } : {}), len: m.len - 1, reportId: FAMILIES[m.family].header[0], echo: () => FAMILIES[m.family].echo, productName: m.name }]))) },
  unsupported: ['firmware updates (never: they stay in HyperX NGENUITY)', 'lights', 'equalizer', 'pairing (never sent)',
    'sidetone level changes on the Cloud II Wireless (range not documented)', 'connection state on the Alpha Wireless (sources disagree)',
    'mic monitoring (no source; HyperX calls it sidetone)', 'Cloud III S Wireless changes and equalizer (one source; shown only)',
    'Cloud Flight Wireless settings (no source reads any; battery only, estimated from its voltage)', 'running beside NGENUITY: close it first'],
  link: null,
  lastModel: null,
  first: {},
  app: null,
  appAt: 0,

  // the maker's-app check (replaceable in tests); resolves with the running app's image name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APP.test(name)) return name; }
    return null;
  },
  async stepBackCheck() {
    if (!(this.appAt && Date.now() - this.appAt < 15000)) { this.app = await this.vendorApp(); this.appAt = Date.now(); }
    if (this.app) throw new Error(`${this.app} is running: close HyperX NGENUITY first (two programs writing the headset fight); nothing was written`);
  },

  async connect() {
    this.link = null; this.first = {}; this.app = null; this.appAt = 0;
    for (const m of MODELS) {
      for (const pid of m.pids) {
        const filter = { vendorId: VID, productId: parseInt(pid, 16) };
        if (m.page != null) filter.usagePage = m.page;
        let dev = null;
        try { dev = await getDevice([filter], { prompt: false }); } catch { dev = null; }
        if (!dev) continue;
        if (!dev.opened) await dev.open();
        this.link = new Link(dev, m);
        this.lastModel = m;
        this.pid = pid;
        return true;
      }
    }
    return false;
  },

  model() { if (!this.link) throw new Error('no HyperX headset is connected'); return this.link.model; },

  async info() {
    const m = this.model();
    const out = { Model: m.name, 'USB id': `03F0:${this.pid.toUpperCase()}`, Protocol: `${FAMILIES[m.family].name} (${m.source})`,
      Changes: m.readOnlyWhy ? `none: ${m.readOnlyWhy}` : Object.keys(m.writes).map(labelOf).join(', ') };
    const tryGet = async (k) => (Object.hasOwn(m.reads, k) ? this.link.getRaw(k).catch(() => null) : null);
    const b = await tryGet('battery'); if (b?.value?.mV) out['Battery voltage'] = `${b.value.mV} mV`;
    if (b?.value?.estimate) out.Battery = `${b.value.percent}% (estimated from the voltage, HyperHeadset's table)`;
    // The raw sidetone byte (Cloud II Wireless 0B, Cloud III Wireless 88) is not shown (22 Oct 2026, support issue 4: a
    // friend's Cloud II Wireless showed "Sidetone level (raw): 231"). HH reads it as "side tone volume" and passes the
    // byte on as it is; HSC does not read it; no source gives its range or scale, so the number means nothing to a
    // person. It stays in the raw backup (rawBackup) for whoever maps it.
    const col = await tryGet('productColor'); if (col) out['Product color code (mapping unconfirmed)'] = String(col.value);
    const mic = await tryGet('micAttached'); if (mic && mic.value !== null) out['Boom mic'] = mic.value ? 'attached' : 'not attached';
    const con = await tryGet('connected'); if (con) out.Connected = con.value ? 'yes' : 'no';
    const ch = await tryGet('charging'); if (ch && ch.raw !== undefined) out['Charging (raw, meaning unconfirmed)'] = String(ch.raw);
    return out;
  },

  // asleep (switched off, out of range): one read asked before the whole set (31 Oct 2026: every look at a switched-off
  // headset waited on every read's timeout, about 9 s, and the log filled with them); only a read on the safe list
  async awake() {
    // asked at most every 30 s, as the Logitech drivers do (31 Oct 2026: DeviceHub looks at an asleep device every 5 s,
    // and each look here was a request and its retry to a dongle that never answered)
    if (Date.now() - (this.awakeAskedAt || 0) < 30000) return false;
    this.awakeAskedAt = Date.now();
    try {
      const m = this.model();
      const k = KEYS.find((x) => Object.hasOwn(m.reads, x));
      if (!k) return true;
      await this.link.get(k);
      this.awakeAskedAt = 0;
      return true;
    } catch { return false; }
  },

  async read() {
    const m = this.model();
    const out = {};
    let got = 0, last = null;
    for (const k of KEYS) {
      if (!Object.hasOwn(m.reads, k)) continue;
      try { const v = await this.link.get(k); out[k] = v; got++; if (this.first[k] === undefined && v !== null) this.first[k] = v; } catch (e) { last = e; }
    }
    // 31 Oct 2026 (support #16-#26): "no reply to 06 ff bb 07" named only the last of the reads; the dongle answered none
    if (!got && last) throw Object.assign(new Error(`the headset did not answer: switched off or out of range of its dongle (${last.message})`), { cause: last });
    return out;
  },

  async write(key, value) {
    const m = this.model();
    if (typeof key !== 'string' || !KEYS.includes(key)) throw new Error(`${String(key)} is not a setting`);
    if (m.readOnlyWhy) throw new Error(`${m.name} is read-only here: ${m.readOnlyWhy}`);
    if (!Object.hasOwn(m.writes, key)) throw new Error(`${m.name} has no documented way to change ${labelOf(key)}`);
    const kind = m.writes[key].kind;
    if (kind === 'bool' && typeof value !== 'boolean') throw new Error(`${labelOf(key)} must be on or off`);
    if (kind === 'minutes' && !(Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error(`${labelOf(key)} must be 0-255 minutes`);
    const w = m.writes[key];
    if (kind === 'level' && !(Number.isInteger(value) && value >= w.min && value <= w.max)) throw new Error(`${labelOf(key)} must be ${w.min}-${w.max}`);
    await this.stepBackCheck();
    const zeroWhy = `${labelOf(key)}: 0 minutes is unconfirmed (it may not mean never); only written to put back a 0 read from the headset`;
    if (kind === 'minutes' && value === 0 && this.first[key] !== undefined && this.first[key] !== 0) throw new Error(zeroWhy);
    const before = await this.link.get(key);   // read just before the write, kept to put back
    if (before === null || before === undefined) throw new Error(`${labelOf(key)}: could not read the current value, nothing written`);
    if (this.first[key] === undefined) this.first[key] = before;
    if (kind === 'minutes' && value === 0 && this.first[key] !== 0) throw new Error(zeroWhy);
    await this.link.set(key, value);
    const after = await this.link.get(key);
    if (after !== value) {
      let restored = '';
      try { await this.link.set(key, before); restored = (await this.link.get(key)) === before ? ', the old value was put back' : ', and putting the old value back did not read back either'; } catch { restored = ', and putting the old value back failed'; }
      throw new Error(`${labelOf(key)}: wrote ${value}, read back ${after}${restored}`);
    }
    return after;
  },

  async battery() {
    const m = this.model();
    const b = await this.link.get('battery');
    let charging = null;
    if (b && b.charging !== undefined) charging = b.charging;   // the Cloud Flight's voltage tells it (null = unknown)
    else if (Object.hasOwn(m.reads, 'charging')) { try { charging = await this.link.get('charging'); } catch { charging = null; } }
    return { percent: b?.percent ?? null, charging: charging === null ? undefined : charging };
  },

  async rawBackup() {
    const m = this.model();
    const replies = {};
    for (const k of Object.keys(m.reads)) { try { replies[k] = (await this.link.getRaw(k)).bytes; } catch (e) { replies[k] = `no reply (${e.message})`; } }
    return { model: m.name, usb: `03F0:${this.pid.toUpperCase()}`, family: FAMILIES[m.family].name, replies };
  },
};
