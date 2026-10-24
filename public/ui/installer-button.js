// The Install button for an optional tool (Equalizer APO, ReaPlugs, USBPcap; helpers/installers.mjs), 22 Oct 2026.
// One click shows what will happen in DeviceHub's own dialog (the file, where it comes from, its size, how it is
// checked, what the person still clicks); one Install button there downloads it with a loading bar, checks it and opens
// the maker's installer, which shows Windows' own admin prompt and its own windows. A tool whose download cannot be
// checked gets "Get <name>" instead, and its dialog opens the official page.
//   installerButton(id, { onDone, compact }) -> an element that keeps its state across page redraws
//   installing() -> the id being installed from this window, or null
//   installerStatus(fresh) -> [{ id, name, installed, version, offer, ... }] (cached; demo mode has pretend ones)
import { h, icon } from './dom.js';
import { button } from './controls.js';
import { modal, toast } from './overlay.js';
import { env } from '../core/env.js';
import { isDemo } from '../core/devices.js';

const DEMO = [
  { id: 'eqapo', name: 'Equalizer APO', installed: true, version: '1.4.2', offer: 'page', page: 'https://sourceforge.net/projects/equalizerapo/' },
  { id: 'reaplugs', name: 'ReaPlugs', installed: false, version: null, offer: 'page', page: 'https://www.reaper.fm/reaplugs/' },
  { id: 'usbpcap', name: 'USBPcap', installed: false, version: null, offer: 'install', page: 'https://desowin.org/usbpcap/' },
];
let cache = null, cacheAt = 0, loading = null;
export async function installerStatus(fresh) {
  if (isDemo()) return DEMO;
  if (!fresh && cache && Date.now() - cacheAt < 30000) return cache;
  if (!loading) loading = env.api(`/api/installers${fresh ? '?fresh' : ''}`).then((r) => r.tools, () => [])  // not answered (an older server.js): no list, tried again in 30 s
    .then((tools) => { cache = tools; cacheAt = Date.now(); return cache; }).finally(() => { loading = null; });
  return loading;
}
export const cachedStatus = () => (isDemo() ? DEMO : cache);

// per tool: { busy, text, pct } while it installs (survives a page redraw: the new element picks it up)
const state = {};
const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// while Windows' permission box is open (progress uac 'waiting', helpers/uac.mjs): its line in plain sight, in place
// of the loading bar; never a pop-up, toast or tooltip
function bar(id, text, pct, uac = null) {
  if (uac === 'waiting') return h('div', { class: 'uac-wait', id: `inst-bar-${id}`, role: 'status' }, text);
  return h('div', { class: 'loadbar-wrap', id: `inst-bar-${id}`, style: { minWidth: '180px' } },
    h('div', { class: `loadbar${pct == null ? ' sweep' : ''}`, role: 'progressbar', 'aria-label': text, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct == null ? null : String(pct) },
      h('span', { style: pct == null ? {} : { width: `${pct}%` } })),
    h('span', { class: 'loadbar-text' }, pct == null ? text : `${text} · ${pct}%`));
}

function planBody(p) {
  const line = (k, v) => h('div', { style: { display: 'grid', gridTemplateColumns: '92px 1fr', gap: '10px', padding: '3px 0' } }, h('span', { class: 'faint' }, k), h('span', { style: { overflowWrap: 'anywhere' } }, v));
  return h('div', {},
    h('p', { style: { margin: '0 0 10px' } }, p.adds),
    line('File', `${p.file} (version ${p.version})`),
    line('From', p.bundled ? h('span', {}, 'Inside DeviceHub (the official file from ', h('a', { href: p.page, target: '_blank', rel: 'noopener' }, p.source), '); nothing is downloaded')
      : h('span', {}, `${p.name}'s own site: `, h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.source))),
    line('Size', `${p.sizeExact ? '' : 'about '}${mb(p.size)}`),
    line('Checked', p.check),
    p.offer === 'install' ? line(p.bundled ? 'Folder' : 'Saved to', p.folder) : null,
    p.offer === 'install' ? h('p', { class: 'faint', style: { margin: '10px 0 0', fontSize: '12.5px' } }, `Then its own installer opens. ${p.after}`)
      : h('p', { class: 'faint', style: { margin: '10px 0 0', fontSize: '12.5px' } }, `Download ${p.file} there and open it. ${p.after}`));
}

// polls every 400 ms until the install is done; gives up after FOLLOW_MS or FOLLOW_ERRORS failed reads in a row
// (final audit, 22 Oct 2026: it polled forever when DeviceHub stopped answering)
export const FOLLOW_MS = 10 * 60 * 1000, FOLLOW_ERRORS = 5;
export async function follow(id, redraw, { wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), api = (p) => env.api(p) } = {}) {
  const until = now() + FOLLOW_MS;
  let errors = 0;
  for (;;) {
    await wait(400);
    if (now() > until) return { ok: false, text: 'Stopped waiting after 10 minutes. Check Windows Settings > Apps to see if it installed.' };
    let p;
    try { p = await api('/api/installers/progress'); errors = 0; } catch (e) {   // DeviceHub busy for a moment
      if (++errors >= FOLLOW_ERRORS) return { ok: false, text: `DeviceHub did not answer (${e.message}). Check Windows Settings > Apps to see if it installed.` };
      continue;
    }
    if (p.tool !== id) continue;
    if (p.done) return p;
    if (p.text !== state[id].text || p.pct !== state[id].pct || p.uac !== state[id].uac) {
      Object.assign(state[id], { text: p.text, pct: p.pct, uac: p.uac || null });
      const el = document.getElementById(`inst-bar-${id}`);
      if (el) el.replaceWith(bar(id, p.text, p.pct, p.uac)); else redraw();
    }
  }
}

async function start(id, onDone, redraw) {
  if (isDemo()) { toast('Not in demo mode', 'info'); return; }
  let p;
  try { p = await env.api(`/api/installers/plan?tool=${encodeURIComponent(id)}`); } catch (e) { toast('Could not read the download', 'bad', { detail: e.message }); return; }
  const page = p.offer !== 'install';
  const yes = await modal(page ? `Get ${p.name}` : `Install ${p.name}?`, planBody(p),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: page ? 'Open the official page' : 'Install', value: true, kind: 'primary' }]);
  if (!yes) return;
  if (page) { window.open(p.page, '_blank'); return; }
  return runInstall(id, p, onDone, redraw);
}
async function runInstall(id, p, onDone, redraw) {
  state[id] = { busy: true, text: 'Starting', pct: null };
  redraw();
  let r;
  try { await env.api('/api/installers/install', { tool: id }); r = await follow(id, redraw); }
  catch (e) { r = { ok: false, text: `Not installed: ${e.message}` }; }
  delete state[id];
  cache = null;
  // Windows' permission box declined or not answered (r.retry): the line in place, with Try again (no toast, no dialog)
  if (r.retry) { state[id] = { busy: false, said: r.text, retry: () => runInstall(id, p, onDone, redraw) }; redraw(); onDone?.(r); return; }
  if (r.ok) toast(r.text, 'good', { ms: 9000, detail: [r.verified ? `Checked: ${r.verified}.` : null, r.partial, r.restart ? 'Restart the PC to finish.' : null].filter(Boolean).join(' ') || null });
  else {
    toast('Not installed', 'bad', { ms: 12000, detail: r.text });
    if (r.page && !r.pageOnly && await modal(`${p.name} was not installed`, h('p', { style: { margin: 0 } }, r.text), [{ label: 'Close', value: false, kind: 'ghost' }, { label: 'Open the official page', value: true, kind: 'primary' }])) window.open(r.page, '_blank');
  }
  redraw();
  onDone?.(r);
}

// The same install, confirmed in place instead of in a dialog (the Setup page, 22 Oct 2026: no pop-ups there). The
// button opens what will happen right under it (the file, where from, size, how it is checked), with Install and
// Cancel; then the loading bar; then one line with the answer. Kept per tool across page redraws.
//   installerInline(id, { redraw, kind }) -> an element
const DEMO_PLAN = {
  eqapo: { name: 'Equalizer APO', adds: 'The EQ, Natural sound, mic boost and mic filters.', file: 'EqualizerAPO-x64-1.4.2.exe', version: '1.4.2', bundled: true, page: 'https://sourceforge.net/projects/equalizerapo/', source: 'sourceforge.net', size: 2621440, sizeExact: true, check: 'SHA-256 pinned in DeviceHub', offer: 'install', folder: 'tools\\eqapo', after: 'Windows asks once; restart the PC when it says so.' },
  usbpcap: { name: 'USBPcap', adds: "Only for learning a device: it records what the maker's app sends.", file: 'USBPcapSetup-1.5.4.0.exe', version: '1.5.4.0', bundled: false, url: 'https://github.com/desowin/usbpcap/releases', page: 'https://desowin.org/usbpcap/', source: 'github.com/desowin', size: 1153434, sizeExact: false, check: "the maker's signature", offer: 'install', folder: 'Downloads', after: 'Windows asks once; restart the PC when it says so.' },
};
const inline = {};   // id -> { stage: 'closed'|'loading'|'plan'|'busy'|'done', plan, text, ok }
export function installerInline(id, { redraw = () => {}, onDone, kind = 'primary small' } = {}) {
  const s = inline[id] || (inline[id] = { stage: 'closed' });
  const set = (x) => { Object.assign(s, x); redraw(); };
  const name = (cachedStatus() || []).find((t) => t.id === id)?.name || { eqapo: 'Equalizer APO', reaplugs: 'ReaPlugs', usbpcap: 'USBPcap' }[id] || id;
  const open = async () => {
    set({ stage: 'loading', text: '' });
    try { set({ stage: 'plan', plan: isDemo() ? { id, ...DEMO_PLAN[id] } : await env.api(`/api/installers/plan?tool=${encodeURIComponent(id)}`) }); }
    catch (e) { set({ stage: 'done', ok: false, text: `Could not read the download: ${e.message}` }); }
  };
  const go = async () => {
    const p = s.plan;
    if (p.offer !== 'install') { window.open(p.page, '_blank'); set({ stage: 'done', ok: true, text: `${p.name}'s page is open in your browser. Download ${p.file} there and open it.` }); return; }
    if (isDemo()) { set({ stage: 'done', ok: true, text: `Demo mode: nothing was installed. In the app, ${p.name}'s own installer opens here.` }); return; }
    state[id] = { busy: true, text: 'Starting', pct: null };
    set({ stage: 'busy' });
    let r;
    try { await env.api('/api/installers/install', { tool: id }); r = await follow(id, redraw); }
    catch (e) { r = { ok: false, text: `Not installed: ${e.message}` }; }
    delete state[id];
    cache = null;
    set({ stage: 'done', ok: !!r.ok, retry: !!r.retry, text: r.retry ? r.text : r.ok ? [r.text, r.verified ? `Checked: ${r.verified}.` : null, r.partial, r.restart ? 'Restart the PC to finish.' : null].filter(Boolean).join(' ') : `Not installed. ${r.text || ''}`.trim() });
    onDone?.(r);
  };
  const close = () => set({ stage: 'closed', plan: null, text: '' });
  if (s.stage === 'busy' && state[id]?.busy) return bar(id, state[id].text, state[id].pct, state[id].uac);
  if (s.stage === 'loading') return h('small', { class: 'faint' }, 'Reading the download…');
  if (s.stage === 'plan') {
    const p = s.plan;
    return h('div', { class: 'inst-inline' }, planBody(p),
      h('div', { class: 'actions' }, button(p.offer === 'install' ? `Install ${p.name}` : 'Open the official page', go, { kind: 'primary small', ic: p.offer === 'install' ? 'plus' : 'external' }), button('Cancel', close, { kind: 'ghost small' })));
  }
  // Try again: straight to the install when Windows' box was declined or not answered (s.retry), else the plan again
  if (s.stage === 'done') return h('div', { class: 'inst-inline' }, h('div', { class: `gh-note ${s.ok ? 'good' : 'bad'}` }, s.text), s.ok ? null : h('div', { class: 'actions' }, button('Try again', s.retry ? go : open, { kind: 'small' })));
  return button(`Install ${name}`, open, { kind, ic: 'plus' });
}

// the tool being installed from this window, if any (its loading bar can take a whole line)
export const installing = () => Object.keys(state).find((id) => state[id]?.busy) || null;

// one button (or, while installing, its loading bar); redraw: how the page redraws itself (defaults to onDone)
export function installerButton(id, { onDone, redraw, label, kind = 'primary small', offer, style } = {}) {
  const s = state[id];
  const again = () => (redraw || (() => onDone?.()))();
  if (s?.busy) return bar(id, s.text, s.pct, s.uac);
  if (s?.said) return h('div', { class: 'inst-inline' }, h('div', { class: 'gh-note bad' }, s.said),
    h('div', { class: 'actions' }, button('Try again', () => { const go = s.retry; delete state[id]; go(); }, { kind: 'small' }), button('Not now', () => { delete state[id]; again(); }, { kind: 'ghost small' })));
  // not read yet: read it once, then the page draws the right label ("Install" or "Get")
  if (!cachedStatus() && !loading) installerStatus().then(again, () => {});
  const st = (cachedStatus() || []).find((t) => t.id === id);
  const name = st?.name || { eqapo: 'Equalizer APO', reaplugs: 'ReaPlugs', usbpcap: 'USBPcap' }[id] || id;
  const page = (offer || st?.offer) === 'page';
  const b = button(label || (page ? `Get ${name}` : `Install ${name}`), () => start(id, onDone, again), { kind, ic: page ? 'external' : 'plus' });
  if (style) Object.assign(b.style, style);
  return b;
}
