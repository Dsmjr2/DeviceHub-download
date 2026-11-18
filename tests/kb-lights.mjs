// Offline test (15 Nov 2026 bug hunt): Lighting's Apply to all on a keyboard whose lights were switched off (effect
// None, the Overview tile's and the Keyboard page's Lights switch). It wrote only hue, saturation and brightness, said
// "Lighting set on EPOMAKER P75", and the keyboard stayed dark. public/core/kb-lights.js; the pages' source.
import fs from 'node:fs';
import { kbColorKeys } from '../public/core/kb-lights.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const J = (x) => JSON.stringify(x);
const adapter = { lightingKeys: (r, g, b, br) => [['hue', 0], ['saturation', 255], ['brightness', Math.round((br / 100) * 255)]] };

check(J(kbColorKeys({ adapter, values: { effect: 0 }, rgb: [255, 0, 0], brightness: 100, last: 7 })) === J([['effect', 7], ['hue', 0], ['saturation', 255], ['brightness', 255]]), 'lights off: the last effect is turned back on first');
check(kbColorKeys({ adapter, values: { effect: 0 }, rgb: [255, 0, 0], brightness: 100 })[0][1] === 1, 'no last effect known: solid color (1)');
check(J(kbColorKeys({ adapter, values: { effect: 5 }, rgb: [255, 0, 0], brightness: 50, last: 7 })) === J([['hue', 0], ['saturation', 255], ['brightness', 128]]), 'lights on: the effect is kept');
check(J(kbColorKeys({ adapter, values: { effect: 5 }, off: true })) === J([['brightness', 0]]), 'Off: brightness 0 only');

const lighting = fs.readFileSync(new URL('../public/pages/lighting.js', import.meta.url), 'utf8');
const overview = fs.readFileSync(new URL('../public/pages/overview.js', import.meta.url), 'utf8');
check(/kbColorKeys\(/.test(lighting), 'Apply to all uses it');
check(/localStorage\.setItem\('kb-last-effect'/.test(overview), 'the Overview tile remembers the last effect too (its Lights switch brings it back)');

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`kb-lights (Apply to all turns a switched-off keyboard back on): all ${n} passed`);
process.exit(0);
