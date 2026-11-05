// Write-only settings (2 Nov 2026, Shawn's rule): a documented command the device cannot read back (SteelSeries mice:
// rivalcfg "never reads settings back from the mouse"). DeviceHub allows one only after a one-time check per device:
// the person presses Try it, DeviceHub sends the setting's test value once, and the person says by eye whether it
// happened ("Did the mouse's lights turn red?"). Yes = DeviceHub trusts that command for that driver and that model
// (USB vid:pid) from then on; No = the value before goes back and it stays locked. Limits Shawn accepted:
//  - only settings the device FORGETS on unplug (volatile: true); anything followed by a save to the device's memory
//    stays out (helpers/my-devices.mjs problem() refuses it, and helpers/never-commands.json still applies);
//  - Turn on settings is still needed first (helpers/my-devices.mjs needsTurnOn).
// This file keeps the two records, both in data\ (helpers/data-dir.js), each backed up into backups\ before the first
// change in a run, the same way settings.json is:
//   trusted-writes.json  { "<driverId>|<vid:pid>|<key>": { at, value, answer: 'yes' } }
//   last-written.json    { "<driverId>|<vid:pid>|<key>": { at, value } }: the last value DeviceHub wrote; read() of a
//                        write-only key returns it (null = "not set by DeviceHub yet")
// The guard in helpers/my-devices.mjs decides (its header: "Write-only settings").
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { writeAtomic, readJsonForWrite } = require('./safe-write.js');
const { dataFile } = require('./data-dir.js');

export const TRUST_FILE = 'trusted-writes.json';
export const LAST_FILE = 'last-written.json';
export const TRY_MS = 10 * 60 * 1000;   // a Try it is answered within this, or it must be pressed again
// the parts a writeOnly may have
export const WRITE_ONLY_PARTS = ['volatile', 'confirm', 'test', 'restore'];

const hex4 = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '').padStart(4, '0');
export const trustKey = (driverId, vid, pid, key) => (driverId && vid && pid && key ? `${driverId}|${hex4(vid)}:${hex4(pid)}|${key}` : null);

const readJson = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } };

// the two records under one DeviceHub folder (root = the folder that holds data\ and backups\)
const stores = new Map();
export function writeOnlyStore(root) {
  const at = path.resolve(root);
  if (stores.has(at)) return stores.get(at);
  const backedUp = new Set();
  const file = (name) => dataFile(name, at);
  const save = (name, data) => {
    const f = file(name);
    // a copy of the file as it was, before the first change to it in this run (as settings-sync.js keeps settings.json)
    if (!backedUp.has(name) && fs.existsSync(f)) {
      const dir = path.join(at, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(f, path.join(dir, `${name.replace(/\.json$/, '')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      backedUp.add(name);
    }
    writeAtomic(f, JSON.stringify(data, null, 2) + '\n');
  };
  const s = {
    root: at,
    trusted: (k) => (k ? readJson(file(TRUST_FILE))[k]?.answer === 'yes' : false),
    // a record that is changed is read strictly (5 Nov 2026): a failed read never drops the other entries
    trust(k, rec) { const all = readJsonForWrite(file(TRUST_FILE), {}); all[k] = { at: rec.at, value: rec.value, answer: 'yes' }; save(TRUST_FILE, all); },
    last: (k) => (k ? readJson(file(LAST_FILE))[k] || null : null),
    remember(k, value, when = new Date()) { if (!k) return; const all = readJsonForWrite(file(LAST_FILE), {}); all[k] = { at: when.toISOString(), value }; save(LAST_FILE, all); },
  };
  stores.set(at, s);
  return s;
}

// a value in plain words, for the question: an option's label, a number with its unit, on / off, a colour's name
const COLOURS = { '#ff0000': 'red', '#00ff00': 'green', '#0000ff': 'blue', '#ffffff': 'white', '#ffff00': 'yellow', '#00ffff': 'cyan', '#ff00ff': 'pink', '#000000': 'off (black)' };
export function showValue(s, v) {
  if (v === null || v === undefined) return 'not set';
  if (s?.type === 'toggle') return v ? 'on' : 'off';
  if (s?.type === 'choice') return String((s.options || []).find((o) => JSON.stringify(o.value) === JSON.stringify(v))?.label ?? v);
  if (s?.type === 'color') {
    const one = (c) => COLOURS[String(c).toLowerCase()] || String(c);
    if (typeof v === 'string') return one(v);
    const all = Object.values(v || {});
    return all.length && all.every((c) => c === all[0]) ? one(all[0]) : 'the colours chosen';
  }
  const unit = s?.unit ? (/^[A-Za-z]/.test(s.unit) ? ` ${s.unit}` : s.unit) : '';
  return `${v}${unit}`;
}
// the confirm question with {value} filled in
export const question = (s, v) => String(s?.writeOnly?.confirm || '').replace(/\{value\}/g, showValue(s, v));
// what pressing Try it will do, in one line
export const tryLine = (s, kind = 'device') => `Try it sends ${showValue(s, s?.writeOnly?.test)} once, then asks what you saw. Unplugging the ${String(kind).toLowerCase()} undoes it.`;
