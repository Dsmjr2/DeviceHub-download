// Instant replay (helpers/replay.mjs, helpers/obs-ws.mjs, /api/replay, ui/replay-card.js) against a stand-in OBS: the
// setup backs up and changes only the replay settings, OBS is started hidden for a game and closed after it, an OBS the
// person opened is never closed, and the remote-control login is the one obs-websocket's protocol document describes.
// Run: node tests/replay.mjs (no OBS needed, nothing on this PC is changed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createReplay, replayProfile, parseIni, getIni, hotkeyVk, PROFILE, COLLECTION, SOURCE, LENGTHS, replayMB, lengthsFor } from '../helpers/replay.mjs';
import { connect } from '../helpers/obs-ws.mjs';
import { lengthLabel, lengthOption, recordLabel, keyFromCode } from '../public/ui/replay-card.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const CFG = 'C:\\obs';
const WS = path.join(CFG, 'plugin_config', 'obs-websocket', 'config.json');
const BASE = path.join(CFG, 'basic', 'profiles', 'Untitled', 'basic.ini');
const MINE = path.join(CFG, 'basic', 'profiles', 'DeviceHub_replay', 'basic.ini');

// ---- the profile: the person's own settings kept, only the replay ones changed
{
  const base = '\uFEFF[General]\r\nName=Untitled\r\n\r\n[SimpleOutput]\r\nRecEncoder=nvenc\r\nRecRB=false\r\nRecRBTime=20\r\n\r\n[Video]\r\nFPSCommon=60\r\n';
  const ini = parseIni(replayProfile(base, { seconds: 60, folder: 'C:\\Users\\x\\Videos\\DeviceHub replays' }));
  ok(ini.bom && getIni(ini, 'General', 'Name') === PROFILE, 'the profile is named DeviceHub replay, BOM kept');
  ok(getIni(ini, 'SimpleOutput', 'RecEncoder') === 'nvenc' && getIni(ini, 'Video', 'FPSCommon') === '60', "the person's encoder and video settings are kept");
  ok(getIni(ini, 'SimpleOutput', 'RecRB') === 'true' && getIni(ini, 'SimpleOutput', 'RecRBTime') === '60' && getIni(ini, 'SimpleOutput', 'RecRBSize') === '480', 'replay buffer on, 60 s, a memory cap');
  ok(getIni(ini, 'SimpleOutput', 'FilePath') === 'C:\\\\Users\\\\x\\\\Videos\\\\DeviceHub replays', 'clips folder written the way OBS writes paths');
  ok(JSON.parse(getIni(ini, 'Hotkeys', 'OBSBasic.SaveReplayBuffer')).bindings[0].key === 'OBS_KEY_F10', 'Alt+F10 under the name OBS 33 reads');
}

// ---- a stand-in Windows with a stand-in OBS
function world({ running = [], wsConf = { server_enabled: false, auth_required: true, server_password: 'pw', server_port: 4455 } } = {}) {
  const files = new Map([[WS, JSON.stringify(wsConf)], [BASE, '\uFEFF[General]\r\nName=Untitled\r\n'], [path.join(CFG, 'user.ini'), '[Basic]\r\nProfileDir=Untitled\r\n']]);
  const obs = { pids: [...running], collections: ['Untitled'], current: 'Untitled', inputs: [], buffer: false, saved: 0, closedForce: 0, started: [] };
  const calls = [];
  const api = {
    async call(type, data) {
      calls.push(type);
      if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: obs.current, sceneCollections: obs.collections };
      if (type === 'CreateSceneCollection') { obs.collections.push(data.sceneCollectionName); obs.current = data.sceneCollectionName; obs.inputs = []; return {}; }
      if (type === 'SetCurrentSceneCollection') { obs.current = data.sceneCollectionName; return {}; }
      if (type === 'GetInputList') return { inputs: data?.inputKind === 'wasapi_input_capture' ? [{ inputName: 'Mic/Aux' }] : obs.inputs.map((n) => ({ inputName: n })) };
      if (type === 'SetInputMute') { obs.muted = { ...(obs.muted || {}), [data.inputName]: data.inputMuted }; return {}; }
      if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: 'Scene' };
      if (type === 'CreateInput') { obs.inputs.push(data.inputName); obs.inputKind = data.inputKind; obs.mode = data.inputSettings.capture_mode; return {}; }
      if (type === 'GetReplayBufferStatus') return { outputActive: obs.buffer };
      if (type === 'StartReplayBuffer') { obs.buffer = true; return {}; }
      if (type === 'StopReplayBuffer') { obs.buffer = false; return {}; }
      if (type === 'SaveReplayBuffer') { obs.saved++; setTimeout(() => api.fire('ReplayBufferSaved', { savedReplayPath: `C:\\clips\\Replay ${obs.saved}.mp4` }), 5); return {}; }
      throw Object.assign(new Error(`unknown ${type}`), { code: 204 });
    },
    handlers: new Map(),
    on(t, fn) { api.handlers.set(t, fn); return () => api.handlers.delete(t); },
    fire(t, d) { api.handlers.get(t)?.(d); },
    close() {},
  };
  const sys = {
    installed: () => true,
    read: (f) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); },
    exists: (f) => files.has(f),
    write: (f, t) => files.set(f, t),
    copy: (a, b) => files.set(b, files.get(a)),
    mkdir: () => {},
    obsPids: async () => [...obs.pids],
    start: (args) => { obs.started.push(args); obs.pids.push(4242); obs.buffer = false; return 4242; },
    close: async (pid, force) => { if (force) obs.closedForce++; obs.pids = obs.pids.filter((p) => p !== pid); },
    sleep: async () => {},
    connect: async ({ password }) => { if (!JSON.parse(files.get(WS)).server_enabled || !obs.pids.length) throw new Error('refused'); obs.password = password; return api; },
  };
  return { files, obs, calls, sys };
}
const make = (w, s = { on: true, seconds: 30 }) => {
  let set = s; const logs = [];
  let t = 1000;
  const r = createReplay({ root: 'R', sys: w.sys, cfg: CFG, settings: () => set, saveSettings: (x) => { set = x; }, log: (text, kind) => logs.push({ text, kind }), now: () => t });
  return { r, logs, settings: () => set, advance: (ms) => { t += ms; } };
};

// ---- setup
{
  const w = world({ running: [77] });
  const { r } = make(w);
  let e = null; try { await r.setup(30); } catch (x) { e = x; }
  ok(e && /Close OBS Studio first/.test(e.message) && e.code === 409, 'setup refuses while OBS is open');
}
{
  const w = world();
  const { r, logs } = make(w);
  await r.setup(30);
  const conf = JSON.parse(w.files.get(WS));
  ok(conf.server_enabled && conf.auth_required && conf.server_password === 'pw', "remote control on, OBS's own password kept");
  ok([...w.files.keys()].some((f) => /backups[\\/]obs-.*obs-websocket-config\.json$/.test(f)), 'the remote-control settings were backed up first');
  ok(/RecRB=true/.test(w.files.get(MINE)) && w.files.get(BASE) === '\uFEFF[General]\r\nName=Untitled\r\n', "DeviceHub's profile written; the person's own untouched");
  ok(logs.some((l) => /set up in OBS/.test(l.text)), 'setup is in Activity');
}

// ---- a game: started hidden, collection and game capture made once, buffer on; gone 20 s: closed
{
  const w = world({ wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m = make(w);
  await m.r.tick('Fortnite');
  const args = w.obs.started[0] || [];
  ok(args.includes('--minimize-to-tray') && args[args.indexOf('--profile') + 1] === PROFILE && !args.includes('--collection'), 'OBS started hidden with the replay profile (no collection yet)');
  ok(w.obs.current === COLLECTION && w.obs.inputs.includes(SOURCE) && w.obs.inputKind === 'game_capture' && w.obs.mode === 'any_fullscreen', 'its own scene collection with one Game Capture (any full-screen game)');
  ok(w.obs.buffer && m.r.status().phase === 'recording' && m.r.status().game === 'Fortnite' && w.obs.password === 'pw', 'replay buffer on, logged in with OBS\'s password');
  const saved = await m.r.save();
  ok(saved.file === 'C:\\clips\\Replay 1.mp4' && m.r.status().lastClip?.file === saved.file, 'Save now: the clip OBS wrote');
  await m.r.tick(null); m.advance(10000); await m.r.tick(null);
  ok(w.obs.pids.length === 1, 'a game gone for 10 s: OBS still there (a game restarting itself is not a quit)');
  m.advance(11000); await m.r.tick(null);
  ok(!w.obs.pids.length && !w.obs.closedForce && m.r.status().phase === 'idle', 'gone 20 s: OBS closed politely');
  // the next game: the collection exists now, so OBS opens it directly
  w.files.set(path.join(CFG, 'basic', 'scenes', 'DeviceHub_replay.json'), '{}');
  await m.r.tick('PEAK');
  const args2 = w.obs.started[1] || [];
  ok(args2[args2.indexOf('--collection') + 1] === COLLECTION && w.obs.inputs.filter((n) => n === SOURCE).length === 1, 'second game: OBS opens its collection, no second source');
  await m.r.set({ on: false });
  ok(!w.obs.pids.length && m.settings().on === false, 'turned off mid-game: OBS closed');
}
// ---- an OBS the person opened: used, never closed
{
  const w = world({ running: [77], wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m = make(w);
  await m.r.tick('Fortnite');
  ok(!w.obs.started.length && w.obs.buffer, "the person's OBS: its replay buffer started, no second OBS");
  m.advance(30000); await m.r.tick(null); m.advance(30000); await m.r.tick(null);
  ok(w.obs.pids.includes(77) && !w.obs.buffer, "after the game: only the buffer DeviceHub started is stopped; the person's OBS stays open");
}
// ---- off: nothing happens; bad values refused; Save outside a game refused
{
  const w = world();
  const m = make(w, { on: false, seconds: 30 });
  await m.r.tick('Fortnite');
  ok(!w.obs.started.length, 'off: a game starts nothing');
  let e = null; try { await m.r.set({ seconds: 50 }); } catch (x) { e = x; } ok(e?.code === 400, 'a length not on the list is refused');
  for (const [b, what] of [[{ quality: 'ultra' }, 'quality'], [{ fps: 144 }, 'frame rate'], [{ size: '4k' }, 'size'], [{ when: 'sometimes' }, 'when'],
    [{ hotkey: { key: 'OBS_KEY_R' } }, 'a bare letter as hotkey'], [{ hotkey: { key: 'OBS_KEY_ESCAPE', alt: true } }, 'a key not on the list'], [{ hotkey: 'F9' }, 'a hotkey that is not an object']]) {
    let x = null; try { await m.r.set(b); } catch (y) { x = y; } ok(x?.code === 400, `refused: ${what}`);
  }
  e = null; try { await m.r.save(); } catch (x) { e = x; } ok(e?.code === 409, 'Save now outside a game is refused');
}

// ---- the login: base64(sha256(base64(sha256(password + salt)) + challenge)), as the protocol document gives it
{
  let sent = null;
  class FakeWs {
    constructor() { setTimeout(() => this.onmessage({ data: JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge: 'C', salt: 'S' } } }) }), 1); }
    send(t) { const m = JSON.parse(t); if (m.op === 1) { sent = m.d; setTimeout(() => this.onmessage({ data: JSON.stringify({ op: 2, d: {} }) }), 1); }
      if (m.op === 6) setTimeout(() => this.onmessage({ data: JSON.stringify({ op: 7, d: { requestId: m.d.requestId, requestStatus: { result: m.d.requestType === 'Good', code: m.d.requestType === 'Good' ? 100 : 207, comment: 'not ready' }, responseData: { x: 1 } } }) }), 1); }
    close() {}
  }
  const api = await connect({ password: 'pw', WS: FakeWs });
  const h = (s) => crypto.createHash('sha256').update(s).digest('base64');
  ok(sent.authentication === h(h('pwS') + 'C') && sent.eventSubscriptions === 64, 'the login hash and the Outputs events');
  ok((await api.call('Good')).x === 1, 'a request and its answer');
  let e = null; try { await api.call('Bad'); } catch (x) { e = x; } ok(e?.code === 207, "OBS's refusal code reaches the caller (207 = still loading)");
}

ok(lengthLabel(30) === '30 s' && lengthLabel(120) === '2 min', 'card labels');
ok(keyFromCode('KeyR') === 'OBS_KEY_R' && keyFromCode('F9') === 'OBS_KEY_F9' && keyFromCode('Numpad5') === 'OBS_KEY_NUM5' && keyFromCode('PageUp') === 'OBS_KEY_PAGEUP' && keyFromCode('F25') === null && keyFromCode('Escape') === null && keyFromCode('Space') === null, 'keys pressed on the card map to OBS names; others are refused');
ok(recordLabel(15) === 'Record last 15 s' && recordLabel(60) === 'Record last 1 min', 'the button says Record last and the length picked');
// OBS's virtual camera is not a webcam: left out of the Monitors page's cameras (helpers/camera.js)
const { isVirtual } = createRequire(import.meta.url)('../helpers/camera.js');
ok(isVirtual({ id: '', name: 'OBS Virtual Camera', controls: {} }) && isVirtual({ id: 'x', name: 'Some Virtual Camera', controls: { zoom: {} } })
  && !isVirtual({ id: 'usb#vid_0408&pid_4053', name: 'ACER HD User Facing', controls: { brightness: {} } }), 'OBS Virtual Camera is not listed as a webcam; a real one is');
// ---- the other settings: hotkey (or none), quality, frame rate, size, mic, games or always
{
  const base = '\uFEFF[General]\r\nName=Untitled\r\n\r\n[Video]\r\nBaseCX=2560\r\nBaseCY=1440\r\nOutputCX=2560\r\nOutputCY=1440\r\nFPSCommon=60\r\n';
  const p = (o) => parseIni(replayProfile(base, { seconds: 30, folder: 'C:\\v', ...o }));
  ok(JSON.parse(getIni(p({ hotkey: null }), 'Hotkeys', 'OBSBasic.SaveReplayBuffer')).bindings.length === 0, 'hotkey off: no binding at all');
  ok(JSON.parse(getIni(p({ hotkey: { control: true, shift: true, key: 'OBS_KEY_R' } }), 'Hotkeys', 'OBSBasic.SaveReplayBuffer')).bindings[0].shift === true, 'a hotkey of your own');
  ok(getIni(p({ quality: 'high' }), 'SimpleOutput', 'RecQuality') === 'HQ' && getIni(p({ quality: 'high' }), 'SimpleOutput', 'RecRBSize') === '854', 'High quality at 1440p, with room for it (30 s x 16 MB/s x 1440p/1080p)');
  ok(getIni(p({ fps: 30 }), 'Video', 'FPSCommon') === '30', '30 frames a second');
  const s1080 = p({ size: '1080' });
  ok(getIni(s1080, 'Video', 'OutputCX') === '1920' && getIni(s1080, 'Video', 'OutputCY') === '1080' && getIni(s1080, 'Video', 'BaseCX') === '2560', '1080p from a 1440p screen keeps its shape; the screen size is not changed');
  ok(getIni(p({ size: 'screen' }), 'Video', 'OutputCY') === '1440', 'screen size');
  const small = parseIni(replayProfile(base.replace(/2560/g, '1280').replace(/1440/g, '720'), { seconds: 30, folder: 'C:\\v', size: '1080' }));
  ok(getIni(small, 'Video', 'OutputCY') === '720', 'never scaled up');

  const w = world({ wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m = make(w, { on: true, seconds: 30, mic: false });
  await m.r.tick('Fortnite');
  ok(w.obs.muted?.['Mic/Aux'] === true, 'your mic left out of clips');
  await m.r.set({ mic: true });
  ok(w.obs.muted['Mic/Aux'] === false && w.obs.pids.length === 1, 'mic back in at once, OBS not restarted for it');
  const startsBefore = w.obs.started.length;
  const st = await m.r.set({ hotkey: { control: true, key: 'OBS_KEY_F9' } });
  ok(st.hotkeyLabel === 'Ctrl+F9' && !w.obs.pids.length && /OBS_KEY_F9/.test(w.files.get(MINE)), 'a new hotkey mid-game: OBS closed, the profile rewritten');
  await m.r.tick('Fortnite');
  ok(w.obs.started.length === startsBefore + 1 && w.obs.buffer, 'and started again on the next check');
  await m.r.set({ hotkey: null });
  ok(/"bindings":\[\]/.test(w.files.get(MINE)) && m.r.status().hotkeyLabel === 'Off', 'hotkeys turned off completely');
  // always: runs with no game
  const w2 = world({ wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m2 = make(w2, { on: true, seconds: 30, when: 'always' });
  await m2.r.tick(null);
  ok(m2.r.status().phase === 'recording' && m2.r.status().game === 'your PC', 'Always: recording with no game');
  m2.advance(60000); await m2.r.tick(null);
  ok(m2.r.status().phase === 'recording', 'Always: not stopped for having no game');
  await m2.r.set({ when: 'games' });
  ok(m2.r.status().phase === 'idle' && !w2.obs.pids.length, 'back to games only: stopped');
  // the person's own OBS: settings that need a restart are refused, not forced
  const w3 = world({ running: [77], wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m3 = make(w3);
  await m3.r.tick('Fortnite');
  let e3 = null; try { await m3.r.set({ fps: 30 }); } catch (x) { e3 = x; }
  ok(e3?.code === 409 && w3.obs.pids.includes(77), "with your own OBS open, a profile change waits: your OBS is not closed");
}
// ---- hardening (3 Nov 2026): OBS closed or crashed mid-game, the buffer stopped in OBS, the folder cap, games of your
// own, hotkey conflicts
{
  const w = world({ wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  const m = make(w);
  await m.r.tick('Fortnite');
  w.obs.pids = [];                                   // OBS crashes
  for (let i = 0; i < 3; i++) await m.r.tick('Fortnite');
  ok(m.r.status().phase === 'idle' && m.logs.some((l) => /OBS closed while recording Fortnite: starting it again/.test(l.text)), 'OBS gone mid-game: noticed within 3 checks');
  await m.r.tick('Fortnite');
  ok(m.r.status().phase === 'recording' && w.obs.pids.length === 1 && w.obs.started.length === 2, 'and started again on the next check');
  for (let n = 0; n < 3; n++) { w.obs.pids = []; for (let i = 0; i < 3; i++) await m.r.tick('Fortnite'); await m.r.tick('Fortnite'); }
  ok(m.r.status().phase === 'idle' && /4 times in 10 minutes/.test(m.r.status().error || '') && w.obs.started.length === 4, 'closed 4 times in 10 minutes: not started again for this game');
  await m.r.tick(null); await m.r.tick('PEAK');
  ok(m.r.status().phase === 'recording' && m.r.status().game === 'PEAK', 'the next game gets a fresh try');
  w.obs.buffer = false;                              // the buffer stopped in OBS's own window
  for (let i = 0; i < 6; i++) await m.r.tick('PEAK');
  ok(w.obs.buffer && m.logs.some((l) => /buffer had stopped/.test(l.text)), 'the replay buffer stopped in OBS: started again within 30 s');
}
{
  // OBS that DeviceHub started but that never answers (stuck at a box): closed again, never left running
  const w = world({ wsConf: { server_enabled: true, auth_required: true, server_password: 'pw', server_port: 4455 } });
  let cleared = 0;
  w.sys.clearCrashMarks = () => { cleared++; };
  w.sys.connect = async () => { throw new Error('refused'); };
  const m = make(w);
  await m.r.tick('Fortnite');
  ok(cleared === 1 && !w.obs.pids.length && w.obs.closedForce === 1 && m.r.status().phase === 'idle', 'a started OBS that never answers is closed again (crash marks cleared first)');
  ok(!(w.obs.started[0] || []).includes('--disable-shutdown-check'), 'no flag OBS 33 no longer knows');
}
{
  const GB = 1e9, w = world();
  const clips = [
    { name: 'Replay 2026-11-01 10-00-00.mp4', size: 4 * GB, at: 1 }, { name: 'Replay 2026-11-02 10-00-00.mp4', size: 4 * GB, at: 2 },
    { name: 'my own video.mp4', size: 9 * GB, at: 0 }, { name: 'Replay 2026-11-03 10-00-00.mp4', size: 4 * GB, at: 3 },
  ];
  const recycled = [];
  w.sys.listClips = () => clips.filter((c) => !recycled.some((f) => f.endsWith(c.name)));
  w.sys.recycle = async (files) => { recycled.push(...files); return true; };
  const m = make(w, { on: true, seconds: 30, maxGB: 5 });
  const r = await m.r.cleanup();
  ok(r.removed === 2 && recycled.length === 2 && recycled.every((f) => /Replay 2026-11-0[12]/.test(f)), 'over 5 GB: the 2 oldest clips go to the Recycle Bin, the newest stays');
  ok(!recycled.some((f) => /my own video/.test(f)), 'a file DeviceHub did not make is never touched');
  ok(m.logs.some((l) => /2 old clips moved to the Recycle Bin/.test(l.text)), 'said in Activity');
  const m0 = make(w, { on: true, seconds: 30, maxGB: 0 });
  ok((await m0.r.cleanup()).removed === 0, 'No limit: nothing removed');
  const st0 = m.r.status();
  ok(st0.clips.count === 1 && /Replay 2026-11-03/.test(st0.lastClip?.file || ''), 'the card counts the clips and shows the newest (a hotkey save too)');
  let e = null; try { await m.r.set({ maxGB: 7 }); } catch (x) { e = x; } ok(e?.code === 400, 'a cap not on the list is refused');
}
{
  const w = world();
  const m = make(w, { on: false, seconds: 30, games: [] });
  await m.r.set({ addGame: { exe: 'Emulator.EXE', name: 'My emulator' } });
  ok(m.settings().games.length === 1 && m.settings().games[0].exe === 'emulator.exe', 'a game of your own, by its program name');
  await m.r.set({ removeGame: 'emulator.exe' });
  ok(m.settings().games.length === 0, 'and taken off again');
  let e = null; try { await m.r.set({ addGame: { exe: '..\\x.exe' } }); } catch (x) { e = x; } ok(e?.code === 400, 'not a program name: refused');
}
{
  const w = world();
  w.sys.programs = async () => ['explorer.exe', 'NVIDIA Overlay.exe'];
  let probed = 0;
  w.sys.probeHotkey = async () => { probed++; return 'taken'; };
  const m = make(w, { on: true, seconds: 30 });
  const list = await m.r.conflicts();
  ok(list.length === 2 && /NVIDIA's own Instant Replay/.test(list[0]) && /Another program holds Alt\+F10/.test(list[1]), 'Alt+F10 with the NVIDIA overlay running, and held in Windows: both said');
  await m.r.conflicts();
  ok(probed === 1, 'Windows is asked once in 10 minutes, not on every look');
  ok(JSON.stringify(hotkeyVk({ alt: true, key: 'OBS_KEY_F10' })) === JSON.stringify({ vk: 0x79, mods: 1 }) && hotkeyVk({ control: true, shift: true, key: 'OBS_KEY_R' }).vk === 0x52, 'keys as Windows numbers them');
  const m2 = make(w, { on: true, seconds: 30, hotkey: null });
  ok((await m2.r.conflicts()).length === 0, 'no hotkey: nothing to clash');
}

// ---- longer lengths (4 Nov 2026): each one's memory cap scales with quality, frame rate and size; a length is offered
// only when its cap fits half the PC's memory, and the cap really reaches OBS's profile
{
  const GB = 2 ** 30, hd = { w: 1920, h: 1080 };
  ok(LENGTHS.join() === '15,30,45,60,120,180,300,600,900,1200', `the lengths (${LENGTHS})`);
  ok(replayMB({ seconds: 600 }, hd) === 4800 && replayMB({ seconds: 600, fps: 30 }, hd) === 2400 && replayMB({ seconds: 600, size: '720' }, hd) === 2134 && replayMB({ seconds: 15 }, hd) === 256, 'the cap scales with frame rate and size; never under 256 MB');
  const at16 = lengthsFor({ quality: 'standard', fps: 60, size: 'screen' }, hd, 16 * GB);
  ok(at16.at(-1) === 900, `16 GB, 1080p 60 fps: up to 15 min (${at16})`);
  ok(lengthsFor({ quality: 'standard', fps: 30, size: 'screen' }, hd, 16 * GB).includes(1200), '20 min at 30 fps');
  ok(lengthsFor({ quality: 'high', fps: 60, size: 'screen' }, hd, 16 * GB).at(-1) === 300, 'High quality: up to 5 min');
  ok(lengthsFor({ quality: 'high', fps: 60, size: 'screen' }, { w: 3840, h: 2160 }, 4 * GB).join() === '15,30,45,60', 'a small PC with a 4K screen still keeps up to 1 min');
  const ten = parseIni(replayProfile('', { seconds: 600, folder: 'C:\\v' }));
  ok(getIni(ten, 'SimpleOutput', 'RecRBTime') === '600' && getIni(ten, 'SimpleOutput', 'RecRBSize') === '4800', '10 min reaches the profile with its whole cap (no 2 GB ceiling)');
  ok(lengthOption(600, 4800) === '10 min (4.7 GB)' && lengthOption(45, 360) === '45 s', 'a long option says its memory, a short one does not');

  const w = world();
  let saved = { on: false, seconds: 30 };
  const r = createReplay({ root: 'R', sys: w.sys, cfg: CFG, settings: () => saved, saveSettings: (x) => { saved = x; }, now: () => 1, ram: () => 16 * GB });
  ok(r.status().lengths.at(-1) === 900 && r.status().memoryMB[600] === 4800, 'the card gets the lengths that fit and each cap');
  await r.set({ on: true, seconds: 900 });
  ok(saved.seconds === 900 && getIni(parseIni(w.files.get(MINE)), 'SimpleOutput', 'RecRBTime') === '900', '15 min saved and written to OBS');
  let e = null; try { await r.set({ seconds: 1200 }); } catch (x) { e = x; }
  ok(e?.code === 400 && saved.seconds === 900, '20 min at 1080p 60 fps refused on 16 GB');
  await r.set({ quality: 'high' });
  ok(saved.seconds === 300 && /Length now 5 min/.test(r.status().lengthNote) && getIni(parseIni(w.files.get(MINE)), 'SimpleOutput', 'RecRBSize') === '4800', 'High quality brings 15 min down to 5 min, said once, and OBS gets 5 min');
}
const server = fs.readFileSync(path.join(REAL, 'server.js'), 'utf8');
ok(/\/api\/replay/.test(server) && /replay\.stop\('DeviceHub quit'\)/.test(server), 'the routes, and OBS closed when DeviceHub quits');
const src = fs.readFileSync(path.join(REAL, 'helpers/replay.mjs'), 'utf8');
ok(!/'\/F'\]|taskkill.*\/F/.test(src.split('close: (pid')[0]) && /force \? \['\/F'\]/.test(src), 'a forced end only after the polite close had its time');

if (fails.length) { console.log(`replay: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('replay (instant replay through OBS: setup, a game starts and ends it, the person\'s OBS left alone, login): all good');
