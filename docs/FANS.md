# Fan settings in the BIOS (Gigabyte B450 AORUS PRO WIFI, Ryzen 7 5800X3D)

The CPU and case fans follow the motherboard's own fan curve. It runs in the board's chip, reacts every second, uses no
CPU, and keeps working if Windows or DeviceHub stops, so it is the safest place to tune them. DeviceHub's Fans page shows
the graphics card live; it does not read or change these fans.

Written 20 Oct 2026 from Gigabyte's Smart Fan 5 settings. Menu names can differ slightly between BIOS versions; the
numbers are a starting point, not a rule.

## Before you start

- The 5800X3D runs warm by design: 70-80 °C in games is normal, and it slows itself down at 90 °C. Its temperature also
  jumps up and down quickly, which makes fans rev if the curve reacts to every spike. The settings below smooth that.
- Write down what is there now (or take a phone photo of each screen) so you can put it back.

## Steps

1. Restart and press **Delete** while the PC starts, to open the BIOS.
2. Open **Smart Fan 5** (press **F6**, or find it on the main screen or under the PC health / fan section).
3. Pick **CPU_FAN** at the top (the fan on the CPU cooler; a pump shows as CPU_OPT or a pump header).

   | Setting | Set to | Why |
   |---|---|---|
   | Fan Speed Control | **Manual** | lets you set the curve below |
   | Fan Control Use Temperature Input | **CPU** | the cooler follows the CPU |
   | Temperature Interval | **3** (or 4) | how many degrees the temperature must change before the fan changes speed: higher = fewer speed changes, less revving. If your BIOS describes it in seconds instead, a middle value does the same job. |
   | Fan Control Mode | **Auto** (or **PWM** for a 4-pin fan) | Auto detects it |
   | Fan Stop | **Disabled** | the CPU fan should always turn |
   | Fan Fail Warning | **Enabled** | warns if the CPU fan stops |

   Curve (drag the points, or type them):

   | CPU temperature | Fan speed |
   |---|---|
   | 40 °C | 30 % |
   | 50 °C | 35 % |
   | 60 °C | 45 % |
   | 70 °C | 60 % |
   | 80 °C | 85 % |
   | 85 °C | 100 % |

4. Pick each case fan (**SYS_FAN1**, **SYS_FAN2**, ...):

   | Setting | Set to | Why |
   |---|---|---|
   | Fan Speed Control | **Manual** | |
   | Fan Control Use Temperature Input | **System 1** (or a **PCIe** / **VRM** sensor if your BIOS has one) | case fans should follow the inside of the case, not the CPU's spikes; a PCIe sensor sits near the graphics card |
   | Temperature Interval | **3** | |

   Curve: 40 °C 30 %, 55 °C 40 %, 65 °C 55 %, 75 °C 80 %.

5. Press **F10** to save and restart.

## Afterwards

- Play a game for 15 minutes. If it is quiet and the CPU stays under about 85 °C, you are done.
- Too loud while gaming: lower the 70 °C and 80 °C points by 5-10 %. Too hot: raise them.
- The BIOS shows the CPU temperature under its PC health / hardware monitor screen. DeviceHub's Fans page shows the
  graphics card; with a cool card its fans stop, which is normal.
- To undo everything: set Fan Speed Control back to **Normal** on each fan, or load the BIOS defaults (F7).

## Why DeviceHub does not control these fans itself

Changing the board's fan speeds from Windows means writing to its fan chip through a kernel driver (PawnIO), the same
kind of low-level access DeviceHub never does for lights either. If that program hung with the fans set low, the PC
could overheat; the BIOS curve cannot hang. If software fan control is ever wanted (for example case fans that follow
the graphics card), the safe route is a proven open-source engine (LibreHardwareMonitor, as the FanControl app uses)
with the BIOS curve as the fallback.
