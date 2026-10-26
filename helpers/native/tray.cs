// DeviceHub's tray icon, inside the native helper.
// Shows each wireless battery, opens the app, applies profiles, toggles auto-switch,
// "I saw the mic light go white", and quits DeviceHub. Talks only to the local server. Started by the 'tray' channel:
//   tray <seq> START <port> <DeviceHub folder>
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Tells DeviceHub the moment Windows adds or removes a device (19 Oct 2026, Shawn: the mouse took 5+ s to show after
// plugging in its cable). A hidden window that receives Windows' WM_DEVICECHANGE broadcast and passes it on as
// "dev EVT 00 1"; DeviceHub then looks for the device at once instead of on its next timed check. No polling.
public class DeviceWatch : NativeWindow {
  public DeviceWatch() { CreateHandle(new CreateParams()); }
  // Mouse wake (21 Oct 2026): a sleeping wireless mouse that wakes makes Windows announce nothing, so DeviceHub had to
  // ask the dongle every few seconds. While DeviceHub's mouse sleeps, the first movement of a mouse is passed on as
  // "input EVT 00 1" and the listening stops at once (an 8 kHz mouse would otherwise send thousands a second).
  // Nothing is read from the movement and nothing is held up: input sink, without NOLEGACY.
  [StructLayout(LayoutKind.Sequential)] struct RawDevice { public ushort Page, Usage; public uint Flags; public IntPtr Target; }
  [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RawDevice[] d, uint n, uint size);
  bool listening;
  public void Listen(bool on) {
    if (on == listening) return;
    var d = new[] { new RawDevice { Page = 1, Usage = 2, Flags = on ? 0x100u : 0x1u, Target = on ? Handle : IntPtr.Zero } };  // RIDEV_INPUTSINK / RIDEV_REMOVE
    if (RegisterRawInputDevices(d, 1, (uint)Marshal.SizeOf(typeof(RawDevice)))) listening = on;
  }
  protected override void WndProc(ref Message m) {
    // WM_INPUT: the mouse moved while DeviceHub listens for its wake
    if (m.Msg == 0x00FF && listening) { Listen(false); Helper.Say("input EVT 00 1"); }
    // WM_DEVICECHANGE: DBT_DEVNODES_CHANGED (7), DBT_DEVICEARRIVAL (0x8000), DBT_DEVICEREMOVECOMPLETE (0x8004)
    if (m.Msg == 0x0219) { long w = m.WParam.ToInt64(); if (w == 7 || w == 0x8000 || w == 0x8004) Helper.Say("dev EVT 00 1"); }
    // WM_POWERBROADCAST (20 Oct 2026): going to sleep (PBT_APMSUSPEND 4) and waking (PBT_APMRESUMEAUTOMATIC 0x12,
    // PBT_APMRESUMESUSPEND 7), passed on as "power EVT 00 1" / "power EVT 01 1" so DeviceHub reconnects at once
    if (m.Msg == 0x0218) { long w = m.WParam.ToInt64(); if (w == 4) Helper.Say("power EVT 00 1"); else if (w == 0x12 || w == 7) Helper.Say("power EVT 01 1"); }
    base.WndProc(ref m);
  }
}

public static class Tray {
  static string baseUrl, root;
  static NotifyIcon icon; static ContextMenuStrip menu; static Form host; static DeviceWatch watch;
  static Dictionary<string, object> state; static int misses;
  static readonly JavaScriptSerializer js = new JavaScriptSerializer();
  static readonly string[] order = { "mouse", "headset", "keyboard" };
  static readonly Dictionary<string, string> names = new Dictionary<string, string> { { "mouse", "Mouse" }, { "headset", "Headset" }, { "keyboard", "Keyboard" } };
  static Thread thread;

  // listen for the mouse's wake (DeviceWatch.Listen), on the tray's own thread, which owns the window
  public static string Wake(bool on) {
    if (host == null || watch == null || !host.IsHandleCreated) return "NO";
    host.BeginInvoke((Action)(() => watch.Listen(on)));
    return "OK";
  }

  public static string Start(int port, string folder) {
    if (thread != null) return "OK";
    baseUrl = "http://127.0.0.1:" + port; root = folder;
    thread = new Thread(Run) { IsBackground = true };
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    return "OK";
  }

  // Hides the icon before the helper exits, so no dead icon stays in the tray.
  public static void Stop() {
    var h = host;
    if (h == null) return;
    try { h.Invoke((Action)(() => { if (icon != null) icon.Visible = false; Application.ExitThread(); })); } catch { }
  }

  static object Api(string path, object body = null) {
    try {
      var req = (HttpWebRequest)WebRequest.Create(baseUrl + path);
      req.Timeout = body == null ? 15000 : 60000;
      if (body != null) {
        req.Method = "POST"; req.ContentType = "application/json";
        var b = Encoding.UTF8.GetBytes(js.Serialize(body));
        using (var s = req.GetRequestStream()) s.Write(b, 0, b.Length);
      }
      using (var res = req.GetResponse()) using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) return js.DeserializeObject(r.ReadToEnd());
    } catch { return null; }
  }
  static Dictionary<string, object> Obj(object o) { return o as Dictionary<string, object>; }
  static object Get(object o, string k) { var d = Obj(o); return d != null && d.ContainsKey(k) ? d[k] : null; }
  static IEnumerable<object> List(object o) { return o is IEnumerable && !(o is string) && !(o is IDictionary) ? ((IEnumerable)o).Cast<object>() : Enumerable.Empty<object>(); }

  static Dictionary<string, object> Device(string id) {
    return List(Get(state, "devices")).Select(Obj).FirstOrDefault(d => d != null && (string)Get(d, "id") == id);
  }
  static string Line(Dictionary<string, object> d) {
    string n = names[(string)d["id"]], st = (string)Get(d, "status");
    var bat = Obj(Get(d, "battery")); var pct = Get(bat, "percent");
    switch (st) {
      case "connected": return pct != null ? n + "  " + pct + "%" + (Equals(Get(bat, "charging"), true) ? " (charging)" : "") : n + "  connected";
      case "asleep": return n + "  asleep";
      case "connecting": return n + "  connecting";
      case "error": return n + "  needs attention";
      default: return n + "  not connected";
    }
  }

  // one open per click or double-click (26 Oct 2026): a double-click also fires the single click, so a second open
  // within 2 s is the same press; the window closes itself when not in use, and the tray brings it back
  static DateTime lastOpen = DateTime.MinValue;
  static void OpenApp() {
    if ((DateTime.UtcNow - lastOpen).TotalMilliseconds < 2000) return;
    lastOpen = DateTime.UtcNow;
    try { System.Diagnostics.Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "wscript.exe"), "\"" + Path.Combine(root, "DeviceHub.vbs") + "\""); } catch { }
  }

  // Applies a profile off the UI thread; the result comes back as a balloon.
  static void ApplyProfile(string name) {
    ThreadPool.QueueUserWorkItem(_ => {
      var r = Api("/api/agent/apply-profile", new Dictionary<string, object> { { "name", name } });
      host.BeginInvoke((Action)(() => {
        if (r == null) { icon.ShowBalloonTip(5000, "Profile \"" + name + "\" not applied", "DeviceHub did not answer. Open DeviceHub to see why.", ToolTipIcon.Error); return; }
        var done = Get(r, "done"); var failed = Convert.ToInt32(Get(r, "failed") ?? 0); var skipped = Convert.ToInt32(Get(r, "skipped") ?? 0);
        icon.ShowBalloonTip(4000, "Profile \"" + name + "\"", done + " changed" + (failed > 0 ? ", " + failed + " failed" : "") + (skipped > 0 ? ", " + skipped + " skipped (not connected)" : ""), ToolTipIcon.Info);
      }));
    });
  }

  // The tray picture with a small state dot in its lower right corner. Redrawn only when the dot changes; the
  // previous picture's handle is freed each time.
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
  static string shownDot = "none";
  static IntPtr dotIcon = IntPtr.Zero;
  static Icon baseIcon;
  static void SetDot(string dot) {
    var key = dot ?? "none";
    if (key == shownDot) return;
    shownDot = key;
    if (dot == null) { icon.Icon = baseIcon; }
    else {
      var size = SystemInformation.SmallIconSize;
      using (var bmp = new Bitmap(size.Width, size.Height)) {
        using (var g = Graphics.FromImage(bmp)) {
          g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
          // drawn from the app's PNG (the .ico holds compressed images that this drawing code garbles)
          var png = Path.Combine(root, "public", size.Width <= 16 ? "icon-16.png" : size.Width <= 32 ? "icon-32.png" : "icon-48.png");
          if (File.Exists(png)) using (var src = new Bitmap(png)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.DrawImage(src, new Rectangle(0, 0, size.Width, size.Height)); }
          else g.DrawIcon(baseIcon, new Rectangle(0, 0, size.Width, size.Height));
          float r = size.Width * 0.42f, x = size.Width - r - 0.5f, y = size.Height - r - 0.5f;
          var c = dot == "red" ? Color.FromArgb(224, 103, 90) : dot == "yellow" ? Color.FromArgb(226, 193, 78) : Color.FromArgb(127, 191, 149);
          using (var ring = new SolidBrush(Color.FromArgb(21, 22, 27))) g.FillEllipse(ring, x - 1.5f, y - 1.5f, r + 3, r + 3);
          using (var fill = new SolidBrush(c)) g.FillEllipse(fill, x, y, r, r);
        }
        var h = bmp.GetHicon();
        icon.Icon = Icon.FromHandle(h);
        if (dotIcon != IntPtr.Zero) DestroyIcon(dotIcon);
        dotIcon = h;
      }
    }
  }

  static void Refresh() {
    ThreadPool.QueueUserWorkItem(_ => {
      var s = Obj(Api("/api/agent/state"));
      host.BeginInvoke((Action)(() => {
        if (s == null) { if (++misses >= 6) { icon.Visible = false; Application.ExitThread(); } return; }
        misses = 0; state = s;
        var parts = new List<string>();
        foreach (var id in order) {
          var d = Device(id); if (d == null) continue;
          var pct = Get(Get(d, "battery"), "percent");
          // only the wireless devices' batteries; the wired keyboard has nothing to show
          if ((string)Get(d, "status") == "connected" && pct != null) parts.Add(names[id] + " " + pct + "%");
          else if ((string)Get(d, "status") == "asleep") parts.Add(names[id] + " asleep");
        }
        // the state dot (19 Oct 2026): red for a battery at 10% or less, yellow at 20% or less (not while it charges),
        // else green while a game profile is on; no dot otherwise
        string dot = null, why = null;
        foreach (var id in order) {
          var d = Device(id); if (d == null || (string)Get(d, "status") != "connected") continue;
          var bat = Get(d, "battery"); var pv = Get(bat, "percent");
          if (pv == null || Equals(Get(bat, "charging"), true)) continue;
          int pc = Convert.ToInt32(pv);
          if (pc <= 10 && dot != "red") { dot = "red"; why = names[id] + " battery low"; }
          else if (pc <= 20 && dot == null) { dot = "yellow"; why = names[id] + " battery low"; }
        }
        var active = Get(Get(s, "auto"), "active") as string;
        if (dot == null && !string.IsNullOrEmpty(active)) { dot = "green"; why = active + " profile on"; }
        SetDot(dot);
        var t = "DeviceHub" + (why != null ? " - " + why : "") + "  " + string.Join("  ", parts);
        icon.Text = t.Length > 63 ? t.Substring(0, 63) : t;
      }));
    });
  }

  static void Opening(object sender, System.ComponentModel.CancelEventArgs e) {
    menu.Items.Clear();
    var title = menu.Items.Add("DeviceHub"); title.Enabled = false; title.Font = new Font(title.Font, FontStyle.Bold);
    if (state != null) foreach (var id in order) { var d = Device(id); if (d != null) { var i = menu.Items.Add(Line(d)); i.Enabled = false; } }
    menu.Items.Add(new ToolStripSeparator());
    var open = menu.Items.Add("Open DeviceHub"); open.Font = new Font(open.Font, FontStyle.Bold); open.Click += (a, b) => OpenApp();
    var pm = new ToolStripMenuItem("Apply profile");
    var profiles = List(Api("/api/profiles")).Select(Obj).Where(p => p != null).ToList();
    if (profiles.Count > 0) foreach (var p in profiles) { var name = (string)Get(p, "name"); pm.DropDownItems.Add(name).Click += (a, b) => ApplyProfile(name); }
    else { var none = pm.DropDownItems.Add("No profiles yet"); none.Enabled = false; }
    menu.Items.Add(pm);
    var set = Api("/api/settings");
    var asw = new ToolStripMenuItem("Auto-switch for games") { Checked = Equals(Get(set, "autoSwitch"), true) };
    // sends only autoSwitch (the server merges); nothing is sent if DeviceHub did not answer the read
    asw.Click += (a, b) => { var s = Api("/api/settings"); if (s == null) return; Api("/api/settings", new Dictionary<string, object> { { "autoSwitch", !Equals(Get(s, "autoSwitch"), true) } }); };
    menu.Items.Add(asw);
    menu.Items.Add(new ToolStripSeparator());
    menu.Items.Add("Quit DeviceHub").Click += (a, b) => { Api("/api/quit", new Dictionary<string, object>()); icon.Visible = false; Application.ExitThread(); };
    e.Cancel = false;
  }

  static void Run() {
    Application.EnableVisualStyles();
    host = new Form { ShowInTaskbar = false, WindowState = FormWindowState.Minimized, FormBorderStyle = FormBorderStyle.FixedToolWindow };
    var _ = host.Handle;  // a window handle for Invoke, never shown
    menu = new ContextMenuStrip(); menu.Items.Add("DeviceHub");  // a menu needs an item to open at all
    menu.Opening += Opening;
    var ico = Path.Combine(root, "DeviceHub.ico");
    baseIcon = File.Exists(ico) ? new Icon(ico, SystemInformation.SmallIconSize) : SystemIcons.Application;
    icon = new NotifyIcon { Icon = baseIcon, Text = "DeviceHub", Visible = true, ContextMenuStrip = menu };
    icon.DoubleClick += (a, b) => OpenApp();
    icon.MouseClick += (a, b) => { if (b.Button == MouseButtons.Left) OpenApp(); };   // a single left click opens it too
    watch = new DeviceWatch();
    var timer = new System.Windows.Forms.Timer { Interval = 10000 };
    timer.Tick += (a, b) => Refresh();
    timer.Start();
    Refresh();
    Application.Run();
    icon.Visible = false; icon.Dispose();
  }
}
