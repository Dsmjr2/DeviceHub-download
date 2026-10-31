# The Laptop page (29 Oct 2026, Shawn: what someone setting up is missing; a friend's Lenovo Legion Gen 10). Prints one
# line of JSON about this laptop:
#   maker, model, battery (charge, on the charger, health: full charge vs design capacity, charge cycles), Windows'
#   power mode (Best power efficiency / Balanced / Best performance), and on a Lenovo Legion its own power mode
#   (Quiet / Balanced / Performance / Custom, the one Fn+Q cycles), read from Lenovo's WMI. Reading only.
# -Mode efficiency|balanced|performance sets Windows' power mode first (the same switch as Settings > System > Power),
# then prints the state so the page sees it took. Nothing else is ever changed: Lenovo's power mode is read, not set.
param([ValidateSet('', 'efficiency', 'balanced', 'performance')][string]$Mode = '')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DhPowerMode {
    [DllImport("powrprof.dll")] static extern uint PowerGetEffectiveOverlayScheme(out Guid g);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveOverlayScheme(Guid g);
    public static readonly Guid Efficiency = new Guid("961cc777-2547-4f9d-8174-7d86181b8a7a");
    public static readonly Guid Balanced = Guid.Empty;
    public static readonly Guid Performance = new Guid("ded574b5-45a0-4f42-8737-46345c09c238");
    public static string Get() {
        Guid g;
        if (PowerGetEffectiveOverlayScheme(out g) != 0) return null;
        if (g == Efficiency) return "efficiency";
        if (g == Performance) return "performance";
        if (g == Balanced) return "balanced";
        return "other";
    }
    public static uint Set(string mode) {
        return PowerSetActiveOverlayScheme(mode == "efficiency" ? Efficiency : mode == "performance" ? Performance : Balanced);
    }
}
"@
function Safely($f) { try { & $f } catch { $null } }
$out = [ordered]@{ ok = $true }
if ($Mode) {
  $r = [DhPowerMode]::Set($Mode)
  $out.set = [ordered]@{ asked = $Mode; result = [int]$r }
}
$cs = Safely { Get-CimInstance Win32_ComputerSystem }
$prod = Safely { Get-CimInstance Win32_ComputerSystemProduct }
$enc = Safely { @(Get-CimInstance Win32_SystemEnclosure)[0] }
$out.maker = if ($cs) { [string]$cs.Manufacturer } else { $null }
# Lenovo puts the marketing name (Legion Pro 7 16IAX10H) in the product's Version, and a part number in the Model
$out.model = if ($prod -and $prod.Version -and $prod.Version -notmatch '^(None|To be filled|System Version|Default string)') { [string]$prod.Version } elseif ($cs) { [string]$cs.Model } else { $null }
$chassis = if ($enc) { @($enc.ChassisTypes) } else { @() }
$out.portable = [bool](@($chassis | Where-Object { $_ -in 8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32 }).Count)
$bat = Safely { @(Get-CimInstance Win32_Battery)[0] }
if ($bat) {
  $design = Safely { (@(Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData)[0]).DesignedCapacity }
  $full = Safely { (@(Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity)[0]).FullChargedCapacity }
  $cycles = Safely { (@(Get-CimInstance -Namespace root\wmi -ClassName BatteryCycleCount)[0]).CycleCount }
  $out.battery = [ordered]@{
    percent = $bat.EstimatedChargeRemaining
    charger = ($bat.BatteryStatus -in 2, 3, 6, 7, 8, 9)
    minutesLeft = if ($bat.EstimatedRunTime -and $bat.EstimatedRunTime -lt 71582788) { $bat.EstimatedRunTime } else { $null }
    designMWh = $design; fullMWh = $full; cycles = $cycles
    health = if ($design -and $full -and $design -gt 0) { [math]::Round(100 * $full / $design) } else { $null }
  }
} else { $out.battery = $null }
$out.powerMode = Safely { [DhPowerMode]::Get() }
# Lenovo Legion: its own power mode (Fn+Q), read only. 1 Quiet, 2 Balanced, 3 Performance, 255 Custom.
$out.legion = $null
if ($out.maker -match 'LENOVO') {
  $gz = Safely { Get-CimInstance -Namespace root\WMI -ClassName LENOVO_GAMEZONE_DATA }
  if ($gz) {
    $m = Safely { (Invoke-CimMethod -InputObject @($gz)[0] -MethodName GetSmartFanMode).Data }
    $out.legion = [ordered]@{ mode = $m; name = switch ($m) { 1 { 'Quiet' } 2 { 'Balanced' } 3 { 'Performance' } 224 { 'Extreme' } 255 { 'Custom' } default { $null } } }
  }
}
$out | ConvertTo-Json -Compress -Depth 4
