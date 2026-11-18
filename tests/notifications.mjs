// Offline test: helpers/notifications.js — Windows ToastEnabled registry read/set/reset via _test.setRun.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notif = require('../helpers/notifications.js');

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  // 1. read() returns 0 / 1 when ToastEnabled is 0x0 / 0x1
  notif._test.setRun(async () => '    ToastEnabled    REG_DWORD    0x0\r\n');
  check((await notif.read()) === 0, 'read() returns 0 for 0x0');

  notif._test.setRun(async () => '    ToastEnabled    REG_DWORD    0x1\r\n');
  check((await notif.read()) === 1, 'read() returns 1 for 0x1');

  // 2. read() returns null when registry value is missing (reg.exe exit code 1) or unparseable
  notif._test.setRun(async () => {
    const err = new Error('ERROR: The system was unable to find the specified registry key or value.');
    err.code = 1;
    throw err;
  });
  check((await notif.read()) === null, 'read() returns null when reg.exe exits 1');

  notif._test.setRun(async () => 'unexpected output');
  check((await notif.read()) === null, 'read() returns null when output has no ToastEnabled DWORD');

  notif._test.setRun(async () => null);
  check((await notif.read()) === null, 'read() returns null for nullish output');

  notif._test.setRun(async () => '    ToastEnabled    REG_DWORD    0x2\r\n');
  check((await notif.read()) === 1, 'read() normalizes non-zero DWORD to 1');

  // 3. read() rethrows non-1 errors
  let threw = false;
  notif._test.setRun(async () => {
    const err = new Error('access denied');
    err.code = 5;
    throw err;
  });
  try { await notif.read(); } catch (e) { threw = /access denied/.test(e.message); }
  check(threw, 'read() propagates unexpected reg.exe errors');

  // 4. set(0) and set(1) write REG_DWORD 0 / 1 with /f
  const calls = [];
  notif._test.setRun(async (args) => { calls.push(args); return ''; });
  await notif.set(0);
  check(calls.at(-1).includes('add') && calls.at(-1).includes('0') && calls.at(-1).includes('/f'), 'set(0) writes 0');
  await notif.set(1);
  check(calls.at(-1).includes('add') && calls.at(-1).includes('1') && calls.at(-1).includes('/f'), 'set(1) writes 1');

  // 5. set() rejects invalid values
  for (const bad of [false, true, 2, '1', undefined]) {
    let badThrew = false;
    try { await notif.set(bad); } catch (e) { badThrew = /must be 0 or 1/.test(e.message); }
    check(badThrew, `set(${String(bad)}) rejects non-0/1/null`);
  }

  // 6. set(null) deletes the value, ignoring exit code 1
  await notif.set(null);
  check(calls.at(-1).includes('delete') && calls.at(-1).includes('/f'), 'set(null) deletes registry value');

  notif._test.setRun(async () => {
    const err = new Error('not found');
    err.code = 1;
    throw err;
  });
  await notif.set(null);
  check(true, 'set(null) ignores missing value (exit code 1)');

  let delThrew = false;
  notif._test.setRun(async () => {
    const err = new Error('denied');
    err.code = 5;
    throw err;
  });
  try { await notif.set(null); } catch (e) { delThrew = /denied/.test(e.message); }
  check(delThrew, 'set(null) propagates non-1 errors');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`notifications (ToastEnabled read/set/reset/validation): all ${n} passed`);
process.exit(0);
