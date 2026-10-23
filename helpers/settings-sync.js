// Settings sync between Shawn's PCs (19 Oct 2026: the laptop the same as the PC, without doing anything). DeviceHub's
// own settings, the ones that live on the PC and not in the devices: the EQ presets and the one in use, the sound tools
// (HS80 correction, mic tools, monitor / camera EQ), DeviceHub's options and the profiles. They are kept in a second
// private GitHub repository (the code's repository name + "-settings"), one file, settings.json.
// One way (19 Oct 2026, Shawn: his PC decides, the laptop follows): the MAIN PC only sends its settings, every other PC
// only receives them. Which one is main is kept in this PC's own settings-sync-state.json (role: 'main'), which never
// syncs; a PC without it follows. Every 2 minutes (6 on battery with the battery saver) and on demand: the main PC
// sends a change made on it; a following PC loads a newer copy (each part through its normal path, backed up first),
// and a change made on it stays there until the main PC next sends. Monitor and camera EQ are keyed by the device
// itself, so another PC's monitors never land on this one.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const power = require('./power');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'settings-sync');            // the local copy of the settings repository (not in git)
const STATE = path.join(ROOT, 'settings-sync-state.json');
const SETTINGS = path.join(ROOT, 'settings.json'), PROFILES = path.join(ROOT, 'profiles.json');
const OPTIONS = ['autoSwitch', 'defaultProfile', 'hotkeys', 'artStyle', 'ankerGuard', 'batterySaver'];

const git = (args, cwd = DIR, timeout = 45000) => new Promise((resolve, reject) => {
  // never a sign-in window or prompt: cached credentials still work, anything else fails quietly (no pop-ups)
  execFile('git', args, { cwd, windowsHide: true, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }, (e, out, err) => (e ? reject(new Error((err || e.message).trim().split('\n').pop())) : resolve(out.trim())));
});
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

let eqapo = null, log = () => {}, timer = null, busy = false;
// known from the start (23 Oct 2026, a friend's PC showed "Follows your main PC ... Checked not yet"): a copy without git,
// or one tied to the public download repository, has no settings repository, so Settings does not show the row at all
const ownRepo = () => { try { const c = fs.readFileSync(path.join(ROOT, '.git', 'config'), 'utf8'); return /url\s*=/.test(c) && !/DeviceHub-download/i.test(c); } catch { return false; } };
let status = { enabled: true, role: 'follow', last: null, lastSent: null, lastLoaded: null, error: null, ...(ownRepo() ? {} : { enabled: false, notSetUp: true }) };

async function repoUrl() {
  const origin = await git(['remote', 'get-url', 'origin'], ROOT, 10000);
  return origin.replace(/(\.git)?\/?$/, '') + '-settings.git';
}

// what this PC has now
async function current() {
  const settings = readJson(SETTINGS, {});
  return {
    eq: eqapo && eqapo.installed() ? await eqapo.exportState() : null,
    options: Object.fromEntries(OPTIONS.filter((k) => k in settings).map((k) => [k, settings[k]])),
    profiles: readJson(PROFILES, []),
  };
}

// a copy from GitHub, put in place part by part (only what differs)
async function apply(remote, local) {
  const changed = [];
  if (remote.eq && eqapo && eqapo.installed() && hash(remote.eq) !== hash(local.eq)) { await eqapo.importState(remote.eq); changed.push('sound'); }
  if (remote.options && hash(remote.options) !== hash(local.options)) {
    const cur = readJson(SETTINGS, {});
    if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, path.join(ROOT, 'backups', `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    for (const k of OPTIONS) if (k in remote.options) cur[k] = remote.options[k];
    writeAtomic(SETTINGS, JSON.stringify(cur, null, 2)); changed.push('options');
  }
  if (Array.isArray(remote.profiles) && hash(remote.profiles) !== hash(local.profiles)) {
    if (fs.existsSync(PROFILES)) fs.copyFileSync(PROFILES, path.join(ROOT, 'backups', `profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    writeAtomic(PROFILES, JSON.stringify(remote.profiles, null, 2)); changed.push('profiles');
  }
  return changed;
}

async function sync() {
  if (busy) return status; busy = true;
  try {
    const st = readJson(STATE, {});
    if (readJson(SETTINGS, {}).settingsSync === false) { status = { ...status, enabled: false }; return status; }
    // a copy from the installer zip (no git, or no GitHub remote) has nowhere to sync to: not set up, not an error
    let origin = null;
    try { origin = await git(['remote', 'get-url', 'origin'], ROOT, 10000); } catch {}
    // a copy installed from the public download repository has no settings repository of its own: not set up
    if (!origin || /\/DeviceHub-download(\.git)?\/?$/i.test(origin.trim())) { status = { ...status, enabled: false, notSetUp: true, error: null }; return status; }
    status.enabled = true; status.notSetUp = false;
    const main = st.role === 'main';
    status.role = main ? 'main' : 'follow';
    if (!fs.existsSync(path.join(DIR, '.git'))) await git(['clone', '--quiet', await repoUrl(), DIR], ROOT, 60000);
    await git(['fetch', '--quiet', 'origin']);
    let head = null; try { head = await git(['rev-parse', 'origin/main']); } catch {}
    // 1. following PC: a newer copy on GitHub (sent by the main PC): load it. The main PC never loads one.
    if (!main && head && head !== st.lastRemote) {
      const remote = JSON.parse(await git(['show', 'origin/main:settings.json']));
      const changed = await apply(remote, await current());
      st.lastRemote = head; st.lastLocal = hash(await current());
      if (changed.length) { status.lastLoaded = { at: new Date().toISOString(), from: remote.from, parts: changed }; log({ kind: 'good', text: `Settings from ${remote.from || 'the other PC'} loaded (${changed.join(', ')})` }); }
      if (remote.from) status.mainName = remote.from;
    }
    // 2. main PC: a change made here: send it. A following PC never sends.
    const now = await current();
    if (main && hash(now) !== st.lastLocal) {
      if (head) await git(['reset', '--quiet', '--hard', 'origin/main']); else await git(['checkout', '--quiet', '-B', 'main']).catch(() => {});
      writeAtomic(path.join(DIR, 'settings.json'), JSON.stringify({ ...now, from: os.hostname(), at: new Date().toISOString() }, null, 1));
      await git(['add', 'settings.json']);
      await git(['commit', '--quiet', '-m', `Settings from ${os.hostname()}`]);
      await git(['push', '--quiet', 'origin', 'HEAD:main']);
      st.lastRemote = await git(['rev-parse', 'HEAD']); st.lastLocal = hash(now);
      status.lastSent = new Date().toISOString();
    }
    writeAtomic(STATE, JSON.stringify(st));
    status.last = new Date().toISOString(); status.error = null;
  } catch (e) { status.error = e.message; } finally { busy = false; }
  return status;
}

module.exports = {
  start(eq, logFn) {
    eqapo = eq; log = logFn;
    const loop = () => { timer = setTimeout(() => sync().finally(loop), power.every(120000)); };
    setTimeout(() => sync().finally(loop), 20000);
  },
  sync,
  status: () => status,
  // make this PC the main one (it sends, never receives), or a following one
  setRole(role) { const st = readJson(STATE, {}); st.role = role === 'main' ? 'main' : 'follow'; if (st.role === 'main') st.lastLocal = null; writeAtomic(STATE, JSON.stringify(st)); status.role = st.role; return sync(); },
};
