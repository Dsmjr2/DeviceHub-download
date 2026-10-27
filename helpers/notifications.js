// Windows notifications on or off for game mode (27 Oct 2026, helpers/game-mode.mjs): the per-user value Settings >
// System > Notifications writes, HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications ToastEnabled
// (DWORD 1 = on, 0 = off; not there = Windows' default, on). Only this one value of the signed-in user, read before and
// put back after, with reg.exe; nothing needs administrator. Windows 11's Do not disturb itself lives in an undocumented
// settings blob, so DeviceHub does not write it.
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications';
const VALUE = 'ToastEnabled';
let run = (args) => new Promise((resolve, reject) => execFile('reg', args, { windowsHide: true, timeout: 8000 }, (e, out, err) => (e ? Object.assign(e, { out: String(out || ''), err: String(err || '') }) && reject(e) : resolve(String(out || '')))));

// 1, 0, or null when the value is not there
async function read() {
  let out;
  try { out = await run(['query', KEY, '/v', VALUE]); } catch (e) { if (e.code === 1) return null; throw e; }
  const m = /ToastEnabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
  return m ? parseInt(m[1], 16) : null;
}
// v: 0 | 1, or null to remove the value (as it was when it was not there)
async function set(v) {
  if (v === null) { try { await run(['delete', KEY, '/v', VALUE, '/f']); } catch (e) { if (e.code !== 1) throw e; } return; }
  if (v !== 0 && v !== 1) throw new Error('notifications value must be 0 or 1');
  await run(['add', KEY, '/v', VALUE, '/t', 'REG_DWORD', '/d', String(v), '/f']);
}

module.exports = { read, set, KEY, VALUE, _test: { setRun: (f) => { run = f; } } };
