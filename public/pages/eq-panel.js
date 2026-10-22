// HS80 equalizer editor. With Equalizer APO installed (engine 'eqapo', helpers/eqapo.js) DeviceHub runs the EQ
// itself: a preset plays as soon as it is picked, slider moves play as they are made, and nothing needs iCUE.
// Without it, the EQ runs through iCUE's preset file; saving backs up the file, restarts iCUE and reads it back.
import { h, icon } from '../ui/dom.js';
import { card, button, pill, toggle, slider, row, segmented } from '../ui/controls.js';
import { speakerSection } from './speakers.js';
import { isDemo } from '../core/devices.js';
import { env } from '../core/env.js';
import { modal, promptText, toast } from '../ui/overlay.js';
import { installerButton } from '../ui/installer-button.js';

const BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const DEMO_EQ = () => ({ available: true, icueRunning: true, slots: [{ slot: 2, id: 'c1' }], presets: [
  { id: 'c1', name: 'Custom Preset 1', stages: [6.7, 3.8, 2.2, 0.7, -1.2, -1.2, 0, 2.2, 5.1, 7.3], builtIn: false },
  { id: 'b1', name: 'Pure Direct', stages: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], builtIn: true },
  { id: 'b2', name: 'FPS Competition', stages: [-2, -2, 1, 2, 1, 2, 4, 5, 2, 4], builtIn: true },
  { id: 'b3', name: 'Bass Boost', stages: [4, 6, 4, 0, -3, -3, -2, 1, 2, 2], builtIn: true }] });

const ui = { eq: null, sel: null, draft: null, loading: false, saving: false, error: null, focus: null, at: 0, target: 'headset' };
let rerender = () => {};

async function load() {
  if (ui.loading) return;
  ui.loading = true; ui.at = Date.now();
  try {
    const next = isDemo() ? (ui.eq || DEMO_EQ()) : await env.api('/api/eq');
    // nothing changed: no redraw (the 10 s re-read must not touch the page)
    if (ui.eq && !ui.error && JSON.stringify(next) === JSON.stringify(ui.eq)) { ui.loading = false; return; }
    ui.eq = next;
    ui.error = null;
    if (next.unsaved && !ui.draft && !isDemo()) env.api('/api/eq/preview', { stages: null }).catch(() => {});
    if (ui.eq.available && !ui.eq.presets.some((p) => p.id === ui.sel)) {
      const inUse = ui.eq.engine === 'eqapo' ? ui.eq.activeId : ui.eq.slots?.find((s) => s.slot === 2)?.id;
      ui.sel = (ui.eq.presets.find((p) => p.id === inUse) || ui.eq.presets[0]).id;
      ui.draft = null;
    }
  } catch (e) { ui.error = e.message; }
  ui.loading = false;
  rerender();
}

const selected = () => ui.eq?.presets.find((p) => p.id === ui.sel);
const draftStages = () => ui.draft || selected()?.stages || [];
const dirty = () => !!ui.draft && ui.draft.some((v, i) => Math.abs(v - selected().stages[i]) > 0.001);
const APO = () => ui.eq?.engine === 'eqapo';
// Equalizer APO: what the sliders show plays at once (a short wait so a drag sends a few writes, not hundreds)
let previewTimer = null;
function preview() {
  if (!APO() || isDemo()) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => env.api('/api/eq/preview', { stages: dirty() ? draftStages() : null, name: selected()?.name })
    .then((r) => { if (r.curve) { ui.eq.curve = r.curve; drawCurve(); } })
    .catch((e) => toast('EQ not applied', 'bad', { detail: e.message })), 60);
}
// The headset's whole sound curve (the preset plus the correction and extra filters): what you hear, -15 to +15 dB.
const CW = 600, CH = 130, LO = Math.log10(20), HI = Math.log10(20000);
const cx = (f) => ((Math.log10(f) - LO) / (HI - LO)) * CW, cy = (db) => CH / 2 - (Math.max(-15, Math.min(15, db)) / 15) * (CH / 2 - 6);
function curveSvg() {
  const c = ui.eq.curve; if (!c) return '';
  const pts = c.hz.map((f, i) => `${cx(f).toFixed(1)},${cy(c.db[i]).toFixed(1)}`).join(' ');
  const grid = [100, 1000, 10000].map((f) => `<line class="bc-grid" x1="${cx(f)}" x2="${cx(f)}" y1="0" y2="${CH}"/><text class="bc-axis" x="${cx(f) + 4}" y="${CH - 4}">${f >= 1000 ? `${f / 1000}k` : f} Hz</text>`).join('');
  const db = [12, 6, -6, -12].map((d) => `<line class="bc-grid" x1="0" x2="${CW}" y1="${cy(d)}" y2="${cy(d)}" stroke-dasharray="2 4"/><text class="bc-axis" x="4" y="${cy(d) - 3}">${d > 0 ? '+' : ''}${d}</text>`).join('');
  return `${grid}${db}<line class="bc-cross" x1="0" x2="${CW}" y1="${cy(0)}" y2="${cy(0)}"/><polyline class="eq-curve" points="${pts}"/>`;
}
function drawCurve() { const el = document.getElementById('eq-curve'); if (el) el.innerHTML = curveSvg(); }
function curveBox() {
  if (!APO() || !ui.eq.curve) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'eq-curve'); svg.setAttribute('class', 'eq-curve-box'); svg.setAttribute('viewBox', `0 0 ${CW} ${CH}`);
  svg.innerHTML = curveSvg();
  return h('div', { class: 'eq-curve-wrap', title: 'What you hear: the preset plus the HS80 correction and extra filters' }, svg);
}

async function activate(id) {
  if (isDemo()) { ui.eq.activeId = id; rerender(); return; }
  try { ui.eq = await env.api('/api/eq/activate', { id }); ui.at = Date.now(); rerender(); } catch (e) { toast('Preset not applied', 'bad', { detail: e.message }); }
}

async function persist(presets, what) {
  if (APO() && !isDemo()) {
    ui.saving = true; rerender();
    try { ui.eq = await env.api('/api/eq/save', { presets: presets.map(({ id, name, stages }) => ({ id, name, stages })), activeId: ui.sel }); ui.at = Date.now(); ui.draft = null; toast(what, 'good'); return true; }
    catch (e) { toast('Equalizer not saved', 'bad', { detail: e.message }); return false; } finally { ui.saving = false; rerender(); }
  }
  if (isDemo()) { ui.eq.presets = presets.map((p) => ({ ...p, id: p.id || `d${Math.random().toString(36).slice(2, 8)}`, builtIn: !!ui.eq.presets.find((x) => x.id === p.id)?.builtIn })); ui.draft = null; toast(`${what} (demo)`, 'good'); rerender(); return true; }
  const ok = await modal('Save to iCUE?', h('p', { style: { margin: 0 } }, `${what}. iCUE closes and opens again to load it (about 10 seconds). Your current presets are backed up first.`),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save and restart iCUE', value: true, kind: 'primary' }]);
  if (!ok) return false;
  ui.saving = true; rerender();
  const t = toast('Saving the equalizer…', 'busy', { ms: 0, detail: 'Backing up, restarting iCUE, checking' });
  try {
    const r = await env.api('/api/eq/save', { presets: presets.map(({ id, name, stages }) => ({ id, name, stages })) });
    ui.eq.presets = r.presets; ui.draft = null;
    t.update(`${what}`, 'good', r.restartedIcue ? 'iCUE restarted and loaded it' : 'Saved; iCUE loads it next time it starts');
    return true;
  } catch (e) { t.update('Equalizer not saved', 'bad', e.message); return false; } finally { ui.saving = false; load(); }
}

// Each band: drag the slider or type the value in the box above it (-12 to +12 dB, to a tenth; Enter or leaving the
// box applies it, Esc puts the old value back, the arrow keys step by 0.5).
const fmtBox = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
function bandSlider(i, value, disabled) {
  const input = h('input', { type: 'range', min: -12, max: 12, step: 0.5, value, disabled, 'aria-label': `${BANDS[i]} Hz` });
  const box = h('input', { class: 'eq-val', type: 'text', inputmode: 'decimal', value: fmtBox(value), disabled, title: `${BANDS[i]} Hz in dB`, 'aria-label': `${BANDS[i]} Hz, dB` });
  const set = (v) => { ui.draft = [...draftStages()]; ui.draft[i] = v; };
  input.addEventListener('input', () => { box.value = fmtBox(Number(input.value)); set(Number(input.value)); preview(); });
  input.addEventListener('change', () => rerender());
  const commit = (keep = false) => {
    const v = Number(box.value.trim().replace(/^\+/, '').replace(',', '.').replace(/\s*db$/i, ''));
    if (box.value.trim() === '' || !Number.isFinite(v)) { box.value = fmtBox(draftStages()[i]); return; }
    const c = Math.max(-12, Math.min(12, Math.round(v * 10) / 10));
    if (Math.abs(c - draftStages()[i]) < 0.001) { box.value = fmtBox(c); return; }
    set(c); preview(); if (keep) ui.focus = i; rerender();
  };
  box.addEventListener('change', () => commit());
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { box.value = fmtBox(draftStages()[i]); box.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); box.value = fmtBox(Math.max(-12, Math.min(12, Math.round((draftStages()[i] + (e.key === 'ArrowUp' ? .5 : -.5)) * 10) / 10))); commit(true); }
  });
  box.addEventListener('focus', () => box.select());
  // keep typing in the same box after the page redraws
  if (ui.focus === i) { ui.focus = null; requestAnimationFrame(() => { box.focus(); }); }
  return h('div', { class: 'eq-band' }, box, input, h('span', {}, BANDS[i]));
}

// While the Equalizer is on screen, read the presets again every 10 s and when the window comes back to the front
// (a preset added elsewhere shows up without a page change); never while a change is unsaved or a box is being typed in
let watching = false;
// a slider is being dragged (anywhere in the Equalizer): no redraw until it is let go
let held = false;
addEventListener('pointerdown', (e) => { if (e.target?.matches?.('.eq-band input[type=range]')) held = true; }, true);
addEventListener('pointerup', () => { held = false; }, true);
function refreshSoon() {
  // an error (DeviceHub restarting, "Failed to fetch") is retried too, so the card never stays stuck on it
  if ((!document.querySelector('.eq-bands') && !ui.error) || ui.loading || ui.saving || dirty() || document.activeElement?.classList.contains('eq-val') || held) return;
  load();
}
function watch() {
  if (watching) return; watching = true;
  setInterval(refreshSoon, 10000);
  setInterval(() => { if (ui.error) refreshSoon(); }, 2000);  // errors are retried every 2 s
  window.addEventListener('focus', refreshSoon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSoon(); });
}

export function eqPanel(redraw) {
  rerender = redraw;
  if (!isDemo()) watch();
  // read iCUE's presets again when the page is drawn and the list is older than 15 s (a preset added in iCUE or by
  // DeviceHub shows up), never while a change is unsaved or saving
  if (!ui.loading && !ui.saving && !dirty() && (!ui.eq ? !ui.error : Date.now() - ui.at > 15000)) load();
  const head = [h('h2', {}, 'Equalizer'), APO() || !ui.eq?.available ? null : h('span', { class: 'sub' }, 'runs through iCUE')];
  if (ui.error) return card(head, h('p', { class: 'faint' }, /fetch/i.test(ui.error) ? 'Couldn\'t reach DeviceHub for a moment; trying again by itself.' : `Could not read the equalizer: ${ui.error}`), button('Try again', () => load(), { kind: 'ghost small', ic: 'refresh' }));
  if (!ui.eq) return card(head, h('p', { class: 'faint' }, 'Reading the equalizer…'));
  // no Equalizer APO on this PC (20 Oct 2026): what it is for and the official download, in place of iCUE's message
  if (!ui.eq.available && ui.eq.needsApo) return card(head,
    h('p', { class: 'faint' }, 'The EQ, Natural sound, mic boost and mic filters need Equalizer APO, a free sound add-on for Windows.'),
    h('p', { class: 'faint' }, 'Install it, tick your headset when its installer asks, then restart the PC.'),
    // its button (22 Oct 2026, ui/installer-button.js): the official download in DeviceHub's own dialog, installed when
    // it can be checked, else the official page
    h('div', { class: 'actions' }, installerButton('eqapo', { onDone: () => load(), redraw: () => rerender() }),
      button('Check again', () => load(), { kind: 'ghost small', ic: 'refresh' })));
  if (!ui.eq.available) return card(head, h('p', { class: 'faint' }, ui.eq.reason));
  const p = selected();
  const stages = draftStages();
  const inUse = new Set(APO() ? [ui.eq.activeId] : (ui.eq.slots || []).map((s) => s.id));
  // Headset | each monitor: which sound this card edits (the monitors' own EQ, separate from the headset's presets)
  const targets = APO() ? [{ value: 'headset', label: 'Headset' }, ...(ui.eq.speakers || []).map((sp) => ({ value: sp.guid, label: sp.name }))] : [];
  if (!targets.some((t) => t.value === ui.target)) ui.target = 'headset';
  const pick = targets.length > 1 ? segmented({ value: ui.target, options: targets, compact: true, onCommit: async (v) => { ui.target = v; rerender(); } }) : null;
  if (ui.target !== 'headset') return card([...head, h('span', { class: 'spacer' }), pick], speakerSection(ui.target, rerender));
  return card([...head, h('span', { class: 'spacer' }), APO() || ui.eq.icueRunning ? null : pill('iCUE closed', 'warn'), pick],
    // Equalizer APO installed but not switched on for the headset's sound devices (a new driver gives new ones)
    ui.eq.notOn?.length ? h('div', { class: 'eq-off' }, icon('shield'),
      h('span', { class: 'grow' }, `Not on for ${[...new Set(ui.eq.notOn.map((d) => d.name))].join(' and ')} yet, so the EQ is not heard. Turn it on, tick ${ui.eq.notOn.length > 1 ? 'them' : 'it'}, click OK, then restart the PC.`),
      button('Turn on', async () => { try { await env.api('/api/eq/turn-on', {}); toast('Equalizer APO\'s device list is open', 'good', { detail: 'Tick the headset, click OK, then restart the PC.' }); } catch (e) { toast('Not opened', 'bad', { detail: e.message }); } }, { kind: 'primary small' })) : null,
    h('div', { class: 'eq-layout' },
      h('div', { class: 'eq-presets' }, ...[...ui.eq.presets.filter((q) => !q.builtIn), ...ui.eq.presets.filter((q) => q.builtIn)].map((x) => h('button', { class: `eq-preset${x.id === ui.sel ? ' sel' : ''}`, disabled: ui.saving, onclick: () => { if (x.id === ui.sel && (!APO() || ui.eq.activeId === x.id)) return; ui.sel = x.id; ui.draft = null; if (APO()) activate(x.id); rerender(); } },
        h('span', {}, x.name), x.builtIn ? h('small', {}, 'built-in') : null, inUse.has(x.id) ? h('small', { class: 'inuse' }, 'in use') : null))),
      h('div', {},
        h('div', { class: 'eq-bands' }, ...stages.map((v, i) => bandSlider(i, v, p.builtIn || ui.saving))),
        curveBox(),
        h('div', { class: 'actions', style: { marginTop: '14px', alignItems: 'center' } },
          p.builtIn ? h('span', { class: 'locked' }, icon('shield'), 'built-in preset: copy it to change it') : null,
          !p.builtIn ? button(APO() ? 'Save' : 'Save to iCUE', () => persist(ui.eq.presets.map((x) => (x.id === p.id ? { ...x, stages: draftStages() } : x)), `"${p.name}" saved`), { kind: 'primary small', disabled: !dirty() || ui.saving }) : null,
          dirty() ? button('Undo changes', async () => { ui.draft = null; preview(); rerender(); }, { kind: 'ghost small', ic: 'undo' }) : null,
          !p.builtIn ? button('Rename…', async () => {
            const name = await promptText('Rename preset', 'Preset name', p.name);
            if (!name || name === p.name) return;
            if (ui.eq.presets.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) { toast('That name is taken', 'bad'); return; }
            await persist(ui.eq.presets.map((x) => (x.id === p.id ? { ...x, name: name.slice(0, 40), stages: x.stages } : x)), `Renamed to "${name.slice(0, 40)}"`);
          }, { kind: 'ghost small', disabled: ui.saving || dirty() }) : null,
          button('Save as new preset…', async () => {
            const name = await promptText('New EQ preset', 'Preset name, e.g. "Footsteps"');
            if (!name) return;
            const ok = await persist([...ui.eq.presets, { id: null, name, stages: draftStages() }], `"${name}" added`);
            const made = ok && APO() && ui.eq.presets.find((x) => x.name === name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40));
            if (made) { ui.sel = made.id; await activate(made.id); }
          }, { kind: 'ghost small', ic: 'plus', disabled: ui.saving }),
          !p.builtIn && !inUse.has(p.id) ? button('Delete', async () => {
            if (!(await modal(`Delete "${p.name}"?`, APO() ? 'The preset is removed.' : 'The preset is removed from iCUE.', [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Delete', value: true, kind: 'danger' }]))) return;
            await persist(ui.eq.presets.filter((x) => x.id !== p.id), `"${p.name}" deleted`);
          }, { kind: 'ghost small', ic: 'trash', disabled: ui.saving }) : null),
        APO() ? h('div', { class: 'srow', style: { marginTop: '10px' } },
          h('div', {}, h('div', { class: 'srow-title' }, 'Prevent distortion'), h('div', { class: 'srow-desc' }, 'Stops loud sounds from crackling. Slightly quieter.')),
          h('div', { class: 'srow-ctl' }, toggle({ value: ui.eq.headroom, label: 'Prevent distortion', onCommit: async (on) => { try { ui.eq = await env.api('/api/eq/headroom', { on }); rerender(); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); } } })))
          : h('p', { class: 'faint', style: { fontSize: '12.5px', marginBottom: 0 } }, 'Pick which preset is active in iCUE (or with a short press on the headset\'s volume wheel). Saving restarts iCUE for about 10 seconds.'))));
}

// ---- Sound tools (Equalizer APO only): the HS80 correction, extra filters, loudness, balance, the mic,
// and the other speakers' EQ. Every change is written at once (helpers/eqapo.js setExtras).
async function setExtras(change) {
  if (isDemo()) { Object.assign(ui.eq.extras, change); rerender(); return; }
  try { ui.eq = await env.api('/api/eq/extras', change); ui.at = Date.now(); rerender(); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); }
}
const num = (v, w, onSet, title) => {
  const el = h('input', { class: 'text eq-num', type: 'text', inputmode: 'decimal', value: String(v), title, style: { width: w } });
  el.addEventListener('change', () => onSet(Number(el.value.replace(',', '.').replace(/[^0-9.+-]/g, ''))));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  return el;
};
function filterRows(x) {
  const list = x.filters;
  const put = (i, k, v) => { const next = list.map((f) => ({ ...f })); next[i][k] = v; setExtras({ filters: next }); };
  return h('div', { class: 'eq-filters' },
    ...list.map((f, i) => h('div', { class: 'eq-filter' },
      num(f.f, '84px', (v) => put(i, 'f', v), 'Frequency, 20 to 20000 Hz'), h('span', { class: 'faint' }, 'Hz'),
      num(f.g, '64px', (v) => put(i, 'g', v), 'Gain, -12 to +12 dB'), h('span', { class: 'faint' }, 'dB'),
      num(f.q, '58px', (v) => put(i, 'q', v), 'Width (Q): small is wide, large is narrow, 0.1 to 10'), h('span', { class: 'faint' }, 'Q'),
      button('', () => setExtras({ filters: list.filter((_, j) => j !== i) }), { kind: 'ghost small', ic: 'trash', title: 'Remove this filter' }))),
    button('Add a filter', () => setExtras({ filters: [...list, { f: 1000, g: 0, q: 1.41 }] }), { kind: 'ghost small', ic: 'plus', disabled: list.length >= 20 }));
}
const balanceText = (v) => (v === 0 ? 'Centered' : v > 0 ? `Right +${v} dB` : `Left +${-v} dB`);

export function soundTools() {
  if (!APO() || !ui.eq?.extras) return null;
  const x = ui.eq.extras;
  return card([h('h2', {}, 'Sound tools')],
    // AutoEq's measurement of the HS80: offered for an HS80 only (another headset would need its own measurement)
    !ui.eq.headsetModel || ui.eq.headsetModel === 'HS80' ? row('Natural sound', 'Evens out the HS80\'s tuning. Best with Pure Direct.',
      toggle({ value: x.correction, label: 'Natural sound', onCommit: (on) => setExtras({ correction: on }) })) : null,
    row('Extra filters', 'Fine-tune any frequency.', null),
    filterRows(x),
    row('Loudness boost', 'Fuller sound when quiet.',
      toggle({ value: x.loudness, label: 'Loudness boost', onCommit: (on) => setExtras({ loudness: on }) })),
    row('Balance', 'Louder left or right.',
      slider({ value: x.balance, min: -12, max: 12, step: 0.5, format: balanceText, live: isDemo() ? null : (v) => env.api('/api/eq/extras', { balance: v }).catch(() => {}), onCommit: (v) => setExtras({ balance: v }) })),
    h('h3', { class: 'eq-sub' }, 'Mic'),
    ui.eq.micFound ? null : h('p', { class: 'faint', style: { margin: '0 0 6px' } }, 'Headset mic not connected.'),
    row('Cut rumble', 'Removes hum and bumps.',
      toggle({ value: x.micRumble, label: 'Cut rumble', onCommit: (on) => setExtras({ micRumble: on }) })),
    row('Voice clarity', 'Easier to understand.',
      toggle({ value: x.micClarity, label: 'Voice clarity', onCommit: (on) => setExtras({ micClarity: on }) })),
    row('Smooth highs', 'Tames hiss and sharp sounds.',
      toggle({ value: !!x.micDeEss, label: 'Smooth highs', onCommit: (on) => setExtras({ micDeEss: on }) })),
    row('Even volume', ui.eq.levelerAvailable ? 'Evens out loud and quiet. Turn off Discord\'s auto gain.' : 'Needs ReaPlugs installed.',
      toggle({ value: !!x.micLevel && ui.eq.levelerAvailable, disabled: !ui.eq.levelerAvailable, label: 'Even volume', onCommit: (on) => setExtras({ micLevel: on }) })),
    h('p', { class: 'faint', style: { fontSize: '12.5px', margin: '12px 0 0' } }, 'Monitors and the camera mic: pick them at the top of the Equalizer.'));
}
