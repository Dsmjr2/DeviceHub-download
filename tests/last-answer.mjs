// The slow reads keep their last answer (26 Oct 2026; helpers/last-answer.js): Bluetooth, the optional tools' Apps
// list, OpenRGB and board lights answer at once from the last read, read again in the background once stale, keep a
// disk copy with nothing personal in it, and a person's click (fresh) or a write (invalidate) waits for a new read.
// Offline: pretend reads only, a temporary folder for the disk copies; nothing is started and no device is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { lastAnswer, scrubPersonal } = require(path.join(ROOT, 'helpers', 'last-answer.js'));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const tick = () => new Promise((r) => setImmediate(r));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-last-answer-'));

// a pretend slow read: each call returns the next version; held ones finish when released
function source() {
  const s = { n: 0, calls: [], held: [] };
  s.read = (fresh) => { s.calls.push(fresh); const v = { v: ++s.n }; if (!s.hold) return Promise.resolve(v); return new Promise((res) => s.held.push(() => res(v))); };
  s.release = () => { const h = s.held.shift(); h?.(); };
  return s;
}

try {
  // 1. stale-while-revalidate: the first ask waits; later asks answer at once; once stale, at once AND one background read
  {
    let t = 1000;
    const src = source();
    const c = lastAnswer({ staleMs: 60000, read: src.read, now: () => t });
    check((await c.get()).v === 1 && src.calls.length === 1, 'the first ask waits for a read');
    t += 30000;
    check((await c.get()).v === 1 && src.calls.length === 1, 'a fresh-enough answer comes back with no read');
    t += 31000;
    src.hold = true;
    const a = await c.get();
    check(a.v === 1, 'a stale answer still comes back at once');
    check(src.calls.length === 2 && src.calls[1] === false, 'a stale answer starts one background read (not fresh)');
    await c.get(); await c.get();
    check(src.calls.length === 2, 'asks during the background read start no more reads');
    src.release(); await tick(); await tick();
    check((await c.get()).v === 2, 'the next ask gets the background read');
  }
  // 2. a person's click (fresh) always waits for a new read, and never shares an older background read
  {
    let t = 0;
    const src = source();
    const c = lastAnswer({ staleMs: 1000, read: src.read, now: () => t });
    await c.get();
    t = 5000; src.hold = true;
    c.get();                                  // stale: background read 2 starts and is held
    const click = c.get(true);                // Look again: its own read 3
    check(src.calls.length === 3 && src.calls[2] === true, 'Look again starts its own fresh read');
    src.release(); src.release();             // read 2 lands, then read 3
    const r = await click;
    check(r.v === 3, `Look again answers with its own read (got ${r.v})`);
    await tick();
    check((await c.get()).v === 3, 'the click\'s answer is kept');
  }
  // 3. an older read that ends after a newer one is not kept over it
  {
    const src = source(); src.hold = true;
    let t = 0;
    const c = lastAnswer({ staleMs: 1000, read: src.read, now: () => t });
    const first = c.get(); src.release(); await first;   // v1
    t = 5000; c.get();                                   // background read 2, held
    const click = c.get(true);                            // fresh read 3, held
    src.held[1](); await click;                           // 3 lands first
    src.held[0](); await tick(); await tick();            // then the older 2
    check(c.peek().value.v === 3, `an older read landing late does not replace a newer one (kept ${c.peek().value.v})`);
  }
  // 4. after a write: invalidate() makes the next ask wait for a read that started after it
  {
    const src = source();
    let t = 0;
    const c = lastAnswer({ staleMs: 60000, read: src.read, now: () => t });
    await c.get();
    src.hold = true;
    t = 61000; c.get();                       // a background read (2) starts before the write
    c.invalidate();                           // the write
    const after = c.get();
    check(src.calls.length === 3, 'an ask after a write does not share the read that started before it');
    src.release(); src.release();
    check((await after).v === 3, 'the ask after a write gets a read made after it');
    src.hold = false;
    check((await c.get()).v === 3 && src.calls.length === 3, 'after that read the answer is kept again');
  }
  // 5. the disk copy: written after a read, through toDisk and without the user folder or name; read back after a
  //    "restart" (a new cache on the same file) and answered at once while a background read refreshes it
  {
    const file = path.join(TMP, 'pretend.json');
    const home = os.homedir(), user = process.env.USERNAME || os.userInfo().username;
    const src = source();
    let t = 1_000_000;
    const toDisk = (v) => ({ ...v, secret: undefined });
    const c = lastAnswer({ file, staleMs: 60000, read: () => src.read().then((v) => ({ ...v, path: `${home}\\DeviceHub\\tools`, who: `${user} here`, secret: 'serial 1234' })), toDisk, now: () => t });
    await c.get();
    const disk = fs.readFileSync(file, 'utf8');
    check(fs.existsSync(file), 'the disk copy is written after a read');
    check(!disk.includes(home) && !disk.toLowerCase().includes(String(user).toLowerCase()), `the disk copy names neither the user folder nor the user (${disk})`);
    check(!disk.includes('serial 1234'), 'the disk copy is made through toDisk');
    check(!fs.existsSync(`${file}.tmp`), 'no half-written file is left');
    t += 120000;
    const src2 = source(); src2.hold = true;
    const again = lastAnswer({ file, staleMs: 60000, read: src2.read, now: () => t });
    const first = await again.get();
    check(first.v === 1 && again.peek().fromDisk, 'after a restart the disk copy answers at once');
    check(src2.calls.length === 1 && src2.calls[0] === false, 'and, being stale, starts one background read');
    src2.release(); await tick(); await tick();
    check(again.peek().value.v === 1 && !again.peek().fromDisk, 'the background read replaces the disk copy');
    // a copy older than a day, or from the future, is not used
    const old = lastAnswer({ file, staleMs: 60000, read: source().read, now: () => t + 25 * 3600e3 });
    check(old.peek() === null, 'a disk copy older than a day is not used');
    fs.writeFileSync(file, '{ not json');
    check(lastAnswer({ file, staleMs: 1, read: source().read }).peek() === null, 'a damaged disk copy is ignored');
  }
  // 6. a read that fails: the first ask throws (as before); a failed background read keeps the last answer
  {
    let fail = true, t = 0;
    const c = lastAnswer({ staleMs: 1000, read: () => (fail ? Promise.reject(new Error('no')) : Promise.resolve({ ok: 1 })), now: () => t });
    let threw = false; try { await c.get(); } catch { threw = true; }
    check(threw, 'a first read that fails is reported');
    fail = false; await c.get(); fail = true; t = 9999;
    check((await c.get()).ok === 1, 'a failed background read keeps the last answer');
  }
  check(JSON.stringify(scrubPersonal({ a: [`${os.homedir()}\\x`] })).includes('%USERPROFILE%'), 'scrubPersonal replaces the user folder');

  // 7. what each slow read keeps on disk
  const pcMap = require(path.join(ROOT, 'helpers', 'pc-map.js'));
  check(pcMap._test.withoutOwner("Shawn's AirPods Pro #2") === 'AirPods Pro #2' && pcMap._test.withoutOwner('Shawn’s Buds') === 'Buds', 'Bluetooth names are kept on disk without the owner\'s name');
  check(pcMap._test.withoutOwner('Xbox Wireless Controller') === 'Xbox Wireless Controller', 'a name without an owner is kept as it is');
  const orgb = require(path.join(ROOT, 'helpers', 'openrgb.js'));
  check(orgb._test.placeOnly('HID: \\\\?\\hid#vid_1b1c&pid_0a6b&mi_03#8&2a1b3c4d&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}') === 'HID: VID_1B1C&PID_0A6B', `an OpenRGB light's place is cut to its bus and USB id (${orgb._test.placeOnly('HID: \\\\?\\hid#vid_1b1c&pid_0a6b&mi_03#8&2a')})`);
  check(orgb._test.placeOnly('I2C: PIIX4 #0, address 0x70') === 'I2C: PIIX4 #0, address 0x70', 'a board light\'s place is kept');
  // the routes and callers keep the click fresh and the page open cached
  const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  check(/lastAnswer\(\{ name: 'bluetooth'/.test(src('helpers/pc-map.js')), 'Bluetooth keeps its last answer');
  check(/lastAnswer\(\{ name: 'installers'/.test(src('helpers/installers.mjs')) && /toDisk: \(list\) => list\.filter\(\(a\) => TOOLS\.some/.test(src('helpers/installers.mjs')), 'the Apps list keeps its last answer, only these tools on disk');
  check(/const finish = \(t, ok, text, extra = \{\}\) => \{ appsAnswer\.invalidate\(\);/.test(src('helpers/installers.mjs')), 'an install that ends makes the next Apps list ask wait for a new read');
  check(/lastAnswer\(\{ name: 'openrgb'/.test(src('helpers/openrgb.js')) && (src('helpers/openrgb.js').match(/answer\.invalidate\(\)/g) || []).length >= 4, 'OpenRGB keeps its last answer; every write, put back and set up invalidates it');
  check(/lastAnswer\(\{ name: 'board-lights'/.test(src('helpers/board-lights.mjs')) && /cache\.invalidate\(\); deps\.forget\(\)/.test(src('helpers/board-lights.mjs')), 'board lights keep their last answer; set up / remove invalidate it');
  check(/useDisk\(path\.join\(ROOT, 'read-cache'\)\)/.test(src('server.js')) && /^read-cache\/$/m.test(src('.gitignore')), 'the disk copies go to read-cache\\, which git ignores');
  check(/'read-cache'/.test(src('helpers/make-installer.ps1')), 'the zip refuses read-cache');
  check(/onDone: \(\) => loadTools\(true\)/.test(src('public/pages/setup.js')) && /installerStatus\(fresh\)/.test(src('public/pages/setup.js')), 'Setup: page open takes the kept answer; an install asks fresh');
  check(/loadPc\(true\)/.test(src('public/pages/pc-lights.js')) && /api\/bluetooth\$\{fresh \? '\?fresh=1' : ''\}/.test(src('public/pages/pc-lights.js')), 'PC lights: Look again asks fresh');
  // the routes still pass fresh through
  const server = src('server.js');
  check(/pcMap\.bluetooth\(url\.searchParams\.has\('fresh'\)\)/.test(server) && /openrgb\.status\(url\.searchParams\.has\('fresh'\)\)/.test(server), 'the Bluetooth and OpenRGB routes pass fresh through');
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) { console.log(`last-answer: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('last-answer: slow reads answer at once, refresh in the background, a click or a write waits for a new read, disk copies hold nothing personal');
