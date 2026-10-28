// This PC's files into data\ and the server's log into logs\ (27 Oct 2026, Shawn: tidy the DeviceHub folder). A
// version before that kept about 30 files loose beside the app; server.js runs migrate() first thing at every start,
// before any module reads one, so they move once and nothing changes for the person.
//   - a file beside the app and not in data\: moved there (one rename each: the file is whole in one place or the other)
//   - in both places: data\ is kept as it is, and the one beside the app goes to data\from-root\ (never deleted)
//   - a file Windows holds open (rare): left where it is and tried again at the next start
// One "[data]" line in the log when anything moved; nothing at all on a start with nothing to move.
// toRoot() is the other way, for going back to a version from before data\ (helpers/keep-running.bat runs
// `node helpers\data-migrate.js --to-root` before it puts back a version that has no helpers/data-migrate.js), so that
// version still finds the person's settings beside the app.
const fs = require('fs');
const path = require('path');
const { ROOT, DATA_FILES, LOG_FILES, isPicture } = require('./data-dir');

const isData = (name) => DATA_FILES.includes(name) || isPicture(name)
  // a copy kept aside when it would not parse (server.js readJsonFile: settings.json.damaged-<time>)
  || DATA_FILES.some((f) => name.startsWith(`${f}.damaged-`));

function rename(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      const until = Date.now() + 40 * (i + 1); while (Date.now() < until) { /* Windows lets go of it in a moment */ }
    }
  }
}
const exists = (f) => { try { fs.lstatSync(f); return true; } catch { return false; } };
// a free name in data\from-root\ (a second time for the same name gets the time added)
function aside(dir, name) {
  const d = path.join(dir, 'from-root');
  fs.mkdirSync(d, { recursive: true });
  let to = path.join(d, name);
  if (exists(to)) to = path.join(d, `${name}.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return to;
}
const looseFiles = (root) => { try { return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; } };

// returns { moved: [names], aside: [names], failed: [{ name, error }] }
function migrate({ root = ROOT, log = (t) => console.log(t) } = {}) {
  const data = path.join(root, 'data'), logs = path.join(root, 'logs');
  const out = { moved: [], aside: [], failed: [] };
  // both folders always exist after a start, so every save can go straight in
  for (const d of [data, logs]) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
  const names = looseFiles(root);
  // the newest log first: when logs\server.log is already there (the launcher writes it before the server starts),
  // the old server.log beside the app becomes logs\server.old.log, which Get help and diagnose read too
  const logsHere = LOG_FILES.filter((n) => names.includes(n));
  for (const name of [...names.filter(isData), ...logsHere]) {
    const isLog = LOG_FILES.includes(name), dir = isLog ? logs : data;
    const from = path.join(root, name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      let to = path.join(dir, name);
      if (exists(to) && isLog && name === 'server.log' && !exists(path.join(logs, 'server.old.log'))) to = path.join(logs, 'server.old.log');
      if (exists(to)) { to = aside(dir, name); rename(from, to); out.aside.push(name); }
      else { rename(from, to); out.moved.push(name); }
    } catch (e) { out.failed.push({ name, error: e.code || e.message }); }
  }
  if (out.moved.length || out.aside.length || out.failed.length) {
    const parts = [];
    if (out.moved.length) parts.push(`moved ${out.moved.length} file${out.moved.length === 1 ? '' : 's'} into data\\ and logs\\ (${out.moved.join(', ')})`);
    if (out.aside.length) parts.push(`${out.aside.join(', ')} ${out.aside.length === 1 ? 'was' : 'were'} in both places: data\\ kept, the old one${out.aside.length === 1 ? '' : 's'} in data\\from-root\\`);
    if (out.failed.length) parts.push(`not moved yet (tried again next start): ${out.failed.map((f) => `${f.name} (${f.error})`).join(', ')}`);
    try { log(`[data] ${parts.join('; ')}`); } catch {}
  }
  return out;
}

// data\ back beside the app, for a version from before data\: only the names that version knows, only where the root
// has none (nothing is overwritten); logs\ stays (an older version starts its own server.log beside the app)
function toRoot({ root = ROOT, log = (t) => console.log(t) } = {}) {
  const data = path.join(root, 'data');
  const out = { moved: [], failed: [] };
  for (const name of looseFiles(data).filter((n) => DATA_FILES.includes(n) || isPicture(n))) {
    if (exists(path.join(root, name))) continue;
    try { rename(path.join(data, name), path.join(root, name)); out.moved.push(name); }
    catch (e) { out.failed.push({ name, error: e.code || e.message }); }
  }
  if (out.moved.length || out.failed.length) {
    try { log(`[data] for the older version, moved ${out.moved.length} file${out.moved.length === 1 ? '' : 's'} from data\\ back beside the app${out.failed.length ? `; not moved: ${out.failed.map((f) => f.name).join(', ')}` : ''}`); } catch {}
  }
  return out;
}

module.exports = { migrate, toRoot, isData };

// node helpers/data-migrate.js [--to-root] [folder]
if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || ROOT;
  const r = args.includes('--to-root') ? toRoot({ root }) : migrate({ root });
  process.exit(r.failed.length ? 1 : 0);
}
