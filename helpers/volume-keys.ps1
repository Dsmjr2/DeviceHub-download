# Read-only (13 Nov 2026, docs/handoff/volume-popup.md): every input report from every device's volume keys (HID usage
# page 0x0C: a headset wheel, a keyboard knob, media keys), with the time. Opens them for reading only; sends nothing.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File helpers\volume-keys.ps1 -Seconds 600 [-Log file]
param([int]$Seconds = 60, [string]$Log = '')
$src = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32.SafeHandles;
public static class HidListen {
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, out CAPS c);
  [StructLayout(LayoutKind.Sequential)] struct CAPS { public ushort Usage, UsagePage, InLen, OutLen, FeatLen; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] r; public ushort a, b, c, d, e, f, g, h, i, j; }
  [DllImport("setupapi.dll", CharSet = CharSet.Auto)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref DID did);
  [DllImport("setupapi.dll", CharSet = CharSet.Auto)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref DID did, IntPtr det, int sz, out int req, IntPtr di);
  [StructLayout(LayoutKind.Sequential)] struct DID { public int cb; public Guid g; public int f; public IntPtr r; }
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  public static readonly List<string> Lines = new List<string>();
  public static List<string> Paths() {
    var r = new List<string>(); Guid g; HidD_GetHidGuid(out g);
    var set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12);
    for (int i = 0; ; i++) {
      var did = new DID { cb = Marshal.SizeOf(typeof(DID)) };
      if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref did)) break;
      int req; SetupDiGetDeviceInterfaceDetail(set, ref did, IntPtr.Zero, 0, out req, IntPtr.Zero);
      var buf = Marshal.AllocHGlobal(req); Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
      if (SetupDiGetDeviceInterfaceDetail(set, ref did, buf, req, out req, IntPtr.Zero)) { var p = Marshal.PtrToStringAuto(new IntPtr(buf.ToInt64() + 4)); r.Add(p); }
      Marshal.FreeHGlobal(buf);
    }
    return r;
  }
  public static string Start() {
    var found = new List<string>();
    foreach (var p in Paths()) {
      // no read/write access needed to read its caps; reading input needs GENERIC_READ (shared with Windows)
      var h = CreateFile(p, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (h.IsInvalid) continue;
      IntPtr pp; if (!HidD_GetPreparsedData(h, out pp)) { h.Dispose(); continue; }
      CAPS c; HidP_GetCaps(pp, out c); HidD_FreePreparsedData(pp);
      if (c.UsagePage != 0x0C) { h.Dispose(); continue; }
      found.Add(p.Substring(0, Math.Min(48, p.Length)) + " len " + c.InLen);
      var fs = new FileStream(h, FileAccess.Read, c.InLen, false); int len = c.InLen; string tag = p.Substring(8, Math.Min(25, p.Length - 8));
      new Thread(() => { var b = new byte[len]; try { while (true) { int n = fs.Read(b, 0, len); if (n <= 0) break; lock (Lines) Lines.Add(DateTime.Now.ToString("HH:mm:ss.fff") + " " + tag + " " + BitConverter.ToString(b, 0, n)); } } catch (Exception e) { lock (Lines) Lines.Add(tag + " ended: " + e.Message); } }) { IsBackground = true }.Start();
    }
    return string.Join(" | ", found);
  }
}
'@
Add-Type -TypeDefinition $src
"listening: " + [HidListen]::Start()
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds 200
  [System.Threading.Monitor]::Enter([HidListen]::Lines)
  try { foreach ($l in [HidListen]::Lines) { $l; if ($Log) { Add-Content -Path $Log -Value $l } }; [HidListen]::Lines.Clear() } finally { [System.Threading.Monitor]::Exit([HidListen]::Lines) }
}
"done"
