// Instant replay while gaming (2 Nov 2026, Shawn: "obs sounds much better" than NVIDIA's or Windows' own). OBS Studio's
// replay buffer, run by DeviceHub only while a game runs: OBS is started hidden in the tray when a game starts, the
// person presses Alt+F10 (OBS's own hotkey, set in the profile below) to keep the last N seconds, and OBS is closed
// again when the game has been gone for a while, so it uses no memory the rest of the time.
//   data\replay.json   { on, seconds }   (off until the person turns it on on the PC page)
// Setup (on the person's switch, OBS closed): obs-websocket's server turned on (its own password kept) and a profile
// "DeviceHub replay" made from the person's current OBS profile with only the replay settings changed (the replay
// buffer on, its length and memory cap, the clips folder Videos\DeviceHub replays, Alt+F10). Every OBS file is backed up
// to backups\obs-<time>\ first; the person's own profiles and scenes are never changed. A scene collection "DeviceHub
// replay" with one Game Capture source (any full-screen game) is made through obs-websocket on the first start.
// An OBS the person opened themselves is never closed: its replay buffer is started only if its profile has one, and
// stopped only if DeviceHub started it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from './obs-ws.mjs';

export const PROFILE = 'DeviceHub replay';
export const COLLECTION = 'DeviceHub replay';
export const SOURCE = 'DeviceHub game';
// 4 Nov 2026, Shawn: longer lengths. OBS keeps the whole buffer in memory, so a length is offered only when its memory
// cap (replayMB) fits half of this PC's memory at the chosen quality, frame rate and size; up to 1 min always fits
export const LENGTHS = [15, 30, 45, 60, 120, 180, 300, 600, 900, 1200];
// 3 Nov 2026, Shawn: "Make it able to change hotkeys for the record or turn off hotkeys completely. also add any other
// useful settings": the hotkey (or none), quality, frame rate, clip size, the mic in clips, and games only or always
export const QUALITIES = { standard: 'Small', high: 'HQ' };          // OBS's simple-output recording quality
export const FPS = [30, 60];
export const SIZES = ['screen', '1080', '720'];
export const WHEN = ['games', 'always'];
// 3 Nov 2026 (hardening): games: programs DeviceHub should treat as games ({ exe, name }); maxGB: the clips folder's cap,
// the oldest clips going to the Recycle Bin past it (0 = no limit)
export const CAPS = [0, 5, 10, 20, 50];
export const DEFAULTS = { on: false, seconds: 30, hotkey: { alt: true, key: 'OBS_KEY_F10' }, quality: 'standard', fps: 60, size: 'screen', mic: true, when: 'games', games: [], maxGB: 20 };
const CLIP = /^Replay .*\.(mp4|mkv|mov|flv)$/i;   // only the clips OBS made with DeviceHub's prefix are ever cleaned up
const CHECK_EVERY = 3;                       // while recording: is OBS still there, every 3rd check (15 s)
const BUFFER_EVERY = 6;                      // and its replay buffer still running, every 6th (30 s)
const CLEAN_MS = 10 * 60 * 1000;             // the folder cap looked at every 10 minutes while it is on

// Other programs that use the same keys (3 Nov 2026): shown on the card when that program is running
export const KNOWN_KEYS = [
  { keys: 'Alt+F10', app: /^nvidia overlay\.exe$/i, who: "NVIDIA's own Instant Replay (Save the last moments)" },
  { keys: 'Alt+F9', app: /^nvidia overlay\.exe$/i, who: "NVIDIA's Record" },
  { keys: 'Alt+F1', app: /^nvidia overlay\.exe$/i, who: "NVIDIA's Screenshot" },
  { keys: 'Alt+Z', app: /^nvidia overlay\.exe$/i, who: "NVIDIA's overlay" },
  { keys: 'Ctrl+Shift+S', app: /^radeonsoftware\.exe$/i, who: "AMD's Instant Replay (Save)" },
  { keys: 'Ctrl+Shift+E', app: /^radeonsoftware\.exe$/i, who: "AMD's Record" },
  { keys: 'F12', app: /^steam\.exe$/i, who: "Steam's Screenshot" },
];
// a hotkey's Windows virtual-key code and modifiers, to ask Windows whether another program holds it (RegisterHotKey)
export function hotkeyVk(k) {
  if (!k) return null;
  const n = k.key.replace(/^OBS_KEY_/, '');
  let vk = null, m;
  if (/^[A-Z0-9]$/.test(n)) vk = n.charCodeAt(0);
  else if ((m = /^F(\d+)$/.exec(n))) vk = 0x6f + Number(m[1]);
  else if ((m = /^NUM(\d)$/.exec(n))) vk = 0x60 + Number(m[1]);
  else vk = { INSERT: 0x2d, HOME: 0x24, END: 0x23, PAGEUP: 0x21, PAGEDOWN: 0x22, PAUSE: 0x13, SCROLLLOCK: 0x91 }[n] ?? null;
  return vk == null ? null : { vk, mods: (k.alt ? 1 : 0) | (k.control ? 2 : 0) | (k.shift ? 4 : 0) };
}
// the keys a hotkey may use (OBS's own names); a letter or a digit needs Ctrl or Alt, so typing in a game never saves
const KEYS = new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((c) => `OBS_KEY_${c}`)
  .concat(Array.from({ length: 24 }, (_, i) => `OBS_KEY_F${i + 1}`), Array.from({ length: 10 }, (_, i) => `OBS_KEY_NUM${i}`),
    ['INSERT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'PAUSE', 'SCROLLLOCK'].map((k) => `OBS_KEY_${k}`)));
export function cleanHotkey(k) {
  if (k === null) return null;
  if (!k || typeof k !== 'object' || !KEYS.has(k.key)) throw Object.assign(new Error('That key cannot be a hotkey: use F1-F24, or Ctrl or Alt with a letter or digit.'), { code: 400 });
  const out = { ...(k.control ? { control: true } : {}), ...(k.alt ? { alt: true } : {}), ...(k.shift ? { shift: true } : {}), key: k.key };
  if (/^OBS_KEY_[A-Z0-9]$/.test(k.key) && !out.control && !out.alt) throw Object.assign(new Error('A letter or digit needs Ctrl or Alt with it, so typing in a game does not save a clip.'), { code: 400 });
  return out;
}
const KEY_NAMES = { PAGEUP: 'Page Up', PAGEDOWN: 'Page Down', SCROLLLOCK: 'Scroll Lock', INSERT: 'Insert', HOME: 'Home', END: 'End', PAUSE: 'Pause' };
export const hotkeyLabel = (k) => {
  if (!k) return 'Off';
  const name = k.key.replace(/^OBS_KEY_/, '');
  return [k.control && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', KEY_NAMES[name] || name.replace(/^NUM(\d)$/, 'Num $1')].filter(Boolean).join('+');
};
const PF = process.env.ProgramFiles || 'C:\\Program Files';
export const OBS_BIN = path.join(PF, 'obs-studio', 'bin', '64bit');
export const OBS_EXE = path.join(OBS_BIN, 'obs64.exe');
const CFG = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'obs-studio');
export const clipsFolder = () => path.join(os.homedir(), 'Videos', 'DeviceHub replays');
const GONE_MS = 20000;   // the game gone this long: OBS is stopped (a game restarting itself is not a quit)

// ---------------------------------------------------------------- OBS's ini files (kept as they are, BOM included)
export function parseIni(text) {
  const bom = text.startsWith('\uFEFF');
  const out = []; let cur = null;
  for (const line of (bom ? text.slice(1) : text).split(/\r?\n/)) {
    const s = /^\[(.+)\]\s*$/.exec(line);
    if (s) { cur = { name: s[1], keys: [] }; out.push(cur); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && cur) cur.keys.push([kv[1], kv[2]]);
  }
  return { bom, sections: out };
}
export function setIni(ini, section, key, value) {
  let s = ini.sections.find((x) => x.name === section);
  if (!s) { s = { name: section, keys: [] }; ini.sections.push(s); }
  const k = s.keys.find(([n]) => n === key);
  if (k) k[1] = String(value); else s.keys.push([key, String(value)]);
}
export const getIni = (ini, section, key) => ini.sections.find((x) => x.name === section)?.keys.find(([n]) => n === key)?.[1];
export const iniText = (ini) => (ini.bom ? '\uFEFF' : '') + ini.sections.map((s) => [`[${s.name}]`, ...s.keys.map(([k, v]) => `${k}=${v}`)].join('\r\n')).join('\r\n\r\n') + '\r\n';
// OBS writes paths with doubled backslashes in its ini files
const iniPath = (p) => p.replace(/\\/g, '\\\\');

// The replay buffer's memory cap in MB (RecRBSize): OBS drops the oldest seconds past it, so it is sized for a busy game
// at the top of what OBS's simple output writes: 8 MB a second at 1080p 60 fps (64 Mbps; High quality 16), scaled by
// the clip's pixels and frame rate. Most games use about half of it.
const MB_PER_S = { standard: 8, high: 16 };
export function clipSize(base, size) {
  const w = base?.w || 1920, hh = base?.h || 1080;
  const lines = size === 'screen' ? hh : Math.min(hh, Number(size));
  return { w: Math.round((w * lines) / hh / 2) * 2, h: lines };
}
export function replayMB({ seconds, quality = 'standard', fps = 60, size = 'screen' }, base) {
  const c = clipSize(base, size);
  return Math.max(256, Math.ceil((seconds * (MB_PER_S[quality] || MB_PER_S.standard) * c.w * c.h * fps) / (1920 * 1080 * 60)));
}
export const memoryBudgetMB = (ramBytes) => Math.floor((ramBytes || 0) / 2 ** 20 / 2);
// the lengths that fit: up to 1 min always; longer ones when their cap is within half of the PC's memory
export const lengthsFor = (opts, base, ramBytes) => LENGTHS.filter((s) => s <= 60 || replayMB({ ...opts, seconds: s }, base) <= memoryBudgetMB(ramBytes));

// The replay settings on top of the person's own profile: only these keys differ from it
export function replayProfile(baseText, { seconds, folder, hotkey = DEFAULTS.hotkey, quality = 'standard', fps = 60, size = 'screen' }) {
  const ini = parseIni(baseText || '\uFEFF[General]\r\n');
  setIni(ini, 'General', 'Name', PROFILE);
  setIni(ini, 'Output', 'Mode', 'Simple');
  setIni(ini, 'SimpleOutput', 'FilePath', iniPath(folder));
  setIni(ini, 'SimpleOutput', 'RecRB', 'true');
  setIni(ini, 'SimpleOutput', 'RecRBTime', seconds);
  setIni(ini, 'SimpleOutput', 'RecQuality', QUALITIES[quality] || 'Small');
  const bw = Number(getIni(ini, 'Video', 'BaseCX')) || 0, bh = Number(getIni(ini, 'Video', 'BaseCY')) || 0;
  // MB of memory at most (no 2 GB ceiling any more: a 10 minute clip needs more)
  setIni(ini, 'SimpleOutput', 'RecRBSize', replayMB({ seconds, quality, fps, size }, bw && bh ? { w: bw, h: bh } : null));
  setIni(ini, 'Video', 'FPSType', '0');
  setIni(ini, 'Video', 'FPSCommon', String(fps));
  // the clip's size: the screen's own, or scaled down to 1080 or 720 lines keeping its shape (never up)
  if (bw && bh) {
    const c = clipSize({ w: bw, h: bh }, size);
    setIni(ini, 'Video', 'OutputCY', c.h);
    setIni(ini, 'Video', 'OutputCX', c.w);
  }
  setIni(ini, 'SimpleOutput', 'RecRBPrefix', 'Replay');
  // Alt+F10 keeps the last N seconds, the same keys NVIDIA uses (OBS's own hotkey, so it works inside the game)
  // (OBS 33 keeps it as OBSBasic.SaveReplayBuffer = { bindings: [...] }, read from the file OBS itself writes)
  setIni(ini, 'Hotkeys', 'OBSBasic.SaveReplayBuffer', JSON.stringify({ bindings: hotkey ? [hotkey] : [] }));
  return iniText(ini);
}

// ---------------------------------------------------------------- the parts that touch Windows (tests pass stand-ins)
export const realOs = {
  installed: () => fs.existsSync(OBS_EXE),
  read: (f) => fs.readFileSync(f, 'utf8'),
  exists: (f) => fs.existsSync(f),
  write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
  copy: (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); },
  mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
  // the running obs64.exe processes: [pid]
  obsPids: () => new Promise((resolve) => execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => {
    resolve(String(out || '').split(/\r?\n/).map((l) => /^"obs64\.exe","(\d+)"/i.exec(l)?.[1]).filter(Boolean).map(Number));
  })),
  start: (args) => { const p = spawn(OBS_EXE, args, { cwd: OBS_BIN, detached: true, stdio: 'ignore', windowsHide: false }); p.unref(); return p.pid; },
  // a polite close (the window's close, as its X), then, only if it is still there after the wait, the end
  close: (pid, force = false) => new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), ...(force ? ['/F'] : [])], { windowsHide: true }, () => resolve())),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  connect: (opts) => connect(opts),
  // OBS's run markers (.sentinel\run_*), cleared only right before DeviceHub starts OBS with none running
  clearCrashMarks: (cfg) => { const d = path.join(cfg, '.sentinel'); try { for (const f of fs.readdirSync(d)) if (/^run_[0-9a-f-]{36}$/i.test(f)) fs.rmSync(path.join(d, f), { force: true }); } catch {} },
  // the clips folder: [{ name, size, at }]
  listClips: (dir) => { try { return fs.readdirSync(dir).map((name) => { const s = fs.statSync(path.join(dir, name)); return { name, size: s.size, at: s.mtimeMs }; }); } catch { return []; } },
  // to the Recycle Bin (not deleted: the person can still get a clip back)
  recycle: (files) => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command',
    'Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($f in $input) { if ($f) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f, "OnlyErrorDialogs", "SendToRecycleBin") } }'],
  { windowsHide: true, timeout: 60000 }, (e) => resolve(!e)).stdin.end(files.join('\n'))),
  programs: () => new Promise((resolve) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (e, out) => resolve(String(out || '').split(/\r?\n/).map((l) => /^"([^"]+)"/.exec(l)?.[1]).filter(Boolean)))),
  // 'taken' when another program holds these keys through Windows (RegisterHotKey), 'free', or 'unknown'
  probeHotkey: (k) => new Promise((resolve) => {
    const v = hotkeyVk(k);
    if (!v) { resolve('unknown'); return; }
    const ps = `Add-Type -Namespace DhHk -Name K -MemberDefinition '[DllImport("user32.dll", SetLastError=true)] public static extern bool RegisterHotKey(IntPtr h, int id, uint m, uint vk); [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);'; if ([DhHk.K]::RegisterHotKey([IntPtr]::Zero, 7311, ${v.mods | 0x4000}, ${v.vk})) { [void][DhHk.K]::UnregisterHotKey([IntPtr]::Zero, 7311); 'free' } elseif ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1409) { 'taken' } else { 'unknown' }`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(/^(free|taken)$/m.exec(String(out || ''))?.[1] || 'unknown'));
  }),
};

export function createReplay({ root, sys = realOs, cfg = CFG, settings, saveSettings, log = () => {}, now = () => Date.now(), folder = clipsFolder, ram = () => os.totalmem() }) {
  const wsFile = path.join(cfg, 'plugin_config', 'obs-websocket', 'config.json');
  const profileDir = path.join(cfg, 'basic', 'profiles', PROFILE.replace(/ /g, '_'));
  const st = { phase: 'idle', game: null, ours: null, startedBuffer: false, lastClip: null, error: null, goneSince: null, busy: false, ticks: 0, closes: [], gaveUp: false, cleanedAt: 0, keys: null };
  const wsConf = () => { try { return JSON.parse(sys.read(wsFile)); } catch { return null; } };
  const ws = async () => { const c = wsConf(); if (!c?.server_enabled) throw new Error('OBS remote control is off: turn instant replay off and on again with OBS closed'); return sys.connect({ port: c.server_port || 4455, password: c.auth_required ? c.server_password || '' : '' }); };

  // the person's current profile folder (user.ini [Basic] ProfileDir; global.ini before OBS 31)
  function baseProfile() {
    for (const f of ['user.ini', 'global.ini']) {
      try { const dir = getIni(parseIni(sys.read(path.join(cfg, f))), 'Basic', 'ProfileDir'); if (dir && dir !== PROFILE.replace(/ /g, '_')) return path.join(cfg, 'basic', 'profiles', dir, 'basic.ini'); } catch {}
    }
    return path.join(cfg, 'basic', 'profiles', 'Untitled', 'basic.ini');
  }

  // the screen OBS records (the person's profile's base size), for each length's memory cap
  function screen() {
    try { const ini = parseIni(sys.read(baseProfile())); const w = Number(getIni(ini, 'Video', 'BaseCX')), hh = Number(getIni(ini, 'Video', 'BaseCY')); return w && hh ? { w, h: hh } : null; } catch { return null; }
  }

  // turn it on: OBS must be closed (it rewrites its files when it quits)
  async function setup(opts = settings()) {
    if (!sys.installed()) throw Object.assign(new Error('OBS Studio is not installed: install it from Settings > Optional tools.'), { code: 409 });
    if ((await sys.obsPids()).length) throw Object.assign(new Error('Close OBS Studio first, then turn instant replay on.'), { code: 409 });
    const c = wsConf();
    if (!c) throw Object.assign(new Error('Open OBS Studio once and close it again, so it makes its settings; then turn this on.'), { code: 409 });
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const bak = path.join(root, 'backups', `obs-${stamp}`);
    sys.copy(wsFile, path.join(bak, 'obs-websocket-config.json'));
    const base = baseProfile();
    if (sys.exists(path.join(profileDir, 'basic.ini'))) sys.copy(path.join(profileDir, 'basic.ini'), path.join(bak, 'replay-profile-basic.ini'));
    if (!c.server_enabled || !c.auth_required || !c.server_password) {
      const pw = c.server_password || randomBytes(12).toString('hex');
      sys.write(wsFile, JSON.stringify({ ...c, server_enabled: true, auth_required: true, server_password: pw, first_load: false }, null, 4));
    }
    sys.mkdir(clipsFolder());
    sys.write(path.join(profileDir, 'basic.ini'), replayProfile(sys.exists(base) ? sys.read(base) : '', { ...DEFAULTS, ...opts, folder: clipsFolder() }));
    log(`Instant replay set up in OBS (backup: backups\\obs-${stamp})`, 'good');
  }

  // a game started: OBS hidden with the replay buffer running. If the OBS DeviceHub started does not get there, it is
  // closed again, so it is never left running (and later taken for one the person opened)
  async function start(game) {
    try { return await startOnce(game); } catch (e) {
      if (st.ours) { try { await sys.close(st.ours, true); } catch {} st.ours = null; }
      throw e;
    }
  }
  async function startOnce(game) {
    const pids = await sys.obsPids();
    let api;
    if (pids.length) {
      st.ours = null;
      api = await ws();
    } else {
      // the scene collection exists after the first start; before that OBS opens its last one and it is made below
      const known = sys.exists(path.join(cfg, 'basic', 'scenes', `${COLLECTION.replace(/ /g, '_')}.json`));
      // after OBS was closed hard (a crash, or ended by Task Manager), OBS 33 stops at "OBS Studio Crash Detected: Run in
      // Safe Mode?" and waits for a click, with its remote control off (3 Nov 2026; the --disable-shutdown-check flag is
      // gone in OBS 33). It knows from the run markers it leaves in .sentinel\: with no OBS running, they are old ones
      sys.clearCrashMarks?.(cfg);
      st.ours = sys.start(['--profile', PROFILE, ...(known ? ['--collection', COLLECTION] : []), '--minimize-to-tray', '--disable-missing-files-check', '--disable-updater']);
      for (let i = 0; i < 40 && !api; i++) { await sys.sleep(500); try { api = await ws(); } catch {} }
      if (!api) throw new Error('OBS did not start its remote control within 20 s');
      // OBS answers "not ready" (207) while it is still loading its scenes: asked again until it is
      let list = null;
      for (let i = 0; i < 40 && !list; i++) { try { list = await api.call('GetSceneCollectionList'); } catch (e) { if (e.code !== 207) throw e; await sys.sleep(500); } }
      if (!list) throw new Error('OBS did not finish loading within 20 s');
      if (list.currentSceneCollectionName !== COLLECTION) {
        if ((list.sceneCollections || []).includes(COLLECTION)) await api.call('SetCurrentSceneCollection', { sceneCollectionName: COLLECTION });
        else await api.call('CreateSceneCollection', { sceneCollectionName: COLLECTION });
        await sys.sleep(1500);
      }
      const inputs = (await api.call('GetInputList')).inputs || [];
      if (!inputs.some((x) => x.inputName === SOURCE)) {
        const scene = (await api.call('GetCurrentProgramScene')).currentProgramSceneName || (await api.call('GetCurrentProgramScene')).sceneName;
        await api.call('CreateInput', { sceneName: scene, inputName: SOURCE, inputKind: 'game_capture', inputSettings: { capture_mode: 'any_fullscreen' }, sceneItemEnabled: true });
      }
    }
    try {
      // your mic in clips or not: the microphones of DeviceHub's own scene collection, muted or not (never the person's OBS)
      if (st.ours) await applyMic(api);
      const rb = await api.call('GetReplayBufferStatus');
      st.startedBuffer = false;
      if (!rb.outputActive) { await api.call('StartReplayBuffer'); st.startedBuffer = true; }
    } catch (e) {
      if (!st.ours) throw new Error(`OBS is open with a profile that has no replay buffer: close OBS, DeviceHub starts it the right way (${e.message})`);
      throw e;
    } finally { api.close(); }
    st.phase = 'recording'; st.game = game; st.error = null;
    const hk = { ...DEFAULTS, ...settings() }.hotkey;
    log(`Instant replay on for ${game}${hk ? `: ${hotkeyLabel(hk)} keeps the last ${settings().seconds} s` : ''}`, 'good');
  }
  async function applyMic(api) {
    const mics = ((await api.call('GetInputList', { inputKind: 'wasapi_input_capture' })).inputs || []);
    for (const m of mics) await api.call('SetInputMute', { inputName: m.inputName, inputMuted: settings().mic === false });
  }

  // keep the last N seconds now (Alt+F10 does the same inside OBS); { file } once OBS has written it
  async function save() {
    if (st.phase !== 'recording') throw Object.assign(new Error('Instant replay runs only while a game does.'), { code: 409 });
    const api = await ws();
    try {
      const saved = new Promise((resolve) => { const off = api.on('ReplayBufferSaved', (d) => { off(); resolve(d.savedReplayPath); }); setTimeout(() => resolve(null), 15000); });
      await api.call('SaveReplayBuffer');
      const file = (await saved) || (await api.call('GetLastReplayBufferReplay').catch(() => ({}))).savedReplayPath || null;
      if (file) { st.lastClip = { file, at: new Date(now()).toISOString() }; log(`Replay saved: ${path.basename(file)}`, 'good'); }
      cleanup().catch(() => {});
      return { file };
    } finally { api.close(); }
  }

  // the game is gone: the buffer stopped (if DeviceHub started it) and OBS closed (if DeviceHub started it)
  async function stop(why = 'the game ended') {
    const was = st.game;
    try {
      if (st.startedBuffer) { const api = await ws(); try { await api.call('StopReplayBuffer'); } finally { api.close(); } }
    } catch {}
    if (st.ours) {
      for (const pid of await sys.obsPids()) await sys.close(pid);
      for (let i = 0; i < 20 && (await sys.obsPids()).length; i++) await sys.sleep(500);
      for (const pid of await sys.obsPids()) await sys.close(pid, true);
    }
    Object.assign(st, { phase: 'idle', game: null, ours: null, startedBuffer: false, goneSince: null });
    if (was) log(`Instant replay off: ${why}`, 'info');
  }

  // every few seconds: games is the running game's name or null
  async function tick(game) {
    if (st.busy) return;
    st.busy = true;
    try {
      if (!settings().on || !sys.installed()) { if (st.phase === 'recording') await stop('instant replay was turned off'); return; }
      // "always": the buffer runs whenever DeviceHub does, a game or not
      if (!game && settings().when === 'always') game = 'your PC';
      if (!game) st.gaveUp = false;   // a new game gets a fresh try
      if (now() - st.cleanedAt >= CLEAN_MS) await cleanup();
      if (game && st.phase !== 'recording') {
        if (st.gaveUp) return;
        try { await start(game); } catch (e) { st.error = e.message; st.phase = 'idle'; log(`Instant replay could not start: ${e.message}`, 'bad'); }
        return;
      }
      if (st.phase === 'recording') {
        st.ticks++;
        // OBS gone mid-game (closed by hand, or crashed): started again on the next check, at most 3 times in 10 minutes
        if (st.ticks % CHECK_EVERY === 0 && !(await sys.obsPids()).length) {
          st.closes = [...st.closes.filter((t) => now() - t < 600000), now()];
          const g = st.game;
          Object.assign(st, { phase: 'idle', ours: null, startedBuffer: false, goneSince: null });
          if (st.closes.length > 3) { st.gaveUp = true; st.error = 'OBS closed 4 times in 10 minutes, so it is not started again until the next game.'; log(`Instant replay stopped: ${st.error}`, 'bad'); }
          else log(`OBS closed while recording ${g}: starting it again`, 'bad');
          return;
        }
        // its replay buffer stopped in OBS's own window: started again (only in the OBS DeviceHub runs)
        if (st.ours && st.ticks % BUFFER_EVERY === 0) {
          try { const api = await ws(); try { if (!(await api.call('GetReplayBufferStatus')).outputActive) { await api.call('StartReplayBuffer'); log('The replay buffer had stopped in OBS: started again', 'info'); } } finally { api.close(); } } catch {}
        }
      }
      if (game) { st.goneSince = null; return; }
      if (st.phase === 'recording') { st.goneSince ??= now(); if (now() - st.goneSince >= GONE_MS) { await stop(); await cleanup(); } }
    } finally { st.busy = false; }
  }

  async function set(b) {
    const cur = { ...DEFAULTS, ...settings() }, next = { ...cur };
    const bad = (what) => { throw Object.assign(new Error(what), { code: 400 }); };
    if (b.seconds != null) { if (!LENGTHS.includes(Number(b.seconds))) bad(`seconds: one of ${LENGTHS.join(', ')}`); next.seconds = Number(b.seconds); }
    if (b.on != null) next.on = !!b.on;
    if ('hotkey' in b) next.hotkey = cleanHotkey(b.hotkey);
    if (b.quality != null) { if (!QUALITIES[b.quality]) bad('quality: standard or high'); next.quality = b.quality; }
    if (b.fps != null) { if (!FPS.includes(Number(b.fps))) bad('fps: 30 or 60'); next.fps = Number(b.fps); }
    if (b.size != null) { if (!SIZES.includes(String(b.size))) bad('size: screen, 1080 or 720'); next.size = String(b.size); }
    if (b.mic != null) next.mic = !!b.mic;
    if (b.when != null) { if (!WHEN.includes(b.when)) bad('when: games or always'); next.when = b.when; }
    if (b.maxGB != null) { if (!CAPS.includes(Number(b.maxGB))) bad(`maxGB: one of ${CAPS.join(', ')}`); next.maxGB = Number(b.maxGB); }
    // a length must fit this PC's memory with the new quality, frame rate and size: one picked that does not is refused;
    // one that no longer fits after another change comes down to the longest that does, said once
    const fit = lengthsFor(next, screen(), ram());
    if (!fit.includes(next.seconds)) {
      if (b.seconds != null) bad(`${next.seconds / 60} min needs more memory than this PC can spare at these settings`);
      const was = next.seconds;
      next.seconds = Math.max(...fit.filter((x) => x < was));
      st.lengthNote = `Length now ${next.seconds % 60 ? `${next.seconds} s` : `${next.seconds / 60} min`}: ${was / 60} min needs more memory than this PC can spare at these settings.`;
    } else st.lengthNote = null;
    if (b.addGame != null) {
      const exe = String(b.addGame.exe || '').trim().toLowerCase(), name = String(b.addGame.name || '').trim().slice(0, 60) || exe.replace(/\.exe$/, '');
      if (!/^[^\\/:*?"<>|]{1,80}\.exe$/.test(exe)) bad('a game is a program name ending in .exe');
      if ((next.games || []).length >= 50) bad('at most 50 games of your own');
      next.games = [...(next.games || []).filter((g) => g.exe !== exe), { exe, name }];
    }
    if (b.removeGame != null) next.games = (next.games || []).filter((g) => g.exe !== String(b.removeGame).toLowerCase());
    // what lives in OBS's profile (read when OBS starts): written with OBS closed. DeviceHub's own OBS is closed for it
    // (the next check starts it again within seconds, with the new settings); an OBS the person opened is not
    const PROFILE_KEYS = ['seconds', 'hotkey', 'quality', 'fps', 'size'];
    const changesObs = next.on && (!cur.on || PROFILE_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k])));
    if (changesObs) {
      if (st.phase === 'recording' && !st.ours) throw Object.assign(new Error('Close OBS first: it is the one you opened, so DeviceHub does not close it.'), { code: 409 });
      if (st.phase === 'recording') await stop('its settings changed (it starts again in a few seconds)');
      await setup(next);
    }
    saveSettings(next);
    if (b.on === false && st.phase === 'recording') await stop('instant replay was turned off');
    else if (b.when === 'games' && st.phase === 'recording' && st.game === 'your PC') await stop('it now runs only with games');
    // the mic now, in DeviceHub's own OBS
    if (b.mic != null && st.phase === 'recording' && st.ours) { try { const api = await ws(); try { await applyMic(api); } finally { api.close(); } } catch {} }
    if ('hotkey' in b) st.keys = null;
    if (b.maxGB != null) await cleanup();
    return status();
  }

  // the clips folder over its cap: the oldest of DeviceHub's clips to the Recycle Bin until it is under (never another
  // file in that folder, never the newest clip)
  async function cleanup() {
    st.cleanedAt = now();
    const cap = { ...DEFAULTS, ...settings() }.maxGB;
    if (!cap || !sys.listClips) return { removed: 0 };
    const clips = sys.listClips(folder()).filter((c) => CLIP.test(c.name)).sort((a, b) => a.at - b.at);
    let total = clips.reduce((n, c) => n + c.size, 0);
    const out = [];
    for (const c of clips.slice(0, -1)) { if (total <= cap * 1e9) break; out.push(c); total -= c.size; }
    if (!out.length) return { removed: 0 };
    const ok = await sys.recycle(out.map((c) => path.join(folder(), c.name)));
    if (ok) log(`Instant replay: ${out.length} old clip${out.length > 1 ? 's' : ''} moved to the Recycle Bin (the folder keeps ${cap} GB at most)`, 'info');
    return { removed: ok ? out.length : 0 };
  }

  // other programs on these keys: the known ones that are running, and Windows' own answer (kept 10 minutes)
  async function conflicts() {
    const hk = { ...DEFAULTS, ...settings() }.hotkey;
    if (!hk) return [];
    if (st.keys && st.keys.for === JSON.stringify(hk) && now() - st.keys.at < 600000) return st.keys.list;
    const label = hotkeyLabel(hk), list = [];
    let progs = [];
    try { progs = (await sys.programs?.()) || []; } catch {}
    for (const k of KNOWN_KEYS) if (k.keys === label && progs.some((p) => k.app.test(p))) list.push(`${label} is also ${k.who}: both would act on it.`);
    try { if ((await sys.probeHotkey?.(hk)) === 'taken') list.push(`Another program holds ${label} in Windows, so OBS may not see it: pick other keys.`); } catch {}
    st.keys = { for: JSON.stringify(hk), at: now(), list };
    return list;
  }

  function status() {
    const s = { ...DEFAULTS, ...settings() };
    // the newest clip in the folder (a hotkey save happens inside OBS, so DeviceHub learns of it here) and the folder's size
    const clips = (sys.listClips?.(folder()) || []).filter((c) => CLIP.test(c.name));
    const newest = clips.sort((a, b) => b.at - a.at)[0];
    const lastClip = newest && (!st.lastClip || newest.at >= Date.parse(st.lastClip.at) - 2000) ? { file: path.join(folder(), newest.name), at: new Date(newest.at).toISOString() } : st.lastClip;
    return { ok: true, installed: sys.installed(), ...s, hotkeyLabel: hotkeyLabel(s.hotkey), lengths: lengthsFor(s, screen(), ram()), memoryMB: Object.fromEntries(LENGTHS.map((x) => [x, replayMB({ ...s, seconds: x }, screen())])), lengthNote: st.lengthNote || null, fpsList: FPS, sizes: SIZES, caps: CAPS, folder: folder(),
      clips: { count: clips.length, bytes: clips.reduce((n, c) => n + c.size, 0) }, keyWarnings: st.keys?.list || [], phase: st.phase, game: st.game, lastClip, error: st.error,
      // installed but never opened (3 Nov 2026: a friend installs it from Optional tools and unticks Launch OBS): OBS
      // makes its settings, and asks its own first question, the first time a person opens it
      firstRun: sys.installed() && !wsConf() };
  }
  // the first run, for the person (the card's Open OBS): OBS as from the Start menu, nothing passed to it
  async function openForPerson() {
    if (!sys.installed()) throw Object.assign(new Error('OBS Studio is not installed.'), { code: 409 });
    if ((await sys.obsPids()).length) return { ok: true, already: true };
    sys.start([]);
    return { ok: true };
  }
  return { tick, start, save, stop, status, set, setup, cleanup, conflicts, openForPerson, _st: st };
}
