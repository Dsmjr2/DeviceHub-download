// Battery care (21 Oct 2026; helpers/battery-care.mjs), with a pretend core: no devices touched. At 20% the mouse's DPI
// light goes off and its polling to 1000 Hz, the headset's logos off; charging puts exactly that back; a setting changed
// by hand meanwhile is left alone; switched off in Settings, nothing is changed; a device already easy on its battery
// is not touched.
// Run: node tests/battery-care.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _test } from '../helpers/battery-care.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-batcare-'));
const settings = path.join(dir, 'settings.json'), file = path.join(dir, 'battery-care.json');
const writes = [], logs = [];
const dev = (id, kind, values, battery) => ({ id, status: 'connected', values, battery, adapter: { title: id === 'mouse' ? 'Test mouse' : 'Test headset', kind } });
const core = {
  devices: { mouse: dev('mouse', 'Mouse', { dpiEffect: 'steady', pollingRate: 4000 }, { percent: 18, charging: false }),
    headset: dev('headset', 'Headset', { logoBrightness: 40, micLight: true }, { percent: 50, charging: false }) },
  async write(id, key, value) { writes.push([id, key, value]); core.devices[id].values[key] = value; return value; },
  log(text) { logs.push(text); },
};
_test.set(core, file, settings);

fs.writeFileSync(settings, '{}');
await _test.tick();
check(writes.some(([i, k, v]) => i === 'mouse' && k === 'dpiEffect' && v === 'off') && writes.some(([i, k, v]) => i === 'mouse' && k === 'pollingRate' && v === 1000), `low mouse turned down: ${JSON.stringify(writes)}`);
check(!writes.some(([i]) => i === 'headset'), 'a headset at 50% is left alone');
check(JSON.parse(fs.readFileSync(file, 'utf8')).mouse?.items.length === 2, 'what was turned down is saved');
check(logs.some((l) => /battery 18%/.test(l) && /DPI light steady → off/.test(l) && /4000 Hz → 1000 Hz/.test(l)), `it says why: ${logs.join(' | ')}`);

writes.length = 0; await _test.tick();
check(!writes.length, 'nothing more while it stays low');

core.devices.mouse.battery = { percent: 19, charging: true };
await _test.tick();
check(writes.some(([i, k, v]) => i === 'mouse' && k === 'dpiEffect' && v === 'steady') && writes.some(([i, k, v]) => i === 'mouse' && k === 'pollingRate' && v === 4000), `charging puts it back: ${JSON.stringify(writes)}`);
check(!JSON.parse(fs.readFileSync(file, 'utf8')).mouse, 'nothing left saved');

// a setting changed by hand while low is left as it was changed
writes.length = 0; core.devices.headset.battery = { percent: 15, charging: false };
await _test.tick();
check(writes.some(([i, k, v]) => i === 'headset' && k === 'logoBrightness' && v === 0), 'low headset: logos off');
core.devices.headset.values.logoBrightness = 70;   // by hand
writes.length = 0; core.devices.headset.battery = { percent: 35, charging: false };
await _test.tick();
check(!writes.length, `a value changed by hand is not put back over (${JSON.stringify(writes)})`);

// switched off: nothing happens
writes.length = 0; fs.writeFileSync(settings, JSON.stringify({ batteryCare: false }));
core.devices.mouse.battery = { percent: 10, charging: false }; core.devices.mouse.values = { dpiEffect: 'breathing', pollingRate: 8000 };
await _test.tick();
check(!writes.length, 'switched off in Settings: nothing changed');

// already easy on its battery: nothing to do
fs.writeFileSync(settings, '{}'); core.devices.mouse.values = { dpiEffect: 'off', pollingRate: 1000 };
await _test.tick();
check(!writes.length, 'a mouse already at 1000 Hz with its light off is not touched');

// the headset charging (22 Oct 2026): all its lights off, whatever the switch says; back when it is unplugged
writes.length = 0; fs.writeFileSync(settings, JSON.stringify({ batteryCare: false }));
core.devices.headset.values = { logoBrightness: 60, micLight: true }; core.devices.headset.battery = { percent: 40, charging: true };
await _test.tick();
check(writes.some(([i, k, v]) => i === 'headset' && k === 'logoBrightness' && v === 0) && writes.some(([i, k, v]) => i === 'headset' && k === 'micLight' && v === false), `charging headset: lights off (${JSON.stringify(writes)})`);
check(JSON.parse(fs.readFileSync(file, 'utf8'))['headset:charging']?.items.length === 2, 'what was turned off while charging is saved');
writes.length = 0; await _test.tick();
check(!writes.length, 'nothing more while it keeps charging');
core.devices.headset.battery = { percent: 45, charging: false };
await _test.tick();
check(writes.some(([i, k, v]) => i === 'headset' && k === 'logoBrightness' && v === 60) && writes.some(([i, k, v]) => i === 'headset' && k === 'micLight' && v === true), `unplugged: lights back (${JSON.stringify(writes)})`);
check(!JSON.parse(fs.readFileSync(file, 'utf8'))['headset:charging'], 'nothing left saved after unplugging');

// ---------- devices added in my-devices (22 Oct 2026, docs/handoff/battery-added-devices.md) ----------
// Only a driver that declares batteryCare; only through its write gate (mayWrite), the maker's app closed and known to
// be, a backup first; put back the same way. The mouse and headset above are not touched by any of it.
{
  const order = [];
  let maker = {}, backupFails = false, readBackAs = null;
  const settingsList = [{ key: 'lights', label: 'Lights', type: 'toggle' }, { key: 'rate', label: 'Polling rate', type: 'choice', options: [{ value: 1000, label: '1000 Hz' }, { value: 4000, label: '4000 Hz' }] }, { key: 'sig', label: 'Signal', type: 'display' }];
  let allow = { ok: true };
  const pad = {
    id: 'pretend-pad', status: 'connected', values: { lights: true, rate: 4000, sig: 'Strong' }, battery: { percent: 50, charging: false },
    adapter: { id: 'pretend-pad', plugin: 'pretend-pad', title: 'Pretend pad', kind: 'Mouse', settings: settingsList, async battery() { return null; },
      batteryCare: { lowBattery: { key: 'rate', value: 1000 }, charging: { key: 'lights', value: false } }, mayWrite: () => allow },
  };
  const plain = { id: 'plain-pad', status: 'connected', values: { lights: true }, battery: { percent: 5, charging: false },
    adapter: { id: 'plain-pad', plugin: 'plain-pad', title: 'Plain pad', kind: 'Mouse', settings: [{ key: 'lights', label: 'Lights', type: 'toggle' }], async battery() { return null; } } };
  const mouse = dev('mouse', 'Mouse', { dpiEffect: 'off', pollingRate: 1000 }, { percent: 90, charging: false });
  const c2 = {
    devices: { mouse, 'pretend-pad': pad, 'plain-pad': plain },
    async backupNow(id, why) { order.push(['backup', id, why]); if (backupFails) throw new Error('disk full'); return 'file'; },
    async write(id, key, value) { order.push(['write', id, key, value]); const got = readBackAs ?? value; c2.devices[id].values[key] = got; return got; },
    log(text) { logs.push(text); },
  };
  fs.writeFileSync(settings, '{}');
  _test.set(c2, file, settings, { makerApp: async () => maker });
  const writesOf = () => order.filter((x) => x[0] === 'write');
  const reset = () => { order.length = 0; logs.length = 0; _test.forget(); };

  // not allowed now (Turn on settings not pressed): nothing backed up or written, one line, not again at once
  pad.battery = { percent: 15, charging: false }; allow = { ok: false, why: 'its settings are not turned on yet: press Turn on settings' };
  reset(); await _test.tick();
  check(!order.length, `not allowed: nothing backed up or written (${JSON.stringify(order)})`);
  check(logs.length === 1 && /not changed: its settings are not turned on yet/.test(logs[0]), `not allowed: one plain line (${logs.join(' | ')})`);
  logs.length = 0; await _test.tick();
  check(!logs.length && !order.length, 'not tried again on the next tick (it waits before trying again)');
  check(!_test.saved()['pretend-pad'], 'nothing saved when nothing was changed');

  // the maker's app open, or not known: nothing
  allow = { ok: true };
  for (const m of [{ app: 'G HUB' }, { unknown: 'tasklist did not answer' }]) {
    maker = m; reset(); await _test.tick();
    check(!order.length, `maker's app ${JSON.stringify(m)}: nothing backed up or written (${JSON.stringify(order)})`);
  }
  // no backup: nothing written
  maker = {}; backupFails = true; reset(); await _test.tick();
  check(order.length === 1 && order[0][0] === 'backup' && !writesOf().length, `no backup: nothing written (${JSON.stringify(order)})`);
  backupFails = false;

  // all clear: backup first, then the one setting the driver named, saved in the same shape as the mouse's
  reset(); await _test.tick();
  check(order.length === 2 && order[0][0] === 'backup' && order[1].join() === 'write,pretend-pad,rate,1000', `low: backup, then Polling rate to 1000 Hz (${JSON.stringify(order)})`);
  const s1 = JSON.parse(fs.readFileSync(file, 'utf8'))['pretend-pad'];
  check(s1 && Object.keys(s1).join() === 'at,items' && JSON.stringify(s1.items) === '[{"key":"rate","was":4000,"to":1000}]', `saved like the mouse's entry (${JSON.stringify(s1)})`);
  check(logs.some((l) => /Pretend pad: battery 15%, so Polling rate 4000 Hz → 1000 Hz to save it/.test(l)), `it says why (${logs.join(' | ')})`);
  check(!writesOf().some((w) => w[1] === 'mouse' || w[1] === 'plain-pad'), 'the mouse, and an added device without batteryCare (at 5%), are not touched');
  reset(); await _test.tick();
  check(!order.length, 'nothing more while it stays low');

  // charging: low battery's change put back first (through the gate again), then the charging rule's own setting
  pad.battery = { percent: 16, charging: true };
  reset(); await _test.tick();
  const w1 = writesOf().map((w) => `${w[2]}=${w[3]}`).join();
  check(w1 === 'rate=4000,lights=false', `charging: Polling rate back, then Lights off (${w1})`);
  check(order.filter((x) => x[0] === 'backup').length === 2 && order[0][0] === 'backup' && order[2][0] === 'backup', `a backup before each change (${JSON.stringify(order)})`);
  const s2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(!s2['pretend-pad'] && JSON.stringify(s2['pretend-pad:charging']?.items) === '[{"key":"lights","was":true,"to":false}]', `saved under "<id>:charging" like the headset's (${JSON.stringify(s2)})`);

  // unplugged while the maker's app is open: kept and tried again later; then put back once it is closed
  pad.battery = { percent: 60, charging: false }; maker = { app: 'G HUB' };
  reset(); await _test.tick();
  check(!writesOf().length && _test.saved()['pretend-pad:charging'], 'unplugged with the maker\'s app open: not put back yet, kept');
  check(logs.some((l) => /Lights not put back yet: G HUB is open/.test(l)), `one line says why (${logs.join(' | ')})`);
  maker = {}; order.length = 0; logs.length = 0; await _test.tick();
  check(!writesOf().length, 'not tried again at once');
  _test.forget(); await _test.tick();
  check(writesOf().map((w) => `${w[2]}=${w[3]}`).join() === 'lights=true' && order[0][0] === 'backup', `later, with the app closed: backup, Lights back on (${JSON.stringify(order)})`);
  check(!_test.saved()['pretend-pad:charging'], 'nothing left saved');

  // changed by hand while charging: left as it is
  pad.battery = { percent: 60, charging: true }; reset(); await _test.tick();
  pad.values.lights = true;   // by hand
  pad.battery = { percent: 61, charging: false }; reset(); await _test.tick();
  check(!writesOf().length && !_test.saved()['pretend-pad:charging'], `a value changed by hand is not put back over (${JSON.stringify(order)})`);

  // the device confirms another value: not saved, said once
  pad.values = { lights: true, rate: 4000 }; pad.battery = { percent: 12, charging: false }; readBackAs = 4000;
  reset(); await _test.tick();
  check(!_test.saved()['pretend-pad'] && logs.some((l) => /not changed: it read back 4000 Hz/.test(l)), `a write that reads back otherwise is not kept (${logs.join(' | ')})`);
  readBackAs = null;

  // switched off in Settings: no low-battery change (the charging rule still follows the driver, like the headset's)
  fs.writeFileSync(settings, JSON.stringify({ batteryCare: false }));
  reset(); await _test.tick();
  check(!order.length, 'switched off: no low-battery change');
  // a driver whose batteryCare names a value its setting does not take is never acted on
  pad.adapter.batteryCare = { lowBattery: { key: 'rate', value: 777 } }; fs.writeFileSync(settings, '{}');
  reset(); await _test.tick();
  check(!order.length, 'a batteryCare its setting cannot take is ignored');
}

// battery history for added devices (tests/battery-history.mjs; run here so test:offline covers it)
for (const f of await (await import('./battery-history.mjs')).run()) fails.push(`battery history: ${f}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails.length ? `battery care: FAILED: ${fails.join('; ')}` : 'battery care (pretend devices): all good');
process.exit(fails.length ? 1 : 0);
