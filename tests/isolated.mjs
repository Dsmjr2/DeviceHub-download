// Isolated test mode (DEVICEHUB_ISOLATED=1, 22 Oct 2026; docs/handoff/isolated-mode.md). Starts a second DeviceHub
// from a temporary copy of this folder (server.js, helpers without helpers/bin, public) on a free port, beside the
// real one, then checks:
//   - /api/version answers, every page and page script loads, index.html carries the demo switch;
//   - the routes that would reach a device or Windows answer "isolated" instead;
//   - optionally (Chrome or Edge present), every sidebar page opens in demo mode without a script error;
//   - the server started NO process of its own (none of its child PIDs, recursively), and no new DeviceHubHelper,
//     iCUE or OpenRGB process appeared anywhere while it ran;
//   - the Startup shortcut and the bundled OpenRGB pid file were not touched; the real DeviceHub (if running) still
//     answers its /api/version (GET only).
// Then it stops exactly its own child process (by its PID) and removes the temporary copy.
// Run: node tests/isolated.mjs   (not part of npm test)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// every process on the PC: pid, parent pid, name (one PowerShell call, started by this test, not by the server)
function processes() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return out.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, ppid, name] = l.split('\t'); return { pid: Number(pid), ppid: Number(ppid), name: name || '' }; });
}
const descendants = (list, root) => {
  const found = []; const queue = [root];
  while (queue.length) { const p = queue.shift(); for (const x of list) if (x.ppid === p && x.pid !== root && !found.some((f) => f.pid === x.pid)) { found.push(x); queue.push(x.pid); } }
  return found;
};
const WATCHED = /^(DeviceHubHelper|iCUE|OpenRGB|DeviceSelector)\b.*\.exe$/i;
const stamp = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return null; } };
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// 1. the temporary copy: its own folder, so every file it writes stays inside it
const COPY = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-isolated-'));
for (const f of ['server.js', 'package.json', 'DeviceHub.ico']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(COPY, f));
fs.cpSync(path.join(ROOT, 'public'), path.join(COPY, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT, 'helpers'), path.join(COPY, 'helpers'), { recursive: true, filter: (src) => path.relative(path.join(ROOT, 'helpers'), src).split(path.sep)[0] !== 'bin' });

const PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}`;
const REAL = Number(process.env.DEVICEHUB_REAL_PORT || 5577);
const realUp = async () => { try { return /"version"/.test(await (await fetch(`http://127.0.0.1:${REAL}/api/version`, { signal: AbortSignal.timeout(5000) })).text()); } catch { return false; } };
const realBefore = await realUp();
const LNK = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DeviceHub.lnk');
const PIDFILE = path.join(os.tmpdir(), 'DeviceHub-openrgb.json');
const stampsBefore = { lnk: stamp(LNK), pid: stamp(PIDFILE) };
const before = processes();
const beforePids = new Set(before.map((p) => p.pid));

// 2. the isolated server: only DEVICEHUB_ISOLATED and DEVICEHUB_PORT of DeviceHub's switches
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^DEVICEHUB_/i.test(k)));
const child = spawn(process.execPath, [path.join(COPY, 'server.js')], { cwd: COPY, env: { ...env, DEVICEHUB_ISOLATED: '1', DEVICEHUB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
let exited = null, gone = false; child.on('exit', (code, signal) => { gone = true; exited = code ?? signal; });
const startedAt = Date.now();

try {
  let up = false;
  for (let i = 0; i < 75 && !up && !gone; i++) { try { up = (await fetch(`${BASE}/api/version`)).ok; } catch { await sleep(200); } }
  check(up, `isolated server did not answer on port ${PORT} (exit ${exited}): ${out.trim().slice(-300)}`);
  if (!up) throw new Error('not up');
  check(/\[isolated\] test mode/.test(out), 'the server says it is in isolated test mode');

  // 3. version, the page and every page script
  const v = await (await fetch(`${BASE}/api/version`)).json();
  check(typeof v.version === 'string' && v.version.length > 0, `/api/version: ${JSON.stringify(v)}`);
  const index = await (await fetch(`${BASE}/`)).text();
  check(/window\.DEVICEHUB_DEMO = true/.test(index) && /<script type="module" src="app\.js"><\/script>/.test(index), 'index.html in isolated mode carries the demo switch before app.js');
  const files = ['app.js', 'style.css', 'manifest.webmanifest', ...fs.readdirSync(path.join(ROOT, 'public', 'pages')).map((f) => `pages/${f}`)];
  for (const f of files) { const r = await fetch(`${BASE}/${f}`); check(r.ok, `GET /${f}: ${r.status}`); }
  // the sidebar's page ids (as tests/pages.mjs reads them)
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const pages = [];
  for (const n of (/const PAGES = \[([^\]]+)\]/.exec(app) || [])[1].split(',').map((s) => s.trim())) {
    const f = new RegExp(`import ${n} from '\\./(pages/[\\w-]+\\.js)'`).exec(app)[1];
    pages.push(/\bid: '([\w-]+)'/.exec(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'))[1]);
  }

  // 4. routes that would reach a device, the helper, iCUE, OpenRGB, Equalizer APO or Windows: answered isolated
  for (const r of ['/api/agent-config', '/api/health', '/api/monitors', '/api/cameras', '/api/openrgb', '/api/startup', '/api/settings-sync', '/api/self-update', '/api/updates',
    '/api/eq', '/api/pc', '/api/pointer', '/api/diag', '/api/agent/state', '/api/corsair/devices', '/api/report/short', '/api/gpu', '/api/bluetooth', '/api/std-battery', '/api/lamparrays', '/api/setup', '/api/library', '/api/diagnose']) {
    const res = await fetch(`${BASE}${r}`); let body = null; try { body = await res.json(); } catch {}
    check(res.headers.get('x-devicehub-isolated') === '1', `GET ${r} is not answered by isolated mode (${res.status} ${JSON.stringify(body)?.slice(0, 120)})`);
  }
  for (const r of ['/api/startup', '/api/monitors/set', '/api/openrgb/color', '/api/pointer', '/api/eq/save', '/api/settings-sync', '/api/self-update', '/api/uninstall', '/api/reveal', '/api/open']) {
    const res = await fetch(`${BASE}${r}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true,"app":"icue"}' });
    let body = null; try { body = await res.json(); } catch {}
    check(res.status === 503 && body?.isolated === true && res.headers.get('x-devicehub-isolated') === '1', `POST ${r} reached the real handler (${res.status})`);
  }
  // a file-only route still works, inside the copy
  const s = await fetch(`${BASE}/api/settings`); check(s.ok, `GET /api/settings: ${s.status}`);

  // 5. every page in a hidden Chrome / Edge (the test's own child, not the server's), demo mode by the server's switch
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
  if (exe) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-isolated-chrome-'));
    const dbg = 9300 + Math.floor(Math.random() * 600);
    const c = spawn(exe, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
    try {
      let t; for (let i = 0; i < 150 && !t; i++) { try { t = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
      const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
      let n = 0; const w = new Map(); const errors = [];
      ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]?.slice(0, 200) || d.params.exceptionDetails.text); });
      const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
      const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
      await cdp('Runtime.enable');
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
      for (const pg of pages) {
        errors.length = 0;
        await cdp('Page.navigate', { url: `${BASE}/#/${pg}` }); await sleep(2500);
        const filled = await ev(`document.querySelector('#main')?.children.length || 0`);
        const demo = await ev('window.DEVICEHUB_DEMO === true && !!document.querySelector(".brand small")');
        if (errors.length) check(false, `page ${pg}: ${[...new Set(errors)].join(' | ')}`);
        else check(filled, `page ${pg}: empty`);
        check(demo, `page ${pg}: not in demo mode`);
      }
      // Lighting (26 Oct 2026, Shawn: "when I change one it scrolls back to the top"): at 1650x950 the page does not
      // scroll; giving a PC light a color, and dragging the picker by keys, keeps the same page and the card's scroll
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1650, height: 950, deviceScaleFactor: 1, mobile: false });
      errors.length = 0;
      await cdp('Page.navigate', { url: `${BASE}/#/lighting` }); await sleep(2500);
      const lit = (await cdp('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
        const main = document.querySelector('#main'), page = main.firstElementChild, panel = document.querySelector('.light-pc > .panel');
        const fits = document.documentElement.scrollHeight <= innerHeight && main.scrollHeight <= main.clientHeight + 1;
        page.dataset.kept = '1'; panel.scrollTop = 120; const scroll = panel.scrollTop;
        const row = document.querySelector('.pcl-sec[data-sec="fans"] .pcl-rows .pcl-row');
        row.querySelector('.pcl-paint').click();
        const hue = document.querySelector('.cp-hue'); hue.focus();
        for (let i = 0; i < 12; i++) hue.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
        hue.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        const big = getComputedStyle(document.querySelector('.cp-big')).backgroundColor, dot = row.querySelector('.pcl-dot').style.background;
        // each row's own preset dots and its text Off (26 Oct 2026): the second fan header only
        const rows = [...document.querySelectorAll('.pcl-sec[data-sec="fans"] .pcl-rows .pcl-row')], other = rows[1];
        const presets = rows.every((r) => r.querySelectorAll('.pcl-preset').length === 10 && r.querySelector('.pcl-paint') && r.querySelector('.pcl-off')?.textContent === 'Off');
        const before = row.querySelector('.pcl-dot').style.background;
        other.querySelector('.pcl-preset[data-hex="#3ddc97"]').click();
        const preset = other.querySelector('.pcl-dot').style.background === 'rgb(61, 220, 151)' && other.querySelector('.pcl-preset[data-hex="#3ddc97"]').classList.contains('on') && row.querySelector('.pcl-dot').style.background === before && !other.classList.contains('is-live');
        other.querySelector('.pcl-off').click();
        const offText = other.querySelector('.pcl-now-off').offsetParent !== null && other.querySelector('.pcl-dot').offsetParent === null && other.querySelector('.pcl-off').classList.contains('on') && !other.querySelector('.swatch-off');
        return { fits, kept: main.firstElementChild.dataset.kept === '1' && panel.isConnected, scroll: panel.scrollTop === scroll, live: row.classList.contains('is-live') && row.classList.contains('match'), follows: big === dot && big !== 'rgb(255, 106, 26)', focus: document.activeElement === hue, presets, preset, offText };
      })()` })).result?.result?.value;
      const litR = lit || null;
      check(!errors.length, `lighting: ${[...new Set(errors)].join(' | ')}`);
      check(litR && litR.fits, `lighting: the page scrolls at 1650x950 (${JSON.stringify(litR)})`);
      check(litR && litR.kept && litR.scroll, `lighting: a color change redrew the page or lost the card's scroll (${JSON.stringify(litR)})`);
      check(litR && litR.live && litR.follows && litR.focus, `lighting: the row did not follow the picker, or the picker lost focus (${JSON.stringify(litR)})`);
      check(litR && litR.presets && litR.preset && litR.offText, `lighting: a row's presets, its preset write or its Off text are wrong (${JSON.stringify(litR)})`);
      ws.close();
      console.log(`opened ${pages.length} pages in ${path.basename(exe)} (demo mode)`);
    } finally { c.kill(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
  } else console.log('pages in a browser: skipped (no Chrome or Edge)');

  // 6. give the background timers a server would start (monitors 5 s, brand 5 s, ...) time to show, then look
  const wait = 12000 - (Date.now() - startedAt); if (wait > 0) await sleep(wait);
  check(!gone, `isolated server stopped by itself (exit ${exited})`);
  const after = processes();
  // conhost.exe is Windows' console host, made by Windows with the node process itself (not started by the server)
  const kids = descendants(after, child.pid).filter((k) => !/^conhost\.exe$/i.test(k.name));
  check(kids.length === 0, `the isolated server started processes: ${kids.map((k) => `${k.name} (${k.pid})`).join(', ')}`);
  const appeared = after.filter((p) => !beforePids.has(p.pid) && WATCHED.test(p.name));
  check(appeared.length === 0, `new helper / iCUE / OpenRGB / Equalizer APO processes while it ran: ${appeared.map((k) => `${k.name} (${k.pid}, parent ${k.ppid})`).join(', ')}`);
  check(stamp(LNK) === stampsBefore.lnk, 'the Startup shortcut changed while the isolated copy ran');
  check(stamp(PIDFILE) === stampsBefore.pid, "the bundled OpenRGB pid file changed while the isolated copy ran");
  if (realBefore) check(await realUp(), `the real DeviceHub on port ${REAL} stopped answering`);
  console.log(`isolated server pid ${child.pid} on port ${PORT}: ${kids.length} child processes, ${appeared.length} new watched processes; real DeviceHub ${realBefore ? 'answering' : 'not running'}`);
} catch (e) { if (e.message !== 'not up') check(false, `test error: ${e.message}`); }
finally {
  // stop exactly this test's own server (TerminateProcess on its PID; nothing else is touched)
  if (!gone) { child.kill(); for (let i = 0; i < 50 && !gone; i++) await sleep(100); }
  check(gone, `isolated server pid ${child.pid} did not stop`);
  try { fs.rmSync(COPY, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.log(`\nisolated: ${fails.length} problem${fails.length === 1 ? '' : 's'}:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('isolated: all good');
process.exit(0);
