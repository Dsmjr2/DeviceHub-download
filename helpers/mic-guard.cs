// What the Anker mic guard needs to know (19 Oct 2026, Shawn: the camera mic "always muted UNLESS I am using google
// meet or google chat"): the titles of every visible Chrome window, and whether Chrome is using a microphone right now
// (Windows records it per program: LastUsedTimeStop is 0 while in use). Read-only.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

public static class MicGuard {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

  public static Dictionary<string, object> Look() {
    var chromePids = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("chrome")) { chromePids.Add((uint)p.Id); p.Dispose(); }
    var titles = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!chromePids.Contains(pid)) return true;
      var sb = new StringBuilder(512); if (GetWindowText(h, sb, 512) > 0) titles.Add(sb.ToString());
      return true;
    }, IntPtr.Zero);
    bool inUse = false;
    try {
      using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged")) {
        if (k != null) foreach (var name in k.GetSubKeyNames()) {
          if (name.IndexOf("chrome.exe", StringComparison.OrdinalIgnoreCase) < 0) continue;
          using (var a = k.OpenSubKey(name)) {
            var start = a.GetValue("LastUsedTimeStart"); var stop = a.GetValue("LastUsedTimeStop");
            if (start != null && Convert.ToInt64(start) != 0 && stop != null && Convert.ToInt64(stop) == 0) inUse = true;
          }
        }
      }
    } catch { }
    return new Dictionary<string, object> { { "titles", titles }, { "chromeMic", inUse } };
  }

  // every Windows recording device (any state): { id, name, state }
  public static List<Dictionary<string, object>> Mics() {
    var r = new List<Dictionary<string, object>>();
    foreach (var line in AudioDefault.List("")) {
      var c = line.Split('|'); if (c[0] != "recording") continue;
      r.Add(new Dictionary<string, object> { { "id", c[1] }, { "state", int.Parse(c[2]) }, { "name", c[3] } });
    }
    return r;
  }
}
