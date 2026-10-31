// Monitor changes made while a monitor is off (21 Oct 2026), with a stand-in for the native helper: no monitors
// touched. Checks a change made while it does not answer waits (shown as made, saved, not written), a drag step is not
// kept, a direct change later replaces a waiting one, and the waiting change is written (and backed up) once it answers.
// Run: node tests/waiting-monitors.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-monwait-'));
process.env.DEVICEHUB_DATA_DIR = dir;
const backups = path.join(dir, 'backups'); fs.mkdirSync(backups);
const monitors = require('../helpers/monitors.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the stand-in monitor: brightness 0x10 (max 100); on = it answers over DDC/CI
let on = true, brightness = 50;
// 31 Oct 2026: refuse = on and answering but refusing writes; writeTimeout = reads answer, writes time out; twin = a
// second monitor of the same model
let refuse = false, writeTimeout = false, twin = false;
const sets = [];
const CAPS = '(prot(monitor)type(lcd)model(VG272UV)cmds(01 02 03)vcp(10 12 62))';
const native = { async request(chan, q) {
  q = JSON.parse(q);
  const one = (id, screen) => ({ id, screen, name: 'Generic', ddc: on, caps: q.caps ? CAPS : undefined, values: on ? { 10: { cur: brightness, max: 100 }, 12: { cur: 50, max: 100 } } : {} });
  if (q.op === 'monitors') return JSON.stringify({ ok: true, monitors: [one('MON1', '\\\\.\\DISPLAY2'), ...(twin ? [one('MON2', '\\\\.\\DISPLAY3')] : [])] });
  if (q.op === 'monitor-set') {
    if (writeTimeout) return 'TIMEOUT';
    if (!on || refuse) return JSON.stringify({ ok: false, error: 'the monitor refused it' });
    sets.push([q.code, q.value, !!q.live]); if (q.code === 0x10) brightness = q.value;
    return JSON.stringify({ ok: true, cur: q.value, max: 100 });
  }
  return JSON.stringify({ ok: false, error: 'unknown' });
} };
const applied = [];
monitors.start(native, backups, (text) => applied.push(text));

// seen once while on
let list = await monitors.list(true);
check(list[0].ddc && list[0].brightness.value === 50, `read while on: ${JSON.stringify(list[0].brightness)}`);
// switched off: still listed with its last settings
on = false;
list = await monitors.list(true);
check(list[0].away && list[0].brightness?.value === 50, `off: kept with its last settings (${JSON.stringify(list[0])})`);
// a change while off waits; a drag step is not kept
const r = await monitors.set('MON1', 'brightness', 70);
const live = await monitors.set('MON1', 'brightness', 20, { live: true });
check(r.waiting === true && live.live === true, `the change waits (${JSON.stringify(r)})`);
check(sets.length === 0, 'nothing sent while it is off');
const savedFile = path.join(dir, 'waiting-monitors.json');
check(JSON.parse(fs.readFileSync(savedFile, 'utf8')).MON1?.brightness === 70, 'saved to the file');
list = await monitors.list(false);
check(list[0].brightness.value === 70 && list[0].waiting?.includes('brightness'), `shown as made: ${JSON.stringify(list[0].brightness)} ${list[0].waiting}`);
const b0 = fs.readdirSync(backups).length;
// back on: the waiting change is written the normal way
on = true;
await monitors.list(true);
for (let i = 0; i < 20 && sets.length === 0; i++) await sleep(50);
await sleep(100);
check(brightness === 70 && sets.some(([c, v, l]) => c === 0x10 && v === 70 && !l), `written once it answers: ${JSON.stringify(sets)}`);
check(fs.readdirSync(backups).length === b0 + 1, 'backed up first');
check(!JSON.parse(fs.readFileSync(savedFile, 'utf8')).MON1, 'nothing left waiting');
check(applied.some((t) => /brightness → 70 \(made while it was off\)/.test(t)), `logged: ${applied.join(' | ')}`);
// a waiting change is replaced by a direct one made once it is on
on = false; await monitors.list(true);
await monitors.set('MON1', 'brightness', 30);
on = true; await monitors.list(true); await sleep(200);
await monitors.set('MON1', 'brightness', 60);
await sleep(100);
check(brightness === 60, `the direct change wins (${brightness})`);

// 31 Oct 2026: a monitor that is on and answering but refuses a value: told so at once, nothing waits
refuse = true;
const refused = await monitors.set('MON1', 'brightness', 40).then((x) => ({ ok: x }), (e) => ({ error: e.message }));
check(refused.error && /refused that change/.test(refused.error), `a refusal from a monitor that answers is a refusal (${JSON.stringify(refused)})`);
check(!JSON.parse(fs.readFileSync(savedFile, 'utf8')).MON1, 'the refused change is not left waiting');
refuse = false;

// a waiting change whose writes keep failing while the monitor answers: tried 5 times in all, one backup, then told
on = false; await monitors.list(true);
await monitors.set('MON1', 'brightness', 45);
on = true; writeTimeout = true;
const b1 = fs.readdirSync(backups).length;
applied.length = 0;
// each try as if a minute apart (past the 15 s a slider's steps share one backup)
for (let i = 0; i < 8; i++) { monitors._test.forgetBackupTimes(); await monitors.list(true); await sleep(60); }
check(fs.readdirSync(backups).length === b1 + 1, `one backup for all the tries (${fs.readdirSync(backups).length - b1})`);
check(!JSON.parse(fs.readFileSync(savedFile, 'utf8')).MON1, 'after 5 tries the change no longer waits');
check(applied.some((t) => /not changed: .*tried 5 times/.test(t)), `the person is told (${applied.join(' | ')})`);
writeTimeout = false;

// two monitors of the same model: each name carries its screen number
twin = true;
const two = await monitors.list(true);
check(two.length === 2 && two[0].name !== two[1].name && /\(screen 2\)$/.test(two[0].name) && /\(screen 3\)$/.test(two[1].name), `same-model monitors get their screen number (${two.map((m) => m.name).join(', ')})`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails.length ? `waiting monitor changes: FAILED: ${fails.join('; ')}` : 'waiting monitor changes (stand-in monitor): all good');
process.exit(fails.length ? 1 : 0);
