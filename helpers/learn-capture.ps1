# The learning wizard's listener (22 Oct 2026; helpers/learn-wizard.mjs, docs/handoff/learn-wizard.md). Read-only: it
# only runs USBPcapCMD, which records USB traffic; it sends nothing to any device. USBPcap needs administrator rights,
# so the wizard starts this script once per learning session through Windows' own prompt (UAC): the person's click on
# "Start listening" and their Yes on that prompt are the go-ahead. One prompt covers every recording of the session.
#
# It waits for commands from the wizard in <Dir>\command.txt ("<seq> start <name>", "<seq> stop", "<seq> quit") and
# answers in <Dir>\state.json. "start" records every USB root hub (one USBPcapCMD per hub, -A with the connected
# devices' descriptors injected, so the wizard can find the device by its USB ids) into <Dir>\<name>-<n>.pcap until
# "stop". It ends by itself after -MaxMinutes, on "quit", or when <Dir> is gone, and never leaves USBPcapCMD running.
#   powershell -NoProfile -ExecutionPolicy Bypass -File helpers\learn-capture.ps1 -Dir <DeviceHub>\learn\wizard\<session>
param([Parameter(Mandatory = $true)][string]$Dir, [int]$MaxMinutes = 30)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:ProgramFiles 'USBPcap\USBPcapCMD.exe'
$root = Join-Path (Split-Path $PSScriptRoot -Parent) 'learn\wizard'
$Dir = [IO.Path]::GetFullPath($Dir)
# only a session folder of this DeviceHub's own learn\wizard (the wizard makes it; nothing else is accepted)
if (-not $Dir.StartsWith([IO.Path]::GetFullPath($root) + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $Dir -PathType Container)) { exit 2 }
$stateFile = Join-Path $Dir 'state.json'
$cmdFile = Join-Path $Dir 'command.txt'
$seq = 0
$procs = @()
$current = $null

function Save-State([string]$status, [hashtable]$extra = @{}) {
  $o = [ordered]@{ seq = $script:seq; status = $status; take = $script:current; at = (Get-Date).ToUniversalTime().ToString('o') }
  foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] }
  $tmp = "$stateFile.tmp"
  [IO.File]::WriteAllText($tmp, ($o | ConvertTo-Json -Compress -Depth 3), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $stateFile -Force
}
function Stop-Recording {
  foreach ($p in $script:procs) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch {} }
  if ($script:procs.Count) { Start-Sleep -Milliseconds 600 }
  $script:procs = @()
}

if (-not (Test-Path -LiteralPath $exe)) { Save-State 'error' @{ error = 'USBPcap is not installed' }; exit 1 }
# every USB root hub USBPcap can listen on
$ifaces = @(& $exe --extcap-interfaces 2>$null | ForEach-Object { if ($_ -match 'value=(\\\\\.\\USBPcap\d+)') { $Matches[1] } })
if (-not $ifaces.Count) { Save-State 'error' @{ error = 'USBPcap found no USB hub to listen on: restart the PC once after installing it' }; exit 1 }
Save-State 'ready' @{ hubs = $ifaces.Count }

$until = (Get-Date).AddMinutes($MaxMinutes)
try {
  while ((Get-Date) -lt $until -and (Test-Path -LiteralPath $Dir)) {
    Start-Sleep -Milliseconds 200
    if (-not (Test-Path -LiteralPath $cmdFile)) { continue }
    $line = ''
    try { $line = ([IO.File]::ReadAllText($cmdFile)).Trim() } catch { continue }
    $m = [regex]::Match($line, '^(\d{1,9}) (start|stop|quit)(?: ([a-z0-9-]{1,40}))?$')
    if (-not $m.Success) { continue }
    $n = [int]$m.Groups[1].Value
    if ($n -le $seq) { continue }
    $seq = $n
    $verb = $m.Groups[2].Value
    if ($verb -eq 'quit') { break }
    if ($verb -eq 'stop') {
      Stop-Recording
      $files = @(Get-ChildItem -LiteralPath $Dir -Filter "$current-*.pcap" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
      Save-State 'stopped' @{ files = $files }
      continue
    }
    # start <name>
    $name = $m.Groups[3].Value
    if (-not $name) { Save-State 'error' @{ error = 'a recording needs a name' }; continue }
    Stop-Recording
    $current = $name
    $i = 0
    foreach ($iface in $ifaces) {
      $i++
      $out = Join-Path $Dir "$name-$i.pcap"
      if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
      $script:procs += Start-Process -FilePath $exe -ArgumentList @('-d', $iface, '-A', '--inject-descriptors', '-s', '1100', '-o', "`"$out`"") -PassThru -WindowStyle Hidden
    }
    Start-Sleep -Milliseconds 800
    $dead = @($script:procs | Where-Object { $_.HasExited })
    # right after a stop, USBPcap can still hold a hub for a moment (23 Oct 2026): every one gone, so wait and start once more
    if ($dead.Count -eq $script:procs.Count) {
      $script:procs = @()
      Start-Sleep -Milliseconds 1500
      $i = 0
      foreach ($iface in $ifaces) {
        $i++
        $out = Join-Path $Dir "$name-$i.pcap"
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
        $script:procs += Start-Process -FilePath $exe -ArgumentList @('-d', $iface, '-A', '--inject-descriptors', '-s', '1100', '-o', "`"$out`"") -PassThru -WindowStyle Hidden
      }
      Start-Sleep -Milliseconds 800
      $dead = @($script:procs | Where-Object { $_.HasExited })
    }
    if ($dead.Count -eq $script:procs.Count) { Save-State 'error' @{ error = 'USBPcap did not start recording (restart the PC once after installing it)' }; $script:procs = @(); continue }
    Save-State 'recording'
  }
} finally {
  Stop-Recording
  try { Save-State 'ended' } catch {}
}
