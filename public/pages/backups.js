// Backups: every file DeviceHub wrote before a change, with view and restore.
import { h, icon } from '../ui/dom.js';
import { button, pill, card } from '../ui/controls.js';
import { devices, writeBatch, isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { modal, toast } from '../ui/overlay.js';
import { PulsarMouse } from '../devices/pulsar.js';
import { SETTINGS as MOUSE_SETTINGS } from '../devices/mouse-adapter.js';
import { PROFILE_KEYS, keyLabel, showValue } from '../core/profiles.js';
import { keyName } from '../devices/keycodes.js';
import { splitMacros, decodeMacro } from '../devices/macros.js';
import { saveSetup, planSetup, loadSetup } from '../core/setup.js';

let files = null;
let rerender = () => {};
const load = async () => { try { files = await (await fetch('/api/backups')).json(); } catch { files = []; } rerender(); };
const deviceOf = (name) => name.split('-')[0];

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

async function view(f) {
  const b = await (await fetch(`/api/backups/${encodeURIComponent(f.name)}`)).json();
  // lists of numbers (keymaps, memory dumps) on one line each: the same content, many times fewer lines to draw
  // (20 Oct 2026: a keyboard backup took 368 ms to open with every key code on its own line)
  const text = JSON.stringify(b, null, 1).replace(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g, (_, nums) => `[${nums.replace(/\s+/g, '')}]`);
  await modal(f.name, h('pre', { class: 'json' }, text.slice(0, 60000)), [{ label: 'Close', value: true, kind: 'ghost' }]);
}

async function restore(f) {
  const id = deviceOf(f.name);
  const d = devices[id];
  if (d?.status !== 'connected') { toast(`Connect the ${d?.adapter.kind.toLowerCase() || id} first`, 'bad'); return; }
  const b = await (await fetch(`/api/backups/${encodeURIComponent(f.name)}`)).json();
  if (b.device !== id) { toast('This file is not a backup of that device', 'bad'); return; }
  let plan;
  try { plan = restorePlan(id, b); } catch (e) { toast('Not restored', 'bad', { detail: e.message }); return; }
  if (!plan.length) { toast('Nothing to restore', 'good', { detail: 'The device already matches this backup.' }); return; }
  const ok = await modal(`Restore ${d.adapter.title}?`, h('div', {}, h('p', { style: { marginTop: 0 } }, `${plan.length} setting${plan.length === 1 ? '' : 's'} differ from this backup. The current state is backed up first, then each one is written and checked.`),
    h('div', { class: 'diff' }, ...plan.slice(0, 60).map((p) => h('div', {}, h('span', { class: 'dev' }, d.adapter.kind), h('span', {}, p.label), h('s', {}, p.from), icon('arrow', 'ic faint'), h('b', {}, p.show)))),
    plan.length > 60 ? h('p', {}, `…and ${plan.length - 60} more`) : null),
  [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Restore', value: true, kind: 'primary' }]);
  if (!ok) return;
  const t = toast('Restoring…', 'busy', { ms: 0 });
  const { done, failed } = await writeBatch(id, plan.map((p) => ({ key: p.key, value: p.to, label: p.label, display: p.show })), `before restoring ${f.name}`);
  t.update(failed ? 'Restore finished with problems' : 'Restored', failed ? 'bad' : 'good', `${done} restored${failed ? `, ${failed} failed (see Activity)` : ''}`);
  load();
}

async function saveSetupFile() {
  const t = toast('Saving your setup…', 'busy', { ms: 0 });
  try {
    const r = await saveSetup();
    t.update('Setup file saved', 'good', `In your Downloads folder${r.skipped.length ? `. Not connected, so not in it: ${r.skipped.join(', ')}` : ''}.`);
  } catch (e) { t.update('Setup file not saved', 'bad', e.message); }
  load();
}

// Pick a setup file, show every difference, and load it only after "Load".
function loadSetupFile() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    let file;
    try { file = JSON.parse(await f.text()); } catch (e) { toast('Not loaded', 'bad', { detail: e.message }); return; }
    await loadSetupJson(file);
  };
  input.click();
}

// A setup file's contents (picked by hand or one of the weekly ones): show every difference, load only after "Load".
async function loadSetupJson(file) {
  {
    let planned;
    try { planned = await planSetup(file); } catch (e) { toast('Not loaded', 'bad', { detail: e.message }); return; }
    const rows = planned.changes.flatMap((c) => c.plan.map((p) => ({ ...p, dev: c.kind })));
    const count = rows.length + (planned.profiles ? 1 : 0) + (planned.sound ? 1 : 0);
    const missing = planned.notConnected.length ? h('p', { class: 'faint' }, `Not connected, so left as they are: ${planned.notConnected.join(', ')}.`) : null;
    if (!count) { toast('Nothing to load', 'good', { detail: `Your devices already match this setup file${planned.notConnected.length ? ` (not connected: ${planned.notConnected.join(', ')})` : ''}.` }); return; }
    const ok = await modal('Load this setup?', h('div', {},
      h('p', { style: { marginTop: 0 } }, `Saved ${new Date(file.savedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}. ${count} setting${count === 1 ? '' : 's'} differ from now. Each device is backed up first, then each setting is written and checked.`),
      h('div', { class: 'diff' }, ...rows.slice(0, 80).map((p) => h('div', {}, h('span', { class: 'dev' }, p.dev), h('span', {}, p.label), h('s', {}, p.from), icon('arrow', 'ic faint'), h('b', {}, p.show))),
        planned.profiles ? h('div', {}, h('span', { class: 'dev' }, 'DeviceHub'), h('span', {}, 'Profiles'), h('s', {}, `${planned.profiles.from} saved`), icon('arrow', 'ic faint'), h('b', {}, `${planned.profiles.to} from the file`)) : null,
        planned.sound ? h('div', {}, h('span', { class: 'dev' }, 'Sound'), h('span', {}, 'EQ, speakers, mics'), h('s', {}, 'now'), icon('arrow', 'ic faint'), h('b', {}, 'from the file')) : null),
      rows.length > 80 ? h('p', {}, `…and ${rows.length - 80} more`) : null, missing),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Load', value: true, kind: 'primary' }]);
    if (!ok) return;
    const t = toast('Loading the setup…', 'busy', { ms: 0 });
    const r = await loadSetup(file, planned);
    t.update(r.failed ? 'Setup loaded with problems' : 'Setup loaded', r.failed ? 'bad' : 'good', `${r.done} changed${r.failed ? `, ${r.failed} failed (see Activity)` : ''}`);
    load();
  }
}

// Weekly setup files (server: helpers/weekly-setup.mjs, /api/setups): saved once a week, newest 6 kept.
let weeklyFiles = null;
const loadWeekly = async () => { try { weeklyFiles = await (await fetch('/api/setups')).json(); } catch { weeklyFiles = []; } rerender(); };
function weeklyCard() {
  if (weeklyFiles === null) loadWeekly();
  const list = weeklyFiles || [];
  return card([h('h2', {}, 'Weekly setup files'), h('span', { class: 'sub' }, 'weekly, last 6 kept'), h('span', { class: 'spacer' }),
    button('Save one now', async () => { if (isDemo()) { toast('Demo mode: nothing is saved', 'info'); return; } const r = await (await fetch('/api/setups/save-now', { method: 'POST' })).json().catch(() => ({})); toast(r.name ? 'Setup file saved' : 'Not saved', r.name ? 'good' : 'bad', { detail: r.name || 'No device could be read.' }); loadWeekly(); }, { kind: 'ghost small', ic: 'backups' })],
    list.length ? h('div', { class: 'files' }, ...list.map((f) => h('div', { class: 'file', style: { gridTemplateColumns: '38px 1fr auto' } }, icon('backups'),
      h('div', {}, new Date(f.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), h('small', {}, `${(f.size / 1024).toFixed(1)} KB`)),
      button('Load', async () => { try { const file = await (await fetch(`/api/setups/${encodeURIComponent(f.name)}`)).json(); await loadSetupJson(file); } catch (e) { toast('Not loaded', 'bad', { detail: e.message }); } }, { kind: 'small', ic: 'undo' }))))
      : h('div', { class: 'feed-empty' }, 'The first one is saved a minute or so after DeviceHub starts.'));
}

export default {
  id: 'backups', title: 'Backups', icon: 'backups', accent: 'var(--good)',
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/backups') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!files) load();
    const groups = { mouse: [], keyboard: [], headset: [] };
    for (const f of files || []) (groups[deviceOf(f.name)] ||= []).push(f);
    return h('div', {},
      topbar('Safety net', 'Backups', 'Every change is backed up first.',
        h('div', { class: 'actions' },
          button('Refresh', load, { kind: 'ghost', ic: 'refresh' }),
          button('Load setup file', loadSetupFile, { ic: 'undo' }),
          button('Save setup file', saveSetupFile, { kind: 'primary', ic: 'backups' }))),
      h('div', { style: { marginBottom: '16px' } }, weeklyCard()),
      h('div', { class: 'grid three' }, ...Object.entries(groups).map(([id, list]) => card([icon(id), h('h2', {}, devices[id]?.adapter.title || id), h('span', { class: 'spacer' }), pill(`${list.length}`)],
        list.length ? h('div', { class: 'files' }, ...list.slice(0, 30).map((f) => h('div', { class: 'file', style: { '--cc': `var(--c-${id})` } }, icon(id),
          h('div', {}, new Date(f.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }), h('small', {}, `${(f.size / 1024).toFixed(1)} KB`)),
          button('', () => view(f), { kind: 'ghost small', ic: 'search', title: 'View' }),
          button('', () => restore(f), { kind: 'ghost small', ic: 'undo', title: 'Restore' }))))
          : h('div', { class: 'feed-empty' }, 'No backups yet. One is made before the first change.')))),
      h('p', { class: 'faint', style: { marginTop: '18px', fontSize: '12.5px' } }, 'Stored in DeviceHub\\backups.'));
  },
};
