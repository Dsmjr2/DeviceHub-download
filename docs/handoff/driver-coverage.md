# Library driver coverage (22 Oct 2026)

This job widened the six library drivers to every feature their brand sheet (`docs/brands/*.md`) documents with exact
bytes and a cited open-source reference, under three rules:
- every command is cited beside its constant;
- a setting is writable only when the same value can be read back;
- nothing touches firmware, DFU, reset, pairing or whole-profile flash.

Nothing was sent to a real device. Every new setting is covered in its `tests/sim-*.mjs`: the write, the read-back,
putting the original back, refusal of out-of-range values, and refusal while the maker's app runs. No driver's
`status` changed, and none is marked tested. `npm run test:offline` passes.

`helpers/never-commands.json` is unchanged. None of the sources documents a firmware, reset or pairing command that
is missing from it (see "Left for others" for one state-changing HyperX read).

Setting kinds were only `slider`, `toggle` and `choice` when this was written. `display`, `color` and `remap` came
later the same day (docs/handoff/page-kinds.md); each section says which kind stood in.

## Logitech HID++ mouse (`device-library/logitech-hidpp-mouse`)

**Added**
- **Onboard profile select** (0x8100), read and select only:
  - Profile count: fn 0x00, byte 3.
  - Current profile: fn 0x40.
  - Select: fn 0x30 `[00, n]`.
  - Source: libratbag `hidpp20.h`, `get/set_current_profile`.
  - Numbering: the G502 X family (C098, C095, C099) counts from 1 (libratbag `HIDPP20_QUIRK_INDEX_OFFSET`). On any
    other mouse, the numbering is worked out from what the mouse reports. If it is unclear, the setting is hidden and
    writes are refused.
- **DPI stage** (which of the profile's 5 slots is in use): 0x8100 fn 0xB0 to read, fn 0xC0 `[0-4]` to write.
  Source: libratbag `get/set_current_dpi_index`.
- **Lift-off distance** (low, medium or high): 0x2202. Source: Solaar `ExtendedAdjustableDpi`.
  - Offered only when the caps read (fn 0x10) sets the LOD bit.
  - Read with fn 0x50, write with fn 0x60 `[00, X, Y, LOD]`. X and Y are sent back exactly as just read.
  - Host mode only.
- **Safety:**
  - Every write is refused while G HUB (`lghub*`) runs (sheet section 5).
  - A `NEVER_FN` list makes `call()` refuse the 0x8100 memory functions 0x50, 0x60, 0x70 and 0x80, even if they are
    later added to `ALLOWED`.

**Gaps**
- **Per-stage DPI values, sleep timer and profile button bindings:** these live in profile memory, and the only way to
  change them is the 0x8100 memory writes, which rewrite flash. The sheet does not give the memory layout either.
- **Lighting:**
  - 0x8071 has no read function, so a write can't be read back.
  - The 0x8070 effect layouts are not in the sheet, and its flash byte writes NVM.
- **Button remap (0x1B04):** the sheet gives no list of remap targets and no layout for the read-back. Its persist
  flag would also store the mapping on the device.
- **Angle snapping:** not in the sheet.
- **Surface tuning (0x2240):** the sheet gives the feature id only.
- **Device name and firmware version:** their function codes are not in the sheet.

**Closest kind:** profile, DPI stage and lift-off are all `choice`.

## Razer mouse (`device-library/razer-mouse`)

Source for everything below: razer.md section 3, which cites OpenRazer `razerchromacommon.c`, `razercommon.h` and
`razermouse_driver.c`, and OpenRGB.

**Added**
- **DPI stages** (0x04/0x86 to get, 0x04/0x06 to set):
  - Settings: the active stage, and each stage's DPI (X and Y set together).
  - Each write reads the whole table and sends it back with one field changed.
  - The number of stages is never changed. A table with more than 5 stages is shown but never written.
  - A write is refused if the stage count changed since the read.
- **Scroll acceleration** (0x02/0x96 to read, 0x02/0x16 to write) and **smart reel** (0x02/0x97 to read, 0x02/0x17 to
  write). These are probed only on the Basilisk family, the only wheels the sheet names.
- **HyperPolling dongle indicator** (0x07/0x90 to read, 0x07/0x10 to write).
- **Lighting brightness per zone** (0x0F/0x84 to read, 0x0F/0x04 to write, 0-255):
  - Zones: wheel 0x01, logo 0x04, right side 0x10, left side 0x11.
  - Whole device 0x00 is tried only when none of those zones answers.
  - Not tried on the DeathAdder V3 Pro, the Viper V3 Pro or the dongle (the sheet says they have no lighting).
- **Scroll mode** (0x02/0x94) is shown in the info panel and never written.
- **Safety:** writes are refused while Synapse or Razer App Engine runs. This driver had no such guard before.

**Gaps**
- **Static colour and effects:** 0x0F/0x02 and the mouse extended effect 0x03/0x0D can be written but have no read,
  so a write can't be read back.
- **Standard lighting (class 0x03):** the sheet does not say which mice use it, and gives no sizes.
- **Scroll mode writes:** no mode values are documented.
- **Changing the stage count:** the maximum number of stages is unconfirmed.
- **Button remap, macros and onboard profiles:** no source documents them.
- **Lift-off distance, angle snapping and debounce:** no cited source documents them.
- **Device mode 0x03 and dongle pairing:** the sheet marks them high risk.

**Closest kind:**
- Active stage: a slider from 1 to the stage count. It is hidden when there is only one stage.
- Stage DPIs: separate sliders `dpiStage1` to `dpiStage5`, since there is no list kind.
- Brightness: a 0-255 slider for each zone.

## Corsair Bragi headset (`device-library/corsair-bragi-headset`)

**Added**
- **Sidetone on/off** (`46`) and **sidetone level** (`47`, 0-1000 shown as 0-100%), plus **sleep timer on/off**
  (`0d`):
  - Models: HS80 MAX, Virtuoso RGB Wireless XT and Void Wireless V2.
  - Source: corsair.md section 3; OpenLinkHub `hs80maxW.go` and `virtuosorgbXTW.go`; HeadsetControl
    `corsair_void_v2w.hpp` and `corsair_virtuoso_xt.hpp`.
  - The helper's SET list (`hs80io.cs`) and `HELPER_SETS` already allowed these ids. No C# was edited.
  - The sheet lists them as write-only, so each one is shown only when the headset answers a GET for it. That keeps
    the read-back rule.
- **Virtuoso MAX Wireless** (`2A02`, Xbox `2A03`): battery, firmware version and the sleep timer. Source: corsair.md
  section 1; OpenLinkHub `devices.go`.

**Gaps**
- **Lights, the mic light and brightness:** out of scope for this job. `OPENLIGHT` is also fixed to resource 01, the
  HS80 MAX's lighting frame is not documented, and the Virtuoso XT has no colour layout in the sheet.
- **ANC (`d1`):** the sheet marks its meaning unconfirmed, and it is not on the helper's SET list.
- **EQ presets:** no Bragi property is documented. The iCUE SDK route needs iCUE running.
- **Charge status (`10`):** its values are unconfirmed, so it is backed up only.
- **Sidetone on the Virtuoso SE, the original Virtuoso, the Virtuoso MAX and the Void MAX V2:** the sheet's rows do
  not name these models.
- **Cable product ids:** unknown for the HS80 MAX, Virtuoso MAX, Void V2 and Void MAX V2.
- **Older headsets** (old Void, HS70, HS65, HS55): they use another protocol, or no protocol is known.
- **Firmware (`14`) and radio (`15`/`16`):** never asked.

**Closest kind:** none needed.

## SteelSeries Arctis (`device-library/steelseries-arctis`)

**Added**
- **Older Arctis 7 and Arctis Pro** (0x1260, 0x12AD, 0x1252, 0x1280; interface 5, report 06). Source: sheet sections
  1-3 (HeadsetControl `steelseries_arctis_7.hpp`).
  - Battery: `06 18`. Read only on the two Arctis 7 ids; the Pro models have no battery.
  - ChatMix: `06 24`.
- **ChatMix on the page** for the Nova 7 family, Arctis 7+, Arctis 9 and older Arctis 7 (sheet section 3,
  HeadsetControl). Read-only.
- **Safety:**
  - Writes are refused while SteelSeries GG or Engine runs.
  - Each family has its own list of the command bytes it may send. Before this, one list covered every family.
- **Kept:** Nova 7 Gen 2 (0x227E) sidetone, written with `00 39` and read back with `00 20`. It is the only Arctis
  setting any source can read back.

**Removed from the page** (writes no longer sent):
- Sidetone on every other model.
- Auto-off.
- Mic volume and mic light brightness.
- Nova Pro EQ preset and custom EQ.
- Volume limiter, Bluetooth on power-up and Bluetooth call volume.
- Nova Pro and older Arctis 7 lights.

No source has a read for any of these ("Writes get no reply", sheet section 2). Their old code could never pass the
self-check anyway. Their bytes, with sources, are kept in a `WRITE_ONLY` list in `device.mjs` that nothing sends.

**Gaps**
- **Nova 5 battery and ChatMix:** the sheet gives the reply but not the request bytes.
- **Nova Pro ChatMix, ANC/transparency, base station and spare battery:** in no source.
- **Mic monitoring:** not documented for any Arctis.
- **Saves** (`00 09`, `06 09`, `90 00`, `00 35 01`): never sent.

**Kind:** ChatMix game and chat are `display` settings (readings) since 22 Oct 2026 (docs/handoff/page-kinds.md). Before
that they were read-only sliders with `selfCheck: false`.

## HyperX Cloud (`device-library/hyperx-cloud`)

**Added**
- **Cloud Alpha Wireless (03F0:098D) sidetone level 0-128**, writable:
  - Written with `21 BB 11 <v>` and read back with `06`.
  - Range from HeadsetControl `hyperx_cloud_alpha_wireless.hpp`.
  - The two ids only HyperHeadset knows (1743, 1765) still refuse writes.
- **Cloud II Core Wireless (03F0:069F, 0995)**, read-only. Source: HyperHeadset `cloud_ii_core_wireless.rs`, the only
  source for it; the sheet rates it "medium".
  - It uses the Cloud III's `66` frame.
  - Reads: battery, charging, connected, sidetone on/off, sidetone level (-5..5), auto-off, mic mute, silent mode,
    boom mic and noise gate.
  - The pairing-key reset and read (`1E` / `83`) are never sent to it.
- **Cloud III Wireless:** the product colour code (`8F`) now shows in the device info.
- **Raw sidetone bytes:** on the Cloud II Wireless (`0B`) and Cloud III Wireless (`88`), the sidetone level has no
  documented range. It moved from a slider to the device info.
- **Safety:**
  - Writes are refused while NGENUITY runs (sheet section 4; the process name is unconfirmed).
  - The NEVER list (the Cloud II status read that unmutes it, and the Cloud III pairing-key reset and read) is
    extended in the simulator to the new model.

**Gaps**
- **Cloud II Wireless (HP) sidetone level writes:** no documented range.
- **Cloud III Wireless and II Core writes:** mapped but held back (the Cloud III ids are only "possible", and the II
  Core has one source). Once a real read confirms the model, turning writes on is one line (`readOnlyWhy`).
- **Alpha "connected" byte:** HeadsetControl and HyperHeadset disagree on its meaning.
- **Mic monitoring:** no source documents it.
- **EQ:** documented only for the Cloud III S, and only as a write with no read.
- **Cloud III S:** the sheet does not say how its replies match their requests.
- **Wired Cloud III:** sidetone can be written but not read back.
- **Kingston-era Cloud II (vendor 0951):** a different protocol, and its sidetone can't be read back.
- **Cloud Flight:** the battery reads as a voltage, and the sheet gives no voltage-to-percent table.
- **03F0:0D93:** model unconfirmed.
- **Lights:** documented only for HyperX mice and keyboards.

**Closest kind:** the II Core's -5..5 sidetone is its own slider ("Sidetone level (step)"), because a setting has one
range and the Alpha's is 0-128.

## ASUS ROG mouse (`device-library/asus-rog-mouse`)

Both settings below were added to `device.mjs` and `driver.json` alike. `tests/declarative-driver.mjs` still proves
that the two send the same bytes.

Source: asus-rog.md (G-Helper `AsusMouse.cs`, libratbag `asus.c`).

**Added**
- **DPI stages in use** (choice of 2, 3 or 4):
  - Read: `12 00`, byte 19.
  - Write: `51 31 0A 00 <n>`, followed by the save `50 03`, as G-Helper does.
- **Onboard profile** (choice of profile 1-5):
  - Read: `12 00`, byte 11.
  - Select: `50 02 <p>`, which selects only and sends no save.
  - `50 02` was taken off `driver.json`'s own never list.
  - Unconfirmed: the sheet says "profile reply" without naming the read. `12 00` is the only reading that fits its
    byte positions.
- A mouse that answers `FF AA` to `12 00` simply has neither setting.

**Gaps**
- **Active DPI stage** (`51 31 09`): the write counts from 1, but the sheet does not say whether the read counts from
  0 or 1.
- **Low-battery warning** (`51 37`, read `12 07`) and **angle tuning** (`51 31 0B`): both are documented, but
  `tests/declarative-driver.mjs` expects exactly today's seven keys from the cable read, and this job could not edit
  it. Angle tuning's range is also given only approximately.
- **Lights** (`51 28`, read `12 03 <zone>`): three blockers.
  - The sheet does not say which zones each model has.
  - It does not say which models use brightness 0-4 and which use 0-100.
  - The proof test keeps `51 28` on `driver.json`'s never list.

  OpenRGB covers these lights, per sheet section 5.
- **Per-LED lights (`51 29`):** no read is documented.
- **DPI stage colours:** there is no colour kind, so they are sent back unchanged with every DPI write.
- **Button remap and rapid fire** (`51 21`, `51 22`, `51 23`): sheet section 4 says never, and no read is documented.
- **Debounce:** G-Helper's and libratbag's tables disagree, so it stays read-only.
- **8K booster:** how it is switched is not documented.
- **Chakram X DPI writes:** libratbag doubles its DPI and G-Helper does not, so they stay read-only.
- **Firmware, reset (`50 40`) and Omni pairing:** never added.

**Closest kind:** both new settings are `choice`.

## Left for others (files this job could not edit)

- **`helpers/my-devices.mjs`:**
  - The library self-check runs once. Logitech DPI, report rate and lift-off are refused in onboard mode (the usual
    state), so they can stay read-only until the check runs again. Mode-dependent settings need a re-check.
  - `ownDevice()` still looks only at `hid.pid`. It should also cover `hid.pids`.
- **A read-only display kind**, for SteelSeries ChatMix and the HyperX raw bytes, would replace the
  slider-that-refuses.
- **A list or colour kind** would allow remap targets, stage colours and static colour once a source documents a
  read-back.
- **`tests/declarative-driver.mjs`:** widening the expected cable-read keys would let the ASUS low-battery warning in
  (one setting in both files).
- **`helpers/never-commands.json`:** the HyperX Cloud II (HP) status read that unmutes the headset is in that driver's
  own never-send list, but not in the shared never list. That only matters if a HyperX `driver.json` is ever allowed.
  It is a state change, not a firmware command, so it was not added here.
