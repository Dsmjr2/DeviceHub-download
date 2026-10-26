// Display settings per screen (24 Oct 2026, Shawn picked it; docs/handoff/display-health.md): resolution, refresh rate,
// HDR and which screen is main, through Windows' own display APIs (helpers/display.ps1 over helpers/pc-native.cs).
// Night light is shown read only (its state is an undocumented settings blob; Settings changes it).
// The rules, as Windows does it and as DeviceHub does for devices:
// - one change at a time: a second waits until the first is kept or undone;
// - every screen's settings are backed up first (backups/display-<time>.json);
// - a mode is tested first (CDS_TEST) and applied for this session only; the change is read back;
// - then 15 seconds of "Keep this?": Keep saves it, Undo or no answer puts the backed-up settings back, read back again.
// Read on page open and on demand only; nothing here runs in the background except that 15-second timer.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const KEEP_MS = 15000;
const PS1 = path.join(__dirname, 'display.ps1');

// one run of helpers/display.ps1; the values reach it through the environment
function runPs(op, values = {}) {
  const env = { ...process.env, DEVICEHUB_DISPLAY_OP: op };
  for (const [k, v] of Object.entries(values)) env[`DEVICEHUB_DISPLAY_${k.toUpperCase()}`] = String(v);
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1],
    { windowsHide: true, timeout: 30000, env }, (e, out) => {
      let j = null; try { j = JSON.parse(String(out || '').trim().split(/\r?\n/).pop()); } catch {}
      if (j?.ok) return resolve(j.result);
      reject(new Error(j?.error || (e ? String(e.message).split('\n')[0] : 'Windows did not answer')));
    }));
}

// the read through the native helper first (helpers/pc-reads.cs op display-read: the same { screens, nightLight } the
// script prints, with no PowerShell start and no Add-Type compile, 26 Oct 2026); the script when the helper cannot
// answer. Every change (mode, hdr, primary) stays on helpers/display.ps1, as before.
function runAny(op, values = {}) {
  if (op !== 'read') return runPs(op, values);
  return require('./helper-reads').read('display-read', { ps: () => runPs('read') });
}

// ---- pure parts (tests/display-health.mjs) ----

// Night light's state blob (HKCU CloudStore bluelightreductionstate, as hex bytes): byte 18 is 0x15 when on and 0x13
// when off. Not documented by Microsoft, so read only, and anything else is "not known".
function nightLight(hex) {
  const b = String(hex || '').trim().split(/\s+/).filter(Boolean).map((x) => parseInt(x, 16));
  if (b.length < 20 || b[0] !== 0x43 || b[1] !== 0x42) return null;
  return b[18] === 0x15 ? true : b[18] === 0x13 ? false : null;
}

// the highest refresh rate a screen offers at a resolution
const maxHzAt = (modes, w, h) => Math.max(0, ...modes.filter(([mw, mh]) => mw === w && mh === h).map(([, , hz]) => hz));

// A screen running below the highest refresh rate it offers at its current resolution (143 vs 144 Hz is the same rate
// written two ways, so 2 Hz or less is not flagged): the line and the one-click fix
function refreshFlag(s) {
  const top = maxHzAt(s.modes || [], s.width, s.height);
  if (!top || top <= s.hz + 2) return null;
  return { text: `Running at ${s.hz} Hz; this screen does ${top} Hz.`, fix: { width: s.width, height: s.height, hz: top } };
}

// one screen as the page shows it: its resolutions (largest first) and the rates at each
function shape(s) {
  const modes = (s.modes || []).filter((m) => Array.isArray(m) && m.length === 3).map((m) => m.map(Number));
  const res = [...new Set(modes.map(([w, h]) => `${w}x${h}`))].map((k) => k.split('x').map(Number)).sort((a, b) => b[0] * b[1] - a[0] * a[1] || b[0] - a[0]);
  const rates = (w, h) => [...new Set(modes.filter(([mw, mh]) => mw === w && mh === h).map(([, , hz]) => hz))].sort((a, b) => b - a);
  return {
    screen: s.screen, id: s.id || null, name: s.name || 'Screen', adapter: s.adapter || null, primary: !!s.primary,
    width: s.width, height: s.height, hz: s.hz, x: s.x, y: s.y,
    resolutions: res.map(([w, h]) => ({ width: w, height: h, rates: rates(w, h) })),
    hdr: s.hdr ? { supported: !!s.hdr.supported, on: !!s.hdr.on } : null,
    flag: refreshFlag({ ...s, modes }),
    modes,
  };
}

// what one screen's settings are, for a backup and for putting them back
const snapshot = (s) => ({ screen: s.screen, id: s.id, name: s.name, width: s.width, height: s.height, hz: s.hz, x: s.x, y: s.y, primary: s.primary, hdr: s.hdr ? s.hdr.on : null });

// does a fresh reading show the change? (kind: mode | hdr | primary)
function confirms(kind, value, s) {
  if (!s) return false;
  if (kind === 'mode') return s.width === value.width && s.height === value.height && Math.abs(s.hz - value.hz) <= 1;
  if (kind === 'hdr') return !!s.hdr && s.hdr.on === !!value;
  if (kind === 'primary') return s.primary === true;
  return false;
}
const describe = (kind, value) => (kind === 'mode' ? `${value.width} x ${value.height} at ${value.hz} Hz` : kind === 'hdr' ? `HDR ${value ? 'on' : 'off'}` : 'main screen');

// ---- the display controller; run, timers, clock and the backup writer are passed in so the tests use fakes ----
function create({ run = runAny, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, backupDir = null, writeFile = (f, t) => fs.writeFileSync(f, t), log = () => {} } = {}) {
  let pending = null, last = null, busy = false;

  async function read() {
    const r = await run('read');
    return { screens: (r.screens || []).map(shape), nightLight: nightLight(r.nightLight) };
  }
  const find = (list, screen) => list.screens.find((s) => s.screen === screen);

  function state() {
    return {
      pending: pending ? { screen: pending.screen, name: pending.name, kind: pending.kind, text: pending.text, secondsLeft: Math.max(0, Math.ceil((pending.until - now()) / 1000)) } : null,
      last,
    };
  }

  // put one change's backed-up setting back, and read it back
  async function putBack(p) {
    const b = p.before;
    if (p.kind === 'mode') await run('mode', { screen: b.screen, width: b.width, height: b.height, hz: b.hz, persist: 1 });
    else if (p.kind === 'hdr') await run('hdr', { screen: b.screen, on: b.hdr ? 1 : 0 });
    else if (p.kind === 'primary') await run('primary', { screen: p.wasPrimary });
    const after = await read();
    const s = find(after, b.screen);
    const ok = p.kind === 'mode' ? confirms('mode', b, s) : p.kind === 'hdr' ? confirms('hdr', b.hdr, s) : confirms('primary', true, find(after, p.wasPrimary));
    return ok;
  }

  async function revert(why = 'undone') {
    const p = pending;
    if (!p) return state();
    pending = null; clearTimer(p.timer);
    let ok = false;
    try { ok = await putBack(p); } catch (e) { log(`display: putting ${p.name} back failed: ${e.message}`); }
    last = ok ? { ok: true, text: why === 'timeout' ? `${p.name}: not kept, so it is back as it was.` : `${p.name}: back as it was.` }
      : { ok: false, text: `${p.name}: could not be put back. Open Windows display settings to fix it.` };
    log(last.text);
    return state();
  }

  async function keep() {
    const p = pending;
    if (!p) throw new Error('Nothing is waiting to be kept.');
    clearTimer(p.timer);
    try {
      // a mode was applied for this session only: now it is saved, and read back once more
      if (p.kind === 'mode') {
        await run('mode', { screen: p.screen, width: p.value.width, height: p.value.height, hz: p.value.hz, persist: 1 });
        const s = find(await read(), p.screen);
        if (!confirms('mode', p.value, s)) throw new Error('Windows did not keep it');
      }
    } catch (e) { pending = p; await revert('failed'); last = { ok: false, text: `${p.name}: not kept (${e.message}), so it is back as it was.` }; return state(); }
    pending = null;
    last = { ok: true, text: `${p.name}: ${p.text} kept.` };
    log(last.text);
    return state();
  }

  // one change: kind mode { width, height, hz } | hdr true/false | primary true
  async function change(screen, kind, value) {
    if (pending) throw new Error('Keep or undo the last change first.');
    if (busy) throw new Error('A change is being made. Try again in a moment.');
    busy = true;
    try {
      const list = await read();
      const s = find(list, screen);
      if (!s) throw new Error('That screen is not there now.');
      if (kind === 'mode') {
        const v = { width: Number(value?.width), height: Number(value?.height), hz: Number(value?.hz) };
        if (!s.modes.some(([w, h, hz]) => w === v.width && h === v.height && hz === v.hz)) throw new Error('This screen does not offer that mode.');
        if (confirms('mode', v, s)) throw new Error('It is already set that way.');
        value = v;
      } else if (kind === 'hdr') {
        value = value === true;
        if (!s.hdr?.supported) throw new Error('This screen does not offer HDR.');
        if (s.hdr.on === value) throw new Error('It is already set that way.');
      } else if (kind === 'primary') {
        if (s.primary) throw new Error('It is already the main screen.');
        value = true;
      } else throw new Error('Unknown setting.');
      // every screen's settings, backed up before anything changes
      const at = new Date(now()).toISOString();
      const backup = { at, change: { screen, kind, value }, screens: list.screens.map(snapshot), nightLight: list.nightLight };
      if (backupDir) writeFile(path.join(backupDir, `display-${at.replace(/[:.]/g, '-')}.json`), JSON.stringify(backup, null, 1));
      const p = { screen, name: s.name, kind, value, text: describe(kind, value), before: snapshot(s), wasPrimary: (list.screens.find((x) => x.primary) || {}).screen };
      if (kind === 'mode') await run('mode', { screen, width: value.width, height: value.height, hz: value.hz, persist: 0 });
      else if (kind === 'hdr') await run('hdr', { screen, on: value ? 1 : 0 });
      else {
        // the main screen is saved screen by screen and applied at once; a refusal half way puts the old main back
        try { await run('primary', { screen }); } catch (e) { await run('primary', { screen: p.wasPrimary }).catch(() => {}); throw e; }
      }
      // read back: a change Windows does not show is put back at once
      const after = find(await read(), screen);
      if (!confirms(kind, value, after)) {
        pending = p; await revert('failed');
        last = { ok: false, text: `${s.name}: Windows did not take ${p.text}, so it is back as it was.` };
        return state();
      }
      // HDR never leaves a screen blank, so it is done at once (24 Oct 2026, Shawn: "hdr button is
      // slow"); a resolution, refresh rate or main screen change still waits 15 s for Keep
      if (kind === 'hdr') {
        last = { ok: true, text: `${s.name}: ${p.text}.` };
        log(`display: ${last.text}`);
        return state();
      }
      p.until = now() + KEEP_MS;
      p.timer = setTimer(() => { revert('timeout').catch(() => {}); }, KEEP_MS);
      pending = p; last = null;
      log(`display: ${s.name}: ${p.text} (keep within 15 s)`);
      return state();
    } finally { busy = false; }
  }

  return { read, change, keep, revert: () => revert('undone'), state };
}

module.exports = { create, KEEP_MS, _test: { nightLight, refreshFlag, shape, confirms, maxHzAt, runPs, runAny } };
