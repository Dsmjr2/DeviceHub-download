// Monitor controls over DDC/CI (20 Oct 2026): Windows' own monitor configuration API (dxva2.dll), nothing installed.
// Reads a monitor's capabilities and its current values, and sets one VCP feature at a time:
// 0x10 brightness, 0x12 contrast, 0x62 speaker volume. Input switching is left out on purpose: measured 20 Oct 2026,
// both of Shawn's monitors report a random input when asked (six reads: DP, HDMI 1, HDMI 2), so a change could not be
// read back, and a wrong one leaves a screen dark. Never touches power (0xD6), factory reset (0x04 / 0x05 / 0x06 / 0x08) or anything not in that list.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class Monitors {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PHYSICAL_MONITOR { public IntPtr hPhysicalMonitor; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szPhysicalMonitorDescription; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }
  delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc f, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, uint i, ref DISPLAY_DEVICE dd, uint flags);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint n, [Out] PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYSICAL_MONITOR[] arr);
  [DllImport("dxva2.dll")] static extern bool GetCapabilitiesStringLength(IntPtr h, out uint len);
  [DllImport("dxva2.dll", CharSet = CharSet.Ansi)] static extern bool CapabilitiesRequestAndCapabilitiesReply(IntPtr h, StringBuilder s, uint len);
  [DllImport("dxva2.dll")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, IntPtr type, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint value);

  // 0x14 color preset, 0x16 / 0x18 / 0x1A red / green / blue gain, 0x6C / 0x6E / 0x70 red / green / blue black level (20 Oct 2026):
  // the standard MCCS picture settings, each tested on Shawn's monitors with a read-back before it was allowed
  public static readonly byte[] ALLOWED = { 0x10, 0x12, 0x62, 0x14, 0x16, 0x18, 0x1A, 0x6C, 0x6E, 0x70 };

  // each physical monitor: its id (the monitor's own hardware id, stable across restarts), screen, name, and the
  // handle used for one call (opened and closed around every operation, so nothing is held between calls)
  class Mon { public string id, screen, name; public IntPtr hMon; public int index; }

  static List<Mon> Enumerate() {
    var list = new List<Mon>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr dc, ref RECT r, IntPtr d) => {
      var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      GetMonitorInfo(h, ref mi);
      uint n; if (!GetNumberOfPhysicalMonitorsFromHMONITOR(h, out n) || n == 0) return true;
      for (int i = 0; i < n; i++) {
        var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
        string id = mi.szDevice + "#" + i, name = "Monitor";
        if (EnumDisplayDevices(mi.szDevice, (uint)i, ref dd, 1)) {
          // DeviceID like \\?\DISPLAY#AOC3270#5&...#{guid}: the model code (AOC3270) names the monitor
          var m = Regex.Match(dd.DeviceID ?? "", @"DISPLAY#([^#]+)#([^#]+)");
          if (m.Success) id = m.Groups[1].Value + "#" + m.Groups[2].Value;
          if (!string.IsNullOrEmpty(dd.DeviceString)) name = dd.DeviceString;
        }
        list.Add(new Mon { id = id, screen = mi.szDevice, name = name, hMon = h, index = i });
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static T WithHandle<T>(Mon m, Func<IntPtr, T> f) {
    uint n; if (!GetNumberOfPhysicalMonitorsFromHMONITOR(m.hMon, out n) || n <= m.index) throw new Exception("monitor not found");
    var arr = new PHYSICAL_MONITOR[n];
    if (!GetPhysicalMonitorsFromHMONITOR(m.hMon, n, arr)) throw new Exception("monitor not reachable");
    try { return f(arr[m.index].hPhysicalMonitor); } finally { DestroyPhysicalMonitors(n, arr); }
  }

  static Dictionary<string, object> Read(IntPtr h, bool caps) {
    var o = new Dictionary<string, object>();
    if (caps) {
      uint len; string c = null;
      // monitors answer slowly; DDC/CI needs a moment between messages, so one retry
      for (int t = 0; t < 2 && c == null; t++) {
        if (GetCapabilitiesStringLength(h, out len) && len > 0) { var sb = new StringBuilder((int)len); if (CapabilitiesRequestAndCapabilitiesReply(h, sb, len)) c = sb.ToString(); }
        if (c == null) System.Threading.Thread.Sleep(60);
      }
      o["caps"] = c;
    }
    var vals = new Dictionary<string, object>();
    foreach (var code in ALLOWED) {
      uint cur, max; bool ok = false;
      for (int t = 0; t < 2 && !ok; t++) { ok = GetVCPFeatureAndVCPFeatureReply(h, code, IntPtr.Zero, out cur, out max); if (ok) vals[code.ToString("X2")] = new Dictionary<string, object> { { "cur", cur }, { "max", max } }; else System.Threading.Thread.Sleep(50); }
    }
    o["values"] = vals;
    return o;
  }

  // op "monitors": every monitor with its values (and capabilities when caps is set)
  public static object List(bool caps) {
    var r = new List<object>();
    foreach (var m in Enumerate()) {
      var o = new Dictionary<string, object> { { "id", m.id }, { "screen", m.screen }, { "name", m.name } };
      try { foreach (var kv in WithHandle(m, (h) => Read(h, caps))) o[kv.Key] = kv.Value; o["ddc"] = ((Dictionary<string, object>)o["values"]).Count > 0; }
      catch (Exception e) { o["ddc"] = false; o["error"] = e.Message; }
      r.Add(o);
    }
    return r;
  }

  // op "monitor-set": one feature on one monitor, then read back
  // live: a step while a slider is dragged (21 Oct 2026): written without the read-back, then only the 50 ms DDC/CI
  // asks between two messages; the release is written the normal way and read back
  public static object Set(string id, int code, int value, bool live = false) {
    if (Array.IndexOf(ALLOWED, (byte)code) < 0) throw new Exception("not an allowed setting");
    if (value < 0 || value > 65535) throw new Exception("bad value");
    foreach (var m in Enumerate()) {
      if (m.id != id) continue;
      return WithHandle(m, (h) => {
        if (!SetVCPFeature(h, (byte)code, (uint)value)) throw new Exception("the monitor refused it");
        if (live) { System.Threading.Thread.Sleep(50); return (object)new Dictionary<string, object> { { "ok", true }, { "cur", (uint)value }, { "live", true } }; }
        System.Threading.Thread.Sleep(code == 0x14 ? 800 : 120);   // a color preset takes the monitor a moment to switch
        uint cur = 0, max = 0; bool ok = false;
        for (int t = 0; t < 4 && !ok; t++) { ok = GetVCPFeatureAndVCPFeatureReply(h, (byte)code, IntPtr.Zero, out cur, out max); if (!ok) System.Threading.Thread.Sleep(150); }
        return (object)new Dictionary<string, object> { { "ok", ok }, { "cur", cur }, { "max", max } };
      });
    }
    throw new Exception("monitor not found");
  }
}
