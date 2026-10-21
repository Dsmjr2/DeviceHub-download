// Windows audio topology: the volume and mute controls inside a USB audio device (its "feature units"), which
// Windows exposes to every program. The HS80's sidetone level is one of them (unit 6, -42..+4 dB, measured from
// iCUE's own USB messages 18 Oct 2026). Plain Windows APIs (MMDevice + DeviceTopology); nothing installed.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class AudioTopology {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint count); [PreserveSig] int Item(uint index, out IMMDevice device); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDeviceTopology {
    [PreserveSig] int GetConnectorCount(out uint n);
    [PreserveSig] int GetConnector(uint i, out IConnector c);
    [PreserveSig] int GetSubunitCount(out uint n);
    [PreserveSig] int GetSubunit(uint i, [MarshalAs(UnmanagedType.IUnknown)] out object s);
    [PreserveSig] int GetPartById(uint id, out IPart p);
    [PreserveSig] int GetDeviceId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport, Guid("9c2c4058-23f5-41de-877a-df3af236a09e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IConnector {
    [PreserveSig] int GetType(out int t);
    [PreserveSig] int GetDataFlow(out int f);
    [PreserveSig] int ConnectTo(IConnector c);
    [PreserveSig] int Disconnect();
    [PreserveSig] int IsConnected([MarshalAs(UnmanagedType.Bool)] out bool b);
    [PreserveSig] int GetConnectedTo(out IConnector c);
  }
  [ComImport, Guid("AE2DE0E4-5BCA-4F2D-AA46-5D13F8FDB3A9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPart {
    [PreserveSig] int GetName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int GetLocalId(out uint id);
    [PreserveSig] int GetGlobalId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetPartType(out int t);
    [PreserveSig] int GetSubType(out Guid g);
    [PreserveSig] int GetControlInterfaceCount(out uint n);
    [PreserveSig] int GetControlInterface(uint i, out IntPtr c);
    [PreserveSig] int EnumPartsIncoming(out IntPtr l);
    [PreserveSig] int EnumPartsOutgoing(out IntPtr l);
    [PreserveSig] int GetTopologyObject(out IDeviceTopology t);
    [PreserveSig] int Activate(int clsCtx, ref Guid iid, out IntPtr iface);
  }
  [ComImport, Guid("7FB7B48F-531D-44A2-BCB3-5AD5A134B3DC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioVolumeLevel {
    [PreserveSig] int GetChannelCount(out uint n);
    [PreserveSig] int GetLevelRange(uint ch, out float min, out float max, out float step);
    [PreserveSig] int GetLevel(uint ch, out float db);
    [PreserveSig] int SetLevel(uint ch, float db, ref Guid ctx);
    [PreserveSig] int SetLevelUniform(float db, ref Guid ctx);
  }
  [ComImport, Guid("DF45AEEA-B74A-4B6B-AFAD-2366B6AA012E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMute {
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }

  static Guid IID_Topology = new Guid("2A07407E-6497-4A18-9787-32F79BD0D98F");
  static Guid IID_Volume = new Guid("7FB7B48F-531D-44A2-BCB3-5AD5A134B3DC");
  static Guid IID_Mute = new Guid("DF45AEEA-B74A-4B6B-AFAD-2366B6AA012E");

  // The device-side topology (the USB audio device's own parts) behind every active endpoint whose device id
  // contains `match` (e.g. "VID_1B1C&PID_0A6B").
  static IEnumerable<IDeviceTopology> Devices(string match) {
    // by CLSID, not `new MMDeviceEnumerator()`: audio.cs declares the same COM class, and .NET hands back the RCW
    // typed as whichever class was made first ("cannot cast MMDeviceEnumerator to MMDeviceEnumerator")
    var e = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    var seen = new HashSet<string>();
    for (int flow = 0; flow < 2; flow++) {
      IMMDeviceCollection col; e.EnumAudioEndpoints(flow, 1, out col);
      uint n; col.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        object o; if (d.Activate(ref IID_Topology, 23, IntPtr.Zero, out o) != 0) continue;
        var t = (IDeviceTopology)o;
        IConnector c; if (t.GetConnector(0, out c) != 0) continue;
        IConnector other; if (c.GetConnectedTo(out other) != 0) continue;
        IDeviceTopology dt; if (((IPart)other).GetTopologyObject(out dt) != 0) continue;
        string id; dt.GetDeviceId(out id);
        if (id == null || id.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0 || !seen.Add(id)) continue;
        yield return dt;
      }
    }
  }

  // Every volume / mute control: "<device>|<unit id>|<name>|volume|<min>|<max>|<step>|<level>" or "...|mute|<0/1>".
  public static string[] List(string match) {
    var r = new List<string>();
    foreach (var dt in Devices(match)) {
      string dev; dt.GetDeviceId(out dev);
      uint n; dt.GetSubunitCount(out n);
      for (uint i = 0; i < n; i++) {
        object s; if (dt.GetSubunit(i, out s) != 0) continue;
        var p = (IPart)s;
        string name; p.GetName(out name); uint lid; p.GetLocalId(out lid);
        IntPtr o;
        if (p.Activate(23, ref IID_Volume, out o) == 0) {
          var v = (IAudioVolumeLevel)Marshal.GetObjectForIUnknown(o); Marshal.Release(o); float mn, mx, st, lv;
          v.GetLevelRange(0, out mn, out mx, out st); v.GetLevel(0, out lv);
          r.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}|{1}|{2}|volume|{3}|{4}|{5}|{6}", dev, lid, name, mn, mx, st, lv));
        }
        if (p.Activate(23, ref IID_Mute, out o) == 0) {
          bool m; var mu = (IAudioMute)Marshal.GetObjectForIUnknown(o); Marshal.Release(o); mu.GetMute(out m);
          r.Add(string.Format("{0}|{1}|{2}|mute|{3}", dev, lid, name, m ? 1 : 0));
        }
      }
    }
    return r.ToArray();
  }

  static T Control<T>(string match, uint unit, Guid iid) where T : class {
    foreach (var dt in Devices(match)) {
      IPart p; if (dt.GetPartById(unit, out p) != 0) continue;
      IntPtr o; if (p.Activate(23, ref iid, out o) == 0) { var r = (T)Marshal.GetObjectForIUnknown(o); Marshal.Release(o); return r; }
    }
    return null;
  }

  // Sets one unit's level (dB, all channels) and returns what it reads back.
  public static float SetLevel(string match, uint unit, float db) {
    var v = Control<IAudioVolumeLevel>(match, unit, IID_Volume);
    if (v == null) throw new Exception("no volume control " + unit);
    var ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(v.SetLevelUniform(db, ref ctx));
    float lv; v.GetLevel(0, out lv); return lv;
  }

  public static bool SetMute(string match, uint unit, bool mute) {
    var m = Control<IAudioMute>(match, unit, IID_Mute);
    if (m == null) throw new Exception("no mute control " + unit);
    var ctx = Guid.Empty;
    Marshal.ThrowExceptionForHR(m.SetMute(mute, ref ctx));
    bool b; m.GetMute(out b); return b;
  }
}
