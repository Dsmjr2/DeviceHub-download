# DeviceHub Wi-Fi pause (26 Oct 2026; helpers/wifi-pause.mjs). Pauses or resumes Windows' Wi-Fi background scan
# (netsh wlan autoconfig) on Wi-Fi interfaces only. Runs ONLY as the hash-checked copy in
# C:\Program Files\DeviceHub Wi-Fi pause\ (admin-only), started by the tasks "DeviceHub Wi-Fi pause" (-Mode pause) and
# "DeviceHub Wi-Fi resume" (-Mode resume, also at every sign-in). Each task passes a fixed mode and this file's SHA-256.
#   pause:  scans off on the connected Wi-Fi interfaces, then stays to watch: resumes after 4 hours, when DeviceHub
#           stops answering on 127.0.0.1:5577, or when the Wi-Fi is disconnected for more than 10 s. It also sets a
#           one-time resume trigger at the 4-hour mark, so even a killed watcher cannot leave scans off.
#   resume: stops the watcher, scans on for every Wi-Fi interface, the resume task back to its sign-in trigger only.
# Exit codes: 0 done, 2 not an allowed mode, 3 hash mismatch, 5 not in its protected folder, 6 no Wi-Fi in use,
# 7 the 4-hour resume could not be set (nothing paused).
param([string]$Mode = '', [string]$Expect = '')
$ErrorActionPreference = 'Stop'

# 1. only two modes, exact
if (@('pause', 'resume') -cnotcontains $Mode) { exit 2 }
# 2. this file's own SHA-256, as the task was registered with
$me = $PSCommandPath
$h = (Get-FileHash -LiteralPath $me -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Expect -notmatch '^[0-9a-f]{64}$' -or $h -ne $Expect) { exit 3 }
# 3. only the protected copy runs
$dest = Join-Path $env:ProgramFiles 'DeviceHub Wi-Fi pause'
if (-not [string]::Equals((Split-Path -Parent $me), $dest, [StringComparison]::OrdinalIgnoreCase)) { exit 5 }

$netsh = Join-Path $env:SystemRoot 'System32\netsh.exe'
$pauseTask = 'DeviceHub Wi-Fi pause'
$resumeTask = 'DeviceHub Wi-Fi resume'
$maxHours = 4
$dropSeconds = 10
$hubPort = 5577

# a name netsh printed, used as one quoted argument: no quotes, no control characters
function Test-Name([string]$n) { return ($n -and $n.Length -le 128 -and $n -notmatch '["\x00-\x1f]') }
# the Wi-Fi interfaces from netsh wlan show interfaces: name and state
function Get-Wlans {
  $out = & $netsh wlan show interfaces 2>$null | Out-String
  $list = @(); $cur = $null
  foreach ($ln in ($out -split "`r?`n")) {
    $m = [regex]::Match($ln, '^\s*Name\s*:\s*(.+?)\s*$')
    if ($m.Success) { $cur = @{ name = $m.Groups[1].Value; state = '' }; $list += $cur; continue }
    $s = [regex]::Match($ln, '^\s*State\s*:\s*(.+?)\s*$')
    if ($s.Success -and $cur) { $cur.state = $s.Groups[1].Value }
  }
  return @($list | Where-Object { Test-Name $_.name })
}
function Get-Connected { return @(Get-Wlans | Where-Object { $_.state -eq 'connected' }) }
function Set-Scan([string]$name, [string]$on) {
  if (-not (Test-Name $name)) { return }
  & $netsh wlan set autoconfig "enabled=$on" "interface=$name" | Out-Null
}
# scans on for every Wi-Fi interface: netsh's names plus Windows' native 802.11 adapters (any language)
function Resume-All {
  $names = @(Get-Wlans | ForEach-Object { $_.name })
  try { $names += @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.NdisPhysicalMedium -eq 9 } | ForEach-Object { $_.Name }) } catch {}
  foreach ($n in ($names | Select-Object -Unique)) { try { Set-Scan $n 'yes' } catch {} }
  # the resume task back to its one trigger: sign-in
  try { $u = (Get-ScheduledTask -TaskName $resumeTask -ErrorAction Stop).Principal.UserId; Set-ScheduledTask -TaskName $resumeTask -Trigger @(New-ScheduledTaskTrigger -AtLogOn -User $u) | Out-Null } catch {}
}
function Test-Hub {
  try { return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $hubPort -State Listen -ErrorAction Stop) } catch { return $false }
}

if ($Mode -eq 'resume') {
  try { Stop-ScheduledTask -TaskName $pauseTask -ErrorAction SilentlyContinue } catch {}
  Resume-All
  exit 0
}

# pause
$wifi = @(Get-Connected)
if (-not $wifi.Count) { exit 6 }
$until = (Get-Date).AddHours($maxHours)
try {
  $u = (Get-ScheduledTask -TaskName $resumeTask -ErrorAction Stop).Principal.UserId
  Set-ScheduledTask -TaskName $resumeTask -Trigger @((New-ScheduledTaskTrigger -AtLogOn -User $u), (New-ScheduledTaskTrigger -Once -At $until.AddMinutes(1))) | Out-Null
} catch { exit 7 }
try {
  foreach ($w in $wifi) { Set-Scan $w.name 'no' }
  $down = $null; $miss = 0
  while ($true) {
    Start-Sleep -Seconds 2
    if ((Get-Date) -ge $until) { break }
    if (Test-Hub) { $miss = 0 } else { $miss++; if ($miss -ge 3) { break } }
    if (@(Get-Connected).Count) { $down = $null }
    elseif (-not $down) { $down = Get-Date }
    elseif (((Get-Date) - $down).TotalSeconds -gt $dropSeconds) { break }
  }
} finally {
  Resume-All
}
exit 0
