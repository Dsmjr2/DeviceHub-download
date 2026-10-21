// Windows' default speaker / mic: list the endpoints of one USB device family and set which is the default, the same
// thing as picking the output or input in Windows' sound settings (all three roles: console, multimedia,
// communications). Plain Windows APIs; IPolicyConfig is the interface the Sound control panel itself uses.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class AudioDefault {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint n); [PreserveSig] int Item(uint i, out IMMDevice d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, out IntPtr o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore s);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out int state);
  }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out int c);
    [PreserveSig] int GetAt(int i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
  }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public long a; [FieldOffset(16)] public long b; }
  [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    [PreserveSig] int GetMixFormat(string id, IntPtr f);
    [PreserveSig] int GetDeviceFormat(string id, int d, IntPtr f);
    [PreserveSig] int ResetDeviceFormat(string id);
    [PreserveSig] int SetDeviceFormat(string id, IntPtr a, IntPtr b);
    [PreserveSig] int GetProcessingPeriod(string id, int d, IntPtr a, IntPtr b);
    [PreserveSig] int SetProcessingPeriod(string id, IntPtr p);
    [PreserveSig] int GetShareMode(string id, IntPtr m);
    [PreserveSig] int SetShareMode(string id, IntPtr m);
    [PreserveSig] int GetPropertyValue(string id, IntPtr k, IntPtr v);
    [PreserveSig] int SetPropertyValue(string id, IntPtr k, IntPtr v);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
  }

  static IMMDeviceEnumerator Enum() { return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))); }

  static string Str(IPropertyStore s, string fmt, int pid) {
    var k = new PROPERTYKEY { fmtid = new Guid(fmt), pid = pid }; PROPVARIANT v;
    if (s.GetValue(ref k, out v) != 0) return "";
    // copy the text, then free Windows' copy (19 Oct 2026: never freed, ~0.7 MB a minute with audio-follow's 2 s
    // look at every audio device)
    string r = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    PropVariantClear(ref v);
    return r;
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

  static uint U32(IPropertyStore s, string fmt, int pid) {
    var k = new PROPERTYKEY { fmtid = new Guid(fmt), pid = pid }; PROPVARIANT v;
    if (s.GetValue(ref k, out v) != 0) return 0;
    uint r = v.vt == 19 ? (uint)(v.a & 0xFFFFFFFF) : 0;
    PropVariantClear(ref v);
    return r;
  }

  // Every USB headset Windows has now (20 Oct 2026: any headset's sound features without knowing its maker): a USB
  // device with an active headphones or headset output (Windows' form factor 3 / 5) and an active mic. One entry per
  // USB vendor:product, with its sound devices.
  public static List<Dictionary<string, object>> Headsets() {
    var by = new Dictionary<string, Dictionary<string, object>>();
    var e = Enum();
    for (int flow = 0; flow < 2; flow++) {
      IMMDeviceCollection c; if (e.EnumAudioEndpoints(flow, 1, out c) != 0) continue;   // active ones only
      uint n; c.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; c.Item(i, out d);
        string id; d.GetId(out id);
        IPropertyStore s; if (d.OpenPropertyStore(0, out s) != 0) continue;
        var inst = Str(s, "b3f8fa53-0004-438e-9003-51a46e139bfc", 2);
        var m = System.Text.RegularExpressions.Regex.Match(inst, @"USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!m.Success) continue;
        var usb = ("VID_" + m.Groups[1].Value + "&PID_" + m.Groups[2].Value).ToUpperInvariant();
        Dictionary<string, object> h;
        if (!by.TryGetValue(usb, out h)) {
          h = new Dictionary<string, object> { { "usb", usb }, { "device", Str(s, "026e516e-b814-414b-83cd-856d6fef4822", 2) }, { "playback", new List<object>() }, { "recording", new List<object>() }, { "headphones", false } };
          by[usb] = h;
        }
        uint ff = U32(s, "1da5d803-d492-4edd-8c23-e0c0ffee7f0e", 0);
        if (flow == 0 && (ff == 3 || ff == 5)) h["headphones"] = true;
        ((List<object>)h[flow == 0 ? "playback" : "recording"]).Add(new Dictionary<string, object> { { "id", id }, { "name", Str(s, "a45c254e-df1c-4efd-8020-67d146a850e0", 2) }, { "formFactor", ff } });
      }
    }
    var r = new List<Dictionary<string, object>>();
    foreach (var h in by.Values) if ((bool)h["headphones"] && ((List<object>)h["recording"]).Count > 0) r.Add(h);
    return r;
  }

  // "flow|id|state|name|instance path" for every endpoint (any state) whose USB instance path contains `match`.
  public static string[] List(string match) {
    var r = new List<string>(); var e = Enum();
    for (int flow = 0; flow < 2; flow++) {
      IMMDeviceCollection c; if (e.EnumAudioEndpoints(flow, 0xF, out c) != 0) continue;
      uint n; c.GetCount(out n);
      for (uint i = 0; i < n; i++) {
        IMMDevice d; c.Item(i, out d);
        string id; d.GetId(out id); int st; d.GetState(out st);
        IPropertyStore s; if (d.OpenPropertyStore(0, out s) != 0) continue;
        var inst = Str(s, "b3f8fa53-0004-438e-9003-51a46e139bfc", 2);
        if (inst.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) continue;
        r.Add((flow == 0 ? "playback" : "recording") + "|" + id + "|" + st + "|" + Str(s, "a45c254e-df1c-4efd-8020-67d146a850e0", 2) + "|" + inst);
      }
    }
    return r.ToArray();
  }

  // The current default endpoint id for a flow (0 playback, 1 recording), console role.
  public static string Default(int flow) {
    IMMDevice d; if (Enum().GetDefaultAudioEndpoint(flow, 0, out d) != 0) return null;
    string id; d.GetId(out id); return id;
  }

  // Enables or disables one endpoint (Sound settings' "Disable" / "Enable"); returns its state after (1 active,
  // 2 disabled, 4 not present, 8 unplugged).
  public static int SetEnabled(string id, bool on) {
    var p = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")));
    Marshal.ThrowExceptionForHR(p.SetEndpointVisibility(id, on ? 1 : 0));
    var e = Enum(); IMMDeviceCollection c; e.EnumAudioEndpoints(0, 0xF, out c); // playback
    foreach (var flow in new[] { 0, 1 }) {
      e.EnumAudioEndpoints(flow, 0xF, out c); uint n; c.GetCount(out n);
      for (uint i = 0; i < n; i++) { IMMDevice d; c.Item(i, out d); string did; d.GetId(out did); if (did == id) { int st; d.GetState(out st); return st; } }
    }
    return -1;
  }

  // Makes one endpoint the default for all three roles, then reads the default back.
  public static string SetDefault(string id, int flow) {
    var p = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")));
    for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(p.SetDefaultEndpoint(id, role));
    return Default(flow);
  }
}
