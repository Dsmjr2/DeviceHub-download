// DeviceHub Demo, the artifact (helpers/build-demo-artifact.mjs): builds it, serves the build from a plain file server
// on a free port (no DeviceHub behind it), and in a hidden Chrome or Edge opens every page, presses every choice and
// tab, flips every switch and back, and presses every other button on the page once (closing whatever it opened).
// Fails on any script error, console error, request that left the page for something it does not have, or /api/ route
// the stand-in does not know (window.__demoMisses).
// Run: node tests/demo-artifact.mjs [--keep]   (not part of npm test: about two minutes)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.tmpdir(), `devicehub-demo-artifact-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync(process.execPath, [path.join(ROOT, 'helpers', 'build-demo-artifact.mjs'), OUT], { stdio: 'inherit' });

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.json': 'application/json' };
const served404 = [];
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(OUT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { served404.push(p); res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const pages = [...app.matchAll(/^\s*page\('([\w-]+)', '[^']*', '[\w-]+', \(\) => import/gm)].map((m) => m[1]);

const exe = [process.env.DEVICEHUB_CHROME || '', 'C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && fs.existsSync(p));
if (!exe) { console.log('demo-artifact: no Chrome or Edge'); process.exit(0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-demo-test-'));
const dbg = 9300 + Math.floor(Math.random() * 600);
const c = spawn(exe, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws;
const done = (code) => { try { ws?.close(); } catch {} c.kill(); server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} if (!process.argv.includes('--keep')) try { fs.rmSync(OUT, { recursive: true, force: true }); } catch {} process.exit(code); };
let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const w = new Map(); const errors = []; const outside = [];
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n').slice(0, 2).join(' ').slice(0, 240) || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(`console: ${d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 240)}`);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(`log: ${d.params.entry.text.slice(0, 200)} ${d.params.entry.url || ''}`);
  if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (!u.startsWith(BASE) && !/^(data|blob):/.test(u)) outside.push(u); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

const bad = [];
const note = (where) => { if (errors.length) { bad.push(`${where}: ${[...new Set(errors)].join(' | ')}`); errors.length = 0; } };
// buttons that leave the page or start the whole app over are pressed by the other passes or not at all
const SKIP = /^(Open page|Open demo|Quit|Restart|Search)$/;
let presses = 0;
for (const [q, pg] of [...pages.map((p) => ['', p]), ['?added', 'mouse']]) {
  const url = `${BASE}/${q}#/${pg}`;
  await send('Page.navigate', { url }); await sleep(2200); note(`${pg} open`);
  await ev(`document.querySelectorAll('#main details:not([open])').forEach((d) => d.open = true)`); await sleep(300);
  // choices and tabs
  const groups = (await ev(`[...document.querySelectorAll('#main .seg, #main [role=tablist]')].map((g) => [...g.querySelectorAll('button[role=radio], button[role=tab]')].length)`)) || [];
  for (let gi = 0; gi < groups.length; gi++) for (let bi = 0; bi < groups[gi]; bi++) {
    const r = await ev(`(() => { const g = [...document.querySelectorAll('#main .seg, #main [role=tablist]')][${gi}]; const b = g && [...g.querySelectorAll('button[role=radio], button[role=tab]')][${bi}]; if (!b || b.disabled) return ''; b.click(); return b.textContent.trim(); })()`);
    if (r) { presses++; await sleep(250); note(`${pg} choice "${r}"`); }
  }
  // switches: on and back
  const sw = (await ev(`document.querySelectorAll('#main button.switch:not(:disabled)').length`)) || 0;
  for (let i = 0; i < sw; i++) for (let k = 0; k < 2; k++) {
    const r = await ev(`(() => { const b = document.querySelectorAll('#main button.switch:not(:disabled)')[${i}]; if (!b) return ''; b.click(); return b.getAttribute('aria-label') || 'switch'; })()`);
    if (r) { presses++; await sleep(350); note(`${pg} switch "${r}"`); }
  }
  // every other button, once; the page is opened again after any that left it
  const labels = (await ev(`[...document.querySelectorAll('#main button:not(.switch):not([role=radio]):not([role=tab])')].map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim())`)) || [];
  for (let i = 0; i < labels.length; i++) {
    if (SKIP.test(labels[i])) continue;
    const r = await ev(`(() => { const b = [...document.querySelectorAll('#main button:not(.switch):not([role=radio]):not([role=tab])')][${i}]; if (!b || b.disabled || (b.textContent || b.getAttribute('aria-label') || '').trim() !== ${JSON.stringify(labels[i])}) return ''; b.click(); return ${JSON.stringify(labels[i])} || 'button'; })()`);
    if (!r) continue;
    presses++; await sleep(450); note(`${pg} button "${r}"`);
    // close whatever it opened: a dialog's Cancel or Close, else Escape
    await ev(`(() => { const d = document.querySelector('.modal, dialog[open], [role=dialog]'); if (!d) return; const b = [...d.querySelectorAll('button')].find((x) => /^(Cancel|Close|No|Not now|Later|Keep)$/.test(x.textContent.trim())) || [...d.querySelectorAll('button')].pop(); b?.click(); })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150); note(`${pg} after "${r}"`);
    if (!(await ev('location.href')).endsWith(`#/${pg}`)) { await send('Page.navigate', { url }); await sleep(1500); note(`${pg} reopened`); }
  }
  const misses = (await ev('window.__demoMisses ? [...new Set(window.__demoMisses)] : ["no stand-in"]')) || [];
  for (const m of misses) bad.push(`${pg}: the stand-in does not know ${m}`);
}
if (served404.length) bad.push(`files the page asked for that the build lacks: ${[...new Set(served404)].join(', ')}`);
if (outside.length) bad.push(`requests that left the page: ${[...new Set(outside)].slice(0, 10).join(', ')}`);
console.log(`demo-artifact: ${pages.length + 1} pages, ${presses} presses`);
if (bad.length) { const u = [...new Set(bad)]; console.log(`\n${u.length} problem${u.length === 1 ? '' : 's'}:\n- ${u.join('\n- ')}`); done(1); }
console.log('demo-artifact: all good');
done(0);
