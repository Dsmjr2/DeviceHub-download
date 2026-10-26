// The Wooting library driver (device-library/wooting/device.mjs, read only) against simulated Wooting boards that
// answer as docs/brands/wooting.md documents for Wooting's own RGB SDK: an 8-byte feature report (report id 00, D0 DA,
// command, four parameters) answered by an input report starting D0 DA <command>, layout at reply byte 10. Checks the
// one request it may send, the layout and model it shows, that every write is refused (it has no settings), that it
// steps back while Wootility runs, and that nothing on a never list is ever sent. Run: node tests/sim-wooting.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createWooting, MODELS, PIDS, VENDOR_APPS, default: shipped } = await import('../device-library/wooting/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/wooting/device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };

// the entry
ok(!validateMeta(meta) && meta.id === shipped.id && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0, 'device.json: well formed, same id, untested or read-only');
ok(JSON.stringify(meta.pids) === JSON.stringify(PIDS.map((p) => p.toLowerCase())) && meta.vid === shipped.hid.vid.toLowerCase(), 'device.json lists the driver\'s ids');
ok(!problem(shipped) && shipped.settings.length === 0, `loads as a my-devices driver with no settings (${problem(shipped)})`);

// the never list for Wooting (vendor 31E3); "D?" = a nibble wildcard
const pat = (s) => s.trim().split(/\s+/).map((t) => ({ hi: t[0] === '?' ? null : parseInt(t[0], 16), lo: t[1] === '?' ? null : parseInt(t[1], 16) }));
const nib = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));
const NEVERS = NEVER.commands.filter((c) => c.bytes && [].concat(c.vid).includes('31E3')).map((c) => ({ ...c, p: pat(c.bytes) }));
ok(NEVERS.length >= 7, `Wooting never patterns loaded (${NEVERS.length})`);

// a simulated board; time is pretend (receiveReports moves the clock), so a silent board fails at once
function board(pid, o = {}) {
  const s = { layout: 1, answer: true, ...o };
  let queue = [];
  return {
    vendorId: 0x31e3, productId: parseInt(pid, 16), opened: true, sets: [], bad: [], s, clock: 0,
    async sendFeatureReport(id, data) {
      const p = Uint8Array.from(data);
      this.sets.push(`${id}: ${h(p)}`);
      if (id !== 0 || p.length !== 7 || p[0] !== 0xd0 || p[1] !== 0xda) this.bad.push(`not the documented frame: ${id}: ${h(p)}`);
      if (p[2] !== 0x13) this.bad.push(`a command other than GetDeviceConfig (19): ${p[2]}`);
      const n = NEVERS.find((x) => x.p.every((q, i) => nib(q, p[i] ?? 0))); if (n) this.bad.push(`never: ${n.what}`);
      if (!s.answer) return;
      const noise = new Uint8Array(256); noise[0] = 0x55;                       // something else on the channel first
      const r = new Uint8Array(256); r[0] = 0xd0; r[1] = 0xda; r[2] = p[2]; r[4] = 8; r[10] = s.layout;
      queue.push({ reportId: 0, data: new DataView(noise.buffer) }, { reportId: 0, data: new DataView(r.buffer) });
    },
    async receiveReports(ms) { const out = queue; queue = []; if (!out.length) this.clock += ms; return out; },
    async sendReport() { this.bad.push('an output report'); },
  };
}

const make = (devices, app = null) => {
  let clock = 0;
  const d = createWooting({ open: async (pid) => devices.find((x) => x.productId === parseInt(pid, 16)) || null, vendorApp: async () => app.name, now: () => clock + devices.reduce((s, x) => s + x.clock, 0) });
  app ||= { name: null };
  return { d, app, tick: (ms) => { clock += ms; } };
};

// 1. a 60HE (ARM), ISO: model, size, layout; one documented request; no settings, every write refused
{
  const b = board('1310', { layout: 1 });
  const app = { name: null };
  const { d, tick } = make([b], app);
  ok(await d.connect(), '60HE (ARM) connects');
  const i = await d.info();
  ok(i.Model === 'Wooting 60HE (ARM)' && i.Size === '60%' && i.Layout === 'ISO' && i['Product id'] === '31E3:1310', `info (${JSON.stringify(i)})`);
  ok(JSON.stringify(await d.read()) === '{}' && (await d.battery()) === null, 'read has no settings, no battery');
  ok(b.sets.every((x) => x === '0: d0 da 13 00 00 00 00'), `only GetDeviceConfig was sent (${[...new Set(b.sets)]})`);
  const n = b.sets.length;
  for (const [k, v] of [['brightness', 50], ['actuation', 1.5], ['rapidTrigger', true], ['layout', 0]]) ok(!(await attempt(() => d.write(k, v))).ok, `refuses writing ${k}`);
  ok(b.sets.length === n, 'nothing sent for a refused write');
  const bk = await d.rawBackup();
  ok(/^d0 da 13/.test(bk.replies.getDeviceConfig), 'raw backup holds the config reply');

  // Wootility running: reads stop, nothing is sent
  app.name = 'Wootility.exe'; tick(20000);
  const before = b.sets.length;
  ok(!(await attempt(() => d.info())).ok && !(await attempt(() => d.read())).ok, 'refuses to read while Wootility runs');
  ok(b.sets.length === before, 'nothing was sent while it ran');
  app.name = null; tick(20000);
  ok((await attempt(() => d.read())).ok, 'reads again once Wootility is closed');
  ok(VENDOR_APPS.some((re) => re.test('Wootility.exe')) && VENDOR_APPS.some((re) => re.test('wooting-analog-sdk.exe')), 'the step-back patterns catch Wootility');
  ok(b.bad.length === 0, `only the documented frame, nothing on a never list (${b.bad.join('; ')})`);
}

// 2. every model: its name and size; an unknown layout code is shown as a code
for (const pid of PIDS) {
  const b = board(pid, { layout: 9 });
  const { d } = make([b]);
  await d.connect();
  const i = await d.info();
  ok(i.Model === MODELS[pid].name && i.Size && i.Layout === 'unknown (code 9)', `${pid}: ${JSON.stringify(i)}`);
  ok(b.bad.length === 0, `${pid}: only the documented frame (${b.bad.join('; ')})`);
}

// 3. a silent board (no 1337 reply): the read fails, nothing else is tried; no board: no connect
{
  const b = board('1400', { answer: false });
  const { d } = make([b]);
  await d.connect();
  const r = await attempt(() => d.info());
  ok(!r.ok && /no reply/.test(r.e) && b.sets.length === 1, `a silent board fails after one request (${r.e})`);
  ok(!(await make([]).d.connect()), 'nothing plugged in: no connect');
  ok(!(await make([board('1600')]).d.connect()), 'an id not in the table is not taken');
}

// 4. key depth (wooting-analog-sdk device.rs): a second collection, listened to only; both report formats
{
  const { ANALOG, parseV1, parseV2, sdkBuffer } = await import('../device-library/wooting/device.mjs');
  ok(JSON.stringify(shipped.hid.extra) === JSON.stringify([{ name: 'analog-v1', page: 'FF54', usage: '*', len: 256 }, { name: 'analog-v2', page: 'FF53', usage: '*', len: 256 }]),
    `the driver asks for the two analog collections as extras, v1 (FF54) then v2 (FF53) (${JSON.stringify(shipped.hid.extra)})`);
  ok(ANALOG[0].size === 48 && ANALOG[1].size === 64, 'the SDK buffer sizes: ANALOG_BUFFER_SIZE_V1 48, V2 64');
  // v1: [code hi, code lo, value]; 0 values dropped; /255 capped at 1
  const v1 = parseV1(Uint8Array.from([0x00, 0x04, 255, 0x00, 0x05, 0, 0x01, 0x02, 51]));
  ok(v1.length === 2 && v1[0].code === 4 && v1[0].value === 1 && v1[1].code === 0x0102 && Math.abs(v1[1].value - 0.2) < 1e-9, `protocol 1 parse (${JSON.stringify(v1)})`);
  ok(parseV1(new Uint8Array(60).fill(7)).length === 16, 'protocol 1 reads only the 48-byte SDK buffer (16 entries)');
  // v2: [pos, key, packed, value]; row = pos >> 5 & 7, col = pos & 1F, actuated = bit 0, namespace = bits 2-5, value 10-bit
  const pos = (2 << 5) | 9, packed = (3 << 6) | (1 << 2) | 1;
  const v2 = parseV2(Uint8Array.from([pos, 0x1e, packed, 255, 0, 0x1f, 0, 0]));
  ok(v2.length === 1 && v2[0].row === 2 && v2[0].col === 9 && v2[0].actuated && v2[0].code === 0x11e && v2[0].value === 1, `protocol 2 parse (${JSON.stringify(v2)})`);
  const half = parseV2(Uint8Array.from([0, 4, 0, 128]))[0];
  ok(Math.abs(half.value - 512 / 1023) < 1e-9 && !half.actuated, `protocol 2 value (128 << 2) / 1023 (${half.value})`);
  ok(sdkBuffer({ reportId: 0, data: new DataView(Uint8Array.from([1, 2]).buffer) }).join() === '1,2' && sdkBuffer({ reportId: 3, data: new DataView(Uint8Array.from([1, 2]).buffer) }).join() === '3,1,2',
    'hidapi\'s view: report id 0 dropped, any other id kept at byte 0');

  // a board whose host offers extra channels; analogPage = the page that opens (null: none); reports = what READ hands back
  const withAnalog = (pid, analogPage, reports) => {
    const b = board(pid);
    b.opens = []; b.reads = 0;
    b.extraChannel = (name) => {
      const e = shipped.hid.extra.find((x) => x.name === name);
      let open = false;
      return { name, get opened() { return open; },
        async open() { b.opens.push(e.page); open = e.page === analogPage; return open; },
        async receiveReports(ms) { b.reads++; if (!open) throw Object.assign(new Error('not open'), { gone: true }); return reports.splice(0); },
        close() { open = false; } };   // no send of any kind: the real extraChannel has none either
    };
    return b;
  };
  const rep = (bytes) => ({ reportId: 0, data: new DataView(Uint8Array.from(bytes).buffer) });
  {
    const b = withAnalog('1310', 'FF53', [rep([0, 4, 0, 50]), rep([pos, 0x1e, packed, 255, 0, 5, 0, 64])]);
    const { d } = make([b], { name: null });
    await d.connect();
    const k = await d.keyDepth();
    ok(k && k.protocol === 2 && k.page === 'FF53' && k.keys.length === 2 && k.keys[0].row === 2 && k.keys[1].code === 5, `FF53 board: the last report's keys (${JSON.stringify(k)})`);
    ok(b.opens.join() === 'FF54,FF53', `tried in the SDK's order, v1 then v2 (${b.opens})`);
    const i = await d.info();
    ok(/analog protocol 2 \(page FF53\): 0 keys pressed now/.test(i['Key depth'] || ''), `info names the key-depth channel (${i['Key depth']})`);
    ok(b.opens.length === 2, 'the open channel is kept, not reopened');
    ok(b.sets.every((x) => x === '0: d0 da 13 00 00 00 00') && b.bad.length === 0, `still only GetDeviceConfig on the config channel (${b.bad.join('; ')})`);
  }
  {
    const b = withAnalog('1100', 'FF54', [rep([0, 4, 128])]);
    const { d } = make([b], { name: null });
    await d.connect();
    const k = await d.keyDepth();
    ok(k && k.protocol === 1 && k.keys.length === 1 && k.keys[0].code === 4 && Math.abs(k.keys[0].value - 128 / 255) < 1e-9, `FF54 board: protocol 1 (${JSON.stringify(k)})`);
  }
  {
    const b = withAnalog('1400', null, []);
    const { d } = make([b], { name: null });
    await d.connect();
    ok((await d.keyDepth()) === null && !('Key depth' in (await d.info())), 'no analog collection: keyDepth null, info without it');
    const plain = board('1400');   // a host without extra channels (an older DeviceHub)
    const p = make([plain], { name: null }); await p.d.connect();
    ok((await p.d.keyDepth()) === null && (await p.d.info()).Layout === 'ISO', 'a host without extraChannel: keyDepth null, info unchanged');
  }
  {
    const app = { name: null };
    const b = withAnalog('1310', 'FF53', []);
    const { d, tick } = make([b], app);
    await d.connect();
    app.name = 'Wootility.exe'; tick(20000);
    ok(!(await attempt(() => d.keyDepth())).ok && b.opens.length === 0, 'steps back from key depth while Wootility runs (nothing opened)');
  }
}

console.log(fails ? `sim-wooting: ${fails} FAILED` : 'sim-wooting (Wooting model, size, layout and key depth, read only): all good');
process.exitCode = fails ? 1 : 0;
