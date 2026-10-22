// Request support in one click (22 Oct 2026; helpers/support-request.mjs, docs/handoff/support-request.md): one click
// sends one request through the relay, the owner's PC sends nothing, a second click the same day sends nothing new,
// anything personal is taken out, the payload passes the relay's own checkReport, no relay / reports off / the owner's
// PC fall back to the GitHub request, and a generic 2.4G receiver gets its one plain line (and Request support).
// A stand-in relay and a pretend DeviceHub folder in TEMP: no network, no device, DeviceHub need not run.
// Run: node tests/support-request.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReport } from '../relay/worker.js';
import * as ar from '../helpers/auto-report.mjs';
import * as sr from '../helpers/support-request.mjs';
import { findPersonal, handle } from '../helpers/get-help.mjs';
import { genericDongle, dongleLine } from '../public/core/generic-dongle.js';
import { summary } from '../helpers/auto-setup.mjs';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); };
const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['zorblax', 'QUUXPC-7'];
const URL_OK = 'https://devicehub-relay.dsmjr2.workers.dev/report';

function folder({ config = true, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-support-'));
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
  fs.mkdirSync(path.join(root, 'helpers'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.copyFileSync(path.join(REAL, 'docs', 'brands.json'), path.join(root, 'docs', 'brands.json'));
  if (config) fs.writeFileSync(path.join(root, 'helpers', 'report-config.json'), JSON.stringify({ relayUrl: URL_OK }));
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings));
  return root;
}

// Windows' HID list as learn-hid-list.ps1 prints it: a mouse receiver with a personal product string, and another device
const col = (o) => ({ vid: '258A', pid: '1007', iface: 0, col: 0, page: '0001', usage: '0002', inLen: 8, outLen: 0, featLen: 0, inIds: [], outIds: [], featIds: [], product: '2.4G Wireless Receiver', ...o });
let hidCalls = 0;
const HID = { collections: [col({}), col({ iface: 1, col: 1, page: 'FF02', usage: '0002', inLen: 17, outLen: 17, featLen: 65, inIds: [8], outIds: [8], featIds: [9] }), col({ vid: '1234', pid: '5678', product: 'Other' })] };
sr.options.listHid = async () => { hidCalls++; return HID; };
sr.options.windows = async () => 'Windows 11 23H2 (build 22631)';
// a pretend Program Files with Glorious CORE in it (vendor-files APPS: install folder ProgramFiles\Glorious Core or similar)
const pf = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-support-pf-'));
const vf = await import('../helpers/vendor-files.mjs');
const glorious = vf.APPS.find((a) => a.id === 'glorious-core');
const gInstall = (glorious?.install || []).find((r) => !r.match);
if (gInstall) fs.mkdirSync(path.join(pf, gInstall.path), { recursive: true });
sr.options.env = { [gInstall?.base || 'ProgramFiles']: pf };

let calls = [], answer = 202;
const relay = async (url, o) => {
  calls.push({ url, o, payload: JSON.parse(o.body) });
  if (answer === 'throw') throw new Error('no network');
  return new Response('{}', { status: answer });
};
const fresh = (root, extra = {}) => { calls = []; answer = 202; ar.start({ root, fetch: relay, names: NAMES, owner: false, retryMs: [0, 0], log: () => {}, now: () => Date.now(), ...extra }); };
const ASK = { vid: '258a', pid: '1007', name: "zorblax's 2.4G Receiver on C:\\Users\\zorblax\\x" };

try {
  // ---- not started (isolated mode, tests of other parts): falls back, sends nothing
  ar.stop();
  let root = folder();
  ar.options.root = root;
  let r = await sr.send(ASK);
  ok(r.fallback && calls.length === 0, `not started: falls back to the GitHub request (${JSON.stringify(r)})`);

  // ---- one click sends one request
  fresh(root);
  r = await sr.send(ASK);
  ok(r.sent === true && r.line === 'Sent to Shawn. When a driver is added, DeviceHub picks it up by itself.', `one click: sent, with the plain line (${JSON.stringify(r)})`);
  ok(calls.length === 1, `one click sends one request (${calls.length})`);
  const p = calls[0]?.payload || {};
  ok(checkReport(p) === null, `the payload passes relay/worker.js checkReport (${checkReport(p)})`);
  ok(ar.validPayload(p), 'the payload passes the local check too');
  ok(calls[0]?.url === URL_OK && calls[0]?.o.method === 'POST' && calls[0]?.o.redirect === 'error', 'POST to the one relay, no redirects');
  ok(p.fingerprint === 'support:258a:1007', `fingerprint support:<vid>:<pid> (${p.fingerprint})`);
  ok(/^Support request: .+ \(258A:1007\)$/.test(p.title), `title "Support request: <name> (<vid>:<pid>)" (${p.title})`);
  ok(!/zorblax|QUUXPC|C:\\Users/i.test(JSON.stringify(p)), `nothing personal in it:\n${p.title}\n${p.body}`);
  ok(findPersonal(`${p.title}\n${p.body}`, NAMES).length === 0, "the payload passes get-help's personal-data check");
  ok(/- USB: 258A:1007/.test(p.body) && /usage page 0001, usage 0002 \(mouse\); report lengths in 8, out 0, feature 0/.test(p.body), `the body has the USB id and each interface's usage page and report lengths:\n${p.body}`);
  ok(/usage page FF02.*maker's own messages.*in 17, out 17, feature 65; report ids in 8; out 8; feature 9/.test(p.body), 'the vendor interface with its report ids');
  ok(!/5678|Other/.test(p.body), "another device's interfaces are not in it");
  ok(/Sinowealth chip/.test(p.body) && p.body.includes(dongleLine('Sinowealth')), 'a generic receiver is named plainly in the request');
  ok(gInstall ? /Maker's app on this PC: Glorious CORE/.test(p.body) : true, "the maker's app when its folder is on this PC");
  ok(/- Windows: Windows 11 23H2/.test(p.body) && /- DeviceHub: /.test(p.body), 'Windows and DeviceHub versions');

  // ---- a second click the same day: the same line, nothing new sent, the HID list not read again
  const before = hidCalls;
  r = await sr.send(ASK);
  ok(r.sent && r.already && calls.length === 1 && hidCalls === before, `a second click the same day sends nothing new (${calls.length} sends)`);
  // another device is its own request
  r = await sr.send({ vid: '1234', pid: '5678', name: 'Acme Pad' });
  ok(r.sent && calls.length === 2 && calls[1].payload.fingerprint === 'support:1234:5678', 'another device sends its own request');
  ok(/not in DeviceHub's brand guide/.test(calls[1].payload.body) && !/Sinowealth/.test(calls[1].payload.body), 'an unknown maker is said so');

  // ---- the next day it can be sent again
  fresh(root, { now: () => Date.now() + 86400e3 });
  r = await sr.send(ASK);
  ok(r.sent && calls.length === 1, 'the next day the same device can send again');

  // ---- the relay cannot be reached: later tries on their own, a plain line now
  root = folder(); fresh(root); answer = 'throw';
  r = await sr.send(ASK);
  ok(r.queued && /tries again/.test(r.line || ''), `no network: a plain "tries again" line (${JSON.stringify(r)})`);
  await ar.settle();
  ok(calls.length === 3, `then two more tries (${calls.length})`);
  answer = 202;
  r = await sr.send(ASK);
  ok(r.sent && calls.length === 4, 'after giving up, a new click can send it');
  // the relay turns it down (4xx): fall back to GitHub
  root = folder(); fresh(root); answer = 400;
  r = await sr.send(ASK);
  ok(r.fallback && calls.length === 1, 'a 4xx from the relay falls back to the GitHub request');

  // ---- the owner's PC never sends
  root = folder(); fresh(root, { owner: null });
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ ownerPc: true }));
  r = await sr.send(ASK);
  ok(r.fallback && calls.length === 0, `the owner's PC (settings ownerPc) sends nothing (${JSON.stringify(r)})`);
  fresh(REAL, { owner: null });
  r = await sr.send(ASK);
  ok(r.fallback && calls.length === 0, 'this repository (the owner\'s git origin) sends nothing');
  ok(!fs.existsSync(path.join(REAL, 'auto-report-state.json')) || !JSON.parse(fs.readFileSync(path.join(REAL, 'auto-report-state.json'), 'utf8')).sent?.['support:258a:1007'], 'nothing written to this repository');

  // ---- reports off, no relay: fall back
  root = folder({ settings: { autoReport: false } }); fresh(root);
  r = await sr.send(ASK);
  ok(r.fallback && calls.length === 0, 'reports switched off: falls back, nothing sent');
  root = folder({ config: false }); fresh(root);
  r = await sr.send(ASK);
  ok(r.fallback && calls.length === 0, 'no relay set up: falls back, nothing sent');

  // ---- still personal after stripping: nothing sent
  root = folder(); fresh(root);
  r = await sr.send({ vid: '258a', pid: '1007', name: 'QUUXPC-7' });
  ok(calls.length === 0 || !/QUUXPC/i.test(JSON.stringify(calls[0].payload)), 'a computer name as the device name never goes out');
  // a malformed id is refused
  r = await sr.send({ vid: 'zz', pid: '1' });
  ok(r.bad && r.fallback, 'a malformed USB id is refused');

  // ---- the route (get-help handle): POST /api/help/request/send
  root = folder(); fresh(root);
  let sent = null;
  const res = {}, req = { method: 'POST', socket: {} };
  await handle(new URL('http://127.0.0.1/api/help/request/send'), req, res, (rs, code, body) => { sent = { code, body }; }, async () => ({ vid: '258A', pid: '1007', name: '' }));
  ok(sent?.code === 200 && sent.body.sent && calls.length === 1, `the route sends it (${JSON.stringify(sent)})`);

  // ---- generic 2.4G receivers
  ok(genericDongle({ vid: '258a', pid: '1007', name: null })?.chip === 'Sinowealth', 'a nameless Sinowealth receiver is generic');
  ok(genericDongle({ vid: '258A', pid: '1007', name: '2.4G Wireless Receiver' })?.line === 'A generic 2.4G receiver (Sinowealth chip). These usually have no settings to learn; it works as a normal mouse or keyboard.', 'the plain line');
  ok(!genericDongle({ vid: '258a', pid: '2022', name: null }), "a Glorious Model O Wireless dongle (the sheet's own id) is not generic");
  ok(!genericDongle({ vid: '258a', pid: '1007', name: 'Redragon M686' }), 'a branded name is not generic');
  ok(genericDongle({ vid: '04d9', pid: 'a0f8', name: 'USB Receiver' })?.chip === 'Holtek' && !genericDongle({ vid: '04d9', pid: 'a0f8', name: null }), 'Holtek counts only when Windows names it a receiver');
  ok(!genericDongle({ vid: '0c45', pid: '6366', name: 'USB Camera' }) && genericDongle({ vid: '0c45', pid: '7603', name: '2.4G Dongle' })?.chip === 'Sonix', 'a Sonix webcam is not a receiver');
  ok(!genericDongle({ vid: '25a7', pid: 'fa61', name: '2.4G Receiver' }) && !genericDongle({ vid: '046d', pid: 'c547', name: 'USB Receiver' }), 'vendors the brand guide does not list as shared chips are not named');
  // the Set up card: one plain line, under Ready to use, with the USB id (Request support hangs off what: generic-dongle)
  const sroot = folder();
  const s = summary({ root: sroot, sources: { agent: { devices: [] }, usb: [{ vid: '258a', pid: '1007', name: null }, { vid: '258a', pid: '0036', name: 'Glorious Model O' }] } });
  const gd = (s.works || []).find((i) => i.what === 'generic-dongle');
  ok(gd && gd.usb === '258a:1007' && gd.state === 'ready' && gd.short === dongleLine('Sinowealth') && /Learn a device does not learn/.test(gd.line), `the Set up card has the plain line (${JSON.stringify(gd)})`);
  ok(!(s.learn || []).some((i) => i.usb === '258a:1007') && (s.learn || []).some((i) => i.usb === '258a:0036'), 'the generic receiver is not offered for learning; a real Glorious id still is listed as before');
  ok(s.show, 'the card shows for it');
} finally { ar.stop(); }

if (fails.length) { console.log(`support-request: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('support-request (one click through the relay, generic 2.4G receivers): all good');
