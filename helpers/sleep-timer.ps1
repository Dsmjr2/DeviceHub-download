# When the PC goes to sleep (2 Nov 2026, Shawn: "make a dropdown field on the power plan where it decides when my pc
# sleeps so I can change it quickly"; helpers/sleep-timer.js). Prints one line of JSON: the active power plan's
# "Sleep after" in seconds, plugged in (ac) and on battery (dc), and (3 Nov 2026) "Turn off my screen after"
# (screenAc, screenDc), 0 = never; the same settings as Settings > System > Power > Screen and sleep (powercfg's
# standby-timeout and monitor-timeout), read through Windows' own power API.
# -Ac / -Dc / -ScreenAc / -ScreenDc <seconds> set one first (on the ACTIVE plan only, nothing else), then the state is
# read back and printed. Hibernate, wake timers and other plans are never touched.
param([int]$Ac = -1, [int]$Dc = -1, [int]$ScreenAc = -1, [int]$ScreenDc = -1)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DhSleep2 {
    [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr scheme);
    [DllImport("powrprof.dll")] static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
    [DllImport("powrprof.dll")] static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] static extern uint PowerReadDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
    [DllImport("powrprof.dll")] static extern bool GetPwrCapabilities(byte[] caps);
    // SYSTEM_POWER_CAPABILITIES byte 20 AoAc: Modern Standby (as helpers/sleep-monitors.ps1)
    public static bool ModernStandby() { var b = new byte[128]; return GetPwrCapabilities(b) && b[20] != 0; }
    static Guid SleepSub = new Guid("238c9fa8-0aad-41ed-83f4-97be242c8f20");   // GUID_SLEEP_SUBGROUP
    static Guid Standby = new Guid("29f6c1db-86da-48c5-9fdb-f2b67b1f44da");    // GUID_STANDBY_TIMEOUT ("Sleep after")
    static Guid VideoSub = new Guid("7516b95f-f776-4464-8c53-06167f40cc99");   // GUID_VIDEO_SUBGROUP
    static Guid VideoIdle = new Guid("3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e");  // GUID_VIDEO_POWERDOWN_TIMEOUT ("Turn off display after")
    public static Guid Active() {
        IntPtr p;
        if (PowerGetActiveScheme(IntPtr.Zero, out p) != 0) throw new Exception("the active power plan could not be read");
        Guid g = (Guid)Marshal.PtrToStructure(p, typeof(Guid));
        LocalFree(p);
        return g;
    }
    public static uint Read(bool screen, bool ac) {
        Guid s = Active(); uint v;
        Guid sub = screen ? VideoSub : SleepSub, set = screen ? VideoIdle : Standby;
        uint r = ac ? PowerReadACValueIndex(IntPtr.Zero, ref s, ref sub, ref set, out v) : PowerReadDCValueIndex(IntPtr.Zero, ref s, ref sub, ref set, out v);
        if (r != 0) throw new Exception((screen ? "Screen off after" : "Sleep after") + " could not be read (" + r + ")");
        return v;
    }
    public static void Write(bool screen, bool ac, uint v) {
        Guid s = Active();
        Guid sub = screen ? VideoSub : SleepSub, set = screen ? VideoIdle : Standby;
        uint r = ac ? PowerWriteACValueIndex(IntPtr.Zero, ref s, ref sub, ref set, v) : PowerWriteDCValueIndex(IntPtr.Zero, ref s, ref sub, ref set, v);
        if (r == 5) throw new Exception("Windows needs administrator rights to change this power plan");
        if (r != 0) throw new Exception((screen ? "Screen off after" : "Sleep after") + " could not be changed (" + r + ")");
        PowerSetActiveScheme(IntPtr.Zero, ref s);   // the active plan's new value takes effect now
    }
}
"@
$out = [ordered]@{ ok = $true }
try {
  if ($Ac -ge 0) { [DhSleep2]::Write($false, $true, [uint32]$Ac) }
  if ($Dc -ge 0) { [DhSleep2]::Write($false, $false, [uint32]$Dc) }
  if ($ScreenAc -ge 0) { [DhSleep2]::Write($true, $true, [uint32]$ScreenAc) }
  if ($ScreenDc -ge 0) { [DhSleep2]::Write($true, $false, [uint32]$ScreenDc) }
  $out.plan = [string][DhSleep2]::Active()
  $out.ac = [int64][DhSleep2]::Read($false, $true)
  $out.dc = [int64][DhSleep2]::Read($false, $false)
  $out.screenAc = [int64][DhSleep2]::Read($true, $true)
  $out.screenDc = [int64][DhSleep2]::Read($true, $false)
  $out.battery = [bool](Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
  $out.modernStandby = [DhSleep2]::ModernStandby()
} catch { $out = [ordered]@{ ok = $false; why = $_.Exception.Message } }
$out | ConvertTo-Json -Compress
