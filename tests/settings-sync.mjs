// Offline test: helpers/settings-sync.js — _apply() option allowlisting, profile-wipe guard,
// backup creation before overwrite, and sync() safety guards (settingsSync:false, corrupt state, no .git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-sync-'));
fs.mkdirSync(path.join(T, 'helpers'));
fs.mkdirSync(path.join(T, 'data'));
for (const f of ['settings-sync.js', 'safe-write.js', 'power.js', 'data-dir.js']) {
  fs.copyFileSync(path.join(ROOT, 'helpers', f), path.join(T, 'helpers', f));
}

const require = createRequire(import.meta.url);
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  const settingsPath = path.join(T, 'data', 'settings.json');
  const profilesPath = path.join(T, 'data', 'profiles.json');
  const statePath = path.join(T, 'data', 'settings-sync-state.json');

  fs.writeFileSync(settingsPath, JSON.stringify({ themeBg: 'dark', keepExtra: 42 }));
  fs.writeFileSync(profilesPath, JSON.stringify([{ id: 'p1', name: 'Work' }]));

  const syncMod = require(path.join(T, 'helpers', 'settings-sync.js'));

  // 1. Invalid remote inputs are ignored cleanly
  for (const bad of [null, undefined, [], 'str']) {
    const res = await syncMod._apply(bad, { options: {}, profiles: [] });
    check(Array.isArray(res) && res.length === 0, `_apply ignores invalid remote (${String(bad)})`);
  }

  // 2. Options allowlist & prototype-pollution guard + backup creation
  const changed1 = await syncMod._apply(
    {
      options: { themeBg: 'midnight', __proto__: { polluted: true }, evilKey: 'nope' },
      profiles: [],
    },
    {
      options: { themeBg: 'dark' },
      profiles: [{ id: 'p1', name: 'Work' }],
    },
  );
  check(changed1.includes('options') && !changed1.includes('profiles'), 'options updated, empty remote profiles blocked');
  const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  check(savedSettings.themeBg === 'midnight' && savedSettings.keepExtra === 42 && !('evilKey' in savedSettings), 'only allowlisted options updated, existing extra keys preserved');
  check(!({}).polluted, 'Object.prototype not polluted');
  const savedProfiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  check(savedProfiles.length === 1 && savedProfiles[0].name === 'Work', 'non-empty local profiles not wiped by empty remote list');

  const backups = fs.readdirSync(path.join(T, 'backups'));
  check(backups.some((f) => /^settings-.*\.json$/.test(f)), 'settings backup created before overwrite');

  // 3. Non-empty remote profiles overwrite local profiles and create backup
  const changed2 = await syncMod._apply(
    { profiles: [{ id: 'p2', name: 'Gaming' }] },
    { options: {}, profiles: [{ id: 'p1', name: 'Work' }] },
  );
  check(changed2.length === 1 && changed2[0] === 'profiles', 'non-empty remote profiles applied');
  check(JSON.parse(fs.readFileSync(profilesPath, 'utf8'))[0].name === 'Gaming', 'profiles file updated');
  check(fs.readdirSync(path.join(T, 'backups')).some((f) => /^profiles-.*\.json$/.test(f)), 'profiles backup created');

  // 4. Empty remote profiles allowed when local profiles are also empty
  const changed3 = await syncMod._apply({ profiles: [] }, { options: {}, profiles: [{ id: 'p2' }] });
  check(!changed3.includes('profiles'), 'still refuses empty remote when local is non-empty');
  const changed4 = await syncMod._apply({ profiles: [{ id: 'p3' }] }, { options: {}, profiles: [] });
  check(changed4.includes('profiles'), 'applies non-empty remote when local is empty');

  // 5. sync() when settingsSync === false
  fs.writeFileSync(settingsPath, JSON.stringify({ settingsSync: false }));
  const stDisabled = await syncMod.sync();
  check(stDisabled.enabled === false, 'sync() disables when settingsSync === false');

  // 6. sync() with corrupt state JSON records error instead of flipping role
  fs.writeFileSync(settingsPath, JSON.stringify({ settingsSync: true }));
  fs.writeFileSync(statePath, '{corrupt json');
  const stCorrupt = await syncMod.sync();
  check(typeof stCorrupt.error === 'string' && stCorrupt.error.length > 0, 'corrupt state file stops sync with error');

  // 7. sync() without git repo marks notSetUp without error
  fs.unlinkSync(statePath);
  const stNoGit = await syncMod.sync();
  check(stNoGit.enabled === false && stNoGit.notSetUp === true && stNoGit.error === null, 'no git origin marks notSetUp cleanly');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`settings-sync (_apply allowlist/backups, profile guard, sync guards): all ${n} passed`);
process.exit(0);
