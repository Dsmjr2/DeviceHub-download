# PC check facts for helpers/pc-check.js (24 Oct 2026, docs/handoff/display-health.md). Read only, as the signed-in
# user (no administrator). Each part is tried on its own; a part Windows refuses is named in "denied", never guessed.
# Prints one JSON object.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = [ordered]@{ volumes = @(); disks = @(); reliability = @(); video = @(); ram = @(); board = $null; devices = @(); events = $null; restart = $null; denied = @(); errors = @() }
function Note($part, $e) {
  $m = $e.Exception.Message
  if ($m -match 'denied|not available to the client|Unauthorized|privilege') { $script:out.denied += $part } else { $script:out.errors += "${part}: $m" }
}

try { $out.volumes = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [ordered]@{ drive = $_.DeviceID; label = $_.VolumeName; size = [double]$_.Size; free = [double]$_.FreeSpace } }) } catch { Note 'volumes' $_ }
try {
  $pd = @(Get-PhysicalDisk)
  $out.disks = @($pd | ForEach-Object { [ordered]@{ id = [string]$_.DeviceId; name = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; health = [string]$_.HealthStatus; status = [string](@($_.OperationalStatus) -join ', '); size = [double]$_.Size } })
  try { $out.reliability = @($pd | Get-StorageReliabilityCounter -ErrorAction Stop | ForEach-Object { [ordered]@{ id = [string]$_.DeviceId; wear = $_.Wear; tempC = $_.Temperature; tempMaxC = $_.TemperatureMax; hours = $_.PowerOnHours } }) } catch { Note 'reliability' $_ }
} catch { Note 'disks' $_ }
try { $out.video = @(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name = $_.Name; maker = $_.AdapterCompatibility; version = $_.DriverVersion; date = $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }); pnp = $_.PNPDeviceID } }) } catch { Note 'video' $_ }
try { $out.ram = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [ordered]@{ slot = $_.DeviceLocator; maker = $_.Manufacturer; part = ([string]$_.PartNumber).Trim(); speed = $_.Speed; configured = $_.ConfiguredClockSpeed; gb = [math]::Round($_.Capacity / 1GB) ; type = $_.SMBIOSMemoryType } }) } catch { Note 'ram' $_ }
try { $b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1; $out.board = [ordered]@{ maker = $b.Manufacturer; model = $b.Product } } catch { Note 'board' $_ }
try {
  # present devices only (ghosts of unplugged devices are not listed), with a problem code or an Error status
  $out.devices = @(Get-PnpDevice -PresentOnly | Where-Object { ($_.Problem -and [int]$_.Problem -ne 0) -or $_.Status -eq 'Error' } | ForEach-Object { [ordered]@{ name = $_.FriendlyName; cls = $_.Class; status = [string]$_.Status; problem = [int]$_.Problem; id = $_.InstanceId } })
} catch { Note 'devices' $_ }
try {
  $since = (Get-Date).AddDays(-30)
  $ev = [ordered]@{ bugchecks = @(); shutdowns = @(); whea = @() }
  try { $ev.bugchecks = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1001; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; StartTime = $since } -ErrorAction Stop | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); param = [string]$_.Properties[0].Value } }) } catch { if ($_.Exception.Message -notmatch 'No events were found') { Note 'events' $_ } }
  try { $ev.shutdowns = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; ProviderName = 'Microsoft-Windows-Kernel-Power'; StartTime = $since } -ErrorAction Stop | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); bugcheck = [double]$_.Properties[0].Value } }) } catch { if ($_.Exception.Message -notmatch 'No events were found') { Note 'events' $_ } }
  try { $ev.whea = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $since; Level = 1, 2, 3 } -ErrorAction Stop | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); id = $_.Id; level = $_.Level } }) } catch { if ($_.Exception.Message -notmatch 'No events were found') { Note 'events' $_ } }
  $out.events = $ev
} catch { Note 'events' $_ }
try {
  $pf = $null
  try { $pf = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction Stop).PendingFileRenameOperations } catch {}
  $out.restart = [ordered]@{
    cbs = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
    wu = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    files = @($pf | Where-Object { $_ }).Count
  }
} catch { Note 'restart' $_ }
$nv = Join-Path $env:WINDIR 'System32\nvidia-smi.exe'
if (Test-Path $nv) { try { $out.nvidiaVersion = ((& $nv --query-gpu=driver_version --format=csv,noheader) | Select-Object -First 1).Trim() } catch {} }
ConvertTo-Json -Compress -Depth 6 -InputObject $out
