// Is Equalizer APO switched on for the headset's sound devices? (20 Oct 2026: after iCUE's audio driver was removed,
// Windows gave the HS80 new sound devices and the EQ silently stopped until they were ticked in Equalizer APO's
// Device Selector.) Read-only: Windows' own list of sound devices in the registry (MMDevices), whether each is active
// and whether Equalizer APO's audio effect is installed on it. turnOn() opens Equalizer APO's Device Selector (with
// a Windows admin prompt) for the person to tick them; DeviceHub never edits those registry entries itself.
const { execFile, spawn } = require('child_process');
const path = require('path');

const APO_CLSID = 'EACD2258-FCAC-4FF4-B36D-419E924A6D79';   // Equalizer APO's audio effect
const DIR = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'EqualizerAPO');
let cache = { at: 0, key: '', value: null };

// guids: { render: ['{...}'], capture: ['{...}'] } -> the active ones, each with on: true / false
function status(guids) {
  const key = JSON.stringify(guids);
  if (cache.value && cache.key === key && Date.now() - cache.at < 30000) return Promise.resolve(cache.value);
  const list = [...(guids.render || []).map((g) => ['Render', g]), ...(guids.capture || []).map((g) => ['Capture', g])].filter(([, g]) => /^\{[0-9a-f-]{36}\}$/i.test(g));
  if (!list.length) return Promise.resolve({ checked: 0, off: [] });
  const ps = list.map(([b, g]) => `$k='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\${b}\\${g}'; $s=(Get-ItemProperty $k -ErrorAction SilentlyContinue).DeviceState; $fx=Get-ItemProperty (Join-Path $k 'FxProperties') -ErrorAction SilentlyContinue; $on=[bool]($fx.PSObject.Properties | Where-Object { "$($_.Value)" -match '${APO_CLSID}' }); $n=(Get-ItemProperty (Join-Path $k 'Properties') -ErrorAction SilentlyContinue).'{a45c254e-df1c-4efd-8020-67d146a850e0},2'; '${b}|${g}|' + $s + '|' + $on + '|' + $n`).join('; ');
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + ps], { windowsHide: true, timeout: 20000 }, (err, out) => {
    const rows = String(out || '').trim().split(/\r?\n/).filter(Boolean).map((l) => { const [flow, guid, state, on, name] = l.split('|'); return { flow, guid, active: state === '1', on: on === 'True', name }; });
    // only devices Windows is using now count (the old ones of a replaced driver stay listed as not present)
    const live = rows.filter((r) => r.active);
    const value = { checked: live.length, off: live.filter((r) => !r.on).map((r) => ({ flow: r.flow === 'Render' ? 'playback' : 'recording', name: r.name })) };
    cache = { at: Date.now(), key, value };
    resolve(value);
  }));
}

// Equalizer APO's Device Selector, elevated. Its Qt plugins sit in qt\ beside it and it does not find them when
// started from another folder ("no Qt platform plugin"), so it is started from its own folder with the path given.
function turnOn() {
  const exe = path.join(DIR, 'DeviceSelector.exe');
  const cmd = `$d='${DIR}'; Start-Process cmd.exe -ArgumentList ('/c set "QT_PLUGIN_PATH=' + $d + '\\qt" && set "QT_QPA_PLATFORM_PLUGIN_PATH=' + $d + '\\qt\\platforms" && start "" "' + $d + '\\DeviceSelector.exe"') -WorkingDirectory $d -Verb RunAs -WindowStyle Hidden`;
  return new Promise((resolve, reject) => {
    if (!require('fs').existsSync(exe)) return reject(new Error('Equalizer APO\'s Device Selector is not on this PC'));
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    // Windows' permission box (24 Oct 2026, helpers/uac.mjs): Start-Process -Verb RunAs returns once it is answered;
    // not answered within 2 minutes, the wait stops. Declined or not answered is recorded for Get help.
    const say = (outcome) => import('./uac.mjs').then((u) => u.record({ area: 'sound', action: "open Equalizer APO's Device Selector", outcome })).catch(() => {});
    let gaveUp = false;
    const timer = setTimeout(() => { gaveUp = true; say('unanswered'); try { spawn('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); } catch {} reject(Object.assign(new Error("Windows' permission box was not answered within 2 minutes. If it is still open, close it (No), then press Turn on again."), { uac: 'unanswered' })); }, 2 * 60 * 1000);
    p.on('exit', (code) => { clearTimeout(timer); if (gaveUp) return; cache.at = 0; say(code === 0 ? 'yes' : 'declined'); code === 0 ? resolve({ started: true }) : reject(Object.assign(new Error("Windows' permission box was declined, so the Device Selector did not open. Press Turn on again and choose Yes."), { uac: 'declined' })); });
  });
}

module.exports = { status, turnOn };
