// Device drawings (19 Oct 2026, second pass; Shawn: "make them actually look high tech and cool as well as accurate to
// what they actually look like"). Each is drawn from the real product, in layers the drawing styles (Settings >
// Appearance, style.css) paint: .solid the body in the device color, .soft the secondary parts, .cut the recesses,
// .cut-line seams; and for depth .shade (the far side in shadow), .hi (a sheen where light catches), .led (the parts
// that light up: the HS80's logos and mic light), .line (fine detail: wheel ridges, stitching, knurling).
// The body and the soft parts are lit with gradients (light from the top left), their colors per look in style.css.
// In the Realistic look all three devices show the makers' own product photos (public/img: Pulsar, Corsair, Epomaker, 19 Oct
// 2026) in place of the drawing (.drawn); the other looks and the Lighting previews keep the drawing.
// Hover lifts a drawing; a settings change gives one small bounce (style.css).
// .glaze (a soft light over the main bodies) and .grain (Titanium's brushed grain) copy the main body shapes; both are
// hidden unless a look shows them (22 Oct 2026, style.css "The drawn looks, made beautiful").
import { svgEl } from './dom.js';
import { ART_STYLES } from '../core/theme.js';
import { isDemo } from '../core/devices.js';
const ART_LOOKS = ART_STYLES.map(([k]) => k);

// the lit gradients every drawing uses (dhb-<device> the body, dhs-<device> the soft parts), once per page; the stop
// colors are CSS variables set per device and per look in style.css
// (22 Oct 2026, the looks made beautiful) besides the body and soft-part gradients, each look and device has: dhr-, a rim
// light for outlines (bright where the light comes from, top left, and a second light from the bottom right, its colors
// per look); dhg-, a soft radial light that the .glaze layer lays over the main body (frost, sheen or a glow); dha-, the
// accent keys. dh-brush-h / -v: a brushed metal grain, the .grain layer's fill in Titanium. All static.
const stop = (o, v) => `<stop offset="${o}" style="stop-color: var(${v})"/>`;
export function artDefs() {
  const g = (dev, look) => `<linearGradient id="dhb-${dev}-${look}" x1="0" y1="0" x2="1" y2="1">${stop(0, '--gb1')}${stop('.45', '--gb2')}${stop(1, '--gb3')}</linearGradient>`
    + `<linearGradient id="dhs-${dev}-${look}" x1="0" y1="0" x2="0" y2="1">${stop(0, '--gs1')}${stop(1, '--gs2')}</linearGradient>`
    + `<linearGradient id="dhr-${dev}-${look}" x1="0" y1="0" x2="1" y2="1">${stop(0, '--gr1')}${stop('.5', '--gr2')}${stop(1, '--gr3')}</linearGradient>`
    + `<radialGradient id="dhg-${dev}-${look}" cx=".32" cy=".22" r=".85" fx=".26" fy=".12">${stop(0, '--gg1')}${stop('.45', '--gg2')}${stop(1, '--gg3')}</radialGradient>`
    + `<linearGradient id="dha-${dev}-${look}" x1="0" y1="0" x2="0" y2="1">${stop(0, '--ga1')}${stop(1, '--ga2')}</linearGradient>`;
  const brush = (id, rot) => `<pattern id="${id}" patternUnits="userSpaceOnUse" width="40" height="3.7"${rot ? ' patternTransform="rotate(90)"' : ''}><rect width="40" height=".35" fill="#fff" fill-opacity=".1"/><rect y=".9" width="40" height=".25" fill="#000" fill-opacity=".09"/><rect y="1.6" width="40" height=".5" fill="#fff" fill-opacity=".05"/><rect y="2.5" width="40" height=".3" fill="#000" fill-opacity=".07"/><rect y="3.1" width="40" height=".25" fill="#fff" fill-opacity=".08"/></pattern>`;
  // each look's set sits in a group that takes that look's colors (style.css), so a preview box shows its own look
  const set = (look) => `<g class="art-preview" data-art-preview="${look}">${['mouse', 'headset', 'keyboard'].map((d) => `<g class="art art-${d}">${g(d, look)}</g>`).join('')}</g>`;
  return svgEl(`<svg class="art-defs" width="0" height="0" aria-hidden="true" style="position: absolute"><defs>${ART_LOOKS.map(set).join('')}${brush('dh-brush-h')}${brush('dh-brush-v', true)}</defs></svg>`);
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
// the empty share (style.css: --lvl), the waves slide sideways
function liquid(clip, x, y, w, h) {
  const p = 36, a = 2.4, x0 = x - p * 2, x1 = x + w + p * 2;
  const wave = (dy) => { let d = `M${x0} ${y + dy}`; for (let wx = x0; wx < x1; wx += p) d += `q${p / 4} ${-a} ${p / 2} 0t${p / 2} 0`; return `${d}V${y + h + 4}H${x0}Z`; };
  // no bubbles (Shawn, 22 Oct 2026: "these 3 dots shouldnt be there at all")
  const g = `${clip}-g`, sh = `${clip}-s`;
  return `<defs><linearGradient id="${g}" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${y + h}"><stop offset="0" class="lq-top"/><stop offset=".22" class="lq-mid"/><stop offset="1" class="lq-deep"/></linearGradient>
      <linearGradient id="${sh}" x1="0" y1="0" x2="1" y2=".6"><stop offset=".18" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff" stop-opacity=".22"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".52" stop-color="#fff" stop-opacity=".08"/><stop offset=".58" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g clip-path="url(#${clip})"><g class="liquid" style="--lh: ${h}px">
      <path class="wave back" d="${wave(1.6)}"/><path class="wave front" d="${wave(0)}" style="fill: url(#${g})"/>
      <path class="wave-edge" d="${wave(0).split('V')[0]}"/>
      ${[0.15, 0.35, 0.55, 0.72, 0.88].map((f, i) => `<circle class="mote m${i}" cx="${(x + w * f).toFixed(1)}" cy="${y + 3}" r="${(0.7 + (i % 3) * 0.25).toFixed(2)}"/>`).join('')}
    </g><rect class="sheen" x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${sh})"/></g>`;
}
// no words (Shawn, 21 Oct 2026: "remove all the words ... but make it still look cool"): a part is marked with a small
// crosshair target, and a measurement is a line with end ticks and a centre tick
const callout = (x, y) => `<g class="bp-mark"><circle class="bp-lead" cx="${x}" cy="${y}" r="3.2"/><path class="bp-lead" d="M${x - 5.5} ${y}H${x - 2}M${x + 2} ${y}H${x + 5.5}M${x} ${y - 5.5}V${y - 2}M${x} ${y + 2}V${y + 5.5}"/><circle class="bp-dot" cx="${x}" cy="${y}" r=".9"/></g>`;
const dimV = (x, y1, y2) => `<path class="bp-lead" d="M${x} ${y1}V${y2}M${x - 2} ${y1}H${x + 2}M${x - 2} ${y2}H${x + 2}M${x - 1.2} ${(y1 + y2) / 2}H${x + 1.2}"/>`;
const dimH = (y, x1, x2) => `<path class="bp-lead" d="M${x1} ${y}H${x2}M${x1} ${y - 2}V${y + 2}M${x2} ${y - 2}V${y + 2}M${(x1 + x2) / 2} ${y - 1.2}V${y + 1.2}"/>`;

// ---- Pulsar X-Lite CrazyLight, from above (redrawn 21 Oct 2026 from Pulsar's own product photo, Shawn: "more closely
// accurate to the real thing"): the outline traced from the photo (wide, nearly straight sides, the rear a little
// fuller on the right), the long wheel in its slot, the split between the buttons running down to the seam just above
// the middle, the two side buttons on the left, and the small pulsar wordmark under the left button ----
const MOUSE_SHAPE = 'M47.9 2.3C52.8 2.3 57.3 1.9 62.1 2.6C66.9 3.3 73.0 5.2 76.7 6.5C80.4 7.8 82.4 9.1 84.5 10.4C86.6 11.7 88.1 12.9 89.3 14.2C90.6 15.5 91.2 16.8 91.9 18.1C92.6 19.4 93.1 20.7 93.5 22.0C93.9 23.3 94.0 24.6 94.2 25.9C94.3 27.2 94.4 28.5 94.5 29.8C94.6 31.1 94.4 32.4 94.5 33.7C94.6 35.0 94.8 36.2 94.8 37.5C94.9 38.8 94.8 40.1 94.8 41.4C94.8 42.7 94.8 44.0 94.8 45.3C94.8 46.6 94.8 47.9 94.8 49.2C94.8 50.5 94.8 51.8 94.8 53.1C94.8 54.4 94.8 55.7 94.8 57.0C94.8 58.3 94.8 59.5 94.8 60.8C94.8 62.1 94.8 63.4 94.8 64.7C94.9 66.0 95.1 67.3 95.1 68.6C95.2 69.9 95.0 71.2 95.1 72.5C95.3 73.8 95.6 75.1 95.8 76.4C96.0 77.7 96.0 79.0 96.1 80.3C96.2 81.6 96.3 82.8 96.4 84.1C96.5 85.4 96.6 86.7 96.8 88.0C96.9 89.3 97.2 90.6 97.4 91.9C97.6 93.2 97.6 94.5 97.7 95.8C97.8 97.1 98.0 98.4 98.1 99.7C98.2 101.0 98.3 102.3 98.4 103.6C98.4 104.9 98.3 106.1 98.4 107.4C98.4 108.7 98.7 110.0 98.7 111.3C98.8 112.6 98.7 113.9 98.7 115.2C98.7 116.5 98.8 117.8 98.7 119.1C98.7 120.4 98.5 121.7 98.4 123.0C98.3 124.3 98.2 125.6 98.1 126.9C97.9 128.2 97.6 129.4 97.4 130.7C97.2 132.0 97.0 133.3 96.8 134.6C96.5 135.9 96.1 137.2 95.8 138.5C95.5 139.8 95.3 141.1 94.8 142.4C94.4 143.7 93.7 145.0 93.2 146.3C92.7 147.6 92.2 148.9 91.6 150.2C91.0 151.5 90.3 152.8 89.6 154.0C88.9 155.3 88.2 156.6 87.4 157.9C86.5 159.2 85.5 160.5 84.5 161.8C83.4 163.1 82.5 164.4 81.2 165.7C80.0 167.0 78.6 168.3 77.0 169.6C75.5 170.9 73.8 172.2 71.8 173.5C69.8 174.8 69.1 176.1 65.0 177.3C60.9 178.6 53.3 180.9 47.2 180.9C41.2 180.9 32.9 178.6 28.5 177.3C24.1 176.1 22.9 174.8 20.7 173.5C18.6 172.2 17.1 170.9 15.5 169.6C14.0 168.3 12.5 167.0 11.3 165.7C10.1 164.4 9.3 163.1 8.4 161.8C7.5 160.5 6.5 159.2 5.8 157.9C5.1 156.6 4.7 155.3 4.2 154.0C3.7 152.8 3.2 151.5 2.9 150.2C2.6 148.9 2.5 147.6 2.3 146.3C2.0 145.0 1.7 143.7 1.6 142.4C1.5 141.1 1.6 139.8 1.6 138.5C1.6 137.2 1.6 135.9 1.6 134.6C1.6 133.3 1.6 132.0 1.6 130.7C1.7 129.4 1.8 128.2 1.9 126.9C2.0 125.6 2.1 124.3 2.3 123.0C2.4 121.7 2.8 120.4 2.9 119.1C3.1 117.8 3.1 116.5 3.2 115.2C3.4 113.9 3.7 112.6 3.9 111.3C4.0 110.0 4.1 108.7 4.2 107.4C4.3 106.1 4.5 104.9 4.5 103.6C4.6 102.3 4.5 101.0 4.5 99.7C4.5 98.4 4.5 97.1 4.5 95.8C4.5 94.5 4.6 93.2 4.5 91.9C4.5 90.6 4.0 89.3 4.2 88.0C4.4 86.7 5.5 85.4 5.5 84.1C5.5 82.8 4.4 81.6 4.2 80.3C4.0 79.0 4.3 77.7 4.2 76.4C4.2 75.1 3.9 73.8 3.9 72.5C3.8 71.2 3.9 69.9 3.9 68.6C3.9 67.3 3.9 66.0 3.9 64.7C3.8 63.4 3.6 62.1 3.6 60.8C3.5 59.5 3.4 58.3 3.6 57.0C3.7 55.7 4.4 54.4 4.5 53.1C4.6 51.8 4.3 50.5 4.2 49.2C4.1 47.9 4.0 46.6 3.9 45.3C3.8 44.0 3.7 42.7 3.6 41.4C3.5 40.1 3.3 38.8 3.2 37.5C3.1 36.2 3.0 35.0 2.9 33.7C2.9 32.4 2.9 31.1 2.9 29.8C3.0 28.5 3.1 27.2 3.2 25.9C3.3 24.6 3.3 23.3 3.6 22.0C3.8 20.7 4.3 19.4 4.9 18.1C5.4 16.8 5.7 15.5 6.8 14.2C7.9 12.9 9.4 11.7 11.3 10.4C13.3 9.1 14.8 7.8 18.4 6.5C22.1 5.2 28.1 3.3 33.0 2.6C37.9 1.9 43.0 2.3 47.9 2.3Z';
export function mouseArt() {
  const lq = clipId();
  let ridges = '';
  for (let y = 12; y <= 46; y += 3.4) ridges += `<path class="line" d="M45.6 ${y.toFixed(1)}H54.4"/>`;
  return svgEl(`<svg class="art mark art-mouse" viewBox="0 0 100 183" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="50" cy="176" rx="40" ry="9"/>
    <rect class="soft side-btn" x="2.6" y="55" width="3.6" height="26" rx="1.8"/>
    <rect class="soft side-btn" x="2.6" y="86.5" width="3.6" height="26.5" rx="1.8"/>
    <path class="solid" d="${MOUSE_SHAPE}"/>
    <path class="grain" d="${MOUSE_SHAPE}"/><path class="glaze" d="${MOUSE_SHAPE}"/>
    <clipPath id="${lq}"><path d="${MOUSE_SHAPE}"/></clipPath>
    ${liquid(lq, 0, 2, 100, 180)}
    <path class="shade" d="M93 30C95 60 96 95 97 112C98 135 96 158 84 172C76 180 64 182 56 182C72 176 85 160 88 136C90 112 89 70 86 30Z"/>
    <path class="hi" d="M14 16C10 32 9 55 10 80C14 60 19 36 30 9C23 9 17 11 14 16Z"/>
    <path class="hi" d="M22 118C18 136 22 156 34 168C29 150 28 134 31 116C28 114 24 115 22 118Z"/>
    <path class="cut-line" d="M50.2 51.5V85"/>
    <path class="cut-line" d="M7.5 83.5Q50 86.5 92.5 83.5"/>
    <rect class="cut" x="41.4" y="3.5" width="17.4" height="48.5" rx="8.2"/>
    <rect class="soft" x="44.2" y="8" width="11.6" height="40.5" rx="5.8"/>
    ${ridges}
    <path class="scan" d="${MOUSE_SHAPE}" pathLength="100"/>
    <text class="logo-text" x="26.5" y="96.5" text-anchor="middle">pulsar</text>
    <text class="lq-text" x="50" y="128" text-anchor="middle"><tspan class="lq-n"></tspan><tspan class="lq-u" dx="1">%</tspan></text>
    <g class="bp">${dimV(-3, 2, 181)}${dimH(186, 2, 98)}${callout(50, 28)}${callout(4.4, 70)}</g>
  </g>
    <image class="photo" href="/img/xlite.png" x="0" y="0" width="100" height="183" preserveAspectRatio="xMidYMid meet"/>
  </svg>`);
}

// ---- Corsair HS80 RGB Wireless, three-quarter view (redrawn 21 Oct 2026 from Corsair's own product photo, Shawn: "more
// closely accurate to the real thing"): the wide flat headband with its two fabric pads and the status light on top,
// the metal Y yokes down to their pivots, the thick fabric cushion, the rounded-square cup with its inset plate and
// the lit Corsair sails, and the mic boom sweeping forward to its tip, where the mute light is. Every part placed from
// the photo (its pixels scaled to this 160 x 220 box) ----
export function headsetArt() {
  // the Corsair sails emblem (the shapes of Corsair's 2020 logo, Wikimedia Commons), lit, on the cup's plate
  const sails = (x, y, k = 0.36) => `<g class="led" transform="translate(${x} ${y}) scale(${k}) translate(-40 -40)">
      <path d="M43.47,13.5S47.79,22.27,47,25.93c0,0,11.27,3.64,12.52,9.65C59.52,35.58,65.69,27.46,43.47,13.5Z"/>
      <path d="M39.13,26.66A39.68,39.68,0,0,1,41.37,34L35,31.59c.59-3.9-3.2-9.83-3.2-9.830Z"/>
      <path d="M27.73,32.7A46,46,0,0,1,29.68,39l-5.8-1.44c.6-3.9-3.08-8.62-3.08-8.62Z"/>
      <path d="M40.35,23.32S66.19,41.47,67.89,48.51c1.29,5.3-2.450,10.19-2.45,10.19s-2-13.82-51.51,7.17a26.630,26.630,0,0,0,7-20.44,26.3,26.3,0,0,0-2.43-8.88l11.6,6.16c0,.18,0,.36.05.55a40.11,40.11,0,0,1-1,13.53,31.68,31.68,0,0,0,2.95-16.6A31.930,31.930,0,0,0,29.54,30.1l12.4,8.27c.05.41.08.82.12,1.24a40,40,0,0,1-1.34,14.88,32,32,0,0,0-.37-31.170Z"/>
    </g>`;
  const lq = clipId();
  const BAND = 'M72 4C82 1 112 1 124 4C131 6 135 12 136 22L137.5 69H57.5L60.5 20C61.5 11 65 6 72 4Z';
  const CUP = 'M94 95H131C147 95 159 107 159 123V165C159 181 147 193 131 193H94C78 193 66 181 66 165V123C66 107 78 95 94 95Z';
  return svgEl(`<svg class="art mark art-headset" viewBox="0 0 160 220" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="100" cy="204" rx="58" ry="9"/>
    <!-- headband: one wide flat strip (as in the photo, no gap through it), its far half in shadow, the two fabric pads
         and the status light on its inside -->
    <path class="solid" d="${BAND}"/>
    <path class="grain" d="${BAND}"/><path class="glaze" d="${BAND}"/>
    <path class="shade" d="M60.5 20C61.5 11 65 6 72 4C80 2.3 90 1.8 98 1.9C91 3 87 7 86.5 15L95 69H57.5Z"/>
    <path class="hi-line" d="M100 3.6C114 3.4 126 5 131 11C134 15 134.8 19 135 24"/>
    <path class="cut-line" d="M95 69L86.5 15C87 7 91 3 98 1.9"/>
    <rect class="soft" x="70" y="25" width="22" height="26" rx="4" transform="rotate(-5 81 38)"/>
    <rect class="soft" x="100" y="29" width="29" height="22" rx="4" transform="rotate(3 114.5 40)"/>
    <path class="line dash" d="M72.5 29.5L90 28M101.5 33H127.5"/>
    <rect class="led" x="79" y="20.5" width="6" height="2" rx="1"/>
    <!-- the Y yokes, from the band's feet down to the pivots on the cup -->
    <path class="solid" d="M57.5 67H70L74.5 88L79.5 67H91.5L80 99H71Z"/>
    <path class="solid" d="M97.5 67H110.5L119.5 86L126 67H138L125 98H117Z"/>
    <path class="cut" d="M67 71H70.5L74.5 85L78.5 71H82.5L76.6 90H72.6Z"/>
    <path class="cut" d="M107 71H111.5L119.5 84L124.6 71H129L122.4 89.5H118.8Z"/>
    <circle class="soft" cx="75.5" cy="99" r="3.2"/><circle class="soft" cx="121" cy="97.5" r="3.4"/>
    <!-- the far cushion's thick fabric, the near cup with its inset plate and the lit sails -->
    <rect class="soft" x="46" y="101" width="50" height="91" rx="23"/>
    <path class="shade" d="M46 124C46 111 56 101 69 101H74C61 103 54 113 54 126V168C54 181 61 190 74 192H69C56 192 46 182 46 169Z"/>
    <path class="solid" d="${CUP}"/>
    <path class="grain" d="${CUP}"/><path class="glaze" d="${CUP}"/>
    <!-- the Live battery liquid fills the whole headset as one shape, from the bottom: at 100% the band, both yokes,
         the far cushion and the near cup (Shawn, 22 Oct 2026: "make the battery go up the full device when full") -->
    <clipPath id="${lq}"><path d="${BAND}"/><path d="M57.5 67H70L74.5 88L79.5 67H91.5L80 99H71Z"/><path d="M97.5 67H110.5L119.5 86L126 67H138L125 98H117Z"/><rect x="46" y="101" width="50" height="91" rx="23"/><path d="${CUP}"/></clipPath>
    ${liquid(lq, 46, 1, 113, 192)}
    <path class="cut" d="M67 71H70.5L74.5 85L78.5 71H82.5L76.6 90H72.6Z"/>
    <path class="cut" d="M107 71H111.5L119.5 84L124.6 71H129L122.4 89.5H118.8Z"/>
    <path class="shade" d="M159 123V165C159 181 147 193 131 193H124C140 191 151 180 151 165V123C151 110 143 99 131 96C146 97 159 108 159 123Z"/>
    <rect class="cut" x="93.5" y="111.5" width="57" height="66" rx="15"/>
    <rect class="soft" x="95.5" y="113.5" width="53" height="62" rx="13.5"/>
    <path class="hi" d="M98 117C104 114 120 114 128 115.5C116 116.5 106 118 98 124Z"/>
    ${sails(133, 128)}
    <path class="scan" d="${CUP}" pathLength="100"/>
    <!-- the mic boom, out of the cup's lower front edge, forward to a squared-off tip with no light on it (Shawn, 22 Oct
         2026: "none of the mics have the red dot at the end of the headset, should be just squared off") -->
    <path class="solid" d="M93 190.5C70 196 34 204 8 208.5L9 213.5C35 209.5 71 202 95.5 196Z"/>
    <rect class="soft" x="1.5" y="207" width="9" height="7.5" rx=".6" transform="rotate(-9 6 211)"/>
    <text class="lq-text" x="122" y="158" text-anchor="middle"><tspan class="lq-n"></tspan><tspan class="lq-u" dx="1">%</tspan></text>
    <g class="bp">${callout(4, 211)}${callout(133, 128)}${callout(82.8, 23)}${callout(75.5, 99)}</g>
  </g>
    <image class="photo" href="/img/hs80.png" x="0" y="0" width="160" height="220" preserveAspectRatio="xMidYMid meet"/>
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
  // the P75's navy keys (from Epomaker's photo, 21 Oct 2026): Esc, Enter, the spacebar and the four arrows
  const ACCENT = new Set(['0:0', '3:12.75', '5:3.75', '4:14', '5:13', '5:14', '5:15']);
  const u = 13, gap = 2.4, pad = 10, W = pad * 2 + 16 * u - gap, H = pad * 2 + 6 * u - gap + 2.6;
  const f = (n) => n.toFixed(1);
  let keys = '';
  R.forEach((row, ri) => row.forEach(([x, w]) => {
    const kx = pad + x * u, ky = pad + ri * u + (ri > 0 ? 2.6 : 0), kw = w * u - gap, kh = u - gap;
    const cls = ACCENT.has(`${ri}:${x}`) ? 'accent' : 'soft';
    keys += `<rect class="${cls}" x="${f(kx)}" y="${f(ky)}" width="${f(kw)}" height="${f(kh)}" rx="2.2"/>`
      + `<rect class="hi" x="${f(kx + 1.6)}" y="${f(ky + 1.2)}" width="${f(kw - 3.2)}" height="${f(kh - 3.6)}" rx="1.6"/>`;
  }));
  const cx = pad + 15 * u + (u - gap) / 2, cy = pad + (u - gap) / 2, r = (u - gap) / 2;  // the size of a key, so its ring keeps the same margin to the case as the keys (Shawn, 21 Oct 2026: "knob is too close")
  return svgEl(`<svg class="art mark art-keyboard" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true">
    <g class="drawn">
    <ellipse class="floor" cx="${f(W / 2)}" cy="${f(H - 2)}" rx="${f(W / 2 - 4)}" ry="10"/>
    <rect class="solid" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>
    <rect class="grain" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/><rect class="glaze" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>
    <rect class="shade" x="1" y="${f(H - 6)}" width="${f(W - 2)}" height="5" rx="2.5"/>
    <rect class="hi" x="8" y="2.2" width="${f(W - 16)}" height="1.6" rx="0.8"/>
    <rect class="cut" x="${f(pad - 3)}" y="${f(pad - 3)}" width="${f(W - 2 * pad + 6)}" height="${f(H - 2 * pad + 6)}" rx="5"/>
    ${keys}
    <circle class="cut" cx="${f(cx)}" cy="${f(cy)}" r="${f(r + 0.9)}"/>
    <circle class="solid" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>
    <circle class="line knurl" cx="${f(cx)}" cy="${f(cy)}" r="${f(r - 1.1)}"/>
    <circle class="hi" cx="${f(cx - 1.4)}" cy="${f(cy - 1.4)}" r="1.6"/>
    <rect class="scan" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9" pathLength="100"/>
    <g class="bp">${callout(+f(cx), +f(cy))}${callout(pad + 5.3, pad + 5.3)}${dimH(+f(H + 6), 1, +f(W - 1))}</g>
  </g>
    <image class="photo" href="/img/p75.png" x="0" y="0" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid meet"/>
  </svg>`);
}

export const artFor = { mouse: mouseArt, headset: headsetArt, keyboard: keyboardArt };

// Generic devices, no particular model (22 Oct 2026, Shawn: the loading tiles should suit "anyone with any device"):
// a symmetric mouse with a wheel and split buttons, an over-ear headset from the front, a plain keyboard with an even
// grid of keys. The same layers as the real drawings, so every look paints them.
// With a device id (22 Oct 2026, docs/handoff/battery-added-devices.md) the drawing is an added device's that reports a
// battery: it also carries the Live look's liquid and is marked data-dev, so ui/live-art.js paints that device's own
// level (never the mouse's or the headset's). Without one the drawing is exactly what it was.
const devAttr = (dev) => (dev ? ` data-dev="${String(dev).replace(/[^a-z0-9-]/g, '')}"` : '');
function addedLiquid(dev, shapes, x, y, w, h) {
  if (!dev) return '';
  const lq = clipId();
  return `<clipPath id="${lq}">${shapes}</clipPath>${liquid(lq, x, y, w, h)}`;
}
const lqText = (dev, x, y) => (dev ? `<text class="lq-text" x="${x}" y="${y}" text-anchor="middle"><tspan class="lq-n"></tspan><tspan class="lq-u" dx="1">%</tspan></text>` : '');
export function genericMouseArt(dev) {
  const body = 'M50 6C70 6 82 18 84 42C86 64 86 98 84 122C82 148 68 162 50 162C32 162 18 148 16 122C14 98 14 64 16 42C18 18 30 6 50 6Z';
  return svgEl(`<svg class="art mark art-mouse generic" viewBox="0 0 100 168" aria-hidden="true"${devAttr(dev)}><g class="drawn">
    <ellipse class="floor" cx="50" cy="160" rx="34" ry="8"/>
    <path class="solid" d="${body}"/>${addedLiquid(dev, `<path d="${body}"/>`, 14, 6, 72, 156)}
    <path class="shade" d="M84 42C86 64 86 98 84 122C82 148 68 162 54 162C68 152 76 134 77 112C78 88 77 60 74 38C77 38 81 39 84 42Z"/>
    <path class="hi" d="M22 30C19 46 18 62 19 76C24 60 30 42 40 16C31 18 25 22 22 30Z"/>
    <path class="cut-line" d="M50 6V66"/><path class="cut-line" d="M16.5 66Q50 74 83.5 66"/>
    <rect class="cut" x="44" y="18" width="12" height="28" rx="6"/><rect class="soft" x="46" y="20.5" width="8" height="23" rx="4"/>${lqText(dev, 50, 120)}
  </g></svg>`);
}
export function genericHeadsetArt(dev) {
  return svgEl(`<svg class="art mark art-headset generic" viewBox="0 0 180 160" aria-hidden="true"${devAttr(dev)}><g class="drawn">
    <ellipse class="floor" cx="90" cy="153" rx="76" ry="7"/>
    <path class="solid" d="M30 96C30 26 150 26 150 96H142C142 36 38 36 38 96Z"/>
    <path class="hi-line" d="M34 76C37 36 143 36 146 76"/>
    <rect class="solid" x="26" y="84" width="12" height="20" rx="4"/><rect class="solid" x="142" y="84" width="12" height="20" rx="4"/>
    <rect class="solid" x="12" y="98" width="40" height="56" rx="18"/><rect class="solid" x="128" y="98" width="40" height="56" rx="18"/>${addedLiquid(dev, '<rect x="12" y="98" width="40" height="56" rx="18"/><rect x="128" y="98" width="40" height="56" rx="18"/>', 12, 98, 156, 56)}
    <rect class="soft" x="46" y="102" width="14" height="48" rx="7"/><rect class="soft" x="120" y="102" width="14" height="48" rx="7"/>
    <path class="shade" d="M12 116C12 106 20 98 30 98H26C20 101 17 107 17 116V136C17 145 20 151 27 154H30C20 154 12 146 12 136Z"/>
    <path class="shade" d="M168 116C168 106 160 98 150 98H154C160 101 163 107 163 116V136C163 145 160 151 153 154H150C160 154 168 146 168 136Z"/>
    <path class="hi" d="M22 103C28 100.5 38 100.5 44 103C37 102.5 29 102.5 22 106Z"/><path class="hi" d="M136 103C142 100.5 152 100.5 158 103C151 102.5 143 102.5 136 106Z"/>${lqText(dev, 148, 132)}
  </g></svg>`);
}
export function genericKeyboardArt(dev) {
  const u = 13, gap = 2.4, pad = 10, cols = 15, W = pad * 2 + cols * u - gap, H = pad * 2 + 5 * u - gap, f = (n) => n.toFixed(1);
  let keys = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) keys += `<rect class="soft" x="${f(pad + c * u)}" y="${f(pad + r * u)}" width="${f(u - gap)}" height="${f(u - gap)}" rx="2.2"/>`;
  // the bottom row: modifiers, a long space bar, modifiers
  [[0, 1.5], [1.5, 1.5], [3, 7.5], [10.5, 1.5], [12, 1.5], [13.5, 1.5]].forEach(([x, w]) => { keys += `<rect class="soft" x="${f(pad + x * u)}" y="${f(pad + 4 * u)}" width="${f(w * u - gap)}" height="${f(u - gap)}" rx="2.2"/>`; });
  return svgEl(`<svg class="art mark art-keyboard generic" viewBox="0 0 ${f(W)} ${f(H)}" aria-hidden="true"${devAttr(dev)}><g class="drawn">
    <ellipse class="floor" cx="${f(W / 2)}" cy="${f(H - 2)}" rx="${f(W / 2 - 4)}" ry="9"/>
    <rect class="solid" x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>
    <rect class="cut" x="${f(pad - 3)}" y="${f(pad - 3)}" width="${f(W - 2 * pad + 6)}" height="${f(H - 2 * pad + 6)}" rx="5"/>${addedLiquid(dev, `<rect x="1" y="1" width="${f(W - 2)}" height="${f(H - 2)}" rx="9"/>`, 1, 1, W - 2, H - 2)}
    ${keys}${lqText(dev, f(W / 2), f(H / 2 + 5))}
  </g></svg>`);
}
export const genericArtFor = { mouse: genericMouseArt, headset: genericHeadsetArt, keyboard: genericKeyboardArt };
// a device added in my-devices/ (21 Oct 2026): a plain rounded tile (the built-in drawings show Shawn's own devices);
// artOf(d) is what pages call for any device. An added device that reports a battery (22 Oct 2026) gets the generic
// drawing of its kind (a plain tile for any other kind) with the Live look's liquid for its own battery.
const kindOf = (kind) => { const k = String(kind || '').toLowerCase(); return /mouse/.test(k) ? 'mouse' : /headset|headphone|earbud/.test(k) ? 'headset' : /keyboard/.test(k) ? 'keyboard' : null; };
// Shawn's own drawings only where his own devices are (23 Oct 2026, Shawn: "These appearences need to be just the
// generic ones ... when someone else is using a different set up"): the mouse slot's Pulsar once that mouse has been on
// this PC, the headset slot's HS80 only when it is an HS80 (any other USB headset runs there in sound-only mode), the
// keyboard slot once a keyboard has been (it draws that keyboard's own layout). Anything else: the generic drawing.
export function isOwn(kind, d) {
  if (isDemo()) return true;   // demo mode shows Shawn's own devices
  if (!d || !(d.seen || ['connected', 'asleep'].includes(d.status))) return false;
  if (kind === 'headset') return /HS80/i.test(String(d.adapter?.title || ''));
  return true;
}
export const slotArt = (kind, d) => (isOwn(kind, d) ? artFor[kind]() : genericArtFor[kind](d?.id));
export const artOf = (d) => {
  if (artFor[d.id]) return slotArt(d.id, d);
  if (d.adapter?.plugin && d.adapter.battery) { const k = kindOf(d.adapter.kind); return k ? genericArtFor[k](d.id) : plainArt(d.id); }
  return plainArt();
};
function plainArt(dev) {
  return svgEl(`<svg viewBox="0 0 64 64" class="art mark" aria-hidden="true"${devAttr(dev)}><rect class="solid" x="10" y="14" width="44" height="36" rx="9"/>${addedLiquid(dev, '<rect x="10" y="14" width="44" height="36" rx="9"/>', 10, 14, 44, 36)}<rect class="hi" x="18" y="19" width="28" height="2" rx="1"/><circle class="cut" cx="32" cy="34" r="6"/>${lqText(dev, 32, 46)}</svg>`);
}
