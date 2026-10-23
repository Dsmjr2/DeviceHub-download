// The Setup page's checklist (22 Oct 2026; public/core/setup-list.js, public/pages/setup.js): each thing found gets
// one row with a plain status and at most one action, Set it all up takes only the safe steps in order, the page shows
// only what needs the person (planSetup) with the rest folded, and the counts the Overview's one-line card shows add
// up. Pure functions on pretend answers; nothing is opened or sent.
// Run: node tests/setup-page.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(ROOT, 'public/core/setup-list.js')).href);
const D = await import(pathToFileURL(path.join(ROOT, 'public/core/setup-demo.js')).href);

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const by = (rows, key) => rows.find((r) => r.key === key);
const isVia = (usb) => String(usb).startsWith('3434:');

// every kind of device row (the demo shows a calmer PC)
const KINDS = {
  works: [
    ...D.DEMO_SUMMARY.works.filter((i) => i.what !== 'library' || i.page !== 'demo-aerox'),
    { what: 'library', name: 'steelseries-mouse', title: 'SteelSeries Aerox 3', page: 'demo-aerox', state: 'one-click', short: 'Connect it, then turn on its settings.' },
  ],
  learn: [
    { what: 'library-untested', name: 'logitech-g502x', title: 'Logitech G502 X', state: 'one-click', short: 'Install it.', action: { kind: 'library-install', name: 'logitech-g502x' } },
    { what: 'learn', usb: '3434:0610', title: 'Keychron Q1 Pro', state: 'not-yet', short: 'No driver yet.' },
    { what: 'learn', usb: '1038:1824', title: 'SteelSeries Rival 3', state: 'not-yet', short: 'No driver yet.' },
    ...D.DEMO_SUMMARY.learn,
  ],
  optional: D.DEMO_SUMMARY.optional,
};
const LIVE = { ...D.DEMO_LIVE, 'demo-aerox': { ...D.DEMO_LIVE['demo-aerox'], turnOn: true } };

const rows = L.deviceRows(KINDS, { live: LIVE, diag: D.DEMO_DIAG, layouts: { '3434:0610': { source: true, have: false } }, isVia });
check(rows.every((r) => ['done', 'needs', 'optional', 'none'].includes(r.status)), 'every row has one of the four statuses');
check(rows.every((r) => !r.action || typeof r.action.kind === 'string'), 'at most one action per row');
check(new Set(rows.map((r) => r.key)).size === rows.length, 'row keys are unique');
check(!rows.some((r) => r.key === 'bluetooth' || r.key === 'lamparrays'), 'Bluetooth and Dynamic Lighting go to their own parts');
check(by(rows, 'mouse')?.status === 'done' && by(rows, 'mouse').line === 'Ready.', 'a built-in device is done: "Ready."');
check(by(rows, 'demo-razer')?.action?.kind === 'turn-on' && by(rows, 'demo-razer').status === 'needs', 'a connected driver waiting for Turn on settings needs you, with Turn on');
check(by(rows, 'demo-razer')?.line === 'Turn on settings to change it.', 'Turn on settings: one short line');
const aerox = by(rows, 'demo-aerox');
check(aerox?.action?.kind === 'close-app' && aerox.action.app === 'gg' && aerox.status === 'needs', "a device held by its maker's app gets the close action");
check(aerox?.line === 'Close SteelSeries GG first.', `maker's app: "Close SteelSeries GG first." (${aerox?.line})`);
check(by(rows, 'demo-learned')?.action?.kind === 'works', 'a learned driver that works offers Works on my device');
check(by(rows, '258a:1007')?.status === 'none', 'a generic receiver is not needed');
check(by(rows, 'install:logitech-g502x')?.action?.name === 'logitech-g502x', 'a library driver to install has Install');
check(by(rows, '3434:0610')?.action?.kind === 'get-layout', 'a VIA keyboard with a known layout file gets Get the layout');
check(by(rows, '1038:1824')?.action?.kind === 'learn' && by(rows, '1038:1824').action.vid === '1038', 'any other device gets Learn it with its ids');
check(by(rows, '1b1c:1b8b')?.action?.kind === 'request', 'a device with too-big messages gets Request support');
check(by(rows, 'unknown')?.status === 'optional', 'other USB devices are optional');
// plain words: no driver jargon in any line, every line short
const JARGON = /driver from|own driver|DDC\/CI|SMBus chip|device library|my-devices/i;
check(!rows.some((r) => JARGON.test(r.line)), `no driver jargon (${rows.filter((r) => JARGON.test(r.line)).map((r) => r.line)})`);
check(rows.every((r) => r.status === 'none' || r.line.length <= 80), `every line is short (${rows.filter((r) => r.line.length > 80).map((r) => r.key)})`);

// the live device wins over the summary (kept a minute by the server): settings turned on = done
const after = L.deviceRows(KINDS, { live: { ...LIVE, 'demo-razer': { ...LIVE['demo-razer'], turnOn: false } }, isVia });
check(by(after, 'demo-razer')?.status === 'done', 'settings turned on: the row is done');
// a waiting driver that is not connected and has no maker's app: needs you, no button
check(by(L.deviceRows(KINDS, { live: LIVE, isVia }), 'demo-aerox')?.action === undefined, 'not connected, no app: no button');
// the layout file already there: restart, no button
check(by(L.deviceRows(KINDS, { live: LIVE, layouts: { '3434:0610': { source: true, have: true } }, isVia }), '3434:0610')?.action === undefined, 'layout file there: no button');
// no summary: the window's own devices still show
const noSum = L.deviceRows(null, { live: { mouse: { title: 'Mouse X', kind: 'Mouse', status: 'connected', seen: true }, keyboard: { title: 'K', status: 'idle' }, mine: { title: 'Mine', plugin: true, status: 'connected' } } });
check(by(noSum, 'mouse') && !by(noSum, 'keyboard') && by(noSum, 'mine')?.driver === 'own', 'without the summary: seen built-ins and added devices');

// Set it all up: installs, then Turn on settings for all, then layouts; never a close or a learn
const steps = L.doAllSteps(rows);
check(steps.map((s) => s.kind).join(',') === 'install,turn-on-all,get-layout', `Set it all up order (${steps.map((s) => s.kind)})`);
check(!steps.some((s) => s.kind === 'close-app' || s.kind === 'learn'), 'Set it all up never closes an app or learns');
check(L.doAllSteps([{ key: 'x', status: 'optional', action: { kind: 'install', name: 'x' } }]).length === 0, 'Set it all up leaves optional installs alone');
check(L.doAllSteps([]).length === 0, 'Set it all up: nothing to do');

// the other parts
const s1 = L.soundRows({ installed: false }, null);
check(s1.length === 1 && s1[0].action.kind === 'tool' && s1[0].status === 'optional', 'Equalizer APO not installed: Install');
const s2 = L.soundRows({ installed: true, version: '1.4.2' }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [{ name: 'HS80 Wireless' }] });
check(s2[1]?.status === 'needs' && s2[1].action.kind === 'eq-on', 'Equalizer APO not on for the headset: Turn it on');
check(L.soundRows({ installed: true }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [] })[1]?.status === 'done', 'Equalizer APO on for the headset: done');
check(!s2.some((r) => r.key === 'eq-reset' || r.action?.kind === 'eq-reset'), 'Reset sound to normal is not on Setup (Headset page only)');
check(L.lightRows({ running: false, bundle: { canStart: true, version: '1.1' } }, null)[0].action.kind === 'find-lights', 'OpenRGB inside DeviceHub: Find lights');
check(L.lightRows({ running: true, controllers: [{}, {}] }, null)[0].status === 'done', 'lights found: done');
check(L.lightRows({ running: true, controllers: [{}] }, null).length === 1, 'lights found: one row');
check(L.lightRows(null, D.DEMO_SUMMARY).some((r) => r.key === 'lamparrays'), 'Dynamic Lighting shows under Lights');
{ const r = L.lightRows({ running: true, controllers: [] }, null, { verdict: { kind: 'smbus' } })[0]; check(r.status === 'needs' && /SMBus/.test(r.line), 'no lights on an SMBus board: needs you, says why'); }
{ const r = L.lightRows({ running: true, controllers: [] }, null, { verdict: { kind: 'none' } })[0]; check(r.status === 'none' && /3-pin/.test(r.line), 'no lighting controller: not needed, says why'); }
check(L.batteryRows([{ name: 'A', connected: true, battery: 50 }, { name: 'B', connected: false, battery: 90 }]).length === 1, 'only connected batteries');
check(L.batteryRows([])[0].status === 'none', 'no batteries: not needed');
check(L.learnRows({ installed: false }, rows)[0]?.action?.kind === 'tool', 'USBPcap offered when a device needs learning');
check(L.learnRows({ installed: false }, [by(rows, 'mouse')]).length === 0, 'USBPcap hidden when nothing needs learning');
check(L.helpRows === undefined, 'the problem reports switch and Get help are not on Setup (Settings has them)');

check(L.countNeeds(rows) === 5, `needs counted (${L.countNeeds(rows)})`);
check(L.summaryLine(3) === '3 things need you' && L.summaryLine(1) === '1 thing needs you' && L.summaryLine(0) === 'All set', 'summary line');

// what the page shows: only needs in the main list, in the order to do them; devices as tiles; the rest folded
const all = [...rows, ...L.soundRows({ installed: true }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [{ name: 'HS80 Wireless' }] }), ...L.lightRows({ running: true, controllers: [] }, null, { verdict: { kind: 'none' } }), ...L.batteryRows([])];
const plan = L.planSetup(all);
check(plan.needs.every((r) => r.status === 'needs') && plan.needs.length === L.countNeeds(all), 'the main list is every row that needs you, and only those');
check(plan.needs.map((r) => r.action?.kind || 'none').join(',') === 'install,turn-on,get-layout,close-app,eq-on,learn', `needs in the order to do them (${plan.needs.map((r) => r.action?.kind)})`);
check(!Object.values(plan).flat().some((r) => r.status === 'none'), 'not needed rows are hidden');
check(plan.extras.every((r) => r.status === 'optional') && plan.done.every((r) => r.status === 'done'), 'Optional extras and Everything that is done hold their own rows');
check(plan.devices.every((r) => r.device) && plan.devices.some((r) => r.key === 'mouse') && plan.devices.some((r) => r.key === 'demo-razer'), 'devices strip: the devices that are done or need you');
check(!plan.devices.some((r) => r.key === 'unknown' || r.key === '1b1c:1b8b'), 'optional device rows are not tiles');

// the demo: 2 things need you, one of them a safe step
{
  const demoRows = [...L.deviceRows(D.DEMO_SUMMARY, { live: D.DEMO_LIVE, diag: D.DEMO_DIAG, isVia }), ...L.soundRows(D.DEMO_TOOLS[0], D.DEMO_EQ), ...L.lightRows(D.DEMO_ORGB, D.DEMO_SUMMARY), ...L.batteryRows(D.DEMO_BT)];
  const p = L.planSetup(demoRows);
  check(p.needs.length === 2, `demo: 2 things need you (${p.needs.map((r) => r.key)})`);
  check(L.doAllSteps(demoRows).map((s) => s.kind).join(',') === 'turn-on-all', 'demo: Set it all up turns on settings, the app close waits for its own click');
}
// Shawn's PC: nothing needs him, so the page says All set and shows no button
{
  const shawn = [...L.deviceRows({ works: D.DEMO_SUMMARY.works.filter((i) => ['mouse', 'headset', 'keyboard', 'monitors', 'cameras'].includes(i.what)) }, {}), ...L.soundRows({ installed: true }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [] }), ...L.lightRows({ running: false, bundle: { canStart: true } }, null), ...L.batteryRows([])];
  const p = L.planSetup(shawn);
  check(p.needs.length === 0 && L.summaryLine(p.needs.length) === 'All set' && L.doAllSteps(shawn).length === 0, 'nothing needs you: All set, no button');
  check(p.done.length === 7 && p.extras.length === 1, `nothing needs you: the rest folds (${p.done.length} done, ${p.extras.length} optional)`);
}

// ---------- first start (public/core/first-run.js): Setup opens by itself only the first time, never on Shawn's PC ----------
{
  const F = await import(pathToFileURL(path.join(ROOT, 'public/core/first-run.js')).href);
  const fresh = { settings: {}, profiles: [], devices: [{ id: 'mouse', seen: false }, { id: 'headset' }, { id: 'keyboard' }], hash: '' };
  check(F.isFirstStart(fresh) === true, 'first start: a new PC opens Setup');
  check(F.isFirstStart({ ...fresh, hash: '#/overview' }) === true, 'first start: #/overview counts as the start');
  check(F.isFirstStart({ ...fresh, settings: { setupSeen: true } }) === false, 'after that: the Overview (setupSeen)');
  check(F.isFirstStart({ ...fresh, hash: '#/mouse' }) === false, 'a page asked for: left there');
  check(F.isFirstStart({ ...fresh, settings: null }) === false && F.isFirstStart({ ...fresh, profiles: null }) === false, 'settings or profiles not read: no guess');
  check(F.isFirstStart({ ...fresh, profiles: [{ name: 'Game' }] }) === false, 'any saved profile: not a first start');
  check(F.isFirstStart({ ...fresh, devices: [{ id: 'demo-razer', seen: true }] }) === false, 'any device seen before: not a first start');
  // Shawn's PC as it is (read 22 Oct 2026): settings without setupSeen (an older copy never wrote it), 3 profiles, his
  // three devices seen
  const shawn = { settings: { autoSwitch: true, defaultProfile: 'Work', artStyle: 'live', ankerGuard: true, themeAccent: '#4ea1ff', themeBg: 'graphite', oneDriveCopy: true }, profiles: [{ name: 'Work' }, { name: 'Game' }, { name: 'Quiet' }], devices: [{ id: 'mouse', seen: true }, { id: 'headset', seen: true }, { id: 'keyboard', seen: true }], hash: '' };
  check(F.isFirstStart(shawn) === false, "Shawn's PC is not a first start");
  check(F.isFirstStart({ ...shawn, profiles: [] }) === false && F.isFirstStart({ ...shawn, devices: [] }) === false, "Shawn's PC: seen devices alone, or profiles alone, are enough");
  // the window's side: what it reads and writes (pretend server; nothing is sent)
  const server = (settings, profiles) => { const posts = []; return { posts, fetch: async (url, o = {}) => { if (o.method === 'POST') { posts.push([url, JSON.parse(o.body)]); return { ok: true, json: async () => ({}) }; } return { ok: true, json: async () => (url === '/api/settings' ? settings : profiles) }; } }; };
  { const s = server({}, []); const r = await F.firstStart({ fetch: s.fetch, devices: fresh.devices }); check(r.setup && s.posts.length === 1 && s.posts[0][0] === '/api/settings' && s.posts[0][1].setupSeen === true && Object.keys(s.posts[0][1]).length === 1, 'first start: Setup, and setupSeen saved (that key only)'); }
  { const s = server(shawn.settings, shawn.profiles); const r = await F.firstStart({ fetch: s.fetch, devices: shawn.devices }); check(!r.setup, "Shawn's PC: the Overview as today"); }
  { const s = server({ setupSeen: true }, []); const r = await F.firstStart({ fetch: s.fetch, devices: fresh.devices }); check(!r.setup && !s.posts.length, 'setupSeen there: nothing opened, nothing saved'); }
  { const s = server({}, []); const r = await F.firstStart({ fetch: s.fetch, devices: fresh.devices, hash: '#/mouse' }); check(!r.setup && !s.posts.length, 'a page asked for: nothing saved, so the real first start still opens Setup'); }
  { const s = server({}, []); const r = await F.firstStart({ fetch: s.fetch, ready: false }); check(!r.setup && !s.posts.length, "the background part not answering yet: no decision"); }
  { const r = await F.firstStart({ fetch: async () => { throw new Error('down'); } }); check(!r.setup && !r.save, 'DeviceHub not answering: the Overview'); }
  { const a = await F.firstStart({ demo: true, search: '?demo' }), b = await F.firstStart({ demo: true, search: '?demo&first' }); check(!a.setup && b.setup && !b.save, 'demo: only with ?demo&first, nothing saved'); }
}

// ---------- one question for the makers' apps inside Set it all up ----------
{
  const held = (id, app, label, title) => ({ key: id, id, title, status: 'needs', device: true, action: { kind: 'close-app', id, app, label, confirm: `${label} now?` } });
  const rowsQ = [held('mouse', 'ghub', 'Close Logitech G HUB', 'Logitech G502 X'), held('kb', 'ghub', 'Close Logitech G HUB', 'Logitech G915'), held('rz', 'synapse', 'Close Razer Synapse', 'Razer Viper'),
    { key: 'demo-razer', id: 'demo-razer', title: 'Razer DeathAdder V3', status: 'needs', action: { kind: 'turn-on', id: 'demo-razer' } }, { ...held('x', 'icue', 'Close iCUE', 'Done one'), status: 'done' }];
  const apps = L.makerApps(rowsQ);
  check(apps.length === 2 && apps[0].app === 'ghub' && apps[0].ids.join() === 'mouse,kb' && apps[1].app === 'synapse', `one entry per app, every device it holds (${apps.map((a) => a.app)})`);
  check(L.askLine(apps) === 'Close G HUB and Synapse so DeviceHub can set your devices up?', `one question, the apps named (${L.askLine(apps)})`);
  check(L.askLine(L.makerApps([held('a', 'gg', 'Close SteelSeries GG', 'Aerox')])) === 'Close SteelSeries GG so DeviceHub can set your device up?', 'one app, one device');
  check(L.askLine(L.makerApps([held('a', 'gg', 'Close SteelSeries GG', 'A'), held('b', 'icue', 'Close iCUE', 'B'), held('c', 'pulsar', 'Close the Pulsar app', 'C')])) === 'Close SteelSeries GG, iCUE and the Pulsar app so DeviceHub can set your devices up?', 'three apps: commas and "and"');
  check(L.makerApps([held('a', 'zzz', 'Close Some App', 'A')])[0].name === 'Some App', 'an app without a short name: its own name');
  check(L.leftLine(apps[1]).join() === 'Razer Viper: left as it is (Synapse is open).', 'Not now: each of its devices left as it is');
  check(!L.doAllSteps(rowsQ).some((s) => s.kind === 'close-app'), 'the close is not a step: it waits for the Yes');
  check(L.makerApps(L.planSetup(rowsQ).needs).length === 2, 'asked from the rows that need you only');
  // the close goes through diagnose's own action: only known makers' apps, never a service or updater, confirm flag
  const Dg = await import(pathToFileURL(path.join(ROOT, 'helpers/diagnose.mjs')).href);
  check(apps.every((a) => Dg.MAKER_APPS[a.app]), 'only known makers\' apps are asked about');
  check(Dg.runningMakers(['lghub.exe', 'lghub_updater.exe', 'LGHUB Service.exe'])[0]?.closable.join() === 'lghub.exe', 'never an updater or a Windows service');
  try { await Dg.action({ kind: 'close-app', app: 'ghub' }); check(false, 'close-app without the confirm flag refuses'); } catch (e) { check(/confirm/.test(e.message), `close-app without the confirm flag refuses (${e.message})`); }
  const page = fs.readFileSync(path.join(ROOT, 'public/pages/setup.js'), 'utf8');
  check(/kind: 'close-app', app: a\.app, confirm: true/.test(page) && /'Yes, close them'/.test(page) && /'Not now'/.test(page), 'the page asks once (Yes, close them / Not now) and closes with the confirm flag');
  // the demo: Set it all up asks about SteelSeries GG first
  const demoRows = L.deviceRows(D.DEMO_SUMMARY, { live: D.DEMO_LIVE, diag: D.DEMO_DIAG, isVia });
  check(L.askLine(L.makerApps(L.planSetup(demoRows).needs)) === 'Close SteelSeries GG so DeviceHub can set your device up?', 'demo: asks about SteelSeries GG');
}

// ---------- "You're all set": each device with what it can do now ----------
{
  check(L.canDo({ id: 'mouse', kind: 'mouse' }, { values: { pollingRate: 4000, dpi0: 800, btn0: 'left' }, battery: true }) === 'DPI, polling, buttons, battery', `mouse from its readings (${L.canDo({ id: 'mouse' }, { values: { pollingRate: 4000, dpi0: 800, btn0: 'left' }, battery: true })})`);
  check(L.canDo({ id: 'mouse', kind: 'mouse' }, { values: { pollingRate: 1, dpi0: 1 }, battery: true }) === 'DPI, polling, battery', 'Pulsar X-Lite: DPI, polling, battery');
  check(L.canDo({ id: 'headset', kind: 'headset' }, { values: { 'vol:playback': 40, 'prop:micEnabled': true, 'prop:equalizerPreset': 2 }, battery: true, lights: true }) === 'volume, mic, EQ, battery and more', 'headset: at most four words, battery last');
  check(L.canDo({ id: 'keyboard', kind: 'keyboard' }, { values: { brightness: 200 }, keys: ['key:'] }) === 'keys, backlight', 'keyboard: keys from its keymap');
  check(L.canDo({ id: 'mouse', kind: 'mouse' }, null) === 'DPI, polling, buttons', 'a built-in not read yet: what its page has');
  check(L.canDo({ id: 'demo-razer', kind: 'mouse' }, D.DEMO_LIVE['demo-razer']) === 'DPI, polling rate, lights, battery', "an added driver: its own settings list");
  check(L.canDo({ key: 'monitors', kind: 'monitor' }, null) === 'brightness, contrast', 'monitors');
  check(L.canDo({ key: 'x', kind: 'gadget' }, null) === 'Open it to see its settings', 'nothing known: a plain line');
  // Shawn's PC: nothing needs him, every device tile says what it can do
  const shawnRows = L.deviceRows({ works: D.DEMO_SUMMARY.works.filter((i) => ['mouse', 'headset', 'keyboard', 'monitors', 'cameras'].includes(i.what)) }, {});
  const p = L.planSetup(shawnRows);
  check(p.needs.length === 0 && p.devices.length === 5 && p.devices.every((r) => L.canDo(r, null).length > 0 && L.canDo(r, null).length <= 50), "Shawn's PC: 5 tiles, each with a short line");
  const page = fs.readFileSync(path.join(ROOT, 'public/pages/setup.js'), 'utf8');
  check(page.includes("\"You're all set\"") && page.includes("'Open a device to change its settings.'"), "the done view's title and its one line");
  // the demo after Set it all up (Yes): nothing needs you, so the done view shows
  const after = L.deviceRows(D.DEMO_SUMMARY, { live: { ...D.DEMO_LIVE, 'demo-razer': { ...D.DEMO_LIVE['demo-razer'], turnOn: false }, 'demo-aerox': { ...D.DEMO_LIVE['demo-aerox'], status: 'connected' } }, isVia });
  check(L.planSetup(after).needs.length === 0, 'demo: after Yes, close them and Set it all up, nothing needs you');
}

if (fails.length) { console.log(`setup page: ${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('setup page: all good');
