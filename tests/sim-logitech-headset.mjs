// The Logitech headset library driver (device-library/logitech-hidpp-headset) against simulated headsets only: nothing is
// opened, nothing reaches hardware. The simulated headsets answer as the cited sources describe: a HID++ 2.0 headset
// (Solaar Sidetone 0x8300, ADCPower 0x1F20, Equalizer 0x8310, HeadsetMicMute 0x0601; HeadsetControl hidpp_protocol.hpp
// framing), a G535 (HeadsetControl logitech_g535.hpp: interface 3, auto-off 0/1/2/5/10/15/30), and a PRO X 2 LIGHTSPEED
// speaking Centurion through its bridge (HeadsetControl logitech_centurion_protocol.hpp; Solaar HeadsetSidetone v2 and
// HeadsetAutoSleep v3). Expected request bytes are typed out by hand.
// Covers every setting: write, read back, put back, out-of-range refused, refused while G HUB runs, the never list.
// Run: node tests/sim-logitech-headset.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogitechHeadset, F, NEVER, PIDS, CENTURION, C_FRAMES, adcPercent } from '../device-library/logitech-hidpp-headset/device.mjs';
import { problem, fits } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
process.on('uncaughtException', (e) => { console.log(`sim-logitech-headset: FAILED: ${e.message}`); process.exit(1); });
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const emitter = () => {
  const ls = new Set();
  return {
    addEventListener(t, fn) { if (t === 'inputreport') ls.add(fn); },
    removeEventListener(t, fn) { ls.delete(fn); },
    emit(reportId, bytes) { setTimeout(() => { for (const fn of [...ls]) fn({ reportId, data: new DataView(Uint8Array.from(bytes).buffer) }); }, 1); },
  };
};

// ---- a simulated HID++ 2.0 headset ----
// features: { id: [index, version] }; state: what the headset holds
function simHidpp({ features, state }) {
  const byIndex = Object.fromEntries(Object.entries(features).map(([id, [i]]) => [i, Number(id)]));
  const ev = emitter();
  const dev = {
    ...ev, opened: false, sent: [], bad: [], state, failNext: null, eventFirst: false, silentOnce: false,
    async open() { this.opened = true; },
    async sendReport(rid, data) {
      const b = Array.from(data);
      this.sent.push(b);
      if (rid !== 0x11 || b.length !== 19) { this.bad.push(`report ${rid} of ${b.length} bytes`); return; }
      if (b[0] !== 0xff) this.bad.push(`device index ${b[0]}, not FF`);
      if ((b[2] & 0x0f) !== 0x0a) this.bad.push(`software id ${b[2] & 0x0f}, not 0x0A`);
      if (this.silentOnce) { this.silentOnce = false; return; }
      const [, idx, fs] = b, p = b.slice(3), fn = fs & 0xf0, id = idx === 0 ? 0 : byIndex[idx];
      const reply = (out) => ev.emit(0x11, [0xff, idx, fs, ...out, ...Array(16).fill(0)].slice(0, 19));
      const err = (code) => ev.emit(0x11, [0xff, 0xff, idx, fs, code, ...Array(14).fill(0)]);
      if (this.eventFirst) { this.eventFirst = false; ev.emit(0x11, [0xff, features[F.ADC]?.[0] ?? 1, 0x00, 0x0f, 0x50, 0x01, ...Array(13).fill(0)]); }   // an event, software id 0
      if (this.failNext) { const c = this.failNext; this.failNext = null; return err(c); }
      if (id === 0 && fn === 0x00) { const f = features[(p[0] << 8) | p[1]]; return reply(f ? [f[0], 0, f[1]] : [0, 0, 0]); }
      if (id === 0 && fn === 0x10) return reply([4, 2, p[2]]);
      if (id === F.SIDETONE && fn === 0x00) return reply([state.sidetone]);
      if (id === F.SIDETONE && fn === 0x10) { if (p[0] > 100) return err(0x02); state.sidetone = p[0]; return reply([]); }
      if (id === F.ADC && fn === 0x00) return reply([state.mV >> 8, state.mV & 0xff, state.adcFlags]);
      if (id === F.ADC && fn === 0x10) return reply([state.autoOff]);
      if (id === F.ADC && fn === 0x20) { if (state.autoOffAllowed && !state.autoOffAllowed.includes(p[0])) return err(0x02); state.autoOff = p[0]; return reply([]); }
      if (id === F.MIC_MUTE && fn === 0x10) return reply([state.muted]);
      if (id === F.EQUALIZER && fn === 0x00) return reply([state.eq.length, 6, 0, 0, 0]);                     // count 5, +-6 dB
      if (id === F.EQUALIZER && fn === 0x10) { const fr = state.freqs.slice(p[0], p[0] + 7); return reply([p[0], ...fr.flatMap((f) => [f >> 8, f & 0xff])]); }
      if (id === F.EQUALIZER && fn === 0x20) { if (p[0] !== 0) return err(0x02); return reply(state.eq.map((g) => g & 0xff)); }
      if (id === F.EQUALIZER && fn === 0x30) {
        if (p[0] !== 0x02) return err(0x02);
        const g = p.slice(1, 1 + state.eq.length).map((x) => (x > 127 ? x - 256 : x));
        if (g.some((x) => x < -6 || x > 6)) return err(0x03);
        state.eq = g; return reply([]);
      }
      return err(0x07);
    },
  };
  return dev;
}

// ---- a simulated PRO X 2 LIGHTSPEED: a dongle with Root and the bridge, the headset behind it ----
function simCenturion({ state, subFeatures, bridge = 5, steps = 21 }) {
  const ev = emitter();
  const subByIndex = Object.fromEntries(Object.entries(subFeatures).map(([id, [i]]) => [i, Number(id)]));
  const frame = (payload) => { const d = new Array(63).fill(0); d[0] = payload.length + 1; d[1] = 0; payload.forEach((x, i) => { d[2 + i] = x; }); return d; };
  const dev = {
    ...ev, opened: false, sent: [], subs: [], bad: [], state, off: false, connectEventFirst: false,
    async open() { this.opened = true; },
    async sendReport(rid, data) {
      const b = Array.from(data);
      this.sent.push(b);
      if (rid !== 0x51 || b.length !== 63) { this.bad.push(`report ${rid} of ${b.length} bytes`); return; }
      const len = b[0], payload = b.slice(2, 1 + len);
      if (b[1] !== 0) this.bad.push('flags not 0');
      if (b.slice(1 + len).some((x) => x !== 0)) this.bad.push('frame not zero padded after its length');
      if ((payload[1] & 0x0f) !== 0x01) this.bad.push(`software id ${payload[1] & 0x0f}, not 1`);
      if (payload[0] === 0x00) {                                               // dongle Root.getFeature
        const want = (payload[2] << 8) | payload[3];
        return ev.emit(0x51, frame([0x00, payload[1], ...(want === 0x0003 ? [bridge, 0, 1] : [0, 0, 0])]));
      }
      if (payload[0] !== bridge || payload[1] !== 0x11) { this.bad.push(`direct request ${h(payload.slice(0, 4))}`); return; }
      const size = ((payload[2] & 0x0f) << 8) | payload[3], msg = payload.slice(4, 4 + size);
      if (msg.length !== size || msg[0] !== 0x00) this.bad.push(`bridge message ${h(msg)}`);
      const [, sub, fs] = msg, p = msg.slice(3), fn = fs & 0xf0, id = sub === 0 ? 0 : subByIndex[sub];
      this.subs.push({ id, fn, p });
      if (this.off) return ev.emit(0x51, frame([0xff, bridge, 0x11, 0x09]));           // refused before the ack
      ev.emit(0x51, frame([bridge, 0x11, 0x00, 0x00]));                                 // the bridge's ack
      if (this.connectEventFirst) { this.connectEventFirst = false; ev.emit(0x51, frame([bridge, 0x00, 0x00, 0x01])); }
      const answer = (out) => ev.emit(0x51, frame([bridge, 0x10, 0x00, out.length + 3, 0x00, sub, fs, ...out]));
      const err = (code) => ev.emit(0x51, frame([bridge, 0x10, 0x00, 0x04, 0x00, 0xff, sub, fs, code]));
      if (id === 0 && fn === 0x00) { const f = subFeatures[(p[0] << 8) | p[1]]; return answer(f ? [f[0], 0, f[1]] : [0, 0, 0]); }
      if (id === F.C_BATTERY && fn === 0x00) return answer([state.percent, 0, state.charge]);
      if (id === F.C_SIDETONE && fn === 0x00) return answer([1, 1, 0, state.sidetone]);            // v2: [count, mic id, reserved, level]
      if (id === F.C_SIDETONE && fn === 0x20) return answer([0, 0, steps]);
      if (id === F.C_SIDETONE && fn === 0x10) { if (p[0] !== 1 || p[1] !== 0xff || p[2] >= steps) return err(0x02); state.sidetone = p[2]; return answer([]); }
      if (id === F.C_AUTO_SLEEP && fn === 0x00) return answer([state.sleepReserved, state.sleep]);  // v3: [reserved, timer]
      if (id === F.C_AUTO_SLEEP && fn === 0x10) { if (p[0] !== state.sleepReserved) return err(0x02); state.sleep = p[1]; return answer([]); }
      if (id === F.MIC_MUTE && fn === 0x10) return answer([state.muted]);
      return err(0x07);
    },
  };
  return dev;
}

const make = (pid, dev, app = { name: null }) => createLogitechHeadset({ open: async (p) => (p === pid ? dev : null), vendorApp: async () => app.name, timeoutMs: 80 });
const NEVER_IDS = NEVER;
const lookedUp = (dev) => dev.sent.filter((b) => b[1] === 0 && (b[2] & 0xf0) === 0x00).map((b) => (b[3] << 8) | b[4]);

// ---- the library self-check (helpers/my-devices.mjs selfCheck): every writable setting written with its own value and
// read back, a backup first, nothing moved ----
async function selfChecked(d, state, { waiting = [] } = {}) {
  const os = await import('node:os');
  const { selfCheck } = await import('../helpers/my-devices.mjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-selfcheck-'));
  const before = JSON.stringify(state);
  const backups = [];
  const r = await selfCheck(d, d.write, { folder, mark: { status: 'untested', source: 'device-library' }, backup: async (b) => backups.push(b), version: 'test' });
  fs.rmSync(folder, { recursive: true, force: true });
  const writable = d.settings.filter((s) => s.type !== 'display');
  check(backups.length === 1, 'the self-check took a backup first');
  check(writable.length > 0 && writable.every((s) => (waiting.includes(s.key) ? r.keys?.[s.key]?.waiting === true : r.keys?.[s.key]?.ok === true)), `the self-check passes every setting (waiting: ${waiting.join(', ') || 'none'}) (${JSON.stringify(r.keys || r)})`);
  check(!d.settings.filter((s) => s.type === 'display').some((s) => r.keys?.[s.key]), 'readings are not self-checked');
  check(JSON.stringify(state) === before, 'the self-check left the device as it was');
}

// ---- 1. a G733: HID++ 2.0 with sidetone, ADC v2, EQ and mic mute ----
{
  const g733 = simHidpp({ features: { [F.ADC]: [4, 2], [F.SIDETONE]: [7, 0], [F.EQUALIZER]: [9, 0], [F.MIC_MUTE]: [10, 0] },
    state: { sidetone: 40, autoOff: 30, mV: 3922, adcFlags: 0x03, muted: 0, eq: [0, 2, -1, 0, 3], freqs: [80, 240, 750, 2200, 6600] } });
  const app = { name: null };
  const d = make('0AB5', g733, app);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  check(await d.connect(), 'G733 connects');
  check(problem(d) === null, `connected, it still has the my-devices shape (${problem(d)})`);
  check(h(g733.sent[0].slice(0, 6)) === 'ff 00 1a 00 00 5a', `ping = FF 00 1A 00 00 5A (${h(g733.sent[0].slice(0, 6))})`);
  check(g733.sent.some((b) => h(b.slice(0, 5)) === 'ff 00 0a 83 00') && g733.sent.some((b) => h(b.slice(0, 5)) === 'ff 00 0a 1f 20'), 'getFeature 0x8300 = FF 00 0A 83 00, 0x1F20 = FF 00 0A 1F 20');
  check(!lookedUp(g733).some((id) => NEVER_IDS.includes(id)), 'no DFU / reset / pairing feature is ever looked up');
  const keys = d.settings.map((s) => s.key).join();
  check(keys === 'sidetone,autoOff,micMuted,eq1,eq2,eq3,eq4,eq5', `settings from what the headset has (${keys})`);
  check(d.settings.find((s) => s.key === 'eq3').label === 'EQ 750 Hz' && d.settings.find((s) => s.key === 'eq4').label === 'EQ 2.2 kHz', 'EQ bands named from the headset\'s own frequencies');
  check(d.settings.find((s) => s.key === 'eq1').min === -6 && d.settings.find((s) => s.key === 'eq1').max === 6, 'EQ range from the caps read (dbMin 0 = -dbRange)');
  let v = await d.read();
  check(v.sidetone === 40 && v.autoOff === 30 && v.micMuted === false && v.eq2 === 2 && v.eq3 === -1, `read: ${JSON.stringify(v)}`);
  check(g733.sent.some((b) => h(b.slice(0, 3)) === 'ff 07 0a') && g733.sent.some((b) => h(b.slice(0, 3)) === 'ff 04 1a') && g733.sent.some((b) => h(b.slice(0, 4)) === 'ff 09 2a 00'), 'reads: sidetone 07 0A, auto-off 04 1A, EQ 09 2A 00');
  // sidetone: write, read back, refuse 101, put back
  let n = g733.sent.length;
  check((await d.write('sidetone', 75)) === 75 && g733.state.sidetone === 75, 'sidetone 75 written and read back');
  check(g733.sent.slice(n).some((b) => h(b.slice(0, 4)) === 'ff 07 1a 4b'), 'sidetone 75 = FF 07 1A 4B (HeadsetControl 07 1A level)');
  let e = await refusal(() => d.write('sidetone', 101));
  check(/0-100/.test(e?.message || '') && g733.state.sidetone === 75, `sidetone 101 refused before sending (${e?.message})`);
  check((await d.write('sidetone', 40)) === 40 && g733.state.sidetone === 40, 'sidetone put back to 40');
  // auto-off: 0-255 min, written with fn 0x20
  n = g733.sent.length;
  check((await d.write('autoOff', 10)) === 10 && g733.state.autoOff === 10 && g733.sent.slice(n).some((b) => h(b.slice(0, 4)) === 'ff 04 2a 0a'), 'auto-off 10 min = FF 04 2A 0A, read back');
  e = await refusal(() => d.write('autoOff', 256));
  check(/0-255/.test(e?.message || ''), `auto-off 256 refused (${e?.message})`);
  e = await refusal(() => d.write('autoOff', 2.5));
  check(/whole number/.test(e?.message || ''), 'a fraction is refused');
  check((await d.write('autoOff', 30)) === 30 && g733.state.autoOff === 30, 'auto-off put back to 30');
  // EQ: one band changes, the rest go back as read
  n = g733.sent.length;
  check((await d.write('eq3', 4)) === 4 && g733.state.eq.join() === '0,2,4,0,3', `EQ band 3 to +4 dB, others kept (${g733.state.eq})`);
  check(g733.sent.slice(n).some((b) => h(b.slice(0, 9)) === 'ff 09 3a 02 00 02 04 00 03'), 'EQ write = FF 09 3A 02 00 02 04 00 03');
  check((await d.write('eq3', -1)) === -1 && g733.sent.some((b) => h(b.slice(0, 9)) === 'ff 09 3a 02 00 02 ff 00 03'), 'EQ -1 dB goes out as FF (signed byte)');
  e = await refusal(() => d.write('eq1', 7));
  check(/-6-6|must be -6/.test(e?.message || '') && g733.state.eq[0] === 0, `EQ +7 dB refused (${e?.message})`);
  check(g733.state.eq.join() === '0,2,-1,0,3', 'EQ back as it started');
  // mic mute is a reading
  e = await refusal(() => d.write('micMuted', true));
  check(/not a setting/.test(e?.message || ''), 'mic mute is never written');
  g733.state.muted = 1;
  check((await d.read()).micMuted === true, 'mic muted read from 0x0601 fn 0x10');
  check(!g733.sent.some((b) => b[1] === 10 && (b[2] & 0xf0) !== 0x10), 'only fn 0x10 is ever sent to 0x0601');
  // battery from the ADC (Solaar: valid bit0, recharging bit1)
  let bat = await d.battery();
  check(bat.percent === adcPercent(3922) && bat.percent === 70 && bat.charging === true, `ADC battery 3922 mV charging: ${JSON.stringify(bat)}`);
  g733.state.adcFlags = 0x00;
  bat = await d.battery();
  check(bat.percent === null && bat.charging === false, 'an invalid ADC reading gives no percent');
  check(adcPercent(4300) === 100 && adcPercent(3400) === 0 && adcPercent(3830) === 54, 'the voltage curve (Solaar) at its ends and between points');
  // an event first, an error reply, a silent first try
  g733.eventFirst = true;
  check((await d.read()).sidetone === 40, 'an event before the reply is skipped');
  g733.failNext = 0x05;
  e = await refusal(() => d.write('sidetone', 20));
  check(/HID\+\+ error 0x05/.test(e?.message || '') && g733.state.sidetone === 40, `an error reply is reported with its code (${e?.message})`);
  g733.silentOnce = true;
  check((await d.read()).sidetone === 40, 'a read is tried again once after no reply');
  // G HUB running: nothing written
  app.name = 'lghub_agent.exe';
  n = g733.sent.length;
  for (const [k, val] of [['sidetone', 50], ['autoOff', 5], ['eq2', 1]]) {
    e = await refusal(() => d.write(k, val));
    check(/G HUB/.test(e?.message || '') && e.waiting === true, `${k} refused while G HUB runs (${e?.message})`);
  }
  check(g733.sent.length === n, 'nothing was sent while G HUB runs');
  app.name = null;
  // the never list: hidpp() refuses NEVER ids and unlisted functions even when asked directly
  for (const id of NEVER_IDS) { e = await refusal(() => d.hidpp(id, 0x00)); check(/refused/.test(e?.message || ''), `hidpp() refuses 0x${id.toString(16)}`); }
  e = await refusal(() => d.hidpp(F.MIC_MUTE, 0x20, [1]));
  check(/refused/.test(e?.message || ''), 'hidpp() refuses the mic mute write (0x0601 fn 0x20)');
  e = await refusal(() => d.hidpp(F.SIDETONE, 0x20));
  check(/refused/.test(e?.message || ''), 'hidpp() refuses a function not in ALLOWED');
  check(g733.bad.length === 0, `every frame was well formed (${g733.bad.join('; ')})`);
  const raw = await d.rawBackup();
  check(raw.features['0x8300']?.index === 7 && raw.values.sidetone === 40, 'rawBackup holds the feature table and values');
  check((await d.info()).Model === 'Logitech G733', 'info names the model');
  // the self-check's way: each writable setting fits its own read value
  v = await d.read();
  check(d.settings.filter((s) => s.type !== 'display').every((s) => fits(s, v[s.key])), 'every value read fits its setting (the self-check writes it back)');
  await selfChecked(d, g733.state);
}

// ---- 2. a G535: interface 3, auto-off choice list, no EQ / mic mute ----
{
  const g535 = simHidpp({ features: { [F.ADC]: [5, 2], [F.SIDETONE]: [4, 0] },
    state: { sidetone: 0, autoOff: 15, mV: 3717, adcFlags: 0x01, autoOffAllowed: [0, 1, 2, 5, 10, 15, 30] } });
  let opened = null;
  const d = createLogitechHeadset({ open: async (p) => { if (p === '0AC4') { opened = p; return g535; } return null; }, vendorApp: async () => null, timeoutMs: 80 });
  check(await d.connect() && opened === '0AC4', 'G535 connects');
  check(d.hid.byPid['0AC4'].iface === 3 && d.hid.byPid['0AC4'].page === '000C', 'G535 collection: interface 3, usage page 0x0C (HeadsetControl)');
  const ao = d.settings.find((s) => s.key === 'autoOff');
  check(ao?.type === 'choice' && ao.options.map((o) => o.value).join() === '0,1,2,5,10,15,30', `G535 auto-off offers HeadsetControl's values only (${JSON.stringify(ao)})`);
  check(!d.settings.some((s) => /^eq|micMuted/.test(s.key)), 'no EQ or mic mute without the features');
  check((await d.write('autoOff', 5)) === 5 && g535.sent.some((b) => h(b.slice(0, 4)) === 'ff 05 2a 05'), 'G535 auto-off 5 = FF 05 2A 05 (HeadsetControl 05 2D, read 05 1D)');
  let e = await refusal(() => d.write('autoOff', 7));
  check(/one of/.test(e?.message || '') && g535.state.autoOff === 5, `auto-off 7 refused (${e?.message})`);
  check((await d.write('autoOff', 15)) === 15, 'G535 auto-off put back');
  check((await d.write('sidetone', 50)) === 50 && g535.sent.some((b) => h(b.slice(0, 4)) === 'ff 04 1a 32'), 'G535 sidetone 50 = FF 04 1A 32 (HeadsetControl 04 1D level)');
  check((await d.write('sidetone', 0)) === 0, 'G535 sidetone put back');
  const bat = await d.battery();
  check(bat.percent === 20 && bat.charging === false, `G535 battery ${JSON.stringify(bat)}`);
  check(!lookedUp(g535).some((id) => NEVER_IDS.includes(id)) && g535.bad.length === 0, 'G535: never list holds, frames well formed');
  // ADC version 1: no auto-off (Solaar ADCPower min_version 2)
  const old = simHidpp({ features: { [F.ADC]: [5, 1] }, state: { autoOff: 10, mV: 3800, adcFlags: 1 } });
  const d1 = make('0A87', old);
  await d1.connect();
  check(!d1.settings.some((s) => s.key === 'autoOff'), 'ADC version 1: auto-off is not offered');
}

// ---- 3. the PRO X 2 LIGHTSPEED: Centurion, bridge, sidetone v2 in steps, auto sleep v3, battery, mic mute ----
{
  const sub = { [F.C_BATTERY]: [2, 0], [F.C_SIDETONE]: [6, 2], [F.C_AUTO_SLEEP]: [3, 3], [F.MIC_MUTE]: [8, 0] };
  const px = simCenturion({ state: { percent: 64, charge: 1, sidetone: 10, sleepReserved: 7, sleep: 20, muted: 1 }, subFeatures: sub });
  const app = { name: null };
  const d = make('0AF7', px, app);
  check(await d.connect() && d.centurion && d.bridge === 5, 'PRO X 2 connects and finds its bridge at index 5');
  check(d.hid.byPid['0AF7'].reportId === 0x51 && d.hid.byPid['0AF7'].len === 63 && d.hid.byPid['0AF7'].page === 'FFA0', 'PRO X 2 channel: report 0x51, 64-byte frames, usage page 0xFFA0');
  // the first frame (after report id 0x51): length 05 (payload 4 + 1), flags 00, Root.getFeature 00 01, id 00 03
  check(h(px.sent[0].slice(0, 7)) === '05 00 00 01 00 03 00', `bridge lookup frame = [05 00] 00 01 00 03 (${h(px.sent[0].slice(0, 7))})`);
  // a bridged getFeature(0x0604): [len 0a, 00, bridge 05, 11, 00 06, 00 00 01 06 04]
  check(px.sent.some((b) => h(b.slice(0, 11)) === '0a 00 05 11 00 05 00 00 01 06 04'), 'bridged getFeature 0x0604 = 0A 00 05 11 00 05 00 00 01 06 04 (bridge 05, send fragment 11, size 5)');
  const st = d.settings.find((s) => s.key === 'sidetone');
  check(st?.max === 20 && st.unit === 'steps', `sidetone in the headset's 21 gain steps (Solaar v2, fn 0x20): ${JSON.stringify(st)}`);
  let v = await d.read();
  check(v.sidetone === 10 && v.autoOff === 20 && v.micMuted === true, `PRO X 2 read: ${JSON.stringify(v)}`);
  let n = px.subs.length;
  check((await d.write('sidetone', 15)) === 15 && px.state.sidetone === 15, 'sidetone step 15 written and read back');
  check(px.subs.slice(n).some((x) => x.id === F.C_SIDETONE && x.fn === 0x10 && h(x.p) === '01 ff 0f'), 'sidetone v2 write = [01 FF 0F] (Solaar HeadsetSidetone)');
  let e = await refusal(() => d.write('sidetone', 21));
  check(/0-20/.test(e?.message || '') && px.state.sidetone === 15, `sidetone 21 of 0-20 refused (${e?.message})`);
  n = px.subs.length;
  // driver safety (22 Oct 2026): an unchanged level IS sent (Solaar skips it), so the self-check's write of the value
  // just read really reaches the headset
  check((await d.write('sidetone', 15)) === 15 && px.subs.slice(n).some((x) => x.id === F.C_SIDETONE && x.fn === 0x10 && h(x.p) === '01 ff 0f'), 'the same level is sent again ([01 FF 0F]), then read back');
  check((await d.write('sidetone', 10)) === 10, 'sidetone put back');
  n = px.subs.length;
  check((await d.write('autoOff', 45)) === 45 && px.state.sleep === 45 && px.state.sleepReserved === 7, 'auto sleep 45 written, the reserved slot kept');
  check(px.subs.slice(n).some((x) => x.id === F.C_AUTO_SLEEP && x.fn === 0x10 && h(x.p) === '07 2d'), 'auto sleep v3 write = [07 2D] (slot 1 changed, slot 0 as read)');
  e = await refusal(() => d.write('autoOff', 300));
  check(/0-255/.test(e?.message || ''), 'auto sleep 300 refused');
  check((await d.write('autoOff', 20)) === 20 && px.state.sleep === 20, 'auto sleep put back');
  n = px.subs.length;
  check((await d.write('autoOff', 20)) === 20 && px.subs.slice(n).some((x) => x.id === F.C_AUTO_SLEEP && x.fn === 0x10 && h(x.p) === '07 14'), 'an unchanged auto sleep is sent ([07 14]), then read back');
  const bat = await d.battery();
  check(bat.percent === 64 && bat.charging === true, `Centurion battery ${JSON.stringify(bat)}`);
  px.connectEventFirst = true;
  check((await d.read()).sidetone === 10, 'a bridge connection event before the answer is skipped');
  app.name = 'lghub.exe';
  n = px.sent.length;
  e = await refusal(() => d.write('sidetone', 12));
  check(/G HUB/.test(e?.message || '') && px.sent.length === n, 'PRO X 2: refused while G HUB runs, nothing sent');
  app.name = null;
  e = await refusal(() => d.write('micMuted', false));
  check(/not a setting/.test(e?.message || ''), 'PRO X 2 mic mute is shown only');
  for (const id of [...NEVER_IDS]) { e = await refusal(() => d.cSub(id, 0x00)); check(/refused/.test(e?.message || ''), `cSub() refuses 0x${id.toString(16)}`); }
  e = await refusal(() => d.cSub(F.MIC_MUTE, 0x20, [0]));
  check(/refused/.test(e?.message || ''), 'cSub() refuses the mic mute write');
  e = await refusal(() => d.cDirect(0x010a, 0x00));
  check(/refused/.test(e?.message || ''), 'cDirect() refuses Centurion DFU 0x010A');
  check(!px.subs.some((x) => x.id === 0 && NEVER_IDS.includes((x.p[0] << 8) | x.p[1])), 'no never-list feature looked up through the bridge');
  px.off = true;
  e = await refusal(() => d.read());
  check(e?.offline === true, `a switched-off headset is reported as such (${e?.message})`);
  px.off = false;
  n = px.subs.length;
  await selfChecked(d, px.state);
  const sent = px.subs.slice(n);
  check(sent.some((x) => x.id === F.C_SIDETONE && x.fn === 0x10 && h(x.p) === '01 ff 0a') && sent.some((x) => x.id === F.C_AUTO_SLEEP && x.fn === 0x10 && h(x.p) === '07 14'),
    'the self-check really sent sidetone [01 FF 0A] and auto sleep [07 14] (the values it read), not only read them');
  check(px.bad.length === 0, `every Centurion frame was well formed (${px.bad.join('; ')})`);
  check((await d.info()).Protocol.startsWith('Centurion'), 'info names the protocol');
}

// ---- 3b. the G522 LIGHTSPEED (23 Oct 2026), battery only: Centurion report 0x50 with the address byte 0x23 (HeadsetControl
// logitech_g522_lightspeed.hpp FRAME_PREFIX 50 23; Solaar base.py "typical G522 (addr=0x23)"). The dongle 0B18 has the
// bridge; the cable 0B19 may have none (Solaar centurion.py: a direct device). Frames: [addr, len, flags, payload] ----
function simG522({ addr = 0x23, bridge = 3, direct = false, percent = 58, charge = 0, batteryIndex = 2 }) {
  const ev = emitter();
  const frame = (payload) => { const d = new Array(63).fill(0); d[0] = addr; d[1] = payload.length + 1; d[2] = 0; payload.forEach((x, i) => { d[3 + i] = x; }); return d; };
  const dev = {
    ...ev, opened: false, sent: [], subs: [], bad: [], ignored: 0,
    async open() { this.opened = true; },
    say(payload) { ev.emit(0x50, frame(payload)); },   // a frame the headset sends by itself
    async sendReport(rid, data) {
      const b = Array.from(data);
      this.sent.push(b);
      if (rid !== 0x50 || b.length !== 63) { this.bad.push(`report ${rid} of ${b.length} bytes`); return; }
      if (b[0] !== addr) { this.ignored++; return; }                       // a wrong address is ignored silently (Solaar base.py)
      const len = b[1], payload = b.slice(3, 2 + len);
      if (b[2] !== 0) this.bad.push('flags not 0');
      if (b.slice(2 + len).some((x) => x !== 0)) this.bad.push('frame not zero padded after its length');
      if ((payload[1] & 0x0f) !== 0x01) this.bad.push(`software id ${payload[1] & 0x0f}, not 1`);
      if (payload[0] === 0x00) {                                             // Root.getFeature on the dongle / the cable
        const want = (payload[2] << 8) | payload[3];
        const hit = want === 0x0003 && !direct ? [bridge, 0, 1] : want === F.C_BATTERY && direct ? [batteryIndex, 0, 0] : [0, 0, 0];
        return ev.emit(0x50, frame([0x00, payload[1], ...hit]));
      }
      if (direct) {
        if (payload[0] === batteryIndex && (payload[1] & 0xf0) === 0x00) return ev.emit(0x50, frame([batteryIndex, payload[1], percent, percent, charge]));
        this.bad.push(`direct request ${h(payload.slice(0, 4))}`); return;
      }
      if (payload[0] !== bridge || payload[1] !== 0x11) { this.bad.push(`direct request ${h(payload.slice(0, 4))}`); return; }
      const size = ((payload[2] & 0x0f) << 8) | payload[3], msg = payload.slice(4, 4 + size);
      const [, sub, fs] = msg, p = msg.slice(3), fn = fs & 0xf0;
      this.subs.push({ sub, fn, p });
      ev.emit(0x50, frame([bridge, 0x11, 0x00, 0x00]));                                 // the bridge's ack
      const answer = (out) => ev.emit(0x50, frame([bridge, 0x10, 0x00, out.length + 3, 0x00, sub, fs, ...out]));
      if (sub === 0 && fn === 0x00) { const id = (p[0] << 8) | p[1]; return answer(id === F.C_BATTERY ? [batteryIndex, 0, 0] : [0, 0, 0]); }
      if (sub === batteryIndex && fn === 0x00) return answer([percent, percent, charge]);
      return ev.emit(0x50, frame([bridge, 0x10, 0x00, 0x04, 0x00, 0xff, sub, fs, 0x07]));
    },
  };
  return dev;
}
{
  check(CENTURION['0B18'] && CENTURION['0B19'] && C_FRAMES['0B18'].reportId === 0x50 && C_FRAMES['0B18'].addr === 0x23 && C_FRAMES['0AF7'].addr === null, 'G522 ids 0B18 / 0B19: report 0x50, address 0x23; the PRO X 2 keeps 0x51 with no address');
  // the dongle: bridge lookup at 50 23, battery through the bridge, nothing else looked up, no settings
  const g = simG522({ charge: 1 });
  const d = make('0B18', g);
  check(await d.connect() && d.centurion && d.bridge === 3 && !d.direct, 'G522 dongle connects and finds its bridge at index 3');
  check(d.hid.byPid['0B18'].reportId === 0x50 && d.hid.byPid['0B18'].page === 'FFA0' && d.hid.byPid['0B18'].usage === '0001' && d.hid.byPid['0B18'].iface === 3 && d.hid.byPid['0B18'].len === 63, 'G522 dongle channel: report 0x50, FFA0 / 0001, interface 3, 64-byte frames');
  check(h(g.sent[0].slice(0, 8)) === '23 05 00 00 01 00 03 00', `bridge lookup frame = 50 [23 05 00] 00 01 00 03 (${h(g.sent[0].slice(0, 8))})`);
  check(g.subs.length === 1 && g.subs[0].sub === 0 && h(g.subs[0].p.slice(0, 2)) === '01 04', `only the battery 0x0104 is looked up through the bridge (${JSON.stringify(g.subs)})`);
  check(d.settings.length === 0 && JSON.stringify(await d.read()) === '{}', 'G522: no settings, nothing to write (battery only)');
  let bat = await d.battery();
  check(bat?.percent === 58 && bat.charging === true && bat.full === false, `G522 battery through the bridge ${JSON.stringify(bat)}`);
  check(g.subs.at(-1).sub === 2 && g.subs.at(-1).fn === 0x00, 'battery = 0x0104 fn 0x00 (HeadsetControl getBattery)');
  let e = await refusal(() => d.write('sidetone', 3));
  check(/not a setting/.test(e?.message || ''), 'G522: no sidetone offered');
  for (const id of [...NEVER_IDS]) { e = await refusal(() => d.cSub(id, 0x00)); check(/refused/.test(e?.message || ''), `G522 cSub() refuses 0x${id.toString(16)}`); }
  check(g.bad.length === 0 && g.ignored === 0, `every G522 frame well formed and addressed 0x23 (${g.bad.join('; ')})`);
  check(/0x50, address 0x23/.test((await d.info()).Protocol), `info names the 0x50 frames (${(await d.info()).Protocol})`);
  // a frame from another address arrives (the headset's own); a reply on the wrong address is never taken
  const g2 = simG522({ addr: 0x24 });
  const d2 = make('0B18', g2);
  g2.say([0x00, 0x00, 0x00, 0x01]);
  check(await d2.connect() && d2.frame.addr === 0x24 && g2.ignored === 1, `no answer at 0x23, then asked once at 0x24, the address the headset sent a frame from (ignored ${g2.ignored})`);
  check(g2.sent.every((b, i) => i === 0 ? b[0] === 0x23 : b[0] === 0x24) && g2.sent.length <= 3, `never a guessed address: only 0x23, then 0x24 (${g2.sent.map((b) => b[0].toString(16))})`);
  const g3 = simG522({ addr: 0x30 });
  const d3 = make('0B18', g3);
  e = await refusal(() => d3.connect());
  check(e && g3.sent.length === 1 && g3.sent[0][0] === 0x23, `nothing heard: one request at 0x23 and no address probing (${e?.message})`);
  // the cable 0B19 with no bridge: asked directly (Solaar centurion.py), battery only
  const c = simG522({ direct: true, percent: 100, charge: 3, batteryIndex: 4 });
  const dc = make('0B19', c);
  check(await dc.connect() && dc.direct && dc.bridge === null && dc.features[F.C_BATTERY]?.index === 4, 'G522 cable without a bridge: asked directly, battery at index 4');
  check(dc.hid.byPid['0B19'].page === 'FFA0' && dc.hid.byPid['0B19'].usage === '*' && dc.hid.byPid['0B19'].inputLen === 63 && dc.hid.byPid['0B19'].outputLen === 63 && dc.hid.byPid['0B19'].iface === undefined, 'G522 cable channel: the FFA0 collection with 63-byte reports (Solaar udev_impl.py), no interface named');
  bat = await dc.battery();
  check(bat?.percent === 100 && bat.full === true && bat.charging === false, `G522 cable battery read directly ${JSON.stringify(bat)}`);
  check(h(c.sent.at(-1).slice(0, 6)) === '23 03 00 04 01 00', `direct battery frame = 50 [23 03 00] 04 01 (${h(c.sent.at(-1).slice(0, 6))})`);
  e = await refusal(() => dc.cDirect(F.C_SIDETONE, 0x00));
  check(/refused/.test(e?.message || ''), 'G522 cable: only Root and the battery can be sent directly');
  e = await refusal(() => dc.cDirect(0x010a, 0x00));
  check(/refused/.test(e?.message || ''), 'G522 cable: Centurion DFU 0x010A refused');
  check(c.bad.length === 0, `every G522 cable frame well formed (${c.bad.join('; ')})`);
  // the G522 dongle without a bridge is an error, not a direct device (only the cable may be one)
  const nb = simG522({ direct: true });
  e = await refusal(() => make('0B18', nb).connect());
  check(/no Centurion bridge/.test(e?.message || ''), `a G522 dongle with no bridge is reported (${e?.message})`);
  // the G431 / G432 / G433 are not run (HeadsetControl only writes their sidetone, no read)
  check(!['0A9B', '0A9C', '0A6D'].some((p) => PIDS.includes(p)), 'G431 / G432 / G433 are not among the ids');
}

// ---- 4. nothing plugged in; the library entry ----
{
  const d = createLogitechHeadset({ open: async () => null, vendorApp: async () => null });
  check((await d.connect()) === false && d.settings.length === 0, 'no headset: connect() is false, no settings');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'logitech-hidpp-headset', 'device.json'), 'utf8'));
  check(validateMeta(meta) === null, `device.json is well formed (${validateMeta(meta)})`);
  check(meta.status === 'untested' && meta.tested.length === 0, 'device.json says untested, with no test record');
  check(meta.pids.map((p) => p.toUpperCase()).sort().join() === [...PIDS].sort().join(), 'device.json lists exactly the driver\'s product ids');
  check(meta.id === d.id, 'device.json id = the driver id');
  const never = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));
  check(never.commands.some((c) => c.vid === '046D' && /0x0309/.test(c.what) && /0x1816/.test(c.what)), 'the shared never list names Lightspeed pairing 0x0309 and BLE pre-pairing 0x1816');
}

// receiver slots (22 Oct 2026, docs/handoff/logitech-c539.md): the headset driver never opens a Lightspeed / Bolt /
// Unifying receiver (0xC500-0xC5FF; Solaar base_usb.py), so a headset can never fight the mouse or keyboard driver for a
// receiver slot; a headset's own dongle is addressed at 0xFF only
{
  const mouseRx = (await import('../device-library/logitech-hidpp-mouse/device.mjs')).RECEIVERS;
  const kbRx = Object.keys((await import('../device-library/logitech-hidpp-keyboard/device.mjs')).RECEIVERS).map(Number);
  check(PIDS.every((p) => { const n = parseInt(p, 16); return n < 0xc500 || n > 0xc5ff; }) && !PIDS.some((p) => [...mouseRx, ...kbRx].includes(parseInt(p, 16))), 'no headset id is a receiver id (C539 and the rest stay with the mouse and keyboard drivers)');
}

console.log(fails.length ? `sim-logitech-headset: FAILED: ${fails.join('; ')}` : 'sim-logitech-headset (Logitech HID++ / Centurion headset driver, simulated): all good');
process.exit(fails.length ? 1 : 0);
