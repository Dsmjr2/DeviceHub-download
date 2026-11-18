// Offline test for request deadlines: a timed-out request queued behind a slow one
// must be dropped by the helper instead of running late and causing a duplicate write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-deadline-'));
const LOG = path.join(TMP, 'executed.log');
const STANDIN = path.join(TMP, 'standin-helper.mjs');

fs.writeFileSync(STANDIN, `
import fs from 'node:fs';
import readline from 'node:readline';

const logFile = ${JSON.stringify(LOG)};
const queues = new Map();
const busy = new Set();

function parseDeadline(rest) {
  if (rest.startsWith('@deadline=')) {
    const sp = rest.indexOf(' ', 10);
    if (sp > 10) {
      const dl = Number(rest.slice(10, sp));
      if (Number.isFinite(dl)) return { dl, cmd: rest.slice(sp + 1) };
    }
  }
  return { dl: null, cmd: rest };
}

async function pump(chan) {
  if (busy.has(chan)) return;
  busy.add(chan);
  const q = queues.get(chan) || [];
  while (q.length) {
    const { seq, rest } = q.shift();
    const { dl, cmd } = parseDeadline(rest);
    if (dl !== null && cmd !== 'CLOSE' && Date.now() > dl) {
      process.stdout.write(chan + ' ' + seq + ' TIMEOUT\\n');
      continue;
    }
    if (cmd.startsWith('SLOW ')) {
      const ms = Number(cmd.slice(5)) || 100;
      await new Promise((r) => setTimeout(r, ms));
    }
    fs.appendFileSync(logFile, chan + ':' + cmd + '\\n');
    process.stdout.write(chan + ' ' + seq + ' OK\\n');
  }
  busy.delete(chan);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const a = line.indexOf(' '); if (a < 0) return;
  const b = line.indexOf(' ', a + 1); if (b < 0) return;
  const chan = line.slice(0, a), seq = line.slice(a + 1, b), rest = line.slice(b + 1);
  if (!queues.has(chan)) queues.set(chan, []);
  queues.get(chan).push({ seq, rest });
  pump(chan);
});
`);

const prevEnv = process.env.DEVICEHUB_HELPER_JS;
process.env.DEVICEHUB_HELPER_JS = STANDIN;
const nat = require(path.join(ROOT, 'helpers', 'native.js'));

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };

try {
  // 1. Queue a 180ms SLOW op, then a SET with a 60ms timeout behind it.
  // The SET times out on Node and its @deadline expires before the channel gets to it.
  const pSlow = nat.request('hs80:test:1', 'SLOW 180', 1000);
  const pExpired = nat.request('hs80:test:1', 'SET 0d 1', 60);

  const [rSlow, rExpired] = await Promise.all([pSlow, pExpired]);
  check(rSlow === 'OK', `slow op completed (${rSlow})`);
  check(rExpired === 'TIMEOUT', `short-timeout op timed out (${rExpired})`);

  // Give the stand-in a moment to drain any queued work
  await new Promise((r) => setTimeout(r, 40));

  // 2. Now send the retry SET with a normal 500ms timeout; it must execute once, not twice.
  const rRetry = await nat.request('hs80:test:1', 'SET 0d 1', 500);
  check(rRetry === 'OK', `retry op completed (${rRetry})`);

  const executed = fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const setCount = executed.filter((l) => l === 'hs80:test:1:SET 0d 1').length;
  check(setCount === 1, `SET 0d 1 executed exactly once, not twice (count=${setCount}, log=${executed.join(', ')})`);

  // 3. CLOSE is sent without dropping
  const rClose = await nat.request('hs80:test:1', 'CLOSE', 500);
  check(rClose === 'OK', `CLOSE completed (${rClose})`);
} finally {
  nat.stop();
  if (prevEnv === undefined) delete process.env.DEVICEHUB_HELPER_JS;
  else process.env.DEVICEHUB_HELPER_JS = prevEnv;
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (fails.length) {
  console.error('FAIL:', fails.join('; '));
  process.exit(1);
}
console.log('native-deadline: all 5 passed');
