// "Get help" in one click (22 Oct 2026; docs/handoff/get-help.md; the owner: someone stuck without Claude can ask for
// help). It builds a short plain report about one device (or DeviceHub in general), takes out anything personal, shows
// it on the page in full, and only after the person's click opens a filled-in new issue on GitHub in their default
// browser. DeviceHub sends nothing itself: the person reads it on GitHub and presses Submit there.
//
//   GET  /api/help/report?id=<device>   (no id: DeviceHub in general) -> { ok, title, body, url, token, length,
//        removed: [{ why, count }], logShown, logLeftOut, cut } or { ok: false, title, body, refused: [{ line, why }] }
//   POST /api/help/open { token }       opens the link made for that report (its personal-data check run again first)
//
// What is in it: DeviceHub's version, the Windows version, the device's name, status and USB vid:pid with Windows' name
// for each, which driver runs it (built in, a library entry with its status, or learned on this PC), what
// helpers/diagnose.mjs found, and the last few log lines about it. The personal-data check is Share's own
// (helpers/share-device.mjs personalText: paths with a user's name, serial numbers, device instance ids, MAC addresses,
// e-mail addresses, this PC's user and computer names), plus IP addresses. Each of those is first replaced
// (C:\Users\<name> -> %USERPROFILE%, a serial -> <removed>, ...); if the check still finds one, nothing can be opened.
// The link stays within GitHub's limit (MAX_URL, as Share): log lines are dropped first, oldest first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diagnose, deviceProfile } from './diagnose.mjs';
import { personalText, personalNames, UPSTREAM } from './share-device.mjs';
import { MAX_URL } from './share-route.mjs';
import { devicehubVersion, driverFileOf } from './device-library.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;
export const ISSUES = `${UPSTREAM}/issues/new`;
export { MAX_URL };
const LOG_LINES = 12;     // at most this many log lines, before trimming to fit the link
const LINE_MAX = 200;     // each log line cut to this many characters

// root: the DeviceHub folder; names: extra personal names (tests); open(url): opens the default browser (tests replace it)
export const options = { root: ROOT, names: [], open: openInBrowser };

// ---------- personal data: take it out, then check nothing is left ----------
// IP addresses (Share's check has none): IPv4 other than loopback and 0.0.0.0, and IPv6 written out in full or with ::
const IPV4 = /(?<![\w.])(?!127\.0\.0\.1(?![\w]|\.\d))(?!0\.0\.0\.0(?![\w]|\.\d))(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?![\w]|\.\d)/g;
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:)+:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?)(?![\w:])/gi;
const EXTRA = [[new RegExp(IPV4.source), 'an IP address'], [new RegExp(IPV6.source, 'i'), 'an IP address']];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEG = '[^\\\\/\'"`\\s:*?<>|]+';   // one path part without spaces (a regex source; Windows never allows : * ? < > | in one)

// replaces each personal thing with a plain stand-in; { text, removed: { why: count } }
export function strip(text, names = []) {
  let t = String(text ?? '');
  const removed = {};
  const rep = (re, to, why) => { t = t.replace(re, (...m) => { removed[why] = (removed[why] || 0) + 1; return typeof to === 'function' ? to(...m) : to; }); };
  // the WHOLE path after the user folder goes (final audit, 22 Oct 2026: folder and file names can be personal too);
  // a folder name with spaces is taken while another \ follows it, a last name with spaces while it ends in .ext
  rep(new RegExp(`[A-Za-z]:[\\\\/]+Users[\\\\/]+(?!(?:Public|Default)\\b)${SEG}(?:[\\\\/]+(?:${SEG}(?: ${SEG})*(?=[\\\\/])|${SEG}(?: ${SEG})*\\.[A-Za-z0-9]{1,6}(?![\\w.])|${SEG})?)*`, 'gi'),
    (m) => (/^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+$/i.test(m) ? '%USERPROFILE%' : '%USERPROFILE%\\<path>'), 'your Windows user folder');
  rep(/\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^/'"`\s]*)*/g, (m) => (/^\/(?:Users|home)\/[^/]+$/.test(m) ? '/<user folder>' : '/<user folder>/<path>'), 'your user folder');
  rep(/(VID_[0-9A-F]{4}&PID_[0-9A-F]{4})(?:&MI_[0-9A-F]{2})?[\\#]+[^\s'"`\\#]{4,}/gi, (m, a) => `${a} (instance id removed)`, 'a device serial number');
  rep(/(serial(?:\s*(?:number|no|#))?['"`]?\s*[:=]\s*['"`]?)[A-Za-z0-9-]{4,}/gi, (m, a) => `${a}<removed>`, 'a serial number');
  rep(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi, '<address>', 'a MAC address');
  rep(/[A-Za-z0-9._%+-]+@(?!(?:example\.(?:com|org)|localhost)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>', 'an e-mail address');
  rep(IPV4, '<IP address>', 'an IP address');
  rep(IPV6, '<IP address>', 'an IP address');
  for (const n of names) rep(new RegExp(`(^|[^A-Za-z0-9])${esc(n)}(?=[^A-Za-z0-9]|$)`, 'gim'), (m, a) => `${a}<name>`, "this PC's user or computer name");
  return { text: t, removed };
}

// Share's own check, line by line, plus IP addresses: [{ line, why }] (empty = nothing personal found)
export function findPersonal(text, names = []) {
  const rules = [...personalText(names), ...EXTRA];
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((l, i) => { for (const [re, why] of rules) if (re.test(l)) out.push({ line: i + 1, why }); });
  return out;
}

// ---------- the link ----------
export const issueUrl = (title, body) => `${ISSUES}?${new URLSearchParams({ title, body }).toString().replace(/\+/g, '%20')}`;
const fence = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// facts -> the issue's title and body, with `logs` log lines and findings cut to `whyMax` characters
function compose(f, { logs, whyMax = 400, findingsMax = 8 }) {
  const d = f.device;
  const L = [];
  L.push('**What I was doing, and what went wrong:** (write it here)', '');
  L.push('### This PC', `- DeviceHub: ${f.version}`, `- Windows: ${f.windows}`, '');
  if (d) {
    L.push('### The device', `- Name: ${d.title} (${d.kind})`, `- Status: ${d.status}`);
    if (d.error) L.push(`- Error: ${d.error}`);
    L.push(`- USB: ${d.usb.length ? d.usb.map((u) => `${u.id} ${u.name || u.label}${u.present === true ? ', plugged in' : u.present === false ? ', not plugged in' : ''}`).join('; ') : 'no USB ids known for it'}`);
    L.push(`- Driver: ${d.driver}`);
    for (const [k, v] of d.info) L.push(`- ${k}: ${v}`);
    L.push('');
  } else if (f.devices?.length) {
    L.push('### Devices', ...f.devices.map((x) => `- ${x.title} (${x.id}): ${x.status}${x.error ? `, ${x.error}` : ''}`), '');
  }
  if (f.findings?.length) {
    L.push('### What DeviceHub found');
    f.findings.slice(0, findingsMax).forEach((x, i) => {
      const why = x.why.length > whyMax ? `${x.why.slice(0, whyMax - 1)}…` : x.why;
      L.push(`${i + 1}. **${x.problem}.** ${why} Fix it says: ${x.fix}`);
    });
    L.push('');
  }
  const shown = logs > 0 ? f.log.slice(-logs) : [];
  if (shown.length) {
    const text = shown.join('\n'), fn = fence(text);
    L.push(`### Log (the last ${plural(shown.length, 'line')}${d ? ' about this device' : ''})`, `${fn}text`, text, fn, '');
  }
  L.push("Made with DeviceHub's Get help button. DeviceHub sent nothing; the person who opened this pressed Submit.");
  return L.join('\n');
}

// the issue within MAX_URL: log lines dropped first (oldest first), then shorter findings, then the body cut
export function makeIssue(f, { names = [], max = MAX_URL } = {}) {
  const s = (x) => strip(x, names);
  const tally = {};
  const add = (r) => { for (const [k, v] of Object.entries(r.removed)) tally[k] = (tally[k] || 0) + v; return r.text; };
  const title = add(s(f.title));
  // every part stripped before it is put together, so a cut can never split a stand-in
  const g = JSON.parse(JSON.stringify(f));
  g.log = (g.log || []).map((l) => add(s(l)));
  for (const x of g.findings || []) for (const k of ['problem', 'why', 'fix']) x[k] = add(s(x[k]));
  if (g.device) {
    for (const k of ['title', 'kind', 'status', 'error', 'driver']) if (g.device[k]) g.device[k] = add(s(g.device[k]));
    g.device.usb = g.device.usb.map((u) => ({ ...u, name: u.name ? add(s(u.name)) : u.name, label: add(s(u.label || '')) }));
    g.device.info = g.device.info.map(([k, v]) => [add(s(k)), add(s(v))]);
  }
  for (const x of g.devices || []) for (const k of ['title', 'status', 'error']) if (x[k]) x[k] = add(s(x[k]));
  g.version = add(s(g.version)); g.windows = add(s(g.windows));

  let logs = g.log.length, body = compose(g, { logs }), url = issueUrl(title, body), cut = false;
  while (url.length > max && logs > 0) { logs--; body = compose(g, { logs }); url = issueUrl(title, body); }
  if (url.length > max) { body = compose(g, { logs: 0, whyMax: 160, findingsMax: 3 }); url = issueUrl(title, body); }
  if (url.length > max) {
    // cut the body to the longest start that fits (binary search on characters; the encoded length grows with it)
    const tail = "\n\n(Cut to fit GitHub's link limit.)";
    let lo = 0, hi = body.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (issueUrl(title, body.slice(0, mid) + tail).length <= max) lo = mid; else hi = mid - 1; }
    body = body.slice(0, lo) + tail; url = issueUrl(title, body); cut = true;
  }
  const refused = [...findPersonal(title, names).map((x) => ({ ...x, line: 0 })), ...findPersonal(body, names)];
  const removed = Object.entries(tally).map(([why, count]) => ({ why, count }));
  if (refused.length) return { ok: false, title, body, removed, refused };
  return { ok: true, title, body, url, length: url.length, removed, logShown: logs, logLeftOut: g.log.length - logs, cut };
}

// ---------- the facts (read-only) ----------
const run = (file, args, ms = 5000) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: ms }, (e, out) => resolve(e && !out ? '' : String(out || ''))));
const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t)); };

export async function windowsVersion() {
  const rel = os.release();   // 10.0.22631
  const build = Number(rel.split('.')[2]) || 0;
  const name = os.platform() !== 'win32' ? `${os.type()} ${rel}` : build >= 22000 ? 'Windows 11' : 'Windows 10';
  let display = '';
  if (os.platform() === 'win32') display = (/DisplayVersion\s+REG_SZ\s+(\S+)/.exec(await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'DisplayVersion'])) || [])[1] || '';
  return `${name}${display ? ` ${display}` : ''} (build ${build || rel})`;
}
async function getJson(port, p, ms = 10000) {
  try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; }
}
function logTail(root) {
  const lines = [];
  for (const f of ['server.old.log', 'server.log']) {
    try {
      const file = path.join(root, f), size = fs.statSync(file).size, n = Math.min(size, 256 * 1024);
      const fd = fs.openSync(file, 'r'), b = Buffer.alloc(n);
      try { fs.readSync(fd, b, 0, n, size - n); } finally { fs.closeSync(fd); }
      lines.push(...b.toString('utf8').split(/\r?\n/).slice(n < size ? 1 : 0));
    } catch {}
  }
  return lines;
}
// the lines about this device (its id, its added folder, its title, its USB vendor ids) and DeviceHub's own problems
const NOISE = /no cable change|^\[agent\] running$|^DeviceHub on http|^\[setup\] auto setup: 0 installed, 0 offered|^\[launcher\] .* exited with code -1;|^\[backups\]/;
const PROBLEM = /^\[(helper|watchdog)\]|\b(error|fail(ed|s)?|cannot|could not|refused|crash(ed)?|timed out)\b|exited with code (?!-1;)/i;
const WIDE = /^\[(helper|watchdog)\]|^\[launcher\] .* exited with code (?!-1;)|^\[launcher\] .* the new version stopped/;
export function relevantLog(lines, d) {
  const terms = [];
  if (d) {
    terms.push(new RegExp(`\\[${esc(d.id)}\\]|\\b${esc(d.id)}\\b`, 'i'));
    if (d.plugin) terms.push(new RegExp(esc(d.plugin), 'i'));
    if (d.title && d.title.length >= 4) terms.push(new RegExp(esc(d.title), 'i'));
    for (const v of d.vids || []) terms.push(new RegExp(`(VID_|\\b)${esc(v)}\\b`, 'i'));
  }
  // for a device: its own lines and DeviceHub-wide trouble (the helper, crashes); in general: every problem line
  const keep = d ? (l) => WIDE.test(l) || terms.some((re) => re.test(l)) : (l) => PROBLEM.test(l);
  return lines.map((l) => l.trimEnd()).filter((l) => l && !NOISE.test(l) && keep(l))
    .map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX - 1)}…` : l))
    // a line seen more than once is kept once, where it was last seen, with how many times
    .reduceRight((out, l) => { const seen = out.find((x) => x.l === l); if (seen) seen.n++; else out.unshift({ l, n: 1 }); return out; }, [])
    .map(({ l, n }) => (n > 1 ? `${l} (${n} times)` : l))
    .slice(-LOG_LINES);
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export function driverOf(snap, root = ROOT) {
  const a = snap.adapter || {};
  if (!a.plugin) {
    if (snap.id === 'headset' && (a.mode === 'generic' || a.generic)) return 'built into DeviceHub (sound-only mode for any USB headset)';
    if (snap.id === 'keyboard' && /VIA/i.test(snap.info?.Protocol || '')) return 'built into DeviceHub (VIA)';
    return 'built into DeviceHub';
  }
  const dir = path.join(root, 'my-devices', a.plugin);
  const file = driverFileOf(dir) || 'no driver file';
  const mark = readJson(path.join(dir, 'library.json'));
  const off = a.library?.turnOn ? ', settings not turned on yet' : '';
  if (!mark) return `added on this PC by hand (my-devices, ${file})`;
  if (mark.learned) return `learned on this PC with the learning wizard (${file}, status ${mark.status || 'read-only'}${off})`;
  return `from the device library: ${mark.name || a.plugin} (status ${mark.status || 'unknown'}${mark.libraryTested ? `, tested ${mark.libraryTested}` : ''}${off})`;
}
// device info worth sending (firmware, connection, model); nothing that names one unit
const INFO_SKIP = /serial|address|\bmac\b|instance|path|user|owner|name$/i;
const infoOf = (info) => Object.entries(info || {}).filter(([k, v]) => !INFO_SKIP.test(k) && v != null && typeof v !== 'object').slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 80)]);
async function pluginHid(root, name) {
  const dir = path.join(root, 'my-devices', name);
  if (fs.existsSync(path.join(dir, 'device.mjs'))) {
    try { const a = (await import(pathToFileURL(path.join(dir, 'device.mjs')).href)).default; return a?.hid || null; } catch { return null; }
  }
  return readJson(path.join(dir, 'driver.json'))?.hid || null;
}
async function liveSpecs() {
  if (!/server\.js$/i.test(process.argv[1] || '')) return [];
  try { return (await import('./hid-host.mjs')).SPECS; } catch { return []; }
}

// Bluetooth device names are often the person's own ("Sam's AirPods"), so they come out of the log lines (final audit,
// 22 Oct 2026): each name Windows knows (helpers/std-battery.js, read-only, its cached list) becomes "<Bluetooth device>".
// When the names cannot be read, every log line that mentions Bluetooth is left out instead.
export function dropBluetooth(lines, names) {
  if (!Array.isArray(names)) return lines.filter((l) => !/bluetooth/i.test(l));
  const res = [...new Set(names.filter((n) => typeof n === 'string' && n.trim().length >= 3).map((n) => n.trim()))]
    .sort((a, b) => b.length - a.length).map((n) => new RegExp(`(^|[^A-Za-z0-9])${esc(n)}(?=[^A-Za-z0-9]|$)`, 'gi'));
  return lines.map((l) => res.reduce((t, re) => t.replace(re, (m, a) => `${a}<Bluetooth device>`), l));
}
async function bluetoothNames(deps) {
  try {
    const list = await within(deps.bluetooth ? deps.bluetooth() : require('./std-battery.js').read({}), 15000);
    return Array.isArray(list) ? list.map((d) => d?.name).filter(Boolean) : null;
  } catch { return null; }
}

// deps (tests and the real run): port, version, windows, state, usb, diagnose, log, specs, bluetooth (the names' list)
export async function gather(id, deps = {}) {
  const root = deps.root || options.root;
  const port = deps.port || PORT;
  const [ver, windows, state] = await Promise.all([
    deps.version ? deps.version() : getJson(port, '/api/version', 5000).then((v) => v?.version || null),
    deps.windows ? deps.windows() : windowsVersion(),
    deps.state ? deps.state() : getJson(port, '/api/agent/state'),
  ]);
  const version = `${devicehubVersion(root)}${ver ? ` (build ${ver})` : ''}`;
  const devs = state?.devices || [];
  const f = { version, windows, at: new Date().toISOString() };
  if (!id) {
    f.title = `Help: DeviceHub ${devicehubVersion(root)}`;
    f.devices = devs.map((x) => ({ id: x.id, title: x.adapter?.title || x.id, status: x.status, error: x.error || null }));
    if (!state) f.findings = [{ problem: "DeviceHub's background part did not answer", why: 'Its device list could not be read.', fix: 'Quit DeviceHub from its tray icon and start it again.' }];
    f.log = dropBluetooth(relevantLog(deps.log ? await deps.log() : logTail(root), null), await bluetoothNames(deps));
    return f;
  }
  const snap = devs.find((x) => x.id === id);
  if (!snap) throw Object.assign(new Error(state ? `no device called "${id}"` : "DeviceHub's background part did not answer"), { code: state ? 404 : 503 });
  const a = snap.adapter || {};
  let specs = deps.specs || await liveSpecs();
  if (a.plugin && !specs.some((x) => x.id === id)) { const hid = await pluginHid(root, a.plugin); if (hid) specs = [...specs, { id, ...hid }]; }
  const profile = deviceProfile(snap, specs);
  // diagnose first: it reads Windows' USB list (fresh while the device is not connected), which the line below reuses
  const dg = await within(deps.diagnose ? deps.diagnose(id) : diagnose(id, { port }), 90000).catch(() => null);
  const usbList = await within(deps.usb ? deps.usb() : require('./pc-map.js').get(false).then((pc) => pc.usb).catch(() => null), 45000);
  const byId = new Map((usbList || []).map((u) => [u.id || `${u.vid}:${u.pid}`, u.name || null]));
  const kind = String(a.kind || 'device').toLowerCase();
  f.device = {
    id, title: a.title || id, kind, status: snap.status, error: snap.error || null,
    usb: profile.usb.map((u) => ({ id: u.id, label: u.label, name: byId.get(u.id) || null, present: usbList ? byId.has(u.id) : null })),
    driver: driverOf(snap, root),
    info: infoOf(snap.info),
  };
  f.title = `Help: ${f.device.title}${profile.usb[0] ? ` (${profile.usb[0].id})` : ''}, ${snap.status === 'connected' ? 'connected' : snap.status === 'asleep' ? 'asleep' : 'not connected'}`;
  f.findings = (dg?.findings || []).map((x) => ({ problem: x.problem, why: x.why, fix: x.fix }));
  if (!dg) f.findings = [{ problem: 'The checks did not finish', why: 'DeviceHub could not finish looking for the cause in time.', fix: 'Try Get help again in a minute.' }];
  f.log = dropBluetooth(relevantLog(deps.log ? await deps.log() : logTail(root), { id, plugin: a.plugin, title: a.title, vids: profile.vids }), await bluetoothNames(deps));
  return f;
}

// ---------- made reports, by token, so the browser can only open a link DeviceHub built and checked ----------
const made = new Map();   // token -> { url, at }
const KEEP_MS = 30 * 60e3;
// exported for "Works on my device" (helpers/works-report.mjs): its link opens through the same open() below
// check(text, names) -> [{ why }]: its own personal-data check for open() (works-report: a firmware version is not an IP)
export function rememberLink(url, check = null) { return remember(url, check); }
function remember(url, check = null) {
  const now = Date.now();
  for (const [k, v] of made) if (now - v.at > KEEP_MS || made.size > 20) made.delete(k);
  const token = crypto.randomBytes(12).toString('hex');
  made.set(token, { url, at: now, check: typeof check === 'function' ? check : null });
  return token;
}

export async function report(id, deps = {}) {
  const f = await gather(id ? String(id) : '', deps);
  const r = makeIssue(f, { names: personalNames([...(options.names || []), ...(deps.names || [])]) });
  return r.ok ? { ...r, token: remember(r.url) } : r;
}

// only a link this module made, to GitHub's new-issue page, within the limit, plain URL characters, checked again
export const SAFE_URL = /^[A-Za-z0-9%._~&=?/:*+-]+$/;
export async function open(token, deps = {}) {
  const m = typeof token === 'string' ? made.get(token) : null;
  if (!m || Date.now() - m.at > KEEP_MS) return { ok: false, error: 'That report is too old: press Get help again.' };
  const u = m.url;
  if (!u.startsWith(`${ISSUES}?`) || u.length > MAX_URL || !SAFE_URL.test(u)) return { ok: false, error: 'That link is not one DeviceHub can open.' };
  const q = new URL(u).searchParams;
  const names = personalNames([...(options.names || []), ...(deps.names || [])]);
  if ((m.check || findPersonal)(`${q.get('title')}\n${q.get('body')}`, names).length) return { ok: false, error: 'The report still looks personal, so it was not opened.' };
  await (deps.open || options.open)(u);
  return { ok: true, url: u };
}

// the default browser, through Windows' own Start-Process (ShellExecute): the URL is a single-quoted literal with
// nothing but plain URL characters in it (SAFE_URL; URLSearchParams encodes every quote)
export function openInBrowser(u) {
  if (!SAFE_URL.test(u)) throw new Error('not a plain link');
  const ps = `Start-Process '${u}'`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`the browser did not open (code ${code})`))));
  });
}

// server.js: if (url.pathname.startsWith('/api/help/')) ... handle(url, req, res, send, readBody); true when it answered
export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/help/')) return false;
  const port = req.socket?.localPort || PORT;
  try {
    if (url.pathname === '/api/help/report' && req.method === 'GET') { send(res, 200, await report(url.searchParams.get('id'), { port })); return true; }
    // "Works on my device" (helpers/works-report.mjs): the record to show; it opens through /api/help/open like a report
    if (url.pathname === '/api/help/works' && req.method === 'GET') { const r = await (await import('./works-report.mjs')).report(url.searchParams.get('id'), { port }); send(res, 200, r); return true; }
    if (url.pathname === '/api/help/open' && req.method === 'POST') { const r = await open((await readBody(req))?.token); send(res, r.ok ? 200 : 400, r); return true; }
    send(res, 404, { error: 'no such help route' });
  } catch (e) { send(res, e.code === 404 ? 404 : e.code === 503 ? 503 : 400, { error: e.message }); }
  return true;
}

// node helpers/get-help.mjs [device]: the report as it would show, read-only; opens nothing
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  report(process.argv[2] || '').then((r) => {
    console.log(`${r.title}\n\n${r.body}\n`);
    if (r.removed?.length) console.log(`Taken out: ${r.removed.map((x) => `${x.why} (${x.count})`).join(', ')}`);
    if (!r.ok) console.log(`Would not open: ${r.refused.map((x) => `line ${x.line}: ${x.why}`).join('; ')}`);
    else console.log(`Link: ${r.length} characters (limit ${MAX_URL})${r.logLeftOut ? `, ${r.logLeftOut} log lines left out to fit` : ''}`);
  }, (e) => { console.error(e.message); process.exitCode = 1; });
}
