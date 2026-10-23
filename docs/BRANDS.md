# Device brands: what DeviceHub can target

Made by `helpers/make-brands.mjs` from `docs/brands.json` (researched 2026-10-20). For anyone adding a device:
find its maker here, then follow "Adding your own devices" in CLAUDE.md. DeviceHub's rules still apply: never flash
firmware, learn read-only, back up before writing, and never write to the SMBus (motherboard and RAM lights) or a
graphics card's I2C bus directly: those go through OpenRGB, which DeviceHub talks to (Lighting > PC lights).

**Risk** is how likely a wrong write is to hurt the device: low = documented protocol over USB; medium = undocumented
or shared chip ids; high = SMBus / I2C, firmware-only tools, or nothing known.

**Shared chip ids**: `2433` Asetek, `0cf2` ENE, `04d9` Holtek, `258a` Sinowealth, `048d` ITE, `0c45` Sonix, `0483` STMicroelectronics, `1a86` QinHeng. These belong to the chip
maker, not the brand; check the product id and name too.

## Headsets

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| Logitech G (incl. ASTRO) | `046d` `9886` | G HUB | USB (vendor messages), Bluetooth | HeadsetControl, OpenRGB | yes | low: vendor HID (HID++), well documented by open projects |
| SteelSeries | `1038` | SteelSeries GG (Engine) | USB (vendor messages), Bluetooth | HeadsetControl, OpenRGB | unconfirmed | low: vendor HID, widely reverse-engineered |
| HyperX | `0951` `03f0` | HyperX NGENUITY | USB (vendor messages) | HeadsetControl, OpenRGB | some models | low: vendor HID |
| Razer | `1532` | Razer Synapse | USB (vendor messages), Bluetooth | OpenRGB, OpenRazer | some models | low: vendor HID, well documented by OpenRazer |
| Corsair | `1b1c` | iCUE | USB (vendor messages) | HeadsetControl, OpenLinkHub | unconfirmed | low: vendor HID |
| Turtle Beach (incl. ROCCAT) | `10f5` `1e7d` | Swarm II | USB (vendor messages), Bluetooth | HeadsetControl, OpenRGB | unconfirmed | low: vendor HID |
| Sony INZONE | `054c` | INZONE Hub | USB (vendor messages), Bluetooth | HeadsetControl | no | low: no lighting; settings only |
| Audeze | `3329` | Audeze HQ | USB (vendor messages), Bluetooth | HeadsetControl | no | medium: vendor app also updates firmware; never trigger it |
| EPOS / Sennheiser | `1395` `1377` | EPOS Gaming Suite | USB (vendor messages), Bluetooth | nothing open | no | low: no lighting; mostly standard USB audio |
| JBL Quantum | not confirmed | JBL QuantumENGINE | USB (vendor messages), Bluetooth | nothing open | unconfirmed | medium: undocumented protocol |

- **Logitech G (incl. ASTRO)**: 9886 is the older ASTRO Gaming ID; newer ASTRO units use 046d. Microsoft says all LIGHTSYNC RGB devices support Dynamic Lighting.
- **SteelSeries**: Microsoft lists SteelSeries as a Dynamic Lighting partner but names no headset models.
- **HyperX**: 0951 is Kingston-era HyperX; newer units use HP's 03f0. HP named HyperX products for Dynamic Lighting.
- **Razer**: HeadsetControl does not list Razer headsets (unconfirmed for battery/sidetone).
- **Corsair**: No official Corsair Dynamic Lighting announcement found.
- **Turtle Beach (incl. ROCCAT)**: 1e7d is ROCCAT, now a Turtle Beach brand.
- **Sony INZONE**: 054c is Sony's main ID, shared with PlayStation gear.
- **Audeze**: Vendor ID 3329 from HeadsetControl (lib/device.hpp; Maxwell 4B19/4B18, Maxwell 2 4B29/4B28); not in usb.ids. device-library/audeze-maxwell (23 Oct 2026).
- **EPOS / Sennheiser**: 1395 is DSEA A/S (EPOS), 1377 is Sennheiser. No open project control found.
- **JBL Quantum**: Harman vendor ID not confirmed from a reliable list. No open project support found.

## Mice

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| Logitech G | `046d` | G HUB | USB (vendor messages), Bluetooth, Windows Dynamic Lighting | libratbag/Piper, Solaar, OpenRGB | yes | low: HID++ is well documented |
| Razer | `1532` | Razer Synapse | USB (vendor messages), Bluetooth, Windows Dynamic Lighting | OpenRazer, OpenRGB | some models | low: vendor HID, documented by OpenRazer |
| SteelSeries | `1038` | SteelSeries GG (Engine) | USB (vendor messages) | libratbag/Piper, Rival, OpenRGB | unconfirmed | low: vendor HID, widely reverse-engineered |
| Corsair | `1b1c` | iCUE | USB (vendor messages) | OpenRGB, OpenLinkHub | unconfirmed | low: vendor HID |
| Glorious | `258a` `22d4` | Glorious CORE | USB (vendor messages) | libratbag/Piper, OpenRGB | unconfirmed | medium: 258a is the Sinowealth chip ID shared by many brands |
| HyperX | `0951` `03f0` | HyperX NGENUITY | USB (vendor messages) | OpenRGB | some models | low: vendor HID |
| ASUS ROG | `0b05` | Armoury Crate | USB (vendor messages), Bluetooth | libratbag/Piper, OpenRGB | some models | low: vendor HID |
| ZOWIE (BenQ) | not confirmed | none (driverless; on-mouse buttons) | USB (vendor messages) | nothing open | no | low: no lighting, no software settings |
| Pulsar | `3710` | Pulsar Fusion | USB (vendor messages) | nothing open | unconfirmed | medium: undocumented protocol |
| ROCCAT (Turtle Beach) | `1e7d` | Swarm II | USB (vendor messages) | libratbag/Piper, OpenRGB | unconfirmed | low: vendor HID |

- **Logitech G**: Onboard-memory writes change stored profiles; back them up first.
- **Razer**: OpenRGB also defines 068e for some Razer Bluetooth devices.
- **SteelSeries**: rivalcfg covers most current SteelSeries mice.
- **Corsair**: Wireless mice go through a Slipstream dongle with the same vendor ID.
- **Glorious**: Glorious has no ID of its own here; OpenRGB matches Sinowealth 258a or Laview 22d4 plus a product ID.
- **HyperX**: Pulsefire models; newer units use HP's 03f0.
- **ASUS ROG**: ASUS ROG is a named Dynamic Lighting partner.
- **ZOWIE (BenQ)**: Vendor ID unconfirmed. Little for DeviceHub to control.
- **Pulsar**: Vendor id 3710 measured on the X-Lite CrazyLight (3710:5406), which DeviceHub runs; no open project documents the protocol (DeviceHub learned it read-only).
- **ROCCAT (Turtle Beach)**: Kone/Burst lines.

## Keyboards

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| Logitech G | `046d` | G HUB | USB (vendor messages), Bluetooth, Windows Dynamic Lighting | OpenRGB, Solaar | yes | low: HID++ documented |
| Razer | `1532` | Razer Synapse | USB (vendor messages), Windows Dynamic Lighting | OpenRazer, OpenRGB | some models | low: vendor HID, documented |
| Corsair | `1b1c` | iCUE | USB (vendor messages) | OpenRGB, OpenLinkHub | unconfirmed | low: vendor HID |
| SteelSeries | `1038` | SteelSeries GG (Engine) | USB (vendor messages) | OpenRGB | unconfirmed | low: vendor HID |
| HyperX | `0951` `03f0` | HyperX NGENUITY | USB (vendor messages), Windows Dynamic Lighting | OpenRGB | some models | low: vendor HID |
| ASUS ROG | `0b05` | Armoury Crate | USB (vendor messages), Windows Dynamic Lighting | OpenRGB | some models | low: vendor HID |
| Keychron | `3434` | Keychron Launcher (web, VIA-based) | VIA / QMK, USB (vendor messages), Bluetooth | VIA/QMK, OpenRGB | unconfirmed | low: VIA protocol is open; avoid flashing |
| Wooting | `31e3` `03eb` | Wootility | USB (vendor messages) | OpenRGB | unconfirmed | low: open RGB SDK from the vendor |
| Ducky | `04d9` | DuckyHub | USB (vendor messages) | OpenRGB | no | medium: 04d9 is Holtek's chip ID, shared with many brands |
| Cooler Master | `2516` | MasterPlus+ | USB (vendor messages) | OpenRGB | unconfirmed | low: vendor HID |
| Epomaker | `342d` | Epomaker Driver | USB (vendor messages), VIA / QMK | VIA/QMK | no | low: VIA keyboards: documented protocol |

- **Logitech G**: All LIGHTSYNC RGB devices support Dynamic Lighting (Microsoft).
- **Razer**: Razer had the largest early Dynamic Lighting device list.
- **Corsair**: No official Corsair Dynamic Lighting announcement found.
- **SteelSeries**: Apex Pro actuation settings are vendor-only.
- **HyperX**: OpenRGB defines both HYPERX_KEYBOARD_VID 0951 and HYPERX_HP_VID 03f0.
- **ASUS ROG**: Microsoft's validated list includes the ROG Scope II Wireless.
- **Keychron**: Older Keychrons use Apple's 05ac ID; treat that as Apple first.
- **Wooting**: 03eb is the old Atmel ID used by early Wooting boards. Wootility also flashes firmware; never trigger it.
- **Ducky**: Match the product ID, not only 04d9.
- **Cooler Master**: 2516 is also used by the AMD Wraith Prism (Cooler Master-made).
- **Epomaker**: DeviceHub runs the P75 over VIA (342d:e479, measured).

## Cases, fans and hubs

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| Corsair | `1b1c` | iCUE | USB (vendor messages) | OpenRGB, liquidctl, OpenLinkHub | unconfirmed | medium: same hub also sets fan speeds |
| NZXT | `1e71` | NZXT CAM | USB (vendor messages) | liquidctl, OpenRGB | unconfirmed | medium: fan control on the same device |
| Lian Li | `0cf2` | L-Connect 3 | USB (vendor messages) | OpenRGB, liquidctl | unconfirmed | medium: 0cf2 is ENE's chip ID; hub also drives fans |
| Thermaltake | `264a` | TT RGB Plus | USB (vendor messages) | OpenRGB | unconfirmed | medium: fan control on the same controller |
| Cooler Master | `2516` | MasterPlus+ / MasterCTRL | USB (vendor messages), board RGB header | OpenRGB | unconfirmed | low: lighting-only controllers |
| HYTE | `3402` | HYTE Nexus | USB (vendor messages) | OpenRGB | unconfirmed | low: vendor HID |
| DeepCool | not confirmed | DeepCool Software | board RGB header, USB (vendor messages) | nothing open | unconfirmed | medium: undocumented protocol |
| Phanteks | not confirmed | none (motherboard software) | board RGB header | nothing open | no | low: lit through the motherboard header |
| Fractal Design | not confirmed | none (case button or motherboard) | board RGB header | nothing open | no | low: no USB lighting device |
| be quiet! | not confirmed | none (motherboard software) | board RGB header | nothing open | no | low: lit through the motherboard header |

- **Corsair**: Read fan curves before any write; a bad write can stop fans.
- **NZXT**: Old HUE+ uses a Microchip ID (04d8) per OpenRGB.
- **Lian Li**: Uni Hub product IDs 7750, a100-a105 under 0cf2.
- **Thermaltake**: Many newer TT products are not in OpenRGB.
- **Cooler Master**: Many CM fans are plain ARGB on a motherboard header.
- **HYTE**: Y60/Y70 cases use the Nexus hub.
- **DeepCool**: No OpenRGB or liquidctl support found; vendor ID unconfirmed. Most fans are plain ARGB.
- **Phanteks**: Control it through the motherboard's ARGB controller.
- **Fractal Design**: Nothing to talk to over USB.
- **be quiet!**: Light Wings fans are plain ARGB; no USB control found.

## Graphics cards

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| ASUS (ROG / TUF) | none (not USB) | Armoury Crate / GPU Tweak III | the graphics card's I2C bus | OpenRGB, liquidctl | no | high: GPU I2C writes; a wrong address can hit other chips |
| MSI | none (not USB) | MSI Center (Mystic Light) | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| Gigabyte / AORUS | none (not USB) | Gigabyte Control Center (RGB Fusion) | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| ZOTAC | none (not USB) | FireStorm | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| EVGA (legacy) | none (not USB) | Precision X1 | the graphics card's I2C bus | OpenRGB, liquidctl | no | high: GPU I2C writes |
| Sapphire | none (not USB) | TriXX | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| PowerColor | none (not USB) | DevilZone RGB | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| XFX | none (not USB) | none confirmed | the graphics card's I2C bus | nothing open | no | high: no open implementation; I2C guessing is unsafe |
| PNY | none (not USB) | VelocityX | the graphics card's I2C bus | OpenRGB | no | high: GPU I2C writes |
| NVIDIA Founders Edition | none (not USB) | none current (legacy LED Visualizer) | the graphics card's I2C bus | OpenRGB | no | medium: goes through the driver API, not raw I2C |

- **ASUS (ROG / TUF)**: Not a USB device. Read-only detection first.
- **MSI**: Model-specific allowlist in OpenRGB; never guess.
- **Gigabyte / AORUS**: Three controller generations; match by PCI subsystem ID.
- **ZOTAC**: Supported list is model-specific.
- **EVGA (legacy)**: EVGA left the GPU market in 2022. OpenRGB's EVGA USB ID 3842 is for other EVGA gear.
- **Sapphire**: Nitro+ cards only.
- **PowerColor**: Newer RX 7000/9000 support unconfirmed.
- **XFX**: No OpenRGB detector found. Leave alone.
- **PNY**: XLR8 models only.
- **NVIDIA Founders Edition**: Mostly a white logo LED. NVIDIA's own USB ID 0955 is for other NVIDIA gear.

## CPU coolers

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| NZXT Kraken | `1e71` `2433` | NZXT CAM | USB (vendor messages) | liquidctl, OpenRGB | unconfirmed | medium: same device sets pump speed |
| Corsair iCUE (H-series) | `1b1c` `2433` | iCUE | USB (vendor messages) | liquidctl, OpenRGB, OpenLinkHub | unconfirmed | medium: pump/fan speed on the same device |
| Lian Li Galahad | `0cf2` | L-Connect 3 | USB (vendor messages) | OpenRGB, liquidctl | unconfirmed | medium: pump control; 0cf2 is a shared ENE ID |
| ARCTIC | not confirmed | none (motherboard software) | board RGB header | OpenRGB | no | low: lighting usually on the motherboard header |
| DeepCool | not confirmed | DeepCool Software | board RGB header, USB (vendor messages) | nothing open | no | medium: undocumented USB display protocol |
| Cooler Master | `2516` | MasterPlus+ / MasterCTRL | USB (vendor messages), board RGB header | OpenRGB | unconfirmed | low: mostly lighting-only |
| be quiet! | not confirmed | none (motherboard software) | board RGB header | nothing open | no | low: lit through the motherboard header |
| Thermaltake | `264a` | TT RGB Plus | USB (vendor messages) | OpenRGB | unconfirmed | medium: pump control on some units |
| EK (EKWB) | `0483` | EK-Connect | USB (vendor messages), board RGB header | OpenRGB | no | medium: 0483 is the shared STMicro ID; pump/fan control |
| ASUS ROG Ryujin / Ryuo | `0b05` | Armoury Crate | USB (vendor messages) | liquidctl, OpenRGB | unconfirmed | medium: pump/fan control and LCD |
| AMD Wraith Prism | `2516` | AMD Wraith Prism RGB Lighting Utility (Cooler Master) | USB (vendor messages), board RGB header | OpenRGB | no | low: lighting-only USB device |

- **NZXT Kraken**: 2433 is Asetek, used by older Krakens.
- **Corsair iCUE (H-series)**: Older H80i/H100i v2 units are Asetek (2433).
- **Lian Li Galahad**: Match the product ID.
- **ARCTIC**: Liquid Freezer ARGB runs from a motherboard header.
- **DeepCool**: Digital-display coolers use USB; vendor ID and open support unconfirmed.
- **Cooler Master**: Many MasterLiquid units are plain ARGB.
- **be quiet!**: Light Loop / Pure Loop ARGB via header.
- **Thermaltake**: Check each model before any write.
- **EK (EKWB)**: Most EK AIOs are plain ARGB.
- **ASUS ROG Ryujin / Ryuo**: Uses the Aura USB vendor ID.
- **AMD Wraith Prism**: Extra entry. Made by Cooler Master, so it shares 2516.

## Memory (RAM)

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| Corsair (Vengeance / Dominator) | none (not USB) | iCUE | the motherboard's SMBus | OpenRGB, liquidctl, OpenLinkHub | no | high: SMBus writes can corrupt RAM SPD |
| G.Skill (Trident Z RGB / Royal / Neo) | none (not USB) | Trident Z Lighting Control | the motherboard's SMBus | OpenRGB | no | high: SMBus writes to the ENE chip; SPD risk |
| Kingston FURY | none (not USB) | Kingston FURY CTRL | the motherboard's SMBus | OpenRGB | no | high: SMBus writes; SPD risk |
| TeamGroup T-Force | none (not USB) | T-FORCE BLITZ | the motherboard's SMBus | OpenRGB | no | high: SMBus writes; SPD risk |
| Crucial (Ballistix legacy) | none (not USB) | Crucial Ballistix M.O.D. (discontinued) | the motherboard's SMBus | OpenRGB | no | high: SMBus writes; SPD risk |
| ADATA XPG (Spectrix) | none (not USB) | XPG Prime | the motherboard's SMBus | OpenRGB | unconfirmed | high: SMBus writes; SPD risk |
| Patriot Viper | none (not USB) | Viper RGB Software | the motherboard's SMBus | OpenRGB | no | high: SMBus writes; SPD risk |
| Thermaltake ToughRAM | none (not USB) | TT RGB Plus | the motherboard's SMBus | nothing open | no | high: SMBus writes, no open implementation |
| PNY XLR8 | none (not USB) | XLR8 RGB software (unconfirmed) | the motherboard's SMBus | nothing open | no | high: SMBus writes, no open implementation |
| Lexar (ARES RGB) | none (not USB) | motherboard sync (no own app confirmed) | the motherboard's SMBus | nothing open | no | high: SMBus writes, no open implementation |

- **Corsair (Vengeance / Dominator)**: Not USB. Read-only detection only unless the user opts in.
- **G.Skill (Trident Z RGB / Royal / Neo)**: Uses the ENE (Aura-style) DRAM controller.
- **Kingston FURY**: Detected by JEDEC manufacturer code in SPD, not a vendor ID.
- **TeamGroup T-Force**: Delta RGB support unconfirmed.
- **Crucial (Ballistix legacy)**: Ballistix line ended in 2022.
- **ADATA XPG (Spectrix)**: ADATA/XPG is a named Dynamic Lighting partner, but no RAM model confirmed.
- **Patriot Viper**: Patriot peripherals use the Sonix USB ID 0c45; RAM does not.
- **Thermaltake ToughRAM**: No OpenRGB detector found. Leave alone.
- **PNY XLR8**: Most XLR8 kits follow the motherboard's sync software. Open support unconfirmed.
- **Lexar (ARES RGB)**: No OpenRGB detector found. Lexar's USB ID 05dc is for its storage products.

## Motherboards

| Brand | USB vendor ids | Maker's app | How it talks | Known to | Dynamic Lighting | Risk |
|---|---|---|---|---|---|---|
| ASUS | `0b05` | Armoury Crate (Aura Sync) | USB (vendor messages), the motherboard's SMBus, board RGB header | OpenRGB, liquidctl | unconfirmed | medium: USB part is safe; SMBus part is high risk |
| MSI | `1462` | MSI Center (Mystic Light) | USB (vendor messages), board RGB header | OpenRGB | unconfirmed | medium: wrong per-board config has broken lighting before |
| Gigabyte / AORUS | `048d` | Gigabyte Control Center (RGB Fusion) | USB (vendor messages), the motherboard's SMBus, board RGB header | OpenRGB, liquidctl | unconfirmed | medium: 048d is the shared ITE chip ID; SMBus path is high risk |
| ASRock | `26ce` | Polychrome Sync | USB (vendor messages), the motherboard's SMBus, board RGB header | OpenRGB | unconfirmed | medium: USB on newer boards; SMBus on older ones is high risk |
| Biostar | not confirmed | VIVID LED DJ | board RGB header | nothing open | no | high: no open implementation |
| NZXT (N-series boards) | `1e71` | NZXT CAM | USB (vendor messages), board RGB header | nothing open | unconfirmed | medium: board lighting protocol unconfirmed |
| EVGA (legacy) | not confirmed | EVGA ELEET X1 | the motherboard's SMBus, board RGB header | nothing open | no | high: SMBus, no confirmed open support |
| Lenovo Legion (desktops) | `17ef` | Lenovo Legion Space / Vantage | USB (vendor messages) | OpenRGB | unconfirmed | medium: OEM board, few users test it |

- **ASUS**: Prefer the Aura USB controller; avoid the SMBus path.
- **MSI**: MSI is a named Dynamic Lighting partner (laptops validated). OpenRGB also uses 0db0 for MSI.
- **Gigabyte / AORUS**: Gigabyte's own ID 0414 is used for its laptops and peripherals.
- **ASRock**: usb.ids lists 1849 for ASRock; OpenRGB uses 26ce for Polychrome USB.
- **Biostar**: No OpenRGB detector found. usb.ids has 04fb for Biostar but no lighting device is confirmed.
- **NZXT (N-series boards)**: N7 boards have an onboard NZXT RGB/fan controller; open support unconfirmed.
- **EVGA (legacy)**: EVGA boards are rare now. OpenRGB has an EVGA SMBus controller but board coverage is unconfirmed.
- **Lenovo Legion (desktops)**: Lenovo is a named Dynamic Lighting partner.

## Windows Dynamic Lighting

- Dynamic Lighting shipped in Windows 11 23H2 (September 2023): Settings > Personalization > Dynamic Lighting.
- Devices implement the open HID LampArray standard on the Lighting and Illumination usage page (0x59), in firmware or through a VHF driver.
- Third-party apps control devices with Windows.Devices.Lights.LampArray: foreground apps since Windows 10 1809, background (ambient) apps since Windows 11 build 23466.
- A background ('ambient') controller must be a packaged app (MSIX or sparse package) declaring the com.microsoft.windows.lighting AppExtension; users rank these apps under 'Background light control'.
- By default a compatible foreground app takes control; the user can turn that off so a background app keeps control.
- A device not picked for background control runs in 'Autonomous mode' (its own firmware effects). Background settings are tied to the USB port.

## OpenRGB

- The SDK server listens on TCP port 6742 by default.
- Every packet starts with a 16-byte header: magic 'ORGB', device index, packet id, data size (32-bit unsigned each, little-endian on x86).
- Packet ids: 0 = request controller count, 1 = request controller data, 40 = request protocol version, 50 = set client name, 100 = device list updated, 1050 = UpdateLEDs, 1100 = SetCustomMode, 1101 = UpdateMode.
- Protocol version is 6 on the master branch (Oct 2026). A client asks with packet 40 and must not use fields newer than the version agreed (the code gates features on version < 5, < 6).
- OpenRGB is licensed under the GNU GPL v2.
- OpenRGB's README warns that its reverse-engineered protocols have damaged or bricked hardware before (e.g. an MSI Mystic Light issue, since fixed). SMBus access (RAM, motherboard) needs extra setup, described in Documentation/SMBusAccess.md.

## Sources

- http://www.linux-usb.org/usb.ids
- https://gitlab.com/CalcProgrammer1/OpenRGB (Controllers/*, NetworkProtocol.h, LICENSE; master 2026-10-19)
- https://github.com/Sapd/HeadsetControl (README device list)
- https://github.com/liquidctl/liquidctl (README device list)
- https://github.com/libratbag/libratbag/tree/master/data/devices
- https://github.com/jurkovic-nikola/OpenLinkHub
- https://github.com/pwr-Solaar/Solaar
- https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/dynamic-lighting-devices
- https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/lighting-dynamic-lamparray
- https://blogs.windows.com/windowsexperience/2023/09/27/dynamic-lighting-is-now-available-on-windows-11/
- https://forum.corsair.com/forums/topic/188772-icue-and-dynamic-lighting/
