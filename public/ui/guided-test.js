// "Test it with me" on a library driver's page (29 Oct 2026; helpers/guided-test.mjs). One setting at a time: DeviceHub
// says what it will change, changes it on the person's click (the page's own guarded write: backed up, read back), asks
// whether they noticed, and puts the old value back before the next one. Nothing changes without a click, and a
// question left unanswered for a minute puts the value back by itself. Everything shows in place: no pop-ups.
// Once every setting is tried with no "No", the "Works on my device" invitation follows (public/ui/works-report.js).
import { h } from './dom.js';
import { button } from './controls.js';
import { devices, write, isDemo } from '../core/devices.js';
import { testable, testValue } from '../core/guided-values.js';

export const PUT_BACK_MS = 60 * 1000;
const state = {};   // device id -> { tried: {key: {answer}} | null, stage: 'idle'|'ready'|'asked'|'busy', key, from, to, msg, timer }

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// what to look for, from the setting's name; a plain question when nothing fits
export function lookFor(s, kind = 'device') {
  const t = `${s.key} ${s.label}`.toLowerCase();
  const k = String(kind || 'device').toLowerCase();
  if (/bright|light|led|logo|glow|color|colour|effect|rgb|backlight/.test(t)) return `Look at the ${k}'s lights.`;
  if (/dpi|sens|speed|accel/.test(t) && /mouse/.test(k)) return 'Move the mouse: the pointer should move at a different speed.';
  if (/vol|sidetone|eq|bass|treble|gain|mic|chat/.test(t)) return 'Listen on the headset.';
  if (/sleep|timeout|idle|poll|rate|debounce|lift|off after/.test(t)) return "This one can be hard to notice. Can't tell is fine.";
  return `Watch or listen to the ${k}.`;
}
const shown = (s, v) => {
  if (s.type === 'toggle') return v ? 'on' : 'off';
  if (s.type === 'choice') return String(s.options.find((o) => o.value === v)?.label ?? v);
  return `${v}${s.unit || ''}`;
};

// the settings it tries, in page order
export const testSettings = (d) => (d.adapter?.settings || []).filter((s) => testable(s, d.values?.[s.key]));

// where it stands: { left: [settings not answered], no, yes, unsure }
export function standing(d, tried) {
  const out = { left: [], no: [], yes: [], unsure: [] };
  for (const s of testSettings(d)) {
    const a = tried?.[s.key]?.answer;
    (a === 'yes' ? out.yes : a === 'no' ? out.no : a === 'unsure' ? out.unsure : out.left).push(s);
  }
  return out;
}

// box: the element to draw into; after(d): the works invitation once the test is done; redraw: the page's
export function guidedTest(d, { after = () => null, redraw = () => {} } = {}) {
  const id = d.id;
  const box = h('div', { class: 'guided-test', style: { marginTop: '12px', textAlign: 'left' } });
  const s = state[id] || (state[id] = { tried: null, stage: 'idle' });
  // the page redraws on every device change, so each change of step redraws it too (a new box drawn from the same state)
  const set = (x) => { Object.assign(s, x); draw(); redraw(); };
  const setting = (key) => (devices[id]?.adapter?.settings || []).find((x) => x.key === key);
  const load = () => {
    if (isDemo()) return set({ tried: {} });
    getJson(`/api/help/tried?id=${encodeURIComponent(id)}`).then((j) => set({ tried: j.keys || {} })).catch((e) => set({ tried: {}, msg: `Answers not read: ${e.message}` }));
  };
  const save = async (key, answer) => {
    if (isDemo()) { s.tried = { ...s.tried, [key]: { answer } }; return; }
    const j = await getJson('/api/help/tried', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, key, answer, from: s.from, to: s.to }) });
    s.tried = j.keys || s.tried;
  };
  const putBack = async () => {
    clearTimeout(s.timer);
    const x = setting(s.key);
    try { await write(id, s.key, s.from, { label: x?.label || s.key, display: x ? shown(x, s.from) : String(s.from), silent: true, noUndo: true }); return true; }
    catch (e) { set({ stage: 'ready', msg: `${x?.label || s.key} was not put back (${e.message}). Set it on this page.` }); return false; }
  };
  const tryIt = async (x) => {
    const from = devices[id]?.values?.[x.key];
    const to = testValue(x, from);
    if (to === undefined) return answer(x.key, 'unsure');
    set({ stage: 'busy', key: x.key, from, to, msg: '' });
    try { await write(id, x.key, to, { label: x.label, display: shown(x, to), silent: true, noUndo: true }); }
    catch (e) { return set({ stage: 'ready', msg: `${x.label} could not be changed: ${e.message}` }); }
    s.timer = setTimeout(async () => { if (s.stage === 'asked' && s.key === x.key && (await putBack())) set({ stage: 'ready', msg: `No answer, so ${x.label} was put back.` }); }, PUT_BACK_MS);
    set({ stage: 'asked' });
  };
  async function answer(key, a) {
    const was = s.stage;
    if (was !== 'asked') Object.assign(s, { key, from: null, to: null });   // skipped: nothing was changed
    set({ stage: 'busy' });
    if (was === 'asked' && !(await putBack())) return;
    try { await save(key, a); set({ stage: 'ready', msg: '' }); }
    catch (e) { set({ stage: 'ready', msg: `Answer not saved: ${e.message}` }); }
  }
  const small = (t) => h('small', { class: 'faint', style: { display: 'block', marginTop: '6px' } }, t);
  const row = (...kids) => h('div', { class: 'actions', style: { margin: '6px 0 0', justifyContent: 'flex-start', alignItems: 'center' } }, ...kids);
  function draw() {
    if (!s.tried) return box.replaceChildren(small('Reading the test answers…'));
    const st = standing(devices[id] || d, s.tried);
    const total = st.left.length + st.no.length + st.yes.length + st.unsure.length;
    if (!total) return box.replaceChildren(after(d) || '');
    const kind = d.adapter?.kind || 'device';
    if (s.stage === 'asked' || (s.stage === 'busy' && s.key)) {
      const x = setting(s.key);
      if (s.stage === 'busy') return box.replaceChildren(small('One moment…'));
      return box.replaceChildren(h('div', { class: 'works-invite' },
        h('p', {}, h('b', {}, `${x.label}: ${shown(x, s.from)} → ${shown(x, s.to)}. `), 'Did you notice it change?'),
        small(`${lookFor(x, kind)} It goes back to ${shown(x, s.from)} when you answer.`),
        row(button('Yes', () => answer(x.key, 'yes'), { kind: 'primary small' }), button('No', () => answer(x.key, 'no'), { kind: 'ghost small' }), button("Can't tell", () => answer(x.key, 'unsure'), { kind: 'ghost small' }))));
    }
    if (st.no.length) {
      return box.replaceChildren(h('div', { class: 'works-invite' },
        h('p', {}, h('b', {}, 'Something did not work. '), `${st.no.map((x) => x.label).join(', ')} did not change for you. Get help (top right) sends what DeviceHub saw, so the driver can be fixed.`),
        row(button('Test again', () => { for (const x of st.no) delete s.tried[x.key]; set({ stage: 'ready', msg: '' }); }, { kind: 'ghost small' }))));
    }
    if (!st.left.length) {
      const done = after(d);
      return box.replaceChildren(
        small(`Tested with you: ${st.yes.length} seen${st.unsure.length ? `, ${st.unsure.length} can't tell` : ''}.`),
        st.yes.length ? done || '' : small("Nothing you could see changed, so it can't be reported as working yet."),
        row(button('Test again', () => { s.tried = {}; set({ stage: 'ready', msg: '' }); }, { kind: 'ghost small' })));
    }
    const x = st.left[0];
    const step = total - st.left.length + 1;
    if (s.stage === 'idle' && step === 1) {
      return box.replaceChildren(h('div', { class: 'works-invite' },
        h('p', {}, h('b', {}, 'Test it with me. '), `DeviceHub changes each setting for a moment, asks if you noticed, then puts it back. ${total} setting${total === 1 ? '' : 's'}, about a minute. It helps the next person with a ${d.adapter?.title || kind}.`),
        row(button('Start', () => set({ stage: 'ready' }), { kind: 'primary small' }))));
    }
    const to = testValue(x, devices[id]?.values?.[x.key]);
    box.replaceChildren(h('div', { class: 'works-invite' },
      h('p', {}, h('b', {}, `Step ${step} of ${total}: ${x.label}. `), `DeviceHub sets it to ${shown(x, to)} for a moment.`),
      s.msg ? small(s.msg) : null,
      row(button('Change it', () => tryIt(x), { kind: 'primary small' }), button("Skip (can't tell)", () => answer(x.key, 'unsure'), { kind: 'ghost small' }))));
  }
  if (!s.tried) load();
  draw();
  return box;
}
