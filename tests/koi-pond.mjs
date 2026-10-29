// Koi Pond (28 Oct 2026): the look is in the backdrop list, its colors are in style.css, the koi keep swimming inside
// the pond (wrapping round the edges, never NaN), and the drawing stops when the window is hidden. Run: node tests/koi-pond.mjs
import fs from 'node:fs';
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const T = await import('../public/core/theme.js');
const K = await import('../public/core/koi-pond.js');

const bg = T.THEME_BGS.find(([k]) => k === 'koi-pond');
check(bg && bg[1] === 'Koi Pond' && bg[4] === 'koi-pond', 'Koi Pond is a backdrop');
check(T.SKIN_SILVER['koi-pond'] && T.SKIN_SILVER_NAME['koi-pond'], 'its accent has a name');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
check(/html\[data-skin="koi-pond"\] \{/.test(css) && /canvas\.koi-pond \{[^}]*pointer-events: none/.test(css) && /\.theme-tile\[data-bg="koi-pond"\]/.test(css), 'its colors, canvas and tile are styled');

const st = K._test.makeState(1600, 900);
check(st.koi.length >= 2 && st.pads.length >= 4, 'fish and pads');
for (let i = 0; i < 5000; i++) K._test.step(st);
check(st.koi.every((k) => Number.isFinite(k.x) && Number.isFinite(k.y) && k.x > -30 && k.x < st.cols + 30 && k.y > -30 && k.y < st.rows + 30), 'the koi stay in the pond');
st.slow = true; const k0 = { ...st.koi[0] }; K._test.step(st);
check(Math.hypot(st.koi[0].x - k0.x, st.koi[0].y - k0.y) > 0, 'with animation effects off they still swim (slower)');
check(K._test.charAt(3, 4) === K._test.charAt(3, 4), 'a cell keeps its character');

const src = fs.readFileSync(new URL('../public/core/koi-pond.js', import.meta.url), 'utf8');
check(/document\.hidden\) return;/.test(src) && /removeEventListener\('visibilitychange'/.test(src) && /canvas\?\.remove\(\)/.test(src), 'stops when hidden, and leaves nothing behind when the look changes');
check(/koiPond\(bg\[4\] === 'koi-pond'\)/.test(fs.readFileSync(new URL('../public/core/theme.js', import.meta.url), 'utf8')), 'the theme starts and stops it');

if (fails.length) { console.log(`koi-pond: ${fails.length} FAILED\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('koi-pond: all good');
