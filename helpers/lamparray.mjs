// Windows Dynamic Lighting / HID LampArray (22 Oct 2026): any light that speaks the open standard needs no learning.
// Given an opened HID device with a LampArray collection, it reads the LampArrayAttributesReport and each lamp's
// LampAttributes, sets every lamp to one color and hands control back to the device. The report ids, the report
// lengths and where every field sits come from the device's own descriptor (WebHID's `collections`, or Windows'
// parsed descriptor through findLampArrays below), never from the sample's numbers.
//
// Written from, and to be kept in line with:
//   - HID Usage Tables for USB (usb.org, hut1_4.pdf and later), "Lighting And Illumination Page (0x59)": the usage ids
//     in USAGE below, LampArrayKind, LampPurposes, LampUpdateFlags bit 0 = LampUpdateComplete, and AutonomousMode.
//   - Microsoft, "Dynamic lighting devices" (learn.microsoft.com/windows-hardware/design/component-guidelines/
//     dynamic-lighting-devices), which names HID LampArray as the standard and points to its firmware samples:
//   - microsoft/ArduinoHidForWindows (src/LampArrayReportDescriptor.h, LampArrayReports.h, Microsoft_HidLampArray.cpp):
//     all six LampArray reports are FEATURE reports; the device answers GET only for the attributes report and the
//     lamp attributes response (so the control report usually cannot be read back); a LampAttributesRequestReport
//     names the lamp the next response describes (out of range = lamp 0) and the device steps to the next lamp after
//     each response; an update only shows once a report with LampUpdateComplete arrives; the device starts in
//     AutonomousMode and a LampArrayControlReport with AutonomousMode = 0 gives the host control.
//   The sample's layout (ids 1-6, 8 lamps per LampMultiUpdateReport, 16-bit LampIds, 8-bit color channels) is only
//   what most devices copy; this file reads each device's own.
//
// Use (a my-devices driver, or DeviceHub):
//   import { LampArray, findLampArrays } from '../../helpers/lamparray.mjs';
//   const [found] = await findLampArrays();                       // read-only: what this PC has, with each layout
//   const lights = new LampArray(device, found.layout);           // device: HostDevice (helpers/hid-host.mjs) or WebHID
//   const before = await lights.backup();                         // attributes, every lamp, AutonomousMode if readable
//   await lights.setAll({ r: 255, g: 80, b: 0 });                 // takes control, one color on every lamp
//   await lights.release();                                       // AutonomousMode = 1: the device's own effect again
// Read-only parts: findLampArrays, attributes(), lamp(), lamps(), readAutonomous(). Writes: setAll, takeControl, release.

import { execFile } from 'node:child_process';

export const PAGE = 0x59;
export const USAGE = {
  LampArray: 0x01,
  LampArrayAttributesReport: 0x02, LampCount: 0x03, BoundingBoxWidthInMicrometers: 0x04, BoundingBoxHeightInMicrometers: 0x05,
  BoundingBoxDepthInMicrometers: 0x06, LampArrayKind: 0x07, MinUpdateIntervalInMicroseconds: 0x08,
  LampAttributesRequestReport: 0x20, LampId: 0x21, LampAttributesResponseReport: 0x22,
  PositionXInMicrometers: 0x23, PositionYInMicrometers: 0x24, PositionZInMicrometers: 0x25, LampPurposes: 0x26,
  UpdateLatencyInMicroseconds: 0x27, RedLevelCount: 0x28, GreenLevelCount: 0x29, BlueLevelCount: 0x2a, IntensityLevelCount: 0x2b,
  IsProgrammable: 0x2c, InputBinding: 0x2d,
  LampMultiUpdateReport: 0x50, RedUpdateChannel: 0x51, GreenUpdateChannel: 0x52, BlueUpdateChannel: 0x53,
  IntensityUpdateChannel: 0x54, LampUpdateFlags: 0x55,
  LampRangeUpdateReport: 0x60, LampIdStart: 0x61, LampIdEnd: 0x62,
  LampArrayControlReport: 0x70, AutonomousMode: 0x71,
};
const U = USAGE;
export const LAMP_UPDATE_COMPLETE = 1;   // LampUpdateFlags bit 0
// LampArrayKind (HUT; Windows.Devices.Lights.LampArrayKind uses the same numbers); others are shown as their number
export const KINDS = ['Undefined', 'Keyboard', 'Mouse', 'GameController', 'Peripheral', 'Scene', 'Notification', 'Chassis', 'Wearable', 'Furniture', 'Art'];
// LampPurposes bits (HUT)
export const PURPOSES = { 1: 'Control', 2: 'Accent', 4: 'Branding', 8: 'Status', 16: 'Illumination', 32: 'Presentation' };

// what each report must hold for this file to use it
const NEEDS = {
  attributes: [U.LampCount],
  request: [U.LampId],
  response: [U.LampId],
  multi: [U.LampCount, U.LampUpdateFlags, U.LampId, U.RedUpdateChannel, U.GreenUpdateChannel, U.BlueUpdateChannel],
  range: [U.LampUpdateFlags, U.LampIdStart, U.LampIdEnd, U.RedUpdateChannel, U.GreenUpdateChannel, U.BlueUpdateChannel],
  control: [U.AutonomousMode],
};

// Which LampArray report a feature report is, by the usages it carries (LampId is in three of them, LampCount in two).
export function reportKind(usages) {
  const has = (u) => usages.has(u);
  if (has(U.AutonomousMode)) return 'control';
  if (has(U.LampIdStart) || has(U.LampIdEnd)) return 'range';
  if (has(U.RedUpdateChannel) || has(U.LampUpdateFlags)) return 'multi';
  if (has(U.PositionXInMicrometers) || has(U.LampPurposes) || has(U.RedLevelCount)) return 'response';
  if (has(U.BoundingBoxWidthInMicrometers) || has(U.LampArrayKind) || (has(U.LampCount) && !has(U.LampId))) return 'attributes';
  if (has(U.LampId)) return 'request';
  return null;
}

// reports: [{ id, length (data bytes after the id), slots: [{ usage, offset, size }] }] -> the layout this file uses:
// { reports: { attributes: { id, length, fields: { [usage]: [{ offset, size }, ...] } }, ... }, problems: [...] }
function assemble(reports, source) {
  const layout = { source, reports: {}, problems: [] };
  for (const r of reports) {
    const fields = {};
    for (const s of r.slots) (fields[s.usage] ||= []).push({ offset: s.offset, size: s.size });
    for (const k of Object.keys(fields)) fields[k].sort((a, b) => a.offset - b.offset);
    const kind = reportKind(new Set(Object.keys(fields).map(Number)));
    if (!kind) continue;
    if (layout.reports[kind]) { layout.problems.push(`two ${kind} reports (${layout.reports[kind].id} and ${r.id}); the first is used`); continue; }
    const missing = NEEDS[kind].filter((u) => !fields[u]);
    if (missing.length) { layout.problems.push(`${kind} report ${r.id} lacks usage ${missing.map((u) => '0x' + u.toString(16)).join(', ')}`); continue; }
    const end = Math.max(...r.slots.map((s) => s.offset + s.size));
    if (end > r.length * 8) { layout.problems.push(`${kind} report ${r.id} has fields past its length`); continue; }
    layout.reports[kind] = { id: r.id, length: r.length, fields };
  }
  for (const k of ['attributes', 'request', 'response', 'control']) if (!layout.reports[k]) layout.problems.push(`no usable ${k} report`);
  if (!layout.reports.multi && !layout.reports.range) layout.problems.push('no usable LampMultiUpdateReport or LampRangeUpdateReport');
  return layout;
}

// WebHID's HIDDevice.collections (also what a my-devices driver can describe by hand): the LampArray collection and
// every collection inside it. Each item covers reportCount slots of reportSize bits; slot i takes usages[i], the last
// usage repeating (HID's rule), or usageMinimum + i for a range; an item with no usages is padding. LampArray's
// attributes report is marked Constant in Microsoft's sample, so Constant items with usages are fields too.
export function layoutFromCollections(collections) {
  const top = (collections || []).find((c) => c.usagePage === PAGE && c.usage === U.LampArray);
  if (!top) return null;
  const byId = new Map();
  const walk = (c) => { for (const r of c.featureReports || []) if (!byId.has(r.reportId)) byId.set(r.reportId, r); for (const ch of c.children || []) walk(ch); };
  walk(top);
  const reports = [];
  for (const [id, r] of byId) {
    const slots = [];
    let bit = 0;
    for (const it of r.items || []) {
      const us = it.usages || [];
      for (let i = 0; i < it.reportCount; i++, bit += it.reportSize) {
        const ext = it.isRange ? Math.min(it.usageMinimum + i, it.usageMaximum) : us.length ? us[Math.min(i, us.length - 1)] : null;
        if (ext == null || ext >>> 16 !== PAGE) continue;
        slots.push({ usage: ext & 0xffff, offset: bit, size: it.reportSize });
      }
    }
    reports.push({ id, length: Math.ceil(bit / 8), slots });
  }
  return assemble(reports, 'webhid');
}

// One entry of findLampArrays' Windows listing: fields measured on Windows' parsed descriptor; every feature report is
// featureLen - 1 data bytes long there (hid.dll always moves the collection's longest feature report).
export function layoutFromWindows(entry) {
  const byId = new Map();
  const problems = [];
  for (const f of entry.fields || []) {
    if (f.usagePage !== PAGE) continue;
    if (f.offset < 0 || f.bits !== f.size * f.count) { problems.push(`report ${f.reportId} usage 0x${f.usage.toString(16)}: could not place it in the report`); continue; }
    if (!byId.has(f.reportId)) byId.set(f.reportId, []);
    for (let i = 0; i < f.count; i++) byId.get(f.reportId).push({ usage: f.usage, offset: f.offset + i * f.size, size: f.size });
  }
  const layout = assemble([...byId].map(([id, slots]) => ({ id, length: entry.featureLen - 1, slots })), 'windows');
  layout.problems.unshift(...problems);
  return layout;
}

// ---- bits in a report (little-endian, as HID packs them) ----
function put(buf, { offset, size }, value) {
  const max = 2 ** size - 1;
  let v = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
  for (let b = 0; b < size; b++, v = Math.floor(v / 2)) {
    const at = offset + b;
    if (v % 2) buf[at >> 3] |= 1 << (at & 7); else buf[at >> 3] &= ~(1 << (at & 7));
  }
}
function get(buf, { offset, size }) {
  let v = 0;
  for (let b = size - 1; b >= 0; b--) { const at = offset + b; v = v * 2 + ((buf[at >> 3] >> (at & 7)) & 1); }
  return v;
}
// a report's bytes (without its id) from { usage: value | [values in slot order] }
export function buildReport(report, values) {
  const buf = new Uint8Array(report.length);
  for (const [u, v] of Object.entries(values)) {
    const slots = report.fields[u];
    if (!slots) continue;
    const list = Array.isArray(v) ? v : [v];
    list.slice(0, slots.length).forEach((x, i) => put(buf, slots[i], x));
  }
  return buf;
}
// { usage: value } for single fields, { usage: [values] } for repeated ones
export function parseReport(report, bytes) {
  const out = {};
  for (const [u, slots] of Object.entries(report.fields)) {
    const vals = slots.map((s) => get(bytes, s));
    out[u] = vals.length === 1 ? vals[0] : vals;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LampArray {
  // device: anything with sendFeatureReport(id, data) and receiveFeatureReport(id[, length]) (HostDevice, WebHID).
  // layout: from findLampArrays (Windows) or layoutFromCollections; by default the device's own WebHID collections.
  constructor(device, layout = layoutFromCollections(device.collections)) {
    if (!layout) throw new Error('this device has no LampArray collection (HID usage page 0x59)');
    this.device = device; this.layout = layout;
    this.attr = null; this.lampList = null; this.lastUpdate = 0;
  }

  report(kind) {
    const r = this.layout.reports[kind];
    if (!r) throw new Error(`this LampArray has no usable ${kind} report (${this.layout.problems.join('; ') || 'not in its descriptor'})`);
    return r;
  }
  async receive(kind) {
    const r = this.report(kind);
    const dv = await this.device.receiveFeatureReport(r.id, r.length);
    let bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    // WebHID and HostDevice hand the report back with its id first when the device uses ids
    if (r.id !== 0 && bytes.length > r.length && bytes[0] === r.id) bytes = bytes.subarray(1);
    const end = Math.max(...Object.values(r.fields).flat().map((s) => s.offset + s.size));
    if (bytes.length * 8 < end) throw new Error(`${kind} report ${r.id} came back short (${bytes.length} bytes)`);
    return parseReport(r, bytes);
  }
  async send(kind, values) { const r = this.report(kind); await this.device.sendFeatureReport(r.id, buildReport(r, values)); }

  // LampArrayAttributesReport (read-only)
  async attributes() {
    const v = await this.receive('attributes');
    const kind = v[U.LampArrayKind];
    this.attr = {
      lampCount: v[U.LampCount],
      boundingBox: { widthUm: v[U.BoundingBoxWidthInMicrometers] ?? null, heightUm: v[U.BoundingBoxHeightInMicrometers] ?? null, depthUm: v[U.BoundingBoxDepthInMicrometers] ?? null },
      kind: kind ?? null, kindName: kind == null ? null : KINDS[kind] || `kind ${kind}`,
      minUpdateIntervalUs: v[U.MinUpdateIntervalInMicroseconds] ?? 0,
    };
    return this.attr;
  }

  // One lamp's LampAttributes: a LampAttributesRequestReport naming it, then the response (read-only for the lights)
  async lamp(id) {
    await this.send('request', { [U.LampId]: id });
    const v = await this.receive('response');
    if (v[U.LampId] !== id) throw new Error(`asked for lamp ${id}, the device described lamp ${v[U.LampId]}`);
    const purposes = v[U.LampPurposes] ?? 0;
    return {
      id,
      positionUm: { x: v[U.PositionXInMicrometers] ?? null, y: v[U.PositionYInMicrometers] ?? null, z: v[U.PositionZInMicrometers] ?? null },
      purposes, purposeNames: Object.entries(PURPOSES).filter(([bit]) => purposes & bit).map(([, n]) => n),
      updateLatencyUs: v[U.UpdateLatencyInMicroseconds] ?? null,
      levels: { red: v[U.RedLevelCount] ?? null, green: v[U.GreenLevelCount] ?? null, blue: v[U.BlueLevelCount] ?? null, intensity: v[U.IntensityLevelCount] ?? null },
      programmable: v[U.IsProgrammable] == null ? null : !!v[U.IsProgrammable],
      inputBinding: v[U.InputBinding] ?? null,
    };
  }
  async lamps() {
    const a = this.attr || (await this.attributes());
    const list = [];
    for (let i = 0; i < a.lampCount; i++) list.push(await this.lamp(i));
    this.lampList = list;
    return list;
  }

  // AutonomousMode read from the LampArrayControlReport; null when the device does not answer a GET of it
  // (Microsoft's sample does not), so a write to it cannot be read back on such a device.
  async readAutonomous() {
    try { return !!(await this.receive('control'))[U.AutonomousMode]; } catch (e) { if (e.gone) throw e; return null; }
  }

  // The rules' "read before any write": everything the standard lets a host read
  async backup() {
    const attributes = await this.attributes();
    return { attributes, lamps: await this.lamps(), autonomous: await this.readAutonomous(), layout: this.layout };
  }

  // AutonomousMode = 0 / 1. Returns what a read-back says: true / false, or null when the device cannot be read back.
  async setAutonomous(on) {
    await this.send('control', { [U.AutonomousMode]: on ? 1 : 0 });
    const back = await this.readAutonomous();
    if (back !== null && back !== !!on) throw new Error(`AutonomousMode reads ${back ? 1 : 0} after writing ${on ? 1 : 0}`);
    return back;
  }
  takeControl() { return this.setAutonomous(false); }
  release() { return this.setAutonomous(true); }

  // Every lamp to one color (0-255 per channel, as the update channels carry them; intensity 255 when left out).
  // Takes control first, then one LampRangeUpdateReport (lamps 0 to LampCount - 1), or LampMultiUpdateReports of as
  // many lamps as the device's report holds, LampUpdateComplete on the last. Keeps MinUpdateIntervalInMicroseconds
  // between updates. The standard has no way to read lamp colors back: returns what was sent.
  async setAll({ r = 0, g = 0, b = 0, i = 255 } = {}, { useMulti = false } = {}) {
    const a = this.attr || (await this.attributes());
    if (!a.lampCount) throw new Error('this LampArray reports no lamps');
    const control = await this.takeControl();
    const wait = this.lastUpdate + a.minUpdateIntervalUs / 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const color = { [U.RedUpdateChannel]: r, [U.GreenUpdateChannel]: g, [U.BlueUpdateChannel]: b, [U.IntensityUpdateChannel]: i };
    let reports = 0;
    const via = this.layout.reports.range && !useMulti ? 'range' : 'multi';
    if (via === 'range') {
      await this.send('range', { [U.LampUpdateFlags]: LAMP_UPDATE_COMPLETE, [U.LampIdStart]: 0, [U.LampIdEnd]: a.lampCount - 1, ...color });
      reports = 1;
    } else {
      const m = this.report('multi');
      const per = Math.min(...[U.LampId, U.RedUpdateChannel, U.GreenUpdateChannel, U.BlueUpdateChannel].map((u) => m.fields[u].length));
      for (let start = 0; start < a.lampCount; start += per) {
        const ids = []; for (let k = start; k < Math.min(a.lampCount, start + per); k++) ids.push(k);
        const each = (v) => ids.map(() => v);
        await this.send('multi', {
          [U.LampCount]: ids.length, [U.LampUpdateFlags]: start + per >= a.lampCount ? LAMP_UPDATE_COMPLETE : 0, [U.LampId]: ids,
          [U.RedUpdateChannel]: each(r), [U.GreenUpdateChannel]: each(g), [U.BlueUpdateChannel]: each(b), [U.IntensityUpdateChannel]: each(i),
        });
        reports++;
      }
    }
    this.lastUpdate = Date.now();
    return { lamps: a.lampCount, reports, via, autonomousReadBack: control };
  }
}

// ---- read-only finder: every HID collection on this PC that is a LampArray (usage page 0x59, usage 1) ----
// The way helpers/hid-caps.ps1 and the helper's HidFind.List look: each collection opened with access 0 (query
// only), Windows' parsed descriptor read; only a LampArray's product string is asked for. Nothing is sent to any
// device: where each field sits is measured on that parsed descriptor alone (one bit set at a time in a blank report
// in memory, read back with HidP_GetData / HidP_GetUsageValueArray), which also places fields that repeat a usage.
const FINDER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class LampFind {
  [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid g; public int flags; public IntPtr r; }
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, string e, IntPtr w, int f);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA o);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int need, IntPtr info);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint d, uint f, IntPtr t);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr pp);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr pp);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr pp, byte[] caps);
  [DllImport("hid.dll")] static extern int HidP_GetValueCaps(int type, [Out] byte[] caps, ref ushort len, IntPtr pp);
  [DllImport("hid.dll")] static extern uint HidP_MaxDataListLength(int type, IntPtr pp);
  [DllImport("hid.dll")] static extern int HidP_GetData(int type, [Out] byte[] data, ref uint len, IntPtr pp, byte[] report, uint reportLen);
  [DllImport("hid.dll")] static extern int HidP_GetUsageValueArray(int type, ushort page, ushort link, ushort usage, [Out] byte[] value, ushort valueLen, IntPtr pp, byte[] report, uint reportLen);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(SafeFileHandle h, byte[] b, int len);
  const int FEATURE = 2, OK = 0x110000;
  class F { public int Rid, Page, Link, Usage, Size, Count, Index, Lo = -1, Hi = -1; }
  static string Esc(string s) {
    var b = new StringBuilder();
    foreach (var ch in s ?? "") { if (ch == '"' || ch == '\\') b.Append('\\').Append(ch); else if (ch < ' ') b.Append(' '); else b.Append(ch); }
    return b.ToString();
  }
  static string Device(SafeFileHandle h, IntPtr pp, byte[] c, string vid, string pid, string path) {
    int featLen = BitConverter.ToUInt16(c, 8);
    ushort nv = BitConverter.ToUInt16(c, 60);
    var fs = new List<F>();
    if (nv > 0 && featLen > 1) {
      var vc = new byte[72 * nv]; ushort n = nv;
      if (HidP_GetValueCaps(FEATURE, vc, ref n, pp) == OK) {
        for (int i = 0; i < n; i++) {
          int o = i * 72;
          bool range = vc[o + 12] != 0;
          int page = BitConverter.ToUInt16(vc, o), rid = vc[o + 2], link = BitConverter.ToUInt16(vc, o + 6);
          int size = BitConverter.ToUInt16(vc, o + 18), count = BitConverter.ToUInt16(vc, o + 20);
          int u0 = BitConverter.ToUInt16(vc, o + 56), u1 = range ? BitConverter.ToUInt16(vc, o + 58) : u0, d0 = BitConverter.ToUInt16(vc, o + 68);
          for (int u = u0; u <= u1; u++) fs.Add(new F { Rid = rid, Page = page, Link = link, Usage = u, Size = size, Count = range ? 1 : Math.Max(1, count), Index = d0 + (u - u0) });
        }
      }
      uint max = HidP_MaxDataListLength(FEATURE, pp);
      var rids = new HashSet<int>(); foreach (var f in fs) rids.Add(f.Rid);
      foreach (var rid in rids) {
        for (int k = 0; k < (featLen - 1) * 8; k++) {
          var rep = new byte[featLen]; rep[0] = (byte)rid; rep[1 + k / 8] = (byte)(1 << (k % 8));
          var data = new byte[8 * Math.Max(1, max)]; uint len = max;
          if (max > 0 && HidP_GetData(FEATURE, data, ref len, pp, rep, (uint)featLen) == OK) {
            for (int j = 0; j < len; j++) {
              int index = BitConverter.ToUInt16(data, j * 8); uint raw = BitConverter.ToUInt32(data, j * 8 + 4);
              if (raw == 0) continue;
              foreach (var f in fs) if (f.Rid == rid && f.Count == 1 && f.Index == index) { if (f.Lo < 0) f.Lo = k; f.Hi = k; }
            }
          }
          foreach (var f in fs) {
            if (f.Rid != rid || f.Count == 1) continue;
            var v = new byte[(f.Size * f.Count + 7) / 8];
            if (HidP_GetUsageValueArray(FEATURE, (ushort)f.Page, (ushort)f.Link, (ushort)f.Usage, v, (ushort)v.Length, pp, rep, (uint)featLen) != OK) continue;
            foreach (var x in v) if (x != 0) { if (f.Lo < 0) f.Lo = k; f.Hi = k; break; }
          }
        }
      }
    }
    var nb = new byte[256]; string name = HidD_GetProductString(h, nb, nb.Length) ? Encoding.Unicode.GetString(nb).TrimEnd('\0') : "";
    var s = new StringBuilder();
    s.Append("{\"vid\":\"" + vid + "\",\"pid\":\"" + pid + "\",\"name\":\"" + Esc(name) + "\",\"path\":\"" + Esc(path) + "\"");
    s.Append(",\"inputLen\":" + BitConverter.ToUInt16(c, 4) + ",\"outputLen\":" + BitConverter.ToUInt16(c, 6) + ",\"featureLen\":" + featLen + ",\"fields\":[");
    for (int i = 0; i < fs.Count; i++) {
      var f = fs[i];
      if (i > 0) s.Append(',');
      s.Append("{\"reportId\":" + f.Rid + ",\"usagePage\":" + f.Page + ",\"usage\":" + f.Usage + ",\"offset\":" + f.Lo + ",\"size\":" + f.Size + ",\"count\":" + f.Count + ",\"bits\":" + (f.Lo < 0 ? 0 : f.Hi - f.Lo + 1) + "}");
    }
    return s.Append("]}").ToString();
  }
  public static string Json() {
    var all = new List<string>();
    Guid g; HidD_GetHidGuid(out g);
    IntPtr set = SetupDiGetClassDevs(ref g, null, IntPtr.Zero, 0x12);
    try {
      for (int i = 0; ; i++) {
        var d = new SP_DEVICE_INTERFACE_DATA(); d.cbSize = Marshal.SizeOf(d);
        if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d)) break;
        int need; SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
        IntPtr buf = Marshal.AllocHGlobal(need);
        try {
          Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
          if (!SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero)) continue;
          string path = Marshal.PtrToStringUni(buf + 4);
          var m = System.Text.RegularExpressions.Regex.Match(path ?? "", "vid_([0-9a-f]{4})&pid_([0-9a-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
          using (var h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
            if (h.IsInvalid) continue;
            IntPtr pp; if (!HidD_GetPreparsedData(h, out pp)) continue;
            try {
              var c = new byte[64]; HidP_GetCaps(pp, c);
              if (BitConverter.ToUInt16(c, 2) != 0x59 || BitConverter.ToUInt16(c, 0) != 1) continue;
              all.Add(Device(h, pp, c, m.Success ? m.Groups[1].Value.ToUpper() : "", m.Success ? m.Groups[2].Value.ToUpper() : "", path));
            } finally { HidD_FreePreparsedData(pp); }
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
    return "[" + string.Join(",", all) + "]";
  }
}
'@
[LampFind]::Json()
`;

// Resolves with [{ vid, pid, name, path, inputLen, outputLen, featureLen, fields, layout }]; [] when there are none.
// run: for tests, a stand-in for PowerShell that resolves with its output text.
export async function findLampArrays({ run } = {}) {
  run ||= () => new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(FINDER, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 60000, maxBuffer: 4 << 20 }, (e, out, err) => (e ? reject(new Error(`LampArray finder failed: ${String(err || e.message).split('\n')[0]}`)) : resolve(out))));
  const text = String(await run()).trim();
  const list = JSON.parse(text.slice(text.indexOf('[')) || '[]');
  return list.map((d) => ({ ...d, layout: layoutFromWindows(d) }));
}

// For a HostDevice (helpers/hid-host.mjs addSpec): the channel settings of one found LampArray
export const hostSpec = (found, id) => ({ id, vid: found.vid, pid: found.pid, page: '0059', usage: '0001', len: Math.max(1, found.inputLen - 1), reportId: 0, featureLen: found.featureLen - 1, productName: found.name || 'LampArray' });
