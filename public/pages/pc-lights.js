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
import { viaFileNote, isViaKeyboard } from './keyboard.js';

const DEMO_PC = {
  cpu: 'AMD Ryzen 7 5800X3D', gpus: [{ name: 'NVIDIA GeForce RTX 4070', maker: 'MSI' }], board: { maker: 'Gigabyte Technology Co., Ltd.', model: 'B450 AORUS PRO WIFI-CF' },
  ram: [{ part: 'F4-3200C16-8GVKB', gb: 8, maker: 'G.Skill', lights: 'no' }, { part: 'F4-3200C16-8GVKB', gb: 8, maker: 'G.Skill', lights: 'no' }],
  usb: [{ id: '1b1c:0a6b', vid: '1b1c', name: 'CORSAIR HS80 RGB Wireless Gaming Headset', runs: 'Headset page' }, { id: '046d:c547', vid: '046d', name: 'USB Receiver', runs: null }],
  lampArrays: 0, smbus: ['AMD SMBus'],
};
// demo: OpenRGB running with a pretend board and lit RAM (colors change on the page only; nothing is sent)
const DEMO_ORGB = () => ({ running: true, protocol: 3, controllers: [
  { index: 0, name: 'B450 AORUS PRO WIFI-CF', vendor: 'Gigabyte', type: 'motherboard', zones: [{ name: 'Motherboard', leds: 5 }, { name: 'D_LED1 header', leds: 30 }], leds: 35, mode: 'Static', color: '#ff6a1a', same: true },
  { index: 1, name: 'Trident Z RGB', vendor: 'G.Skill', type: 'ram', zones: [{ name: 'DRAM', leds: 8 }], leds: 8, mode: 'Rainbow', color: '#ff0000', same: false }] });
const DEMO_BT = [{ name: 'Xbox Wireless Controller', le: true, connected: true, battery: 80 }, { name: 'AirPods Pro', le: false, connected: false, battery: null }];
const st = { bt: null, pc: null, orgb: null, loading: false, error: null, include: true };
let redraw = () => {};

export async function loadPc(fresh = false, after) {
  if (isDemo()) { const first = !st.pc; st.pc = DEMO_PC; if (!st.orgb) st.orgb = DEMO_ORGB(); st.bt = DEMO_BT; if (first) redraw(); return; }
  if (st.loading) return; st.loading = true;
  try {
    const [pc, orgb] = await Promise.all([env.api(`/api/pc${fresh ? '?fresh=1' : ''}`), env.api(`/api/openrgb${fresh ? '?fresh=1' : ''}`)]);
    st.pc = pc; st.orgb = orgb; st.error = null;
    env.api(`/api/bluetooth${fresh ? '?fresh=1' : ''}`).then((bt) => { st.bt = bt; redraw(); }).catch(() => {});
  } catch (e) { st.error = e.message; }
  finally { st.loading = false; redraw(); if (after) after(); }
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
  if (!pc) return card([h('h2', {}, 'This PC')], h('p', { class: 'faint' }, st.error ? `Could not read this PC: ${st.error}` : 'Reading what is inside…'));
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
      line('Processor', pc.cpu, null, 'A lit cooler follows the board, or shows below if it is on USB.', null),
      line(pc.gpus?.length > 1 ? 'Graphics' : 'Graphics card', (pc.gpus || []).map((g) => `${g.maker ? g.maker + ' ' : ''}${g.name}`).join(', ') || null, null, 'Lights, if this model has them: through OpenRGB.', null),
      line('Motherboard', board, null, boardSmbus ? 'Its lights and RGB headers: through OpenRGB only.' : 'Its lights: through OpenRGB.', null),
      line('Memory', ramParts.join(', '), ramLit ? 'yes' : ramNone ? 'no' : 'unknown', ramLit ? 'Through OpenRGB only.' : null, null),
      line('Case and fans', 'lit fans and strips', null, 'Follow the board when plugged into its RGB headers.', null),
      // Windows Dynamic Lighting: the lights work in Windows itself, no driver; one click opens that page (22 Oct 2026)
      pc.lampArrays ? h('div', {}, line('Dynamic Lighting', `${pc.lampArrays} device${pc.lampArrays === 1 ? '' : 's'}`, 'yes', 'Works in Windows, no driver needed: colors and effects in Windows Settings.', null),
        h('div', { class: 'actions', style: { margin: '6px 0 0' } }, button('Open Dynamic Lighting', openDynamicLighting, { kind: 'ghost small', ic: 'external' }))) : null),
    others.length ? h('div', { class: 'pc-others' }, h('h3', {}, 'Other devices plugged in'),
      ...others.map((u) => h('div', { class: 'pc-other' }, line(u.brand.shared ? 'USB device' : u.brand.name, u.name || `${u.brand.name} device`, null, null, u.brand),
        // a VIA keyboard needs no learning, only its layout file when VIA's library lacks it (keyboard.js viaFileNote)
        isViaKeyboard(u) ? viaFileNote(u.vid, u.pid, u.brand.name) : null,
        h('div', { class: 'actions' }, button('Learn it', () => { learnThis(u.vid, u.pid); location.hash = '#/learn'; }, { kind: 'ghost small', ic: 'plug' }),
          button('Copy a prompt for Claude', () => copyPrompt(u), { kind: 'ghost small' })),
        // or ask for it: a short request for GitHub with its USB id, shown in full first (ui/get-help.js)
        getHelp(`request:${u.vid}:${u.pid}`, null, { label: 'Request support', request: { vid: u.vid, pid: u.pid, name: u.name || '' } })))) : null,
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
  try { await navigator.clipboard.writeText(devicePrompt(u)); toast('Prompt copied', 'good', { detail: 'Paste it into Claude Code, opened in the DeviceHub folder.' }); }
  catch { toast('Could not copy', 'bad'); }
}

const openDynamicLighting = () => env.api('/api/diagnose/action', { kind: 'settings', page: 'lighting' }).catch((e) => toast('Could not open Windows Settings', 'bad', { detail: e.message }));

// How to add the board, fan and RAM lights (22 Oct 2026, Shawn: "as simple as possible"): they need the person's own
// OpenRGB, and for the board and RAM the PawnIO driver. DeviceHub never installs either (CLAUDE.md); this only says how.
function boardGuide(open = false, again = 'Look again') {
  const step = (n, ...text) => h('li', {}, h('span', { class: 'gh-num' }, String(n)), h('span', {}, ...text));
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h('details', { class: 'pc-guide', open: open || null },
    h('summary', {}, 'Add your board, fan and RAM lights'),
    h('ol', { class: 'gh-steps' },
      step(1, 'Download OpenRGB 1.1 or newer, free, from ', link('https://openrgb.org', 'openrgb.org'), '.'),
      step(2, 'For the motherboard and RAM: install PawnIO from ', link('https://pawnio.eu', 'pawnio.eu'), '. It is a signed Windows driver, so it is your choice. Graphics cards and USB lights work without it.'),
      step(3, 'Open OpenRGB as administrator (right-click it, Run as administrator) and let it find your lights.'),
      step(4, 'In OpenRGB, open the SDK Server tab and press Start Server.'),
      step(5, `Come back here and press ${again}. The lights show here and in Apply to all.`)),
    h('p', { class: 'faint', style: { fontSize: '12px', margin: '8px 0 0' } }, 'DeviceHub never writes to the board or RAM itself: everything goes through OpenRGB.'));
}

function pcLights() {
  const o = st.orgb;
  const head = [h('h2', {}, 'PC lights')];
  if (!o) return card(head, skeleton([66, 48]));
  // the OpenRGB shipped inside DeviceHub (helpers/openrgb.js): started hidden, USB lights only, when this asks for it
  const b = o.bundle;
  if (!o.running) {
    return card(head,
      b?.canStart ? h('p', { class: 'faint' }, `DeviceHub carries OpenRGB ${b.version} for USB lights (no drivers, so not the board, RAM or graphics card). Find lights starts it hidden; it stops when DeviceHub quits.`)
        : h('p', { class: 'faint' }, 'Board, fan and RAM lights work through OpenRGB 1.1 or newer, a free app (openrgb.org). Open it and turn on its SDK server; the lights then show here and in Apply to all.'),
      o.reason && o.reason !== 'not running' ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, o.reason) : null,
      h('div', { class: 'actions' }, button(b?.canStart ? 'Find lights' : 'Look again', () => loadPc(true), { kind: 'small', ic: 'refresh' })),
      boardGuide(!b?.canStart, b?.canStart ? 'Find lights' : 'Look again'));
  }
  return card([...head, h('span', { class: 'spacer' }), pill(`${o.controllers.length} found`, 'good')],
    o.bundled ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, `Through the OpenRGB inside DeviceHub: USB lights only${o.readOnly ? '; read only for now (this OpenRGB version numbers lights wrongly for DeviceHub)' : ''}.`) : null,
    o.controllers.length ? h('div', { class: 'pc-parts' }, ...o.controllers.map((c) => h('div', { class: 'pc-part' },
      h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, c.type), h('b', {}, c.name),
        c.color ? h('span', { class: 'dot', style: { background: c.same ? c.color : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }, title: c.same ? c.color : 'several colors' }) : null),
      h('small', { class: 'faint' }, [c.mode ? `Mode: ${c.mode}` : null, `${c.leds} light${c.leds === 1 ? '' : 's'}`, c.zones.length > 1 ? c.zones.map((z) => z.name).join(', ') : null].filter(Boolean).join(' · ')))))
      : h('p', { class: 'faint' }, 'OpenRGB runs but found no lights.'),
    h('div', { class: 'actions' },
      button('Undo', async () => { if (isDemo()) { st.orgb = DEMO_ORGB(); redraw(); toast('PC lights undone', 'good'); return; } try { await env.api('/api/openrgb/restore', {}); toast('PC lights undone', 'good'); } catch (e) { toast('Nothing to undo', 'bad', { detail: e.message }); } loadPc(true); }, { kind: 'small', ic: 'undo' }),
      button('Look again', () => loadPc(true), { kind: 'ghost small', ic: 'refresh' })),
    // the built-in OpenRGB reaches USB lights only: the way to the board and RAM stays one click away
    o.bundled ? boardGuide() : null);
}

export function pcSection(onRedraw) {
  redraw = onRedraw;
  if (!st.pc && !st.loading) queueMicrotask(() => loadPc());
  return h('div', { class: 'grid two top' }, thisPc(), pcLights());
}
