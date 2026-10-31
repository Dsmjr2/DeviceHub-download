// Backups (redesigned 22 Oct 2026, docs/handoff/backups-redesign.md): one card for the whole setup (save a copy, load
// a setup file, the weekly copies) and one card per device with the copies DeviceHub took before each change. Every
// "Go back to this" and every setup file load asks first, inside its own row (no pop-ups), and says how it went in one
// line in the same place. Routes, file formats and the restore itself are unchanged: restorePlan below, core/setup.js.
import { h, icon } from '../ui/dom.js';
import { button, card } from '../ui/controls.js';
import { devices, writeBatch, isDemo, shownDevices } from '../core/devices.js';
import { topbar } from './common.js';
import { PulsarMouse } from '../devices/pulsar.js';
import { SETTINGS as MOUSE_SETTINGS } from '../devices/mouse-adapter.js';
import { PROFILE_KEYS, keyLabel, showValue } from '../core/profiles.js';
import { keyName } from '../devices/keycodes.js';
import { splitMacros, decodeMacro } from '../devices/macros.js';
import { saveSetup, planSetup, loadSetup } from '../core/setup.js';
import { SHOWN, friendlyWhen, whenInSentence, weeklyWhen, whyText, groupOf, OTHER_NAMES, contentLines } from '../core/backup-words.js';
import { demoBackups } from '../devices/demo-backups.js';
import { helpHere } from '../ui/get-help.js';


// Turn a backup into the list of writes that would put the device back. `allow` says which settings may be written
// (a single backup restores the profile settings; a whole-setup file, core/setup.js, allows more).
export function restorePlan(id, b, allow = (k) => !!PROFILE_KEYS[id]?.[k], label = (k) => keyLabel(id, k)) {
  const d = devices[id];
  const plan = [];
  let settings = b.data?.settings;
  if (id === 'mouse' && !settings && b.data?.flash0to199) {
    const dec = PulsarMouse.decode(b.data.flash0to199);
    settings = {};
    for (const [k, s] of Object.entries(MOUSE_SETTINGS)) if (dec[k].ok) settings[k] = s.dec(dec[k].value);
    dec.dpis.forEach((x, i) => { if (x != null) settings[`dpi${i}`] = x; });
    dec.buttons.forEach((a, i) => { if (a != null && i > 0) settings[`btn${i}`] = a; });
  }
  for (const [k, v] of Object.entries(settings || {})) {
    if (!allow(k) || v == null || JSON.stringify(d.values[k]) === JSON.stringify(v)) continue;
    plan.push({ key: k, to: v, label: label(k), from: showValue(id, k, d.values[k]), show: showValue(id, k, v) });
  }
  if (id === 'keyboard' && d.adapter.session) {
    const s = d.adapter.session;
    const L = s.info.layers, R = s.keymap[0].length, C = s.keymap[0][0].length;
    const raw = b.data?.raw || {};
    const km = raw.keymap;
    // Only a backup of exactly this keyboard's shape is restored; anything else would put keys in the wrong places.
    const shapeOk = Array.isArray(km) && km.length === L && raw.rows === R && raw.cols === C && raw.layers === L
      && km.every((layer) => Array.isArray(layer) && layer.length === R && layer.every((row) => Array.isArray(row) && row.length === C && row.every((k) => Number.isInteger(k) && k >= 0 && k <= 0xffff)));
    if (km && !shapeOk) throw new Error(`this backup's keymap is not ${L} × ${R} × ${C}, so it is not restored`);
    km?.forEach((layer, l) => layer.forEach((row, r) => row.forEach((code, c) => {
      const now = s.keymap[l][r][c];
      if (now !== code) plan.push({ key: `key:${l}:${r}:${c}`, to: code, label: `Layer ${l} key ${r},${c}`, from: keyName(now), show: keyName(code) });
    })));
    if (Array.isArray(raw.encoders) && raw.encoders.length === L && s.encoders) raw.encoders.forEach((pair, l) => pair.forEach((code, cw) => {
      const now = s.encoders[l][cw];
      if (Number.isInteger(code) && now !== code) plan.push({ key: `enc:${l}:0:${cw}`, to: code, label: `Layer ${l} knob ${cw ? 'right' : 'left'}`, from: keyName(now), show: keyName(code) });
    }));
    // Macros are restored byte for byte. The buffer must hold all macro slots (one 0 terminator each).
    const mb = raw.macroBuffer;
    if (Array.isArray(mb) && mb.filter((x) => x === 0).length >= s.macros.mi.count) {
      splitMacros(mb, s.macros.mi.count).forEach((bytes, i) => {
        const cur = s.macros.raw[i] || [];
        if (bytes.length !== cur.length || bytes.some((x, j) => x !== cur[j])) plan.push({ key: `macroRaw:${i}`, to: [...bytes], label: `Macro ${i}`, from: s.macros.list[i] || 'empty', show: decodeMacro(bytes) || 'empty' });
      });
    }
  }
  return plan;
}

// ---------- where the lists come from: the server, or in demo mode the pretend ones (devices/demo-backups.js) ----------
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`the file could not be read (${r.status})`); return r.json(); };
const source = {
  list: () => (isDemo() ? demoBackups.list() : getJson('/api/backups')),
  read: async (name) => (isDemo() ? demoBackups.read(name) : getJson(`/api/backups/${encodeURIComponent(name)}`)),
  weekly: () => (isDemo() ? demoBackups.weekly() : getJson('/api/setups')),
  readWeekly: async (name) => (isDemo() ? demoBackups.readWeekly(name) : getJson(`/api/setups/${encodeURIComponent(name)}`)),
};

let files = null, weeklyFiles = null;
let rerender = () => {};
const load = async () => { try { files = await source.list(); } catch { files = []; } rerender(); };
const loadWeekly = async () => { try { weeklyFiles = await source.weekly(); } catch { weeklyFiles = []; } rerender(); };

// What the page is in the middle of, kept here so a redraw does not lose it. Keys: 'b:<file>' a device backup,
// 'w:<file>' a weekly copy, 'file' a setup file picked by hand, 'setup' the whole-setup card's own line.
const ui = {
  confirm: null,       // the one question open: { key, kind: 'device', f, id, plan } | { key, kind: 'setup', file, planned, count, when }
  view: null,          // the backup whose "See what's in it" is open: { key, b } (b null while it is read)
  raw: false,          // that view shows the whole file
  older: new Set(),    // device cards showing their older backups
  note: {},            // key -> { text, kind }: one plain line after something happened
  busy: null,          // the key being put back right now
  withWallpapers: false,   // Save a copy also puts the wallpapers in the file
};
let wallpaperSize = null;   // { wallpaperBytes, wallpaperCount }, read when the page opens
const loadWallpaperSize = async () => { if (isDemo()) return; try { wallpaperSize = await getJson('/api/setup-extras?size=1'); } catch { wallpaperSize = null; } rerender(); };
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// a setup file from somewhere else (the OneDrive copy of another PC: Overview, Settings): its confirmation opens here
let pending = null;
export function reviewSetup(file, when, pc) { pending = { file, when, pc }; location.hash = '#/backups'; }
export function loadSetupFile() { pending = { pick: true }; location.hash = '#/backups'; }
const why = new Map();   // file name -> its "before ..." words (null when it says nothing), read once per file
const whyLoading = new Set();

const devName = (id) => devices[id]?.adapter.title || OTHER_NAMES[id] || id;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const note = (key, text, kind = '') => { ui.note[key] = { text, kind }; };
const ask = (c) => { ui.confirm = c; ui.note = {}; ui.view = null; rerender(); };
const cancel = () => { ui.confirm = null; rerender(); };

// the "before ..." words of the backups on screen, read one file at a time (a file is small; most are under 10 KB)
async function readWhy(list, id) {
  for (const f of list) {
    if (why.has(f.name) || whyLoading.has(f.name)) continue;
    whyLoading.add(f.name);
    try { const b = await source.read(f.name); why.set(f.name, whyText(b.why, (k) => keyLabel(id, k))); } catch { why.set(f.name, null); }
    whyLoading.delete(f.name);
    redrawSoon();
  }
}
// one redraw for many files read close together
let soon = null;
const redrawSoon = () => { if (!soon) soon = setTimeout(() => { soon = null; rerender(); }, 60); };

// ---------- one device backup ----------
async function askDevice(f, id) {
  const key = `b:${f.name}`, d = devices[id], when = whenInSentence(f.at);
  ui.note = {};
  if (d?.status !== 'connected') { note(key, `Connect your ${d?.adapter.title || id} first, then try again.`, 'bad'); rerender(); return; }
  let b, plan;
  try { b = await source.read(f.name); } catch (e) { note(key, `Copy not read: ${e.message}.`, 'bad'); rerender(); return; }
  if (b.device !== id) { note(key, 'Not a copy of this device.', 'bad'); rerender(); return; }
  try { plan = restorePlan(id, b); } catch (e) { note(key, `Not used: ${e.message}.`, 'bad'); rerender(); return; }
  if (!plan.length) { note(key, 'Nothing to change.'); rerender(); return; }
  ask({ key, kind: 'device', f, id, plan, when });
}

async function yesDevice() {
  const { key, f, id, plan, when } = ui.confirm;
  const d = devices[id];
  ui.confirm = null; ui.busy = key;
  note(key, `Putting your ${d.adapter.title} back…`);
  rerender();
  try {
    const { done, failed } = await writeBatch(id, plan.map((p) => ({ key: p.key, value: p.to, label: p.label, display: p.show })), `before restoring ${f.name}`);
    note(key, failed ? `Problems: ${done} put back, ${failed} not (see Activity).` : `${isDemo() ? 'Demo: ' : 'Done. '}Your ${d.adapter.title} is back to how it was ${when} (${plural(done, 'setting')})${isDemo() ? ', pretend only' : ''}.`, failed ? 'bad' : 'good');
  } catch (e) { note(key, `Not finished: ${e.message}.`, 'bad'); }
  ui.busy = null;
  load();
}

// ---------- a whole setup file (a weekly copy or one picked by hand) ----------
async function askSetup(key, file, when, pc) {
  ui.note = {};
  let planned;
  try { planned = await planSetup(file); } catch (e) { note(key, `Not loaded: ${e.message}.`, 'bad'); rerender(); return; }
  if (isDemo()) { planned.sound = null; planned.extras = null; }   // demo mode never writes the real sound settings or files
  const count = planned.changes.reduce((n, c) => n + c.plan.length, 0) + (planned.profiles ? 1 : 0) + (planned.sound ? 1 : 0)
    + (planned.extras?.lines.filter((l) => l.what !== 'drivers-kept').length || 0);
  if (!count) {
    note(key, `Nothing to change${planned.notConnected.length ? ` (not connected: ${planned.notConnected.join(', ')})` : ''}.`);
    rerender(); return;
  }
  ask({ key, kind: 'setup', file, planned, count, when, pc });
}

async function yesSetup() {
  const { key, file, planned, pc } = ui.confirm;
  ui.confirm = null; ui.busy = key;
  note(key, 'Loading the setup…');
  rerender();
  try {
    const r = await loadSetup(file, planned);
    // another PC's OneDrive copy, loaded: not offered again on the Overview (until it changes)
    if (pc && !r.failed) fetch('/api/onedrive/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pc }) }).catch(() => {});
    const restart = r.restart ? ' Restart DeviceHub to load added devices.' : '';
    note(key, (r.failed ? `Problems: ${r.done} changed, ${r.failed} not (see Activity).` : `Done. ${plural(r.done, 'setting')} changed.`) + restart, r.failed ? 'bad' : 'good');
  } catch (e) { note(key, `Not finished: ${e.message}.`, 'bad'); }
  ui.busy = null;
  load();
}

async function askWeekly(f) {
  const key = `w:${f.name}`;
  let file;
  try { file = await source.readWeekly(f.name); } catch (e) { ui.note = {}; note(key, `Copy not read: ${e.message}.`, 'bad'); rerender(); return; }
  await askSetup(key, file, weeklyWhen(file.savedAt || f.at));
}

function pickSetupFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    let file;
    try { file = JSON.parse(await f.text()); } catch { ui.note = {}; note('file', `"${f.name}" not read. Pick a DeviceHub .json file.`, 'bad'); rerender(); return; }
    await askSetup('file', file, file?.savedAt ? weeklyWhen(file.savedAt) : 'at an unknown time');
  };
  input.click();
}

async function saveCopy() {
  ui.note = {}; ui.confirm = null;
  if (isDemo()) { note('setup', 'Demo: not saved.'); rerender(); return; }
  note('setup', 'Saving…'); rerender();
  try {
    const r = await saveSetup({ wallpapers: ui.withWallpapers });
    note('setup', `Saved in your Downloads folder.${r.skipped.length ? ` Not connected, so not in it: ${r.skipped.join(', ')}.` : ''}`, 'good');
  } catch (e) { note('setup', `Not saved: ${e.message}.`, 'bad'); }
  load();
}

// ---------- the pieces each row shows ----------
const noteLine = (key) => (ui.note[key] ? h('div', { class: `bk-note${ui.note[key].kind ? ` ${ui.note[key].kind}` : ''}`, role: 'status' }, ui.note[key].text) : null);
const askBox = (text, extra, yes, onYes) => h('div', { class: 'prof-confirm bk-ask', role: 'group', 'aria-label': text },
  h('p', {}, text), ...[].concat(extra || []).filter(Boolean),
  h('div', { class: 'actions' }, button(yes, onYes, { kind: 'primary small' }), button('Cancel', cancel, { kind: 'ghost small' })));
const changeList = (rows, more) => h('div', { class: 'bk-changes' },
  ...rows.map((p) => h('div', {}, p.dev ? h('span', { class: 'bk-dev' }, `${p.dev} · `) : null, `${p.label}: `,
    ...(p.text != null ? [h('b', {}, p.text)] : [h('s', {}, String(p.from)), ' → ', h('b', {}, String(p.show))]))),
  more > 0 ? h('div', { class: 'faint' }, `and ${more} more`) : null);
const LIST_MAX = 6;

function deviceAsk(c) {
  const d = devices[c.id];
  return askBox(`Put your ${d.adapter.title} back to how it was ${c.when}? Later changes are replaced.`,
    [h('div', { class: 'bk-sub' }, `${plural(c.plan.length, 'setting')} will change:`), changeList(c.plan.slice(0, LIST_MAX), c.plan.length - LIST_MAX),
      h('div', { class: 'bk-sub' }, 'How it is now is saved first.')],
    'Yes, go back', yesDevice);
}

function setupAsk(c) {
  const p = c.planned;
  const x = c.file.extras || {};
  const has = [...Object.keys(c.file.devices || {}).map(devName), Array.isArray(c.file.profiles) ? plural(c.file.profiles.length, 'profile') : null, c.file.sound ? 'sound settings' : null,
    Object.keys(x.headsetNames || {}).length ? 'headset names' : null, x.background ? 'a background picture' : null,
    x.myDevices?.length ? plural(x.myDevices.length, 'added device') : null, x.wallpapers?.length ? plural(x.wallpapers.length, 'wallpaper') : null].filter(Boolean);
  const rows = p.changes.flatMap((x) => x.plan.map((r) => ({ ...r, dev: x.kind })));
  if (p.profiles) rows.push({ dev: 'DeviceHub', label: 'Profiles', from: `${p.profiles.from} now`, show: `${p.profiles.to} from the file` });
  if (p.sound) rows.push({ dev: 'Sound', label: 'EQ, speakers, mics', from: 'now', show: 'from the file' });
  for (const l of p.extras?.lines || []) rows.push({ dev: 'DeviceHub', label: l.label, text: l.text });
  return askBox(`Load the setup saved ${c.when}?`,
    [h('div', { class: 'bk-sub' }, `It holds: ${has.join(', ') || 'nothing DeviceHub knows'}.`),
      h('div', { class: 'bk-sub' }, `${plural(c.count, 'setting')} will change:`), changeList(rows.slice(0, LIST_MAX), rows.length - LIST_MAX),
      p.notConnected.length ? h('div', { class: 'bk-sub' }, `Not connected, skipped: ${p.notConnected.join(', ')}.`) : null,
      h('div', { class: 'bk-sub' }, 'Added devices and pictures are kept.')],
    'Yes, load it', yesSetup);
}

async function toggleView(f, id) {
  const key = `b:${f.name}`;
  if (ui.view?.key === key) { ui.view = null; rerender(); return; }
  ui.view = { key, id, b: null }; ui.raw = false; rerender();
  try { const b = await source.read(f.name); if (ui.view?.key === key) ui.view.b = b; } catch (e) { if (ui.view?.key === key) ui.view.error = e.message; }
  rerender();
}

function viewBox() {
  const v = ui.view;
  if (v.error) return h('div', { class: 'bk-view' }, h('div', { class: 'bk-note bad' }, `This copy could not be read: ${v.error}.`));
  if (!v.b) return h('div', { class: 'bk-view' }, h('div', { class: 'faint' }, 'Reading…'));
  const { lines, extra } = contentLines(v.b, (k) => keyLabel(v.id, k), (k, x) => showValue(v.id, k, x));
  // numbers in lists (keymaps, memory dumps) on one line each (20 Oct 2026: a keyboard backup took 368 ms to show)
  const text = () => JSON.stringify(v.b, null, 1).replace(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g, (_, nums) => `[${nums.replace(/\s+/g, '')}]`).slice(0, 60000);
  return h('div', { class: 'bk-view' },
    lines.length ? h('div', { class: 'bk-lines' }, ...lines.map((l) => h('div', {}, h('span', {}, l.label), h('b', {}, l.text)))) : null,
    extra && lines.length ? h('div', { class: 'bk-sub' }, `Also in it: ${extra}.`) : null,
    ui.raw || !lines.length ? h('pre', { class: 'json' }, text()) : null,
    lines.length ? button(ui.raw ? 'Hide the whole file' : 'Show the whole file', () => { ui.raw = !ui.raw; rerender(); }, { kind: 'ghost small' }) : null);
}

function backupRow(f, id, canRestore) {
  const key = `b:${f.name}`;
  const asking = ui.confirm?.key === key;
  const viewing = ui.view?.key === key;
  const w = why.get(f.name);
  // one line: the date (it opens what is in the copy) and Go back
  return h('div', { class: 'bk-item' },
    h('div', { class: 'bk-row' },
      h('button', { class: `bk-what bk-open${viewing ? ' open' : ''}`, 'aria-expanded': String(viewing), 'aria-label': `What is in the copy from ${friendlyWhen(f.at)}`, onclick: () => toggleView(f, id) },
        icon('arrow', 'ic bk-chev'), h('span', {}, h('b', {}, friendlyWhen(f.at)), w ? h('small', {}, w) : null)),
      asking || !canRestore ? null : button('Go back', () => askDevice(f, id), { kind: 'ghost small', disabled: !!ui.busy })),
    viewing ? viewBox() : null,
    asking ? deviceAsk(ui.confirm) : null,
    noteLine(key));
}

function deviceCard(id, list) {
  const canRestore = !!devices[id];
  const open = ui.older.has(id);
  const first = list.slice(0, SHOWN), rest = list.slice(SHOWN);
  readWhy(open ? list : first, id);
  return card([icon(devices[id] ? id : 'backups'), h('h2', {}, devName(id))],
    h('div', { class: 'bk-list' }, ...first.map((f) => backupRow(f, id, canRestore))),
    rest.length && open ? h('div', { class: 'bk-list bk-older' }, ...rest.map((f) => backupRow(f, id, canRestore))) : null,
    rest.length ? h('button', { class: 'bk-more', 'aria-expanded': String(open), onclick: () => { if (open) ui.older.delete(id); else ui.older.add(id); rerender(); } },
      open ? 'Show fewer' : `Show ${rest.length} older`) : null,
    canRestore ? null : h('div', { class: 'bk-sub' }, 'View only.'));
}

function weeklyRow(f) {
  const key = `w:${f.name}`;
  const asking = ui.confirm?.key === key;
  return h('div', { class: 'bk-item' },
    h('div', { class: 'bk-row' },
      h('div', { class: 'bk-what' }, h('b', {}, weeklyWhen(f.at))),
      asking ? null : button('Go back', () => askWeekly(f), { kind: 'ghost small', disabled: !!ui.busy })),
    asking ? setupAsk(ui.confirm) : null,
    noteLine(key));
}

function setupCard() {
  const list = weeklyFiles || [];
  // the title row carries the two buttons; below it the weekly copies (every device, profile and setting in one file)
  return card([icon('backups'), h('h2', {}, 'Whole setup'),
    ui.confirm?.key === 'file' ? null : h('div', { class: 'actions bk-head-acts' },
      button('Save a copy', saveCopy, { kind: 'primary small' }),
      button('Load a file…', pickSetupFile, { kind: 'small', disabled: !!ui.busy }))],
    ui.confirm?.key === 'file' ? setupAsk(ui.confirm) : null,
    wallpaperSize?.wallpaperCount && ui.confirm?.key !== 'file' ? h('label', { class: 'bk-sub bk-with' },
      h('input', { type: 'checkbox', checked: ui.withWallpapers, onchange: (e) => { ui.withWallpapers = e.target.checked; } }),
      ` Put my ${plural(wallpaperSize.wallpaperCount, 'wallpaper')} in the copy too (${mb(wallpaperSize.wallpaperBytes)})`) : null,
    noteLine('setup'), noteLine('file'),
    h('div', { class: 'bk-label' }, 'Weekly copies · last 6 kept'),
    weeklyFiles === null ? h('div', { class: 'faint' }, 'Reading…')
      : list.length ? h('div', { class: 'bk-list' }, ...list.map(weeklyRow))
        : h('div', { class: 'feed-empty' }, 'None yet.'));
}

// Backups in Settings, under Appearance (24 Oct 2026, Shawn: "put the backups here under appearence"): the newest copy
// of each device, and the whole page one click away; the page itself left the sidebar
let cardAsked = false;
export function backupsCard(redraw) {
  if (files === null && !cardAsked) { cardAsked = true; Promise.resolve(source.list()).then((f) => { files = f; }).catch(() => { files = []; }).finally(() => { cardAsked = false; redraw(); }); }
  const groups = new Map();
  for (const d of shownDevices()) groups.set(d.id, []);
  const ids = Object.keys(devices);
  for (const f of files || []) { const g = groupOf(f.name, ids); if (groups.has(g)) groups.get(g).push(f); }
  const open = () => { location.hash = '#/backups'; };
  return card([icon('backups'), h('h2', {}, 'Backups'), h('span', { class: 'spacer' }), button('Open', open, { kind: 'ghost small' })],
    files === null ? h('div', { class: 'faint' }, 'Reading…')
      : h('div', { class: 'bk-list' }, ...[...groups].map(([id, list]) => h('button', { class: 'bk-what bk-open bk-mini', onclick: open },
        h('span', {}, h('b', {}, devName(id)), h('small', {}, list.length ? `Last: ${friendlyWhen(list[0].at)}` : 'None yet'))))),
    null);
}

export default {
  id: 'backups', title: 'Backups', icon: 'backups', accent: 'var(--good)', rail: false,
  watches: [],  // the list is read from the server; device readings do not redraw it (21 Oct 2026)
  render(opts = {}) {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/backups') el.replaceWith(Object.assign(this.render({ own: true }), { className: 'page no-anim' })); };
    // the lists are read again each time the page is opened (no Refresh button)
    if (!opts.own && (opts.fresh || files === null)) {
      if (!ui.busy) { ui.confirm = null; ui.view = null; ui.note = {}; }
      load(); loadWeekly(); loadWallpaperSize();
    }
    if (pending) {
      const p = pending; pending = null;
      setTimeout(() => (p.pick ? pickSetupFile() : askSetup('file', p.file, p.when, p.pc)), 0);
    }
    const groups = new Map();
    // an empty card only for a device this PC has (23 Oct 2026, Shawn: a friend's Backups showed his mouse and headset);
    // a device with backups always has its card
    for (const d of shownDevices()) groups.set(d.id, []);
    const ids = Object.keys(devices);
    for (const f of files || []) { const g = groupOf(f.name, ids); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); }
    const cards = [...groups].map(([id, list]) => (list.length ? deviceCard(id, list)
      : card([icon(devices[id] ? id : 'backups'), h('h2', {}, devName(id))], h('div', { class: 'feed-empty' }, 'None yet.'))));
    return h('div', {},
      // Get help (area backups): a go-back that failed shows its red line here, and the report carries it
      topbar('Safety net', 'Backups', null, null, helpHere('backups')),
      h('p', { class: 'lede bk-intro' }, 'Saved before every change.'),
      h('div', { class: 'bk-top' }, setupCard()),
      files === null ? h('div', { class: 'faint' }, 'Reading…') : h('div', { class: 'grid three top bk-grid' }, ...cards),
      null);
  },
};
