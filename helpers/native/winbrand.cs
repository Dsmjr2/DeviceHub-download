// Taskbar identity for the DeviceHub window (19 Oct 2026, Shawn: the taskbar icon was not high definition).
// DeviceHub's window is a Chrome app window, and the taskbar showed Chrome's small page icon scaled up. This gives that
// window its own app identity (AppUserModelID "DeviceHub") with DeviceHub.ico as its icon, so Windows draws the
// taskbar button from the .ico's real 16-256 px images and keeps DeviceHub as its own button, not grouped with Chrome.
// It also sets the window's big and small icons from the same file. Nothing else about the window is touched.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

static class WinBrand {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr inst, string name, uint type, int cx, int cy, uint load);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);

  [StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public uint pid; public PropertyKey(Guid g, uint p) { fmtid = g; pid = p; } }
  [StructLayout(LayoutKind.Explicit)] struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint n);
    [PreserveSig] int GetAt(uint i, out PropertyKey k);
    [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
    [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
    [PreserveSig] int Commit();
  }

  static readonly Guid AUMI = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  const uint WM_SETICON = 0x80, IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10, GW_OWNER = 4;
  static readonly HashSet<IntPtr> done = new HashSet<IntPtr>();
  static IntPtr bigIcon = IntPtr.Zero, smallIcon = IntPtr.Zero;

  static void Set(IPropertyStore ps, uint pid, string value) {
    var k = new PropertyKey(AUMI, pid);
    var v = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(value) };  // VT_LPWSTR
    ps.SetValue(ref k, ref v);
    PropVariantClear(ref v);
  }

  // BRAND <ico path>|<relaunch command>: brands every visible top-level Chrome window titled "DeviceHub" or
  // "... · DeviceHub" not branded yet. Returns how many windows it branded now ("0" when there was nothing new).
  public static string Brand(string ico, string relaunch) {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (!cls.ToString().StartsWith("Chrome_WidgetWin")) return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      var title = t.ToString();
      if (title == "DeviceHub" || title.EndsWith(" · DeviceHub")) found.Add(h);
      return true;
    }, IntPtr.Zero);
    int n = 0;
    // the icons are loaded once and kept (19 Oct 2026: loading them on every 5 s look leaked ~18 GDI handles every
    // 15 s, which would have stopped the helper at Windows' 10,000-handle limit in a few hours)
    if (bigIcon == IntPtr.Zero) bigIcon = LoadImage(IntPtr.Zero, ico, IMAGE_ICON, GetSystemMetrics(11), GetSystemMetrics(12), LR_LOADFROMFILE);
    if (smallIcon == IntPtr.Zero) smallIcon = LoadImage(IntPtr.Zero, ico, IMAGE_ICON, GetSystemMetrics(49), GetSystemMetrics(50), LR_LOADFROMFILE);
    foreach (var h in found) {
      if (done.Contains(h)) continue;
      // the window's own icons, big and small, at the sizes Windows asks for; set once per window
      if (bigIcon != IntPtr.Zero) SendMessage(h, WM_SETICON, (IntPtr)1, bigIcon);
      if (smallIcon != IntPtr.Zero) SendMessage(h, WM_SETICON, IntPtr.Zero, smallIcon);
      var iid = typeof(IPropertyStore).GUID;
      IPropertyStore ps;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0 || ps == null) continue;
      // AppUserModel.ID: "DeviceHub.<icon hash>" when the icon is the content-named copy (icons-cache\DeviceHub-<hash>.ico).
      // The taskbar remembers an identity's icon, so a new icon under the old identity kept showing the old picture
      // (19 Oct 2026: the D stayed after the change to Port); a new icon now means a new identity.
      var m = System.Text.RegularExpressions.Regex.Match(System.IO.Path.GetFileName(ico), @"^DeviceHub-([0-9a-f]+)\.ico$");
      Set(ps, 5, m.Success ? "DeviceHub." + m.Groups[1].Value : "DeviceHub");
      Set(ps, 3, ico + ",0");                        // RelaunchIconResource: the taskbar button's icon
      Set(ps, 4, "DeviceHub");                       // RelaunchDisplayNameResource
      Set(ps, 2, relaunch);                          // RelaunchCommand (pinning starts DeviceHub's own launcher)
      ps.Commit();
      Marshal.ReleaseComObject(ps);
      done.Add(h); n++;
    }
    return n.ToString();
  }
}
