# Acer laptop sensors, fan mode and battery charge limit (3 Nov 2026, Shawn: "a fan speed controller like the nitro app
# and max charge while plugged in"; helpers/acer-control.mjs sets it up on his click). Run ONLY by the scheduled tasks
# "DeviceHub Acer ..." from C:\Program Files\DeviceHub Acer\ (copied there and checked against its pinned SHA-256), each
# task with ONE fixed -Mode, as administrator: Acer's WMI answers nothing to a standard user ("Access denied").
#
# Every call is documented (no guessed method ids or values):
#   AcerGamingFunction, WMI GUID 7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56 (Linux drivers/platform/x86/acer-wmi.c WMID_GUID4;
#   on Windows the method ids are the same: GetGamingSysInfo 5, SetGamingFanBehavior 14, GetGamingFanBehavior 15):
#     sensor reading: GetGamingSysInfo((sensor id << 8) | 0x0001); status byte 7:0 must be 0; the reading is bits 23:8.
#       Sensors: CPU temperature 0x01, CPU fan 0x02, system 0x03, GPU fan 0x06, GPU temperature 0x0A; which ones this
#       laptop has: GetGamingSysInfo(0x0000), bits 39:24, BIT(id - 1).
#     fan mode: GetGamingFanBehavior(fan bit: CPU 0x01, GPU 0x08), status 7:0, CPU mode bits 9:8, GPU mode bits 15:14;
#       SetGamingFanBehavior(fan bits | CPU mode << 16 | GPU mode << 22), status 7:0. Modes: 1 Auto, 2 Turbo (Max).
#   BatteryControl, GUID 79772EC5-04B1-4bfd-843C-61E7F77B6CC9 (github.com/frederik-h/acer-wmi-battery, method ids 20 and
#   21, the same on Windows): GetBatteryHealthControlStatus(battery 1, query 1) -> uFunctionList bit 0 = health mode
#   there, uFunctionStatus[0] > 0 = on; SetBatteryHealthControl(battery 1, mask 1, status 1 or 0). Health mode is Acer's
#   battery charge limit (Acer Care Center's "Battery charge limit").
#
# Modes (the only things this script does):
#   read        while DeviceHub touches -Want (the PC or Laptop page is open), every second: the sensors, both fans' modes
#               and health mode to readings.json beside it. Ends 20 s after the last touch. Reads only.
#   fans-auto   both fans to Auto (also at every sign-in: the fans are never left on Max across a restart)
#   fans-max    both fans to Max, then watches: back to Auto when DeviceHub stops answering for 15 s, after 4 hours, or
#               when the fans are no longer on Max (changed elsewhere)
#   health-on / health-off   the charge limit on or off
# A write: refused while NitroSense or PredatorSense is open (two programs writing the fans fight), the value read
# first, one write, read back; result.json says before, after, and ok only when the read-back is what was asked. Never a
# fan speed, a fan table, a power profile or anything else; the firmware's own thermal protection is never touched.
param([ValidateSet('read', 'fans-auto', 'fans-max', 'health-on', 'health-off')][string]$Mode = 'read', [string]$Want = '')
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$readings = Join-Path $dir 'readings.json'
$result = Join-Path $dir 'result.json'

function Gaming { Get-CimInstance -Namespace root/WMI -ClassName AcerGamingFunction | Select-Object -First 1 }
function Battery { Get-CimInstance -Namespace root/WMI -ClassName BatteryControl -ErrorAction SilentlyContinue | Select-Object -First 1 }
function SysInfo($g, [uint32]$cmd) { [uint64](Invoke-CimMethod -InputObject $g -MethodName GetGamingSysInfo -Arguments @{ gmInput = $cmd }).gmOutput }
function Sensor($g, [uint64]$supported, [int]$id) {
  if (-not ($supported -band ([uint64]1 -shl ($id - 1)))) { return $null }
  $r = SysInfo $g ([uint32](($id -shl 8) -bor 1))
  if (($r -band 0xFF) -ne 0) { return $null }
  [int](($r -shr 8) -band 0xFFFF)
}
function FanMode($g, [int]$bit, [int]$shift) {
  $r = [uint64](Invoke-CimMethod -InputObject $g -MethodName GetGamingFanBehavior -Arguments @{ gmInput = [uint32]$bit }).gmOutput
  if (($r -band 0xFF) -ne 0) { return $null }
  $m = [int](($r -shr $shift) -band 3)
  if ($m -lt 1 -or $m -gt 3) { return $null }
  $m
}
function Health($b) {
  if (-not $b) { return $null }
  $o = Invoke-CimMethod -InputObject $b -MethodName GetBatteryHealthControlStatus -Arguments @{ uBatteryNo = [byte]1; uFunctionQuery = [byte]1; uReserved = [byte[]](0, 0) }
  if (-not ([int]$o.uFunctionList -band 1)) { return $null }
  [bool]([int]$o.uFunctionStatus[0] -gt 0)
}
$modeName = @{ 1 = 'auto'; 2 = 'max'; 3 = 'custom' }
function Snapshot {
  $g = Gaming; $b = Battery
  $sup = ((SysInfo $g 0) -shr 24) -band 0xFFFF
  $cm = FanMode $g 0x01 8; $gm = FanMode $g 0x08 14
  [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    cpuC = Sensor $g $sup 0x01; gpuC = Sensor $g $sup 0x0A; systemC = Sensor $g $sup 0x03
    cpuFanRpm = Sensor $g $sup 0x02; gpuFanRpm = Sensor $g $sup 0x06
    cpuFanMode = $(if ($cm) { $modeName[$cm] } else { $null }); gpuFanMode = $(if ($gm) { $modeName[$gm] } else { $null })
    healthMode = Health $b
  }
}
function Save($file, $obj) { $tmp = "$file.tmp"; [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Compress -Depth 4), (New-Object Text.UTF8Encoding $false)); Move-Item -LiteralPath $tmp -Destination $file -Force }
function NitroOpen { [bool](Get-Process -Name 'NitroSense', 'PredatorSense' -ErrorAction SilentlyContinue) }
function SetFans([int]$m) {
  $g = Gaming
  $r = [uint64](Invoke-CimMethod -InputObject $g -MethodName SetGamingFanBehavior -Arguments @{ gmInput = [uint64](0x09 -bor ($m -shl 16) -bor ($m -shl 22)) }).gmOutput
  [int]($r -band 0xFF)
}
function Answering { try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5577/api/version' -TimeoutSec 3; $true } catch { $false } }

try {
  if ($Mode -eq 'read') {
    if (-not $Want) { exit 2 }
    while ($true) {
      $t = $null; try { $t = (Get-Item -LiteralPath $Want -ErrorAction Stop).LastWriteTimeUtc } catch {}
      if (-not $t -or ((Get-Date).ToUniversalTime() - $t).TotalSeconds -gt 20) { break }
      try { Save $readings (Snapshot) } catch { Save $readings ([ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); error = $_.Exception.Message }) }
      Start-Sleep -Milliseconds 1000
    }
    exit 0
  }
  $out = [ordered]@{ mode = $Mode; at = (Get-Date).ToUniversalTime().ToString('o'); ok = $false }
  if ($Mode -ne 'fans-auto' -and (NitroOpen)) { $out.why = 'NitroSense is open: close it first (two programs changing the fans or battery fight)'; Save $result $out; exit 0 }
  $before = Snapshot; $out.before = $before
  if ($Mode -eq 'fans-auto' -or $Mode -eq 'fans-max') {
    $want = $(if ($Mode -eq 'fans-max') { 2 } else { 1 })
    $status = SetFans $want
    Start-Sleep -Milliseconds 500
    $after = Snapshot; $out.after = $after
    $out.ok = ($status -eq 0) -and ($after.cpuFanMode -eq $modeName[$want] -or $null -eq $after.cpuFanMode) -and ($after.gpuFanMode -eq $modeName[$want] -or $null -eq $after.gpuFanMode) -and ($null -ne $after.cpuFanMode -or $null -ne $after.gpuFanMode)
    if (-not $out.ok) { $out.why = "the laptop answered status $status and reads $($after.cpuFanMode) / $($after.gpuFanMode)"; if ($want -eq 2) { SetFans 1 | Out-Null } }
    Save $result $out
    if ($want -eq 2 -and $out.ok) {
      # the watcher: never left on Max
      $start = Get-Date; $quiet = $null
      while ($true) {
        Start-Sleep -Seconds 3
        if (((Get-Date) - $start).TotalHours -ge 4) { $why = '4 hours'; break }
        if (Answering) { $quiet = $null } elseif (-not $quiet) { $quiet = Get-Date } elseif (((Get-Date) - $quiet).TotalSeconds -ge 15) { $why = 'DeviceHub stopped answering'; break }
        $g = Gaming
        if ((FanMode $g 0x01 8) -ne 2 -and (FanMode $g 0x08 14) -ne 2) { exit 0 }   # changed elsewhere: nothing to put back
      }
      SetFans 1 | Out-Null
      Save $result ([ordered]@{ mode = 'fans-auto'; at = (Get-Date).ToUniversalTime().ToString('o'); ok = $true; why = "back to Auto: $why"; after = (Snapshot) })
    }
    exit 0
  }
  # health-on / health-off
  $on = $Mode -eq 'health-on'
  if ($null -eq $before.healthMode) { $out.why = 'this laptop has no charge limit Windows can reach'; Save $result $out; exit 0 }
  $b = Battery
  $r = Invoke-CimMethod -InputObject $b -MethodName SetBatteryHealthControl -Arguments @{ uBatteryNo = [byte]1; uFunctionMask = [byte]1; uFunctionStatus = [byte]$(if ($on) { 1 } else { 0 }); uReservedIn = [byte[]](0, 0, 0, 0, 0) }
  Start-Sleep -Milliseconds 300
  $after = Snapshot; $out.after = $after
  $out.ok = $after.healthMode -eq $on
  if (-not $out.ok) { $out.why = "the laptop reads the charge limit $(if ($after.healthMode) { 'on' } else { 'off' }) (it answered $($r.uReturn))" }
  Save $result $out
  exit 0
} catch {
  try { Save $(if ($Mode -eq 'read') { $readings } else { $result }) ([ordered]@{ mode = $Mode; at = (Get-Date).ToUniversalTime().ToString('o'); ok = $false; error = $_.Exception.Message }) } catch {}
  exit 3
}
