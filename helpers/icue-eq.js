// The HS80's equalizer is applied on the PC by Corsair's audio service ("Corsair Audio Output Effects" on the
// headset's Windows output), from the presets iCUE keeps in eq_presets\unlimitedequalizerpresets.cuelibrary.
// iCUE reads that file only when it starts. So saving here: back up, close iCUE, write the file, start iCUE,
// read the file back. The active preset (in iCUE's profile, one slot per audio mode) is never touched here.
// Measured on Shawn's PC, 18-19 Oct 2026.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');
const { execFile, spawn } = require('child_process');

const CUE = path.join(process.env.APPDATA || '', 'Corsair', 'CUE5');
const LIBRARY = path.join(CUE, 'eq_presets', 'unlimitedequalizerpresets.cuelibrary');
const PROFILES = path.join(CUE, 'profiles');
const ICUE_EXE = 'C:\\Program Files\\Corsair\\Corsair iCUE5 Software\\iCUE.exe';
const BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const GUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? m[1] : null; };

// Parses the library into { presets: [{ id, name, stages[10], enabled, linkSliders, builtIn }], defaults: [ids] }.
function parse(xml) {
  const presetsXml = tag(xml, 'presets');
  if (presetsXml == null) throw new Error('the iCUE EQ file has no <presets> list');
  const defaultsXml = tag(xml, 'defaultPresetsIds') || '';
  const defaults = [...defaultsXml.matchAll(/<value\d+>([^<]+)<\/value\d+>/g)].map((m) => m[1]);
  const presets = [];
  // Each preset is a top-level <valueN> holding <id>, <name>, <stages>, <enabled>, <linkSliders>.
  for (const m of presetsXml.matchAll(/<value(\d+)>\s*([\s\S]*?<linkSliders>[^<]*<\/linkSliders>)\s*<\/value\1>/g)) {
    const body = m[2];
    const stages = [...(tag(body, 'stages') || '').matchAll(/<value\d+>([^<]+)<\/value\d+>/g)].map((s) => Number(s[1]));
    const p = { id: tag(body, 'id'), name: unesc(tag(body, 'name') || ''), stages, enabled: tag(body, 'enabled') === 'true', linkSliders: tag(body, 'linkSliders') === 'true' };
    if (!GUID.test(p.id || '') || stages.length !== 10 || stages.some((v) => !Number.isFinite(v))) throw new Error(`preset "${p.name}" is not in the shape DeviceHub knows; not touching the file`);
    p.builtIn = defaults.includes(p.id);
    presets.push(p);
  }
  if (!presets.length) throw new Error('no presets found in the iCUE EQ file');
  const forceMatch = xml.match(/<forcePresetIndexChange>([^<]*)<\/forcePresetIndexChange>/);
  return { presets, defaults, forcePresetIndexChange: forceMatch ? forceMatch[1] : 'false' };
}

// Writes the library in the same layout iCUE uses (cereal XML, tabs, first entries carry cereal_class_version).
function serialize({ presets, defaults, forcePresetIndexChange }) {
  const T = (n) => '\t'.repeat(n);
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<cereal>', `${T(1)}<value0>`, `${T(2)}<cereal_class_version>500</cereal_class_version>`, `${T(2)}<presets size="dynamic">`];
  presets.forEach((p, i) => {
    lines.push(`${T(3)}<value${i}>`);
    if (i === 0) lines.push(`${T(4)}<cereal_class_version>500</cereal_class_version>`);
    lines.push(`${T(4)}<id>${p.id}</id>`, `${T(4)}<name>${esc(p.name)}</name>`, `${T(4)}<stages size="dynamic">`);
    p.stages.forEach((v, j) => lines.push(`${T(5)}<value${j}>${String(v)}</value${j}>`));
    lines.push(`${T(4)}</stages>`, `${T(4)}<enabled>${p.enabled ? 'true' : 'false'}</enabled>`, `${T(4)}<linkSliders>${p.linkSliders ? 'true' : 'false'}</linkSliders>`, `${T(3)}</value${i}>`);
  });
  lines.push(`${T(2)}</presets>`, `${T(2)}<defaultPresetsIds size="dynamic">`);
  defaults.forEach((id, i) => lines.push(`${T(3)}<value${i}>${id}</value${i}>`));
  lines.push(`${T(2)}</defaultPresetsIds>`, `${T(2)}<forcePresetIndexChange>${forcePresetIndexChange}</forcePresetIndexChange>`, `${T(1)}</value0>`, '</cereal>', '');
  return lines.join('\n');
}

// Which preset each EQ slot of iCUE's profile uses (read-only; slot = iCUE's "selector").
function activeSlots() {
  try {
    for (const f of fs.readdirSync(PROFILES).filter((x) => x.endsWith('.cueprofiledata'))) {
      const t = fs.readFileSync(path.join(PROFILES, f), 'utf8');
      const slots = [...t.matchAll(/<activePresetId>([^<]+)<\/activePresetId>\s*<isUnlimited>[^<]*<\/isUnlimited>\s*<selector>(\d+)<\/selector>/g)].map((m) => ({ slot: Number(m[2]), id: m[1] }));
      if (slots.length) return slots;
    }
  } catch {}
  return [];
}

const icueRunning = () => new Promise((resolve) => execFile('tasklist', ['/fi', 'imagename eq iCUE.exe', '/fo', 'csv', '/nh'], { windowsHide: true }, (e, out) => resolve(/iCUE\.exe/i.test(out || ''))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function read() {
  if (!fs.existsSync(LIBRARY)) return { available: false, reason: 'iCUE has no EQ preset file on this PC (open the HS80 equalizer in iCUE once)' };
  const lib = parse(fs.readFileSync(LIBRARY, 'utf8'));
  return { available: true, bands: BANDS, presets: lib.presets, slots: activeSlots(), icueRunning: await icueRunning() };
}

// presets: the full list as the editor wants it. Built-in presets must come back unchanged; new ones get an id.
async function save(body, backupDir) {
  const cur = parse(fs.readFileSync(LIBRARY, 'utf8'));
  const incoming = Array.isArray(body.presets) ? body.presets : null;
  if (!incoming || !incoming.length || incoming.length > 50) throw new Error('send the whole preset list');
  const byId = new Map(cur.presets.map((p) => [p.id, p]));
  const next = incoming.map((p) => {
    const stages = Array.isArray(p.stages) ? p.stages.map(Number) : [];
    if (stages.length !== 10 || stages.some((v) => !Number.isFinite(v) || v < -12 || v > 12)) throw new Error(`"${p.name}": each of the 10 bands must be between -12 and +12 dB`);
    const name = String(p.name || '').trim().slice(0, 40);
    if (!name) throw new Error('every preset needs a name');
    const old = p.id ? byId.get(p.id) : null;
    if (p.id && !old) throw new Error(`unknown preset id ${p.id}`);
    if (old?.builtIn && (old.name !== name || old.stages.some((v, i) => v !== stages[i]))) throw new Error(`"${old.name}" is one of iCUE's built-in presets; copy it to a new preset to change it`);
    // Bands that did not change keep iCUE's exact value; only edited bands are rounded (to 0.01 dB).
    const kept = stages.map((v, i) => (old && Math.abs(old.stages[i] - v) < 0.005 ? old.stages[i] : Math.round(v * 100) / 100));
    return { id: old ? old.id : `{${crypto.randomUUID()}}`, name, stages: kept, enabled: old ? old.enabled : true, linkSliders: old ? old.linkSliders : false };
  });
  // Built-ins can't be dropped, and a preset an iCUE slot is using can't be deleted.
  const keptIds = new Set(next.map((p) => p.id));
  for (const p of cur.presets) {
    if (keptIds.has(p.id)) continue;
    if (p.builtIn) throw new Error(`"${p.name}" is built in and cannot be deleted`);
    if (activeSlots().some((s) => s.id === p.id)) throw new Error(`"${p.name}" is in use in iCUE; pick another preset in iCUE before deleting it`);
  }
  const xml = serialize({ ...cur, presets: next });
  parse(xml); // the new file must read back in the same shape

  // 1. back up  2. close iCUE  3. write  4. start iCUE  5. confirm
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDir, `headset-icue-eq-${stamp}.cuelibrary`);
  fs.copyFileSync(LIBRARY, backup);
  const wasRunning = await icueRunning();
  if (wasRunning) {
    await new Promise((r) => execFile('taskkill', ['/IM', 'iCUE.exe', '/F'], { windowsHide: true }, () => r()));
    for (let i = 0; i < 30 && (await icueRunning()); i++) await sleep(300);
    if (await icueRunning()) throw new Error('iCUE did not close; nothing was changed');
  }
  try { writeAtomic(LIBRARY, xml); } catch (e) { if (wasRunning && fs.existsSync(ICUE_EXE)) spawn(ICUE_EXE, [], { detached: true, stdio: 'ignore' }).unref(); throw e; }
  if (wasRunning && fs.existsSync(ICUE_EXE)) spawn(ICUE_EXE, [], { detached: true, stdio: 'ignore' }).unref();
  // iCUE rewrites the file on start; give it time, then confirm our bands survived.
  await sleep(wasRunning ? 9000 : 300);
  const after = parse(fs.readFileSync(LIBRARY, 'utf8'));
  const wrong = next.filter((p) => { const a = after.presets.find((x) => x.id === p.id); return !a || a.stages.some((v, i) => Math.abs(v - p.stages[i]) > 0.01) || a.name !== p.name; });
  if (wrong.length) throw new Error(`iCUE did not keep ${wrong.map((p) => `"${p.name}"`).join(', ')}; your previous presets are in ${path.basename(backup)}`);
  return { ok: true, backup: path.basename(backup), restartedIcue: wasRunning, presets: after.presets };
}

module.exports = { read, save, BANDS, parse, serialize };
