// Webcam picture settings (20 Oct 2026): the standard UVC controls every webcam driver exposes through DirectShow
// (Windows' own; nothing installed): brightness, contrast, saturation, sharpness, white balance, backlight
// compensation, gain, and zoom, focus and exposure. Reads every control's range and value, sets ONE at a time and
// reads it back. Nothing else is sent (no firmware, no extension units, no vendor commands). The values are the
// camera driver's; Windows' Camera settings page shows the same ones.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class Cameras {
  [ComImport, Guid("29840822-5B84-11D0-BD3B-00A0C911CE86"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ICreateDevEnum { [PreserveSig] int CreateClassEnumerator([In] ref Guid cat, out IEnumMoniker e, int flags); }
  [ComImport, Guid("55272A00-42CB-11CE-8135-00AA004BB851"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyBag { [PreserveSig] int Read([MarshalAs(UnmanagedType.LPWStr)] string name, out object val, IntPtr log); [PreserveSig] int Write(string name, ref object val); }
  // IAMVideoProcAmp and IAMCameraControl have the same three methods in the same order
  [ComImport, Guid("C6E13360-30AC-11d0-A18C-00A0C9118956"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAMVideoProcAmp { [PreserveSig] int GetRange(int p, out int min, out int max, out int step, out int def, out int caps); [PreserveSig] int Set(int p, int v, int flags); [PreserveSig] int Get(int p, out int v, out int flags); }
  [ComImport, Guid("C6E13370-30AC-11d0-A18C-00A0C9118956"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAMCameraControl { [PreserveSig] int GetRange(int p, out int min, out int max, out int step, out int def, out int caps); [PreserveSig] int Set(int p, int v, int flags); [PreserveSig] int Get(int p, out int v, out int flags); }

  static readonly Guid SystemDeviceEnum = new Guid("62BE5D10-60EB-11d0-BD3B-00A0C911CE86");
  static readonly Guid VideoInputCategory = new Guid("860BB310-5D01-11d0-BD3B-00A0C911CE86");
  static Guid IID_IPropertyBag = new Guid("55272A00-42CB-11CE-8135-00AA004BB851");
  static Guid IID_IBaseFilter = new Guid("56A86895-0AD4-11CE-B03A-0020AF0BA770");
  // key, interface (0 = picture / VideoProcAmp, 1 = lens / CameraControl), property number
  static readonly object[][] CONTROLS = {
    new object[] { "brightness", 0, 0 }, new object[] { "contrast", 0, 1 }, new object[] { "saturation", 0, 3 }, new object[] { "sharpness", 0, 4 },
    new object[] { "gamma", 0, 5 }, new object[] { "whiteBalance", 0, 7 }, new object[] { "backlight", 0, 8 }, new object[] { "gain", 0, 9 },
    new object[] { "zoom", 1, 3 }, new object[] { "exposure", 1, 4 }, new object[] { "focus", 1, 6 },
  };
  const int AUTO = 1, MANUAL = 2;

  // every video input: its name, device path and each control it has
  static List<KeyValuePair<string, object>> Open() {
    var list = new List<KeyValuePair<string, object>>();
    var t = Type.GetTypeFromCLSID(SystemDeviceEnum);
    var de = (ICreateDevEnum)Activator.CreateInstance(t);
    try {
      IEnumMoniker em; var cat = VideoInputCategory;
      if (de.CreateClassEnumerator(ref cat, out em, 0) != 0 || em == null) return list;
      var one = new IMoniker[1];
      var seen = new HashSet<string>();
      try {
        while (em.Next(1, one, IntPtr.Zero) == 0) {
          var m = one[0];
          try {
            // the moniker is its own property bag (one COM object): read the name and path, then bind only a camera
            // not bound before (20 Oct 2026: binding on every read left ~21 handles behind each time)
            object bagObj; m.BindToStorage(null, null, ref IID_IPropertyBag, out bagObj);
            var bag = (IPropertyBag)bagObj; object name = null, devPath = null;
            bag.Read("FriendlyName", out name, IntPtr.Zero); bag.Read("DevicePath", out devPath, IntPtr.Zero);
            var key = (name as string ?? "Camera") + "|" + (devPath as string ?? "");
            seen.Add(key);
            object filter;
            // a camera that will not open (a virtual camera, a broken driver) is skipped; the others still show
            if (!bound.TryGetValue(key, out filter)) { try { m.BindToObject(null, null, ref IID_IBaseFilter, out filter); } catch { continue; } if (filter == null) continue; bound[key] = filter; }
            list.Add(new KeyValuePair<string, object>(key, filter));
          } finally { Marshal.FinalReleaseComObject(m); }
        }
      } finally { Marshal.FinalReleaseComObject(em); }
      // cameras unplugged since: let them go
      foreach (var k in new List<string>(bound.Keys)) if (!seen.Contains(k)) Drop(k);
    } finally { Marshal.FinalReleaseComObject(de); }
    return list;
  }
  // the cameras bound so far, kept while in use (a page open, a slider moving) and let go after 30 s without a call,
  // when unplugged, or when a call on one fails, so DeviceHub never holds a camera another app wants
  static readonly Dictionary<string, object> bound = new Dictionary<string, object>();
  static DateTime lastUse = DateTime.MinValue;
  static System.Threading.Timer idle;
  static void Drop(string key) { object f; if (bound.TryGetValue(key, out f)) { bound.Remove(key); try { Marshal.FinalReleaseComObject(f); } catch { } } }
  static void Close(List<KeyValuePair<string, object>> list) {
    lastUse = DateTime.UtcNow;
    if (idle == null) idle = new System.Threading.Timer(_ => { lock (bound) { if (bound.Count > 0 && (DateTime.UtcNow - lastUse).TotalSeconds > 30) foreach (var k in new List<string>(bound.Keys)) Drop(k); } }, null, 15000, 15000);
  }

  static Dictionary<string, object> Read(object filter) {
    var o = new Dictionary<string, object>();
    var amp = filter as IAMVideoProcAmp; var cam = filter as IAMCameraControl;
    foreach (var c in CONTROLS) {
      int min, max, step, def, caps, v, flags, hr;
      if ((int)c[1] == 0) { if (amp == null) continue; hr = amp.GetRange((int)c[2], out min, out max, out step, out def, out caps); if (hr != 0) continue; if (amp.Get((int)c[2], out v, out flags) != 0) continue; }
      else { if (cam == null) continue; hr = cam.GetRange((int)c[2], out min, out max, out step, out def, out caps); if (hr != 0) continue; if (cam.Get((int)c[2], out v, out flags) != 0) continue; }
      if (max <= min) continue;
      o[(string)c[0]] = new Dictionary<string, object> { { "value", v }, { "min", min }, { "max", max }, { "step", step }, { "default", def }, { "canAuto", (caps & AUTO) != 0 }, { "auto", (flags & AUTO) != 0 } };
    }
    return o;
  }

  // one call at a time (the idle timer runs on another thread); a call that fails lets every camera go, so the next
  // one binds afresh (an unplugged and replugged camera keeps its path)
  public static List<object> List() { lock (bound) { try { return ListLocked(); } catch { foreach (var k in new List<string>(bound.Keys)) Drop(k); throw; } } }
  public static Dictionary<string, object> Set(string path, string key, int value, bool auto) { lock (bound) { try { return SetLocked(path, key, value, auto); } catch { foreach (var k in new List<string>(bound.Keys)) Drop(k); throw; } } }

  static List<object> ListLocked() {
    var outList = new List<object>();
    var cams = Open();
    try {
      foreach (var kv in cams) {
        var parts = kv.Key.Split(new[] { '|' }, 2);
        outList.Add(new Dictionary<string, object> { { "name", parts[0] }, { "path", parts[1] }, { "controls", Read(kv.Value) } });
      }
    } finally { Close(cams); }
    return outList;
  }

  // ONE control: a value (manual) or auto on/off; then read back
  static Dictionary<string, object> SetLocked(string path, string key, int value, bool auto) {
    object[] ctl = null;
    foreach (var c in CONTROLS) if ((string)c[0] == key) ctl = c;
    if (ctl == null) throw new Exception("unknown control " + key);
    var cams = Open();
    try {
      foreach (var kv in cams) {
        if (kv.Key.Split(new[] { '|' }, 2)[1] != path) continue;
        int hr;
        if ((int)ctl[1] == 0) { var amp = kv.Value as IAMVideoProcAmp; if (amp == null) throw new Exception("no picture controls"); hr = amp.Set((int)ctl[2], value, auto ? AUTO : MANUAL); }
        else { var cam = kv.Value as IAMCameraControl; if (cam == null) throw new Exception("no lens controls"); hr = cam.Set((int)ctl[2], value, auto ? AUTO : MANUAL); }
        if (hr != 0) throw new Exception("the camera refused " + key + " (0x" + hr.ToString("X8") + ")");
        var after = Read(kv.Value);
        return new Dictionary<string, object> { { "controls", after } };
      }
    } finally { Close(cams); }
    throw new Exception("camera not found");
  }
}
