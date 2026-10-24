// DeviceHub's CPU temperature and fan reader (24 Oct 2026, docs/handoff/display-health.md). READ ONLY.
// helpers/cpu-sensors.mjs copies this file into C:\Program Files\DeviceHub sensors\ under the one admin prompt, beside
// the LibreHardwareMonitorLib.dll files taken from LibreHardwareMonitor's official release zip, and checks every file's
// SHA-256 there. No .exe is ever made (24 Oct 2026: Shawn's AppControl notifies on every unsigned .exe that starts):
// the scheduled task "DeviceHub sensors" (no trigger: it runs only when DeviceHub asks, with highest rights) runs
// Windows' own signed powershell.exe on reader.ps1 (cpu-sensors.mjs readerScript), which checks the same hashes again,
// compiles this source in memory (CodeDom, as Add-Type does) and calls DeviceHubSensors.Start(folder, want).
//
// What it does: opens LibreHardwareMonitor for the CPU and the motherboard (its SuperIO fan chip) only, and every 2 s
// writes the temperatures and fan speeds to readings.json in its own folder. Nothing else is enabled (no GPU, RAM,
// storage, network, USB controllers or PSU), so it never touches the SMBus or a USB device DeviceHub drives.
// It never sets a fan, a control or any other value: there is no write call in this file.
// It stops by itself when the "want" file (its one argument, touched by DeviceHub only while the Temperatures and fans
// card is on screen) is more than 20 s old or missing. Only one copy runs at a time.
// C# 5 (the compiler that ships with Windows' .NET Framework): no string interpolation, no expression bodies.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;

public static class DeviceHubSensors
{
    const int EveryMs = 2000;
    const int WantSeconds = 20;
    static string Dir;

    // dir: the protected folder (the DLLs and readings.json); want: the file DeviceHub touches
    public static int Start(string dir, string want)
    {
        if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(want)) return 2;
        Dir = dir;
        // LibreHardwareMonitor's own dependencies, from this folder only
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        bool first;
        using (Mutex one = new Mutex(true, "Global\\DeviceHubSensorsReader", out first))
        {
            if (!first) return 0;
            return Run(want, Path.Combine(Dir, "readings.json"));
        }
    }

    static Assembly Resolve(object sender, ResolveEventArgs e)
    {
        string name = new AssemblyName(e.Name).Name;
        if (name.IndexOfAny(new char[] { '\\', '/', ':' }) >= 0) return null;
        string p = Path.Combine(Dir, name + ".dll");
        return File.Exists(p) ? Assembly.LoadFrom(p) : null;
    }

    // DeviceHub touches this file while the card is on screen
    public static bool Wanted(string want)
    {
        try
        {
            DateTime t = File.GetLastWriteTimeUtc(want);
            if (t.Year < 2000) return false;
            double age = (DateTime.UtcNow - t).TotalSeconds;
            return age < WantSeconds && age > -60;
        }
        catch { return false; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Run(string want, string outFile)
    {
        LibreHardwareMonitor.Hardware.Computer c = new LibreHardwareMonitor.Hardware.Computer();
        c.IsCpuEnabled = true;
        c.IsMotherboardEnabled = true;
        string openError = null;
        try { c.Open(); } catch (Exception ex) { openError = ex.Message; }
        try
        {
            while (Wanted(want))
            {
                string json;
                try { json = Snapshot(c, openError); }
                catch (Exception ex) { json = "{\"v\":1,\"at\":" + Str(DateTime.UtcNow.ToString("o")) + ",\"error\":" + Str(ex.Message) + ",\"hardware\":[]}"; }
                Save(outFile, json);
                Thread.Sleep(EveryMs);
            }
        }
        finally
        {
            try { c.Close(); } catch { }
            try { File.Delete(outFile); } catch { }
        }
        return 0;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static string Snapshot(LibreHardwareMonitor.Hardware.Computer c, string openError)
    {
        StringBuilder b = new StringBuilder();
        b.Append("{\"v\":1,\"at\":").Append(Str(DateTime.UtcNow.ToString("o")));
        b.Append(",\"error\":").Append(openError == null ? "null" : Str(openError));
        b.Append(",\"hardware\":[");
        bool firstHw = true;
        foreach (LibreHardwareMonitor.Hardware.IHardware h in c.Hardware)
        {
            List<LibreHardwareMonitor.Hardware.IHardware> all = new List<LibreHardwareMonitor.Hardware.IHardware>();
            all.Add(h);
            h.Update();
            foreach (LibreHardwareMonitor.Hardware.IHardware s in h.SubHardware) { s.Update(); all.Add(s); }
            foreach (LibreHardwareMonitor.Hardware.IHardware x in all)
            {
                if (!firstHw) b.Append(',');
                firstHw = false;
                b.Append("{\"name\":").Append(Str(x.Name));
                b.Append(",\"type\":").Append(Str(x.HardwareType.ToString()));
                b.Append(",\"parent\":").Append(x == h ? "null" : Str(h.Name));
                b.Append(",\"sensors\":[");
                bool firstS = true;
                foreach (LibreHardwareMonitor.Hardware.ISensor s in x.Sensors)
                {
                    if (s.SensorType != LibreHardwareMonitor.Hardware.SensorType.Temperature && s.SensorType != LibreHardwareMonitor.Hardware.SensorType.Fan) continue;
                    if (!firstS) b.Append(',');
                    firstS = false;
                    b.Append("{\"name\":").Append(Str(s.Name));
                    b.Append(",\"type\":").Append(Str(s.SensorType.ToString()));
                    b.Append(",\"value\":").Append(s.Value.HasValue && !float.IsNaN(s.Value.Value) && !float.IsInfinity(s.Value.Value) ? s.Value.Value.ToString("0.##", CultureInfo.InvariantCulture) : "null");
                    b.Append('}');
                }
                b.Append("]}");
            }
        }
        b.Append("]}");
        return b.ToString();
    }

    static void Save(string outFile, string json)
    {
        string tmp = outFile + ".tmp";
        try
        {
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            if (File.Exists(outFile)) File.Replace(tmp, outFile, null); else File.Move(tmp, outFile);
        }
        catch { try { File.Delete(tmp); } catch { } }
    }

    static string Str(string s)
    {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        foreach (char ch in s)
        {
            if (ch == '"') b.Append("\\\"");
            else if (ch == '\\') b.Append("\\\\");
            else if (ch < ' ') b.Append("\\u").Append(((int)ch).ToString("x4"));
            else b.Append(ch);
        }
        return b.Append('"').ToString();
    }
}
