// "Sleep after" on the Laptop page (2 Nov 2026, Shawn: "make a dropdown field on the power plan where it decides when my
// pc sleeps so I can change it quickly"). The active power plan's sleep timeout, plugged in (ac) and on battery (dc),
// through helpers/sleep-timer.ps1 (Windows' power API, the same setting as Settings > System > Power > Screen and sleep).
//   GET  /api/sleep            { ok, ac, dc, battery, choices, undo } (seconds, 0 = never)
//   POST /api/sleep            { which: 'ac' | 'dc', value }: on the person's pick, one at a time
//   POST /api/sleep/undo       puts back what the last change replaced
// Every change: read first, the old values backed up (backups/sleep-<time>.json), one value written, read back and
// compared. Only values from CHOICES (or the one Undo puts back) are written; nothing but this one setting on the
// active plan is ever changed, and no administrator rights are asked for.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CHOICES = [60, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 7200, 10800, 18000, 0];
const PS = path.join(__dirname, 'sleep-timer.ps1');

function runPs(args = []) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { windowsHide: true, timeout: 30000 }, (e, out) => {
      let r = null;
      try { r = JSON.parse(String(out || '').trim().split(/\r?\n/).pop()); } catch {}
      resolve(r && typeof r === 'object' ? r : { ok: false, why: e ? e.message : 'no answer' });
    });
  });
}

// run, writeFile and now are passed in by the tests
// the four values (3 Nov 2026: the screen's too): which -> the script's argument and its name in Activity
const WHICH = {
  ac: { arg: '-Ac', name: 'Sleep after', where: 'plugged in' }, dc: { arg: '-Dc', name: 'Sleep after', where: 'on battery' },
  screenAc: { arg: '-ScreenAc', name: 'Screen off after', where: 'plugged in' }, screenDc: { arg: '-ScreenDc', name: 'Screen off after', where: 'on battery' },
};
function create({ run = runPs, backupDir = null, writeFile = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }, log = () => {}, now = () => new Date() } = {}) {
  let busy = false, undo = null;
  const view = (r) => (r.ok ? { ok: true, ac: r.ac, dc: r.dc, screenAc: r.screenAc, screenDc: r.screenDc, battery: !!r.battery, modernStandby: !!r.modernStandby, choices: CHOICES, undo } : r);
  async function read() { return view(await run()); }
  async function change(which, value, { undoing = false } = {}) {
    if (!WHICH[which]) throw Object.assign(new Error(`which: ${Object.keys(WHICH).join(', ')}`), { code: 400 });
    if (!Number.isInteger(value) || !(CHOICES.includes(value) || (undoing && value >= 0))) throw Object.assign(new Error(`not one of the choices: ${value}`), { code: 400 });
    if (busy) throw Object.assign(new Error('Another change is still being made.'), { code: 409 });
    busy = true;
    try {
      const before = await run();
      if (!before.ok) throw new Error(before.why || 'Sleep after could not be read');
      if (before[which] === value) return view(before);
      const at = now().toISOString();
      if (backupDir) writeFile(path.join(backupDir, `sleep-${at.replace(/[:.]/g, '-')}.json`), JSON.stringify({ at, plan: before.plan, ac: before.ac, dc: before.dc, screenAc: before.screenAc, screenDc: before.screenDc, change: { which, value } }, null, 1));
      const w = WHICH[which];
      const after = await run([w.arg, String(value)]);
      if (!after.ok) throw new Error(after.why || `${w.name} could not be changed`);
      if (after[which] !== value) { log({ kind: 'bad', text: `${w.name} (${w.where}) not changed: it reads ${label(after[which])}` }); throw new Error(`Windows reads ${label(after[which])} after setting ${label(value)}`); }
      undo = undoing ? null : { which, value: before[which] };
      log({ kind: 'good', text: `${w.name} (${w.where}): ${label(before[which])} → ${label(value)}` });
      return view(after);
    } finally { busy = false; }
  }
  async function revert() {
    if (!undo) throw Object.assign(new Error('Nothing to undo.'), { code: 400 });
    return change(undo.which, undo.value, { undoing: true });
  }
  return { read, change, revert };
}

function label(s) {
  if (s == null) return 'unknown';
  if (s === 0) return 'Never';
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

module.exports = { create, CHOICES, label, WHICH };
