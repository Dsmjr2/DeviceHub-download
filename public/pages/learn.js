// Learn a device (22 Oct 2026; helpers/learn-wizard.mjs, docs/handoff/learn-wizard.md): someone whose device DeviceHub
// does not run gets a driver for it without Claude. DeviceHub listens (USBPcap) while the person changes one setting in
// the maker's app, finds the bytes that carry it, and makes a driver.json that is saved read-only until DeviceHub's own
// self-check passes. Nothing here sends anything to the device. One step on screen at a time; plain words; no pop-ups.
// Reached from the sidebar (under App), the Overview's Set up card and Lighting > This PC ("Learn it", which puts that
// device first here: learnThis(vid, pid)).
// Readings (22 Oct 2026, docs/handoff/learn-readings.md): a value the device reports that the person cannot set
// (battery, charging, ChatMix, a sensor) is a fourth kind; DeviceHub only listens for it. After a save, the same device
// can be learned on its other USB id (cable and receiver) and is added to the same driver.
import { h } from '../ui/dom.js';
import { card, row, segmented, button, pill } from '../ui/controls.js';
import { installerButton } from '../ui/installer-button.js';
import { isDemo } from '../core/devices.js';
import { topbar } from './common.js';

// the state of the page (kept across redraws)
const newForm = () => ({ label: '', kind: 'number', role: 'battery', unit: '', a: '', b: '' });
const st = { step: 'pick', devices: null, usbpcap: null, error: null, why: null, busy: false, server: null,
  form: newForm(), third: '', found: null, range: { min: '', max: '', step: '' },
  save: { title: '', kind: 'Device' }, heard: null, want: null, link: 'cable' };
let redrawPage = () => {};

// Lighting > This PC's "Learn it": that device goes first on the Pick step, as the one to learn
export function learnThis(vid, pid) {
  st.want = vid && pid ? `${vid}:${pid}`.toUpperCase() : null;
  if (st.step === 'pick') st.devices = null;
}

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
  return card([h('h2', {}, 'Pick the device'), h('span', { class: 'spacer' }), stepNo('pick')],
    p('These are plugged in and DeviceHub does not run them yet. Pick the one to learn.'),
    st.want && !wanted ? faint(`USB ${st.want.toLowerCase()} is not in this list: DeviceHub may run it already, or it has nothing DeviceHub can learn.`) : null,
    list.length ? list.map((d) => row(d.name, [d === wanted ? 'the one you picked on This PC' : null, `USB ${d.vid}:${d.pid}`, d.vendor ? 'has a settings channel' : 'no maker settings channel seen', d.library && !d.note ? 'a shared driver exists for it: install it from Set up on the Overview' : null, d.refused || d.note || null].filter(Boolean).join(' · '),
      d.refused ? null : button('Learn this one', () => run('begin', { vid: d.vid, pid: d.pid }, () => { st.step = 'ready'; st.save.title = d.name; st.want = null; }), { kind: primary(d) ? 'primary small' : 'ghost small' })))
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
        button('Start this setting over', () => { st.step = 'ready'; st.found = null; redrawPage(); }, { kind: f.needMore ? 'ghost small' : 'primary' }),
        s.learned?.length && !second() ? button('Skip it', () => { st.step = 'driver'; redrawPage(); }, { kind: 'ghost small' }) : null));
  }
  const num = f.kind === 'number' && !second();
  // after an add: on the other USB id, on to the next of the saved driver's settings (or to adding the id)
  const added = () => { st.found = null; st.form = newForm(); st.heard = null; st.step = second()?.next ? 'ready' : 'driver'; };
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
      button('Start this setting over', () => { st.step = 'ready'; st.found = null; redrawPage(); }, { kind: 'ghost small' })));
}

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
    p('Learn every setting and reading you want here, one at a time, then save.', 'faint'),
    row('Name', 'Shown on its page', field('Name', 'title', st.save, { maxlength: 60 })),
    row('Kind', null, segmented({ value: st.save.kind, compact: true, options: kinds.map((k) => ({ value: k, label: k })), onCommit: (v) => { st.save.kind = v; redrawPage(); } })),
    p('Close the maker\'s app before saving. When the device next connects, DeviceHub tests each setting once by writing back its current value, and two programs writing to one device get in each other\'s way.', 'faint'),
    problems(),
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      button('Learn another setting', () => { st.form = newForm(); st.heard = null; st.step = 'ready'; redrawPage(); }, { kind: 'ghost' }),
      learned.length ? button(st.busy ? 'Saving…' : 'Save the driver', () => run('save', st.save, () => { st.step = 'saved'; }), { kind: 'primary', disabled: st.busy }) : null));
}

function savedStep() {
  const sv = st.server?.saved || {};
  const d = st.server?.device || {};
  const fresh = () => Object.assign(st, { step: 'pick', devices: null, server: null, error: null, why: null, heard: null, form: newForm(), other: null });
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
`));
}

export default {
  id: 'learn', title: 'Learn a device', icon: 'plug', watches: [],
  render({ redraw }) {
    redrawPage = redraw;
    style();
    const head = topbar('', 'Learn a device', null, null);
    if (isDemo()) return h('div', {}, head, card([h('h2', {}, 'Not in demo mode')], p('Learning a device needs the installed DeviceHub and the device plugged in.')));
    const body = { pick: pickStep, ready: readyStep, starting: startingStep, take: takeStep, found: foundStep, driver: driverStep, saved: savedStep, other: otherStep }[st.step] || pickStep;
    return h('div', {}, head,
      p('DeviceHub learns a device by listening while you change one setting at a time in the maker\'s app. It never sends the device anything while learning, never touches firmware, and only ever sends bytes it heard the app send.', 'faint'),
      body(),
      st.step !== 'pick' && st.step !== 'saved' && st.step !== 'other' && st.server?.active ? h('div', { class: 'actions', style: { marginTop: '12px' } },
        button('Stop learning', () => run('quit', {}, () => { Object.assign(st, { step: 'pick', server: null, devices: null }); }), { kind: 'ghost small' })) : null);
  },
};
