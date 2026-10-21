// Windows Core Audio: find playback/recording endpoints by name, read and set their volume and mute.
// Plain Windows APIs (MMDevice + IAudioEndpointVolume); nothing installed.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WinAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out uint count);
    int Item(uint index, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out int count);
    int GetAt(int index, out PROPERTYKEY key);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n);
    int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float db, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
    int GetChannelVolumeLevel(uint ch, out float db);
    int GetChannelVolumeLevelScalar(uint ch, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public short vt; short r1, r2, r3; public IntPtr p; IntPtr p2; }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

  static readonly PROPERTYKEY FriendlyName = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
  const int ACTIVE = 1;

  public class Endpoint { public string flow, name, id; public int volume; public bool muted; }

  static IEnumerable<KeyValuePair<Endpoint, IAudioEndpointVolume>> Each(string match) {
    // by CLSID: another helper may have created this COM class first, and `new` would then fail to cast
    var en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    for (int flow = 0; flow <= 1; flow++) {
      IMMDeviceCollection col; en.EnumAudioEndpoints(flow, ACTIVE, out col);
      uint n; col.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        IPropertyStore ps; d.OpenPropertyStore(0, out ps);
        var key = FriendlyName; PROPVARIANT v; ps.GetValue(ref key, out v);
        string name = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
        PropVariantClear(ref v);  // the name is Windows' memory to free (19 Oct 2026: not freeing it leaked every call)
        if (match != null && name.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) continue;
        string id; d.GetId(out id);
        var iid = typeof(IAudioEndpointVolume).GUID; object o;
        d.Activate(ref iid, 23, IntPtr.Zero, out o);
        var vol = (IAudioEndpointVolume)o;
        float lvl; vol.GetMasterVolumeLevelScalar(out lvl);
        bool m; vol.GetMute(out m);
        yield return new KeyValuePair<Endpoint, IAudioEndpointVolume>(new Endpoint { flow = flow == 0 ? "playback" : "recording", name = name, id = id, volume = (int)Math.Round(lvl * 100), muted = m }, vol);
      }
    }
  }

  public static List<Endpoint> List(string match) {
    var r = new List<Endpoint>();
    foreach (var e in Each(match)) r.Add(e.Key);
    return r;
  }

  // Sets ONE thing on ONE endpoint (by id), then re-reads it.
  public static Endpoint Set(string id, int volume, int muted) {
    foreach (var e in Each(null)) {
      if (e.Key.id != id) continue;
      var ctx = Guid.Empty;
      if (volume >= 0) e.Value.SetMasterVolumeLevelScalar(Math.Min(100, volume) / 100f, ref ctx);
      if (muted >= 0) e.Value.SetMute(muted == 1, ref ctx);
      foreach (var a in Each(null)) if (a.Key.id == id) return a.Key;
    }
    throw new Exception("audio device not found");
  }
}
