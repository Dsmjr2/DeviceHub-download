// Why fan lights may be missing (22 Oct 2026; helpers/lights-diagnose.js, docs/handoff/friend-lights-c232.md): stand-in
// /api/pc and OpenRGB answers, never a real OpenRGB or device. Checks the three kinds (USB controller, board SMBus,
// nothing addressable), the plain reason and fix when OpenRGB could not start (kept past the 10 s cache), OpenRGB's id
// table and its sources, and Get help's "lights" area.
// Run: node tests/lights-diagnose.mjs (no hardware, no network, DeviceHub need not run)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { diagnose, openrgbFix, KIND, _test: { TABLE } } = require('../helpers/lights-diagnose.js');

const fails = [];
const check = (cond, what) => { if (!cond) fails.push(what); };

// ---- OpenRGB's table: real ids from its detectors, each with a source line, and the commit it was read at
const ids = TABLE.controllers.map((c) => c.id);
check(/^[0-9a-f]{40}$/.test(TABLE.source.commit) && /codeberg\.org\/OpenRGB\/OpenRGB$/.test(TABLE.source.repo), 'the table names OpenRGB\'s repository and the exact commit');
check(ids.every((x) => /^[0-9a-f]{4}:[0-9a-f]{4}$/.test(x)) && new Set(ids).size === ids.length, 'every id is vid:pid, once');
check(TABLE.controllers.every((c) => /^Controllers\/\w+\/.+\.(cpp|h)#L\d+$/.test(c.source) && ['board', 'hub'].includes(c.kind)), 'every entry names its OpenRGB file and line, and a kind');
for (const [id, name] of [['0b05:18f3', 'ASUS Aura Motherboard'], ['048d:5702', 'Gigabyte RGB Fusion 2 USB'], ['048d:8297', 'Gigabyte RGB Fusion 2 USB'], ['1462:7c56', 'MSI Mystic Light MS_7C56'], ['26ce:01a2', 'ASRock Polychrome USB'], ['1b1c:0c10', 'Corsair Commander Pro'], ['1b1c:0c0b', 'Corsair Lighting Node Pro'], ['0cf2:7750', 'Lian Li Uni Hub'], ['0cf2:a100', 'Lian Li Uni Hub - SL'], ['1e71:2006', 'NZXT Smart Device V2'], ['264a:1fa5', 'Thermaltake Riing (PID 0x1FA5)'], ['2516:1011', 'Cooler Master ARGB']]) {
  check(TABLE.controllers.find((c) => c.id === id)?.name === name, `${id} is ${name}`);
}
check(!ids.includes('2516:01bb') && !ids.includes('0b05:1a83'), 'monitors and keyboards are not in the fan table');
check(TABLE.smbusBoards.map((m) => m.maker).join() === 'ASUS,Gigabyte,ASRock,MSI,EVGA', 'the board makers whose lights OpenRGB reaches over the SMBus');

// ---- stand-ins
const usb = (id, name = null) => ({ id, vid: id.slice(0, 4), pid: id.slice(5), name, runs: null });
const PC = (maker, model, list, smbus = ['AMD SMBus']) => ({ board: { maker, model }, usb: list, smbus, ram: [], gpus: [] });
const bundleOk = { shipped: true, version: '1.1', canStart: true, why: null, running: true, writes: true };
const ORGB = (controllers, extra = {}) => ({ running: true, protocol: 3, bundled: true, readOnly: null, controllers, bundle: bundleOk, lastFind: { at: '2026-10-22T10:00:00.000Z', ok: true, reason: null, found: controllers.length }, ...extra });
const ctl = (name, type, id) => ({ index: 0, name, vendor: 'x', type, location: `HID: \\\\?\\HID#VID_${id.slice(0, 4).toUpperCase()}&PID_${id.slice(5).toUpperCase()}&MI_00#7&1a2b3c&0&0000`, zones: [], leds: 8, mode: 'Direct', color: '#ffffff', same: true });

// 1. an MSI board with Mystic Light on USB, found by OpenRGB: reachable over USB, nothing wrong
let d = diagnose({ pc: PC('Micro-Star International Co., Ltd.', 'MAG B550 TOMAHAWK (MS-7C91)', [usb('1462:7c56', 'USB Input Device'), usb('046d:c232')]), orgb: ORGB([ctl('MSI MAG B550', 'motherboard', '1462:7c56')]) });
check(d.verdict?.kind === 'usb' && d.verdict.line === KIND.usb && d.verdict.line === 'reachable over USB: should show after Find lights', `USB controller: ${JSON.stringify(d.verdict)}`);
check(d.board === 'Micro-Star MAG B550 TOMAHAWK (MS-7C91)' && d.seen.length === 1 && d.seen[0].found === true && d.seen[0].name === 'MSI Mystic Light MS_7C56', `board and the controller seen and found: ${JSON.stringify(d.seen)}`);
check(d.seen[0].source.startsWith(`https://codeberg.org/OpenRGB/OpenRGB/src/commit/${TABLE.source.commit}/Controllers/MSIMotherboardController/`), `the source link: ${d.seen[0].source}`);
check(d.problems.length === 0 && d.found[0].id === '1462:7c56' && d.openrgb.usbOnly && /1\.1 \(inside DeviceHub\)/.test(d.openrgb.version), `no problems, found list read: ${JSON.stringify(d.problems)}`);
check(d.lines.some((l) => /^- Lights OpenRGB found: MSI MAG B550 \(motherboard, USB 1462:7c56\)$/.test(l)) && d.lines.some((l) => /MSI Mystic Light MS_7C56 \(1462:7c56\), found/.test(l)), `report lines:\n${d.lines.join('\n')}`);

// 2. a Corsair Commander Pro plugged in, OpenRGB ran but did not list it: the maker's app is named as the likely cause
d = diagnose({ pc: PC('ASUSTeK COMPUTER INC.', 'ROG STRIX B550-F GAMING', [usb('1b1c:0c10', 'Commander PRO')]), orgb: ORGB([]) });
check(d.verdict.kind === 'usb' && d.seen[0].found === false && d.problems.length === 1 && /not found by OpenRGB/.test(d.problems[0].problem) && /iCUE/.test(d.problems[0].why) && /Quit the maker's lighting app/.test(d.problems[0].fix), `plugged in but not found: ${JSON.stringify(d.problems)}`);
check(d.lines.some((l) => /NOT found by OpenRGB/.test(l)), 'the report says it was not found');

// 3. before Find lights: the USB controller is listed as "should show after Find lights", no problem yet
d = diagnose({ pc: PC('Gigabyte Technology Co., Ltd.', 'B550 AORUS ELITE', [usb('048d:5702')]), orgb: { running: false, reason: 'not running', controllers: [], bundle: { ...bundleOk, running: false }, lastFind: null } });
check(d.verdict.kind === 'usb' && d.seen[0].found === null && d.problems.length === 0 && d.openrgb.state === 'not started yet', `before Find lights: ${JSON.stringify({ v: d.verdict, s: d.seen, p: d.problems, o: d.openrgb })}`);

// 4. an ASUS board with no USB controller: on the board's SMBus, needs PawnIO; Add board, fan and RAM lights sets it up
d = diagnose({ pc: PC('ASUSTeK COMPUTER INC.', 'PRIME B450M-A', [usb('046d:c232')]), orgb: ORGB([]) });
check(d.verdict.kind === 'smbus' && d.verdict.line === 'on the board\'s SMBus: needs OpenRGB with PawnIO as administrator (Add board, fan and RAM lights sets it up)' && /ENESMBusController/.test(d.verdict.source), `SMBus: ${JSON.stringify(d.verdict)}`);
check(d.problems.length === 1 && /SMBus/.test(d.problems[0].problem) && /PawnIO/.test(d.problems[0].fix) && /Your choice/.test(d.problems[0].fix) && /Add board, fan and RAM lights/.test(d.problems[0].fix), `the SMBus fix: ${JSON.stringify(d.problems)}`);
// board lights set up (helpers/board-lights.mjs) and its OpenRGB serving: named, and no setup advice
d = diagnose({ pc: PC('ASUSTeK COMPUTER INC.', 'PRIME B450M-A', []), orgb: ORGB([ctl('ASUS PRIME B450M-A', 'motherboard', '0000:0000')], { bundled: false, board: { setUp: true } }) });
check(d.problems.length === 0 && /as administrator for board lights/.test(d.openrgb.version), `board lights set up: ${d.openrgb.version}`);
// the person's own OpenRGB (with PawnIO) already serving: no "use your own OpenRGB" advice
d = diagnose({ pc: PC('ASUSTeK COMPUTER INC.', 'PRIME B450M-A', []), orgb: ORGB([ctl('ASUS PRIME B450M-A', 'motherboard', '0000:0000')], { bundled: false }) });
check(d.verdict.kind === 'reached' && d.problems.length === 0 && d.openrgb.version === 'your own OpenRGB', 'own OpenRGB running: no PawnIO advice');

// 5. an OEM board, nothing on USB: no lighting controller found, non-addressable or remote hub
d = diagnose({ pc: PC('Dell Inc.', '0K3CM7', [usb('046d:c232'), usb('8087:0026')], ['Intel(R) SMBus - 7AA3']), orgb: ORGB([]) });
check(d.verdict.kind === 'none' && d.verdict.line === 'no lighting controller found: the fans may be on a non-addressable or remote-controlled hub', `none: ${JSON.stringify(d.verdict)}`);
check(d.problems.length === 1 && /3-pin \(12 V\)/.test(d.problems[0].fix) && /remote or button/.test(d.problems[0].fix), 'how to check the fans\' wiring');
// a board maker that uses the SMBus but Windows lists no SMBus controller: not claimed as SMBus
d = diagnose({ pc: PC('ASUSTeK COMPUTER INC.', 'X', [], []), orgb: ORGB([]) });
check(d.verdict.kind === 'none', 'no SMBus listed: not called SMBus');

// 6. OpenRGB could not start: the plain reason and the fix, each kind
const fx = (r) => openrgbFix(r);
check(/Visual C\+\+ runtime/.test(fx("OpenRGB needs Microsoft's Visual C++ runtime, which this PC lacks (VCRUNTIME140_1.dll)").why) && /Visual C\+\+ Redistributable.*learn\.microsoft\.com/.test(fx("OpenRGB needs Microsoft's Visual C++ runtime, which this PC lacks (x)").fix), 'VC++ runtime missing: install it from Microsoft');
check(/Another OpenRGB is already open/.test(fx('OpenRGB is already running here without its SDK server: in OpenRGB, turn on Start Server (port 6742)').why) && /Start Server/.test(fx('OpenRGB is already running here without its SDK server: x').fix), 'another OpenRGB running');
check(/installed on this PC/.test(fx('OpenRGB is installed on this PC: open it and turn on its SDK server (DeviceHub does not start a second one)').why), 'an installed OpenRGB');
check(/missing some of its files/.test(fx('the OpenRGB 1.1 inside DeviceHub cannot start without PawnIOLib.dll (missing from tools\\openrgb; reinstall DeviceHub)').why) && /antivirus/.test(fx('the OpenRGB inside DeviceHub is missing (tools\\openrgb\\OpenRGB.exe)').fix), 'files missing');
check(/did not answer/.test(fx('the OpenRGB inside DeviceHub did not start its SDK server').why) && /too long/.test(fx('OpenRGB did not answer in time').why) && /too old/.test(fx('OpenRGB speaks protocol 2; DeviceHub needs OpenRGB 0.7 or newer (1.1 is best)').why), 'did not start, slow, too old');
check(/^Find lights has not run yet/.test(fx('not running').why) && /OpenRGB said: ECONNRESET/.test(fx('ECONNRESET').why), 'not pressed yet, and anything else said as is');

// 7. helpers/openrgb.js keeps the last Find lights' reason past its 10 s cache (a copy on a spare port; nothing starts)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-lights-'));
fs.writeFileSync(path.join(tmp, 'openrgb.js'), fs.readFileSync(path.join(ROOT, 'helpers', 'openrgb.js'), 'utf8').replace('PORT = 6742', 'PORT = 46745'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'safe-write.js'), path.join(tmp, 'safe-write.js'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'find-lights.js'), path.join(tmp, 'find-lights.js'));
fs.copyFileSync(path.join(ROOT, 'helpers', 'bundled-tools.json'), path.join(tmp, 'bundled-tools.json'));
const orgb = require(path.join(tmp, 'openrgb.js'));
const { bundle, deps: od } = orgb._test;
const toolDir = path.join(tmp, 'tools', 'openrgb');
fs.mkdirSync(toolDir, { recursive: true });
for (const f of [bundle.table.exe, ...(bundle.table.needs || [])]) fs.writeFileSync(path.join(toolDir, f), 'x');
Object.assign(bundle, { dir: toolDir, config: path.join(tmp, 'cfg'), pidFile: path.join(tmp, 'pid.json') });
let spawned = 0;
od.spawn = () => { spawned++; throw new Error('the test never starts OpenRGB'); };
od.running = async () => [];
od.installed = () => null;
od.exists = (f) => (/System32/i.test(f) ? !/VCRUNTIME140_1/i.test(f) : fs.existsSync(f));   // no Visual C++ runtime
let s = await orgb.status(true);
check(!s.running && /Visual C\+\+/.test(s.reason) && s.lastFind?.ok === false && /Visual C\+\+/.test(s.lastFind.reason) && spawned === 0, `Find lights without the runtime: ${JSON.stringify(s)}`);
const realNow = Date.now;
Date.now = () => realNow() + 11000;
try { s = await orgb.status(false); } finally { Date.now = realNow; }
check(/Visual C\+\+/.test(s.lastFind?.reason || '') && spawned === 0, `the reason is kept after the cache: ${JSON.stringify(s.lastFind)}`);
d = diagnose({ pc: PC('Dell Inc.', 'X', []), orgb: s });
check(d.openrgb.state === 'cannot start' && d.problems[0]?.problem === 'OpenRGB could not start' && /Visual C\+\+ Redistributable/.test(d.problems[0].fix) && d.lines[0].includes('cannot start'), `the page and Get help say it: ${JSON.stringify(d.problems[0])}`);

// 8. Get help for lights: one click carries OpenRGB, what it found, the board and the ids, with nothing personal
const help = await import('../helpers/get-help.mjs');
help.options.root = ROOT;
const lightsDiag = diagnose({ pc: PC('Micro-Star International Co., Ltd.', 'MAG B550 TOMAHAWK (MS-7C91)', [usb('1462:7c56'), usb('1b1c:0c10', 'Commander PRO')]), orgb: ORGB([ctl('MSI MAG B550', 'motherboard', '1462:7c56')]) });
const f = await help.gather(help.LIGHTS, { version: async () => 'test', windows: async () => 'Windows 11 24H2 (build 26100)', state: async () => ({ devices: [] }), lights: async () => lightsDiag, log: async () => ['[openrgb] started', 'C:\\Users\\zorblax\\x.json failed for PC lights', 'unrelated line'], bluetooth: async () => [] });
const r = help.makeIssue(f, { names: ['zorblax'] });
check(help.LIGHTS === 'lights' && r.ok, `the lights report can open: ${JSON.stringify(r.refused)}`);
check(/^Help: PC lights \(Micro-Star MAG B550 TOMAHAWK \(MS-7C91\)\), RGB controller on USB$/.test(r.title), `title: ${r.title}`);
check(r.body.includes('### PC lights') && r.body.includes('- OpenRGB: 1.1 (inside DeviceHub), running (USB lights only)') && r.body.includes('MSI MAG B550 (motherboard, USB 1462:7c56)') && r.body.includes('Corsair Commander Pro (1b1c:0c10), NOT found by OpenRGB') && r.body.includes('- So: reachable over USB'), `body:\n${r.body}`);
check(r.body.includes('### What DeviceHub found') && /Corsair Commander Pro was not found by OpenRGB/.test(r.body), 'the problem goes in as a finding');
check(!/zorblax/.test(r.body) && /PC lights/.test(r.body.split('### Log')[1] || '') && !/unrelated line/.test(r.body), 'lights log lines only, nothing personal');

// 9. the page: the fan section and its Get help (no pop-ups or tooltips in it)
const page = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'pc-lights.js'), 'utf8');
const fan = page.slice(page.indexOf('function fanHelp()'), page.indexOf('function pcLights()'));
check(fan.length > 100 && fan.includes("getHelp('lights', () => '', { area: 'lights' })") && !/toast\(|title:|confirm\(|alert\(/.test(fan), 'the fan section has Get help for lights and no pop-ups or tooltips');
check((page.match(/fanHelp\(\)/g) || []).length === 3 && page.includes("env.api('/api/lights/diagnose')"), 'shown before and after Find lights, read from /api/lights/diagnose');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check(/pathname === '\/api\/lights\/diagnose'[\s\S]{0,200}openrgb\.status\(false\)/.test(server) && server.includes("'/api/lights/diagnose': { isolated: true"), 'the route reads OpenRGB without starting it, and isolated mode answers a stand-in');

fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log(`lights-diagnose: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('lights-diagnose: all checks passed');
