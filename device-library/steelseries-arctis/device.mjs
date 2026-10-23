// SteelSeries Arctis headsets (USB vendor 0x1038), written 22 Oct 2026 from docs/brands/steelseries.md (the sheet:
// HeadsetControl's device files, cited there). Status: read-only. Nothing here has run on a real headset yet; every
// byte below is a row of the sheet, cited as "sheet s3 <setting> / <model>" (section 3, settings map) or "sheet s1/s2".
// No code was copied from HeadsetControl.
//
// Coverage pass, 22 Oct 2026 (docs/handoff/driver-coverage.md): DeviceHub's rule is that every writable setting has a
// read of the same value (its self-check reads, writes that value, reads back). The sheet documents a read for ONE
// Arctis setting: the Nova 7 Gen 2 sidetone (`00 20`). Every other Arctis setting is write-only in every source
// (sheet s2: "Writes get no reply"; s4: "cannot read back"), so it is left out of the page and never sent; see
// WRITE_ONLY below for what they are, kept as documentation only. Added in this pass: ChatMix shown on the page
// (read-only), the older Arctis 7 / Pro family (battery and ChatMix reads), and writes refused while SteelSeries GG runs.
//
// ============================================================================================================
// HID LAYER (22 Oct 2026: what this driver needs from DeviceHub's HID layer; docs/handoff/hid-core.md):
//
//  1. Several product ids: `hid.pids` (every model below) + `hid.byPid` (its family's channel) register one channel per
//     pid (helpers/my-devices.mjs hidSpecs); connect() asks for each pid in turn.
//  2. Opening by USB interface: each family's `iface` is matched as "&mi_0N" in the device path; the Nova Pro base
//     (iface 4), the Arctis 9 (iface 0) and the older Arctis 7 (iface 5) have no known usage page, so their channels use
//     page / usage '*' (any).
//  3. tested: [] is accepted for a "read-only" entry (helpers/device-library.mjs validateMeta).
//
// UNCONFIRMED (check with helpers/hid-caps.ps1 and one read before any write; the sheet does not settle them):
//  - Report lengths. The helper's len is the data bytes after the report id. The sheet's buffers are hidapi's, report
//    id included: Nova 64 bytes (MSG_SIZE) -> len 63; the 0x06 families and Arctis 9 31 bytes -> len 30. Must equal
//    hid-caps' OutputReportByteLength - 1 on the device.
//  - The 0x06 families (Nova Pro, older Arctis 7) reply: the helper only passes a reply whose report id is 6 and whose
//    first data byte is the command. The sheet's byte numbers count hidapi's report id byte, so here byte N = data[N - 1].
//  - Output report vs feature report for the requests (sheet s2: "very likely hid_write"); this driver uses output reports.
//  - Older Arctis 7: the sheet's battery row says "Arctis 7 (2017-19)"; the wired Arctis Pro and Pro GameDAC share the
//    family's file but have no battery, so battery is read only on the two Arctis 7 ids.
// ============================================================================================================
//
// What it does NOT do, on purpose:
//  - No saves (`00 09`, `00 35 01`, `06 09`, `90 00`; sheet s2), no firmware, no reset, no pairing, no command id the
//    sheet does not list (sheet s4: "Send only the ids listed here"). Each family has its own short list (SENDABLE).
//  - Nova 5 status (battery, ChatMix): the sheet has the parse but not the request bytes (s3, s6), so it is never asked.
//  - Nova Pro ChatMix, ANC / transparency, the base screen: not in any source (sheet s6).
//  - Arctis 7+ status read is "assumed to share the Nova 00 B0 status read; not confirmed" (s6): it is a read, so it
//    is used, and nothing is written on its strength.
//
// Added 23 Oct 2026 straight from HeadsetControl (github.com/Sapd/HeadsetControl @ a8120a6, lib/devices/*.hpp, cited
// "HC <file>"; no code copied):
//  - Arctis Nova 7P 220A / 2298 / 22A7 (HC steelseries_arctis_nova_7p.hpp): the Nova 7 status read 00 B0 and its
//    battery parse (HC steelseries_arctis_nova_7.hpp getBattery: byte 3 00 = offline, 01 / 02 = charging; byte 2 =
//    0-4 steps on 220A, percent on 2298 / 22A7). No ChatMix ("chatmix always returns 64") and no sidetone.
//  - Arctis Nova 3P / 3X Wireless 2269 / 226D (HC steelseries_arctis_nova_3p_wireless.hpp): interface 3, FFC0 / 1;
//    status 00 B0 (HC protocols/steelseries_protocol.hpp readDeviceStatus, read 128): byte 1 02 = offline, byte 3 =
//    percent, byte 4 01 = charging. Its sidetone, mic volume, auto-off and EQ are writes with no read: not sent.
//  - Arctis 1 / 1 Xbox / 7X / 7P Wireless 12B3 / 12B6 / 12D7 / 12D5 (HC steelseries_arctis_1.hpp, a
//    SteelSeriesLegacyDevice): interface 3, usage page FF43, usage 0202; battery write 06 12, read 8: byte 3 = percent,
//    byte 2 01 = offline, no charging flag (HC passes 0xFF as "no charging for this device"). Sidetone 06 35 and auto-off
//    06 53 are writes with a save (06 09) and no read: not sent.
//  - Arctis Nova 3 12EC (HC steelseries_arctis_nova_3.hpp): interface 4, FFC0 / 1. HC has no read for it at all (only
//    feature-report writes 06 39 / 06 37 / 06 AE / 06 33, each with a save 06 09), so it is named only: nothing is sent.
import { getDevice } from '../../public/devices/hid.js';

const VID = 0x1038;

// message families (sheet s2, "Headsets: three families"; the older Arctis 7 is the second row's other model)
export const FAMILIES = {
  nova: { name: 'Nova (00 <cmd>)', reportId: 0x00, len: 63, iface: 3, usagePage: 0xffc0, usage: 0x01, shift: 0 },
  legacy06: { name: 'Legacy (06 <cmd>)', reportId: 0x06, len: 30, iface: 4, usagePage: null, usage: null, shift: 1 },
  arctis9: { name: 'Legacy, Arctis 9', reportId: 0x00, len: 30, iface: 0, usagePage: null, usage: null, shift: 0 },
  // sheet s1 "Arctis 7 / 7 2019 / Pro 2019 / Pro GameDAC (older) ... iface 5"; s2 "Legacy with 0x06 ... Arctis 7 (2017-19)", 31 bytes
  legacy7: { name: 'Legacy (06 <cmd>), Arctis 7 2017-19', reportId: 0x06, len: 30, iface: 5, usagePage: null, usage: null, shift: 1 },
  // HC steelseries_arctis_1.hpp getCapabilityDetail: usage page 0xff43, usage 0x202, interface 3; a SteelSeriesLegacyDevice
  // (PACKET_SIZE_31 for its writes; the battery request itself is 2 bytes): len 30 UNCONFIRMED, as for the other 06 families
  legacy1: { name: 'Legacy (06 <cmd>), Arctis 1 / 7X / 7P Wireless', reportId: 0x06, len: 30, iface: 3, usagePage: 0xff43, usage: 0x0202, shift: 1 },
  // HC steelseries_arctis_nova_3.hpp: every capability on interface 4, usage page 0xffc0, usage 1 (feature reports,
  // report id 06, MSG_SIZE 64). Opened only to name the headset; nothing is ever sent on it.
  nova3: { name: 'Nova 3 (06 <cmd> feature reports; nothing sent)', reportId: 0x06, len: 63, iface: 4, usagePage: 0xffc0, usage: 0x01, shift: 1 },
};

// what each line of models can do (sheet s3); status: its status read (STATUS below), or null
export const LINES = {
  nova7: { family: 'nova', status: 'nova7' },
  a7p: { family: 'nova', status: 'a7p' },
  nova5: { family: 'nova', status: null },
  pro: { family: 'legacy06', status: 'pro' },
  a9: { family: 'arctis9', status: 'a9' },
  a7old: { family: 'legacy7', status: 'a7old' },
  nova7p: { family: 'nova', status: 'nova7' },   // HC steelseries_arctis_nova_7p.hpp: the Nova 7 status read, no ChatMix
  nova3p: { family: 'nova', status: 'nova3p' },
  a1: { family: 'legacy1', status: 'a1' },
  nova3: { family: 'nova3', status: null },
};

// the per-model table (sheet s1). steps: battery reported as 0-4 steps (sheet s3 battery / Nova 7, second row).
// sidetoneRead: the one model with a sidetone read (sheet s3 Sidetone / Nova 7 Gen 2 (0x227E) only).
// noBattery: the wired older Pro models (see UNCONFIRMED). 0x22A7 and 0x220A are left out: the sheet calls them unconfirmed.
export const MODELS = [
  { pid: 0x2202, name: 'Arctis Nova 7', line: 'nova7', steps: true },
  { pid: 0x22a1, name: 'Arctis Nova 7', line: 'nova7' },
  { pid: 0x227e, name: 'Arctis Nova 7 Wireless Gen 2', line: 'nova7', sidetoneRead: true },
  { pid: 0x2206, name: 'Arctis Nova 7X', line: 'nova7', steps: true },
  { pid: 0x22a4, name: 'Arctis Nova 7X', line: 'nova7', steps: true },
  { pid: 0x22a5, name: 'Arctis Nova 7X', line: 'nova7' },
  { pid: 0x2258, name: 'Arctis Nova 7x v2', line: 'nova7' },
  { pid: 0x229e, name: 'Arctis Nova 7x v2', line: 'nova7' },
  { pid: 0x22ad, name: 'Arctis Nova 7x v2', line: 'nova7' },
  { pid: 0x223a, name: 'Arctis Nova 7 Diablo IV', line: 'nova7', steps: true },
  { pid: 0x22a9, name: 'Arctis Nova 7 Diablo IV', line: 'nova7' },
  { pid: 0x227a, name: 'Arctis Nova 7 WoW Edition', line: 'nova7', steps: true },
  { pid: 0x220e, name: 'Arctis 7+', line: 'a7p' },
  { pid: 0x2212, name: 'Arctis 7P+ (PS5)', line: 'a7p' },
  { pid: 0x2216, name: 'Arctis 7X+ (Xbox)', line: 'a7p' },
  { pid: 0x2236, name: 'Arctis 7+ Destiny', line: 'a7p' },
  { pid: 0x2232, name: 'Arctis Nova 5', line: 'nova5' },
  { pid: 0x2253, name: 'Arctis Nova 5X', line: 'nova5' },
  { pid: 0x12e0, name: 'Arctis Nova Pro Wireless', line: 'pro' },
  { pid: 0x12e5, name: 'Arctis Nova Pro Wireless X', line: 'pro' },
  { pid: 0x12c2, name: 'Arctis 9', line: 'a9' },
  // sheet s1 "Arctis 7 / 7 2019 / Pro 2019 / Pro GameDAC (older) | 0x1260, 0x12AD, 0x1252, 0x1280 | iface 5"
  { pid: 0x1260, name: 'Arctis 7', line: 'a7old' },
  { pid: 0x12ad, name: 'Arctis 7 (2019)', line: 'a7old' },
  { pid: 0x1252, name: 'Arctis Pro (2019)', line: 'a7old', noBattery: true },
  { pid: 0x1280, name: 'Arctis Pro GameDAC', line: 'a7old', noBattery: true },
  // added 23 Oct 2026 (see the top). noChat: HC "chatmix always returns 64" on the Nova 7P, so it is not shown
  { pid: 0x220a, name: 'Arctis Nova 7P', line: 'nova7p', steps: true, noChat: true },   // HC: "discrete battery: 0-4"
  { pid: 0x2298, name: 'Arctis Nova 7P V2', line: 'nova7p', noChat: true },             // "percentage battery: 0-100"
  { pid: 0x22a7, name: 'Arctis Nova 7P V2', line: 'nova7p', noChat: true },             // "percentage battery: 0-100"
  { pid: 0x2269, name: 'Arctis Nova 3P Wireless', line: 'nova3p' },
  { pid: 0x226d, name: 'Arctis Nova 3X Wireless', line: 'nova3p' },
  { pid: 0x12b3, name: 'Arctis 1 Wireless', line: 'a1' },
  { pid: 0x12b6, name: 'Arctis 1 Wireless Xbox', line: 'a1' },
  { pid: 0x12d7, name: 'Arctis 7X Wireless', line: 'a1' },
  { pid: 0x12d5, name: 'Arctis 7P Wireless', line: 'a1' },
  { pid: 0x12ec, name: 'Arctis Nova 3', line: 'nova3' },
];

const READ_ONLY = 'The ChatMix dial on the headset. DeviceHub reads it; only the dial changes it.';

// the settings the page shows. cmd: the command byte after the report id; check(v): the value is valid.
//  sidetone: written AND read back, Nova 7 Gen 2 only.
//  chatGame / chatChat: ChatMix, a reading ('display', 22 Oct 2026): never written, and the self-check skips it.
const DEFS = {
  sidetone: { label: 'Sidetone', type: 'slider', min: 0, max: 3, unit: '', hint: 'Hear your own voice, 4 levels (Arctis Nova 7 Gen 2: read back from the headset).',
    cmd: 0x39, check: (v) => int(v, 0, 3), cite: 'sheet s3 Sidetone / Nova 7: 00 39 <0-3>; read: Nova 7 Gen 2 (0x227E) only, 00 20, reply 20 ?? <0-3>' },
  chatGame: { label: 'ChatMix: game', type: 'display', unit: '%', hint: READ_ONLY,
    cite: 'sheet s3 ChatMix: Nova 7 / 7+ status bytes 4-5 (0-100), Arctis 9 00 20 bytes 9-10 (0-19), Arctis 7 2017-19 06 24 bytes 2-3 (191-255, 0 = full)' },
  chatChat: { label: 'ChatMix: chat', type: 'display', unit: '%', hint: READ_ONLY,
    cite: 'same rows as ChatMix: game' },
};
function int(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

// Documented writes with NO documented read (sheet s3; sheet s2 "Writes get no reply"). Kept out of the page and never
// sent: a setting DeviceHub cannot read back is not written. Documentation only; nothing in this file sends these.
export const WRITE_ONLY = [
  { what: 'sidetone', models: 'Nova 7 (not Gen 2), Arctis 7+', bytes: '00 39 <0-3>', cite: 'sheet s3 Sidetone' },
  { what: 'sidetone', models: 'Nova 5', bytes: '00 39 <00-0A> + save', cite: 'sheet s3 Sidetone' },
  { what: 'sidetone', models: 'Nova Pro', bytes: '06 39 <0-3> + save', cite: 'sheet s3 Sidetone' },
  { what: 'sidetone', models: 'Arctis 9', bytes: '06 00 <C0-FD> + save', cite: 'sheet s3 Sidetone' },
  { what: 'sidetone', models: 'Arctis 7 2017-19', bytes: '06 35 01 00 <00-12>; off 06 35', cite: 'sheet s3 Sidetone' },
  { what: 'auto-off', models: 'Nova 7, Arctis 7+, Nova 5', bytes: '00 A3 <minutes>', cite: 'sheet s3 Auto-off' },
  { what: 'auto-off', models: 'Nova Pro', bytes: '06 C1 <step> + save', cite: 'sheet s3 Auto-off' },
  { what: 'auto-off', models: 'Arctis 9', bytes: '04 00 <sec hi> <sec lo> + save', cite: 'sheet s3 Auto-off' },
  { what: 'auto-off', models: 'Arctis 7 2017-19', bytes: '06 51 <minutes> + save', cite: 'sheet s3 Auto-off' },
  { what: 'EQ preset / custom EQ', models: 'all', bytes: '00 33 ... / 06 2E <0-3>, 06 33 ...', cite: 'sheet s3 EQ custom, EQ preset' },
  { what: 'mic mute light brightness', models: 'Nova 7, Nova 5', bytes: '00 AE <level>', cite: 'sheet s3 Mic mute LED brightness' },
  { what: 'mic volume', models: 'Nova 7, Nova 5', bytes: '00 37 <level>', cite: 'sheet s3 Mic volume' },
  { what: 'volume limiter', models: 'Nova 7, Nova 5', bytes: '00 3A <0/1>, 00 27 <0/1>', cite: 'sheet s3 Volume limiter' },
  { what: 'Bluetooth on power-up, Bluetooth call volume', models: 'Nova 7', bytes: '00 B2 <0/1> then 06 09, 00 B3 <0-2>', cite: 'sheet s3' },
  { what: 'lights', models: 'Nova Pro, Arctis 7 2017-19', bytes: '06 BF <0A/01> + save, 06 55 01 <02/00> + save', cite: 'sheet s3 Lights' },
];

// status reads (sheet s3 Battery + charging and ChatMix). reqs: the requests, in order; parse(replies, model, family):
// each reply's data without the report id. Returns { online, percent, charging, chat: { game, chat } (percent) | null }.
const pct19 = (v) => Math.round((Math.min(v, 19) / 19) * 100);
// Arctis 7 2017-19 ChatMix scale (sheet s3 ChatMix / Arctis 7: "191-255, 0 = full"): 191 = none, 0 = full
const pctA7 = (v) => (v === 0 ? 100 : v < 191 ? 0 : Math.round(((v - 191) / (256 - 191)) * 100));
const STATUS = {
  // write 00 B0, read: byte 2 = level, byte 3 = 00 offline / 01,02 charging / else on battery; ChatMix bytes 4, 5 (0-100)
  nova7: { reqs: [[0xb0]], parse([r], m) {
    const st = r[3], level = r[2];
    return { online: st !== 0x00, charging: st === 0x01 || st === 0x02, percent: m.steps ? Math.min(level, 4) * 25 : Math.min(level, 100),
      chat: { game: Math.min(r[4], 100), chat: Math.min(r[5], 100) } };
  } },
  // status read: byte 1 01 = offline, byte 2 = 0-4, byte 3 01 = charging; ChatMix bytes 4, 5 (0-100)
  a7p: { reqs: [[0xb0]], parse([r]) {
    return { online: r[1] !== 0x01, charging: r[3] === 0x01, percent: Math.min(r[2], 4) * 25, chat: { game: Math.min(r[4], 100), chat: Math.min(r[5], 100) } };
  } },
  // HC steelseries_arctis_nova_3p_wireless.hpp getBattery: write 00 B0, read: byte 1 02 = offline, byte 3 = percent
  // ("Already in percentage"), byte 4 01 = charging. No ChatMix.
  nova3p: { reqs: [[0xb0]], chat: false, parse([r]) {
    return { online: r[1] !== 0x02, charging: r[4] === 0x01, percent: Math.min(r[3], 100), chat: null };
  } },
  // HC steelseries_arctis_1.hpp getBattery: write 06 12, read 8: battery byte 3 (0-100), status byte 2 (01 = offline),
  // no charging value; HC's bytes count hidapi's report id byte, so here byte N = data[N - 1]
  a1: { reqs: [[0x12]], chat: false, parse([r], m, f) {
    const at = (n) => r[n - f.shift];
    return { online: at(2) !== 0x01, charging: null, percent: Math.min(at(3), 100), chat: null };
  } },
  // write 06 B0, read: byte 6 = 0-8, byte 15 = 01 offline / 02 charging (sheet bytes count the report id: data[N-1])
  pro: { reqs: [[0xb0]], chat: false, parse([r], m, f) {
    const at = (n) => r[n - f.shift];
    return { online: at(15) !== 0x01, charging: at(15) === 0x02, percent: Math.round((Math.min(at(6), 8) / 8) * 100), chat: null };
  } },
  // write 00 20, read: byte 3 = 0x64-0x9A, byte 4 01 = charging; ChatMix byte 9 game, byte 10 chat (0-19)
  a9: { reqs: [[0x20]], parse([r]) {
    const pct = Math.round(((Math.min(Math.max(r[3], 0x64), 0x9a) - 0x64) / (0x9a - 0x64)) * 100);
    return { online: true, charging: r[4] === 0x01, percent: pct, chat: { game: pct19(r[9]), chat: pct19(r[10]) } };
  } },
  // battery: write 06 18, read 8: byte 2 = percent, no charge flag; ChatMix: write 06 24, read 8: byte 2 game, byte 3 chat
  // (sheet s3 Battery / Arctis 7 (2017-19) and ChatMix / Arctis 7 (2017-19); bytes count the report id: data[N-1])
  a7old: { reqs: [[0x18], [0x24]], parse([bat, mix], m, f) {
    const at = (r, n) => r[n - f.shift];
    return { online: true, charging: null, percent: m.noBattery ? null : Math.min(at(bat, 2), 100), chat: { game: pctA7(at(mix, 2)), chat: pctA7(at(mix, 3)) } };
  } },
};
const SIDETONE_READ = [0x20];  // sheet s3 Sidetone / Nova 7 Gen 2 (0x227E) only: 00 20, reply 20 ?? <0-3>, byte 2 = level

// the only command bytes each family ever sends (sheet s3 rows above); nothing else leaves this file
const SENDABLE = {
  nova: new Set([0xb0, 0x20, 0x39]),  // status, Gen 2 sidetone read, sidetone (Gen 2 only: write() checks the model)
  legacy06: new Set([0xb0]),          // Nova Pro status
  arctis9: new Set([0x20]),           // Arctis 9 status
  legacy7: new Set([0x18, 0x24]),     // older Arctis 7 battery and ChatMix
  legacy1: new Set([0x12]),           // Arctis 1 / 7X / 7P Wireless battery (HC steelseries_arctis_1.hpp)
  nova3: new Set(),                   // Arctis Nova 3: no read in any source, so nothing at all
};

// SteelSeries' own apps (SteelSeries GG and the older SteelSeries Engine): while one runs, DeviceHub does not write
// (two programs writing the same headset fight; CLAUDE.md "close its maker's app")
export const VENDOR_APPS = /^SteelSeries(GG|GGClient|Engine|Engine3)?\.exe$/i;

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const h4 = (n) => n.toString(16).padStart(4, '0');

// a model's HID channel (HID LAYER 2): its family's collection, by interface, page '*' where the sheet has none
function channelOf(m) {
  const f = FAMILIES[LINES[m.line].family];
  return { page: f.usagePage == null ? '*' : h4(f.usagePage).toUpperCase(), usage: f.usage == null ? '*' : h4(f.usage).toUpperCase(), iface: f.iface,
    len: f.len, reportId: f.reportId, productName: `SteelSeries ${m.name}` };
}

// one request at a time; ask() waits for the reply whose first byte is the command (async B0 reports are skipped,
// sheet s2), tell() sends a write, which gets no reply (sheet s2)
class Link {
  constructor(dev, fam, famKey) { this.dev = dev; this.fam = fam; this.ok = SENDABLE[famKey]; this.q = Promise.resolve(); this.last = null; }
  serial(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }
  frame(bytes) {
    if (!this.ok.has(bytes[0])) throw new Error(`command ${bytes[0].toString(16)} is not on the sheet's list for this headset`);
    const out = new Uint8Array(this.fam.len); out.set(bytes); return out;
  }
  tell(bytes) { const out = this.frame(bytes); return this.serial(() => this.dev.sendReport(this.fam.reportId, out)); }
  ask(bytes, timeoutMs = 1500) {
    const out = this.frame(bytes);
    return this.serial(() => new Promise((resolve, reject) => {
      const on = (e) => {
        const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        if (r[0] !== out[0]) return;
        done(); this.last = { out: hex(out.slice(0, 4)), in: hex(r) }; resolve(new Uint8Array(r));
      };
      const timer = setTimeout(() => { done(); reject(new Error(`no reply to ${hex(out.slice(0, 2))}`)); }, timeoutMs);
      const done = () => { clearTimeout(timer); this.dev.removeEventListener('inputreport', on); };
      this.dev.addEventListener('inputreport', on);
      this.dev.sendReport(this.fam.reportId, out).catch((err) => { done(); reject(err); });
    }));
  }
}

export default {
  id: 'steelseries-arctis',
  title: 'SteelSeries Arctis',
  kind: 'Headset',
  vendor: 'SteelSeries',
  // one channel per model's pid, each with its family's collection (HID LAYER 1-2)
  hid: { vid: '1038', pid: '2202', page: 'FFC0', usage: '0001', len: 63, reportId: 0, replyMs: 800, productName: 'SteelSeries Arctis Nova 7',
    pids: MODELS.map((m) => h4(m.pid).toUpperCase()), byPid: Object.fromEntries(MODELS.map((m) => [h4(m.pid).toUpperCase(), channelOf(m)])) },
  settings: Object.entries(DEFS).map(([key, d]) => {
    const s = { key, label: d.label, type: d.type, hint: d.hint };
    for (const k of ['min', 'max', 'step', 'unit', 'options', 'selfCheck']) if (d[k] !== undefined) s[k] = d[k];
    return s;
  }),
  unsupported: ['firmware updates', 'saving settings to the headset',
    'settings the headset cannot report back (sidetone except on the Nova 7 Gen 2, auto-off, EQ, mic volume, mic light, volume limiter, lights): no source has a read for them',
    'ANC and transparency', 'the base station screen', 'Nova Pro ChatMix'],
  MODELS, LINES, FAMILIES, DEFS, WRITE_ONLY,

  // the vendor-app check (replaceable in tests); resolves with the running app's name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
    return null;
  },

  async connect() {
    this.model = null; this.link = null; this.status = null;
    for (const m of MODELS) {
      const famKey = LINES[m.line].family, f = FAMILIES[famKey];
      const filter = { vendorId: VID, productId: m.pid };
      if (f.usagePage != null) filter.usagePage = f.usagePage;
      let dev = null;
      try { dev = await getDevice([filter], { prompt: false }); } catch { dev = null; }
      if (!dev) continue;
      if (!dev.opened) await dev.open();
      this.model = m; this.line = LINES[m.line]; this.fam = f; this.link = new Link(dev, f, famKey);
      return true;
    }
    return false;
  },

  need() { if (!this.link) throw Object.assign(new Error('no SteelSeries Arctis headset is connected'), { gone: true }); },

  // the keys this model reports (read() returns exactly these)
  keys() {
    const k = [];
    if (this.model?.sidetoneRead) k.push('sidetone');
    if (this.line?.status && STATUS[this.line.status] && STATUS[this.line.status].chat !== false && !this.model.noChat) k.push('chatGame', 'chatChat');
    return k;
  },

  // the status read for this model, or null when the sheet has none (Nova 5)
  async readStatus() {
    this.need();
    const s = STATUS[this.line.status];
    if (!s) return null;
    const rs = [];
    for (const q of s.reqs) rs.push(await this.link.ask(q));
    this.status = { ...s.parse(rs, this.model, this.fam), raw: rs.map((r) => hex(r.slice(0, 16))).join(' | ') };
    return this.status;
  },

  async readSidetone() {
    const r = await this.link.ask(SIDETONE_READ);
    return r[2];
  },

  async info() {
    this.need();
    const m = this.model;
    const out = { Model: m.name, 'USB id': `1038:${h4(m.pid)}`, Protocol: this.fam.name, Driver: 'read-only (from the SteelSeries sheet; writes not yet tried on a real headset)' };
    const st = this.line.status ? await this.readStatus().catch(() => null) : null;
    if (this.model.line === 'nova3') out.Status = 'not read (no source has a read for the Nova 3; nothing is sent)';
    else if (!this.line.status) out.Status = 'not read (the sheet does not give this model\'s status request)';
    else if (!st) out.Status = 'no reply';
    else {
      out.Headset = st.online ? 'on' : 'off or out of range (the base answered)';
      if (st.online && st.chat && !this.model.noChat) out.ChatMix = `game ${st.chat.game}%, chat ${st.chat.chat}%`;
      else if (this.model.line === 'pro') out.ChatMix = 'not readable on this model (not in the sheet)';
      else if (this.model.noChat) out.ChatMix = 'not on this model (its dial is not ChatMix)';
    }
    return out;
  },

  // this model's readable values only (keys()); a value the headset does not give right now (off) is null
  async read() {
    this.need();
    const v = {}, keys = this.keys();
    if (keys.includes('sidetone')) v.sidetone = await this.readSidetone();
    if (keys.includes('chatGame')) {
      const st = await this.readStatus();
      v.chatGame = st.online && st.chat ? st.chat.game : null;
      v.chatChat = st.online && st.chat ? st.chat.chat : null;
    }
    return v;
  },

  async write(key, value) {
    this.need();
    const d = DEFS[key];
    if (!d) throw new Error(`${key} is not a setting of this driver`);
    if (d.type === 'display') throw new Error(`${d.label} is read-only (the ChatMix dial is on the headset)`);
    if (!this.keys().includes(key)) throw new Error(`${key} is not a setting of the ${this.model.name}: the headset cannot report it back, so DeviceHub does not write it`);
    if (!d.check(value)) throw new Error(`${value} is not a valid ${d.label.toLowerCase()} for the ${this.model.name}`);
    const app = await this.vendorApp();
    if (app) throw new Error(`${app} is running: close SteelSeries GG first (two programs writing the headset fight)`);
    // read before the write: is the headset there? (a base or dongle answers with the headset off, sheet s2)
    const st = await this.readStatus();
    if (st && !st.online) throw new Error(`the ${this.model.name} is off or out of range; turn it on and try again`);
    await this.link.tell([d.cmd, value]);
    const back = await this.readSidetone();
    if (back !== value) throw new Error(`sidetone read back ${back}, not ${value}`);
    return back;
  },

  async battery() {
    if (!this.link || !this.line.status) return null;
    const st = await this.readStatus();
    return st.online && st.percent != null ? { percent: st.percent, charging: st.charging === true } : null;
  },

  async rawBackup() {
    this.need();
    const values = await this.read().catch(() => null);
    return { model: this.model.name, pid: h4(this.model.pid), status: this.status?.raw ?? null, values };
  },
};
