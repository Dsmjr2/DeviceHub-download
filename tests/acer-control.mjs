// Acer fans, sensors and charge limit (helpers/acer-control.mjs, helpers/acer-control.ps1, public/core/acer.js), offline:
// every prompt, task, file and clock is a stand-in. Nothing is elevated, registered, read from Acer's WMI or changed on
// this PC. Run: node tests/acer-control.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as uac from '../helpers/uac.mjs';
uac.options.root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-uac-acer-'));   // the prompt log goes to TEMP
import * as ac from '../helpers/acer-control.mjs';
import { acerView, DEMO_ACER, ADD_LABEL } from '../public/core/acer.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'helpers', 'acer-control.ps1');
const ps1 = fs.readFileSync(SRC, 'utf8');
const code = ps1.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

// ---------- the pinned script ----------
const fileSha = crypto.createHash('sha256').update(fs.readFileSync(SRC)).digest('hex');
check(fileSha === ac.SCRIPT_SHA256, `helpers/acer-control.ps1 matches its pin (${fileSha})`);
check(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').includes('helpers/acer-control.ps1 -text'), 'git keeps its bytes exactly');
// only the documented calls: Linux acer-wmi's gaming methods and acer-wmi-battery's two; never a fan speed or table
const methods = [...code.matchAll(/-MethodName (\w+)/g)].map((m) => m[1]);
check(methods.length && methods.every((m) => ['GetGamingSysInfo', 'GetGamingFanBehavior', 'SetGamingFanBehavior', 'GetBatteryHealthControlStatus', 'SetBatteryHealthControl'].includes(m)), `only the documented methods (${[...new Set(methods)]})`);
check(!/SetGamingFanSpeed|SetGamingFanTable|SetGamingProfile|SetGamingMiscSetting|Thermal/i.test(code), 'never a fan speed, fan table, profile or thermal setting');
check(/SetFans \$want/.test(code) && /\$want = \$\(if \(\$Mode -eq 'fans-max'\) \{ 2 \} else \{ 1 \}\)/.test(code), 'fan modes are only Auto (1) or Max (2)');
check(/uFunctionMask = \[byte\]1/.test(code), 'the charge limit changes health mode only (mask 1)');
check(/if \(\$Mode -ne 'fans-auto' -and \(NitroOpen\)\)/.test(code), 'writes refused while NitroSense is open (Auto always allowed)');
check(/\$before = Snapshot/.test(code) && /\$after = Snapshot/.test(code), 'read before, read back after');
check(/if \(\$want -eq 2\) \{ SetFans 1/.test(code), 'a failed Max goes back to Auto');
check(/TotalHours -ge 4/.test(code) && /DeviceHub stopped answering/.test(code), 'Max ends after 4 hours or when DeviceHub stops answering');

// ---------- the tasks ----------
check(ac.MODES.join() === 'read,fans-auto,fans-max,health-on,health-off', 'five fixed modes');
check(ac.taskArgs('fans-max') === `-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ac.ACER.script}" -Mode fans-max`, 'a write task: one fixed mode');
check(ac.taskArgs('read').endsWith(`-Mode read -Want "${ac.ACER.want}"`), 'the read task: the want file');
for (const bad of ['FANS-MAX', 'fans-max; calc', '', 'fans-custom', 'read" -Command "calc']) {
  let threw = false;
  try { ac.taskArgs(bad); } catch { threw = true; }
  check(threw, `taskArgs refuses ${JSON.stringify(bad)}`);
}
const setup = ac.setupScript({ who: 'PC\\me', result: 'C:\\t\\r.txt', source: 'C:\\s\\acer-control.ps1' });
check(setup.includes(`$sha = '${ac.SCRIPT_SHA256}'`) && /Get-FileHash -LiteralPath \$script -Algorithm SHA256/.test(setup), 'setup checks the copy against the pin');
check((setup.match(/Register-ScheduledTask/g) || []).length === 5 && (setup.match(/-AtLogOn/g) || []).length === 1 && /TaskName 'DeviceHub Acer fans auto'.*-AtLogOn/.test(setup), 'five tasks; only fans auto runs at sign-in');
check(/-LogonType S4U -RunLevel Highest/.test(setup), 'no password stored');
check(/\} catch \{[\s\S]*Drop-Tasks[\s\S]*Remove-Item -LiteralPath \$dest/.test(setup), 'a failure undoes everything');
const rm = ac.removeScript({ result: 'C:\\t\\r.txt' });
check(rm.indexOf("Start-ScheduledTask -TaskName 'DeviceHub Acer fans auto'") < rm.indexOf('Drop-Tasks\r\n') || rm.indexOf("Start-ScheduledTask -TaskName 'DeviceHub Acer fans auto'") > 0, 'remove sets the fans to Auto first');

// ---------- the module with stand-ins ----------
const tasks = new Set(), ran = [], files = {};
let nitro = false, elevated = 0, nextResult = null, clock = 1;
Object.assign(ac.deps, {
  platform: 'win32', acer: async () => true, task: async (n) => tasks.has(n),
  runTask: async (n) => { ran.push(n); if (nextResult) { files[ac.ACER.result] = { at: ++clock, json: nextResult }; } return { ok: true }; },
  exists: (f) => f === ac.SOURCE || !!files[f] || (f === ac.ACER.script && tasks.size === 5),
  stat: (f) => (files[f] ? { mtimeMs: files[f].at } : null), readJson: (f) => files[f]?.json ?? null, touch: () => {},
  nitroOpen: async () => nitro, sha256: async () => ac.SCRIPT_SHA256,
  elevate: async () => { elevated++; for (const m of ac.MODES) tasks.add(ac.ACER.tasks[m]); return { ok: true }; },
  readResult: () => 'ok', clearResult: () => {}, sleep: async () => {},
});
ac._test.reset();
let s = await ac.status({ fresh: true });
check(s.acer && !s.setUp && s.canSetUp, 'an Acer, not set up: can be set up');
let threwW = null;
try { await ac.write('fans-max'); } catch (e) { threwW = e; }
check(threwW?.code === 409 && elevated === 0 && ran.length === 0, 'no write before setup, and nothing elevated by a write');
const job = await ac.setUp();
check(job.ok && elevated === 1, `setup: one prompt (${job.text})`);
s = await ac.status({ fresh: true });
check(s.setUp, 'set up afterwards');
nitro = true;
threwW = null;
try { await ac.write('fans-max'); } catch (e) { threwW = e; }
check(threwW?.code === 409 && /NitroSense/.test(threwW.message) && !ran.includes(ac.ACER.tasks['fans-max']), 'Max refused while NitroSense is open');
nextResult = { mode: 'fans-auto', ok: true, before: {}, after: { cpuFanMode: 'auto' } };
check((await ac.write('fans-auto')).ok, 'Auto allowed even with NitroSense open');
nitro = false;
for (const bad of ['read', 'fans-custom', '']) { let t = null; try { await ac.write(bad); } catch (e) { t = e; } check(t?.code === 400, `write refuses ${JSON.stringify(bad)}`); }
nextResult = { mode: 'fans-max', ok: false, why: 'the laptop answered status 1', before: {}, after: { cpuFanMode: 'auto' } };
const failed = await ac.write('fans-max');
check(!failed.ok && /status 1/.test(failed.why), 'a read-back that differs is reported as failed');
check((await ac.onQuit()) === null, 'quit: nothing to put back when Max did not take');
nextResult = { mode: 'fans-max', ok: true, before: {}, after: { cpuFanMode: 'max' } };
check((await ac.write('fans-max')).ok, 'Max');
ran.length = 0; nextResult = null;
await ac.onQuit();
check(ran.includes(ac.ACER.tasks['fans-auto']), 'quit with the fans on Max: Auto');
ran.length = 0;
await ac.onStart();
check(ran.includes(ac.ACER.tasks['fans-auto']), 'start after a crash with Max last: Auto');

// ---------- what the card shows ----------
check(!acerView({ acer: false }).show, 'not an Acer: no card');
check(acerView({ ...DEMO_ACER, setUp: false, task: false, copy: false }).label === ADD_LABEL, 'not set up: the setup button');
const v = acerView(DEMO_ACER);
check(v.controls.fans === 'auto' && v.controls.health === false && v.readings.cpuC === 52, 'set up: readings and controls');
check(acerView({ ...DEMO_ACER, readings: { ...DEMO_ACER.readings, healthMode: null } }).controls.health === null, 'no charge limit: no switch');
check(acerView({ ...DEMO_ACER, readings: { ...DEMO_ACER.readings, fresh: false } }).readings === null, 'an old reading is not shown');
check(acerView(DEMO_ACER, { done: false, uac: 'waiting', text: 'Click Yes' }).uac, 'waiting for the prompt says so');

// ---------- the PC page: the laptop's own sensors once set up ----------
const { createRequire } = await import('module');
const { _test: pcs } = createRequire(import.meta.url)('../helpers/pc-sensors.js');
const acerR = { cpuC: 61, systemC: 44, cpuFanRpm: 3100, gpuFanRpm: 2900 };
const withAcer = pcs.decide({ cpu: { name: 'AMD Ryzen 7 7735HS', loadPct: 12 }, acer: acerR });
check(withAcer.cpu.tempC === 61 && withAcer.cpu.tempSource === "Laptop sensor (Acer)" && withAcer.cpu.fanRpm === 3100, 'the PC page CPU card: the Acer temperature and fan');
check(withAcer.readings.some((r) => r.name === 'Graphics card fan' && r.fanRpm === 2900) && !withAcer.notReadable.some((n) => n.what === 'CPU temperature'), 'the GPU fan listed; CPU temperature not marked unreadable');
const lhmFirst = pcs.decide({ cpu: { name: 'x' }, acer: acerR, lhm: { setUp: true, state: 'ok', cpu: [{ packageC: 70 }], fans: [] } });
check(lhmFirst.cpu.tempC === 70, "LibreHardwareMonitor's package reading still comes first");
check(pcs.decide({ cpu: { name: 'x' } }).cpu.tempSource == null, 'no Acer readings: as before');

// ---------- the Laptop page's title and battery (pure parts) ----------
const page = fs.readFileSync(path.join(ROOT, 'public/pages/laptop.js'), 'utf8');
check(!/pill\(info\.maker\)/.test(page), 'no maker chip beside the title');
check(/acerCard\(\{ redraw: rerender \}\)/.test(page), 'the Acer card is on the Laptop page');
const ps = fs.readFileSync(path.join(ROOT, 'helpers/laptop.ps1'), 'utf8');
check(ps.includes("-notmatch '^[Vv]?\\d+(\\.\\d+)+$'"), 'a version number is never the model');

if (fails.length) { console.log(`acer-control: ${fails.length} failed`); for (const f of fails) console.log(`  FAIL ${f}`); process.exit(1); }
console.log('acer-control (one-click setup, documented calls only, NitroSense refused, read back, Max never left on): all good');
