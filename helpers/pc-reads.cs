// Read-only PC facts for the native helper (26 Oct 2026, docs/handoff/helper-reads.md): the reads that each started a
// PowerShell (~0.5-1.5 s of CPU, and an Add-Type compile for the display and sensor reads), done here in the helper
// that already runs. Each op answers with the SAME JSON its PowerShell printed, so the callers parse both alike and
// keep the PowerShell as the fallback when the helper is missing, older, or fails (helpers/helper-reads.js).
// Nothing here writes anything or opens any device: Windows' configuration manager (cfgmgr32: the device list and
// its properties, the list Get-PnpDevice shows), WMI (System.Management), the registry, and the display / graphics
// reads of helpers/pc-native.cs.
//   bluetooth     helpers/pc-map.js BT        [{ name, le, connected, battery }]
//   pc-map        helpers/pc-map.js PS        { cpu, gpus, board, ram, usb, lampArrays, smbus }
//   display-read  helpers/display.ps1 read    { screens, nightLight }
//   sensors       helpers/pc-sensors.ps1      { gpus, zones, cpu, errors }
//   installed     helpers/installers.mjs      [{ name, version }] from Windows' Apps list (the Uninstall keys)
//   eqapo         helpers/eqapo-devices.js    [{ flow, guid, state, on, name }] for the asked sound devices
//   std-battery-bt helpers/std-battery.ps1 -Mode bt   { bt: [...], hid: null }: Bluetooth battery levels
//   procs         tasklist /fo csv            every running program's image name (helpers/diagnose.mjs)
//   pawnio        helpers/board-lights.mjs    { app, version, service }: PawnIO's Apps entry and its driver service
//   running       tasklist /FI IMAGENAME      { iCUE: true } for the asked program names (helpers/hs80-direct.js)
//   pc-check      helpers/pc-check.ps1        the PC check facts (PcCheck below; nvidia-smi and netsh still run as programs)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32;

public static class PcReads {
  // ---- the device list (cfgmgr32), as Get-PnpDevice gives it: every device Windows knows, present or not ----
  [StructLayout(LayoutKind.Sequential)] struct DEVPROPKEY { public Guid fmtid; public uint pid; public DEVPROPKEY(string g, uint p) { fmtid = new Guid(g); pid = p; } }
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_ID_List_SizeW(out uint len, string filter, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_Device_ID_ListW(string filter, char[] buf, uint len, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Locate_DevNodeW(out uint inst, string id, uint flags);
  [DllImport("cfgmgr32.dll")] static extern int CM_Get_DevNode_Status(out uint status, out uint problem, uint inst, uint flags);
  [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)] static extern int CM_Get_DevNode_PropertyW(uint inst, ref DEVPROPKEY key, out uint type, byte[] buf, ref uint size, uint flags);
  const uint CM_LOCATE_DEVNODE_PHANTOM = 1, DN_HAS_PROBLEM = 0x400, DN_NEED_RESTART = 0x01000000, CM_PROB_PHANTOM = 45;
  const string DEVPKEY_DEVICE = "a45c254e-df1c-4efd-8020-67d146a850e0";
  static DEVPROPKEY K_DESC = new DEVPROPKEY(DEVPKEY_DEVICE, 2), K_HWIDS = new DEVPROPKEY(DEVPKEY_DEVICE, 3), K_CLASS = new DEVPROPKEY(DEVPKEY_DEVICE, 9), K_FRIENDLY = new DEVPROPKEY(DEVPKEY_DEVICE, 14);
  static DEVPROPKEY K_BATTERY = new DEVPROPKEY("104EA319-6EE2-4701-BD47-8DDBF425BBE5", 2), K_CONNECTED = new DEVPROPKEY("83DA6326-97A6-4088-9453-A1923F573B29", 15);

  public class Dev {
    public string Id, Name; public bool Present; public uint Problem; public string Status; public uint Inst;
    string[] hw; bool hwRead;
    public string[] HardwareIds { get { if (!hwRead) { hwRead = true; hw = Prop(Inst, K_HWIDS) as string[] ?? new string[0]; } return hw; } }
    public string Class { get { return Prop(Inst, K_CLASS) as string; } }
  }

  // one property: a string, a string list, a bool, a byte or a number (null when the device has none)
  static object Prop(uint inst, DEVPROPKEY key) {
    uint type, size = 0;
    var k = key;
    CM_Get_DevNode_PropertyW(inst, ref k, out type, null, ref size, 0);
    if (size == 0) return null;
    var buf = new byte[size];
    if (CM_Get_DevNode_PropertyW(inst, ref k, out type, buf, ref size, 0) != 0) return null;
    switch (type) {
      case 0x12: return System.Text.Encoding.Unicode.GetString(buf, 0, (int)size).TrimEnd('\0');                       // STRING
      case 0x2012: return System.Text.Encoding.Unicode.GetString(buf, 0, (int)size).Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries); // STRING_LIST
      case 0x11: return buf[0] != 0;                                                                                     // BOOLEAN
      case 0x03: return (int)buf[0];                                                                                     // BYTE
      case 0x02: return (int)(sbyte)buf[0];                                                                              // SBYTE
      case 0x05: return (int)BitConverter.ToUInt16(buf, 0);
      case 0x07: return (long)BitConverter.ToUInt32(buf, 0);
      case 0x06: return BitConverter.ToInt32(buf, 0);
      default: return null;
    }
  }

  // Status as Win32_PnPEntity names it: Unknown (not present), Error (a problem code), Degraded (waits for a restart), OK
  public static List<Dev> Devices(bool presentOnly) {
    var r = new List<Dev>();
    uint len;
    if (CM_Get_Device_ID_List_SizeW(out len, null, 0) != 0 || len == 0) return r;
    var buf = new char[len];
    if (CM_Get_Device_ID_ListW(null, buf, len, 0) != 0) return r;
    foreach (var id in new string(buf).Split(new[] { '\0' }, StringSplitOptions.RemoveEmptyEntries)) {
      uint inst;
      if (CM_Locate_DevNodeW(out inst, id, CM_LOCATE_DEVNODE_PHANTOM) != 0) continue;
      uint st, prob;
      bool present = CM_Get_DevNode_Status(out st, out prob, inst, 0) == 0;
      if (presentOnly && !present) continue;
      if (!present) prob = CM_PROB_PHANTOM;
      else if ((st & DN_HAS_PROBLEM) == 0) prob = 0;
      // the id in capitals, as Get-PnpDevice (Win32_PnPEntity) gives it; the list keeps the registry's own case
      var d = new Dev { Id = id.ToUpperInvariant(), Inst = inst, Present = present, Problem = prob };
      d.Status = !present ? "Unknown" : prob != 0 ? "Error" : (st & DN_NEED_RESTART) != 0 ? "Degraded" : "OK";
      d.Name = Prop(inst, K_FRIENDLY) as string ?? Prop(inst, K_DESC) as string;
      r.Add(d);
    }
    return r;
  }

  internal static bool M(string s, string re) { return s != null && Regex.IsMatch(s, re, RegexOptions.IgnoreCase); }

  // ---- helpers/pc-map.js BT: paired Bluetooth devices, connected or not, and the battery Windows last read ----
  public static object Bluetooth() {
    var all = Devices(false);
    var top = all.Where(d => M(d.Id, @"^(BTHENUM|BTHLE)\\DEV_[0-9A-F]{12}")).ToList();
    var hid = all.Where(d => d.Status == "OK" && M(d.Id, @"^HID\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}")).ToList();
    var bats = new List<KeyValuePair<string, int>>(); var batOf = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    foreach (var d in all) {
      if (!(M(d.Id, @"^(BTHENUM|BTHLE|BTHLEDEVICE)\\") || (d.Status == "OK" && M(d.Id, @"^HID\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}")))) continue;
      var b = Prop(d.Inst, K_BATTERY);
      if (b != null) { int v = Convert.ToInt32(b); bats.Add(new KeyValuePair<string, int>(d.Id, v)); batOf[d.Id] = v; }
    }
    var outList = new List<object>();
    foreach (var d in top) {
      var mac = Regex.Match(d.Id, "DEV_([0-9A-F]{12})", RegexOptions.IgnoreCase).Groups[1].Value;
      object bat = null;
      foreach (var kv in bats) if (Regex.IsMatch(kv.Key, mac, RegexOptions.IgnoreCase)) { bat = kv.Value; break; }
      var c = Prop(d.Inst, K_CONNECTED);
      outList.Add(new Dictionary<string, object> { { "name", d.Name }, { "le", M(d.Id, "^BTHLE") }, { "connected", c is bool && (bool)c }, { "battery", bat } });
    }
    var seenUsb = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var h in hid) {
      int v;
      if (!batOf.TryGetValue(h.Id, out v) || string.IsNullOrEmpty(h.Name)) continue;
      var vp = Regex.Match(h.Id, "VID_[0-9A-F]{4}&PID_[0-9A-F]{4}", RegexOptions.IgnoreCase).Value;
      if (vp != "" && seenUsb.Add(vp)) outList.Add(new Dictionary<string, object> { { "name", h.Name }, { "le", false }, { "connected", true }, { "battery", v } });
    }
    return outList;
  }

  // ---- helpers/std-battery.ps1 -Mode bt: every paired Bluetooth device node's battery level, connected flag, ids and
  // last connection, read from Windows' device properties (the -Mode hid part opens HID collections, so it stays there) ----
  static DEVPROPKEY K_LASTCONNECTED = new DEVPROPKEY("2BD67D8B-8BEB-48D5-87E0-6CDA3428040A", 11);
  static object FileTimeProp(uint inst, DEVPROPKEY key) {
    uint type, size = 8; var buf = new byte[8]; var k = key;
    if (CM_Get_DevNode_PropertyW(inst, ref k, out type, buf, ref size, 0) != 0 || type != 0x10) return null;   // DEVPROP_TYPE_FILETIME
    long ft = BitConverter.ToInt64(buf, 0);
    // to the microsecond, as Get-PnpDeviceProperty gives it (a CIM date has no finer part)
    return ft <= 0 ? null : DateTime.FromFileTimeUtc(ft - ft % 10).ToString("o");
  }
  public static object StdBatteryBt() {
    var pnp = Devices(false);
    var all = pnp.Where(d => M(d.Id, @"^(BTHLE|BTHENUM)\\DEV_[0-9A-F]{12}")).ToList();
    var kids = pnp.Where(d => M(d.Id, @"^(BTHLEDEVICE|BTHENUM)\\\{")).ToList();
    var bt = new List<object>();
    foreach (var d in all) {
      var addr = Regex.Match(d.Id, "DEV_([0-9A-F]{12})", RegexOptions.IgnoreCase).Groups[1].Value;
      var mine = kids.Where(k => Regex.IsMatch(k.Id, addr, RegexOptions.IgnoreCase)).ToList();
      var ids = mine.Select(k => k.Id).FirstOrDefault(id => Regex.IsMatch(id, "VID&[0-9A-F]{6}", RegexOptions.IgnoreCase)) ?? "";
      object bat = Prop(d.Inst, K_BATTERY);
      if (bat == null) foreach (var k in mine) { var kb = Prop(k.Inst, K_BATTERY); if (kb != null) { bat = kb; break; } }
      var c = Prop(d.Inst, K_CONNECTED);
      bt.Add(new Dictionary<string, object> { { "instanceId", d.Id }, { "name", d.Name }, { "status", d.Status }, { "connected", c is bool ? (bool)c : d.Status == "OK" },
        { "battery", bat == null ? null : (object)Convert.ToInt32(bat) }, { "address", addr }, { "ids", ids }, { "lastConnected", FileTimeProp(d.Inst, K_LASTCONNECTED) } });
    }
    return new Dictionary<string, object> { { "bt", bt }, { "hid", null } };
  }

  // ---- WMI ----
  internal static List<ManagementObject> Wmi(string query, string scope = @"root\cimv2") {
    // a WMI read that hangs gives up after 15 s (the caller then reads with PowerShell), never holding the channel
    using (var s = new ManagementObjectSearcher(new ManagementScope(scope), new ObjectQuery(query), new EnumerationOptions { Timeout = TimeSpan.FromSeconds(15) })) return s.Get().Cast<ManagementObject>().ToList();
  }
  internal static string Str(object o) { return o == null ? null : Convert.ToString(o, System.Globalization.CultureInfo.InvariantCulture); }

  // ---- helpers/pc-map.js PS: what is inside the PC and what is plugged in ----
  public static object PcMap() {
    var o = new Dictionary<string, object>();
    try { var p = Wmi("SELECT Name FROM Win32_Processor").FirstOrDefault(); o["cpu"] = p == null ? null : Str(p["Name"]).Trim(); } catch { o["cpu"] = null; }
    try {
      o["gpus"] = Wmi("SELECT Name, PNPDeviceID FROM Win32_VideoController").Where(g => M(Str(g["PNPDeviceID"]), "^PCI"))
        .Select(g => (object)new Dictionary<string, object> { { "name", Str(g["Name"]) }, { "pnp", Str(g["PNPDeviceID"]) } }).ToList();
    } catch { o["gpus"] = new List<object>(); }
    try { var b = Wmi("SELECT Manufacturer, Product FROM Win32_BaseBoard").FirstOrDefault(); o["board"] = new Dictionary<string, object> { { "maker", b == null ? null : Str(b["Manufacturer"]) }, { "model", b == null ? null : Str(b["Product"]) } }; } catch { o["board"] = new Dictionary<string, object> { { "maker", null }, { "model", null } }; }
    try {
      o["ram"] = Wmi("SELECT PartNumber, Capacity, DeviceLocator, BankLabel FROM Win32_PhysicalMemory").Select(m => (object)new Dictionary<string, object> {
        { "part", (Str(m["PartNumber"]) ?? "").Trim() }, { "gb", Math.Round(Convert.ToDouble(m["Capacity"] ?? 0) / 1073741824.0) }, { "slot", Str(m["DeviceLocator"]) }, { "bank", Str(m["BankLabel"]) } }).ToList();
    } catch { o["ram"] = new List<object>(); }
    var present = Devices(true);
    var usb = new List<object>();
    foreach (var d in present) {
      var m = Regex.Match(d.Id, @"^(USB|HID)\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", RegexOptions.IgnoreCase);
      if (!m.Success) continue;
      var hw = d.HardwareIds;
      var pages = new List<object>();
      foreach (var h in hw) { var pm = Regex.Match(h, "UP:(FF[0-9A-F]{2})_U:([0-9A-F]{4})", RegexOptions.IgnoreCase); if (pm.Success) pages.Add(pm.Groups[1].Value + ":" + pm.Groups[2].Value); }
      usb.Add(new Dictionary<string, object> { { "vid", m.Groups[2].Value.ToLowerInvariant() }, { "pid", m.Groups[3].Value.ToLowerInvariant() }, { "name", d.Name },
        { "kb", hw.Any(h => M(h, "UP:0001_U:0006")) }, { "mouse", hw.Any(h => M(h, "UP:0001_U:0002")) }, { "onUsb", M(d.Id, @"^USB\\") }, { "pages", pages } });
    }
    o["usb"] = usb;
    o["lampArrays"] = present.Count(d => M(d.Id, @"^HID\\") && d.HardwareIds.Any(h => M(h, "UP:0059")));
    o["smbus"] = present.Where(d => M(d.Name, "SMBus")).Select(d => (object)d.Name).ToList();
    return o;
  }

  // ---- helpers/display.ps1 read: every screen (helpers/pc-native.cs) and Night light's state blob, read only ----
  const string NIGHT_LIGHT = @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";
  public static object DisplayRead() {
    string nl = null;
    try { using (var k = Registry.CurrentUser.OpenSubKey(NIGHT_LIGHT)) { var b = k == null ? null : k.GetValue("Data") as byte[]; if (b != null) nl = string.Join(" ", b.Select(x => x.ToString("X2"))); } } catch { }
    return new Dictionary<string, object> { { "screens", DhDisplay.Read() }, { "nightLight", nl } };
  }

  // ---- helpers/pc-sensors.ps1: graphics cards (D3DKMT), the ACPI thermal zones, the CPU's load and clock ----
  // the same counters Win32_PerfFormattedData_* formats, read straight from Windows' performance counters (kept open:
  // a WMI query of the formatted classes took ~0.27 s each, every 5 s while the PC page is open); WMI when they fail
  static System.Diagnostics.PerformanceCounter cUtil, cPerf; static bool cpuCounters = true;
  static List<KeyValuePair<string, System.Diagnostics.PerformanceCounter[]>> zoneCounters; static bool zoneCountersOk = true;
  static double[] CpuCounters() {
    if (!cpuCounters) return null;
    try {
      if (cUtil == null) { cUtil = new System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Utility", "_Total", true); cPerf = new System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Performance", "_Total", true);
        cUtil.NextValue(); cPerf.NextValue(); System.Threading.Thread.Sleep(250); }   // a rate needs two samples: the first reading only
      return new double[] { cUtil.NextValue(), cPerf.NextValue() };
    } catch { cpuCounters = false; return null; }
  }
  static List<object> ZoneCounters() {
    if (!zoneCountersOk) return null;
    try {
      if (zoneCounters == null) {
        zoneCounters = new List<KeyValuePair<string, System.Diagnostics.PerformanceCounter[]>>();
        foreach (var n in new System.Diagnostics.PerformanceCounterCategory("Thermal Zone Information").GetInstanceNames())
          zoneCounters.Add(new KeyValuePair<string, System.Diagnostics.PerformanceCounter[]>(n, new[] { new System.Diagnostics.PerformanceCounter("Thermal Zone Information", "High Precision Temperature", n, true), new System.Diagnostics.PerformanceCounter("Thermal Zone Information", "Temperature", n, true) }));
      }
      return zoneCounters.Select(z => (object)new Dictionary<string, object> { { "name", z.Key }, { "tenthsK", (int)Math.Round(z.Value[0].NextValue()) }, { "kelvin", (int)Math.Round(z.Value[1].NextValue()) } }).ToList();
    } catch { zoneCountersOk = false; return null; }
  }

  static bool cpuKnown; static string cpuName; static int baseMHz;
  public static object Sensors() {
    var errors = new List<object>();
    if (!cpuKnown) {
      cpuKnown = true;
      try { var p = Wmi("SELECT Name, MaxClockSpeed FROM Win32_Processor").FirstOrDefault(); if (p != null) { cpuName = (Str(p["Name"]) ?? "").Trim(); baseMHz = Convert.ToInt32(p["MaxClockSpeed"] ?? 0); } } catch { }
    }
    object cpu;
    try {
      double util, perf; var pc = CpuCounters();
      if (pc != null) { util = pc[0]; perf = pc[1]; }
      else {
        var pi = Wmi("SELECT PercentProcessorUtility, PercentProcessorPerformance FROM Win32_PerfFormattedData_Counters_ProcessorInformation WHERE Name='_Total'").FirstOrDefault();
        if (pi == null) throw new Exception("no processor counters");
        util = Convert.ToDouble(pi["PercentProcessorUtility"] ?? 0); perf = Convert.ToDouble(pi["PercentProcessorPerformance"] ?? 0);
      }
      object mhz = null; if (baseMHz != 0 && perf != 0) mhz = (int)Math.Round(baseMHz * perf / 100);
      int load = (int)Math.Round(util); if (load > 100) load = 100;
      cpu = new Dictionary<string, object> { { "name", cpuName }, { "loadPct", load }, { "clockMHz", mhz } };
    } catch (Exception e) { cpu = new Dictionary<string, object> { { "name", cpuName }, { "loadPct", null }, { "clockMHz", null } }; errors.Add("cpu: " + e.Message); }
    object gpus = new List<object>();
    try { gpus = DhGpuSensors.Read(); } catch (Exception e) { errors.Add("gpu: " + e.Message); }
    var zones = ZoneCounters() ?? new List<object>();
    if (zoneCounters == null || !zoneCountersOk) try {
      zones = new List<object>();
      foreach (var z in Wmi("SELECT Name, HighPrecisionTemperature, Temperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation"))
        zones.Add(new Dictionary<string, object> { { "name", Str(z["Name"]) }, { "tenthsK", Convert.ToInt32(z["HighPrecisionTemperature"] ?? 0) }, { "kelvin", Convert.ToInt32(z["Temperature"] ?? 0) } });
    } catch (Exception e) { errors.Add("zones: " + e.Message); }
    return new Dictionary<string, object> { { "gpus", gpus }, { "zones", zones }, { "cpu", cpu }, { "errors", errors } };
  }

  // ---- helpers/installers.mjs installedApps: Windows' Apps list (the Uninstall keys), names and versions ----
  public static object Installed() {
    var r = new List<object>();
    var roots = new[] { new { h = Registry.LocalMachine, p = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" }, new { h = Registry.LocalMachine, p = @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" }, new { h = Registry.CurrentUser, p = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" } };
    foreach (var root in roots) {
      try {
        using (var k = root.h.OpenSubKey(root.p)) {
          if (k == null) continue;
          foreach (var n in k.GetSubKeyNames()) {
            try {
              using (var s = k.OpenSubKey(n)) {
                if (s == null) continue;
                var name = Str(s.GetValue("DisplayName"));
                if (string.IsNullOrEmpty(name)) continue;
                var ver = Str(s.GetValue("DisplayVersion"));
                r.Add(new Dictionary<string, object> { { "name", name }, { "version", string.IsNullOrEmpty(ver) ? null : ver } });
              }
            } catch { }
          }
        }
      } catch { }
    }
    return r;
  }

  // ---- helpers/eqapo-devices.js: is Equalizer APO's audio effect on each asked sound device (Windows' MMDevices) ----
  const string APO_CLSID = "EACD2258-FCAC-4FF4-B36D-419E924A6D79";
  public static object EqApo(System.Collections.IList list) {
    var r = new List<object>();
    foreach (var item in list) {
      var a = item as System.Collections.IList; if (a == null || a.Count < 2) continue;
      var flow = a[0] as string; var guid = a[1] as string;
      if (flow == null || guid == null) continue;
      if ((flow != "Render" && flow != "Capture") || !Regex.IsMatch(guid, "^\\{[0-9a-f-]{36}\\}$", RegexOptions.IgnoreCase)) continue;
      string state = "", name = null; bool on = false;
      try {
        using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\" + flow + @"\" + guid)) {
          if (k != null) {
            state = Str(k.GetValue("DeviceState")) ?? "";
            try { using (var fx = k.OpenSubKey("FxProperties")) if (fx != null) on = fx.GetValueNames().Any(v => { var x = fx.GetValue(v) as string; var xs = fx.GetValue(v) as string[]; return (x != null && x.IndexOf(APO_CLSID, StringComparison.OrdinalIgnoreCase) >= 0) || (xs != null && string.Join(" ", xs).IndexOf(APO_CLSID, StringComparison.OrdinalIgnoreCase) >= 0); }); } catch { }
            try { using (var p = k.OpenSubKey("Properties")) if (p != null) name = Str(p.GetValue("{a45c254e-df1c-4efd-8020-67d146a850e0},2")); } catch { }
          }
        }
      } catch { }
      r.Add(new Dictionary<string, object> { { "flow", flow }, { "guid", guid }, { "state", state }, { "on", on }, { "name", name } });
    }
    return r;
  }

  // ---- is a program running (tasklist /FI "IMAGENAME eq <name>.exe"): { <name>: true | false }, names without .exe ----
  public static object Running(System.Collections.IList names) {
    var r = new Dictionary<string, object>();
    foreach (var x in names) {
      var n = x as string; if (string.IsNullOrEmpty(n) || n.Length > 64) continue;
      var ps = System.Diagnostics.Process.GetProcessesByName(n);
      r[n] = ps.Length > 0;
      foreach (var p in ps) p.Dispose();
    }
    return r;
  }

  // ---- every running program's image name, the way tasklist lists them (name.exe), each once (helpers/diagnose.mjs) ----
  public static object Procs() {
    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    // Windows' own pseudo-processes are listed by tasklist without .exe, and process 0 as "System Idle Process"
    var bare = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "System", "Registry", "Memory Compression", "Secure System", "vmmem" };
    foreach (var p in System.Diagnostics.Process.GetProcesses()) { try { names.Add(p.Id == 0 ? "System Idle Process" : bare.Contains(p.ProcessName) ? p.ProcessName : p.ProcessName + ".exe"); } catch { } finally { p.Dispose(); } }
    return names.ToList();
  }

  // ---- PawnIO (helpers/board-lights.mjs): its Windows Apps entry (HKLM Uninstall, DisplayName PawnIO) and its service ----
  public static object PawnIo() {
    bool app = false, svc = false; string ver = null;
    try {
      using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
        if (k != null) foreach (var n in k.GetSubKeyNames()) {
          try { using (var s = k.OpenSubKey(n)) { if (s != null && string.Equals(Str(s.GetValue("DisplayName")), "PawnIO", StringComparison.OrdinalIgnoreCase)) { app = true; ver = Str(s.GetValue("DisplayVersion")); break; } } } catch { }
        }
      }
    } catch { }
    // a registered service has its key under Services with an ImagePath (what Get-Service lists)
    try { using (var k = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO")) svc = k != null && k.GetValue("ImagePath") != null; } catch { }
    return new Dictionary<string, object> { { "app", app }, { "version", string.IsNullOrEmpty(ver) ? null : ver }, { "service", svc } };
  }

  // the helper's "pc" channels: { op, ... } -> { ok: true, result } or { ok: false, error }
  public static Dictionary<string, object> Op(Dictionary<string, object> q) {
    var op = (string)q["op"];
    var o = new Dictionary<string, object> { { "ok", true } };
    switch (op) {
      case "bluetooth": o["result"] = Bluetooth(); break;
      case "pc-map": o["result"] = PcMap(); break;
      case "display-read": o["result"] = DisplayRead(); break;
      case "sensors": o["result"] = Sensors(); break;
      case "installed": o["result"] = Installed(); break;
      case "pc-check": o["result"] = PcCheck.Facts(); break;
      case "std-battery-bt": o["result"] = StdBatteryBt(); break;
      case "procs": o["result"] = Procs(); break;
      case "pawnio": o["result"] = PawnIo(); break;
      case "running": o["result"] = Running(q.ContainsKey("names") ? q["names"] as System.Collections.IList ?? new object[0] : new object[0]); break;
      case "eqapo": o["result"] = EqApo(q.ContainsKey("list") ? q["list"] as System.Collections.IList ?? new object[0] : new object[0]); break;
      default: o["ok"] = false; o["error"] = "unknown pc op " + op; break;
    }
    return o;
  }
}

// ---- helpers/pc-check.ps1 in the helper: the same facts object, part by part, each part on its own (a part Windows
// refuses is named in "denied", never guessed). The parts run side by side, so the check answers sooner. Read only:
// WMI, the device list, the System event log, the registry, Windows' power plan API, and NVIDIA's nvidia-smi and
// Windows' netsh as programs (as the script ran them). Nothing is changed.
public static class PcCheck {
  static readonly object gate = new object();
  static List<object> denied, errors;
  static void Note(string part, Exception e) {
    var m = e.Message ?? "";
    lock (gate) { if (Regex.IsMatch(m, "denied|not available to the client|Unauthorized|privilege", RegexOptions.IgnoreCase)) denied.Add(part); else errors.Add(part + ": " + m); }
  }
  static void Err(string part, Exception e) { lock (gate) errors.Add(part + ": " + e.Message); }
  static List<ManagementObject> Wmi(string q, string scope = @"root\cimv2") { return PcReads.Wmi(q, scope); }
  static string Str(object o) { return PcReads.Str(o); }
  static double Dbl(object o) { return o == null ? 0 : Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture); }
  static object Raw(object o) {   // a WMI number as PowerShell gives it (null stays null)
    if (o == null) return null;
    if (o is uint || o is ushort || o is byte || o is int || o is short || o is sbyte) return Convert.ToInt64(o);
    if (o is ulong) return Convert.ToDouble(o);
    return o;
  }

  // a program's output (stderr dropped, as 2>$null), or null when it could not run or took longer than ms
  static string Run(string exe, string args, int ms = 15000) {
    try {
      var psi = new System.Diagnostics.ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = System.Text.Encoding.UTF8 };
      using (var p = System.Diagnostics.Process.Start(psi)) {
        var o = p.StandardOutput.ReadToEndAsync(); p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(ms)) { try { p.Kill(); } catch { } return null; }
        return o.Result;
      }
    } catch { return null; }
  }

  static object RegValue(RegistryKey hive, string key, string name) {
    try { using (var k = hive.OpenSubKey(key)) return k == null ? null : k.GetValue(name); } catch { return null; }
  }
  static bool KeyExists(RegistryKey hive, string key) { try { using (var k = hive.OpenSubKey(key)) return k != null; } catch { return false; } }

  static readonly Dictionary<int, string> MEDIA = new Dictionary<int, string> { { 0, "Unspecified" }, { 3, "HDD" }, { 4, "SSD" }, { 5, "SCM" } };
  static readonly string[] BUS = { "Unknown", "SCSI", "ATAPI", "ATA", "1394", "SSA", "Fibre Channel", "USB", "RAID", "iSCSI", "SAS", "SATA", "SD", "MMC", "Virtual", "File Backed Virtual", "Spaces", "NVMe", "SCM", "UFS" };
  static readonly Dictionary<int, string> HEALTH = new Dictionary<int, string> { { 0, "Healthy" }, { 1, "Warning" }, { 2, "Unhealthy" }, { 5, "Unknown" } };
  static readonly Dictionary<int, string> OPSTATUS = new Dictionary<int, string> { { 1, "Other" }, { 2, "OK" }, { 3, "Degraded" }, { 4, "Stressed" }, { 5, "Predictive Failure" }, { 6, "Error" },
    { 7, "Non-Recoverable Error" }, { 8, "Starting" }, { 9, "Stopping" }, { 10, "Stopped" }, { 11, "In Service" }, { 12, "No Contact" }, { 13, "Lost Communication" }, { 14, "Aborted" }, { 15, "Dormant" },
    { 16, "Supporting Entity in Error" }, { 17, "Completed" }, { 18, "Power Mode" }, { 19, "Relocating" }, { 53252, "Failed Media" }, { 53253, "Split" }, { 53254, "Stale Metadata" }, { 53255, "IO Error" },
    { 53256, "Unrecognized Metadata" }, { 53269, "Removing From Pool" }, { 53270, "In Maintenance Mode" }, { 53271, "Updating Firmware" }, { 53272, "Device Hardware Error" }, { 53273, "Not Usable" },
    { 53274, "Transient Error" }, { 53276, "Starting Maintenance Mode" }, { 53277, "Stopping Maintenance Mode" }, { 53285, "Threshold Exceeded" }, { 53286, "Abnormal Latency" } };
  static string Map(Dictionary<int, string> m, object v, string dflt) { if (v == null) return dflt; string s; return m.TryGetValue(Convert.ToInt32(v), out s) ? s : dflt; }

  // ---- the parts ----
  static void Hardware(Dictionary<string, object> o) {
    try { o["volumes"] = Wmi("SELECT DeviceID, VolumeName, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType=3").Select(v => (object)new Dictionary<string, object> { { "drive", Str(v["DeviceID"]) }, { "label", Str(v["VolumeName"]) }, { "size", Dbl(v["Size"]) }, { "free", Dbl(v["FreeSpace"]) } }).ToList(); } catch (Exception e) { Note("volumes", e); }
    try {
      var pd = Wmi("SELECT * FROM MSFT_PhysicalDisk", @"root\Microsoft\Windows\Storage");
      o["disks"] = pd.Select(d => {
        var st = d["OperationalStatus"] as ushort[];
        var bus = d["BusType"] == null ? "" : (Convert.ToInt32(d["BusType"]) < BUS.Length ? BUS[Convert.ToInt32(d["BusType"])] : "Unknown");
        return (object)new Dictionary<string, object> { { "id", Str(d["DeviceId"]) ?? "" }, { "name", Str(d["FriendlyName"]) }, { "media", Map(MEDIA, d["MediaType"], "Unspecified") }, { "bus", bus },
          { "health", Map(HEALTH, d["HealthStatus"], "Unknown") }, { "status", st == null ? "" : string.Join(", ", st.Where(x => OPSTATUS.ContainsKey(x)).Select(x => OPSTATUS[x])) }, { "size", Dbl(d["Size"]) } };
      }).ToList();
      try {
        var rel = new List<object>();
        // as Get-StorageReliabilityCounter asks it (PS_StorageCmdlets; it needs administrator, else "denied")
        using (var cmd = new ManagementClass(@"root\Microsoft\Windows\Storage", "PS_StorageCmdlets", null))
        foreach (var d in pd) {
          var inp = cmd.GetMethodParameters("GetStorageReliabilityCounter");
          inp["PhysicalDisk"] = d;
          var outp = cmd.InvokeMethod("GetStorageReliabilityCounter", inp, null);
          var r = outp == null ? null : outp["StorageReliabilityCounter"] as ManagementBaseObject;
          if (r != null)
            rel.Add(new Dictionary<string, object> { { "id", Str(r["DeviceId"]) ?? "" }, { "wear", Raw(r["Wear"]) }, { "tempC", Raw(r["Temperature"]) }, { "tempMaxC", Raw(r["TemperatureMax"]) }, { "hours", Raw(r["PowerOnHours"]) } });
        }
        o["reliability"] = rel;
      } catch (Exception e) { Note("reliability", e); }
    } catch (Exception e) { Note("disks", e); }
    try {
      o["video"] = Wmi("SELECT Name, AdapterCompatibility, DriverVersion, DriverDate, PNPDeviceID FROM Win32_VideoController").Select(v => {
        var dd = Str(v["DriverDate"]); object date = null;
        if (!string.IsNullOrEmpty(dd)) { try { date = System.Management.ManagementDateTimeConverter.ToDateTime(dd).ToString("yyyy-MM-dd"); } catch { } }
        return (object)new Dictionary<string, object> { { "name", Str(v["Name"]) }, { "maker", Str(v["AdapterCompatibility"]) }, { "version", Str(v["DriverVersion"]) }, { "date", date }, { "pnp", Str(v["PNPDeviceID"]) } };
      }).ToList();
    } catch (Exception e) { Note("video", e); }
    try {
      o["ram"] = Wmi("SELECT DeviceLocator, Manufacturer, PartNumber, BankLabel, Speed, ConfiguredClockSpeed, Capacity, SMBIOSMemoryType FROM Win32_PhysicalMemory").Select(m => (object)new Dictionary<string, object> {
        { "slot", Str(m["DeviceLocator"]) }, { "maker", Str(m["Manufacturer"]) }, { "part", (Str(m["PartNumber"]) ?? "").Trim() }, { "bank", Str(m["BankLabel"]) ?? "" }, { "speed", Raw(m["Speed"]) },
        { "configured", Raw(m["ConfiguredClockSpeed"]) }, { "gb", Math.Round(Dbl(m["Capacity"]) / 1073741824.0) }, { "type", Raw(m["SMBIOSMemoryType"]) } }).ToList();
    } catch (Exception e) { Note("ram", e); }
    try { var b = Wmi("SELECT Manufacturer, Product FROM Win32_BaseBoard").FirstOrDefault(); o["board"] = new Dictionary<string, object> { { "maker", b == null ? null : Str(b["Manufacturer"]) }, { "model", b == null ? null : Str(b["Product"]) } }; } catch (Exception e) { Note("board", e); }
  }

  static void Devices(Dictionary<string, object> o) {
    // present devices only, with a problem code or an Error status (as Get-PnpDevice -PresentOnly)
    try {
      o["devices"] = PcReads.Devices(true).Where(d => d.Problem != 0 || d.Status == "Error").Select(d => (object)new Dictionary<string, object> {
        { "name", d.Name }, { "cls", d.Class }, { "status", d.Status }, { "problem", (int)d.Problem }, { "id", d.Id } }).ToList();
    } catch (Exception e) { Note("devices", e); }
  }

  static List<System.Diagnostics.Eventing.Reader.EventRecord> Events(string xpath) {
    var r = new List<System.Diagnostics.Eventing.Reader.EventRecord>();
    var q = new System.Diagnostics.Eventing.Reader.EventLogQuery("System", System.Diagnostics.Eventing.Reader.PathType.LogName, xpath) { ReverseDirection = true };
    using (var rd = new System.Diagnostics.Eventing.Reader.EventLogReader(q)) { System.Diagnostics.Eventing.Reader.EventRecord e; while ((e = rd.ReadEvent()) != null) r.Add(e); }
    return r;
  }
  static string When(System.Diagnostics.Eventing.Reader.EventRecord e) { return e.TimeCreated.HasValue ? e.TimeCreated.Value.ToString("o") : null; }
  static void EventLog(Dictionary<string, object> o) {
    const string since = "TimeCreated[timediff(@SystemTime) <= 2592000000]";   // the last 30 days
    var ev = new Dictionary<string, object> { { "bugchecks", new List<object>() }, { "whea", new List<object>() } };
    try {
      ev["bugchecks"] = Events("*[System[Provider[@Name='Microsoft-Windows-WER-SystemErrorReporting'] and (EventID=1001) and " + since + "]]").Select(e => {
        string p = null; try { p = e.Properties.Count > 0 ? Str(e.Properties[0].Value) ?? "" : ""; } catch { }
        var d = new Dictionary<string, object> { { "at", When(e) }, { "param", p } }; e.Dispose(); return (object)d; }).ToList();
    } catch (Exception e) { Note("events", e); }
    try {
      ev["whea"] = Events("*[System[Provider[@Name='Microsoft-Windows-WHEA-Logger'] and (Level=1 or Level=2 or Level=3) and " + since + "]]").Select(e => {
        var d = new Dictionary<string, object> { { "at", When(e) }, { "id", e.Id }, { "level", e.Level.HasValue ? (object)(int)e.Level.Value : null } }; e.Dispose(); return (object)d; }).ToList();
    } catch (Exception e) { Note("events", e); }
    o["events"] = ev;
  }

  static object Com(string progId, Func<Type, object, object> use) {
    var t = Type.GetTypeFromProgID(progId);
    if (t == null) throw new Exception(progId + " is not registered");
    object x = Activator.CreateInstance(t);
    try { return use(t, x); } finally { try { Marshal.ReleaseComObject(x); } catch { } }
  }
  static void Restart(Dictionary<string, object> o) {
    // Windows Update's own answer (what Settings > Windows Update shows) and the servicing stack (pc-check.ps1 says why)
    bool wu;
    try { wu = Convert.ToBoolean(Com("Microsoft.Update.SystemInfo", (t, x) => t.InvokeMember("RebootRequired", System.Reflection.BindingFlags.GetProperty, null, x, null))); }
    catch { wu = KeyExists(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"); }
    o["restart"] = new Dictionary<string, object> { { "cbs", KeyExists(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") }, { "wu", wu } };
  }

  // Get-ChildItem -Recurse -Filter: this folder's files first, then each folder below in order; unreadable folders skipped
  static IEnumerable<string> Find(string dir, string pattern) {
    string[] files = new string[0], dirs = new string[0];
    try { files = System.IO.Directory.GetFiles(dir, pattern); Array.Sort(files, StringComparer.OrdinalIgnoreCase); } catch { }
    foreach (var f in files) yield return f;
    try { dirs = System.IO.Directory.GetDirectories(dir); Array.Sort(dirs, StringComparer.OrdinalIgnoreCase); } catch { }
    foreach (var d in dirs) foreach (var f in Find(d, pattern)) yield return f;
  }
  static void DriverApps(Dictionary<string, object> o) {
    var apps = new Dictionary<string, object> { { "nvidia", null }, { "amd", null } };
    try {
      var pf = Environment.GetEnvironmentVariable("ProgramFiles");
      var want = new[] {
        new[] { "nvidia", "NVIDIA App*.lnk", "NVIDIA App.exe", System.IO.Path.Combine(pf, @"NVIDIA Corporation\NVIDIA App\CEF\NVIDIA App.exe") },
        new[] { "amd", "AMD Software*.lnk", "RadeonSoftware.exe", System.IO.Path.Combine(pf, @"AMD\CNext\CNext\RadeonSoftware.exe") } };
      var menus = new[] { System.IO.Path.Combine(Environment.GetEnvironmentVariable("ProgramData"), @"Microsoft\Windows\Start Menu\Programs"), System.IO.Path.Combine(Environment.GetEnvironmentVariable("APPDATA"), @"Microsoft\Windows\Start Menu\Programs") };
      Type shT = null; object shell = null;
      try {
        foreach (var w in want) {
          string found = null;
          foreach (var m in menus) {
            if (found != null || !System.IO.Directory.Exists(m)) continue;
            foreach (var l in Find(m, w[1])) {
              if (shell == null) { shT = Type.GetTypeFromProgID("WScript.Shell"); shell = Activator.CreateInstance(shT); }
              var lnk = shT.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { l });
              var t = Str(lnk.GetType().InvokeMember("TargetPath", System.Reflection.BindingFlags.GetProperty, null, lnk, null));
              try { Marshal.ReleaseComObject(lnk); } catch { }
              if (!string.IsNullOrEmpty(t) && string.Equals(System.IO.Path.GetFileName(t), w[2], StringComparison.OrdinalIgnoreCase) && t.StartsWith(pf + "\\", StringComparison.OrdinalIgnoreCase) && System.IO.File.Exists(t)) { found = t; break; }
            }
          }
          if (found == null && System.IO.File.Exists(w[3])) found = w[3];
          apps[w[0]] = found;
        }
      } finally { if (shell != null) try { Marshal.ReleaseComObject(shell); } catch { } }
    } catch (Exception e) { Err("apps", e); }
    o["driverApps"] = apps;
  }

  static string Nv() { var p = System.IO.Path.Combine(Environment.GetEnvironmentVariable("WINDIR"), @"System32\nvidia-smi.exe"); return System.IO.File.Exists(p) ? p : null; }
  static void Nvidia(Dictionary<string, object> o, Dictionary<string, object> tune) {
    var nv = Nv();
    if (nv == null) return;
    var v = Run(nv, "--query-gpu=driver_version --format=csv,noheader");
    if (v != null) { var first = v.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None).FirstOrDefault(); if (first != null && first.Length > 0) o["nvidiaVersion"] = first.Trim(); }
    // Resizable BAR on NVIDIA: BAR1 is 256 MiB when it is off and about the card's memory when on
    var mq = Run(nv, "-q -d MEMORY");
    if (mq != null) {
      var b = Regex.Match(mq, @"BAR1 Memory Usage\s+Total\s*:\s*(\d+)\s*MiB"); var f = Regex.Match(mq, @"FB Memory Usage\s+Total\s*:\s*(\d+)\s*MiB");
      if (b.Success) lock (gate) { tune["bar1MiB"] = int.Parse(b.Groups[1].Value); tune["vramMiB"] = f.Success ? (object)int.Parse(f.Groups[1].Value) : null; }
    }
  }

  // ---- the power plan, through Windows' own power API (what powercfg prints) ----
  [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr guid);
  [DllImport("powrprof.dll")] static extern uint PowerEnumerate(IntPtr root, IntPtr scheme, IntPtr sub, uint flags, uint index, byte[] buf, ref uint size);
  [DllImport("powrprof.dll")] static extern uint PowerReadFriendlyName(IntPtr root, ref Guid scheme, IntPtr sub, IntPtr setting, byte[] buf, ref uint size);
  [DllImport("powrprof.dll")] static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  static void Power(Dictionary<string, object> tune) {
    try {
      IntPtr ap; if (PowerGetActiveScheme(IntPtr.Zero, out ap) != 0) throw new Exception("the active power plan could not be read");
      var act = (Guid)Marshal.PtrToStructure(ap, typeof(Guid)); LocalFree(ap);
      var plans = new List<object>();
      for (uint i = 0; ; i++) {
        var gb = new byte[16]; uint gs = 16;
        if (PowerEnumerate(IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 16, i, gb, ref gs) != 0) break;   // ACCESS_SCHEME
        var g = new Guid(gb); uint ns = 0;
        PowerReadFriendlyName(IntPtr.Zero, ref g, IntPtr.Zero, IntPtr.Zero, null, ref ns);
        string name = "";
        if (ns > 0) { var nb = new byte[ns]; if (PowerReadFriendlyName(IntPtr.Zero, ref g, IntPtr.Zero, IntPtr.Zero, nb, ref ns) == 0) name = System.Text.Encoding.Unicode.GetString(nb).TrimEnd('\0'); }
        plans.Add(new Dictionary<string, object> { { "guid", g.ToString() }, { "name", name } });
      }
      var power = new Dictionary<string, object> { { "active", act.ToString() }, { "plans", plans }, { "overlay", Str(RegValue(Registry.LocalMachine, @"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes", "ActiveOverlayAcPowerScheme")) ?? "" } };
      // Wi-Fi adapter power saving while plugged in (Power Options > Wireless Adapter Settings): the AC index, 0 = Maximum Performance
      var sub = new Guid("19cbb8fa-5279-450e-9fac-8a3d5fedd0c1"); var set = new Guid("12bbebe6-58d6-4636-95bb-3217ef867c1a"); uint idx;
      if (PowerReadACValueIndex(IntPtr.Zero, ref act, ref sub, ref set, out idx) == 0) power["wifiSaveAc"] = (int)idx;
      lock (gate) tune["power"] = power;
    } catch (Exception e) { Err("power", e); }
  }

  static void Settings(Dictionary<string, object> tune) {
    object battery; try { battery = Wmi("SELECT DeviceID FROM Win32_Battery").Count > 0; } catch { battery = null; }
    var HKCU = Registry.CurrentUser; var HKLM = Registry.LocalMachine;
    var build = Str(RegValue(HKLM, @"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber")); int b; int.TryParse(build ?? "", out b);
    lock (gate) {
      tune["battery"] = battery;
      tune["gameMode"] = RegValue(HKCU, @"Software\Microsoft\GameBar", "AutoGameModeEnabled");
      tune["bgRecord"] = RegValue(HKCU, @"Software\Microsoft\Windows\CurrentVersion\GameDVR", "HistoricalCaptureEnabled");
      tune["hags"] = RegValue(HKLM, @"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode");
      tune["dxGlobal"] = Str(RegValue(HKCU, @"Software\Microsoft\DirectX\UserGpuPreferences", "DirectXUserGlobalSettings")) ?? "";
      tune["windowsBuild"] = b;
      tune["firmware"] = RegValue(HKLM, @"SYSTEM\CurrentControlSet\Control", "PEFirmwareType");
      tune["mouseAccel"] = Str(RegValue(HKCU, @"Control Panel\Mouse", "MouseSpeed")) ?? "";
    }
  }

  static void Wired(Dictionary<string, object> tune) {
    // Get-NetAdapter -Physical, up, 802.3 (wired): its link speed
    try {
      var w = Wmi("SELECT InterfaceDescription, ReceiveLinkSpeed, NdisMedium, InterfaceOperationalStatus, Hidden FROM MSFT_NetAdapter WHERE ConnectorPresent = TRUE", @"root\StandardCimv2")
        .Where(a => !(a["Hidden"] is bool && (bool)a["Hidden"]) && Convert.ToInt32(a["InterfaceOperationalStatus"] ?? 0) == 1 && Convert.ToInt64(a["NdisMedium"] ?? -1) == 0)
        .Select(a => (object)new Dictionary<string, object> { { "name", Str(a["InterfaceDescription"]) }, { "bps", Dbl(a["ReceiveLinkSpeed"]) } }).ToList();
      lock (gate) tune["wired"] = w;
    } catch { }
  }

  static string G(string text, string label) { var m = Regex.Match(text, @"(?m)^\s*" + label + @"\s*:\s*(.+?)\s*$"); return m.Success ? m.Groups[1].Value : null; }
  static double Num(string s) { var t = Regex.Replace(s ?? "", "[^0-9.]", ""); double d; return double.TryParse(t, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d) ? d : 0; }
  // PowerShell's -like (case-insensitive; * and ? are wildcards)
  static bool Like(string s, string pattern) { return Regex.IsMatch(s, "^" + Regex.Escape(pattern).Replace(@"\*", ".*").Replace(@"\?", ".") + "$", RegexOptions.IgnoreCase | RegexOptions.Singleline); }
  static void Wifi(Dictionary<string, object> tune) {
    // Wi-Fi from netsh (English labels; anything else is left out), exactly as pc-check.ps1 reads it
    try {
      var netsh = System.IO.Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"), @"System32\netsh.exe");
      var wi = Run(netsh, "wlan show interfaces") ?? "";
      if (!Regex.IsMatch(wi, @"(?m)^\s*State\s*:\s*connected", RegexOptions.IgnoreCase)) return;
      var b = G(wi, "Band"); if (!string.IsNullOrEmpty(b)) b = b.Trim();
      int chVal; int.TryParse(Regex.Replace(G(wi, "Channel") ?? "", "[^0-9]", ""), out chVal);
      var rad = G(wi, "Radio type");
      if ((b != null && Regex.IsMatch(b, "(?i)invalid|unknown")) || string.IsNullOrWhiteSpace(b)) {
        if ((rad != null && Regex.IsMatch(rad, @"802\.11be", RegexOptions.IgnoreCase)) || chVal == 133 || (chVal > 14 && chVal < 36) || chVal > 177) b = "6 GHz";
        else if (chVal > 14) b = "5 GHz";
        else if (chVal > 0 && chVal <= 14) b = "2.4 GHz";
      }
      var ssid = G(wi, "SSID");
      var w = new Dictionary<string, object> { { "name", G(wi, "Name") }, { "ssid", ssid }, { "band", string.IsNullOrEmpty(b) ? null : b }, { "channel", G(wi, "Channel") }, { "signal", G(wi, "Signal") }, { "radio", rad },
        { "rxMbps", Num(G(wi, @"Receive rate \(Mbps\)")) }, { "txMbps", Num(G(wi, @"Transmit rate \(Mbps\)")) } };
      var ac = Run(netsh, "wlan show autoconfig") ?? "";
      w["autoConfig"] = Regex.IsMatch(ac, "(?i)enabled on interface");
      var dr = Run(netsh, "wlan show drivers") ?? "";
      w["radios"] = Regex.Match(dr, @"(?m)^\s*Radio types supported\s*:\s*(.+?)\s*$").Groups[1].Value;
      // does the same network (or one named for 5 GHz) answer on a 5 or 6 GHz channel nearby?
      var nets = Run(netsh, "wlan show networks mode=bssid") ?? "";
      bool five = false; string cur = null;
      foreach (var ln in Regex.Split(nets, "\r?\n")) {
        var s = Regex.Match(ln, @"^SSID \d+\s*:\s*(.*)$"); if (s.Success) { cur = s.Groups[1].Value.Trim(); continue; }
        var c = Regex.Match(ln, @"^\s*Channel\s*:\s*(\d+)");
        if (c.Success && int.Parse(c.Groups[1].Value) > 14 && !string.IsNullOrEmpty(cur) && (string.Equals(cur, ssid, StringComparison.OrdinalIgnoreCase) || (!string.IsNullOrEmpty(ssid) && Like(cur, Regex.Replace(ssid, @"[-_ ]?2\.?4\s*G?h?z?$", "", RegexOptions.IgnoreCase) + "*5G*")))) five = true;
      }
      w["fiveNearby"] = five;
      lock (gate) tune["wifi"] = w;
    } catch { }
  }

  static void Latency(Dictionary<string, object> tune) {
    // network latency and ping jitter: the local router hop and the internet
    try {
      var gw = Wmi("SELECT NextHop, RouteMetric FROM MSFT_NetRoute WHERE DestinationPrefix='0.0.0.0/0'", @"root\StandardCimv2").OrderBy(r => Convert.ToInt64(r["RouteMetric"] ?? 0)).Select(r => Str(r["NextHop"])).FirstOrDefault();
      if (string.IsNullOrEmpty(gw)) return;
      using (var p = new System.Net.NetworkInformation.Ping()) {
        Func<string, List<long>> three = (host) => { var t = new List<long>(); for (int i = 0; i < 3; i++) { try { var r = p.Send(host, 200); if (r.Status == System.Net.NetworkInformation.IPStatus.Success) t.Add(r.RoundtripTime); } catch { } } return t; };
        var gwT = three(gw); var inT = three("1.1.1.1");
        if (gwT.Count == 0) return;
        lock (gate) tune["latency"] = new Dictionary<string, object> {
          { "gw", gw }, { "gwMs", Math.Round(gwT.Average(), 1) }, { "gwJitter", gwT.Count > 1 ? (int)(gwT.Max() - gwT.Min()) : 0 },
          { "inMs", inT.Count > 0 ? (object)Math.Round(inT.Average(), 1) : null }, { "inJitter", inT.Count > 1 ? (int)(inT.Max() - inT.Min()) : 0 } };
      }
    } catch { }
  }

  static readonly object one = new object();
  public static object Facts() {
    lock (one) {   // one check at a time (the script was one process per check)
      denied = new List<object>(); errors = new List<object>();
      var o = new Dictionary<string, object> { { "volumes", new List<object>() }, { "disks", new List<object>() }, { "reliability", new List<object>() }, { "video", new List<object>() }, { "ram", new List<object>() },
        { "board", null }, { "devices", new List<object>() }, { "events", null }, { "restart", null }, { "denied", denied }, { "errors", errors } };
      var tune = new Dictionary<string, object>();
      // each part writes its own keys; the parts run side by side
      var parts = new Action[] {
        () => { var x = new Dictionary<string, object>(); Hardware(x); lock (gate) foreach (var kv in x) o[kv.Key] = kv.Value; },
        () => { var x = new Dictionary<string, object>(); Devices(x); lock (gate) foreach (var kv in x) o[kv.Key] = kv.Value; },
        () => { var x = new Dictionary<string, object>(); EventLog(x); lock (gate) foreach (var kv in x) o[kv.Key] = kv.Value; },
        () => { var x = new Dictionary<string, object>(); try { Restart(x); } catch (Exception e) { Note("restart", e); } DriverApps(x); lock (gate) foreach (var kv in x) o[kv.Key] = kv.Value; },
        () => { var x = new Dictionary<string, object>(); Nvidia(x, tune); lock (gate) foreach (var kv in x) o[kv.Key] = kv.Value; },
        () => { Power(tune); Settings(tune); },
        () => Wired(tune), () => Wifi(tune), () => Latency(tune),
      };
      var threads = parts.Select(a => new System.Threading.Thread(() => { try { a(); } catch (Exception e) { Err("check", e); } }) { IsBackground = true }).ToList();
      foreach (var t in threads) t.Start();
      foreach (var t in threads) t.Join(45000);
      lock (gate) o["tune"] = tune;
      return o;
    }
  }
}
