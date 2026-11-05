# Turns the screens off (Monitors > Sleep). A short wait first, so the click that started it does not wake the screens
# again. No third-party tool (26 Oct 2026). Each run notes its result in logs\sleep-monitors.log.
#
# Two ways, by what the PC's sleep is (3 Nov 2026, Shawn: "when I clicked sleep it just put my laptop to sleep instead
# of screen only like my pc at home"):
#  - S3 sleep (the home PC): Windows' own SC_MONITORPOWER message, sent to ONE hidden window of our own, never broadcast
#    (27 Oct 2026, Shawn: the screens went back to sleep when he woke them: a broadcast stays queued in apps paused in
#    the background, which handle it when they wake, turning the screens off again). Unchanged.
#  - Modern Standby (S0 Low Power Idle, GetPwrCapabilities AoAc; the laptop): there the display going off IS the PC
#    going to standby, so the screens are blanked instead and the PC keeps running: a black topmost window on every
#    screen with the cursor hidden, the built-in panel at its lowest brightness (Windows' WmiMonitorBrightness, the
#    value before saved and put back exactly), and Windows told the display and the system are in use while it lasts
#    (SetThreadExecutionState), so its own idle timer cannot turn the display off into standby either. Any key, mouse
#    move, click or touch (Windows' last-input time moving) ends it. Monitor power over DDC/CI (VCP 0xD6) is never sent
#    (helpers/monitors.js NEVER): the black window covers external screens too.
param([switch]$Probe, [switch]$Restore)
$log = Join-Path (Split-Path $PSScriptRoot) 'logs\sleep-monitors.log'
# the panel brightness before a blank, kept until it is put back (a blank cut short leaves it here; -Restore, run by
# DeviceHub at its start, puts it back)
$keep = Join-Path (Split-Path $PSScriptRoot) 'logs\sleep-monitors-brightness.json'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class DhDisplayPower {
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("powrprof.dll")] static extern bool GetPwrCapabilities(byte[] caps);
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    // SYSTEM_POWER_CAPABILITIES: byte 3-6 SystemS1..S4, byte 20 AoAc (Modern Standby)
    public static bool ModernStandby() {
        var b = new byte[128];
        if (!GetPwrCapabilities(b)) return false;
        return b[20] != 0;
    }
    public static void Off() {
        var w = new NativeWindow();
        w.CreateHandle(new CreateParams());
        try { SendMessage(w.Handle, 0x0112, new IntPtr(0xF170), new IntPtr(2)); }
        finally { w.DestroyHandle(); }
    }
    public static uint LastInput() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return i.dwTime; }
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED while blanked; ES_CONTINUOUS alone to let go
    public static void KeepOn(bool on) { SetThreadExecutionState(on ? 0x80000003u : 0x80000000u); }
}
"@
if ($Probe) { if ([DhDisplayPower]::ModernStandby()) { 'modern' } else { 's3' }; exit 0 }

function Get-Panel { try { @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop) } catch { @() } }
function Set-Panel($instance, [int]$level) {
  $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Where-Object { $_.InstanceName -eq $instance }
  if ($m) { Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte]$level } | Out-Null }
}

if ($Restore) {
  if (Test-Path $keep) {
    try { foreach ($p in (Get-Content $keep -Raw | ConvertFrom-Json)) { Set-Panel $p.Instance ([int]$p.Was) }; Remove-Item $keep -Force; "$(Get-Date -Format s) brightness put back after a blank that was cut short" | Add-Content $log }
    catch { "$(Get-Date -Format s) restore failed: $($_.Exception.Message)" | Add-Content $log }
  }
  exit 0
}
try {
  Start-Sleep -Milliseconds 2000
  if (-not [DhDisplayPower]::ModernStandby()) {
    [DhDisplayPower]::Off()
    "$(Get-Date -Format s) sent" | Add-Content $log
    exit 0
  }
  # Modern Standby: blank, keep running
  $panels = @(Get-Panel | ForEach-Object { [pscustomobject]@{ Instance = $_.InstanceName; Was = [int]$_.CurrentBrightness } })
  if ($panels.Count) { ConvertTo-Json -InputObject $panels -Compress | Set-Content -Path $keep -Encoding UTF8 }
  [DhDisplayPower]::KeepOn($true)
  $forms = @()
  try {
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
      $f = New-Object System.Windows.Forms.Form
      $f.FormBorderStyle = 'None'; $f.BackColor = [System.Drawing.Color]::Black; $f.TopMost = $true; $f.ShowInTaskbar = $false
      $f.StartPosition = 'Manual'; $f.Bounds = $s.Bounds
      $f.Show(); $forms += $f
    }
    [System.Windows.Forms.Cursor]::Hide()
    foreach ($p in $panels) { try { Set-Panel $p.Instance 0 } catch {} }
    "$(Get-Date -Format s) blanked (Modern Standby: screens black, panel brightness $(($panels | ForEach-Object { $_.Was }) -join ',') -> 0, PC kept awake)" | Add-Content $log
    # a moment for the click's own movement to settle, then any input ends it
    Start-Sleep -Milliseconds 700
    [System.Windows.Forms.Application]::DoEvents()
    $start = [DhDisplayPower]::LastInput()
    while ([DhDisplayPower]::LastInput() -eq $start) { Start-Sleep -Milliseconds 100; [System.Windows.Forms.Application]::DoEvents() }
  } finally {
    $back = $true
    foreach ($p in $panels) { try { Set-Panel $p.Instance $p.Was } catch { $back = $false } }
    if ($back) { Remove-Item $keep -Force -ErrorAction SilentlyContinue }
    try { [System.Windows.Forms.Cursor]::Show() } catch {}
    foreach ($f in $forms) { try { $f.Close() } catch {} }
    [DhDisplayPower]::KeepOn($false)
    "$(Get-Date -Format s) woke (panel brightness put back: $(($panels | ForEach-Object { $_.Was }) -join ','))" | Add-Content $log
  }
} catch { "$(Get-Date -Format s) failed: $($_.Exception.Message)" | Add-Content $log }
