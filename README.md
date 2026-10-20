<h1 align="center">DeviceHub</h1>

<p align="center">One Windows app for your mouse, headset, keyboard, monitors and webcam, instead of a vendor app for each.</p>

<p align="center">
  <a href="https://github.com/Dsmjr2/DeviceHub-download/releases/download/v1.0/DeviceHub-Setup.exe"><b>⬇ Download DeviceHub-Setup.exe</b></a>
  &nbsp;·&nbsp; 34 MB &nbsp;·&nbsp; Windows 10 or 11
</p>

## Install in three steps

1. **Download** `DeviceHub-Setup.exe` (link above).
2. **Double-click it.** Windows may say "Windows protected your PC" because the app is not code-signed: click
   **More info**, then **Run anyway**.
3. **DeviceHub opens.** Plug in your devices; the ones it knows show up by themselves. It also starts from the
   Desktop and Start menu shortcut.

Nothing else needs installing: Node.js comes inside. For headset and monitor EQ, DeviceHub's Headset page has a
button that sets up Equalizer APO (free, from its official site).

## What it controls

- **Mice:** Pulsar X-Lite CrazyLight (DPI, polling rate, buttons, lift-off and more)
- **Headsets:** Corsair HS80 RGB Wireless (battery, lights, sidetone, mic boost, EQ); no iCUE needed
- **Keyboards:** any keyboard that supports **VIA** (keys on every layer, knob, macros, lighting)
- **Monitors:** brightness, contrast and speakers (DDC/CI)
- **Webcams:** brightness, contrast, color, focus, exposure, zoom
- **PC lights:** motherboard, fans and RAM, through OpenRGB if you use it
- **Sound:** headset and speaker EQ, mic filters (with Equalizer APO)

Profiles switch everything at once (also automatically when a game starts), and every change is backed up first.

## A device it does not know yet?

Open the installed DeviceHub folder (`%USERPROFILE%\DeviceHub`) in **Claude Code** and say **"set this up"**. It
finds your devices, tells you which ones work straight away, and adds the others one at a time. Lighting > This PC
in the app also gives a ready prompt for each device it recognizes.

<sub>Prefer a zip? <a href="https://github.com/Dsmjr2/DeviceHub-download/releases/download/v1.0/DeviceHub-setup.zip">DeviceHub-setup.zip</a> (unzip, then run Install DeviceHub.bat).</sub>
