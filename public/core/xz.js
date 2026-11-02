// XZ (.xz) decoder with the LZMA2 filter, in plain JavaScript (1 Nov 2026). Pure ESM with no Node or browser APIs, so
// the server and the app window can both use it. Written for Vial keyboards (public/devices/vial.js): their firmware
// holds their own vial.json compressed by Python's lzma.compress (vial-qmk util/vial_generate_definition.py @
// dd43959ae5c08d8a28d38a1acf7b04e86b14a344: FORMAT_XZ, LZMA2, preset 6, CRC64 check).
//
// Written from the public specifications: "The .xz File Format" 1.2.1 (tukaani.org/xz/xz-file-format.txt): stream
// header and footer, blocks, block header, index, VLI integers, CRC32 / CRC64; and LZMA2 / LZMA as the LZMA SDK's
// lzma-specification.txt and xz-embedded describe them (chunk control bytes, range coder, literal / match / rep coding).
// Every check the stream declares is verified: header, block header and index CRC32s, the CRC32 or CRC64 of each
// block's data, the index against the blocks, and the footer against the header. SHA-256 and filters other than LZMA2
// (BCJ, delta) are refused. The output is limited (2 MB unless told otherwise), the input is never read past its end,
// and every loop moves forward, so bad data throws one clear error and never hangs.

export const MAX_OUTPUT = 2 * 1024 * 1024;

export class XzError extends Error {
  constructor(msg) { super(`not a valid xz file: ${msg}`); this.name = 'XzError'; }
}
const bad = (msg) => { throw new XzError(msg); };

// ---- CRC32 (IEEE, reflected 0xEDB88320) and CRC64 (ECMA-182, reflected 0xC96C5795D7870F42, kept as two halves) ----
const CRC32 = new Uint32Array(256), C64LO = new Uint32Array(256), C64HI = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  CRC32[i] = c >>> 0;
  let lo = i, hi = 0;
  for (let k = 0; k < 8; k++) {
    const one = lo & 1;
    lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0; hi >>>= 1;
    if (one) { lo = (lo ^ 0xd7870f42) >>> 0; hi = (hi ^ 0xc96c5795) >>> 0; }
  }
  C64LO[i] = lo; C64HI[i] = hi;
}
export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC32[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// -> [lo, hi] as unsigned 32-bit halves
export function crc64(buf, start = 0, end = buf.length) {
  let lo = 0xffffffff, hi = 0xffffffff;
  for (let i = start; i < end; i++) {
    const t = (lo ^ buf[i]) & 0xff;
    lo = (((lo >>> 8) | (hi << 24)) ^ C64LO[t]) >>> 0;
    hi = ((hi >>> 8) ^ C64HI[t]) >>> 0;
  }
  return [(lo ^ 0xffffffff) >>> 0, (hi ^ 0xffffffff) >>> 0];
}

const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
// check id -> size in bytes (xz-file-format 3.4); only 0 (none), 1 (CRC32) and 4 (CRC64) are verified, others refused
const CHECK_SIZE = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];

// a reader over the input that never reads past the end
class In {
  constructor(buf) { this.b = buf; this.p = 0; }
  need(n, what) { if (this.p + n > this.b.length) bad(`it ends in the middle of ${what}`); }
  byte(what) { this.need(1, what); return this.b[this.p++]; }
  // a variable-length integer (xz-file-format 1.2): 7 bits a byte, at most 9 bytes, no needless trailing zero byte
  vli(what) {
    let v = 0, mul = 1;
    for (let i = 0; i < 9; i++) {
      const x = this.byte(what);
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) {
        if (i > 0 && x === 0) bad(`${what} is not written the shortest way`);
        if (v > Number.MAX_SAFE_INTEGER) bad(`${what} is too large`);
        return v;
      }
      mul *= 128;
    }
    return bad(`${what} is longer than 9 bytes`);
  }
}

// ---- LZMA / LZMA2 ----
const PROB_INIT = 1024;
const STATES = 12, POS_STATES_MAX = 16;
class LzmaState {
  constructor() { this.lc = 0; this.lp = 0; this.pb = 0; this.lit = null; this.reset(); }
  props(byte) {
    if (byte > 224) bad('the LZMA properties byte is out of range');
    const lc = byte % 9, rest = (byte / 9) | 0, lp = rest % 5, pb = (rest / 5) | 0;
    if (lc + lp > 4) bad('LZMA2 allows lc + lp of at most 4');
    if (pb > 4) bad('pb is above 4');
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.lit = new Uint16Array(0x300 << (lc + lp));
  }
  reset() {
    this.state = 0; this.reps = [0, 0, 0, 0];
    this.isMatch = new Uint16Array(STATES * POS_STATES_MAX).fill(PROB_INIT);
    this.isRep = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG0 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG1 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG2 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRep0Long = new Uint16Array(STATES * POS_STATES_MAX).fill(PROB_INIT);
    this.posSlot = new Uint16Array(4 * 64).fill(PROB_INIT);
    this.posSpecial = new Uint16Array(1 + 128 - 14).fill(PROB_INIT);
    this.align = new Uint16Array(16).fill(PROB_INIT);
    this.lenDec = newLen(); this.repLenDec = newLen();
    if (this.lit) this.lit.fill(PROB_INIT);
  }
}
const newLen = () => ({ choice: new Uint16Array(2).fill(PROB_INIT), low: new Uint16Array(16 * 8).fill(PROB_INIT), mid: new Uint16Array(16 * 8).fill(PROB_INIT), high: new Uint16Array(256).fill(PROB_INIT) });

// the range decoder over exactly one LZMA2 chunk's compressed bytes
class Range {
  constructor(buf, start, end) {
    if (end - start < 5) bad('an LZMA chunk is too short');
    if (buf[start] !== 0) bad('an LZMA chunk does not start with a zero byte');
    this.b = buf; this.p = start + 5; this.end = end;
    this.range = 0xffffffff;
    this.code = u32le([buf[start + 4], buf[start + 3], buf[start + 2], buf[start + 1]], 0);
    if (this.code === this.range) bad('an LZMA chunk starts with an impossible code');
  }
  norm() {
    if (this.range < 0x1000000) {
      if (this.p >= this.end) bad('an LZMA chunk used more bytes than it said it has');
      this.range = (this.range * 256) >>> 0;
      this.code = ((this.code * 256) + this.b[this.p++]) >>> 0;
    }
  }
  bit(probs, i) {
    const p = probs[i], bound = (this.range >>> 11) * p;
    let r;
    if (this.code < bound) { this.range = bound; probs[i] = p + ((2048 - p) >>> 5); r = 0; }
    else { this.range = (this.range - bound) >>> 0; this.code = (this.code - bound) >>> 0; probs[i] = p - (p >>> 5); r = 1; }
    this.norm();
    return r;
  }
  tree(probs, base, bits) { let m = 1; for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, base + m); return m - (1 << bits); }
  reverse(probs, base, bits) { let m = 1, sym = 0; for (let i = 0; i < bits; i++) { const b = this.bit(probs, base + m); m = (m << 1) | b; sym |= b << i; } return sym; }
  direct(bits) {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) { this.code = (this.code - this.range) >>> 0; b = 1; }
      v = v * 2 + b;
      this.norm();
    }
    return v;
  }
}

function lenOf(rc, L, posState) {
  if (!rc.bit(L.choice, 0)) return 2 + rc.tree(L.low, posState * 8, 3);
  if (!rc.bit(L.choice, 1)) return 10 + rc.tree(L.mid, posState * 8, 3);
  return 18 + rc.tree(L.high, 0, 8);
}

// the output: one growing buffer that is also the dictionary (it never exceeds the output limit)
class Out {
  constructor(max) { this.max = max; this.buf = new Uint8Array(Math.min(max, 64 * 1024)); this.n = 0; this.dictStart = 0; this.dictSize = 0; }
  room(k) {
    if (this.n + k > this.max) bad(`it holds more than ${this.max} bytes, which is more than allowed`);
    if (this.n + k > this.buf.length) { const nb = new Uint8Array(Math.min(this.max, Math.max(this.buf.length * 2, this.n + k))); nb.set(this.buf.subarray(0, this.n)); this.buf = nb; }
  }
}

// one LZMA chunk: exactly `size` bytes out of buf[start, end)
function lzmaChunk(s, out, buf, start, end, size) {
  const rc = new Range(buf, start, end);
  out.room(size);
  const o = out.buf, stop = out.n + size, pbMask = (1 << s.pb) - 1, lpMask = (1 << s.lp) - 1, lc = s.lc;
  let n = out.n, state = s.state;
  const reps = s.reps;
  const avail = () => Math.min(n - out.dictStart, out.dictSize);
  while (n < stop) {
    const pos = n - out.dictStart, posState = pos & pbMask;
    if (!rc.bit(s.isMatch, (state << 4) + posState)) {
      // a literal
      const prev = n > out.dictStart ? o[n - 1] : 0;
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        if (reps[0] >= avail()) bad('a match points before the start of the data');
        let match = o[n - reps[0] - 1];
        while (sym < 0x100) {
          const mb = (match >>> 7) & 1; match = (match << 1) & 0xff;
          const b = rc.bit(s.lit, base + ((1 + mb) << 8) + sym);
          sym = (sym << 1) | b;
          if (mb !== b) break;
        }
      }
      while (sym < 0x100) sym = (sym << 1) | rc.bit(s.lit, base + sym);
      o[n++] = sym & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (!rc.bit(s.isRep, state)) {
      // a match with a new distance
      reps[3] = reps[2]; reps[2] = reps[1]; reps[1] = reps[0];
      len = lenOf(rc, s.lenDec, posState);
      state = state < 7 ? 7 : 10;
      const slot = rc.tree(s.posSlot, (len - 2 < 3 ? len - 2 : 3) * 64, 6);
      let dist;
      if (slot < 4) dist = slot;
      else {
        const bits = (slot >>> 1) - 1;
        dist = (2 | (slot & 1)) * 2 ** bits;
        if (slot < 14) dist += rc.reverse(s.posSpecial, dist - slot, bits);
        else dist += rc.direct(bits - 4) * 16 + rc.reverse(s.align, 0, 4);
      }
      if (dist === 0xffffffff) bad('an LZMA2 chunk holds an end marker, which LZMA2 does not allow');
      reps[0] = dist;
    } else {
      if (!rc.bit(s.isRepG0, state)) {
        if (!rc.bit(s.isRep0Long, (state << 4) + posState)) {
          // one byte from the last distance
          if (reps[0] >= avail()) bad('a match points before the start of the data');
          state = state < 7 ? 9 : 11;
          o[n] = o[n - reps[0] - 1]; n++;
          continue;
        }
      } else {
        let d;
        if (!rc.bit(s.isRepG1, state)) d = reps[1];
        else {
          if (!rc.bit(s.isRepG2, state)) d = reps[2];
          else { d = reps[3]; reps[3] = reps[2]; }
          reps[2] = reps[1];
        }
        reps[1] = reps[0]; reps[0] = d;
      }
      len = lenOf(rc, s.repLenDec, posState);
      state = state < 7 ? 8 : 11;
    }
    if (reps[0] >= avail()) bad('a match points before the start of the data');
    if (n + len > stop) bad('a match runs past the end of its chunk');
    const from = n - reps[0] - 1;
    for (let i = 0; i < len; i++) o[n + i] = o[from + i];
    n += len;
  }
  if (rc.p !== rc.end || rc.code !== 0) bad('an LZMA chunk did not end where it said it would');
  s.state = state;
  out.n = n;
}

// LZMA2 data from buf[p, end): appends to out, returns where it stopped (just after the end byte)
function lzma2(buf, p, end, out, dictSize) {
  const s = new LzmaState();
  let needDictReset = true, needProps = true;
  out.dictStart = out.n; out.dictSize = dictSize;
  for (;;) {
    if (p >= end) bad('the LZMA2 data has no end');
    const c = buf[p++];
    if (c === 0x00) return p;
    if (c === 0x01 || c === 0x02) {
      // an uncompressed chunk
      if (c === 0x01) { needProps = true; needDictReset = false; out.dictStart = out.n; }
      else if (needDictReset) bad('the first LZMA2 chunk does not reset the dictionary');
      if (p + 2 > end) bad('it ends in the middle of an LZMA2 chunk header');
      const size = ((buf[p] << 8) | buf[p + 1]) + 1; p += 2;
      if (p + size > end) bad('it ends in the middle of an uncompressed chunk');
      out.room(size);
      out.buf.set(buf.subarray(p, p + size), out.n);
      out.n += size; p += size;
      continue;
    }
    if (c < 0x80) bad(`0x${c.toString(16)} is not an LZMA2 chunk type`);
    if (p + 4 > end) bad('it ends in the middle of an LZMA2 chunk header');
    const size = ((c & 0x1f) * 65536) + ((buf[p] << 8) | buf[p + 1]) + 1;
    const packed = ((buf[p + 2] << 8) | buf[p + 3]) + 1; p += 4;
    const reset = (c >>> 5) & 3;   // 0 none, 1 state, 2 state + properties, 3 everything (dictionary too)
    if (reset === 3) { needDictReset = false; out.dictStart = out.n; }
    else if (needDictReset) bad('the first LZMA2 chunk does not reset the dictionary');
    if (reset >= 2) { if (p >= end) bad('it ends before the LZMA properties'); s.props(buf[p++]); needProps = false; }
    else if (needProps) bad('an LZMA2 chunk needs properties it was never given');
    if (reset >= 1) s.reset();
    if (p + packed > end) bad('it ends in the middle of an LZMA chunk');
    lzmaChunk(s, out, buf, p, p + packed, size);
    p += packed;
  }
}

function lzma2DictSize(prop) {
  if (prop > 40) bad('the LZMA2 dictionary size is out of range');
  if (prop === 40) return 0xffffffff;
  return (2 | (prop & 1)) * 2 ** ((prop >>> 1) + 11);
}

// one stream from inp.p; appends to out
function stream(inp, out) {
  const b = inp.b;
  inp.need(12, 'the stream header');
  for (let i = 0; i < 6; i++) if (b[inp.p + i] !== MAGIC[i]) bad('the stream header magic bytes are wrong');
  const flags0 = b[inp.p + 6], flags1 = b[inp.p + 7];
  if (crc32(b, inp.p + 6, inp.p + 8) !== u32le(b, inp.p + 8)) bad('the stream header CRC32 does not match');
  if (flags0 !== 0 || flags1 & 0xf0) bad('the stream flags use bits the format reserves');
  const check = flags1 & 0x0f;
  if (check !== 0 && check !== 1 && check !== 4) bad(check === 10 ? 'SHA-256 checks are not supported' : `check type ${check} is not supported`);
  const checkSize = CHECK_SIZE[check];
  inp.p += 12;
  const records = [];
  for (;;) {
    inp.need(1, 'a block header');
    const hb = b[inp.p];
    if (hb === 0x00) break;   // the index
    const hstart = inp.p, hsize = (hb + 1) * 4;
    inp.need(hsize, 'a block header');
    if (crc32(b, hstart, hstart + hsize - 4) !== u32le(b, hstart + hsize - 4)) bad('a block header CRC32 does not match');
    const h = new In(b.subarray(hstart, hstart + hsize - 4)); h.p = 1;
    const bf = h.byte('the block flags');
    if (bf & 0x3c) bad('the block flags use bits the format reserves');
    const nf = (bf & 3) + 1;
    const csize = bf & 0x40 ? h.vli('the compressed size') : null;
    const usize = bf & 0x80 ? h.vli('the uncompressed size') : null;
    if (csize === 0) bad('a block says it has no compressed data');
    let dict = null;
    for (let f = 0; f < nf; f++) {
      const id = h.vli('a filter id'), psize = h.vli('a filter properties size');
      h.need(psize, 'filter properties');
      if (id !== 0x21) bad(id === 0x03 ? 'the delta filter is not supported' : id >= 0x04 && id <= 0x0b ? 'BCJ filters are not supported' : `filter 0x${id.toString(16)} is not supported`);
      if (f !== nf - 1) bad('LZMA2 must be the last filter');
      if (psize !== 1) bad('the LZMA2 filter properties are not one byte');
      dict = lzma2DictSize(h.b[h.p]); h.p += psize;
    }
    for (; h.p < h.b.length; h.p++) if (h.b[h.p] !== 0) bad('the block header padding is not zero');
    inp.p = hstart + hsize;
    const dstart = inp.p, ostart = out.n;
    // the compressed data ends at the LZMA2 end byte; a stated compressed size bounds it
    const limit = csize != null ? Math.min(b.length, dstart + csize) : b.length;
    if (csize != null && dstart + csize > b.length) bad('it ends in the middle of a block');
    const dend = lzma2(b, dstart, limit, out, dict);
    const got = dend - dstart;
    if (csize != null && got !== csize) bad('a block\'s compressed size does not match its header');
    if (usize != null && out.n - ostart !== usize) bad('a block\'s uncompressed size does not match its header');
    inp.p = dend;
    while ((inp.p - dstart) % 4) { if (inp.byte('block padding') !== 0) bad('the block padding is not zero'); }
    inp.need(checkSize, 'a block check');
    if (check === 1 && crc32(out.buf, ostart, out.n) !== u32le(b, inp.p)) bad('a block\'s CRC32 does not match its data (the data is damaged)');
    if (check === 4) {
      const [lo, hi] = crc64(out.buf, ostart, out.n);
      if (lo !== u32le(b, inp.p) || hi !== u32le(b, inp.p + 4)) bad('a block\'s CRC64 does not match its data (the data is damaged)');
    }
    inp.p += checkSize;
    records.push([hsize + got + checkSize, out.n - ostart]);
  }
  // the index: must list exactly the blocks that were read
  const istart = inp.p;
  inp.p++;
  const count = inp.vli('the index record count');
  if (count !== records.length) bad('the index lists a different number of blocks');
  for (let i = 0; i < count; i++) {
    const unpadded = inp.vli('an index record'), usize = inp.vli('an index record');
    if (unpadded !== records[i][0] || usize !== records[i][1]) bad('the index does not match the blocks');
  }
  while ((inp.p - istart) % 4) { if (inp.byte('index padding') !== 0) bad('the index padding is not zero'); }
  inp.need(4, 'the index CRC32');
  if (crc32(b, istart, inp.p) !== u32le(b, inp.p)) bad('the index CRC32 does not match');
  inp.p += 4;
  // the footer
  inp.need(12, 'the stream footer');
  const f = inp.p;
  if (b[f + 10] !== 0x59 || b[f + 11] !== 0x5a) bad('the stream footer magic bytes are wrong');
  if (crc32(b, f + 4, f + 10) !== u32le(b, f)) bad('the stream footer CRC32 does not match');
  if ((u32le(b, f + 4) + 1) * 4 !== inp.p - istart) bad('the stream footer gives the wrong index size');
  if (b[f + 8] !== flags0 || b[f + 9] !== flags1) bad('the stream footer flags differ from the header');
  inp.p += 12;
}

// .xz bytes (a Uint8Array) -> the decompressed bytes. Concatenated streams and stream padding are allowed, as
// Python's lzma.decompress allows them. Throws XzError on anything else.
export function xzDecompress(input, { maxOutput = MAX_OUTPUT } = {}) {
  if (!(input instanceof Uint8Array)) bad('the input is not bytes');
  if (input.length === 0) bad('it is empty');
  if (input.length > maxOutput) bad(`it is larger than ${maxOutput} bytes`);
  const inp = new In(input), out = new Out(maxOutput);
  stream(inp, out);
  for (;;) {
    // stream padding: zero bytes in fours, then the end or another stream
    const pstart = inp.p;
    while (inp.p < input.length && input[inp.p] === 0) inp.p++;
    if ((inp.p - pstart) % 4) bad('the stream padding is not a multiple of four bytes');
    if (inp.p >= input.length) break;
    stream(inp, out);
  }
  return out.buf.slice(0, out.n);
}
