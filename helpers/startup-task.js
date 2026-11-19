// Start with Windows as a sign-in task (18 Nov 2026, Shawn: "Yes, switch it"). The Startup folder shortcut it replaces
// was started by Windows 11-24 s after sign-in on Shawn's PC (data\startup-impact.json, four sign-ins); a task with a
// sign-in trigger runs as soon as he signs in. It is the person's own task: made without admin rights, runs only for
// them, only DeviceHub.vbs /background, and at normal priority (a task's programs run below normal unless it says so,
// and DeviceHub's server and helper would inherit that). If Windows refuses it, server.js keeps the shortcut instead.
//   status()        true when the task is there
//   enable(root)    makes (or replaces) the task for DeviceHub.vbs in root; resolves { ok, error }
//   disable()       removes it; resolves { ok, error }
// The uninstaller removes it too (helpers/uninstall-plan.mjs, without a prompt: it is not an admin task).
const { execFile } = require('child_process');
const path = require('path');

const TASK = 'DeviceHub start';
const deps = {
  run: (file, args, env = {}) => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 30000, env: { ...process.env, ...env } }, (err, out, errOut) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(errOut || (err && err.message) || '') }))),
};
const ps = (script, env) => deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], env);

async function status() {
  const r = await deps.run('schtasks.exe', ['/query', '/tn', TASK]);
  return r.code === 0;
}

// the folder comes in DH_ROOT and the user in USERDOMAIN/USERNAME, so no path is ever pasted into the script text
const ENABLE_PS = [
  "$ErrorActionPreference = 'Stop'",
  '$root = $env:DH_ROOT',
  "$vbs = Join-Path $root 'DeviceHub.vbs'",
  "if (-not (Test-Path -LiteralPath $vbs)) { throw \"DeviceHub.vbs is not in $root\" }",
  '$me = "$env:USERDOMAIN\\$env:USERNAME"',
  "$a = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\\wscript.exe') -Argument ('\"' + $vbs + '\" /background') -WorkingDirectory $root",
  '$t = New-ScheduledTaskTrigger -AtLogOn -User $me',
  '$p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited',
  // Priority 4 = normal (the default 7 is below normal); no time limit (wscript ends at once, DeviceHub keeps running)
  '$s = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
  `Register-ScheduledTask -TaskName '${TASK}' -Description 'Starts DeviceHub in the tray when you sign in (Settings > Start with Windows).' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
  "'OK'",
].join('; ');

async function enable(root) {
  const r = await ps(ENABLE_PS, { DH_ROOT: path.resolve(root) });
  if (r.code === 0 && /OK/.test(r.out)) return { ok: true };
  return { ok: false, error: (r.err || r.out).trim().split(/\r?\n/)[0] || 'the task could not be made' };
}

async function disable() {
  if (!(await status())) return { ok: true };
  const r = await deps.run('schtasks.exe', ['/delete', '/tn', TASK, '/f']);
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.err || r.out).trim().split(/\r?\n/)[0] };
}

module.exports = { TASK, status, enable, disable, ENABLE_PS, deps };
