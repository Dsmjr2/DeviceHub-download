# Closes DeviceHub's app window in the person's own Chrome or Edge (the low-memory window, settings.json lightWindow) as
# its X button does (29 Oct 2026, Shawn: the window did not close after Monitors > Sleep). Chrome ignores the page's own
# window.close() once the person has moved between pages (each page adds a Back step), and the person's Chrome must
# never be killed. So the page first sets a one-time title of its own ("DeviceHub closing <nonce>"), and this script
# sends WM_CLOSE only to the top-level window whose title is EXACTLY that, and only if it belongs to chrome.exe or
# msedge.exe. A normal browser window's title ends in " - Google Chrome" / " - Microsoft Edge", so it never matches:
# only DeviceHub's own app window can. Prints "closed <n>" or "not found".
param([Parameter(Mandatory = $true)][ValidatePattern('^DeviceHub closing [0-9a-f]{16}$')][string]$Title)
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class DhAppWindow {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    public static int Close(string title) {
        var hits = new List<IntPtr>();
        EnumWindows((h, p) => {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString() != title) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            string name = "";
            try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
            if (name == "chrome" || name == "msedge") hits.Add(h);
            return true;
        }, IntPtr.Zero);
        if (hits.Count != 1) return hits.Count == 0 ? 0 : -hits.Count;   // two with one unique title: neither is closed
        PostMessage(hits[0], 0x0010, IntPtr.Zero, IntPtr.Zero);         // WM_CLOSE, as the X button
        return 1;
    }
}
"@
$n = [DhAppWindow]::Close($Title)
if ($n -eq 1) { 'closed 1' } elseif ($n -eq 0) { 'not found' } else { "not closed: $(-$n) windows had that title" }
