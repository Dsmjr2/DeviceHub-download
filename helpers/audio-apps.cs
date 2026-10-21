// Which app plays on which speaker, and moving an app to another one (19 Oct 2026, Shawn: picking the headset in
// Windows left iTunes on the monitor). Some apps (iTunes) pick their speaker once at start and ignore a new Windows
// default; Windows' own per-app setting (Settings > Sound > Volume mixer > Output device) moves them at once, even
// mid-song. This is that same setting, through the interface the Volume mixer uses.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class AudioApps {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint n); [PreserveSig] int Item(uint i, out IMMDevice d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore s);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { [PreserveSig] int GetCount(out int c); [PreserveSig] int GetAt(int i, out PK k); [PreserveSig] int GetValue(ref PK k, out PV v); }
  [StructLayout(LayoutKind.Sequential)] struct PK { public Guid f; public int p; }
  [StructLayout(LayoutKind.Explicit)] struct PV { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public long a; [FieldOffset(16)] public long b; }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PV pv);
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c); [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s); }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int s);
    [PreserveSig] int GetDisplayName(IntPtr a); [PreserveSig] int SetDisplayName(IntPtr a, IntPtr b); [PreserveSig] int GetIconPath(IntPtr a); [PreserveSig] int SetIconPath(IntPtr a, IntPtr b);
    [PreserveSig] int GetGroupingParam(IntPtr a); [PreserveSig] int SetGroupingParam(IntPtr a, IntPtr b); [PreserveSig] int RegisterAudioSessionNotification(IntPtr a); [PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
    [PreserveSig] int GetSessionIdentifier(IntPtr a); [PreserveSig] int GetSessionInstanceIdentifier(IntPtr a);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
  }

  // Windows.Media.Internal.AudioPolicyConfig: the Volume mixer's per-app speaker setting. Only the last three
  // methods are used; the ones before them only hold their places in the table.
  [ComImport, Guid("ab3d4648-e242-459f-b02f-541c70306324"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
  interface IAudioPolicyConfigFactory {
    [PreserveSig] int s01(); [PreserveSig] int s02(); [PreserveSig] int s03(); [PreserveSig] int s04(); [PreserveSig] int s05();
    [PreserveSig] int s06(); [PreserveSig] int s07(); [PreserveSig] int s08(); [PreserveSig] int s09(); [PreserveSig] int s10();
    [PreserveSig] int s11(); [PreserveSig] int s12(); [PreserveSig] int s13(); [PreserveSig] int s14(); [PreserveSig] int s15();
    [PreserveSig] int s16(); [PreserveSig] int s17(); [PreserveSig] int s18(); [PreserveSig] int s19();
    [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, IntPtr deviceId);
    [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint pid, int flow, int role, out IntPtr deviceId);
    [PreserveSig] int ClearAllPersistedApplicationDefaultEndpoints();
  }
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, [MarshalAs(UnmanagedType.IInspectable)] out object f);
  [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr h);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
  [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr h, out uint len);

  static IAudioPolicyConfigFactory factory;
  static IAudioPolicyConfigFactory Factory() {
    if (factory != null) return factory;
    IntPtr name; WindowsCreateString("Windows.Media.Internal.AudioPolicyConfig", 40, out name);
    try { var iid = typeof(IAudioPolicyConfigFactory).GUID; object f; Marshal.ThrowExceptionForHR(RoGetActivationFactory(name, ref iid, out f)); factory = (IAudioPolicyConfigFactory)f; }
    finally { WindowsDeleteString(name); }
    return factory;
  }
  const string PREFIX = @"\\?\SWD#MMDEVAPI#", SUFFIX = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";

  static IMMDeviceEnumerator Enum() { return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))); }
  static string Name(IMMDevice d) {
    IPropertyStore s; if (d.OpenPropertyStore(0, out s) != 0) return "";
    var k = new PK { f = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), p = 14 }; PV v;
    if (s.GetValue(ref k, out v) != 0) return "";
    string r = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : ""; PropVariantClear(ref v); return r;
  }
  static string ProcName(uint pid) {
    if (pid == 0) return null;
    try { using (var p = System.Diagnostics.Process.GetProcessById((int)pid)) return p.ProcessName; } catch { return null; }
  }

  // Every active speaker: its id, name, whether it is the default, and the apps with a sound stream on it
  // ({ pid, name, playing }; system sounds left out).
  public static List<Dictionary<string, object>> Outputs() {
    var r = new List<Dictionary<string, object>>(); var e = Enum();
    IMMDevice def; string defId = null; if (e.GetDefaultAudioEndpoint(0, 1, out def) == 0) def.GetId(out defId);
    IMMDeviceCollection c; if (e.EnumAudioEndpoints(0, 1, out c) != 0) return r;
    uint n; c.GetCount(out n);
    for (uint i = 0; i < n; i++) {
      IMMDevice d; c.Item(i, out d); string id; d.GetId(out id);
      var apps = new List<Dictionary<string, object>>();
      try {
        var iid = typeof(IAudioSessionManager2).GUID; object mo;
        if (d.Activate(ref iid, 23, IntPtr.Zero, out mo) == 0) {
          IAudioSessionEnumerator se; ((IAudioSessionManager2)mo).GetSessionEnumerator(out se); int sn; se.GetCount(out sn);
          for (int j = 0; j < sn; j++) {
            IAudioSessionControl2 s; se.GetSession(j, out s);
            if (s.IsSystemSoundsSession() == 0) continue;
            int st; s.GetState(out st); uint pid; s.GetProcessId(out pid);
            var pn = ProcName(pid); if (pn == null) continue;
            apps.Add(new Dictionary<string, object> { { "pid", pid }, { "name", pn }, { "playing", st == 1 } });
          }
        }
      } catch { }
      r.Add(new Dictionary<string, object> { { "id", id }, { "name", Name(d) }, { "default", id == defId }, { "apps", apps } });
    }
    return r;
  }

  // Sends one app's sound to one speaker (null: back to following the Windows default), as the Volume mixer does.
  public static void Route(uint pid, string id) {
    IntPtr h = IntPtr.Zero;
    if (id != null) { var full = PREFIX + id + SUFFIX; WindowsCreateString(full, full.Length, out h); }
    try { for (int role = 0; role < 2; role++) Marshal.ThrowExceptionForHR(Factory().SetPersistedDefaultAudioEndpoint(pid, 0, role, h)); }
    finally { if (h != IntPtr.Zero) WindowsDeleteString(h); }
  }

  // Every app back to following the Windows default (the only way Windows offers to undo the setting: it takes no
  // "none" for a single app).
  public static void ReleaseAll() { Marshal.ThrowExceptionForHR(Factory().ClearAllPersistedApplicationDefaultEndpoints()); }

  // Every app that plays through the default (one that chose its own speaker inside the app is not affected) moves
  // to `id`, the current default: each is sent there, then released at once, so nothing stays pinned and the next
  // change in Windows' sound menu moves them again. Returns the names of the apps moved.
  public static List<string> Follow(string id) {
    var moved = new List<string>(); var seen = new HashSet<uint>();
    var outs = Outputs();
    // iTunes stops playing when its speaker changes; if it was playing, it is started again on the new one
    bool iTunesPlaying = false;
    foreach (var o in outs) foreach (var a in (List<Dictionary<string, object>>)o["apps"]) if ((string)a["name"] == "iTunes" && (bool)a["playing"]) iTunesPlaying = true;
    foreach (var o in outs) {
      if ((string)o["id"] == id) continue;
      foreach (var a in (List<Dictionary<string, object>>)o["apps"]) {
        var pid = (uint)a["pid"]; if (!seen.Add(pid)) continue;
        try { Route(pid, id); moved.Add((string)a["name"]); } catch { }
      }
    }
    if (moved.Count > 0) { System.Threading.Thread.Sleep(300); ReleaseAll(); }
    if (iTunesPlaying && moved.Contains("iTunes")) ResumeITunes();
    return moved;
  }

  // iTunes' own automation (the "iTunes.Application" object): play again if it stopped. Only reached when iTunes is
  // running and was playing a moment ago.
  static void ResumeITunes() {
    for (int i = 0; i < 10; i++) {
      System.Threading.Thread.Sleep(150);
      try {
        var t = Type.GetTypeFromProgID("iTunes.Application"); if (t == null) return;
        var it = Activator.CreateInstance(t);
        try {
          var state = Convert.ToInt32(t.InvokeMember("PlayerState", System.Reflection.BindingFlags.GetProperty, null, it, null));
          if (state == 0) { t.InvokeMember("Play", System.Reflection.BindingFlags.InvokeMethod, null, it, null); return; }
        } finally { Marshal.ReleaseComObject(it); }
      } catch { return; }
    }
  }

  // The speaker one app is set to in the Volume mixer, or null when it follows the default.
  public static string RoutedTo(uint pid) {
    IntPtr h; if (Factory().GetPersistedDefaultAudioEndpoint(pid, 0, 1, out h) != 0 || h == IntPtr.Zero) return null;
    try { uint len; var s = Marshal.PtrToStringUni(WindowsGetStringRawBuffer(h, out len), (int)len); if (s.StartsWith(PREFIX)) s = s.Substring(PREFIX.Length); if (s.EndsWith(SUFFIX)) s = s.Substring(0, s.Length - SUFFIX.Length); return s; }
    finally { WindowsDeleteString(h); }
  }
}
