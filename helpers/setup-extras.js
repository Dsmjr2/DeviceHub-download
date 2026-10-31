// The rest of a setup file (22 Oct 2026, Shawn: "What if they want to be able to go to another computer and bring their
// settings"). Besides each device's settings, the profiles and the sound settings (public/core/setup.js), a setup file
// now carries what made this PC's DeviceHub its own:
//   - headset names and the headset picked on the Headset page (settings.json headsetNames, headsetPick);
//   - the background picture (background-picture.*);
//   - drivers added on this PC (my-devices\<name>\: their code and descriptions only, not captures or backups);
//   - optionally, the wallpapers (Pictures\DeviceHub Wallpapers), which can be large.
// gather() reads them; summarize() describes them by hash, so the page can say what loading would change without sending
// pictures back and forth; plan() compares a summary with this PC; apply() puts them here: settings.json backed up
// first, a driver or picture already here never overwritten, a wallpaper already here skipped.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeAtomic } = require('./safe-write');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const PICTURE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const DRIVER_FILE = /\.(mjs|js|json|md|txt)$/i;
const DRIVER_SKIP_DIR = /^(backups?|captures?|learn|recordings?|logs?|node_modules|\.)/i;
const DRIVER_MAX = 1024 * 1024;             // a driver file over 1 MB is not a driver: left out
const safePart = (s) => /^[\w .()+-]{1,80}$/.test(s) && !/^\.+$/.test(s);

function create({ root = path.join(__dirname, '..'), wallpapers = null } = {}) {
  const { dataFile } = require('./data-dir');
  const SETTINGS = dataFile('settings.json', root), MY = path.join(root, 'my-devices'), BACKUPS = path.join(root, 'backups');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
  const picture = () => { for (const ext of Object.keys(PICTURE)) { const f = dataFile(`background-picture.${ext}`, root); if (fs.existsSync(f)) return { ext, file: f }; } return null; };

  // every driver folder added on this PC (not the worked example), its plain-text files only, two folders deep at most
  function drivers() {
    if (!fs.existsSync(MY)) return [];
    const out = [];
    for (const d of fs.readdirSync(MY, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('_') || !safePart(d.name)) continue;
      const files = {};
      const walk = (dir, rel, depth) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name, full = path.join(dir, e.name);
          if (e.isDirectory()) { if (depth < 2 && !DRIVER_SKIP_DIR.test(e.name) && safePart(e.name)) walk(full, r, depth + 1); continue; }
          if (!e.isFile() || !DRIVER_FILE.test(e.name) || !safePart(e.name)) continue;
          const st = fs.statSync(full); if (st.size > DRIVER_MAX) continue;
          files[r] = fs.readFileSync(full).toString('base64');
        }
      };
      walk(path.join(MY, d.name), '', 0);
      if (Object.keys(files).length) out.push({ name: d.name, files });
    }
    return out;
  }

  function gather({ withWallpapers = false } = {}) {
    const s = readSettings();
    const x = { headsetNames: s.headsetNames && typeof s.headsetNames === 'object' ? s.headsetNames : {}, headsetPick: typeof s.headsetPick === 'string' ? s.headsetPick : null };
    const pic = picture();
    if (pic) x.background = { ext: pic.ext, data: fs.readFileSync(pic.file).toString('base64') };
    x.myDevices = drivers();
    if (withWallpapers && wallpapers) {
      x.wallpapers = wallpapers.list().items.map((it) => ({ name: it.name, data: fs.readFileSync(wallpapers.file(it.name).full).toString('base64') }));
    }
    return x;
  }
  // how big the wallpapers would make a setup file (shown beside the choice)
  const wallpaperBytes = () => (wallpapers ? wallpapers.list().totalBytes : 0);

  // a summary of extras (pictures by hash): what the page sends to plan()
  function summarize(x = {}) {
    const hashOf = (b64) => sha(Buffer.from(b64 || '', 'base64'));
    return { headsetNames: x.headsetNames || {}, headsetPick: x.headsetPick || null,
      background: x.background ? { ext: x.background.ext, sha: hashOf(x.background.data) } : null,
      myDevices: (x.myDevices || []).map((d) => ({ name: d.name, sha: sha(JSON.stringify(Object.entries(d.files || {}).sort())) })),
      wallpapers: (x.wallpapers || []).map((w) => ({ name: w.name, sha: hashOf(w.data) })) };
  }

  // what loading these extras would change here, in plain lines
  function plan(sum = {}) {
    const lines = [], s = readSettings();
    const names = Object.entries(sum.headsetNames || {}).filter(([k, v]) => (s.headsetNames || {})[k] !== v);
    if (names.length) lines.push({ what: 'headset-names', label: 'Headset names', text: names.map(([, v]) => v).join(', ') });
    if (sum.headsetPick && sum.headsetPick !== s.headsetPick) lines.push({ what: 'headset-pick', label: 'Headset in use', text: 'the one picked on the other PC (when it is plugged in here)' });
    if (sum.background) {
      const pic = picture(), now = pic ? sha(fs.readFileSync(pic.file)) : null;
      if (now !== sum.background.sha) lines.push({ what: 'background', label: 'Background picture', text: pic ? 'replaced by the one in the file' : 'the one in the file' });
    }
    const here = new Map(drivers().map((d) => [d.name, sha(JSON.stringify(Object.entries(d.files).sort()))]));
    const newDrivers = (sum.myDevices || []).filter((d) => !here.has(d.name)), kept = (sum.myDevices || []).filter((d) => here.has(d.name) && here.get(d.name) !== d.sha);
    if (newDrivers.length) lines.push({ what: 'drivers', label: 'Added devices', text: newDrivers.map((d) => d.name).join(', ') + ' (a restart of DeviceHub loads them)' });
    if (kept.length) lines.push({ what: 'drivers-kept', label: 'Kept as they are here', text: kept.map((d) => d.name).join(', ') });
    if ((sum.wallpapers || []).length && wallpapers) {
      const hereSha = new Set(wallpapers.list().items.map((it) => { try { return sha(fs.readFileSync(wallpapers.file(it.name).full)); } catch { return ''; } }));
      const add = sum.wallpapers.filter((w) => !hereSha.has(w.sha));
      if (add.length) lines.push({ what: 'wallpapers', label: 'Wallpapers', text: `${add.length} to add` });
    }
    return { lines };
  }

  // put them here; settings.json backed up first; never over a driver folder or picture already here
  function apply(x = {}) {
    const done = [];
    const s = readSettings();
    let changed = false;
    const names = { ...(s.headsetNames || {}) };
    for (const [k, v] of Object.entries(x.headsetNames || {})) {
      if (/^(VID_[0-9A-F]{4}&PID_[0-9A-F]{4}|JACK_[0-9A-F]{8})$/.test(k) && typeof v === 'string') {
        const name = v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
        if (name && names[k] !== name) { names[k] = name; changed = true; }
      }
    }
    const pick = typeof x.headsetPick === 'string' && /^(hs80|VID_[0-9A-F]{4}&PID_[0-9A-F]{4}|JACK_[0-9A-F]{8})$/i.test(x.headsetPick) ? x.headsetPick : null;
    if (pick && pick !== s.headsetPick) changed = true;
    if (changed) {
      if (fs.existsSync(SETTINGS)) { fs.mkdirSync(BACKUPS, { recursive: true }); fs.copyFileSync(SETTINGS, path.join(BACKUPS, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)); }
      writeAtomic(SETTINGS, JSON.stringify({ ...s, headsetNames: names, ...(pick ? { headsetPick: pick } : {}) }, null, 2));
      done.push('headset names');
    }
    if (x.background && PICTURE[x.background.ext]) {
      const buf = Buffer.from(String(x.background.data || ''), 'base64');
      const ok = { png: (b) => b.readUInt32BE(0) === 0x89504e47, jpg: (b) => b[0] === 0xff && b[1] === 0xd8, webp: (b) => b.toString('latin1', 8, 12) === 'WEBP' }[x.background.ext];
      if (buf.length > 12 && buf.length <= 8 * 1024 * 1024 && ok(buf)) {
        // the picture here is copied to backups first (31 Oct 2026: it was deleted with no copy)
        const old = picture();
        if (old) { fs.mkdirSync(BACKUPS, { recursive: true }); fs.copyFileSync(old.file, path.join(BACKUPS, `background-picture-${new Date().toISOString().replace(/[:.]/g, '-')}${path.extname(old.file)}`)); fs.unlinkSync(old.file); }
        writeAtomic(dataFile(`background-picture.${x.background.ext}`, root), buf);
        done.push('background picture');
      }
    }
    const added = [];
    for (const d of x.myDevices || []) {
      if (!safePart(d.name) || d.name.startsWith('_') || fs.existsSync(path.join(MY, d.name))) continue;   // already here: kept
      const dest = path.join(MY, d.name);
      const files = Object.entries(d.files || {}).filter(([r]) => r.split('/').every(safePart) && r.split('/').length <= 3 && DRIVER_FILE.test(r));
      if (!files.length) continue;
      for (const [r, b64] of files) {
        const buf = Buffer.from(String(b64), 'base64'); if (buf.length > DRIVER_MAX) continue;
        const full = path.join(dest, ...r.split('/'));
        if (!full.startsWith(dest + path.sep)) continue;
        fs.mkdirSync(path.dirname(full), { recursive: true });
        writeAtomic(full, buf);
      }
      added.push(d.name);
    }
    if (added.length) done.push(`added devices: ${added.join(', ')}`);
    let pics = 0;
    if (wallpapers) for (const w of x.wallpapers || []) { try { const r = wallpapers.add(w.name, Buffer.from(String(w.data || ''), 'base64')); if (r.ok) pics++; } catch {} }
    if (pics) done.push(`${pics} wallpaper${pics === 1 ? '' : 's'}`);
    return { ok: true, done, restart: added.length > 0 };
  }

  return { gather, summarize, plan, apply, wallpaperBytes, drivers };
}

module.exports = { create };
