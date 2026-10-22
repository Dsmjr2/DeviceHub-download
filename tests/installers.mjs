// helpers/installers.mjs offline: the download, the signature check, the installer and Windows' Apps list are all
// stand-ins (inst.deps), so nothing is downloaded, checked by Windows or run. Covers status, plan, verify (signature,
// signer, SHA-256), install (happy path, bad signature, declined prompt, page-only tool, installed-but-not-found), the
// redirect host check and the route.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as inst from '../helpers/installers.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const d = inst.deps;
const T = (id) => inst.TOOLS.find((t) => t.id === id);

// the PC as the stand-ins see it
const pc = { files: new Set(), apps: [], signature: { status: 'Valid', signer: 'CN=Tomasz Moń, O=Tomasz Moń, C=PL' }, run: { started: true, exitCode: 0 }, installs: null };
const calls = { download: 0, run: [], head: 0 };
d.exists = (f) => pc.files.has(f);
d.installedApps = async () => pc.apps;
d.head = async (t) => { calls.head++; if (t.id === 'reaplugs') throw new Error('offline'); return { size: 195040, finalUrl: t.url }; };
d.download = async (t, dest, onBytes) => { calls.download++; fs.writeFileSync(dest, 'pretend installer'); onBytes(50, 100); onBytes(100, 100); };
d.signature = async () => pc.signature;
d.run = async (file) => { calls.run.push(file); check(fs.existsSync(file), 'the installer runs from the downloaded file'); if (pc.installs) pc.installs(); return pc.run; };

// --- status ---
pc.files.add(T('eqapo').marker);
pc.apps = [{ name: 'Equalizer APO', version: '1.4.2' }, { name: 'ReaPlugs VST FX Suite', version: null }];
let st = await inst.status({ fresh: true });
const by = (id) => st.find((x) => x.id === id);
check(by('eqapo').installed && by('eqapo').version === '1.4.2' && !by('eqapo').partial, `Equalizer APO installed with its version (${JSON.stringify(by('eqapo'))})`);
check(by('reaplugs').installed && by('reaplugs').partial, 'listed by Windows but not where DeviceHub looks: installed, with a note');
check(!by('usbpcap').installed, 'USBPcap not installed');
check(by('eqapo').offer === 'page' && by('reaplugs').offer === 'page' && by('usbpcap').offer === 'install', 'unsigned tools with no published hash are page-only; USBPcap is offered to install');

// --- plan ---
const pu = await inst.plan('usbpcap');
check(pu.size === 195040 && pu.sizeExact && pu.file === 'USBPcapSetup-1.5.4.0.exe' && pu.source === 'github.com' && /signature/.test(pu.check) && pu.offer === 'install', `USBPcap plan (${JSON.stringify(pu)})`);
const pr = await inst.plan('reaplugs');
check(!pr.sizeExact && pr.size === T('reaplugs').approxBytes && pr.sizeNote === 'offline', 'a failed HEAD falls back to the known size, marked approximate');
check(/only opens the official page/.test(pr.check) && pr.offer === 'page', 'a page-only plan says so');
await inst.plan('usbpcap');
check(calls.head === 2, `sizes are remembered (${calls.head} HEAD requests)`);
let threw = false; try { await inst.plan('nope'); } catch { threw = true; }
check(threw, 'an unknown tool is refused');

// --- verify ---
const f = path.join(inst.DIR, 'verify-test.bin');
fs.mkdirSync(inst.DIR, { recursive: true });
fs.writeFileSync(f, 'abc');
check((await inst.verify('usbpcap', f)).ok, 'valid signature from the expected signer passes');
pc.signature = { status: 'Valid', signer: 'CN=Someone Else, O=Else' };
let v = await inst.verify('usbpcap', f);
check(!v.ok && /Someone Else/.test(v.why), `a valid signature from someone else fails (${v.why})`);
pc.signature = { status: 'NotSigned', signer: null };
v = await inst.verify('usbpcap', f);
check(!v.ok && /not digitally signed/.test(v.why), 'an unsigned file fails');
pc.signature = { status: 'HashMismatch', signer: 'CN=Tomasz Moń' };
check(!(await inst.verify('usbpcap', f)).ok, 'a tampered file (HashMismatch) fails even with the right name');
const abc = crypto.createHash('sha256').update('abc').digest('hex');
const hashed = { ...T('reaplugs'), id: 'hashed', sha256: abc.toUpperCase() };
check((await inst.verify(hashed, f)).ok, 'the SHA-256 fallback passes on a match (case does not matter)');
check(!(await inst.verify({ ...hashed, sha256: '0'.repeat(64) }, f)).ok, 'the SHA-256 fallback fails on a mismatch');
check(!(await inst.verify({ ...hashed, signer: /Cockos/, sha256: '0'.repeat(64) }, f)).ok, 'unsigned and the wrong hash: fails');
fs.rmSync(f, { force: true });

// --- install: happy path ---
pc.signature = { status: 'Valid', signer: 'CN=Tomasz Moń, O=Tomasz Moń, C=PL' };
pc.installs = () => { pc.files.add(T('usbpcap').marker); pc.apps = [...pc.apps, { name: 'USBPcap 1.5.4.0', version: '1.5.4.0' }]; };
const seen = [];
const realDownload = d.download;
d.download = async (t, dest, onBytes) => { await realDownload(t, dest, (g, s) => { onBytes(g, s); seen.push(inst.getProgress().pct); }); };
let r = await inst.install('usbpcap');
const file = path.join(inst.DIR, 'USBPcapSetup-1.5.4.0.exe');
check(r.done && r.ok && /1\.5\.4\.0 is installed/.test(r.text) && /Tomasz/.test(r.verified) && r.restart, `USBPcap installed (${JSON.stringify(r)})`);
check(seen.join() === '50,100', `download progress in percent (${seen})`);
check(calls.run.length === 1 && calls.run[0] === file, 'the installer was run once, from %TEMP%\\DeviceHub-downloads');
check(!fs.existsSync(file) && !fs.existsSync(`${file}.part`), 'the download is tidied up afterwards');
d.download = realDownload;

// --- bad signature: never run, deleted, official page offered ---
pc.signature = { status: 'NotSigned', signer: null };
r = await inst.install('usbpcap');
check(!r.ok && /not digitally signed/.test(r.text) && r.page === T('usbpcap').page, `unsigned download refused (${r.text})`);
check(calls.run.length === 1, 'a file that fails the check is never run');
check(!fs.existsSync(file), 'a file that fails the check is deleted');

// --- the Windows prompt declined ---
pc.signature = { status: 'Valid', signer: 'CN=Tomasz Moń' };
pc.run = { started: false, declined: true, error: 'The operation was canceled by the user.' };
r = await inst.install('usbpcap');
check(!r.ok && /declined/.test(r.text), `declined prompt reported (${r.text})`);

// --- installer closed but nothing installed ---
pc.run = { started: true, exitCode: 2 };
pc.installs = null; pc.files.delete(T('usbpcap').marker); pc.apps = pc.apps.filter((a) => !/USBPcap/.test(a.name));
r = await inst.install('usbpcap');
check(!r.ok && /code 2/.test(r.text) && /not installed/.test(r.text), `not installed after the installer closed (${r.text})`);

// --- page-only tool: nothing downloaded or run ---
const before = calls.download;
r = await inst.install('eqapo');
check(!r.ok && r.pageOnly && r.page === T('eqapo').page && calls.download === before, 'Equalizer APO (no way to check it) is never downloaded or run');

// --- download failure ---
d.download = async () => { throw new Error('the download site answered 503'); };
r = await inst.install('usbpcap');
check(!r.ok && /503/.test(r.text), 'a failed download is reported');
d.download = realDownload;

// --- redirects only to the maker's hosts, https only ---
check(inst.hostOk(T('eqapo'), 'https://cytranet.dl.sourceforge.net/project/equalizerapo/1.4.2/x.exe'), 'a SourceForge mirror is allowed');
check(!inst.hostOk(T('eqapo'), 'https://evil.example/sourceforge.net/x.exe') && !inst.hostOk(T('eqapo'), 'https://dl.sourceforge.net.evil.example/x.exe'), 'other hosts are refused');
check(!inst.hostOk(T('reaplugs'), 'http://www.reaper.fm/reaplugs/x.exe'), 'plain http is refused');
check(inst.hostOk(T('usbpcap'), 'https://release-assets.githubusercontent.com/github-production-release-asset/x') && !inst.hostOk(T('usbpcap'), 'https://sourceforge.net/x'), 'each tool keeps to its own hosts');

// --- the route ---
const call = async (method, p, body) => {
  let out = null;
  const handled = await inst.handle(new URL(`http://127.0.0.1:5577${p}`), { method }, {}, (res, code, b) => { out = { code, body: b }; }, async () => body || {});
  return { handled, ...out };
};
check((await call('GET', '/api/other')).handled === false, 'other paths are left to server.js');
let g = await call('GET', '/api/installers');
check(g.code === 200 && g.body.tools.length === 3 && g.body.busy === false, 'GET /api/installers');
g = await call('GET', '/api/installers/plan?tool=usbpcap');
check(g.code === 200 && g.body.file === 'USBPcapSetup-1.5.4.0.exe', 'GET /api/installers/plan');
g = await call('GET', '/api/installers/plan?tool=nope');
check(g.code === 400, 'plan of an unknown tool: 400');
check((await call('POST', '/api/installers/install', { tool: 'nope' })).code === 400, 'install of an unknown tool: 400');
let release;
pc.run = { started: true, exitCode: 0 };
pc.installs = () => pc.files.add(T('usbpcap').marker);
d.run = async () => { await new Promise((ok) => { release = ok; }); pc.installs(); return pc.run; };
g = await call('POST', '/api/installers/install', { tool: 'usbpcap' });
check(g.code === 200 && g.body.started, 'POST install answers at once');
check((await call('GET', '/api/installers/progress')).body.done === false, 'progress: running');
check((await call('POST', '/api/installers/install', { tool: 'usbpcap' })).code === 409, 'a second install while one runs: 409');
for (let i = 0; i < 50 && !release; i++) await new Promise((ok) => setTimeout(ok, 10));
release?.();
for (let i = 0; i < 50 && !inst.getProgress().done; i++) await new Promise((ok) => setTimeout(ok, 10));
g = await call('GET', '/api/installers/progress');
check(g.body.done && g.body.ok && g.body.tool === 'usbpcap', `progress: finished (${JSON.stringify(g.body)})`);

console.log(fails.length ? `installers: FAILED: ${fails.join('; ')}` : 'installers (stand-in downloads and installers): all good');
process.exit(fails.length ? 1 : 0);
