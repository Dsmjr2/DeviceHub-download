// Offline test (15 Nov 2026, work map job 7): helpers/icue-eq.js, the HS80's iCUE EQ presets. APPDATA points at a temp
// folder with a made-up iCUE library and profile; tasklist, taskkill and starting iCUE are stand-ins (the real iCUE is
// never closed or started). Checks: parse/serialize keep the file's shape, every refusal, a save backs up, writes and
// reads back, and with iCUE running it is closed first and started again after.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-icue-'));
const CUE = path.join(TMP, 'Corsair', 'CUE5');
const LIB = path.join(CUE, 'eq_presets', 'unlimitedequalizerpresets.cuelibrary');
const BACKUPS = path.join(TMP, 'backups');
fs.mkdirSync(path.dirname(LIB), { recursive: true });
fs.mkdirSync(path.join(CUE, 'profiles'), { recursive: true });
fs.mkdirSync(BACKUPS);

// stand-ins for tasklist / taskkill / iCUE.exe, set before icue-eq.js takes them
const cp = require('node:child_process');
let running = false, killWorks = true;
const ran = [];
cp.execFile = (cmd, args, opts, cb) => {
  ran.push(`${cmd} ${args.join(' ')}`);
  if (cmd === 'tasklist') return cb(null, running ? '"iCUE.exe","1234","Console","1","200,000 K"' : 'INFO: No tasks are running');
  if (cmd === 'taskkill') { if (killWorks) running = false; return cb(null, ''); }
  return cb(new Error(`unexpected ${cmd}`));
};
const spawned = [];
cp.spawn = (exe) => { spawned.push(exe); return { unref() {} }; };
const realExists = fs.existsSync;
fs.existsSync = (p) => (/Corsair iCUE5 Software/i.test(String(p)) ? true : realExists(p));
// iCUE's 9 s settle after a restart and its 300 ms close checks, shortened
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 9000 ? 20 : ms === 300 ? 5 : ms, ...a);
process.env.APPDATA = TMP;
const eq = require('../helpers/icue-eq.js');

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const rejects = async (fn, re, what) => { try { await fn(); check(false, `${what} (no error)`); } catch (e) { check(re.test(e.message), `${what} (${e.message})`); } };

const BUILT = '{11111111-1111-1111-1111-111111111111}', MINE = '{22222222-2222-2222-2222-222222222222}', USED = '{33333333-3333-3333-3333-333333333333}';
const lib = {
  presets: [
    { id: BUILT, name: 'Pure Direct', stages: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], enabled: true, linkSliders: false },
    { id: MINE, name: 'Mine & <loud>', stages: [1.23456, 2, 3, 0, -1, -2, 0, 0, 4, 5], enabled: true, linkSliders: true },
    { id: USED, name: 'In use', stages: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1], enabled: false, linkSliders: false },
  ],
  defaults: [BUILT],
  forcePresetIndexChange: 'false',
};
fs.writeFileSync(LIB, eq.serialize(lib));
fs.writeFileSync(path.join(CUE, 'profiles', 'p.cueprofiledata'), `<x><activePresetId>${USED}</activePresetId><isUnlimited>true</isUnlimited><selector>2</selector></x>`);

try {
  // parse and serialize
  const p = eq.parse(fs.readFileSync(LIB, 'utf8'));
  check(p.presets.length === 3 && p.presets[0].builtIn && !p.presets[1].builtIn, 'parse: three presets, the built-in one marked');
  check(p.presets[1].name === 'Mine & <loud>' && p.presets[1].stages[0] === 1.23456 && p.presets[1].linkSliders === true, 'parse: names unescaped, exact band values, flags');
  check(eq.serialize(p) === fs.readFileSync(LIB, 'utf8'), 'serialize(parse(file)) gives the same file');
  check(eq.BANDS.length === 10, 'ten bands');
  let bad = null;
  try { eq.parse(fs.readFileSync(LIB, 'utf8').replace(/<value9>5<\/value9>/, '')); } catch (e) { bad = e; }
  check(bad && /not in the shape/.test(bad.message), 'a preset with 9 bands: the file is not touched');
  bad = null;
  try { eq.parse('<cereal></cereal>'); } catch (e) { bad = e; }
  check(bad && /no <presets>/.test(bad.message), 'no presets list: refused');

  const r = await eq.read();
  check(r.available && r.presets.length === 3 && r.slots.length === 1 && r.slots[0].slot === 2 && r.icueRunning === false, 'read: presets, the slot in use, iCUE not running');

  // refusals: the file stays as it was and nothing is closed
  const orig = fs.readFileSync(LIB, 'utf8');
  const list = () => eq.parse(orig).presets.map(({ id, name, stages }) => ({ id, name, stages: [...stages] }));
  const edit = (f) => { const l = list(); f(l); return { presets: l }; };
  await rejects(() => eq.save({ presets: [] }, BACKUPS), /whole preset list/, 'an empty list is refused');
  await rejects(() => eq.save(edit((l) => { l[1].stages[3] = 13; }), BACKUPS), /between -12 and \+12/, 'a band over +12 dB is refused');
  await rejects(() => eq.save(edit((l) => { l[1].stages.pop(); }), BACKUPS), /10 bands/, 'nine bands are refused');
  await rejects(() => eq.save(edit((l) => { l[1].name = '  '; }), BACKUPS), /needs a name/, 'a blank name is refused');
  await rejects(() => eq.save(edit((l) => { l[1].id = '{99999999-9999-9999-9999-999999999999}'; }), BACKUPS), /unknown preset id/, 'an unknown id is refused');
  await rejects(() => eq.save(edit((l) => { l[0].stages[0] = 1; }), BACKUPS), /built-in presets/, 'changing a built-in preset is refused');
  await rejects(() => eq.save(edit((l) => { l.splice(0, 1); }), BACKUPS), /built in and cannot be deleted/, 'deleting a built-in preset is refused');
  await rejects(() => eq.save(edit((l) => { l.splice(2, 1); }), BACKUPS), /in use in iCUE/, 'deleting a preset iCUE uses is refused');
  check(fs.readFileSync(LIB, 'utf8') === orig && !fs.readdirSync(BACKUPS).length && !ran.some((c) => c.startsWith('taskkill')), 'after every refusal: file unchanged, no backup, iCUE not closed');

  // a save with iCUE closed: backup, write, read back; unchanged bands keep iCUE's exact value, edited ones rounded
  const s1 = await eq.save(edit((l) => { l[1].stages[1] = 2.3456; l.push({ name: 'New one', stages: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }); }), BACKUPS);
  const after = eq.parse(fs.readFileSync(LIB, 'utf8'));
  const mine = after.presets.find((x) => x.id === MINE), added = after.presets.find((x) => x.name === 'New one');
  check(s1.ok && !s1.restartedIcue && fs.existsSync(path.join(BACKUPS, s1.backup)), 'saved, with a backup, iCUE not restarted (it was not running)');
  check(fs.readFileSync(path.join(BACKUPS, s1.backup), 'utf8') === orig, 'the backup is the file before');
  check(mine.stages[0] === 1.23456 && mine.stages[1] === 2.35, 'an unchanged band keeps its exact value; an edited one is rounded to 0.01 dB');
  check(added && /^\{[0-9a-f-]{36}\}$/i.test(added.id) && added.enabled && !added.linkSliders, 'a new preset gets an id');
  check(!spawned.length, 'iCUE not started when it was not running');

  // a save with iCUE running: closed, written, started again
  running = true;
  ran.length = 0;
  const s2 = await eq.save(edit((l) => { l[1].stages[9] = -3; }), BACKUPS);
  check(s2.restartedIcue && ran.some((c) => /^taskkill \/IM iCUE\.exe/.test(c)), 'iCUE running: closed before the write');
  check(spawned.length === 1 && /iCUE\.exe$/.test(spawned[0]), 'and started again after');
  check(eq.parse(fs.readFileSync(LIB, 'utf8')).presets.find((x) => x.id === MINE).stages[9] === -3, 'the change is in the file');

  // iCUE that will not close: nothing changed
  running = true;
  killWorks = false;
  const was = fs.readFileSync(LIB, 'utf8');
  await rejects(() => eq.save(edit((l) => { l[1].stages[9] = -4; }), BACKUPS), /did not close; nothing was changed/, 'iCUE that does not close: refused');
  check(fs.readFileSync(LIB, 'utf8') === was, 'and the file is unchanged');
} finally {
  fs.existsSync = realExists;
  globalThis.setTimeout = realSetTimeout;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`icue-eq (presets file, refusals, backup, iCUE closed and started again): all ${n} passed`);
process.exit(0);
