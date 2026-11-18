// Offline test (15 Nov 2026 bug hunt): auto-switch (public/core/autoswitch.js) with stand-in devices and API, the real
// profiles.js and devices.js. A game starts while the mouse is asleep and the keyboard refuses one setting:
// - the quiet retry tries only what was left over, never the whole profile again (it undid a volume set by hand)
// - a refused setting is not reported as "finishes when the mouse wakes", and is tried at most 3 times more
// - a device that goes from asleep to missing keeps its changes waiting (not "went through")
// - one empty process list (tasklist failing) is not "game closed"
import { env } from '../public/core/env.js';
import * as core from '../public/core/devices.js';
import * as A from '../public/core/autoswitch.js';

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const events = [];
let procs = [];
const profiles = [
  { name: 'Valorant', games: ['valorant.exe'], devices: { mouse: { pollingRate: 8000 }, headset: { 'vol:playback': 30 }, keyboard: { effect: 5 } } },
  { name: 'Desktop', games: [], devices: { mouse: { pollingRate: 1000 }, headset: { 'vol:playback': 60 } } },
];
env.agent = true;
env.toast = () => ({ update() {}, close() {}, done() {}, fail() {} });
env.api = async (p, body) => {
  if (p === '/api/settings') return { autoSwitch: true, defaultProfile: 'Desktop' };
  if (p === '/api/processes') { if (procs === null) throw new Error('tasklist failed'); return procs; }
  if (p === '/api/profiles') return profiles;
  if (p.startsWith('/api/games')) return p.includes('titles') ? {} : [];
  if (p === '/api/backup') { events.push(`backup ${body.device}`); return { file: 'x\\b.json' }; }
  if (p === '/api/wifi-pause/profile') return {};
  if (p === '/api/activity') return [];
  throw new Error(`unexpected ${p}`);
};
const reg = (id, status, state, refuse) => {
  const a = { id, title: id, kind: id, _s: { ...state }, async read() { return { ...this._s }; },
    async write(k, v) { if (refuse?.(k)) { events.push(`REFUSED ${id}.${k}`); throw new Error('refused by device'); } events.push(`write ${id}.${k}=${v}`); this._s[k] = v; return v; } };
  core.register(a); core.devices[id].status = status; core.devices[id].values = { ...state }; return a;
};
reg('mouse', 'asleep', { pollingRate: 1000 });
reg('headset', 'connected', { 'vol:playback': 60 });
reg('keyboard', 'connected', { effect: 1 }, (k) => k === 'effect');
let tick;
globalThis.setInterval = (fn) => { tick = fn; };
A.startAutoSwitch();
await new Promise((r) => setTimeout(r, 20));
const step = async () => { events.length = 0; core.activity.length = 0; await tick(); return { ev: [...events], logs: core.activity.map((a) => [a.kind, a.text]) }; };

try {
  procs = ['valorant.exe'];
  let s = await step();
  check(s.ev.includes('write headset.vol:playback=30'), 'the game starts: its profile is applied');
  const first = s.logs.find(([, t]) => /Valorant profile/.test(t) && /started/.test(t));
  check(first && first[0] === 'bad' && !/finishes when it wakes/.test(first[1]), `a refused keyboard setting is reported as failed, not as waiting for the mouse (${first?.[0]} ${first?.[1]})`);

  // the person turns the volume up by hand while the mouse still sleeps
  await core.write('headset', 'vol:playback', 75, { silent: true });
  s = await step();
  check(!s.ev.some((e) => /headset\.vol:playback/.test(e)), `the retry leaves a setting changed by hand alone (${s.ev.join(', ')})`);
  let refusedTries = s.ev.filter((e) => /REFUSED keyboard\.effect/.test(e)).length;
  for (let i = 0; i < 5; i++) { s = await step(); refusedTries += s.ev.filter((e) => /REFUSED keyboard\.effect/.test(e)).length; }
  check(refusedTries <= 3, `a refused setting is tried at most 3 more times while the mouse sleeps (${refusedTries})`);
  check(!s.ev.some((e) => /^backup /.test(e)), `no more backups once nothing is left to try but the sleeping mouse (${s.ev.join(', ')})`);

  // the mouse goes from asleep to missing (receiver unplugged): its change still waits
  core.devices.mouse.status = 'missing';
  s = await step();
  check(!s.logs.some(([, t]) => /went through/.test(t)) && A.auto.retry === 'Valorant', 'a device gone missing keeps its change waiting, not "went through"');
  core.devices.mouse.status = 'connected';
  s = await step();
  check(s.ev.includes('write mouse.pollingRate=8000'), `the mouse back: its change is written (${s.ev.join(', ')})`);
  check(s.logs.some(([k, t]) => k === 'good' && /went through/.test(t)) && !A.auto.retry, 'and the profile is finished');
  check(core.devices.headset.values['vol:playback'] === 75, 'the volume set by hand is still 75');

  // one failed process list is not "game closed"
  procs = null;
  s = await step();
  check(!s.ev.some((e) => /^write/.test(e)) && A.auto.active === 'Valorant', 'a failed process list changes nothing');
  procs = [];
  s = await step();
  check(!s.ev.some((e) => /^write/.test(e)) && A.auto.active === 'Valorant', 'one empty process list is not "game closed"');
  procs = ['valorant.exe'];
  s = await step();
  check(!s.ev.some((e) => /^write/.test(e)), 'the game seen again: nothing to change');
  procs = [];
  await step();
  s = await step();
  check(s.ev.includes('write headset.vol:playback=60') && A.auto.active === null, `two empty lists in a row: game closed, the default profile applied (${s.ev.join(', ')})`);
  // the server's program list fails instead of answering an empty list when tasklist fails or times out (so neither
  // auto-switch nor a game settings load mistakes "could not look" for "no game running")
  const srv = (await import('node:fs')).readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  check(/execFile\('tasklist'[^\n]*\(err, out\) => \{\s*if \(err\) return reject\(/.test(srv), 'a failed tasklist is an error, not an empty list');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`autoswitch (retry only what is left, refused vs asleep, missing device, empty process list): all ${n} passed`);
process.exit(0);
