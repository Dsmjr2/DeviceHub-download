// Game settings in the setup file (public/core/setup-games.js): the file's games merge over this PC's.
import { mergeGames } from '../public/core/setup-games.js';

let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log(`FAIL ${what}`); } };

const val = { id: 'gval', name: 'VALORANT', exes: ['valorant-win64-shipping.exe'], setup: { dpi: 800, polling: 1000 } };
const cs = { id: 'gcs', name: 'Counter-Strike 2', exes: ['cs2.exe'], setup: { dpi: 400 } };

// nothing on this PC: every game is added
let r = mergeGames([], [val, cs]);
check(r.list.length === 2 && r.lines.length === 2 && r.lines.every((l) => l.added), 'empty PC gets every game');

// the same file again: nothing to change
r = mergeGames(r.list, [val, cs]);
check(r.lines.length === 0, 'same games: nothing listed');

// same name, other switches: the file's switches, this PC's id, program names joined
const mine = [{ id: 'local1', name: 'valorant', exes: ['valorant.exe'], setup: { dpi: 1600, lights: '#ff0000' } }];
r = mergeGames(mine, [val]);
const g = r.list[0];
check(r.list.length === 1 && g.id === 'local1', 'matched by name, keeps this PC id');
check(g.setup.dpi === 800 && g.setup.polling === 1000 && !('lights' in g.setup), 'file switches win');
check(g.exes.includes('valorant.exe') && g.exes.includes('valorant-win64-shipping.exe'), 'program names joined');
check(r.lines.length === 1 && !r.lines[0].added, 'listed as changed');
check(mine[0].setup.dpi === 1600, 'input list not changed');

// a game only this PC has stays
r = mergeGames([cs], [val]);
check(r.list.some((x) => x.name === 'Counter-Strike 2'), 'PC-only game kept');

// HDR: kept for a screen this PC has (by id, else name), else this PC's own, else left out
const hdrGame = { ...val, setup: { hdr: { id: 'MON-A', screen: '\\\\.\\DISPLAY2', name: 'AGON', on: true } } };
const screens = [{ id: 'MON-A', screen: '\\\\.\\DISPLAY1', name: 'AGON' }];
r = mergeGames([], [hdrGame], screens);
check(r.list[0].setup.hdr?.screen === '\\\\.\\DISPLAY1' && r.list[0].setup.hdr.on === true, 'HDR moved to the same monitor here');
r = mergeGames([], [hdrGame], [{ id: 'X', screen: '\\\\.\\DISPLAY1', name: 'AGON' }]);
check(r.list[0].setup.hdr?.id === 'X', 'HDR matched by monitor name');
r = mergeGames([], [hdrGame], [{ id: 'Y', screen: '\\\\.\\DISPLAY1', name: 'Laptop screen' }]);
check(!('hdr' in r.list[0].setup), 'HDR left out when this PC lacks that monitor');
const ownHdr = { id: 'v', name: 'VALORANT', exes: ['valorant-win64-shipping.exe'], setup: { hdr: { id: 'Y', screen: '\\\\.\\DISPLAY1', name: 'Laptop screen', on: false } } };
r = mergeGames([ownHdr], [hdrGame], [{ id: 'Y', screen: '\\\\.\\DISPLAY1', name: 'Laptop screen' }]);
check(r.list[0].setup.hdr?.id === 'Y' && r.list[0].setup.hdr.on === false, "this PC's own HDR choice stays");

// junk entries are skipped
r = mergeGames([], [null, { name: '' }, { name: 'x' }]);
check(r.list.length === 0, 'entries without a name or program list skipped');

console.log(bad ? `setup-games: ${bad} failed` : 'setup-games: all checks passed');
process.exit(bad ? 1 : 0);
