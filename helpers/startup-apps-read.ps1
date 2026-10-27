# What starts with Windows, read-only (27 Oct 2026, helpers/startup-apps.js): the same places Task Manager's Startup apps
# reads, each with its StartupApproved bytes as hex, the program it starts, and that program's maker and description.
#   Run keys: HKCU\...\Run, HKLM\...\Run, HKLM\SOFTWARE\WOW6432Node\...\Run
#   Startup folders: the user's and all users'
#   StartupApproved (HKCU and HKLM ...\Explorer\StartupApproved): Run, Run32, StartupFolder
# Also Windows' own sign-in timing (Microsoft-Windows-Diagnostics-Performance/Operational, events 100 and 101), which
# only an administrator can read: when it can't be read, "impact" says why and nothing is measured.
# Never writes anything. Prints one JSON line.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$approvedBase = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
function Hive([string]$scope) { if ($scope -eq 'HKCU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine } }

# StartupApproved: scope|key -> @{ name = hex }, and whether the key exists
$approved = @{}
foreach ($scope in 'HKCU', 'HKLM') {
  foreach ($k in 'Run', 'Run32', 'StartupFolder') {
    $m = @{}
    $key = (Hive $scope).OpenSubKey("$approvedBase\$k")
    if ($key) {
      foreach ($n in $key.GetValueNames()) {
        $v = $key.GetValue($n)
        if ($v -is [byte[]]) { $m[$n] = (($v | ForEach-Object { $_.ToString('x2') }) -join '') } else { $m[$n] = '' }
      }
      $key.Close()
    }
    $approved["$scope|$k"] = @{ exists = [bool]$key; values = $m }
  }
}

# the program a Run command starts: the quoted path, or the text up to the first ".exe"
function ExeOf([string]$cmd) {
  $c = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
  if ($c -match '^"([^"]+)"') { $p = $Matches[1] }
  elseif ($c -match '^(.+?\.(exe|com|bat|cmd))(\s|$)') { $p = $Matches[1] }
  else { $p = ($c -split '\s+')[0] }
  if ($p -and -not [IO.Path]::IsPathRooted($p)) {
    foreach ($d in @("$env:SystemRoot\System32", $env:SystemRoot)) { $t = Join-Path $d $p; if (Test-Path -LiteralPath $t) { return $t } }
  }
  return $p
}
$shell = New-Object -ComObject WScript.Shell
function Info([string]$file) {
  $r = @{ target = $file; args = ''; publisher = ''; description = ''; found = $false }
  if (-not $file) { return $r }
  if ($file -match '\.lnk$' -and $shell) { $s = $shell.CreateShortcut($file); if ($s.TargetPath) { $r.target = $s.TargetPath; $r.args = [string]$s.Arguments } }
  if ($r.target -and (Test-Path -LiteralPath $r.target -PathType Leaf)) {
    $r.found = $true
    $vi = [Diagnostics.FileVersionInfo]::GetVersionInfo($r.target)
    if ($vi) { $r.publisher = [string]$vi.CompanyName; $r.description = [string]$vi.FileDescription }
  }
  return $r
}

$items = @()
$runs = @(@('HKCU', 'Software\Microsoft\Windows\CurrentVersion\Run', 'Run'), @('HKLM', 'Software\Microsoft\Windows\CurrentVersion\Run', 'Run'), @('HKLM', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'Run32'))
foreach ($r in $runs) {
  $key = (Hive $r[0]).OpenSubKey($r[1])
  if (-not $key) { continue }
  foreach ($n in $key.GetValueNames()) {
    if ($n -eq '') { continue }
    $cmd = [string]$key.GetValue($n)
    $i = Info (ExeOf $cmd)
    $a = $approved["$($r[0])|$($r[2])"]
    $items += @{ scope = $r[0]; key = $r[2]; name = $n; source = "$($r[0])\$($r[1])"; command = $cmd; target = $i.target; found = $i.found; publisher = $i.publisher; description = $i.description; approved = $(if ($a.values.ContainsKey($n)) { $a.values[$n] } else { $null }) }
  }
  $key.Close()
}
foreach ($f in @(@('HKCU', [Environment]::GetFolderPath('Startup')), @('HKLM', [Environment]::GetFolderPath('CommonStartup')))) {
  if (-not $f[1] -or -not (Test-Path -LiteralPath $f[1])) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f[1] -File -Force) {
    if ($file.Name -ieq 'desktop.ini') { continue }
    $i = Info $file.FullName
    $a = $approved["$($f[0])|StartupFolder"]
    $items += @{ scope = $f[0]; key = 'StartupFolder'; name = $file.Name; source = $f[1]; command = $file.FullName; target = $i.target; args = $i.args; found = $i.found; publisher = $i.publisher; description = $i.description; approved = $(if ($a.values.ContainsKey($file.Name)) { $a.values[$file.Name] } else { $null }) }
  }
}

# Windows' own sign-in timing: readable by administrators only (on an ordinary account: "unauthorized operation")
$impact = @{ readable = $false; why = ''; apps = @(); boot = $null }
try {
  # a filtered read of a log this account may not open answers "No events were found", so open it plainly first
  $null = Get-WinEvent -LogName 'Microsoft-Windows-Diagnostics-Performance/Operational' -MaxEvents 1 -ErrorAction Stop
  $ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Diagnostics-Performance/Operational'; Id = 100, 101; StartTime = (Get-Date).AddDays(-60) } -MaxEvents 300 -ErrorAction Stop)
  $impact.readable = $true
  foreach ($e in $ev) {
    $d = @{}
    foreach ($x in ([xml]$e.ToXml()).Event.EventData.Data) { $d[[string]$x.Name] = [string]$x.'#text' }
    if ($e.Id -eq 100 -and -not $impact.boot) { $impact.boot = @{ at = $e.TimeCreated.ToUniversalTime().ToString('o'); totalMs = [int]$d['BootTime']; postMs = [int]$d['BootPostBootTime'] } }
    if ($e.Id -eq 101) { $impact.apps += @{ at = $e.TimeCreated.ToUniversalTime().ToString('o'); file = [string]$d['Name']; name = [string]$d['FriendlyName']; totalMs = [int]$d['TotalTime']; degradeMs = [int]$d['DegradationTime'] } }
  }
} catch {
  # no events at all is readable and empty; anything else (access) is not readable
  if ($_.Exception.Message -match 'No events were found') { $impact.readable = $true } else { $impact.why = [string]$_.Exception.Message }
}

$out = @{ items = $items; approvedKeys = @{}; impact = $impact }
foreach ($k in $approved.Keys) { $out.approvedKeys[$k] = $approved[$k].exists }
ConvertTo-Json $out -Depth 5 -Compress
