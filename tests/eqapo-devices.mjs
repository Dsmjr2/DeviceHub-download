// Offline test: helpers/eqapo-devices.js — parseRows() preserving '|' in device names, fromRows() active-only
// filtering and Render/Capture mapping, and status() GUID validation.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const eqd = require('../helpers/eqapo-devices.js');
const { parseRows, fromRows } = eqd._test;

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  // 1. parseRows preserves '|' in device names and handles CRLF / empty input
  const parsed = parseRows('Render|{11111111-1111-1111-1111-111111111111}|1|True|Headset | Game\r\nCapture|{22222222-2222-2222-2222-222222222222}|4|False|Mic\r\n');
  check(parsed.length === 2, 'parseRows parses two lines');
  check(parsed[0].name === 'Headset | Game' && parsed[0].on === true, 'parseRows keeps | inside device name');
  check(parsed[1].on === false && parsed[1].state === '4', 'parseRows parses False and state');
  check(parseRows('').length === 0, 'parseRows returns [] for empty string');

  // 2. fromRows filters to active (state=1) devices and reports those with APO off
  const res = fromRows([
    { flow: 'Render', guid: '{a}', state: 1, on: true, name: 'Active On' },
    { flow: 'Render', guid: '{b}', state: 1, on: false, name: 'Active Off Speaker' },
    { flow: 'Capture', guid: '{c}', state: 1, on: false, name: 'Active Off Mic' },
    { flow: 'Render', guid: '{d}', state: 4, on: false, name: 'Inactive Old Driver' },
  ]);
  check(res.checked === 3, `fromRows counts only active devices (got ${res.checked})`);
  check(res.off.length === 2, 'fromRows lists both active devices without APO');
  check(res.off[0].flow === 'playback' && res.off[0].name === 'Active Off Speaker', 'Render maps to playback');
  check(res.off[1].flow === 'recording' && res.off[1].name === 'Active Off Mic', 'Capture maps to recording');
  check(fromRows(null).checked === 0, 'fromRows handles non-array safely');

  // 3. status() ignores invalid GUIDs without calling helper
  const emptyStatus = await eqd.status({ render: ['not-a-guid'], capture: ['{bad}'] });
  check(emptyStatus.checked === 0 && emptyStatus.off.length === 0, 'status() rejects non-GUID inputs cleanly');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`eqapo-devices (parseRows pipe-safe, fromRows active filter, GUID check): all ${n} passed`);
process.exit(0);
