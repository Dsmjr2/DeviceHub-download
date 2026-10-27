// npm test, part 2 (20 Oct 2026): opens every page of the running DeviceHub, live and demo, in a hidden Chrome window
// and fails on any script error or an empty page. Read-only: opening a page only reads (devices, EQ, monitors).
// Skipped, not failed, when DeviceHub is not running on this PC.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT || 5577), BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`${BASE}/api/version`); } catch { console.log(`pages: skipped (DeviceHub is not running on port ${PORT})`); process.exit(0); }

// the page ids from the sidebar list (same rule as check.mjs)
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const pages = [];
for (const [, , f] of app.matchAll(/^\s*page\('([\w-]+)', '[^']*', '[\w-]+', \(\) => import\('\.\/(pages\/[\w-]+\.js)'\)/gm)) {   // each loaded when first opened (27 Oct 2026)
  { const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'); pages.push((/export default \{[\s\S]*?\bid: '([\w-]+)'/.exec(src) || /\bid: '([\w-]+)'/.exec(src))[1]); }  // the page's own id, not a demo row's
}
if (!pages.length) { console.log('pages: no PAGES list found in public/app.js'); process.exit(1); }

const chromes = [process.env.DEVICEHUB_CHROME || '', 'C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const exe = chromes.find((p) => fs.existsSync(p));
if (!exe) { console.log('pages: skipped (no Chrome or Edge found)'); process.exit(0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-test-'));
const dbg = 9300 + Math.floor(Math.random() * 600);
const c = spawn(exe, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', ...(process.env.DEVICEHUB_CHROME ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const w = new Map(); const errors = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]?.slice(0, 200) || d.params.exceptionDetails.text); });
const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

const bad = [];
for (const q of ['', '?demo']) for (const pg of pages) {
  errors.length = 0;
  await send('Page.navigate', { url: `${BASE}/${q}#/${pg}` }); await sleep(q ? 2000 : 4000);
  const filled = await ev(`document.querySelector('#main')?.children.length || 0`);
  const where = `${q ? 'demo' : 'live'} ${pg}`;
  if (errors.length) bad.push(`${where}: ${[...new Set(errors)].join(' | ')}`);
  else if (!filled) bad.push(`${where}: empty page`);
}
ws.close(); c.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`opened ${pages.length * 2} pages (live and demo)`);
if (bad.length) { console.log(`\n${bad.length} problem${bad.length === 1 ? '' : 's'}:\n- ${bad.join('\n- ')}`); process.exit(1); }
console.log('pages: all good');
process.exit(0);
