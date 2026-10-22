# Read-only: standard (no per-device learning) battery sources, printed as one JSON object.
#   -Mode bt   Bluetooth: Windows' own battery level property on every paired Bluetooth device node
#              ({104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2, a byte 0-100), with its VID/PID and whether it is connected.
#   -Mode hid  USB / 2.4 GHz / Bluetooth HID: which present HID collections DECLARE a standard battery usage
#              (Battery System page 0x85, Generic Device Controls 0x06 Battery Strength 0x20), in which report
#              (input or feature), report id, bit size, logical range and the exact bit position in the report.
#   -Mode all  both.
# Nothing is sent to any device: Bluetooth values come from Windows' device properties; HID collections are opened with
# access 0 (query only, as helpers\hid-caps.ps1 does) to read Windows' parsed descriptor. The bit position is found by
# HidP_SetUsageValue / HidP_SetUsages into a zeroed buffer in this process's memory (hid.dll's own report layout), never
# sent anywhere. See helpers\std-battery.js for the sources this follows.
param([ValidateSet('bt', 'hid', 'all')][string]$Mode = 'all')
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8   # names like "Shawn's AirPods" carry a curly apostrophe
$out = [ordered]@{ bt = $null; hid = $null }

if ($Mode -ne 'hid') {
  $BATTERY = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
  $CONNECTED = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'   # the same connected flag helpers\pc-map.js reads
  $pnp = @(Get-PnpDevice)
  $all = @($pnp | Where-Object { $_.InstanceId -match '^(BTHLE|BTHENUM)\\DEV_[0-9A-F]{12}' })
  # children carry the vendor/product id (BTHLEDEVICE\{svc}_DEV_VID&02045E_PID&0B13_..._<addr>\...,
  # BTHENUM\{svc}_VID&0001004C_PID&2014\..._<addr>_C...) and on some devices the battery level itself
  $kids = @($pnp | Where-Object { $_.InstanceId -match '^(BTHLEDEVICE|BTHENUM)\\\{' })
  $props = @{}
  if ($all.Count) {
    @($all + $kids) | Get-PnpDeviceProperty -KeyName $BATTERY, $CONNECTED, 'DEVPKEY_Bluetooth_LastConnectedTime' | ForEach-Object {
      if ($null -eq $_.Data) { return }
      if (-not $props[$_.InstanceId]) { $props[$_.InstanceId] = @{} }
      $props[$_.InstanceId][$_.KeyName] = $_.Data
    }
  }
  $out.bt = @($all | ForEach-Object {
    $p = $props[$_.InstanceId]; if (-not $p) { $p = @{} }
    $addr = ([regex]::Match($_.InstanceId, 'DEV_([0-9A-F]{12})')).Groups[1].Value
    $mine = @($kids | Where-Object { $_.InstanceId -match $addr })
    $ids = [string](@($mine | Where-Object { $_.InstanceId -match 'VID&[0-9A-F]{6}' } | ForEach-Object { $_.InstanceId }) | Select-Object -First 1)
    $bat = $p[$BATTERY]
    if ($null -eq $bat) { foreach ($k in $mine) { $kp = $props[$k.InstanceId]; if ($kp -and $null -ne $kp[$BATTERY]) { $bat = $kp[$BATTERY]; break } } }
    $lc = $p['DEVPKEY_Bluetooth_LastConnectedTime']
    [ordered]@{
      instanceId = $_.InstanceId; name = $_.FriendlyName; status = [string]$_.Status
      connected = $(if ($null -ne $p[$CONNECTED]) { [bool]$p[$CONNECTED] } else { $_.Status -eq 'OK' })
      battery = $bat; address = $addr; ids = $ids
      lastConnected = $(if ($lc) { ([datetime]$lc).ToUniversalTime().ToString('o') } else { $null })
    }
  })
}

if ($Mode -ne 'bt') {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class StdBatt {
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
  [DllImport("hid.dll")] public static extern int HidP_SetUsageValue(int type, ushort page, ushort link, ushort usage, uint value, IntPtr pp, byte[] report, uint len);
  [DllImport("hid.dll")] public static extern int HidP_SetUsages(int type, ushort page, ushort link, ushort[] usages, ref uint n, IntPtr pp, byte[] report, uint len);
  const int HIDP_STATUS_SUCCESS = 0x00110000;

  // the standard battery usages: page 0x85 Battery System, page 0x06 Generic Device Controls
  static bool Wanted(ushort page, ushort usage) {
    if (page == 0x06) return usage == 0x20;                      // Battery Strength
    if (page == 0x85) return usage == 0x44 || usage == 0x45 ||   // Charging, Discharging
      usage == 0x64 || usage == 0x65 || usage == 0x66 ||         // RelativeStateOfCharge, AbsoluteStateOfCharge, RemainingCapacity
      usage == 0x67 || usage == 0x68 || usage == 0x83 ||         // FullChargeCapacity, RunTimeToEmpty, DesignCapacity
      usage == 0x2C || usage == 0xD0;                            // CapacityMode, ACPresent
    return false;
  }

  // Where HidP would put this usage in a report: set it to all ones in a zeroed buffer (memory only) and see which bits moved.
  static int[] Locate(IntPtr pp, int type, ushort page, ushort link, ushort usage, byte rid, int bits, bool button, int len) {
    var buf = new byte[len]; buf[0] = rid;
    int st;
    if (button) { uint n = 1; st = HidP_SetUsages(type, page, link, new ushort[] { usage }, ref n, pp, buf, (uint)len); }
    else st = HidP_SetUsageValue(type, page, link, usage, bits >= 32 ? 0xFFFFFFFFu : (uint)((1L << bits) - 1), pp, buf, (uint)len);
    if (st != HIDP_STATUS_SUCCESS) return null;
    int first = -1, last = -1;
    for (int i = 8; i < len * 8; i++) if ((buf[i >> 3] & (1 << (i & 7))) != 0) { if (first < 0) first = i; last = i; }
    return first < 0 ? null : new int[] { first, last - first + 1 };
  }

  public static List<Dictionary<string, object>> Scan(string path) {
    var found = new List<Dictionary<string, object>>();
    IntPtr h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);   // access 0: query only, no read or write
    if (h == new IntPtr(-1)) return null;
    IntPtr pp;
    if (!HidD_GetPreparsedData(h, out pp)) { CloseHandle(h); return null; }
    try {
      CAPS c; HidP_GetCaps(pp, out c);
      int[] types = { 0, 2 };   // HidP_Input, HidP_Feature (output reports are never read)
      foreach (int type in types) {
        int len = type == 0 ? c.InputReportByteLength : c.FeatureReportByteLength;
        ushort nv = type == 0 ? c.NumberInputValueCaps : c.NumberFeatureValueCaps;
        ushort nb = type == 0 ? c.NumberInputButtonCaps : c.NumberFeatureButtonCaps;
        for (int pass = 0; pass < 2; pass++) {
          ushort n = pass == 0 ? nv : nb; if (n == 0) continue;
          var b = new byte[72 * n];
          if (pass == 0) HidP_GetValueCaps(type, b, ref n, pp); else HidP_GetButtonCaps(type, b, ref n, pp);
          for (int i = 0; i < n; i++) {
            int o = i * 72;
            ushort page = BitConverter.ToUInt16(b, o), link = BitConverter.ToUInt16(b, o + 6);
            byte rid = b[o + 2]; bool isRange = b[o + 12] != 0;
            ushort umin = BitConverter.ToUInt16(b, o + 56), umax = isRange ? BitConverter.ToUInt16(b, o + 58) : umin;
            for (int u = umin; u <= umax && u - umin < 64; u++) {
              if (!Wanted(page, (ushort)u)) continue;
              var d = new Dictionary<string, object>();
              d["report"] = type == 0 ? "input" : "feature"; d["reportId"] = (int)rid; d["reportLength"] = len;
              d["usagePage"] = (int)page; d["usage"] = u; d["button"] = pass == 1; d["linkCollection"] = (int)link;
              int bits = 1;
              if (pass == 0) {
                bits = BitConverter.ToUInt16(b, o + 18);
                d["bitSize"] = bits; d["reportCount"] = (int)BitConverter.ToUInt16(b, o + 20);
                d["logicalMin"] = BitConverter.ToInt32(b, o + 40); d["logicalMax"] = BitConverter.ToInt32(b, o + 44);
                d["units"] = BitConverter.ToUInt32(b, o + 36); d["unitExp"] = BitConverter.ToUInt32(b, o + 32);
              } else { d["bitSize"] = 1; d["reportCount"] = 1; d["logicalMin"] = 0; d["logicalMax"] = 1; }
              // main-item flags (BitField): bit 1 set = Variable; clear = an Array (a list of usage indexes, not a value)
              bool variable = (BitConverter.ToUInt16(b, o + 4) & 0x02) != 0;
              d["array"] = !variable;
              var at = variable ? Locate(pp, type, page, link, (ushort)u, rid, bits, pass == 1, len) : null;
              if (at != null) { d["bitOffset"] = at[0]; d["bitLength"] = at[1]; }
              found.Add(d);
            }
          }
        }
      }
      var top = new Dictionary<string, object>();
      top["topUsagePage"] = (int)c.UsagePage; top["topUsage"] = (int)c.Usage;
      top["inLen"] = (int)c.InputReportByteLength; top["featLen"] = (int)c.FeatureReportByteLength;
      found.Insert(0, top);
    } finally { HidD_FreePreparsedData(pp); CloseHandle(h); }
    return found;
  }
}
'@
  $guid = '{4d1e55b2-f16f-11cf-88cb-001111000030}'
  $scanned = 0
  $list = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^HID\\' } | ForEach-Object {
    $path = '\\?\' + ($_.InstanceId -replace '\\', '#') + '#' + $guid
    $r = [StdBatt]::Scan($path)
    if ($null -eq $r) { return }
    $script:scanned++
    if ($r.Count -lt 2) { return }   # opened, nothing standard declared
    $top = $r[0]
    [ordered]@{
      instanceId = $_.InstanceId; name = $_.FriendlyName
      topUsagePage = $top['topUsagePage']; topUsage = $top['topUsage']; inLen = $top['inLen']; featLen = $top['featLen']
      fields = @($r | Select-Object -Skip 1 | ForEach-Object { [pscustomobject]$_ })
    }
  })
  $out.hid = [ordered]@{ scanned = $scanned; collections = $list }
}

$out | ConvertTo-Json -Depth 6 -Compress
