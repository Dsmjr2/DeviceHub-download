// Wallpapers (22 Oct 2026; helpers/wallpapers.js): starters added once, add (checked by first bytes, duplicates skipped,
// names made safe), list, file serving that never leaves the folder, remove, back up, use as DeviceHub's background, and
// the Windows wallpaper steps with a stand-in PowerShell. Everything in temporary folders; the real Pictures, Documents
// and DeviceHub folders are never touched. Run: node tests/wallpapers.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { create, _test: { size, safeFileName, PS_SET } } = require('../helpers/wallpapers.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-wallpapers-'));
const dirs = { dir: path.join(tmp, 'Pictures', 'DeviceHub Wallpapers'), backupsDir: path.join(tmp, 'Documents', 'DeviceHub backups'), root: path.join(tmp, 'DeviceHub') };
fs.mkdirSync(dirs.root, { recursive: true });
dirs.startersDir = fileURLToPath(new URL('../wallpapers-starter', import.meta.url));   // the shipped six, read only

// a real, tiny PNG of w x h, its color from seed (so each one has different bytes)
function png(w, h, seed = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let i = 0; i < raw.length; i++) raw[i] = i % (w * 3 + 1) === 0 ? 0 : (seed * 37 + i) & 0xff;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- starters: added once, a deleted one never comes back ----
const shipped = fs.readdirSync(dirs.startersDir).filter((f) => f.endsWith('.jpg'));
check(shipped.length === 6, `six starter wallpapers ship (found ${shipped.length})`);
check(shipped.reduce((s, f) => s + fs.statSync(path.join(dirs.startersDir, f)).size, 0) < 3 * 1024 * 1024, 'the starters are under 3 MB together');
for (const f of shipped) { const b = fs.readFileSync(path.join(dirs.startersDir, f)); const s = size(b); check(s && s.width === 2560 && s.height === 1440, `${f} is 2560 x 1440 (read from its header: ${JSON.stringify(s)})`); }

const wp = create(dirs);
let l = wp.list();
check(l.items.length === 6 && l.dir === path.resolve(dirs.dir), `the first list adds the 6 starters (got ${l.items.length})`);
check(fs.existsSync(path.join(dirs.dir, '.devicehub-starters')), 'a marker says the starters were added');
check(l.items.some((x) => x.name === 'Aurora.jpg' && x.width === 2560 && x.type === 'image/jpeg'), 'Aurora.jpg is listed with its size and type');
wp.remove('Aurora.jpg');
check(create(dirs).list().items.length === 5, 'a deleted starter does not come back on the next list (or after an update)');
check(!create(dirs).list().items.some((x) => x.name.startsWith('.')), 'the marker is not listed');

// ---- add ----
const a = wp.add('Sunset.png', png(32, 20, 1));
check(a.ok && a.name === 'Sunset.png', 'a PNG is added under its own name');
check(wp.add('other name.png', png(32, 20, 1)).duplicate === true, 'an exact copy is skipped as a duplicate');
check(wp.add('Sunset.png', png(32, 20, 2)).name === 'Sunset (2).png', 'a different picture with a taken name gets a number');
check(wp.add('sunset.PNG', png(32, 20, 3)).name === 'sunset (3).png', 'names that differ only in case count as taken (Windows ignores case)');
const bad = (() => { try { wp.add('evil.png', Buffer.from('MZ this is not a picture at all, just bytes')); return null; } catch (e) { return e; } })();
check(bad && /Not a picture/.test(bad.message), 'bytes that are not a picture are refused');
const big = (() => { try { wp.add('big.png', Buffer.concat([png(4, 4, 9), Buffer.alloc(40 * 1024 * 1024)])); return null; } catch (e) { return e; } })();
check(big && big.code === 413, 'a picture over 40 MB is refused');
check(wp.add('../../escape.png', png(8, 8, 4)).name === 'escape.png' && !fs.existsSync(path.join(dirs.dir, '..', 'escape.png')), 'a name with folders is cut to its last part, saved inside the folder');
check(wp.add('C:\\Windows\\win.ini.png', png(8, 8, 5)).name === 'win.ini.png', 'a Windows path is cut to its last part');
check(wp.add('a<b>c:d|e?f*.jpg', png(8, 8, 6)).name === 'a b c d e f.png', 'characters Windows refuses are replaced, and the extension is what the picture really is');
check(wp.add('CON.png', png(8, 8, 7)).name === 'CON picture.png', 'a reserved device name is changed');
check(wp.add('...', png(8, 8, 8)).name === 'wallpaper.png', 'a name of only dots becomes "wallpaper"');
check(safeFileName('.hidden.webp', 'webp') === 'hidden.webp', 'leading dots are removed (no hidden files)');

// ---- list ----
l = wp.list();
const sunset = l.items.find((x) => x.name === 'Sunset.png');
check(sunset && sunset.width === 32 && sunset.height === 20 && sunset.bytes > 0 && sunset.addedAt, 'list gives size, width, height and when it was added');
check(l.totalBytes === l.items.reduce((s, x) => s + x.bytes, 0), 'list gives the total size');
check(l.items.every((x, i, all) => !i || all[i - 1].addedAt >= x.addedAt), 'newest first');

// ---- names from the page: only a plain file name in the folder ----
fs.writeFileSync(path.join(tmp, 'Pictures', 'secret.png'), png(4, 4, 10));
for (const n of ['../secret.png', '..\\secret.png', '..', '.', '', 'sub/x.png', 'C:\\x.png', '/etc/passwd', '.devicehub-starters', 'Sunset.png\u0000.txt', 'nothere.png', 'Sunset.txt', null, 42]) {
  let refused = false; try { wp.file(n); } catch { refused = true; }
  check(refused, `file(${JSON.stringify(n)}) is refused`);
  let removed = true; try { wp.remove(n); } catch { removed = false; }
  check(!removed, `remove(${JSON.stringify(n)}) is refused`);
}
check(fs.existsSync(path.join(tmp, 'Pictures', 'secret.png')), 'nothing outside the folder was removed');
check(wp.file('Sunset.png').type === 'image/png', 'a real one is found');

// ---- the routes, over HTTP, as server.js calls them ----
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => resolve(d ? JSON.parse(d) : {})); });
const server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://x'); if (await wp.handle(url, req, res, send, readBody) === false) send(res, 404, { error: 'not found' }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (p) => fetch(base + p);
const post = (p, body, raw) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }, body: raw || JSON.stringify(body || {}) });
try {
  const r = await (await get('/api/wallpapers')).json();
  check(Array.isArray(r.items) && r.items.length === l.items.length && r.windows === (process.platform === 'win32'), 'GET /api/wallpapers lists them');
  const f = await get('/api/wallpapers/file?name=Sunset.png');
  check(f.status === 200 && f.headers.get('content-type') === 'image/png' && Buffer.from(await f.arrayBuffer()).equals(fs.readFileSync(path.join(dirs.dir, 'Sunset.png'))), 'GET /api/wallpapers/file serves the picture');
  for (const n of ['../secret.png', '..%2Fsecret.png', '..%5Csecret.png', '%2Fetc%2Fpasswd', '']) check((await get(`/api/wallpapers/file?name=${n}`)).status === 404, `GET file?name=${n} is refused`);
  const s = await get(`/api/wallpapers/starter?name=${encodeURIComponent('Nebula.jpg')}`);
  check(s.status === 200 && s.headers.get('content-type') === 'image/jpeg', 'a starter is served read-only (demo mode)');
  check((await get('/api/wallpapers/starter?name=..%2Fpackage.json')).status === 404, 'only the starters themselves are served from there');
  check((await (await get('/api/wallpapers/starters')).json()).items.length === 6, 'GET /api/wallpapers/starters lists the six');
  check((await get('/api/wallpapers/remove?name=Sunset.png')).status === 405 && fs.existsSync(path.join(dirs.dir, 'Sunset.png')), 'a GET never changes anything');
  const added = await (await post('/api/wallpapers/add?name=Route.png', null, png(16, 9, 11))).json();
  check(added.ok && added.name === 'Route.png', 'POST /api/wallpapers/add saves the raw picture');
  check((await (await post('/api/wallpapers/add?name=again.png', null, png(16, 9, 11))).json()).duplicate === true, 'POST add answers duplicate for a copy');
  check((await post('/api/wallpapers/add?name=x.png', null, Buffer.from('not a picture'))).status === 400, 'POST add refuses what is not a picture');
  check((await (await post('/api/wallpapers/remove', { name: 'Route.png' })).json()).ok && !fs.existsSync(path.join(dirs.dir, 'Route.png')), 'POST /api/wallpapers/remove deletes it');
  check((await post('/api/wallpapers/remove', { name: '../secret.png' })).status === 400, 'POST remove refuses a path');
} finally { server.close(); }

// ---- back up ----
const now = new Date(2026, 9, 22, 14, 5);
const b1 = wp.backup(now);
const inFolder = fs.readdirSync(dirs.dir).filter((f) => !f.startsWith('.'));
check(b1.ok && b1.count === inFolder.length && b1.dir === path.join(path.resolve(dirs.backupsDir), 'Wallpapers 2026-10-22 14-05'), `backup copies every picture to Wallpapers <date time> (${b1.dir})`);
check(inFolder.every((f) => fs.readFileSync(path.join(b1.dir, f)).equals(fs.readFileSync(path.join(dirs.dir, f)))), 'each backed-up picture has the same bytes');
check(!fs.existsSync(path.join(b1.dir, '.devicehub-starters')), 'the marker is not backed up');
check(wp.backup(now).dir.endsWith('Wallpapers 2026-10-22 14-05 (2)'), 'a second backup in the same minute gets its own folder');
const emptyWp = create({ ...dirs, dir: path.join(tmp, 'empty'), startersDir: path.join(tmp, 'no-starters') });
check(emptyWp.backup().count === 0 && emptyWp.list().items.length === 0, 'an empty folder (no starters) has nothing to back up');

// ---- use as DeviceHub's background ----
fs.writeFileSync(path.join(dirs.root, 'background-picture.webp'), 'old');
check(wp.useAsBackground('Sunset.png').ok && fs.readFileSync(path.join(dirs.root, 'background-picture.png')).equals(fs.readFileSync(path.join(dirs.dir, 'Sunset.png'))), "use as background writes background-picture.png in DeviceHub's folder");
check(!fs.existsSync(path.join(dirs.root, 'background-picture.webp')), 'the old background picture is replaced');
fs.writeFileSync(path.join(dirs.dir, 'Old.bmp'), Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)]));
let bmpRefused = false; try { wp.useAsBackground('Old.bmp'); } catch { bmpRefused = true; }
check(bmpRefused, "a BMP is refused as DeviceHub's background (it takes PNG, JPEG or WebP)");

// ---- the Windows wallpaper, with a stand-in PowerShell ----
let winReg = 'C:\\Users\\Me\\Pictures\\beach.jpg';
const calls = [];
const fakePs = async (script, env) => {
  calls.push({ script, env });
  if (script.includes('SystemParametersInfo')) winReg = env.DEVICEHUB_WALLPAPER;
  return `${winReg}\r\n`;
};
const winWp = create({ ...dirs, platform: 'win32', powershell: fakePs });
const isWin = process.platform === 'win32';
if (!isWin) {
  // path checks below compare with path.resolve, which on Linux keeps a Windows path as text: compare as written
  const r = await winWp.setWindows('Sunset.png').catch((e) => ({ error: e.message }));
  check(r.ok, `set-windows runs (${r.error || ''})`);
  check(calls.some((c) => c.env.DEVICEHUB_WALLPAPER === path.join(path.resolve(dirs.dir), 'Sunset.png')), 'the picture path goes to PowerShell in an environment variable');
  check(calls.every((c) => !c.script.includes('Sunset')), 'no file name is ever part of the script text');
  const kept = JSON.parse(fs.readFileSync(path.join(dirs.root, 'wallpaper-previous', 'previous.json'), 'utf8'));
  check(kept.path === 'C:\\Users\\Me\\Pictures\\beach.jpg', 'the wallpaper Windows had is kept first');
  await winWp.setWindows('Sunset (2).png');
  check(JSON.parse(fs.readFileSync(path.join(dirs.root, 'wallpaper-previous', 'previous.json'), 'utf8')).path === kept.path, 'setting a second one keeps the first earlier wallpaper, not the one DeviceHub set');
  let jpgRefusedWebp = false; fs.writeFileSync(path.join(dirs.dir, 'w.webp'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(30)]));
  try { await winWp.setWindows('w.webp'); } catch { jpgRefusedWebp = true; }
  check(jpgRefusedWebp, 'Windows gets only JPEG, PNG or BMP');
  // Put back: the earlier path is not on this (test) machine, and no copy could be made of it: a clear error
  const pb = await winWp.putBackWindows().catch((e) => ({ error: e.message }));
  check(pb.error && /no longer there/.test(pb.error), `put back says when the earlier wallpaper is gone (${pb.error})`);
  // an earlier wallpaper that is a real file: it is copied, and put back restores it
  fs.rmSync(path.join(dirs.root, 'wallpaper-previous'), { recursive: true });
  const earlier = path.join(tmp, 'earlier.png'); fs.writeFileSync(earlier, png(8, 8, 20)); winReg = earlier;
  await winWp.setWindows('Sunset.png');
  check(fs.existsSync(path.join(dirs.root, 'wallpaper-previous', 'previous.png')), 'a copy of the earlier wallpaper is kept (Windows overwrites its own copy)');
  const back = await winWp.putBackWindows();
  check(back.ok && winReg === earlier, 'put back sets the earlier wallpaper again');
  check(!fs.existsSync(path.join(dirs.root, 'wallpaper-previous', 'previous.json')), 'after put back nothing is kept');
  // a mismatch on read-back is reported
  const liar = create({ ...dirs, platform: 'win32', powershell: async () => 'C:\\other.jpg' });
  const lr = await liar.setWindows('Sunset.png').catch((e) => ({ error: e.message }));
  check(lr.error && /did not take it/.test(lr.error), 'a wallpaper Windows did not take is reported as failed');
}
const nonWin = create({ ...dirs, platform: 'linux' });
check(await nonWin.setWindows('Sunset.png').then(() => false, (e) => /Windows only/.test(e.message)), 'other systems get a clear answer for the Windows wallpaper');
check(PS_SET.includes('$env:DEVICEHUB_WALLPAPER') && PS_SET.includes('0x14') && /, 3\)\)/.test(PS_SET), 'the script calls SystemParametersInfo(0x14, 0, path, 3) with the path from the environment');

fs.rmSync(tmp, { recursive: true, force: true });
// previews and renaming (22 Oct 2026: "make the wallpaper area faster", "make the names easily editable")
{
  const wq = create({ ...dirs, dir: path.join(tmp, 'Quick') });
  const a = wq.add('Sunset.png', png(8, 5, 91)), b = wq.add('Other.png', png(8, 5, 92));
  check(wq.list().items.every((x) => x.thumb === false), 'no preview before the page makes one');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  wq.saveThumb(a.name, jpeg);
  check(wq.list().items.find((x) => x.name === a.name)?.thumb === true && wq.thumbFile(a.name).st.size === jpeg.length, 'a saved preview is listed and served');
  let threw = 0;
  for (const [n, buf] of [[a.name, png(4, 4, 1)], [a.name, Buffer.alloc(700 * 1024, 0xff)], ['../x.png', jpeg], ['missing.png', jpeg]]) { try { wq.saveThumb(n, buf); } catch { threw++; } }
  check(threw === 4, 'a preview must be a small JPEG for a picture that is there');
  const r = wq.rename(a.name, '  My: favourite?  ');
  check(r.name === 'My favourite.png' && fs.existsSync(path.join(wq.dir, 'My favourite.png')) && !fs.existsSync(path.join(wq.dir, a.name)), `renamed safely, extension kept (${r.name})`);
  check(wq.list().items.find((x) => x.name === r.name)?.thumb === true, 'the preview follows the rename');
  let clash = null; try { wq.rename(b.name, 'my FAVOURITE'); } catch (e) { clash = e; }
  check(clash && /already has that name/.test(clash.message) && fs.existsSync(path.join(wq.dir, b.name)), 'never renamed over another picture (case ignored, as Windows does)');
  check(wq.rename(r.name, 'My Favourite').name === 'My Favourite.png', 'a change of case only works too');
  let bad = 0; for (const n of ['../evil.png', '.hidden.png', 'nope.png']) { try { wq.rename(n, 'x'); } catch { bad++; } }
  check(bad === 3, 'only a picture in the folder can be renamed');
  wq.remove('My Favourite.png');
  check(!fs.existsSync(path.join(wq.dir, '.thumbs', 'My Favourite.png.jpg')), 'deleting a picture deletes its preview');
}
if (fails.length) { console.log(`wallpapers: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('wallpapers (starters once, add, list, safe names, file serving, remove, backup, background, Windows wallpaper steps): all good');
