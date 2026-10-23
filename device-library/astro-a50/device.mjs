// Logitech ASTRO A50 Gen 5 base station (046D:0B1C), READ ONLY, 23 Oct 2026. Written only from HeadsetControl
// (github.com/Sapd/HeadsetControl, master @ a8120a6) lib/devices/logitech_astro_a50.hpp ("HSC :<line>" below) and the
// summary in docs/brands/logitech.md section 3 "ASTRO A50 (not HID++)". Documented facts only, no code copied; simulated
// in tests/sim-audeze-astro.mjs, never run on a real base station.
//
// TRANSPORT (HSC :15-35, 121-126): NOT HID++. The base's vendor collection, usage page FF32 / usage 0074 (interface 8),
// report id 02, 64-byte frames (63 data bytes here): `0C <len> 00 <cmd> <handle> <payload>`, where len counts the bytes
// from the 00 on (3 + payload). A GET is a request with no payload; the base answers with a frame of the same cmd, and
// also pushes such frames by itself on a change (HSC :34-35), so the channel is raw and every frame with marker 0C and
// the asked cmd is taken as the answer (HSC :355-358; a push of that cmd carries the same value).
//
// THE ONLY TWO FRAMES THIS DRIVER CAN SEND (FRAMES; frame() refuses anything else):
//   battery GET  `0C 03 00 06 0C` -> `0C 06 00 06 00 <percent> <level2> <docked/charging>`  (HSC :128-144, "confirmed")
//   ChatMix GET  `0C 03 00 0A 0C` -> `0C 04 00 0A 0C <0-12>` 0 = all chat, 6 = centre, 12 = all game (HSC :146-167)
// The handle byte 0C is an echo token any value of which works (HSC :51-53, 81).
//
// LEFT OUT, and why: every setting. Sidetone (cmd 09), dock light (0F), noise gate (14), headset volume (08) and the
// parametric EQ (0D) are only ever SET by HeadsetControl, fire-and-forget (HSC :169-241, 259-309: read_reply false), and
// no reply layout for reading them back is documented; DeviceHub writes only what it can read back. Also left out: the
// mic EQ, stream mix and device state commands (docs/ASTRO_A50_EXTRA_FEATURES.md: not implemented there), firmware
// updates and pairing (never; they stay in G HUB). The A50 Gen 4 (9886:002C, HSC logitech_astro_a50_gen4.hpp) is
// another protocol on another vendor id and is not handled here. The A50 X (Centurion, report 51) is not this protocol.
import { getDevice } from '../../public/devices/hid.js';

export const VID = 0x046d, PID = '0b1c', REPORT_ID = 0x02, LEN = 63, MARKER = 0x0c;
export const CMD = { battery: 0x06, chatmix: 0x0a };
export const FRAMES = Object.freeze({
  battery: Object.freeze([0x0c, 0x03, 0x00, CMD.battery, 0x0c]),
  chatmix: Object.freeze([0x0c, 0x03, 0x00, CMD.chatmix, 0x0c]),
});
export const REPLY_MS = 2000;
// G HUB talks to the same base (process names: lghub.exe, lghub_agent.exe, lghub_updater.exe)
export const VENDOR_APPS = [/^lghub/i];
const APP_CHECK_MS = 15000;

class Refused extends Error { constructor(m) { super(m); this.refused = true; } }
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

export function frame(name) {
  const f = FRAMES[name];
  if (!f) throw new Refused(`refused: ${String(name)} is not a frame this driver may send`);
  const out = new Uint8Array(LEN); out.set(f);
  return out;
}

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}
async function defaultOpen() {
  return getDevice([{ vendorId: VID, productId: parseInt(PID, 16), usagePage: 0xff32 }], { prompt: false });
}

export function createAstroA50({ open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now(), replyMs = REPLY_MS } = {}) {
  return {
    id: 'astro-a50',
    title: 'ASTRO A50',
    kind: 'Headset',
    vendor: 'Logitech',
    hid: { vid: '046D', pid: '0B1C', page: 'FF32', usage: '0074', len: LEN, reportId: REPORT_ID, reply: 'raw', productName: 'ASTRO A50 Gen 5 base station' },
    settings: [
      { key: 'chatmix', label: 'ChatMix', type: 'display', unit: ' (0 chat - 6 centre - 12 game)' },
      { key: 'docked', label: 'Docked or charging', type: 'display' },
    ],
    unsupported: ['sidetone, dock light, noise gate, headset volume and EQ (HeadsetControl only sets them; no documented read-back)',
      'firmware updates and pairing (never: they stay in G HUB)', 'the A50 Gen 4 (9886:002C) and the A50 X: other protocols',
      'running beside G HUB: close it first'],
    dev: null, q: Promise.resolve(), app: null, appAt: 0, raw: {}, inbox: [], listening: false,

    async connect() {
      if (this.dev) return true;
      let dev = null;
      try { dev = await open(); } catch { dev = null; }
      if (!dev) return false;
      if (dev.opened === false && typeof dev.open === 'function') await dev.open();
      Object.assign(this, { dev, app: null, appAt: 0, raw: {}, inbox: [], listening: false });
      // in a browser (no raw channel) the frames arrive as events
      if (typeof dev.receiveReports !== 'function' && typeof dev.addEventListener === 'function') {
        dev.addEventListener('inputreport', (e) => this.inbox.push(e));
        this.listening = true;
      }
      return true;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw new Refused(`${this.app} is running: close G HUB first (two programs on the same base fight); nothing was sent`);
    },

    async take(ms) {
      if (typeof this.dev.receiveReports === 'function') return this.dev.receiveReports(ms);
      if (!this.inbox.length && ms > 0) await new Promise((r) => setTimeout(r, Math.min(ms, 50)));
      return this.inbox.splice(0);
    },

    // one GET at a time: drop what is waiting, send, then take the first frame `0C .. 00 <cmd>` (HSC :346-362)
    get(name) {
      const run = async () => {
        if (!this.dev) throw Object.assign(new Error('the A50 base station is not open'), { gone: true });
        await this.appCheck();
        const cmd = FRAMES[name]?.[3];
        const out = frame(name);
        await this.take(0);
        await this.dev.sendReport(REPORT_ID, out);
        const until = now() + replyMs;
        while (now() < until) {
          for (const r of await this.take(Math.max(1, Math.min(250, until - now())))) {
            if (r.reportId != null && r.reportId !== REPORT_ID) continue;
            const u8 = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
            if (u8.length >= 6 && u8[0] === MARKER && u8[3] === cmd) { this.raw[name] = hex(u8.slice(0, 8)); return u8; }
          }
        }
        throw Object.assign(new Error(`no ${name} reply from the A50 base station`), { timeout: true });
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    async read() {
      const out = {};
      let last = null;
      try { const c = (await this.get('chatmix'))[5]; if (c <= 12) out.chatmix = c; } catch (e) { last = e; if (e?.refused) throw e; }
      try { out.docked = (await this.get('battery'))[7] !== 0 ? 'yes' : 'no'; } catch (e) { last = e; if (e?.refused) throw e; }
      if (!Object.keys(out).length && last) throw last;
      return out;
    },

    async info() {
      return { Model: 'ASTRO A50 Gen 5 base station', 'USB id': '046D:0B1C', Protocol: 'ASTRO vendor frames, report 02 (HeadsetControl logitech_astro_a50.hpp)', Changes: 'none (read only)' };
    },

    async write(key) {
      throw new Refused(`${String(key)}: nothing on the A50 can be changed here (HeadsetControl documents no way to read a setting back)`);
    },

    // HSC :128-144: byte 6 (offset 5 here) = %, byte 8 (offset 7) non-zero = docked/charging
    async battery() {
      let r;
      try { r = await this.get('battery'); } catch (e) { if (e?.timeout) return null; throw e; }
      if (r[5] > 100) return null;
      return { percent: r[5], charging: r[7] !== 0 };
    },

    async rawBackup() {
      try { await this.read(); } catch {}
      return { model: 'ASTRO A50 Gen 5', usb: '046D:0B1C', replies: { ...this.raw } };
    },
  };
}

export default createAstroA50();
