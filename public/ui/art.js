// Device drawings (19 Oct 2026, second pass; Shawn: "make them actually look high tech and cool as well as accurate to
// what they actually look like"). Each is drawn from the real product, in layers the drawing styles (Settings >
// Appearance, style.css) paint: .solid the body in the device color, .soft the secondary parts, .cut the recesses,
// .cut-line seams; and for depth .shade (the far side in shadow), .hi (a sheen where light catches), .led (the parts
// that light up: the HS80's logos and mic light), .line (fine detail: wheel ridges, stitching, knurling).
// The body and the soft parts are lit with gradients (light from the top left), their colors per look in style.css.
// In the Realistic look all three devices show the makers' own product photos (public/img: Pulsar, Corsair, Epomaker, 19 Oct
// 2026) in place of the drawing (.drawn); the other looks and the Lighting previews keep the drawing.
// Hover lifts a drawing; a settings change gives one small bounce (style.css).
import { svgEl } from './dom.js';
import { ART_STYLES } from '../core/theme.js';
const ART_LOOKS = ART_STYLES.map(([k]) => k);

// the lit gradients every drawing uses (dhb-<device> the body, dhs-<device> the soft parts), once per page; the stop
// colors are CSS variables set per device and per look in style.css
export function artDefs() {
  const g = (dev, look) => `<linearGradient id="dhb-${dev}-${look}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: var(--gb1)"/><stop offset=".45" style="stop-color: var(--gb2)"/><stop offset="1" style="stop-color: var(--gb3)"/></linearGradient>`
    + `<linearGradient id="dhs-${dev}-${look}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color: var(--gs1)"/><stop offset="1" style="stop-color: var(--gs2)"/></linearGradient>`;
  // each look's set sits in a group that takes that look's colors (style.css), so a preview box shows its own look
  const set = (look) => `<g class="art-preview" data-art-preview="${look}">${['mouse', 'headset', 'keyboard'].map((d) => `<g class="art art-${d}">${g(d, look)}</g>`).join('')}</g>`;
  return svgEl(`<svg class="art-defs" width="0" height="0" aria-hidden="true" style="position: absolute"><defs>${ART_LOOKS.map(set).join('')}</defs></svg>`);
}


// Detail layers every drawing carries (21 Oct 2026, Shawn: "put more effort into the details"): .floor, the soft shadow
// the device casts on the desk (each look colors it: a glow in Neon, a flat offset in Pop, none in Blueprint); .bp, the
// Blueprint look's callouts and real measurements (hidden in every other look)
// the Live look's layers (21 Oct 2026, Shawn: "2 sounds cool"): .liquid, the battery filling the body from the bottom
// (ui/live-art.js sets its level and color from the real reading), and .lq-text, the level in numbers; hidden in every
// other look. Each drawing gets its own clip id, since a page shows several.
let clipN = 0;
const clipId = () => `dh-lq-${++clipN}`;
// the liquid: two waves (one behind, slower) on a body of liquid, inside the device's shape; the group is moved down by
// the empty share (style.css: --lvl), the waves slide sideways, and bubbles rise while charging
function liquid(clip, x, y, w, h) {
  const p = 36, a = 2.4, x0 = x - p * 2, x1 = x + w + p * 2;
  const wave = (dy) => { let d = `M${x0} ${y + dy}`; for (let wx = x0; wx < x1; wx += p) d += `q${p / 4} ${-a} ${p / 2} 0t${p / 2} 0`; return `${d}V${y + h + 4}H${x0}Z`; };
  const bubbles = [0.22, 0.5, 0.76].map((f, i) => `<circle class="bubble b${i}" cx="${(x + w * f).toFixed(1)}" cy="${y + h - 3}" r="${1.1 + (i % 2) * 0.5}"/>`).join('');
  const g = `${clip}-g`, sh = `${clip}-s`;
  return `<defs><linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${y + Math.min(h, 45)}"><stop offset="0" class="lq-top"/><stop offset=".55" class="lq-mid"/><stop offset="1" class="lq-deep"/></linearGradient>
      <linearGradient id="${sh}" x1="0" y1="0" x2="1" y2=".6"><stop offset=".18" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".22"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".52" stop-color="#fff" stop-opacity=".08"/><stop offset=".58" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g clip-path="url(#${clip})"><g class="liquid" style="--lh: ${h}px">
      <path class="wave back" d="${wave(1.6)}"/><path class="wave front" d="${wave(0)}" style="fill: url(#${g})"/>
      <path class="wave-edge" d="${wave(0).split('V')[0]}"/>
    </g>${bubbles}<rect class="sheen" x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${sh})"/></g>`;
}
// no words (Shawn, 21 Oct 2026: "remove all the words ... but make it still look cool"): a part is marked with a small
// crosshair target, and a measurement is a line with end ticks and a centre tick
const callout = (x, y) => `<g class="bp-mark"><circle class="bp-lead" cx="${x}" cy="${y}" r="3.2"/><path class="bp-lead" d="M${x - 5.5} ${y}H${x - 2}M${x + 2} ${y}H${x + 5.5}M${x} ${y - 5.5}V${y - 2}M${x} ${y + 2}V${y + 5.5}"/><circle class="bp-dot" cx="${x}" cy="${y}" r=".9"/></g>`;
const dimV = (x, y1, y2) => `<path class="bp-lead" d="M${x} ${y1}V${y2}M${x - 2} ${y1}H${x + 2}M${x - 2} ${y2}H${x + 2}M${x - 1.2} ${(y1 + y2) / 2}H${x + 1.2}"/>`;
const dimH = (y, x1, x2) => `<path class="bp-lead" d="M${x1} ${y}H${x2}M${x1} ${y - 2}V${y + 2}M${x2} ${y - 2}V${y + 2}M${(x1 + x2) / 2} ${y - 1.2}V${y + 1.2}"/>`;

// ---- Pulsar X-Lite CrazyLight, from above: the right-hand ergonomic shell (the left side carries the thumb groove and
// the two side buttons, the right side slopes in for the ring and little finger), the long split buttons, the ridged
// wheel in its slot, and the small PULSAR wordmark under the left button (its only mark). Drawn at the real
// proportions: 115.6 x 63.4 mm ----
export function mouseArt() {
  const lq = clipId();
  let ridges = '';
  for (let y = 20; y <= 42; y += 3.2) ridges += `<path class="line" d="M46.5 ${y.toFixed(1)}H53.5"/>`;
  return svgEl(`<svg class="art mark art-mouse" viewBox="0 0 100 160" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="50" cy="150" rx="34" ry="9"/>
    <g transform="translate(50 0) scale(1.18 1) translate(-50 0)">
    <rect class="soft side-btn" x="18.3" y="50" width="2.4" height="12.5" rx="1.2"/>
    <rect class="soft side-btn" x="18.6" y="64.5" width="2.4" height="12.5" rx="1.2"/>
    <path class="solid" d="M50 5C66 5 76 9 78 22C80 38 81 54 82.5 72C84 92 86 108 84.5 124C82 146 68 156 50 156C32 156 18 146 16 128C14.5 114 16.5 100 19.5 88C21 80 20 70 19.5 58C19 42 20 22 23.5 13C28 7 38 5 50 5Z"/>
    <clipPath id="${lq}"><path d="M50 5C66 5 76 9 78 22C80 38 81 54 82.5 72C84 92 86 108 84.5 124C82 146 68 156 50 156C32 156 18 146 16 128C14.5 114 16.5 100 19.5 88C21 80 20 70 19.5 58C19 42 20 22 23.5 13C28 7 38 5 50 5Z"/></clipPath>
    ${liquid(lq, 10, 5, 80, 151)}
    <path class="shade" d="M78 22C80 38 81 54 82.5 72C84 92 86 108 84.5 124C82 146 68 156 56 156C69 146 76 128 76.5 110C77 82 75 52 72 26C73.5 24 76 22.5 78 22Z"/>
    <path class="hi" d="M24.5 16C21.5 30 21 45 23 57C27 45 31.5 30 39.5 13.5C33 12.5 27 13.5 24.5 16Z"/>
    <path class="hi" d="M33 98C30 112 32 130 41 141C37 126 37 111 41 96C38 94.5 35 95.5 33 98Z"/>
    <path class="cut-line" d="M50 5C49.6 26 49.4 44 49.2 63"/>
    <path class="cut-line" d="M19.4 58Q50 71 82 61"/>
    <rect class="cut" x="43.5" y="15" width="13" height="32" rx="6.5"/>
    <rect class="soft" x="45.6" y="17.5" width="8.8" height="27" rx="4.4"/>
    ${ridges}
    </g>
    <text class="logo-text" x="35" y="74" text-anchor="middle">PULSAR</text>
    <text class="lq-text" x="50" y="116" text-anchor="middle"><tspan class="lq-n"></tspan><tspan class="lq-u" dx="1">%</tspan></text>
    <g class="bp">${dimV(4, 5, 156)}${dimH(160, 10, 90)}${callout(50, 30)}${callout(21, 63)}</g>
  </g>
    <image class="photo" href="/img/xlite.png" x="0" y="0" width="100" height="160" preserveAspectRatio="xMidYMid meet"/>
  </svg>`);
}

// ---- Corsair HS80 RGB Wireless, from the front: the slim frame band with the wide fabric suspension strap under it
// (fixed to the inner sides of both yokes), the yoke sliders on their pivots, the tall rounded cups with the lit Corsair
// sails in their upper outer corners, the thick memory-foam cushions turned inward, the volume wheel on the left cup,
// and the slim flip-up mic boom on its hinge on the left cup, curving down to the capsule with its mute light ----
export function headsetArt() {
  // the Corsair sails emblem (the shapes of Corsair's 2020 logo, Wikimedia Commons), lit, in the upper outer corner of
  // each cup as on the HS80, the same way round on both
  const sails = (x, y) => `<g class="led" transform="translate(${x - 7.3} ${y - 7.1}) scale(0.27) translate(-13.93 -13.5)">
      <path d="M43.47,13.5S47.79,22.27,47,25.93c0,0,11.27,3.64,12.52,9.65C59.52,35.58,65.69,27.46,43.47,13.5Z"/>
      <path d="M39.13,26.66A39.68,39.68,0,0,1,41.37,34L35,31.59c.59-3.9-3.2-9.83-3.2-9.83Z"/>
      <path d="M27.73,32.7A46,46,0,0,1,29.68,39l-5.8-1.44c.6-3.9-3.08-8.62-3.08-8.62Z"/>
      <path d="M40.35,23.32S66.19,41.47,67.89,48.51c1.29,5.3-2.450,10.19-2.45,10.19s-2-13.82-51.51,7.17a26.630,26.630,0,0,0,7-20.44,26.3,26.3,0,0,0-2.43-8.88l11.6,6.16c0,.18,0,.36.05.55a40.11,40.11,0,0,1-1,13.53,31.68,31.68,0,0,0,2.95-16.6A31.93,31.93,0,0,0,29.54,30.1l12.4,8.27c.05.41.08.82.12,1.24a40,40,0,0,1-1.34,14.88,32,32,0,0,0-.37-31.17Z"/>
    </g>`;
  const lq = clipId();
  return svgEl(`<svg class="art mark art-headset" viewBox="0 0 180 160" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="90" cy="153" rx="80" ry="8"/>
    <path class="solid" d="M28 92C28 16 152 16 152 92H147C147 23 33 23 33 92Z"/>
    <path class="hi-line" d="M31 72C33.5 26 146.5 26 149 72"/>
    <path class="soft" d="M37 94C37 50 143 50 143 94V100C141 60 39 60 37 100Z"/>
    <path class="line" d="M38.5 92C40 55 140 55 141.5 92"/>
    <path class="shade" d="M37 100C39 60 141 60 143 100V97C141 63 39 63 37 97Z"/>
    <rect class="solid" x="24" y="80" width="12" height="22" rx="3.5"/>
    <rect class="solid" x="144" y="80" width="12" height="22" rx="3.5"/>
    <rect class="cut" x="27.5" y="84" width="5" height="9" rx="2.5"/>
    <rect class="cut" x="147.5" y="84" width="5" height="9" rx="2.5"/>
    <rect class="soft" x="6.5" y="112" width="4" height="15" rx="2"/>
    <rect class="solid" x="9" y="95" width="42" height="61" rx="17"/>
    <rect class="solid" x="129" y="95" width="42" height="61" rx="17"/>
    <clipPath id="${lq}"><rect x="9" y="95" width="42" height="61" rx="17"/><rect x="129" y="95" width="42" height="61" rx="17"/></clipPath>
    ${liquid(lq, 9, 95, 162, 61)}
    <path class="shade" d="M9 113C9 103 15 95 27 95H23C16 97 13.5 104 13.5 113V138C13.5 147 17 153 25 156H27C15 156 9 148 9 138Z"/>
    <path class="shade" d="M171 113C171 103 165 95 153 95H157C164 97 166.5 104 166.5 113V138C166.5 147 163 153 155 156H153C165 156 171 148 171 138Z"/>
    <path class="hi" d="M21 99C27 96.5 37 96.5 43 99C36 98.5 28 98.5 21 102Z"/>
    <path class="hi" d="M137 99C143 96.5 153 96.5 159 99C152 98.5 144 98.5 137 102Z"/>
    <rect class="soft" x="47" y="99" width="15" height="54" rx="7.5"/>
    <rect class="soft" x="118" y="99" width="15" height="54" rx="7.5"/>
    <path class="shade" d="M47 106.5C47 102 50 99 54.5 99V153C50 153 47 150 47 145.5Z"/>
    <path class="shade" d="M133 106.5C133 102 130 99 125.5 99V153C130 153 133 150 133 145.5Z"/>
    ${sails(22.5, 111)}
    ${sails(157.5, 111)}
    <path class="solid" d="M43.4 131.5C45.5 142 54.5 150.5 67.5 152.2L67.9 148.8C56.5 147 48.8 139.6 46.9 130.6Z"/>
    <circle class="solid" cx="44.6" cy="129" r="4.6"/>
    <circle class="cut" cx="44.6" cy="129" r="1.8"/>
    <rect class="soft" x="65.5" y="146.2" width="13" height="7.4" rx="3.7"/>
    <circle class="led mic" cx="76.4" cy="149.9" r="1.4"/>
    <text class="lq-text" x="90" y="130" text-anchor="middle"><tspan class="lq-n"></tspan><tspan class="lq-u" dx="1">%</tspan></text>
    <g class="bp">${callout(76.4, 149.9)}${callout(8.5, 119.5)}${callout(157.5, 111)}${callout(22.5, 111)}</g>
  </g>
    <image class="photo" href="/img/hs80.png" x="0" y="0" width="180" height="160" preserveAspectRatio="xMidYMid meet"/>
  </svg>`);
}

// ---- Epomaker P75 (75%), from above: the case with its plate, every keycap at its real width standing on the plate
// (the F row a little apart, as on the board), accent Esc and Enter, and the knurled knob at the top right ----
// Another VIA keyboard (devices/via-layout.js): drawn from its own layout, in the same layers, with no product photo
// (the P75's would be wrong). Set by app.js when the keyboard's session arrives; null = the P75.
let kbLayout = null;
export function setKeyboardLayout(l) { kbLayout = l && !l.builtIn ? l : null; }
function layoutKeyboardArt(L) {
  const u = 13, gap = 2.4, pad = 10, W = pad * 2 + L.width * u - gap, H = pad * 2 + L.height * u - gap;
  const f = (n) => n.toFixed(1);
  let keys = '';
  for (const k of L.keys) {
    const kx = pad + k.x * u, ky = pad + k.y * u, kw = k.w * u - gap, kh = k.h * u - gap;
    if (k.knob) { const r = Math.min(kw, kh) / 2; keys += `<circle class="solid" cx="${f(kx + kw / 2)}" cy="${f(ky + kh / 2)}" r="${f(r)}"/>`; continue; }
    keys += `<rect class="soft" x="${f(kx)}" y="${f(ky)}" width="${f(kw)}" height="${f(kh)}" rx="2.2"/>`
      + `<rect class="hi" x="${f(kx + 1.6)}" y="${f(ky + 1.2)}" width="${f(Math.max(0, kw - 3.2))}" height="${f(Math.max(0, kh - 3.6))}" rx="1.6"/>`;
  }
  return svgEl(`<svg class="art mark art-keyboard" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true">
    <g class="drawn">
    <rect class="solid" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>
    <rect class="shade" x="1" y="${f(H - 6)}" width="${f(W - 2)}" height="5" rx="2.5"/>
    <rect class="cut" x="${f(pad - 3)}" y="${f(pad - 3)}" width="${f(W - 2 * pad + 6)}" height="${f(H - 2 * pad + 6)}" rx="5"/>
    ${keys}
    </g>
  </svg>`);
}
export function keyboardArt() {
  if (kbLayout) return layoutKeyboardArt(kbLayout);
  // [start, width] in key units per row (16 units wide)
  const R = [
    [[0, 1], [1.25, 1], [2.25, 1], [3.25, 1], [4.25, 1], [5.5, 1], [6.5, 1], [7.5, 1], [8.5, 1], [9.75, 1], [10.75, 1], [11.75, 1], [12.75, 1], [14, 1]],
    [...Array.from({ length: 13 }, (_, i) => [i, 1]), [13, 2], [15, 1]],
    [[0, 1.5], ...Array.from({ length: 12 }, (_, i) => [1.5 + i, 1]), [13.5, 1.5], [15, 1]],
    [[0, 1.75], ...Array.from({ length: 11 }, (_, i) => [1.75 + i, 1]), [12.75, 2.25], [15, 1]],
    [[0, 2.25], ...Array.from({ length: 10 }, (_, i) => [2.25 + i, 1]), [12.25, 1.75], [14, 1]],
    [[0, 1.25], [1.25, 1.25], [2.5, 1.25], [3.75, 6.25], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1], [15, 1]],
  ];
  const ACCENT = new Set(['0:0', '3:12.75']);  // Esc and Enter
  const u = 13, gap = 2.4, pad = 10, W = pad * 2 + 16 * u - gap, H = pad * 2 + 6 * u - gap + 2.6;
  const f = (n) => n.toFixed(1);
  let keys = '';
  R.forEach((row, ri) => row.forEach(([x, w]) => {
    const kx = pad + x * u, ky = pad + ri * u + (ri > 0 ? 2.6 : 0), kw = w * u - gap, kh = u - gap;
    const cls = ACCENT.has(`${ri}:${x}`) ? 'accent' : 'soft';
    keys += `<rect class="${cls}" x="${f(kx)}" y="${f(ky)}" width="${f(kw)}" height="${f(kh)}" rx="2.2"/>`
      + `<rect class="hi" x="${f(kx + 1.6)}" y="${f(ky + 1.2)}" width="${f(kw - 3.2)}" height="${f(kh - 3.6)}" rx="1.6"/>`;
  }));
  const cx = pad + 15 * u + (u - gap) / 2, cy = pad + (u - gap) / 2, r = (u - gap) / 2 + 1;
  return svgEl(`<svg class="art mark art-keyboard" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="${f(W / 2)}" cy="${f(H - 2)}" rx="${f(W / 2 - 4)}" ry="10"/>
    <rect class="solid" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>
    <rect class="shade" x="1" y="${f(H - 6)}" width="${f(W - 2)}" height="5" rx="2.5"/>
    <rect class="hi" x="8" y="2.2" width="${f(W - 16)}" height="1.6" rx="0.8"/>
    <rect class="cut" x="${f(pad - 3)}" y="${f(pad - 3)}" width="${f(W - 2 * pad + 6)}" height="${f(H - 2 * pad + 6)}" rx="5"/>
    ${keys}
    <circle class="cut" cx="${f(cx)}" cy="${f(cy)}" r="${f(r + 1.2)}"/>
    <circle class="solid" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>
    <circle class="line knurl" cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 1.1)}"/>
    <circle class="hi" cx="${f(cx - 1.4)}" cy="${f(cy - 1.4)}" r="1.6"/>
    <g class="bp">${callout(+f(cx), +f(cy))}${callout(pad + 5.3, pad + 5.3)}${dimH(+f(H + 6), 1, +f(W - 1))}</g>
  </g>
    <image class="photo" href="/img/p75.png" x="0" y="0" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid meet"/>
  </svg>`);
}

export const artFor = { mouse: mouseArt, headset: headsetArt, keyboard: keyboardArt };
// a device added in my-devices/ (21 Oct 2026): a plain rounded tile (the built-in drawings show Shawn's own devices);
// artOf(d) is what pages call for any device
export const artOf = (d) => (artFor[d.id] || plainArt)();
function plainArt() {
  return svgEl(`<svg viewBox="0 0 64 64" class="art mark" aria-hidden="true"><rect class="solid" x="10" y="14" width="44" height="36" rx="9"/><rect class="hi" x="18" y="19" width="28" height="2" rx="1"/><circle class="cut" cx="32" cy="34" r="6"/></svg>`);
}
