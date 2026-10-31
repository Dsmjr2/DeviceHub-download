// Problem reports that send themselves (22 Oct 2026; docs/handoff/auto-report.md; the owner: when DeviceHub hits a real
// problem on a friend's PC, a report reaches Shawn by itself, with no click and nothing for the friend to review).
//
// A real fault only: DeviceHub stopped and its launcher started it again; the background part did not start; the
// device helper could not be built or started, or keeps restarting; a device the PC has plugged in that stays in an
// error for over 10 minutes; a write whose read-back did not match; a library or learned driver whose self-check
// failed. Never: asleep, switched off, unplugged, the maker's app open, a low battery, ordinary waiting.
//
// Each report is Get help's own report for that device or area (helpers/get-help.mjs gather + makeIssue: personal data
// already taken out), its first line saying what went wrong; Get help's personal-data check runs again on the final
// body, a flagged line is dropped, and if anything is still flagged (or Get help refused the report) nothing is sent.
// It goes to Shawn's relay (relay/worker.js: one private GitHub issue per problem per install per day) as
// { v: 1, install, fingerprint, version, title, body }: install = a random 32-hex id made once and kept in
// settings.json (never the PC's name), fingerprint = <code>:<device id or area>.
//
// Sent only when helpers/report-config.json { "relayUrl": "https://devicehub-relay.dsmjr2.workers.dev/report" } is
// there AND settings.json "autoReport" is not false (on by default; Settings > Send problem reports to Shawn). Never
// from the owner's own PC: a copy whose git origin is Dsmjr2/DeviceHub, or settings.json "ownerPc": true (and a git
// folder whose origin cannot be read counts as the owner's, so a doubt never sends). At most one send per problem per
// day here too (auto-report-state.json) and 10 a day in all; a failed send is tried again twice (1 and 5 minutes
// later), then dropped. HTTPS to the one relay host only, 10 s timeout, no redirects.
//
// Low CPU: no timers of its own. server.js calls start() once and hands it the helper's problems (helpers/native.js
// onProblem); the agent hands it Activity lines (read-back failures), the self-check results (helpers/my-devices.mjs)
// and the device list on its existing 30 s error retry (checkDevices).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RELAY_HOST = 'devicehub-relay.dsmjr2.workers.dev';
export const ERROR_MINUTES = 10;
const DAY_CAP = 10;
// the owner's own repository (not DeviceHub-download, the public copy friends install from)
export const OWNER_ORIGIN = /github\.com[:/]+Dsmjr2\/DeviceHub(?:\.git)?\/?$/i;

// what a report must look like (relay/worker.js checkReport; tests/auto-report.mjs checks the two agree)
export function validPayload(r) {
  return !!r && r.v === 1 && /^[a-f0-9]{16,64}$/.test(r.install) && /^[a-z0-9:._-]{1,80}$/i.test(r.fingerprint)
    && typeof r.version === 'string' && r.version.length <= 40 && typeof r.title === 'string' && r.title.length >= 3 && r.title.length <= 120
    && typeof r.body === 'string' && r.body.length >= 10 && r.body.length <= 12000 && Object.keys(r).length === 6;
}

// tests replace these; server.js passes root, port and log
export const options = {
  root: ROOT,
  port: Number(process.env.DEVICEHUB_PORT) || 5577,
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  log: (t) => console.log(`[report] ${t}`),
  retryMs: [60e3, 300e3],
  gatherDeps: null,     // get-help gather deps (tests: state, version, windows, diagnose, usb, log, bluetooth, specs)
  names: [],            // extra personal names (tests)
  owner: null,          // tests: true/false instead of looking at git and settings.json
};
let started = false;
export function start(o = {}) { Object.assign(options, o); started = true; ownerCache = null; }
export function stop() { started = false; }
export const isStarted = () => started;   // Get help offers Send to Shawn only then (helpers/get-help.mjs canSend)

// this PC's files in data\, the log in logs\ (27 Oct 2026, helpers/data-dir.js)
const file = (n) => (/\.log$/.test(n) ? require('./data-dir.js').logFile(n, options.root) : require('./data-dir.js').dataFile(n, options.root));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const writeJson = (f, o) => require('./safe-write.js').writeAtomic(f, JSON.stringify(o, null, 2));
const settings = () => readJson(file('settings.json'), {});
const day = () => new Date(options.now()).toISOString().slice(0, 10);

// ---------- may this copy send at all ----------
export function relayUrl() {
  const c = readJson(path.join(options.root, 'helpers', 'report-config.json'), null);
  if (!c || typeof c.relayUrl !== 'string') return null;
  try {
    const u = new URL(c.relayUrl);
    if (u.protocol !== 'https:' || u.hostname !== RELAY_HOST || u.port || u.username || u.password || u.pathname !== '/report' || u.search || u.hash) return null;
    return u.href;
  } catch { return null; }
}
export const enabled = () => settings().autoReport !== false;

// the git origin of this copy: null when it is not a git folder (the installer's zip), the URL, or UNKNOWN
const UNKNOWN = Symbol('unknown');
function originFromConfig(text) {
  const m = /\[remote "origin"\]([^[]*)/.exec(text);
  return m ? ((/^\s*url\s*=\s*(\S+)/m.exec(m[1]) || [])[1] || null) : null;
}
async function originOf(root) {
  const dotgit = path.join(root, '.git');
  let st;
  try { st = fs.statSync(dotgit); } catch { return null; }
  if (st.isDirectory()) {
    try { return originFromConfig(fs.readFileSync(path.join(dotgit, 'config'), 'utf8')); } catch { return UNKNOWN; }
  }
  // a worktree or submodule (.git is a file): git itself answers
  return new Promise((resolve) => execFile('git', ['remote', 'get-url', 'origin'], { cwd: root, windowsHide: true, timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (e, out, err) => resolve(e ? (/No such remote/i.test(String(err || '')) ? null : UNKNOWN) : String(out).trim() || null)));
}
let ownerCache = null;
export async function isOwnerPc(root = options.root) {
  if (typeof options.owner === 'boolean') return options.owner;
  if (readJson(require('./data-dir.js').dataFile('settings.json', root), {}).ownerPc === true) return true;
  if (ownerCache && ownerCache.root === root) return ownerCache.yes;
  const o = await originOf(root);
  const yes = o === UNKNOWN || (typeof o === 'string' && OWNER_ORIGIN.test(o));
  ownerCache = { root, yes };
  return yes;
}

// for Settings and the Set up card: { on, configured, owner, active }
export async function status() {
  const configured = !!relayUrl(), on = enabled(), owner = await isOwnerPc();
  return { on, configured, owner, active: configured && on && !owner };
}

// the random install id: made once, kept in settings.json
export function installId() {
  const s = settings();
  if (typeof s.reportInstall === 'string' && /^[a-f0-9]{32}$/.test(s.reportInstall)) return s.reportInstall;
  const id = crypto.randomBytes(16).toString('hex');
  writeJson(file('settings.json'), { ...settings(), reportInstall: id });
  return id;
}

// ---------- once a day per problem, 10 a day in all ----------
const STATE = () => file('auto-report-state.json');
const loadState = () => { const s = readJson(STATE(), {}); return { sent: s.sent && typeof s.sent === 'object' ? s.sent : {}, lastCrashLine: s.lastCrashLine || null }; };
function saveState(s) {
  const today = day();
  for (const [k, v] of Object.entries(s.sent)) if (v !== today) delete s.sent[k];   // only today's are kept
  try { writeJson(STATE(), s); } catch {}
}

export const fingerprint = (code, where) => `${code}:${String(where || 'devicehub').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`.slice(0, 80);

// ---------- what counts ----------
// a device error that is not a fault: asleep, off, out of range, unplugged, the maker's (or another) app holding it,
// the battery, waiting; and a driver that found a device that is not its own on its channel and steps aside (22 Oct 2026,
// Dsmjr2/DeviceHub-support#2: "it is not a mouse this driver runs" was reported as a fault)
export const NOT_A_FAULT = /not a (?:mouse|keyboard|headset)\b|not (?:a device )?this driver(?:'s)? (?:runs|device)|leaves it alone|steps? aside|asleep|sleep|out of range|no reply|did not answer|not answering|is it on|switched off|turned off|powered off|\boff\b|not plugged|unplugged|not connected|maker'?s app|is open\b|is running|close (?:it|[^.]+?) first|\biCUE\b|G HUB|Synapse|another program|being used|in use\b|sharing violation|access (?:is )?denied|battery|charging|waiting|turn on settings/i;
// diagnose() findings that mean the device is in an ordinary state, not broken
const ORDINARY = new Set(['maker-app', 'held', 'asleep', 'off', 'unplugged', 'bt', 'not-mine']);
// a write's read-back that did not match (public/devices/*, helpers/declarative-driver.mjs, helpers/lamparray.mjs)
export const READ_BACK = /\bafter writing\b|did not read back as written/i;
// a write that only waited (the device went to sleep or away mid-change, the maker's app took it): not a read-back fault
const WAITED = /asleep|out of range|no reply|did not answer|is it on|not connected|unplugged|maker'?s app|is running/i;

// ---------- building one report ----------
const FIRST = '**What I was doing, and what went wrong:** (write it here)';
const LAST = "Made with DeviceHub's Get help button. DeviceHub sent nothing; the person who opened this pressed Submit.";
export async function build(ev) {
  const gh = await import('./get-help.mjs');
  const { personalNames } = await import('./share-device.mjs');
  const names = personalNames([...(options.names || [])]);
  const deps = { root: options.root, port: options.port, ...(options.gatherDeps || {}) };
  // diagnose's findings with their codes, to tell an ordinary state (the maker's app, asleep) from a fault
  let findings = null;
  const dg = deps.diagnose || ((id) => import('./diagnose.mjs').then((m) => m.diagnose(id, { port: options.port })));
  deps.diagnose = async (id) => { const r = await dg(id); findings = r?.findings || []; return r; };
  let f;
  try { f = await gh.gather(ev.device || '', deps); } catch (e) { return { ok: false, why: `the report could not be built (${e.message})` }; }
  if (ev.code === 'device-error' && (findings || []).some((x) => ORDINARY.has(x.code))) return { ok: false, ordinary: true, why: 'diagnose found an ordinary state (asleep, off, unplugged or another app)' };
  const r = gh.makeIssue(f, { names });
  if (!r.ok) return { ok: false, refused: true, why: 'Get help refused it: something in it still looks personal' };
  const area = gh.strip(ev.area || 'DeviceHub', names).text, problem = gh.strip(ev.problem, names).text;
  const title = `${area}: ${problem}`.replace(/\s+/g, ' ').trim().slice(0, 120);
  const what = `**What went wrong:** ${gh.strip(String(ev.detail || ev.problem).replace(/\s+/g, ' ').slice(0, 600), names).text}`;
  let body = r.body.includes(FIRST) ? r.body.replace(FIRST, what) : `${what}\n\n${r.body}`;
  body = body.replace(LAST, 'Sent by DeviceHub by itself (problem reports are on; Settings can turn them off). Anything personal was taken out first.');
  if (body.length > 12000) body = `${body.slice(0, 11960)}\n\n(Cut to fit.)`;
  const fin = finalCheck(gh.findPersonal, title, body, names);
  if (!fin.ok) return { ok: false, refused: true, why: fin.why };
  const { devicehubVersion } = await import('./device-library.mjs');
  return { ok: true, title, body: fin.body, version: String(devicehubVersion(options.root)).slice(0, 40), dropped: fin.dropped };
}
// the final check on exactly what goes (find = get-help's findPersonal): a flagged line is dropped; still flagged, or a
// flagged title: nothing goes
export function finalCheck(find, title, body, names) {
  if (find(title, names).length) return { ok: false, why: 'the title still looks personal' };
  const flagged = new Set(find(body, names).map((x) => x.line));
  const out = flagged.size ? body.split(/\r?\n/).filter((l, i) => !flagged.has(i + 1)).join('\n') : body;
  if (find(out, names).length || out.length < 10) return { ok: false, why: 'the body still looks personal' };
  return { ok: true, body: out, dropped: flagged.size };
}

// ---------- sending ----------
async function post(url, payload) {
  try {
    const r = await options.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (r.ok) return 'ok';
    return r.status >= 500 ? 'retry' : 'drop';   // 400 (shape) and 429 (limits) do not get better by trying again
  } catch { return 'retry'; }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function sendWithRetry(url, payload) {
  for (let i = 0; ; i++) {
    const r = await post(url, payload);
    if (r !== 'retry' || i >= options.retryMs.length) return r === 'retry' ? 'given up' : r;
    await wait(options.retryMs[i]);
  }
}

// one problem: { code, device (id or null), area, problem, detail }. Resolves { sent, why }.
const inFlight = new Set();
export async function report(ev) {
  if (!started) return { sent: false, why: 'not started' };
  const fp = fingerprint(ev.code, ev.device || ev.where);
  if (inFlight.has(fp)) return { sent: false, why: 'already being sent' };
  // marked at once, before anything waits (31 Oct 2026: two events at the same moment both passed the check during
  // the waits, and the same problem was sent twice)
  inFlight.add(fp);
  try {
  const url = relayUrl();
  if (!url) return { sent: false, why: 'no relay set up (helpers/report-config.json)' };
  if (!enabled()) return { sent: false, why: 'switched off in Settings' };
  if (await isOwnerPc()) return { sent: false, why: "the owner's own PC" };
  const st = loadState();
  if (st.sent[fp] === day()) return { sent: false, why: 'already sent today' };
  if (Object.values(st.sent).filter((v) => v === day()).length >= DAY_CAP) return { sent: false, why: 'ten sent today already' };
    const b = await build(ev);
    if (!b.ok) {
      // a refused report is not built again today; an ordinary state is simply not a problem
      if (b.refused) { st.sent[fp] = day(); saveState(st); }
      options.log(`not sent (${ev.code}): ${b.why}`);
      return { sent: false, why: b.why };
    }
    const payload = { v: 1, install: installId(), fingerprint: fp, version: b.version || 'unknown', title: b.title, body: b.body };
    if (!validPayload(payload)) { options.log(`not sent (${ev.code}): the report is not the shape the relay takes`); return { sent: false, why: 'bad shape' }; }
    st.sent[fp] = day(); saveState(st);
    const r = await sendWithRetry(url, payload);
    options.log(r === 'ok' ? `problem report sent (${ev.code})` : `problem report not sent (${ev.code}): ${r}`);
    return { sent: r === 'ok', why: r, payload };
  } finally { inFlight.delete(fp); }
}
// One report a person asked for with a click (Request support: helpers/support-request.mjs). The same checks and send
// path as the automatic ones: started, relay set up, switched on, not the owner's PC, once per fingerprint per day, the
// day cap, the relay's shape. The first try is awaited (the click gets its answer); when the relay cannot be reached,
// the later tries run on their own and a give-up frees the fingerprint for another click.
//   { sent: true } | { sent: true, already: true } | { sent: false, queued: true } | { sent: false, fallback: true, why }
// fallback: this copy does not send (or the relay refused it): the page does what it did before (the GitHub request).
// already sent (or being sent) today: a second click needs no new request built
export const sentToday = (fp) => loadState().sent[fp] === day() || inFlight.has(fp);
// channel 'driver': a learned driver the person chose to share (helpers/driver-share.mjs, settings.json shareDrivers), sent
// whatever the problem-report switch says; everything else here (owner's PC, the relay, the caps) applies the same
export async function sendNow({ fingerprint: fp, title, body, version, channel = 'support' }) {
  if (!started) return { sent: false, fallback: true, why: 'not started' };
  const url = relayUrl();
  if (!url) return { sent: false, fallback: true, why: 'no relay set up (helpers/report-config.json)' };
  if (channel !== 'driver' && !enabled()) return { sent: false, fallback: true, why: 'switched off in Settings' };
  if (await isOwnerPc()) return { sent: false, fallback: true, why: "the owner's own PC" };
  const st = loadState();
  if (st.sent[fp] === day() || inFlight.has(fp)) return { sent: true, already: true };
  if (Object.values(st.sent).filter((v) => v === day()).length >= DAY_CAP) return { sent: false, fallback: true, why: 'ten sent today already' };
  const payload = { v: 1, install: installId(), fingerprint: fp, version: String(version || 'unknown').slice(0, 40), title, body };
  if (!validPayload(payload)) return { sent: false, fallback: true, why: 'bad shape' };
  st.sent[fp] = day(); saveState(st);
  const free = () => { const s = loadState(); delete s.sent[fp]; saveState(s); };
  inFlight.add(fp);
  const first = await post(url, payload);
  if (first === 'ok') { inFlight.delete(fp); options.log(`support request sent (${fp})`); return { sent: true, payload }; }
  if (first === 'drop') { inFlight.delete(fp); free(); options.log(`support request not sent (${fp}): the relay turned it down`); return { sent: false, fallback: true, why: 'the relay refused it', payload }; }
  quiet((async () => {
    for (const ms of options.retryMs) { await wait(ms); const r = await post(url, payload); if (r === 'ok') { options.log(`support request sent (${fp})`); return; } if (r === 'drop') break; }
    free(); options.log(`support request not sent (${fp}): given up`);
  })().finally(() => inFlight.delete(fp)));
  return { sent: false, queued: true, payload };
}

// reports started by the hooks, so tests can wait for them (settle())
const pending = new Set();
const quiet = (p) => { pending.add(p); p.catch(() => {}).finally(() => pending.delete(p)); return p; };
export const settle = () => Promise.allSettled([...pending]);

// ---------- the hooks ----------
// the device helper (helpers/native.js onProblem): 'helper-build' | 'helper-start' | 'helper-restarts'
const HELPER = { 'helper-build': 'could not be built', 'helper-start': 'could not start', 'helper-restarts': 'keeps restarting' };
export function helperProblem(code, text) {
  if (!HELPER[code]) return null;
  return quiet(report({ code, device: null, where: 'helper', area: 'Device helper', problem: HELPER[code], detail: text }));
}
// the background part did not start (server.js)
export const agentFailed = (text) => quiet(report({ code: 'agent-start', device: null, where: 'agent', area: 'DeviceHub', problem: 'its background part did not start', detail: text }));

// an Activity line (the agent's env.onActivity): a write whose read-back did not match
export function noteActivity(entry, title) {
  if (!entry || entry.kind !== 'bad' || !entry.device || typeof entry.text !== 'string') return null;
  if (/library self-check/i.test(entry.text) || !READ_BACK.test(entry.text) || WAITED.test(entry.text)) return null;
  return quiet(report({ code: 'write-check', device: entry.device, area: title || entry.device, problem: 'a change did not read back', detail: entry.text }));
}

// a library or learned driver's self-check (helpers/my-devices.mjs): reported when a setting failed (not waiting)
export function selfCheckResult(a, r) {
  if (!a?.id || !r?.ran || !(r.counts?.failed > 0)) return null;
  const why = Object.entries(r.keys || {}).filter(([, k]) => k && k.ok === false && !k.waiting && !k.skip).map(([key, k]) => `${key}: ${k.why}`).slice(0, 4).join('; ');
  return quiet(report({ code: 'self-check', device: a.id, area: a.title || a.id, problem: 'its driver self-check failed', detail: `${r.counts.failed} of ${r.counts.checked} settings did not pass${why ? ` (${why})` : ''}` }));
}

// the agent's 30 s error retry: a device in 'error' (plugged in: unplugged is 'missing') for over ERROR_MINUTES with
// an error that is a fault. Asleep, missing, connected or idle ends the episode; one report per episode.
const episodes = new Map();   // id -> { since, reported }
export function checkDevices(list, now = options.now()) {
  const fired = [];
  for (const d of list || []) {
    if (!d?.id) continue;
    if (d.status === 'connecting') continue;
    // a driver that stepped aside (helpers/my-devices.mjs stepAside) is not in an error, whatever its status says
    if (d.adapter?.notMine) { episodes.delete(d.id); continue; }
    if (d.status !== 'error') { episodes.delete(d.id); continue; }
    let e = episodes.get(d.id);
    if (!e) episodes.set(d.id, e = { since: now, reported: false });
    if (NOT_A_FAULT.test(String(d.error || ''))) { e.since = now; continue; }   // an ordinary state restarts the clock
    if (e.reported || now - e.since < ERROR_MINUTES * 60e3) continue;
    e.reported = true;
    const title = d.adapter?.title || d.id;
    fired.push(d.id);
    quiet(report({ code: 'device-error', device: d.id, area: title, problem: `in an error for over ${ERROR_MINUTES} minutes`, detail: d.error || 'no error text' }));
  }
  return fired;
}
export const _episodes = episodes;

// at start (server.js, about 2 minutes after): did the launcher start this run after DeviceHub stopped with an error?
// The lines between the previous "DeviceHub on http" and this run's are this start's; a launcher line there with a
// code other than -1 (stopped from outside) is a crash. The same line is never reported twice.
// Not a crash either (22 Oct 2026, support issue 3): Windows closing DeviceHub's console because the PC is signing out,
// shutting down or restarting, or its console window was closed. Node then ends with 1073807364 (0x40010004,
// DBG_TERMINATE_PROCESS: the console's close, logoff or shutdown event) or -1073741510 (0xC000013A,
// STATUS_CONTROL_C_EXIT: Ctrl+C or Ctrl+Break). Nothing went wrong inside DeviceHub, so no report is sent.
export const CLOSED_BY_WINDOWS = new Set([1073807364, -1073741510, 3221225786]);
export const closedByWindows = (code) => CLOSED_BY_WINDOWS.has(Number(code));
export function crashBefore(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/^DeviceHub on http/.test(l)) starts.push(i); });
  if (!starts.length) return null;
  const to = starts[starts.length - 1], from = starts.length > 1 ? starts[starts.length - 2] : -1;
  for (let i = to - 1; i > from; i--) {
    const m = /^\[launcher\] .*?(?:server exited|the new version stopped) with code (-?\d+)/.exec(lines[i]);
    if (m && m[1] !== '-1' && !closedByWindows(m[1]) && !(m[1] === '1' && !crashLineIn(lines, from, i))) return { line: lines[i], code: Number(m[1]) };
  }
  return null;
}
// code 1 is a crash only when that run wrote a "[crash]" line (helpers/driver-guard.js) or Node's own error and stack
// (an error before driver-guard was installed); without one it was stopped from outside, by Task Manager's End task or
// taskkill /F (27 Oct 2026: 10 "crashes" in a day were all restarts). server.js /api/health uses the same rule.
export const CRASH_LINE = /^\[crash\]|^\s+at .+:\d+:\d+\)?\s*$|^\w*Error\b/;
export function crashLineIn(lines, from, to) {
  for (let i = to - 1; i > from; i--) if (CRASH_LINE.test(lines[i])) return true;
  return false;
}
function logLines() {
  const out = [];
  for (const f of ['server.old.log', 'server.log']) {
    try {
      const p = file(f), size = fs.statSync(p).size, n = Math.min(size, 256 * 1024);
      const fd = fs.openSync(p, 'r'), b = Buffer.alloc(n);
      try { fs.readSync(fd, b, 0, n, size - n); } finally { fs.closeSync(fd); }
      out.push(...b.toString('utf8').split(/\r?\n/).slice(n < size ? 1 : 0));
    } catch {}
  }
  return out;
}
export function checkCrash(lines = logLines()) {
  const c = crashBefore(lines);
  if (!c) return null;
  const st = loadState();
  if (st.lastCrashLine === c.line) return null;
  st.lastCrashLine = c.line; saveState(st);
  return quiet(report({ code: 'server-exit', device: null, where: 'server', area: 'DeviceHub', problem: 'stopped unexpectedly and was restarted', detail: `DeviceHub stopped with code ${c.code} and its launcher started it again.` }));
}

// GET /api/auto-report (server.js): { on, configured, owner, active }
export async function handle(url, req, res, send) {
  if (url.pathname !== '/api/auto-report' || req.method !== 'GET') return false;
  send(res, 200, await status());
  return true;
}
