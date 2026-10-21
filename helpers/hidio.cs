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

  public void Dispose() { fs.Dispose(); }
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
