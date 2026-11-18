// Offline test (15 Nov 2026, work map job 7): public/devices/keycodes.js, the keyboard's key names and the picker.
// The safety part first: no key that resets or reflashes the keyboard is ever offered in the picker.
import { keyName, shortName, isDangerous, isSpecialKey, CODE_TO_HID, pickerGroups, hex, EFFECTS } from '../public/devices/keycodes.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

// dangerous keys: bootloader, reboot, debug, clear EEPROM, Epomaker's reset button
for (const k of [0x7c00, 0x7c01, 0x7c02, 0x7c03, 0x7e0a]) check(isDangerous(k), `${hex(k)} is dangerous`);
for (const k of [0x00, 0x04, 0x7bff, 0x7c04, 0x7e09, 0x7e0b, 0x5220]) check(!isDangerous(k), `${hex(k)} is not dangerous`);
const offered = pickerGroups(4).flatMap(([, items]) => items);
check(offered.length > 150, `the picker offers keys (${offered.length})`);
check(!offered.some(([k]) => isDangerous(k)), 'the picker never offers a key that resets or reflashes the keyboard');
check(offered.every(([k, name]) => Number.isInteger(k) && k >= 0 && k <= 0xffff && typeof name === 'string' && name), 'every picker entry is a 16-bit keycode with a name');
const codes = offered.map(([k]) => k);
check(new Set(codes).size === codes.length, 'no keycode twice in the picker');
check(pickerGroups(2).find(([g]) => g === 'Layers')[1].length === 6, 'three layer keys per layer');
check(!pickerGroups(4).find(([g]) => g.startsWith('Epomaker'))[1].some(([k]) => k === 0x7e0a), 'the Epomaker reset button (10) is not offered');

// names
const names = {
  0x04: 'A', 0x1d: 'Z', 0x27: '0', 0x2c: 'Space', 0x3a: 'F1', 0x73: 'F24', 0xe7: 'Right Win', 0xa9: 'Volume +',
  0x0204: 'Shift+A', 0x1104: 'RCtrl+A', 0x0f04: 'Ctrl+Shift+Alt+Win+A', 0x4104: 'Layer 1 when held, A when tapped',
  0x5202: 'Go to layer 2', 0x5221: 'Fn: layer 1 while held', 0x5243: 'Default layer 3', 0x5261: 'Toggle layer 1',
  0x5282: 'One-shot layer 2', 0x52c1: 'Tap-toggle layer 1', 0x7705: 'Macro 5', 0x7820: 'RGB on/off',
  0x7c00: 'Bootloader (reflash mode)', 0x7c03: 'Factory reset (clear settings)', 0x7012: 'Magic 0x0012', 0x9999: '0x9999',
};
for (const [k, want] of Object.entries(names)) check(keyName(Number(k)) === want, `keyName(${hex(Number(k))}) = "${keyName(Number(k))}", want "${want}"`);
check(/^Epomaker key 3 \(on the P65 this is "Bluetooth 3"/.test(keyName(0x7e03)), 'Epomaker keys name the P65 meaning as a hint');
check(keyName(0x7e20) === 'Epomaker key 32', 'an Epomaker key without a P65 name');

// short names fit on a key cap
const shorts = { 0x00: '—', 0x2a: 'Bksp', 0x5221: 'Fn1', 0x5261: 'TG1', 0x5202: 'TO2', 0x5243: 'DF3', 0x7705: 'M5', 0x7e03: 'EP3', 0x4104: 'LT1', 0x0204: '⇧A', 0x7c00: 'BOOT', 0x04: 'A' };
for (const [k, want] of Object.entries(shorts)) check(shortName(Number(k)) === want, `shortName(${hex(Number(k))}) = "${shortName(Number(k))}", want "${want}"`);
for (const [k] of offered) check(shortName(k).length <= 12, `shortName(${hex(k)}) fits (${shortName(k)})`);
check(shortName(0xb7) === 'Fwd' && shortName(0xc0) === 'Assist', 'media keys shortened');

// special keys get the accent color; letters do not
check(isSpecialKey(0x4104) && isSpecialKey(0x7705) && isSpecialKey(0xa9) && !isSpecialKey(0x04) && !isSpecialKey(0xe0), 'isSpecialKey');

// the live key tester: browser key codes to HID usages
check(CODE_TO_HID.KeyA === 0x04 && CODE_TO_HID.KeyZ === 0x1d && CODE_TO_HID.Digit1 === 0x1e && CODE_TO_HID.Digit0 === 0x27, 'letters and digits');
check(CODE_TO_HID.F1 === 0x3a && CODE_TO_HID.F12 === 0x45 && CODE_TO_HID.Escape === 0x29 && CODE_TO_HID.MetaRight === 0xe7, 'F keys, Esc, modifiers');
check(Object.values(CODE_TO_HID).every((k) => keyName(k) !== hex(k)), 'every tester key has a name');
check(new Set(Object.values(CODE_TO_HID)).size === Object.keys(CODE_TO_HID).length, 'no two browser codes on one usage');

check(hex(0x4) === '0x0004' && hex(0x7c00) === '0x7c00', 'hex');
check(EFFECTS[0] === 'none' && EFFECTS[1] === 'solid color' && new Set(EFFECTS).size === EFFECTS.length, 'effects list starts none, solid color; no repeats');

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`keycodes (no reset or reflash key offered, names, short names, key tester): all ${n} passed`);
process.exit(0);
