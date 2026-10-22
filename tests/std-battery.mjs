// helpers/std-battery.js offline: parsing std-battery.ps1's output (samples shaped like this PC's real output, 22 Oct
// 2026, plus made-up HID battery collections) and decoding battery fields out of report bytes. Touches no device.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sb = require('../helpers/std-battery.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// --- Bluetooth: one current LE mouse, the real stale Xbox controller, a classic headset with no level ---
const bt = {
  bt: [
    { instanceId: 'BTHLE\\DEV_D1E2F3A4B5C6\\9&1&0&D1E2F3A4B5C6', name: 'MX Anywhere 3', status: 'Unknown', connected: true, battery: 80, address: 'd1e2f3a4b5c6',
      ids: 'BTHLEDEVICE\\{0000180F-0000-1000-8000-00805F9B34FB}_DEV_VID&02046D_PID&B025_REV&0011_D1E2F3A4B5C6\\A&1&0&0012', lastConnected: '2026-10-22T10:00:00Z' },
    { instanceId: 'BTHLE\\DEV_F46AD7F8D156\\9&26098F93&0&F46AD7F8D156', name: 'Xbox Wireless Controller - Find My', status: 'Unknown', connected: false, battery: 95, address: 'f46ad7f8d156',
      ids: 'BTHLEDEVICE\\{00001801-0000-1000-8000-00805F9B34FB}_DEV_VID&02045E_PID&0B13_REV&0517_F46AD7F8D156\\A&26C88ED8&0&0008', lastConnected: '2026-07-06T19:31:24.7041710Z' },
    { instanceId: 'BTHENUM\\DEV_2C326AB7F017\\8&2C50BA28&0&BLUETOOTHDEVICE_2C326AB7F017', name: 'AirPods', status: 'Unknown', battery: null, address: '2C326AB7F017',
      ids: 'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0001004C_PID&2014\\8&2C50BA28&0&2C326AB7F017_C00000000', lastConnected: null },
    { instanceId: 'BTHENUM\\DEV_69CD70438861\\9&F54462B&0&BLUETOOTHDEVICE_69CD70438861', name: 'YXSM8050BT', status: 'OK', battery: 140, address: '69CD70438861', ids: '', lastConnected: null },
  ],
  hid: null,
};
const b = sb.parseBt(bt);
check(b.length === 3, `devices without a level are left out (${b.length})`);
const mx = b.find((d) => d.name === 'MX Anywhere 3');
check(mx && mx.vid === '046D' && mx.pid === 'B025' && mx.vidSource === 'usb' && mx.percent === 80 && mx.connected && mx.source === 'bluetooth-le', `LE mouse parsed (${JSON.stringify(mx)})`);
const xb = b.find((d) => d.name === 'Xbox Wireless Controller');
check(xb && !xb.connected && xb.percent === 95 && xb.vid === '045E' && xb.pid === '0B13', 'a disconnected device keeps its last level, marked not connected');
const yx = b.find((d) => d.name === 'YXSM8050BT');
check(yx && yx.percent === 100 && yx.vid === null && yx.source === 'bluetooth', 'out-of-range level clamped, no ids -> null vid');
check(sb.parseBt({ bt: bt.bt[0] }).length === 1, 'a single device (ConvertTo-Json drops the array) still parses');
check(sb.parseBt({ bt: null }).length === 0 && sb.parseBt({}).length === 0, 'no Bluetooth: empty list');
check(sb.btIds('BTHENUM\\{x}_VID&0001004C_PID&2014\\y').vidSource === 'bluetooth', 'Bluetooth SIG company id source');

// --- HID: a 2.4 GHz mouse declaring AbsoluteStateOfCharge + Charging in a feature report, a headset with Battery Strength input ---
const hid = { bt: null, hid: { scanned: 24, collections: [
  { instanceId: 'HID\\VID_1234&PID_5678&MI_01&COL02\\8&1&0&0001', name: 'HID-compliant mouse', topUsagePage: 1, topUsage: 2, inLen: 8, featLen: 3,
    fields: [
      { report: 'feature', reportId: 5, reportLength: 3, usagePage: 133, usage: 101, button: false, array: false, linkCollection: 1, bitSize: 8, reportCount: 1, logicalMin: 0, logicalMax: 100, bitOffset: 8, bitLength: 8 },
      { report: 'feature', reportId: 5, reportLength: 3, usagePage: 133, usage: 68, button: true, array: false, linkCollection: 1, bitSize: 1, reportCount: 1, logicalMin: 0, logicalMax: 1, bitOffset: 16, bitLength: 1 },
    ] },
  { instanceId: 'HID\\VID_AAAA&PID_0001&MI_03&COL01\\8&2&0&0000', name: 'HID-compliant headset', topUsagePage: 12, topUsage: 1, inLen: 4, featLen: 0,
    fields: { report: 'input', reportId: 9, reportLength: 4, usagePage: 6, usage: 32, button: false, array: false, linkCollection: 0, bitSize: 4, reportCount: 1, logicalMin: 0, logicalMax: 10, bitOffset: 12, bitLength: 4 } },
] } };
const h = sb.parseHid(hid);
check(h.length === 2, 'two declaring collections');
const mouse = h[0];
check(mouse.vid === '1234' && mouse.pid === '5678' && mouse.systemOwned && mouse.topUsagePage === '0001', `mouse collection parsed (${JSON.stringify(mouse).slice(0, 200)})`);
check(mouse.percentField?.name === 'absoluteStateOfCharge', 'percent comes from AbsoluteStateOfCharge');
const charging = mouse.fields.find((f) => f.name === 'charging');
const feat = [5, 73, 1];   // what receiveFeatureReport(5, 3) would hand back: id 5, 73 %, charging
check(sb.toPercent(mouse.percentField, sb.decodeField(mouse.percentField, feat)) === 73, 'feature report -> 73 %');
check(sb.decodeField(charging, feat) === 1 && sb.decodeField(charging, [5, 73, 0]) === 0, 'charging bit read');
check(sb.decodeField(mouse.percentField, [6, 73, 1]) === null, 'a report with another id is not read');
const head = h[1];
check(!head.systemOwned && head.percentField?.name === 'batteryStrength' && head.fields.length === 1, 'single field (no array) parsed');
check(sb.toPercent(head.percentField, sb.decodeField(head.percentField, [9, 0x70, 0, 0])) === 70, 'Battery Strength 7 of 0-10 at bits 12-15 -> 70 %');
check(sb.toPercent({ name: 'remainingCapacity', logicalMin: 0, logicalMax: 65535 }, 1500, 3000) === 50, 'RemainingCapacity over FullChargeCapacity');
check(sb.decodeField({ bitOffset: 8, bitLength: 8, logicalMin: -127, logicalMax: 127 }, [0, 0xFF]) === -1, 'signed field');
check(sb.parseHid({ hid: { scanned: 24, collections: [] } }).length === 0, 'this PC: no declaring collection -> empty');

console.log(fails.length ? `std battery: FAILED: ${fails.join('; ')}` : 'std battery (sample output): all good');
process.exit(fails.length ? 1 : 0);
