// Profiles (redesigned 22 Oct 2026, docs/handoff/profiles-redesign.md): one card per profile that says in plain words
// when it is used and what it sets, with "Use now" and "Save my current settings here". Every question is asked inside
// the card (no pop-ups); only "Use now" keeps its preview, the same as Apply before. The data format is unchanged:
// profiles.json holds { name, color, games, devices, monitors?, added?, savedAt }, and settings.json's defaultProfile is
// the "When no game is running" profile (core/profile-use.js maps the choice onto both).
import { h, icon } from '../ui/dom.js';
import { button, pill, card, row, toggle } from '../ui/controls.js';
import { auto, saveSettings, runningWindows, onAuto, gameTitle } from '../core/autoswitch.js';
import { devices, isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { loadProfiles, saveProfiles, capture, captureAdded, diff, apply, keyLabel, showValue, showAdded, PROFILE_KEYS, MONITOR_KEYS, PROFILE_COLORS, loadMonitors, monitorList, captureMonitors, findMonitor } from '../core/profiles.js';
import { USES, useOf, planUse, namedGames } from '../core/profile-use.js';
import { LIFT_OFF } from '../devices/pulsar.js';
import { EFFECTS } from '../devices/keycodes.js';
import { modal, toast } from '../ui/overlay.js';
import { helpHere } from '../ui/get-help.js';

let list = null;
let rerender = () => {};
let deferred = false;   // a redraw waiting for the person to finish typing in a box
const refreshList = async () => { list = await loadProfiles(); rerender(); };
// a box being typed in is not redrawn under the person's fingers: a redraw from outside (a device value, auto-switch)
// waits until the box loses focus
const typing = () => !!document.activeElement?.matches?.('#main .page input.text');
onAuto(() => { if (typing()) deferred = true; else rerender(); });

// What the page is in the middle of, kept here so a redraw (a device value changing) does not lose it.
const ui = {
  confirm: null,        // { name, what: 'save' | 'delete' }: the question shown inside that card
  note: {},             // name -> { text, kind }: one short line under a card's buttons after something happened
  picker: null,         // the profile whose "Add a game" list is open
  showAll: new Set(),   // profiles whose whole "What it sets" list is open (a long one shows its first lines)
  pickerApps: null,     // programs with a window open (null while being read)
  pickerText: '',
  pending: new Set(),   // picked "When these games start" with no game added yet
  remembered: {},       // name -> named games seen this session (so "any game" and back keeps the list)
  adding: null,         // the new-profile steps: { step: 'name', name, error } | { step: 'pick', name, snap, mons, added, off, error }
  focusNew: false,
};

// when the box loses focus: redraw now, unless focus went to a control on the page (its own action redraws)
const afterTyping = () => setTimeout(() => {
  if (!deferred) return;
  const a = document.activeElement;
  if (a?.closest?.('#main .page') && a.matches('button, select, input')) return;
  rerender();
}, 0);

// ---------- plain words for each setting, as the device pages say them ----------
const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
const onOff = (v) => (v ? 'on' : 'off');
const pct255 = (v) => `${v >= 250 ? 100 : Math.round((v / 255) * 100)}%`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const PLAIN = {
  mouse: {
    pollingRate: ['Polling rate', (v) => `${num(v)} Hz`], dpiStage: ['Active DPI stage', (v) => `stage ${v}`], liftOff: ['Lift-off distance', (v) => LIFT_OFF[v] || String(v)],
    debounce: ['Debounce', (v) => `${v} ms`], motionSync: ['Motion sync', onOff], angleSnap: ['Angle snapping', onOff], ripple: ['Ripple control', onOff],
  },
  keyboard: { brightness: ['Brightness', pct255], effect: ['Effect', (v) => cap(EFFECTS[v]) || `#${v}`], speed: ['Effect speed', pct255], hue: ['Color hue', String], saturation: ['Color saturation', String] },
  headset: { 'vol:playback': ['Volume', (v) => `${v}%`], 'vol:recording': ['Mic level', (v) => `${v}%`], 'mute:recording': ['Mic', (v) => (v ? 'muted' : 'on')], led: ['Headset color', String] },
};
function plain(id, key, v) {
  const m = PLAIN[id]?.[key];
  if (m) return [m[0], v == null ? '—' : m[1](v)];
  if (id === 'mouse' && /^dpi\d$/.test(key)) return [`DPI stage ${Number(key.slice(3)) + 1}`, v == null ? '—' : `${num(v)} DPI`];
  return [keyLabel(id, key), showValue(id, key, v)];
}
const devName = (id) => devices[id]?.adapter?.kind || cap(id);
const addedSetting = (id, key) => (devices[id]?.adapter?.plugin ? (devices[id].adapter.settings || []).find((s) => s.key === key) : null);

// Every line of "What it sets": { dev, label, text, now } where now says how the device differs right now.
function setsLines(p, rows) {
  const at = new Map(rows.map((r) => [`${r.id === 'monitor' ? r.savedId : r.id}|${r.key}`, r]));
  const out = [];
  for (const [id, vals] of Object.entries(p.devices || {})) {
    if (!PROFILE_KEYS[id]) continue;
    for (const [k, v] of Object.entries(vals || {})) {
      if (!Object.hasOwn(PROFILE_KEYS[id], k)) continue;   // the same keys diff() and apply() use
      const [label, text] = plain(id, k, v);
      const r = at.get(`${id}|${k}`);
      const now = !r ? null : r.ready ? `now ${plain(id, k, r.from)[1]}` : devices[id]?.status === 'asleep' ? 'asleep now' : 'not connected now';
      out.push({ dev: devName(id), label, text, now });
    }
  }
  const mons = monitorList();
  for (const [mid, vals] of Object.entries(p.monitors || {})) {
    for (const k of Object.keys(MONITOR_KEYS)) {
      if (vals?.[k] == null) continue;
      const r = at.get(`${mid}|${k}`);
      const now = r ? `now ${showValue('monitor', k, r.from)}` : mons && !findMonitor(mid) ? 'off or not found now' : null;
      out.push({ dev: vals.name || 'Monitor', label: keyLabel('monitor', k), text: showValue('monitor', k, vals[k]), now });
    }
  }
  for (const [id, entry] of Object.entries(p.added || {})) {
    const d = devices[id];
    const here = !!d?.adapter?.plugin && d.status === 'connected';
    for (const [k, v] of Object.entries(entry?.values || {})) {
      const s = addedSetting(id, k);
      const r = at.get(`${id}|${k}`);
      const now = !here ? 'not connected now' : r?.blocked ? `skipped: ${r.blocked}` : r ? `now ${r.fromText}` : null;
      out.push({ dev: d?.adapter?.title || entry?.title || id, label: s?.label || k, text: showAdded(s, v), now });
    }
  }
  return out;
}

// ---------- Use now (Apply, unchanged: the preview, then one confirmed write at a time) ----------
export async function applyWithPreview(p) {
  if (p.monitors) await loadMonitors(true);
  const rows = diff(p);
  if (!rows.length) { toast(`Already on "${p.name}"`, 'good', { detail: 'Every connected device already matches.' }); return; }
  // an added device's rows carry their own words (title, label, values); a setting it will skip says why
  const body = h('div', { class: 'diff' }, ...rows.map((r) => (r.added ? h('div', {},
    h('span', { class: 'dev' }, r.title), h('span', {}, r.label), h('s', {}, r.fromText), icon('arrow', 'ic faint'), r.ready ? h('b', {}, r.toText) : h('span', { class: 'faint' }, `skipped: ${r.blocked}`)) : h('div', {},
    h('span', { class: 'dev' }, r.id === 'monitor' ? r.monitorName : devices[r.id].adapter.kind), h('span', {}, keyLabel(r.id, r.key)), h('s', {}, showValue(r.id, r.key, r.from)), icon('arrow', 'ic faint'), r.ready ? h('b', {}, showValue(r.id, r.key, r.to)) : h('span', { class: 'faint' }, 'not connected')))));
  const changes = rows.filter((r) => !r.blocked).length;
  const ok = await modal(`Apply "${p.name}"?`, h('div', {}, h('p', { style: { marginTop: 0 } }, `${changes} change${changes === 1 ? '' : 's'}. Each is backed up, written and read back.`), body),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Apply', value: true, kind: 'primary' }]);
  if (!ok) return;
  const t = toast(`Applying "${p.name}"…`, 'busy', { ms: 0 });
  const r = await apply(p);
  t.update(`"${p.name}" applied`, r.failed ? 'bad' : 'good', `${r.done} changed${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`);
}

// ---------- saving ----------
// what the connected devices are set to now; null when nothing is connected that a profile can keep
async function captureNow() {
  const snap = capture();
  const added = captureAdded();
  await loadMonitors(true);
  const mons = captureMonitors();
  if (!Object.keys(snap).length && !Object.keys(mons).length && !Object.keys(added).length) return null;
  return { snap, mons, added };
}
const NOTHING = 'Nothing to save: connect a device first.';
const say = (name, text, kind = '') => { ui.note = { [name]: { text, kind } }; };

// "Save my current settings here" (Update before): the same capture; the profile keeps its name, color, games and
// place in the list, and an added device that is not plugged in now keeps what the profile had for it.
async function saveHere(p) {
  const now = await captureNow();
  ui.confirm = null;
  if (!now) { say(p.name, NOTHING, 'bad'); rerender(); return; }
  const keep = { ...(p.added || {}), ...now.added };
  const next = (x) => {
    const o = { ...x, games: x.games || [], devices: now.snap, savedAt: new Date().toISOString() };
    delete o.monitors; delete o.added;
    if (Object.keys(now.mons).length) o.monitors = now.mons;
    if (Object.keys(keep).length) o.added = keep;
    return o;
  };
  await saveProfiles(list.map((x) => (x.name === p.name ? next(x) : x)));
  say(p.name, 'Saved. This profile now sets your current settings.');
  await refreshList();
}

async function deleteProfile(p) {
  ui.confirm = null; ui.note = {}; ui.pending.delete(p.name);
  if (ui.picker === p.name) ui.picker = null;
  await saveProfiles(list.filter((x) => x.name !== p.name));
  if (auto.settings.defaultProfile === p.name) await saveSettings({ defaultProfile: '' });
  await refreshList();
}

const setGames = async (p, games) => { await saveProfiles(list.map((x) => (x.name === p.name ? { ...x, games } : x))); await refreshList(); };

// ---------- When to use it ----------
async function setUse(p, choice) {
  ui.note = {}; ui.confirm = null;
  const named = namedGames(p);
  if (named.length) ui.remembered[p.name] = named;
  const plan = planUse(p, choice, auto.settings.defaultProfile, ui.remembered[p.name] || []);
  if (choice === 'named' && !plan.games.length) { ui.pending.add(p.name); openPicker(p); } else ui.pending.delete(p.name);
  if (choice !== 'named' && ui.picker === p.name) ui.picker = null;
  if (JSON.stringify(plan.games) !== JSON.stringify(p.games || [])) await saveProfiles(list.map((x) => (x.name === p.name ? { ...x, games: plan.games } : x)));
  if (plan.defaultProfile !== undefined && plan.defaultProfile !== auto.settings.defaultProfile) await saveSettings({ defaultProfile: plan.defaultProfile });
  await refreshList();
}

async function openPicker(p) {
  ui.picker = p.name; ui.pickerApps = null; ui.pickerText = '';
  rerender();
  const apps = (await runningWindows()).filter((a) => !/^(DeviceHub|explorer|ApplicationFrameHost|TextInputHost|SystemSettings)/i.test(a.exe) && !/DeviceHub/.test(a.title));
  if (ui.picker === p.name) { ui.pickerApps = apps; rerender(); }
}
async function addGame(p, exe) {
  exe = String(exe || '').trim();
  if (!exe) return;
  const name = /\.exe$/i.test(exe) ? exe : `${exe}.exe`;
  ui.picker = null; ui.pickerText = ''; ui.pending.delete(p.name);
  await setGames(p, [...new Set([...namedGames(p), name])]);
}
async function removeGame(p, g) {
  const left = namedGames(p).filter((x) => x !== g);
  if (!left.length) ui.pending.add(p.name);   // the choice stays "When these games start" until another is picked
  await setGames(p, left);
}

function gamePicker(p) {
  const games = namedGames(p);
  const open = ui.picker === p.name;
  const box = h('input', { class: 'text mono', value: ui.pickerText, placeholder: 'or type its name, e.g. VALORANT.exe', 'aria-label': 'program name',
    oninput: (e) => { ui.pickerText = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') addGame(p, e.target.value); if (e.key === 'Escape') { ui.picker = null; rerender(); } },
    onblur: afterTyping });
  return h('div', { class: 'prof-games' },
    h('div', { class: 'facts' },
      ...games.map((g) => h('button', { class: 'pill accent', style: { cursor: 'pointer', background: 'none' }, 'aria-label': `Remove ${gameTitle(g)}`, onclick: () => removeGame(p, g) }, gameTitle(g), ' ×')),
      open ? null : h('button', { class: 'pill', style: { cursor: 'pointer', background: 'none' }, onclick: () => openPicker(p) }, '+ Add a game')),
    open ? h('div', { class: 'prof-pick' },
      h('div', { class: 'prof-label' }, 'Programs open right now'),
      ui.pickerApps == null ? h('div', { class: 'faint' }, 'Looking…')
        : ui.pickerApps.length ? h('div', { class: 'files prof-apps' }, ...ui.pickerApps.map((a) => h('button', { class: 'file prof-app', onclick: () => addGame(p, a.exe) }, h('div', {}, a.title, h('small', {}, a.exe)), icon('plus'))))
          : h('div', { class: 'faint' }, 'No game is open. Start it, then press Add a game again, or type its name below.'),
      box,
      h('div', { class: 'actions' }, button('Add', () => addGame(p, ui.pickerText), { kind: 'primary small' }), button('Cancel', () => { ui.picker = null; rerender(); }, { kind: 'ghost small' }))) : null);
}

// ---------- the cards ----------
function autoPanel() {
  const on = !!auto.settings.autoSwitch;
  // "New profile" sits here, small, so it is never in the way of the profiles (Shawn, 22 Oct 2026)
  const startNew = () => { ui.adding = { step: 'name', name: '', error: '' }; ui.focusNew = true; ui.note = {}; rerender(); };
  return card(null, row('DeviceHub switches profiles for you when games start', on ? null : 'Off: profiles change only when you pick one.',
    h('div', { class: 'actions', style: { alignItems: 'center', flexWrap: 'nowrap' } },
      ui.adding ? null : button('New profile', startNew, { kind: 'ghost small', ic: 'plus' }),
      toggle({ value: on, label: 'Switch profiles when games start', onCommit: async (v) => { await saveSettings({ autoSwitch: v }); rerender(); } }))));
}

function confirmBox(text, yes, yesKind, onYes) {
  return h('div', { class: 'prof-confirm' }, h('p', {}, text),
    h('div', { class: 'actions' }, button(yes, onYes, { kind: `${yesKind} small` }), button('Cancel', () => { ui.confirm = null; rerender(); }, { kind: 'ghost small' })));
}

const SHORT = 3;   // a profile with more lines than this shows a one-line summary and a "Show" button
const devicesOf = (lines) => [...new Set(lines.map((l) => l.dev))];
const lineEl = (l) => h('div', { class: 'prof-line' }, h('span', {}, `${l.dev} · ${l.label}: `, h('b', {}, l.text)), l.now ? h('span', { class: 'prof-now' }, l.now) : null);

// What it sets: a short list as it is; a long one as "29 settings · Mouse, Headset, Keyboard", plus the lines that
// differ right now (what Use now would change), and the whole list behind Show
function setsBlock(p, lines) {
  if (!lines.length) return h('div', { class: 'prof-sets faint' }, 'Sets nothing yet. Press "Save current settings".');
  if (lines.length <= SHORT) return h('div', { class: 'prof-sets' }, ...lines.map(lineEl));
  const open = ui.showAll.has(p.name);
  const differ = lines.filter((l) => l.now);
  const toggleAll = () => { if (open) ui.showAll.delete(p.name); else ui.showAll.add(p.name); rerender(); };
  return h('div', { class: 'prof-sets' },
    h('div', { class: 'prof-sum' },
      h('span', {}, `${lines.length} settings · ${devicesOf(lines).join(', ')}`),
      h('button', { class: 'prof-link', 'aria-expanded': String(open), 'aria-label': `Show what ${p.name} sets`, onclick: toggleAll }, open ? 'Hide' : 'Show')),
    ...(open ? lines : differ.slice(0, SHORT)).map(lineEl),
    !open && differ.length > SHORT ? h('div', { class: 'faint' }, `and ${differ.length - SHORT} more different right now`) : null);
}

// an extra line under the choice only when the choice alone does not tell the whole story
function useNote(p, use, s) {
  const games = use === 'any' || use === 'named';
  if (games && s.defaultProfile && p.name === s.defaultProfile) return 'Also used when no game is running.';
  if (games && !s.autoSwitch) return 'Waits until switching is on at the top.';
  return null;
}

const labelled = (el, text) => { el.setAttribute('aria-label', text); return el; };

function profileCard(p) {
  const s = auto.settings;
  const rows = diff(p);
  const active = !rows.some((r) => !r.blocked);
  const use = useOf(p, s.defaultProfile, ui.pending.has(p.name));
  const lines = setsLines(p, rows);
  const asking = ui.confirm?.name === p.name ? ui.confirm.what : null;
  const note = ui.note[p.name];
  const extra = useNote(p, use, s);
  const saved = p.savedAt && !Number.isNaN(Date.parse(p.savedAt)) ? `Saved ${new Date(p.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  const ask = (what) => { ui.confirm = { name: p.name, what }; ui.note = {}; rerender(); };
  return h('div', { class: 'profile', style: { '--pc': p.color } },
    h('div', { class: 'prof-head' }, h('h3', {}, p.name, saved ? h('span', { class: 'prof-saved' }, saved) : null), active ? pill('Active', 'good') : null),
    h('div', { class: 'prof-use' },
      h('select', { class: 'text', 'aria-label': `When to use ${p.name}`, onchange: (e) => setUse(p, e.target.value) },
        ...USES.map((o) => h('option', { value: o.value, selected: o.value === use ? true : null }, o.label))),
      extra ? h('div', { class: 'prof-note' }, extra) : null,
      use === 'named' ? gamePicker(p) : null),
    setsBlock(p, lines),
    asking === 'save' ? confirmBox('Replace what this profile sets with your current settings?', 'Yes', 'primary', () => saveHere(p))
      : asking === 'delete' ? confirmBox('Delete this profile? Your devices stay as they are.', 'Delete', 'danger', () => deleteProfile(p))
        : h('div', { class: 'prof-foot' },
          active ? null : button('Use now', () => { ui.note = {}; return applyWithPreview(p); }, { kind: 'primary small' }),
          h('div', { class: 'actions' },
            button('Save current settings', () => ask('save'), { kind: 'ghost small' }),
            labelled(button('', () => ask('delete'), { kind: 'ghost small', ic: 'trash' }), `Delete ${p.name}`))),
    note ? h('div', { class: `prof-note${note.kind ? ` ${note.kind}` : ''}`, role: 'status' }, note.text) : null);
}

// ---------- New profile from my current settings ----------
const flowKeys = (now) => {
  const out = [];   // [{ group, items: [{ key, label, text }] }]
  for (const [id, vals] of Object.entries(now.snap)) out.push({ group: devName(id), items: Object.entries(vals).map(([k, v]) => { const [label, text] = plain(id, k, v); return { key: `d|${id}|${k}`, label, text }; }) });
  for (const [mid, vals] of Object.entries(now.mons)) out.push({ group: vals.name || 'Monitor', items: Object.keys(MONITOR_KEYS).filter((k) => vals[k] != null).map((k) => ({ key: `m|${mid}|${k}`, label: keyLabel('monitor', k), text: showValue('monitor', k, vals[k]) })) });
  for (const [id, entry] of Object.entries(now.added)) out.push({ group: entry.title || id, items: Object.entries(entry.values).map(([k, v]) => { const s = addedSetting(id, k); return { key: `a|${id}|${k}`, label: s?.label || k, text: showAdded(s, v) }; }) });
  return out.filter((g) => g.items.length);
};

async function flowNext() {
  const a = ui.adding;
  const name = (a.name || '').trim().slice(0, 100);
  if (!name) { a.error = 'Type a name first.'; rerender(); return; }
  if ((list || []).some((p) => p.name.toLowerCase() === name.toLowerCase())) { a.error = `You already have a profile called "${name}". Pick another name.`; rerender(); return; }
  const now = await captureNow();
  if (!now) { a.error = NOTHING; rerender(); return; }
  ui.adding = { step: 'pick', name, ...now, off: new Set(), error: '' };
  rerender();
}

async function flowSave() {
  const a = ui.adding;
  const on = (k) => !a.off.has(k);
  const pickVals = (vals, prefix) => Object.fromEntries(Object.entries(vals).filter(([k]) => on(`${prefix}|${k}`)));
  const devs = {}, mons = {}, added = {};
  for (const [id, vals] of Object.entries(a.snap)) { const v = pickVals(vals, `d|${id}`); if (Object.keys(v).length) devs[id] = v; }
  for (const [mid, vals] of Object.entries(a.mons)) {
    const v = Object.fromEntries(Object.keys(MONITOR_KEYS).filter((k) => vals[k] != null && on(`m|${mid}|${k}`)).map((k) => [k, vals[k]]));
    if (Object.keys(v).length) mons[mid] = { name: vals.name, ...v };
  }
  for (const [id, entry] of Object.entries(a.added)) { const v = pickVals(entry.values, `a|${id}`); if (Object.keys(v).length) added[id] = { title: entry.title, values: v }; }
  if (!Object.keys(devs).length && !Object.keys(mons).length && !Object.keys(added).length) { a.error = 'Tick at least one setting.'; rerender(); return; }
  const others = (list || []).filter((p) => p.name !== a.name);
  const color = PROFILE_COLORS[others.length % PROFILE_COLORS.length];
  await saveProfiles([...others, { name: a.name, color, games: [], devices: devs, ...(Object.keys(mons).length ? { monitors: mons } : {}), ...(Object.keys(added).length ? { added } : {}), savedAt: new Date().toISOString() }]);
  ui.adding = null;
  say(a.name, 'Saved. Pick when to use it at the top of the card.');
  await refreshList();
}

// one device's settings with a box each, and one box for the whole device (ticks or unticks them all)
function flowGroup(a, g) {
  const boxes = [];
  const all = h('input', { type: 'checkbox', 'aria-label': `Keep every ${g.group} setting` });
  const paintAll = () => {
    const off = g.items.filter((it) => a.off.has(it.key)).length;
    all.checked = off === 0; all.indeterminate = off > 0 && off < g.items.length;
  };
  all.addEventListener('change', () => {
    for (const [i, it] of g.items.entries()) { if (all.checked) a.off.delete(it.key); else a.off.add(it.key); boxes[i].checked = all.checked; }
    paintAll();
  });
  const items = g.items.map((it) => {
    const box = h('input', { type: 'checkbox', checked: a.off.has(it.key) ? null : true, onchange: (e) => { if (e.target.checked) a.off.delete(it.key); else a.off.add(it.key); paintAll(); } });
    boxes.push(box);
    return h('label', { class: 'prof-check' }, box, h('span', {}, `${it.label}: `, h('b', {}, it.text)));
  });
  paintAll();
  return h('div', { class: 'prof-group' }, h('label', { class: 'prof-check prof-check-all' }, all, h('b', {}, g.group)), h('div', { class: 'prof-group-items' }, ...items));
}

function newTile() {
  const a = ui.adding;
  const cancel = () => { ui.adding = null; rerender(); };
  if (!a) return null;   // started from the top card's New profile button
  const err = a.error ? h('div', { class: 'prof-note bad', role: 'status' }, a.error) : null;
  if (a.step === 'name') {
    return h('div', { class: 'profile prof-flow' }, h('h3', {}, 'New profile'),
      h('div', { class: 'prof-label' }, 'Name'),
      h('input', { class: 'text', value: a.name, placeholder: 'e.g. Valorant or Work', maxlength: 100, 'aria-label': 'Profile name', dataset: { newname: '1' },
        oninput: (e) => { a.name = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') flowNext(); if (e.key === 'Escape') cancel(); },
        onblur: afterTyping }),
      err,
      h('div', { class: 'actions' }, button('Next', () => flowNext(), { kind: 'primary small' }), button('Cancel', cancel, { kind: 'ghost small' })));
  }
  return h('div', { class: 'profile prof-flow' }, h('h3', {}, `New profile: ${a.name}`),
    h('div', { class: 'prof-when' }, 'Your current settings. Untick anything this profile should leave alone.'),
    ...flowKeys(a).map((g) => flowGroup(a, g)),
    err,
    h('div', { class: 'actions' }, button('Save', () => flowSave(), { kind: 'primary small' }), button('Cancel', cancel, { kind: 'ghost small' })));
}

export default {
  id: 'profiles', title: 'Profiles', icon: 'profiles', accent: 'var(--signal)',
  watches: ['mouse', 'headset', 'keyboard', 'auto'],  // what differs follows the devices; activity lines do not redraw it (21 Oct 2026)
  keepAlive() { if (!typing()) return false; deferred = true; return true; },
  render() {
    rerender = () => {
      const el = document.querySelector('#main .page');
      if (!el || location.hash !== '#/profiles') return;
      deferred = false;
      // the control that had focus gets it back (found by its name), so Enter in a box keeps the place
      const was = el.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
      const next = Object.assign(this.render(), { className: 'page no-anim' });
      el.replaceWith(next);
      if (was) [...next.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === was)?.focus();
    };
    if (!list) refreshList();
    if (!monitorList() && !isDemo()) loadMonitors(false).then(() => rerender());
    if (ui.focusNew) { ui.focusNew = false; setTimeout(() => document.querySelector('#main [data-newname]')?.focus(), 0); }

    return h('div', {},
      topbar('Setups', 'Profiles', 'Switch every device at once.', null, helpHere('profiles')),
      h('div', { style: { marginBottom: '18px' } }, autoPanel()),
      h('div', { class: 'profiles' }, newTile(), ...(list || []).map((p) => profileCard(p))));
  },
};
