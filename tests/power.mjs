// Offline test: helpers/power.js — battery saver 3x factor/every, batterySaver setting override,
// onChange notifications on battery/saver transitions, and clean start/stop timer handling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-power-'));
const settingsFile = path.join(T, 'settings.json');
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

let power = null;
try {
  power = require('../helpers/power.js');
  const events = [];
  power.onChange((saving) => events.push(saving));

  let mockPower = { hasBattery: false, onBattery: true, percent: null };
  power.start(async () => mockPower, settingsFile);
  await power._test.check();

  // 1. No battery => never saving even if onBattery=true
  check(power.factor() === 1 && power.every(1000) === 1000, 'factor/every stay 1x when hasBattery is false');
  check(power.state().hasBattery === false && power.state().saving === false, 'state reports no battery');

  // 2. Laptop on battery with default settings (enabled) => 3x factor & onChange(true)
  mockPower = { hasBattery: true, onBattery: true, percent: 65 };
  await power._test.check();
  check(power.factor() === 3 && power.every(2000) === 6000, '3x factor/every on battery with saver enabled');
  check(power.state().percent === 65 && power.state().saving === true, 'state reports percent and saving=true');
  check(events.at(-1) === true, 'onChange notified true when entering battery saver');

  // 3. batterySaver: false disables saving without losing hasBattery
  fs.writeFileSync(settingsFile, JSON.stringify({ batterySaver: false }));
  await power._test.check();
  check(power.factor() === 1 && power.state().enabled === false && power.state().saving === false, 'batterySaver:false disables 3x multiplier');

  // 4. Re-enabling batterySaver restores 3x multiplier; AC power drops to 1x
  fs.writeFileSync(settingsFile, JSON.stringify({ batterySaver: true }));
  await power._test.check();
  check(power.factor() === 3, 'batterySaver:true re-enables 3x multiplier');

  mockPower = { hasBattery: true, onBattery: false, percent: 90 };
  await power._test.check();
  check(power.factor() === 1 && power.state().onBattery === false && power.state().saving === false, 'AC power drops multiplier back to 1x');

  // 5. BOM-prefixed settings.json, null power payload, and invalid every() input
  fs.writeFileSync(settingsFile, '\uFEFF' + JSON.stringify({ batterySaver: false }));
  mockPower = null;
  await power._test.check();
  check(power.state().enabled === false && power.every(NaN) === 0 && power.every(-5) === 0, 'BOM settings honored, null payload ignored, invalid every() clamped to 0');

  // 6. Repeated start() + stop() clears intervals cleanly without throwing
  power.start(async () => mockPower, settingsFile);
  power.stop();
  check(true, 'repeated start/stop completes cleanly');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { power?.stop(); } catch {}
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`power (battery saver 3x factor, setting override, onChange, start/stop): all ${n} passed`);
process.exit(0);
