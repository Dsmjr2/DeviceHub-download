// Start-up apps on the PC page (27 Oct 2026, Shawn: what starts with Windows, how much each slows sign-in, and a
// one-click Off and On again). The same list Task Manager's Startup apps shows, read with the person's own rights
// (helpers/startup-apps-read.ps1): the Run keys (HKCU, HKLM, HKLM WOW6432Node), the user's and all users' Startup
// folders, and each one's on/off state in ...\Explorer\StartupApproved\Run, Run32 and StartupFolder (first byte even,
// 02 or 06, or no value = on; odd, 03 = off, with the time it was turned off in bytes 4-11).
//   list(fresh)        { at, apps: [{ id, name, publisher, on, offSince, impact, self, scope }], on, total, impact }
//                      the last answer at once, read again when over a minute old (helpers/last-answer.js)
//   set(id, on)        exactly what Task Manager does: writes that entry's StartupApproved value (03 + now to turn
//                      off, 02 + zeros to turn on). The key is exported to backups\ first and the file checked; then
//                      the value is read back. HKCU needs nothing; HKLM asks Windows once (powershell.exe -Verb RunAs,
//                      hidden, only for that click), recorded like every prompt (helpers/uac.mjs). Never deletes a Run
//                      value, a shortcut or a file, and never touches scheduled tasks or services.
// Impact: Task Manager's "Startup impact" has no public API. DeviceHub measures it at sign-in the way Task Manager does
// (CPU and disk in the first minutes, helpers/startup-impact.js, no admin): a row gets High, Medium or Low from the
// last sign-in DeviceHub watched, and "Not measured" when none of its programs ran then. Before the first one, Windows'
// own sign-in timing (Diagnostics-Performance event 101, administrators only) is used where it can be read (High =
// 3 s or more slower, Medium = 1 s, else Low); otherwise every row says "—" and one line says when it will be measured.
// Nothing is guessed.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const READ = path.join(__dirname, 'startup-apps-read.ps1');
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const SCOPES = ['HKCU', 'HKLM'], KEYS = ['Run', 'Run32', 'StartupFolder'];
const UAC_WAIT_MS = 2 * 60 * 1000;
// a program that only runs a script: its maker says nothing about the app
const HOSTS = /^(wscript|cscript|cmd|powershell|pwsh|rundll32|conhost|explorer)\.exe$/i;

// the outer, ordinary PowerShell: Start-Process -Verb RunAs shows Windows' own prompt; the script goes as
// -EncodedCommand through an environment variable (the same as helpers/board-lights.mjs)
const ELEVATE = "try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$env:DH_SCRIPT -PassThru -Wait -ErrorAction Stop; \"exit|$($p.ExitCode)\" } catch { \"error|$($_.Exception.Message)\" }";

// ---- the parts that touch Windows, swappable for tests (tests/startup-apps.mjs) ----
const deps = {
  root: ROOT,
  now: () => new Date(),
  // the read script's JSON
  read: () => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', READ], { windowsHide: true, timeout: 30000, maxBuffer: 4 << 20 }, (err, out) => {
    try { resolve(JSON.parse(String(out || '').trim())); } catch { reject(new Error(err ? err.message : 'the start-up list could not be read')); }
  })),
  // reg.exe export / add, with the person's own rights: { code, out }
  run: (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (err, out, errOut) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${out || ''}${errOut || ''}` }))),
  // one admin prompt: { code } once the script ended, or { error, declined }
  elevate: (script, signal) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ELEVATE], { windowsHide: true, timeout: 5 * 60 * 1000, signal, env: { ...process.env, DH_SCRIPT: Buffer.from(script, 'utf16le').toString('base64') } }, (err, out) => {
    const [kind, ...rest] = String(out || '').trim().split('|'), msg = rest.join('|');
    if (kind === 'exit') resolve({ code: Number(msg) });
    else resolve({ error: msg || err?.message || 'Windows did not start it', declined: /cancel/i.test(msg) });
  })),
  // the last sign-in DeviceHub measured (helpers/startup-impact.js), or null
  measured: () => require('./startup-impact').latest(),
  record: (e) => import('./uac.mjs').then((u) => u.record({ area: 'startup', ...e })).catch(() => {}),
  uacWaitMs: UAC_WAIT_MS,
};

// ---- StartupApproved bytes ----
const EPOCH_MS = 11644473600000n;   // 1601-01-01 to 1970-01-01
// hex -> { on, offSince }: no value, or the first byte even (02, 06) = on; odd (03) = off since the FILETIME in bytes 4-11
function stateOf(hex) {
  if (hex == null || hex === '') return { on: true, offSince: null };
  const b = Buffer.from(String(hex), 'hex');
  if (!b.length) return { on: true, offSince: null };
  if ((b[0] & 1) === 0) return { on: true, offSince: null };
  let offSince = null;
  if (b.length >= 12) {
    const ft = b.readBigUInt64LE(4);
    if (ft > 0n) { const ms = Number(ft / 10000n - EPOCH_MS); if (Number.isFinite(ms) && ms > 0) offSince = new Date(ms).toISOString(); }
  }
  return { on: false, offSince };
}
// what Task Manager writes: on = 02 and eleven zero bytes; off = 03 00 00 00 and the time now as a FILETIME
function bytesFor(on, now = deps.now()) {
  const b = Buffer.alloc(12);
  if (on) { b[0] = 0x02; return b.toString('hex'); }
  b[0] = 0x03;
  b.writeBigUInt64LE((BigInt(now.getTime()) + EPOCH_MS) * 10000n, 4);
  return b.toString('hex');
}

// ---- the list ----
const base = (p) => String(p || '').split(/[\\/]/).pop();
const isSelf = (it) => /^devicehub(\.lnk)?$/i.test(it.name || '') || [it.command, it.target, it.args].some((t) => t && t.toLowerCase().includes(deps.root.toLowerCase()));
function nameOf(it) {
  if (isSelf(it)) return 'DeviceHub';
  if (it.key === 'StartupFolder') return String(it.name).replace(/\.(lnk|url|pif)$/i, '');
  return (it.description && !HOSTS.test(base(it.target)) ? it.description : '') || it.name;
}
function publisherOf(it) {
  if (isSelf(it)) return '';
  if (!it.found) return 'Program not found';
  return HOSTS.test(base(it.target)) ? '' : String(it.publisher || '').trim();
}
const LEVELS = [[3000, 'High'], [1000, 'Medium'], [0, 'Low']];
function impactOf(it, impact, run) {
  if (run) { const m = require('./startup-impact').impactFor({ ...it, self: isSelf(it) }, run, deps.root); return m ? m.level : 'Not measured'; }
  if (!impact || !impact.readable) return '—';
  const exe = base(it.target).toLowerCase();
  const hits = (impact.apps || []).filter((a) => exe && base(a.file).toLowerCase() === exe);
  if (!hits.length) return 'Not measured';
  const worst = Math.max(...hits.map((a) => Number(a.degradeMs) || 0));
  return LEVELS.find(([ms]) => worst >= ms)[1];
}
const idOf = (it) => `${it.scope}|${it.key}|${it.name}`;
// the read script's JSON -> what the page shows
function fromRead(j, at = deps.now(), run = deps.measured()) {
  const items = (j && Array.isArray(j.items) ? j.items : []).filter((it) => it && SCOPES.includes(it.scope) && KEYS.includes(it.key) && it.name);
  const apps = items.map((it) => {
    const s = stateOf(it.approved);
    return { id: idOf(it), name: nameOf(it), publisher: publisherOf(it), on: s.on, offSince: s.offSince, impact: impactOf(it, j.impact, run), self: isSelf(it), scope: it.scope, admin: it.scope === 'HKLM' };
  }).sort((a, b) => (a.on === b.on ? a.name.localeCompare(b.name) : a.on ? -1 : 1));
  const im = j && j.impact, readable = !!(run || (im && im.readable));
  return {
    at: at.toISOString(), apps, on: apps.filter((a) => a.on).length, total: apps.length,
    impact: { readable, measuredAt: run ? run.signIn : null, note: readable ? null : 'Impact is measured at your next sign-in.' },
  };
}

let cache = null;
const answer = () => (cache ||= require('./last-answer').lastAnswer({ name: 'startup-apps', staleMs: 60000, read: async () => fromRead(await deps.read()) }));
const list = (fresh = false) => answer().get(fresh);

// ---- turning one on or off ----
const regPath = (scope, key) => `${scope}\\${APPROVED}\\${key}`;
const stamp = (d) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
// the key exported to backups\ (a key that is not there yet gets a file that says so); the file name, or throws
async function backup(scope, key, existed) {
  const dir = path.join(deps.root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  // a new file each time (two clicks in one second never share, or overwrite, a backup)
  const stem = path.join(dir, `startup-approved-${scope}-${key}-${stamp(deps.now())}`);
  let file = `${stem}.reg`;
  for (let n = 2; fs.existsSync(file); n++) file = `${stem}_${n}.reg`;
  if (existed === false) fs.writeFileSync(file, `Windows Registry Editor Version 5.00\r\n\r\n; [${scope === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE'}\\${APPROVED}\\${key}] did not exist before ${deps.now().toISOString()}\r\n`);
  else await deps.run('reg.exe', ['export', regPath(scope, key), file, '/y']);
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  if (!size) throw new Error('not changed: the backup was not written');
  return path.basename(file);
}
// the elevated script: only New-ItemProperty on that one value (the name travels as base64, never as code)
function adminScript(key, name, hex, { started, cancel }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const bytes = hex.match(/../g).map((x) => `0x${x}`).join(',');
  return [
    `if (Test-Path -LiteralPath ${q(cancel)}) { exit 4 }`,
    `Set-Content -LiteralPath ${q(started)} -Value 'started' -Encoding UTF8 -ErrorAction SilentlyContinue`,
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $k = ${q(`HKLM:\\${APPROVED}\\${key}`)}`,
    `  $n = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(name, 'utf8').toString('base64')}'))`,
    '  if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k | Out-Null }',
    `  New-ItemProperty -LiteralPath $k -Name $n -PropertyType Binary -Value ([byte[]](${bytes})) -Force | Out-Null`,
    '  exit 0',
    '} catch { exit 3 }',
  ].join('\r\n');
}

let busy = false;
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
async function set(id, on) {
  if (busy) throw new Error('busy with the last change; wait for it');
  busy = true;
  try {
    on = !!on;
    const raw = await deps.read();
    const it = (raw && Array.isArray(raw.items) ? raw.items : []).find((x) => x && idOf(x) === String(id));
    if (!it || !SCOPES.includes(it.scope) || !KEYS.includes(it.key)) throw new Error('that app is not in the start-up list any more');
    const name = nameOf(it), was = stateOf(it.approved).on;
    if (was === on) return { ok: true, text: `${name} is already ${on ? 'on' : 'off'}.`, apps: fromRead(raw) };
    const hex = bytesFor(on);
    const existed = raw.approvedKeys ? raw.approvedKeys[`${it.scope}|${it.key}`] : undefined;
    const file = await backup(it.scope, it.key, existed);
    const action = `turn ${name} ${on ? 'on' : 'off'} at start-up`;
    if (it.scope === 'HKCU') {
      const r = await deps.run('reg.exe', ['add', regPath('HKCU', it.key), '/v', it.name, '/t', 'REG_BINARY', '/d', hex, '/f']);
      if (r.code !== 0) throw new Error(`not changed: ${String(r.out || '').trim() || `reg.exe ${r.code}`}`);
    } else {
      const logs = path.join(deps.root, 'logs');
      fs.mkdirSync(logs, { recursive: true });
      const started = path.join(logs, 'startup-apps.started.txt'), cancel = path.join(logs, 'startup-apps.cancel.txt');
      for (const f of [started, cancel]) { try { fs.rmSync(f, { force: true }); } catch {} }   // DeviceHub's own marker files
      const ac = new AbortController();
      let unanswered = false;
      const timer = setTimeout(() => { if (!fs.existsSync(started)) { unanswered = true; try { fs.writeFileSync(cancel, 'cancel'); } catch {} ac.abort(); } }, deps.uacWaitMs);
      const r = await deps.elevate(adminScript(it.key, it.name, hex, { started, cancel }), ac.signal);
      clearTimeout(timer);
      if (unanswered) { deps.record({ action, outcome: 'unanswered' }); answer().invalidate(); return { ok: false, uac: 'unanswered', text: "Windows' prompt was not answered in 2 minutes. Nothing changed.", apps: await list(true) }; }
      if (r.declined || (r.error && !readText(started))) { deps.record({ action, outcome: 'declined' }); return { ok: false, uac: 'declined', text: "Windows' prompt was declined. Nothing changed.", apps: fromRead(raw) }; }
      deps.record({ action, outcome: 'yes' });
      if (r.code !== 0) { answer().invalidate(); return { ok: false, text: `Not changed (code ${r.code ?? r.error}).`, backup: file, apps: await list(true) }; }
    }
    // read back: the value must now hold exactly what was written
    answer().invalidate();
    const after = await deps.read();
    const now = (after && Array.isArray(after.items) ? after.items : []).find((x) => x && idOf(x) === idOf(it));
    const ok = !!now && String(now.approved || '').toLowerCase() === hex && stateOf(now.approved).on === on;
    const apps = fromRead(after);
    return { ok, text: ok ? `${name}: ${on ? 'on' : 'off'} at start-up.` : `${name}: written, but it did not read back. Look again.`, backup: file, apps, name, on };
  } finally { busy = false; }
}

module.exports = { list, set, _test: { deps, stateOf, bytesFor, fromRead, adminScript, impactOf, ELEVATE, reset: () => { cache = null; busy = false; } } };
