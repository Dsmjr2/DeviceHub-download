# Standard batteries (std-battery), 22 Oct 2026

The battery of any wireless mouse, headset or keyboard that reports it through Windows or the HID standard, with no
per-device learning. Read-only: nothing is sent to any device, nothing is opened for writing.

Files (new, nothing else touched):
- `helpers/std-battery.js`: the module (CommonJS), sources cited at its top.
- `helpers/std-battery.ps1`: the reader it runs (`-Mode bt | hid | all`), prints one JSON object.
- `tests/std-battery.mjs`: offline parsing and decoding test (`node tests/std-battery.mjs` -> `std battery (sample output): all good`).

## What it reads

1. **Bluetooth** (`read()`): Windows' battery property `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2` (a byte 0-100, what
   Settings > Bluetooth & devices shows) on every paired `BTHLE\DEV_*` / `BTHENUM\DEV_*` node, falling back to its
   child service nodes. VID/PID come from a child's instance id (`_DEV_VID&02045E_PID&0B13`: source 2 = USB vendor id;
   `_VID&0001004C_PID&2014`: source 1 = Bluetooth SIG company id). `connected` is the same flag `helpers/pc-map.js`
   reads (`{83DA6326-...} 15`). **Windows keeps the last level after a device disconnects**, so show a disconnected
   device's number as "when last connected" (the PC lights page already does). Runs at most every 60 s (`fresh` at
   most every 5 s), one async `powershell.exe` with `windowsHide`, 20 s timeout; a failed run keeps the last good list.
2. **HID battery usages** (`hidBatteryCaps()`, discovery only): every present HID collection is opened with access 0
   (query only, like `hid-caps.ps1`), and its parsed descriptor is searched for Battery System page 0x85 (Charging
   0x44, Discharging 0x45, Relative/AbsoluteStateOfCharge 0x64/0x65, RemainingCapacity 0x66, FullChargeCapacity 0x67,
   RunTimeToEmpty 0x68, DesignCapacity 0x83, CapacityMode 0x2C, ACPresent 0xD0) and Generic Device Controls 0x06
   Battery Strength 0x20, in input and feature reports (HidP_GetValueCaps / HidP_GetButtonCaps). For each field it
   gives the report type, report id, report length, bit size, logical range, Array vs Variable, and the **exact bit
   position** (`bitOffset`, `bitLength`, counted from byte 0 = the report id), found by HidP_SetUsageValue /
   HidP_SetUsages into a zeroed buffer in memory (hid.dll's own layout; nothing is sent). Cached 10 min (what a
   collection declares only changes on plug-in). `percentField` is the best field for a percent.

## API

```js
const stdBattery = require('./helpers/std-battery');
await stdBattery.read({ fresh, connectedOnly })
// -> [{ name, instanceId, vid, pid, vidSource, percent, connected, lastConnected, address, source: 'bluetooth-le'|'bluetooth' }]
await stdBattery.hidBatteryCaps({ fresh })
// -> [{ instanceId, name, vid, pid, topUsagePage, topUsage, inLen, featLen, systemOwned, percentField,
//       fields: [{ name, report: 'input'|'feature', reportId, reportLength, usagePage, usage, bitSize, logicalMin, logicalMax, array, bitOffset, bitLength }] }]
stdBattery.decodeField(field, reportBytes)   // the field's raw value out of a report (byte 0 = report id), or null
stdBattery.toPercent(field, value, full?)    // scaled over the logical range; RemainingCapacity over FullChargeCapacity
stdBattery.parseBt(json) / parseHid(json)    // the pure parsers the test uses
```

`charging` is not in the Bluetooth list: Windows' standard property has no charging flag (the node also carries
`{104EA319-...} 3`, a Boolean, False on the Xbox controller; its meaning is undocumented, so it is not used).

## Real result on this PC (22 Oct 2026)

- **Bluetooth:** 3 paired devices, **none connected** (TP-Link adapter OK). Only the Xbox Wireless Controller
  (BT LE, 045E:0B13) holds a level: **95 %, last connected 6 Jul 2026** (stale). AirPods Pro and YXSM8050BT hold none.
  ~2 s per run.
- **HID:** 24 collections scanned (Pulsar 3710:5406, Corsair HS80 receiver 1B1C:0A6B, Epomaker 342D:E479):
  **none declares a standard battery usage.** All three report battery only through their vendor protocols, which
  DeviceHub already drives. ~1.1 s per scan. The scanner itself was checked by pointing it at X/Y/wheel: it found the
  Pulsar's X at bit 16 (16 bits) and wheel at bit 48, and the Epomaker's array fields as arrays.

## Untested

- A **connected** Bluetooth device with a live level (none was connected); the classic-headset (HFP) path.
- The HID path end to end: no device here declares the usages, so `decodeField` / `toPercent` are tested on samples only.
- Whether `HidD_GetFeature` works on an access-0 handle to a **mouse/keyboard collection** (Windows owns those;
  Microsoft's "HID Clients Supported in Windows" says applications may still use feature reports on them). Verify on
  the first real device before relying on it.

## How the HID read would work (design; not built)

Per `hidBatteryCaps()` collection with a `percentField`:
- **Feature report** (`field.report === 'feature'`): read `receiveFeatureReport(field.reportId, field.reportLength)`
  on a `HostDevice` for that collection (helpers/hid-host.mjs, being added by another agent, backed by
  `HidD_GetFeature`, a GET_REPORT request: a read, changes nothing on the device), then
  `toPercent(f, decodeField(f, bytes))`; the charging field, if declared in the same report, decodes from the same bytes.
  The HostDevice spec comes from the instance id: `vid`, `pid`, `page = topUsagePage`, `usage = topUsage`,
  `len = featLen`, `reportId = field.reportId`. Poll no faster than every 60 s.
- **Input report** on a collection that is not `systemOwned`: the device sends it by itself; listen on the channel
  and decode each report whose byte 0 equals `field.reportId`. (`HidD_GetInputReport` is the polled alternative.)
- **Input report on a mouse/keyboard collection** (`systemOwned`): Windows keeps those reports; not readable from user
  mode. Such a device shows no standard battery (Windows 11 itself ignores it too).

## What to wire (exact lines)

1. **server.js**, next to the `/api/bluetooth` route (around line 496):
   ```js
   // batteries any device reports through Windows or the HID standard (helpers/std-battery.js), read-only
   if (url.pathname === '/api/std-battery') {
     const sb = require('./helpers/std-battery');
     const fresh = url.searchParams.has('fresh');
     try { return send(res, 200, { bluetooth: await sb.read({ fresh }), hid: await sb.hidBatteryCaps({ fresh }) }); }
     catch (e) { return send(res, 500, { error: e.message }); }
   }
   ```
2. **A battery for a device DeviceHub has no driver for:** on the Overview, after the three slots, add one plain
   tile per `bluetooth` entry that is `connected` (name, `batteryCell({ id: 'bt-' + d.address, percent: d.percent, compact: true })`,
   status "Bluetooth"), skipping any whose `vid`/`pid` matches a device DeviceHub already runs (`/api/agent/state`) so
   nothing shows twice. A disconnected one belongs on the PC lights page's Bluetooth list only, as "when last connected".
   (`pc-map.bluetooth()` already gives name/connected/battery there; std-battery adds vid/pid and lastConnected, so that
   list can switch to it later.)
3. **A `my-devices` driver** can return the standard battery from its own `battery()` with
   `(await createRequire(import.meta.url)('../../helpers/std-battery.js').read()).find((d) => d.vid === VID && d.pid === PID)`
   (device.mjs is ESM: `import { createRequire } from 'module'`), so a Bluetooth
   device needs no battery protocol of its own.
4. **package.json**: add `node tests/std-battery.mjs` to `test` and `test:offline` (before `tests/pages.mjs`).
