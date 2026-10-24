// The glass dropdown's pure parts (public/core/dropdown-logic.js, 24 Oct 2026): keyboard moves, type to jump, and where
// the open list goes. Also checks no native <select> is left in public/. Run: node tests/dropdown.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moveIndex, typeAhead, placeList } from '../public/core/dropdown-logic.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const O = ['Apple', 'Banana', 'Blueberry', 'Cherry', 'Date', 'Elder'].map((label, i) => ({ value: String(i), label }));
const D = O.map((o, i) => ({ ...o, disabled: i === 0 || i === 2 || i === 5 }));   // Apple, Blueberry and Elder off

// ---------- moveIndex ----------
check(moveIndex(O, 0, 'ArrowDown') === 1 && moveIndex(O, 5, 'ArrowDown') === 5, 'ArrowDown moves one and stops at the end');
check(moveIndex(O, 3, 'ArrowUp') === 2 && moveIndex(O, 0, 'ArrowUp') === 0, 'ArrowUp moves one and stops at the start');
check(moveIndex(O, -1, 'ArrowDown') === 0 && moveIndex(O, -1, 'ArrowUp') === 5, 'from nothing: down is the first, up the last');
check(moveIndex(O, 3, 'Home') === 0 && moveIndex(O, 1, 'End') === 5, 'Home and End');
check(moveIndex(D, 1, 'ArrowDown') === 3 && moveIndex(D, 3, 'ArrowUp') === 1, 'disabled options are passed over');
check(moveIndex(D, 4, 'ArrowDown') === 4 && moveIndex(D, 1, 'ArrowUp') === 1, 'a disabled end keeps the current one');
check(moveIndex(D, 3, 'Home') === 1 && moveIndex(D, 1, 'End') === 4, 'Home and End skip disabled ends');
check(moveIndex(O, 2, 'x') === 2 && moveIndex([], 0, 'ArrowDown') === -1, 'other keys and an empty list change nothing');
const long = Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `Item ${i}` }));
check(moveIndex(long, 0, 'PageDown') === 8 && moveIndex(long, 25, 'PageDown') === 29 && moveIndex(long, 20, 'PageUp') === 12 && moveIndex(long, 3, 'PageUp') === 0, 'Page Down / Up move a page and stop at the ends');

// ---------- typeAhead ----------
check(typeAhead(O, 'c', 0) === 3 && typeAhead(O, 'C', 0) === 3, 'a letter jumps to the first label that starts with it, any case');
check(typeAhead(O, 'b', 0) === 1 && typeAhead(O, 'b', 1) === 2 && typeAhead(O, 'bb', 1) === 2 && typeAhead(O, 'b', 2) === 1, 'the same letter again steps through, wrapping');
check(typeAhead(O, 'bl', 1) === 2 && typeAhead(O, 'ba', 1) === 1, 'a longer word keeps a still-matching option');
check(typeAhead(O, 'z', 2) === -1 && typeAhead(O, '', 2) === -1, 'no match is -1');
check(typeAhead(D, 'b', 0) === 1 && typeAhead(D, 'b', 1) === 1 && typeAhead(D, 'e', 0) === -1, 'disabled options are never jumped to');

// ---------- placeList ----------
const view = { w: 1200, h: 800 };
const a = (top, left = 100, width = 160, height = 34) => ({ top, bottom: top + height, left, width });
let p = placeList(a(100), 200, 180, view);
check(!p.above && p.top === 140 && p.left === 100 && p.width === 180 && p.maxHeight === 320, `room below: under the control (${JSON.stringify(p)})`);
p = placeList(a(700), 200, 180, view);
check(p.above && p.top === 694 - 200 && p.maxHeight === 320, `near the bottom: above it (${JSON.stringify(p)})`);
p = placeList(a(700), 50, 180, view);
check(!p.above, 'a short list that fits below stays below');
p = placeList(a(300), 2000, 180, view);
check(!p.above && p.maxHeight === 320, 'a long list is capped and scrolls inside');
p = placeList(a(100), 200, 100, view);
check(p.width === 160, 'never narrower than the control');
p = placeList(a(100, 1100), 200, 300, view);
check(p.left + p.width <= 1192 && p.left >= 8, `never past the right edge (${JSON.stringify(p)})`);
p = placeList(a(100, 10, 360), 200, 600, { w: 375, h: 700 });
check(p.width === 359 && p.left === 8, `phone width: fits the window (${JSON.stringify(p)})`);
p = placeList(a(40, 10, 160), 300, 160, { w: 375, h: 120 });
check(p.maxHeight >= 80 && p.top >= 8, 'a tiny window still gives a usable list');

// ---------- no native select is left ----------
const left = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p2 = path.join(d, f.name); if (f.isDirectory()) walk(p2); else if (/\.(js|html)$/.test(f.name) && f.name !== 'dropdown.js' &&/h\('select'|<select\b|createElement\('select'\)/.test(fs.readFileSync(p2, 'utf8'))) left.push(path.relative(ROOT, p2)); } };
walk(path.join(ROOT, 'public'));
check(!left.length, `every dropdown is the glass one (native select in: ${left.join(', ')})`);

if (fails.length) { console.error('dropdown: FAILED\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('dropdown: all good');
