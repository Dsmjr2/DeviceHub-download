// Epomaker P75 over the VIA raw-HID interface (usage page 0xFF60, usage 0x61, 32-byte reports).
// Command ids from QMK quantum/via.h. Deliberately NOT implemented, so they can never be sent:
//   0x06 dynamic_keymap_reset, 0x0A eeprom_reset, 0x0B bootloader_jump, 0x10 macro_reset.
import { HidChannel, getDevice } from './hid.js';

const CMD = {
  protocolVersion: 0x01,
  getKeyboardValue: 0x02,
  getKeycode: 0x04,
  setKeycode: 0x05,
  customSet: 0x07,
  customGet: 0x08,
  customSave: 0x09,
  layerCount: 0x11,
  getBuffer: 0x12,
  macroCount: 0x0c,
  macroSize: 0x0d,
  macroGet: 0x0e,
  macroSet: 0x0f,
  getEncoder: 0x14,
  setEncoder: 0x15,
};
// How many leading bytes of each request the reply echoes (from QMK quantum/via.c).
export const ECHO = { 0x01: 1, 0x02: 2, 0x04: 4, 0x05: 6, 0x07: 3, 0x08: 3, 0x09: 2, 0x0c: 1, 0x0d: 1, 0x0e: 4, 0x0f: 4, 0x11: 1, 0x12: 4, 0x14: 4, 0x15: 4 };
const FORBIDDEN = new Set([0x06, 0x0a, 0x0b, 0x10, 0x13]); // 0x13 bulk keymap write: keys are written one at a time
const KV = { uptime: 0x01, layoutOptions: 0x02, firmwareVersion: 0x04 };

// VIA "custom" channels and the rgb_matrix value ids.
export const CHANNEL = { backlight: 1, rgblight: 2, rgbMatrix: 3, ledMatrix: 5 };
export const RGB = { brightness: 1, effect: 2, speed: 3, color: 4 };

export const FILTERS = [{ vendorId: 0x342d, productId: 0xe479, usagePage: 0xff60, usage: 0x61 }];
// another VIA keyboard found by the agent (helpers/via-defs.js): connect to it instead of the P75
export function useKeyboardIds(vendorId, productId) { FILTERS[0].vendorId = vendorId; FILTERS[0].productId = productId; }

export class ViaKeyboard {
  constructor(device) {
    this.device = device;
    // VIA replies echo the request header (QMK via.c fills data in place); an unhandled command comes back as
    // 0xFF followed by the same header. A reply must match the header, so a late answer to another request is ignored.
    this.ch = new HidChannel(device, { reportId: 0, length: 32, match: (s, r) => {
      if (r[0] !== s[0] && r[0] !== 0xff) return false;
      const n = ECHO[s[0]] ?? 1;
      for (let i = 1; i < n; i++) if (r[i] !== s[i]) return false;
      return true;
    } });
    this.lightingChannel = null;
  }

  static async connect(prompt = true) {
    const d = await getDevice(FILTERS, { prompt });
    if (!d) return null;
    const kb = new ViaKeyboard(d);
    await kb.ch.open();
    return kb;
  }

  async cmd(bytes) {
    if (FORBIDDEN.has(bytes[0])) throw new Error(`refusing VIA command 0x${bytes[0].toString(16)}`);
    const r = await this.ch.request(bytes);
    if (r[0] === 0xff) throw new Error(`keyboard does not handle command 0x${bytes[0].toString(16)}`);
    return r;
  }

  async info() {
    const p = await this.cmd([CMD.protocolVersion]);
    const protocol = (p[1] << 8) | p[2];
    let firmware = null, uptimeMs = null;
    try { const f = await this.cmd([CMD.getKeyboardValue, KV.firmwareVersion]); firmware = u32(f, 2); } catch {}
    try { const u = await this.cmd([CMD.getKeyboardValue, KV.uptime]); uptimeMs = u32(u, 2); } catch {}
    const layers = (await this.cmd([CMD.layerCount]))[1];
    return { name: this.device.productName, protocol, firmware, uptimeMs, layers };
  }

  // Lighting: find which custom channel answers (rgb_matrix first, then rgblight, then backlight).
  async findLightingChannel() {
    if (this.lightingChannel) return this.lightingChannel;
    for (const ch of [CHANNEL.rgbMatrix, CHANNEL.rgblight, CHANNEL.ledMatrix, CHANNEL.backlight]) {
      try {
        const r = await this.ch.request([CMD.customGet, ch, RGB.brightness]);
        if (r[0] === CMD.customGet && r[1] === ch) { this.lightingChannel = ch; return ch; }
      } catch {}
    }
    return null;
  }

  async getLighting() {
    const ch = await this.findLightingChannel();
    if (!ch) return null;
    const get = async (id) => (await this.cmd([CMD.customGet, ch, id])).slice(3, 5);
    const [b] = await get(RGB.brightness);
    const [e] = await get(RGB.effect);
    const [s] = await get(RGB.speed);
    const [h, sat] = await get(RGB.color);
    return { channel: ch, brightness: b, effect: e, speed: s, hue: h, saturation: sat };
  }

  // Write ONE lighting value, re-read it, and only then save to EEPROM.
  async setLighting(key, value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${key} must be a whole number from 0 to 255`);
    const ch = await this.findLightingChannel();
    if (!ch) throw new Error('no lighting channel');
    const id = RGB[key === 'hue' || key === 'saturation' ? 'color' : key];
    let payload;
    if (id === RGB.color) {
      const cur = await this.getLighting();
      const hue = key === 'hue' ? value : cur.hue;
      const sat = key === 'saturation' ? value : cur.saturation;
      payload = [hue & 0xff, sat & 0xff];
    } else {
      payload = [value & 0xff];
    }
    await this.cmd([CMD.customSet, ch, id, ...payload]);
    let after = await this.getLighting();
    // the P75 keeps a little less brightness/speed than it is sent (250 -> 247), so putting a read value back drifted
    // down a step each time (20 Oct 2026): send one more at a time (at most 4) until it keeps at least what was asked
    if ((key === 'brightness' || key === 'speed') && value > 0) {
      for (let d = 1; d <= 4 && after[key] < value && value + d <= 255; d++) {
        await this.cmd([CMD.customSet, ch, id, value + d]);
        after = await this.getLighting();
      }
    }
    // brightness and speed are kept in the keyboard's own steps (20 Oct 2026: the P75 reads 63 after 64), so a value
    // within 4 is the keyboard's rounding (253 -> 250) and counts as set; what it kept is what is shown
    const close = (key === 'brightness' || key === 'speed') && value > 0 && Math.abs(after[key] - value) <= 4;
    if (after[key] !== (value & 0xff) && !close) throw new Error(`keyboard reports ${key}=${after[key]} after writing ${value}`);
    await this.cmd([CMD.customSave, ch]);
    return after;
  }

  // Keymap: needs the matrix size (rows x cols), which VIA keeps in the keyboard's JSON definition.
  async readKeymap(rows, cols) {
    const info = await this.info();
    const total = info.layers * rows * cols * 2;
    const bytes = new Uint8Array(total);
    for (let off = 0; off < total; off += 28) {
      const size = Math.min(28, total - off);
      const r = await this.cmd([CMD.getBuffer, off >> 8, off & 0xff, size]);
      bytes.set(r.slice(4, 4 + size), off);
    }
    const layers = [];
    for (let l = 0; l < info.layers; l++) {
      const layer = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) { const i = ((l * rows + r) * cols + c) * 2; row.push((bytes[i] << 8) | bytes[i + 1]); }
        layer.push(row);
      }
      layers.push(layer);
    }
    return layers;
  }

  // Macros: one shared buffer, macros separated by 0x00.
  async macroInfo() {
    const c = await this.cmd([CMD.macroCount]);
    const s = await this.cmd([CMD.macroSize]);
    return { count: c[1], size: (s[1] << 8) | s[2] };
  }

  async readMacroBuffer(size) {
    const out = new Uint8Array(size);
    for (let off = 0; off < size; off += 28) {
      const n = Math.min(28, size - off);
      const r = await this.cmd([CMD.macroGet, off >> 8, off & 0xff, n]);
      out.set(r.slice(4, 4 + n), off);
    }
    return out;
  }

  // Writes bytes [0, data.length) of the macro buffer, then reads them back and compares.
  async writeMacroBuffer(data) {
    for (let off = 0; off < data.length; off += 28) {
      const chunk = data.slice(off, off + 28);
      await this.cmd([CMD.macroSet, off >> 8, off & 0xff, chunk.length, ...chunk]);
    }
    const back = await this.readMacroBuffer(data.length);
    for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) throw new Error(`macro byte ${i} reads ${back[i]} after writing ${data[i]}`);
  }

  // Knob (encoder) actions: 0x14 get / 0x15 set, per layer, encoder id and direction.
  async getEncoder(layer, id, clockwise) {
    const r = await this.cmd([CMD.getEncoder, layer, id, clockwise ? 1 : 0]);
    return (r[4] << 8) | r[5];
  }

  async setEncoder(layer, id, clockwise, keycode) {
    await this.cmd([CMD.setEncoder, layer, id, clockwise ? 1 : 0, keycode >> 8, keycode & 0xff]);
    const now = await this.getEncoder(layer, id, clockwise);
    if (now !== keycode) throw new Error(`knob reads 0x${now.toString(16)} after writing 0x${keycode.toString(16)}`);
    return now;
  }

  async getKeycode(layer, row, col) {
    const r = await this.cmd([CMD.getKeycode, layer, row, col]);
    return (r[4] << 8) | r[5];
  }

  // Set one key, then re-read it to confirm (VIA writes keymap changes to EEPROM itself).
  async setKeycode(layer, row, col, keycode) {
    if ((keycode >= 0x7c00 && keycode <= 0x7c03) || keycode === 0x7e0a) throw new Error('refusing to assign a reset/bootloader keycode');
    await this.cmd([CMD.setKeycode, layer, row, col, keycode >> 8, keycode & 0xff]);
    const now = await this.getKeycode(layer, row, col);
    if (now !== keycode) throw new Error(`key ${layer}/${row}/${col} reads 0x${now.toString(16)} after writing 0x${keycode.toString(16)}`);
    return now;
  }
}

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
