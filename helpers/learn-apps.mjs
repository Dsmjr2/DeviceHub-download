// Learn a device without typing (22 Oct 2026; docs/handoff/learn-no-typing.md). Shawn: his friend "has to type in what
// he wants the app to learn? Thats far too much work. shouldnt it recognize the software that is used for his devices
// and ask about it?"
//
// For the device picked in Learn a device, this names:
//   - its maker's app: installed or not (its usual folders, as helpers/vendor-files.mjs knows them, and Windows'
//     list of installed programs), running or not (tasklist, matched as helpers/diagnose.mjs does). When it is not
//     installed, only its official name and page.
//   - the settings to learn, as a tick-list: from what the maker's app left on the PC (vendor-files: its own setting
//     names and, where present, the allowed range for this model), else from the brand sheet for that vendor
//     (docs/brands/<brand>.md section 3), else a short usual list for the kind of device. Each item has its kind
//     (number, toggle, choice, reading) and two values far apart.
// Everything here is READ-ONLY: it never starts, closes or drives a maker's app (helpers/learn-wizard.mjs act('drive')
// does that, through helpers/app-ui.ps1, only for the ticked setting), and never writes a maker's file.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPS as FILE_APPS, bases as baseDirs, scan as vendorScan } from './vendor-files.mjs';
import { MAKER_APPS, parseTasklist } from './diagnose.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const up4 = (s) => String(s ?? '').trim().toUpperCase().replace(/^0X/, '').padStart(4, '0');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- what app-ui never touches
// app-ui.ps1's own refusal list (read from the script, so the two never drift apart), plus pairing and DFU: the wizard
// never drives or learns a control whose name or id matches it.
function appUiForbidden() {
  try {
    const m = /^\$Forbidden\s*=\s*'([^']+)'/m.exec(fs.readFileSync(path.join(HERE, 'app-ui.ps1'), 'utf8'));
    if (m) return m[1];
  } catch {}
  return 'firmware|update|reset|factory|flash|bootloader|delete|format';
}
export const FORBIDDEN = new RegExp(`${appUiForbidden()}|pair|dfu`, 'i');

// ---------------------------------------------------------------- the makers' apps
// key: diagnose.mjs MAKER_APPS key (process names); files: vendor-files.mjs APPS ids (folders); window: what app-ui
// is given as -Window (a title part or process name); page: the maker's own page for the app (checked 22 Oct 2026).
export const MAKERS = [
  { key: 'ghub', vids: ['046D'], name: 'Logitech G HUB', page: 'https://www.logitechg.com/en-us/software/ghub', files: ['lghub'], window: 'lghub', uninstall: /^logitech g hub/i },
  { key: 'synapse', vids: ['1532'], name: 'Razer Synapse', page: 'https://www.razer.com/synapse-4', files: ['synapse4', 'synapse3'], window: 'Razer Synapse', uninstall: /^razer synapse/i },
  { key: 'icue', vids: ['1B1C'], name: 'Corsair iCUE', page: 'https://www.corsair.com/us/en/s/icue', files: ['icue5', 'icue4'], window: 'iCUE', uninstall: /icue/i },
  { key: 'gg', vids: ['1038'], name: 'SteelSeries GG', page: 'https://steelseries.com/gg', files: ['steelseries-gg', 'steelseries-engine3'], window: 'SteelSeries GG', uninstall: /^steelseries (gg|engine)/i },
  { key: 'ngenuity', vids: ['0951', '03F0'], name: 'HyperX NGENUITY', page: 'https://hyperx.com/pages/ngenuity', files: ['ngenuity'], window: 'NGENUITY', uninstall: /ngenuity/i },
  { key: 'armoury', vids: ['0B05'], name: 'ASUS Armoury Crate', page: 'https://rog.asus.com/content/armoury-crate/', files: ['armoury-crate'], window: 'Armoury Crate', uninstall: /armoury crate/i },
  { key: 'swarm', vids: ['10F5', '1E7D'], name: 'Turtle Beach Swarm II', page: 'https://support.turtlebeach.com/s/downloads', files: ['swarm2'], window: 'Swarm II', uninstall: /swarm\s*ii/i },
  { key: 'glorious', vids: ['258A', '22D4', '320F'], name: 'Glorious CORE', page: 'https://www.gloriousgaming.com/pages/software', files: ['glorious-core'], window: 'Glorious CORE', uninstall: /glorious core/i },
  { key: 'pulsar', vids: ['3710'], name: 'Pulsar Fusion', page: 'https://www.pulsar.gg/pages/download', files: ['pulsar'], window: 'Pulsar', uninstall: /pulsar|fusion/i },
  { key: 'epomaker', vids: ['342D'], name: 'Epomaker Driver', page: 'https://epomaker.com/blogs/software', files: ['epomaker'], window: 'Epomaker', uninstall: /epomaker/i },
  { key: 'wootility', vids: ['31E3', '03EB'], name: 'Wootility', page: 'https://wooting.io/wootility', files: ['wootility'], window: 'Wootility', uninstall: /wootility/i },
  { key: 'keychron', vids: ['3434'], name: 'Keychron Launcher', page: 'https://launcher.keychron.com/', files: ['keychron'], web: true },
  { key: 'masterplus', vids: ['2516'], name: 'Cooler Master MasterPlus+', page: 'https://www.coolermaster.com/en-global/masterplus.html', files: [], window: 'MasterPlus', uninstall: /masterplus/i, detect: [/^masterplus/i] },
];
export const makerOf = (vid) => MAKERS.find((m) => m.vids.includes(up4(vid))) || null;

// an app's usual install folders that exist on this PC (vendor-files' roots: { base, path } or { base, dir, match })
function installFolders(fileApp, env) {
  const b = baseDirs(env), found = [];
  for (const r of fileApp?.install || []) {
    const base = b[r.base];
    if (!base) continue;
    if (r.match) {
      try { for (const d of fs.readdirSync(path.join(base, r.dir || ''), { withFileTypes: true })) if (d.isDirectory() && r.match.test(d.name)) found.push(path.join(base, r.dir || '', d.name)); } catch {}
    } else {
      try { if (fs.statSync(path.join(base, r.path)).isDirectory()) found.push(path.join(base, r.path)); } catch {}
    }
  }
  return found;
}
const hasExe = (dir, depth = 2) => {
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isFile() && /\.exe$/i.test(d.name)) return true;
      if (d.isDirectory() && depth > 0 && hasExe(path.join(dir, d.name), depth - 1)) return true;
    }
  } catch {}
  return false;
};

// Windows' installed-programs list (display names only), read-only
function uninstallNames() {
  const ps = "$k=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); Get-ItemProperty $k -ErrorAction SilentlyContinue | ForEach-Object { $_.DisplayName } | Where-Object { $_ }; Get-AppxPackage -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }";
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => resolve(String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))));
}
const tasklist = () => new Promise((resolve) => execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => resolve(String(out || ''))));

// { known, name, page, web?, installed, running, window } for this vendor id. known false: DeviceHub does not know the
// maker's app (then name and page are null). deps (tests): env, tasklist(), uninstallNames()
export async function findMaker(vid, { env = process.env, list = tasklist, names = uninstallNames } = {}) {
  const m = makerOf(vid);
  if (!m) return { known: false, name: null, page: null, installed: false, running: false, window: null };
  if (m.web) return { known: true, key: m.key, name: m.name, page: m.page, web: true, installed: false, running: false, window: null };
  let installed = false;
  for (const id of m.files) {
    const fa = FILE_APPS.find((a) => a.id === id);
    if (installFolders(fa, env).some((d) => hasExe(d))) { installed = true; break; }
  }
  if (!installed && m.uninstall) { try { installed = (await names()).some((n) => m.uninstall.test(n)); } catch {} }
  const detect = m.detect || MAKER_APPS[m.key]?.detect || [];
  let running = false;
  try { running = parseTasklist(await list()).some((i) => detect.some((re) => re.test(i))); } catch {}
  return { known: true, key: m.key, name: m.name, page: m.page, installed: installed || running, running, window: m.window };
}

// ---------------------------------------------------------------- the kind of device
// 'mouse' | 'keyboard' | 'headset' | 'device', from its name, then its collections (generic desktop mouse / keyboard)
export function deviceKind(dev) {
  const n = String(dev?.name || '');
  if (/headset|headphone|earbud|arctis|\bnova\b|cloud|virtuoso|\bhs\d|kraken|barracuda|blackshark|stealth|\bvoid\b|astro/i.test(n)) return 'headset';
  if (/keyboard|\bkb\b|keypad|\bkeys\b/i.test(n)) return 'keyboard';
  if (/mouse|\bmice\b/i.test(n)) return 'mouse';
  const cols = dev?.collections || [];
  const has = (u) => cols.some((c) => up4(c.page) === '0001' && up4(c.usage) === u);
  if (has('0002')) return 'mouse';
  if (has('0006')) return 'keyboard';
  return 'device';
}

// ---------------------------------------------------------------- the usual settings and values
// The values are what a maker's app usually shows, two far apart; the person can change them before Learn these.
export const PRESETS = [
  { label: 'DPI', re: /^(mouse )?dpi\b(?! (stage|list|slot|color|colou))|\bdpi( x\/y)?$|sensitivity/i, kind: 'number', values: [800, 3200], unit: 'DPI' },
  { label: 'Polling rate', re: /polling|^report rate/i, kind: 'choice', values: ['125 Hz', '1000 Hz'] },
  { label: 'Lift-off', re: /lift/i, kind: 'choice', values: ['Low', 'High'] },
  { label: 'Debounce', re: /debounce/i, kind: 'number', values: [2, 8], unit: 'ms' },
  { label: 'Brightness', re: /brightness/i, kind: 'number', values: [20, 80], unit: '%' },
  { label: 'Sidetone', re: /sidetone(?! on)/i, kind: 'number', values: [10, 80] },
  { label: 'Auto-off', re: /auto.?off|inactive time|sleep timer|idle/i, kind: 'number', values: [10, 30], unit: 'min' },
  { label: 'Angle snapping', re: /angle snap/i, kind: 'toggle', values: [true, false] },
];
const presetNamed = (label) => PRESETS.find((p) => p.label === label);
export const GENERIC = {
  mouse: ['DPI', 'Polling rate', 'Lift-off', 'Debounce'],
  keyboard: ['Brightness', 'Report rate'],
  headset: ['Sidetone', 'Auto-off'],
};
const KIND_WORDS = {
  mouse: /dpi|polling|report rate|lift|debounce|angle|snap|scroll|reel|left-hand|button response|sensor|motion|sensitivity/i,
  keyboard: /brightness|report rate|polling|debounce|actuation|rapid/i,
  headset: /sidetone|auto.?off|inactive|chatmix|mic|volume|limiter|bluetooth|noise/i,
};
const ANY_KIND = /battery|charging|sleep|idle|brightness/i;
// names that are never offered (not a setting, not learnable yet, or a control DeviceHub never touches)
const SKIP = /firmware|serial|vendor|product id|connect|light|\bled\b|colou?r|rgb|effect|\beq\b|equali|macro|remap|button(?! response)|\bkeys?\b|per-key|profile|mode\b|pair|frame|layout|voltage|reset|update|flash|bootloader|delete|format|dfu|onboard|memory|divert|matrix|status|preset|sleep now|g-key|m-key|\banc\b|voice|stage|index|mask|plugged|info|version|threshold|calibrat|win-lock|mute|custom|binary|unique|guid|address|\bid\b/i;

const words = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
// "AngleSnapping" -> "Angle snapping"; words in capitals (DPI, RGB) stay as they are
const cap = (s) => String(s || '').split(' ').filter(Boolean).map((w, i) => (w.length > 1 && w === w.toUpperCase() ? w : i ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');
// a number between lo and hi, rounded to the step (or a round number)
function niceAt(lo, hi, f, step) {
  const raw = lo + (hi - lo) * f;
  const s = step > 0 ? step : hi - lo >= 1000 ? 100 : hi - lo >= 100 ? 10 : 1;
  const v = lo + Math.round((raw - lo) / s) * s;
  return Math.min(hi, Math.max(lo, Number(v.toFixed(6))));
}
// two values far apart inside a range: the preset's own when both fit, else a quarter and three quarters of the way
export function valuesIn(range, preset) {
  const { min, max, step } = range;
  if (preset?.kind === 'number' && preset.values.every((v) => v >= min && v <= max)) return preset.values.slice();
  const a = niceAt(min, max, 0.25, step), b = niceAt(min, max, 0.75, step);
  return a !== b ? [a, b] : [min, max];
}

// one tick-list item: { id, label, kind, role?, values, unit?, range?, source, ticked }
function item(label, kind, values, source, extra = {}) {
  return { id: norm(label) || 'setting', label, kind, values, source, ticked: false, ...extra };
}
function fromPreset(p, source, extra = {}) { return item(p.label, p.kind, p.values.slice(), source, { ...(p.unit ? { unit: p.unit } : {}), ...extra }); }
const keyOf = (label) => { const p = PRESETS.find((x) => x.re.test(label)); return p ? p.label : norm(label); };
const forKind = (label, kind) => kind === 'device' || ANY_KIND.test(label) || KIND_WORDS[kind]?.test(label);

// ---------------------------------------------------------------- a. what the maker's app left on the PC
// report: vendor-files scan({ vid }) -> items for this model (its setting names and allowed ranges)
export function fileItems(report, dev, kind) {
  const out = [];
  const model = norm(dev?.name);
  const fits = (d) => !d || (model && (model.includes(norm(d)) || norm(d).includes(model)));
  for (const app of report?.apps || []) {
    for (const s of app.settings || []) {
      if (!s?.name || !fits(s.device) || !(s.max > s.min)) continue;
      const label = cap(words(s.name));
      if (SKIP.test(label) || FORBIDDEN.test(label) || !forKind(label, kind)) continue;
      const p = PRESETS.find((x) => x.re.test(label));
      if (p && p.kind !== 'number') continue;   // a range for a choice setting is raw codes, not what the app shows
      const range = { min: s.min, max: s.max, step: s.step > 0 ? s.step : 1 };
      out.push(item(label, 'number', valuesIn(range, p), `${app.name}'s own files`, { range, ...(p?.unit ? { unit: p.unit } : {}) }));
    }
    for (const [name, saved] of Object.entries(app.savedSettings || {})) {
      if (!fits(name) || !saved || typeof saved !== 'object') continue;
      for (const [k, v] of Object.entries(saved)) {
        const label = cap(words(k));
        if (SKIP.test(label) || FORBIDDEN.test(label) || !forKind(label, kind)) continue;
        const p = PRESETS.find((x) => x.re.test(label));
        if (/^(true|false)$/i.test(String(v))) out.push(item(label, 'toggle', [true, false], `${app.name}'s own files`));
        else if (p) out.push(fromPreset(p, `${app.name}'s own files`, { label }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- b. the brand sheet
export const BRAND_SHEETS = { '0B05': 'asus-rog', '2516': 'cooler-master', '1B1C': 'corsair', '258A': 'glorious', '22D4': 'glorious', '320F': 'glorious',
  '0951': 'hyperx', '03F0': 'hyperx', '3434': 'keychron', '362D': 'keychron', '046D': 'logitech', '1532': 'razer', '1038': 'steelseries',
  '10F5': 'turtle-beach', '1E7D': 'turtle-beach', '31E3': 'wooting', '03EB': 'wooting' };
// the settings in a brand sheet's "Settings map" (section 3) tables that fit this kind of device. The sheet's numbers are
// the device's own (raw) values, so values come from the usual ones; the sheet says which settings exist and their kind.
export function brandItems(text, kind) {
  const sec = /^## 3\.[^\n]*\n([\s\S]*?)(?=^## 4\.|(?![\s\S]))/m.exec(String(text || ''));
  if (!sec) return [];
  const out = [];
  for (const line of sec[1].split(/\r?\n/)) {
    if (!/^\|/.test(line) || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    let name = cells[0].replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!name || /^setting$/i.test(name)) continue;
    const rest = cells.slice(1).join(' | ');
    const pair = /\(([^()/]+?)\s*\/\s*([^()/]+?)\)/.exec(name);
    const label = cap(name.replace(/\([^)]*\)/g, '').replace(/%/g, '').trim());
    if (!label || /[,;]/.test(label) || SKIP.test(label) || FORBIDDEN.test(label) || !forKind(label, kind)) continue;
    if (/^battery( level)?$/i.test(label)) { out.push(item('Battery', 'reading', [], 'the brand sheet', { role: 'battery' })); continue; }
    if (/^charging$/i.test(label)) { out.push(item('Charging', 'reading', [true, false], 'the brand sheet', { role: 'charging' })); continue; }
    if (/^battery/i.test(label)) continue;
    const p = PRESETS.find((x) => x.re.test(label));
    // a row the sheet marks read-only (its R/W cell is just R) is not a setting
    if (cells.slice(1).some((c) => /^R( \(|\s*\+|$)/.test(c))) continue;
    if (p) { out.push(fromPreset(p, 'the brand sheet')); continue; }
    if (pair) { out.push(item(label, 'choice', [cap(pair[1].trim()), cap(pair[2].trim())], 'the brand sheet')); continue; }
    if (/<?\b0\s*\/\s*1\b>?|on\s*\/\s*off/i.test(rest)) { out.push(item(label, 'toggle', [true, false], 'the brand sheet')); continue; }
  }
  return out;
}
export function brandSheet(vid, root = ROOT) {
  const f = BRAND_SHEETS[up4(vid)];
  if (!f) return null;
  try { return fs.readFileSync(path.join(root, 'docs', 'brands', `${f}.md`), 'utf8'); } catch { return null; }
}

// ---------------------------------------------------------------- c. the usual list for the kind
export function genericItems(kind) {
  const names = kind === 'device' ? [...new Set(Object.values(GENERIC).flat())] : GENERIC[kind] || [];
  return names.map((n) => (n === 'Report rate' ? item('Report rate', 'choice', ['125 Hz', '1000 Hz'], `usual for a ${kind}`) : fromPreset(presetNamed(n), kind === 'device' ? 'usual for these devices' : `usual for a ${kind}`)));
}

// ---------------------------------------------------------------- the tick-list
// The app's own files first, then the brand sheet, then the usual list (only when neither found anything), one item
// per setting. The first four settings are ticked; readings never are (a battery needs the percent the app shows).
export const MAX_ITEMS = 10;
export function planItems({ files = [], brand = [], kind = 'device' }) {
  const all = [...files, ...brand];
  const src = all.length ? all : genericItems(kind);
  const out = [], seen = new Set();
  for (const it of src) {
    const k = it.kind === 'reading' ? `reading:${it.role}` : keyOf(it.label);
    if (seen.has(k) || out.length >= MAX_ITEMS) continue;
    seen.add(k);
    out.push({ ...it, id: k.replace(/[^a-z0-9]/gi, '').toLowerCase() || `s${out.length}` });
  }
  let n = 0;
  for (const it of out) if (it.kind !== 'reading' && n < 4) { it.ticked = true; n++; }
  return out;
}

// { maker, kind, items, from: 'files' | 'brand' | 'usual' } for one listed device
export async function plan(dev, { root = ROOT, maker = findMaker, scan = (vid) => vendorScan({ vid }) } = {}) {
  const kind = deviceKind(dev);
  const m = await maker(dev.vid);
  let files = [];
  if (m.known && !m.web) { try { files = fileItems(await scan(dev.vid), dev, kind); } catch {} }
  const brand = brandItems(brandSheet(dev.vid, root), kind);
  const items = planItems({ files, brand, kind });
  return { maker: m, kind, items, from: files.length ? 'files' : brand.length ? 'brand' : 'usual' };
}

// ---------------------------------------------------------------- opening the maker's app (23 Oct 2026)
// Learn it for me opens the maker's app when it is installed and closed, as the person would from the Start menu:
// Windows' own list of Start menu apps (Get-StartApps: shortcuts and Store apps alike), the entry whose name matches the
// app, never an uninstaller, updater or help entry, started through explorer (shell:AppsFolder). Nothing is installed.
const NOT_THE_APP = /uninstall|update|repair|help|readme|manual|website|support|remove/i;
export function pickStartApp(apps, m) {
  const want = m?.uninstall;
  if (!want) return null;
  const hits = (apps || []).filter((a) => a?.Name && a?.AppID && want.test(a.Name) && !NOT_THE_APP.test(a.Name));
  return hits.sort((a, b) => a.Name.length - b.Name.length)[0] || null;
}
const startApps = () => new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-StartApps | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => {
  try { const j = JSON.parse(String(out || '').trim() || '[]'); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
}));
// { opened: true, name } or { opened: false, why }
export async function openMaker(vid, { apps = startApps, launch = (id) => execFile('explorer.exe', [`shell:AppsFolder\\${id}`], { windowsHide: true }, () => {}) } = {}) {
  const m = makerOf(vid);
  if (!m || m.web) return { opened: false, why: 'DeviceHub does not know this maker\'s app.' };
  const hit = pickStartApp(await apps(), m);
  if (!hit) return { opened: false, why: `${m.name} is not in the Start menu.` };
  launch(hit.AppID);
  return { opened: true, name: hit.Name };
}

// ---------------------------------------------------------------- driving app-ui (helpers/app-ui.ps1)
// runs app-ui with these arguments: { code, out } (code: 0 done, 1 failed, 2 not found, 3 no controls, 4 refused)
export function runAppUi(args, ms = 45000) {
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'app-ui.ps1'), ...args], { windowsHide: true, timeout: ms, maxBuffer: 4 * 1024 * 1024 },
    (e, out) => resolve({ code: e ? (Number.isInteger(e.code) ? e.code : 1) : 0, out: String(out || '').trim() })));
}
// app-ui get -Json -> the control's info, or null
export function parseInfo(out) {
  const at = String(out || '').indexOf('{');
  if (at < 0) return null;
  try { return JSON.parse(String(out).slice(at)); } catch { return null; }
}
// the value a control holds, in the setting's kind (undefined: the control cannot be that kind of setting)
export function valueOf(kind, info) {
  if (!info) return undefined;
  if (kind === 'number') { const v = Number(info.value); return info.min != null && Number.isFinite(v) ? v : undefined; }
  if (kind === 'toggle') return info.toggle === 'On' ? true : info.toggle === 'Off' ? false : undefined;
  if (kind === 'choice') { const v = info.selected || (typeof info.value === 'string' ? info.value : ''); return v ? v : undefined; }
  return undefined;
}
// a value as app-ui's -Value takes it
export const uiText = (kind, v) => (kind === 'toggle' ? (v ? 'on' : 'off') : String(v));
