// Offline test (15 Nov 2026, work map job 7): helpers/game-mode-live.mjs, Game mode's real switches. The devices,
// DeviceHub's own API, OpenRGB and Windows' notifications are stand-ins: every write is checked to go through the
// device's confirmed write (read back), to refuse a value that read back different, and to leave alone what is not there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realSwitches, nowValues, startGameMode } from '../helpers/game-mode-live.mjs';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const rejects = async (fn, re, what) => { try { await fn(); check(false, `${what} (no error)`); } catch (e) { check(re.test(e.message), `${what} (${e.message})`); } };

const writes = [];
let lie = null;   // a key whose read-back comes back different
const core = {
  devices: {
    mouse: { status: 'connected', values: { dpiStage: 2, dpi0: 400, dpi1: 800, pollingRate: 1000 } },
    keyboard: { status: 'connected', values: { hue: 10, saturation: 200, brightness: 150 }, adapter: { hasLighting: () => true, lightingKeys: (r, g, b, br) => [['hue', r === 255 ? 0 : 85], ['saturation', 255], ['brightness', br]] } },
    headset: { status: 'connected', values: { led: '#FF0000' }, adapter: { hasLighting: () => true } },
  },
  async write(id, key, value, opts) {
    writes.push({ id, key, value, opts });
    const back = key === lie ? 'other' : value;
    core.devices[id].values[key] = back;
    return back;
  },
  isBusy: () => false,
};
const api = (() => {
  const s = { eq: { engine: 'eqapo', activeId: 'flat', unsaved: false, presets: [{ id: 'flat' }, { id: 'game' }] }, screens: [{ id: 'S1', screen: 1, name: 'AGON', hdr: { supported: true, on: false } }, { id: 'S2', screen: 2, name: 'Acer', hdr: { supported: false } }], pending: false, hdrStuck: false };
  const fn = async (url, body) => {
    fn.calls.push([url, body]);
    if (url === '/api/eq') return JSON.parse(JSON.stringify(s.eq));
    if (url === '/api/eq/activate') { if (!s.eqStuck) s.eq.activeId = body.id; return { ok: true }; }
    if (url === '/api/display') return { screens: JSON.parse(JSON.stringify(s.screens)) };
    if (url === '/api/display/state') return { pending: s.pending };
    if (url === '/api/display/set') { if (!s.hdrStuck) s.screens.find((x) => x.screen === body.screen).hdr.on = body.value; return { ok: true }; }
    throw new Error(`unexpected ${url}`);
  };
  fn.calls = []; fn.s = s;
  return fn;
})();
const orgb = { up: true, colors: [], putBack: [], capture: async () => { if (!orgb.up) throw new Error('not running'); return [{ id: 0, mode: 'static' }]; }, setColor: async (w, c) => orgb.colors.push([w, c]), putBackAll: async (v) => orgb.putBack.push(v) };
const notif = { value: null, stuck: false, read: async () => notif.value, set: async (v) => { if (!notif.stuck) notif.value = v; } };

const sw = realSwitches({ core, api, openrgb: orgb, notifications: notif });
try {
  // DPI: the active stage
  check(JSON.stringify(sw.dpi.read()) === JSON.stringify({ stage: 2, dpi: 800 }), 'dpi reads the active stage');
  check(sw.dpi.same({ stage: 2, dpi: 800 }) && !sw.dpi.same(1600), 'dpi same()');
  await sw.dpi.write(1600);
  check(core.devices.mouse.values.dpi1 === 1600 && writes.at(-1).key === 'dpi1', 'a number writes the active stage');
  check(writes.at(-1).opts.noUndo && writes.at(-1).opts.silent, 'through the confirmed write, without its own Undo');
  await sw.dpi.write({ stage: 1, dpi: 500 });
  check(core.devices.mouse.values.dpi0 === 500, 'a saved stage writes that stage');
  lie = 'dpi1';
  await rejects(() => sw.dpi.write(900), /read back as other/, 'a DPI that reads back different fails');
  lie = null;
  core.devices.mouse.values.dpi1 = 800;

  // polling
  check(sw.polling.read() === 1000 && sw.polling.same(1000), 'polling read and same');
  await sw.polling.write(4000);
  check(core.devices.mouse.values.pollingRate === 4000, 'polling written');

  // lights
  const now = await sw.lights.read();
  check(now.keyboard.hue === 10 && now.headset === '#FF0000' && now.pc.length === 1, 'lights read keyboard, headset and PC lights');
  check(sw.lights.same('#ff0000', { keyboard: now.keyboard, headset: now.headset }) === false, 'keyboard not red yet: not the same');
  check(sw.lights.same('#00ff00', now) === false, 'with PC lights always writes');
  writes.length = 0;
  await sw.lights.write('#00ff00', now);
  check(writes.some((w) => w.id === 'keyboard' && w.key === 'hue' && w.value === 85) && !writes.some((w) => w.key === 'brightness'), 'a color keeps the keyboard brightness');
  check(core.devices.headset.values.led === '#00ff00' && orgb.colors.at(-1)?.[1] === '#00ff00', 'headset and PC lights take the color');
  writes.length = 0;
  await sw.lights.write('#000000', { keyboard: now.keyboard });
  check(writes.length === 1 && writes[0].key === 'brightness' && writes[0].value === 0, 'Off is keyboard brightness 0, and only lights that were there before change');
  await sw.lights.write(now, {});
  check(core.devices.keyboard.values.brightness === 150 && core.devices.headset.values.led === '#FF0000' && orgb.putBack.length === 1, 'the saved lights are put back');
  orgb.up = false;
  check(!(await sw.lights.read()).pc, 'OpenRGB not running: PC lights left out');
  core.devices.keyboard.status = 'asleep'; core.devices.headset.adapter.hasLighting = () => false;
  check((await sw.lights.read()) === undefined, 'no lights there: undefined');
  core.devices.keyboard.status = 'connected'; core.devices.headset.adapter.hasLighting = () => true;

  // EQ
  check((await sw.eq.read()) === 'flat' && (await sw.eq.wait()) === null, 'eq reads the active preset');
  api.s.eq.unsaved = true;
  check(/not saved/.test(await sw.eq.wait()), 'an unsaved EQ change: wait');
  api.s.eq.unsaved = false;
  await sw.eq.write('game');
  check(api.s.eq.activeId === 'game', 'eq preset switched and checked');
  await rejects(() => sw.eq.write('gone'), /preset is gone/, 'a deleted preset is refused');
  api.s.eqStuck = true;
  await rejects(() => sw.eq.write('flat'), /another preset/, 'Equalizer APO not taking it fails');
  api.s.eqStuck = false;
  api.s.eq.engine = 'none';
  check((await sw.eq.read()) === undefined, 'no Equalizer APO: nothing to switch');
  api.s.eq.engine = 'eqapo';

  // HDR
  const h = await sw.hdr.read({ id: 'S1' });
  check(h && h.on === false && h.name === 'AGON', 'hdr reads the named screen');
  check((await sw.hdr.read({ id: 'S2', screen: 2 })) === undefined, 'a screen without HDR: nothing');
  await sw.hdr.write({ id: 'S1', on: true });
  check(api.s.screens[0].hdr.on === true, 'HDR on, checked');
  api.s.hdrStuck = true;
  await rejects(() => sw.hdr.write({ id: 'S1', on: false }), /did not take HDR off/, 'Windows not taking HDR fails');
  api.s.hdrStuck = false;
  await rejects(() => sw.hdr.write({ id: 'S9', screen: 9, on: true }), /not there/, 'a screen that is gone is refused');
  api.s.pending = true;
  check(/waits for Keep/.test(await sw.hdr.wait()), 'a display change waiting for Keep: wait');
  api.s.pending = false;

  // notifications
  await sw.quiet.write(true);
  check(notif.value === 0 && (await sw.quiet.same(true, await sw.quiet.read())), 'quiet: notifications paused');
  await sw.quiet.write({ value: null });
  check(notif.value === null, 'quiet: put back to Windows default');
  notif.stuck = true;
  await rejects(() => sw.quiet.write(true), /another value/, 'Windows not taking it fails');
  notif.stuck = false;

  // nothing connected
  core.devices.mouse.status = 'missing';
  check(sw.dpi.read() === undefined && sw.polling.read() === undefined, 'mouse missing: nothing read');
  await rejects(() => sw.dpi.write(800), /not connected/, 'mouse missing: DPI write refused');
  core.devices.mouse.status = 'connected';

  // "Use now's settings"
  const v = await nowValues({ core, api, notifications: notif });
  check(v.dpi === 800 && v.polling === 4000 && v.lights === '#ff0000' && v.eq === 'game' && v.screens.length === 1 && v.quiet === false, `nowValues shape (${JSON.stringify(v)})`);

  // the engine: starts with no games set up and changes nothing
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-gml-'));
  writes.length = 0;
  const gm = startGameMode({ core, api, root, log: () => {}, every: () => 3600000, procs: async () => ['game.exe'] });
  const t = await gm.tick();
  check(t && t.idle === true && !writes.length, 'no games set up: idle, nothing written');
  fs.rmSync(root, { recursive: true, force: true });
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`game-mode-live (DPI, polling, lights, EQ, HDR, notifications, each checked): all ${n} passed`);
process.exit(0);
