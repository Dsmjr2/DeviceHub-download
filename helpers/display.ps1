# Display modes, main screen and HDR for helpers/display.js (24 Oct 2026, docs/handoff/display-health.md).
# Windows' own display APIs (helpers/pc-native.cs). The operation and its values arrive in environment variables, never
# in the script text. Prints one JSON line: { ok, result } or { ok: false, error }.
#   DEVICEHUB_DISPLAY_OP = read | mode | primary | hdr
#   mode:    DEVICEHUB_DISPLAY_SCREEN, _WIDTH, _HEIGHT, _HZ, _PERSIST (1 = saved; 0 = this session only)
#   primary: DEVICEHUB_DISPLAY_SCREEN
#   hdr:     DEVICEHUB_DISPLAY_SCREEN, DEVICEHUB_DISPLAY_ON (1 / 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'pc-native.cs')
  $op = $env:DEVICEHUB_DISPLAY_OP
  $screen = $env:DEVICEHUB_DISPLAY_SCREEN
  if ($op -eq 'read') {
    # Night light is read only: its state is an undocumented settings blob, so DeviceHub never writes it
    $nl = $null
    $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate'
    try { $nl = ((Get-ItemProperty -LiteralPath $k -ErrorAction Stop).Data | ForEach-Object { $_.ToString('X2') }) -join ' ' } catch {}
    $result = [ordered]@{ screens = @([DhDisplay]::Read()); nightLight = $nl }
  } elseif ($op -eq 'mode') {
    $result = [DhDisplay]::SetMode($screen, [int]$env:DEVICEHUB_DISPLAY_WIDTH, [int]$env:DEVICEHUB_DISPLAY_HEIGHT, [int]$env:DEVICEHUB_DISPLAY_HZ, $env:DEVICEHUB_DISPLAY_PERSIST -eq '1')
  } elseif ($op -eq 'primary') {
    $result = [DhDisplay]::SetPrimary($screen)
  } elseif ($op -eq 'hdr') {
    $result = [DhDisplay]::SetHdr($screen, $env:DEVICEHUB_DISPLAY_ON -eq '1')
  } else { throw "unknown operation" }
  ConvertTo-Json -Compress -Depth 8 -InputObject ([ordered]@{ ok = $true; result = $result })
} catch {
  $m = $_.Exception.Message
  if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $false; error = $m })
}
