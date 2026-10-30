// "Bring over from G HUB" (helpers/maker-profiles.mjs, public/ui/maker-import.js): G HUB's mouse setups found in its JSON,
// read from a COPY of its database (the original is never opened or changed), and each made into a DeviceHub profile
// only on a click. Run: node tests/maker-profiles.mjs (no G HUB needed: a pretend settings.db is built here)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { findSetups, modelOf, readGhub, status } from '../helpers/maker-profiles.mjs';
import { profileFrom, LOGITECH_ID } from '../public/ui/maker-import.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const GHUB = { cards: { cards: [
  { id: 'c1', name: 'Default', slotId: 'g502_hero_mouse_settings', attribute: 'MOUSE_SETTINGS', mouseSettings: { dpiStages: [{ dpi: 800 }, { dpi: 1600 }, { dpi: 3200 }], defaultDpiIndex: 1, reportRate: 1000 } },
  { id: 'c2', name: 'Valorant', slotId: 'g_pro_x_superlight_mouse_settings', mouseSettings: { dpiStages: [400, 800], reportRate: 500 } },
  { id: 'c3', name: 'Junk', mouseSettings: { dpiStages: [-5, 'x', 999999], reportRate: 1234 } },
] }, profiles: { profiles: [{ id: 'p1', name: 'Desktop' }] } };

const s = findSetups(GHUB);
ok(s.length === 2, `two real setups, the junk one left out (${JSON.stringify(s)})`);
ok(s[0].name === 'Default' && s[0].model === 'G502 HERO' && s[0].dpi === 1600 && s[0].dpis.join() === '800,1600,3200' && s[0].reportRate === 1000, 'the default stage is the DPI; the stages and the rate');
ok(s[1].model === 'G PRO X SUPERLIGHT' && s[1].dpi === 400 && s[1].reportRate === 500, 'numbers as stages; no default index: the first stage');
ok(modelOf('g502_hero_mouse_settings') === 'G502 HERO' && modelOf('nothing') === null, 'the model from the slot id');
ok(findSetups(null).length === 0 && findSetups({ a: { b: { c: 1 } } }).length === 0, 'nothing there: nothing found');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ghubtest-'));
try {
  const file = path.join(tmp, 'settings.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE data (_id INTEGER PRIMARY KEY, _date_created TEXT, file BLOB); CREATE TABLE other (x TEXT)');
  db.prepare('INSERT INTO data (_date_created, file) VALUES (?, ?)').run('2026-10-29', Buffer.from(JSON.stringify(GHUB), 'utf8'));
  db.prepare('INSERT INTO other (x) VALUES (?)').run('not json at all');
  db.close();
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = hash(), mtime = fs.statSync(file).mtimeMs;
  const r = await readGhub({ file });
  ok(r.found && r.setups.length === 2 && r.setups[0].dpi === 1600 && !r.why, `read from a real SQLite file (${JSON.stringify(r).slice(0, 200)})`);
  ok(hash() === before && fs.statSync(file).mtimeMs === mtime, "G HUB's own file is not changed");
  ok(!fs.readdirSync(os.tmpdir()).some((n) => n.startsWith('dh-ghub-') && fs.existsSync(path.join(os.tmpdir(), n, 'settings.db')) && fs.statSync(path.join(os.tmpdir(), n)).mtimeMs > Date.now() - 5000), 'its copy is deleted after');
  const none = await readGhub({ file: path.join(tmp, 'nope.db') });
  ok(!none.found && /not on this PC/.test(none.why), 'no G HUB: says so');
  fs.writeFileSync(path.join(tmp, 'broken.db'), 'this is not a database');
  const broken = await readGhub({ file: path.join(tmp, 'broken.db') });
  ok(broken.found && broken.setups.length === 0 && /could not be read/.test(broken.why), 'a damaged file: a plain line, no crash');
  const st = await status({ ghub: { file }, icue: { dir: path.join(tmp, 'no-icue') } });
  ok(st.ok && st.ghub.setups.length === 2 && st.icue.found === false, 'the route answer');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// the profile one setup becomes
const p = profileFrom(s[0], ['G HUB Default'], 2);
ok(p.name === 'G HUB Default 2' && p.added[LOGITECH_ID].values.dpi === 1600 && p.added[LOGITECH_ID].values.reportRate === 1000 && /G502 HERO/.test(p.added[LOGITECH_ID].title) && JSON.stringify(p.devices) === '{}', `a profile for the Logitech driver, a name not taken (${JSON.stringify(p)})`);
ok(profileFrom({ name: 'x', dpi: null, reportRate: null }) === null, 'nothing to bring over: no profile');
const driver = fs.readFileSync(path.join(REAL, 'device-library/logitech-hidpp-mouse/device.mjs'), 'utf8');
ok(new RegExp(`id: '${LOGITECH_ID}'`).test(driver) && /key: 'dpi'/.test(driver) && /key: 'reportRate'/.test(driver), "the profile's id and keys are the Logitech driver's own");

// read-only, and only on a click
const src = fs.readFileSync(path.join(REAL, 'helpers/maker-profiles.mjs'), 'utf8').replace(/\/\/.*$/gm, '');
ok(/readOnly: true/.test(src) && /copyFileSync\(file, copy\)/.test(src) && /new DatabaseSync\(file, \{ readOnly: true \}\)/.test(src) && !/writeFileSync|unlinkSync\(file|DatabaseSync\(GHUB/.test(src), 'only a copy is opened, read-only');
const ui = fs.readFileSync(path.join(REAL, 'public/ui/maker-import.js'), 'utf8');
ok(/button\('Make a profile', \(\) => make\(s, i\)/.test(ui) && !/\/api\/agent\/write|write\(/.test(ui.replace(/\/\/.*$/gm, '')), 'a profile is made on a click; nothing is written to the mouse');
ok(/makerImportCard\(/.test(fs.readFileSync(path.join(REAL, 'public/pages/profiles.js'), 'utf8')) && /'\/api\/maker-profiles'/.test(fs.readFileSync(path.join(REAL, 'server.js'), 'utf8')), 'the Profiles page and the route');

if (fails.length) { console.log(`maker-profiles: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('maker-profiles (G HUB setups from a read-only copy, made into profiles on a click): all good');
