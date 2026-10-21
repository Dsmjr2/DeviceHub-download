# Health recording (20 Oct 2026), read-only: DeviceHub's health every 30 minutes for 12 hours into health-watch.csv in
# the DeviceHub folder (not in git). Runs as its own hidden process, so it keeps going whatever else closes:
#   Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','helpers\health-watch.ps1'
# Columns: time, server and helper memory (MB), the helper's handles, minutes running, crash restarts in 24 h, each
# device's state, how many monitors answered and how long that took. Nothing is changed.
param([int]$hours = 12, [int]$everyMin = 30)
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'health-watch.csv'
'time,server_mb,helper_mb,helper_handles,uptime_min,crashes_24h,mouse,headset,keyboard,monitors,monitor_read_s' | Set-Content $out
$rounds = [int]($hours * 60 / $everyMin)
for ($i = 0; $i -le $rounds; $i++) {
  $t = (Get-Date).ToString('MM-dd HH:mm')
  try {
    $x = Invoke-RestMethod http://127.0.0.1:5577/api/health -TimeoutSec 30
    $d = @{}; (Invoke-RestMethod http://127.0.0.1:5577/api/agent/state -TimeoutSec 15).devices | ForEach-Object { $d[$_.id] = $_.status }
    $sw = [Diagnostics.Stopwatch]::StartNew(); $mons = @(Invoke-RestMethod 'http://127.0.0.1:5577/api/monitors?fresh=1' -TimeoutSec 40 | Where-Object { $_.ddc }).Count; $ms = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $h = (Get-Process DeviceHubHelper -ErrorAction SilentlyContinue | Select-Object -First 1).HandleCount
    $row = @($t, $x.serverMB, $x.helperMB, $h, [math]::Round($x.uptimeS / 60), $x.crashes24h, $d.mouse, $d.headset, $d.keyboard, $mons, $ms) -join ','
  } catch { $row = "$t,no answer,,,,,,,,," }
  Add-Content $out $row
  if ($i -lt $rounds) { Start-Sleep ($everyMin * 60) }
}
