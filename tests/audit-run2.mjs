// Security audit run-2 fixes (9 Nov 2026; ~/security-audit-skill/DeviceHub/run-2, outside the repo). Each section is a
// lead the audit's verifiers kept, and each check here fails with its fix taken out. Nothing reaches a device, the
// helper is never started, nothing is sent anywhere.
// Run: node tests/audit-run2.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const require = createRequire(import.meta.url);

// ---- 1. a driver file's own HID channel: every field checked, no line break reaches the helper, the report id that
// goes out is the one the never list checks ----
{
  // the real request(): a request with a line break is refused before the helper is started or written to
  const realNative = require('../helpers/native.js');
  const r1 = await realNative.request('hid:1234:5678:FF00:0001:64\nwatchdog 1 PING\nx:0', 'OPEN', 1000);
  const r2 = await realNative.request('hid:1234:5678:FF00:0001:64:0', 'REQ 1 900 01\nwatchdog 1 PING', 1000);
  check(/^ERR refused/.test(r1) && /^ERR refused/.test(r2), `a helper request with a line break is refused (${r1} / ${r2})`);
  check(!realNative.running?.(), 'refusing it did not start the helper');

  const { validate } = await import('../helpers/declarative-driver.mjs');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/asus-rog-mouse/driver.json'), 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));
  check(validate(clone()).ok, `the shipped ASUS driver.json still validates (${validate(clone()).problems})`);
  const refuses = (mut, what, re) => { const d = clone(); mut(d); const r = validate(d); check(!r.ok && r.problems.some((p) => re.test(p)), `${what} (${r.problems?.join('; ') || 'accepted'})`); };
  refuses((d) => { d.hid.len = '64\nhid:0B05:1A92:FF01:0001:64:0 1 OPEN'; }, 'a line break in hid.len is refused', /hid\.len must be a whole number/);
  refuses((d) => { d.hid.reportId = '0\nwatchdog 1 PING'; }, 'a line break in hid.reportId is refused', /hid\.reportId must be a whole number/);
  refuses((d) => { d.hid.page = '*'; }, 'hid.page "*" is refused', /hid\.page must be 4 hex digits/);
  refuses((d) => { d.hid.iface = 1; }, 'hid.iface (choosing a collection) is refused in a file', /hid has "iface"/);
  refuses((d) => { d.hid.byPid = { '1A94': { len: '64\nx' } }; }, 'a bad byPid len is refused', /hid\.byPid\.1A94\.len/);
  refuses((d) => { d.hid.byPid = { '1A94': { vid: '046D' } }; }, 'a byPid pointing at another maker is refused', /not the file's own vid/);
  refuses((d) => { d.messages.pairList.reportId = 9; }, 'a message on a report id no channel sends on is refused', /names report 9, which none of the file's channels sends on/);

  // the channel builder refuses the same, whatever wrote the file (library bundle, learned driver, setup file)
  const host = await import('../helpers/hid-host.mjs');
  check(/len must be/.test(host.specProblem({ vid: '1234', pid: '5678', len: '64\nhid:x 1 OPEN' }) || ''), 'addSpec refuses a channel whose len is not a number');
  check(/reportId must be/.test(host.specProblem({ vid: '1234', pid: '5678', reportId: '0 x' }) || ''), 'addSpec refuses a channel whose reportId is not a number');
  check(host.specProblem({ vid: '1234', pid: '5678', page: 'FF00', len: 64, reportId: 0 }) === null, 'an ordinary channel is accepted');
  check(/refused/.test((await throws(() => host.addSpec({ id: 'bad', vid: '1234', pid: '5678', len: 'x\ny' })))?.message || ''), 'addSpec throws for it');
}

// ---- 1b. the report id on the wire is the one the never list checks (a stand-in helper; nothing reaches a device) ----
{
  const native = require('../helpers/native.js');
  const lines = [];
  const real = native.request;
  native.request = async (chan, cmd) => { lines.push(`${chan} ${cmd}`); return cmd === 'OPEN' || cmd.startsWith('WATCH') ? 'OK' : cmd.startsWith('REQ') ? '00 00' : 'NONE'; };
  native.onEvent = () => {};
  const host = await import('../helpers/hid-host.mjs');
  // Glorious DFU is report 5, bytes 75: a driver naming report 4 on a channel whose report id is 5
  host.addSpec({ id: 'rid-test', vid: '258A', pid: '0099', page: 'FF00', usage: '0001', len: 8, reportId: 5 });
  const dev = await host.provider([{ vendorId: 0x258a, productId: 0x0099 }]);
  const n = lines.length;
  const e = await throws(() => dev.sendReport(4, [0x75, 0, 0]));
  check(e?.never && !lines.slice(n).some((l) => /REQ/.test(l)), `bytes checked as report 4 but sent on report 5 are refused (${e?.message || 'sent'})`);
  await dev.sendReport(5, [0x01, 0, 0]);
  check(lines.slice(n).some((l) => /REQ 1 \d+ 01 00 00/.test(l)), 'an ordinary report on the channel id still goes out');
  native.request = real;
}

// ---- 2. no other site can frame the dashboard: every answer carries frame-ancestors 'none' and X-Frame-Options DENY,
// set before the first route (the server is not started here; its request handler is read) ----
{
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const at = src.indexOf('http.createServer(async (req, res) => {');
  const head = src.slice(at, at + 900);
  check(at > 0 && /res\.setHeader\('X-Frame-Options', 'DENY'\)/.test(head) && /frame-ancestors 'none'/.test(head), 'the request handler sets X-Frame-Options DENY and frame-ancestors none');
  check(head.indexOf('X-Frame-Options') < head.indexOf('HOSTS.has'), 'the framing headers are set before any answer, the wrong-host refusal included');
}

// ---- 3. a sound-device name with a line break stays on its own comment line in Equalizer APO's config.txt ----
{
  const { configText } = require('../helpers/eqapo.js');
  const s = { headroom: true, extras: { correction: false, filters: [], balance: 0, loudness: false, speakers: { '{11111111-1111-1111-1111-111111111111}': { on: true, stages: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } } };
  const evil = 'Speakers\r\nVSTPlugin: Library "C:\\x.dll"';
  const t = configText(s, Array(10).fill(0), 'Flat\nInclude: x.txt', {
    headset: ['{22222222-2222-2222-2222-222222222222}'], mic: [], headsetModel: 'USB\nPreamp: -30 dB',
    speakers: [{ guid: '{11111111-1111-1111-1111-111111111111}', name: evil }],
  });
  const lines = t.split(/\r\n|\r|\n/);   // any line break: Equalizer APO may split on a lone CR or LF too
  check(!lines.some((l) => /^(VSTPlugin|Include|Preamp: -30)/.test(l)), `no device or preset name starts a config line of its own (${lines.filter((l) => /VSTPlugin|Include|Preamp: -30/.test(l)).join(' | ')})`);
  check(lines.some((l) => l.startsWith('# Speakers  VSTPlugin')), 'the speaker name is kept, on its comment line');
}

// ---- 4. Learn recordings sent to Shawn never carry input reports (on a keyboard: the keys typed while recording) ----
{
  const { captureReport } = await import('../helpers/learn-send.mjs');
  const key = (code) => ({ dir: 'in', type: 'input', reportId: 0, data: [0, 0, code, 0, 0, 0, 0, 0] });
  const typed = [0x0b, 0x18, 0x11, 0x17, 0x08, 0x15].map(key);   // h u n t e r
  const r = captureReport({ device: { vid: '1234', pid: 'ABCD', name: 'Test Keyboard', kind: 'keyboard' }, maker: {},
    captures: [{ label: 'Brightness', kind: 'number', value: 1, messages: [{ dir: 'out', type: 'feature', reportId: 6, data: [0x08, 0x01] }, ...typed] }] });
  check(!/00 00 0B 00/.test(r.body) && !/in input/.test(r.body), `no input report is in the body (${r.body.split('\n').filter((l) => /in input/.test(l)).join(' | ')})`);
  check(/out feature id 06: 08 01/.test(r.body), 'what the maker\'s app sent is still in it');
  check(/Not sent: 6 input reports/.test(r.body) && /learn\\wizard\\/.test(r.body), 'it says how many were left on the PC, and where');
}

// ---- 5. the USBPcap installer is accepted only for its maker's whole certificate name, not a name containing it ----
{
  const inst = await import('../helpers/installers.mjs');
  const real = inst.deps.signature;
  const as = async (signer) => { inst.deps.signature = async () => ({ status: 'Valid', signer }); return (await inst.verify('usbpcap', 'x.exe')).ok; };
  check(await as('CN=Tomasz Moń, O=Tomasz Moń, C=PL'), 'its author\'s certificate passes');
  check(await as('CN=Wireshark Foundation, O=Wireshark Foundation, C=US'), 'the Wireshark Foundation\'s certificate passes');
  check(!(await as('CN=Tomasz Morawski, O=Tomasz Morawski, C=PL')), 'a different Tomasz Mo... is refused');
  check(!(await as('CN=Evil Ltd, O="Not the Wireshark Foundation Inc", C=US')), 'a certificate that only mentions the Wireshark Foundation is refused');
  check(!(await as('CN=Someone, OU=Tomasz Moń')), 'the name anywhere but the CN is refused');
  inst.deps.signature = real;
}

// ---- 6. the admin tasks take nothing from the person's own environment: modules only from Windows' own folder before
// any cmdlet, netsh from System32 as Windows reports it, the sensors compile in the admin-only folder ----
{
  const acer = fs.readFileSync(path.join(ROOT, 'helpers/acer-control.ps1'), 'utf8');
  const firstCmdlet = acer.search(/\b(Join-Path|Get-CimInstance|ConvertTo-Json|Move-Item|Get-FileHash)\b/);
  const mod = acer.indexOf("$env:PSModulePath = [IO.Path]::Combine([Environment]::SystemDirectory, 'WindowsPowerShell\\v1.0\\Modules')");
  check(mod > acer.indexOf('param(') && mod < firstCmdlet, 'Acer: PSModulePath is Windows\' own folder before the first cmdlet');
  const wifi = fs.readFileSync(path.join(ROOT, 'helpers/wifi-pause.ps1'), 'utf8');
  check(wifi.indexOf('$env:PSModulePath = ') > 0 && wifi.indexOf('$env:PSModulePath = ') < wifi.indexOf('Get-FileHash'), 'Wi-Fi pause: PSModulePath set before its own hash check (a cmdlet)');
  check(!/\$env:(SystemRoot|windir|ProgramFiles)\b/i.test(wifi), 'Wi-Fi pause: no path from an environment variable');
  const { readerScript } = await import('../helpers/cpu-sensors.mjs');
  const rs = readerScript({ sourceSha: '0'.repeat(64) });
  check(/\$cp\.TempFiles = \[CodeDom\.Compiler\.TempFileCollection\]::new\(\$dir, \$false\)/.test(rs) && rs.indexOf('$cp.TempFiles') < rs.indexOf('CompileAssemblyFromSource'), 'sensors: the compiler\'s files go in the admin-only folder, set before the compile');
}

// ---- 7. a reviewed share message is bound to how it goes out: the same template on another report id, as a feature
// report, or with checksum or counter bytes written after it, is a different message to review ----
{
  const os = await import('node:os');
  const { unreviewedOf, sentMessages } = await import('../helpers/accept-driver-shares.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-allow-'));
  try {
    fs.mkdirSync(path.join(root, 'helpers'), { recursive: true });
    const plain = { vid: 'ABCD', transport: { report: 'output', reportId: 6, len: 16 }, messages: { m: { bytes: '08 01' } } };
    const lines = sentMessages(plain).map((m) => ({ vid: 'ABCD', reportId: m.reportId, bytes: m.bytes, frame: m.frame, reviewed: '2026-11-09' }));
    fs.writeFileSync(path.join(root, 'helpers', 'share-allow-list.json'), JSON.stringify({ messages: lines }));
    const left = (def) => unreviewedOf(root, def, 'ABCD').length;
    check(left(plain) === 0, 'the reviewed message passes');
    check(left({ ...plain, transport: { ...plain.transport, report: 'feature' } }) > 0, 'the same template as a feature report is not reviewed');
    check(left({ ...plain, transport: { ...plain.transport, checksum: { type: 'sub8', from: 0, to: 1, at: 10, k: 66 } } }) > 0, 'the same template with a checksum byte written after it is not reviewed');
    check(left({ ...plain, transport: { ...plain.transport, counter: { at: 12, step: 165 } } }) > 0, 'the same template with a counter byte is not reviewed');
    check(left({ ...plain, links: { rx: { label: 'receiver', reportId: 7 } } }) > 0, 'the same template going out on a link\'s report id is not reviewed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- 8. wave 2 (9 Nov 2026): a driver file's channel report id is its transport's; allow-list review per product page;
// Learn ids unique; Publish confirmed; no state change on GET; redirects stay on the maker's site; publish clone safe ----
{
  const os = await import('node:os');
  const { validate } = await import('../helpers/declarative-driver.mjs');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'device-library/asus-rog-mouse/driver.json'), 'utf8'));
  const d1 = JSON.parse(JSON.stringify(base)); d1.hid.reportId = 7;
  check(!validate(d1).ok && validate(d1).problems.some((p) => /is not the transport's report id/.test(p)), 'a channel report id other than the transport\'s is refused');
  const d2 = JSON.parse(JSON.stringify(base)); d2.hid.reportId = 7; d2.hid.reportIds = [1, 7];
  check(validate(d2).ok, `a channel report id the file lists in reportIds is accepted (${validate(d2).problems})`);
  const d3 = JSON.parse(JSON.stringify(base)); d3.hid.byPid = { '1A94': { page: null } };
  check(!validate(d3).ok && validate(d3).problems.some((p) => /empty \(null\) part/.test(p)), 'a null byPid part is refused');

  const { sentMessages } = await import('../helpers/accept-driver-shares.mjs');
  const sm = sentMessages({ vid: 'ABCD', transport: { reportId: 0 }, hid: { vid: 'ABCD', pid: '0001', page: 'FF00', byPid: { '0002': { page: 'FF60' } } }, messages: { m: { bytes: '01' } } });
  check(sm.some((m) => /FF60/.test(m.frame)) && sm.some((m) => /FF00/.test(m.frame) && !/FF60/.test(m.frame)), 'a product opening another collection gets its own review entries on that page');

  const { saveDriver } = await import('../helpers/learn-wizard.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-learnid-'));
  try {
    fs.mkdirSync(path.join(root, 'my-devices', 'old'), { recursive: true });
    fs.writeFileSync(path.join(root, 'my-devices', 'old', 'library.json'), JSON.stringify({ id: base.id }));
    const r = saveDriver(JSON.parse(JSON.stringify(base)), { root });
    check(r.ok && r.id !== base.id && r.id.startsWith(`${base.id}-`), `a learned driver whose id is taken gets its own (${JSON.stringify(r)})`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const auto = fs.readFileSync(path.join(ROOT, 'helpers/learn-auto.mjs'), 'utf8');
  check(/st\.adapter\.plugin !== res\.saved\.name/.test(auto), 'Learn it for me turns on only the driver it saved');

  const settings = fs.readFileSync(path.join(ROOT, 'public/pages/settings.js'), 'utf8');
  const startAt = settings.indexOf('const start = async () => {');
  const startBody = settings.slice(startAt, startAt + 1200);
  check(/modal\('Publish to every copy\?'/.test(startBody) && /Date\.now\(\) - opened < 1000/.test(startBody) && startBody.indexOf('modal(') < startBody.indexOf("/api/publish-release"), 'Publish asks first, and ignores a yes in its first second');

  const gh = fs.readFileSync(path.join(ROOT, 'helpers/get-help.mjs'), 'utf8');
  check(!/'\/api\/help\/request' && req\.method === 'GET'/.test(gh) && /'\/api\/help\/request' && req\.method === 'POST'/.test(gh), 'remembering a support request is a POST, never a GET');

  const upd = require('../helpers/updates.js');
  const hops = [];
  const fake = async (u) => { hops.push(u); return { status: 302, ok: false, headers: { get: (k) => (k === 'location' ? 'http://127.0.0.1:5577/api/help/request?vid=1234' : null) }, text: async () => '' }; };
  const e = await throws(() => upd.page('https://pulsar.gg/x', { fetchFn: fake }));
  check(/refused a redirect/.test(e?.message || '') && hops.length === 1, `a vendor page redirecting to this PC is refused before that request (${e?.message}; ${hops.length} requests)`);
  const via = fs.readFileSync(path.join(ROOT, 'helpers/via-defs.js'), 'utf8');
  check(/redirect: 'manual'/.test(via) && /next\.hostname !== LIBRARY_HOST/.test(via), 'the VIA library fetch follows redirects only within usevia.app');

  const pc = fs.readFileSync(path.join(ROOT, 'helpers/publish-code.ps1'), 'utf8');
  check(/core\.symlinks=false/.test(pc) && /GIT_LFS_SKIP_SMUDGE = '1'/.test(pc) && /git @safe -C \$Clone/.test(pc), 'the publish clone never makes symlinks or runs git-lfs for the public branch');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  check(/if \(\/\^\[0-9a-f\]\{40\}\$\/\.test\(String\(c\)\)\) try \{ ahead/.test(srv), 'only a whole commit id reaches git rev-list');
}

if (fails.length) { console.log(`audit-run2: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('audit-run2 (security audit run-2 fixes): all good');
