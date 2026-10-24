# Temperatures for helpers/pc-sensors.js (24 Oct 2026, docs/handoff/display-health.md), read only, no driver added.
# Started only while the Temperatures and fans card is on screen and stopped 30 s after its last question, so the
# compile below happens once per visit, not once per reading. Each line "read" on stdin prints one JSON line:
#   gpus:  each graphics adapter's temperature and fan RPM as its driver reports them to Windows (D3DKMT, as Task Manager)
#   zones: the ACPI thermal zones (Windows' performance counters; no administrator needed)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$loaded = $true
try { Add-Type -Path (Join-Path $PSScriptRoot 'pc-native.cs') } catch { $loaded = $false }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'quit') { break }
  $out = [ordered]@{ gpus = @(); zones = @(); errors = @() }
  if ($loaded) { try { $out.gpus = @([DhGpuSensors]::Read()) } catch { $out.errors += "gpu: " + $_.Exception.Message } }
  else { $out.errors += 'gpu: the sensor code could not be loaded' }
  try {
    $out.zones = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop | ForEach-Object { [ordered]@{ name = $_.Name; tenthsK = [int]$_.HighPrecisionTemperature; kelvin = [int]$_.Temperature } })
  } catch { $out.errors += "zones: " + $_.Exception.Message }
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 5 -InputObject $out))
  [Console]::Out.Flush()
}
