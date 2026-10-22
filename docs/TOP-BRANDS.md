# The brands most people own: what DeviceHub needs for each

Written 22 Oct 2026, from market estimates and DeviceHub's brand guide ([BRANDS.md](BRANDS.md)). It answers "if
someone else installs DeviceHub, which devices will they most likely plug in, and what would it take to support
them?" DeviceHub's rules apply to all of it: learn read-only, never flash firmware, back up before every write, one
setting at a time, read it back.

## The top three per kind

The market reports disagree on the numbers (and several are weak), but they agree on the order:

| Kind | 1 | 2 | 3 | Close behind |
|---|---|---|---|---|
| Mouse | Logitech G (about 25-30% of wireless gaming mice) | Razer (about 20-25%) | Corsair | SteelSeries |
| Keyboard | Logitech G (about 14-17%) | Razer (about 9-14%) | Corsair (about 8-12%) | SteelSeries, HyperX |
| Headset | Logitech G | Turtle Beach (about 18-22% of units) | SteelSeries | Razer, HyperX, Corsair |

Sony also sells many headsets, but mostly for PlayStation; on a PC, SteelSeries is the safer third.

## What it takes, by brand

| Brand | Kinds | How its devices talk | Open work to learn from | What DeviceHub would add first | Effort |
|---|---|---|---|---|---|
| **Logitech G** | mouse, keyboard, headset | HID++ 2.0 over USB and the Lightspeed receiver (one receiver can carry several devices) | Solaar, libratbag/Piper, HeadsetControl | battery for all three; mouse DPI stages, polling rate, onboard profiles (back them up first); headset sidetone and auto-off | medium: one well-documented protocol covers most of the range, so it pays off three times |
| **Razer** | mouse, keyboard, headset | Razer's own USB reports (a 90-byte message with a checksum), per-model ids | OpenRazer (very thorough), OpenRGB | mouse DPI, polling, battery, idle sleep; keyboard lights | medium: well documented, but many model-by-model details |
| **Corsair** | mouse, keyboard, headset | the same family as DeviceHub's HS80: a property get/set protocol over USB and the Slipstream receiver | DeviceHub's own HS80 code, OpenLinkHub, ckb-next, HeadsetControl | headsets first (most of the HS80 work carries over: battery, sleep timer, mic light, logos); then mice and keyboards | low for headsets, medium for the rest |
| **Turtle Beach** (incl. ROCCAT) | headset | vendor USB reports | HeadsetControl (some models) | battery, sidetone, mic monitoring | medium: fewer open references |
| **SteelSeries** | headset, mouse | vendor USB reports; the Arctis line is well known | HeadsetControl, rivalcfg (mice) | headset battery, sidetone, auto-off; mouse DPI and lights | low to medium |

## The mapping sheets

One sheet per brand, with models and USB ids, how the devices talk, the settings map (feature or command ids and
value formats, each cited to the open project it comes from), safe reads vs risky writes, a build plan, and the gaps
(researched 22 Oct 2026, read-only, nothing tested on a device):

- [Logitech G](brands/logitech.md): HID++ 2.0 for mice, keyboards and headsets (ASTRO separately). Gaps: some
  current receiver ids (Superlight 2, PRO 2), the PRO X TKL and A50 X ids.
- [Razer](brands/razer.md): the 90-byte report for mice and keyboards, mapped to the byte. Gap: no open project
  covers Razer headsets' battery or settings.
- [Corsair](brands/corsair.md): the HS80's property protocol (bragi) generalized to other headsets, mice and
  keyboards. Gaps: HS65/HS55 unknown; the meaning of the battery status property (0x10).
- [SteelSeries](brands/steelseries.md): three headset message families, rivalcfg's mice, the Apex keyboards.
  Gaps: Apex Pro actuation, Nova Pro ChatMix and ANC; mouse settings cannot be read back.
- [Turtle Beach and ROCCAT](brands/turtle-beach.md): battery on the newest headsets (Airoha RACE), ROCCAT mice and
  keyboards. Gap: no open project sets any Turtle Beach headset setting; it would have to be learned.

The next six (researched the same day, same layout):

- [HyperX](brands/hyperx.md): six headset message formats (Cloud III Wireless, Alpha, II, Flight...). Warning: some
  "reads" change things (one unmutes the Cloud II, one resets the Cloud III's pairing); no mouse DPI is documented.
- [ASUS ROG](brands/asus-rog.md): one command family over ordinary output reports for mice (8K polling), keyboards and
  headsets, from G-Helper; no feature reports needed. Gap: Delta S.
- [Glorious](brands/glorious.md): feature-report protocols; the Sinowealth chip id is shared with other brands (a wrong
  write has bricked Redragon keyboards), so match product id and firmware before any write. GMMK Pro/2 are QMK/VIA.
- [Keychron](brands/keychron.md): VIA (which DeviceHub already speaks) plus Keychron's own commands for debounce,
  sleep timers and report rate; Pro/Max/HE boards need Keychron's JSON file. Mice are undocumented.
- [Wooting](brands/wooting.md): per-key lights and live key depth from Wooting's own open SDKs (feature reports);
  actuation and rapid trigger only in Wootility.
- [Cooler Master](brands/cooler-master.md): only lighting is documented (OpenRGB); DPI, polling and battery are not.

## What needs no learning at all (22 Oct 2026)

- **The shared device library** (`device-library/`): a driver one person made is matched to the next person's USB
  id and installed for them.
- **Batteries Windows already knows** (any Bluetooth device) and devices that declare the standard HID battery fields.
- **Windows Dynamic Lighting (HID LampArray)** lights, from the device's own description.
- **What the maker's app left on the PC** (model names, ids, setting names), read in place.
- And for what is left, Claude changes the settings in the maker's app itself during a learning session
  (`helpers/app-ui.ps1`), so the person only says yes once.

## What already works for anyone, whatever the brand

These need nothing per brand, so a new user gets them on day one:

- **Any USB or Bluetooth headset:** volume, mic level, mute, the equalizer, sound tools and the mic check
  (Windows audio and Equalizer APO).
- **Any VIA keyboard** (Keychron, Epomaker, many others): the key map, the knob, macros and lights, drawn from the
  keyboard's own layout.
- **Any monitor with DDC/CI:** brightness, contrast, speaker volume, color presets.
- **Any standard webcam:** brightness, contrast, zoom and the rest of its controls.
- **PC lights through OpenRGB**, once the person installs it.
- Profiles, auto-switch for games, backups, themes and looks, search, and settings sync.

## Suggested order

1. **Corsair headsets.** Cheapest, because most of the HS80 work carries straight over.
2. **Logitech G.** The biggest share, and one protocol (HID++) covers its mice, keyboards and headsets.
3. **Razer mice.** The second-biggest mouse brand, and OpenRazer documents it thoroughly.
4. **SteelSeries and Turtle Beach headsets.**

Each needs the real device in hand to learn from: read-only first, then one confirmed write at a time.

## Sources

Market estimates (rough; they disagree): [Gaming mouse market, SNS Insider](https://www.snsinsider.com/reports/gaming-mouses-market-11281),
[Mice statistics](https://coolest-gadgets.com/mice-statistics/), [Computer mice companies](https://www.globalgrowthinsights.com/blog/computer-mice-companies-883),
[Gaming keyboard market](https://www.fortunebusinessinsights.com/gaming-keyboard-market-114891), [Gaming mechanical keyboards](https://dataintelo.com/report/gaming-mechanical-keyboard-market),
[Gaming headset market](https://www.intelmarketresearch.com/gaming-headset-market-28848), [Gaming peripherals market](https://www.fortunebusinessinsights.com/gaming-peripherals-market-116535),
[Top gaming headset companies](https://www.sphericalinsights.com/blogs/top-25-companies-in-global-gaming-headsets-market-worldwide-2025-market-research-report-2026-2035).
Protocols and open work: [BRANDS.md](BRANDS.md) (researched 20 Oct 2026).
