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
  execFile('git', args, { cwd: ROOT, windowsHide: true, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }, (e, out, err) => (e ? reject(new Error((err || e.message).trim().split('\n').pop())) : resolve(out.trim())));
});

// ---- copies installed from the zip (21 Oct 2026): no git, so they update from the published release ----
// The release (github.com/Dsmjr2/DeviceHub-download, made by helpers/make-installer.ps1) carries version.json: the
// version (commit), its size and SHA-256. The copy's own release.json says which version it is. Update downloads the
// zip, checks its size and SHA-256, unpacks it, runs the new version's own checks (tests/check.mjs), and only then
// runs its installer over this copy (helpers/install.ps1: quits DeviceHub, copies, keeps this PC's data, builds the
// device helper, starts it again). Any failure before the installer leaves this copy exactly as it was.
const RELEASE = process.env.DEVICEHUB_RELEASE_URL || 'https://github.com/Dsmjr2/DeviceHub-download/releases/latest/download/';  // a test points it at a local copy
const mine = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8')); } catch { return null; } };
// A release is believed only when its publisher signed it (21 Oct 2026, security review): version.json carries an
// Ed25519 signature over its version, size and SHA-256 (helpers/sign-release.mjs, with a key that lives only on the
// publishing PC), checked here with the public key this copy carries. So someone who got into the GitHub account could
// not hand out an update: an unsigned or altered one is refused, and a merging copy merges only the signed version.
const PUBLIC_KEY = path.join(ROOT, 'helpers', 'release-public-key.pem');
const releasePayload = (v) => JSON.stringify([v.commit, v.builtAt, v.appCommit ?? null, v.size, v.sha256]);
async function releaseInfo() {
  const r = await fetch(RELEASE + 'version.json', { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`the download page answered ${r.status}`);
  const v = await r.json();
  if (fs.existsSync(PUBLIC_KEY)) {
    const crypto = require('crypto');
    let ok = false;
    try { ok = !!v.signature && crypto.verify(null, Buffer.from(releasePayload(v)), crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY)), Buffer.from(v.signature, 'base64')); } catch {}
    if (!ok) throw new Error('the update on the download page is not signed by DeviceHub\'s publisher, so it was not used');
  }
  return v;
}
// app files changed on this PC since it was installed (release-files.json: each file's SHA-256 then): an update
// would undo them, so it is not offered over them (21 Oct 2026)
// A file that matches any version DeviceHub ever shipped (release-history.json, helpers/release-history.mjs: every
// committed version, LF and CRLF) was not changed on this PC: an update that stopped halfway, or an older install, left
// it (23 Oct 2026, a friend's PC was held back by public/style.css that nobody had changed).
function changedFiles(root = ROOT) {
  let prints; try { prints = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8')); } catch { return []; }
  let shipped = {}; try { shipped = JSON.parse(fs.readFileSync(path.join(root, 'release-history.json'), 'utf8')) || {}; } catch {}
  const crypto = require('crypto');
  // helpers/bin is built output (the pre-built helper, rebuilt here if its sources change; helpers/native.js): an
  // update always replaces it, so it is never "changed on this PC" (22 Oct 2026, docs/handoff/prebuilt-helper.md)
  return Object.entries(prints).filter(([f]) => !f.startsWith('helpers/bin/')).filter(([f, h]) => {
    let now; try { now = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'); } catch { return true; }
    return now !== h && !(shipped[f] || []).includes(now.slice(0, 16));
  }).map(([f]) => f);
}
// No dead end for someone without Claude: Update anyway keeps a copy of each changed file first (backups\changed-before-
// update-<time>\), then installs the new version over it (23 Oct 2026)
const blockedText = (c) => `${c.length} of DeviceHub's files ${c.length === 1 ? 'was' : 'were'} changed on this PC (${c.slice(0, 4).join(', ')}${c.length > 4 ? ', …' : ''}). Update anyway keeps a copy of ${c.length === 1 ? 'it' : 'them'} in backups first.`;
function keepChanged(files, root = ROOT) {
  const dir = path.join(root, 'backups', `changed-before-update-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (const f of files) {
    const from = path.join(root, f);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(from, path.join(dir, f));
  }
  return dir;
}

async function zipStatus() {
  const own = mine();
  if (!own) return { git: false, zip: false };
  try {
    const rel = await releaseInfo();
    let failed = null; try { failed = fs.readFileSync(path.join(ROOT, 'update-failed.txt'), 'utf8').trim(); } catch {}
    const newer = rel.commit && rel.commit !== own.commit && rel.builtAt > own.builtAt && failed !== rel.commit;
    const blocked = newer ? changedFiles() : [];
    // version, versionAt: the signed version's id and date (the removed auto-update (24 Oct 2026) installs it by itself)
    return { git: false, zip: true, behind: newer ? 1 : 0, blocked: blocked.length ? blockedText(blocked) : undefined, blockedFiles: blocked.length ? blocked : undefined, latest: newer ? `a new version from ${new Date(rel.builtAt).toLocaleDateString()}` : null, at: own.builtAt, skipped: failed === rel.commit ? 'the newest version' : undefined, version: newer ? rel.commit : undefined, versionAt: newer ? rel.builtAt : undefined };
  } catch (e) { return { git: false, zip: true, error: e.message }; }
}
// How far an update has got (21 Oct 2026, for Settings' loading bar): the step in words and, while downloading, a
// percentage (null = a step whose length is not known). GET /api/self-update/progress.
let progress = null;
const step = (text, pct = null) => { progress = { text, pct, at: Date.now() }; };
const getProgress = () => progress;
// a program run without stopping DeviceHub meanwhile (spawnSync held the whole server, the loading bar too)
const runAsync = (cmd, args, opts) => new Promise((resolve) => execFile(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 << 20, ...opts }, (e, stdout, stderr) => resolve({ status: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout, stderr })));

async function zipUpdate({ overwrite = false, auto = false } = {}) {
  step('Checking for the new version');
  const own = mine(), rel = await releaseInfo();
  if (!own) throw new Error('this copy does not know its version');
  if (!(rel.commit !== own.commit && rel.builtAt > own.builtAt)) return { updated: false };
  const changed = changedFiles();
  if (changed.length && !overwrite) throw new Error(blockedText(changed));
  let kept = null;
  if (changed.length) { step('Keeping a copy of the changed files'); kept = keepChanged(changed); }
  const crypto = require('crypto'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-update-'));
  const zip = path.join(dir, 'DeviceHub-setup.zip');
  step('Downloading', 0);
  const r = await fetch(RELEASE + 'DeviceHub-setup.zip', { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!r.ok) throw new Error(`the download failed (${r.status})`);
  // read in pieces, so the bar moves as it arrives
  const parts = []; let got = 0;
  for await (const chunk of r.body) { parts.push(chunk); got += chunk.length; step('Downloading', Math.min(100, Math.round((got / rel.size) * 100))); }
  const buf = Buffer.concat(parts);
  step('Checking the download');
  if (buf.length !== rel.size) throw new Error(`the download is ${buf.length} bytes, not ${rel.size}; nothing was changed`);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== rel.sha256) throw new Error('the download does not match its checksum; nothing was changed');
  fs.writeFileSync(zip, buf);
  const ps = (cmd, ms) => runAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { timeout: ms });
  step('Unpacking');
  const x = await ps(`Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`, 5 * 60 * 1000);
  const src = path.join(dir, 'DeviceHub');
  if (x.status !== 0 || !fs.existsSync(path.join(src, 'helpers', 'install.ps1'))) throw new Error('the download could not be unpacked; nothing was changed');
  // the new version checks itself before it is installed
  step('Checking the new version');
  const check = path.join(src, 'tests', 'check.mjs');
  if (fs.existsSync(check)) {
    const c = await runAsync(process.execPath, [check], { cwd: src, timeout: 120000 });
    if (c.status !== 0) throw new Error('the new version did not pass its checks, so DeviceHub stayed on this one');
  }
  // its installer replaces this copy (it quits this DeviceHub first and starts the new one); run on its own, outside
  // this folder, with no new shortcuts. An update by itself (auto, the removed auto-update (24 Oct 2026)) passes -Background: with no
  // window open before, DeviceHub comes back in the tray only and no window opens.
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
  const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', q(path.join(src, 'helpers', 'install.ps1')), '-Target', q(ROOT), '-NoShortcuts', '-AppsKey', q(key), ...(kept ? ['-Overwrite'] : []), ...(auto ? ['-Background'] : []), ...(process.env.DEVICEHUB_TEST === '1' ? ['-NoLaunch'] : [])].join(' ');
  const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const launcher = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -WorkingDirectory ${sq(dir)} -RedirectStandardOutput ${sq(path.join(dir, 'install.log'))} -ArgumentList ${sq(inner)}`;
  const p = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { cwd: dir, stdio: 'ignore', windowsHide: true });
  p.on('error', () => {});
  step('Installing; DeviceHub restarts by itself');
  return { updated: true, installing: true, count: 1, latest: `version from ${new Date(rel.builtAt).toLocaleDateString()}`, ...(kept ? { kept: path.relative(ROOT, kept) } : {}) };
}

// The last answer, so Update right after Settings showed it does not ask GitHub again (23 Oct 2026, Shawn: "make the
// updates work faster"): an update used to fetch up to three times (Settings' check, Update's own check, then pull).
let last = { at: 0, value: null };
const FRESH_MS = 60000;
async function status() {
  const value = await statusNow();
  last = { at: Date.now(), value };
  return value;
}
async function statusNow() {
  try { if ((await git(['rev-parse', '--is-inside-work-tree'], 8000)) !== 'true') throw new Error(); } catch { return zipStatus(); }
  try {
    await git(['fetch', '--quiet', 'origin'], 30000);
    // a copy installed on someone's PC, tied to the public download repository: its updates merge (mergeUpdate), and
    // it follows the signed release, never whatever is newest on the branch (releaseInfo checks the signature)
    const shared = /DeviceHub-download/.test(await git(['remote', 'get-url', 'origin']).catch(() => ''));
    let target = '@{u}', behind;
    if (shared) {
      const signed = (await releaseInfo()).appCommit;
      if (!signed || !/^[0-9a-f]{7,40}$/.test(signed)) behind = 0;
      else {
        await git(['cat-file', '-e', `${signed}^{commit}`]).catch(() => git(['fetch', '--quiet', 'origin', signed], 30000));
        target = await git(['rev-parse', `${signed}^{commit}`]);
        behind = (await git(['merge-base', '--is-ancestor', target, 'HEAD']).then(() => true, () => false)) ? 0 : Number(await git(['rev-list', '--count', `HEAD..${target}`])) || 1;
      }
    } else behind = Number(await git(['rev-list', '--count', 'HEAD..@{u}'])) || 0;
    const changed = (await git(['status', '--porcelain', '--untracked-files=no'])).split('\n').filter(Boolean).length;
    const latest = behind ? await git(['log', '-1', '--format=%s', target]) : null;
    const at = await git(['log', '-1', '--format=%cI', 'HEAD']);
    // the newest version already crashed on start here once (helpers/keep-running.bat wrote update-failed.txt): not
    // offered again; a newer one (a fix) is
    let failed = null; try { failed = fs.readFileSync(path.join(ROOT, 'update-failed.txt'), 'utf8').trim(); } catch {}
    const versionAt = shared && behind ? await git(['log', '-1', '--format=%cI', target]) : undefined;
    const shownLatest = shared && behind ? `a new version from ${new Date(versionAt).toLocaleDateString()}${changed ? '; your changes are kept' : ''}` : latest;
    if (failed && behind && failed === (await git(['rev-parse', target]))) return { git: true, shared, behind: 0, changed, latest: null, at, skipped: shownLatest };
    // the files this PC changed since the published version it last took (committed or not): Update brings them
    // together with the new version; an update by itself never does (the removed auto-update (24 Oct 2026))
    let localFiles;
    if (shared && behind) {
      try {
        const base = await git(['merge-base', 'HEAD', target]);
        const names = async (args) => (await git(['diff', '--name-only', ...args])).split(/\r?\n/);
        localFiles = [...new Set([...(await names([base, 'HEAD'])), ...(await names(['HEAD']))].map((f) => f.trim()).filter(Boolean))];
      } catch { localFiles = changed ? ['(could not tell which)'] : []; }
    }
    return { git: true, shared, behind, changed, latest: shownLatest, at, target, ...(shared && behind ? { version: target, versionAt, localFiles } : {}) };
  } catch (e) { return { git: true, error: e.message }; }
}

// pulls the new changes; the caller restarts DeviceHub afterwards
async function update(opts = {}) {
  step('Looking for the new version');
  try { return await updateSteps(opts); } catch (e) { progress = null; throw e; }
}
async function updateSteps(opts = {}) {
  // the status Settings just showed (under a minute old, nothing failed) is used as it is; else asked again
  const recent = last.value && !last.value.error && Date.now() - last.at < FRESH_MS;
  const s = recent ? last.value : await status();
  last = { at: 0, value: null };   // an update is never planned from the same answer twice
  if (s.zip) return zipUpdate(opts);
  if (!s.git) throw new Error('this copy of DeviceHub is not connected to GitHub');
  if (s.error) throw new Error(s.error);
  if (s.shared) return mergeUpdate(s);
  if (s.changed) throw new Error(`${s.changed} file(s) were changed on this PC; not updating over them`);
  if (!s.behind) return { updated: false };
  const old = await git(['rev-parse', 'HEAD']);
  step('Getting the new changes');
  // fetched moments ago (status): moved forward from what is already here; else fetched now
  if (recent) await git(['merge', '--ff-only', '--quiet', '@{u}'], 60000);
  else await git(['pull', '--ff-only', '--quiet'], 60000);
  // check the new code before running it
  const check = path.join(ROOT, 'tests', 'check.mjs');
  if (fs.existsSync(check)) {
    step('Checking the new version');
    const r = await runAsync(process.execPath, [check], { cwd: ROOT, timeout: 120000 });
    if (r.status !== 0) {
      await git(['reset', '--quiet', '--hard', old]);
      const why = `${r.stdout || ''}${r.stderr || ''}`.split('\n').find((l) => l.startsWith('- ')) || 'its checks failed';
      throw new Error(`the new version did not pass its checks, so DeviceHub stayed on this one (${why.replace(/^- /, '').slice(0, 160)})`);
    }
  }
  writeAtomic(path.join(ROOT, 'update-rollback.txt'), old);
  step('Restarting DeviceHub');
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
  step('Keeping the changes made on this PC');
  if (s.changed) await git([...ME, 'commit', '-q', '-a', '-m', 'Changes made on this PC']);
  const before = await git(['rev-parse', 'HEAD']);
  step('Bringing them together with the new version');
  // exactly the signed version (status), never the branch tip
  if (!s.target || s.target === '@{u}') throw new Error('the new version is not signed by DeviceHub\'s publisher; nothing was changed');
  try { await git([...ME, 'merge', '--no-edit', '-q', s.target], 60000); }
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
    step('Checking the new version');
    const r = await runAsync(process.execPath, [check], { cwd: ROOT, timeout: 120000 });
    if (r.status !== 0) { await git(['reset', '-q', '--hard', before]); throw new Error("the new version, with this PC's changes, did not pass its checks, so DeviceHub stayed as it was"); }
  }
  writeAtomic(path.join(ROOT, 'update-rollback.txt'), before);
  step('Restarting DeviceHub');
  return { updated: true, count: s.behind, latest: s.latest };
}

// called once the new version has run well for a minute: it is kept
function confirm(log) {
  const f = path.join(ROOT, 'update-rollback.txt');
  if (!fs.existsSync(f)) return;
  setTimeout(() => { try { fs.unlinkSync(f); log && log({ kind: 'good', text: 'DeviceHub update running well' }); } catch {} }, 60000);
}

// this copy's version now: the git commit, else the release it was installed from (the removed auto-update (24 Oct 2026) compares it
// before and after an update by itself)
function currentVersion() {
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    try { return require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
  }
  return mine()?.commit || null;
}

module.exports = { status, update, confirm, getProgress, releaseInfo, currentVersion, _test: { changedFiles, keepChanged, blockedText } };
