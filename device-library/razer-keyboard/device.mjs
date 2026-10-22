// Razer keyboards over the 90-byte report (22 Oct 2026). Written only from OpenRazer, cited beside every command:
//   OpenRazer = github.com/openrazer/openrazer @ 477f4d6d3ab7e9deb6310d5bd3742560c5cbe80d, driver/
//     razerkbd_driver.c: razer_get_report_params (interface and wait per keyboard), razer_send_payload (reply checks),
//       razer_attr_read/write_matrix_brightness, _game_led_state, _macro_led_state, _poll_rate, _charge_level,
//       _charge_status, _charge_low_threshold, _firmware_version (transaction id per keyboard and command), and
//       razer_kbd_probe (which keyboard has which of these)
//     razerchromacommon.c: the class / id / size / argument layout of each command
//     razercommon.h: LED ids, VARSTORE / NOSTORE, status codes;  razerkbd_driver.h: product ids and wait times
//   sheet = docs/brands/razer.md (sections 2-4), which cites the same files.
// The report helpers (CRC, build, parse) are device-library/razer-mouse's, copied so this folder works on its own.
// Not run on a real keyboard: status "untested" in device.json; DeviceHub proves each write with its self-check first.
//
// Settings, each only where OpenRazer has both its read and its write for that keyboard: backlight brightness, game mode
// (OpenRazer: "Game mode will be enabled"; the firmware locks the Windows key), the macro light, polling rate
// (HyperPolling-style codes) and the low-battery threshold; battery and charging on the wireless boards.
// Left out: static colour per zone and every effect (OpenRazer's matrix_effect_* files are write-only: no read-back
// exists), the Fn toggle (write-only), keyswitch optimization and device mode (sheet: high risk), the profile LEDs,
// macros and key remaps (host-side in OpenRazer), and the Huntsman V3 Pro TKL's brightness (OpenRazer writes it but has
// no read for it). Never: dongle pair / unpair (00/46, 00/41, 00/42) and device mode 02 ("factory test mode"), in
// helpers/never-commands.json. Nothing outside CMD below can be built.
import { getDevice } from '../../public/devices/hid.js';

// ---- the 90-byte report (razercommon.h struct razer_report; sheet section 2) ----
export const LEN = 90;
export const STATUS = { 0x00: 'new', 0x01: 'busy', 0x02: 'success', 0x03: 'failure', 0x04: 'timeout', 0x05: 'not supported' };
export const VARSTORE = 0x01, NOSTORE = 0x00;                     // razercommon.h
export const LED = { BACKLIGHT: 0x05, MACRO: 0x07, GAME: 0x08 };   // razercommon.h BACKLIGHT_LED, MACRO_LED, GAME_LED
// crc = XOR of bytes 2..87 (razercommon.c razer_calculate_crc)
export function crc(r) { let c = 0; for (let i = 2; i < 88; i++) c ^= r[i]; return c; }
// razercommon.c get_razer_report: status 0, transaction id, remaining 0, protocol 0, data size, class, id, arguments
export function buildReport(tid, cls, id, size, args = []) {
  if (size > 80 || args.length > 80) throw new Error('a Razer report carries at most 80 argument bytes');
  const r = new Uint8Array(LEN);
  r[1] = tid; r[5] = size; r[6] = cls; r[7] = id;
  r.set(args, 8);
  r[88] = crc(r);
  return r;
}
export function parseReply(u8) {
  return { status: u8[0], tid: u8[1], remaining: (u8[2] << 8) | u8[3], size: u8[5], cls: u8[6], id: u8[7], args: u8.slice(8, 88) };
}

// ---- the only commands this driver builds (razerchromacommon.c) ----
export const CMD = {
  firmware:    { cls: 0x00, id: 0x81, size: 0x02 },   // razer_chroma_standard_get_firmware_version; reply [0].[1]
  extBrightGet:{ cls: 0x0f, id: 0x84, size: 0x03 },   // razer_chroma_extended_matrix_get_brightness [store, led]; reply [2]
  extBrightSet:{ cls: 0x0f, id: 0x04, size: 0x03 },   // razer_chroma_extended_matrix_brightness [store, led, 0-255]
  stdBrightGet:{ cls: 0x03, id: 0x83, size: 0x03 },   // razer_chroma_standard_get_led_brightness [store, led]; reply [2]
  ledStateGet: { cls: 0x03, id: 0x80, size: 0x03 },   // razer_chroma_standard_get_led_state [store, led]; reply [2]
  ledStateSet: { cls: 0x03, id: 0x00, size: 0x03 },   // razer_chroma_standard_set_led_state [store, led, 0/1]
  pollGet:     { cls: 0x00, id: 0xc0, size: 0x01 },   // razer_chroma_misc_get_polling_rate2; reply [1]
  pollSet:     { cls: 0x00, id: 0x40, size: 0x02 },   // razer_chroma_misc_set_polling_rate2 [00, code]
  battery:     { cls: 0x07, id: 0x80, size: 0x02 },   // razer_chroma_misc_get_battery_level; reply [1] 0-255
  charging:    { cls: 0x07, id: 0x84, size: 0x02 },   // razer_chroma_misc_get_charging_status; reply [1] 0/1
  lowBatGet:   { cls: 0x07, id: 0x81, size: 0x01 },   // razer_chroma_misc_get_low_battery_threshold; reply [0]
  lowBatSet:   { cls: 0x07, id: 0x01, size: 0x01 },   // razer_chroma_misc_set_low_battery_threshold [0x0C-0x3F]
  activeStore: { cls: 0x05, id: 0x84, size: 0x01 },   // razerkbd_driver.c razer_get_active_varstore (Huntsman V3 Pro 8KHz); reply [0]
};
// razerchromacommon.c razer_chroma_misc_set_polling_rate2 codes
const bit = (b) => (b === 1 ? true : b === 0 ? false : null);
export const POLL = { 8000: 0x01, 4000: 0x02, 2000: 0x04, 1000: 0x08, 500: 0x10, 250: 0x20, 125: 0x40 };
// offered on every polling keyboard; a higher rate is offered once the keyboard itself reads at it
export const POLL_BASE = [125, 250, 500, 1000];
// razerchromacommon.c razer_chroma_misc_set_low_battery_threshold: clamp(0x0C, 0x3F); "0x3F = 25%, 0x26 = 15%, 0x0C = 5%"
export const LOWBAT_MIN = 0x0c, LOWBAT_MAX = 0x3f;

// ---- the keyboards (razerkbd_driver.h ids; razerkbd_driver.c per-keyboard switches) ----
// iface: razer_get_report_params report_index (the interface the report goes to): 3, 2, or the default 1.
// wait: ms between write and read: RAZER_BLACKWIDOW_CHROMA_WAIT_US 600 us, the _WIRELESS_WAIT_US ones 4900 us.
// bright: matrix_brightness. 'x3f' / 'x1f' / 'x9f' = extended 0x0F/0x84 and 0x0F/0x04 with that transaction id, read and
//   write; 'v3' = written extended (tid 1F), read standard 0x03/0x83 (tid FF) (Huntsman V3 Pro, V3 Pro Mini); '8k' = the
//   same, written to the active profile's store (Huntsman V3 Pro 8KHz); null = no brightness here.
// game: game_led_state, 'v2' = NOSTORE with tid 1F (Huntsman V2 / V2 TKL), else VARSTORE with tid FF.
// macro: macro_led_state (VARSTORE, tid FF) is created for it in razer_kbd_probe.
// poll: poll_rate's transaction id (polling_rate2), or null. bat: charge_level / charge_status transaction id, or null.
// lowBat: charge_low_threshold (tid FF) is created for it.
const W = 0.6, WL = 4.9;
const k = (model, link, iface, wait, bright, o = {}) => ({ model, link, iface, wait, bright, game: 'std', macro: true, poll: null, bat: null, lowBat: false, ...o });
export const MODELS = {
  '0287': k('BlackWidow V4', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '028D': k('BlackWidow V4 Pro', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '02A5': k('BlackWidow V4 75%', 'wired', 3, W, 'x1f', { poll: 0x1f }),
  '0293': k('BlackWidow V4 X', 'wired', 2, W, 'x1f'),
  '02B9': k('BlackWidow V4 Mini HyperSpeed', 'wired', 3, W, 'x1f', { bat: 0x1f }),
  '02BA': k('BlackWidow V4 Mini HyperSpeed', 'wireless', 3, WL, 'x9f', { bat: 0x9f }),
  '02D7': k('BlackWidow V4 TKL HyperSpeed', 'wired', 3, W, 'x1f', { macro: false, poll: 0x1f, bat: 0x1f }),
  '02D5': k('BlackWidow V4 TKL HyperSpeed', 'wireless', 2, WL, 'x9f', { macro: false, poll: 0x9f, bat: 0x9f }),
  '024E': k('BlackWidow V3', 'wired', 3, W, 'x3f'),
  '025A': k('BlackWidow V3 Pro', 'wired', 2, W, 'x3f', { bat: 0x3f, lowBat: true }),
  '025C': k('BlackWidow V3 Pro', 'wireless', 2, WL, 'x9f', { bat: 0x9f, lowBat: true }),
  '0258': k('BlackWidow V3 Mini HyperSpeed', 'wired', 3, W, 'x1f', { bat: 0x1f }),
  '0271': k('BlackWidow V3 Mini HyperSpeed', 'wireless', 3, WL, 'x9f', { bat: 0x9f }),
  '02A6': k('Huntsman V3 Pro', 'wired', 3, W, 'v3'),
  '02A7': k('Huntsman V3 Pro TKL', 'wired', 3, W, null),
  '02B0': k('Huntsman V3 Pro Mini', 'wired', 3, W, 'v3'),
  '02CF': k('Huntsman V3 Pro 8KHz', 'wired', 3, W, '8k'),
  '026C': k('Huntsman V2', 'wired', 3, W, 'x1f', { game: 'v2', poll: 0x1f }),
  '026B': k('Huntsman V2 TKL', 'wired', 3, W, 'x1f', { game: 'v2', poll: 0x1f }),
  '0257': k('Huntsman Mini', 'wired', 2, W, 'x3f'),
  '0295': k('DeathStalker V2', 'wired', 3, W, 'x3f'),
  '0292': k('DeathStalker V2 Pro', 'wired', 3, W, 'x3f', { bat: 0x1f }),
  '0290': k('DeathStalker V2 Pro', 'wireless', 2, WL, 'x9f', { bat: 0x9f }),
  '0298': k('DeathStalker V2 Pro TKL', 'wired', 3, W, 'x3f', { bat: 0x1f }),
  '0296': k('DeathStalker V2 Pro TKL', 'wireless', 2, WL, 'x9f', { bat: 0x9f }),
  '02A1': k('Ornata V3', 'wired', 2, W, 'x1f'),
  '028F': k('Ornata V3', 'wired', 2, W, 'x1f'),
  '02A3': k('Ornata V3 TKL', 'wired', 2, W, 'x1f'),
  '0294': k('Ornata V3 X', 'wired', 1, W, 'x1f'),
  '02A2': k('Ornata V3 X', 'wired', 1, W, 'x1f'),
};
export const PIDS = Object.keys(MODELS);
const BRIGHT = {
  x3f: { get: ['extBrightGet', 0x3f], set: 0x3f }, x1f: { get: ['extBrightGet', 0x1f], set: 0x1f }, x9f: { get: ['extBrightGet', 0x9f], set: 0x9f },
  v3: { get: ['stdBrightGet', 0xff], set: 0x1f }, '8k': { get: ['stdBrightGet', 0xff], set: 0x1f, activeStore: true },
};

// the maker's app (the same process names as device-library/razer-mouse, from helpers/diagnose.mjs)
export const VENDOR_APPS = [/^razer synapse/i, /^razerappengine\.exe$/i];
async function defaultVendorApp() {
  if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') return null;
  const { execFile } = await import('node:child_process');
  const out = await new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (e, so) => res(e ? '' : so)));
  for (const line of out.split(/\r?\n/)) { const name = line.split('","')[0].replace(/^"/, ''); if (VENDOR_APPS.some((re) => re.test(name))) return name; }
  return null;
}
// the control collection: the keyboard's interface (report_index) holding the 91-byte feature report. Its usage page
// moves with firmware (sheet section 2: BlackWidow V4 0x01/0x00 or 0x0C/0x01), so it is chosen by interface and length.
async function defaultOpen(pid, model) {
  return getDevice([{ vendorId: 0x1532, productId: parseInt(pid, 16), iface: model.iface }], { prompt: false });
}
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, '0');
const POLL_EVERY = 10, POLL_FOR = 100, APP_CHECK_MS = 15000;
class RazerError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export function createRazerKeyboard({ sleep = sleepReal, open = defaultOpen, vendorApp = defaultVendorApp, now = () => Date.now() } = {}) {
  return {
    id: 'razer-keyboard',
    title: 'Razer keyboard',
    kind: 'Keyboard',
    vendor: 'Razer',
    hid: { vid: '1532', pid: '0287', pids: PIDS, page: '*', usage: '*', len: LEN, featureLen: LEN, reportId: 0, featureOnly: true,
      byPid: Object.fromEntries(PIDS.map((p) => [p, { iface: MODELS[p].iface }])) },
    unsupported: ['colours and lighting effects (no read-back exists)', 'the Fn toggle (write-only)', 'keyswitch optimization', 'device mode', 'macros and key remaps', 'firmware updates (Razer\'s own updater only)', 'dongle pairing'],
    dev: null, pid: null, model: null, has: null, pollRates: POLL_BASE, raw: {}, q: Promise.resolve(), app: null, appAt: 0,

    get settings() {
      const all = [
        { key: 'brightness', label: 'Backlight brightness', type: 'slider', min: 0, max: 255, step: 1, unit: '/255', live: true, hint: 'Saved on the keyboard; colours and effects stay as they are' },
        { key: 'gameMode', label: 'Game mode', type: 'toggle', hint: 'The keyboard\'s own game mode: the Windows key is locked and the game-mode light is on' },
        { key: 'macroLed', label: 'Macro light', type: 'toggle', hint: 'The macro indicator light only; macros themselves are not changed' },
        { key: 'pollingRate', label: 'Polling rate', type: 'choice', options: this.pollRates.map((hz) => ({ value: hz, label: `${hz} Hz` })) },
        { key: 'lowBattery', label: 'Low-battery warning', type: 'slider', min: LOWBAT_MIN, max: LOWBAT_MAX, step: 1, unit: 'raw', hint: 'Raw 12-63: 12 is about 5%, 38 about 15%, 63 about 25% (OpenRazer)' },
      ];
      return this.has ? all.filter((s) => this.has.has(s.key)) : all;
    },

    async connect() {
      if (this.dev) return true;
      for (const pid of PIDS) {
        const dev = await open(pid, MODELS[pid]);
        if (dev) { this.dev = dev; this.pid = pid; this.model = MODELS[pid]; this.has = null; this.raw = {}; this.pollRates = POLL_BASE; this.app = null; this.appAt = 0; return true; }
      }
      return false;
    },

    // send, wait the keyboard's time, read until the reply answers this request (OpenRazer razer_send_payload: remaining
    // packets, class and id must match; "Some commands respond with 'busy' but succeed. Treat it as success.")
    request(tid, cmd, args = []) {
      const run = async () => {
        await this.dev.sendFeatureReport(0, buildReport(tid, cmd.cls, cmd.id, cmd.size, args));
        await sleep(this.model.wait);
        for (let waited = 0; ; waited += POLL_EVERY) {
          const dv = await this.dev.receiveFeatureReport(0, LEN);
          const r = parseReply(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
          const ours = r.remaining === 0 && r.cls === cmd.cls && r.id === cmd.id;
          if (ours && (r.status === 0x02 || r.status === 0x01)) return r;
          if (ours && r.status === 0x03) throw new RazerError(`the keyboard refused ${hex2(cmd.cls)}/${hex2(cmd.id)} (failure)`, 3);
          if (ours && r.status === 0x04) throw new RazerError('the keyboard did not answer (asleep or out of range)', 4);
          if (ours && r.status === 0x05) throw new RazerError(`${hex2(cmd.cls)}/${hex2(cmd.id)} is not supported with transaction id ${hex2(tid)}`, 5);
          if (waited >= POLL_FOR) throw new RazerError(`no reply to ${hex2(cmd.cls)}/${hex2(cmd.id)} (status ${STATUS[r.status] || hex2(r.status)})`, r.status);
          await sleep(POLL_EVERY);
        }
      };
      const p = this.q.then(run, run);
      this.q = p.catch(() => {});
      return p;
    },
    async get(name, tid, args = []) { const r = await this.request(tid, CMD[name], args); this.raw[name] = Array.from(r.args.slice(0, Math.max(3, CMD[name].size)), hex2).join(' '); return r.args; },

    // ---- the reads, each with the transaction id OpenRazer uses for this keyboard ----
    async readBrightness() { const b = BRIGHT[this.model.bright]; return (await this.get(b.get[0], b.get[1], [VARSTORE, LED.BACKLIGHT]))[2]; },
    gameArgs() { return this.model.game === 'v2' ? { store: NOSTORE, tid: 0x1f } : { store: VARSTORE, tid: 0xff }; },
    // raw 0 / 1 only (driver safety, 22 Oct 2026): another byte reads as null, so it is never written back as 0 or 1
    async readGame() { const g = this.gameArgs(); return bit((await this.get('ledStateGet', g.tid, [g.store, LED.GAME]))[2]); },
    async readMacro() { return bit((await this.get('ledStateGet', 0xff, [VARSTORE, LED.MACRO]))[2]); },
    async readPoll() { const code = (await this.get('pollGet', this.model.poll))[1]; const hz = Object.keys(POLL).find((x) => POLL[x] === code); return hz ? Number(hz) : null; },
    async readLowBat() { return (await this.get('lowBatGet', 0xff))[0]; },

    // which settings answer, by reads only
    async ready() {
      if (this.has) return;
      if (!this.dev) throw Object.assign(new Error('no Razer keyboard is open'), { gone: true });
      const has = new Set();
      const tries = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { if (e.status === 4 || e.gone) throw e; return { ok: false }; } };
      const m = this.model;
      if (m.bright && (await tries(() => this.readBrightness())).ok) has.add('brightness');
      if ((await tries(() => this.readGame())).ok) has.add('gameMode');
      if (m.macro && (await tries(() => this.readMacro())).ok) has.add('macroLed');
      if (m.poll != null) {
        const r = await tries(() => this.readPoll());
        if (r.ok && r.v) { has.add('pollingRate'); if (r.v > 1000) this.pollRates = Object.keys(POLL).map(Number).filter((hz) => hz <= r.v).sort((a, b) => a - b); }
      }
      if (m.lowBat && (await tries(() => this.readLowBat())).ok) has.add('lowBattery');
      this.has = has;
    },

    async info() {
      await this.ready();
      const fw = await this.get('firmware', 0xff);   // razer_attr_read_firmware_version: tid FF on every keyboard
      return { Model: `Razer ${this.model.model}`, Connection: this.model.link === 'wireless' ? 'wireless (dongle)' : 'cable', 'Product id': `1532:${this.pid}`,
        Firmware: `${fw[0]}.${fw[1]}`, Interface: String(this.model.iface) };
    },

    async read() {
      await this.ready();
      const v = {};
      if (this.has.has('brightness')) v.brightness = await this.readBrightness();
      if (this.has.has('gameMode')) v.gameMode = await this.readGame();
      if (this.has.has('macroLed')) v.macroLed = await this.readMacro();
      if (this.has.has('pollingRate')) v.pollingRate = await this.readPoll();
      if (this.has.has('lowBattery')) v.lowBattery = await this.readLowBat();
      return v;
    },

    async appCheck() {
      if (!this.appAt || now() - this.appAt >= APP_CHECK_MS) { this.app = await vendorApp(); this.appAt = now(); }
      if (this.app) throw Object.assign(new Error(`${this.app} is running: close it first (two programs writing the keyboard fight)`), { refused: true, waiting: true });
    },

    // one setting, checked, written, read back
    async write(key, value) {
      await this.ready();
      const s = this.settings.find((x) => x.key === key);
      if (!s) throw new Error(`${key} is not a setting of this keyboard`);
      if (s.type === 'toggle' && typeof value !== 'boolean') throw new Error(`${s.label} is on or off (true / false)`);
      if (s.type === 'slider' && !(Number.isInteger(value) && value >= s.min && value <= s.max)) throw new Error(`${s.label} must be a whole number ${s.min}-${s.max}`);
      if (s.type === 'choice' && !s.options.some((o) => o.value === value)) throw new Error(`${s.label} must be one of ${s.options.map((o) => o.value).join(', ')}`);
      await this.appCheck();
      const m = this.model;
      if (key === 'brightness') {
        const b = BRIGHT[m.bright];
        let store = VARSTORE;
        if (b.activeStore) {
          // OpenRazer writes the 8KHz's brightness to razer_get_active_varstore(); it reads VARSTORE. Only when the two are
          // the same store can the write be read back, so anything else is refused.
          store = (await this.get('activeStore', 0x1f))[0];   // get_razer_report(0x05, 0x84, 0x01): no arguments set
          if (store !== VARSTORE) throw new Error(`the keyboard is on profile store ${store}; its brightness can be read back only on store 1, so it was not written`);
        }
        await this.request(b.set, CMD.extBrightSet, [store, LED.BACKLIGHT, value]);   // [store, BACKLIGHT_LED, 0-255]
      } else if (key === 'gameMode') {
        const g = this.gameArgs();
        await this.request(g.tid, CMD.ledStateSet, [g.store, LED.GAME, value ? 1 : 0]);  // set_led_state [store, GAME_LED, 0/1]
      } else if (key === 'macroLed') {
        await this.request(0xff, CMD.ledStateSet, [VARSTORE, LED.MACRO, value ? 1 : 0]); // set_led_state [VARSTORE, MACRO_LED, 0/1]
      } else if (key === 'pollingRate') {
        await this.request(m.poll, CMD.pollSet, [0x00, POLL[value]]);                   // set_polling_rate2(rate, 0x00): [00, code], once
      } else if (key === 'lowBattery') {
        await this.request(0xff, CMD.lowBatSet, [value]);                                // set_low_battery_threshold [0x0C-0x3F]
      }
      const back = (await this.read())[key];
      if (back !== value) throw new Error(`${key}: wrote ${value}, read back ${back}`);
      return back;
    },

    async battery() {
      await this.ready();
      if (this.model.bat == null) return null;
      const level = (await this.get('battery', this.model.bat))[1];
      return { percent: Math.round((level * 100) / 255), charging: (await this.get('charging', this.model.bat))[1] === 1 };   // OpenRazer: "scaled from 0-255 -> 0-100"
    },

    async rawBackup() { const values = await this.read(); return { pid: this.pid, model: this.model.model, values, replies: { ...this.raw } }; },
  };
}

export default createRazerKeyboard();
