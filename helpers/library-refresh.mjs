// A newer library driver reaches the copies already installed (24 Oct 2026, docs/handoff/smoother-for-friends.md).
// Until today a driver installed from the device library (my-devices\<name>\ with library.json) was never replaced:
// installFromLibrary never writes over a folder, so a fix published in the library (or shipped in a new version of
// DeviceHub) reached only PCs that did not have the device yet. A friend's Logitech mouse kept the old driver after
// the fix was out (support #13, #16).
//
// refreshInstalled() puts the library's driver into such a copy when the library's entry is strictly newer than the
// copy (entryVersion: device.json "updated", else its newest tested date) and its driver text differs or its
// device.json does. Called after every library check (helpers/library-updates.mjs) and at every start before the
// drivers load. Never for:
//   - a driver the learning wizard made (library.json learned) or one with settings learned on this PC (learnedKeys):
//     replacing it would lose them;
//   - a person's own driver (no library.json);
//   - an entry whose ids DeviceHub's own drivers run, one that does not load, or one whose id changed (the running
//     DeviceHub knows the device by its id).
// What it does: the old files go to backups\library-drivers\<name>-<time>\ first, then the new driver file and
// device.json are written (temp file, then rename), a driver file of the other kind is moved to the backup (device.mjs
// wins when both are there), verified.json moves to the backup too (the self-check runs again for the new driver,
// only for settings already turned on), and library.json records { updatedFromLibrary: { at, from, to } } and the new
// status. settingsOn stays: the person turned that device's settings on; every write still waits for its self-check.
// The running DeviceHub keeps the driver it loaded until it restarts: swapping a loaded driver would drop its open HID
// channel and lock mid-use (helpers/my-devices.mjs loadedDriverChanged says so on the device page).
//
//   refreshInstalled({ root, log, now })  { replaced: [{ name, from, to }], skipped: [{ name, why }] }
import fs from 'node:fs';
import path from 'node:path';
import { list, loadDriver, DRIVER_FILES, driverFileOf, ROOT } from './device-library.mjs';
import { libraryMark, LIBRARY_FILE, VERIFIED_FILE, problem, ownClash, driverShaOf, loadedYet } from './my-devices.mjs';
import { entryVersion } from './library-updates.mjs';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^[_.]/.test(e.name)).map((e) => e.name).sort(); } catch { return []; } };
const putFile = (file, text) => { const tmp = `${file}.tmp-${process.pid}`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

let running = null;
export function refreshInstalled(opts = {}) {
  if (running) return running;
  running = doRefresh(opts).finally(() => { running = null; });
  return running;
}

async function doRefresh({ root = ROOT, log = () => {}, now = () => new Date() } = {}) {
  const out = { replaced: [], skipped: [] };
  const dir = path.join(root, 'my-devices');
  const names = folders(dir);
  if (!names.length) return out;
  let entries;
  try { entries = new Map(list({ root, examples: false }).filter((e) => !e.error).map((e) => [e.name, e])); } catch (e) { return { ...out, error: e.message }; }
  for (const name of names) {
    const folder = path.join(dir, name);
    const mark = libraryMark(folder);
    if (!mark) continue;   // a person's own driver
    const entry = entries.get(mark.name || name);
    if (!entry) continue;
    const copyMeta = readJson(path.join(folder, 'device.json')) || {};
    const from = entryVersion(copyMeta), to = entryVersion(entry.meta);
    if (!(to > from)) continue;   // not newer: nothing to do (the common case)
    const skip = (why) => { out.skipped.push({ name, why }); };
    if (mark.learned) { skip('the learning wizard made it on this PC'); continue; }
    if (Array.isArray(mark.learnedKeys) && mark.learnedKeys.length) { skip(`it has settings learned on this PC (${mark.learnedKeys.join(', ')}): kept as it is`); continue; }
    const newSha = driverShaOf(entry.dir), oldSha = driverShaOf(folder);
    if (mark.installedSha && oldSha !== mark.installedSha) { skip('its driver was changed on this PC: kept as it is'); continue; }
    const sameMeta = JSON.stringify(copyMeta) === JSON.stringify(entry.meta);
    if (newSha === oldSha && sameMeta) continue;
    if (ownClash(entry.meta.vid, entry.meta.pids).length) { skip("DeviceHub's own driver runs one of its ids"); continue; }
    let a;
    try { a = (await loadDriver(entry.dir, 'refresh')).a; } catch (e) { skip(`the newer driver does not load (${String(e.message || e).split('\n')[0]})`); continue; }
    const why = problem(a);
    if (why) { skip(`the newer driver is not valid (${why})`); continue; }
    if (a.id !== entry.meta.id || (mark.id && a.id !== mark.id)) { skip(`the newer driver's id "${a.id}" is not the installed one's "${mark.id || entry.meta.id}"`); continue; }
    const at = now().toISOString();
    const back = path.join(root, 'backups', 'library-drivers', `${name}-${at.replace(/[:.]/g, '-')}`);
    try {
      fs.mkdirSync(back, { recursive: true });
      for (const f of [...DRIVER_FILES, 'device.json', LIBRARY_FILE, VERIFIED_FILE]) if (fs.existsSync(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(back, f), fs.constants.COPYFILE_EXCL);
      const file = driverFileOf(entry.dir);
      putFile(path.join(folder, file), fs.readFileSync(path.join(entry.dir, file)));
      putFile(path.join(folder, 'device.json'), fs.readFileSync(path.join(entry.dir, 'device.json')));
      for (const f of DRIVER_FILES) if (f !== file && fs.existsSync(path.join(folder, f))) fs.rmSync(path.join(folder, f));   // a copy is in the backup
      if (fs.existsSync(path.join(folder, VERIFIED_FILE))) fs.rmSync(path.join(folder, VERIFIED_FILE));   // a copy is in the backup
      const last = Array.isArray(entry.meta.tested) ? entry.meta.tested.at(-1) || {} : {};
      putFile(path.join(folder, LIBRARY_FILE), JSON.stringify({ ...readJson(path.join(folder, LIBRARY_FILE)), source: `${entry.origin || 'device-library'}/${entry.name}`, status: entry.meta.status,
        libraryTested: last.date || null, libraryDevicehub: last.devicehub || null, installedSha: newSha || null, updatedFromLibrary: { at, from: from || null, to, backup: path.relative(root, back) } }, null, 2) + '\n');
    } catch (e) { skip(`it could not be written (${e.message}); the old files are in ${path.relative(root, back)}`); continue; }
    out.replaced.push({ name, from: from || null, to });
    try { log({ kind: 'good', text: `Device library: the ${entry.meta.product || name} driver was updated (${from || 'undated'} -> ${to})${loadedYet() ? '; it loads when DeviceHub restarts' : ''}` }); } catch {}
  }
  for (const s of out.skipped) try { log({ kind: 'info', text: `Device library: a newer ${s.name} driver was not put in (${s.why})` }); } catch {}
  return out;
}
