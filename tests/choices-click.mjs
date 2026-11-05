// npm test (4 Nov 2026, Shawn: the Equalizer's speaker choices did nothing, and he asked for the whole app to be checked
// for controls like it): every page in demo mode, in a hidden Chrome, presses every choice (each option of a segmented
// control, each tab) and fails when a press leaves the old choice selected or throws a code error. Nothing reaches a
// device or Windows: every request that is not a plain read is answered "blocked" here, before it leaves the browser.
// Skipped, not failed, when DeviceHub is not running on this PC.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT || 5577), BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`${BASE}/api/version`); } catch { console.log(`choices-click: skipped (DeviceHub is not running on port ${PORT})`); process.exit(0); }

const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const pages = [];
for (const [, , f] of app.matchAll(/^\s*page\('([\w-]+)', '[^']*', '[\w-]+', \(\) => import\('\.\/(pages\/[\w-]+\.js)'\)/gm)) {
  const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'); pages.push((/export default \{[\s\S]*?\bid: '([\w-]+)'/.exec(src) || /\bid: '([\w-]+)'/.exec(src))[1]);
}
// the device pages demo mode adds (?demo&added: an added mouse, its own page kind)
const extra = ['mouse', 'keyboard', 'headset'].filter((p) => !pages.includes(p));
pages.push(...extra);

const chromes = [process.env.DEVICEHUB_CHROME || '', 'C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const exe = chromes.find((p) => fs.existsSync(p));
if (!exe) { console.log('choices-click: skipped (no Chrome or Edge found)'); process.exit(0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-test-'));
const dbg = 9300 + Math.floor(Math.random() * 600);
const c = spawn(exe, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', ...(process.env.DEVICEHUB_CHROME ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
const done = (code) => { try { ws?.close(); } catch {} c.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
var ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const w = new Map(); const errors = []; let blocked = 0;
// reads go through; anything else (a write, an action) is answered here and never reaches the server. A GET that acts
// (open, reveal, quit, restart...) is blocked by name as well.
const ACTS = /\/api\/(quit|restart|uninstall|publish-release|self-update|open|reveal|installers|library\/install|learn|openrgb\/find|window|monitors\/sleep|game-mode\/now|eq\/turn-on|eq\/corsair-fix|wifi-pause|backup\b|report|auto-report|share|setup-extras\/|driver-share)/;
ws.addEventListener('message', async (m) => {
  const d = JSON.parse(m.data);
  if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n').slice(0, 2).join(' ').slice(0, 240) || d.params.exceptionDetails.text);
  if (d.method === 'Fetch.requestPaused') {
    const { requestId, request } = d.params;
    if (request.method === 'GET' && !ACTS.test(new URL(request.url).pathname)) return send('Fetch.continueRequest', { requestId });
    blocked++;
    send('Fetch.fulfillRequest', { requestId, responseCode: 409, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ error: 'blocked in a test' })).toString('base64') });
  }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });

// the choices on the page now, by their place: [group index, option index, label, selected, disabled]
const LIST = `[...document.querySelectorAll('#main .seg, #main [role=tablist]')].map((g, gi) => [...g.querySelectorAll('button[role=radio], button[role=tab]')].map((b, bi) => [gi, bi, b.textContent.trim(), b.classList.contains('sel') || b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true', b.disabled || !!b.closest('fieldset[disabled]')]))`;
const bad = [];
let pressed = 0;
for (const [q, pg] of [...pages.map((p) => ['?demo', p]), ['?demo&added', 'mouse'], ['?demo&apo', 'headset']]) {
  errors.length = 0;
  await send('Page.navigate', { url: `${BASE}/${q}#/${pg}` }); await sleep(2500);
  // open every fold first: a choice inside one is still a choice
  await ev(`document.querySelectorAll('#main details:not([open])').forEach((d) => d.open = true)`); await sleep(400);
  const groups = (await ev(LIST)) || [];
  for (const g of groups) for (const [gi, bi, label, sel, dis] of g) {
    if (sel || dis) continue;
    const before = await ev(`(() => { const g = [...document.querySelectorAll('#main .seg, #main [role=tablist]')][${gi}]; const b = g && [...g.querySelectorAll('button[role=radio], button[role=tab]')][${bi}]; if (!b || b.textContent.trim() !== ${JSON.stringify(label)}) return 'moved'; b.scrollIntoView({ block: 'center' }); b.click(); return 'ok'; })()`);
    if (before !== 'ok') continue;   // the page changed under the list (a choice redrew it); the next pass reads it again
    pressed++;
    await sleep(500);
    // still a choice after the redraw: the same label in a group must now be the selected one, unless a write was
    // blocked (a device setting puts itself back when the device says no, which is right)
    const now = await ev(`[...document.querySelectorAll('#main .seg, #main [role=tablist]')].flatMap((g) => [...g.querySelectorAll('button[role=radio], button[role=tab]')]).filter((b) => b.textContent.trim() === ${JSON.stringify(label)}).map((b) => b.classList.contains('sel') || b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true')`);
    const wrote = blocked;
    if (errors.length) { bad.push(`${q} ${pg} "${label}": ${[...new Set(errors)].join(' | ')}`); errors.length = 0; }
    else if (now && now.length && !now.some(Boolean) && !wrote) bad.push(`${q} ${pg} "${label}": pressed, nothing was written, and it is still not selected`);
    blocked = 0;
  }
}
console.log(`pressed ${pressed} choices on ${pages.length + 2} demo pages`);
if (bad.length) { console.log(`\n${bad.length} problem${bad.length === 1 ? '' : 's'}:\n- ${bad.join('\n- ')}`); done(1); }
console.log('choices-click: all good');
done(0);
