# HID input reports on request, and a second collection per device (22 Oct 2026)

Two more opt-in options on a driver's `hid` spec, after `docs/handoff/hid-core.md`. **Both are off unless a spec asks
for them.** The Pulsar mouse, the Epomaker P75 keyboard and the Corsair HS80 headset take exactly the paths they
took before: the same channel names, the same request lines, the same helper code.

## What changed

| Need | How a driver asks | Where |
|---|---|---|
| Ask the device for an input report (GET_REPORT) | `hid.inputReports: true`, then `dev.getInputReport(id, length)`. Resolves `{ reportId, data: DataView }` (an inputreport event's shape; `data` = `length` bytes after the id, default `inputLen` or `len`), or `null` when the device did not answer. Throws `{ gone: true }` on GONE. Refused (nothing sent) on a channel without the option. | `HostDevice.getInputReport`, `channelOpts` adds `:gi=1`; helper `IGET <id hex> <len>` in `HandleHidEx` only, answering `ERR` without `gi=1`; `HidIo.InputGet` (`HidD_GetInputReport`) |
| Listen to a second collection of the same device | `hid.extra: [{ name, page, usage, iface, col, len, inputLen, reportId }]`, then `dev.extraChannel(name)`: `{ name, spec, opened, open(), receiveReports(ms), close() }` | `HostDevice.extraChannel` |

### Input reports on request

- `HidD_GetInputReport` runs on the same non-overlapped handle the feature reports already use (`FeatureHandle`), so it
  never meets the read the helper keeps in flight on the main handle. The buffer is the collection's input report
  length from `HidP_GetCaps` (`InputReportByteLength`, now also read beside the feature length).
- `IGET` returns the first `<len>` data bytes without the report id, `NONE` when the device did not answer or `<len>`
  is longer than the collection's input reports, and `GONE` on error 1167 (as `FGET` does).

### Extra collections

- Each entry is its own raw channel on the same vid and the pid the device opened, e.g.
  `hid:31E3:1310:FF53:*:256:0:rw=1`. Nothing is opened until the driver calls `open()` or `receiveReports()`, and
  only while the device itself is open.
- **Read only.** The object has no send of any kind, so only `OPEN`, `READ` and `CLOSE` ever reach the collection
  (checked in `tests/hid-core.mjs`).
- A GONE on the extra closes the extra only: no gone event, and the device stays open. The device's own channel
  finds out about a real unplug on its next request. Closing the device closes its extras.
- Extras are not in the provider's host list, so `getDevice()` never returns one.
- This differs from `routes` (hid-core.md). A route sends a report id on another collection. An extra only listens.

## The drivers

### turtle-beach-battery

`hid.inputReports: true`. The channel is now `hid:10F5:2251:FF13:0001:61:6:rw=1:gi=1`.

Source: halobattery-stealth700 `src/stealth700_battery/reader.py` reads **only** with
`get_input_report(IN_REPORT_ID, HID_REPORT_SIZE)` (report 07, 62 bytes) and never with a plain `read()`. Its order:
1. `_drain()`: 5 gets.
2. Enable.
3. `time.sleep(0.3)`.
4. `_drain()`: 5 gets.
5. GET /GSI.
6. `attempts=30` gets, each followed by `time.sleep(0.03)`.
7. The payloads joined, first `{` to last `}`.

The driver keeps its earlier path as the first try: the two frames, then input reports read as they arrive. Only when
that finds no GSI record does it run the reader's sequence above once (`GET` constants, `gsiByGetReport()`), with the
same two fixed frames and nothing else. It skips the second try on a host without `getInputReport`. When the record
came by GET_REPORT, `rawBackup()` records `via: "GET_REPORT"`.

**Unconfirmed:** which of the two ways the transmitter answers. A silent transmitter now gets the two frames twice
before the plain "no GSI record" error.

### wooting: key depth, read only

`hid.extra` names the two analog collections. `keyDepth(ms = 60)` returns `{ protocol, page, keys }`, or `null` when
the board has neither collection. `info()` adds a "Key depth" line when one is found. Everything else is as before:
- GetDeviceConfig (19) is still the only thing sent on the config channel.
- The driver still steps back while Wootility runs.
- `settings` is still empty. Nothing on the page shows key depth live; it is a driver method and an info line.

Wooting's own wooting-analog-sdk (develop branch) documents this exactly; the brand sheet alone was not trusted:
- `src/plugin/wooting.rs`:
  - `ANALOG_INTERFACE_V1 = 0xFF54`, `ANALOG_INTERFACE_V2 = 0xFF53`;
  - `ANALOG_BUFFER_SIZE_V1 = 48`, `ANALOG_BUFFER_SIZE_V2 = 64`;
  - `WOOTING_VID = 0x31e3`;
  - no write to the device anywhere.
- `src/device.rs`:
  - `WootingNewFirmware` (31E3, any pid, FF54) and `WootingAnalogProtocolV2` (31E3, any pid, FF53).
  - `matches()` checks the usage page only.
  - Reads use `read_timeout(&mut buffer, 50)`.
  - v1 parser: 3-byte entries `[code hi, code lo, value]`, zeros dropped, `(value / 255).min(1.0)`. The `x1.2` factor
    applies to the legacy 03EB boards only.
  - v2 parser: 4-byte entries `[pos, key, packed, value]`:
    - row = `(pos >> 5) & 7`, col = `pos & 0x1F`;
    - actuated = `packed & 1`, namespace = `(packed >> 2) & 0xF`;
    - value = `(value << 2) | ((packed >> 6) & 3)`, scaled `/1023`;
    - code = `namespace << 8 | key`.
- The SDK parses hidapi's buffer from byte 0, and hidapi on Windows drops a leading report id 0. `sdkBuffer()` gives
  the parsers that same view of the helper's READ reply.

**Unconfirmed:**
- Which page each board has. The SDK takes whichever is present; the driver tries them in the SDK's `device_impls`
  order, v1 then v2.
- The input report length. Reads are sized 256 bytes, larger than either SDK buffer; Windows accepts a larger buffer.

## Why Shawn's devices are unchanged

- `tests/hid-core.mjs` section 1 still checks byte for byte:
  - the mouse's channel `hid:3710:3506:FF02:0002:16:8`, its `REQ 1 900 ...` line and its `WATCH 0a`;
  - the keyboard's channel `hid:342D:E479:FF60:0061:32:0` and its `REQ` line;
  - the my-devices, LampArray and bare specs against the old `addSpec`.
- Section 8 adds checks that:
  - neither built-in spec asks for the options, and `channelOpts` gives them `''`;
  - `getInputReport` and `extraChannel` on the mouse are refused and send nothing;
  - `IGET` is not in the plain `HandleHid` or the HS80 path, and answers `ERR` without `gi=1`;
  - `helper.cs` keeps CRLF.
- The plain `HandleHid` code and `hs80io.cs` are not touched. The helper.cs diff is 9 added lines: 3 comment lines and
  the `IGET` case inside `HandleHidEx`.
- In `hidio.cs`, `FeatureHandle` also reads `InputReportByteLength` from the same caps call. `FeatureLength`,
  `FeatureSet` and `FeatureGet` are unchanged.
- The C# was compiled to a temp exe with build.ps1's exact source list and references (exit 0).
  `helpers/bin/DeviceHubHelper.exe` was not replaced; DeviceHub rebuilds it on its next start. DeviceHub was not
  restarted, and nothing was sent to any device.
- `npm run test:offline` passes (all 33 scripts).

## Untested on hardware

- `HidD_GetInputReport` on a real Airoha transmitter, and on an access-0 (feature-only) handle.
- The Wooting analog pages and report sizes on any real board.
- Brand sheets `docs/brands/turtle-beach.md` and `wooting.md` and `docs/handoff/more-drivers.md` still describe the
  old gaps (the "helper has no GET_REPORT" note, and "key depth not done"). They are worth a one-line update.
