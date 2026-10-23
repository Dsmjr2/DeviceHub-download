// The Setup page's checklist (22 Oct 2026; public/core/setup-list.js, public/pages/setup.js): each thing found gets
// one row with a plain status and at most one action, Set it all up takes only the safe steps in order, the page shows
// only what needs the person (planSetup) with the rest folded, and the counts the Overview's one-line card shows add
// up. Pure functions on pretend answers; nothing is opened or sent.
// Run: node tests/setup-page.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';
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

if (fails.length) { console.log(`setup page: ${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('setup page: all good');
