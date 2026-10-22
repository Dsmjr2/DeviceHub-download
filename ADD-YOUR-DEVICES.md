# Use DeviceHub with your own devices

DeviceHub was built for one person's mouse, headset and keyboard. You can add yours without Claude (next section), or
with Claude Code (further down). Either way it never flashes firmware.

## Without Claude

1. **Install DeviceHub and plug your devices in.** That is often all it takes. When DeviceHub starts, auto setup
   compares your USB devices with its shared library (11 drivers so far: Logitech, Razer, ASUS ROG and Glorious mice;
   SteelSeries Arctis, Corsair, HyperX and Turtle Beach headsets; Keychron and Wooting keyboards; HyperX mice and
   keyboards). It installs a matching driver by itself when it is "tested" or "read-only";
   the Overview's Set up card lists the others, with an Install button, and says what works now and what is
   left. A read-only driver only reads at first: DeviceHub tests each setting once by writing back its current value,
   and each one that passes can then be changed.
2. **What needs no setup at all:** sound for any USB headset (volume, mic, EQ), monitors over DDC/CI, webcams,
   batteries Windows knows (Bluetooth), Windows Dynamic Lighting devices, and most VIA keyboards.
3. **Learn a device** (in the sidebar under App, on the Set up card, or "Learn it" on Lighting > This PC) for a device
   nothing covers yet. Open the maker's app; DeviceHub listens while you change one setting at a time (a number, an on
   or off, or a choice), finds the bytes that carry it, and makes a driver. It sends nothing to the device while it
   learns. Colors, button remaps, macros and EQ cannot be learned this way yet.
4. **Settings > Optional tools** installs the extra tools when you want them: USBPcap (needed to learn a device),
   Equalizer APO (EQ and mic filters) and ReaPlugs (the mic's Even volume).
5. **Share** what you learned: once the device works, its page has a Share this driver button. It needs a free GitHub
   account and opens a GitHub page that offers the driver to the shared library; nothing leaves your PC until you
   press Submit there. The next person with that device then gets it by itself.

## With Claude Code

Claude finds out what your devices are, checks whether their protocol is already known, and if not, learns it by
listening while you change settings in the maker's own app. It asks before installing anything.

## What you need

- Windows 11, with your devices plugged in.
- **Claude Code** (claude.com/claude-code), signed in.
- **Git** (git-scm.com) and **Node.js 18 or newer** (nodejs.org), or the installer zip, which carries Node.
- Your devices' own apps installed for now (Claude learns from what they send). You can remove them afterwards.
- Google Chrome (or Edge) for DeviceHub's window.

Not in the zip, installed only if you want them (Settings > Optional tools installs or links them; Claude asks first):
- **Equalizer APO** (sourceforge.net/projects/equalizerapo): the headset EQ, monitor EQ and mic filters.
- **ReaPlugs** (reaper.fm/reaplugs): the mic's Even volume.
- **USBPcap** (desowin.org/usbpcap): only to learn a device whose protocol is not known.

**Updates** come from the download page by themselves: Settings shows when a new version is ready, and Update brings it
together with anything changed on your PC. Devices Claude adds for you live in the `my-devices` folder, which is yours:
no update ever changes it. If you or Claude also changed DeviceHub's own files and a new version changes the same
lines, Update stops and names them; say "update DeviceHub" to Claude and it brings the two together.

## Get started

1. Unzip DeviceHub (or clone it) into a folder, e.g. `C:\Users\<you>\DeviceHub`, and run `Install DeviceHub.bat` once.
2. Open that folder in Claude Code (`claude` in a terminal there, or the desktop app with that folder).
3. Say **"set this up"**. That is enough: CLAUDE.md tells Claude to install DeviceHub, find your devices and work
   through them, asking you only before a download or a learning session. If you want to say more, paste this prompt:

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

Claude reports after each step and tells you when it needs you to change something in your device's app.

## Good to know

- **docs/BRANDS.md** lists the 10 most popular brands for headsets, mice, keyboards, cases, graphics cards, CPU
  coolers, RAM and motherboards: how each talks, which open projects already know it, and how risky it is. Start there.
- **PC lights** (motherboard, RAM, fans, many graphics cards) work through OpenRGB, a free app you install yourself;
  DeviceHub talks to it and never writes to that hardware directly.

- A keyboard that works with **VIA** needs nothing: plug it in and DeviceHub finds it and its layout (from VIA's
  library of about 1,500 keyboards). The exception: boards that are not in that library, which include **Keychron's
  Pro, Max, HE and 8K boards** (a Q1 Pro, for one). For those, download the maker's VIA file (the one VIA's "load
  draft definition" takes; Keychron has them on its site, one page per series), save it in the `via-definitions`
  folder as `<VID><PID>.json` (a Q1 Pro, USB 3434:0610, is `34340610.json`), and restart DeviceHub. The Keyboard
  page and Lighting > This PC show the exact file name, with an Open folder button.
- A mouse or headset whose protocol is not documented takes a learning session: you change one setting at a time in
  its app while Claude listens. Plan an hour per device.
- Sound (EQ, mic filters) and monitor brightness work for most headsets and monitors without any learning.
- Everything you set is backed up first, and every change is read back from the device.
- Each device Claude adds gets its own folder in `my-devices` and its own page in DeviceHub, with Undo and changes
  that wait while it is asleep, like the built-in ones.
