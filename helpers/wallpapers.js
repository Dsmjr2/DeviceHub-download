// Wallpapers (22 Oct 2026, Shawn: "I want it display the wallpapers easily since most people have to have folders to keep
// them. Can we store them in this wallpaper area so people can easily get them and preview them and back them up?").
// One folder of pictures that outlives DeviceHub: %USERPROFILE%\Pictures\DeviceHub Wallpapers (DEVICEHUB_WALLPAPERS_DIR
// for tests and other systems), made on first use. It sits outside DeviceHub's own folder, so no update, reinstall or
// uninstall touches it, and nothing in it can reach git or the installer.
// - add: one picture at a time (PNG, JPEG, WebP, GIF or BMP, checked by its first bytes, at most 40 MB); an exact copy
//   of one already there (same SHA-256) is skipped, and the name is made safe and unique.
// - a name from the page is only ever a plain file name in that folder (no folders, no "..", must exist).
// - back up: the whole folder copied to Documents\DeviceHub backups\Wallpapers <date time>\ (where the uninstaller
//   keeps DeviceHub's backups; DEVICEHUB_WALLPAPER_BACKUPS_DIR for tests).
// - use as DeviceHub's background: copied to data\background-picture.<ext> in DeviceHub's folder (server.js /api/background).
// - set as the Windows wallpaper, only on the person's click: the wallpaper Windows had is kept first (its path, and a
//   copy of the file, since Windows overwrites its own TranscodedWallpaper), so Put back can restore it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)

const MAX_BYTES = 40 * 1024 * 1024;
// [extension, content type, test on the first bytes]
const KINDS = [
  ['png', 'image/png', (b) => b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a],
  ['jpg', 'image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['webp', 'image/webp', (b) => b.length > 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
  ['gif', 'image/gif', (b) => b.length > 10 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))],
  ['bmp', 'image/bmp', (b) => b.length > 26 && b[0] === 0x42 && b[1] === 0x4d],
];
const EXT_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
const kindOf = (buf) => KINDS.find(([, , is]) => is(buf)) || null;
// DeviceHub's own background takes these three (server.js /api/background); Windows' wallpaper takes JPEG, PNG and BMP
const BACKGROUND_OK = new Set(['png', 'jpg', 'webp']);
const WINDOWS_OK = new Set(['png', 'jpg', 'jpeg', 'bmp']);

// width and height from the file's own header (no image library): PNG, JPEG, WebP, GIF, BMP; null when not found
function size(b) {
  try {
    const k = kindOf(b)?.[0];
    if (k === 'png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (k === 'gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (k === 'bmp') return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
    if (k === 'webp') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (k === 'jpg') {
      // walk the segments to the first frame header (SOF0-SOF15, not DHT C4, JPG C8 or DAC CC)
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}

// a name that came from someone's file: its last part only, no characters Windows refuses, no leading dots, not a
// reserved device name, at most 100 characters, and the extension the picture really is
function safeFileName(original, ext) {
  let base = String(original || '').split(/[\\/]/).pop();
  base = base.replace(/\.[a-z0-9]{1,5}$/i, '');
  base = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base} picture`;
  base = base.slice(0, 100).trim() || 'wallpaper';
  return `${base}.${ext}`;
}

function create(opts = {}) {
  const DIR = path.resolve(opts.dir || process.env.DEVICEHUB_WALLPAPERS_DIR || path.join(os.homedir(), 'Pictures', 'DeviceHub Wallpapers'));
  const BACKUPS = path.resolve(opts.backupsDir || process.env.DEVICEHUB_WALLPAPER_BACKUPS_DIR || path.join(os.homedir(), 'Documents', 'DeviceHub backups'));
  const ROOT = path.resolve(opts.root || path.join(__dirname, '..'));   // DeviceHub's own folder (the background picture)
  const STARTERS = path.resolve(opts.startersDir || path.join(ROOT, 'wallpapers-starter'));   // the six that ship with DeviceHub
  const MARKER = path.join(DIR, '.devicehub-starters');
  const PREVIOUS = path.join(ROOT, 'wallpaper-previous');                // the Windows wallpaper kept for Put back (in .gitignore)
  const platform = opts.platform || process.platform;
  const powershell = opts.powershell || runPowerShell;
  const ensure = () => { fs.mkdirSync(DIR, { recursive: true }); return DIR; };

  // a plain file name in the folder, a picture, and there: anything else is refused (never a path outside the folder)
  function resolveName(name) {
    if (typeof name !== 'string' || !name || name.length > 200) throw new Error('No such wallpaper.');
    if (/[\\/:\u0000-\u001f]/.test(name) || name === '.' || name === '..' || name.startsWith('.')) throw new Error('No such wallpaper.');
    if (!EXT_TYPE[path.extname(name).slice(1).toLowerCase()]) throw new Error('No such wallpaper.');
    const full = path.join(DIR, name);
    if (path.dirname(full) !== DIR) throw new Error('No such wallpaper.');
    let st; try { st = fs.lstatSync(full); } catch { throw new Error('No such wallpaper.'); }
    if (!st.isFile()) throw new Error('No such wallpaper.');
    return { full, st };
  }

  // header facts and hashes, remembered per file (name, size and time), so listing 200 pictures reads only new ones
  const facts = new Map();
  function factsOf(full, st) {
    const key = `${full}|${st.size}|${st.mtimeMs}`;
    let f = facts.get(key);
    if (!f) {
      const fd = fs.openSync(full, 'r');
      try { const head = Buffer.alloc(Math.min(st.size, 256 * 1024)); fs.readSync(fd, head, 0, head.length, 0); f = { kind: kindOf(head), size: size(head) }; }
      finally { fs.closeSync(fd); }
      facts.set(key, f);
    }
    return f;
  }
  const hashOf = (full) => crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');

  // Starter wallpapers (22 Oct 2026, Shawn: "include some cool ones to start and make them easily deletable"): copied in
  // once, the first time the folder is listed, then a marker file says so; a starter the person deletes never comes back
  // and no update adds them again. A picture already there with the same bytes is not copied twice.
  const starterNames = () => { try { return fs.readdirSync(STARTERS).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort(); } catch { return []; } };
  function seed() {
    if (fs.existsSync(MARKER)) return 0;
    ensure();
    let n = 0;
    for (const f of starterNames()) {
      try { const r = add(f, fs.readFileSync(path.join(STARTERS, f))); if (r.ok) n++; } catch {}
    }
    writeAtomic(MARKER, `Starter wallpapers were added on ${new Date().toISOString()}. DeviceHub adds them only once; delete this file to get them back.\n`);
    return n;
  }
  // the starters themselves, read-only (demo mode shows them; nothing is written)
  function starters() {
    return starterNames().map((name) => {
      const full = path.join(STARTERS, name), st = fs.statSync(full), f = factsOf(full, st);
      return { name, bytes: st.size, type: f.kind?.[1] || 'image/jpeg', ...(f.size || {}), addedAt: st.mtime.toISOString() };
    });
  }
  function starterFile(name) {
    if (typeof name !== 'string' || !starterNames().includes(name)) throw new Error('No such wallpaper.');
    const full = path.join(STARTERS, name);
    return { full, st: fs.statSync(full), type: EXT_TYPE[path.extname(name).slice(1).toLowerCase()] };
  }

  function list() {
    try { seed(); } catch {}
    if (!fs.existsSync(DIR)) return { dir: DIR, items: [], totalBytes: 0 };
    const items = [];
    for (const e of fs.readdirSync(DIR, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.') || !EXT_TYPE[path.extname(e.name).slice(1).toLowerCase()]) continue;
      try {
        const full = path.join(DIR, e.name), st = fs.statSync(full), f = factsOf(full, st);
        if (!f.kind) continue;   // named like a picture but is not one
        items.push({ name: e.name, bytes: st.size, type: f.kind[1], ...(f.size || {}), addedAt: st.mtime.toISOString(), thumb: hasThumb(e.name, st) });
      } catch {}
    }
    items.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
    return { dir: DIR, items, totalBytes: items.reduce((s, x) => s + x.bytes, 0) };
  }

  function file(name) { const { full, st } = resolveName(name); return { full, st, type: EXT_TYPE[path.extname(full).slice(1).toLowerCase()] }; }

  function add(originalName, buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw Object.assign(new Error('That file is empty.'), { code: 400 });
    if (buf.length > MAX_BYTES) throw Object.assign(new Error('That picture is over 40 MB.'), { code: 413 });
    const kind = kindOf(buf);
    if (!kind) throw Object.assign(new Error('Not a picture DeviceHub keeps (PNG, JPEG, WebP, GIF or BMP).'), { code: 400 });
    ensure();
    // an exact copy already there: only files of the same size are read to compare
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    for (const e of fs.readdirSync(DIR, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const full = path.join(DIR, e.name);
      try { if (fs.statSync(full).size === buf.length && hashOf(full) === hash) return { duplicate: true, name: e.name }; } catch {}
    }
    const wanted = safeFileName(originalName, kind[0]);
    const stem = wanted.slice(0, -(kind[0].length + 1));
    let name = wanted;
    const taken = (n) => fs.readdirSync(DIR).some((x) => x.toLowerCase() === n.toLowerCase());   // Windows ignores case
    for (let i = 2; taken(name); i++) name = `${stem} (${i}).${kind[0]}`;
    writeAtomic(path.join(DIR, name), buf);
    return { ok: true, name, bytes: buf.length, type: kind[1] };
  }

  function remove(name) { const { full } = resolveName(name); fs.unlinkSync(full); try { fs.unlinkSync(thumbOf(name)); } catch {} return { ok: true }; }

  // Small previews for the grid (22 Oct 2026, Shawn: "make the wallpaper area faster with every button press"): the page
  // draws one from the picture the first time it shows it and sends it here (a JPEG, at most 600 KB); after that the
  // grid loads these instead of the full pictures. Kept in the folder's hidden .thumbs folder (backups skip it).
  const THUMBS = path.join(DIR, '.thumbs');
  const thumbOf = (name) => path.join(THUMBS, `${name}.jpg`);
  function hasThumb(name, st) { try { return fs.statSync(thumbOf(name)).mtimeMs >= st.mtimeMs - 1000; } catch { return false; } }
  function thumbFile(name) { resolveName(name); const full = thumbOf(name); const st = fs.statSync(full); return { full, st, type: 'image/jpeg' }; }
  function saveThumb(name, buf) {
    resolveName(name);
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf.length > 600 * 1024 || !(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) throw Object.assign(new Error('Not a preview picture.'), { code: 400 });
    fs.mkdirSync(THUMBS, { recursive: true });
    writeAtomic(thumbOf(name), buf);
    return { ok: true };
  }

  // a new name for a picture, typed on the page (Shawn: "make the names easily editable"): made safe the same way as an
  // added file's, the picture's own extension kept, never over another picture (Windows ignores case); its preview follows
  function rename(name, to) {
    const { full } = resolveName(name);
    const ext = path.extname(full).slice(1);
    const wanted = safeFileName(`${String(to || '').trim()}.${ext}`, ext);
    if (wanted.toLowerCase() === name.toLowerCase() && wanted !== name) { fs.renameSync(full, path.join(DIR, wanted)); }
    else if (wanted !== name) {
      if (fs.readdirSync(DIR).some((x) => x.toLowerCase() === wanted.toLowerCase())) throw Object.assign(new Error('Another wallpaper already has that name.'), { code: 409 });
      fs.renameSync(full, path.join(DIR, wanted));
    }
    try { if (wanted !== name) fs.renameSync(thumbOf(name), thumbOf(wanted)); } catch {}
    return { ok: true, name: wanted };
  }

  // Back up all (23 Oct 2026, Shawn: "make sure its not saving duplicates. when it backs up it needs to just save 1 of
  // each"): ONE folder, Documents\DeviceHub backups\Wallpapers, holding one copy of each picture, matched by its bytes
  // (SHA-256), not its name. Each backup copies only the pictures not already in it; a different picture with a name
  // already taken gets "name (2).ext". The dated folders earlier versions made (Wallpapers <date time>) are folded in
  // the same way, then deleted, but only once every picture in them is in the one folder with the same bytes.
  const BACKUP_DIR = path.join(BACKUPS, 'Wallpapers');
  const OLD_DATED = /^Wallpapers \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?$/;
  const PICTURE = /\.(jpe?g|png|webp|gif|bmp)$/i;
  function backup() {
    const pictures = list().items;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const have = new Map();   // sha256 -> name in the backup folder
    for (const f of fs.readdirSync(BACKUP_DIR)) { const full = path.join(BACKUP_DIR, f); if (PICTURE.test(f) && fs.statSync(full).isFile()) have.set(hashOf(full), f); }
    const freeName = (name) => {
      if (!fs.existsSync(path.join(BACKUP_DIR, name))) return name;
      const ext = path.extname(name), base = name.slice(0, -ext.length);
      for (let i = 2; ; i++) { const n = `${base} (${i})${ext}`; if (!fs.existsSync(path.join(BACKUP_DIR, n))) return n; }
    };
    const copyIn = (full, name) => {
      const h = hashOf(full);
      if (have.has(h)) return false;
      const dest = path.join(BACKUP_DIR, freeName(name));
      fs.copyFileSync(full, dest, fs.constants.COPYFILE_EXCL);
      if (hashOf(dest) !== h) { fs.rmSync(dest, { force: true }); throw new Error(`${name} was not copied correctly.`); }
      have.set(h, path.basename(dest));
      return true;
    };
    let added = 0, addedBytes = 0;
    for (const x of pictures) if (copyIn(path.join(DIR, x.name), x.name)) { added++; addedBytes += x.bytes; }
    // the dated folders of earlier backups: their pictures folded in, then the folder removed once all are there
    let folded = 0;
    for (const d of fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []) {
      const old = path.join(BACKUPS, d);
      if (!OLD_DATED.test(d) || !fs.statSync(old).isDirectory()) continue;
      const files = fs.readdirSync(old);
      if (files.some((f) => !PICTURE.test(f) && !f.startsWith('.'))) continue;   // something else in it: left alone
      for (const f of files.filter((f) => PICTURE.test(f))) if (copyIn(path.join(old, f), f)) added++;
      if (files.filter((f) => PICTURE.test(f)).every((f) => have.has(hashOf(path.join(old, f))))) { fs.rmSync(old, { recursive: true, force: true }); folded++; }
    }
    // checked: every picture in the wallpaper folder is in the backup with the same bytes
    const missing = pictures.filter((x) => !have.has(hashOf(path.join(DIR, x.name))));
    if (missing.length) throw new Error(`${missing.length} picture${missing.length === 1 ? ' was' : 's were'} not backed up (${missing.slice(0, 3).map((x) => x.name).join(', ')}).`);
    return { ok: true, count: pictures.length, added, addedBytes, inBackup: have.size, folded, bytes: pictures.reduce((s, x) => s + x.bytes, 0), dir: pictures.length || have.size ? BACKUP_DIR : null };
  }

  function useAsBackground(name) {
    const { full } = resolveName(name);
    const buf = fs.readFileSync(full), kind = kindOf(buf);
    if (!kind || !BACKGROUND_OK.has(kind[0])) throw Object.assign(new Error("DeviceHub's background takes PNG, JPEG or WebP pictures."), { code: 400 });
    for (const ext of BACKGROUND_OK) { const old = require('./data-dir').dataFile(`background-picture.${ext}`, ROOT); if (fs.existsSync(old)) fs.unlinkSync(old); }
    const dest = require('./data-dir').dataFile(`background-picture.${kind[0]}`, ROOT);
    writeAtomic(dest, buf);
    return { ok: true, type: kind[1], bytes: buf.length };
  }

  // ---- the Windows desktop wallpaper (Windows only, on the person's click) ----
  const PREV_JSON = path.join(PREVIOUS, 'previous.json');
  const readPrevious = () => { try { return JSON.parse(fs.readFileSync(PREV_JSON, 'utf8')); } catch { return null; } };
  const inside = (p, dir) => !!p && path.resolve(p).toLowerCase().startsWith(dir.toLowerCase() + path.sep);
  const currentWindows = async () => (await powershell(PS_READ, {})).trim();
  // sets it, then reads Windows' own setting back and compares
  async function applyWindows(p) {
    const back = (await powershell(PS_SET, { DEVICEHUB_WALLPAPER: p })).trim();
    if (path.resolve(back || '.').toLowerCase() !== path.resolve(p || '.').toLowerCase() && !(p === '' && back === '')) throw new Error(`Windows did not take it (its wallpaper reads back as ${back || 'none'}).`);
  }

  async function setWindows(name) {
    if (platform !== 'win32') throw Object.assign(new Error('Setting the desktop wallpaper works on Windows only.'), { code: 400 });
    const { full } = resolveName(name);
    if (!WINDOWS_OK.has(path.extname(full).slice(1).toLowerCase())) throw Object.assign(new Error('Windows takes JPEG, PNG or BMP pictures as its wallpaper.'), { code: 400 });
    // keep what Windows had first; a wallpaper DeviceHub set itself is not kept over the one from before it
    const was = await currentWindows();
    const kept = readPrevious();
    if (!(kept && inside(was, DIR))) {
      fs.mkdirSync(PREVIOUS, { recursive: true });
      // 31 Oct 2026: after Undo the desktop can be showing the kept copy itself (wallpaper-previous\previous.jpg), so that
      // file is not cleared with the rest: it is the only copy of the earlier wallpaper
      const wasKeptCopy = inside(was, PREVIOUS);
      for (const f of fs.readdirSync(PREVIOUS)) {
        const full = path.join(PREVIOUS, f);
        if (f === 'previous.json' || (wasKeptCopy && full.toLowerCase() === path.resolve(was).toLowerCase())) continue;
        try { fs.unlinkSync(full); } catch {}
      }
      let copy = null;
      try {
        const st = was && fs.statSync(was);
        if (st && st.isFile() && st.size <= 100 * 1024 * 1024) {
          const head = Buffer.alloc(Math.min(st.size, 64)); const fd = fs.openSync(was, 'r'); fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
          const ext = kindOf(head)?.[0] || 'jpg';
          copy = path.join(PREVIOUS, `previous.${ext}`);
          if (copy.toLowerCase() !== path.resolve(was).toLowerCase()) fs.copyFileSync(was, copy);
        }
      } catch { copy = null; }
      writeAtomic(PREV_JSON, JSON.stringify({ path: wasKeptCopy && copy ? copy : was, copy, keptAt: new Date().toISOString() }, null, 2));
    }
    await applyWindows(full);
    return { ok: true, previous: readPrevious()?.path || '', canUndo: await canUndo(full) };
  }

  // what Undo would put back, or null when it is gone (23 Oct 2026, Shawn: "if this is the case then do not show the
  // undo button"): its own file, else the copy kept when DeviceHub set one; '' = Windows had no wallpaper (a colour)
  function undoTarget(kept = readPrevious()) {
    if (!kept) return null;
    if (!kept.path) return '';
    // Windows' own TranscodedWallpaper (and anything in its Themes folder) was overwritten when DeviceHub set one: use the copy
    const own = /[\\/]Microsoft[\\/]Windows[\\/]Themes[\\/]/i.test(kept.path) || /TranscodedWallpaper/i.test(kept.path);
    if (!own && fs.existsSync(kept.path)) return kept.path;
    return kept.copy && fs.existsSync(kept.copy) ? kept.copy : null;
  }
  // Undo is offered only while the kept wallpaper can still be put back (read-only: the record stays, so setting another
  // one later never takes DeviceHub's own wallpaper for the earlier one)
  // 31 Oct 2026: and only while the desktop still shows a wallpaper DeviceHub set (one from its folder); once the person
  // picks another in Windows themselves, Undo would throw their choice away
  const canUndo = async (now) => {
    const kept = readPrevious();
    if (!kept || undoTarget(kept) == null) return false;
    try { return inside(now ?? await currentWindows(), DIR); } catch { return false; }
  };

  async function putBackWindows() {
    if (platform !== 'win32') throw Object.assign(new Error('Setting the desktop wallpaper works on Windows only.'), { code: 400 });
    const kept = readPrevious();
    if (!kept) throw Object.assign(new Error('Nothing to undo: no earlier wallpaper was kept.'), { code: 400 });
    const target = undoTarget(kept);
    if (target == null) throw Object.assign(new Error(`The earlier wallpaper (${kept.path}) is no longer there, so it cannot be put back.`), { code: 400, gone: true });
    // 31 Oct 2026: the person changed the wallpaper in Windows since; their choice is not undone
    if (!inside(await currentWindows(), DIR)) throw Object.assign(new Error('Nothing to undo: the wallpaper was changed in Windows since DeviceHub set it.'), { code: 400, changed: true });
    await applyWindows(target);
    try { fs.unlinkSync(PREV_JSON); } catch {}
    return { ok: true, path: target };
  }

  function reveal(name) {
    if (platform !== 'win32') throw Object.assign(new Error('Opening the folder works on Windows only.'), { code: 400 });
    ensure();
    // Explorer reads /select, with the path in quotes as one argument (a Windows path cannot hold a quote)
    if (name) { const { full } = resolveName(name); spawn('explorer.exe', [`/select,"${full}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref(); }
    else spawn('explorer.exe', [DIR], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }

  // GET /api/wallpapers, GET /api/wallpapers/file?name=, and the POSTs below; changes are POSTs only (server.js's rule)
  async function handle(url, req, res, send, readBody) {
    const p = url.pathname, GET = req.method === 'GET', POST = req.method === 'POST';
    const fail = (e) => send(res, e.code || 400, { error: e.message });
    try {
      if (p === '/api/wallpapers' && GET) {
        const undo = platform === 'win32' && await canUndo(), kept = undo ? readPrevious() : null;
        return send(res, 200, { ...list(), windows: platform === 'win32', previousKept: undo, previous: kept?.path || null });
      }
      if (p === '/api/wallpapers/starters' && GET) return send(res, 200, { items: starters() });
      if ((p === '/api/wallpapers/file' || p === '/api/wallpapers/starter' || p === '/api/wallpapers/thumb') && GET) {
        let f; try { f = (p === '/api/wallpapers/starter' ? starterFile : p === '/api/wallpapers/thumb' ? thumbFile : file)(url.searchParams.get('name')); } catch (e) { return send(res, 404, { error: e.message }); }
        const tag = `"${f.st.size.toString(36)}-${Math.round(f.st.mtimeMs).toString(36)}"`;
        if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
        res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.st.size, 'Cache-Control': 'no-cache', ETag: tag, 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(f.full).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
      }
      if (!POST) return p.startsWith('/api/wallpapers') ? send(res, 405, { error: 'POST' }) : false;
      if (p === '/api/wallpapers/add') {
        const chunks = []; let n = 0, big = false;
        await new Promise((resolve, reject) => { req.on('data', (c) => { n += c.length; if (n > MAX_BYTES) big = true; else chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
        if (big) return send(res, 413, { error: 'That picture is over 40 MB.' });
        return send(res, 200, add(url.searchParams.get('name') || 'wallpaper', Buffer.concat(chunks)));
      }
      if (p === '/api/wallpapers/remove') return send(res, 200, remove((await readBody(req)).name));
      if (p === '/api/wallpapers/rename') { const b = await readBody(req); return send(res, 200, rename(b.name, b.to)); }
      if (p === '/api/wallpapers/thumb') {
        const chunks = []; let n = 0;
        await new Promise((resolve, reject) => { req.on('data', (c) => { n += c.length; if (n <= 600 * 1024) chunks.push(c); }); req.on('end', resolve); req.on('error', reject); });
        if (n > 600 * 1024) return send(res, 413, { error: 'Preview too large.' });
        return send(res, 200, saveThumb(url.searchParams.get('name'), Buffer.concat(chunks)));
      }
      if (p === '/api/wallpapers/backup') return send(res, 200, backup());
      if (p === '/api/wallpapers/use-as-background') return send(res, 200, useAsBackground((await readBody(req)).name));
      if (p === '/api/wallpapers/set-windows') return send(res, 200, await setWindows((await readBody(req)).name));
      if (p === '/api/wallpapers/put-back-windows') return send(res, 200, await putBackWindows());
      if (p === '/api/wallpapers/reveal') return send(res, 200, reveal((await readBody(req)).name));
    } catch (e) { return fail(e); }
    return false;
  }

  return { dir: DIR, backupsDir: BACKUPS, seed, starters, list, file, add, remove, rename, saveThumb, thumbFile, backup, useAsBackground, setWindows, putBackWindows, reveal, handle };
}

// PowerShell, hidden, with the script sent encoded and the path in an environment variable: nothing from a file name is
// ever part of the script text. Output in UTF-8 so a user folder with accents comes back whole.
const PS_HEAD = '[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = "Stop"\n';
const PS_READ = `${PS_HEAD}[string](Get-ItemProperty -LiteralPath 'HKCU:\\Control Panel\\Desktop' -Name WallPaper -ErrorAction SilentlyContinue).WallPaper\n`;
const PS_SET = `${PS_HEAD}Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DeviceHubWallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int action, int param, string value, int winIni);
}
"@
# SPI_SETDESKWALLPAPER (0x14), saved and announced to Windows (SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3)
if (-not [DeviceHubWallpaper]::SystemParametersInfo(0x14, 0, [string]$env:DEVICEHUB_WALLPAPER, 3)) { throw ("SystemParametersInfo failed: " + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
[string](Get-ItemProperty -LiteralPath 'HKCU:\\Control Panel\\Desktop' -Name WallPaper -ErrorAction SilentlyContinue).WallPaper
`;
function runPowerShell(script, extraEnv) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 20000, env: { ...process.env, ...extraEnv } },
    (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).split(/\r?\n/).find((l) => l.trim()) || 'PowerShell failed')) : resolve(String(out || '')))));
}

module.exports = { create, MAX_BYTES, _test: { kindOf, size, safeFileName, PS_SET, PS_READ } };
