// The Turtle Beach battery library driver (device-library/turtle-beach-battery/device.mjs, read only) against a
// simulated Stealth 700 Gen 3 transmitter that answers as docs/brands/turtle-beach.md documents: output report 06
// (61 data bytes), replies on input report 07 with a 2-byte length after the report id, and the GSI record as JSON split
// over several reports. Checks that only the sheet's two fixed frames are ever sent (never a RACE nvkey write), the
// battery / charging / linked values, refusals (every write, Swarm II running), and a silent transmitter.
// Run: node tests/sim-turtle-beach-battery.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createTurtleBeach, FRAMES, PIDS, VENDOR_APPS, GET, gsiFrom, default: shipped } = await import('../device-library/turtle-beach-battery/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/turtle-beach-battery/device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };

ok(!validateMeta(meta) && meta.id === shipped.id && meta.status === 'untested' && meta.tested.length === 0, 'device.json: well formed, same id, untested');
ok(JSON.stringify([...meta.pids].sort()) === JSON.stringify([...PIDS].sort()) && !problem(shipped) && shipped.settings.length === 0, 'device.json lists the driver\'s ids; it loads with no settings');
// the sheet's frames, exactly (tb section 2), with the leading 06 as the report id
ok(h([0x06, ...FRAMES.enable]) === '06 06 00 05 5a 02 00 42 99', 'the enable frame is the sheet\'s 06 06 00 05 5A 02 00 42 99');
ok(h([0x06, ...FRAMES.gsi]) === '06 0e 00 05 5a 0a 00 02 99 40 01 00 01 b3 47 53 49', 'the GET /GSI frame is the sheet\'s');
ok(Object.isFrozen(FRAMES) && Object.isFrozen(FRAMES.gsi), 'the frames cannot be changed at run time');

const pat = (s) => s.trim().split(/\s+/).map((t) => ({ hi: t[0] === '?' ? null : parseInt(t[0], 16), lo: t[1] === '?' ? null : parseInt(t[1], 16) }));
const nib = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));
const NEVERS = NEVER.commands.filter((c) => c.bytes && [].concat(c.vid).includes('10F5')).map((c) => ({ ...c, p: pat(c.bytes) }));
ok(NEVERS.some((n) => /nvkey write/.test(n.what)), 'the RACE nvkey write is on DeviceHub\'s never list');

// a simulated transmitter: the GSI JSON, split into 07 reports of up to 58 payload bytes
function transmitter(pid, o = {}) {
  // getOnly: replies are held for GET_REPORT (getInputReport) and never arrive by themselves, as reader.py reads them
  const s = { kvp: { 240: '85', 250: '1', 230: '1', 220: 'Stealth 700 Gen 3', '2c0': '2' }, answer: true, noise: true, getOnly: false, ...o };
  let queue = [], held = [];
  const rep = (payload) => { const d = new Uint8Array(61); d[0] = payload.length & 0xff; d[1] = payload.length >> 8; d.set(payload, 2); return { reportId: 0x07, data: new DataView(d.buffer) }; };
  return {
    vendorId: 0x10f5, productId: parseInt(pid, 16), opened: true, sent: [], bad: [], gets: [], log: [], s, clock: 0,
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(`${id}: ${h(p)}`); this.log.push('send');
      if (id !== 0x06 || p.length !== 61) this.bad.push(`report ${id}, ${p.length} bytes`);
      const pad = (f) => { const u = new Uint8Array(61); u.set(f); return h(u); };
      if (h(p) !== pad(FRAMES.enable) && h(p) !== pad(FRAMES.gsi)) this.bad.push(`not one of the sheet's frames: ${h(p.slice(0, 12))}`);
      for (const n of NEVERS) if ((n.reportId == null || n.reportId === id) && n.p.every((q, i) => nib(q, p[i] ?? 0))) this.bad.push(`never: ${n.what}`);
      if (!s.answer) return;
      const out = s.getOnly ? held : queue;
      if (p[7] === 0x99 && p[6] === 0x02) {   // GET /GSI: RACE reply 05 5B ..., then the CoAP body after FF, as JSON
        if (s.noise) out.push(rep([0x05, 0x5d, 0x02, 0x00, 0x00, 0x00]));   // a pushed indication first
        const body = [0x05, 0x5b, 0x40, 0x00, 0x02, 0x99, 0x60, 0x45, 0xff, ...Buffer.from(JSON.stringify({ OR: 'GSI', KVP: s.kvp }))];
        for (let i = 0; i < body.length; i += 58) out.push(rep(body.slice(i, i + 58)));
      } else out.push(rep([0x05, 0x5b, 0x03, 0x00, 0x42, 0x99, 0x00]));
    },
    // GET_REPORT: the next held reply, or null (the helper's NONE); the shape hid-host's getInputReport resolves
    async getInputReport(id, len) { this.gets.push(`${id}:${len}`); this.log.push('get'); if (id !== 0x07 || len !== 61) this.bad.push(`GET_REPORT ${id} ${len}`); return held.shift() || null; },
    async receiveReports(ms) { const out = queue; queue = []; if (!out.length) this.clock += ms; return out; },
    async sendFeatureReport() { this.bad.push('a feature report'); },
  };
}
const make = (devices, app = { name: null }) => {
  let clock = 0;
  return { d: createTurtleBeach({ open: async (pid) => devices.find((x) => x.productId === parseInt(pid, 16)) || null, vendorApp: async () => app.name, now: () => clock + devices.reduce((a, x) => a + x.clock, 0), sleep: async (ms) => { clock += ms; } }), app, tick: (ms) => { clock += ms; } };
};

// 1. the verified transmitter: battery, charging, name; only the two frames
{
  const t = transmitter('2251');
  const { d, app, tick } = make([t]);
  ok(await d.connect(), 'Stealth 700 Gen 3 (2251) connects');
  const b = await d.battery();
  ok(b && b.percent === 85 && b.charging === true, `battery 85%, charging (${JSON.stringify(b)})`);
  const i = await d.info();
  ok(i['Headset name'] === 'Stealth 700 Gen 3' && i['Headset linked'] === 'yes' && i['Signature Sound preset (raw)'] === '2' && /^yes/.test(i.Charging) && !/not yet/.test(i['Product id']), `info (${JSON.stringify(i)})`);
  ok(JSON.stringify(await d.read()) === '{}', 'read has no settings');
  ok(t.sent.length === 2 && t.bad.length === 0, `only the enable and GSI frames were sent, nothing on a never list (${t.sent.length}; ${t.bad.join('; ')})`);
  ok(t.gets.length === 0, `replies that arrive by themselves: no GET_REPORT asked (${t.gets.length})`);
  const before = t.sent.length;
  for (const [k, v] of [['sidetone', 5], ['eq', 1], ['nvkey', 1]]) ok(!(await attempt(() => d.write(k, v))).ok, `refuses writing ${k}`);
  ok(t.sent.length === before, 'nothing sent for a refused write');

  // charging off, then not linked (headset off): no battery shown
  t.s.kvp = { 240: '40', 250: '0', 230: '1' }; tick(6000);
  ok(JSON.stringify(await d.battery()) === JSON.stringify({ percent: 40, charging: false }), 'battery 40%, not charging');
  t.s.kvp = { 240: '0', 230: '0' }; tick(6000);
  ok((await d.battery()) === null && (await d.info())['Headset linked'] === 'no', 'headset not linked: no battery, linked "no"');
  t.s.kvp = { 240: 'abc', 230: '1' }; tick(6000);
  ok((await d.battery()) === null, 'a battery value that is not 0-100 is not shown');

  // Swarm II running: nothing sent, the read refused
  app.name = 'Turtle Beach Swarm II.exe'; tick(20000);
  const n = t.sent.length;
  ok(!(await attempt(() => d.battery())).ok && t.sent.length === n, 'refuses to read while Swarm II runs, nothing sent');
  app.name = null; tick(20000);
  ok((await attempt(() => d.battery())).ok, 'reads again once Swarm II is closed');
  ok(VENDOR_APPS.some((re) => re.test('Turtle Beach Swarm II.exe')) && VENDOR_APPS.some((re) => re.test('SwarmII.exe')), 'the step-back patterns catch Swarm II');
  ok(t.bad.length === 0, `still only the sheet's frames (${t.bad.join('; ')})`);
}

// 2. a sibling id: works the same, marked as not yet seen working
{
  const t = transmitter('2253');
  const { d } = make([t]);
  await d.connect();
  ok(/not yet seen working/.test((await d.info())['Product id']) && (await d.battery()).percent === 85, 'sibling 2253: read, and labelled as not yet seen working');
}

// 3. a transmitter that never answers: the arriving-reports read, then reader.py's GET_REPORT sequence, then a plain error
{
  const t = transmitter('2251', { answer: false });
  const { d } = make([t]);
  await d.connect();
  const r = await attempt(() => d.battery());
  ok(!r.ok && /no GSI record/.test(r.e), `a silent transmitter: ${r.e}`);
  ok(t.sent.length === 4 && t.bad.length === 0, `the two frames twice (first read, then the GET_REPORT try), nothing else (${t.sent.length}; ${t.bad.join('; ')})`);
  ok(t.gets.length === 2 * GET.drain + GET.attempts && t.gets.every((g) => g === '7:61'), `GET_REPORT: ${2 * GET.drain} drains + ${GET.attempts} gets, all report 07 of 61 bytes (${t.gets.length})`);
  // an older DeviceHub without getInputReport: only the first read, two frames
  const old = transmitter('2251', { answer: false }); delete old.getInputReport;
  const o = make([old]); await o.d.connect();
  ok(!(await attempt(() => o.d.battery())).ok && old.sent.length === 2, 'a channel without getInputReport: the first read only, two frames');
  ok(!(await make([]).d.connect()), 'nothing plugged in: no connect');
  ok(!(await make([transmitter('229b')]).d.connect()), 'the Stealth Pro II (229B, request bytes undocumented) is not taken');
}

// 3b. a transmitter that answers only GET_REPORT (reader.py's way): the fallback reads the record, in reader.py's order
{
  const t = transmitter('2251', { getOnly: true });
  const { d } = make([t]);
  await d.connect();
  const b = await d.battery();
  ok(b && b.percent === 85 && b.charging === true, `GET_REPORT only: battery 85%, charging (${JSON.stringify(b)})`);
  ok(t.sent.length === 4 && t.bad.length === 0, `only the sheet's frames (${t.sent.length}; ${t.bad.join('; ')})`);
  // after the first read's two frames: 5 drains, enable, 5 drains, GSI, 30 gets (reader.py coap_get_json)
  const seq = t.log.slice(2).join(' ');
  const want = [...Array(GET.drain).fill('get'), 'send', ...Array(GET.drain).fill('get'), 'send', ...Array(GET.attempts).fill('get')].join(' ');
  ok(seq === want, `reader.py's order: drain, enable, drain, GSI, ${GET.attempts} gets (${seq.slice(0, 80)})`);
  ok((await d.rawBackup()).replies.via === 'GET_REPORT', 'the backup says the record came by GET_REPORT');
  ok(GET.drain === 5 && GET.afterEnableMs === 300 && GET.attempts === 30 && GET.everyMs === 30, "reader.py's numbers: _drain(times=5), sleep(0.3), attempts=30, sleep(0.03)");
}

// 3c. the channel asks for input reports (gi=1); nothing else about it changed
{
  const { hidSpecs } = await import('../helpers/my-devices.mjs');
  (await import('node:module')).createRequire(import.meta.url)('../helpers/native.js').request = async () => 'GONE';   // no helper, no device
  const { channelOpts } = await import('../helpers/hid-host.mjs');
  const sp = hidSpecs(shipped);
  ok(sp.length === 3 && sp.every((x) => x.inputReports === true && channelOpts(x) === ':rw=1:gi=1'), `each transmitter channel is raw with input reports (${sp.map(channelOpts)})`);
}

// 4. reassembly: first { to last }, other report ids ignored
{
  const mk = (id, text) => { const d = new Uint8Array(61); const b = Buffer.from(text); d[0] = b.length; d.set(b, 2); return { reportId: id, data: new DataView(d.buffer) }; };
  ok(gsiFrom([mk(7, 'xx{"OR":"GSI","KV'), mk(9, 'junk}'), mk(7, 'P":{"240":"77"}}yy')])?.KVP?.['240'] === '77', 'the JSON is joined across reports, other ids ignored');
  ok(gsiFrom([mk(7, '{"OR":"GSI"')]) === null && gsiFrom([mk(7, '{"OR":"GSI"}')]) === null, 'a cut or KVP-less record is not believed');
}

console.log(fails ? `sim-turtle-beach-battery: ${fails} FAILED` : 'sim-turtle-beach-battery (Stealth 700 Gen 3 battery over Airoha RACE, read only): all good');
process.exitCode = fails ? 1 : 0;
