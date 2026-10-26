// A fresh install on other people's PCs, end to end (25 Oct 2026, Shawn: "go through a test install with test devices on
// your end that are different and or on the list of known devices and see how it works"). Each PC is a fresh copy in
// TEMP (the shipped device-library, docs and code; no my-devices, no setup.json), its USB list as /api/pc reports it.
// For each: auto setup (helpers/auto-setup.mjs run) installs what the library has for it, the drivers load guarded
// (helpers/my-devices.mjs load), nothing is written before Turn on settings, and the Set up card (summary) says what
// works, what is optional and what is still to do. Nothing is opened or written on a real device.
// Run: node tests/test-install.mjs (no hardware)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, summary, asText } from '../helpers/auto-setup.mjs';
import { load } from '../helpers/my-devices.mjs';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const verbose = process.argv.includes('--verbose');
const say = (t) => { if (verbose) console.log(t); };

// a fresh copy: what the installer zip carries that matters here (no PC data)
function freshPc(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dh-install-${tag}-`));
  for (const d of ['device-library', 'docs', 'public', 'helpers']) {
    fs.cpSync(path.join(REAL, d), path.join(root, d), { recursive: true, filter: (src) => !/[\\/]helpers[\\/]bin([\\/]|$)/.test(src) });
  }
  fs.copyFileSync(path.join(REAL, 'package.json'), path.join(root, 'package.json'));
  return root;
}

async function installOn(tag, usb, { busy = [], via = [] } = {}) {
  const root = freshPc(tag);
  check(!fs.existsSync(path.join(root, 'my-devices')) && !fs.existsSync(path.join(root, 'setup.json')) && !fs.existsSync(path.join(root, 'eq-presets.json')), `${tag}: the fresh copy carries no PC data`);
  const logs = [];
  const r = await run({ root, usb, busy, log: (e) => logs.push(e.text), load: async () => [] });
  const reg = {};
  const writes = [];
  const loaded = await load(root, { register: (a) => { reg[a.id] = a; }, addSpec() {}, taken: (id) => !!reg[id], selfCheck: { backup: async () => ({}), log: () => {} } });
  const agent = { devices: Object.values(reg).map((a) => ({ id: a.id, status: 'connected', seen: true, adapter: { title: a.title, kind: a.kind, settings: a.settings, library: a.library, plugin: a.plugin } })) };
  const s = summary({ root, sources: { agent, usb, via, eqapo: false, openrgb: { running: false } } });
  say(`\n=== ${tag} ===\ninstalled: ${r.lastRun.installed.map((x) => `${x.name} (${x.status}${x.family ? `, by protocol ${x.family}` : ''})`).join(', ') || 'none'}\noffered: ${r.lastRun.offered.map((x) => x.name).join(', ') || 'none'}\nskipped: ${r.lastRun.skipped.map((x) => `${x.name}: ${x.why}`).join('; ') || 'none'}\nloaded: ${loaded.filter((x) => x.id).map((x) => x.name).join(', ')}\n${asText(s)}`);
  return { root, r, reg, loaded, s, logs, writes };
}
const names = (l) => l.map((x) => x.name).sort().join();
// every library setting waits for Turn on settings: no write reaches the driver before it
async function noWriteBeforeTurnOn(tag, a) {
  const w = a.settings?.find((x) => x.type !== 'display');
  if (!w) return;
  let err = null; try { await a.write(w.key, 0); } catch (e) { err = e.message; }
  check(/Turn on settings|read-only|self-check/i.test(err || ''), `${tag}: ${a.id} refuses a write before Turn on settings (${err})`);
  check(a.library?.turnOn === true, `${tag}: ${a.id} shows the Turn on settings button`);
}

// ---------- PC A: Logitech mouse, HyperX Cloud III headset, Keychron Q1 Pro on VIA ----------
{
  const usb = [
    { vid: '046d', pid: 'c54d', name: 'USB Receiver', pages: ['FF00:0001', 'FF00:0002'] },              // the PRO X SUPERLIGHT 2's LIGHTSPEED receiver
    { vid: '03f0', pid: '05b7', name: 'HyperX Cloud III Wireless', pages: ['FF00:0001'] },
    { vid: '3434', pid: '0220', name: 'Keychron Q1 Pro', pages: ['FF60:0061'] },
    { vid: '8087', pid: '0026', name: 'Intel(R) Wireless Bluetooth(R)' },
  ];
  // VIA finds the Keychron (auto-setup startup's busy list, and the summary's via source)
  const A = await installOn('pc-a', usb, { busy: ['3434:0220'], via: [{ vid: '3434', pid: '0220', name: 'Keychron Q1 Pro' }] });
  const inst = A.r.lastRun.installed.map((x) => x.name);
  check(inst.includes('hyperx-cloud'), `pc-a: the HyperX Cloud III driver installs (${inst})`);
  check(inst.includes('logitech-hidpp-mouse'), `pc-a: the Logitech mouse driver installs for the SUPERLIGHT 2 receiver (${inst})`);
  check(!inst.includes('keychron-via') && A.s.works.some((x) => x.what === 'via'), `pc-a: the Keychron works on VIA at once (${JSON.stringify(A.s.works.map((x) => x.what))})`);
  check(!A.s.learn.some((x) => x.name === 'keychron-via') && A.s.optional.some((x) => x.name === 'keychron-via'), `pc-a: Keychron's extra settings driver is optional, never "still to do" (${A.s.learn.map((x) => x.line).join(' | ')})`);
  for (const a of Object.values(A.reg)) await noWriteBeforeTurnOn('pc-a', a);
  check(A.logs.length && A.logs.every((t) => /^Set up: /.test(t)), `pc-a: Activity says what was installed (${A.logs.join(' | ')})`);
  check(A.s.show, 'pc-a: the Set up card shows');
}

// ---------- PC B: Razer mouse + keyboard, SteelSeries Arctis Nova 7, Wooting, a Logitech model the library does not list ----------
{
  const usb = [
    { vid: '1532', pid: '00b6', name: 'Razer DeathAdder V3 Pro', pages: ['0001:0002'] },
    { vid: '1532', pid: '0287', name: 'Razer BlackWidow V4', pages: ['0001:0006'] },
    { vid: '1038', pid: '2202', name: 'SteelSeries Arctis Nova 7', pages: ['FFC0:0001'] },
    { vid: '31e3', pid: '1200', name: 'Wooting Two', pages: ['FF54:0001'] },
    { vid: '046d', pid: 'c5ff', name: 'Logitech G new mouse', pages: ['FF00:0002'] },                    // not listed: by protocol
  ];
  const B = await installOn('pc-b', usb);
  const inst = A_or(B.r.lastRun.installed.map((x) => x.name));
  for (const n of ['razer-mouse', 'razer-keyboard', 'steelseries-arctis', 'wooting']) check(inst.includes(n), `pc-b: ${n} installs (${inst})`);
  const fam = B.r.lastRun.installed.filter((x) => x.family?.includes('c5ff'));
  check(fam.length > 0, `pc-b: the unlisted Logitech model is matched by its protocol family (${JSON.stringify(B.r.lastRun.installed.map((x) => [x.name, x.family]))})`);
  check(Object.keys(B.reg).length >= 4, `pc-b: the installed drivers load (${Object.keys(B.reg)})`);
  for (const a of Object.values(B.reg)) await noWriteBeforeTurnOn('pc-b', a);
  // a second start installs nothing again
  const again = await run({ root: B.root, usb, load: async () => [] });
  check(again.lastRun.installed.length === 0, `pc-b: a second start installs nothing twice (${names(again.lastRun.installed)})`);
}
function A_or(x) { return x; }

// ---------- PC C: devices DeviceHub has no driver for: a no-name 2.4 GHz mouse and a C-Media USB headset ----------
{
  const usb = [
    { vid: '25a7', pid: 'fa70', name: '2.4G Wireless Receiver', pages: ['0001:0002', '0001:0006'] },
    { vid: '0d8c', pid: '0014', name: 'USB Audio Device' },
  ];
  const C = await installOn('pc-c', usb);
  check(C.r.lastRun.installed.length === 0 && !fs.existsSync(path.join(C.root, 'my-devices', 'x')), 'pc-c: nothing is installed for devices the library does not know');
  const text = asText(C.s);
  check(/Learn a device/.test(text), `pc-c: the Set up card points to Learn a device (${text.slice(0, 400)})`);
  check(C.s.optional.some((x) => x.what === 'eqapo'), 'pc-c: Equalizer APO is offered as optional (sound features for any headset)');
}

// ---------- PC D: Shawn's own devices on another PC: nothing to install, nothing to say ----------
{
  const usb = [{ vid: '1b1c', pid: '0a6b', name: 'CORSAIR HS80 RGB Wireless Gaming Headset', runs: 'Headset page' }, { vid: '3710', pid: '5406', runs: 'Mouse page' }, { vid: '342d', pid: 'e479', runs: 'Keyboard page' }];
  const D = await installOn('pc-d', usb);
  check(D.r.lastRun.installed.length === 0 && !D.r.lastRun.installed.some((x) => /corsair/.test(x.name)), `pc-d: the HS80, Pulsar and P75 never get a library driver (${names(D.r.lastRun.installed)})`);
}

// ---------- the installer zip never carries this PC's sound settings ----------
{
  const mk = fs.readFileSync(path.join(REAL, 'helpers', 'make-installer.ps1'), 'utf8');
  check(/'eq-presets\.json'/.test(mk), "make-installer.ps1 refuses a zip with this PC's eq-presets.json in it");
  const ins = fs.readFileSync(path.join(REAL, 'helpers', 'install.ps1'), 'utf8');
  check(/\$keep = [\s\S]*?'eq-presets\.json'/.test(ins), "install.ps1 keeps a PC's own eq-presets.json on a reinstall or update");
}

for (const d of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('dh-install-pc-'))) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
if (fails.length) { console.log(`test-install: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('test-install (4 fresh PCs: Logitech/HyperX/Keychron, Razer/SteelSeries/Wooting + a Logitech by protocol, unknown devices, Shawn\'s own): all good');
