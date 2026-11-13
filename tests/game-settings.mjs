// Games' own settings in the setup file (helpers/game-settings.mjs), in a temp folder with a pretend registry:
// capture leaves out logins and device ids, graphics stays unless picked, a running game is refused, every change is
// backed up and Put back restores it, and a file that did not exist is moved aside, not left.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../helpers/game-settings.mjs';

let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log(`FAIL ${what}`); } };

const fakeReg = (start = {}) => {
  const keys = new Map(Object.entries(start).map(([k, v]) => [k, new Map(Object.entries(v))]));
  return { keys,
    async read(k) { return keys.has(k) ? new Map(keys.get(k)) : null; },
    async write(k, n, type, data) { if (!keys.has(k)) keys.set(k, new Map()); keys.get(k).set(n, { type, data }); },
    async del(k, n) { keys.get(k)?.delete(n); } };
};
const pc = (name) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `dh-gs-${name}-`));
  const roots = { local: path.join(base, 'local'), locallow: path.join(base, 'locallow'), roaming: path.join(base, 'roaming'), home: path.join(base, 'home') };
  for (const r of Object.values(roots)) fs.mkdirSync(r, { recursive: true });
  return { base, roots, put(root, p, text) { const f = path.join(roots[root], ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; },
    read(root, p) { try { return fs.readFileSync(path.join(roots[root], ...p.split('/')), 'utf8'); } catch { return null; } } };
};

// the desktop: Wardogs (binds + ini), Super Battle Golf (json + registry), PEAK (registry)
const desk = pc('desk');
const WD_INI = 'Wardogs/Saved/Config/WindowsClient/GameUserSettings.ini', WD_BINDS = 'Wardogs/Saved/SaveGames/EnhancedInputUserSettings.sav';
desk.put('local', WD_INI, '[/Script/WD.Settings]\r\nMouseSensitivity=0.42\r\nbInvertYAxisInfantry=True\r\nResolutionSizeX=2560\r\nbUseVSync=False\r\nbHavePlayerConductTermsBeenAccepted=True\r\nVersion=5\r\nAudioOutputDevice={0.0.0.00000000}.{desk-speakers}\r\nAudioInputDevice={0.0.1.00000000}.{desk-mic}\r\nFrameGenerationMode[0]=2\r\n');
desk.put('local', WD_BINDS, Buffer.from([1, 2, 3, 4]));
const SBG = 'Brimstone/Super Battle Golf/Config.json';
desk.put('locallow', SBG, JSON.stringify({ audioSettings: { masterVolume: 0.3, outputDeviceGuid: 'desk-guid' }, graphicsSettings: { screenWidth: 2560 }, controlSettings: { mouse: { sensitivity: 2.5 } } }));
const deskReg = fakeReg({
  'Software\\LandCrab\\PEAK': { MouseSensitivitySetting_h1: { type: 'REG_EXPORT', data: 'hex(4):00,00,00,00,ca,5f,ea,3f' }, FovSetting_h2: { type: 'REG_EXPORT', data: 'hex(4):00,00,00,00,00,80,56,40' },
    'Screenmanager Resolution Width_h3': { type: 'REG_EXPORT', data: 'dword:00000a00' }, UserID_h4: { type: 'REG_EXPORT', data: 'hex:41,42,43,00' }, 'unity.player_sessionid_h5': { type: 'REG_EXPORT', data: 'hex(4):01,00,00,00,00,00,00,00' },
    MicrophoneSetting_h6: { type: 'REG_EXPORT', data: 'hex:4d,69,63,00' } },
  'Software\\Brimstone\\Super Battle Golf': { UnityGraphicsQuality_h7: { type: 'REG_EXPORT', data: 'dword:00000003' } },
});
const saved = await G.capture({ roots: desk.roots, reg: deskReg });
const names = saved.map((g) => g.name);
check(names.includes('WARDOGS') && names.includes('Super Battle Golf') && names.includes('PEAK') && !names.includes('THE FINALS'), `captured the games present (${names})`);
const peak = saved.find((g) => g.name === 'PEAK');
check(peak.reg.every((v) => !/UserID|session|Microphone/.test(v.name)) && peak.reg.length === 3, 'no account id, session or microphone in the file');

// the laptop: Wardogs started once, Super Battle Golf started once, PEAK started once; Halo not
const lap = pc('lap');
lap.put('local', WD_INI, '[/Script/WD.Settings]\nMouseSensitivity=1.0\nResolutionSizeX=1920\nbUseVSync=True\nVersion=6\n[Other]\nKeep=1\n');
lap.put('locallow', SBG, JSON.stringify({ audioSettings: { masterVolume: 1, outputDeviceGuid: 'lap-guid' }, graphicsSettings: { screenWidth: 1920 }, controlSettings: { mouse: { sensitivity: 1 } } }, null, 2));
const lapReg = fakeReg({ 'Software\\LandCrab\\PEAK': { MouseSensitivitySetting_h1: { type: 'REG_EXPORT', data: 'hex(4):00,00,00,00,00,00,f0,3f' }, 'Screenmanager Resolution Width_h3': { type: 'REG_EXPORT', data: 'dword:00000780' } } });
const backups = path.join(lap.base, 'backups');

const pl = await G.plan(saved, { roots: lap.roots, reg: lapReg });
const by = Object.fromEntries(pl.map((p) => [p.name, p]));
// (13 Nov bug hunt) one file holding both controls and graphics: its graphics are counted, so the switch is shown
check(by.WARDOGS?.here && by.WARDOGS.settings === 2 && by.WARDOGS.graphics === 1, `Wardogs: binds + ini settings, and the same ini's graphics counted (${JSON.stringify(by.WARDOGS)})`);
check(by.PEAK?.settings === 2 && by.PEAK.graphics === 1, `PEAK: 2 settings, 1 graphics value (${JSON.stringify(by.PEAK)})`);
check(by['Super Battle Golf']?.settings === 1 && by['Super Battle Golf'].graphics === 2, `Golf: json settings; json and registry graphics (${JSON.stringify(by['Super Battle Golf'])})`);

// running: refused
let r = await G.apply(saved, [{ name: 'PEAK' }], { roots: lap.roots, reg: lapReg, running: new Set(['peak.exe']), backups });
check(r.failed === 1 && r.done === 0 && /running/.test(r.lines[0].text) && !r.backup, 'a running game is never written');

// load, graphics off
r = await G.apply(saved, [{ name: 'WARDOGS' }, { name: 'PEAK' }, { name: 'Super Battle Golf' }], { roots: lap.roots, reg: lapReg, backups });
check(!r.failed && r.done === 5 && r.backup, `loaded with a backup (${JSON.stringify(r)})`);
const ini = lap.read('local', WD_INI);
check(/MouseSensitivity=0.42/.test(ini) && /bInvertYAxisInfantry=True/.test(ini) && /ResolutionSizeX=1920/.test(ini) && /bUseVSync=True/.test(ini), 'ini: settings in, graphics kept');
check(/Version=6/.test(ini) && !/Accepted/.test(ini) && /\[Other\]\nKeep=1/.test(ini), 'ini: version, accepted terms and other sections untouched');
check(!/desk-speakers|desk-mic/.test(ini), 'ini: the other PC\'s audio output and input devices are never carried');
check(!/FrameGeneration/.test(ini), 'ini: frame generation is graphics');
check(fs.readFileSync(path.join(lap.roots.local, ...WD_BINDS.split('/'))).equals(Buffer.from([1, 2, 3, 4])), 'binds file copied (it did not exist here)');
const golf = JSON.parse(lap.read('locallow', SBG));
check(golf.controlSettings.mouse.sensitivity === 2.5 && golf.audioSettings.masterVolume === 0.3 && golf.audioSettings.outputDeviceGuid === 'lap-guid' && golf.graphicsSettings.screenWidth === 1920, 'json: settings in, device id and graphics kept');
const pk = lapReg.keys.get('Software\\LandCrab\\PEAK');
check(pk.get('MouseSensitivitySetting_h1').data === 'hex(4):00,00,00,00,ca,5f,ea,3f' && pk.get('FovSetting_h2') && pk.get('Screenmanager Resolution Width_h3').data === 'dword:00000780' && !pk.has('UserID_h4'), 'registry: all 8 bytes of a Unity float in, graphics kept, no account id');
check((await G.plan(saved, { roots: lap.roots, reg: lapReg })).every((p) => !p.settings), 'loaded again: no settings left to change');

// graphics picked
r = await G.apply(saved, [{ name: 'PEAK', graphics: true }], { roots: lap.roots, reg: lapReg, backups });
check(pk && lapReg.keys.get('Software\\LandCrab\\PEAK').get('Screenmanager Resolution Width_h3').data === 'dword:00000a00', 'graphics picked: resolution carried');

// Put back: newest first (the graphics load), then the first load
let b = G.latestBackup(backups);
check(b?.games?.join() === 'PEAK', 'newest backup is the graphics load');
await G.putBack(backups, { reg: lapReg });
check(lapReg.keys.get('Software\\LandCrab\\PEAK').get('Screenmanager Resolution Width_h3').data === 'dword:00000780', 'put back: resolution as it was');
await G.putBack(backups, { reg: lapReg });
const pk2 = lapReg.keys.get('Software\\LandCrab\\PEAK');
check(pk2.get('MouseSensitivitySetting_h1').data === 'hex(4):00,00,00,00,00,00,f0,3f' && !pk2.has('FovSetting_h2'), 'put back: all 8 bytes restored, added value removed');
check(/MouseSensitivity=1.0/.test(lap.read('local', WD_INI)) && !/MouseSensitivity=0.42/.test(lap.read('local', WD_INI)), 'put back: ini as it was');
check(!fs.existsSync(path.join(lap.roots.local, ...WD_BINDS.split('/'))), 'put back: a file that was not there is moved aside');
check(G.latestBackup(backups) === null, 'nothing left to put back');

// a game never started on the laptop: listed as not here, never written
const lap2 = pc('lap2');
const p2 = await G.plan(saved, { roots: lap2.roots, reg: fakeReg() });
check(p2.length === 3 && p2.every((p) => !p.here), 'games never started here: not here');
r = await G.apply(saved, [{ name: 'Super Battle Golf' }], { roots: lap2.roots, reg: fakeReg(), backups: path.join(lap2.base, 'b') });
check(!fs.existsSync(path.join(lap2.roots.locallow, ...SBG.split('/'))), 'json never made from nothing (a missing field reads as 0)');

// a setup file cannot name a path or a registry key: only the catalog's
const evil = [{ name: 'PEAK', files: [{ i: 0, data: 'eA==' }], reg: [{ name: 'Run', type: 'REG_SZ', data: 'x' }] }, { name: 'Unknown', files: [{ i: 0, data: 'eA==' }] }];
r = await G.apply(evil, [{ name: 'PEAK' }, { name: 'Unknown' }], { roots: lap.roots, reg: lapReg, backups });
check(!lapReg.keys.has('Software\\Microsoft\\Windows\\CurrentVersion\\Run') && r.lines.every((l) => l.name === 'PEAK'), 'only the catalog decides where');

// an older setup file's registry values (cut by "reg query") are never written
{
  const old = [{ name: 'PEAK', files: [], reg: [{ name: 'MouseSensitivitySetting_h1', type: 'REG_DWORD', data: '0x0' }] }];
  const pl0 = await G.plan(old, { roots: lap.roots, reg: lapReg });
  check(pl0.every((p) => !p.settings), 'an older file\'s registry values: nothing to change');
}

// ini and json edge cases (13 Nov bug hunt)
{
  const c = G.iniMerge('[A]\nsens=1\n', '[A]\nSens=2\n', false);
  check(/Sens=2/.test(c) && !/sens=1/.test(c), `ini: a key in another letter case is replaced, not added twice (${JSON.stringify(c)})`);
  const bomd = G.iniMerge('\uFEFFSens=1\n[A]\nx=1', 'Sens=2\n', false);
  check(bomd.startsWith('\uFEFF') && (bomd.match(/Sens=/g) || []).length === 1 && /Sens=2/.test(bomd), `ini: a byte-order mark is kept and the first key still matched (${JSON.stringify(bomd)})`);
  const top = G.iniMerge('[Options]\nVolume=1', 'TopKey=5\n[Options]\nVolume=2', false);
  check(!/\[\]/.test(top) && top.startsWith('TopKey=5') && /Volume=2/.test(top), `ini: a key before any section goes at the top, not under "[]" (${JSON.stringify(top)})`);
  G.jsonMerge('{"x":1}', '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"bad":1}}}', false);
  check(({}).polluted === undefined && ({}).bad === undefined, 'json: a file cannot reach every object through __proto__');
  const dot = JSON.parse(G.jsonMerge('{"a":{"b":1},"a.b":0}', '{"a.b":2}', false));
  check(dot['a.b'] === 2 && dot.a.b === 1, `json: a key with a dot in it stays one key (${JSON.stringify(dot)})`);
  const big = G.jsonMerge('{"id":76561198000000001,"v":1}', '{"v":2}', false);
  check(/76561198000000001/.test(big) && /"v":2/.test(big), `json: a big id on this PC is kept exactly (${big})`);
}

// the real registry, on a key of its own (Windows only): an 8-byte value of the DWORD type round-trips whole
if (process.platform === 'win32') {
  const K = 'Software\\DeviceHubTest\\GameSettings';
  const v = 'hex(4):00,00,00,00,ca,5f,ea,3f';
  try {
    await G.realReg.write(K, 'Float "x"\\y', 'REG_EXPORT', v);
    const back = (await G.realReg.read(K))?.get('Float "x"\\y');
    check(back?.data === v, `the real registry: written and read back whole (${back?.data})`);
    let refused = null; try { await G.realReg.write(K, 'n', 'REG_EXPORT', 'dword:00000001\r\n"Evil"="x"'); } catch (e) { refused = e; }
    check(refused, 'the real registry: a value that is not one line of exported text is refused');
  } finally {
    const { execFile } = await import('node:child_process');
    await new Promise((res) => execFile('reg', ['delete', 'HKCU\\Software\\DeviceHubTest', '/f'], { windowsHide: true }, res));
  }
}

// only on Shawn's own PCs: anyone else's copy reads, plans and writes nothing
check(await G.allowed('.', async () => true) === true && await G.allowed('.', async () => false) === false, 'on for the owner, off for everyone else');
check(await G.allowed('.', async () => { throw new Error('no git'); }) === false, 'off when the owner check fails');

for (const d of [desk, lap, lap2]) fs.rmSync(d.base, { recursive: true, force: true });
console.log(bad ? `game-settings: ${bad} failed` : 'game-settings: all checks passed');
process.exit(bad ? 1 : 0);
