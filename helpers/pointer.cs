// Windows pointer settings (the "Mouse parameters" the Pulsar app shows), through SystemParametersInfo. These live in
// Windows, not on the mouse. In the native helper's "pointer" channel since 21 Oct 2026 (it was a PowerShell script
// started for every change, ~680 ms; a slider now follows while dragged).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Pointer {
  [DllImport("user32.dll", SetLastError = true)] static extern bool SystemParametersInfo(uint a, uint b, ref int v, uint f);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SystemParametersInfo(uint a, uint b, int[] v, uint f);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SystemParametersInfo(uint a, uint b, IntPtr v, uint f);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  const uint SAVE = 3; // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
  static int Speed() { int v = 0; SystemParametersInfo(0x70, 0, ref v, 0); return v; }
  static int[] Accel() { var a = new int[3]; SystemParametersInfo(0x03, 0, a, 0); return a; }
  static int Lines() { int v = 0; SystemParametersInfo(0x68, 0, ref v, 0); return v; }

  // speed 1-20, precision true/false, scrollLines 1-100 (-1 = one page), doubleClick ms
  public static Dictionary<string, object> Read() {
    int lines = Lines();
    return new Dictionary<string, object> { { "ok", true }, { "speed", Speed() }, { "precision", Accel()[2] != 0 },
      { "scrollLines", lines == -1 || lines > 100 ? -1 : lines }, { "doubleClick", (int)GetDoubleClickTime() } };
  }

  // sets ONE of them (saved to the user profile), then reads them all again
  public static Dictionary<string, object> Set(string key, int v) {
    switch (key) {
      case "speed": if (v < 1 || v > 20) throw new ArgumentException("speed 1-20"); Ok(SystemParametersInfo(0x71, 0, (IntPtr)v, SAVE)); break;
      // "Enhance pointer precision" = acceleration on, with Windows' default thresholds 6 and 10
      case "precision": Ok(SystemParametersInfo(0x04, 0, v != 0 ? new int[] { 6, 10, 1 } : new int[] { 0, 0, 0 }, SAVE)); break;
      case "scrollLines": if (v != -1 && (v < 1 || v > 100)) throw new ArgumentException("lines 1-100 or -1"); Ok(SystemParametersInfo(0x69, (uint)v, IntPtr.Zero, SAVE)); break;
      case "doubleClick": if (v < 200 || v > 900) throw new ArgumentException("200-900 ms"); Ok(SystemParametersInfo(0x20, (uint)v, IntPtr.Zero, SAVE)); break;
      default: throw new ArgumentException("unknown setting " + key);
    }
    return Read();
  }
  static void Ok(bool done) { if (!done) throw new Exception("Windows refused"); }
}
