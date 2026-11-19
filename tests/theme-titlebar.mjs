// The title bar follows the backdrop, and a theme click is quick (18 Nov 2026, Shawn: "these dont seem to match, also
// its slow to change theme and color"). Offline: reads public/core/theme.js and public/pages/settings.js.
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const { THEME_BGS, TITLEBAR } = await import('../public/core/theme.js');
for (const [key] of THEME_BGS) check(/^#[0-9a-f]{6}$/.test(TITLEBAR[key] || ''), `backdrop ${key} has a title bar colour (${TITLEBAR[key]})`);
for (const key of Object.keys(TITLEBAR)) check(THEME_BGS.some(([k]) => k === key), `title bar colour ${key} belongs to a backdrop`);
check(TITLEBAR.espresso === '#211710', 'Espresso\'s title bar is its warm top, not its near-black base');
const theme = read('public/core/theme.js');
check(theme.includes("setAttribute('content', TITLEBAR[theme.bg] || bg[2])"), 'applyTheme sets the page\'s theme colour from the table');
const set = read('public/pages/settings.js');
check(!/toast\(`(Theme|Accent|Drawings): /.test(set), 'no success note when a theme, accent or look is picked');
check(set.includes("onclick: () => { saveTheme({ themeBg: key }).catch((e) => toast('Not saved', 'bad', { detail: e.message })); markPicked('.theme-tile[data-bg]', 'bg', key); } },"), 'a backdrop click marks its tile without waiting for the save or redrawing the page');
check(set.includes("onclick: () => { saveArtStyle(key).catch((e) => toast('Not saved', 'bad', { detail: e.message })); markPicked('.art-style[data-look]', 'look', key); } },"), 'a look click the same');
if (problems.length) { console.log(`theme-titlebar: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('theme-titlebar (each backdrop\'s title bar colour, quick theme clicks, no success note): all good');
