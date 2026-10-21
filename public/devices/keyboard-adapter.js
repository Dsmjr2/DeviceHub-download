// Any VIA keyboard (20 Oct 2026); built for the Epomaker P75 (VIA protocol 12, verified on Shawn's board: 5 layers,
// 6x15 matrix, one knob). Another VIA keyboard uses its VIA definition's layout (via-layout.js; the agent picks it,
// helpers/via-defs.js): its matrix size, where its keys are, and a check that the keymap read with it is plausible.
// Write keys used by the device manager:
//   brightness | effect | speed | hue | saturation   lighting (0-255, saved after the re-read)
//   key:<layer>:<row>:<col>                         one keycode
//   enc:<layer>:<id>:<cw 0|1>                        one knob direction
//   macro:<index>                                    one macro's text (the whole buffer is rewritten and re-read)
import { ViaKeyboard } from './via.js';
import { isDangerous } from './keycodes.js';
import { encodeMacro, decodeMacro, splitMacros, joinMacros } from './macros.js';
import { P75, keymapLooksRight } from './via-layout.js';

let layout = P75;
// the agent sets the layout of the VIA keyboard it found (null: the P75)
export function useLayout(l) { layout = l || P75; }
let kb = null;
let base = null;           // session data: { info, keymap, encoders, macros, macroInfo, original }
let lightingOk = false;

// The matrix size is not reported by VIA: the layout gives it, and the base layer read with it must look right
// (the P75: its measured keys; another keyboard: few empty or repeated codes where keys are) before anything is edited.

async function loadEncoders(layers) {
  const enc = [];
  try {
    for (let l = 0; l < layers; l++) enc.push([await kb.getEncoder(l, 0, false), await kb.getEncoder(l, 0, true)]);
    return enc;
  } catch { return null; }
}

async function loadMacros() {
  const mi = await kb.macroInfo();
  const buf = await kb.readMacroBuffer(mi.size);
  const parts = splitMacros(buf, mi.count);
  const list = parts.map((p) => decodeMacro(p));
  // A macro made elsewhere (VIA) may use steps the text form cannot show exactly; those are not editable here.
  const editable = parts.map((p, i) => { try { return sameBytes(encodeMacro(list[i]), p); } catch { return false; } });
  return { mi, buf, list, editable, raw: parts.map((p) => [...p]) };
}

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const LIGHT_KEYS = ['brightness', 'effect', 'speed', 'hue', 'saturation'];

// Parses "key:l:r:c" / "enc:l:id:cw" strictly against the measured board; anything else throws.
function index(parts, limits, what) {
  if (parts.length !== limits.length || !parts.every((p) => /^\d+$/.test(p))) throw new Error(`bad ${what} address`);
  const n = parts.map(Number);
  n.forEach((x, i) => { if (x >= limits[i]) throw new Error(`${what} address ${n.join(',')} is outside the keyboard`); });
  return n;
}

const adapter = {
  id: 'keyboard',
  get title() { return layout.name; },
  kind: 'Keyboard',
  get vendor() { return layout === P75 ? { label: 'Epomaker driver', app: 'epomaker' } : { label: 'VIA', app: 'via' }; },
  get unsupported() { return layout === P75 ? ['per-key colors', 'battery level', 'sleep timer', 'wireless pairing setup'] : ['per-key colors', 'battery level', 'firmware updates']; },
  owns: (d) => d === kb?.device,
  get session() { return base; },

  async connect(prompt) {
    kb = await ViaKeyboard.connect(prompt);
    if (!kb) return false;
    const info = await kb.info();
    if (!(info.protocol >= 7 && info.protocol <= 0x20)) throw new Error(`answered VIA version ${info.protocol}: firmware does not speak VIA`);
    const keymap = await kb.readKeymap(layout.rows, layout.cols);
    if (!keymapLooksRight(layout, keymap)) throw new Error(`the keymap does not match the ${layout.name} layout; editing is blocked to be safe`);
    const encoders = await loadEncoders(info.layers);
    const macros = await loadMacros();
    lightingOk = !!(await kb.findLightingChannel());
    base = { info, keymap, encoders, macros, layout, original: keymap.map((l) => l.map((r) => [...r])) };
    return true;
  },

  async info() {
    const i = base.info;
    return { Model: i.name || layout.name, Protocol: `VIA ${i.protocol}`, Layers: i.layers, Matrix: `${layout.rows} × ${layout.cols}`, Layout: layout.builtIn ? 'built in' : 'VIA definition', Knob: base.encoders ? 'yes' : 'no', Macros: `${base.macros.mi.count} slots` };
  },

  battery: async () => null,

  async read() {
    if (!lightingOk) return {};
    const l = await kb.getLighting();
    return { brightness: l.brightness, effect: l.effect, speed: l.speed, hue: l.hue, saturation: l.saturation };
  },

  // Lighting writes never change what rawBackup holds (keymap, knob, macros), so its last dump stays valid.
  rawUnaffected: (key) => LIGHT_KEYS.includes(key),

  // Everything, freshly read from the board, for the backup file.
  async rawBackup() {
    const keymap = await kb.readKeymap(layout.rows, layout.cols);
    const encoders = await loadEncoders(base.info.layers);
    const macros = await loadMacros();
    return { model: layout.name, rows: layout.rows, cols: layout.cols, layers: base.info.layers, keymap, encoders, macroBuffer: [...macros.buf.slice(0, macros.raw.reduce((n, m) => n + m.length + 1, 0))] };
  },

  async write(key, value) {
    const [kind, ...rest] = key.split(':');
    const layers = base.info.layers;
    if (kind === 'key' || kind === 'enc') {
      if (!isInt(value, 0, 0xffff)) throw new Error(`keycode ${value} is not valid`);
      if (isDangerous(value)) throw new Error('reset / bootloader keycodes are blocked');
    }
    if (kind === 'key') {
      const [l, r, col] = index(rest, [layers, layout.rows, layout.cols], 'key');
      if (!layout.keys.some((k) => k.row === r && k.col === col)) throw new Error('there is no key at that place on this keyboard');
      const now = await kb.setKeycode(l, r, col, value);
      base.keymap[l][r][col] = now;
      return now;
    }
    if (kind === 'enc') {
      if (!base.encoders) throw new Error('this keyboard has no readable knob');
      const [l, id, cw] = index(rest, [layers, 1, 2], 'knob');
      const now = await kb.setEncoder(l, id, cw === 1, value);
      base.encoders[l][cw] = now;
      return now;
    }
    if (kind === 'macro' || kind === 'macroRaw') {
      const [idx] = index(rest, [base.macros.mi.count], 'macro');
      const { mi, raw } = base.macros;
      let bytes1;
      if (kind === 'macroRaw') {
        // Restore exactly the bytes a backup holds (no text round trip).
        if (!Array.isArray(value) || !value.every((x) => isInt(x, 1, 255))) throw new Error('macro bytes from the backup are not valid');
        bytes1 = value;
      } else {
        if (typeof value !== 'string') throw new Error('macro text must be text');
        if (!base.macros.editable[idx] && raw[idx].length) throw new Error('this macro was made in another app with steps DeviceHub cannot show exactly; edit it there');
        bytes1 = encodeMacro(value);
      }
      const next = raw.map((m, i) => (i === idx ? bytes1 : m));
      const bytes = joinMacros(next);
      if (bytes.length > mi.size) throw new Error(`macros are too long (${bytes.length} of ${mi.size} bytes)`);
      const oldLen = joinMacros(raw).length;
      while (bytes.length < oldLen) bytes.push(0); // clear what the old, longer text used
      await kb.writeMacroBuffer(bytes);
      base.macros = await loadMacros();
      if (!sameBytes(base.macros.raw[idx], bytes1)) throw new Error('macro did not read back as written');
      return kind === 'macroRaw' ? [...base.macros.raw[idx]] : base.macros.list[idx];
    }
    if (LIGHT_KEYS.includes(key)) {
      if (!lightingOk) throw new Error('this keyboard did not answer the lighting channel');
      if (!isInt(value, 0, 255)) throw new Error(`${key} must be a whole number from 0 to 255`);
      try {
        const after = await kb.setLighting(key, value);
        return after[key];
      } catch (e) {
        // 20 Oct 2026: with the effect set to None (lights off), the P75 keeps brightness at 0 whatever it is sent
        if (key === 'brightness' && value > 0 && /reports brightness=0/.test(e.message)) throw new Error('the lights are off (effect: None). Pick an effect first');
        throw e;
      }
    }
    throw new Error(`unknown keyboard setting ${key}`);
  },

  // Unified lighting: keep the effect, set color and brightness (three confirmed writes).
  lightingKeys(r, g, b, brightness) {
    const { hue, sat } = rgbToHsv255(r, g, b);
    return [['hue', hue], ['saturation', sat], ['brightness', Math.round((brightness / 100) * 255)]];
  },
  hasLighting: () => lightingOk,
};
export default adapter;

export function rgbToHsv255(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hDeg = 0;
  if (d) hDeg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hDeg = (hDeg * 60 + 360) % 360;
  return { hue: Math.round((hDeg / 360) * 255), sat: Math.round((max ? d / max : 0) * 255) };
}

export function hsv255ToHex(h, s, v = 255) {
  const H = (h / 255) * 360, S = s / 255, V = v / 255;
  const f = (n) => { const k = (n + H / 60) % 6; return V - V * S * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}
