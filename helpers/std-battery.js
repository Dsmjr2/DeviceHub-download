// Standard battery readings (22 Oct 2026): the battery of ANY wireless mouse, headset or keyboard that reports it through
// a Windows or HID-standard channel, with no per-device learning. Read-only: nothing is ever sent to a device.
//
// 1. Bluetooth: Windows keeps each Bluetooth device's battery level (0-100) as a device property,
//    {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2 (DEVPKEY_Bluetooth_Battery; it is what Settings > Bluetooth & devices
//    shows). It is filled from the GATT Battery Service (0x180F, Battery Level 0x2A19) on Bluetooth LE and from the
//    HFP battery indicator on classic headsets. helpers\std-battery.ps1 -Mode bt reads it with Get-PnpDeviceProperty on
//    every BTHLE\DEV_* and BTHENUM\DEV_* node. Windows keeps the LAST value after a device disconnects, so `connected`
//    (PnP status OK) says whether the number is current. Measured on this PC: a paired, long-disconnected Xbox
//    controller still holds 95.
// 2. USB / 2.4 GHz (and Bluetooth) HID: devices that declare the HID Usage Tables' battery usages. helpers\std-battery.ps1
//    -Mode hid opens each HID collection with access 0 (query only, as helpers\hid-caps.ps1) and lists every Battery
//    System (0x85) and Generic Device Controls Battery Strength (0x06/0x20) field with its report type (input or
//    feature), report id, bit size, logical range and exact bit position. The bit position comes from
//    HidP_SetUsageValue / HidP_SetUsages into a zeroed buffer in memory: hid.dll's own layout, nothing sent.
//    This module reads no HID report itself: `decodeField` turns a report someone else read (for example
//    HostDevice.receiveFeatureReport in helpers\hid-host.mjs) into a value; see docs\handoff\std-battery.md.
//
// Sources:
//   Get-PnpDeviceProperty            https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdeviceproperty
//   Device properties (DEVPROPKEY)   https://learn.microsoft.com/en-us/windows-hardware/drivers/install/unified-device-property-model--windows-vista-and-later-
//   Bluetooth Battery Service 1.1    https://www.bluetooth.com/specifications/specs/battery-service/
//   HidP_GetCaps                     https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/nf-hidpi-hidp_getcaps
//   HidP_GetValueCaps                https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/nf-hidpi-hidp_getvaluecaps
//   HIDP_VALUE_CAPS                  https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/ns-hidpi-_hidp_value_caps
//   HidP_GetButtonCaps / BUTTON_CAPS https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/nf-hidpi-hidp_getbuttoncaps
//   HidP_SetUsageValue               https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidpi/nf-hidpi-hidp_setusagevalue
//   HidD_GetFeature                  https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getfeature
//   HidD_GetInputReport              https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getinputreport
//   Keyboard/mouse collections       https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/hid-clients-supported-in-windows
//   HID Usage Tables 1.5             https://usb.org/document-library/hid-usage-tables-15
//     (section 9 Generic Device Controls page 0x06: Battery Strength 0x20; section 35 Battery System page 0x85:
//      Charging 0x44, Discharging 0x45, RelativeStateOfCharge 0x64, AbsoluteStateOfCharge 0x65, RemainingCapacity 0x66,
//      FullChargeCapacity 0x67, RunTimeToEmpty 0x68, DesignCapacity 0x83, CapacityMode 0x2C, ACPresent 0xD0)
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'std-battery.ps1');
const PS = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const BT_EVERY = 60 * 1000;          // Bluetooth at most once a minute
const HID_EVERY = 10 * 60 * 1000;    // what a HID collection DECLARES only changes when a device is plugged in
const TIMEOUT = 20 * 1000;

const USAGE_NAMES = {
  '6:32': 'batteryStrength',
  '133:68': 'charging', '133:69': 'discharging', '133:100': 'relativeStateOfCharge', '133:101': 'absoluteStateOfCharge',
  '133:102': 'remainingCapacity', '133:103': 'fullChargeCapacity', '133:104': 'runTimeToEmpty', '133:131': 'designCapacity',
  '133:44': 'capacityMode', '133:208': 'acPresent',
};

const hex4 = (n) => (n == null ? null : Number(n).toString(16).toUpperCase().padStart(4, '0'));

// "VID&02045E_PID&0B13" (BTHLEDEVICE child: 2 digits source + 4 vid) or "VID&0001004C_PID&2014" (BTHENUM child: 4 + 4).
// Source 1 = a Bluetooth SIG company id, 2 = a USB vendor id (the Device ID profile's VendorIDSource).
function btIds(s) {
  const m = /VID&([0-9A-F]{0,4})([0-9A-F]{4})_PID&([0-9A-F]{4})/i.exec(String(s || ''));
  if (!m) return { vid: null, pid: null, vidSource: null };
  const src = parseInt(m[1] || '0', 16);
  return { vid: m[2].toUpperCase(), pid: m[3].toUpperCase(), vidSource: src === 2 ? 'usb' : src === 1 ? 'bluetooth' : null };
}

// std-battery.ps1 -Mode bt output -> [{ name, instanceId, vid, pid, percent, connected, source }] (only nodes that hold a level)
function parseBt(json) {
  const list = Array.isArray(json?.bt) ? json.bt : json?.bt ? [json.bt] : [];
  return list.filter((d) => d && Number.isFinite(Number(d.battery)) && d.battery !== '' && d.battery !== null).map((d) => {
    const ids = btIds(d.ids);
    const percent = Math.max(0, Math.min(100, Number(d.battery)));
    return {
      // "Shawn's AirPods Pro #2 - Find My": the name without the Find My suffix (as helpers/pc-map.js does)
      name: d.name ? String(d.name).replace(/\s+-\s+Find My$/i, '') : null, instanceId: d.instanceId, vid: ids.vid, pid: ids.pid, vidSource: ids.vidSource,
      percent, connected: typeof d.connected === 'boolean' ? d.connected : d.status === 'OK', lastConnected: d.lastConnected || null, address: d.address || null,
      source: d.instanceId?.startsWith('BTHLE\\') ? 'bluetooth-le' : 'bluetooth',
    };
  });
}

// std-battery.ps1 -Mode hid output -> [{ instanceId, vid, pid, topUsagePage, topUsage, inLen, featLen, fields: [...] }]
function parseHid(json) {
  const cols = json?.hid?.collections; const list = Array.isArray(cols) ? cols : cols ? [cols] : [];
  return list.map((c) => {
    const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(c.instanceId || '') || /_VID&[0-9A-F]{2}([0-9A-F]{4})_PID&([0-9A-F]{4})/i.exec(c.instanceId || '');
    const fields = (Array.isArray(c.fields) ? c.fields : c.fields ? [c.fields] : []).map((f) => ({
      ...f, name: USAGE_NAMES[`${f.usagePage}:${f.usage}`] || `0x${f.usagePage.toString(16)}/0x${f.usage.toString(16)}`,
    }));
    return {
      instanceId: c.instanceId, name: c.name || null, vid: m ? m[1].toUpperCase() : null, pid: m ? m[2].toUpperCase() : null,
      topUsagePage: hex4(c.topUsagePage), topUsage: c.topUsage, inLen: c.inLen, featLen: c.featLen,
      // a mouse (01/02) or keyboard (01/06) collection is opened by Windows itself: its input reports never reach us,
      // only feature reports (HidD_GetFeature on an access-0 handle) do
      systemOwned: c.topUsagePage === 1 && (c.topUsage === 2 || c.topUsage === 6),
      fields,
      // what to read for a percent, best first
      percentField: ['absoluteStateOfCharge', 'relativeStateOfCharge', 'batteryStrength', 'remainingCapacity']
        .map((n) => fields.find((f) => f.name === n && !f.array && f.bitOffset != null)).find(Boolean) || null,
    };
  });
}

// One field out of a report buffer (byte 0 = report id, as Windows hands it): little-endian bits at bitOffset.
function decodeField(field, report) {
  if (!field || field.bitOffset == null || !report) return null;
  const bytes = report instanceof Uint8Array ? report : Uint8Array.from(report);
  if (field.reportId && bytes[0] !== field.reportId) return null;
  const len = field.bitLength || field.bitSize || 1;
  let v = 0;
  for (let i = 0; i < len; i++) {
    const bit = field.bitOffset + i;
    if (bit >> 3 >= bytes.length) return null;
    if (bytes[bit >> 3] & (1 << (bit & 7))) v += 2 ** i;
  }
  if (field.logicalMin < 0 && v >= 2 ** (len - 1)) v -= 2 ** len;   // signed field
  return v;
}

// A battery value -> percent: scaled over its logical range, as Linux's hid-input battery code does (0..100 stays as is).
// remainingCapacity in mAh-like units needs fullChargeCapacity: pass it as `full`.
function toPercent(field, value, full) {
  if (value == null || !field) return null;
  if (field.logicalMax != null && field.logicalMin != null && value < field.logicalMin) return null;   // null / out of range
  if (field.name === 'remainingCapacity' && full > 0) return Math.round(Math.max(0, Math.min(100, (value / full) * 100)));
  const lo = field.logicalMin ?? 0, hi = field.logicalMax ?? 100;
  if (hi <= lo) return null;
  return Math.round(Math.max(0, Math.min(100, ((value - lo) * 100) / (hi - lo))));
}

function run(mode) {
  return new Promise((resolve) => {
    execFile(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', mode],
      { windowsHide: true, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve({ error: String(err.message).split('\n')[0] });
        try { resolve(JSON.parse(String(out).replace(/^\uFEFF/, '').trim() || '{}')); } catch (e) { resolve({ error: `unreadable output (${e.message})` }); }
      });
  });
}

// Bluetooth through the native helper first (helpers/pc-reads.cs op std-battery-bt: the same { bt } from the same device
// properties, 26 Oct 2026), the script when the helper cannot answer; -Mode hid opens HID collections, so it stays here
const read1 = (kind) => (kind === 'bt' ? require('./helper-reads').read('std-battery-bt', { ps: () => run('bt'), ms: TIMEOUT }) : run(kind));
const caches = { bt: { at: 0, value: null, pending: null }, hid: { at: 0, value: null, pending: null } };
function cached(kind, every, parse, fresh) {
  const c = caches[kind];
  if (c.value && !fresh && Date.now() - c.at < every) return Promise.resolve(c.value);
  if (c.pending) return c.pending;
  if (c.value && fresh && Date.now() - c.at < 5000) return Promise.resolve(c.value);   // "fresh" still never more than every 5 s
  c.pending = read1(kind).then((j) => {
    c.pending = null;
    if (j.error) return c.value || { error: j.error, list: [] };   // keep the last good reading
    c.value = { at: Date.now(), list: parse(j) }; c.at = c.value.at;
    return c.value;
  });
  return c.pending;
}

// The Bluetooth battery list: [{ name, instanceId, vid, pid, percent, connected, lastConnected, source }]
async function read({ fresh = false, connectedOnly = false } = {}) {
  const r = await cached('bt', BT_EVERY, parseBt, fresh);
  const list = r.list || [];
  return connectedOnly ? list.filter((d) => d.connected) : list;
}

// HID collections that DECLARE standard battery usages (discovery only; reading them: docs\handoff\std-battery.md)
async function hidBatteryCaps({ fresh = false } = {}) {
  const r = await cached('hid', HID_EVERY, parseHid, fresh);
  return r.list || [];
}

module.exports = { read, hidBatteryCaps, parseBt, parseHid, decodeField, toPercent, btIds, USAGE_NAMES, _test: { run } };
