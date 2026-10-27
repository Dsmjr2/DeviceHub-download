# Turns the screens off (Monitors > Sleep): Windows' own SC_MONITORPOWER message. A short wait first, so the click that
# started it does not wake the screens again. No third-party tool (26 Oct 2026).
# 2 s (27 Oct 2026, Shawn); each run notes its result in logs\sleep-monitors.log, so a failure can be seen
# Sent to ONE hidden window of our own, never broadcast (27 Oct 2026, Shawn: the screens went back to sleep when he woke
# them): a broadcast stays queued in apps paused in the background, which handle it when they wake, turning the screens
# off again
$log = Join-Path (Split-Path $PSScriptRoot) 'logs\sleep-monitors.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
try {
Start-Sleep -Milliseconds 2000
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class DhDisplayPower {
    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    public static void Off() {
        var w = new NativeWindow();
        w.CreateHandle(new CreateParams());
        try { SendMessage(w.Handle, 0x0112, new IntPtr(0xF170), new IntPtr(2)); }
        finally { w.DestroyHandle(); }
    }
}
"@
[DhDisplayPower]::Off()
"$(Get-Date -Format s) sent" | Add-Content $log
} catch { "$(Get-Date -Format s) failed: $($_.Exception.Message)" | Add-Content $log }
