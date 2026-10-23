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
//
// STEALTH PRO II (23 Oct 2026; transmitter/dock 229B, the headset on its own USB cable 229E): the same transport (usage
// page FF13 / usage 0001, output report 06 of 62 bytes, replies on input report 07 framed `07 <len> 00 <data>`) and
// the same RACE 0x9902 CoAP GET of the GSI record, with keys 240 (battery %, confirmed on hardware), 250 (charging,
// confirmed both ways), 220 (name). Source: HaloBattery PR #194 (github.com/HeyOkay/HaloBattery/pull/194, head
// 9a8f358d) providers/turtlebeach.py and docs/protocols.md, from a USBPcap capture of Swarm II (issue #173). It differs:
// no 0x9942 enable; a session opener first ("SInf", capture packet 150: a record ask outside a session gets idle
// frames only), then the GSI ask (capture packet 616), each copied byte for byte below; replies asked for with
// GET_REPORT every 60 ms, up to 10 after the opener and 16 after the GSI ask, 32 in all; the GSI document can be one of
// several in the stream (the opener's state dump, pushed {"UP":"GSI",...} updates with only the changed keys), so
// gsiFrom() picks the GSI documents out and merges them. LEFT OUT: the source's third ask (the GSI ask with token
// `11 01`), which it marks INFERRED, not in the capture; DeviceHub sends only captured bytes. Its absence may make the
// read fail on battery on some units (the source's reporter read his level on battery through that ask).
import { getDevice } from '../../public/devices/hid.js';

export const OUT_ID = 0x06, IN_ID = 0x07, LEN = 61;   // tb §2: output report 0x06, 62 bytes; input report 0x07
// tb §2, with the report id 06 taken off the front (HostDevice sends it as the report id):
//   Enable: `06 06 00 05 5A 02 00 42 99`
//   GET /GSI: `06 0E 00 05 5A 0A 00 02 99 40 01 00 01 B3 47 53 49` (the reader's 0A 00 length, which matches the formula)
export const FRAMES = Object.freeze({
  enable: Object.freeze([0x06, 0x00, 0x05, 0x5a, 0x02, 0x00, 0x42, 0x99]),
  gsi: Object.freeze([0x0e, 0x00, 0x05, 0x5a, 0x0a, 0x00, 0x02, 0x99, 0x40, 0x01, 0x00, 0x01, 0xb3, 0x47, 0x53, 0x49]),
});
// HaloBattery PR #194 providers/turtlebeach.py ASK_SINF and ASK_GSI (62 bytes with the report id 06; the rest zeros),
// with the 06 taken off the front. Byte 1 (0x18 = 24) counts bytes 3..26 of the full frame; RACE 05 5A, length 0x14,
// id 0x9902 (02 99), then CoAP: 48 01 (GET), the session's message id and token, option 61 00 (observe 0), 53 + the path
//   SInf: `06 18 00 05 5A 14 00 02 99 48 01 C0 4A 01 00 ... 00 61 00 53 49 6E 66`
//   GSI:  `06 18 00 05 5A 14 00 02 99 48 01 44 14 04 00 ... 00 61 00 53 47 53 49`
const PRO2_HEAD = [0x18, 0x00, 0x05, 0x5a, 0x14, 0x00, 0x02, 0x99, 0x48, 0x01];
export const PRO2_FRAMES = Object.freeze({
  sinf: Object.freeze([...PRO2_HEAD, 0xc0, 0x4a, 0x01, 0, 0, 0, 0, 0, 0, 0, 0x61, 0x00, 0x53, 0x49, 0x6e, 0x66]),
  gsi: Object.freeze([...PRO2_HEAD, 0x44, 0x14, 0x04, 0, 0, 0, 0, 0, 0, 0, 0x61, 0x00, 0x53, 0x47, 0x53, 0x49]),
});
// PR #194: PACKET_DELAY 0.060 before each get_input_report, SINF_READS 10, MAX_READS 16, TOTAL_READS 32
export const PRO2_GET = Object.freeze({ sinf: 10, gsi: 16, total: 32, everyMs: 60 });
export const KEYS = { battery: '240', charging: '250', linked: '230', name: '220', sound: '2c0' };   // tb §3 Headsets
export const READ_MS = 2000;   // how long the replies are gathered (the reader concatenates every payload it reads)
// reader.py's GET_REPORT sequence: `_drain(times=5)`, `time.sleep(0.3)` after the enable, `attempts=30` gets each
// followed by `time.sleep(0.03)`; HID_REPORT_SIZE 62 = the report id + 61 data bytes
export const GET = Object.freeze({ drain: 5, afterEnableMs: 300, attempts: 30, everyMs: 30 });
// tb §1: 2251 verified; 2250 and 2253 are its siblings, "assumed same firmware, untested". Stealth Pro II 229B / 229E:
// PR #194 KNOWN (both read the same way); its frames are the capture's, but this driver has not been seen working on
// one yet. The Stealth 600 Gen 3 (223A) is left out: its only source (stealth600-gen3-usb-fix race_hid.py) uses RACE
// nvkey reads and writes for a firmware repair and never reads GSI or a battery on it.
export const MODELS = {
  '2251': { name: 'Stealth 700 Gen 3 transmitter', verified: true, frames: FRAMES },
  '2250': { name: 'Stealth 700 Gen 3 (sibling id)', verified: false, frames: FRAMES },
  '2253': { name: 'Stealth 700 Gen 3 (sibling id)', verified: false, frames: FRAMES },
  '229b': { name: 'Stealth Pro II transmitter', verified: false, frames: PRO2_FRAMES, session: true },
  '229e': { name: 'Stealth Pro II (on its USB cable)', verified: false, frames: PRO2_FRAMES, session: true },
};
export const PIDS = ['2251', '2250', '2253', '229b', '229e'];   // the verified id first (object keys would sort them)
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

// tb §2 "Reassembly: the reader just concatenates read payloads" (the 700's reader then takes the first { to the last }).
// The Stealth Pro II stream can hold several documents with binary envelopes between them (PR #194: the opener's state
// dump, {"OR":"GSI",...}, pushed {"UP":"GSI",...} with only changed keys), so every balanced {...} is tried on its own
// (a control byte ends a candidate: envelopes never sit inside a document) and the GSI ones are merged in order. A
// record counts once it holds an OR:"GSI" document or a battery key; otherwise null.
export function gsiFrom(reports) {
  let text = '';
  for (const r of reports) {
    if (r.reportId !== IN_ID) continue;
    const u8 = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const n = u8[0] | (u8[1] << 8);                      // tb §2: the same 3-byte prefix (07, length lo, hi)
    for (const b of u8.slice(2, 2 + Math.min(n, u8.length - 2))) text += String.fromCharCode(b);
  }
  const kvp = {};
  let whole = false, any = false;
  for (const doc of documents(text)) {
    if ((doc.OR ?? doc.UP) !== 'GSI' || !doc.KVP || typeof doc.KVP !== 'object' || Array.isArray(doc.KVP)) continue;
    Object.assign(kvp, doc.KVP); any = true;
    if (doc.OR === 'GSI') whole = true;
  }
  return any && (whole || kvp[KEYS.battery] != null) ? { OR: 'GSI', KVP: kvp } : null;
}

function* documents(text) {
  for (let i = text.indexOf('{'); i >= 0; ) {
    let depth = 0, str = false, esc = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text.charCodeAt(j);
      if (c < 0x20) break;
      if (str) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x22) str = false; }
      else if (c === 0x22) str = true;
      else if (c === 0x7b) depth++;
      else if (c === 0x7d && --depth === 0) { end = j + 1; break; }
    }
    let doc = null;
    if (end > 0) { try { doc = JSON.parse(text.slice(i, end)); } catch { doc = null; } }
    if (doc && typeof doc === 'object') { yield doc; i = text.indexOf('{', end); } else i = text.indexOf('{', i + 1);
  }
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
      'Stealth 600 Gen 3 and older Stealth headsets (not documented for this read)'],
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

    // one frame from this model's frame set (FRAMES or PRO2_FRAMES; nothing else can be sent), zero-padded to 61 bytes
    // on report 06
    send(name) {
      const f = (this.model?.frames || FRAMES)[name];
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
        if (this.model.session) return this.keep(await this.proII());
        await this.dev.receiveReports(0);   // drop anything already waiting
        await this.send('enable');
        await this.dev.receiveReports(100);
        await this.send('gsi');
        const got = [], until = now() + READ_MS;
        let j = null;
        while (!j && now() < until) { got.push(...(await this.dev.receiveReports(Math.max(1, Math.min(250, until - now()))))); j = gsiFrom(got); }
        if (!j) j = await this.gsiByGetReport();
        return this.keep(j);
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    keep(j) {
      if (!j) throw new Error('the transmitter sent no GSI record (is the headset on and Swarm II closed?)');
      this.raw.gsi = JSON.stringify(j.KVP);
      this.last = j.KVP; this.lastAt = now();
      return j.KVP;
    },

    // Stealth Pro II (PR #194 _read_status): the opener, then the GSI ask, each followed by GET_REPORTs on report 07
    // 60 ms apart (10, then 16, at most 32 in all), stopping once the battery key is in. The opener's dump may already
    // carry it; then the GSI ask is not sent. On a channel without getInputReport, replies are read as they arrive.
    async proII() {
      const got = [];
      const has = () => { const j = gsiFrom(got); return j && j.KVP[KEYS.battery] != null ? j : null; };
      if (typeof this.dev.getInputReport === 'function') {
        let budget = PRO2_GET.total;
        for (const [frame, reads] of [['sinf', PRO2_GET.sinf], ['gsi', PRO2_GET.gsi]]) {
          if (has()) break;
          await this.send(frame);
          for (let i = 0; i < reads && budget > 0 && !has(); i++, budget--) {
            await sleep(PRO2_GET.everyMs);
            const r = await this.dev.getInputReport(IN_ID, LEN);
            if (r) got.push(r);
          }
        }
        if (has()) this.raw.via = 'GET_REPORT';
        return gsiFrom(got);
      }
      await this.dev.receiveReports(0);
      await this.send('sinf');
      got.push(...(await this.dev.receiveReports(300)));
      if (!has()) {
        await this.send('gsi');
        const until = now() + READ_MS;
        while (!has() && now() < until) got.push(...(await this.dev.receiveReports(Math.max(1, Math.min(250, until - now())))));
      }
      return gsiFrom(got);
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
      const out = { Model: `Turtle Beach ${this.model.name}`, 'Product id': `10F5:${this.pid.toUpperCase()}${this.model.verified ? '' : ' (not yet seen working)'}` };
      if (k[KEYS.name] != null) out['Headset name'] = String(k[KEYS.name]);
      // PR #194: on a Stealth Pro II key 230 moves 2 (on battery) -> 0 (on the cable), a transport enum, not "linked"
      if (k[KEYS.linked] != null) out[this.model.session ? 'Connection (key 230, raw)' : 'Headset linked'] = this.model.session ? String(k[KEYS.linked]) : String(k[KEYS.linked]) === '1' ? 'yes' : 'no';
      if (k[KEYS.sound] != null) out['Signature Sound preset (raw)'] = String(k[KEYS.sound]);
      if (k[KEYS.charging] != null) out.Charging = `${String(k[KEYS.charging]) === '1' ? 'yes' : 'no'}${this.model.session ? '' : ' (key 250: a best guess on this model)'}`;
      return out;
    },
    async read() { await this.gsi(); return {}; },
    async write(key) { throw Object.assign(new Error(`${key}: nothing on a Turtle Beach headset can be changed here (no open source documents a setting)`), { refused: true }); },

    // tb §3: battery = key 240, a decimal string; charging = key 250 ('1'); on a Stealth 700 Gen 3 only while the headset
    // is linked (230 = '1'); a Stealth Pro II's 230 is a transport enum (PR #194), so it is not checked there
    async battery() {
      const k = await this.gsi();
      if (!this.model.session && k[KEYS.linked] != null && String(k[KEYS.linked]) !== '1') return null;
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
