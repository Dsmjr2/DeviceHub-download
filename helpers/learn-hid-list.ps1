# The learning wizard's device list (22 Oct 2026; helpers/learn-wizard.mjs): every present HID collection, printed as
# one JSON object. Read-only: each collection is opened with access 0 (query only, as helpers\hid-caps.ps1 does) to
# read Windows' parsed descriptor and the product name. Nothing is sent to any device. The instance id is NOT printed
# (it can carry a serial number); only vendor id, product id, interface and collection numbers.
#   powershell -NoProfile -ExecutionPolicy Bypass -File helpers\learn-hid-list.ps1
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LearnHid {
  [StructLayout(LayoutKind.Sequential)] public struct CAPS {
    public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
      NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices,
      NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
  }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("hid.dll")] public static extern bool HidD_GetPreparsedData(IntPtr h, out IntPtr pp);
  [DllImport("hid.dll")] public static extern bool HidD_FreePreparsedData(IntPtr pp);
  [DllImport("hid.dll")] public static extern int HidP_GetCaps(IntPtr pp, out CAPS caps);
  [DllImport("hid.dll")] public static extern int HidP_GetValueCaps(int type, [Out] byte[] caps, ref ushort len, IntPtr pp);
  [DllImport("hid.dll")] public static extern int HidP_GetButtonCaps(int type, [Out] byte[] caps, ref ushort len, IntPtr pp);
  [DllImport("hid.dll")] public static extern bool HidD_GetProductString(IntPtr h, byte[] buf, int len);
  public static int[] Ids(IntPtr pp, int type, ushort nValue, ushort nButton) {
    var ids = new System.Collections.Generic.SortedSet<int>();
    if (nValue > 0) { var b = new byte[72 * nValue]; ushort n = nValue; HidP_GetValueCaps(type, b, ref n, pp); for (int i = 0; i < n; i++) ids.Add(b[i * 72 + 2]); }
    if (nButton > 0) { var b = new byte[72 * nButton]; ushort n = nButton; HidP_GetButtonCaps(type, b, ref n, pp); for (int i = 0; i < n; i++) ids.Add(b[i * 72 + 2]); }
    var a = new int[ids.Count]; ids.CopyTo(a); return a;
  }
  public static string Product(IntPtr h) {
    var buf = new byte[512];
    if (!HidD_GetProductString(h, buf, buf.Length)) return null;
    var s = Encoding.Unicode.GetString(buf); int z = s.IndexOf('\0'); return (z >= 0 ? s.Substring(0, z) : s).Trim();
  }
}
'@
$guid = '{4d1e55b2-f16f-11cf-88cb-001111000030}'
$cols = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^HID\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}' } | ForEach-Object {
  $id = $_.InstanceId
  $m = [regex]::Match($id, 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(&MI_([0-9A-F]{2}))?(&COL([0-9A-F]{2}))?', 'IgnoreCase')
  $path = '\\?\' + ($id -replace '\\', '#') + '#' + $guid
  $h = [LearnHid]::CreateFile($path, 0, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
  if ($h -eq [IntPtr]-1) { return }
  $pp = [IntPtr]::Zero
  $o = $null
  if ([LearnHid]::HidD_GetPreparsedData($h, [ref]$pp)) {
    $c = New-Object LearnHid+CAPS
    [void][LearnHid]::HidP_GetCaps($pp, [ref]$c)
    $o = [ordered]@{
      vid = $m.Groups[1].Value.ToUpper(); pid = $m.Groups[2].Value.ToUpper()
      iface = $(if ($m.Groups[4].Success) { [int]('0x' + $m.Groups[4].Value) } else { $null })
      col = $(if ($m.Groups[6].Success) { [int]('0x' + $m.Groups[6].Value) } else { $null })
      page = '{0:X4}' -f $c.UsagePage; usage = '{0:X4}' -f $c.Usage
      inLen = [int]$c.InputReportByteLength; outLen = [int]$c.OutputReportByteLength; featLen = [int]$c.FeatureReportByteLength
      inIds = @([LearnHid]::Ids($pp, 0, $c.NumberInputValueCaps, $c.NumberInputButtonCaps))
      outIds = @([LearnHid]::Ids($pp, 1, $c.NumberOutputValueCaps, $c.NumberOutputButtonCaps))
      featIds = @([LearnHid]::Ids($pp, 2, $c.NumberFeatureValueCaps, $c.NumberFeatureButtonCaps))
      product = [LearnHid]::Product($h)
      name = $_.FriendlyName
    }
    [void][LearnHid]::HidD_FreePreparsedData($pp)
  }
  [void][LearnHid]::CloseHandle($h)
  if ($o) { $o }
})
@{ collections = $cols } | ConvertTo-Json -Depth 4 -Compress
