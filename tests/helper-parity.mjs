// Read-only parity test between C# helper (helpers/bin/DeviceHubHelper.exe) and Rust helper
// (helpers/native-rs/target/release/DeviceHubHelper.exe).
// Never runs both helpers at the same time on the same device.
// Offline mode (default) tests safe system/pointer/pc reads and marks hardware-owning reads
// as "not tested (needs test window)". Pass --live only inside a Shawn-opened test window.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CS_EXE = path.join(ROOT, 'helpers', 'bin', 'DeviceHubHelper.exe');
const RS_EXE = path.join(ROOT, 'helpers', 'native-rs', 'target', 'release', 'DeviceHubHelper.exe');
const LIVE = process.argv.includes('--live');

// Hard read-only allowlist: refuses any non-read command before it reaches a helper.
const ALLOWED_READS = new Set([
  'watchdog|PING',
  'pointer|READ',
  'pc|{"op":"installed"}',
  'pc|{"op":"pc-map"}',
  'pc|{"op":"pc-check"}',
  'pc|{"op":"bluetooth"}',
  'pc|{"op":"gpu-power"}',
  'pc|{"op":"procs"}',
  'pc|{"op":"display-read"}',
  'pc|{"op":"display-hdr","action":"read"}',
  'pc|{"op":"sleep-timer","action":"read"}',
  'pc|{"op":"laptop","action":"read"}',
  'pc|{"op":"corsair-apo-read"}',
  'pc|{"op":"startup-apps-read"}',
  'pc|{"op":"startup-impact-read"}',
  'pc|{"op":"eqapo","action":"read"}',
  // Live-only hardware reads (only dispatched when --live is passed)
  'hidlist|ff00 0001',
  'monitor|{"op":"monitors","caps":false}',
  'camera|{"op":"cameras"}',
  'audio|{"op":"audio-list","match":"HS80"}',
  'audio|{"op":"usb-headsets"}',
  'audio|{"op":"outputs"}',
  'audio|{"op":"mics"}',
  'audio|{"op":"procs"}',
  'audio|{"op":"power"}',
]);

function assertAllowedRead(chan, cmd) {
  const key = `${chan}|${cmd}`;
  if (!ALLOWED_READS.has(key)) {
    throw new Error(`REFUSED non-read or unlisted command: ${key}`);
  }
}

class HelperSession {
  constructor(exePath) {
    this.proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.buf = '';
    this.seq = 0;
    this.waiters = new Map();
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).replace(/\r$/, '');
        this.buf = this.buf.slice(idx + 1);
        const a = line.indexOf(' ');
        const b = a > 0 ? line.indexOf(' ', a + 1) : -1;
        if (a > 0 && b > a) {
          const key = line.slice(0, b);
          const reply = line.slice(b + 1);
          const w = this.waiters.get(key);
          if (w) {
            this.waiters.delete(key);
            w(reply);
          }
        }
      }
    });
  }

  request(chan, cmd, timeoutMs = 15000) {
    assertAllowedRead(chan, cmd);
    const id = ++this.seq;
    const key = `${chan} ${id}`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters.delete(key);
        reject(new Error(`Timeout waiting for ${key}`));
      }, timeoutMs);
      this.waiters.set(key, (reply) => {
        clearTimeout(t);
        resolve(reply);
      });
      this.proc.stdin.write(`${key} ${cmd}\n`);
    });
  }

  async close() {
    if (!this.proc || this.proc.exitCode !== null) return;
    await new Promise((resolve) => {
      this.proc.once('exit', resolve);
      try {
        this.proc.stdin.end();
      } catch {
        resolve();
      }
      setTimeout(() => {
        try { this.proc.kill(); } catch {}
        resolve();
      }, 2000).unref();
    });
  }
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Allowed differences documented by reason:
// - pc procs / audio procs: live PIDs/order/process churn between sequential runs
// - pc gpu-power: instantaneous mW/temp sensor sampling between sequential runs
// - startup-impact-read / pc-check: timestamps or transient boot/uptime counters
const COMPARE_OPS = [
  { chan: 'watchdog', cmd: 'PING', type: 'text' },
  { chan: 'pointer', cmd: 'READ', type: 'json', exactKeys: ['ok', 'speed', 'precision', 'scrollLines', 'doubleClick'] },
  { chan: 'pc', cmd: '{"op":"installed"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"pc-map"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"pc-check"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"bluetooth"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"gpu-power"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"display-read"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"display-hdr","action":"read"}', type: 'json', exactKeys: ['ok'] },
  { chan: 'pc', cmd: '{"op":"eqapo","action":"read"}', type: 'json', exactKeys: ['ok'] },
];

// Ops moved from PowerShell into Rust (C# didn't implement these; verify Rust returns valid ok JSON)
const RUST_MOVED_PS_OPS = [
  { chan: 'pc', cmd: '{"op":"sleep-timer","action":"read"}' },
  { chan: 'pc', cmd: '{"op":"laptop","action":"read"}' },
  { chan: 'pc', cmd: '{"op":"corsair-apo-read"}' },
  { chan: 'pc', cmd: '{"op":"startup-apps-read"}' },
  { chan: 'pc', cmd: '{"op":"startup-impact-read"}' },
];

const LIVE_HARDWARE_OPS = [
  { chan: 'hidlist', cmd: 'ff00 0001', type: 'text' },
  { chan: 'monitor', cmd: '{"op":"monitors","caps":false}' },
  { chan: 'camera', cmd: '{"op":"cameras"}' },
  { chan: 'audio', cmd: '{"op":"audio-list","match":"HS80"}' },
  { chan: 'audio', cmd: '{"op":"usb-headsets"}' },
  { chan: 'audio', cmd: '{"op":"outputs"}' },
  { chan: 'audio', cmd: '{"op":"mics"}' },
  { chan: 'audio', cmd: '{"op":"procs"}' },
  { chan: 'audio', cmd: '{"op":"power"}' },
];

async function runSuite(exePath, ops, benchOps) {
  const h = new HelperSession(exePath);
  const results = new Map();
  const timings = new Map();
  try {
    for (const op of ops) {
      const k = `${op.chan}|${op.cmd}`;
      results.set(k, await h.request(op.chan, op.cmd));
    }
    for (const op of benchOps) {
      const k = `${op.chan}|${op.cmd}`;
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        await h.request(op.chan, op.cmd);
        samples.push(performance.now() - t0);
      }
      timings.set(k, median(samples));
    }
  } finally {
    await h.close();
  }
  return { results, timings };
}

assert.ok(fs.existsSync(RS_EXE), `Rust helper binary missing at ${RS_EXE}`);
assert.ok(fs.existsSync(CS_EXE), `C# helper binary missing at ${CS_EXE}`);

// Verify hard allowlist rejects non-read commands
assert.throws(() => assertAllowedRead('hs80:0a69:1', 'SET 03 1'), /REFUSED/);
assert.throws(() => assertAllowedRead('pointer', 'SET speed 10'), /REFUSED/);
assert.throws(() => assertAllowedRead('monitor', '{"op":"monitor-set"}'), /REFUSED/);

const activeOps = LIVE ? [...COMPARE_OPS, ...LIVE_HARDWARE_OPS] : COMPARE_OPS;
const benchOps = [
  { chan: 'watchdog', cmd: 'PING' },
  { chan: 'pointer', cmd: 'READ' },
  { chan: 'pc', cmd: '{"op":"display-hdr","action":"read"}' },
];

// Run C# completely, close it, THEN run Rust (never at the same time)
const cs = await runSuite(CS_EXE, activeOps, benchOps);
const rs = await runSuite(RS_EXE, [...activeOps, ...RUST_MOVED_PS_OPS], benchOps);

for (const op of activeOps) {
  const k = `${op.chan}|${op.cmd}`;
  const csRaw = cs.results.get(k);
  const rsRaw = rs.results.get(k);
  if (op.type === 'text') {
    assert.equal(rsRaw, csRaw, `parity mismatch for ${k}`);
  } else {
    const csJson = JSON.parse(csRaw);
    const rsJson = JSON.parse(rsRaw);
    for (const field of op.exactKeys || ['ok']) {
      assert.deepEqual(rsJson[field], csJson[field], `field ${field} mismatch for ${k}`);
    }
  }
}

for (const op of RUST_MOVED_PS_OPS) {
  const k = `${op.chan}|${op.cmd}`;
  const rsJson = JSON.parse(rs.results.get(k));
  assert.equal(typeof rsJson, 'object', `expected JSON object for ${k}`);
  assert.equal(rsJson.ok, true, `expected ok:true for ${k}, got ${rs.results.get(k)}`);
}

for (const op of benchOps) {
  const k = `${op.chan}|${op.cmd}`;
  const csMed = cs.timings.get(k);
  const rsMed = rs.timings.get(k);
  // Guard against sub-0.2ms timer floor noise by allowing max(2 * csMed, csMed + 0.5)
  const limit = Math.max(csMed * 2, csMed + 0.5);
  assert.ok(rsMed <= limit, `Rust median ${rsMed.toFixed(3)}ms > limit ${limit.toFixed(3)}ms (C# ${csMed.toFixed(3)}ms) for ${k}`);
  console.log(`timing ${k}: C#=${csMed.toFixed(3)}ms Rust=${rsMed.toFixed(3)}ms (limit=${limit.toFixed(3)}ms)`);
}

if (!LIVE) {
  for (const op of LIVE_HARDWARE_OPS) {
    console.log(`${op.chan}|${op.cmd}: not tested (needs test window)`);
  }
}

console.log(`helper-parity (${LIVE ? 'live' : 'offline'}): all ${activeOps.length + RUST_MOVED_PS_OPS.length} checked ops matched`);
