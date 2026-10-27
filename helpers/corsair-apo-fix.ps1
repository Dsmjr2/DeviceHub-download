# Turns off Corsair's old sound effects under Equalizer APO (27 Oct 2026, helpers/corsair-apo.js). Run elevated, only
# on the person's click. With iCUE removed, the Corsair effects Equalizer APO still runs before and after its own
# ("Use original APO") stall each time an app opens the headset: Discord's join sound came about 1 s late on Shawn's HS80.
# For each device given: only PreMixChild / PostMixChild under HKLM\SOFTWARE\EqualizerAPO\Child APOs\{device}, and only
# a value that names a Corsair effect (its HKCR\CLSID name or file says Corsair), is set to ''. Each key is exported to
# DeviceHub's backups\ first and the file checked; every value is read back; then Windows Audio (Audiosrv) restarts.
# Never touches Windows' own list of sound devices or any other value. Writes "ok|<count>|<backup files>" or "failed|<why>" to -Result.
param([string]$Guids = '', [string]$Backups = '', [string]$Result = '', [string]$Started = '', [string]$Cancel = '')
$ErrorActionPreference = 'Stop'
# DeviceHub stopped waiting for Windows' prompt: a late Yes does nothing
if ($Cancel -and (Test-Path -LiteralPath $Cancel)) { exit 4 }
if ($Started) { Set-Content -LiteralPath $Started -Value 'started' -Encoding UTF8 -ErrorAction SilentlyContinue }

function IsCorsair([string]$c) {
  if (-not $c -or $c -notmatch '^\{[0-9a-fA-F-]{36}\}$') { return $false }
  $k = "Registry::HKEY_CLASSES_ROOT\CLSID\$c"
  $n = [string](Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue).'(default)'
  $d = [string](Get-ItemProperty -LiteralPath "$k\InprocServer32" -ErrorAction SilentlyContinue).'(default)'
  return ("$n $d" -match 'corsair')
}

try {
  if (-not (Test-Path -LiteralPath $Backups)) { New-Item -ItemType Directory -Path $Backups -Force | Out-Null }
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
  $cleared = 0; $files = @()
  foreach ($g in ($Guids -split ',')) {
    if ($g -notmatch '^\{[0-9a-fA-F-]{36}\}$') { continue }
    $key = "HKLM:\SOFTWARE\EqualizerAPO\Child APOs\$g"
    if (-not (Test-Path -LiteralPath $key)) { continue }
    $p = Get-ItemProperty -LiteralPath $key
    $names = @(@('PreMixChild', 'PostMixChild') | Where-Object { IsCorsair ([string]$p.$_) })
    if (-not $names.Count) { continue }
    $file = Join-Path $Backups ("corsair-apo-" + $g.Trim('{}') + "-$stamp.reg")
    & reg.exe export "HKLM\SOFTWARE\EqualizerAPO\Child APOs\$g" $file /y | Out-Null
    if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0) { throw "the backup of $g was not written" }
    $files += (Split-Path $file -Leaf)
    foreach ($n in $names) { Set-ItemProperty -LiteralPath $key -Name $n -Value '' }
    $back = Get-ItemProperty -LiteralPath $key
    foreach ($n in $names) { if ([string]$back.$n -ne '') { throw "$n of $g did not read back empty" } }
    $cleared += $names.Count
  }
  if ($cleared) { Restart-Service -Name Audiosrv -Force }
  Set-Content -LiteralPath $Result -Value ("ok|$cleared|" + ($files -join ';')) -Encoding UTF8
  exit 0
} catch {
  Set-Content -LiteralPath $Result -Value "failed|$($_.Exception.Message)" -Encoding UTF8 -ErrorAction SilentlyContinue
  exit 3
}
