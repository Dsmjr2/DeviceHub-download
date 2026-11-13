# Read-only (13 Nov 2026, the volume pop-up hunt; docs/handoff/volume-popup.md): every volume or mute change Windows
# reports on the matching sound devices, with the time and who made it (DeviceHub tags its own: d3a1c0de-...).
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File helpers\volume-watch.ps1 -Seconds 600 [-Match HS80]
param([int]$Seconds = 60, [string]$Match = 'HS80')
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class VolWatch {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IMMDeviceCollection d); }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { int GetCount(out uint c); int Item(uint i, out IMMDevice d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int a, out IPropertyStore s); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PK k); int GetValue(ref PK k, out PV v); }
  [StructLayout(LayoutKind.Sequential)] struct PK { public Guid f; public int p; }
  [StructLayout(LayoutKind.Sequential)] struct PV { public short vt; short a, b, c; public IntPtr p; IntPtr p2; }
  [ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolumeCallback { [PreserveSig] int OnNotify(IntPtr data); }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume { int RegisterControlChangeNotify(IAudioEndpointVolumeCallback n); }
  class Cb : IAudioEndpointVolumeCallback {
    public string Name;
    public int OnNotify(IntPtr d) {
      var ctx = (Guid)Marshal.PtrToStructure(d, typeof(Guid));
      bool muted = Marshal.ReadInt32(d, 16) != 0;
      float lvl = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(d, 20)), 0);
      { var line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + Name + " vol=" + Math.Round(lvl * 100, 2) + " muted=" + muted + " by=" + (ctx == new Guid("d3a1c0de-5577-4d48-8b00-000000000001") ? "DeviceHub" : ctx.ToString()); lock (Lines) Lines.Add(line); }
      return 0;
    }
  }
  public static readonly List<string> Lines = new List<string>();
  static readonly List<object> keep = new List<object>();
  public static string Start(string match) {
    var en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    var names = new List<string>();
    for (int flow = 0; flow <= 1; flow++) {
      IMMDeviceCollection col; en.EnumAudioEndpoints(flow, 1, out col); uint n; col.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice dev; col.Item(i, out dev); IPropertyStore ps; dev.OpenPropertyStore(0, out ps);
        var k = new PK { f = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), p = 14 }; PV v; ps.GetValue(ref k, out v);
        string name = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
        if (name.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) continue;
        var iid = typeof(IAudioEndpointVolume).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
        var cb = new Cb { Name = (flow == 0 ? "OUT " : "MIC ") + name };
        ((IAudioEndpointVolume)o).RegisterControlChangeNotify(cb);
        keep.Add(o); keep.Add(cb); names.Add(cb.Name);
      }
    }
    return string.Join(", ", names);
  }
}
'@
Add-Type -TypeDefinition $src
"watching: " + [VolWatch]::Start($Match)
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds 200
  [System.Threading.Monitor]::Enter([VolWatch]::Lines)
  try { [VolWatch]::Lines | ForEach-Object { $_ }; [VolWatch]::Lines.Clear() } finally { [System.Threading.Monitor]::Exit([VolWatch]::Lines) }
}
"done"
