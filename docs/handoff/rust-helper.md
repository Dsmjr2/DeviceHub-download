# Rust Helper (`helpers/native-rs/`) — Inventory, Safety Proof & Status

Branch: `antigravity/rust-helper` (worktree `C:\Users\shawn\DeviceHub-rust`).
Default helper remains **C#** (`helpers/native/`); Rust is strictly opt-in (`DEVICEHUB_RUST_HELPER=1` or `"rustHelper": true` in `data/settings.json`), with `DEVICEHUB_CSHARP_HELPER=1` as a hard override and automatic SHA-256 staleness refusal falling back to C#.

---

## Step 1: Safe by Default (Complete, Verified Offline)

- `helpers/rust-helper-sources.js`: Hashes `Cargo.toml`, `Cargo.lock`, and `src/**/*.rs` into `helpers/native-rs/target/release/rust-helper-sources.sha256`; `selectHelper()` enforces opt-in, `DEVICEHUB_CSHARP_HELPER=1` override, and stale/missing hash refusal with C# fallback.
- `helpers/native.js`: Logs one startup line `[helper] running Rust|C# helper (<reason>)`.
- `tests/rust-helper-optin.mjs`: Verifies opt-in flags, stale hash refusal -> C# fallback, hard C# override, and `helperReads` C# fallback.

---

## Step 2: Command & Op Inventory

### A. Core Native Helper Channels (`helpers/native/helper.cs` -> `helpers/native-rs/src/main.rs`)

| Channel / Command | Old Source | Rust Function | R/W | Used By (Page / Module) | Status |
|---|---|---|---|---|---|
| `hid:<vid>:<pid>:<page>:<usage>:<len>:<rid>` (`OPEN`, `WATCH`, `REQ`, `FSET`, `FGET`, `CLOSE`) | `helper.cs` `HandleHid`, `hid.cs` | `hid::handle` (`hid.rs`) | R/W | Mouse / Keyboard / Light pages (`helpers/hid-host.mjs`, `pulsar-v2.js`, `p75.js`) | Ported; safety-tested offline; live HW parity pending test window |
| `hid:...` extended opts (`if=`, `col=`, `il=`, `ol=`, `fl=`, `fo=1`, `rw=1`, `rf=1`, `gi=1`, `FSET`, `FGET`, `IGET`, `WATCH`, `REQ`/`REQR`, `SEND`, `READ`, `CLOSE`) | `helper.cs` `HandleHidEx`, `hid.cs` | `hid::handle_ex` (`hid.rs`) | R/W | Library drivers (`helpers/hid-host.mjs`) | Ported; safety-tested offline; live HW parity pending test window |
| `hs80:<pid>:<ep>[:bragi][:frame=peripheral]` (`OPEN`, `CLOSE`, `GET`, `SET`, `MODE`, `LIGHT`, `OPENLIGHT`, `FRAME`) | `helper.cs` `HandleHs80`, `hs80io.cs` | `hs80::handle` (`hs80.rs`) | R/W | Headset / Lights pages (`hs80-direct.js`, `receiver-light.js`, Corsair library drivers) | Ported; safety-tested offline; live HW parity pending test window |
| `hidlist <page> <usage>` | `helper.cs`, `hid.cs` `HidFind.List` | `hid::list_by_usage` (`hid.rs`) | Read | Device discovery (`helpers/hid-host.mjs`, `server.js`) | Ported; parity test ready |
| `pointer` (`READ` / `SET <key> <val>`) | `helper.cs`, `pointer.cs` | `pointer::read`, `pointer::set` (`pointer.rs`) | R/W | Mouse / Pointer settings (`server.js`) | Ported; read parity verified offline |
| `tray` (`START <port> <folder>`, `WAKE ON|OFF`) | `helper.cs`, `tray.cs` | `tray::start`, `tray::wake` (`tray.rs`) | Write/UI | Tray icon & wake toggle (`server.js`) | Ported; requires live app window |
| `win` (`BRAND <ico>|<relaunch>`) | `helper.cs`, `winbrand.cs` | `winbrand::brand` (`winbrand.rs`) | Write/UI | Window taskbar icon & AppUserModelID (`server.js`) | Ported; requires live app window |
| `watchdog` (`PING`, `HANG-TEST`) | `helper.cs` | `main::handle` (`main.rs`) | Read | Watchdog heartbeat (`helpers/native.js`) | Ported; offline-tested |
| `diag` (`MEM [GC]`) | `helper.cs` | `main::handle` (`main.rs`) | Read | Settings > Health (`server.js`) | **Differs**: C# returns .NET GC/heap JSON; Rust returns `"rust-helper"` |

### B. `audio` Channel (`helpers/native/helper.cs` + `audio*.cs` + `mic-*.cs` -> `helpers/native-rs/src/audio.rs`, `audio_com.rs`)

| Command | Old Source | Rust Function | R/W | Used By | Status |
|---|---|---|---|---|---|
| `audio-list` | `WinAudio.List` (`audio.cs`) | `audio::handle` | Read | Sound page (`server.js`) | Ported; live parity pending test window |
| `audio-set` | `WinAudio.Set` (`audio.cs`) | `audio::handle` | Write | Sound page (`server.js`) | Ported; live parity pending test window |
| `usb-headsets` | `AudioDefault.Headsets` (`audio-default.cs`) | `audio::handle` | Read | Sound page (`server.js`) | Ported; live parity pending test window |
| `hs80-endpoints` | `helper.cs` `hs80-endpoints` | `audio::handle` | Read | Sound / Headset pages (`server.js`) | Ported; live parity pending test window |
| `set-enabled` | `AudioDefault.SetEnabled` | `audio::handle` | Write | Sound page (`server.js`) | Ported; live parity pending test window |
| `set-default` | `AudioDefault.SetDefault` | `audio::handle` | Write | Sound page (`server.js`) | Ported; live parity pending test window |
| `outputs` | `AudioApps.Outputs` (`audio-apps.cs`) | `audio::handle` | Read | Sound / App mixer (`server.js`) | Ported; live parity pending test window |
| `follow` / `switch-output` | `AudioApps.Follow` / `SetDefault` | `audio::handle` | Write | Sound page (`server.js`) | Ported; live parity pending test window |
| `procs` | `helper.cs` `procs` | `audio::handle` | Read | Sound / App mixer (`server.js`) | Ported; parity test ready |
| `power` | `helper.cs` `power` | `audio::handle` | Read | Health / Battery (`server.js`) | Ported; parity test ready |
| `sidetone` / `sidetone-set` | `helper.cs` `Sidetone` | `audio::handle` | R/W | Headset page (`server.js`) | Ported; live parity pending test window |
| `mic-rec-start`, `-status`, `-stop`, `-read`, `-clear` | `MicRec` (`mic-rec.cs`) | `audio::handle` | R/W | Mic test (`server.js`) | Ported; live parity pending test window |
| `mic-guard`, `mics` | `MicGuard` (`mic-guard.cs`) | `audio::handle` | Read | Mic guard (`server.js`) | Ported; live parity pending test window |

### C. `monitor`, `camera`, `cue` Channels

| Channel / Command | Old Source | Rust Function | R/W | Used By | Status |
|---|---|---|---|---|---|
| `monitor` (`monitors`, `monitor-set`) | `monitors.cs` | `monitors::handle` (`monitors.rs`) | R/W | Monitors page (`server.js`) | Ported; live DDC parity pending test window |
| `camera` (`cameras`, `camera-set`) | `camera.cs` | `camera::handle` (`camera.rs`) | R/W | Camera page (`server.js`) | Ported; live parity pending test window |
| `cue` (`props`, `write`) | `cue.cs` | `cue::handle` (`cue.rs`) | R/W | iCUE / Lights (`server.js`) | Ported; live parity pending test window |

### D. `pc` / `pc:*` Channel (`pc.cs` + PowerShell ops moved into `pc_reads.rs`, `pc_native.rs`, `ps_ops.rs`, `wmi.rs`)

| Op | Old Source | Rust Function | R/W | Used By | Status |
|---|---|---|---|---|---|
| `bluetooth`, `pc-map`, `display-read`, `sensors`, `gpu-power`, `installed`, `pc-check`, `std-battery-bt`, `procs`, `pawnio`, `running`, `eqapo` | `pc.cs` / PowerShell | `pc_reads::handle` (`pc_reads.rs`, `pc_native.rs`, `wmi.rs`) | Read | PC / Health / Lights / Drivers pages | Ported; offline parity ready |
| `sleep-timer` (read/set) | PowerShell in `sleep-timer.js` | `ps_ops::sleep_timer` | R/W | Sleep Timer (`sleep-timer.js`) | Ported; read parity offline-tested |
| `close-app-window` | PowerShell | `ps_ops::close_app_window` | Write | App helper (`server.js`) | Ported; untested live |
| `corsair-apo-read` | PowerShell in `corsair-apo.js` | `ps_ops::corsair_apo_read` | Read | Corsair APO check (`corsair-apo.js`) | Ported; read parity offline-tested |
| `laptop` (`read` / `set`) | PowerShell in `server.js` | `ps_ops::laptop_*` | R/W | Laptop / Power mode (`server.js`) | Ported; read parity offline-tested |
| `learn-hid-list` | PowerShell in `learn-wizard.mjs` | `ps_ops::learn_hid_list` | Read | Learn wizard (`learn-wizard.mjs`) | Ported; read parity offline-tested |
| `startup-apps-read`, `startup-impact-read` | PowerShell in `startup-apps.js`, `startup-impact.js` | `ps_ops::startup_*` | Read | Startup Apps page | Ported; read parity offline-tested |
| `sleep-monitors` | PowerShell in `server.js` | `ps_ops::sleep_monitors` | Write | Sleep monitors action (`server.js`) | Ported; requires test window |
| `display-mode`, `display-primary`, `display-hdr` | `pc_native.rs` / PowerShell | `pc_native::*` | R/W | Monitors / Display mode (`server.js`) | Ported; read parity ready, writes require test window |

---

## Step 3: Safety Proof (Offline, Verified)

- **Rust unit tests (`cargo test`)**: 9/9 passed:
  - `hs80::tests::refuses_set_0d_46_47_on_hs80_channels`: `SET 0d`, `SET 46`, `SET 47` refused on `0a69`, `0a6b`, `0a71`.
  - `hs80::tests::refuses_peripheral_frame_on_hs80`: `frame=peripheral` refused on `hs80` PIDs.
  - `hs80::tests::refuses_bragi_library_driver_on_hs80`: `:bragi` tag refused on HS80 PIDs for `OPEN`, `GET`, `SET`.
  - `hid::tests::library_driver_channel_never_reaches_hs80`: `hid:1b1c:0a69|0a6b|0a71:...` refused before opening or writing.
  - `hs80::tests::malformed_unknown_oversize_and_unplugged_return_cleanly`, `hid::tests::malformed_unknown_oversize_and_unplugged_return_cleanly`, `tests::unknown_channel_and_commands_return_err`, `tests::oversize_payload_returns_err`, `tests::closed_stdout_does_not_panic_or_hang`: all return `ERR`/`NODEVICE`/`GONE` cleanly without panic or hang.
- **JS & static source safety (`tests/rust-helper-safety.mjs`)**:
  - Proves `helpers/never-guard.mjs` (`neverHit`) and `helpers/bragi-guard.js` (`refusal`) + `helpers/native.js` refuse dangerous commands before any bytes reach Rust or start the helper.
  - Scans all `helpers/native-rs/src/*.rs` to fail on any firmware/bootloader/DFU/SMBus-write/I2C-write/WinRing0/InpOut/DeviceIoControl call.
  - Verifies every `unsafe` block/fn (223 sites) has a `// SAFETY:` comment.
- **`cargo clippy --all-targets -- -D warnings`**: 0 warnings, 0 errors.

---

## Step 4: Read Parity (`tests/helper-parity.mjs`)

- Hard read-only allowlist (`ALLOWED_READS`) refuses any non-read command before reaching either helper.
- **Offline run (2026-11-13)**: 15/15 offline-safe ops matched (`watchdog|PING`, `pointer|READ`, 8 `pc` ops compared against C#, plus 5 moved PowerShell `pc` ops verified returning `ok: true` JSON).
  - 20-try median latency: `watchdog|PING` C#=0.055ms / Rust=0.081ms; `pointer|READ` C#=0.079ms / Rust=0.088ms; `pc|display-hdr read` C#=0.058ms / Rust=0.123ms.
- **Live run (`--live`, 2026-11-13)**: 24/24 ops matched (`hidlist`, `monitor`, `camera`, `audio`, `pointer`, `pc`, `watchdog`).
  - 20-try median latency: `watchdog|PING` C#=0.074ms / Rust=0.089ms; `pointer|READ` C#=0.083ms / Rust=0.062ms; `pc|display-hdr read` C#=0.084ms / Rust=0.142ms.

---

## Step 5 & Step 6: Write Parity & Robustness

- **Step 5 (`helpers/soak-test.mjs` + mouse check, 2026-11-13)**: Ran on C# (`DEVICEHUB_CSHARP_HELPER=1`) and Rust (`DEVICEHUB_RUST_HELPER=1`):
  - Headset: 10 writes, 0 problems, median 10 ms on both (slowest: C# 825 ms, Rust 803 ms).
  - Keyboard: 5 writes, 0 problems, median 139 ms on both (slowest: C# 441 ms, Rust 378 ms).
  - Mouse (with Shawn moving mouse): 18/18 writes ok, 0 problems on both (median: C# 60 ms, Rust 153 ms).
- **Part C Offline Audit & Fuzzing (2026-11-13)**:
  - `cargo test`: 10/10 passed, including `fuzz_parser_malformed_half_lines_binary_huge_and_burst` (half-lines, binary/control chars, 64 KB payloads, malformed JSON, 5,000-command fast burst).
  - Line-by-line module comparison vs C#: `hid.rs` (`gone_code` `2|3|6|21|55|995|1167`, `HidD_FlushQueue`, `refusals`), `hs80.rs` (`64`/`65` report len, `400 ms` timeout, `broken` -> `GONE`), `monitors.rs` (`60 ms`/`50 ms`/`120 ms`/`800 ms` DDC timings + 4 retries), `audio.rs` (`MAX_SECONDS = 30`, `15 ms` capture loop), `camera.rs` (`15 s` idle cache drop, `drop_all` on unplug) all match C#.
  - Temp-folder prebuilt install test in `tests/rust-helper-optin.mjs`: confirmed C# stays default and Rust runs only when opted in with matching SHA-256.
- **Step 6 (9-hour overnight soak, 2026-11-13, `docs/handoff/rust-soak-2026-11-13.csv`)**:
  - Duration: **9.00 hours** (`06:19:46Z` to `15:19:54Z`, 37 samples every 15 minutes) with `DEVICEHUB_SOAK_READONLY=1`, `"rustHelper": true`, `"batteryCare": false`, empty profiles.
  - Memory: start `16.52 MB`, end `22.06 MB`, peak `22.11 MB` (`+5.54 MB` total, well below the `+20 MB` limit).
  - Handles: start `311` (cold start before poll settle), settled `642–644` (peak `644`, end `642`, zero growth over the last 8+ hours).
  - Restarts: `0` | `GONE` answers: `0` | Slowest request: `142 ms` (limit `< 5000 ms`) | Write attempts: `0`.
  - Devices: `headset` and `keyboard` stayed `connected` all 9 hours; `mouse` went `asleep` between `06:19Z` and `06:34Z` (normal overnight idle).
  - **Pass (idle stability)**: passed all idle metrics (9.00 hours, +5.54 MB, 0 restarts, 0 `GONE`, slowest 142 ms).
  - **Dongle replug test (2026-11-13)**: With Rust helper (`PID 24652`) active, mouse and headset dongles were unplugged and replugged once each; all devices reconnected (`mouse=connected`, `headset=connected`, `keyboard=connected`) with 0 restarts and 0 crashes. Step 6 **PASSED**.

---

## Step 7: Reproducible & Shippable Plan

- **Toolchain pinned**: `helpers/native-rs/rust-toolchain.toml` (`channel = "1.100.0"`).
- **Reproducible build**: `node helpers/build-rust-helper.mjs` runs `cargo build --release --locked` and stamps `helpers/native-rs/target/release/rust-helper-sources.sha256`.
- **Distribution to PCs without Rust**: Mirror the existing C# prebuilt pattern (`helpers/prebuilt-helper.mjs`, `helpers/bin/helper-sources.sha256`):
  1. CI or build machine runs `node helpers/build-rust-helper.mjs` on Windows x64.
  2. Package `DeviceHubHelper.exe` + `rust-helper-sources.sha256` into `helpers/bin/rust/` (or release archive) alongside the C# prebuilt binary.
  3. On target PCs, `helpers/rust-helper-sources.js` verifies the SHA-256 against `helpers/native-rs/` sources; if missing or mismatched, `helpers/native.js` logs once and falls back to C# automatically.
  4. Nothing is published or enabled by default until Shawn approves after live parity & soak testing.
- **`helpers/helper-reads.js` routing & write/action ops**:
  - The 8 Rust-only ops (`sleep-timer`, `laptop`, `close-app-window`, `sleep-monitors`, `corsair-apo-read`, `startup-apps-read`, `startup-impact-read`, `learn-hid-list`) go straight to PowerShell when C# is active (`native.helperKind() !== 'rust'`), with zero helper round-trip and zero fallback log lines. When Rust is active, they go to Rust first with PowerShell fallback.
  - Four of those ops write settings or act rather than read: `sleep-timer` (with `-Ac`/`-Dc`/`-ScreenAc`/`-ScreenDc`), `laptop` (with a `mode`), `close-app-window`, and `sleep-monitors` (`probe: false`).

---

## Trial and retiring C#

1. **Trial period (~1 week of normal use)**:
   - After PR #6 merges, turn Rust on in `data/settings.json` on the live PC:
     ```json
     "rustHelper": true
     ```
     (or set `DEVICEHUB_RUST_HELPER=1` in the environment), then restart DeviceHub.
   - To switch back to C# at any time: set `"rustHelper": false` (or remove `"rustHelper"`) in `data/settings.json`, or set `DEVICEHUB_CSHARP_HELPER=1`, and restart DeviceHub.
2. **Retiring C#**:
   - Once ~1 week of normal use completes with no regressions, make the Rust helper the default in `helpers/rust-helper-sources.js` / `helpers/native.js` and delete the C# helper (`helpers/native.cs`, `helpers/pc-reads.cs`, `helpers/build-helper.mjs`, and `helpers/bin/DeviceHubHelper.exe`).


## Bug hunt, 13 Nov 2026

- The stamp (`target/release/rust-helper-sources.sha256`) holds the sources' hash on line 1 and, since this date, the
  exe's own SHA-256 on line 2: a replaced or stale exe is refused (C# runs). An older one-line stamp is still read.
  `build-rust-helper.mjs` takes the sources' hash before cargo runs, so a pull during the build is not stamped as built.
- The Rust helper stopping by itself (or not starting) 3 times in 10 minutes makes DeviceHub run C# until it restarts
  (problem code `rust-helper-fallback`). tests/rust-helper-fallback.mjs.
- Settings > Health measures the Rust helper's memory from outside (it answers MEM with "rust-helper"); helpers/helper-memory.js.
- DEVICEHUB_SOAK_READONLY now blocks battery care's put-back writes too, and logs once per device and rule.
