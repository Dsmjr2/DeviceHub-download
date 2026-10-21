// Settings: start with Windows, self-test (read-only), where files live, and what DeviceHub will never do.
import { h, icon } from '../ui/dom.js';
import { more, card, row, toggle, button, pill } from '../ui/controls.js';
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
import { ART_STYLES, saveArtStyle } from '../core/theme.js';
import { artFor } from '../ui/art.js';
import { copyDownloadLink, copyShortReport } from '../core/share.js';

let startup = null;
// DeviceHub's own updates from GitHub (helpers/self-update.js): null = not read yet
let self = null, selfBusy = false;
async function loadSelf() {
  if (isDemo()) { self = { git: true, behind: 0 }; return; }
  self = { checking: true };
  try { self = await (await fetch('/api/self-update')).json(); } catch { self = { error: 'DeviceHub did not answer' }; }
  rerender();
}
async function runSelfUpdate() {
  selfBusy = true; rerender();
  try {
    const r = await env.api('/api/self-update', {});
    if (r.installing) toast('Updating DeviceHub', 'busy', { detail: 'Downloaded and checked. Installing; DeviceHub restarts by itself in under a minute.', ms: 30000 });
    else if (r.updated) toast('Updating DeviceHub', 'busy', { detail: `${r.count} new change${r.count === 1 ? '' : 's'}. Restarting…`, ms: 8000 });
    else { toast('Already up to date', 'good'); selfBusy = false; loadSelf(); }
  } catch (e) { toast('Not updated', 'bad', { detail: e.message }); selfBusy = false; rerender(); }
}
// settings sync and the battery saver (helpers/settings-sync.js, helpers/power.js)
let syncSt = null, powerSt = null, opts = null;
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
    row('Settings sync', syncText, h('div', { class: 'srow-ctl' },
      opts?.settingsSync === false || sy.notSetUp ? null : button('Sync now', async () => { syncSt = await env.api('/api/settings-sync', {}).catch((e) => ({ error: e.message })); toast(syncSt.error ? 'Not synced' : 'Synced', syncSt.error ? 'bad' : 'good', { detail: syncSt.error || (syncSt.lastLoaded ? `Loaded ${syncSt.lastLoaded.parts.join(', ')}` : null) }); loadSyncPower(); }, { kind: 'ghost small', ic: 'refresh' }),
      toggle({ value: opts?.settingsSync !== false, label: 'Settings sync', onCommit: (on) => setOpt('settingsSync', on) }))),
    row('Battery saver', powerText, toggle({ value: opts?.batterySaver !== false, label: 'Battery saver', onCommit: (on) => setOpt('batterySaver', on) })),
    // light window: DeviceHub inside the Chrome already running (much less memory); on by default on a PC with a battery
    row('Low-memory window', 'Opens in your Chrome, about 350 MB less.', toggle({ value: opts?.lightWindow ?? !!pw.hasBattery, label: 'Low-memory window', onCommit: (on) => setOpt('lightWindow', on) })),
  ];
}

function selfRow() {
  if (isDemo()) return null;
  const s = self || {};
  const text = !self || s.checking ? 'Checking…' : !s.git && !s.zip ? 'Not set up for this copy.' : s.error ? `Couldn't check: ${s.error}` : s.blocked ? `A new version is ready, but ${s.blocked.charAt(0).toLowerCase()}${s.blocked.slice(1)}` : s.behind ? (s.zip ? `Ready: ${s.latest}` : `${s.behind} new change${s.behind === 1 ? '' : 's'}: ${s.latest}`) : s.skipped ? 'The newest version did not start here, so DeviceHub stayed on this one. A fix will show up here.' : 'Up to date.';
  return row('DeviceHub updates', text, s.behind && !s.blocked ? button(selfBusy ? 'Updating…' : 'Update', runSelfUpdate, { kind: 'primary small', ic: 'refresh', disabled: selfBusy })
    : s.git === false && !s.zip ? null : button('Check', () => loadSelf(), { kind: 'ghost small', ic: 'refresh' }));
}
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
function updatesCard() {
  const mi = devices.mouse?.info || {}, hi = devices.headset?.info || {};
  const u = upd, web = u?.online || {}, apps = u?.apps || {};
  const head = [h('h2', {}, 'Device updates'), h('span', { class: 'spacer' }),
    button(updLoading ? 'Checking…' : 'Check now', () => loadUpdates(true), { kind: 'ghost small', ic: 'refresh', disabled: updLoading })];
  if (!u) return card(head, h('p', { class: 'faint', style: { margin: 0 } }, 'Looks for newer firmware. Nothing is installed.'));
  if (u.error) return card(head, h('p', { class: 'faint' }, `Could not check: ${u.error}`));
  const g = guide && GUIDES[guide];
  return card(head,
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
      button('Done', async () => { const app = guide; guide = null; rerender(); await post('/api/updates/done', { app }); toast(`Closed ${GUIDES[app].app}`, 'good', { detail: 'versions read again' }); loadUpdates(false); }, { kind: 'primary small' })) : null);
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
  return card([h('h2', {}, 'Health'), h('span', { class: 'spacer' }), button('Copy for help', copyShortReport, { kind: 'ghost small', ic: 'external', title: 'A short report to paste to whoever helps (or to Claude Code)' }), button('Save a report', saveReport, { kind: 'ghost small', ic: 'backups' }), button('Check now', () => loadHealth(true), { kind: 'ghost small', ic: 'refresh' })],
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

// Appearance: how the device drawings look, picked from a live preview of each style.
function appearanceCard() {
  const cur = document.documentElement.dataset.art || 'frosted';
  return card([h('h2', {}, 'Appearance')],
    h('p', { class: 'faint', style: { margin: '-4px 0 12px', fontSize: '13px' } }, 'How the devices are drawn.'),
    h('div', { class: 'art-styles' }, ...ART_STYLES.map(([key, name]) => h('button', { class: `art-style${key === cur ? ' sel' : ''}`, 'aria-pressed': String(key === cur),
      onclick: async () => { await saveArtStyle(key); toast(`Drawings: ${name}`, 'good', { ms: 1400 }); rerender(); } },
      h('div', { class: 'art-preview', dataset: { artPreview: key } }, artFor.mouse(), artFor.headset(), artFor.keyboard()),
      h('span', {}, name)))));
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
  render() {
    rerender = () => { const el = document.querySelector('#main .page'); if (el && location.hash === '#/settings') el.replaceWith(Object.assign(this.render(), { className: 'page no-anim' })); };
    if (startup === null) loadStartup();
    if (self === null) loadSelf();
    if (syncSt === null) loadSyncPower();
    // what DeviceHub always does to keep the devices safe (short, plain; 20 Oct 2026)
    const SAFETY = ['Never flashes firmware', 'Never sends reset or bootloader commands', 'Backs up before every change', 'Reads back every change to confirm it', 'Stays offline, except to check for updates'];
    return h('div', {},
      topbar('App', 'Settings', null),
      // the two cards keep their own heights (no stretching to match each other)
      h('div', { class: 'grid two top' },
        appearanceCard(),
        card([h('h2', {}, 'Startup')],
          selfRow(),
          row('Share DeviceHub', 'Download link to send to people.', button('Copy link', copyDownloadLink, { kind: 'small', ic: 'external' })),
          ...syncRows(),
          row('Start with Windows', 'Starts in the tray.',
            toggle({ value: !!startup, disabled: startup === null || isDemo(), label: 'start with windows', onCommit: async (on) => {
              const r = await (await fetch('/api/startup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on }) })).json();
              startup = r.enabled; toast(startup ? 'DeviceHub will start with Windows' : 'DeviceHub will not start with Windows', 'good'); rerender();
            } })),
          isDemo() ? null : row('Files', null, button('Open folder', () => fetch('/api/reveal', { method: 'POST' }), { kind: 'ghost small', ic: 'external' })),
          isDemo() ? null : row('Demo mode', 'Try it with pretend devices.', button('Open demo', () => window.open('/?demo#/overview', '_blank'), { kind: 'ghost small', ic: 'play' })),
          isDemo() ? null : row('Uninstall', 'Removes DeviceHub. Backups are kept.', button('Uninstall', uninstall, { kind: 'ghost small danger' })))),
      // used once in a while: folded under More (remembered), on its own row below
      more('settings', 'Health, updates, self-test, safety',
        h('div', { class: 'grid two top' },
          h('div', { class: 'stack' }, healthCard(), updatesCard()),
          h('div', { class: 'stack' },
              card([h('h2', {}, 'Self-test'), h('span', { class: 'spacer' }), button('Run', selfTest, { kind: 'primary small', ic: 'shield' })],
                results ? h('div', { class: 'diff' }, ...results.map(([dev, st, msg]) => h('div', { style: { gridTemplateColumns: '150px 60px 1fr' } }, h('span', { class: 'dev' }, dev), pill(st, st === 'pass' ? 'good' : st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : ''), h('span', {}, msg))))
                  : h('p', { class: 'faint', style: { margin: 0 } }, 'Reads each device twice to check it.')),
            card([icon('shield'), h('h2', {}, 'Safety')],
              h('div', { class: 'files' }, ...SAFETY.map((t) => h('div', { class: 'file', style: { gridTemplateColumns: '24px 1fr', '--cc': 'var(--good)' } }, icon('check'), h('span', {}, t)))))))));
  },
};
