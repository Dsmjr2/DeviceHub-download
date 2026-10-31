// The HS80 equalizer and the rest of DeviceHub's sound tools, through Equalizer APO (19 Oct 2026, Shawn: "I want to
// be able to change eq inside of devicehub", never iCUE except for firmware updates). Equalizer APO is a sound filter
// on the PC that reads one text file, config.txt, and applies it within a moment of the file changing. DeviceHub keeps
// everything in eq-presets.json (the presets first filled from iCUE's own preset file) and writes config.txt in three
// parts, each limited to its own Windows devices by a Device line, so nothing else is touched:
//   - the headset's outputs (both connections): headroom, the HS80 correction, the preset, extra filters, loudness at
//     low volume, balance
//   - the headset's mic: cut rumble, voice clarity, smooth highs (softer S sounds and hiss), leveler (ReaComp)
//   - any other speaker (the monitors): its own ten bands, separate from the headset's presets (Speakers page)
// Every write backs up the old config.txt first (at most once per 10 minutes) and reads the file back.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'EqualizerAPO', 'config');
const CONFIG = path.join(DIR, 'config.txt');
// DEVICEHUB_EQ_STORE: a test's own file (31 Oct 2026: tests/eqapo-default.mjs wrote the real one)
const STORE = process.env.DEVICEHUB_EQ_STORE || require('./data-dir').dataFile('eq-presets.json', ROOT);
const BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const Q = 1.41;  // one octave per band, as a ten-band graphic EQ

// AutoEQ's correction for the Corsair HS80 RGB Wireless (Rtings' measurement on an HMS II.3, Harman target), from
// github.com/jaakkopasanen/AutoEq results/Rtings/HMS II.3 over-ear/Corsair HS80 RGB WIRELESS (read 19 Oct 2026).
// It flattens the headset's own response: most of all the dip around 3-4 kHz where footstep detail sits.
const HS80_CORRECTION = [
  ['LSC', 105, 7.4, 0.70], ['PK', 135, -6.0, 0.32], ['PK', 3485, 5.5, 0.70], ['PK', 627, 3.2, 2.00], ['PK', 1057, -3.0, 2.44],
  ['HSC', 10000, 4.0, 0.70], ['PK', 5744, -4.1, 5.90], ['PK', 4111, 1.4, 2.19], ['PK', 2892, -1.6, 5.76], ['PK', 69, -0.5, 2.98],
];
// the mic: a high-pass under the voice, and a little less mud and a little more presence
const MIC_RUMBLE = [['HP', 80, 0, 0.71]];
const MIC_CLARITY = [['PK', 250, -2, 1.0], ['PK', 3000, 3, 1.0]];
// harsh S and T sounds sit around 6-7 kHz: a narrow cut there softens them without dulling the voice
const MIC_DEESS = [['PK', 6500, -4, 3.0]];
// the mic leveler: ReaComp (Cockos' free ReaPlugs, installed with Shawn's OK 19 Oct 2026) through Equalizer APO's
// VSTPlugin command. Settings are ReaComp's own 0-1 values, read from the plugin: threshold -24 dB, ratio 3:1, knee
// 6 dB, attack 10 ms, release 150 ms; then +6 dB make-up. Quiet words come up, loud ones are held back.
const REACOMP = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSTPlugins', 'ReaPlugs', 'reacomp-standalone.dll');
// the background gate for other mics, tuned on the AnkerCamera (measured 19 Oct 2026: room about -51 dB, sound from
// the speakers up to -37 dB, Shawn's voice -32 to -28 dB): ReaGate opens at -36 dB, holds 200 ms so word ends are not
// cut, and between words turns the room down by 15 dB (not to silence: that sounds unnatural); 1 ms attack, 200 ms
// release, 6 dB hysteresis. Then +8 dB and the leveler: the voice reaches a webcam about 15 dB quieter than a headset.
const REAGATE = path.join(path.dirname(REACOMP), 'reagate-standalone.dll');
// 19 Oct 2026, Shawn: "it sounds like it has an echo" (the room's reverb, lifted with the voice): 80 ms hold and
// release, the room -25 dB between words, +4 dB lift
const GATE = (lib) => [`VSTPlugin: Library "${lib}" Thresh 0.01585 Attack 0.001 Release 0.016 Hold 0.08 Dry 0.056 Wet 1 Hystrsis 0.4985`];
const CAMERA_LIFT = 'Preamp: 4 dB';
const LEVELER = (lib) => [`VSTPlugin: Library "${lib}" Thresh 0.06275 Ratio 0.01975 Attack 0.02 Release 0.03 Knee 0.248 Wet 1 Dry 0`, 'Preamp: 6 dB'];

const EXTRAS = () => ({ correction: false, filters: [], balance: 0, loudness: false, micRumble: false, micClarity: false, micDeEss: false, micLevel: false, micBoost: 0, speakers: {} });
const installed = () => fs.existsSync(CONFIG);
// a speaker's own EQ: on / off and ten bands; a curve that suits small built-in monitor speakers to start from
// AGON OLED: the AOC AGON's built-in speakers are a little bigger than most, so less of the low end is cut
const SPEAKER_START = { 'Small monitor speakers': [-12, -10, -3, 2, 0, -1.5, 1, 1.5, 1, -1], 'AGON OLED': [-12, -8, -2, 2, 1, -1.5, 1, 2, 1.5, 0], Flat: Array(10).fill(0) };
// a webcam mic (the Anker PowerConf C200): rumble out, a little warmth back (they sound thin), less boxiness,
// more presence, less hiss
const MIC_START = { 'Webcam mic': [-12, -10, -4, -1, -2, -1.5, 2, 3, 1, -2], Flat: Array(10).fill(0) };  // 250/500 Hz down: less room boom
function load() {
  let s; try { s = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return null; }
  s.extras = { ...EXTRAS(), ...(s.extras || {}) };
  // 19 Oct 2026: speakers used to pick one of the headset's presets; each now has its own bands (the preset's copied)
  let moved = false;
  for (const [guid, v] of Object.entries(s.extras.speakers)) {
    if (v && !Array.isArray(v.stages)) {
      const p = s.presets.find((q) => q.id === v.presetId);
      s.extras.speakers[guid] = { on: !!p, stages: p ? p.stages.slice() : Array(10).fill(0) }; moved = true;
    }
  }
  if (moved) {
    // the monitor preset made for the IPS speakers leaves the headset's list (unless the headset uses it)
    s.presets = s.presets.filter((q) => q.name !== 'Acer monitor speakers' || q.id === s.activeId);
    store(s);
  }
  return s;
}
function store(s) { writeAtomic(STORE, JSON.stringify(s, null, 1)); }

// First use: the presets iCUE had, else a flat one; always start on the Flat / Pure Direct preset so Equalizer APO
// never changes a person's base headset sound until they pick a preset or move a band themselves.
async function first(icueEq) {
  let presets = [];
  try {
    const r = await icueEq.read();
    if (r.available) {
      presets = r.presets.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((v) => Math.round(v * 100) / 100), builtIn: !!p.builtIn }));
    }
  } catch {}
  if (!presets.length) presets = [{ id: `{${crypto.randomUUID()}}`, name: 'Flat', stages: Array(10).fill(0), builtIn: true }];
  let flat = presets.find((p) => p.stages.every((v) => v === 0));
  if (!flat) { flat = { id: `{${crypto.randomUUID()}}`, name: 'Pure Direct', stages: Array(10).fill(0), builtIn: true }; presets = [flat, ...presets]; }
  const s = { presets, activeId: flat.id, headroom: true, extras: EXTRAS() };
  store(s);
  return s;
}

// ---- how a chain of filters sounds: the RBJ biquad shapes Equalizer APO uses, at 48 kHz ----
function biquad([type, f, g, q], fs = 48000) {
  const A = 10 ** (g / 40), w = 2 * Math.PI * f / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q), sa = 2 * Math.sqrt(A) * al;
  if (type === 'PK') return [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
  if (type === 'LSC') return [A * ((A + 1) - (A - 1) * c + sa), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sa), (A + 1) + (A - 1) * c + sa, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sa];
  if (type === 'HSC') return [A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa), (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa];
  if (type === 'HP') return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
  return [1, 0, 0, 1, 0, 0];
}
function gainAt(filters, f, fs = 48000) {
  const w = 2 * Math.PI * f / fs, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
  let db = 0;
  for (const fl of filters) {
    const [b0, b1, b2, a0, a1, a2] = biquad(fl, fs);
    const nr = b0 + b1 * cr + b2 * c2r, ni = b1 * ci + b2 * c2i, dr = a0 + a1 * cr + a2 * c2r, di = a1 * ci + a2 * c2i;
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return db;
}
const GRID = Array.from({ length: 121 }, (_, i) => 20 * 1000 ** (i / 120));  // 20 Hz to 20 kHz
const curve = (filters) => GRID.map((f) => Math.round(gainAt(filters, f) * 100) / 100);
const peak = (filters) => Math.max(0, ...curve(filters));

// ---- config.txt ----
const fmt = (v) => (Math.round(v * 100) / 100).toString();
const line = ([t, f, g, q], i) => (t === 'HP' ? `Filter ${i}: ON HP Fc ${fmt(f)} Hz Q ${q}` : `Filter ${i}: ON ${t} Fc ${fmt(f)} Hz Gain ${fmt(g)} dB Q ${q}`);
const bandsOf = (stages) => stages.map((g, i) => ['PK', FREQS[i], g, Q]);
// the headset's whole chain of filters (what the curve on the page shows)
// the HS80 correction is AutoEq's measurement of the HS80: only ever applied to an HS80 (20 Oct 2026, any headset)
function headsetFilters(s, stages, model = 'HS80') {
  const x = s.extras;
  return [...(x.correction && model === 'HS80' ? HS80_CORRECTION : []), ...bandsOf(stages), ...x.filters.map((f) => ['PK', f.f, f.g, f.q])];
}
// ctx: { headset: [guid], mic: [guid], speakers: [{ guid, name }] } from the native helper
function text(s, stages, name, ctx) {
  const x = s.extras, out = ['# Written by DeviceHub (Headset page); DeviceHub replaces this file when its sound settings change.', ''];
  const model = ctx.headsetModel || 'HS80';
  const chain = headsetFilters(s, stages, model);
  const activeChain = chain.filter(([t, , g]) => !(t === 'PK' && Math.abs(g) < 0.005));
  out.push(`# Headset: ${name}${x.correction && model === 'HS80' ? ' + HS80 correction' : ''}${model !== 'HS80' ? ` (${model})` : ''}`, `Device: ${ctx.headset.length ? ctx.headset.join('; ') : '*HS80*'}`);
  if (activeChain.length || x.loudness || x.balance) {
    out.push(`Preamp: ${fmt(s.headroom !== false && activeChain.length ? -peak(activeChain) : 0)} dB`, ...activeChain.map((f, i) => line(f, i + 1)));
    if (x.loudness) out.push('LoudnessCorrection: State 1 ReferenceLevel 75 ReferenceOffset 0 Attenuation 1');
    if (x.balance) out.push(`Channel: ${x.balance > 0 ? 'L' : 'R'}`, `Preamp: ${fmt(-Math.abs(x.balance))} dB`, 'Channel: all');
  } else {
    out.push('# Base headset sound unchanged (0 dB flat)');
  }
  const mic = [...(x.micRumble ? MIC_RUMBLE : []), ...(x.micClarity ? MIC_CLARITY : []), ...(x.micDeEss ? MIC_DEESS : [])];
  const level = x.micLevel && fs.existsSync(REACOMP);
  // mic boost (20 Oct 2026): DeviceHub's own, a gain on the headset mic in place of iCUE's (which Corsair's audio
  // service applied), so iCUE is not needed for it
  const boost = x.micBoost || 0;
  if ((mic.length || level || boost) && ctx.mic.length) {
    out.push('', '# Headset mic', `Device: ${ctx.mic.join('; ')}`, `Preamp: ${fmt(-peak(mic) + boost)} dB`, ...mic.map((f, i) => line(f, i + 1)));
    if (level) out.push(...LEVELER(REACOMP));
  }
  // every device with saved settings gets its section, also while it is off or unplugged (19 Oct 2026: a monitor that
  // was off lost its EQ whenever the file was rewritten): the ones Windows shows now, then the remembered ones
  // (the headset's own devices count as seen: one that once had a speaker EQ does not get both)
  const seen = new Set([...[...ctx.speakers, ...(ctx.mics || [])].map((d) => d.guid), ...ctx.headset, ...ctx.mic]);
  const away = Object.entries(x.speakers).filter(([g, v]) => !seen.has(g) && v?.name).map(([guid, v]) => ({ guid, name: v.name, kind: v.kind }));
  for (const sp of [...ctx.speakers, ...(ctx.mics || []), ...away]) {
    const v = x.speakers[sp.guid] || {};
    const f = v.on ? bandsOf(v.stages) : [];
    // a mic's gate and leveler come after its EQ
    const after = sp.kind === 'mic' ? [...(v.gate && fs.existsSync(REAGATE) ? GATE(REAGATE) : []), ...(v.level && fs.existsSync(REACOMP) ? [CAMERA_LIFT, ...LEVELER(REACOMP)] : [])] : [];
    if (!f.length && !after.length) continue;
    out.push('', `# ${sp.name}`, `Device: ${sp.guid}`);
    if (f.length) out.push(`Preamp: ${fmt(s.headroom !== false ? -peak(f) : 0)} dB`, ...f.map((q, i) => line(q, i + 1)));
    out.push(...after);
  }
  out.push('');
  return out.join('\r\n');
}

let lastBackup = 0;
function write(t, backupDir) {
  if (!installed()) throw new Error('Equalizer APO is not installed');
  if (backupDir && Date.now() - lastBackup > 600000) {
    try { fs.copyFileSync(CONFIG, path.join(backupDir, `eqapo-config-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)); lastBackup = Date.now(); } catch {}
  }
  // a plain write on purpose: Equalizer APO watches this file for edits (a swapped-in file might not be noticed), and
  // it is rebuilt from eq-presets.json (saved crash-proof) on every change, so it can never be lost
  fs.writeFileSync(CONFIG, t);
  if (fs.readFileSync(CONFIG, 'utf8') !== t) throw new Error('Equalizer APO\'s config file did not read back the same');
}

const check = (stages) => {
  const s = Array.isArray(stages) ? stages.map(Number) : [];
  if (s.length !== 10 || s.some((v) => !Number.isFinite(v) || v < -12 || v > 12)) throw new Error('each of the 10 bands must be between -12 and +12 dB');
  return s.map((v) => Math.round(v * 100) / 100);
};
// the settings the page may change, each checked
function extrasFrom(body, old) {
  const x = { ...old };
  for (const k of ['correction', 'loudness', 'micRumble', 'micClarity', 'micDeEss', 'micLevel']) if (k in body) x[k] = !!body[k];
  if ('micBoost' in body) { const b = Number(body.micBoost); if (!Number.isInteger(b) || b < 0 || b > 10) throw new Error('mic boost must be 0-10 dB'); x.micBoost = b; }
  if ('balance' in body) { const b = Number(body.balance); if (!Number.isFinite(b) || Math.abs(b) > 12) throw new Error('balance must be within 12 dB'); x.balance = Math.round(b * 2) / 2; }
  if ('filters' in body) {
    if (!Array.isArray(body.filters) || body.filters.length > 20) throw new Error('at most 20 extra filters');
    x.filters = body.filters.map((f) => {
      const v = { f: Number(f.f), g: Number(f.g), q: Number(f.q) };
      if (!(v.f >= 20 && v.f <= 20000) || !(Math.abs(v.g) <= 12) || !(v.q >= 0.1 && v.q <= 10)) throw new Error('each filter: 20-20000 Hz, -12 to +12 dB, width (Q) 0.1-10');
      return { f: Math.round(v.f), g: Math.round(v.g * 10) / 10, q: Math.round(v.q * 100) / 100 };
    });
  }
  // one speaker at a time: { speaker: { guid, on?, stages? } }
  if ('speaker' in body) {
    const { guid } = body.speaker || {};
    if (!/^\{[0-9a-f-]{36}\}$/i.test(guid || '')) throw new Error('unknown speaker');
    const cur = x.speakers[guid] || { on: false, stages: Array(10).fill(0) };
    const b = body.speaker;
    x.speakers = { ...x.speakers, [guid]: { on: 'on' in b ? !!b.on : cur.on, stages: 'stages' in b ? check(b.stages) : cur.stages,
      gate: 'gate' in b ? !!b.gate : !!cur.gate, level: 'level' in b ? !!b.level : !!cur.level } };
  }
  return x;
}

// Equalizer APO's own starting config.txt (its installer writes "Preamp: -6 dB" and "Include: example.txt") makes every
// sound device 6 dB quieter with an example EQ (22 Oct 2026, a friend's headset "is now very low and he cant make it
// higher"; Shawn: "I dont want it changing anything unless he wants to in the app"). While the file is still exactly
// that untouched default, DeviceHub replaces it with an empty one (the old one backed up first), so nothing changes
// until the person uses DeviceHub's EQ.
const APO_DEFAULT = new Set(['preamp: -6 db', 'include: example.txt', 'device: all']);
const EMPTY_HEADER = '# Written by DeviceHub: Equalizer APO\'s own starting settings (6 dB quieter, an example EQ) were taken out,';
// When Equalizer APO is freshly installed on a PC (its config.txt was just Equalizer APO's default, or our empty
// comment-only replacement with no active filter lines), ensure eq-presets.json also starts on the Flat / Pure Direct
// preset with all headset & mic extras off, so installing Equalizer APO never changes the person's base headset sound.
function ensureFlatStore() {
  try {
    const s = load();
    if (!s || !Array.isArray(s.presets)) return;
    let flat = s.presets.find((p) => Array.isArray(p.stages) && p.stages.every((v) => v === 0));
    if (!flat) { flat = { id: `{${crypto.randomUUID()}}`, name: 'Pure Direct', stages: Array(10).fill(0), builtIn: true }; s.presets = [flat, ...s.presets]; }
    const x = s.extras || {};
    const hadActive = s.activeId !== flat.id || x.correction || x.loudness || x.balance || (x.filters && x.filters.length) || x.micRumble || x.micClarity || x.micDeEss || x.micLevel || x.micBoost;
    if (hadActive) {
      s.activeId = flat.id;
      s.extras = { ...EXTRAS(), speakers: x.speakers || {} };
      store(s);
    }
  } catch {}
}
function clearApoDefault(backupDir) {
  try {
    if (!installed()) return false;
    const t = fs.readFileSync(CONFIG, 'utf8');
    const lines = t.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) {
      if (t.includes(EMPTY_HEADER)) ensureFlatStore();
      return true;
    }
    if (!lines.every((l) => APO_DEFAULT.has(l))) return false;   // DeviceHub's active config or the person's own
    if (backupDir) try { fs.copyFileSync(CONFIG, path.join(backupDir, `eqapo-config-default-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`)); } catch {}
    const empty = `${EMPTY_HEADER}\r\n# so nothing changes until you use the EQ in DeviceHub. The old file is in DeviceHub's backups.\r\n`;
    fs.writeFileSync(CONFIG, empty);
    ensureFlatStore();
    return fs.readFileSync(CONFIG, 'utf8') === empty;
  } catch { return false; }
}

module.exports = (icueEq, allDevices, backupDir) => {
  let cleared = clearApoDefault(backupDir);   // at start, and after DeviceHub installs Equalizer APO (installed() below re-checks)
  // the headset picked on the Headset page, when two or more are plugged in (helpers/headset-pick-eq.js)
  const devices = require('./headset-pick-eq').withPick(allDevices);
  const state = async () => load() || first(icueEq);
  // draft: stages shown on the page but not saved (while the sliders move)
  let draft = null;
  const apply = async (s) => {
    const p = s.presets.find((x) => x.id === s.activeId);
    const ctx = await devices();
    // remember each set-up device's name and kind, so its section is written while it is away; if a display driver update
    // gave a monitor a new GUID, carry over the saved curve from its previous entry with the same name
    let named = false;
    for (const d of [...ctx.speakers, ...(ctx.mics || [])]) {
      let v = s.extras.speakers[d.guid];
      if (!v || (!v.on && Array.isArray(v.stages) && v.stages.every((x) => x === 0))) {
        const prev = Object.entries(s.extras.speakers).find(([g, old]) => g !== d.guid && old?.name === d.name && Array.isArray(old.stages) && old.stages.some((x) => x !== 0));
        if (prev) {
          v = s.extras.speakers[d.guid] = { ...prev[1], name: d.name, ...(d.kind ? { kind: d.kind } : {}) };
          named = true;
        }
      }
      if (v && (v.name !== d.name || (v.kind || null) !== (d.kind || null))) { v.name = d.name; if (d.kind) v.kind = d.kind; else delete v.kind; named = true; }
    }
    if (named) store(s);
    write(text(s, draft ? draft.stages : p.stages, draft ? `${p.name} (not saved)` : p.name, ctx), backupDir);
  };
  const api = {
    installed: () => { const on = installed(); if (on && !cleared) cleared = clearApoDefault(backupDir) || cleared; return on; },  // catches an install made while DeviceHub runs
    devices,  // the sound devices the EQ is written for, with the Headset page's pick applied
    async read() {
      const s = await state(); const p = s.presets.find((x) => x.id === s.activeId); const ctx = await devices();
      return { available: true, engine: 'eqapo', bands: BANDS, presets: s.presets, activeId: s.activeId, headroom: s.headroom !== false, unsaved: !!draft,
        extras: s.extras, micFound: ctx.mic.length > 0, headsetModel: ctx.headsetModel || null, levelerAvailable: fs.existsSync(REACOMP), speakerStarts: SPEAKER_START,
        micStarts: MIC_START,
        speakers: [...ctx.speakers, ...(ctx.mics || [])].map((sp) => {
          let v = s.extras.speakers[sp.guid];
          if (!v || (Array.isArray(v.stages) && v.stages.every((x) => x === 0))) {
            const prev = Object.entries(s.extras.speakers).find(([g, old]) => g !== sp.guid && old?.name === sp.name && Array.isArray(old.stages) && old.stages.some((x) => x !== 0));
            if (prev && !v) v = prev[1];
          }
          if (!v) {
            const def = sp.kind === 'mic' ? MIC_START['Webcam mic'] : /oled|agon/i.test(sp.name || '') ? SPEAKER_START['AGON OLED'] : SPEAKER_START['Small monitor speakers'];
            v = { on: false, stages: def.slice() };
          }
          return { ...sp, on: v.on, stages: v.stages, gate: !!v.gate, level: !!v.level, curve: curve(bandsOf(v.stages)) };
        }),
        curve: { hz: GRID.map((f) => Math.round(f)), db: curve(headsetFilters(s, draft ? draft.stages : p.stages, ctx.headsetModel || 'HS80')) } };
    },
    async activate({ id }) {
      const s = await state(); if (!s.presets.some((x) => x.id === id)) throw new Error('unknown preset');
      s.activeId = id; draft = null; store(s); await apply(s);
      return api.read();
    },
    // plays a draft while the sliders move, without saving it (null: back to the active preset)
    async preview({ stages }) {
      const s = await state();
      draft = stages == null ? null : { stages: check(stages) };
      await apply(s);
      return { ok: true, curve: (await api.read()).curve };
    },
    // the whole list as the editor wants it; built-ins come back unchanged; new ones get an id
    async save({ presets, activeId }) {
      const s = await state();
      if (!Array.isArray(presets) || !presets.length || presets.length > 50) throw new Error('send the whole preset list');
      const byId = new Map(s.presets.map((p) => [p.id, p]));
      const next = presets.map((p) => {
        const name = String(p.name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40); if (!name) throw new Error('every preset needs a name');
        const stages = check(p.stages); const old = p.id ? byId.get(p.id) : null;
        if (p.id && !old) throw new Error(`unknown preset id ${p.id}`);
        if (old?.builtIn && (old.name !== name || old.stages.some((v, i) => Math.abs(v - stages[i]) > 0.005))) throw new Error(`"${old.name}" is a built-in preset; copy it to a new preset to change it`);
        return { id: old ? old.id : `{${crypto.randomUUID()}}`, name, stages, builtIn: !!old?.builtIn };
      });
      for (const p of s.presets) if (p.builtIn && !next.some((x) => x.id === p.id)) throw new Error(`"${p.name}" is built in and can't be deleted`);
      const want = activeId && next.some((p) => p.id === activeId) ? activeId : s.activeId;
      if (!next.some((p) => p.id === want)) throw new Error('the preset in use can\'t be deleted');
      s.presets = next; s.activeId = want; draft = null; store(s); await apply(s);
      return api.read();
    },
    // the whole sound setup, for the setup file (core/setup.js, weekly-setup.mjs), and putting one back: checked,
    // the current one backed up first, then written and played
    async exportState() { const s = await state(); return JSON.parse(JSON.stringify(s)); },
    async importState(st) {
      if (!st || !Array.isArray(st.presets) || !st.presets.length || st.presets.length > 50) throw new Error('no sound settings in the file');
      const presets = st.presets.map((p) => ({ id: String(p.id), name: String(p.name || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || 'Preset', stages: check(p.stages), builtIn: !!p.builtIn }));
      const cur = await state();
      const next = { presets, activeId: presets.some((p) => p.id === st.activeId) ? st.activeId : presets[0].id, headroom: st.headroom !== false, extras: extrasFrom(st.extras || {}, EXTRAS()) };
      // the speakers: this PC's own (a file from another PC names other devices) plus the file's
      next.extras.speakers = { ...(cur.extras?.speakers || {}) };
      for (const [guid, v] of Object.entries(st.extras?.speakers || {})) {
        if (!/^\{[0-9a-f-]{36}\}$/i.test(guid) || !v) continue;
        next.extras.speakers[guid] = { on: !!v.on, stages: Array.isArray(v.stages) ? check(v.stages) : Array(10).fill(0), gate: !!v.gate, level: !!v.level, ...(v.name ? { name: String(v.name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) } : {}), ...(v.kind === 'mic' ? { kind: 'mic' } : {}) };   // (31 Oct 2026: a line break in a name from a file could add a config.txt line)
      }
      if (backupDir && fs.existsSync(STORE)) fs.copyFileSync(STORE, path.join(backupDir, `eq-presets-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      store(next); draft = null; await apply(next);
      return api.read();
    },
    async setHeadroom({ on }) { const s = await state(); s.headroom = !!on; store(s); await apply(s); return api.read(); },
    async setExtras(body) { const s = await state(); s.extras = extrasFrom(body || {}, s.extras); store(s); await apply(s); return api.read(); },
    // Reset sound to normal (22 Oct 2026, Shawn: "make a revert to default in the app so he can easily do it"): every
    // effect off, so sound plays as it does without Equalizer APO. The presets are kept (Flat made active, added if
    // missing); each speaker's bands are kept but switched off; the old config.txt is backed up first.
    async resetToNormal() {
      const s = await state();
      lastBackup = 0;   // always back up the file being replaced
      let flat = s.presets.find((p) => p.stages.every((v) => v === 0));
      if (!flat) { flat = { id: `{${crypto.randomUUID()}}`, name: 'Flat', stages: Array(10).fill(0), builtIn: true }; s.presets = [flat, ...s.presets]; }
      s.activeId = flat.id;
      const speakers = Object.fromEntries(Object.entries(s.extras.speakers || {}).map(([g, v]) => {
        const zero = !Array.isArray(v.stages) || v.stages.every((x) => x === 0);
        const def = v.kind === 'mic' ? MIC_START['Webcam mic'] : /oled|agon/i.test(v.name || '') ? SPEAKER_START['AGON OLED'] : SPEAKER_START['Small monitor speakers'];
        return [g, { ...v, on: false, gate: false, level: false, stages: zero ? def.slice() : v.stages }];
      }));
      s.extras = { ...EXTRAS(), speakers };   // headset extra filters and mic effects off; each speaker off, its bands kept
      draft = null; store(s); await apply(s);
      return api.read();
    },
  };
  return api;
};
module.exports.HS80_CORRECTION = HS80_CORRECTION;
module.exports.gainAt = gainAt;
module.exports.clearApoDefault = clearApoDefault;
