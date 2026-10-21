# Read-only: report lengths of each vendor HID collection, from Windows' parsed descriptor.
# Opens each collection with access 0 (query only); sends nothing to the device.
param([string]$Vid = '3710')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HidCaps {
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
  // Report ids used by each report type (0 input, 1 output, 2 feature). ReportID is byte 2 of each 72-byte caps entry.
  public static string Ids(IntPtr pp, int type, ushort nValue, ushort nButton) {
    var ids = new System.Collections.Generic.SortedSet<int>();
    if (nValue > 0) { var b = new byte[72 * nValue]; ushort n = nValue; HidP_GetValueCaps(type, b, ref n, pp); for (int i = 0; i < n; i++) ids.Add(b[i * 72 + 2]); }
    if (nButton > 0) { var b = new byte[72 * nButton]; ushort n = nButton; HidP_GetButtonCaps(type, b, ref n, pp); for (int i = 0; i < n; i++) ids.Add(b[i * 72 + 2]); }
    return string.Join(",", ids);
  }
}
'@
$guid = '{4d1e55b2-f16f-11cf-88cb-001111000030}'
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match "^HID\\VID_$Vid" } | ForEach-Object {
  $path = '\\?\' + ($_.InstanceId -replace '\\', '#') + '#' + $guid
  $h = [HidCaps]::CreateFile($path, 0, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
  if ($h -eq [IntPtr]-1) { return }
  $pp = [IntPtr]::Zero
  if ([HidCaps]::HidD_GetPreparsedData($h, [ref]$pp)) {
    $c = New-Object HidCaps+CAPS
    [void][HidCaps]::HidP_GetCaps($pp, [ref]$c)
    [pscustomobject]@{
      Page = '{0:X4}/{1:X2}' -f $c.UsagePage, $c.Usage
      InLen = $c.InputReportByteLength; OutLen = $c.OutputReportByteLength; FeatLen = $c.FeatureReportByteLength
      InIds = [HidCaps]::Ids($pp, 0, $c.NumberInputValueCaps, $c.NumberInputButtonCaps)
      OutIds = [HidCaps]::Ids($pp, 1, $c.NumberOutputValueCaps, $c.NumberOutputButtonCaps)
      FeatIds = [HidCaps]::Ids($pp, 2, $c.NumberFeatureValueCaps, $c.NumberFeatureButtonCaps)
    }
    [void][HidCaps]::HidD_FreePreparsedData($pp)
  }
  [void][HidCaps]::CloseHandle($h)
} | Format-Table -AutoSize | Out-String -Width 200
