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
import { everyVisible } from '../core/visible-timer.js';
import { wifiPause } from './wifi-pause.js';
import { startupApps } from './startup-apps.js';

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
let temps = null, tempsErr = null, tempsTimer = null, fastTimer = null, onScreen = false, observer = null, redrawTemps = () => {};
const canRead = (page) => shouldRead({ hash: location.hash, page, hidden: document.hidden, onScreen });
// the CPU temperature over the last 2 minutes (one reading every 5 s; the graphics card keeps 2 minutes too), kept only while the page is open
let cpuHistory = [];
let loadingTemps = false, lastTempsSig = '', observedEl = null;
async function loadTemps() {
  if (loadingTemps) return;
  loadingTemps = true;
  try { temps = isDemo() ? DEMO_TEMPS() : await env.api('/api/temps'); tempsErr = null; } catch (e) { tempsErr = e.message; }
  loadingTemps = false;
  const t = temps?.cpu?.tempC; if (t != null) { cpuHistory.push(t); if (cpuHistory.length > 24) cpuHistory.shift(); }
  // While the sensor reader is starting up, poll every 1.2s so CPU temperature appears as soon as it is ready
  if (temps?.cpuSensors?.state === 'starting' && !fastTimer) {
    fastTimer = setTimeout(() => { fastTimer = null; if (location.hash === '#/fans' && !document.hidden) loadTemps(); }, 1200);
  }
  const { at, ...cmp } = temps || {};
  const sig = JSON.stringify([cmp, tempsErr]);
  if (sig !== lastTempsSig) { lastTempsSig = sig; redrawTemps(); }
}
// every 5 s, only while the card is on screen and the window is shown. 31 Oct 2026: a hidden window only pauses it
// (core/visible-timer.js runs it again when the window is shown); leaving the page or scrolling the card away stops it
function keepTemps(page) {
  if (tempsTimer) return;
  tempsTimer = everyVisible(() => {
    if (!canRead(page)) { tempsTimer?.(); tempsTimer = null; return; }
    return loadTemps();
  }, 5000);
}
function watchVisible(el, page) {
  if (observedEl === el && observer) return;
  observedEl = el;
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

function friendlySensor(r, cpuFanName) {
  const n = String(r.name || '').trim();
  if (r.kind === 'fan') {
    if (cpuFanName && n === cpuFanName) return { label: 'CPU cooler fan', sub: n };
    const sys = /^System Fan #?(\d+)$/i.exec(n) || /^Chassis Fan #?(\d+)$/i.exec(n);
    if (sys) return { label: `Case fan ${sys[1]}`, sub: `Motherboard SYS_FAN${sys[1]} header` };
    const generic = /^Fan #?(\d+)$/i.exec(n);
    if (generic) {
      const idx = Number(generic[1]);
      return idx === 1 ? { label: 'Motherboard fan 1', sub: 'Usually CPU_FAN header' } : { label: `Case fan ${idx - 1}`, sub: `Motherboard fan header #${idx}` };
    }
    if (/pump|aio/i.test(n)) return { label: 'Cooler pump', sub: n };
    return { label: n, sub: 'Motherboard fan header' };
  }
  if (r.kind === 'board') {
    const clean = n.replace(/^Board:\s*/i, '');
    if (/vrm/i.test(clean)) return { label: 'Motherboard VRM', sub: 'Power delivery temperature' };
    if (/^system/i.test(clean)) return { label: 'Motherboard ambient', sub: 'Case internal temperature' };
    if (/pch|chipset/i.test(clean)) return { label: 'Motherboard chipset', sub: clean };
    return { label: `Motherboard (${clean})`, sub: null };
  }
  return { label: n, sub: r.note || null };
}

export function tempsCard(rerender, page = 'fans') {
  redrawTemps = rerender;
  if (!temps && !tempsErr) {
    onScreen = true;
    queueMicrotask(() => { loadTemps(); keepTemps(page); });
    const el = loadingCard('Motherboard & case fans', 3);
    watchVisible(el, page);
    return el;
  }
  const cs = temps?.cpuSensors || {};
  // Exclude CPU temps, NVIDIA GPU (has its own card), and the CPU fan (already displayed on the Processor card)
  const cpuFan = temps?.cpu?.fanName;
  const rows = (temps?.readings || []).filter((r) => r.kind !== 'cpu' && !(r.kind === 'gpu' && /nvidia-smi/.test(r.source || '')) && !(r.kind === 'fan' && cpuFan && r.name === cpuFan));
  const fans = rows.filter((r) => r.kind === 'fan');
  const boardTemps = rows.filter((r) => r.kind !== 'fan');
  const el = card([h('h2', {}, 'Motherboard & case fans'), h('span', { class: 'sub' }, 'Board sensors')],
    tempsErr ? h('p', { class: 'faint' }, `Could not read sensors: ${tempsErr}`) : null,
    rows.length ? h('div', { class: 'tf-list' },
      ...[...fans, ...boardTemps].map((r) => {
        const info = friendlySensor(r, cpuFan);
        return h('div', { class: 'tf-row' },
          h('span', { class: 'pcc-dot ok' }),
          h('div', { class: 'tf-name-wrap' },
            h('span', { class: 'tf-name' }, info.label),
            info.sub ? h('small', { class: 'faint tf-sub' }, info.sub) : null),
          h('b', { class: 'tf-val' }, value(r)));
      })) : (!cs.setUp ? null : h('p', { class: 'faint tf-note' }, 'No extra case fans or board sensors reported.')),
    cs.setUp && cs.state === 'starting' ? h('p', { class: 'faint tf-note' }, 'Reading motherboard & CPU sensors…') : null,
    cs.setUp && cs.state === 'error' ? h('p', { class: 'faint tf-note' }, cs.why) : null,
    cs.idleFans ? h('p', { class: 'faint tf-note' }, `${cs.idleFans} unused motherboard fan ${cs.idleFans === 1 ? 'header reads' : 'headers read'} 0 RPM.`) : null,
    ...(temps?.notReadable || []).map((n) => h('div', { class: 'tf-row' },
      h('span', { class: 'pcc-dot info' }),
      h('div', { class: 'tf-name-wrap' }, h('span', { class: 'tf-name' }, n.what), n.why ? h('small', { class: 'faint tf-sub' }, n.why) : null),
      h('small', { class: 'faint tf-val' }, 'not active'))),
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
  if (!temps && !tempsErr) { queueMicrotask(loadTemps); return loadingCard('Processor', 3); }
  const c = temps?.cpu;
  if (!c) return card([h('h2', {}, 'Processor')], h('p', { class: 'faint' }, tempsErr ? `Not read: ${tempsErr}` : 'Not read on this PC.'));
  const fanRow = c.fanRpm == null ? (c.sensors ? (c.fanCount ? 'None detected' : 'Not reported') : 'Needs sensor add-on') : c.fanGuess ? `CPU_FAN (${c.fanName})` : c.fanName;
  return chipCard({
    title: 'Processor', name: shortCpu(c.name), tempC: c.tempC, loadPct: c.loadPct, history: cpuHistory, everyS: 5,
    fan: { pct: pctOf(c.fanRpm, 2500), value: c.fanRpm == null ? '—' : `${c.fanRpm} RPM`, label: 'CPU fan' },
    rows: [['Clock speed', c.clockMHz == null ? null : `${(c.clockMHz / 1000).toFixed(2)} GHz`], ['Peak core temp', c.coresMaxC == null ? null : `${c.coresMaxC} °C`], ['Cooler header', fanRow]],
    note: c.sensors ? null : 'Enable the sensor reader in Motherboard & case fans to read CPU temperature and fan RPM.',
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
const CHECK_TAG = {
  'power-plan': 'FPS & Gaming',
  'game-mode': 'FPS & Gaming',
  'bg-record': 'FPS & Gaming',
  'gpu-scheduling': 'FPS & Gaming',
  'windowed-games': 'FPS & Gaming',
  'rebar': 'FPS & Gaming',
  'ram-speed': 'FPS & Gaming',
  'ram-channels': 'FPS & Gaming',
  'refresh': 'FPS & Gaming',
  'gpu-driver': 'FPS & Gaming',
  'mouse-accel': 'FPS & Gaming',
  'wifi-band': 'Wi-Fi & Ping',
  'wifi-signal': 'Wi-Fi & Ping',
  'wifi-speed': 'Wi-Fi & Ping',
  'wifi-power': 'Wi-Fi & Ping',
  'network-jitter': 'Wi-Fi & Ping',
  'ethernet': 'Wi-Fi & Ping',
};
async function turnOffMouseAccel() {
  if (fixing) return;
  if (isDemo()) { appNote = 'Demo mode: turns off Windows Enhance pointer precision.'; redrawCheck(); return; }
  fixing = 'mouse-accel'; redrawCheck();
  try {
    await env.api('/api/pointer', { key: 'precision', value: false });
    appNote = 'Enhance pointer precision turned off for 1:1 gaming aim.';
  } catch (e) { appNote = `Not changed: ${e.message}.`; }
  fixing = null;
  await runCheck(true);
}
const resultLink = (l, id) => {
  const act = !l ? null
    : l.app ? h('button', { class: 'pcc-link', onclick: () => openApp(l) }, l.text)
      : l.settings ? h('button', { class: 'pcc-link', onclick: () => openSettings(l) }, l.text)
        : l.fix ? h('button', { class: 'pcc-link', disabled: !!fixing, onclick: () => runFix(l) }, fixing === l.fix ? 'Switching…' : l.text)
          : l.page ? h('a', { class: 'pcc-link', href: `#/${l.page}` }, l.text)
            : h('small', { class: 'pcc-src' }, link(l.text, l.url));
  if (id === 'mouse-accel') {
    const quick = h('button', { class: 'pcc-link', disabled: !!fixing, onclick: turnOffMouseAccel }, fixing === 'mouse-accel' ? 'Turning off…' : 'Turn off now');
    return h('div', { class: 'pcc-actions' }, quick, act);
  }
  return act;
};
const cell = (r) => {
  const tag = CHECK_TAG[r.id];
  return h('div', { class: 'pcc-cell' },
    h('span', { class: `pcc-dot ${r.level}`, 'aria-label': r.level === 'warn' ? 'Look at this' : r.level === 'ok' ? 'Fine' : 'Note' }),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'pcc-head-row' }, h('b', { class: 'pcc-title' }, r.title), tag ? h('span', { class: 'pcc-tag' }, tag) : null),
      h('span', { class: 'pcc-line' }, r.line),
      resultLink(r.link, r.id)));
};
// the summary of what is fine: each title once, in order ("Free space, drive health, crashes: all fine.")
export function okSummary(results) {
  const t = [...new Set(results.map((r) => r.title))];
  if (!t.length) return null;
  return `${t.map((x, i) => (i ? lowerFirst(x) : x)).join(', ')}: all fine.`;
}
export function splitResults(results) {
  // shown: what needs a look, notes, free space, and the graphics driver (it carries the driver app); the rest goes in the summary
  const shown = results.filter((r) => r.level !== 'ok' || r.id === 'gpu-driver' || r.id === 'disk-space');
  // keep warnings first so critical items stay on top; for all others maintain stable original order so toggles never shift position
  shown.sort((a, b) => {
    const isWarnA = a.level === 'warn' ? 0 : 1;
    const isWarnB = b.level === 'warn' ? 0 : 1;
    if (isWarnA !== isWarnB) return isWarnA - isWarnB;
    return results.indexOf(a) - results.indexOf(b);
  });
  return { shown, fine: results.filter((r) => !shown.includes(r)) };
}
export function pcCheckCard(rerender) {
  redrawCheck = rerender;
  const opened = Date.now() - lastDrawn > 10000; lastDrawn = Date.now();
  if ((!check && !checkErr && !checking) || (opened && !checking && Date.now() - checkAt > 60000)) queueMicrotask(() => runCheck(false));
  if (!check && !checkErr) return loadingCard('PC check', 3);
  const s = check?.summary;
  const { shown, fine } = splitResults(check?.results || []);
  const head = [h('h2', {}, 'PC check'),
    h('span', { class: 'spacer' }), button(checking ? 'Checking' : 'Check again', () => runCheck(true), { kind: 'ghost small', ic: 'refresh', disabled: checking })];
  const sum = okSummary(fine);
  const lat = check?.latency;
  const routerOk = lat && lat.gwMs <= 25 && lat.gwJitter < 20;
  const netQuality = !lat || lat.gwMs == null ? null
    : !routerOk ? 'Local Wi-Fi delay or lag spikes'
      : (lat.inMs != null && (lat.inJitter >= 30 || lat.inMs > 90)) ? 'Outside internet lag (ISP / server)'
        : 'Smooth gaming connection';

  const latStrip = lat && lat.gwMs != null ? h('div', { class: 'pcc-net-strip' },
    h('span', { class: `pcc-net-tag ${routerOk ? 'ok' : 'warn'}` }, netQuality),
    h('span', { class: `pcc-net-stat${lat.gwJitter >= 20 || lat.gwMs > 35 ? ' warn' : ''}` },
      h('span', { class: 'muted' }, 'Wi-Fi to router '),
      h('b', {}, `${Math.round(lat.gwMs)}ms`),
      lat.gwJitter > 2 ? h('small', { class: 'faint' }, ` (±${lat.gwJitter}ms spike)`) : null),
    lat.inMs != null ? h('span', { class: `pcc-net-stat${lat.inJitter >= 30 || lat.inMs > 90 ? ' warn' : ''}` },
      h('span', { class: 'muted' }, 'Internet ping '),
      h('b', {}, `${Math.round(lat.inMs)}ms`),
      lat.inJitter > 4 ? h('small', { class: 'faint' }, ` (±${lat.inJitter}ms spike)`) : null) : null,
    check?.wifi?.band && !/invalid/i.test(check.wifi.band) ? h('span', { class: 'pcc-net-wifi faint' }, `Wi-Fi · ${check.wifi.band}`) : null) : null;
  return card(head,
    checkErr ? h('p', { class: 'faint' }, `The check could not run: ${checkErr}`) : null,
    latStrip,
    wifiPause({ redraw: rerender }),
    h('div', { class: 'pcc-grid' }, ...shown.map(cell)),
    appNote ? h('p', { class: 'faint pcc-foot' }, appNote) : null,
    sum ? h('details', { class: 'pcc-ok', open: okOpen, ontoggle: (e) => { okOpen = e.target.open; } },
      h('summary', {}, h('span', { class: 'pcc-dot ok' }), h('span', {}, sum)),
      h('div', { class: 'pcc-grid' }, ...fine.map(cell))) : null,
    // what starts with Windows, one line that opens (27 Oct 2026, ui/startup-apps.js)
    startupApps({ redraw: rerender }),
    null);
}
