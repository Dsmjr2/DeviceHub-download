// Two cards for the PC page (24 Oct 2026, docs/handoff/display-health.md), both read only:
// - Temperatures and fans: what Windows and the card makers' tools report (helpers/pc-sensors.js), plus the CPU and
//   the board's fans once the person added LibreHardwareMonitor (Add CPU temperature and fan speeds, ui/cpu-sensors.js),
//   read every 5 s while the card is on screen and never otherwise.
// - PC check: free space, drive health, graphics driver, RAM speed, devices with errors, recent crashes and a waiting
//   restart (helpers/pc-check.js), read when the page opens and on Check again. Compact (Shawn, 24 Oct 2026: the page
//   fits the window): what needs a look and the graphics driver as short rows in two columns, everything fine in one
//   line that opens to show it. Not Settings > Health (that one is about DeviceHub itself).
import { h, lowerFirst } from './dom.js';
import { card, button, loadingCard, row } from './controls.js';
import { meter } from './gauges.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';
import { cpuSensors, cpuSensorsSetUp } from './cpu-sensors.js';
import { shouldRead } from '../core/cpu-sensors.js';

const link = (text, url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, text);

// ---------- Temperatures and fans ----------
const DEMO_TEMPS = () => {
  const lhm = cpuSensorsSetUp();
  const j = (n) => n + Math.round(Math.random() * 3);
  return {
    readings: [
      ...(lhm ? [{ name: 'CPU package', kind: 'cpu', tempC: j(48), source: 'LibreHardwareMonitor' }, { name: 'CPU cores, hottest', kind: 'cpu', tempC: j(52), source: 'LibreHardwareMonitor' }] : []),
      { name: 'NVIDIA GeForce RTX 4070', kind: 'gpu', tempC: j(52), fanPct: 31, source: "NVIDIA's nvidia-smi" },
      ...(lhm ? [{ name: 'CPU Fan', kind: 'fan', fanRpm: j(1180), source: 'LibreHardwareMonitor' }, { name: 'System Fan #1', kind: 'fan', fanRpm: j(860), source: 'LibreHardwareMonitor' },
        { name: 'Board: System', kind: 'board', tempC: j(34), source: 'LibreHardwareMonitor' }, { name: 'Board: VRM MOS', kind: 'board', tempC: j(41), source: 'LibreHardwareMonitor' }] : []),
    ],
    notReadable: lhm ? [] : [{ what: 'CPU temperature', why: 'Needs the add-on below.', need: '' }, { what: 'CPU and case fan speeds', why: "They sit on the board's fan chip (SuperIO).", need: '' }],
    cpuSensors: { setUp: lhm, state: lhm ? 'ok' : null, idleFans: lhm ? 2 : 0 },
    cpu: { name: 'AMD Ryzen 7 5800X3D 8-Core Processor', tempC: lhm ? j(48) : null, coresMaxC: lhm ? j(52) : null, loadPct: j(14), clockMHz: 4300 + j(100), fanRpm: lhm ? j(1180) : null, fanName: lhm ? 'CPU Fan' : null, sensors: lhm },
  };
};
let temps = null, tempsErr = null, tempsTimer = null, onScreen = false, observer = null, redrawTemps = () => {};
const canRead = (page) => shouldRead({ hash: location.hash, page, hidden: document.hidden, onScreen });
// the CPU temperature over the last 2 minutes (one reading every 5 s; the graphics card keeps 2 minutes too), kept only while the page is open
let cpuHistory = [];
async function loadTemps() {
  try { temps = isDemo() ? DEMO_TEMPS() : await env.api('/api/temps'); tempsErr = null; } catch (e) { tempsErr = e.message; }
  const t = temps?.cpu?.tempC; if (t != null) { cpuHistory.push(t); if (cpuHistory.length > 24) cpuHistory.shift(); }
  redrawTemps();
}
// every 5 s, only while the card is on screen and the window is shown
function keepTemps(page) {
  if (tempsTimer) return;
  tempsTimer = setInterval(() => {
    if (!canRead(page)) { clearInterval(tempsTimer); tempsTimer = null; return; }
    loadTemps();
  }, 5000);
}
function watchVisible(el, page) {
  observer?.disconnect();
  if (typeof IntersectionObserver !== 'function') { onScreen = true; keepTemps(page); return; }
  observer = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (canRead(page)) { if (!tempsTimer) loadTemps(); keepTemps(page); }
  });
  observer.observe(el);
}
const value = (r) => [r.tempC != null ? `${r.tempC} °C` : null, r.fanPct != null ? (r.fanPct === 0 ? 'fans stopped' : `fans ${r.fanPct}%`) : null, r.fanRpm != null ? `${r.fanRpm} RPM` : null].filter(Boolean).join(', ') || 'no reading';
const srcName = (s) => s.replace(/^Windows \(the card's own driver\)$/, 'Windows').replace(/^Windows \(ACPI\)$/, 'Windows').replace(/^NVIDIA's /, '');

export function tempsCard(rerender, page = 'fans') {
  redrawTemps = rerender;
  if (!temps && !tempsErr) { queueMicrotask(() => { if (canRead(page) || typeof IntersectionObserver !== 'function') loadTemps(); }); const el = loadingCard('Temperatures and fans', 3); watchVisible(el, page); return el; }
  const cs = temps?.cpuSensors || {};
  // the CPU's own readings are on the Processor card (cpuCard below); the rest stays here
  // the CPU and the graphics card have their own cards (cpuCard, the graphics card in pages/fans.js); the rest stays here
  const rows = (temps?.readings || []).filter((r) => r.kind !== 'cpu' && !(r.kind === 'gpu' && /nvidia-smi/.test(r.source || '')))
    .map((r) => (r.kind === 'fan' && temps.cpu?.fanName === r.name ? { ...r, name: `${r.name} · CPU fan` } : r));
  const sources = [...new Set(rows.map((r) => srcName(r.source || '')).filter(Boolean))];
  const el = card([h('h2', {}, 'Temperatures and fans'), h('span', { class: 'sub' }, 'Read only')],
    tempsErr ? h('p', { class: 'faint' }, `Could not read them: ${tempsErr}`) : null,
    h('div', { class: 'tf-list' }, ...rows.map((r) => h('div', { class: 'tf-row' },
      h('span', { class: 'pcc-dot ok' }), h('span', { class: 'tf-name' }, r.name), h('b', { class: 'tf-val' }, value(r))))),
    cs.setUp && cs.state === 'starting' ? h('p', { class: 'faint tf-note' }, 'Starting the CPU reader (a few seconds).') : null,
    cs.setUp && cs.state === 'error' ? h('p', { class: 'faint tf-note' }, cs.why) : null,
    cs.idleFans ? h('p', { class: 'faint tf-note' }, `${cs.idleFans} more fan ${cs.idleFans === 1 ? 'header reads' : 'headers read'} 0 RPM (nothing plugged in, or stopped).`) : null,
    ...(temps?.notReadable || []).map((n) => h('div', { class: 'tf-row' },
      h('span', { class: 'pcc-dot info' }), h('span', { class: 'tf-name' }, n.what), h('small', { class: 'faint tf-val' }, 'not read'))),
    h('div', { class: 'tf-setup' }, cpuSensors({ redraw: rerender, onDone: () => { temps = null; tempsErr = null; rerender(); } })),
    null);
  watchVisible(el, page);
  return el;
}

// ---------- one look for the graphics card and the processor (24 Oct 2026, Shawn: "make this look more cohesive") ----------
// a title and the part's name; temperature, fan and load as three meters in a row; the temperature over the last minutes;
// then three rows of details; any note last. public/pages/fans.js draws the graphics card with it too.
export function historyGraph(values, everyS) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < 2) return h('div', { class: 'temp-graph-wrap waiting' }, h('small', { class: 'faint' }, 'The graph fills in as it reads.'));
  const W = 300, H = 48, mn = Math.min(...v), mx = Math.max(...v), lo = mn - 3, hi = mx + 3;
  const x = (i) => (i / (v.length - 1)) * W, y = (t) => H - ((t - lo) / Math.max(1, hi - lo)) * H;
  const pts = v.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ');
  const span = v.length * everyS, spanText = span >= 90 ? `last ${Math.round(span / 60)} min` : `last ${span} s`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'temp-graph'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `temperature, ${spanText}: ${mn} to ${mx} °C`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `<polygon points="0,${H} ${pts} ${W},${H}" fill="var(--signal)" opacity=".12"/><polyline points="${pts}" fill="none" stroke="var(--signal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return h('div', { class: 'temp-graph-wrap' }, svg, h('div', { class: 'temp-graph-scale' },
    mx === mn ? h('span', {}, `${mx} °C`) : [h('span', {}, `${mx} °C`), h('span', {}, `${mn} °C`)], h('small', { class: 'faint' }, spanText)));
}
const pctOf = (v, top) => (v == null ? null : Math.max(0, Math.min(100, Math.round((v / top) * 100))));
export function chipCard({ title, name, tempC, fan, loadPct, history, everyS, rows = [], note = null }) {
  return card([h('h2', {}, title), name ? h('span', { class: 'sub' }, name) : null],
    h('div', { class: 'pc-meters' },
      meter({ ic: 'thermo', pct: pctOf(tempC, 95), value: tempC == null ? '—' : `${Math.round(tempC)} °C`, label: 'temperature', big: true }),
      meter({ ic: 'fan', pct: fan?.pct ?? null, value: fan?.value ?? '—', label: fan?.label || 'fan', big: true }),
      meter({ ic: 'gauge', pct: loadPct, value: loadPct == null ? '—' : `${Math.round(loadPct)}%`, label: 'load', big: true })),
    historyGraph(history, everyS),
    ...rows.map(([label, value]) => row(label, null, h('b', {}, value ?? '—'))),
    note ? h('p', { class: 'faint tf-note' }, note) : null);
}

// ---------- Processor ----------
// The CPU as a card like the graphics card's (24 Oct 2026, Shawn): temperature, CPU fan and load as meters, then the
// clock and the hottest core. Load and clock come from Windows; temperature and fan need the add-on (Temperatures and
// fans card), so without it they read "—" with one line saying where to add them. Uses the same 5 s reading as that card.
const shortCpu = (n) => String(n || 'Processor').replace(/\((R|TM)\)/gi, '').replace(/\s+\d+-Core Processor$/i, '').replace(/ CPU @ .*$/i, '').replace(/\s+/g, ' ').trim();
export function cpuCard() {
  if (!temps && !tempsErr) return loadingCard('Processor', 3);
  const c = temps?.cpu;
  if (!c) return card([h('h2', {}, 'Processor')], h('p', { class: 'faint' }, tempsErr ? `Not read: ${tempsErr}` : 'Not read on this PC.'));
  // the CPU fan: named for the CPU, or the board's first fan input (CPU_FAN on most boards: helpers/pc-sensors.js)
  const fanRow = c.fanRpm == null ? (c.sensors ? (c.fanCount ? 'none named' : 'not read') : '—') : c.fanGuess ? `${c.fanName} (CPU_FAN)` : c.fanName;
  return chipCard({
    title: 'Processor', name: shortCpu(c.name), tempC: c.tempC, loadPct: c.loadPct, history: cpuHistory, everyS: 5,
    fan: { pct: pctOf(c.fanRpm, 2500), value: c.fanRpm == null ? '—' : `${c.fanRpm} RPM`, label: 'CPU fan' },
    rows: [['Clock', c.clockMHz == null ? null : `${(c.clockMHz / 1000).toFixed(2)} GHz`], ['Hottest core', c.coresMaxC == null ? null : `${c.coresMaxC} °C`], ['CPU fan header', fanRow]],
    note: c.sensors ? null : 'Temperature and fan: add the CPU reader in Temperatures and fans.',
  });
}

// ---------- PC check ----------
const DEMO_CHECK = () => ({ at: new Date().toISOString(), summary: { warn: 3, info: 0, ok: 6 }, results: [
  { id: 'disk-space', title: 'Free space', level: 'ok', line: 'C: has 412 GB free of 1.8 TB (22%).' },
  { id: 'drive-health', title: 'Drive health', level: 'ok', line: 'Demo SSD (SSD): healthy.' },
  { id: 'gpu-driver', title: 'Graphics driver', level: 'ok', line: 'NVIDIA GeForce RTX 4070: driver 581.57, from Oct 10, 2026.', link: { text: 'Open NVIDIA App', app: 'nvidia' } },
  { id: 'ram-speed', title: 'RAM speed', level: 'warn', line: '2133 of 3200 MT/s. Turn on XMP/EXPO in the BIOS.' },
  { id: 'device-errors', title: 'Devices', level: 'ok', line: 'No device reports a problem.' },
  { id: 'crashes', title: 'Crashes', level: 'ok', line: 'No crashes in the last 30 days.' },
  { id: 'restart', title: 'Restart', level: 'ok', line: 'No restart is waiting.' },
  { id: 'power-plan', title: 'Power plan', level: 'warn', line: 'Balanced: the CPU slows down to save power. High performance keeps it fast in games.', link: { text: 'Switch to High performance', fix: 'power-plan' } },
  { id: 'bg-record', title: 'Background recording', level: 'warn', line: 'Xbox Game Bar records the last minutes all the time, which costs frames. Turn off "Record what happened".', link: { text: 'Captures', settings: 'captures' } }] });
let check = null, checkErr = null, checkAt = 0, checking = false, redrawCheck = () => {}, lastDrawn = 0, okOpen = false, appNote = null;
async function runCheck(fresh) {
  if (checking) return; checking = true; redrawCheck();
  try { check = isDemo() ? DEMO_CHECK() : await env.api(`/api/pc-check${fresh ? '?fresh=1' : ''}`); checkErr = null; checkAt = Date.now(); }
  catch (e) { checkErr = e.message; }
  finally { checking = false; redrawCheck(); }
}
// the graphics maker's own app (POST /api/pc-check/open-app starts only the exe the check found)
async function openApp(l) {
  if (isDemo()) { appNote = `Demo mode: in the app this opens ${l.text.replace(/^Open /, '')}.`; redrawCheck(); return; }
  try { await env.api('/api/pc-check/open-app', { app: l.app }); appNote = null; } catch (e) { appNote = `Not opened: ${e.message}.`; }
  redrawCheck();
}
// a Windows Settings page (open-settings), DeviceHub's own one-click fix (the power plan), another page, or a web page
async function openSettings(l) {
  if (isDemo()) { appNote = `Demo mode: in the app this opens Windows ${l.text}.`; redrawCheck(); return; }
  try { await env.api('/api/pc-check/open-settings', { page: l.settings }); appNote = null; } catch (e) { appNote = `Not opened: ${e.message}.`; }
  redrawCheck();
}
let fixing = null;
async function runFix(l) {
  if (fixing) return;
  if (isDemo()) { appNote = 'Demo mode: in the app this switches the power plan.'; redrawCheck(); return; }
  fixing = l.fix; redrawCheck();
  try { const r = await env.api('/api/pc-check/fix', { id: l.fix }); appNote = `Power plan: ${r.now} (was ${r.was}; Power Options switches it back).`; }
  catch (e) { appNote = `Not changed: ${e.message}.`; }
  fixing = null;
  await runCheck(true);
}
const resultLink = (l) => (!l ? null
  : l.app ? h('button', { class: 'pcc-link', onclick: () => openApp(l) }, l.text)
    : l.settings ? h('button', { class: 'pcc-link', onclick: () => openSettings(l) }, l.text)
      : l.fix ? h('button', { class: 'pcc-link', disabled: !!fixing, onclick: () => runFix(l) }, fixing === l.fix ? 'Switching…' : l.text)
        : l.page ? h('a', { class: 'pcc-link', href: `#/${l.page}` }, l.text)
          : h('small', { class: 'pcc-src' }, link(l.text, l.url)));
const cell = (r) => h('div', { class: 'pcc-cell' },
  h('span', { class: `pcc-dot ${r.level}`, 'aria-label': r.level === 'warn' ? 'Look at this' : r.level === 'ok' ? 'Fine' : 'Note' }),
  h('div', {}, h('b', { class: 'pcc-title' }, r.title), h('span', { class: 'pcc-line' }, r.line), resultLink(r.link)));
// the summary of what is fine: each title once, in order ("Free space, drive health, crashes: all fine.")
export function okSummary(results) {
  const t = [...new Set(results.map((r) => r.title))];
  if (!t.length) return null;
  return `${t.map((x, i) => (i ? lowerFirst(x) : x)).join(', ')}: all fine.`;
}
export function splitResults(results) {
  // shown: what needs a look, notes, and the graphics driver (it carries the driver app); the rest goes in the summary
  const shown = results.filter((r) => r.level !== 'ok' || r.id === 'gpu-driver');
  const order = { warn: 0, info: 1, ok: 2 };
  shown.sort((a, b) => order[a.level] - order[b.level]);
  return { shown, fine: results.filter((r) => !shown.includes(r)) };
}
export function pcCheckCard(rerender) {
  redrawCheck = rerender;
  const opened = Date.now() - lastDrawn > 10000; lastDrawn = Date.now();
  if ((!check && !checkErr && !checking) || (opened && !checking && Date.now() - checkAt > 60000)) queueMicrotask(() => runCheck(false));
  if (!check && !checkErr) return loadingCard('PC check', 3);
  const s = check?.summary;
  const { shown, fine } = splitResults(check?.results || []);
  const head = [h('h2', {}, 'PC check'), s ? h('span', { class: 'sub' }, s.warn ? `${s.warn} ${s.warn === 1 ? 'thing' : 'things'} to look at` : 'Nothing needs you') : null,
    h('span', { class: 'spacer' }), button(checking ? 'Checking' : 'Check again', () => runCheck(true), { kind: 'ghost small', ic: 'refresh', disabled: checking })];
  const sum = okSummary(fine);
  return card(head,
    checkErr ? h('p', { class: 'faint' }, `The check could not run: ${checkErr}`) : null,
    h('div', { class: 'pcc-grid' }, ...shown.map(cell)),
    appNote ? h('p', { class: 'faint pcc-foot' }, appNote) : null,
    sum ? h('details', { class: 'pcc-ok', open: okOpen, ontoggle: (e) => { okOpen = e.target.open; } },
      h('summary', {}, h('span', { class: 'pcc-dot ok' }), h('span', {}, sum)),
      h('div', { class: 'pcc-grid' }, ...fine.map(cell))) : null,
    null);
}
