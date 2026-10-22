<h1 align="center">DeviceHub</h1>

<p align="center">One Windows app for your mouse, headset, keyboard, monitors and webcam, instead of a vendor app for each.</p>

<p align="center">
  <a href="https://github.com/Dsmjr2/DeviceHub-download/releases/download/v1.0/DeviceHub-Setup.exe"><b>⬇ Download DeviceHub-Setup.exe</b></a>
  &nbsp;·&nbsp; 34 MB &nbsp;·&nbsp; Windows 11 only
</p>

## Install in three steps

1. **Download** `DeviceHub-Setup.exe` (link above).
2. **Double-click it.** Windows may say "Windows protected your PC" because the app is not code-signed: click
   **More info**, then **Run anyway**.
3. **DeviceHub opens.** Plug in your devices; the ones it knows show up by themselves. It also starts from the
   Desktop and Start menu shortcut.

Nothing else needs installing: Node.js comes inside. For headset and monitor EQ, DeviceHub's Headset page has a
button that sets up Equalizer APO (free, from its official site).

To remove it: Windows **Settings > Apps > Installed apps > DeviceHub > Uninstall** (your backups are kept in
Documents).

## What it works with

**With any device of its kind, nothing to set up:**

- **Headsets:** any USB headset: volume, mic level, mic mute and EQ (EQ with Equalizer APO, one click inside DeviceHub)
- **Keyboards:** any keyboard that supports **VIA** (keys on every layer, knob, macros, lighting)
- **Monitors:** any monitor with DDC/CI, which is most: brightness, contrast and speakers
- **Webcams:** any webcam: brightness, contrast, color, focus, exposure, zoom
- **Lights:** USB lights through the OpenRGB inside DeviceHub, and any **Windows Dynamic Lighting** device
- **Batteries:** Bluetooth devices show their battery

**Fully supported models:** Pulsar X-Lite CrazyLight mouse (DPI, polling rate, buttons, lift-off and more) and Corsair HS80
RGB Wireless headset (battery, lights, sidetone, mic boost; no iCUE needed).

**Ready-made drivers** for many Logitech G, Razer, Corsair, SteelSeries, HyperX, ASUS ROG, Glorious, ROCCAT, Keychron and
Wooting mice, keyboards and headsets. DeviceHub finds the right one (press **Install** if it asks), then **Turn on
settings** once: it tests each setting before you use it. Most are new and not yet confirmed on every model; when
yours works, **Tell others it works** in DeviceHub confirms it for everyone.

**Motherboard, fan and RAM lights** work through the free OpenRGB app; DeviceHub shows you how (Lighting > PC lights).

Profiles switch everything at once (also automatically when a game starts), and every change is backed up first.

## A device it does not know yet?

In DeviceHub, **Learn a device** (in the sidebar) makes a driver while you change settings in the maker's app. Or:

Open the installed DeviceHub folder (`%USERPROFILE%\DeviceHub`) in **Claude Code** and say **"set this up"**. It
finds your devices, tells you which ones work straight away, and adds the others one at a time. Lighting > This PC
in the app also gives a ready prompt for each device it recognizes.

<sub>Prefer a zip? <a href="https://github.com/Dsmjr2/DeviceHub-download/releases/download/v1.0/DeviceHub-setup.zip">DeviceHub-setup.zip</a> (unzip, then run Install DeviceHub.bat).</sub>
