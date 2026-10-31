// The Profiles page's Game mode card (27 Oct 2026, Shawn; helpers/game-mode.mjs): per game, only what the person picks
// changes while it runs (DPI, polling rate, lights, EQ, HDR, notifications; each "Keep as is" until picked), and when
// it quits everything goes back as it was. Each change here is saved at once; no pop-ups, one short line says what
// happened. Games come from the installed list (Steam, Epic, Riot) or an open program.
import { h, icon } from '../ui/dom.js';
import { card, button, dropdown, COLOR_SWATCHES } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo, remoteAuto } from '../core/devices.js';
import { runningWindows } from '../core/autoswitch.js';
import { snapDpi } from '../devices/pulsar.js';

const KEEP = '';
const POLLS = [125, 250, 500, 1000, 2000, 4000, 8000];
const st = { games: null, status: null, installed: null, apps: null, eq: null, screens: null, picking: false, typed: '', note: {}, error: '' };
let redrawFn = () => {};
const redraw = () => redrawFn();

async function load() {
  if (isDemo()) { st.games = []; st.installed = []; st.eq = []; st.screens = []; return redraw(); }
  try { const r = await env.api('/api/game-mode'); st.games = r.games || []; st.status = r.status; } catch (e) { st.games = []; st.error = e.message; }
  redraw();
  try { const r = await env.api('/api/eq'); st.eq = r.engine === 'eqapo' ? (r.presets || []).map((p) => ({ id: p.id, name: p.name })) : []; } catch { st.eq = []; }
  try { st.screens = (await env.api('/api/game-mode/now')).screens || []; } catch { st.screens = []; }
  redraw();
}
async function save(note) {
  try {
    const r = await env.api('/api/game-mode', { games: st.games });
    st.games = r.games; st.status = r.status; st.error = '';
    if (note) st.note = note;
  } catch (e) { st.error = `Not saved: ${e.message}`; }
  redraw();
}
const setSwitch = (g, k, v) => {
  if (v === undefined || v === null || v === KEEP) delete g.setup[k]; else g.setup[k] = v;
  save({ [g.id]: 'Saved' });
};

// "Use now's settings": what each switch is set to now
async function useNow(g) {
  let n;
  try { n = await env.api('/api/game-mode/now'); } catch (e) { st.note = { [g.id]: `Could not read: ${e.message}` }; return redraw(); }
  const s = {};
  if (n.dpi) s.dpi = n.dpi;
  if (n.polling) s.polling = n.polling;
  if (n.lights) s.lights = n.lights;
  if (n.eq) s.eq = n.eq;
  const scr = (n.screens || []).find((x) => g.setup.hdr && (x.id === g.setup.hdr.id || x.screen === g.setup.hdr.screen)) || (n.screens || [])[0];
  if (scr) s.hdr = { id: scr.id, screen: scr.screen, name: scr.name, on: scr.on };
  if (n.quiet === true) s.quiet = true;
  g.setup = s;
  st.screens = n.screens || st.screens;
  await save({ [g.id]: Object.keys(s).length ? 'Filled from now' : 'Nothing to fill from now' });
}

async function openPicker() {
  st.picking = true; st.typed = ''; redraw();
  if (!st.installed) { try { st.installed = await env.api('/api/game-mode/installed'); } catch { st.installed = []; } }
  st.apps = (await runningWindows()).filter((a) => !/^(DeviceHub|explorer|ApplicationFrameHost|TextInputHost|SystemSettings)/i.test(a.exe) && !/DeviceHub/.test(a.title));
  redraw();
}
function addGame(name, exes, source) {
  exes = exes.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean).map((x) => (/\.exe$/.test(x) ? x : `${x}.exe`));
  if (!exes.length) return;
  st.picking = false;
  st.games = [...st.games, { id: `g${Date.now().toString(36)}`, name: String(name || exes[0].replace(/\.exe$/, '')).slice(0, 60), exes, setup: {}, ...(source ? { source } : {}) }];
  save();
}
const removeGame = (g) => { st.games = st.games.filter((x) => x !== g); save(); };

// ---------- one game's switches ----------
const pick = (label, value, options, onChange) => h('div', { class: 'srow' },
  h('div', { class: 'srow-text' }, h('div', { class: 'srow-title' }, label)),
  h('div', { class: 'srow-ctl' }, dropdown({ options: [{ value: KEEP, label: 'Keep as is' }, ...options], value: value ?? KEEP, label: `${label}`, onChange })));

function dpiRow(g) {
  const box = h('input', { class: 'text mono', style: { width: '110px' }, inputmode: 'numeric', placeholder: 'Keep as is', value: g.setup.dpi ?? '', 'aria-label': 'DPI',
    onchange: (e) => { const t = e.target.value.trim(); if (!t) return setSwitch(g, 'dpi', KEEP); const n = Number(t); if (!Number.isFinite(n)) { e.target.value = g.setup.dpi ?? ''; return; } setSwitch(g, 'dpi', snapDpi(n)); },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
  return h('div', { class: 'srow' }, h('div', { class: 'srow-text' }, h('div', { class: 'srow-title' }, 'DPI'), h('div', { class: 'srow-desc' }, 'The DPI stage in use')), h('div', { class: 'srow-ctl' }, box));
}
function lightOptions(cur) {
  const list = [{ value: '#000000', label: 'Off' }, ...COLOR_SWATCHES.map(([hex, name]) => ({ value: hex, label: name }))];
  if (cur && !list.some((o) => o.value === cur)) list.push({ value: cur, label: cur.toUpperCase() });
  return list;
}
function hdrOptions(g) {
  const list = [];
  const screens = [...(st.screens || [])];
  if (g.setup.hdr && !screens.some((s) => s.id === g.setup.hdr.id || s.screen === g.setup.hdr.screen)) screens.push(g.setup.hdr);
  for (const s of screens) for (const on of [true, false]) list.push({ value: JSON.stringify({ id: s.id || '', screen: s.screen, name: s.name || s.screen, on }), label: `${s.name || s.screen}: ${on ? 'on' : 'off'}` });
  return list;
}
function gameBlock(g) {
  const s = g.setup;
  const hdrVal = s.hdr ? hdrOptions(g).find((o) => { const v = JSON.parse(o.value); return (v.id === s.hdr.id || v.screen === s.hdr.screen) && v.on === s.hdr.on; })?.value : KEEP;
  const eqOpts = (st.eq || []).map((p) => ({ value: p.id, label: p.name }));
  if (s.eq && !eqOpts.some((o) => o.value === s.eq)) eqOpts.push({ value: s.eq, label: 'A preset that is gone' });
  const running = st.status?.active?.id === g.id;
  return h('div', { class: 'gm-game', style: { borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '12px' } },
    h('div', { class: 'facts', style: { alignItems: 'center' } },
      h('b', {}, g.name), running ? h('span', { class: 'pill accent' }, 'On now') : null,
      h('span', { class: 'faint', style: { fontSize: '12px' } }, g.exes.slice(0, 2).join(', ') + (g.exes.length > 2 ? ` +${g.exes.length - 2}` : '')),
      h('span', { class: 'spacer' }),
      button('Remove', () => removeGame(g), { kind: 'ghost small' })),
    dpiRow(g),
    pick('Polling rate', s.polling, POLLS.map((p) => ({ value: p, label: `${p.toLocaleString('en-US')} Hz` })), (v) => setSwitch(g, 'polling', v ? Number(v) : KEEP)),
    pick('Lights', s.lights, lightOptions(s.lights), (v) => setSwitch(g, 'lights', v || KEEP)),
    eqOpts.length || s.eq ? pick('EQ', s.eq, eqOpts, (v) => setSwitch(g, 'eq', v || KEEP)) : null,
    hdrOptions(g).length ? pick('HDR', hdrVal, hdrOptions(g), (v) => setSwitch(g, 'hdr', v ? JSON.parse(v) : KEEP)) : null,
    pick('Notifications', s.quiet ? 'pause' : KEEP, [{ value: 'pause', label: 'Paused' }], (v) => setSwitch(g, 'quiet', v === 'pause' ? true : KEEP)),
    h('div', { class: 'actions' }, button("Use now's settings", () => useNow(g), { kind: 'small' }), st.note[g.id] ? h('span', { class: 'faint' }, st.note[g.id]) : null));
}

function picker() {
  const have = new Set((st.games || []).flatMap((g) => g.exes));
  const installed = (st.installed || []).filter((x) => !x.exes.every((e) => have.has(e)));
  const box = h('input', { class: 'text mono', value: st.typed, placeholder: 'or type its .exe name', 'aria-label': 'program name',
    oninput: (e) => { st.typed = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') addGame(null, [e.target.value]); if (e.key === 'Escape') { st.picking = false; redraw(); } } });
  return h('div', { class: 'prof-pick', style: { marginTop: '12px' } },
    h('div', { class: 'prof-label' }, 'Installed games'),
    st.installed == null ? h('div', { class: 'faint' }, 'Looking…')
      : installed.length ? h('div', { class: 'files prof-apps' }, ...installed.map((x) => h('button', { class: 'file prof-app', onclick: () => addGame(x.name, x.exes, x.source) }, h('div', {}, x.name, h('small', {}, x.source)), icon('plus'))))
        : h('div', { class: 'faint' }, 'None found.'),
    h('div', { class: 'prof-label' }, 'Open programs'),
    st.apps == null ? h('div', { class: 'faint' }, 'Looking…')
      : st.apps.length ? h('div', { class: 'files prof-apps' }, ...st.apps.map((a) => h('button', { class: 'file prof-app', onclick: () => addGame(a.title, [a.exe]) }, h('div', {}, a.title, h('small', {}, a.exe)), icon('plus'))))
        : h('div', { class: 'faint' }, 'No game open.'),
    box,
    h('div', { class: 'actions' }, button('Add', () => addGame(null, [st.typed]), { kind: 'primary small' }), button('Cancel', () => { st.picking = false; redraw(); }, { kind: 'ghost small' })));
}

// the one line for what is on now: from the live stream (core/devices.js remoteAuto.game), else the last read
export function gameModeLine() {
  const g = remoteAuto?.game || st.status;
  // putting back first (31 Oct 2026): the game stays "active" while its put-back waits, so it read "on" after it quit
  if (g?.restoring) return 'Putting settings back';
  if (g?.active?.name) return `${g.active.name} mode on`;
  return null;
}

export function gameModeCard(rerender) {
  redrawFn = rerender;
  if (st.games === null) { st.games = []; load(); }
  const line = gameModeLine();
  return card([h('h2', {}, 'Game mode'), h('span', { class: 'spacer' }), line ? h('span', { class: 'pill accent' }, line) : null],
    h('p', { class: 'faint', style: { margin: '0 0 4px' } }, 'Changes only what you pick while the game runs. Puts it all back when it quits.'),
    ...(st.games || []).map(gameBlock),
    st.error ? h('div', { class: 'bad', style: { marginTop: '8px' } }, st.error) : null,
    st.picking ? picker() : h('div', { class: 'actions', style: { marginTop: '12px' } }, button('Add a game', openPicker, { kind: 'small', ic: 'plus' })));
}
