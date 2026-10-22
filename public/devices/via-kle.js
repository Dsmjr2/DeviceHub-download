// VIA definitions as makers hand them out (22 Oct 2026): their key positions are a keyboard-layout-editor drawing
// (layouts.keymap, the KLE format), not the compiled list VIA's library serves (layouts.keys). This turns the drawing
// into that list, so a maker's file (via-definitions\<VID><PID>.json, or one fetched by "Get the layout",
// helpers/via-fetch.mjs) gives the same layout as VIA's library would. Written from the two formats' documentation:
// - KLE: a list of rows; in a row, an object changes what follows (x / y move the cursor, w / h size the next key,
//   a picks how a key's text lines map to its legend slots, d marks a decal, rx / ry start a rotated block), and a
//   string is one key, its legend lines separated by \n. After each key the cursor moves right by its width; each row
//   starts one unit lower.
// - VIA: legend slot 0 holds "row,col", slot 8 "group,choice" for a layout option (split backspace, ISO enter ...),
//   and slot 4 "e<n>" for knob n.
// Data only: nothing in the file is run. Throws on a drawing it cannot read.

// KLE's legend alignment: for each value of `a`, which slot each text line lands in (-1: not shown)
const ALIGN = [
  [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10],
  [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10],
  [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10],
  [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10],
  [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1],
  [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1],
  [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1],
  [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1],
];
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pair = (s) => {
  const m = /^(\d{1,3})\s*[,，]\s*(\d{1,3})$/.exec(s || '');
  return m ? [+m[1], +m[2]] : null;
};

// keymap (KLE rows) -> { keys: [{ row, col, x, y, w, h, ei?, d? }], optionKeys: { group: { choice: [keys] } } }
export function keymapToKeys(keymap) {
  if (!Array.isArray(keymap)) throw new Error('the definition has no key positions');
  const keys = [], groups = {};
  let y = 0, a = 4, rx = 0, ry = 0, count = 0;
  for (const row of keymap) {
    if (!Array.isArray(row)) continue;   // a drawing's first item may be its metadata object
    let x = rx, w = 1, h = 1, d = false;
    for (const item of row) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (num(item.rx) || num(item.ry)) { if (num(item.rx)) rx = item.rx; if (num(item.ry)) ry = item.ry; x = rx; y = ry; }
        if (num(item.x)) x += item.x;
        if (num(item.y)) y += item.y;
        if (num(item.w)) w = item.w;
        if (num(item.h)) h = item.h;
        if (typeof item.d === 'boolean') d = item.d;
        if (Number.isInteger(item.a) && item.a >= 0 && item.a < ALIGN.length) a = item.a;
        continue;
      }
      if (typeof item !== 'string') throw new Error('the key drawing has an entry that is not a key');
      if (++count > 1000) throw new Error('the key drawing has too many keys');
      const slots = [];
      item.split('\n').forEach((t, i) => { const s = ALIGN[a][i]; if (s != null && s >= 0) slots[s] = t.trim(); });
      const key = { x, y, w, h };
      const enc = /^e(\d{1,2})$/i.exec(slots[4] || '');
      if (enc) key.ei = +enc[1];
      if (d) key.d = true;
      const rc = pair(slots[0]);
      if (rc) { key.row = rc[0]; key.col = rc[1]; }
      else if (!d && key.ei == null) throw new Error(`a key in the drawing has no row,col (${JSON.stringify(item).slice(0, 30)})`);
      const g = pair(slots[8]);
      if (g) ((groups[g[0]] ||= {})[g[1]] ||= []).push(key);
      else keys.push(key);
      x += w; w = 1; h = 1; d = false;
    }
    y += 1;
  }
  // each layout option's other choices are drawn off to the side: move each onto choice 0's place (its top-left key)
  const corner = (list) => list.reduce((m, k) => (k.y < m.y || (k.y === m.y && k.x < m.x) ? k : m), list[0]);
  const optionKeys = {};
  for (const [group, choices] of Object.entries(groups)) {
    const base = choices['0'] || Object.values(choices)[0];
    const at = corner(base);
    optionKeys[group] = {};
    for (const [choice, list] of Object.entries(choices)) {
      const c = corner(list), dx = at.x - c.x, dy = at.y - c.y;
      optionKeys[group][choice] = list.map((k) => ({ ...k, x: k.x + dx, y: k.y + dy }));
    }
  }
  return { keys, optionKeys };
}
