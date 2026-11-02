// An added device's page draws the proper buttons (1 Nov 2026, Shawn: "show the proper buttons"): DPI stages together in
// one card (pages/my-device.js stagesCard), Windows' pointer card on every mouse's page and, with no mouse page, on the
// PC page (ui/pointer-card.js). Run: node tests/device-page-layout.mjs
import fs from 'node:fs';
import { tileOrder, dpiInUse } from '../public/core/tile-order.js';
import { btBatteryFor } from '../public/core/headset-pick.js';
import { stageKeys, groupOf, GROUPS } from '../public/pages/my-device.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// the Razer driver's own settings (device-library/razer-mouse/device.mjs allSettings): five stage sliders, the active one
const razer = [{ key: 'dpi', type: 'slider' }, { key: 'pollingRate', type: 'choice' }, { key: 'dpiStage', type: 'slider' },
  ...[1, 2, 3, 4, 5].map((i) => ({ key: `dpiStage${i}`, type: 'slider' })), { key: 'scrollAccel', type: 'toggle' }];
const k = stageKeys(razer);
check(k.size === 6 && k.has('dpiStage') && k.has('dpiStage5') && !k.has('dpi') && !k.has('pollingRate'), `Razer: the five stages and the active one go in the stages card (${[...k]})`);
check(stageKeys([{ key: 'dpiStage', type: 'choice' }, { key: 'dpi', type: 'slider' }]).size === 0, 'Logitech (a stage choice, no per-stage DPI): stays a row of chips, no stages card');
check(stageKeys([{ key: 'dpiStage1', type: 'slider' }]).size === 0, 'a single stage is no table: left as it is');
check(stageKeys([{ key: 'dpiStage1', type: 'slider' }, { key: 'dpiStage2', type: 'slider' }]).size === 2, 'stages with no active setting: still one card');

// ASUS: dpi1..dpi4 and "DPI stages in use"
const asus = stageKeys([{ key: 'dpi1', type: 'slider' }, { key: 'dpi2', type: 'slider' }, { key: 'stageCount', type: 'choice' }, { key: 'pollingRate', type: 'choice' }]);
check(asus.size === 3 && asus.has('stageCount') && !asus.has('pollingRate'), `ASUS: dpi1..n and stages in use go in the card (${[...asus]})`);

// groups: the keys the library drivers use, each in its place; a driver's own group wins
const g = (key, extra = {}) => groupOf({ key, ...extra });
check(['dpi', 'pollingRate', 'reportRate', 'liftOff', 'angleSnap', 'onboardProfile'].every((k) => g(k) === 'tracking'), 'tracking keys');
check(['lockWinKey', 'gameMode', 'fnSwap', 'debounceTime'].every((k) => g(k) === 'keys'), 'keyboard keys');
check(['sidetone', 'sidetoneLevel', 'micMute', 'chatmix', 'noiseGate', 'eqPreset'].every((k) => g(k) === 'sound'), 'sound keys');
check(['autoOff', 'sleepTimer', 'idle', 'lowBattery'].every((k) => g(k) === 'power'), 'power keys');
check(['brightness', 'brightnessLogo', 'dongleLed', 'macroLed', 'backlightOff', 'logo'].every((k) => g(k) === 'lights'), 'light keys');
check(g('anything', { type: 'color' }) === 'lights' && g('dpi', { group: 'power' }) === 'power' && g('virtuoso') === 'other', 'a colour is a light; the driver\'s own group wins; the rest is More');
check(GROUPS[0][1] === 'Performance', 'the first group reads Performance (keyboards and headsets have report rates too)');

// an added device's Overview tile leads with what its kind's page leads with (public/core/tile-order.js)
const first3 = (kind, keys) => tileOrder(kind, keys.map((key) => ({ key }))).slice(0, 3).map((s) => s.key).join();
check(first3('Mouse', ['idle', 'lowBattery', 'dpiStage1', 'dpiStage2', 'pollingRate', 'dpi', 'liftOff']) === 'dpi,pollingRate,liftOff', 'mouse tile: DPI, polling, lift-off; never a stage slider');
check(first3('Keyboard', ['mode', 'lockWinKey', 'brightness', 'reportRate', 'gameMode']) === 'reportRate,brightness,gameMode', 'keyboard tile: report rate, lights, game mode');
check(first3('Headset', ['autoOff', 'eqPreset', 'sidetone', 'chatmix']) === 'sidetone,chatmix,autoOff', 'headset tile: sidetone, ChatMix, auto-off');
check(first3('Lights', ['b', 'a', 'c']) === 'b,a,c', 'another kind: the driver\'s own order');

// a Bluetooth headset run as a generic one gets Windows' battery level (public/core/headset-pick.js btBatteryFor)
const bt = [{ name: 'Shawn’s AirPods Pro #2', connected: true, battery: 80 }, { name: 'WH-1000XM4', connected: false, battery: 60 }, { name: 'Xbox Wireless Controller', connected: true, battery: 95 }];
check(btBatteryFor(bt, 'Headset (Shawn’s AirPods Pro #2 - Find My Hands-Free)')?.percent === 80, 'AirPods: the level Windows shows, matched through the sound device\'s long name');
check(btBatteryFor(bt, 'WH-1000XM4') === null, 'a disconnected device\'s kept level is not used');
check(btBatteryFor(bt, 'Arc') === null && btBatteryFor(bt, 'Arctis Nova 7') === null, 'a short or unknown name matches nothing');
check(/if \(mode === 'generic'\) return generic\?\.bt \? btBatteryFor\(await btList\(\), generic\.device\) : null;/.test(src('public/devices/headset-adapter.js')), 'the generic headset\'s battery() asks it, for a Bluetooth headset only');

const page = src('public/pages/my-device.js');
// the figures at the top of an added device's page (heroStats): battery, then readings in the tile's order
check(/return h\('div', \{\}, head, awayBanner\(d\), heroStats\(d\), turnOnBanner/.test(page) && /for \(const x of tileOrder\(a\.kind \|\| '', list\)\)/.test(page) && /if \(out\.length >= 5\) break;/.test(page), 'an added device\'s page leads with its battery and up to four readings, in the tile\'s order');
// the DPI in use (a review, 1 Nov 2026: ASUS reports dpi1..4 and no dpi; ROCCAT dpiStage and no dpi)
check(dpiInUse({ dpi: 1600, dpi1: 800 }) === 1600, 'its own dpi first');
check(dpiInUse({ dpiStage: 2, dpiStage1: 800, dpiStage2: 1600 }) === 1600 && dpiInUse({ dpiStage: 3, dpi3: 3200 }) === 3200, 'else the stage in use');
check(dpiInUse({ dpi1: 400, dpi2: 800, stageCount: 2 }) === 400, 'ASUS (stages, none marked in use): its first stage');
check(dpiInUse({ pollingRate: 1000 }) === null, 'none reported: nothing');
check(/const list = dpiNow != null && !settings\.some\(\(x\) => x\.key === 'dpi'\)/.test(page) && /if \(v\.dpi == null\) \{ const x = dpiInUse\(v\); if \(x != null\) v\.dpi = x; \}/.test(src('public/pages/overview.js')), 'the page figures and the tile both lead with it');
// the pointer card's read redraws every page that asked meanwhile
check(/if \(waiting\) \{ waiting\.add\(redraw\); return; \}/.test(src('public/ui/pointer-card.js')) && /for \(const r of all\) r\(\);/.test(src('public/ui/pointer-card.js')), 'every page waiting on the pointer read is redrawn');
check(/d\.battery\?\.percent != null \? null : batteryPill\(d\)/.test(page), 'the battery is not shown twice');
check(/settingsList\(d, shown\.filter\(\(s\) => !staged\.has\(s\.key\)\)\)/.test(page) && /if \(by\.size <= 1\) return list\.map/.test(page), 'the settings card is grouped, with no heading when there is one group');
check(/staged\.size \? stagesCard\(d, shown\) : null/.test(page), 'the stage settings leave the settings list for the stages card');
check(/\/mouse\/i\.test\(a\.kind \|\| ''\) \? pointerCard\(/.test(page), 'every added mouse page has the Windows pointer card');
check(/import \{ pointerCard \} from '\.\.\/ui\/pointer-card\.js'/.test(src('public/pages/mouse.js')) && !/function pointerCard/.test(src('public/pages/mouse.js')), 'the Pulsar page uses the same card');
check(/shownDevices\(\)\.some\(\(x\) => x\.id === 'mouse' \|\| \/mouse\/i\.test\(x\.adapter\?\.kind \|\| ''\)\) \? null : h\('div', \{ class: 'grid two top' \}, pointerCard\(rerender\)\)/.test(src('public/pages/fans.js')), 'with no mouse page, the PC page has it');

if (fails.length) { console.log(`device-page-layout: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('device-page-layout (DPI stages in one card, the pointer card for every mouse): all good');
