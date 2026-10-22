// helpers/vendor-files.mjs (22 Oct 2026): reading what maker apps already installed say about a device. Small sample
// files in the system TEMP folder stand in for G HUB (SQLite), iCUE 5 (devices.json, config.cuecfg), Synapse 3 (XML,
// a log), the Epomaker driver (an Electron .asar) and Glorious CORE (ini). Checks the parsers, the limits, the
// --vid filter, that nothing personal is printed, and that the scan writes nothing beside the files it reads.
// Run: node tests/vendor-files.mjs (no hardware, no maker apps needed)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, scanApp, summary, APPS, hex4, bytesOf, idPair,fromJsonValue, fromText, fromCueCfg, newOut, readAsarIndex } from '../helpers/vendor-files.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-vendor-'));
const env = { ProgramFiles: path.join(root, 'PF'), 'ProgramFiles(x86)': path.join(root, 'PF86'), ProgramData: path.join(root, 'PD'), LOCALAPPDATA: path.join(root, 'LA'), APPDATA: path.join(root, 'RA') };
const put = (base, rel, data) => { const f = path.join(env[base], rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };

// --- values
check(hex4(6940) === '1B1C' && hex4('046d') === '046D' && hex4('0xC547') === 'C547' && hex4('49291') === 'C08B', 'hex4 reads decimal numbers, 4-digit hex and 0x hex');
check(hex4('HS80') === null && hex4(0) === null && hex4(70000) === null && hex4('12') === null, 'hex4 refuses names, 0, too-large and short values');
check(bytesOf('AA 01 ff') === 'AA 01 FF' && bytesOf([7, 0, 255]) === '07 00 FF' && bytesOf('0x07,0x01') === '07 01', 'bytesOf reads hex strings and byte arrays');
check(idPair('6940', '2665').join() === '1B1C,0A69' && idPair('1532', '0084').join() === '1532,0084' && idPair(6940, 2665).join() === '1B1C,0A69', 'ids written as decimal text (iCUE XML) are told from hex text');
check(bytesOf('DPI') === null && bytesOf([1, 300]) === null && bytesOf('abcdef') === null, 'bytesOf refuses words, values over 255 and letters-only strings');
let o = fromText('connected \\\\?\\HID#VID_1532&PID_0084&MI_00 and {vid:0x342d,pid:0xe479}', 'x', newOut());
check(o.devices.length === 2 && o.devices[0].pid === '0084' && o.devices[1].vid === '342D', `fromText finds Windows device paths and code literals (${JSON.stringify(o.devices)})`);
o = fromJsonValue({ name: 'Mouse', ids: [{ 'usb-vid': 6940, 'usb-pid': 2665 }], dpi: { min: 100, max: 26000, step: 50 } }, 'x', newOut());
check(o.devices[0]?.name === 'Mouse' && o.devices[0]?.pid === '0A69' && o.settings[0]?.name === 'dpi' && o.settings[0]?.step === 50, `fromJsonValue takes the name from the parent and a range's name from its key (${JSON.stringify(o)})`);

// --- G HUB: settings.db with the settings JSON in DATA.FILE
put('ProgramFiles', 'LGHUB/lghub.exe', '');
const emit = process.emitWarning; // node:sqlite's one "experimental" warning would add a line to the output
process.emitWarning = (w, ...a) => { if (!/sqlite/i.test(String(w?.message || w))) emit.call(process, w, ...a); };
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
process.emitWarning = emit;
let dbFile = null;
if (DatabaseSync) {
  dbFile = path.join(env.LOCALAPPDATA, 'LGHUB', 'settings.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE DATA (_id INTEGER PRIMARY KEY, _date_created TEXT, FILE BLOB)');
  db.prepare('INSERT INTO DATA (_date_created, FILE) VALUES (?, ?)').run('2026-10-22', new TextEncoder().encode(JSON.stringify({ devices: { g502: { name: 'G502 HERO', vendorId: 1133, productId: 49291, dpi: { min: 100, max: 25600, step: 50 } } } })));
  db.close();
}

// --- iCUE 5: the device list cache, the saved settings, a temp copy and game lighting (both skipped)
put('LOCALAPPDATA', 'Corsair/CUE5/cache/devices.json', JSON.stringify({ version: 1, 'device-ids': [
  { 'device-type': 'headset', 'display-name': 'HS80', ids: [{ 'usb-pid': 2665, 'usb-vid': 6940 }], 'lister-stage2': '', package: 'dev-hs80' },
  { 'device-type': 'mouse', 'display-name': 'DARK CORE', ids: [{ 'usb-pid': 7040, 'usb-vid': 6940 }, { 'usb-pid': 7041, 'usb-vid': 6940 }], package: 'dev-darkcore' }] }));
const cfg = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n<map name="DataCollectionSettings"><value name="user_id">SECRET-USER-ID</value><value name="machine_id">SECRET-MACHINE</value></map>\n<map name="Devices"><map name="HS80"><map name="{1d9fa618-fbc9-4b98-ae35-ae3c4b6198a3}">\n<value name="BrightnessLevel">66</value><value name="SleepModeWaitDelaySec">900</value><value name="UniqueDeviceId">{dafb5a5e-2641-4f5b-987f-d3fa588c265b}</value><binary name="LedChannelTypes">%00%01</binary>\n</map></map></map>\n</config>`;
put('APPDATA', 'Corsair/CUE5/config.cuecfg', cfg);
put('APPDATA', 'Corsair/CUE5/config.cuecfg.AbCdEf', cfg.replace('HS80', 'COPY-SHOULD-BE-SKIPPED'));
put('ProgramData', 'Corsair/CUE5/GameSDKEffects/Game/x.json', JSON.stringify({ vid: 'AAAA', pid: 'BBBB' }));
const m = fromCueCfg(cfg);
check(m.HS80?.BrightnessLevel === '66' && m.HS80?.LedChannelTypes === '(binary)' && /not shown/.test(m.HS80?.UniqueDeviceId), `fromCueCfg names each model's settings and hides ids (${JSON.stringify(m)})`);

// --- Synapse 3: an XML device file and a log line
put('ProgramData', 'Razer/Synapse3/Devices/devices.xml', '<?xml version="1.0"?><!-- sample --><Devices><Device Name="DeathAdder V2" VID="1532" PID="0084"><Setting Name="DPI" Min="100" Max="20000" Step="50"/><Command Name="GetSerial" Report="00 FF 00 00 00 02 00 82"/></Device></Devices>');
put('LOCALAPPDATA', 'Razer/Synapse3/Log/Synapse3.txt', 'found HID\\VID_1532&PID_0085&MI_00');

// --- Epomaker: an Electron app.asar (index + JSON, JS and a node_modules entry that is skipped)
put('ProgramFiles', 'EPOMAKER Driver/EPOMAKER.exe', '');
const entries = { 'models.json': JSON.stringify({ models: [{ name: 'P75', vid: '0x342D', pid: '0xE479', commands: [{ name: 'setLight', command: 'AA 01 02 03' }] }] }),
  'main.js': 'const dev = { vid: 0x342d, pid: 0xe480 };', 'node_modules/x/package.json': JSON.stringify({ vid: 'CCCC', pid: 'DDDD' }) };
{
  let off = 0; const files = {}; const bodies = [];
  for (const [p, body] of Object.entries(entries)) {
    const parts = p.split('/'); let node = files;
    for (const d of parts.slice(0, -1)) node = (node[d] ??= { files: {} }).files;
    const b = Buffer.from(body); node[parts.at(-1)] = { size: b.length, offset: String(off) }; off += b.length; bodies.push(b);
  }
  const json = Buffer.from(JSON.stringify({ files })), pad = (4 - (json.length % 4)) % 4;
  const head = Buffer.alloc(16); head.writeUInt32LE(4, 0); head.writeUInt32LE(8 + json.length + pad, 4); head.writeUInt32LE(4 + json.length + pad, 8); head.writeUInt32LE(json.length, 12);
  put('ProgramFiles', 'EPOMAKER Driver/resources/app.asar', Buffer.concat([head, json, Buffer.alloc(pad), ...bodies]));
}
check(readAsarIndex(path.join(env.ProgramFiles, 'EPOMAKER Driver/resources/app.asar'))?.files.length === 3, 'readAsarIndex lists the archive entries');

// --- Glorious CORE: an ini device file
put('ProgramFiles', 'Glorious Core/Glorious Core.exe', '');
put('ProgramFiles', 'Glorious Core/Devices/ModelO.ini', '; sample\n[Device]\nName=Model O\nVID=258A\nPID=0036\n[DPI]\nMin=400\nMax=19000\nStep=100\n[LightCommand]\nreport=07 01 00 FF\n');

// --- the whole scan
const listAll = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort().join('|');
const before = listAll(root), dbStat = dbFile && fs.statSync(dbFile).mtimeMs;
const r = await scan({ env });
const by = Object.fromEntries(r.apps.map((a) => [a.id, a]));
const has = (a, pid, name) => (by[a]?.devices || []).some((d) => d.pid === pid && (!name || d.name === name));
if (DatabaseSync) {
  check(by.lghub?.status === 'installed' && has('lghub', 'C08B', 'G502 HERO'), `G HUB: settings.db's JSON is read (${JSON.stringify(by.lghub?.devices)} ${JSON.stringify(by.lghub?.errors)})`);
  check(by.lghub?.settings.some((s) => s.name === 'dpi' && s.max === 25600) && by.lghub?.sqlite[0]?.tables?.DATA === 1, 'G HUB: the DPI range and the table list');
} else console.log('vendor-files: note: this Node has no node:sqlite, the G HUB part was not tested');
check(by.icue5?.status === 'leftovers only (app not installed)' && has('icue5', '0A69', 'HS80') && has('icue5', '1B81', 'DARK CORE'), `iCUE 5: devices.json (${by.icue5?.status} ${JSON.stringify(by.icue5?.devices)})`);
check(by.icue5?.savedSettings?.HS80?.SleepModeWaitDelaySec === '900' && !by.icue5.savedSettings['COPY-SHOULD-BE-SKIPPED'], 'iCUE 5: saved settings from config.cuecfg, temp copies skipped');
check(!has('icue5', 'BBBB'), 'iCUE 5: GameSDKEffects is skipped');
check(has('synapse3', '0084', 'DeathAdder V2') && has('synapse3', '0085'), `Synapse 3: XML attributes and the log line (${JSON.stringify(by.synapse3?.devices)})`);
check(by.synapse3?.settings.some((s) => s.name === 'DPI' && s.min === 100 && s.max === 20000 && s.step === 50), 'Synapse 3: the XML setting range');
check(by.synapse3?.commands.some((c) => c.name === 'GetSerial' && c.bytes === '00 FF 00 00 00 02 00 82'), `Synapse 3: plain-text command bytes (${JSON.stringify(by.synapse3?.commands)})`);
check(by.epomaker?.status === 'installed' && has('epomaker', 'E479', 'P75') && has('epomaker', 'E480'), `Epomaker: JSON and JS inside app.asar (${JSON.stringify(by.epomaker?.devices)})`);
check(by.epomaker?.commands.some((c) => c.name === 'setLight' && c.bytes === 'AA 01 02 03') && !has('epomaker', 'DDDD'), 'Epomaker: the asar command, node_modules skipped');
check(has('glorious-core', '0036', 'Model O') && by['glorious-core']?.settings.some((s) => s.min === 400 && s.max === 19000) && by['glorious-core']?.commands.some((c) => c.bytes === '07 01 00 FF'), `Glorious: the ini (${JSON.stringify(by['glorious-core'])})`);
check(by.keychron?.status === 'web app (nothing installed)' && by.wootility?.status === 'not found', 'Keychron is web-only; an absent app is "not found"');
const text = JSON.stringify(r);
check(!/SECRET|dafb5a5e|1d9fa618/.test(text), 'no user, machine or device instance ids in the report');
check(!text.includes(root), 'paths are shown as %BASE%\\..., never the full path');
check(listAll(root) === before && (!dbFile || fs.statSync(dbFile).mtimeMs === dbStat), 'the scan wrote nothing (no -shm/-wal, no copies)');
check(/Corsair iCUE 5/.test(summary(r)) && /web only/.test(summary(r)), 'the summary names what it found');

// --- limits and the --vid filter
const icue = APPS.find((a) => a.id === 'icue5'), glorious = APPS.find((a) => a.id === 'glorious-core');
const lim = await scanApp(icue, { env, maxFiles: 1 });
check(lim.stoppedAtLimit && lim.filesLooked === 1, `the file limit stops the app's scan (${lim.filesLooked})`);
const big = await scanApp(glorious, { env, maxBytes: 10 });
check(big.skippedOver50MB.length === 1 && !big.devices.length, `files over the size limit are skipped (${JSON.stringify(big.skippedOver50MB)})`);
const v = await scan({ env, vid: '1532' });
check(v.apps.find((a) => a.id === 'icue5').status.startsWith('skipped') && v.apps.find((a) => a.id === 'synapse3').devices.every((d) => d.vid === '1532'), '--vid keeps that vendor only');

// --- nothing installed
const none = await scan({ env: { ProgramFiles: path.join(root, 'nothing'), LOCALAPPDATA: path.join(root, 'nothing') } });
check(none.apps.every((a) => /not found|web app/.test(a.status)) && /none of the known maker apps/.test(summary(none)), 'a PC with none of them gives a clean empty report');

fs.rmSync(root, { recursive: true, force: true });
console.log(fails.length ? `vendor-files: FAILED: ${fails.join('; ')}` : 'vendor-files (maker app files, read-only): all good');
process.exit(fails.length ? 1 : 0);
