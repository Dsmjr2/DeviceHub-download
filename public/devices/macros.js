// VIA macro text <-> bytes. A macro is typed text plus {tokens}:
//   {Enter} {Tab} {F5} ...      tap one key
//   {Ctrl+Shift+Esc}             hold modifiers, tap the last key, release
//   {wait 250}                   pause 250 ms
//   {{ and }}                    literal braces
// Bytes (QMK dynamic macros): printable ASCII is typed as is; 0x01 prefix + 0x01 tap / 0x02 down / 0x03 up + keycode;
// 0x01 0x04 + decimal digits + '|' = delay. Each macro ends with 0x00.

const NAMES = {
  enter: 0x28, return: 0x28, esc: 0x29, escape: 0x29, backspace: 0x2a, bksp: 0x2a, tab: 0x2b, space: 0x2c, caps: 0x39, capslock: 0x39,
  printscreen: 0x46, prtsc: 0x46, scrolllock: 0x47, pause: 0x48, insert: 0x49, ins: 0x49, home: 0x4a, pageup: 0x4b, pgup: 0x4b,
  delete: 0x4c, del: 0x4c, end: 0x4d, pagedown: 0x4e, pgdn: 0x4e, right: 0x4f, left: 0x50, down: 0x51, up: 0x52, menu: 0x65,
  mute: 0xa8, volup: 0xa9, voldown: 0xaa, play: 0xae, next: 0xab, prev: 0xac,
  ctrl: 0xe0, lctrl: 0xe0, shift: 0xe1, lshift: 0xe1, alt: 0xe2, lalt: 0xe2, win: 0xe3, gui: 0xe3, cmd: 0xe3,
  rctrl: 0xe4, rshift: 0xe5, ralt: 0xe6, altgr: 0xe6, rwin: 0xe7,
};
for (let i = 1; i <= 12; i++) NAMES[`f${i}`] = 0x39 + i;
for (let i = 13; i <= 24; i++) NAMES[`f${i}`] = 0x68 + i - 13;
for (let i = 0; i < 26; i++) NAMES[String.fromCharCode(97 + i)] = 0x04 + i;
for (let i = 1; i <= 9; i++) NAMES[String(i)] = 0x1d + i;
NAMES['0'] = 0x27;
Object.assign(NAMES, { '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38 });
const BY_CODE = {};
for (const [n, c] of Object.entries(NAMES)) if (!(c in BY_CODE)) BY_CODE[c] = n; // first name listed is the display name
const pretty = (n) => (n.length === 1 ? n.toUpperCase() : n[0].toUpperCase() + n.slice(1));
const isMod = (c) => c >= 0xe0 && c <= 0xe7;

export function encodeMacro(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' && text[i + 1] === '{') { out.push(0x7b); i += 2; continue; }
    if (ch === '}' && text[i + 1] === '}') { out.push(0x7d); i += 2; continue; }
    if (ch === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) throw new Error('a { has no matching }');
      const tok = text.slice(i + 1, end).trim().toLowerCase();
      i = end + 1;
      const wait = tok.match(/^wait\s+(\d{1,5})$/);
      if (wait) { out.push(0x01, 0x04, ...[...wait[1]].map((c) => c.charCodeAt(0)), 0x7c); continue; }
      const parts = tok.split('+').map((p) => p.trim()).filter(Boolean);
      const codes = parts.map((p) => { const c = NAMES[p.replace(/\s+/g, '')]; if (c == null) throw new Error(`unknown key {${p}}`); return c; });
      const last = codes.pop();
      for (const m of codes) { if (!isMod(m)) throw new Error(`only Ctrl/Shift/Alt/Win can be held: {${tok}}`); out.push(0x01, 0x02, m); }
      out.push(0x01, 0x01, last);
      for (const m of codes.reverse()) out.push(0x01, 0x03, m);
      continue;
    }
    if (ch === '\n') { out.push(0x01, 0x01, 0x28); i++; continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) throw new Error(`"${ch}" cannot be typed by a macro (plain keyboard characters only)`);
    out.push(code);
    i++;
  }
  return out;
}

export function decodeMacro(bytes) {
  let s = '', i = 0;
  const held = [];
  while (i < bytes.length && bytes[i] !== 0) {
    const b = bytes[i];
    if (b === 0x01) {
      const kind = bytes[i + 1], code = bytes[i + 2];
      if (kind === 0x04) {
        let j = i + 2, ms = '';
        while (j < bytes.length && bytes[j] !== 0x7c && bytes[j] !== 0) ms += String.fromCharCode(bytes[j++]);
        s += `{wait ${ms}}`; i = j + 1; continue;
      }
      const name = BY_CODE[code] ? pretty(BY_CODE[code]) : `0x${code?.toString(16)}`;
      if (kind === 0x02) held.push(name);
      else if (kind === 0x03) held.splice(held.lastIndexOf(name), 1);
      else s += `{${[...held, name].join('+')}}`;
      i += 3; continue;
    }
    s += b === 0x7b ? '{{' : b === 0x7d ? '}}' : String.fromCharCode(b);
    i++;
  }
  return s;
}

// Split a buffer into `count` macros (each ends at 0x00).
export function splitMacros(buf, count) {
  const out = [];
  let start = 0;
  for (let m = 0; m < count; m++) {
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    out.push(buf.slice(start, end));
    start = end + 1;
  }
  return out;
}

export function joinMacros(list) {
  const out = [];
  for (const m of list) out.push(...m, 0);
  return out;
}
