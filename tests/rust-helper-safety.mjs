import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { neverHit, refusal as neverRefusal } from '../helpers/never-guard.mjs';

const require = createRequire(import.meta.url);
const bragiGuard = require('../helpers/bragi-guard.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUST_SRC = path.join(ROOT, 'helpers', 'native-rs', 'src');

// 1. never-guard.mjs refuses dangerous commands before any bytes reach the helper
const hitAsusReset = neverHit({ vid: '0b05', pid: '1900', page: 'ff00', reportId: 0, bytes: [0x50, 0x40] });
assert.ok(hitAsusReset, 'neverHit must catch ASUS ROG headset reset (50 40)');
assert.match(neverRefusal(hitAsusReset, 'TestDevice').message, /never list/i);

const hitGloriousDfu = neverHit({ vid: '258a', pid: '0036', page: 'ff00', reportId: 5, bytes: [0x75] });
assert.ok(hitGloriousDfu, 'neverHit must catch Glorious DFU (reportId 5, 75)');

const hitViaBoot = neverHit({ vid: '342d', pid: '0000', page: 'ff60', reportId: 0, bytes: [0x0b] });
assert.ok(hitViaBoot, 'neverHit must catch VIA bootloader jump');

// 2. bragi-guard.js refuses dangerous Bragi commands before native.js writes to helper stdin
for (const bad of ['GET 05', 'SET 06 1', 'GET 14', 'SET 15 0', 'GET 16', 'SET 03 4']) {
  const msg = bragiGuard.refusal('hs80:1b94:8:bragi:frame=peripheral', bad);
  assert.ok(msg, `bragi-guard must refuse "${bad}" before reaching Rust helper`);
}
assert.equal(bragiGuard.refusal('hs80:1b94:8:bragi:frame=peripheral', 'GET 02'), null);

// Verify helpers/native.js invokes bragiGuard.refusal before spawning/writing to helper stdin
const nativeMod = require('../helpers/native.js');
const directReply = await nativeMod.request('hs80:1b94:8:bragi:frame=peripheral', 'SET 03 4');
assert.match(directReply, /^ERR .*never list/, 'native.request must refuse bragi-guarded command before starting helper');
assert.equal(nativeMod.running(), false, 'native.request must not start helper for a refused command');

// 3. Static scan of Rust source: no firmware/bootloader/DFU/SMBus/I2C calls, and every unsafe has // SAFETY:
const FORBIDDEN = [
  /\b(smbus_?(?:write|read|xfer|open)|i2c_?(?:write|read|smbus|xfer)|nvapi.*i2c|inpout|winring0|DeviceIoControl)\b/i,
  /\b(flash_?firmware|write_?firmware|dfu_?(?:detach|dnload|mode)?|enter_?bootloader|reboot_?bootloader|factory_?reset)\b/i,
];

const rsFiles = fs.readdirSync(RUST_SRC).filter((f) => f.endsWith('.rs'));
assert.ok(rsFiles.length > 0, 'Rust source files must exist');

for (const file of rsFiles) {
  const full = path.join(RUST_SRC, file);
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed.startsWith('//')) {
      for (const re of FORBIDDEN) {
        assert.ok(!re.test(line), `forbidden hardware/firmware pattern ${re} in ${file}:${i + 1}: ${trimmed}`);
      }
    }
    if (/\bunsafe\s*\{/.test(line) || /^\s*(?:pub\s+)?unsafe\s+(?:extern\s+"[^"]+"\s+)?fn\b/.test(line)) {
      const context = `${lines[i - 2] || ''} ${lines[i - 1] || ''} ${line}`;
      assert.match(context, /SAFETY:/, `missing // SAFETY: comment at ${file}:${i + 1}`);
    }
  }
}

console.log('rust-helper-safety (guards, forbidden call scan, SAFETY comments): all good');
