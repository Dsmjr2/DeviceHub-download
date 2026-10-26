# Turns the screens off (Monitors > Sleep): Windows' own SC_MONITORPOWER message, posted to every window. A short wait
# first, so the click that started it does not wake the screens again. No third-party tool (26 Oct 2026).
Start-Sleep -Milliseconds 800
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DhDisplayPower {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    public static void Off() { PostMessage(new IntPtr(0xFFFF), 0x0112, new IntPtr(0xF170), new IntPtr(2)); }
}
"@
[DhDisplayPower]::Off()
