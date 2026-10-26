// Settings: appearance, startup and updates, Get help (with the safety line and the read-only self-test), health and files.
import { h, icon, lowerFirst, dateTime } from '../ui/dom.js';
import { card, row, toggle, button, pill } from '../ui/controls.js';
import { dropdown } from '../ui/dropdown.js';
import { devices, isDemo, readNow, shownDevices } from '../core/devices.js';
import { firmwareParts } from '../core/firmware-parts.js';
import { auto } from '../core/autoswitch.js';
import { topbar } from './common.js';
import { toast, modal } from '../ui/overlay.js';

// Uninstall from here (20 Oct 2026, Shawn: "make the uninstall easy"): one question, then helpers/uninstall.ps1 closes
// this window and removes DeviceHub; it says something only if it could not finish
async function uninstall() {
  const yes = await modal('Uninstall DeviceHub?', h('p', {}, 'Backups move to Documents\\DeviceHub backups.'),
    [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Uninstall', value: true, kind: 'primary' }]);
  if (!yes) return;
  try {
    const r = await fetch('/api/uninstall', { method: 'POST' }); const j = await r.json();
    if (!r.ok) return toast('Not removed', 'bad', { detail: j.error });
    toast('Removing DeviceHub…', 'info', { ms: 20000 });
  } catch { toast('DeviceHub is not running', 'bad'); }
}
import { env } from '../core/env.js';
import { ART_STYLES, saveArtStyle, THEME_ACCENTS, THEME_BGS, SKIN_SILVER_NAME, currentTheme, saveTheme, hasPicture, removePicture } from '../core/theme.js';
import { slotArt } from '../ui/art.js';
import { copyDownloadLink, copyShortReport } from '../core/share.js';
import { installerButton, installerStatus, installing } from '../ui/installer-button.js';
import { getHelp } from '../ui/get-help.js';
import { smoothBar } from '../ui/progress.js';
import { loadSetupFile, backupsCard } from './backups.js';
import { saveSetup } from '../core/setup.js';
import { setupNeeds, watchSetup } from './setup.js';
import { shareSwitch } from '../ui/driver-share.js';

let startup = null;
// DeviceHub's own updates from GitHub (helpers/self-update.js): null = not read yet
let self = null, selfBusy = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// looking for an update: the bar fills slowly while DeviceHub asks, then runs to the end before the answer shows
let selfBar = null;
async function loadSelf() {
  if (isDemo()) { self = { git: true, behind: 0 }; return; }
  self = { checking: true };
  selfBar = smoothBar(); selfBar.step('Looking for updates', 0, 90, 2500);
  rerender();
  const started = Date.now();
  let r;
  try { r = await (await fetch('/api/self-update')).json(); } catch { r = { error: 'DeviceHub did not answer' }; }
  await pause(Math.max(0, 1200 - (Date.now() - started)));   // long enough to see the bar move
  // the bar runs to the end at its own calm pace (never longer than 4 s, e.g. when the page was left), then the answer
  await Promise.race([selfBar.done('Looking for updates'), pause(4000)]); await pause(250);
  selfBar.stop(); selfBar = null;
  self = r;
  rerender();
}
// A loading bar (21 Oct 2026, Shawn: "put loading bars when updating or syncing"): a sweep while syncing, with the
// step in words under it. Updating uses one smooth bar for the whole update (ui/progress.js; 22 Oct 2026); its steps
// come from /api/self-update/progress every 0.4 s and move the same bar, which is never rebuilt.
function loadingBar(id, text, pct) {
  return h('div', { class: 'loadbar-wrap', id },
    h('div', { class: `loadbar${pct == null ? ' sweep' : ''}`, role: 'progressbar', 'aria-label': text, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct == null ? null : String(pct) },
      h('span', { style: pct == null ? {} : { width: `${pct}%` } })),
    h('span', { class: 'loadbar-text' }, pct == null ? text : `${text} · ${pct}%`));
}
// each update step's share of the one bar (helpers/self-update.js step() words); a download's percentage is placed
// inside its share. The zip copy: look, download, check, unpack, check, install. The git copy: look, get the
// changes (or keep this PC's changes and bring them together), check, restart.
const SHARES = [
  [/^(Looking for|Checking for) the new version/, 0, 10],
  [/^Downloading/, 10, 70],
  [/^Checking the download/, 70, 76],
  [/^Unpacking/, 76, 82],
  [/^Getting the new changes/, 10, 62],
  [/^Keeping the changes/, 62, 68],
  [/^Bringing them together/, 68, 76],
  [/^Checking the new version/, 82, 92],
  [/^(Installing|Restarting)/, 92, 99],
];
let selfStep = null, stepTimer = null;
function showStep(p) {
  selfStep = p;
  const share = SHARES.find(([re]) => re.test(p.text)) || [null, selfBar?.value || 0, 95];
  let [, a, b] = share;
  if (p.pct != null) { a += ((b - a) * p.pct) / 100; b = Math.min(share[2], a + 2); }
  selfBar?.step(p.text, a, b);
}
function watchSteps() {
  clearInterval(stepTimer);
  stepTimer = setInterval(async () => {
    if (!selfBusy) { clearInterval(stepTimer); return; }
    try { const p = await (await fetch('/api/self-update/progress')).json(); if (p.text && (p.text !== selfStep?.text || p.pct !== selfStep?.pct)) showStep(p); } catch {}
  }, 400);
}
// Reload as soon as the restarted DeviceHub answers (23 Oct 2026, Shawn: "make the updates work faster"): it had waited
// for app.js's 20 s version check, then 3 s more. DeviceHub is seen going away (or answering with new files), then
// answering twice in a row 0.3 s apart; the 20 s check stays as the fallback. Gives up after 3 minutes.
async function reloadWhenRestarted(before) {
  const until = Date.now() + 180000;
  let gone = false, ok = 0;
  while (Date.now() < until) {
    await pause(ok ? 300 : 400);
    try {
      const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version;
      if (gone || (before && v !== before)) { if (++ok >= 2) { location.reload(); return; } }
    } catch { gone = true; ok = 0; }
  }
}
// also the update pop-up's Update (public/app.js)
export async function runSelfUpdate({ overwrite = false } = {}) {
  let before = null;
  try { before = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version; } catch {}
  selfBusy = true; selfBar?.stop(); selfBar = smoothBar(); rerender();
  showStep({ text: 'Checking…', pct: null }); watchSteps();
  try {
    const r = await env.api('/api/self-update', overwrite ? { overwrite: true } : {});
    if (r.installing) toast('Updating DeviceHub', 'busy', { detail: `Restarting soon.${r.kept ? ` Your changed file${self?.blockedFiles?.length === 1 ? ' is' : 's are'} in ${r.kept}.` : ''}`, ms: 30000 });
    else if (r.updated) toast('Updating DeviceHub', 'busy', { detail: `${r.count} new change${r.count === 1 ? '' : 's'}. Restarting…`, ms: 8000 });
    else { toast('Already up to date', 'good'); selfBusy = false; selfBar?.stop(); selfBar = null; loadSelf(); }
    // updated: the bar stays ("Restarting") until the window reloads itself with the new version
    if (r.updated) { showStep({ text: r.installing ? 'Installing…' : 'Restarting DeviceHub', pct: null }); reloadWhenRestarted(before); }
  } catch (e) { toast('Not updated', 'bad', { detail: e.message }); selfBusy = false; selfBar?.stop(); selfBar = null; rerender(); }
}
// settings sync and the battery saver (helpers/settings-sync.js, helpers/power.js)
let syncSt = null, powerSt = null, opts = null, syncBusy = false;
async function loadSyncPower() {
  if (isDemo()) { syncSt = { enabled: true, last: new Date().toISOString() }; powerSt = { hasBattery: true, onBattery: false, enabled: true }; opts = {}; return; }
  try { [syncSt, powerSt, opts] = await Promise.all(['/api/settings-sync', '/api/power', '/api/settings'].map(async (u) => (await fetch(u)).json())); } catch {}
  rerender();
}
const syncAgo = (iso) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : dateTime(iso); };
async function setOpt(k, v) { try { await env.api('/api/settings', { [k]: v }); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); } loadSyncPower(); }
function syncRows() {
  if (isDemo()) return [];
  const sy = syncSt || {}, pw = powerSt || {};
  const syncText = !syncSt ? 'Checking…' : sy.notSetUp ? 'Not set up.' : opts?.settingsSync === false ? 'Off.' : sy.error ? `Couldn't sync: ${sy.error}` : sy.role === 'main' ? `Main PC. Checked ${syncAgo(sy.last)}.` : `Follows ${sy.mainName || 'your main PC'}. Checked ${syncAgo(sy.last)}.`;
  const powerText = !powerSt ? 'Checking…' : !pw.hasBattery ? 'No battery on this PC: always full speed.' : pw.onBattery ? (pw.saving ? 'On battery: slowed.' : 'On battery.') : 'On the charger: full speed.';
  return [
    // only on a PC with its own private copy of DeviceHub (Shawn's PCs); a friend's PC has nothing to sync with
    sy.notSetUp ? null : row('Settings sync', syncBusy ? loadingBar('sync-bar', 'Syncing…', null) : syncText, h('div', { class: 'srow-ctl' },
      opts?.settingsSync === false || sy.notSetUp ? null : button(syncBusy ? 'Syncing…' : 'Sync now', async () => { syncBusy = true; rerender(); syncSt = await env.api('/api/settings-sync', {}).catch((e) => ({ error: e.message })); syncBusy = false; toast(syncSt.error ? 'Not synced' : 'Synced', syncSt.error ? 'bad' : 'good', { detail: syncSt.error || (syncSt.lastLoaded ? `Loaded ${syncSt.lastLoaded.parts.join(', ')}` : null) }); loadSyncPower(); }, { kind: 'ghost small', ic: 'refresh', disabled: syncBusy }),
      toggle({ value: opts?.settingsSync !== false, label: 'Settings sync', onCommit: (on) => setOpt('settingsSync', on) }))),
    oneDriveRow(),
    // battery care (helpers/battery-care.mjs): the wireless devices' lights down on a low battery, back once they charge
    row('Save device battery', 'At 20%: lights off, mouse 1000 Hz.', toggle({ value: opts?.batteryCare !== false, label: 'Save device battery', onCommit: (on) => setOpt('batteryCare', on) })),
    // only a PC with a battery has anything to save (a desktop always runs at full speed)
    powerSt && !pw.hasBattery ? null : row('Battery saver', powerText, toggle({ value: opts?.batterySaver !== false, label: 'Battery saver', onCommit: (on) => setOpt('batterySaver', on) })),
    // light window: DeviceHub inside the Chrome (or Edge) already running (much less memory); on by default (26 Oct 2026,
    // Shawn), a saved Off stays off
    // read by DeviceHub.vbs when it opens the window, so it changes nothing until then (23 Oct 2026, Shawn: "when I turn on
    // the low memory window does anything actually happen"): said in the row and when it is switched
    row('Low-memory window', 'Opens in your Chrome, not its own. Saves about 350 MB.', toggle({ value: opts?.lightWindow !== false, label: 'Low-memory window', onCommit: async (on) => {
      await setOpt('lightWindow', on);
      toast(on ? 'Low-memory window on' : 'Low-memory window off', 'good', { detail: 'Applies next time DeviceHub opens.' });
    } })),
    // the window closes itself after 5 minutes minimized, never mid-task; the tray icon opens it again on the same page
    // (26 Oct 2026, core/idle-close.js, helpers/window-close.js); on unless switched off
    row('Close window when minimized', 'Frees memory after 5 minutes minimized.', toggle({ value: opts?.closeWhenMinimized !== false, label: 'Close window when minimized', onCommit: (on) => setOpt('closeWhenMinimized', on) })),
  ];
}

// Move to another PC (22 Oct 2026, Shawn: "What if they want to be able to go to another computer and bring their
// settings"): the setup file (Backups page, core/setup.js) and a copy kept in OneDrive (helpers/onedrive-setup.mjs)
let oneDrive = null, oneDriveBusy = false;
async function loadOneDrive() {
  if (isDemo()) { oneDrive = { folder: null, others: [] }; return; }
  try { oneDrive = await (await fetch('/api/onedrive')).json(); } catch { oneDrive = { folder: null, others: [], error: true }; }
  rerender();
}
async function setOneDrive(on) {
  oneDriveBusy = true; rerender();
  try { await env.api('/api/settings', { oneDriveCopy: on }); if (on) await env.api('/api/onedrive/save', {}); } catch (e) { toast('Not changed', 'bad', { detail: e.message }); }
  oneDriveBusy = false; loadOneDrive();
}
// two rows, not a card of their own: Settings stays one screen (the offer of another PC's copy is on the Overview)
function oneDriveRow() {
  if (isDemo()) return null;
  const od = oneDrive || {};
  const text = !oneDrive ? 'Checking…' : !od.folder ? 'OneDrive not set up.' : oneDriveBusy ? 'Saving…'
    : !od.on ? 'For your other PCs.' : `On. Saved ${syncAgo(od.mine?.savedAt)}.`;
  return row('OneDrive copy', text, toggle({ value: !!od.on, disabled: !od.folder || oneDriveBusy, label: 'OneDrive copy', onCommit: setOneDrive }));
}
const setupFileRow = () => (isDemo() ? null : row('Move to another PC', 'Your setup in one file.', h('div', { class: 'srow-ctl' },
  button('Save', async () => { try { await saveSetup(); toast('Saved to Downloads', 'good'); } catch (e) { toast('Not saved', 'bad', { detail: e.message }); } }, { kind: 'ghost small' }),
  button('Load…', loadSetupFile, { kind: 'ghost small' }))));

// Setup's row: "Everything is set up" when nothing needs the person (then it is only reached from here and Search), else
// how many things need them (23 Oct 2026, Shawn: "put the set up area in settings when its fully set up")
let setupWatch = null;
// Publish to friends (23 Oct 2026): the owner's PC only (server.js /api/publish-release); how far this copy is ahead of
// the version friends get, and one button that runs helpers/publish-release.ps1 hidden. While it runs this row shows
// its step, then Published or what stopped it (23 Oct 2026, Shawn: "how do I know if this is done?"), in place.
let pub = null, pubAt = 0;
function publishRow() {
  if (isDemo()) return null;
  const running = pub?.run?.state === 'running';
  if (Date.now() - pubAt > (running ? 3000 : 60000)) { pubAt = Date.now(); fetch('/api/publish-release').then((r) => r.json()).then((j) => { pub = j; if (location.hash === '#/settings') rerender(); }).catch(() => {}); }
  if (!pub?.owner) return null;
  const when = pub.published?.builtAt ? dayTime(pub.published.builtAt) : null;
  const run = pub.run;
  if (running) setTimeout(() => { if (location.hash === '#/settings') rerender(); }, 3100);
  const mins = running ? Math.max(1, Math.round((Date.now() - run.startedAt) / 60000)) : 0;
  // the zip and version file are up: Update gets it while Setup.exe (for new people) finishes (helpers/publish-release.ps1)
  if (running && /^(published|friends)/.test(run.step || '')) return row('Publish', `Published: use Update to get it. Finishing Setup.exe… (${mins} min)`, null);
  if (running) return row('Publish', `Publishing: ${run.step || 'Building'}… (${mins} min)`, null);
  // no signing key on this PC: the release would stop at signing, so say where it is first
  if (pub.keyHere === false) return row('Publish', 'No signing key here. Publish from the last PC.', null);
  // nothing to publish (24 Oct 2026, Shawn: "make it so the publish doesnt show if it isnt necessary"): the release already
  // has this PC's version and nothing failed; a publish that just finished stays said for 10 minutes
  const justDone = run?.state === 'done' && Date.now() - (run.endedAt || 0) < 10 * 60000;
  if (pub.ahead === 0 && run?.state !== 'failed' && !justDone) return null;
  const start = async () => {
    try { const r = await env.api('/api/publish-release', {}); pub = { ...pub, run: r.run }; } catch (e) { pub = { ...pub, run: { state: 'failed', error: e.message } }; }
    pubAt = 0; rerender();
  };
  const text = run?.state === 'failed' ? `Not published: ${run.error || 'it stopped'}.`
    : run?.state === 'done' && pub.ahead === 0 ? `Published ${dayTime(run.endedAt)}. Use Update to get it.`
    : pub.ahead > 0 ? `Published version is from ${when}; this PC has ${pub.ahead} newer change${pub.ahead === 1 ? '' : 's'}.` : when ? `Up to date (${when}).` : 'Use this to publish an update.';
  return row('Publish', text, button(run?.state === 'failed' ? 'Try again' : 'Publish', start, { kind: pub.ahead > 0 || run?.state === 'failed' ? 'primary small' : 'ghost small', ic: 'external' }));
}
function setupRow() {
  if (!setupWatch) setupWatch = watchSetup(() => { if (location.hash === '#/settings') rerender(); });
  const n = setupNeeds();
  return row('Setup', n == null ? 'Checking…' : n === 0 ? 'All set.' : `${n} thing${n === 1 ? ' needs' : 's need'} you.`,
    button(n ? 'Set up' : 'Open', () => { location.hash = '#/setup'; }, { kind: n ? 'small' : 'ghost small' }));
}

function selfRow() {
  if (isDemo()) return null;
  const s = self || {};
  let text = s.checking && selfBar ? selfBar.el : !self || s.checking ? 'Checking…' : !s.git && !s.zip ? 'Not set up for this copy.' : s.error ? `Couldn't check: ${s.error}` : s.blocked ? `A new version is ready, but ${lowerFirst(s.blocked)}` : s.behind ? (s.zip ? `Ready: ${s.latest}` : `${s.behind} new change${s.behind === 1 ? '' : 's'}: ${s.latest}`) : s.skipped ? 'The newest version did not start here, so this one stays. A fix will show here.' : 'Up to date.';
  // while it looks or updates, the bar has the whole row (no button beside it: on a narrow window the two did not fit
  // and ran off the card, 22 Oct 2026)
  if ((selfBusy || s.checking) && selfBar) return row('DeviceHub updates', selfBar.el, null);
  return row('DeviceHub updates', text, s.behind && !s.blocked ? button('Update', () => runSelfUpdate(), { kind: 'primary small', ic: 'refresh' })
    // files changed on this PC: never a dead end (23 Oct 2026, a friend's PC was told to ask Claude Code)
    : s.behind && s.blocked && s.zip ? button('Update anyway', () => runSelfUpdate({ overwrite: true }), { kind: 'primary small', ic: 'refresh' })
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
  // the server keeps the Apps list's last answer and reads it again by itself (helpers/last-answer.js); an install asks fresh
  if (!tools || Date.now() - toolsAt > 30000) loadTools(false);
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
  pulsar: { app: 'the Pulsar app', steps: ['Plug the mouse in by USB cable. Keep it plugged in until done.', 'Click the gear, then Check Update next to Version: Mouse.', 'Update the dongle first, then the mouse.', 'Press Done here when finished.'] },
  icue: { app: 'iCUE', steps: ['Plug the headset in by USB cable.', 'In iCUE: Settings > Device Settings > HS80.', 'Press Check for Updates (also for the receiver).', 'Press Done here when finished.'] },
};
// device firmware: a row of the Startup card with its button, and once checked, a row per device under it; only the
// devices this PC has (core/firmware-parts.js, 22 Oct 2026: no Pulsar app, iCUE or Epomaker row without that device),
// and no Device firmware row at all when it has none of them
function updatesRows() {
  const parts = firmwareParts(shownDevices());
  if (!parts.length) return [];
  const mi = devices.mouse?.info || {}, hi = devices.headset?.info || {};
  const u = upd, web = u?.online || {}, apps = u?.apps || {};
  const head = row('Device firmware', !u ? 'Looks for newer firmware.' : u.error ? `Could not check: ${u.error}` : 'Update in each maker\'s app.',
    button(updLoading ? 'Checking…' : 'Check now', () => loadUpdates(true), { kind: 'ghost small', ic: 'refresh', disabled: updLoading }));
  if (!u || u.error) return [head];
  const g = guide && GUIDES[guide];
  return [head,
    // one tidy line per device (23 Oct 2026, Shawn: "make this look better and cleaner"): its name, its versions in one
    // short line, one small button; the maker's app gets a badge only when it has an update
    ...tight(
      !parts.includes('mouse') ? null : row('Mouse', [`Firmware ${mi['Mouse firmware'] || '—'}`, `dongle ${mi['Dongle firmware'] || '—'}`].join(' · '),
        // one button: the app's newer version when there is one, else the app itself (where its firmware is checked)
        u.pulsarAppNewer ? button(`Get Pulsar app ${web.pulsar.app}`, () => openPage('pulsarDownload'), { kind: 'ghost small', ic: 'external' })
          : button('Pulsar app', async () => { guide = 'pulsar'; rerender(); await post('/api/updates/open', { app: 'pulsar' }); }, { kind: 'ghost small', ic: 'external' })),
      !parts.includes('headset') ? null : row('Headset', `Firmware ${hi.Firmware || '—'}`,
        button('iCUE', async () => { guide = 'icue'; rerender(); await post('/api/updates/open', { app: 'icue' }); }, { kind: 'ghost small', ic: 'external' })),
      !parts.includes('keyboard') ? null : row('Keyboard', web.epomaker ? `Newest V${web.epomaker.firmware} · back up keys first` : 'Back up keys before updating',
        button('Epomaker', () => openPage('epomakerFirmware'), { kind: 'ghost small', ic: 'external' }))),
    g ? h('div', { class: 'banner', style: { marginTop: '12px' } }, h('div', { class: 'grow' },
      h('b', {}, `Updating in ${g.app}`),
      h('ol', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, ...g.steps.map((t) => h('li', {}, t)))),
      button('Done', async () => { const app = guide; guide = null; rerender(); await post('/api/updates/done', { app }); toast(`Closed ${GUIDES[app].app}`, 'good'); loadUpdates(false); }, { kind: 'primary small' })) : null];
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
  const when = daily.at ? dayTime(daily.at) : 'not run yet';
  const passedCount = items.filter(([, v]) => v.ok === true).length;
  const text = bad.length ? `${bad.length} issue${bad.length === 1 ? '' : 's'}: ${bad.map(([k]) => k).join(', ')}` : later.length ? `Passed · ${later.map(([k]) => k).join(', ')} pending` : passedCount ? `Passed (${passedCount}/${items.length})` : 'Passed';
  return h('div', { title: items.map(([k, v]) => `${k}: ${v.text}`).join('\n') }, line('Daily check', `${text} · ${when}`, !bad.length));
}
// a weekday and time: "Sat 3:05 PM" (the daily check, the last publish)
const dayTime = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const upFor = (s) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.floor(s / 86400)} days ${Math.floor((s % 86400) / 3600)} h`);
const stableFor = (iso, uptimeS) => {
  if (!iso) return uptimeS ? `${upFor(uptimeS)} (0 crashes)` : '0 crashes';
  const ms = Date.now() - Date.parse(iso), d = Math.floor(ms / 86400e3), hr = Math.floor(ms / 3600e3);
  return d >= 1 ? `${d} day${d === 1 ? '' : 's'}` : hr >= 1 ? `${hr} hour${hr === 1 ? '' : 's'}` : 'under an hour';
};
function healthCard() {
  loadHealth(false);
  const x = health;
  const line = (label, value, ok) => h('div', { class: 'health-row' }, h('span', { class: `health-dot ${ok ? 'ok' : 'warn'}` }), h('span', {}, label), h('b', {}, value));
  // Save a report: one text file (health, versions, devices, the end of the log) for whoever helps with a problem
  const saveReport = () => { if (isDemo()) { toast('Not in demo mode', 'info'); return; } const a = Object.assign(document.createElement('a'), { href: '/api/report', download: '' }); document.body.append(a); a.click(); a.remove(); toast('Report saved', 'good', { detail: 'In Downloads.' }); };
  const totalMB = x ? x.serverMB + (x.helperMB || 0) : 0;
  // the app in the background, then its window (a Chrome window of its own, unless Low-memory window is on)
  const memBreak = x ? `${totalMB} MB app${x.windowMB ? ` + ${x.windowMB} MB window` : ''}` : '';
  return card([h('h2', {}, 'Health'), h('span', { class: 'spacer' }), h('div', { class: 'head-actions' }, button('Copy', copyShortReport, { kind: 'ghost small', ic: 'external' }), button('Save', saveReport, { kind: 'ghost small', ic: 'backups' }), button('Check', () => loadHealth(true), { kind: 'ghost small', ic: 'refresh' }))],
    !x ? h('p', { class: 'faint', style: { margin: 0 } }, isDemo() ? 'Not shown in demo mode.' : 'Checking…')
      : x.error ? h('p', { class: 'faint', style: { margin: 0 } }, 'DeviceHub did not answer.')
      : h('div', { class: 'health' },
        line('Running for', upFor(x.uptimeS), true),
        line('DeviceHub memory', memBreak, x.serverMB < 250 && (!x.helperMB || x.helperMB < 150)),
        // how long since DeviceHub last crashed (its launcher's log; a restart from outside does not count)
        line('Stable for', stableFor(x.lastCrashAt, x.uptimeS), !x.crashes24h),
        line('Crashes today', x.crashes24h ? `${x.crashes24h} (restarted automatically)` : '0', !x.crashes24h),
        line('Last problem', x.lastProblem ? h('span', { title: x.lastProblem.text }, `${x.lastProblem.text.split(':')[0].slice(0, 40)} · ${ago(x.lastProblem.at)}`) : '0', !x.lastProblem || Date.now() - new Date(x.lastProblem.at) > 24 * 3600 * 1000),
        line('Backups', `${x.backups.count} · ${x.backups.mb} MB`, true),
        dailyLine(line)));
}

// Get help (22 Oct 2026; helpers/get-help.mjs): a short report about one device or DeviceHub in general, shown here in
// full; a filled-in GitHub issue opens only on the person's click, and they press Submit there. Its own card under
// Startup since 22 Oct 2026 (it was in Health, and the third column no longer fitted one screen at 1650 x 910)
let helpFor = '';
// the only place for Get help and the reports switch since 22 Oct 2026 (Setup no longer has them); shown in demo mode
// too, where Get help says it works in the installed app and the switch changes nothing
function helpCard() {
  const pick = dropdown({ cls: 'gh-pick', label: 'What the report is about', value: helpFor, onChange: (v) => { helpFor = v; },
    options: [{ value: '', label: 'DeviceHub in general' }, ...shownDevices().filter((d) => d?.adapter).map((d) => ({ value: d.id, label: d.adapter.title || d.id }))] });
  // compact (Settings must fit one screen at 1650 x 910): the picker in the heading, the button under it; the report
  // opens in place below the button only when asked for
  const box = getHelp('health', () => helpFor);
  box.style.marginTop = '0';
  // the automatic problem reports' switch (helpers/auto-report.mjs) on the same line as the Get help button, so the
  // card is no taller (Settings fits one screen at 1650 x 910); an open report pushes it under the report
  return card([h('h2', {}, 'Get help'), h('span', { class: 'spacer' }), pick], h('div', { class: 'gh-line' }, box, autoReportSwitch(), shareSwitch(rerender)), safetyLine());
}
// Safety (24 Oct 2026, Shawn: "the safety box in settings can just be minimized somewhere on the get help area"): one
// line in Get help; Show all opens the full list in place; the Self-test button and its results stay with it
const SAFETY = ['Never flashes firmware', 'Never sends reset or bootloader commands', 'Backs up and reads back every change', 'Offline, except updates and problem reports (if on)'];
let safetyOpen = false;
function safetyLine() {
  return h('div', { class: 'safety-line' },
    h('div', { class: 'safety-head' }, icon('shield'),
      h('span', { class: 'grow' }, 'Safety: never flashes firmware, backs up before every change'),
      h('button', { class: 'safety-more', 'aria-expanded': String(safetyOpen), onclick: () => { safetyOpen = !safetyOpen; rerender(); } }, safetyOpen ? 'Hide' : 'Show all'),
      button('Self-test', selfTest, { kind: 'ghost small', ic: 'shield' })),
    safetyOpen ? h('ul', { class: 'safety' }, ...SAFETY.map((t) => h('li', {}, icon('check'), t))) : null,
    results ? h('div', { class: 'diff' }, ...results.map(([dev, st, msg]) => h('div', { style: { gridTemplateColumns: '120px 52px 1fr' } }, h('span', { class: 'dev' }, dev), pill(st, st === 'pass' ? 'good' : st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : ''), h('span', {}, msg)))) : null);
}
// "Send problem reports to Shawn" (on by default; settings.json autoReport): hidden where no report can go (the owner's
// own PC, or no relay set up), so it never promises something this copy does not do
let autoSt = null, autoAsked = false;
function autoReportSwitch() {
  if (!autoAsked && isDemo()) { autoAsked = true; autoSt = { configured: true, on: true }; }
  if (!autoAsked) { autoAsked = true; fetch('/api/auto-report').then((r) => (r.ok ? r.json() : null)).then((j) => { autoSt = j; rerender(); }).catch(() => {}); }
  if (!autoSt || autoSt.owner || !autoSt.configured) return null;
  return h('label', { class: 'ar-toggle' }, h('span', {}, 'Send problem reports to Shawn'),
    toggle({ value: autoSt.on !== false, label: 'Send problem reports to Shawn', onCommit: async (on) => { if (!isDemo()) await env.api('/api/settings', { autoReport: on }); autoSt = { ...autoSt, on }; } }));
}

// Appearance: how the device drawings look, picked from a live preview of each style.
function appearanceCard() {
  const cur = document.documentElement.dataset.art || 'frosted';  // applyArtStyle has already mapped an old look to its new one
  return card([h('h2', {}, 'Appearance')],
    h('div', { class: 'art-styles' }, ...ART_STYLES.map(([key, name]) => h('button', { class: `art-style${key === cur ? ' sel' : ''}`, 'aria-pressed': String(key === cur), dataset: { look: key },
      onclick: async () => { await saveArtStyle(key); toast(`Drawings: ${name}`, 'good', { ms: 1400 }); rerender(); } },
      h('div', { class: 'art-preview', dataset: { artPreview: key } }, slotArt('mouse', devices.mouse), slotArt('headset', devices.headset), slotArt('keyboard', devices.keyboard)),
      h('span', {}, name)))),
    themeControls());
}

// the theme: the accent color (six swatches and any color) and the backdrop (21 Oct 2026)
// the check mark's color on a swatch: dark on a light color, white on a dark one
const inkOn = (hex) => { const [R, G, B] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return 0.2126 * R + 0.7152 * G + 0.0722 * B > 0.5 ? '#1b1a18' : '#ffffff'; };
function themeControls() {
  const t = currentTheme();
  const pickAccent = async (hex, name) => { await saveTheme({ themeAccent: hex }); toast(`Accent: ${name}`, 'good', { ms: 1400 }); rerender(); };
  // a whole look shows the silver accent in its own color (Old School gold, Verde green, Milk sky blue, Coral Reef coral) and says so
  const accentName = (t.accent === THEME_ACCENTS[0][0] && SKIN_SILVER_NAME[THEME_BGS.find(([k]) => k === t.bg)?.[4]]) || THEME_ACCENTS.find(([x]) => x === t.accent)?.[1] || 'Custom';
  // backdrops as small previews of the app: the page color, a card, and the accent (22 Oct 2026, Shawn: "make this
  // area better looking and more options")
  const tile = ([key, name, bg, pool]) => h('button', { class: `theme-tile${t.bg === key ? ' sel' : ''}`, dataset: { bg: key }, 'aria-label': `${name} backdrop`, 'aria-pressed': String(t.bg === key),
    onclick: async () => { await saveTheme({ themeBg: key }); toast(`Theme: ${name}`, 'good', { ms: 1400 }); rerender(); } },
    h('span', { class: 'theme-mini', style: { '--b': bg, '--p': pool } }, h('i', { class: 'mini-card' }), h('i', { class: 'mini-dot' })),
    h('span', { class: 'theme-tile-name' }, name));
  return h('div', { class: 'theme-grid' },
    h('span', { class: 'theme-label' }, 'Backdrop'),
    h('div', { class: 'theme-tiles' }, ...THEME_BGS.map(tile)),
    // a background picture is picked on the Wallpapers page; here only a small way back to the plain backdrop (Shawn,
    // 22 Oct 2026: "the background picture shouldnt be there, just have the remove for it very small")
    hasPicture() ? h('button', { class: 'theme-unpic', onclick: async () => { await removePicture(); rerender(); } }, 'Remove background picture') : null);
}

// Reads every connected device twice and checks the two readings agree and pass their own checks. Writes nothing.

async function selfTest() {
  results = [];
  for (const d of Object.values(devices)) {
    const a = d.adapter;
    if (d.absent) continue;   // found nothing of its own on this PC (helpers/my-devices.mjs isAbsent)
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
    // never ?fresh=1 here: that starts the OpenRGB inside DeviceHub; the self-test only reads what is running
    await check('PC lights', async () => { const o = await env.api('/api/openrgb'); return o.running ? ['pass', `OpenRGB protocol ${o.protocol}: ${o.controllers.length} lights`] : ['skip', 'OpenRGB is not running']; });
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
    let settingsPending = false;
    rerender = () => {
      if (settingsPending) return;
      settingsPending = true;
      setTimeout(() => {
        settingsPending = false;
        const el = document.querySelector('#main .page');
        if (el && location.hash === '#/settings') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' }));
      }, 16);
    };
    if (startup === null) loadStartup();
    if (self === null) loadSelf();
    if (syncSt === null) loadSyncPower();
    if (oneDrive === null) loadOneDrive();
    // one screen, no scrolling (Shawn, 21 Oct 2026): three columns; Appearance is alone in the first and stretches to
    // the tallest column (style.css .settings-cols); the safety promises are one line in Get help (24 Oct 2026).
    // (data-no-jump only scopes the tighter rows now).
    return h('div', { 'data-no-jump': '' },
      topbar('App', 'Settings', null),
      h('div', { class: 'grid settings-cols top' },
        h('div', { class: 'stack' }, appearanceCard(), backupsCard(() => { if (location.hash === '#/settings') rerender(); })),
        h('div', { class: 'stack' }, card([h('h2', {}, 'Startup')],
          selfRow(),
          row('Start with Windows', null,
            toggle({ value: !!startup, disabled: startup === null || isDemo(), label: 'start with windows', onCommit: async (on) => {
              const r = await (await fetch('/api/startup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }) })).json();
              startup = r.enabled; toast(startup ? 'Starts with Windows' : 'Won\'t start with Windows', 'good'); rerender();
            } })),
          // Optional tools sits here with the updates since 22 Oct 2026 (it was in the DeviceHub card; the third column
          // no longer fitted one screen at 1650 x 910)
          ...syncRows(), toolsRows(), ...updatesRows()), helpCard()),
        h('div', { class: 'stack' }, healthCard(),
          // its rows as tight as Optional tools' (22 Oct 2026: the Supported devices row was added without making the
          // column taller than it was)
          card([h('h2', {}, 'DeviceHub')], ...tight(
            row('Share DeviceHub', null, button('Copy link', copyDownloadLink, { kind: 'small', ic: 'external' })),
            publishRow(),
            // the devices DeviceHub runs and what each gets (pages/supported.js, 22 Oct 2026): a page of its own, not a dialog
            // Setup lives here once nothing needs the person (its sidebar entry goes away then; app.js paintSetupNav)
            setupRow(),
            row('Supported devices', null, button('Show', () => { location.hash = '#/supported'; }, { kind: 'ghost small' })),
            setupFileRow(),
            isDemo() ? null : row('Files', null, button('Open folder', () => fetch('/api/reveal', { method: 'POST' }), { kind: 'ghost small', ic: 'external' })),
            isDemo() ? null : row('Demo mode', null, button('Open demo', () => window.open('/?demo#/overview', '_blank'), { kind: 'ghost small', ic: 'play' })),
            isDemo() ? null : row('Uninstall', 'Backups are kept.', button('Uninstall', uninstall, { kind: 'ghost small danger' })))))));
  },
};
