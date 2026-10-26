// DeviceHub's one native helper: replaces six PowerShell helper processes (~100 MB each) with one small program.
// Built on this PC by helpers/native.js with Windows' own C# compiler (.NET Framework 4.8 csc.exe); nothing is
// downloaded. It runs the same C# code the PowerShell helpers ran (hidio.cs, hs80io.cs, audio*.cs) on channels:
//
//   stdin  : <channel> <seq> <command...>          one request per line
//   stdout : <channel> <seq> <reply...>            the reply to that request
//            <channel> EVT <id hex> <value>        a headset reporting a change (mic flip, battery)
//
//   hid:<vid>:<pid>:<page>:<usage>:<len>:<reportId>[:tag]   mouse / keyboard: OPEN | REQ <echo> <ms> <hex...> | CLOSE
//                                                           feature reports: FSET <hex...> | FGET <id hex> <len>
//        [:key=value ...]                                   library drivers' options (HandleHidEx): interface,
//                                                           collection, lengths, feature-only, raw SEND / READ, REFUSED
//   hs80:<pid>:<ep>[:tag]                                   headset: OPEN | GET | SET | MODE | LIGHT | OPENLIGHT | FRAME | CLOSE
//        [:frame=peripheral]                                Corsair Bragi mice / keyboards: no report ids, own SET list
//   audio                                                   Windows audio, JSON requests
//   cue                                                     iCUE SDK properties, JSON requests
//   tray                                                    START <port> <folder>: the tray icon (tray.cs)
//   pc:<op>                                                 read-only PC facts, JSON requests (pc-reads.cs): bluetooth, pc-map,
//                                                           display-read, sensors, installed, eqapo
//
// Each channel has its own worker thread, so a slow reply on one never holds up another.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

public static class Helper {
  static readonly object outLock = new object();
  public static void Say(string s) { lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

  class Channel {
    public string Name;
    public readonly BlockingCollection<string[]> Queue = new BlockingCollection<string[]>();
    public HidIo Hid; public Hs80Io Hs; public HidWatch Watch; public Thread Events, Worker;
  }
  static readonly Dictionary<string, Channel> channels = new Dictionary<string, Channel>();
  public static string CueDll;

  static System.Threading.Timer cleanupTimer;
  public static void Main(string[] args) {
    if (args.Length > 0) CueDll = args[0];
    Console.InputEncoding = System.Text.Encoding.UTF8;
    Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    // A cleanup every 30 s (19 Oct 2026): the audio checks every 2 s create Windows audio objects that are released
    // only when .NET collects, and with a ~1 MB heap it rarely did, so the helper's memory crept up. Takes well
    // under a millisecond.
    // kept in a static field: a timer held only by a local variable is itself collected and stops (it did, 19 Oct)
    cleanupTimer = new System.Threading.Timer((st) => { GC.Collect(); GC.WaitForPendingFinalizers(); }, null, 30000, 30000);
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      line = line.Trim();
      int a = line.IndexOf(' '); if (a < 0) continue;
      int b = line.IndexOf(' ', a + 1); if (b < 0) continue;
      string chan = line.Substring(0, a), seq = line.Substring(a + 1, b - a - 1), rest = line.Substring(b + 1);
      Channel c;
      lock (channels) {
        if (!channels.TryGetValue(chan, out c)) {
          c = new Channel { Name = chan };
          channels[chan] = c;
          c.Worker = new Thread(() => Work(c)) { IsBackground = true };
          c.Worker.Start();
        }
        // added under the lock: a channel retired after CLOSE (below) takes nothing more, a new one starts instead
        c.Queue.Add(new[] { seq, rest });
      }
    }
    // stdin closed: DeviceHub stopped. Hide the tray icon, answer what is queued (up to 5 s), close every device.
    Tray.Stop();
    List<Channel> all; lock (channels) all = channels.Values.ToList();
    foreach (var c in all) c.Queue.CompleteAdding();
    foreach (var c in all) c.Worker.Join(5000);
    foreach (var c in all) { try { if (c.Hid != null) c.Hid.Dispose(); if (c.Hs != null) c.Hs.Dispose(); } catch { } }
  }

  static void Work(Channel c) {
    foreach (var req in c.Queue.GetConsumingEnumerable()) {
      string reply;
      try { reply = Handle(c, req[1]); }
      catch (Exception e) {
        // a broken handle (unplugged): drop it; DeviceHub reopens when the device is back
        if (c.Watch != null) { try { c.Watch.Dispose(); } catch { } c.Watch = null; }
        if (c.Hid != null) { try { c.Hid.Dispose(); } catch { } c.Hid = null; }
        if (c.Hs != null) { try { c.Hs.Dispose(); } catch { } c.Hs = null; }
        reply = c.Name == "audio" || c.Name == "cue" || c.Name == "monitor" || c.Name == "camera" ? Json(new Dictionary<string, object> { { "ok", false }, { "error", e.Message } }) : "GONE";
      }
      Say(c.Name + " " + req[0] + " " + reply);
      // a closed device channel ends its thread (20 Oct 2026): each headset retry opens new channels, and with no
      // headset on the PC a thread was left behind every few seconds, thousands a day. Anything already queued is
      // still answered; the next request on this name starts a fresh channel.
      if (req[1] == "CLOSE") lock (channels) { Channel cur; if (channels.TryGetValue(c.Name, out cur) && cur == c) channels.Remove(c.Name); c.Queue.CompleteAdding(); }
    }
  }

  static string Handle(Channel c, string rest) {
    if (c.Name.StartsWith("hid:")) return HandleHid(c, rest);
    if (c.Name.StartsWith("hs80:")) return HandleHs80(c, rest);
    if (c.Name == "audio") return Audio(rest);
    if (c.Name == "cue") return CueOp(rest);
    // read-only PC facts (helpers/pc-reads.cs): one channel per read, pc:<op>, so a slow WMI read never holds up another
    if (c.Name == "pc" || c.Name.StartsWith("pc:")) return PcOp(rest);
    // the watchdog's heartbeat (helpers/native.js); HANG-TEST freezes this channel on purpose, to test the watchdog
    // every HID collection on a usage page and usage, e.g. "FF60 61" for VIA keyboards (helpers/native/hs80io.cs)
    if (c.Name == "hidlist") { var w = rest.Split(' '); return HidFind.List(Convert.ToInt32(w[0], 16), Convert.ToInt32(w[1], 16)); }
    if (c.Name == "watchdog") { if (rest == "HANG-TEST") Thread.Sleep(Timeout.Infinite); return "PONG"; }
    // monitors over DDC/CI (helpers/monitors.cs): their own channel, so a slow monitor never holds up the audio
    if (c.Name == "monitor") {
      var q = js.Deserialize<Dictionary<string, object>>(rest);
      var o = new Dictionary<string, object> { { "ok", true } };
      switch ((string)q["op"]) {
        case "monitors": o["monitors"] = Monitors.List(q.ContainsKey("caps") && q["caps"] is bool && (bool)q["caps"]); break;
        case "monitor-set": foreach (var kv in (Dictionary<string, object>)Monitors.Set((string)q["id"], Convert.ToInt32(q["code"]), Convert.ToInt32(q["value"]), q.ContainsKey("live") && q["live"] is bool && (bool)q["live"])) o[kv.Key] = kv.Value; break;
        default: o["ok"] = false; o["error"] = "unknown monitor op"; break;
      }
      return Json(o);
    }
    // Windows pointer settings (helpers/pointer.cs): "GET", or "SET <key> <value>"; both answer with all of them
    if (c.Name == "pointer") {
      try {
        var w = rest.Split(' ');
        return Json(w[0] == "SET" ? Pointer.Set(w[1], Convert.ToInt32(w[2])) : Pointer.Read());
      } catch (Exception e) { return Json(new Dictionary<string, object> { { "ok", false }, { "error", e.Message } }); }
    }
    // webcam picture settings (helpers/camera.cs): their own channel too
    if (c.Name == "camera") {
      var q = js.Deserialize<Dictionary<string, object>>(rest);
      var o = new Dictionary<string, object> { { "ok", true } };
      switch ((string)q["op"]) {
        case "cameras": o["cameras"] = Cameras.List(); break;
        case "camera-set": foreach (var kv in Cameras.Set((string)q["path"], (string)q["key"], Convert.ToInt32(q["value"]), q.ContainsKey("auto") && q["auto"] is bool && (bool)q["auto"])) o[kv.Key] = kv.Value; break;
        default: o["ok"] = false; o["error"] = "unknown camera op"; break;
      }
      return Json(o);
    }
    if (c.Name == "tray") {  // START <port> <folder>
      var w = rest.Split(new[] { ' ' }, 3);
      if (w[0] == "START" && w.Length == 3) return Tray.Start(int.Parse(w[1]), w[2]);
      if (w[0] == "WAKE" && w.Length == 2) return Tray.Wake(w[1] == "ON");  // WAKE ON | OFF: listen for the mouse's wake
      return "ERR unknown command";
    }
    if (c.Name == "diag") {  // MEM [GC]: .NET heap, collections and working set; GC first collects (19 Oct 2026, leak hunt)
      if (rest == "MEM GC") { GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); }
      var me = System.Diagnostics.Process.GetCurrentProcess();
      return "heap=" + (GC.GetTotalMemory(false) / 1048576.0).ToString("0.0") + "MB gen0=" + GC.CollectionCount(0) + " gen1=" + GC.CollectionCount(1) + " gen2=" + GC.CollectionCount(2)
        + " private=" + (me.PrivateMemorySize64 / 1048576.0).ToString("0.0") + "MB handles=" + me.HandleCount + " threads=" + me.Threads.Count;
    }
    if (c.Name == "win") {  // BRAND <ico>|<relaunch command>: the DeviceHub window's taskbar identity (winbrand.cs)
      if (rest.StartsWith("BRAND ")) { var a = rest.Substring(6).Split('|'); return WinBrand.Brand(a[0], a.Length > 1 ? a[1] : ""); }
      return "ERR unknown command";
    }
    return "ERR unknown channel";
  }

  // ---- mouse / keyboard ----
  // Channel options (22 Oct 2026, library drivers; helpers/hid-host.mjs channelOpts): extra name parts "key=value"
  // after the report id. A channel without them (the mouse, the keyboard, every channel before) takes exactly the
  // paths it always took. page / usage "*" = any (then an interface, collection or length must say which).
  //   if=<n>  USB interface (&mi_0n)     col=<n>  collection (&col0n)
  //   il= ol= fl=<n>  input / output / feature report data bytes (without the report id) the collection must have;
  //                   il / ol also size the reads and writes (len otherwise)
  //   fo=1  feature-only: opened with no access, FSET / FGET only      rw=1  raw: SEND / READ instead of REQ
  //   rf=1  a write the device refuses answers REFUSED <code> (the handle stays open) instead of GONE
  //   gi=1  input reports on request: IGET (HidD_GetInputReport); refused on every other channel
  static Dictionary<string, int> Opts(string[] p) {
    var o = new Dictionary<string, int>();
    for (int i = 7; i < p.Length; i++) { int e = p[i].IndexOf('='); if (e > 0) o[p[i].Substring(0, e)] = int.Parse(p[i].Substring(e + 1)); }
    return o;
  }
  static int Opt(Dictionary<string, int> o, string k) { int v; return o.TryGetValue(k, out v) ? v : -1; }
  static int HexOrAny(string s) { return s == "*" ? -1 : Convert.ToInt32(s, 16); }

  static string HandleHid(Channel c, string rest) {
    var p = c.Name.Split(':');  // hid vid pid page usage len reportId [tag | key=value ...]
    var w = rest.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
    var o = Opts(p);
    if (o.Count > 0 || p[3] == "*" || p[4] == "*") return HandleHidEx(c, p, w, o);
    switch (w[0]) {
      case "OPEN": {
        if (c.Hid != null) return "OK";
        var path = HidFind.Find(p[1], p[2], Convert.ToInt32(p[3], 16), Convert.ToInt32(p[4], 16), 0);
        if (path == null) return "NODEVICE";
        c.Hid = new HidIo(path, int.Parse(p[5]), byte.Parse(p[6]));
        return "OK";
      }
      // WATCH <command>: reports the device sends by itself with that command byte are passed on as "<chan> EVT <cmd> 1"
      // (21 Oct 2026: the Pulsar mouse announces a DPI button press with 0A). A second handle that only reads (it can
      // send nothing), beside the request handle; Windows gives every handle each report. Ends with CLOSE.
      case "WATCH": {
        if (c.Hid == null) return "GONE";
        if (c.Watch != null) return "OK";
        var path = HidFind.Find(p[1], p[2], Convert.ToInt32(p[3], 16), Convert.ToInt32(p[4], 16), 0);
        if (path == null) return "NODEVICE";
        c.Watch = new HidWatch(path, int.Parse(p[5]) + 1, Convert.ToByte(w[1], 16), (cmd) => Say(c.Name + " EVT " + cmd.ToString("x2") + " 1"));
        return "OK";
      }
      case "REQ": {
        if (c.Hid == null) return "GONE";
        int echo = int.Parse(w[1]), ms = int.Parse(w[2]);
        var bytes = w.Skip(3).Select(x => Convert.ToByte(x, 16)).ToArray();
        var r = c.Hid.Req(bytes, echo, ms);
        return r == null ? "NONE" : string.Join(" ", r.Select(x => x.ToString("x2")));
      }
      // FSET <hex...>: one feature report, its id first (hidio.cs FeatureSet over HidD_SetFeature; 22 Oct 2026, HID
      // LampArray). OK; NONE when the device refused it or the collection has no feature report that long.
      case "FSET": {
        if (c.Hid == null) return "GONE";
        if (w.Length < 2) return "ERR need the report";
        var bytes = w.Skip(1).Select(x => Convert.ToByte(x, 16)).ToArray();
        return c.Hid.FeatureSet(bytes) ? "OK" : "NONE";
      }
      // FGET <id hex> <len>: reads feature report <id> (HidD_GetFeature): its first <len> data bytes without the id, or NONE
      case "FGET": {
        if (c.Hid == null) return "GONE";
        if (w.Length < 3) return "ERR need the id and length";
        var r = c.Hid.FeatureGet(Convert.ToByte(w[1], 16), int.Parse(w[2]));
        return r == null ? "NONE" : string.Join(" ", r.Select(x => x.ToString("x2")));
      }
      case "CLOSE": if (c.Watch != null) { c.Watch.Dispose(); c.Watch = null; } if (c.Hid != null) { c.Hid.Dispose(); c.Hid = null; } return "OK";
    }
    return "ERR unknown command";
  }

  // A channel with options (see Opts above). Besides OPEN / CLOSE / FSET / FGET / WATCH:
  //   REQ <echo> <ms> <hex...>           as on any channel (not on fo / rw channels); with rf=1 a refusal is REFUSED <code>
  //   REQR <id hex> <echo> <ms> <hex...> the same with another report id (out, and the reply's)
  //   SEND <id hex> <hex...>             rw=1: one output report with that report id, waiting input dropped first;
  //                                      OK | REFUSED <code> | GONE
  //   READ <ms> [<max>]                  rw=1: input reports as sent, report id first, "|" between; NONE when none came
  //   IGET <id hex> <len>                gi=1: asks for input report <id> (hidio.cs InputGet, HidD_GetInputReport):
  //                                      its first <len> data bytes without the id, or NONE
  static string HandleHidEx(Channel c, string[] p, string[] w, Dictionary<string, int> o) {
    bool fo = Opt(o, "fo") == 1, raw = Opt(o, "rw") == 1, rf = Opt(o, "rf") == 1;
    int len = int.Parse(p[5]);
    Func<byte[], string> hex = (r) => string.Join(" ", r.Select(x => x.ToString("x2")));
    switch (w[0]) {
      case "OPEN": {
        if (c.Hid != null) return "OK";
        int page = HexOrAny(p[3]), usage = HexOrAny(p[4]);
        int iface = Opt(o, "if"), col = Opt(o, "col"), il = Opt(o, "il"), ol = Opt(o, "ol"), fl = Opt(o, "fl");
        // an unknown usage page needs something else to say which collection: never the first one of the device
        if (page < 0 && iface < 0 && col < 0 && il < 0 && ol < 0 && fl < 0) return "ERR a channel without a usage page needs an interface, a collection or a report length";
        var path = HidFind.FindEx(p[1], p[2], page, usage, iface, col, il < 0 ? -1 : il + 1, ol < 0 ? -1 : ol + 1, fl < 0 ? -1 : fl + 1);
        if (path == null) return "NODEVICE";
        c.Hid = new HidIo(path, ol < 0 ? len : ol, il < 0 ? len : il, byte.Parse(p[6]), fo);
        return "OK";
      }
      case "CLOSE": if (c.Watch != null) { c.Watch.Dispose(); c.Watch = null; } if (c.Hid != null) { c.Hid.Dispose(); c.Hid = null; } return "OK";
    }
    if (c.Hid == null) return "GONE";
    switch (w[0]) {
      case "FSET": {
        if (w.Length < 2) return "ERR need the report";
        return c.Hid.FeatureSet(w.Skip(1).Select(x => Convert.ToByte(x, 16)).ToArray()) ? "OK" : "NONE";
      }
      case "FGET": {
        if (w.Length < 3) return "ERR need the id and length";
        var r = c.Hid.FeatureGet(Convert.ToByte(w[1], 16), int.Parse(w[2]));
        return r == null ? "NONE" : hex(r);
      }
      case "IGET": {
        if (Opt(o, "gi") != 1) return "ERR not an input-report channel (gi=1)";
        if (w.Length < 3) return "ERR need the id and length";
        var r = c.Hid.InputGet(Convert.ToByte(w[1], 16), int.Parse(w[2]));
        return r == null ? "NONE" : hex(r);
      }
    }
    if (fo) return "ERR feature-only channel: FSET and FGET only";
    switch (w[0]) {
      case "WATCH": {
        if (raw) return "ERR raw channel: READ instead";
        if (c.Watch != null) return "OK";
        int il = Opt(o, "il");
        c.Watch = new HidWatch(c.Hid.Path, (il < 0 ? len : il) + 1, Convert.ToByte(w[1], 16), (cmd) => Say(c.Name + " EVT " + cmd.ToString("x2") + " 1"));
        return "OK";
      }
      case "REQ": case "REQR": {
        if (raw) return "ERR raw channel: SEND and READ";
        int at = w[0] == "REQR" ? 2 : 1;
        if (w.Length < at + 3) return "ERR need the echo, wait and report";
        byte rid = w[0] == "REQR" ? Convert.ToByte(w[1], 16) : byte.Parse(p[6]);
        int echo = int.Parse(w[at]), ms = int.Parse(w[at + 1]);
        var bytes = w.Skip(at + 2).Select(x => Convert.ToByte(x, 16)).ToArray();
        try {
          var r = c.Hid.ReqAs(bytes, echo, ms, rid, rf);
          return r == null ? "NONE" : hex(r);
        } catch (HidRefused e) { return "REFUSED " + e.Code; }
      }
      case "SEND": {
        if (!raw) return "ERR not a raw channel";
        if (w.Length < 2) return "ERR need the report id";
        try { c.Hid.Send(Convert.ToByte(w[1], 16), w.Skip(2).Select(x => Convert.ToByte(x, 16)).ToArray()); return "OK"; }
        catch (HidRefused e) { return "REFUSED " + e.Code; }
      }
      case "READ": {
        if (!raw) return "ERR not a raw channel";
        int ms = w.Length > 1 ? Math.Max(0, Math.Min(int.Parse(w[1]), 5000)) : 0, max = w.Length > 2 ? Math.Max(1, Math.Min(int.Parse(w[2]), 64)) : 16;
        var list = c.Hid.Read(ms, max);
        return list.Count == 0 ? "NONE" : string.Join("|", list.Select(hex));
      }
    }
    return "ERR unknown command";
  }

  // ---- headset ----
  static string HandleHs80(Channel c, string rest) {
    var p = c.Name.Split(':');  // hs80 pid ep [tag]
    var w = rest.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
    Func<int, string> st = (x) => x < 0 ? "NONE" : x.ToString("x2");
    // DeviceHub's own HS80: no SET 0d / 46 / 47 and no library ("bragi") channel, before anything opens or is sent
    { int sid = -1; if (w.Length > 1 && w[0] == "SET") { try { sid = Convert.ToInt32(w[1], 16); } catch { } }
      var no = Hs80Io.Hs80OwnRefusal(c.Name, w.Length > 0 ? w[0] : "", sid); if (no != null) return "ERR " + no; }
    switch (w[0]) {
      case "OPEN": {
        if (c.Hs != null && !c.Hs.Broken) return "OK";
        // "frame=peripheral" (22 Oct 2026, Corsair Bragi mice and keyboards; hs80io.cs): no report ids, 65-byte
        // reports, the peripheral SET list. A channel without a frame part (the HS80's) opens exactly as before.
        var frame = Hs80Io.FrameOf(c.Name);
        if (frame == null) return "ERR unknown frame";
        bool per = frame == "peripheral";
        if (per && Hs80Io.IsHs80Pid(p[1])) return "ERR the HS80 is never opened on the peripheral frame";
        var path = per ? HidFind.Find("1b1c", p[1], 0xFF42, 1, Hs80Io.ReportLen(true)) : HidFind.Find(p[1]);
        if (path == null) return "NODEVICE";
        var io = per ? new Hs80Io(path, true) : new Hs80Io(path); io.Ep = byte.Parse(p[2]); c.Hs = io;
        var t = new Thread(() => { foreach (var b in io.Events.GetConsumingEnumerable()) { if (b == null) break; Say(c.Name + " EVT " + b[3].ToString("x2") + " " + BitConverter.ToInt32(b, 5)); } }) { IsBackground = true };
        t.Start(); c.Events = t;
        return "OK";
      }
      case "CLOSE": if (c.Hs != null) { c.Hs.Dispose(); c.Hs = null; } return "OK";
    }
    if (c.Hs == null || c.Hs.Broken) { if (c.Hs != null) { try { c.Hs.Dispose(); } catch { } c.Hs = null; } return "GONE"; }
    switch (w[0]) {
      case "GET": { var r = c.Hs.Get(Convert.ToInt32(w[1], 16), 400); return r == null ? "NONE" : string.Join(" ", r.Skip(3).Take(6).Select(x => x.ToString("x2"))); }
      // a value outside Hs80Io.Set's list is refused with ERR, the headset's handle kept (22 Oct 2026; it was GONE and
      // closed the handle). Nothing is sent for it either way.
      case "SET": try { return st(c.Hs.Set(Convert.ToInt32(w[1], 16), int.Parse(w[2]), 400)); } catch (ArgumentException e) { return "ERR " + e.Message; }
      case "MODE": try { return st(c.Hs.Set(3, int.Parse(w[1]), 400)); } catch (ArgumentException e) { return "ERR " + e.Message; }
      case "LIGHT": { var rgb = w.Skip(1).Select(x => Convert.ToByte(x, 16)).ToArray(); if (rgb.Length != 9) return "ERR need 9 bytes"; try { return st(c.Hs.Light(rgb, 400)); } catch (ArgumentException e) { return "ERR " + e.Message; } }
      case "OPENLIGHT": try { return st(c.Hs.OpenLight(400)); } catch (ArgumentException e) { return "ERR " + e.Message; }
      // which frame this channel speaks: an older helper answers "ERR unknown command" (it has only the headset's)
      case "FRAME": return c.Hs.Peripheral ? "peripheral" : "hs80";
    }
    return "ERR unknown command";
  }

  // ---- Windows audio ----
  static readonly JavaScriptSerializer js = new JavaScriptSerializer();
  static string Json(object o) { return js.Serialize(o); }
  const string HS80 = "VID_1B1C&PID_0A6";

  // a headset's sidetone control (any USB headset: its "VID_xxxx&PID_yyyy"; the HS80 when none is given)
  static Dictionary<string, object> Sidetone(string usb) {
    var rows = AudioTopology.List(usb).Select(r => r.Split('|')).ToList();
    // the HS80's: the volume control with its exact range (-42 to +4 dB, measured); any other headset's: only a control
    // Windows names "Sidetone" (an unnamed one could be the mic or the speakers, so it is never guessed)
    var vol = rows.FirstOrDefault(c => c[3] == "volume" && D(c[4]) == -42 && D(c[5]) == 4)
      ?? rows.FirstOrDefault(c => c[3] == "volume" && c[2].IndexOf("sidetone", StringComparison.OrdinalIgnoreCase) >= 0);
    if (vol == null) return null;
    uint unit = uint.Parse(vol[1]);
    var mute = rows.FirstOrDefault(c => c[3] == "mute" && uint.Parse(c[1]) == unit - 1);
    return new Dictionary<string, object> { { "unit", unit }, { "muteUnit", mute == null ? (object)null : uint.Parse(mute[1]) },
      { "db", Math.Round(D(vol[7]), 2) }, { "on", mute == null ? (object)null : mute[4] == "0" }, { "min", D(vol[4]) }, { "max", D(vol[5]) } };
  }
  static double D(string s) { return double.Parse(s, CultureInfo.InvariantCulture); }

  static string Audio(string rest) {
    var q = js.Deserialize<Dictionary<string, object>>(rest);
    var op = (string)q["op"];
    var o = new Dictionary<string, object> { { "ok", true } };
    Func<string, bool> has = (k) => q.ContainsKey(k) && q[k] != null;
    switch (op) {
      case "audio-list": o["endpoints"] = WinAudio.List(has("match") ? (string)q["match"] : "HS80"); break;
      case "audio-set": o["endpoint"] = WinAudio.Set((string)q["id"], has("volume") ? Convert.ToInt32(q["volume"]) : -1, has("muted") ? ((bool)q["muted"] ? 1 : 0) : -1); break;
      // any USB headset Windows has (helpers/audio-default.cs Headsets): its sound devices, without knowing its maker
      case "usb-headsets": o["headsets"] = AudioDefault.Headsets(); break;
      case "hs80-endpoints":
        o["endpoints"] = AudioDefault.List(has("usb") ? (string)q["usb"] : HS80).Select(r => r.Split('|')).Select(c => new Dictionary<string, object> {
          { "flow", c[0] }, { "id", c[1] }, { "state", int.Parse(c[2]) }, { "name", c[3] }, { "wired", c[4].Contains("PID_0A69") }, { "wireless", c[4].Contains("PID_0A6B") } }).ToList();
        o["defaults"] = new Dictionary<string, object> { { "playback", AudioDefault.Default(0) }, { "recording", AudioDefault.Default(1) } };
        break;
      case "set-enabled": o["state"] = AudioDefault.SetEnabled((string)q["id"], (bool)q["on"]); break;
      case "set-default": o["now"] = AudioDefault.SetDefault((string)q["id"], Convert.ToInt32(q["flow"])); break;
      // every speaker and the apps on it; moving the apps that did not follow a new default (helpers/audio-apps.cs)
      case "outputs": o["outputs"] = AudioApps.Outputs(); break;
      // mic test recording, kept in memory only (helpers/mic-rec.cs)
      case "mic-rec-start": o["rec"] = MicRec.Start(has("id") ? (string)q["id"] : null); break;
      case "mic-rec-status": o["rec"] = MicRec.Status(); break;
      case "mic-rec-stop": o["rec"] = MicRec.Stop(); break;
      case "mic-rec-read": o["data"] = MicRec.Read(Convert.ToInt64(q["offset"]), Convert.ToInt32(q["length"])); break;
      case "mic-rec-clear": MicRec.Clear(); o["rec"] = MicRec.Status(); break;
      // the Anker mic guard (helpers/mic-guard.cs): Chrome window titles and mic use; every recording device
      case "mic-guard": o["look"] = MicGuard.Look(); break;
      case "mics": o["mics"] = MicGuard.Mics(); break;
      // the running programs' names, for auto-switch (26 Oct 2026, idle CPU: tasklist every 10 s cost ~170 ms of CPU
      // each); read-only, names only, the way tasklist lists them (name.exe)
      case "procs": {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in System.Diagnostics.Process.GetProcesses()) { try { names.Add(p.ProcessName + ".exe"); } catch { } finally { p.Dispose(); } }
        o["names"] = names.ToList();
        break;
      }
      // power: on battery or on the charger (DeviceHub's battery saver, helpers/power.js)
      case "power": {
        var ps = System.Windows.Forms.SystemInformation.PowerStatus;
        o["hasBattery"] = (ps.BatteryChargeStatus & System.Windows.Forms.BatteryChargeStatus.NoSystemBattery) == 0;
        o["onBattery"] = ps.PowerLineStatus == System.Windows.Forms.PowerLineStatus.Offline;
        o["percent"] = ps.BatteryLifePercent <= 1 ? (object)Math.Round(ps.BatteryLifePercent * 100) : null;
        break;
      }
      case "follow": o["moved"] = AudioApps.Follow((string)q["id"]); break;
      case "switch-output": AudioDefault.SetDefault((string)q["id"], 0); o["moved"] = AudioApps.Follow((string)q["id"]); break;
      case "sidetone": o["sidetone"] = Sidetone(has("usb") ? (string)q["usb"] : HS80); break;
      case "sidetone-set": {
        var usb = has("usb") ? (string)q["usb"] : HS80;
        var s = Sidetone(usb);
        if (s == null) throw new Exception("no sidetone control in Windows for this headset (is it connected?)");
        if (has("db")) { double db = Convert.ToDouble(q["db"]); if (db < -42 || db > 4) throw new Exception("sidetone must be between -42 and +4 dB"); AudioTopology.SetLevel(usb, (uint)s["unit"], (float)db); }
        if (has("on")) { if (s["muteUnit"] == null) throw new Exception("this headset has no sidetone on/off control"); AudioTopology.SetMute(usb, (uint)s["muteUnit"], !(bool)q["on"]); }
        o["sidetone"] = Sidetone(usb);
        break;
      }
      default: return Json(new Dictionary<string, object> { { "ok", false }, { "error", "unknown op " + op } });
    }
    return Json(o);
  }

  // ---- read-only PC facts (helpers/pc-reads.cs, helpers/helper-reads.js): { op, ... } -> { ok, result } ----
  static readonly JavaScriptSerializer pcJs = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
  static string PcOp(string rest) {
    try { return pcJs.Serialize(PcReads.Op(pcJs.Deserialize<Dictionary<string, object>>(rest))); }
    catch (Exception e) { return pcJs.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", e.Message } }); }
  }

  // ---- iCUE SDK properties ----
  static string CueOp(string rest) {
    var q = js.Deserialize<Dictionary<string, object>>(rest);
    var op = (string)q["op"];
    if (!Cue.Ensure(CueDll)) return Json(new Dictionary<string, object> { { "ok", false }, { "error", "iCUE SDK not connected (is iCUE running?)" } });
    var o = new Dictionary<string, object> { { "ok", true } };
    if (op == "props") o["props"] = new[] { 2, 3, 4, 5, 9 }.Select(k => Cue.Read((string)q["id"], k)).Where(r => r != null).ToList();
    else if (op == "write") o["prop"] = Cue.Write((string)q["id"], Convert.ToInt32(q["prop"]), q["value"]);
    else return Json(new Dictionary<string, object> { { "ok", false }, { "error", "unknown op " + op } });
    return Json(o);
  }
}

public static class Cue {
  public delegate void StateHandler(IntPtr ctx, IntPtr evt);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetDllDirectory(string p);
  [DllImport("iCUESDK.x64_2019.dll")] static extern int CorsairConnect(StateHandler h, IntPtr ctx);
  [DllImport("iCUESDK.x64_2019.dll")] static extern int CorsairGetDevicePropertyInfo([MarshalAs(UnmanagedType.LPStr)] string id, int prop, uint index, out int dataType, out uint flags);
  [DllImport("iCUESDK.x64_2019.dll")] static extern int CorsairReadDeviceProperty([MarshalAs(UnmanagedType.LPStr)] string id, int prop, uint index, IntPtr property);
  [DllImport("iCUESDK.x64_2019.dll")] static extern int CorsairWriteDeviceProperty([MarshalAs(UnmanagedType.LPStr)] string id, int prop, uint index, IntPtr property);
  [DllImport("iCUESDK.x64_2019.dll")] static extern int CorsairFreeProperty(IntPtr property);
  static readonly Dictionary<int, string> NAMES = new Dictionary<int, string> { { 2, "micEnabled" }, { 3, "surroundEnabled" }, { 4, "sidetoneEnabled" }, { 5, "equalizerPreset" }, { 9, "batteryLevel" } };
  static volatile int state; static StateHandler keep; static bool started;

  // Connects on first use and waits up to 10 s for iCUE (6 = connected).
  public static bool Ensure(string dll) {
    if (!started) {
      if (dll == null) return false;
      SetDllDirectory(System.IO.Path.GetDirectoryName(dll));
      keep = (c, e) => { state = Marshal.ReadInt32(e); };
      CorsairConnect(keep, IntPtr.Zero);
      started = true;
      for (int i = 0; i < 200 && state != 6; i++) Thread.Sleep(50);
    }
    return state == 6;
  }

  public static Dictionary<string, object> Read(string id, int prop) {
    int type; uint flags;
    if (CorsairGetDevicePropertyInfo(id, prop, 0, out type, out flags) != 0) return null;
    var r = new Dictionary<string, object> { { "prop", prop }, { "name", NAMES[prop] }, { "type", type }, { "canRead", (flags & 1) != 0 }, { "canWrite", (flags & 2) != 0 }, { "value", null } };
    if ((flags & 1) == 0) return r;
    IntPtr p = Marshal.AllocHGlobal(24);
    try {
      for (int i = 0; i < 24; i++) Marshal.WriteByte(p, i, 0);
      int e = CorsairReadDeviceProperty(id, prop, 0, p);
      if (e == 0) {
        switch (Marshal.ReadInt32(p, 0)) {
          case 0: r["value"] = Marshal.ReadByte(p, 8) != 0; break;
          case 1: r["value"] = Marshal.ReadInt32(p, 8); break;
          case 2: r["value"] = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(p, 8)); break;
        }
        CorsairFreeProperty(p);
      } else r["error"] = e;
    } finally { Marshal.FreeHGlobal(p); }
    return r;
  }

  public static Dictionary<string, object> Write(string id, int prop, object value) {
    var info = Read(id, prop);
    if (info == null) throw new Exception("property " + prop + " not supported");
    if (!(bool)info["canWrite"]) throw new Exception("property " + NAMES[prop] + " is read-only on this device");
    int type = (int)info["type"];
    IntPtr p = Marshal.AllocHGlobal(24);
    try {
      for (int i = 0; i < 24; i++) Marshal.WriteByte(p, i, 0);
      Marshal.WriteInt32(p, 0, type);
      if (type == 0) Marshal.WriteByte(p, 8, (byte)(Convert.ToBoolean(value) ? 1 : 0));
      else if (type == 1) Marshal.WriteInt32(p, 8, Convert.ToInt32(value));
      else throw new Exception("unsupported type " + type);
      int e = CorsairWriteDeviceProperty(id, prop, 0, p);
      if (e != 0) throw new Exception("iCUE refused the write (error " + e + ")");
    } finally { Marshal.FreeHGlobal(p); }
    var after = Read(id, prop);
    if (Convert.ToString(after["value"]) != Convert.ToString(value)) throw new Exception("headset reports " + after["value"] + " after writing " + value);
    return after;
  }
}
