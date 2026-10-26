// PC lights grouped by what they are, not by OpenRGB device (26 Oct 2026, Shawn: on a friend's Gigabyte B450 "the pc
// lights are coming up as motherboard lights": his case fans sit on the board's D_LED header, so OpenRGB lists them as
// zones of the motherboard). Pure functions, no page code: tests/lighting-page.mjs runs them in Node.
//   groupLights(controllers, { showAll }) -> [{ id, title, rows: [row], all: [write], color, hidden? }]  (hidden: Board's unlisted zones)
//     row: { key, label, detail, writes: [{ index, zone }], color, leds }   zone null = the whole OpenRGB device
//   collapse(writes, controllers) -> the same writes, one { index, zone: null } where they cover a whole device
//   liveWriter(send, { every }) -> { push(v), flush(v), idle() }: at most one send per `every` ms, one at a time
// Sections, in this order: Fans (each board ARGB / D_LED header as "Fan header N", plus fan controllers and coolers),
// RAM (each stick), Graphics card, Board (the logos and other named zones), Other. Unnamed "???" zones are hidden
// unless Find my lights named them (or Show all zones); Board's All still colors them, never the fan headers.

export const FAN_ZONE = /argb|d[_ -]?led|header|\bfans?\b/i;
const FAN_DEVICE = /\bfans?\b|commander|lighting node|uni ?hub|fan hub|argb hub|\bhub\b/i;
const UNNAMED = /^\s*(\?+|unknown|)\s*$/i;

// "Fan header (ARGB) 1", "ARGB Header 2", "D_LED1 header", "D_LED 2" -> its number, or null
const headerNumber = (name) => { const m = /(\d+)/.exec(String(name || '')); return m ? Number(m[1]) : null; };
const zoneColor = (z) => z?.color || null;
const sameColor = (list) => { const cs = list.map((x) => (x || '').toLowerCase()); return cs.length && cs.every((c) => c && c === cs[0]) ? cs[0] : null; };

function kindOf(c) {
  const t = String(c.type || '');
  if (t === 'ram') return 'ram';
  if (t === 'gpu') return 'gpu';
  if (t === 'motherboard') return 'board';
  if (t === 'cooler' || FAN_DEVICE.test(c.name || '')) return 'fans';
  return 'other';
}

export function groupLights(controllers = [], { showAll = false } = {}) {
  const fans = [], fansAll = [], ram = [], gpu = [], board = [], boardAll = [], other = [];
  let boardHidden = 0;
  const list = (controllers || []).filter((c) => c && Number.isInteger(c.index));
  const boards = list.filter((c) => kindOf(c) === 'board');
  let fanNo = 0;
  for (const c of list) {
    const kind = kindOf(c);
    const zones = Array.isArray(c.zones) ? c.zones : [];
    const whole = { index: c.index, zone: null };
    const ownColor = c.same === false ? null : (c.color || zoneColor(zones[0]));
    if (kind === 'ram') { ram.push({ key: `ram:${c.index}`, label: `Stick ${ram.length + 1}`, detail: c.name, writes: [whole], color: ownColor, leds: c.leds || 0 }); continue; }
    if (kind === 'gpu') { gpu.push({ key: `gpu:${c.index}`, label: c.name || 'Graphics card', detail: null, writes: [whole], color: ownColor, leds: c.leds || 0 }); continue; }
    if (kind === 'fans') {
      const lit = zones.map((z, i) => [z, i]).filter(([z]) => z.leds > 0 && !z.hidden);
      if (lit.length > 1) for (const [z, i] of lit) { const row = { key: `fan:${c.index}:${i}`, label: z.name || `Channel ${i + 1}`, detail: c.name, writes: [{ index: c.index, zone: i }], color: zoneColor(z), leds: z.leds }; fans.push(row); fansAll.push(...row.writes); }
      else { fans.push({ key: `fan:${c.index}`, label: c.name || 'Fan controller', detail: null, writes: [whole], color: ownColor, leds: c.leds || 0 }); fansAll.push(whole); }
      continue;
    }
    if (kind === 'other') { other.push({ key: `other:${c.index}`, label: c.name || 'Light', detail: null, writes: [whole], color: ownColor, leds: c.leds || 0 }); continue; }
    // a board: its fan headers go to Fans, the rest is Board
    const prefix = boards.length > 1 ? `${c.name}: ` : '';
    if (zones.length <= 1) {
      const row = { key: `board:${c.index}`, label: boards.length > 1 ? c.name : 'Board', detail: null, writes: [whole], color: ownColor, leds: c.leds || 0 };
      board.push(row); boardAll.push(whole); continue;
    }
    zones.forEach((z, i) => {
      const name = String(z.name || '');
      const isFan = z.named ? /\bfans?\b/i.test(name) : FAN_ZONE.test(name);
      const write = { index: c.index, zone: i };
      if (isFan) {
        if (z.hidden && !showAll) return;
        fanNo++;
        const n = z.named ? null : headerNumber(name) ?? fanNo;
        fans.push({ key: `fan:${c.index}:${i}`, label: z.named ? name : `${prefix}Fan header ${n}`, detail: z.leds > 0 ? null : 'No lights on it', writes: [write], color: zoneColor(z), leds: z.leds || 0 });
        if (z.leds > 0) fansAll.push(write);
        return;
      }
      if (z.leds > 0) boardAll.push(write);   // Board's All colors every board zone, the unnamed ones too
      const unnamed = !z.named && UNNAMED.test(name);
      if (!showAll && (z.hidden || unnamed || !(z.leds > 0))) { if (z.leds > 0) boardHidden++; return; }
      board.push({ key: `board:${c.index}:${i}`, label: `${prefix}${unnamed ? `Unnamed ${i + 1}` : name}`, detail: null, writes: [write], color: zoneColor(z), leds: z.leds || 0 });
    });
  }
  const section = (id, title, rows, all) => ({ id, title, rows, all: collapse(all || rows.flatMap((r) => r.writes), list), color: sameColor(rows.filter((r) => r.leds > 0).map((r) => r.color)) });
  return [
    fans.length || fansAll.length ? section('fans', 'Fans', fans, fansAll) : null,
    ram.length ? section('ram', 'RAM', ram) : null,
    gpu.length ? section('gpu', 'Graphics card', gpu) : null,
    board.length || boardAll.length ? { ...section('board', 'Board', board, boardAll), hidden: boardHidden } : null,
    other.length ? section('other', 'Other lights', other) : null,
  ].filter(Boolean);
}

// one write per whole device where a list of zone writes covers every lit zone of it (one send instead of several)
export function collapse(writes, controllers = []) {
  const byIndex = new Map();
  for (const w of writes) { if (!byIndex.has(w.index)) byIndex.set(w.index, new Set()); byIndex.get(w.index).add(w.zone); }
  const out = [];
  for (const [index, zones] of byIndex) {
    const c = controllers.find((x) => x.index === index);
    const lit = (c?.zones || []).map((z, i) => (z.leds > 0 ? i : null)).filter((i) => i !== null);
    if (zones.has(null) || (lit.length && lit.every((i) => zones.has(i)))) out.push({ index, zone: null });
    else for (const z of [...zones].sort((a, b) => a - b)) out.push({ index, zone: z });
  }
  return out;
}

// Put a color into the local copy of the lights, as a write would leave them (shown at once, before OpenRGB answers)
export function applyLocal(controllers, writes, hex) {
  for (const w of writes) {
    const c = controllers.find((x) => x.index === w.index);
    if (!c) continue;
    if (w.zone === null) { c.color = hex; c.same = true; (c.zones || []).forEach((z) => { z.color = hex; }); }
    else if (c.zones?.[w.zone]) { c.zones[w.zone].color = hex; c.same = c.zones.filter((z) => z.leds > 0).every((z) => z.color === hex); if (c.same) c.color = hex; }
  }
}

// Writes while a picker is dragged: the newest value only, one send at a time, at most one per `every` ms (10 a second),
// and nothing once the pointer stops. flush() sends the final value on release (after the one in flight).
export function liveWriter(send, { every = 100, now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) } = {}) {
  let busy = false, pending, has = false, last = -Infinity, timer = false, sent;
  const pump = () => {
    if (busy || !has || timer) return;
    const wait = last + every - now();
    if (wait > 0) { timer = true; later(() => { timer = false; pump(); }, wait); return; }
    const v = pending; has = false; busy = true; last = now();
    if (v === sent) { busy = false; return; }
    Promise.resolve().then(() => send(v)).catch(() => {}).finally(() => { sent = v; busy = false; pump(); });
  };
  return {
    push(v) { pending = v; has = true; pump(); },
    flush(v) { if (v !== undefined) { pending = v; has = true; } pump(); },
    idle: () => !busy && !has && !timer,
  };
}
