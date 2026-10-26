// The Razer keyboard library driver (device-library/razer-keyboard/device.mjs) against simulated keyboards only: nothing
// is opened, nothing reaches hardware. Each simulated keyboard answers with OpenRazer's own transaction id per command
// (typed out here by hand from razerkbd_driver.c @ 477f4d6d: a wrong id gets 0x05 "not supported"), its own CRC loop
// and the status codes busy 0x01 / success 0x02 / failure 0x03 / timeout 0x04 / not supported 0x05.
// Covers every setting: write, read back, put back, out-of-range refused, refused while Synapse runs, the never list.
// Run: node tests/sim-razer-keyboard.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRazerKeyboard, buildReport, MODELS, PIDS } from '../device-library/razer-keyboard/device.mjs';
import { problem, fits } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
process.on('uncaughtException', (e) => { console.log(`sim-razer-keyboard: FAILED: ${e.message}`); process.exit(1); });
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8')).commands.filter((c) => c.bytes && [].concat(c.vid).includes('1532'));
const matchesNever = (bytes) => NEVER.some((n) => n.bytes.split(' ').every((t, i) => t === '??' || parseInt(t, 16) === bytes[i]));

// tids: { 'cc/ii': tid } the transaction id this keyboard answers each command on (OpenRazer razerkbd_driver.c)
function simKeyboard({ tids, state, stores = {} }) {
  const s = { fw: [1, 4], bright: 180, game: 0, macro: 0, poll: 0x08, battery: 204, charging: 1, lowBat: 0x26, store: 1, ...state };
  const sim = { s, sent: [], bad: [], reply: new Uint8Array(90), busyNext: 0, failNext: false, asleep: false };
  const simCrc = (r) => { let c = 0; for (let i = 2; i < 88; i++) c ^= r[i]; return c; };
  const answer = (q) => {
    const key = `${q[6].toString(16).padStart(2, '0')}/${q[7].toString(16).padStart(2, '0')}`, a = q.slice(8, 88);
    const r = new Uint8Array(90); r.set(q.slice(0, 8));
    const ok = (args = []) => { r[0] = 0x02; r.set(args, 8); };
    if (sim.asleep) r[0] = 0x04;
    else if (!(key in tids) || tids[key] !== q[1]) r[0] = 0x05;
    else if (sim.failNext) { sim.failNext = false; r[0] = 0x03; }
    else {
      const wantStore = stores[key];
      switch (key) {
        case '00/81': ok(s.fw); break;
        case '0f/84': case '03/83': if (a[0] !== 0x01 || a[1] !== 0x05) r[0] = 0x03; else ok([a[0], a[1], s.bright]); break;
        case '0f/04': if (q[5] !== 0x03 || a[1] !== 0x05 || a[0] !== (wantStore ?? 0x01)) r[0] = 0x03; else { s.bright = a[2]; ok(a.slice(0, 3)); } break;
        case '03/80': if (a[0] !== (wantStore ?? 0x01) || ![0x07, 0x08].includes(a[1])) r[0] = 0x03; else ok([a[0], a[1], a[1] === 0x08 ? s.game : s.macro]); break;
        case '03/00': if (q[5] !== 0x03 || a[0] !== (wantStore ?? 0x01) || ![0x07, 0x08].includes(a[1]) || a[2] > 1) r[0] = 0x03; else { if (a[1] === 0x08) s.game = a[2]; else s.macro = a[2]; ok(a.slice(0, 3)); } break;
        case '00/c0': ok([0x00, s.poll]); break;
        case '00/40': if (q[5] !== 0x02 || a[0] !== 0x00 || ![0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40].includes(a[1])) r[0] = 0x03; else { s.poll = a[1]; ok([a[0], a[1]]); } break;
        case '07/80': ok([0, s.battery]); break;
        case '07/84': ok([0, s.charging]); break;
        case '07/81': ok([s.lowBat]); break;
        case '07/01': if (a[0] < 0x0c || a[0] > 0x3f) r[0] = 0x03; else { s.lowBat = a[0]; ok([a[0]]); } break;
        case '05/84': ok([s.store]); break;
        default: r[0] = 0x05;
      }
    }
    r[88] = simCrc(r);
    return r;
  };
  sim.dev = {
    async sendFeatureReport(id, data) {
      const q = Uint8Array.from(data);
      if (id !== 0 || q.length !== 90) sim.bad.push(`report id ${id}, ${q.length} bytes`);
      if (q[0] !== 0 || q[2] !== 0 || q[3] !== 0 || q[4] !== 0 || q[89] !== 0) sim.bad.push(`header ${hex(q.slice(0, 8))}`);
      if (simCrc(q) !== q[88]) sim.bad.push(`bad crc on ${hex(q.slice(0, 8))}`);
      sim.sent.push({ tid: q[1], cls: q[6], id: q[7], size: q[5], args: [...q.slice(8, 8 + q[5])], bytes: q });
      sim.reply = answer(q);
      sim.busyLeft = sim.busyNext; sim.busyNext = 0;
    },
    async receiveFeatureReport(id, len) {
      if (id !== 0 || len !== 90) sim.bad.push(`receive ${id} ${len}`);
      let r = sim.reply;
      if (sim.busyLeft > 0) { sim.busyLeft--; r = Uint8Array.from(r); r[0] = 0x00; r[88] = simCrc(r); }   // not handled yet: read again
      return new DataView(Uint8Array.from(r).buffer);
    },
  };
  return sim;
}
const sleeps = [];
function driverOn(pid, simOpts) {
  const sim = simKeyboard(simOpts);
  sim.app = null; sim.clock = 1;
  const d = createRazerKeyboard({ sleep: async (ms) => { sleeps.push(ms); }, open: async (p) => (p === pid ? sim.dev : null), vendorApp: async () => sim.app, now: () => sim.clock });
  return { d, sim };
}
const ALLOWED_CMDS = new Set(['00/81', '0f/84', '0f/04', '03/83', '03/80', '03/00', '00/c0', '00/40', '07/80', '07/84', '07/81', '07/01', '05/84']);
const cmdKey = (r) => `${r.cls.toString(16).padStart(2, '0')}/${r.id.toString(16).padStart(2, '0')}`;
const writes = (sim) => sim.sent.filter((r) => !(r.id & 0x80));
const allSims = [];

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

// ---- 1. the report, byte for byte (razercommon.h), typed out by hand ----
const lit = (head, c) => { const r = new Uint8Array(90); r.set(head); r[88] = c; return hex(r); };
// game mode on, VARSTORE, tid FF: size 03, class 03, id 00, args 01 08 01; crc 03^03^00^01^08^01 = 08
check(hex(buildReport(0xff, 0x03, 0x00, 0x03, [0x01, 0x08, 0x01])) === lit([0x00, 0xff, 0x00, 0x00, 0x00, 0x03, 0x03, 0x00, 0x01, 0x08, 0x01], 0x08), 'game mode on bytes (razerchromacommon.c comment: 03 00 010801)');
// brightness 0xB7 extended, tid 1F: size 03, class 0F, id 04, args 01 05 B7; crc 03^0F^04^01^05^B7 = BB
check(hex(buildReport(0x1f, 0x0f, 0x04, 0x03, [0x01, 0x05, 0xb7])) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x03, 0x0f, 0x04, 0x01, 0x05, 0xb7], 0xbb), 'extended brightness set bytes');
// polling 500 Hz, tid 1F: size 02, class 00, id 40, args 00 10; crc 02^00^40^00^10 = 52
check(hex(buildReport(0x1f, 0x00, 0x40, 0x02, [0x00, 0x10])) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x00, 0x40, 0x00, 0x10], 0x52), 'polling rate 500 Hz set bytes');

// ---- 2. a BlackWidow V4: extended brightness tid 1F, game and macro LEDs tid FF, polling tid 1F ----
{
  const { d, sim } = driverOn('0287', { tids: { '00/81': 0xff, '0f/84': 0x1f, '0f/04': 0x1f, '03/80': 0xff, '03/00': 0xff, '00/c0': 0x1f, '00/40': 0x1f } });
  allSims.push(sim);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  check(await d.connect(), 'BlackWidow V4 connects');
  check(d.hid.byPid['0287'].iface === 3 && d.hid.featureOnly && d.hid.featureLen === 90 && d.hid.page === '*', 'BlackWidow V4: interface 3, feature-only, 91-byte feature report, any usage page');
  const v = await d.read();
  check(problem(d) === null && d.settings.map((s) => s.key).join() === 'brightness,gameMode,macroLed,pollingRate', `settings: ${d.settings.map((s) => s.key)}`);
  check(v.brightness === 180 && v.gameMode === false && v.macroLed === false && v.pollingRate === 1000, `read: ${JSON.stringify(v)}`);
  check(sim.sent.some((r) => cmdKey(r) === '0f/84' && r.tid === 0x1f && hex(r.args) === '01 05 00'), 'brightness read = 0F/84 [01 05] tid 1F');
  check(sim.sent.some((r) => cmdKey(r) === '03/80' && r.tid === 0xff && hex(r.args) === '01 08 00'), 'game mode read = 03/80 [01 08] tid FF');
  // brightness
  let n = sim.sent.length;
  check((await d.write('brightness', 60)) === 60 && sim.s.bright === 60, 'brightness 60 written and read back');
  check(sim.sent.slice(n).some((r) => cmdKey(r) === '0f/04' && r.tid === 0x1f && hex(r.args) === '01 05 3c'), 'brightness set = 0F/04 [01 05 3C] tid 1F');
  let e = await refusal(() => d.write('brightness', 256));
  check(/0-255/.test(e?.message || '') && sim.s.bright === 60, `brightness 256 refused (${e?.message})`);
  e = await refusal(() => d.write('brightness', -1));
  check(/0-255/.test(e?.message || ''), 'brightness -1 refused');
  check((await d.write('brightness', 180)) === 180, 'brightness put back');
  // game mode and macro light
  n = sim.sent.length;
  check((await d.write('gameMode', true)) === true && sim.s.game === 1 && sim.sent.slice(n).some((r) => cmdKey(r) === '03/00' && r.tid === 0xff && hex(r.args) === '01 08 01'), 'game mode on = 03/00 [01 08 01] tid FF, read back');
  check((await d.write('gameMode', false)) === false && sim.s.game === 0, 'game mode put back');
  e = await refusal(() => d.write('gameMode', 1));
  check(/true \/ false/.test(e?.message || ''), 'game mode takes true / false only');
  check((await d.write('macroLed', true)) === true && sim.s.macro === 1 && sim.sent.some((r) => cmdKey(r) === '03/00' && hex(r.args) === '01 07 01'), 'macro light on = 03/00 [01 07 01]');
  check((await d.write('macroLed', false)) === false && sim.s.macro === 0, 'macro light put back');
  // polling rate: 125-1000 offered (the keyboard reads 1000)
  check(d.settings.find((s) => s.key === 'pollingRate').options.map((o) => o.value).join() === '125,250,500,1000', 'polling rates 125-1000');
  n = sim.sent.length;
  check((await d.write('pollingRate', 500)) === 500 && sim.s.poll === 0x10 && sim.sent.slice(n).filter((r) => cmdKey(r) === '00/40').length === 1 && sim.sent.slice(n).some((r) => cmdKey(r) === '00/40' && hex(r.args) === '00 10'), 'polling 500 Hz = 00/40 [00 10] once, read back');
  e = await refusal(() => d.write('pollingRate', 8000));
  check(/one of/.test(e?.message || '') && sim.s.poll === 0x10, `8000 Hz not offered on a 1000 Hz keyboard (${e?.message})`);
  check((await d.write('pollingRate', 1000)) === 1000, 'polling put back');
  // not a setting of this keyboard
  e = await refusal(() => d.write('lowBattery', 20));
  check(/not a setting/.test(e?.message || ''), 'low-battery threshold is not offered on a wired keyboard');
  check((await d.battery()) === null, 'a wired keyboard has no battery');
  // busy-then-answer, failure
  sim.busyNext = 3;
  check((await d.read()).brightness === 180, 'a reply that is not handled yet is read again');
  sim.failNext = true;
  e = await refusal(() => d.write('brightness', 90));
  check(/failure/.test(e?.message || '') && sim.s.bright === 180, `a failure status is reported (${e?.message})`);
  // Synapse running
  sim.app = 'Razer Synapse.exe'; sim.clock += 20000;
  n = writes(sim).length;
  for (const [k, val] of [['brightness', 50], ['gameMode', true], ['macroLed', true], ['pollingRate', 250]]) {
    e = await refusal(() => d.write(k, val));
    check(/Synapse\.exe is running/.test(e?.message || ''), `${k} refused while Synapse runs (${e?.message})`);
  }
  check(writes(sim).length === n, 'nothing written while Synapse runs');
  sim.app = null; sim.clock += 20000;
  check((await d.write('brightness', 180)) === 180, 'after Synapse closed: written');
  const info = await d.info();
  check(info.Firmware === '1.4' && info.Model === 'Razer BlackWidow V4', `info: ${JSON.stringify(info)}`);
  check(d.settings.every((s) => fits(s, v[s.key]) || v[s.key] === undefined), 'every value read fits its setting');
  await selfChecked(d, sim.s);

  // driver safety (22 Oct 2026): the self-check really sends each value it read; reads go on while Synapse runs and every
  // write (even of the same value) is refused; a raw LED state that is neither 0 nor 1 is never written back as one
  {
    const { selfCheck } = await import('../helpers/my-devices.mjs');
    let w = writes(sim).length;
    const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
    const sent = writes(sim).slice(w).map(cmdKey);
    check(r.keys?.gameMode?.ok && ['0f/04', '03/00', '00/40'].every((c) => sent.includes(c)) && sent.filter((c) => c === '03/00').length === 2, `the self-check really sent brightness, both LED states and the polling rate (${sent})`);
    sim.app = 'Razer Synapse.exe'; sim.clock += 20000;
    const v2 = await d.read();
    check(v2.brightness === 180 && v2.gameMode === false, 'reads go on while Synapse runs');
    w = writes(sim).length;
    e = await refusal(() => d.write('brightness', 180));
    check(/Synapse/.test(e?.message || '') && e.waiting === true && writes(sim).length === w, 'a same-value write is refused while Synapse runs, nothing written');
    sim.app = null; sim.clock += 20000;
    sim.s.game = 2;
    check((await d.read()).gameMode === null, 'raw game mode 2 reads as not on / off');
    w = writes(sim).length;
    const r2 = await selfCheck(d, d.write, { only: ['gameMode'], previous: r, backup: async () => true, makerApp: async () => null });
    check(!r2.keys?.gameMode?.ok && sim.s.game === 2 && writes(sim).length === w, `raw 2 is never written back as 0 or 1 (${JSON.stringify(r2.keys?.gameMode)})`);
    sim.s.game = 0;
  }
}

// ---- 3. a Huntsman V2: game mode NOSTORE with tid 1F; a polling keyboard already at 8000 Hz ----
{
  const { d, sim } = driverOn('026C', { tids: { '00/81': 0xff, '0f/84': 0x1f, '0f/04': 0x1f, '03/80': 0x1f, '03/00': 0x1f, '00/c0': 0x1f, '00/40': 0x1f }, stores: { '03/80': 0x00, '03/00': 0x00 }, state: { poll: 0x01 } });
  allSims.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.gameMode === false && v.pollingRate === 8000, `Huntsman V2 read: ${JSON.stringify(v)}`);
  check(sim.sent.some((r) => cmdKey(r) === '03/80' && r.tid === 0x1f && hex(r.args) === '00 08 00'), 'Huntsman V2 game mode read = 03/80 [00 08] (NOSTORE) tid 1F');
  check((await d.write('gameMode', true)) === true && sim.sent.some((r) => cmdKey(r) === '03/00' && r.tid === 0x1f && hex(r.args) === '00 08 01'), 'Huntsman V2 game mode on = 03/00 [00 08 01] tid 1F');
  check((await d.write('gameMode', false)) === false, 'put back');
  check(d.settings.find((s) => s.key === 'pollingRate').options.map((o) => o.value).join() === '125,250,500,1000,2000,4000,8000', 'a keyboard reading 8000 Hz offers up to 8000');
  check((await d.write('pollingRate', 4000)) === 4000 && (await d.write('pollingRate', 8000)) === 8000 && sim.s.poll === 0x01, '4000 Hz written and 8000 put back');
}

// ---- 4. a BlackWidow V3 Pro on its dongle: tid 9F, 4.9 ms wait, battery, low-battery threshold (tid FF) ----
{
  sleeps.length = 0;
  const { d, sim } = driverOn('025C', { tids: { '00/81': 0xff, '0f/84': 0x9f, '0f/04': 0x9f, '03/80': 0xff, '03/00': 0xff, '07/80': 0x9f, '07/84': 0x9f, '07/81': 0xff, '07/01': 0xff } });
  allSims.push(sim);
  check(d.hid.byPid['025C'].iface === 2, 'BlackWidow V3 Pro wireless: interface 2');
  await d.connect();
  const v = await d.read();
  check(d.settings.map((s) => s.key).join() === 'brightness,gameMode,macroLed,lowBattery' && v.lowBattery === 0x26, `V3 Pro settings ${d.settings.map((s) => s.key)} ${JSON.stringify(v)}`);
  check(sleeps.length && sleeps.every((ms) => ms === 4.9 || ms === 10), `wireless wait 4.9 ms (RAZER_BLACKWIDOW_V3_WIRELESS_WAIT_US) (${[...new Set(sleeps)]})`);
  const bat = await d.battery();
  check(bat.percent === 80 && bat.charging === true, `battery 204/255 = 80%, charging (${JSON.stringify(bat)})`);
  check(sim.sent.some((r) => cmdKey(r) === '07/80' && r.tid === 0x9f), 'battery read = 07/80 tid 9F');
  check((await d.write('lowBattery', 0x3f)) === 0x3f && sim.sent.some((r) => cmdKey(r) === '07/01' && r.tid === 0xff && hex(r.args) === '3f'), 'low-battery 63 = 07/01 [3F] tid FF, read back');
  let e = await refusal(() => d.write('lowBattery', 0x0b));
  check(/12-63/.test(e?.message || '') && sim.s.lowBat === 0x3f, `low-battery 11 refused (${e?.message})`);
  e = await refusal(() => d.write('lowBattery', 0x40));
  check(/12-63/.test(e?.message || ''), 'low-battery 64 refused');
  check((await d.write('lowBattery', 0x26)) === 0x26, 'low-battery put back');
  check((await d.write('brightness', 10)) === 10 && sim.sent.some((r) => cmdKey(r) === '0f/04' && r.tid === 0x9f), 'brightness on the dongle uses tid 9F');
  check((await d.write('brightness', 180)) === 180, 'put back');
  sim.asleep = true;
  e = await refusal(() => d.read());
  check(e?.status === 4, `an asleep keyboard is reported, not guessed (${e?.message})`);
  sim.asleep = false;
  await selfChecked(d, sim.s);
}

// ---- 5. the Huntsman V3 Pro family: written extended (1F), read standard (FF); the 8KHz's profile store; the TKL ----
{
  const { d, sim } = driverOn('02A6', { tids: { '00/81': 0xff, '03/83': 0xff, '0f/04': 0x1f, '03/80': 0xff, '03/00': 0xff } });
  allSims.push(sim);
  await d.connect();
  check((await d.read()).brightness === 180, 'Huntsman V3 Pro brightness read through 03/83 tid FF');
  check((await d.write('brightness', 99)) === 99 && sim.sent.some((r) => cmdKey(r) === '0f/04' && r.tid === 0x1f) && sim.sent.some((r) => cmdKey(r) === '03/83' && r.tid === 0xff), 'written 0F/04 tid 1F, read back 03/83 tid FF');
  check((await d.write('brightness', 180)) === 180, 'put back');

  const k8 = driverOn('02CF', { tids: { '00/81': 0xff, '03/83': 0xff, '0f/04': 0x1f, '03/80': 0xff, '03/00': 0xff, '05/84': 0x1f } });
  allSims.push(k8.sim);
  await k8.d.connect();
  check((await k8.d.write('brightness', 77)) === 77 && k8.sim.sent.some((r) => cmdKey(r) === '05/84' && r.tid === 0x1f && r.size === 1), '8KHz on store 1: active store read (05/84 tid 1F), then written');
  k8.sim.s.store = 2;
  const n = writes(k8.sim).length;
  const e = await refusal(() => k8.d.write('brightness', 40));
  check(/store 2/.test(e?.message || '') && writes(k8.sim).length === n && k8.sim.s.bright === 77, `8KHz on store 2: not written, says why (${e?.message})`);

  const tkl = driverOn('02A7', { tids: { '00/81': 0xff, '03/80': 0xff, '03/00': 0xff } });
  allSims.push(tkl.sim);
  await tkl.d.connect();
  await tkl.d.read();
  check(!tkl.d.settings.some((s) => s.key === 'brightness') && !tkl.sim.sent.some((r) => r.cls === 0x0f || cmdKey(r) === '03/83'), 'Huntsman V3 Pro TKL: no brightness (no read in OpenRazer), never asked');
  check(tkl.d.settings.map((s) => s.key).join() === 'gameMode,macroLed', 'TKL keeps game mode and the macro light');
}

// ---- 5b. added 23 Oct 2026: Huntsman Mini JP (as the Mini), the two analog Huntsmans (lights and info only), and the
// OpenRGB-only BlackWidow V4 Pro 75% / V4 Low Profile TKL (info only: firmware on the device's own transaction id) ----
{
  const jp = driverOn('0269', { tids: { '00/81': 0xff, '0f/84': 0x3f, '0f/04': 0x3f, '03/80': 0xff, '03/00': 0xff } });
  allSims.push(jp.sim);
  await jp.d.connect();
  check(jp.d.hid.byPid['0269'].iface === 2 && (await jp.d.read()).brightness === 180 && jp.d.settings.map((s) => s.key).join() === 'brightness,gameMode,macroLed', `Huntsman Mini JP: interface 2, brightness, game mode, macro light (${jp.d.settings.map((s) => s.key)})`);
  check((await jp.d.write('brightness', 33)) === 33 && jp.sim.sent.some((r) => cmdKey(r) === '0f/04' && r.tid === 0x3f && hex(r.args) === '01 05 21') && (await jp.d.write('brightness', 180)) === 180, 'Mini JP brightness = 0F/04 [01 05 21] tid 3F, put back');
  await selfChecked(jp.d, jp.sim.s);

  for (const pid of ['0266', '0282']) {
    const a = driverOn(pid, { tids: { '00/81': 0xff, '03/83': 0xff, '0f/04': 0x1f, '03/80': 0xff, '03/00': 0xff } });
    allSims.push(a.sim);
    await a.d.connect();
    const v = await a.d.read();
    check(a.d.hid.byPid[pid].iface === 3 && a.d.settings.map((s) => s.key).join() === 'brightness,macroLed' && v.brightness === 180 && v.macroLed === false, `${pid} (analog): interface 3, brightness and the macro light only (${a.d.settings.map((s) => s.key)})`);
    check(!a.sim.sent.some((r) => cmdKey(r).startsWith('03/') && r.args[1] === 0x08), `${pid}: game mode is never asked or written`);
    check((await a.d.write('brightness', 64)) === 64 && a.sim.sent.some((r) => cmdKey(r) === '0f/04' && r.tid === 0x1f) && a.sim.sent.some((r) => cmdKey(r) === '03/83' && r.tid === 0xff), `${pid}: brightness written 0F/04 tid 1F, read 03/83 tid FF`);
    check((await a.d.write('brightness', 180)) === 180, `${pid}: put back`);
    const e = await refusal(() => a.d.write('gameMode', true));
    check(/not a setting/.test(e?.message || ''), `${pid}: game mode refused (${e?.message})`);
    check((await a.d.info()).Model === `Razer ${pid === '0266' ? 'Huntsman V2 Analog' : 'Huntsman Mini Analog'}`, `${pid}: info`);
    await selfChecked(a.d, a.sim.s);
  }

  for (const [pid, iface, tid, model] of [['02B3', 3, 0x1f, 'BlackWidow V4 Pro 75%'], ['02B4', 2, 0x1f, 'BlackWidow V4 Pro 75%'], ['02D4', 3, 0x1f, 'BlackWidow V4 Low Profile TKL'], ['02D2', 2, 0x9f, 'BlackWidow V4 Low Profile TKL']]) {
    // the keyboard would answer brightness too; the driver must not ask (no source has the read)
    const o = driverOn(pid, { tids: { '00/81': tid, '0f/84': tid, '0f/04': tid, '03/80': 0xff, '03/00': 0xff, '07/80': tid, '07/84': tid } });
    allSims.push(o.sim);
    await o.d.connect();
    const i = await o.d.info();
    check(o.d.hid.byPid[pid].iface === iface && i.Model === `Razer ${model}` && i.Firmware === '1.4' && /none yet/.test(i.Settings), `${pid}: interface ${iface}, info only (${JSON.stringify(i)})`);
    check(o.sim.sent.length === 1 && cmdKey(o.sim.sent[0]) === '00/81' && o.sim.sent[0].tid === tid && o.sim.sent[0].size === 2, `${pid}: only the firmware read, 00/81 size 02 on tid ${tid.toString(16)} (${o.sim.sent.map(cmdKey)})`);
    check(o.d.settings.length === 0 && JSON.stringify(await o.d.read()) === '{}' && (await o.d.battery()) === null, `${pid}: no settings, no battery`);
    const e = await refusal(() => o.d.write('brightness', 10));
    check(/not a setting/.test(e?.message || '') && writes(o.sim).length === 0, `${pid}: brightness refused, nothing written`);
    check(o.sim.sent.length === 1, `${pid}: still only the firmware read`);
  }
}

// ---- 6. the model table and the never list ----
{
  for (const sim of allSims) {
    check(sim.bad.length === 0, `every report well formed (${sim.bad.join('; ')})`);
    check(sim.sent.every((r) => ALLOWED_CMDS.has(cmdKey(r))), `only listed commands sent (${[...new Set(sim.sent.map(cmdKey))].filter((c) => !ALLOWED_CMDS.has(c))})`);
    check(!sim.sent.some((r) => matchesNever(r.bytes)), 'nothing on DeviceHub\'s never list was sent');
  }
  check(NEVER.some((n) => n.bytes.endsWith('00 46')) && NEVER.some((n) => n.bytes.endsWith('00 42')) && NEVER.some((n) => n.bytes.endsWith('00 04 02')), 'the shared never list holds dongle pair / unpair and device mode 02');
  check(matchesNever(buildReport(0x1f, 0x00, 0x46, 0x01, [0x01])) && matchesNever(buildReport(0xff, 0x00, 0x04, 0x02, [0x02, 0x00])) && !matchesNever(buildReport(0xff, 0x00, 0x04, 0x02, [0x00, 0x00])), 'the never patterns catch pairing and factory mode, and not normal mode');
  const iface = (ids) => ids.every((p) => MODELS[p]);
  check(iface(['026B', '026C', '0258', '024E', '02B9', '0295', '0292', '0287', '028D', '02A5', '0298', '02A6', '02A7', '02B0', '02CF', '02D7']) && ['026B', '026C', '0258', '024E', '02B9', '0295', '0292', '0287', '028D', '02A5', '0298', '02A6', '02A7', '02B0', '02CF', '02D7', '0271', '02BA'].every((p) => MODELS[p].iface === 3), 'interface 3 where razer_get_report_params says 0x03');
  check(['0266', '0282', '02B3', '02D4'].every((p) => MODELS[p].iface === 3) && ['0269', '02B4', '02D2'].every((p) => MODELS[p].iface === 2), 'the added boards: interface 3 / 2 as razer_get_report_params and OpenRGB\'s detectors say');
  check(['02B3', '02B4', '02D4', '02D2'].every((p) => MODELS[p].infoOnly && MODELS[p].bright === null && MODELS[p].game === null && !MODELS[p].macro && MODELS[p].bat === null && MODELS[p].poll === null), 'the OpenRGB-only boards carry no setting');
  check(['02A1', '028F', '02A3', '0257', '025A', '0293', '025C', '02D5', '0290', '0296'].every((p) => MODELS[p].iface === 2) && ['0294', '02A2'].every((p) => MODELS[p].iface === 1), 'interface 2 and the default 1 as razer_get_report_params says');
  check(['02BA', '02D5', '025C', '0271', '0290', '0296'].every((p) => MODELS[p].wait === 4.9 && MODELS[p].bright === 'x9f' && MODELS[p].bat === 0x9f), 'wireless boards: 4.9 ms, tid 9F');
  const d = createRazerKeyboard({ open: async () => null, vendorApp: async () => null });
  check((await d.connect()) === false, 'nothing plugged in: connect() is false');
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'razer-keyboard', 'device.json'), 'utf8'));
  check(validateMeta(meta) === null && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0, `device.json well formed and untested or read-only (${validateMeta(meta)})`);
  check(meta.pids.map((p) => p.toUpperCase()).sort().join() === [...PIDS].sort().join() && meta.id === d.id, 'device.json lists exactly the driver\'s ids');
  const mouse = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'razer-mouse', 'device.json'), 'utf8'));
  check(!meta.pids.some((p) => mouse.pids.includes(p)), 'no product id is shared with the mouse driver');
}

console.log(fails.length ? `sim-razer-keyboard: FAILED: ${fails.join('; ')}` : 'sim-razer-keyboard (Razer keyboard driver, simulated): all good');
process.exit(fails.length ? 1 : 0);
