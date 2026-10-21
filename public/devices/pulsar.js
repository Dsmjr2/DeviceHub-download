// Pulsar mouse, original Pulsar config protocol, written from the protocol facts documented by
// OpenMouse (github.com/OpenMouse-Project/mouse-protocol) and the Linux kernel's Pulsar driver
// patch; no code copied. Shawn's 8K dongle (3710:5406) exposes it on usage page 0xFF02, report 8.
//
// Packet (16 bytes, report 8): [cmd, status, addrHi, addrLo, len, data x10, checksum]
// checksum = (0x55 - (0x08 + sum(bytes 0..14))) & 0xFF
// Flash-stored byte settings are stored as [value, (0x55 - value) & 0xFF], which lets us verify every read.
import { HidChannel } from './hid.js';

const REPORT = 8;
const CMD = { deviceOnline: 0x03, battery: 0x04, writeFlash: 0x07, readFlash: 0x08, currentConfig: 0x0e, version: 0x12, dongleVersion: 0x1d };

export const ADDR = {
  pollingRate: 0, stageCount: 2, dpiStage: 4, liftOff: 10, dpiValues: 12,
  // measured 19 Oct 2026 by changing each in the Pulsar app and comparing the flash before and after:
  dpiColors: 44,                                   // 8 x [R, G, B, check], check = 0x55 - (R+G+B)
  effectMode: 76, effectBrightness: 78, effectSpeed: 80, effectOn: 82,  // DPI light: mode 1 steady / 2 breathing, on 0/1
  debounce: 169, motionSync: 171, sleep: 173, angleSnap: 175, ripple: 177,
  turbo: 181,                                      // Turbo Mode 0/1
  sleepMirror: 183,                                // the Pulsar app writes Auto Sleep here too (10-second units)
};
export const DPI_SLOTS = 8;

// Button table: one 4-byte record per button from address 96, [type, code, 0, check] with all four summing to 0x55
// (measured on Shawn's mouse; OpenMouse documents the same table). Record order = Left, Right, Middle, Back, Forward, DPI.
// Only actions this mouse already stores are offered, and record 0 (left click) is never written.
export const BUTTON_TABLE = 96;
export const BUTTONS = ['Left click', 'Right button', 'Wheel click', 'Back (side)', 'Forward (side)', 'DPI button (bottom)'];
export const ACTIONS = {
  left: { label: 'Left click', rec: [1, 1, 0] }, right: { label: 'Right click', rec: [1, 2, 0] }, middle: { label: 'Middle click', rec: [1, 4, 0] },
  back: { label: 'Back', rec: [1, 8, 0] }, forward: { label: 'Forward', rec: [1, 16, 0] },
  dpiCycle: { label: 'DPI cycle', rec: [2, 1, 0] }, dpiUp: { label: 'DPI up', rec: [2, 2, 0] }, dpiDown: { label: 'DPI down', rec: [2, 3, 0] },
};
const withCheck = (r) => [...r, (0x55 - ((r[0] + r[1] + r[2]) & 0xff)) & 0xff];
export function actionOf(rec4) {
  if (!rec4 || ((rec4[0] + rec4[1] + rec4[2] + rec4[3]) & 0xff) !== 0x55) return null;
  return Object.keys(ACTIONS).find((k) => ACTIONS[k].rec.every((b, i) => b === rec4[i])) || null;
}
// Learned in a session with the Pulsar app (19 Oct 2026): every byte below is what the app itself wrote.
// DPI light brightness, levels 1-10 (steady mode only), stored at ADDR.effectBrightness as these values:
export const BRIGHTNESS_LEVELS = [16, 30, 60, 90, 128, 150, 180, 210, 230, 255];
// DPI light speed: levels 1-5 (breathing mode only), stored as the level itself.
// Keyboard keys and key combinations on a button: the button's record becomes [5, 0, 0, check] and the keys go in that
// button's own 32-byte block at 256 + 32 x button: [count, (0x81 = down | 0x41 = up, USB key code, 0) x count, check]
// with check = (0x55 - sum of the bytes before it) & 0xFF; bytes after it are left as they were. The app presses the
// keys in order and releases them in reverse (A down, B down, B up, A up). Key codes are the USB keyboard usage
// codes (A = 4, B = 5 measured).
export const KEY_BLOCKS = 256, KEY_BLOCK_SIZE = 32, MAX_COMBO_KEYS = 5;
const KEY_RECORD = [5, 0, 0];
export function decodeKeys(block) {
  if (!block || block.length < 2) return null;
  const n = block[0];
  if (n < 2 || n > 2 * MAX_COMBO_KEYS || n % 2 || block.length < 2 + 3 * n) return null;
  let sum = 0; for (let i = 0; i <= 3 * n; i++) sum += block[i];
  if (((0x55 - sum) & 0xff) !== block[1 + 3 * n]) return null;
  const ev = Array.from({ length: n }, (_, i) => block.slice(1 + 3 * i, 4 + 3 * i));
  const k = n / 2, downs = ev.slice(0, k), ups = ev.slice(k);
  if (!downs.every((e) => e[0] === 0x81 && e[2] === 0) || !ups.every((e) => e[0] === 0x41 && e[2] === 0)) return null;
  if (!ups.every((e, i) => e[1] === downs[k - 1 - i][1])) return null;
  return `keys:${downs.map((e) => e[1].toString(16).padStart(2, '0')).join(',')}`;
}
export function encodeKeys(codes) {
  const b = [codes.length * 2];
  for (const c of codes) b.push(0x81, c, 0);
  for (const c of [...codes].reverse()) b.push(0x41, c, 0);
  let sum = 0; for (const x of b) sum += x;
  b.push((0x55 - sum) & 0xff);
  return b;
}
export const parseKeys = (v) => (typeof v === 'string' && /^keys:[0-9a-f]{2}(,[0-9a-f]{2}){0,4}$/.test(v) ? v.slice(5).split(',').map((x) => parseInt(x, 16)) : null);
// the keys DeviceHub offers: letters, digits, Enter, Esc, Backspace, Tab, Space, punctuation, F1-F12, Print Screen,
// navigation, arrows, and the left Ctrl / Shift / Alt / Win
const KEY_OK = (c) => (c >= 0x04 && c <= 0x38) || (c >= 0x3a && c <= 0x52) || (c >= 0xe0 && c <= 0xe3);

export const POLLING = { 125: 8, 250: 4, 500: 2, 1000: 1, 2000: 16, 4000: 32, 8000: 64 };
export const LIFT_OFF = { 1: 'Medium', 2: 'High', 3: 'Low' };

export class PulsarMouse {
  constructor(device) {
    this.device = device;
    this.ch = new HidChannel(device, { reportId: REPORT, length: 16, match: (s, r) => r[0] === s[0] });
  }

  async open() { await this.ch.open(); }

  packet(cmd, { addr = 0, len = 0, data = [] } = {}) {
    const p = new Uint8Array(16);
    p[0] = cmd; p[2] = addr >> 8; p[3] = addr & 0xff; p[4] = len;
    p.set(data.slice(0, 10), 5);
    let sum = 0x08; for (let i = 0; i < 15; i++) sum += p[i];
    p[15] = (0x55 - (sum & 0xff)) & 0xff;
    return p;
  }

  async send(cmd, opts) {
    const r = await this.ch.request(this.packet(cmd, opts), { timeoutMs: 1200 });
    return r;
  }

  // Host control on/off. The mouse answers byte 9 = 1 while busy.
  async online(on) {
    for (let i = 0; i < 20; i++) {
      const r = await this.send(CMD.deviceOnline, { data: [on ? 1 : 0] });
      if (r[1] !== 0) throw new Error('mouse refused host control');
      if (r[9] === 1) { await new Promise((res) => setTimeout(res, 10)); continue; }
      if (on && r[5] !== 1) throw new Error('mouse is asleep or out of range: move it and retry');
      return;
    }
    throw new Error('mouse stayed busy');
  }

  // Is the mouse awake? One host-control request and its release, nothing read (21 Oct 2026): a sleeping mouse was
  // looked for with a whole read, about 25 requests, each time.
  async isAwake() {
    const r = await this.send(CMD.deviceOnline, { data: [1] });
    const awake = r[1] === 0 && (r[5] === 1 || r[9] === 1);
    try { await this.send(CMD.deviceOnline, { data: [0] }); } catch {}
    return awake;
  }

  // Every session: enter host control, run fn, always leave host control.
  async session(fn) {
    await this.online(true);
    try { return await fn(); } finally { try { await this.online(false); } catch {} }
  }

  async readFlash(addr, count) {
    const out = [];
    for (let off = 0; off < count; off += 10) {
      const n = Math.min(10, count - off);
      const r = await this.send(CMD.readFlash, { addr: addr + off, len: n });
      if (r[1] !== 0) throw new Error(`flash read at ${addr + off} refused`);
      out.push(...r.slice(5, 5 + n));
    }
    // every byte read from the mouse (a write's own read-back included) keeps the running copy current
    if (this.mirror) out.forEach((b, i) => { if (addr + i < this.mirror.length) this.mirror[addr + i] = b; });
    return out;
  }

  // The flash as last read: the full snapshot plus every byte read since. Fresh = under maxMs since the snapshot.
  freshFlash(maxMs = 30000) { return this.mirror && Date.now() - this.mirrorAt < maxMs ? [...this.mirror] : null; }

  async writeFlash(addr, bytes) {
    for (let off = 0; off < bytes.length; off += 10) {
      const chunk = bytes.slice(off, off + 10);
      const r = await this.send(CMD.writeFlash, { addr: addr + off, len: chunk.length, data: chunk });
      if (r[1] !== 0) throw new Error(`flash write at ${addr + off} refused`);
    }
  }

  async battery() {
    const r = await this.send(CMD.battery);
    // bytes 7-8: the cell voltage in mV, big-endian (19 Oct 2026: 0f 30 = 3888 mV at 50% on the cable); kept only
    // when it is a plausible Li-ion voltage
    const mv = (r[7] << 8) | r[8];
    return r[5] <= 100 ? { percent: r[5], charging: r[6] === 1, mv: mv >= 3000 && mv <= 4500 ? mv : null } : null;
  }

  async version() {
    const r = await this.send(CMD.version);
    const d = await this.send(CMD.dongleVersion);
    // Two bytes, shown in hex: the dongle's 02 25 matches its USB revision 0225.
    const ver = (b) => `${b[5].toString(16)}.${b[6].toString(16).padStart(2, '0')}`;
    return { mouse: ver(r), dongle: ver(d) };
  }

  // Raw snapshot of the settings area (0..199) and the buttons' key blocks (256..447), for backups.
  async snapshot() { const f = await this.session(() => this.readFlash(0, KEY_BLOCKS + KEY_BLOCK_SIZE * 6)); this.mirror = [...f]; this.mirrorAt = Date.now(); return f; }

  // Decode the settings from a snapshot. Each checked byte reports whether its check byte matched.
  static decode(flash) {
    const checked = (a) => ({ value: flash[a], ok: ((flash[a] + flash[a + 1]) & 0xff) === 0x55 });
    const dpis = [];
    for (let i = 0; i < DPI_SLOTS; i++) dpis.push(decodeDpi(flash.slice(ADDR.dpiValues + i * 4, ADDR.dpiValues + i * 4 + 4)));
    return {
      pollingRate: checked(ADDR.pollingRate), dpiStage: checked(ADDR.dpiStage), liftOff: checked(ADDR.liftOff),
      debounce: checked(ADDR.debounce), motionSync: checked(ADDR.motionSync), sleep: checked(ADDR.sleep),
      angleSnap: checked(ADDR.angleSnap), ripple: checked(ADDR.ripple), turbo: checked(ADDR.turbo),
      sleepMirror: checked(ADDR.sleepMirror), stageCount: checked(ADDR.stageCount), stageCountGuess: checked(ADDR.stageCount), dpis,
      effectMode: checked(ADDR.effectMode), effectOn: checked(ADDR.effectOn), effectBrightness: checked(ADDR.effectBrightness), effectSpeed: checked(ADDR.effectSpeed),
      colors: Array.from({ length: DPI_SLOTS }, (_, i) => decodeColor(flash.slice(ADDR.dpiColors + i * 4, ADDR.dpiColors + i * 4 + 4))),
      buttons: BUTTONS.map((_, i) => {
        const rec = flash.slice(BUTTON_TABLE + i * 4, BUTTON_TABLE + i * 4 + 4);
        // a keyboard key or key combination: a valid [5, 0, 0, check] record plus its key block
        if (rec.length === 4 && rec[0] === 5 && rec[1] === 0 && rec[2] === 0 && ((rec[0] + rec[1] + rec[2] + rec[3]) & 0xff) === 0x55) return decodeKeys(flash.slice(KEY_BLOCKS + i * KEY_BLOCK_SIZE, KEY_BLOCKS + (i + 1) * KEY_BLOCK_SIZE));
        return actionOf(rec);
      }),
    };
  }

  // Write ONE checked byte, then read it back and compare.
  async writeChecked(addr, value) {
    const allowed = [ADDR.pollingRate, ADDR.dpiStage, ADDR.liftOff, ADDR.debounce, ADDR.motionSync, ADDR.angleSnap, ADDR.ripple,
      ADDR.stageCount, ADDR.turbo, ADDR.effectMode, ADDR.effectOn, ADDR.effectBrightness, ADDR.effectSpeed];
    if (!allowed.includes(addr)) throw new Error(`address ${addr} is not a setting DeviceHub writes`);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`byte ${value} is not valid`);
    return this.session(async () => {
      await this.writeFlash(addr, [value & 0xff, (0x55 - value) & 0xff]);
      const [v, c] = await this.readFlash(addr, 2);
      if (v !== (value & 0xff) || ((v + c) & 0xff) !== 0x55) throw new Error(`mouse reads ${v} after writing ${value}`);
      return v;
    });
  }

  // Auto Sleep, in 10-second units (1 = 10 s ... 180 = 30 min, the Pulsar app's range). Written to both places the
  // Pulsar app writes it, then both are read back.
  async writeSleep(units) {
    if (!Number.isInteger(units) || units < 1 || units > 180) throw new Error('auto sleep must be 10 seconds to 30 minutes');
    const pair = [units, (0x55 - units) & 0xff];
    return this.session(async () => {
      await this.writeFlash(ADDR.sleep, pair);
      await this.writeFlash(ADDR.sleepMirror, pair);
      const a = await this.readFlash(ADDR.sleep, 2), b = await this.readFlash(ADDR.sleepMirror, 2);
      if (a[0] !== units || b[0] !== units || ((a[0] + a[1]) & 0xff) !== 0x55) throw new Error(`mouse reads ${a[0]} / ${b[0]} after writing ${units}`);
      return units;
    });
  }

  // ONE DPI stage color, then read back.
  async writeColor(slot, [r, g, b]) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= DPI_SLOTS) throw new Error('bad DPI slot');
    if (![r, g, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) throw new Error('bad color');
    const rec = [r, g, b, (0x55 - ((r + g + b) & 0xff)) & 0xff];
    return this.session(async () => {
      await this.writeFlash(ADDR.dpiColors + slot * 4, rec);
      const back = decodeColor(await this.readFlash(ADDR.dpiColors + slot * 4, 4));
      if (!back || back.join() !== [r, g, b].join()) throw new Error(`mouse reads ${back} after writing ${[r, g, b]}`);
      return back;
    });
  }

  // Write ONE button record (buttons 1-5; left click is never written), then read it back.
  async writeButton(index, action) {
    if (!Number.isInteger(index) || index < 1 || index >= BUTTONS.length) throw new Error('that button cannot be remapped');
    if (!Object.hasOwn(ACTIONS, action)) throw new Error(`unknown button action ${action}`);
    const rec = withCheck(ACTIONS[action].rec);
    const addr = BUTTON_TABLE + index * 4;
    return this.session(async () => {
      await this.writeFlash(addr, rec);
      const back = await this.readFlash(addr, 4);
      if (actionOf(back) !== action) throw new Error(`button reads ${back.join(',')} after writing ${rec.join(',')}`);
      return action;
    });
  }

  // A keyboard key or key combination on ONE button (1-5): the key block first, read back, then the button record,
  // read back, so the button never points at a half-written block.
  async writeKeys(index, codes) {
    if (!Number.isInteger(index) || index < 1 || index >= BUTTONS.length) throw new Error('that button cannot be remapped');
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > MAX_COMBO_KEYS || !codes.every((c) => Number.isInteger(c) && KEY_OK(c))) throw new Error('a key combination is 1 to 5 keyboard keys');
    if (new Set(codes).size !== codes.length) throw new Error('each key can be in a combination only once');
    const block = encodeKeys(codes), at = KEY_BLOCKS + index * KEY_BLOCK_SIZE, rec = withCheck(KEY_RECORD), recAt = BUTTON_TABLE + index * 4;
    return this.session(async () => {
      await this.writeFlash(at, block);
      const backBlock = await this.readFlash(at, block.length);
      if (backBlock.join() !== block.join()) throw new Error(`key block reads ${backBlock.join(',')} after writing ${block.join(',')}`);
      await this.writeFlash(recAt, rec);
      const backRec = await this.readFlash(recAt, 4);
      if (backRec.join() !== rec.join()) throw new Error(`button reads ${backRec.join(',')} after writing ${rec.join(',')}`);
      return decodeKeys(block);
    });
  }

  // Write ONE DPI slot (100..10000, 10-DPI steps only), then read it back and decode.
  async writeDpi(slot, dpi) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= DPI_SLOTS) throw new Error('bad DPI slot');
    const bytes = encodeDpi(dpi);
    return this.session(async () => {
      await this.writeFlash(ADDR.dpiValues + slot * 4, bytes);
      const back = decodeDpi(await this.readFlash(ADDR.dpiValues + slot * 4, 4));
      if (back !== dpi) throw new Error(`mouse reads ${back} DPI after writing ${dpi}`);
      return back;
    });
  }
}

// A color record [R, G, B, check]; null if the check byte does not match.
export function decodeColor(rec) {
  if (!rec || rec.length < 4 || ((0x55 - ((rec[0] + rec[1] + rec[2]) & 0xff)) & 0xff) !== rec[3]) return null;
  return [rec[0], rec[1], rec[2]];
}

export const DPI_MAX = 26000;
// Low range: raw = dpi/10 - 1 (10-DPI steps). High range from 10050: raw = (dpi - 10050)/50 with flag 0x22
// (50-DPI steps; matches the 12800 stages the Pulsar app stored on Shawn's mouse). The two high bits of raw
// go in flag bits 2-3 and 6-7. Every encoding is decoded again before it is sent.
export function encodeDpi(dpi) {
  if (!Number.isInteger(dpi) || dpi < 50 || dpi > DPI_MAX) throw new Error(`DPI must be 50-${DPI_MAX}`);
  let raw, ex = 0;
  if (dpi <= 10000) {
    if (dpi % 10) throw new Error('below 10000, DPI goes in steps of 10');
    raw = dpi / 10 - 1;
  } else {
    if (dpi < 10050 || (dpi - 10050) % 50) throw new Error('above 10000, DPI goes in steps of 50 starting at 10050');
    raw = (dpi - 10050) / 50; ex = 0x22;
  }
  const hi = (raw >> 8) & 0x03;
  const b = [raw & 0xff, raw & 0xff, ex | (hi << 2) | (hi << 6)];
  const out = [...b, (0x55 - ((b[0] + b[1] + b[2]) & 0xff)) & 0xff];
  if (decodeDpi(out) !== dpi) throw new Error(`could not encode ${dpi} DPI safely`);
  return out;
}

// Snap any number to the nearest DPI the mouse can store.
export function snapDpi(v) {
  v = Math.max(50, Math.min(DPI_MAX, Math.round(v)));
  if (v <= 10000) return Math.max(50, Math.round(v / 10) * 10);
  return Math.max(10050, 10050 + Math.round((v - 10050) / 50) * 50);
}

export function decodeDpi(b) {
  if (b.length < 4 || b[0] !== b[1] || ((b[0] + b[1] + b[2] + b[3]) & 0xff) !== 0x55) return null;
  const raw = b[0] + ((b[2] & 0x0c) >> 2) * 256;
  let dpi = (raw + 1) * 10;
  if (b[2] & 0x02) dpi = dpi * 5 + 10000;
  if (b[2] & 0x01) dpi *= 2;
  return dpi;
}
