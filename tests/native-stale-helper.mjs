// Offline test (15 Nov 2026 review of the request deadlines): a C# helper kept after a failed rebuild was built from
// earlier sources and may not know "@deadline=", so its requests go without it (else every request answered
// "ERR unknown command"); once a build succeeds, and for the Rust helper, the deadline is sent again.
// A stand-in helper that answers each request with the exact command it got.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-stale-'));
const ECHO = path.join(TMP, 'echo-helper.mjs');
fs.writeFileSync(ECHO, `import readline from 'node:readline';
readline.createInterface({ input: process.stdin }).on('line', (l) => { const a = l.indexOf(' '), b = l.indexOf(' ', a + 1); process.stdout.write(l.slice(0, b) + ' ' + l.slice(b + 1).replace(/ /g, '_') + '\\n'); }).on('close', () => process.exit(0));
`);
delete process.env.DEVICEHUB_HELPER_JS;
const nat = require(path.join(ROOT, 'helpers', 'native.js'));
const origLog = console.log;
console.log = () => {};
const fails = [];
let n = 0;
const check = (ok, what) => { n++; if (!ok) fails.push(what); };
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;

try {
  let kind = 'csharp', buildFails = true;
  nat._test.setSelect(() => ({ kind, exe: ECHO, reason: 'test' }));
  nat._test.setBuild(() => { if (buildFails) throw Object.assign(new Error('the sources changed but the helper could not be rebuilt'), { fallback: true }); });

  let r = await nat.request('hid:t:1', 'OPEN', 2000);
  check(r === 'OPEN', `stale C# helper after a failed rebuild: no deadline sent (${r})`);
  nat.stop();

  buildFails = false;
  skew += 11 * 60000;   // the build is tried again after 10 minutes
  r = await nat.request('hid:t:1', 'OPEN', 2000);
  check(/^@deadline=\d+_OPEN$/.test(r), `a successful rebuild: the deadline is sent again (${r})`);
  nat.stop();

  buildFails = true;
  kind = 'rust';
  r = await nat.request('hid:t:1', 'OPEN', 2000);
  check(/^@deadline=\d+_OPEN$/.test(r), `the Rust helper always gets the deadline (${r})`);
  check((await nat.request('hid:t:1', 'CLOSE', 2000)) === 'CLOSE', 'CLOSE never carries one');
} catch (e) {
  fails.push(`threw: ${e.message}`);
} finally {
  try { nat._test.setSelect(null); nat._test.setBuild?.(null); } catch {}
  nat.stop();
  Date.now = realNow;
  console.log = origLog;
  await new Promise((r) => setTimeout(r, 100));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
if (fails.length) { console.error('FAIL:', fails.join('; ')); process.exit(1); }
console.log(`native-stale-helper (no deadline to a helper kept after a failed rebuild): all ${n} passed`);
process.exit(0);
