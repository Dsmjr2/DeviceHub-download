// A laptop's built-in screen (22 Oct 2026, Shawn: "on my laptop it says turn on ddc/ci in this monitors menu to control
// it here"). A built-in panel has no DDC/CI to turn on; Windows sets its brightness through WMI instead:
//   root/wmi WmiMonitorBrightness        CurrentBrightness (0-100), InstanceName  (read)
//   root/wmi WmiMonitorBrightnessMethods WmiSetBrightness(Timeout, Brightness)     (write)
// (learn.microsoft.com/windows/win32/wmicoreprov/wmimonitorbrightness and .../wmisetbrightness-method-in-class-wmimonitorbrightnessmethods)
// helpers/monitors.js uses this only for a screen that does not answer over DDC/CI, matched by its hardware id; every
// change is backed up, written once and read back there. PowerShell runs hidden; the instance and the value reach the
// script through environment variables, never as part of its text.
const { execFile } = require('child_process');

const PS_READ = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$r = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | ForEach-Object { [ordered]@{ instance = $_.InstanceName; value = [int]$_.CurrentBrightness; active = [bool]$_.Active } })
ConvertTo-Json -Compress -InputObject $r`;
const PS_SET = `$ErrorActionPreference = 'Stop'
$m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Where-Object { $_.InstanceName -eq $env:DEVICEHUB_WMI_INSTANCE }
if (-not $m) { throw 'that screen is not there now' }
Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$env:DEVICEHUB_WMI_VALUE } | Out-Null`;

function run(script, extraEnv = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 15000, env: { ...process.env, ...extraEnv } },
    (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n')[0] || 'Windows did not answer')) : resolve(String(out || '')))));
}

// WMI's answer -> [{ instance, value }]
function parse(json) {
  let j; try { j = JSON.parse(String(json || '').trim() || '[]'); } catch { return []; }
  return (Array.isArray(j) ? j : [j]).filter((x) => x && typeof x.instance === 'string' && Number.isInteger(x.value) && x.value >= 0 && x.value <= 100)
    .map((x) => ({ instance: x.instance, value: x.value }));
}

// a monitor id from helpers/monitors.cs ("BOE0A1C#4&2a3b4c&0&UID8388688") and a WMI instance
// ("DISPLAY\\BOE0A1C\\4&2a3b4c&0&UID8388688_0") name the same screen when model and instance agree; with no exact match,
// the one WMI screen of the same model (never a guess between two)
const parts = (wmi) => { const p = String(wmi).split('\\'); return { model: (p[1] || '').toUpperCase(), inst: (p[2] || '').replace(/_\d+$/, '').toUpperCase() }; };
function match(monitorId, screens) {
  const [model = '', inst = ''] = String(monitorId).toUpperCase().split('#');
  const exact = screens.find((s) => { const q = parts(s.instance); return q.model === model && q.inst === inst; });
  if (exact) return exact;
  const same = screens.filter((s) => parts(s.instance).model === model);
  return same.length === 1 ? same[0] : null;
}

let cache = { at: 0, list: [] };
async function read(fresh = false) {
  if (process.platform !== 'win32') return [];
  if (!fresh && Date.now() - cache.at < 10000) return cache.list;
  try { cache = { at: Date.now(), list: parse(await run(PS_READ)) }; } catch { cache = { at: Date.now(), list: [] }; }
  return cache.list;
}
async function set(instance, value) {
  if (process.platform !== 'win32') throw new Error('only on Windows');
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('brightness must be 0-100');
  await run(PS_SET, { DEVICEHUB_WMI_INSTANCE: instance, DEVICEHUB_WMI_VALUE: String(value) });
  const back = (await read(true)).find((s) => s.instance === instance);
  return back ? back.value : null;
}

module.exports = { read, set, _test: { parse, match, PS_READ, PS_SET } };
