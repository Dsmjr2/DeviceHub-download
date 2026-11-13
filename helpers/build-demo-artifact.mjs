// DeviceHub Demo, the claude.ai artifact (11 Nov 2026, Manager for Shawn: "a fully functional DeviceHub artifact that
// mimics the app"). Builds dist/demo-artifact/: the real window (public/) in demo mode, with the local server replaced by
// an in-page stand-in (helpers/demo-artifact/demo-api.js) that answers every /api/ call from pretend data and keeps
// changes in the viewer's own browser. Nothing in it can reach a device, Windows or this PC: no WebHID (demo devices
// only), no service worker, no live stream, and every fetch to /api/ is answered in the page.
//
//   node helpers/build-demo-artifact.mjs [outDir]     then publish outDir/index.html with outDir/files.json as `files`
//
// Personal files never go in: only public/ (the shipped window), the starter wallpapers and the stand-in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'demo-artifact'));

// what demo mode never loads: the service worker, the install manifest and the big app icons
const SKIP = new Set(['sw.js', 'manifest.webmanifest', 'package.json', 'icon-16.png', 'icon-48.png', 'icon-128.png', 'icon-192.png', 'icon-256.png', 'icon-512.png']);

fs.rmSync(OUT, { recursive: true, force: true });
const files = [];
function copy(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    // the makers' product photos stay on Shawn's PC (core/theme.js: Realistic then shows as Blueprint)
    if (e.isDirectory()) { if (!rel && e.name === 'img') continue; copy(path.join(dir, e.name), r); continue; }
    if (!rel && SKIP.has(e.name)) continue;
    let buf = fs.readFileSync(path.join(dir, e.name));
    // the artifact serves the files beside the page, not at the site's root: '/img/x.png' becomes 'img/x.png'
    if (/\.(js|css|html)$/.test(e.name)) buf = Buffer.from(patch(r, relative(buf.toString('utf8'))));
    write(r, buf);
  }
}
const relative = (s) => s.replace(/`\/api\/wallpapers\/starter\?name=\$\{/g, '`demo-walls/${').replace(/(['"`(])\/(img|icon|pages|fonts|ui|core|devices|style\.css)(?=[\/\-.])/g, '$1$2');
// what demo mode leaves out on a real PC but the stand-in can show (pretend monitors): each patch must still match
const PATCHES = {
  // one pretend PC throughout: the Lighting page's graphics card is the PC page's RTX 4070
  'pages/pc-lights.js': [["gpus: [{ name: 'NVIDIA GeForce RTX 3060', maker: 'MSI' }]", "gpus: [{ name: 'NVIDIA GeForce RTX 4070', maker: 'MSI' }]"], ["name: 'MSI GeForce RTX 3060 Gaming X LHR'", "name: 'MSI GeForce RTX 4070 Gaming X Trio'"]],
  // pretend devices answer fast in the demo (a real device's round trip is not the point there)
  'devices/demo.js': [["const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));", "const wait = () => new Promise((r) => setTimeout(r, 30 + Math.random() * 30));"]],
  'pages/monitors.js': [["    if (isDemo()) return h('div', {}, topbar('Monitors', sleepBtn), card([h('h2', {}, 'Monitors')], h('p', { class: 'faint' }, 'Not shown in demo mode.')));\n", '']],
};
function patch(rel, text) {
  text = text.replace(/\r\n/g, '\n');
  for (const [from, to] of PATCHES[rel] || []) { if (!text.includes(from)) throw new Error(`${rel}: a demo patch no longer matches: ${from.trim().slice(0, 80)}`); text = text.replace(from, to); }
  return text;
}
function write(rel, buf) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  if (rel !== 'index.html') files.push(rel);
}
copy(SRC);

// the starter wallpapers (shipped with DeviceHub, made for it), so the Wallpapers page has pictures
const WALL = path.join(ROOT, 'wallpapers-starter');
const walls = fs.existsSync(WALL) ? fs.readdirSync(WALL).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) : [];
for (const f of walls) write(`demo-walls/${f}`, fs.readFileSync(path.join(WALL, f)));

// the Supported devices list, as the server makes it (the shipped library, nothing of this PC)
let supported = { groups: [] };
try { supported = await await (await import('./supported-devices.mjs')).supported({ root: ROOT }); } catch (e) { console.log('supported devices: not built:', e.message); }

// the stand-in, with the build's own data in front of it
const api = fs.readFileSync(path.join(ROOT, 'helpers', 'demo-artifact', 'demo-api.js'), 'utf8');
const wallBytes = Object.fromEntries(walls.map((f) => [f, fs.statSync(path.join(WALL, f)).size]));
const data = { builtAt: new Date().toISOString(), walls, wallBytes, supported, version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '' };
write('demo-api.js', Buffer.from(`window.DEVICEHUB_DEMO_DATA = ${JSON.stringify(data)};\n${api}`));

// the page: its title, the stand-in before app.js, no install manifest and no "server restarting" retry
let index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
index = index
  .replace('<title>DeviceHub</title>', '<title>DeviceHub Demo</title>')
  .replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '')
  .replace(/\s*<link rel="icon" type="image\/png"[^>]*>/g, '')
  .replace(/\s*<script>\s*\/\/ DeviceHub restarting[\s\S]*?<\/script>/, '')
  .replace('<script type="module" src="app.js"></script>', '<script src="demo-api.js"></script>\n  <script type="module" src="app.js"></script>');
if (!index.includes('demo-api.js')) throw new Error('index.html: app.js script tag not found');
fs.writeFileSync(path.join(OUT, 'index.html'), index);
// page.html, the one published: claude.ai wraps it in its own doctype, head and body, so it carries only what goes
// inside them (the title first, the links, then the window), and says the page is dark for scrollbars and controls
const headIn = /<head>([\s\S]*?)<\/head>/.exec(index)[1].replace(/\s*<meta (charset|name="viewport")[^>]*>/g, '').replace(/\s*<title>[^<]*<\/title>/, '');
const bodyIn = /<body>([\s\S]*?)<\/body>/.exec(index)[1];
fs.writeFileSync(path.join(OUT, 'page.html'), `<title>DeviceHub</title>${headIn}
<style>:root { color-scheme: dark; } html { background: #050507; }
/* the viewer pads :root by the phone's safe areas, so the window fills the page's height, not 100vh (which ran past the
   bottom on phones, where nothing could scroll to it); #main is the only thing that scrolls on a wide screen */
@media (min-width: 821px) { .app { height: 100%; } .rail { height: auto; } main { overscroll-behavior: contain; } }
</style>
${bodyIn}`);

const map = Object.fromEntries(files.sort().map((f) => [f, f]));
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(map, null, 1));
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`demo artifact: ${files.length + 1} files, ${(bytes / 1048576).toFixed(2)} MB in ${OUT}`);
