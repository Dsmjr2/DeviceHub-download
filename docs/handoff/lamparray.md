# Hand-off: HID feature reports and Windows Dynamic Lighting (HID LampArray), 22 Oct 2026

Goal: a device that speaks a standard needs no learning. Two building blocks, nothing wired in yet.

## What was added

| File | What |
|---|---|
| `helpers/hidio.cs` | `HidIo.FeatureSet(byte[] report)`, `HidIo.FeatureGet(byte id, int len)`, `HidIo.FeatureLength`, over hid.dll `HidD_SetFeature` / `HidD_GetFeature`. They use a second handle on the same collection, opened on first use without overlapped I/O, so they never meet the read `Req` keeps in flight. The buffer is always the collection's `FeatureReportByteLength` from Windows' parsed descriptor, which is the length hid.dll expects. Error 1167 (device not connected) throws, which the helper answers as GONE. `Dispose` closes the second handle too. The constructor now keeps `path`. |
| `helpers/native/helper.cs` | Two commands on a `hid:` channel: `FSET <hex...>` (report id first, the rest padded with zeros) answers `OK`, `NONE` (refused, or longer than the collection's feature reports) or `GONE`. `FGET <id hex> <len>` answers `<len>` data bytes in hex without the id, `NONE` or `GONE`. native.js adds `TIMEOUT` as usual. |
| `helpers/hid-host.mjs` | `HostDevice.sendFeatureReport(id, data)` and `HostDevice.receiveFeatureReport(id, length)`, in WebHID's shape. Both run on the device's queue (`serial`). `receiveFeatureReport` returns a DataView with the report id first when the id is not 0, the same as WebHID. Its `length` defaults to `spec.featureLen`, then `spec.len`. GONE throws `{ gone: true }` and marks the device unplugged; NONE, TIMEOUT and ERR throw a plain Error. |
| `helpers/lamparray.mjs` | `LampArray`, the layout readers, and the read-only finder `findLampArrays()`. Its top comment cites the HID Usage Tables' Lighting And Illumination page (0x59), Microsoft's Dynamic Lighting page and Microsoft's ArduinoHidForWindows sample. |
| `tests/lamparray.mjs` | An offline test against pretend devices. It prints `lamparray (pretend devices, HID feature reports): all good`. |

No new .cs file and no change to any build list: both C# changes are in files that build.ps1 and native.js already compile.

## API (for a my-devices driver or DeviceHub)

```js
import { LampArray, findLampArrays, hostSpec, layoutFromCollections } from '../../helpers/lamparray.mjs';

const list = await findLampArrays();   // read-only; [] on this PC
// each: { vid, pid, name, path, inputLen, outputLen, featureLen, fields, layout: { source, reports, problems } }
```

- **`findLampArrays()`** is read-only. It lists every HID collection whose usage page is 0x59 with usage 1 (LampArray). It works the way `hid-caps.ps1` and `HidFind.List` do: each collection is opened with access 0 and its parsed descriptor is read. The product string is asked for only for a LampArray. The PowerShell script is inside the .mjs file and runs with `-EncodedCommand` (about 0.4 to 2 s). The exact bit position of every field is measured on the parsed descriptor in memory: one bit at a time is set in a blank report and read back with `HidP_GetData` / `HidP_GetUsageValueArray`. Nothing goes to the device. Fields that repeat a usage (the colour channels of the multi update) are placed this way too. `layout.problems` lists anything that could not be placed; a report that has a problem is not used.
- **`hostSpec(found, id)`** gives the channel settings for `addSpec()` in hid-host.mjs: page `0059`, usage `0001`, `featureLen`, and so on.
- **`new LampArray(device, layout?)`** takes any `device` that has `sendFeatureReport` / `receiveFeatureReport` (a HostDevice or a WebHID HIDDevice). `layout` comes from `findLampArrays()` (Windows) or `layoutFromCollections(device.collections)`, which is the default and the right one for WebHID. Report ids, lengths and field positions all come from the device, never from the sample's numbers 1-6.
  - `attributes()`: `{ lampCount, boundingBox: { widthUm, heightUm, depthUm }, kind, kindName, minUpdateIntervalUs }` (read).
  - `lamp(id)` / `lamps()`: each lamp's position, purposes, latency, level counts, programmable flag and input binding. It sends a LampAttributesRequestReport, then GETs the response. A response that names another lamp is refused.
  - `readAutonomous()`: true / false, or `null` when the device does not answer a GET of the control report (Microsoft's sample does not).
  - `backup()`: the attributes, every lamp, and the AutonomousMode if it can be read. This is the "read before any write" step.
  - `setAll({ r, g, b, i = 255 }, { useMulti })`: takes control (AutonomousMode 0, read back where possible), keeps MinUpdateInterval since the last update, then sends one LampRangeUpdateReport for lamps 0 to N-1. Without a range report, or with `useMulti`, it sends LampMultiUpdateReports of as many lamps as the device's report holds, with LampUpdateComplete set on the last one only. It returns `{ lamps, reports, via, autonomousReadBack }`.
  - `release()` / `setAutonomous(on)`: AutonomousMode 1 hands control back to the device's own effect.

Example of a my-devices driver for a found LampArray, sketched:

```js
import * as host from '../../helpers/hid-host.mjs';
const [found] = await findLampArrays();
host.addSpec(hostSpec(found, 'desk-light'));
const dev = await host.provider([{ vendorId: parseInt(found.vid, 16), productId: parseInt(found.pid, 16), usagePage: 0x59 }]);
const lights = new LampArray(dev, found.layout);
```

## Untested / to know

- **Never run against a real LampArray.** This PC has none (`findLampArrays()` returned `[]`). The feature I/O in C# compiled but has never sent or read a report on hardware.
- **Field measurement:** the value-array path (`HidP_GetUsageValueArray`) was checked read-only on the Pulsar's vendor feature collection (report 6: 7 x 8 bits at offset 0, which is correct). The single-field path (`HidP_GetData` by DataIndex) has not run on a real descriptor. If a field cannot be placed, it shows up in `problems` and that report is refused. It is never guessed.
- `layoutFromCollections` follows WebHID's documented `collections` shape. It reads usages on Constant items too, because Microsoft's sample marks the attributes report Constant. It has not been tried in Chrome.
- **Colours cannot be read back.** The standard has no GET for lamp colours, and Microsoft's sample answers no GET of the control report either. On such a device the "read back every write" rule can only be met by reading the attributes and lamps before and after. `setAll` reports `autonomousReadBack: null` there.
- Colour values are sent 0-255 as the update channels carry them in Microsoft's sample (level counts 255). The module does not scale them for a lamp whose level counts are lower.
- **Windows' own Dynamic Lighting** (Settings > Personalization > Dynamic Lighting) drives the same device. With "Use Dynamic Lighting on my devices" on, Windows and DeviceHub will fight. The person must turn it off for that device first, the same as closing a maker's app.
- `HidD_SetFeature` / `HidD_GetFeature` have no timeout of their own. A device that never answers holds its channel until native.js's watchdog restarts the helper (3 timeouts in a row on that channel).
- **The next DeviceHub start rebuilds `helpers\bin\DeviceHubHelper.exe`,** because helper.cs and hidio.cs are now newer than it (native.js `build()`). It was compile-checked to `%TEMP%\dh-check-lamp.exe` with build.ps1's exact sources and references: no errors, no warnings.

## Lines to add (the wiring is yours)

**package.json**: add the test to both lines, after `node tests/battery-care.mjs`:
```
"test": "... && node tests/battery-care.mjs && node tests/lamparray.mjs && node tests/release-signing.mjs && node tests/pages.mjs",
"test:offline": "... && node tests/battery-care.mjs && node tests/lamparray.mjs"
```

**server.js**: an optional read-only listing, next to `/api/openrgb` (about line 499). server.js is CommonJS, so it uses a dynamic import:
```js
  // Windows Dynamic Lighting / HID LampArray lights on this PC, read-only (helpers/lamparray.mjs)
  if (url.pathname === '/api/lamparrays') {
    try { const { findLampArrays } = await import('./helpers/lamparray.mjs'); return send(res, 200, { lamparrays: (await findLampArrays()).map(({ fields, ...d }) => d) }); } catch (e) { return send(res, 500, { error: e.message }); }
  }
```

**native.js / build.ps1**: nothing (no new source file).

**CLAUDE.md**:
- In "Adding your own devices", step 2, replace the **Feature reports** bullet with:
  `- **Feature reports:** Razer, many SteelSeries keyboards and ROCCAT devices talk through HID *feature* reports: `sendFeatureReport(id, data)` / `receiveFeatureReport(id, length)` on `HostDevice` (`helpers/hid-host.mjs`, the helper's `FSET` / `FGET` over `HidD_SetFeature` / `HidD_GetFeature`), used from the device's `my-devices` driver.`
- Add to the same step:
  `- **Windows Dynamic Lighting (HID LampArray, usage page 0x59)** needs no learning: `helpers/lamparray.mjs` finds them read-only (`findLampArrays()`, also `/api/lamparrays`), reads their attributes and lamps from the device's own descriptor, sets one color and hands control back (AutonomousMode). Turn off Windows' Dynamic Lighting for that device first. Lamp colors cannot be read back (the standard has no way); read the attributes before and after instead.`
- Map: `helpers/lamparray.mjs      Windows Dynamic Lighting / HID LampArray: finder (read-only), attributes, one color, hand back`
- Checks: `node tests/lamparray.mjs` tests LampArray and feature reports against pretend devices.
- "PC lights" paragraph: after "control stays in Windows Settings", add "(or, with Windows' Dynamic Lighting turned off for it, DeviceHub through `helpers/lamparray.mjs`)".
