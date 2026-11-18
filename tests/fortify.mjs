// Fortification tests: device-lock timeouts, native IPC bounds, scrubPersonal caching,
// library-cache temp cleanup, and settings-sync malformed payload resistance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fortify-'));

try {
  // 1. public/core/devices.js: hung device adapter times out cleanly without wedging lock or isBusy()
  {
    const { env } = await import('../public/core/env.js');
    const core = await import('../public/core/devices.js');
    env.deviceOpTimeoutMs = 80;
    env.deviceLockCapMs = 200;
    let hang = true;
    core.register({
      id: 'fortify-mouse',
      title: 'Fortify Mouse',
      kind: 'Mouse',
      connect: async () => true,
      info: async () => ({ Model: 'Test' }),
      read: async () => {
        if (hang) return new Promise(() => {}); // never resolves
        return { dpi: 800 };
      },
      write: async (_k, v) => v,
    });
    await core.connect('fortify-mouse', false);
    const d = core.devices['fortify-mouse'];
    check(d.status === 'error' && /timed out/.test(d.error || ''), 'hung read during connect times out cleanly');
    check(!core.isBusy(), 'isBusy() is false after device timeout');
    hang = false;
    const ok = await core.connect('fortify-mouse', false);
    check(ok && d.status === 'connected' && d.values.dpi === 800, 'device recovers on next connect after timeout');
    delete core.devices['fortify-mouse'];
    delete env.deviceOpTimeoutMs;
    delete env.deviceLockCapMs;
  }

  // 1b. a write that outlasts the caller's timeout still holds the lock: the next job waits for it
  {
    const { env } = await import('../public/core/env.js');
    const core = await import('../public/core/devices.js');
    env.deviceOpTimeoutMs = 50;
    const order = [];
    core.register({
      id: 'fortify-slow', title: 'Fortify Slow', kind: 'Mouse',
      connect: async () => true, info: async () => ({ Model: 'Test' }), read: async () => ({ dpi: 800 }),
      write: async (_k, v) => v,
    });
    await core.connect('fortify-slow', false);
    core.devices['fortify-slow'].adapter.read = async () => { order.push('slow start'); await new Promise((r) => setTimeout(r, 200)); order.push('slow end'); return { dpi: 800 }; };
    const a = core.readNow('fortify-slow').catch((e) => e.message);
    const b = new Promise((r) => setTimeout(r, 10)).then(() => { core.devices['fortify-slow'].adapter.read = async () => { order.push('next'); return { dpi: 900 }; }; return core.readNow('fortify-slow'); });
    check(/timed out/.test(await a), 'a slow read tells its caller it timed out');
    await b;
    check(order.join(',') === 'slow start,slow end,next', `the next job waits for the slow one (${order.join(',')})`);
    delete core.devices['fortify-slow'];
    delete env.deviceOpTimeoutMs;
  }

  // 2. helpers/native.js: invalid request() timeout or line-break injection handled safely
  {
    const nat = require(path.join(ROOT, 'helpers', 'native.js'));
    const badChan = await nat.request('bad chan', 'PING', 500);
    check(String(badChan).startsWith('ERR refused'), 'native.request refuses whitespace in channel');
    const badCmd = await nat.request('diag', 'PING\nEVIL', 500);
    check(String(badCmd).startsWith('ERR refused'), 'native.request refuses newline in command');
  }

  // 3. helpers/last-answer.js: scrubPersonal handles cached patterns and USERNAME changes
  {
    const { scrubPersonal } = require(path.join(ROOT, 'helpers', 'last-answer.js'));
    const prevUser = process.env.USERNAME;
    try {
      process.env.USERNAME = 'AliceTestUser';
      const s1 = scrubPersonal({ msg: `C:\\Users\\AliceTestUser\\file`, home: os.homedir() });
      check(s1.home === '%USERPROFILE%', 'scrubPersonal replaces homedir');
      check(s1.msg.includes('%USERNAME%'), 'scrubPersonal replaces USERNAME');
      process.env.USERNAME = 'BobTestUser';
      const s2 = scrubPersonal({ msg: 'User BobTestUser logged' });
      check(s2.msg === 'User %USERNAME% logged', 'scrubPersonal updates when USERNAME changes');
    } finally {
      if (prevUser === undefined) delete process.env.USERNAME;
      else process.env.USERNAME = prevUser;
    }
  }

  // 4. helpers/settings-sync.js: _apply rejects malformed/non-object payloads without throwing or polluting
  {
    const sync = require(path.join(ROOT, 'helpers', 'settings-sync.js'));
    const local = { eq: null, options: {}, profiles: [] };
    check((await sync._apply(null, local)).length === 0, 'settings-sync _apply(null) returns []');
    check((await sync._apply([], local)).length === 0, 'settings-sync _apply([]) returns []');
    check((await sync._apply('bad', local)).length === 0, 'settings-sync _apply("bad") returns []');
    const evil = JSON.parse('{"options":{"__proto__":{"polluted":true}},"eq":"bad"}');
    const res = await sync._apply(evil, local);
    check(Array.isArray(res) && !({}).polluted, 'settings-sync _apply ignores __proto__ and non-object eq');
  }

  // 5. helpers/library-updates.mjs: stale .incoming-* / .old-* directories are cleaned during check
  {
    const crypto = await import('node:crypto');
    const libUp = await import('../helpers/library-updates.mjs');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const root = path.join(TMP, 'lib-root');
    const cache = libUp.cacheRoot(root);
    fs.mkdirSync(path.join(cache, '.incoming-999-1'), { recursive: true });
    fs.mkdirSync(path.join(cache, '.old-foo-999-1'), { recursive: true });
    fs.writeFileSync(path.join(TMP, 'pub.pem'), pubPem);

    const bundle = {
      kind: libUp.KIND,
      format: libUp.FORMAT,
      builtAt: '2026-11-13T00:00:00.000Z',
      list: [],
      entries: [],
    };
    bundle.signature = crypto.sign(null, Buffer.from(libUp.payload(bundle)), privateKey).toString('base64');
    const r = await libUp.check({
      root,
      url: 'data:application/json,' + encodeURIComponent(JSON.stringify(bundle)),
      publicKeyFile: path.join(TMP, 'pub.pem'),
      refresh: false,
    });
    check(r.ok === true, 'library-updates check succeeds with signed empty bundle');
    check(!fs.existsSync(path.join(cache, '.incoming-999-1')), 'stale .incoming-* directory removed');
    check(!fs.existsSync(path.join(cache, '.old-foo-999-1')), 'stale .old-* directory removed');
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.error('fortify FAILED:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('fortify: all checks passed');
