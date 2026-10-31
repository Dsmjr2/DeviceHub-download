// A driver whose code changed after its "updated" date never reaches PCs that already have it (23 Oct 2026: the
// lghub_updater fix sat in logitech-hidpp-mouse with "updated" 22 Oct, so the friend's PC kept the old copy and still
// said "close G HUB"). This fails when a dated driver's device.mjs or driver.json has a commit newer than its date.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const lib = path.join(root, 'device-library');
const bad = [];
let checked = 0;
let git = true;
try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }); } catch { git = false; }
if (git) {
  for (const name of fs.readdirSync(lib)) {
    const meta = path.join(lib, name, 'device.json');
    if (name.startsWith('_') || !fs.existsSync(meta)) continue;
    let updated;
    try { updated = JSON.parse(fs.readFileSync(meta, 'utf8').replace(/^﻿/, '')).updated; } catch { continue; }
    // (31 Oct 2026) no date at all: never replaces a copy a PC already has (helpers/library-updates.mjs entryVersion), so
    // its fixes reached nobody who had it; 16 were like that
    if (!updated) { checked++; bad.push(`${name}: no "updated" date, so a PC that has it never gets a new copy: set "updated" in its device.json to now`); continue; }
    const code = ['device.mjs', 'driver.json'].map((f) => `device-library/${name}/${f}`).filter((f) => fs.existsSync(path.join(root, f)));
    if (!code.length) continue;
    const last = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...code], { cwd: root, encoding: 'utf8' }).trim();
    checked++;
    if (last && Date.parse(last) > Date.parse(updated)) bad.push(`${name}: code changed ${last}, "updated" is ${updated}: set "updated" in its device.json to now`);
  }
}
if (bad.length) { console.error(`driver-dates: ${bad.length} driver(s) would not reach PCs that have them:\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log(`driver-dates (${git ? `${checked} dated drivers: none changed after their date` : 'no git here: skipped'}): all good`);
