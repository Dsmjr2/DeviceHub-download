// The Corsair Bragi headset library driver (device-library/corsair-bragi-headset) against simulated headsets, one per
// model, behind a stand-in for the native helper's hs80 channel that builds and answers the exact 64-byte reports
// helpers/native/hs80io.cs does (GET: 02 <ep> 02 <id lo> <id hi>; SET: 02 <ep> 01 <id> 00 <value LE>; reply 01 <who>
// <cmd> <status> <value LE>; its SET whitelist, and its "GONE" on a refused SET). Touches no device.
// Run: node tests/sim-corsair.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, MODELS, ALL_PIDS, HS80_OWN_PIDS, HELPER_SETS, P } from '../device-library/corsair-bragi-headset/device.mjs';
import real from '../device-library/corsair-bragi-headset/device.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const hx = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const le4 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const model = (key) => MODELS.find((m) => m.key === key);

// ---- a simulated headset: a property table; unknown ids answer status 05 (sheet section 2: "05 = not supported") ----
function headset(m, { props = {}, writable = [P.sleep, P.sleepOn, P.sidetoneOff, P.sidetoneLevel], asleep = false, clamp = null } = {}) {
  const base = { [P.battery]: 735, [P.chargeStatus]: 1, [P.firmware]: 2 | (13 << 8) | (85 << 16), [P.connection]: 2, [P.voltage]: 3900,
    [P.lightMode]: 1, [P.sleep]: 600000, ...(m.mic != null ? { [m.mic]: 0 } : {}) };
  return { m, props: { ...base, ...props }, writable, asleep, clamp,
    // one output report in, one input report out (or null: no reply)
    answer(o, ep) {
      if (this.asleep || o[0] !== 2 || o[1] !== ep) return null;
      const who = ep === 9 ? 1 : 0, cmd = o[2], r = new Uint8Array(64);
      r[0] = 1; r[1] = who; r[2] = cmd;
      if (cmd === 2) {
        const id = o[3] | (o[4] << 8);
        if (!(id in this.props)) { r[3] = 5; return r; }
        r.set(le4(this.props[id]), 4); return r;
      }
      if (cmd === 1) {
        const id = o[3] | (o[4] << 8), v = o[5] | (o[6] << 8) | (o[7] << 16) | (o[8] << 24);
        if (!this.writable.includes(id) || !(id in this.props)) { r[3] = 5; return r; }
        this.props[id] = this.clamp ? this.clamp(id, v) : v; return r;
      }
      r[3] = 5; return r;
    } };
}

// ---- the native helper's channels, as helper.cs HandleHs80 + hs80io.cs Hs80Io run them ----
const HS80IO_SET = (id, v) => (id === 0x02 && v >= 0 && v <= 1000) || (id === 0x03 && (v === 1 || v === 2)) || (id === 0x0e && v >= 60000 && v <= 7200000);
function helper(plugged /* { pid: headset } */, { extraName = {}, sets = HS80IO_SET } = {}) {
  const log = [], out = [], events = new Map(), open = new Set();
  const names = { '0A6B': 'CORSAIR HS80 RGB Wireless Gaming Receiver', ...extraName };
  return { log, out, events, open, plugged,
    emit(chan, id, v) { events.get(chan)?.(id, v); },
    onEvent(chan, fn) { if (fn) events.set(chan, fn); else events.delete(chan); },
    async request(chan, cmd) {
      log.push(`${chan} ${cmd}`);
      if (chan === 'hidlist') return [...Object.keys(plugged).map((p) => `1B1C ${p} ${names[p] || plugged[p]?.m?.name || ''}`), '046D C547 USB Receiver'].join('|');
      const [kind, pid, epS] = chan.split(':'), ep = Number(epS), w = cmd.split(' ');
      if (kind !== 'hs80') return 'ERR unknown channel';
      if (w[0] === 'OPEN') { if (!plugged[pid]) return 'NODEVICE'; open.add(chan); return 'OK'; }
      if (w[0] === 'CLOSE') { open.delete(chan); return 'OK'; }
      const dev = plugged[pid];
      if (!open.has(chan) || !dev) { open.delete(chan); return 'GONE'; }
      const send = (o) => {
        out.push({ pid, bytes: o });
        const r = dev.answer(o, ep);
        // Hs80Io's reader: report 01, from the expected side, a set/get/light/open reply
        return r && r[0] === 1 && r[1] === (ep === 9 ? 1 : 0) && [1, 2, 6, 0x0d].includes(r[2]) ? r : null;
      };
      if (w[0] === 'GET') {
        const id = parseInt(w[1], 16), o = new Uint8Array(64);
        o[0] = 2; o[1] = ep; o[2] = 2; o[3] = id & 0xff; o[4] = id >> 8;
        const r = send(o);
        return r ? hx(r.slice(3, 9)) : 'NONE';
      }
      if (w[0] === 'SET') {
        const id = parseInt(w[1], 16), v = parseInt(w[2], 10);
        // ArgumentException in Hs80Io.Set -> helper.cs Work drops the handle and answers GONE
        if (!sets(id, v)) { open.delete(chan); log.push('REFUSED-BY-HELPER'); return 'GONE'; }
        const o = new Uint8Array(64);
        o[0] = 2; o[1] = ep; o[2] = 1; o[3] = id; o[4] = 0; o.set(le4(v), 5);
        const r = send(o);
        return r ? r[3].toString(16).padStart(2, '0') : 'NONE';
      }
      return 'ERR unknown command';
    } };
}
const sent = (hp, from = 0) => hp.out.slice(from).map((x) => hx(x.bytes.slice(0, 9)));
const OLD = { 0x02: [0, 1000], 0x03: [1, 2], 0x0e: [60000, 7200000] };  // the helper before 22 Oct 2026
const FUTURE = { ...OLD, 0x0d: [0, 1], 0x46: [0, 1], 0x47: [0, 1000] };  // the helper since then
check(JSON.stringify(HELPER_SETS) === JSON.stringify(FUTURE), 'the driver offers what today\'s helper sends (0d, 46, 47 included)');
const FUTURE_SET = (id, v) => HS80IO_SET(id, v) || (id === 0x0d && (v === 0 || v === 1)) || (id === 0x46 && (v === 0 || v === 1)) || (id === 0x47 && v >= 0 && v <= 1000);
const mk = (hp, o = {}) => createDriver({ transport: hp, icueRunning: async () => false, helperSets: OLD, ...o });  // older helper unless a test says
const throwsMsg = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ---- the table and the entry ----
check(!ALL_PIDS.some((p) => HS80_OWN_PIDS.includes(p)), 'no HS80 RGB Wireless id (0A69, 0A6B, 0A71) in the table');
check(new Set(ALL_PIDS).size === ALL_PIDS.length, 'every product id is in the table once');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library', 'corsair-bragi-headset', 'device.json'), 'utf8'));
check(JSON.stringify([...meta.pids].sort()) === JSON.stringify(ALL_PIDS.map((p) => p.toLowerCase()).sort()), `device.json pids are the table's (${meta.pids})`);
check(meta.vid === '1b1c' && meta.status === 'read-only' && meta.source === 'docs/brands/corsair.md' && meta.id === real.id, 'device.json: vid, status read-only, source, id');
check(meta.models.length === MODELS.length, 'device.json lists every model');
check(!validateMeta(meta), `device.json passes the library's check (${validateMeta(meta)})`);
check(!problem(real), `the driver passes the my-devices check (${problem(real)})`);
for (const [k, mic] of [['hs80-max', 0xa6], ['void-v2', 0xa6], ['virtuoso-xt', 0x8e]]) check(model(k).mic === mic, `${k}: mic property ${mic.toString(16)} (sheet section 3)`);

// ---- every model on its receiver: reads, request bytes, one write with read-back and restore ----
for (const m of MODELS) {
  const pid = m.receivers[0], dev = headset(m), hp = helper({ [pid]: dev, '0A6B': headset(m) });
  const d = mk(hp);
  check(await d.connect() === true, `${m.key}: connects on its receiver ${pid}`);
  check(!hp.log.some((l) => /^hs80:0A6B/.test(l)), `${m.key}: never opens the HS80's receiver beside it`);
  check(d.model === m && d.connection === 'receiver', `${m.key}: identified as ${d.model?.key} over ${d.connection}`);
  const v = await d.read();
  check(sent(hp)[0] === '02 09 02 0f 00 00 00 00 00', `${m.key}: battery asked first as 02 09 02 0f 00 (${sent(hp)[0]})`);
  check(v.sleepTimer === 10, `${m.key}: sleep timer 600000 ms reads 10 min (${v.sleepTimer})`);
  if (m.mic != null) {
    check(sent(hp).includes(`02 09 02 ${m.mic.toString(16)} 00 00 00 00 00`), `${m.key}: mic asked on ${m.mic.toString(16)}`);
    check(v.micMuted === false, `${m.key}: mic reads live`);
  } else check(!('micMuted' in v), `${m.key}: no mic property in the sheet, no mic value`);
  const otherMic = m.mic === 0x8e ? 'a6' : '8e';
  check(!sent(hp).some((s) => s.startsWith(`02 09 02 ${otherMic} `)), `${m.key}: never asks the other model's mic property ${otherMic}`);
  const b = await d.battery();
  check(b.percent === 74 && b.charging === false, `${m.key}: battery 735 -> 74%, not charging at a resting 3900 mV (${JSON.stringify(b)})`);
  dev.props[P.voltage] = 4180;
  await d.read();
  check((await d.battery()).charging === true, `${m.key}: a charger's lifted voltage reads charging`);
  const info = await d.info();
  check(info.Firmware === '2.13.85' && info.Model === m.name && info['USB id'] === `1b1c:${pid.toLowerCase()}`, `${m.key}: info ${JSON.stringify(info)}`);

  // a helper older than 22 Oct 2026: only the sleep timer; nothing it cannot send is offered, or even asked for
  check(JSON.stringify(d.settings.map((s) => s.key)) === '["sleepTimer"]', `${m.key}: with an older helper the settings are the sleep timer only (${d.settings.map((s) => s.key)})`);
  check(!sent(hp).some((s) => /^02 09 02 (0d|46|47) /.test(s)), `${m.key}: 0d / 46 / 47 never asked while the helper cannot set them`);
  check(d.settings.find((s) => s.key === 'sleepTimer').max === m.sleepMax, `${m.key}: sleep slider 1-${m.sleepMax}`);

  // the write rule: value read just before, a different one, read back, the original put back, read back
  const before = (await d.read()).sleepTimer, mark = hp.out.length;
  check(await d.write('sleepTimer', 25) === 25, `${m.key}: sleep timer ${before} -> 25 reads back`);
  check(sent(hp, mark)[0] === `02 09 01 0e 00 ${hx(le4(1500000))}`, `${m.key}: SET bytes 02 09 01 0e 00 <1500000 LE> (${sent(hp, mark)[0]})`);
  check(sent(hp, mark)[1] === '02 09 02 0e 00 00 00 00 00', `${m.key}: the write is read back with a GET 0e`);
  check((await d.read()).sleepTimer === 25 && dev.props[P.sleep] === 1500000, `${m.key}: a fresh read shows 25`);
  check(await d.write('sleepTimer', before) === before && dev.props[P.sleep] === 600000, `${m.key}: the original ${before} put back and read back`);
  const n = hp.out.length;
  for (const [k, val] of [['sleepTimer', 0], ['sleepTimer', m.sleepMax + 1], ['sleepTimer', 2.5], ['sidetone', 50], ['sleepOn', true], ['lightMode', 2], ['brightness', 50]]) {
    const e = await throwsMsg(() => d.write(k, val));
    check(e && !e.gone, `${m.key}: ${k} = ${val} refused (${e?.message})`);
  }
  check(hp.out.length === n, `${m.key}: refused writes send nothing`);
  const raw = await d.rawBackup();
  check(raw.model === m.key && raw.props['0f'].value === 735 && raw.props['10'] && raw.props['36'] && raw.props['03'], `${m.key}: backup holds the safe reads`);
  check(!hp.log.includes('REFUSED-BY-HELPER'), `${m.key}: never sent a SET the helper would refuse`);
  check(hp.log.every((l) => /^hidlist FF42 01$|^hs80:[0-9A-F]{4}:[89]:bragi (OPEN|CLOSE|GET [0-9a-f]{2}|SET 0e \d+)$/.test(l)), `${m.key}: only hidlist, OPEN, CLOSE, GET and SET 0e sent (${hp.log.filter((l) => !/GET|SET 0e|OPEN|hidlist/.test(l))})`);
}

// ---- today's helper (0d, 46, 47 too): optional settings appear only where the model and the headset have them ----
{
  const xt = model('virtuoso-xt'), dev = headset(xt, { props: { [P.sleepOn]: 1, [P.sidetoneOff]: 0, [P.sidetoneLevel]: 300 } });
  const hp = helper({ '0A64': dev }, { sets: FUTURE_SET }), d = mk(hp, { helperSets: FUTURE });
  await d.connect();
  const v = await d.read();
  check(JSON.stringify(d.settings.map((s) => s.key)) === '["sleepTimer","sleepOn","sidetoneOn","sidetone"]', `XT with today's helper: all four settings (${d.settings.map((s) => s.key)})`);
  check(v.sidetone === 30 && v.sidetoneOn === true && v.sleepOn === true, `XT reads sidetone 30%, on (46 = 0), sleep on (${JSON.stringify(v)})`);
  let mark = hp.out.length;
  check(await d.write('sidetone', 40) === 40 && sent(hp, mark)[0] === `02 09 01 47 00 ${hx(le4(400))}`, `XT sidetone 30 -> 40%: SET 47 = 400 (${sent(hp, mark)[0]})`);
  check(await d.write('sidetone', 30) === 30 && dev.props[P.sidetoneLevel] === 300, 'XT sidetone put back to 30%');
  mark = hp.out.length;
  check(await d.write('sidetoneOn', false) === false && sent(hp, mark)[0] === `02 09 01 46 00 ${hx(le4(1))}`, 'XT sidetone off: SET 46 = 1 (0 = on)');
  check(await d.write('sidetoneOn', true) === true && dev.props[P.sidetoneOff] === 0, 'XT sidetone back on');
  // a headset that does not answer 46 / 47 (status 05): those settings stay hidden, 0d shown
  const v2 = model('void-v2'), hp2 = helper({ '2A08': headset(v2, { props: { [P.sleepOn]: 1 } }) }, { sets: FUTURE_SET }), d2 = mk(hp2, { helperSets: FUTURE });
  await d2.connect(); await d2.read();
  check(JSON.stringify(d2.settings.map((s) => s.key)) === '["sleepTimer","sleepOn"]', `Void V2 not answering 46/47: sidetone hidden (${d2.settings.map((s) => s.key)})`);
  check((await throwsMsg(() => d2.write('sidetone', 10)))?.message.match(/not a setting/), 'Void V2: a hidden setting is refused');
  // a model whose row has no sidetone: never asked, never shown, even if the headset would answer
  const se = model('virtuoso-se'), hp3 = helper({ '0A3E': headset(se, { props: { [P.sidetoneLevel]: 500, [P.sleepOn]: 1 } }) }, { sets: FUTURE_SET }), d3 = mk(hp3, { helperSets: FUTURE });
  await d3.connect(); await d3.read();
  check(JSON.stringify(d3.settings.map((s) => s.key)) === '["sleepTimer"]' && !sent(hp3).some((s) => /^02 09 02 (0d|46|47) /.test(s)), 'Virtuoso SE (no sidetone or 0d in its row): only the sleep timer, 0d/46/47 never asked');
}

// ---- today's helper, every model: each new setting written, read back, put back; out of range and iCUE refused ----
for (const m of MODELS) {
  const pid = m.receivers[0];
  const dev = headset(m, { props: { [P.sleepOn]: 1, [P.sidetoneOff]: 0, [P.sidetoneLevel]: 300 } });
  const hp = helper({ [pid]: dev }, { sets: FUTURE_SET });
  let icue = false;
  const d = createDriver({ transport: hp, icueRunning: async () => icue });   // the driver's own HELPER_SETS
  await d.connect();
  const v = await d.read();
  const keys = d.settings.map((s) => s.key);
  const want = ['sleepTimer', ...(m.sleepOn ? ['sleepOn'] : []), ...(m.sidetone ? ['sidetoneOn', 'sidetone'] : [])];
  check(JSON.stringify(keys) === JSON.stringify(want), `${m.key} (today's helper): settings ${keys} = its row's ${want}`);
  if (!m.sleepOn && !m.sidetone) check(!sent(hp).some((s) => /^02 09 02 (0d|46|47) /.test(s)), `${m.key}: 0d / 46 / 47 never asked (not in its row)`);
  // [key, the value read before, a different valid value, property, raw of the different value, out-of-range values]
  const cases = [
    ...(m.sleepOn ? [['sleepOn', true, false, P.sleepOn, 0, [1, 'on', null]]] : []),
    ...(m.sidetone ? [['sidetoneOn', true, false, P.sidetoneOff, 1, [0, 'yes']], ['sidetone', 30, 75, P.sidetoneLevel, 750, [-1, 101, 2.5, '50']]] : []),
  ];
  for (const [key, was, to, id, raw, bad] of cases) {
    check(v[key] === was, `${m.key}: ${key} reads ${was} (${v[key]})`);
    const mark = hp.out.length;
    check(await d.write(key, to) === to, `${m.key}: ${key} ${was} -> ${to} reads back`);
    check(sent(hp, mark)[0] === `02 09 01 ${hx([id])} 00 ${hx(le4(raw))}` && sent(hp, mark)[1] === `02 09 02 ${hx([id])} 00 00 00 00 00`,
      `${m.key}: ${key} sent as SET ${hx([id])} = ${raw}, then a GET (${sent(hp, mark).slice(0, 2)})`);
    check((await d.read())[key] === to, `${m.key}: a fresh read shows ${key} = ${to}`);
    check(await d.write(key, was) === was && (await d.read())[key] === was, `${m.key}: ${key} put back to ${was} and read back`);
    const n = hp.out.length;
    for (const b of bad) { const e = await throwsMsg(() => d.write(key, b)); check(e && !e.gone, `${m.key}: ${key} = ${JSON.stringify(b)} refused (${e?.message})`); }
    icue = true;
    const e = await throwsMsg(() => d.write(key, to));
    check(e && /iCUE/.test(e.message), `${m.key}: ${key} refused while iCUE runs (${e?.message})`);
    icue = false;
    check(hp.out.length === n, `${m.key}: ${key}: refused writes send nothing`);
  }
  check(!hp.log.includes('REFUSED-BY-HELPER'), `${m.key} (today's helper): never sent a SET the helper would refuse`);
  check(hp.log.every((l) => /^hidlist FF42 01$|^hs80:[0-9A-F]{4}:[89]:bragi (OPEN|CLOSE|GET [0-9a-f]{2}|SET (0e|0d|46|47) \d+)$/.test(l)), `${m.key}: only GET and SET 0e / 0d / 46 / 47 sent`);
  const raw = await d.rawBackup();
  if (m.sidetone) check(raw.props['46']?.value === 0 && raw.props['47']?.value === 300, `${m.key}: backup holds sidetone 46 / 47`);
}

// ---- cable, choice of connection, HS80 left alone, asleep, mic notices, read-back mismatch, iCUE, unplug ----
{
  const xt = model('virtuoso-xt');
  const hp = helper({ '0A64': headset(xt), '0A62': headset(xt) }), d = mk(hp);
  await d.connect();
  check(d.connection === 'cable' && hp.log.some((l) => l === 'hs80:0A62:8:bragi OPEN'), 'XT on cable and receiver: the cable (0A62, endpoint 08) wins');
  await d.read();
  check(sent(hp)[0] === '02 08 02 0f 00 00 00 00 00', `on the cable requests go to endpoint 08 (${sent(hp)[0]})`);
  check((await d.battery()).charging === true, 'on its cable it reads charging');

  const only = helper({ '0A6B': headset(model('hs80-max')), '0A69': headset(model('hs80-max')) }), d1 = mk(only);
  check(await d1.connect() === false && !only.log.some((l) => /^hs80:/.test(l)), 'with only an HS80 RGB Wireless plugged in: not found, its channels never opened');
  check(await mk(helper({})).connect() === false, 'nothing plugged in: not found');

  const max = model('hs80-max'), sleepy = headset(max, { asleep: true }), hp2 = helper({ '0A97': sleepy }), d2 = mk(hp2);
  check(await d2.connect() === true, 'an asleep HS80 MAX still connects (its receiver is there)');
  const e = await throwsMsg(() => d2.read());
  check(e && /asleep/.test(e.message) && !e.gone, `asleep: read says so (${e?.message})`);
  check(sent(hp2).length === 1, 'asleep: one question, not the whole list');
  check(await d2.awake() === false, 'asleep: awake() is false');
  sleepy.asleep = false;
  check(await d2.awake() === true, 'woken: awake() is true');
  await d2.read();
  hp2.emit('hs80:0A97:9:bragi', 0xa6, 1);
  check((await d2.info()).Mic === 'muted', 'a mic notice (EVT a6 1) shows at once');
  hp2.emit('hs80:0A97:9:bragi', 0x8e, 0);
  check((await d2.info()).Mic === 'muted', 'another model\'s mic id (8e) is ignored on the HS80 MAX');

  const clampy = headset(max, { clamp: (id, v) => (id === P.sleep ? Math.min(v, 1800000) : v) }), hp3 = helper({ '0A97': clampy }), d3 = mk(hp3);
  await d3.connect(); await d3.read();
  const e3 = await throwsMsg(() => d3.write('sleepTimer', 45));
  check(e3 && /reads 1800000 after setting 2700000/.test(e3.message), `a read-back that differs is reported as failed (${e3?.message})`);

  const hp4 = helper({ '2A08': headset(model('void-v2')) });
  const d4 = createDriver({ transport: hp4, icueRunning: async () => true });
  const e4 = await throwsMsg(() => d4.connect());
  check(e4 && /iCUE/.test(e4.message) && hp4.log.length === 0, 'iCUE running: connect steps back, nothing sent');

  const hp5 = helper({ '2A08': headset(model('void-v2')) }), d5 = mk(hp5);
  await d5.connect(); await d5.read();
  delete hp5.plugged['2A08'];
  const e5 = await throwsMsg(() => d5.read());
  check(e5 && e5.gone, 'receiver unplugged: read reports it gone');
}

console.log(fails.length ? `sim-corsair: FAILED: ${fails.join('; ')}` : `sim-corsair (Corsair Bragi headsets, ${MODELS.length} simulated models): all good`);
process.exit(fails.length ? 1 : 0);
