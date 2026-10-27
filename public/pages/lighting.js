// Lighting: one color for every device with RGB.
import { h, icon } from '../ui/dom.js';
import { card, slider, button, toggle, pill, OFF } from '../ui/controls.js';
import { devices, write, writeBatch, log, stillLooking, shownDevices } from '../core/devices.js';
import { artOf } from '../ui/art.js';
import { topbar } from './common.js';
import { setGlow, getGlow } from '../core/theme.js';
import { toast } from '../ui/overlay.js';
import { SWATCHES } from '../core/color.js';
import { pcLightsCard, applyPc, pcIncluded, pcAvailable, setPcIncluded, pcPick } from './pc-lights.js';
import { colorPicker } from '../ui/color-picker.js';
import { hexToRgb, rgbToHex } from '../core/color.js';

// off: the Off button was picked (every included light goes dark on Apply to all); any colour picked clears it
const ui = { hex: getGlow() || '#ff6a1a', brightness: 80, off: false, include: { keyboard: true, headset: true } };

// the chosen color on everything that shows it, in place (no redraw: 26 Oct 2026, Shawn: "when I change one it scrolls
// back to the top")
function preview(hex) {
  document.querySelectorAll('.lighting-preview').forEach((el) => el.style.setProperty('--pick', hex));
  if (!ui.off) document.documentElement.style.setProperty('--glow-a', hex);
  applyLabel();
}
let applyBtn = null;
const applyLabel = () => { const t = applyBtn?.querySelector('span'); if (t) t.textContent = ui.off ? 'Turn all off' : 'Apply to all'; };

export async function applyColor(hex, brightness = ui.brightness) {
  ui.hex = hex; ui.brightness = brightness;
  await applyAll();
}

async function applyAll() {
  // Off: black everywhere (the keyboard: brightness 0, so its colour and effect stay for when it is turned back on)
  const [r, g, b] = ui.off ? [0, 0, 0] : hexToRgb(ui.hex);
  const k = ui.off ? 0 : ui.brightness / 100;
  const done = [];
  const t = toast(ui.off ? 'Turning the lights off' : `Applying ${ui.hex.toUpperCase()}`, 'busy', { ms: 0 });
  for (const id of ['keyboard', 'headset']) {
    const d = devices[id];
    if (!ui.include[id] || d.status !== 'connected' || !d.adapter.hasLighting?.()) continue;
    try {
      if (id === 'keyboard') {
        const keys = ui.off ? [['brightness', 0]] : d.adapter.lightingKeys(r, g, b, ui.brightness);
        const res = await writeBatch(id, keys.map(([key, val]) => ({ key, value: val, label: `Lighting ${key}`, display: val })), 'before lighting');
        if (res.failed) throw new Error(`${res.failed} value(s) not set`);
      } else {
        await write(id, 'led', rgbToHex(r * k, g * k, b * k), { label: 'LED color', display: ui.off ? 'off' : ui.hex, silent: true });
      }
      done.push(d.adapter.title);
    } catch (e) { log(`lighting failed: ${e.message}`, 'bad', id); }
  }
  // added devices with one color (my-devices and library drivers), each through its own read-back write
  for (const { d, s } of addedColors()) {
    if (ui.include[d.id] === false || d.status !== 'connected' || s.readOnly) continue;
    try { await write(d.id, s.key, rgbToHex(r * k, g * k, b * k), { label: s.label, display: ui.off ? 'off' : ui.hex, silent: true }); done.push(d.adapter.title); }
    catch (e) { log(`lighting failed: ${e.message}`, 'bad', d.id); }
  }
  // the PC's own lights (board, fans, RAM, graphics card) through OpenRGB, when it runs
  try { const pc = await applyPc(rgbToHex(r * k, g * k, b * k)); if (pc) done.push(pc); } catch (e) { log(`PC lights failed: ${e.message}`, 'bad'); }
  if (!ui.off) setGlow(ui.hex);
  t.update(done.length && ui.off ? `Lights off on ${done.join(' + ')}` : done.length ? `Lighting set on ${done.join(' + ')}` : 'No lit devices', done.length ? 'good' : 'bad', done.length ? undefined : 'Connect a device first.');
}

// the devices this PC has, beyond the built-in three, that take one color (23 Oct 2026, a friend's PC listed Shawn's
// own three devices whatever it had)
function addedColors() {
  return shownDevices().filter((d) => !['mouse', 'keyboard', 'headset'].includes(d.id))
    .map((d) => ({ d, s: (d.adapter.settings || []).find((x) => x.type === 'color' && !x.zones) })).filter((x) => x.s);
}

// the Apply to card: drawn again on its own when a device connects or drops (keepAlive), never the whole page
function targetsCard() {
  const shown = new Set(shownDevices().map((d) => d.id));
  const has = (id) => shown.has(id);
  const target = (id, note) => {
    const d = devices[id];
    const ok = d.status === 'connected' && d.adapter.hasLighting?.();
    const looking = !ok && d.status !== 'connected' && stillLooking();
    return h('div', { class: `target lighting-preview${looking ? ' ghost' : ''}`, style: { '--cc': `var(--c-${id})`, '--pick': ui.off ? OFF : ui.hex } },
      artOf(devices[id]),
      h('div', { class: 'grow' }, h('b', {}, d.adapter.title), h('small', {}, ok ? note : d.status === 'connected' ? 'No lighting' : looking ? 'Looking…' : 'Not connected')),
      toggle({ value: ui.include[id] && ok, disabled: !ok, label: `include ${id}`, onCommit: async (on) => { ui.include[id] = on; } }));
  };
  applyBtn = button(ui.off ? 'Turn all off' : 'Apply to all', applyAll, { kind: 'primary small', ic: 'lighting' });
  // Apply to all sits beside the title (23 Oct 2026, Shawn: "put this next to the apply to text"); only the devices this
  // PC has, by their own names (23 Oct 2026)
  return card([h('h2', {}, 'Apply to'), h('span', { class: 'spacer' }), applyBtn],
    h('div', { class: 'targets' },
      has('keyboard') ? target('keyboard', 'Color and brightness') : null,
      has('headset') ? target('headset', 'LED color') : null,
      ...addedColors().map(({ d, s }) => {
        const ok = d.status === 'connected' && !s.readOnly;
        return h('div', { class: 'target lighting-preview', style: { '--cc': 'var(--signal)', '--pick': ui.off ? OFF : ui.hex } }, h('div', { class: 'target-ic' }, icon(d.adapter.kind === 'Mouse' ? 'mouse' : d.adapter.kind === 'Headset' ? 'headset' : d.adapter.kind === 'Keyboard' ? 'keyboard' : 'lighting')),
          h('div', { class: 'grow' }, h('b', {}, d.adapter.title), h('small', {}, ok ? s.label : d.status !== 'connected' ? 'Not connected' : `${s.label}: turn on settings first`)),
          toggle({ value: ui.include[d.id] !== false && ok, disabled: !ok, label: `include ${d.adapter.title}`, onCommit: async (on) => { ui.include[d.id] = on; } }));
      }),
      has('mouse') ? h('div', { class: 'target', style: { '--cc': 'var(--c-mouse)' } }, artOf(devices.mouse), h('div', { class: 'grow' }, h('b', {}, devices.mouse.adapter.title), h('small', {}, 'No settable lights')), pill('n/a')) : null,
      h('div', { class: 'target lighting-preview', style: { '--cc': 'var(--signal)', '--pick': ui.off ? OFF : ui.hex } }, h('div', { class: 'target-ic' }, icon('lighting')),
        h('div', { class: 'grow' }, h('b', {}, 'PC lights'), h('small', {}, pcAvailable() ? 'Fans, RAM, board and more' : 'When OpenRGB runs')),
        toggle({ value: pcIncluded(), disabled: !pcAvailable(), label: 'include PC lights', onCommit: async (on) => { setPcIncluded(on); } }))));
}
let targetsEl = null;
function refreshTargets() {
  if (!targetsEl?.isConnected) return;
  const next = targetsCard();
  next.classList.add('light-targets');
  targetsEl.replaceWith(next); targetsEl = next;
}

export default {
  id: 'lighting', title: 'Lighting', icon: 'lighting', accent: 'var(--signal)', watches: ['keyboard', 'headset'],
  // a device reading or a connect redraws only the Apply to card: the picker, the PC lights and their scroll stay
  keepAlive() { if (!targetsEl?.isConnected) return false; refreshTargets(); return true; },
  render() {
    const picker = colorPicker({
      hex: ui.hex, off: ui.off, swatches: SWATCHES,
      onInput: (hex) => { ui.hex = hex; ui.off = false; preview(hex); pcPick(hex); },
      onDone: (hex) => { ui.hex = hex; ui.off = false; pcPick(hex, true); },
      onOff: () => { ui.off = !ui.off; picker.setOff(ui.off); preview(ui.off ? OFF : ui.hex); pcPick(ui.off ? OFF : ui.hex); },
    });
    queueMicrotask(() => preview(ui.off ? OFF : ui.hex));
    targetsEl = targetsCard();
    targetsEl.classList.add('light-targets');
    return h('div', { class: 'lighting-page' },
      topbar('All devices', 'Lighting', 'One color for every device.'),
      // one screen, three columns: the color, where it goes, and the PC's own lights (23 Oct 2026, Shawn: "I want the
      // lighting area non scrollable")
      h('div', { class: 'grid light-cols top' },
        card([h('h2', {}, 'Color')], picker.el,
          h('div', { class: 'picker-row' }, h('span', { class: 'muted' }, 'Brightness'),
            slider({ value: ui.brightness, min: 5, max: 100, unit: '%', label: 'Brightness', onCommit: async (x) => { ui.brightness = x; } }))),
        targetsEl,
        pcLightsCard({ pick: () => (ui.off ? OFF : ui.hex), onState: refreshTargets })));
  },
};
