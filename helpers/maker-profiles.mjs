// "Bring over from your maker's app" (29 Oct 2026, Shawn: what someone setting up is missing; docs/handoff on Profiles).
// When Logitech G HUB is not using the mouse's onboard memory, the DPI stages and report rate the person picked live only
// in G HUB, so DeviceHub (with G HUB closed) reads whatever the mouse falls back to. This reads G HUB's own settings
// (%LOCALAPPDATA%\LGHUB\settings.db, a SQLite file whose rows hold JSON) and lists each saved mouse setup, so the
// Profiles page can make a DeviceHub profile from one on the person's click. Nothing is written to the mouse until that
// profile is applied, through the usual profile path (checked against the driver's own ranges).
//
// Read-only: the database is COPIED to a temp folder first (G HUB keeps it open) and only the copy is opened, read-only;
// the copy is deleted after. iCUE needs no import: the Equalizer already reads iCUE's own preset files.
//
//   findSetups(json)       pure: every mouse setup in G HUB's JSON: [{ name, model, dpis, dpi, reportRate }]
//   readGhub({ file })     { found, setups, why }
//   status()               GET /api/maker-profiles: { ghub, icue }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GHUB_FILE = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LGHUB', 'settings.db');
export const ICUE_DIR = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Corsair', 'CUE5');
export const MAX_SETUPS = 30;

// "g502_hero_mouse_settings" -> "G502 HERO"; a slot or card id says which mouse a setup is for
export function modelOf(slot) {
  const m = /^([a-z0-9]+(?:_[a-z0-9]+)*?)_(?:mouse_settings|settings|mouse)\b/i.exec(String(slot || ''));
  return m ? m[1].replace(/_/g, ' ').toUpperCase() : null;
}
const dpiOf = (x) => (typeof x === 'number' ? x : Number(x?.dpi ?? x?.value ?? x?.x));
const okDpi = (n) => Number.isInteger(n) && n >= 50 && n <= 50000;
const okRate = (n) => [125, 250, 500, 1000, 2000, 4000, 8000].includes(n);

// every object in G HUB's JSON that holds DPI stages or a report rate; the nearest name and slot id around it name it
export function findSetups(json) {
  const out = [];
  const seen = new Set();
  const walk = (o, ctx, depth) => {
    if (!o || typeof o !== 'object' || depth > 40 || out.length >= MAX_SETUPS) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, ctx, depth + 1); return; }
    const here = {
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : ctx.name,
      slot: typeof o.slotId === 'string' ? o.slotId : typeof o.id === 'string' && /mouse/i.test(o.id) ? o.id : ctx.slot,
    };
    // the default stage is G HUB's index into its own list, so it is looked up before stages it cannot read are left out
    const raw = Array.isArray(o.dpiStages) ? o.dpiStages.map(dpiOf) : [];
    const stages = raw.filter(okDpi);
    const rate = Number(o.reportRate);
    if (stages.length || okRate(rate)) {
      const at = Number.isInteger(o.defaultDpiIndex) ? o.defaultDpiIndex : Number.isInteger(o.defaultDpiStage) ? o.defaultDpiStage : 0;
      const s = { name: here.name || 'G HUB setup', model: modelOf(here.slot), dpis: stages.slice(0, 8), dpi: okDpi(raw[at]) ? raw[at] : stages[0] ?? null, reportRate: okRate(rate) ? rate : null };
      const key = JSON.stringify(s);
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
    for (const v of Object.values(o)) walk(v, here, depth + 1);
  };
  walk(json, { name: null, slot: null }, 0);
  return out;
}

// the JSON in G HUB's database: every text or blob cell that parses as a JSON object
async function jsonCells(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name).filter((n) => /^[A-Za-z0-9_]+$/.test(n));
    for (const t of tables) {
      for (const row of db.prepare(`SELECT * FROM "${t}" LIMIT 50`).all()) {
        for (const v of Object.values(row)) {
          const text = v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : typeof v === 'string' ? v : null;
          if (!text || text.length < 2 || !/^\s*[{[]/.test(text)) continue;
          try { out.push(JSON.parse(text)); } catch {}
        }
      }
    }
    return out;
  } finally { try { db.close(); } catch {} }
}

export async function readGhub({ file = GHUB_FILE() } = {}) {
  if (!fs.existsSync(file)) return { found: false, setups: [], why: 'G HUB is not on this PC' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ghub-'));
  try {
    const copy = path.join(tmp, 'settings.db');
    fs.copyFileSync(file, copy);
    for (const side of ['-wal', '-shm']) if (fs.existsSync(file + side)) fs.copyFileSync(file + side, copy + side);
    const setups = [];
    for (const j of await jsonCells(copy)) for (const s of findSetups(j)) if (setups.length < MAX_SETUPS && !setups.some((x) => JSON.stringify(x) === JSON.stringify(s))) setups.push(s);
    return { found: true, setups, why: setups.length ? null : 'G HUB has no saved mouse settings' };
  } catch (e) {
    return { found: true, setups: [], why: `G HUB's settings could not be read (${String(e.message || e).split('\n')[0]})` };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

// iCUE: nothing to import; the Equalizer reads its presets directly. Said so the person knows.
export function icueState({ dir = ICUE_DIR() } = {}) {
  try { return { found: fs.existsSync(path.join(dir, 'eq_presets')), note: 'Your iCUE equalizer presets are already used: the Equalizer reads them from iCUE directly.' }; } catch { return { found: false }; }
}

export async function status(deps = {}) {
  return { ok: true, ghub: await readGhub(deps.ghub), icue: icueState(deps.icue) };
}
