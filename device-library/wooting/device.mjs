// Wooting keyboards, read only (22 Oct 2026), written only from docs/brands/wooting.md, and only from the parts it takes
// from Wooting's OWN open SDKs (wooting-rgb-sdk: src/wooting-usb.c, wooting-usb.h; wooting-analog-sdk). The community
// commands the sheet also lists (GetSerial 3, profile index 11, ActivateProfile 23: WootingProfileSwitcher and the
// BigBrainAFK gist) are left out on purpose. "wooting.md §n" names the sheet's section each fact comes from.
// Simulated in tests/sim-wooting.mjs; never run on a real keyboard.
//
// What it does: names the board (model, size, from the product id table) and reads its keyboard layout with the one
// command Wooting's RGB SDK uses for it, GetDeviceConfig (19). Nothing else is ever sent. It has no settings:
//  - per-key lighting (30 / 31 / 32, raw report 0B) is documented, but no command reads a key's colour back, so a
//    write could never be checked (CLAUDE.md: read before and after every write). OpenRGB drives these lights.
//  - actuation point, rapid trigger and tachyon mode have no documented setter in any source (§3, §6).
// Key depth (read only, 22 Oct 2026; docs/handoff/hid-input-reports.md): the analog SDK's input reports, on a second
// collection of the same board (hid.extra, opened only when keyDepth() asks; nothing is ever sent on it). Taken from
// Wooting's own wooting-analog-sdk (develop), not from the sheet alone:
//  - src/plugin/wooting.rs: ANALOG_INTERFACE_V1 = 0xFF54, ANALOG_INTERFACE_V2 = 0xFF53, ANALOG_BUFFER_SIZE_V1 = 48,
//    ANALOG_BUFFER_SIZE_V2 = 64, WOOTING_VID = 0x31e3; it never writes to the device.
//  - src/device.rs: WootingNewFirmware { vid: WOOTING_VID, pid: None, usage_page: 0xFF54 } and WootingAnalogProtocolV2
//    { vid: WOOTING_VID, pid: None, usage_page: 0xFF53 }; matches() checks the usage page only (no usage, no interface);
//    reads are `device.read_timeout(&mut buffer, 50)`.
//    v1 (get_analog_buffer): buffer.chunks_exact(3), entries with s[2] == 0 dropped, code = s[0] << 8 | s[1],
//    value = (s[2] / 255).min(1.0) (31E3 boards; the x1.2 is the legacy One / Two only).
//    v2 (get_analog_buffer_with_ctx): chunks_exact(4) = [matrix pos, key, packed, value]; row = (pos >> 5) & 7,
//    col = pos & 0x1F, actuated = packed & 1, namespace = (packed >> 2) & 0xF, value = (value << 2) | ((packed >> 6) & 3),
//    scaled (value / 1023).min(1.0), code = namespace << 8 | key; entries with value 0 dropped.
//  - The SDK parses hidapi's buffer from byte 0. hidapi on Windows drops a leading report id 0 and keeps any other, so
//    sdkBuffer() below hands the parsers that same view of DeviceHub's READ reply.
// UNCONFIRMED: which of the two pages each board has (the SDK takes whichever is there; tried here in its device_impls
// order, v1 then v2), and the input report length (reads are sized 256 bytes, larger than either SDK buffer).
//
// HID LAYER (docs/handoff/hid-core.md): page 1337 (the "v2" config page, RGB's CFG_USAGE_PAGE), usage any (the sheet
// names none), reply 'raw' so the reply, an INPUT report, is read with receiveReports() after the feature report.
// UNCONFIRMED until a board is measured: that current boards expose 1337 (§2: some may only have FF55, the v3 page,
// whose frame differs; such a board simply does not connect), the input report length (256, RGB's v2 response size),
// and that GetDeviceConfig answers without the WootDevInit (33) RGB sends first (it is a lighting start, not sent here).
import { getDevice } from '../../public/devices/hid.js';

// §2 "The command frame": report id 00 on page 1337, magic D0 DA, command id, then parameters 3, 2, 1, 0
export const MAGIC = [0xd0, 0xda];
export const CMD = { getDeviceConfig: 0x13 };   // §2 Command ids: 19 GetDeviceConfig (RGB: layout at reply byte 10 on v2)
const ALLOWED = new Set(Object.values(CMD));    // the ONLY command ids this driver can send
export const REPLY_MS = 1000;                   // §2: WOOTING_READ_RESPONSE_TIMEOUT 1000 ms
export const LAYOUT_AT = 10;                    // §2 Command ids row 19: layout at reply byte 10 (v2)
// the analog collections (wooting-analog-sdk plugin/wooting.rs and device.rs; see the header), in the SDK's order
export const ANALOG = Object.freeze([
  Object.freeze({ name: 'analog-v1', page: 'FF54', protocol: 1, size: 48 }),
  Object.freeze({ name: 'analog-v2', page: 'FF53', protocol: 2, size: 64 }),
]);
export const DEPTH_MS = 60;   // how long keyDepth() listens by default (the SDK polls every 10 ms, 50 ms read timeout)

// hidapi's view of an input report (what the SDK parses): a report id 0 is dropped, any other id stays at byte 0
export function sdkBuffer(e) {
  const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
  return e.reportId === 0 ? new Uint8Array(d) : Uint8Array.from([e.reportId, ...d]);
}
// device.rs get_analog_buffer (protocol 1, 31E3 scaling)
export function parseV1(buf, size = 48) {
  const out = [], b = buf.slice(0, size);
  for (let i = 0; i + 3 <= b.length; i += 3) if (b[i + 2] !== 0) out.push({ code: (b[i] << 8) | b[i + 1], value: Math.min(b[i + 2] / 255, 1) });
  return out;
}
// device.rs get_analog_buffer_with_ctx (protocol 2)
export function parseV2(buf, size = 64) {
  const out = [], b = buf.slice(0, size);
  for (let i = 0; i + 4 <= b.length; i += 4) {
    const [pos, key, packed, v] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    const raw = (v << 2) | ((packed >> 6) & 3);
    if (!raw) continue;
    const ns = (packed >> 2) & 0x0f;
    out.push({ code: (ns << 8) | key, value: Math.min(raw / 1023, 1), row: (pos >> 5) & 7, col: pos & 0x1f, actuated: (packed & 1) === 1 });
  }
  return out;
}

export const LAYOUTS = { 0: 'ANSI', 1: 'ISO', 2: 'JIS', 3: 'ANSI split', 4: 'ISO split' };   // §1 "Layout per RGB"
const SIZES = { 1: 'TKL', 2: 'full size', 3: '60%', 4: '3-key pad', 5: '80%' };              // §1 "Device type per RGB"

// §1 Models with ids, vendor 31E3 (the new-firmware boards; protocol v2). The original One / Two (vendor 03EB, protocol
// v1) and the low-nibble "mode" ids (base | 1, base | 2: meaning unconfirmed) are not here.
export const MODELS = {
  '1100': { name: 'Wooting One', type: 1 },
  '1200': { name: 'Wooting Two', type: 2 },
  '1210': { name: 'Wooting Two Lekker Edition', type: 2 },
  '1220': { name: 'Wooting Two HE', type: 2 },
  '1230': { name: 'Wooting Two HE (ARM)', type: 2 },
  '1300': { name: 'Wooting 60HE', type: 3 },
  '1310': { name: 'Wooting 60HE (ARM)', type: 3 },
  '1320': { name: 'Wooting 60HE+', type: 3 },
  '1340': { name: 'Wooting 60HE v2', type: 3 },
  '1400': { name: 'Wooting 80HE', type: 5 },
  '1500': { name: 'Wooting UwU', type: 4 },
  '1510': { name: 'Wooting UwU RGB', type: 4 },
};
export const PIDS = Object.keys(MODELS);
// §4 "Never": running beside Wootility (it holds the same channel; assume yes, step back). Process names unconfirmed.
export const VENDOR_APPS = [/^wootility/i, /^wooting/i];
const APP_CHECK_MS = 15000;
const hex2 = (b) => b.toString(16).padStart(2, '0');
const hexs = (u8) => Array.from(u8, hex2).join(' ');

async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}

export function createWooting({ open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now() } = {}) {
  return {
    id: 'wooting',
    title: 'Wooting keyboard',
    kind: 'Keyboard',
    vendor: 'Wooting',
    hid: { vid: '31E3', pid: '1100', pids: PIDS, page: '1337', usage: '*', len: 256, reportId: 0, reply: 'raw', replyMs: REPLY_MS,
      // the key-depth collections, listened to only (helpers/hid-host.mjs extraChannel); usage any, as the SDK's matches()
      extra: ANALOG.map((a) => ({ name: a.name, page: a.page, usage: '*', len: 256 })) },
    settings: [],
    unsupported: ['firmware updates (Wootility only)', 'per-key lighting (no read-back exists; OpenRGB drives it)', 'actuation point, rapid trigger, tachyon mode (no documented setter)',
      'profiles (community protocol only)', 'the original Wooting One / Two (vendor 03EB)'],
    dev: null, pid: null, model: null, raw: {}, q: Promise.resolve(), app: null, appAt: 0, analog: null,

    // the first Wooting product id that is plugged in. Opening sends nothing.
    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid);
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], raw: {}, appAt: 0, app: null, analog: null }); return true; }
      }
      return false;
    },

    // Wootility running: step back from reads too (§4: it holds the same channel)
    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (it holds the same channel)`), { refused: true });
    },

    // one command (only ids in ALLOWED), all parameters 0, then its reply: an input report starting D0 DA <cmd>
    command(cmd) {
      const run = async () => {
        if (!ALLOWED.has(cmd)) throw new Error(`command ${cmd} is not one this driver may send`);
        if (!this.dev) throw Object.assign(new Error('no Wooting keyboard is open'), { gone: true });
        await this.dev.sendFeatureReport(0, Uint8Array.from([...MAGIC, cmd, 0, 0, 0, 0]));   // §2 frame bytes 1-7
        const until = now() + REPLY_MS;
        while (now() < until) {
          for (const e of await this.dev.receiveReports(Math.max(1, until - now()))) {
            const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
            if (e.reportId === 0 && r[0] === MAGIC[0] && r[1] === MAGIC[1] && r[2] === cmd) return new Uint8Array(r);   // §2: magic, then the command echoed
          }
        }
        throw new Error(`no reply to Wooting command ${cmd}`);
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },

    async config() {
      await this.appCheck();
      const r = await this.command(CMD.getDeviceConfig);
      this.raw.getDeviceConfig = hexs(r.slice(0, 32));
      return { layout: r[LAYOUT_AT] };
    },

    // Key depth, read only: the analog collection's input reports for up to ms (the last one that came is the board's
    // current state, each report listing the keys pressed). { protocol, page, keys: [{ code, value 0-1, row?, col?,
    // actuated? }] } with keys [] when nothing came (no key down); null when the board has no analog collection here.
    // Nothing is sent: the channel has no way to send (extraChannel is READ only).
    async keyDepth(ms = DEPTH_MS) {
      await this.appCheck();
      if (!this.dev) throw Object.assign(new Error('no Wooting keyboard is open'), { gone: true });
      if (typeof this.dev.extraChannel !== 'function') return null;
      if (!this.analog) {
        for (const a of ANALOG) {
          const ch = this.dev.extraChannel(a.name);
          if (await ch.open()) { this.analog = { ...a, ch }; break; }
        }
        if (!this.analog) return null;
      }
      const a = this.analog;
      let reports;
      try { reports = await a.ch.receiveReports(ms); } catch (e) { this.analog = null; if (e.gone) return null; throw e; }
      const last = reports.at(-1);
      const keys = last ? (a.protocol === 2 ? parseV2(sdkBuffer(last), a.size) : parseV1(sdkBuffer(last), a.size)) : [];
      return { protocol: a.protocol, page: a.page, keys };
    },

    async info() {
      const { layout } = await this.config();
      const out = { Model: this.model.name, 'Product id': `31E3:${this.pid}`, Size: SIZES[this.model.type], Layout: LAYOUTS[layout] ?? `unknown (code ${layout})`,
        'Changing settings': 'Wootility (DeviceHub only reads this keyboard)' };
      try {
        const k = await this.keyDepth();
        if (k) out['Key depth'] = `analog protocol ${k.protocol} (page ${k.page}): ${k.keys.length} key${k.keys.length === 1 ? '' : 's'} pressed now`;
      } catch { /* key depth is extra: the info stands without it */ }
      return out;
    },
    async read() { await this.config(); return {}; },
    async write(key) { throw Object.assign(new Error(`${key}: this Wooting driver only reads (no documented setting can be read back)`), { refused: true }); },
    async battery() { return null; },
    async rawBackup() { await this.config(); return { pid: this.pid, model: this.model.name, replies: { ...this.raw } }; },
  };
}

// the real channel: DeviceHub's HostDevice for this product id on page 1337, opened with nothing sent
async function defaultOpen(pid) {
  return getDevice([{ vendorId: 0x31e3, productId: parseInt(pid, 16), usagePage: 0x1337 }], { prompt: false });
}

export default createWooting();
