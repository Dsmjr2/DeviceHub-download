// Audeze Maxwell and Maxwell 2 (vendor 3329), 23 Oct 2026. Written only from HeadsetControl (github.com/Sapd/HeadsetControl,
// master @ a8120a6; "HSC <file>:<line>" below): lib/devices/audeze_maxwell_device.hpp (the protocol both models share),
// audeze_maxwell.hpp and audeze_maxwell2.hpp (ids, collection), lib/device.hpp:14 (VENDOR_AUDEZE 0x3329). Documented
// facts only, no code copied; simulated in tests/sim-audeze-astro.mjs, never run on a real headset.
//
// TRANSPORT (HSC audeze_maxwell_device.hpp:26-43, 69-83): vendor collection usage page FF13, usage 0001
// (audeze_maxwell.hpp:93, audeze_maxwell2.hpp:51). Requests go out as output report 06, replies are ASKED FOR as input
// report 07 (HidD_GetInputReport, the helper's IGET; hid.inputReports). Reports are 62 bytes with the report id, so 61
// data bytes here: [0] = number of valid fragment bytes (0..59; 0 = nothing new), [1] = route (80 = the headset, behind
// the dongle), [2..] = the fragment. The fragments form a stream of messages `05 <type> <len lo> <len hi> <body>`:
// type 5A request, 5B response, 5C notification, 5D asynchronous result; the body's first two bytes name the command.
//
// THE ONLY REQUESTS THIS DRIVER CAN SEND (frame() refuses everything else before a byte goes out):
//   read key        01 09 <key> 00        -> 5B 01 09 <key> 00 <status> <value>    keys 00, 22, 2C, 2D
//   write key       00 09 <key> 00 <v>    -> 5B 00 09 <key> 00 00                  keys 00 (v 1-10), 2C (v 1-max)
//   read parameter  83 2C <param> 00      -> 5B 83 2C <status> <param> 00 <value>  params 07, 0B
//   battery         D6 0C 00              -> 5B D6 0C <status>, then 5D D6 0C 00 00 <percent>
// (HSC audeze_maxwell_device.hpp:52-58, the key and parameter numbers :99-111.) Replies carry no sequence number, so
// they are matched on the command and its key / parameter, and anything else in the stream is skipped (:63-65).
// Pacing as Audeze's app (:229-234, 309-335): 50 ms before each input-report read, 1250 ms per reply, a read sent up to
// 3 times on silence, a write sent ONCE (the headset may still apply a late one).
//
// SETTINGS (each is read before and after every write):
// - EQ preset, key 00: written as 1-10 (HSC :614-629: 1 Audeze, 2 Treble Boost, 3 Bass Boost, 4 Immersive, 5 Competition,
//   6 Footsteps, 7-10 EQ1-EQ4) and read back with the same key (HSC audeze_maxwell.hpp:197-207 reads key 00 for the
//   selected preset). The only setting changed outright.
// - Sidetone level, key 2C: read (HSC :528-552) and written (HSC :497-526, levels 1..the headset's maximum, key 2D,
//   default 31 when it reads 0 or fails, :120-121, 420-428). Written ONLY while sidetone reads on (parameter 07 not 0):
//   writing the level while it is off switches an original Maxwell on (:59-61, 504-507). While it is off the write is
//   refused as waiting; DeviceHub never switches sidetone on or off (below).
// - Readings, never written: sidetone on/off (parameter 07), ChatMix (parameter 0B, 0-20, 10 = centre, HSC :594-612),
//   mic muted (key 22: 00 = muted, FF = not, :113-114), battery % (D6 0C, :452-486; no charging flag is documented).
//
// LEFT OUT, and why:
// - switching sidetone on/off (parameter 07): its write TOGGLES whatever value is sent (:59-61, 430-436), so writing
//   the current value back, as DeviceHub's check does, would flip it;
// - volume limiter (key 28), voice prompts (key 20), mic noise filter (key 24): HSC only writes them, never reads them
//   back, and the read values' meaning is not documented (the limiter writes 88 / 8E);
// - auto power off (parameter 01): an 8-byte value (:554-581) whose read layout HSC does not document;
// - custom EQ bands (storage commands 0C/0D/03 0A, DSP apply 03 0E, audeze_maxwell.hpp:37-49): storage writes, never
//   sent; firmware updates, pairing and resets (none documented; never).
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x3329, OUT_ID = 0x06, IN_ID = 0x07, LEN = 61, ROUTE = 0x80, MAX_FRAGMENT = 59;
export const TYPE = { request: 0x5a, response: 0x5b, result: 0x5d };
export const KEY = { eqPreset: 0x00, micMute: 0x22, sidetoneLevel: 0x2c, sidetoneMax: 0x2d };
export const PARAM = { sidetoneOn: 0x07, chatmix: 0x0b };
export const SIDETONE_DEFAULT_MAX = 31, CHATMIX_MAX = 20;
export const TIMING = Object.freeze({ replyMs: 1250, pollMs: 50, readTries: 3 });
// HSC audeze_maxwell.hpp:52-55 and audeze_maxwell2.hpp:27-30
export const MODELS = {
  '4b19': { name: 'Audeze Maxwell' },
  '4b18': { name: 'Audeze Maxwell (Xbox dongle)' },
  '4b29': { name: 'Audeze Maxwell 2 (PlayStation/PC)', two: true },
  '4b28': { name: 'Audeze Maxwell 2 (Xbox)', two: true },
};
export const PIDS = ['4b19', '4b18', '4b29', '4b28'];
// HSC audeze_maxwell_device.hpp:614-629 (the headset's own numbering 1-10)
export const PRESETS = [
  { value: 1, label: 'Audeze' }, { value: 2, label: 'Treble Boost' }, { value: 3, label: 'Bass Boost' }, { value: 4, label: 'Immersive' },
  { value: 5, label: 'Competition' }, { value: 6, label: 'Footsteps' }, { value: 7, label: 'EQ1 (custom)' }, { value: 8, label: 'EQ2 (custom)' },
  { value: 9, label: 'EQ3 (custom)' }, { value: 10, label: 'EQ4 (custom)' },
];
// Audeze HQ polls the same dongle about once a second and takes replies meant for others (HSC :312-315). Process name
// unconfirmed: anything starting with "audeze".
export const VENDOR_APPS = [/^audeze/i];
const APP_CHECK_MS = 15000;

class Refused extends Error { constructor(m, extra = {}) { super(m); this.refused = true; Object.assign(this, extra); } }
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// The body of one of the four documented requests, or a refusal. Nothing else can ever be built.
export function frame(kind, id, value) {
  if (kind === 'readKey' && Object.values(KEY).includes(id)) return [0x01, 0x09, id, 0x00];
  if (kind === 'readParam' && Object.values(PARAM).includes(id)) return [0x83, 0x2c, id, 0x00];
  if (kind === 'battery') return [0xd6, 0x0c, 0x00];
  if (kind === 'writeKey') {
    const ok = Number.isInteger(value) && ((id === KEY.eqPreset && value >= 1 && value <= 10) || (id === KEY.sidetoneLevel && value >= 1 && value <= 0x7f));
    if (ok) return [0x00, 0x09, id, 0x00, value];
  }
  throw new Refused(`refused: ${kind} ${id} ${value ?? ''} is not a request this driver may send`);
}

// 05 5A <len lo> <len hi> <body>, split into 61-byte output reports: <fragment len> 80 <fragment> zeros (HSC :150-182)
export function reportsFor(body) {
  const msg = [0x05, TYPE.request, body.length & 0xff, body.length >> 8, ...body];
  const out = [];
  for (let at = 0; at < msg.length; at += MAX_FRAGMENT) {
    const part = msg.slice(at, at + MAX_FRAGMENT), r = new Uint8Array(LEN);
    r[0] = part.length; r[1] = ROUTE; r.set(part, 2);
    out.push(r);
  }
  return out;
}

// the valid fragment of an input report (data without the report id); empty when it carries nothing new (HSC :184-195)
export function fragmentOf(u8) {
  if (!u8 || u8.length < 2) return [];
  const n = u8[0];
  if (n > MAX_FRAGMENT || 2 + n > u8.length) return [];
  return Array.from(u8.slice(2, 2 + n));
}

// takes the next whole message off the front of the stream; bytes that cannot start one are dropped (HSC :197-226)
export function nextMessage(stream) {
  while (stream.length) {
    if (stream[0] !== 0x05) { stream.shift(); continue; }
    if (stream.length < 4) break;
    const size = 4 + (stream[2] | (stream[3] << 8));
    if (size > 1024) { stream.shift(); continue; }
    if (stream.length < size) break;
    return stream.splice(0, size);
  }
  return null;
}
const isMsg = (m, type, c0, c1) => m.length >= 6 && m[1] === type && m[4] === c0 && m[5] === c1;

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}
async function defaultOpen(pid) {
  return getDevice([{ vendorId: VID, productId: parseInt(pid, 16), usagePage: 0xff13 }], { prompt: false });
}

const LABELS = { eqPreset: 'EQ preset', sidetoneLevel: 'Sidetone level' };

export function createMaxwell({ open = defaultOpen, vendorApp = defaultVendorApp, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), timing = TIMING } = {}) {
  return {
    id: 'audeze-maxwell',
    title: 'Audeze Maxwell',
    kind: 'Headset',
    vendor: 'Audeze',
    hid: { vid: '3329', pid: '4B19', pids: PIDS.map((p) => p.toUpperCase()), page: 'FF13', usage: '0001', len: LEN, reportId: OUT_ID, reply: 'raw', inputReports: true, productName: 'Audeze Maxwell' },
    unsupported: ['switching sidetone on or off (its command toggles, so it cannot be checked by writing the same value)',
      'volume limiter, voice prompts, mic noise filter and auto power off (HeadsetControl never reads them back)',
      'custom EQ bands (stored on the headset; never written here)', 'firmware updates (never: they stay in Audeze HQ)',
      'running beside Audeze HQ: close it first (it takes the replies)'],
    dev: null, pid: null, model: null, q: Promise.resolve(), app: null, appAt: 0, sideMax: SIDETONE_DEFAULT_MAX, raw: {},

    get settings() {
      return [
        { key: 'eqPreset', label: 'EQ preset', type: 'choice', options: PRESETS.map((o) => ({ ...o })), hint: 'The headset\'s ten presets; the four custom ones keep the bands set in Audeze HQ.' },
        { key: 'sidetoneLevel', label: 'Sidetone level', type: 'slider', min: 1, max: this.sideMax, step: 1,
          hint: `1-${this.sideMax}. Changes only while sidetone is on (switch it on on the headset or in Audeze HQ).` },
        { key: 'sidetoneOn', label: 'Sidetone', type: 'display' },
        { key: 'chatmix', label: 'ChatMix', type: 'display', unit: ' (0 chat - 10 centre - 20 game)' },
        { key: 'micMuted', label: 'Mic', type: 'display' },
      ];
    },

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        let dev = null;
        try { dev = await open(pid); } catch { dev = null; }
        if (!dev) continue;
        if (dev.opened === false && typeof dev.open === 'function') await dev.open();
        Object.assign(this, { dev, pid, model: MODELS[pid], app: null, appAt: 0, raw: {}, sideMax: SIDETONE_DEFAULT_MAX });
        return true;
      }
      return false;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw new Refused(`${this.app} is running: close it first (it reads the same dongle and takes the replies); nothing was sent`);
    },

    // one request at a time (HSC :63-65): send the body, then ask for input reports until a message `accept` takes
    request(body, accept, tries) {
      const run = async () => {
        if (!this.dev) throw Object.assign(new Error('the Maxwell is not open'), { gone: true });
        if (typeof this.dev.getInputReport !== 'function') throw new Error('this DeviceHub cannot ask for input reports (hid.inputReports): the Maxwell answers only that way');
        await this.appCheck();
        for (let t = 0; t < tries; t++) {
          for (const r of reportsFor(body)) await this.dev.sendReport(OUT_ID, r);
          const stream = [], until = now() + timing.replyMs;
          for (;;) {
            for (let m = nextMessage(stream); m; m = nextMessage(stream)) if (accept(m)) return m;
            if (now() >= until) break;
            await sleep(timing.pollMs);
            const r = await this.dev.getInputReport(IN_ID, LEN);
            if (r?.data) stream.push(...fragmentOf(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)));
          }
        }
        throw Object.assign(new Error('no reply from the Maxwell (is the headset on?)'), { timeout: true });
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    // HSC :343-360: reply 05 5B 06 00 01 09 <key> 00 <status> <value>
    async readKey(key) {
      const m = await this.request(frame('readKey', key), (x) => isMsg(x, TYPE.response, 0x01, 0x09) && x[6] === key && x[7] === 0, timing.readTries);
      this.raw[`key ${key.toString(16).padStart(2, '0')}`] = hex(m);
      if (m.length <= 9 || m[8] !== 0) throw new Error(`the Maxwell refused reading key ${key.toString(16).padStart(2, '0')}`);
      return m[9];
    },
    // HSC :378-395: reply 05 5B 06 00 83 2C <status> <param> 00 <value>
    async readParam(param) {
      const m = await this.request(frame('readParam', param), (x) => isMsg(x, TYPE.response, 0x83, 0x2c) && x[7] === param && x[8] === 0, timing.readTries);
      this.raw[`param ${param.toString(16).padStart(2, '0')}`] = hex(m);
      if (m.length <= 9 || m[6] !== 0) throw new Error(`the Maxwell refused reading parameter ${param.toString(16).padStart(2, '0')}`);
      return m[9];
    },
    // HSC :362-376: reply 05 5B 05 00 00 09 <key> 00 00; sent once
    async writeKey(key, value) {
      const body = frame('writeKey', key, value);
      await this.request(body, (x) => isMsg(x, TYPE.response, 0x00, 0x09) && x[6] === key && x[7] === 0, 1);
    },

    async sidetoneMax() {
      try { const v = await this.readKey(KEY.sidetoneMax); this.sideMax = v > 0 && v <= 0x7f ? v : SIDETONE_DEFAULT_MAX; } catch { this.sideMax = SIDETONE_DEFAULT_MAX; }
      return this.sideMax;
    },

    async read() {
      const out = {};
      let got = 0, last = null;
      const take = async (k, fn) => { try { const v = await fn(); if (v !== undefined) { out[k] = v; got++; } } catch (e) { last = e; if (e?.refused) throw e; } };
      await take('eqPreset', async () => { const v = await this.readKey(KEY.eqPreset); return v >= 1 && v <= 10 ? v : undefined; });
      await this.sidetoneMax();
      await take('sidetoneLevel', () => this.readKey(KEY.sidetoneLevel));
      await take('sidetoneOn', async () => ((await this.readParam(PARAM.sidetoneOn)) !== 0 ? 'on' : 'off'));
      await take('chatmix', async () => Math.min(await this.readParam(PARAM.chatmix), CHATMIX_MAX));
      await take('micMuted', async () => ((await this.readKey(KEY.micMute)) === 0x00 ? 'muted' : 'not muted'));
      if (!got && last) throw last;
      return out;
    },

    async info() {
      const out = { Model: this.model?.name || 'Audeze Maxwell', 'USB id': `3329:${(this.pid || '').toUpperCase()}`, Protocol: 'Airoha control messages (HeadsetControl audeze_maxwell_device.hpp)' };
      out['Sidetone levels'] = `1-${await this.sidetoneMax()}`;
      return out;
    },

    async write(key, value) {
      if (key !== 'eqPreset' && key !== 'sidetoneLevel') throw new Refused(`${String(key)} cannot be changed on the Maxwell here`);
      if (key === 'eqPreset' && !PRESETS.some((p) => p.value === value)) throw new Refused(`EQ preset must be 1-10 (got ${JSON.stringify(value)})`);
      if (key === 'sidetoneLevel') {
        if (!Number.isInteger(value) || value < 1) throw new Refused(`Sidetone level must be a whole number from 1 (got ${JSON.stringify(value)})`);
        const max = await this.sidetoneMax();
        if (value > max) throw new Refused(`Sidetone level must be 1-${max} (got ${value})`);
      }
      const k = KEY[key];
      const before = await this.readKey(k);   // read just before the write, kept to put back
      let onBefore = null;
      if (key === 'sidetoneLevel') {
        onBefore = await this.readParam(PARAM.sidetoneOn);
        if (onBefore === 0) throw new Refused('Sidetone is off: switch it on on the headset or in Audeze HQ first (writing the level while it is off would switch it on); nothing was written', { waiting: true });
        if (before < 1 || before > this.sideMax) throw new Refused(`Sidetone level reads ${before}, outside 1-${this.sideMax}: nothing was written`);
      } else if (before < 1 || before > 10) throw new Refused(`EQ preset reads ${before}, not one of the ten presets: nothing was written`);
      await this.writeKey(k, value);
      const after = await this.readKey(k);
      const onAfter = key === 'sidetoneLevel' ? await this.readParam(PARAM.sidetoneOn) : null;
      if (after !== value || (onBefore !== null && (onAfter !== 0) !== (onBefore !== 0))) {
        let back = '';
        if (after !== before) {
          try { await this.writeKey(k, before); back = (await this.readKey(k)) === before ? ', the old value was put back' : ', and putting the old value back did not read back either'; } catch { back = ', and putting the old value back failed'; }
        }
        const why = after !== value ? `wrote ${value}, read back ${after}` : 'sidetone switched itself on or off';
        throw new Error(`${LABELS[key]}: ${why}${back}`);
      }
      return after;
    },

    // HSC :452-486: 5B D6 0C <status> (refused when not 00), then 5D D6 0C 00 00 <percent>; silence = headset off
    async battery() {
      let m;
      try {
        m = await this.request(frame('battery'), (x) => (isMsg(x, TYPE.result, 0xd6, 0x0c) && x.length > 8) || (isMsg(x, TYPE.response, 0xd6, 0x0c) && x.length > 6 && x[6] !== 0), timing.readTries);
      } catch (e) { if (e?.timeout) return null; throw e; }
      this.raw.battery = hex(m);
      if (m[1] !== TYPE.result) return null;
      return { percent: Math.min(m[8], 100) };
    },

    async rawBackup() {
      try { await this.read(); } catch {}
      return { model: this.model?.name, usb: `3329:${(this.pid || '').toUpperCase()}`, replies: { ...this.raw } };
    },
  };
}

export default createMaxwell();
