// Smoother for friends (24 Oct 2026; docs/handoff/smoother-for-friends.md): Windows' admin box (installers and board
// lights: the line while waiting, declined and not answered within the wait, Try again, recorded for Get help), the PC's
// whole device picture in Get help (trim levels, an old driver shown, within the relay's and GitHub's limits), Learn's
// pre-flight (each line and its fix; recording refused until it passes), the "nothing heard" stop, and the recordings
// sent to Shawn (compact when too big). Everything with stand-ins in TEMP: no prompt, no device, no network.
// Run: node tests/smoother.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as uac from '../helpers/uac.mjs';
import * as inst from '../helpers/installers.mjs';
import * as bl from '../helpers/board-lights.mjs';
import * as lw from '../helpers/learn-wizard.mjs';
import { captureReport, sendCaptures, SENT_DONE, RELAY_BODY } from '../helpers/learn-send.mjs';
import { lines as picLines, LEVELS, btName, libraryVersions } from '../helpers/pc-picture.mjs';
import { report, options as helpOptions, MAX_URL, RELAY_BODY as HELP_RELAY } from '../helpers/get-help.mjs';
import { boardView } from '../public/core/board-lights.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-smoother-'));
uac.options.root = tmp;

// ---------- 2. Windows' admin box ----------
check(/Click Yes in Windows' prompt \(if hidden, the blinking taskbar shield\)/.test(uac.UAC_LINE), 'the line says where the box is');
{
  // an installer whose box is never answered: the line while waiting, then "not answered" with Try again, recorded
  const d = inst.deps;
  d.exists = () => false; d.installedApps = async () => [];
  d.download = async (t, dest, on) => { fs.writeFileSync(dest, 'x'); on(1, 1); };
  d.signature = async () => ({ status: 'Valid', signer: 'CN=Tomasz Moń, O=Tomasz Moń, C=PL' });
  const seen = [];
  d.run = async (file, o = {}) => { seen.push(inst.getProgress()?.text); return { started: false, unanswered: true, error: 'not answered' }; };
  let r = await inst.install('usbpcap');
  check(seen[0] === uac.UAC_LINE && inst.getProgress().uac === 'unanswered', `while waiting the installer shows the line (${seen[0]})`);
  check(!r.ok && r.retry && r.uac === 'unanswered' && /not answered within 2 minutes/.test(r.text) && /Try again/.test(r.text), `not answered: said, with Try again (${r.text})`);
  d.run = async () => ({ started: false, declined: true, error: 'The operation was canceled by the user.' });
  r = await inst.install('usbpcap');
  check(!r.ok && r.retry && r.uac === 'declined' && /declined/.test(r.text), `declined: said, with Try again (${r.text})`);
  d.run = async (file, o = {}) => { o.onStarted?.(); seen.push(inst.getProgress()?.text); return { started: true, exitCode: 0 }; };
  await inst.install('usbpcap');
  check(/installer is open/.test(seen.at(-1)), `answered Yes: the next step shows (${seen.at(-1)})`);
  const rec = uac.recent({ root: tmp, n: 10 });
  check(rec.some((e) => e.outcome === 'unanswered' && /USBPcap/.test(e.action)) && rec.some((e) => e.outcome === 'declined'), `declined and not answered are kept for Get help (${JSON.stringify(rec)})`);
}
{
  // board lights: the elevated script's own "started" file moves it on; no answer within the wait writes the cancel file
  const d = bl.deps;
  const pc = { task: false };
  d.pawnio = async () => ({ app: true, service: true, version: '2.2.0.0' });
  d.task = async () => pc.task;
  d.exists = (f) => (f === bl.BOARD.exe ? pc.task : /uac-(started|cancel)-/.test(f) ? fs.existsSync(f) : true);
  d.readResult = () => ''; d.clearResult = () => {}; d.stopBundled = () => {}; d.forget = () => {};
  d.waitServer = async () => true;
  d.uacWaitMs = 300;
  let marks = null;
  d.elevate = (script, o = {}) => { marks = o.marks; return new Promise((res) => o.signal.addEventListener('abort', () => res({ ok: false, error: 'stopped waiting' }))); };
  bl._test.reset();
  const p = bl.setUp();
  await new Promise((r) => setTimeout(r, 50));
  check(bl.getProgress().text === uac.UAC_LINE && bl.getProgress().uac === 'waiting', `board lights shows the line while Windows asks (${bl.getProgress().text})`);
  const v = boardView({ setUp: false, canSetUp: true, before: 'b' }, bl.getProgress());
  check(v.uac && v.line === uac.UAC_LINE, 'the control draws the line as it is');
  let r = await p;
  check(!r.ok && r.uac === 'unanswered' && r.retry && /not answered within 2 minutes/.test(r.text), `not answered: said (${r.text})`);
  check(marks && fs.existsSync(marks.cancel), 'the cancel file is written, so a Yes pressed later changes nothing');
  check(bl.uacMarks(marks).startsWith(`if (Test-Path -LiteralPath '${marks.cancel}') { exit 4 }`) && bl.uacMarks(marks).includes(marks.started), 'the elevated script stops at once when the cancel file is there, and says it started');
  const tv = boardView({ setUp: false, canSetUp: true, before: 'b', remove: 'r' }, r);
  check(tv.action === 'setup' && tv.label === 'Try again' && /not answered/.test(tv.result?.text || ''), `the control offers Try again (${JSON.stringify(tv)})`);
  // answered Yes: the started file moves the step on
  bl._test.reset();
  const steps = [];
  d.elevate = async (script, o = {}) => { fs.writeFileSync(o.marks.started, 'started'); await new Promise((res) => setTimeout(res, 1300)); steps.push(bl.getProgress().text); pc.task = true; return { ok: true, code: 0 }; };
  r = await bl.setUp();
  check(steps[0] && steps[0] !== uac.UAC_LINE && /OpenRGB/.test(steps[0]), `answered Yes: the next step shows (${steps[0]})`);
  check(r.ok, `set up after a Yes (${r.text})`);
  try { fs.rmSync(marks.cancel, { force: true }); } catch {}
}

// ---------- 3. the whole device picture ----------
check(btName("Sam's AirPods") === 'a Bluetooth airpods' && btName('Bob phone') === 'a Bluetooth device' && !/Zorb/.test(btName('Zorb Buds Pro')), 'a Bluetooth name gives only its kind');
{
  const root = path.join(tmp, 'dh');
  const put = (rel, o) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), typeof o === 'string' ? o : JSON.stringify(o)); };
  put('package.json', { name: 'devicehub', version: '0.1.0' });
  const meta = (updated) => ({ id: 'acme-mouse', vendor: 'Acme', product: 'Mouse', kind: 'Mouse', vid: '1234', pids: ['abcd'], models: ['A'], works: [], status: 'read-only', tested: [], updated });
  put('my-devices/acme-mouse/device.json', meta('2026-10-20')); put('my-devices/acme-mouse/device.mjs', 'export default {}');
  put('my-devices/acme-mouse/library.json', { name: 'acme-mouse', id: 'acme-mouse', status: 'read-only', source: 'device-library/acme-mouse' });
  put('device-library/acme-mouse/device.json', meta('2026-10-23'));
  put('library-cache/state.json', { lastCheckAt: '2026-10-24T08:00:00.000Z', lastReason: 'start', errors: [] });
  const lv = await libraryVersions(root, null);
  check(lv[0]?.old && lv[0].inUse === '2026-10-20' && lv[0].newest === '2026-10-23', `an old driver is seen at once (${JSON.stringify(lv)})`);
  const usb = Array.from({ length: 70 }, (_, i) => ({ id: `0${(1000 + i).toString(16)}:00${i.toString(16).padStart(2, '0')}`, vid: `0${(1000 + i).toString(16)}`, pid: `00${i.toString(16).padStart(2, '0')}`, name: `Generic USB thing number ${i} with a long Windows name`, usages: { mouse: false, keyboard: false } }));
  usb.push({ id: '1234:abcd', vid: '1234', pid: 'abcd', name: 'Acme receiver', usages: { mouse: true, keyboard: true } }, { id: '25a7:fa70', vid: '25a7', pid: 'fa70', name: '2.4G Wireless Receiver', usages: { mouse: true, keyboard: true } });
  const state = { devices: [{ id: 'acme-mouse', status: 'connected', seen: true, adapter: { id: 'acme-mouse', title: 'Acme mouse', kind: 'Mouse', plugin: 'acme-mouse', library: { turnOn: true, newerDriver: null } } }] };
  const log = Array.from({ length: 300 }, (_, i) => `[my-devices] acme-mouse: Acme mouse added, line ${i} ${'x'.repeat(20)}`);
  Object.assign(helpOptions, { root, names: [] });
  const deps = { root, version: async () => 'v1', windows: async () => 'Windows 11', state: async () => state, usb: async () => usb, bluetooth: async () => [{ name: "Sam's Xbox Wireless Controller", connected: true }], makers: async () => ({ running: ['Logitech G HUB'], installed: ['Logitech G HUB', 'Corsair iCUE'] }), log: async () => log, diagnose: async () => ({ findings: [] }), canSend: async () => true };
  for (const [id, how] of [['acme-mouse', {}], ['', { area: 'learn' }], ['', {}]]) {
    const r = await report(id, { ...deps, get: async (p) => (p === '/api/agent/state' ? state : p === '/api/learn/state' ? { usbpcap: true, active: false } : null) }, how);
    check(r.ok && r.length <= MAX_URL, `${how.area || id || 'general'}: the link fits (${r.length})`);
    check(/### This PC's devices/.test(r.body) && /1234:abcd Acme receiver \[mouse, keyboard\]: acme-mouse \(library read-only\), connected, settings not turned on/.test(r.body), `${how.area || id || 'general'}: the picture names each device's driver`);
    check(/25a7:fa70 2\.4G Wireless Receiver \[mouse, keyboard\]: none \(no driver for it in DeviceHub's library\)/.test(r.body), `${how.area || id || 'general'}: a device with no driver says why`);
    check(/acme-mouse: 2026-10-20 \/ 2026-10-23 \/ not cached -> OLD: 2026-10-23 is out/.test(r.body), `${how.area || id || 'general'}: the old driver shows in the link too`);
    check(!/Sam/.test(r.body) && /a Bluetooth xbox/i.test(r.body) === false || !/Sam/.test(r.body), 'no Bluetooth name');
    check(r.pcLevel > 0, `the 72 USB devices were trimmed to fit the link (level ${r.pcLevel})`);
  }
  const { reportFor } = await import('../helpers/get-help.mjs');
  const r = await report('acme-mouse', { ...deps, get: async () => state });
  const rel = reportFor(r.token);
  check(rel && rel.body.length <= HELP_RELAY && JSON.stringify({ title: rel.title, body: rel.body }).length <= 15500, `Send to Shawn's version fits the relay (${rel?.body.length})`);
  check(rel && rel.body.length > r.body.length && /Makers' apps running: Logitech G HUB/.test(rel.body) && /DeviceHub's log about devices/.test(rel.body), `the relay version carries more than the link (${rel?.body.length} vs ${r.body.length}: ${rel?.body.slice(-500)})`);
  // levels: each one shorter or equal, the device log goes before the USB list
  const pic = { usb: [{ id: '1:1', name: 'a', usages: [], claims: [], none: 'no driver' }, { id: '2:2', name: 'b', usages: ['mouse'], claims: [{ driver: 'x', status: 'connected' }], none: null }], bluetooth: [{ name: 'a Bluetooth mouse', connected: true }], makers: { running: [], installed: ['A'] }, library: [], libraryCheck: null, uac: [{ at: '2026-10-24T01:00:00Z', area: 'learn', action: 'start listening', outcome: 'unanswered' }], log: Array.from({ length: 20 }, (_, i) => `[agent] line ${i}`) };
  let prev = Infinity;
  for (let l = 0; l <= LEVELS; l++) { const n = picLines(pic, l).join('\n').length; check(n <= prev + 80, `level ${l} is not much longer than the one before`); prev = n; }
  check(picLines(pic, LEVELS).join('\n').length < picLines(pic, 0).join('\n').length, 'the last level is shorter than the first');
  check(picLines(pic, 0).some((x) => /permission box not answered: start listening/.test(x)), 'a box not answered is in the picture');
  check(picLines(pic, 0).filter((x) => /\[agent\] line/.test(x)).length === 20 && !picLines(pic, 5).some((x) => /\[agent\]/.test(x)), 'the last 20 device log lines, dropped at level 5');
}

// ---------- 4. Learn: the pre-flight, the nothing-heard stop, the recordings sent ----------
{
  const root = path.join(tmp, 'learn');
  fs.mkdirSync(root, { recursive: true });
  lw.options.root = root;
  const col = (page, usage) => ({ vid: '25A7', pid: 'FA70', iface: 1, col: 1, page, usage, inLen: 9, outLen: 9, featLen: 0, inIds: [], outIds: [], featIds: [], product: '2.4G Wireless Receiver' });
  const kb = (page, usage) => ({ ...col(page, usage), vid: '3434', pid: '0123', product: 'K board' });
  const state = new Map();
  const world = { usbpcap: true, check: null, maker: { known: false } };
  lw.options.deps = {
    ...lw.deps,
    usbpcapInstalled: () => world.usbpcap,
    lastCheck: () => world.check,
    saveCheck: () => {},
    maker: async () => world.maker,
    owned: () => ({ runs: [], mine: [], copies: [] }),
    listHid: async () => ({ collections: [col('0001', '0002'), col('0001', '0006'), col('FF00', '0001'), kb('0001', '0006'), kb('FF60', '0061')] }),
    startCapture: async (dir) => { state.set(dir, { seq: 0, status: 'ready' }); return { started: true }; },
    writeCommand: (dir, text) => { const [seq, verb] = text.split(' '); state.set(dir, { seq: Number(seq), status: verb === 'start' ? 'recording' : verb === 'stop' ? 'stopped' : 'ended' }); },
    readState: (dir) => state.get(dir) || null,
    readTake: () => [],
    sleep: async () => {},
    plan: async () => ({ maker: world.maker, kind: 'mouse', items: [] }),
  };
  lw.reset();
  await lw.refreshDevices();
  const pf = (o = {}) => lw.preflight({ vid: '25A7', pid: 'FA70', labels: ['DPI'], kind: 'mouse', ...o });
  const lineOf = (r, id) => r.lines.find((x) => x.id === id);
  // the friend's case: USBPcap installed but never tested, an unknown 2.4G receiver, no app DeviceHub knows
  let r = await pf();
  check(!r.ok && !lineOf(r, 'capture').ok && lineOf(r, 'capture').action === 'check', `never tested: Test my learning setup is the fix (${JSON.stringify(lineOf(r, 'capture'))})`);
  check(!lineOf(r, 'app').ok && /does not know this device's app/.test(lineOf(r, 'app').says) && lineOf(r, 'app').action === 'app-open', 'an unknown app: says so, with I have its app open');
  check(r.lines.every((x) => x.ok || x.fix), 'each failing line has one fix');
  world.usbpcap = false;
  r = await pf();
  check(lineOf(r, 'capture').action === 'install-usbpcap', 'no USBPcap: install it');
  world.usbpcap = true; world.check = { ok: true, at: new Date().toISOString() };
  world.maker = { known: true, name: 'Pretend Hub', page: 'https://example.invalid/get', installed: false, running: false };
  r = await pf();
  check(lineOf(r, 'capture').ok && !lineOf(r, 'app').ok && lineOf(r, 'app').link === 'https://example.invalid/get' && !lineOf(r, 'open'), `not installed: the official link (${JSON.stringify(lineOf(r, 'app'))})`);
  world.maker = { ...world.maker, installed: true };
  r = await pf();
  check(lineOf(r, 'app').ok && !lineOf(r, 'open').ok && lineOf(r, 'open').action === 'open-app', 'installed, not open: Open it');
  world.maker = { ...world.maker, running: true };
  r = await pf();
  check(r.ok && lineOf(r, 'device').ok, `all pass for DPI on a receiver with a mouse interface (${JSON.stringify(r.lines)})`);
  r = await lw.preflight({ vid: '3434', pid: '0123', labels: ['DPI'] });
  check(!r.ok && /DPI is a mouse setting, and it shows no mouse interface/.test(lineOf(r, 'device').says) && lineOf(r, 'device').action === 'pick', `DPI on a keyboard: the wrong device (${lineOf(r, 'device').says})`);
  world.check = { ok: false, at: new Date().toISOString() };
  r = await pf();
  check(!lineOf(r, 'capture').ok && /did not pass its last test/.test(lineOf(r, 'capture').says), 'a failed test: not ready');
  // recording cannot start until every line passes
  check((await lw.act('begin', { vid: '25A7', pid: 'FA70', kind: 'mouse' })).ok, 'a session opens');
  await lw.act('setting', { label: 'DPI', kind: 'number', values: ['800', '1600'] });
  let l = await lw.act('listen', {});
  check(l.ok === false && /Not ready to record yet/.test(l.error) && l.preflight && !l.preflight.ok && state.size === 0, `listening refused before the pre-flight passes (${l.error})`);
  world.check = { ok: true, at: new Date().toISOString() };
  l = await lw.act('listen', {});
  check(l.ok && state.size === 1, `listening once every line passes (${l.error})`);
  // nothing heard for 10 seconds: stopped, with what to try
  const rec = await lw.act('record', {});
  check(rec.ok && rec.recording && rec.recording.heard === 0, `recording, heard 0 so far (${JSON.stringify(rec.recording)})`);
  check(await lw.nothingCheck(Date.now() + 2000) === null, 'not before 10 seconds');
  const n = await lw.nothingCheck(Date.now() + lw.NOTHING_MS + 100);
  check(n && /Nothing heard/.test(n.says) && n.tries.length >= 3 && n.tries.some((t) => /receiver/.test(t)), `stopped after 10 seconds with what to try (${JSON.stringify(n)})`);
  check(!lw.status().recording && lw.status().nothing?.says === n.says, 'the recording is stopped and the state says why');
  lw.reset();
}
{
  // the recordings to Shawn: within the relay, compact when too big, and the person's last line
  const msg = (i, j) => ({ dir: 'out', type: 'output', reportId: 0, data: Array.from({ length: 64 }, (_, k) => (i * 7 + j * 3 + k) & 255) });
  const captures = [];
  for (const [label, values] of [['DPI', [800, 1600]], ['Polling rate', ['125 Hz', '1000 Hz']], ['Lift-off', ['Low', 'High']]]) for (const v of values) captures.push({ label, kind: 'number', value: v, messages: Array.from({ length: 120 }, (_, j) => msg(j % 40 === 0 ? values.indexOf(v) + 1 : 0, j)) });
  const data = { at: 1, device: { vid: '25A7', pid: 'FA70', name: '2.4G Wireless Receiver', kind: 'mouse', interfaces: ['page 0001 usage 0002', 'page FF00 usage 0001, out 9'] }, maker: { name: 'Pretend Hub', installed: true, running: true }, captures };
  const c = captureReport(data);
  check(c.body.length <= RELAY_BODY && c.level >= 1 && c.leftOut > 0 && /Left out to fit/.test(c.body), `too big: compact, says what was left out (level ${c.level}, ${c.body.length})`);
  check(/USB: 25A7:FA70/.test(c.body) && /\*\*DPI\*\*/.test(c.body) && /Interface: page FF00/.test(c.body), 'the ids, interfaces and each setting are in it');
  const small = captureReport({ ...data, captures: captures.slice(0, 2).map((x) => ({ ...x, messages: x.messages.slice(0, 3) })) });
  check(small.level === 0 && !/Left out/.test(small.body), 'small enough: every message');
  let sent = null;
  const fake = { options: {}, finalCheck: (f, t, b) => ({ ok: true, body: b }), sendNow: async (p) => { sent = p; return { sent: true }; } };
  const s = await sendCaptures(data, { ar: fake, findPersonal: () => [], sendNow: fake.sendNow });
  check(s.sent && s.line === SENT_DONE && SENT_DONE === 'Sent. The driver usually arrives within a day.', `sent, and the person's part ends (${s.line})`);
  check(sent && /^support:learn:25a7-fa70:/.test(sent.fingerprint) && sent.body.length <= 12000 && sent.title.length <= 120, `through the relay as a support item (${sent?.fingerprint})`);
  const none = await sendCaptures({ ...data, captures: [] }, { ar: fake, findPersonal: () => [], sendNow: fake.sendNow });
  check(!none.sent && /nothing was heard/.test(none.why), 'nothing recorded: nothing sent');
}

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log(`smoother: ${fails.length} problem(s)\n${fails.map((f) => `- ${f}`).join('\n')}`); process.exit(1); }
console.log('smoother (admin box waits and answers, the whole device picture in Get help, Learn pre-flight, nothing heard, recordings sent): all good');
process.exit(0);
