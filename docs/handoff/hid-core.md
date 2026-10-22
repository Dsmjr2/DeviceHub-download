# HID core: what library drivers can ask for (22 Oct 2026)

The six library drivers (Logitech HID++, Razer, Corsair Bragi, SteelSeries Arctis, HyperX Cloud, ASUS ROG) needed
things DeviceHub's HID layer did not have. This change adds them as one set of options on a driver's `hid` spec.
**Each option is off unless a spec asks for it.** A spec without them, which includes the Pulsar mouse, the P75
keyboard, every existing my-devices driver and LampArray, gets the same channel name, the same helper code path and
the same timings as before.

## What changed

| Need | How a driver asks | Where |
|---|---|---|
| Several product ids | `hid.pids: [...]`, `hid.byPid: { PID: { overrides } }`: one channel per pid, `hid.pid` first | `helpers/my-devices.mjs` `hidSpecs` |
| Every filter tried | the agent's provider tries each `getDevice` filter in order (it only tried `filters[0]` before); a filter's `iface` must match the host's | `helpers/hid-host.mjs` `provider` |
| Choosing the collection | `iface` (`&mi_0N`), `col` (`&col0N`), `inputLen`, `outputLen`, `featureLen` (data bytes, without the report id); `page: '*'` / `usage: '*'` = any (then one of the others is required, or OPEN answers ERR) | `channelOpts` and `HidFind.FindEx` / `PathFits` / `CapsFit` (`hs80io.cs`) |
| Feature-only open | `featureOnly: true`: opened with no access (as hidapi does for a mouse collection Windows holds); FSET / FGET only, REQ refused | `HidIo(path, out, in, rid, featureOnly)` |
| Report id per request | `reportIds: [..]`: `sendReport(id)` with a listed id goes out with it (helper `REQR`). `routes: { id: { col, ... } }`: that report lives on another collection of the device, opened on first use (the ROG Omni receiver's col01) | `HostDevice.sendNow`, `kid`, `viaRoute` |
| Driver matches its own replies | `reply: 'raw'`: `SEND` writes the report (waiting input dropped first), then `READ` hands every input report to the listeners for up to `replyMs` while a listener from before the send is waiting. `dev.receiveReports(ms)` reads notices on request | `HostDevice.sendRaw`, `readRaw`, `receiveReports`; `HidIo.Send` / `Read` |
| Refused vs gone | `refusals: true` (always so with `reply: 'raw'`): a write Windows refuses answers `REFUSED <code>` and HostDevice throws `{ refused: true, code }`, handle kept. GONE stays for errors 2, 3, 6, 21, 55, 995, 1167 | `HidIo.Write`, `GoneCode`, `HidRefused` |
| Corsair whitelist | `Hs80Io.Set` also takes `0d` 0/1, `46` 0/1, `47` 0-1000. A SET outside the list answers `ERR ...` and keeps the handle (it was GONE and closed it) | `hs80io.cs`, `helper.cs` HandleHs80 |
| Library check | `validateMeta` accepts `tested: []` for "read-only" and "untested"; "tested" still needs a record | `helpers/device-library.mjs` |
| Logitech | "Settings source" (`mode`) is `selfCheck: false` | its device.mjs |

The helper keeps channel options in the channel name, after the report id: `hid:1532:00B7:0001:0002:90:0:if=0:fl=90:fo=1`.
`helper.cs` sends a channel with any `key=value` part (or a `*` page or usage) to `HandleHidEx`. Every other
channel goes through the old `HandleHid` code, which is unchanged.

The drivers now use these options. Logitech uses `reply: 'raw'`; Razer uses `byPid` for its interfaces; SteelSeries
uses `pids`/`byPid` per family, with `*` pages for the Nova Pro and Arctis 9 and `reportIds` on the Arctis 9; HyperX
uses `pids`/`byPid` per model, `*` pages chosen by output length, and `refusals` so its feature-report fallback runs;
ASUS uses `byPid`, `mi_00` on the cable and receiver, and `mi_02&col03` plus a col01 route on the Omni. Their NEEDS
blocks are now "HID LAYER" blocks that say what each one uses.

## Why Shawn's devices are unchanged

- **Channel names**: the built-in SPECS have no options, so `chanFor` appends `''`. `tests/hid-core.mjs` checks the
  mouse's `hid:3710:3506:FF02:0002:16:8` and the keyboard's `hid:342D:E479:FF60:0061:32:0` lines byte for byte. It
  also checks that `addSpec` gives the same fields as the old code for a my-devices spec, a LampArray spec and a bare
  spec.
- **REQ**: `HidIo.Req(data, echo, ms)` now calls `ReqAs(..., reportId, false)`. With input length = output length =
  `len` (always so for the old constructor), it reads, compares and returns exactly as before. The one exception
  path, where a write throws, still becomes GONE.
- **Report ids**: an id that is not listed in `reportIds` or `routes` is still ignored, as before (checked for the
  mouse).
- **featureLen** only counts as a match next to another of the new choices, so a LampArray spec (`featureLen` set,
  nothing else) opens with the same channel name and the same `HidFind.Find` call.
- **page**: `page: null` still means FF00, as before. Only an explicit `'*'` means any page.
- **provider**: for a single filter, it tries the same first matching host as before. Shawn's adapters pass one filter
  each.
- **HS80**: its channel, path, OPEN, GET, LIGHT and its three SET ids are untouched. The only change on that channel is
  that a SET value outside the list now answers `ERR` instead of GONE. hs80-direct.js never sends one.
- `tests/mouse-sim.mjs`, `npm run test:offline` and the six `tests/sim-*.mjs` pass. The C# was compiled to a temp exe
  with build.ps1's exact sources and references. `helpers/bin/DeviceHubHelper.exe` was not rebuilt; DeviceHub
  rebuilds it on its next start, when the sources are newer.

## Untested on hardware (nothing was sent to a device)

- `FindEx` against real devices: the `&mi_` / `&col` path forms and HIDP_CAPS lengths are checked by a harness, but
  never on a real Razer, ASUS Omni, Arctis or HyperX.
- Feature reports through an access-0 handle (Razer): hidapi documents it; never tried here.
- The raw channel: whether `HidD_FlushQueue` beside an in-flight overlapped read behaves on every device, and whether
  a Logitech receiver's long collection takes writes while the helper keeps a read pending (the Pulsar does).
- Which Windows error a refused output report really gives (31 and 1 are expected; any code not in the gone list
  counts as refused). A device that is gone but reports another code is caught by the next request's GONE.
- Corsair models other than the HS80 on the hs80 channel need FF42 / usage 01 / 64-byte output reports. A model with
  another size will not open.
- Each driver's own UNCONFIRMED items (lengths, usage pages, interfaces) still apply. Check each with
  `helpers/hid-caps.ps1` and one read before any write.

## Left for others

- `package.json`: add `node tests/hid-core.mjs` to `test` and `test:offline` (not in this job's files).
- Corsair: switching `HELPER_SETS` in the driver to include `0d` / `46` / `47` is one edit. `tests/sim-corsair.mjs`
  checks the current default ("sleep timer only", "0d / 46 / 47 never asked"), so the test has to change with it.
- `helpers/my-devices.mjs` `ownDevice()` (the never-self-check guard) still looks only at `hid.pid` and `cablePid`,
  not `hid.pids`. None of the six lists a DeviceHub-owned id (Corsair excludes the HS80's), but a guard over all
  `pids` would be safer.
- Corsair lights (`OPENLIGHT <resource>`, `LIGHTDATA`) and the Logitech short-report collection remain open (see their
  HID LAYER blocks).
