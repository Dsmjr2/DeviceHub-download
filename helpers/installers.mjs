// The optional tools, installed from DeviceHub itself (22 Oct 2026, the owner: "break away from needing Claude"): one
// Install button per tool, one confirmation, and the maker's own installer does the rest in front of the person.
//
// What it never does: install anything silently, get round Windows' admin prompt (UAC), or run a file it could not
// check. Each download comes from the maker's own site only (redirects are followed only to that maker's hosts), lands
// in %TEMP%\DeviceHub-downloads\, and is run only when its Authenticode signature is Valid AND names the expected
// signer, or, failing that, when it matches a SHA-256 the maker publishes. Otherwise it is deleted and the person is
// offered the official page instead. A tool with neither check known is offered as "open the official page" only.
//
// GET /api/installers, GET /api/installers/plan?tool=, POST /api/installers/install {tool} (starts it and answers at
// once), GET /api/installers/progress. server.js: one line in api(), see docs/handoff/installers.md.
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { UAC_LINE, UAC_WAIT_MS, record as recordUac, declinedText, unansweredText } from './uac.mjs';
const require = createRequire(import.meta.url);

const PF = process.env.ProgramFiles || 'C:\\Program Files';
// tools shipped inside DeviceHub (22 Oct 2026, the owner's decision; helpers/bundled-tools.json, helpers/fetch-bundled.mjs):
// the zip carries Equalizer APO's official installer in tools\equalizerapo\, pinned by its SHA-256
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json'), 'utf8')).tools; } catch { return []; } })();
const bundleOf = (id) => BUNDLE.find((b) => b.id === id);
const bundlePath = (id) => { const b = bundleOf(id); return b ? path.join(ROOT, ...b.folder.split('/'), b.file) : null; };

// The table. Versions and URLs read from the makers' own pages on 22 Oct 2026; to move to a newer version, change
// `version` and `url` (and `sha256` when a maker publishes one).
//   signer: a pattern the Authenticode signer's subject must match (USBPcap's: its author's code-signing name, read
//           from his other signed files; not yet seen on this exact download, so the first real install confirms it)
//   sha256: the maker's published SHA-256, used when the file is not signed that way (none of the three publishes one)
//   bundled: the file shipped inside DeviceHub (tools\...), installed from there only, never downloaded at run time
// Equalizer APO and ReaPlugs are not signed and their makers publish no hash. Equalizer APO ships inside DeviceHub
// (22 Oct 2026), so it installs from that copy; ReaPlugs is offered as "open the official page" only.
export const TOOLS = [
  {
    id: 'eqapo', name: 'Equalizer APO', version: '1.4.2',
    adds: 'EQ, mic filters and monitor EQ.',
    page: 'https://sourceforge.net/projects/equalizerapo/',
    url: 'https://sourceforge.net/projects/equalizerapo/files/1.4.2/EqualizerAPO-x64-1.4.2.exe/download',
    file: 'EqualizerAPO-x64-1.4.2.exe', approxBytes: 11980366,
    hosts: ['sourceforge.net', 'downloads.sourceforge.net', '.dl.sourceforge.net'],
    // not signed and no published hash: shipped inside DeviceHub instead (22 Oct 2026), its installer checked against
    // the SHA-256 pinned from the official download when the zip was built. A running DeviceHub never downloads it.
    signer: null, sha256: bundleOf('equalizerapo')?.sha256 || null, pinned: true, bundled: bundlePath('equalizerapo'),
    marker: path.join(PF, 'EqualizerAPO', 'config', 'config.txt'), uninstallName: /^Equalizer ?APO/i,
    // which device it works on cannot be set from outside: its Configurator (DeviceSelector.exe) has no command line
    // and records the choice by rewriting Windows' protected audio-effect registry keys, which DeviceHub never edits
    after: 'Click Yes, Next, I Agree, Next, Install. In Configurator tick your headset (and its mic), OK, then restart the PC.',
    restart: true,
  },
  {
    id: 'reaplugs', name: 'ReaPlugs', version: '2.36',
    adds: 'Mic Even volume and background gate.',
    page: 'https://www.reaper.fm/reaplugs/',
    url: 'https://www.reaper.fm/reaplugs/reaplugs236_x64-install.exe',
    file: 'reaplugs236_x64-install.exe', approxBytes: 1192256,
    hosts: ['www.reaper.fm', 'reaper.fm'],
    signer: null, sha256: null,  // not signed (its installed DLLs and uninstaller read NotSigned, 22 Oct 2026); no published hash
    marker: path.join(PF, 'VSTPlugins', 'ReaPlugs', 'reacomp-standalone.dll'), uninstallName: /^ReaPlugs/i,
    after: 'Click Yes, keep the folder, Install. Then turn on Even volume.',
    restart: false,
  },
  {
    id: 'usbpcap', name: 'USBPcap', version: '1.5.4.0',
    adds: 'For learning a device.',
    page: 'https://desowin.org/usbpcap/',
    url: 'https://github.com/desowin/usbpcap/releases/download/1.5.4.0/USBPcapSetup-1.5.4.0.exe',
    file: 'USBPcapSetup-1.5.4.0.exe', approxBytes: 195040,
    hosts: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
    signer: /Tomasz Mo|Wireshark Foundation/i, signerName: 'Tomasz Moń (its author) or the Wireshark Foundation', sha256: null,
    marker: path.join(PF, 'USBPcap', 'USBPcapCMD.exe'), uninstallName: /^USBPcap/i,
    after: 'Click Yes, I Agree, Next, Install, and Yes to the driver. Restart before learning.',
    restart: true,
  },
];
export const DIR = path.join(os.tmpdir(), 'DeviceHub-downloads');
const MAX_BYTES = 200 * 1024 * 1024;

const tool = (t) => (typeof t === 'object' && t ? t : TOOLS.find((x) => x.id === t));
const canVerify = (t) => !!(t.signer || t.sha256);
// a tool shipped inside DeviceHub installs from that file only; without it (a development copy) its official page
const fromBundle = (t) => !!t.bundled && deps.exists(t.bundled);
const offerOf = (t) => ('bundled' in t ? (fromBundle(t) ? 'install' : 'page') : canVerify(t) ? 'install' : 'page');
export const hostOk = (t, u) => {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:') return false;
  return t.hosts.some((h) => (h.startsWith('.') ? x.hostname.endsWith(h) : x.hostname === h));
};

// ---- the parts that touch the outside world, swappable for tests (tests/installers.mjs) ----
function request(method, u, onResponse) {
  return new Promise((resolve, reject) => {
    const r = https.request(u, { method, headers: { 'User-Agent': 'DeviceHub' }, timeout: 20000 }, (res) => onResponse(res, resolve, reject));
    r.on('timeout', () => r.destroy(new Error('the download site did not answer')));
    r.on('error', reject);
    r.end();
  });
}
// follows redirects (only to the tool's own hosts) to the file; HEAD: its size, GET: the response to stream
async function open(t, method) {
  let u = t.url;
  for (let hop = 0; hop < 8; hop++) {
    if (!hostOk(t, u)) throw new Error(`the download went to ${new URL(u).hostname}, which is not ${t.name}'s own site; stopped`);
    const res = await request(method, u, (res, resolve) => resolve(res));
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); u = new URL(res.headers.location, u).href; continue; }
    if (res.statusCode !== 200) { res.resume(); throw new Error(`the download site answered ${res.statusCode}`); }
    return { res, finalUrl: u, size: Number(res.headers['content-length']) || null };
  }
  throw new Error('too many redirects');
}
export const deps = {
  async head(t) { const { res, size, finalUrl } = await open(t, 'HEAD'); res.resume(); return { size, finalUrl }; },
  async download(t, dest, onBytes) {
    const { res, size } = await open(t, 'GET');
    if (size && size > MAX_BYTES) { res.destroy(); throw new Error('the file is far larger than expected; stopped'); }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      let got = 0;
      res.on('data', (c) => { got += c.length; if (got > MAX_BYTES) { res.destroy(new Error('the file is far larger than expected; stopped')); return; } onBytes(got, size); });
      res.on('error', (e) => { out.destroy(); reject(e); });
      out.on('error', reject);
      out.on('finish', () => (size && got !== size ? reject(new Error(`the download stopped early (${got} of ${size} bytes)`)) : resolve()));
      res.pipe(out);
    });
  },
  // Authenticode, read by Windows' own Get-AuthenticodeSignature (nothing is run): { status, signer }
  signature(file) {
    const ps = '$s = Get-AuthenticodeSignature -LiteralPath $env:DH_FILE; "$($s.Status)|$($s.SignerCertificate.Subject)"';
    return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 30000, env: { ...process.env, DH_FILE: file } }, (err, out) => {
      const [status, ...rest] = String(out || '').trim().split('|');
      resolve({ status: err ? 'Error' : status || 'Unknown', signer: rest.join('|') || null });
    }));
  },
  sha256(file) {
    return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))); });
  },
  // The maker's installer, started the ordinary way (ShellExecute through Start-Process): Windows shows its own admin
  // prompt and the installer its own windows. No silent switches, no -Verb RunAs from here. Waits for it to close.
  // Start-Process returns only once Windows' permission box is answered, so "started" (printed then) means Yes
  // (onStarted). Not answered within waitMs (24 Oct 2026, UAC_WAIT_MS): the waiting PowerShell is stopped and the
  // answer is { started: false, unanswered: true }.
  run(file, { waitMs = UAC_WAIT_MS, onStarted = () => {} } = {}) {
    const ps = 'try { $p = Start-Process -FilePath $env:DH_FILE -WorkingDirectory (Split-Path $env:DH_FILE) -PassThru -ErrorAction Stop; $null = $p.Handle; [Console]::Out.WriteLine("started|$($p.Id)"); [Console]::Out.Flush(); $p.WaitForExit(); "exit|$($p.ExitCode)" } catch { "error|$($_.Exception.Message)" }';
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, env: { ...process.env, DH_FILE: file } });
      let out = '', started = false, gaveUp = false;
      const timer = setTimeout(() => {
        if (started) return;
        gaveUp = true;
        try { execFile('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch {}
        resolve({ started: false, unanswered: true, error: "Windows' permission box was not answered" });
      }, waitMs);
      timer.unref?.();
      p.stdout.on('data', (c) => { out += c; if (!started && /(^|\n)started\|/.test(out)) { started = true; clearTimeout(timer); try { onStarted(); } catch {} } });
      p.on('exit', () => {
        clearTimeout(timer);
        if (gaveUp) return;
        const last = out.trim().split(/\r?\n/).filter((l) => !/^started\|/.test(l)).pop() || '';
        const [kind, ...rest] = last.split('|'), msg = rest.join('|');
        if (kind === 'exit') resolve({ started: true, exitCode: Number(msg) });
        else resolve({ started: false, declined: /cancel/i.test(msg), error: msg || 'the installer did not start' });
      });
    });
  },
  // installed programs from Windows' Apps list (the Uninstall keys): [{ name, version }]
  installedApps() {
    const ps = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object { \"$($_.DisplayName)|$($_.DisplayVersion)\" }";
    return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, out) => {
      resolve(String(out || '').split(/\r?\n/).filter(Boolean).map((l) => { const [name, version] = l.split('|'); return { name, version: version || null }; }));
    }));
  },
  exists: (f) => fs.existsSync(f),
};

// ---- status ----
// Windows' Apps list is ~5 s of PowerShell (measured 26 Oct 2026): the last answer is kept (helpers/last-answer.js),
// read again in the background once it is 5 minutes old, and kept on disk with only the entries for these tools (never
// the rest of the PC's programs). Settings' and Setup's Check ask with fresh and wait; an install's own check is fresh,
// and every install that ends makes the next ask wait for a new read.
const appsAnswer = require('./last-answer.js').lastAnswer({ name: 'installers', staleMs: 5 * 60e3, read: () => deps.installedApps().catch(() => []),
  toDisk: (list) => list.filter((a) => TOOLS.some((t) => t.uninstallName.test(a.name || ''))).map((a) => ({ name: a.name, version: a.version || null })) });
const apps = (fresh) => appsAnswer.get(fresh);
// installed: the file DeviceHub uses is there (what counts), else Windows' Apps list names it
export async function status({ fresh = false } = {}) {
  const list = await apps(fresh);
  return TOOLS.map((t) => {
    const app = list.find((a) => t.uninstallName.test(a.name || ''));
    const has = deps.exists(t.marker);
    return { id: t.id, name: t.name, adds: t.adds, page: t.page, installed: has || !!app, version: app?.version || null,
      partial: !has && !!app ? `Windows lists ${t.name}, but ${path.basename(t.marker)} is not where DeviceHub looks (${path.dirname(t.marker)})` : null,
      offer: offerOf(t), bundled: fromBundle(t) };
  });
}

// ---- plan: what the confirm dialog shows ----
const sizes = new Map();
export async function plan(id) {
  const t = tool(id);
  if (!t) throw new Error('no such tool');
  if (fromBundle(t)) {
    return {
      id: t.id, name: t.name, version: t.version, adds: t.adds, page: t.page,
      file: t.file, url: t.url, source: new URL(t.url).hostname, folder: path.dirname(t.bundled), bundled: true,
      size: bundleOf('equalizerapo')?.size ?? t.approxBytes, sizeExact: true, sizeNote: null,
      check: 'Its SHA-256 must match the one pinned when this DeviceHub was built from the official download; checked again just before it runs',
      offer: 'install', after: t.after, restart: t.restart,
    };
  }
  let size = sizes.get(t.id)?.size ?? null, sizeNote = null;
  if (size == null) {
    try { const r = await deps.head(t); size = r.size; if (size) sizes.set(t.id, { size, at: Date.now() }); } catch (e) { sizeNote = e.message; }
  }
  const check = t.signer ? `Windows checks its digital signature is valid and from ${t.signerName || t.signer.source}` + (t.sha256 ? ', or that it matches the SHA-256 the maker publishes' : '')
    : t.sha256 ? 'It must match the SHA-256 the maker publishes' : null;
  return {
    id: t.id, name: t.name, version: t.version, adds: t.adds, page: t.page,
    file: t.file, url: t.url, source: new URL(t.url).hostname, folder: DIR,
    size: size ?? t.approxBytes, sizeExact: size != null, sizeNote,
    check: check || 'Its maker does not sign it or publish a checksum, so DeviceHub cannot check a download and only opens the official page',
    offer: offerOf(t),
    after: t.after, restart: t.restart,
  };
}

// ---- verify ----
export async function verify(id, file) {
  const t = tool(id);
  if (t.signer) {
    const s = await deps.signature(file);
    if (s.status === 'Valid' && t.signer.test(s.signer || '')) return { ok: true, how: `signed by ${cn(s.signer)}` };
    if (!t.sha256) return { ok: false, why: s.status === 'Valid' ? `it is signed by ${cn(s.signer)}, not by ${t.name}'s maker` : s.status === 'NotSigned' ? 'it is not digitally signed' : `its signature is not valid (${s.status})` };
  }
  if (t.sha256) {
    const h = await deps.sha256(file);
    const whose = t.pinned ? 'pinned from its official download' : 'the maker publishes';
    if (h.toLowerCase() === t.sha256.toLowerCase()) return { ok: true, how: `matches the SHA-256 ${whose}` };
    return { ok: false, why: `it does not match the SHA-256 ${whose}` };
  }
  return { ok: false, why: 'there is no way to check it' };
}
const cn = (subject) => (/CN=("?)([^,"]+)\1/.exec(subject || '')?.[2] || subject || 'nobody');

// ---- install: download, verify, run, re-check. One at a time; progress for GET /api/installers/progress ----
let progress = null;
export const getProgress = () => progress;
const step = (t, text, pct = null, extra = {}) => { progress = { tool: t.id, name: t.name, text, pct, done: false, at: Date.now(), ...extra }; };
const finish = (t, ok, text, extra = {}) => { appsAnswer.invalidate(); progress ={ tool: t.id, name: t.name, text, pct: null, done: true, ok, at: Date.now(), ...extra }; return progress; };

// the maker's installer behind Windows' prompt: UAC_LINE while Windows asks, the next step once it was answered Yes;
// declined or not answered: recorded (helpers/uac.mjs, Get help reports it) and the result says so with Try again
async function runInstaller(t, file, v) {
  step(t, UAC_LINE, null, { verified: v.how, uac: 'waiting' });
  const r = await deps.run(file, { onStarted: () => { recordUac({ area: 'installers', action: `install ${t.name}`, outcome: 'yes' }); step(t, `${t.name}'s installer is open: follow it`, null, { verified: v.how }); } });
  if (r.started) return { r };
  if (r.unanswered || r.declined) {
    const outcome = r.unanswered ? 'unanswered' : 'declined';
    recordUac({ area: 'installers', action: `install ${t.name}`, outcome });
    return { done: finish(t, false, (outcome === 'declined' ? declinedText : unansweredText)('Not installed'), { verified: v.how, uac: outcome, retry: true }) };
  }
  return { done: finish(t, false, `Not installed: ${r.error}`, { verified: v.how }) };
}

export async function install(id) {
  const t = tool(id);
  if (!t) throw new Error('no such tool');
  if (progress && !progress.done) throw new Error(`${progress.name} is being installed; wait for it to finish`);
  if (offerOf(t) !== 'install') return finish(t, false, 'bundled' in t ? `${t.name} is not inside this copy of DeviceHub, so it is not installed from here. Open the official page instead.` : `${t.name} cannot be checked, so DeviceHub does not run it. Open the official page instead.`, { page: t.page, pageOnly: true });
  if (fromBundle(t)) return installBundled(t);
  const file = path.join(DIR, t.file);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    step(t, `Downloading ${t.file}`, 0);
    const part = `${file}.part`;
    try { fs.rmSync(part, { force: true }); } catch {}
    await deps.download(t, part, (got, size) => { const pct = size ? Math.min(100, Math.floor((got / size) * 100)) : null; if (pct !== progress?.pct) step(t, `Downloading ${t.file}`, pct); });
    fs.renameSync(part, file);
    step(t, 'Checking the download');
    const v = await verify(t, file);
    if (!v.ok) { try { fs.rmSync(file, { force: true }); } catch {} return finish(t, false, `Not installed: ${v.why}. The download was deleted; get it from the official page instead.`, { page: t.page }); }
    const ran = await runInstaller(t, file, v);
    if (ran.done) { try { fs.rmSync(file, { force: true }); } catch {} return ran.done; }
    const r = ran.r;
    step(t, 'Checking it is installed');
    const st = (await status({ fresh: true })).find((x) => x.id === t.id);
    try { fs.rmSync(file, { force: true }); } catch {}
    if (!st.installed) return finish(t, false, `${t.name}'s installer closed (code ${r.exitCode}) but it is not installed. Run it again or use the official page.`, { verified: v.how, page: t.page });
    if (t.id === 'eqapo') { try { require('./eqapo').clearApoDefault?.(path.join(ROOT, 'backups')); } catch {} }
    return finish(t, true, `${t.name} ${st.version || ''} is installed.`.replace('  ', ' '), { verified: v.how, after: t.after, restart: t.restart, partial: st.partial });
  } catch (e) {
    try { fs.rmSync(`${file}.part`, { force: true }); } catch {}
    return finish(t, false, `Not installed: ${e.message}`, { page: t.page });
  }
}

// the installer shipped inside DeviceHub: its hash checked again, then run the ordinary way (Windows' own admin prompt);
// the file stays where it is (it is part of DeviceHub) and nothing is downloaded
async function installBundled(t) {
  try {
    step(t, 'Checking the installer inside DeviceHub');
    const v = await verify(t, t.bundled);
    if (!v.ok) return finish(t, false, `Not installed: the copy inside DeviceHub fails its check (${v.why}), so it was not run. Reinstall DeviceHub, or get it from the official page.`, { page: t.page });
    const ran = await runInstaller(t, t.bundled, v);
    if (ran.done) return ran.done;
    const r = ran.r;
    step(t, 'Checking it is installed');
    const st = (await status({ fresh: true })).find((x) => x.id === t.id);
    if (!st.installed) return finish(t, false, `${t.name}'s installer closed (code ${r.exitCode}) but it is not installed. Run it again or use the official page.`, { verified: v.how, page: t.page });
    if (t.id === 'eqapo') { try { require('./eqapo').clearApoDefault?.(path.join(ROOT, 'backups')); } catch {} }
    return finish(t, true, `${t.name} ${st.version || ''} is installed.`.replace('  ', ' '), { verified: v.how, after: t.after, restart: t.restart, partial: st.partial });
  } catch (e) { return finish(t, false, `Not installed: ${e.message}`, { page: t.page }); }
}

// ---- the route ----
export async function handle(url, req, res, send, readBody) {
  const p = url.pathname;
  try {
    if (p === '/api/installers' && req.method === 'GET') return send(res, 200, { tools: await status({ fresh: url.searchParams.has('fresh') }), busy: !!(progress && !progress.done) }), true;
    if (p === '/api/installers/plan' && req.method === 'GET') return send(res, 200, await plan(url.searchParams.get('tool'))), true;
    if (p === '/api/installers/progress' && req.method === 'GET') return send(res, 200, progress || {}), true;
    if (p === '/api/installers/install' && req.method === 'POST') {
      const { tool: id } = await readBody(req);
      if (!tool(id)) return send(res, 400, { error: 'no such tool' }), true;
      if (progress && !progress.done) return send(res, 409, { error: `${progress.name} is being installed` }), true;
      // started here and answered at once (install() sets its first step before its first wait); the page follows
      // /api/installers/progress
      install(id).catch(() => {});
      return send(res, 200, { started: true }), true;
    }
  } catch (e) { return send(res, 400, { error: e.message }), true; }
  return false;
}
