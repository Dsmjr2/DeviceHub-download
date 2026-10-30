// The Laptop page (public/pages/laptop.js, helpers/laptop.ps1, GET /api/laptop, POST /api/laptop/mode): shown only on a
// PC with a battery; reads battery health, Windows' power mode and a Legion's own power mode; changes only Windows'
// power mode, on a click, and reads it back; never sets Lenovo's. Run: node tests/laptop.mjs (no laptop needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthLine, MODES } from '../public/pages/laptop.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const src = (f) => fs.readFileSync(path.join(REAL, f), 'utf8');

ok(/holds 91% .* 87 charge cycles\. Like new\./.test(healthLine({ health: 91, cycles: 87 })), healthLine({ health: 91, cycles: 87 }));
ok(/Normal wear/.test(healthLine({ health: 84 })) && /runs out sooner/.test(healthLine({ health: 70 })) && /new battery/.test(healthLine({ health: 50 })), 'health in plain words');
ok(/does not report/.test(healthLine({ health: null })) && /does not report/.test(healthLine(null)), 'no health reported: says so');
ok(MODES.map((m) => m.value).join() === 'efficiency,balanced,performance', "Windows' three power modes");

const ps = src('helpers/laptop.ps1');
ok(/ValidateSet\('', 'efficiency', 'balanced', 'performance'\)/.test(ps), 'the script takes only the three modes');
ok(/PowerSetActiveOverlayScheme/.test(ps) && (ps.match(/PowerSetActiveOverlayScheme\(/g) || []).length === 2 && /if \(\$Mode\)/.test(ps), "it sets Windows' power mode only when a mode is given (one declaration, one call)");
ok(/GetSmartFanMode/.test(ps) && !/SetSmartFanMode|Set-CimInstance|New-CimInstance|Remove-CimInstance/.test(ps) && (ps.match(/Invoke-CimMethod/g) || []).length === 1, "Lenovo's power mode is only read");
ok(!/Set-ItemProperty|New-ItemProperty|reg add|bcdedit|powercfg \/(setactive|change|import|delete)/i.test(ps), 'no registry or power plan writes');
ok(/Default string/.test(ps), "a board maker's placeholder is not shown as the model");

const server = src('server.js');
ok(/\['efficiency', 'balanced', 'performance'\]\.includes\(mode\)/.test(server) && /laptop\.ps1/.test(server) && /if \(laptopBusy\)/.test(server) && /windowsHide: true, timeout: 30000/.test(server), 'the route checks the mode, runs hidden, one at a time');
ok(/Windows power mode → \$\{mode\}/.test(server), 'a change is logged with what Windows reads back');

const app = src('public/app.js');
ok(/page\('laptop', 'Laptop', 'bolt', \(\) => import\('\.\/pages\/laptop\.js'\), \{ laptopOnly: true \}\)/.test(app) && /p\?\.hasBattery && !isLaptop/.test(app) && /onEvent\('hello', \(p\) => \{ paintSaving\(p\); seeBattery\(p\); \}\)/.test(app) && /hasBattery: !!power\.hasBattery/.test(server) && /const shown = \(p\) => !p\.laptopOnly \|\| isLaptop;/.test(app), 'in the sidebar only on a PC with a battery');
ok(/pages: PAGES\.filter\(shown\)/.test(app), 'and in Search only then');
const page = src('public/pages/laptop.js').replace(/\/\/.*$/gm, '').replace("id: 'laptop', title: 'Laptop'", '');   // the page's own name is not a tooltip
ok(!/toast\(|modal\(|\btitle:|alert\(|confirm\(/.test(page), 'no pop-ups or tooltips');
ok(/onCommit: setMode/.test(page) && (page.match(/\/api\/laptop\/mode/g) || []).length === 1, 'the mode changes only from its own switch');

if (fails.length) { console.log(`laptop: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('laptop (battery health, Windows power mode on a click, Lenovo read only, shown on laptops only): all good');
