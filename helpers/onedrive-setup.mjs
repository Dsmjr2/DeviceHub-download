// A copy of this PC's setup in OneDrive (22 Oct 2026, Shawn: "What if they want to be able to go to another computer and
// bring their settings"). Opt-in (settings.json oneDriveCopy). While on, DeviceHub keeps OneDrive\DeviceHub\<PC>.devicehub-
// setup.json up to date: the same file Save setup file makes (public/core/setup.js), with the devices' last-read values
// (core.copyFor: no new read, no backup file), the profiles, the sound settings and the extras (helpers/setup-extras.js,
// without the wallpapers, which can be large). It is written only when something in it changed.
// Another PC with DeviceHub and the same OneDrive sees the other PCs' files: the Overview offers "Bring your settings
// from <PC>", which opens the setup file's usual confirmation (every change listed first, nothing written before Load).
// Nothing here reads or writes a device; OneDrive itself does the moving.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { writeAtomic } = createRequire(import.meta.url)('./safe-write.js');

let ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// this PC's files are in data\ (27 Oct 2026, helpers/data-dir.js)
const data = (name) => path.join(ROOT, 'data', name);
let BACKUPS = path.join(ROOT, 'backups'), SETTINGS = data('settings.json');
// tests/setup-extras.mjs: a copy's folder instead of this one
export function useRoot(root) { ROOT = root; BACKUPS = path.join(root, 'backups'); SETTINGS = data('settings.json'); }
const SUFFIX = '.devicehub-setup.json';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// OneDrive's folder on this PC (Windows sets these for the signed-in account), or null when there is none
export function folder(env = process.env) {
  if (env.DEVICEHUB_ONEDRIVE_DIR) return env.DEVICEHUB_ONEDRIVE_DIR;
  const od = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].find((d) => d && fs.existsSync(d));
  return od ? path.join(od, 'DeviceHub') : null;
}
export const pcName = (name = os.hostname()) => String(name).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'PC';
const fileOf = (dir, pc) => path.join(dir, pcName(pc) + SUFFIX);

const newestBackup = (id) => {
  try {
    const f = fs.readdirSync(BACKUPS).filter((x) => x.startsWith(`${id}-`) && x.endsWith('.json')).map((x) => ({ x, t: fs.statSync(path.join(BACKUPS, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    return f ? readJson(path.join(BACKUPS, f.x), null) : null;
  } catch { return null; }
};

// the setup file for this PC; core: public/core/devices.js as the agent runs it; extras: helpers/setup-extras.js
export async function compose(core, extras) {
  const out = { kind: 'devicehub-setup', version: 1, savedAt: new Date().toISOString(), from: pcName(), devices: {}, profiles: readJson(data('profiles.json'), []) };
  for (const id of Object.keys(core.devices)) {
    let b = null;
    try { b = await core.copyFor(id); } catch {}
    b = b || newestBackup(id);
    if (b?.device === id) out.devices[id] = b;
  }
  out.sound = {};
  const eq = readJson(data('eq-presets.json'), null); if (eq) out.sound.eq = eq;
  const { oneDriveSeen, setupSeen, ...settings } = readJson(SETTINGS, {});   // which offers were put away, and Setup's first start, stay on each PC
  out.sound.settings = settings;
  out.extras = extras.gather({ withWallpapers: false });
  return out;
}

// what makes two copies the same: everything but when it was saved and when each device was read
const sameAs = (a, b) => {
  const strip = (x) => JSON.stringify({ ...x, savedAt: 0, devices: Object.fromEntries(Object.entries(x?.devices || {}).map(([k, v]) => [k, { ...v, takenAt: 0, why: 0 }])) });
  return !!a && !!b && strip(a) === strip(b);
};

// write this PC's copy when something in it changed; force: write even when the same
export async function save(core, extras, { force = false } = {}) {
  const dir = folder();
  if (!dir) return { ok: false, error: 'OneDrive is not set up on this PC' };
  const out = await compose(core, extras);
  const file = fileOf(dir, out.from);
  if (!force && sameAs(readJson(file, null), out)) return { ok: true, unchanged: true, file };
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify(out, null, 1));
  return { ok: true, saved: true, file, savedAt: out.savedAt };
}

// on: the setting; mine: this PC's copy; others: the other PCs' copies, newest first, with whether the offer was put away
export function status() {
  const s = readJson(SETTINGS, {}), dir = folder(), me = pcName();
  const out = { on: s.oneDriveCopy === true, folder: dir, pc: me, mine: null, others: [] };
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(SUFFIX))) {
    const pc = f.slice(0, -SUFFIX.length), full = path.join(dir, f);
    const at = fs.statSync(full).mtime.toISOString();
    if (pc === me) out.mine = { savedAt: at };
    else out.others.push({ pc, savedAt: at, seen: (s.oneDriveSeen || {})[pc] === at });
  }
  out.others.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return out;
}

export function read(pc) {
  const dir = folder();
  if (!dir || !/^[\w.-]{1,60}$/.test(String(pc))) throw new Error('no such PC');
  const f = fileOf(dir, pc);
  if (!fs.existsSync(f)) throw new Error('no such PC');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// "Not now" on the Overview's offer: that PC's copy, as saved now, is not offered again (a newer one is)
export function dismiss(pc) {
  const st = status().others.find((o) => o.pc === pc);
  if (!st) return { ok: false };
  const s = readJson(SETTINGS, {});
  s.oneDriveSeen = { ...(s.oneDriveSeen || {}), [pc]: st.savedAt };
  writeAtomic(SETTINGS, JSON.stringify(s, null, 2));
  return { ok: true };
}

// the server's routes: GET /api/onedrive (status), POST /api/onedrive/save, GET /api/onedrive/read?pc=, POST /api/onedrive/dismiss
export async function handle(url, req, res, send, readBody, { saveNow }) {
  const p = url.pathname;
  if (p === '/api/onedrive' && req.method === 'GET') return send(res, 200, status());
  if (p === '/api/onedrive/save' && req.method === 'POST') return send(res, 200, await saveNow({ force: true }));
  if (p === '/api/onedrive/read' && req.method === 'GET') { try { return send(res, 200, read(url.searchParams.get('pc'))); } catch (e) { return send(res, 404, { error: e.message }); } }
  if (p === '/api/onedrive/dismiss' && req.method === 'POST') return send(res, 200, dismiss(String((await readBody(req)).pc || '')));
  return false;
}
