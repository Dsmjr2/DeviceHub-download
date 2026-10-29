// Koi Pond's live backdrop (28 Oct 2026, Shawn: "can you make the fish theme for me on devicehub", from a fan concept of
// live text-drawn wallpapers): koi and lily pads painted in characters on a teal-green pond, the koi swimming slowly and
// a few bubbles rising. One canvas behind everything, only while the Koi Pond look is on. It is cheap on purpose: about
// ten frames a second, only the fish, pads and bubbles are drawn (never the whole grid), nothing runs while the window is
// hidden. Picking this look is asking for motion, so it keeps swimming when Windows' animation effects are off (they
// are on Shawn's PC); then the koi swim at half speed.
const CELL = 15;                       // one character's square, in CSS pixels
const FPS = 10;
const KOI = [                          // the patterns: base, patch and fin colors
  { body: '#ef8a45', patch: '#f3eee2', fin: '#f6b07a' },
  { body: '#f3eee2', patch: '#d9493b', fin: '#f6d6c8' },
  { body: '#e2632f', patch: '#2b2420', fin: '#f09a62' },
  { body: '#f3eee2', patch: '#ef8a45', fin: '#f6e3cf' },
];
const PAD_GREENS = ['#5fae4f', '#6fbf5a', '#4f9a45', '#86cf6a'];
const CHARS = 't%$S;:t%';

let canvas = null, ctx = null, timer = 0, state = null, onVis = null, onSize = null;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (s, n) => s[Math.abs(Math.floor(n)) % s.length];
// a steady character for a cell (the same cell keeps its letter, with a slow shimmer)
const charAt = (x, y, t = 0) => pick(CHARS, (x * 73856093) ^ (y * 19349663) ^ Math.floor(t));
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function makeState(w, h) {
  const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
  const n = Math.max(2, Math.min(5, Math.round((cols * rows) / 2600)));
  const koi = Array.from({ length: n }, (_, i) => ({
    x: rand(0, cols), y: rand(0, rows), a: rand(0, Math.PI * 2), v: rand(0.18, 0.32), len: rand(8, 12),
    turn: rand(0, 1000), look: KOI[i % KOI.length], seed: Math.floor(rand(0, 1e6)),
  }));
  const pads = Array.from({ length: Math.max(4, Math.round(cols * rows / 1500)) }, () => ({
    x: rand(0, cols), y: rand(0, rows), r: rand(2.2, 4.4), notch: rand(0, Math.PI * 2), drift: rand(0, 1000),
  }));
  const bubbles = Array.from({ length: Math.round(cols / 6) }, () => ({ x: rand(0, cols), y: rand(0, rows), v: rand(0.04, 0.1) }));
  return { cols, rows, koi, pads, bubbles, t: 0 };
}

// one painted square: the color as a small tile, its character cut in darker on top (as the concept draws them)
function cell(x, y, color, ch, alpha = 1) {
  ctx.globalAlpha = alpha * 0.82;
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = '#0b2622';
  ctx.fillText(ch, x * CELL + CELL / 2, y * CELL + CELL / 2 + 0.5);
}

function drawPad(p, t) {
  const cx = p.x + Math.sin((t + p.drift) / 90) * 0.6, cy = p.y + Math.cos((t + p.drift) / 110) * 0.4;
  const r = Math.ceil(p.r);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy * 1.15);
      if (d > p.r) continue;
      // the notch: a wedge cut out of each pad, as on a real lily pad
      const ang = Math.atan2(dy, dx), off = Math.abs(((ang - p.notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (off < 0.32 && d > 0.6) continue;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      const g = PAD_GREENS[Math.abs((x * 7 + y * 13) % PAD_GREENS.length)];
      cell(x, y, g, charAt(x, y, t / 40), d > p.r - 1 ? 0.62 : 0.78);
    }
  }
}

function drawKoi(k, t) {
  const cos = Math.cos(k.a), sin = Math.sin(k.a);
  const seen = new Set();
  const L = k.len;
  // walk along the body from head (s = 0) to tail (s = L); the body is widest a third of the way back and sways
  for (let s = -1; s <= L + 2; s += 0.5) {
    const sway = Math.sin(t / 3 + s / 2.2) * (s / L) * 1.1;
    const tail = s > L;
    const half = tail ? (s - L) * 1.1 + 0.6 : Math.max(0.4, 2.1 * Math.sin(Math.PI * Math.min(1, (s + 1) / (L * 0.95))) * (s < L * 0.35 ? 1 : 1 - (s - L * 0.35) / (L * 1.1)));
    for (let w = -half; w <= half; w += 0.5) {
      const bx = k.x - cos * s - sin * (w + sway), by = k.y - sin * s + cos * (w + sway);
      const x = Math.round(bx), y = Math.round(by), key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const patch = !tail && ((Math.sin(s * 1.3 + k.seed) + Math.cos(w * 1.7 + k.seed / 7)) > 1.1);
      const color = tail ? k.look.fin : patch ? k.look.patch : k.look.body;
      cell(x, y, color, charAt(x + k.seed, y, t / 25), tail ? 0.7 : 0.92);
    }
  }
  // the side fins, a little behind the head
  for (const side of [-1, 1]) {
    const s = L * 0.28, w = side * (2.6 + Math.sin(t / 2 + side) * 0.4);
    const x = Math.round(k.x - cos * s - sin * w), y = Math.round(k.y - sin * s + cos * w);
    cell(x, y, k.look.fin, ';', 0.6);
  }
}

function step(st) {
  st.t += 1;
  for (const k of st.koi) {
    // a slow wander: the heading drifts on two sine waves, and the fish wraps round the window's edges
    k.a += Math.sin((st.t + k.turn) / 37) * 0.035 + Math.sin((st.t + k.turn) / 13) * 0.012;
    const v = k.v * (st.slow ? 0.5 : 1);
    k.x += Math.cos(k.a) * v; k.y += Math.sin(k.a) * v;
    const m = k.len + 4;
    if (k.x < -m) k.x = st.cols + m; if (k.x > st.cols + m) k.x = -m;
    if (k.y < -m) k.y = st.rows + m; if (k.y > st.rows + m) k.y = -m;
  }
  for (const b of st.bubbles) { b.y -= b.v; b.x += Math.sin((st.t + b.x * 10) / 20) * 0.03; if (b.y < -1) { b.y = st.rows + 1; b.x = rand(0, st.cols); } }
}

function draw() {
  const st = state;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = canvas.width / (st.cols * CELL) || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `700 ${CELL - 4}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // bubbles first (under everything), then the koi under the pads, as in a real pond
  ctx.fillStyle = 'rgba(200, 240, 230, 1)';
  for (const b of st.bubbles) { ctx.globalAlpha = 0.3; ctx.fillText(b.v > 0.07 ? 'o' : '°', Math.round(b.x) * CELL + CELL / 2, Math.round(b.y) * CELL + CELL / 2); }
  for (const k of st.koi) drawKoi(k, st.t);
  for (const p of st.pads) drawPad(p, st.t);
  ctx.globalAlpha = 1;
}

function size() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.ceil(w / CELL) * CELL * dpr; canvas.height = Math.ceil(h / CELL) * CELL * dpr;
  canvas.style.width = `${Math.ceil(w / CELL) * CELL}px`; canvas.style.height = `${Math.ceil(h / CELL) * CELL}px`;
  const old = state;
  state = makeState(w, h);
  if (old) { state.koi = old.koi; state.pads = old.pads.length === state.pads.length ? old.pads : state.pads; state.t = old.t; }
  draw();
}

function run() {
  clearInterval(timer); timer = 0;
  if (!canvas || document.hidden) return;
  state.slow = reduced();
  timer = setInterval(() => { step(state); draw(); }, 1000 / FPS);
}

// on: the Koi Pond look is showing; off: everything is taken away (no canvas, no timer, no listener)
export function koiPond(on) {
  if (typeof document === 'undefined') return;
  if (!on) {
    clearInterval(timer); timer = 0;
    canvas?.remove(); canvas = null; ctx = null; state = null;
    if (onVis) document.removeEventListener('visibilitychange', onVis);
    if (onSize) window.removeEventListener('resize', onSize);
    onVis = onSize = null;
    return;
  }
  if (canvas) return;
  const start = () => {
    if (canvas || document.documentElement.dataset.skin !== 'koi-pond') return;
    canvas = document.createElement('canvas');
    canvas.className = 'koi-pond';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    size();
    onVis = () => run();
    let pending = 0;
    onSize = () => { clearTimeout(pending); pending = setTimeout(() => { if (canvas) size(); }, 200); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', onSize);
    run();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}

export const _test = { makeState, step, charAt };
