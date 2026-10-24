// Display modes and graphics-card sensors (24 Oct 2026, docs/handoff/display-health.md). Loaded by PowerShell with
// Add-Type (helpers/display.ps1, helpers/pc-sensors.ps1), never by the device helper (it is not in helper-sources.js).
// Windows' own APIs only, nothing installed:
// - EnumDisplayDevices / EnumDisplaySettingsEx / ChangeDisplaySettingsEx (user32): each screen's modes, its current mode,
//   which one is main; a change is tested first (CDS_TEST) and applied for this session only until it is kept.
// - QueryDisplayConfig / DisplayConfigGetDeviceInfo / DisplayConfigSetDeviceInfo (user32): the monitor's name and HDR
//   (Windows calls it advanced color).
// - D3DKMTEnumAdapters2 / D3DKMTQueryAdapterInfo (gdi32, KMTQAITYPE_ADAPTERPERFDATA): the graphics card's temperature
//   and fan speed as Task Manager reads them, for any maker whose driver reports them (WDDM 2.4 and later). Read only.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class DhDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY; public int dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, uint i, ref DISPLAY_DEVICE dd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettingsEx(string dev, int mode, ref DEVMODE dm, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string dev, IntPtr dm, IntPtr hwnd, uint flags, IntPtr param);

  const int ENUM_CURRENT_SETTINGS = -1;
  const int DM_POSITION = 0x20, DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
  const uint CDS_UPDATEREGISTRY = 0x1, CDS_TEST = 0x2, CDS_SET_PRIMARY = 0x10, CDS_NORESET = 0x10000000;
  const int ATTACHED = 0x1, PRIMARY = 0x4;

  // ---- DisplayConfig ----
  [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct PATH_SOURCE { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] struct RATIONAL { public uint n, d; }
  [StructLayout(LayoutKind.Sequential)] struct PATH_TARGET { public LUID adapterId; public uint id; public uint modeInfoIdx; public int outputTechnology; public int rotation; public int scaling; public RATIONAL refreshRate; public int scanLineOrdering; public int targetAvailable; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] struct PATH_INFO { public PATH_SOURCE source; public PATH_TARGET target; public uint flags; }
  [StructLayout(LayoutKind.Sequential)] struct MODE_INFO { public int infoType; public uint id; public LUID adapterId; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 48)] public byte[] data; }
  [StructLayout(LayoutKind.Sequential)] struct HEADER { public int type; public int size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SOURCE_NAME { public HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string viewGdiDeviceName; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct TARGET_NAME { public HEADER header; public uint flags; public int outputTechnology; public ushort edidManufactureId, edidProductCodeId; public uint connectorInstance; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath; }
  [StructLayout(LayoutKind.Sequential)] struct COLOR_INFO { public HEADER header; public uint value; public int colorEncoding; public int bitsPerColorChannel; }
  [StructLayout(LayoutKind.Sequential)] struct COLOR_STATE { public HEADER header; public uint value; }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint np, [Out] PATH_INFO[] p, ref uint nm, [Out] MODE_INFO[] m, IntPtr topology);
  [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] static extern int GetSourceName(ref SOURCE_NAME r);
  [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] static extern int GetTargetName(ref TARGET_NAME r);
  [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] static extern int GetColorInfo(ref COLOR_INFO r);
  [DllImport("user32.dll", EntryPoint = "DisplayConfigSetDeviceInfo")] static extern int SetColorState(ref COLOR_STATE r);
  const uint QDC_ONLY_ACTIVE_PATHS = 2;

  class Path { public string gdi, friendly, devicePath; public LUID adapter; public uint targetId; public bool hdrSupported, hdrOn, hdrForceDisabled; public int bits; }

  static List<Path> Paths() {
    var r = new List<Path>();
    uint np, nm;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out np, out nm) != 0) return r;
    var p = new PATH_INFO[np]; var m = new MODE_INFO[nm];
    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref np, p, ref nm, m, IntPtr.Zero) != 0) return r;
    for (int i = 0; i < np; i++) {
      var x = new Path { adapter = p[i].target.adapterId, targetId = p[i].target.id };
      var s = new SOURCE_NAME(); s.header.type = 1; s.header.size = Marshal.SizeOf(typeof(SOURCE_NAME)); s.header.adapterId = p[i].source.adapterId; s.header.id = p[i].source.id;
      if (GetSourceName(ref s) == 0) x.gdi = s.viewGdiDeviceName;
      var t = new TARGET_NAME(); t.header.type = 2; t.header.size = Marshal.SizeOf(typeof(TARGET_NAME)); t.header.adapterId = x.adapter; t.header.id = x.targetId;
      if (GetTargetName(ref t) == 0) { x.friendly = t.monitorFriendlyDeviceName; x.devicePath = t.monitorDevicePath; }
      var c = new COLOR_INFO(); c.header.type = 9; c.header.size = Marshal.SizeOf(typeof(COLOR_INFO)); c.header.adapterId = x.adapter; c.header.id = x.targetId;
      // value bits: 0 supported, 1 enabled, 2 wide color enforced, 3 force disabled
      if (GetColorInfo(ref c) == 0) { x.hdrSupported = (c.value & 1) != 0; x.hdrOn = (c.value & 2) != 0; x.hdrForceDisabled = (c.value & 8) != 0; x.bits = c.bitsPerColorChannel; }
      r.Add(x);
    }
    return r;
  }

  // the monitor's id as helpers/monitors.cs makes it (model#instance from \\?\DISPLAY#AOC3270#5&...#{guid})
  static string MonitorId(string devicePath) {
    var m = Regex.Match(devicePath ?? "", @"DISPLAY#([^#]+)#([^#]+)");
    return m.Success ? m.Groups[1].Value + "#" + m.Groups[2].Value : null;
  }

  static DEVMODE NewMode() { var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return dm; }

  // op read: every screen on the desktop with its current mode, its modes (32-bit color), main or not, and HDR
  public static object Read() {
    var paths = Paths();
    var list = new List<object>();
    for (uint i = 0; ; i++) {
      var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
      if ((dd.StateFlags & ATTACHED) == 0) continue;
      var cur = NewMode();
      if (!EnumDisplaySettingsEx(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref cur, 0)) continue;
      var modes = new List<object>(); var seen = new HashSet<string>();
      for (int k = 0; ; k++) {
        var dm = NewMode();
        if (!EnumDisplaySettingsEx(dd.DeviceName, k, ref dm, 0)) break;
        if (dm.dmBitsPerPel != 32 || dm.dmDisplayFrequency <= 1) continue;
        var key = dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency;
        if (seen.Add(key)) modes.Add(new int[] { dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency });
      }
      var mon = new DISPLAY_DEVICE(); mon.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      string monPath = EnumDisplayDevices(dd.DeviceName, 0, ref mon, 1) ? mon.DeviceID : null;
      Path path = null; foreach (var x in paths) if (x.gdi == dd.DeviceName) { path = x; break; }
      list.Add(new Dictionary<string, object> {
        { "screen", dd.DeviceName }, { "adapter", dd.DeviceString }, { "id", MonitorId(path != null ? path.devicePath : monPath) ?? MonitorId(monPath) },
        { "name", path != null && !string.IsNullOrEmpty(path.friendly) ? path.friendly : (mon.DeviceString ?? "Screen") },
        { "primary", (dd.StateFlags & PRIMARY) != 0 },
        { "width", cur.dmPelsWidth }, { "height", cur.dmPelsHeight }, { "hz", cur.dmDisplayFrequency }, { "x", cur.dmPositionX }, { "y", cur.dmPositionY },
        { "modes", modes },
        { "hdr", path == null ? null : new Dictionary<string, object> { { "supported", path.hdrSupported }, { "on", path.hdrOn }, { "forceDisabled", path.hdrForceDisabled }, { "bits", path.bits } } },
      });
    }
    return list;
  }

  static string Why(int code) {
    switch (code) {
      case 0: return null;
      case 1: return "Windows needs a restart for this mode";
      case -1: return "the graphics driver refused this mode";
      case -2: return "this screen does not offer that mode";
      case -3: return "Windows could not save the setting";
      case -4: return "Windows refused the request";
      case -5: return "Windows refused the request";
      case -6: return "Windows refused the request";
      default: return "Windows answered " + code;
    }
  }

  // op mode: one screen's resolution and refresh rate. Tested first (CDS_TEST); persist false = for this session only
  // (a restart brings back the saved mode), true = saved, as Windows does when Keep is pressed
  public static object SetMode(string screen, int width, int height, int hz, bool persist) {
    var dm = NewMode();
    if (!EnumDisplaySettingsEx(screen, ENUM_CURRENT_SETTINGS, ref dm, 0)) throw new Exception("that screen is not there now");
    dm.dmPelsWidth = width; dm.dmPelsHeight = height; dm.dmDisplayFrequency = hz;
    dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    var why = Why(ChangeDisplaySettingsEx(screen, ref dm, IntPtr.Zero, CDS_TEST, IntPtr.Zero));
    if (why != null) throw new Exception("not changed: " + why);
    why = Why(ChangeDisplaySettingsEx(screen, ref dm, IntPtr.Zero, persist ? CDS_UPDATEREGISTRY : 0, IntPtr.Zero));
    if (why != null) throw new Exception("not changed: " + why);
    return true;
  }

  // op primary: make one screen the main one. Windows wants the main screen at 0,0, so every screen moves by the same
  // amount (their places relative to each other stay as they are), all saved together, then applied at once
  public static object SetPrimary(string screen) {
    var all = new List<KeyValuePair<string, DEVMODE>>(); DEVMODE target = NewMode(); bool found = false;
    for (uint i = 0; ; i++) {
      var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
      if ((dd.StateFlags & ATTACHED) == 0) continue;
      var dm = NewMode();
      if (!EnumDisplaySettingsEx(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm, 0)) continue;
      all.Add(new KeyValuePair<string, DEVMODE>(dd.DeviceName, dm));
      if (dd.DeviceName == screen) { target = dm; found = true; }
    }
    if (!found) throw new Exception("that screen is not there now");
    int dx = target.dmPositionX, dy = target.dmPositionY;
    foreach (var kv in all) {
      var dm = kv.Value; dm.dmPositionX -= dx; dm.dmPositionY -= dy; dm.dmFields = DM_POSITION;
      uint flags = CDS_UPDATEREGISTRY | CDS_NORESET | (kv.Key == screen ? CDS_SET_PRIMARY : 0);
      var why = Why(ChangeDisplaySettingsEx(kv.Key, ref dm, IntPtr.Zero, flags, IntPtr.Zero));
      if (why != null) throw new Exception("not changed: " + why);
    }
    var done = Why(ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero));
    if (done != null) throw new Exception("not changed: " + done);
    return true;
  }

  // op hdr: HDR on or off for one screen (Windows' own advanced color switch)
  public static object SetHdr(string screen, bool on) {
    foreach (var p in Paths()) {
      if (p.gdi != screen) continue;
      if (!p.hdrSupported) throw new Exception("this screen does not offer HDR");
      var s = new COLOR_STATE(); s.header.type = 10; s.header.size = Marshal.SizeOf(typeof(COLOR_STATE)); s.header.adapterId = p.adapter; s.header.id = p.targetId; s.value = on ? 1u : 0u;
      var r = SetColorState(ref s);
      if (r != 0) throw new Exception("Windows refused HDR (" + r + ")");
      return true;
    }
    throw new Exception("that screen is not there now");
  }
}

public static class DhGpuSensors {
  [StructLayout(LayoutKind.Sequential)] struct ADAPTERINFO { public uint hAdapter; public uint luidLow; public int luidHigh; public uint numSources; public int precise; }
  [StructLayout(LayoutKind.Sequential)] struct ENUMADAPTERS2 { public uint count; public IntPtr adapters; }
  [StructLayout(LayoutKind.Sequential)] struct QUERY { public uint hAdapter; public int type; public IntPtr data; public uint size; }
  [StructLayout(LayoutKind.Sequential)] struct CLOSE { public uint hAdapter; }
  [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref ENUMADAPTERS2 e);
  [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref QUERY q);
  [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref CLOSE c);
  const int KMTQAITYPE_ADAPTERREGISTRYINFO = 8, KMTQAITYPE_ADAPTERPERFDATA = 62;

  static int Query(uint h, int type, IntPtr buf, int size) { var q = new QUERY { hAdapter = h, type = type, data = buf, size = (uint)size }; return D3DKMTQueryAdapterInfo(ref q); }

  // op read: each graphics adapter whose driver reports a temperature or fan speed (others are left out)
  public static object Read() {
    var r = new List<object>();
    var e = new ENUMADAPTERS2();
    if (D3DKMTEnumAdapters2(ref e) != 0 || e.count == 0) return r;
    int sz = Marshal.SizeOf(typeof(ADAPTERINFO));
    e.adapters = Marshal.AllocHGlobal(sz * (int)e.count);
    try {
      if (D3DKMTEnumAdapters2(ref e) != 0) return r;
      for (int i = 0; i < e.count; i++) {
        var a = (ADAPTERINFO)Marshal.PtrToStructure(new IntPtr(e.adapters.ToInt64() + i * sz), typeof(ADAPTERINFO));
        IntPtr name = Marshal.AllocHGlobal(4 * 520), perf = Marshal.AllocHGlobal(64);
        try {
          for (int b = 0; b < 64; b++) Marshal.WriteByte(perf, b, 0);
          string n = Query(a.hAdapter, KMTQAITYPE_ADAPTERREGISTRYINFO, name, 4 * 520) == 0 ? Marshal.PtrToStringUni(name) : null;
          if (Query(a.hAdapter, KMTQAITYPE_ADAPTERPERFDATA, perf, 64) != 0) continue;
          // D3DKMT_ADAPTER_PERFDATA: FanRPM at 48, Power (tenths of a percent) at 52, Temperature (tenths of a degree C) at 56
          uint rpm = (uint)Marshal.ReadInt32(perf, 48), temp = (uint)Marshal.ReadInt32(perf, 56);
          if (rpm == 0 && temp == 0) continue;
          r.Add(new Dictionary<string, object> { { "name", n }, { "tempC", temp > 0 ? Math.Round(temp / 10.0, 1) : (object)null }, { "fanRpm", rpm > 0 ? (object)rpm : null } });
        } finally { Marshal.FreeHGlobal(name); Marshal.FreeHGlobal(perf); var c = new CLOSE { hAdapter = a.hAdapter }; D3DKMTCloseAdapter(ref c); }
      }
    } finally { Marshal.FreeHGlobal(e.adapters); }
    return r;
  }
}
