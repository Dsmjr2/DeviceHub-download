// Offline test (15 Nov 2026, deepening tests after work map jobs 1-10): helpers/weekly-setup.mjs, the weekly setup
// file. Run in a copy of the module in a temp folder (it writes beside the app: setups\, reads backups\ and data\);
// the devices are a stand-in core. Checks: due once a week, a connected device read fresh, an unplugged one from its
// newest backup, nothing at all = no file, a second file the same day gets its own name, only the newest 6 kept,
// read() refuses any other file name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-weekly-'));
fs.mkdirSync(path.join(T, 'helpers'));
for (const f of ['weekly-setup.mjs', 'safe-write.js']) fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T, 'helpers', f));
fs.mkdirSync(path.join(T, 'backups'));
fs.mkdirSync(path.join(T, 'data'));
fs.writeFileSync(path.join(T, 'data', 'profiles.json'), JSON.stringify([{ name: 'Gaming' }]));
fs.writeFileSync(path.join(T, 'data', 'settings.json'), JSON.stringify({ artStyle: 'live' }));
fs.writeFileSync(path.join(T, 'data', 'game-mode.json'), JSON.stringify({ games: [{ id: 'g', exes: ['game.exe'] }] }));
const B = (name, data, ageMs) => { const f = path.join(T, 'backups', name); fs.writeFileSync(f, JSON.stringify(data)); const t = (Date.now() - ageMs) / 1000; fs.utimesSync(f, t, t); };
B('headset-old.json', { led: '#111111' }, 3 * 86400000);
B('headset-new.json', { led: '#222222' }, 86400000);

const weekly = await import(pathToFileURL(path.join(T, 'helpers', 'weekly-setup.mjs')).href);
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const logs = [];
const log = (t, k) => logs.push([t, k]);
let backups = 0;
const core = {
  devices: {
    mouse: { status: 'connected', adapter: { title: 'Mouse' } },
    headset: { status: 'missing', adapter: { title: 'HS80' } },
    keyboard: { status: 'connected', adapter: { title: 'P75' } },
  },
  async backupNow(id) {
    if (id === 'keyboard' && core.kbFails) throw new Error('read failed');
    backups++;
    const name = `${id}-fresh-${backups}.json`;
    fs.writeFileSync(path.join(T, 'backups', name), JSON.stringify({ fresh: id }));
    return name;
  },
};

try {
  check(weekly.list().length === 0, 'no setup files at first');
  const first = await weekly.saveIfDue(core, log);
  check(/^DeviceHub setup \d{4}-\d{2}-\d{2}\.json$/.test(first || ''), `saved (${first})`);
  const j = weekly.read(first);
  check(j.kind === 'devicehub-setup' && j.weekly === true, 'the same kind of file Save setup file makes');
  check(j.devices.mouse?.fresh === 'mouse' && j.devices.keyboard?.fresh === 'keyboard', 'connected devices read fresh');
  check(j.devices.headset?.led === '#222222', 'an unplugged device from its newest backup');
  check(j.profiles[0]?.name === 'Gaming' && j.sound.settings.artStyle === 'live' && j.games?.length === 1, 'profiles, sound settings and Game mode games carried');
  check(!('gameSettings' in j), 'no game settings in a copy that is not the owner\'s');
  check(logs.some(([t, k]) => /from the newest backup: HS80/.test(t) && k === 'good'), 'one Activity line naming the device taken from a backup');

  check((await weekly.saveIfDue(core, log)) === null, 'not due again within the week');

  // a device whose fresh read fails: its newest backup instead
  core.kbFails = true;
  B('keyboard-kept.json', { kept: true }, -60000);   // newer than any fresh read so far
  const second = await weekly.saveIfDue(core, log, { force: true });
  check(/ 2\.json$/.test(second || ''), `a second file the same day gets its own name (${second})`);
  check(weekly.read(second).devices.keyboard?.kept === true, 'a failed fresh read falls back to the newest backup');
  core.kbFails = false;

  // only the newest 6 are kept
  for (let i = 0; i < 6; i++) await weekly.saveIfDue(core, log, { force: true });
  const names = weekly.list().map((f) => f.name);
  check(names.length === 6, `only the newest 6 kept (${names.length})`);
  // (a freed name is used again by a later save; the list goes by time)
  check(!names.some((x) => weekly.read(x).savedAt === j.savedAt), 'the oldest was removed');

  // nothing connected and no backups: no file
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-weekly-empty-'));
  fs.mkdirSync(path.join(t2, 'helpers')); fs.mkdirSync(path.join(t2, 'backups'));
  for (const f of ['weekly-setup.mjs', 'safe-write.js']) fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(t2, 'helpers', f));
  const w2 = await import(pathToFileURL(path.join(t2, 'helpers', 'weekly-setup.mjs')).href);
  const none = await w2.saveIfDue({ devices: { mouse: { status: 'missing', adapter: { title: 'Mouse' } } } }, log);
  check(none === null && !fs.existsSync(path.join(t2, 'setups')), 'no device and no backup: no file');
  fs.rmSync(t2, { recursive: true, force: true });

  // read() only reads a setup file by its own name
  for (const bad of ['..\\data\\settings.json', 'DeviceHub setup 2026-11-15.json\\..\\x.json', 'other.json']) {
    let threw = false;
    try { weekly.read(bad); } catch (e) { threw = /not a setup file name/.test(e.message); }
    check(threw, `read refuses "${bad}"`);
  }
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`weekly-setup (due weekly, fresh or from backup, newest 6, names): all ${n} passed`);
process.exit(0);
