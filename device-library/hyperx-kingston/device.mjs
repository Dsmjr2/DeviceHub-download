// HyperX Cloud wireless headsets on Kingston-era dongles (vendor 0951): Cloud II Wireless (Kingston) and Cloud Flight
// Wireless. Written 23 Oct 2026 from docs/brands/hyperx.md and its two sources, HeadsetControl (HSC
// lib/devices/hyperx_cloud_2_wireless_kingston.hpp, hyperx_cloud_flight.hpp) and HyperHeadset (HH src/devices/
// cloud_ii_wireless.rs, cloud_flight_wireless.rs); no code copied, never run on a real headset.
//
// Its own folder because a library entry declares one vendor id (device.json `vid`, matched by helpers/device-library.mjs
// match()); the HP-era (03F0) models stay in device-library/hyperx-cloud, whose Link this one follows. Self-contained:
// an installed copy sits alone in my-devices\, so nothing is imported from the other folder.
//
// READ ONLY. No model here has a documented write that can be read back: the Kingston Cloud II's sidetone set (19) has
// no get, its auto-off get (1A) is in HH alone, and no source changes anything on a Cloud Flight. So write() refuses
// every key and only the gets in a model's `reads` table can reach a device: checkFrame() refuses everything else, and
// the NEVER list, before anything is sent (sheet section 4: "an unknown byte may do anything").
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x0951;
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

// Frame families. cmdAt = byte position of the command in the whole frame (byte 0 = report id). reply: the reply's own
// leading bytes and command position, when they differ from the request's.
export const FAMILIES = {
  // Kingston Cloud II Wireless (HSC buildRequest, HH BASE_PACKET): 06 00 02 00 9A 00 00 68 4A 8E 0A 00 00 00 BB <cmd>,
  // 62 bytes. The reply is input report 0B: 0B 00 BB <cmd> ... (HSC: "response[0] != 0x0B || response[2] != 0xBB ||
  // response[3] != command" is refused; HH the same). Both first ask the dongle for input report 06 (HidD_GetInputReport,
  // a read; "may fail, ignore") before every write: prepare.
  kingston: { name: '06 .. BB (Kingston)', header: [0x06, 0x00, 0x02, 0x00, 0x9a, 0x00, 0x00, 0x68, 0x4a, 0x8e, 0x0a, 0x00, 0x00, 0x00, 0xbb],
    cmdAt: 15, reply: { header: [0x0b, 0x00, 0xbb], cmdAt: 3 }, prepare: { reportId: 0x06, len: 63 } },
  // Cloud Flight (HSC getBattery, HH BASE_PACKET + GET_BATTERY_CMD_ID 5): 21 FF 05, reply 21 FF 05 <HI> <LO>
  '21ff': { name: '21 FF', header: [0x21, 0xff], cmdAt: 2, echo: 2 },
};

// Never sent, on any model, by any path.
export const NEVER = [
  { family: 'kingston', cmd: 0x01, what: 'Kingston Cloud II Wireless 01 get (status / mute)',
    why: 'HH cloud_ii_wireless.rs: "I think this unmutes the headset" for the 01 packet; the HP Cloud II\'s 01 is on the sheet\'s Never list for the same reason (section 4)' },
  { bytes: [0x00, 0xde, 0xff], what: 'Pulsefire Dart save DE FF',
    why: 'writes to on-board memory (section 4, "Never"); a mouse command, refused here should any frame carry it' },
];

const pct = (v) => (Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);

// f(n) = byte n of the reply frame, report id = byte 0
const KINGSTON_READS = {
  battery: { cmd: 0x02, parse: (f) => ({ percent: pct(f(7)) }) },                     // HSC BATTERY_LEVEL_INDEX 7; HH "Battery level is at byte 7"
  charging: { cmd: 0x03, parse: (f) => (f(4) === 1 ? true : f(4) === 0 || f(4) === 2 ? false : null) },   // HSC CHARGING_STATUS_INDEX 4 (1 = charging); HH 0 not, 1 charging, 2 full
  autoOff: { cmd: 0x1a, parse: (f) => f(4) },                                          // HH GET_AUTO_SHUTDOWN_CMD_ID 26: byte 4 = minutes (HH only)
};

// Cloud Flight battery (HH cloud_flight_wireless.rs THRESHOLDS / PERCENTAGES): the percent of the highest listed
// millivolt step at or below the reading (below the first: 5). Charging at 4116 mV and up (HH: HI = 0x10 and LO >= 0x14,
// or HI >= 0x11); HSC says charging above 0x100B (4107 mV), so between the two the charging state is unknown.
const FLIGHT_STEPS = [[3328, 5], [3584, 10], [3674, 15], [3704, 20], [3732, 25], [3744, 30], [3754, 35], [3764, 40], [3774, 45], [3784, 50],
  [3794, 55], [3804, 60], [3824, 65], [3840, 70], [3860, 75], [3890, 80], [3910, 85], [3940, 90], [3960, 95], [3970, 100]];
export function flightBattery(mV) {
  if (!Number.isInteger(mV) || mV <= 0) return { percent: null, mV: mV || null, charging: null };
  const charging = mV >= 0x1014 ? true : mV > 0x100b ? null : false;
  if (charging === true) return { percent: null, mV, charging };   // neither source gives a level while charging
  let percent = FLIGHT_STEPS[0][1];
  for (const [at, p] of FLIGHT_STEPS) if (mV >= at) percent = p;
  return { percent, mV, charging, estimate: true };
}
const FLIGHT_READS = {
  battery: { cmd: 0x05, parse: (f) => flightBattery((f(3) << 8) | f(4)) },            // "21 FF 05: bytes 3-4 = millivolts BE" (HSC, HH)
};

export const MODELS = [
  { key: 'cloud-ii-wireless-kingston', name: 'HyperX Cloud II Wireless (Kingston)', pids: ['1718'], family: 'kingston',
    len: 62, raw: true, reads: KINGSTON_READS, held: [{ cmd: 0x18, why: 'auto-off set (its get 1A is in HH alone)' }, { cmd: 0x19, why: 'sidetone on/off set (no get in any source: no read-back)' }],
    lenNote: '62 out (HSC, HH); the 0B reply is read from the raw channel', source: 'HSC hyperx_cloud_2_wireless_kingston.hpp, HH cloud_ii_wireless.rs',
    readOnlyWhy: 'its sidetone set has no read-back and its auto-off read is in one source; read-only until a read on the headset confirms it' },
  { key: 'cloud-flight-wireless', name: 'HyperX Cloud Flight Wireless', pids: ['16c4', '1723'], family: '21ff',
    len: 20, raw: false, reads: FLIGHT_READS, held: [],
    lenNote: 'HSC 20, HH 64: 20 here (HSC, which names both ids; unconfirmed which Windows wants)', source: 'HSC hyperx_cloud_flight.hpp, HH cloud_flight_wireless.rs',
    readOnlyWhy: 'no source changes anything on it (battery only)' },
  { key: 'cloud-flight-wireless-hh', name: 'HyperX Cloud Flight Wireless', pids: ['1749'], family: '21ff',
    len: 20, raw: false, reads: FLIGHT_READS, held: [],
    lenNote: 'as the other Flight ids', source: 'HH cloud_flight_wireless.rs only (the id); HSC hyperx_cloud_flight.hpp (the frame)',
    readOnlyWhy: 'HH alone lists this id; no source changes anything on it (battery only)' },
];
// Left out: HH's other "possible Cloud II Wireless (and Cloud Flight S)" ids 0951:0B92, 16EA, 16EB (the model behind
// each is not named); the Kingston Cloud II surround get (another frame: 06 00 00 00 FF ...; DSP state, no setting).

export const modelFor = (pid) => MODELS.find((m) => m.pids.includes(String(pid).toLowerCase())) || null;

// What may be sent: exactly a documented get (header + cmd) of THIS model. Every set is refused (read-only driver).
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
  if (b.length === fam.cmdAt + 1 && Object.values(model.reads).some((r) => r.cmd === cmd)) return 'get';
  if (b.length > fam.cmdAt + 1) throw new Error(`refused: ${model.name} is read-only here (${model.readOnlyWhy})`);
  const held = model.held.find((h) => h.cmd === cmd);
  if (held) throw new Error(`refused: command ${cmd.toString(16).padStart(2, '0')} is held back (${held.why})`);
  throw new Error(`refused: ${hex(b)} is not a documented ${model.name} command`);
}

// One get at a time over a HIDDevice (WebHID, or helpers/hid-host.mjs HostDevice under the agent).
export class Link {
  constructor(device, model, { timeoutMs = 1500 } = {}) {
    Object.assign(this, { device, model, fam: FAMILIES[model.family], timeoutMs, q: Promise.resolve(), feature: false, log: [] });
  }

  // checked synchronously, before it is queued: a refused frame never reaches the device
  send(frame) {
    const kind = checkFrame(this.model, frame);
    if (kind !== 'get') throw new Error('refused: only a get is sent');
    const run = () => this.sendNow(Array.from(frame));
    const p = this.q.then(run, run);
    this.q = p.catch(() => {});
    return p;
  }

  async sendNow(frame) {
    const fam = this.fam, reportId = frame[0], cmd = frame[fam.cmdAt];
    const rh = fam.reply?.header || fam.header, rc = fam.reply?.cmdAt ?? fam.cmdAt;
    const data = new Uint8Array(this.model.len - 1);
    data.set(frame.slice(1));
    // the listener is in place before the write; the wait starts once the write is done (hyperx-cloud, support issues 3-5)
    let listener, timer, fail = null;
    const answer = new Promise((resolve, reject) => {
      fail = reject;
      listener = (e) => {
        if (e.reportId !== rh[0]) return;
        const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        const f = (n) => (n === 0 ? rh[0] : d[n - 1]);
        if (!rh.every((x, i) => f(i) === x) || f(rc) !== cmd) return;   // a notice, or another reply
        this.device.removeEventListener('inputreport', listener);   // answered: a raw channel stops reading for it now
        resolve(Uint8Array.from(d));
      };
      this.device.addEventListener('inputreport', listener);
    });
    answer.catch(() => {});
    try {
      // HSC prepareDevice / HH prepare_write: ask for input report 06 first (a read); its failure is ignored, as both do
      if (fam.prepare && typeof this.device.getInputReport === 'function') await this.device.getInputReport(fam.prepare.reportId, fam.prepare.len).catch(() => null);
      await this.write(reportId, data);
      this.log.push({ t: Date.now(), out: hex([reportId, ...data]) });
      if (this.log.length > 100) this.log.splice(0, this.log.length - 100);
      timer = setTimeout(() => fail(new Error(`no reply to ${hex(frame)}`)), this.timeoutMs);
      return await answer;
    } finally {
      clearTimeout(timer);
      this.device.removeEventListener('inputreport', listener);
    }
  }

  // An output report; on a refused write (not an unplug), a feature report, as HH does on Windows (write_hid_report)
  async write(reportId, data) {
    if (this.feature) return this.device.sendFeatureReport(reportId, data);
    try { await this.device.sendReport(reportId, data); }
    catch (e) {
      if (e?.gone || e?.never || typeof this.device.sendFeatureReport !== 'function') throw e;
      this.feature = true;
      await this.device.sendFeatureReport(reportId, data);
    }
  }

  async getRaw(key) {
    const r = Object.hasOwn(this.model.reads, key) ? this.model.reads[key] : null;
    if (!r) throw new Error(`${this.model.name} has no documented read for ${key}`);
    const frame = [...this.fam.header, r.cmd];
    let d;
    try { d = await this.send(frame); } catch (e) { if (e?.gone || /^refused/.test(e.message)) throw e; d = await this.send(frame); }   // one retry
    const f = (n) => (n === 0 ? (this.fam.reply?.header || this.fam.header)[0] : d[n - 1]);
    return { value: r.parse(f), bytes: hex([f(0), ...d]) };
  }
  async get(key) { return (await this.getRaw(key)).value; }
}

const SETTINGS = [
  { key: 'autoOff', label: 'Turn off after', type: 'slider', min: 0, max: 255, step: 1, unit: 'min', hint: 'Cloud II Wireless (Kingston), shown only (no change yet). HeadsetControl sets at most 30 minutes.' },
];
const KEYS = SETTINGS.map((s) => s.key);

export default {
  id: 'hyperx-kingston',
  title: 'HyperX Cloud headset (Kingston)',
  kind: 'Headset',
  get settings() { const m = this.link?.model || this.lastModel; return m ? SETTINGS.filter((s) => Object.hasOwn(m.reads, s.key)) : SETTINGS; },
  // one channel per pid: the Kingston Cloud II on a raw channel (its reply has another report id, 0B, so the helper's
  // request-and-echo REQ cannot match it) with input reports on request (the prepare read); the Flight as the HP Flight
  hid: { vid: '0951', pid: '1718', page: '*', usage: '*', len: 61, reportId: 0x06, replyMs: 1000, productName: 'HyperX Cloud II Wireless (Kingston)',
    refusals: true, pids: MODELS.flatMap((m) => m.pids).map((p) => p.toUpperCase()),
    byPid: Object.fromEntries(MODELS.flatMap((m) => m.pids.map((p) => [p.toUpperCase(), {
      page: '*', usage: '*', outputLen: m.len - 1, len: m.len - 1, reportId: FAMILIES[m.family].header[0], productName: m.name,
      ...(m.raw ? { reply: 'raw', inputReports: true } : { echo: () => FAMILIES[m.family].echo }) }]))) },
  unsupported: ['firmware updates (never: they stay in HyperX NGENUITY)', 'every change (no read-back documented, or one source)', 'sidetone (write-only on the Kingston Cloud II)',
    'Cloud Flight settings (battery only, estimated from its voltage)', 'lights, equalizer, surround', 'running beside NGENUITY: close it first'],
  link: null,
  lastModel: null,
  pid: null,

  async connect() {
    this.link = null;
    for (const m of MODELS) {
      for (const pid of m.pids) {
        let dev = null;
        try { dev = await getDevice([{ vendorId: VID, productId: parseInt(pid, 16) }], { prompt: false }); } catch { dev = null; }
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

  model() { if (!this.link) throw new Error('no Kingston-era HyperX headset is connected'); return this.link.model; },

  async info() {
    const m = this.model();
    const out = { Model: m.name, 'USB id': `0951:${this.pid.toUpperCase()}`, Protocol: `${FAMILIES[m.family].name} (${m.source})`, Changes: `none: ${m.readOnlyWhy}` };
    const b = Object.hasOwn(m.reads, 'battery') ? await this.link.getRaw('battery').catch(() => null) : null;
    if (b?.value?.mV) out['Battery voltage'] = `${b.value.mV} mV`;
    if (b?.value?.estimate) out.Battery = `${b.value.percent}% (estimated from the voltage, HyperHeadset's table)`;
    return out;
  },

  async read() {
    const m = this.model();
    const out = {};
    let got = 0, last = null;
    for (const k of KEYS) {
      if (!Object.hasOwn(m.reads, k)) continue;
      try { out[k] = await this.link.get(k); got++; } catch (e) { last = e; }
    }
    if (!got && last) throw last;
    return out;
  },

  async write(key) {
    const m = this.model();
    if (typeof key !== 'string' || !KEYS.includes(key)) throw new Error(`${String(key)} is not a setting`);
    throw Object.assign(new Error(`${m.name} is read-only here: ${m.readOnlyWhy}`), { refused: true });
  },

  async battery() {
    const m = this.model();
    const b = await this.link.get('battery');
    let charging = b?.charging;
    if (charging === undefined && Object.hasOwn(m.reads, 'charging')) { try { charging = await this.link.get('charging'); } catch { charging = null; } }
    return { percent: b?.percent ?? null, charging: charging == null ? undefined : charging };
  },

  async rawBackup() {
    const m = this.model();
    const replies = {};
    for (const k of Object.keys(m.reads)) { try { replies[k] = (await this.link.getRaw(k)).bytes; } catch (e) { replies[k] = `no reply (${e.message})`; } }
    return { model: m.name, usb: `0951:${this.pid.toUpperCase()}`, family: FAMILIES[m.family].name, replies };
  },
};
