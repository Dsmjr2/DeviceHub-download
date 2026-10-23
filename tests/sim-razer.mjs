// The Razer mouse library driver (device-library/razer-mouse/device.mjs) against simulated mice only: nothing is opened,
// nothing is sent to hardware. The simulated mouse is written from docs/brands/razer.md by hand (its own CRC loop, its
// own command table with hex literals, the status codes busy 0x01 / success 0x02 / failure 0x03 / timeout 0x04 / not
// supported 0x05), so a driver that drifts from the sheet fails here. Expected request bytes are typed out by hand.
// Run: node tests/sim-razer.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRazerMouse, buildReport, crc, MODELS, PIDS } from '../device-library/razer-mouse/device.mjs';
import { problem, selfCheck } from '../helpers/my-devices.mjs';
import { validateMeta } from '../helpers/device-library.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
// an unexpected throw is a failure with its message, not a stack trace
process.on('uncaughtException', (e) => { console.log(`razer mouse: FAILED: ${e.message}`); process.exit(1); });
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

// ---- a simulated Razer mouse, from razer.md §2 and §3 ----
// tids: the transaction ids it answers (a wrong one gets 0x05, §2 "Rule of thumb"); perCmd: { 'cc/ii': [tids] } overrides
function simMouse({ tids = [0x1f], perCmd = {}, power = 'rechargeable', poll = 'rate2', lowBattery = true, idle = true, stages = true, wheel = false, lights = [], dongleLed = false } = {}) {
  const s = {
    fw: [3, 7], batteryRaw: 204, charging: 0, dpiX: 800, dpiY: 800, stages: [400, 800, 1600, 3200, 6400], stagesY: null, active: 2,
    pollClassic: 0x01, pollRate2: 0x08, idle: 300, lowBat: 0x12,
    scrollMode: 0, scrollAccel: 0, smartReel: 1, dongleLed: 1, bright: Object.fromEntries(lights.map((id) => [id, 0xb4])),
  };
  const sim = { s, sent: [], reads: 0, bad: [], busyNext: 0, failNext: false, asleep: false, staleNext: false, reply: new Uint8Array(90) };
  // its own CRC: XOR of bytes 2..87 (§2, razer_calculate_crc)
  const simCrc = (r) => { let c = 0; for (let i = 2; i < 88; i++) c ^= r[i]; return c; };
  const be = (n) => [(n >> 8) & 0xff, n & 0xff];
  const answer = (q) => {
    const cls = q[6], id = q[7], a = q.slice(8, 88), key = `${cls.toString(16).padStart(2, '0')}/${id.toString(16).padStart(2, '0')}`;
    const r = new Uint8Array(90); r.set(q.slice(0, 8));
    const ok = (args = []) => { r[0] = 0x02; r.set(args, 8); };
    const allowed = perCmd[key] || tids;
    if (sim.asleep) r[0] = 0x04;
    else if (!allowed.includes(q[1])) r[0] = 0x05;
    else if (sim.failNext) { sim.failNext = false; r[0] = 0x03; }
    else {
      switch (key) {
        case '00/81': ok(s.fw); break;                                                   // firmware
        case '07/80': if (power) ok([0, s.batteryRaw]); else r[0] = 0x05; break;          // battery level, [1]
        case '07/84': if (power === 'rechargeable') ok([0, s.charging]); else r[0] = 0x05; break;
        case '04/85': ok([a[0], ...be(s.dpiX), ...be(s.dpiY), 0, 0]); break;              // DPI get
        case '04/05':                                                                    // DPI set, size 7, VARSTORE
          if (q[5] !== 0x07 || a[0] !== 0x01) { r[0] = 0x03; break; }
          s.dpiX = (a[1] << 8) | a[2]; s.dpiY = (a[3] << 8) | a[4]; ok(a.slice(0, 7)); break;
        case '04/86': {                                                                  // DPI stages get
          if (!stages) { r[0] = 0x05; break; }
          const b = [0x01, s.active, s.stages.length];
          s.stages.forEach((d, i) => b.push(i + 1, ...be(d), ...be(s.stagesY ? s.stagesY[i] : d), 0, 0));
          ok(b); break;
        }
        case '04/06': {                                                                  // DPI stages set, size 0x26, VARSTORE
          if (!stages) { r[0] = 0x05; break; }
          const count = a[2], act = a[1];
          if (q[5] !== 0x26 || a[0] !== 0x01 || count !== s.stages.length || act < 1 || act > count) { r[0] = 0x03; break; }
          const nv = [], ny = [];
          for (let i = 0; i < count; i++) { const o = 3 + 7 * i, x = (a[o + 1] << 8) | a[o + 2], y = (a[o + 3] << 8) | a[o + 4]; if (a[o] !== i + 1 || (x !== y && !s.stagesY) || x < 100 || x > 45000) { r[0] = 0x03; break; } nv.push(x); ny.push(y); }
          if (r[0] === 0x03) break;
          s.stages = nv; if (s.stagesY) s.stagesY = ny; s.active = act; ok(a.slice(0, 0x26)); break;
        }
        case '02/94': if (wheel) ok([0x01, s.scrollMode]); else r[0] = 0x05; break;       // scroll mode get (read only)
        case '02/96': if (wheel) ok([0x01, s.scrollAccel]); else r[0] = 0x05; break;      // scroll acceleration get
        case '02/16': if (!wheel) r[0] = 0x05; else if (q[5] !== 0x02 || a[0] !== 0x01 || a[1] > 1) r[0] = 0x03; else { s.scrollAccel = a[1]; ok([a[0], a[1]]); } break;
        case '02/97': if (wheel) ok([0x01, s.smartReel]); else r[0] = 0x05; break;        // smart reel get
        case '02/17': if (!wheel) r[0] = 0x05; else if (q[5] !== 0x02 || a[0] !== 0x01 || a[1] > 1) r[0] = 0x03; else { s.smartReel = a[1]; ok([a[0], a[1]]); } break;
        case '07/90': if (dongleLed) ok([s.dongleLed]); else r[0] = 0x05; break;          // dongle indicator LED get
        case '07/10': if (!dongleLed) r[0] = 0x05; else if (q[5] !== 0x01 || a[0] < 1 || a[0] > 3) r[0] = 0x03; else { s.dongleLed = a[0]; ok([a[0]]); } break;
        case '0f/84': if (lights.includes(a[1])) ok([a[0], a[1], s.bright[a[1]]]); else r[0] = 0x05; break;   // extended brightness get
        case '0f/04': if (!lights.includes(a[1])) r[0] = 0x05; else if (q[5] !== 0x03 || a[0] !== 0x01) r[0] = 0x03; else { s.bright[a[1]] = a[2]; ok([a[0], a[1], a[2]]); } break;
        case '00/85': if (poll === 'classic') ok([s.pollClassic]); else r[0] = 0x05; break;
        case '00/05': if (poll === 'classic' && [0x01, 0x02, 0x08].includes(a[0])) { s.pollClassic = a[0]; ok([a[0]]); } else r[0] = poll === 'classic' ? 0x03 : 0x05; break;
        case '00/c0': if (poll === 'rate2') ok([0x00, s.pollRate2]); else r[0] = 0x05; break;
        case '00/40':
          if (poll !== 'rate2') { r[0] = 0x05; break; }
          if (q[5] !== 0x02 || ![0x00, 0x01].includes(a[0]) || ![0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40].includes(a[1])) { r[0] = 0x03; break; }
          s.pollRate2 = a[1]; ok([a[0], a[1]]); break;
        case '07/83': if (idle && power) ok(be(s.idle)); else r[0] = 0x05; break;
        case '07/03': { const v = (a[0] << 8) | a[1]; if (!(idle && power)) r[0] = 0x05; else if (v < 60 || v > 900) r[0] = 0x03; else { s.idle = v; ok([a[0], a[1]]); } break; }
        case '07/81': if (lowBattery && power) ok([s.lowBat]); else r[0] = 0x05; break;
        case '07/01': if (!(lowBattery && power)) r[0] = 0x05; else if (a[0] < 0x0c || a[0] > 0x3f) r[0] = 0x03; else { s.lowBat = a[0]; ok([a[0]]); } break;
        default: r[0] = 0x05;
      }
    }
    r[88] = simCrc(r);
    return r;
  };
  sim.dev = {
    async sendFeatureReport(id, data) {
      const q = Uint8Array.from(data);
      if (id !== 0) sim.bad.push(`report id ${id}, not 0`);
      if (q.length !== 90) sim.bad.push(`report of ${q.length} bytes, not 90`);
      if (q[0] !== 0x00 || q[2] !== 0 || q[3] !== 0 || q[4] !== 0 || q[89] !== 0) sim.bad.push(`header not status 0 / remaining 0 / protocol 0 / reserved 0: ${hex(q.slice(0, 8))}`);
      if (q[5] > 80) sim.bad.push('data size over 80');
      if (simCrc(q) !== q[88]) sim.bad.push(`bad crc ${q[88]} on ${hex(q.slice(0, 8))}`);
      sim.sent.push({ tid: q[1], cls: q[6], id: q[7], size: q[5], args: [...q.slice(8, 8 + q[5])], bytes: q });
      sim.reply = answer(q);
      sim.busyLeft = sim.busyNext; sim.busyNext = 0;
      sim.staleLeft = sim.staleNext; sim.staleNext = false;
    },
    async receiveFeatureReport(id, len) {
      sim.reads++;
      if (id !== 0 || len !== 90) sim.bad.push(`receive id ${id} length ${len}`);
      let r = sim.reply;
      if (sim.staleLeft) { sim.staleLeft = false; r = new Uint8Array(90); r.set(sim.reply.slice(0, 8)); r[0] = 0x02; r[6] ^= 0x01; r[88] = simCrc(r); }   // another command's reply (zero arguments)
      else if (sim.busyLeft > 0) { sim.busyLeft--; r = Uint8Array.from(r); r[0] = 0x01; r[88] = simCrc(r); }
      return new DataView(Uint8Array.from(r).buffer);
    },
  };
  return sim;
}

const sleeps = [];
const fastSleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
function driverOn(pid, simOpts) {
  const sim = simMouse(simOpts);
  sim.app = null; sim.appChecks = 0; sim.clock = 1;
  const d = createRazerMouse({ sleep: fastSleep, open: async (p) => (p === pid ? sim.dev : null), vendorApp: async () => { sim.appChecks++; return sim.app; }, now: () => sim.clock });
  return { d, sim };
}
const cmdKey = (r) => `${r.cls.toString(16).padStart(2, '0')}/${r.id.toString(16).padStart(2, '0')}`;
const SHEET_CMDS = new Set(['00/81', '07/80', '07/84', '04/85', '04/05', '04/86', '04/06', '00/85', '00/05', '00/c0', '00/40', '07/83', '07/03', '07/81', '07/01',
  '02/94', '02/96', '02/16', '02/97', '02/17', '07/90', '07/10', '0f/84', '0f/04']);
const allSims = [];

// ---- 1. the report, byte for byte against the sheet (razer.md §2), typed out by hand ----
const lit = (head, crcByte) => { const r = new Uint8Array(90); r.set(head); r[88] = crcByte; return hex(r); };
// firmware get, tid 1F: status 00, tid 1F, remaining 00 00, protocol 00, size 02, class 00, id 81; crc 02^00^81 = 83
check(hex(buildReport(0x1f, 0x00, 0x81, 0x02)) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x00, 0x81], 0x83), 'firmware get bytes');
// battery get, tid 1F: size 02 class 07 id 80; crc 02^07^80 = 85
check(hex(buildReport(0x1f, 0x07, 0x80, 0x02)) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x07, 0x80], 0x85), 'battery get bytes');
// DPI set 800 x 800 VARSTORE: size 07 class 04 id 05, args 01 03 20 03 20 00 00; crc 07^04^05^01^03^20^03^20 = 07
check(hex(buildReport(0x1f, 0x04, 0x05, 0x07, [0x01, 0x03, 0x20, 0x03, 0x20, 0x00, 0x00])) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x07, 0x04, 0x05, 0x01, 0x03, 0x20, 0x03, 0x20], 0x07), 'DPI 800 set bytes');
// idle set 300 s = 01 2C: size 02 class 07 id 03; crc 02^07^03^01^2C = 2B
check(hex(buildReport(0x3f, 0x07, 0x03, 0x02, [0x01, 0x2c])) === lit([0x00, 0x3f, 0x00, 0x00, 0x00, 0x02, 0x07, 0x03, 0x01, 0x2c], 0x2b), 'idle 300 s set bytes (tid 3F)');
// the CRC ignores bytes 0, 1, 88 and 89
const junk = buildReport(0xff, 0x00, 0x81, 0x02); junk[0] = 0x02; junk[89] = 0x55;
check(crc(junk) === 0x83, 'crc leaves out bytes 0, 1 and 89');
const edges = new Uint8Array(90); edges[2] = 0x10; edges[87] = 0x01; edges[88] = 0x77;
check(crc(edges) === 0x11, 'crc takes byte 2 and byte 87, leaves out 88');
check(buildReport(0x1f, 0, 0x81, 2).length === 90, 'the report is 90 bytes');

// ---- 2. DeathAdder V3 Pro on its dongle (00B7): sheet tid 1F, wait 31 ms; read, write, read back, restore ----
{
  const { d, sim } = driverOn('00B7', { poll: 'rate2' }); allSims.push(sim);
  check(problem(d) === null, `the driver has the my-devices shape (${problem(d)})`);
  sleeps.length = 0;
  check(await d.connect() === true, 'connect finds the simulated 00B7');
  check(sim.sent.length === 0, 'connect sends nothing');
  const info = await d.info();
  check(info.Model === 'Razer DeathAdder V3 Pro' && info.Firmware === '3.7' && /0x1f \(from the brand sheet\)/.test(info['Transaction id']), `info: ${JSON.stringify(info)}`);
  check(info['DPI stages'] === '400, 800, 1600, 3200, 6400 (stage 2 of 5 active)', `DPI stages read: ${info['DPI stages']}`);
  check(sleeps[0] === 31, `waits 31 ms after a write (RAZER_NEW_MOUSE_RECEIVER_WAIT_US), waited ${sleeps[0]}`);
  check(sim.sent[0].tid === 0x1f && cmdKey(sim.sent[0]) === '00/81', 'first request is the firmware probe with tid 1F');
  const v = await d.read();
  check(v.dpi === 800 && v.pollingRate === 1000 && v.idle === 300 && v.lowBattery === 0x12, `reads: ${JSON.stringify(v)}`);
  check(d.pollKind === 'rate2', 'polling found as HyperPolling by a read (00/C0)');
  const bat = await d.battery();
  check(bat.percent === 80 && bat.charging === false, `battery 204/255 = 80 %, not charging: ${JSON.stringify(bat)}`);
  check(sim.sent.every((r) => r.id & 0x80), 'everything before the first write is a read (id bit 7 set)');
  const keys = d.settings.map((s) => s.key);
  check(keys.join() === 'dpi,pollingRate,idle,lowBattery,dpiStage,dpiStage1,dpiStage2,dpiStage3,dpiStage4,dpiStage5', `settings: ${keys}`);
  check(!sim.sent.some((r) => ['0f/84', '02/96', '02/97', '07/90'].includes(cmdKey(r))), 'DeathAdder V3 Pro: no lighting (sheet), no wheel or dongle-light reads');
  check(d.settings.find((s) => s.key === 'dpi').max === 30000, 'DPI slider tops out at the model maximum');
  check(d.settings.find((s) => s.key === 'pollingRate').options.map((o) => o.value).join() === '125,250,500,1000,2000,4000,8000', 'HyperPolling choices 125-8000 Hz');

  // DPI 800 -> 1600 -> 800
  let n = sim.sent.length;
  check(await d.write('dpi', 1600) === 1600 && sim.s.dpiX === 1600 && sim.s.dpiY === 1600, 'DPI 800 -> 1600 lands, read back');
  const dpiSet = sim.sent.slice(n).find((r) => cmdKey(r) === '04/05');
  check(hex(dpiSet.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x07, 0x04, 0x05, 0x01, 0x06, 0x40, 0x06, 0x40], 0x07), `DPI 1600 set bytes: ${hex(dpiSet.bytes.slice(0, 16))} crc ${dpiSet.bytes[88].toString(16)}`);
  check(await d.write('dpi', 800) === 800 && sim.s.dpiX === 800, 'DPI put back to 800');

  // polling 1000 -> 4000 -> 1000: two sets, [0] = 00 then 01 (razer.md §3 rate2)
  n = sim.sent.length;
  check(await d.write('pollingRate', 4000) === 4000 && sim.s.pollRate2 === 0x02, 'polling 1000 -> 4000 lands as code 02');
  const ps = sim.sent.slice(n).filter((r) => cmdKey(r) === '00/40');
  check(ps.length === 2 && hex(ps[0].bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x00, 0x40, 0x00, 0x02], 0x40) && hex(ps[1].bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x00, 0x40, 0x01, 0x02], 0x41), 'rate2 set sent twice, [0] = 00 then 01, tid 1F both');
  check(await d.write('pollingRate', '1000') === 1000 && sim.s.pollRate2 === 0x08, 'polling put back to 1000 (value given as text)');

  // idle 300 -> 600 -> 300; low battery 0x12 -> 0x20 -> 0x12
  n = sim.sent.length;
  check(await d.write('idle', 600) === 600 && sim.s.idle === 600, 'sleep timer 300 -> 600 s');
  const is = sim.sent.slice(n).find((r) => cmdKey(r) === '07/03');
  check(hex(is.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x07, 0x03, 0x02, 0x58], 0x02 ^ 0x07 ^ 0x03 ^ 0x02 ^ 0x58), 'idle 600 set bytes (02 58)');
  check(await d.write('idle', 300) === 300, 'sleep timer put back');
  check(await d.write('lowBattery', 0x20) === 0x20 && sim.s.lowBat === 0x20, 'low-battery 0x12 -> 0x20');
  check(await d.write('lowBattery', 0x12) === 0x12, 'low-battery put back');

  // busy, busy, then success: the driver reads again 10 ms apart and takes the answer
  sim.s.dpiX = sim.s.dpiY = 1200; sim.busyNext = 2; const r0 = sim.reads; sleeps.length = 0;
  const vb = await d.read();
  check(vb.dpi === 1200, `busy then success: DPI read as ${vb.dpi}`);
  check(sleeps.slice(0, 3).join() === '31,10,10', `busy: waited ${sleeps.slice(0, 3).join(', ')} ms`);
  check(sim.reads - r0 >= 3 + 3, 'busy: the DPI reply was read three times');
  sim.s.dpiX = sim.s.dpiY = 800;
  // another command's reply in the buffer is not taken as this one's
  sim.staleNext = true;
  check((await d.read()).dpi === 800, 'a reply for another command is skipped');
  // stuck busy: reported, not taken
  sim.busyNext = 50;
  check(await rejects(() => d.read(), /no reply/), 'busy for more than ~100 ms: no reply');

  // failure 0x03: the write is reported as refused
  sim.failNext = true;
  check(await rejects(() => d.write('dpi', 1000), /refused/), 'status 03 failure: write reported as refused');
  check(sim.s.dpiX === 800, 'nothing changed after the refused write');

  // values refused before anything is sent
  const refused = async (key, value, why) => { const b = sim.sent.length; check(await rejects(() => d.write(key, value)) && sim.sent.length === b, `${why}: refused, nothing sent`); };
  await refused('dpi', 50, 'DPI 50'); await refused('dpi', 30050, 'DPI over the model maximum'); await refused('dpi', 800.5, 'DPI 800.5');
  await refused('pollingRate', 3000, 'polling 3000 Hz'); await refused('pollingRate', 'toString', 'polling "toString"');
  await refused('idle', 30, 'idle 30 s'); await refused('idle', 1000, 'idle 1000 s');
  await refused('lowBattery', 5, 'low battery 5'); await refused('lowBattery', 64, 'low battery 64');
  await refused('firmware', 1, 'key "firmware"'); await refused('__proto__', 1, 'key "__proto__"'); await refused('deviceMode', 3, 'device mode');

  // asleep (status 04 through the dongle): the error says so, which DeviceHub shows as asleep
  sim.asleep = true;
  check(await rejects(() => d.read(), /asleep|out of range|no reply/i), 'status 04: reported as asleep');
  sim.asleep = false;
  const bk = await d.rawBackup();
  check(bk.pid === '00B7' && bk.tid === 0x1f && bk.replies.dpi && bk.replies.firmware, 'raw backup holds the replies');
}

// ---- 3. a wired-only mouse: DeathAdder V3 (00B2): rate2 from the sheet, no battery, no idle ----
{
  const { d, sim } = driverOn('00B2', { power: null, poll: 'rate2' }); allSims.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.dpi === 800 && v.pollingRate === 1000 && !('idle' in v), `DeathAdder V3: ${JSON.stringify(v)}`);
  check(!sim.sent.some((r) => ['00/85', '07/80', '07/83', '07/81'].includes(cmdKey(r))), 'DeathAdder V3: no classic polling, battery or idle reads (the sheet says rate2; wired only)');
  check(await d.battery() === null, 'DeathAdder V3: no battery');
  check(d.settings.map((s) => s.key).join() === 'dpi,pollingRate,dpiStage,dpiStage1,dpiStage2,dpiStage3,dpiStage4,dpiStage5', `DeathAdder V3 settings: ${d.settings.map((s) => s.key)}`);
  check(sim.sent.filter((r) => cmdKey(r) === '0f/84').map((r) => r.args[1]).join() === '1,4,16,17,0', 'DeathAdder V3: brightness asked (reads) for wheel, logo, right, left, then the whole mouse; none answered, so no lighting setting');
}

// ---- 4. Viper V3 Pro wired (00C0): classic polling from the sheet ----
{
  const { d, sim } = driverOn('00C0', { poll: 'classic' }); allSims.push(sim);
  await d.connect(); sleeps.length = 0;
  const v = await d.read();
  check(v.pollingRate === 1000 && d.pollKind === 'classic', 'Viper V3 Pro wired: classic polling');
  check(d.settings.find((s) => s.key === 'pollingRate').options.map((o) => o.value).join() === '125,500,1000', 'classic choices 125, 500, 1000');
  const n = sim.sent.length;
  check(await d.write('pollingRate', 500) === 500 && sim.s.pollClassic === 0x02, 'classic polling 1000 -> 500 lands as code 02');
  const s = sim.sent.slice(n).find((r) => cmdKey(r) === '00/05');
  check(hex(s.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x01, 0x00, 0x05, 0x02], 0x01 ^ 0x05 ^ 0x02), 'classic set bytes');
  check(await d.write('pollingRate', 1000) === 1000, 'classic polling put back');
  check(await rejects(() => d.write('pollingRate', 8000)), 'classic mouse: 8000 Hz refused');
}

// ---- 5. transaction id not in the sheet: found with reads only, in the order 1F, 3F, FF ----
for (const [pid, tid, tried] of [['00A8', 0x3f, '1f,3f'], ['00DB', 0xff, '1f,3f,ff'], ['00DF', 0x1f, '1f']]) {
  const { d, sim } = driverOn(pid, { tids: [tid] }); allSims.push(sim);
  await d.connect();
  const info = await d.info();
  const probes = sim.sent.slice(0, tried.split(',').length);
  check(probes.every((r) => cmdKey(r) === '00/81') && probes.map((r) => r.tid.toString(16)).join() === tried, `${MODELS[pid].model} ${pid}: probed ${probes.map((r) => r.tid.toString(16))} with firmware reads`);
  check(d.tid === tid && /found by reads/.test(info['Transaction id']), `${pid}: transaction id ${tid.toString(16)} found by reads`);
  check(sim.sent.every((r) => r.id & 0x80), `${pid}: only reads were sent while learning`);
  check(sim.sent.slice(tried.split(',').length).every((r) => r.tid === tid), `${pid}: every later request uses the found id`);
}
{
  const { d, sim } = driverOn('00A8', { tids: [0x42] }); allSims.push(sim);
  await d.connect();
  check(await rejects(() => d.read(), /no transaction id answered/), 'no id answers: reported, nothing written');
  check(sim.sent.length === 3 && sim.sent.every((r) => cmdKey(r) === '00/81'), 'no id answers: three firmware reads only');
}

// ---- 6. HyperPolling dongle (00B3): wait 59.9 ms; second poll write with tid FF ----
{
  const { d, sim } = driverOn('00B3', { tids: [0x1f], perCmd: { '00/40': [0x1f, 0xff] } }); allSims.push(sim);
  await d.connect(); sleeps.length = 0;
  await d.read();
  check(sleeps[0] === 59.9, `dongle waits 59.9 ms (RAZER_VIPER_MOUSE_RECEIVER_WAIT_US), waited ${sleeps[0]}`);
  const n = sim.sent.length;
  check(await d.write('pollingRate', 8000) === 8000 && sim.s.pollRate2 === 0x01, 'dongle polling -> 8000 lands as code 01');
  const ps = sim.sent.slice(n).filter((r) => cmdKey(r) === '00/40');
  check(ps.length === 2 && ps[0].tid === 0x1f && ps[0].args.join() === '0,1' && ps[1].tid === 0xff && ps[1].args.join() === '1,1', 'dongle: first poll write tid 1F [00 01], second tid FF [01 01]');
  check(await d.write('pollingRate', 1000) === 1000, 'dongle polling put back');
}

// ---- 7. Basilisk V3 Pro (00AB): the low-battery threshold uses tid FF ----
{
  const { d, sim } = driverOn('00AB', { tids: [0x1f], perCmd: { '07/81': [0xff], '07/01': [0xff] } }); allSims.push(sim);
  await d.connect();
  const v = await d.read();
  check(v.lowBattery === 0x12, 'Basilisk V3 Pro: low-battery threshold read with tid FF');
  check(sim.sent.filter((r) => cmdKey(r) === '07/81').every((r) => r.tid === 0xff), 'Basilisk V3 Pro: threshold reads use FF');
  check(await d.write('lowBattery', 0x0c) === 0x0c && await d.write('lowBattery', 0x12) === 0x12, 'Basilisk V3 Pro: threshold written and put back with FF');
}

// ---- 8. AA mouse (Basilisk V3 X HyperSpeed 00B9): no charging read ----
{
  const { d, sim } = driverOn('00B9', { power: 'aa', tids: [0x1f] }); allSims.push(sim);
  await d.connect();
  const b = await d.battery();
  check(b.percent === 80 && b.charging === false && !sim.sent.some((r) => cmdKey(r) === '07/84'), 'AA mouse: level read, charging not asked');
}

// ---- 8b. the settings added 22 Oct 2026: each written, read back, put back; out-of-range and maker's-app refusals ----
const roundTrip = async (d, sim, key, to, label) => {
  const was = (await d.read())[key];
  check(was !== undefined && was !== to, `${label}: read first (${was})`);
  check(await d.write(key, to) === to && (await d.read())[key] === to, `${label}: ${was} -> ${to} lands, read back`);
  check(await d.write(key, was) === was && (await d.read())[key] === was, `${label}: put back to ${was}`);
  return was;
};
const refusedOn = async (d, sim, key, value, why) => { const b = sim.sent.length; check(await rejects(() => d.write(key, value)) && sim.sent.length === b, `${why}: refused, nothing sent`); };
{
  // Basilisk V3 Pro on its dongle: stages, wheel, lighting on wheel + logo
  const { d, sim } = driverOn('00AB', { tids: [0x1f], perCmd: { '07/81': [0xff], '07/01': [0xff] }, wheel: true, lights: [0x01, 0x04] }); allSims.push(sim);
  await d.connect();
  await d.read();
  const keys = d.settings.map((s) => s.key);
  for (const k of ['dpiStage', 'dpiStage1', 'dpiStage5', 'scrollAccel', 'smartReel', 'brightnessWheel', 'brightnessLogo']) check(keys.includes(k), `Basilisk V3 Pro has ${k}`);
  check(!keys.includes('brightnessRight') && !keys.includes('brightnessAll') && !keys.includes('dongleLed') && !keys.includes('scrollMode'), `Basilisk V3 Pro: only zones that answered, scroll mode not a setting (${keys})`);
  check(d.settings.find((s) => s.key === 'dpiStage').max === 5, 'active stage slider is 1-5 (the count read)');
  check(problem(d) === null, `the driver with every new setting has the my-devices shape (${problem(d)})`);
  const info = await d.info();
  check(info['Scroll mode (raw, values not documented)'] === 0, `scroll mode shown raw: ${JSON.stringify(info)}`);

  // active stage 2 -> 4 -> 2: the table goes back whole, only [1] changed, [0] = VARSTORE, size 0x26
  let n = sim.sent.length;
  await roundTrip(d, sim, 'dpiStage', 4, 'active DPI stage');
  const st = sim.sent.slice(n).filter((r) => cmdKey(r) === '04/06');
  const want = (act, s3) => [0x01, act, 5, 1, 0x01, 0x90, 0x01, 0x90, 0, 0, 2, 0x03, 0x20, 0x03, 0x20, 0, 0, 3, s3 >> 8, s3 & 0xff, s3 >> 8, s3 & 0xff, 0, 0, 4, 0x0c, 0x80, 0x0c, 0x80, 0, 0, 5, 0x19, 0x00, 0x19, 0x00, 0, 0];
  check(st.length === 2 && st[0].size === 0x26 && st[0].args.join() === want(4, 1600).join() && st[1].args.join() === want(2, 1600).join(), `stage table set bytes: ${st[0] && hex(st[0].args)}`);
  check(sim.s.active === 2 && sim.s.stages.join() === '400,800,1600,3200,6400', 'stage table as it started');
  // stage 3 DPI 1600 -> 2400 -> 1600: X and Y both, the other stages untouched
  n = sim.sent.length;
  await roundTrip(d, sim, 'dpiStage3', 2400, 'DPI stage 3');
  const s3 = sim.sent.slice(n).filter((r) => cmdKey(r) === '04/06');
  check(s3[0].args.join() === want(2, 2400).join(), `stage 3 set bytes: ${hex(s3[0].args)}`);
  check(sim.s.stages.join() === '400,800,1600,3200,6400', 'every stage as it started');
  // toggles and brightness
  await roundTrip(d, sim, 'scrollAccel', true, 'scroll acceleration');
  n = sim.sent.length; await d.write('smartReel', false);
  const sr = sim.sent.slice(n).find((r) => cmdKey(r) === '02/17');
  check(hex(sr.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x02, 0x02, 0x17, 0x01, 0x00], 0x02 ^ 0x02 ^ 0x17 ^ 0x01), 'smart reel off bytes (02/17, 01 00)');
  check(await d.write('smartReel', true) === true && sim.s.smartReel === 1, 'smart reel put back on');
  n = sim.sent.length;
  await roundTrip(d, sim, 'brightnessLogo', 0x40, 'logo brightness');
  const br = sim.sent.slice(n).find((r) => cmdKey(r) === '0f/04');
  check(hex(br.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x03, 0x0f, 0x04, 0x01, 0x04, 0x40], 0x03 ^ 0x0f ^ 0x04 ^ 0x01 ^ 0x04 ^ 0x40), 'logo brightness set bytes (0F/04, 01 04 40)');
  await roundTrip(d, sim, 'brightnessWheel', 0, 'wheel brightness');
  check(sim.s.bright[1] === 0xb4 && sim.s.bright[4] === 0xb4, 'both zones as they started');

  // out of range: refused before anything is sent
  await refusedOn(d, sim, 'dpiStage', 0, 'active stage 0'); await refusedOn(d, sim, 'dpiStage', 6, 'active stage 6');
  await refusedOn(d, sim, 'dpiStage1', 50, 'stage DPI 50'); await refusedOn(d, sim, 'dpiStage2', 30050, 'stage DPI over the model maximum');
  await refusedOn(d, sim, 'scrollAccel', 1, 'scroll acceleration 1 (not a boolean)'); await refusedOn(d, sim, 'smartReel', 'yes', 'smart reel "yes"');
  await refusedOn(d, sim, 'brightnessLogo', 256, 'brightness 256'); await refusedOn(d, sim, 'brightnessLogo', -1, 'brightness -1');
  await refusedOn(d, sim, 'brightnessRight', 10, 'a zone that did not answer'); await refusedOn(d, sim, 'scrollMode', 1, 'scroll mode (read only)');
  await refusedOn(d, sim, 'dongleLed', 1, 'dongle light on a mouse');

  // Synapse running: no write of any kind; checked again after 15 s
  sim.app = 'Razer Synapse.exe'; sim.clock += 20000;
  for (const [k, v] of [['dpi', 1600], ['dpiStage', 3], ['dpiStage1', 500], ['scrollAccel', true], ['smartReel', false], ['brightnessLogo', 10], ['lowBattery', 0x20]]) {
    const b = sim.sent.filter((r) => !(r.id & 0x80)).length;
    check(await rejects(() => d.write(k, v), /Razer Synapse\.exe is running/) && sim.sent.filter((r) => !(r.id & 0x80)).length === b, `${k} while Synapse runs: refused, nothing written`);
  }
  sim.app = null; sim.clock += 1000;
  check(await rejects(() => d.write('dpi', 1600), /running/), 'Synapse seen less than 15 s ago: still refused');
  sim.clock += 20000;
  check(await d.write('dpi', 1600) === 1600 && await d.write('dpi', 800) === 800, 'after Synapse closed: written and put back');

  // the stage table changing count under us (Synapse elsewhere): reported, not written
  sim.s.stages = [400, 800, 1600]; sim.s.active = 1;
  const b = sim.sent.filter((r) => cmdKey(r) === '04/06').length;
  check(await rejects(() => d.write('dpiStage1', 500), /DPI stages/) && sim.sent.filter((r) => cmdKey(r) === '04/06').length === b, 'stage count changed: refused, nothing written');
}
{
  // a mouse whose stage table holds more than the documented size: shown, never written
  const { d, sim } = driverOn('00AA', { tids: [0x1f], perCmd: { '07/81': [0xff], '07/01': [0xff] } }); allSims.push(sim);
  sim.s.stages = [400, 800, 1600, 3200, 6400, 12800]; sim.s.active = 1;
  await d.connect();
  await d.read();
  check(!d.settings.some((s) => /^dpiStage/.test(s.key)), 'six stages (over 0x26 bytes): no stage settings');
  check(await rejects(() => d.write('dpiStage', 2)), 'six stages: active stage refused');
}
{
  // one-stage table: no active-stage slider (a slider needs max > min), its one stage still writable
  const { d, sim } = driverOn('00C5', { tids: [0x1f] }); allSims.push(sim);
  sim.s.stages = [800]; sim.s.active = 1;
  await d.connect();
  await d.read();
  const keys = d.settings.map((s) => s.key);
  check(!keys.includes('dpiStage') && keys.includes('dpiStage1') && !keys.includes('dpiStage2'), `one stage: ${keys}`);
  await roundTrip(d, sim, 'dpiStage1', 1200, 'single DPI stage');
}
{
  // HyperPolling dongle: the indicator light
  const { d, sim } = driverOn('00B3', { tids: [0x1f], perCmd: { '00/40': [0x1f, 0xff] }, dongleLed: true }); allSims.push(sim);
  await d.connect();
  await d.read();
  check(d.settings.find((s) => s.key === 'dongleLed')?.options.map((o) => o.value).join() === '1,2,3', 'dongle light: connection, battery, battery warning');
  check(!sim.sent.some((r) => cmdKey(r) === '0f/84'), 'dongle: no brightness reads');
  const n = sim.sent.length;
  await roundTrip(d, sim, 'dongleLed', 3, 'dongle light');
  const dl = sim.sent.slice(n).find((r) => cmdKey(r) === '07/10');
  check(hex(dl.bytes) === lit([0x00, 0x1f, 0x00, 0x00, 0x00, 0x01, 0x07, 0x10, 0x03], 0x01 ^ 0x07 ^ 0x10 ^ 0x03), 'dongle light set bytes (07/10, 03)');
  await refusedOn(d, sim, 'dongleLed', 0, 'dongle light 0'); await refusedOn(d, sim, 'dongleLed', 4, 'dongle light 4');
  sim.app = 'RazerAppEngine.exe'; sim.clock += 20000;
  check(await rejects(() => d.write('dongleLed', 2), /RazerAppEngine/) && sim.s.dongleLed === 1, 'dongle light while Razer App Engine runs: refused');
}
{
  // a lit mouse with no named zone: whole-mouse brightness (LED 0x00)
  const { d, sim } = driverOn('00A3', { tids: [0xff], lights: [0x00] }); allSims.push(sim);
  await d.connect();
  await d.read();
  check(d.settings.some((s) => s.key === 'brightnessAll'), 'Cobra: whole-mouse brightness when no zone answers');
  await roundTrip(d, sim, 'brightnessAll', 0xff, 'whole-mouse brightness');
}
check(allSims.every((s) => s.appChecks >= 0), 'vendor-app check injected (no tasklist in the test)');

// ---- 8c. driver safety (22 Oct 2026): a write-back of the value just read leaves every raw value as it was; reads go on
// while Synapse runs, writes do not ----
{
  const { d, sim } = driverOn('00AB', { tids: [0x1f], perCmd: { '07/81': [0xff], '07/01': [0xff] }, wheel: true, lights: [0x04] }); allSims.push(sim);
  sim.s.dpiX = 1600; sim.s.dpiY = 800;                                     // separate X / Y, as Synapse can set them
  sim.s.stagesY = [400, 800, 1200, 3200, 6400];                             // stage 3: X 1600, Y 1200
  await d.connect();
  let v = await d.read();
  check(v.dpi === 1600 && v.dpiY === 800 && v.dpiStage3 === 1600 && v.dpiStage3Y === 1200, `separate X / Y read (${JSON.stringify(v)})`);
  // the library self-check: each setting written with the value just read
  const before = JSON.stringify(sim.s), n = sim.sent.length;
  const r = await selfCheck(d, d.write, { backup: async () => true, makerApp: async () => null });
  check(r.keys?.dpi?.ok && r.keys?.dpiStage3?.ok && r.keys?.scrollAccel?.ok && r.keys?.smartReel?.ok && r.keys?.brightnessLogo?.ok, `self-check passes (${JSON.stringify(r.keys)})`);
  check(JSON.stringify(sim.s) === before, `the self-check left every raw value as it was (Y ${sim.s.dpiY}, stage 3 Y ${sim.s.stagesY[2]})`);
  const dpiSet = sim.sent.slice(n).find((x) => cmdKey(x) === '04/05');
  check(dpiSet && dpiSet.args.slice(1, 5).join() === [0x06, 0x40, 0x03, 0x20].join(), `the DPI write-back sent X 1600 and Y 800 as read (${dpiSet && hex(dpiSet.args)})`);
  const writes = sim.sent.slice(n).filter((x) => !(x.id & 0x80)).map(cmdKey);
  for (const c of ['04/05', '04/06', '02/16', '02/17', '0f/04']) check(writes.includes(c), `the self-check really sent ${c}`);
  // a new X with Y separate: only X changes
  check(await d.write('dpi', 2000) === 2000 && sim.s.dpiX === 2000 && sim.s.dpiY === 800, 'a new DPI X with a separate Y: Y stays as read');
  check(await d.write('dpi', 1600) === 1600 && sim.s.dpiY === 800, 'DPI put back');
  check(await d.write('dpiStage3', 2400) === 2400 && sim.s.stages[2] === 2400 && sim.s.stagesY[2] === 1200, 'a new stage X with a separate Y: Y stays as read');
  check(await d.write('dpiStage3', 1600) === 1600 && sim.s.stagesY[2] === 1200, 'stage put back');
  // a toggle whose raw byte is neither 0 nor 1 is not shown as on or off, so the self-check never writes it back as one
  sim.s.smartReel = 2;
  v = await d.read();
  check(v.smartReel === null, `raw smart reel 2 reads as not on / off (${v.smartReel})`);
  const m2 = sim.sent.length;
  const r2 = await selfCheck(d, d.write, { only: ['smartReel'], previous: r, backup: async () => true, makerApp: async () => null });
  check(!r2.keys?.smartReel?.ok && sim.s.smartReel === 2 && !sim.sent.slice(m2).some((x) => cmdKey(x) === '02/17'), `raw 2 is not written back as 0 or 1 (${JSON.stringify(r2.keys?.smartReel)})`);
  sim.s.smartReel = 1;
  // Synapse running: reads go on, writes (even of the same value) are refused and send nothing
  sim.app = 'Razer Synapse.exe'; sim.clock += 20000;
  v = await d.read();
  check(v.dpi === 1600 && v.smartReel === true, 'reads go on while Synapse runs');
  const w = sim.sent.filter((x) => !(x.id & 0x80)).length;
  check(await rejects(() => d.write('dpi', 1600), /Synapse/) && sim.sent.filter((x) => !(x.id & 0x80)).length === w, 'a same-value write is refused while Synapse runs, nothing written');
}

// ---- 8d. the models added 23 Oct 2026 from OpenRazer's driver: each on its own product id, with OpenRazer's transaction
// id per command (the simulated mouse answers 0x05 to any other), its DPI maximum, its battery kind and only the
// documented stage table and LED zones. Written by hand from razermouse_driver.c / mouse.py, not from the driver. ----
const FF = [0xff], X3F = [0x3f];
const ADDED = [
  // pid, model, base tid, perCmd tids, power, dpiMax, wait, stages, lights the sim has, lights the model documents
  ['006E', 'DeathAdder Essential', 0xff, { '0f/84': X3F, '0f/04': X3F }, null, 6400, 0.6, false, [0x01, 0x04, 0x10], [0x01, 0x04]],
  ['0071', 'DeathAdder Essential White Edition', 0xff, { '0f/84': X3F, '0f/04': X3F }, null, 6400, 0.6, false, [0x01, 0x04, 0x10], [0x01, 0x04]],
  ['0098', 'DeathAdder Essential (2021)', 0xff, { '0f/84': X3F, '0f/04': X3F }, null, 6400, 0.6, false, [0x01, 0x04], [0x04]],
  ['0084', 'DeathAdder V2', 0x3f, {}, null, 20000, 0.6, false, [0x01, 0x04, 0x11], [0x01, 0x04]],
  ['008C', 'DeathAdder V2 Mini', 0x3f, { '04/86': FF, '04/06': FF }, null, 8500, 0.6, true, [0x01, 0x04], [0x04]],
  ['007C', 'DeathAdder V2 Pro', 0x3f, { '04/86': FF, '04/06': FF, '07/83': FF, '07/03': FF, '07/81': FF, '07/01': FF }, 'rechargeable', 20000, 59.9, true, [0x04], [0x04]],
  ['007D', 'DeathAdder V2 Pro', 0x3f, { '04/86': FF, '04/06': FF, '07/83': FF, '07/03': FF, '07/81': FF, '07/01': FF }, 'rechargeable', 20000, 59.9, true, [0x04], [0x04]],
  ['009C', 'DeathAdder V2 X HyperSpeed', 0x1f, { '07/81': FF, '07/01': FF }, 'aa', 14000, 31, true, [0x04], []],
  ['00A5', 'Viper V2 Pro', 0x1f, { '07/81': FF, '07/01': FF }, 'rechargeable', 30000, 31, true, [0x04], []],
  ['00A6', 'Viper V2 Pro', 0x1f, { '07/81': FF, '07/01': FF }, 'rechargeable', 30000, 31, true, [0x04], []],
  ['00B8', 'Viper V3 HyperSpeed', 0x1f, {}, 'aa', 30000, 59.9, true, [0x04], []],
  ['00B4', 'Naga V2 HyperSpeed', 0x1f, { '07/01': FF }, 'aa', 30000, 31, true, [0x04], []],
];
for (const [pid, model, tid, perCmd, power, max, wait, stages, simLights, docLights] of ADDED) {
  const L = `${model} ${pid}`;
  check(PIDS.includes(pid) && MODELS[pid].model === model, `${L}: in the model table`);
  const { d, sim } = driverOn(pid, { tids: [tid], perCmd, power, poll: 'classic', lights: simLights }); allSims.push(sim);
  sleeps.length = 0;
  check(await d.connect() && d.pid === pid, `${L}: connects on its own product id`);
  const v = await d.read();
  check(d.tid === tid && /brand sheet/.test(d.tidHow), `${L}: transaction id ${tid.toString(16)} from the table (${d.tid?.toString(16)}, ${d.tidHow})`);
  check(sim.sent[0].tid === tid && cmdKey(sim.sent[0]) === '00/81', `${L}: the first report is a firmware read with tid ${tid.toString(16)}`);
  // every report used OpenRazer's id for its command; none was refused for a wrong id
  const wrong = sim.sent.filter((r) => !(perCmd[cmdKey(r)] || [tid]).includes(r.tid));
  check(!wrong.length, `${L}: each command with OpenRazer's tid (wrong: ${wrong.map((r) => `${cmdKey(r)}@${r.tid.toString(16)}`).join(', ')})`);
  check(sleeps.includes(wait), `${L}: waits ${wait} ms (${[...new Set(sleeps)]})`);
  check(v.dpi === 800 && v.pollingRate === 1000 && d.pollKind === 'classic', `${L}: DPI ${v.dpi} and classic polling ${v.pollingRate} read`);
  check(!sim.sent.some((r) => cmdKey(r) === '00/c0'), `${L}: HyperPolling never asked`);
  const keys = d.settings.map((s) => s.key);
  check(d.settings.find((s) => s.key === 'dpi').max === max, `${L}: DPI slider ends at ${max}`);
  check(await rejects(() => d.write('dpi', max + 50), new RegExp(`100-${max}`)), `${L}: DPI ${max + 50} refused (max ${max})`);
  // stage table: asked only where mouse.py lists get_dpi_stages
  check(stages ? keys.includes('dpiStage1') && v.dpiStage === 2 : !sim.sent.some((r) => cmdKey(r) === '04/86') && !keys.includes('dpiStage1'), `${L}: DPI stages ${stages ? 'read' : 'never asked'}`);
  // LED zones: only those documented for the model are asked
  const asked = [...new Set(sim.sent.filter((r) => cmdKey(r) === '0f/84').map((r) => r.args[1]))].sort();
  check(asked.join() === [...docLights].sort().join(), `${L}: brightness asked for ${asked} (documented ${docLights})`);
  // battery: none on a wired-only mouse, level only on AA, level and charging on a rechargeable one
  const b = await d.battery();
  if (!power) check(b === null && !keys.includes('idle') && !sim.sent.some((r) => r.cls === 0x07), `${L}: no battery, no class-07 command`);
  else {
    check(b.percent === 80 && b.charging === false, `${L}: battery 80% read (${JSON.stringify(b)})`);
    check(power === 'aa' ? !sim.sent.some((r) => cmdKey(r) === '07/84') : sim.sent.some((r) => cmdKey(r) === '07/84'), `${L}: charging ${power === 'aa' ? 'not asked (AA)' : 'read'}`);
    check(v.idle === 300 && v.lowBattery === 0x12, `${L}: idle ${v.idle} s and low-battery ${v.lowBattery} read`);
  }
  // writes (a simulated mouse only): DPI, and the commands with their own transaction id, each written, read back, put back
  await roundTrip(d, sim, 'dpi', Math.min(1600, max), `${L} DPI`);
  if (power) await roundTrip(d, sim, 'lowBattery', 0x0c, `${L} low battery`);
  if (power) await roundTrip(d, sim, 'idle', 600, `${L} idle`);
  if (stages) await roundTrip(d, sim, 'dpiStage', 3, `${L} active stage`);
  if (docLights.length) await roundTrip(d, sim, docLights.includes(0x04) ? 'brightnessLogo' : 'brightnessWheel', 0x40, `${L} brightness`);
  const wrong2 = sim.sent.filter((r) => !(perCmd[cmdKey(r)] || [tid]).includes(r.tid));
  check(!wrong2.length, `${L}: writes with OpenRazer's tid too (wrong: ${wrong2.map((r) => `${cmdKey(r)}@${r.tid.toString(16)}`).join(', ')})`);
}
// Naga V2 HyperSpeed reads the low-battery threshold with 1F and writes it with FF (rmd.c:3636 / 3803)
{
  const { d, sim } = driverOn('00B4', { tids: [0x1f], perCmd: { '07/01': [0xff] }, power: 'aa', poll: 'classic' }); allSims.push(sim);
  await d.connect();
  await d.write('lowBattery', 0x20);
  const rs = sim.sent.filter((r) => cmdKey(r) === '07/81'), ws = sim.sent.filter((r) => cmdKey(r) === '07/01');
  check(rs.length && rs.every((r) => r.tid === 0x1f) && ws.length === 1 && ws[0].tid === 0xff && sim.s.lowBat === 0x20, 'Naga V2 HyperSpeed: threshold read with 1F, written with FF');
}

// ---- 9. nothing outside the sheet, ever; every report well formed ----
const every = allSims.flatMap((s) => s.sent);
check(every.every((r) => SHEET_CMDS.has(cmdKey(r))), `only sheet commands were sent: ${[...new Set(every.map(cmdKey))].join(', ')}`);
check(allSims.every((s) => !s.bad.length), `reports well formed: ${allSims.flatMap((s) => s.bad).slice(0, 5).join('; ')}`);

// ---- 10. the library entry ----
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'razer-mouse', 'device.json'), 'utf8'));
check(meta.id === createRazerMouse().id && meta.vid === '1532' && meta.status === 'read-only' && Array.isArray(meta.tested) && meta.tested.length === 0 && meta.source === 'docs/brands/razer.md', 'device.json: id, vid 1532, read-only, tested [], source');
check(meta.pids.join() === PIDS.map((p) => p.toLowerCase()).join(), 'device.json pids = the driver\'s model table');
check(validateMeta({ ...meta, tested: [{ by: '-', date: '-', devicehub: '-' }] }) === null, `device.json is otherwise well formed (${validateMeta({ ...meta, tested: [{ by: '-', date: '-', devicehub: '-' }] })})`);
for (const want of ['DeathAdder V3', 'DeathAdder V3 Pro', 'DeathAdder V4 Pro', 'Viper V3 Pro', 'Basilisk V3', 'Basilisk V3 Pro', 'Cobra', 'Naga V2 Pro', 'HyperPolling Wireless Dongle', ...new Set(ADDED.map((r) => r[1]))]) check(meta.models.includes(want), `device.json lists ${want}`);
const src = fs.readFileSync(path.join(ROOT, 'device-library', 'razer-mouse', 'device.mjs'), 'utf8');
check(!/flash|bootloader|dfu|0x46|0x41, 0x42/i.test(src.replace(/^\/\/.*$/gm, '')), 'no flash, bootloader or pairing bytes in the driver code');

console.log(fails.length ? `razer mouse: FAILED: ${fails.join('; ')}` : 'razer mouse (simulated, 90-byte report): all good');
process.exitCode = fails.length ? 1 : 0;
