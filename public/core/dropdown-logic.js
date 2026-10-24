// The glass dropdown's pure parts (24 Oct 2026; public/ui/dropdown.js draws it): which option a key moves to, which one
// typing jumps to, and where the open list goes. No DOM here, so tests/dropdown.mjs checks them in Node.

const usable = (o) => !!o && !o.disabled;

// the option a key moves to from `cur` (-1 = none yet). Disabled options are passed over; at the ends it stays put.
// Returns cur when the key is not a moving key or nothing can be reached.
export function moveIndex(options, cur, key, page = 8) {
  const n = options.length;
  if (!n) return -1;
  const firstFrom = (i, step) => { for (let j = i; j >= 0 && j < n; j += step) if (usable(options[j])) return j; return -1; };
  let to = -1;
  switch (key) {
    case 'ArrowDown': to = cur < 0 ? firstFrom(0, 1) : firstFrom(cur + 1, 1); break;
    case 'ArrowUp': to = cur < 0 ? firstFrom(n - 1, -1) : firstFrom(cur - 1, -1); break;
    case 'Home': to = firstFrom(0, 1); break;
    case 'End': to = firstFrom(n - 1, -1); break;
    case 'PageDown': to = firstFrom(Math.min(n - 1, Math.max(cur, 0) + page), -1); if (to <= cur) to = firstFrom(Math.max(cur, 0) + 1, 1); break;
    case 'PageUp': to = firstFrom(Math.max(0, cur - page), 1); if (to >= cur && cur >= 0) to = firstFrom(cur - 1, -1); break;
    default: return cur;
  }
  return to < 0 ? cur : to;
}

// type to jump: the next usable option whose label starts with `typed` (case-insensitive), searching after `cur` and
// wrapping. The same letter pressed again ("ccc") steps through the options that start with it. -1 when none matches.
export function typeAhead(options, typed, cur) {
  const n = options.length;
  const t = String(typed || '').toLowerCase();
  if (!n || !t) return -1;
  const same = t.split('').every((c) => c === t[0]);
  const want = same ? t[0] : t;
  // a longer word keeps the current option if it still matches; one repeated letter moves on
  const start = same ? cur + 1 : Math.max(cur, 0);
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (usable(options[i]) && String(options[i].label ?? '').trim().toLowerCase().startsWith(want)) return i;
  }
  return -1;
}

// where the open list goes: under the control, or above it when it would not fit below and there is more room above.
// anchor: the control's box ({ top, bottom, left, width }); listH / listW: the list's natural size; view: { w, h }.
// Returns { above, top, left, maxHeight } in window pixels; the list never leaves the window.
export function placeList(anchor, listH, listW, view, { gap = 6, margin = 8, cap = 320 } = {}) {
  const below = view.h - anchor.bottom - gap - margin;
  const aboveRoom = anchor.top - gap - margin;
  const want = Math.min(listH, cap);
  const above = want > below && aboveRoom > below;
  const maxHeight = Math.max(80, Math.min(cap, above ? aboveRoom : below));
  const h = Math.min(want, maxHeight);
  const top = above ? Math.max(margin, anchor.top - gap - h) : anchor.bottom + gap;
  const w = Math.min(Math.max(listW, anchor.width), view.w - margin * 2);
  const left = Math.min(Math.max(margin, anchor.left), Math.max(margin, view.w - margin - w));
  return { above, top: Math.round(top), left: Math.round(left), width: Math.round(w), maxHeight: Math.round(maxHeight) };
}
