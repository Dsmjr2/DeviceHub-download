# Turns the screens off (Monitors > Sleep): Windows' own SC_MONITORPOWER message, posted to every window. A short wait
# first, so the click that started it does not wake the screens again. No third-party tool (26 Oct 2026).
# 2 s (27 Oct 2026, Shawn); each run notes its result in logs\sleep-monitors.log, so a failure can be seen
$log = Join-Path (Split-Path $PSScriptRoot) 'logs\sleep-monitors.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
try {
Start-Sleep -Milliseconds 2000
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DhDisplayPower {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam, int flags, int timeout, out IntPtr result);
    // sent, not posted, and waited on (2 s at most per window, a hung window skipped): 27 Oct 2026, Shawn: the posted
    // message did nothing on his PC
    public static void Off() { IntPtr r; SendMessageTimeout(new IntPtr(0xFFFF), 0x0112, new IntPtr(0xF170), new IntPtr(2), 0x0002, 2000, out r); }
}
"@
[DhDisplayPower]::Off()
"$(Get-Date -Format s) sent" | Add-Content $log
} catch { "$(Get-Date -Format s) failed: $($_.Exception.Message)" | Add-Content $log }
