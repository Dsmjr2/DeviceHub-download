// The Logitech HID++ 2.0 mouse driver (device-library/logitech-hidpp-mouse) against simulated mice that answer exactly as
// docs/brands/logitech.md documents: IRoot getFeature/ping, IFeatureSet, battery (0x1004 / 0x1000), DPI (0x2201),
// report rate (0x8061 / 0x8060), onboard/host mode (0x8100 fn 0x10/0x20), HID++ 2.0 error replies and events; and since
// 22 Oct 2026 lift-off (0x2202 caps 0x10 / read 0x50 / write 0x60, Solaar), onboard profile info / select (0x8100 fn 0x00,
// 0x30 / 0x40) and DPI slot (0xB0 / 0xC0, libratbag), the profile numbering quirk, and the G HUB refusal.
// Checks the driver's request bytes against the sheet byte for byte, and read / write / read-back.
// Run: node tests/sim-logitech.mjs (no hardware)
import driver, { useDevice, F, NEVER, HidppError } from '../device-library/logitech-hidpp-mouse/device.mjs';
driver.vendorApp = async () => null;   // no tasklist in the test; section 5 swaps in G HUB

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// A simulated mouse. features: { featureId: index }; state holds what the mouse would hold.
// profiles: { count, oneBasedRead, profile (1-based), slot (0-4) }; ext: { caps (0x2202 b2), lod, y }
function simMouse({ pid, slot, features, dpiList, rateExt, rateMask, battery, mode, profiles, ext }) {
  const state = { dpi: 800, defaultDpi: 800, rateIndex: 3, rateMs: 1, mode, ...battery, ...(profiles || {}), lod: ext?.lod ?? 0, y: ext?.y ?? 0 };
  const byIndex = Object.fromEntries(Object.entries(features).map(([id, i]) => [i, Number(id)]));
  const sent = [];
  const listeners = new Set();
  const dev = {
    opened: false, productId: pid, sent, state, failNext: null, eventFirst: false,
    async open() { this.opened = true; },
    addEventListener(t, fn) { if (t === 'inputreport') listeners.add(fn); },
    removeEventListener(t, fn) { listeners.delete(fn); },
    async sendReport(reportId, data) {
      const b = Array.from(data);
      sent.push({ reportId, b });
      if (reportId !== 0x11 || b.length !== 19) return;                  // only long reports are answered
      const [d, idx, fs] = b, p = b.slice(3);
      if (d !== slot) return;                                             // empty slot: no HID++ 2.0 answer
      const reply = (params) => [d, idx, fs, ...params, ...Array(16).fill(0)].slice(0, 19);
      const err = (code) => [d, 0xff, idx, fs, code, ...Array(14).fill(0)];
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
  check(!fs.existsSync(path.join(folder, 'verified.json')) && backups.length === 0 && modeSent() === 0 && logs.some((t) => /not run: lghub_agent\.exe .*open/.test(t)), `G HUB open: the self-check writes nothing and says so (${logs.join(' | ')})`);
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

console.log(fails.length ? `sim-logitech: FAILED: ${fails.join('; ')}` : 'sim-logitech (Logitech HID++ mouse driver, simulated): all good');
process.exit(fails.length ? 1 : 0);
