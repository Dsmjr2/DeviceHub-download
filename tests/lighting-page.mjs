// The Lighting page's rework (26 Oct 2026; public/core/light-groups.js, public/core/color.js, public/ui/color-picker.js,
// public/pages/pc-lights.js, public/pages/lighting.js). On the friend's PC from support request 15 (a Gigabyte B450 whose
// case fans sit on its ARGB header, four Corsair sticks, an MSI RTX 3060):
//   - the lights are grouped by what they are: Fans, RAM, Graphics card, Board; "???" zones hidden unless named;
//   - each row sends only its own zone or stick; each section's All covers its own lights only (Board's never the fans);
//   - while the picker is dragged, at most ~10 writes a second, the last value always sent, nothing once idle;
//   - a color change updates the page in place (no redraw of the page or the card), and there is no typed code box.
// Pure functions and the page source; nothing is opened or sent. Run: node tests/lighting-page.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(path.join(ROOT, 'public/core/light-groups.js')).href);
const C = await import(pathToFileURL(path.join(ROOT, 'public/core/color.js')).href);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const J = (x) => JSON.stringify(x);

// the friend's lights, as helpers/openrgb.js shapes them (ZONE_NAMES names slots 0 and 2; fanHeader renames ARGB Header N)
const ZONES = ['Top logo', '???', 'Bottom logo', 'Case Rear', 'Case', '???', '???', 'Fan header (ARGB) 1', 'ARGB Header 2', '???'];
const friend = () => [
  ...[0, 1, 2, 3].map((i) => ({ index: i, name: 'Corsair Vengeance RGB Pro DDR4', type: 'ram', zones: [{ name: 'DRAM', leds: 10, color: '#ff0000' }], leds: 10, color: '#ff0000', same: true })),
  { index: 4, name: 'B450 AORUS PRO WIFI-CF', type: 'motherboard', zones: ZONES.map((name) => ({ name, leds: 1, color: '#0000ff' })), leds: 10, color: '#0000ff', same: true },
  { index: 5, name: 'MSI GeForce RTX 3060 Gaming X LHR', type: 'gpu', zones: [{ name: 'GPU', leds: 1, color: '#ffffff' }], leds: 1, color: '#ffffff', same: true },
];

// 1. grouping
{
  const secs = G.groupLights(friend());
  check(J(secs.map((s) => s.title)) === J(['Fans', 'RAM', 'Graphics card', 'Board']), `sections in order: ${J(secs.map((s) => s.title))}`);
  const by = (id) => secs.find((s) => s.id === id);
  check(J(by('fans').rows.map((r) => r.label)) === J(['Fan header 1', 'Fan header 2']), `the board's ARGB headers are Fans: ${J(by('fans').rows.map((r) => r.label))}`);
  check(J(by('fans').rows.map((r) => r.writes)) === J([[{ index: 4, zone: 7 }], [{ index: 4, zone: 8 }]]), 'each fan header writes only its own zone');
  check(J(by('ram').rows.map((r) => r.label)) === J(['Stick 1', 'Stick 2', 'Stick 3', 'Stick 4']) && by('ram').rows.every((r, i) => J(r.writes) === J([{ index: i, zone: null }])), 'each RAM stick is a row that writes only its stick');
  check(by('gpu').rows.length === 1 && J(by('gpu').rows[0].writes) === J([{ index: 5, zone: null }]) && /RTX 3060/.test(by('gpu').rows[0].label), 'the graphics card is its own section');
  check(J(by('board').rows.map((r) => r.label)) === J(['Top logo', 'Bottom logo', 'Case Rear', 'Case']), `Board lists the named zones, no "???": ${J(by('board').rows.map((r) => r.label))}`);
  check(!secs.some((s) => s.rows.some((r) => /\?\?\?|Unnamed/.test(r.label))), 'no unnamed zone gets a row');
  check(by('board').hidden === 4, `the unnamed board zones are counted for the note: ${by('board').hidden}`);
  // All rows
  check(J(by('fans').all) === J([{ index: 4, zone: 7 }, { index: 4, zone: 8 }]), `Fans All: the two headers only: ${J(by('fans').all)}`);
  check(J(by('board').all.map((w) => w.zone)) === J([0, 1, 2, 3, 4, 5, 6, 9]) && by('board').all.every((w) => w.index === 4), `Board All: every board zone but the fan headers: ${J(by('board').all)}`);
  check(J(by('ram').all) === J([0, 1, 2, 3].map((index) => ({ index, zone: null }))), 'RAM All: each stick');
  check(by('fans').color === '#0000ff' && by('ram').color === '#ff0000', 'a section shows its color when its rows agree');
}
// a zone Find my lights named: a "fans" name goes to Fans, any other name to Board; hidden ones only with Show all
{
  const c = friend();
  Object.assign(c[4].zones[1], { name: 'Case fans', named: true });
  Object.assign(c[4].zones[5], { name: 'Strip', named: true });
  c[4].zones[3].hidden = true;
  const secs = G.groupLights(c), by = (id) => secs.find((s) => s.id === id);
  check(by('fans').rows.some((r) => r.label === 'Case fans' && J(r.writes) === J([{ index: 4, zone: 1 }])), 'a zone named "Case fans" is a fan row');
  check(by('board').rows.some((r) => r.label === 'Strip') && !by('board').rows.some((r) => r.label === 'Case Rear'), 'other names stay on Board; a hidden zone has no row');
  const all = G.groupLights(c, { showAll: true }).find((s) => s.id === 'board');
  check(all.rows.some((r) => r.label === 'Case Rear') && all.rows.some((r) => /^Unnamed \d+$/.test(r.label)), 'Show all zones lists hidden and unnamed zones');
}
// a USB fan controller and a cooler go to Fans; a board without fan headers is one Board row writing the whole board
{
  const secs = G.groupLights([
    { index: 0, name: 'Corsair Commander Pro', type: 'ledstrip', zones: [{ name: 'Channel 1', leds: 24 }, { name: 'Channel 2', leds: 16 }], leds: 40 },
    { index: 1, name: 'Kraken X63', type: 'cooler', zones: [{ name: 'Ring', leds: 8 }], leds: 8 },
    { index: 2, name: 'MAG B550', type: 'motherboard', zones: [{ name: 'JRGB1', leds: 1 }, { name: 'Logo', leds: 1 }], leds: 2 },
    { index: 3, name: 'Some keyboard', type: 'keyboard', zones: [{ name: 'Keys', leds: 90 }], leds: 90 },
  ]);
  const fans = secs.find((s) => s.id === 'fans'), board = secs.find((s) => s.id === 'board');
  check(J(fans.rows.map((r) => [r.label, r.writes])) === J([['Channel 1', [{ index: 0, zone: 0 }]], ['Channel 2', [{ index: 0, zone: 1 }]], ['Kraken X63', [{ index: 1, zone: null }]]]), `fan controller channels and a cooler: ${J(fans.rows.map((r) => [r.label, r.writes]))}`);
  check(J(fans.all) === J([{ index: 0, zone: null }, { index: 1, zone: null }]), `Fans All collapses a controller it covers whole: ${J(fans.all)}`);
  check(J(board.all) === J([{ index: 2, zone: null }]), 'a board with no fan header: All is one write for the whole board');
  check(secs.some((s) => s.id === 'other' && s.rows[0].label === 'Some keyboard'), 'anything else goes to Other lights');
}
// a fan header OpenRGB sized at 0 lights: listed, but nothing to write
{
  const c = friend(); c[4].zones[8].leds = 0;
  const fans = G.groupLights(c).find((s) => s.id === 'fans');
  check(fans.rows[1].leds === 0 && fans.rows[1].detail === 'No lights on it' && J(fans.all) === J([{ index: 4, zone: 7 }]), 'an empty fan header is shown, and left out of All');
}
// the local copy after a write: a zone write changes that zone only
{
  const c = friend(); G.applyLocal(c, [{ index: 4, zone: 7 }], '#00ff00');
  check(c[4].zones[7].color === '#00ff00' && c[4].zones[8].color === '#0000ff' && c[4].same === false && c[0].color === '#ff0000', 'applyLocal: only the written zone');
  G.applyLocal(c, [{ index: 0, zone: null }], '#123456');
  check(c[0].color === '#123456' && c[0].zones[0].color === '#123456' && c[1].color === '#ff0000', 'applyLocal: only the written stick');
}

// 2. the live writer: 10 a second while dragging, the final value always, nothing when idle
{
  let t = 0; const timers = []; const sent = [];
  const later = (f, ms) => timers.push({ at: t + ms, f });
  const run = async (until) => { for (;;) { timers.sort((a, b) => a.at - b.at); const n = timers[0]; if (!n || n.at > until) break; timers.shift(); t = n.at; n.f(); await new Promise((r) => setImmediate(r)); } t = until; };
  const w = G.liveWriter(async (v) => { sent.push([t, v]); }, { every: 100, now: () => t, later });
  for (let i = 1; i <= 120; i++) { w.push(`#0000${String(i).padStart(2, '0').slice(-2)}`); await new Promise((r) => setImmediate(r)); await run(t + 8); }   // ~1 s of pointer moves at 120 Hz
  w.flush('#ffffff'); await new Promise((r) => setImmediate(r)); await run(t + 500);
  const inSecond = sent.filter(([at]) => at < 1000).length;
  check(inSecond <= 11 && inSecond >= 8, `about 10 writes in the first second: ${inSecond}`);
  check(sent.at(-1)[1] === '#ffffff', `the value on release is the last one sent: ${J(sent.at(-1))}`);
  const n = sent.length; await run(t + 5000);
  check(sent.length === n && w.idle(), 'no writes once idle');
  const gaps = sent.slice(1).map(([a], i) => a - sent[i][0]);
  check(gaps.every((g) => g >= 100), `writes at least 100 ms apart: ${J(gaps)}`);
}

// 3. colors
check(C.hsvToHex(0, 1, 1) === '#ff0000' && C.hsvToHex(120, 1, 1) === '#00ff00' && C.hsvToHex(0, 0, 0) === '#000000', 'hsv to hex');
{ const v = C.hexToHsv('#ff6a1a'); check(C.hsvToHex(v.h, v.s, v.v) === '#ff6a1a', 'hex round trip'); }

// 4. the page source: color changes update in place, no redraw
const src = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const body = (text, start, end) => { const a = text.indexOf(start); return a < 0 ? '' : text.slice(a, end ? text.indexOf(end, a + start.length) : undefined); };
const pc = src('pages/pc-lights.js'), lighting = src('pages/lighting.js'), picker = src('ui/color-picker.js');
for (const [name, fn] of [['sendWrites', body(pc, 'async function sendWrites', '\n}\n')], ['pcPick', body(pc, 'export function pcPick', '\n}\n')], ['useRow', body(pc, 'const useRow', '\n')], ['presetRow', body(pc, 'const presetRow', '\n')], ['offRow', body(pc, 'const offRow', '\n')], ['setLive', body(pc, 'function setLive', '\n}\n')], ['applyPc', body(pc, 'export async function applyPc', '\n}\n')]]) {
  check(fn.length > 20 && !/\bredraw\(|refreshPc\(|loadPc\(true\)|render\(/.test(fn.replace(/else loadPc\(true\)/, '')), `${name} changes colors in place (no redraw): ${fn.slice(0, 80)}`);
}
check(/function paintRows\(\)[\s\S]{0,400}keys !== shownKeys\) \{ refreshPc\(\); return; \}/.test(pc), 'paintRows rebuilds the card only when the listed rows changed');
const pickerCalls = body(lighting, 'const picker = colorPicker({', '});');
check(pickerCalls.length > 50 && !/redraw|render\(|replaceWith/.test(pickerCalls), 'the picker callbacks never redraw the page');
check(/keepAlive\(\) \{ if \(!targetsEl\?\.isConnected\) return false; refreshTargets\(\); return true; \}/.test(lighting), 'a device reading redraws only the Apply to card');
check(!/redraw\(\)/.test(lighting.replace(/\/\/.*$/gm, '')), 'the Lighting page has no whole-page redraw left');
check(/scrollTop = scroll/.test(pc), 'the PC lights card keeps its scroll when it rebuilds');
check(!/type: 'color'|cp-hex|parseHex/.test(picker), 'no typed color box in the picker (Shawn, 26 Oct 2026)');
check(/setPointerCapture/.test(picker) && /ArrowUp/.test(picker) && /ArrowLeft/.test(picker), 'the picker captures the pointer and takes arrow keys');
check(/liveWriter\([\s\S]{0,120}\{ every: 100 \}\)/.test(pc), 'live writes at most every 100 ms');
check(/Apply to'\), h\('span', \{ class: 'spacer' \}\), applyBtn/.test(lighting), 'Apply to all sits beside the Apply to title');
check(/findLights\(o, redraw\)/.test(pc) && /button\('Undo'/.test(pc), 'Find my lights and Undo are kept');
// each row (26 Oct 2026, Shawn: with every light off, each row was two slashed circles and a white dot): its own preset
// dots, the picked-color dot and a text Off; a light that is off reads "Off"
const rowSrc = body(pc, 'function lightRow(', '\n}\n');
check(/import \{ SWATCHES \} from '\.\/headset\.js'/.test(pc) && /SWATCHES\.map\(\(c\) => h\('button', \{ class: 'swatch pcl-preset'[\s\S]{0,240}onclick: \(\) => presetRow\(key, writes, c\)/.test(rowSrc), 'each row has the Color card presets, each writing that row only');
check(/const presetRow = async \(key, writes, hex\) => \{[^\n]*sendWrites\(writes, hex\)/.test(pc), "a preset sends its color to the row's own writes");
check(/const now = h\('span', \{ class: 'swatch pcl-current'/.test(rowSrc) && !/pcl-live|useRow\(/.test(rowSrc) && /pcl-paint'[^\n]*presetRow\(key, writes, pickNow\(\)\)/.test(rowSrc), 'the row ends with its current color as a plain dot, and a + sends the custom color once (27 Oct 2026)');
check(/class: 'btn ghost small pcl-off'[^\n]*onclick: \(\) => offRow\(key, writes\) \}, 'Off'\)/.test(rowSrc) && !/offSwatch/.test(pc), 'Off is a small text button, no slashed circle');
check(/h\('span', \{ class: 'pcl-now-off faint' \}, 'Off'\)/.test(rowSrc) && /dot\.hidden = off; offText\.hidden = !off;/.test(rowSrc), 'a light that is off shows the word Off in faint text instead of its dot');
check(/p\.dataset\.hex === cur; p\.classList\.toggle\('on', on\)/.test(rowSrc), "the preset that equals the row's color is ringed");

if (fails.length) { console.log(`lighting-page: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('lighting-page: all checks passed');
