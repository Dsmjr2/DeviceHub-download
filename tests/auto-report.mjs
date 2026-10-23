// Automatic problem reports (22 Oct 2026; helpers/auto-report.mjs): the triggers fire, ordinary states never do, one
// report per problem per day, anything personal taken out, a refused report not sent, the off switch, the owner's PC
// never sends (this repository included), no config = no send, and every payload passes the relay's own check.
// A stand-in relay and a pretend DeviceHub folder in TEMP: no network, no device, DeviceHub need not run.
// Run: node tests/auto-report.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReport } from '../relay/worker.js';
import * as ar from '../helpers/auto-report.mjs';
import { findPersonal } from '../helpers/get-help.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['zorblax', 'QUUXPC-7'];
const URL_OK = 'https://devicehub-relay.dsmjr2.workers.dev/report';

function folder({ config = true, origin = null, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-autoreport-'));
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
  fs.mkdirSync(path.join(root, 'helpers'));
  if (config) fs.writeFileSync(path.join(root, 'helpers', 'report-config.json'), JSON.stringify(typeof config === 'string' ? { relayUrl: config } : { relayUrl: URL_OK }));
  if (origin) { fs.mkdirSync(path.join(root, '.git')); fs.writeFileSync(path.join(root, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`); }
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings));
  return root;
}
const readSettings = (root) => JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));

// the pretend DeviceHub: two devices, a log with personal bits in it
const STATE = { devices: [
  { id: 'acme-mouse', status: 'error', error: 'HID read failed (code 31) on C:\\Users\\zorblax\\x', adapter: { id: 'acme-mouse', title: 'Acme Glide', kind: 'Mouse' }, info: { Firmware: '1.2', 'Serial number': 'SN0001' } },
  { id: 'keyboard', status: 'connected', adapter: { id: 'keyboard', title: 'Epomaker P75', kind: 'Keyboard' }, info: {} },
] };
const LOG = [
  'DeviceHub on http://localhost:5577',
  '[acme-mouse] read failed on HID\\VID_1234&PID_ABCD\\8&aaaa&0&0000 for zorblax',
  '[helper] could not be built: csc.exe not found under C:\\Users\\zorblax\\AppData',
  'Error: keyboard reports brightness=253 after writing 243 (mail zorb@gmail.com)',
];
let findings = [{ code: 'error', problem: 'The mouse reports an error', why: 'HID read failed (code 31).', fix: 'Unplug it and plug it back in.' }];
const deps = { state: async () => STATE, version: async () => 'abc123', windows: async () => 'Windows 11 23H2 (build 22631)', diagnose: async () => ({ findings }), usb: async () => [], log: async () => LOG, bluetooth: async () => [], specs: [] };

// the stand-in relay
let calls = [], answer = 202;
const relay = async (url, o) => {
  calls.push({ url, o, payload: JSON.parse(o.body) });
  if (answer === 'throw') throw new Error('no network');
  return new Response('{}', { status: typeof answer === 'function' ? answer() : answer });
};
const fresh = (root, extra = {}) => { calls = []; answer = 202; ar._episodes.clear(); ar.start({ root, fetch: relay, gatherDeps: deps, names: NAMES, owner: false, retryMs: [0, 0], log: () => {}, now: () => Date.now(), ...extra }); };

try {
  // ---- nothing before start
  ar.stop();
  ok((await ar.report({ code: 'helper-build', where: 'helper', area: 'Device helper', problem: 'x' })).sent === false, 'nothing sent before start()');

  // ---- the helper could not be built: one report, the relay's shape, nothing personal
  let root = folder();
  fresh(root);
  ar.helperProblem('helper-build', 'could not be built: C:\\Users\\zorblax\\DeviceHub\\helpers\\native\\build.ps1 exited 1');
  await ar.settle();
  ok(calls.length === 1, `helper build failure sends one report (${calls.length})`);
  const p = calls[0]?.payload || {};
  ok(checkReport(p) === null, `payload passes relay/worker.js checkReport (${checkReport(p)})`);
  ok(ar.validPayload(p), 'payload passes the local check too');
  ok(calls[0]?.url === URL_OK && calls[0]?.o.method === 'POST' && calls[0]?.o.redirect === 'error' && calls[0]?.o.signal, 'POST to the relay, no redirects, with a timeout');
  ok(p.title === 'Device helper: could not be built', `title "<area>: <problem>" (${p.title})`);
  ok(p.fingerprint === 'helper-build:helper', `fingerprint = code + where (${p.fingerprint})`);
  ok(/^[a-f0-9]{32}$/.test(p.install) && readSettings(root).reportInstall === p.install, 'a random 32-hex install id, kept in settings.json');
  ok(!new RegExp(os.hostname(), 'i').test(p.install), 'the install id is not the PC name');
  ok(!/zorblax|QUUXPC|gmail|aaaa&0/i.test(JSON.stringify(p)), `nothing personal in it:\n${p.body}`);
  ok(findPersonal(`${p.title}\n${p.body}`, NAMES).length === 0, "the payload passes get-help's personal-data check");
  ok(/^\*\*What went wrong:\*\* could not be built: %USERPROFILE%/.test(p.body) && !/write it here|pressed Submit/.test(p.body), 'the first line says what went wrong; no Get help wording for a person');
  ok(/### This PC/.test(p.body) && /Sent by DeviceHub by itself/.test(p.body), "the body is Get help's report");

  // ---- once a day per problem
  ar.helperProblem('helper-build', 'again');
  await ar.settle();
  ok(calls.length === 1, 'the same problem again today: not sent again');
  ar._episodes.clear();
  ar.helperProblem('helper-start', 'could not start: spawn EACCES');
  await ar.settle();
  ok(calls.length === 2 && calls[1].payload.fingerprint === 'helper-start:helper', 'another problem the same day: sent');
  const st = JSON.parse(fs.readFileSync(path.join(root, 'auto-report-state.json'), 'utf8'));
  ok(Object.keys(st.sent).length === 2, 'the sends of today are remembered on disk');
  ok(ar.helperProblem('not-a-problem', 'x') === null, 'an unknown helper code is ignored');

  // ---- a device in an error for over 10 minutes
  root = folder(); fresh(root);
  let t = 1e12;
  const dev = (status, error) => [{ id: 'acme-mouse', status, error, adapter: { title: 'Acme Glide' } }];
  ok(ar.checkDevices(dev('error', 'HID read failed (code 31)'), t).length === 0, 'an error just now: nothing');
  ok(ar.checkDevices(dev('connecting', null), t + 30e3).length === 0, 'a retry (connecting) keeps the clock');
  ok(ar.checkDevices(dev('error', 'HID read failed (code 31)'), t + 9 * 60e3).length === 0, 'nine minutes: nothing');
  ok(ar.checkDevices(dev('error', 'HID read failed (code 31)'), t + 10.5 * 60e3).length === 1, 'over ten minutes: reported');
  await ar.settle();
  ok(calls.length === 1 && calls[0].payload.fingerprint === 'device-error:acme-mouse' && calls[0].payload.title === 'Acme Glide: in an error for over 10 minutes', `device error report (${calls[0]?.payload.title})`);
  ok(checkReport(calls[0]?.payload) === null, 'device report passes the relay check');
  ok(/### The device/.test(calls[0]?.payload.body) && !/zorblax|SN0001/.test(calls[0]?.payload.body), 'the device report is about the device, stripped');
  ok(ar.checkDevices(dev('error', 'HID read failed (code 31)'), t + 30 * 60e3).length === 0, 'one report per episode');
  ar.checkDevices(dev('connected', null), t + 31 * 60e3);
  ok(!ar._episodes.has('acme-mouse'), 'connected again ends the episode');

  // ---- never: asleep, off, unplugged, the maker's app, battery, waiting
  root = folder(); fresh(root);
  t = 2e12;
  const never = [['asleep', 'mouse is asleep'], ['missing', null], ['idle', null], ['connected', null], ['error', 'The mouse is asleep or switched off'], ['error', 'Pulsar.exe (the maker\'s app) is running: close it first'],
    ['error', 'iCUE is open: it runs the headset lights while it is'], ['error', 'the headset did not answer: is it on?'], ['error', 'Acme Glide was unplugged'], ['error', 'out of range'], ['error', 'battery is low (5%)'], ['error', 'open failed: sharing violation'], ['error', 'waiting for Turn on settings']];
  for (const [status, error] of never) {
    ar._episodes.clear();
    ar.checkDevices(dev(status, error), t);
    const n = ar.checkDevices(dev(status, error), t + 60 * 60e3).length;
    ok(n === 0, `never reported: ${status} ${error || ''}`);
  }
  // 22 Oct 2026 (Dsmjr2/DeviceHub-support#2): a driver that found a device that is not its own and stepped aside, or a
  // receiver whose mouse sleeps, is never a fault: the report's own wording, the new wordings, and a stepped-aside
  // adapter (a.notMine) whatever its status and error say
  const aside = [['error', 'this Logitech device has no DPI feature (0x2201): it is not a mouse this driver runs'],
    ['error', 'the Logitech device on receiver C539 (slot 1) is a keyboard, not a mouse this driver runs: the mouse driver leaves it alone'],
    ['error', 'the Logitech device on receiver C545 (slot 1) has a DPI feature (0x2201): it is a mouse, not a keyboard this driver runs, so the keyboard driver leaves it to the mouse driver'],
    ['error', 'the mouse is asleep or switched off: no device on receiver C539 answered (move it or switch it on)'], ['asleep', 'the mouse is asleep or switched off']];
  for (const [status, error] of aside) {
    ar._episodes.clear();
    ar.checkDevices(dev(status, error), t);
    ok(ar.checkDevices(dev(status, error), t + 60 * 60e3).length === 0, `never reported: ${error}`);
  }
  const stepped = (status, error) => [{ id: 'logitech-hidpp-mouse', status, error, adapter: { title: 'Logitech mouse', notMine: { why: 'x', at: t } } }];
  ar._episodes.clear();
  ar.checkDevices(stepped('error', 'HID read failed (code 31)'), t);
  ok(ar.checkDevices(stepped('error', 'HID read failed (code 31)'), t + 60 * 60e3).length === 0 && !ar._episodes.has('logitech-hidpp-mouse'), 'a stepped-aside driver never starts an episode');
  await ar.settle();
  ok(calls.length === 0, `no ordinary state sent anything (${calls.length})`);
  // diagnose's not-mine finding is ordinary too
  findings = [{ code: 'not-mine', problem: 'What is on its receiver is not a mouse this driver runs', why: 'x', fix: 'Nothing.' }];
  ar._episodes.clear();
  ar.checkDevices(dev('error', 'HID read failed (code 31)'), t);
  ar.checkDevices(dev('error', 'HID read failed (code 31)'), t + 11 * 60e3);
  await ar.settle();
  ok(calls.length === 0, 'diagnose finding a stepped-aside driver: not sent');
  // a fault, but diagnose finds the maker's app: an ordinary state after all
  findings = [{ code: 'maker-app', problem: 'Acme Hub is running', why: 'x', fix: 'Close it.' }];
  ar._episodes.clear();
  ar.checkDevices(dev('error', 'HID read failed (code 31)'), t);
  ar.checkDevices(dev('error', 'HID read failed (code 31)'), t + 11 * 60e3);
  await ar.settle();
  ok(calls.length === 0, 'diagnose finding the maker\'s app: not sent');
  findings = [{ code: 'error', problem: 'The mouse reports an error', why: 'HID read failed (code 31).', fix: 'Unplug it.' }];

  // ---- a write whose read-back did not match
  root = folder(); fresh(root);
  ar.noteActivity({ kind: 'bad', device: 'keyboard', text: 'Brightness not changed: keyboard reports brightness=253 after writing 243' }, 'Epomaker P75');
  await ar.settle();
  ok(calls.length === 1 && calls[0].payload.fingerprint === 'write-check:keyboard' && calls[0].payload.title === 'Epomaker P75: a change did not read back', `read-back failure reported (${calls[0]?.payload.title})`);
  for (const e of [{ kind: 'good', device: 'keyboard', text: 'Brightness → 243' }, { kind: 'bad', device: 'mouse', text: 'DPI not changed: Pulsar X2 is not connected' }, { kind: 'bad', device: 'mouse', text: 'DPI not changed: the mouse is asleep (after writing 800)' },
    { kind: 'bad', device: 'acme', text: 'Acme: library self-check: 1 of 2 settings wrote and read back; 1 now read-only: Light (wrote 1, read back 0)' }, { kind: 'bad', text: 'no device: reads 1 after writing 2' }])
    ok(ar.noteActivity(e, 'X') === null, `not a read-back fault: ${e.text}`);

  // ---- a library driver's self-check failed (waiting only: not)
  root = folder(); fresh(root);
  ok(ar.selfCheckResult({ id: 'acme-mouse', title: 'Acme Glide' }, { ran: true, counts: { passed: 2, checked: 3, waiting: 1, failed: 0 }, keys: {} }) === null, 'a self-check with only waiting settings: not reported');
  ok(ar.selfCheckResult({ id: 'acme-mouse', title: 'Acme Glide' }, { ran: false, waiting: true, why: "the maker's app is open" }) === null, 'a self-check that did not run: not reported');
  ar.selfCheckResult({ id: 'acme-mouse', title: 'Acme Glide' }, { ran: true, counts: { passed: 1, checked: 2, waiting: 0, failed: 1 }, keys: { light: { ok: false, value: 1, readBack: 0, why: 'wrote 1, read back 0' }, dpi: { ok: true } } });
  await ar.settle();
  ok(calls.length === 1 && calls[0].payload.fingerprint === 'self-check:acme-mouse' && /light: wrote 1, read back 0/.test(calls[0].payload.body), 'a failed self-check is reported with the failing setting');

  // ---- a crash: the launcher's line before this run's start, once
  root = folder(); fresh(root);
  const lines = ['DeviceHub on http://localhost:5577', 'TypeError: x is not a function', '    at C:\\Users\\zorblax\\DeviceHub\\server.js:10:5', '[launcher] 10/22/2026 14:03:11 server exited with code 1; restart 1 of 5', 'DeviceHub on http://localhost:5577'];
  ok(ar.crashBefore(lines)?.code === 1, 'a crash before this start is found');
  ok(ar.crashBefore(['DeviceHub on http://localhost:5577', '[launcher] 10/22/2026 14:03:11 server exited with code -1; restart 1 of 5', 'DeviceHub on http://localhost:5577']) === null, 'code -1 (stopped from outside) is not a crash');
  // support issue 3 (22 Oct 2026): Windows closing DeviceHub at sign-out, shutdown or a closed console is not a crash
  ok(ar.crashBefore(['DeviceHub on http://localhost:5577', '[launcher] 10/22/2026 19:44:45 server exited with code 1073807364; restart 1 of 5', 'DeviceHub on http://localhost:5577']) === null, 'code 1073807364 (0x40010004, Windows closed the console) is not a crash');
  ok(ar.crashBefore(['DeviceHub on http://localhost:5577', '[launcher] 10/22/2026 19:44:45 server exited with code -1073741510; restart 1 of 5', 'DeviceHub on http://localhost:5577']) === null, 'code -1073741510 (0xC000013A, Ctrl+C) is not a crash');
  ok(ar.crashBefore(['DeviceHub on http://localhost:5577', '[launcher] 10/22/2026 20:01:15 server exited with code 1; restart 1 of 5', 'DeviceHub on http://localhost:5577'])?.code === 1, 'code 1 still is');
  ok(ar.crashBefore(['[launcher] 10/22/2026 14:03:11 server exited with code 1; restart 1 of 5', 'DeviceHub on http://localhost:5577', 'DeviceHub on http://localhost:5577']) === null, 'an older crash (before the previous start) is not this start\'s');
  ar.checkCrash(lines);
  await ar.settle();
  ok(calls.length === 1 && calls[0].payload.title === 'DeviceHub: stopped unexpectedly and was restarted' && calls[0].payload.fingerprint === 'server-exit:server', `crash reported (${calls[0]?.payload.title})`);
  ok(ar.checkCrash(lines) === null, 'the same crash line is never reported twice');

  // ---- refused: something personal that cannot be taken out -> nothing sent
  root = folder(); fresh(root, { names: ['zorblax', 'name'] });   // zorblax becomes <name>, which the name 'name' still matches
  const r = await ar.report({ code: 'agent-start', where: 'agent', area: 'DeviceHub', problem: 'its background part did not start', detail: 'x' });
  ok(r.sent === false && calls.length === 0, `a report Get help refuses is not sent (${r.why})`);
  // the final check: a flagged line is dropped; a flagged title or a body still flagged refuses
  let fc = ar.finalCheck(findPersonal, 'DeviceHub: x', 'line one is fine\nserial: AB12CD34\nline three is fine', NAMES);
  ok(fc.ok && fc.dropped === 1 && !/AB12CD34/.test(fc.body), 'a flagged line is dropped from the final body');
  fc = ar.finalCheck(findPersonal, 'zorblax: x', 'a fine body here', NAMES);
  ok(!fc.ok, 'a flagged title refuses');

  // ---- the off switch, no config, a bad config
  root = folder({ settings: { autoReport: false } }); fresh(root);
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 0, 'switched off in Settings: nothing sent');
  root = folder({ config: false }); fresh(root);
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 0, 'no helpers/report-config.json: nothing sent');
  for (const bad of ['http://devicehub-relay.dsmjr2.workers.dev/report', 'https://evil.example/report', 'https://devicehub-relay.dsmjr2.workers.dev.evil.example/report', 'https://devicehub-relay.dsmjr2.workers.dev:8443/report', 'https://x@devicehub-relay.dsmjr2.workers.dev/report']) {
    root = folder({ config: bad }); fresh(root);
    ar.helperProblem('helper-build', 'x'); await ar.settle();
    ok(calls.length === 0, `not HTTPS to the one relay host: nothing sent (${bad})`);
  }
  root = folder(); fresh(root);
  ok((await ar.status()).active === true, 'status: active on a friend\'s PC with the relay set up');

  // ---- the owner's own PC never sends
  for (const [what, opts] of [['origin Dsmjr2/DeviceHub (https)', { origin: 'https://github.com/Dsmjr2/DeviceHub.git' }], ['origin Dsmjr2/DeviceHub (ssh)', { origin: 'git@github.com:Dsmjr2/DeviceHub.git' }], ['settings.json ownerPc', { settings: { ownerPc: true } }]]) {
    root = folder(opts); fresh(root, { owner: null });
    ok(await ar.isOwnerPc(root), `owner detected: ${what}`);
    ar.helperProblem('helper-build', 'x'); await ar.settle();
    ok(calls.length === 0, `the owner's PC sends nothing: ${what}`);
  }
  for (const [what, opts] of [['the public download repository', { origin: 'https://github.com/Dsmjr2/DeviceHub-download.git' }], ['no git (the installer zip)', {}]]) {
    root = folder(opts); fresh(root, { owner: null });
    ok(!(await ar.isOwnerPc(root)), `a friend's copy is not the owner's: ${what}`);
  }
  // a git folder whose config cannot be read: counted as the owner's (a doubt never sends)
  root = folder(); fs.mkdirSync(path.join(root, '.git')); fresh(root, { owner: null });
  ok(await ar.isOwnerPc(root), 'a git folder with no readable config counts as the owner\'s');

  // ---- THIS repository (Shawn's PC): detected as the owner's, and nothing is sent from it
  let realOrigin = null;
  try { realOrigin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REAL, windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim(); } catch {}
  if (realOrigin && ar.OWNER_ORIGIN.test(realOrigin)) {
    fresh(REAL, { owner: null, gatherDeps: deps });
    ok(await ar.isOwnerPc(REAL), `this repository (${realOrigin}) is detected as the owner's PC`);
    ok((await ar.status()).active === false, 'status: not active here');
    const before = fs.existsSync(path.join(REAL, 'auto-report-state.json')) ? fs.readFileSync(path.join(REAL, 'auto-report-state.json'), 'utf8') : null;
    const sr = await ar.report({ code: 'helper-build', where: 'helper', area: 'Device helper', problem: 'could not be built', detail: 'x' });
    ok(sr.sent === false && calls.length === 0 && /owner/.test(sr.why), `this repository sends nothing (${sr.why})`);
    const after = fs.existsSync(path.join(REAL, 'auto-report-state.json')) ? fs.readFileSync(path.join(REAL, 'auto-report-state.json'), 'utf8') : null;
    ok(before === after, 'and writes nothing here');
  } else console.log(`auto-report: this copy's origin is ${realOrigin || 'none'}, not the owner's repository; the owner check on it is skipped`);

  // ---- a failed send: tried again twice, then dropped; a refusal (4xx) is not tried again
  root = folder(); fresh(root); answer = 'throw';
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 3, `no network: tried 3 times in all (${calls.length})`);
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 3, 'then dropped for today');
  root = folder(); fresh(root); answer = 503;
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 3, `relay 503: tried 3 times (${calls.length})`);
  root = folder(); fresh(root); answer = 429;
  ar.helperProblem('helper-build', 'x'); await ar.settle();
  ok(calls.length === 1, `relay 429: not tried again (${calls.length})`);
  root = folder(); fresh(root); let n = 0; answer = () => (++n === 1 ? 500 : 202);
  const rr = await ar.helperProblem('helper-build', 'x');
  ok(calls.length === 2 && rr.sent === true, 'a second try that works counts as sent');

  // ---- every payload this test made passes the relay
  ok(ar.validPayload({ v: 1, install: 'a'.repeat(32), fingerprint: 'x:y', version: '1', title: 'abc', body: '0123456789' }) && !ar.validPayload({ v: 1, install: 'a'.repeat(32), fingerprint: 'x:y', version: '1', title: 'abc', body: '0123456789', pc: 'x' }), 'the local shape check matches the relay (extra fields refused)');
} catch (e) { fails.push(`threw: ${e.stack}`); }

ar.stop();
console.log(fails.length ? `auto-report: FAILED:\n- ${fails.join('\n- ')}` : 'auto-report (stand-in relay, no network): all good');
process.exit(fails.length ? 1 : 0);
