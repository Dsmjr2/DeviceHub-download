// The HS80 frame byte for byte, and the Corsair peripheral frame (22 Oct 2026; docs/handoff/corsair-peripheral-frame.md).
// Compiled with helpers/native/hs80io.cs only, by tests/hid-core.mjs (Windows' own csc.exe, to a temp exe) or by hand:
//   csc /nologo /out:%TEMP%\hs80-frame.exe helpers\native\hs80io.cs tests\native\hs80-frame.cs
// Opens nothing and sends nothing: it compares hs80io.cs's frame functions with the HS80 code as it was before the
// peripheral frame (Old below, copied word for word from the 21 Oct hs80io.cs Get / Set / Light / OpenLight and its reader).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Hs80FrameTest {
  // ---- the old HS80 code, word for word (only `Ep` became a parameter) ----
  static class Old {
    public static byte[] Get(byte Ep, int id) { var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 2; o[3] = (byte)(id & 0xff); o[4] = (byte)(id >> 8); return o; }
    public static bool SetOk(int id, int value) {
      return (id == 0x02 && value >= 0 && value <= 1000) || (id == 0x03 && (value == 1 || value == 2))
           || (id == 0x0e && value >= 60000 && value <= 7200000)
           || (id == 0x0d && (value == 0 || value == 1))
           || (id == 0x46 && (value == 0 || value == 1))
           || (id == 0x47 && value >= 0 && value <= 1000);
    }
    public static byte[] Set(byte Ep, int id, int value) {
      var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 1; o[3] = (byte)id; o[4] = 0;
      o[5] = (byte)(value & 0xff); o[6] = (byte)((value >> 8) & 0xff); o[7] = (byte)((value >> 16) & 0xff); o[8] = (byte)((value >> 24) & 0xff);
      return o;
    }
    public static byte[] Light(byte Ep, byte[] rgb9) { var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 6; o[3] = 0; o[4] = 9; Array.Copy(rgb9, 0, o, 8, 9); return o; }
    public static byte[] OpenLight(byte Ep) { var o = new byte[64]; o[0] = 2; o[1] = Ep; o[2] = 0x0d; o[3] = 0; o[4] = 1; return o; }
    public static bool Reply(byte Ep, byte[] b) { byte from = (byte)(Ep == 9 ? 1 : 0); return b[0] == 1 && b[1] == from && (b[2] == 1 || b[2] == 2 || b[2] == 6 || b[2] == 0x0d); }
    public static bool Event(byte Ep, byte[] b) { byte from = (byte)(Ep == 9 ? 1 : 0); return !(b[0] == 1 && b[1] == from && (b[2] == 1 || b[2] == 2 || b[2] == 6 || b[2] == 0x0d)) && b[0] == 3 && b[1] == from && b[2] == 1; }
  }

  static readonly List<string> fails = new List<string>();
  static int checks;
  static void Check(bool ok, string what) { checks++; if (!ok && fails.Count < 40) fails.Add(what); }
  static bool Same(byte[] a, byte[] b) { return a.Length == b.Length && a.SequenceEqual(b); }
  static string Hex(byte[] a, int n) { return string.Join(" ", a.Take(n).Select(x => x.ToString("x2"))); }

  public static int Main() {
    var eps = new byte[] { 8, 9 };
    var rnd = new Random(1234);
    // 1. the HS80's requests: every GET id 0..ffff, every SET the old list took (and its edges), every light message
    foreach (var ep in eps) {
      for (int id = 0; id <= 0xffff; id++) Check(Same(Hs80Io.GetFrame(false, ep, id), Old.Get(ep, id)), "GET " + id.ToString("x") + " ep " + ep);
      foreach (var id in new[] { 0x02, 0x03, 0x0d, 0x0e, 0x46, 0x47, 0x01, 0x21, 0x22, 0x1e, 0x37, 0xff })
        foreach (var v in new[] { -1, 0, 1, 2, 3, 4, 5, 99, 100, 455, 1000, 1001, 26000, 26001, 59999, 60000, 90000, 3600000, 3600001, 7200000, 7200001, int.MaxValue, int.MinValue }) {
          Check(Same(Hs80Io.SetFrame(false, ep, id, v), Old.Set(ep, id, v)), "SET " + id.ToString("x2") + " " + v + " ep " + ep);
          Check(Hs80Io.Hs80Allows(id, v) == Old.SetOk(id, v) && Hs80Io.Allows(false, id, v) == Old.SetOk(id, v), "the HS80 SET list for " + id.ToString("x2") + " = " + v);
        }
      for (int k = 0; k < 2000; k++) {
        int id = rnd.Next(0, 0x100), v = rnd.Next(int.MinValue, int.MaxValue);
        Check(Same(Hs80Io.SetFrame(false, ep, id, v), Old.Set(ep, id, v)) && Hs80Io.Hs80Allows(id, v) == Old.SetOk(id, v), "random SET " + id + " " + v);
        var rgb = new byte[9]; rnd.NextBytes(rgb);
        Check(Same(Hs80Io.LightFrame(ep, rgb), Old.Light(ep, rgb)), "LIGHT " + Hex(rgb, 9));
      }
      Check(Same(Hs80Io.OpenLightFrame(ep), Old.OpenLight(ep)), "OPENLIGHT ep " + ep);
      // 2. the HS80's reports: which are replies and which are notices, over every first three bytes and random rest
      for (int b0 = 0; b0 < 256; b0++) for (int b1 = 0; b1 < 4; b1++) for (int b2 = 0; b2 < 256; b2++) {
        var b = new byte[64]; rnd.NextBytes(b); b[0] = (byte)b0; b[1] = (byte)b1; b[2] = (byte)b2;
        Check(Hs80Io.IsReply(false, ep, b) == Old.Reply(ep, b), "reply " + Hex(b, 3) + " ep " + ep);
        Check((!Hs80Io.IsReply(false, ep, b) && Hs80Io.IsEvent(false, ep, b)) == Old.Event(ep, b), "event " + Hex(b, 3) + " ep " + ep);
      }
    }
    Check(Hs80Io.ReportLen(false) == 64, "the HS80's reports are 64 bytes");
    // 3. channel names: every HS80 and headset channel DeviceHub opens is the HS80 frame
    foreach (var n in new[] { "hs80:0A69:8:wired1", "hs80:0A6B:9:receiver2", "hs80:0A6B:8:rx", "hs80:0A6B:9", "hs80:0A97:9:bragi", "hs80:1B81:9:bragi" })
      Check(Hs80Io.FrameOf(n) == "hs80", n + " is the HS80 frame");
    Check(Hs80Io.FrameOf("hs80:1B81:9:bragi:frame=peripheral") == "peripheral", "frame=peripheral");
    Check(Hs80Io.FrameOf("hs80:1B81:9:bragi:frame=other") == null && Hs80Io.FrameOf("hs80:1B81:9:frame=peripheral:frame=peripheral") == null, "an unknown or doubled frame part is refused");
    Check(Hs80Io.IsHs80Pid("0a69") && Hs80Io.IsHs80Pid("0A6B") && Hs80Io.IsHs80Pid("0A71") && !Hs80Io.IsHs80Pid("1B81"), "the HS80's ids");

    // 4. the peripheral frame: report id 00, 65 bytes, every other byte where the HS80 puts it
    Check(Hs80Io.ReportLen(true) == 65, "peripheral reports are 65 bytes (report id 00 + 64)");
    Check(Hex(Hs80Io.GetFrame(true, 8, 0x0f), 9) == "00 08 02 0f 00 00 00 00 00" && Hs80Io.GetFrame(true, 8, 0x0f).Length == 65, "peripheral GET 0f on 08: 00 08 02 0f 00");
    Check(Hex(Hs80Io.SetFrame(true, 9, 0x21, 1600), 9) == "00 09 01 21 00 40 06 00 00", "peripheral SET 21 1600 on 09: 00 09 01 21 00 40 06 00 00");
    Check(Hex(Hs80Io.SetFrame(true, 8, 0x01, 4), 9) == "00 08 01 01 00 04 00 00 00", "peripheral SET 01 4: 00 08 01 01 00 04");
    foreach (var ep in eps) for (int id = 0; id < 0x100; id++) {
      var a = Hs80Io.GetFrame(true, ep, id); var h = Old.Get(ep, id);
      Check(a[0] == 0 && Same(a.Skip(1).Take(63).ToArray(), h.Skip(1).ToArray()) && a[64] == 0, "peripheral GET " + id + " is the HS80's after the report id");
    }
    var r = new byte[65]; r[0] = 0; r[1] = 0; r[2] = 2; r[3] = 0; r[4] = 0x2f; r[5] = 0x03;
    Check(Hs80Io.IsReply(true, 8, r) && !Hs80Io.IsReply(false, 8, r) && !Hs80Io.IsEvent(true, 8, r), "a peripheral reply (00 00 02 00 ..) is a reply on the peripheral frame only");
    r[1] = 1; Check(Hs80Io.IsReply(true, 9, r) && !Hs80Io.IsReply(true, 8, r), "who = 1 behind the receiver (09), 0 on the cable (08)");
    r[0] = 1; Check(!Hs80Io.IsReply(true, 9, r), "report 01 (the headset's reply) is not a peripheral reply");
    r[0] = 0; r[2] = 6; Check(!Hs80Io.IsReply(true, 9, r), "no light-write replies on the peripheral frame");
    var ev = new byte[65]; ev[0] = 3; ev[1] = 1; ev[2] = 1; Check(!Hs80Io.IsEvent(true, 9, ev), "no notices read on the peripheral frame");

    // 5. the peripheral SET list: exactly these, nothing else
    var allowed = new Dictionary<int, int[]> { { 0x02, new[] { 0, 1000 } }, { 0x0d, new[] { 0, 1 } }, { 0x0e, new[] { 60000, 3600000 } }, { 0x01, new[] { 1, 4 } }, { 0x21, new[] { 100, 26000 } }, { 0x22, new[] { 100, 26000 } } };
    for (int id = 0; id < 0x100; id++) foreach (var v in new[] { -1, 0, 1, 2, 4, 5, 7, 99, 100, 1000, 1001, 26000, 26001, 59999, 60000, 3600000, 3600001, 7200000 }) {
      int[] lim; bool want = allowed.TryGetValue(id, out lim) && v >= lim[0] && v <= lim[1];
      Check(Hs80Io.PeripheralAllows(id, v) == want && Hs80Io.Allows(true, id, v) == want, "peripheral SET " + id.ToString("x2") + " = " + v + (want ? " allowed" : " refused"));
    }
    foreach (var id in new[] { 0x03, 0x1e, 0x1f, 0x37, 0x46, 0x47, 0x07, 0x06, 0x52, 0xb0, 0x14, 0x15, 0x16 })
      for (int v = -2; v <= 8; v++) Check(!Hs80Io.PeripheralAllows(id, v), "peripheral never sets " + id.ToString("x2"));

    Console.WriteLine(fails.Count == 0 ? "hs80-frame (" + checks + " checks): all good" : "hs80-frame: FAILED (" + fails.Count + "):\n- " + string.Join("\n- ", fails));
    return fails.Count == 0 ? 0 : 1;
  }
}
