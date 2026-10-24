// Learn it for me (helpers/learn-auto.mjs, 23 Oct 2026), start to end with nothing real: a pretend mouse, a pretend
// maker's app that DeviceHub opens and drives for DPI but cannot drive for Polling rate, a pretend person who changes
// Polling rate when asked (and once is asked for the value the app already shows), a pretend listener that records what
// the app sends. Checked: the driver saved with both settings and the app's DPI range, nothing ever sent to the device
// by DeviceHub, the person's change noticed without a Done, the app closed and settings turned on at the end; then the
// ways it stops (app not installed, refused vendor, Windows' prompt declined, a setting never changed, Stop).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lw from '../helpers/learn-wizard.mjs';
import * as auto from '../helpers/learn-auto.mjs';
import { Rec, pad } from './lib/usb-recording.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const DEV = 3;
const POLL = { '125 Hz': 8, '250 Hz': 4, '500 Hz': 2, '1000 Hz': 1 };

function world({ appInstalled = true, appStarts = true, uiPolling = false, vid = '2A0B', pollAlready = false, web = false } = {}) {
  const w = { dpi: 400, poll: 8, appRunning: false, rec: null, files: new Map(), state: null, deviceSent: [], closed: 0, turnedOn: 0, clock: 0, asks: [], prompt: true };
  // the device: answers what the app sends
  w.handle = (q) => {
    if (q[0] !== 5) return null;
    if (q[1] === 0x81) return pad([5, 0x81, 0, w.dpi & 255, w.dpi >> 8], 16);
    if (q[1] === 0x01) { w.dpi = q[3] | (q[4] << 8); return pad([5, 0x01], 16); }
    if (q[1] === 0x82) return pad([5, 0x82, 0, w.poll], 16);
    if (q[1] === 0x02) { w.poll = q[3]; return pad([5, 0x02], 16); }
    if (q[1] === 0x90) return pad([5, 0x90, 0, 77], 16);
    return null;
  };
  // the maker's app talking to the device (recorded when the listener records)
  w.talk = (q) => { const a = w.handle(q); if (w.rec) { w.rec.out(DEV, q); if (a) w.rec.inp(DEV, a); } };
  w.appSet = (label, v) => {
    if (label === 'DPI') { w.talk(pad([5, 0x81], 16)); w.talk(pad([5, 0x01, 0, v & 255, v >> 8], 16)); w.talk(pad([5, 0x81], 16)); }
    if (label === 'Polling rate') { w.talk(pad([5, 0x82], 16)); w.talk(pad([5, 0x02, 0, POLL[v]], 16)); w.talk(pad([5, 0x82], 16)); }
  };
  if (pollAlready) w.poll = POLL['1000 Hz'];
  const col = { vid, pid: '0042', iface: 1, col: 1, page: 'FF00', usage: '0001', inLen: 16, outLen: 16, featLen: 0, inIds: [], outIds: [], featIds: [], product: 'Pretend mouse' };
  const maker = () => (w.openAt != null && w.clock >= w.openAt && (w.appRunning = true), web ? { known: true, key: 'pretend', name: 'Pretend Launcher', page: 'https://launcher.example.invalid/', web: true, installed: false, running: false, window: null }
    : { known: true, key: 'pretend', name: 'Pretend Hub', page: 'https://example.invalid', installed: appInstalled, running: w.appRunning, window: 'Pretend Hub' });
  lw.options.deps = {
    ...lw.deps,
    usbpcapInstalled: () => true,
    listHid: async () => ({ collections: [col] }),
    owned: () => ({ runs: [], mine: [], copies: [] }),
    startCapture: async () => { if (!w.prompt) return { started: false, declined: true, error: 'The operation was canceled by the user.' }; w.state = { seq: 0, status: 'ready', hubs: 2 }; return { started: true }; },
    writeCommand: (dir, text) => {
      const [seq, verb, name] = text.split(' ');
      if (verb === 'start') { w.rec = new Rec(); w.rec.descriptor(DEV, parseInt(vid, 16), 0x42); w.recName = name; w.talk(pad([5, 0x90], 16)); w.state = { seq: Number(seq), status: 'recording', take: name }; }
      if (verb === 'stop') { if (w.rec) w.files.set(w.recName, w.rec.pcap()); w.rec = null; w.state = { seq: Number(seq), status: 'stopped' }; }
      if (verb === 'quit') { w.rec = null; w.state = { seq: Number(seq), status: 'ended' }; }
    },
    readState: () => w.state,
    // a recording still being written: what it holds so far (the app's battery poll keeps coming, as real apps do)
    readTake: (dir, name) => { if (w.rec && w.recName === name) { w.talk(pad([5, 0x90], 16)); return [w.rec.pcap()]; } return w.files.has(name) ? [w.files.get(name)] : []; },
    sleep: async () => {},
    loadNew: async () => [{ name: 'Pretend mouse', id: 'pretend-mouse' }],
    plan: async () => ({ maker: maker(), kind: 'mouse', from: 'files', items: [
      { id: 'dpi', label: 'DPI', kind: 'number', values: [800, 3200], unit: 'DPI', range: null, source: 'files', ticked: true },
      { id: 'pollingrate', label: 'Polling rate', kind: 'choice', values: ['125 Hz', '1000 Hz'], source: 'brand sheet', ticked: true },
      { id: 'readingbattery', label: 'Battery', kind: 'reading', role: 'battery', values: [], source: 'brand sheet', ticked: false }] }),
    // app-ui on the pretend app: DPI is a slider it can read and set; Polling rate is not visible to it (unless uiPolling)
    appUi: async (args) => {
      const [verb] = args, name = args[args.indexOf('-Name') + 1];
      if (!w.appRunning) return { code: 2, out: '' };
      if (name === 'DPI') {
        if (verb === 'get') return { code: 0, out: JSON.stringify({ name: 'DPI', value: String(w.dpi), min: 100, max: 26000, step: 50 }) };
        if (verb === 'set') { const v = Number(args[args.indexOf('-Value') + 1]); const old = w.dpi; w.appSet('DPI', v); return { code: 0, out: `${old} -> ${v} (read back ${v})` }; }
      }
      if (name === 'Polling rate' && uiPolling) return { code: 2, out: '' };
      return { code: 2, out: '' };
    },
  };
  auto.options.deps = {
    openMaker: async () => { if (appStarts) w.openAt = w.clock + 3000; return { opened: appStarts, name: 'Pretend Hub' }; },
    findMaker: async () => maker(),
    openPage: (url) => { w.pageOpened = url; },
    sleep: async (ms) => { w.clock += ms; await new Promise((r) => setImmediate(r)); },
    now: () => w.clock,
    post: async (p, b) => {
      if (p === '/api/diagnose/action' && b.kind === 'close-app' && b.confirm === true) { w.closed++; w.appRunning = false; return { ok: true }; }
      if (p === '/api/agent/turn-on' && b.id === 'pretend-mouse') { w.turnedOn++; return { ran: true, on: true, counts: { checked: 2, passed: 2 } }; }
      throw new Error(`unexpected ${p}`);
    },
    get: async () => ({ devices: [{ id: 'pretend-mouse', status: 'connected' }] }),
  };
  return w;
}
// the pretend person: does what the page asks, a couple of seconds after it is asked (never for a value the app shows)
async function person(w, { never = false } = {}) {
  let seen = null, at = 0, acted = false;
  for (let i = 0; i < 200000; i++) {
    await new Promise((r) => setImmediate(r));
    const s = auto.state();
    if (['done', 'stopped', 'failed', 'idle'].includes(s.phase)) return s;
    const ask = s.ask?.kind === 'change' ? s.ask : null;
    if (!ask) { seen = null; continue; }
    if (seen !== ask) { seen = ask; at = w.clock; acted = false; w.asks.push(ask.line); continue; }
    if (never || acted || w.clock - at < 2500) continue;
    const v = /to (\d+ Hz)/.exec(ask.line)?.[1], dpi = /DPI (?:back )?to (\d+)/.exec(ask.line)?.[1];
    if (v && w.poll !== POLL[v]) w.appSet('Polling rate', v);
    if (dpi && w.dpi !== Number(dpi)) w.appSet('DPI', Number(dpi));
    acted = true;
  }
  return auto.state();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learn-auto-'));
lw.options.root = root;
lw.options.preflight = false;   // the steps after the pre-flight (tests/smoother.mjs checks the pre-flight itself)

// 1. everything: the app opened, DPI driven, Polling rate noticed
{
  lw.reset(); auto.reset();
  const w = world();
  const r = await auto.start({ vid: '2a0b', pid: '0042' });
  check(r.ok, `it starts (${JSON.stringify(r)})`);
  const s = await person(w);
  check(s.phase === 'done', `it ends done (${s.phase}: ${JSON.stringify(s.error)} ${JSON.stringify(s.items)})`);
  check(s.items.every((x) => x.status === 'learned'), `both settings learned (${JSON.stringify(s.items)})`);
  check(s.steps.some((x) => /Opening Pretend Hub/.test(x.text)) && s.steps.some((x) => /Pretend Hub is open/.test(x.text)), `the closed app was opened (${s.steps.map((x) => x.text).join(' | ')})`);
  check(w.asks.length === 2 && w.asks.every((a) => /Polling rate/.test(a)) && !w.asks.some((a) => /DPI/.test(a)), `only Polling rate was asked of the person, twice (${w.asks.join(' | ')})`);
  check(w.dpi === 400, `DPI was put back as it was (${w.dpi})`);
  const dir = path.join(root, 'my-devices');
  const folder = fs.readdirSync(dir).find((f) => fs.existsSync(path.join(dir, f, 'driver.json')));
  const def = folder ? JSON.parse(fs.readFileSync(path.join(dir, folder, 'driver.json'), 'utf8')) : null;
  const dpi = def?.settings.find((x) => x.label === 'DPI'), poll = def?.settings.find((x) => x.label === 'Polling rate');
  check(dpi && dpi.type === 'slider' && dpi.min === 100 && dpi.max === 26000 && dpi.step === 50, `DPI saved with the app's own range (${JSON.stringify(dpi)})`);
  check(poll && poll.type === 'choice' && poll.options.length === 2, `Polling rate saved as a choice (${JSON.stringify(poll)})`);
  check(s.result?.appOpen && s.result.app === 'Pretend Hub' && s.result.learned.length === 2, `the result says the app is open (${JSON.stringify(s.result)})`);
  check(s.result.leftAt.some((x) => x.label === 'Polling rate'), 'the result says where Polling rate was left');
  const f = await auto.finish();
  check(f.ok && f.ran && w.closed === 1 && w.turnedOn === 1, `finish closes the app and turns settings on (${JSON.stringify(f)})`);
}

// 2. the app already shows the first value asked for: nothing happens, so it asks the other way round
{
  lw.reset(); auto.reset();
  const w = world({ pollAlready: true });
  w.appRunning = true;
  await auto.start({ vid: '2A0B', pid: '0042' });
  // the person never sets 1000 Hz (it shows that already); the asks name it first
  const s = await person(w);
  check(s.phase === 'done' && s.items.find((x) => x.label === 'Polling rate')?.status === 'learned', `swapped once, then learned (${JSON.stringify(s.items)} ${w.asks.join(' | ')})`);
  check(w.asks.length === 3 && /to 1000 Hz/.test(w.asks[0]) && /to 125 Hz/.test(w.asks[1]) && /back to 1000 Hz/.test(w.asks[2]), `the asks: 1000, then 125 and back to 1000 (${w.asks.join(' | ')})`);
  check(w.poll === POLL['1000 Hz'], 'Polling rate ends where it was');
}

// 2b. a web configurator: its page opened in the browser, every setting asked of the person and noticed
{
  lw.reset(); auto.reset();
  const w = world({ web: true });
  await auto.start({ vid: '2A0B', pid: '0042' });
  const s = await person(w);
  check(w.pageOpened === 'https://launcher.example.invalid/' && s.phase === 'done' && s.items.every((x) => x.status === 'learned'), `a web app: page opened, both learned (${s.phase} ${JSON.stringify(s.items)} ${JSON.stringify(s.error)})`);
  check(w.asks.some((a) => /DPI/.test(a) && /in your browser/.test(a)), `the asks say it is in the browser (${w.asks.join(' | ')})`);
}

// 3. the ways it stops, each with what to do next
const stops = [
  ['app not installed', { appInstalled: false }, /not installed/, /Install it from https:\/\/example\.invalid/],
  ['refused vendor', { vid: '258A' }, /./, /Request support/],
  ['prompt declined', { prompt: false }, /declined|not listening/i, /press Yes/],
];
for (const [what, opts, text, next] of stops) {
  lw.reset(); auto.reset();
  const w = world(opts);
  if (opts.prompt === false) w.prompt = false;
  await auto.start({ vid: opts.vid || '2A0B', pid: '0042' });
  const s = await person(w);
  check(s.phase === 'failed' && text.test(s.error?.text || '') && next.test(s.error?.next || ''), `${what}: stops and says what to do (${JSON.stringify(s.error)})`);
}
// a setting the person never changes: skipped after the wait, the rest still saved
{
  lw.reset(); auto.reset();
  const w = world();
  await auto.start({ vid: '2A0B', pid: '0042' });
  const s = await person(w, { never: true });
  const pr = s.items.find((x) => x.label === 'Polling rate');
  check(s.phase === 'done' && pr?.status === 'skipped' && /did not notice|not changed/.test(pr.why || '') && s.result?.learned.includes('DPI'), `a setting never changed is skipped, DPI still saved (${JSON.stringify(s.items)})`);
}
// Stop while asking
{
  lw.reset(); auto.reset();
  const w = world();
  await auto.start({ vid: '2A0B', pid: '0042' });
  for (let i = 0; i < 100000 && auto.state().ask?.kind !== 'change'; i++) await new Promise((r) => setImmediate(r));
  let out = null;
  await auto.handle(new URL('http://x/api/learn/auto/stop'), { method: 'POST' }, {}, (res, code, j) => { out = j; }, async () => ({}));
  const s = await person(w, { never: true });
  check(out?.ok && s.phase === 'stopped' && !lw.current(), `Stop ends it and the wizard's session (${s.phase})`);
}
// the change detector: battery polls and lighting frames are not a change; a new command or a moved byte is
{
  const m = (data) => ({ dir: 'out', type: 'output', reportId: 0, data });
  const base = auto.baselineOf([m([5, 0x90, 0]), m([5, 0x90, 0]), m([0x30, 0, 10, 20]), m([0x30, 0, 50, 60])]);
  check(auto.novel(base, [m([5, 0x90, 0]), m([0x30, 0, 99, 1])]).length === 0, 'polls and lighting frames are not a change');
  check(auto.novel(base, [m([5, 0x02, 0, 8])]).length === 1, 'a new command is a change');
  check(auto.novel(base, [m([5, 0x90, 7])]).length === 1, 'a known command with a byte that never moved is a change');
}

fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log(`learn-auto: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('learn-auto (Learn it for me: app opened and driven, a change noticed without Done, the order swapped once, saved, closed and turned on; each stop says what to do): all good');
