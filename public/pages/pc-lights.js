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
      pc.lampArrays ? line('Dynamic Lighting', `${pc.lampArrays} device${pc.lampArrays === 1 ? '' : 's'}`, 'yes', 'Set in Windows Settings > Personalization > Dynamic Lighting.', null) : null),
    others.length ? h('div', { class: 'pc-others' }, h('h3', {}, 'Other devices plugged in'),
      ...others.map((u) => h('div', { class: 'pc-other' }, line(u.brand.shared ? 'USB device' : u.brand.name, u.name || `${u.brand.name} device`, null, null, u.brand),
        button('Copy a prompt for Claude', () => copyPrompt(u), { kind: 'ghost small', title: 'A ready prompt to add this device with Claude Code' })))) : null,
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

function pcLights() {
  const o = st.orgb;
  const head = [h('h2', {}, 'PC lights')];
  if (!o) return card(head, skeleton([66, 48]));
  if (!o.running) {
    return card(head,
      h('p', { class: 'faint' }, 'Board, fan and RAM lights work through OpenRGB 1.1 or newer, a free app (openrgb.org). Open it and turn on its SDK server; the lights then show here and in Apply to all.'),
      h('div', { class: 'actions' }, button('Look again', () => loadPc(true), { kind: 'small', ic: 'refresh' })));
  }
  return card([...head, h('span', { class: 'spacer' }), pill(`${o.controllers.length} found`, 'good')],
    o.controllers.length ? h('div', { class: 'pc-parts' }, ...o.controllers.map((c) => h('div', { class: 'pc-part' },
      h('div', { class: 'pc-part-head' }, h('span', { class: 'muted' }, c.type), h('b', {}, c.name),
        c.color ? h('span', { class: 'dot', style: { background: c.same ? c.color : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }, title: c.same ? c.color : 'several colors' }) : null),
      h('small', { class: 'faint' }, [c.mode ? `Mode: ${c.mode}` : null, `${c.leds} light${c.leds === 1 ? '' : 's'}`, c.zones.length > 1 ? c.zones.map((z) => z.name).join(', ') : null].filter(Boolean).join(' · ')))))
      : h('p', { class: 'faint' }, 'OpenRGB runs but found no lights.'),
    h('div', { class: 'actions' },
      button('Put back as before', async () => { if (isDemo()) { st.orgb = DEMO_ORGB(); redraw(); toast('PC lights put back', 'good'); return; } try { await env.api('/api/openrgb/restore', {}); toast('PC lights put back', 'good'); } catch (e) { toast('Nothing to put back', 'bad', { detail: e.message }); } loadPc(true); }, { kind: 'small', ic: 'undo' }),
      button('Look again', () => loadPc(true), { kind: 'ghost small', ic: 'refresh' })));
}

export function pcSection(onRedraw) {
  redraw = onRedraw;
  if (!st.pc && !st.loading) queueMicrotask(() => loadPc());
  return h('div', { class: 'grid two top' }, thisPc(), pcLights());
}
