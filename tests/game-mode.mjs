// Game mode (27 Oct 2026, helpers/game-mode.mjs) with stand-ins only: a pretend program list, pretend switches (DPI,
// polling, lights, EQ, HDR, notifications, a registry stand-in for the last) and an in-memory store. Nothing here starts
// a program, reads Windows or touches a device.
import { createRequire } from 'node:module';
import { createGameMode, cleanGames } from '../helpers/game-mode.mjs';

const require = createRequire(import.meta.url);
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// the pretend PC: every switch's value, a write log, and switches that can be "not there" or refuse
function pc(start = {}) {
  const p = { values: { dpi: 800, polling: 1000, lights: '#ff6a1a', eq: 'flat', hdr: { id: 'm1', screen: 'D1', on: false }, quiet: { value: 1 }, ...start }, writes: [], absent: new Set(), refuse: new Set(), waitWhy: {} };
  const sw = (k, { eq = (a, b) => JSON.stringify(a) === JSON.stringify(b), toValue = (v) => v } = {}) => ({
    wait: () => p.waitWhy[k] || null,
    read: () => (p.absent.has(k) ? undefined : clone(p.values[k])),
    same: (v, now) => eq(toValue(v), now),
    write: (v) => { if (p.refuse.has(k)) throw new Error('read back differs'); p.writes.push([k, clone(v)]); p.values[k] = clone(toValue(v)); },
  });
  p.switches = {
    dpi: sw('dpi'), polling: sw('polling'), lights: sw('lights'), eq: sw('eq'),
    hdr: sw('hdr', { toValue: (v) => ({ id: v.id, screen: v.screen, on: v.on }), eq: (a, b) => a.on === b.on }),
    // a registry stand-in: the setup's true = ToastEnabled 0; the saved value goes back as it was (null = not there)
    quiet: sw('quiet', { toValue: (v) => (v === true ? { value: 0 } : v) }),
  };
  return p;
}
function store(games, state = null) {
  const s = { games: clone(games), state: clone(state), saves: 0, backups: [] };
  s.api = { games: () => s.games, state: () => clone(s.state), save: (x) => { s.state = clone(x); s.saves++; }, backup: (d) => s.backups.push(clone(d)) };
  return s;
}
const VAL = { id: 'val', name: 'Valorant', exes: ['valorant-win64-shipping.exe'], setup: { dpi: 1600, polling: 4000, lights: '#ff0000', eq: 'fps', hdr: { id: 'm1', screen: 'D1', on: true }, quiet: true } };
const CS = { id: 'cs', name: 'Counter-Strike 2', exes: ['cs2.exe'], setup: { dpi: 400, eq: 'cs' } };
const make = (p, s, running, extra = {}) => createGameMode({ switches: p.switches, store: s.api, procs: async () => [...running.list], ...extra });

try {
  // 1. apply on start: every picked switch, its old value saved (state file + backup) before it changes
  {
    const p = pc(), s = store([VAL]), running = { list: ['explorer.exe'] };
    const gm = make(p, s, running);
    await gm.tick();
    check(p.writes.length === 0, 'nothing changes before the game starts');
    running.list.push('VALORANT-Win64-Shipping.exe');
    const r = await gm.tick();
    check(r.applied === 6 && p.writes.length === 6, `all six switches applied on start (${r.applied})`);
    check(p.values.dpi === 1600 && p.values.polling === 4000 && p.values.lights === '#ff0000' && p.values.eq === 'fps' && p.values.hdr.on === true && p.values.quiet.value === 0, 'the game\'s setup is on');
    check(s.state.before.dpi === 800 && s.state.before.eq === 'flat' && s.state.before.quiet.value === 1 && s.state.before.hdr.on === false, 'the values before are in the state file');
    check(s.backups.length && s.backups.at(-1).before.dpi === 800 && Object.keys(s.backups.at(-1).before).length === 6, 'one backup holds every value before');
    check(gm.status().active?.name === 'Valorant', 'status names the game');
    await gm.tick();
    check(p.writes.length === 6, 'a later check writes nothing again');
    // a change by hand mid-game is left alone
    p.values.dpi = 3200; await gm.tick();
    check(p.values.dpi === 3200 && p.writes.length === 6, 'a change made by hand during the game is not fought');
  }

  // 2. restore on quit: each saved value back, one at a time, state emptied
  {
    const p = pc(), s = store([VAL]), running = { list: ['valorant-win64-shipping.exe'] };
    const gm = make(p, s, running);
    await gm.tick();
    running.list = [];
    p.writes.length = 0;
    const r = await gm.tick();
    check(r.restored === 6, `six values put back (${r.restored})`);
    check(p.values.dpi === 800 && p.values.polling === 1000 && p.values.lights === '#ff6a1a' && p.values.eq === 'flat' && p.values.hdr.on === false && p.values.quiet.value === 1, 'everything is as it was');
    check(Object.keys(s.state.before).length === 0 && s.state.order.length === 0 && s.state.active === null, 'the state file is empty again');
    check(gm.status().active === null && !gm.status().restoring, 'status: nothing on');
  }

  // 3. notifications that were never set (no registry value) come back as not set
  {
    const p = pc({ quiet: { value: null } }), s = store([{ ...VAL, setup: { quiet: true } }]), running = { list: ['valorant-win64-shipping.exe'] };
    const gm = make(p, s, running);
    await gm.tick();
    check(p.values.quiet.value === 0, 'notifications paused');
    running.list = []; await gm.tick();
    check(p.values.quiet.value === null, 'the registry value is removed again (it was not there)');
  }

  // 4. restore after a restart (or sleep): a new engine reads the state file; the game is gone, so it puts back
  {
    const p = pc(), s = store([VAL]), running = { list: ['valorant-win64-shipping.exe'] };
    await make(p, s, running).tick();
    running.list = [];   // DeviceHub stopped; the game closed meanwhile
    const again = make(p, s, running);
    check(again.status().active?.name === 'Valorant', 'after a restart the saved state is read');
    await again.tick();
    check(p.values.dpi === 800 && p.values.eq === 'flat' && p.values.quiet.value === 1 && Object.keys(s.state.before).length === 0, 'after a restart with the game gone, everything is put back');
    // restart while the game still runs: nothing written again
    const p2 = pc(), s2 = store([VAL]), run2 = { list: ['valorant-win64-shipping.exe'] };
    await make(p2, s2, run2).tick();
    const n = p2.writes.length;
    await make(p2, s2, run2).tick();
    check(p2.writes.length === n && s2.state.before.dpi === 800, 'a restart mid-game keeps the old values and writes nothing again');
  }

  // 5. two games: the newest one's setup on top; the values before the FIRST come back at the end
  {
    const p = pc(), s = store([VAL, CS]), running = { list: ['valorant-win64-shipping.exe'] };
    const gm = make(p, s, running);
    await gm.tick();
    running.list.push('cs2.exe'); await gm.tick();
    check(p.values.dpi === 400 && p.values.eq === 'cs' && p.values.polling === 4000, 'the second game\'s setup on top of the first');
    check(s.state.before.dpi === 800 && s.state.before.eq === 'flat', 'the values before the first game are kept');
    check(gm.status().active?.name === 'Counter-Strike 2', 'status names the newest game');
    running.list = ['valorant-win64-shipping.exe']; await gm.tick();
    check(p.values.dpi === 1600 && p.values.eq === 'fps', 'the second quits: the first game\'s setup comes back');
    running.list = []; await gm.tick();
    check(p.values.dpi === 800 && p.values.eq === 'flat' && p.values.polling === 1000 && p.values.quiet.value === 1, 'both quit: the values before the first game');
    // the first quits while the second still runs: the second's setup stays, the first's other switches go back
    const q = pc(), t = store([VAL, CS]), r2 = { list: ['valorant-win64-shipping.exe'] };
    const gm2 = make(q, t, r2);
    await gm2.tick(); r2.list.push('cs2.exe'); await gm2.tick();
    r2.list = ['cs2.exe']; await gm2.tick();
    check(q.values.dpi === 400 && q.values.eq === 'cs' && q.values.polling === 1000 && q.values.quiet.value === 1 && q.values.hdr.on === false, 'the first quits: only the second game\'s switches stay');
    check(t.state.before.dpi === 800, 'and its DPI before the first game is still kept');
    r2.list = []; await gm2.tick();
    check(q.values.dpi === 800 && q.values.eq === 'flat', 'then everything as before the first game');
  }

  // 6. nothing for games that are not set up, and no program list asked for at all when none is
  {
    const p = pc(); let asked = 0;
    const s = store([{ id: 'x', name: 'Plain', exes: ['plain.exe'], setup: {} }]);
    const gm = createGameMode({ switches: p.switches, store: s.api, procs: async () => { asked++; return ['plain.exe', 'valorant-win64-shipping.exe']; } });
    const r = await gm.tick();
    check(r.idle && asked === 0 && p.writes.length === 0 && s.saves === 0, 'no game set up: no program list, no change, no file written');
    const s2 = store([CS]);
    const gm2 = createGameMode({ switches: p.switches, store: s2.api, procs: async () => ['valorant-win64-shipping.exe'] });
    await gm2.tick();
    check(p.writes.length === 0, 'a game that is not set up (Valorant here) changes nothing');
    check(gm2.exes().has('cs2.exe') && !gm2.exes().has('plain.exe'), 'auto-switch is told only the set-up games');
    // a set-up game removed while it runs: its values go back
    const p3 = pc(), s3 = store([CS]), r3 = { list: ['cs2.exe'] };
    const gm3 = make(p3, s3, r3);
    await gm3.tick();
    s3.games = []; gm3.reload(); await gm3.tick();
    check(p3.values.dpi === 800 && p3.values.eq === 'flat', 'a game removed from the list while it runs: everything goes back');
  }

  // 7. guards: a device change in progress, a Keep countdown, a device not there, a failed write, no program list
  {
    const p = pc(), s = store([VAL]), running = { list: ['valorant-win64-shipping.exe'] };
    let busy = 'a device change is in progress';
    const lines = [];
    const gm = make(p, s, running, { busy: () => busy, log: (t) => lines.push(t) });
    await gm.tick();
    check(p.writes.length === 0, 'nothing while a device change is in progress');
    busy = null;
    p.waitWhy.hdr = 'a display change waits for Keep';
    p.absent.add('dpi');
    p.refuse.add('eq');
    await gm.tick();
    check(p.values.hdr.on === false && !Object.hasOwn(s.state.before, 'hdr'), 'HDR waits for the Keep countdown');
    check(p.values.dpi === 800 && !Object.hasOwn(s.state.before, 'dpi'), 'the mouse not there: DPI waits, nothing saved for it');
    check(s.state.before.eq === 'flat' && p.values.eq === 'flat', 'a refused write leaves the value and keeps what to put back');
    check(lines.filter((l) => /waits/.test(l)).length === 1, 'one Activity line for the wait');
    delete p.waitWhy.hdr; p.absent.delete('dpi');
    await gm.tick(); await gm.tick();
    check(p.values.hdr.on === true && p.values.dpi === 1600, 'once the guard is gone, the change is made');
    check(lines.some((l) => /EQ did not change/.test(l)), 'after three refusals it says so once and stops trying');
    running.list = []; p.refuse.clear(); await gm.tick();
    check(p.values.eq === 'flat' && p.values.dpi === 800 && p.values.hdr.on === false && Object.keys(s.state.before).length === 0, 'everything put back, the refused one included');
    // no program list: nothing changes, nothing is put back by mistake
    const p2 = pc(), s2 = store([VAL]);
    let ok = true;
    const gm2 = createGameMode({ switches: p2.switches, store: s2.api, procs: async () => { if (!ok) throw new Error('helper restarting'); return ['valorant-win64-shipping.exe']; } });
    await gm2.tick(); ok = false; const before = p2.writes.length; await gm2.tick();
    check(p2.writes.length === before && p2.values.dpi === 1600, 'no program list: the game\'s setup stays as it is');
  }

  // 8. the saved list: only real values, program names lowercase, a game with nothing to look for refused
  {
    const g = cleanGames([{ name: ' Valorant ', exes: ['VALORANT-Win64-Shipping.exe', 'bad\\path.exe', 'notes.txt'], setup: { dpi: 1600, polling: 999, lights: 'red', eq: 'fps', hdr: { screen: 'D1', on: 'yes' }, quiet: false, extra: 1 } }]);
    check(g[0].name === 'Valorant' && g[0].exes.join() === 'valorant-win64-shipping.exe', 'names trimmed, program names checked and lowercase');
    check(JSON.stringify(Object.keys(g[0].setup)) === '["dpi","eq"]', `only values a switch takes are kept (${Object.keys(g[0].setup)})`);
    let threw = false; try { cleanGames([{ name: 'X', exes: [] }]); } catch { threw = true; }
    check(threw, 'a game with no program is refused');
  }

  // 9. the notifications helper with a registry stand-in: read, set, and removing a value that was not there
  {
    const n = require('../helpers/notifications.js');
    const reg = { value: null, calls: [] };
    n._test.setRun(async (args) => {
      reg.calls.push(args.join(' '));
      if (args[0] === 'query') { if (reg.value === null) { const e = new Error('not found'); e.code = 1; throw e; } return `\r\n${n.KEY}\r\n    ToastEnabled    REG_DWORD    0x${reg.value.toString(16)}\r\n`; }
      if (args[0] === 'add') { reg.value = Number(args[args.indexOf('/d') + 1]); return 'ok'; }
      if (args[0] === 'delete') { if (reg.value === null) { const e = new Error('not found'); e.code = 1; throw e; } reg.value = null; return 'ok'; }
      throw new Error('unexpected');
    });
    check((await n.read()) === null, 'no value reads as null');
    await n.set(0); check((await n.read()) === 0, 'paused reads back 0');
    await n.set(null); check((await n.read()) === null && reg.calls.some((c) => c.startsWith('delete')), 'put back as not there');
    check(reg.calls.every((c) => c.includes('PushNotifications') && c.includes('ToastEnabled')), 'only the one value is touched');
    let threw = false; try { await n.set(5); } catch { threw = true; }
    check(threw, 'only 0 or 1 is written');
  }
} catch (e) { fails.push(`threw: ${e.stack}`); }

if (fails.length) { console.error('game-mode: FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('game-mode: apply on start, restore on quit, restore after restart, two games, nothing for unset games, guards, saved list, notifications value: all passed');
