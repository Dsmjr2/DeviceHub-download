# Moves a window onto the Acer monitor and centers it there (20 Oct 2026, Shawn: "pop ups ... on the acer monitor
# not the agon"). Waits up to -Wait seconds for a visible window whose title contains -Title. The Acer is found by its
# model through DeviceHub's own monitor list (helpers/monitors.js); without DeviceHub, the first screen that is not the
# main one. Windows' admin (UAC) prompts cannot be moved by any program.
param([Parameter(Mandatory)][string]$Title, [int]$Wait = 20, [string]$Model = 'VG272UV')
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class MoveWin {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  public static List<IntPtr> Find(string part) { var r = new List<IntPtr>(); EnumWindows((h, l) => { if (IsWindowVisible(h)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); if (s.ToString().IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) r.Add(h); } return true; }, IntPtr.Zero); return r; }
}
'@
$screenName = $null
try { $m = Invoke-RestMethod http://127.0.0.1:5577/api/monitors -TimeoutSec 5; $screenName = ($m | Where-Object { $_.model -match $Model } | Select-Object -First 1).screen } catch {}
$screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.DeviceName -eq $screenName } | Select-Object -First 1
if (-not $screen) { $screen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1 }
if (-not $screen) { 'only one screen: nothing to move'; exit 0 }
$moved = 0
for ($i = 0; $i -lt $Wait * 4 -and -not $moved; $i++) {
  foreach ($h in [MoveWin]::Find($Title)) {
    $r = New-Object MoveWin+R; [void][MoveWin]::GetWindowRect($h, [ref]$r)
    $w = $r.Rt - $r.L; $hgt = $r.B - $r.T; $a = $screen.WorkingArea
    $x = $a.X + [math]::Max(0, [int](($a.Width - $w) / 2)); $y = $a.Y + [math]::Max(0, [int](($a.Height - $hgt) / 2))
    [void][MoveWin]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, 0, 0, 0x0001 -bor 0x0004)   # keep size and z-order
    $moved++
  }
  if (-not $moved) { Start-Sleep -Milliseconds 250 }
}
if ($moved) { "moved $moved window(s) to $($screen.DeviceName)" } else { "no window with ""$Title"" in its title appeared" }
