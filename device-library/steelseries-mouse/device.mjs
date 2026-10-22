// SteelSeries mice (USB vendor 0x1038), written 22 Oct 2026 from docs/brands/steelseries.md (the "sheet": rivalcfg's
// device files and mouse.py, cross-checked with OpenRGB's SteelSeriesDevices.h, all cited there). Status: untested.
// Nothing here has run on a real mouse; every byte below is a row of the sheet, cited as "sheet s<section> <row>".
// No code was copied from rivalcfg or OpenRGB.
//
// What it does: names the mouse from its product id, reads the battery and charging state of the wireless mice the
// sheet's battery row lists (`92`, wireless `D2`), and the firmware version of the Rival 3 (`10 00`). That is every
// mouse READ in the sheet (s2 "Mice: rivalcfg layout": "rivalcfg never reads settings back from the mouse ... Only
// battery, firmware and the wireless readback are reads"). DeviceHub writes a setting only when it can read the same
// value back (CLAUDE.md "Write one setting at a time, then read it back"), so DPI, polling rate, sleep and dim timers,
// lights and buttons are not offered and never sent: WRITE_ONLY lists them as documentation only.
//
// HID LAYER (docs/handoff/hid-core.md):
//  1. One channel per product id (`hid.pids` + `hid.byPid`, helpers/my-devices.mjs hidSpecs), each opened by USB
//     interface (sheet s1 "Interface" column: 3 for every model here); the Aerox rows on usage page FFC0, usage 01 (sheet
//     s1 note: "OpenRGB opens Aerox 3/5/9 on interface 3, usage page 0xFFC0, usage 1"); the Prime Wireless and Rival 3
//     have no page in the sheet, so their channels use page / usage '*' (any) on interface 3.
//  2. Report id 0 (sheet top: "for SteelSeries it is almost always 0x00 (no numbered reports)"; s2 "Every command is
//     sent as 00 <command bytes>"), output reports (s2 "Output report (hid_write) for all current models").
//
// UNCONFIRMED (check with helpers/hid-caps.ps1 and one read before trusting a value):
//  - The output report length. len 64 = data bytes after the report id, from the sheet's s5 helper note ("64-byte
//    output writes with report id 0"); it must equal hid-caps' OutputReportByteLength - 1.
//  - Whether the battery reply echoes the command in its byte 0. The sheet gives only "read 2 (64 on dongle)" and the
//    value in byte 1, so the first input report after the request is taken as the reply.
//  - The Prime Wireless and Rival 3 usage pages (see HID LAYER 1).
//
// What it does NOT do, on purpose (sheet s4 "Read-only first, then writes"):
//  - No save (`11 00`, dongle `51 00`; `09 00`, `59`): writes the mouse's flash. On helpers/never-commands.json.
//  - No firmware update, no command id the sheet does not list ("Unknown command ids on the mouse (0x2D-0x92 range) ...
//    could reach bootloader or calibration functions. Send only the ids listed here"). SENDABLE is the whole list.
//  - No write at all: write() refuses every key.
import { getDevice } from '../../public/devices/hid.js';

const VID = 0x1038;

// sheet s2 "Wireless (2.4 GHz): ... the first command byte is OR'd with 0x40 ... battery 0x92 becomes 0xD2"
export const WIRELESS_FLAG = 0x40;
// the documented reads (sheet s3 "Mice")
export const CMD = {
  battery: 0x92,     // "Battery + charging | 92 (wireless D2), read 2 (64 on dongle) | byte 1: bit 7 = charging; level = ((b1 & 0x7F) - 1) x 5 %"
  firmware: 0x10,    // "Firmware version | 10 00, read 2 | 2 raw bytes | Rival 3"
};
// the only command bytes that ever leave this file, by what the model has (wired byte; a dongle sends it | 0x40)
const SENDABLE = { battery: [CMD.battery], firmware: [CMD.firmware] };

// The models (sheet s1 "Mice"). link: 'cable' (the mouse on its USB cable) or 'dongle' (its 2.4 GHz receiver).
//  battery: the battery row lists the model (s3: "Aerox 3/5/9 Wireless, Prime Wireless"); firmware: the Rival 3 row.
//  page: the usage page where the sheet gives one (HID LAYER 1).
export const MODELS = [
  { pid: 0x183a, name: 'Aerox 3 Wireless', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1838, name: 'Aerox 3 Wireless', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x187a, name: 'Aerox 3 Wireless CS2 Dragon Lore', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1878, name: 'Aerox 3 Wireless CS2 Dragon Lore', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x1854, name: 'Aerox 5 Wireless', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1852, name: 'Aerox 5 Wireless', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x185e, name: 'Aerox 5 Wireless Destiny 2', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x185c, name: 'Aerox 5 Wireless Destiny 2', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x1862, name: 'Aerox 5 Wireless Diablo IV', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1860, name: 'Aerox 5 Wireless Diablo IV', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x185a, name: 'Aerox 9 Wireless', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1858, name: 'Aerox 9 Wireless', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x1876, name: 'Aerox 9 Wireless WoW Edition', link: 'cable', battery: true, page: 0xffc0 },
  { pid: 0x1874, name: 'Aerox 9 Wireless WoW Edition', link: 'dongle', battery: true, page: 0xffc0 },
  { pid: 0x1842, name: 'Prime Wireless', link: 'cable', battery: true, page: null },
  { pid: 0x1840, name: 'Prime Wireless', link: 'dongle', battery: true, page: null },
  // s1 "Rival 3 | 0x1824, 0x184C (firmware v0.37.0.0) | 3"; s3 "Firmware version | 10 00, read 2 | Rival 3"
  { pid: 0x1824, name: 'Rival 3', link: 'cable', firmware: true, page: null },
  { pid: 0x184c, name: 'Rival 3', link: 'cable', firmware: true, page: null },
];
const IFACE = 3;  // sheet s1 "Interface" column for every row above
const LEN = 64;   // UNCONFIRMED (see the top)

// Documented writes with NO documented read (sheet s3 "Mice"; s2 "rivalcfg never reads settings back"). Never sent:
// a setting DeviceHub cannot read back is not written. Documentation only.
export const WRITE_ONLY = [
  { what: 'DPI presets', bytes: '2D <count> <selected> <code>...', models: 'Aerox 3W/5/9, Rival 5, Prime Wireless; Aerox 3 wired', cite: 'sheet s3 DPI presets (rivalcfg multidpi_range_choice.py, truemove_air.py)' },
  { what: 'DPI presets', bytes: '0B 00 ...', models: 'Rival 3', cite: 'sheet s3 DPI presets' },
  { what: 'DPI presets', bytes: '61 ...', models: 'Prime (wired)', cite: 'sheet s3 DPI presets' },
  { what: 'DPI presets', bytes: '03 00 <slot> <00-77> 00 42', models: 'Rival 600', cite: 'sheet s3 DPI presets' },
  { what: 'polling rate', bytes: '2B <code>', models: 'Aerox, Prime Wireless, Rival 5', cite: 'sheet s3 Polling rate' },
  { what: 'polling rate', bytes: '04 00 <code> / 5D <code>', models: 'Rival 3, Rival 600 / Prime (wired)', cite: 'sheet s3 Polling rate' },
  { what: 'sleep timer', bytes: '29 <3 bytes>', models: 'Aerox Wireless, Prime Wireless', cite: 'sheet s3 Sleep timer (byte order unconfirmed, s6)' },
  { what: 'dim timer', bytes: '23 0F 01 00 00 <3 bytes>', models: 'Aerox Wireless, Prime Wireless', cite: 'sheet s3 Dim timer' },
  { what: 'zone colours, light effect, brightness, reactive colour, default lighting', bytes: '21 ..., 22 ..., 23 / 5F ..., 26 ..., 27 ..., 05 00 ..., 06 00 ..., 62 ...', models: 'all', cite: 'sheet s3 Zone color, Light effect, Brightness, Reactive color, Default lighting' },
  { what: 'button mapping', bytes: '2A + 5-byte fields', models: 'Aerox, Rival 5, Prime Wireless', cite: 'sheet s3 Button mapping' },
];

// SteelSeries' own apps (SteelSeries GG, the older SteelSeries Engine); the same names as
// device-library/steelseries-arctis VENDOR_APPS, copied so this folder stands alone in my-devices
export const VENDOR_APPS = /^SteelSeries(GG|GGClient|Engine|Engine3)?\.exe$/i;

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const h4 = (n) => n.toString(16).padStart(4, '0');

// the sheet's battery byte (s3 Battery + charging): bit 7 = charging, level = ((b & 0x7F) - 1) x 5 %
export function parseBattery(b) {
  const level = ((b & 0x7f) - 1) * 5;
  return { percent: Math.max(0, Math.min(100, level)), charging: (b & 0x80) !== 0 };
}

// a model's HID channel (HID LAYER 1)
function channelOf(m) {
  return { page: m.page == null ? '*' : h4(m.page).toUpperCase(), usage: m.page == null ? '*' : '0001', iface: IFACE, len: LEN, reportId: 0,
    productName: `SteelSeries ${m.name}` };
}

// one request at a time; the reply is the first input report after the request (UNCONFIRMED: see the top)
class Link {
  constructor(dev, model) { this.dev = dev; this.model = model; this.q = Promise.resolve(); this.last = null; }
  serial(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }
  ask(what, timeoutMs = 1000) {
    const base = SENDABLE[what]?.[0];
    if (base == null || !this.model[what]) throw new Error(`${what} is not a read the sheet documents for the ${this.model.name}`);
    const out = new Uint8Array(LEN);
    out[0] = this.model.link === 'dongle' ? base | WIRELESS_FLAG : base;   // s2 "Wireless (2.4 GHz)"
    // 10 00: the firmware request's second byte is the 00 in the sheet's row; the battery request is the command alone
    return this.serial(() => new Promise((resolve, reject) => {
      const on = (e) => {
        const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        done(); this.last = { out: hex(out.slice(0, 2)), in: hex(r.slice(0, 8)) }; resolve(new Uint8Array(r));
      };
      const timer = setTimeout(() => { done(); reject(new Error(`no reply to ${hex(out.slice(0, 2))}`)); }, timeoutMs);
      const done = () => { clearTimeout(timer); this.dev.removeEventListener('inputreport', on); };
      this.dev.addEventListener('inputreport', on);
      this.dev.sendReport(0, out).catch((err) => { done(); reject(err); });
    }));
  }
}

export default {
  id: 'steelseries-mouse',
  title: 'SteelSeries mouse',
  kind: 'Mouse',
  vendor: 'SteelSeries',
  hid: { vid: '1038', pid: '183A', page: 'FFC0', usage: '0001', iface: IFACE, len: LEN, reportId: 0, replyMs: 800, productName: 'SteelSeries Aerox 3 Wireless',
    pids: MODELS.map((m) => h4(m.pid).toUpperCase()), byPid: Object.fromEntries(MODELS.map((m) => [h4(m.pid).toUpperCase(), channelOf(m)])) },
  // nothing writable: every documented mouse setting is write-only (WRITE_ONLY); the battery shows on the tile
  settings: [],
  unsupported: ['firmware updates', 'saving settings to the mouse',
    'DPI, polling rate, sleep and dim timers, lights and button mapping: every source only writes them and none reads them back, so DeviceHub does not change them (SteelSeries GG does)',
    'battery on the Prime Mini Wireless, Rival 3 Wireless and Aerox 3 Gen 2 (not in the sheet\'s battery row)'],
  MODELS, WRITE_ONLY, VENDOR_APPS,

  // the vendor-app check (replaceable in tests); resolves with the running app's name, or null
  async vendorApp() {
    if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
    const { execFile } = await import('node:child_process');
    const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
    for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.test(name)) return name; }
    return null;
  },

  async connect() {
    this.model = null; this.link = null; this.status = null;
    for (const m of MODELS) {
      const filter = { vendorId: VID, productId: m.pid };
      if (m.page != null) filter.usagePage = m.page;
      let dev = null;
      try { dev = await getDevice([filter], { prompt: false }); } catch { dev = null; }
      if (!dev) continue;
      if (!dev.opened) await dev.open();
      this.model = m; this.link = new Link(dev, m);
      return true;
    }
    return false;
  },

  need() { if (!this.link) throw Object.assign(new Error('no SteelSeries mouse is connected'), { gone: true }); },

  async readBattery() {
    this.need();
    if (!this.model.battery) return null;
    const r = await this.link.ask('battery');
    this.status = { ...parseBattery(r[1]), raw: hex(r.slice(0, 4)) };   // s3: the value is in byte 1
    return this.status;
  },

  async info() {
    this.need();
    const m = this.model;
    const out = { Model: `SteelSeries ${m.name}`, 'USB id': `1038:${h4(m.pid)}`, Connection: m.link === 'dongle' ? 'wireless (2.4 GHz receiver)' : 'USB cable',
      Driver: 'untested library driver: reads only (battery, firmware); nothing is ever written' };
    if (m.firmware) {
      const r = await this.link.ask('firmware').catch(() => null);
      out.Firmware = r ? `${r[0]}.${r[1]} (raw bytes)` : 'no reply';   // s3 "2 raw bytes"; their meaning is not documented
    }
    if (m.battery) {
      const st = await this.readBattery().catch(() => null);
      out.Battery = st ? `${st.percent}%${st.charging ? ', charging' : ''}` : 'no reply (asleep?)';
    }
    out['Other settings'] = 'SteelSeries GG only: no source reads them back';
    return out;
  },

  // no settings, so no values (the battery goes through battery())
  async read() { this.need(); return {}; },

  async write(key) {
    this.need();
    const w = WRITE_ONLY.find((x) => x.what.toLowerCase().includes(String(key).toLowerCase()));
    throw new Error(w
      ? `${w.what} is write-only on SteelSeries mice (${w.cite}): no source reads it back, so DeviceHub does not change it`
      : `${key} is not a setting of this driver (it only reads the battery)`);
  },

  async battery() {
    if (!this.link || !this.model.battery) return null;
    const st = await this.readBattery();
    return { percent: st.percent, charging: st.charging };
  },

  async rawBackup() {
    this.need();
    const st = this.model.battery ? await this.readBattery().catch(() => null) : null;
    return { model: this.model.name, pid: h4(this.model.pid), link: this.model.link, battery: st?.raw ?? null };
  },
};
