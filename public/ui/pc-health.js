// Two cards for the PC page (24 Oct 2026, docs/handoff/display-health.md), both read only:
// - Temperatures and fans: what Windows and the card makers' tools report with no new driver (helpers/pc-sensors.js),
//   read every 5 s while the card is on screen and never otherwise; what cannot be read says what would be needed.
// - PC check: free space, drive health, graphics driver, RAM speed, devices with errors, recent crashes and a waiting
//   restart (helpers/pc-check.js), read when the page opens and on Check again. Not Settings > Health (that one is
//   about DeviceHub itself).
import { h } from './dom.js';
import { card, button, loadingCard } from './controls.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';

const link = (text, url) => h('a', { href: url, target: '_blank', rel: 'noopener' }, text);

// ---------- Temperatures and fans ----------
const DEMO_TEMPS = () => ({ readings: [{ name: 'NVIDIA GeForce RTX 4070', kind: 'gpu', tempC: 52 + Math.round(Math.random() * 4), fanPct: 31, source: "NVIDIA's nvidia-smi" }],
  notReadable: [{ what: 'CPU temperature', why: 'Windows does not share it without a driver that reads the CPU.', need: 'LibreHardwareMonitor (free, open source) with the PawnIO driver would be needed.' }] });
let temps = null, tempsErr = null, tempsTimer = null, onScreen = false, observer = null, redrawTemps = () => {};
async function loadTemps() {
  try { temps = isDemo() ? DEMO_TEMPS() : await env.api('/api/temps'); tempsErr = null; } catch (e) { tempsErr = e.message; }
  redrawTemps();
}
// every 5 s, only while the card is on screen and the window is shown
function keepTemps(page) {
  if (tempsTimer) return;
  tempsTimer = setInterval(() => {
    if (location.hash !== `#/${page}` || document.hidden || !onScreen) { clearInterval(tempsTimer); tempsTimer = null; return; }
    loadTemps();
  }, 5000);
}
function watchVisible(el, page) {
  observer?.disconnect();
  if (typeof IntersectionObserver !== 'function') { onScreen = true; keepTemps(page); return; }
  observer = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) { if (!tempsTimer) loadTemps(); keepTemps(page); }
  });
  observer.observe(el);
}
const value = (r) => [r.tempC != null ? `${r.tempC} °C` : null, r.fanPct != null ? (r.fanPct === 0 ? 'fans stopped' : `fans ${r.fanPct}%`) : null, r.fanRpm != null ? `fans ${r.fanRpm} RPM` : null].filter(Boolean).join(', ') || 'no reading';

export function tempsCard(rerender, page = 'fans') {
  redrawTemps = rerender;
  if (!temps && !tempsErr) { queueMicrotask(loadTemps); const el = loadingCard('Temperatures and fans', 3); watchVisible(el, page); return el; }
  const el = card([h('h2', {}, 'Temperatures and fans'), h('span', { class: 'sub' }, 'Read only')],
    tempsErr ? h('p', { class: 'faint' }, `Could not read them: ${tempsErr}`) : null,
    ...(temps?.readings || []).map((r) => h('div', { class: 'pcc-row' },
      h('span', { class: `pcc-dot ${r.kind === 'zone' && !r.real ? 'info' : 'ok'}` }),
      h('div', {}, h('b', {}, r.name), ` ${value(r)}`, h('small', { class: 'faint pcc-src' }, `From ${r.source}.${r.note ? ` ${r.note}` : ''}`)))),
    temps?.notReadable?.length ? h('h4', { class: 'pcc-sub' }, 'Not readable here') : null,
    ...(temps?.notReadable || []).map((n) => h('div', { class: 'pcc-row' },
      h('span', { class: 'pcc-dot info' }),
      h('div', {}, h('b', {}, `${n.what}.`), ` ${n.why}`, h('small', { class: 'faint pcc-src' }, n.need, n.link ? [' ', link('Its page', n.link)] : null)))),
    h('p', { class: 'faint pcc-foot' }, 'Read only. Updates every 5 s.'));
  watchVisible(el, page);
  return el;
}

// ---------- PC check ----------
const DEMO_CHECK = () => ({ at: new Date().toISOString(), summary: { warn: 1, info: 0, ok: 3 }, results: [
  { id: 'disk-space', title: 'Free space', level: 'ok', line: 'C: has 412 GB free of 1.8 TB (22%).' },
  { id: 'drive-health', title: 'Drive health', level: 'ok', line: 'Demo SSD (SSD): healthy.' },
  { id: 'gpu-driver', title: 'Graphics driver', level: 'ok', line: 'NVIDIA GeForce RTX 4070: driver 581.57, from Oct 10, 2026.', link: { text: 'NVIDIA drivers', url: 'https://www.nvidia.com/en-us/drivers/' } },
  { id: 'ram-speed', title: 'RAM speed', level: 'warn', line: 'RAM runs at 2133 MT/s; it is rated 3200. Turn on XMP (Intel) or EXPO/DOCP (AMD) in the BIOS.' }] });
let check = null, checkErr = null, checkAt = 0, checking = false, redrawCheck = () => {}, lastDrawn = 0;
async function runCheck(fresh) {
  if (checking) return; checking = true; redrawCheck();
  try { check = isDemo() ? DEMO_CHECK() : await env.api(`/api/pc-check${fresh ? '?fresh=1' : ''}`); checkErr = null; checkAt = Date.now(); }
  catch (e) { checkErr = e.message; }
  finally { checking = false; redrawCheck(); }
}
export function pcCheckCard(rerender) {
  redrawCheck = rerender;
  // the page redraws every few seconds while open: a gap means it was opened again
  const opened = Date.now() - lastDrawn > 10000; lastDrawn = Date.now();
  // read when the page opens (a reading over a minute old is read again), never in the background
  if ((!check && !checkErr && !checking) || (opened && !checking && Date.now() - checkAt > 60000)) queueMicrotask(() => runCheck(false));
  if (!check && !checkErr) return loadingCard('PC check', 4);
  const s = check?.summary;
  const head = [h('h2', {}, 'PC check'), h('span', { class: 'spacer' }), button(checking ? 'Checking' : 'Check again', () => runCheck(true), { kind: 'ghost small', ic: 'refresh', disabled: checking })];
  // the things to look at first, then the notes, then what is fine
  const order = { warn: 0, info: 1, ok: 2 };
  const results = [...(check?.results || [])].sort((a, b) => order[a.level] - order[b.level]);
  return card(head,
    checkErr ? h('p', { class: 'faint' }, `The check could not run: ${checkErr}`) : null,
    s ? h('p', { class: 'pcc-sum' }, s.warn ? `${s.warn} ${s.warn === 1 ? 'thing' : 'things'} to look at.` : 'Nothing needs you.') : null,
    ...results.map((r) => h('div', { class: 'pcc-row' },
      h('span', { class: `pcc-dot ${r.level}`, 'aria-label': r.level === 'warn' ? 'Look at this' : r.level === 'ok' ? 'Fine' : 'Note' }),
      h('div', {}, h('small', { class: 'faint pcc-title' }, r.title), h('span', {}, r.line), r.link ? h('small', { class: 'pcc-src' }, link(r.link.text, r.link.url)) : null))),
    h('p', { class: 'faint pcc-foot' }, 'Read only: nothing is installed or changed.'));
}
