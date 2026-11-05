// Learn a device, proven on a real device with a known answer (2 Nov 2026, Shawn: "Yes, start step 1"). A developer's
// tool, never run by DeviceHub and not in npm test: it records the Pulsar X-Lite while the Pulsar app changes a setting,
// runs the wizard's own analysis (helpers/learn-wizard.mjs analyze, withRange, buildDriver, verifySeen) on the
// recordings, and compares what was learned with public/devices/pulsar.js, which already drives this mouse.
//
// READ-ONLY toward every device: it only starts the wizard's listener (helpers/learn-capture.ps1, USBPcapCMD) through
// Windows' admin prompt and reads its files. Nothing here opens the mouse or sends it a byte; the learned driver is
// written to the session folder only (never my-devices\, so DeviceHub never loads it).
//
//   node helpers/learn-proof.mjs listen                       starts the listener (one admin prompt), prints the folder
//   node helpers/learn-proof.mjs take <setting> <value> [s]   records s seconds (default 8) while the app changes it;
//                                                             reads the recording WHILE it is written and says when the
//                                                             mouse's first message shows up
//   node helpers/learn-proof.mjs analyze                      learns every setting with 2+ takes and compares
//   node helpers/learn-proof.mjs quit                         stops the listener
// <setting> is a mouse-adapter SETTINGS key (debounce, pollingRate, liftOff, motionSync, angleSnap, ...).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deps, takeMessages, analyze, withRange, buildDriver, verifySeen, hexOf, codeFor } from './learn-wizard.mjs';
import { fromJson } from './declarative-driver.mjs';
import { SETTINGS } from '../public/devices/mouse-adapter.js';
import { PulsarMouse, LIFT_OFF } from '../public/devices/pulsar.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VID = '3710', PID = '5406';               // the Pulsar 8K dongle; report 8 on page 0xFF02 (pulsar.js)
const IDS = { vid: VID, pid: PID, idsOut: true, idsIn: true };
const WRITE_FLASH = 0x07;
const BASE = path.join(ROOT, 'learn', 'wizard');
const POINTER = path.join(ROOT, 'learn', 'proof-current.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// how the wizard would be told about each setting: its kind, and the value as the person would enter it
const KIND = { motionSync: 'toggle', angleSnap: 'toggle', ripple: 'toggle', turbo: 'toggle', liftOff: 'choice', pollingRate: 'choice' };
const kindOf = (key) => KIND[key] || 'number';
function valueOf(key, text) {
  if (kindOf(key) === 'toggle') return /^(on|1|true|yes)$/i.test(text);
  return kindOf(key) === 'choice' ? String(text) : Number(text);
}
// the answer key: the byte pulsar.js stores for a value
function encOf(key, value) {
  const s = SETTINGS[key];
  if (key === 'liftOff') { const code = Number(Object.keys(LIFT_OFF).find((k) => LIFT_OFF[k].toLowerCase() === String(value).toLowerCase())); return s.enc(code); }
  if (key === 'pollingRate') return s.enc(Number(value));
  return s.enc(value);
}
const expectedWrite = (key, value) => { const b = encOf(key, value); return new PulsarMouse({}).packet(WRITE_FLASH, { addr: SETTINGS[key].addr, len: 2, data: [b, (0x55 - b) & 0xff] }); };

const dirNow = () => { const d = fs.existsSync(POINTER) ? fs.readFileSync(POINTER, 'utf8').trim() : ''; if (!d || !fs.existsSync(d)) throw new Error('No listener session: run "listen" first.'); return d; };
const takesFile = (dir) => path.join(dir, 'takes.json');
const readTakes = (dir) => { try { return JSON.parse(fs.readFileSync(takesFile(dir), 'utf8')); } catch { return []; } };

async function listen() {
  const dir = path.join(BASE, `proof-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).toLowerCase()}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log('Windows asks for permission once (USBPcap needs administrator rights)...');
  const r = await deps.startCapture(dir);
  if (!r.started) { console.log('Listener not started:', r.error || (r.declined ? 'declined' : 'unknown')); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); }
  for (let t = 0; t < 15000; t += 200) { const s = deps.readState(dir); if (s?.status === 'ready') { fs.writeFileSync(POINTER, dir); console.log(`Listening on ${s.hubs} USB hubs. Session: ${dir}`); return; } if (s?.status === 'error') { console.log('Listener error:', s.error); process.exit(1); } await sleep(200); }
  console.log('The listener did not say ready within 15 s.'); process.exit(1);
}

let seq = 0;
async function command(dir, text, want) {
  seq = (deps.readState(dir)?.seq || 0) + 1;
  deps.writeCommand(dir, `${seq} ${text}`);
  for (let t = 0; t < 10000; t += 100) { const s = deps.readState(dir); if (s?.seq === seq && want.includes(s.status)) return s; await sleep(100); }
  throw new Error(`the listener did not answer "${text}"`);
}

async function take(key, text, seconds = 8) {
  if (!SETTINGS[key]) throw new Error(`unknown setting ${key}; one of ${Object.keys(SETTINGS).join(', ')}`);
  const dir = dirNow();
  const takes = readTakes(dir);
  const name = `${key.toLowerCase()}-${String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')}-${takes.length + 1}`.slice(0, 40);
  await command(dir, `start ${name}`, ['recording']);
  console.log(`Recording ${name} for ${seconds} s: change ${SETTINGS[key].label} to ${text} in the Pulsar app now.`);
  // the never-tried part: read the recording while USBPcapCMD is still writing it
  const t0 = Date.now();
  let firstAt = null, liveErr = null, liveOut = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(300);
    try {
      const m = takeMessages(deps.readTake(dir, name), IDS);
      liveOut = m.messages.filter((x) => x.dir === 'out').length;
      if (firstAt == null && m.messages.some((x) => x.dir === 'out' && x.data[0] === WRITE_FLASH)) { firstAt = Date.now() - t0; console.log(`  live: a flash write from the app seen ${firstAt} ms in (${liveOut} messages out so far)`); }
    } catch (e) { liveErr = e.message; }
  }
  const st = await command(dir, 'stop', ['stopped']);
  const after = takeMessages(deps.readTake(dir, name), IDS);
  const outs = after.messages.filter((x) => x.dir === 'out');
  console.log(`  stopped: ${st.files?.length || 0} files, mouse found: ${after.found}, ${outs.length} messages out, ${after.messages.length - outs.length} in`);
  if (liveErr) console.log(`  live read error: ${liveErr}`);
  if (firstAt == null) console.log('  live: no flash write seen while recording');
  takes.push({ key, text, name, liveMs: firstAt, liveErr });
  fs.writeFileSync(takesFile(dir), JSON.stringify(takes, null, 1));
}

function compare(key, learned, def) {
  const lines = [];
  const drv = fromJson(def);
  const st = def.settings.find((s) => s.key === learned.key);
  const e = learned.write.enc;
  lines.push(`  learned: write ${hexOf(learned.writeBytes || [])}, value at byte ${e.offset} (${e.size} byte${e.size > 1 ? 's' : ''}${e.codes ? `, codes ${e.codes.join('/')}` : `, x${e.scale} +${e.add}`})`);
  // every recorded value, and (numbers) the values in between, against what pulsar.js sends
  const vals = learned.kind === 'number' ? [...new Set([...learned.values, ...Array.from({ length: Math.min(16, (learned.max - learned.min) / learned.step + 1) }, (_, i) => learned.min + i * learned.step)])] : learned.values;
  let ok = 0;
  for (const v of vals) {
    let got;
    try { got = drv.build(st.write.message, { value: codeFor(learned, v) }).data; } catch (err) { lines.push(`  ${v}: cannot build (${err.message})`); continue; }
    const want = expectedWrite(key, v);
    const same = hexOf([...got].slice(0, 16)) === hexOf([...want]);
    if (same) ok++; else lines.push(`  ${v}: learned sends ${hexOf([...got].slice(0, 16))}\n     pulsar.js sends ${hexOf([...want])}`);
  }
  lines.push(`  ${ok} of ${vals.length} values build the same bytes as pulsar.js`);
  return lines;
}

function analyzeAll() {
  const dir = dirNow();
  const takes = readTakes(dir);
  const byKey = new Map();
  for (const t of takes) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push(t); }
  const learnedAll = [];
  const report = [`# Learn a device on the real Pulsar (${new Date().toISOString().slice(0, 10)})`, `session ${dir}`, ''];
  report.push(`live read while recording: ${takes.filter((t) => t.liveMs != null).length} of ${takes.length} takes saw the write while it was being recorded`);
  for (const [key, ts] of byKey) {
    report.push('', `## ${SETTINGS[key].label} (${key}): ${ts.map((t) => t.text).join(', ')}`);
    const wiz = ts.map((t) => ({ value: valueOf(key, t.text), messages: takeMessages(deps.readTake(dir, t.name), IDS).messages }));
    const r = analyze(wiz, { label: SETTINGS[key].label, kind: kindOf(key) });
    if (!r.ok) { report.push('  NOT LEARNED:', ...r.why.map((w) => `    ${w}`)); continue; }
    const wr = withRange(r.learned, {}, learnedAll.map((s) => s.key));
    if (!wr.setting) { report.push(`  range refused: ${wr.why}`); continue; }
    let def;
    try { def = buildDriver({ vid: VID, pid: PID, product: 'Pulsar X-Lite (proof)', title: 'Pulsar proof', kind: 'Mouse', usagePage: 0xff02, usage: 1, settings: [wr.setting] }); }
    catch (e) { report.push(`  learned, but no driver: ${e.message}`); continue; }
    const seen = verifySeen(def, [wr.setting]);
    if (seen.length) report.push('  rebuild check:', ...seen.map((p) => `    ${p}`));
    report.push(...compare(key, wr.setting, def));
    const read = wr.setting.read;
    if (read) report.push(`  read: ${hexOf(read.data || [])} (pulsar.js reads flash with 08 at address ${SETTINGS[key].addr})`);
    learnedAll.push(wr.setting);
  }
  if (learnedAll.length) {
    try { const def = buildDriver({ vid: VID, pid: PID, product: 'Pulsar X-Lite (proof)', title: 'Pulsar proof', kind: 'Mouse', usagePage: 0xff02, usage: 1, settings: learnedAll }); fs.writeFileSync(path.join(dir, 'driver.json'), JSON.stringify(def, null, 1)); report.push('', `all learned settings together: driver.json written to the session folder (${learnedAll.length} settings)`); }
    catch (e) { report.push('', `all learned settings together: refused (${e.message})`); }
  }
  const text = report.join('\n');
  fs.writeFileSync(path.join(dir, 'report.md'), text);
  console.log(text);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'listen') await listen();
  else if (cmd === 'take') await take(args[0], args[1], Number(args[2]) || 8);
  else if (cmd === 'analyze') analyzeAll();
  else if (cmd === 'quit') { await command(dirNow(), 'quit', ['ended', 'stopped', 'ready', 'error']).catch(() => {}); console.log('listener told to quit'); }
  else console.log('node helpers/learn-proof.mjs listen | take <setting> <value> [seconds] | analyze | quit');
} catch (e) { console.log(`error: ${e.message}`); process.exit(1); }
