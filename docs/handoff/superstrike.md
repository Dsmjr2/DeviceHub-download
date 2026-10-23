# Logitech PRO X2 SUPERSTRIKE in the library mouse driver (22 Oct 2026)

Shawn's friend has a PRO X2 SUPERSTRIKE (2026). The library driver `device-library/logitech-hidpp-mouse` now runs it
on its receiver and its cable, with its HITS button settings, so the friend needs no Learn session and no Claude.
Nothing was sent to a real device, DeviceHub was not restarted, and nothing was committed. `npm run test:offline` passes.

**Before this change the driver did not run this mouse at all.** The SUPERSTRIKE has no DPI feature 0x2201 (only
0x2202), and the driver stepped aside from any device without 0x2201.

## Sources (read-only, by commit)

| Tag | Source | Commit | Files read |
|---|---|---|---|
| K | kazehana99k/Logitech-PRO-X2-SUPERSTRIKE-Linux-haptics-actuation-control- | 1b599dd0064a09ab62d94b6d5373b54fce2ba786 | PROTOCOL.md, feature-table.txt, README.md, 42-logitech-superstrike.rules |
| O | oddvalue/linux-superstrike | 42588e73b7dc9875e2b6094a7f25081c73b14d0d | README.md, REVERSE_ENGINEERING.md, internal/hidpp/analog.go, features.go |
| X | xatuke/logitech-superstrike-pro-x2-controller | c3ad5366cf3402c76b8e0e9c8c5abee2553d465a | README.md, docs/PROTOCOL.md, src/ss2k.c, udev/99-superstrike.rules |
| S | pwr-Solaar/Solaar | e7304c4c451cc9bb4f206a914844525e67856a28 | docs/PRO_X2_SUPERSTRIKE_CLI.md, docs/devices/PRO X 2 Superstrike 40BD.txt, lib/logitech_receiver/settings_templates.py (AnalogButtonTuning, ExtendedAdjustableDpi), hidpp20_constants.py, base_usb.py |

## What is covered

| What | How | Sources |
|---|---|---|
| Receiver 046d:c54d | already in RECEIVERS (Solaar base_usb.py) | K, X, S |
| Cable 046d:c0a8 | new in WIRED and device.json `pids`; no overlap with helpers/pc-map.js RUNS or any other library entry (tested) | X README and udev rule; S Model ID 40BDC0A80000 |
| Model name, WPID 40BD | WPIDS and device.json `models`; on a receiver the model is named from its 0x1B0C feature (the pairing table is not read) | S, X |
| Finding it on a receiver | a slot whose device has 0x2201 **or 0x2202** is now a mouse | O, X, S feature tables |
| Battery | 0x1004 fn 0x10, as other mice | X section 2 |
| HITS: actuation point, left / right | slider 1-10 | K, O, X, S |
| HITS: rapid trigger, left / right | slider 1-5 | O, X, S |
| HITS: click haptics, left / right | slider 0-5 | K, O, X, S |
| DPI stage | 0x8100 fn 0xB0 / 0xC0 (X: fn11 / fn12), written as before | X section 6 |
| Onboard / host mode | 0x8100 fn 0x20 / 0x10, written as before | O, X, S |
| DPI | shown (0x2202 fn 0x50, X at bytes 1-2) | S, X |
| Report rate | shown (0x8061 fn 0x20 index; its list fn 0x10: 125-8000 Hz on the receiver, 125-1000 on the cable) | O, X, S |
| Active profile | shown (0x8100 fn 0x40 = the active sector, 1-based on this mouse) | O, X |

### HITS bytes (feature 0x1B0C, index looked up at connect)

- caps: fn 0x00 -> `[flags, buttons, act<<2, rt<<2, hap<<2, ...]`; this mouse `00 03 28 14 14 01` (K, X). The driver
  offers HITS only when every maximum is on the `<< 2` grid and within the documented 10 / 5 / 5, and only buttons 0 and
  1 (the firmware reports 3; S, O and X: only left and right answer).
- read: fn 0x20 `[btn]` -> `[btn, act<<2, (rt<<2) | flag, hap<<2]`.
- write: fn 0x10 `[btn, act, rt, hap]`, the whole record (K: "to change haptics you must preserve actuation and x").
- Each setting is written read-modify-write: the record is read, only that setting's byte is replaced by `value << 2`
  (for the rapid trigger, byte 2's bit 0 is kept as read), the record is sent, then read again and compared byte for
  byte. Writing the value just read therefore sends back exactly the raw bytes read (Turn on settings' write-back and the
  self-check). An unchanged write is always sent.
- A byte that is not on the grid (a reserved low bit set) or is out of range reads as unknown, so it is never written
  back. A value out of range or not a whole number is refused before anything is sent. G HUB running: refused, nothing sent.
- No host mode is needed (O: "These do apply live"; S CLI note 4).

## Gaps (not covered, on purpose)

- **DPI and report-rate writes on this mouse.** O: "several of this device's 'get' registers return stale/cached values"
  and the live DPI setter was "a firmware no-op" in its measurement; X: rate "fn2 -> current idx ... STALE after writes"
  and "Stale getters are systemic (DPI, rate, mode-status read-backs lag)". A write DeviceHub cannot prove by reading it
  back is not offered (CLAUDE.md: write one setting, read it back). S's CLI does write both (`dpi_extended`,
  `report_rate_extended`), and X says the rate change does apply live in host mode. To change DPI, use DPI stage.
- **Lift-off.** The LOD byte's values disagree: S maps 0 low / 1 medium / 2 high (and its CLI doc offers LOW / HIGH
  only), X says G HUB sends LOD 1 / 2 / 3. It is also written with the 0x2202 DPI write above. Not shown.
- **Profile select.** O: switching profiles "reloads their settings", which resets the live DPI stage and HITS values, so
  even the self-check's same-value write would change the mouse. Also S offers only the enabled profiles (from profile
  memory, which DeviceHub does not read). Shown only.
- **Rapid-trigger on/off** (byte 2 bit 0): S and O say it must be preserved; X says the host may set and clear it
  (verified on X's unit). Sources disagree, so it is kept as read.
- **The paged 0x2202 DPI list** (fn 0x20 `[sensor, axis, page]`, O and X): not read, so DPI on any 0x2202-only mouse is
  shown, not written.
- **Gaming surface mode (0x8090) and the bunny-hop filter (0x80E0):** documented by X only; 0x80E0 fn 0x20 is a write
  that looks like a read (X: "querying via fn2 mutates!"). Not added.
- **Button remapping, the DPI of each stage, the profile's own rate, the HITS power-on values:** all live in onboard-
  profile memory (0x8100 fn 0x50-0x80, flash writes with a CRC; O, X). Never written.
- Name and firmware (0x0005, 0x0003): documented by X, still not read (not needed).

## Never sent

As before: DFU 0x00C0-0x00C3 / 0x00D0, 0x010A, reset 0x1802, OOB 0x1805, force pairing 0x1500, 0x1816, 0x0309, and
0x8100 memory functions. Added to the driver's NEVER (never looked up, so never reachable): 0x1817 Lightspeed
pre-pairing, 0x9403 (O names it "FlashUpdate?", S a hidden bunny-hop feature: unknown, so never), 0x1801 manufacturing
mode, 0x1803 GPIO access, 0x1890 RF test, 0x1E00 enable hidden features (names from O features.go; S lists them as
internal, hidden). The same list went into `helpers/never-commands.json` as one Logitech `bytes: null` entry, like the
existing Logitech entries (a documentation line: Logitech driver.json drivers are refused outright). HITS fn 0x30 / 0x40
are not in ALLOWED (K: "other (not investigated)").

## Tests (tests/sim-logitech.mjs, section 10, plus 9f)

A simulated SUPERSTRIKE with K's feature table (including 0x1500, 0x1802, 0x1805 and the hidden ones), on C54D slot 1 and
on C0A8 at index 0xFF: no never-list feature is looked up; the six HITS settings with their ranges; reads; a changed
value moves only its byte, with the flag kept (`00 0C 09 08`, `0C 11 08`); exact restore to the raw records it started
with; an unchanged write is sent as the raw record (`00 0C 09 14`); out-of-range and non-integer values refused unsent;
an acknowledged write that did not change the mouse reported as failed; off-grid bytes read as unknown; G HUB running
refuses unsent; DPI, rate, profile and lift-off writes refused unsent (by the driver itself and by DeviceHub's guard);
DPI stage written and put back; the cable lists 125-1000 Hz. The library self-check after Turn on settings sends each
HITS record exactly as read and leaves the mouse byte for byte as it was, and never writes DPI, rate or profile. The next
(ordinary) mouse gets its DPI slider, rate choice and no HITS settings back. 9f: a 0x2202-only mouse is now run (DPI
shown); a mouse with neither DPI feature still steps aside.

## Untested on hardware

- Everything above is simulated only; device.json status stays "read-only" with no real-device record, so the friend
  presses Turn on settings first.
- That Windows exposes the cable C0A8 on usage page 0xFF00 / usage 0x0002 like other wired G mice (K names MI_02 / 0xFF00
  for the receiver only).
- That the SUPERSTRIKE answers DeviceHub's long reports with software id 0x0B (X used 2-15, K any; G HUB used 0x0D).
- Whether HITS values survive a restart (S CLI note 4 says they persist; X says power-on values come from the profile).
- Whether 0x8100 fn 0xB0 (DPI stage) reads back promptly after fn 0xC0 (X lists fn11 / fn12 without a stale note).
- The first thing to check on the friend's PC: Turn on settings, then one HITS change and back (e.g. left haptics 3 -> 2
  -> 3) with the mouse in hand; then, if wanted, one host-mode rate write with its read-back to see whether the stale
  getter is real on that firmware (BL2 73.00.B0011 / MPM 42.00.B0011 in S and X).
