# Removes DeviceHub from this PC (20 Oct 2026): Windows Settings > Apps > DeviceHub > Uninstall runs this (the entry
# is written by helpers/install.ps1). Asks once, then: quits DeviceHub, removes "start with Windows", the Desktop and
# Start menu shortcuts and the Apps entry, moves the backups to Documents\DeviceHub backups (never deleted), and
# deletes the DeviceHub folder. A folder with code history (.git: a development copy, like the one DeviceHub is built
# in) is never deleted. Device settings stay on the devices; Equalizer APO and other apps are left as they are.
# -FromApp: started by Settings > Uninstall, which has asked already; it says something only if it could not finish.
# Every run writes its steps to %TEMP%\DeviceHub-uninstall.log (20 Oct 2026: one failed with nothing to show why).
param([string]$Dir = (Split-Path $PSScriptRoot -Parent), [string]$Key = 'DeviceHub', [int]$Port = 5577, [switch]$Quiet, [switch]$Relaunched, [int]$Caller = 0, [switch]$FromApp)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$log = Join-Path $env:TEMP 'DeviceHub-uninstall.log'
function Log($t) { try { Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$PID] $t" -Encoding UTF8 } catch {} }
# a message box, except when quiet, and from the app only for a problem (the closing window says it worked)
function Say($t, $icon = 'Information') {
  Log $t
  if ($Quiet -or ($FromApp -and $icon -eq 'Information')) { Write-Host $t } else { [void][System.Windows.Forms.MessageBox]::Show($t, 'DeviceHub', 'OK', $icon) }
}
Log "start: Dir=$Dir Key=$Key Port=$Port Relaunched=$Relaunched FromApp=$FromApp Quiet=$Quiet"

$Dir = [IO.Path]::GetFullPath($Dir)
# never work from inside the folder that is deleted (a process whose current folder it is keeps it "in use")
Set-Location -LiteralPath $env:TEMP
# a development copy has code history of its own; an installed copy's history (since 21 Oct 2026) is tied to the public
# download repository, and that one is removed like any install
$devCopy = (Test-Path -LiteralPath (Join-Path $Dir '.git')) -and -not ((Test-Path -LiteralPath (Join-Path $Dir '.git\config')) -and (Select-String -LiteralPath (Join-Path $Dir '.git\config') -Pattern 'DeviceHub-download' -SimpleMatch -Quiet))
if ($devCopy) { Say "$Dir is a development copy of DeviceHub (it has code history), so it is not removed." 'Warning'; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $Dir 'server.js'))) { Say "No DeviceHub found in $Dir." 'Warning'; exit 1 }

# the folder is about to be deleted: run from a copy of this script outside it
if (-not $Relaunched) {
  if (-not $Quiet -and -not $FromApp) {
    $a = [System.Windows.Forms.MessageBox]::Show("Remove DeviceHub from this PC?`n`nYour backups are kept in Documents\DeviceHub backups. Your devices keep their settings.", 'Uninstall DeviceHub', 'YesNo', 'Question')
    if ($a -ne 'Yes') { exit 0 }
  }
  $copy = Join-Path $env:TEMP "DeviceHub-uninstall-$([guid]::NewGuid().ToString('N').Substring(0, 6)).ps1"
  Copy-Item -LiteralPath $PSCommandPath $copy
  # one quoted string: Windows PowerShell does not quote list items, and a user folder with a space (C:\Users\Ann Lee)
  # split the path in two, so nothing was removed (20 Oct 2026)
  $args2 = "-NoProfile -ExecutionPolicy Bypass -File `"$copy`" -Dir `"$($Dir.TrimEnd('\'))`" -Key `"$Key`" -Port $Port -Relaunched -Caller $PID" + $(if ($Quiet) { ' -Quiet' } else { '' }) + $(if ($FromApp) { ' -FromApp' } else { '' })
  $p = Start-Process powershell.exe -ArgumentList $args2 -WindowStyle Hidden -Wait -PassThru -WorkingDirectory $env:TEMP
  Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
  Log "finished: exit $($p.ExitCode)"
  exit $p.ExitCode
}

try {
  # 1. quit DeviceHub (its own Quit; then anything still running from the folder)
  $port = $Port
  try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/quit" -Headers @{ Origin = "http://127.0.0.1:$port" } -TimeoutSec 3 | Out-Null } catch {}
  Start-Sleep 3
  Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($Dir, 'OrdinalIgnoreCase')) -or ($_.CommandLine -and $_.CommandLine.IndexOf($Dir, [StringComparison]::OrdinalIgnoreCase) -ge 0) } |
    Where-Object { $_.ProcessId -ne $PID -and $_.ProcessId -ne $Caller } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 1
  Log 'quit DeviceHub'
  # 2. start with Windows, shortcuts, the Apps entry (only ones that point into this folder)
  $sh = New-Object -ComObject WScript.Shell
  foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Startup')) 'DeviceHub.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeviceHub.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'DeviceHub.lnk'))) {
    if (Test-Path -LiteralPath $lnk) { $s = $sh.CreateShortcut($lnk); if (("$($s.Arguments) $($s.WorkingDirectory) $($s.TargetPath)").IndexOf($Dir, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Remove-Item -LiteralPath $lnk -Force } }
  }
  $reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Key"
  if (Test-Path $reg) { Remove-Item $reg -Recurse -Force }
  Log 'removed the shortcuts and the Apps entry'
  # 3. backups to Documents, never deleted
  $b = Join-Path $Dir 'backups'
  $kept = $null
  if ((Test-Path -LiteralPath $b) -and (Get-ChildItem -LiteralPath $b -Recurse -File -ErrorAction SilentlyContinue)) {
    $kept = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'DeviceHub backups'
    New-Item -ItemType Directory -Force $kept | Out-Null
    Copy-Item -Path (Join-Path $b '*') -Destination $kept -Recurse -Force
  }
  Log "backups: $(if ($kept) { "copied to $kept" } else { 'none' })"
  # 4. the folder (a file still open is retried a few times)
  for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $Dir); $i++) { try { Remove-Item -LiteralPath $Dir -Recurse -Force } catch { Log "folder not removed yet: $($_.Exception.Message)"; Start-Sleep 2 } }
  if (Test-Path -LiteralPath $Dir) { Say "DeviceHub is removed, but some files in $Dir were still in use. Restart the PC and delete that folder." 'Warning'; exit 2 }
  Say ("DeviceHub is removed." + $(if ($kept) { " Your backups are in $kept." } else { '' }))
  exit 0
} catch { Say "DeviceHub was not fully removed: $($_.Exception.Message) (details: $log)" 'Error'; exit 3 }
