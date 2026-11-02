// The xz / LZMA2 decoder (public/core/xz.js, 1 Nov 2026), against files Python's lzma (liblzma) wrote:
//   - the checked-in samples in tests/fixtures/xz (made by make.py there): a Vial definition with the default preset,
//     empty data, CRC32 and no check, stored (incompressible) chunks, preset 9e, other lc / lp / pb, two streams with
//     padding, several blocks (xz --block-size), and the ones it must refuse (over 2 MB out, SHA-256, BCJ);
//   - when Python is on this PC (py or python), fresh random samples made now, each compared byte for byte;
//   - damaged data: every byte of a sample changed, every shorter length, junk after the end, random junk: each one
//     throws an XzError, and none takes long (nothing hangs).
// Run: node tests/xz.mjs (no hardware, no network)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { xzDecompress, XzError, crc32, crc64 } from '../public/core/xz.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'xz');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (n) => new Uint8Array(fs.readFileSync(path.join(DIR, n)));
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---- the checksums against their published check values ----
{
  const nine = new TextEncoder().encode('123456789');
  ok(crc32(nine) === 0xcbf43926, 'CRC32 of "123456789" is CBF43926');
  const [lo, hi] = crc64(nine);
  ok(hi === 0x995dc9bb && lo === 0xdf1939fa, `CRC64 of "123456789" is 995DC9BBDF1939FA (${hi.toString(16)}${lo.toString(16)})`);
}

// ---- the samples ----
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
for (const [name, want] of Object.entries(manifest)) {
  const t = Date.now();
  let out = null, err = null;
  try { out = xzDecompress(read(name)); } catch (e) { err = e; }
  if (want.error) ok(err instanceof XzError && err.message.includes(want.error), `${name}: refused (${err?.message || 'it decoded'})`);
  else ok(out && out.length === want.length && sha(out) === want.sha256, `${name}: decodes to the bytes Python compressed (${err?.message || `${out.length} bytes`})`);
  ok(Date.now() - t < 3000, `${name}: done in ${Date.now() - t} ms`);
}
ok(xzDecompress(read('empty.xz')).length === 0, 'compressed empty data decodes to nothing');
ok(throws(() => xzDecompress(new Uint8Array(0))) instanceof XzError, 'zero bytes are refused (not an xz file)');
ok(throws(() => xzDecompress('text')) instanceof XzError, 'something that is not bytes is refused');
{
  const vial = read('vial-sample.xz');
  // compared as JSON: a checkout that turns line ends into CRLF must not matter
  ok(JSON.stringify(JSON.parse(new TextDecoder().decode(xzDecompress(vial)))) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(DIR, 'vial-sample.json'), 'utf8'))), 'the Vial sample decodes to its vial.json');
  const e = throws(() => xzDecompress(read('mixed.xz'), { maxOutput: 100000 }));
  ok(e instanceof XzError && /more than allowed/.test(e.message), 'a lower output limit is kept');
}

// ---- damaged data: always an XzError, never a hang ----
function mustThrow(buf, what) {
  const t = Date.now();
  const e = throws(() => xzDecompress(buf));
  const ms = Date.now() - t;
  if (!(e instanceof XzError)) { ok(false, `${what}: ${e ? `threw ${e.name}: ${e.message}` : 'decoded'}`); return false; }
  if (ms > 2000) { ok(false, `${what}: took ${ms} ms`); return false; }
  return true;
}
{
  const good = read('vial-sample.xz');
  let n = 0, all = 0;
  for (let i = 0; i < good.length; i++) for (const x of [0x01, 0x80, 0xff]) {
    const b = good.slice(); b[i] ^= x; all++;
    if (mustThrow(b, `vial-sample byte ${i} ^ ${x.toString(16)}`)) n++;
  }
  ok(n === all, `every changed byte of the Vial sample is refused (${n} of ${all})`);
  let t = 0;
  for (let len = 1; len < good.length; len++) if (mustThrow(good.slice(0, len), `vial-sample cut to ${len} bytes`)) t++;
  ok(t === good.length - 1, `every shortened copy is refused (${t} of ${good.length - 1})`);
  const extra = new Uint8Array(good.length + 4); extra.set(good); extra.set([1, 2, 3, 4], good.length);
  mustThrow(extra, 'junk after the end');
  const pad3 = new Uint8Array(good.length + 3); pad3.set(good);
  mustThrow(pad3, 'padding that is not a multiple of four');
  const pad4 = new Uint8Array(good.length + 4); pad4.set(good);
  ok(!throws(() => xzDecompress(pad4)), 'padding of four zero bytes is allowed');
}
{
  // larger samples: random changes deep in the compressed data (the CRC64 catches what the decoder does not)
  let seed = 20261101;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (const name of ['mixed.xz', 'multiblock.xz', 'crc32.xz']) {
    const good = read(name);
    let n = 0;
    for (let k = 0; k < 120; k++) { const b = good.slice(); b[Math.floor(rnd() * b.length)] ^= 1 + Math.floor(rnd() * 255); if (mustThrow(b, `${name} damaged (${k})`)) n++; }
    ok(n === 120, `${name}: every damaged copy is refused (${n} of 120)`);
  }
  // random junk behind a valid stream header
  const head = read('vial-sample.xz').slice(0, 12);
  let n = 0;
  for (let k = 0; k < 300; k++) {
    const b = new Uint8Array(12 + Math.floor(rnd() * 400));
    b.set(head);
    for (let i = 12; i < b.length; i++) b[i] = Math.floor(rnd() * 256);
    if (k % 3 === 0) b[12] = 0x02;   // a plausible block header size
    if (mustThrow(b, `random junk (${k})`)) n++;
  }
  ok(n === 300, `random junk is refused (${n} of 300)`);
}

// ---- fresh samples from Python, when it is here ----
{
  const script = [
    'import lzma, random, base64, json',
    'r = random.Random(7); out = []',
    'for n in [1, 31, 32, 33, 1000, 65536, 70000, 300000]:',
    '    words = [bytes(r.choice(b"abcdefgh {}:,") for _ in range(r.randint(1, 12))) for _ in range(50)]',
    '    d = b"".join(r.choice(words) for _ in range(n // 5 + 1))[:n]',
    '    if n == 70000: d = bytes(r.getrandbits(8) for _ in range(n))',
    '    for preset in [0, 6, 9 | lzma.PRESET_EXTREME]:',
    '        out.append([base64.b64encode(d).decode(), base64.b64encode(lzma.compress(d, preset=preset)).decode()])',
    'print(json.dumps(out))',
  ].join('\n');
  let res = null;
  for (const py of ['py', 'python']) {
    const r = spawnSync(py, ['-I', '-c', script], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (r.status === 0 && r.stdout.trim().startsWith('[')) { res = JSON.parse(r.stdout); break; }
  }
  if (!res) console.log('  (Python is not on this PC: the checked-in samples were used alone)');
  else {
    let n = 0;
    for (const [d, x] of res) {
      const want = Buffer.from(d, 'base64'), got = xzDecompress(new Uint8Array(Buffer.from(x, 'base64')));
      if (Buffer.compare(Buffer.from(got), want) === 0) n++;
    }
    ok(n === res.length, `fresh samples from Python decode exactly (${n} of ${res.length})`);
  }
}

console.log(fails ? `xz: ${fails} failed` : 'xz: all passed');
process.exit(fails ? 1 : 0);
