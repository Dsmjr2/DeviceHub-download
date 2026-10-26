// Keep the last answer for a slow read (26 Oct 2026, Shawn approved; the way helpers/pc-check.js does it): the last
// answer comes back at once; once it is older than staleMs it is read again in the background, for the next ask; it is
// kept on disk, so it is there right after a restart. A person's click (Look again, Check, Find lights) asks with fresh
// and waits for a new read; after a write or an install, invalidate() makes the next ask wait for a new read too.
//   const c = lastAnswer({ name, staleMs, read: (fresh) => Promise<value>, toDisk: (value) => value without anything personal })
//   await c.get(fresh)   the value (fresh, nothing kept yet, or invalidated: waits for a read)
//   c.invalidate()       the next get waits for a read that started after this call (a write changed what it reads)
//   c.peek()             { at, value, fromDisk } or null, without reading
// Disk copies: <dir>\<name>.json once server.js calls useDisk(<DeviceHub>\read-cache) (gitignored, never in the zip),
// or the file given; a test that only requires a helper writes none. A copy older than maxDiskMs is not used.
const fs = require('fs');
const path = require('path');

let diskDir = null;
function useDisk(dir) { diskDir = dir; }
// every text in a disk copy without this PC's user folder or user name (an error message can name a path)
function scrubPersonal(value) {
  const home = require('os').homedir(), user = process.env.USERNAME || require('os').userInfo().username || '';
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [home && [new RegExp(esc(home), 'gi'), '%USERPROFILE%'], user.length >= 3 && [new RegExp(`\\b${esc(user)}\\b`, 'gi'), '%USERNAME%']].filter(Boolean);
  const walk = (v) => (typeof v === 'string' ? pats.reduce((t, [re, to]) => t.replace(re, to), v)
    : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(value);
}

function lastAnswer({ name = null, file = null, staleMs, maxDiskMs = 24 * 3600e3, read, toDisk = (v) => v, now = () => Date.now(), onError = () => {} }) {
  if (typeof read !== 'function') throw new Error('lastAnswer needs read()');
  if (!(staleMs > 0)) throw new Error('lastAnswer needs staleMs');
  // dirtyAfter: invalidate() was called when this many reads had started; only a read started after it counts
  let kept = null, pending = null, dirtyAfter = null, reads = 0, started = 0, landed = 0, loaded = false;
  const fileOf = () => file || (name && diskDir ? path.join(diskDir, `${name}.json`) : null);
  const load = () => {
    if (loaded) return;
    loaded = true;
    const f = fileOf();
    if (!f || kept) return;
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d && d.value !== undefined && Number.isFinite(d.at) && d.at <= now() && now() - d.at < maxDiskMs) kept = { at: d.at, value: d.value, fromDisk: true };
    } catch { /* none yet, or damaged: read when asked */ }
  };
  const save = (k) => {
    const f = fileOf();
    if (!f) return;
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ at: k.at, value: scrubPersonal(toDisk(k.value)) }));
      fs.renameSync(tmp, f);
    } catch (e) { onError(e); }
  };
  function readNow(fresh) {
    // a fresh ask never shares a background read (it may have started before the click's change), and after an
    // invalidate() no read that started before it is shared
    if (pending && (pending.fresh || !fresh) && (dirtyAfter == null || pending.n > dirtyAfter)) return pending.p;
    const mine = { fresh: !!fresh, n: ++started };
    reads++;
    let run;
    try { run = Promise.resolve(read(!!fresh)); } catch (e) { run = Promise.reject(e); }
    mine.p = run.then((value) => {
      // an older read that ends after a newer one is not kept over it
      if (mine.n < landed) return value;
      landed = mine.n;
      kept = { at: now(), value, fromDisk: false };
      if (dirtyAfter != null && mine.n > dirtyAfter) dirtyAfter = null;
      save(kept);
      return value;
    }).finally(() => { if (pending === mine) pending = null; });
    pending = mine;
    return mine.p;
  }
  return {
    get(fresh = false) {
      load();
      if (fresh || !kept || dirtyAfter != null) return readNow(fresh);
      if (now() - kept.at >= staleMs && !pending) readNow(false).catch(onError);
      return Promise.resolve(kept.value);
    },
    invalidate() { dirtyAfter = started; },
    peek: () => { load(); return kept ? { ...kept } : null; },
    reads: () => reads,
    file: fileOf,
  };
}

module.exports = { lastAnswer, useDisk, scrubPersonal };
