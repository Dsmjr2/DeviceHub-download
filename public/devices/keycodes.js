// QMK keycodes as VIA protocol 12 reports them (QMK 0.20+ numbering, quantum/keycodes.h).
const BASIC = {
  0x00: 'None', 0x01: '▽ (same as layer below)',
  0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F', 0x0a: 'G', 0x0b: 'H', 0x0c: 'I', 0x0d: 'J',
  0x0e: 'K', 0x0f: 'L', 0x10: 'M', 0x11: 'N', 0x12: 'O', 0x13: 'P', 0x14: 'Q', 0x15: 'R', 0x16: 'S', 0x17: 'T',
  0x18: 'U', 0x19: 'V', 0x1a: 'W', 0x1b: 'X', 0x1c: 'Y', 0x1d: 'Z',
  0x1e: '1', 0x1f: '2', 0x20: '3', 0x21: '4', 0x22: '5', 0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',
  0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=', 0x2f: '[',
  0x30: ']', 0x31: '\\', 0x32: '#', 0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/', 0x39: 'Caps Lock',
  0x3a: 'F1', 0x3b: 'F2', 0x3c: 'F3', 0x3d: 'F4', 0x3e: 'F5', 0x3f: 'F6', 0x40: 'F7', 0x41: 'F8', 0x42: 'F9',
  0x43: 'F10', 0x44: 'F11', 0x45: 'F12', 0x46: 'Print Screen', 0x47: 'Scroll Lock', 0x48: 'Pause', 0x49: 'Insert',
  0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'Page Down', 0x4f: '→', 0x50: '←', 0x51: '↓', 0x52: '↑',
  0x53: 'Num Lock', 0x54: 'Num /', 0x55: 'Num *', 0x56: 'Num -', 0x57: 'Num +', 0x58: 'Num Enter',
  0x59: 'Num 1', 0x5a: 'Num 2', 0x5b: 'Num 3', 0x5c: 'Num 4', 0x5d: 'Num 5', 0x5e: 'Num 6', 0x5f: 'Num 7',
  0x60: 'Num 8', 0x61: 'Num 9', 0x62: 'Num 0', 0x63: 'Num .', 0x64: 'ISO \\', 0x65: 'Menu',
  0x68: 'F13', 0x69: 'F14', 0x6a: 'F15', 0x6b: 'F16', 0x6c: 'F17', 0x6d: 'F18', 0x6e: 'F19', 0x6f: 'F20',
  0x70: 'F21', 0x71: 'F22', 0x72: 'F23', 0x73: 'F24',
  0xa5: 'Power', 0xa6: 'Sleep', 0xa7: 'Wake', 0xa8: 'Mute', 0xa9: 'Volume +', 0xaa: 'Volume −', 0xab: 'Next track',
  0xac: 'Previous track', 0xad: 'Stop', 0xae: 'Play/Pause', 0xaf: 'Media select', 0xb0: 'Eject', 0xb1: 'Mail',
  0xb2: 'Calculator', 0xb3: 'My Computer', 0xb4: 'Web search', 0xb5: 'Web home', 0xb6: 'Web back', 0xb7: 'Web forward',
  0xb8: 'Web stop', 0xb9: 'Web refresh', 0xba: 'Web favourites', 0xbb: 'Fast forward', 0xbc: 'Rewind',
  0xbd: 'Screen brightness +', 0xbe: 'Screen brightness −', 0xbf: 'Control panel', 0xc0: 'Assistant',
  0xcd: 'Mouse ↑', 0xce: 'Mouse ↓', 0xcf: 'Mouse ←', 0xd0: 'Mouse →', 0xd1: 'Mouse button 1', 0xd2: 'Mouse button 2',
  0xd3: 'Mouse button 3', 0xd9: 'Wheel ↑', 0xda: 'Wheel ↓',
  0xe0: 'Left Ctrl', 0xe1: 'Left Shift', 0xe2: 'Left Alt', 0xe3: 'Left Win', 0xe4: 'Right Ctrl', 0xe5: 'Right Shift',
  0xe6: 'Right Alt', 0xe7: 'Right Win',
};
const LIGHTING = {
  0x7820: 'RGB on/off', 0x7821: 'RGB next effect', 0x7822: 'RGB previous effect', 0x7823: 'RGB hue +', 0x7824: 'RGB hue −',
  0x7825: 'RGB saturation +', 0x7826: 'RGB saturation −', 0x7827: 'RGB brightness +', 0x7828: 'RGB brightness −',
  0x7829: 'RGB speed +', 0x782a: 'RGB speed −',
};
// Epomaker's custom keycodes as its official P65 VIA file names them (epomaker.com, EPOMAKER_P65_via_json.zip).
// The P75 uses a different firmware build, so these are hints, not facts. 10 ("reset button") is never offered.
const EPOMAKER_P65 = ['2.4G mode', 'Bluetooth 1', 'Bluetooth 2', 'Bluetooth 3', 'USB mode', 'Battery check', 'Win lock', '6-key / full-key switch', 'Media-key switch', 'LED on/off', 'Reset button'];

// QMK RGB-matrix effect order, as Epomaker's P65 VIA file lists it. The P75 may enable a different set.
export const EFFECTS = ['none', 'solid color', 'alphas mods', 'gradient up-down', 'gradient left-right', 'breathing', 'band sat', 'band val',
  'pinwheel sat', 'pinwheel val', 'spiral sat', 'spiral val', 'cycle all', 'cycle left-right', 'cycle up-down', 'cycle out-in', 'cycle out-in dual',
  'rainbow chevron', 'cycle pinwheel', 'cycle spiral', 'dual beacon', 'rainbow beacon', 'rainbow pinwheels', 'flower blooming', 'raindrops',
  'jellybean raindrops', 'hue breathing', 'hue pendulum', 'hue wave', 'pixel flow', 'digital rain', 'reactive', 'reactive wide', 'reactive multiwide',
  'reactive cross', 'reactive multicross', 'reactive nexus', 'reactive multinexus', 'splash', 'multisplash', 'solid splash', 'solid multisplash',
  'starlight', 'starlight dual hue', 'starlight dual sat', 'riverflow'];

const MODS = [[0x01, 'Ctrl'], [0x02, 'Shift'], [0x04, 'Alt'], [0x08, 'Win']];

// Keycodes that reset or reflash the keyboard. Never offered, and refused if typed in.
export const isDangerous = (k) => (k >= 0x7c00 && k <= 0x7c03) || k === 0x7e0a;

export function keyName(k) {
  if (BASIC[k] != null) return BASIC[k];
  if (LIGHTING[k]) return LIGHTING[k];
  if (k >= 0x0100 && k <= 0x1fff) { // modifier + key
    const m = (k >> 8) & 0x1f, side = m & 0x10 ? 'R' : '';
    const mods = MODS.filter(([b]) => m & b).map(([, n]) => side + n).join('+');
    return `${mods}+${BASIC[k & 0xff] ?? hex(k & 0xff)}`;
  }
  if (k >= 0x4000 && k <= 0x4fff) return `Layer ${(k >> 8) & 0xf} when held, ${BASIC[k & 0xff] ?? hex(k & 0xff)} when tapped`;
  if (k >= 0x5200 && k <= 0x521f) return `Go to layer ${k & 0x1f}`;
  if (k >= 0x5220 && k <= 0x523f) return `Fn: layer ${k & 0x1f} while held`;
  if (k >= 0x5240 && k <= 0x525f) return `Default layer ${k & 0x1f}`;
  if (k >= 0x5260 && k <= 0x527f) return `Toggle layer ${k & 0x1f}`;
  if (k >= 0x5280 && k <= 0x529f) return `One-shot layer ${k & 0x1f}`;
  if (k >= 0x52c0 && k <= 0x52df) return `Tap-toggle layer ${k & 0x1f}`;
  if (k >= 0x7700 && k <= 0x777f) return `Macro ${k & 0x7f}`;
  if (k === 0x7c00) return 'Bootloader (reflash mode)';
  if (k === 0x7c01) return 'Reboot keyboard';
  if (k === 0x7c03) return 'Factory reset (clear settings)';
  if (k >= 0x7e00 && k <= 0x7e3f) {
    const p65 = EPOMAKER_P65[k & 0x3f];
    return `Epomaker key ${k & 0x3f}${p65 ? ` (on the P65 this is "${p65}"; may differ on the P75)` : ''}`;
  }
  if (k >= 0x7000 && k <= 0x70ff) return `Magic ${hex(k & 0xff)}`;
  return hex(k);
}

// Short labels for key caps.
const SHORT = {
  0x00: '—', 0x01: '▽', 0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Bksp', 0x2c: 'Space', 0x39: 'Caps', 0x46: 'PrtSc', 0x47: 'ScrLk', 0x49: 'Ins',
  0x4b: 'PgUp', 0x4c: 'Del', 0x4e: 'PgDn', 0x53: 'NumLk', 0x64: 'ISO\\', 0xa5: 'Power', 0xa8: 'Mute', 0xa9: 'Vol+', 0xaa: 'Vol−',
  0xab: 'Next', 0xac: 'Prev', 0xad: 'Stop', 0xae: 'Play', 0xaf: 'Media', 0xb1: 'Mail', 0xb2: 'Calc', 0xb3: 'PC', 0xb4: 'Search',
  0xb5: 'WWW', 0xb6: 'Back', 0xb7: 'Fwd', 0xb9: 'Reload', 0xbd: 'Bri+', 0xbe: 'Bri−', 0xbf: 'Panel', 0xc0: 'Assist',
  0xe0: 'Ctrl', 0xe1: 'Shift', 0xe2: 'Alt', 0xe3: 'Win', 0xe4: 'Ctrl', 0xe5: 'Shift', 0xe6: 'Alt', 0xe7: 'Win',
  0x7820: 'RGB', 0x7821: 'RGB ›', 0x7822: 'RGB ‹', 0x7823: 'Hue+', 0x7824: 'Hue−', 0x7825: 'Sat+', 0x7826: 'Sat−', 0x7827: 'Bri+', 0x7828: 'Bri−', 0x7829: 'Spd+', 0x782a: 'Spd−',
  0x7c00: 'BOOT', 0x7c01: 'Reboot', 0x7c03: 'RESET',
};
export function shortName(k) {
  if (SHORT[k]) return SHORT[k];
  if (k >= 0x5220 && k <= 0x523f) return `Fn${k & 0x1f}`;
  if (k >= 0x5260 && k <= 0x527f) return `TG${k & 0x1f}`;
  if (k >= 0x5200 && k <= 0x521f) return `TO${k & 0x1f}`;
  if (k >= 0x5240 && k <= 0x525f) return `DF${k & 0x1f}`;
  if (k >= 0x7700 && k <= 0x777f) return `M${k & 0x7f}`;
  if (k >= 0x7e00 && k <= 0x7e3f) return `EP${k & 0x3f}`;
  if (k >= 0x0100 && k <= 0x1fff) return keyName(k).replace('Ctrl', '^').replace('Shift', '⇧').replace('Alt', '⌥').replace('Win', '⊞').replace(/\+/g, '');
  if (k >= 0x4000 && k <= 0x4fff) return `LT${(k >> 8) & 0xf}`;
  const n = keyName(k);
  return n.length > 9 ? hex(k) : n;
}
// Things that are not ordinary characters get the accent cap color.
export const isSpecialKey = (k) => k >= 0x4000 || (k >= 0xa5 && k <= 0xc2);

// KeyboardEvent.code -> HID usage, for the live key tester.
export const CODE_TO_HID = (() => {
  const m = { Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
    Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
    Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    ContextMenu: 0x65, ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7 };
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 0x1d + i;
  m.Digit0 = 0x27;
  for (let i = 1; i <= 12; i++) m[`F${i}`] = 0x39 + i;
  return m;
})();

export const hex = (k) => `0x${k.toString(16).padStart(4, '0')}`;

// Choices for the picker, grouped.
export function pickerGroups(layerCount) {
  const basic = (from, to) => Object.keys(BASIC).map(Number).filter((k) => k >= from && k <= to).map((k) => [k, BASIC[k]]);
  const layers = [];
  for (let l = 0; l < layerCount; l++) {
    layers.push([0x5220 | l, `Fn: layer ${l} while held`], [0x5260 | l, `Toggle layer ${l}`], [0x5200 | l, `Go to layer ${l}`]);
  }
  return [
    ['Special', [[0x00, 'None'], [0x01, '▽ (same as layer below)']]],
    ['Letters', basic(0x04, 0x1d)],
    ['Numbers & symbols', basic(0x1e, 0x38).filter(([k]) => ![0x28, 0x29, 0x2a, 0x2b, 0x2c].includes(k))],
    ['Editing & navigation', basic(0x28, 0x2c).concat(basic(0x39, 0x39), basic(0x46, 0x52), basic(0x65, 0x65))],
    ['Function keys', basic(0x3a, 0x45).concat(basic(0x68, 0x73))],
    ['Modifiers', basic(0xe0, 0xe7)],
    ['Media & system', basic(0xa5, 0xc0)],
    ['Mouse', basic(0xcd, 0xda)],
    ['Numpad', basic(0x53, 0x63)],
    ['Layers', layers],
    ['Lighting', Object.entries(LIGHTING).map(([k, n]) => [Number(k), n])],
    ['Macros', Array.from({ length: 16 }, (_, i) => [0x7700 + i, `Macro ${i}`])],
    ['Epomaker (names from the P65, may differ)', EPOMAKER_P65.slice(0, 10).map((n, i) => [0x7e00 + i, `EP${i} · ${n}?`])],
  ];
}
