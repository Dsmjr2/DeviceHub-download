// Weekly setup file (19 Oct 2026): once a week DeviceHub saves the same file "Save setup file" makes (every device's
// full settings and the profiles) to setups\, keeping the newest 6, so a device that resets itself, a firmware update
// or a bad experiment can be put back in one click from the Backups page. Checked when DeviceHub starts and once a
// day. A connected device gets a fresh read (a normal backup); one that is not connected is taken from its newest
// backup file, so the week's file is never missing a device that was merely unplugged.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { writeAtomic } = createRequire(import.meta.url)('./safe-write.js');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'setups'), BACKUPS = path.join(ROOT, 'backups'), PROFILES = path.join(ROOT, 'profiles.json');
const WEEK = 7 * 24 * 3600 * 1000, KEEP = 6, IDS = ['mouse', 'headset', 'keyboard'];

export function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => ({ name: f, at: fs.statSync(path.join(DIR, f)).mtime, size: fs.statSync(path.join(DIR, f)).size }))
    .sort((a, b) => b.at - a.at);
}
export function read(name) {
  if (!/^DeviceHub setup [0-9-]+( \d+)?\.json$/.test(name)) throw new Error('not a setup file name');
  return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
}
const newestBackup = (id) => {
  const f = fs.readdirSync(BACKUPS).filter((x) => x.startsWith(`${id}-`) && x.endsWith('.json')).map((x) => ({ x, t: fs.statSync(path.join(BACKUPS, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  return f ? JSON.parse(fs.readFileSync(path.join(BACKUPS, f.x), 'utf8')) : null;
};

// core: public/core/devices.js as the agent runs it
export async function saveIfDue(core, log, { force = false } = {}) {
  const last = list()[0];
  if (!force && last && Date.now() - new Date(last.at).getTime() < WEEK) return null;
  const out = { kind: 'devicehub-setup', version: 1, savedAt: new Date().toISOString(), weekly: true, devices: {}, profiles: [] };
  const fromBackup = [];
  for (const id of IDS) {
    const d = core.devices[id];
    try {
      if (d && d.status === 'connected') {
        const name = await core.backupNow(id, 'weekly setup file');
        out.devices[id] = JSON.parse(fs.readFileSync(path.join(BACKUPS, name), 'utf8'));
      } else {
        const b = newestBackup(id);
        if (b) { out.devices[id] = b; fromBackup.push(d?.adapter.title || id); }
      }
    } catch (e) { const b = newestBackup(id); if (b) { out.devices[id] = b; fromBackup.push(d?.adapter.title || id); } }
  }
  try { out.profiles = JSON.parse(fs.readFileSync(PROFILES, 'utf8')); } catch {}
  // sound: DeviceHub's EQ store and its options, as the setup file has them (public/core/setup.js)
  out.sound = {};
  try { out.sound.eq = JSON.parse(fs.readFileSync(path.join(ROOT, 'eq-presets.json'), 'utf8')); } catch {}
  try { out.sound.settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8')); } catch {}
  if (!Object.keys(out.devices).length) return null;
  fs.mkdirSync(DIR, { recursive: true });
  let name = `DeviceHub setup ${out.savedAt.slice(0, 10)}.json`;
  for (let n = 2; fs.existsSync(path.join(DIR, name)); n++) name = `DeviceHub setup ${out.savedAt.slice(0, 10)} ${n}.json`;
  writeAtomic(path.join(DIR, name), JSON.stringify(out, null, 1));
  for (const old of list().slice(KEEP)) fs.unlinkSync(path.join(DIR, old.name));
  log?.(`Weekly setup file saved${fromBackup.length ? ` (from the newest backup: ${fromBackup.join(', ')})` : ''}`, 'good');
  return name;
}
