// Offline test (15 Nov 2026 bug hunt, helpers/game-settings.mjs), temp folders and a stand-in registry only:
// 1 with Game graphics on, the graphics files do not bring this PC's audio device, graphics card or mic ids
// 2 a UTF-16 ini (Unreal writes one once a value is not plain ASCII) is merged as UTF-16, not turned into garbage
// 3 an ini is never made from nothing (the game was not started there; without its Version the game drops it)
// 5 controls the word filters dropped are carried (Aimlabs lookConversion, WARDOGS MicrophoneVolume, a field of view)
// 6 a game not on this PC is not written, even if asked for
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../helpers/game-settings.mjs';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const noReg = { read: async () => null, write: async () => {}, del: async () => {} };
const pc = (name) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `dh-gsh-${name}-`));
  const roots = { local: path.join(base, 'local'), locallow: path.join(base, 'locallow'), roaming: path.join(base, 'roaming'), home: path.join(base, 'home') };
  for (const r of Object.values(roots)) fs.mkdirSync(r, { recursive: true });
  return { base, roots,
    put(root, p, data) { const f = path.join(roots[root], ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; },
    read(root, p) { try { return fs.readFileSync(path.join(roots[root], ...p.split('/'))); } catch { return null; } } };
};
const made = [];
const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-gsh-backups-'));

try {
  // 1: device ids in the graphics files
  const desk = pc('desk'), lap = pc('lap');
  made.push(desk, lap);
  const HD = 'Arrowhead/Helldivers2/user_settings.config';
  desk.put('roaming', HD, 'audio_device = 3\naudio_volume = 0.5\nfullscreen = false\nhostability = "aaaa"\nprev_audio_device = 0\nadapter_index = 1\nscreen_resolution = [\n\t2560\n\t1440\n]\n');
  lap.put('roaming', HD, 'audio_device = 0\naudio_volume = 0.9\nfullscreen = true\nhostability = "bbbb"\nprev_audio_device = 2\nadapter_index = 0\nscreen_resolution = [\n\t1920\n\t1080\n]\n');
  const FIN = 'Discovery/Saved/Config/WindowsClient/GameUserSettings.ini';
  desk.put('local', FIN, '[ScalabilityGroups]\r\nsg.ShadowQuality=3\r\n\r\n[/Script/Discovery.DiscoveryGameUserSettings]\r\nLastDeviceHash=D023A17F\r\nResolutionSizeX=2560\r\nVersion=5\r\n');
  lap.put('local', FIN, '[ScalabilityGroups]\r\nsg.ShadowQuality=1\r\n\r\n[/Script/Discovery.DiscoveryGameUserSettings]\r\nLastDeviceHash=11111111\r\nResolutionSizeX=1920\r\nVersion=5\r\n');
  const HALO = 'HaloInfinite/Settings/SpecControlSettings.json';
  desk.put('local', HALO, JSON.stringify({ spec_control_voice_input_device_id_hash: { value: 'DESKMIC' }, spec_control_fov: { value: 95 } }, null, 2));
  lap.put('local', HALO, JSON.stringify({ spec_control_voice_input_device_id_hash: { value: 'LAPMIC' }, spec_control_fov: { value: 78 } }, null, 2));
  const saved = await G.capture({ roots: desk.roots, reg: noReg });
  const r1 = await G.apply(saved, [{ name: 'HELLDIVERS 2', graphics: true }, { name: 'THE FINALS', graphics: true }, { name: 'Halo Infinite', graphics: true }], { roots: lap.roots, reg: noReg, backups });
  const hd = String(lap.read('roaming', HD));
  check(/fullscreen = false/.test(hd) && /audio_volume = 0\.5/.test(hd) && /2560/.test(hd), 'HELLDIVERS 2: its graphics and volumes are loaded');
  check(/^audio_device = 0$/m.test(hd) && /^prev_audio_device = 2$/m.test(hd) && /^adapter_index = 0$/m.test(hd) && /hostability = "bbbb"/.test(hd), `HELLDIVERS 2: the laptop keeps its own audio device, graphics card and host ids (${hd.replace(/\n/g, ' | ')})`);
  const fin = String(lap.read('local', FIN));
  check(/sg\.ShadowQuality=3/.test(fin) && /ResolutionSizeX=2560/.test(fin), 'THE FINALS: graphics loaded with Game graphics on');
  check(/LastDeviceHash=11111111/.test(fin) && !/D023A17F/.test(fin), 'THE FINALS: the laptop keeps its own graphics card hash');
  const halo = JSON.parse(String(lap.read('local', HALO)));
  check(halo.spec_control_fov?.value === 95, 'Halo: its settings loaded');
  check(halo.spec_control_voice_input_device_id_hash?.value === 'LAPMIC', `Halo: the laptop keeps its own mic (${JSON.stringify(halo.spec_control_voice_input_device_id_hash)})`);
  check(r1.done >= 3 && !r1.failed, `the load reports what it did (${JSON.stringify(r1.lines)})`);

  // 2: UTF-16 ini
  const u16 = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
  const WD = 'Wardogs/Saved/Config/WindowsClient/GameUserSettings.ini';
  const d2 = pc('d2'), l2 = pc('l2');
  made.push(d2, l2);
  d2.put('local', WD, u16('[/Script/Wardogs.WDGameUserSettings]\r\nClanTag=Ñ\r\nMouseSensitivity=1.0\r\nVersion=5\r\n'));
  l2.put('local', WD, u16('[/Script/Wardogs.WDGameUserSettings]\r\nClanTag=Ö\r\nMouseSensitivity=0.42\r\nVersion=5\r\n'));
  const s2 = await G.capture({ roots: d2.roots, reg: noReg });
  await G.apply(s2, [{ name: 'WARDOGS' }], { roots: l2.roots, reg: noReg, backups });
  const out2 = l2.read('local', WD);
  check(out2[0] === 0xff && out2[1] === 0xfe, 'a UTF-16 ini stays UTF-16');
  const t2 = out2.subarray(2).toString('utf16le');
  check(/MouseSensitivity=1\.0/.test(t2) && /ClanTag=Ñ/.test(t2) && !/�/.test(t2) && (t2.match(/\[\/Script/g) || []).length === 1, `its keys are merged in place (${JSON.stringify(t2)})`);

  // 3: an ini is never made from nothing
  const l3 = pc('l3');
  made.push(l3);
  l3.put('local', 'Wardogs/Saved/Logs/Wardogs.log', 'log');
  const s3 = [{ name: 'WARDOGS', files: s2[0].files.filter((f) => f) }];
  check(G.iniMerge(null, '[S]\r\nMouseSensitivity=0.4\r\nVersion=5\r\n', false) == null, 'iniMerge with no file here makes nothing');
  await G.apply(s3, [{ name: 'WARDOGS' }], { roots: l3.roots, reg: noReg, backups });
  check(!l3.read('local', WD), 'a game folder with only logs: its ini is not made');

  // 5: controls the word filters dropped
  check(G.jsonMerge('{"controlSettings":{"lookConversion":1}}', '{"controlSettings":{"lookConversion":3}}', false).includes('"lookConversion":3'), 'Aimlabs lookConversion is carried (it is not a "version")');
  check(/MicrophoneVolume=0\.8/.test(G.iniMerge('[S]\nMicrophoneVolume=0.2\n', '[S]\nMicrophoneVolume=0.8\n', false)), 'a microphone volume is carried (a level, not a device)');
  check(/MicrophoneDevice=Mine/.test(G.iniMerge('[S]\nMicrophoneDevice=Mine\n', '[S]\nMicrophoneDevice=Theirs\n', false)), 'a microphone device is still never carried');
  check(G.jsonMerge('{"graphicsSettings":{"fieldOfView":70,"quality":1}}', '{"graphicsSettings":{"fieldOfView":95,"quality":3}}', false) === JSON.stringify({ graphicsSettings: { fieldOfView: 95, quality: 1 } }), 'a field of view is a control, carried with graphics off');

  // 6: a game not on this PC is not written
  const l6 = pc('l6');
  made.push(l6);
  const s6 = [{ name: 'Super Battle Golf', files: [{ i: 1, data: Buffer.from('{"a":1}').toString('base64') }] }];
  await G.apply(s6, [{ name: 'Super Battle Golf' }], { roots: l6.roots, reg: noReg, backups });
  check(!fs.existsSync(path.join(l6.roots.locallow, 'Brimstone')), 'a game not on this PC: nothing written, no folder made');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  for (const p of made) try { fs.rmSync(p.base, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(backups, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`game-settings-hunt (device ids kept with graphics on, UTF-16 ini, no ini from nothing, filters, games not here): all ${n} passed`);
process.exit(0);
