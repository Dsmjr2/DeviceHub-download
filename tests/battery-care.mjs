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

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails.length ? `battery care: FAILED: ${fails.join('; ')}` : 'battery care (pretend devices): all good');
process.exit(fails.length ? 1 : 0);
