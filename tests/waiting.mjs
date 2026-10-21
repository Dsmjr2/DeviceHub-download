// Changes made while a device is away (21 Oct 2026): with a stand-in device, no hardware. Checks a change made while
// it sleeps waits (shown as made, saved, one log line), the last change to a setting wins, nothing is written while it
// sleeps, everything is written (backed up first) the moment it wakes, a refused change is dropped and reported, a
// device that goes to sleep during a write keeps the change waiting, a drag step is never kept, and the saved list is
// picked up again after a restart.
// Run: node tests/waiting.mjs
import { env } from '../public/core/env.js';
import * as core from '../public/core/devices.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the agent's side: backups and activity go nowhere, the saved list is kept here
let saved = null, backups = 0;
env.agent = true;
env.api = async (p) => { if (p === '/api/backup') { backups++; return { file: 'stand-in.json' }; } return {}; };
env.toast = () => ({ update() {}, close() {} });
env.saveWaiting = (w) => { saved = JSON.parse(JSON.stringify(w)); };

// a stand-in device: asleep until woken; writes are recorded; 'bad' is refused like an out-of-range value
let awake = false, sleepOnNextWrite = false;
const device = { light: 5, speed: 3 };
const written = [];
const adapter = {
  id: 'mouse', title: 'Stand-in mouse', kind: 'Mouse',
  async connect() { return true; },
  async info() { return { Model: 'stand-in' }; },
  async read() { if (!awake) throw new Error('mouse is asleep or out of range: move it and retry'); return { ...device }; },
  async write(key, value) {
    if (!awake) throw new Error('mouse is asleep or out of range: move it and retry');
    if (sleepOnNextWrite) { sleepOnNextWrite = false; awake = false; throw new Error('mouse is asleep or out of range: move it and retry'); }
    if (value === 'bad') throw new Error(`${value} is not a valid ${key}`);
    written.push([key, value]); device[key] = value; return value;
  },
};
core.register(adapter);
const d = core.devices.mouse;

// 1. it was read once, then went to sleep
awake = true; await core.connect('mouse');
check(d.status === 'connected', `connected first (${d.status})`);
awake = false; await core.refresh('mouse', { quiet: true });
check(d.status === 'asleep', `asleep after a failed read (${d.status})`);

// 2. changes while asleep wait; the last change to a setting wins; a drag step is not kept
const b0 = backups;
const r1 = await core.write('mouse', 'light', 7, { label: 'Light', display: '7' });
await core.write('mouse', 'light', 9, { label: 'Light', display: '9' });
await core.write('mouse', 'speed', 1, { label: 'Speed', display: '1', live: true });
check(r1 === 7, 'a waiting change answers with its value');
check(d.values.light === 9, `shown as made (${d.values.light})`);
check(d.values.speed === 3, `a drag step while asleep changes nothing (${d.values.speed})`);
check(saved?.mouse?.light?.value === 9 && !saved?.mouse?.speed, `saved: ${JSON.stringify(saved)}`);
check(d.waiting.length === 1 && d.waiting[0].key === 'light', `the page's list: ${JSON.stringify(d.waiting)}`);
check(written.length === 0 && backups === b0, 'nothing written or backed up while asleep');
check(core.activity.some((a) => /Light → 9 \(applied when the mouse is back\)/.test(a.text)), 'one log line says it waits');

// 3. a refused change waits too, then is dropped and reported on wake; the good one is written after one backup
await core.write('mouse', 'speed', 'bad', { label: 'Speed', display: 'bad' });
awake = true; await core.refresh('mouse', { quiet: true });
await sleep(900);
check(d.status === 'connected', `awake again (${d.status})`);
check(written.some(([k, v]) => k === 'light' && v === 9) && device.light === 9, `written on wake: ${JSON.stringify(written)}`);
check(backups === b0 + 1, `one backup before the waiting changes (${backups - b0})`);
check(!saved?.mouse, `nothing left waiting: ${JSON.stringify(saved)}`);
check(d.waiting.length === 0, 'the page list is empty');
check(core.activity.some((a) => /Speed not changed: bad is not a valid speed/.test(a.text)), 'the refused one is reported');
check(core.activity.some((a) => /Light → 9 \(made while it was away\)/.test(a.text)), 'the applied one is logged');

// 4. it falls asleep in the middle of a write: the change waits instead of failing
sleepOnNextWrite = true;
let threw = null;
try { await core.write('mouse', 'light', 2, { label: 'Light', display: '2' }); } catch (e) { threw = e; }
check(!threw, `no error when it falls asleep during a write (${threw?.message})`);
check(saved?.mouse?.light?.value === 2, 'and it is waiting');

// 5. a restart: the saved list comes back with the device's page list
const again = JSON.parse(JSON.stringify(saved));
core.restoreWaiting(again);
check(core.waitingFor('mouse').light?.value === 2 && d.waiting.length === 1, 'the saved list is picked up again');

// 6. Undo (21 Oct 2026): awake again, the waiting change applied; a change, then Undo, puts the earlier value back;
//    a slider drag (steps, then the release) undoes to where the drag started; a waiting change is not undoable on
//    its own (it was recorded when made)
awake = true; await core.refresh('mouse', { quiet: true }); await sleep(900);
check(device.light === 2, `the waiting light applied on wake (${device.light})`);
await sleep(15100);   // a separate change from the one recorded before (changes to one setting within 15 s merge)
await core.write('mouse', 'speed', 4, { label: 'Speed', display: '4' });
check(d.undo?.label === 'Speed', `Undo offers the last change (${JSON.stringify(d.undo)})`);
await core.undo('mouse');
check(device.speed === 3, `Undo put the speed back (${device.speed})`);
for (const v of [5, 6, 7]) await core.write('mouse', 'speed', v, { live: true });
await core.write('mouse', 'speed', 8, { label: 'Speed', display: '8' });
check(device.speed === 8, 'the drag landed');
await core.undo('mouse');
check(device.speed === 3, `Undo after a drag goes back to before the drag (${device.speed})`);

console.log(fails.length ? `waiting changes: FAILED: ${fails.join('; ')}` : 'waiting changes (stand-in device): all good');
process.exit(fails.length ? 1 : 0);
