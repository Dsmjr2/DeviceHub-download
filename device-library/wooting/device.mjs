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
//  - key depth (the analog SDK's input reports) lives on another collection (FF54 / FF53) than the config channel,
//    and a driver opens one collection per product id; see docs/handoff/more-drivers.md.
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
    hid: { vid: '31E3', pid: '1100', pids: PIDS, page: '1337', usage: '*', len: 256, reportId: 0, reply: 'raw', replyMs: REPLY_MS },
    settings: [],
    unsupported: ['firmware updates (Wootility only)', 'per-key lighting (no read-back exists; OpenRGB drives it)', 'actuation point, rapid trigger, tachyon mode (no documented setter)',
      'key depth (on another collection; see docs/handoff/more-drivers.md)', 'profiles (community protocol only)', 'the original Wooting One / Two (vendor 03EB)'],
    dev: null, pid: null, model: null, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    // the first Wooting product id that is plugged in. Opening sends nothing.
    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid);
        if (dev) { Object.assign(this, { dev, pid, model: MODELS[pid], raw: {}, appAt: 0, app: null }); return true; }
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

    async info() {
      const { layout } = await this.config();
      return { Model: this.model.name, 'Product id': `31E3:${this.pid}`, Size: SIZES[this.model.type], Layout: LAYOUTS[layout] ?? `unknown (code ${layout})`,
        'Changing settings': 'Wootility (DeviceHub only reads this keyboard)' };
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
