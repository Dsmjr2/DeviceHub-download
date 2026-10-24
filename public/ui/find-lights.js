// Find my lights (22 Oct 2026, Shawn said yes to a built-in version of what was done by hand on his PC), on Lighting >
// PC lights: every zone of one OpenRGB light gets its own color at once (helpers/find-lights.js), the person taps the
// colors they can see and says what each one is ("Case fans", "Top logo", "RAM"), and DeviceHub names those zones and
// hides the ones that lit nothing; Show all zones brings them back. In place, step by step: no pop-ups, notifications
// or tooltips. The lights go back as they were on Save names or Cancel. Demo mode runs it on the pretend lights.
//   findLights(o, redraw) -> the card's part (o: the /api/openrgb answer; its controllers are replaced by the answers)
//   shownZones(c) -> [[zone, index]] the zones to list for a light (hidden ones only after Show all zones)
import { h } from './dom.js';
import { button } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';

// the same colors, in the same order, as helpers/find-lights.js (used here for demo mode only)
const DEMO_COLORS = [['Red', '#ff0000'], ['Orange', '#ff6a00'], ['Yellow', '#ffd400'], ['Green', '#00ff00'], ['Cyan', '#00ffff'],
  ['Blue', '#0000ff'], ['Purple', '#8a00ff'], ['Pink', '#ff40b0'], ['White', '#ffffff'], ['Lime', '#a0ff00'],
  ['Teal', '#00a08a'], ['Sky blue', '#0090ff'], ['Magenta', '#ff00ff'], ['Gold', '#ffa000'], ['Violet', '#c080ff'], ['Coral', '#ff6060']];
const EXAMPLES = ['Case fans', 'Top logo', 'RAM', 'Bottom logo', 'Light strip', 'Cooler', 'Back fan', 'Front fans'];

// step: idle | intro | test; kept across page redraws
const s = { step: 'idle', index: null, name: '', zones: [], seen: {}, names: {}, error: null, result: null, showAll: false, resumed: false, demoBefore: null };
let draw = () => {};
const go = (patch) => { Object.assign(s, patch); draw(); };

// the zones worth a row (23 Oct 2026, Shawn on a friend's B450: "His motherboard doesnt need this many options", and its
// "Top logo" did not even move the logo): the ones the person named with Find my lights, and the ones fans plug into
// (ARGB / D_LED headers). OpenRGB's own guesses ("Top logo", "Unnamed 6") stay out until Find my lights names them;
// All still covers every zone.
const FAN_ZONE = /argb|d[_ -]?led|header|fan/i;
export const shownZones = (c) => c.zones.map((z, i) => [z, i]).filter(([z]) => s.showAll || (!z.hidden && (z.named || FAN_ZONE.test(z.name || ''))));
export const hiddenZoneCount = (c) => c.zones.length - shownZones(c).length;

const lights = (o) => (o.controllers || []).filter((c) => c.zones?.length && c.leds > 0);
const say = (e) => String(e?.message || e || '').replace(/^Error: /, '');

// ---- demo: the pretend lights change on the page only
function demoStart(o, c) {
  s.demoBefore = c.zones.map((z) => z.color);
  let next = 0;
  const zones = c.zones.map((z, i) => { const pick = z.leds > 0 && next < DEMO_COLORS.length ? DEMO_COLORS[next++] : null; return { index: i, name: z.name, leds: z.leds, color: pick?.[1] || null, colorName: pick?.[0] || null }; });
  zones.forEach((z) => { c.zones[z.index].color = z.color || '#000000'; });
  c.same = false; c.mode = 'Direct';
  return { running: true, index: c.index, name: c.name, zones };
}
function demoPutBack(c) { if (c && s.demoBefore) c.zones.forEach((z, i) => { z.color = s.demoBefore[i]; }); s.demoBefore = null; }

async function start(o, c) {
  go({ error: null, result: null });
  try {
    const r = isDemo() ? demoStart(o, c) : await env.api('/api/openrgb/find-start', { target: c.index });
    if (Array.isArray(r.controllers)) o.controllers = r.controllers;
    go({ step: 'test', index: r.index, name: r.name, zones: r.zones, seen: {}, names: {} });
  } catch (e) { go({ error: `Test colors failed: ${say(e)}` }); }
}

// a color counts as lit when it was tapped or given a name; an empty, untapped one lit nothing
const named = (i) => (s.names[i] || '').trim();
const lit = (i) => !!s.seen[i] || !!named(i);

async function save(o) {
  const tested = s.zones.filter((z) => z.color);
  const names = {}, hidden = [];
  for (const z of tested) { if (named(z.index)) names[z.index] = named(z.index); if (!lit(z.index)) hidden.push(z.index); }
  go({ error: null });
  try {
    if (isDemo()) {
      const c = o.controllers.find((x) => x.index === s.index);
      demoPutBack(c);
      if (c) for (const z of tested) { const cz = c.zones[z.index]; if (names[z.index]) { cz.name = names[z.index]; cz.named = true; } cz.hidden = hidden.includes(z.index) || undefined; }
    } else {
      const r = await env.api('/api/openrgb/find-save', { target: s.index, names, hidden });
      if (Array.isArray(r.controllers)) o.controllers = r.controllers;
    }
    const list = Object.values(names);
    const result = [list.length ? `Saved: ${list.join(', ')}.` : 'No names saved.',
      hidden.length ? `${hidden.length} unlit zone${hidden.length === 1 ? '' : 's'} hidden.` : null,
      'Colors restored.'].filter(Boolean).join(' ');
    go({ step: 'idle', result, zones: [], seen: {}, names: {} });
  } catch (e) { go({ error: say(e) }); }
}

async function cancel(o) {
  go({ error: null });
  try {
    if (isDemo()) demoPutBack(o.controllers.find((x) => x.index === s.index));
    else { const r = await env.api('/api/openrgb/find-cancel', {}); if (Array.isArray(r.controllers)) o.controllers = r.controllers; }
    go({ step: 'idle', result: 'Canceled. Colors restored.', zones: [], seen: {}, names: {} });
  } catch (e) { go({ error: `Colors not restored: ${say(e)}` }); }
}

const line = (text, kind = '') => h('p', { class: `gh-note ${kind}`, style: { margin: '6px 0 0' } }, text);
const dot = (hex) => h('span', { 'aria-hidden': 'true', style: { width: '18px', height: '18px', borderRadius: '50%', background: hex, border: '1px solid var(--line2)', flex: '0 0 auto', display: 'inline-block' } });

function colorAnswer(z, n) {
  const status = h('small', { class: 'faint', style: { flex: '0 0 auto', minWidth: '150px' } });
  const showStatus = () => { status.textContent = lit(z.index) ? (named(z.index) ? 'Will be named' : 'Lit, no name') : 'Nothing lit'; };
  const chip = h('button', { class: `btn small${s.seen[z.index] ? '' : ' ghost'}`, 'aria-pressed': String(!!s.seen[z.index]), style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: '112px' },
    onclick: () => { s.seen[z.index] = !s.seen[z.index]; chip.classList.toggle('ghost', !s.seen[z.index]); chip.setAttribute('aria-pressed', String(!!s.seen[z.index])); showStatus(); if (s.seen[z.index]) box.focus(); } },
  dot(z.color), h('span', {}, z.colorName));
  // typing keeps the page as it is (no redraw), so the box keeps its focus
  const box = h('input', { class: 'text', value: s.names[z.index] || '', maxlength: 40, placeholder: EXAMPLES[n % EXAMPLES.length], 'aria-label': `What lit up in ${z.colorName.toLowerCase()}?`,
    style: { flex: '1 1 140px', minWidth: '0' }, oninput: (e) => { s.names[z.index] = e.target.value; showStatus(); } });
  showStatus();
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--line)' } }, chip, box, status);
}

function testStep(o) {
  const tested = s.zones.filter((z) => z.color);
  const empty = s.zones.filter((z) => !z.leds).length, past = s.zones.filter((z) => z.notInTest).length;
  return h('div', {},
    h('p', { style: { margin: '4px 0 2px', fontWeight: 600 } }, 'What lit up?'),
    h('p', { class: 'faint', style: { fontSize: '12.5px', margin: '0 0 4px' } }, `Each part of ${s.name} now has its own color. Name each one you see; leave it empty if nothing lit.`),
    ...tested.map((z, n) => colorAnswer(z, n)),
    empty ? line(`${empty} zone${empty === 1 ? '' : 's'} without lights skipped.`) : null,
    past ? line(`${past} more zone${past === 1 ? '' : 's'} skipped.`) : null,
    s.error ? line(s.error, 'bad') : null,
    h('div', { class: 'actions', style: { margin: '8px 0 0' } },
      button('Save names', () => save(o), { kind: 'primary small', ic: 'check' }),
      button('Cancel', () => cancel(o), { kind: 'ghost small' })));
}

function introStep(o) {
  const list = lights(o);
  return h('div', {},
    h('p', { class: 'faint', style: { fontSize: '12.5px', margin: '4px 0' } }, 'Each part lights its own color. Yours come back after.'),
    s.error ? line(s.error, 'bad') : null,
    h('div', { class: 'actions', style: { margin: '6px 0 0', flexWrap: 'wrap' } },
      ...(list.length === 1 ? [button('Start', () => start(o, list[0]), { kind: 'primary small' })]
        : list.map((c) => button(`${c.name} (${c.zones.length} zone${c.zones.length === 1 ? '' : 's'})`, () => start(o, c), { kind: 'small' }))),
      button('Not now', () => go({ step: 'idle', error: null }), { kind: 'ghost small' })));
}

export function findLights(o, redraw) {
  draw = redraw;
  if (!o?.running || o.readOnly || !lights(o).length) return null;
  // a test still showing its colors (the page was opened again): carry on with it
  if (!s.resumed && s.step === 'idle' && o.findTest?.running && !isDemo()) { s.resumed = true; Object.assign(s, { step: 'test', index: o.findTest.index, name: o.findTest.name, zones: o.findTest.zones, seen: {}, names: {} }); }
  s.resumed = true;
  const anyHidden = (o.controllers || []).some((c) => c.zones?.some((z) => z.hidden));
  const head = h('h3', {}, 'Find my lights');
  if (s.step === 'intro') return h('div', { class: 'pc-guide', style: { marginBottom: '10px' } }, head, introStep(o));
  if (s.step === 'test') return h('div', { class: 'pc-guide', style: { marginBottom: '10px' } }, head, testStep(o));
  return h('div', { class: 'pc-guide', style: { marginBottom: '10px' } },
    s.result ? line(s.result, 'good') : null,
    s.error ? line(s.error, 'bad') : null,
    h('div', { class: 'actions', style: { margin: '6px 0 0', flexWrap: 'wrap' } },
      button('Find my lights', () => go({ step: 'intro', error: null, result: null }), { kind: 'small', ic: 'search' }),
      anyHidden ? button(s.showAll ? 'Hide empty zones' : 'Show all zones', () => go({ showAll: !s.showAll }), { kind: 'ghost small' }) : null));
}
