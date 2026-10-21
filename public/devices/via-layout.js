// Keyboard layouts for VIA keyboards (20 Oct 2026). VIA keyboards do not report their matrix size or where each key is,
// so DeviceHub uses the keyboard's VIA definition: VIA's own library (usevia.app/definitions/v3/<vendorProductId>.json,
// about 1,500 keyboards), or a file the maker hands out for VIA's "load draft definition" placed in DeviceHub's
// via-definitions folder. The P75's layout is built in (it is not in VIA's library).
// A layout: { name, vpid, rows, cols, width, height, keys: [{ row, col, x, y, w, h, knob }] } in key units.

// The P75, as measured on Shawn's board: 6 x 15 matrix; the F row in its groups (Esc, F1-F4, F5-F8, F9-F12, Delete,
// gaps of 1/4 key), the knob top right.
export const P75 = (() => {
  const keys = [];
  const k = (row, col, x, y, w = 1, knob = false) => keys.push({ row, col, x, y, w, h: 1, knob });
  const Y = [0, 1.25, 2.25, 3.25, 4.25, 5.25];
  const FX = [0, 1.25, 2.25, 3.25, 4.25, 5.5, 6.5, 7.5, 8.5, 9.75, 10.75, 11.75, 12.75, 14];
  for (let c = 0; c < 14; c++) k(0, c, FX[c], Y[0]);
  k(0, 14, 15, Y[0], 1, true);
  for (let c = 0; c < 13; c++) k(1, c, c, Y[1]);
  k(1, 13, 13, Y[1], 2); k(1, 14, 15, Y[1]);
  k(2, 0, 0, Y[2], 1.5);
  for (let c = 1; c < 13; c++) k(2, c, c + 0.5, Y[2]);
  k(2, 13, 13.5, Y[2], 1.5); k(2, 14, 15, Y[2]);
  k(3, 0, 0, Y[3], 1.75);
  for (let c = 1; c < 12; c++) k(3, c, c + 0.75, Y[3]);
  k(3, 13, 12.75, Y[3], 2.25); k(3, 14, 15, Y[3]);
  k(4, 0, 0, Y[4], 2.25);
  for (let c = 1; c < 11; c++) k(4, c, c + 1.25, Y[4]);
  k(4, 12, 12.25, Y[4], 1.75); k(4, 13, 14, Y[4]);
  k(5, 0, 0, Y[5], 1.25); k(5, 1, 1.25, Y[5], 1.25); k(5, 2, 2.5, Y[5], 1.25); k(5, 5, 3.75, Y[5], 6.25);
  for (const c of [9, 10, 11, 12, 13, 14]) k(5, c, c + 1, Y[5]);
  return { name: 'Epomaker P75', vpid: 0x342d * 65536 + 0xe479, rows: 6, cols: 15, width: 16, height: 6.25, keys, builtIn: true };
})();

// A VIA definition (v3 format, as VIA's library serves every keyboard) to a layout. The default choice of each layout
// option (split backspace, ISO enter ...) is used. Throws on anything that is not a usable definition.
export function fromDefinition(def) {
  if (!def || typeof def !== 'object') throw new Error('not a VIA definition');
  const rows = def.matrix?.rows, cols = def.matrix?.cols;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 32 || cols > 32) throw new Error('the definition has no valid matrix size');
  const L = def.layouts || {};
  let raw = Array.isArray(L.keys) ? [...L.keys] : null;
  if (!raw) throw new Error('the definition has no key positions (older formats are read through VIA\'s library)');
  // layout options: each option group's first choice (option keys are listed per group, per choice)
  for (const group of Object.values(L.optionKeys || {})) { const first = group?.['0'] || Object.values(group || {})[0]; if (Array.isArray(first)) raw.push(...first); }
  const keys = [];
  const seen = new Set();
  for (const r of raw) {
    if (!Number.isInteger(r.row) || !Number.isInteger(r.col) || r.row >= rows || r.col >= cols || r.d) continue;   // d: decal, not a key
    const id = `${r.row},${r.col}`;
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push({ row: r.row, col: r.col, x: +r.x || 0, y: +r.y || 0, w: +r.w || 1, h: +r.h || 1, knob: r.ei != null });
  }
  if (keys.length < 10) throw new Error('the definition has too few keys');
  // shift to start at 0,0 (some definitions start with an offset)
  const minX = Math.min(...keys.map((x) => x.x)), minY = Math.min(...keys.map((x) => x.y));
  for (const x of keys) { x.x -= minX; x.y -= minY; }
  const width = Math.max(...keys.map((x) => x.x + x.w)), height = Math.max(...keys.map((x) => x.y + x.h));
  return { name: String(def.name || 'VIA keyboard').slice(0, 60), vpid: def.vendorProductId ?? null, rows, cols, width, height, keys };
}

// [row][col] -> [x, y, w, kind] in key units, null where the matrix has no key (the keyboard page's grid)
export function grid(layout) {
  const g = Array.from({ length: layout.rows }, () => Array(layout.cols).fill(null));
  for (const k of layout.keys) g[k.row][k.col] = [k.x, k.y, k.w, k.knob ? 'knob' : undefined];
  return g;
}

// Is a keymap read with this layout plausible? A wrong matrix size scrambles where each key's code is, which shows as
// many empty or repeated codes on the base layer where keys should be.
export function keymapLooksRight(layout, keymap) {
  const l0 = keymap?.[0];
  if (!l0) return false;
  if (layout.builtIn && layout.name === 'Epomaker P75') return l0[0][0] === 0x29 && l0[1][1] === 0x1e && l0[2][1] === 0x14 && l0[3][1] === 0x04;
  const codes = layout.keys.filter((k) => !k.knob).map((k) => l0[k.row]?.[k.col]);
  const empty = codes.filter((c) => !c).length;
  const distinct = new Set(codes).size;
  return codes.length >= 10 && empty / codes.length < 0.15 && distinct / codes.length > 0.7;
}
