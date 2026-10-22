// HID LampArray (helpers/lamparray.mjs) and the HID layer's feature reports (helpers/hid-host.mjs), against pretend
// devices only: nothing is opened, nothing is sent to hardware. The pretend devices pack and unpack their reports by
// hand from fixed byte offsets (written from Microsoft's ArduinoHidForWindows LampArrayReports.h, then moved to other
// report ids, another lamp count per update and a padding byte), so a layout taken from constants instead of the
// device's own descriptor fails here.
// Run: node tests/lamparray.mjs
import { createRequire } from 'node:module';
import { LampArray, layoutFromCollections, findLampArrays, buildReport, parseReport, USAGE as U, hostSpec } from '../helpers/lamparray.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const throwsAsync = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const ext = (u) => (0x59 << 16) | u;

// ---- a pretend LampArray, byte-aligned fields at hand-written offsets ----
// spec: { ids: {attributes, request, response, multi, range?, control}, slots (lamps per multi update), pad (a padding
// byte after LampCount in the attributes report), withId (receive hands the id back first, as WebHID does) }
function pretend({ ids, slots, pad = 0, lamps, minUs = 0, withId = true, sendLen = null, wrongLamp = false }) {
  const A = { count: 0, width: 2 + pad, height: 6 + pad, depth: 10 + pad, kind: 14 + pad, min: 18 + pad, len: 22 + pad };
  const M = { count: 0, flags: 1, ids: 2, colors: 2 + 2 * slots, len: 2 + 6 * slots };
  const dev = {
    sent: [], autonomous: true, shown: new Array(lamps.length).fill(null), pending: new Array(lamps.length).fill(null), next: 0,
    async sendFeatureReport(id, data) {
      const b = Uint8Array.from(data), dv = new DataView(b.buffer);
      dev.sent.push({ id, bytes: [...b] });
      const need = { [ids.request]: 2, [ids.multi]: M.len, [ids.range]: 9, [ids.control]: 1 }[id];
      if (need == null) throw new Error(`no feature report ${id} to set`);
      if (b.length !== (sendLen ?? need)) throw new Error(`report ${id}: ${b.length} bytes, expected ${sendLen ?? need}`);
      if (id === ids.request) { const l = dv.getUint16(0, true); dev.next = l < lamps.length ? l : 0; }
      if (id === ids.control) dev.autonomous = !!b[0];
      if (id === ids.multi) {
        for (let k = 0; k < b[M.count]; k++) dev.pending[dv.getUint16(M.ids + 2 * k, true)] = b.slice(M.colors + 4 * k, M.colors + 4 * k + 4).join(',');
        if (b[M.flags] & 1) dev.shown = [...dev.pending];
      }
      if (id === ids.range) {
        for (let l = dv.getUint16(1, true); l <= dv.getUint16(3, true); l++) dev.pending[l] = b.slice(5, 9).join(',');
        if (b[0] & 1) dev.shown = [...dev.pending];
      }
    },
    // answers GET for the attributes report and the lamp attributes response only, like Microsoft's sample
    async receiveFeatureReport(id) {
      let b;
      if (id === ids.attributes) {
        b = new Uint8Array(A.len); const dv = new DataView(b.buffer);
        dv.setUint16(A.count, lamps.length, true); if (pad) b[2] = 0xee;
        dv.setUint32(A.width, 120000, true); dv.setUint32(A.height, 40000, true); dv.setUint32(A.depth, 3000, true);
        dv.setUint32(A.kind, 1, true); dv.setUint32(A.min, minUs, true);
      } else if (id === ids.response) {
        const l = wrongLamp ? 0 : dev.next, x = lamps[l];
        b = new Uint8Array(28); const dv = new DataView(b.buffer);
        dv.setUint16(0, l, true); dv.setUint32(2, x.x, true); dv.setUint32(6, 500, true); dv.setUint32(10, 0, true);
        dv.setUint32(14, 4000, true); dv.setUint32(18, x.purposes, true);
        b.set([255, 255, 255, 1, 1, x.key || 0], 22);
        dev.next = (l + 1) % lamps.length;
      } else throw new Error(`report ${id} cannot be read`);
      const out = withId ? Uint8Array.from([id, ...b]) : b;
      return new DataView(out.buffer);
    },
  };
  return dev;
}

// WebHID-shaped collections for the pretend device above (what Chrome's HIDDevice.collections shows)
function collections({ ids, slots, pad = 0, range = true }) {
  const item = (usages, size, count, more = {}) => ({ usages: usages.map(ext), reportSize: size, reportCount: count, isRange: false, ...more });
  const child = (usage, reportId, items) => ({ usagePage: 0x59, usage, children: [], featureReports: [{ reportId, items }] });
  const kids = [
    child(U.LampArrayAttributesReport, ids.attributes, [item([U.LampCount], 16, 1, { isConstant: true }), ...(pad ? [item([], 8, pad, { isConstant: true })] : []),
      item([U.BoundingBoxWidthInMicrometers, U.BoundingBoxHeightInMicrometers, U.BoundingBoxDepthInMicrometers, U.LampArrayKind, U.MinUpdateIntervalInMicroseconds], 32, 5, { isConstant: true })]),
    child(U.LampAttributesRequestReport, ids.request, [item([U.LampId], 16, 1)]),
    child(U.LampAttributesResponseReport, ids.response, [item([U.LampId], 16, 1),
      item([U.PositionXInMicrometers, U.PositionYInMicrometers, U.PositionZInMicrometers, U.UpdateLatencyInMicroseconds, U.LampPurposes], 32, 5),
      item([U.RedLevelCount, U.GreenLevelCount, U.BlueLevelCount, U.IntensityLevelCount, U.IsProgrammable, U.InputBinding], 8, 6)]),
    child(U.LampMultiUpdateReport, ids.multi, [item([U.LampCount], 8, 1), item([U.LampUpdateFlags], 8, 1), item([U.LampId], 16, slots),
      item(Array.from({ length: slots }, () => [U.RedUpdateChannel, U.GreenUpdateChannel, U.BlueUpdateChannel, U.IntensityUpdateChannel]).flat(), 8, 4 * slots)]),
    ...(range ? [child(U.LampRangeUpdateReport, ids.range, [item([U.LampUpdateFlags], 8, 1), item([U.LampIdStart, U.LampIdEnd], 16, 2),
      item([U.RedUpdateChannel, U.GreenUpdateChannel, U.BlueUpdateChannel, U.IntensityUpdateChannel], 8, 4)])] : []),
    child(U.LampArrayControlReport, ids.control, [item([U.AutonomousMode], 8, 1)]),
  ];
  return [{ usagePage: 0x01, usage: 0x06, children: [], featureReports: [] }, { usagePage: 0x59, usage: U.LampArray, children: kids, featureReports: [] }];
}

const lampsOf = (n) => Array.from({ length: n }, (_, i) => ({ x: 1000 * i, purposes: i === 0 ? 4 : 2, key: i + 4 }));
const OTHER = { attributes: 0x11, request: 0x12, response: 0x13, multi: 0x14, range: 0x15, control: 0x16 };

// 1. WebHID layout, other report ids, 4 lamps per multi update, a padding byte: everything read from the descriptor
{
  const spec = { ids: OTHER, slots: 4, pad: 1, lamps: lampsOf(10) };
  const dev = pretend(spec); dev.collections = collections(spec);
  const L = new LampArray(dev);
  check(!L.layout.problems.length, `webhid layout problems: ${L.layout.problems.join('; ')}`);
  check(L.layout.reports.attributes.id === 0x11 && L.layout.reports.control.id === 0x16, 'report ids come from the descriptor');
  check(L.layout.reports.attributes.length === 23 && L.layout.reports.multi.length === 26, `report lengths from the descriptor (${L.layout.reports.attributes.length}, ${L.layout.reports.multi.length})`);
  check(L.layout.reports.multi.fields[U.LampId].length === 4, 'lamps per multi update from the descriptor');
  const b = await L.backup();
  check(b.attributes.lampCount === 10 && b.attributes.boundingBox.widthUm === 120000 && b.attributes.kindName === 'Keyboard', `attributes read past the padding byte (${JSON.stringify(b.attributes)})`);
  check(b.lamps.length === 10 && b.lamps[3].positionUm.x === 3000 && b.lamps[3].inputBinding === 7 && b.lamps[0].purposeNames.join() === 'Branding', 'every lamp read with its own attributes');
  check(b.lamps[9].levels.red === 255 && b.lamps[9].programmable === true && b.lamps[2].updateLatencyUs === 4000, 'lamp levels, programmable, latency');
  check(b.autonomous === null, 'a device that does not answer GET of the control report reads as null');
  check(dev.sent.filter((s) => s.id === 0x12).length === 10, 'one LampAttributesRequestReport per lamp');
  dev.sent = [];
  const r = await L.setAll({ r: 255, g: 80, b: 1 });
  check(r.via === 'range' && r.reports === 1, 'a device with a range report gets one LampRangeUpdateReport');
  check(dev.sent[0].id === 0x16 && dev.sent[0].bytes[0] === 0 && !dev.autonomous, 'control taken first (AutonomousMode 0)');
  check(dev.sent[1].id === 0x15 && dev.sent[1].bytes.join() === '1,0,0,9,0,255,80,1,255', `range report bytes (${dev.sent[1].bytes})`);
  check(dev.shown.every((c) => c === '255,80,1,255'), 'every lamp shows the color');
  dev.sent = [];
  const m = await L.setAll({ r: 9, g: 8, b: 7, i: 6 }, { useMulti: true });
  check(m.via === 'multi' && m.reports === 3 && dev.sent.length === 4, `10 lamps at 4 per report = 3 multi updates (${m.reports})`);
  const multis = dev.sent.filter((s) => s.id === 0x14);
  check(multis.map((s) => s.bytes[0]).join() === '4,4,2' && multis.map((s) => s.bytes[1]).join() === '0,0,1', 'lamp counts 4,4,2 and LampUpdateComplete on the last only');
  check(multis[2].bytes.slice(2, 6).join() === '8,0,9,0' && multis[2].bytes.slice(10, 18).join() === '9,8,7,6,9,8,7,6', `the last multi update names lamps 8 and 9 (${multis[2].bytes})`);
  check(dev.shown.every((c) => c === '9,8,7,6'), 'every lamp shows the multi update color');
  await L.release();
  check(dev.autonomous && dev.sent.at(-1).id === 0x16 && dev.sent.at(-1).bytes[0] === 1, 'release sends AutonomousMode 1');
}

// 2. no range report: setAll falls back to multi updates
{
  const spec = { ids: OTHER, slots: 4, lamps: lampsOf(3) };
  const dev = pretend(spec); dev.collections = collections({ ...spec, range: false });
  const L = new LampArray(dev);
  const r = await L.setAll({ r: 1, g: 2, b: 3 });
  check(r.via === 'multi' && r.reports === 1 && dev.shown.every((c) => c === '1,2,3,255'), 'no range report: one multi update for 3 lamps');
}

// 3. Windows' layout (findLampArrays) of Microsoft's sample: ids 1-6, 8 lamps per update, every report the collection's
// feature length; the channel usages repeat, so Windows lists each as its own field
{
  const S = { attributes: 1, request: 2, response: 3, multi: 4, range: 5, control: 6 };
  const f = (reportId, usage, offset, size, count = 1) => ({ reportId, usagePage: 0x59, usage, offset, size, count, bits: size * count });
  const fields = [
    f(1, U.LampCount, 0, 16), ...[4, 5, 6, 7, 8].map((u, k) => f(1, u, 16 + 32 * k, 32)),
    f(2, U.LampId, 0, 16),
    f(3, U.LampId, 0, 16), ...[0x23, 0x24, 0x25, 0x27, 0x26].map((u, k) => f(3, u, 16 + 32 * k, 32)), ...[0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d].map((u, k) => f(3, u, 176 + 8 * k, 8)),
    f(4, U.LampCount, 0, 8), f(4, U.LampUpdateFlags, 8, 8), f(4, U.LampId, 16, 16, 8),
    ...Array.from({ length: 32 }, (_, k) => f(4, 0x51 + (k % 4), 144 + 8 * k, 8)),
    f(5, U.LampUpdateFlags, 0, 8), f(5, U.LampIdStart, 8, 16), f(5, U.LampIdEnd, 24, 16), ...[0x51, 0x52, 0x53, 0x54].map((u, k) => f(5, u, 40 + 8 * k, 8)),
    f(6, U.AutonomousMode, 0, 8),
    { reportId: 9, usagePage: 0xff00, usage: 1, offset: 0, size: 8, count: 1, bits: 8 },
  ];
  const listing = JSON.stringify([{ vid: '045E', pid: '0B12', name: 'Pretend LampArray', path: '\\\\?\\hid#vid_045e&pid_0b12#x', inputLen: 0, outputLen: 0, featureLen: 51, fields }]);
  const [found] = await findLampArrays({ run: async () => `noise\r\n${listing}\r\n` });
  check(found && !found.layout.problems.length, `windows layout problems: ${found?.layout.problems.join('; ')}`);
  check(found.layout.reports.multi.fields[U.RedUpdateChannel].length === 8 && found.layout.reports.multi.fields[U.RedUpdateChannel][1].offset === 176, 'repeated channel usages become 8 slots each, in report order');
  const spec = { ids: S, slots: 8, lamps: lampsOf(20), sendLen: 50 };
  const dev = pretend(spec);
  // a HostDevice hands back the collection's whole feature length, id first
  const recv = dev.receiveFeatureReport;
  dev.receiveFeatureReport = async (id, length) => { check(length === 50, `asked for ${length} bytes`); const v = new Uint8Array((await recv(id)).buffer); const o = new Uint8Array(51); o.set(v); return new DataView(o.buffer); };
  const L = new LampArray(dev, found.layout);
  const a = await L.attributes();
  check(a.lampCount === 20 && a.boundingBox.depthUm === 3000, 'attributes over the Windows layout');
  check((await L.lamp(5)).positionUm.x === 5000, 'lamp 5 over the Windows layout');
  const r = await L.setAll({ r: 10, g: 20, b: 30 }, { useMulti: true });
  check(r.reports === 3 && dev.shown.every((c) => c === '10,20,30,255'), '20 lamps at 8 per report, padded to the feature length');
  dev.sent = [];
  await L.setAll({ r: 0, g: 0, b: 0, i: 0 });
  check(dev.sent[1].id === 5 && dev.sent[1].bytes.slice(0, 9).join() === '1,0,0,19,0,0,0,0,0' && dev.shown.every((c) => c === '0,0,0,0'), 'range update over the Windows layout');
  check(hostSpec(found, 'lights').featureLen === 50 && hostSpec(found, 'lights').page === '0059', 'hostSpec gives the HostDevice channel');
}

// 4. refusals
{
  check(layoutFromCollections([{ usagePage: 0xff00, usage: 1, children: [], featureReports: [] }]) === null, 'no LampArray collection: no layout');
  check(await throwsAsync(async () => new LampArray({ collections: [] }), /no LampArray/), 'LampArray refuses a device without the collection');
  const spec = { ids: OTHER, slots: 4, lamps: lampsOf(3), wrongLamp: true };
  const dev = pretend(spec); dev.collections = collections(spec);
  check(await throwsAsync(() => new LampArray(dev).lamp(2), /asked for lamp 2/), 'a response for another lamp is refused');
  const noCtl = collections(spec); noCtl[1].children = noCtl[1].children.filter((c) => c.usage !== U.LampArrayControlReport);
  const L = new LampArray(Object.assign(pretend(spec), { collections: noCtl }));
  check(L.layout.problems.some((p) => /control/.test(p)) && (await throwsAsync(() => L.setAll({ r: 1 }), /control/)), 'no control report: setAll refused before any update');
  const rep = { id: 1, length: 3, fields: { 1: [{ offset: 3, size: 12 }], 2: [{ offset: 15, size: 9 }] } };
  const bytes = buildReport(rep, { 1: 0xabc, 2: 0x1ff });
  const back = parseReport(rep, bytes);
  check(back[1] === 0xabc && back[2] === 0x1ff, 'fields at bit offsets that are not byte-aligned round-trip');
  check(parseReport(rep, buildReport(rep, { 1: 99999 }))[1] === 0xfff, 'a value too big for its field is clamped, never spills into the next');
}

// 5. HostDevice feature reports over the helper's FSET / FGET (helpers/native.js stood in for: no helper starts)
{
  const native = createRequire(import.meta.url)('../helpers/native.js');
  const lines = [];
  let answer = (cmd) => (cmd === 'OPEN' ? 'OK' : cmd.startsWith('FSET') ? 'OK' : cmd.startsWith('FGET') ? '01 02 03' : 'NONE');
  native.request = async (chan, cmd) => { lines.push(`${chan} ${cmd}`); return answer(cmd); };
  const host = await import('../helpers/hid-host.mjs');
  host.addSpec({ id: 'lamp-test', vid: '045e', pid: '0b12', page: '0059', usage: '0001', len: 1, featureLen: 3 });
  const dev = await host.provider([{ vendorId: 0x045e, productId: 0x0b12, usagePage: 0x59 }]);
  check(dev && lines[0] === 'hid:045E:0B12:0059:0001:1:0 OPEN', `opened on its channel (${lines[0]})`);
  await dev.sendFeatureReport(6, [1]);
  check(lines.at(-1).endsWith(' FSET 06 01'), `FSET line (${lines.at(-1)})`);
  const v = await dev.receiveFeatureReport(3);
  check(lines.at(-1).endsWith(' FGET 03 3') && v.byteLength === 4 && v.getUint8(0) === 3 && v.getUint8(3) === 3, 'FGET line, reply with the id first like WebHID');
  const v0 = await dev.receiveFeatureReport(0, 3);
  check(v0.byteLength === 3 && v0.getUint8(0) === 1, 'report id 0: no id byte');
  answer = (cmd) => (cmd.startsWith('F') ? 'NONE' : 'OK');
  check(await throwsAsync(() => dev.sendFeatureReport(6, [1]), /did not take/), 'NONE on FSET throws');
  check(await throwsAsync(() => dev.receiveFeatureReport(3), /did not answer/), 'NONE on FGET throws');
  answer = (cmd) => (cmd === 'TIMEOUT' ? 'OK' : 'TIMEOUT');
  check(await throwsAsync(() => dev.receiveFeatureReport(3), /TIMEOUT/), 'TIMEOUT on FGET throws');
  answer = () => 'GONE';
  let gone = false;
  try { await dev.sendFeatureReport(6, [1]); } catch (e) { gone = !!e.gone; }
  check(gone && !dev.opened, 'GONE marks the device unplugged');
}

console.log(fails.length ? `lamparray: FAILED: ${fails.join('; ')}` : 'lamparray (pretend devices, HID feature reports): all good');
process.exit(fails.length ? 1 : 0);
