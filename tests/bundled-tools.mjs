// The tools shipped inside DeviceHub (helpers/bundled-tools.json, helpers/fetch-bundled.mjs, the bundled Equalizer APO
// in helpers/installers.mjs, the bundled OpenRGB in helpers/openrgb.js), offline: every download is a stand-in, the
// zips are made here, and "OpenRGB.exe" is a small Node script that answers like an SDK server. Nothing real is
// downloaded, installed or started. Run: node tests/bundled-tools.mjs
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { Readable } from 'stream';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as fb from '../helpers/fetch-bundled.mjs';
import * as inst from '../helpers/installers.mjs';
const require = createRequire(import.meta.url);

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-bundled-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the table ----------
const T = fb.TABLE.tools;
for (const t of T) {
  let ok = true; try { fb.checkTable(t); } catch (e) { ok = false; check(false, `${t.name}: ${e.message}`); }
  check(ok && t.hosts.length && t.license && fs.existsSync(fileURLToPath(new URL(`../${t.licenseFile}`, import.meta.url))), `${t.name}: pinned, hosted, licensed`);
}
const orgbT = T.find((t) => t.id === 'openrgb'), eqT = T.find((t) => t.id === 'equalizerapo');
check(eqT && /sourceforge\.net$/.test(new URL(eqT.url).hostname) && eqT.version === '1.4.2', 'Equalizer APO 1.4.2 from SourceForge');
check(orgbT && new URL(orgbT.url).hostname === 'codeberg.org' && orgbT.version === '1.1' && orgbT.sdkWrites === true, 'OpenRGB 1.1 from its official Codeberg release, colors allowed');
check(!Object.keys(orgbT.keep).some(fb.neverKept), 'the table keeps no driver and no PawnIO module');
check(orgbT.keep['PawnIOLib.dll'] && orgbT.needs.includes('PawnIOLib.dll'), 'the user-mode PawnIOLib.dll is kept (OpenRGB.exe needs it to start)');
// the six PawnIO modules: kept since 22 Oct 2026, but only for board lights, in their own folder, each pinned
const mods = Object.entries(orgbT.boardModules || {});
check(mods.length === 6 && mods.every(([f, h]) => /^[A-Za-z0-9]+\.bin$/.test(f) && /^[0-9a-f]{64}$/.test(h) && !orgbT.keep[f]) && orgbT.boardModulesFolder === 'board-modules' && !orgbT.dropped, 'the six PawnIO modules are kept apart (board-modules), pinned, never in keep');
check(mods.every(([f]) => fb.boardModule(orgbT, f) && fb.boardDest(orgbT, f) === `tools/openrgb/board-modules/${f}`) && !fb.boardModule(orgbT, 'PawnIO.sys') && !fb.boardModule(orgbT, 'x/SmbusI801.bin') && !fb.boardModule(eqT, 'SmbusI801.bin'), 'a board module is a listed plain .bin name, only ever in tools/openrgb/board-modules/');
for (const bad of [{ 'PawnIO.sys': '0'.repeat(64) }, { 'SmbusI801.bin': 'nothash' }, { 'OpenRGB.exe': orgbT.keep['OpenRGB.exe'] }]) {
  let t2 = null; try { fb.checkTable({ ...orgbT, boardModules: bad }); } catch (e) { t2 = e.message; }
  check(/board modules must be/.test(t2 || ''), `a bad board-module entry is refused (${Object.keys(bad)[0]})`);
}
{ let t2 = null; try { fb.checkTable({ ...orgbT, boardModulesFolder: 'pawnio' }); } catch (e) { t2 = e.message; }
check(/own folder/.test(t2 || ''), 'the board modules folder may not be a never-kept name'); }

// ---------- never kept ----------
for (const n of ['pawnio.sys', 'PawnIO.dll', 'PawnIOLib.dll.sys', 'x/PawnIO/PawnIOLib.dll', 'WinRing0x64.sys', 'WinRing0x64.dll', 'inpoutx64.dll', 'SmbusI801.bin', 'drivers/thing.SYS', 'sub\\PawnIO\\x.dll']) check(fb.neverKept(n), `never kept: ${n}`);
for (const n of ['OpenRGB.exe', 'PawnIOLib.dll', 'tools/openrgb/PawnIOLib.dll', 'Qt6Core.dll', 'platforms/qwindows.dll', 'EqualizerAPO-x64-1.4.2.exe']) check(!fb.neverKept(n), `kept: ${n}`);
let threw = null;
try { fb.checkTable({ ...orgbT, keep: { ...orgbT.keep, 'SmbusPIIX4.bin': '0'.repeat(64), 'PawnIO.sys': '0'.repeat(64) } }); } catch (e) { threw = e.message; }
check(/SmbusPIIX4\.bin, PawnIO\.sys.*never bundled/.test(threw || ''), `a table that keeps a PawnIO module or driver is refused before anything is fetched (${threw})`);

// ---------- downloads: stand-in network ----------
const body = Buffer.from('pretend official installer');
const fake = { name: 'Fake', file: 'fake.exe', size: body.length, sha256: sha(body), url: 'https://sourceforge.net/projects/fake/files/fake.exe/download', hosts: ['sourceforge.net', 'downloads.sourceforge.net', '.dl.sourceforge.net'] };
let asked = [];
const routes = {};
fb.deps.get = async (u) => {
  asked.push(u);
  const r = routes[u] || { statusCode: 404, headers: {} };
  return { statusCode: r.statusCode, headers: r.headers, stream: Readable.from(r.body ? [r.body] : []) };
};
const mirror = 'https://cfhcable.dl.sourceforge.net/project/fake/fake.exe?viasf=1';
routes[fake.url] = { statusCode: 302, headers: { location: 'https://downloads.sourceforge.net/project/fake/fake.exe' } };
routes['https://downloads.sourceforge.net/project/fake/fake.exe'] = { statusCode: 302, headers: { location: mirror } };
routes[mirror] = { statusCode: 200, headers: { 'content-length': String(body.length) }, body };
const dest = path.join(tmp, 'fake.exe');
await fb.download(fake, dest);
check(fs.existsSync(dest) && sha(fs.readFileSync(dest)) === fake.sha256 && asked.length === 3, 'official host and mirror redirects followed; the pinned file is kept');

// hash mismatch: same size, other bytes
fs.rmSync(dest);
routes[mirror] = { statusCode: 200, headers: { 'content-length': String(body.length) }, body: Buffer.from('X'.repeat(body.length)) };
threw = null; try { await fb.download(fake, dest); } catch (e) { threw = e.message; }
check(/not the pinned/.test(threw || '') && !fs.existsSync(dest) && !fs.existsSync(`${dest}.part`), `a hash mismatch is refused and nothing is left (${threw})`);

// redirect off the official hosts: refused before it is requested
asked = [];
routes['https://downloads.sourceforge.net/project/fake/fake.exe'] = { statusCode: 302, headers: { location: 'https://evil.example/fake.exe' } };
threw = null; try { await fb.download(fake, dest); } catch (e) { threw = e.message; }
check(/evil\.example/.test(threw || '') && /refused/.test(threw) && !asked.includes('https://evil.example/fake.exe') && !fs.existsSync(dest), `an off-host redirect is refused and never followed (${threw})`);
for (const bad of ['https://dl.sourceforge.net.evil.example/x', 'http://cfhcable.dl.sourceforge.net/x']) {
  routes['https://downloads.sourceforge.net/project/fake/fake.exe'] = { statusCode: 302, headers: { location: bad } };
  threw = null; try { await fb.download(fake, dest); } catch (e) { threw = e.message; }
  check(/refused/.test(threw || '') && !fs.existsSync(dest), `refused: ${bad}`);
}
// a larger file than pinned
routes['https://downloads.sourceforge.net/project/fake/fake.exe'] = { statusCode: 302, headers: { location: mirror } };
routes[mirror] = { statusCode: 200, headers: { 'content-length': String(body.length + 5) }, body: Buffer.concat([body, Buffer.from('extra')]) };
threw = null; try { await fb.download(fake, dest); } catch (e) { threw = e.message; }
check(/bytes/.test(threw || '') && !fs.existsSync(dest), 'a file of another size is refused');

// ---------- zips: only the kept files, never a driver or PawnIO ----------
function makeZip(files) {   // [{ name, data, deflate }]
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = f.data || Buffer.alloc(0), comp = f.deflate ? zlib.deflateRawSync(raw) : raw, method = f.deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(zlib.crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(zlib.crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const R = 'OpenRGB Windows 64-bit/';
const exe = Buffer.from('pretend OpenRGB.exe '.repeat(50)), qt = Buffer.from('pretend qwindows'), plib = Buffer.from('p');
const zipFiles = [{ name: R }, { name: `${R}OpenRGB.exe`, data: exe, deflate: true }, { name: `${R}platforms/qwindows.dll`, data: qt },
  { name: `${R}PawnIOLib.dll`, data: plib }, { name: `${R}SmbusPIIX4.bin`, data: Buffer.from('m') }, { name: `${R}WinRing0x64.sys`, data: Buffer.from('d') }];
const zt = { name: 'Z', file: 'z.zip', zipRoot: R, keep: { 'OpenRGB.exe': sha(exe), 'platforms/qwindows.dll': sha(qt), 'PawnIOLib.dll': sha(plib) }, dropped: { 'SmbusPIIX4.bin': 'PawnIO module' } };
let plan = fb.planZip(zt, fb.readZip(makeZip(zipFiles)));
check(plan.take.map((x) => x.rel).sort().join() === 'OpenRGB.exe,PawnIOLib.dll,platforms/qwindows.dll', `only the kept files are taken (${plan.take.map((x) => x.rel)})`);
check(['SmbusPIIX4.bin', 'WinRing0x64.sys'].every((n) => plan.left.includes(n)) && plan.left.length === 2, `PawnIO modules and a .sys are left out (${plan.left})`);
check(plan.take.find((x) => x.rel === 'OpenRGB.exe').entry.data().equals(exe), 'a deflated entry unpacks to the same bytes');
// even a table that (wrongly) keeps them never takes them
plan = fb.planZip({ ...zt, keep: { ...zt.keep, 'SmbusPIIX4.bin': sha(Buffer.from('m')), 'WinRing0x64.sys': sha(Buffer.from('d')) } }, fb.readZip(makeZip(zipFiles)));
check(!plan.take.some((x) => fb.neverKept(x.rel)) && plan.take.length === 3, 'neverKeep wins over the keep list');
threw = null; try { fb.planZip(zt, fb.readZip(makeZip([...zipFiles, { name: `${R}newthing.dll`, data: Buffer.from('n') }]))); } catch (e) { threw = e.message; }
check(/does not name: .*newthing\.dll/.test(threw || ''), 'a file the table does not know is refused (a changed zip)');
threw = null; try { fb.planZip(zt, fb.readZip(makeZip(zipFiles.filter((f) => !f.name.endsWith('qwindows.dll'))))); } catch (e) { threw = e.message; }
check(/lacks platforms\/qwindows\.dll/.test(threw || ''), 'a kept file missing from the zip is refused');
threw = null; try { fb.planZip(zt, fb.readZip(makeZip([...zipFiles, { name: `${R}../evil.dll`, data: Buffer.from('e') }]))); } catch (e) { threw = e.message; }
check(/evil\.dll/.test(threw || ''), 'a path leaving the folder is refused');
// board modules (22 Oct 2026): a listed module is taken apart from the kept files, with its own hash; a .sys never
const mod = Buffer.from('pretend SmbusPIIX4 module');
const zb = { ...zt, folder: 'tools/openrgb', boardModulesFolder: 'board-modules', dropped: undefined, boardModules: { 'SmbusPIIX4.bin': sha(mod) } };
const zbFiles = zipFiles.map((f) => (f.name.endsWith('SmbusPIIX4.bin') ? { ...f, data: mod } : f));
plan = fb.planZip(zb, fb.readZip(makeZip(zbFiles)));
check(plan.board.length === 1 && plan.board[0].rel === 'SmbusPIIX4.bin' && plan.board[0].sha256 === sha(mod) && plan.board[0].entry.data().equals(mod), 'a listed board module is taken, with its pinned hash');
check(!plan.take.some((x) => x.rel.endsWith('.bin')) && plan.left.join() === 'WinRing0x64.sys', `board modules never sit with the kept files; the .sys is still left out (${plan.left})`);
threw = null; try { fb.planZip(zb, fb.readZip(makeZip(zbFiles.filter((f) => !f.name.endsWith('.bin'))))); } catch (e) { threw = e.message; }
check(/lacks SmbusPIIX4\.bin/.test(threw || ''), 'a listed board module missing from the zip is refused');
plan = fb.planZip(zb, fb.readZip(makeZip([...zbFiles, { name: `${R}SmbusI801.bin`, data: Buffer.from('x') }, { name: `${R}sub/SmbusPIIX4.bin`, data: mod }])));
check(plan.board.length === 1 && plan.left.includes('SmbusI801.bin') && plan.left.includes('sub/SmbusPIIX4.bin') && !plan.take.some((x) => x.rel.endsWith('.bin')), `a module the table does not list, or one in a sub-folder, is left out (${plan.left})`);
const rm = fb.readme(T);
check(/Equalizer APO 1\.4\.2/.test(rm) && /OpenRGB 1\.1/.test(rm) && /GPL-2\.0/.test(rm) && rm.includes(eqT.sha256) && /PawnIO driver is not bundled/.test(rm), 'tools/README.txt names source, version, hash and license');
check(/board-modules/.test(rm) && /Add board, fan and RAM lights/.test(rm) && /SmbusI801\.bin/.test(rm), 'tools/README.txt says where the modules are and when they are used');

// ---------- Equalizer APO from the bundle (helpers/installers.mjs) ----------
const eq = inst.TOOLS.find((t) => t.id === 'eqapo');
check(eq.sha256 === eqT.sha256 && /tools[\\/]equalizerapo[\\/]EqualizerAPO-x64-1\.4\.2\.exe$/.test(eq.bundled), 'the Equalizer APO entry points at the bundled installer and its pinned hash');
const installer = path.join(tmp, 'EqualizerAPO-x64-1.4.2.exe');
fs.writeFileSync(installer, 'pretend Equalizer APO installer');
const real = { bundled: eq.bundled, sha256: eq.sha256 };
eq.bundled = installer; eq.sha256 = sha(fs.readFileSync(installer));
const d = inst.deps, pcFiles = new Set([installer]);
const calls = { download: 0, head: 0, run: [] };
d.exists = (f) => pcFiles.has(f);
d.installedApps = async () => (pcFiles.has(eq.marker) ? [{ name: 'Equalizer APO', version: '1.4.2' }] : []);
d.head = async () => { calls.head++; return { size: 1 }; };
d.download = async () => { calls.download++; throw new Error('no downloads in this test'); };
d.run = async (file) => { calls.run.push(file); pcFiles.add(eq.marker); return { started: true, exitCode: 0 }; };
let st = (await inst.status({ fresh: true })).find((t) => t.id === 'eqapo');
check(st.offer === 'install' && st.bundled && !st.installed, `bundled Equalizer APO is offered to install (${JSON.stringify(st)})`);
const p = await inst.plan('eqapo');
check(p.bundled && p.offer === 'install' && p.size === eqT.size && p.sizeExact && calls.head === 0 && /pinned/.test(p.check) && /Playback devices tick your headset/.test(p.after), 'its plan: inside DeviceHub, exact size, no download, which box to tick');
let r = await inst.install('eqapo');
check(r.ok && /pinned/.test(r.verified) && calls.run.length === 1 && calls.run[0] === installer && calls.download === 0, `installed from the bundle with no download (${JSON.stringify(r)})`);
check(fs.existsSync(installer), 'the bundled installer stays (it is part of DeviceHub)');
// tampered after the zip was built: refused and never run
pcFiles.delete(eq.marker);
fs.writeFileSync(installer, 'tampered installer');
r = await inst.install('eqapo');
check(!r.ok && /fails its check/.test(r.text) && calls.run.length === 1, `a changed bundled installer is never run (${r.text})`);
// a copy without the bundle: the official page, never a download
pcFiles.delete(installer);
st = (await inst.status({ fresh: true })).find((t) => t.id === 'eqapo');
r = await inst.install('eqapo');
check(st.offer === 'page' && !r.ok && r.pageOnly && calls.download === 0 && calls.run.length === 1, 'without the bundle: the official page only, nothing downloaded or run');
Object.assign(eq, real);

// ---------- the bundled OpenRGB (helpers/openrgb.js) with a stand-in OpenRGB.exe ----------
// the client is loaded from a copy whose default port is a spare one, so a real OpenRGB on 6742 is never touched
const lib = path.join(tmp, 'lib');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'openrgb.js'), fs.readFileSync(new URL('../helpers/openrgb.js', import.meta.url), 'utf8').replace('PORT = 6742', 'PORT = 46743'));
fs.copyFileSync(new URL('../helpers/safe-write.js', import.meta.url), path.join(lib, 'safe-write.js'));
const orgb = require(path.join(lib, 'openrgb.js'));
const { bundle, deps: od, bundleCheck } = orgb._test;
const toolDir = path.join(tmp, 'tools', 'openrgb');
fs.mkdirSync(toolDir, { recursive: true });
// the stand-in: answers the protocol version and "no controllers", logs every packet id it gets
const standIn = path.join(tmp, 'standin-openrgb.mjs');
fs.writeFileSync(standIn, `import net from 'net'; import fs from 'fs';
const a = process.argv.slice(2); const port = Number(a[a.indexOf('--server-port') + 1]); const host = a[a.indexOf('--server-host') + 1];
const log = process.env.STANDIN_LOG;
const pkt = (id, data) => { const h = Buffer.alloc(16); h.write('ORGB', 0, 'latin1'); h.writeUInt32LE(0, 4); h.writeUInt32LE(id, 8); h.writeUInt32LE(data.length, 12); return Buffer.concat([h, data]); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
net.createServer((s) => { let buf = Buffer.alloc(0); s.on('error', () => {}); s.on('data', (d) => { buf = Buffer.concat([buf, d]);
  while (buf.length >= 16) { const id = buf.readUInt32LE(8), size = buf.readUInt32LE(12); if (buf.length < 16 + size) break; buf = buf.subarray(16 + size);
    fs.appendFileSync(log, id + '\\n'); if (id === 40) s.write(pkt(40, u32(3))); if (id === 0) s.write(pkt(0, u32(0))); } }); }).listen(port, host);
`);
const standLog = path.join(tmp, 'standin.log');
fs.writeFileSync(standLog, '');
process.env.STANDIN_LOG = standLog;
const stamp = (commit, when) => Buffer.from(`stand-in OpenRGB.exe\0\0${commit.padEnd(40, '0')}\0\0\0\0${when}\0\0master`, 'latin1');
const BUILD_10 = stamp('81bbe18a84c2e507006f19dd252e397e40a56bfe', '2026-09-11 18:06:58 -0500'), BUILD_11 = stamp('8e16de27858cf2be6af54a33ce003df74cb9fd3e', '2026-10-16 16:37:19 -0500');
const exe11 = path.join(toolDir, 'OpenRGB.exe');
fs.writeFileSync(exe11, BUILD_11);
const old10 = path.join(tmp, 'old', 'OpenRGB.exe');
fs.mkdirSync(path.dirname(old10), { recursive: true });
fs.writeFileSync(old10, BUILD_10);
check(orgb._test.buildOf(old10)?.commit === '81bbe18' && orgb._test.buildOf(old10).at < orgb._test.FIXED_BUILD && orgb._test.buildOf(exe11).at >= orgb._test.FIXED_BUILD, 'the build stamp is read: 1.0 before the fix, 1.1 not');
let runningExes = [];
od.openrgbExes = async () => [...runningExes];
const table = { ...orgbT, needs: ['libusb-1.0.dll', 'Qt6Core.dll', 'PawnIOLib.dll'] };
for (const f of table.needs) fs.writeFileSync(path.join(toolDir, f), 'x');
Object.assign(bundle, { table, dir: toolDir, config: path.join(tmp, 'openrgb-config'), pidFile: path.join(tmp, 'openrgb.pid.json') });
const spawned = [];
const { spawn } = await import('child_process');
od.spawn = (exePath, args, opts) => { spawned.push({ exePath, args, opts }); return spawn(process.execPath, [standIn, ...args], { ...opts, cwd: tmp }); };
let others = [];
od.running = async () => [...others];
let installedAt = null;
od.installed = () => installedAt;
const sys32 = (f) => /System32/i.test(f);
od.exists = (f) => sys32(f) || fs.existsSync(f);

let s1 = await orgb.status(false);
check(!s1.running && spawned.length === 0 && s1.bundle.canStart && s1.bundle.version === '1.1', `an ordinary read never starts it (${JSON.stringify(s1)})`);
s1 = await orgb.status(true);
const sp = spawned[0];
check(s1.running && s1.bundled && spawned.length === 1, `using the lights starts it once (${JSON.stringify(s1)})`);
if (sp) {
  const portArg = Number(sp.args[sp.args.indexOf('--server-port') + 1]);
  check(sp.args.includes('--server') && sp.args[sp.args.indexOf('--server-host') + 1] === '127.0.0.1' && portArg > 0 && portArg !== 6742, `SDK server on 127.0.0.1 and a free port (${sp.args.join(' ')})`);
  check(!sp.args.some((a) => /gui|autostart|startminimized/i.test(a)) && sp.args.includes('--noautoconnect') && sp.args[sp.args.indexOf('--config') + 1] === bundle.config, 'headless, no autostart, its own settings folder');
  check(sp.opts.windowsHide === true && sp.exePath === path.join(toolDir, 'OpenRGB.exe'), 'started hidden, from tools\\openrgb');
  check(JSON.parse(fs.readFileSync(bundle.pidFile, 'utf8')).port === portArg, 'its pid and port are noted (to take it over after a crash)');
}
await orgb.status(true);
check(spawned.length === 1, 'a second read uses the same one');
const writes = () => fs.readFileSync(standLog, 'utf8').split('\n').filter(Boolean).map(Number).filter((id) => id === 1050 || id === 1100 || id === 1101);
check(!s1.readOnly, `OpenRGB 1.1 inside DeviceHub: not read only (${s1.readOnly})`);
threw = null; try { await orgb.setColor('all', '#00ff00'); } catch (e) { threw = e.message; }
check(!/read-only/.test(threw || '') && /no OpenRGB lights/.test(threw || ''), `through 1.1 a color is attempted (${threw})`);
threw = null; try { await orgb.restore(); } catch (e) { threw = e.message; }
check(!/read-only/.test(threw || '') && /nothing changed/.test(threw || ''), `through 1.1 Put back is allowed (${threw})`);
// an older OpenRGB build in the bundle's place: read only, nothing written
fs.writeFileSync(exe11, BUILD_10);
const sOld = await orgb.status(true);
threw = null; try { await orgb.setColor('all', '#ff0000'); } catch (e) { threw = e.message; }
check(/before 1\.1/.test(sOld.readOnly || '') && /read-only/.test(threw || '') && /81bbe18/.test(threw) && !writes().length, `a 1.0 build is read only and gets no write (${threw})`);
// a table that turns writes off: refused too
fs.writeFileSync(exe11, BUILD_11);
bundle.table = { ...table, sdkWrites: false, sdkWritesNote: 'off for this test' };
threw = null; try { await orgb.setColor('all', '#ff0000'); } catch (e) { threw = e.message; }
check(/read-only.*off for this test/.test(threw || '') && !writes().length, `sdkWrites false: refused (${threw})`);
bundle.table = table;
check(bundle.hooked, 'it is stopped when DeviceHub quits (process exit hook)');
// DeviceHub crashed and came back: the one still running is taken over, not started twice
const oldPid = bundle.pid, oldPort = bundle.port;
Object.assign(bundle, { proc: null, pid: null, port: null });
others = [oldPid];
const s2 = await orgb.status(true);
check(s2.running && spawned.length === 1 && bundle.pid === oldPid && bundle.port === oldPort, 'a left-over bundled OpenRGB is taken over');
others = [];
orgb.stop();
let down = false;
for (let i = 0; i < 50 && !down; i++) { await wait(100); down = !(await new Promise((res) => { const c = net.connect({ host: '127.0.0.1', port: oldPort }); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); })); }
check(down && !fs.existsSync(bundle.pidFile), 'stop(): the process ends and its note is removed');
// another OpenRGB running, or installed: never a second one
others = [999999];
let s3 = await orgb.status(true);
check(!s3.running && spawned.length === 1 && /already running/.test(s3.reason), `another OpenRGB running: not started (${s3.reason})`);
others = []; installedAt = 'C:\\Program Files\\OpenRGB\\OpenRGB.exe';
s3 = await orgb.status(true);
check(!s3.running && spawned.length === 1 && /installed/.test(s3.reason), `an installed OpenRGB: not started (${s3.reason})`);
installedAt = null;
// a needed DLL missing from tools\openrgb (here PawnIOLib.dll): not started, and says why
fs.rmSync(path.join(toolDir, 'PawnIOLib.dll'));
s3 = await orgb.status(true);
check(!s3.running && spawned.length === 1 && /PawnIOLib\.dll/.test(s3.reason) && !s3.bundle.canStart, `without PawnIOLib.dll it is not started, and says why (${s3.reason})`);
fs.writeFileSync(path.join(toolDir, 'PawnIOLib.dll'), 'x');
check(bundleCheck().ok, 'with it back, it can start again');
// the Visual C++ runtime missing
bundle.table = table;
od.exists = (f) => (/System32/i.test(f) ? !/VCRUNTIME140_1/i.test(f) : fs.existsSync(f));
s3 = await orgb.status(true);
check(!s3.running && spawned.length === 1 && /Visual C\+\+/.test(s3.reason), `no Visual C++ runtime: not started (${s3.reason})`);
od.exists = (f) => sys32(f) || fs.existsSync(f);
// the person's own OpenRGB serving on the default port: an older build found running is read only, 1.1 is not
const own = (await import('child_process')).spawn(process.execPath, [standIn, '--server-host', '127.0.0.1', '--server-port', '46743'], { stdio: 'ignore', windowsHide: true });
for (let i = 0; i < 50; i++) { await wait(100); if (await new Promise((res) => { const c = net.connect({ host: '127.0.0.1', port: 46743 }); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); })) break; }
runningExes = [old10];
threw = null; try { await orgb.setColor('all', '#ff0000'); } catch (e) { threw = e.message; }
check(/read-only.*before 1\.1.*Update OpenRGB/.test(threw || '') && !writes().length && spawned.length === 1, `an older OpenRGB of the person's own is read only (${threw})`);
runningExes = []; installedAt = old10;
threw = null; try { await orgb.setColor('all', '#ff0000'); } catch (e) { threw = e.message; }
check(/before 1\.1/.test(threw || '') && !writes().length, 'when Windows does not name the running file, the installed one is checked');
installedAt = null; runningExes = [exe11];
threw = null; try { await orgb.setColor('all', '#ff0000'); } catch (e) { threw = e.message; }
check(!/read-only/.test(threw || '') && /no OpenRGB lights/.test(threw || '') && spawned.length === 1, `the person's own 1.1: a color is attempted through it, the bundled one not started (${threw})`);
own.kill();
orgb.stop();

await wait(200);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(fails.length ? `bundled-tools: FAILED: ${fails.join('; ')}` : 'bundled-tools (stand-in downloads, zips, installer and OpenRGB): all good');
process.exit(fails.length ? 1 : 0);
