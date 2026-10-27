// One DeviceHub window after an update (23 Oct 2026, Shawn: "It also keeps opening 2 windows after updating on my
// friends pc"). A copy installed from the zip updates through helpers/install.ps1: it quits DeviceHub, copies the new
// version, then starts DeviceHub.vbs. The window Update was pressed in stays open and reloads itself when DeviceHub is
// back, but the launcher checked for an open window while DeviceHub was still starting, saw none, and opened a second.
// Now the installer passes /afterupdate when a window was open, and the launcher waits for that window to come back.
// This runs the real DeviceHub.vbs (cscript) against a fake DeviceHub on a free port; DEVICEHUB_LAUNCH_LOG makes it
// write what it would start instead of starting it, so no window opens and the real copy on 5577 is never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// the installer: reads the window count before it quits DeviceHub, and passes /afterupdate only then
const inst = fs.readFileSync(path.join(ROOT, 'helpers', 'install.ps1'), 'utf8');
const quitAt = inst.indexOf('/api/quit'), winAt = inst.indexOf('/api/windows');
check(winAt > 0 && winAt < quitAt, 'install.ps1 reads /api/windows before it quits DeviceHub');
check(/\$hadWindow\s*=\s*\$false/.test(inst), 'install.ps1 starts with $hadWindow = $false');
check(/if \(\$hadWindow\) \{ @\('\/afterupdate'\) \}/.test(inst), 'install.ps1 starts DeviceHub.vbs with /afterupdate when a window was open');
const vbs = fs.readFileSync(path.join(ROOT, 'DeviceHub.vbs'), 'utf8');
check((vbs.match(/sh\.Run /g) || []).length === 1 && !/sh\.AppActivate\("DeviceHub"\) Then/.test(vbs), 'DeviceHub.vbs starts things only through Launch (so the test sees them)');
// DeviceHub's own window keeps its memory flags on both launch lines (--app-id and --app), and keeps site isolation
// (links open in that profile) and the GPU in its own process (27 Oct 2026)
{
  const own = vbs.split(/\r?\n/).filter((l) => /^\s*Launch .*--user-data-dir=/.test(l));
  check(own.length === 2, `DeviceHub.vbs has two own-window launch lines (${own.length})`);
  for (const l of own) {
    const kind = /--app-id=/.test(l) ? '--app-id' : '--app';
    const feats = ((/--disable-features=(\S+)/.exec(l) || [])[1] || '').split(',');
    for (const f of ['OptimizationGuideModelDownloading', 'OptimizationHints', 'OptimizationTargetPrediction', 'SpareRendererForSitePerProcess']) check(feats.includes(f), `${kind} launch line disables ${f}`);
    for (const f of ['--disable-extensions', '--disable-component-update', '--disk-cache-size=8388608']) check(l.includes(f), `${kind} launch line has ${f}`);
    check((l.match(/--disable-features=/g) || []).length === 1, `${kind} launch line has one --disable-features (Chrome reads only the last)`);
    check(!/site-per-process|--disable-site-isolation|--in-process-gpu|--single-process|--enable-low-end-device-mode/.test(l), `${kind} launch line keeps site isolation, the GPU process and full picture quality`);
  }
}

if (process.platform === 'win32' && fs.existsSync(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cscript.exe'))) {
  const parse = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.join(ROOT, 'helpers', 'install.ps1').replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  check(parse.status === 0, `install.ps1 parses (${(parse.stdout || '').trim()})`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-update-window-'));
  fs.copyFileSync(path.join(ROOT, 'DeviceHub.vbs'), path.join(dir, 'DeviceHub.vbs'));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ "lightWindow": false }');

  // a fake DeviceHub: down for upMs, then answering; its window count turns 1 at windowMs (null = never)
  async function scenario(name, { args = [], upMs = 0, windowMs = null, wait = 4, settings = '{ "lightWindow": false }', extraEnv = {} }) {
    const sf = path.join(dir, 'settings.json');
    if (settings == null) fs.rmSync(sf, { force: true }); else fs.writeFileSync(sf, settings);
    const t0 = Date.now();
    const server = http.createServer((req, res) => {
      const now = Date.now() - t0;
      if (now < upMs) { req.socket.destroy(); return; }   // still starting: nothing answers yet
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'test' }));
      if (req.url === '/api/windows') return res.end(JSON.stringify({ open: windowMs !== null && now >= windowMs ? 1 : 0 }));
      res.statusCode = 404; res.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const log = path.join(dir, `${name}.log`);
    const env = { ...process.env, DEVICEHUB_PORT: String(port), DEVICEHUB_LAUNCH_LOG: log, DEVICEHUB_WINDOW_WAIT: String(wait), ...extraEnv };
    const p = spawn('cscript.exe', ['//nologo', '//T:60', path.join(dir, 'DeviceHub.vbs'), ...args], { env, windowsHide: true, stdio: 'pipe' });
    let err = ''; p.stderr.on('data', (d) => { err += d; }); p.stdout.on('data', (d) => { err += d; });
    const code = await new Promise((r) => p.on('close', r));
    server.close();
    const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    check(code === 0, `${name}: the launcher ended with code ${code} (${err.trim().slice(0, 300)})`);
    const opened = lines.filter((l) => /--app/.test(l));
    return { keep: lines.filter((l) => /keep-running\.bat/.test(l)).length, windows: opened.length,
      own: opened.filter((l) => /--user-data-dir=/.test(l)).length, edge: opened.filter((l) => /msedge\.exe/i.test(l)).length, activated: lines.includes('activate DeviceHub'), lines };
  }

  // 1. the update path: DeviceHub is starting again, the old window comes back a few seconds after it answers
  const a = await scenario('after-update', { args: ['/afterupdate'], upMs: 1500, windowMs: 4500, wait: 8 });
  check(a.keep === 1, `after an update: the keep-running loop is started once (${a.lines})`);
  check(a.windows === 0, `after an update with the window still open: no second window (${a.lines})`);
  // 2. the update path, but the window was closed meanwhile: exactly one opens
  const b = await scenario('after-update-closed', { args: ['/afterupdate'], upMs: 1500, windowMs: null, wait: 3 });
  check(b.windows === 1, `after an update with no window left: one window opens (${b.lines})`);
  // 3. a plain start (Desktop or Start): DeviceHub not running, no window: one opens, with no extra wait
  const c = await scenario('plain-start', { upMs: 1500, windowMs: null });
  check(c.windows === 1 && c.keep === 1, `a plain start opens one window (${c.lines})`);
  // 4. a plain start while DeviceHub runs with its window open: brought to the front, none opened
  const d = await scenario('already-open', { upMs: 0, windowMs: 0 });
  check(d.windows === 0 && d.activated, `a start while the window is open brings it to the front (${d.lines})`);

  // 5. Low-memory window on by default (26 Oct 2026, Shawn): no setting = an app window in the person's own browser
  const e = await scenario('light-default', { settings: null });
  check(e.windows === 1 && e.own === 0, `no settings.json: the low-memory window opens in the person's own Chrome (${e.lines})`);
  const e2 = await scenario('light-unset', { settings: '{ "autoSwitch": true }' });
  check(e2.windows === 1 && e2.own === 0, `settings without lightWindow: the low-memory window (${e2.lines})`);
  // 6. a saved false stays false (scenario 3 above): DeviceHub's own window, its own profile
  check(c.own === 1, `lightWindow false: DeviceHub's own window (${c.lines})`);
  const f = await scenario('light-on', { settings: '{\n  "lightWindow": true\n}' });
  check(f.windows === 1 && f.own === 0, `lightWindow true: the low-memory window (${f.lines})`);
  // 7. no Chrome: Edge, and the low-memory window opens there too (the person's own Edge)
  const g = await scenario('edge-light', { settings: null, extraEnv: { DEVICEHUB_TEST_NO_CHROME: '1' } });
  check(g.windows === 1 && g.edge === 1 && g.own === 0, `no Chrome: the low-memory window opens in Edge (${g.lines})`);
  const g2 = await scenario('edge-own', { extraEnv: { DEVICEHUB_TEST_NO_CHROME: '1' } });
  check(g2.windows === 1 && g2.edge === 1 && g2.own === 1, `no Chrome, lightWindow false: Edge with DeviceHub's own profile (${g2.lines})`);

  // 8. the window closed itself after 5 minutes minimized (26 Oct 2026, core/idle-close.js): DeviceHub still runs in the
  // tray with no window; the tray's Open DeviceHub runs this launcher, which opens one at once (no 1.2 s start wait)
  const t8 = Date.now();
  const h = await scenario('reopen-from-tray', { upMs: 0, windowMs: null });
  check(h.windows === 1 && h.own === 1 && !h.activated, `reopened from the tray: one own window (${h.lines})`);
  check(Date.now() - t8 < 2500, `reopened from the tray within 2.5 s (${Date.now() - t8} ms)`);

  fs.rmSync(dir, { recursive: true, force: true });
} else console.log('update-window: not on Windows; the launcher run was skipped');

if (fails.length) { console.log(`update-window: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('update-window: one DeviceHub window after an update');
