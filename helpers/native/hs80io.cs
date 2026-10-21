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
  public Hs80Io(string path) {
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) throw new Exception("open failed " + Marshal.GetLastWin32Error());
    fs = new FileStream(h, FileAccess.ReadWrite, 64, true);  // buffer = report size, so writes go straight out
    Task.Run(() => {
      while (true) {
        var b = new byte[64]; int n;
        try { n = fs.Read(b, 0, 64); } catch { Broken = true; Events.Add(null); return; }
        if (n <= 0) continue;
        byte from = (byte)(Ep == 9 ? 1 : 0);  // byte 1 says who answered: 1 = the headset through the receiver, 0 = the device itself
        if (b[0] == 1 && b[1] == from && (b[2] == 1 || b[2] == 2 || b[2] == 6 || b[2] == 0x0d)) Replies.Add(b);  // reply to us  // reply to a set, get or light write
        else if (b[0] == 3 && b[1] == from && b[2] == 1) Events.Add(b);             // property changed
      }
    });
  }
  // One get; null if no reply in waitMs. Stale replies from an earlier timed-out get are dropped first.
  public byte[] Get(int id, int waitMs) {
    byte[] old; while (Replies.TryTake(out old)) {}
    var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 2; o[3] = (byte)(id & 0xff); o[4] = (byte)(id >> 8);
    fs.Write(o, 0, 64); fs.Flush();
    byte[] r; return Replies.TryTake(out r, waitMs) ? r : null;
  }
  // Sets ONE property, from a fixed list with fixed ranges (the same set message iCUE uses, [02] 09 01 <id> 00 <value LE>):
  //   02 LED brightness 0..1000, 03 lighting mode 1..2, 0E auto-shutoff in ms (1..120 minutes).
  // Returns the reply's status byte, or -1.
  public int Set(int id, int value, int waitMs) {
    bool ok = (id == 0x02 && value >= 0 && value <= 1000) || (id == 0x03 && (value == 1 || value == 2))
           || (id == 0x0e && value >= 60000 && value <= 7200000);
    if (!ok) throw new ArgumentException("property " + id.ToString("x2") + " = " + value + " is not something DeviceHub sets");
    byte[] old; while (Replies.TryTake(out old)) {}
    var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 1; o[3] = (byte)id; o[4] = 0;
    o[5] = (byte)(value & 0xff); o[6] = (byte)((value >> 8) & 0xff); o[7] = (byte)((value >> 16) & 0xff); o[8] = (byte)((value >> 24) & 0xff);
    fs.Write(o, 0, 64); fs.Flush();
    byte[] r; return Replies.TryTake(out r, waitMs) ? r[3] : -1;
  }
  // The light colour message; returns the reply's status byte, or -1 if no reply.
  public int Light(byte[] rgb9, int waitMs) {
    byte[] old; while (Replies.TryTake(out old)) {}
    var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 6; o[3] = 0; o[4] = 9;
    Array.Copy(rgb9, 0, o, 8, 9);
    fs.Write(o, 0, 64); fs.Flush();
    byte[] r; return Replies.TryTake(out r, waitMs) ? r[3] : -1;
  }
  // Opens the lighting channel (handle 0 on resource 1), what iCUE sends before its colour messages. Status byte or -1.
  public int OpenLight(int waitMs) {
    byte[] old; while (Replies.TryTake(out old)) {}
    var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 0x0d; o[3] = 0; o[4] = 1;
    fs.Write(o, 0, 64); fs.Flush();
    byte[] r; return Replies.TryTake(out r, waitMs) ? r[3] : -1;
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
}
