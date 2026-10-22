// Raw HID request/reply over Windows overlapped file I/O (used by the native helper and helpers/hid-caps.ps1).
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public class HidIo : IDisposable {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  readonly FileStream fs;
  readonly int len;
  readonly byte reportId;
  // One read is kept in flight across calls. A read that is still waiting when a request times out is reused by
  // the next request (abandoning it would let it swallow the next reply).
  Task<int> pending;
  byte[] pendingBuf;

  public HidIo(string path, int reportLength, byte reportId) {
    this.path = path;
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
    if (h.IsInvalid) throw new Exception("open failed " + Marshal.GetLastWin32Error());
    fs = new FileStream(h, FileAccess.ReadWrite, reportLength + 1, true);
    len = reportLength; this.reportId = reportId;
  }

  public byte[] Req(byte[] data) { return Req(data, 1, 1200); }
  public byte[] Req(byte[] data, int echo) { return Req(data, echo, 1200); }

  // Sends one report; returns the first reply whose first `echo` bytes match the request (byte 0 may also be 0xFF,
  // VIA's "unhandled"), without the report id, or null after waitMs. Replies that do not match are skipped.
  public byte[] Req(byte[] data, int echo, int waitMs) {
    var outb = new byte[len + 1]; outb[0] = reportId; Array.Copy(data, 0, outb, 1, Math.Min(data.Length, len));
    fs.Write(outb, 0, outb.Length);
    var until = DateTime.Now.AddMilliseconds(waitMs);
    while (true) {
      if (pending == null) { pendingBuf = new byte[len + 1]; pending = fs.ReadAsync(pendingBuf, 0, pendingBuf.Length); }
      var left = until - DateTime.Now;
      if (left < TimeSpan.Zero) left = TimeSpan.Zero;
      if (!pending.Wait(left)) return null;       // still waiting: keep it for the next call
      var inb = pendingBuf; pending = null;       // a completed read; the next loop starts a fresh one
      if (inb[0] != reportId || (inb[1] != data[0] && inb[1] != 0xff)) continue;
      bool same = true;
      for (int i = 1; i < echo && i < data.Length && i < len; i++) if (inb[1 + i] != data[i]) { same = false; break; }
      if (!same) continue;
      var r = new byte[len]; Array.Copy(inb, 1, r, 0, len); return r;
    }
  }

  // ---- feature reports (22 Oct 2026: devices that speak a standard, HID LampArray first; Razer, SteelSeries, ROCCAT) ----
  // On their own handle, opened without overlapped I/O on first use, so HidD_SetFeature / HidD_GetFeature wait for the
  // device's answer and never meet the read kept in flight above. The buffer is always the collection's feature
  // report length from Windows' parsed descriptor (byte 0 the report id), which is what hid.dll expects.
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_SetFeature(SafeFileHandle h, byte[] b, int len);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetFeature(SafeFileHandle h, byte[] b, int len);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr pp);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr pp);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr pp, byte[] caps);
  readonly string path;
  SafeFileHandle feat;
  int featLen = -1;

  SafeFileHandle FeatureHandle() {
    if (feat != null) return feat;
    var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) throw new Exception("open failed " + Marshal.GetLastWin32Error());
    IntPtr pp; int n = 0;
    if (HidD_GetPreparsedData(h, out pp)) { var c = new byte[64]; HidP_GetCaps(pp, c); n = BitConverter.ToUInt16(c, 8); HidD_FreePreparsedData(pp); }
    feat = h; featLen = n;
    return feat;
  }

  // The collection's feature report length with its report id byte (0: it has no feature reports).
  public int FeatureLength { get { FeatureHandle(); return featLen; } }

  // Sends one feature report: report[0] is its id, the rest its data (padded with zeros to the report length).
  // false when the collection has none, the report is too long, or the device refused it; a device that is gone throws.
  public bool FeatureSet(byte[] report) {
    var h = FeatureHandle();
    if (featLen <= 0 || report.Length > featLen) return false;
    var b = new byte[featLen]; Array.Copy(report, b, report.Length);
    if (HidD_SetFeature(h, b, b.Length)) return true;
    if (Marshal.GetLastWin32Error() == 1167) throw new Exception("device not connected");  // ERROR_DEVICE_NOT_CONNECTED
    return false;
  }

  // Reads feature report `id`: its first `len` data bytes, without the report id; null when the collection has none,
  // `len` is longer than its reports, or the device did not answer it; a device that is gone throws.
  public byte[] FeatureGet(byte id, int len) {
    var h = FeatureHandle();
    if (featLen <= 0 || len < 0 || len > featLen - 1) return null;
    var b = new byte[featLen]; b[0] = id;
    if (!HidD_GetFeature(h, b, b.Length)) {
      if (Marshal.GetLastWin32Error() == 1167) throw new Exception("device not connected");
      return null;
    }
    var r = new byte[len]; Array.Copy(b, 1, r, 0, len); return r;
  }

  public void Dispose() { fs.Dispose(); if (feat != null) feat.Dispose(); }
}

// Reports a device sends by itself (21 Oct 2026: the Pulsar mouse announces a DPI button press, command 0A), on a
// second handle opened for reading only, so nothing can be sent through it. Each report whose command byte (the one
// after the report id) is the watched one calls onReport; the reading thread ends when the handle is closed.
public class HidWatch : IDisposable {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  readonly FileStream fs;
  public HidWatch(string path, int reportLength, byte command, Action<byte> onReport) {
    var h = CreateFile(path, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);   // GENERIC_READ only
    if (h.IsInvalid) throw new Exception("open failed " + Marshal.GetLastWin32Error());
    fs = new FileStream(h, FileAccess.Read, reportLength, false);
    var t = new System.Threading.Thread(() => {
      var b = new byte[reportLength];
      while (true) {
        int n; try { n = fs.Read(b, 0, b.Length); } catch { return; }
        if (n > 1 && b[1] == command) { try { onReport(command); } catch { } }
      }
    }) { IsBackground = true };
    t.Start();
  }
  public void Dispose() { try { fs.Dispose(); } catch { } }
}
