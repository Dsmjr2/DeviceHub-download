// The Setup page's checklist (22 Oct 2026; public/core/setup-list.js, public/pages/setup.js): each thing found gets
// one row with a plain status and at most one action, Do all takes only the safe steps in order, and the counts the
// Overview's short card shows add up. Pure functions on pretend answers; nothing is opened or sent.
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

const rows = L.deviceRows(D.DEMO_SUMMARY, { live: D.DEMO_LIVE, diag: D.DEMO_DIAG, layouts: { '3434:0610': { source: true, have: false } }, isVia });
check(rows.every((r) => ['done', 'needs', 'optional', 'none'].includes(r.status)), 'every row has one of the four statuses');
check(rows.every((r) => !r.action || typeof r.action.kind === 'string'), 'at most one action per row');
check(new Set(rows.map((r) => r.key)).size === rows.length, 'row keys are unique');
check(!rows.some((r) => r.key === 'bluetooth' || r.key === 'lamparrays'), 'Bluetooth and Dynamic Lighting go to their own parts');
check(by(rows, 'mouse')?.status === 'done' && by(rows, 'mouse').driver === "DeviceHub's own driver", 'a built-in device is done, on its own driver');
check(by(rows, 'demo-razer')?.action?.kind === 'turn-on' && by(rows, 'demo-razer').status === 'needs', 'a connected driver waiting for Turn on settings needs you, with Turn on');
const aerox = by(rows, 'demo-aerox');
check(aerox?.action?.kind === 'close-app' && aerox.action.app === 'gg' && aerox.status === 'needs', "a device held by its maker's app gets the close action");
check(by(rows, 'demo-learned')?.driver === 'Learned on this PC' && by(rows, 'demo-learned').action?.kind === 'works', 'a learned driver that works offers Works on my device');
check(by(rows, '258a:1007')?.status === 'none' && by(rows, '258a:1007').action?.kind === 'request', 'a generic receiver is not needed, with Request support');
check(by(rows, 'install:logitech-g502x')?.action?.name === 'logitech-g502x', 'a library driver to install has Install');
check(by(rows, '3434:0610')?.action?.kind === 'get-layout', 'a VIA keyboard with a known layout file gets Get the layout');
check(by(rows, '1038:1824')?.action?.kind === 'learn' && by(rows, '1038:1824').action.vid === '1038', 'any other device gets Learn it with its ids');
check(by(rows, '1b1c:1b8b')?.action?.kind === 'request', 'a device with too-big messages gets Request support');
check(by(rows, 'unknown')?.status === 'optional', 'other USB devices are optional');

// the live device wins over the summary (kept a minute by the server): settings turned on = done
const after = L.deviceRows(D.DEMO_SUMMARY, { live: { ...D.DEMO_LIVE, 'demo-razer': { ...D.DEMO_LIVE['demo-razer'], turnOn: false } }, isVia });
check(by(after, 'demo-razer')?.status === 'done', 'settings turned on: the row is done');
// a waiting driver that is not connected and has no maker's app: needs you, no button
check(by(L.deviceRows(D.DEMO_SUMMARY, { live: D.DEMO_LIVE, isVia }), 'demo-aerox')?.action === undefined, 'not connected, no app: no button');
// the layout file already there: restart, no button
check(by(L.deviceRows(D.DEMO_SUMMARY, { live: D.DEMO_LIVE, layouts: { '3434:0610': { source: true, have: true } }, isVia }), '3434:0610')?.action === undefined, 'layout file there: no button');
// no summary: the window's own devices still show
const noSum = L.deviceRows(null, { live: { mouse: { title: 'Mouse X', kind: 'Mouse', status: 'connected', seen: true }, keyboard: { title: 'K', status: 'idle' }, mine: { title: 'Mine', plugin: true, status: 'connected' } } });
check(by(noSum, 'mouse') && !by(noSum, 'keyboard') && by(noSum, 'mine')?.driver === 'Your own driver (my-devices folder)', 'without the summary: seen built-ins and added devices');

// Do all: installs, then Turn on settings for all, then layouts; never a close or a learn
const steps = L.doAllSteps(rows);
check(steps.map((s) => s.kind).join(',') === 'install,turn-on-all,get-layout', `Do all order (${steps.map((s) => s.kind)})`);
check(!steps.some((s) => s.kind === 'close-app' || s.kind === 'learn'), 'Do all never closes an app or learns');
check(L.doAllSteps([{ key: 'x', status: 'optional', action: { kind: 'install', name: 'x' } }]).length === 0, 'Do all leaves optional installs alone');
check(L.doAllSteps([]).length === 0, 'Do all: nothing to do');

// the other parts
const s1 = L.soundRows({ installed: false }, null);
check(s1.length === 1 && s1[0].action.kind === 'tool' && s1[0].status === 'optional', 'Equalizer APO not installed: Install');
const s2 = L.soundRows({ installed: true, version: '1.4.2' }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [{ name: 'HS80 Wireless' }] });
check(s2[1]?.status === 'needs' && s2[1].action.kind === 'eq-on', 'Equalizer APO not on for the headset: Turn it on');
check(L.soundRows({ installed: true }, { engine: 'eqapo', headsetModel: 'HS80', notOn: [] })[1]?.status === 'done', 'Equalizer APO on for the headset: done');
check(L.lightRows({ running: false, bundle: { canStart: true, version: '1.1' } }, null)[0].action.kind === 'find-lights', 'OpenRGB inside DeviceHub: Find lights');
check(L.lightRows({ running: true, controllers: [{}, {}] }, null)[0].status === 'done', 'lights found: done');
check(L.lightRows(null, D.DEMO_SUMMARY).some((r) => r.key === 'lamparrays'), 'Dynamic Lighting shows under Lights');
check(L.batteryRows([{ name: 'A', connected: true, battery: 50 }, { name: 'B', connected: false, battery: 90 }]).length === 1, 'only connected batteries');
check(L.batteryRows([])[0].status === 'none', 'no batteries: not needed');
check(L.learnRows({ installed: false }, rows)[0]?.action?.kind === 'tool', 'USBPcap offered when a device needs learning');
check(L.learnRows({ installed: false }, [by(rows, 'mouse')]).length === 0, 'USBPcap hidden when nothing needs learning');
check(L.helpRows({ owner: true })[0].status === 'none' && !L.helpRows({ owner: true })[0].action, "no reports switch on Shawn's own PC");
check(L.helpRows({ configured: true, on: false })[0].action?.kind === 'reports', 'the reports switch where reports can go');

check(L.countNeeds(rows) === 5, `needs counted (${L.countNeeds(rows)})`);
check(L.summaryLine(3) === '3 things need you' && L.summaryLine(1) === '1 thing needs you' && L.summaryLine(0) === 'Nothing needs you', 'summary line');

if (fails.length) { console.log(`setup page: ${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('setup page: all good');
