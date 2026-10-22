// Learn a device (22 Oct 2026; helpers/learn-wizard.mjs, docs/handoff/learn-wizard.md): someone whose device DeviceHub
// does not run gets a driver for it without Claude. DeviceHub listens (USBPcap) while the person changes one setting in
// the maker's app, finds the bytes that carry it, and makes a driver.json that is saved read-only until the person
// presses Turn on settings and DeviceHub's check then passes. Nothing here sends anything to the device. One step on screen at a time; plain words; no pop-ups.
// Reached from the sidebar (under App), the Overview's Set up card and Lighting > This PC ("Learn it", which puts that
// device first here: learnThis(vid, pid)).
// Readings (22 Oct 2026, docs/handoff/learn-readings.md): a value the device reports that the person cannot set
// (battery, charging, ChatMix, a sensor) is a fourth kind; DeviceHub only listens for it. After a save, the same device
// can be learned on its other USB id (cable and receiver) and is added to the same driver.
// No typing (22 Oct 2026, docs/handoff/learn-no-typing.md): after the pick (made by itself when only one device can be
// learned) DeviceHub names the maker's app (installed or not, open or not) and offers the settings as a tick-list
// (GET /api/learn/plan). "Learn these" learns each ticked one in turn: when the app is open, DeviceHub changes it
// there itself (POST drive: app-ui, then puts it back); else one line says what to change, with a Done button. The old
// form stays under "Other setting". Demo mode runs the same steps on pretend answers (demoApi).
import { h } from '../ui/dom.js';
import { card, row, segmented, button, pill } from '../ui/controls.js';
import { installerButton } from '../ui/installer-button.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';
import { genericDongle } from '../core/generic-dongle.js';
import { getHelp } from '../ui/get-help.js';

// the state of the page (kept across redraws)
const newForm = () => ({ label: '', kind: 'number', role: 'battery', unit: '', a: '', b: '' });
const st = { step: 'pick', devices: null, usbpcap: null, error: null, why: null, busy: false, server: null,
  form: newForm(), third: '', found: null, range: { min: '', max: '', step: '' },
  save: { title: '', kind: 'Device' }, heard: null, want: null, link: 'cable',
  // no typing: the plan (maker's app + tick-list), the ticked settings being learned, what happened to each
  plan: null, queue: null, qi: 0, log: [], change: null, drive: null, putBack: [], autoPicked: false };
let redrawPage = () => {};

// Lighting > This PC's "Learn it": that device goes first on the Pick step, as the one to learn
export function learnThis(vid, pid) {
  st.want = vid && pid ? `${vid}:${pid}`.toUpperCase() : null;
  if (st.step === 'pick') st.devices = null;
}

async function api(path, body) {
  if (isDemo()) return demoApi(path, body || {});
  try {
    const r = await fetch(`/api/learn/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 404) return { ok: false, error: 'This DeviceHub does not have the learning wizard yet: restart DeviceHub.' };
    return await r.json();
  } catch { return { ok: false, error: 'DeviceHub did not answer.' }; }
}
// runs one step: shows it busy, keeps the server's answer, shows its problem in words
async function run(path, body, then) {
  st.busy = true; st.error = null; st.why = null; redrawPage();
  const r = await api(path, body);
  st.busy = false;
  if (r.active !== undefined) st.server = r;
  if (r.ok === false) { st.error = r.error || null; st.why = r.why || null; }
  else if (then) then(r);
  redrawPage();
  return r;
}

async function loadDevices() {
  st.devices = null; st.error = null; redrawPage();
  const r = await api('devices');
  st.devices = r.devices || [];
  st.usbpcap = !!r.usbpcap;
  if (r.error) st.error = r.error;
  if (r.active !== undefined) st.server = r;
  redrawPage();
}

// waits for the listener (the person answers Windows' prompt): polls /api/learn/state for up to two minutes
// true once listening; while a list of settings is learned (st.queue) it goes back to the plan on a problem
async function waitListener() {
  const back = () => (st.queue ? 'plan' : 'ready');
  for (let i = 0; i < 240 && st.step === 'starting'; i++) {
    const r = await api('state');
    st.server = r;
    if (r.listener === 'ready' || r.listener === 'stopped' || r.listener === 'recording') { if (!st.queue) { st.step = 'take'; redrawPage(); } return true; }
    if (r.listener === 'error' || r.listener === 'ended') { st.step = back(); st.queue = null; st.error = r.listenerError || 'DeviceHub stopped listening.'; redrawPage(); return false; }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (st.step === 'starting') { st.step = back(); st.queue = null; st.error = 'Nothing answered. If Windows asked, press Yes; then press Start listening again.'; redrawPage(); }
  return false;
}

// ---------- small parts
const p = (text, cls) => h('p', { class: cls || null, style: { margin: '0 0 10px' } }, text);
const faint = (text) => p(text, 'faint');
const steps = ['pick', 'ready', 'take', 'found', 'driver', 'saved'];
const stepAs = { starting: 'ready', plan: 'ready', driving: 'take', change: 'take' };
const stepNo = (s) => h('span', { class: 'learn-step' }, `Step ${Math.max(1, steps.indexOf(stepAs[s] || s) + 1)} of 6`);
const field = (label, key, obj, attrs = {}) => {
  const el = h('input', { class: 'text', value: obj[key] ?? '', 'aria-label': label, ...attrs });
  el.addEventListener('input', () => { obj[key] = el.value; });
  return el;
};
const problems = () => (st.error || st.why?.length ? h('div', { class: 'learn-problem', role: 'status' },
  st.error ? p(st.error) : null, ...(st.why || []).map((x) => p(x))) : null);
const show = (v) => (v === true ? 'on' : v === false ? 'off' : String(v));
const kindWord = () => (st.form.kind === 'toggle' ? 'on or off' : st.form.kind === 'choice' ? 'choice' : st.server?.setting?.role === 'battery' ? 'percent' : 'value');
const device = () => st.server?.device;
const second = () => st.server?.second || null;
// a reading's value as the page says it (charging: charging / not charging; a percent with %)
const showAs = (set, v) => (set?.role === 'charging' ? (v ? 'charging' : 'not charging') : set?.role === 'battery' ? `${v}%` : show(v));
const roleWord = (l) => (l.role === 'battery' ? 'battery level' : l.role === 'charging' ? 'charging' : 'reading');

// ---------- the steps
function pickStep() {
  if (!st.devices) {
    if (!st.loading) { st.loading = true; setTimeout(() => loadDevices().finally(() => { st.loading = false; }), 0); }
    return card([h('h2', {}, 'Pick the device'), h('span', { class: 'spacer' }), stepNo('pick')], faint('Looking at what is plugged in…'));
  }
  const idOf = (d) => `${d.vid}:${d.pid}`.toUpperCase();
  // the device Lighting > This PC sent here goes first
  const wanted = st.want ? st.devices.find((d) => idOf(d) === st.want) : null;
  const list = wanted ? [wanted, ...st.devices.filter((d) => d !== wanted)] : st.devices;
  const primary = (d) => (wanted ? d === wanted : !d.library);
  const pick = (d) => run('begin', { vid: d.vid, pid: d.pid }, () => { Object.assign(st, { step: 'plan', plan: null, queue: null, log: [], putBack: [], want: null }); st.save.title = d.name; });
  // only one device can be learned (or This PC sent one that can): it is picked by itself, once
  const pickable = list.filter((d) => !d.refused);
  const only = wanted && !wanted.refused ? wanted : pickable.length === 1 ? pickable[0] : null;
  if (only && !st.autoPicked && !st.busy) { st.autoPicked = true; setTimeout(() => pick(only), 0); }
  return card([h('h2', {}, 'Pick the device'), h('span', { class: 'spacer' }), stepNo('pick')],
    p('These are plugged in and DeviceHub does not run them yet. Pick the one to learn.'),
    st.want && !wanted ? faint(`USB ${st.want.toLowerCase()} is not in this list: DeviceHub may run it already, or it has nothing DeviceHub can learn.`) : null,
    list.length ? list.map((d) => row(d.name, [d === wanted ? 'the one you picked on This PC' : null, `USB ${d.vid}:${d.pid}`, d.vendor ? 'has a settings channel' : 'no maker settings channel seen', d.library && !d.note ? 'a shared driver exists for it: install it from Set up on the Overview' : null, genericDongle({ ...d, name: /^USB device /.test(d.name) ? null : d.name })?.line || d.refused || d.note || null].filter(Boolean).join(' · '),
      d.refused ? (genericDongle({ ...d, name: /^USB device /.test(d.name) ? null : d.name }) ? getHelp(`request:${d.vid.toLowerCase()}:${d.pid.toLowerCase()}`, null, { label: 'Request support', request: { vid: d.vid, pid: d.pid, name: '' }, kind: 'ghost small' }) : null) : button('Learn this one', () => pick(d), { kind: primary(d) ? 'primary small' : 'ghost small' })))
      : faint('No device to learn was found. Plug it in, then look again.'),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } }, button('Look again', loadDevices, { kind: 'ghost small', ic: 'refresh' })));
}

function readyStep() {
  const f = st.form;
  const d = device();
  if (st.usbpcap === false) {
    return card([h('h2', {}, 'Get ready'), h('span', { class: 'spacer' }), stepNo('ready')],
      p('To learn a device, DeviceHub listens to what the maker\'s app sends it. That needs USBPcap, a small free tool. It only listens; it never sends anything.'),
      p('Install it, then restart the PC once and come back here.'),
      h('div', { class: 'actions' }, installerButton('usbpcap', { onDone: () => { st.devices = null; loadDevices(); }, redraw: redrawPage }),
        button('I installed it', () => { st.devices = null; loadDevices(); }, { kind: 'ghost small' })));
  }
  const sec = second();
  if (sec && !sec.next) { st.step = 'driver'; return driverStep(); }
  // on the other USB id the setting is the saved driver's own: only new numbers or a new percent are asked for
  const cur = sec?.next || null;
  const kind = cur ? cur.kind : f.kind, role = cur ? cur.role : f.role;
  const reading = kind === 'reading';
  const kindCtl = segmented({ value: f.kind, options: [{ value: 'number', label: 'Number' }, { value: 'toggle', label: 'On or off' }, { value: 'choice', label: 'Choice' }, { value: 'reading', label: 'Reading' }],
    onCommit: (v) => { f.kind = v; redrawPage(); } });
  const roleCtl = segmented({ value: f.role, options: [{ value: 'battery', label: 'Battery level' }, { value: 'charging', label: 'Charging' }, { value: 'display', label: 'Something else' }],
    onCommit: (v) => { f.role = v; redrawPage(); } });
  const two = (a, b) => h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('First value', 'a', f, { placeholder: a }), field('Second value', 'b', f, { placeholder: b }));
  const values = cur?.fixed ? faint(`DeviceHub records the same values as before: ${cur.values.map((v) => showAs(cur, v)).join(', ')}.`)
    : kind === 'toggle' ? faint('DeviceHub records it turned on, then turned off.')
      : reading && role === 'charging' ? faint('DeviceHub records it charging, then not charging. You plug in and unplug its cable.')
        : reading && role === 'battery' ? h('div', {}, field('Percent now', 'a', f, { placeholder: 'The percent the app shows now, e.g. 80', inputmode: 'numeric', style: { width: '260px' } }))
          : reading ? two('First value, e.g. game', 'Second value, e.g. chat')
            : kind === 'number' ? two('First value, e.g. 800', 'Second value, e.g. 1600') : two('First choice, e.g. Low', 'Second choice, e.g. High');
  const start = async () => {
    const vals = cur?.fixed ? [] : kind === 'toggle' ? ['on', 'off'] : reading && role === 'charging' ? [] : reading && role === 'battery' ? [f.a] : [f.a, f.b];
    const r = await run('setting', cur ? { values: vals } : { label: f.label, kind: f.kind, role: reading ? f.role : undefined, unit: f.unit, values: vals });
    if (r.ok === false) return;
    st.found = null; st.third = '';
    if (['ready', 'recording', 'stopped'].includes(r.listener)) { st.step = 'take'; redrawPage(); return; }
    const l = await run('listen', {});
    if (l.ok === false) return;
    st.step = 'starting'; redrawPage(); waitListener();
  };
  if (cur) {
    return card([h('h2', {}, `On USB ${d ? `${d.vid}:${d.pid}` : ''}: ${cur.label}`), h('span', { class: 'spacer' }), stepNo('ready')],
      p(`Setting ${sec.done + 1} of ${sec.total}. Learn ${cur.label} again here, the same way as before. Keep the device on its ${sec.link === 'receiver' ? 'receiver' : 'cable'} the whole time.`),
      cur.kind === 'number' || (reading && role !== 'charging' && !cur.fixed) ? p(role === 'battery' ? 'Give the percent the maker\'s app shows now.' : 'Give two values the app offers. They can differ from last time.') : null,
      h('div', { style: { margin: '6px 0 12px' } }, values),
      problems(),
      h('div', { class: 'actions' }, button(st.busy ? 'Starting…' : 'Start listening', start, { kind: 'primary', ic: 'plug', disabled: st.busy })));
  }
  return card([h('h2', {}, `Get ready${d ? `: ${d.name}` : ''}`), h('span', { class: 'spacer' }), stepNo('ready')],
    p('Open the maker\'s app for this device. Pick ONE setting to teach DeviceHub, and two values the app offers for it.'),
    faint('Colors, button remaps, macros and EQ cannot be learned yet: pick a number, an on or off, a choice, or a reading.'),
    st.server?.addsTo?.note ? faint(`${st.server.addsTo.name}: ${st.server.addsTo.note}.`) : null,
    reading && f.role !== 'display' ? null : row(reading ? 'Reading' : 'Setting', reading ? 'As the maker\'s app names it, e.g. ChatMix' : 'As the maker\'s app names it, e.g. DPI or Brightness', field('Setting', 'label', f, { placeholder: reading ? 'e.g. ChatMix' : 'e.g. DPI', maxlength: 40 })),
    row('Kind', null, kindCtl),
    reading ? p('A reading is something the device reports that you cannot set, like its battery or the ChatMix wheel. DeviceHub only listens for it and never writes it.', 'faint') : null,
    reading ? row('What it is', null, roleCtl) : null,
    f.kind === 'number' || (reading && f.role === 'display') ? row('Unit', 'Optional, e.g. DPI or %', field('Unit', 'unit', f, { placeholder: 'optional', maxlength: 10, style: { width: '140px' } })) : null,
    h('div', { style: { margin: '6px 0 12px' } }, values),
    reading ? faint(f.role === 'battery' ? 'Open the battery page in the maker\'s app. DeviceHub looks for a byte that matches the percent it shows.'
      : f.role === 'charging' ? 'Learn the battery level first; charging goes with it.' : 'Give values the app shows for it: numbers, or words like game and chat.')
      : faint('Choose values far apart (for a number, one above 255 if the app goes that high). Firmware, reset and pairing controls are never learned.'),
    problems(),
    h('div', { class: 'actions' },
      button(st.busy ? 'Starting…' : 'Start listening', start, { kind: 'primary', ic: 'plug', disabled: st.busy }),
      button('Pick another device', () => { st.step = 'pick'; redrawPage(); }, { kind: 'ghost small' })));
}

// ---------- no typing: the maker's app, the tick-list, and learning the ticked settings one after another
const appName = () => st.plan?.maker?.name || 'the maker\'s app';
const kindName = (it) => (it.kind === 'number' ? 'number' : it.kind === 'toggle' ? 'on or off' : it.kind === 'choice' ? 'choice' : 'reading');
const KIND_FOR_SAVE = { mouse: 'Mouse', keyboard: 'Keyboard', headset: 'Headset' };
const link = (url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, url);

async function loadPlan(again) {
  st.planLoading = true;
  const r = await api(again ? 'plan?again' : 'plan');
  st.planLoading = false;
  if (r.ok === false) { st.error = r.error || null; st.plan = { maker: { known: false }, kind: 'device', items: [] }; }
  else {
    // a reading keeps a small box for the percent; numbers and choices keep their two values as text to edit
    st.plan = { ...r, items: (r.items || []).map((it) => ({ ...it, values: (it.values || []).map((v) => (typeof v === 'boolean' ? v : String(v))), percent: '' })) };
    if (r.active !== undefined) st.server = r;
    st.save.kind = KIND_FOR_SAVE[r.kind] || st.save.kind || 'Device';
  }
  redrawPage();
}

// one line about the maker's app
function makerLine(m) {
  if (!m?.known) return p('DeviceHub does not know this maker\'s app. When DeviceHub asks, change each setting in it yourself.');
  if (m.web) return p(['Its app, ', m.name, ', is a web page: ', link(m.page), '. Open it, and change each setting there when DeviceHub asks.']);
  if (!m.installed) return p(['Its app, ', m.name, ', is not installed: ', link(m.page)]);
  if (!m.running) return p(`${m.name} is installed but not open. Open it, then press Look again. If it stays closed, DeviceHub asks you to change each setting in it yourself.`);
  return p(`${m.name} is open. DeviceHub changes each ticked setting in it, listens, and puts it back as it was.`);
}

// the values of one item, prefilled and editable
function valuesOf(it) {
  if (it.kind === 'toggle') return h('span', { class: 'faint' }, 'on, then off');
  if (it.kind === 'reading') {
    if (it.role === 'battery') return field(`${it.label}: the percent the app shows now`, 'percent', it, { placeholder: 'e.g. 80', inputmode: 'numeric', class: 'text learn-val' });
    return h('span', { class: 'faint' }, it.role === 'charging' ? 'plugged in, then unplugged' : 'listen only');
  }
  const box = (i) => { const el = h('input', { class: 'text learn-val', value: it.values[i] ?? '', 'aria-label': `${it.label} value ${i + 1}`, inputmode: it.kind === 'number' ? 'numeric' : null }); el.addEventListener('input', () => { it.values[i] = el.value; }); return el; };
  return h('span', { class: 'learn-vals' }, box(0), h('span', { class: 'faint' }, 'and'), box(1));
}

function planStep() {
  const d = device();
  if (!st.plan) {
    if (!st.planLoading) setTimeout(() => loadPlan(), 0);
    return card([h('h2', {}, `Learn the ${d?.name || 'device'}`), h('span', { class: 'spacer' }), stepNo('plan')], faint('Looking for its maker\'s app and its settings…'));
  }
  const pl = st.plan, m = pl.maker || {};
  const items = pl.items || [];
  const ticked = items.filter((i) => i.ticked);
  const box = (it) => { const el = h('input', { type: 'checkbox', 'aria-label': it.label }); el.checked = !!it.ticked; el.addEventListener('change', () => { it.ticked = el.checked; redrawPage(); }); return el; };
  const from = pl.from === 'files' ? `These are the settings ${m.name || 'the maker\'s app'} keeps for it.` : pl.from === 'brand' ? 'These are the settings this maker\'s devices usually have.' : `These are the usual settings for a ${pl.kind === 'device' ? 'device like this' : pl.kind}.`;
  return h('div', {},
    card([h('h2', {}, `Learn the ${d?.name || 'device'}`), h('span', { class: 'spacer' }), stepNo('plan')],
      makerLine(m),
      st.usbpcap === false ? [p('To listen, DeviceHub needs USBPcap, a small free tool. It only listens; it never sends anything. Install it, then restart the PC once.'),
        h('div', { class: 'actions', style: { marginBottom: '12px' } }, installerButton('usbpcap', { onDone: () => { st.devices = null; loadDevices(); }, redraw: redrawPage }))] : null,
      items.length ? [p(`${from} Tick the ones to learn. The two values are prefilled; change them if the app offers others.`),
        h('div', { class: 'learn-items' }, ...items.map((it) => h('div', { class: `learn-item${it.learned ? ' done' : ''}` },
          h('label', { class: 'learn-tick' }, box(it), h('span', {}, it.label)),
          valuesOf(it),
          h('span', { class: 'faint learn-src' }, it.learned ? 'learned' : `${kindName(it)} · ${it.source}`))))]
        : faint('No settings are known for it. Use Other setting below.'),
      problems(),
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        button(st.busy ? 'Starting…' : ticked.length > 1 ? `Learn these (${ticked.length})` : 'Learn these', startQueue, { kind: 'primary', ic: 'plug', disabled: st.busy || !ticked.length || st.usbpcap === false }),
        m.known && !m.web && m.installed && !m.running ? button('Look again', () => { st.plan = null; loadPlan(true); }, { kind: 'ghost small', ic: 'refresh' }) : null,
        button('Pick another device', () => { st.step = 'pick'; redrawPage(); }, { kind: 'ghost small' })),
      faint('Firmware, update, reset and pairing controls are never touched.')),
    st.usbpcap === false ? null : h('details', { class: 'learn-other', open: st.otherOpen || null, ontoggle: (e) => { st.otherOpen = e.target.open; } },
      h('summary', {}, 'Other setting'), readyStep()));
}

function startQueue() {
  const items = (st.plan?.items || []).filter((i) => i.ticked);
  if (!items.length) return;
  if (items.some((i) => i.kind === 'reading' && i.role === 'battery' && !String(i.percent).trim())) { st.error = 'Give the battery percent the app shows now, or untick Battery.'; redrawPage(); return; }
  Object.assign(st, { queue: items, qi: 0, log: [], putBack: [], error: null, why: null });
  runItem();
}
const current = () => st.queue?.[st.qi] || null;
function logItem(it, why) { st.log.push({ label: it.label, ok: !why, why: why || null }); }
function nextItem() { st.qi++; runItem(); }

async function runItem() {
  const it = current();
  if (!it) { st.queue = null; st.change = null; st.step = 'driver'; redrawPage(); return; }
  Object.assign(st, { found: null, third: '', heard: null, drive: null, change: null, form: newForm() });
  const values = it.kind === 'toggle' ? ['on', 'off'] : it.kind === 'reading' ? (it.role === 'battery' ? [it.percent] : []) : it.values.map(String);
  const r = await run('setting', { label: it.label, kind: it.kind, role: it.role || undefined, unit: it.unit || '', values });
  if (r.ok === false) { logItem(it, st.error || 'it could not be started'); st.error = null; nextItem(); return; }
  if (!['ready', 'stopped', 'recording'].includes(r.listener)) {
    const l = await run('listen', {});
    if (l.ok === false) { st.queue = null; st.step = 'plan'; redrawPage(); return; }
    st.step = 'starting'; redrawPage();
    if (!(await waitListener())) return;
  }
  const m = st.plan?.maker;
  if (m?.running && m.window && it.kind !== 'reading') {
    st.step = 'driving'; redrawPage();
    const dv = await run('drive', {});
    if (dv.ok === false) { logItem(it, st.error); st.error = null; nextItem(); return; }
    st.drive = dv;
    if (dv.restore && !dv.restore.ok) st.putBack.push(dv.restore.why);
    if (dv.driven) { if (dv.range) it.range = dv.range; analyzeQueued(it); return; }
    st.change = { phase: 0, why: dv.why };
  } else st.change = { phase: 0, why: null };
  st.step = 'change'; redrawPage();
  beginChange();
}

// the person changes it: the values in the order they are recorded, and what to do for each
function changeOf(it) {
  const set = st.server?.setting;
  const vals = set?.values || [];
  if (it.kind === 'reading') {
    if (it.role === 'battery') return [{ value: vals[0], line: `Open the battery page in ${appName()} now. Then press Done.` }];
    if (it.role === 'charging') return [{ value: true, line: `Plug in its cable now, and wait until ${appName()} shows it charging. Then press Done.` },
      { value: false, line: `Now unplug its cable, and wait until ${appName()} shows it is not charging. Then press Done.` }];
    return [{ value: vals[0], line: `Make the device report ${it.label} = ${show(vals[0])} now. Then press Done.` }, { value: vals[1], line: `Now make it report ${show(vals[1])}. Then press Done.` }];
  }
  const [a, b] = vals;
  return [{ value: b, line: `Change ${it.label} from ${show(a)} to ${show(b)} in ${appName()} now. Then press Done.` },
    { value: a, line: `Now change ${it.label} from ${show(b)} back to ${show(a)}. Then press Done.` }];
}
async function beginChange() {
  const it = current(), ch = st.change;
  if (!it || !ch) return;
  const steps = changeOf(it);
  await run('record', { value: steps[ch.phase].value === true ? 'on' : steps[ch.phase].value === false ? 'off' : String(steps[ch.phase].value) });
}
async function doneChange() {
  const it = current(), ch = st.change;
  const r = await run('stop', {});
  if (r.ok === false) return;
  st.heard = r.heard;
  if (ch.phase + 1 < changeOf(it).length) { ch.phase++; redrawPage(); beginChange(); return; }
  analyzeQueued(it);
}
async function skipItem(why = 'skipped') {
  const it = current();
  if (!it) return;
  if (st.server?.recording) await api('stop', {});
  logItem(it, why);
  nextItem();
}

// the existing diff on what was recorded; added at once when its range is known (the app's own) or not needed
async function analyzeQueued(it) {
  st.step = 'found'; st.found = null; redrawPage();
  const r = await run('analyze', {});
  st.found = r;
  if (r.ok && r.range) st.range = { min: String(r.range.min), max: String(r.range.max), step: String(r.range.step) };
  if (r.ok && it.range) st.range = { min: String(it.range.min), max: String(it.range.max), step: String(it.range.step) };
  if (r.ok && (r.kind !== 'number' || it.range)) {
    const a = await run('add', { ...st.range, ...st.save });
    if (a.ok !== false) { it.learned = true; it.ticked = false; logItem(it, null); nextItem(); return; }
  }
  redrawPage();
}

function drivingStep() {
  const it = current();
  const vals = st.server?.setting?.values || [];
  return card([h('h2', {}, `Learning ${it?.label || ''}`), h('span', { class: 'spacer' }), stepNo('driving')],
    faint(`Setting ${st.qi + 1} of ${st.queue?.length || 1}.`),
    p(`DeviceHub is changing ${it?.label} in ${appName()} to ${vals.map(show).join(', then ')}, and listening. Then it puts it back. Leave ${appName()} alone for a moment.`),
    h('div', { class: 'loadbar-wrap' }, h('div', { class: 'loadbar sweep', role: 'progressbar', 'aria-label': 'Changing it and listening' }, h('span')), h('span', { class: 'loadbar-text' }, 'Listening')));
}

function changeStep() {
  const it = current(), ch = st.change;
  if (!it || !ch) { st.step = 'plan'; return planStep(); }
  const steps = changeOf(it);
  const now = steps[Math.min(ch.phase, steps.length - 1)];
  const recording = !!st.server?.recording;
  return card([h('h2', {}, it.label), h('span', { class: 'spacer' }), stepNo('change')],
    faint(`Setting ${st.qi + 1} of ${st.queue.length}.${ch.why ? ` ${ch.why}` : ''}`),
    p(now.line),
    recording ? h('div', { class: 'loadbar-wrap' }, h('div', { class: 'loadbar sweep', role: 'progressbar', 'aria-label': 'Listening' }, h('span')), h('span', { class: 'loadbar-text' }, 'Listening')) : null,
    faint('Change only this one setting while DeviceHub listens.'),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      recording ? button(st.busy ? 'Stopping…' : 'Done', doneChange, { kind: 'primary', disabled: st.busy })
        : button(st.busy ? 'Starting…' : 'Try again', beginChange, { kind: 'primary', disabled: st.busy }),
      button('Skip this setting', () => skipItem(), { kind: 'ghost small' })));
}

// what could not be put back in the maker's app, shown until the page is left
const putBackNote = () => (st.putBack.length ? h('div', { class: 'learn-problem', role: 'status' }, ...st.putBack.map((x) => p(x))) : null);

// ---------- demo mode: the same steps on pretend answers (?demo&learnapp=closed | missing | nopcap shows the others)
const DEMO_DEV = { vid: '1B1C', pid: '7F01', name: 'Kite mouse', vendor: true, collections: 2 };
const demo = { s: null };
function demoPlan() {
  const how = new URLSearchParams(location.search).get('learnapp');
  const maker = { known: true, name: 'Corsair iCUE', page: 'https://www.corsair.com/us/en/s/icue', installed: how !== 'missing', running: !how || how === 'nopcap', window: 'iCUE' };
  return { maker, kind: 'mouse', from: how === 'missing' ? 'brand' : 'files', items: [
    { id: 'dpi', label: 'DPI', kind: 'number', values: [800, 3200], unit: 'DPI', range: { min: 100, max: 26000, step: 50 }, source: 'Corsair iCUE 5\'s own files', ticked: true },
    { id: 'pollingrate', label: 'Polling rate', kind: 'choice', values: ['125 Hz', '1000 Hz'], source: 'the brand sheet', ticked: true },
    { id: 'liftoff', label: 'Lift-off', kind: 'choice', values: ['Low', 'High'], source: 'the brand sheet', ticked: true },
    { id: 'anglesnapping', label: 'Angle snapping', kind: 'toggle', values: [true, false], source: 'Corsair iCUE 5\'s own files', ticked: false },
    { id: 'readingbattery', label: 'Battery', kind: 'reading', role: 'battery', values: [], source: 'the brand sheet', ticked: false }] };
}
async function demoApi(path, b) {
  await new Promise((res) => setTimeout(res, path === 'drive' ? 1200 : 150));
  const s = demo.s;
  const sum = () => ({ active: !!demo.s, device: DEMO_DEV, listener: demo.s?.listening ? 'ready' : 'off', setting: demo.s?.setting || null, takes: demo.s?.takes || [], recording: demo.s?.recording || null,
    learned: demo.s?.learned || [], second: null, saved: demo.s?.saved || null, maker: demo.s ? demoPlan().maker : null });
  const val = (kind, v) => (kind === 'number' ? Number(v) : kind === 'toggle' ? v === 'on' || v === true : v);
  const pcap = new URLSearchParams(location.search).get('learnapp') !== 'nopcap';
  if (path === 'devices') return { devices: [DEMO_DEV], usbpcap: pcap, active: false };
  if (path === 'begin') { demo.s = { takes: [], learned: [] }; return { ok: true, ...sum() }; }
  if (path === 'quit') { demo.s = null; return { ok: true, active: false }; }
  if (!s) return { ok: false, error: 'Pick a device first.' };
  if (path.startsWith('plan')) return { ok: true, ...demoPlan(), ...sum() };
  if (path === 'state') return { usbpcap: pcap, ...sum() };
  if (path === 'listen') { s.listening = true; return { ok: true, ...sum() }; }
  if (path === 'setting') { s.setting = { label: b.label, kind: b.kind, role: b.role || null, unit: b.unit || '', values: (b.values || []).map((v) => val(b.kind === 'reading' ? 'number' : b.kind, v)) }; s.takes = []; return { ok: true, ...sum() }; }
  if (path === 'drive') {
    if (s.setting.label === 'Lift-off') return { ok: true, manual: true, why: 'DeviceHub could not find Lift-off in Corsair iCUE.', ...sum() };
    s.takes = s.setting.values.map((v) => ({ value: v, heard: 6 }));
    return { ok: true, driven: true, restore: { ok: true }, range: s.setting.kind === 'number' ? { min: 100, max: 26000, step: 50 } : null, ...sum() };
  }
  if (path === 'record') { s.recording = { value: val(s.setting.kind === 'reading' ? 'number' : s.setting.kind, b.value) }; return { ok: true, ...sum() }; }
  if (path === 'stop') { s.takes.push({ value: s.recording?.value, heard: 6 }); s.recording = null; return { ok: true, heard: 6, ...sum() }; }
  if (path === 'analyze') {
    const k = s.setting.kind;
    return { ok: true, evidence: [`Pretend: one report moved with ${s.setting.label}, and a read reports it back.`], writeBytes: s.takes.map((t, i) => `22 0${i + 1} 20 00 00`), valueAt: { offset: 1, size: 1 }, kind: k,
      range: k === 'number' ? { min: Math.min(...s.setting.values), max: Math.max(...s.setting.values), step: 1 } : null };
  }
  if (path === 'add') { const set = s.setting; s.learned.push({ key: set.label.toLowerCase(), label: set.label, kind: set.kind, role: set.role, values: set.values, unit: set.unit, min: Number(b.min), max: Number(b.max), step: Number(b.step) }); s.setting = null; s.takes = []; return { ok: true, ...sum() }; }
  if (path === 'remove') { s.learned = s.learned.filter((x) => x.key !== b.key); return { ok: true, ...sum() }; }
  if (path === 'preview') return { ok: true };
  if (path === 'save') { s.saved = { name: 'kite-mouse', id: 'kite-mouse', loaded: false, canSecond: false, note: 'Demo mode: nothing was saved.' }; return { ok: true, ...sum() }; }
  return { ok: false, error: 'Not in demo mode.' };
}

function startingStep() {
  return card([h('h2', {}, 'Starting to listen'), h('span', { class: 'spacer' }), stepNo('ready')],
    p('Windows asks whether DeviceHub may listen to USB. Press Yes. This is asked once for this session.'),
    h('div', { class: 'loadbar-wrap' }, h('div', { class: 'loadbar sweep', role: 'progressbar', 'aria-label': 'Waiting for the listener' }, h('span')), h('span', { class: 'loadbar-text' }, 'Waiting for the Yes')),
    h('div', { class: 'actions', style: { marginTop: '12px' } }, button('Stop', () => { st.step = 'ready'; run('quit', {}); }, { kind: 'ghost small' })));
}

function takeStep() {
  const s = st.server || {};
  const set = s.setting;
  if (!set) { st.step = 'ready'; return readyStep(); }
  const done = s.takes?.length || 0;
  const want = set.values.length > done ? set.values[done] : null;
  const label = set.label;
  const recording = s.recording;
  const total = Math.max(set.values.length, recording || st.third !== '' ? done + 1 : done);
  if (!recording && want == null && st.third === '' && done >= (set.role === 'battery' ? 1 : 2)) {
    // every value recorded: on to the diff
    st.step = 'found'; setTimeout(analyze, 0); return foundStep();
  }
  const value = recording ? recording.value : want ?? st.third;
  const v = showAs(set, value);
  // what the person does: a setting is changed in the app; a reading is made to happen on the device
  const doIt = set.kind !== 'reading' ? `set ${label} to ${v} in the maker's app`
    : set.role === 'battery' ? `open the battery page in the maker's app and wait until it shows ${v}`
      : set.role === 'charging' ? (value ? 'plug in its cable so it charges, and wait until the maker\'s app shows it charging' : 'unplug its cable, and wait until the maker\'s app shows it is not charging')
        : `make the device report ${label} = ${v} (for example, move its wheel or button), and wait until the maker's app shows it`;
  const before = set.kind !== 'reading' ? `In the maker's app, first make sure ${label} is NOT ${v}. Then press Record, ${doIt}, and press Done.`
    : `Press Record, then ${doIt}. Then press Done.`;
  return card([h('h2', {}, `Recording ${Math.min(done + 1, total)} of ${total}: ${label} = ${v}`), h('span', { class: 'spacer' }), stepNo('take')],
    recording
      ? [p(`DeviceHub is listening. Now ${doIt}. Then press Done.`),
        h('div', { class: 'loadbar-wrap' }, h('div', { class: 'loadbar sweep', role: 'progressbar', 'aria-label': 'Listening' }, h('span')), h('span', { class: 'loadbar-text' }, 'Listening'))]
      : [p(before),
        st.heard != null ? faint(`The last recording heard ${st.heard} messages from the device.`) : null,
        faint(set.kind === 'reading' ? 'Change nothing else while DeviceHub listens. The device itself is never written to here.' : 'Change only this one setting while DeviceHub listens. The device itself is never written to here.')],
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      recording
        ? button(st.busy ? 'Stopping…' : 'Done', () => run('stop', {}, (r) => { st.heard = r.heard; if (st.third !== '' && st.server.takes.length > set.values.length) st.third = ''; }), { kind: 'primary', disabled: st.busy })
        : button(st.busy ? 'Starting…' : 'Record', () => run('record', st.third !== '' && want == null ? { value: st.third } : {}), { kind: 'primary', disabled: st.busy }),
      recording ? null : button('Start this setting over', () => { st.step = 'ready'; st.heard = null; redrawPage(); }, { kind: 'ghost small' })));
}

async function analyze() {
  if (st.analyzing) return;
  st.analyzing = true; st.found = null;
  const r = await run('analyze', {});
  st.analyzing = false;
  st.found = r;
  if (r.ok && r.range) st.range = { min: String(r.range.min), max: String(r.range.max), step: String(r.range.step) };
  redrawPage();
}

function bytesLine(hex, at) {
  const parts = String(hex || '').split(' ');
  return h('div', { class: 'learn-bytes mono' }, ...parts.slice(0, 24).map((b, i) => h('span', { class: at && i >= at.offset && i < at.offset + at.size ? 'v' : null }, b)), parts.length > 24 ? h('span', { class: 'faint' }, '…') : null);
}

function foundStep() {
  const f = st.found;
  const s = st.server || {};
  const label = s.setting?.label || 'the setting';
  if (!f) return card([h('h2', {}, 'Looking at the recordings'), h('span', { class: 'spacer' }), stepNo('found')], faint('Comparing what the maker\'s app sent for each value…'));
  if (!f.ok) {
    return card([h('h2', {}, `${label} could not be learned yet`), h('span', { class: 'spacer' }), stepNo('found')],
      ...(f.why || [f.error || 'Something went wrong.']).map((x) => p(x)),
      f.needMore ? (s.setting?.role === 'battery'
        ? row('Another percent', 'Wait until the maker\'s app shows another percent, then enter it', field('Another percent', 'third', st, { placeholder: 'e.g. 79', style: { width: '160px' } }))
        : row('A third value', `Another ${kindWord()} the app offers`, field('Third value', 'third', st, { placeholder: 'e.g. 3200', style: { width: '160px' } }))) : null,
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        f.needMore ? button('Record it', () => { if (!String(st.third).trim()) return; st.step = 'take'; st.found = null; redrawPage(); }, { kind: 'primary' }) : null,
        button('Start this setting over', overAgain, { kind: f.needMore ? 'ghost small' : 'primary' }),
        st.queue ? button('Skip it', () => skipItem((f.why || [f.error]).filter(Boolean)[0] || 'it could not be learned'), { kind: 'ghost small' })
          : s.learned?.length && !second() ? button('Skip it', () => { st.step = 'driver'; redrawPage(); }, { kind: 'ghost small' }) : null));
  }
  const num = f.kind === 'number' && !second();
  // after an add: on the other USB id, on to the next of the saved driver's settings (or to adding the id)
  const added = () => {
    st.found = null; st.form = newForm(); st.heard = null;
    if (st.queue) { const it = current(); if (it) { it.learned = true; it.ticked = false; logItem(it, null); } setTimeout(nextItem, 0); return; }
    st.step = second()?.next ? 'ready' : 'driver';
  };
  return card([h('h2', {}, `Found ${label}`), h('span', { class: 'spacer' }), stepNo('found')],
    ...f.evidence.map((x) => p(x)),
    h('div', { style: { margin: '4px 0 12px' } }, ...f.writeBytes.map((b, i) => h('div', {}, h('span', { class: 'faint' }, `${showAs(s.setting, s.takes?.[i]?.value)}: `), bytesLine(b, f.valueAt)))),
    f.kind === 'reading' ? p(f.role === 'battery' ? 'This becomes the device\'s battery level on its tile. DeviceHub only reads it.' : 'DeviceHub only reads this; it never writes it.', 'faint') : null,
    num ? [p(`What range does the maker's app allow for ${label}? DeviceHub will never send a value outside it.`),
      row('Lowest', null, field('Lowest', 'min', st.range, { style: { width: '140px' }, inputmode: 'numeric' })),
      row('Highest', null, field('Highest', 'max', st.range, { style: { width: '140px' }, inputmode: 'numeric' })),
      row('Step', 'How far one notch moves it', field('Step', 'step', st.range, { style: { width: '140px' }, inputmode: 'numeric' }))] : null,
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button(st.busy ? 'Adding…' : 'Add it to the driver', () => run('add', { ...st.range, ...st.save }, added), { kind: 'primary', disabled: st.busy }),
      button('Start this setting over', overAgain, { kind: 'ghost small' })));
}
// "Start this setting over": in a list, the same setting again from the start; else back to the form
function overAgain() { st.found = null; if (st.queue) { runItem(); return; } st.step = 'ready'; redrawPage(); }

function driverStep() {
  const s = st.server || {};
  const learned = s.learned || [];
  const sec = second();
  const what = (l) => (l.kind === 'reading' ? `${roleWord(l)}: ${l.values.map((v) => showAs(l, v)).join(', ')}` : l.kind === 'number' ? `${l.min}-${l.max}${l.unit ? ` ${l.unit}` : ''}, steps of ${l.step}` : `${l.values.map(show).join(', ')}`);
  if (sec) {
    // the other USB id: every setting of the saved driver, one at a time, then the id is added to it
    const d = s.device || {};
    return card([h('h2', {}, `${sec.of} on USB ${d.vid}:${d.pid}`), h('span', { class: 'spacer' }), stepNo('driver')],
      p(`${sec.done} of ${sec.total} learned on this id.`),
      learned.map((l, i) => row(l.label, what(l), i === learned.length - 1 ? button('Learn it again', () => run('remove', {}), { kind: 'ghost small' }) : null)),
      sec.next ? p(`Next: ${sec.next.label}.`) : p('DeviceHub compares the bytes with the first id. If they are the same, it adds this id to the driver. If they differ, the driver keeps this id\'s own bytes beside the first one\'s.'),
      problems(),
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        sec.next ? button(`Learn ${sec.next.label}`, () => { st.form = newForm(); st.heard = null; st.step = 'ready'; redrawPage(); }, { kind: 'primary' })
          : button(st.busy ? 'Adding…' : 'Add this USB id to the driver', () => run('save', {}, () => { st.step = 'saved'; }), { kind: 'primary', disabled: st.busy })));
  }
  const kinds = ['Mouse', 'Keyboard', 'Headset', 'Light', 'Device'];
  return card([h('h2', {}, `Driver for the ${s.device?.name || 'device'}`), h('span', { class: 'spacer' }), stepNo('driver')],
    learned.length ? learned.map((l) => row(l.label, what(l),
      button('Remove', () => run('remove', { key: l.key }), { kind: 'ghost small' }))) : faint('No settings yet.'),
    ...st.log.filter((x) => !x.ok).map((x) => faint(`Not learned: ${x.label}. ${x.why === 'skipped' ? 'Skipped.' : x.why}`)),
    p('Learn every setting and reading you want here, one at a time, then save.', 'faint'),
    row('Name', 'Shown on its page', field('Name', 'title', st.save, { maxlength: 60 })),
    row('Kind', null, segmented({ value: st.save.kind, compact: true, options: kinds.map((k) => ({ value: k, label: k })), onCommit: (v) => { st.save.kind = v; redrawPage(); } })),
    p('Close the maker\'s app before saving. When the device next connects, DeviceHub tests each setting once by writing back its current value, and two programs writing to one device get in each other\'s way.', 'faint'),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button('Learn another setting', () => { st.form = newForm(); st.heard = null; st.step = st.plan ? 'plan' : 'ready'; redrawPage(); }, { kind: 'ghost' }),
      learned.length ? button(st.busy ? 'Saving…' : 'Save the driver', () => run('save', st.save, () => { st.step = 'saved'; }), { kind: 'primary', disabled: st.busy }) : null));
}

function savedStep() {
  const sv = st.server?.saved || {};
  const d = st.server?.device || {};
  const fresh = () => Object.assign(st, { step: 'pick', devices: null, server: null, error: null, why: null, heard: null, form: newForm(), other: null, plan: null, queue: null, log: [], putBack: [] });
  const again = () => { st.other = { vid: d.vid, name: d.name, pids: [...(st.other?.pids || []), d.pid] }; Object.assign(st, { step: 'other', devices: null, error: null, why: null, heard: null, form: newForm() }); redrawPage(); };
  const otherWay = sv.canSecond ? [h('h3', { style: { margin: '14px 0 6px' } }, 'Also learn it on its cable or receiver'),
    p('Some devices are a different USB device on their cable than on their receiver. If yours is, plug it in the other way and learn the same settings there. DeviceHub then adds it to this same driver.', 'faint')] : [];
  if (sv.second) {
    return card([h('h2', {}, `Added USB ${d.vid}:${d.pid}`), h('span', { class: 'spacer' }), pill('reads only, for now')],
      p(sv.note || ''), ...otherWay,
      h('div', { class: 'actions' },
        sv.canSecond ? button('Learn it another way too', again, { kind: 'ghost' }) : null,
        button('Learn another device', () => { fresh(); redrawPage(); }, { kind: 'ghost' })));
  }
  return card([h('h2', {}, 'Saved'), h('span', { class: 'spacer' }), pill('reads only, for now')],
    p(`The driver is in my-devices\\${sv.name || ''}\\driver.json.`),
    p('For now it only reads the device. Press Turn on settings on its page when you are ready: DeviceHub then writes the current value of each setting back once to make sure it works. Each setting that passes can then be changed on its page.'),
    sv.note ? p(sv.note) : p(sv.loaded ? 'DeviceHub has loaded it: its page is in the sidebar.' : 'Restart DeviceHub (tray icon > Quit, then open it again) to load it.'),
    p('When it works, its page has a Share this driver button, so the next person with this device needs no learning.', 'faint'),
    p('Sharing needs a free GitHub account: it opens a GitHub page that offers the driver to the shared library.', 'faint'),
    ...otherWay,
    h('div', { class: 'actions' },
      sv.loaded && sv.id ? button('Open its page', () => { location.hash = `#/${sv.id}`; }, { kind: 'primary' }) : null,
      sv.canSecond ? button('Learn it the other way', again, { kind: 'ghost' }) : null,
      button('Learn another device', () => { fresh(); redrawPage(); }, { kind: 'ghost' })));
}

// the same device on its other USB id: pick it (the same maker id, another product id) and say how it is plugged in
function otherStep() {
  const o = st.other || {};
  if (!st.devices) {
    if (!st.loading) { st.loading = true; setTimeout(() => loadDevices().finally(() => { st.loading = false; }), 0); }
    return card([h('h2', {}, 'Plug it in the other way'), h('span', { class: 'spacer' }), stepNo('pick')], faint('Looking at what is plugged in…'));
  }
  const list = st.devices.filter((x) => x.vid === o.vid && !(o.pids || []).includes(x.pid));
  return card([h('h2', {}, `Plug in the ${o.name || 'device'} the other way`), h('span', { class: 'spacer' }), stepNo('pick')],
    p('Plug it in with its cable, or through its receiver: whichever way it was not learned. Then pick it here.'),
    row('It is now on', null, segmented({ value: st.link, options: [{ value: 'cable', label: 'Its cable' }, { value: 'receiver', label: 'Its receiver' }], onCommit: (v) => { st.link = v; redrawPage(); } })),
    list.length ? list.map((x) => row(x.name, `USB ${x.vid}:${x.pid}`, button('Learn this one', () => run('second', { vid: x.vid, pid: x.pid, link: st.link }, () => { st.step = 'ready'; st.form = newForm(); }), { kind: 'primary small' })))
      : faint(`No other USB id from the same maker (${o.vid || ''}) is plugged in. If the device is the same USB device both ways, there is nothing more to learn.`),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button('Look again', loadDevices, { kind: 'ghost small', ic: 'refresh' }),
      button('Done', () => { Object.assign(st, { step: 'pick', devices: null, server: null, error: null, why: null, other: null }); redrawPage(); }, { kind: 'ghost small' })));
}

const STYLE_ID = 'learn-css';
// a few lines of style for this page only (the look files belong to another job)
function style() {
  if (document.getElementById(STYLE_ID)) return;
  document.head.append(h('style', { id: STYLE_ID }, `
.learn-step { font-size: 12.5px; color: var(--muted); }
.learn-bytes { display: inline-flex; flex-wrap: wrap; gap: 4px; font-size: 12.5px; }
.learn-bytes span { padding: 1px 3px; border-radius: 4px; }
.learn-bytes span.v { background: var(--accent); color: var(--bg, #000); font-weight: 700; }
.learn-problem { border-left: 3px solid var(--warn); padding: 6px 0 2px 12px; margin: 8px 0; }
.learn-problem p:last-child { margin-bottom: 4px !important; }
.learn-items { display: grid; gap: 6px; margin: 4px 0 8px; }
.learn-item { display: grid; grid-template-columns: minmax(150px, 1fr) auto minmax(120px, 1fr); align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line, rgba(127,127,127,.18)); }
.learn-item.done .learn-tick span { color: var(--muted); }
.learn-tick { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; }
.learn-tick input { width: 16px; height: 16px; accent-color: var(--accent); }
.learn-vals { display: inline-flex; align-items: center; gap: 6px; }
.learn-val { width: 92px; }
.learn-src { font-size: 12.5px; text-align: right; }
.learn-other { margin-top: 12px; }
.learn-other > summary { cursor: pointer; color: var(--muted); margin-bottom: 8px; }
@media (max-width: 640px) { .learn-item { grid-template-columns: 1fr; gap: 4px; } .learn-src { text-align: left; } }
`));
}

export default {
  id: 'learn', title: 'Learn a device', icon: 'plug', watches: [],
  render({ redraw }) {
    redrawPage = redraw;
    style();
    const head = topbar('', 'Learn a device', null, null);
    const body = { pick: pickStep, plan: planStep, ready: readyStep, starting: startingStep, take: takeStep, found: foundStep, driver: driverStep, saved: savedStep, other: otherStep, driving: drivingStep, change: changeStep }[st.step] || pickStep;
    return h('div', {}, head,
      p('DeviceHub learns a device by listening while each setting is changed in the maker\'s app. It never sends the device anything while learning, never touches firmware, and only ever sends bytes it heard the app send.', 'faint'),
      isDemo() ? faint('Demo mode: pretend answers, nothing is listened to or saved.') : null,
      putBackNote(),
      body(),
      st.step !== 'pick' && st.step !== 'saved' && st.step !== 'other' && st.server?.active ? h('div', { class: 'actions', style: { marginTop: '12px' } },
        button('Stop learning', () => run('quit', {}, () => { Object.assign(st, { step: 'pick', server: null, devices: null, plan: null, queue: null, change: null }); }), { kind: 'ghost small' })) : null);
  },
};
