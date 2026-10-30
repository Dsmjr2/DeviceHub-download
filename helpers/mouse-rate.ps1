# The exact polling rate (29 Oct 2026, Shawn: at 8K the page's test read only about 2400 Hz). A browser hands the page
# fewer mouse reports than arrive at high rates, so this counts them where Windows first gets them: raw input
# (WM_INPUT), every report of every mouse, on a hidden window that is never shown. It only listens: nothing is sent to
# any mouse. It waits up to -WaitSeconds for the mouse to move, then counts for -Seconds, and prints one line of JSON:
#   {"ok":true,"devices":[{"name":"...VID_3710&PID_5406...","reports":n,"movingMs":m,"hz":h}]}   (busiest first)
# A gap longer than 20 ms is a pause, not a slow report (public/core/polling-rate.js counts the same way).
param([ValidateRange(2, 10)][int]$Seconds = 5, [ValidateRange(5, 60)][int]$WaitSeconds = 20)
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
public class DhMouseRate : NativeWindow {
    [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort Page; public ushort Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] struct RawHeader { public uint Type; public uint Size; public IntPtr Device; public IntPtr WParam; }
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RawDevice[] d, uint n, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr h, uint cmd, out RawHeader data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint GetRawInputDeviceInfo(IntPtr dev, uint cmd, StringBuilder data, ref uint size);
    const int WM_INPUT = 0x00FF;
    const uint RID_HEADER = 0x10000005, RIDEV_INPUTSINK = 0x100, RIDEV_REMOVE = 0x1, RIDI_DEVICENAME = 0x20000007;
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly Dictionary<IntPtr, List<long>> seen = new Dictionary<IntPtr, List<long>>();
    long firstAt = -1;
    readonly long countTicks, waitTicks;
    public DhMouseRate(int seconds, int wait) {
        countTicks = seconds * Stopwatch.Frequency; waitTicks = wait * Stopwatch.Frequency;
        CreateHandle(new CreateParams());   // a plain hidden window: never shown, no taskbar button
        var d = new[] { new RawDevice { Page = 1, Usage = 2, Flags = RIDEV_INPUTSINK, Target = Handle } };
        if (!RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RawDevice)))) throw new Exception("Windows did not let it listen to the mouse (" + Marshal.GetLastWin32Error() + ")");
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_INPUT) {
            long now = clock.ElapsedTicks;
            RawHeader hd; uint size = (uint)Marshal.SizeOf(typeof(RawHeader));
            if (GetRawInputData(m.LParam, RID_HEADER, out hd, ref size, (uint)Marshal.SizeOf(typeof(RawHeader))) != unchecked((uint)-1)) {
                List<long> list;
                if (!seen.TryGetValue(hd.Device, out list)) { list = new List<long>(50000); seen[hd.Device] = list; }
                list.Add(now);
                if (firstAt < 0) firstAt = now;
            }
        }
        base.WndProc(ref m);
    }
    public bool Done { get { long now = clock.ElapsedTicks; return firstAt >= 0 ? now - firstAt >= countTicks : now >= waitTicks; } }
    public void Stop() {
        var d = new[] { new RawDevice { Page = 1, Usage = 2, Flags = RIDEV_REMOVE, Target = IntPtr.Zero } };
        RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
        DestroyHandle();
    }
    static string NameOf(IntPtr dev) {
        if (dev == IntPtr.Zero) return "";
        uint n = 0; GetRawInputDeviceInfo(dev, RIDI_DEVICENAME, null, ref n);
        if (n == 0 || n > 1024) return "";
        var sb = new StringBuilder((int)n + 1); GetRawInputDeviceInfo(dev, RIDI_DEVICENAME, sb, ref n);
        return sb.ToString();
    }
    static string Json(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
    public string Result() {
        double pause = 0.020 * Stopwatch.Frequency;
        var rows = new List<KeyValuePair<long, string>>();
        foreach (var kv in seen) {
            var t = kv.Value; long gaps = 0; double moving = 0;
            for (int i = 1; i < t.Count; i++) { long dt = t[i] - t[i - 1]; if (dt > pause) continue; gaps++; moving += dt; }
            double ms = moving * 1000.0 / Stopwatch.Frequency;
            double hz = moving > 0 ? gaps / (moving / Stopwatch.Frequency) : 0;
            rows.Add(new KeyValuePair<long, string>(t.Count, "{\"name\":" + Json(NameOf(kv.Key)) + ",\"reports\":" + t.Count + ",\"movingMs\":" + Math.Round(ms) + ",\"hz\":" + Math.Round(hz) + "}"));
        }
        rows.Sort((a, b) => b.Key.CompareTo(a.Key));
        var parts = new List<string>(); foreach (var r in rows) parts.Add(r.Value);
        return "{\"ok\":true,\"moved\":" + (firstAt >= 0 ? "true" : "false") + ",\"devices\":[" + string.Join(",", parts.ToArray()) + "]}";
    }
    public static string Run(int seconds, int wait) {
        var w = new DhMouseRate(seconds, wait);
        try {
            var t = new Timer { Interval = 50 };
            t.Tick += (s, e) => { if (w.Done) { t.Stop(); Application.ExitThread(); } };
            t.Start();
            Application.Run();
            return w.Result();
        } finally { w.Stop(); }
    }
}
"@
try { [DhMouseRate]::Run($Seconds, $WaitSeconds) } catch { '{"ok":false,"why":' + (ConvertTo-Json ([string]$_.Exception.Message) -Compress) + '}' }
