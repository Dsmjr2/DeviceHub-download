// Instant replay, one card on the PC page (2 Nov 2026, Shawn: "obs sounds much better"; helpers/replay.mjs, /api/replay):
// OBS Studio's replay buffer runs only while a game does (or always, if picked), and a hotkey keeps the last seconds.
// Without OBS, its Install button (Settings > Optional tools has the same). Turning it on sets OBS up once, so OBS must
// be closed then. Every setting is shown (no "more" fold: Shawn, 23 Oct 2026). 3 Nov 2026, Shawn: "Make it able to
// change hotkeys for the record or turn off hotkeys completely. also add any other useful settings".
import { h } from './dom.js';
import { card, row, toggle, button, pill } from './controls.js';
import { dropdown } from './dropdown.js';
import { installerButton } from './installer-button.js';
import { isDemo } from '../core/devices.js';
import { toast } from './overlay.js';

const DEMO = { ok: true, installed: true, on: true, seconds: 30, hotkey: { alt: true, key: 'OBS_KEY_F10' }, hotkeyLabel: 'Alt+F10', quality: 'standard', fps: 60, size: 'screen', mic: true, when: 'games',
  games: [{ exe: 'emulator.exe', name: 'My emulator' }], maxGB: 20, caps: [0, 5, 10, 20, 50], clips: { count: 12, bytes: 2.4e9 }, keyWarnings: [],
  lengths: [15, 30, 45, 60, 120, 180, 300, 600, 900], memoryMB: { 15: 256, 30: 256, 45: 360, 60: 480, 120: 960, 180: 1440, 300: 2400, 600: 4800, 900: 7200, 1200: 9600 }, fpsList: [30, 60], sizes: ['screen', '1080', '720'], folder: 'C:\\Users\\you\\Videos\\DeviceHub replays', phase: 'recording', game: 'Fortnite', lastClip: null, error: null };
let st = null, stAt = 0, waiting = null, note = null, capturing = false, stopCapture = null;
export const lengthLabel = (s) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);
// a long length's option says the most memory it can take (4 Nov 2026): "10 min (4.7 GB)"
export const lengthOption = (s, mb) => (mb >= 1024 ? `${lengthLabel(s)} (${(mb / 1024).toFixed(1)} GB)` : lengthLabel(s));
export const recordLabel = (s) => `Record last ${lengthLabel(s)}`;
const SIZE_LABEL = { screen: 'Screen size', 1080: '1080p', 720: '720p' };
export const gbLabel = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
// programs with a window now, to add as a game (3 Nov 2026: a game DeviceHub's game folders miss); read when the card
// is drawn, at most every 30 s
let running = [], runningAt = 0;
const SKIP_PROGRAMS = /^(explorer|devicehub|claude|code|chrome|msedge|firefox|obs64|powershell|windowsterminal|cmd|conhost|applicationframehost|systemsettings|textinputhost|nvidia app|nvidia overlay|steam|steamwebhelper|epicgameslauncher|riotclientservices|battle\.net|discord)\.exe$/i;
async function loadRunning(redraw) {
  runningAt = Date.now();
  try { running = (await (await fetch('/api/processes?windows=1')).json()).filter((p) => p?.exe && !SKIP_PROGRAMS.test(p.exe)); } catch { running = []; }
  redraw();
}

// a key pressed in the page -> OBS's name for it (helpers/replay.mjs takes only these), or null
export function keyFromCode(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return `OBS_KEY_${m[1]}`;
  if ((m = /^Digit(\d)$/.exec(code))) return `OBS_KEY_${m[1]}`;
  if ((m = /^F(\d{1,2})$/.exec(code)) && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `OBS_KEY_F${m[1]}`;
  if ((m = /^Numpad(\d)$/.exec(code))) return `OBS_KEY_NUM${m[1]}`;
  return { Insert: 'OBS_KEY_INSERT', Home: 'OBS_KEY_HOME', End: 'OBS_KEY_END', PageUp: 'OBS_KEY_PAGEUP', PageDown: 'OBS_KEY_PAGEDOWN', Pause: 'OBS_KEY_PAUSE', ScrollLock: 'OBS_KEY_SCROLLLOCK' }[code] || null;
}

async function load(redraw) {
  if (waiting) { waiting.add(redraw); return; }
  waiting = new Set([redraw]);
  try { st = await (await fetch('/api/replay')).json(); } catch { st = { ok: false, why: 'DeviceHub did not answer' }; }
  stAt = Date.now();
  const all = waiting; waiting = null;
  for (const r of all) r();
}
async function post(path, body, redraw) {
  if (isDemo()) {
    if (path === '/api/replay') Object.assign(st, body, 'hotkey' in body ? { hotkeyLabel: body.hotkey ? 'your keys' : 'Off' } : {});
    note = path === '/api/replay/save' ? 'Demo: nothing was saved.' : 'Demo: OBS is not changed.';
    redraw(); return;
  }
  note = null;
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.why || r.statusText);
    if (path === '/api/replay') st = j;
    if (path === '/api/replay/save') toast(j.file ? 'Replay saved' : 'Replay asked for', 'good', { detail: j.file || 'OBS is writing it.' });
  } catch (e) { note = e.message; }
  if (path !== '/api/replay') await load(() => {});
  redraw();
}

// Change: the next keys pressed become the hotkey (Esc cancels); a key DeviceHub cannot use says so and keeps listening
function captureHotkey(redraw) {
  if (capturing) return;
  capturing = true; note = 'Press the keys you want (Esc cancels).'; redraw();
  const onKey = (e) => {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { end(); note = null; redraw(); return; }
    const key = keyFromCode(e.code);
    if (!key) { note = 'That key cannot be a hotkey: use F1-F24, or Ctrl or Alt with a letter or digit. Try again, or Esc.'; redraw(); return; }
    if (/^OBS_KEY_[A-Z0-9]$/.test(key) && !e.ctrlKey && !e.altKey) { note = 'A letter or digit needs Ctrl or Alt with it, so typing in a game does not save a clip. Try again, or Esc.'; redraw(); return; }
    end();
    post('/api/replay', { hotkey: { control: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key } }, redraw);
  };
  const end = () => { capturing = false; stopCapture = null; window.removeEventListener('keydown', onKey, true); };
  stopCapture = end;
  window.addEventListener('keydown', onKey, true);
}

export function replayCard(redraw) {
  if (isDemo()) st = st || structuredClone(DEMO);
  // the PC page redraws every few seconds: the state is read again then, so "recording" shows when a game starts
  else if (!st || (Date.now() - stAt > 4000 && !capturing)) load(redraw);
  if (capturing && location.hash !== '#/fans') stopCapture?.();
  const head = [h('h2', {}, 'Instant replay')];
  if (!st) return card(head, h('p', { class: 'faint' }, 'Reading…'));
  if (!st.ok) return card(head, h('p', { class: 'faint' }, `Not read: ${st.why}`));
  if (!st.installed) {
    return card(head, row('OBS Studio', 'Keeps the last moments of a game, free. DeviceHub runs it only while you play.',
      installerButton('obs', { kind: 'primary small', redraw, onDone: () => { st = null; load(redraw); } })));
  }
  // installed, never opened: OBS's first start is the person's (it asks its own question); then turn instant replay on
  if (st.firstRun) {
    return card(head, row('First, open OBS once', 'OBS makes its settings the first time it opens, and asks one question (pick "only for recording" or just close it). Close OBS after, then turn instant replay on here.',
      button('Open OBS', () => post('/api/replay/open-obs', {}, redraw), { kind: 'primary small' })),
    note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, note) : null);
  }
  const hk = st.hotkey ? st.hotkeyLabel : null;
  const keep = `${hk ? `${hk} or the button` : 'The button'} keeps the last ${lengthLabel(st.seconds)}.`;
  const now = st.phase === 'recording' ? `Recording ${st.game === 'your PC' ? 'your PC' : `in ${st.game}`}. ${keep}`
    : !st.on ? 'Off.' : st.when === 'always' ? 'Starting…' : 'Waiting for a game. OBS starts by itself, hidden, and closes after.';
  const set = (b) => post('/api/replay', b, redraw);
  if (!isDemo() && Date.now() - runningAt > 30000) loadRunning(redraw);
  const mine = st.games || [];
  const addable = running.filter((p) => !mine.some((g) => g.exe === p.exe.toLowerCase()));
  const pick = (label, value, options, onChange, extra = {}) => dropdown({ options, value, label, style: { minWidth: '130px' }, onChange, ...extra });
  return card(head,
    row('Instant replay', st.when === 'always' ? 'OBS keeps the last moments of whatever is on screen.' : 'While a game runs, OBS keeps the last moments.',
      toggle({ value: st.on, label: 'Instant replay', onCommit: (v) => set({ on: v }) })),
    row('Length', 'How much a clip keeps, and the most memory it can take. The longest need a smaller size or 30 fps.', pick('Replay length', st.seconds, st.lengths.map((s) => ({ value: s, label: lengthOption(s, st.memoryMB?.[s]) })), (v) => set({ seconds: Number(v) }))),
    row('Hotkey', capturing ? 'Listening…' : hk ? 'Saves a clip, even inside the game.' : 'Off: only the button saves a clip.',
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        hk ? pill(hk) : null,
        button(capturing ? 'Press keys…' : 'Change', () => captureHotkey(redraw), { kind: 'ghost small', disabled: capturing }),
        hk ? button('Turn off', () => set({ hotkey: null }), { kind: 'ghost small', disabled: capturing })
          : button('Alt+F10', () => set({ hotkey: { alt: true, key: 'OBS_KEY_F10' } }), { kind: 'ghost small', disabled: capturing, title: 'Turn the hotkey back on as Alt+F10' }))),
    // the same keys used by another program that is running (NVIDIA, AMD, Steam) or held in Windows (3 Nov 2026)
    ...(st.keyWarnings || []).map((w) => h('p', { class: 'faint', style: { margin: '-4px 0 6px', color: 'var(--warn, #e0a040)' } }, w)),
    // games DeviceHub's game folders miss: the person's own, picked from what has a window now
    row('Games', mine.length ? null : 'Found in Steam, Riot, Epic, Xbox and Battle.net folders. Add one it misses while it runs.',
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        ...mine.map((g) => button(`${g.name} ×`, () => set({ removeGame: g.exe }), { kind: 'ghost small', title: `Stop treating ${g.exe} as a game` })),
        addable.length ? dropdown({ options: addable.map((p) => ({ value: p.exe, label: (p.title || p.exe).slice(0, 40) })), value: null, placeholder: 'Add a game', label: 'Add a game',
          style: { minWidth: '130px' }, onChange: (v) => { const p = addable.find((x) => x.exe === v); set({ addGame: { exe: v, name: (p?.title || v).slice(0, 60) } }); } }) : null)),
    row('Runs', st.when === 'always' ? 'Always on uses about 300-500 MB of memory all the time.' : 'OBS uses no memory between games.',
      pick('When it runs', st.when, [{ value: 'games', label: 'While a game runs' }, { value: 'always', label: 'Always' }], (v) => set({ when: v }))),
    row('Quality', st.quality === 'high' ? 'Sharper, bigger files and about twice the memory.' : 'Good for sharing, smaller files.',
      pick('Quality', st.quality, [{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }], (v) => set({ quality: v }))),
    row('Frame rate', null, pick('Frame rate', st.fps, st.fpsList.map((f) => ({ value: f, label: `${f} FPS` })), (v) => set({ fps: Number(v) }))),
    row('Clip size', 'Smaller is lighter on the PC and quicker to share.', pick('Clip size', st.size, st.sizes.map((s) => ({ value: s, label: SIZE_LABEL[s] || s })), (v) => set({ size: v }))),
    row('Your mic', 'Your voice in clips (game sound is always in).', toggle({ value: st.mic, label: 'Your mic in clips', onCommit: (v) => set({ mic: v }) })),
    row('Clips', st.folder, button('Open', () => post('/api/replay/folder', {}, redraw), { kind: 'ghost small' })),
    // the folder's cap: the oldest clips go to the Recycle Bin past it (3 Nov 2026)
    row('Keep clips up to', `${st.clips ? `${st.clips.count} clip${st.clips.count === 1 ? '' : 's'}, ${gbLabel(st.clips.bytes)} now. ` : ''}${st.maxGB ? 'The oldest go to the Recycle Bin past it.' : 'Nothing is ever removed.'}`,
      pick('Keep clips up to', st.maxGB, (st.caps || [0, 5, 10, 20, 50]).map((c) => ({ value: c, label: c ? `${c} GB` : 'No limit' })), (v) => set({ maxGB: Number(v) }))),
    // Record last <length> (3 Nov 2026, Shawn: "a button in it that says Record Last * and then whatever length of time
    // someone picks"): the same as the hotkey; there is something to keep only while it records
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0 0' } },
      h('span', { class: 'faint', style: { flex: '1' } }, now),
      st.on ? button(recordLabel(st.seconds), () => post('/api/replay/save', {}, redraw),
        { kind: 'primary small', disabled: st.phase !== 'recording', title: st.phase === 'recording' ? `Keeps it in your clips folder${hk ? ` (${hk} does the same)` : ''}` : 'Works while a game runs' }) : null),
    st.phase === 'recording' ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, 'Changing the length, hotkey, quality, frame rate or size now restarts OBS: a few seconds are not kept.') : null,
    st.lastClip ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, `Last clip: ${st.lastClip.file.split(/[\\/]/).pop()}`) : null,
    st.error ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, `Last try: ${st.error}`) : null,
    st.lengthNote ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, st.lengthNote) : null,
    note ? h('p', { class: 'faint', style: { margin: '6px 0 0' } }, note) : null);
}
