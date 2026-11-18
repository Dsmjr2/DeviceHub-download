// Offline test (17 Nov 2026, Shawn: "make the tabs on the left side easily draggable so I can change the layout"):
// public/core/rail-order.js lays the saved sidebar order over the usual one, and server.js keeps only a clean navOrder.
import fs from 'node:fs';
import { defaultTokens, orderTokens, moveToken, isGroup } from '../public/core/rail-order.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const J = (x) => JSON.stringify(x);

const def = defaultTokens({ top: ['overview', 'setup'], devices: ['mouse', 'headset', 'keyboard'], desk: ['fans', 'lighting', 'monitors'], app: ['profiles', 'settings', 'learn'] });
check(J(def) === J(['overview', 'setup', '#devices', 'mouse', 'headset', 'keyboard', '#desk', 'fans', 'lighting', 'monitors', '#app', 'profiles', 'settings', 'learn']), 'the usual order');
check(J(orderTokens([], def)) === J(def) && J(orderTokens(null, def)) === J(def), 'nothing saved: the usual order');

// a saved order is kept as it is
const mine = ['overview', 'setup', '#devices', 'keyboard', 'mouse', 'headset', '#desk', 'profiles', 'lighting', 'fans', 'monitors', '#app', 'settings', 'learn'];
check(J(orderTokens(mine, def)) === J(mine), 'a saved order is kept, an entry moved into another group stays there');

// a page the saved order does not name (a newly added device): at the end of its usual group
const withNew = defaultTokens({ top: ['overview', 'setup'], devices: ['mouse', 'headset', 'keyboard', 'hyperx'], desk: ['fans', 'lighting', 'monitors'], app: ['profiles', 'settings', 'learn'] });
const o = orderTokens(mine, withNew);
check(o.indexOf('hyperx') === o.indexOf('#desk') - 1, `a new device goes at the end of Devices (${J(o)})`);
// a name no longer there is left out; garbage is ignored; a lost heading comes back in its place
const odd = orderTokens(['learn', 'gone-page', 42, null, '#app', 'mouse', 'mouse', '#devices'], def);
check(!odd.includes('gone-page') && odd.filter((t) => t === 'mouse').length === 1 && odd.length === def.length, `a page no longer there or named twice is left out (${J(odd)})`);
check(odd.indexOf('#desk') > odd.indexOf('#devices') && odd.indexOf('#desk') < odd.indexOf('#app'), 'a lost heading comes back between its neighbours');
check(def.every((t) => odd.includes(t)), 'every entry is in the rail');

// moving
check(J(moveToken(def, 'learn', 0).slice(0, 2)) === J(['learn', 'overview']), 'a page moved to the top');
check(J(moveToken(def, 'lighting', def.indexOf('#devices'))) === J(['overview', 'setup', 'lighting', '#devices', 'mouse', 'headset', 'keyboard', '#desk', 'fans', 'monitors', '#app', 'profiles', 'settings', 'learn']), 'moved above a heading: into the group before it');
check(J(moveToken(def, '#desk', 0)) === J(def), 'a heading is never moved');
check(J(moveToken(def, 'nope', 0)) === J(def), 'an unknown page changes nothing');
check(isGroup('#app') && !isGroup('app'), 'headings are told apart');

// server.js: navOrder is kept only when clean, and an empty list removes it
const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
check(/'navOrder' in b/.test(srv) && /b\.navOrder\.length <= 60/.test(srv) && /\^#\?\[a-z0-9\]\[a-z0-9-\]\{0,39\}\$/.test(srv) && /delete cur\.navOrder/.test(srv), 'settings: navOrder checked (a list of page names and headings), [] removes it');
// the rail: draggable entries, saved after a drop, Alt+Up/Down moves one, and a Reset in Settings
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
check(/draggable: 'true'/.test(app) && /saveOrder\(/.test(app) && /ArrowUp/.test(app), 'the rail: entries draggable, the order saved, Alt+Up/Down');
const settings = fs.readFileSync(new URL('../public/pages/settings.js', import.meta.url), 'utf8');
check(/customOrder\(\)/.test(settings) && /saveOrder\(\[\]/.test(settings), 'Settings > Appearance can put the usual order back');

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`rail-order (sidebar order: saved over the usual one, new pages, moves, checked by the server): all ${n} passed`);
process.exit(0);
