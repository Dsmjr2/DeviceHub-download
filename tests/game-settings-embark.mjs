// Embark's option file (THE FINALS, ARC Raiders; helpers/gvas.mjs, game-settings.mjs kind 'embark'), in a temp folder
// with option files made here in both of Unreal's tag layouts: with graphics off the laptop keeps its own resolution,
// window mode, scalability, DLSS and aspect ratio while the controls, camera, crosshair, audio and HUD size carry;
// accepted terms, first-run markers and voice chat devices never carry; the laptop's bytes after the map stay; a file
// this does not understand is never written; Put back restores the laptop's file exactly. If this PC has the real
// files, they are read (never written) and must come back byte for byte.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from '../helpers/game-settings.mjs';
import { parseOptions, writeOptions, fstring } from '../helpers/gvas.mjs';

let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log(`FAIL ${what}`); } };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };

// an option save the way the game writes one: UE 5.5's tags (THE FINALS) or 5.4's (ARC Raiders)
function gvas(options, { newTags = true, extra = Buffer.alloc(0) } = {}) {
  const map = Buffer.concat([i32(0), i32(Object.keys(options).length), ...Object.entries(options).flatMap(([k, v]) => [fstring(k), fstring(v)])]);
  const s = fstring;
  return Buffer.concat([
    Buffer.from('GVAS'), i32(3), i32(522), i32(newTags ? 1018 : 1009), u16(5), u16(newTags ? 7 : 3), u16(4), i32(1), s('test_1.0'),
    i32(3), i32(1), Buffer.alloc(16, 7), i32(1), s('/Script/EmbarkOptionSystem.EmbarkOptionSaveGameV1'),
    newTags ? Buffer.from([0]) : Buffer.alloc(0),
    s('Version'), s('IntProperty'), newTags ? Buffer.concat([i32(0), i32(4), Buffer.from([0])]) : Buffer.concat([i32(4), i32(0), Buffer.from([0])]), i32(8),
    s('Properties'), s('MapProperty'),
    newTags ? Buffer.concat([i32(2), s('NameProperty'), i32(0), s('StrProperty'), i32(0), i32(map.length), Buffer.from([0])])
      : Buffer.concat([i32(map.length), i32(0), s('NameProperty'), s('StrProperty'), Buffer.from([0])]),
    map, extra, s('None'), i32(0)]);
}
const opts = (buf) => Object.fromEntries(parseOptions(buf).entries.map((e) => [e.key, e.value]));
const O = (k) => `GameplayOption.${k}`;

// ---------- the format ----------
for (const newTags of [true, false]) {
  const b = gvas({ [O('Controls.MouseSensitivity')]: '0.42', [O('Display.Resolution')]: '', [O('Audio.Name')]: 'Zoë' }, { newTags, extra: Buffer.from('BLOB') });
  const p = parseOptions(b);
  check(p && p.entries.length === 3 && opts(b)[O('Audio.Name')] === 'Zoë', `${newTags ? '5.5' : '5.4'} tags: read`);
  check(writeOptions(p, p.entries).equals(b) && writeOptions(p, p.entries.map((e) => ({ key: e.key, value: e.value }))).equals(b), `${newTags ? '5.5' : '5.4'} tags: written back byte for byte`);
}
check(parseOptions(Buffer.from('GVAS nonsense')) === null && parseOptions(Buffer.from('not a save at all, not even close to one........................')) === null, 'not a save: refused');
const cut = gvas({ [O('A')]: '1' }); check(parseOptions(cut.subarray(0, cut.length - 20)) === null, 'a cut-off file: refused');
const wrong = gvas({ [O('A')]: '1' }); wrong.write('EmbarkProgressSave', wrong.indexOf('EmbarkOptionSaveGameV1'), 'latin1'); check(parseOptions(wrong) === null, 'another save class: refused');

// ---------- the PC and the laptop ----------
const pc = (name) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `dh-gse-${name}-`));
  const roots = { local: path.join(base, 'local'), locallow: path.join(base, 'locallow'), roaming: path.join(base, 'roaming'), home: path.join(base, 'home') };
  for (const r of Object.values(roots)) fs.mkdirSync(r, { recursive: true });
  return { base, roots, put(p, data) { const f = path.join(roots.local, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; },
    get(p) { try { return fs.readFileSync(path.join(roots.local, ...p.split('/'))); } catch { return null; } } };
};
const reg = { async read() { return null; }, async write() {}, async del() {} };
const FIN = 'Discovery/Saved/SaveGames/EmbarkOptionSaveGame.sav', FIN_KEYS = 'Discovery/Saved/SaveGames/EmbarkSaveGameClientKeyBindings.sav';
const FIN_GUS = 'Discovery/Saved/Config/WindowsClient/GameUserSettings.ini', ARC = 'PioneerGame/Saved/SaveGames/EmbarkOptionSaveGame.sav';

const desk = pc('desk');
desk.put(FIN, gvas({
  [O('Display.Resolution')]: '2560x1440', [O('Display.WindowMode')]: 'EWindowMode::Fullscreen', [O('Display.FrameRateLimit')]: '240', [O('Display.UIAspectRatio')]: 'EUIAspectRatio::AR_21_9',
  [O('Display.HudScale')]: '0.9', [O('Display.WorldIconScale')]: '1.2', [O('Scalability.Shadow')]: '4', [O('Graphics.Advanced.DLSS')]: 'Quality',
  [O('Controls.MouseSensitivity')]: '0.42', [O('Camera.FOV')]: '100', [O('Crosshair.Color')]: 'Red', [O('Audio.MasterVolume')]: '0.3', [O('Controls.NewOnDesk')]: '1',
  [O('Audio.VoiceChat.Input')]: 'desk-mic', [O('Audio.VoiceChat.ModerationConsent')]: 'true', [O('FTUE.FirstBootDone')]: 'true', [O('Legal.TermsAccepted')]: 'true',
}, { extra: Buffer.from('DESKBLOB') }));
desk.put(FIN_KEYS, Buffer.from('desk key bindings'));
desk.put(FIN_GUS, '[ScalabilityGroups]\r\nsg.ShadowQuality=4\r\n');
desk.put(ARC, gvas({ [O('Controls.MouseSensitivity')]: '0.5', [O('Scalability.Shadow')]: '3', [O('Display.WindowMode')]: 'Fullscreen', [O('Accessibility.Subtitles')]: 'On' }, { newTags: false }));
const saved = await G.capture({ roots: desk.roots, reg });

const lap = pc('lap');
const lapFin = gvas({
  [O('Display.Resolution')]: '1920x1080', [O('Display.WindowMode')]: 'EWindowMode::WindowedFullscreen', [O('Display.FrameRateLimit')]: '60', [O('Display.UIAspectRatio')]: 'EUIAspectRatio::AR_16_9',
  [O('Display.HudScale')]: '1.0', [O('Display.WorldIconScale')]: '1.0', [O('Scalability.Shadow')]: '1', [O('Graphics.Advanced.DLSS')]: 'Performance',
  [O('Controls.MouseSensitivity')]: '0.30', [O('Camera.FOV')]: '80', [O('Crosshair.Color')]: 'White', [O('Audio.MasterVolume')]: '0.8',
  [O('Audio.VoiceChat.Input')]: 'lap-mic', [O('Audio.VoiceChat.ModerationConsent')]: 'false', [O('FTUE.FirstBootDone')]: 'false', [O('Controls.OnlyOnLaptop')]: '7',
}, { extra: Buffer.from('LAPTOPBLOB') });
lap.put(FIN, lapFin);
lap.put(FIN_GUS, '[ScalabilityGroups]\r\nsg.ShadowQuality=1\r\n');
const lapArc = gvas({ [O('Controls.MouseSensitivity')]: '0.2', [O('Scalability.Shadow')]: '1', [O('Display.WindowMode')]: 'Windowed', [O('Accessibility.Subtitles')]: 'Off' }, { newTags: false });
lap.put(ARC, lapArc);
const backups = path.join(lap.base, 'backups');

// graphics off
const pl = await G.plan(saved, { roots: lap.roots, reg });
check(pl.find((p) => p.name === 'THE FINALS')?.settings === 2, `THE FINALS: the option file and key bindings would change (${JSON.stringify(pl)})`);
let r = await G.apply(saved, [{ name: 'THE FINALS' }, { name: 'ARC Raiders' }], { roots: lap.roots, reg, backups });
check(!r.failed && r.done === 3, `loaded with graphics off (${JSON.stringify(r)})`);
const f = opts(lap.get(FIN));
check(f[O('Display.Resolution')] === '1920x1080' && f[O('Display.WindowMode')] === 'EWindowMode::WindowedFullscreen' && f[O('Display.FrameRateLimit')] === '60', 'graphics off: the laptop keeps its resolution, window mode and frame rate limit');
check(f[O('Scalability.Shadow')] === '1' && f[O('Graphics.Advanced.DLSS')] === 'Performance' && f[O('Display.UIAspectRatio')] === 'EUIAspectRatio::AR_16_9', 'graphics off: its scalability, DLSS and aspect ratio');
check(f[O('Controls.MouseSensitivity')] === '0.42' && f[O('Camera.FOV')] === '100' && f[O('Crosshair.Color')] === 'Red' && f[O('Audio.MasterVolume')] === '0.3', 'controls, field of view, crosshair and audio carry');
check(f[O('Display.HudScale')] === '0.9' && f[O('Display.WorldIconScale')] === '1.2', "the HUD's and world icons' sizes carry");
check(f[O('Controls.NewOnDesk')] === '1' && f[O('Controls.OnlyOnLaptop')] === '7', 'an option only the PC has is added; one only the laptop has stays');
check(f[O('Audio.VoiceChat.Input')] === 'lap-mic' && f[O('Audio.VoiceChat.ModerationConsent')] === 'false' && f[O('FTUE.FirstBootDone')] === 'false' && !(O('Legal.TermsAccepted') in f), 'never: voice chat devices, consent, first-run markers, accepted terms');
check(lap.get(FIN).includes(Buffer.from('LAPTOPBLOB')) && !lap.get(FIN).includes(Buffer.from('DESKBLOB')), "the laptop's own bytes after the map stay");
check(lap.get(FIN_KEYS)?.toString() === 'desk key bindings', 'key bindings carry as before');
check(lap.get(FIN_GUS).toString().includes('sg.ShadowQuality=1'), 'GameUserSettings.ini (graphics) untouched');
const a = opts(lap.get(ARC));
check(a[O('Controls.MouseSensitivity')] === '0.5' && a[O('Accessibility.Subtitles')] === 'On' && a[O('Scalability.Shadow')] === '1' && a[O('Display.WindowMode')] === 'Windowed', "ARC Raiders (5.4 tags): controls carry, the laptop's graphics stay");
check((await G.plan(saved, { roots: lap.roots, reg })).every((p) => !p.settings), 'loaded again: nothing left to change');

// Put back: the laptop's files exactly as they were
await G.putBack(backups, { reg });
check(lap.get(FIN).equals(lapFin) && lap.get(ARC).equals(lapArc) && lap.get(FIN_KEYS) === null, 'Put back: the option files byte for byte, the key bindings that were not there moved aside');

// graphics on: the PC's graphics too; never the rest
r = await G.apply(saved, [{ name: 'THE FINALS', graphics: true }], { roots: lap.roots, reg, backups });
const g = opts(lap.get(FIN));
check(g[O('Display.Resolution')] === '2560x1440' && g[O('Scalability.Shadow')] === '4' && g[O('Display.UIAspectRatio')] === 'EUIAspectRatio::AR_21_9' && lap.get(FIN_GUS).toString().includes('sg.ShadowQuality=4'), 'graphics on: the PC\'s graphics');
check(g[O('Audio.VoiceChat.Input')] === 'lap-mic' && g[O('FTUE.FirstBootDone')] === 'false', 'graphics on: still never the devices or first-run markers');
await G.putBack(backups, { reg });

// a file this does not understand, on either side, and no file on the laptop yet: nothing written
const odd = pc('odd');
odd.put(FIN, Buffer.from('GVAS but not an option save'));
r = await G.apply(saved, [{ name: 'THE FINALS' }], { roots: odd.roots, reg, backups: path.join(odd.base, 'b') });
check(odd.get(FIN).toString() === 'GVAS but not an option save', "the laptop's file not understood: left alone");
const none = pc('none');
none.put('Discovery/Saved/Config/WindowsClient/x.ini', '');
r = await G.apply(saved, [{ name: 'THE FINALS' }], { roots: none.roots, reg, backups: path.join(none.base, 'b') });
check(none.get(FIN) === null && none.get(FIN_KEYS)?.toString() === 'desk key bindings', 'no option file here yet: not made from the PC\'s (start the game once), key bindings still carry');
const odd2 = structuredClone(saved); odd2.find((s) => s.name === 'THE FINALS').files[0].data = Buffer.from('GVAS junk').toString('base64');
r = await G.apply(odd2, [{ name: 'THE FINALS' }], { roots: lap.roots, reg, backups });
check(lap.get(FIN).equals(lapFin), "the PC's file not understood: the laptop's left alone");

// every file still copied whole with graphics off is bindings only (13 Nov 2026: each was read and holds no graphics)
const whole = G.CATALOG.flatMap((c) => (c.files || []).filter((x) => x.kind === 'whole' && !x.graphics).map((x) => x.path));
check(whole.length && whole.every((p) => /bind|input/i.test(path.basename(p))), `files copied whole are key bindings only (${whole.filter((p) => !/bind|input/i.test(path.basename(p)))})`);
check(G.CATALOG.filter((c) => (c.files || []).some((x) => /EmbarkOptionSaveGame/.test(x.path))).every((c) => c.files.find((x) => /EmbarkOptionSaveGame/.test(x.path)).kind === 'embark'), 'both Embark option files carry key by key');

// this PC's real option files, read only: understood and written back byte for byte
for (const dir of ['Discovery', 'PioneerGame']) {
  const p = path.join(process.env.LOCALAPPDATA || '', dir, 'Saved', 'SaveGames', 'EmbarkOptionSaveGame.sav');
  let b; try { b = fs.readFileSync(p); } catch { continue; }
  const x = parseOptions(b);
  check(x && writeOptions(x, x.entries.map((e) => ({ key: e.key, value: e.value }))).equals(b), `${dir}'s real option file: read and rebuilt byte for byte`);
}

for (const d of [desk, lap, odd, none]) fs.rmSync(d.base, { recursive: true, force: true });
console.log(bad ? `game-settings-embark: ${bad} failed` : 'game-settings-embark (THE FINALS and ARC Raiders: graphics stay, controls carry, Put back exact): all checks passed');
process.exit(bad ? 1 : 0);
