# How hard each app worked while Windows signed in, read-only (27 Oct 2026, helpers/startup-impact.js): the same
# measure as Task Manager's "Startup impact" (CPU time and disk activity in the first minutes after sign-in), taken from
# Win32_Process counters, which an ordinary account can read for every process. Windows' own sign-in timing needs admin;
# this does not.
#   sign-in = when this session's first explorer.exe started
#   a process counts when it is in this session and started after sign-in (10 s grace); its CPU and read+write bytes are
#   its totals at the last look before it ended, or at sign-in + 150 s
# Started late (more than 4 minutes after sign-in), it prints { late: true } and measures nothing.
# Never writes anything. Prints one JSON line.
# -TestSeconds N (a trial run only): "sign-in" is now, watched for N seconds.
param([int]$TestSeconds = 0)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$session = (Get-Process -Id $PID).SessionId
$explorer = @(Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe' AND SessionId = $session" | Sort-Object CreationDate)
if (-not $explorer.Count) { '{"error":"no explorer.exe in this session"}'; exit 0 }
$signIn = $explorer[0].CreationDate
$until = $signIn.AddSeconds(150)
if ($TestSeconds -gt 0) { $signIn = Get-Date; $until = $signIn.AddSeconds($TestSeconds) }
if (((Get-Date) - $signIn).TotalSeconds -gt 240) { ConvertTo-Json @{ late = $true; signIn = $signIn.ToUniversalTime().ToString('o') } -Compress; exit 0 }

$seen = @{}
while ($true) {
  foreach ($p in Get-CimInstance Win32_Process -Filter "SessionId = $session") {
    if (-not $p.CreationDate -or $p.CreationDate -lt $signIn.AddSeconds(-10)) { continue }
    $seen["$($p.ProcessId)|$($p.CreationDate.Ticks)"] = @{
      name = [string]$p.Name; path = [string]$p.ExecutablePath; cmd = [string]$p.CommandLine; pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId
      startS = [int]($p.CreationDate - $signIn).TotalSeconds
      cpuMs = [int64](($p.KernelModeTime + $p.UserModeTime) / 10000)
      ioKB = [int64](($p.ReadTransferCount + $p.WriteTransferCount) / 1KB)
    }
  }
  if ((Get-Date) -ge $until) { break }
  Start-Sleep -Seconds 10
}
ConvertTo-Json @{ signIn = $signIn.ToUniversalTime().ToString('o'); at = (Get-Date).ToUniversalTime().ToString('o'); procs = @($seen.Values) } -Depth 4 -Compress
