// Profiles and added devices (22 Oct 2026; docs/handoff/profiles-added-devices.md). No hardware: pretend adapters in the
// core's device list, the core's write path with its backup route stubbed.
//  1. A profiles.json in the shape of Shawn's (three built-in devices only, no `added`): the same rows, writes, counts and
//     Activity line as before, and a profile naming an added device that is not here changes nothing about that.
//  2. Capture: readings never, colors and remaps as values, only connected added devices.
//  3. Apply: backup first, one setting at a time, read back; read-only, Turn on settings, a reading, a bad value, the
//     maker's app open or unknown, a failed backup: skipped with ONE Activity line; not plugged in: quiet.
//  4. The real guard (helpers/my-devices.mjs guard): Turn on settings and the self-check decide what a profile writes.
// Run: node tests/profiles-added.mjs (tests/my-devices.mjs runs it too; it runs tests/profile-use.mjs at the end)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function run() {
  const fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  const { env } = await import('../public/core/env.js');
  const core = await import('../public/core/devices.js');
  const P = await import('../public/core/profiles.js');
  const { applyAdded } = await import('../helpers/profile-added.mjs');
  const md = await import('../helpers/my-devices.mjs');

  // ---- the stubbed server: backups and Activity recorded in order with the writes
  const events = [];
  let backupFails = false;
  const saved = { api: env.api, agent: env.agent, applyAdded: env.applyAdded, toast: env.toast };
  env.toast = () => ({ update() {}, close() {}, done() {}, fail() {} });
  env.api = async (p, body) => {
    if (p === '/api/backup') { if (backupFails) throw new Error('disk full'); events.push(`backup ${body.device}`); return { file: 'C:\\x\\backups\\b.json' }; }
    if (p === '/api/activity') return [];
    if (p === '/api/monitors') return [];
    throw new Error(`unexpected call ${p}`);
  };
  const lines = () => core.activity.map((a) => a.text);
  const clear = () => { events.length = 0; core.activity.length = 0; };
  const reg = (a, status = 'connected', values) => { core.register(a); core.devices[a.id].status = status; core.devices[a.id].values = values || { ...a._state }; return a; };
  const builtIn = (id, state) => ({ id, title: id, kind: id[0].toUpperCase() + id.slice(1), _state: { ...state },
    async read() { return { ...this._state }; }, async write(k, v) { events.push(`write ${id}.${k}=${JSON.stringify(v)}`); this._state[k] = v; return v; } });

  // ================= 1. Shawn's file shape, built-in devices only =================
  const SHAPE = [
    { name: 'Aim', color: '#8299a8', games: [], devices: { mouse: { pollingRate: 8000 } }, savedAt: '2026-10-20T12:00:00.000Z' },
    { name: 'Game', color: '#c47b55', games: ['SomeGame-Win64-Shipping.exe'], devices: { mouse: { pollingRate: 1000 } }, savedAt: '2026-10-21T12:00:00.000Z' },
  ];
  const file = JSON.parse(JSON.stringify(SHAPE));
  const mouse = reg(builtIn('mouse', { pollingRate: 1000 }));
  reg(builtIn('headset', {}), 'missing', {});
  reg(builtIn('keyboard', {}), 'missing', {});
  clear();
  check(JSON.stringify(P.diff(file[0])) === JSON.stringify([{ id: 'mouse', key: 'pollingRate', from: 1000, to: 8000, ready: true }]), `the old shape's diff is the same rows as before (${JSON.stringify(P.diff(file[0]))})`);
  check(P.diff(file[1]).length === 0, 'a profile that already matches has no rows');
  let r = await P.apply(file[0]);
  check(JSON.stringify(r) === JSON.stringify({ done: 1, failed: 0, skipped: 0, asleep: 0 }), `apply answers as before (${JSON.stringify(r)})`);
  check(events.join() === 'backup mouse,write mouse.pollingRate=8000', `backup, then the one write (${events.join()})`);
  check(lines().join(' | ') === 'Profile "Aim": 1 changed | Polling rate → 8000 Hz', `the same Activity lines as before (${lines().join(' | ')})`);
  check(JSON.stringify(file) === JSON.stringify(SHAPE), 'applying never changes the profile itself');
  // the keyboard is not connected: skipped and counted, exactly as before
  clear();
  r = await P.apply({ name: 'Keys', devices: { keyboard: { brightness: 10 } } });
  check(r.skipped === 1 && r.done === 0 && lines()[0] === 'Profile "Keys": 0 changed, 1 skipped (device not connected)', `a built-in device not connected is still counted (${JSON.stringify(r)} ${lines()[0]})`);
  // keys that are not profile keys stay ignored; an `added` entry for a device that is not here changes nothing
  clear();
  mouse._state.pollingRate = 1000; core.devices.mouse.values = { pollingRate: 1000 };
  const withAbsent = { ...JSON.parse(JSON.stringify(SHAPE[0])), added: { 'gone-mouse': { title: 'Gone', values: { dpi: 800 } } } };
  check(JSON.stringify(P.diff(withAbsent)) === JSON.stringify(P.diff(SHAPE[0])), 'an added device not plugged in adds no rows');
  r = await P.apply(withAbsent);
  check(r.done === 1 && r.skipped === 0 && lines().join(' | ') === 'Profile "Aim": 1 changed | Polling rate → 8000 Hz', `an added device not plugged in is left out quietly (${JSON.stringify(r)} ${lines().join(' | ')})`);
  check(Object.keys(P.captureAdded()).length === 0, 'the built-in devices are never captured as added devices');

  // ================= 2-3. an added device =================
  env.agent = true;
  let maker = {};
  env.applyAdded = (b) => applyAdded(b, { core, makerApp: async () => maker });
  const deny = new Set();
  const light = {
    id: 'test-light', title: 'Test light', kind: 'Light', plugin: 'test-light',
    settings: [
      { key: 'bright', label: 'Brightness', type: 'slider', min: 0, max: 100, unit: '%' },
      { key: 'on', label: 'Lights on', type: 'toggle' },
      { key: 'mode', label: 'Mode', type: 'choice', options: [{ value: 1, label: 'Still' }, { value: 2, label: 'Wave' }] },
      { key: 'logo', label: 'Logo', type: 'color' },
      { key: 'zones', label: 'Lights', type: 'color', zones: [{ value: 'wheel', label: 'Wheel' }, { value: 'base', label: 'Base' }] },
      { key: 'keys', label: 'Buttons', type: 'remap', buttons: [{ value: 'side', label: 'Side' }], targets: [{ value: 'back', label: 'Back' }, { value: 'fwd', label: 'Forward' }] },
      { key: 'mix', label: 'ChatMix', type: 'display' },
      { key: 'locked', label: 'Locked', type: 'slider', min: 0, max: 10, readOnly: true },
    ],
    _state: { bright: 40, on: true, mode: 1, logo: '#112233', zones: { wheel: '#000000', base: '#ffffff' }, keys: { side: 'back' }, mix: 50, locked: 3 },
    lie: null,
    async connect() { return true; }, async info() { return {}; },
    async read() { return JSON.parse(JSON.stringify(this._state)); },
    async write(k, v) {
      events.push(`write ${k}=${JSON.stringify(v)}`);
      this._state[k] = this.lie === k ? 99 : JSON.parse(JSON.stringify(v));
      return (await this.read())[k];   // read back
    },
    mayWrite(k) { return deny.has(k) ? { ok: false, gated: true, why: 'press Turn on settings' } : this.settings.find((s) => s.key === k)?.readOnly ? { ok: false, why: 'its self-check did not pass' } : { ok: true }; },
  };
  reg(light);
  const cap = P.captureAdded();
  check(cap['test-light'] && !('mix' in cap['test-light'].values) && cap['test-light'].title === 'Test light', `capture leaves the reading out (${JSON.stringify(cap)})`);
  check(JSON.stringify(cap['test-light'].values.zones) === '{"wheel":"#000000","base":"#ffffff"}' && cap['test-light'].values.zones !== core.devices['test-light'].values.zones && cap['test-light'].values.keys.side === 'back', 'colors and remaps are captured as values (copies)');
  check(cap['test-light'].values.locked === 3, 'a read-only setting is captured; whether it is written is decided on apply');

  const prof = { name: 'Night', devices: {}, added: { 'test-light': { title: 'Test light', values: {
    bright: 10, on: true, logo: '#ff8800', zones: { wheel: '#ff0000', base: '#ffffff' }, keys: { side: 'fwd' }, mix: 10, locked: 5, mode: 7, gone: 1,
  } } } };
  const rows = P.diff(prof);
  const live = rows.filter((x) => !x.blocked).map((x) => x.key).join();
  check(live === 'bright,logo,zones,keys', `diff: only what differs and may be written (${live})`);
  check(rows.filter((x) => x.blocked).map((x) => x.key).sort().join() === 'gone,locked,mix,mode', `diff: the rest is shown as skipped (${rows.filter((x) => x.blocked).map((x) => `${x.key}:${x.blocked}`).join(', ')})`);
  check(rows.find((x) => x.key === 'zones').toText === 'Wheel #ff0000, Base #ffffff' && rows.find((x) => x.key === 'keys').toText === 'Side: Forward' && rows.find((x) => x.key === 'bright').toText === '10 %', 'values shown in plain words');
  clear();
  r = await P.apply(prof);
  check(events.join() === 'backup test-light,write bright=10,write logo="#ff8800",write zones={"wheel":"#ff0000","base":"#ffffff"},write keys={"side":"fwd"}', `backup first, then one setting at a time (${events.join()})`);
  check(r.done === 4 && r.failed === 0 && r.skipped === 0, `counted as changes; skipped settings are not "device not connected" (${JSON.stringify(r)})`);
  const skipLines = lines().filter((l) => l.includes('skipped'));
  check(skipLines.length === 1 && /Test light: skipped/.test(skipLines[0]) && /ChatMix \(a reading, never written\)/.test(skipLines[0]) && /Locked \(read-only until its check passes\)/.test(skipLines[0]) && /Mode \(not a value it takes\)/.test(skipLines[0]) && /gone \(not on this device now\)/.test(skipLines[0]), `ONE plain line for what was skipped (${skipLines.join(' | ')})`);
  check(lines().includes('Profile "Night": 4 changed'), `the summary line (${lines().join(' | ')})`);
  check(light._state.locked === 3 && light._state.mix === 50 && light._state.mode === 1, 'nothing skipped was written');
  // applying again: nothing differs, nothing written
  clear();
  r = await P.apply(prof);
  check(r.done === 0 && !events.some((e) => e.startsWith('write')), `applying the same profile again writes nothing (${events.join()})`);

  // Turn on settings not pressed
  deny.add('bright'); light._state.bright = 40; core.devices['test-light'].values.bright = 40;
  clear();
  r = await P.apply(prof);
  check(r.done === 0 && !events.length && lines().some((l) => /Brightness \(press Turn on settings on its page first\)/.test(l)), `waiting for Turn on settings: skipped and said so (${lines().join(' | ')})`);
  deny.clear();
  // the maker's app open, or unknown
  for (const [m, re] of [[{ app: 'Maker Hub' }, /Maker Hub is open: close it first/], [{ unknown: 'tasklist did not answer' }, /could not check whether the maker's app is open/]]) {
    maker = m; clear();
    r = await P.apply(prof);
    check(r.done === 0 && !events.length && lines().filter((l) => l.includes('skipped')).length === 1 && lines().some((l) => re.test(l)), `maker's app ${JSON.stringify(m)}: nothing backed up or written, one line (${lines().join(' | ')})`);
  }
  maker = {};
  // a failed backup: nothing written
  backupFails = true; clear();
  r = await P.apply(prof);
  check(r.done === 0 && !events.some((e) => e.startsWith('write')) && lines().some((l) => /no backup could be taken/.test(l)), `no backup, no write (${events.join()} ${lines().join(' | ')})`);
  backupFails = false;
  // a write that reads back something else: failed, and said so
  light.lie = 'bright'; clear();
  r = await P.apply(prof);
  check(r.failed === 1 && r.done === 0 && lines().some((l) => /Brightness read back 99 %, not 10 %/.test(l)), `a read-back that differs fails (${JSON.stringify(r)} ${lines().join(' | ')})`);
  light.lie = null;
  // asleep / unplugged: quiet
  for (const st of ['asleep', 'missing']) {
    light._state.bright = 40; core.devices['test-light'].values.bright = 40; core.devices['test-light'].status = st; clear();
    r = await P.apply(prof);
    check(r.done === 0 && r.skipped === 0 && !events.length && lines().length === 1 && lines()[0] === 'Profile "Night": 0 changed', `${st}: left out quietly (${lines().join(' | ')})`);
    check(P.diff(prof).length === 0, `${st}: no rows in the preview`);
  }
  core.devices['test-light'].status = 'connected';
  // auto-switch's quiet retry never touches added devices
  clear();
  r = await P.apply(prof, { retry: true });
  check(!events.length && !lines().length, 'a quiet retry leaves added devices alone');
  // the agent op's path for an id that is not registered: quiet
  r = await applyAdded({ id: 'nobody', values: { x: 1 }, name: 'N' }, { core });
  check(r.absent && r.done === 0, 'an unknown id is left out quietly');
  // a person's own driver (no guard): its readOnly mark decides
  const own = reg({ id: 'own-pad', title: 'Own pad', kind: 'Pad', plugin: 'own-pad', settings: [{ key: 'a', label: 'A', type: 'toggle' }, { key: 'b', label: 'B', type: 'toggle', readOnly: true }],
    _state: { a: false, b: false }, async read() { return { ...this._state }; }, async write(k, v) { events.push(`write ${k}`); this._state[k] = v; return v; } });
  clear();
  r = await applyAdded({ id: 'own-pad', values: { a: true, b: true }, name: 'P' }, { core, makerApp: async () => ({}) });
  check(r.done === 1 && own._state.a === true && own._state.b === false && lines().some((l) => /B \(read-only until its check passes\)/.test(l)), `own driver: readOnly is skipped (${JSON.stringify(r)})`);
  check(JSON.stringify(await md.makerAppNow({ id: 'x', settings: [] })) === '{}', 'makerAppNow: a driver with no vendor id and no check of its own runs nothing');

  // ================= 4. the real guard =================
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-prof-'));
  try {
    const folder = path.join(tmp, 'my-devices', 'guarded-pad');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ status: 'read-only', source: 'test' }));
    const pad = (id) => ({ id, title: 'Guarded pad', kind: 'Pad', plugin: 'guarded-pad', settings: [{ key: 'a', label: 'A', type: 'toggle' }, { key: 'b', label: 'B', type: 'toggle' }],
      _state: { a: false, b: false }, async connect() { return true; }, async info() { return {}; }, async read() { return { ...this._state }; }, async write(k, v) { events.push(`write ${k}`); this._state[k] = v; return v; } });
    const g = pad('guarded-pad');
    md.guard(g, folder, md.libraryMark(folder), { log: () => {}, makerApp: async () => null, backup: async () => {}, version: 'test' });
    check(typeof g.mayWrite === 'function' && g.mayWrite('a').gated, 'guard: mayWrite gives the write\'s own answer (Turn on settings first)');
    reg(g);
    clear();
    r = await applyAdded({ id: 'guarded-pad', values: { a: true, b: true }, name: 'G' }, { core, makerApp: async () => ({}) });
    check(r.done === 0 && !events.length && lines().some((l) => /Guarded pad: skipped A \(press Turn on settings on its page first\), B \(press Turn on settings/.test(l)), `guarded, not turned on: nothing written (${lines().join(' | ')})`);
    // turned on, A passed its self-check, B failed it
    const mark = md.libraryMark(folder);
    fs.writeFileSync(path.join(folder, 'library.json'), JSON.stringify({ ...mark, settingsOn: { at: '2026-10-22T10:00:00.000Z' } }));
    fs.writeFileSync(path.join(folder, 'verified.json'), JSON.stringify({ checkedAt: '2026-10-22T10:00:00.000Z', devicehub: 'test', keys: { a: { ok: true, value: false, readBack: false }, b: { ok: false, why: 'it read back wrong' } } }));
    const g2 = pad('guarded-pad2');
    md.guard(g2, folder, md.libraryMark(folder), { log: () => {}, makerApp: async () => null, backup: async () => {}, version: 'test' });
    reg(g2);
    clear();
    r = await applyAdded({ id: 'guarded-pad2', values: { a: true, b: true }, name: 'G' }, { core, makerApp: async () => ({}) });
    check(r.done === 1 && g2._state.a === true && g2._state.b === false && events.join() === 'backup guarded-pad2,write a' && lines().some((l) => /B \(read-only until its check passes\)/.test(l)), `guarded, turned on: only the setting that passed is written (${events.join()} | ${lines().join(' | ')})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // put things back for whoever imported this
  for (const id of ['mouse', 'headset', 'keyboard', 'test-light', 'own-pad', 'guarded-pad', 'guarded-pad2']) delete core.devices[id];
  Object.assign(env, saved);
  core.activity.length = 0;
  // "When to use it" on the Profiles page (tests/profile-use.mjs; it runs here so test:offline covers it)
  for (const f of await (await import('./profile-use.mjs')).run()) fails.push(`when to use it: ${f}`);
  return fails;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const fails = await run();
  console.log(fails.length ? `profiles-added: FAILED: ${fails.join('; ')}` : 'profiles-added (profiles for added devices): all good');
  process.exit(fails.length ? 1 : 0);
}
