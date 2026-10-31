// Offline test of helpers/driver-guard.js (22 Oct 2026, support issues 3-5): a library or learned driver's stray
// error never stops DeviceHub. Each case runs in its own Node process, with the guard installed the way server.js
// installs it, and a pretend driver in a my-devices\<folder>\device.mjs of a scratch folder:
//  - its request times out after the caller stopped waiting (the rejection reaches no one): the process keeps running,
//    the log names the driver, and the agent's handler is told which driver it was
//  - a throw from its own timer (an uncaught exception): the same
//  - DeviceHub's own unhandled rejection: still exits with code 1, as before (the launcher restarts it, a crash report)
// Also the "which driver" rule on stacks, and the device it marks (public/core/devices.js driverFault).
// Run: node tests/driver-guard.mjs (no hardware)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = require('../helpers/driver-guard.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

// ---- which driver an error comes from ----
const at = (file) => Object.assign(new Error('no reply to 06 ff bb 08'), { stack: `Error: no reply to 06 ff bb 08\n    at Timeout._onTimeout (file:///${file}:220:39)\n    at listOnTimeout (node:internal/timers:581:17)` });
check(guard.driverOf(at('C:/Users/friend/DeviceHub/my-devices/hyperx-cloud/device.mjs')) === 'hyperx-cloud', 'a my-devices driver is named by its folder');
check(guard.driverOf(at('C:\\Users\\friend\\DeviceHub\\my-devices\\hyperx-cloud\\device.mjs')) === 'hyperx-cloud', 'a Windows path names the folder too');
check(guard.driverOf(at('C:/Users/shawn/DeviceHub/device-library/steelseries-arctis/device.mjs')) === 'steelseries-arctis', 'the device library copy is named by its folder');
check(guard.driverOf(at('C:/Users/shawn/DeviceHub/helpers/declarative-driver.mjs')) === 'driver.json', 'the driver.json runner counts as a driver');
check(guard.driverOf(at('C:/Users/shawn/DeviceHub/helpers/agent.mjs')) === null, "DeviceHub's own code is not a driver");
check(guard.driverOf('just text') === null && guard.driverOf(null) === null, 'an error with no stack is not a driver');

// ---- in a process of its own ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devicehub-guard-'));
const dir = path.join(tmp, 'my-devices', 'flaky-headset');
fs.mkdirSync(dir, { recursive: true });
// the pretend driver: the old HyperX Link's shape, a reply timer started before a slow write, and a caller that stops
// waiting before the timer fires
fs.writeFileSync(path.join(dir, 'device.mjs'), [
  'export function lateTimeout() {',
  '  let timer;',
  "  const answer = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no reply to 06 ff bb 08')), 20); });",
  '  return { answer, timer };',
  '}',
  "export function timerThrow() { setTimeout(() => { throw new Error('this driver broke inside its own timer'); }, 10); }",
  '',
].join('\n'));
const guardFile = path.join(ROOT, 'helpers', 'driver-guard.js');
const driverUrl = pathToFileURL(path.join(dir, 'device.mjs')).href;
const run = (body) => {
  const file = path.join(tmp, `case-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(file, [
    "import { createRequire } from 'node:module';",
    `const guard = createRequire(import.meta.url)(${JSON.stringify(guardFile)});`,
    'guard.install();',
    "guard.setDriverFaultHandler((folder, err) => console.log(`HANDLER ${folder}: ${err.message}`));",
    `const drv = await import(${JSON.stringify(driverUrl)});`,
    body,
    "setTimeout(() => { console.log('STILL RUNNING'); process.exit(0); }, 300);",
    '',
  ].join('\n'));
  return spawnSync(process.execPath, ['--no-warnings', file], { encoding: 'utf8', timeout: 20000 });
};

{
  // the caller stopped waiting (it gave up on the slow write before the reply wait was awaited, as the old HyperX
  // Link did), then the driver's timer rejects a promise nobody handles
  const r = run("const req = drv.lateTimeout(); await new Promise((ok) => setTimeout(ok, 5)); console.log('caller moved on');");
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 0 && /STILL RUNNING/.test(out), `a driver request that times out after the caller stopped waiting does not stop the process (exit ${r.status}: ${out.trim()})`);
  check(/\[driver\] flaky-headset: unhandled rejection: no reply to 06 ff bb 08 \(DeviceHub kept running\)/.test(out), `the log names the driver and the error (${out.trim()})`);
  check(/HANDLER flaky-headset: no reply to 06 ff bb 08/.test(out), 'the agent is told which driver failed, to mark its device');
}
{
  const r = run('drv.timerThrow();');
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 0 && /STILL RUNNING/.test(out) && /\[driver\] flaky-headset: uncaught error: this driver broke/.test(out), `a throw from a driver's own timer does not stop the process (exit ${r.status}: ${out.trim()})`);
}
{
  const r = run("Promise.reject(new Error('DeviceHub itself broke'));");
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 1 && !/STILL RUNNING/.test(out) && /\[crash\] unhandled rejection/.test(out) && !/HANDLER/.test(out), `DeviceHub's own unhandled rejection still exits with code 1 (exit ${r.status}: ${out.trim()})`);
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

// ---- the device it marks (public/core/devices.js) ----
{
  const core = await import('../public/core/devices.js');
  const { env } = await import('../public/core/env.js');
  env.agent = false;
  core.register({ id: 'guard-test', title: 'Flaky headset', kind: 'Headset', plugin: 'flaky-headset', async connect() { return true; }, async info() { return {}; }, async read() { return {}; } });
  const d = core.devices['guard-test'];
  d.status = 'connected';
  core.driverFault('guard-test', new Error('no reply to 06 ff bb 08'));
  check(d.status === 'asleep' && /no reply/.test(d.error), `a "no reply" marks the device asleep (${d.status})`);
  d.status = 'connected';
  core.driverFault('guard-test', new Error('Cannot read properties of undefined'));
  check(d.status === 'error' && /Cannot read/.test(d.error), `any other error marks it in error (${d.status})`);
  core.driverFault('nobody', new Error('x'));   // an id DeviceHub does not have: nothing happens
}

// the real reply timer (31 Oct 2026): its error is made in public/devices/hid.js, so its stack names no driver folder;
// the guard still counts it as a device's (it missed this very crash before)
{
  const { HidChannel } = await import('../public/devices/hid.js');
  const quiet = { opened: true, addEventListener() {}, removeEventListener() {}, sendReport: async () => {} };
  let err = null;
  try { await new HidChannel(quiet, { length: 8 }).request([1, 2, 3], { timeoutMs: 20 }); } catch (e) { err = e; }
  check(err && /no reply/.test(err.message) && guard.driverOf(err) === 'a device', `a real "no reply" from hid.js is a device's error (${err && guard.driverOf(err)})`);
}

console.log(fails.length ? `driver-guard: FAILED:\n  ${fails.join('\n  ')}` : "driver-guard (a driver's late timeout, a throw from its timer: logged, its device marked, DeviceHub keeps running; DeviceHub's own errors still exit 1): all good");
process.exitCode = fails.length ? 1 : 0;
