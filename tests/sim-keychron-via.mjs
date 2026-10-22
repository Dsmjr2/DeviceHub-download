// The Keychron library driver (device-library/keychron-via/driver.json, a driver as data) against simulated Keychron
// boards that answer exactly as docs/brands/keychron.md documents: 32-byte raw HID reports on FF60, replies echoing
// A7 + sub-command with the status in byte 2, FF 00 for an unknown A7 sub-command, FF for an unknown first byte, and
// unasked A3 layer notices. Checks every setting (write, read back, put the original back), the refusals (out of range,
// a write that does not stick, a write that moves its partner value, a Keychron / VIA app running), feature bits
// deciding what is shown, and that nothing outside the sheet's commands or on a never list is ever sent.
// Run: node tests/sim-keychron-via.mjs (no hardware)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDeviceProvider } from '../public/devices/hid.js';
import { fromJson, validate } from '../helpers/declarative-driver.mjs';
import { validateMeta } from '../helpers/device-library.mjs';
import { problem } from '../helpers/my-devices.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'device-library', 'keychron-via');
const def = JSON.parse(fs.readFileSync(path.join(DIR, 'driver.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'device.json'), 'utf8'));
const NEVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'helpers', 'never-commands.json'), 'utf8'));

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

// ---- the file itself ----
ok(validate(def).ok, `driver.json passes DeviceHub's safety check (${validate(def).problems.join('; ')})`);
ok(!validateMeta(meta) && meta.id === def.id && meta.status === 'untested' && Array.isArray(meta.tested) && meta.tested.length === 0, 'device.json: well formed, same id, untested, no test record');
ok(JSON.stringify(meta.pids) === JSON.stringify(def.pids.map((p) => p.toLowerCase())), 'device.json lists the same product ids as driver.json');

// ---- the never lists: DeviceHub's (vendor 3434 or any VIA board) and the file's own ----
const pat = (s) => s.trim().split(/\s+/).map((t) => ({ hi: t[0] === '?' ? null : parseInt(t[0], 16), lo: t[1] === '?' ? null : parseInt(t[1], 16) }));
const nib = (p, b) => (p.hi == null || p.hi === b >> 4) && (p.lo == null || p.lo === (b & 15));
const NEVERS = [
  ...NEVER.commands.filter((c) => c.bytes && (c.vid === '*' ? c.page === 'FF60' : [].concat(c.vid).includes('3434'))).map((c) => ({ ...c, p: pat(c.bytes) })),
  ...def.never.map((n) => ({ ...n, what: n.why, p: pat(n.bytes) })),
];
ok(NEVERS.length >= 15, `never patterns loaded (${NEVERS.length})`);
const hitsNever = (bytes) => NEVERS.find((n) => [...Array((n.within || 0) + 1).keys()].some((s) => n.p.every((p, i) => nib(p, bytes[s + i] ?? 0))));
// every request the sheet documents for this driver (section 4 'Safe to read' + the three writes)
const ALLOWED = /^a7 (01|05|06|0b|0c|0d|0e|12)( |$)/;

// ---- a simulated Keychron board ----
// bits: A7 01 byte 5 (2 debounce, 4 LPM, 5 report rate, 7 NKRO); keychron: false = firmware without Keychron commands
function board(pid, o = {}) {
  const s = { bits: 0x04 | 0x10 | 0x20 | 0x80, keychron: true, type: 4, time: 5, light: 30, sleep: 7200, divider: 3, nkro: 0b101, sticky: false, capOnType: false, notice: true, ...o };
  const listeners = new Set();
  const dev = {
    vendorId: 0x3434, productId: pid, productName: 'simulated Keychron', opened: false, sent: [], bad: [], s,
    collections: [{ usagePage: 0xff60, usage: 0x61 }],
    async open() { this.opened = true; },
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(h(p));
      if (id !== 0) this.bad.push(`report id ${id}`);
      if (p.length !== 32) this.bad.push(`length ${p.length}`);
      if (!ALLOWED.test(h(p))) this.bad.push(`not a sheet command: ${h(p.slice(0, 4))}`);
      const n = hitsNever(p); if (n) this.bad.push(`never: ${h(p.slice(0, 4))} (${n.what})`);
      const emit = (r) => setTimeout(() => listeners.forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1);
      // an unasked layer notice first (state_notify.c): must never be taken for a reply
      if (s.notice) { const nr = new Uint8Array(32); nr[0] = 0xa3; nr[1] = 0; nr[2] = 1; emit(nr); }
      const r = reply(p); if (r) emit(r);
    },
  };
  function reply(p) {
    const r = new Uint8Array(32);
    if (!s.keychron || p[0] !== 0xa7) { r[0] = 0xff; return r; }                 // falls through to VIA: FF
    r[0] = 0xa7; r[1] = p[1];
    const has = (bit) => (s.bits & bit) !== 0;
    const unknown = () => { r[0] = 0xff; r[1] = 0x00; return r; };
    switch (p[1]) {
      case 0x01: r[3] = 0x02; r[4] = 0x00; r[5] = s.bits; return r;
      case 0x05: if (!has(0x04)) return unknown(); r[3] = 0; r[4] = s.type; r[5] = s.time; return r;
      case 0x06: if (!has(0x04)) return unknown(); if (p[2] > 6) { r[2] = 1; return r; }
        if (!s.sticky) { s.type = p[2]; s.time = s.capOnType && p[2] === 5 ? Math.min(p[3], 2) : p[3]; } return r;
      case 0x0b: if (!has(0x10)) return unknown(); r[3] = s.light & 0xff; r[4] = s.light >> 8; r[5] = s.sleep & 0xff; r[6] = s.sleep >> 8; return r;
      case 0x0c: { if (!has(0x10)) return unknown(); const l = p[2] | (p[3] << 8), z = p[4] | (p[5] << 8);
        if (l < 5 || z < 60) { r[2] = 1; return r; } if (!s.sticky) { s.light = l; s.sleep = z; } return r; }   // wireless_lpm_set refuses light < 5, sleep < 60
      case 0x0d: if (!has(0x20)) return unknown(); r[3] = s.divider; r[4] = 0x7f; return r;
      case 0x0e: if (!has(0x20)) return unknown(); if (p[2] > 6) { r[2] = 1; return r; } if (!s.sticky) s.divider = p[2]; return r;
      case 0x12: if (!has(0x80)) return unknown(); r[3] = s.nkro; return r;
      default: return unknown();
    }
  }
  return dev;
}

let plugged = null;
setDeviceProvider(async (filters) => (plugged && filters.some((f) => f.vendorId === plugged.vendorId && f.productId === plugged.productId && f.usagePage === 0xff60) ? plugged : null));
const drv = fromJson(path.join(DIR, 'driver.json'));
drv.vendorApp = async () => null;   // no tasklist in the test
ok(!problem(drv), `loads as a my-devices driver (${problem(drv)})`);
const attempt = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
const keys = () => drv.settings.map((s) => s.key).join(',');

// 1. a V1 8K with every group: all five settings
{
  const d = board(0x0f10); plugged = d;
  ok(await drv.connect(false), 'V1 8K connects');
  ok(keys() === 'debounceType,debounceTime,backlightOff,sleepTime,reportRate', `every setting its bits allow is shown (${keys()})`);
  const r0 = await drv.read();
  ok(JSON.stringify(r0) === JSON.stringify({ debounceType: 4, debounceTime: 5, backlightOff: 30, sleepTime: 7200, reportRate: 1000 }), `first read (${JSON.stringify(r0)})`);
  const info = await drv.info();
  ok(info.Model === 'Keychron V1 8K' && info['Keychron protocol'] === '2' && info.NKRO === 'on' && info['Adaptive NKRO'] === 'yes' && /^3 /.test(info['Report rate divider']), `info (${JSON.stringify(info)})`);

  // each setting: write another value, read back, put the original back, read back
  for (const [key, to] of [['debounceType', 2], ['debounceTime', 12], ['backlightOff', 120], ['sleepTime', 3600], ['reportRate', 8000]]) {
    const was = (await drv.read())[key];
    const w = await attempt(() => drv.write(key, to)); drv.snap = null;
    const back = (await drv.read())[key];
    ok(w.ok && w.v === to && back === to, `${key}: ${was} -> ${to} written and read back (${w.e || back})`);
    const p = await attempt(() => drv.write(key, was)); drv.snap = null;
    ok(p.ok && (await drv.read())[key] === was, `${key}: the original ${was} put back (${p.e || ''})`);
  }
  ok(d.sent.includes(h([0xa7, 0x0e, 0x00, ...new Array(29).fill(0)])), '8000 Hz goes out as A7 0E 00 (divider 0)');
  ok(d.sent.includes(h([0xa7, 0x0c, 120, 0, 0x20, 0x1c, ...new Array(26).fill(0)])), 'backlight 120 s goes out as A7 0C 78 00 + the sleep time read (20 1C = 7200) little-endian');
  ok(d.sent.includes(h([0xa7, 0x06, 4, 12, ...new Array(28).fill(0)])), 'debounce time 12 goes out as A7 06 + the method read (04) + 0C');

  // out of range or not a choice: refused before anything is sent
  const before = d.sent.length;
  for (const [k, v] of [['debounceTime', 101], ['debounceTime', -1], ['debounceTime', 2.5], ['debounceType', 7], ['backlightOff', 4], ['backlightOff', 3601], ['backlightOff', 7],
    ['sleepTime', 30], ['sleepTime', 14460], ['sleepTime', 90], ['reportRate', 2000], ['reportRate', 500], ['reportRate', '1000'], ['nkro', 'off'], ['factoryReset', 1], ['__proto__', 1]]) {
    ok(!(await attempt(() => drv.write(k, v))).ok, `refuses ${k} = ${JSON.stringify(v)}`);
  }
  ok(d.sent.length === before, `nothing was sent for a refused value (${d.sent.length - before} sent)`);

  // a write that does not stick: refused, the old value written back, nothing more
  d.s.sticky = true;
  const st = await attempt(() => drv.write('debounceTime', 20));
  ok(!st.ok && /written back/.test(st.e), `a write that does not stick is refused (${st.e})`);
  d.s.sticky = false; drv.snap = null;
  ok((await drv.read()).debounceTime === 5, 'and the board still reads the original');

  // a method change that moves the time (keep): refused and the old method put back
  d.s.capOnType = true; drv.snap = null;
  const cap = await attempt(() => drv.write('debounceType', 5));
  ok(!cap.ok && /something else moved/.test(cap.e), `a method change that moves the time is refused (${cap.e})`);
  d.s.capOnType = false; drv.snap = null;
  const rr = await drv.read();
  ok(rr.debounceType === 4, `the original method is back (${JSON.stringify(rr)})`);
  d.s.time = 5; drv.snap = null;

  // the maker's app (or VIA) running: reads and writes refused
  drv.vendorApp = async () => 'KeychronLauncher.exe'; drv.appAt = 0; drv.snap = null;
  const sentBefore = d.sent.length;
  ok(!(await attempt(() => drv.write('debounceTime', 8))).ok, 'a write is refused while a Keychron app runs');
  ok(!(await attempt(() => drv.read())).ok, 'a read is refused while a Keychron app runs');
  ok(d.sent.length === sentBefore && d.s.time === 5, 'nothing was sent while it ran');
  drv.vendorApp = async () => null; drv.appAt = 0; drv.snap = null;
  ok((await drv.read()).debounceTime === 5, 'it works again once the app is closed');
  const re = /^keychron.*\.exe$/i;
  ok(def.stepBack.processes.some((p) => new RegExp(p, 'i').test('KeychronLauncher.exe')) && def.stepBack.processes.some((p) => new RegExp(p, 'i').test('VIA.exe')) && re.test('Keychron Engine.exe'), 'the step-back patterns catch a Keychron app and VIA');

  ok(d.bad.length === 0, `only sheet commands, never a never-list one (${d.bad.join('; ')})`);
  const bk = await drv.rawBackup();
  ok(bk.replies.debounce && bk.replies.lpm && bk.replies.rate && bk.replies.nkro, 'raw backup holds every reply');
}

// 2. a Q1 (v2), wired, with only debounce and NKRO: no wireless timers, no report rate (never even asked)
{
  const d = board(0x0106, { bits: 0x04 | 0x80 }); plugged = d;
  ok(await drv.connect(false), 'Q1 v2 connects');
  ok(keys() === 'debounceType,debounceTime', `only debounce is shown (${keys()})`);
  await drv.read();
  ok(!d.sent.some((x) => /^a7 (0b|0d) /.test(x)), 'the timers and the report rate are never asked');
  ok(!(await attempt(() => drv.write('reportRate', 1000))).ok && !(await attempt(() => drv.write('sleepTime', 600))).ok, 'and cannot be written');
  ok(d.bad.length === 0, `only sheet commands (${d.bad.join('; ')})`);
}

// 3. a Q1 Pro on old firmware without Keychron's commands: nothing offered, nothing written
{
  const d = board(0x0610, { keychron: false }); plugged = d;
  ok(await drv.connect(false), 'Q1 Pro (no Keychron commands) still connects');
  ok(drv.settings.length === 0, `no settings on a board that answers FF (${keys()})`);
  ok(JSON.stringify(await drv.read()) === '{}', 'reads nothing');
  ok(!(await attempt(() => drv.write('debounceTime', 5))).ok, 'a write is refused');
  ok(d.sent.every((x) => x.startsWith('a7 01 ')), `only the A7 01 probe was sent (${[...new Set(d.sent.map((x) => x.slice(0, 5)))]})`);
}

// 4. a report rate the sheet does not confirm (divider 4 = 500 Hz by formula only): not reported, never written
{
  const d = board(0x0f10, { divider: 4 }); plugged = d;
  await drv.connect(false);
  const r = await drv.read();
  ok(r.reportRate === undefined && /^4 /.test((await drv.info())['Report rate divider']), `an unconfirmed divider reads as not reported, shown raw (${JSON.stringify(r)})`);
  ok(!(await attempt(() => drv.write('reportRate', 1000))).ok && d.s.divider === 4, 'and the rate is not written over it');
}

// 5. a sleep timer outside the page's range (the slider would lie): both timers become read only
{
  const d = board(0x0810, { sleep: 0 }); plugged = d;
  await drv.connect(false); await drv.read();
  ok(!drv.settings.some((s) => s.key === 'sleepTime' || s.key === 'backlightOff'), `a timer read outside its range locks the timer group (${keys()})`);
  ok(!(await attempt(() => drv.write('backlightOff', 60))).ok && d.s.light === 30, 'the backlight timer is not written then');
}

console.log(fails ? `sim-keychron-via: ${fails} FAILED` : 'sim-keychron-via (Keychron debounce, wireless timers, report rate over VIA; driver.json): all good');
process.exitCode = fails ? 1 : 0;
