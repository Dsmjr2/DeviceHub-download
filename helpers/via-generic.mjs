// Any VIA keyboard, from any brand, with no Learn and no button presses (27 Oct 2026, Shawn). The keyboard slot already
// runs any keyboard with VIA's raw HID collection (usage page 0xFF60, usage 0x61; helpers/via-defs.js findKeyboards
// finds them by that collection, whatever the vendor id). This module decides which one the slot takes, and whether
// it is "listed" (a keyboard DeviceHub or one of its drivers names by id) or "unlisted" (any other VIA keyboard):
//   - the Epomaker P75 (DeviceHub's own driver) always wins, and no other keyboard is ever taken while it is plugged in;
//   - a listed keyboard (an id in helpers/pc-map.js RUNS, a device-library entry, or a my-devices driver) runs as before;
//   - an unlisted one is identified first (only VIA's "protocol version" question, 0x01; public/devices/keyboard-
//     adapter.js connect), then only read until the person presses Turn on settings and each group's write-then-read-
//     back check passes (keyboard-adapter.js turnOn). A keyboard that does not answer is stepped aside and left alone,
//     and the next VIA keyboard, if any, is tried.
// What the person turned on is kept per keyboard id in via-definitions\settings-on.json (that folder is the PC's own,
// in .gitignore). Reads only, apart from that one file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P75_ID = '342d:e479';
const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
export const idOf = (k) => `${hex4(k.vid)}:${hex4(k.pid)}`;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const folders = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name)); } catch { return []; } };

// every 'vid:pid' DeviceHub or one of its drivers names: RUNS, every device-library entry (shipped and cached), and
// every my-devices folder (device.json vid + pids; driver.json vid with pid / pids / byPid)
export function listedIds({ root = ROOT } = {}) {
  const out = new Set([P75_ID]);
  const add = (vid, pids) => { if (!/^(0x)?[0-9a-f]{4}$/i.test(String(vid ?? ''))) return; for (const p of pids || []) if (/^(0x)?[0-9a-f]{4}$/i.test(String(p ?? ''))) out.add(`${hex4(vid)}:${hex4(p)}`); };
  try { for (const k of Object.keys(require('./pc-map.js').RUNS || {})) out.add(k.toLowerCase()); } catch {}
  for (const base of [path.join(root, 'device-library'), path.join(root, 'library-cache'), path.join(root, 'my-devices')]) {
    for (const dir of folders(base)) {
      const meta = readJson(path.join(dir, 'device.json'));
      if (meta) add(meta.vid, meta.pids);
      const drv = readJson(path.join(dir, 'driver.json'));
      if (drv) {
        const hid = drv.hid && typeof drv.hid === 'object' ? drv.hid : drv;
        add(hid.vid ?? drv.vid, [hid.pid, hid.cablePid, ...(Array.isArray(hid.pids) ? hid.pids : []), ...(Array.isArray(drv.pids) ? drv.pids : []), ...Object.keys(hid.byPid || drv.byPid || {})]);
      }
    }
  }
  return out;
}

// the VIA keyboards the slot may try, in order: [] while the P75 is plugged in (its own driver runs it); else every
// other one found, minus those already stepped aside. Each { vid, pid, name, id, unlisted }.
export function candidates(found, { listed = new Set([P75_ID]), aside = new Set(), viaTest = false } = {}) {
  const all = (found || []).map((k) => ({ ...k, id: idOf(k) }));
  if (viaTest) return all.filter((k) => k.id === P75_ID).map((k) => ({ ...k, unlisted: false }));
  if (all.some((k) => k.id === P75_ID)) return [];
  return all.filter((k) => !aside.has(k.id)).map((k) => ({ ...k, unlisted: !listed.has(k.id) }));
}

// what the person turned on, per keyboard id: { settingsOn: { at }, checks: { keys|knob|lighting|macros: { ok, why?, at } } }
export function settingsStore(file = path.join(ROOT, 'via-definitions', 'settings-on.json')) {
  const all = () => readJson(file) || {};
  return {
    get: (id) => all()[id] || null,
    set(id, rec) {
      const cur = all();
      cur[id] = rec;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n');
      fs.renameSync(tmp, file);
    },
  };
}
