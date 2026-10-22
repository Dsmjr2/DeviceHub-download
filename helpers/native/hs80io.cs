// Headset (Bragi) channel and fast HID lookup for the native helper.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
public class Hs80Io : IDisposable {
  public byte Ep = 9;  // 9 = headset through the receiver, 8 = headset on its cable
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  readonly FileStream fs;
  public readonly BlockingCollection<byte[]> Replies = new BlockingCollection<byte[]>();
  public readonly BlockingCollection<byte[]> Events = new BlockingCollection<byte[]>();
  public volatile bool Broken;
  // The two frames (22 Oct 2026; docs/handoff/corsair-peripheral-frame.md). A channel is the HS80's unless its name
  // carries "frame=peripheral" (helper.cs HandleHs80, FrameOf below); the HS80's bytes are the ones it always sent.
  //   headset (HS80 and the other Bragi headsets): 64-byte reports WITH report id 02 out, replies in report 01:
  //       out [02] [ep] [cmd] ...          reply [01] [who] [cmd] [status] [value LE]     notices [03] [who] 01 [id] ..
  //   peripheral (Corsair Bragi mice and keyboards): no report ids, so Windows puts report id 00 in front of the
  //   64 data bytes (65 in all, HIDP_CAPS output length 65):
  //       out [00] [ep] [cmd] ...          reply [00] [who] [cmd] [status] [value LE]     (no notices read)
  //   OpenLinkHub m75W.go / k70core.go transfer(): bufferW = 65 bytes, bufferW[0] = 0 (hidapi's "no report id"),
  //   bufferW[1] = endpoint, the command from bufferW[2]; the reply read is 64 bytes with the value at [3:5] (hidapi
  //   drops the 00), where hs80rgbW.go puts 02 at bufferW[1] and reads the headset's value at [4:6]. ckb-next
  //   bragi_common.c: { BRAGI_MAGIC (08), BRAGI_GET, prop, 0 }, status at response[2], value from response[3].
  //   So after the report id byte, both frames put every byte at the same offset; only the id and the length differ.
  public readonly bool Peripheral;
  readonly int len;
  public Hs80Io(string path) : this(path, false) { }
  public Hs80Io(string path, bool peripheral) {
    Peripheral = peripheral; len = ReportLen(peripheral);
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) throw new Exception("open failed " + Marshal.GetLastWin32Error());
    fs = new FileStream(h, FileAccess.ReadWrite, len, true);  // buffer = report size, so writes go straight out
    Task.Run(() => {
      while (true) {
        var b = new byte[len]; int n;
        try { n = fs.Read(b, 0, len); } catch { Broken = true; Events.Add(null); return; }
        if (n <= 0) continue;
        if (IsReply(Peripheral, Ep, b)) Replies.Add(b);        // reply to a set, get (or, on the headset, a light write)
        else if (IsEvent(Peripheral, Ep, b)) Events.Add(b);    // property changed (headset only)
      }
    });
  }

  // ---- the frames, as pure functions (tests/native/hs80-frame.cs checks the headset's against the old code) ----
  public static int ReportLen(bool peripheral) { return peripheral ? 65 : 64; }
  // byte 1 says who answered: 1 = the headset through the receiver, 0 = the device itself
  static byte From(byte ep) { return (byte)(ep == 9 ? 1 : 0); }
  public static bool IsReply(bool peripheral, byte ep, byte[] b) {
    if (peripheral) return b[0] == 0 && b[1] == From(ep) && (b[2] == 1 || b[2] == 2);
    return b[0] == 1 && b[1] == From(ep) && (b[2] == 1 || b[2] == 2 || b[2] == 6 || b[2] == 0x0d);
  }
  public static bool IsEvent(bool peripheral, byte ep, byte[] b) { return !peripheral && b[0] == 3 && b[1] == From(ep) && b[2] == 1; }
  static byte[] Frame(bool peripheral, byte ep, byte cmd) {
    var o = new byte[ReportLen(peripheral)]; o[0] = (byte)(peripheral ? 0 : 2); o[1] = ep; o[2] = cmd; return o;
  }
  public static byte[] GetFrame(bool peripheral, byte ep, int id) {
    var o = Frame(peripheral, ep, 2); o[3] = (byte)(id & 0xff); o[4] = (byte)(id >> 8); return o;
  }
  public static byte[] SetFrame(bool peripheral, byte ep, int id, int value) {
    var o = Frame(peripheral, ep, 1); o[3] = (byte)id; o[4] = 0;
    o[5] = (byte)(value & 0xff); o[6] = (byte)((value >> 8) & 0xff); o[7] = (byte)((value >> 16) & 0xff); o[8] = (byte)((value >> 24) & 0xff);
    return o;
  }
  public static byte[] LightFrame(byte ep, byte[] rgb9) { var o = Frame(false, ep, 6); o[3] = 0; o[4] = 9; Array.Copy(rgb9, 0, o, 8, 9); return o; }
  public static byte[] OpenLightFrame(byte ep) { var o = Frame(false, ep, 0x0d); o[3] = 0; o[4] = 1; return o; }

  // The SET lists: ONE property at a time, from a fixed list with fixed ranges; anything else is never sent.
  // Headset (the same set message iCUE uses, [02] 09 01 <id> 00 <value LE>): 02 LED brightness 0..1000, 03 lighting
  //   mode 1..2, 0E auto-shutoff in ms (1..120 minutes); for the other Bragi headsets (device-library/corsair-bragi-headset,
  //   docs/brands/corsair.md section 3, 22 Oct 2026): 0D sleep timer on/off, 46 sidetone on/off (0 = on), 47 sidetone
  //   level 0..1000.
  public static bool Hs80Allows(int id, int value) {
    return (id == 0x02 && value >= 0 && value <= 1000) || (id == 0x03 && (value == 1 || value == 2))
        || (id == 0x0e && value >= 60000 && value <= 7200000)
        || (id == 0x0d && (value == 0 || value == 1))
        || (id == 0x46 && (value == 0 || value == 1))
        || (id == 0x47 && value >= 0 && value <= 1000);
  }
  // Peripheral (device-library/corsair-bragi-peripherals; its own list, never the headset's), each from the sources:
  //   02 brightness 0..1000 (OpenLinkHub k70pro.go cmdBrightness 01 02 00; its buttons 0, 300, 600, 1000)
  //   0D sleep timer on/off 0/1 (OpenLinkHub m75W.go cmdOpenSleepWriteEndpoint 01 0d 00 01; 0 = off as the headsets)
  //   0E sleep timer 60000..3600000 ms (OpenLinkHub m75W.go cmdSleep 01 0e 00, SleepModes 1..60 minutes x 60000)
  //   01 polling rate 1..4 = 125..1000 Hz (ckb-next bragi_proto.h BRAGI_POLLRATE_8MS 01 .. BRAGI_POLLRATE_1MS 04,
  //      device_bragi.c cmd_pollrate_bragi; OpenLinkHub m75W.go PollingRates 1..7: 5..7 only on some mice, left out)
  //   21 / 22 DPI X / Y 100..26000 (OpenLinkHub m75W.go cmdSetDpi, minDpiValue 100, maxDpiValue 26000; ckb-next
  //      dpi_bragi.c BRAGI_DPI_X / _Y, 16 bits LE). The driver narrows the top per model.
  //   Not here: 03 (light mode, and 03 = 4 sleep now), 1E DPI stage, 37 sleep, handles, lights.
  public static bool PeripheralAllows(int id, int value) {
    return (id == 0x02 && value >= 0 && value <= 1000)
        || (id == 0x0d && (value == 0 || value == 1))
        || (id == 0x0e && value >= 60000 && value <= 3600000)
        || (id == 0x01 && value >= 1 && value <= 4)
        || ((id == 0x21 || id == 0x22) && value >= 100 && value <= 26000);
  }
  public static bool Allows(bool peripheral, int id, int value) { return peripheral ? PeripheralAllows(id, value) : Hs80Allows(id, value); }

  // The frame a channel name asks for: "hs80" (no frame part: every HS80 and headset channel), "peripheral"
  // ("frame=peripheral" after the endpoint), or null for any other frame part (OPEN then answers ERR).
  public static string FrameOf(string name) {
    var p = name.Split(':'); string f = "hs80";
    for (int i = 3; i < p.Length; i++) {
      if (!p[i].StartsWith("frame=")) continue;
      if (p[i] == "frame=peripheral" && f == "hs80") f = "peripheral"; else return null;
    }
    return f;
  }
  // DeviceHub's own HS80 RGB Wireless (device-library/corsair-bragi-peripherals HS80_OWN_PIDS): never on the peripheral frame
  public static bool IsHs80Pid(string pid) { var u = pid.ToUpper(); return u == "0A69" || u == "0A6B" || u == "0A71"; }
  // DeviceHub's own HS80 (final audit, 22 Oct 2026; helper.cs HandleHs80 asks this first): its own code sends only SET
  // 02, 03 and 0E (helpers/hs80-direct.js), so the SETs added for the other Bragi headsets (0D, 46, 47) and any channel
  // with the library drivers' "bragi" tag are refused on an HS80 product id. null = allowed (the HS80's own requests).
  public static string Hs80OwnRefusal(string name, string verb, int id) {
    var p = name.Split(':');
    if (p.Length < 2 || !IsHs80Pid(p[1])) return null;
    for (int i = 3; i < p.Length; i++) if (p[i] == "bragi" && verb != "CLOSE") return "the HS80 is DeviceHub's own headset: a library driver never talks to it";
    if (verb == "SET" && (id == 0x0d || id == 0x46 || id == 0x47)) return "DeviceHub's own HS80 code never sets " + id.ToString("x2");
    return null;
  }

  byte[] Send(byte[] o, int waitMs) {
    byte[] old; while (Replies.TryTake(out old)) {}
    fs.Write(o, 0, o.Length); fs.Flush();
    byte[] r; return Replies.TryTake(out r, waitMs) ? r : null;
  }
  // One get; null if no reply in waitMs. Stale replies from an earlier timed-out get are dropped first.
  public byte[] Get(int id, int waitMs) { return Send(GetFrame(Peripheral, Ep, id), waitMs); }
  // Sets ONE property from this frame's list (above). Returns the reply's status byte, or -1.
  public int Set(int id, int value, int waitMs) {
    if (!Allows(Peripheral, id, value)) throw new ArgumentException("property " + id.ToString("x2") + " = " + value + " is not something DeviceHub sets");
    var r = Send(SetFrame(Peripheral, Ep, id, value), waitMs); return r != null ? r[3] : -1;
  }
  // The light colour message (headset only); returns the reply's status byte, or -1 if no reply.
  public int Light(byte[] rgb9, int waitMs) {
    if (Peripheral) throw new ArgumentException("no light messages on a peripheral channel");
    var r = Send(LightFrame(Ep, rgb9), waitMs); return r != null ? r[3] : -1;
  }
  // Opens the lighting channel (handle 0 on resource 1), what iCUE sends before its colour messages (headset only).
  public int OpenLight(int waitMs) {
    if (Peripheral) throw new ArgumentException("no handles are opened on a peripheral channel");
    var r = Send(OpenLightFrame(Ep), waitMs); return r != null ? r[3] : -1;
  }
  public void Dispose() { fs.Dispose(); }
}

// Finds the headset's control channel fast (a few ms): Windows' HID device list, then each candidate's usage page,
// usage and report size. Replaces Get-PnpDevice + Get-PnpDeviceProperty, which took ~2.4 s (19 Oct 2026) and kept
// the headset's own white light up for ~5 s after it was plugged in.
public static class HidFind {
  [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid g; public int flags; public IntPtr r; }
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, string e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA o);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int need, IntPtr info);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr pp);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr pp);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr pp, byte[] caps);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(SafeFileHandle h, byte[] b, int len);
  public static string Find(string pid) { return Find("1b1c", pid, 0xFF42, 1, 64); }
  // Every HID collection on a usage page and usage (20 Oct 2026: VIA keyboards, page FF60 usage 61, of any maker):
  // "vid pid name" per device, devices separated by "|". Opened with access 0 (query only); nothing is sent to the device.
  public static string List(int page, int usage) {
    var seen = new HashSet<string>(); var lines = new List<string>();
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, null, IntPtr.Zero, 0x12);
    try {
      for (int i = 0; ; i++) {
        var d = new SP_DEVICE_INTERFACE_DATA(); d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) break;
        int need; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal(need);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(buf + 4);
          var m = System.Text.RegularExpressions.Regex.Match(path ?? "", "vid_([0-9a-f]{4})&pid_([0-9a-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
          if (!m.Success) continue;
          using (var h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (h.IsInvalid) continue;
            IntPtr pp; if (!HidD_GetPreparsedData(h, out pp)) continue;
            var c = new byte[64]; HidP_GetCaps(pp, c); HidD_FreePreparsedData(pp);
            if (BitConverter.ToUInt16(c, 0) != usage || BitConverter.ToUInt16(c, 2) != page) continue;
            string key = (m.Groups[1].Value + m.Groups[2].Value).ToUpper();
            if (!seen.Add(key)) continue;
            var nb = new byte[256]; string name = HidD_GetProductString(h, nb, nb.Length) ? System.Text.Encoding.Unicode.GetString(nb).TrimEnd('\0') : "";
            lines.Add(m.Groups[1].Value.ToUpper() + " " + m.Groups[2].Value.ToUpper() + " " + name.Replace('\n', ' ').Replace('|', ' ').Trim());
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return string.Join("|", lines);
  }
  // Any HID collection: vendor/product in the path, then usage page, usage and (if > 0) output report size.
  public static string Find(string vid, string pid, int page, int usage, int outLen) {
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, null, IntPtr.Zero, 0x12);  // present, interfaces
    string want = "vid_" + vid.ToLower() + "&pid_" + pid.ToLower();
    try {
      for (int i = 0; ; i++) {
        var d = new SP_DEVICE_INTERFACE_DATA(); d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) return null;
        int need; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal(need);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(buf + 4);
          if (path == null || path.ToLower().IndexOf(want) < 0) continue;
          using (var h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (h.IsInvalid) continue;
            IntPtr pp; if (!HidD_GetPreparsedData(h, out pp)) continue;
            var c = new byte[64]; HidP_GetCaps(pp, c); HidD_FreePreparsedData(pp);
            // usage 01 on page FF42, 64-byte output reports: the Bragi channel
            if (BitConverter.ToUInt16(c, 0) == usage && BitConverter.ToUInt16(c, 2) == page && (outLen <= 0 || BitConverter.ToUInt16(c, 6) == outLen)) return path;
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }

  // A collection chosen by more than its usage (22 Oct 2026, library drivers; helper.cs HandleHid's channel options).
  // page / usage -1 = any; iface (the "&mi_NN" in the path), col ("&colNN"), and the input, output and feature report
  // lengths WITH their report id byte (HidP_GetCaps) are checked when >= 0. Opened with access 0 (query only); nothing
  // is sent. The first collection that fits, or null.
  public static string FindEx(string vid, string pid, int page, int usage, int iface, int col, int inLen, int outLen, int featLen) {
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, null, IntPtr.Zero, 0x12);
    string want = "vid_" + vid.ToLower() + "&pid_" + pid.ToLower();
    try {
      for (int i = 0; ; i++) {
        var d = new SP_DEVICE_INTERFACE_DATA(); d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) return null;
        int need; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal(need);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(buf + 4);
          if (path == null || path.ToLower().IndexOf(want) < 0 || !PathFits(path, iface, col)) continue;
          using (var h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (h.IsInvalid) continue;
            IntPtr pp; if (!HidD_GetPreparsedData(h, out pp)) continue;
            var c = new byte[64]; HidP_GetCaps(pp, c); HidD_FreePreparsedData(pp);
            if (CapsFit(c, page, usage, inLen, outLen, featLen)) return path;
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }

  // the USB interface and collection numbers in a device path ("...&mi_02&col03#..."); -1 = not asked
  public static bool PathFits(string path, int iface, int col) {
    string p = path.ToLower();
    if (iface >= 0 && p.IndexOf("&mi_" + iface.ToString("x2")) < 0) return false;
    if (col >= 0 && p.IndexOf("&col" + col.ToString("x2")) < 0) return false;
    return true;
  }

  // HIDP_CAPS: usage @0, usage page @2, input @4, output @6, feature @8 report byte lengths; -1 = not asked
  public static bool CapsFit(byte[] c, int page, int usage, int inLen, int outLen, int featLen) {
    if (usage >= 0 && BitConverter.ToUInt16(c, 0) != usage) return false;
    if (page >= 0 && BitConverter.ToUInt16(c, 2) != page) return false;
    if (inLen >= 0 && BitConverter.ToUInt16(c, 4) != inLen) return false;
    if (outLen >= 0 && BitConverter.ToUInt16(c, 6) != outLen) return false;
    if (featLen >= 0 && BitConverter.ToUInt16(c, 8) != featLen) return false;
    return true;
  }
}
