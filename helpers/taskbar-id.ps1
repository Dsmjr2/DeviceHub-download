# One taskbar button for DeviceHub (Shawn, 13 Nov 2026: "why does device hub open in this way").
# DeviceHub's shortcuts run DeviceHub.vbs, which opens a Chrome (or Edge) app window. Windows groups a window under a
# pinned icon only when both carry the same app ID, and Chrome picks the window's ID itself from the page and the
# Chrome profile (here "Chrome.localhost_/.UserData.Profile1"), so the pinned icon and the window were two buttons.
# The launcher runs this, hidden, after it opens the window: it waits for the window, reads its app ID, and writes
# that ID onto DeviceHub's own shortcuts (desktop, Start menu, taskbar pin) when they differ. Next time, the window
# opens under the pinned icon. Only shortcuts that start DeviceHub.vbs are touched; nothing is written when they match.
# -Report only prints what it finds and writes nothing (for checks).
param([int]$WaitSeconds = 30, [switch]$Report)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class DhTaskbar {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PV v);

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out uint c); int GetAt(uint i, out PK k); int GetValue(ref PK k, out PV v); int SetValue(ref PK k, ref PV v); int Commit(); }
  [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPersistFile { int GetClassID(out Guid g); [PreserveSig] int IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint mode); void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool remember); void SaveCompleted(string f); void GetCurFile(out IntPtr f); }
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink { }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PK { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)] struct PV { public ushort vt; ushort a, b, c; public IntPtr p; IntPtr q; }

  static PK Key() { return new PK { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 }; }
  static Guid StoreIid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
  static string Read(IPropertyStore ps) {
    var k = Key(); PV v;
    if (ps.GetValue(ref k, out v) != 0) return "";
    string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    PropVariantClear(ref v);
    return s ?? "";
  }

  // The app ID of DeviceHub's window: a visible window titled "DeviceHub" or "<page> - DeviceHub" that has one, and is a
  // Chrome or Edge window (13 Nov 2026 bug hunt: a terminal tab named after the folder could have lent its own ID)
  static bool Browser(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { var n = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); return n == "chrome" || n == "msedge"; } catch { return false; }
  }
  public static string WindowId() {
    string found = "";
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      string title = t.ToString();
      if (title != "DeviceHub" && !title.EndsWith(" " + (char)183 + " DeviceHub")) return true;
      if (!Browser(h)) return true;
      var iid = StoreIid; IPropertyStore ps;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0) return true;
      string id = Read(ps);
      Marshal.ReleaseComObject(ps);
      if (id.Length == 0) return true;
      found = id; return false;
    }, IntPtr.Zero);
    return found;
  }

  public static string LinkId(string path) {
    object link = new ShellLink();
    try { ((IPersistFile)link).Load(path, 0); return Read((IPropertyStore)link); }
    finally { Marshal.ReleaseComObject(link); }
  }

  public static void SetLinkId(string path, string id) {
    object link = new ShellLink();
    try {
      ((IPersistFile)link).Load(path, 2); // STGM_READWRITE
      var ps = (IPropertyStore)link; var k = Key();
      var v = new PV { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
      try { Marshal.ThrowExceptionForHR(ps.SetValue(ref k, ref v)); Marshal.ThrowExceptionForHR(ps.Commit()); }
      finally { Marshal.FreeCoTaskMem(v.p); }
      ((IPersistFile)link).Save(path, true);
    } finally { Marshal.ReleaseComObject(link); }
  }
}
'@

$id = ''
$until = (Get-Date).AddSeconds($WaitSeconds)
do {
  $id = [DhTaskbar]::WindowId()
  if ($id) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $until)
if (-not $id) { Write-Output 'taskbar-id: no DeviceHub window with an app ID'; exit 0 }

$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeviceHub.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'DeviceHub.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\DeviceHub.lnk')
)
$sh = New-Object -ComObject WScript.Shell
foreach ($p in $links) {
  if (-not (Test-Path -LiteralPath $p)) { continue }
  # only DeviceHub's own shortcuts (they start DeviceHub.vbs), never another program's that happens to share the name
  $l = $sh.CreateShortcut($p)
  if ($l.Arguments -notmatch 'DeviceHub\.vbs') { continue }
  $now = [DhTaskbar]::LinkId($p)
  if ($now -eq $id) { Write-Output "taskbar-id: $p already $id"; continue }
  if ($Report) { Write-Output "taskbar-id: $p is '$now', window is $id (not written: -Report)"; continue }
  [DhTaskbar]::SetLinkId($p, $id)
  Write-Output "taskbar-id: $p set to $id (was '$now')"
}
