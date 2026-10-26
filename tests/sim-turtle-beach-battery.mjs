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
const { createTurtleBeach, FRAMES, PRO2_FRAMES, PRO2_GET, PIDS, VENDOR_APPS, GET, gsiFrom, default: shipped } = await import('../device-library/turtle-beach-battery/device.mjs');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/turtle-beach-battery/device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };

ok(!validateMeta(meta) && meta.id === shipped.id && (meta.status === 'untested' || meta.status === 'read-only') && meta.tested.length === 0, 'device.json: well formed, same id, untested or read-only');
ok(JSON.stringify([...meta.pids].sort()) === JSON.stringify([...PIDS].sort()) && !problem(shipped) && shipped.settings.length === 0, 'device.json lists the driver\'s ids; it loads with no settings');
// the sheet's frames, exactly (tb section 2), with the leading 06 as the report id
ok(h([0x06, ...FRAMES.enable]) === '06 06 00 05 5a 02 00 42 99', 'the enable frame is the sheet\'s 06 06 00 05 5A 02 00 42 99');
ok(h([0x06, ...FRAMES.gsi]) === '06 0e 00 05 5a 0a 00 02 99 40 01 00 01 b3 47 53 49', 'the GET /GSI frame is the sheet\'s');
ok(Object.isFrozen(FRAMES) && Object.isFrozen(FRAMES.gsi), 'the frames cannot be changed at run time');
// the Stealth Pro II's two captured asks, exactly (HaloBattery PR #194 ASK_SINF / ASK_GSI, capture packets 150 and 616)
const full = (f) => { const u = new Uint8Array(62); u[0] = 6; u.set(f, 1); return h(u); };
ok(full(PRO2_FRAMES.sinf) === h(Buffer.from('061800055a140002994801c04a010000' + '0000000000610053496e66'.padEnd(92, '0'), 'hex')), 'the Pro II SInf ask is the capture\'s');
ok(full(PRO2_FRAMES.gsi) === h(Buffer.from('061800055a140002994801441404000' + '0' + '00000000006100534753490000000000'.padEnd(92, '0'), 'hex')), 'the Pro II GSI ask is the capture\'s');
ok(PRO2_FRAMES.sinf.length === 26 && PRO2_FRAMES.gsi.length === 26 && PRO2_FRAMES.gsi[0] === 24, 'Pro II asks: 24 content bytes counted from byte 3 to the record name');
ok(PRO2_FRAMES.gsi[6] === 0x02 && PRO2_FRAMES.gsi[7] === 0x99 && PRO2_FRAMES.sinf[6] === 0x02 && PRO2_FRAMES.sinf[7] === 0x99, 'both Pro II asks are RACE 0x9902, the same CoAP tunnel as the 700\'s GET /GSI');
ok(!PIDS.includes('223a') && Object.isFrozen(PRO2_FRAMES) && Object.isFrozen(PRO2_FRAMES.gsi), 'the Stealth 600 Gen 3 (223A) is not taken; the Pro II frames are frozen');
ok(PRO2_GET.sinf === 10 && PRO2_GET.gsi === 16 && PRO2_GET.total === 32 && PRO2_GET.everyMs === 60, "PR #194's numbers: SINF_READS 10, MAX_READS 16, TOTAL_READS 32, PACKET_DELAY 0.060");

const pat = (s) => s.trim().split(/\s+/).map((t) => ({ hi: t[0] === '?' ? null : parseInt(t[0], 16), lo: t[1] === '?' ? null : parseInt(t[1], 16) }));
const nib = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));
const NEVERS = NEVER.commands.filter((c) => c.bytes && [].concat(c.vid).includes('10F5')).map((c) => ({ ...c, p: pat(c.bytes) }));
ok(NEVERS.some((n) => /nvkey write/.test(n.what)), 'the RACE nvkey write is on DeviceHub\'s never list');

// a simulated transmitter: the GSI JSON, split into 07 reports of up to 58 payload bytes
function transmitter(pid, o = {}) {
  // getOnly: replies are held for GET_REPORT (getInputReport) and never arrive by themselves, as reader.py reads them
  const pro2 = ['229b', '229e'].includes(pid);
  // pro2: answers only GET_REPORT, and a GSI ask outside a session (no SInf first) gets idle frames only (PR #194)
  const s = { kvp: { 240: '85', 250: '1', 230: '1', 220: 'Stealth 700 Gen 3', '2c0': '2' }, answer: true, noise: true, getOnly: pro2, dumpLevel: false, ...o };
  let session = false;
  let queue = [], held = [];
  const rep = (payload) => { const d = new Uint8Array(61); d[0] = payload.length & 0xff; d[1] = payload.length >> 8; d.set(payload, 2); return { reportId: 0x07, data: new DataView(d.buffer) }; };
  return {
    vendorId: 0x10f5, productId: parseInt(pid, 16), opened: true, sent: [], bad: [], gets: [], log: [], s, clock: 0,
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(`${id}: ${h(p)}`); this.log.push('send');
      if (id !== 0x06 || p.length !== 61) this.bad.push(`report ${id}, ${p.length} bytes`);
      const pad = (f) => { const u = new Uint8Array(61); u.set(f); return h(u); };
      const allowed = pro2 ? [PRO2_FRAMES.sinf, PRO2_FRAMES.gsi] : [FRAMES.enable, FRAMES.gsi];
      if (!allowed.some((f) => h(p) === pad(f))) this.bad.push(`not one of this model's frames: ${h(p.slice(0, 12))}`);
      for (const n of NEVERS) if ((n.reportId == null || n.reportId === id) && n.p.every((q, i) => nib(q, p[i] ?? 0))) this.bad.push(`never: ${n.what}`);
      if (!s.answer) return;
      const out = s.getOnly ? held : queue;
      if (pro2) {
        const idle = () => out.push(rep([]));
        if (h(p) === pad(PRO2_FRAMES.sinf)) {   // the state dump: an info document, maybe a pushed GSI update, envelopes between
          session = true;
          const dump = [0x05, 0x5b, 0x40, 0x00, 0x02, 0x99, 0x61, 0x00, 0x62, 0x32, 0x00, 0x21, 0x01, 0xff, ...Buffer.from('{"OR":"SInf","KVP":{"100":"1.2.3","110":{"a":"}"}}}')];
          for (let i = 0; i < dump.length; i += 58) out.push(rep(dump.slice(i, i + 58)));
          out.push(rep([0x05, 0x5d, 0x02, 0x00, 0x00, 0x00, 0xff, ...Buffer.from(JSON.stringify({ UP: 'GSI', KVP: s.dumpLevel ? { 240: s.kvp[240] } : { 290: '2' } }))]));
          return;
        }
        if (!session) { for (let i = 0; i < 3; i++) idle(); return; }
        const body = [0x05, 0x5b, 0x40, 0x00, 0x02, 0x99, 0x61, 0x14, 0x62, 0x32, 0x04, 0x21, 0x01, 0xff, ...Buffer.from(JSON.stringify({ OR: 'GSI', KVP: s.kvp }))];
        for (let i = 0; i < body.length; i += 58) out.push(rep(body.slice(i, i + 58)));
        return;
      }
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
  ok(!(await make([transmitter('223a')]).d.connect()), 'the Stealth 600 Gen 3 (223A, no battery read documented) is not taken');
}

// 3a. Stealth Pro II (229B transmitter, 229E headset on its cable): SInf opener, then the GSI ask, replies by GET_REPORT
for (const pid of ['229b', '229e']) {
  const t = transmitter(pid, { kvp: { 240: '86', 250: '0', 230: '2', 220: 'My Headset', 280: '1' } });
  const { d, app, tick } = make([t]);
  ok(await d.connect(), `Stealth Pro II (${pid}) connects`);
  const b = await d.battery();
  ok(b && b.percent === 86 && b.charging === false, `${pid}: battery 86%, not charging (${JSON.stringify(b)})`);
  ok(t.sent.length === 2 && t.bad.length === 0 && t.log[0] === 'send', `${pid}: the SInf opener, then the GSI ask, nothing else (${t.sent.join(' | ').slice(0, 60)}; ${t.bad.join('; ')})`);
  ok(t.gets.length <= PRO2_GET.total && t.gets.every((g) => g === '7:61'), `${pid}: GET_REPORT on report 07 only, within the 32-read cap (${t.gets.length})`);
  ok(t.log.slice(1, 1 + PRO2_GET.sinf).every((x) => x === 'get') && t.log[1 + PRO2_GET.sinf] === 'send', `${pid}: ${PRO2_GET.sinf} gets after the opener, then the GSI ask`);
  const i = await d.info();
  ok(i.Model === `Turtle Beach ${pid === '229b' ? 'Stealth Pro II transmitter' : 'Stealth Pro II (on its USB cable)'}` && i['Headset name'] === 'My Headset' && i.Charging === 'no' && /^10F5:229[BE] \(not yet seen working\)$/.test(i['Product id']), `${pid}: info (${JSON.stringify(i)})`);
  t.s.kvp = { 240: '97', 250: '1', 230: '0' }; tick(6000);
  const b2 = await d.battery();
  ok(b2 && b2.percent === 97 && b2.charging === true, `${pid}: on the cable, 97% charging (230 is a transport enum there, not "linked") (${JSON.stringify(b2)})`);
  for (const k of ['sidetone', 'nvkey']) ok(!(await attempt(() => d.write(k, 1))).ok, `${pid}: refuses writing ${k}`);
  app.name = 'SwarmII.exe'; tick(20000);
  const n = t.sent.length;
  ok(!(await attempt(() => d.battery())).ok && t.sent.length === n, `${pid}: refuses to read while Swarm II runs, nothing sent`);
  ok(t.bad.length === 0, `${pid}: only the capture's two frames, nothing on a never list (${t.bad.join('; ')})`);
}
{
  // the opener's dump already carries the level: the GSI ask is not sent
  const t = transmitter('229b', { dumpLevel: true });
  const { d } = make([t]); await d.connect();
  ok((await d.battery())?.percent === 85 && t.sent.length === 1, `Pro II: a level in the opener's dump needs no GSI ask (${t.sent.length} sent)`);
  // silent transmitter: two asks, 26 gets (10 + 16), then a plain error; never the inferred third ask
  const q = transmitter('229b', { answer: false });
  const m = make([q]); await m.d.connect();
  const r = await attempt(() => m.d.battery());
  ok(!r.ok && /no GSI record/.test(r.e) && q.sent.length === 2 && q.gets.length === PRO2_GET.sinf + PRO2_GET.gsi && q.bad.length === 0, `Pro II silent: ${q.sent.length} asks, ${q.gets.length} gets, no inferred third ask (${r.e})`);
  // a channel without getInputReport: replies read as they arrive
  const a = transmitter('229e', { getOnly: false }); delete a.getInputReport;
  const am = make([a]); await am.d.connect();
  ok((await am.d.battery())?.percent === 85 && a.sent.length === 2 && a.bad.length === 0, `Pro II without getInputReport: read as replies arrive (${a.sent.length} sent; ${a.bad.join('; ')})`);
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
  ok(sp.length === 5 && sp.every((x) => x.inputReports === true && channelOpts(x) === ':rw=1:gi=1'), `each transmitter channel is raw with input reports (${sp.map(channelOpts)})`);
}

// 4. reassembly: first { to last }, other report ids ignored
{
  const mk = (id, text) => { const d = new Uint8Array(61); const b = Buffer.from(text); d[0] = b.length; d.set(b, 2); return { reportId: id, data: new DataView(d.buffer) }; };
  ok(gsiFrom([mk(7, 'xx{"OR":"GSI","KV'), mk(9, 'junk}'), mk(7, 'P":{"240":"77"}}yy')])?.KVP?.['240'] === '77', 'the JSON is joined across reports, other ids ignored');
  ok(gsiFrom([mk(7, '{"OR":"GSI"')]) === null && gsiFrom([mk(7, '{"OR":"GSI"}')]) === null, 'a cut or KVP-less record is not believed');
  // several documents with envelopes between: GSI ones merged in order, others skipped; an update alone needs key 240
  const env = (id, text) => { const b = Buffer.concat([Buffer.from([0x05, 0x5b, 0x01, 0xff]), Buffer.from(text)]); const d = new Uint8Array(61); d[0] = b.length; d.set(b, 2); return { reportId: id, data: new DataView(d.buffer) }; };
  const m = gsiFrom([env(7, '{"OR":"SInf","KVP":{"240":"1"}}'), env(7, '{"OR":"GSI","KVP":{"240":"50","250":"0"}}'), env(7, '{"UP":"GSI","KVP":{"250":"1"}}')]);
  ok(m?.KVP?.['240'] === '50' && m.KVP['250'] === '1', `GSI documents merged, others skipped (${JSON.stringify(m)})`);
  ok(gsiFrom([env(7, '{"UP":"GSI","KVP":{"290":"2"}}')]) === null && gsiFrom([env(7, '{"UP":"GSI","KVP":{"240":"9"}}')])?.KVP['240'] === '9', 'a pushed update alone counts only with the battery key');
}

console.log(fails ? `sim-turtle-beach-battery: ${fails} FAILED` : 'sim-turtle-beach-battery (Stealth 700 Gen 3 and Stealth Pro II battery over Airoha RACE, read only): all good');
process.exitCode = fails ? 1 : 0;
