// Profiles: save the current setup of all three devices, preview the difference, apply.
import { h, icon } from '../ui/dom.js';
import { button, pill, card, row, toggle } from '../ui/controls.js';
import { auto, saveSettings, runningWindows, onAuto } from '../core/autoswitch.js';
import { devices, isRemote, remoteAuto, isDemo } from '../core/devices.js';
import { env } from '../core/env.js';
import { topbar } from './common.js';
import { loadProfiles, saveProfiles, capture, diff, apply, keyLabel, showValue, PROFILE_COLORS, loadMonitors, monitorList, captureMonitors } from '../core/profiles.js';
import { modal, promptText, toast } from '../ui/overlay.js';

let list = null;
let rerender = () => {};
const refreshList = async () => { list = await loadProfiles(); rerender(); };
onAuto(() => rerender());

export async function applyWithPreview(p) {
  if (p.monitors) await loadMonitors(true);
  const rows = diff(p);
  if (!rows.length) { toast(`Already on "${p.name}"`, 'good', { detail: 'Every connected device already matches.' }); return; }
  const body = h('div', { class: 'diff' }, ...rows.map((r) => h('div', {},
    h('span', { class: 'dev' }, r.id === 'monitor' ? r.monitorName : devices[r.id].adapter.kind), h('span', {}, keyLabel(r.id, r.key)), h('s', {}, showValue(r.id, r.key, r.from)), icon('arrow', 'ic faint'), r.ready ? h('b', {}, showValue(r.id, r.key, r.to)) : h('span', { class: 'faint' }, 'not connected'))));
  const ok = await modal(`Apply "${p.name}"?`, h('div', {}, h('p', { style: { marginTop: 0 } }, `${rows.length} change${rows.length === 1 ? '' : 's'}. Each one is backed up, written and read back, one at a time.`), body),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Apply', value: true, kind: 'primary' }]);
  if (!ok) return;
  const t = toast(`Applying "${p.name}"…`, 'busy', { ms: 0 });
  const r = await apply(p);
  t.update(`"${p.name}" applied`, r.failed ? 'bad' : 'good', `${r.done} changed${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''}`);
}

async function saveCurrent(existing) {
  const snap = capture();
  await loadMonitors(true);
  const mons = captureMonitors();
  if (!Object.keys(snap).length && !Object.keys(mons).length) { toast('Connect a device first', 'bad', { detail: 'A profile stores what the connected devices are set to.' }); return; }
  const name = existing ? existing.name : await promptText('Save current setup', 'Profile name, e.g. "Valorant" or "Work"');
  if (!name) return;
  const others = (list || []).filter((p) => p.name !== name);
  const color = existing?.color || PROFILE_COLORS[others.length % PROFILE_COLORS.length];
  await saveProfiles([...others, { name, color, games: existing?.games || [], devices: snap, ...(Object.keys(mons).length ? { monitors: mons } : {}), savedAt: new Date().toISOString() }]);
  toast(existing ? `Updated "${name}"` : `Saved "${name}"`, 'good', { detail: [...Object.keys(snap).map((id) => devices[id].adapter.kind), ...(Object.keys(mons).length ? [`${Object.keys(mons).length} monitor${Object.keys(mons).length === 1 ? '' : 's'}`] : [])].join(' + ') });
  await refreshList();
}

async function updateProfile(p, patch) {
  await saveProfiles(list.map((x) => (x === p ? { ...x, ...patch } : x)));
  await refreshList();
}

async function addGame(p) {
  const apps = (await runningWindows()).filter((a) => !/^(DeviceHub|explorer|ApplicationFrameHost|TextInputHost|SystemSettings)/i.test(a.exe) && !/DeviceHub/.test(a.title));
  const manual = h('input', { class: 'text mono', placeholder: 'or type a program name, e.g. VALORANT-Win64-Shipping.exe', 'aria-label': 'program name' });
  let picked = null;
  const listEl = h('div', { class: 'files', style: { maxHeight: '300px', overflowY: 'auto', margin: '10px 0' } },
    ...(apps.length ? apps.map((a) => h('button', { class: 'file', style: { gridTemplateColumns: '1fr auto', textAlign: 'left', color: 'var(--text)', cursor: 'pointer' }, onclick: (e) => {
      picked = a.exe; manual.value = a.exe; listEl.querySelectorAll('.file').forEach((f) => { f.style.borderColor = ''; }); e.currentTarget.style.borderColor = 'var(--accent)';
    } }, h('div', {}, a.title, h('small', {}, a.exe)), icon('plus'))) : [h('div', { class: 'faint' }, 'Start the game first, then open this again, or type its .exe name below.')]));
  const ok = await modal(`Which game switches to "${p.name}"?`, h('div', {}, h('p', { style: { margin: 0 } }, 'Programs with a window open right now:'), listEl, manual),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Add', value: true, kind: 'primary' }]);
  const exe = (manual.value || picked || '').trim();
  if (!ok || !exe) return;
  const name = /\.exe$/i.test(exe) ? exe : `${exe}.exe`;
  await updateProfile(p, { games: [...new Set([...(p.games || []), name])] });
  toast(`"${p.name}" now follows ${name}`, 'good', { detail: auto.settings.autoSwitch ? 'Auto-switch is on.' : 'Turn on auto-switch at the top of the page.' });
}

const activeName = () => (isRemote() ? remoteAuto?.active : auto.active);

function autoPanel() {
  const s = auto.settings;
  const watched = (list || []).flatMap((p) => p.games || []);
  return card([icon('bolt'), h('h2', {}, 'Auto-switch'), h('span', { class: 'sub' }, s.autoSwitch ? `watching ${watched.length} game${watched.length === 1 ? '' : 's'}${activeName() ? ` · now on "${activeName()}"` : ''}` : 'off'),
    h('span', { class: 'spacer' }), toggle({ value: !!s.autoSwitch, label: 'auto-switch', onCommit: async (on) => { await saveSettings({ autoSwitch: on }); toast(on ? 'Auto-switch on' : 'Auto-switch off', 'good', { detail: on ? 'Checked every 5 seconds while DeviceHub is open.' : null }); rerender(); } })],
    row('When no game is running', null,
      h('select', { class: 'text', style: { width: '220px' }, 'aria-label': 'default profile', onchange: async (e) => { await saveSettings({ defaultProfile: e.target.value }); } },
        h('option', { value: '' }, 'Leave as is'), ...(list || []).map((p) => h('option', { value: p.name, selected: p.name === s.defaultProfile ? true : null }, p.name)))));
}

function profileCard(p, i) {
  const counts = [...Object.entries(p.devices || {}).map(([id, v]) => pill(`${devices[id]?.adapter.kind || id} · ${Object.keys(v).length}`)),
    ...Object.values(p.monitors || {}).map((v) => pill(`${v.name || 'Monitor'} · ${Object.keys(v).filter((k) => k !== 'name').length}`))];
  const pending = diff(p).length;
  return h('div', { class: 'profile', style: { '--pc': p.color } },
    h('div', { class: 'actions', style: { justifyContent: 'space-between', alignItems: 'center' } }, h('h3', {}, p.name), pending ? pill(`${pending} differ`, 'accent') : pill('active', 'good')),
    h('div', { class: 'facts' }, ...counts),
    h('div', { class: 'facts', style: { alignItems: 'center' } }, icon('play', 'ic faint'),
      ...(p.games || []).map((g) => h('button', { class: 'pill accent', title: 'Remove', style: { cursor: 'pointer', background: 'none' }, onclick: () => updateProfile(p, { games: p.games.filter((x) => x !== g) }) }, g === '*games*' ? 'any game' : g.replace(/\.exe$/i, ''), ' ×')),
      h('button', { class: 'pill', style: { cursor: 'pointer', background: 'none' }, onclick: () => addGame(p) }, (p.games || []).length ? '+ game' : '+ switch when a game starts')),
    h('div', { class: 'faint', style: { fontSize: '12px', display: 'flex', gap: '10px', alignItems: 'center' } },

      p.savedAt ? `saved ${new Date(p.savedAt).toLocaleString()}` : ''),
    h('div', { class: 'actions' },
      button('Apply', () => applyWithPreview(p), { kind: 'primary small', ic: 'play' }),
      button('Update', () => saveCurrent(p), { kind: 'ghost small', title: 'Replace with the current setup' }),
      button('', async () => {
        if (!(await modal(`Delete "${p.name}"?`, 'The profile is removed. Your devices are not changed.', [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Delete', value: true, kind: 'danger' }]))) return;
        await saveProfiles(list.filter((x) => x !== p)); await refreshList();
      }, { kind: 'ghost small', ic: 'trash', title: 'Delete' })));
}

export default {
  id: 'profiles', title: 'Profiles', icon: 'profiles', accent: 'var(--signal)',
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/profiles') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (!list) refreshList();
    if (!monitorList() && !isDemo()) loadMonitors(false).then(() => rerender());

    return h('div', {},
      topbar('Setups', 'Profiles', 'Switch every device at once.'),
      h('div', { style: { marginBottom: '18px' } }, autoPanel()),
      h('div', { class: 'profiles' },
        ...(list || []).map((p, i) => profileCard(p, i)),
        h('button', { class: 'profile new', onclick: () => saveCurrent() }, h('div', { style: { display: 'grid', justifyItems: 'center', gap: '8px' } }, icon('plus'), h('b', {}, 'Save current setup'), h('span', { class: 'faint', style: { fontSize: '12.5px' } }, 'from every connected device')))));
  },
};
