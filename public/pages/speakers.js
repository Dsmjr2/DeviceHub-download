// One built-in speaker's own EQ (the monitors), shown in the Headset page's Equalizer card when that speaker is picked
// at its top (Shawn, 19 Oct 2026: "a small breakup ... to show my headset vs monitor speakers"). Separate from the
// headset's presets. Runs through Equalizer APO (helpers/eqapo.js); a change plays at once.
import { h } from '../ui/dom.js';
import { button, toggle } from '../ui/controls.js';
import { isDemo } from '../core/devices.js';
import { env } from '../core/env.js';
import { toast } from '../ui/overlay.js';

const BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const DEMO = () => ({ engine: 'eqapo', speakerStarts: { 'Small monitor speakers': [-12, -10, -3, 2, 0, -1.5, 1, 1.5, 1, -1], Flat: Array(10).fill(0) },
  speakers: [{ guid: 'd1', name: 'IPS', on: true, stages: [-12, -10, -3, 2, 0, -1.5, 1, 1.5, 1, -1] }, { guid: 'd2', name: 'OLED', on: false, stages: Array(10).fill(0) }] });
let eq = null, loading = false, error = null, guard = null, at = 0;  // guard: settings.json ankerGuard (off unless true)
let rerender = () => {};
const drafts = {};  // guid -> stages being dragged
addEventListener('pointerup', () => { for (const g of Object.keys(drafts)) delete drafts[g]; }, true);

async function load() {
  if (loading) return; loading = true; at = Date.now();
  try {
    eq = isDemo() ? (eq || DEMO()) : await env.api('/api/eq'); error = null;
    if (!isDemo()) guard = (await env.api('/api/settings')).ankerGuard === true;
  } catch (e) { error = e.message; }
  loading = false; rerender();
}
async function put(guid, change, quiet) {
  if (isDemo()) { const sp = eq.speakers.find((x) => x.guid === guid); Object.assign(sp, change); if (!quiet) rerender(); return; }
  try {
    const r = await env.api('/api/eq/extras', { speaker: { guid, ...change } });
    eq = r; if (quiet) drawCurve(guid); else rerender();
  } catch (e) { toast('Not changed', 'bad', { detail: e.message }); }
}

// the speaker's sound curve, -15 to +15 dB (same drawing as the headset's)
const CW = 600, CH = 130, LO = Math.log10(20), HI = Math.log10(20000);
const cx = (f) => ((Math.log10(f) - LO) / (HI - LO)) * CW, cy = (db) => CH / 2 - (Math.max(-15, Math.min(15, db)) / 15) * (CH / 2 - 6);
const HZ = Array.from({ length: 121 }, (_, i) => 20 * 1000 ** (i / 120));
function svgFor(sp) {
  const c = sp.curve; if (!c) return '';
  const pts = HZ.map((f, i) => `${cx(f).toFixed(1)},${cy(c[i]).toFixed(1)}`).join(' ');
  const grid = [100, 1000, 10000].map((f) => `<line class="bc-grid" x1="${cx(f)}" x2="${cx(f)}" y1="0" y2="${CH}"/><text class="bc-axis" x="${cx(f) + 4}" y="${CH - 4}">${f >= 1000 ? `${f / 1000}k` : f} Hz</text>`).join('');
  const db = [12, 6, -6, -12].map((d) => `<line class="bc-grid" x1="0" x2="${CW}" y1="${cy(d)}" y2="${cy(d)}" stroke-dasharray="2 4"/><text class="bc-axis" x="4" y="${cy(d) - 3}">${d > 0 ? '+' : ''}${d}</text>`).join('');
  return `${grid}${db}<line class="bc-cross" x1="0" x2="${CW}" y1="${cy(0)}" y2="${cy(0)}"/><polyline class="eq-curve" points="${pts}"/>`;
}
function drawCurve(guid) {
  const sp = eq?.speakers?.find((x) => x.guid === guid); const el = document.getElementById(`sp-curve-${guid}`);
  if (sp && el) el.innerHTML = svgFor(sp);
}

const fmtBox = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
const timers = {};
function band(sp, i, disabled) {
  const stages = () => drafts[sp.guid] || sp.stages;
  const v = stages()[i];
  const input = h('input', { type: 'range', min: -12, max: 12, step: 0.5, value: v, disabled, 'aria-label': `${sp.name} ${BANDS[i]} Hz` });
  const box = h('input', { class: 'eq-val', type: 'text', inputmode: 'decimal', value: fmtBox(v), disabled, title: `${BANDS[i]} Hz in dB` });
  const send = (next, quiet) => { drafts[sp.guid] = next; clearTimeout(timers[sp.guid]); timers[sp.guid] = setTimeout(() => put(sp.guid, { stages: next }, quiet).then(() => { if (!quiet) delete drafts[sp.guid]; }), quiet ? 80 : 0); };
  input.addEventListener('input', () => { const n = [...stages()]; n[i] = Number(input.value); box.value = fmtBox(n[i]); send(n, true); });
  input.addEventListener('change', () => { delete drafts[sp.guid]; });
  const commit = () => {
    const x = Number(box.value.trim().replace(/^\+/, '').replace(',', '.').replace(/\s*db$/i, ''));
    if (box.value.trim() === '' || !Number.isFinite(x)) { box.value = fmtBox(stages()[i]); return; }
    const n = [...stages()]; n[i] = Math.max(-12, Math.min(12, Math.round(x * 10) / 10)); send(n, false);
  };
  box.addEventListener('change', commit);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } else if (e.key === 'Escape') { box.value = fmtBox(stages()[i]); box.blur(); } });
  box.addEventListener('focus', () => box.select());
  return h('div', { class: 'eq-band' }, box, input, h('span', {}, BANDS[i]));
}

function speakerBody(sp) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', `sp-curve-${sp.guid}`); svg.setAttribute('class', 'eq-curve-box'); svg.setAttribute('viewBox', `0 0 ${CW} ${CH}`);
  svg.innerHTML = svgFor(sp);
  const isMic = sp.kind === 'mic';
  const starts = Object.entries((isMic ? eq.micStarts : eq.speakerStarts) || {});
  return h('div', {},
    // a camera mic: muted unless a Google Meet or Chat call is using it (helpers/anker-guard.js)
    isMic && /anker/i.test(sp.name) ? h('div', { class: 'srow', style: { borderTop: 0, paddingTop: 0 } },
      h('div', {}, h('div', { class: 'srow-title' }, 'Only for Google Meet and Chat'), h('div', { class: 'srow-desc' }, 'Muted otherwise.')),
      h('div', { class: 'srow-ctl' }, toggle({ value: guard === true, label: 'Only for Google Meet and Chat', onCommit: async (on) => { try { await env.api('/api/settings', { ankerGuard: on }); guard = on; rerender(); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); } } }))) : null,
    isMic ? h('div', { class: 'srow' },
      h('div', {}, h('div', { class: 'srow-title' }, 'Background gate'), h('div', { class: 'srow-desc' }, 'Quiets the room between words.')),
      h('div', { class: 'srow-ctl' }, toggle({ value: !!sp.gate, label: 'Background gate', onCommit: (on) => put(sp.guid, { gate: on }) }))) : null,
    isMic ? h('div', { class: 'srow' },
      h('div', {}, h('div', { class: 'srow-title' }, 'Leveler'), h('div', { class: 'srow-desc' }, 'Keeps your voice even.')),
      h('div', { class: 'srow-ctl' }, toggle({ value: !!sp.level, label: 'Leveler', onCommit: (on) => put(sp.guid, { level: on }) }))) : null,
    h('div', { class: 'srow', style: isMic && /anker/i.test(sp.name) ? {} : { borderTop: 0, paddingTop: 0 } },
      h('div', {}, h('div', { class: 'srow-title' }, `${sp.name} EQ`), h('div', { class: 'srow-desc' }, sp.on ? (isMic ? 'On' : 'On') : (isMic ? 'Off: no EQ' : 'Off: no EQ'))),
      h('div', { class: 'srow-ctl' }, toggle({ value: sp.on, label: `${sp.name} EQ`, onCommit: (on) => put(sp.guid, { on }) }))),
    h('div', { class: 'eq-bands', style: { opacity: sp.on ? 1 : 0.5 } }, ...BANDS.map((_, i) => band(sp, i, !sp.on))),
    h('div', { class: 'eq-curve-wrap', style: { opacity: sp.on ? 1 : 0.5 } }, svg),
    h('div', { class: 'actions', style: { marginTop: '12px', alignItems: 'center' } }, h('span', { class: 'faint', style: { fontSize: '13px' } }, 'Start from:'),
      ...starts.map(([name, stages]) => button(name, () => put(sp.guid, { stages, on: true }), { kind: 'ghost small' }))),
    h('p', { class: 'faint', style: { fontSize: '12.5px', marginBottom: 0 } }, isMic
      ? 'Tip: lift 2-4 kHz for clarity.'
      : 'Tip: add warmth at 250 Hz.'));
}

// the section for one speaker (guid), redrawn with the page's own redraw
export function speakerSection(guid, redraw) {
  rerender = redraw;
  // read again when older than 10 s (never while a slider is being dragged), so a tab always shows what plays
  if (!loading && !Object.keys(drafts).length && (error ? Date.now() - at > 3000 : !eq || Date.now() - at > 10000)) load();
  if (error) return h('p', { class: 'faint' }, `Speakers not read: ${error}`);
  if (!eq) return h('p', { class: 'faint' }, 'Reading the speakers…');
  const sp = eq.speakers?.find((x) => x.guid === guid);
  return sp ? speakerBody(sp) : h('p', { class: 'faint' }, 'Speaker not found in Windows.');
}
