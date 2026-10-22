// Overview: one bay per device, quick profiles and the activity feed.
import { h, icon, fmt } from '../ui/dom.js';
import { env } from '../core/env.js';
import { ring, button, card, pill, batteryCell, loadBatteryEstimates, skeleton } from '../ui/controls.js';
import { devices, activity, connect, isDemo, isRemote, shownDevices, noDevicesYet, stillLooking } from '../core/devices.js';
import { artOf, genericArtFor } from '../ui/art.js';
import { prettyExe } from '../core/autoswitch.js';
import { statusPill } from './common.js';
import { loadProfiles, apply } from '../core/profiles.js';
import { EFFECTS } from '../devices/keycodes.js';
import { meter, micState, dots, signal, colorDot } from '../ui/gauges.js';
import { toast } from '../ui/overlay.js';
import { loadPc, otherDevices, pcLoaded, copyPrompt } from './pc-lights.js';
import { LIFT_OFF } from '../devices/pulsar.js';

let profiles = null;
let loading = false;

// The keyboard's lighting effect by name ("Solid" for effect 1), not its number.
const effectName = (n) => { const e = EFFECTS[n]; if (e == null) return n ?? '—'; const t = e === 'solid color' ? 'solid' : e.split(' ')[0]; return t[0].toUpperCase() + t.slice(1); };
// The headset's EQ preset (iCUE's preset file: the first slot that holds a known preset, measured 19 Oct 2026 as
// slot 2 = "Custom Preset 1"). Read once per minute at most.
let eq = null, eqAt = 0;
function eqName(redraw) {
  if (!isDemo() && Date.now() - eqAt > 60000) {
    eqAt = Date.now();
    fetch('/api/eq').then((r) => r.json()).then((j) => { eq = j; redraw(); }).catch(() => {});
  }
  if (isDemo()) return 'Custom Preset 1';
  const names = Object.fromEntries((eq?.presets || []).map((p) => [p.id, p.name]));
  if (eq?.engine === 'eqapo') return names[eq.activeId] || '—';
  const slot = (eq?.slots || []).find((x) => names[x.id]);
  return slot ? names[slot.id] : '—';
}

const COLORS = { mouse: 'var(--c-mouse)', headset: 'var(--c-headset)', keyboard: 'var(--c-keyboard)' };

function readouts(d, redraw) {
  const v = d.values;
  if (d.status !== 'connected') return [];
  // receiver plugged in but the headset off: nothing to show, its values are only the last ones it had
  if (d.id === 'headset' && !v.headsetOn) return [];
  // values as small gauges in the battery's style (ui/gauges.js); the EQ name and lift-off stay words
  if (d.id === 'mouse') return [['DPI', dots({ n: v.dpiStage, of: v.stageCount || 4, value: fmt(v[`dpi${(v.dpiStage || 1) - 1}`]) })], ['Polling', signal({ hz: v.pollingRate })], ['Lift-off', LIFT_OFF[v.liftOff] || '—']];
  if (d.id === 'headset') return [['Volume', meter({ ic: 'volume', pct: v['vol:playback'], value: v['vol:playback'] != null ? `${v['vol:playback']}%` : '—' })], ['Mic', micState({ on: v['prop:micEnabled'] })], ['EQ Profile', eqName(redraw)]];
  if (d.id === 'keyboard') {
    const layers = d.adapter.session?.info.layers;
    const pctB = v.brightness != null ? (v.brightness >= 250 ? 100 : Math.round((v.brightness / 255) * 100)) : null;
    const color = v.hue != null ? `hsl(${Math.round((v.hue / 255) * 360)} ${Math.round(((v.saturation ?? 255) / 255) * 100)}% 55%)` : null;
    return [['Layers', dots({ of: layers || 1, value: layers ?? '—' })], ['Backlight', meter({ ic: 'lighting', pct: pctB, value: pctB != null ? `${pctB}%` : '—' })], ['Effect', colorDot({ color, value: effectName(v.effect) })]];
  }
  return [];
}

// A PC with none of the supported devices (yet): what DeviceHub supports, and how to add your own (ADD-YOUR-DEVICES.md).
// While the window has just opened it only says it is looking, so a PC that has them never flashes this.
function firstRun(go, redraw) {
  // the first seconds: the three device tiles as faint generic drawings with a light sweeping over them, marked Looking, and
  // shimmering lines where their readings will be (21 Oct 2026, Shawn: a splash that shows the tiles loading)
  if (stillLooking()) {
    setTimeout(redraw, 12500);
    return h('div', { class: 'bays', style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } }, ...[['mouse', 'Mouse'], ['headset', 'Headset'], ['keyboard', 'Keyboard']].map(([id, kind]) =>
      h('div', { class: 'bay ghost', 'aria-label': `Looking for the ${kind.toLowerCase()}` },
        h('div', { class: 'bay-top' }, h('span', { class: 'bay-kind' }, kind), h('span', { class: 'ghost-pill' }, h('i'), 'Looking')),
        // a plain outline of the kind of device, not a particular model (Shawn: "generic so anyone with any device just sees it")
        h('div', { class: 'bay-art' }, genericArtFor[id]()),
        h('div', { class: 'bay-head' }, skeleton([62])),
        h('div', { class: 'readouts' }, skeleton([80, 64, 72])))));
  }
  return h('div', { class: 'panel first-run' },
    h('h2', {}, 'None of your devices are supported yet'),
    h('p', {}, 'DeviceHub knows the Pulsar X-Lite CrazyLight, the Corsair HS80 RGB Wireless and the Epomaker P75. Plug one in and it shows up here.'),
    h('p', {}, 'To add your own mouse, headset or keyboard, open this folder in Claude Code and follow ADD-YOUR-DEVICES.md.'),
    // devices on this PC from a known brand, each with a ready prompt for Claude Code (the brand guide, docs/BRANDS.md)
    (() => {
      if (!pcLoaded()) { loadPc(false, redraw); return null; }
      const found = otherDevices();
      return found.length ? h('div', { class: 'first-found' }, h('h3', {}, 'Found on this PC'),
        ...found.map((u) => h('div', { class: 'pc-other' }, h('div', { class: 'grow' }, h('b', {}, u.name || `${u.brand.name} device`), h('small', { class: 'faint' }, ` ${u.brand.shared ? u.brand.name : u.brand.name + ' · ' + u.brand.category} · USB ${u.id}`)),
          button('Copy a prompt for Claude', () => copyPrompt(u), { kind: 'ghost small' })))) : null;
    })(),
    h('div', { class: 'actions' },
      button('Open folder', () => fetch('/api/reveal', { method: 'POST' }), { kind: 'primary small', ic: 'external' }),
      button('Monitors', () => go('monitors'), { kind: 'ghost small', ic: 'monitor' })));
}

function bay(d, go, redraw) {
  const a = d.adapter;
  const ro = readouts(d, redraw);
  const bat = d.battery?.percent;
  const sub = d.status === 'connected' ? (d.id === 'headset' && !d.values.headsetOn ? 'Receiver connected · headset off' : 'Ready') : d.status === 'asleep' ? 'Asleep, move it to wake' : d.error || (d.id === 'headset' ? 'Plug in the receiver or its cable' : isRemote() ? 'Not plugged in' : d.id === 'keyboard' ? 'One click after Chrome restarts' : 'Not connected yet');
  const muted = d.id === 'headset' && d.values?.['prop:micEnabled'] === false;
  const off = d.status === 'connected' && d.id === 'headset' && !d.values.headsetOn;
  const el = h('div', { class: `bay ${d.status}${muted ? ' mic-muted' : ''}${off ? ' off' : ''}`, 'data-dev': d.id, 'data-shape': `${d.status}|${ro.length}|${bat != null}`, role: 'button', tabindex: 0, style: { '--cc': COLORS[d.id] }, onclick: () => go(d.id), onkeydown: (e) => { if (e.key === 'Enter') go(d.id); } },
    // the pill carries the state: CONNECTED, ASLEEP, HEADSET OFF ... (no "Ready" line under the name)
    h('div', { class: 'bay-top' }, h('span', { class: 'bay-kind' }, a.kind), linkStatus(d, off)),
    h('div', { class: 'bay-art' }, artOf(d)),
    // the name, with the battery beside it on the right (Shawn, 19 Oct 2026); up to two lines, the same height on all three
    h('div', { class: 'bay-head' }, h('h3', {}, a.title),
      bat != null ? batteryCell({ id: d.id, percent: bat, charging: d.battery?.charging || /cable/i.test(d.info?.Control || ''), reported: d.battery?.reported, compact: true }) : null),
    // the pill says the state; no extra line, so the three names always line up
    // a short spec list: the setting's name on the left, its value on the right, the full tile width for long values
    // the off note sits in the values area, so all three names stay on one line
    // (the Connect button too, for a device that is not connected)
    // no "Turned off" line: the pill at the top says it (Shawn, 21 Oct 2026)
    h('div', { class: 'readouts' }, ...ro.map(([k, v]) => h('div', { class: 'readout' }, h('span', {}, k), v instanceof Node ? v : h('b', { title: String(v) }, v))),
      ['idle', 'missing', 'error'].includes(d.status) && !(isRemote() && d.status !== 'error') ? h('div', { class: 'bay-cta', onclick: (e) => e.stopPropagation() },
        button('Connect', () => connect(d.id, d.id !== 'headset'), { kind: 'primary small', ic: 'plug' })) : null));
  return el;
}

// Live tiles: a device change updates its tile in place (numbers, battery ring, status line, mute) without
// redrawing the page, so the pixel animations keep running and nothing flickers. A change of shape (connected ->
// asleep, a battery appearing) rebuilds just that tile. New activity only refreshes the Activity list.
let ctx = null;
// The three values rows share the tallest one's height (a long value like "Custom Preset 1" can take two lines in a
// narrow window), so the drawings, names and batteries of all three tiles stay level.
function levelTiles() {
  const rows = [...document.querySelectorAll('.page.ov .bay .readouts')];
  rows.forEach((r) => { r.style.minHeight = ''; });
  const tallest = Math.max(0, ...rows.map((r) => r.offsetHeight));
  rows.forEach((r) => { r.style.minHeight = `${tallest}px`; });
}
let levelQueued = false;
const levelSoon = () => { if (levelQueued) return; levelQueued = true; requestAnimationFrame(() => { levelQueued = false; levelTiles(); }); };
window.addEventListener('resize', levelSoon);
function patchBay(d) {
  const old = document.querySelector(`.page.ov .bay[data-dev="${d.id}"]`);
  if (!old || !ctx) return false;
  const fresh = bay(d, ctx.go, ctx.redraw);
  if (old.dataset.shape !== fresh.dataset.shape) { old.replaceWith(fresh); levelSoon(); return true; }
  old.classList.toggle('mic-muted', fresh.classList.contains('mic-muted'));
  const pairs = [['.bay-top .link', 'outerHTML']];  // the live link (it replaced the pill; 22 Oct 2026: it kept saying Connected while charging)
  for (const [sel, prop] of pairs) { const a = old.querySelector(sel), b = fresh.querySelector(sel); if (a && b && a[prop] !== b[prop]) a[prop] = b[prop]; }
  const ra = old.querySelectorAll('.readout'), rb = fresh.querySelectorAll('.readout');
  let changed = false;
  rb.forEach((b, i) => { const a = ra[i]; if (a && a.innerHTML !== b.innerHTML) { a.innerHTML = b.innerHTML; changed = true; } });
  // a shown setting changed: the device acknowledges with a short bounce
  if (changed) levelSoon();
  if (changed) { old.classList.remove('ack'); void old.offsetWidth; old.classList.add('ack'); setTimeout(() => old.classList.remove('ack'), 450); }
  const ringA = old.querySelector('.bay-head'), ringB = fresh.querySelector('.bay-head');
  if (ringA && ringB && ringA.outerHTML !== ringB.outerHTML) ringA.replaceWith(ringB);
  return true;
}
function patchFeed() {
  const old = document.querySelector('.page.ov .ov-bottom .feed, .page.ov .ov-bottom .feed-empty');
  if (!old) return false;
  const top = old.scrollTop;
  const f = feed();
  old.replaceWith(f);
  f.scrollTop = top;
  return true;
}

// Activity: what actually changed. Connection chatter, internal light / recorder notes and raw internal names are
// left out; repeats are merged; failures always show.
const NOISE = [/ connected$/, /unplugged$/, /asleep/, /light catcher/i, /took over its lights/, /hidden while the headset/, /Wireless (sound|mic) back$/,
  /set to match/, /^Receiver light/, /^Closed (the Pulsar app|iCUE)/, /^[a-z]+:[a-z]+ →/i, /^Mic light catcher/];
const meaningful = (a) => a.kind === 'bad' || !NOISE.some((re) => re.test(a.text || ''));
const SHORT = { mouse: 'Mouse', headset: 'Headset', keyboard: 'Keyboard' };
let titles = {};
fetch('/api/games?titles=1').then((r) => (r.ok ? r.json() : {})).then((t) => { titles = t || {}; patchFeed(); }).catch(() => {});
const title = (exe) => titles[String(exe).toLowerCase()] || prettyExe(exe);
function plain(text) {
  let m;
  if ((m = /^Auto-switch: (.+?) started, applied "(.+?)" \(\d+ changed(?:, (\d+) failed)?\)$/.exec(text))) return `${title(m[1])} started · ${m[2]} profile${m[3] ? ` (${m[3]} failed)` : ''}`;
  if ((m = /^Auto-switch: game closed, applied "(.+?)" \(\d+ changed(?:, (\d+) failed)?\)$/.exec(text))) return `Game closed · ${m[1]} profile${m[2] ? ` (${m[2]} failed)` : ''}`;
  if ((m = /^Settings from (.+?) loaded \((.+)\)$/.exec(text))) return `Synced ${m[2]} settings from ${m[1]}`;
  if ((m = /^Profile "(.+?)": \d+ changed$/.exec(text))) return `${m[1]} profile applied`;
  // '#0 none' style effect numbers read as just the name
  return text.replace(/ \(confirmed\)$/, '').replace(/→ #\d+ (\w)/, (_, c) => `→ ${c.toUpperCase()}`);
}
const when = (d) => {
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d >= today ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
};
function feed() {
  const items = [];
  for (let a of activity) {
    if (!meaningful(a)) continue;
    const prev = items[items.length - 1];
    a = { ...a, text: plain(a.text || '') };
    // "X profile applied" right under the auto-switch that applied it says the same thing
    if (prev && / profile applied$/.test(a.text) && prev.text.includes(` · ${a.text.replace(/ applied$/, '')}`)) continue;
    if (prev && prev.text === a.text && prev.device === a.device) { prev.n++; continue; }  // merge repeats
    items.push({ ...a, n: 1 });
    if (items.length >= 60) break;
  }
  if (!items.length) return h('div', { class: 'feed-empty' }, 'Changes you make show up here.');
  return h('div', { class: 'feed' }, ...items.map((a) => h('div', { class: `feed-item ${a.kind}` },
    h('time', {}, when(a.at)),
    a.device ? h('span', { class: 'feed-dev', style: { '--cc': COLORS[a.device] } }, SHORT[a.device] || a.device) : h('span', { class: 'feed-dev' }, 'DeviceHub'),
    h('span', {}, a.text, a.n > 1 ? h('span', { class: 'faint' }, ` ×${a.n}`) : null))));
}

// the graphics card's temperature in a small chip (20 Oct 2026): read every 5 s only while the overview is open (it
// changes its own text, never redraws the page) and stops as soon as the overview is left; click = the Fans page
let gpuTimer = null, gpuText = null;
function gpuChip(go) {
  const el = h('button', { class: 'pill gpu-chip', title: 'Graphics card temperature (Fans page)', onclick: () => go('fans') }, icon('thermo'), h('span', {}, gpuText || 'GPU'));
  const tick = async () => {
    if (location.hash !== '#/overview' && location.hash !== '' && location.hash !== '#/') { clearInterval(gpuTimer); gpuTimer = null; return; }
    if (document.hidden) return;
    if (isDemo()) gpuText = 'GPU 61 °C';
    else try { const g = (await env.api('/api/gpu')).gpus?.[0]; gpuText = g?.tempC != null ? `GPU ${g.tempC} °C` : null; } catch { gpuText = null; }
    const span = document.querySelector('.gpu-chip span');
    if (span) span.textContent = gpuText || 'GPU';
    document.querySelector('.gpu-chip')?.toggleAttribute('hidden', !gpuText);
  };
  if (!gpuTimer) { gpuTimer = setInterval(tick, 5000); setTimeout(tick, 200); }
  if (!gpuText) el.hidden = true;
  return el;
}

// The state as a live link from the device to this PC (21 Oct 2026, Shawn: "something more unique than the current
// connected and off"): connected, small lights travel along the line to the PC like data; asleep, one slow amber light;
// switched off or not connected, the line is broken in red. CSS only (transform and opacity), so it costs nothing.
function linkStatus(d, off) {
  const st = off ? 'off' : d.status === 'connected' ? 'live' : d.status === 'asleep' ? 'asleep' : d.status === 'connecting' ? 'asleep' : 'none';
  const text = off ? 'Headset off' : st === 'live' && d.battery?.charging ? 'Charging' : { live: 'Connected', asleep: d.status === 'connecting' ? 'Connecting' : 'Asleep', none: 'Not connected' }[st];
  return h('div', { class: `link ${st}`, role: 'status', 'aria-label': text },
    h('span', { class: 'link-label' }, text),
    h('span', { class: 'link-track' }, h('i'), h('i'), h('i')),
    h('span', { class: 'link-pc' }, icon('tower')));
}

export default {
  id: 'overview', title: 'Overview', icon: 'overview',
  // handled in place (see patchBay): no page redraw for a device or activity change
  keepAlive(id) {
    if (id === 'activity') return patchFeed();
    return devices[id] ? patchBay(devices[id]) : false;
  },
  render({ go, fresh, redraw }) {
    ctx = { go, redraw };
    levelSoon();
    loadBatteryEstimates(redraw);
    if ((fresh || profiles === null) && !loading) {
      loading = true;
      loadProfiles().then((p) => { profiles = p; loading = false; redraw(); });
    }
    // only the devices this PC has (core/devices.js shownDevices); all three until one has been seen
    const list = shownDevices();
    const live = list.filter((d) => d.status === 'connected').length;
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Late session' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return h('div', { class: 'ov' },

      isDemo() ? h('div', { class: 'banner info' }, icon('shield'), h('div', { class: 'grow' }, h('b', {}, 'Demo with pretend devices'),
        h('small', {}, 'Click anything: change DPI, remap keys, switch profiles. The values start from a real Pulsar X-Lite, Corsair HS80 and Epomaker P75, and nothing leaves this page. The real app runs on the PC and talks to the devices over USB.'))) : null,
      noDevicesYet() ? firstRun(go, redraw)
        : h('div', { class: 'bays', style: { gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` } }, ...list.map((d) => bay(d, go, redraw))),
      h('div', { class: 'grid ov-bottom' },
        card([h('h2', {}, 'Profiles'), h('span', { class: 'spacer' }), button('Manage', () => go('profiles'), { kind: 'ghost small' })],
          profiles?.length
            ? h('div', { class: 'ov-profiles' }, ...profiles.map((p, i) => button(p.name, async () => {
              const r = await apply(p);
              toast(`Profile "${p.name}" applied`, r.failed ? 'bad' : 'good', { detail: `${r.done} changed, ${r.failed} failed, ${r.skipped} skipped` });
            }, { kind: 'small', ic: 'profiles' })))
            : h('div', { class: 'feed-empty' }, 'No profiles yet. Set things up the way you like, then save it as a profile.')),
        card([h('h2', {}, 'Activity'), h('span', { class: 'spacer' }), gpuChip(go)], feed())));
  },
};
