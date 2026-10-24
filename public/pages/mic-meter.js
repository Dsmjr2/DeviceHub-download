// Mic check: a live level meter for the headset microphone (the one picked on the Headset page, else the HS80),
// measured in this window (the browser's own audio input, with its voice processing switched off so it shows what Windows records). Nothing is recorded, saved or sent.
// Test recording (19 Oct 2026): DeviceHub's helper records the mic through Windows' normal path, filters included, so
// you hear what Discord hears; it lives only in memory (the helper's until played, then this window's audio memory,
// never a file) and is erased on Delete, on a new recording, or 10 minutes after the last play.
// Peak zones follow common voice-chat advice: speaking peaks around -18 to -6 dBFS, never touching 0.
import { h } from '../ui/dom.js';
import { card, button, segmented } from '../ui/controls.js';
import { env } from '../core/env.js';
import { isDemo, devices } from '../core/devices.js';
import { toast } from '../ui/overlay.js';
import { micMatcher, micTestUsb, startMicTest } from '../core/mic-test-pick.js';
import { shortName } from '../core/headset-pick.js';

const ui = { on: false, peak: -90, hold: -90, holdAt: 0, error: null, label: null };
let stream = null, ctx = null, raf = 0, stopTimer = 0;

const zone = (db) => (db >= -1 ? ['clipping', 'bad', 'Clipping. Lower Mic level or boost.']
  : db >= -6 ? ['loud', 'warn', 'A little hot. Lower it if you shout.']
    : db >= -20 ? ['good', 'good', 'Good.']
      : db >= -35 ? ['quiet', 'warn', 'A bit quiet. Raise Mic level.']
        : ['silent', '', 'Talk normally.']);

async function start(redraw) {
  ui.error = null;
  try {
    // ask once (any mic) so device names become visible, then open the headset mic itself
    let s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    // the HS80's mic, or the picked USB headset's by its Windows mic name, its name or its USB id (22 Oct 2026)
    const ad = devices.headset?.adapter;
    const other = micTestUsb(ad?.generic) ? ad.generic.device : null;
    const isIt = micMatcher(ad?.generic, ad?.endpoints);
    const hs = mics.find((d) => isIt(d.label));
    s.getTracks().forEach((t) => t.stop());
    if (!hs) throw new Error(`no ${other || 'HS80'} microphone in Windows (is the headset on?)`);
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: hs.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ui.label = hs.label;
  } catch (e) { ui.error = e.name === 'NotAllowedError' ? 'Mic blocked. Allow it in site settings.' : e.message; redraw(); return; }
  ctx = new AudioContext();
  const an = ctx.createAnalyser(); an.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  ui.on = true; ui.hold = -90;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x));
    const db = m > 0 ? Math.max(-90, 20 * Math.log10(m)) : -90;
    ui.peak = db;
    const now = performance.now();
    if (db > ui.hold || now - ui.holdAt > 3000) { ui.hold = db; ui.holdAt = now; }
    paint();
    raf = requestAnimationFrame(tick);
  };
  tick();
  stopTimer = setTimeout(() => stop(redraw), 120000);  // never left listening
  redraw();
}

function stop(redraw) {
  cancelAnimationFrame(raf); clearTimeout(stopTimer);
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  ctx?.close(); ctx = null;
  ui.on = false;
  redraw();
}

const pct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));  // -60..0 dBFS across the bar
function paint() {
  const bar = document.querySelector('#mic-meter .mm-fill'), mark = document.querySelector('#mic-meter .mm-hold'), txt = document.querySelector('#mic-meter .mm-text');
  if (!bar) return;
  // transforms only (no layout): the meter redraws every frame
  bar.style.transform = `scaleX(${pct(ui.peak) / 100})`;
  mark.style.transform = `translateX(${(pct(ui.hold) / 100) * bar.parentElement.clientWidth}px)`;
  const [name, kind, advice] = zone(ui.hold);
  txt.textContent = `Peak ${ui.hold <= -89 ? '—' : `${ui.hold.toFixed(0)} dB`} · ${name}. ${advice}`;
  txt.dataset.kind = kind;
}

export function micMeter(redraw) {
  const head = [h('h2', {}, 'Mic check'), h('span', { class: 'sub' }, 'nothing is saved'), h('span', { class: 'spacer' }),
    ui.on ? button('Stop', () => stop(redraw), { kind: 'ghost small' }) : button('Start', () => start(redraw), { kind: 'primary small', ic: 'mic' })];
  if (ui.error) return card(head, h('p', { class: 'faint' }, ui.error), testSection(redraw));
  if (!ui.on) return card(head, h('p', { class: 'faint', style: { margin: 0 } }, 'Aim for the green band.'), testSection(redraw));
  const z = (from, to, c) => h('i', { style: { left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%`, background: c } });
  return card(head,
    h('div', { id: 'mic-meter' },
      h('div', { class: 'mm-bar' },
        z(-60, -35, 'transparent'), z(-35, -20, 'color-mix(in srgb, var(--warn) 22%, transparent)'), z(-20, -6, 'color-mix(in srgb, var(--good) 28%, transparent)'),
        z(-6, -1, 'color-mix(in srgb, var(--warn) 30%, transparent)'), z(-1, 0, 'color-mix(in srgb, var(--bad) 40%, transparent)'),
        h('div', { class: 'mm-fill' }), h('div', { class: 'mm-hold' })),
      h('div', { class: 'mm-scale' }, ...[-60, -40, -20, -6, 0].map((d) => h('span', { style: { left: `${pct(d)}%` } }, `${d}`))),
      h('p', { class: 'mm-text' }, 'Listening…'),
      h('p', { class: 'faint', style: { fontSize: '12px', margin: 0 } }, ui.label)),
    testSection(redraw));
}

// ---- test recording ----
const rec = { mic: 'headset', anker: null, state: 'idle', seconds: 0, level: -90, error: null, buffer: null, ctx: null, src: null, playFrom: 0, playStart: 0, playing: false, eraseTimer: 0, poll: 0, raf: 0 };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const api = (path, body) => env.api(`/api/mictest/${path}`, body);

async function recStart(redraw) {
  // the old recording is cleared first and the start waits for it (a clear landing after the start ended an
  // AnkerCamera test early)
  recDelete(redraw, true, true);
  if (!isDemo()) await api('clear', {}).catch(() => {});
  rec.error = null;
  if (isDemo()) { rec.state = 'recording'; rec.seconds = 0; rec.poll = setInterval(() => { rec.seconds += 0.2; rec.level = -30 + Math.random() * 18; paintRec(); }, 200); redraw(); return; }
  try {
    // the headset picked on the Headset page (the HS80 as before when it is picked or the only one)
    const st = await startMicTest(env.api, { mic: rec.mic, generic: devices.headset?.adapter?.generic });
    if (st.error) throw new Error(st.error);
    rec.state = 'recording'; rec.headset = st.headsetMic; redraw();
    rec.poll = setInterval(async () => {
      try {
        const s = await env.api('/api/mictest/status');
        rec.seconds = s.seconds; rec.level = s.level;
        if (s.error) { rec.error = s.error; recStop(redraw); return; }
        if (!s.recording && rec.state === 'recording') { recStop(redraw); return; }  // the 30 second limit
        paintRec();
      } catch {}
    }, 200);
  } catch (e) { rec.state = 'idle'; rec.error = e.message; redraw(); }
}

async function recStop(redraw) {
  clearInterval(rec.poll);
  if (rec.state !== 'recording') return;
  rec.state = 'loading'; redraw();
  if (isDemo()) { rec.state = 'idle'; toast('Demo: not recorded', 'info'); redraw(); return; }
  try {
    await api('stop', {});
    const r = await fetch('/api/mictest/audio', { cache: 'no-store' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'nothing recorded');
    const bytes = await r.arrayBuffer();
    rec.ctx = rec.ctx || new AudioContext();
    rec.buffer = await rec.ctx.decodeAudioData(bytes);
    rec.seconds = rec.buffer.duration;
    rec.state = 'ready'; rec.playFrom = 0;
  } catch (e) { rec.error = e.message; rec.state = 'idle'; }
  // the helper's copy is erased at once: the only copy is now this window's audio memory
  api('clear', {}).catch(() => {});
  armErase(redraw);
  redraw();
}

function armErase(redraw) { clearTimeout(rec.eraseTimer); rec.eraseTimer = setTimeout(() => recDelete(redraw), 10 * 60000); }

function position() { return rec.playing ? Math.min(rec.buffer.duration, rec.playFrom + (rec.ctx.currentTime - rec.playStart)) : rec.playFrom; }
function play(redraw, from = rec.playFrom) {
  if (!rec.buffer) return;
  stopSource();
  if (from >= rec.buffer.duration - 0.05) from = 0;
  rec.ctx.resume();
  const src = rec.ctx.createBufferSource(); src.buffer = rec.buffer; src.connect(rec.ctx.destination);
  src.onended = () => { if (rec.src === src) { rec.playing = false; rec.playFrom = 0; rec.src = null; cancelAnimationFrame(rec.raf); redraw(); } };
  src.start(0, from);
  rec.src = src; rec.playFrom = from; rec.playStart = rec.ctx.currentTime; rec.playing = true;
  armErase(redraw);
  const tick = () => { paintRec(); if (rec.playing) rec.raf = requestAnimationFrame(tick); };
  tick(); redraw();
}
function stopSource() { if (rec.src) { const s = rec.src; rec.src = null; try { s.stop(); } catch {} } cancelAnimationFrame(rec.raf); }
function pause(redraw) { rec.playFrom = position(); rec.playing = false; stopSource(); redraw(); }

function recDelete(redraw, quiet, noClear) {
  clearInterval(rec.poll); clearTimeout(rec.eraseTimer); stopSource();
  rec.buffer = null; rec.playing = false; rec.playFrom = 0; rec.seconds = 0; rec.level = -90;
  if (rec.state === 'recording') api('stop', {}).catch(() => {});
  if (!isDemo() && !noClear) api('clear', {}).catch(() => {});
  rec.state = 'idle';
  if (!quiet) redraw();
}

// live parts redrawn without a page redraw: the timer and level while recording, the play position
function paintRec() {
  const t = document.querySelector('#mic-test .mt-time'), bar = document.querySelector('#mic-test .mt-fill');
  if (rec.state === 'recording') {
    if (t) t.textContent = `${mmss(rec.seconds)} / ${mmss(30)}`;
    if (bar) bar.style.transform = `scaleX(${pct(rec.level) / 100})`;
  } else if (rec.state === 'ready' && rec.buffer) {
    const p = position();
    if (t) t.textContent = `${mmss(p)} / ${mmss(rec.buffer.duration)}`;
    if (bar) bar.style.transform = `scaleX(${p / rec.buffer.duration})`;
  }
}

// is the Anker camera mic in Windows? (looked up once; the test can record it too)
let ankerAsked = false;
function askAnker(redraw) {
  if (ankerAsked || isDemo()) return; ankerAsked = true;
  env.api('/api/corsair/audio-list', { match: 'Anker' }).then((r) => { rec.anker = (r.endpoints || []).some((e) => e.flow === 'recording'); redraw(); }).catch(() => {});
}

function testSection(redraw) {
  askAnker(redraw);
  const title = h('div', { class: 'srow-title' }, 'Test recording');
  const which = rec.anker && (rec.state === 'idle' || rec.state === 'ready')
    ? segmented({ value: rec.mic, compact: true, options: [{ value: 'headset', label: 'Headset' }, { value: 'anker', label: 'AnkerCamera' }], onCommit: async (v) => { rec.mic = v; redraw(); } })
    : null;
  let desc, ctl, body = null;
  if (rec.state === 'idle') {
    desc = rec.error ? `Couldn't record: ${rec.error}` : 'Up to 30 seconds.';
    ctl = h('div', { class: 'actions', style: { alignItems: 'center' } }, which, button('Record', () => recStart(redraw), { kind: 'primary small', ic: 'mic' }));
  } else if (rec.state === 'recording') {
    const g = devices.headset?.adapter?.generic;
    desc = rec.mic === 'anker' ? 'Recording the AnkerCamera…' : micTestUsb(g) ? `Recording the ${shortName(g.device)}…` : 'Recording…';
    ctl = button('Stop', () => recStop(redraw), { kind: 'small' });
    body = h('div', { id: 'mic-test', class: 'mt' }, h('div', { class: 'mt-bar rec' }, h('div', { class: 'mt-fill' })), h('span', { class: 'mt-time' }, `${mmss(rec.seconds)} / ${mmss(30)}`));
  } else if (rec.state === 'loading') {
    desc = 'Getting it ready…'; ctl = null;
  } else {
    desc = 'Not saved. Erased after 10 minutes.';
    ctl = h('div', { class: 'actions' },
      rec.playing ? button('Pause', () => pause(redraw), { kind: 'small' }) : button('Play', () => play(redraw), { kind: 'primary small', ic: 'play' }),
      which, button('Record again', () => recStart(redraw), { kind: 'ghost small', ic: 'mic' }),
      button('Delete', () => recDelete(redraw), { kind: 'ghost small', ic: 'trash' }));
    const bar = h('div', { class: 'mt-bar seek', title: 'Click to play from here' }, h('div', { class: 'mt-fill' }));
    bar.addEventListener('click', (e) => { const r = bar.getBoundingClientRect(); play(redraw, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * rec.buffer.duration); });
    body = h('div', { id: 'mic-test', class: 'mt' }, bar, h('span', { class: 'mt-time' }, ''));
    queueMicrotask(paintRec);
  }
  if (rec.state === 'recording') queueMicrotask(paintRec);
  return h('div', { class: 'mt-wrap' }, h('div', { class: 'srow' }, h('div', {}, title, h('div', { class: 'srow-desc' }, desc)), h('div', { class: 'srow-ctl' }, ctl)), body);
}
