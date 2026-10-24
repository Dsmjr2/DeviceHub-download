// The Lighting page's PC part (20 Oct 2026, Shawn: "a new area for lighting that has gpu, cpu, motherboard, case
// lights too ... for my pc or anyone else who uses the app"). Two cards:
// - This PC: each part (CPU, graphics card, motherboard, RAM, case and fans) with whether it has lights and how they
//   are reached, from the read-only PC map (helpers/pc-map.js) and the brand guide (public/core/brands.js); then any
//   USB device DeviceHub does not run yet, with what the guide says about its maker.
// - PC lights: the lights OpenRGB controls (helpers/openrgb.js), when OpenRGB runs with its SDK server. DeviceHub
//   never writes to the motherboard's SMBus itself.
import { h } from '../ui/dom.js';
import { card, button, pill, skeleton } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { toast } from '../ui/overlay.js';
import { brandForUsb, brandNamed, ROUTE } from '../core/brands.js';
import { learnThis } from './learn.js';
import { getHelp } from '../ui/get-help.js';
import { boardLights } from '../ui/board-lights.js';
import { findLights, shownZones, hiddenZoneCount } from '../ui/find-lights.js';
import { genericDongle } from '../core/generic-dongle.js';
import { viaFileNote, isViaKeyboard } from './keyboard.js';

const DEMO_PC = {
  cpu: 'AMD Ryzen 7 5800X3D', gpus: [{ name: 'NVIDIA GeForce RTX 4070', maker: 'MSI' }], board: { maker: 'Gigabyte Technology Co., Ltd.', model: 'B450 AORUS PRO WIFI-CF' },
  ram: [{ part: 'F4-3200C16-8GVKB', gb: 8, maker: 'G.Skill', lights: 'no' }, { part: 'F4-3200C16-8GVKB', gb: 8, maker: 'G.Skill', lights: 'no' }],
  usb: [{ id: '1b1c:0a6b', vid: '1b1c', name: 'CORSAIR HS80 RGB Wireless Gaming Headset', runs: 'Headset page' }, { id: '046d:c547', vid: '046d', name: 'USB Receiver', runs: null }],
  lampArrays: 0, smbus: ['AMD SMBus'],
};
// demo: OpenRGB running with a pretend board and lit RAM (colors change on the page only; nothing is sent)
const DEMO_ORGB = () => ({ running: true, protocol: 3, bundled: false, board: { setUp: true }, controllers: [
  { index: 0, name: 'B450 AORUS PRO WIFI-CF', vendor: 'Gigabyte', type: 'motherboard', zones: [{ name: 'Motherboard', leds: 5 }, { name: 'D_LED1 header', leds: 30 }], leds: 35, mode: 'Static', color: '#ff6a1a', same: true },
  { index: 1, name: 'Trident Z RGB', vendor: 'G.Skill', type: 'ram', zones: [{ name: 'DRAM', leds: 8 }], leds: 8, mode: 'Rainbow', color: '#ff0000', same: false },
  { index: 2, name: 'Trident Z RGB', vendor: 'G.Skill', type: 'ram', zones: [{ name: 'DRAM', leds: 8 }], leds: 8, mode: 'Static', color: '#3a7bff', same: true }] });
const DEMO_BT = [{ name: 'Xbox Wireless Controller', le: true, connected: true, battery: 80 }, { name: 'AirPods Pro', le: false, connected: false, battery: null }];
// demo: why fans may be missing (helpers/lights-diagnose.js answers the real one)
const DEMO_DIAG = { board: 'Gigabyte B450 AORUS PRO WIFI-CF', openrgb: { state: 'running', usbOnly: false }, found: [], verdict: { kind: 'usb', line: 'on USB: shows after Find lights' },
  seen: [{ id: '048d:8297', name: 'Gigabyte RGB Fusion 2 USB', kind: 'board', found: true }], problems: [] };
const st = { bt: null, pc: null, orgb: null, diag: null, loading: false, error: null, include: true };
let redraw = () => {};

export async function loadPc(fresh = false, after) {
  if (isDemo()) { const first = !st.pc; st.pc = DEMO_PC; if (!st.orgb) st.orgb = DEMO_ORGB(); st.diag = DEMO_DIAG; st.bt = DEMO_BT; if (first) redraw(); return; }
  if (st.loading) return; st.loading = true;
  try {
    const [pc, orgb] = await Promise.all([env.api(`/api/pc${fresh ? '?fresh=1' : ''}`), env.api(`/api/openrgb${fresh ? '?fresh=1' : ''}`)]);
    st.pc = pc; st.orgb = orgb; st.error = null;
    // why fans may be missing: the board, the lighting controllers on USB and what Find lights said (read-only)
    env.api('/api/lights/diagnose').then((d) => { st.diag = d; redraw(); }).catch(() => {});
    env.api(`/api/bluetooth${fresh ? '?fresh=1' : ''}`).then((bt) => { st.bt = bt; redraw(); }).catch(() => {});
  } catch (e) { st.error = e.message; }
  finally { st.loading = false; redraw(); if (after) after(); }
}

// a row of color swatches and a color box; the current color has a ring
const SWATCHES = ['#ffffff', '#ff2a2a', '#ff7a1a', '#ffd21a', '#35e06b', '#1ad0ff', '#2a5bff', '#a64dff', '#ff3fb4', '#000000'];
function colorRow(label, current, set) {
  const cur = (current || '').toLowerCase();
  return h('div', { class: 'pc-color-row', style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
    h('span', { class: 'muted', style: { minWidth: '110px', fontSize: '12.5px' } }, label),
    ...SWATCHES.map((hx) => h('button', { class: 'swatch', 'aria-label': hx === '#000000' ? 'Off' : hx, style: { width: '20px', height: '20px', borderRadius: '50%', background: hx, border: hx === cur ? '2px solid var(--text)' : '1px solid var(--line2)', cursor: 'pointer', padding: 0 }, onclick: () => set(hx) })),
    h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff', 'aria-label': `${label} color`, style: { width: '28px', height: '22px', padding: 0, border: 'none', background: 'none' }, onchange: (e) => set(e.target.value) }));
}
async function setPcColor(index, hex, zone) {
  if (isDemo()) { const c = st.orgb.controllers.find((x) => x.index === index); if (c) { if (zone === null) { c.color = hex; c.same = true; c.zones.forEach((z) => { z.color = hex; }); } else { c.zones[zone].color = hex; c.same = false; } } redraw(); return; }
  // shown at once; the answer then carries the lights' new state (no rescan of the PC)
  const c = st.orgb?.controllers?.find((x) => x.index === index), was = c ? JSON.parse(JSON.stringify(c)) : null;
  if (c) { if (zone === null) { c.color = hex; c.same = true; c.zones.forEach((z) => { z.color = hex; }); } else if (c.zones[zone]) { c.zones[zone].color = hex; c.same = c.zones.every((z) => z.color === hex); } redraw(); }
  try {
    const r = await env.api('/api/openrgb/color', { target: index, hex, zone });
    if (Array.isArray(r?.controllers) && st.orgb) { st.orgb.controllers = r.controllers; redraw(); }
  } catch (e) { if (c && was) Object.assign(c, was); redraw(); toast('Not changed', 'bad', { detail: e.message }); }
}
// one color on every OpenRGB light (used by "Apply to all" when PC lights are included)
export async function applyPc(hex) {
  if (!st.include || !st.orgb?.running || !st.orgb.controllers.length) return null;
  if (isDemo()) { st.orgb.controllers.forEach((c) => { c.color = hex; c.same = true; c.mode = 'Direct'; }); redraw(); return `PC lights (${st.orgb.controllers.length})`; }
  const r = await env.api('/api/openrgb/color', { target: 'all', hex });
  loadPc(true);
  return `PC lights (${r.changed.length})`;
}
export const pcAvailable = () => !!st.orgb?.running && st.orgb.controllers.length > 0;
export const pcIncluded = () => st.include && pcAvailable();
export const setPcIncluded = (on) => { st.include = on; };

const cleanMaker = (s) => (s || '').replace(/Technology|Co\.|Ltd\.?|Inc\.?|Corporation|International|Computer|,/gi, '').replace(/\s+/g, ' ').trim();
function line(label, what, lights, how, brand) {
  return h('div', { class: 'pc-part' },
    h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, label), h('b', {}, what || 'not found'),
      lights === 'yes' ? pill('lights', 'good') : lights === 'no' ? pill('no lights') : lights ? pill(lights) : null),
    how ? h('small', { class: 'faint' }, how) : null,
    brand ? h('small', { class: 'faint' }, brandLine(brand)) : null);
}
const brandLine = (b) => [b.vendorApp ? `App: ${b.vendorApp}` : null, b.openProjects?.length ? `Open: ${b.openProjects.map((p) => p.name).join(', ')}` : null, b.risk ? `Risk: ${b.risk}` : null].filter(Boolean).join(' · ');

function thisPc() {
  const pc = st.pc;
  if (!pc) return card([h('h2', {}, 'This PC')], h('p', { class: 'faint' }, st.error ? `PC not read: ${st.error}` : 'Reading…'));
  const board = `${cleanMaker(pc.board?.maker)} ${pc.board?.model || ''}`.trim();
  const boardBrand = brandNamed(pc.board?.maker, 'motherboard');
  const ramLit = pc.ram?.some((r) => r.lights === 'yes' || r.lights === 'likely');
  const ramNone = pc.ram?.length && pc.ram.every((r) => r.lights === 'no');
  const ramParts = [...new Set((pc.ram || []).map((r) => `${r.maker || 'unknown maker'} ${r.part}`))];
  const boardSmbus = boardBrand?.transport?.includes('smbus') || pc.smbus?.length;
  // only makers the guide knows (Bluetooth adapters, hubs and the like are left out)
  const others = otherDevices();
  return card([h('h2', {}, 'This PC'), h('span', { class: 'spacer' }), button('', () => loadPc(true), { kind: 'ghost small', ic: 'refresh', title: 'Read again' })],
    h('div', { class: 'pc-parts' },
      line('Processor', pc.cpu, null, null, null),
      line(pc.gpus?.length > 1 ? 'Graphics' : 'Graphics card', (pc.gpus || []).map((g) => `${g.maker ? g.maker + ' ' : ''}${g.name}`).join(', ') || null, null, 'Lights via OpenRGB.', null),
      line('Motherboard', board, null, boardSmbus ? 'Lights and RGB headers via OpenRGB.' : 'Lights via OpenRGB.', null),
      line('Memory', ramParts.join(', '), ramLit ? 'yes' : ramNone ? 'no' : 'unknown', ramLit ? 'Via OpenRGB.' : null, null),
      line('Case and fans', 'lit fans and strips', null, 'Follow the board\'s RGB headers.', null),
      // Windows Dynamic Lighting: the lights work in Windows itself, no driver; one click opens that page (22 Oct 2026)
      pc.lampArrays ? h('div', {}, line('Dynamic Lighting', `${pc.lampArrays} device${pc.lampArrays === 1 ? '' : 's'}`, 'yes', 'Set in Windows Settings.', null),
        h('div', { class: 'actions', style: { margin: '6px 0 0' } }, button('Open Dynamic Lighting', openDynamicLighting, { kind: 'ghost small', ic: 'external' }))) : null),
    others.length ? h('div', { class: 'pc-others' }, h('h3', {}, 'Other devices plugged in'),
      ...others.map((u) => { const gd = genericDongle(u); return h('div', { class: 'pc-other' }, line(u.brand.shared ? 'USB device' : u.brand.name, u.name || (gd ? 'USB receiver' : `${u.brand.name} device`), null, gd ? gd.line : null, gd ? null : u.brand),
        // a VIA keyboard needs no learning, only its layout file when VIA's library lacks it (keyboard.js viaFileNote)
        isViaKeyboard(u) ? viaFileNote(u.vid, u.pid, u.brand.name) : null,
        // a generic 2.4G receiver (core/generic-dongle.js): no Learn it, Learn a device refuses its chip's id
        h('div', { class: 'actions' }, gd ? null : button('Learn it', () => { learnThis(u.vid, u.pid); location.hash = '#/learn'; }, { kind: 'ghost small', ic: 'plug' }),
          button('Copy prompt', () => copyPrompt(u), { kind: 'ghost small' })),
        // or ask for it: sent to Shawn in one click where reports go, otherwise a short request for GitHub (ui/get-help.js)
        getHelp(`request:${u.vid}:${u.pid}`, null, { label: 'Request support', request: { vid: u.vid, pid: u.pid, name: u.name || '' } })); })) : null,
    // paired Bluetooth devices: connected or off, and the battery Windows last read
    st.bt?.length ? h('div', { class: 'pc-others' }, h('h3', {}, 'Bluetooth'),
      ...st.bt.map((d) => line(d.connected ? 'connected' : 'off', d.name, null, d.battery != null ? `Battery ${d.battery}%${d.connected ? '' : ' when last connected'}` : null, null))) : null);
}

// A ready prompt for Claude Code to add a device DeviceHub does not run yet, filled in from the brand guide.
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

const openDynamicLighting = () => env.api('/api/diagnose/action', { kind: 'settings', page: 'lighting' }).catch((e) => toast('Settings not opened', 'bad', { detail: e.message }));

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
  const row = (label, what, how) => h('div', { class: 'pc-part' }, h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, label), h('b', {}, what)), how ? h('small', { class: 'faint' }, how) : null);
  const seenHow = (c) => (c.found === true ? 'OpenRGB found it.' : c.found === false ? 'Plugged in, not listed by OpenRGB.' : 'Shows after Find lights.');
  return h('div', { class: 'pc-guide' },
    h('h3', {}, 'Fan lights'),
    h('div', { class: 'pc-parts' },
      row('Board', d.board || 'Not read', null),
      ...(d.seen || []).map((c) => row(c.kind === 'hub' ? 'Fan hub' : 'Lighting chip', `${c.name} (USB ${c.id})`, seenHow(c))),
      d.verdict && d.verdict.kind !== 'usb' ? row('Result', VERDICT_TITLE[d.verdict.kind] || 'Checked', d.verdict.line[0].toUpperCase() + d.verdict.line.slice(1) + '.') : null),
    ...(d.problems || []).map((p) => h('div', { class: 'gh-note', style: { margin: '8px 0 0' } }, h('b', {}, `${p.problem}. `), `${p.why} `, h('span', {}, `Fix: ${p.fix}`))),
    getHelp('lights', () => '', { area: 'lights' }));
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
    !o.bundled && o.board?.setUp ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, 'Board, fan and RAM lights included.') : null,
    o.bundled ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, `USB lights only${o.readOnly ? '; read-only' : ''}.`) : null,
    o.controllers.length ? h('div', { class: 'pc-parts' }, ...groups(o.controllers).map((g) => {
      const c = g[0], many = g.length > 1;
      const same = g.every((x) => x.same && x.color === c.color);
      return h('div', { class: 'pc-part' },
        h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, typeLabel(c.type)), h('b', {}, many ? `${c.name} × ${g.length}` : c.name),
          c.color ? h('span', { class: 'dot', style: { background: same ? c.color : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }, title: same ? c.color : 'several colors' }) : null),
        h('small', { class: 'faint' }, [c.mode ? `Mode: ${c.mode}` : null, `${g.reduce((n, x) => n + (x.leds || 0), 0)} lights`, many ? `${g.length} sticks` : null].filter(Boolean).join(' · ')),
        // the colors, for the whole part and per zone (an ARGB header is where fans plug in) (22 Oct 2026)
        colorRow('All', same ? c.color : null, async (hex) => { for (const x of g) await setPcColor(x.index, hex, null); }),
        // and each stick on its own (23 Oct 2026, Shawn: "Let him be able to change the colors for each ram stick")
        many ? h('div', { class: 'pc-zones' }, ...g.map((x, i) => colorRow(`Stick ${i + 1}`, x.same ? x.color : null, (hex) => setPcColor(x.index, hex, null)))) : null,
        !many && c.zones.length > 1 && shownZones(c).length ? h('div', { class: 'pc-zones' }, ...shownZones(c).map(([z, i]) => colorRow(/^\?+$/.test(z.name || '') ? `Unnamed ${i + 1}` : z.name, z.color, (hex) => setPcColor(c.index, hex, i)))) : null,
        !many && c.zones.length > 1 && hiddenZoneCount(c) ? h('small', { class: 'faint' }, `${hiddenZoneCount(c)} more part${hiddenZoneCount(c) === 1 ? '' : 's'}: All colors them.`) : null);
    }))
      : h('p', { class: 'faint' }, 'No lights found.'),
    // Find my lights: one color per zone, the person names what lit (ui/find-lights.js)
    findLights(o, redraw),
    h('div', { class: 'actions' },
      button('Undo', async () => { if (isDemo()) { st.orgb = DEMO_ORGB(); redraw(); toast('PC lights undone', 'good'); return; } try { await env.api('/api/openrgb/restore', {}); toast('PC lights undone', 'good'); } catch (e) { toast('Nothing to undo', 'bad', { detail: e.message }); } loadPc(true); }, { kind: 'small', ic: 'undo' }),
      button('Look again', () => loadPc(true), { kind: 'ghost small', ic: 'refresh' })),
    // the built-in OpenRGB reaches USB lights only: the way to the board and RAM stays one click away
    fanHelp(),
    o.bundled || o.board?.setUp ? boardSection() : null);
}

// PC lights on its own, as the Lighting page's third column (23 Oct 2026, Shawn: "remove this [the More fold], I want
// the lighting area non scrollable"); This PC's parts list is no longer on Lighting (Setup lists the devices that need
// something, with the same Learn it and Request support)
// parts with the same name and kind (four RAM sticks) are one part with one color (23 Oct 2026, Shawn: "Put the 4 sticks of
// ram in one area instead of split out"); a board or anything else with zones stays on its own
const groups = (all) => {
  const out = [];
  for (const c of all) {
    const g = c.type === 'ram' && out.find((x) => x[0].type === 'ram' && x[0].name === c.name);
    if (g) g.push(c); else out.push([c]);
  }
  return out;
};

export function pcLightsCard(onRedraw) {
  redraw = onRedraw;
  if (!st.pc && !st.loading) queueMicrotask(() => loadPc());
  return pcLights();
}
export function pcSection(onRedraw) {
  redraw = onRedraw;
  if (!st.pc && !st.loading) queueMicrotask(() => loadPc());
  return h('div', { class: 'grid two top' }, thisPc(), pcLights());
}

// OpenRGB's device type with a capital first letter ("motherboard" reads Motherboard; RAM and LED strip kept as words)
function typeLabel(t) { const s = String(t || ''); return s === 'ram' ? 'RAM' : s === 'ledstrip' ? 'LED strip' : s.charAt(0).toUpperCase() + s.slice(1); }
