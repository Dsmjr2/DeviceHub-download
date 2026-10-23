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
import { learnThis } from './learn.js';
import { getHelp } from '../ui/get-help.js';
import { genericDongle } from '../core/generic-dongle.js';
import { deviceRows, countNeeds, summaryLine } from '../core/setup-list.js';
import { LIFT_OFF } from '../devices/pulsar.js';
import { reviewSetup } from './backups.js';

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

// A PC with none of the supported devices (yet): the shared library sets known ones up by itself; Learn a device for
// the rest (ADD-YOUR-DEVICES.md for doing it with Claude Code).
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
    h('h2', {}, 'None of your devices are set up yet'),
    h('p', {}, 'DeviceHub sets up known devices by itself: when a device is in its shared library, its driver is installed and it shows up here. Sound, monitors, webcams and most VIA keyboards need no setup.'),
    h('p', {}, 'For any other mouse, headset or keyboard, Learn a device walks you through it: DeviceHub listens while you change one setting at a time in the maker\'s app.'),
    // devices on this PC from a known brand, each with a ready prompt for Claude Code (the brand guide, docs/BRANDS.md)
    (() => {
      if (!pcLoaded()) { loadPc(false, redraw); return null; }
      const found = otherDevices();
      return found.length ? h('div', { class: 'first-found' }, h('h3', {}, 'Found on this PC'),
        ...found.map((u) => {
          // a generic 2.4G receiver: one plain line and Request support instead of Learn it (Learn refuses its chip's id)
          const gd = genericDongle(u);
          return h('div', { class: 'pc-other' }, h('div', { class: 'grow' }, h('b', {}, u.name || (gd ? 'USB receiver' : `${u.brand.name} device`)), h('small', { class: 'faint' }, ` ${u.brand.shared ? u.brand.name : u.brand.name + ' · ' + u.brand.category} · USB ${u.id}`),
            gd ? h('small', { style: { display: 'block' } }, gd.line) : null),
          gd ? getHelp(`request:${u.vid}:${u.pid}`, null, { label: 'Request support', request: { vid: u.vid, pid: u.pid, name: u.name || '' }, kind: 'ghost small' })
            : button('Learn it', () => { learnThis(u.vid, u.pid); go('learn'); }, { kind: 'ghost small', ic: 'plug' }),
          button('Copy a prompt for Claude', () => copyPrompt(u), { kind: 'ghost small' }));
        })) : null;
    })(),
    h('div', { class: 'actions' },
      // everything to set up, on one page (pages/setup.js)
      button('Open Setup', () => go('setup'), { kind: 'primary small', ic: 'check' }),
      button('Learn a device', () => go('learn'), { kind: 'ghost small', ic: 'plug' }),
      button('Monitors', () => go('monitors'), { kind: 'ghost small', ic: 'monitor' }),
      button('Open folder', () => fetch('/api/reveal', { method: 'POST' }), { kind: 'ghost small', ic: 'external' })));
}

// The Set up card (22 Oct 2026; helpers/auto-setup.mjs, GET /api/setup): on a PC where DeviceHub installed something
// from the device library or something still needs attention, what was found, what works now, what is optional and
// what still needs a learning session. Shown only when /api/setup says show (never on a PC where everything is built
// in); Dismiss hides it until the summary says something new (kept in setup.json).
// Another PC's setup in OneDrive (helpers/onedrive-setup.mjs): offered once per copy it saves. Review opens the setup
// file's usual confirmation on the Backups page (every change listed, nothing written before Load).
let oneDriveOffer, oneDriveAsked = false;
function oneDriveBanner(redraw, fresh) {
  if (isDemo()) return null;
  if (fresh) oneDriveAsked = false;   // asked again each time the Overview is opened
  if (!oneDriveAsked) { oneDriveAsked = true; fetch('/api/onedrive').then((r) => (r.ok ? r.json() : null)).then((j) => { oneDriveOffer = j?.others?.find((o) => !o.seen) || null; if (oneDriveOffer) redraw(); }).catch(() => {}); }
  const o = oneDriveOffer;
  if (!o) return null;
  const when = new Date(o.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const notNow = () => { oneDriveOffer = null; redraw(); fetch('/api/onedrive/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pc: o.pc }) }).catch(() => {}); };
  const review = async () => {
    try {
      const r = await fetch(`/api/onedrive/read?pc=${encodeURIComponent(o.pc)}`);
      if (!r.ok) throw new Error(`error ${r.status}`);
      reviewSetup(await r.json(), `on ${o.pc} (${when})`, o.pc);
    } catch (e) { toast('Could not read it', 'bad', { detail: e.message }); }
  };
  return h('div', { class: 'banner info od-offer' }, icon('backups'),
    h('div', { class: 'grow' }, h('b', {}, `Bring your settings from ${o.pc}?`), h('small', {}, `Saved in your OneDrive ${when}. You see every change before anything is loaded.`)),
    h('div', { class: 'actions' }, button('Review', review, { kind: 'primary small' }), button('Not now', notNow, { kind: 'ghost small' })));
}

let setupInfo = null, setupAsked = false, setupHidden = false;
// Short since 22 Oct 2026 (Shawn: "I want the setup to all be on one page"): one line saying how many things need the
// person, and Open Setup (pages/setup.js has every row and button). Counted the Setup page's way (core/setup-list.js).
function setupCard(redraw) {
  if (isDemo() || setupHidden) return null;
  if (!setupAsked) {
    setupAsked = true;
    fetch('/api/setup').then((r) => (r.ok ? r.json() : null)).then((j) => { setupInfo = j; if (j?.show) redraw(); }).catch(() => {});
  }
  const s = setupInfo;
  if (!s?.show) return null;
  const n = countNeeds(deviceRows(s));
  if (!n) return null;   // all set: no card (22 Oct 2026, docs/handoff/setup-simpler.md)
  const dismiss = () => { setupHidden = true; redraw(); fetch('/api/setup/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature: s.signature }) }).catch(() => {}); };
  return h('div', { class: 'panel setup-card short' },
    h('div', { class: 'su-top' }, icon('plug', 'ic'), h('h2', {}, summaryLine(n)),
      h('span', { class: 'spacer' }),
      button('Open Setup', () => { location.hash = '#/setup'; }, { kind: 'primary small' }),
      button('Hide', dismiss, { kind: 'ghost small' })));
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

// Batteries Windows already knows (22 Oct 2026, Shawn: "work with ANY headset, mouse, keyboard"): any connected Bluetooth
// headset, earbuds, controller or mouse with its level, read-only from Windows (GET /api/bluetooth, at most once a
// minute here). Shown only when there is one; a level Windows kept from before the device disconnected is left out.
let bt = null, btAt = 0;
const DEMO_BT = [{ name: 'Xbox Wireless Controller', connected: true, battery: 80 }, { name: 'AirPods Pro', connected: true, battery: 45 }];
function batteries(redraw) {
  if (isDemo()) bt = DEMO_BT;
  else if (Date.now() - btAt > 60000) { btAt = Date.now(); env.api('/api/bluetooth').then((x) => { bt = Array.isArray(x) ? x : []; redraw(); }).catch(() => {}); }
  const list = (bt || []).filter((d) => d.connected && d.battery != null);
  if (!list.length) return null;
  return h('div', { class: 'ov-batteries', 'aria-label': 'Bluetooth batteries' },
    h('span', { class: 'ov-bat-label' }, 'Batteries'),
    ...list.map((d) => h('span', { class: `ov-bat${d.battery <= 10 ? ' bad' : d.battery <= 20 ? ' warn' : ''}` },
      h('i', { style: { '--lvl': `${Math.max(4, Math.min(100, d.battery))}%` } }), h('span', {}, d.name), h('b', {}, `${d.battery}%`))));
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
      oneDriveBanner(redraw, fresh),
      setupCard(redraw),
      noDevicesYet() ? firstRun(go, redraw)
        : h('div', { class: 'bays', style: { gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` } }, ...list.map((d) => bay(d, go, redraw))),
      batteries(redraw),
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
