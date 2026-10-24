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
try { $out.ram = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [ordered]@{ slot = $_.DeviceLocator; maker = $_.Manufacturer; part = ([string]$_.PartNumber).Trim(); bank = [string]$_.BankLabel; speed = $_.Speed; configured = $_.ConfiguredClockSpeed; gb = [math]::Round($_.Capacity / 1GB) ; type = $_.SMBIOSMemoryType } }) } catch { Note 'ram' $_ }
try { $b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1; $out.board = [ordered]@{ maker = $b.Manufacturer; model = $b.Product } } catch { Note 'board' $_ }
try {
  # present devices only (ghosts of unplugged devices are not listed), with a problem code or an Error status
  $out.devices = @(Get-PnpDevice -PresentOnly | Where-Object { ($_.Problem -and [int]$_.Problem -ne 0) -or $_.Status -eq 'Error' } | ForEach-Object { [ordered]@{ name = $_.FriendlyName; cls = $_.Class; status = [string]$_.Status; problem = [int]$_.Problem; id = $_.InstanceId } })
} catch { Note 'devices' $_ }
try {
  $since = (Get-Date).AddDays(-30)
  $ev = [ordered]@{ bugchecks = @(); whea = @() }
  try { $ev.bugchecks = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1001; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; StartTime = $since } -ErrorAction Stop | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); param = [string]$_.Properties[0].Value } }) } catch { if ($_.Exception.Message -notmatch 'No events were found') { Note 'events' $_ } }
  try { $ev.whea = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $since; Level = 1, 2, 3 } -ErrorAction Stop | ForEach-Object { [ordered]@{ at = $_.TimeCreated.ToString('o'); id = $_.Id; level = $_.Level } }) } catch { if ($_.Exception.Message -notmatch 'No events were found') { Note 'events' $_ } }
  $out.events = $ev
} catch { Note 'events' $_ }
try {
  # 24 Oct 2026 (Shawn: "is the restart actually accurate?"): Windows Update's own answer (Microsoft.Update.SystemInfo
  # RebootRequired, what Settings > Windows Update shows) and Windows' servicing stack. Not PendingFileRenameOperations:
  # installers and uninstallers leave files there to delete at the next start, so it said "restart" for no update.
  $wu = $null
  try { $wu = [bool](New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired } catch { $wu = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' }
  $out.restart = [ordered]@{
    cbs = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
    wu = $wu
  }
} catch { Note 'restart' $_ }
# the graphics maker's own app (NVIDIA App, AMD Software): its Start menu shortcut, else its usual folder; only an exe
# under Program Files with the expected name counts (helpers/pc-check.js checks it again before starting it)
$apps = [ordered]@{ nvidia = $null; amd = $null }
try {
  $pf = $env:ProgramFiles
  $want = @(
    @('nvidia', 'NVIDIA App*.lnk', 'NVIDIA App.exe', (Join-Path $pf 'NVIDIA Corporation\NVIDIA App\CEF\NVIDIA App.exe')),
    @('amd', 'AMD Software*.lnk', 'RadeonSoftware.exe', (Join-Path $pf 'AMD\CNext\CNext\RadeonSoftware.exe'))
  )
  $menus = @((Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))
  $shell = $null
  foreach ($w in $want) {
    $found = $null
    foreach ($m in $menus) {
      if ($found -or -not (Test-Path -LiteralPath $m)) { continue }
      foreach ($l in @(Get-ChildItem -LiteralPath $m -Recurse -Filter $w[1] -ErrorAction SilentlyContinue)) {
        if (-not $shell) { $shell = New-Object -ComObject WScript.Shell }
        $t = $shell.CreateShortcut($l.FullName).TargetPath
        if ($t -and (Split-Path $t -Leaf) -eq $w[2] -and $t.StartsWith($pf + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $t)) { $found = $t; break }
      }
    }
    if (-not $found -and (Test-Path -LiteralPath $w[3])) { $found = $w[3] }
    $apps[$w[0]] = $found
  }
} catch { $out.errors += "apps: " + $_.Exception.Message }
$out.driverApps = $apps

$nv = Join-Path $env:WINDIR 'System32\nvidia-smi.exe'
if (Test-Path $nv) { try { $out.nvidiaVersion = ((& $nv --query-gpu=driver_version --format=csv,noheader) | Select-Object -First 1).Trim() } catch {} }
# ---- what could make games run better, read only (24 Oct 2026, Shawn: "even more things that could be optimized to
# have better fps, wifi, etc ONLY if they can be done"). Each part on its own; nothing is changed here. ----
function RegValue($key, $name) { try { return (Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop).$name } catch { return $null } }
$tune = [ordered]@{}
try {
  # the power plan: the active scheme, every scheme (GUID and name) and the Windows 11 power mode overlay
  $act = ([regex]::Match((& powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')).Value
  $plans = @(& powercfg /list | ForEach-Object { $m = [regex]::Match($_, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s+\((.+?)\)'); if ($m.Success) { [ordered]@{ guid = $m.Groups[1].Value.ToLower(); name = $m.Groups[2].Value } } })
  $tune.power = [ordered]@{ active = $act.ToLower(); plans = $plans; overlay = [string](RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' 'ActiveOverlayAcPowerScheme') }
  # Wi-Fi adapter power saving while plugged in (Power Options > Wireless Adapter Settings): the AC index, 0 = Maximum Performance
  $q = & powercfg /query SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 2>$null | Out-String
  $idx = [regex]::Matches($q, ':\s*0x([0-9a-fA-F]{8})\s*$', 'Multiline')
  if ($idx.Count -ge 1) { $tune.power.wifiSaveAc = [Convert]::ToInt32($idx[0].Groups[1].Value, 16) }
} catch { $out.errors += "power: " + $_.Exception.Message }
try { $tune.battery = @(Get-CimInstance Win32_Battery -ErrorAction Stop).Count -gt 0 } catch { $tune.battery = $null }
$tune.gameMode = RegValue 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled'
$tune.bgRecord = RegValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' 'HistoricalCaptureEnabled'
$tune.hags = RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode'
$tune.dxGlobal = [string](RegValue 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' 'DirectXUserGlobalSettings')
$tune.windowsBuild = [int](RegValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'CurrentBuildNumber')
$tune.firmware = RegValue 'HKLM:\SYSTEM\CurrentControlSet\Control' 'PEFirmwareType'
$tune.mouseAccel = [string](RegValue 'HKCU:\Control Panel\Mouse' 'MouseSpeed')
# Resizable BAR on NVIDIA: BAR1 is 256 MiB when it is off and about the card's memory when on (nvidia-smi -q -d MEMORY)
if (Test-Path $nv) { try { $mq = (& $nv -q -d MEMORY) | Out-String; $b = [regex]::Match($mq, 'BAR1 Memory Usage\s+Total\s*:\s*(\d+)\s*MiB'); $f = [regex]::Match($mq, 'FB Memory Usage\s+Total\s*:\s*(\d+)\s*MiB'); if ($b.Success) { $tune.bar1MiB = [int]$b.Groups[1].Value; $tune.vramMiB = $(if ($f.Success) { [int]$f.Groups[1].Value } else { $null }) } } catch {} }
# the network: wired adapters that are up (their link speed), and Wi-Fi from netsh (English labels; anything else is left out)
try { $tune.wired = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -eq '802.3' } | ForEach-Object { [ordered]@{ name = $_.InterfaceDescription; bps = [double]$_.ReceiveLinkSpeed } }) } catch {}
try {
  $wi = & netsh wlan show interfaces 2>$null | Out-String
  if ($wi -match '(?m)^\s*State\s*:\s*connected') {
    $g = { param($label) $m = [regex]::Match($wi, "(?m)^\s*$label\s*:\s*(.+?)\s*$"); if ($m.Success) { $m.Groups[1].Value } else { $null } }
    $w = [ordered]@{ ssid = (& $g 'SSID'); band = (& $g 'Band'); channel = (& $g 'Channel'); signal = (& $g 'Signal'); radio = (& $g 'Radio type') }
    $dr = & netsh wlan show drivers 2>$null | Out-String
    $w.radios = ([regex]::Match($dr, '(?m)^\s*Radio types supported\s*:\s*(.+?)\s*$')).Groups[1].Value
    # does the same network (or one named for 5 GHz) answer on a 5 or 6 GHz channel nearby?
    $nets = & netsh wlan show networks mode=bssid 2>$null | Out-String
    $five = $false; $cur = $null
    foreach ($ln in ($nets -split "`r?`n")) {
      $s = [regex]::Match($ln, '^SSID \d+\s*:\s*(.*)$'); if ($s.Success) { $cur = $s.Groups[1].Value.Trim(); continue }
      $c = [regex]::Match($ln, '^\s*Channel\s*:\s*(\d+)'); if ($c.Success -and [int]$c.Groups[1].Value -gt 14 -and $cur -and ($cur -eq $w.ssid -or ($w.ssid -and $cur -like "$($w.ssid -replace '[-_ ]?2\.?4\s*G?h?z?$','')*5G*"))) { $five = $true }
    }
    $w.fiveNearby = $five
    $tune.wifi = $w
  }
} catch {}
$out.tune = $tune
ConvertTo-Json -Compress -Depth 6 -InputObject $out
