# Library drivers, round 4: ROCCAT mice and keyboards, SteelSeries Apex keyboards (22 Oct 2026)

Two new `device-library` entries, both `device.mjs` (the driver.json format cannot express either: ROCCAT needs a
whole-block read-modify-write with a profile select first, and the Apex brightness write gets no reply). Both are
`status: "untested"`, `tested: []`, so they install and read by themselves and write nothing until Turn on settings and
each setting's own self-check. Nothing was sent to a real device, DeviceHub was not restarted, no node was killed, and
nothing was committed. Edited outside the two new folders and two new tests: `helpers/never-commands.json` (three
entries), `package.json` (the two sim lines in `test` and `test:offline`), the "Covered" notes in
`docs/brands/turtle-beach.md` and `docs/brands/steelseries.md`.

| Entry | Models (ids) | Settings (each read back) | Readings |
|---|---|---|---|
| `roccat-peripherals` | 1E7D: Kone Pure `2DBE` `2DC2` `2DCB`, Kone Pure Optical `2DB4`, Kone XTD `2E22`, Kone EMP `2E24`, Kone XP `2C8B`, Burst Pro `2DE1`, Burst Core `2DE6`, Kova `2CEE`, Vulcan II `2F4E` / Mini `2F09` / Max `2EE2`, Vulcan Pro `30F7`, TKL Pro `311A`, Pyro `314C`, Magma `3124`, Magma Mini `69A0`, Vulcan 100 / 120 Aimo `307A` `3098`, Vulcan TKL `2FEE` (21) | Pure / XTD / EMP: profile, DPI stage in use, DPI per enabled stage, polling rate (EMP only). Kone XP, Burst: lighting brightness 0-255 | Pure / XTD polling rate, firmware (Pure, XTD, XP, Kova, Vulcan), Vulcan layout, XP active profile |
| `steelseries-apex` | 1038: Apex Pro `1610`, Pro TKL `1614`, Pro TKL 2023 `1628` + wireless `1630` `1632`, Pro TKL Gen 3 `1642` + wireless `1644` `1646`, Apex Pro Gen 3 `1640`, Apex 7 `1612`, 7 TKL `1618`, Apex 5 `161C`, Apex 9 TKL `1634`, 9 Mini `1620`, Apex 3 TKL `1622` (15) | lighting brightness (0-10; Apex 3 TKL 0-16), only when the keyboard answers the read | firmware (`00 90`) |

No id overlaps another library entry (both sims scan every `device-library/*/device.json` and `driver.json`) or
`helpers/pc-map.js` RUNS. `tests/library-guard.mjs` passes for both files (imports only `public/devices/hid.js` and
`node:child_process` for `execFile('tasklist')`; no fs, no native.js).

## Sources (every command in the code carries its file beside it)

- libratbag `8235b5bb6032dea15901ab58a8218956f4494d08`: `src/driver-roccat-kone-pure.c`, `src/driver-roccat.c` (Kone
  XTD), `src/driver-roccat-kone-emp.c`, `data/devices/roccat-kone-*.device`.
- Linux `7be4bc52fd9e0e55dc9a2e0232b89427d2c4b614`, `drivers/hid/`: `hid-roccat-konepure.c` (report ids and sizes),
  `hid-roccat-koneplus.h` (the XTD's driver: sizes, commands incl. firmware write), `hid-roccat-common.c` / `.h` (the
  control report 04 and its status codes), `hid-roccat-ryos.c` (reset), `hid-ids.h`. These are Stefan Achatz's, the
  author of roccat-tools; roccat-tools' own source is only on SourceForge as release tarballs and could not be fetched
  as git (no repository at `git.code.sf.net/p/roccat/*`), so it is not cited.
- OpenRGB `bbc77470a7cba56af60989e54ba910d5ac66a3ac`: `Controllers/RoccatController/` (Kone XP, Burst, Kova, Vulcan,
  Detect) and `Controllers/SteelSeriesController/` (ApexBase, Apex, Apex8Zone, ApexTZone, Devices.h, Detect). The Apex
  brightness read-back (`ReadBrightness`, `SupportsBrightness`) is new in OpenRGB since the sheet was written.

## roccat-peripherals

- **Transport:** feature reports only, one feature-only channel per id. Kone XP / Burst on interface 3, FF01 / 1; Kova
  interface 0, page 0B / usage 0; Vulcan control interface 1, FF01 (0B for the 100 / 120 Aimo and TKL) (OpenRGB
  Detect). libratbag mice: interface 0, collection chosen by its feature length (the macro report: 0x0822 bytes on the
  Pure / XTD, 1026 on the EMP).
- **Reads:** `05` active profile (3 bytes; XP 4); `04 <profile> 80` (XP `04 <p> 80 FF`), wait for ready, then `06` the
  block; `09` firmware; Vulcan `09` (9 bytes) or `0F` (8), read twice. Ready = get `04`: kernel timing (100 ms, then
  every 50 ms, busy 500 ms, invalid / critical = error); XP every 200 ms; at most 25 polls.
- **Writes:** profile `05 03 <index>` then ready, read back with `05`. Everything else: the block of the active profile
  read fresh, one setting's bytes changed (DPI: X, and Y only when it equalled X; stage index; EMP polling index;
  brightness byte), Sum16 recomputed (XTD, EMP, XP, Burst; the Pure has none, per libratbag), sent whole, always (an
  unchanged write sends the block exactly as read), ready, read back in full. Any non-checksum byte that differs from
  what was sent sends the block read before back once, byte for byte, and the write fails. A block whose checksum does
  not add up, or that belongs to another profile, is never used.
- **Ranges** (libratbag write checks): Pure X 200-8200 / Y 100-5000 step 50 (a Y-following write over 5000 is
  refused); XTD 200-8200 step 50; EMP 100-12000 step 100 (raw 0-0x77). A disabled stage (dpi_mask bit clear) is not
  offered.
- **Maker's app:** Swarm II (`/swarm\s*ii/i`, `/^roccat swarm/i`, `/^swarm/i`; names unconfirmed). Reads go on while it
  runs (they include the `04` select, a SET, as every source's read does); every write is refused (`waiting: true`), as
  is "could not check" (tasklist failing throws rather than answering "none").
- **Never list added** (`helpers/never-commands.json`): any feature report `1B` (firmware write) and `1C` (firmware
  write control) on 1E7D, from `hid-roccat-koneplus.h`; report `11` (reset) on the Ryos MK ids `3138` `31CE` `3232`
  only, from `hid-roccat-ryos.c` (on the Vulcan, report 11 is the lighting mode, so it is not vendor-wide).

### Gaps (not covered, and why)

| What | Why |
|---|---|
| Battery on any ROCCAT mouse | No source reads one (Kone Pro Air / Burst Pro Air controllers only write lights) |
| Kone Pro `2C88` | OpenRGB reads its 69-byte block with report id 0 and forces bytes 3-5 before writing: no faithful read-back of `06` |
| Kone Pro Air `2C8E` `2C92`, Burst Pro Air `2CA6`, Kone Aimo `2E27` `2E2C`, Horde Aimo `303E`, Sense Aimo mats | Lights write-only |
| Kone XP / Burst DPI and polling | Bytes exist in the block, but DPI units and polling codes are not spelled out (sheet s6) |
| Kone Pure / XTD polling rate written | libratbag reads it there but never writes it (EMP only) |
| Kone XP profile select | No source; shown as a reading |
| Lights other than brightness, direct mode `0E` / `0D`, buttons `07`, macros `08`, sensor `0F`, TCU `0C`, talk `10`, info writes `09` | Write-only, or not settings (calibration, macros); never built |
| Vulcan brightness / effects (`11` / `0D` long packets), per-key colours | Write-only in OpenRGB |
| Turtle Beach Vulcan II `10F5:501B` `5023` `5001` | One vendor id per library entry (`validateMeta`); a second entry could carry them as info-only |

## steelseries-apex

- **Transport:** output report id 0, 64 data bytes, replies as input reports matched by their first byte (the helper's
  REQ). Wired boards: interface 1, collection with a 64-byte output report; 2023 / Gen 3 wireless ids: interface 3,
  FFC0 / 1; Apex 3 TKL: interface 1, FFC0 / 1 (OpenRGB Detect).
- **Brightness:** `00 A3` -> `A3 00 <b>` (status `FF` = unsupported, then not offered; a value over 10 reads as null and
  is never written back); Apex 3 TKL `A3 <b>` (0-0x10). Write `00 23 <b>`, always sent, then read back; a different
  read-back sends the value read before once and fails.
- **Firmware:** `00 90`, text; the first byte dropped when it is `0x90` (Gen 2+). Not read: Gen 1 serial (`FF`,
  personal) and region (`F5`).
- **Maker's app:** SteelSeries GG / Engine (same names as `steelseries-mouse`). Reads go on, writes refused.
- **Never list:** nothing added. No source documents an Apex firmware, reset or pairing command; the existing
  SteelSeries "firmware update: no source documents it" entry stands, and the driver can build only `A3`, `23`, `90`.

### Gaps (write-only in OpenRGB, or undocumented)

| What | Bytes | Source |
|---|---|---|
| Per-key colour / direct mode | feature `00 3A` / `40` / `61 <n> [key R G B]` | SteelSeriesApexController.cpp SetLEDsDirect |
| Back to onboard lighting | `00 3B` / `00 41` | SendDeinitialization |
| Gen 3 init | feature `00 4B` | SendInitialization |
| Profile select | feature `00 89 <profile>` | SelectProfile |
| Apex 3 (`161A`) brightness and zones | `00 0A 00 <b>`, `00 0B ...` | SteelSeriesApexTZoneController.cpp |
| Apex 3 TKL zone colours | `00 <21 + mode> FF [R G B] x 8` | SteelSeriesApex8ZoneController.cpp |
| Apex M750 `0616`, Apex / Fnatic `1202`, Apex 350 `1206` | feature / output writes only | ApexM / OldApex controllers |
| OmniPoint actuation | none | sheet s6 (apexctl, steelkeys: nothing) |

## Unconfirmed (check with `helpers\hid-caps.ps1 -Vid 1e7d` / `-Vid 1038` and one read before any write)

- ROCCAT Kone Pure / XTD / EMP: which Windows collection holds reports 04-09 (interface 0 and the feature length
  2081 / 1025 data bytes are inferred from the kernel's and libratbag's macro size); the Kone Pure Optical uses
  libratbag's Kone Pure layout (the kernel serves it with the same sizes).
- ROCCAT Burst: OpenRGB reads block `06` without selecting a profile; the driver writes back whichever block it got
  (its own profile byte is kept).
- ROCCAT block writes persist in the mouse (OpenRGB calls it "Send to flash"). They are the setting write itself, not
  a separate save command, so they are not on the never list; Shawn may decide otherwise.
- Apex wired collection (interface 1, 64-byte output); Gen 3 boards may not answer `A3` without OpenRGB's `4B` init
  (then nothing is offered); Gen 1 firmware replies may not start with `90` (then "no reply").

## Tests

- `tests/sim-roccat-peripherals.mjs` (133 checks): per family, write / read back / exact raw restore (byte-for-byte
  block), an unchanged write sends exactly the block read, X/Y rule and the Pure's Y limit, ranges and steps refused,
  disabled stage, profile switch, busy wait, bad checksum never used, a firmware that moves another byte gets the old
  block back, Kova / Vulcan info only, Swarm II: reads go on, writes and the self-check wait, "could not check"
  refuses, self-check passes and leaves every block as it was, only reports 04 / 05 / 06 ever sent and none on the
  never list, the new never entries refuse `1B` / `1C` / Ryos `11` (not Vulcan `11`), per-id channels, device.json,
  no id overlap with other entries or RUNS.
- `tests/sim-steelseries-apex.mjs` (52 checks): the same for brightness on the Apex and 8-zone controllers, unsupported
  status, a keyboard that ignores the write, wireless ids, firmware text, channels, device.json, ids.
- `npm run test:offline`: passes (exit 0) with both added.
