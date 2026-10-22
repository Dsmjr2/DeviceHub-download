// Moving to another PC (22 Oct 2026; helpers/setup-extras.js, helpers/onedrive-setup.mjs): the setup file's extras are
// gathered, compared and put back without replacing anything already on the PC, and the OneDrive copy is written only
// when it changed. Run: node tests/setup-extras.mjs (no Windows, no devices)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-extras-'));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PNG2 = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(40, 2)]);

try {
  const { create } = require('../helpers/setup-extras.js');
  // PC A: names, a pick, a picture, one added driver (with a capture folder that must stay behind)
  const a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
  for (const r of [a, b]) fs.mkdirSync(path.join(r, 'my-devices'), { recursive: true });
  fs.writeFileSync(path.join(a, 'settings.json'), JSON.stringify({ headsetNames: { JACK_0000ABCD: 'ATH-M50x' }, headsetPick: 'JACK_0000ABCD', themeBg: 'ocean' }));
  fs.writeFileSync(path.join(a, 'background-picture.png'), PNG);
  fs.mkdirSync(path.join(a, 'my-devices', 'my-mouse', 'captures'), { recursive: true });
  fs.writeFileSync(path.join(a, 'my-devices', 'my-mouse', 'driver.json'), '{"name":"my mouse"}');
  fs.writeFileSync(path.join(a, 'my-devices', 'my-mouse', 'captures', 'x.json'), '{}');
  fs.mkdirSync(path.join(a, 'my-devices', '_example'));
  fs.writeFileSync(path.join(a, 'my-devices', '_example', 'device.mjs'), '//');
  const wpA = require('../helpers/wallpapers.js').create({ root: a, dir: path.join(tmp, 'wa'), backupsDir: path.join(tmp, 'wab'), startersDir: path.join(tmp, 'none') });
  const wpB = require('../helpers/wallpapers.js').create({ root: b, dir: path.join(tmp, 'wb'), backupsDir: path.join(tmp, 'wbb'), startersDir: path.join(tmp, 'none') });
  wpA.add('sky.png', PNG2);
  const A = create({ root: a, wallpapers: wpA }), B = create({ root: b, wallpapers: wpB });

  const x = A.gather({ withWallpapers: true });
  check(x.headsetNames.JACK_0000ABCD === 'ATH-M50x' && x.headsetPick === 'JACK_0000ABCD', 'names and pick gathered');
  check(x.background?.ext === 'png' && Buffer.from(x.background.data, 'base64').equals(PNG), 'background gathered');
  check(x.myDevices.length === 1 && x.myDevices[0].name === 'my-mouse' && Object.keys(x.myDevices[0].files).join() === 'driver.json', 'only the driver files, not captures or the example');
  check(x.wallpapers?.length === 1, 'wallpapers gathered when asked');
  check(!A.gather().wallpapers, 'no wallpapers unless asked');

  // PC B: everything is new
  const plan = B.plan(B.summarize(x));
  const what = plan.lines.map((l) => l.what).sort().join();
  check(what === 'background,drivers,headset-names,headset-pick,wallpapers', `plan lists every extra (${what})`);
  check(A.plan(A.summarize(x)).lines.length === 0, 'the same PC: nothing to change');

  // B already has a driver of the same name: kept, and said so
  fs.mkdirSync(path.join(b, 'my-devices', 'my-mouse'));
  fs.writeFileSync(path.join(b, 'my-devices', 'my-mouse', 'driver.json'), '{"name":"b own"}');
  check(B.plan(B.summarize(x)).lines.some((l) => l.what === 'drivers-kept'), 'a driver already here is listed as kept');
  fs.writeFileSync(path.join(b, 'settings.json'), JSON.stringify({ themeBg: 'black' }));
  const r = B.apply({ ...x, myDevices: [...x.myDevices, { name: 'evil', files: { '../../x.js': 'AA==' } }, { name: 'kbd', files: { 'driver.json': Buffer.from('{}').toString('base64') } }] });
  const sb = JSON.parse(fs.readFileSync(path.join(b, 'settings.json'), 'utf8'));
  check(sb.headsetNames.JACK_0000ABCD === 'ATH-M50x' && sb.headsetPick === 'JACK_0000ABCD' && sb.themeBg === 'black', 'names and pick added, other options kept');
  check(fs.readdirSync(path.join(b, 'backups')).some((f) => f.startsWith('settings-')), 'settings.json backed up first');
  check(fs.readFileSync(path.join(b, 'background-picture.png')).equals(PNG), 'background put here');
  check(fs.readFileSync(path.join(b, 'my-devices', 'my-mouse', 'driver.json'), 'utf8') === '{"name":"b own"}', 'a driver already here is never replaced');
  check(fs.existsSync(path.join(b, 'my-devices', 'kbd', 'driver.json')) && r.restart, 'a new driver added, restart asked');
  check(!fs.existsSync(path.join(b, 'my-devices', 'evil')) && !fs.existsSync(path.join(tmp, 'x.js')), 'a path outside its folder is refused');
  check(wpB.list().items.length === 1, 'wallpaper added');
  B.apply(x);
  check(wpB.list().items.length === 1, 'the same wallpaper is not added twice');
  check(B.plan(B.summarize(x)).lines.every((l) => l.what === 'drivers-kept'), 'after loading, nothing left to change');
  const bad = B.apply({ background: { ext: 'png', data: Buffer.from('not a png at all').toString('base64') } });
  check(!bad.done.includes('background picture'), 'a background that is not a picture is refused');

  // the OneDrive copy
  const od = await import('../helpers/onedrive-setup.mjs');
  const odDir = path.join(tmp, 'OneDrive');
  check(od.folder({ OneDrive: odDir }) === null, 'no OneDrive folder: none');
  fs.mkdirSync(odDir);
  check(od.folder({ OneDrive: odDir }) === path.join(odDir, 'DeviceHub'), 'OneDrive found from Windows\' variable');
  process.env.DEVICEHUB_ONEDRIVE_DIR = path.join(odDir, 'DeviceHub');
  od.useRoot(a);
  fs.writeFileSync(path.join(a, 'profiles.json'), '[{"name":"Games"}]');
  let reads = 0;
  const core = { devices: { mouse: {}, headset: {} }, copyFor: async (id) => { reads++; return id === 'mouse' ? { device: 'mouse', takenAt: new Date().toISOString(), data: { settings: { dpi0: 800 } } } : null; } };
  const s1 = await od.save(core, A);
  check(s1.saved && fs.existsSync(s1.file), 'first copy written');
  const f1 = JSON.parse(fs.readFileSync(s1.file, 'utf8'));
  check(f1.kind === 'devicehub-setup' && f1.devices.mouse.data.settings.dpi0 === 800 && f1.profiles[0].name === 'Games' && f1.extras.background && !f1.extras.wallpapers, 'the copy holds devices, profiles and extras, not wallpapers');
  const s2 = await od.save(core, A);
  check(s2.unchanged, 'unchanged: not written again');
  // another PC's copy shows up, and Not now puts it away until it changes
  fs.writeFileSync(path.join(odDir, 'DeviceHub', 'LAPTOP.devicehub-setup.json'), JSON.stringify(f1));
  let st = od.status();
  check(st.mine && st.others.length === 1 && st.others[0].pc === 'LAPTOP' && !st.others[0].seen, 'the other PC is listed');
  check(od.read('LAPTOP').kind === 'devicehub-setup', 'the other PC\'s copy can be read');
  let threw = false; try { od.read('../x'); } catch { threw = true; }
  check(threw, 'a bad PC name is refused');
  od.dismiss('LAPTOP');
  st = od.status();
  check(st.others[0].seen, 'Not now remembered');
  const s3 = await od.save(core, A);
  check(s3.unchanged, 'putting an offer away does not change this PC\'s copy');
} catch (e) { fails.push(`threw: ${e.stack}`); }
fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.error(`setup-extras: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('setup-extras: all good');
