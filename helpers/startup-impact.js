// Start-up impact measured by DeviceHub itself (27 Oct 2026, Shawn: the Start-up apps list showed "—" for impact).
// Windows' own sign-in timing needs admin, but every process's CPU time and disk activity can be read by an ordinary
// account, and that is what Task Manager's "Startup impact" is made of. DeviceHub starts at sign-in (its Startup
// shortcut); when it starts within 4 minutes of sign-in, helpers/startup-impact-read.ps1 watches until sign-in + 150 s
// (one PowerShell, a process list every 10 s) and the result is kept in data\startup-impact.json (the last 5 sign-ins).
// Levels are Microsoft's own: High = more than 1 s of CPU or 3 MB of disk; Medium = 300 ms or 300 KB; else Low.
//   measureAtSignIn()   on server start; does nothing when started later than that, or already measured for this sign-in
//   latest()            the newest measurement { signIn, at, procs } or null
//   impactFor(item, run, root)  { level, cpuMs, ioKB } for one start-up entry, or null when none of its processes ran;
//                       like Task Manager, the programs it started count too (children seen in the same watch)
// Never asks for admin, writes only its own file, measures nothing outside the first minutes after sign-in.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, dataFile } = require('./data-dir');
const { writeAtomic } = require('./safe-write');

const READ = path.join(__dirname, 'startup-impact-read.ps1');
const KEEP = 5;
const HOSTS = /^(wscript|cscript|cmd|powershell|pwsh|rundll32|conhost|explorer)\.exe$/i;

const deps = {
  root: ROOT,
  file: () => dataFile('startup-impact.json', deps.root),
  read: () => require('./helper-reads').read('startup-impact-read', {
    ms: 6 * 60 * 1000,
    ps: () => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', READ], { windowsHide: true, timeout: 6 * 60 * 1000, maxBuffer: 8 << 20 }, (err, out) => {
      try { resolve(JSON.parse(String(out || '').trim())); } catch { reject(new Error(err ? err.message : 'the sign-in measurement could not be read')); }
    })),
  }),
  log: () => {},
};

// A command line can carry a secret (18 Nov 2026: a password manager's command line with its unlock session was kept in
// this file). Only the program and script names are needed (impactFor matches on them), so a value after a flag named
// like a secret, and any long token that looks like a key, is kept as <hidden>; runs saved before this are cleaned
// when read, and the file is written again without them (cleanFile, at start).
const SECRET_FLAG = /((?:^|\s)(?:--?|\/)[\w-]*(?:session|password|passwd|pwd|token|secret|apikey|api-key|api_key|auth|bearer|credential|cookie|key)[\w-]*)(=|:|\s+)("[^"]*"|'[^']*'|[^\s"']+)/gi;
const LONG_TOKEN = /(^|[\s"'=:])([A-Za-z0-9+/_-]{40,}={0,2})(?=$|[\s"'])/g;
function redactCmd(cmd) {
  return String(cmd || '').replace(SECRET_FLAG, (m, flag, sep) => `${flag}${sep}<hidden>`).replace(LONG_TOKEN, (m, pre) => `${pre}<hidden>`);
}
const cleanRun = (r) => ({ ...r, procs: Array.isArray(r?.procs) ? r.procs.map((p) => ({ ...p, cmd: redactCmd(p?.cmd) })) : [] });
function load() {
  try { const j = JSON.parse(fs.readFileSync(deps.file(), 'utf8')); return Array.isArray(j.runs) ? j.runs.map(cleanRun) : []; } catch { return []; }
}
// the file written again when a run saved before the redaction still holds something it would hide
function cleanFile() {
  try {
    const text = fs.readFileSync(deps.file(), 'utf8');
    const runs = load();
    const clean = JSON.stringify({ runs }, null, 1);
    if (JSON.stringify(JSON.parse(text).runs) !== JSON.stringify(runs)) writeAtomic(deps.file(), clean);
    return true;
  } catch { return false; }
}
const latest = () => load().sort((a, b) => String(b.signIn).localeCompare(String(a.signIn)))[0] || null;

let busy = false;
async function measureAtSignIn() {
  if (busy) return null;
  busy = true;
  try {
    const r = await deps.read();
    if (!r || r.late || r.error || !r.signIn || !Array.isArray(r.procs)) return null;
    const run = { signIn: r.signIn, at: r.at, procs: r.procs.map((p) => ({ name: p.name || '', path: p.path || '', cmd: redactCmd(p.cmd), pid: Number(p.pid) || 0, ppid: Number(p.ppid) || 0, startS: p.startS, cpuMs: Number(p.cpuMs) || 0, ioKB: Number(p.ioKB) || 0 })) };
    const runs = [run, ...load().filter((x) => x.signIn !== run.signIn)].sort((a, b) => String(b.signIn).localeCompare(String(a.signIn))).slice(0, KEEP);
    writeAtomic(deps.file(), JSON.stringify({ runs }, null, 1));
    deps.log(`Start-up impact measured at sign-in (${run.procs.length} programs)`);
    return run;
  } catch { return null; } finally { busy = false; }
}

// ---- one entry's processes ----
const base = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();
const low = (s) => String(s || '').toLowerCase();
// the script a host program runs (wscript "x.vbs", powershell -File x.ps1): its file name, or null
function scriptOf(it) {
  const m = `${it.command || ''} ${it.args || ''}`.match(/([^\\/"\s]+\.(vbs|vbe|js|jse|wsf|ps1|bat|cmd))\b/i);
  return m ? m[1].toLowerCase() : null;
}
function matches(it, p, root) {
  const r = low(root);
  if (it.self) return low(p.cmd).includes(r) || low(p.path).startsWith(r);
  const target = low(it.target);
  if (HOSTS.test(base(target))) { const s = scriptOf(it); return !!s && low(p.cmd).includes(s); }
  if (!target) return false;
  return p.path ? low(p.path) === target : low(p.name) === base(target);
}
function level(cpuMs, ioKB) {
  if (cpuMs > 1000 || ioKB > 3072) return 'High';
  if (cpuMs >= 300 || ioKB >= 300) return 'Medium';
  return 'Low';
}
function impactFor(it, run, root = deps.root) {
  if (!run || !Array.isArray(run.procs)) return null;
  const hits = run.procs.filter((p) => matches(it, p, root));
  if (!hits.length) return null;
  // the programs those started, and theirs (only processes seen in this watch, so a reused id from before is not one)
  for (let i = 0; i < hits.length; i++) {
    for (const c of run.procs) if (c.ppid && c.ppid === hits[i].pid && c !== hits[i] && !hits.includes(c) && !(c.startS < hits[i].startS)) hits.push(c);
  }
  const cpuMs = hits.reduce((a, p) => a + (Number(p.cpuMs) || 0), 0), ioKB = hits.reduce((a, p) => a + (Number(p.ioKB) || 0), 0);
  return { level: level(cpuMs, ioKB), cpuMs, ioKB };
}

module.exports = { measureAtSignIn, latest, impactFor, cleanFile, redactCmd, _test: { deps, level, matches, scriptOf, reset: () => { busy = false; } } };
