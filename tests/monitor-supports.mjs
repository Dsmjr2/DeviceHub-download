// What a monitor supports (22 Oct 2026; helpers/monitors.js supportsList): each code in its capabilities, named and
// grouped, read-only. Run: node tests/monitor-supports.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _test: { supportsList } } = require('../helpers/monitors.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const l = supportsList('(prot(monitor)model(TEST)vcp(04 10 12 14(01 05 0B) 60(0F 11) 62 72(50 64 78) 87 AC D6(01 04) E2 E9 F0F0)mccs_ver(2.2))');
const by = Object.fromEntries(l.map((x) => [x.code, x]));
check(by['10']?.state === 'controlled' && by['10'].name === 'Brightness', 'brightness is controlled here');
check(by['72']?.state === 'not yet' && by['72'].name === 'Gamma' && by['72'].values.join() === '50,64,78', 'gamma: could be added, with the values the monitor lists');
check(by['04']?.state === 'left out' && by['60']?.state === 'left out' && by['D6']?.state === 'left out', 'resets, input switching and power are left out on purpose');
check(by['AC']?.state === 'info', 'a frequency is information only');
check(by['E2']?.state === 'maker' && by['E9']?.state === 'maker', "E0-FF are the maker's own");
check(!l.some((x) => x.code.length > 2), 'longer codes (the maker\'s own, F0F0) are not listed');
check(l.map((x) => parseInt(x.code, 16)).every((c, i, a) => !i || a[i - 1] < c), 'sorted by code');
check(supportsList('').length === 0 && supportsList('no vcp here').length === 0, 'no capabilities: an empty list');
if (fails.length) { console.log(`monitor-supports: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('monitor-supports (what a monitor supports): all good');
