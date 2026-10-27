# Removes DeviceHub from this PC (20 Oct 2026): Windows Settings > Apps > DeviceHub > Uninstall runs this (the entry
# is written by helpers/install.ps1). Asks once, then: quits DeviceHub, removes "start with Windows", the Desktop and
# Start menu shortcuts and the Apps entry, moves the backups to Documents\DeviceHub backups (never deleted), and
# deletes the DeviceHub folder. A folder with code history (.git: a development copy, like the one DeviceHub is built
# in) is never deleted. Device settings stay on the devices; Equalizer APO and other apps are left as they are.
# -FromApp: started by Settings > Uninstall, which has asked already; it says something only if it could not finish.
# Every run writes its steps to %TEMP%\DeviceHub-uninstall.log (20 Oct 2026: one failed with nothing to show why).
# (27 Oct 2026, everything DeviceHub added) What to remove comes from helpers/uninstall-plan.mjs, read before anything
# changes: also the admin parts (CPU sensors, Wi-Fi pause with the scan turned back on, board lights, their tasks and
# Program Files folders), removed first under ONE Windows prompt by each feature's own remove script; declined, nothing
# at all is removed. -DryRun only prints the plan (it works on a development copy too). -ClearEq also empties
# Equalizer APO's config.txt when DeviceHub wrote it (the old one goes to the kept backups). Other programs stay and
# are named at the end with where to remove them.
param([string]$Dir = (Split-Path $PSScriptRoot -Parent), [string]$Key = 'DeviceHub', [int]$Port = 5577, [switch]$Quiet, [switch]$Relaunched, [int]$Caller = 0, [switch]$FromApp, [switch]$DryRun, [switch]$ClearEq)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'DeviceHub-uninstall.log'
function Log($t) { try { Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$PID] $t" -Encoding UTF8 } catch {} }
# a message box, except when quiet, and from the app only for a problem (the closing window says it worked)
function Say($t, $icon = 'Information') {
  Log $t
  if ($Quiet -or $DryRun -or ($FromApp -and $icon -eq 'Information' -and -not $script:showAll)) { Write-Host $t } else { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($t, 'DeviceHub', 'OK', $icon) }
}
Log "start: Dir=$Dir Key=$Key Port=$Port Relaunched=$Relaunched FromApp=$FromApp Quiet=$Quiet DryRun=$DryRun ClearEq=$ClearEq"

$Dir = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
# never work from inside the folder that is deleted (a process whose current folder it is keeps it "in use")
Set-Location -LiteralPath $env:TEMP
# a development copy has code history of its own; an installed copy's history (since 21 Oct 2026) is tied to the public
# download repository, and that one is removed like any install
$devCopy = (Test-Path -LiteralPath (Join-Path $Dir '.git')) -and -not ((Test-Path -LiteralPath (Join-Path $Dir '.git\config')) -and (Select-String -LiteralPath (Join-Path $Dir '.git\config') -Pattern 'DeviceHub-download' -SimpleMatch -Quiet))
if (-not (Test-Path -LiteralPath (Join-Path $Dir 'server.js'))) { Say "No DeviceHub found in $Dir." 'Warning'; exit 1 }

# the plan (helpers/uninstall-plan.mjs), with DeviceHub's own Node or the PC's
function Get-Node { $n = Join-Path $Dir 'runtime\node.exe'; if (Test-Path -LiteralPath $n) { return $n }; $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { return $c.Source }; return $null }
function Get-Plan([string[]]$more) {
  $node = Get-Node
  if (-not $node) { throw 'Node.js was not found, so what DeviceHub added could not be read' }
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
  $ErrorActionPreference = 'Continue'
  $out = & $node (Join-Path $Dir 'helpers\uninstall-plan.mjs') --dir $Dir --key $Key @more 2>$null | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0 -or -not $out.Trim()) { throw "what DeviceHub added could not be read (exit $code)" }
  return $out
}
if ($DryRun) {
  try { Write-Host (Get-Plan $(if ($devCopy) { @('--dev-copy') } else { @() })); Log 'dry run printed'; exit 0 } catch { Write-Host "Dry run failed: $($_.Exception.Message)"; exit 2 }
}
if ($devCopy) { Say "$Dir is a development copy of DeviceHub (it has code history), so it is not removed." 'Warning'; exit 1 }

# the folder is about to be deleted: run from a copy of this script outside it
if (-not $Relaunched) {
  if (-not $Quiet -and -not $FromApp) {
    Add-Type -AssemblyName System.Windows.Forms
    $a = [System.Windows.Forms.MessageBox]::Show("Remove DeviceHub from this PC?`n`nYour backups are kept in Documents\DeviceHub backups. Your devices keep their settings.", 'Uninstall DeviceHub', 'YesNo', 'Question')
    if ($a -ne 'Yes') { exit 0 }
  }
  $copy = Join-Path $env:TEMP "DeviceHub-uninstall-$([guid]::NewGuid().ToString('N').Substring(0, 6)).ps1"
  Copy-Item -LiteralPath $PSCommandPath $copy
  # one quoted string: Windows PowerShell does not quote list items, and a user folder with a space (C:\Users\Ann Lee)
  # split the path in two, so nothing was removed (20 Oct 2026)
  $args2 = "-NoProfile -ExecutionPolicy Bypass -File `"$copy`" -Dir `"$($Dir.TrimEnd('\'))`" -Key `"$Key`" -Port $Port -Relaunched -Caller $PID" + $(if ($Quiet) { ' -Quiet' } else { '' }) + $(if ($FromApp) { ' -FromApp' } else { '' }) + $(if ($ClearEq) { ' -ClearEq' } else { '' })
  $p = Start-Process powershell.exe -ArgumentList $args2 -WindowStyle Hidden -Wait -PassThru -WorkingDirectory $env:TEMP
  Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
  Log "finished: exit $($p.ExitCode)"
  exit $p.ExitCode
}

try {
  # 0. what DeviceHub added, read before anything changes
  $resultDir = Join-Path $env:TEMP "DeviceHub-uninstall-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
  New-Item -ItemType Directory -Force $resultDir | Out-Null
  $plan = (Get-Plan @('--json', '--result-dir', $resultDir)) | ConvertFrom-Json
  Log "plan: $(@($plan.remove).Count) to remove, admin parts: $(@($plan.parts) -join ', ')"
  # 1. the admin parts, under one Windows prompt; declined or failed: nothing else is removed, so Uninstall can run again
  if ($plan.adminScript) {
    try { $ap = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $plan.adminScript -PassThru -Wait -ErrorAction Stop }
    catch { Say "Nothing was removed: Windows' permission box was declined. DeviceHub's CPU sensors, Wi-Fi pause or board lights need it to be removed. Uninstall again and click Yes." 'Warning'; exit 4 }
    $bad = @(foreach ($r in @($plan.results)) {
      $t = ''; try { $t = (Get-Content -LiteralPath $r.file -Raw -ErrorAction Stop).Trim() } catch {}
      if ($t -ne 'ok') { "$($r.part): $(if ($t) { $t -replace '^failed\|', '' } else { 'no answer' })" }
    })
    if ($bad.Count) { Say "DeviceHub was not removed: its admin parts could not all be removed ($($bad -join '; ')). Details: $log" 'Error'; exit 3 }
    Log "admin parts removed: $(@($plan.parts) -join ', ')"
  }
  Remove-Item -LiteralPath $resultDir -Recurse -Force -ErrorAction SilentlyContinue
  # 2. quit DeviceHub (its own Quit; then only its own programs still running: its launcher loop, its server, its helper,
  #    its OpenRGB, its tray and scripts, and the Chrome running its window-profile; never another program)
  $port = $Port
  try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/quit" -Headers @{ Origin = "http://127.0.0.1:$port" } -TimeoutSec 3 | Out-Null } catch {}
  Start-Sleep 3
  $d = $Dir + '\'
  $all = @(Get-CimInstance Win32_Process)
  $mine = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.ProcessId -ne $Caller } | Where-Object {
    $cl = [string]$_.CommandLine
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($d, 'OrdinalIgnoreCase')) -or
    (@('cmd.exe', 'wscript.exe', 'cscript.exe', 'powershell.exe') -contains $_.Name -and ($cl.IndexOf("${d}helpers\", 'OrdinalIgnoreCase') -ge 0 -or $cl.IndexOf("${d}DeviceHub.vbs", 'OrdinalIgnoreCase') -ge 0 -or $cl.IndexOf("${d}logs\", 'OrdinalIgnoreCase') -ge 0)) -or
    ($_.Name -eq 'node.exe' -and $cl.IndexOf($d, 'OrdinalIgnoreCase') -ge 0) -or
    (@('chrome.exe', 'msedge.exe') -contains $_.Name -and $cl.IndexOf("${d}window-profile", 'OrdinalIgnoreCase') -ge 0) })
  # the server started by the launcher loop as "node server.js" (no folder in its command line)
  $loops = @($mine | Where-Object { $_.Name -eq 'cmd.exe' } | ForEach-Object { $_.ProcessId })
  $mine += @($all | Where-Object { $_.Name -eq 'node.exe' -and $loops -contains $_.ParentProcessId })
  # the launcher loop first (it would start the server again), then the rest
  $mine | Sort-Object { $_.Name -ne 'cmd.exe' } | ForEach-Object { Log "stopping $($_.Name) $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 1
  Log 'quit DeviceHub'
  # 3. start with Windows, shortcuts, the Apps entry, DeviceHub's temporary files (exactly the ones in the plan)
  foreach ($r in @($plan.remove)) {
    if ($r.kind -eq 'shortcut' -or $r.kind -eq 'temp') { if (Test-Path -LiteralPath $r.path) { Remove-Item -LiteralPath $r.path -Recurse -Force -ErrorAction SilentlyContinue; Log "removed $($r.path)" } }
    elseif ($r.kind -eq 'apps') { $reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($r.key)"; if (Test-Path $reg) { Remove-Item $reg -Recurse -Force; Log "removed the Apps entry $($r.key)" } }
  }
  # 4. Equalizer APO's config.txt, only when ticked and DeviceHub wrote it: the old one to the backups, then empty
  $b = Join-Path $Dir 'backups'
  $cfg = Join-Path $env:ProgramFiles 'EqualizerAPO\config\config.txt'
  $eqCleared = $false
  if ($ClearEq -and (@($plan.ask) | Where-Object { $_.id -eq 'clearEq' }) -and (Test-Path -LiteralPath $cfg) -and ((Get-Content -LiteralPath $cfg -TotalCount 1) -like '# Written by DeviceHub*')) {
    try {
      New-Item -ItemType Directory -Force $b | Out-Null
      Copy-Item -LiteralPath $cfg (Join-Path $b "eqapo-config-at-uninstall-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').txt") -Force
      Set-Content -LiteralPath $cfg -Value "# Emptied when DeviceHub was uninstalled; the old file is in Documents\DeviceHub backups." -Encoding ASCII
      $eqCleared = $true; Log 'emptied Equalizer APO config.txt'
    } catch { Log "Equalizer APO config.txt not emptied: $($_.Exception.Message)" }
  }
  # 5. backups to Documents, never deleted
  $kept = $null
  if ((Test-Path -LiteralPath $b) -and (Get-ChildItem -LiteralPath $b -Recurse -File -ErrorAction SilentlyContinue)) {
    $kept = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'DeviceHub backups'
    New-Item -ItemType Directory -Force $kept | Out-Null
    Copy-Item -Path (Join-Path $b '*') -Destination $kept -Recurse -Force
  }
  Log "backups: $(if ($kept) { "copied to $kept" } else { 'none' })"
  # 6. the folder (a file still open is retried a few times)
  for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $Dir); $i++) { try { Remove-Item -LiteralPath $Dir -Recurse -Force } catch { Log "folder not removed yet: $($_.Exception.Message)"; Start-Sleep 2 } }
  $others = @(@($plan.others) | ForEach-Object { if ($eqCleared -and $_.name -eq 'Equalizer APO') { $_.line -replace ' It still applies the sound settings.*$', ' DeviceHub''s sound settings were cleared from it.' } else { $_.line } })
  # from the app too when other programs stay: the person reads where to remove them
  $script:showAll = $others.Count -gt 0
  $tail = $(if ($others.Count) { "`n`nOther programs stay:`n" + ($others -join "`n") } else { '' })
  if (Test-Path -LiteralPath $Dir) { Say ("DeviceHub is removed, but some files in $Dir were still in use. Restart the PC and delete that folder." + $tail) 'Warning'; exit 2 }
  Say ("DeviceHub is removed." + $(if ($kept) { " Your backups are in $kept." } else { '' }) + $tail)
  exit 0
} catch { Say "DeviceHub was not fully removed: $($_.Exception.Message) (details: $log)" 'Error'; exit 3 }
