// Turtle Beach Stealth 700 Gen 3 battery, read only (22 Oct 2026), written only from docs/brands/turtle-beach.md
// ("tb §n" below), which cites halobattery-stealth700 (docs/protocol.md and src/stealth700_battery/reader.py) for every
// byte. Simulated in tests/sim-turtle-beach-battery.mjs; never run on a real transmitter.
//
// What it does: the transmitter is an Airoha chip speaking RACE over HID (tb §2). Two fixed requests, both copied byte
// for byte from the sheet, are the only things this driver can send:
//   1. RACE 0x9942: switch on the chip's CoAP client (Swarm II sends it on every poll, tb §4);
//   2. RACE 0x9902 tunnelling a CoAP "GET /GSI": the reply body is JSON, {"OR":"GSI","KVP":{"240":"100",...}}.
// From the JSON: 240 = battery %, 250 = charging (best guess on this model, tb §6), 230 = headset linked, 220 = name,
// 2c0 = Signature Sound preset (meaning unconfirmed, shown raw). There are no settings: no open source sets anything on
// any Turtle Beach headset (tb §3, §6), and RACE nvkey writes (0x0A01) are on DeviceHub's never list.
//
// HID LAYER (docs/handoff/hid-core.md): usage page FF13, usage 0001 (tb §1, "select it by usage, not interface
// number"), output report 06 of 61 data bytes (62 with the report id, tb §2), replies on input report 07; reply 'raw'
// so every input report is read with receiveReports(), and inputReports so it can ask for one (getInputReport, helper
// IGET = HidD_GetInputReport; docs/handoff/hid-input-reports.md).
// How replies are read: halobattery-stealth700 src/stealth700_battery/reader.py reads ONLY with
// `get_input_report(IN_REPORT_ID, HID_REPORT_SIZE)` (report 07, 62 bytes), never a plain read(), in this order: drain
// (5 gets), enable, sleep 0.3 s, drain (5 gets), GET /GSI, then 30 gets 0.03 s apart, joined, first { to last }.
// This driver first reads input reports as they arrive (its earlier path: it sends the same two frames and nothing
// else); when that finds no GSI record, it runs the reader's GET_REPORT sequence above once, with the same two frames.
// UNCONFIRMED until a transmitter is measured: which of the two ways it answers (tb §2 names only GET_REPORT).
import { getDevice } from '../../public/devices/hid.js';

export const OUT_ID = 0x06, IN_ID = 0x07, LEN = 61;   // tb §2: output report 0x06, 62 bytes; input report 0x07
// tb §2, with the report id 06 taken off the front (HostDevice sends it as the report id):
//   Enable: `06 06 00 05 5A 02 00 42 99`
//   GET /GSI: `06 0E 00 05 5A 0A 00 02 99 40 01 00 01 B3 47 53 49` (the reader's 0A 00 length, which matches the formula)
export const FRAMES = Object.freeze({
  enable: Object.freeze([0x06, 0x00, 0x05, 0x5a, 0x02, 0x00, 0x42, 0x99]),
  gsi: Object.freeze([0x0e, 0x00, 0x05, 0x5a, 0x0a, 0x00, 0x02, 0x99, 0x40, 0x01, 0x00, 0x01, 0xb3, 0x47, 0x53, 0x49]),
});
export const KEYS = { battery: '240', charging: '250', linked: '230', name: '220', sound: '2c0' };   // tb §3 Headsets
export const READ_MS = 2000;   // how long the replies are gathered (the reader concatenates every payload it reads)
// reader.py's GET_REPORT sequence: `_drain(times=5)`, `time.sleep(0.3)` after the enable, `attempts=30` gets each
// followed by `time.sleep(0.03)`; HID_REPORT_SIZE 62 = the report id + 61 data bytes
export const GET = Object.freeze({ drain: 5, afterEnableMs: 300, attempts: 30, everyMs: 30 });
// tb §1: 2251 verified; 2250 and 2253 are its siblings, "assumed same firmware, untested". The Stealth Pro II (229B,
// 229E) is left out: its session and GSI request bytes are only in a capture, not on the page (tb §6).
export const MODELS = {
  '2251': { name: 'Stealth 700 Gen 3 transmitter', verified: true },
  '2250': { name: 'Stealth 700 Gen 3 (sibling id)', verified: false },
  '2253': { name: 'Stealth 700 Gen 3 (sibling id)', verified: false },
};
export const PIDS = ['2251', '2250', '2253'];   // the verified id first (object keys would sort them)
// tb §4: Swarm II holds the channel while it is open (reads then get only idle frames). Process names unconfirmed.
export const VENDOR_APPS = [/^turtle ?beach/i, /^swarm/i];
const APP_CHECK_MS = 15000;

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}

// tb §2 "Reassembly: the reader just concatenates read payloads and takes the first { to the last }"
export function gsiFrom(reports) {
  let text = '';
  for (const r of reports) {
    if (r.reportId !== IN_ID) continue;
    const u8 = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const n = u8[0] | (u8[1] << 8);                      // tb §2: the same 3-byte prefix (07, length lo, hi)
    for (const b of u8.slice(2, 2 + Math.min(n, u8.length - 2))) text += String.fromCharCode(b);
  }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(text.slice(a, b + 1)); return j && j.KVP && typeof j.KVP === 'object' ? j : null; } catch { return null; }
}

export function createTurtleBeach({ open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return {
    id: 'turtle-beach-battery',
    title: 'Turtle Beach headset',
    kind: 'Headset',
    vendor: 'Turtle Beach',
    hid: { vid: '10F5', pid: '2251', pids: PIDS, page: 'FF13', usage: '0001', len: LEN, reportId: OUT_ID, reply: 'raw', replyMs: 300, inputReports: true },
    settings: [],
    unsupported: ['every headset setting (sidetone, EQ, mic, auto-off: no open source documents them)', 'firmware updates and RACE nvkey writes (never)',
      'Stealth Pro II, Stealth 600 Gen 3 and older Stealth headsets (not documented for this read)'],
    dev: null, pid: null, model: null, last: null, lastAt: 0, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid);
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], last: null, lastAt: 0, raw: {}, app: null, appAt: 0 }); return true; }
      }
      return false;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (it holds the transmitter's channel)`), { refused: true });
    },

    // one frame from FRAMES (nothing else can be sent), zero-padded to 61 bytes on report 06
    send(name) {
      const f = FRAMES[name];
      if (!f) throw new Error(`${name} is not a frame this driver may send`);
      const out = new Uint8Array(LEN); out.set(f);
      return this.dev.sendReport(OUT_ID, out);
    },

    // the GSI record: enable, ask, gather input reports for up to READ_MS. Reused for 5 s.
    gsi() {
      const run = async () => {
        if (this.last && now() - this.lastAt < 5000) return this.last;
        await this.appCheck();
        if (!this.dev) throw Object.assign(new Error('the transmitter is not open'), { gone: true });
        await this.dev.receiveReports(0);   // drop anything already waiting
        await this.send('enable');
        await this.dev.receiveReports(100);
        await this.send('gsi');
        const got = [], until = now() + READ_MS;
        let j = null;
        while (!j && now() < until) { got.push(...(await this.dev.receiveReports(Math.max(1, Math.min(250, until - now()))))); j = gsiFrom(got); }
        if (!j) j = await this.gsiByGetReport();
        if (!j) throw new Error('the transmitter sent no GSI record (is the headset on and Swarm II closed?)');
        this.raw.gsi = JSON.stringify(j.KVP);
        this.last = j.KVP; this.lastAt = now();
        return j.KVP;
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    // reader.py's own way, step for step (GET above): every reply asked for with GET_REPORT on input report 07. Runs only
    // inside gsi(), after the arriving-reports read found nothing; null when it finds nothing either (or the channel
    // has no getInputReport, an older DeviceHub).
    async gsiByGetReport() {
      if (typeof this.dev.getInputReport !== 'function') return null;
      const get = () => this.dev.getInputReport(IN_ID, LEN);
      const drain = async () => { for (let i = 0; i < GET.drain; i++) await get(); };
      await drain();
      await this.send('enable');
      await sleep(GET.afterEnableMs);
      await drain();
      await this.send('gsi');
      const got = [];
      for (let i = 0; i < GET.attempts; i++) {
        const r = await get();
        if (r) got.push(r);
        await sleep(GET.everyMs);
      }
      const j = gsiFrom(got);
      if (j) this.raw.via = 'GET_REPORT';
      return j;
    },

    async info() {
      const k = await this.gsi();
      const out = { Model: `Turtle Beach ${this.model.name}`, 'Product id': `10F5:${this.pid}${this.model.verified ? '' : ' (not yet seen working)'}` };
      if (k[KEYS.name] != null) out['Headset name'] = String(k[KEYS.name]);
      if (k[KEYS.linked] != null) out['Headset linked'] = String(k[KEYS.linked]) === '1' ? 'yes' : 'no';
      if (k[KEYS.sound] != null) out['Signature Sound preset (raw)'] = String(k[KEYS.sound]);
      if (k[KEYS.charging] != null) out.Charging = `${String(k[KEYS.charging]) === '1' ? 'yes' : 'no'} (key 250: a best guess on this model)`;
      return out;
    },
    async read() { await this.gsi(); return {}; },
    async write(key) { throw Object.assign(new Error(`${key}: nothing on a Turtle Beach headset can be changed here (no open source documents a setting)`), { refused: true }); },

    // tb §3: battery = key 240, a decimal string; charging = key 250 ('1'); only while the headset is linked (230)
    async battery() {
      const k = await this.gsi();
      if (k[KEYS.linked] != null && String(k[KEYS.linked]) !== '1') return null;
      const n = Number(k[KEYS.battery]);
      if (k[KEYS.battery] == null || !Number.isInteger(n) || n < 0 || n > 100) return null;
      return { percent: n, charging: String(k[KEYS.charging] ?? '0') === '1' };
    },
    async rawBackup() { await this.gsi(); return { pid: this.pid, model: this.model.name, replies: { ...this.raw } }; },
  };
}

async function defaultOpen(pid) {
  return getDevice([{ vendorId: 0x10f5, productId: parseInt(pid, 16), usagePage: 0xff13 }], { prompt: false });
}

export default createTurtleBeach();
