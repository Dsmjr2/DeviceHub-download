// The page of a device added in my-devices/ (21 Oct 2026; helpers/my-devices.mjs): drawn from the settings its device
// file lists, so adding a device needs no page code, and an update to DeviceHub never touches it. The same rules as the
// built-in pages: every change backed up, written one at a time and read back (public/core/devices.js), Undo, changes
// that wait while it is away.
import { h, icon } from '../ui/dom.js';
import { card, row, slider, toggle, segmented, pill, readout, colorRow, lineList, remapSelect } from '../ui/controls.js';
import { devices, write, prepare, connect } from '../core/devices.js';
import { topbar, deviceActions, kv, statusPill, isAway, awayBanner, undoButton, checkAnswer, deviceHelp } from './common.js';
import { artOf } from '../ui/art.js';
import { button } from '../ui/controls.js';
import { modal, toast } from '../ui/overlay.js';
import { isDemo } from '../core/devices.js';
import { worksReport, offersWorks } from '../ui/works-report.js';
import { guidedTest } from '../ui/guided-test.js';
import { pollingTest, pollHzOf } from '../ui/polling-test.js';
import { pointerCard } from '../ui/pointer-card.js';
import { batteryCell } from '../ui/controls.js';
import { dots, signal } from '../ui/gauges.js';
import { fmt } from '../ui/dom.js';
import { tileOrder, dpiInUse } from '../core/tile-order.js';
import { loadBatteryEstimates, batteryLeft } from '../ui/controls.js';
import { batteryChart } from '../ui/battery-chart.js';
import { showAdded } from '../core/profiles.js';

// ---------- Battery (22 Oct 2026, docs/handoff/battery-added-devices.md) ----------
// A device that reports a battery gets the same graph as the mouse and headset (its readings are in battery-history.jsonl
// like theirs), its time left once DeviceHub has watched it drain, and, only when its driver says which setting to change
// (batteryCare), one plain line for what DeviceHub does on a low battery and while it charges (helpers/battery-care.mjs).
function careLine(d) {
  const care = d.adapter?.batteryCare;
  if (!care || typeof care !== 'object') return null;
  const set = (key) => (d.adapter.settings || []).find((s) => s.key === key);
  const part = (r) => { const s = set(r?.key); return s ? [s, `${s.label} ${showAdded(s, r.value)}`] : null; };
  const low = part(care.lowBattery), chg = part(care.charging);
  const lines = [];
  if (low) lines.push(`At 20% or less: ${low[1]} until charged.`);
  if (chg) lines.push(`While charging: ${chg[1]}.`);
  if (!lines.length) return null;
  const waits = [low, chg].some((x) => x && x[0].readOnly);
  return h('p', { class: 'faint', style: { marginTop: '12px', fontSize: '12.5px' } }, `Battery saving. ${lines.join(' ')}${waits ? ' It waits while that setting is read-only.' : ''}`);
}
const batteryPill = (d) => {
  const b = d.battery;
  if (b?.percent == null) return null;
  const left = batteryLeft(d.id, !!b.charging);
  return pill(`battery ${b.percent}%${b.charging ? ', charging' : left ? `, ${left}` : ''}`);
};

// ---------- "Share this driver" (22 Oct 2026; helpers/share-route.mjs, docs/handoff/share-route.md) ----------
// One click: DeviceHub checks the folder for anything personal, says in plain words what would be shared, asks for an
// optional public name, prepares the entry and opens GitHub with the submission filled in. The person presses Submit;
// DeviceHub sends nothing itself.
async function sharePost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch {}
  return j || { ok: false, error: r.statusText || 'DeviceHub did not answer' };
}
const para = (text, extra = {}) => h('p', { style: { margin: '0 0 10px' }, ...extra }, text);
const list = (items) => h('ul', { style: { margin: '0 0 10px', paddingLeft: '20px' } }, ...items.map((x) => h('li', {}, x)));

async function shareRefused(a, r) {
  const found = r.refused || [];
  const body = h('div', {},
    para(found.length ? 'Personal data found, so nothing was shared:' : `Not shared: ${r.error || 'unknown problem'}.`),
    found.length ? list(found.map((x) => h('span', {}, h('b', {}, x.text), h('br'), h('span', { class: 'faint' }, x.fix)))) : null,
    para(found.length ? 'Fix these, then try again.' : 'Nothing was sent.', { class: 'faint' }));
  await modal('Not shared', body, [{ label: 'Close', value: true, kind: 'primary' }]);
}

async function shareDriver(d) {
  const a = d.adapter;
  if (isDemo()) { toast('Demo: not shared', 'info'); return; }
  const c = await sharePost('/api/share/check', { name: a.plugin });
  if (!c.ok) return shareRefused(a, c);
  const by = h('input', { class: 'text', placeholder: 'Public name (optional)', 'aria-label': 'Public name', maxlength: 40 });
  const body = h('div', {},
    para(`Others with a ${c.title} get this driver.`),
    h('b', {}, 'What is shared'), list(c.shared),
    c.stays?.length ? para(`Stays on this PC: ${c.stays.join(', ')}.`, { class: 'faint' }) : null,
    h('b', {}, 'Nothing personal'), para(c.checked),
    h('b', {}, `Shared as "${c.status}"`), para(c.statusWhy),
    h('b', {}, 'What happens next'), para(c.next),
    by, para('Shown publicly.', { class: 'faint', style: { margin: '6px 0 0' } }));
  if (!(await modal('Share this driver?', body, [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Open GitHub', value: true, kind: 'primary' }]))) return;
  const p = await sharePost('/api/share/prepare', { name: a.plugin, by: by.value });
  if (!p.ok) return shareRefused(a, p);
  const opened = window.open(p.url, '_blank', 'noopener');
  if (p.method === 'attach') sharePost('/api/share/open-folder', { entry: p.entry }).catch(() => {});
  // the link is shown too, in case the browser blocked the new window
  await modal(p.method === 'attach' ? 'Attach the driver on GitHub' : 'Finish on GitHub', h('div', {},
    list(p.steps),
    para(h('a', { href: p.url, target: '_blank', rel: 'noopener' }, opened ? 'Open again' : 'Open GitHub')),
    para(`Saved on this PC in ${p.folder}.`, { class: 'faint' })), [{ label: 'Done', value: true, kind: 'primary' }]);
}

// shown when the device works: connected and its settings read (a read-only driver with reads working counts)
function shareButton(d, shown) {
  if (!d.adapter?.plugin || d.status !== 'connected' || !shown.length) return null;
  return h('div', { class: 'actions', style: { marginTop: '12px' } },
    button('Share this driver', () => shareDriver(d).catch((e) => toast('Not shared', 'bad', { detail: e.message })), { kind: 'ghost small', ic: 'external' }),
    h('span', { class: 'faint', style: { fontSize: '12.5px' } }, 'Needs a free GitHub account.'));
}

// a driver from the device library with settings still read-only (failed, waiting or not checked yet): Check again
// runs that check now (helpers/diagnose.mjs action "check-again"); the answer shows on the line, nothing pops up.
// A driver with no real-device record (or one the learning wizard made) writes nothing, its check included, until the
// person presses Turn on settings (safety round 2; helpers/my-devices.mjs turnOn): that button comes first.
const checkNote = {};
function checkAgain(d, redraw = () => {}) {
  const lib = d.adapter?.library;
  const ro = (d.adapter?.settings || []).filter((s) => s.type !== 'display' && s.readOnly);
  if (!lib || d.status !== 'connected' || (!ro.length && !lib.turnOn)) return null;
  const kind = lib.turnOn ? 'turn-on' : 'check-again';
  const run = async () => {
    checkNote[d.id] = kind === 'turn-on' ? 'Turning on…' : 'Checking…';
    try {
      const r = await fetch('/api/diagnose/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id: d.id }) });
      const j = await r.json().catch(() => ({}));
      checkNote[d.id] = !r.ok || j.error ? `Not done: ${j.error || r.statusText}` : checkAnswer(j, kind);
    } catch (e) { checkNote[d.id] = `Not done: ${e.message}`; }
    redraw();   // the answer (and, once settings are on, the Tell others it works invitation) shows at once
  };
  const line = kind === 'turn-on'
    ? 'Read-only until you turn settings on.'
    : `${ro.map((s) => s.label).join(', ')} ${ro.length === 1 ? 'is' : 'are'} read-only until checked.`;
  return h('div', { class: 'actions', style: { marginTop: '12px', alignItems: 'center' } },
    button(kind === 'turn-on' ? 'Turn on settings' : 'Check again', run, { kind: kind === 'turn-on' ? 'primary small' : 'ghost small', ic: kind === 'turn-on' ? 'plug' : 'search' }),
    h('span', { class: 'faint', style: { fontSize: '12.5px' } }, checkNote[d.id] || line));
}

// A driver problem on this page (24 Oct 2026, docs/handoff/smoother-for-friends.md): DeviceHub looks for a newer
// driver in the published library at once (POST /api/library/update?soon=1; not again within 10 minutes), so a fix
// published today reaches this PC while the person is looking at the problem. A newer driver put in while DeviceHub
// runs loads on the next start; the page says so in plain words (helpers/my-devices.mjs NEWER_DRIVER_LINE).
const libraryAsked = {};
function driverProblem(d) {
  const a = d.adapter || {};
  if (!a.library) return false;
  if (d.status === 'error' || a.notMine || a.library.notRun) return true;
  return (a.settings || []).some((s) => s.type !== 'display' && s.readOnly) && !a.library.turnOn;
}
function askLibrary(d, redraw) {
  if (isDemo() || !driverProblem(d) || Date.now() - (libraryAsked[d.id] || 0) < 10 * 60 * 1000) return;
  libraryAsked[d.id] = Date.now();
  fetch('/api/library/update?soon=1', { method: 'POST' }).then((r) => r.json()).then((j) => { if ((j?.refreshed?.replaced || []).length) redraw(); }).catch(() => {});
}
const newerLine = (d) => (d.adapter?.library?.newerDriver ? h('p', { style: { marginTop: '12px', fontSize: '13px' } }, icon('refresh'), ` ${d.adapter.library.newerDriver}`) : null);

const ICON = { mouse: 'mouse', headset: 'headset', keyboard: 'keyboard' };
const ACCENT = { mouse: 'var(--c-mouse)', headset: 'var(--c-headset)', keyboard: 'var(--c-keyboard)' };

function turnOnBanner(d, redraw) {
  const lib = d.adapter?.library;
  if (!lib?.turnOn || d.status !== 'connected') return null;
  const run = async () => {
    checkNote[d.id] = 'Turning on…'; redraw();
    try {
      const r = await fetch('/api/diagnose/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'turn-on', id: d.id }) });
      const j = await r.json().catch(() => ({}));
      checkNote[d.id] = !r.ok || j.error ? `Not done: ${j.error || r.statusText}` : checkAnswer(j, 'turn-on');
    } catch (e) { checkNote[d.id] = `Not done: ${e.message}`; }
    redraw();
  };
  return h('div', { class: 'banner info' }, icon('shield'),
    h('div', { class: 'grow' },
      h('b', {}, `Reading your ${d.adapter.title} safely`),
      h('small', {}, checkNote[d.id] || 'Settings start read-only. Click Turn on settings to verify and unlock controls on this device.')),
    h('div', { class: 'actions' }, button('Turn on settings', run, { kind: 'primary small', ic: 'plug' })));
}

// the kinds beyond slider, toggle and choice (22 Oct 2026; helpers/my-devices.mjs): a reading, a color (one, or one
// per zone) and button remaps. A zone or a button changes on its own, but the write is still the whole setting, once,
// read back like any other.
const nameOf = (list, v) => (list || []).find((o) => o.value === v)?.label ?? String(v);
// a read-only setting (a library driver's, until it passes its check or is turned on): its control is disabled and
// the reason is the visible line under its name (the hint the guard writes, "Read-only: ..."), never a tooltip
const readOnlyOf = (s) => s.type !== 'display' && !!s.readOnly;
const descOf = (s) => (readOnlyOf(s) && !/read-only/i.test(s.hint || '') ? [s.hint, 'Read-only.'].filter(Boolean).join(' ') : s.hint || null);
function settingRow(d, s) {
  const v = d.values?.[s.key];
  const off = readOnlyOf(s);
  const desc = descOf(s);
  const send = (x, label, display) => (off ? Promise.resolve() : write(d.id, s.key, x, { label, display }).catch(() => {}));
  if (s.type === 'display') return row(s.label, s.hint || null, readout({ value: v, unit: unitOf(s) }));
  if (s.type === 'color' && !s.zones) return row(s.label, desc, colorRow({ value: v, label: s.label, disabled: off, onCommit: (x) => send(x, s.label, x) }));
  if (s.type === 'color' || s.type === 'remap') {
    const obj = v && typeof v === 'object' ? v : {};
    const lines = s.type === 'color'
      ? s.zones.map((z) => [z.label, colorRow({ value: obj[z.value], label: `${s.label}, ${z.label}`, disabled: off, onCommit: (x) => send({ ...obj, [z.value]: x }, `${s.label} (${z.label})`, x) })])
      : s.buttons.filter((b) => b.value in obj).map((b) => [b.label, remapSelect({ value: obj[b.value], targets: s.targets, label: `${s.label}, ${b.label}`, disabled: off,
        onCommit: (x) => send({ ...obj, [b.value]: x }, `${s.label} (${b.label})`, nameOf(s.targets, x)) })]);
    const r = row(s.label, desc, lineList(lines));
    r.classList.add('stack');
    return r;
  }
  // a choice whose options are long ("Onboard (the profiles stored in the mouse)") takes its own line under the name and
  // description, so neither is squeezed into a narrow column (23 Oct 2026, a friend's Logitech page)
  const wide = s.type === 'choice' && (s.options || []).reduce((n, o) => n + String(o.label ?? o.value).length, 0) > 32;
  const r = row(s.label, desc, control(d, s, off));
  if (wide) r.classList.add('stack');
  return r;
}

// DPI stages together, as on the Pulsar's page (1 Nov 2026, Shawn: "show the proper buttons"): a driver's dpiStage1..N
// (each stage's DPI) and dpiStage (the one in use) were separate sliders in a flat list (the Razer driver's five
// "DPI stage n" sliders and an "Active DPI stage" slider). Now one card: each stage's DPI, the one in use marked, Use on
// the others. The same settings and writes as before; only where they are drawn changed.
const unitOf = (s) => (s.unit && /^[A-Za-z]/.test(s.unit) ? ` ${s.unit}` : s.unit || '');
const STAGE_DPI = /^(?:dpiStage|dpi)([1-9])$/;   // dpiStage1.. (Razer), dpi1.. (ASUS)
export function stageKeys(shown) {
  const per = shown.filter((s) => STAGE_DPI.test(s.key) && s.type === 'slider');
  return per.length >= 2 ? new Set([...per.map((s) => s.key), ...['dpiStage', 'stageCount'].filter((k) => shown.some((s) => s.key === k))]) : new Set();
}
function stagesCard(d, shown) {
  const per = shown.filter((s) => STAGE_DPI.test(s.key) && s.type === 'slider');
  if (per.length < 2) return null;
  const active = shown.find((s) => s.key === 'dpiStage');
  const cur = Number(d.values?.dpiStage);
  // how many stages the DPI button cycles through (ASUS "DPI stages in use"): its row first, the rest marked
  const count = shown.find((s) => s.key === 'stageCount');
  const inUse = Number(d.values?.stageCount);
  const valueFor = (i) => (active?.type === 'choice' ? (active.options || []).find((o) => Number(o.value) === i)?.value ?? i : i);
  return card([h('h2', {}, 'DPI stages'), h('span', { class: 'sub' }, active || count ? "the mouse's DPI button steps through them" : 'saved on the mouse')],
    count ? settingRow(d, count) : null,
    ...per.map((s) => {
      const i = Number(STAGE_DPI.exec(s.key)[1]);
      const on = !!active && cur === i;
      const use = active && !on ? button('Use', () => write(d.id, 'dpiStage', valueFor(i), { label: active.label, display: `stage ${i}` }).catch(() => {}), { kind: 'ghost small', disabled: readOnlyOf(active) }) : null;
      const out = count && Number.isFinite(inUse) && i > inUse;
      const r = row(`Stage ${i}`, out ? 'Not in the cycle.' : null, h('div', { class: 'stage-line' }, control(d, s, readOnlyOf(s)), on ? pill('in use', 'accent') : use));
      if (on) r.classList.add('stage-on');
      return r;
    }));
}

// Settings in groups, as the built-in pages split Tracking from Power & light (1 Nov 2026, Shawn: "show the proper
// buttons"): a driver may name a setting's group (group: 'tracking' | 'keys' | 'sound' | 'power' | 'lights'); without
// one it is told by its key, the names the library drivers use. Headings only when there is more than one group.
export const GROUPS = [['tracking', 'Performance'], ['keys', 'Keys'], ['sound', 'Sound'], ['power', 'Power'], ['lights', 'Lights'], ['other', 'More']];
const BY_KEY = [
  ['tracking', /^(dpi|polling|pollingRate|reportRate|liftOff|angleSnap|smartReel|scrollAccel|stageCount|onboardProfile|profile|mode|motionSync|ripple)/i],
  ['keys', /^(lock|gameMode|fnSwap|debounce|remap|keys?\b|nkro|macro(?!Led))/i],
  ['sound', /^(sidetone|mic|chatmix|noiseGate|eq|voicePrompts|silentMode|volume)/i],
  ['power', /^(autoOff|sleep|idle|lowBattery|docked|battery|charging|powerSave)/i],
  ['lights', /^(brightness|lights?|logo|dongleLed|macroLed|backlight|color|colour|effect|rgb)/i],
];
export function groupOf(s) {
  if (GROUPS.some(([g]) => g === s.group)) return s.group;
  if (s.type === 'color') return 'lights';
  return (BY_KEY.find(([, re]) => re.test(s.key)) || ['other'])[0];
}
function settingsList(d, list) {
  const by = new Map();
  for (const s of list) { const g = groupOf(s); if (!by.has(g)) by.set(g, []); by.get(g).push(s); }
  if (by.size <= 1) return list.map((s) => settingRow(d, s));
  return GROUPS.filter(([g]) => by.has(g)).map(([g, title]) => h('div', { class: 'set-group' }, h('h3', {}, title), ...by.get(g).map((s) => settingRow(d, s))));
}

// The figures at the top of an added device's page, as the Pulsar's page leads with its battery, DPI, polling and
// lift-off (1 Nov 2026, Shawn: "show the proper buttons"): the battery, then up to four readings in the order its tile
// uses (core/tile-order.js), DPI with its stage dots and polling with its bars. Nothing to show: no row.
export function heroStats(d) {
  const v = d.values || {}, a = d.adapter || {}, settings = a.settings || [];
  const out = [];
  const bat = d.battery;
  if (bat?.percent != null) out.push(batteryCell({ id: d.id, percent: bat.percent, charging: bat.charging, big: true, reported: bat.reported }));
  const stageN = Number(v.dpiStage);
  const dpiNow = dpiInUse(v);
  const stages = settings.filter((x) => /^(?:dpiStage|dpi)[1-9]$/.test(x.key)).length;
  // no dpi setting of its own (ASUS, ROCCAT): the DPI in use still leads
  const list = dpiNow != null && !settings.some((x) => x.key === 'dpi') ? [{ key: 'dpi', label: 'DPI', type: 'slider' }, ...settings] : settings;
  for (const x of tileOrder(a.kind || '', list)) {
    if (out.length >= 5) break;
    if (x.key === 'dpiStage' || x.key === 'stageCount') continue;
    const val = x.key === 'dpi' ? dpiNow : v[x.key];
    if (val == null || val === '') continue;
    if (x.key === 'dpi' && Number.isFinite(Number(val))) {
      out.push(stages >= 2 && Number.isFinite(stageN) ? dots({ n: stageN, of: stages, value: fmt(Number(val)), label: `DPI · stage ${stageN}`, big: true })
        : h('div', { class: 'stat' }, h('b', {}, fmt(Number(val))), h('span', {}, 'DPI')));
    } else if (/^(pollingRate|polling|reportRate)$/i.test(x.key) && Number.isFinite(Number(val))) out.push(signal({ hz: Number(val), big: true }));
    else if (x.type === 'display' || x.type === 'slider' || x.type === 'choice' || x.type === 'toggle') {
      const shown = x.type === 'toggle' ? (val ? 'On' : 'Off') : x.type === 'choice' ? String((x.options || []).find((o) => o.value === val)?.label ?? val) : `${val}${unitOf(x)}`;
      out.push(h('div', { class: 'stat' }, h('b', {}, shown), h('span', {}, String(x.label || x.key).toLowerCase())));
    }
  }
  return out.length ? h('section', { class: 'hero' }, h('div', {}, h('div', { class: 'hero-stats' }, ...out))) : null;
}

function control(d, s, off = false) {
  const v = d.values?.[s.key];
  const set = (x) => off ? undefined : write(d.id, s.key, x, { label: s.label, display: s.type === 'choice' ? (s.options.find((o) => o.value === x)?.label ?? String(x)) : `${x}${unitOf(s)}` });
  if (s.type === 'toggle') return toggle({ value: !!v, label: s.label, disabled: off, onCommit: set });
  if (s.type === 'choice') return segmented({ value: v, compact: s.options.length > 3, options: s.options, disabled: off, onCommit: set });
  return slider({ value: v ?? null, min: s.min, max: s.max, step: s.step || 1, unit: unitOf(s), label: s.label, disabled: off,
    grab: () => (off ? undefined : prepare(d.id)), live: s.live && !off ? (x) => write(d.id, s.key, x, { live: true }).catch(() => {}) : null, onCommit: set });
}

// The headset driver's settings on the Headset page (29 Oct 2026): the same rows as its own page, for the headset
// whose Windows sound side the Headset page runs (core/devices.js headsetTwin), so one headset is one page.
export function twinSettingsCard(d, redraw) {
  const a = d.adapter;
  const shown = (a.settings || []).filter((s) => d.values?.[s.key] !== undefined);
  return card([h('h2', {}, 'Battery & headset settings'), batteryPill(d)],
    turnOnBanner(d, redraw),
    shown.length ? shown.map((s) => settingRow(d, s)) : h('p', { class: 'faint', style: { margin: 0 } }, d.status === 'connected' ? 'No settings reported yet.' : `The ${a.title} is not connected.`),
    careLine(d),
    h('div', { class: 'actions', style: { marginTop: '10px' } }, button('More', () => { location.hash = `#/${d.id}`; }, { kind: 'ghost small', title: `Everything about the ${a.title}` })));
}

export function devicePage(id) {
  const d0 = devices[id];
  const kindKey = String(d0.adapter.kind || '').toLowerCase();
  const accent = kindKey.includes('mouse') ? ACCENT.mouse : kindKey.includes('headset') ? ACCENT.headset : kindKey.includes('keyboard') ? ACCENT.keyboard : 'var(--signal)';
  return {
    id, title: d0.adapter.title, icon: ICON[kindKey] || 'plug', device: id, watches: [id], accent,
    render(ctx = {}) {
      const d = devices[id];
      const a = d.adapter;
      if (a.battery) loadBatteryEstimates(() => ctx.redraw?.());
      askLibrary(d, () => ctx.redraw?.());
      const head = topbar(`${a.kind} · added on this PC`, a.title, null, h('div', { class: 'chips' }, undoButton(d), statusPill(d)), deviceHelp(d));
      if (d.status !== 'connected' && !isAway(d)) {
        return h('div', {}, head, h('div', { class: 'panel empty' }, artOf(d),
          h('h2', {}, d.status === 'error' ? `Couldn't reach the ${a.kind.toLowerCase()}` : `Waiting for the ${a.kind.toLowerCase()}`),
          h('p', {}, d.error || `Plug in the ${a.title}.`),
          newerLine(d),
          h('div', { class: 'actions' }, button('Look again', () => connect(id, false), { kind: 'primary', ic: 'plug' }))));
      }
      const shown = (a.settings || []).filter((s) => d.values?.[s.key] !== undefined);
      const staged = stageKeys(shown);
      return h('div', {}, head, awayBanner(d), heroStats(d), turnOnBanner(d, () => ctx.redraw?.()),
        h('div', { class: 'grid two top' },
          card([h('h2', {}, 'Settings'), d.battery?.percent != null ? null : batteryPill(d)],   // the battery is in the figures at the top (heroStats)
            shown.length ? settingsList(d, shown.filter((s) => !staged.has(s.key))) : h('p', { class: 'faint', style: { margin: 0 } }, 'No settings reported yet.'),
            a.unsupported?.length ? h('p', { class: 'faint', style: { marginTop: '12px' } }, icon('external'), ` Maker's app only: ${a.unsupported.join(', ')}.`) : null,
            careLine(d),
            newerLine(d),
            checkAgain(d, () => ctx.redraw?.()),
            // Test it with me first, then the Works on my device invitation (public/ui/guided-test.js)
            offersWorks(d) ? guidedTest(d, { after: () => worksReport(d, { invite: true }), redraw: () => ctx.redraw?.() }) : null),
          h('div', { class: 'stack' },
            card([h('h2', {}, 'Device'), h('span', { class: 'spacer' }), deviceActions(d)], kv(d.info || {}), shareButton(d, shown)),
            staged.size ? stagesCard(d, shown) : null)),
        a.battery ? batteryChart(id, () => ctx.redraw?.(), { title: a.title, kind: a.kind }) : null,
        // any mouse: the polling rate test, against its polling setting when the driver has one (public/ui/polling-test.js)
        /mouse/i.test(a.kind || '') ? pollingTest(pollHzOf(d), card, id) : null,
        // Windows' pointer settings, as on the Pulsar's page (1 Nov 2026, ui/pointer-card.js)
        /mouse/i.test(a.kind || '') ? pointerCard(() => ctx.redraw?.()) : null);
    },
  };
}
