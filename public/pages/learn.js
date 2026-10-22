// Learn a device (22 Oct 2026; helpers/learn-wizard.mjs, docs/handoff/learn-wizard.md): someone whose device DeviceHub
// does not run gets a driver for it without Claude. DeviceHub listens (USBPcap) while the person changes one setting in
// the maker's app, finds the bytes that carry it, and makes a driver.json that is saved read-only until DeviceHub's own
// self-check passes. Nothing here sends anything to the device. One step on screen at a time; plain words; no pop-ups.
// Reached from the Overview's Set up card and from Lighting > This PC ("Learn it").
import { h } from '../ui/dom.js';
import { card, row, segmented, button, pill } from '../ui/controls.js';
import { installerButton } from '../ui/installer-button.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';

// the state of the page (kept across redraws)
const st = { step: 'pick', devices: null, usbpcap: null, error: null, why: null, busy: false, server: null,
  form: { label: '', kind: 'number', unit: '', a: '', b: '' }, third: '', found: null, range: { min: '', max: '', step: '' },
  save: { title: '', kind: 'Device' }, heard: null };
let redrawPage = () => {};

async function api(path, body) {
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
async function waitListener() {
  for (let i = 0; i < 240 && st.step === 'starting'; i++) {
    const r = await api('state');
    st.server = r;
    if (r.listener === 'ready' || r.listener === 'stopped' || r.listener === 'recording') { st.step = 'take'; redrawPage(); return; }
    if (r.listener === 'error' || r.listener === 'ended') { st.step = 'ready'; st.error = r.listenerError || 'DeviceHub stopped listening.'; redrawPage(); return; }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (st.step === 'starting') { st.step = 'ready'; st.error = 'Nothing answered. If Windows asked, press Yes; then press Start listening again.'; redrawPage(); }
}

// ---------- small parts
const p = (text, cls) => h('p', { class: cls || null, style: { margin: '0 0 10px' } }, text);
const faint = (text) => p(text, 'faint');
const steps = ['pick', 'ready', 'take', 'found', 'driver', 'saved'];
const stepNo = (s) => h('span', { class: 'learn-step' }, `Step ${Math.max(1, steps.indexOf(s === 'starting' ? 'ready' : s) + 1)} of 6`);
const field = (label, key, obj, attrs = {}) => {
  const el = h('input', { class: 'text', value: obj[key] ?? '', 'aria-label': label, ...attrs });
  el.addEventListener('input', () => { obj[key] = el.value; });
  return el;
};
const problems = () => (st.error || st.why?.length ? h('div', { class: 'learn-problem', role: 'status' },
  st.error ? p(st.error) : null, ...(st.why || []).map((x) => p(x))) : null);
const show = (v) => (v === true ? 'on' : v === false ? 'off' : String(v));
const kindWord = () => (st.form.kind === 'toggle' ? 'on or off' : st.form.kind === 'choice' ? 'choice' : 'value');
const device = () => st.server?.device;

// ---------- the steps
function pickStep() {
  if (!st.devices) {
    if (!st.loading) { st.loading = true; setTimeout(() => loadDevices().finally(() => { st.loading = false; }), 0); }
    return card([h('h2', {}, 'Pick the device'), h('span', { class: 'spacer' }), stepNo('pick')], faint('Looking at what is plugged in…'));
  }
  const list = st.devices;
  return card([h('h2', {}, 'Pick the device'), h('span', { class: 'spacer' }), stepNo('pick')],
    p('These are plugged in and DeviceHub does not run them yet. Pick the one to learn.'),
    list.length ? list.map((d) => row(d.name, [`USB ${d.vid}:${d.pid}`, d.vendor ? 'has a settings channel' : 'no maker settings channel seen', d.library ? 'a shared driver exists for it: see Set up on the Overview first' : null].filter(Boolean).join(' · '),
      button('Learn this one', () => run('begin', { vid: d.vid, pid: d.pid }, () => { st.step = 'ready'; st.save.title = d.name; }), { kind: d.library ? 'ghost small' : 'primary small' })))
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
  const kindCtl = segmented({ value: f.kind, options: [{ value: 'number', label: 'Number' }, { value: 'toggle', label: 'On or off' }, { value: 'choice', label: 'Choice' }],
    onCommit: (v) => { f.kind = v; redrawPage(); } });
  const values = f.kind === 'toggle' ? faint('DeviceHub records it turned on, then turned off.')
    : h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
      field('First value', 'a', f, { placeholder: f.kind === 'number' ? 'First value, e.g. 800' : 'First choice, e.g. Low' }),
      field('Second value', 'b', f, { placeholder: f.kind === 'number' ? 'Second value, e.g. 1600' : 'Second choice, e.g. High' }));
  const start = async () => {
    const vals = f.kind === 'toggle' ? ['on', 'off'] : [f.a, f.b];
    const r = await run('setting', { label: f.label, kind: f.kind, unit: f.unit, values: vals });
    if (r.ok === false) return;
    st.found = null; st.third = '';
    if (['ready', 'recording', 'stopped'].includes(r.listener)) { st.step = 'take'; redrawPage(); return; }
    const l = await run('listen', {});
    if (l.ok === false) return;
    st.step = 'starting'; redrawPage(); waitListener();
  };
  return card([h('h2', {}, `Get ready${d ? `: ${d.name}` : ''}`), h('span', { class: 'spacer' }), stepNo('ready')],
    p('Open the maker\'s app for this device. Pick ONE setting to teach DeviceHub, and two values the app offers for it.'),
    row('Setting', 'As the maker\'s app names it, e.g. DPI or Brightness', field('Setting', 'label', f, { placeholder: 'e.g. DPI', maxlength: 40 })),
    row('Kind', null, kindCtl),
    f.kind === 'number' ? row('Unit', 'Optional, e.g. DPI or %', field('Unit', 'unit', f, { placeholder: 'optional', maxlength: 10, style: { width: '140px' } })) : null,
    h('div', { style: { margin: '6px 0 12px' } }, values),
    faint('Choose values far apart (for a number, one above 255 if the app goes that high). Firmware, reset and pairing controls are never learned.'),
    problems(),
    h('div', { class: 'actions' },
      button(st.busy ? 'Starting…' : 'Start listening', start, { kind: 'primary', ic: 'plug', disabled: st.busy }),
      button('Pick another device', () => { st.step = 'pick'; redrawPage(); }, { kind: 'ghost small' })));
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
  if (!recording && want == null && st.third === '' && done >= 2) {
    // every value recorded: on to the diff
    st.step = 'found'; setTimeout(analyze, 0); return foundStep();
  }
  const value = recording ? recording.value : want ?? st.third;
  return card([h('h2', {}, `Recording ${Math.min(done + 1, total)} of ${total}: ${label} = ${show(value)}`), h('span', { class: 'spacer' }), stepNo('take')],
    recording
      ? [p(`DeviceHub is listening. In the maker's app, set ${label} to ${show(value)} now. Wait until the app shows it, then press Done.`),
        h('div', { class: 'loadbar-wrap' }, h('div', { class: 'loadbar sweep', role: 'progressbar', 'aria-label': 'Listening' }, h('span')), h('span', { class: 'loadbar-text' }, 'Listening'))]
      : [p(`In the maker's app, first make sure ${label} is NOT ${show(value)}. Then press Record, set it to ${show(value)} in the app, and press Done.`),
        st.heard != null ? faint(`The last recording heard ${st.heard} messages from the device.`) : null,
        faint('Change only this one setting while DeviceHub listens. The device itself is never written to here.')],
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      recording
        ? button(st.busy ? 'Stopping…' : 'Done', () => run('stop', {}, (r) => { st.heard = r.heard; if (st.third !== '' && st.server.takes.length >= 3) st.third = ''; }), { kind: 'primary', disabled: st.busy })
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
      f.needMore ? row('A third value', `Another ${kindWord()} the app offers`, field('Third value', 'third', st, { placeholder: 'e.g. 3200', style: { width: '160px' } })) : null,
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        f.needMore ? button('Record it', () => { if (!String(st.third).trim()) return; st.step = 'take'; st.found = null; redrawPage(); }, { kind: 'primary' }) : null,
        button('Start this setting over', () => { st.step = 'ready'; st.found = null; redrawPage(); }, { kind: f.needMore ? 'ghost small' : 'primary' }),
        s.learned?.length ? button('Skip it', () => { st.step = 'driver'; redrawPage(); }, { kind: 'ghost small' }) : null));
  }
  const num = f.kind === 'number';
  return card([h('h2', {}, `Found ${label}`), h('span', { class: 'spacer' }), stepNo('found')],
    ...f.evidence.map((x) => p(x)),
    h('div', { style: { margin: '4px 0 12px' } }, ...f.writeBytes.map((b, i) => h('div', {}, h('span', { class: 'faint' }, `${show(s.takes?.[i]?.value)}: `), bytesLine(b, f.valueAt)))),
    num ? [p(`What range does the maker's app allow for ${label}? DeviceHub will never send a value outside it.`),
      row('Lowest', null, field('Lowest', 'min', st.range, { style: { width: '140px' }, inputmode: 'numeric' })),
      row('Highest', null, field('Highest', 'max', st.range, { style: { width: '140px' }, inputmode: 'numeric' })),
      row('Step', 'How far one notch moves it', field('Step', 'step', st.range, { style: { width: '140px' }, inputmode: 'numeric' }))] : null,
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button(st.busy ? 'Adding…' : 'Add it to the driver', () => run('add', { ...st.range, ...st.save }, () => { st.step = 'driver'; st.found = null; }), { kind: 'primary', disabled: st.busy }),
      button('Start this setting over', () => { st.step = 'ready'; st.found = null; redrawPage(); }, { kind: 'ghost small' })));
}

function driverStep() {
  const s = st.server || {};
  const learned = s.learned || [];
  const kinds = ['Mouse', 'Keyboard', 'Headset', 'Light', 'Device'];
  return card([h('h2', {}, `Driver for the ${s.device?.name || 'device'}`), h('span', { class: 'spacer' }), stepNo('driver')],
    learned.length ? learned.map((l) => row(l.label, l.kind === 'number' ? `${l.min}-${l.max}${l.unit ? ` ${l.unit}` : ''}, steps of ${l.step}` : `${l.values.map(show).join(', ')}`,
      button('Remove', () => run('remove', { key: l.key }), { kind: 'ghost small' }))) : faint('No settings yet.'),
    p('Learn every setting you want here, one at a time, then save.', 'faint'),
    row('Name', 'Shown on its page', field('Name', 'title', st.save, { maxlength: 60 })),
    row('Kind', null, segmented({ value: st.save.kind, compact: true, options: kinds.map((k) => ({ value: k, label: k })), onCommit: (v) => { st.save.kind = v; redrawPage(); } })),
    p('Close the maker\'s app before saving: when the device next connects, DeviceHub checks each setting by reading it, writing the same value back and reading it again, and two programs writing one device fight.', 'faint'),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button('Learn another setting', () => { st.form = { label: '', kind: 'number', unit: '', a: '', b: '' }; st.heard = null; st.step = 'ready'; redrawPage(); }, { kind: 'ghost' }),
      learned.length ? button(st.busy ? 'Saving…' : 'Save the driver', () => run('save', st.save, () => { st.step = 'saved'; }), { kind: 'primary', disabled: st.busy }) : null));
}

function savedStep() {
  const sv = st.server?.saved || {};
  return card([h('h2', {}, 'Saved'), h('span', { class: 'spacer' }), pill('read-only for now')],
    p(`The driver is in my-devices\\${sv.name || ''}\\driver.json.`),
    p('It starts read-only. The first time the device connects, DeviceHub checks each setting: it reads it, writes that same value, and reads it back. Each setting that passes can then be changed on its page.'),
    p(sv.loaded ? 'DeviceHub has loaded it: its page is in the sidebar.' : 'Restart DeviceHub (tray icon > Quit, then open it again) to load it.'),
    p('When it works, its page has a Share this driver button, so the next person with this device needs no learning.', 'faint'),
    h('div', { class: 'actions' },
      sv.loaded && sv.id ? button('Open its page', () => { location.hash = `#/${sv.id}`; }, { kind: 'primary' }) : null,
      button('Learn another device', () => { Object.assign(st, { step: 'pick', devices: null, server: null, error: null, why: null, heard: null, form: { label: '', kind: 'number', unit: '', a: '', b: '' } }); redrawPage(); }, { kind: 'ghost' })));
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
`));
}

export default {
  id: 'learn', title: 'Learn a device', icon: 'plug', rail: false, watches: [],
  render({ redraw }) {
    redrawPage = redraw;
    style();
    const head = topbar('', 'Learn a device', null, null);
    if (isDemo()) return h('div', {}, head, card([h('h2', {}, 'Not in demo mode')], p('Learning a device needs the installed DeviceHub and the device plugged in.')));
    const body = { pick: pickStep, ready: readyStep, starting: startingStep, take: takeStep, found: foundStep, driver: driverStep, saved: savedStep }[st.step] || pickStep;
    return h('div', {}, head,
      p('DeviceHub learns a device by listening while you change one setting at a time in the maker\'s app. It never sends the device anything while learning, never touches firmware, and only ever sends bytes it heard the app send.', 'faint'),
      body(),
      st.step !== 'pick' && st.step !== 'saved' && st.server?.active ? h('div', { class: 'actions', style: { marginTop: '12px' } },
        button('Stop learning', () => run('quit', {}, () => { Object.assign(st, { step: 'pick', server: null, devices: null }); }), { kind: 'ghost small' })) : null);
  },
};
