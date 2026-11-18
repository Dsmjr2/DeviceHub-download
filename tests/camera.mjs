// Offline test: helpers/camera.js — list() virtual-camera filtering & caching, set() validation,
// backup creation & 15s coalescing, read-back verification, and GONE/TIMEOUT error handling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const camera = require('../helpers/camera.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-camera-'));

const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };

try {
  let state = {
    brightness: { min: 0, max: 255, value: 128, auto: false, canAuto: false },
    exposure: { min: -7, max: -1, value: -4, auto: true, canAuto: true },
  };
  let calls = [];
  let mode = 'ok';
  const native = {
    async request(chan, body) {
      calls.push(chan);
      if (mode === 'GONE') return 'GONE';
      if (mode === 'TIMEOUT') return 'TIMEOUT';
      const q = JSON.parse(body);
      if (q.op === 'cameras') {
        return JSON.stringify({
          ok: true,
          cameras: [
            { path: '', name: 'OBS Virtual Camera', controls: {} },
            { path: 'usb#cam1', name: 'Logitech StreamCam', controls: structuredClone(state) },
          ],
        });
      }
      if (q.op === 'camera-set') {
        if (mode === 'mismatch') {
          return JSON.stringify({ ok: true, controls: { ...structuredClone(state), [q.key]: { ...state[q.key], value: q.value + 1, auto: q.auto } } });
        }
        state[q.key] = { ...state[q.key], value: q.value, auto: q.auto };
        return JSON.stringify({ ok: true, controls: structuredClone(state) });
      }
      return JSON.stringify({ ok: false, error: 'unknown op' });
    },
  };

  camera.start(native, T);

  // 1. list() filters virtual cameras and caches for 10s
  const list1 = await camera.list();
  check(list1.length === 1 && list1[0].name === 'Logitech StreamCam', 'virtual camera filtered from list()');
  await camera.list();
  check(calls.length === 1, 'cached list() avoids duplicate helper calls within 10s');

  // 2. set() rejects out-of-range, non-integer, unknown key, and auto when canAuto=false
  for (const [args, re, label] of [
    [['missing', 'brightness', 100, false], /camera not found/, 'unknown camera'],
    [['usb#cam1', 'zoom', 10, false], /does not offer/, 'unknown control'],
    [['usb#cam1', 'brightness', 50, true], /has no auto/, 'auto without canAuto'],
    [['usb#cam1', 'brightness', 300, false], /must be 0-255/, 'value above max'],
    [['usb#cam1', 'brightness', 12.5, false], /must be 0-255/, 'non-integer value'],
  ]) {
    let threw = false;
    try { await camera.set(...args); } catch (e) { threw = re.test(e.message); }
    check(threw, `set() rejects ${label}`);
  }

  // 3. set() creates one backup and coalesces rapid second change within 15s
  const res1 = await camera.set('usb#cam1', 'brightness', 140, false);
  const res2 = await camera.set('usb#cam1', 'brightness', 150, false);
  const backups = fs.readdirSync(T).filter((f) => /^camera-LogitechStreamCam-.*\.json$/.test(f));
  check(res1.value === 140 && res2.value === 150 && backups.length === 1, 'rapid changes share one backup within 15s');

  // 4. set() supports auto:true even if current value was clamped to range
  state.exposure.value = 168;
  const resAuto = await camera.set('usb#cam1', 'exposure', 0, true);
  check(resAuto.auto === true && resAuto.value === -1, 'auto clamps out-of-range current value into [min, max]');

  // 5. Read-back mismatch throws clear error
  mode = 'mismatch';
  let mismatchThrew = false;
  try { await camera.set('usb#cam1', 'brightness', 100, false); } catch (e) { mismatchThrew = /camera reads/.test(e.message); }
  check(mismatchThrew, 'read-back mismatch throws');

  // 5b. (15 Nov 2026 review of PR #12) no backup folder: nothing is written (back up before the first write, always)
  mode = 'ok';
  camera.start(native, null);

  let noBackupThrew = false;
  try { await camera.set('usb#cam1', 'brightness', 120, false); } catch (e) { noBackupThrew = /backup/.test(e.message); }
  check(noBackupThrew && state.brightness.value !== 120, 'no backup folder: the change is refused, nothing written');
  camera.start(native, T);

  // 6. GONE and TIMEOUT produce human-readable errors
  mode = 'GONE';
  let goneThrew = false;
  try { await camera.list(true); } catch (e) { goneThrew = /not running/.test(e.message); }
  check(goneThrew, 'GONE produces clear error');

  mode = 'TIMEOUT';
  let timeoutThrew = false;
  try { await camera.list(true); } catch (e) { timeoutThrew = /no answer in time/.test(e.message); }
  check(timeoutThrew, 'TIMEOUT produces clear error');

  // 7. Malformed JSON / unstarted native / NaN current value under auto:true
  mode = 'ok';
  state.exposure.value = NaN;
  const resAutoNan = await camera.set('usb#cam1', 'exposure', 0, true);
  check(resAutoNan.auto === true && resAutoNan.value === -7, 'auto falls back to min when current value is NaN');
  camera.start({ async request() { return '{bad json'; } }, T);
  let badJsonThrew = false;
  try { await camera.list(true); } catch (e) { badJsonThrew = /unreadable data/.test(e.message); }
  check(badJsonThrew, 'malformed helper JSON produces clear error');
  camera.start(null, T);
  let noNativeThrew = false;
  try { await camera.list(true); } catch (e) { noNativeThrew = /not running/.test(e.message); }
  check(noNativeThrew, 'missing native helper produces clear error');
} catch (e) {
  fails.push(`threw: ${e.stack}`);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}

if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`camera (list filter/cache, set validation/backups, read-back, GONE/TIMEOUT): all ${n} passed`);
process.exit(0);
