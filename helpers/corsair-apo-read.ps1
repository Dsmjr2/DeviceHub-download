# Corsair's old sound effects under Equalizer APO (27 Oct 2026, helpers/corsair-apo.js). Read-only. For each of the
# headset's sound devices: whether Windows uses it now, whether Equalizer APO is on for it, its name, and the effects
# Equalizer APO runs before and after its own (its "Use original APO": Child APOs\{device} PreMixChild / PostMixChild),
# each with the name and file Windows has for it (HKCR\CLSID). Also whether iCUE is installed. Prints one JSON line.
#   powershell -NoProfile -File corsair-apo-read.ps1 -Endpoints 'Render|{guid},Capture|{guid}'
param([string]$Endpoints = '')
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$apo = 'EACD2258-FCAC-4FF4-B36D-419E924A6D79'   # Equalizer APO's own effect

function ClassOf([string]$c) {
  if (-not $c -or $c -notmatch '^\{[0-9a-fA-F-]{36}\}$') { return $null }
  $k = "Registry::HKEY_CLASSES_ROOT\CLSID\$c"
  [pscustomobject]@{ clsid = $c; name = [string](Get-ItemProperty -LiteralPath $k).'(default)'; dll = [string](Get-ItemProperty -LiteralPath "$k\InprocServer32").'(default)' }
}

$rows = @()
foreach ($e in ($Endpoints -split ',')) {
  $flow, $g = $e -split '\|'
  if ($flow -notin 'Render', 'Capture' -or $g -notmatch '^\{[0-9a-fA-F-]{36}\}$') { continue }
  $k = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\$flow\$g"
  $fx = Get-ItemProperty -LiteralPath (Join-Path $k 'FxProperties')
  $c = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\EqualizerAPO\Child APOs\$g"
  $rows += [pscustomobject]@{
    flow = $flow; guid = $g
    state = [string](Get-ItemProperty -LiteralPath $k).DeviceState
    on = [bool]($fx.PSObject.Properties | Where-Object { "$($_.Value)" -match $apo })
    name = [string](Get-ItemProperty -LiteralPath (Join-Path $k 'Properties')).'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
    child = [bool]$c
    pre = ClassOf $c.PreMixChild
    post = ClassOf $c.PostMixChild
  }
}
$icue = (Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'Corsair\Corsair iCUE5 Software\iCUE.exe')) -or [bool](Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName -like '*iCUE*' })
ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ icue = $icue; rows = @($rows) })
