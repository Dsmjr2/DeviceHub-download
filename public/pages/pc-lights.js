// The Lighting page's PC part (20 Oct 2026, Shawn: "a new area for lighting that has gpu, cpu, motherboard, case
// lights too ... for my pc or anyone else who uses the app"). Two cards:
// - This PC: each part (CPU, graphics card, motherboard, RAM, case and fans) with whether it has lights and how they
//   are reached, from the read-only PC map (helpers/pc-map.js) and the brand guide (public/core/brands.js); then any
//   USB device DeviceHub does not run yet, with what the guide says about its maker.
// - PC lights: the lights OpenRGB controls (helpers/openrgb.js), when OpenRGB runs with its SDK server. DeviceHub
//   never writes to the motherboard's SMBus itself.
import { h } from '../ui/dom.js';
import { card, button, pill, skeleton, offSwatch, isOff, OFF } from '../ui/controls.js';
import { groupLights, applyLocal, liveWriter } from '../core/light-groups.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { toast } from '../ui/overlay.js';
import { brandForUsb, ROUTE } from '../core/brands.js';
import { getHelp } from '../ui/get-help.js';
import { boardLights } from '../ui/board-lights.js';
import { findLights, showingAll } from '../ui/find-lights.js';

// demo: the friend's PC from support request 15 (26 Oct 2026): a Gigabyte B450 whose case fans sit on its ARGB header,
// four Corsair Vengeance RGB Pro sticks and an MSI RTX 3060 Gaming X
const DEMO_PC = {
  cpu: 'AMD Ryzen 7 5800X3D', gpus: [{ name: 'NVIDIA GeForce RTX 3060', maker: 'MSI' }], board: { maker: 'Gigabyte Technology Co., Ltd.', model: 'B450 AORUS PRO WIFI-CF' },
  ram: [1, 2, 3, 4].map(() => ({ part: 'CMW16GX4M2C3200C16', gb: 8, maker: 'Corsair', lights: 'yes' })),
  usb: [{ id: '1b1c:0a6b', vid: '1b1c', name: 'CORSAIR HS80 RGB Wireless Gaming Headset', runs: 'Headset page' }, { id: '046d:c547', vid: '046d', name: 'USB Receiver', runs: null }],
  lampArrays: 0, smbus: ['AMD SMBus'],
};
// demo: OpenRGB running with that PC's lights, as the server names them (colors change on the page only; nothing is sent)
const DEMO_ZONES = ['Top logo', '???', 'Bottom logo', 'Case Rear', 'Case', '???', '???', 'Fan header (ARGB) 1', 'Fan header (ARGB) 2', '???'];
const DEMO_ORGB = () => ({ running: true, protocol: 3, bundled: false, board: { setUp: true }, controllers: [
  ...[0, 1, 2, 3].map((i) => ({ index: i, name: 'Corsair Vengeance RGB Pro DDR4', vendor: 'Corsair', type: 'ram', zones: [{ name: 'DRAM', leds: 10, color: '#ff6a1a' }], leds: 10, mode: 'Direct', color: '#ff6a1a', same: true })),
  { index: 4, name: 'B450 AORUS PRO WIFI-CF', vendor: 'Gigabyte', type: 'motherboard', zones: DEMO_ZONES.map((name) => ({ name, leds: 1, color: '#3a7bff' })), leds: DEMO_ZONES.length, mode: 'Direct', color: '#3a7bff', same: true },
  { index: 5, name: 'MSI GeForce RTX 3060 Gaming X LHR', vendor: 'MSI', type: 'gpu', zones: [{ name: 'GPU', leds: 1, color: '#ffffff' }], leds: 1, mode: 'Direct', color: '#ffffff', same: true }] });
const DEMO_BT = [{ name: 'Xbox Wireless Controller', le: true, connected: true, battery: 80 }, { name: 'AirPods Pro', le: false, connected: false, battery: null }];
// demo: why fans may be missing (helpers/lights-diagnose.js answers the real one)
const DEMO_DIAG = { board: 'Gigabyte B450 AORUS PRO WIFI-CF', openrgb: { state: 'running', usbOnly: false }, found: [], verdict: { kind: 'usb', line: 'on USB: shows after Find lights' },
  seen: [{ id: '048d:8297', name: 'Gigabyte RGB Fusion 2 USB', kind: 'board', found: true }], problems: [] };
const st = { bt: null, pc: null, orgb: null, diag: null, loading: false, error: null, include: true };
let redraw = () => {};
const refreshPc = () => redraw();

export async function loadPc(fresh = false, after) {
  if (isDemo()) { const first = !st.pc; st.pc = DEMO_PC; if (!st.orgb) st.orgb = DEMO_ORGB(); st.diag = DEMO_DIAG; st.bt = DEMO_BT; if (first) redraw(); return; }
  if (st.loading) return; st.loading = true;
  try {
    const [pc, orgb] = await Promise.all([env.api(`/api/pc${fresh ? '?fresh=1' : ''}`), env.api(`/api/openrgb${fresh ? '?fresh=1' : ''}`)]);
    st.pc = pc; st.orgb = orgb; st.error = null;
    // why fans may be missing: the board, the lighting controllers on USB and what Find lights said (read-only)
    env.api('/api/lights/diagnose').then((d) => { st.diag = d; redraw(); }).catch(() => {});
    env.api(`/api/bluetooth${fresh ? '?fresh=1' : ''}`).then((bt) => { st.bt = bt; }).catch(() => {});
  } catch (e) { st.error = e.message; }
  finally { st.loading = false; redraw(); if (after) after(); }
}

// PC lights by what they are (26 Oct 2026, Shawn: "the pc lights are coming up as motherboard lights on my friends pc,
// also when I change one it scrolls back to the top"): Fans, RAM, Graphics card, Board (public/core/light-groups.js).
// Each row has the color it shows now, a swatch that gives it the picker's color, and Off; each writes only its own
// zone or stick. A row given a color stays "Live": moving the picker then changes it as it moves (at most 10 writes a
// second, the last on release). A color change updates the rows in place: nothing is redrawn and the card keeps its
// scroll and focus. Only a change in what is listed (Find my lights, Look again) rebuilds this card, and only it.
const live = { key: null, writes: null, writer: null, failed: false };
let gen = 0;                            // a newer local change wins over an older write's answer
let pickNow = () => '#ff6a1a';
let wrap = null;                        // the card's holder (div.light-pc); null until the Lighting page draws it
let rowEls = new Map();                 // row key -> { el, dot, set } for in-place updates
let shownKeys = '';                     // the listed rows when drawn; another list rebuilds the card

const sections = () => groupLights(st.orgb?.controllers || [], { showAll: showingAll() });
const label = (hex) => (isOff(hex) ? 'Off' : hex ? hex.toUpperCase() : 'Several colors');

async function sendWrites(writes, hex, { quiet = false } = {}) {
  const list = st.orgb?.controllers;
  if (!list || !writes.length) return;
  const before = JSON.stringify(list), mine = ++gen;
  applyLocal(list, writes, hex);
  paintRows();
  if (isDemo()) return;
  try {
    let r = null;
    for (const w of writes) r = await env.api('/api/openrgb/color', { target: w.index, hex, zone: w.zone });
    if (mine === gen && Array.isArray(r?.controllers) && st.orgb) { st.orgb.controllers = r.controllers; paintRows(); }
  } catch (e) {
    if (mine === gen && st.orgb) { st.orgb.controllers = JSON.parse(before); paintRows(); }
    if (!quiet || !live.failed) toast('Not changed', 'bad', { detail: e.message });
    if (quiet) live.failed = true;
    throw e;
  }
}

function setLive(key, writes) {
  live.key = key; live.writes = writes; live.failed = false;
  live.writer = key ? liveWriter((hex) => sendWrites(live.writes, hex, { quiet: true }).catch(() => {}), { every: 100 }) : null;
  paintRows();
}
const useRow = async (key, writes) => { setLive(key, writes); try { await sendWrites(writes, pickNow()); } catch {} };
const offRow = async (key, writes) => { if (live.key === key) setLive(null); try { await sendWrites(writes, OFF); } catch {} };

// the picker moved / was let go (pages/lighting.js): the paint swatches show it, a Live row follows it
export function pcPick(hex, done = false) {
  if (wrap) wrap.style.setProperty('--pick', hex);
  paintRows();
  if (!live.key || !live.writer) return;
  if (!done) { applyLocal(st.orgb?.controllers || [], live.writes, hex); paintRows(); live.writer.push(hex); }
  else live.writer.flush(hex);
}
export const pcStopLive = () => { if (live.key) setLive(null); };

function lightRow(key, title, detail, row, writes) {
  const dot = h('span', { class: 'pcl-dot', 'aria-hidden': 'true' });
  const tag = h('button', { class: 'pcl-live', 'aria-label': `${title}: stop following the picker`, onclick: () => setLive(null) }, 'Live ×');
  const empty = !(row.leds > 0) && writes.length === 0;
  const el = h('div', { class: `pcl-row${empty ? ' empty' : ''}`, dataset: { key } },
    dot,
    h('div', { class: 'pcl-name' }, h('b', {}, title), detail ? h('small', {}, detail) : null),
    tag,
    empty ? null : h('button', { class: 'swatch pcl-paint', 'aria-label': `${title}: use the picked color`, onclick: () => useRow(key, writes) }),
    empty ? null : offSwatch({ label: title, onclick: () => offRow(key, writes) }));
  const set = (color) => {
    dot.style.background = color ? color : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';
    dot.classList.toggle('off', isOff(color));
    dot.setAttribute('data-color', label(color));
    const pick = pickNow().toLowerCase();
    el.classList.toggle('match', !!color && !isOff(color) && color.toLowerCase() === pick);
    el.classList.toggle('is-live', live.key === key);
    el.querySelector('.swatch-off')?.classList.toggle('on', isOff(color));
  };
  rowEls.set(key, { el, set });
  return el;
}

// every row's color, ring and Live mark, in place; a different list of rows rebuilds the card instead
function paintRows() {
  if (!wrap?.isConnected) return;
  const secs = sections();
  const keys = secs.map((s) => [s.id, ...(s.rows.length > 1 ? s.rows.map((r) => r.key) : [])].join(',')).join('|');
  if (keys !== shownKeys) { refreshPc(); return; }
  for (const s of secs) {
    rowEls.get(`all:${s.id}`)?.set(s.rows.length === 1 ? s.rows[0].color : s.color);
    if (s.rows.length > 1) for (const r of s.rows) rowEls.get(r.key)?.set(r.color);
  }
}

function lightSections() {
  rowEls = new Map();
  const secs = sections();
  shownKeys = secs.map((s) => [s.id, ...(s.rows.length > 1 ? s.rows.map((r) => r.key) : [])].join(',')).join('|');
  const out = secs.map((s) => {
    const one = s.rows.length === 1 ? s.rows[0] : null;
    const names = [...new Set(s.rows.map((r) => r.detail).filter(Boolean))];
    const common = s.id === 'ram' && names.length === 1 ? names[0] : null;
    const head = lightRow(`all:${s.id}`, s.title, one ? [one.label !== s.title ? one.label : null, one.detail].filter(Boolean).join(' · ') || null : common ? `All · ${common}` : 'All', one || { leds: s.all.length }, s.all);
    head.classList.add('pcl-head');
    return h('div', { class: 'pcl-sec', dataset: { sec: s.id } },
      head,
      s.rows.length > 1 ? h('div', { class: 'pcl-rows' }, ...s.rows.map((r) => lightRow(r.key, r.label, common ? null : r.detail, r, r.leds > 0 ? r.writes : []))) : null,
      s.hidden ? h('small', { class: 'faint pcl-note' }, `${s.hidden} more part${s.hidden === 1 ? "" : "s"}: All colors ${s.hidden === 1 ? "it" : "them"} too.`) : null);
  });
  queueMicrotask(paintRows);
  return out;
}

// one color on every OpenRGB light (used by "Apply to all" when PC lights are included)
export async function applyPc(hex) {
  if (!st.include || !st.orgb?.running || !st.orgb.controllers.length) return null;
  pcStopLive();
  if (isDemo()) { applyLocal(st.orgb.controllers, st.orgb.controllers.map((c) => ({ index: c.index, zone: null })), hex); paintRows(); return `PC lights (${st.orgb.controllers.length})`; }
  const r = await env.api('/api/openrgb/color', { target: 'all', hex });
  gen++;
  if (Array.isArray(r?.controllers)) { st.orgb.controllers = r.controllers; paintRows(); } else loadPc(true);
  return `PC lights (${r.changed.length})`;
}
export const pcAvailable = () => !!st.orgb?.running && st.orgb.controllers.length > 0;
export const pcIncluded = () => st.include && pcAvailable();
export const setPcIncluded = (on) => { st.include = on; };


// A ready prompt for Claude Code (or any AI coding assistant) to add a device DeviceHub does not run yet, filled in from the brand guide.
export function devicePrompt(u) {
  const b = u.brand || {};
  const routes = (b.transport || []).map((t) => ROUTE[t] || t).join(', ');
  const known = (b.openProjects || []).map((p) => `${p.name}${p.note ? ` (${p.note})` : ''}`).join('; ');
  return [
    'Read CLAUDE.md first and follow its rules exactly.',
    `Add this device to DeviceHub: ${u.name ? `the device Windows names ${JSON.stringify(String(u.name).slice(0, 80))}` : 'a USB device'} (USB ${u.id})${b.name ? `, made by ${b.name}` : ''}${b.category ? ` (${b.category})` : ''}.`,
    b.name ? `docs/BRANDS.md says: maker's app ${b.vendorApp || 'unknown'}; it talks over ${routes || 'unknown'}; open projects that know it: ${known || 'none'}; risk ${b.risk || 'unknown'}${b.riskWhy ? `: ${b.riskWhy}` : ''}.${b.notes ? ` ${b.notes}` : ''}` : null,
    `Start with step 1 of "Adding your own devices": find it on this PC, read-only (powershell -File helpers/hid-caps.ps1 -Vid ${u.vid}), and tell me what you found. Then tell me whether its protocol is already known or has to be learned, and what you need from me.`,
    'Ask me before installing or downloading anything, and never flash firmware.',
  ].filter(Boolean).join('\n');
}
// plugged-in devices from a known brand that DeviceHub does not run yet (also on the first-run screen)
export const otherDevices = () => (st.pc?.usb || []).filter((u) => !u.runs).map((u) => ({ ...u, brand: brandForUsb(u.vid) })).filter((u) => u.brand);
export const pcLoaded = () => !!st.pc || !!st.error;   // read, or tried and failed (never retried by itself)
export async function copyPrompt(u) {
  try { await navigator.clipboard.writeText(devicePrompt(u)); toast('Prompt copied', 'good', { detail: 'Paste into Claude Code in the DeviceHub folder.' }); }
  catch { toast('Could not copy', 'bad'); }
}


// Board, fan and RAM lights (22 Oct 2026, Shawn: "I want the app to be able to set it up"): one button sets up PawnIO
// and runs the OpenRGB inside DeviceHub as administrator (helpers/board-lights.mjs, ui/board-lights.js), and Remove
// board lights takes it away. DeviceHub never writes to the board or RAM itself: OpenRGB does, as the person chose.
function boardSection() {
  return h('div', { class: 'pc-guide' },
    h('h3', {}, 'Board, fan and RAM lights'),
    boardLights({ redraw, onDone: (r) => { if (r?.ok) loadPc(true); } }),
    h('p', { class: 'faint', style: { fontSize: '12px', margin: '8px 0 0' } }, 'Not needed for USB or graphics card lights.'));
}

// What was found and why fan lights may be missing (helpers/lights-diagnose.js), in place: no pop-ups or tooltips.
// Get help for lights sends Shawn the same facts in one click (helpers/get-help.mjs, area "lights").
// the Result row's title per verdict (23 Oct 2026, Shawn: "no lighting controller found doesnt really make sense" when
// the board's lights were listed)
const VERDICT_TITLE = { reached: 'Board lights found', smbus: "On the board's SMBus", none: 'No lighting controller found' };
function fanHelp() {
  const d = st.diag;
  if (!d || d.isolated) return null;
  if (d.verdict?.kind === 'reached' && !d.problems?.length && !(d.seen || []).some((c) => c.found === false)) return null;
  const row = (label, what, how) => h('div', { class: 'pc-part' }, h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, label), h('b', {}, what)), how ? h('small', { class: 'faint' }, how) : null);
  const seenHow = (c) => (c.found === true ? 'OpenRGB found it.' : c.found === false ? 'Plugged in, not listed by OpenRGB.' : 'Shows after Find lights.');
  return h('div', { class: 'pc-guide' },
    h('h3', {}, 'Fan lights'),
    h('div', { class: 'pc-parts' },
      row('Board', d.board || 'Not read', null),
      ...(d.seen || []).map((c) => row(c.kind === 'hub' ? 'Fan hub' : 'Lighting chip', `${c.name} (USB ${c.id})`, seenHow(c))),
      d.verdict && d.verdict.kind !== 'usb' && d.verdict.kind !== 'reached' ? row('Result', VERDICT_TITLE[d.verdict.kind] || 'Checked', d.verdict.line[0].toUpperCase() + d.verdict.line.slice(1) + '.') : null),
    ...(d.problems || []).map((p) => h('div', { class: 'gh-note', style: { margin: '8px 0 0' } }, h('b', {}, `${p.problem}. `), `${p.why} `, h('span', {}, `Fix: ${p.fix}`))));
}

function pcLights() {
  const o = st.orgb;
  const head = [h('h2', {}, 'PC lights')];
  if (!o) return card(head, skeleton([66, 48]));
  // the OpenRGB shipped inside DeviceHub (helpers/openrgb.js): started hidden, USB lights only, when this asks for it
  const b = o.bundle;
  if (!o.running) {
    return card(head,
      b?.canStart ? h('p', { class: 'faint' }, 'Find lights looks for USB lights.')
        : h('p', { class: 'faint' }, 'Needs OpenRGB 1.1+ (openrgb.org) with its SDK server on.'),
      o.reason && o.reason !== 'not running' && !st.diag?.problems?.length ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, o.reason) : null,
      h('div', { class: 'actions' }, button(b?.canStart ? 'Find lights' : 'Look again', () => loadPc(true), { kind: 'small', ic: 'refresh' })),
      fanHelp(),
      boardSection());
  }
  return card([...head, h('span', { class: 'spacer' }), pill(`${o.controllers.length} found`, 'good')],
    !o.bundled && o.board?.setUp ? h('p', { class: 'faint pcl-intro' }, 'Board, fan and RAM lights included.') : null,
    o.bundled ? h('p', { class: 'faint pcl-intro' }, `USB lights only${o.readOnly ? '; read-only' : ''}.`) : null,
    o.controllers.length ? h('div', { class: 'pcl' }, ...lightSections()) : h('p', { class: 'faint' }, 'No lights found.'),
    // Find my lights: one color per zone, the person names what lit (ui/find-lights.js)
    findLights(o, redraw),
    h('div', { class: 'actions' },
      button('Undo', async () => { pcStopLive(); if (isDemo()) { st.orgb = DEMO_ORGB(); redraw(); toast('PC lights undone', 'good'); return; } try { await env.api('/api/openrgb/restore', {}); toast('PC lights undone', 'good'); } catch (e) { toast('Nothing to undo', 'bad', { detail: e.message }); } loadPc(true); }, { kind: 'small', ic: 'undo' }),
      button('Look again', () => loadPc(true), { kind: 'ghost small', ic: 'refresh' })),
    // the built-in OpenRGB reaches USB lights only: the way to the board and RAM stays one click away
    fanHelp(),
    o.bundled || o.board?.setUp ? boardSection() : null);
}

// PC lights on its own, as the Lighting page's third column. It redraws only itself (Find my lights, Look again, a
// light found or lost), keeping its scroll and the focused control; onState tells the page when OpenRGB came or went.
export function pcLightsCard({ pick, onState } = {}) {
  if (pick) pickNow = pick;
  wrap = h('div', { class: 'light-pc', style: { '--pick': pickNow() } });
  let had = pcAvailable();
  redraw = () => {
    if (!wrap?.isConnected) return;
    const old = wrap.firstElementChild, scroll = old?.scrollTop || 0;
    const focus = wrap.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim() : null;
    wrap.replaceChildren(pcLights());
    if (wrap.firstElementChild) wrap.firstElementChild.scrollTop = scroll;
    if (focus) [...wrap.querySelectorAll('button, input')].find((x) => (x.getAttribute('aria-label') || x.textContent.trim()) === focus)?.focus({ preventScroll: true });
    if (pcAvailable() !== had) { had = pcAvailable(); onState?.(); }
  };
  wrap.append(pcLights());
  if (!st.pc && !st.loading) queueMicrotask(() => loadPc());
  return wrap;
}
