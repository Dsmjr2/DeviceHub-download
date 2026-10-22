# Library drivers, round 3a: Logitech headsets and keyboards, Razer keyboards (22 Oct 2026)

Three new ready-made drivers in `device-library/`, so owners of the largest brands' other device types need neither
the maker's app nor Claude. All three are `device.mjs` drivers, status **untested** (`tested: []`): DeviceHub offers
them with an Install button, loads them read-only, and its self-check unlocks each write once it reads back on the real
device. **Nothing was sent to a real device**, DeviceHub was not restarted, and no existing driver folder, test,
helper code, `server.js`, `package.json`, `CLAUDE.md` or `public/*` file was edited.

## Sources (every command in the code cites one of these beside it)

| Project | Commit | Files read |
|---|---|---|
| Solaar | `e7304c4c451cc9bb4f206a914844525e67856a28` | `lib/logitech_receiver/`: `hidpp20_constants.py`, `settings_templates.py`, `settings.py`, `settings_validator.py`, `hidpp20.py`, `special_keys.py`, `descriptors.py`, `base_usb.py`, `base.py` |
| HeadsetControl | `91ee690a5e302a10a6f4f75a46be05846a38a3b0` | `lib/devices/`: `logitech.hpp`, `logitech_g633_g933_935.hpp`, `logitech_gpro.hpp`, `logitech_g535.hpp`, `logitech_g533.hpp`, `logitech_g432.hpp`, `logitech_gpro_x2_lightspeed.hpp`, `logitech_g522_lightspeed.hpp`, `protocols/hidpp_protocol.hpp`, `protocols/logitech_centurion_protocol.hpp` |
| libratbag | `8235b5bb6032dea15901ab58a8218956f4494d08` | `src/hidpp20.h` (`struct hidpp20_onboard_profiles_info`) |
| OpenRazer | `477f4d6d3ab7e9deb6310d5bd3742560c5cbe80d` | `driver/razerkbd_driver.c`, `razerkbd_driver.h`, `razerchromacommon.c`, `razercommon.h`, `razercommon.c` |

The shared parts of the mouse drivers (HID++ framing, feature lookup, reply matching and error codes; the Razer CRC,
report builder and parser) are **copied** into each new folder, not imported: an installed driver lives in
`my-devices\<name>\`, where a sibling library folder is not there to import from.

## 1. `logitech-hidpp-headset`

Ids: G633 0A5C, G635 0A89, G933 0A5B, G935 0A87, G733 0AB5 / 0AFE / 0B1F, G PRO 0AA7, PRO X 0AAA / 0ABA, PRO X 2 HID++
0AFB / 0AFC (collection FF43 / 0202), G535 0AC4 (interface 3, page 0C / 01), PRO X 2 LIGHTSPEED 0AF7 (Centurion,
interface 3, page FFA0 / 01, report 0x51, 64-byte frames).

| Setting | HID++ 2.0 headsets | PRO X 2 LIGHTSPEED (Centurion) |
|---|---|---|
| Battery | 0x1004 / 0x1000, else 0x1F20 fn 0x00: mV, bit0 valid, bit1 charging (Solaar `decipher_adc_measurement`, voltage curve `estimate_battery_level_percentage`) | 0x0104 fn 0x00: b0 %, b2 1 / 2 = charging (HC `parseCenturionBatteryResponse`) |
| Sidetone (slider) | 0x8300 read 0x00 -> b0, write 0x10 [level], 0-100 (Solaar `Sidetone`; HC `07 1A level`) | 0x0604 read 0x00, write 0x10 [01 FF level] (v2+) or [01 level]; range = gain steps from fn 0x20 b2 (Solaar `HeadsetSidetone`); an unchanged level is sent too (driver-safety.md) |
| Turn off when idle | 0x1F20 v2+ read 0x10 / write 0x20, 0-255 min (Solaar `ADCPower`); G535 a choice of 0/1/2/5/10/15/30 (HC `validateInactiveTime`) | 0x0108 read 0x00 / write 0x10, the other timer slots sent back as read (Solaar `_AutoSleepRangeValidator`: v4+ 3 bytes, v3 2 bytes slot 1) |
| Mic muted (display) | 0x0601 read fn 0x10 (Solaar `HeadsetMicMute`); the write fn 0x20 is never sent | the same through the bridge |
| EQ per band (sliders) | 0x8310: caps 0x00, band Hz 0x10 [g*7], read 0x20 [00], write 0x30 [02, gains], the other bands sent back as read (Solaar `Equalizer`) | not covered |

Centurion framing is exactly HeadsetControl's, with the options `logitech_gpro_x2_lightspeed.hpp` turns on
(`exact_direct_length`, `detect_connection_events`, `lookup_features_by_id`): Root.getFeature(0x0003) on the dongle
finds the bridge; bridged requests are `[bridge, 0x11, size, 00, sub index, fn|01, params]`; the bridge's ack is
skipped, a disconnect event or a pre-ack refusal is reported as "switched off".

**Not covered**: lights (HC `04 3C`, write-only), PRO X 2 EQ (0x020D / 0x0636, no plain read of the same value), G432 /
G433 / G431 and G533 sidetone (HC writes fixed bytes, no read), G522 (Solaar probes its device address), G435 and ASTRO
A50 X (in neither project), ASTRO A50 Gen 4 / 5 (their own protocol).

## 2. `logitech-hidpp-keyboard`

Ids: G915 C33E, G915 TKL C343, G815 C33F, G515 LIGHTSPEED TKL C355, G512 C33C, G213 C336, PRO C339; receivers C541
(G915) and C545 (G915 TKL). A device on a receiver with 0x2201 (a mouse) is refused.

| Setting | Feature and functions | Source |
|---|---|---|
| Battery | 0x1004 / 0x1000 / 0x1001 | sheet section 3 |
| Report rate (choice) | 0x8061 list 0x10 / read 0x20 / write 0x30, else 0x8060 list 0x00 / read 0x10 / write 0x20; host mode only | Solaar `ExtendedReportRate`, `ReportRate` |
| Settings source (choice) | 0x8100 read 0x20 / write 0x10 [01 / 02] | Solaar `OnboardProfiles` |
| Onboard profile (choice, select only) | count 0x8100 fn 0x00 byte 3; read fn 0x40 (2-byte sector), select fn 0x30 [sector]; onboard mode only; a built-in read-only profile (0x100 + n) is shown in info only | libratbag `hidpp20_onboard_profiles_info`; Solaar `OnboardProfiles` |
| Windows key off, Caps / Num / Scroll Lock / Insert off (toggles) | 0x4521 caps 0x00, read 0x10, write 0x20, other bits sent back as read | Solaar `DisableKeyboardKeys`, `special_keys.DISABLE` |
| F-keys do their special function (toggle) | 0x40A2, else 0x40A0: read 0x00 b0, write 0x10 [01 / 00] | Solaar `NewFnSwap`, `FnSwap` |
| Backlight brightness | 0x8040 info 0x00 (max, steps, on/off cap, min), read 0x10, write 0x20, on/off 0x30 / 0x40; a choice of Solaar's `halving_marks` when the keyboard has 2+ steps | Solaar `BrightnessControl` |

The task asked for profile **select** only; the Settings source switch (the same one the mouse driver has) is
included because the report rate is only changed live in host mode. The library self-check writes the mode it read,
so it never switches a keyboard. Profile memory (0x8100 fn 0x50-0x80) is refused in `call()` like the mouse driver.

**Not covered**: profile editing, lights (0x8071 / 0x8081, no read-back), G-key / M-key remaps, a game mode beyond the
key locks, the K375s-style 0x40A3 swap, PRO X TKL / G915 X (no ids in any source). Receiver C547 was added later
(driver-safety.md), and the onboard profile is now shown only, never selected (driver-safety.md).

## 3. `razer-keyboard`

30 ids (BlackWidow V4 family, V3 family, Huntsman V3 Pro family, Huntsman V2 / V2 TKL / Mini, DeathStalker V2 family,
Ornata V3 family), each with OpenRazer's interface (`razer_get_report_params` report_index: 3, 2 or the default 1),
wait (600 us, 4.9 ms wireless) and the transaction id OpenRazer uses for that keyboard and command. Channel: feature
only, any usage page (it moves with firmware), chosen by interface and the 91-byte feature report.

| Setting | Commands (class/id) | Notes |
|---|---|---|
| Backlight brightness 0-255 | get 0F/84 [01 05], set 0F/04 [01 05 v] | Huntsman V3 Pro / Mini: written 0F/04 tid 1F, read 03/83 tid FF (as OpenRazer); 8KHz: written to the active store (05/84), refused unless that is store 1; V3 Pro TKL: none (OpenRazer has no read) |
| Game mode (toggle) | get 03/80 [store 08], set 03/00 [store 08 0/1] | VARSTORE tid FF; Huntsman V2 / TKL NOSTORE tid 1F. OpenRazer: the firmware game mode, which locks the Windows key |
| Macro light (toggle) | the same on LED 07 | only where `razer_kbd_probe` creates `macro_led_state` |
| Polling rate (choice) | get 00/C0 (size 1, reply [1]), set 00/40 [00 code] once | BlackWidow V4 / V4 Pro / V4 75% / V4 TKL HyperSpeed, Huntsman V2 / TKL; 125-1000 Hz offered, higher rates once the keyboard reads at one |
| Low-battery warning (raw 12-63) | get 07/81, set 07/01 | BlackWidow V3 Pro only, tid FF |
| Battery, charging | 07/80, 07/84, reply [1] | wireless boards; tid 9F on the dongle, 1F / 3F wired |

Replies follow `razer_send_payload`: remaining packets, class and id must match, and busy counts as success
("Some commands respond with 'busy' but succeed"). Every setting is offered only when its read answers.

**Not covered**: static colour per zone and all effects (OpenRazer's `matrix_effect_*` files are write-only, so the
`color` kind was not used), the Fn toggle 02/06 (write-only), keyswitch optimization, device mode, profile LEDs,
macros and remaps (host-side in OpenRazer), the BlackWidow V3 TK.

## Safety

- Every request goes through one function per transport that sends only its allow list (`ALLOWED` / `C_ALLOWED` /
  `CMD`); DFU 0x00C0-0x00C3 / 0x00D0, Centurion DFU 0x010A, reset 0x1802, OOB 0x1805, force pairing 0x1500, BLE
  pre-pairing 0x1816 and Lightspeed pairing 0x0309 are in both Logitech drivers' `NEVER` and are never looked up.
- Every write: value checked first, then refused while G HUB (`lghub*.exe`) or Razer Synapse / App Engine runs
  (`waiting: true`, so the self-check retries later), then one write, then a read of the same value.
- `helpers/never-commands.json` gained (beside, not over, another session's Corsair / SteelSeries additions):
  - Logitech 0x0309 and 0x1816 (bytes null: reached by a run-time index);
  - Razer `?? ?? ?? ?? ?? ?? 00 46`, `.. 00 41`, `.. 00 42` (HyperPolling dongle pair / unpair);
  - Razer `.. 00 04 02` (device mode 02, "some sort of factory test mode").

## Tests

`tests/sim-logitech-headset.mjs`, `tests/sim-logitech-keyboard.mjs`, `tests/sim-razer-keyboard.mjs`: simulated devices
written from the sources, expected bytes typed by hand. Each covers every setting: write, read back, put back, out of
range refused, refused while the maker's app runs (nothing sent), the never list (no never id looked up or sent;
the allow lists refuse even direct calls), device.json well formed and `untested`, and DeviceHub's own library
self-check (`selfCheck` in helpers/my-devices.mjs) passing every setting with the device left as it was.

All pass, as do `node tests/device-library.mjs`, `node tests/check.mjs` and every script in `test:offline`.
`check.mjs` only looks at git-tracked files; the six new `.mjs` files were syntax- and control-character-checked the
same way by hand, since nothing was committed.

### package.json (for Shawn: this job may not edit it)

Append to both `test` and `test:offline`:

```
 && node tests/sim-logitech-headset.mjs && node tests/sim-logitech-keyboard.mjs && node tests/sim-razer-keyboard.mjs
```

As full lines, against package.json as it stood at the end of this job (it already had another session's
`sim-corsair-bragi-peripherals` and `sim-steelseries-mouse`):

```
"test": "node tests/check.mjs && node tests/regressions.mjs && node tests/openrgb-mock.mjs && node tests/mouse-sim.mjs && node tests/waiting.mjs && node tests/waiting-monitors.mjs && node tests/my-devices.mjs && node tests/battery-care.mjs && node tests/device-library.mjs && node tests/lamparray.mjs && node tests/std-battery.mjs && node tests/vendor-files.mjs && node tests/auto-setup.mjs && node tests/library-updates.mjs && node tests/share-route.mjs && node tests/sim-logitech.mjs && node tests/sim-razer.mjs && node tests/sim-corsair.mjs && node tests/sim-steelseries.mjs && node tests/sim-hyperx.mjs && node tests/sim-asus.mjs && node tests/declarative-driver.mjs && node tests/learn-wizard.mjs && node tests/release-signing.mjs && node tests/pages.mjs && node tests/diagnose.mjs && node tests/hid-core.mjs && node tests/installers.mjs && node tests/bundled-tools.mjs && node tests/sim-keychron-via.mjs && node tests/sim-wooting.mjs && node tests/sim-hyperx-peripherals.mjs && node tests/sim-turtle-beach-battery.mjs && node tests/sim-glorious.mjs && node tests/sim-corsair-bragi-peripherals.mjs && node tests/sim-steelseries-mouse.mjs && node tests/sim-logitech-headset.mjs && node tests/sim-logitech-keyboard.mjs && node tests/sim-razer-keyboard.mjs",
"test:offline": "node tests/check.mjs && node tests/regressions.mjs && node tests/openrgb-mock.mjs && node tests/mouse-sim.mjs && node tests/waiting.mjs && node tests/waiting-monitors.mjs && node tests/my-devices.mjs && node tests/battery-care.mjs && node tests/device-library.mjs && node tests/lamparray.mjs && node tests/std-battery.mjs && node tests/vendor-files.mjs && node tests/auto-setup.mjs && node tests/library-updates.mjs && node tests/share-route.mjs && node tests/sim-logitech.mjs && node tests/sim-razer.mjs && node tests/sim-corsair.mjs && node tests/sim-steelseries.mjs && node tests/sim-hyperx.mjs && node tests/sim-asus.mjs && node tests/declarative-driver.mjs && node tests/learn-wizard.mjs && node tests/diagnose.mjs && node tests/hid-core.mjs && node tests/installers.mjs && node tests/bundled-tools.mjs && node tests/sim-keychron-via.mjs && node tests/sim-wooting.mjs && node tests/sim-hyperx-peripherals.mjs && node tests/sim-turtle-beach-battery.mjs && node tests/sim-glorious.mjs && node tests/sim-corsair-bragi-peripherals.mjs && node tests/sim-steelseries-mouse.mjs && node tests/sim-logitech-headset.mjs && node tests/sim-logitech-keyboard.mjs && node tests/sim-razer-keyboard.mjs"
```

## Left for others

- ~~Receiver C547~~: done in driver-safety.md (the test's example id is now `046d:c5ff`).
- `docs/handoff/driver-coverage.md` could gain these three sections; this note stands in for it.

## Unconfirmed (check with `helpers/hid-caps.ps1` and one read before any write)

- Logitech headsets: whether every FF43 / 0C collection takes long (0x11) reports and answers long (the driver also
  accepts a short 0x10 reply, as HeadsetControl reads 7-byte replies); the G535 on a consumer-page collection.
- PRO X 2: the 64-byte report length on Windows, and whether the dongle answers through DeviceHub's raw channel as it
  does through hidapi.
- Logitech keyboards: that a keyboard's 0x8100 fn 0x40 sector numbering is Solaar's (1-15) rather than libratbag's
  quirked index (the mouse driver's choice); brightness steps on a real G915.
- Razer keyboards: the control collection on each model and firmware (interface from OpenRazer; usage page not fixed);
  that Windows lets the feature report through on that collection; Huntsman V3 Pro transaction ids (OpenRGB disagrees,
  sheet section 2).
