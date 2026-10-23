// The Logitech HID++ 2.0 mouse driver (device-library/logitech-hidpp-mouse) against simulated mice that answer exactly as
// docs/brands/logitech.md documents: IRoot getFeature/ping, IFeatureSet, battery (0x1004 / 0x1000), DPI (0x2201),
// report rate (0x8061 / 0x8060), onboard/host mode (0x8100 fn 0x10/0x20), HID++ 2.0 error replies and events; and since
// 22 Oct 2026 lift-off (0x2202 caps 0x10 / read 0x50 / write 0x60, Solaar), onboard profile info / select (0x8100 fn 0x00,
// 0x30 / 0x40) and DPI slot (0xB0 / 0xC0, libratbag), the profile numbering quirk, and the G HUB refusal.
// Checks the driver's request bytes against the sheet byte for byte, and read / write / read-back.
// Run: node tests/sim-logitech.mjs (no hardware)
import driver, { useDevice, F, NEVER, HidppError, BLE, BLE_HID, isReplyTo, isReplyToBle, WIRED, WPIDS, RECEIVERS, PROFILE_READ_1BASED } from '../device-library/logitech-hidpp-mouse/device.mjs';
driver.vendorApp = async () => null;   // no tasklist in the test; section 5 swaps in G HUB
driver.pingMs = 150;                   // an empty slot never answers: a short wait keeps the test quick

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// A simulated mouse. features: { featureId: index }; state holds what the mouse would hold.
// profiles: { count, oneBasedRead, profile (1-based), slot (0-4) }; ext: { caps (0x2202 b2), lod, y }
// replyIndex: the device index the mouse puts in its replies (a Bluetooth device answers 0xFF with 0x00, Solaar base.py)
// kind: what DEVICE_NAME fn 0x20 answers (Solaar hidpp20_constants.py DEVICE_KIND: 0 keyboard, 3 mouse), when 0x0005 is in features
// hits: the HITS feature 0x1B0C (22 Oct 2026, docs/handoff/superstrike.md): { caps: [6 bytes], recs: { btn: [act, rt, hap] raw } };
// fn 0x00 caps, fn 0x20 [btn] read, fn 0x10 [btn, act, rt, hap] write, refusing what the sources say the mouse refuses
// (K PROTOCOL.md: out of range -> 0x02 invalid argument; S: a reserved low bit set -> INVALID_ARGUMENT; X: index 2 answers nothing)
function simMouse({ pid, slot, features, dpiList, rateExt, rateMask, battery, mode, profiles, ext, replyIndex, kind, hits }) {
  const state = { dpi: 800, defaultDpi: 800, rateIndex: 3, rateMs: 1, mode, ...battery, ...(profiles || {}), lod: ext?.lod ?? 0, y: ext?.y ?? 0 };
  const byIndex = Object.fromEntries(Object.entries(features).map(([id, i]) => [i, Number(id)]));
  const sent = [];
  const listeners = new Set();
  const dev = {
    opened: false, productId: pid, sent, state, hits, failNext: null, eventFirst: false,
    async open() { this.opened = true; },
    addEventListener(t, fn) { if (t === 'inputreport') listeners.add(fn); },
    removeEventListener(t, fn) { listeners.delete(fn); },
    async sendReport(reportId, data) {
      const b = Array.from(data);
      sent.push({ reportId, b });
      if (reportId !== 0x11 || b.length !== 19) return;                  // only long reports are answered
      const [d, idx, fs] = b, p = b.slice(3);
      if (d !== slot) return;                                             // empty slot: no HID++ 2.0 answer
      const ri = replyIndex ?? d;
      const reply = (params) => [ri, idx, fs, ...params, ...Array(16).fill(0)].slice(0, 19);
      const err = (code) => [ri, 0xff, idx, fs, code, ...Array(14).fill(0)];
      const emit = (bytes) => setTimeout(() => { for (const fn of [...listeners]) fn({ reportId: 0x11, data: new DataView(Uint8Array.from(bytes).buffer) }); }, 1);
      if (this.eventFirst) { this.eventFirst = false; emit([d, features[F.UNIFIED_BATTERY] || 1, 0x00, 50, 4, 0, 0, ...Array(12).fill(0)]); }  // battery event, software id 0
      if (this.failNext) { const c = this.failNext; this.failNext = null; return emit(err(c)); }
      if ((fs & 0x0f) === 0) return emit(err(0x07));
      const fn = fs & 0xf0, id = byIndex[idx];
      let out = null;
      if (idx === 0 && fn === 0x00) { const want = (p[0] << 8) | p[1]; out = features[want] ? [features[want], 0, 1] : [0, 0, 0]; }
      else if (idx === 0 && fn === 0x10) out = [4, 2, p[2]];                                  // HID++ 4.2, mark echoed
      else if (id === F.UNIFIED_BATTERY && fn === 0x00) out = [0, 0x02 | 0x01];               // caps: b1 bit1 = reports %
      else if (id === F.UNIFIED_BATTERY && fn === 0x10) out = [state.percent, 4, state.charge, state.external];
      else if (id === F.BATTERY_STATUS && fn === 0x00) out = [state.percent, 20, state.status];
      else if (id === F.ADJUSTABLE_DPI && fn === 0x10) out = [0, ...dpiList.flatMap((v) => [v >> 8, v & 0xff]), 0, 0];
      else if (id === F.ADJUSTABLE_DPI && fn === 0x20) out = [0, state.dpi >> 8, state.dpi & 0xff, state.defaultDpi >> 8, state.defaultDpi & 0xff];
      else if (id === F.ADJUSTABLE_DPI && fn === 0x30) { const v = (p[1] << 8) | p[2]; if (v < 100 || v > 25600) return emit(err(0x02)); state.dpi = v; out = [0, p[1], p[2]]; }
      else if (id === F.EXT_REPORT_RATE && rateExt && fn === 0x10) out = [0, rateMask];
      else if (id === F.EXT_REPORT_RATE && rateExt && fn === 0x20) out = [state.rateIndex];
      else if (id === F.EXT_REPORT_RATE && rateExt && fn === 0x30) { if (!(rateMask & (1 << p[0]))) return emit(err(0x02)); state.rateIndex = p[0]; out = []; }
      else if (id === F.REPORT_RATE && fn === 0x00) out = [rateMask];
      else if (id === F.REPORT_RATE && fn === 0x10) out = [state.rateMs];
      else if (id === F.REPORT_RATE && fn === 0x20) { if (!(rateMask & (1 << (p[0] - 1)))) return emit(err(0x02)); state.rateMs = p[0]; out = []; }
      else if (id === F.ONBOARD_PROFILES && fn === 0x20) out = [state.mode];
      // libratbag struct hidpp20_onboard_profiles_info: memory model, profile format, macro format, profile_count, ...
      else if (id === F.ONBOARD_PROFILES && fn === 0x00 && profiles) out = [1, 1, 1, profiles.count, 0, 6, 16, 0x0f, 0xff];
      else if (id === F.ONBOARD_PROFILES && fn === 0x40 && profiles) out = [0, state.oneBasedRead ? state.profile : state.profile - 1];
      else if (id === F.ONBOARD_PROFILES && fn === 0x30 && profiles) { if (p[0] !== 0 || p[1] < 1 || p[1] > profiles.count) return emit(err(0x02)); state.profile = p[1]; out = []; }
      else if (id === F.ONBOARD_PROFILES && fn === 0xb0 && profiles) out = [state.slot];
      else if (id === F.ONBOARD_PROFILES && fn === 0xc0 && profiles) { if (p[0] > 4) return emit(err(0x02)); state.slot = p[0]; out = []; }
      else if (id === F.EXT_ADJUSTABLE_DPI && fn === 0x10 && ext) out = [0, 0, ext.caps];
      else if (id === F.EXT_ADJUSTABLE_DPI && fn === 0x50 && ext) out = [0, state.dpi >> 8, state.dpi & 0xff, 3, 0x20, state.y >> 8, state.y & 0xff, 3, 0x20, state.lod];
      else if (id === F.EXT_ADJUSTABLE_DPI && fn === 0x60 && ext) { if (p[0] !== 0 || p[5] > 2) return emit(err(0x02)); state.dpi = (p[1] << 8) | p[2]; state.y = (p[3] << 8) | p[4]; state.lod = p[5]; out = []; }
      else if (id === F.ONBOARD_PROFILES && fn === 0x10) { if (![1, 2].includes(p[0])) return emit(err(0x02)); state.mode = p[0]; out = []; }
      else if (id === F.DEVICE_NAME && fn === 0x20) out = [kind ?? 3];
      else if (id === F.ANALOG_BUTTONS && hits && fn === 0x00) out = hits.caps;
      else if (id === F.ANALOG_BUTTONS && hits && fn === 0x20) { if (!(p[0] in hits.recs)) return emit(err(0x02)); out = [p[0], ...hits.recs[p[0]]]; }
      else if (id === F.ANALOG_BUTTONS && hits && fn === 0x10) {
        const [bt, a, r, hp] = p;
        if (!(bt in hits.recs) || (a & 3) || a < 0x04 || a > 0x28 || (r & 2) || (r >> 2) < 1 || (r >> 2) > 5 || (hp & 3) || hp > 0x14) return emit(err(0x02));
        if (!hits.ignoreWrites) hits.recs[bt] = [a, r, hp];   // ignoreWrites: acks but keeps the old record
        out = [bt, a, r, hp];
      }
      else return emit(err(0x07));                                                             // invalid function
      emit(reply(out));
    },
  };
  return dev;
}
const frames = (dev) => dev.sent.map((s) => s.b);
const has = (dev, want) => frames(dev).some((b) => want.every((x, i) => b[i] === x) && b.slice(want.length).every((x) => x === 0));
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
let n, e;

// ---- 1. an 8K mouse on a Lightspeed receiver (slot 1): 0x1004 battery, DPI range, 0x8061, onboard profiles ----
const m1 = simMouse({ pid: 0xc539, slot: 1, features: { [F.FEATURE_SET]: 1, [F.UNIFIED_BATTERY]: 4, [F.ADJUSTABLE_DPI]: 7, [F.EXT_REPORT_RATE]: 9, [F.ONBOARD_PROFILES]: 11 },
  dpiList: [100, 0xe000 | 50, 25600], rateExt: true, rateMask: 0x7f, battery: { percent: 77, charge: 1, external: 1 }, mode: 1,
  profiles: { count: 3, oneBasedRead: false, profile: 1, slot: 1 } });
useDevice(m1);
check(await driver.connect(false), 'receiver mouse connects');
check(m1.sent.every((s) => s.reportId === 0x11 && s.b.length === 19), 'every request is a 20-byte long report (0x11 + 19 bytes)');
// sheet section 2: ping = IRoot fn 0x10, params 00 00 <mark>, software id 0x0B in the low nibble; slot 1 on a receiver
check(has(m1, [0x01, 0x00, 0x1b, 0x00, 0x00, 0x5a]), `ping bytes: ${h(frames(m1)[0])}`);
// getFeature = fn 0x00, feature id big-endian
check(has(m1, [0x01, 0x00, 0x0b, 0x22, 0x01]), 'getFeature 0x2201 is 01 00 0B 22 01');
check(has(m1, [0x01, 0x00, 0x0b, 0x80, 0x61]) && has(m1, [0x01, 0x00, 0x0b, 0x10, 0x04]) && has(m1, [0x01, 0x00, 0x0b, 0x81, 0x00]), 'getFeature for 0x8061, 0x1004, 0x8100');
check(!frames(m1).some((b) => b[1] === 0 && b[2] === 0x0b && NEVER.includes((b[3] << 8) | b[4])), 'no DFU / reset / pairing feature is ever looked up');
check(driver.features[F.ADJUSTABLE_DPI]?.index === 7 && driver.features[F.EXT_REPORT_RATE]?.index === 9, 'indexes come from getFeature, not fixed');
check(!driver.features[F.REPORT_RATE] && !driver.features[F.BATTERY_STATUS], 'absent features (index 0) are left out');
check(has(m1, [0x01, 7, 0x1b, 0x00]), 'DPI list = 0x2201 fn 0x10 [sensor 0]');
check(has(m1, [0x01, 9, 0x1b]), '8K rate list = 0x8061 fn 0x10');
const dpiS = driver.settings.find((s) => s.key === 'dpi');
check(dpiS.type === 'slider' && dpiS.min === 100 && dpiS.max === 25600 && dpiS.step === 50, `DPI slider from the mouse's range (${JSON.stringify(dpiS)})`);
const rateS = driver.settings.find((s) => s.key === 'reportRate');
check(rateS.options.map((o) => o.value).join() === '125,250,500,1000,2000,4000,8000', `rate choices from 0x8061's list (${rateS.options.map((o) => o.value)})`);

let v = await driver.read();
check(v.dpi === 800 && v.reportRate === 1000 && v.mode === 'onboard' && v.profile === 1 && v.dpiStage === 2 && v.liftOff === undefined, `read: ${JSON.stringify(v)}`);
check(has(m1, [0x01, 11, 0x0b]) && has(m1, [0x01, 11, 0x4b]) && has(m1, [0x01, 11, 0xbb]), 'profile reads: 0x8100 fn 0x00 info, fn 0x40 current, fn 0xB0 DPI slot');
check(driver.settings.find((x) => x.key === 'profile').options.map((o) => o.value).join() === '1,2,3', 'profile choices from the info read (profile_count 3)');
check(driver.profileReadBase === 0, 'a 0 reading teaches 0-based profile reads');
// profile select (works in onboard mode): 0x8100 fn 0x30 [00, number], read back, put back
n = m1.sent.length;
check((await driver.write('profile', 3)) === 3 && m1.state.profile === 3, 'profile 3 selected and read back');
check(m1.sent.slice(n).some((x) => h(x.b.slice(0, 5)) === '01 0b 3b 00 03'), 'profile 3 = 01 0B 3B 00 03 (libratbag: index + 1)');
e = await refusal(() => driver.write('profile', 4));
check(/1-3/.test(e?.message || '') && m1.state.profile === 3, `profile 4 of 3 refused before sending (${e?.message})`);
e = await refusal(() => driver.write('profile', 0));
check(/1-3/.test(e?.message || ''), 'profile 0 refused');
check((await driver.write('profile', 1)) === 1 && m1.state.profile === 1, 'profile put back to 1');
// DPI stage: 0x8100 fn 0xC0 [slot 0-4]
n = m1.sent.length;
check((await driver.write('dpiStage', 5)) === 5 && m1.state.slot === 4, 'DPI stage 5 written (slot 4) and read back');
check(m1.sent.slice(n).some((x) => h(x.b.slice(0, 4)) === '01 0b cb 04'), 'DPI stage 5 = 01 0B CB 04');
e = await refusal(() => driver.write('dpiStage', 6));
check(/1-5/.test(e?.message || '') && m1.state.slot === 4, `DPI stage 6 refused (${e?.message})`);
check((await driver.write('dpiStage', 2)) === 2 && m1.state.slot === 1, 'DPI stage put back to 2');
e = await refusal(() => driver.write('liftOff', 'high'));
check(/onboard|lift-off/.test(e?.message || ''), `no 0x2202: lift-off refused (${e?.message})`);
check(has(m1, [0x01, 7, 0x2b, 0x00]) && has(m1, [0x01, 9, 0x2b]) && has(m1, [0x01, 11, 0x2b]), 'reads: 0x2201 fn 0x20 [0], 0x8061 fn 0x20, 0x8100 fn 0x20');
const b1 = await driver.battery();
check(b1.percent === 77 && b1.charging === true && b1.level === 'good' && b1.external === true, `0x1004 battery: ${JSON.stringify(b1)}`);
check(has(m1, [0x01, 4, 0x0b]) && has(m1, [0x01, 4, 0x1b]), 'battery: 0x1004 caps fn 0x00, status fn 0x10');
const info = await driver.info();
check(/receiver C539/.test(info.Model) && info['HID++'] === '4.2' && /onboard/.test(info['Settings source']), `info: ${JSON.stringify(info)}`);

// onboard mode: DPI is not written, and nothing was sent for it
n = m1.sent.length;
e = await refusal(() => driver.write('dpi', 1600));
check(/onboard/.test(e?.message || '') && !m1.sent.slice(n).some((s) => s.b[1] === 7 && (s.b[2] & 0xf0) === 0x30), `onboard mode refuses a DPI write without sending it (${e?.message})`);
// the explicit switch: 0x8100 fn 0x10 [02], read back
n = m1.sent.length;
check((await driver.write('mode', 'host')) === 'host' && m1.state.mode === 2, 'switches to host mode and reads it back');
check(h(m1.sent[n].b.slice(0, 4)) === '01 0b 1b 02', `mode write bytes: ${h(m1.sent[n].b.slice(0, 5))}`);
// DPI write: 0x2201 fn 0x30 [sensor, hi, lo], then read back
n = m1.sent.length;
check((await driver.write('dpi', 1600)) === 1600 && m1.state.dpi === 1600, 'DPI write reads back 1600');
check(m1.sent.slice(n).some((s) => h(s.b.slice(0, 6)) === '01 07 3b 00 06 40'), 'DPI 1600 = 01 07 3B 00 06 40');
e = await refusal(() => driver.write('dpi', 1625));
check(/steps of 50/.test(e?.message || ''), `off-step DPI refused before sending (${e?.message})`);
// 8K rate write: 0x8061 fn 0x30 [index], 8000 Hz = index 6
n = m1.sent.length;
check((await driver.write('reportRate', 8000)) === 8000 && m1.state.rateIndex === 6, '8000 Hz written and read back');
check(m1.sent.slice(n).some((s) => h(s.b.slice(0, 4)) === '01 09 3b 06'), '8000 Hz = 01 09 3B 06');
// error reply (sheet section 2 "Errors": <dev> FF <idx> <fn+swid> <code>)
m1.failNext = 0x08;
e = await refusal(() => driver.write('dpi', 800));
check(e instanceof HidppError && e.code === 0x08 && /busy/.test(e.message), `an error reply is reported with its code (${e?.message})`);
check(m1.state.dpi === 1600, 'the refused DPI write changed nothing');
// a battery event (software id 0) arriving before the reply is ignored
m1.eventFirst = true;
check((await driver.read()).dpi === 1600, 'an event before the reply is skipped, the real reply used');
// put the mouse back as it started
check((await driver.write('reportRate', 1000)) === 1000 && (await driver.write('dpi', 800)) === 800 && (await driver.write('mode', 'onboard')) === 'onboard', 'original values put back and read back');
check(m1.state.mode === 1 && m1.state.dpi === 800 && m1.state.rateIndex === 3, 'the mouse ends as it started');
// never: onboard memory functions, DFU features; every 0x8100 request is fn 0x10 or 0x20
check(m1.sent.filter((s) => s.b[1] === 11).every((s) => [0x00, 0x10, 0x20, 0x30, 0x40, 0xb0, 0xc0].includes(s.b[2] & 0xf0)), '0x8100: only info, mode, profile and DPI-slot functions were sent (never memory 0x50-0x80)');
for (const fn of [0x50, 0x70, 0x80]) { e = await refusal(() => driver.call(F.ONBOARD_PROFILES, fn, [0, 0])); check(/refused/.test(e?.message || ''), `call() refuses 0x8100 fn 0x${fn.toString(16)}`); }
check(m1.sent.every((s) => (s.b[2] & 0x0f) === 0x0b), 'every request carries software id 0x0B');
e = await refusal(() => driver.call(F.ONBOARD_PROFILES, 0x60, [0, 0]));
check(/refused/.test(e?.message || ''), 'call() refuses onboard memory writes');
e = await refusal(() => driver.call(0x00d0, 0x00));
check(/refused/.test(e?.message || ''), 'call() refuses DFU');
e = await refusal(() => driver.write('nonsense', 1));
check(/not a setting/.test(e?.message || ''), 'unknown key refused');
const raw = await driver.rawBackup();
check(raw.features['0x2201']?.index === 7 && raw.dpi === 800, 'rawBackup holds the feature table and values');

// ---- 2. a wired mouse: index 0xFF, 0x1000 battery, DPI list, 0x8060, no onboard profiles ----
const m2 = simMouse({ pid: 0xc094, slot: 0xff, features: { [F.BATTERY_STATUS]: 3, [F.ADJUSTABLE_DPI]: 5, [F.REPORT_RATE]: 6 },
  dpiList: [400, 800, 1600, 3200], rateExt: false, rateMask: 0x8b, battery: { percent: 55, status: 3 }, mode: 0 });
useDevice(m2);
check(await driver.connect(false), 'wired mouse connects');
check(h(m2.sent[0].b.slice(0, 6)) === 'ff 00 1b 00 00 5a', `wired ping uses index 0xFF: ${h(m2.sent[0].b.slice(0, 6))}`);
check(driver.settings.find((s) => s.key === 'dpi').type === 'choice' && driver.settings.find((s) => s.key === 'dpi').options.map((o) => o.value).join() === '400,800,1600,3200', 'a DPI list becomes a choice');
check(driver.settings.find((s) => s.key === 'reportRate').options.map((o) => o.value).join() === '125,250,500,1000', '0x8060 list 1/2/4/8 ms = 125-1000 Hz');
check(has(m2, [0xff, 6, 0x0b]), 'rate list = 0x8060 fn 0x00');
v = await driver.read();
check(v.dpi === 800 && v.reportRate === 1000 && v.mode === undefined, `wired read: ${JSON.stringify(v)}`);
const b2 = await driver.battery();
check(b2.percent === 55 && b2.charging === false && b2.full === true && has(m2, [0xff, 3, 0x0b]), `0x1000 battery: ${JSON.stringify(b2)}`);
check(/PRO X SUPERLIGHT/.test((await driver.info()).Model), 'wired model named from its product id');
n = m2.sent.length;
check((await driver.write('reportRate', 500)) === 500 && m2.state.rateMs === 2, '500 Hz written and read back');
check(m2.sent.slice(n).some((s) => h(s.b.slice(0, 4)) === 'ff 06 2b 02'), '500 Hz = FF 06 2B 02 (0x8060 fn 0x20 [ms])');
check(has(m2, [0xff, 6, 0x1b]), 'rate read = 0x8060 fn 0x10');
check((await driver.write('dpi', 3200)) === 3200 && has(m2, [0xff, 5, 0x3b, 0x00, 0x0c, 0x80]), 'DPI 3200 = FF 05 3B 00 0C 80, read back');
e = await refusal(() => driver.write('dpi', 1000));
check(/one of/.test(e?.message || ''), 'a DPI not in the list is refused');
e = await refusal(() => driver.write('mode', 'host'));
check(/no onboard/.test(e?.message || ''), 'no mode switch without 0x8100');
await driver.write('reportRate', 1000); await driver.write('dpi', 800);
check(m2.state.rateMs === 1 && m2.state.dpi === 800, 'wired mouse put back');

// ---- 3. a Bolt receiver whose mouse is in slot 2; and a receiver keyboard (no 0x2201) is refused ----
const m3 = simMouse({ pid: 0xc548, slot: 2, features: { [F.ADJUSTABLE_DPI]: 2 }, dpiList: [800, 1600], rateMask: 0, battery: {}, mode: 0 });
useDevice(m3);
check(await driver.connect(false) && driver.index === 2, 'Bolt: slot 1 silent, mouse found in slot 2');
check(/Bolt/.test((await driver.info()).Connection) && (await driver.battery()) === null, 'Bolt info; no battery feature = null');
const kb = simMouse({ pid: 0xc53f, slot: 1, features: { [F.UNIFIED_BATTERY]: 3 }, dpiList: [], rateMask: 0, battery: { percent: 90, charge: 0, external: 0 }, mode: 0 });
useDevice(kb);
e = await refusal(() => driver.connect(false));
check(/not a mouse/.test(e?.message || ''), `a keyboard on a receiver is refused (${e?.message})`);

// ---- 4. a wired G502 X LIGHTSPEED: 1-based profile reads (libratbag quirk), 0x2202 with LOD and separate Y ----
const m4 = simMouse({ pid: 0xc098, slot: 0xff, features: { [F.ADJUSTABLE_DPI]: 4, [F.EXT_ADJUSTABLE_DPI]: 5, [F.REPORT_RATE]: 6, [F.ONBOARD_PROFILES]: 8 },
  dpiList: [100, 0xe000 | 50, 25600], rateExt: false, rateMask: 0x0f, battery: {}, mode: 2,
  profiles: { count: 5, oneBasedRead: true, profile: 2, slot: 0 }, ext: { caps: 0x03, lod: 1, y: 900 } });
useDevice(m4);
check(await driver.connect(false), 'G502 X connects');
check(has(m4, [0xff, 5, 0x1b, 0x00]), 'lift-off caps = 0x2202 fn 0x10 [00]');
check(driver.caps.ext?.lod === true && driver.caps.ext?.separateY === true && driver.profileReadBase === 1, `caps: ${JSON.stringify(driver.caps.ext)}, profile base ${driver.profileReadBase}`);
v = await driver.read();
check(v.liftOff === 'medium' && v.profile === 2 && v.dpiStage === 1 && v.mode === 'host', `G502 X read: ${JSON.stringify(v)}`);
check(has(m4, [0xff, 5, 0x5b, 0x00]), 'lift-off read = 0x2202 fn 0x50 [00]');
// lift-off write: [00, X, Y, LOD] with X and Y as read
n = m4.sent.length;
check((await driver.write('liftOff', 'high')) === 'high' && m4.state.lod === 2 && m4.state.dpi === 800 && m4.state.y === 900, 'lift-off high written, DPI X/Y unchanged, read back');
check(m4.sent.slice(n).some((x) => h(x.b.slice(0, 9)) === 'ff 05 6b 00 03 20 03 84 02'), `lift-off = FF 05 6B 00 03 20 03 84 02 (${m4.sent.slice(n).map((x) => h(x.b.slice(0, 9))).join(' | ')})`);
e = await refusal(() => driver.write('liftOff', 'ultra'));
check(/one of/.test(e?.message || '') && m4.state.lod === 2, `unknown lift-off refused (${e?.message})`);
check((await driver.write('liftOff', 'medium')) === 'medium' && m4.state.lod === 1, 'lift-off put back to medium');
// 1-based read: profile 5 reads 5
check((await driver.write('profile', 5)) === 5 && m4.state.profile === 5, 'G502 X profile 5 written and read back (1-based read)');
check((await driver.write('profile', 2)) === 2 && m4.state.profile === 2, 'G502 X profile put back');
// onboard mode refuses lift-off without sending it
await driver.write('mode', 'onboard');
n = m4.sent.length;
e = await refusal(() => driver.write('liftOff', 'low'));
check(/onboard/.test(e?.message || '') && !m4.sent.slice(n).some((x) => x.b[1] === 5 && (x.b[2] & 0xf0) === 0x60), `onboard mode: lift-off refused unsent (${e?.message})`);
await driver.write('mode', 'host');
check(m4.state.mode === 2, 'G502 X ends as it started');

// ---- 5. a receiver mouse whose profile reading is ambiguous: not reported, not written; and G HUB running ----
const m5 = simMouse({ pid: 0xc54d, slot: 1, features: { [F.ADJUSTABLE_DPI]: 2, [F.ONBOARD_PROFILES]: 3 },
  dpiList: [800, 1600], rateMask: 0, battery: {}, mode: 1, profiles: { count: 3, oneBasedRead: true, profile: 2, slot: 0 } });
useDevice(m5);
check(await driver.connect(false), 'receiver mouse 5 connects');
v = await driver.read();
check(v.profile === undefined && v.dpiStage === 1, `an ambiguous profile reading (2 of 3) is not reported: ${JSON.stringify(v)}`);
e = await refusal(() => driver.write('profile', 1));
check(/not known/.test(e?.message || '') && m5.state.profile === 2, `profile not written while its numbering is unknown (${e?.message})`);
driver.vendorApp = async () => 'lghub_agent.exe';
n = m5.sent.length;
for (const [k, val] of [['dpiStage', 2], ['mode', 'host'], ['dpi', 800]]) {
  e = await refusal(() => driver.write(k, val));
  check(/G HUB/.test(e?.message || ''), `${k} refused while G HUB runs (${e?.message})`);
}
check(m5.sent.length === n && m5.state.slot === 0 && m5.state.mode === 1, 'nothing was sent while G HUB runs');
driver.vendorApp = async () => null;

// ---- 6. the library self-check on this driver (22 Oct 2026, docs/handoff/setup-gaps.md): Settings source gets the
// normal check (the same mode written back, never switched); DPI / rate wait in onboard mode instead of failing; a
// later connect after a day tries them again; G HUB open = nothing written, tried on a later connect ----
{
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { guard, readVerified } = await import('../helpers/my-devices.mjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-logi-check-'));
  const m6 = simMouse({ pid: 0xc539, slot: 1, features: { [F.ADJUSTABLE_DPI]: 7, [F.EXT_REPORT_RATE]: 9, [F.ONBOARD_PROFILES]: 11 },
    dpiList: [100, 0xe000 | 50, 25600], rateExt: true, rateMask: 0x7f, battery: {}, mode: 1, profiles: { count: 3, oneBasedRead: false, profile: 1, slot: 1 } });
  useDevice(m6);
  let clock = Date.parse('2026-10-22T10:00:00Z');
  const backups = [], logs = [];
  driver.vendorApp = async () => 'lghub_agent.exe';
  guard(driver, folder, { status: 'read-only', source: 'device-library/logitech-hidpp-mouse' }, { backup: async (b) => backups.push(b), log: (t) => logs.push(t), now: () => new Date(clock), version: 'v1' });
  check(await driver.connect(false), 'guarded Logitech connects');
  const modeSent = () => m6.sent.filter((s) => s.b[1] === 11 && (s.b[2] & 0xf0) === 0x10).length;
  // safety round 2: only a simulation record, so nothing is written until the person presses Turn on settings
  check(!fs.existsSync(path.join(folder, 'verified.json')) && backups.length === 0 && modeSent() === 0 && driver.library.turnOn && logs.some((t) => /Turn on settings/.test(t)), `before Turn on settings nothing is written, and it says so (${logs.join(' | ')})`);
  const on = await driver.turnOn();
  check(on.on && !fs.existsSync(path.join(folder, 'verified.json')) && backups.length === 0 && modeSent() === 0 && logs.some((t) => /not run: lghub_agent\.exe .*open/.test(t)), `G HUB open: the self-check writes nothing and says so (${logs.join(' | ')})`);
  driver.vendorApp = async () => null;
  check(await driver.connect(false), 'connects again with G HUB closed');
  let vf = readVerified(folder);
  check(vf.keys.mode?.ok === true && vf.keys.mode.value === 'onboard' && m6.state.mode === 1, `Settings source passes its check with the same mode written back, never switched (${JSON.stringify(vf.keys.mode)})`);
  check(modeSent() === 1 && m6.sent.filter((s) => s.b[1] === 11 && (s.b[2] & 0xf0) === 0x10).every((s) => s.b[3] === 1), 'the only mode write is "onboard" (01), the mode it read');
  check(vf.keys.dpi?.waiting && vf.keys.dpi.ran === false && /onboard/.test(vf.keys.dpi.why) && vf.keys.reportRate?.waiting, `DPI and rate in onboard mode are waiting, not failed (${JSON.stringify(vf.keys.dpi)})`);
  check(!m6.sent.some((s) => s.b[1] === 7 && (s.b[2] & 0xf0) === 0x30), 'no DPI write was sent in onboard mode');
  check(vf.keys.profile?.ok && vf.keys.dpiStage?.ok && m6.state.profile === 1 && m6.state.slot === 1, 'profile and DPI stage write their own value back');
  let err = await refusal(() => driver.write('dpi', 1600));
  check(/waiting/.test(err?.message || ''), `a waiting setting stays read-only and says why (${err?.message})`);
  // the person switches to host mode themselves; the same day nothing runs again, a day later only the waiting ones do
  m6.state.mode = 2;
  const sentBefore = m6.sent.length;
  await driver.connect(false);
  check(!m6.sent.slice(sentBefore).some((s) => (s.b[2] & 0xf0) === 0x30 && s.b[1] === 7), 'the same day: not tried again');
  clock += 25 * 60 * 60 * 1000;
  await driver.connect(false);
  vf = readVerified(folder);
  check(vf.keys.dpi?.ok === true && vf.keys.reportRate?.ok === true && m6.state.mode === 2 && m6.state.dpi === 800, `a day later the waiting settings are checked and pass; the mode the person chose stays (${JSON.stringify(vf.keys.dpi)})`);
  check(vf.keys.mode?.ok === true && vf.keys.mode.value === 'onboard', 'settings that passed keep their result (not written again)');
  driver.vendorApp = async () => null;
  fs.rmSync(folder, { recursive: true, force: true });
}

// ---- 7. Bluetooth (22 Oct 2026, docs/handoff/logitech-ble.md) ----
// The shipped Bluetooth ids are libratbag's G603 / G604 / G705 (section 8 runs one); every USB channel is as before. The
// transport is proven with a TEST-ONLY id added to BLE here and removed again: device index 0xFF, replies with index
// 0x00 taken (Solaar base.py), no report rate, the same bytes and values as on the cable.
{
  const { hidSpecs, ownClash } = await import('../helpers/my-devices.mjs');
  const meta = JSON.parse((await import('node:fs')).readFileSync(new URL('../device-library/logitech-hidpp-mouse/device.json', import.meta.url), 'utf8'));
  const bleIds = Object.keys(BLE).map((p) => Number(p).toString(16));
  check(bleIds.join() === 'b01c,b024,b02e' && meta.pids.filter((p) => /^b/i.test(p)).join() === bleIds.join(), `the shipped Bluetooth ids are libratbag's G603 / G604 / G705, in device.json too (${bleIds})`);
  check(Object.keys(driver.hid.byPid).sort().join() === 'B01C,B024,B02E' && Object.values(driver.hid.byPid).every((c) => JSON.stringify(c) === JSON.stringify(BLE_HID)), 'only the Bluetooth ids get the Bluetooth collection');
  check(hidSpecs(driver).filter((s) => !/^B0/i.test(s.pid)).every((s) => s.page === 'FF00' && s.usage === '0002' && s.inputLen === undefined), 'every USB mouse channel is the long collection on FF00 / 0002, as before');
  check(ownClash('046d', meta.pids).length === 0 && ownClash('046d', hidSpecs(driver).map((s) => s.pid)).length === 0, 'no mouse id is one DeviceHub runs itself (pc-map RUNS)');
  check(BLE_HID.page === '*' && BLE_HID.usage === '*' && BLE_HID.inputLen === 19 && BLE_HID.outputLen === 19, `the Bluetooth collection: any page / usage, 19-byte reports (${JSON.stringify(BLE_HID)})`);
  check([0x1816, 0x0309, 0x1500].every((id) => NEVER.includes(id)), 'BLE pre-pairing 0x1816, Lightspeed pairing 0x0309 and force pairing 0x1500 are on the never list');
  for (const id of [0x1816, 0x0309, 0x1500]) { const r = await refusal(() => driver.call(id, 0x00)); check(/refused/.test(r?.message || ''), `call() refuses 0x${id.toString(16)}`); }
  // reply matching: Bluetooth takes 0x00 for 0xFF; the cable's matcher is unchanged (0x00 is not a reply to 0xFF there)
  const sent = [0xff, 5, 0x2b, 0];
  check(isReplyToBle(sent, [0x00, 5, 0x2b]) && isReplyToBle(sent, [0xff, 5, 0x2b]) && isReplyToBle(sent, [0x00, 0xff, 5, 0x2b, 2]), 'Bluetooth: replies and errors with index 0x00 or 0xFF match');
  check(!isReplyToBle(sent, [0x01, 5, 0x2b]) && !isReplyToBle(sent, [0x00, 6, 0x2b]), 'Bluetooth: another index or feature does not match');
  check(!isReplyTo(sent, [0x00, 5, 0x2b]) && isReplyTo(sent, [0xff, 5, 0x2b]), 'cable / receiver matching unchanged');

  const feats = { [F.BATTERY_STATUS]: 3, [F.ADJUSTABLE_DPI]: 5, [F.ONBOARD_PROFILES]: 8 };
  const run = async (m) => {
    useDevice(m);
    check(await driver.connect(false), `mouse ${m.productId.toString(16)} connects`);
    const n0 = m.sent.length;
    const vals = await driver.read();
    const w1 = await driver.write('dpi', 1600), w2 = await driver.write('dpi', 800);
    const bat = await driver.battery();
    return { vals, w: [w1, w2], bat, frames: m.sent.slice(n0).map((s) => h(s.b)), info: await driver.info() };
  };
  const cable = await run(simMouse({ pid: 0xc094, slot: 0xff, features: feats, dpiList: [100, 0xe000 | 50, 25600], battery: { percent: 64, status: 0 }, mode: 2 }));
  BLE[0xb0aa] = 'test mouse (simulation only)';
  try {
    const bt = simMouse({ pid: 0xb0aa, slot: 0xff, replyIndex: 0x00, features: { ...feats, [F.EXT_REPORT_RATE]: 9, [F.REPORT_RATE]: 10 }, dpiList: [100, 0xe000 | 50, 25600], rateExt: true, rateMask: 0x7f, battery: { percent: 64, status: 0 }, mode: 2 });
    const ble = await run(bt);
    check(driver.ble === true && driver.index === 0xff && h(bt.sent[0].b.slice(0, 6)) === 'ff 00 1b 00 00 5a', `Bluetooth: ping at index 0xFF (${h(bt.sent[0].b.slice(0, 6))})`);
    check(bt.sent.every((s) => s.reportId === 0x11 && s.b.length === 19 && s.b[0] === 0xff), 'Bluetooth: every request is a long report to index 0xFF (no receiver slots)');
    check(!frames(bt).some((b) => b[1] === 0 && (b[2] & 0xf0) === 0 && [0x8060, 0x8061].includes((b[3] << 8) | b[4])) && !driver.features[F.EXT_REPORT_RATE] && !driver.features[F.REPORT_RATE], 'Bluetooth: the report rate features are not looked up');
    check(!frames(bt).some((b) => b[1] === 0 && (b[2] & 0xf0) === 0 && NEVER.includes((b[3] << 8) | b[4])), 'Bluetooth: no never-list feature is looked up');
    check(JSON.stringify(ble.vals) === JSON.stringify(cable.vals) && ble.vals.reportRate === undefined && ble.vals.dpi === 800, `Bluetooth reads the same values as the cable (${JSON.stringify(ble.vals)} / ${JSON.stringify(cable.vals)})`);
    check(ble.frames.join('|') === cable.frames.join('|'), `Bluetooth sends the same bytes as the cable for the same reads and writes (${ble.frames.length} frames)`);
    check(ble.w.join() === '1600,800' && bt.state.dpi === 800 && JSON.stringify(ble.bat) === JSON.stringify(cable.bat), 'Bluetooth: DPI written, read back and put back; battery the same');
    check(ble.info.Connection === 'Bluetooth' && /test mouse/.test(ble.info.Model) && cable.info.Connection === 'USB cable', `info names the connection (${ble.info.Connection}, ${ble.info.Model})`);
    e = await refusal(() => driver.write('reportRate', 1000));
    check(/report rate/.test(e?.message || '') && bt.state.rateIndex === 3, `Bluetooth: a report-rate write is refused unsent (${e?.message})`);
  } finally { delete BLE[0xb0aa]; }
}

// ---- 8. models added from libratbag data/devices @ 8235b5bb (22 Oct 2026): one new model on each link ----
{
  const { hidSpecs, ownClash } = await import('../helpers/my-devices.mjs');
  const fsm = await import('node:fs');
  const meta = JSON.parse(fsm.readFileSync(new URL('../device-library/logitech-hidpp-mouse/device.json', import.meta.url), 'utf8'));
  const hx = (n) => Number(n).toString(16).padStart(4, '0');
  const all = [...RECEIVERS, ...Object.keys(WIRED), ...Object.keys(BLE)].map(hx);
  check(meta.pids.join() === all.join() && hidSpecs(driver).map((x) => x.pid.toLowerCase()).sort().join() === [...all].sort().join(), 'device.json pids = the channels = receivers + WIRED + BLE');
  check(ownClash('046d', all).length === 0 && ownClash('046d', Object.keys(WPIDS).map(hx)).length === 0, 'no new id is one DeviceHub runs itself (pc-map RUNS)');
  // the other library entries' ids (the keyboard and headset drivers share vendor 046d)
  const lib = new URL('../device-library/', import.meta.url);
  const others = fsm.readdirSync(lib).filter((d) => d !== 'logitech-hidpp-mouse' && fsm.existsSync(new URL(`${d}/device.json`, lib)))
    .map((d) => JSON.parse(fsm.readFileSync(new URL(`${d}/device.json`, lib), 'utf8'))).filter((m) => (m.vid || '').toLowerCase() === '046d').flatMap((m) => m.pids.map((p) => p.toLowerCase()));
  // 23 Oct 2026: the three LIGHTSPEED receivers SHARED_WITH_KEYBOARD are the keyboard driver's too (its SHARED); no other id is shared
  const { SHARED_WITH_KEYBOARD } = await import('../device-library/logitech-hidpp-mouse/device.mjs');
  const { SHARED: KB_SHARED } = await import('../device-library/logitech-hidpp-keyboard/device.mjs');
  const sharedHex = SHARED_WITH_KEYBOARD.map(hx);
  check(sharedHex.sort().join() === 'c539,c53f,c54d' && Object.keys(KB_SHARED).map(hx).sort().join() === sharedHex.join() && SHARED_WITH_KEYBOARD.every((p) => RECEIVERS.includes(p)), `the mouse and keyboard drivers name the same shared receivers (${sharedHex})`);
  check(others.length > 0 && all.filter((p) => others.includes(p)).sort().join() === sharedHex.join() && !Object.keys(WPIDS).map(hx).some((p) => others.includes(p)), `no other mouse id is claimed by another library entry (${all.filter((p) => others.includes(p))})`);
  check(Object.keys(WPIDS).every((p) => !all.includes(hx(p))), 'receiver wpids (40xx) are never opened as channels');
  check([0xc08b, 0xc332, 0xb024].every((p) => PROFILE_READ_1BASED.includes(p)), 'libratbag INDEX_OFFSET ids read their profile 1-based');

  // cable: a G203 (c09d): no battery, DPI range, 0x8060, onboard profiles read 0-based
  const g203 = simMouse({ pid: 0xc09d, slot: 0xff, features: { [F.ADJUSTABLE_DPI]: 4, [F.REPORT_RATE]: 5, [F.ONBOARD_PROFILES]: 6 },
    dpiList: [200, 0xe000 | 50, 8000], rateMask: 0x8b, battery: {}, mode: 2, profiles: { count: 1, oneBasedRead: false, profile: 1, slot: 2 } });
  useDevice(g203);
  check(await driver.connect(false) && driver.index === 0xff && !driver.ble, 'G203 on its cable connects at index 0xFF');
  const i1 = await driver.info();
  check(i1.Model === 'Logitech G102 / G103 / G203' && i1.Connection === 'USB cable', `G203 named from its id (${i1.Model}, ${i1.Connection})`);
  v = await driver.read();
  check(v.dpi === 800 && v.reportRate === 1000 && v.mode === 'host' && v.profile === 1 && v.dpiStage === 3 && (await driver.battery()) === null, `G203 read: ${JSON.stringify(v)}`);
  check((await driver.write('dpi', 1600)) === 1600 && has(g203, [0xff, 4, 0x3b, 0x00, 0x06, 0x40]) && (await driver.write('dpi', 800)) === 800, 'G203 DPI written, read back, put back with the cable bytes');

  // receiver: a G603 behind its Lightspeed receiver (c539, slot 1): 0x1000 battery, 0x8060
  const g603 = simMouse({ pid: 0xc539, slot: 1, features: { [F.BATTERY_STATUS]: 2, [F.ADJUSTABLE_DPI]: 3, [F.REPORT_RATE]: 4, [F.ONBOARD_PROFILES]: 5 },
    dpiList: [200, 0xe000 | 50, 12000], rateMask: 0x8b, battery: { percent: 40, status: 0 }, mode: 1, profiles: { count: 1, oneBasedRead: false, profile: 1, slot: 0 } });
  useDevice(g603);
  check(await driver.connect(false) && driver.receiver && driver.index === 1, 'G603 on its receiver connects at slot 1');
  v = await driver.read();
  const b603 = await driver.battery();
  check(v.dpi === 800 && v.reportRate === 1000 && v.mode === 'onboard' && b603?.percent === 40 && has(g603, [0x01, 2, 0x0b]), `G603 on receiver read: ${JSON.stringify(v)} ${JSON.stringify(b603)}`);

  // Bluetooth: a G604 on b024: replies with index 0x00, no report rate, profile read 1-based (libratbag INDEX_OFFSET)
  const g604 = simMouse({ pid: 0xb024, slot: 0xff, replyIndex: 0x00, features: { [F.BATTERY_STATUS]: 2, [F.ADJUSTABLE_DPI]: 3, [F.REPORT_RATE]: 4, [F.ONBOARD_PROFILES]: 5 },
    dpiList: [100, 0xe000 | 50, 16000], rateMask: 0x8b, battery: { percent: 90, status: 0 }, mode: 2, profiles: { count: 3, oneBasedRead: true, profile: 2, slot: 1 } });
  useDevice(g604);
  check(await driver.connect(false) && driver.ble && driver.index === 0xff && driver.profileReadBase === 1, 'G604 on Bluetooth connects at 0xFF, profile base 1 from its id');
  check(!frames(g604).some((b) => b[1] === 0 && (b[2] & 0xf0) === 0 && [0x8060, 0x8061].includes((b[3] << 8) | b[4])), 'G604 on Bluetooth: report rate not looked up');
  const i3 = await driver.info();
  check(i3.Model === 'Logitech G604' && i3.Connection === 'Bluetooth', `G604 named (${i3.Model}, ${i3.Connection})`);
  v = await driver.read();
  check(v.dpi === 800 && v.reportRate === undefined && v.profile === 2 && v.dpiStage === 2 && v.mode === 'host', `G604 read: ${JSON.stringify(v)}`);
  check((await driver.write('profile', 3)) === 3 && g604.state.profile === 3 && (await driver.write('profile', 2)) === 2, 'G604 profile 3 selected, read back 1-based, put back');
  e = await refusal(() => driver.write('reportRate', 500));
  check(/report rate/.test(e?.message || '') && g604.state.rateMs === 1, `G604 on Bluetooth: report rate refused unsent (${e?.message})`);
}

// ---- 9. receiver slots (22 Oct 2026, docs/handoff/logitech-c539.md; problem report Dsmjr2/DeviceHub-support#2): a C539
// whose slot 1 is a keyboard, is empty or asleep, with or without a mouse in slot 2. Only a slot with 0x2201 is run; a
// receiver with only a keyboard is stepped aside from (notMine, no error); nothing answering is the asleep state ----
{
  const { SLOT_OWNERS, KIND } = await import('../device-library/logitech-hidpp-mouse/device.mjs');
  const { stepAside, NOT_MINE_REST_MS } = await import('../helpers/my-devices.mjs');
  const { NOT_A_FAULT } = await import('../helpers/auto-report.mjs');
  const isAsleepCore = (m) => /asleep|out of range|no reply/i.test(m);   // public/core/devices.js isAsleep
  // a receiver: each slot's device is a simulated HID++ 2.0 device answering on its own index; a kid with asleep: true
  // answers nothing (as a sleeping mouse: the receiver's own error is a short report, not on this channel)
  const simReceiver = (pid, kids) => {
    const r = {
      opened: false, productId: pid, sent: [], closed: 0, kids,
      async open() { this.opened = true; },
      close() { this.closed++; this.opened = false; },
      addEventListener(t, fn) { for (const k of Object.values(kids)) k.addEventListener(t, fn); },
      removeEventListener(t, fn) { for (const k of Object.values(kids)) k.removeEventListener(t, fn); },
      async sendReport(id, data) { const b = Array.from(data); this.sent.push({ reportId: id, b }); const k = kids[b[0]]; if (k && !k.asleep) return k.sendReport(id, data); },
    };
    return r;
  };
  const keyboard = (pid, slot) => simMouse({ pid, slot, kind: 0, features: { [F.DEVICE_NAME]: 2, [F.UNIFIED_BATTERY]: 3 }, dpiList: [], rateMask: 0, battery: { percent: 90, charge: 0, external: 0 }, mode: 0 });
  const mouse = (pid, slot) => simMouse({ pid, slot, features: { [F.DEVICE_NAME]: 2, [F.ADJUSTABLE_DPI]: 4, [F.REPORT_RATE]: 5 }, dpiList: [400, 800, 1600], rateMask: 0x8b, battery: {}, mode: 0 });
  // only reads go to a slot that is not run: Root ping / getFeature, and DEVICE_NAME fn 0x20 (its kind)
  const onlyProbes = (rx, slot, nameIndex) => rx.sent.filter((s) => s.b[0] === slot).every((s) => (s.b[1] === 0 && [0x00, 0x10].includes(s.b[2] & 0xf0)) || (s.b[1] === nameIndex && (s.b[2] & 0xf0) === 0x20));
  check(KIND[0] === 'keyboard' && KIND[3] === 'mouse', 'HID++ 2.0 kinds as Solaar hidpp20_constants.py DEVICE_KIND');

  // a) keyboard in slot 1, mouse in slot 2: the mouse is run, the keyboard only asked what it is
  let rx = simReceiver(0xc539, { 1: keyboard(0xc539, 1), 2: mouse(0xc539, 2) });
  useDevice(rx);
  check(await driver.connect(false) && driver.index === 2 && !driver.asleep, `C539: keyboard in slot 1 skipped, mouse in slot 2 run (slot ${driver.index})`);
  check(onlyProbes(rx, 1, 2) && rx.sent.some((s) => s.b[0] === 1 && s.b[1] === 2 && (s.b[2] & 0xf0) === 0x20), 'slot 1 (the keyboard) got only ping, getFeature and its kind read (DEVICE_NAME fn 0x20)');
  check(SLOT_OWNERS.get('C539:2') === 'logitech-hidpp-mouse' && !SLOT_OWNERS.has('C539:1'), 'the mouse driver holds slot 2 only');
  check(/slot 2/.test((await driver.info()).Model) && (await driver.read()).dpi === 800 && driver.usbId === '046d:c539', 'reads the mouse in slot 2; usbId names the receiver');
  check(rx.closed === 0, 'the receiver stays open while its mouse is run');

  // b) keyboard alone: step aside (notMine), the receiver let go, nothing written; through stepAside(): not connected,
  // no error, and the next automatic connect rests
  rx = simReceiver(0xc539, { 1: keyboard(0xc539, 1) });
  useDevice(rx);
  e = await refusal(() => driver.connect(false));
  check(e?.notMine === true && e.gone === true && /keyboard/.test(e.message) && /not a mouse/.test(e.message) && /slot 1/.test(e.message), `a keyboard alone: steps aside (${e?.message})`);
  // C539 is shared with the keyboard driver (one HID handle for both): let go of, never closed
  check(rx.closed === 0 && driver.chan === null && driver.dev === null && !SLOT_OWNERS.has('C539:1'), 'a shared receiver is let go of without closing it (the keyboard driver may hold the same handle); no slot held');
  rx = simReceiver(0xc548, { 1: keyboard(0xc548, 1) });
  useDevice(rx);
  e = await refusal(() => driver.connect(false));
  check(e?.notMine === true && rx.closed === 1 && driver.chan === null, `a receiver the keyboard driver does not run (Bolt C548) is closed when stepped aside, as before (${e?.message})`);
  check(onlyProbes(rx, 1, 2), 'the keyboard got only reads');
  check(NOT_A_FAULT.test(e.message), `auto-report does not count "${e.message}" as a fault`);
  check(NOT_A_FAULT.test('this Logitech device has no DPI feature (0x2201): it is not a mouse this driver runs'), 'nor the old wording from the report');
  let clock = Date.parse('2026-10-22T12:00:00Z');
  const said = [];
  const w = stepAside(Object.create(driver), { now: () => clock, log: (t) => said.push(t) });
  rx = simReceiver(0xc539, { 1: keyboard(0xc539, 1) });
  useDevice(rx);
  check((await w.connect(false)) === false && /keyboard/.test(w.notMine?.why || '') && said.length === 1, `through stepAside: connect() is false (not connected, no error), why kept (${w.notMine?.why})`);
  const n0 = rx.sent.length;
  check((await w.connect(false)) === false && rx.sent.length === n0 && said.length === 1, 'the next automatic connect rests: nothing sent, nothing logged again');
  w.notMineRetry();
  check((await w.connect(false)) === false && rx.sent.length > n0, 'a device change (notMineRetry) looks again at once');
  clock += NOT_MINE_REST_MS + 1000;
  rx.kids[2] = mouse(0xc539, 2);
  check((await w.connect(false)) === true && w.notMine === null && w.index === 2, 'after the rest a mouse paired beside the keyboard is found, and the note is cleared');

  // c) slot 1 asleep, nothing else: the asleep state, not an error; it wakes with the mouse
  const sleepy = mouse(0xc539, 1); sleepy.asleep = true;
  rx = simReceiver(0xc539, { 1: sleepy });
  useDevice(rx);
  check((await driver.connect(false)) === true && driver.asleep === true && driver.index === null, 'nothing answering: connect() is true, asleep');
  check(rx.sent.length === 6 && rx.sent.every((s) => s.b[1] === 0 && (s.b[2] & 0xf0) === 0x10), `asleep: one ping per slot 1-6, nothing else (${rx.sent.length} sent)`);
  check(/not answering/.test((await driver.info()).Model) && (await driver.battery()) === null, 'asleep: info without the mouse, no battery');
  e = await refusal(() => driver.read());
  check(/asleep/.test(e?.message || '') && isAsleepCore(e.message) && NOT_A_FAULT.test(e.message) && !e.gone, `asleep: read says so (status asleep, no report) (${e?.message})`);
  e = await refusal(() => driver.write('dpi', 800));
  check(e?.waiting === true && /asleep/.test(e.message), 'asleep: a write waits, nothing sent');
  check((await driver.awake()) === false, 'awake() does not ask again within 30 s');
  sleepy.asleep = false; driver.wokeAt = 0;
  check((await driver.awake()) === true && driver.asleep === false && driver.index === 1 && (await driver.read()).dpi === 800, 'moved: awake() finds it in slot 1 and it reads');

  // d) an empty receiver (nothing paired) looks the same: asleep, never an error
  useDevice(simReceiver(0xc539, {}));
  check((await driver.connect(false)) === true && driver.asleep === true, 'an empty receiver: asleep, not an error');
  // asleep at connect, then a keyboard wakes instead: read() steps aside
  const kb2 = keyboard(0xc539, 1); kb2.asleep = true;
  rx = simReceiver(0xc539, { 1: kb2 });
  useDevice(rx);
  check((await driver.connect(false)) === true && driver.asleep, 'a sleeping keyboard: asleep at first');
  kb2.asleep = false; driver.wokeAt = 0;
  e = await refusal(() => driver.read());
  check(e?.notMine === true && rx.closed === 0 && driver.chan === null, `it wakes as a keyboard: read() steps aside, the shared receiver not closed (${e?.message})`);

  // e) one owner per slot: a slot another Logitech driver holds is never asked
  SLOT_OWNERS.set('C539:1', 'logitech-hidpp-keyboard');
  rx = simReceiver(0xc539, { 1: mouse(0xc539, 1), 2: mouse(0xc539, 2) });
  useDevice(rx);
  check(await driver.connect(false) && driver.index === 2 && !rx.sent.some((s) => s.b[0] === 1), 'slot 1 held by the keyboard driver: nothing sent to it, slot 2 run');
  SLOT_OWNERS.delete('C539:1');
  check(await driver.connect(false) && driver.index === 1 && SLOT_OWNERS.get('C539:1') === 'logitech-hidpp-mouse' && !SLOT_OWNERS.has('C539:2'), 'freed: the next connect takes slot 1 and lets slot 2 go');
  // 23 Oct 2026: only a slot the keyboard driver runs (the keyboard alone on a shared receiver): stepped aside, not a
  // sleeping mouse; nothing sent to that slot, the receiver not closed
  SLOT_OWNERS.clear();
  SLOT_OWNERS.set('C539:1', 'logitech-hidpp-keyboard');
  rx = simReceiver(0xc539, { 1: keyboard(0xc539, 1) });
  useDevice(rx);
  e = await refusal(() => driver.connect(false));
  check(e?.notMine === true && /run by logitech-hidpp-keyboard/.test(e.message) && !driver.asleep && rx.closed === 0 && !rx.sent.some((s) => s.b[0] === 1) && NOT_A_FAULT.test(e.message), `a receiver whose only device the keyboard driver runs: stepped aside, no asleep mouse (${e?.message})`);
  // asleep at connect (nothing answered), then the keyboard driver claims slot 1: the next wake look steps aside
  SLOT_OWNERS.clear();
  const kb3 = keyboard(0xc539, 1); kb3.asleep = true;
  rx = simReceiver(0xc539, { 1: kb3 });
  useDevice(rx);
  check((await driver.connect(false)) === true && driver.asleep, 'nothing answering: asleep at first');
  SLOT_OWNERS.set('C539:1', 'logitech-hidpp-keyboard'); driver.wokeAt = 0;
  e = await refusal(() => driver.read());
  check(e?.notMine === true && /run by logitech-hidpp-keyboard/.test(e.message) && rx.closed === 0, `the keyboard driver took slot 1: the asleep mouse driver steps aside (${e?.message})`);
  SLOT_OWNERS.clear();

  // f) a mouse with 0x2202 and no 0x2201 (22 Oct 2026, the PRO X2 SUPERSTRIKE's shape): run now, its DPI shown from
  // 0x2202 fn 0x50 and never written; a device with neither DPI feature is still stepped aside, plainly
  const onlyExt = simMouse({ pid: 0xc539, slot: 1, kind: 3, features: { [F.DEVICE_NAME]: 2, [F.EXT_ADJUSTABLE_DPI]: 3 }, dpiList: [], rateMask: 0, battery: {}, mode: 0, ext: { caps: 0x00 } });
  useDevice(simReceiver(0xc539, { 1: onlyExt }));
  check(await driver.connect(false) && driver.index === 1 && !driver.superstrike, 'a 0x2202-only mouse is run (slot 1)');
  check((await driver.read()).dpi === 800 && has(onlyExt, [0x01, 3, 0x5b, 0x00]) && driver.settings.find((s) => s.key === 'dpi').type === 'display', 'its DPI is read through 0x2202 fn 0x50 and shown only');
  e = await refusal(() => driver.write('dpi', 1600));
  check(/shown only|a reading/.test(e?.message || '') && !onlyExt.sent.some((s) => s.b[1] === 3 && (s.b[2] & 0xf0) === 0x60), `a 0x2202-only DPI write is refused unsent (${e?.message})`);
  const neither = simMouse({ pid: 0xc539, slot: 1, kind: 3, features: { [F.DEVICE_NAME]: 2, [F.UNIFIED_BATTERY]: 3 }, dpiList: [], rateMask: 0, battery: {}, mode: 0 });
  useDevice(simReceiver(0xc539, { 1: neither }));
  e = await refusal(() => driver.connect(false));
  check(e?.notMine && /a mouse without a DPI feature \(0x2201 or 0x2202\)/.test(e.message) && NOT_A_FAULT.test(e.message), `a mouse with no DPI feature at all: stepped aside, plainly (${e?.message})`);
  // g) Bolt with the keyboard in slot 1 and the mouse in slot 3
  rx = simReceiver(0xc548, { 1: keyboard(0xc548, 1), 3: mouse(0xc548, 3) });
  useDevice(rx);
  check(await driver.connect(false) && driver.index === 3 && /Bolt/.test((await driver.info()).Connection), 'Bolt: keyboard in 1, slot 2 empty, mouse in 3 run');
  SLOT_OWNERS.clear();
}

// ---- 10. PRO X2 SUPERSTRIKE (22 Oct 2026, docs/handoff/superstrike.md): on its receiver C54D and its cable C0A8, with the
// feature table K feature-table.txt @ 1b599dd0 lists (indexes as there; the driver looks them up anyway): no 0x2201, no
// 0x8060; HITS 0x1B0C with the caps K, X and S read (00 03 28 14 14 01); the records X and the G HUB capture show ----
{
  const { SUPERSTRIKE, HITS, hitsLevels } = await import('../device-library/logitech-hidpp-mouse/device.mjs');
  const fsm = await import('node:fs');
  const meta = JSON.parse(fsm.readFileSync(new URL('../device-library/logitech-hidpp-mouse/device.json', import.meta.url), 'utf8'));
  check(RECEIVERS.includes(0xc54d) && WIRED[0xc0a8] === 'PRO X2 SUPERSTRIKE' && WPIDS[0x40bd] === 'PRO X2 SUPERSTRIKE' && SUPERSTRIKE.cable === 0xc0a8, 'SUPERSTRIKE ids: receiver C54D, cable C0A8, WPID 40BD');
  check(meta.pids.includes('c54d') && meta.pids.includes('c0a8') && meta.models.includes('PRO X2 SUPERSTRIKE'), 'device.json names the SUPERSTRIKE and both its ids');
  check([0x1500, 0x1802, 0x1805, 0x1817, 0x9403, 0x1801, 0x1803, 0x1890, 0x1e00].every((id) => NEVER.includes(id)), 'its pairing, reset, OOB, manufacturing, RF test, hidden and flash-update(?) features are on the never list');
  const table = { [F.FEATURE_SET]: 1, 0x0003: 2, [F.DEVICE_NAME]: 3, 0x1d4b: 4, 0x0020: 5, [F.UNIFIED_BATTERY]: 6, 0x2250: 7, 0x2251: 8, [F.EXT_ADJUSTABLE_DPI]: 9, 0x8090: 0x0a, 0x80e0: 0x0b,
    [F.ANALOG_BUTTONS]: 0x0c, [F.EXT_REPORT_RATE]: 0x0d, [F.ONBOARD_PROFILES]: 0x0e, 0x8110: 0x0f, 0x1500: 0x10, 0x1801: 0x11, 0x1802: 0x12, 0x1803: 0x13, 0x1806: 0x14, 0x1817: 0x15, 0x1805: 0x16, 0x9403: 0x19, 0x1e00: 0x1d };
  const superstrike = (pid, slot, rateMask) => simMouse({ pid, slot, kind: 3, features: table, dpiList: [], rateExt: true, rateMask, battery: { percent: 29, charge: 0, external: 0 }, mode: 1,
    profiles: { count: 5, oneBasedRead: true, profile: 1, slot: 2 }, ext: { caps: 0x03, lod: 2, y: 800 },
    hits: { caps: [0x00, 0x03, 0x28, 0x14, 0x14, 0x01], recs: { 0: [0x0c, 0x09, 0x14], 1: [0x08, 0x08, 0x0c] } } });
  const ssBytes = (m) => JSON.stringify(m.hits?.recs);
  const run = async (m, idx, rx) => {
    const tag = idx === 0xff ? 'cable' : 'receiver';
    const frm = () => (rx || m).sent.map((s) => s.b);
    const hitsFrames = (fn) => frm().filter((b) => b[1] === 0x0c && (b[2] & 0xf0) === fn);
    check(await driver.connect(false) && driver.superstrike && driver.index === idx, `${tag}: the SUPERSTRIKE connects at index ${idx.toString(16)}`);
    check(!frm().some((b) => b[1] === 0 && (b[2] & 0xf0) === 0 && NEVER.includes((b[3] << 8) | b[4])), `${tag}: none of its never-list features is looked up, though the mouse has them`);
    check(frm().some((b) => h(b.slice(0, 5)) === `${idx.toString(16).padStart(2, '0')} 00 0b 1b 0c`) && hitsFrames(0x00).length === 1, `${tag}: getFeature 0x1B0C and HITS caps fn 0x00`);
    check(frm().every((b) => b[1] !== 0x0c || [0x00, 0x10, 0x20].includes(b[2] & 0xf0)), `${tag}: only HITS fn 0x00 / 0x10 / 0x20 are ever sent`);
    const keys = driver.settings.map((s) => s.key);
    check(Object.keys(HITS).every((k) => keys.includes(k)), `${tag}: the six HITS settings are listed (${keys})`);
    const rng = (k) => { const s = driver.settings.find((x) => x.key === k); return `${s.type} ${s.min}-${s.max}/${s.step}`; };
    check(rng('actuationLeft') === 'slider 1-10/1' && rng('rapidTriggerRight') === 'slider 1-5/1' && rng('hapticsLeft') === 'slider 0-5/1', `${tag}: ranges from its caps: ${rng('actuationLeft')}, ${rng('rapidTriggerRight')}, ${rng('hapticsLeft')}`);
    check(['dpi', 'reportRate', 'profile'].every((k) => driver.settings.find((x) => x.key === k).type === 'display'), `${tag}: DPI, report rate and profile are shown only`);
    let v = await driver.read();
    check(v.actuationLeft === 3 && v.rapidTriggerLeft === 2 && v.hapticsLeft === 5 && v.actuationRight === 2 && v.rapidTriggerRight === 2 && v.hapticsRight === 3, `${tag}: HITS read (${JSON.stringify(v)})`);
    check(v.dpi === 800 && v.profile === 1 && v.dpiStage === 3 && v.mode === 'onboard' && v.liftOff === undefined, `${tag}: DPI 800 from 0x2202 fn 0x50, profile 1 (sector 1), stage 3, onboard, no lift-off (${JSON.stringify(v)})`);
    check(v.reportRate === 1000 && driver.caps.rate.hz.join() === (idx === 0xff ? '125,250,500,1000' : '125,250,500,1000,2000,4000,8000'), `${tag}: rate 1000 Hz, listed ${driver.caps.rate.hz}`);
    check(frm().some((b) => h(b.slice(0, 4)) === `${idx.toString(16).padStart(2, '0')} 0c 2b 00`) && frm().some((b) => h(b.slice(0, 4)) === `${idx.toString(16).padStart(2, '0')} 0c 2b 01`), `${tag}: HITS read = 0x1B0C fn 0x20 [00] and [01]`);
    const start = ssBytes(m);
    // a changed value: only its byte moves; the rapid-trigger flag (bit 0 of 09) is kept
    let n = frm().length;
    check((await driver.write('hapticsLeft', 2)) === 2, `${tag}: left haptics 2 written and read back`);
    check(hitsFrames(0x10).slice(-1).map((b) => h(b.slice(0, 7)))[0] === `${idx.toString(16).padStart(2, '0')} 0c 1b 00 0c 09 08`, `${tag}: left haptics 2 = 0C 1B 00 0C 09 08 (act and rt as read)`);
    check((await driver.write('rapidTriggerLeft', 4)) === 4 && h(m.hits.recs[0]) === '0c 11 08', `${tag}: rapid trigger 4 with its flag kept = 0x11 (${h(m.hits.recs[0])})`);
    check((await driver.write('actuationRight', 10)) === 10 && h(m.hits.recs[1]) === '28 08 0c', `${tag}: right actuation 10 = 0x28`);
    // exact restore: the values read at the start go back and the raw bytes are what they were
    for (const [k, val] of [['hapticsLeft', 5], ['rapidTriggerLeft', 2], ['actuationRight', 2]]) await driver.write(k, val);
    check(ssBytes(m) === start, `${tag}: restored to the exact raw records (${ssBytes(m)} vs ${start})`);
    // an unchanged write is sent, with exactly the raw bytes read
    n = hitsFrames(0x10).length;
    check((await driver.write('hapticsLeft', 5)) === 5 && hitsFrames(0x10).length === n + 1 && h(hitsFrames(0x10).slice(-1)[0].slice(3, 7)) === '00 0c 09 14', `${tag}: the same value is still sent, as the raw record 00 0C 09 14`);
    // out of range or not a whole number: refused, nothing sent
    n = hitsFrames(0x10).length;
    for (const [k, val] of [['actuationLeft', 0], ['actuationLeft', 11], ['rapidTriggerRight', 0], ['rapidTriggerRight', 6], ['hapticsRight', 6], ['hapticsRight', -1], ['hapticsLeft', 2.5], ['actuationLeft', '3']]) {
      e = await refusal(() => driver.write(k, val));
      check(/whole number/.test(e?.message || ''), `${tag}: ${k} = ${JSON.stringify(val)} refused (${e?.message})`);
    }
    check(hitsFrames(0x10).length === n && ssBytes(m) === start, `${tag}: nothing sent for the refused values`);
    // shown-only settings are refused before anything is sent
    const before = frm().length;
    for (const [k, val] of [['dpi', 1600], ['reportRate', 8000], ['profile', 2], ['liftOff', 'high']]) {
      e = await refusal(() => driver.write(k, val));
      check(/shown only|a reading|read-only/.test(e?.message || ''), `${tag}: ${k} write refused (${e?.message})`);
    }
    check(frm().length === before, `${tag}: no DPI, rate, profile or lift-off write was sent`);
    // what still writes as on other mice: DPI stage (0x8100 fn 0xC0) and the settings source
    check((await driver.write('dpiStage', 4)) === 4 && m.state.slot === 3 && (await driver.write('dpiStage', 3)) === 3 && m.state.slot === 2, `${tag}: DPI stage written, read back, put back`);
    // a write the mouse acknowledges but does not keep: the byte-for-byte read-back reports it as failed
    m.hits.ignoreWrites = true;
    e = await refusal(() => driver.write('hapticsLeft', 1));
    check(/reads back/.test(e?.message || '') && ssBytes(m) === start, `${tag}: an acknowledged write that did not change the mouse is reported as failed (${e?.message})`);
    m.hits.ignoreWrites = false;
    // G HUB running: refused, nothing sent
    driver.vendorApp = async () => 'lghub_agent.exe';
    n = frm().length;
    e = await refusal(() => driver.write('hapticsRight', 3));
    check(/G HUB/.test(e?.message || '') && frm().length === n, `${tag}: HITS write refused while G HUB runs, nothing sent (${e?.message})`);
    driver.vendorApp = async () => null;
    // a byte off the documented grid reads as unknown, so it is never written back
    m.hits.recs[1] = [0x09, 0x0a, 0x0e];
    v = await driver.read();
    check(v.actuationRight === undefined && v.rapidTriggerRight === undefined && v.hapticsRight === undefined && v.actuationLeft === 3, `${tag}: reserved low bits set: the right button reads as unknown (${JSON.stringify(v)})`);
    m.hits.recs[1] = [0x08, 0x08, 0x0c];
    const info = await driver.info();
    check(/SUPERSTRIKE/.test(info.Model) && /actuation 1-10, rapid trigger 1-5, haptics 0-5/.test(info['HITS buttons']) && /DPI/.test(info['Shown only']), `${tag}: info (${JSON.stringify(info)})`);
    const raw = await driver.rawBackup();
    check(raw.hits?.join('|') === '00 0c 09 14|01 08 08 0c', `${tag}: rawBackup holds the raw HITS records (${raw.hits})`);
    check(ssBytes(m) === start && m.state.mode === 1 && m.state.dpi === 800 && m.state.rateIndex === 3 && m.state.profile === 1, `${tag}: the mouse ends exactly as it started`);
  };
  // receiver C54D, slot 1 (K: "device index 1"); slot 2 empty
  const ssRx = superstrike(0xc54d, 1, 0x7f);
  const rxS = { opened: false, productId: 0xc54d, sent: [], async open() { this.opened = true; }, close() {}, addEventListener: (t, f) => ssRx.addEventListener(t, f), removeEventListener: (t, f) => ssRx.removeEventListener(t, f),
    async sendReport(id, data) { this.sent.push({ reportId: id, b: Array.from(data) }); if (data[0] === 1) return ssRx.sendReport(id, data); } };
  useDevice(rxS);
  await run(ssRx, 1, rxS);
  check(/receiver C54D \(slot 1\)/.test((await driver.info()).Model), 'the receiver model line names C54D and the slot');
  // cable C0A8: index 0xFF, the cable lists 125-1000 Hz (X: "The cable supports a maximum of 1000 Hz"; fn 0x10 mask 0x000f)
  const ssCable = superstrike(0xc0a8, 0xff, 0x0f);
  useDevice(ssCable);
  await run(ssCable, 0xff);
  check((await driver.info()).Model === 'Logitech PRO X2 SUPERSTRIKE' && (await driver.info()).Connection === 'USB cable', 'the cable is named from its id');
  check(hitsLevels([0, 0x0c, 0x09, 0x14], 0, { act: 10, rt: 5, hap: 5 }).act === 3 && hitsLevels([1, 0x0c, 0x09, 0x14], 0, { act: 10, rt: 5, hap: 5 }).act === undefined, 'a record for another button is not read as this one');

  // the library self-check after Turn on settings: each HITS value written back as the exact raw record read; DPI, rate
  // and profile (shown only) are never written; the mouse ends byte for byte as it started
  {
    const fs = fsm, os = await import('node:os'), path = await import('node:path');
    const { guard, readVerified } = await import('../helpers/my-devices.mjs');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-logi-ss-'));
    const m = superstrike(0xc0a8, 0xff, 0x0f);
    // a fresh, unguarded copy of the driver module (the one above is already guarded by section 6)
    const fresh = await import('../device-library/logitech-hidpp-mouse/device.mjs?superstrike-selfcheck');
    const d2 = fresh.default;
    d2.vendorApp = async () => null; d2.pingMs = 150;
    fresh.useDevice(m);
    // the driver's own refusal, before DeviceHub's guard is laid over it
    check(await d2.connect(false) && d2.superstrike, 'fresh driver copy: SUPERSTRIKE connects');
    for (const [k, val] of [['dpi', 1600], ['reportRate', 8000], ['profile', 2], ['liftOff', 'high']]) {
      const r = await refusal(() => d2.write(k, val));
      check(/shown only on this mouse/.test(r?.message || ''), `the driver itself refuses ${k} (${r?.message})`);
    }
    check(!m.sent.some((s) => (s.b[1] === 0x09 && (s.b[2] & 0xf0) === 0x60) || (s.b[1] === 0x0d && (s.b[2] & 0xf0) === 0x30) || (s.b[1] === 0x0e && (s.b[2] & 0xf0) === 0x30)), 'nothing was sent for them');
    m.sent.length = 0;
    const backups = [], logs = [];
    guard(d2, folder, { status: 'read-only', source: 'device-library/logitech-hidpp-mouse' }, { backup: async (b) => backups.push(b), log: (t) => logs.push(t), now: () => new Date('2026-10-22T18:00:00Z'), version: 'v1' });
    check(await d2.connect(false), 'guarded SUPERSTRIKE connects');
    const writes = () => m.sent.filter((s) => (s.b[1] === 0x0c && (s.b[2] & 0xf0) === 0x10) || (s.b[1] === 0x0e && [0x10, 0x30, 0xc0].includes(s.b[2] & 0xf0)) || (s.b[1] === 0x09 && (s.b[2] & 0xf0) === 0x60) || (s.b[1] === 0x0d && (s.b[2] & 0xf0) === 0x30));
    check(writes().length === 0 && d2.library.turnOn, 'before Turn on settings nothing is written');
    const start = ssBytes(m);
    const on = await d2.turnOn();
    const vf = readVerified(folder);
    check(on.on && Object.keys(HITS).every((k) => vf.keys[k]?.ok === true), `after Turn on settings every HITS setting passes (${JSON.stringify(Object.fromEntries(Object.keys(HITS).map((k) => [k, vf.keys[k]])))})`);
    const hw = m.sent.filter((s) => s.b[1] === 0x0c && (s.b[2] & 0xf0) === 0x10).map((s) => h(s.b.slice(3, 7)));
    check(hw.length === 6 && hw.filter((x) => x === '00 0c 09 14').length === 3 && hw.filter((x) => x === '01 08 08 0c').length === 3, `the self-check sent each record exactly as read (${hw.join(' | ')})`);
    check(ssBytes(m) === start && backups.length === 1, 'the self-check left the raw records as they were, after one backup');
    check(!m.sent.some((s) => (s.b[1] === 0x09 && (s.b[2] & 0xf0) === 0x60) || (s.b[1] === 0x0d && (s.b[2] & 0xf0) === 0x30) || (s.b[1] === 0x0e && (s.b[2] & 0xf0) === 0x30)), 'no DPI, rate or profile write was sent by the self-check');
    check(vf.keys.dpi === undefined && vf.keys.reportRate === undefined && vf.keys.profile === undefined && vf.keys.dpiStage?.ok && vf.keys.mode?.ok && m.state.mode === 1, 'shown-only settings are not checked; DPI stage and mode pass with their own value');
    fs.rmSync(folder, { recursive: true, force: true });
  }
  // the next mouse is not a SUPERSTRIKE: everything back as before (DPI slider, rate choice, no HITS settings)
  const after = simMouse({ pid: 0xc094, slot: 0xff, features: { [F.ADJUSTABLE_DPI]: 5, [F.REPORT_RATE]: 6 }, dpiList: [100, 0xe000 | 50, 25600], rateMask: 0x8b, battery: {}, mode: 0 });
  useDevice(after);
  check(await driver.connect(false) && !driver.superstrike, 'another mouse after it connects');
  const dS = driver.settings.find((s) => s.key === 'dpi'), rS = driver.settings.find((s) => s.key === 'reportRate');
  check(dS.type === 'slider' && dS.min === 100 && dS.max === 25600 && rS.type === 'choice' && driver.settings.find((s) => s.key === 'profile').type === 'choice' && !driver.settings.some((s) => HITS[s.key]), `the next mouse gets its own settings back (${dS.type}, ${rS.type}, ${driver.settings.map((s) => s.key)})`);
  check((await driver.write('dpi', 1600)) === 1600 && (await driver.write('dpi', 800)) === 800, 'and its DPI writes as before');
}

console.log(fails.length ? `sim-logitech: FAILED: ${fails.join('; ')}` : 'sim-logitech (Logitech HID++ mouse driver, simulated): all good');
process.exit(fails.length ? 1 : 0);
