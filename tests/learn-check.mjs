// Test my learning setup (helpers/learn-wizard.mjs checkSetup, 23 Oct 2026) with a pretend listener: every step passing,
// then each way it can fail, each answer naming what to do; nothing is ever written to a device, and the folder goes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lw from '../helpers/learn-wizard.mjs';
import { Rec, pad } from './lib/usb-recording.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learn-check-'));
lw.options.root = root;

// a recording of two plugged-in devices, the mouse moving
const rec = new Rec();
rec.descriptor(3, 0x1234, 0x5678); rec.descriptor(4, 0x046d, 0xc52b);
for (let i = 0; i < 5; i++) rec.inp(3, pad([1, 0, i, 0xff - i], 8));
const PCAP = rec.pcap();

// the listener (helpers/learn-capture.ps1) as the wizard sees it: state.json answers command.txt
function pretend({ installed = true, start = { started: true }, ready = { status: 'ready', hubs: 3 }, records = true, stops = true, file = PCAP } = {}) {
  const seen = { commands: [], sent: 0, dirs: [] };
  const state = new Map();
  lw.options.deps = {
    usbpcapInstalled: () => installed,
    startCapture: async (dir) => { seen.dirs.push(dir); if (start.started && ready) state.set(dir, { seq: 0, ...ready }); return start; },
    writeCommand(dir, text) {
      seen.commands.push(text);
      const [n, verb, name] = text.split(' ');
      const seq = Number(n);
      if (verb === 'start') state.set(dir, records ? { seq, status: 'recording', take: name } : { seq, status: 'error', error: 'USBPcap did not start recording (restart the PC once after installing it)' });
      if (verb === 'stop') {
        if (stops) { if (file) fs.writeFileSync(path.join(dir, 'check-1.pcap'), file); state.set(dir, { seq, status: 'stopped' }); }
      }
      if (verb === 'quit') state.set(dir, { seq, status: 'ended' });
    },
    readState: (dir) => state.get(dir) || null,
    readTake: lw.deps.readTake,
    sleep: async () => {},
    // anything that would reach a device fails the test
    appUi: async () => { seen.sent++; return { code: 1, out: '' }; },
  };
  return seen;
}
const left = () => fs.existsSync(path.join(root, 'learn', 'wizard')) ? fs.readdirSync(path.join(root, 'learn', 'wizard')) : [];
const say = (r) => r.steps.map((s) => `${s.ok ? '+' : '-'} ${s.says}${s.fix ? ` ${s.fix}` : ''}`).join(' | ');

// everything works, with the picked device found and heard
let seen = pretend();
let r = await lw.checkSetup({ vid: '1234', pid: '5678' });
check(r.ok && r.steps.map((s) => s.id).join() === 'usbpcap,prompt,ready,record,stop,read,devices,device', `all steps pass (${say(r)})`);
check(/3 USB hubs/.test(say(r)) && /2 USB devices/.test(say(r)) && /heard 5 messages/.test(say(r)), `it says what it found (${say(r)})`);
check(seen.commands.some((c) => / quit$/.test(c)) && !left().length && !seen.sent, 'the listener is told to quit, its folder is gone, nothing was sent');

// each failure: the test stops there, and the step says what to do
const cases = [
  ['usbpcap', { installed: false }, /Optional tools/],
  ['prompt', { start: { started: false, declined: true } }, /press Yes/],
  ['prompt', { start: { started: false, error: 'boom' } }, /Restart DeviceHub/],
  ['ready', { ready: { status: 'error', error: 'USBPcap found no USB hub to listen on: restart the PC once after installing it' } }, /Restart the PC once/],
  ['ready', { ready: null }, /Restart the PC once/],
  ['record', { records: false }, /Restart the PC once/],
  ['stop', { stops: false }, /Test again/],
  ['read', { file: null }, /Test again/],
  ['read', { file: Buffer.from('not a recording at all') }, /Test again/],
  ['devices', { file: (() => { const x = new Rec(); x.inp(3, pad([1], 8)); return x.pcap(); })() }, /plug it back in/],
];
for (const [id, opts, fix] of cases) {
  seen = pretend(opts);
  r = await lw.checkSetup();
  const last = r.steps[r.steps.length - 1];
  check(!r.ok && last.id === id && !last.ok && fix.test(last.fix || ''), `${id} fails with its fix (${JSON.stringify(opts).slice(0, 80)}: ${say(r)})`);
  check(r.steps.slice(0, -1).every((s) => s.ok), `${id}: the steps before it passed`);
  check(!left().length && !seen.sent, `${id}: the folder is gone and nothing was sent`);
}

// the picked device not in the recording
pretend();
r = await lw.checkSetup({ vid: '9999', pid: '0001' });
check(!r.ok && r.steps.at(-1).id === 'device' && /plug it back in/.test(r.steps.at(-1).fix), `a device not found says to replug it (${say(r)})`);

// over the route: POST /api/learn/check
pretend();
let body = null;
await lw.handle(new URL('http://x/api/learn/check'), { method: 'POST' }, { }, (res, code, b) => { body = { code, ...b }; }, async () => ({}));
check(body?.code === 200 && body.ok && body.steps.length === 7, `POST /api/learn/check answers (${JSON.stringify(body).slice(0, 120)})`);

fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log(`learn-check: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log(`learn-check (Test my learning setup, pretend listener: all pass, ${cases.length + 1} failures each with its fix, nothing sent): all good`);
