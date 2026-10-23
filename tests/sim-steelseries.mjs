// Offline test of the SteelSeries Arctis library driver (device-library/steelseries-arctis/device.mjs) against
// simulated headsets, one per message family of docs/brands/steelseries.md, each answering exactly as the sheet
// documents: Nova (00 <cmd>, 64-byte hidapi buffer), legacy 06 (Nova Pro), Arctis 9 (00 20 status) and the older
// Arctis 7 (06 18 battery, 06 24 ChatMix). Checks the request bytes, report ids and lengths, read / write / read-back /
// put back, refusals (out of range, read-only, write-only settings, SteelSeries GG running), and that nothing outside
// each family's command list (no save, no firmware, no write-only setting) is ever sent. No hardware: every device here
// is pretend. Run: node tests/sim-steelseries.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeviceProvider } from '../public/devices/hid.js';
import { problem, selfCheck } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: drv, MODELS, WRITE_ONLY, VENDOR_APPS } = await import('../device-library/steelseries-arctis/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/steelseries-arctis/device.json'), 'utf8'));
drv.vendorApp = async () => null;   // no tasklist in the test

const fails = [];
const check = (c, m) => { if (!c) fails.push(m); };
const hx = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// A simulated headset. family: 'nova' | 'legacy06' | 'arctis9' | 'legacy7'. It keeps every report it was sent, replies
// only to the reads the sheet documents, and ignores writes (sheet s2: "Writes get no reply").
class SimHeadset {
  constructor(pid, family, o = {}) {
    Object.assign(this, { vendorId: 0x1038, productId: pid, productName: `sim ${pid.toString(16)}`, opened: false });
    this.family = family;
    this.collections = [{ usagePage: 0xffc0, usage: 1, inputReports: [], outputReports: [], featureReports: [] }];
    this.listeners = new Set();
    this.sent = [];        // [{ id, bytes }]
    this.bad = [];         // anything the sheet does not document, or a write-only setting
    this.state = { sidetone: 1, ...o.state };
    this.o = { online: true, level: 3, charging: false, game: 100, chat: 40, asyncB0: false, ignoreSidetone: false, ...o };
  }
  async open() { this.opened = true; }
  addEventListener(t, f) { if (t === 'inputreport') this.listeners.add(f); }
  removeEventListener(t, f) { this.listeners.delete(f); }
  reply(id, arr, len) { const r = new Uint8Array(len); r.set(arr); setTimeout(() => [...this.listeners].forEach((f) => f({ reportId: id, data: new DataView(r.buffer) })), 1); }
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    this.sent.push({ id, bytes: b });
    const o = this.o, f = this.family;
    if (f === 'nova3') { this.bad.push(`sent ${hx(b.slice(0, 3))} to the Nova 3 (no source has a read for it)`); return; }
    const wantId = f === 'legacy06' || f === 'legacy7' || f === 'legacy1' ? 0x06 : 0x00, wantLen = f === 'nova' ? 63 : 30;
    if (id !== wantId) this.bad.push(`report id ${id} (want ${wantId})`);
    if (b.length !== wantLen) this.bad.push(`length ${b.length} (want ${wantLen})`);
    const cmd = b[0];
    if (f === 'nova') {
      if (cmd === 0xb0) {
        if (this.status === null) { this.bad.push('status request sent to a model whose request the sheet does not give'); return; }
        // Nova 7: byte 2 level, byte 3 status (00 offline, 01/02 charging, 03 battery); 7+: byte 1 01 offline, byte 3 01 charging
        // Nova 3P (HC nova_3p_wireless getBattery): byte 1 02 offline, byte 3 percent, byte 4 01 charging
        const r = this.status === 'a7p'
          ? [0xb0, o.online ? 0x00 : 0x01, o.level, o.charging ? 0x01 : 0x00, o.game, o.chat]
          : this.status === 'nova3p'
            ? [0xb0, o.online ? 0x00 : 0x02, 0x00, o.level, o.charging ? 0x01 : 0x00]
            : [0xb0, 0x00, o.level, o.online ? (o.charging ? 0x01 : 0x03) : 0x00, o.game, o.chat];
        this.reply(0, r, 63);
      } else if (cmd === 0x20) {
        if (!this.gen2) { this.bad.push('00 20 sent to a Nova that is not the Gen 2'); return; }
        if (o.asyncB0) this.reply(0, [0xb0, 0x00, 99, 0x03, 1, 1], 63);   // an unasked status report lands first
        this.reply(0, [0x20, 0x00, this.state.sidetone], 63);
      } else if (cmd === 0x39) {
        if (!this.gen2) this.bad.push('sidetone written on a Nova that cannot read it back');
        if (b[1] > 3) this.bad.push(`sidetone ${b[1]} out of range`);
        if (!o.ignoreSidetone) this.state.sidetone = b[1];
        this.state.sidetoneSent = b[1];
      } else this.bad.push(`undocumented or write-only Nova command ${hx(b.slice(0, 3))}`);
    } else if (f === 'legacy06') {
      if (cmd === 0xb0) {
        // hidapi bytes (report id 06 at byte 0): byte 6 = 0-8, byte 15 = 01 offline / 02 charging; here data = byte - 1
        const r = new Array(30).fill(0); r[0] = 0xb0; r[5] = o.level; r[14] = o.online ? (o.charging ? 0x02 : 0x03) : 0x01;
        this.reply(6, r, 30);
      } else this.bad.push(`undocumented or write-only 06 command ${hx(b.slice(0, 3))}`);
    } else if (f === 'arctis9') {
      if (cmd === 0x20) {
        // 00 20, read 12: byte 3 = 0x64-0x9A, byte 4 01 = charging, byte 9 game 0-19, byte 10 chat 0-19
        const r = new Array(12).fill(0); r[0] = 0x20; r[3] = o.level; r[4] = o.charging ? 1 : 0; r[9] = o.game; r[10] = o.chat;
        this.reply(0, r, 30);
      } else this.bad.push(`undocumented Arctis 9 command ${hx(b.slice(0, 3))}`);
    } else if (f === 'legacy7') {
      // hidapi bytes (report id 06 at byte 0, then the command): 06 18 -> byte 2 = percent; 06 24 -> byte 2 game, byte 3 chat
      if (cmd === 0x18) this.reply(6, [0x18, o.level], 7);
      else if (cmd === 0x24) this.reply(6, [0x24, o.game, o.chat], 7);
      else this.bad.push(`undocumented or write-only Arctis 7 command ${hx(b.slice(0, 3))}`);
    } else if (f === 'legacy1') {
      // HC steelseries_arctis_1.hpp: 06 12, read 8 (hidapi bytes: 06, 12, status, battery): byte 2 01 offline, byte 3 percent
      if (cmd === 0x12) this.reply(6, [0x12, o.online ? 0x00 : 0x01, o.level], 7);
      else this.bad.push(`undocumented or write-only Arctis 1 command ${hx(b.slice(0, 3))}`);
    }
  }
}

let plugged = null;
setDeviceProvider(async (filters) => {
  const f = filters[0];
  if (!plugged || f.vendorId !== plugged.vendorId || f.productId !== plugged.productId) return null;
  if (f.usagePage != null && f.usagePage !== (plugged.page ?? 0xffc0)) return null;
  return plugged;
});
async function plug(sim, opts = {}) { Object.assign(sim, opts); plugged = sim; return drv.connect(); }
const reqs = (sim) => sim.sent.map((s) => `${s.id.toString(16).padStart(2, '0')} ${hx(s.bytes.slice(0, 2))}`);
async function refuses(fn, re, what, sim) {
  const n = sim.sent.length;
  try { await fn(); check(false, `${what}: was accepted`); } catch (e) { check(re.test(e.message), `${what}: wrong error (${e.message})`); }
  return sim.sent.length - n;
}

// --- the driver's shape and its device.json ---
check(problem(drv) === null, `the driver passes the my-devices check (${problem(drv)})`);
check(meta.status === 'read-only' && meta.vid === '1038' && Array.isArray(meta.tested) && meta.tested.length === 0 && meta.source === 'docs/brands/steelseries.md', 'device.json: read-only, vid 1038, tested [], source');
const pids = MODELS.map((m) => m.pid.toString(16).padStart(4, '0'));
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify([...pids].sort()), 'device.json pids = the driver\'s model table');
for (const p of ['220a', '2298', '22a7', '2269', '226d', '12b3', '12b6', '12d7', '12d5', '12ec']) check(pids.includes(p), `HeadsetControl's ${p} is in the table`);
check(drv.hid.byPid['12B3'].page === 'FF43' && drv.hid.byPid['12B3'].usage === '0202' && drv.hid.byPid['12B3'].iface === 3 && drv.hid.byPid['12B3'].reportId === 6, 'Arctis 1: interface 3, FF43 / 0202, report id 6');
check(drv.hid.byPid['12EC'].iface === 4 && drv.hid.byPid['12EC'].page === 'FFC0' && drv.hid.byPid['2269'].iface === 3, 'Nova 3 on interface 4, Nova 3P on 3');
check(new Set(MODELS.map((m) => m.name)).size === meta.models.length && MODELS.every((m) => meta.models.includes(m.name)), 'device.json models = the model names');
check(JSON.stringify(drv.settings.map((x) => x.key)) === JSON.stringify(['sidetone', 'chatGame', 'chatChat']), `the page shows only readable settings (${drv.settings.map((x) => x.key)})`);
check(drv.settings.filter((x) => x.key.startsWith('chat')).every((x) => x.type === 'display' && x.unit === '%' && x.min === undefined), 'ChatMix is a reading (display kind), not a slider');
check(WRITE_ONLY.length >= 10 && WRITE_ONLY.every((w) => w.cite && w.bytes), 'write-only settings listed with their source, as documentation');
check(VENDOR_APPS.test('SteelSeriesGG.exe') && VENDOR_APPS.test('SteelSeriesEngine3.exe') && VENDOR_APPS.test('SteelSeriesGGClient.exe') && !VENDOR_APPS.test('steam.exe'), 'GG and Engine are recognised');

// --- Nova family: Arctis Nova 7 (0x2202, battery in 0-4 steps): reads only ---
let s = new SimHeadset(0x2202, 'nova');
check(await plug(s, { status: 'nova7' }), 'Nova 7 (2202) connects');
let b = await drv.battery();
check(b && b.percent === 75 && b.charging === false, `Nova 7 battery: level 3 of 4 = 75% (${JSON.stringify(b)})`);
check(reqs(s)[0] === '00 b0 00', `status request is 00 B0 (${reqs(s)[0]})`);
let info = await drv.info();
check(info.ChatMix === 'game 100%, chat 40%' && info.Headset === 'on' && info.Model === 'Arctis Nova 7', `Nova 7 ChatMix read (${JSON.stringify(info)})`);
let v = await drv.read();
check(JSON.stringify(v) === JSON.stringify({ chatGame: 100, chatChat: 40 }), `Nova 7 read: ChatMix only (${JSON.stringify(v)})`);
s.sent = [];
check(await refuses(() => drv.write('sidetone', 2), /cannot report it back/, 'Nova 7 sidetone (no read)', s) === 0, 'Nova 7 sidetone: write-only, refused, nothing sent');
check(await refuses(() => drv.write('chatGame', 50), /read-only/, 'ChatMix write', s) === 0, 'ChatMix is read-only, nothing sent');
check(await refuses(() => drv.write('autoOff', 30), /not a setting/, 'auto-off (write-only)', s) === 0, 'auto-off is not a setting (no read), nothing sent');
check(await refuses(() => drv.write('micVolume', 7), /not a setting/, 'mic volume (write-only)', s) === 0, 'mic volume is not a setting (no read), nothing sent');
s.o.charging = true;
b = await drv.battery();
check(b.charging === true, 'Nova 7 charging flag (status 01)');
s.o.online = false;
check(await drv.battery() === null, 'Nova 7 with the headset off: no battery');
v = await drv.read();
check(v.chatGame === null && v.chatChat === null, 'headset off: ChatMix unknown');
check(s.bad.length === 0, `Nova 7: nothing undocumented sent (${s.bad})`);

// --- Nova family: 0x22A1 reports percent ---
s = new SimHeadset(0x22a1, 'nova', { level: 64 });
await plug(s, { status: 'nova7' });
b = await drv.battery();
check(b.percent === 64, `Nova 7 (22A1) battery in percent (${b.percent})`);

// --- Nova family: Nova 7 Gen 2 (0x227E): sidetone written, read back, put back; async B0 skipped ---
s = new SimHeadset(0x227e, 'nova', { asyncB0: true, state: { sidetone: 1 } });
await plug(s, { status: 'nova7', gen2: true });
v = await drv.read();
check(v.sidetone === 1 && v.chatGame === 100, `Gen 2 sidetone read from the headset, past an unasked B0 report (${JSON.stringify(v)})`);
const orig = v.sidetone;
check(await drv.write('sidetone', 3) === 3 && s.state.sidetone === 3, 'Gen 2 sidetone 3 written and read back');
check(reqs(s).slice(-3).join(',') === '00 b0 00,00 39 03,00 20 00', `Gen 2: status, 00 39 03, then 00 20 read-back (${reqs(s).slice(-3)})`);
check((await drv.read()).sidetone === 3, 'Gen 2 sidetone reads 3');
check(await drv.write('sidetone', orig) === orig && (await drv.read()).sidetone === orig, 'Gen 2 sidetone put back to the value read before');
check(await refuses(() => drv.write('sidetone', 4), /not a valid/, 'sidetone 4', s) === 0, 'sidetone 4 refused, nothing sent');
check(await refuses(() => drv.write('sidetone', -1), /not a valid/, 'sidetone -1', s) === 0, 'sidetone -1 refused, nothing sent');
check(await refuses(() => drv.write('sidetone', 1.5), /not a valid/, 'sidetone 1.5', s) === 0, 'a fraction refused, nothing sent');
drv.vendorApp = async () => 'SteelSeriesGG.exe';
check(await refuses(() => drv.write('sidetone', 2), /SteelSeries GG/, 'sidetone with GG running', s) === 0 && s.state.sidetone === orig, 'GG running: write refused, nothing sent');
drv.vendorApp = async () => null;
// the library self-check: sidetone passes (same value written and read back), ChatMix is skipped
const vc = await selfCheck(drv, drv.write, { backup: async () => true });
check(vc.ran && vc.keys.sidetone?.ok === true && !('chatGame' in vc.keys) && !('chatChat' in vc.keys), `self-check: sidetone ok, ChatMix (a reading) not written or listed (${JSON.stringify(vc.keys)})`);
check(s.state.sidetone === orig, 'self-check left sidetone as it was');
s.o.online = false;
check(await refuses(() => drv.write('sidetone', 2), /off or out of range/, 'write with the headset off', s) === 1, 'headset off: only the status read is sent, the write is refused');
s.o.online = true;
s.o.ignoreSidetone = true;
await refuses(() => drv.write('sidetone', 0), /read back 1, not 0/, 'a sidetone the headset did not take', s);
check(s.bad.length === 0, `Gen 2: nothing undocumented sent (${s.bad})`);

// --- Nova family: Arctis 7+ (status layout of its own) ---
s = new SimHeadset(0x220e, 'nova', { level: 2, charging: true, game: 70, chat: 100 });
await plug(s, { status: 'a7p' });
b = await drv.battery(); info = await drv.info();
check(b.percent === 50 && b.charging === true && info.ChatMix === 'game 70%, chat 100%', `Arctis 7+ battery 2/4 charging, ChatMix (${JSON.stringify(b)} ${info.ChatMix})`);
v = await drv.read();
check(JSON.stringify(v) === JSON.stringify({ chatGame: 70, chatChat: 100 }), `Arctis 7+ read: ChatMix (${JSON.stringify(v)})`);
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Arctis 7+ sidetone', s) === 0, 'Arctis 7+ sidetone write-only: refused');
s.o.online = false;
check(await drv.battery() === null, 'Arctis 7+ offline (byte 1 = 01): no battery');
check(s.bad.length === 0, `Arctis 7+: nothing undocumented sent (${s.bad})`);

// --- Nova family: Nova 5 (no status request in the sheet: never asked) ---
s = new SimHeadset(0x2232, 'nova');
await plug(s, { status: null });
check(await drv.battery() === null, 'Nova 5: no battery (status request unconfirmed)');
info = await drv.info();
check(/not read/.test(info.Status || ''), 'Nova 5 info says the status is not read');
check(JSON.stringify(await drv.read()) === '{}', 'Nova 5 has nothing readable');
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Nova 5 sidetone', s) === 0, 'Nova 5 sidetone refused');
check(s.sent.length === 0, 'Nova 5: nothing sent at all');

// --- legacy 06 family: Nova Pro Wireless (battery only) ---
s = new SimHeadset(0x12e0, 'legacy06', { level: 6, charging: true });
check(await plug(s), 'Nova Pro (12E0) connects');
b = await drv.battery();
check(b.percent === 75 && b.charging === true, `Nova Pro battery 6/8 = 75%, charging (byte 15 = 02) (${JSON.stringify(b)})`);
check(reqs(s)[0] === '06 b0 00', `Nova Pro status request is 06 B0 (${reqs(s)[0]})`);
info = await drv.info();
check(/not readable/.test(info.ChatMix || ''), 'Nova Pro ChatMix marked as a gap');
check(JSON.stringify(await drv.read()) === '{}', 'Nova Pro has nothing readable on the page');
check(await refuses(() => drv.write('sidetone', 3), /cannot report it back/, 'Nova Pro sidetone', s) === 0, 'Nova Pro sidetone (write-only) refused');
check(await refuses(() => drv.write('eqPresetPro', 2), /not a setting/, 'Nova Pro EQ preset', s) === 0, 'Nova Pro EQ preset (write-only) refused');
s.o.online = false;
check(await drv.battery() === null, 'Nova Pro offline (byte 15 = 01): no battery');
check(s.bad.length === 0, `Nova Pro: nothing undocumented sent (${s.bad})`);

// --- Arctis 9 family: read-only ---
s = new SimHeadset(0x12c2, 'arctis9', { level: 0x9a, charging: false, game: 19, chat: 10 });
check(await plug(s), 'Arctis 9 (12C2) connects');
b = await drv.battery(); info = await drv.info();
check(b.percent === 100 && b.charging === false && info.ChatMix === 'game 100%, chat 53%', `Arctis 9 battery 0x9A = 100%, ChatMix 19/19, 10/19 (${JSON.stringify(b)} ${info.ChatMix})`);
s.o.level = 0x64; s.o.charging = true;
b = await drv.battery();
check(b.percent === 0 && b.charging === true, `Arctis 9 battery 0x64 = 0%, charging (${JSON.stringify(b)})`);
check(reqs(s)[0] === '00 20 00', `Arctis 9 status request is 00 20 (${reqs(s)[0]})`);
check(JSON.stringify(await drv.read()) === JSON.stringify({ chatGame: 100, chatChat: 53 }), 'Arctis 9 read: ChatMix in percent');
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Arctis 9 sidetone', s) === 0, 'Arctis 9 sidetone refused');
check(s.bad.length === 0, `Arctis 9: nothing undocumented sent (${s.bad})`);

// --- older Arctis 7 (2017-19): 06 18 battery, 06 24 ChatMix ---
s = new SimHeadset(0x1260, 'legacy7', { level: 80, game: 0, chat: 191 });
check(await plug(s), 'Arctis 7 (1260) connects');
b = await drv.battery();
check(b && b.percent === 80 && b.charging === false, `Arctis 7 battery 80%, no charge flag (${JSON.stringify(b)})`);
check(JSON.stringify(reqs(s).slice(0, 2)) === JSON.stringify(['06 18 00', '06 24 00']), `Arctis 7 requests 06 18 then 06 24 (${reqs(s)})`);
v = await drv.read();
check(v.chatGame === 100 && v.chatChat === 0, `Arctis 7 ChatMix: 0 = full, 191 = none (${JSON.stringify(v)})`);
s.o.game = 223;
check((await drv.read()).chatGame === 49, 'Arctis 7 ChatMix 223 = about half');
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Arctis 7 sidetone', s) === 0, 'Arctis 7 sidetone (write-only) refused');
check(s.bad.length === 0, `Arctis 7: nothing undocumented sent (${s.bad})`);
s = new SimHeadset(0x1280, 'legacy7', { level: 80 });
await plug(s);
check(await drv.battery() === null && (await drv.read()).chatGame === 0, 'Arctis Pro GameDAC (wired): ChatMix, no battery');

// --- Nova 7P (HC steelseries_arctis_nova_7p.hpp): Nova 7 status, battery only, no ChatMix ---
s = new SimHeadset(0x220a, 'nova', { level: 2, game: 64, chat: 64 });
check(await plug(s, { status: 'nova7' }), 'Nova 7P (220A) connects');
b = await drv.battery(); info = await drv.info();
check(b.percent === 50 && b.charging === false, `Nova 7P (220A) battery 2 of 4 = 50% (${JSON.stringify(b)})`);
check(JSON.stringify(await drv.read()) === '{}' && /not on this model/.test(info.ChatMix || ''), `Nova 7P: no ChatMix (${JSON.stringify(info)})`);
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Nova 7P sidetone', s) === 0, 'Nova 7P sidetone refused');
for (const pid of [0x2298, 0x22a7]) {
  s = new SimHeadset(pid, 'nova', { level: 87, charging: true });
  await plug(s, { status: 'nova7' });
  b = await drv.battery();
  check(b.percent === 87 && b.charging === true && reqs(s)[0] === '00 b0 00', `Nova 7P V2 ${pid.toString(16)}: battery in percent, charging (${JSON.stringify(b)})`);
  s.o.online = false;
  check(await drv.battery() === null, `Nova 7P V2 ${pid.toString(16)} off: no battery`);
  check(s.bad.length === 0, `Nova 7P V2: nothing undocumented sent (${s.bad})`);
}

// --- Nova 3P / 3X Wireless (HC steelseries_arctis_nova_3p_wireless.hpp) ---
for (const pid of [0x2269, 0x226d]) {
  s = new SimHeadset(pid, 'nova', { level: 72, charging: true });
  check(await plug(s, { status: 'nova3p' }), `Nova 3P/3X (${pid.toString(16)}) connects`);
  b = await drv.battery();
  check(b.percent === 72 && b.charging === true && reqs(s)[0] === '00 b0 00', `Nova 3P battery byte 3 percent, byte 4 charging (${JSON.stringify(b)})`);
  check(JSON.stringify(await drv.read()) === '{}', 'Nova 3P: nothing on the page (no readable setting)');
  check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Nova 3P sidetone', s) === 0, 'Nova 3P sidetone refused');
  s.o.online = false;
  check(await drv.battery() === null && (await drv.info()).Headset?.startsWith('off'), 'Nova 3P offline (byte 1 = 02): no battery');
  check(s.bad.length === 0, `Nova 3P: nothing undocumented sent (${s.bad})`);
}

// --- Arctis 1 / 7X / 7P Wireless (HC steelseries_arctis_1.hpp): 06 12 battery on FF43 ---
for (const pid of [0x12b3, 0x12b6, 0x12d7, 0x12d5]) {
  s = new SimHeadset(pid, 'legacy1', { level: 45 });
  s.page = 0xff43;
  check(await plug(s), `Arctis 1 family (${pid.toString(16)}) connects on FF43`);
  b = await drv.battery();
  check(b && b.percent === 45 && b.charging === false && reqs(s)[0] === '06 12 00', `Arctis 1 battery 45%, request 06 12 (${JSON.stringify(b)} ${reqs(s)[0]})`);
  check(JSON.stringify(await drv.read()) === '{}', 'Arctis 1: no ChatMix');
  check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Arctis 1 sidetone', s) === 0, 'Arctis 1 sidetone (write-only) refused');
  s.o.online = false;
  check(await drv.battery() === null, 'Arctis 1 offline (byte 2 = 01): no battery');
  check(s.bad.length === 0, `Arctis 1: nothing undocumented sent (${s.bad})`);
}

// --- Arctis Nova 3 (12EC): named only, nothing sent ---
s = new SimHeadset(0x12ec, 'nova3');
check(await plug(s), 'Nova 3 (12EC) connects');
info = await drv.info();
check(info.Model === 'Arctis Nova 3' && /no source has a read/.test(info.Status || ''), `Nova 3 info (${JSON.stringify(info)})`);
check(await drv.battery() === null && JSON.stringify(await drv.read()) === '{}', 'Nova 3: no battery, nothing readable');
check(await refuses(() => drv.write('sidetone', 1), /cannot report it back/, 'Nova 3 sidetone', s) === 0, 'Nova 3 sidetone refused');
check(s.sent.length === 0 && s.bad.length === 0, `Nova 3: nothing sent at all (${s.bad})`);

// --- never a save, firmware or write-only command: each family frames only its own list ---
const src = fs.readFileSync(path.join(ROOT, 'device-library/steelseries-arctis/device.mjs'), 'utf8');
check(!/tell\(\[0x09|0x35, 0x01|0x90, 0x00/.test(src), 'no save command in the driver');
for (const [pid, fam, bad] of [[0x2202, 'nova', [0x09, 0xa3, 0xae, 0x37, 0x33, 0x3a, 0x18]], [0x12e0, 'legacy06', [0x09, 0x39, 0xc1, 0x2e, 0xbf]], [0x12c2, 'arctis9', [0x00, 0x90, 0x39]], [0x1260, 'legacy7', [0x35, 0x51, 0x55, 0x09]], [0x12b3, 'legacy1', [0x09, 0x35, 0x53, 0x18, 0xb0]], [0x12ec, 'nova3', [0x09, 0x39, 0x37, 0xae, 0x33, 0xb0]], [0x2269, 'nova', [0x09, 0xa3, 0x37, 0x33]]]) {
  const sim = new SimHeadset(pid, fam); if (fam === 'legacy1') sim.page = 0xff43;
  await plug(sim);
  for (const c of bad) { let threw = false; try { drv.link.frame([c]); } catch { threw = true; } check(threw, `${fam}: refuses to frame ${c.toString(16)}`); }
}

// --- nothing plugged in ---
plugged = null;
check(await drv.connect() === false, 'no headset: connect() is false');

console.log(fails.length ? `sim-steelseries: FAILED: ${fails.join('; ')}` : 'sim-steelseries (Nova, Nova 7P, Nova 3P, Nova 3, Nova Pro, Arctis 9, Arctis 7, Arctis 1 simulated; write-only settings refused): all good');
if (fails.length) process.exitCode = 1;
