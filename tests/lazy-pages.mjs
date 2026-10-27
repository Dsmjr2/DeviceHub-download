// Each page's code loads the first time the page is opened (27 Oct 2026; public/app.js PAGES): the window opens faster
// and holds less. Offline: reads the sources. Nothing the window loads at start imports a page; the sidebar's list
// (id, title, icon, device, rail) matches each page's own; the Setup check, Learn's busy flag, Search's Profile and
// Lighting commands and the Overview's Learn it and Review reach their pages only when used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const src = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// the files a module pulls in by static import (import ... from, export ... from), not import()
function staticGraph(entry) {
  const seen = new Set();
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of src(f).matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
  };
  walk(entry);
  return [...seen];
}

// 1. at start: no page in the window's own imports
const start = staticGraph('app.js');
const startPages = start.filter((f) => f.startsWith('pages/'));
check(!startPages.length, `app.js loads no page at start (it imports ${startPages.join(', ')})`);
check(!/^\s*import[^(\n]*from '\.\.?\/pages\//m.test(src('core/commands.js')), 'Search (core/commands.js) imports no page');
for (const [page, not] of [['pages/overview.js', ['pages/learn.js', 'pages/backups.js', 'pages/headset.js', 'pages/setup.js']], ['pages/setup.js', ['pages/learn.js', 'pages/keyboard.js', 'pages/headset.js']]]) {
  const g = staticGraph(page);
  for (const n of not) check(!g.includes(n), `${page} does not load ${n} (it is loaded when used)`);
}

// 2. the sidebar's list matches each page
const app = src('app.js');
const entries = [...app.matchAll(/^\s*page\('([\w-]+)', '([^']*)', '([\w-]+)', \(\) => import\('\.\/(pages\/[\w-]+\.js)'\)(?:, (\{[^}]*\}))?\),?$/gm)];
check(entries.length === 14, `14 pages in app.js PAGES (found ${entries.length})`);
for (const [, id, title, ic, file, more = ''] of entries) {
  const head = (/export default \{([\s\S]*?)\n\s*(?:render|keepAlive|get watches|\/\/)/.exec(src(file)) || [])[1] || '';
  check(new RegExp(`\\bid: '${id}', title: '${title}', icon: '${ic}'`).test(head), `${id}: id, title and icon as in ${file}`);
  const dev = (/\bdevice: '([\w-]+)'/.exec(head) || [])[1] || null;
  check(dev === ((/device: '([\w-]+)'/.exec(more) || [])[1] || null), `${id}: device as in ${file} (${dev})`);
  check(/\brail: false/.test(head) === /rail: false/.test(more), `${id}: rail as in ${file}`);
}
check(entries.map((e) => e[1]).join(' ') === 'overview setup mouse headset keyboard fans lighting monitors wallpapers profiles backups settings learn supported', 'the pages keep their order (Alt+1 to Alt+8, Search)');
// a device added on this PC: its sidebar title and icon by the same rule as pages/my-device.js
const iconsOf = (s) => (/const (?:KIND_)?ICON = (\{[^}]*\})/.exec(s) || [])[1];
check(iconsOf(app) && iconsOf(app) === iconsOf(src('pages/my-device.js')), 'an added device gets the icon its page gives it');
check(/import\('\.\/pages\/my-device\.js'\)\.then\(\(m\) => \(\{ default: m\.devicePage\(id\) \}\)\)/.test(app), 'an added device\'s page is made when it is first opened');

// 3. first open: the page on screen stays until the code arrives, a newer render wins, a failed load can be tried again
check(/if \(!page\.code\) \{[\s\S]{0,300}?const mySeq = \+\+seq;[\s\S]{0,200}?if \(seq !== mySeq\) return;/.test(app), 'a page still loading never replaces a newer one');
check(/p\.loading = null; throw e;/.test(app), 'a page that failed to load loads again the next time');
check(/const code = current\?\.code;/.test(app) && /code\.keepAlive\?\.\(id\)/.test(app), 'readings reach only a page that has loaded');

// 4. what the window needs from pages before they open
check(/setTimeout\(\(\) => loadPage\(PAGES\.find\(\(p\) => p\.id === 'setup'\)\)[^\n]*46000 - performance\.now\(\)/.test(app) && /if \(m\.setupNeeds\) useSetup\(m\)/.test(app), 'the Setup check loads 46 s in (it reads nothing in the first 45), or when Setup opens');
check(/const pageOpenedAt = performance\.timeOrigin;/.test(src('pages/setup.js')), 'the Setup check counts its 45 s from the window opening, not from its own load');
check(/const learnBusy = \(\) => !!env\.learnBusy\?\.\(\);/.test(app) && /^env\.learnBusy = learnBusy;/m.test(src('pages/learn.js')), 'the idle close still knows when a device is being learned');
check(/run: async \(\) => \{ await learnThis\(/.test(app), 'Learn it for me (a new device) loads Learn before opening it');

if (fails.length) { console.log(`lazy-pages: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log(`lazy-pages: the window starts with ${start.length} files and no page; ${entries.length} pages load when first opened`);
