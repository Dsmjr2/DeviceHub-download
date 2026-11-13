// UI audit (11 Nov 2026, the impeccable skill's `audit`, run headless): every page in demo mode, in a hidden Chrome or
// Edge, at desktop (1500x950) and phone (400x860) widths. Reports, per page:
//   contrast   text (without a text shadow, which it cannot measure) whose colour is under 4.5:1 (3:1 for 18.66px bold / 24px) against what is behind it (the panels'
//              see-through fills are laid over the page colour; pictures and gradients are not measured)
//   unnamed    buttons, inputs, selects and links with no name a screen reader can say
//   small      buttons and inputs under 24x24 px whose 24 px circle would touch another control (WCAG 2.5.8)
//   overflow   the page wider than the window at phone width
//   headings   no h1, or a heading level skipped
//   alt        pictures without an alt text
//   hidden     elements marked hidden that a class's display still draws
// Read-only: needs DeviceHub running (it serves the pages); every /api/ request that is not a plain read is answered
// here and never reaches the server, as in tests/choices-click.mjs.
// Run: node helpers/ui-audit.mjs [--json]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${process.env.DEVICEHUB_PORT || 5577}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { await fetch(`${BASE}/api/version`); } catch { console.log('ui-audit: DeviceHub is not running'); process.exit(0); }
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const pages = [...app.matchAll(/^\s*page\('([\w-]+)', '[^']*', '[\w-]+', \(\) => import/gm)].map((m) => m[1]);
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-audit-'));
const dbg = 9300 + Math.floor(Math.random() * 600);
const c = spawn(exe, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const w = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); }
  if (d.method === 'Fetch.requestPaused') {
    const { requestId, request } = d.params;
    if (request.method === 'GET' && !/\/api\/(quit|restart|open|reveal|window|monitors\/sleep|report)/.test(request.url)) return send('Fetch.continueRequest', { requestId });
    send('Fetch.fulfillRequest', { requestId, responseCode: 409, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"error":"blocked in the audit"}').toString('base64') });
  }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] });

const PROBE = String.raw`(() => {
  const rgba = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const page = rgba(getComputedStyle(document.body).backgroundColor) || [5, 5, 7, 1];
  const bgOf = (el) => { const chain = []; let image = false; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && e !== document.body) image = true; const b = rgba(s.backgroundColor); if (b && b[3] > 0) { chain.push(b); if (b[3] >= 1) break; } } let c = page; for (const b of chain.reverse()) c = over(b, c); return { c, image }; };
  const seen = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > .05 && r.bottom > 0 && r.top < innerHeight * 3; };
  const out = { contrast: [], unnamed: [], small: [], headings: [], alt: [] };
  const root = document.querySelector('#main');
  for (const el of root.querySelectorAll('*')) {
    if (!seen(el)) continue;
    const own = [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
    if (own && !el.closest('svg, .art, [aria-hidden=true]') && !el.disabled && !el.closest(':disabled')) {
      const s = getComputedStyle(el); let fg = rgba(s.color); const { c, image } = bgOf(el);
      if (fg && !image && s.textShadow === 'none') { let op = 1; for (let e = el; e && e !== root; e = e.parentElement) op *= +getComputedStyle(e).opacity; fg = over([fg[0], fg[1], fg[2], fg[3] * op], c);
        const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 600, need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5, r = ratio(fg, c);
        if (r < need) out.contrast.push([el.textContent.trim().slice(0, 40), +r.toFixed(2), need, el.className && String(el.className).slice(0, 40) || el.tagName.toLowerCase()]); }
    }
    if (el.matches('button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=switch], [role=slider]')) {
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent) || el.closest('label')?.textContent || el.placeholder || el.value && el.type === 'button' && el.value || '').trim();
      if (!name) out.unnamed.push(el.outerHTML.slice(0, 90));
      const r = el.getBoundingClientRect();
      if ((r.width < 24 || r.height < 24) && !el.closest('p, li > span')) {
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const near = [...root.querySelectorAll('button, input, select, a[href], [role=button], [role=switch]')].some((o) => { if (o === el || o.contains(el) || el.contains(o)) return false; const q = o.getBoundingClientRect(); if (!q.width) return false; const dx = Math.max(q.x - cx, 0, cx - (q.x + q.width)), dy = Math.max(q.y - cy, 0, cy - (q.y + q.height)); return Math.hypot(dx, dy) < 12; });
        if (near) out.small.push([(el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30), Math.round(r.width) + 'x' + Math.round(r.height)]);
      }
    }
    if (el.tagName === 'IMG' && !el.hasAttribute('alt')) out.alt.push(el.src.slice(-40));
  }
  const hs = [...root.querySelectorAll('h1, h2, h3, h4')].filter((h) => seen(h) || h.matches('.sr-only')).map((h) => +(h.getAttribute('aria-level') || h.tagName[1]));
  if (!hs.includes(1)) out.headings.push('no h1');
  for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { out.headings.push('h' + hs[i - 1] + ' then h' + hs[i]); break; }
  // marked hidden but still drawn (a class's display beat the hidden attribute)
  out.shownHidden = [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => (e.className && String(e.className)) || e.tagName.toLowerCase());
  out.overflow = document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('#main').scrollWidth > document.querySelector('#main').clientWidth + 1;
  return out;
})()`;

const report = {};
for (const [width, height, size] of [[1500, 950, 'desktop'], [400, 860, 'phone']]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: size === 'phone' });
  for (const pg of pages) {
    await send('Page.navigate', { url: `${BASE}/?demo#/${pg}` }); await sleep(2300);
    await ev(`document.querySelectorAll('#main details:not([open])').forEach((d) => d.open = true)`); await sleep(300);
    const r = await ev(PROBE);
    report[`${pg} ${size}`] = r;
  }
}
ws.close(); c.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
for (const [k, r] of Object.entries(report)) {
  if (!r) { console.log(`${k}: not measured`); continue; }
  const parts = [];
  if (r.contrast.length) parts.push(`contrast ${r.contrast.length}: ${r.contrast.slice(0, 4).map(([t, x, need, cls]) => `"${t}" ${x}<${need} (${cls})`).join('; ')}`);
  if (r.unnamed.length) parts.push(`unnamed ${r.unnamed.length}: ${r.unnamed.slice(0, 2).join(' | ')}`);
  if (r.small.length) parts.push(`small ${r.small.length}: ${r.small.slice(0, 4).map((x) => x.join(' ')).join('; ')}`);
  if (r.overflow) parts.push('overflow at this width');
  if (r.headings.length) parts.push(`headings: ${r.headings.join(', ')}`);
  if (r.alt.length) parts.push(`no alt ${r.alt.length}`);
  if (r.shownHidden?.length) parts.push(`hidden but shown: ${[...new Set(r.shownHidden)].join(', ')}`);
  console.log(`${k}: ${parts.length ? parts.join(' / ') : 'clean'}`);
}
