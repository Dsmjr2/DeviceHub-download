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
// Since 24 Oct 2026 (docs/handoff/smoother-for-friends.md) every report, every area, also carries the PC's whole device
// picture (helpers/pc-picture.mjs: every USB and Bluetooth device, which driver claimed each or why none, the makers'
// apps, the library driver versions in use against shipped and cached, Windows' permission boxes not answered, the last
// 20 log lines about devices). Two versions are made: the GitHub link (MAX_URL) and Send to Shawn's (RELAY_BODY, under
// relay/worker.js's 12,000-character body), each trimmed to fit with the least useful parts going first (the picture's
// LEVELS, then the area's log lines, then shorter findings, then a cut that says so).
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
import { gather as gatherPicture, lines as pictureLines, LEVELS as PIC_LEVELS } from './pc-picture.mjs';
export const RELAY_BODY = 11500, RELAY_JSON = 15500;   // Send to Shawn: under relay/worker.js LIMITS (body 12,000, total 16,384)

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEVICEHUB_PORT) || 5577;
export const ISSUES = `${UPSTREAM}/issues/new`;
export { MAX_URL };
export const LIGHTS = 'lights';   // the Lighting page's Get help: an area, not a device
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
function compose(f, { logs, whyMax = 400, findingsMax = 8, pcLevel = 0 }) {
  const d = f.device;
  const L = [];
  L.push('**What I was doing, and what went wrong:** (write it here)', '');
  L.push('### This PC', `- DeviceHub: ${f.version}`, `- Windows: ${f.windows}`, '');
  if (d) {
    L.push('### The device', `- Name: ${d.title} (${d.kind})`, `- Status: ${d.status}`);
    if (d.error) L.push(`- Error: ${d.error}`);
    // a driver with many ids (the Logitech receivers and cables): the ones plugged in, else the first and a count
    // (22 Oct 2026, Dsmjr2/DeviceHub-support#2: one id shown "not plugged in" read as if nothing was)
    const usbOne = (u) => `${u.id} ${u.name || u.label}${u.present === true ? ', plugged in' : u.present === false ? ', not plugged in' : ''}`;
    const usbIn = d.usb.filter((u) => u.present === true), usbShown = d.usb.length > 3 ? (usbIn.length ? usbIn : d.usb.slice(0, 1)) : d.usb;
    const usbMore = d.usb.length - usbShown.length;
    L.push(`- USB: ${d.usb.length ? `${usbShown.map(usbOne).join('; ')}${usbMore ? ` (and ${usbMore} more id${usbMore === 1 ? '' : 's'} its driver knows${usbIn.length || d.usb[0].present == null ? '' : ', none plugged in'})` : ''}` : 'no USB ids known for it'}`);
    if (d.notMine) L.push(`- Its driver stepped aside: ${d.notMine}`);
    L.push(`- Driver: ${d.driver}`);
    for (const [k, v] of d.info) L.push(`- ${k}: ${v}`);
    L.push('');
  } else if (f.lights) {
    // Get help for PC lights (area "lights", helpers/lights-diagnose.js): OpenRGB, what it found, the board, the RGB ids
    L.push('### PC lights', ...f.lights, '');
  } else if (f.section) {
    // an area's Get help (Monitors, Fans, EQ, Learn, ...; AREAS below): what DeviceHub read there
    L.push(`### ${f.section.title}`, ...f.section.lines, '');
  } else if (f.devices?.length) {
    L.push('### Devices', ...f.devices.map((x) => `- ${x.title} (${x.id}): ${x.status}${x.error ? `, ${x.error}` : ''}`), '');
  }
  // where the person pressed Get help: the page, the last error it showed, the step they were on (CONTEXT_KEYS)
  if (f.context?.length) L.push('### On the page', ...f.context.map(([k, v]) => `- ${k}: ${v}`), '');
  if (f.findings?.length) {
    L.push('### What DeviceHub found');
    f.findings.slice(0, findingsMax).forEach((x, i) => {
      const why = x.why.length > whyMax ? `${x.why.slice(0, whyMax - 1)}…` : x.why;
      L.push(`${i + 1}. **${x.problem}.** ${why} Fix it says: ${x.fix}`);
    });
    L.push('');
  }
  // the PC's whole device picture (helpers/pc-picture.mjs), trimmed by pcLevel
  if (f.pc) L.push("### This PC's devices", ...pictureLines(f.pc, pcLevel), '');
  const shown = logs > 0 ? f.log.slice(-logs) : [];
  if (shown.length) {
    const text = shown.join('\n'), fn = fence(text);
    L.push(`### Log (the last ${plural(shown.length, 'line')}${d ? ' about this device' : ''})`, `${fn}text`, text, fn, '');
  }
  L.push("Made with DeviceHub's Get help button. DeviceHub sent nothing; the person who opened this pressed Submit.");
  return L.join('\n');
}

// the issue within MAX_URL: log lines dropped first (oldest first), then shorter findings, then the body cut
// maxBody: fit Send to Shawn's relay instead of the GitHub link (the body's length and its JSON, RELAY_*)
const deepStrip = (x, fn) => (typeof x === 'string' ? fn(x) : Array.isArray(x) ? x.map((y) => deepStrip(y, fn)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deepStrip(v, fn)])) : x);
export function makeIssue(f, { names = [], max = MAX_URL, maxBody = null } = {}) {
  const s = (x) => strip(x, names);
  const tally = {};
  const add = (r) => { for (const [k, v] of Object.entries(r.removed)) tally[k] = (tally[k] || 0) + v; return r.text; };
  const title = add(s(f.title));
  // every part stripped before it is put together, so a cut can never split a stand-in
  const g = JSON.parse(JSON.stringify(f));
  g.log = (g.log || []).map((l) => add(s(l)));
  for (const x of g.findings || []) for (const k of ['problem', 'why', 'fix']) x[k] = add(s(x[k]));
  if (g.device) {
    for (const k of ['title', 'kind', 'status', 'error', 'driver', 'notMine']) if (g.device[k]) g.device[k] = add(s(g.device[k]));
    g.device.usb = g.device.usb.map((u) => ({ ...u, name: u.name ? add(s(u.name)) : u.name, label: add(s(u.label || '')) }));
    g.device.info = g.device.info.map(([k, v]) => [add(s(k)), add(s(v))]);
  }
  for (const x of g.devices || []) for (const k of ['title', 'status', 'error']) if (x[k]) x[k] = add(s(x[k]));
  if (g.lights) g.lights = g.lights.map((l) => add(s(l)));
  if (g.section) g.section = { title: add(s(g.section.title)), lines: g.section.lines.map((l) => add(s(l))) };
  if (g.context) g.context = g.context.map(([k, v]) => [k, add(s(v))]);
  g.version = add(s(g.version)); g.windows = add(s(g.windows));
  if (g.pc) g.pc = deepStrip(g.pc, (x) => add(s(x)));

  const fits = (b) => (maxBody ? b.length <= maxBody && JSON.stringify({ title, body: b }).length <= RELAY_JSON : issueUrl(title, b).length <= max);
  let pcLevel = 0, logs = g.log.length, body = compose(g, { logs, pcLevel }), cut = false;
  // the least useful first: the picture's own levels, then the area's log lines, then shorter findings, then a cut
  while (!fits(body) && g.pc && pcLevel < PIC_LEVELS) { pcLevel++; body = compose(g, { logs, pcLevel }); }
  while (!fits(body) && logs > 0) { logs--; body = compose(g, { logs, pcLevel }); }
  if (!fits(body)) body = compose(g, { logs: 0, whyMax: 160, findingsMax: 3, pcLevel });
  if (!fits(body)) {
    // cut the body to the longest start that fits (binary search on characters; the encoded length grows with it)
    const tail = maxBody ? '\n\n(Cut to fit the relay.)' : "\n\n(Cut to fit GitHub's link limit.)";
    let lo = 0, hi = body.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(body.slice(0, mid) + tail)) lo = mid; else hi = mid - 1; }
    body = body.slice(0, lo) + tail; cut = true;
  }
  const url = issueUrl(title, body);
  const refused = [...findPersonal(title, names).map((x) => ({ ...x, line: 0 })), ...findPersonal(body, names)];
  const removed = Object.entries(tally).map(([why, count]) => ({ why, count }));
  if (refused.length) return { ok: false, title, body, removed, refused };
  return { ok: true, title, body, url, length: url.length, removed, logShown: logs, logLeftOut: g.log.length - logs, cut, pcLevel };
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
      const file = require('./data-dir.js').logFile(f, root), size = fs.statSync(file).size, n = Math.min(size, 256 * 1024);
      const fd = fs.openSync(file, 'r'), b = Buffer.alloc(n);
      try { fs.readSync(fd, b, 0, n, size - n); } finally { fs.closeSync(fd); }
      lines.push(...b.toString('utf8').split(/\r?\n/).slice(n < size ? 1 : 0));
    } catch {}
  }
  return lines;
}
// the lines about this device (its id, its added folder, its title, its USB vendor ids) and DeviceHub's own problems
const NOISE = /no cable change|^\[agent\] running$|^DeviceHub on http|^\[setup\] auto setup: 0 installed, 0 offered|^\[launcher\] .* exited with code (-1|1073807364|-1073741510|3221225786);|^\[backups\]/;
const PROBLEM = /^\[(helper|watchdog)\]|\b(error|fail(ed|s)?|cannot|could not|refused|crash(ed)?|timed out)\b|exited with code (?!(-1|1073807364|-1073741510|3221225786);)/i;
const WIDE = /^\[(helper|watchdog)\]|^\[launcher\] .* exited with code (?!(-1|1073807364|-1073741510|3221225786);)|^\[launcher\] .* the new version stopped/;
export function relevantLog(lines, d) {
  const terms = [];
  if (d) {
    for (const re of d.terms || []) terms.push(re);
    if (d.id) terms.push(new RegExp(`\\[${esc(d.id)}\\]|\\b${esc(d.id)}\\b`, 'i'));
    if (d.plugin) terms.push(new RegExp(esc(d.plugin), 'i'));
    if (d.title && d.title.length >= 4) terms.push(new RegExp(esc(d.title), 'i'));
    for (const v of d.vids || []) terms.push(new RegExp(`(VID_|\\b)${esc(v)}\\b`, 'i'));
  }
  // for a device: its own lines and DeviceHub-wide trouble (the helper, crashes); in general: every problem line
  // an area (d.area): its problem lines and DeviceHub-wide trouble; a routine line is left out unless it is a problem
  const keep = d?.area ? (l) => WIDE.test(l) || (PROBLEM.test(l) && terms.some((re) => re.test(l)))
    : d ? (l) => WIDE.test(l) || terms.some((re) => re.test(l)) : (l) => PROBLEM.test(l);
  const noise = d?.area ? (l) => NOISE.test(l) && !PROBLEM.test(l) : (l) => NOISE.test(l);
  return lines.map((l) => l.trimEnd()).filter((l) => l && !noise(l) && keep(l))
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
// The devices a report lists (22 Oct 2026, support issue 3): the same ones the app shows (public/core/devices.js
// shownDevices: seen on this PC before, or connected or asleep now), plus any added driver (a library or learned driver
// is installed only for a USB id this PC has, so its state always matters). DeviceHub's own slots for the Pulsar, the
// HS80 and the P75 are left out on a PC that has never had them, instead of showing "missing".
// never an added driver that found nothing of its own here (x.absent, helpers/my-devices.mjs isAbsent)
export const shownInReport = (x) => !!x && !x.absent && (x.seen === true || ['connected', 'asleep', 'connecting'].includes(x.status) || !!x.adapter?.plugin);
// gather(id, deps, { area, context }): a device's facts (area '' or 'device'), the Lighting page's ('lights'), or an
// area's (AREAS), plus what the page itself showed (context, pageContext below)
export async function gather(id, deps = {}, { area = '', context = null } = {}) {
  // the PC's whole device picture, read beside the area's own facts (deps.picture false: left out)
  const pic = deps.picture === false ? Promise.resolve(null) : picture(deps);
  const f = AREAS[area]?.facts ? await gatherArea(area, id ? String(id) : '', deps) : await gatherFacts(area === LIGHTS ? LIGHTS : id, deps);
  f.pc = await pic;
  const ctx = pageContext(context);
  if (ctx.length) {
    const bt = await bluetoothNames(deps);
    f.context = ctx.map(([k, v]) => [k, dropBluetooth([v], bt)[0]]).filter(([, v]) => v);
  }
  return f;
}
async function picture(deps) {
  const root = deps.root || options.root, port = deps.port || PORT;
  const bt = await bluetoothNames(deps);
  const lines = dropBluetooth(deps.log ? await deps.log() : logTail(root), bt);
  return within(gatherPicture({ ...deps, root, logLines: lines, state: deps.state || (deps.get ? () => deps.get('/api/agent/state') : () => getJson(port, '/api/agent/state')) }).catch(() => null), 70000);
}
async function gatherFacts(id, deps = {}) {
  const root = deps.root || options.root;
  const port = deps.port || PORT;
  const [ver, windows, state] = await Promise.all([
    deps.version ? deps.version() : getJson(port, '/api/version', 5000).then((v) => v?.version || null),
    deps.windows ? deps.windows() : windowsVersion(),
    deps.state ? deps.state() : deps.get ? deps.get('/api/agent/state') : getJson(port, '/api/agent/state'),
  ]);
  const version = `${devicehubVersion(root)}${ver ? ` (build ${ver})` : ''}`;
  const devs = state?.devices || [];
  const f = { version, windows, at: new Date().toISOString() };
  if (!id) {
    f.title = `Help: DeviceHub ${devicehubVersion(root)}`;
    f.devices = devs.filter(shownInReport).map((x) => ({ id: x.id, title: x.adapter?.title || x.id, status: x.status, error: x.error || null }));
    if (!state) f.findings = [{ problem: "DeviceHub's background part did not answer", why: 'Its device list could not be read.', fix: 'Quit DeviceHub from its tray icon and start it again.' }];
    f.log = dropBluetooth(relevantLog(deps.log ? await deps.log() : logTail(root), null), await bluetoothNames(deps));
    return f;
  }
  // the Lighting page's Get help (22 Oct 2026, a friend's fans not found): OpenRGB's version and state, the lights it
  // found, the board and every known RGB controller id plugged in, so one click tells Shawn everything
  if (id === LIGHTS) {
    const d = deps.lights ? await deps.lights() : await getJson(port, '/api/lights/diagnose', 60000);
    f.title = `Help: PC lights${d?.board ? ` (${d.board})` : ''}${d?.verdict ? `, ${d.verdict.kind === 'usb' ? 'RGB controller on USB' : d.verdict.kind === 'smbus' ? 'board SMBus' : 'no RGB controller found'}` : ''}`;
    f.lights = d?.lines?.length ? d.lines : ['- The lights check did not answer.'];
    f.findings = (d?.problems || []).map((x) => ({ problem: x.problem, why: x.why, fix: x.fix }));
    f.log = dropBluetooth(relevantLog(deps.log ? await deps.log() : logTail(root), { id: 'openrgb', title: 'PC lights' }), await bluetoothNames(deps));
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
    notMine: a.notMine || null,
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

// ---------- Get help on every screen (22 Oct 2026, docs/handoff/get-help-everywhere.md) ----------
// Shawn: "put the get help area on every screen that needs it so I can fix it and they can send the request right from
// where they are working on fixing something". Each area reads what its page reads (GET routes of this DeviceHub only,
// read-only, only when the person presses Get help), plus its recent problem lines from Activity and the log. Nothing
// that names one unit or one person: no monitor or camera ids, no profile, file or folder names.
const on = (x) => (x ? 'on' : 'off');
const num = (n, one, many) => plural(Number(n) || 0, one, many);
const RECENT = 5;   // at most this many of the area's recent problem lines from Activity
const list = (x) => (Array.isArray(x) ? x : []);
async function deviceLine(get, id) {
  if (!id) return null;
  const st = await get('/api/agent/state');
  const x = st?.devices?.find((d) => d.id === id);
  return x ? `- Device: ${x.adapter?.title || x.id} (${x.id}): ${x.status}${x.error ? `, ${x.error}` : ''}` : null;
}
export const AREAS = {
  device: { title: 'Device' },          // a device page: the device's own report (gather above)
  [LIGHTS]: { title: 'PC lights' },     // the Lighting page: the lights check (gather above)
  monitors: {
    title: 'Monitors and camera', terms: [/monitor|ddc|display|brightness|camera|webcam/i],
    async facts({ get }) {
      const [mons, cams] = await Promise.all([get('/api/monitors', 30000), get('/api/cameras', 30000)]);
      const lines = [], findings = [];
      if (!Array.isArray(mons)) lines.push('- Monitors: the list could not be read');
      else if (!mons.length) lines.push('- Monitors: none found');
      for (const m of list(mons)) {
        const ctl = [['brightness', 'brightness'], ['contrast', 'contrast'], ['volume', 'speaker volume'], ['colorPreset', 'color preset'], ['red', 'color balance']].filter(([k]) => m[k]).map(([, l]) => l);
        const how = m.builtin ? 'built-in screen, brightness through Windows' : m.ddc ? 'answers over DDC/CI' : 'no DDC/CI answer (takes no settings from the PC)';
        lines.push(`- Monitor: ${m.name || 'no name'}${m.model && m.model !== m.name ? ` (${m.model})` : ''}: ${how}${ctl.length ? `; controls ${ctl.join(', ')}` : ''}${m.away ? '; off or not answering' : ''}${list(m.waiting).length ? `; waiting: ${list(m.waiting).join(', ')}` : ''}${m.error ? `; error: ${m.error}` : ''}${list(m.supports).length ? `; lists ${list(m.supports).length} settings` : ''}`);
        if (!m.builtin && !m.ddc) findings.push({ problem: `${m.name || 'A monitor'} takes no settings from the PC`, why: 'It did not answer over DDC/CI.', fix: "Turn on DDC/CI in the monitor's own menu, then open Monitors again." });
      }
      if (!Array.isArray(cams)) lines.push('- Camera: the list could not be read');
      else if (!cams.length) lines.push('- Camera: none found');
      for (const c of list(cams)) { const k = Object.keys(c.controls || {}); lines.push(`- Camera: ${c.name || 'no name'}: ${k.length ? `${num(k.length, 'picture setting')} (${k.join(', ')})` : 'lists no picture settings'}${c.error ? `; error: ${c.error}` : ''}`); }
      return { short: Array.isArray(mons) ? `${num(mons.length, 'monitor')}, ${num(list(cams).length, 'camera')}` : 'not read', lines, findings };
    },
  },
  fans: {
    title: 'Fans', terms: [/\bgpu\b|nvidia|\bfans?\b|openrgb|lights?\b|pawnio/i],
    async facts({ get, deps }) {
      const [gpu, d] = await Promise.all([get('/api/gpu', 20000), deps.lights ? deps.lights() : get('/api/lights/diagnose', 60000)]);
      const lines = [];
      if (gpu?.available && list(gpu.gpus).length) for (const g of gpu.gpus) lines.push(`- Graphics card: ${g.name}: ${g.tempC ?? '?'} °C, fan ${g.fanPct ?? '?'}%, load ${g.loadPct ?? '?'}%`);
      else lines.push(`- Graphics card: not read (${gpu?.reason || 'no answer'})`);
      lines.push("- Fan speed: CPU and case fans follow the board's BIOS curve; DeviceHub does not set them");
      lines.push(...(list(d?.lines).length ? d.lines : ['- The lights check did not answer.']));
      return { short: d?.board || null, lines, findings: list(d?.problems).map((x) => ({ problem: x.problem, why: x.why, fix: x.fix })) };
    },
  },
  eq: {
    title: 'Sound and EQ', terms: [/\beq\b|equali[sz]er|eqapo|\bapo\b|mic (?:boost|level|filter)|sidetone|sound|speaker/i],
    async facts({ get, device }) {
      const e = await get('/api/eq', 20000);
      const lines = [], findings = [];
      const dl = await deviceLine(get, device);
      if (dl) lines.push(dl);
      if (!e) { lines.push('- The sound settings could not be read'); return { short: 'not read', lines, findings }; }
      const presets = list(e.presets), active = presets.find((p) => p.id === e.activeId);
      lines.push(`- Engine: ${e.engine === 'eqapo' ? 'Equalizer APO' : e.engine || 'none'}${e.available === false ? `, not available${e.reason ? ` (${e.reason})` : ''}` : ''}`);
      lines.push(`- Headset: ${e.headsetModel || 'none found'}; mic ${e.micFound ? 'found' : 'not found'}`);
      // the person's own preset names are left out: built-in ones are named
      lines.push(`- Presets: ${presets.length} (${presets.filter((p) => !p.builtIn).length} of your own); in use: ${!active ? 'none' : active.builtIn ? active.name : 'one of your own'}${e.unsaved ? '; a change is not saved' : ''}`);
      if (e.headroom !== undefined) lines.push(`- Prevent distortion: ${on(e.headroom)}`);
      const x = e.extras || {};
      if (Object.keys(x).length) lines.push(`- Sound tools: correction ${on(x.correction)}, loudness ${on(x.loudness)}, balance ${x.balance ?? 0}, ${num(list(x.filters).length, 'extra filter')}; mic boost ${x.micBoost ?? 0} dB, rumble ${on(x.micRumble)}, clarity ${on(x.micClarity)}, de-ess ${on(x.micDeEss)}, level ${on(x.micLevel)}`);
      if (list(e.speakers).length) lines.push(`- Speakers with their own EQ: ${e.speakers.map((s) => `${s.name} (${on(s.on)})`).join(', ')}`);
      const notOn = [...new Set(list(e.notOn).map((d) => d?.name).filter(Boolean))];
      if (notOn.length) lines.push(`- Equalizer APO is not switched on for: ${notOn.join(', ')}`);
      if (e.engine !== 'eqapo' && e.needsApo) findings.push({ problem: 'Equalizer APO is not installed', why: 'The EQ, mic boost and mic filters need it.', fix: "Install it from the Equalizer card's button on the Headset page, then restart the PC." });
      if (notOn.length) findings.push({ problem: 'Equalizer APO is not on for the headset', why: 'Its sound devices are not ticked in Equalizer APO, so the EQ is not heard.', fix: 'Press Turn on in the Equalizer card, tick them, click OK, then restart the PC.' });
      return { short: e.engine === 'eqapo' ? 'Equalizer APO' : e.engine || 'no EQ engine', lines, findings };
    },
  },
  profiles: {
    title: 'Profiles', terms: [/profile|auto-?switch/i],
    async facts({ get }) {
      const [p, s] = await Promise.all([get('/api/profiles'), get('/api/settings')]);
      const lines = [];
      if (!Array.isArray(p)) lines.push('- Profiles: the list could not be read');
      else {
        // the person's profile and game names are left out: what each one holds, by number
        lines.push(`- Profiles: ${p.length}`);
        p.slice(0, 10).forEach((x, i) => {
          const holds = [...Object.keys(x.devices || {}), ...(x.monitors && Object.keys(x.monitors).length ? ['monitors'] : []), ...Object.keys(x.added || {})];
          lines.push(`- Profile ${i + 1}: ${holds.length ? holds.join(', ') : 'no settings'}${list(x.games).length ? `; switches for ${num(x.games.length, 'game')}` : ''}${x.savedAt ? `; saved ${String(x.savedAt).slice(0, 10)}` : ''}`);
        });
      }
      if (s && typeof s === 'object') lines.push(`- Switch profiles when games start: ${on(s.autoSwitch)}`);
      return { short: Array.isArray(p) ? num(p.length, 'profile') : 'not read', lines, findings: [] };
    },
  },
  backups: {
    title: 'Backups', terms: [/backup|restore|go back|put back|setup file|undo/i],
    async facts({ get }) {
      const b = await get('/api/backups');
      const lines = [];
      if (!Array.isArray(b)) lines.push('- Backups: the list could not be read');
      else {
        const groups = new Map();
        for (const x of b) { const k = String(x?.name || '').replace(/-\d{4}-\d\d-\d\d.*$/, '').replace(/\.json$/i, '').slice(0, 40) || 'other'; const g = groups.get(k) || { n: 0, at: '' }; g.n++; if (String(x.at || '') > g.at) g.at = String(x.at || ''); groups.set(k, g); }
        lines.push(`- Copies: ${b.length} in all`);
        for (const [k, g] of [...groups].sort((x, y) => y[1].n - x[1].n).slice(0, 10)) lines.push(`- ${k}: ${g.n}${g.at ? `, newest ${g.at.slice(0, 16).replace('T', ' ')} UTC` : ''}`);
      }
      return { short: Array.isArray(b) ? num(b.length, 'copy', 'copies') : 'not read', lines, findings: [] };
    },
  },
  setup: {
    title: 'Setup', terms: [/\[setup\]|install|library|turn on settings|self-check|layout/i],
    async facts({ get, device }) {
      const s = await get('/api/setup', 30000);
      const lines = [];
      const dl = await deviceLine(get, device);
      if (dl) lines.push(dl);
      if (!s) { lines.push('- The setup list could not be read'); return { short: 'not read', lines, findings: [] }; }
      if (s.found) lines.push(`- Found: ${num(s.found.usb, 'USB device')}, ${num(s.found.library, 'library match', 'library matches')}`);
      const items = ['installed', 'works', 'optional', 'learn'].flatMap((k) => list(s[k]).map((x) => ({ ...x, group: k })));
      const open = items.filter((x) => x.state !== 'ready');
      lines.push(`- Items: ${items.length}, ${open.length} not ready`);
      for (const x of open.slice(0, 12)) lines.push(`- ${x.name || x.what || 'item'}${x.usb ? ` (USB ${x.usb})` : ''}: ${x.state || 'unknown'}${x.short || x.line ? `, ${String(x.short || x.line).slice(0, 160)}` : ''}`);
      return { short: `${open.length} not ready`, lines, findings: [] };
    },
  },
  learn: {
    title: 'Learn a device', terms: [/learn|usbpcap|capture|app-ui|wizard|driver\.json/i],
    async facts({ get }) {
      const s = await get('/api/learn/state');
      const lines = [];
      if (!s) { lines.push('- The learning wizard did not answer'); return { short: 'no answer', lines, findings: [] }; }
      lines.push(`- USBPcap: ${s.usbpcap ? 'installed' : 'not installed'}`);
      if (!s.active) { lines.push('- No learning session is open'); return { short: 'no session', lines, findings: [] }; }
      const d = s.device || {};
      const id = `${d.vid}:${d.pid}`;
      lines.push(`- Device: ${d.name || 'no name'}${String(d.name || '').toUpperCase().includes(id.toUpperCase()) ? '' : ` (USB ${id})`}${s.addsTo ? `; adds to the driver ${s.addsTo.name}` : ''}`);
      // what the device itself says (23 Oct 2026): its own product string, its HID usages, and the kind it is learned as
      if (d.product && d.product !== d.name) lines.push(`- Its own name: ${d.product}`);
      if (d.seems) lines.push(`- Its USB interfaces say: ${d.seems}`);
      if (d.kind) lines.push(`- Learned as: ${d.kind === 'mixed' ? 'not answered yet (mouse or keyboard?)' : d.kind}`);
      if (s.maker) lines.push(`- Maker's app: ${s.maker.name || 'not known'}${s.maker.known ? `, ${s.maker.installed ? 'installed' : 'not installed'}${s.maker.running ? ', open' : ''}` : ''}`);
      lines.push(`- Listening: ${s.listener}${s.listenerError ? `: ${s.listenerError}` : ''}${s.recording ? '; recording now' : ''}`);
      if (s.setting) lines.push(`- Setting being learned: ${s.setting.label || '?'} (${s.setting.kind || '?'}${s.setting.role ? `, ${s.setting.role}` : ''})`);
      // what it heard so far: each recording's value and how many messages the device and the app sent
      if (list(s.takes).length) lines.push(`- Recordings: ${s.takes.map((t) => `${t.value} (${num(t.heard, 'message')})`).join(', ')}`);
      if (list(s.learned).length) lines.push(`- Learned so far: ${s.learned.map((x) => `${x.label} (${x.kind}${x.role ? `, ${x.role}` : ''})`).join(', ')}`);
      if (s.second) lines.push(`- Other USB id: ${s.second.of}, ${s.second.done} of ${s.second.total} learned`);
      if (s.saved) lines.push(`- Saved: ${typeof s.saved === 'object' ? s.saved.name || 'yes' : 'yes'}`);
      return { short: `${d.vid}:${d.pid}, ${s.listener}`, lines, findings: [] };
    },
  },
  wallpapers: {
    title: 'Wallpapers', terms: [/wallpaper/i],
    async facts({ get }) {
      const w = await get('/api/wallpapers');
      const lines = [];
      if (!w) lines.push('- The wallpaper folder could not be read');
      else {
        // no folder or file names: they are the person's own
        lines.push(`- Pictures: ${list(w.items).length} (${Math.round((Number(w.totalBytes) || 0) / 1e5) / 10} MB)`);
        lines.push(`- Windows wallpaper can be set from here: ${w.windows ? 'yes' : 'no'}; the previous one kept: ${w.previousKept ? 'yes' : 'no'}`);
        if (w.error) lines.push(`- Error: ${w.error}`);
      }
      return { short: w ? num(list(w.items).length, 'picture') : 'not read', lines, findings: [] };
    },
  },
};
// the page's own context: these keys only, short plain strings (public/ui/get-help.js sends them on the click)
export const CONTEXT_KEYS = { page: 'Page', error: 'Shown on the page', step: 'Step', progress: 'Progress', heard: 'Heard so far', results: 'Settings so far', item: 'Row', status: 'Status shown', detail: 'Detail', listed: 'Devices on the page' };
export function pageContext(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return [];
  return Object.entries(CONTEXT_KEYS).filter(([k]) => typeof c[k] === 'string' && c[k].trim())
    .map(([k, label]) => [label, c[k].replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, k === 'results' || k === 'error' || k === 'listed' ? 900 : 300)]);
}
async function gatherArea(area, device, deps) {
  const A = AREAS[area];
  const root = deps.root || options.root, port = deps.port || PORT;
  const get = deps.get || ((p, ms) => getJson(port, p, ms));
  const [ver, windows] = await Promise.all([deps.version ? deps.version() : getJson(port, '/api/version', 5000).then((v) => v?.version || null), deps.windows ? deps.windows() : windowsVersion()]);
  const f = { version: `${devicehubVersion(root)}${ver ? ` (build ${ver})` : ''}`, windows, at: new Date().toISOString() };
  let r;
  try { r = await within(A.facts({ get, deps, device }), 90000); } catch (e) { r = { lines: [`- It could not be read: ${e.message}`] }; }
  r = r || { lines: ['- It did not answer in time.'] };
  const bt = await bluetoothNames(deps);
  // the area's recent problems from Activity (what the app showed in red), newest last
  const act = await get('/api/activity', 5000);
  const recent = list(act).filter((x) => x?.kind === 'bad' && typeof x.text === 'string' && A.terms.some((re) => re.test(x.text)))
    .sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-RECENT)
    .map((x) => `- Recently (${String(x.at || '').slice(0, 16).replace('T', ' ')} UTC): ${x.text.slice(0, 200)}`);
  f.title = `Help: ${A.title}${r.short ? ` (${r.short})` : ''}`.slice(0, 120);
  f.section = { title: A.title, lines: dropBluetooth([...list(r.lines), ...recent], bt) };
  f.findings = list(r.findings);
  f.log = dropBluetooth(relevantLog(deps.log ? await deps.log() : logTail(root), { area: true, terms: A.terms }), bt);
  return f;
}

// ---------- Request support (22 Oct 2026, Shawn: "as simple as possible"): a device DeviceHub has no driver for ----------
// One click builds a short request: the device's USB id, the name Windows gives it, its maker from the brand guide when
// known, DeviceHub's and Windows' versions. It goes through the same personal-data check and the same open path as Get
// help: shown in full first, opened in the browser only on the person's click, sent by them with Submit.
const hex4 = (x) => (/^[0-9a-f]{4}$/i.test(String(x || '')) ? String(x).toUpperCase() : null);
export function composeRequest({ vid, pid, name, brand, version, windows }) {
  const id = `${vid}:${pid}`;
  const what = name || (brand ? `${brand.name} device` : 'USB device');
  const title = `Support request: ${what} (USB ${id})`;
  const body = [
    '**Which device is it, and what would you like DeviceHub to do with it?** (write it here: the model, whether it is a mouse, headset, keyboard or light, and the settings you would like)', '',
    '### The device', `- Windows calls it: ${name || 'no name'}`, `- USB: ${id}`,
    `- Maker: ${brand ? `${brand.name}${brand.kinds?.length ? ` (${brand.kinds.join(', ')})` : ''}${brand.shared ? ', but this vendor id is a chip maker\'s, so unconfirmed' : ''}` : 'not in DeviceHub\'s brand guide'}`,
    '- DeviceHub has: no driver for it yet', '',
    '### This PC', `- DeviceHub: ${version}`, `- Windows: ${windows}`, '',
    "Made with DeviceHub's Request support button. DeviceHub sent nothing; the person who opened this pressed Submit.",
  ].join('\n');
  return { title, body };
}
export async function requestSupport(q = {}, deps = {}) {
  const vid = hex4(q.vid), pid = hex4(q.pid);
  if (!vid || !pid) { const e = new Error('vid and pid must be 4 hex digits'); e.code = 400; throw e; }
  const name = String(q.name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  let brand = null;
  try { brand = (await import('./auto-setup.mjs')).brandsByVid(options.root)[vid.toLowerCase()] || null; } catch {}
  const names = personalNames([...(options.names || []), ...(deps.names || [])]);
  const tally = {};
  const s = (x) => { const r = strip(x, names); for (const [k, v] of Object.entries(r.removed)) tally[k] = (tally[k] || 0) + v; return r.text; };
  const f = composeRequest({ vid, pid, name: name ? s(name) : '', brand, version: s(devicehubVersion(options.root)), windows: s(deps.windows || await windowsVersion()) });
  const removed = Object.entries(tally).map(([why, count]) => ({ why, count }));
  const refused = [...findPersonal(f.title, names).map((x) => ({ ...x, line: 0 })), ...findPersonal(f.body, names)];
  if (refused.length) return { ok: false, ...f, removed, refused };
  const url = issueUrl(f.title, f.body);
  return { ok: true, ...f, url, length: url.length, removed, token: remember(url) };
}

// ---------- made reports, by token, so the browser can only open a link DeviceHub built and checked ----------
const made = new Map();   // token -> { url, at }
const KEEP_MS = 30 * 60e3;
// exported for "Works on my device" (helpers/works-report.mjs): its link opens through the same open() below
// check(text, names) -> [{ why }]: its own personal-data check for open() (works-report: a firmware version is not an IP)
export function rememberLink(url, check = null) { return remember(url, check); }
// issue: { title, body, area, device } of a Get help report, for Send to Shawn (helpers/support-request.mjs sendHelp)
function remember(url, check = null, issue = null) {
  const now = Date.now();
  for (const [k, v] of made) if (now - v.at > KEEP_MS || made.size > 20) made.delete(k);
  const token = crypto.randomBytes(12).toString('hex');
  made.set(token, { url, at: now, check: typeof check === 'function' ? check : null, issue });
  return token;
}
// the report a token was made for, while it is fresh (null when unknown or too old)
export function reportFor(token) {
  const m = typeof token === 'string' ? made.get(token) : null;
  return m && m.issue && Date.now() - m.at <= KEEP_MS ? m.issue : null;
}
// Send to Shawn is offered where this copy sends problem reports (helpers/auto-report.mjs: started, relay set up, on,
// not the owner's PC); anywhere else the report opens on GitHub as before
export async function canSend() {
  try { const ar = await import('./auto-report.mjs'); return ar.isStarted() && (await ar.status()).active; } catch { return false; }
}

// how: { area, context } (POST /api/help/report): an area's report (AREAS) and what the page showed
export async function report(id, deps = {}, how = {}) {
  const area = AREAS[how.area] ? how.area : '';
  id = id ? String(id).slice(0, 80) : '';
  const f = await gather(id, deps, { area, context: how.context });
  const names = personalNames([...(options.names || []), ...(deps.names || [])]);
  const r = makeIssue(f, { names });
  if (!r.ok) return r;
  // Send to Shawn carries more than the link can: its own version, fitted to the relay
  const relay = makeIssue(f, { names, maxBody: RELAY_BODY });
  const where = area && area !== 'device' ? { area, device: area === LIGHTS ? null : id || null }
    : id === LIGHTS ? { area: LIGHTS, device: null } : id ? { area: 'device', device: id } : { area: 'devicehub', device: null };
  return { ...r, relayLength: relay.ok ? relay.body.length : null, canSend: deps.canSend ? await deps.canSend() : await canSend(), token: remember(r.url, null, { title: r.title, body: relay.ok ? relay.body : r.body, ...where }) };
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

// a Request support kept for "Your device is supported now" (helpers/support-wait.mjs); a failure never stops the request
async function wanted(q) { try { (await import('./support-wait.mjs')).remember(q?.vid, q?.pid, q?.name); } catch {} }

// server.js: if (url.pathname.startsWith('/api/help/')) ... handle(url, req, res, send, readBody); true when it answered
export async function handle(url, req, res, send, readBody) {
  if (!url.pathname.startsWith('/api/help/')) return false;
  const port = req.socket?.localPort || PORT;
  try {
    if (url.pathname === '/api/help/report' && req.method === 'GET') { send(res, 200, await report(url.searchParams.get('id'), { port })); return true; }
    // Get help on a page (public/ui/get-help.js): { id, area, context }; built only on the person's click
    if (url.pathname === '/api/help/report' && req.method === 'POST') { const b = (await readBody(req)) || {}; send(res, 200, await report(typeof b.id === 'string' ? b.id : '', { port }, { area: typeof b.area === 'string' ? b.area : '', context: b.context })); return true; }
    // Send to Shawn: that report through the relay (helpers/support-request.mjs sendHelp); else it opens on GitHub
    if (url.pathname === '/api/help/send' && req.method === 'POST') { const b = (await readBody(req)) || {}; send(res, 200, await (await import('./support-request.mjs')).sendHelp(b.token)); return true; }
    // "Works on my device" (helpers/works-report.mjs): the record to show; it opens through /api/help/open like a report
    if (url.pathname === '/api/help/works' && req.method === 'GET') { const r = await (await import('./works-report.mjs')).report(url.searchParams.get('id'), { port }); send(res, 200, r); return true; }
    // "Test it with me" (helpers/guided-test.mjs): the person's answers, kept on this PC for the works record
    if (url.pathname === '/api/help/tried' && req.method === 'GET') { send(res, 200, await (await import('./guided-test.mjs')).getTried(url.searchParams.get('id'), { port })); return true; }
    if (url.pathname === '/api/help/tried' && req.method === 'POST') { send(res, 200, await (await import('./guided-test.mjs')).postTried((await readBody(req)) || {}, { port })); return true; }
    // the device asked about is remembered on this PC, so the Overview can say when a driver for it arrives (helpers/support-wait.mjs)
    if (url.pathname === '/api/help/request' && req.method === 'GET') { const q = { vid: url.searchParams.get('vid'), pid: url.searchParams.get('pid'), name: url.searchParams.get('name') }; const r = await requestSupport(q); if (r?.ok) await wanted(q); send(res, 200, r); return true; }
    // Request support in one click through the relay (helpers/support-request.mjs); fallback: true = use the request above
    if (url.pathname === '/api/help/request/send' && req.method === 'POST') { const b = (await readBody(req)) || {}; const r = await (await import('./support-request.mjs')).send({ vid: b.vid, pid: b.pid, name: b.name }); if (r.sent || r.queued) await wanted(b); send(res, r.bad ? 400 : 200, r); return true; }
    if (url.pathname.startsWith('/api/help/supported-now') && await (await import('./support-wait.mjs')).handle(url, req, res, send, readBody)) return true;
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
