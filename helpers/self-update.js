// DeviceHub updating itself from its private GitHub repository (19 Oct 2026, Shawn: get the changes made on the PC to
// the laptop quickly). Settings shows how many new changes there are; Update pulls them (fast-forward only, so nothing
// local is ever merged or overwritten) and DeviceHub restarts with them. Only DeviceHub's own code changes: its data
// (backups, settings, presets, history) and the bundled Node are outside git (.gitignore).
// Safe updates (20 Oct 2026): the new code is checked (tests/check.mjs) before DeviceHub restarts with it, and goes
// straight back to the old version if the check fails. update-rollback.txt holds the old version until the new one
// has run well for a minute (server.js clears it); if the new version crashes on start before then, the keep-running
// loop (helpers/keep-running.bat) goes back to the old version by itself.
const { execFile, spawnSync } = require('child_process');
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');

const ROOT = path.join(__dirname, '..');
const git = (args, timeout = 30000) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: ROOT, windowsHide: true, timeout }, (e, out, err) => (e ? reject(new Error((err || e.message).trim().split('\n').pop())) : resolve(out.trim())));
});

// ---- copies installed from the zip (21 Oct 2026): no git, so they update from the published release ----
// The release (github.com/Dsmjr2/DeviceHub-download, made by helpers/make-installer.ps1) carries version.json: the
// version (commit), its size and SHA-256. The copy's own release.json says which version it is. Update downloads the
// zip, checks its size and SHA-256, unpacks it, runs the new version's own checks (tests/check.mjs), and only then
// runs its installer over this copy (helpers/install.ps1: quits DeviceHub, copies, keeps this PC's data, builds the
// device helper, starts it again). Any failure before the installer leaves this copy exactly as it was.
const RELEASE = process.env.DEVICEHUB_RELEASE_URL || 'https://github.com/Dsmjr2/DeviceHub-download/releases/latest/download/';  // a test points it at a local copy
const mine = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8')); } catch { return null; } };
async function releaseInfo() {
  const r = await fetch(RELEASE + 'version.json', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`the download page answered ${r.status}`);
  return r.json();
}
// app files changed on this PC since it was installed (release-files.json: each file's SHA-256 then): an update
// would undo them, so it is not offered over them (21 Oct 2026)
function changedFiles() {
  let prints; try { prints = JSON.parse(fs.readFileSync(path.join(ROOT, 'release-files.json'), 'utf8')); } catch { return []; }
  const crypto = require('crypto');
  return Object.entries(prints).filter(([f, h]) => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex') !== h; } catch { return true; } }).map(([f]) => f);
}
const blockedText = (c) => `${c.length} of DeviceHub's files were changed on this PC (${c.slice(0, 4).join(', ')}${c.length > 4 ? ', …' : ''}); updating would undo them. Ask Claude Code to "update DeviceHub" to bring them and the new version together.`;

async function zipStatus() {
  const own = mine();
  if (!own) return { git: false, zip: false };
  try {
    const rel = await releaseInfo();
    let failed = null; try { failed = fs.readFileSync(path.join(ROOT, 'update-failed.txt'), 'utf8').trim(); } catch {}
    const newer = rel.commit && rel.commit !== own.commit && rel.builtAt > own.builtAt && failed !== rel.commit;
    const blocked = newer ? changedFiles() : [];
    return { git: false, zip: true, behind: newer ? 1 : 0, blocked: blocked.length ? blockedText(blocked) : undefined, latest: newer ? `a new version from ${new Date(rel.builtAt).toLocaleDateString()}` : null, at: own.builtAt, skipped: failed === rel.commit ? 'the newest version' : undefined };
  } catch (e) { return { git: false, zip: true, error: e.message }; }
}
async function zipUpdate() {
  const own = mine(), rel = await releaseInfo();
  if (!own) throw new Error('this copy does not know its version');
  if (!(rel.commit !== own.commit && rel.builtAt > own.builtAt)) return { updated: false };
  const changed = changedFiles();
  if (changed.length) throw new Error(blockedText(changed));
  const crypto = require('crypto'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-update-'));
  const zip = path.join(dir, 'DeviceHub-setup.zip');
  const r = await fetch(RELEASE + 'DeviceHub-setup.zip', { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!r.ok) throw new Error(`the download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length !== rel.size) throw new Error(`the download is ${buf.length} bytes, not ${rel.size}; nothing was changed`);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== rel.sha256) throw new Error('the download does not match its checksum; nothing was changed');
  fs.writeFileSync(zip, buf);
  const ps = (cmd, ms) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', timeout: ms, windowsHide: true });
  const x = ps(`Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`, 5 * 60 * 1000);
  const src = path.join(dir, 'DeviceHub');
  if (x.status !== 0 || !fs.existsSync(path.join(src, 'helpers', 'install.ps1'))) throw new Error('the download could not be unpacked; nothing was changed');
  // the new version checks itself before it is installed
  const check = path.join(src, 'tests', 'check.mjs');
  if (fs.existsSync(check)) {
    const c = spawnSync(process.execPath, [check], { cwd: src, encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (c.status !== 0) throw new Error('the new version did not pass its checks, so DeviceHub stayed on this one');
  }
  // its installer replaces this copy (it quits this DeviceHub first and starts the new one); run on its own, outside
  // this folder, with no new shortcuts
  const { spawn } = require('child_process');
  // the Windows Apps entry this copy was installed under (DeviceHub, or a test install's own name) stays the same
  let key = 'DeviceHub';
  try {
    const out = require('child_process').execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/v', 'InstallLocation'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    let cur = null;
    for (const l of out.split(/\r?\n/)) {
      if (/^HKEY_/.test(l)) cur = l.split('\\').pop().trim();
      else if (/InstallLocation\s+REG_SZ\s+/.test(l) && path.resolve(l.split(/REG_SZ\s+/)[1].trim()).toLowerCase() === path.resolve(ROOT).toLowerCase()) key = cur;
    }
  } catch {}
  // a test copy (DEVICEHUB_TEST=1) is not started again by the installer: it would start on the real port
  // Started through Start-Process, so it is not Node's own child: Windows ends the programs Node starts when Node ends,
  // and the installer ends this DeviceHub (21 Oct 2026: it ended itself with it, halfway, and the copy stayed stopped).
  // Its output goes to install.log in the download folder.
  const q = (s) => `"${s}"`;
  const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', q(path.join(src, 'helpers', 'install.ps1')), '-Target', q(ROOT), '-NoShortcuts', '-AppsKey', q(key), ...(process.env.DEVICEHUB_TEST === '1' ? ['-NoLaunch'] : [])].join(' ');
  const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const launcher = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -WorkingDirectory ${sq(dir)} -RedirectStandardOutput ${sq(path.join(dir, 'install.log'))} -ArgumentList ${sq(inner)}`;
  const p = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { cwd: dir, stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
  return { updated: true, installing: true, count: 1, latest: `version from ${new Date(rel.builtAt).toLocaleDateString()}` };
}

async function status() {
  try { if ((await git(['rev-parse', '--is-inside-work-tree'], 8000)) !== 'true') throw new Error(); } catch { return zipStatus(); }
  try {
    await git(['fetch', '--quiet', 'origin'], 30000);
    const behind = Number(await git(['rev-list', '--count', 'HEAD..@{u}'])) || 0;
    const changed = (await git(['status', '--porcelain', '--untracked-files=no'])).split('\n').filter(Boolean).length;
    const latest = behind ? await git(['log', '-1', '--format=%s', '@{u}']) : null;
    const at = await git(['log', '-1', '--format=%cI', 'HEAD']);
    // the newest version already crashed on start here once (helpers/keep-running.bat wrote update-failed.txt): not
    // offered again; a newer one (a fix) is
    let failed = null; try { failed = fs.readFileSync(path.join(ROOT, 'update-failed.txt'), 'utf8').trim(); } catch {}
    // a copy installed on someone's PC, tied to the public download repository: its updates merge (mergeUpdate)
    const shared = /DeviceHub-download/.test(await git(['remote', 'get-url', 'origin']).catch(() => ''));
    const shownLatest = shared && behind ? `a new version from ${new Date(await git(['log', '-1', '--format=%cI', '@{u}'])).toLocaleDateString()}${changed ? '; your changes are kept' : ''}` : latest;
    if (failed && behind && failed === (await git(['rev-parse', '@{u}']))) return { git: true, shared, behind: 0, changed, latest: null, at, skipped: shownLatest };
    return { git: true, shared, behind, changed, latest: shownLatest, at };
  } catch (e) { return { git: true, error: e.message }; }
}

// pulls the new changes; the caller restarts DeviceHub afterwards
async function update() {
  const s = await status();
  if (s.zip) return zipUpdate();
  if (!s.git) throw new Error('this copy of DeviceHub is not connected to GitHub');
  if (s.error) throw new Error(s.error);
  if (s.shared) return mergeUpdate(s);
  if (s.changed) throw new Error(`${s.changed} file(s) were changed on this PC; not updating over them`);
  if (!s.behind) return { updated: false };
  const old = await git(['rev-parse', 'HEAD']);
  await git(['pull', '--ff-only', '--quiet'], 60000);
  // check the new code before running it
  const check = path.join(ROOT, 'tests', 'check.mjs');
  if (fs.existsSync(check)) {
    const r = spawnSync(process.execPath, [check], { cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (r.status !== 0) {
      await git(['reset', '--quiet', '--hard', old]);
      const why = `${r.stdout || ''}${r.stderr || ''}`.split('\n').find((l) => l.startsWith('- ')) || 'its checks failed';
      throw new Error(`the new version did not pass its checks, so DeviceHub stayed on this one (${why.replace(/^- /, '').slice(0, 160)})`);
    }
  }
  writeAtomic(path.join(ROOT, 'update-rollback.txt'), old);
  return { updated: true, count: s.behind, latest: s.latest };
}

// A copy installed on someone's PC (21 Oct 2026): the changes made on it (by its owner or their Claude) are kept as a
// commit of their own, and the new version is merged with them. Where both changed the same lines, nothing is changed
// and the files are named (Claude Code can bring them together: CLAUDE.md, "Update DeviceHub"). The merged code is
// checked before DeviceHub restarts with it, and goes back to how it was if the check fails; a crash on start goes back
// too (update-rollback.txt, helpers/keep-running.bat).
const ME = ['-c', 'user.name=DeviceHub', '-c', 'user.email=devicehub@localhost'];
async function mergeUpdate(s) {
  if (!s.behind) return { updated: false };
  if (s.changed) await git([...ME, 'commit', '-q', '-a', '-m', 'Changes made on this PC']);
  const before = await git(['rev-parse', 'HEAD']);
  try { await git([...ME, 'merge', '--no-edit', '-q', '@{u}'], 60000); }
  catch (e) {
    const both = (await git(['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
    await git(['merge', '--abort']).catch(() => {});
    await git(['reset', '-q', '--hard', before]).catch(() => {});
    throw new Error(both.length
      ? `the new version and this PC's changes both change ${both.slice(0, 4).join(', ')}${both.length > 4 ? ', …' : ''}; nothing was changed. Ask Claude Code to "update DeviceHub": it can bring the two together.`
      : `the new version could not be brought together with this PC's files (${e.message}); nothing was changed`);
  }
  const check = path.join(ROOT, 'tests', 'check.mjs');
  if (fs.existsSync(check)) {
    const r = spawnSync(process.execPath, [check], { cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (r.status !== 0) { await git(['reset', '-q', '--hard', before]); throw new Error("the new version, with this PC's changes, did not pass its checks, so DeviceHub stayed as it was"); }
  }
  writeAtomic(path.join(ROOT, 'update-rollback.txt'), before);
  return { updated: true, count: s.behind, latest: s.latest };
}

// called once the new version has run well for a minute: it is kept
function confirm(log) {
  const f = path.join(ROOT, 'update-rollback.txt');
  if (!fs.existsSync(f)) return;
  setTimeout(() => { try { fs.unlinkSync(f); log && log({ kind: 'good', text: 'DeviceHub update running well' }); } catch {} }, 60000);
}

module.exports = { status, update, confirm };
