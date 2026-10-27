// Any VIA keyboard, any brand (27 Oct 2026, helpers/via-generic.mjs, public/devices/keyboard-adapter.js): simulated
// keyboards on VIA's raw HID collection (FF60:0061, 32-byte reports, replies echoing the request as QMK via.c does).
//   - an unlisted board (vendor 5043) that answers VIA: asked ONLY the protocol version first, connects, its layout
//     comes from a stand-in for VIA's library, it is read-only until Turn on settings, and each group opens only after
//     its write-then-read-back check passed;
//   - the same board with no published layout: still connects with what VIA reports, keys not drawn or written;
//   - a board on FF60 that does not answer, answers 0xFF, or echoes the request: stepped aside after that ONE question,
//     nothing else sent, and not asked again until the person presses Connect;
//   - which keyboards the slot takes (never while the P75 is plugged in; listed ids stay as they were);
//   - VIA's library download keeps via-fetch's rules (HTTPS to usevia.app, the right ids, drawable, size).
// No board ever receives 0x06, 0x0A (EEPROM reset), 0x0B (bootloader jump), 0x10 or 0x13.
// Run: node tests/via-generic.mjs (no hardware, no network)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setDeviceProvider } from '../public/devices/hid.js';
import { ViaKeyboard, useKeyboardIds } from '../public/devices/via.js';
import adapter, { useLayout, useViaGate } from '../public/devices/keyboard-adapter.js';
import { fromDefinition } from '../public/devices/via-layout.js';
import { candidates, listedIds, settingsStore, P75_ID } from '../helpers/via-generic.mjs';

const require = createRequire(import.meta.url);
const viaDefs = require('../helpers/via-defs.js');
const vf = await import('../helpers/via-fetch.mjs');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const h = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');
const NEVER = new Set([0x06, 0x0a, 0x0b, 0x10, 0x13]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-via-generic-'));

// ---- a simulated VIA keyboard ----
// mode: 'via' answers VIA 12; 'silent' never answers; 'ff' answers 0xFF to everything; 'echo' sends the request back
const VID = 0x5043, PID = 0x5a4c, ROWS = 2, COLS = 8;
function board(mode = 'via') {
  const listeners = new Set();
  const keymap = Array.from({ length: 4 }, (_, l) => Array.from({ length: ROWS * COLS }, (_, i) => (l === 0 ? 0x04 + i : 0x01)));
  const macros = new Uint8Array(64);
  macros.set([0x61, 0x62, 0], 0);
  const light = { 1: [120], 2: [3], 3: [128], 4: [10, 255] };
  const dev = {
    vendorId: VID, productId: PID, productName: 'Simulated VIA 5043', opened: false, sent: [], closed: 0,
    collections: [{ usagePage: 0xff60, usage: 0x61 }],
    async open() { this.opened = true; },
    close() { this.closed++; this.opened = false; },
    addEventListener(t, f) { listeners.add(f); }, removeEventListener(t, f) { listeners.delete(f); },
    async sendReport(id, data) {
      const p = Uint8Array.from(data);
      this.sent.push(p);
      if (mode === 'silent') return;
      const r = new Uint8Array(32);
      r.set(p);
      if (mode === 'ff') { r[0] = 0xff; r.set(p.slice(0, 31), 1); }
      else if (mode === 'echo') { /* the request back, as a raw-HID echo would */ }
      else {
        const c = p[0];
        if (c === 0x01) { r[1] = 0x00; r[2] = 0x0c; }
        else if (c === 0x02) { r.fill(0, 2); }
        else if (c === 0x11) r[1] = 4;
        else if (c === 0x12) { const off = (p[1] << 8) | p[2]; const flat = keymap.flat(); for (let i = 0; i < p[3]; i++) { const w = flat[(off + i) >> 1] ?? 0; r[4 + i] = (off + i) % 2 ? w & 0xff : w >> 8; } }
        else if (c === 0x04) { const w = keymap[p[1]][p[2] * COLS + p[3]]; r[4] = w >> 8; r[5] = w & 0xff; }
        else if (c === 0x05) { keymap[p[1]][p[2] * COLS + p[3]] = (p[4] << 8) | p[5]; }
        else if (c === 0x0c) r[1] = 4;
        else if (c === 0x0d) { r[1] = 0; r[2] = macros.length; }
        else if (c === 0x0e) { const off = (p[1] << 8) | p[2]; r.set(macros.slice(off, off + p[3]), 4); }
        else if (c === 0x0f) { const off = (p[1] << 8) | p[2]; macros.set(p.slice(4, 4 + p[3]), off); }
        else if (c === 0x08 && p[1] === 3) r.set(light[p[2]] || [0], 3);
        else if (c === 0x07 && p[1] === 3) light[p[2]] = [...p.slice(3, p[2] === 4 ? 5 : 4)];
        else if (c === 0x09) { /* save */ }
        else { r[0] = 0xff; r.set(p.slice(0, 31), 1); }
      }
      setTimeout(() => listeners.forEach((f) => f({ reportId: 0, data: new DataView(r.buffer) })), 1);
    },
  };
  return dev;
}
const firstBytes = (d) => d.sent.map((p) => p[0]);
const noNever = (d, what) => ok(!d.sent.some((p) => NEVER.has(p[0])), `${what}: never sent 0x06 / 0x0A / 0x0B / 0x10 / 0x13 (${[...new Set(firstBytes(d))].map((b) => b.toString(16)).join(' ')})`);

// a VIA library definition for the simulated board, as usevia.app serves it (v3: vendorProductId, matrix, layouts.keys)
const def = { name: 'Simulated 5043 board', vendorProductId: VID * 65536 + PID, matrix: { rows: ROWS, cols: COLS },
  layouts: { keys: Array.from({ length: ROWS * COLS }, (_, i) => ({ row: Math.floor(i / COLS), col: i % COLS, x: i % COLS, y: Math.floor(i / COLS), w: 1, h: 1 })) } };
const defText = JSON.stringify(def);
const response = (body, { status = 200, type = 'application/json', url = `https://usevia.app/definitions/v3/${def.vendorProductId}.json` } = {}) =>
  ({ ok: status === 200, status, url, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : k.toLowerCase() === 'content-length' ? String(Buffer.byteLength(body)) : null) }, text: async () => body });

// ---- which keyboard the slot takes ----
{
  const listed = new Set([P75_ID, '3434:0100']);
  const found = [{ vid: '5043', pid: '5A4C', name: 'A' }, { vid: '3434', pid: '0100', name: 'Keychron' }];
  const c = candidates(found, { listed });
  ok(c.length === 2 && c[0].id === '5043:5a4c' && c[0].unlisted === true && c[1].unlisted === false, 'an unknown vendor is a candidate and unlisted; a listed id is not unlisted');
  ok(candidates([...found, { vid: '342D', pid: 'E479' }], { listed }).length === 0, 'nothing else is taken while the P75 (its own driver) is plugged in');
  ok(candidates(found, { listed, aside: new Set(['5043:5a4c']) })[0].id === '3434:0100', 'a stepped-aside keyboard is skipped, the next one tried');
  const real = listedIds();
  ok(real.has(P75_ID) && real.has('3434:0100'), 'the library\'s Keychron ids and the P75 count as listed');
  ok(!real.has('5043:5a4c') && !real.has('feed:6060'), 'an id nothing names is unlisted');
  const st = settingsStore(path.join(tmp, 'settings-on.json'));
  st.set('5043:5a4c', { settingsOn: { at: 'x' } });
  ok(st.get('5043:5a4c')?.settingsOn?.at === 'x' && st.get('feed:6060') === null, 'the settings-on record is kept per keyboard');
}

// ---- the layout from VIA's library, through a stand-in (via-defs.js definitionFor) ----
viaDefs.deps.dir = tmp; vf.deps.dir = tmp;
{
  const asked = [];
  viaDefs.deps.fetch = async (u) => { asked.push(u); return response(defText); };
  const got = await viaDefs.definitionFor('5043', '5A4C');
  ok(got.from === 'VIA\'s library' && got.def.name === def.name && asked.length === 1 && asked[0].startsWith('https://usevia.app/'), 'an unknown board\'s layout is fetched from VIA\'s library over HTTPS');
  ok(fs.existsSync(path.join(tmp, '5043' + '5A4C.json')), 'and saved for next time');
  const again = await viaDefs.definitionFor('5043', '5A4C');
  ok(again.from.startsWith('via-definitions') && asked.length === 1, 'the saved file is used next time, nothing asked again');
  // the refusals: another board's file, a redirect to another host, a web page, too large
  const refuse = async (r, what) => {
    viaDefs.deps.fetch = async () => r;
    let e = null; try { await viaDefs.definitionFor('FEED', '6060'); } catch (x) { e = x; }
    ok(e && !fs.existsSync(path.join(tmp, 'FEED6060.json')), `${what}: refused, nothing saved (${e?.message})`);
  };
  await refuse(response(defText), 'a file for another keyboard');
  await refuse(response(JSON.stringify({ ...def, vendorProductId: 0xfeed * 65536 + 0x6060 }), { url: 'https://evil.example/x.json' }), 'a redirect away from usevia.app');
  await refuse(response('<html></html>', { type: 'text/html' }), 'a web page');
  await refuse(response(JSON.stringify({ ...def, vendorProductId: 0xfeed * 65536 + 0x6060, pad: 'x'.repeat(vf.MAX_BYTES) })), 'a file over the size limit');
  viaDefs.deps.fetch = async () => response('{}', { status: 404 });
  let none = null; try { await viaDefs.definitionFor('FEED', '6060'); } catch (x) { none = x; }
  ok(none && /not in VIA's library/.test(none.message), 'no published layout: a plain answer, nothing saved');
}

// ---- an unlisted board that answers VIA: read-only, then Turn on settings ----
{
  const d = board('via');
  setDeviceProvider(async () => d);
  useKeyboardIds(VID, PID);
  useLayout(fromDefinition(def));
  let steppedAside = null;
  useViaGate({ id: '5043:5a4c', vid: '5043', pid: '5A4C', unlisted: true, onStepAside: (id, why) => { steppedAside = why; } });
  const connected = await adapter.connect(false);
  ok(connected === true && !steppedAside, 'an unlisted VIA board connects with no Learn and no button');
  ok(d.sent[0]?.[0] === 0x01 && d.sent[0].slice(1).every((b) => b === 0), `the first thing sent is ONLY VIA's protocol version question (${h(d.sent[0]?.slice(0, 4) || [])})`);
  ok(adapter.session.keymap?.[0]?.[0]?.[0] === 0x04 && adapter.session.layout.keys.length === ROWS * COLS, 'its keymap is read with the fetched layout');
  const info = await adapter.info();
  ok(info.Protocol === 'VIA 12' && info.Layers === 4 && info.Matrix === '2 × 8', `it reports what VIA says (${JSON.stringify(info)})`);
  const values = await adapter.read();
  ok(values.brightness === 120 && values.effect === 3, 'its lighting is read');
  ok(adapter.via?.unlisted && adapter.via.needsTurnOn && !adapter.via.on, 'it waits for Turn on settings');
  const before = d.sent.length;
  for (const [k, v] of [['brightness', 50], ['effect', 1], ['key:0:0:0', 0x05], ['macro:0', 'x'], ['enc:0:0:0', 0x05]]) {
    let e = null; try { await adapter.write(k, v); } catch (x) { e = x; }
    ok(e && /read-only/.test(e.message), `${k} is refused before Turn on settings (${e?.message})`);
  }
  ok(d.sent.length === before, 'and nothing was sent for those refused writes');
  ok(!d.sent.some((p) => [0x05, 0x07, 0x0f, 0x15].includes(p[0])), 'no VIA write was sent before Turn on settings');
  const r = await adapter.turnOn(new Date('2026-10-27T12:00:00Z'));
  ok(r.on && r.ran && r.counts.checked === 3 && r.counts.passed === 3, `Turn on settings checks keys, macros and lighting (${JSON.stringify(r)})`);
  const writes = d.sent.slice(before).filter((p) => [0x05, 0x07, 0x0f].includes(p[0]));
  ok(writes.length === 3, `each check is one write of the value read just before (${writes.map((p) => h(p.slice(0, 6))).join(' | ')})`);
  ok(writes.find((p) => p[0] === 0x05)?.[5] === 0x04 && writes.find((p) => p[0] === 0x07)?.[3] === 3, 'the key and the effect are written back with their own values');
  ok(!adapter.via.needsTurnOn && adapter.via.on && adapter.via.checks.lighting.ok, 'its settings are now on');
  const now = await adapter.write('brightness', 200);
  ok(now === 200, 'a lighting write goes through once its check passed, and reads back');
  const k = await adapter.write('key:1:0:1', 0x2c);
  ok(k === 0x2c, 'a key write goes through and reads back');
  let bad = null; try { await adapter.write('key:0:0:0', 0x7c00); } catch (x) { bad = x; }
  ok(bad && /blocked/.test(bad.message), 'a reset / bootloader keycode is still refused');
  noNever(d, 'the unlisted board');
}

// ---- the same board with no published layout ----
{
  const d = board('via');
  setDeviceProvider(async () => d);
  useLayout(null, { name: 'Simulated VIA 5043', why: 'its key layout is not published' });
  useViaGate({ id: 'feed:6061', vid: 'FEED', pid: '6061', unlisted: true });
  ok(await adapter.connect(false), 'a board with no published layout still connects');
  ok(adapter.session.keymap === null && adapter.session.layout.none, 'its keys are not read without a matrix size');
  ok(!d.sent.some((p) => p[0] === 0x12), 'no keymap buffer read without a layout');
  const info = await adapter.info();
  ok(info.Matrix === 'not published' && info.Layers === 4, `it shows what VIA reports (${JSON.stringify(info)})`);
  ok(adapter.via.noLayout && adapter.via.needsTurnOn, 'the page is told the layout is not published');
  const r = await adapter.turnOn();
  ok(r.on && r.counts.checked === 2 && !adapter.via.checks.keys, 'Turn on settings checks macros and lighting only');
  let e = null; try { await adapter.write('key:0:0:0', 0x05); } catch (x) { e = x; }
  ok(e && /no published key layout/.test(e.message), 'a key write is refused without a layout');
  noNever(d, 'the board with no layout');
}

// ---- boards on FF60 that do not speak VIA: stepped aside after one question ----
for (const mode of ['silent', 'ff', 'echo']) {
  const d = board(mode);
  setDeviceProvider(async () => d);
  useLayout(fromDefinition(def));
  let steppedAside = null;
  useViaGate({ id: '5043:5a4c', vid: '5043', pid: '5A4C', unlisted: true, onStepAside: (id, why) => { steppedAside = { id, why }; } });
  const connected = await adapter.connect(false);
  ok(connected === false && steppedAside?.id === '5043:5a4c', `${mode}: stepped aside (${steppedAside?.why})`);
  ok(d.sent.length === 1 && d.sent[0][0] === 0x01, `${mode}: only the protocol version question was sent (${d.sent.map((p) => h(p.slice(0, 4))).join(' | ')})`);
  ok(d.closed === 1, `${mode}: its channel was let go`);
  ok(adapter.via.aside && !adapter.via.needsTurnOn, `${mode}: shown as stepped aside, no Turn on settings offered`);
  ok((await adapter.connect(false)) === false && d.sent.length === 1, `${mode}: not asked again by a background look`);
  noNever(d, mode);
}

// ---- the refused commands never leave, on any path ----
{
  const d = board('via');
  const kb = new ViaKeyboard(d);
  for (const c of [0x06, 0x0a, 0x0b, 0x10, 0x13]) {
    let e1 = null, e2 = null;
    try { await kb.cmd([c]); } catch (x) { e1 = x; }
    try { await kb.ch.request([c]); } catch (x) { e2 = x; }
    ok(e1 && e2 && /refusing/.test(e2.message), `0x${c.toString(16)} is refused by cmd() and by the channel itself`);
  }
  ok(d.sent.length === 0, 'none of them reached the board');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `via-generic: ${fails} failed` : 'via-generic: all passed');
process.exit(fails ? 1 : 0);
