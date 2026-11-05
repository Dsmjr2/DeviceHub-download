# Acer fans, sensors and charge limit (3 Nov 2026)

Shawn: "Can you set a fan speed controller like the nitro app and max charge while plugged in in the laptop area", and
the PC page's temperatures as quick and accurate as NitroSense.

## What it is

Laptop page > **Fans and charging** (only on an Acer with the `AcerGamingFunction` WMI class). Acer's WMI answers a
standard user "Access denied", so it follows Add board, fan and RAM lights and Pause Wi-Fi scans:

- **Set up fan and charge controls** (the person's click): ONE Windows admin prompt copies
  `helpers/acer-control.ps1` (pinned by `SCRIPT_SHA256` in `helpers/acer-control.mjs`, refused before the prompt if it
  changed) to `C:\Program Files\DeviceHub Acer\`, checks its SHA-256 there, and registers five S4U tasks with highest
  rights, one fixed `-Mode` each: `read`, `fans-auto` (also at every sign-in), `fans-max`, `health-on`, `health-off`.
  Any failure removes everything. **Remove** sets the fans to Auto, then deletes the tasks and the folder.
- **Readings** (no prompt after setup): while the Laptop page shows, DeviceHub touches
  `%TEMP%\DeviceHub-acer-want.txt` every second; the read task writes `readings.json` (CPU, GPU and case temperatures,
  both fan RPMs, both fan modes, charge limit) each second, and ends 20 s after the page closes.
- **Fan mode Auto / Max** and **Charge limit** (Acer's battery health mode, about 80%): each a click. Refused while
  NitroSense or PredatorSense is open (Auto is always allowed). The script reads, writes once, reads back;
  `result.json` says before, after, and ok only when the read-back matches.
- **Max is never left on**: back to Auto on Auto, on DeviceHub's quit, on DeviceHub's next start after a crash, when
  DeviceHub stops answering for 15 s (the task's own watcher), after 4 hours, and at every sign-in.

## The calls (documented only)

- `AcerGamingFunction` (Linux `drivers/platform/x86/acer-wmi.c`, WMID_GUID4): GetGamingSysInfo 5 (sensors, `(id << 8)
  | 1`), GetGamingFanBehavior 15, SetGamingFanBehavior 14 (modes 1 Auto, 2 Turbo/Max). Never a fan speed or fan table:
  a custom percent would need a task per value, and the firmware's thermal protection is never touched.
- `BatteryControl` (github.com/frederik-h/acer-wmi-battery): GetBatteryHealthControlStatus 20,
  SetBatteryHealthControl 21 with mask 1 (health mode only).

## Not done yet

- Tried on this Nitro ANV15-41 only through stand-ins (`tests/acer-control.mjs`); the live check needs Shawn's click
  and the UAC prompt: Set up, then Auto -> Max -> Auto and charge limit on -> off, with NitroSense closed.
- The Acer readings are not yet fed into the PC page's cards (they show on the Laptop page).
- No custom fan curve (and so no 95 °C fallback for one): only Auto and Max exist.
