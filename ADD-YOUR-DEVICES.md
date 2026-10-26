# Use DeviceHub with your own devices

DeviceHub connects to your mouse, headset and keyboard automatically using its built-in drivers, shared device library, VIA keyboard support, and Windows sound and battery features. It never flashes firmware.

## How it works

1. **Install DeviceHub and plug your devices in.** That is often all it takes. When DeviceHub starts (or when you plug a device in), auto setup
   compares your USB devices with its shared library (21 drivers: Logitech, Razer, ASUS ROG, Glorious,
   SteelSeries, Corsair, HyperX and ROCCAT mice; Logitech, SteelSeries Arctis, Corsair, HyperX, Audeze Maxwell, Astro A50 and Turtle Beach headsets; Logitech,
   Razer, Corsair, Keychron, Wooting, ROCCAT, HyperX and SteelSeries Apex keyboards) and installs a matching driver by itself.
   What a driver does once installed: every library or learned driver without a prior real-device test record only reads at first. Its settings stay
   read-only until you press **Turn on settings** on its page or on the Set up card. DeviceHub then writes each
   setting's current value back once and reads it the same to make sure it works; each one that passes can then be
   changed. (A driver whose device.json records a run on a real device does that check by itself when it connects.)
   Nothing is installed for a device DeviceHub already runs itself.
2. **What needs no setup at all:** sound for any USB or wired 3.5mm headset (volume, mic, EQ), monitors over DDC/CI, webcams,
   batteries Windows knows (Bluetooth), Windows Dynamic Lighting devices, and most VIA keyboards.
3. **Learn a device** (in the sidebar under App, or on the Set up page) for a device
   nothing covers yet. Open the maker's app; DeviceHub listens while you change one setting at a time (a number, an on
   or off, or a choice), finds the bytes that carry it, and makes a driver. It sends nothing to the device while it
   learns. Colors, button remaps, macros and EQ cannot be learned this way yet.
4. **Settings > Optional tools > Show** installs the extra tools when you want them: USBPcap (needed to learn a
   device), Equalizer APO (EQ and mic filters; it comes inside DeviceHub, so nothing is downloaded, and the Equalizer
   card has the same button) and ReaPlugs (the mic's Even volume).
5. **Share** what you learned: once the device works, its page has a Share this driver button. It needs a free GitHub
   account and opens a GitHub page that offers the driver to the shared library; nothing leaves your PC until you
   press Submit there. The next person with that device then gets it by itself.

## What comes inside DeviceHub

- **Equalizer APO** (sourceforge.net/projects/equalizerapo): the headset EQ, monitor EQ and mic filters. Its installer
  is included; it installs when you press its button in Settings > Optional tools > Show, or on the Equalizer card.
- **OpenRGB 1.1** (openrgb.org): PC lights on USB, plus one-click setup for motherboard, fan header and RAM lights using the signed PawnIO driver.

Optional extras (installed only if you want them from Settings > Optional tools):
- **ReaPlugs** (reaper.fm/reaplugs): the mic's Even volume.
- **USBPcap** (desowin.org/usbpcap): only needed to learn a device whose protocol is not yet in the library.

**Updates** come from the download page by themselves: Settings shows when a new version is ready, and Update installs it while keeping your `my-devices` folder and settings intact.

## Optional: Using AI (Claude Code)

If you have **Claude Code** (or another AI coding assistant), you can also use the **Copy prompt** button on any unknown device (or paste the prompt below in the DeviceHub folder) to have it inspect your USB descriptors and write a custom `my-devices/` driver for you:

```
Read CLAUDE.md first and follow its rules exactly. I want DeviceHub to run my own devices instead of the ones it was
built for. My devices are:
- Mouse: <brand and model, e.g. Logitech G Pro X Superlight 2>
- Headset: <brand and model>
- Keyboard: <brand and model>
Start with step 1 of "Adding your own devices": find them on this PC, read-only, and tell me what you found. Then for
each device tell me whether its protocol is already known (step 2) or has to be learned (step 3), and what you need
from me. Do one device at a time. Ask me before installing or downloading anything, and never flash firmware.
```

## Good to know

- **docs/BRANDS.md** lists the 10 most popular brands for headsets, mice, keyboards, cases, graphics cards, CPU
  coolers, RAM and motherboards: how each talks, which open projects already know it, and how risky it is.
- **PC lights** work through OpenRGB. USB lights work with the OpenRGB 1.1 built into DeviceHub. The motherboard, RAM
  and many graphics cards use OpenRGB with its PawnIO driver. DeviceHub talks to OpenRGB
  and never writes to that hardware directly.
- **Writing a driver?** A driver (device.mjs or driver.json) may add `batteryCare: { lowBattery: { key, value },
  charging: { key, value } }` to name the one setting DeviceHub turns down on a low battery or while charging
  (docs/DRIVER-FORMAT.md, Battery care).
- A keyboard that works with **VIA** needs nothing: plug it in and DeviceHub finds it and its layout (from VIA's
  library of about 1,500 keyboards). The exception: boards that are not in that library, which include **Keychron's
  Pro, Max, HE and 8K boards** (a Q1 Pro, for one). For those, download the maker's VIA file (the one VIA's "load
  draft definition" takes; Keychron has them on its site, one page per series), save it in the `via-definitions`
  folder as `<VID><PID>.json` (a Q1 Pro, USB 3434:0610, is `34340610.json`), and restart DeviceHub. The Keyboard
  page shows the exact file name, with an Open folder button.
- Sound (EQ, mic filters) and monitor brightness work for most headsets and monitors without any learning.
- Everything you set is backed up first, and every change is read back from the device.
- Each device Claude adds gets its own folder in `my-devices` and its own page in DeviceHub, with Undo and changes
  that wait while it is asleep, like the built-in ones.
