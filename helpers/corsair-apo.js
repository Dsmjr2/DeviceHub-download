// Corsair's old sound effects under Equalizer APO (27 Oct 2026, measured on Shawn's PC). After iCUE is removed, Windows
// keeps Corsair's audio effects (APOs) on the headset's sound devices, and Equalizer APO runs them before and after its
// own ("Use original APO": HKLM\SOFTWARE\EqualizerAPO\Child APOs\{device} PreMixChild / PostMixChild). Without iCUE they
// stall each time an app opens the device: Discord's join sound came about 1 s late on the HS80 and its mic. Clearing
// those two values and restarting Windows Audio fixed it, with Equalizer APO and every EQ and mic setting still working.
//   check({ render, capture })   read-only (helpers/corsair-apo-read.ps1): the headset's active devices Equalizer APO is
//                                on, whose PreMixChild / PostMixChild is a Corsair effect (HKCR\CLSID's name or file
//                                says Corsair), only while iCUE is NOT installed -> { flagged: [...], icue }
//   fix({ render, capture })     on the person's click only: one Windows prompt, helpers/corsair-apo-fix.ps1 elevated
//                                (backs each key up to backups\ first, clears only those two values, reads them back,
//                                restarts Audiosrv); the answer is recorded like every prompt (helpers/uac.mjs)
// A Corsair effect Windows attaches directly (MMDevices FxProperties) did not matter and is never touched.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const READ = path.join(__dirname, 'corsair-apo-read.ps1');
const FIX = path.join(__dirname, 'corsair-apo-fix.ps1');
const GUID = /^\{[0-9a-f-]{36}\}$/i;
const UAC_WAIT_MS = 2 * 60 * 1000;
const ACTION = "turn off Corsair's old sound effects";

// the outer, ordinary PowerShell: Start-Process -Verb RunAs shows Windows' own prompt and waits for the script
const ELEVATE = "try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('\"' + $env:DH_SCRIPT + '\"'),'-Guids',$env:DH_GUIDS,'-Backups',('\"' + $env:DH_BACKUPS + '\"'),'-Result',('\"' + $env:DH_RESULT + '\"'),'-Started',('\"' + $env:DH_STARTED + '\"'),'-Cancel',('\"' + $env:DH_CANCEL + '\"')); \"exit|$($p.ExitCode)\" } catch { \"error|$($_.Exception.Message)\" }";

// ---- the parts that touch Windows, swappable for tests (tests/corsair-apo.mjs) ----
const deps = {
  root: ROOT,
  // the read script's JSON, or null
  read: (list) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', READ, '-Endpoints', list.map(([f, g]) => `${f}|${g}`).join(',')], { windowsHide: true, timeout: 20000 }, (err, out) => {
    try { resolve(JSON.parse(String(out || '').trim())); } catch { resolve(null); }
  })),
  // one admin prompt: { code } once the script ended, or { error, declined }
  elevate: (env, signal) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ELEVATE], { windowsHide: true, timeout: 5 * 60 * 1000, signal, env: { ...process.env, ...env } }, (err, out) => {
    const [kind, ...rest] = String(out || '').trim().split('|'), msg = rest.join('|');
    if (kind === 'exit') resolve({ code: Number(msg) });
    else resolve({ error: msg || err?.message || 'Windows did not start it', declined: /cancel/i.test(msg) });
  })),
  record: (e) => import('./uac.mjs').then((u) => u.record({ area: 'sound', action: ACTION, ...e })).catch(() => {}),
  uacWaitMs: UAC_WAIT_MS,
};

const isCorsair = (c) => !!c && /corsair/i.test(`${c.name || ''} ${c.dll || ''}`);
// the read's JSON -> what the page shows
function fromRead(j) {
  if (!j || !Array.isArray(j.rows)) return { flagged: [], icue: null };
  if (j.icue === true) return { flagged: [], icue: true };   // iCUE still runs its effects: they belong to it
  const flagged = [];
  for (const r of j.rows) {
    if (String(r.state) !== '1' || r.on !== true || r.child !== true) continue;
    const effects = [['PreMixChild', r.pre], ['PostMixChild', r.post]].filter(([, c]) => isCorsair(c)).map(([slot, c]) => ({ slot, clsid: c.clsid, name: c.name || '' }));
    if (effects.length && GUID.test(r.guid || '')) flagged.push({ flow: r.flow === 'Capture' ? 'recording' : 'playback', guid: r.guid, name: r.name || '', effects });
  }
  return { flagged, icue: false };
}

let cache = { at: 0, key: '', value: null };
const listOf = (guids = {}) => [...(guids.render || []).map((g) => ['Render', g]), ...(guids.capture || []).map((g) => ['Capture', g])].filter(([, g]) => GUID.test(g || ''));
async function check(guids, { fresh = false } = {}) {
  const list = listOf(guids), key = JSON.stringify(list);
  if (!list.length) return { flagged: [], icue: null };
  if (!fresh && cache.value && cache.key === key && Date.now() - cache.at < 30000) return cache.value;
  const value = fromRead(await deps.read(list));
  cache = { at: Date.now(), key, value };
  return value;
}

let busy = false;
const files = () => { const d = path.join(deps.root, 'logs'); return { dir: d, result: path.join(d, 'corsair-apo-fix.result.txt'), started: path.join(d, 'corsair-apo-fix.started.txt'), cancel: path.join(d, 'corsair-apo-fix.cancel.txt') }; };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim(); } catch { return ''; } };
const drop = (f) => { try { fs.rmSync(f, { force: true }); } catch {} };

async function fix(guids) {
  if (busy) throw new Error('already fixing; wait for it to finish');
  busy = true;
  try {
    const now = await check(guids, { fresh: true });
    if (!now.flagged.length) return { ok: true, text: 'Nothing to fix.', corsairApo: now };
    const f = files();
    fs.mkdirSync(f.dir, { recursive: true });
    const backups = path.join(deps.root, 'backups');
    fs.mkdirSync(backups, { recursive: true });
    for (const x of [f.result, f.started, f.cancel]) drop(x);
    const ac = new AbortController();
    let unanswered = false;
    const timer = setTimeout(() => { if (!fs.existsSync(f.started)) { unanswered = true; try { fs.writeFileSync(f.cancel, 'cancel'); } catch {} ac.abort(); } }, deps.uacWaitMs);
    const r = await deps.elevate({ DH_SCRIPT: FIX, DH_GUIDS: now.flagged.map((x) => x.guid).join(','), DH_BACKUPS: backups, DH_RESULT: f.result, DH_STARTED: f.started, DH_CANCEL: f.cancel }, ac.signal);
    clearTimeout(timer);
    const out = readText(f.result);
    cache.at = 0;
    const after = await check(guids, { fresh: true }).catch(() => now);
    if (unanswered) { deps.record({ outcome: 'unanswered' }); return { ok: false, uac: 'unanswered', text: "Windows' prompt was not answered within 2 minutes. Nothing was changed.", corsairApo: after }; }
    if (r.declined || (r.error && !fs.existsSync(f.started))) { deps.record({ outcome: 'declined' }); return { ok: false, uac: 'declined', text: "Windows' prompt was declined. Nothing was changed.", corsairApo: after }; }
    deps.record({ outcome: 'yes' });
    if (r.code === 0 && out.startsWith('ok|')) return { ok: !after.flagged.length, text: after.flagged.length ? 'Changed, but Corsair\'s effects still show. Try again.' : 'Fixed. Sound is back.', corsairApo: after };
    return { ok: false, text: `Not fixed: ${out.startsWith('failed|') ? out.slice(7) : r.error || `code ${r.code}`}.`, corsairApo: after };
  } finally { busy = false; }
}

module.exports = { check, fix, _test: { deps, fromRead, files, ELEVATE, reset: () => { cache = { at: 0, key: '', value: null }; busy = false; } } };
