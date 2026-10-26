// The Audeze Maxwell and ASTRO A50 Gen 5 library drivers (device-library/audeze-maxwell, device-library/astro-a50)
// against simulated devices that answer exactly as HeadsetControl documents (lib/devices/audeze_maxwell_device.hpp,
// logitech_astro_a50.hpp @ a8120a6). Maxwell: output report 06, replies asked for as input report 07, a message stream
// split over reports, unrelated messages and empty reports in between. A50: report 02 frames, unasked pushes.
// Checks: connects on each pid, battery decodes, every setting reads, a write is read back and put back, out-of-range
// values and unknown keys refused before anything is sent, the maker's app refused, nothing outside the documented
// requests (or on DeviceHub's never list) is ever sent, and no id DeviceHub's own drivers run. (The import rules for
// these files are tests/library-guard.mjs's.)
// Run: node tests/sim-audeze-astro.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem } from '../helpers/my-devices.mjs';
import { neverHit } from '../helpers/never-guard.mjs';
import { createMaxwell, reportsFor, fragmentOf, nextMessage, frame as maxwellFrame } from '../device-library/audeze-maxwell/device.mjs';
import { createAstroA50 } from '../device-library/astro-a50/device.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RUNS } = createRequire(import.meta.url)('../helpers/pc-map.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message, err: e } } };
const tick = () => new Promise((r) => setTimeout(r, 1));

// ---- the folders ----
for (const [name, ids] of [['audeze-maxwell', ['3329', ['4b19', '4b18', '4b29', '4b28']]], ['astro-a50', ['046d', ['0b1c']]]]) {
  const dir = path.join(ROOT, 'device-library', name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8'));
  const drv = (await import(`../device-library/${name}/device.mjs`)).default;
  ok(!validateMeta(meta), `${name}: device.json is well formed (${validateMeta(meta)})`);
  ok(meta.id === drv.id && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0, `${name}: same id, untested or read-only, no test record`);
  ok(meta.vid === ids[0] && JSON.stringify(meta.pids) === JSON.stringify(ids[1]), `${name}: vid and pids (${meta.vid} ${meta.pids})`);
  ok(JSON.stringify(drv.hid.pids ? drv.hid.pids.map((p) => p.toLowerCase()) : [drv.hid.pid.toLowerCase()]) === JSON.stringify(meta.pids), `${name}: the HID channel covers the same pids`);
  ok(!problem(drv), `${name}: loads as a my-devices driver (${problem(drv)})`);
  ok(!fs.existsSync(path.join(dir, 'driver.json')), `${name}: only device.mjs (no driver.json beside it)`);
  ok(meta.pids.every((p) => !RUNS[`${meta.vid}:${p}`]), `${name}: no id DeviceHub's own drivers run`);
}

// ---- Maxwell framing (HSC :26-43, 150-226) ----
{
  const [r] = reportsFor([0x01, 0x09, 0x00, 0x00]);
  ok(r.length === 61 && h(r.slice(0, 10)) === '08 80 05 5a 04 00 01 09 00 00' && r.slice(10).every((b) => b === 0), `a read-key request is 08 80 05 5A 04 00 01 09 00 00 + zeros (${h(r.slice(0, 10))})`);
  ok(fragmentOf(Uint8Array.from([0, 0x80, 5, 0x5b])).length === 0, 'a report with length 0 carries nothing');
  const s = [0x11, 0x05, 0x5b, 0x03, 0x00, 0xd6, 0x0c, 0x00, 0x05, 0x5d, 0x05, 0x00, 0xd6, 0x0c, 0x00, 0x00, 0x3e, 0x05, 0x5b];
  ok(nextMessage(s).length === 7 && nextMessage(s).length === 9 && nextMessage(s) === null, 'the stream splits into an ack (7) and a result (9); a partial message waits');
  for (const [k, id, v] of [['writeKey', 0x28, 0x88], ['writeKey', 0x07, 1], ['writeKey', 0x00, 0], ['writeKey', 0x00, 11], ['readParam', 0x01], ['readKey', 0x24], ['storeData', 0xef00]]) {
    ok(!(await attempt(() => maxwellFrame(k, id, v))).ok, `frame() refuses ${k} ${id.toString(16)} ${v ?? ''}`);
  }
}

// ---- a simulated Maxwell dongle ----
const ALLOWED_MAXWELL = /^05 5a (04 00 01 09 (00|22|2c|2d) 00|05 00 00 09 (00|2c) 00 [0-9a-f]{2}|04 00 83 2c (07|0b) 00|03 00 d6 0c 00)$/;
function maxwell(pid, o = {}) {
  const s = { eq: 3, level: 12, max: 24, on: 1, chatmix: 10, mic: 0xff, battery: 62, sticky: false, off: false, two: pid >= 0x4b28, ...o };
  const queue = [];
  const dev = {
    vendorId: 0x3329, productId: pid, opened: true, sent: [], bad: [], s,
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      const msg = p.slice(2, 2 + p[0]);
      this.sent.push(h(msg));
      if (id !== 6) this.bad.push(`report id ${id}`);
      if (p.length !== 61) this.bad.push(`length ${p.length}`);
      if (p[1] !== 0x80) this.bad.push('route not 80');
      if (!ALLOWED_MAXWELL.test(h(msg))) this.bad.push(`not a documented request: ${h(msg)}`);
      const n = neverHit({ vid: '3329', pid: pid.toString(16), page: 'FF13', reportId: id, bytes: p }); if (n) this.bad.push(`never: ${n.what}`);
      if (s.off) return;
      const b = Array.from(msg.slice(4));
      const m = (type, body) => [0x05, type, body.length & 0xff, body.length >> 8, ...body];
      let out = [];
      if (b[0] === 0x01 && b[1] === 0x09) {
        const v = { 0x00: s.eq, 0x22: s.mic, 0x2c: s.level, 0x2d: s.max }[b[2]];
        out = m(0x5b, [0x01, 0x09, b[2], 0x00, v === undefined ? 1 : 0, v ?? 0]);
      } else if (b[0] === 0x00 && b[1] === 0x09) {
        if (!s.sticky) {
          if (b[2] === 0x00) s.eq = b[4];
          if (b[2] === 0x2c) { s.level = b[4]; if (!s.two) s.on = 1; }   // HSC :59-61: an original Maxwell switches on
        }
        out = m(0x5b, [0x00, 0x09, b[2], 0x00, 0x00]);
      } else if (b[0] === 0x83 && b[1] === 0x2c) {
        out = m(0x5b, [0x83, 0x2c, 0x00, b[2], 0x00, { 0x07: s.on, 0x0b: s.chatmix }[b[2]]]);
      } else if (b[0] === 0xd6 && b[1] === 0x0c) {
        out = [...m(0x5b, [0xd6, 0x0c, 0x00]), ...m(0x5d, [0xd6, 0x0c, 0x00, 0x00, s.battery])];
      }
      // what a real dongle does around it: an empty report, an unrelated notification, the reply split in two
      const stream = [...m(0x5c, [0x99, 0x0e, 0x01]), ...out];
      queue.push([]);
      const cut = Math.ceil(stream.length / 2);
      queue.push(stream.slice(0, cut), stream.slice(cut));
    },
    async getInputReport(id, len) {
      if (id !== 7 || len !== 61) this.bad.push(`input report ${id}/${len}`);
      const part = queue.shift() || [];
      const r = new Uint8Array(61); r[0] = part.length; r[1] = 0x80; r.set(part, 2);
      if (!part.length) r.fill(0xaa, 2);   // leftovers of older reports: must be ignored
      return { reportId: 7, data: new DataView(r.buffer) };
    },
  };
  return dev;
}

for (const pid of [0x4b19, 0x4b18, 0x4b29, 0x4b28]) {
  const d = maxwell(pid);
  const drv = createMaxwell({ open: async (p) => (parseInt(p, 16) === pid ? d : null), vendorApp: async () => null, sleep: tick, timing: { replyMs: 300, pollMs: 0, readTries: 3 } });
  const tag = pid.toString(16);
  ok(await drv.connect(), `${tag}: connects`);
  ok(drv.pid === tag, `${tag}: on its own pid (${drv.pid})`);
  const b = await drv.battery();
  ok(b && b.percent === 62, `${tag}: battery 62% decodes (${JSON.stringify(b)})`);
  const r = await drv.read();
  ok(JSON.stringify(r) === JSON.stringify({ eqPreset: 3, sidetoneLevel: 12, sidetoneOn: 'on', chatmix: 10, micMuted: 'not muted' }), `${tag}: every setting reads (${JSON.stringify(r)})`);
  ok(drv.settings.find((x) => x.key === 'sidetoneLevel').max === 24, `${tag}: the sidetone slider takes the headset's maximum (key 2D)`);
  const info = await drv.info();
  ok(/Maxwell/.test(info.Model) && info['USB id'] === `3329:${tag.toUpperCase()}`, `${tag}: info (${JSON.stringify(info)})`);

  for (const [key, to] of [['eqPreset', 7], ['sidetoneLevel', 20]]) {
    const was = (await drv.read())[key];
    const w = await attempt(() => drv.write(key, to));
    ok(w.ok && w.v === to && (await drv.read())[key] === to, `${tag}: ${key} ${was} -> ${to} written and read back (${w.e || ''})`);
    const p = await attempt(() => drv.write(key, was));
    ok(p.ok && (await drv.read())[key] === was, `${tag}: ${key} original ${was} put back (${p.e || ''})`);
    const same = await attempt(() => drv.write(key, was));
    ok(same.ok, `${tag}: ${key} writing its own value (the self-check) passes (${same.e || ''})`);
  }
  ok(d.sent.includes('05 5a 05 00 00 09 00 00 07'), `${tag}: EQ preset 7 goes out as 05 5A 05 00 00 09 00 00 07`);

  // out of range, unknown keys, readings: refused before anything is sent
  const before = d.sent.length;
  for (const [k, v] of [['eqPreset', 0], ['eqPreset', 11], ['eqPreset', '3'], ['eqPreset', 2.5], ['sidetoneLevel', 0], ['sidetoneLevel', -1], ['sidetoneLevel', 1.5],
    ['sidetoneOn', 'off'], ['chatmix', 5], ['micMuted', 'muted'], ['volumeLimiter', true], ['autoOff', 30], ['firmware', 1], ['__proto__', 1]]) {
    ok(!(await attempt(() => drv.write(k, v))).ok, `${tag}: refuses ${k} = ${JSON.stringify(v)}`);
  }
  ok(d.sent.every((x, i) => i < before || /01 09 2d/.test(x)), `${tag}: nothing but the max-level read was sent for a refused value`);
  const over = await attempt(() => drv.write('sidetoneLevel', 25));
  ok(!over.ok && /1-24/.test(over.e), `${tag}: a level over the headset's maximum is refused (${over.e})`);
  ok(!d.sent.slice(before).some((x) => / 00 09 /.test(x.slice(12, 18))), `${tag}: and no write went out`);

  // sidetone off: the level is not written (it would switch an original Maxwell on); waiting, not failed
  d.s.on = 0;
  const off = await attempt(() => drv.write('sidetoneLevel', 12));
  ok(!off.ok && off.err.waiting === true && /off/.test(off.e) && d.s.on === 0, `${tag}: no level write while sidetone is off (${off.e})`);
  d.s.on = 1;

  // a write that does not stick: failed, nothing put back over it (it never moved)
  d.s.sticky = true;
  const st = await attempt(() => drv.write('eqPreset', 5));
  ok(!st.ok && /read back 3/.test(st.e) && d.s.eq === 3, `${tag}: a write that does not stick fails (${st.e})`);
  d.s.sticky = false;

  // Audeze HQ open: nothing sent
  const n0 = d.sent.length;
  const app = createMaxwell({ open: async (p) => (parseInt(p, 16) === pid ? d : null), vendorApp: async () => 'Audeze HQ.exe', sleep: tick, timing: { replyMs: 300, pollMs: 0, readTries: 3 } });
  await app.connect();
  ok(!(await attempt(() => app.write('eqPreset', 5))).ok && !(await attempt(() => app.read())).ok && d.sent.length === n0, `${tag}: refused while Audeze HQ runs, nothing sent`);

  ok(d.bad.length === 0, `${tag}: only documented requests, never a never-list one (${d.bad.join('; ')})`);
  const bk = await drv.rawBackup();
  ok(bk.replies.battery && bk.replies['key 00'] && bk.replies['param 07'], `${tag}: raw backup holds the replies`);
}
// headset switched off: the dongle stays silent, battery is unknown, a read fails without hanging
{
  const d = maxwell(0x4b19, { off: true });
  const drv = createMaxwell({ open: async (p) => (p === '4b19' ? d : null), vendorApp: async () => null, sleep: tick, timing: { replyMs: 40, pollMs: 0, readTries: 3 } });
  await drv.connect();
  ok((await drv.battery()) === null, 'headset off: battery is unknown (null)');
  ok(!(await attempt(() => drv.read())).ok, 'headset off: a read fails');
  ok(d.sent.filter((x) => x === '05 5a 03 00 d6 0c 00').length === 3, 'a read is tried 3 times on silence');
  ok(!(await attempt(() => drv.write('eqPreset', 4))).ok && !d.sent.some((x) => /^05 5a 05 00 00 09/.test(x)), 'a write is never sent when the value could not be read first');
}
// nothing plugged in
{
  const drv = createMaxwell({ open: async () => null, vendorApp: async () => null });
  ok((await drv.connect()) === false, 'no Maxwell: connect is false');
}

// ---- a simulated ASTRO A50 Gen 5 base station ----
function a50(o = {}) {
  const s = { battery: 87, docked: 1, chatmix: 6, pushes: true, silent: false, ...o };
  const inbox = [];
  const frameOf = (cmd, payload, handle = 0x00) => { const r = new Uint8Array(63); r.set([0x0c, 3 + payload.length, 0x00, cmd, handle, ...payload]); return r; };
  return {
    vendorId: 0x046d, productId: 0x0b1c, opened: true, sent: [], bad: [], s,
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(h(p.slice(0, 6)));
      if (id !== 2) this.bad.push(`report id ${id}`);
      if (p.length !== 63) this.bad.push(`length ${p.length}`);
      if (!/^0c 03 00 (06|0a) 0c$/.test(h(p.slice(0, 5))) || p.slice(5).some((x) => x)) this.bad.push(`not a documented GET: ${h(p.slice(0, 8))}`);
      const n = neverHit({ vid: '046D', pid: '0B1C', page: 'FF32', reportId: id, bytes: p }); if (n) this.bad.push(`never: ${n.what}`);
      if (s.silent) return;
      if (s.pushes) inbox.push(frameOf(0x08, [0xff, 0x0a]));   // an unasked volume push: must be skipped
      if (p[3] === 0x06) inbox.push(frameOf(0x06, [s.battery, s.battery, s.docked]));
      if (p[3] === 0x0a) inbox.push(frameOf(0x0a, [s.chatmix], 0x0c));
    },
    async receiveReports() { return inbox.splice(0).map((r) => ({ reportId: 2, data: new DataView(r.buffer) })); },
  };
}
{
  const d = a50();
  const drv = createAstroA50({ open: async () => d, vendorApp: async () => null, replyMs: 200 });
  ok(await drv.connect(), 'A50: connects on 046D:0B1C');
  const b = await drv.battery();
  ok(b && b.percent === 87 && b.charging === true, `A50: battery 87%, docked/charging (${JSON.stringify(b)})`);
  d.s.docked = 0; d.s.battery = 40;
  const b2 = await drv.battery();
  ok(b2 && b2.percent === 40 && b2.charging === false, `A50: battery 40%, not charging (${JSON.stringify(b2)})`);
  const r = await drv.read();
  ok(JSON.stringify(r) === JSON.stringify({ chatmix: 6, docked: 'no' }), `A50: readings (${JSON.stringify(r)})`);
  d.s.chatmix = 12;
  ok((await drv.read()).chatmix === 12, 'A50: ChatMix follows the wheel');
  d.s.chatmix = 0xfd;
  ok((await drv.read()).chatmix === undefined, 'A50: a ChatMix outside 0-12 reads as not reported');
  d.s.battery = 0xc8;
  ok((await drv.battery()) === null, 'A50: a battery over 100 is not a level');
  ok(drv.settings.every((x) => x.type === 'display'), 'A50: every setting is a reading');
  const n0 = d.sent.length;
  for (const [k, v] of [['chatmix', 6], ['docked', 'yes'], ['sidetone', 3], ['lights', true], ['firmware', 1]]) ok(!(await attempt(() => drv.write(k, v))).ok, `A50: refuses writing ${k}`);
  ok(d.sent.length === n0, 'A50: nothing sent for a refused write');
  ok(d.sent.includes('0c 03 00 06 0c 00') && d.sent.includes('0c 03 00 0a 0c 00'), 'A50: the two GETs are exactly HeadsetControl\'s frames');
  ok(d.bad.length === 0, `A50: only the documented GETs, never a never-list one (${d.bad.join('; ')})`);

  const app = createAstroA50({ open: async () => d, vendorApp: async () => 'lghub.exe', replyMs: 200 });
  await app.connect();
  const n1 = d.sent.length;
  ok(!(await attempt(() => app.read())).ok && !(await attempt(() => app.battery())).ok && d.sent.length === n1, 'A50: refused while G HUB runs, nothing sent');

  const quiet = a50({ silent: true });
  const q = createAstroA50({ open: async () => quiet, vendorApp: async () => null, replyMs: 60 });
  await q.connect();
  ok((await q.battery()) === null && !(await attempt(() => q.read())).ok, 'A50: no answer = battery unknown, read fails');
  ok((await createAstroA50({ open: async () => null }).connect()) === false, 'A50: nothing plugged in: connect is false');
}

console.log(fails ? `sim-audeze-astro: ${fails} FAILED` : 'sim-audeze-astro (Audeze Maxwell battery, EQ preset, sidetone; ASTRO A50 Gen 5 battery, ChatMix): all good');
process.exitCode = fails ? 1 : 0;
