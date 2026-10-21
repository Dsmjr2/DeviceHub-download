// Mic test recording (19 Oct 2026, Shawn: record for as long as you want, stop, play it back; "it shouldnt save
// ANYTHING"). Records the headset mic through Windows' normal shared capture, the path Discord and games use, so the
// mic's sound filters (DeviceHub's Cut rumble / Voice clarity) are in it: you hear what others hear. The sound is
// kept only in this process's memory (16-bit mono), never written to a file; it is erased on Clear, on a new
// recording, and when DeviceHub stops. At most 30 seconds, then it stops by itself (Shawn, 19 Oct 2026).
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class MicRec {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr c);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, int flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint n); [PreserveSig] int GetStreamLatency(out long l); [PreserveSig] int GetCurrentPadding(out uint p);
    [PreserveSig] int IsFormatSupported(int m, IntPtr f, out IntPtr c); [PreserveSig] int GetMixFormat(out IntPtr f); [PreserveSig] int GetDevicePeriod(out long d, out long m);
    [PreserveSig] int Start(); [PreserveSig] int Stop(); [PreserveSig] int Reset(); [PreserveSig] int SetEventHandle(IntPtr h);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong pos, out ulong qpc);
    [PreserveSig] int ReleaseBuffer(uint frames); [PreserveSig] int GetNextPacketSize(out uint n);
  }

  public const int MaxSeconds = 30;
  static readonly object lk = new object();
  static MemoryStream pcm;            // the recording: 16-bit little-endian mono samples
  static Thread worker;
  static volatile bool running;
  static int rate;
  static double level = -90;          // peak of the last moment, dB
  static string error;
  static DateTime started;

  // id: the mic's Windows endpoint id (null: Windows' default mic)
  public static Dictionary<string, object> Start(string id) {
    Stop(); Clear();
    lock (lk) { pcm = new MemoryStream(); error = null; level = -90; rate = 0; }
    running = true; started = DateTime.Now;
    worker = new Thread(() => Capture(id)) { IsBackground = true, Name = "mic-rec" };
    worker.Start();
    for (int i = 0; i < 40 && running && rate == 0 && error == null; i++) Thread.Sleep(25);  // until the mic opened (or failed)
    return Status();
  }

  static void Capture(string id) {
    IAudioClient ac = null;
    try {
      var en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
      IMMDevice d;
      if (id != null) Marshal.ThrowExceptionForHR(en.GetDevice(id, out d)); else Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(1, 0, out d));
      var iid = typeof(IAudioClient).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
      ac = (IAudioClient)o; IntPtr fmt; Marshal.ThrowExceptionForHR(ac.GetMixFormat(out fmt));
      int ch = Marshal.ReadInt16(fmt, 2), sr = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14);
      if (bits != 32) throw new Exception("unexpected mic format (" + bits + "-bit)");
      Marshal.ThrowExceptionForHR(ac.Initialize(0, 0, 2000000, 0, fmt, IntPtr.Zero));  // shared mode: filters included
      Marshal.FreeCoTaskMem(fmt);
      var cid = typeof(IAudioCaptureClient).GUID; object co; Marshal.ThrowExceptionForHR(ac.GetService(ref cid, out co));
      var cc = (IAudioCaptureClient)co;
      Marshal.ThrowExceptionForHR(ac.Start());
      lock (lk) rate = sr;
      var f = new float[sr * ch]; var outb = new byte[sr * 2];
      while (running) {
        if ((DateTime.Now - started).TotalSeconds >= MaxSeconds) { running = false; break; }
        Thread.Sleep(15); uint pk;
        int hr = cc.GetNextPacketSize(out pk);
        // the mic went away (unplugged, turned off): stop with an error instead of a frozen timer
        if (hr != 0) { lock (lk) error = "the mic was disconnected"; running = false; break; }
        while (running && pk > 0) {
          IntPtr data; uint frames, flags; ulong p1, p2;
          if (cc.GetBuffer(out data, out frames, out flags, out p1, out p2) != 0) break;
          int n = (int)Math.Min(frames, (uint)sr);
          if ((flags & 2) != 0) Array.Clear(f, 0, n * ch); else Marshal.Copy(data, f, 0, n * ch);
          cc.ReleaseBuffer(frames);
          if (cc.GetNextPacketSize(out pk) != 0) { lock (lk) error = "the mic was disconnected"; running = false; break; }
          double peak = 0;
          for (int i = 0; i < n; i++) {
            double v = f[i * ch]; if (Math.Abs(v) > peak) peak = Math.Abs(v);
            int s = (int)Math.Round(Math.Max(-1, Math.Min(1, v)) * 32767);
            outb[i * 2] = (byte)(s & 0xff); outb[i * 2 + 1] = (byte)((s >> 8) & 0xff);
          }
          lock (lk) { if (pcm != null) pcm.Write(outb, 0, n * 2); level = peak > 0 ? Math.Max(-90, 20 * Math.Log10(peak)) : -90; }
        }
      }
      ac.Stop();
    } catch (Exception e) { lock (lk) error = e.Message; running = false; }
  }

  public static Dictionary<string, object> Status() {
    lock (lk) {
      long bytes = pcm == null ? 0 : pcm.Length;
      return new Dictionary<string, object> { { "recording", running }, { "rate", rate }, { "seconds", rate > 0 ? bytes / 2.0 / rate : 0 },
        { "bytes", bytes }, { "level", Math.Round(level, 1) }, { "error", error }, { "max", MaxSeconds } };
    }
  }

  public static Dictionary<string, object> Stop() {
    running = false;
    var w = worker; if (w != null && w != Thread.CurrentThread) w.Join(2000);
    worker = null;
    return Status();
  }

  // one piece of the recording, base64 (the server joins the pieces into a WAV in its own memory)
  public static string Read(long offset, int length) {
    lock (lk) {
      if (pcm == null || offset < 0 || offset >= pcm.Length) return "";
      var len = (int)Math.Min(Math.Min(length, 1 << 20), pcm.Length - offset);
      var b = new byte[len]; var buf = pcm.GetBuffer(); Buffer.BlockCopy(buf, (int)offset, b, 0, len);
      return Convert.ToBase64String(b);
    }
  }

  // erases the recording from memory
  public static void Clear() {
    lock (lk) { if (pcm != null) { var buf = pcm.GetBuffer(); Array.Clear(buf, 0, buf.Length); pcm.Dispose(); } pcm = null; level = -90; }
  }
}
