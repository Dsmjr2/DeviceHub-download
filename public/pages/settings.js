// Settings: start with Windows, self-test (read-only), where files live, and what DeviceHub will never do.
import { h, icon } from '../ui/dom.js';
import { card, row, toggle, button, pill } from '../ui/controls.js';
import { devices, isDemo, readNow } from '../core/devices.js';
import { auto } from '../core/autoswitch.js';
import { topbar } from './common.js';
import { toast, modal } from '../ui/overlay.js';

// Uninstall from here (20 Oct 2026, Shawn: "make the uninstall easy"): one question, then helpers/uninstall.ps1 closes
// this window and removes DeviceHub; it says something only if it could not finish
async function uninstall() {
  const yes = await modal('Uninstall DeviceHub?', h('p', {}, 'DeviceHub closes and is removed from this PC. Your backups go to Documents\\DeviceHub backups, and your devices keep their settings.'),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Uninstall', value: true, kind: 'primary' }]);
  if (!yes) return;
  try {
    const r = await fetch('/api/uninstall', { method: 'POST' }); const j = await r.json();
    if (!r.ok) return toast('Not removed', 'bad', { detail: j.error });
    toast('Removing DeviceHub; this window closes when it is done', 'info', { ms: 20000 });
  } catch { toast('DeviceHub is not running', 'bad'); }
}
import { env } from '../core/env.js';
import { ART_STYLES, saveArtStyle, THEME_ACCENTS, THEME_BGS, currentTheme, saveTheme } from '../core/theme.js';
import { artFor } from '../ui/art.js';
import { copyDownloadLink, copyShortReport } from '../core/share.js';
import { installerButton, installerStatus, installing } from '../ui/installer-button.js';
import { getHelp } from '../ui/get-help.js';

let startup = null;
// DeviceHub's own updates from GitHub (helpers/self-update.js): null = not read yet
let self = null, selfBusy = false;
async function loadSelf() {
  if (isDemo()) { self = { git: true, behind: 0 }; return; }
  self = { checking: true };
  try { self = await (await fetch('/api/self-update')).json(); } catch { self = { error: 'DeviceHub did not answer' }; }
  rerender();
}
// A loading bar (21 Oct 2026, Shawn: "put loading bars when updating or syncing"): a percentage when it is known (the
// download), else a sweep, with the step in words under it. The update's steps come from /api/self-update/progress
// every 0.4 s, and only the bar is redrawn.
function loadingBar(id, text, pct) {
  return h('div', { class: 'loadbar-wrap', id },
    h('div', { class: `loadbar${pct == null ? ' sweep' : ''}`, role: 'progressbar', 'aria-label': text, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct == null ? null : String(pct) },
      h('span', { style: pct == null ? {} : { width: `${pct}%` } })),
    h('span', { class: 'loadbar-text' }, pct == null ? text : `${text} · ${pct}%`));
}
let selfStep = null, stepTimer = null;
function showStep(p) {
  selfStep = p;
  const el = document.getElementById('self-bar');
  if (el) el.replaceWith(loadingBar('self-bar', p.text, p.pct)); else rerender();
}
function watchSteps() {
  clearInterval(stepTimer);
  stepTimer = setInterval(async () => {
    if (!selfBusy) { clearInterval(stepTimer); return; }
    try { const p = await (await fetch('/api/self-update/progress')).json(); if (p.text && (p.text !== selfStep?.text || p.pct !== selfStep?.pct)) showStep(p); } catch {}
  }, 400);
}
async function runSelfUpdate() {
  selfBusy = true; selfStep = { text: 'Looking for the new version', pct: null }; rerender(); watchSteps();
  try {
    const r = await env.api('/api/self-update', {});
    if (r.installing) toast('Updating DeviceHub', 'busy', { detail: 'Downloaded and checked. Installing; DeviceHub restarts by itself in under a minute.', ms: 30000 });
    else if (r.updated) toast('Updating DeviceHub', 'busy', { detail: `${r.count} new change${r.count === 1 ? '' : 's'}. Restarting…`, ms: 8000 });
    else { toast('Already up to date', 'good'); selfBusy = false; loadSelf(); }
    // updated: the bar stays ("Restarting") until the window reloads itself with the new version
    if (r.updated) showStep({ text: r.installing ? 'Installing; DeviceHub restarts by itself' : 'Restarting DeviceHub', pct: null });
  } catch (e) { toast('Not updated', 'bad', { detail: e.message }); selfBusy = false; rerender(); }
}
// settings sync and the battery saver (helpers/settings-sync.js, helpers/power.js)
let syncSt = null, powerSt = null, opts = null, syncBusy = false;
async function loadSyncPower() {
  if (isDemo()) { syncSt = { enabled: true, last: new Date().toISOString() }; powerSt = { hasBattery: true, onBattery: false, enabled: true }; opts = {}; return; }
  try { [syncSt, powerSt, opts] = await Promise.all(['/api/settings-sync', '/api/power', '/api/settings'].map(async (u) => (await fetch(u)).json())); } catch {}
  rerender();
}
const syncAgo = (iso) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
async function setOpt(k, v) { try { await env.api('/api/settings', { [k]: v }); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); } loadSyncPower(); }
function syncRows() {
  if (isDemo()) return [];
  const sy = syncSt || {}, pw = powerSt || {};
  const syncText = !syncSt ? 'Checking…' : sy.notSetUp ? 'Not set up: it needs your own private GitHub copy of DeviceHub.' : opts?.settingsSync === false ? 'Off.' : sy.error ? `Couldn't sync: ${sy.error}` : sy.role === 'main' ? `This PC sends its EQ, sound tools, options and profiles to your other PCs. Checked ${syncAgo(sy.last)}.` : `Follows ${sy.mainName || 'your main PC'}: its settings load here. Checked ${syncAgo(sy.last)}.`;
  const powerText = !powerSt ? 'Checking…' : !pw.hasBattery ? 'No battery on this PC: always full speed.' : pw.onBattery ? (pw.saving ? 'On battery: background checks slowed.' : 'On battery.') : 'On the charger: full speed.';
  return [
    row('Settings sync', syncBusy ? loadingBar('sync-bar', 'Syncing with your other PCs', null) : syncText, h('div', { class: 'srow-ctl' },
      opts?.settingsSync === false || sy.notSetUp ? null : button(syncBusy ? 'Syncing…' : 'Sync now', async () => { syncBusy = true; rerender(); syncSt = await env.api('/api/settings-sync', {}).catch((e) => ({ error: e.message })); syncBusy = false; toast(syncSt.error ? 'Not synced' : 'Synced', syncSt.error ? 'bad' : 'good', { detail: syncSt.error || (syncSt.lastLoaded ? `Loaded ${syncSt.lastLoaded.parts.join(', ')}` : null) }); loadSyncPower(); }, { kind: 'ghost small', ic: 'refresh', disabled: syncBusy }),
      toggle({ value: opts?.settingsSync !== false, label: 'Settings sync', onCommit: (on) => setOpt('settingsSync', on) }))),
    // battery care (helpers/battery-care.mjs): the wireless devices' lights down on a low battery, back once they charge
    row('Save device battery', 'Mouse and headset at 20% or less: their lights off, the mouse at 1000 Hz. Back once charged.', toggle({ value: opts?.batteryCare !== false, label: 'Save device battery', onCommit: (on) => setOpt('batteryCare', on) })),
    // only a PC with a battery has anything to save (a desktop always runs at full speed)
    powerSt && !pw.hasBattery ? null : row('Battery saver', powerText, toggle({ value: opts?.batterySaver !== false, label: 'Battery saver', onCommit: (on) => setOpt('batterySaver', on) })),
    // light window: DeviceHub inside the Chrome already running (much less memory); on by default on a PC with a battery
    row('Low-memory window', 'Opens in your Chrome, about 350 MB less.', toggle({ value: opts?.lightWindow ?? !!pw.hasBattery, label: 'Low-memory window', onCommit: (on) => setOpt('lightWindow', on) })),
  ];
}

function selfRow() {
  if (isDemo()) return null;
  const s = self || {};
  const text = !self || s.checking ? 'Checking…' : !s.git && !s.zip ? 'Not set up for this copy.' : s.error ? `Couldn't check: ${s.error}` : s.blocked ? `A new version is ready, but ${s.blocked.charAt(0).toLowerCase()}${s.blocked.slice(1)}` : s.behind ? (s.zip ? `Ready: ${s.latest}` : `${s.behind} new change${s.behind === 1 ? '' : 's'}: ${s.latest}`) : s.skipped ? 'The newest version did not start here, so DeviceHub stayed on this one. A fix will show up here.' : 'Up to date.';
  return row('DeviceHub updates', selfBusy && selfStep ? loadingBar('self-bar', selfStep.text, selfStep.pct) : text, s.behind && !s.blocked ? button(selfBusy ? 'Updating…' : 'Update', runSelfUpdate, { kind: 'primary small', ic: 'refresh', disabled: selfBusy })
    : s.git === false && !s.zip ? null : button('Check', () => loadSelf(), { kind: 'ghost small', ic: 'refresh' }));
}
// Optional tools (22 Oct 2026, helpers/installers.mjs): Equalizer APO, ReaPlugs and USBPcap, each with its state and
// its button (ui/installer-button.js), so nobody needs Claude to install them. Settings must still fit one screen at
// 1650 x 910 (measured: three tools in a line need about 400 px, the column has 330), so the card keeps ONE row: what
// is installed, in a line, and Show, which lists the three with their buttons in DeviceHub's own dialog.
let tools = null, toolsAt = 0, toolsList = null;
const TOOL_USE = { eqapo: 'EQ and mic filters', reaplugs: 'mic Even volume', usbpcap: 'learning a device' };
function loadTools(fresh) {
  toolsAt = Date.now();
  return installerStatus(fresh).then((t) => { const changed = JSON.stringify(t) !== JSON.stringify(tools); tools = t; if (changed) { rerender(); toolsList?.(); } }, () => {});
}
const toolsDone = () => { tools = null; loadTools(true); };
const toolsRedraw = () => { rerender(); toolsList?.(); };
function toolsSummary() {
  const busy = installing();
  if (busy) return `Installing ${tools?.find((t) => t.id === busy)?.name || busy}…`;
  if (!tools) return 'Checking…';
  const have = tools.filter((t) => t.installed).map((t) => t.name), missing = tools.filter((t) => !t.installed).map((t) => t.name);
  return !missing.length ? 'All installed.' : !have.length ? 'None installed yet.' : `${have.join(', ')} installed.`;
}
async function toolsDialog() {
  const body = h('div', {});
  const draw = () => body.replaceChildren(...(tools || []).map((t) => h('div', { class: 'srow', style: { padding: '10px 0' } },
    h('div', { class: 'srow-text' }, h('div', { class: 'srow-title' }, t.name), h('div', { class: 'srow-desc' }, t.partial || t.adds || TOOL_USE[t.id])),
    h('div', { class: 'srow-ctl' }, t.installed ? pill(t.partial ? 'Check folder' : t.version ? `Installed ${t.version}` : 'Installed', t.partial ? 'warn' : 'good')
      : installerButton(t.id, { kind: 'small', onDone: toolsDone, redraw: toolsRedraw })))));
  toolsList = draw; draw();
  await modal('Optional tools', body, [{ label: 'Close', value: null, kind: 'ghost' }]);
  toolsList = null;
}
function toolsRows() {
  if (!tools || Date.now() - toolsAt > 30000) loadTools(!!tools);
  if (tools && !tools.length) return null;  // not answered (an older server.js)
  const r = row('Optional tools', toolsSummary(), button('Show', toolsDialog, { kind: 'ghost small', disabled: !tools }));
  r.style.padding = '6px 0';
  return r;
}
// rows with Optional tools' tighter padding (null rows are left out by card())
const tight = (...rows) => rows.map((r) => { if (r) r.style.padding = '6px 0'; return r; });
let results = null;
let upd = null, updLoading = false, guide = null;
let rerender = () => {};

async function loadStartup() {
  if (isDemo()) { startup = false; return; }
  try { startup = (await (await fetch('/api/startup')).json()).enabled; } catch { startup = false; }
  rerender();
}


// Updates: installed firmware, the vendors' newest, and their own updaters (DeviceHub never flashes firmware).
async function loadUpdates(force) {
  if (isDemo()) { upd = { apps: { pulsar: '1.30', icue: '5.22.86' }, online: { pulsar: { app: '1.31' }, epomaker: { firmware: '1.4' }, errors: {} }, pulsarAppNewer: true }; rerender(); return; }
  if (updLoading) return;
  updLoading = true; rerender();
  try { upd = await (await fetch(`/api/updates${force ? '?force' : ''}`)).json(); } catch (e) { upd = { error: e.message }; }
  updLoading = false; rerender();
}
const post = async (path, body) => (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const openPage = async (key) => { const r = await post('/api/open', { app: key }); if (r.url) window.open(r.url, '_blank'); };
const GUIDES = {
  pulsar: { app: 'the Pulsar app', steps: ['Plug the mouse into the PC with its USB cable and leave it plugged in until the update finishes.', 'Click the gear at the top right, then Check Update next to Version: Mouse.', 'If it offers one, update the dongle first, then the mouse, as Pulsar says.', 'Come back here and press Done: DeviceHub closes the app and reads the new version.'] },
  icue: { app: 'iCUE', steps: ['Plug the headset into the PC with its USB cable.', 'In iCUE open Settings, then Device Settings, then HS80.', 'Press Check for Updates (and the same for the HS80 Wireless Receiver).', 'Come back here and press Done: DeviceHub closes iCUE and takes the headset back.'] },
};
// device firmware: a row of the Startup card with its button, and once checked, a row per device under it
function updatesRows() {
  const mi = devices.mouse?.info || {}, hi = devices.headset?.info || {};
  const u = upd, web = u?.online || {}, apps = u?.apps || {};
  const head = row('Device firmware', !u ? 'Looks for newer firmware. Nothing is installed.' : u.error ? `Could not check: ${u.error}` : 'Checked; each device below.',
    button(updLoading ? 'Checking…' : 'Check now', () => loadUpdates(true), { kind: 'ghost small', ic: 'refresh', disabled: updLoading }));
  if (!u || u.error) return [head];
  const g = guide && GUIDES[guide];
  return [head,
    row('Mouse and dongle', `Mouse ${mi['Mouse firmware'] || '—'} · dongle ${mi['Dongle firmware'] || '—'} · Pulsar app ${apps.pulsar || 'not installed'}. `,
      h('span', { class: 'actions', style: { alignItems: 'center' } },
        u.pulsarAppNewer ? pill(`app ${web.pulsar.app} out`, 'warn') : web.pulsar ? pill('app up to date', 'good') : pill(web.errors?.pulsar ? 'could not check' : '—', ''),
        u.pulsarAppNewer ? button(`Get ${web.pulsar.app}`, () => openPage('pulsarDownload'), { kind: 'ghost small', ic: 'external' }) : null,
        button('Check in Pulsar app', async () => { guide = 'pulsar'; rerender(); await post('/api/updates/open', { app: 'pulsar' }); }, { kind: 'small' }))),
    row('Headset', `Firmware ${hi.Firmware || '—'} · iCUE ${apps.icue || 'not installed'}`,
      button('Check in iCUE', async () => { guide = 'icue'; rerender(); await post('/api/updates/open', { app: 'icue' }); }, { kind: 'small' })),
    row('Keyboard', `Epomaker posts P75 firmware ${web.epomaker ? `V${web.epomaker.firmware}` : '—'}. Flashing erases the key map: back it up first.`,
      button('Epomaker page', () => openPage('epomakerFirmware'), { kind: 'ghost small', ic: 'external' })),
    g ? h('div', { class: 'banner', style: { marginTop: '12px' } }, h('div', { class: 'grow' },
      h('b', {}, `Updating in ${g.app}`),
      h('ol', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, ...g.steps.map((t) => h('li', {}, t)))),
      button('Done', async () => { const app = guide; guide = null; rerender(); await post('/api/updates/done', { app }); toast(`Closed ${GUIDES[app].app}`, 'good', { detail: 'versions read again' }); loadUpdates(false); }, { kind: 'primary small' })) : null];
}

// Health (19 Oct 2026): how DeviceHub itself is doing, in plain words, with a yellow dot on anything unusual.
let health = null, healthAt = 0;
async function loadHealth(force) {
  if (isDemo() || (!force && Date.now() - healthAt < 30000)) return;
  healthAt = Date.now();
  try { health = await (await fetch('/api/health')).json(); } catch { health = { error: true }; }
  // the daily self-check's last result (helpers/daily-check.mjs); Check now runs it again
  try { daily = await env.api(force ? '/api/agent/check-run' : '/api/agent/check-result', {}); } catch { daily = null; }
  rerender();
}
let daily = null;
// one line: when it last ran and what, if anything, needs a look; every item in its tooltip
function dailyLine(line) {
  if (!daily) return null;
  const items = Object.entries(daily.items || {});
  const bad = items.filter(([, v]) => v.ok === false), later = items.filter(([, v]) => v.ok === null);
  const when = daily.at ? new Date(daily.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'not run yet';
  const text = bad.length ? `${bad.length} to look at: ${bad.map(([k]) => k).join(', ')}` : later.length ? `all good · ${later.map(([k]) => k).join(', ')} when next connected` : 'all good';
  return h('div', { title: items.map(([k, v]) => `${k}: ${v.text}`).join('\n') }, line('Daily check', `${text} · ${when}`, !bad.length));
}
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const upFor = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} days ${Math.floor((s % 86400) / 3600)} h`);
const stableFor = (iso) => {
  if (!iso) return 'no crash on record';
  const ms = Date.now() - Date.parse(iso), d = Math.floor(ms / 86400e3), hr = Math.floor(ms / 3600e3);
  return d >= 1 ? `${d} day${d === 1 ? '' : 's'}` : hr >= 1 ? `${hr} hour${hr === 1 ? '' : 's'}` : 'under an hour';
};
function healthCard() {
  loadHealth(false);
  const x = health;
  const line = (label, value, ok) => h('div', { class: 'health-row' }, h('span', { class: `health-dot ${ok ? 'ok' : 'warn'}` }), h('span', {}, label), h('b', {}, value));
  // Save a report: one text file (health, versions, devices, the end of the log) for whoever helps with a problem
  const saveReport = () => { if (isDemo()) { toast('Not in demo mode', 'info'); return; } const a = Object.assign(document.createElement('a'), { href: '/api/report', download: '' }); document.body.append(a); a.click(); a.remove(); toast('Report saved', 'good', { detail: 'In your Downloads folder. No backups or profiles are in it.' }); };
  return card([h('h2', {}, 'Health'), h('span', { class: 'spacer' }), h('div', { class: 'head-actions' }, button('Copy', copyShortReport, { kind: 'ghost small', ic: 'external' }), button('Save', saveReport, { kind: 'ghost small', ic: 'backups' }), button('Check', () => loadHealth(true), { kind: 'ghost small', ic: 'refresh' }))],
    !x ? h('p', { class: 'faint', style: { margin: 0 } }, isDemo() ? 'Not shown in demo mode.' : 'Checking…')
      : x.error ? h('p', { class: 'faint', style: { margin: 0 } }, 'DeviceHub did not answer.')
      : h('div', { class: 'health' },
        line('Running for', upFor(x.uptimeS), true),
        line('Memory', `${x.serverMB + (x.helperMB || 0)} MB`, x.serverMB < 250 && (!x.helperMB || x.helperMB < 150)),
        // how long since DeviceHub last crashed (its launcher's log; a restart from outside does not count)
        line('Stable for', stableFor(x.lastCrashAt), !x.crashes24h),
        line('Crashes today', x.crashes24h ? `${x.crashes24h}, restarted by itself` : 'none', !x.crashes24h),
        line('Last problem', x.lastProblem ? h('span', { title: x.lastProblem.text }, `${x.lastProblem.text.split(':')[0].slice(0, 40)} · ${ago(x.lastProblem.at)}`) : 'none', !x.lastProblem || Date.now() - new Date(x.lastProblem.at) > 24 * 3600 * 1000),
        line('Backups', `${x.backups.count} · ${x.backups.mb} MB`, true),
        dailyLine(line)));
}

// Get help (22 Oct 2026; helpers/get-help.mjs): a short report about one device or DeviceHub in general, shown here in
// full; a filled-in GitHub issue opens only on the person's click, and they press Submit there. Its own card under
// Startup since 22 Oct 2026 (it was in Health, and the third column no longer fitted one screen at 1650 x 910)
let helpFor = '';
function helpCard() {
  if (isDemo()) return null;
  const pick = h('select', { 'aria-label': 'What the report is about', onchange: (e) => { helpFor = e.target.value; } },
    h('option', { value: '' }, 'DeviceHub in general'),
    ...Object.values(devices).filter((d) => d?.adapter).map((d) => h('option', { value: d.id, selected: d.id === helpFor }, d.adapter.title || d.id)));
  // compact (Settings must fit one screen at 1650 x 910): the picker in the heading, the button under it; the report
  // opens in place below the button only when asked for
  const box = getHelp('health', () => helpFor);
  box.style.marginTop = '0';
  return card([h('h2', {}, 'Get help'), h('span', { class: 'spacer' }), pick], box);
}

// Appearance: how the device drawings look, picked from a live preview of each style.
function appearanceCard() {
  const cur = document.documentElement.dataset.art || 'frosted';  // applyArtStyle has already mapped an old look to its new one
  return card([h('h2', {}, 'Appearance')],
    h('div', { class: 'art-styles' }, ...ART_STYLES.map(([key, name]) => h('button', { class: `art-style${key === cur ? ' sel' : ''}`, 'aria-pressed': String(key === cur), dataset: { look: key },
      onclick: async () => { await saveArtStyle(key); toast(`Drawings: ${name}`, 'good', { ms: 1400 }); rerender(); } },
      h('div', { class: 'art-preview', dataset: { artPreview: key } }, artFor.mouse(), artFor.headset(), artFor.keyboard()),
      h('span', {}, name)))),
    themeControls());
}

// the theme: the accent color (six swatches and any color) and the backdrop (21 Oct 2026)
function themeControls() {
  const t = currentTheme();
  const pickAccent = async (hex, name) => { await saveTheme({ themeAccent: hex }); toast(`Accent: ${name}`, 'good', { ms: 1400 }); rerender(); };
  const bgName = THEME_BGS.find(([k]) => k === t.bg)?.[1];
  // two compact rows, the name of the picked one beside each (no hover text in this app)
  return h('div', { class: 'theme-grid' },
      h('span', { class: 'theme-label' }, 'Accent'),
      h('div', { class: 'theme-row' },
        ...THEME_ACCENTS.map(([hex, name]) => h('button', { class: `theme-swatch${t.accent === hex ? ' sel' : ''}`, style: { '--s': hex }, 'aria-label': `${name} accent`, 'aria-pressed': String(t.accent === hex), onclick: () => pickAccent(hex, name) })),
        h('input', { type: 'color', class: `theme-swatch-custom${THEME_ACCENTS.some(([x]) => x === t.accent) ? '' : ' sel'}`, value: t.accent, 'aria-label': 'any accent color', onchange: (e) => pickAccent(e.target.value.toLowerCase(), e.target.value) })),
      h('span', { class: 'theme-label' }, 'Backdrop'),
      h('div', { class: 'theme-row' },
        ...THEME_BGS.map(([key, name, bg, pool]) => h('button', { class: `theme-swatch${t.bg === key ? ' sel' : ''}`, style: { '--s': `radial-gradient(circle at 35% 30%, rgba(${pool}, .95), rgba(${pool}, .35) 45%, ${bg} 80%)` }, 'aria-label': `${name} backdrop`, 'aria-pressed': String(t.bg === key),
          onclick: async () => { await saveTheme({ themeBg: key }); rerender(); } })),
        h('span', { class: 'theme-name' }, bgName)));
}

// Reads every connected device twice and checks the two readings agree and pass their own checks. Writes nothing.

async function selfTest() {
  results = [];
  for (const d of Object.values(devices)) {
    const a = d.adapter;
    if (d.status !== 'connected') { results.push([a.title, 'skip', `not connected (${d.status})`]); continue; }
    try {
      const one = await readNow(d.id);
      const two = await readNow(d.id);
      const unstable = Object.keys(one).filter((k) => JSON.stringify(one[k]) !== JSON.stringify(two[k]) && !/^vol:|batteryLevel/.test(k));
      results.push([a.title, unstable.length ? 'warn' : 'pass', unstable.length ? `changed between two reads: ${unstable.join(', ')}` : `${Object.keys(one).length} values read twice, identical`]);
      if (d.id === 'mouse' && a.trusted) {
        const keys = ['pollingRate', 'dpiStage', 'liftOff', 'debounce', 'motionSync', 'angleSnap', 'ripple'];
        const bad = keys.filter((k) => !a.trusted(k));
        results.push([a.title, bad.length ? 'warn' : 'pass', bad.length ? `${bad.join(', ')} failed their check and stay locked` : 'every saved setting checks out']);
      }
      if (d.id === 'keyboard' && a.session) {
        const s = a.session;
        results.push([a.title, 'pass', `${s.info.layers} layers × 6 × 15 keymap matches the P75 layout; knob ${s.encoders ? 'readable' : 'not found'}; ${s.macros.mi.count} macro slots`]);
      }
      if (d.id === 'headset') results.push([a.title, 'pass', `iCUE properties: ${Object.keys(a.props || {}).join(', ') || 'none (headset off)'}; Windows audio devices: ${(a.endpoints || []).length}`]);
    } catch (e) { results.push([a.title, 'fail', e.message]); }
    rerender();
  }
  // the rest of the desk, read-only: monitors, the camera, PC lights (OpenRGB), This PC (skipped in demo)
  if (!isDemo()) {
    const check = async (name, f) => { try { results.push([name, ...(await f())]); } catch (e) { results.push([name, 'fail', e.message]); } rerender(); };
    await check('Monitors', async () => { const m = await env.api('/api/monitors?fresh=1'); const ddc = m.filter((x) => x.ddc); return [ddc.length ? 'pass' : 'warn', ddc.length ? `${ddc.map((x) => x.name).join(', ')} answer over DDC/CI` : 'no monitor answers over DDC/CI']; });
    await check('Camera', async () => { const c = await env.api('/api/cameras?fresh=1'); return c.length ? ['pass', `${c[0].name}: ${Object.keys(c[0].controls).length} picture settings read`] : ['skip', 'no camera']; });
    await check('PC lights', async () => { const o = await env.api('/api/openrgb?fresh=1'); return o.running ? ['pass', `OpenRGB protocol ${o.protocol}: ${o.controllers.length} lights`] : ['skip', 'OpenRGB is not running']; });
    await check('This PC', async () => { const pc = await env.api('/api/pc?fresh=1'); return ['pass', `${pc.cpu}; ${pc.gpus.map((g) => g.name).join(', ')}; ${pc.usb.length} USB devices`]; });
  }
  const fails = results.filter((r) => r[1] === 'fail').length;
  toast(fails ? 'Self-test found problems' : 'Self-test passed', fails ? 'bad' : 'good', { detail: `${results.length} checks, nothing was written` });
  rerender();
}

export default {
  id: 'settings', title: 'Settings', icon: 'settings', accent: 'var(--good)',
  // redrawn only by its own controls, never by a device's readings (21 Oct 2026: every headset update rebuilt it)
  watches: [],
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/settings') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (startup === null) loadStartup();
    if (self === null) loadSelf();
    if (syncSt === null) loadSyncPower();
    // what DeviceHub always does to keep the devices safe (short, plain; 20 Oct 2026)
    const SAFETY = ['Never flashes firmware', 'Never sends reset or bootloader commands', 'Backs up before every change', 'Reads back every change to confirm it', 'Stays offline, except to check for updates'];
    // one screen, no scrolling and nothing folded (Shawn, 21 Oct 2026): three columns that keep their own heights; the
    // self-test and the safety promises share one small card. (data-no-jump only scopes the tighter rows now).
    return h('div', { 'data-no-jump': '' },
      topbar('App', 'Settings', null),
      h('div', { class: 'grid settings-cols top' },
        h('div', { class: 'stack' }, appearanceCard(),
          card([icon('shield'), h('h2', {}, 'Safety'), h('span', { class: 'spacer' }), button('Self-test', selfTest, { kind: 'small', ic: 'shield' })],
            results ? h('div', { class: 'diff', style: { marginBottom: '10px' } }, ...results.map(([dev, st, msg]) => h('div', { style: { gridTemplateColumns: '120px 52px 1fr' } }, h('span', { class: 'dev' }, dev), pill(st, st === 'pass' ? 'good' : st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : ''), h('span', {}, msg)))) : null,
            h('ul', { class: 'safety' }, ...SAFETY.map((t) => h('li', {}, icon('check'), t))),
            null)),
        h('div', { class: 'stack' }, card([h('h2', {}, 'Startup')],
          selfRow(),
          row('Start with Windows', 'Starts in the tray.',
            toggle({ value: !!startup, disabled: startup === null || isDemo(), label: 'start with windows', onCommit: async (on) => {
              const r = await (await fetch('/api/startup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }) })).json();
              startup = r.enabled; toast(startup ? 'DeviceHub will start with Windows' : 'DeviceHub will not start with Windows', 'good'); rerender();
            } })),
          // Optional tools sits here with the updates since 22 Oct 2026 (it was in the DeviceHub card; the third column
          // no longer fitted one screen at 1650 x 910)
          ...syncRows(), toolsRows(), ...updatesRows()), helpCard()),
        h('div', { class: 'stack' }, healthCard(),
          // its rows as tight as Optional tools' (22 Oct 2026: the Supported devices row was added without making the
          // column taller than it was)
          card([h('h2', {}, 'DeviceHub')], ...tight(
            row('Share DeviceHub', 'Download link to send to people.', button('Copy link', copyDownloadLink, { kind: 'small', ic: 'external' })),
            // the devices DeviceHub runs and what each gets (pages/supported.js, 22 Oct 2026): a page of its own, not a dialog
            row('Supported devices', 'Which devices work, and what each gets.', button('Show', () => { location.hash = '#/supported'; }, { kind: 'ghost small' })),
            isDemo() ? null : row('Files', 'Where DeviceHub keeps its data.', button('Open folder', () => fetch('/api/reveal', { method: 'POST' }), { kind: 'ghost small', ic: 'external' })),
            isDemo() ? null : row('Demo mode', 'Try it with pretend devices.', button('Open demo', () => window.open('/?demo#/overview', '_blank'), { kind: 'ghost small', ic: 'play' })),
            isDemo() ? null : row('Uninstall', 'Removes DeviceHub. Backups are kept.', button('Uninstall', uninstall, { kind: 'ghost small danger' })))))));
  },
};
